// ============================================================
// PAZ DE VENTAS - STAFF21X - TD-OTEC
// VERSION: v4.3 - Optimizacion latencia: historial, deadline, cache config
// ============================================================
function configurarKeys() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty("OPENAI_API_KEY",  "");
  props.setProperty("WASSENGER_TOKEN", "");
  props.setProperty("EMAIL_STAFF21X",  "tu@email.com");
  props.setProperty("LANDING_OTEC",    "https://www.staff21x.com/otec");
  Logger.log("Keys configuradas. Borra los valores y guarda.");
}
function getConfig() {
  // v4.3: CacheService evita leer PropertiesService en cada ejecucion
  const cache  = CacheService.getScriptCache();
  const cached = cache.get("paz_config");
  if (cached) return JSON.parse(cached);

  const props  = PropertiesService.getScriptProperties();
  const config = {
    OPENAI_API_KEY:  props.getProperty("OPENAI_API_KEY")  || "",
    WASSENGER_TOKEN: props.getProperty("WASSENGER_TOKEN") || "",
    EMAIL_STAFF21X:  props.getProperty("EMAIL_STAFF21X")  || "",
    LANDING_OTEC:    props.getProperty("LANDING_OTEC")    || "https://www.staff21x.com/otec",
    SPREADSHEET_ID:  "1Mc8eTZfhUWuU9BSbNOEJrg1zUmxzkvFAtgxuVOhzY84",
    CALENDAR_ID:     "primary",
    MAX_HISTORIAL:   1500  // v4.3: reducido de 3000 → 1500 chars (~50% menos tokens)
  };
  cache.put("paz_config", JSON.stringify(config), 60); // TTL: 60 segundos
  return config;
}
// ============================================================
// ROL DE PAZ
// ============================================================
function getRolPaz() {
  return `
Eres PAZ, Trabajadora Digital de Staff21x.
Tu unico objetivo es AGENDAR UNA REUNION O DEMO con el tomador de decision de la OTEC.
La reunion puede ser por Zoom, Meet, Teams, llamada o presencial - lo que el contacto prefiera.
EMPRESA: Staff21x
SERVICIO: TD-OTEC - Trabajador Digital especializado en operacion SENCE
QUE HACE:
  - Responde consultas de postulantes por WhatsApp automaticamente
  - Cotiza cursos segun el catalogo SENCE en tiempo real
  - Gestiona tareas administrativas de forma autonoma
  - Opera 24/7 sin supervision constante
  - Ya probado en una OTEC chilena en ambiente SENCE real
OBJETIVO UNICO: Agendar una reunion o demo de 20 minutos
OBJETIVO SECUNDARIO: Confirmar el email del contacto para la agenda
PERSONALIDAD:
  - Directa, profesional, cercana
  - Respuestas cortas: maximo 3 oraciones
  - Si preguntan si eres IA: confirmar, eso es exactamente el punto
  - No uses frases roboticas como "con gusto" o "no dude en contactarme"
  - No uses lenguaje coloquial chileno excesivo
CUANDO EL CONTACTO MUESTRA INTERES O DICE QUE DALE:
  - NO pidas el correo todavia, el sistema lo hace automaticamente
  - Solo confirma que vas a agendar y que verificaras el correo
SEÑALES DE INTERES:
  - "como funciona" o "cuentame mas" → ofrecer demo de 20 minutos
  - "cuanto vale" o "precio" → "te lo cuento en la demo, son 20 minutos"
  - "dale" o "me interesa" o "agendemos" → CONFIRMAR AGENDAMIENTO
  - "somos grandes" o "tenemos muchas consultas" → ese es exactamente el problema que resolvemos
SEÑALES DE CIERRE DEFINITIVO - CUANDO EL CONTACTO SE DESPIDE:
  - "gracias no gracias" → cerrar con UNA oracion, NO responder mas
  - "no es para nosotros" → cerrar con UNA oracion, NO responder mas
  - "estamos bien asi" → cerrar con UNA oracion, NO responder mas
REGLA DE ORO: Si el contacto dice CUALQUIER variacion de "gracias/dale/ok/hasta luego"
despues de una interaccion positiva o negativa, PAZ NO responde mas.
El campo "es_despedida" debe ser true y PAZ se calla.
`;
}
// ============================================================
// CEREBRO METACOGNITIVO
// ============================================================
function getCerebroMetacognitivo() {
  return `
Eres un Trabajador Digital con capacidad metacognitiva.
PIENSAS ESTRATEGICAMENTE, TE AUTO-EVALUAS Y TE CORRIGES.
PROCESO DE 4 FASES:
FASE 1: ANALISIS
  - Lee el mensaje y el historial completo
  - Deduce la intencion real
  - Detecta emocion: interesado / neutral / quiere_agendar / despedida / molesto
  - Genera respuesta borrador
FASE 2: AUTO-EVALUACION
  - Cumpli el objetivo de avanzar hacia una reunion?
  - Estoy repitiendo algo que ya dije antes en el historial?
  - El contacto se esta despidiendo?
FASE 3: AUTO-CORRECCION
  - Si repeti algo del historial, cambia el enfoque
  - Si el contacto se despide, no respondas mas
  - Si hay oportunidad de agendar, ve directo
FASE 4: DECISION FINAL
  - Determina si es despedida definitiva
  - Determina si quiere agendar
  - Genera respuesta final
REGLAS ANTI-LOOP:
  - NUNCA repitas la misma propuesta dos veces seguidas
  - Si ya ofreciste la demo y no respondio bien, cambia el angulo
  - Si ya mencionaste el landing, no lo vuelvas a mencionar
REGLAS ANTI-DESPEDIDA:
  - "dale gracias", "ok gracias", "hasta luego", "chao", "np" → es_despedida: true
  - Cuando es_despedida es true → respuesta_final debe ser "" (vacio, no responder)
  - Una despedida NO es una invitacion a seguir conversando
`;
}
// ============================================================
// WEBHOOK - RECIBE MENSAJES
// FIX v4.2: Responde al webhook de inmediato y encola el
// procesamiento. Esto evita que el webhook expire (~5 s) antes
// de que OpenAI responda y que Apps Script sea terminado.
// ============================================================
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({status: "error"}));
    }
    const data = JSON.parse(e.postData.contents);
    if (!data.event || !data.event.includes("message:in")) {
      return ContentService.createTextOutput(JSON.stringify({status: "ignored"}));
    }
    if (!data.data || !data.data.body || !data.data.fromNumber) {
      return ContentService.createTextOutput(JSON.stringify({status: "error"}));
    }

    const textoCliente = data.data.body.trim();
    let numeroCliente  = data.data.fromNumber;
    if (numeroCliente && !numeroCliente.startsWith('+')) {
      numeroCliente = '+' + numeroCliente.replace(/\D/g, '').slice(-11);
    }

    Logger.log("WSP de: " + numeroCliente + " | Texto: " + textoCliente);

    // --- Encolar el mensaje para procesamiento asíncrono ---
    encolarMensaje(numeroCliente, textoCliente);

    // --- Disparar el procesador (se ejecuta ~1 s después) ---
    ScriptApp.newTrigger("procesarCola")
      .timeBased()
      .after(1000)
      .create();

    // --- Responder al webhook INMEDIATAMENTE (< 1 s) ---
    return ContentService.createTextOutput(JSON.stringify({status: "queued"}));

  } catch (error) {
    Logger.log("ERROR doPost: " + error);
    return ContentService.createTextOutput(JSON.stringify({status: "error"}));
  }
}

