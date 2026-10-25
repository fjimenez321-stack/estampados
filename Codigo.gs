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
  DEFAULT_PRICE: 4000,   // precio si el archivo no lo indica
  MIN_PRICE: 4000,       // ningún tazón baja de este precio, aunque el archivo diga menos
  DEPOSIT_PCT: 50,       // % de abono por transferencia
  SHEET_NAME: 'Pedidos',
  CACHE_SECONDS: 600,    // el catálogo se refresca cada 10 min
  MAX_PHOTOS: 6,
  // Seguridad y abuso
  MAX_BODY: 20000000,        // tamaño máximo de una solicitud (≈20 MB)
  MAX_IMG_BYTES: 4000000,    // tamaño máximo de cada imagen (≈4 MB)
  MAX_PER_PHONE_HOUR: 3,     // pedidos/solicitudes por teléfono en una hora
  MAX_PER_HOUR: 40,          // pedidos/solicitudes en total en una hora
  RETENTION_DAYS: 90,        // las fotos de clientes se borran después de estos días
  EXTRA_ELEMENT: 1000,   // recargo por tazón con más de una foto o frase
  CUSTOM_PRICE: 5000,    // Taller: diseño desde cero, precio base por tazón (referencial)
  MAX_REF_PHOTOS: 4,     // Taller: fotos de referencia por solicitud
  MAX_DESC: 1500,
  MAX_IMAGES: 10,        // fotos máximas por producto        // largo máximo de cada descripción
  // Tipos de tazón que el cliente elige en el carrito (extra = recargo por unidad)
  VARIANTS: [
    { key: 'clasico', label: 'Clásico blanco 11 oz', extra: 0, size: 'tazón 11 oz', area: { w: 22, h: 8 } },
    { key: 'magico',  label: 'Mágico', extra: 2000, size: 'tazón mágico 11 oz', area: { w: 22, h: 8 },
      hint: 'Tazón mágico: revela su diseño con el calor al servir una bebida caliente.' },
    { key: 'color',   label: 'Interior de color', extra: 2000, size: 'tazón de color 11 oz', area: { w: 22, h: 8 },
      hint: 'Por defecto los tazones son blancos. Con esta opción el interior y el asa van en color: rojo, amarillo o azul.' },
    { key: 'oz16',    label: 'Grande 16 oz', extra: 2000, size: 'tazón 16 oz',
      area: { w: 23, h: 9.5 } }   // ← confirma esta medida con tu plantilla de 16 oz
  ],
  COLORS: ['Rojo', 'Amarillo', 'Azul'],  // para "Interior de color"
  // Despacho a domicilio: solo para pedidos con productos desde HOME_MIN.
  // fee = costo del despacho a esa comuna. Agrega, quita o cambia comunas aquí.
  HOME_MIN: 10000,
  HOME_ZONES: [
    { name: 'Villa Alemana', fee: 2000 },
    { name: 'Quilpué',       fee: 2500 },
    { name: 'Viña del Mar',  fee: 3000 },
    { name: 'Valparaíso',    fee: 3500 },
    { name: 'Limache',       fee: 3500 }
  ],
  // Packs de precio fijo (aparecen primero en el catálogo). ivaPct: 0 si no cobras IVA.
  PACKS: [
    { id: 'pack:curso', name: 'Pack de curso', units: 30, price: 100000, ivaPct: 19,
      img: 'img/profe.webp',
      desc: '30 tazones clásicos personalizados, uno para cada estudiante o colega.\n\n' +
            '- Mismo diseño con el nombre de cada uno, o diseños distintos\n' +
            '- Ideal para fin de año, graduaciones y regalos de curso\n' +
            '- Envía la lista de nombres al hacer el pedido' }
  ]
};

const HEADERS = ['Fecha', 'Pedido', 'Nombre', 'Teléfono', 'Entrega', 'Detalle',
                 'Unidades', 'Total', 'Abono', 'Notas', 'Fotos', 'Estado'];
