// Firebase falso en memoria para probar el chat del agente sin la base real (solo pruebas, datos inventados).
(function () {
    var datos = {}, oyentes = [], n = 0;
    function get(r) { var o = datos; r.split('/').filter(Boolean).forEach(function (k) { o = o == null ? null : o[k]; }); return o === undefined ? null : o; }
    function set(r, v) {
        var ks = r.split('/').filter(Boolean), o = datos;
        for (var i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
        if (v == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
        avisar(r);
    }
    function snap(r, key, v) {
        return { key: key, val: function () { return v == null ? null : JSON.parse(JSON.stringify(v)); },
            forEach: function (fn) { Object.keys(v || {}).sort().forEach(function (k) { fn(snap(r + '/' + k, k, v[k])); }); } };
    }
    function avisar(rutaCambio) {
        oyentes.forEach(function (o) {
            if (!(rutaCambio.indexOf(o.ruta) === 0 || o.ruta.indexOf(rutaCambio) === 0)) return;
            var v = get(o.ruta);
            if (o.ev === 'value') { o.fn(snap(o.ruta, o.ruta.split('/').pop(), v)); return; }
            var hijos = v || {};
            Object.keys(hijos).sort().forEach(function (k) {
                var txt = JSON.stringify(hijos[k]);
                if (o.vistos[k] === undefined && o.ev === 'child_added') { o.vistos[k] = txt; o.fn(snap(o.ruta + '/' + k, k, hijos[k])); }
                else if (o.vistos[k] !== undefined && o.vistos[k] !== txt && o.ev === 'child_changed') { o.vistos[k] = txt; o.fn(snap(o.ruta + '/' + k, k, hijos[k])); }
                else if (o.ev === 'child_changed' && o.vistos[k] === undefined) o.vistos[k] = txt;
            });
        });
    }
    function ref(r) {
        r = String(r || '').replace(/^\/+|\/+$/g, '');
        var o = {
            key: r.split('/').pop(),
            limitToLast: function () { return o; },
            child: function (k) { return ref(r + '/' + k); },
            on: function (ev, fn) { var l = { ruta: r, ev: ev, fn: fn, vistos: {} }; oyentes.push(l); setTimeout(function () { avisar(r); }, 0); return fn; },
            off: function (ev, fn) { oyentes = oyentes.filter(function (l) { return !(l.ruta === r && l.ev === ev && l.fn === fn); }); },
            once: function () { return Promise.resolve(snap(r, o.key, get(r))); },
            set: function (v) { set(r, v); return Promise.resolve(); },
            update: function (v) { Object.keys(v).forEach(function (k) { set(r + '/' + k, v[k] && v[k]['.sv'] ? Date.now() : v[k]); }); return Promise.resolve(); },
            push: function (v) { var k = '-F' + String(++n).padStart(6, '0'); if (v !== undefined) set(r + '/' + k, v); return ref(r + '/' + k); },
            remove: function () { set(r, null); return Promise.resolve(); },
            transaction: function (fn) { var v = fn(get(r)); if (v !== undefined) set(r, v); return Promise.resolve({ committed: v !== undefined, snapshot: snap(r, o.key, get(r)) }); }
        };
        return o;
    }
    var database = function () { return { ref: ref }; };
    database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
    window.firebase = {
        apps: [1], initializeApp: function () {}, database: database,
        auth: function () { return { currentUser: { uid: 'renzo', getIdToken: function () { return Promise.resolve('token-falso'); } } }; },
        storage: function () { return {}; }
    };
    window._fbFalso = { datos: datos, set: set, get: get, ref: ref };
})();
