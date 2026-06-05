/**
 * Service Worker para cliente-view.html
 * v2 — cliente-view.html NUNCA se cachea (siempre red fresca)
 * Solo se cachean assets estáticos (imágenes, manifest).
 */

const CACHE_NAME = 'rubik-cliente-v2';

// Solo assets estáticos — NUNCA el HTML
const PRECACHE = [
    '/rubik-icon.png',
    '/rubik_blanco.png',
    '/manifest-cliente.json',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return Promise.allSettled(PRECACHE.map(url => cache.add(url)));
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Eliminar TODOS los caches viejos (incluyendo v1)
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.origin !== location.origin) return;

    // cliente-view.html y sw-cliente.js: SIEMPRE desde red, nunca caché
    if (url.pathname.includes('cliente-view.html') || url.pathname.includes('sw-cliente.js')) {
        event.respondWith(
            fetch(event.request).catch(() => caches.match(event.request))
        );
        return;
    }

    // Assets estáticos: red primero, caché como fallback
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