const ESTADOS = ['Pendiente de abono', 'Abonado', 'En producción', 'Listo', 'Entregado', 'Cancelado'];

/* Horarios de entrega en estaciones: se administran en la hoja "Horarios".
   Estación "Todas" = vale para cualquier estación que no tenga horarios propios.
   Al reservarse, el horario pasa a "Reservado" y desaparece del sitio hasta que
   lo vuelvas a poner en "Disponible". "Desactivado" lo oculta sin reservarlo. */
const SLOTS_SHEET = 'Horarios';
const SLOT_HEADERS = ['Estación', 'Día', 'Desde', 'Hasta', 'Estado', 'Pedido', 'Cliente'];
const SLOT_ESTADOS = ['Disponible', 'Reservado', 'Desactivado'];
const SLOT_SEED = [
  ['Todas', 'Martes', '16:00', '17:00'], ['Todas', 'Viernes', '16:00', '17:00'],
  ['Todas', 'Sábado', '08:00', '09:00'], ['Todas', 'Sábado', '09:00', '10:00'], ['Todas', 'Sábado', '10:00', '11:00'],
  ['Todas', 'Sábado', '11:00', '12:00'], ['Todas', 'Sábado', '12:00', '13:00'],
  ['Todas', 'Domingo', '08:00', '09:00'], ['Todas', 'Domingo', '09:00', '10:00'], ['Todas', 'Domingo', '10:00', '11:00'],
  ['Todas', 'Domingo', '11:00', '12:00'], ['Todas', 'Domingo', '12:00', '13:00'],
  ['Villa Alemana', 'Lunes', '16:00', '16:30'], ['Villa Alemana', 'Martes', '15:00', '16:00'],
  ['Villa Alemana', 'Miércoles', '17:00', '17:30'], ['Villa Alemana', 'Jueves', '16:00', '16:30'],
  ['Villa Alemana', 'Viernes', '15:00', '15:30']
];

