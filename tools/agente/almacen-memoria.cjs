// Almacén en memoria con la misma interfaz que functions/agente/almacen.js (y sus mismas rutas permitidas).
const { verificarRuta: verificarRutaBase, verificarRutaArchivo } = require("../../functions/agente/almacen.js");

function crearAlmacenMemoria(inicial, rutas, carpetas, soloLectura) {
    const verificarRuta = (r) => verificarRutaBase(r, rutas);
    const raiz = JSON.parse(JSON.stringify(inicial || {}));
    const archivos = new Map();
    let reloj = 1762900000000, n = 0;
    const partes = (r) => r.split("/");
    function get(r) { let o = raiz; for (const k of partes(r)) { if (o == null || typeof o !== "object") return null; o = o[k]; } return o === undefined ? null : o; }
    function set(r, v) {
        const ks = partes(r); let o = raiz;
        for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== "object") o[ks[i]] = {}; o = o[ks[i]]; }
        if (v === null || v === undefined) delete o[ks[ks.length - 1]];
        else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
    }
    const clave = () => "-K" + String(++n).padStart(6, "0");
    const a = {
        datos: raiz, archivos, escrituras: [],
        avanzar(ms) { reloj += ms; },
        async leer(r) { return JSON.parse(JSON.stringify(get(verificarRuta(r)))); },
        async escribir(r, v) { r = verificarRuta(r); a.escrituras.push(r); set(r, v); },
        async actualizar(r, v) { r = verificarRuta(r); a.escrituras.push(r); Object.keys(v).forEach((k) => set(r + "/" + k, v[k])); },
        async agregar(r, v) { r = verificarRuta(r); const k = clave(); a.escrituras.push(r + "/" + k); set(r + "/" + k, v); return k; },
        nuevaClave: clave,
        async borrar(r) { r = verificarRuta(r); set(r, null); },
        async transaccion(r, fn) {
            r = verificarRuta(r);
            const v = fn(JSON.parse(JSON.stringify(get(r))));
            if (v === undefined) return { ok: false, valor: get(r) };
            set(r, v); return { ok: true, valor: v };
        },
        ahora() { reloj += 1; return reloj; },
        async subirArchivo(r, buf, mime, op = {}) {
            const v = verificarRutaArchivo(r, carpetas); archivos.set(v, { buf: Buffer.from(buf), mime, token: op.token });
            return op.token ? `https://firebasestorage.googleapis.com/v0/b/bucket-de-prueba/o/${encodeURIComponent(v)}?alt=media&token=${op.token}` : undefined;
        },
        async bajarArchivo(r) { const f = archivos.get(verificarRutaArchivo(r, carpetas && soloLectura ? carpetas.concat(soloLectura) : carpetas)); if (!f) throw new Error("no existe " + r); return f.buf; },
        async borrarArchivo(r) { archivos.delete(verificarRutaArchivo(r, carpetas)); },
    };
    return a;
}
module.exports = { crearAlmacenMemoria };
