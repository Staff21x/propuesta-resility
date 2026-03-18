// ============================================================
// PAZ DE VENTAS - STAFF21X - TD-OTEC
// VERSION: v5.0 - Optimizado para velocidad
// CAMBIOS v5.0:
//   - Config singleton con CacheService (evita leer PropertiesService repetido)
//   - Spreadsheet singleton (openById una sola vez por ejecución)
//   - Calendar: 1 llamada getEvents() en vez de hasta 56 en loop
//   - Hoja Memoria: leída 1 vez y pasada como parámetro (antes se leía 2 veces)
//   - ENVIOS_WSP: leída 1 vez (antes se leía 2 veces en flujo de email)
//   - registrarLog: buffer en memoria → 1 appendRows al final (antes: N llamadas API)
//   - Batch setValue → setValues[] para updates multi-columna
//   - max_tokens 1000 → 400, temperature 0.7 → 0.3 (JSON estructurado)
//   - LockService en procesarCola (evita doble procesamiento por triggers solapados)
// ============================================================

// ============================================================
// SINGLETONS MODULE-LEVEL (persisten durante una ejecución)
// ============================================================
let _config = null;
let _ss     = null;
let _logBuffer = [];   // Buffer de logs para escritura batch al final

function getConfig() {
  if (_config) return _config;

  // Intentar desde CacheService primero (evita leer PropertiesService en ejecuciones frecuentes)
  const cache  = CacheService.getScriptCache();
  const cached = cache.get("paz_config_v1");
  if (cached) {
    _config = JSON.parse(cached);
    return _config;
  }

  // Leer TODAS las propiedades de una sola vez (una llamada API en vez de N)
  const props = PropertiesService.getScriptProperties().getProperties();
  _config = {
    OPENAI_API_KEY:  props["OPENAI_API_KEY"]  || "",
    WASSENGER_TOKEN: props["WASSENGER_TOKEN"] || "",
    EMAIL_STAFF21X:  props["EMAIL_STAFF21X"]  || "",
    LANDING_OTEC:    props["LANDING_OTEC"]    || "https://www.staff21x.com/otec",
    SPREADSHEET_ID:  "1Mc8eTZfhUWuU9BSbNOEJrg1zUmxzkvFAtgxuVOhzY84",
    CALENDAR_ID:     "primary",
    MAX_HISTORIAL:   3000
  };

  // Cachear 10 minutos (la config no cambia entre mensajes)
  try { cache.put("paz_config_v1", JSON.stringify(_config), 600); } catch(_) {}
  return _config;
}

/** Abre el Spreadsheet una sola vez por ejecución */
function getSpreadsheet() {
  if (!_ss) _ss = SpreadsheetApp.openById(getConfig().SPREADSHEET_ID);
  return _ss;
}

/** Invalida el cache de config (útil tras configurarKeys) */
function invalidarCache() {
  _config = null;
  _ss     = null;
  _logBuffer = [];
  try { CacheService.getScriptCache().remove("paz_config_v1"); } catch(_) {}
}

// ============================================================
// CONFIGURACION
// ============================================================
function configurarKeys() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty("OPENAI_API_KEY",  "");
  props.setProperty("WASSENGER_TOKEN", "");
  props.setProperty("EMAIL_STAFF21X",  "tu@email.com");
  props.setProperty("LANDING_OTEC",    "https://www.staff21x.com/otec");
  invalidarCache();
  Logger.log("Keys configuradas. Borra los valores y guarda.");
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
    encolarMensaje(numeroCliente, textoCliente);
    ScriptApp.newTrigger("procesarCola").timeBased().after(1000).create();
    return ContentService.createTextOutput(JSON.stringify({status: "queued"}));
  } catch (error) {
    Logger.log("ERROR doPost: " + error);
    return ContentService.createTextOutput(JSON.stringify({status: "error"}));
  }
}

