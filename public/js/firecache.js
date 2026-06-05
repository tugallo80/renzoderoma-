/**
 * Rubik OS — Caché automática de Realtime Database (localStorage).
 *
 * Cómo funciona:
 *   - La primera vez que se monta `db.ref(path).on('value', cb)`, si hay un valor
 *     en localStorage para ese path, lo renderizamos INMEDIATAMENTE (callback con
 *     snapshot fake). Esto hace que la página se vea con datos al instante.
 *   - Después se suscribe normal a Firebase. Cuando llega data fresca, se actualiza
 *     localStorage y se llama al callback otra vez (Firebase ya lo hace nativamente).
 *
 * Resultado: en redes lentas (4G) la página aparece "instantánea" con la última
 * data conocida, y se refresca en cuanto Firebase responde.
 *
 * Limitaciones:
 *   - Se cachea cada path entero. Si el árbol es > 2 MB, NO se cachea (límite de
 *     localStorage). Para esos casos el comportamiento es el original (sin caché).
 *   - Solo cachea listeners de 'value'. Listeners de 'child_added', etc. no se tocan.
 */
(function() {
    if (window.__rubikFirecacheInstalled) return;
    window.__rubikFirecacheInstalled = true;

    const CACHE_PREFIX = 'rubik_dbcache_';
    const MAX_BYTES = 2 * 1024 * 1024; // 2 MB por entrada

    function waitForFirebase(retries) {
        retries = retries || 0;
        if (!window.firebase || !window.firebase.database || !window.firebase.database.Reference) {
            if (retries > 100) return; // ~5s máx
            return setTimeout(function () { waitForFirebase(retries + 1); }, 50);
        }
        try { installPatch(); } catch (e) { console.warn('[firecache] no se pudo instalar:', e); }
    }

    function pathFromRef(ref) {
        try {
            const u = String(ref);
            // Quitar el dominio para quedarnos con el path
            return u.replace(/^https?:\/\/[^\/]+\/?/, '').replace(/\/+$/, '') || '_root';
        } catch (_) { return null; }
    }

    function makeSnapshot(value, key) {
        return {
            val: function () { return value; },
            exists: function () { return value !== null && value !== undefined && !(typeof value === 'object' && value !== null && Object.keys(value).length === 0); },
            forEach: function (cb) {
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    const keys = Object.keys(value);
                    for (let i = 0; i < keys.length; i++) {
                        const k = keys[i];
                        const v = value[k];
                        const childSnap = makeSnapshot(v, k);
                        if (cb(childSnap) === true) break;
                    }
                }
            },
            child: function (path) {
                const parts = String(path).split('/').filter(Boolean);
                let v = value;
                for (let i = 0; i < parts.length && v != null; i++) v = (typeof v === 'object') ? v[parts[i]] : undefined;
                return makeSnapshot(v, parts[parts.length - 1] || key);
            },
            hasChild: function (p) {
                const s = this.child(p);
                return s.exists();
            },
            numChildren: function () { return (value && typeof value === 'object') ? Object.keys(value).length : 0; },
            key: key || null,
            ref: null
        };
    }

    function installPatch() {
        const proto = window.firebase.database.Reference.prototype;
        if (!proto || proto.__rubikFirecachePatched) return;
        proto.__rubikFirecachePatched = true;

        const originalOn = proto.on;

        proto.on = function (eventType, callback) {
            // Si no es 'value' o no hay callback, comportamiento original
            if (eventType !== 'value' || typeof callback !== 'function') {
                return originalOn.apply(this, arguments);
            }

            const path = pathFromRef(this);
            if (!path) return originalOn.apply(this, arguments);
            const storageKey = CACHE_PREFIX + path;

            // 1) Render inmediato desde caché (asincrónico para no romper el flow del caller)
            try {
                const cached = localStorage.getItem(storageKey);
                if (cached !== null) {
                    const parsed = JSON.parse(cached);
                    setTimeout(function () {
                        try { callback(makeSnapshot(parsed, null)); } catch (e) { console.warn('[firecache] callback err:', e); }
                    }, 0);
                }
            } catch (e) { /* localStorage puede estar lleno o el JSON corrupto */ }

            // 2) Wrap callback original para guardar en caché cada update fresco
            const wrapped = function (snap) {
                try {
                    const v = snap.val();
                    const str = JSON.stringify(v);
                    if (str && str.length < MAX_BYTES) {
                        localStorage.setItem(storageKey, str);
                    } else {
                        // Demasiado grande — no cachear
                        localStorage.removeItem(storageKey);
                    }
                } catch (e) {
                    // Quota exceeded o algo — limpiamos esta entrada
                    try { localStorage.removeItem(storageKey); } catch (_) {}
                }
                return callback.apply(this, arguments);
            };

            // Reemplazar callback en argumentos originales y suscribirse
            const newArgs = Array.prototype.slice.call(arguments);
            newArgs[1] = wrapped;
            return originalOn.apply(this, newArgs);
        };
    }

    // API manual por si alguien quiere limpiar caché
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
