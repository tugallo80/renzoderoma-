/**
 * sw-hub.js — Service worker MÍNIMO del hub, solo para "Compartir → Rubik" (Web Share Target, Android).
 *
 * Scope: /compartir/ (no choca con /sw-cliente.js, que es de la app de clientes).
 * Hace UNA sola cosa: recibe el POST de manifest.json → share_target (/compartir/recibir), guarda los
 * archivos en IndexedDB y redirige a /compartir/elegir.html. No cachea páginas ni assets: cualquier
 * otro pedido sigue a la red como si no hubiera service worker.
 */
importScripts('/js/compartidos-3d.js', '/js/lector-3d.js');

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function (event) {
    var url = new URL(event.request.url);
    if (event.request.method !== 'POST' || url.origin !== location.origin || url.pathname !== '/compartir/recibir') return;
    event.respondWith((async function () {
        try {
            var datos = await event.request.formData();
            var archivos = datos.getAll('archivos').filter(function (f) { return f && typeof f !== 'string' && f.size > 0; });
            if (!archivos.length) return Response.redirect('/compartir/elegir.html?error=vacio', 303);
            // Tipo por contenido (Drive/WhatsApp mandan sin extensión): para avisar en la pantalla si no es 3D/PDF/ZIP
            var tipos = [];
            for (var i = 0; i < archivos.length; i++) {
                try { tipos.push(self.Lector3D.detectarTipo(archivos[i].name, archivos[i].type, new Uint8Array(await archivos[i].slice(0, 4096).arrayBuffer()))); }
                catch (e) { tipos.push(null); }
            }
            var id = await self.Compartidos3D.guardar(archivos, tipos);
            return Response.redirect('/compartir/elegir.html?id=' + encodeURIComponent(id), 303);
        } catch (e) {
            return Response.redirect('/compartir/elegir.html?error=' + encodeURIComponent(String(e && e.message || e).slice(0, 120)), 303);
        }
    })());
});
