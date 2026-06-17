/**
 * Rubik OS — Caché automática de Realtime Database (localStorage).
 *
 * Parchea tanto .on('value') como .once('value'):
 *
 * .on('value', cb):
 *   - Si hay caché: dispara callback inmediatamente con datos locales.
 *   - Firebase llega después y actualiza caché + vuelve a llamar callback.
 *
 * .once('value'):
 *   - Si hay caché: resuelve la Promise INMEDIATAMENTE con datos locales.
 *     En paralelo hace el fetch real a Firebase para refrescar la caché.
 *   - Si no hay caché: espera Firebase con timeout de 10s.
 *     Si Firebase tarda más de 10s → rechaza (el caller puede mostrar error).
 *
 * Limitaciones:
 *   - Entradas > 2 MB no se cachean (límite seguro para localStorage).
 *   - Solo cachea event 'value'. child_added/removed/etc. no se tocan.
 */
(function() {
    if (window.__rubikFirecacheInstalled) return;
    window.__rubikFirecacheInstalled = true;

    const CACHE_PREFIX = 'rubik_dbcache_';
    const MAX_BYTES    = 2 * 1024 * 1024; // 2 MB por entrada
    const ONCE_TIMEOUT = 10000;           // 10s antes de rechazar si no hay caché

    function waitForFirebase(retries) {
        retries = retries || 0;
        if (!window.firebase || !window.firebase.database || !window.firebase.database.Reference) {
            if (retries > 100) return;
            return setTimeout(function () { waitForFirebase(retries + 1); }, 50);
        }
        try { installPatch(); } catch (e) { console.warn('[firecache] no se pudo instalar:', e); }
    }

    function pathFromRef(ref) {
        try {
            const u = String(ref);
            return u.replace(/^https?:\/\/[^\/]+\/?/, '').replace(/\/+$/, '') || '_root';
        } catch (_) { return null; }
    }

    function readCache(storageKey) {
        try {
            const cached = localStorage.getItem(storageKey);
            if (cached !== null) return JSON.parse(cached);
        } catch (e) {}
        return undefined; // undefined = no hay caché (null es un valor válido de Firebase)
    }

    function writeCache(storageKey, value) {
        try {
            const str = JSON.stringify(value);
            if (str && str.length < MAX_BYTES) {
                localStorage.setItem(storageKey, str);
            } else {
                localStorage.removeItem(storageKey);
            }
        } catch (e) {
            try { localStorage.removeItem(storageKey); } catch (_) {}
        }
    }

    function makeSnapshot(value, key) {
        return {
            val:         function ()  { return value; },
            exists:      function ()  { return value !== null && value !== undefined && !(typeof value === 'object' && value !== null && Object.keys(value).length === 0); },
            numChildren: function ()  { return (value && typeof value === 'object') ? Object.keys(value).length : 0; },
            key: key || null,
            ref: null,
            forEach: function (cb) {
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    const keys = Object.keys(value);
                    for (let i = 0; i < keys.length; i++) {
                        if (cb(makeSnapshot(value[keys[i]], keys[i])) === true) break;
                    }
                }
            },
            child: function (path) {
                const parts = String(path).split('/').filter(Boolean);
                let v = value;
                for (let i = 0; i < parts.length && v != null; i++) {
                    v = (typeof v === 'object') ? v[parts[i]] : undefined;
                }
                return makeSnapshot(v, parts[parts.length - 1] || key);
            },
            hasChild: function (p) { return this.child(p).exists(); },
        };
    }

    function installPatch() {
        const proto = window.firebase.database.Reference.prototype;
        if (!proto || proto.__rubikFirecachePatched) return;
        proto.__rubikFirecachePatched = true;

        const originalOn   = proto.on;
        const originalOnce = proto.once;

        // ── .on('value', callback) ─────────────────────────────────────────
        proto.on = function (eventType, callback) {
            if (eventType !== 'value' || typeof callback !== 'function') {
                return originalOn.apply(this, arguments);
            }
            const path = pathFromRef(this);
            if (!path) return originalOn.apply(this, arguments);
            const storageKey = CACHE_PREFIX + path;

            // Render inmediato desde caché
            const cached = readCache(storageKey);
            if (cached !== undefined) {
                setTimeout(function () {
                    try { callback(makeSnapshot(cached, null)); } catch (e) {}
                }, 0);
            }

            // Wrap para actualizar caché con data fresca
            const wrapped = function (snap) {
                writeCache(storageKey, snap.val());
                return callback.apply(this, arguments);
            };
            const newArgs = Array.prototype.slice.call(arguments);
            newArgs[1] = wrapped;
            return originalOn.apply(this, newArgs);
        };

        // ── .once('value') ─────────────────────────────────────────────────
        proto.once = function (eventType, callback, onError) {
            if (eventType !== 'value') {
                return originalOnce.apply(this, arguments);
            }
            const path = pathFromRef(this);
            if (!path) return originalOnce.apply(this, arguments);
            const storageKey = CACHE_PREFIX + path;
            const self = this;

            const cached = readCache(storageKey);
            const hasCachedData = cached !== undefined;

            // Promise que actualiza la caché cuando Firebase responde
            const firebasePromise = originalOnce.call(self, 'value').then(function (snap) {
                writeCache(storageKey, snap.val());
                return snap;
            });

            let resultPromise;

            if (hasCachedData) {
                // Resolver INMEDIATAMENTE con caché; Firebase refresca en background
                resultPromise = Promise.resolve(makeSnapshot(cached, null));
                firebasePromise.catch(function () {}); // silenciar error de background
            } else {
                // Sin caché: esperar Firebase con timeout
                const timeoutPromise = new Promise(function (_, reject) {
                    setTimeout(function () {
                        reject(new Error('[firecache] timeout esperando Firebase (' + path + ')'));
                    }, ONCE_TIMEOUT);
                });
                resultPromise = Promise.race([firebasePromise, timeoutPromise]);
            }

            // Compatibilidad con forma callback: once('value', cb)
            if (typeof callback === 'function') {
                resultPromise
                    .then(function (snap) { callback(snap); })
                    .catch(function (err) { if (typeof onError === 'function') onError(err); });
            }

            return resultPromise;
        };
    }

    // API pública para limpiar caché manualmente
    window.rubikClearCache = function () {
        try {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.indexOf(CACHE_PREFIX) === 0) keys.push(k);
            }
            keys.forEach(function (k) { localStorage.removeItem(k); });
            console.log('[firecache] ' + keys.length + ' entradas borradas');
            return keys.length;
        } catch (e) { return 0; }
    };

    waitForFirebase();
})();
