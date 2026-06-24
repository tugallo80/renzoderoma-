/**
 * Rubik OS — Auth Guard
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
            setTimeout(start, 50);
            return;
        }

        var auth = window.firebase.auth();

        // onAuthStateChanged es el mecanismo PRINCIPAL — siempre resuelve la sesión
        var authEventCount = 0;
        auth.onAuthStateChanged(function (user) {
            authEventCount++;
            if (authEventCount === 1) {
                // Primer evento: resolver la sesión (puede traer user o null)
                settle(user);
            } else if (!user && !isExempt) {
                // Eventos posteriores: redirigir solo si sigue sin usuario tras 2s
                // (evita falsos positivos durante token refresh de Firebase)
                setTimeout(function () {
                    if (!firebase.auth().currentUser) redirect();
                }, 2000);
            }
        });

        // Polling de currentUser como FALLBACK para sesiones cacheadas en IndexedDB
        // (onAuthStateChanged puede tardar varios segundos en móvil)
        var polls = 0;
        var maxPolls = 200; // 10 segundos máximo
        var poller = setInterval(function () {
            polls++;
            if (settled) { clearInterval(poller); return; }
            var u = auth.currentUser;
            if (u) { clearInterval(poller); settle(u); return; }
            if (polls >= maxPolls) { clearInterval(poller); settle(null); }
        }, 50);
    }

    start();
})();
