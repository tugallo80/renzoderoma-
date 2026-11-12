/**
 * /api/agente (agenteApi) — lo llama el chat del agente en presupuesto.html. Solo lista blanca hub.
 *   adjuntar   sube un PDF, una imagen (con anotaciones) o la medición rubik/1 de un 3D → Storage agente/{cid}/{pid}/…
 *   enviar     guarda el mensaje del dueño y pone el turno en cola (lo corre agenteTurno)
 *   reintentar vuelve a poner en cola el turno cortado
 *   detener    pide cortar el turno en curso
 *   archivo    devuelve un adjunto (para verlo en el chat)
 * El turno corre en el trigger de /agente_cola: si el celular se bloquea, el trabajo sigue.
 */
const N = require("./compartido/agente-nucleo.js");
const { agregarUsuario, leerHistorial, effortVigente } = require("./historial");

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX = { pdf: 20 * 1024 * 1024, imagen: 5 * 1024 * 1024, medicion: 8 * 1024 * 1024 };
const BLOQUEO_MS = 10 * 60 * 1000;   // un turno "trabajando" sin novedades por 10 min se considera cortado
const RAIZ = (cid, pid) => `proyectos/${cid}/${pid}/agente`;

class ErrorPedido extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }

function nombreSeguro(n) {
    return String(n || "archivo").normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(-80) || "archivo";
}

function b64(datos, max, que) {
    if (typeof datos !== "string" || !datos) throw new ErrorPedido(`Falta el contenido de ${que}.`);
    const buf = Buffer.from(datos, "base64");
    if (!buf.length) throw new ErrorPedido(`El contenido de ${que} está vacío.`);
    if (buf.length > max) throw new ErrorPedido(`${que} pesa ${(buf.length / 1048576).toFixed(1)} MB; el máximo es ${Math.round(max / 1048576)} MB.`, 413);
    return buf;
}

