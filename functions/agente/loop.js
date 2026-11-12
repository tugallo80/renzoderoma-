/**
 * Loop del agente: llama a Claude, corre las herramientas y repite hasta que termina el turno.
 * Corre en el trigger de /agente_cola (no depende de que el celular siga conectado). El estado y
 * el progreso van a /proyectos/{cid}/{pid}/agente/estado; cada llamada registra su costo.
 */
const N = require("./compartido/agente-nucleo.js");
const { SISTEMA } = require("./prompt");
const H = require("./herramientas");
const { expandirMensajes, contenidoParaHistorial, cerrarHerramientasPendientes, leerHistorial } = require("./historial");

const LIMITE_MS = 400 * 1000;   // la Function corta a los 540 s: antes de eso se sigue en otra invocación
const { RAIZ, raizConv, PRINCIPAL } = require("./rutas");

/** Punto de caché: 1 h por defecto (el dueño tarda más de 5 min entre turnos; con 5 min se reescribía todo cada vez). */
function cc(config) { return config.cache_ttl === "5m" ? { type: "ephemeral" } : { type: "ephemeral", ttl: "1h" }; }

/** Pedido a la API: sistema y herramientas fijos (en caché), thinking adaptativo, effort y fallbacks por rechazo. */
function armarPedido(config, mensajes) {
    const p = {
        model: config.modelo,
        max_tokens: config.max_tokens,
        thinking: { type: "adaptive" },
        output_config: { effort: config.effort },
        system: [{ type: "text", text: SISTEMA, cache_control: cc(config) }],
        tools: H.definiciones(),
        messages: mensajes,
        cache_control: cc(config),   // caché automática del último bloque (la conversación)
    };
    const betas = [];
    if (config.fallbacks && N.MODELOS_CON_FALLBACK.includes(config.modelo)) {
        betas.push("server-side-fallback-2026-07-01");
        p.fallbacks = "default";
    }
    if (mensajes.some((m) => m.role === "system" && m.output_config)) betas.push("mid-conversation-output-config-2026-07-01");
    if (betas.length) p.betas = betas;
    return p;
}

async function registrarCosto(almacen, { cid, pid, conv, mes, costo, modelo, turno, fecha }) {
    const RC = raizConv(cid, pid, conv);
    const fila = { fecha, modelo, turno: turno || null, entrada: costo.entrada, salida: costo.salida,
        cache_escrita: costo.cache_escrita, cache_leida: costo.cache_leida, usd: costo.usd, pct_cache: N.pctCache(costo) };
    if (Object.keys(costo.modelos || {}).length > 1) fila.por_modelo = costo.modelos;
    await Promise.all([
        almacen.transaccion(`agente_costos/${mes}/${cid}_${pid}`, (acc) => Object.assign(N.sumarCosto(acc, costo), { cid, pid, actualizado: fecha })),
        almacen.transaccion(`agente_costos/${mes}/_total`, (acc) => Object.assign(N.sumarCosto(acc, costo), { actualizado: fecha })),
        almacen.transaccion(`${RC}/costos/total`, (acc) => N.sumarCosto(acc, costo)),
        almacen.agregar(`${RC}/costos/llamadas`, fila),
        // costo de cada conversación en su meta (lista "Conversaciones" y total del proyecto)
        almacen.transaccion(`${RAIZ(cid, pid)}/conversaciones_meta/${conv || PRINCIPAL}/costo_usd`, (v) => N.redondear((Number(v) || 0) + costo.usd, 6)),
    ]);
}

async function gastoDelMes(almacen, mes) {
    const t = await almacen.leer(`agente_costos/${mes}/_total`);
    return t && t.usd ? Number(t.usd) : 0;
}

/** Carga un adjunto para mandarlo a la API (con caché por invocación). */
function cargadorDeAdjuntos(almacen, cid, pid) {
    const cache = {};
    return async (id) => {
        if (cache[id]) return cache[id];
        const meta = await almacen.leer(`${RAIZ(cid, pid)}/adjuntos/${id}`);
        if (!meta) return null;
        const r = { meta };
        if ((meta.tipo === "pdf" || meta.tipo === "imagen") && meta.ruta) r.base64 = Buffer.from(await almacen.bajarArchivo(meta.ruta)).toString("base64");
        if (meta.tipo === "imagen" && meta.anotada_ruta) r.anotada_base64 = Buffer.from(await almacen.bajarArchivo(meta.anotada_ruta)).toString("base64");
        if (meta.anotaciones) r.anotaciones = meta.anotaciones;
        if (meta.tipo === "3d" && Array.isArray(meta.vistas_rutas)) {
            r.vistas_base64 = [];
            for (const v of meta.vistas_rutas) { try { r.vistas_base64.push(Buffer.from(await almacen.bajarArchivo(v)).toString("base64")); } catch (e) { /* sin vista */ } }
        }
        cache[id] = r;
        return r;
    };
}

