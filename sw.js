/* Té-tazas · service worker
   - La página: primero red (siempre lo último), y si no hay conexión, la copia guardada.
   - Imágenes del sitio: copia guardada primero.
   - Catálogo, pedidos y fotos de Drive (otros dominios): no se tocan, van siempre a la red.
   Al cambiar archivos del sitio, sube VERSION para renovar la copia. */
const VERSION = 'tetazas-v5';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  "./img/app-192.png",  "./img/app-512.png",  "./img/app-maskable-512.png",  "./img/apple-touch.png",  "./img/astronauta.webp",  "./img/blanca.webp",  "./img/bosque.webp",  "./img/cafe.webp",  "./img/calavera.webp",  "./img/ciudad.webp",  "./img/cumple.webp",  "./img/flores.webp",  "./img/futbol.webp",  "./img/galaxia.webp",  "./img/gamer.webp",  "./img/gato.webp",  "./img/gracias.webp",  "./img/ic-amor.webp",  "./img/ic-corazon.webp",  "./img/ic-gato.webp",  "./img/ic-hoja.webp",  "./img/ic-latido.webp",  "./img/ic-sonrisa.webp",  "./img/icono.png",  "./img/logo-pincel.webp",  "./img/logo.webp",  "./img/montanas.webp",  "./img/nieve.webp",  "./img/perro.webp",  "./img/playa.webp",  "./img/profe.webp",  "./img/teamo.webp",
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  if (req.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put('./index.html', copy));
      return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }

  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  })));
});