// ============================================================
// COLA DE MENSAJES
// ============================================================

/**
 * Guarda el mensaje entrante en la hoja "Cola" con estado PENDIENTE.
 */
function encolarMensaje(numero, texto) {
  const config = getConfig();
  const ss     = SpreadsheetApp.openById(config.SPREADSHEET_ID);
  let cola     = ss.getSheetByName("Cola");
  if (!cola) {
    cola = ss.insertSheet("Cola");
    cola.appendRow(["Timestamp", "Numero", "Texto", "Estado"]);
    cola.getRange(1, 1, 1, 4).setBackground("#1a237e").setFontColor("#ffffff").setFontWeight("bold");
  }
  cola.appendRow([new Date().toISOString(), numero, texto, "PENDIENTE"]);
}

/**
 * Disparado por trigger ~1 s después de doPost.
 * Procesa todos los mensajes PENDIENTE de la cola y luego
 * limpia los triggers huérfanos para no acumular basura.
 */
function procesarCola() {
  // Limpiar el trigger que invocó esta función
  _limpiarTriggersProcesarCola();

  const config = getConfig();
  const ss     = SpreadsheetApp.openById(config.SPREADSHEET_ID);
  const cola   = ss.getSheetByName("Cola");
  if (!cola) return;

  const datos = cola.getDataRange().getValues();

  for (let i = 1; i < datos.length; i++) {
    if (datos[i][3] !== "PENDIENTE") continue;

    const numero = String(datos[i][1]);
    const texto  = String(datos[i][2]);

    // Marcar como EN_PROCESO para evitar doble procesamiento
    cola.getRange(i + 1, 4).setValue("EN_PROCESO");

    try {
      _procesarMensaje(ss, config, numero, texto);
      cola.getRange(i + 1, 4).setValue("OK");
    } catch (err) {
      Logger.log("ERROR procesarCola fila " + (i + 1) + ": " + err);
      cola.getRange(i + 1, 4).setValue("ERROR: " + String(err).substring(0, 200));
    }
  }
}