/* ───────────── Rutas ───────────── */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (!p.action || p.action === 'catalog') {
      const cat = getCatalog_(p.fresh === '1');
      return json_({ ok: true, minUnits: CONFIG.MIN_UNITS, depositPct: CONFIG.DEPOSIT_PCT,
                     products: cat.products, categories: cat.categories,
                     variants: CONFIG.VARIANTS, colors: CONFIG.COLORS,
                     packs: CONFIG.PACKS, homeMin: CONFIG.HOME_MIN, homeZones: CONFIG.HOME_ZONES,
                     extraElement: CONFIG.EXTRA_ELEMENT, customPrice: CONFIG.CUSTOM_PRICE,
                     slots: readSlots_().filter(function (s) { return s.status !== 'Desactivado'; }).map(function (s) {
                       return { station: s.station, day: s.day, from: s.from, to: s.to, available: s.available };
                     }) });
    }
    return json_({ ok: false, error: 'Acción desconocida' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    if (e.postData.length > CONFIG.MAX_BODY) throw new Error('El pedido es demasiado grande. Prueba con menos fotos.');
    const data = JSON.parse(e.postData.contents);
    if (data.website) return json_({ ok: true, id: 'T-0000' }); // trampa anti-bots
    const prev = idemGet_(data.clientId);                       // reintento del mismo envío
    if (prev) return json_(prev);
    if (data.type === 'request') return json_(saveRequest_(data, lock));

    const name = clean_(data.name, 80);
    const phone = clean_(data.phone, 30);
    let delivery = clean_(data.delivery, 80);
    const isStation = /^Estación /.test(delivery);
    if (isStation && !data.slot) throw new Error('Elige un horario de entrega.');
    const notes = clean_(data.notes, 600);
    if (!name || !phone || !delivery) throw new Error('Faltan nombre, teléfono o punto de entrega.');
    throttle_(phone);

    // Los precios se recalculan aquí: nunca se confía en lo que manda el navegador.
    const byId = {};
    getCatalog_(false).products.forEach(function (p) { byId[p.id] = p; });

    let units = 0, total = 0;
    const lines = [];
    const packs = {};
    CONFIG.PACKS.forEach(function (pk) { packs[pk.id] = pk; });
    (data.items || []).forEach(function (it) {
      const q = Math.floor(Number(it.qty));
      const pk = packs[it.id];
      if (pk) {                                      // pack de precio fijo
        if (!(q > 0) || q > 20) return;
        const iva = Math.round(pk.price * (pk.ivaPct || 0) / 100);
        const note = clean_(it.note, 1500);
        units += q * pk.units;
        total += q * (pk.price + iva);
        lines.push(q + ' × ' + pk.name + ' (' + pk.units + ' tazones) ($' + fmt_(pk.price) +
                   (iva ? ' + IVA $' + fmt_(iva) : '') + ')' + (note ? ' — ' + note : ''));
        return;
      }
      const p = byId[it.id];
      if (!p || !(q > 0) || q > 200) return;
      const v = CONFIG.VARIANTS.filter(function (x) { return x.key === it.variant; })[0] || CONFIG.VARIANTS[0];
      const color = v.key === 'color' && CONFIG.COLORS.indexOf(it.color) >= 0 ? it.color : '';
      if (v.key === 'color' && !color) throw new Error('Elige el color del tazón "' + p.name + '".');
      const extra = it.extra ? CONFIG.EXTRA_ELEMENT : 0;
      const unit = p.price + v.extra + extra;
      units += q;
      total += q * unit;
      const note = clean_(it.note, 150);
      lines.push(q + ' × ' + p.name + ' [' + v.label + (color ? ' ' + color.toLowerCase() : '') +
                 (extra ? ' + más de una foto/frase' : '') + '] ($' + fmt_(unit) + ')' +
                 (note ? ' — ' + note : ''));
    });
    if (!lines.length) throw new Error('El carrito está vacío o esos productos ya no están disponibles.');
    if (units < CONFIG.MIN_UNITS) throw new Error('El pedido mínimo es de ' + CONFIG.MIN_UNITS + ' unidades.');

    // Despacho a domicilio: comuna válida, dirección y monto mínimo en productos
    if (/^Domicilio /.test(delivery)) {
      const comuna = delivery.replace(/^Domicilio /, '');
      const zone = (CONFIG.HOME_ZONES || []).filter(function (z) { return z.name === comuna; })[0];
      if (!zone) throw new Error('No hacemos despacho a esa comuna. Elige otra opción de entrega.');
      if (total < CONFIG.HOME_MIN)
        throw new Error('El despacho a domicilio es para pedidos desde $' + fmt_(CONFIG.HOME_MIN) + '.');
      const address = clean_(data.address, 150);
      if (address.length < 5) throw new Error('Escribe la dirección de despacho.');
      total += zone.fee;
      lines.push('Despacho a domicilio — ' + zone.name + ' ($' + fmt_(zone.fee) + ')');
      delivery = 'Domicilio ' + zone.name + ' · ' + address;
    }
    const deposit = Math.ceil(total * CONFIG.DEPOSIT_PCT / 100 / 100) * 100;

    lock.waitLock(20000);
    const dup = idemGet_(data.clientId);
    if (dup) { lock.releaseLock(); return json_(dup); }
    let slot = null;
    if (isStation) {
      slot = findSlot_(delivery.replace(/^Estación /, ''), String(data.slot));
      if (!slot) throw new Error('Ese horario ya no está disponible. Elige otro, por favor.');
      delivery = 'Estación ' + delivery.replace(/^Estación /, '') + ' · ' + slot.day + ' ' + slot.from + '–' + slot.to;
    }
    const props = PropertiesService.getScriptProperties();
    const n = Number(props.getProperty('ORDER_SEQ') || 0) + 1;
    props.setProperty('ORDER_SEQ', String(n));
    const id = 'T-' + String(n).padStart(4, '0');
    if (slot) getSlotsSheet_().getRange(slot.row, 5, 1, 3).setValues([['Reservado', id, name]]);

    let photosUrl = '';
    const photos = (data.photos || []).slice(0, CONFIG.MAX_PHOTOS);
    if (photos.length) {
      const folder = DriveApp.getFolderById(CONFIG.ORDERS_FOLDER_ID).createFolder(id + ' · ' + name);
      photos.forEach(function (ph, i) {
        const blob = imageBlob_(ph, id + '_foto' + (i + 1));
        if (blob) folder.createFile(blob);
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

    const res = { ok: true, id: id, units: units, total: total, deposit: deposit, delivery: delivery };
    idemPut_(data.clientId, res);
    countUse_(phone);
    return json_(res);
  } catch (err) {
    try { lock.releaseLock(); } catch (_) {}
    return json_({ ok: false, error: String(err.message || err) });
  }
}

/* ───────────── Catálogo ───────────── */

function getCatalog_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const hit = cache.get('catalog_v3');
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
  try { cache.put('catalog_v3', JSON.stringify(out), CONFIG.CACHE_SECONDS); } catch (_) {}
  return out;
}

/**
 * Lee una carpeta de categoría (o la raíz del catálogo).
 *  - Fotos sueltas: cada nombre es un producto. Varias fotos con el mismo nombre
 *    ("Gato_3500.jpg", "Gato_3500 (2).jpg", "Gato_3500 #3.jpg") se juntan en uno.
 *  - Subcarpetas (solo dentro de una categoría): cada una es un producto con todas
 *    sus fotos. Nombre y precio salen del nombre de la carpeta ("Gato astronauta_3500").
 *  - Textos (.txt, .md o Google Docs) con el mismo nombre = descripción.
 *    Uno llamado "descripcion" describe la categoría. Devuelve esa descripción.
 */
function readFolder_(folder, category, out) {
  const groups = {}, texts = {};
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (f.isTrashed()) continue;
    const mime = f.getMimeType();
    const info = parseName_(f.getName());
    if (mime.indexOf('image/') === 0) {
      (groups[info.key] = groups[info.key] || { info: info, files: [] }).files.push(f);
    } else if (isText_(f, mime)) texts[info.key] = f;
  }
  Object.keys(groups).forEach(function (key) {
    const g = groups[key];
    const imgs = sortFiles_(g.files);
    const tf = texts[key];
    out.push(product_('k:' + category + '/' + key, g.info, category, imgs,
                      tf ? readText_(tf) : (imgs[0].getDescription() || '').slice(0, CONFIG.MAX_DESC)));
  });

  if (category) {                                   // carpetas de producto dentro de la categoría
    const subs = folder.getFolders();
    while (subs.hasNext()) {
      const pf = subs.next();
      if (pf.isTrashed()) continue;
      const imgs = [], txt = [];
      const it = pf.getFiles();
      while (it.hasNext()) {
        const f = it.next();
        if (f.isTrashed()) continue;
        if (f.getMimeType().indexOf('image/') === 0) imgs.push(f);
        else if (isText_(f, f.getMimeType())) txt.push(f);
      }
      if (!imgs.length) continue;
      const desc = txt.length ? readText_(sortFiles_(txt)[0]) : (pf.getDescription() || '').slice(0, CONFIG.MAX_DESC);
      out.push(product_(pf.getId(), parseName_(pf.getName()), category, sortFiles_(imgs), desc));
    }
  }
  const cat = texts['descripcion'] || texts['descripción'];
  return cat ? readText_(cat) : '';
}

function product_(id, info, category, imgFiles, desc) {
  const urls = imgFiles.slice(0, CONFIG.MAX_IMAGES).map(function (f) {
    return 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w800';
  });
  return { id: id, name: info.name, price: info.price, category: category, desc: desc, img: urls[0], imgs: urls };
}

function sortFiles_(arr) {
  return arr.slice().sort(function (a, b) {
    return a.getName().localeCompare(b.getName(), 'es', { numeric: true });
  });
}

function parseName_(fileName) {
  const base = fileName.replace(/\.(jpe?g|png|webp|gif|heic|txt|md|markdown)$/i, '')
                       .replace(/\s*(\(\d+\)|#\d+)$/, '');          // "(2)" o "#2" = otra foto del mismo
  const m = base.match(/^(.*?)[\s_-]+\$?(\d{1,3}(?:[.,]?\d{3})*)$/);
  const name = (m ? m[1] : base).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return { name: name, key: name.toLowerCase(),
           price: Math.max(CONFIG.MIN_PRICE, m ? Number(m[2].replace(/[.,]/g, '')) : CONFIG.DEFAULT_PRICE) };
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

/* ───────────── Horarios ───────────── */

function readSlots_() {
  const sh = getSlotsSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 5).getDisplayValues().map(function (r, i) {
    return { row: i + 2, station: r[0].trim(), day: r[1].trim(), from: r[2].trim(), to: r[3].trim(),
             status: r[4].trim(), available: r[4].trim() === 'Disponible' };
  }).filter(function (s) { return s.station && s.day && s.from; });
}

/** Busca un horario libre para la estación. Si la estación tiene horarios propios, solo valen esos. */
function findSlot_(station, key) {
  const all = readSlots_();
  const own = all.some(function (s) { return s.station === station; });
  return all.filter(function (s) {
    return s.available && (own ? s.station === station : s.station === 'Todas') &&
           [s.station, s.day, s.from].join('|') === key;
  })[0] || null;
}

function getSlotsSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(SLOTS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SLOTS_SHEET);
    sh.getRange('C:D').setNumberFormat('@');              // horas como texto: "16:00"
    sh.getRange(1, 1, 1, SLOT_HEADERS.length).setValues([SLOT_HEADERS])
      .setFontWeight('bold').setBackground('#e5eafc');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, SLOT_SEED.length, 5).setValues(SLOT_SEED.map(function (r) { return r.concat('Disponible'); }));
    sh.getRange(2, 5, 999, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(SLOT_ESTADOS, true).build());
    const rules = [['Disponible', '#d9f2e4'], ['Reservado', '#fde2d6'], ['Desactivado', '#eeeeee']].map(function (c) {
      return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(c[0]).setBackground(c[1])
        .setRanges([sh.getRange('E2:E1000')]).build();
    });
    sh.setConditionalFormatRules(rules);
    sh.setColumnWidth(1, 130);
  }
  return sh;
}