function esJPEGoPNG(buf) {
    return (buf[0] === 0xff && buf[1] === 0xd8) || (buf[0] === 0x89 && buf[1] === 0x50) || (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP");
}
function mimeImagen(buf) { return buf[0] === 0x89 ? "image/png" : buf[0] === 0xff ? "image/jpeg" : "image/webp"; }

/** Anotaciones del editor de fotos: se guardan tal cual (son datos del dueño), con un límite de tamaño. */
function limpiarAnotaciones(a) {
    if (!Array.isArray(a)) return null;
    const txt = JSON.stringify(a.slice(0, 200));
    if (txt.length > 100000) throw new ErrorPedido("Demasiadas anotaciones.");
    return JSON.parse(txt);
}

async function adjuntar(almacen, b) {
    const { cid, pid } = b;
    const id = almacen.nuevaClave();
    const base = `agente/${cid}/${pid}/${id}`;
    const meta = { nombre: String(b.nombre || "archivo").slice(0, 200), fecha: almacen.ahora() };
    if (b.tipo === "pdf") {
        const buf = b64(b.datos, MAX.pdf, "el PDF");
        if (buf.slice(0, 4).toString() !== "%PDF") throw new ErrorPedido("El archivo no es un PDF.");
        meta.tipo = "pdf"; meta.mime = "application/pdf"; meta.bytes = buf.length; meta.ruta = `${base}/${nombreSeguro(meta.nombre)}`;
        await almacen.subirArchivo(meta.ruta, buf, meta.mime);
    } else if (b.tipo === "imagen") {
        const buf = b64(b.datos, MAX.imagen, "la imagen");
        if (!esJPEGoPNG(buf)) throw new ErrorPedido("La imagen tiene que ser JPG, PNG o WEBP.");
        meta.tipo = "imagen"; meta.mime = mimeImagen(buf); meta.bytes = buf.length; meta.ruta = `${base}/original.${meta.mime.split("/")[1]}`;
        await almacen.subirArchivo(meta.ruta, buf, meta.mime);
        if (b.anotada) {
            const an = b64(b.anotada, MAX.imagen, "la foto anotada");
            if (!esJPEGoPNG(an)) throw new ErrorPedido("La foto anotada tiene que ser JPG o PNG.");
            meta.anotada_ruta = `${base}/anotada.jpg`;
            await almacen.subirArchivo(meta.anotada_ruta, an, "image/jpeg");
        }
        const anot = limpiarAnotaciones(b.anotaciones);
        if (anot && anot.length) meta.anotaciones = anot;
        if (b.ancho && b.alto) { meta.ancho = Math.round(b.ancho); meta.alto = Math.round(b.alto); }
    } else if (b.tipo === "3d") {
        const med = b.medicion;
        if (!med || !Array.isArray(med.piezas)) throw new ErrorPedido("Falta la medición del 3D (rubik/1).");
        const buf = Buffer.from(JSON.stringify(med), "utf8");
        if (buf.length > MAX.medicion) throw new ErrorPedido("La medición del 3D es demasiado grande.", 413);
        meta.tipo = "3d"; meta.mime = "application/json"; meta.bytes = buf.length; meta.medicion_ruta = `${base}/medicion.json`;
        meta.resumen = String(med.resumen || `${med.piezas.length} piezas`).slice(0, 500);
        meta.piezas = med.piezas.length;
        if (Array.isArray(b.tamano_m) && b.tamano_m.length === 3) meta.tamano_m = b.tamano_m.map(Number);
        if (b.unidad) meta.unidad = String(b.unidad).slice(0, 80);
        await almacen.subirArchivo(meta.medicion_ruta, buf, "application/json");
        // Vistas renderizadas en el navegador con el número de cada pieza (para que el agente relacione el 3D con fotos y planos)
        if (Array.isArray(b.vistas) && b.vistas.length) {
            meta.vistas_rutas = []; meta.vistas_nombres = [];
            for (let i = 0; i < Math.min(2, b.vistas.length); i++) {
                const v = b.vistas[i] || {};
                const img = b64(v.datos, 2 * 1024 * 1024, "la vista del 3D");
                if (!(img[0] === 0xff && img[1] === 0xd8)) throw new ErrorPedido("La vista del 3D tiene que ser JPG.");
                const ruta = `${base}/vista${i + 1}.jpg`;
                await almacen.subirArchivo(ruta, img, "image/jpeg");
                meta.vistas_rutas.push(ruta); meta.vistas_nombres.push(String(v.nombre || `vista ${i + 1}`).slice(0, 40));
            }
        }
    } else {
        throw new ErrorPedido("Tipo de adjunto no admitido (3D, PDF o imagen).");
    }
    await almacen.escribir(`${RAIZ(cid, pid)}/adjuntos/${id}`, meta);
    return { id, meta };
}

/** Toma el turno del proyecto (uno a la vez). Devuelve false si hay otro trabajando. */
async function tomarTurno(almacen, cid, pid, turno) {
    const ahora = almacen.ahora();
    const r = await almacen.transaccion(`${RAIZ(cid, pid)}/estado`, (cur) => {
        if (cur && (cur.fase === "trabajando" || cur.fase === "en_cola") && ahora - (cur.actualizado || 0) < BLOQUEO_MS) return undefined;
        return { fase: "en_cola", texto: "En cola…", actualizado: ahora, turno };
    });
    return r.ok;
}

async function encolar(almacen, b, uid, turno) {
    await almacen.borrar(`${RAIZ(b.cid, b.pid)}/detener`).catch(() => {});
    await almacen.agregar("agente_cola", { cid: b.cid, pid: b.pid, uid, turno, pasar_tope: !!b.pasar_tope, fecha: almacen.ahora() });
}

async function enviar(almacen, b, uid) {
    const { cid, pid } = b;
    const texto = String(b.texto || "").trim().slice(0, 20000);
    const ids = Array.isArray(b.adjuntos) ? b.adjuntos.filter((x) => ID.test(String(x))).slice(0, 30) : [];
    if (!texto && !ids.length) throw new ErrorPedido("El mensaje está vacío.");
    const metas = [];
    for (const id of ids) {
        const m = await almacen.leer(`${RAIZ(cid, pid)}/adjuntos/${id}`);
        if (!m) throw new ErrorPedido(`El adjunto ${id} no existe en este proyecto.`);
        metas.push({ id, nombre: m.nombre, tipo: m.tipo });
    }
    const turno = almacen.nuevaClave();
    if (!(await tomarTurno(almacen, cid, pid, turno))) throw new ErrorPedido("El agente todavía está trabajando en el mensaje anterior.", 409);
    const msgId = await almacen.agregar(`${RAIZ(cid, pid)}/conversacion/mensajes`, { rol: "dueno", texto, adjuntos: metas.length ? metas : null, fecha: almacen.ahora(), turno, uid });
    const hist = leerHistorial(await almacen.leer(`${RAIZ(cid, pid)}/conversacion/api`));
    const bloques = [];
    if (!hist.length) {
        bloques.push({ type: "text", text: await textoInicial(almacen, cid, pid) });
    }
    ids.forEach((id) => bloques.push({ type: "adjunto", id }));
    bloques.push({ type: "text", text: `[Mensaje ${msgId} del dueño · ${fechaBolivia(almacen.ahora())}]\n${texto || "(sin texto: mirá los adjuntos)"}` });
    agregarUsuario(hist, bloques);
    // Correcciones más baratas: después del primer borrador, effort de correcciones con un mensaje de sistema
    // de effort (beta mid-conversation-output-config) que NO rompe la caché, a diferencia de cambiar el effort del pedido.
    const config = N.configEfectiva(await almacen.leer("config/agente"));
    const hayBorrador = !!(await almacen.leer(`${RAIZ(cid, pid)}/borrador/total`).catch(() => null)) || !!(await almacen.leer(`${RAIZ(cid, pid)}/borrador/capitulos`).catch(() => null));
    const objetivo = hayBorrador && config.effort_correcciones !== "igual" ? config.effort_correcciones : config.effort;
    if (N.MODELOS_EFFORT_POR_MENSAJE.includes(config.modelo) && (effortVigente(hist) || config.effort) !== objetivo) {
        hist.push({ role: "system", content: [], output_config: { effort: objetivo } });
    }
    await almacen.escribir(`${RAIZ(cid, pid)}/conversacion/api`, JSON.stringify(hist));
    await encolar(almacen, b, uid, turno);
    return { ok: true, turno, mensaje: msgId, effort: objetivo };
}

function fechaBolivia(ms) {
    const d = new Date(ms - 4 * 3600 * 1000);
    return d.toISOString().slice(0, 16).replace("T", " ") + " (hora de Bolivia)";
}

/** Primer mensaje de la conversación: contexto del proyecto y memoria del dueño. */
/**
 * Normas iniciales dichas por el dueño (se siembran UNA vez en /agente_memoria/normas; si las borra en ⚙ no vuelven).
 */
const NORMAS_INICIALES = {
    inicial_estructura_items: "Un ítem es lo que el cliente compra y se le entrega (el trofeo, el mostrador, el letrero, el adhesivo de piso, el traslado y montaje), con su cantidad y unidad. Materiales, mano de obra, equipos, fijaciones, armado y pintura van dentro del APU de ese ítem, nunca como ítems aparte. Las piezas del 3D que forman un mismo objeto son un solo ítem. Si el cliente manda una lista de ítems, esa lista manda. Si conviene separar algo, preguntarlo antes.",
};
async function sembrarNormas(almacen) {
    for (const k of Object.keys(NORMAS_INICIALES)) {
        const r = await almacen.transaccion(`agente_memoria/sembradas/${k}`, (cur) => (cur ? undefined : almacen.ahora()));
        if (r.ok) await almacen.escribir(`agente_memoria/normas/${k}`, { texto: NORMAS_INICIALES[k], fecha: almacen.ahora(), por: "dueño (pedido tras la cotización del trofeo, 12 nov 2026)" });
    }
}

async function textoInicial(almacen, cid, pid) {
    const partes = [`[Proyecto ${pid} del cliente ${cid}. Conversación nueva.]`];
    await sembrarNormas(almacen).catch((e) => console.warn("[agente] normas iniciales", e.message));
    const lista = async (n) => { const m = await almacen.leer(`agente_memoria/${n}`).catch(() => null); return m ? Object.keys(m).map((k) => m[k]).filter((x) => x && x.texto) : []; };
    const normas = await lista("normas"), notas = await lista("notas");
    if (normas.length) {
        partes.push("Normas constructivas del taller (cómo construye Rubik; usalas en tus propuestas):\n" +
            normas.slice(-80).map((x) => `- ${String(x.texto).slice(0, 400)}`).join("\n"));
    }
    if (notas.length) {
        partes.push("Memoria guardada del dueño (correcciones y decisiones de trabajos anteriores):\n" +
            notas.slice(-80).map((x) => `- ${String(x.texto).slice(0, 400)}`).join("\n"));
    }
    return partes.join("\n\n");
}

async function reintentar(almacen, b, uid) {
    const hist = leerHistorial(await almacen.leer(`${RAIZ(b.cid, b.pid)}/conversacion/api`));
    if (!hist.length) throw new ErrorPedido("No hay nada para reintentar.");
    const turno = almacen.nuevaClave();
    if (!(await tomarTurno(almacen, b.cid, b.pid, turno))) throw new ErrorPedido("El agente está trabajando.", 409);
    if (hist.filter((m) => m.role !== "system").pop().role !== "user") {   // terminó bien: se le pide que siga
        agregarUsuario(hist, [{ type: "text", text: "[El dueño tocó \"Seguir\": continuá desde donde quedaste.]" }]);
        await almacen.escribir(`${RAIZ(b.cid, b.pid)}/conversacion/api`, JSON.stringify(hist));
    }
    await encolar(almacen, b, uid, turno);
    return { ok: true, turno };
}

async function archivo(almacen, b) {
    if (!ID.test(String(b.id || ""))) throw new ErrorPedido("Adjunto inválido.");
    const meta = await almacen.leer(`${RAIZ(b.cid, b.pid)}/adjuntos/${b.id}`);
    if (!meta) throw new ErrorPedido("No existe el adjunto.", 404);
    const ruta = b.anotada ? meta.anotada_ruta : meta.ruta || meta.medicion_ruta;
    if (!ruta) throw new ErrorPedido("Ese adjunto no tiene archivo.", 404);
    const buf = await almacen.bajarArchivo(ruta);
    return { meta, datos: Buffer.from(buf).toString("base64") };
}

/** Atiende un pedido ya autenticado. Devuelve {status, cuerpo}. */
async function atender(almacen, cuerpo, uid) {
    const b = cuerpo || {};
    try {
        if (!ID.test(String(b.cid || "")) || !ID.test(String(b.pid || ""))) throw new ErrorPedido("Falta el proyecto (cid/pid).");
        switch (b.accion) {
            case "adjuntar": { const r = await adjuntar(almacen, b); return { status: 200, cuerpo: { ok: true, id: r.id, meta: r.meta } }; }
            case "enviar": return { status: 200, cuerpo: await enviar(almacen, b, uid) };
            case "reintentar": return { status: 200, cuerpo: await reintentar(almacen, b, uid) };
            case "detener": await almacen.escribir(`${RAIZ(b.cid, b.pid)}/detener`, true); return { status: 200, cuerpo: { ok: true } };
            case "archivo": return { status: 200, cuerpo: await archivo(almacen, b) };
            default: throw new ErrorPedido("Acción desconocida.");
        }
    } catch (e) {
        if (e instanceof ErrorPedido) return { status: e.status, cuerpo: { error: e.message } };
        console.error("[agenteApi]", e);
        return { status: 500, cuerpo: { error: "Error interno del agente." } };
    }
}

module.exports = { NORMAS_INICIALES, sembrarNormas, atender, adjuntar, enviar, reintentar, tomarTurno, ErrorPedido, N };
