/**
 * renderTurno — render con Gemini para los Requerimientos (sesión 6, entrega 5; docs/sesiones/06-render-requerimiento.md).
 *
 * El conector (rubikMcp, detrás de Hosting, que corta a los 60 s y sin secretos) deja el pedido en /render_cola/{rid} y el
 * estado en /requerimientos/{req}/renders/{rid} (en_proceso). Este trigger (secreto de Gemini, 300 s, 1 GiB):
 *   revisa la lista blanca → baja las referencias → Gemini (modelo fijo, gemini.js) → JPEG grande + copia chica (sharp)
 *   → Storage requerimientos/{req}/renders/{rid}.jpg y _claude.jpg → estado listo (o error con el motivo).
 * Si claude.ai se corta, el render igual termina y queda guardado (ver_render lo devuelve).
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Base y Storage que toca renderTurno. */
const RUTAS = [/^requerimientos\/[A-Za-z0-9_-]+\/renders(\/|$)/];
const ARCHIVOS = [/^requerimientos\/[A-Za-z0-9_-]+\/renders\/[A-Za-z0-9_-]+(_claude)?\.jpg$/];
const LECTURA = [/^requerimientos\/[^/]+\/[^/]+\/[^/]+$/];

/** Procesa un pedido de la cola. dep: { almacen, esHub, gemini (gemini.js) }. Nunca tira: deja el estado. */
async function procesar(dep, pedido) {
    const { almacen, esHub, gemini } = dep;
    const p = pedido || {};
    if (!ID.test(String(p.req || "")) || !ID.test(String(p.rid || ""))) { console.warn("[renderTurno] pedido inválido"); return { fin: "invalido" }; }
    const ruta = `requerimientos/${p.req}/renders/${p.rid}`;
    const meta = await almacen.leer(ruta);
    if (!meta || meta.estado !== "en_proceso") return { fin: "ya_procesado" };
    if (!(await esHub(p.uid))) {
        await almacen.actualizar(ruta, { estado: "error", error: "el pedido no viene de una cuenta autorizada" });
        console.warn("[renderTurno] rechazado: uid fuera de la lista blanca");
        return { fin: "sin_acceso" };
    }
    await almacen.actualizar(ruta, { estado: "generando", inicio: almacen.ahora() });
    try {
        const refs = [];
        for (const r of (p.referencias || []).slice(0, 7)) refs.push({ buf: Buffer.from(await almacen.bajarArchivo(r.ruta)), mime: r.mime || "image/jpeg" });
        const g = await gemini.generar({ calidad: p.calidad, prompt: p.prompt, referencias: refs, aspecto: p.aspecto, tamano: p.tamano });
        const sal = await gemini.prepararSalidas(g.png);
        const img = `${ruta}.jpg`, chica = `${ruta}_claude.jpg`;
        await almacen.subirArchivo(img, sal.grande, "image/jpeg");
        await almacen.subirArchivo(chica, sal.chica, "image/jpeg");
        await almacen.actualizar(ruta, { estado: "listo", ruta: img, claude_ruta: chica, miniatura: sal.miniatura, modelo: g.modelo,
            ancho: sal.ancho, alto: sal.alto, nota_modelo: g.texto ? String(g.texto).slice(0, 500) : null, fin: almacen.ahora() });
        console.log("[renderTurno]", p.req, p.rid, g.modelo, p.tamano, refs.length, "refs");
        return { fin: "listo" };
    } catch (e) {
        const claro = e instanceof gemini.ErrorRender;
        if (!claro) console.error("[renderTurno]", p.req, p.rid, e);
        const sinSharp = !claro && /Cannot find module 'sharp'|sharp/i.test(String(e && e.message)) && /find module|load|install/i.test(String(e && e.message));
        const motivo = claro ? e.message : sinSharp ? "falta la librería sharp en el servidor (npm install en functions/)" : "error interno al generar el render";
        await almacen.actualizar(ruta, { estado: "error", error: motivo, fin: almacen.ahora() }).catch(() => {});
        return { fin: "error", error: e.message };
    }
}

let configurado = false;
function crearTrigger({ GEMINI_API_KEY, esHub }) {
    const { onValueCreated } = require("firebase-functions/v2/database");
    return onValueCreated({ ref: "/render_cola/{id}", region: "us-central1", secrets: [GEMINI_API_KEY], timeoutSeconds: 300, memory: "1GiB" }, async (event) => {
        const pedido = event.data.val() || {};
        await event.data.ref.remove();
        const admin = require("firebase-admin");
        const { crearAlmacen } = require("../agente/almacen");
        const gemini = require("./gemini");
        if (!configurado) { gemini.configurar({ clave: () => GEMINI_API_KEY.value() }); configurado = true; }   // una vez: conserva la caché de ListModels
        await procesar({ almacen: crearAlmacen(admin, RUTAS, ARCHIVOS, LECTURA), esHub, gemini }, pedido);
    });
}

module.exports = { crearTrigger, procesar, RUTAS, ARCHIVOS, LECTURA };
