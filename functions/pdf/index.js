/**
 * pdfPaginas — páginas de los PDF de los Requerimientos como imágenes + texto, para que Claude lea los planos por el
 * conector (leer_requerimiento) igual que las vistas del 3D.
 *
 * Renderizar un plano grande puede pasar de los 60 s que da Hosting, así que va en segundo plano:
 *   adjuntar (requerimientos/api.js) o leer_requerimiento (PDF viejo sin páginas) → encolar() → /pdf_cola/{id} y el
 *   adjunto queda con paginas_estado "procesando" → este trigger (2 GiB, 540 s) → Storage
 *   requerimientos/{req}/{adj}/pagina-{n}.jpg y pagina-{n}_claude.jpg → paginas_estado "listo" (o "error" con el motivo).
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Base y Storage que toca el trigger. */
const RUTAS = [/^requerimientos\/[A-Za-z0-9_-]+\/adjuntos\/[A-Za-z0-9_-]+(\/|$)/];
const ARCHIVOS = [/^requerimientos\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/pagina-\d{1,3}(_claude)?\.jpg$/];
const LECTURA = [/^requerimientos\/[^/]+\/[^/]+\/[^/]+$/];
/** Un pedido "procesando" más viejo que esto se considera cortado y se vuelve a encolar. */
const CORTADO_MS = 12 * 60000;

/** Deja el pedido en la cola (el almacén tiene que permitir pdf_cola y el adjunto). */
async function encolar(almacen, req, adj) {
    const ahora = almacen.ahora();
    await almacen.actualizar(`requerimientos/${req}/adjuntos/${adj}`, { paginas_estado: "procesando", paginas_pedido: ahora, paginas_error: null });
    await almacen.escribir(`pdf_cola/${almacen.nuevaClave()}`, { req, adj, fecha: ahora });
}
/** ¿Hay que (re)encolar este PDF? Sin páginas todavía, o un pedido que quedó colgado. */
function necesitaPaginas(a, ahora) {
    if (!a || a.tipo !== "pdf") return false;
    if (!a.paginas_estado) return true;
    return (a.paginas_estado === "procesando" || a.paginas_estado === "generando") && ahora - (a.paginas_pedido || 0) > CORTADO_MS;
}

/** Procesa un pedido. dep: { almacen, renderizar }. Nunca tira: deja el estado. */
async function procesar(dep, pedido) {
    const { almacen, renderizar } = dep;
    const p = pedido || {};
    if (!ID.test(String(p.req || "")) || !ID.test(String(p.adj || ""))) { console.warn("[pdfPaginas] pedido inválido"); return { fin: "invalido" }; }
    const ruta = `requerimientos/${p.req}/adjuntos/${p.adj}`;
    // solo uno lo procesa: procesando → generando con transacción
    // Ojo (Admin SDK): la primera pasada ve el valor LOCAL (vacío): ante null se devuelve null para que el servidor compare
    // y la reintente con el valor real; devolver undefined la cancelaba sin preguntar (el PDF quedaba "procesando").
    const t = await almacen.transaccion(`${ruta}/paginas_estado`, (v) => (v === "procesando" ? "generando" : v == null ? null : undefined));
    if (!t.ok || t.valor !== "generando") return { fin: "ya_procesado" };
    const meta = await almacen.leer(ruta);
    if (!meta || meta.tipo !== "pdf" || !meta.ruta) {
        await almacen.actualizar(ruta, { paginas_estado: "error", paginas_error: "el adjunto no es un PDF" }).catch(() => {});
        return { fin: "no_pdf" };
    }
    const t0 = Date.now();
    try {
        const buf = Buffer.from(await almacen.bajarArchivo(meta.ruta));
        const r = await renderizar(buf);
        const base = `requerimientos/${p.req}/${p.adj}`;
        const rutas = [], claude = [], textos = [];
        for (const pg of r.paginas) {
            const a = `${base}/pagina-${pg.n}.jpg`, c = `${base}/pagina-${pg.n}_claude.jpg`;
            await almacen.subirArchivo(a, pg.jpg, "image/jpeg");
            await almacen.subirArchivo(c, pg.claude, "image/jpeg");
            rutas.push(a); claude.push(c); textos.push(pg.texto || "");
        }
        const px = r.paginas.length ? `${r.paginas[0].ancho}×${r.paginas[0].alto}` : null;
        await almacen.actualizar(ruta, {
            paginas_estado: "listo", paginas_total: r.total, paginas_rutas: rutas, paginas_claude_rutas: claude,
            paginas_texto: textos.some((x) => x) ? textos : null, paginas_px: px, paginas_fin: almacen.ahora(), paginas_error: null,
        });
        console.log("[pdfPaginas]", p.req, p.adj, `${r.paginas.length}/${r.total} páginas`, `${Date.now() - t0} ms`);
        return { fin: "listo", paginas: r.paginas.length };
    } catch (e) {
        console.error("[pdfPaginas]", p.req, p.adj, e);
        const motivo = /password|encrypt/i.test(String(e && (e.name + e.message))) ? "el PDF tiene contraseña"
            : /Invalid PDF|FormatError|corrupt/i.test(String(e && (e.name + e.message))) ? "el PDF está dañado o no se puede leer"
            : "no se pudieron generar las páginas";
        await almacen.actualizar(ruta, { paginas_estado: "error", paginas_error: motivo, paginas_fin: almacen.ahora() }).catch(() => {});
        return { fin: "error", error: e.message };
    }
}

function crearTrigger() {
    const { onValueCreated } = require("firebase-functions/v2/database");
    return onValueCreated({ ref: "/pdf_cola/{id}", region: "us-central1", timeoutSeconds: 540, memory: "2GiB", concurrency: 1 }, async (event) => {
        const pedido = event.data.val() || {};
        await event.data.ref.remove();
        const admin = require("firebase-admin");
        const { crearAlmacen } = require("../agente/almacen");
        const { renderizar } = require("./paginas");
        await procesar({ almacen: crearAlmacen(admin, RUTAS, ARCHIVOS, LECTURA), renderizar }, pedido);
    });
}

module.exports = { crearTrigger, procesar, encolar, necesitaPaginas, RUTAS, ARCHIVOS, LECTURA, CORTADO_MS };
