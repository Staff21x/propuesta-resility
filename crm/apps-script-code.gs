// ============================================================
// CRM Staff21x | Resility — Google Apps Script v2
//
// COLUMNAS EN EL SHEET (pestaña "CRM"):
//   A=Fecha  B=Empresa  C=Nombre  D=Apellido  E=Correo
//   F=WhatsApp  G=Requerimiento  H=Cotizacion  I=Estado  J=Archivo
//
// INSTRUCCIONES:
//   1. Abre script.google.com y crea un nuevo proyecto
//   2. Pega TODO este codigo reemplazando el contenido
//   3. Ejecuta initSheet() UNA sola vez (borra fila 1 antes si ya existe)
//   4. Implementar > Nueva implementacion > Aplicacion web
//      - Ejecutar como: Yo
//      - Quien tiene acceso: Cualquier persona
//   5. Copia la URL y pegala en index.html donde dice:
//      const SCRIPT_URL = 'TU_URL_DE_APPS_SCRIPT_AQUI';
// ============================================================

const SPREADSHEET_ID = '1mLPZyP0hUu8Q3aqF-N8SGJNs1Oyj-RYio6TKIim47BM';
const SHEET_NAME     = 'CRM';
const DRIVE_FOLDER   = 'CRM — Cotizaciones';

// ---------- RUTAS ----------

function doGet(e) {
  const action = e.parameter.action;
  if (action === 'getContacts') return getContacts();
  return ContentService.createTextOutput('CRM API v2 OK');
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'addContact')   return addContact(data);
    if (data.action === 'updateStatus') return updateStatus(data);
    if (data.action === 'sendEmail')    return sendEmailAction(data);
    return jsonResponse({ error: 'Accion no reconocida' });
  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}

// ---------- FUNCIONES ----------

function getContacts() {
  const rows = getSheet().getDataRange().getValues();
  const contacts = rows.slice(1).map((row, i) => ({
    id:            i + 2,
    fecha:         row[0],
    empresa:       row[1],
    nombre:        row[2],
    apellido:      row[3],
    correo:        row[4],
    whatsapp:      row[5],
    requerimiento: row[6],
    cotizacion:    row[7],
    estado:        row[8] || 'Pendiente',
    archivo:       row[9] || ''
  }));
  return jsonResponse({ contacts });
}

function addContact(data) {
  let archivoUrl = '';
  if (data.fileData) {
    archivoUrl = subirArchivoDrive(data);
  }
  getSheet().appendRow([
    Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm'),
    data.empresa        || '',
    data.nombre         || '',
    data.apellido       || '',
    data.correo         || '',
    data.whatsapp       || '',
    data.requerimiento  || '',
    data.cotizacion     || '',
    data.estado         || 'Pendiente',
    archivoUrl
  ]);
  return jsonResponse({ success: true });
}

function updateStatus(data) {
  // Estado = columna I = columna 9
  getSheet().getRange(data.rowId, 9).setValue(data.estado);
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

// ---------- GOOGLE DRIVE ----------

function subirArchivoDrive(data) {
  try {
    let folders = DriveApp.getFoldersByName(DRIVE_FOLDER);
    const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(DRIVE_FOLDER);
    const blob = Utilities.newBlob(
      Utilities.base64Decode(data.fileData),
      data.mimeType || 'application/octet-stream',
      data.fileName || 'archivo'
    );
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch(e) {
    Logger.log('Error Drive: ' + e);
    return '';
  }
}

// ---------- INICIALIZAR HOJA ----------
// Ejecuta esta funcion UNA sola vez.
// Si ya tienes datos en la fila 1, borrala primero manualmente.
function initSheet() {
  const sheet  = getSheet();
  const headers = ['Fecha','Empresa','Nombre','Apellido','Correo','WhatsApp','Requerimiento','Cotizacion','Estado','Archivo'];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  const rng = sheet.getRange(1, 1, 1, headers.length);
  rng.setFontWeight('bold').setBackground('#0f4c81').setFontColor('white');
  sheet.setFrozenRows(1);
  const widths = [120, 90, 110, 110, 170, 130, 230, 110, 110, 220];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  SpreadsheetApp.flush();
  Logger.log('Hoja inicializada. Columnas: ' + headers.join(', '));
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
