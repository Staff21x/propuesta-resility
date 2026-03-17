const makeWASocket   = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } =
  require('@whiskeysockets/baileys');
const { Boom }       = require('@hapi/boom');
const QRCode         = require('qrcode');
const qrcode         = require('qrcode-terminal');
const express        = require('express');
const axios          = require('axios');
const path           = require('path');

// ============================================================
// CONFIGURACION
// ============================================================
const PORT        = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL ||
  'https://script.google.com/macros/s/AKfycbxgapir6qhMpusj5zYSztufS95bz5epC05YEqkF5vcAVQczXGJw-7BV8fz5HzqaGr0Fow/exec';
const API_TOKEN   = process.env.API_TOKEN || 'staff21x-secret-2024';
const SESSION_DIR = process.env.SESSION_DIR || '/app/.wsp_session';

// ============================================================
// EXPRESS
// ============================================================
const app = express();
app.use(express.json());

let socket        = null;
let estadoCliente = 'disconnected'; // disconnected | qr_pending | connected
let qrImageBase64 = null;

// ============================================================
// HELPERS - EXTRACCION Y FORMATO DE NUMERO
// ============================================================

// Convierte dígitos crudos a formato +56XXXXXXXXX (o +XXXXXXXXXXX para otros países)
function formatearNumero(digits) {
  if (!digits || digits.length < 7) return null;
  // Ya trae código de país Chile: 569XXXXXXXX (11 dígitos)
  if (digits.startsWith('56') && digits.length === 11) return '+' + digits;
  // Número local chileno sin código de país: 9XXXXXXXX (9 dígitos)
  if (digits.startsWith('9') && digits.length === 9)   return '+56' + digits;
  // Cualquier otro país: devolver con + tal cual
  return '+' + digits;
}

// Extrae el número de teléfono real desde el mensaje de Baileys.
// Maneja los dos formatos de JID:
//   - numero@s.whatsapp.net  → número real
//   - xxxxxxx@lid            → ID de dispositivo WhatsApp, NO es un teléfono;
//                              en ese caso busca el número en msg.participant
//                              o en verifiedBizName, pushName como ultimo recurso.
function extraerNumero(msg) {
  const jid = msg.key.remoteJid || '';

  // Caso normal: JID tiene número de teléfono directamente
  if (jid.endsWith('@s.whatsapp.net')) {
    const digits = jid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
    return formatearNumero(digits);
  }

  // Caso LID (@lid): WhatsApp nuevo formato de ID de dispositivo.
  // El número real puede venir en msg.key.participant (chats de grupo/broadcast)
  // o en msg.participant.
  if (jid.endsWith('@lid')) {
    const candidatos = [
      msg.key.participant || '',
      msg.participant     || ''
    ];
    for (const c of candidatos) {
      if (c.endsWith('@s.whatsapp.net')) {
        const digits = c.replace('@s.whatsapp.net', '').replace(/\D/g, '');
        const num    = formatearNumero(digits);
        if (num) return num;
      }
    }
    // Ultimo recurso: usar la parte numérica del LID como identificador
    // (no es un teléfono válido, pero evita perder el mensaje)
    const lidUser = jid.split('@')[0].replace(/\D/g, '');
    console.warn(`[WSP] LID sin telefono real (JID: ${jid}). Usando LID: ${lidUser}`);
    return lidUser || null;
  }

  // Fallback genérico
  const digits = jid.split('@')[0].replace(/\D/g, '');
  return formatearNumero(digits);
}

// ============================================================
// CLIENTE BAILEYS
// ============================================================
async function iniciarCliente() {
  console.log('[WSP] Iniciando cliente Baileys...');

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  socket = makeWASocket({
    version,
    auth:                state,
    printQRInTerminal:   false,   // lo manejamos nosotros
    browser:             ['Staff21x PAZ', 'Chrome', '120.0.0'],
    connectTimeoutMs:    60000,
    defaultQueryTimeoutMs: 30000,
    keepAliveIntervalMs: 25000,
    logger:              require('pino')({ level: 'silent' })
  });

  // Guardar credenciales cuando se actualicen
  socket.ev.on('creds.update', saveCreds);

  // Conexion y QR
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      estadoCliente = 'qr_pending';
      console.log('\n========================================');
      console.log('  ESCANEA ESTE QR CON WHATSAPP');
      console.log('  WhatsApp > Dispositivos vinculados > +');
      console.log('========================================\n');
      qrcode.generate(qr, { small: true });

      try {
        qrImageBase64 = await QRCode.toDataURL(qr);
      } catch (e) {
        console.error('[QR] Error generando imagen:', e.message);
      }
    }

    if (connection === 'open') {
      estadoCliente = 'connected';
      qrImageBase64 = null;
      const user = socket.user;
      console.log('\n[WSP] Conectado como:', user.name || user.id, '|', user.id);
    }

    if (connection === 'close') {
      estadoCliente = 'disconnected';
      const codigo  = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const razon   = lastDisconnect?.error?.message || 'desconocida';
      console.log(`[WSP] Desconectado. Codigo: ${codigo} | Razon: ${razon}`);

      if (codigo === DisconnectReason.loggedOut) {
        console.log('[WSP] Sesion cerrada. Borra la carpeta de sesion y reinicia.');
      } else {
        console.log('[WSP] Reconectando en 5 segundos...');
        setTimeout(iniciarCliente, 5000);
      }
    }
  });

  // MENSAJES ENTRANTES → forward al webhook
  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (msg.key.fromMe)                    continue; // ignorar propios
        if (msg.key.remoteJid.endsWith('@g.us')) continue; // ignorar grupos

        const texto  = msg.message?.conversation ||
                       msg.message?.extendedTextMessage?.text ||
                       '';
        if (!texto) continue;

        const numero = extraerNumero(msg);
        if (!numero) {
          console.warn('[MSG IN] No se pudo extraer numero del JID:', msg.key.remoteJid);
          continue;
        }
        console.log(`[MSG IN] JID raw: ${msg.key.remoteJid} | Numero extraido: ${numero}`);
        console.log(`[MSG IN] Texto: ${texto.substring(0, 80)}`);

        const payload = {
          event: 'message:in:new',
          data:  { body: texto, fromNumber: numero }
        };

        console.log('[WEBHOOK] URL:  ', WEBHOOK_URL);
        console.log('[WEBHOOK] Body: ', JSON.stringify(payload));

        const resp = await axios.post(WEBHOOK_URL, payload, {
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' }
        });

        console.log(`[WEBHOOK] Respuesta HTTP: ${resp.status} | Body: ${JSON.stringify(resp.data).substring(0, 200)}`);
      } catch (err) {
        const status = err.response?.status;
        const body   = JSON.stringify(err.response?.data || {}).substring(0, 200);
        console.error(`[WEBHOOK] ERROR: ${err.message} | HTTP: ${status} | Body: ${body}`);
      }
    }
  });
}

