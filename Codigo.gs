/**
 * TALLER DE TAZAS — Backend en Google Apps Script
 * Vinculado a la Google Sheet de pedidos (Extensiones > Apps Script).
 *
 *  - GET  ?action=catalog       → lista de productos leída desde la carpeta de Drive
 *  - GET  ?action=catalog&fresh=1 → igual, pero ignorando la caché
 *  - POST (JSON como text/plain) → registra un pedido en la hoja "Pedidos"
 *
 * Nombre de las fotos en Drive:  "Nombre del diseño_3500.jpg"
 *   → producto "Nombre del diseño" a $3.500
 *   Si no lleva precio, se usa DEFAULT_PRICE.
 *   Subcarpetas dentro de la carpeta de catálogo = categorías.
 *
 * Descripciones: un .txt, .md o Google Docs con el mismo nombre que la foto
 *   ("Gato astronauta.txt"). Uno llamado "descripcion" dentro de una subcarpeta
 *   describe esa categoría. Admite **negrita**, *cursiva* y listas con "- ".
 */

const CONFIG = {
  CATALOG_FOLDER_ID: '1pSr1GfUFDNqJjatdlYCVNpmUZXuAbvsP',
  ORDERS_FOLDER_ID:  '1cuKOlwFcVWMmhl4BWhmPavD8sES35b14',
  NOTIFY_EMAIL: '',      // tu correo para recibir aviso de cada pedido ('' = sin aviso)
  MIN_UNITS: 2,          // pedido mínimo (unidades en total)
  DEFAULT_PRICE: 3500,   // precio si el archivo no lo indica
  DEPOSIT_PCT: 50,       // % de abono por transferencia
  SHEET_NAME: 'Pedidos',
  CACHE_SECONDS: 600,    // el catálogo se refresca cada 10 min
  MAX_PHOTOS: 3,
  MAX_DESC: 1500         // largo máximo de cada descripción
};

const HEADERS = ['Fecha', 'Pedido', 'Nombre', 'Teléfono', 'Entrega', 'Detalle',
                 'Unidades', 'Total', 'Abono', 'Notas', 'Fotos', 'Estado'];
const ESTADOS = ['Pendiente de abono', 'Abonado', 'En producción', 'Listo', 'Entregado', 'Cancelado'];

/* ───────────── Rutas ───────────── */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (!p.action || p.action === 'catalog') {
      const cat = getCatalog_(p.fresh === '1');
      return json_({ ok: true, minUnits: CONFIG.MIN_UNITS, depositPct: CONFIG.DEPOSIT_PCT,
                     products: cat.products, categories: cat.categories });
    }
    return json_({ ok: false, error: 'Acción desconocida' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.website) return json_({ ok: true, id: 'T-0000' }); // trampa anti-bots

    const name = clean_(data.name, 80);
    const phone = clean_(data.phone, 30);
    const delivery = clean_(data.delivery, 80);
    const notes = clean_(data.notes, 600);
    if (!name || !phone || !delivery) throw new Error('Faltan nombre, teléfono o punto de entrega.');

    // Los precios se recalculan aquí: nunca se confía en lo que manda el navegador.
    const byId = {};
    getCatalog_(false).products.forEach(function (p) { byId[p.id] = p; });

    let units = 0, total = 0;
    const lines = [];
    (data.items || []).forEach(function (it) {
      const p = byId[it.id];
      const q = Math.floor(Number(it.qty));
      if (!p || !(q > 0) || q > 200) return;
      units += q;
      total += q * p.price;
      const note = clean_(it.note, 150);
      lines.push(q + ' × ' + p.name + ' ($' + fmt_(p.price) + ')' + (note ? ' — ' + note : ''));
    });
    if (!lines.length) throw new Error('El carrito está vacío o esos productos ya no están disponibles.');
    if (units < CONFIG.MIN_UNITS) throw new Error('El pedido mínimo es de ' + CONFIG.MIN_UNITS + ' unidades.');
    const deposit = Math.ceil(total * CONFIG.DEPOSIT_PCT / 100 / 100) * 100;

    lock.waitLock(20000);
    const props = PropertiesService.getScriptProperties();
    const n = Number(props.getProperty('ORDER_SEQ') || 0) + 1;
    props.setProperty('ORDER_SEQ', String(n));
    const id = 'T-' + String(n).padStart(4, '0');

    let photosUrl = '';
    const photos = (data.photos || []).slice(0, CONFIG.MAX_PHOTOS);
    if (photos.length) {
      const folder = DriveApp.getFolderById(CONFIG.ORDERS_FOLDER_ID).createFolder(id + ' · ' + name);
      photos.forEach(function (ph, i) {
        const m = String(ph || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
        if (!m) return;
        folder.createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], id + '_foto' + (i + 1) + '.jpg'));
      });
      photosUrl = folder.getUrl();
    }

    getSheet_().appendRow([new Date(), id, name, "'" + phone, delivery, lines.join('\n'),
                           units, total, deposit, notes, photosUrl, ESTADOS[0]]);
    lock.releaseLock();

    if (CONFIG.NOTIFY_EMAIL) {
      try {
        MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, 'Nuevo pedido ' + id + ' — $' + fmt_(total),
          [name + ' · ' + phone, 'Entrega: ' + delivery, '', lines.join('\n'), '',
           'Total: $' + fmt_(total) + '  ·  Abono: $' + fmt_(deposit),
           notes ? 'Notas: ' + notes : '', photosUrl ? 'Fotos: ' + photosUrl : ''].join('\n'));
      } catch (mailErr) { /* el pedido ya quedó guardado */ }
    }

    return json_({ ok: true, id: id, units: units, total: total, deposit: deposit });
  } catch (err) {
    try { lock.releaseLock(); } catch (_) {}
    return json_({ ok: false, error: String(err.message || err) });
  }
}

