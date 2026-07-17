// Service worker: cache shella aplikacji (offline start). Żądania do /api zawsze z sieci.
const CACHE = 'wizytownik-v3';
const SHELL = ['./', './index.html', './style.css', './fonts.css', './app.js', './manifest.webmanifest',
  './logo.svg', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-192.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
  './fonts/archivo-100_900-latin.woff2', './fonts/archivo-100_900-latin-ext.woff2',
  './fonts/ibmplexmono-400-latin.woff2', './fonts/ibmplexmono-400-latin-ext.woff2',
  './fonts/ibmplexmono-500-latin.woff2', './fonts/ibmplexmono-500-latin-ext.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/')) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