// ============================================================
// COLA DE MENSAJES
// ============================================================
function encolarMensaje(numero, texto) {
  const ss   = getSpreadsheet();
  let   cola = ss.getSheetByName("Cola");
  if (!cola) {
    cola = ss.insertSheet("Cola");
    cola.appendRow(["Timestamp", "Numero", "Texto", "Estado"]);
    cola.getRange(1, 1, 1, 4).setBackground("#1a237e").setFontColor("#ffffff").setFontWeight("bold");
  }
  cola.appendRow([new Date().toISOString(), numero, texto, "PENDIENTE"]);
}

/**
 * Disparado por trigger ~1s después de doPost.
 * FIX v5.0: LockService evita que dos triggers solapados procesen el mismo mensaje.
 */
function procesarCola() {
  // Limpiar triggers huérfanos de procesarCola
  _limpiarTriggersProcesarCola();

  // FIX: LockService evita doble procesamiento si dos triggers se solapan
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log("procesarCola: no se pudo obtener lock, otra ejecución está procesando.");
    return;
  }

  try {
    const config = getConfig();
    const ss     = getSpreadsheet();
    const cola   = ss.getSheetByName("Cola");
    if (!cola) return;

    const datos = cola.getDataRange().getValues();
    for (let i = 1; i < datos.length; i++) {
      if (datos[i][3] !== "PENDIENTE") continue;
      const numero = String(datos[i][1]);
      const texto  = String(datos[i][2]);
      cola.getRange(i + 1, 4).setValue("EN_PROCESO");
      try {
        _procesarMensaje(ss, config, numero, texto);
        cola.getRange(i + 1, 4).setValue("OK");
      } catch (err) {
        Logger.log("ERROR procesarCola fila " + (i + 1) + ": " + err);
        cola.getRange(i + 1, 4).setValue("ERROR: " + String(err).substring(0, 200));
      }
    }
  } finally {
    // FIX: Volcar buffer de logs en una sola llamada API al finalizar
    _flushLogBuffer(getSpreadsheet());
    lock.releaseLock();
  }
}

function _limpiarTriggersProcesarCola() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "procesarCola") ScriptApp.deleteTrigger(t);
  });
}

// ============================================================
// PROCESAMIENTO REAL DEL MENSAJE
// ============================================================
function _procesarMensaje(ss, config, numeroCliente, textoCliente) {
  // 1. DETECTAR EMAIL EN EL MENSAJE
  const emailEnMensaje = detectarEmail(textoCliente);
  if (emailEnMensaje) {
    // FIX: obtenerYActualizarEmailEnListado lee ENVIOS_WSP una sola vez
    obtenerYActualizarEmailEnListado(ss, numeroCliente, emailEnMensaje);
    // FIX: guardarEmailEnMemoria recibe hoja ya abierta
    const sheetMem = obtenerOCrearHojaMemoria(ss);
    guardarEmailEnMemoria(sheetMem, config, numeroCliente, emailEnMensaje);
    _bufferLog("whatsapp", numeroCliente, textoCliente, "EMAIL_CAPTURADO", emailEnMensaje, null, null);
    const slotAgenda = obtenerProximoSlotDisponible(config);
    agendarEnCalendar(config, emailEnMensaje, numeroCliente, slotAgenda);
    enviarWassenger(config, numeroCliente,
      "Perfecto, agendé la demo para el " + slotAgenda.texto + ".\n" +
      "Te llega la invitacion a " + emailEnMensaje + ". Si no te sirve ese horario, dime cual te acomoda.");
    return;
  }

  // 2. DETECTAR INTENCION DE AGENDAR
  if (detectarIntencionAgendar(textoCliente)) {
    // FIX: obtenerYActualizarEmailEnListado retorna el email sin doble lectura
    const emailListado = _buscarEmailEnListado(ss, numeroCliente);
    if (emailListado) {
      _bufferLog("whatsapp", numeroCliente, textoCliente, "INTENTO_AGENDAR", emailListado, null, null);
      enviarWassenger(config, numeroCliente,
        "Tengo registrado este correo: *" + emailListado + "*\n" +
        "Es correcto para enviarte la invitacion?");
    } else {
      enviarWassenger(config, numeroCliente, "Para agendar necesito tu correo. Cual es?");
    }
    return;
  }

  // 3. CEREBRO METACOGNITIVO
  _bufferLog("whatsapp", numeroCliente, textoCliente, "CEREBRO_PROCESANDO", null, null, null);
  // FIX: Pasar sheetMem para que gestionarCerebroMetacognitivo y guardarEmailEnMemoria
  //      compartan la misma lectura de la hoja (antes se leía 2 veces)
  const sheetMem = obtenerOCrearHojaMemoria(ss);
  const resultado = gestionarCerebroMetacognitivo(sheetMem, config, textoCliente, numeroCliente);

  if (resultado.es_despedida) {
    _bufferLog("whatsapp", numeroCliente, textoCliente, "DESPEDIDA_DETECTADA", "SIN_RESPUESTA", null, null);
    return;
  }
  if (resultado.respuesta && resultado.respuesta.trim() !== "") {
    enviarWassenger(config, numeroCliente, resultado.respuesta);
  }
}

