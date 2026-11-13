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

function verificarRuta(ruta, rutas = RUTAS_PERMITIDAS) {
    const r = limpiar(ruta);
    if (!r || r.split("/").some((s) => !s || /[.#$[\]]/.test(s))) throw new Error(`Ruta inválida: ${ruta}`);
    if (!rutas.some((re) => re.test(r))) throw new Error(`El agente no tiene acceso a ${r}`);
    return r;
}

const verificarRutaCon = (r, rutas) => verificarRuta(r, rutas);

/**
 * Vista acotada de un almacén: cada herramienta solo toca los nodos que le corresponden (además del cerco del almacén).
 */
function acotar(almacen, rutas) {
    const v = (r) => { verificarRuta(r, rutas); return r; };
    return Object.assign({}, almacen, {
        leer: async (r) => almacen.leer(v(r)),
        escribir: async (r, x) => almacen.escribir(v(r), x),
        actualizar: async (r, x) => almacen.actualizar(v(r), x),
        agregar: async (r, x) => almacen.agregar(v(r), x),
        borrar: async (r) => almacen.borrar(v(r)),
        transaccion: async (r, fn) => almacen.transaccion(v(r), fn),
    });
}

/** Carpetas de Storage que puede tocar cada almacén (por defecto, solo las del agente). */
const ARCHIVOS_AGENTE = [/^agente\/[^/]+\/[^/]+\/[^/]+/];

function verificarRutaArchivo(ruta, carpetas = ARCHIVOS_AGENTE) {
    const r = limpiar(ruta);
    if (!carpetas.some((re) => re.test(r)) || r.includes("..")) throw new Error(`Archivo fuera del agente: ${r}`);
    return r;
}

/**
 * Almacén real (firebase-admin). `rutas`: otra lista de rutas permitidas (la usa el conector MCP).
 * `archivos`: otras carpetas de Storage permitidas (Requerimientos, sesión 6).
 */
function crearAlmacen(admin, rutas = RUTAS_PERMITIDAS, archivos = ARCHIVOS_AGENTE) {
    const db = admin.database();
    const verificarRuta = (r) => verificarRutaCon(r, rutas);
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
            await bucket().file(verificarRutaArchivo(ruta, archivos)).save(buffer, { contentType: mime, resumable: false, metadata: { cacheControl: "private, max-age=0" } });
        },
        async bajarArchivo(ruta) {
            const [buf] = await bucket().file(verificarRutaArchivo(ruta, archivos)).download();
            return buf;
        },
        async borrarArchivo(ruta) {
            await bucket().file(verificarRutaArchivo(ruta, archivos)).delete({ ignoreNotFound: true });
        },
    };
}

module.exports = { crearAlmacen, acotar, verificarRuta, verificarRutaArchivo, RUTAS_PERMITIDAS, ARCHIVOS_AGENTE };
