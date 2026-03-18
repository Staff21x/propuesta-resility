const makeWASocket   = require('baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } =
  require('baileys');
const { Boom }       = require('@hapi/boom');
const QRCode         = require('qrcode');
const qrcode         = require('qrcode-terminal');
const express        = require('express');
const axios          = require('axios');
const fs             = require('fs');
const path           = require('path');

// ============================================================
// CONFIGURACION
// ============================================================
const PORT        = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL ||
  'https://script.google.com/macros/s/AKfycbxgapir6qhMpusj5zYSztufS95bz5epC05YEqkF5vcAVQczXGJw-7BV8fz5HzqaGr0Fow/exec';
const API_TOKEN   = process.env.API_TOKEN || 'staff21x-secret-2024';
const SESSION_DIR = process.env.SESSION_DIR || '/app/.wsp_session';
const LID_MAP_FILE = path.join(SESSION_DIR, 'lid_map.json');

// ============================================================
// EXPRESS
// ============================================================
const app = express();
app.use(express.json());

let socket        = null;
let estadoCliente = 'disconnected'; // disconnected | qr_pending | connected
let qrImageBase64 = null;

// Mapa LID → JID real (@s.whatsapp.net), poblado por contacts.upsert y persistido en disco
const lidMap = new Map();

function cargarLidMap() {
  try {
    if (fs.existsSync(LID_MAP_FILE)) {
      const data = JSON.parse(fs.readFileSync(LID_MAP_FILE, 'utf8'));
      for (const [k, v] of Object.entries(data)) {
        lidMap.set(k, v);
      }
      console.log(`[LID] Mapa cargado desde disco: ${lidMap.size} entradas`);
    }
  } catch (e) {
    console.warn('[LID] No se pudo cargar lid_map.json:', e.message);
  }
}

function guardarLidMap() {
  try {
    fs.mkdirSync(path.dirname(LID_MAP_FILE), { recursive: true });
    fs.writeFileSync(LID_MAP_FILE, JSON.stringify(Object.fromEntries(lidMap), null, 2));
  } catch (e) {
    console.warn('[LID] No se pudo guardar lid_map.json:', e.message);
  }
}

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
async function extraerNumero(msg) {
  const jid = msg.key.remoteJid || '';

  // Caso normal: JID tiene número de teléfono directamente
  if (jid.endsWith('@s.whatsapp.net')) {
    const digits = jid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
    return formatearNumero(digits);
  }

  // Caso LID (@lid): WhatsApp nuevo formato de ID de dispositivo.
  if (jid.endsWith('@lid')) {
    // Helper: extraer numero de cualquier valor string con formato @s.whatsapp.net
    function resolverDesdeJidStr(valor, fuente) {
      if (typeof valor !== 'string') return null;
      const limpio = valor.trim();
      const match  = limpio.match(/^(\d+)@s\.whatsapp\.net$/);
      if (!match) return null;
      const num = formatearNumero(match[1]);
      if (num) console.log(`[WSP] LID ${jid} resuelto via ${fuente}: ${num}`);
      return num || null;
    }

    // 1. remoteJidAlt directo
    const numAlt = resolverDesdeJidStr(msg.key.remoteJidAlt, 'remoteJidAlt');
    if (numAlt) return numAlt;

    // 2. Escaneo de todos los campos string de msg.key (por si el campo tiene otro nombre en esta version de Baileys)
    for (const [campo, valor] of Object.entries(msg.key)) {
      if (campo === 'remoteJid' || campo === 'id') continue; // saltar JID LID e ID de mensaje
      const num = resolverDesdeJidStr(valor, `msg.key.${campo}`);
      if (num) return num;
    }

    console.log(`[LID] altJid no disponible aun. msg.key: ${JSON.stringify(msg.key)}`);

    // 3. Fallback: mapa local contacts.upsert con reintentos
    const MAX_REINTENTOS = 4;
    const ESPERA_MS      = 2000;
    for (let i = 0; i <= MAX_REINTENTOS; i++) {
      // Re-leer remoteJidAlt en cada intento (Baileys puede popularlo async)
      const numRetry = resolverDesdeJidStr(msg.key.remoteJidAlt, `remoteJidAlt-retry${i}`);
      if (numRetry) return numRetry;

      const jidReal = lidMap.get(jid);
      if (jidReal) {
        const digits = jidReal.replace('@s.whatsapp.net', '').replace(/\D/g, '');
        const num    = formatearNumero(digits);
        console.log(`[WSP] LID ${jid} resuelto via lidMap: ${num}${i > 0 ? ` (intento ${i + 1})` : ''}`);
        return num;
      }
      if (i < MAX_REINTENTOS) {
        console.log(`[LID] Esperando resolucion de ${jid} (intento ${i + 1}/${MAX_REINTENTOS})...`);
        await new Promise(r => setTimeout(r, ESPERA_MS));
      }
    }
    console.warn(`[WSP] LID no resuelto tras ${MAX_REINTENTOS} reintentos, descartando (JID: ${jid})`);
    return null;
  }

  // Fallback genérico
  const digits = jid.split('@')[0].replace(/\D/g, '');
  return formatearNumero(digits);
}

// ============================================================
// CLIENTE BAILEYS
// ============================================================
function limpiarSesion() {
  lidMap.clear();
  try {
    if (fs.existsSync(SESSION_DIR)) {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      console.log('[SESSION] Carpeta de sesion eliminada:', SESSION_DIR);
    }
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  } catch (e) {
    console.error('[SESSION] Error limpiando sesion:', e.message);
  }
}

async function iniciarCliente() {
  console.log('[WSP] Iniciando cliente Baileys...');

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  cargarLidMap();

  // Fallback a version conocida si falla la consulta a GitHub
  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
    console.log('[WSP] Version WA obtenida:', version.join('.'));
  } catch (e) {
    version = [2, 3000, 1015901307];
    console.warn('[WSP] fetchLatestBaileysVersion fallo, usando version fallback:', version.join('.'));
  }

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

  // Poblar mapa LID→JID real a partir de actualizaciones de contactos
  socket.ev.on('contacts.upsert', (contacts) => {
    let changed = false;
    for (const c of contacts) {
      if (c.lid && c.id) {
        lidMap.set(c.lid, c.id);
        changed = true;
        console.log(`[LID] contacts.upsert: ${c.lid} → ${c.id}`);
      }
    }
    if (changed) guardarLidMap();
  });

  socket.ev.on('contacts.update', (updates) => {
    let changed = false;
    for (const c of updates) {
      if (c.lid && c.id) {
        lidMap.set(c.lid, c.id);
        changed = true;
        console.log(`[LID] contacts.update: ${c.lid} → ${c.id}`);
      }
    }
    if (changed) guardarLidMap();
  });

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
        console.log('[WSP] Sesion cerrada (loggedOut). Limpiando sesion y generando nuevo QR...');
        limpiarSesion();
        setTimeout(iniciarCliente, 3000);
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

        if (msg.key.remoteJid.endsWith('@lid')) {
          console.log('[LID DEBUG] msg.key completo:', JSON.stringify(msg.key));
          console.log('[LID DEBUG] msg fields:', Object.keys(msg));
          if (msg.participant) console.log('[LID DEBUG] msg.participant:', msg.participant);
        }

        const numero = await extraerNumero(msg);
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

// Forzar nuevo QR: borra sesion y reinicia el cliente
// Util cuando WhatsApp desvinculo el dispositivo y el QR no aparece
app.post('/session/reset', verificarToken, async (req, res) => {
  console.log('[SESSION] Reset solicitado via API');
  estadoCliente = 'disconnected';
  qrImageBase64 = null;
  if (socket) {
    try { socket.end(); } catch (_) {}
    socket = null;
  }
  limpiarSesion();
  res.json({ ok: true, mensaje: 'Sesion reiniciada. El QR aparecera en /qr en unos segundos.' });
  setTimeout(iniciarCliente, 2000);
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