// ============================================================
// CEREBRO - PROCESA Y DECIDE
// FIX: recibe sheetMem para no leer la hoja Memoria dos veces
// ============================================================
function gestionarCerebroMetacognitivo(sheetMem, config, texto, id) {
  try {
    // FIX: Una sola lectura de Memoria (antes también la leía guardarEmailEnMemoria)
    const data = sheetMem.getDataRange().getValues();
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
RESPONDE SOLO EN JSON VALIDO, SIN TEXTO ADICIONAL, MAXIMO 350 TOKENS:
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
    if (esDespedida) return {es_despedida: true, respuesta: ""};

    const respuestaFinal = (proceso.respuesta_final || "").trim();
    const emocion        = (proceso.fase1 && proceso.fase1.emocion) ? proceso.fase1.emocion : "desconocida";
    const nuevoHist = (historial + "\nContacto: " + texto + "\nPaz: " + respuestaFinal)
                        .slice(-config.MAX_HISTORIAL);

    // FIX: Batch update - una sola llamada setValues en vez de 2 setValue separados
    if (fila !== -1) {
      sheetMem.getRange(fila, 4, 1, 2).setValues([[nuevoHist, new Date().toLocaleString("es-CL")]]);
    } else {
      sheetMem.appendRow([id, emailGuardado || "", "whatsapp", nuevoHist, new Date().toLocaleString("es-CL"), "", ""]);
    }

    _bufferLog("whatsapp", id, texto, "METACOG_OK", respuestaFinal, null,
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

/**
 * FIX CRÍTICO v5.0: Antes llamaba getEvents() hasta 56 veces en loop (una por slot).
 * Ahora hace UNA SOLA llamada para toda la ventana de búsqueda y filtra en memoria.
 * Ahorro estimado: 14.000 - 28.000 ms (evita timeouts de 30s).
 */
function obtenerProximoSlotDisponible(config) {
  try {
    const calendario = CalendarApp.getCalendarById(config.CALENDAR_ID) || CalendarApp.getDefaultCalendar();
    const ahora      = new Date();
    const finVentana = new Date(ahora);
    finVentana.setDate(ahora.getDate() + 8);

    // UNA SOLA llamada a Calendar API para toda la semana
    const todosEventos = calendario.getEvents(ahora, finVentana);

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

        // Filtrar en memoria: ¿algún evento existente se solapa con este slot?
        const ocupado = todosEventos.some(function(ev) {
          return ev.getStartTime() < fin && ev.getEndTime() > inicio;
        });
        if (!ocupado) {
          const opciones = {weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit"};
          return {inicio: inicio, fin: fin, texto: inicio.toLocaleDateString("es-CL", opciones)};
        }
      }
    }

    // Fallback: próximo lunes a las 10h
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
// FIX v5.0: Separado en dos funciones internas pero con una
// sola lectura de la hoja compartida entre ambas operaciones.
// ============================================================

/**
 * Solo busca el email (sin modificar la hoja).
 * Usado en el flujo de "intención de agendar".
 */
function _buscarEmailEnListado(ss, numero) {
  try {
    const hoja = ss.getSheetByName("ENVIOS_WSP");
    if (!hoja) return null;
    const datos     = hoja.getDataRange().getValues();
    const numLimpio = numero.replace(/\D/g, "");
    for (let i = 1; i < datos.length; i++) {
      const telFila = String(datos[i][2]).replace(/\D/g, "");
      if (telFila && numLimpio.endsWith(telFila.slice(-8))) return datos[i][6] || null;
    }
  } catch (e) {
    Logger.log("Error _buscarEmailEnListado: " + e);
  }
  return null;
}

/**
 * FIX: Lee ENVIOS_WSP UNA SOLA VEZ, obtiene el email Y actualiza en la misma pasada.
 * Antes: obtenerEmailDelListado leía la hoja + actualizarEmailEnListado la volvía a leer.
 */
function obtenerYActualizarEmailEnListado(ss, numero, emailNuevo) {
  try {
    const hoja = ss.getSheetByName("ENVIOS_WSP");
    if (!hoja) return null;
    const datos     = hoja.getDataRange().getValues();
    const numLimpio = numero.replace(/\D/g, "");
    for (let i = 1; i < datos.length; i++) {
      const telFila = String(datos[i][2]).replace(/\D/g, "");
      if (telFila && numLimpio.endsWith(telFila.slice(-8))) {
        if (emailNuevo) {
          hoja.getRange(i + 1, 7).setValue(emailNuevo);
          Logger.log("Email actualizado en listado: " + emailNuevo);
        }
        return datos[i][6] || emailNuevo || null;
      }
    }
  } catch (e) {
    Logger.log("Error obtenerYActualizarEmailEnListado: " + e);
  }
  return null;
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
  const ss     = getSpreadsheet();
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
      // FIX: Batch update de 2 columnas en una sola llamada
      hoja.getRange(i + 1, 6, 1, 3).setValues([["ENVIADO", datos[i][6] || "", new Date().toLocaleString("es-CL")]]);
      enviados++;
      _bufferLog("whatsapp", telefono, "Campaña saliente", "ENVIADO", nombre, null, region);
    } else {
      hoja.getRange(i + 1, 6).setValue("ERROR");
    }
    Utilities.sleep(4000);
  }

  // Volcar logs acumulados
  _flushLogBuffer(ss);
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

/**
 * FIX: Recibe el objeto sheet directamente (ya abierto por el caller).
 * Antes abría la hoja de nuevo, causando una segunda lectura innecesaria.
 */
function guardarEmailEnMemoria(sheetMem, config, id, email) {
  try {
    const data = sheetMem.getDataRange().getValues();
    let fila   = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == id) { fila = i + 1; break; }
    }
    if (fila !== -1) {
      // FIX: Batch update - 2 columnas en una sola llamada
      sheetMem.getRange(fila, 2, 1, 2).setValues([[email, "EMAIL_CONFIRMADO"]]);
    } else {
      sheetMem.appendRow([id, email, "whatsapp", "", new Date().toLocaleString("es-CL"), "EMAIL_CONFIRMADO", ""]);
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
    const numLimpio = num.startsWith('+') ? num : '+' + num.replace(/\D/g, '');
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
    Logger.log('WSP Server [' + numLimpio + ']: ' + code);
    return code === 200;
  } catch (e) {
    Logger.log('Error WSP Server: ' + e);
    return false;
  }
}

/**
 * FIX v5.0:
 *   - max_tokens 1000 → 400 (la respuesta JSON real es ~200-300 tokens)
 *   - temperature 0.7 → 0.3 (JSON estructurado necesita menos aleatoriedad)
 *   Esto reduce el tiempo de respuesta de OpenAI ~200-600ms en promedio.
 */
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
          temperature: 0.3,   // FIX: era 0.7, JSON estructurado requiere menos aleatoriedad
          max_tokens:  400    // FIX: era 1000, la respuesta JSON real es ~200-300 tokens
        }),
        muteHttpExceptions: true,
        deadline: 55
      });
      if (res.getResponseCode() === 200) {
        return JSON.parse(res.getContentText()).choices[0].message.content;
      }
      Logger.log("OpenAI fallo: " + res.getResponseCode() + " | " + res.getContentText().substring(0, 300));
    } catch (e) {
      Logger.log("Error llamarIA intento " + intento + ": " + e);
    }
    if (intento < 2) Utilities.sleep(2000 * Math.pow(2, intento));
  }
  return "Disculpa, problema tecnico momentaneo.";
}

