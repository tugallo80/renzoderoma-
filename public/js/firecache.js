/**
 * Rubik OS — Caché automática de Realtime Database (localStorage) v4
 *
 * IMPORTANTE: Solo intercepta rutas de datos de usuario.
 * Las rutas internas de Firebase (.info/connected, etc.) se dejan pasar
 * sin tocar — interceptarlas rompe la conexión WebSocket del SDK.
 *
 * .on('value', cb)  — cache-first + refresco automático
 *   Firebase dispara el callback cada vez que el dato cambia, así que
 *   mostrar caché primero y sobreescribir con el valor real es seguro.
 *
 * .once('value', cb) callback style — stale-while-revalidate
 *   Llama al callback dos veces: 1) instantáneo con caché, 2) con Firebase.
 *   Si no hay caché, espera Firebase con timeout de 12s y muestra error.
 *
 * .once('value').then() Promise style — Firebase-first con fallback
 *   La Promise solo resuelve una vez, no se puede llamar dos veces.
 *   Espera Firebase hasta 15s; si no llega, usa caché o rechaza.
 */
(function () {
    if (window.__rubikFirecacheInstalled) return;
    window.__rubikFirecacheInstalled = true;

    var CACHE_PREFIX   = 'rubik_dbcache_';
    var MAX_BYTES      = 2 * 1024 * 1024; // 2 MB por entrada
    var CB_TIMEOUT_MS  = 12000;            // timeout callback-style sin caché
    var PR_TIMEOUT_MS  = 15000;            // timeout Promise-style sin caché

    function waitForFirebase(retries) {
        retries = retries || 0;
        if (!window.firebase || !window.firebase.database || !window.firebase.database.Reference) {
            if (retries > 100) return;
            return setTimeout(function () { waitForFirebase(retries + 1); }, 50);
        }
        try { installPatch(); } catch (e) { console.warn('[firecache] error instalando patch:', e); }
    }

    function pathFromRef(ref) {
        try {
            var u = String(ref);
            return u.replace(/^https?:\/\/[^/]+\/?/, '').replace(/\/+$/, '') || '_root';
        } catch (_) { return null; }
    }

    function shouldSkip(path) {
        // Rutas internas de Firebase: .info/connected, .info/serverTimeOffset, etc.
        // También rutas que empiecen con _ (convención interna)
        if (!path) return true;
        var first = path.charAt(0);
        return first === '.' || first === '_';
    }

    function readCache(key) {
        try {
            var s = localStorage.getItem(key);
            if (s !== null) return JSON.parse(s);
        } catch (e) {}
        return undefined; // undefined = sin entrada (null es valor válido de Firebase)
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

        var originalOn   = proto.on;
        var originalOnce = proto.once;

        // ── .on('value', callback) ─────────────────────────────────────────
        proto.on = function (eventType, callback) {
            if (eventType !== 'value' || typeof callback !== 'function') {
                return originalOn.apply(this, arguments);
            }
            var path = pathFromRef(this);
            if (shouldSkip(path)) return originalOn.apply(this, arguments);

            var storageKey = CACHE_PREFIX + path;
            var cached = readCache(storageKey);
            if (cached !== undefined) {
                // Mostrar caché al instante; Firebase llamará de nuevo con dato fresco
                setTimeout(function () {
                    try { callback(makeSnapshot(cached, null)); } catch (e) {}
                }, 0);
            }
            // Guardar en caché cada actualización de Firebase
            var wrapped = function (snap) {
                writeCache(storageKey, snap.val());
                return callback.apply(this, arguments);
            };
            var newArgs = Array.prototype.slice.call(arguments);
            newArgs[1] = wrapped;
            return originalOn.apply(this, newArgs);
        };

        // ── .once('value') ─────────────────────────────────────────────────
        proto.once = function (eventType, callback, onError) {
            if (eventType !== 'value') {
                return originalOnce.apply(this, arguments);
            }
            var path = pathFromRef(this);
            if (shouldSkip(path)) return originalOnce.apply(this, arguments);

            var storageKey = CACHE_PREFIX + path;
            var self = this;

            // Fetch real de Firebase — siempre guarda en caché al llegar
            var firebasePromise = originalOnce.call(self, 'value').then(function (snap) {
                writeCache(storageKey, snap.val());
                return snap;
            });

            if (typeof callback === 'function') {
                // ── Callback style: stale-while-revalidate ──────────────────
                var cached = readCache(storageKey);
                if (cached !== undefined) {
                    // 1) Render inmediato con caché
                    setTimeout(function () {
                        try { callback(makeSnapshot(cached, null)); } catch (e) {}
                    }, 0);
                    // 2) Render de nuevo cuando Firebase llega (dato fresco)
                    firebasePromise
                        .then(function (snap) { try { callback(snap); } catch (e) {} })
                        .catch(function () {}); // silencioso — ya mostramos caché
                } else {
                    // Sin caché: esperar Firebase; si no llega en tiempo, error visible
                    var cbTimer = setTimeout(function () {
                        if (typeof onError === 'function') {
                            onError(new Error('timeout esperando Firebase'));
                        }
                    }, CB_TIMEOUT_MS);
                    firebasePromise
                        .then(function (snap) {
                            clearTimeout(cbTimer);
                            try { callback(snap); } catch (e) {}
                        })
                        .catch(function (err) {
                            clearTimeout(cbTimer);
                            if (typeof onError === 'function') onError(err);
                        });
                }
                return firebasePromise;
            }

            // ── Promise style: Firebase-first, caché como fallback de timeout ─
            var timeoutPromise = new Promise(function (resolve, reject) {
                setTimeout(function () {
                    var cached = readCache(storageKey);
                    if (cached !== undefined) {
                        console.warn('[firecache] timeout — usando caché para:', path);
                        resolve(makeSnapshot(cached, null));
                    } else {
                        reject(new Error('[firecache] timeout y sin caché para: ' + path));
                    }
                }, PR_TIMEOUT_MS);
            });
            return Promise.race([firebasePromise, timeoutPromise]);
        };
    }

    // API pública
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