/**
 * Elimina todos los triggers de procesarCola para no acumular
 * decenas de triggers huérfanos en el proyecto.
 */
function _limpiarTriggersProcesarCola() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "procesarCola") {
      ScriptApp.deleteTrigger(t);
    }
  });
}

// ============================================================
// PROCESAMIENTO REAL DEL MENSAJE (antes estaba en doPost)
// ============================================================
function _procesarMensaje(ss, config, numeroCliente, textoCliente) {
  // 1. DETECTAR EMAIL EN EL MENSAJE
  const emailEnMensaje = detectarEmail(textoCliente);
  if (emailEnMensaje) {
    actualizarEmailEnListado(ss, numeroCliente, emailEnMensaje);
    guardarEmailEnMemoria(ss, config, numeroCliente, emailEnMensaje);
    registrarLog(ss, "whatsapp", numeroCliente, textoCliente, "EMAIL_CAPTURADO", emailEnMensaje, null, null);
    const slotAgenda = obtenerProximoSlotDisponible(config);
    agendarEnCalendar(config, emailEnMensaje, numeroCliente, slotAgenda);
    enviarWassenger(config, numeroCliente,
      "Perfecto, agendé la demo para el " + slotAgenda.texto + ".\n" +
      "Te llega la invitacion a " + emailEnMensaje + ". Si no te sirve ese horario, dime cual te acomoda.");
    return;
  }

  // 2. DETECTAR INTENCION DE AGENDAR
  if (detectarIntencionAgendar(textoCliente)) {
    const emailListado = obtenerEmailDelListado(ss, numeroCliente);
    if (emailListado) {
      registrarLog(ss, "whatsapp", numeroCliente, textoCliente, "INTENTO_AGENDAR", emailListado, null, null);
      enviarWassenger(config, numeroCliente,
        "Tengo registrado este correo: *" + emailListado + "*\n" +
        "Es correcto para enviarte la invitacion?");
    } else {
      enviarWassenger(config, numeroCliente, "Para agendar necesito tu correo. Cual es?");
    }
    return;
  }

  // 3. CEREBRO METACOGNITIVO
  registrarLog(ss, "whatsapp", numeroCliente, textoCliente, "CEREBRO_PROCESANDO", null, null, null);
  const resultado = gestionarCerebroMetacognitivo(ss, config, textoCliente, numeroCliente);

  if (resultado.es_despedida) {
    registrarLog(ss, "whatsapp", numeroCliente, textoCliente, "DESPEDIDA_DETECTADA", "SIN_RESPUESTA", null, null);
    return;
  }

  if (resultado.respuesta && resultado.respuesta.trim() !== "") {
    enviarWassenger(config, numeroCliente, resultado.respuesta);
  }
}