// ============================================================
// LOGGING BUFFERIZADO
// FIX v5.0: En vez de N llamadas appendRow (una por log), acumulamos
// en _logBuffer y hacemos UN SOLO appendRows al final de la ejecución.
// Esto elimina 5-10 llamadas API a Sheets por mensaje.
// ============================================================
function _bufferLog(canal, contacto, texto, accion, resultado, error, extras) {
  _logBuffer.push([
    new Date().toLocaleString("es-CL"),
    canal,
    contacto,
    texto     ? texto.substring(0, 300)                : "",
    accion,
    resultado ? resultado.toString().substring(0, 300) : "",
    error     || "",
    extras    || ""
  ]);
}

function _flushLogBuffer(ss) {
  if (_logBuffer.length === 0) return;
  try {
    let sheet = ss.getSheetByName("LogCompleto");
    if (!sheet) {
      sheet = ss.insertSheet("LogCompleto");
      sheet.appendRow(["Timestamp", "Canal", "Contacto", "Texto", "Accion", "Resultado", "Error", "Extras"]);
      sheet.getRange(1, 1, 1, 8).setBackground("#1a237e").setFontColor("#ffffff").setFontWeight("bold");
    }
    // Una sola llamada para todas las filas pendientes
    sheet.getRange(sheet.getLastRow() + 1, 1, _logBuffer.length, 8).setValues(_logBuffer);
    _logBuffer = [];
  } catch (e) {
    Logger.log("Error _flushLogBuffer: " + e);
  }
}

// ============================================================
// DIAGNOSTICO Y TEST
// ============================================================
function diagnosticar() {
  const config = getConfig();
  Logger.log("=== DIAGNOSTICO STAFF21X v5.0 ===");
  Logger.log("OPENAI:     " + (config.OPENAI_API_KEY  ? "OK" : "FALTA"));
  Logger.log("WASSENGER:  " + (config.WASSENGER_TOKEN ? "OK" : "FALTA"));
  Logger.log("EMAIL:      " + (config.EMAIL_STAFF21X  ? "OK" : "FALTA"));
  Logger.log("LANDING:    " + (config.LANDING_OTEC    ? "OK" : "FALTA"));
  Logger.log("CALENDAR:   " + (config.CALENDAR_ID     ? "OK" : "FALTA"));
  Logger.log("SHEET ID:   " + config.SPREADSHEET_ID);
  Logger.log("TRIGGERS:   " + ScriptApp.getProjectTriggers().length + " activos");
}

function testEnviarUno() {
  const config = getConfig();
  const ok = enviarWassenger(config, "+56952084228", "TEST Staff21x - Paz v5.0 conectada correctamente.");
  Logger.log(ok ? "OK - mensaje enviado" : "ERROR - revisar token");
}
