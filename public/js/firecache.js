/**
 * Rubik OS — Caché automática de Realtime Database (localStorage) v5
 *
 * Solo parchea .on('value') — NO toca .once().
 * El patch de .once() causaba interferencia con la conexión WebSocket del SDK.
 *
 * .on('value', cb):
 *   Si hay caché en localStorage → dispara el callback inmediatamente con
 *   datos locales. Firebase llega después y actualiza caché + llama de nuevo.
 *   Resultado: páginas instantáneas en redes lentas.
 *
 * .once() no se toca — funciona como siempre directamente con Firebase.
 */
(function () {
    if (window.__rubikFirecacheInstalled) return;
    window.__rubikFirecacheInstalled = true;

    var CACHE_PREFIX = 'rubik_dbcache_';
    var MAX_BYTES    = 2 * 1024 * 1024;

    function waitForFirebase(retries) {
        retries = retries || 0;
        if (!window.firebase || !window.firebase.database || !window.firebase.database.Reference) {
            if (retries > 100) return;
            return setTimeout(function () { waitForFirebase(retries + 1); }, 50);
        }
        try { installPatch(); } catch (e) { console.warn('[firecache] error:', e); }
    }

    function pathFromRef(ref) {
        try {
            var u = String(ref);
            return u.replace(/^https?:\/\/[^/]+\/?/, '').replace(/\/+$/, '') || '_root';
        } catch (_) { return null; }
    }

    function shouldSkip(path) {
        if (!path) return true;
        var c = path.charAt(0);
        return c === '.' || c === '_';
    }

    function readCache(key) {
        try {
            var s = localStorage.getItem(key);
            if (s !== null) return JSON.parse(s);
        } catch (e) {}
        return undefined;
    }

    function writeCache(key, value) {
        try {
            var s = JSON.stringify(value);
            if (s && s.length < MAX_BYTES) { localStorage.setItem(key, s); }
            else { localStorage.removeItem(key); }
        } catch (e) { try { localStorage.removeItem(key); } catch (_) {} }
    }

    function makeSnapshot(value, key) {
        return {
            val:         function () { return value; },
            exists:      function () {
                return value !== null && value !== undefined &&
                    !(typeof value === 'object' && value !== null && Object.keys(value).length === 0);
            },
            numChildren: function () { return (value && typeof value === 'object') ? Object.keys(value).length : 0; },
            key: key || null,
            ref: null,
            forEach: function (cb) {
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    var keys = Object.keys(value);
                    for (var i = 0; i < keys.length; i++) {
                        if (cb(makeSnapshot(value[keys[i]], keys[i])) === true) break;
                    }
                }
            },
            child: function (childPath) {
                var parts = String(childPath).split('/').filter(Boolean);
                var v = value;
                for (var i = 0; i < parts.length && v != null; i++) {
                    v = (typeof v === 'object') ? v[parts[i]] : undefined;
                }
                return makeSnapshot(v, parts[parts.length - 1] || key);
            },
            hasChild: function (p) { return this.child(p).exists(); }
        };
    }

    function installPatch() {
        var proto = window.firebase.database.Reference.prototype;
        if (!proto || proto.__rubikFirecachePatched) return;
        proto.__rubikFirecachePatched = true;

        var originalOn  = proto.on;
        var originalOff = proto.off;

        // Map de callback-original → callback-wrapped por ref path
        // Necesario para que .off(event, originalCb) pueda quitar el wrapper correcto
        var wrapMap = {};  // { path: Map<originalCb, wrappedCb> }

        proto.on = function (eventType, callback) {
            if (eventType !== 'value' || typeof callback !== 'function') {
                return originalOn.apply(this, arguments);
            }
            var path = pathFromRef(this);
            if (shouldSkip(path)) return originalOn.apply(this, arguments);

            var storageKey = CACHE_PREFIX + path;
            var cached = readCache(storageKey);
            var cachedIsReal = cached !== undefined && cached !== null &&
                !(typeof cached === 'object' && Object.keys(cached).length === 0);
            if (cachedIsReal) {
                setTimeout(function () {
                    try { callback(makeSnapshot(cached, null)); } catch (e) {}
                }, 0);
            }
            var wrapped = function (snap) {
                var v = snap.val();
                var isReal = v !== null && v !== undefined &&
                    !(typeof v === 'object' && Object.keys(v).length === 0);
                if (isReal) writeCache(storageKey, v);
                return callback.apply(this, arguments);
            };
            // Registrar mapping original→wrapped para que .off() pueda resolverlo
            if (!wrapMap[path]) wrapMap[path] = new Map();
            wrapMap[path].set(callback, wrapped);

            var newArgs = Array.prototype.slice.call(arguments);
            newArgs[1] = wrapped;
            return originalOn.apply(this, newArgs);
        };

        // Parchear .off() para resolver el callback-wrapped correcto
        proto.off = function (eventType, callback) {
            if (eventType === 'value' && typeof callback === 'function') {
                var path = pathFromRef(this);
                if (!shouldSkip(path) && wrapMap[path]) {
                    var w = wrapMap[path].get(callback);
                    if (w) {
                        wrapMap[path].delete(callback);
                        var newArgs2 = Array.prototype.slice.call(arguments);
                        newArgs2[1] = w;
                        return originalOff.apply(this, newArgs2);
                    }
                }
            }
            return originalOff.apply(this, arguments);
        };
    }

    window.rubikClearCache = function () {
        try {
            var keys = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf(CACHE_PREFIX) === 0) keys.push(k);
            }
            keys.forEach(function (k) { localStorage.removeItem(k); });
            console.log('[firecache] ' + keys.length + ' entradas borradas');
            return keys.length;
        } catch (e) { return 0; }
    };

    waitForFirebase();
})();
