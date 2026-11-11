/**
 * compartidos-3d.js — Archivos que llegan por "Compartir → Rubik" (Web Share Target) en Android.
 *
 * El service worker /compartir/sw-hub.js los guarda acá (IndexedDB) y la app los toma al abrir
 * "Importar 3D". Se borran apenas se leen, y los que quedan olvidados se borran a las 24 h.
 * Funciona igual en la página (window.Compartidos3D) y en el service worker (self.Compartidos3D).
 */
(function (g) {
    'use strict';
    var BASE = 'rubik-compartidos', ALMACEN = 'archivos', VENCE_MS = 24 * 3600 * 1000;

    function abrir() {
        return new Promise(function (ok, ko) {
            var r = indexedDB.open(BASE, 1);
            r.onupgradeneeded = function () { r.result.createObjectStore(ALMACEN, { keyPath: 'id' }); };
            r.onsuccess = function () { ok(r.result); };
            r.onerror = function () { ko(r.error); };
        });
    }
    function tx(modo, fn) {
        return abrir().then(function (db) {
            return new Promise(function (ok, ko) {
                var t = db.transaction(ALMACEN, modo), res;
                Promise.resolve(fn(t.objectStore(ALMACEN))).then(function (v) { res = v; });
                t.oncomplete = function () { db.close(); ok(res); };
                t.onerror = t.onabort = function () { db.close(); ko(t.error); };
            });
        });
    }
    function pedir(req) { return new Promise(function (ok, ko) { req.onsuccess = function () { ok(req.result); }; req.onerror = function () { ko(req.error); }; }); }

    /** Guarda un envío (lista de File/Blob con nombre). Devuelve su id. */
    function guardar(archivos, tipos) {
        var id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        var reg = {
            id: id, fecha: Date.now(),
            archivos: archivos.map(function (f, i) {
                return { nombre: f.name || 'archivo', tipo: f.type || '', detectado: (tipos && tipos[i]) || null, tamano: f.size || 0, datos: f };
            })
        };
        return tx('readwrite', function (st) { st.put(reg); }).then(function () { return id; });
    }

    /** Lista de envíos pendientes (sin los datos), del más nuevo al más viejo. Borra los vencidos. */
    function pendientes() {
        return tx('readwrite', function (st) {
            return pedir(st.getAll()).then(function (todos) {
                var vivos = [];
                todos.forEach(function (r) {
                    if (Date.now() - r.fecha > VENCE_MS) st.delete(r.id);
                    else vivos.push({
                        id: r.id, fecha: r.fecha, nombres: r.archivos.map(function (a) { return a.nombre; }),
                        detalle: r.archivos.map(function (a) { return { nombre: a.nombre, tipo: a.tipo, detectado: a.detectado || null, tamano: a.tamano || 0 }; })
                    });
                });
                return vivos.sort(function (a, b) { return b.fecha - a.fecha; });
            });
        });
    }

    /** Saca un envío: devuelve sus archivos como File y lo BORRA de IndexedDB. */
    function tomar(id) {
        return tx('readwrite', function (st) {
            return pedir(st.get(id)).then(function (r) {
                st.delete(id);
                if (!r) return [];
                return r.archivos.map(function (a) {
                    return new File([a.datos], a.nombre, { type: a.tipo || 'application/octet-stream' });
                });
            });
        });
    }

    function borrar(id) { return tx('readwrite', function (st) { st.delete(id); }); }

    g.Compartidos3D = { guardar: guardar, pendientes: pendientes, tomar: tomar, borrar: borrar };
})(typeof self !== 'undefined' ? self : window);
