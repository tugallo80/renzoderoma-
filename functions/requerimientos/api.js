/**
 * /api/requerimiento (requerimientoApi) — Requerimientos: el punto de partida de un proyecto (sesión 6,
 * docs/sesiones/06-render-requerimiento.md). El dueño carga lo que pidió el cliente SIN ejecutar ninguna IA; después
 * Claude lo toma por el conector (listar_requerimientos, leer_requerimiento, asignar_requerimiento…).
 *
 * Solo lista blanca hub (requireAuth). La base /requerimientos la escribe solo esta Function (las reglas no dejan
 * escribir desde el navegador) y los archivos van a Storage requerimientos/{id}/{adjunto}/…, que lee solo el servidor.
 *
 *   crear     {cliente?, descripcion?}                → {id}
 *   editar    {id, cliente?, descripcion?}
 *   adjuntar  {id, tipo: pdf|imagen|3d|otro, nombre, …} → {adj, meta}
 *             (imagen: datos, anotada?, anotaciones?, editor?, miniatura?, para_claude?, anotada_claude?)
 *   anotar    {id, adj, anotada, anotaciones, editor?, miniatura?, anotada_claude?}  (vuelve a anotar una foto ya subida; la original no cambia)
 * anotaciones = las del anotador del agente para Claude; editor = su estado, para volver a abrirlas y seguir editando.
 *   quitar    {id, adj}
 *   archivo   {id, adj, anotada?, vista?} o {id, render} → {meta, datos(base64)}
 *   descartar {id} · reabrir {id}
 * cliente: {cid} de un cliente existente o {nombre} de uno que todavía no está en la app (lo crea Claude al asignar).
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX = { pdf: 20 * 1024 * 1024, imagen: 5 * 1024 * 1024, medicion: 8 * 1024 * 1024, otro: 20 * 1024 * 1024, miniatura: 60 * 1024, claude: 200 * 1024 };
const MAX_ADJUNTOS = 40;
const ESTADOS = ["pendiente", "asignado", "cotizado", "descartado"];
/** Carpetas de Storage de esta Function (para crearAlmacen). */
const ARCHIVOS = [/^requerimientos\/[^/]+\/[^/]+\/[^/]+$/];
/** Nodos de la base que toca esta Function. */
const RUTAS = [/^requerimientos(\/|$)/, /^clientes\/[^/]+\/nombre$/];

class ErrorPedido extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }
const falla = (m, s) => { throw new ErrorPedido(m, s); };