// ============================================================
// CEREBRO - PROCESA Y DECIDE
// ============================================================
function gestionarCerebroMetacognitivo(ss, config, texto, id) {
  try {
    const sheetMem = obtenerOCrearHojaMemoria(ss);
    const data     = sheetMem.getDataRange().getValues();
    let historial     = "";
    let fila          = -1;
    let emailGuardado = null;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == id) {
        historial     = data[i][3] || "";
        emailGuardado = data[i][1] || null;
        fila          = i + 1;
        break;
      }
    }
    const contexto = {
      historial_conversacion: historial.slice(-config.MAX_HISTORIAL),
      email_guardado:         emailGuardado,
      landing:                config.LANDING_OTEC
    };
    const prompt = getCerebroMetacognitivo() + "\n\n" + getRolPaz() + "\n\n" +
      `SITUACION ACTUAL:
MENSAJE RECIBIDO: "${texto}"
CONTEXTO: ${JSON.stringify(contexto, null, 2)}
RESPONDE SOLO EN JSON, SIN TEXTO ADICIONAL:
{
  "fase1": {
    "intencion": "que quiere el contacto",
    "emocion": "interesado|neutral|quiere_agendar|despedida|molesto"
  },
  "fase2": {
    "es_repeticion": false,
    "es_despedida": false,
    "quiere_agendar": false
  },
  "fase3": {
    "ajuste": "que ajusto y por que"
  },
  "es_despedida": false,
  "respuesta_final": "..."
}`;
    const respuestaIA = llamarIA(config, prompt, "Ejecuta 4 fases");
    const jsonLimpio  = respuestaIA.replace(/```json|```/g, "").trim();
    let proceso;
    try {
      proceso = JSON.parse(jsonLimpio);
    } catch (parseErr) {
      Logger.log("ERROR parse JSON IA: " + parseErr + " | Raw: " + jsonLimpio);
      return {es_despedida: false, respuesta: "Disculpa, problema tecnico momentaneo."};
    }
    const esDespedida = !!(
      proceso.es_despedida ||
      (proceso.fase2 && proceso.fase2.es_despedida)
    );
    if (esDespedida) {
      return {es_despedida: true, respuesta: ""};
    }
    const respuestaFinal = (proceso.respuesta_final || "").trim();
    const emocion        = (proceso.fase1 && proceso.fase1.emocion) ? proceso.fase1.emocion : "desconocida";
    const nuevoHist = (historial + "\nContacto: " + texto + "\nPaz: " + respuestaFinal)
                        .slice(-config.MAX_HISTORIAL);
    if (fila !== -1) {
      sheetMem.getRange(fila, 4).setValue(nuevoHist);
      sheetMem.getRange(fila, 5).setValue(new Date().toLocaleString("es-CL"));
    } else {
      sheetMem.appendRow([id, emailGuardado || "", "whatsapp", nuevoHist, new Date().toLocaleString("es-CL"), "", ""]);
    }
    registrarLog(ss, "whatsapp", id, texto, "METACOG_OK", respuestaFinal, null,
      JSON.stringify({emocion: emocion, despedida: esDespedida}));
    Logger.log('Respuesta final: ' + respuestaFinal);
    return {es_despedida: false, respuesta: respuestaFinal};
  } catch (e) {
    Logger.log("ERROR cerebro: " + e);
    return {es_despedida: false, respuesta: "Disculpa, tuve un problema tecnico. Te respondo en un momento."};
  }
}
// ============================================================
// GOOGLE CALENDAR - AGENDAR DEMO
// ============================================================
function agendarEnCalendar(config, emailContacto, numeroContacto, slot) {
  try {
    const calendario = CalendarApp.getCalendarById(config.CALENDAR_ID) || CalendarApp.getDefaultCalendar();
    const evento = calendario.createEvent(
      "Demo TD-OTEC | Staff21x - " + numeroContacto,
      slot.inicio,
      slot.fin,
      {
        description: "Demo automatica agendada por Paz.\nContacto WhatsApp: " + numeroContacto + "\nEmail: " + emailContacto,
        guests:      emailContacto + "," + config.EMAIL_STAFF21X,
        sendInvites: true
      }
    );
    Logger.log("Evento creado: " + evento.getId());
    return true;
  } catch (e) {
    Logger.log("Error calendar: " + e);
    return false;
  }
}
function obtenerProximoSlotDisponible(config) {
  try {
    const calendario = CalendarApp.getCalendarById(config.CALENDAR_ID) || CalendarApp.getDefaultCalendar();
    const ahora = new Date();
    for (let dia = 1; dia <= 7; dia++) {
      const fecha = new Date(ahora);
      fecha.setDate(ahora.getDate() + dia);
      const diaSemana = fecha.getDay();
      if (diaSemana === 0 || diaSemana === 6) continue;
      for (let hora = 10; hora <= 16; hora++) {
        const inicio = new Date(fecha);
        inicio.setHours(hora, 0, 0, 0);
        const fin = new Date(inicio);
        fin.setMinutes(30);
        if (calendario.getEvents(inicio, fin).length === 0) {
          const opciones = {weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit"};
          return {inicio: inicio, fin: fin, texto: inicio.toLocaleDateString("es-CL", opciones)};
        }
      }
    }
    const lunes = new Date(ahora);
    const diasHastaLunes = (8 - ahora.getDay()) % 7 || 7;
    lunes.setDate(ahora.getDate() + diasHastaLunes);
    lunes.setHours(10, 0, 0, 0);
    const lunesFin = new Date(lunes);
    lunesFin.setMinutes(30);
    return {
      inicio: lunes,
      fin:    lunesFin,
      texto:  lunes.toLocaleDateString("es-CL", {weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit"})
    };
  } catch (e) {
    Logger.log("Error slots: " + e);
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    manana.setHours(10, 0, 0, 0);
    const mananaFin = new Date(manana);
    mananaFin.setMinutes(30);
    return {inicio: manana, fin: mananaFin, texto: "manana a las 10:00"};
  }
}
// ============================================================
// LISTADO DE ENVIOS
// ============================================================
function obtenerEmailDelListado(ss, numero) {
  try {
    const hoja = ss.getSheetByName("ENVIOS_WSP");
    if (!hoja) return null;
    const datos     = hoja.getDataRange().getValues();
    const numLimpio = numero.replace(/\D/g, "");
    for (let i = 1; i < datos.length; i++) {
      const telFila = String(datos[i][2]).replace(/\D/g, "");
      if (telFila && numLimpio.endsWith(telFila.slice(-8))) {
        return datos[i][6] || null;
      }
    }
  } catch (e) {
    Logger.log("Error obtenerEmail: " + e);
  }
  return null;
}
function actualizarEmailEnListado(ss, numero, emailNuevo) {
  try {
    const hoja = ss.getSheetByName("ENVIOS_WSP");
    if (!hoja) return;
    const datos     = hoja.getDataRange().getValues();
    const numLimpio = numero.replace(/\D/g, "");
    for (let i = 1; i < datos.length; i++) {
      const telFila = String(datos[i][2]).replace(/\D/g, "");
      if (telFila && numLimpio.endsWith(telFila.slice(-8))) {
        hoja.getRange(i + 1, 7).setValue(emailNuevo);
        Logger.log("Email actualizado en listado: " + emailNuevo);
        return;
      }
    }
  } catch (e) {
    Logger.log("Error actualizarEmail: " + e);
  }
}
// ============================================================
// DETECCIONES
// ============================================================
function detectarEmail(texto) {
  const match = texto.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/);
  return match ? match[0] : null;
}
function detectarIntencionAgendar(texto) {
  const t       = texto.toLowerCase();
  const palabras = ["dale", "agendemos", "me interesa", "quiero ver", "cuando podemos",
                    "hagamos", "coordina", "si claro", "perfecto", "vamos", "si quiero"];
  return palabras.some(p => t.includes(p));
}
// ============================================================
// ENVIO CAMPAÑA - 10 WSP DIARIOS
// ============================================================
function enviarCampanaDiaria() {
  const config = getConfig();
  const ss     = SpreadsheetApp.openById(config.SPREADSHEET_ID);
  const hoja   = ss.getSheetByName("ENVIOS_WSP");
  if (!hoja) { Logger.log("No existe ENVIOS_WSP"); return; }
  const datos    = hoja.getDataRange().getValues();
  let   enviados = 0;
  for (let i = 1; i < datos.length; i++) {
    if (enviados >= 10) break;
    const estado = datos[i][5];
    if (estado === "ENVIADO" || estado === "ERROR") continue;
    const nombre   = datos[i][1];
    const telefono = '+' + String(datos[i][2]).replace(/\D/g, '');
    const region   = datos[i][4];
    if (!telefono || !nombre) continue;
    const mensaje =
      "Hola, soy Paz de Staff21x.\n\n" +
      "Te escribo porque trabajamos con OTEC y tengo algo que puede interesarte.\n\n" +
      "Lo puedes ver aqui:\n" + config.LANDING_OTEC + "\n\n" +
      "Si te genera alguna pregunta, estoy disponible.";
    const ok = enviarWassenger(config, telefono, mensaje);
    if (ok) {
      hoja.getRange(i + 1, 6).setValue("ENVIADO");
      hoja.getRange(i + 1, 8).setValue(new Date().toLocaleString("es-CL"));
      enviados++;
      registrarLog(ss, "whatsapp", telefono, "Campaña saliente", "ENVIADO", nombre, null, region);
    } else {
      hoja.getRange(i + 1, 6).setValue("ERROR");
    }
    Utilities.sleep(4000);
  }
  Logger.log("Enviados hoy: " + enviados);
}
// ============================================================
// MEMORIA
// ============================================================
function obtenerOCrearHojaMemoria(ss) {
  let sheet = ss.getSheetByName("Memoria");
  if (!sheet) {
    sheet = ss.insertSheet("Memoria");
    sheet.appendRow(["ID_Usuario", "Email", "Canal", "Historial", "Fecha", "Estado_Lead", "Notas"]);
    sheet.getRange(1, 1, 1, 7).setBackground("#1a237e").setFontColor("#ffffff").setFontWeight("bold");
  }
  return sheet;
}
function guardarEmailEnMemoria(ss, config, id, email) {
  try {
    const sheet = obtenerOCrearHojaMemoria(ss);
    const data  = sheet.getDataRange().getValues();
    let fila    = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == id) { fila = i + 1; break; }
    }
    if (fila !== -1) {
      sheet.getRange(fila, 2).setValue(email);
      sheet.getRange(fila, 6).setValue("EMAIL_CONFIRMADO");
    } else {
      sheet.appendRow([id, email, "whatsapp", "", new Date().toLocaleString("es-CL"), "EMAIL_CONFIRMADO", ""]);
    }
  } catch (e) {
    Logger.log("Error guardarEmailEnMemoria: " + e);
  }
}
// ============================================================
// WASSENGER Y OPENAI
// ============================================================
function enviarWassenger(config, num, msg) {
  try {
    const numLimpio = String(num).startsWith('+') ? String(num) : '+' + String(num).replace(/\D/g, '');
    const res = UrlFetchApp.fetch('https://whatsapp-server-production-65d9.up.railway.app/send', {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'x-api-token': 'staff21x2026'
      },
      payload: JSON.stringify({phone: numLimpio, message: msg}),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code !== 200) {
      Logger.log('ERROR WSP Server [' + numLimpio + ']: HTTP ' + code + ' | ' + res.getContentText().substring(0, 400));
      return false;
    }
    Logger.log('WSP Server OK [' + numLimpio + ']');
    return true;
  } catch (e) {
    Logger.log('Error WSP Server: ' + e);
    return false;
  }
}