function textoDe(content) {
    return (content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

/**
 * Corre un turno (o la continuación de uno).
 * deps: { almacen, cliente (SDK de Anthropic), esErrorAPI(e) }
 * pedido: { cid, pid, uid, turno, pasar_tope }
 */
async function ejecutarTurno(deps, pedido) {
    const { almacen, cliente } = deps;
    const esErrorAPI = deps.esErrorAPI || (() => false);
    const { cid, pid } = pedido;
    const raiz = RAIZ(cid, pid);                       // proyecto: estado, detener, adjuntos
    const conv = pedido.conv || PRINCIPAL;
    const rc = raizConv(cid, pid, conv);                // conversación: mensajes, historial, borrador, costos
    const inicio = almacen.ahora();
    const config = N.configEfectiva(await almacen.leer("config/agente"));
    // Modelo de las correcciones (después del primer borrador), si el dueño eligió otro en ⚙
    if (config.modelo_correcciones !== "igual" && (await almacen.leer(`${raizConv(pedido.cid, pedido.pid, pedido.conv)}/borrador/total`)) != null) config.modelo = config.modelo_correcciones;
    const mes = N.mesClave(inicio);
    const turno = pedido.turno || null;
    let costoTurno = 0;

    const estado = (fase, texto, extra) => almacen.actualizar(`${raiz}/estado`, Object.assign({ fase, texto: texto || "", actualizado: almacen.ahora(), turno, conv }, extra || {}));
    const mostrar = (m) => almacen.agregar(`${rc}/conversacion/mensajes`, Object.assign({ fecha: almacen.ahora(), turno }, m));
    const guardar = (hist) => almacen.escribir(`${rc}/conversacion/api`, JSON.stringify(hist));

    let historial = cerrarHerramientasPendientes(leerHistorial(await almacen.leer(`${rc}/conversacion/api`)));
    const ultimo = historial.filter((m) => m.role !== "system").pop();   // los mensajes de effort pueden ir al final
    if (!ultimo || ultimo.role !== "user") {
        await estado("listo", "");
        return { fin: "nada_que_hacer" };
    }
    const cargar = cargadorDeAdjuntos(almacen, cid, pid);
    const ctx = {
        almacen, cid, pid, conv, turno, uid: pedido.uid, mensajesAgente: [], cortarTurno: false,
        progreso: (t) => estado("trabajando", t),
    };
    let llamadas = Number(pedido.llamadas || 0), reintentosJSON = 0, maxTokens = config.max_tokens;

    try {
        await estado("trabajando", "Leyendo lo que mandaste…");
        for (;;) {
            if (almacen.ahora() - inicio > LIMITE_MS) {
                await guardar(historial);
                await almacen.agregar("agente_cola", { cid, pid, conv, uid: pedido.uid || null, turno, continuar: true, pasar_tope: !!pedido.pasar_tope, llamadas, fecha: almacen.ahora() });
                await estado("trabajando", "Sigo trabajando…");
                return { fin: "continua", costo: costoTurno };
            }
            if (await almacen.leer(`${raiz}/detener`)) {
                await almacen.borrar(`${raiz}/detener`);
                await guardar(historial);
                await mostrar({ rol: "aviso", texto: "Paré, como pediste. Escribime cuando quieras seguir." });
                await estado("listo", "");
                return { fin: "detenido", costo: costoTurno };
            }
            const tope = N.estadoTope(await gastoDelMes(almacen, mes), config);
            if (tope.nivel === "tope" && !pedido.pasar_tope) {
                await guardar(historial);
                await mostrar({ rol: "aviso", tipo: "tope", texto: `Se llegó al tope mensual del agente (${N.usd(tope.gasto)} de ${N.usd(tope.tope)}). Paré antes de seguir gastando. Podés tocar "Seguir igual" para continuar este turno, o subir el tope.` });
                await estado("tope", "Tope mensual alcanzado", { tope });
                return { fin: "tope", costo: costoTurno };
            }
            if (llamadas >= config.max_llamadas_turno) {
                await guardar(historial);
                await mostrar({ rol: "aviso", texto: `Corté después de ${llamadas} llamadas para no gastar de más. Escribime "seguí" si querés que continúe.` });
                await estado("listo", "");
                return { fin: "limite_llamadas", costo: costoTurno };
            }

            await estado("trabajando", llamadas ? "Pensando el siguiente paso…" : "Pensando…");
            const mensajes = await expandirMensajes(historial, cargar);
            const params = armarPedido(Object.assign({}, config, { max_tokens: maxTokens }), mensajes);
            let resp;
            try {
                resp = await cliente.beta.messages.stream(params).finalMessage();
                reintentosJSON = 0;
            } catch (e) {
                // Con eager_input_streaming, un tool_use con JSON imposible de leer rechaza acá: se repite el pedido.
                if (esErrorAPI(e) || reintentosJSON++ >= 2) throw e;
                continue;
            }
            llamadas++;
            const costo = N.costoDeUso(resp.usage, resp.model || config.modelo, config.precios);
            costoTurno = N.redondear(costoTurno + costo.usd, 6);
            if (process.env.AGENTE_LOG !== "0") console.log("[agenteTurno] llamada", JSON.stringify({ modelo: resp.model || config.modelo, entrada: costo.entrada, cache_leida: costo.cache_leida,
                cache_escrita: costo.cache_escrita, salida: costo.salida, usd: costo.usd, pct_cache: N.pctCache(costo) }));
            await registrarCosto(almacen, { cid, pid, conv, mes, costo, modelo: resp.model || config.modelo, turno, fecha: almacen.ahora() });

            if (resp.stop_reason === "refusal") {
                await guardar(historial);
                const cat = resp.stop_details && resp.stop_details.category ? ` (${resp.stop_details.category})` : "";
                await mostrar({ rol: "aviso", texto: `El modelo no quiso seguir con este pedido${cat}. Reformulalo o sacá el adjunto que lo pudo causar.` });
                await estado("listo", "");
                return { fin: "rechazo", costo: costoTurno };
            }
            const usos = (resp.content || []).filter((b) => b.type === "tool_use");
            if (resp.stop_reason === "max_tokens" && usos.length) {
                // Una entrada de herramienta cortada parece válida: no se corre; se repite con más espacio.
                if (maxTokens >= 128000) throw new Error("La respuesta no entra en 128.000 tokens.");
                maxTokens = Math.min(maxTokens * 2, 128000);
                continue;
            }
            historial.push({ role: "assistant", content: contenidoParaHistorial(resp.content) });

            if (resp.stop_reason === "pause_turn") { await guardar(historial); continue; }

            const ejecutables = contenidoParaHistorial(resp.content).filter((b) => b.type === "tool_use");
            if (resp.stop_reason === "tool_use" && ejecutables.length) {
                const texto = textoDe(resp.content);
                if (texto) await mostrar({ rol: "agente", texto, parcial: true });
                const resultados = [];
                for (const b of ejecutables) resultados.push(await H.ejecutar(ctx, b));
                historial.push({ role: "user", content: resultados });
                await guardar(historial);
                if (ctx.cortarTurno) {
                    for (const m of ctx.mensajesAgente) await mostrar(Object.assign({ costo_usd: costoTurno }, m));
                    await estado("esperando_dueno", "Esperando tu respuesta");
                    return { fin: "pregunta", costo: costoTurno };
                }
                for (const m of ctx.mensajesAgente.splice(0)) await mostrar(m);
                continue;
            }

            await guardar(historial);
            const texto = textoDe(resp.content) || "(sin texto)";
            await mostrar({ rol: "agente", texto: texto + (resp.stop_reason === "max_tokens" ? "\n\n(La respuesta se cortó por largo.)" : ""), costo_usd: costoTurno, modelo: resp.model || config.modelo });
            await estado("listo", "");
            return { fin: "listo", costo: costoTurno };
        }
    } catch (e) {
        await guardar(historial).catch(() => {});
        const msg = e && e.message ? e.message : String(e);
        await mostrar({ rol: "aviso", tipo: "error", texto: `No pude terminar: ${msg.slice(0, 300)}. Tocá "Reintentar".` }).catch(() => {});
        await estado("error", msg.slice(0, 300)).catch(() => {});
        return { fin: "error", error: msg, costo: costoTurno };
    }
}

module.exports = { ejecutarTurno, armarPedido, registrarCosto, LIMITE_MS };