/* ───────────── Catálogo ───────────── */

function getCatalog_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const hit = cache.get('catalog_v2');
    if (hit) return JSON.parse(hit);
  }
  const products = [], categories = [];
  const root = DriveApp.getFolderById(CONFIG.CATALOG_FOLDER_ID);
  readFolder_(root, '', products);
  const subs = root.getFolders();
  while (subs.hasNext()) {
    const f = subs.next();
    const desc = readFolder_(f, f.getName(), products);
    categories.push({ name: f.getName(), desc: desc });
  }
  products.sort(function (a, b) {
    return (a.category || '').localeCompare(b.category || '', 'es') || a.name.localeCompare(b.name, 'es');
  });
  categories.sort(function (a, b) { return a.name.localeCompare(b.name, 'es'); });
  const out = { products: products, categories: categories };
  try { cache.put('catalog_v2', JSON.stringify(out), CONFIG.CACHE_SECONDS); } catch (_) {}
  return out;
}

/**
 * Lee una carpeta: imágenes = productos; archivos de texto con el mismo nombre = descripciones.
 * Textos aceptados: .txt, .md o un Google Docs. El precio en el nombre es opcional
 * ("Gato astronauta.txt" sirve para "Gato astronauta_3500.jpg").
 * Un texto llamado "descripcion" describe la categoría completa. Devuelve esa descripción.
 */
function readFolder_(folder, category, out) {
  const images = [], texts = {};
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (f.isTrashed()) continue;
    const mime = f.getMimeType();
    if (mime.indexOf('image/') === 0) images.push(f);
    else if (isText_(f, mime)) texts[parseName_(f.getName()).key] = f;
  }
  images.forEach(function (f) {
    const info = parseName_(f.getName());
    const tf = texts[info.key];
    out.push({
      id: f.getId(),
      name: info.name,
      price: info.price,
      category: category,
      desc: tf ? readText_(tf) : (f.getDescription() || '').slice(0, CONFIG.MAX_DESC),
      img: 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w800'
    });
  });
  const cat = texts['descripcion'] || texts['descripción'];
  return cat ? readText_(cat) : '';
}

function parseName_(fileName) {
  const base = fileName.replace(/\.(jpe?g|png|webp|gif|heic|txt|md|markdown)$/i, '');
  const m = base.match(/^(.*?)[\s_-]+\$?(\d{1,3}(?:[.,]?\d{3})*)$/);
  const name = (m ? m[1] : base).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return { name: name, key: name.toLowerCase(),
           price: m ? Number(m[2].replace(/[.,]/g, '')) : CONFIG.DEFAULT_PRICE };
}

function isText_(f, mime) {
  return mime === MimeType.GOOGLE_DOCS || mime.indexOf('text/') === 0 || /\.(txt|md|markdown)$/i.test(f.getName());
}

function readText_(f) {
  try {
    const t = f.getMimeType() === MimeType.GOOGLE_DOCS
      ? DocumentApp.openById(f.getId()).getBody().getText()
      : f.getBlob().getDataAsString('UTF-8');
    return t.replace(/^\uFEFF/, '').trim().slice(0, CONFIG.MAX_DESC);
  } catch (e) { return ''; }
}

/* ───────────── Configuración inicial ───────────── */

/** Ejecuta esta función UNA vez desde el editor (y de nuevo si una foto no se ve). */
function setup() {
  const sh = getSheet_();
  const root = DriveApp.getFolderById(CONFIG.CATALOG_FOLDER_ID);
  share_(root);
  DriveApp.getFolderById(CONFIG.ORDERS_FOLDER_ID); // verifica que el ID sea válido
  CacheService.getScriptCache().remove('catalog_v2');
  Logger.log('Listo. Hoja: ' + sh.getName() + ' · Productos: ' + getCatalog_(true).products.length);
}

function share_(folder) {
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const files = folder.getFiles();
  while (files.hasNext()) {
    files.next().setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }
  const subs = folder.getFolders();
  while (subs.hasNext()) share_(subs.next());
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#f1e9dc');
    sh.getRange('A:A').setNumberFormat('dd-mm-yyyy hh:mm');
    sh.getRange('H:I').setNumberFormat('$#,##0');
    sh.getRange('F:F').setWrap(true);
    sh.setColumnWidth(6, 320);
    sh.getRange(2, 12, 999, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(ESTADOS, true).build());
  }
  return sh;
}

/* ───────────── Utilidades ───────────── */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function clean_(v, max) {
  let s = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmulas inyectadas en la Sheet
  return s;
}

function fmt_(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
