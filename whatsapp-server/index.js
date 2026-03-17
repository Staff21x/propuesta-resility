const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const axios = require('axios');

// ============================================================
// CONFIGURACION
// ============================================================
const PORT          = process.env.PORT || 3000;
const WEBHOOK_URL   = process.env.WEBHOOK_URL ||
  'https://script.google.com/macros/s/AKfycbxgapir6qhMpusj5zYSztufS95bz5epC05YEqkF5vcAVQczXGJw-7BV8fz5HzqaGr0Fow/exec';
const API_TOKEN     = process.env.API_TOKEN || 'staff21x-secret-2024';

// ============================================================
// EXPRESS
// ============================================================
const app = express();
app.use(express.json());

// Estado global del cliente
let clienteWsp     = null;
let estadoCliente  = 'disconnected'; // disconnected | qr_pending | connected
let qrImageBase64  = null;

// ============================================================
// CLIENTE WHATSAPP
// ============================================================
function iniciarCliente() {
  console.log('[WSP] Iniciando cliente WhatsApp...');

  clienteWsp = new Client({
    authStrategy: new LocalAuth({ dataPath: '/app/.wsp_session' }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    }
  });

  // QR para vincular
  clienteWsp.on('qr', async (qr) => {
    estadoCliente = 'qr_pending';
    console.log('\n========================================');
    console.log('  ESCANEA ESTE QR CON WHATSAPP');
    console.log('  WhatsApp > Dispositivos vinculados > +');
    console.log('========================================\n');
    qrcode.generate(qr, { small: true });

    // Tambien guardar como imagen base64 para el endpoint /qr
    try {
      qrImageBase64 = await QRCode.toDataURL(qr);
    } catch (e) {
      console.error('[QR] Error generando imagen:', e.message);
    }
  });

  // Listo
  clienteWsp.on('ready', () => {
    estadoCliente = 'connected';
    qrImageBase64 = null;
    const info = clienteWsp.info;
    console.log('\n[WSP] ✓ Conectado como:', info.pushname, '|', info.wid.user);
  });

  // Desconexion
  clienteWsp.on('disconnected', (reason) => {
    estadoCliente = 'disconnected';
    console.log('[WSP] Desconectado:', reason);
    console.log('[WSP] Reiniciando en 10 segundos...');
    setTimeout(iniciarCliente, 10000);
  });

  // Autenticado (sesion existente cargada)
  clienteWsp.on('authenticated', () => {
    console.log('[WSP] Sesion autenticada correctamente.');
  });

  // Error de autenticacion
  clienteWsp.on('auth_failure', (msg) => {
    estadoCliente = 'disconnected';
    console.error('[WSP] Error de autenticacion:', msg);
  });

  // MENSAJES ENTRANTES → forward al webhook
  clienteWsp.on('message', async (msg) => {
    try {
      // Ignorar mensajes propios y de grupos
      if (msg.fromMe) return;
      if (msg.from.includes('@g.us')) return;

      const numero = msg.from.replace('@c.us', '').replace(/\D/g, '');
      const texto  = msg.body;

      console.log(`[MSG IN] ${numero}: ${texto.substring(0, 80)}`);

      const payload = {
        event: 'message:in:new',
        data: {
          body:       texto,
          fromNumber: numero
        }
      };

      await axios.post(WEBHOOK_URL, payload, {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' }
      });

      console.log(`[WEBHOOK] ✓ Forward exitoso a Google Apps Script`);
    } catch (err) {
      console.error('[WEBHOOK] Error al hacer forward:', err.message);
    }
  });

  clienteWsp.initialize();
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

// Estado del servidor
app.get('/', (req, res) => {
  res.json({
    servicio:  'WhatsApp Server - Staff21x PAZ',
    estado:    estadoCliente,
    timestamp: new Date().toISOString()
  });
});

// Ver estado detallado
app.get('/status', (req, res) => {
  res.json({
    estado:        estadoCliente,
    conectado:     estadoCliente === 'connected',
    qr_disponible: estadoCliente === 'qr_pending',
    timestamp:     new Date().toISOString()
  });
});

// Ver QR como imagen HTML (util para Railway)
app.get('/qr', (req, res) => {
  if (estadoCliente === 'connected') {
    return res.send('<h2>✓ WhatsApp ya esta conectado</h2>');
  }
  if (!qrImageBase64) {
    return res.send('<h2>Generando QR... Recarga en unos segundos.</h2><meta http-equiv="refresh" content="3">');
  }
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>QR WhatsApp - Staff21x</title>
      <meta http-equiv="refresh" content="30">
      <style>
        body { font-family: sans-serif; display:flex; flex-direction:column;
               align-items:center; justify-content:center; min-height:100vh;
               background:#f0f0f0; margin:0; }
        img  { border:8px solid white; border-radius:16px; box-shadow:0 4px 20px rgba(0,0,0,0.2); }
        h2   { color:#128C7E; }
        p    { color:#666; }
      </style>
    </head>
    <body>
      <h2>Escanea con WhatsApp</h2>
      <p>WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
      <img src="${qrImageBase64}" width="300" height="300" />
      <p style="margin-top:16px; font-size:12px;">Se actualiza automaticamente cada 30s</p>
    </body>
    </html>
  `);
});

// ENVIAR MENSAJE - endpoint principal para Wassenger-compatible
app.post('/send', verificarToken, async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ error: 'Faltan campos: phone y message son requeridos' });
    }
    if (estadoCliente !== 'connected') {
      return res.status(503).json({ error: 'WhatsApp no esta conectado', estado: estadoCliente });
    }

    // Normalizar numero → formato WhatsApp
    const numeroLimpio = phone.replace(/\D/g, '');
    const chatId       = numeroLimpio + '@c.us';

    await clienteWsp.sendMessage(chatId, message);
    console.log(`[SEND] ✓ Mensaje enviado a ${numeroLimpio}`);

    res.status(201).json({
      success: true,
      phone:   numeroLimpio,
      message: message
    });
  } catch (err) {
    console.error('[SEND] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint compatible con formato Wassenger (mismo que usa paz.gs)
app.post('/v1/messages', verificarToken, async (req, res) => {
  return app._router.handle(
    Object.assign(req, { url: '/send', path: '/send' }),
    res,
    () => {}
  );
});

// ============================================================
// ARRANCAR
// ============================================================
app.listen(PORT, () => {
  console.log(`\n[SERVER] Staff21x WhatsApp Server corriendo en puerto ${PORT}`);
  console.log(`[SERVER] Webhook destino: ${WEBHOOK_URL}`);
  console.log(`[SERVER] Token API:       ${API_TOKEN}`);
  console.log(`[SERVER] Ver QR en:       http://localhost:${PORT}/qr\n`);
});

iniciarCliente();