// ============================================================
// MIDDLEWARE - AUTH SIMPLE
// ============================================================
function verificarToken(req, res, next) {
  const token = req.headers['x-api-token'] || req.query.token;
  if (token !== API_TOKEN) {
    return res.status(401).json({ error: 'Token invalido' });
  }
  next();
}

// ============================================================
// ENDPOINTS
// ============================================================
app.get('/', (req, res) => {
  res.json({
    servicio:  'WhatsApp Server - Staff21x PAZ (Baileys)',
    estado:    estadoCliente,
    timestamp: new Date().toISOString()
  });
});

app.get('/status', (req, res) => {
  res.json({
    estado:        estadoCliente,
    conectado:     estadoCliente === 'connected',
    qr_disponible: estadoCliente === 'qr_pending',
    timestamp:     new Date().toISOString()
  });
});

// QR como pagina HTML (util para Railway)
app.get('/qr', (req, res) => {
  if (estadoCliente === 'connected') {
    return res.send('<h2 style="font-family:sans-serif;color:#128C7E">WhatsApp ya esta conectado</h2>');
  }
  if (!qrImageBase64) {
    return res.send('<h2 style="font-family:sans-serif">Generando QR...</h2><meta http-equiv="refresh" content="3">');
  }
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>QR WhatsApp - Staff21x</title>
  <meta http-equiv="refresh" content="30">
  <style>
    body { font-family:sans-serif; display:flex; flex-direction:column;
           align-items:center; justify-content:center; min-height:100vh;
           background:#f0f0f0; margin:0; }
    img  { border:8px solid white; border-radius:16px; box-shadow:0 4px 20px rgba(0,0,0,.2); }
    h2   { color:#128C7E; }
    p    { color:#666; }
  </style>
</head>
<body>
  <h2>Escanea con WhatsApp</h2>
  <p>WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
  <img src="${qrImageBase64}" width="300" height="300"/>
  <p style="margin-top:16px;font-size:12px">Se actualiza automaticamente cada 30s</p>
</body>
</html>`);
});

// POST /send  →  { phone, message }
app.post('/send', verificarToken, async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ error: 'Faltan campos: phone y message son requeridos' });
    }
    if (estadoCliente !== 'connected') {
      return res.status(503).json({ error: 'WhatsApp no esta conectado', estado: estadoCliente });
    }

    const numeroLimpio = phone.replace(/\D/g, '');
    const jid          = numeroLimpio + '@s.whatsapp.net';

    await socket.sendMessage(jid, { text: message });
    console.log(`[SEND] Mensaje enviado a ${numeroLimpio}`);

    res.status(201).json({ success: true, phone: numeroLimpio, message });
  } catch (err) {
    console.error('[SEND] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Alias compatible con formato Wassenger (usado en paz.gs)
app.post('/v1/messages', verificarToken, async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'Faltan campos: phone y message son requeridos' });
    }
    if (estadoCliente !== 'connected') {
      return res.status(503).json({ error: 'WhatsApp no esta conectado', estado: estadoCliente });
    }
    const numeroLimpio = phone.replace(/\D/g, '');
    await socket.sendMessage(numeroLimpio + '@s.whatsapp.net', { text: message });
    console.log(`[SEND] Mensaje enviado a ${numeroLimpio}`);
    res.status(201).json({ success: true, phone: numeroLimpio, message });
  } catch (err) {
    console.error('[SEND] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ARRANCAR
// ============================================================
app.listen(PORT, () => {
  console.log(`\n[SERVER] Staff21x WhatsApp Server (Baileys) en puerto ${PORT}`);
  console.log(`[SERVER] Webhook destino: ${WEBHOOK_URL}`);
  console.log(`[SERVER] Ver QR en:       http://localhost:${PORT}/qr\n`);
});

iniciarCliente().catch(err => {
  console.error('[FATAL] Error al iniciar cliente:', err);
  process.exit(1);
});