// FIX v4.2: Se agrega deadline:55 para que Apps Script espere
// hasta 55 s por la respuesta de OpenAI (el default era 10 s,
// insuficiente para GPT-4o con prompts largos).
// También se elimina el sleep innecesario tras el último intento.
function llamarIA(config, sys, user) {
  for (let intento = 0; intento <= 2; intento++) {
    try {
      const res = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", {
        method:  "post",
        headers: {
          "Authorization": "Bearer " + config.OPENAI_API_KEY,
          "Content-Type":  "application/json"
        },
        payload: JSON.stringify({
          model:       "gpt-4o-mini",
          messages:    [{role: "system", content: sys}, {role: "user", content: user}],
          temperature: 0.7,
          max_tokens:  1000
        }),
        muteHttpExceptions: true,
        deadline: 25  // v4.3: reducido de 55 → 25 s; falla rapido si hay problema real
      });
      if (res.getResponseCode() === 200) {
        return JSON.parse(res.getContentText()).choices[0].message.content;
      }
      Logger.log("OpenAI fallo: " + res.getResponseCode() + " | " + res.getContentText().substring(0, 300));
    } catch (e) {
      Logger.log("Error llamarIA intento " + intento + ": " + e);
    }
    // FIX: sleep solo si quedan más intentos (antes también dormía
    // 8 s después del tercer intento, sin ningún propósito).
    if (intento < 2) Utilities.sleep(2000 * Math.pow(2, intento));
  }
  return "Disculpa, problema tecnico momentaneo.";
}
// ============================================================
// LOGGING
// ============================================================
function registrarLog(ss, canal, contacto, texto, accion, resultado, error, extras) {
  try {
    let sheet = ss.getSheetByName("LogCompleto");
    if (!sheet) {
      sheet = ss.insertSheet("LogCompleto");
      sheet.appendRow(["Timestamp", "Canal", "Contacto", "Texto", "Accion", "Resultado", "Error", "Extras"]);
      sheet.getRange(1, 1, 1, 8).setBackground("#1a237e").setFontColor("#ffffff").setFontWeight("bold");
    }
    sheet.appendRow([
      new Date().toLocaleString("es-CL"),
      canal,
      contacto,
      texto     ? texto.substring(0, 300)                : "",
      accion,
      resultado ? resultado.toString().substring(0, 300) : "",
      error     || "",
      extras    || ""
    ]);
  } catch (e) {
    Logger.log("Error registrarLog: " + e);
  }
}
// ============================================================
// DIAGNOSTICO Y TEST
// ============================================================
function diagnosticar() {
  const config = getConfig();
  Logger.log("=== DIAGNOSTICO STAFF21X ===");
  Logger.log("OPENAI:     " + (config.OPENAI_API_KEY  ? "OK" : "FALTA"));
  Logger.log("WASSENGER:  " + (config.WASSENGER_TOKEN ? "OK" : "FALTA"));
  Logger.log("EMAIL:      " + (config.EMAIL_STAFF21X  ? "OK" : "FALTA"));
  Logger.log("LANDING:    " + (config.LANDING_OTEC    ? "OK" : "FALTA"));
  Logger.log("CALENDAR:   " + (config.CALENDAR_ID     ? "OK" : "FALTA"));
  Logger.log("SHEET ID:   " + config.SPREADSHEET_ID);
}
function testEnviarUno() {
  const config = getConfig();
  const ok = enviarWassenger(config, "+56952084228", "TEST Staff21x - Paz conectada correctamente.");
  Logger.log(ok ? "OK - mensaje enviado" : "ERROR - revisar token");
}
