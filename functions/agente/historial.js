/**
 * Historial de la API (lo que se le manda a Claude) guardado por proyecto en
 *   /proyectos/{cid}/{pid}/agente/conversacion/api   (texto JSON: un arreglo de mensajes)
 * Los adjuntos no se guardan adentro: van como {type:"adjunto", id} y se expanden al llamar
 * (PDF → documento nativo, imagen → imagen nativa, 3D → texto con lo medido por la app).
 * La expansión es determinista para que el prefijo cacheado no cambie entre llamadas.
 */

function claseAdjunto(a) {
    if (a.tipo === "3d") return "3D (resumen de medición)";
    if (a.tipo === "pdf") return "PDF";
    if (a.tipo === "imagen") return (a.mime === "image/png" || /screenshot|captura|screen|pantalla/i.test(a.nombre || "")) ? "captura" : "foto";
    return a.tipo;
}
/** "Adjunto 3 · foto · IMG_123.jpg (id -Kabc)": numerados en el orden en que se subieron en la conversación. */
function etiquetaAdjunto(id, a, n) {
    return `[Adjunto ${n != null ? n + " · " : ""}${claseAdjunto(a)} · ${a.nombre || "sin nombre"} (id ${id})]`;
}

/**
 * Convierte los marcadores {type:"adjunto", id} en bloques nativos de la API.
 * cargar(id) → { meta, base64?, anotada_base64?, anotaciones? }
 */
async function expandirMensajes(mensajes, cargar) {
    const salida = [];
    let n = 0;   // numeración de adjuntos en toda la conversación (determinista: no rompe la caché)
    async function expandir(b) {
        const out = [];
        let datos;
        try { datos = await cargar(b.id); } catch (e) { datos = null; }
        if (!datos || !datos.meta) return [{ type: "text", text: `[Adjunto ${b.id}: ya no está disponible]` }];
        const a = datos.meta;
        out.push({ type: "text", text: etiquetaAdjunto(b.id, a, ++n) });
        if (a.tipo === "pdf" && datos.base64) {
            out.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: datos.base64 }, title: String(a.nombre || "documento.pdf").slice(0, 200) });
        } else if (a.tipo === "imagen" && datos.base64) {
            out.push({ type: "image", source: { type: "base64", media_type: a.mime || "image/jpeg", data: datos.base64 } });
            if (datos.anotada_base64) {
                out.push({ type: "text", text: `[Misma foto con las anotaciones del dueño dibujadas encima]` });
                out.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: datos.anotada_base64 } });
            }
            if (datos.anotaciones && datos.anotaciones.length) {
                out.push({ type: "text", text: "Anotaciones del dueño sobre la foto (coordenadas en píxeles de la foto original; los valores de las cotas los escribió el dueño, citá el origen como dueño:" + b.id + "):\n" + JSON.stringify(datos.anotaciones) });
            }
        } else if (a.tipo === "3d") {
            out.push({ type: "text", text: `El navegador ya midió este 3D (${a.resumen || "sin resumen"}). Consultá piezas, medidas, áreas y perímetros con la herramienta medicion_3d (adjunto "${b.id}").` });
            (datos.vistas_base64 || []).forEach((v, i) => {
                out.push({ type: "text", text: `[Vista ${i + 1} del 3D (${(a.vistas_nombres || [])[i] || "vista"}) con el número de cada pieza (p1, p2…) — solo para ubicarte: las medidas salen de medicion_3d]` });
                out.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: v } });
            });
        }
        return out;
    }
    for (const m of mensajes) {
        if (!Array.isArray(m.content) || m.role === "system") { salida.push(m); continue; }
        const content = [];
        for (const b of m.content) {
            if (b && b.type === "adjunto") { content.push(...(await expandir(b))); continue; }
            // ver_adjunto: el adjunto vuelve dentro del resultado de la herramienta (solo hasta la próxima compactación)
            if (b && b.type === "tool_result" && Array.isArray(b.content) && b.content.some((x) => x && x.type === "adjunto")) {
                const interno = [];
                for (const x of b.content) { if (x && x.type === "adjunto") interno.push(...(await expandir(x))); else interno.push(x); }
                content.push(Object.assign({}, b, { content: interno }));
                continue;
            }
            content.push(b);
        }
        salida.push(Object.assign({}, m, { content }));
    }
    return salida;
}

/** ¿El historial todavía lleva adjuntos completos (PDF, fotos, vistas del 3D)? */
function tieneAdjuntos(mensajes) { return JSON.stringify(mensajes).includes('"type":"adjunto"'); }

/**
 * Contenido de la respuesta tal como se guarda para la próxima llamada.
 * Regla de fallbacks: después de un fallback a mitad de respuesta, se omiten los bloques de
 * thinking / tool_use que quedaron ANTES del último bloque "fallback" (el bloque fallback queda donde estaba).
 */
function contenidoParaHistorial(content) {
    const bloques = Array.isArray(content) ? content : [];
    let ultimo = -1;
    bloques.forEach((b, i) => { if (b && b.type === "fallback") ultimo = i; });
    if (ultimo < 0) return bloques.slice();
    const omitir = new Set(["thinking", "redacted_thinking", "tool_use", "server_tool_use"]);
    return bloques.filter((b, i) => i >= ultimo || !omitir.has(b.type));
}

/** Agrega bloques de usuario: si el último mensaje ya es del usuario, se suman ahí (la API los une igual). */
function agregarUsuario(mensajes, bloques) {
    const ult = mensajes[mensajes.length - 1];
    if (ult && ult.role === "user" && Array.isArray(ult.content)) ult.content.push(...bloques);
    else mensajes.push({ role: "user", content: bloques });
    return mensajes;
}

/** El historial termina en una respuesta con tool_use sin sus tool_result: se cierran como canceladas. */
function cerrarHerramientasPendientes(mensajes) {
    const ult = mensajes[mensajes.length - 1];
    if (!ult || ult.role !== "assistant" || !Array.isArray(ult.content)) return mensajes;
    const pendientes = ult.content.filter((b) => b.type === "tool_use");
    if (pendientes.length) {
        mensajes.push({ role: "user", content: pendientes.map((b) => ({ type: "tool_result", tool_use_id: b.id, is_error: true, content: "Cancelado: el turno se cortó antes de ejecutar la herramienta." })) });
    }
    return mensajes;
}

/** Effort vigente según el historial: el último mensaje de sistema con output_config.effort (o null si no hay). */
function effortVigente(mensajes) {
    for (let i = mensajes.length - 1; i >= 0; i--) {
        const m = mensajes[i];
        if (m && m.role === "system" && m.output_config && m.output_config.effort) return m.output_config.effort;
    }
    return null;
}

function leerHistorial(texto) {
    if (!texto) return [];
    try { const v = JSON.parse(texto); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

module.exports = { tieneAdjuntos, effortVigente, claseAdjunto, expandirMensajes, contenidoParaHistorial, agregarUsuario, cerrarHerramientasPendientes, leerHistorial, etiquetaAdjunto };
