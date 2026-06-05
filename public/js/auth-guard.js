/**
 * Rubik OS — Auth Guard
 *
 * Expone window.rubikAuthReady — Promise que resuelve con el usuario autenticado.
 * Estrategia: polling agresivo de auth.currentUser hasta que esté disponible,
 * con onAuthStateChanged como confirmación. Funciona con sesiones cacheadas.
 */
(function () {
    var _resolve, _reject;
    window.rubikAuthReady = new Promise(function (res, rej) {
        _resolve = res;
        _reject  = rej;
    });
    window.rubikUser = null;

    var path = location.pathname.toLowerCase();
    var EXEMPT = ['/login.html', '/cliente-view', '/proveedor-grafico', '/interno/', '/contratista/', '/404.html', '/juego-viborita', '/apu.html'];
    var isExempt = EXEMPT.some(function (p) { return path.indexOf(p) !== -1; });

    if (path === '/' || path === '') {
        location.replace('/login.html');
        return;
    }

    function redirect() {
        var target = encodeURIComponent(location.pathname + location.search);
        location.replace('/login.html?next=' + target);
    }

    var settled = false;

    function settle(user) {
        if (settled) return;
        settled = true;
        if (user) {
            window.rubikUser = user;
            _resolve(user);
        } else {
            _reject(new Error('No autenticado'));
            if (!isExempt) redirect();
        }
    }

    function start() {
        if (!window.firebase || typeof window.firebase.auth !== 'function') {
            // Firebase aún no cargó — esperar
            setTimeout(start, 50);
            return;
        }

        var auth = window.firebase.auth();

        // Suscribir a cambios de estado (principal mecanismo)
        auth.onAuthStateChanged(function (user) {
            settle(user);
            // Después del primer settle, seguir escuchando para detectar logout
            if (settled && !user && !isExempt) redirect();
        });

        // Polling agresivo de currentUser como fallback
        // (onAuthStateChanged a veces tarda con sesiones cacheadas en indexedDB)
        var polls = 0;
        var maxPolls = 60; // 3 segundos máximo
        var poller = setInterval(function () {
            polls++;
            if (settled) { clearInterval(poller); return; }
            var u = auth.currentUser;
            if (u) { clearInterval(poller); settle(u); return; }
            if (polls >= maxPolls) {
                clearInterval(poller);
                settle(null); // no hay usuario tras 3s → rechazar
            }
        }, 50);
    }

    start();
})();