/* ───────────── Taller: solicitudes de diseño desde cero ───────────── */

const REQ_SHEET = 'Solicitudes';
const REQ_HEADERS = ['Fecha', 'Solicitud', 'Nombre', 'Teléfono', 'Correo', 'Contactar por', 'Tipo de tazón',
                     'Cantidad', 'Para cuándo', 'Ocasión', 'Idea', 'Textos', 'Estimado', 'Archivos', 'Estado'];
const REQ_ESTADOS = ['Nueva', 'Propuesta enviada', 'Aprobada', 'Descartada'];

function saveRequest_(data, lock) {
  const name = clean_(data.name, 80), phone = clean_(data.phone, 30), email = clean_(data.email, 100);
  const idea = clean_(data.idea, 2000);
  if (!name || !phone) throw new Error('Faltan tu nombre o teléfono.');
  throttle_(phone);
  if (!idea && !data.sketch) throw new Error('Cuéntanos tu idea o arma un boceto.');
  const qty = Math.max(CONFIG.MIN_UNITS, Math.min(500, Math.floor(Number(data.qty)) || CONFIG.MIN_UNITS));
  const v = CONFIG.VARIANTS.filter(function (x) { return x.key === data.variant; })[0] || CONFIG.VARIANTS[0];
  const color = v.key === 'color' && CONFIG.COLORS.indexOf(data.color) >= 0 ? ' ' + data.color.toLowerCase() : '';
  const estimate = qty * (CONFIG.CUSTOM_PRICE + v.extra);

  lock.waitLock(20000);
  const dup = idemGet_(data.clientId);
  if (dup) { lock.releaseLock(); return dup; }
  const props = PropertiesService.getScriptProperties();
  const n = Number(props.getProperty('REQ_SEQ') || 0) + 1;
  props.setProperty('REQ_SEQ', String(n));
  const id = 'S-' + String(n).padStart(4, '0');

  let filesUrl = '';
  const imgs = [];
  if (data.sketch) imgs.push(['boceto', data.sketch]);
  (data.photos || []).slice(0, CONFIG.MAX_REF_PHOTOS).forEach(function (p, i) { imgs.push(['referencia' + (i + 1), p]); });
  const blobs = imgs.map(function (x) { return imageBlob_(x[1], id + '_' + x[0]); }).filter(Boolean);
  if (blobs.length) {
    const folder = DriveApp.getFolderById(CONFIG.ORDERS_FOLDER_ID).createFolder(id + ' · Taller · ' + name);
    blobs.forEach(function (b) { folder.createFile(b); });
    filesUrl = folder.getUrl();
  }
  getReqSheet_().appendRow([new Date(), id, name, "'" + phone, email, clean_(data.contact, 20) || 'WhatsApp',
    v.label + color + (v.area ? ' (' + v.area.w + '×' + v.area.h + ' cm)' : ''), qty, clean_(data.when, 40), clean_(data.occasion, 60), idea, clean_(data.texts, 500),
    estimate, filesUrl, REQ_ESTADOS[0]]);
  lock.releaseLock();

  if (CONFIG.NOTIFY_EMAIL) {
    try {
      MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, 'Taller: nueva solicitud ' + id,
        [name + ' · ' + phone + (email ? ' · ' + email : ''), qty + ' × ' + v.label + color,
         'Ocasión: ' + (data.occasion || '-') + ' · Para: ' + (data.when || '-'), '', idea,
         data.texts ? 'Textos: ' + data.texts : '', filesUrl ? 'Archivos: ' + filesUrl : ''].join('\n'));
    } catch (_) {}
  }
  const res = { ok: true, id: id, qty: qty, estimate: estimate };
  idemPut_(data.clientId, res);
  countUse_(phone);
  return res;
}

function getReqSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(REQ_SHEET);
  if (!sh) {
    sh = ss.insertSheet(REQ_SHEET);
    sh.getRange(1, 1, 1, REQ_HEADERS.length).setValues([REQ_HEADERS]).setFontWeight('bold').setBackground('#fde8dc');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('dd-mm-yyyy hh:mm');
    sh.getRange('M:M').setNumberFormat('$#,##0');
    sh.getRange('K:L').setWrap(true);
    sh.setColumnWidth(11, 320);
    sh.getRange(2, 15, 999, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(REQ_ESTADOS, true).build());
  }
  return sh;
}

/* ───────────── Configuración inicial ───────────── */

/** Ejecuta esta función UNA vez desde el editor (y de nuevo si una foto no se ve). */
function setup() {
  const sh = getSheet_();
  getSlotsSheet_();
  getReqSheet_();
  const root = DriveApp.getFolderById(CONFIG.CATALOG_FOLDER_ID);
  share_(root);
  DriveApp.getFolderById(CONFIG.ORDERS_FOLDER_ID); // verifica que el ID sea válido
  CacheService.getScriptCache().remove('catalog_v3');
  Logger.log('Listo. Planilla: ' + getSpreadsheet_().getUrl());
  Logger.log('Hoja: ' + sh.getName() + ' · Productos: ' + getCatalog_(true).products.length);
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

/**
 * Abre la Sheet de pedidos por su ID (guardado por setup). Cuando el sitio llama al
 * script no existe una hoja "activa", por eso no se puede usar getActiveSpreadsheet ahí.
 */
function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  let ss = SpreadsheetApp.getActiveSpreadsheet();          // existe al ejecutar desde el editor
  if (!ss) ss = SpreadsheetApp.create('Pedidos tazas');     // script independiente: crea una
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function getSheet_() {
  const ss = getSpreadsheet_();
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

/* ───────────── Seguridad ───────────── */

/** Idempotencia: el sitio manda un clientId por envío; si llega dos veces, se devuelve la misma respuesta. */
function idemKey_(id) { return /^[\w-]{8,64}$/.test(String(id || '')) ? 'idem:' + id : null; }
function idemGet_(id) {
  const k = idemKey_(id); if (!k) return null;
  const hit = CacheService.getScriptCache().get(k);
  return hit ? JSON.parse(hit) : null;
}
function idemPut_(id, res) {
  const k = idemKey_(id);
  if (k) CacheService.getScriptCache().put(k, JSON.stringify(res), 21600);   // 6 horas
}

/** Límite de envíos: por teléfono y en total, por hora. Evita pedidos falsos masivos y que un bot reserve todos los horarios. */
function phoneKey_(phone) {
  const d = String(phone).replace(/\D/g, '');
  if (d.length < 8 || d.length > 15) throw new Error('Escribe un teléfono válido.');
  return d.slice(-9);
}
function throttle_(phone) {
  const c = CacheService.getScriptCache(), p = phoneKey_(phone);
  if (Number(c.get('rl:p:' + p) || 0) >= CONFIG.MAX_PER_PHONE_HOUR)
    throw new Error('Ya recibimos varios pedidos desde este teléfono. Si necesitas otro, escríbenos por WhatsApp.');
  if (Number(c.get('rl:all') || 0) >= CONFIG.MAX_PER_HOUR)
    throw new Error('Estamos recibiendo muchos pedidos en este momento. Intenta en un rato más.');
}
function countUse_(phone) {
  const c = CacheService.getScriptCache(), p = 'rl:p:' + phoneKey_(phone);
  c.put(p, String(Number(c.get(p) || 0) + 1), 3600);
  c.put('rl:all', String(Number(c.get('rl:all') || 0) + 1), 3600);
}

/** Convierte una imagen enviada por el sitio en archivo, revisando tamaño y que realmente sea JPG, PNG o WEBP. */
function imageBlob_(dataUrl, baseName) {
  const m = String(dataUrl || '').match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+\/=]+)$/);
  if (!m || m[1].length > CONFIG.MAX_IMG_BYTES * 4 / 3) return null;
  const bytes = Utilities.base64Decode(m[1]);
  const b = function (i) { return (bytes[i] + 256) % 256; };
  let type = null, ext = '';
  if (b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF) { type = 'image/jpeg'; ext = '.jpg'; }
  else if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47) { type = 'image/png'; ext = '.png'; }
  else if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 &&
           b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) { type = 'image/webp'; ext = '.webp'; }
  return type ? Utilities.newBlob(bytes, type, baseName + ext) : null;
}

/** Envía a la papelera las carpetas de fotos de clientes con más de RETENTION_DAYS días. */
function limpiarFotosAntiguas() {
  const limit = Date.now() - CONFIG.RETENTION_DAYS * 86400000;
  const it = DriveApp.getFolderById(CONFIG.ORDERS_FOLDER_ID).getFolders();
  let n = 0;
  while (it.hasNext()) {
    const f = it.next();
    if (f.getDateCreated().getTime() < limit) { f.setTrashed(true); n++; }
  }
  Logger.log('Carpetas enviadas a la papelera: ' + n);
}

/** Ejecuta esta función UNA vez para que la limpieza corra sola cada día. */
function instalarLimpieza() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'limpiarFotosAntiguas') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('limpiarFotosAntiguas').timeBased().everyDays(1).atHour(4).create();
  Logger.log('Limpieza diaria instalada (' + CONFIG.RETENTION_DAYS + ' días).');
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
