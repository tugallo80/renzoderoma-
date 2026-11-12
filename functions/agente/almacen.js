/**
 * Acceso a RTDB y Storage para el agente, con una interfaz chica que las pruebas pueden simular
 * (tools/agente/almacen-memoria.js). El agente SOLO toca estas rutas:
 *   /proyectos/{cid}/{pid}/agente/...      conversación, estado, borrador, adjuntos, costos
 *   /base_datos/...                        lectura (y escritura solo con guardar_en_base confirmado)
 *   /agente_memoria/...  /agente_costos/...  /agente_cola/...  /config/agente
 *   Storage: agente/{cid}/{pid}/...
 */
const RUTAS_PERMITIDAS = [
    /^proyectos\/[^/]+\/[^/]+\/agente(\/|$)/,
    /^proyectos\/[^/]+\/[^/]+\/presupuesto(\/|$)/,   // solo lectura (recargos del presupuesto)
    /^base_datos(\/|$)/,
    /^agente_memoria(\/|$)/,
    /^agente_costos(\/|$)/,
    /^agente_cola(\/|$)/,
    /^config\/agente(\/|$)/,
];

function limpiar(ruta) { return String(ruta || "").replace(/^\/+|\/+$/g, ""); }

function verificarRuta(ruta) {
    const r = limpiar(ruta);
    if (!r || r.split("/").some((s) => !s || /[.#$[\]]/.test(s))) throw new Error(`Ruta inválida: ${ruta}`);
    if (!RUTAS_PERMITIDAS.some((re) => re.test(r))) throw new Error(`El agente no tiene acceso a ${r}`);
    return r;
}

function verificarRutaArchivo(ruta) {
    const r = limpiar(ruta);
    if (!/^agente\/[^/]+\/[^/]+\/[^/]+/.test(r) || r.includes("..")) throw new Error(`Archivo fuera del agente: ${r}`);
    return r;
}

/** Almacén real (firebase-admin). */
function crearAlmacen(admin) {
    const db = admin.database();
    const bucket = () => admin.storage().bucket();
    return {
        async leer(ruta) { return (await db.ref(verificarRuta(ruta)).once("value")).val(); },
        async escribir(ruta, valor) { await db.ref(verificarRuta(ruta)).set(valor); },
        async actualizar(ruta, valor) { await db.ref(verificarRuta(ruta)).update(valor); },
        async agregar(ruta, valor) { const ref = db.ref(verificarRuta(ruta)).push(); await ref.set(valor); return ref.key; },
        nuevaClave() { return db.ref().push().key; },
        async borrar(ruta) { await db.ref(verificarRuta(ruta)).remove(); },
        async transaccion(ruta, fn) {
            const r = await db.ref(verificarRuta(ruta)).transaction(fn);
            return { ok: r.committed, valor: r.snapshot.val() };
        },
        ahora() { return Date.now(); },
        async subirArchivo(ruta, buffer, mime) {
            await bucket().file(verificarRutaArchivo(ruta)).save(buffer, { contentType: mime, resumable: false, metadata: { cacheControl: "private, max-age=0" } });
        },
        async bajarArchivo(ruta) {
            const [buf] = await bucket().file(verificarRutaArchivo(ruta)).download();
            return buf;
        },
    };
}

module.exports = { crearAlmacen, verificarRuta, verificarRutaArchivo, RUTAS_PERMITIDAS };
