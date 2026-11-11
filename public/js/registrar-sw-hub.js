// Registra el service worker del hub SOLO para "Compartir → Rubik" (scope /compartir/).
// No cachea nada; ver /compartir/sw-hub.js. Va solo en páginas del hub (no en las de clientes).
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/compartir/sw-hub.js', { scope: '/compartir/' })
            .catch(function (e) { console.warn('[sw-hub] registro fallido:', e); });
    });
}