function nombreSeguro(n) {
    return String(n || "archivo").normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(-80) || "archivo";
}
function b64(datos, max, que) {
    if (typeof datos !== "string" || !datos) falla(`Falta el contenido de ${que}.`);
    const buf = Buffer.from(datos, "base64");
    if (!buf.length) falla(`El contenido de ${que} está vacío.`);
    const tam = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
    if (buf.length > max) falla(`${que} pesa ${tam(buf.length)}; el máximo es ${tam(max)}.`, 413);
    return buf;
}
const esImagen = (buf) => (buf[0] === 0xff && buf[1] === 0xd8) || (buf[0] === 0x89 && buf[1] === 0x50) || (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP");
const mimeImagen = (buf) => (buf[0] === 0x89 ? "image/png" : buf[0] === 0xff ? "image/jpeg" : "image/webp");
const esJPEG = (buf) => buf[0] === 0xff && buf[1] === 0xd8;

/** Anotaciones del anotador del agente (cotas, marcas, notas): datos del dueño, con límite de tamaño. */
function limpiarAnotaciones(a) {
    if (a == null) return null;
    if (!Array.isArray(a)) falla("Las anotaciones tienen que ser una lista.");
    const txt = JSON.stringify(a.slice(0, 200));
    if (txt.length > 100000) falla("Demasiadas anotaciones.");
    return JSON.parse(txt);
}
/** Miniatura para la lista (data URL JPEG chica, la arma el navegador). */
function limpiarMiniatura(m) {
    if (m == null || m === "") return null;
    if (typeof m !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(m)) falla("Miniatura inválida.");
    if (m.length > MAX.miniatura * 4 / 3) falla("La miniatura es demasiado grande.");
    return m;
}
function limpiarTexto(t, max) { return String(t == null ? "" : t).replace(/\r\n/g, "\n").trim().slice(0, max); }

async function limpiarCliente(almacen, c) {
    if (c == null) return null;
    if (typeof c !== "object" || Array.isArray(c)) falla("Cliente inválido.");
    if (c.cid) {
        if (!ID.test(String(c.cid))) falla("Cliente inválido.");
        const nombre = await almacen.leer(`clientes/${c.cid}/nombre`);
        if (nombre == null) falla(`No existe el cliente ${c.cid}.`);
        return { cid: c.cid, nombre: String(nombre).slice(0, 120) };
    }
    const nombre = limpiarTexto(c.nombre, 120);
    return nombre ? { nombre, nuevo: true } : null;
}

async function leerReq(almacen, id, editable) {
    if (!ID.test(String(id || ""))) falla("Requerimiento inválido.");
    const r = await almacen.leer(`requerimientos/${id}`);
    if (!r) falla("No existe el requerimiento.", 404);
    if (editable && r.estado === "descartado") falla("El requerimiento está descartado: reabrilo para cambiarlo.", 409);
    return r;
}
/** Título para la lista: la primera línea de la descripción, cortada en una palabra (≤ 70). */
function titulo(desc, cliente) {
    let t = limpiarTexto(desc, 400).split("\n")[0].trim();
    if (t.length > 70) { const c = t.slice(0, 70); t = (c.lastIndexOf(" ") > 40 ? c.slice(0, c.lastIndexOf(" ")) : c).replace(/[\s,.;:–-]+$/, "") + "…"; }
    return t || (cliente && cliente.nombre ? `Pedido de ${cliente.nombre}` : "Requerimiento");
}

async function crear(almacen, b, uid) {
    const cliente = await limpiarCliente(almacen, b.cliente);
    const descripcion = limpiarTexto(b.descripcion, 20000);
    const id = almacen.nuevaClave();
    const ahora = almacen.ahora();
    await almacen.escribir(`requerimientos/${id}`, { estado: "pendiente", cliente, descripcion, titulo: titulo(descripcion, cliente), creado: ahora, actualizado: ahora, por: uid });
    return { ok: true, id };
}

async function editar(almacen, b) {
    const r = await leerReq(almacen, b.id, true);
    const cambios = { actualizado: almacen.ahora() };
    if (b.cliente !== undefined) cambios.cliente = await limpiarCliente(almacen, b.cliente);
    if (b.descripcion !== undefined) cambios.descripcion = limpiarTexto(b.descripcion, 20000);
    cambios.titulo = titulo(cambios.descripcion !== undefined ? cambios.descripcion : r.descripcion, cambios.cliente !== undefined ? cambios.cliente : r.cliente);
    await almacen.actualizar(`requerimientos/${b.id}`, cambios);
    return { ok: true };
}

async function adjuntar(almacen, b) {
    const r = await leerReq(almacen, b.id, true);
    if (Object.keys(r.adjuntos || {}).length >= MAX_ADJUNTOS) falla(`Máximo ${MAX_ADJUNTOS} adjuntos por requerimiento.`);
    const adj = almacen.nuevaClave();
    const base = `requerimientos/${b.id}/${adj}`;
    const meta = { nombre: limpiarTexto(b.nombre, 200) || "archivo", fecha: almacen.ahora() };
    const subidos = [];
    const subir = async (ruta, buf, mime) => { await almacen.subirArchivo(ruta, buf, mime); subidos.push(ruta); };
    try {
        if (b.tipo === "pdf") {
            const buf = b64(b.datos, MAX.pdf, "el PDF");
            if (buf.slice(0, 4).toString() !== "%PDF") falla("El archivo no es un PDF.");
            Object.assign(meta, { tipo: "pdf", mime: "application/pdf", bytes: buf.length, ruta: `${base}/${nombreSeguro(meta.nombre)}` });
            await subir(meta.ruta, buf, meta.mime);
        } else if (b.tipo === "imagen") {
            const buf = b64(b.datos, MAX.imagen, "la imagen");
            if (!esImagen(buf)) falla("La imagen tiene que ser JPG, PNG o WEBP.");
            Object.assign(meta, { tipo: "imagen", mime: mimeImagen(buf), bytes: buf.length });
            meta.ruta = `${base}/original.${meta.mime.split("/")[1]}`;
            await subir(meta.ruta, buf, meta.mime);
            if (b.anotada) {
                const an = b64(b.anotada, MAX.imagen, "la foto anotada");
                if (!esJPEG(an)) falla("La foto anotada tiene que ser JPG.");
                meta.anotada_ruta = `${base}/anotada.jpg`;
                await subir(meta.anotada_ruta, an, "image/jpeg");
            }
            // Copias chicas "para Claude" (las arma el navegador): el conector las devuelve como imagen sin pasarse del límite
            if (b.para_claude) {
                const pc = b64(b.para_claude, MAX.claude, "la copia para Claude");
                if (!esJPEG(pc)) falla("La copia para Claude tiene que ser JPG.");
                meta.claude_ruta = `${base}/claude.jpg`;
                await subir(meta.claude_ruta, pc, "image/jpeg");
            }
            if (b.anotada && b.anotada_claude) {
                const pc = b64(b.anotada_claude, MAX.claude, "la copia anotada para Claude");
                if (!esJPEG(pc)) falla("La copia anotada para Claude tiene que ser JPG.");
                meta.anotada_claude_ruta = `${base}/anotada_claude.jpg`;
                await subir(meta.anotada_claude_ruta, pc, "image/jpeg");
            }
            const anot = limpiarAnotaciones(b.anotaciones);
            if (anot && anot.length) { meta.anotaciones = anot; meta.anotaciones_editor = limpiarAnotaciones(b.editor); }
            if (b.ancho && b.alto) { meta.ancho = Math.round(Number(b.ancho)) || null; meta.alto = Math.round(Number(b.alto)) || null; }
        } else if (b.tipo === "3d") {
            const med = b.medicion;
            if (!med || typeof med !== "object" || !Array.isArray(med.piezas)) falla("Falta la medición del 3D (rubik/1).");
            const buf = Buffer.from(JSON.stringify(med), "utf8");
            if (buf.length > MAX.medicion) falla("La medición del 3D es demasiado grande.", 413);
            Object.assign(meta, { tipo: "3d", mime: "application/json", bytes: buf.length, medicion_ruta: `${base}/medicion.json` });
            meta.resumen = limpiarTexto(med.resumen || `${med.piezas.length} piezas`, 500);
            meta.piezas = med.piezas.length;
            if (Array.isArray(b.tamano_m) && b.tamano_m.length === 3 && b.tamano_m.every((x) => Number.isFinite(Number(x)))) meta.tamano_m = b.tamano_m.map(Number);
            if (b.unidad) meta.unidad = limpiarTexto(b.unidad, 80);
            await subir(meta.medicion_ruta, buf, "application/json");
            if (Array.isArray(b.vistas) && b.vistas.length) {
                meta.vistas_rutas = []; meta.vistas_nombres = [];
                for (let i = 0; i < Math.min(2, b.vistas.length); i++) {
                    const v = b.vistas[i] || {};
                    const img = b64(v.datos, 2 * 1024 * 1024, "la vista del 3D");
                    if (!esJPEG(img)) falla("La vista del 3D tiene que ser JPG.");
                    const ruta = `${base}/vista${i + 1}.jpg`;
                    await subir(ruta, img, "image/jpeg");
                    meta.vistas_rutas.push(ruta); meta.vistas_nombres.push(limpiarTexto(v.nombre, 40) || `vista ${i + 1}`);
                }
            }
        } else if (b.tipo === "otro") {
            // Cualquier otro archivo (DWG, Excel, Word…): se guarda tal cual, nunca se sirve como página.
            const buf = b64(b.datos, MAX.otro, "el archivo");
            Object.assign(meta, { tipo: "otro", mime: "application/octet-stream", bytes: buf.length, ruta: `${base}/${nombreSeguro(meta.nombre)}` });
            await subir(meta.ruta, buf, meta.mime);
        } else {
            falla("Tipo de adjunto no admitido (pdf, imagen, 3d u otro).");
        }
        const mini = limpiarMiniatura(b.miniatura);
        if (mini) meta.miniatura = mini;
        meta.orden = meta.fecha;
        await almacen.escribir(`requerimientos/${b.id}/adjuntos/${adj}`, meta);
        await almacen.actualizar(`requerimientos/${b.id}`, { actualizado: almacen.ahora() });
    } catch (e) {
        for (const ruta of subidos) await almacen.borrarArchivo(ruta).catch(() => {});
        throw e;
    }
    return { ok: true, adj, meta };
}

async function anotar(almacen, b) {
    await leerReq(almacen, b.id, true);
    if (!ID.test(String(b.adj || ""))) falla("Adjunto inválido.");
    const ruta = `requerimientos/${b.id}/adjuntos/${b.adj}`;
    const meta = await almacen.leer(ruta);
    if (!meta) falla("No existe el adjunto.", 404);
    if (meta.tipo !== "imagen") falla("Solo se anotan fotos.");
    const anot = limpiarAnotaciones(b.anotaciones) || [];
    const cambios = { anotaciones: anot.length ? anot : null, anotaciones_editor: anot.length ? limpiarAnotaciones(b.editor) : null, fecha_anotada: almacen.ahora() };
    if (anot.length) {
        const an = b64(b.anotada, MAX.imagen, "la foto anotada");
        if (!esJPEG(an)) falla("La foto anotada tiene que ser JPG.");
        cambios.anotada_ruta = `requerimientos/${b.id}/${b.adj}/anotada.jpg`;
        await almacen.subirArchivo(cambios.anotada_ruta, an, "image/jpeg");
        if (b.anotada_claude) {
            const pc = b64(b.anotada_claude, MAX.claude, "la copia anotada para Claude");
            if (!esJPEG(pc)) falla("La copia anotada para Claude tiene que ser JPG.");
            cambios.anotada_claude_ruta = `requerimientos/${b.id}/${b.adj}/anotada_claude.jpg`;
            await almacen.subirArchivo(cambios.anotada_claude_ruta, pc, "image/jpeg");
        }
    } else {
        for (const r of [meta.anotada_ruta, meta.anotada_claude_ruta]) if (r) await almacen.borrarArchivo(r).catch(() => {});
        cambios.anotada_ruta = null; cambios.anotada_claude_ruta = null;
    }
    const mini = limpiarMiniatura(b.miniatura);
    if (mini) cambios.miniatura = mini;
    await almacen.actualizar(ruta, cambios);
    await almacen.actualizar(`requerimientos/${b.id}`, { actualizado: almacen.ahora() });
    return { ok: true, anotaciones: anot.length };
}

function rutasDe(meta) {
    return [meta.ruta, meta.anotada_ruta, meta.claude_ruta, meta.anotada_claude_ruta, meta.medicion_ruta].concat(meta.vistas_rutas || []).filter(Boolean);
}

async function quitar(almacen, b) {
    await leerReq(almacen, b.id, true);
    if (!ID.test(String(b.adj || ""))) falla("Adjunto inválido.");
    const ruta = `requerimientos/${b.id}/adjuntos/${b.adj}`;
    const meta = await almacen.leer(ruta);
    if (!meta) falla("No existe el adjunto.", 404);
    for (const r of rutasDe(meta)) await almacen.borrarArchivo(r).catch(() => {});
    await almacen.borrar(ruta);
    await almacen.actualizar(`requerimientos/${b.id}`, { actualizado: almacen.ahora() });
    return { ok: true };
}

async function archivo(almacen, b) {
    const req = await leerReq(almacen, b.id, false);
    if (b.render != null) {
        // render generado por Claude (generar_render): se ve en la app
        if (!ID.test(String(b.render))) falla("Render inválido.");
        const ren = (req.renders || {})[b.render];
        if (!ren || !ren.ruta) falla("No existe el render.", 404);
        const buf = await almacen.bajarArchivo(ren.ruta);
        return { meta: { nombre: `render-${b.render}.jpg`, mime: "image/jpeg" }, datos: Buffer.from(buf).toString("base64") };
    }
    if (!ID.test(String(b.adj || ""))) falla("Adjunto inválido.");
    const meta = await almacen.leer(`requerimientos/${b.id}/adjuntos/${b.adj}`);
    if (!meta) falla("No existe el adjunto.", 404);
    const ruta = b.anotada ? meta.anotada_ruta : b.vista ? (meta.vistas_rutas || [])[Number(b.vista) - 1] : meta.ruta || meta.medicion_ruta;
    if (!ruta) falla("Ese adjunto no tiene ese archivo.", 404);
    const buf = await almacen.bajarArchivo(ruta);
    return { meta, datos: Buffer.from(buf).toString("base64") };
}

async function cambiarEstado(almacen, b, estado) {
    const r = await leerReq(almacen, b.id, false);
    if (estado === "pendiente" && r.estado !== "descartado") falla("Solo se reabre un requerimiento descartado.");
    if (!ESTADOS.includes(estado)) falla("Estado inválido.");
    // Al reabrir vuelve a como estaba antes de descartarlo
    const nuevo = estado === "pendiente" ? (r.estado_antes || (r.pid ? "asignado" : "pendiente")) : estado;
    await almacen.actualizar(`requerimientos/${b.id}`, { estado: nuevo, estado_antes: estado === "descartado" ? r.estado : null, actualizado: almacen.ahora() });
    return { ok: true, estado: nuevo };
}

/** Atiende un pedido ya autenticado (lista blanca hub). Devuelve {status, cuerpo}. */
async function atender(almacen, cuerpo, uid) {
    const b = cuerpo && typeof cuerpo === "object" && !Array.isArray(cuerpo) ? cuerpo : {};
    try {
        switch (b.accion) {
            case "crear": return { status: 200, cuerpo: await crear(almacen, b, uid) };
            case "editar": return { status: 200, cuerpo: await editar(almacen, b) };
            case "adjuntar": { const r = await adjuntar(almacen, b); return { status: 200, cuerpo: r }; }
            case "anotar": return { status: 200, cuerpo: await anotar(almacen, b) };
            case "quitar": return { status: 200, cuerpo: await quitar(almacen, b) };
            case "archivo": return { status: 200, cuerpo: await archivo(almacen, b) };
            case "descartar": return { status: 200, cuerpo: await cambiarEstado(almacen, b, "descartado") };
            case "reabrir": return { status: 200, cuerpo: await cambiarEstado(almacen, b, "pendiente") };
            default: throw new ErrorPedido("Acción desconocida.");
        }
    } catch (e) {
        if (e instanceof ErrorPedido) return { status: e.status, cuerpo: { error: e.message } };
        console.error("[requerimientoApi]", b.accion, e);
        return { status: 500, cuerpo: { error: "Error interno." } };
    }
}

module.exports = { atender, ARCHIVOS, RUTAS, ESTADOS, MAX, ErrorPedido };
