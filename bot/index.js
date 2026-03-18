/**
 * index.js — Resility WhatsApp Bot (versión optimizada)
 *
 * Stack: Baileys + Claude Haiku + Express webhook
 *
 * Tiempo de respuesta objetivo: < 5 segundos (vs 1-2 minutos anterior)
 *
 * Cambios clave respecto a la versión lenta:
 *   1. Modelo claude-haiku en lugar de Opus/Sonnet (6-10x más rápido)
 *   2. Sin loop de agente — respuesta directa en 1 sola llamada a la API
 *   3. Historial recortado (6 mensajes, no toda la conversación)
 *   4. Webhook retorna 202 inmediatamente, procesa en background
 *   5. Sistema anti-duplicado: descarta mensajes si ya se está procesando
 */

import 'dotenv/config';
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import express from 'express';
import { processMessage } from './claude-handler.js';
import { addMessage, getHistory } from './conversation-store.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } },
});

const OPERATOR_NUMBER = process.env.OPERATOR_NUMBER;

// Set de JIDs actualmente en procesamiento — evita respuestas duplicadas
const processing = new Set();

// ─── WhatsApp Socket ────────────────────────────────────────────────────────

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger: logger.child({ level: 'silent' }), // silencia logs internos de Baileys
    printQRInTerminal: true,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,           // No cargar historial completo al iniciar
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) logger.info('Escanea el QR con WhatsApp.');
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      logger.warn({ code }, shouldReconnect ? 'Reconectando…' : 'Sesión cerrada. Re-autenticar.');
      if (shouldReconnect) setTimeout(startBot, 3000);
    }
    if (connection === 'open') logger.info('✓ Bot conectado a WhatsApp');
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Ignorar mensajes propios, de broadcast, de grupos, y sin texto
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid?.endsWith('@g.us')) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;

      const jid = msg.key.remoteJid;
      const phone = jid.replace(/@.*/, '');
      const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || '';

      if (!text.trim()) continue;

      // Anti-duplicado: si ya estamos procesando este contacto, ignorar
      if (processing.has(jid)) {
        logger.debug({ jid }, 'Mensaje ignorado — procesamiento en curso');
        continue;
      }

      processing.add(jid);
      const start = Date.now();
      logger.info({ phone, text: text.substring(0, 60) }, '[MSG IN]');

      // Marcar como leído de inmediato (muestra palomitas azules)
      await sock.readMessages([msg.key]);

      // Mostrar "escribiendo…" mientras Claude procesa
      await sock.sendPresenceUpdate('composing', jid);

      try {
        // Guardar mensaje del usuario en historial
        addMessage(phone, 'user', text);
        const history = getHistory(phone);

        // ── Llamada a Claude (objetivo: < 3s con Haiku) ──────────────────
        const { text: reply, shouldEscalate } = await processMessage(text, history);
        // ─────────────────────────────────────────────────────────────────

        if (shouldEscalate) {
          await handleEscalation(sock, jid, phone, text);
        } else {
          // Guardar respuesta en historial antes de enviar
          addMessage(phone, 'assistant', reply);
          await sock.sendMessage(jid, { text: reply });
          logger.info({ phone, ms: Date.now() - start }, '[RESP] Enviado en %dms');
        }
      } catch (err) {
        logger.error({ err, phone }, 'Error procesando mensaje');
        await sock.sendMessage(jid, {
          text: 'Disculpa, tuve un problema técnico. Te comunico con nuestro equipo.',
        });
        await handleEscalation(sock, jid, phone, text);
      } finally {
        await sock.sendPresenceUpdate('paused', jid);
        processing.delete(jid);
      }
    }
  });
}

// ─── Escalamiento a humano ──────────────────────────────────────────────────

async function handleEscalation(sock, jid, phone, originalMessage) {
  logger.info({ phone }, '[ESCALAR] Transfiriendo a operador');

  // 1. Avisar al usuario
  await sock.sendMessage(jid, {
    text: 'Te conecto ahora con uno de nuestros ejecutivos. En unos momentos te contactan.',
  });

  // 2. Notificar al operador si está configurado
  if (OPERATOR_NUMBER) {
    const operatorJid = `${OPERATOR_NUMBER}@s.whatsapp.net`;
    await sock.sendMessage(operatorJid, {
      text: `🔔 *Escalamiento*\n📱 +${phone}\n💬 "${originalMessage}"`,
    });
  }
}

// ─── Webhook (opcional) ─────────────────────────────────────────────────────
// Si prefieres disparar el bot desde un webhook externo en lugar del listener
// de Baileys, usa este endpoint POST /message

let _sockRef = null;

function startWebhookServer(sock) {
  _sockRef = sock;
  const app = express();
  app.use(express.json());

  app.post('/message', async (req, res) => {
    // IMPORTANTE: retornar 202 de inmediato, procesar en background
    // Esto es lo que faltaba en la versión anterior (el webhook esperaba todo el procesamiento)
    res.status(202).json({ ok: true });

    const { phone, text } = req.body;
    if (!phone || !text) return;

    const jid = `${phone}@s.whatsapp.net`;
    if (processing.has(jid)) return;

    processing.add(jid);
    try {
      addMessage(phone, 'user', text);
      const history = getHistory(phone);
      const { text: reply, shouldEscalate } = await processMessage(text, history);

      if (shouldEscalate) {
        await handleEscalation(_sockRef, jid, phone, text);
      } else {
        addMessage(phone, 'assistant', reply);
        await _sockRef.sendMessage(jid, { text: reply });
      }
    } catch (err) {
      logger.error({ err }, 'Error en webhook /message');
    } finally {
      processing.delete(jid);
    }
  });

  app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => logger.info({ PORT }, '✓ Webhook escuchando'));
}

// ─── Arranque ───────────────────────────────────────────────────────────────

(async () => {
  await startBot();
})();
