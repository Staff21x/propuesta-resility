// ============================================================
// CRM Staff21x — Google Apps Script
// Instrucciones:
//   1. Abre script.google.com
//   2. Crea un nuevo proyecto
//   3. Pega TODO este código reemplazando lo que hay
//   4. Ejecuta la función initSheet() UNA sola vez
//   5. Despliega: Implementar > Nueva implementación
//      - Tipo: Aplicación web
//      - Ejecutar como: Yo
//      - Quién tiene acceso: Cualquier persona
//   6. Copia la URL y pégala en index.html donde dice:
//      const SCRIPT_URL = 'TU_URL_DE_APPS_SCRIPT_AQUI';
// ============================================================

const SPREADSHEET_ID = '1mLPZyP0hUu8Q3aqF-N8SGJNs1Oyj-RYio6TKIim47BM';
const SHEET_NAME = 'CRM';

// ---------- RUTAS ----------

function doGet(e) {
  const action = e.parameter.action;
  if (action === 'getContacts') return getContacts();
  return ContentService.createTextOutput('CRM API OK');
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'addContact')   return addContact(data);
    if (data.action === 'updateStatus') return updateStatus(data);
    if (data.action === 'sendEmail')    return sendEmailAction(data);
    return jsonResponse({ error: 'Acción no reconocida' });
  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}

// ---------- FUNCIONES ----------

function getContacts() {
  const sheet = getSheet();
  const rows  = sheet.getDataRange().getValues();
  // La fila 1 son cabeceras, se omite
  const contacts = rows.slice(1).map((row, i) => ({
    id:            i + 2,   // número de fila real en el sheet
    fecha:         row[0],
    nombre:        row[1],
    apellido:      row[2],
    correo:        row[3],
    whatsapp:      row[4],
    requerimiento: row[5],
    cotizacion:    row[6],
    estado:        row[7] || 'Pendiente'
  }));
  return jsonResponse({ contacts });
}

function addContact(data) {
  getSheet().appendRow([
    Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm'),
    data.nombre        || '',
    data.apellido      || '',
    data.correo        || '',
    data.whatsapp      || '',
    data.requerimiento || '',
    data.cotizacion    || '',
    data.estado        || 'Pendiente'
  ]);
  return jsonResponse({ success: true });
}

function updateStatus(data) {
  // Columna 8 = Estado
  getSheet().getRange(data.rowId, 8).setValue(data.estado);
  return jsonResponse({ success: true });
}

function sendEmailAction(data) {
  MailApp.sendEmail({
    to:      data.to,
    subject: data.subject,
    body:    data.body,
    replyTo: 'wbendezu@staff21x.com',
    name:    'Staff21x'
  });
  return jsonResponse({ success: true });
}

// ---------- INICIALIZAR HOJA ----------
// Ejecuta esta función UNA sola vez para crear las cabeceras
function initSheet() {
  const sheet = getSheet();
  if (sheet.getLastRow() === 0) {
    const headers = ['Fecha', 'Nombre', 'Apellido', 'Correo', 'WhatsApp', 'Requerimiento', 'Cotización', 'Estado'];
    sheet.appendRow(headers);
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange
      .setFontWeight('bold')
      .setBackground('#0f4c81')
      .setFontColor('white');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, headers.length, 140);
    SpreadsheetApp.flush();
  }
  Logger.log('Hoja inicializada correctamente.');
}

// ---------- HELPER ----------
function getSheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
