/**
 * Herramientas del conector para los Requerimientos (sesión 6, docs/sesiones/06-render-requerimiento.md).
 * El dueño carga en la app lo que pidió el cliente (requerimiento.html, sin IA); Claude lo toma desde acá:
 *   listar_requerimientos  → los pendientes (o de otro estado)
 *   leer_requerimiento     → descripción, cliente, adjuntos con sus anotaciones como datos y las fotos como imagen
 *   asignar_requerimiento  → lo une a un proyecto y a una cotización: la descripción queda como mensaje del dueño y los
 *                            adjuntos se copian a los del proyecto (mismo formato que el Agente IA), así medicion_3d y los
 *                            orígenes dueño:/cota_plano:/pieza3d: funcionan igual. Con cotizado:true lo marca cotizado.
 *   generar_render         → pide un render con Gemini (modelo fijo) desde las fotos del requerimiento: lo encola en
 *                            /render_cola (lo hace renderTurno, functions/render) y espera ~40 s; si está, devuelve la
 *                            imagen para que Claude la revise y corrija; si no, el id para ver_render. Sin cotas en la imagen.
 *   ver_render             → estado o imagen de un render.
 *   aprobar_render         → con la confirmación del dueño, el render pasa a ser la imagen del ítem del presupuesto
 *                            (item.img, la que usan el PDF y producción); la anterior queda en item.cortes.
 * Se arma con las ayudas de herramientas.js (sin require circular).
 */
const R = require("../agente/rutas");
const REN = require("../render/gemini");   // solo constantes (modelos, aspectos): la llamada a Gemini la hace renderTurno

/** Espera de generar_render: Hosting corta a los 60 s, así que se espera ~40 s y si no, se devuelve el id (ver_render). */
let ESPERA = { ms: 40000, cada: 2500, dormir: (ms) => new Promise((ok) => setTimeout(ok, ms)), ahora: () => Date.now() };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ESTADOS = ["pendiente", "asignado", "cotizado", "descartado"];
/** Lo que devuelve leer_requerimiento por llamada: unos 300 KB de imágenes (probado en claude.ai hasta ~300 KB). */
const TOPE_IMAGENES = 300 * 1024;
/** Nodos de la base que tocan estas herramientas (además del cerco del conector). */
const RUTAS_REQ = [/^requerimientos(\/|$)/];
/** Renders por requerimiento (para no gastar de más por error). */
const MAX_RENDERS = 20;
/** Lo que se agrega siempre al pedido de imagen (el modelo inventa medidas y textos si se le piden). */
const REGLAS_RENDER = "\n\nReglas: render fotorrealista de venta. Respetá la proporción, el encuadre y el entorno de la foto de referencia. " +
    "NO dibujes cotas, flechas, medidas, números ni textos técnicos sobre la imagen (las medidas las pone la app aparte). " +
    "Logos y textos de marca solo si están en las referencias, sin inventar letras.";

module.exports = function crear({ falla, proyecto, acotar, RUTAS }) {
    const alReq = (almacen) => acotar(almacen, RUTAS_REQ);

    async function leerReq(almacen, id) {
        if (!ID.test(String(id || ""))) falla("id de requerimiento inválido");
        const r = await alReq(almacen).leer(`requerimientos/${id}`);
        if (!r) falla(`no existe el requerimiento ${id}`);
        return r;
    }
    const ordenados = (adj) => Object.keys(adj || {}).filter((k) => adj[k]).sort((a, b) => (adj[a].orden || 0) - (adj[b].orden || 0));
    const fecha = (ms) => (ms ? new Date(ms - 4 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") : undefined);

    function resumenAdjunto(k, a, n) {
        const o = { n, adj: k, tipo: a.tipo, nombre: a.nombre };
        if (a.tipo === "imagen") {
            o.tamano_px = a.ancho && a.alto ? `${a.ancho}×${a.alto}` : undefined;
            if (a.anotaciones) o.anotaciones = a.anotaciones;
        }
        if (a.tipo === "3d") { o.piezas = a.piezas; o.tamano_m = a.tamano_m; o.unidad = a.unidad; o.resumen = a.resumen; }
        if (a.tipo === "pdf" || a.tipo === "otro") o.kb = Math.round((a.bytes || 0) / 1024);
        return o;
    }

    /** Imágenes que se pueden mostrar de un adjunto, en orden: anotada (si hay) o la foto; del 3D, las vistas. */
    function imagenesDe(k, a) {
        if (a.tipo === "imagen") {
            if (a.anotada_claude_ruta) return [{ adj: k, ruta: a.anotada_claude_ruta, que: "foto anotada por el dueño (las cotas y notas también van como datos)" }];
            if (a.claude_ruta) return [{ adj: k, ruta: a.claude_ruta, que: "foto" }];
            return [{ adj: k, ruta: a.ruta, que: "foto (original)", original: true }];
        }
        if (a.tipo === "3d") return (a.vistas_rutas || []).map((ruta, i) => ({ adj: k, ruta, que: `vista ${(a.vistas_nombres || [])[i] || i + 1} del 3D (números = piezas de medicion_3d)` }));
        return [];
    }

    /** Espera (hasta ms) a que renderTurno termine; devuelve la imagen chica, el error o el id para ver_render. */
    async function esperarRender(almacen, id, rid, ms, extra) {
        const ruta = `requerimientos/${id}/renders/${rid}`;
        const hasta = ESPERA.ahora() + ms;
        let m = await alReq(almacen).leer(ruta);
        while (m && (m.estado === "en_proceso" || m.estado === "generando") && ESPERA.ahora() < hasta) {
            await ESPERA.dormir(ESPERA.cada);
            m = await alReq(almacen).leer(ruta);
        }
        if (!m) falla(`no existe el render ${rid}`);
        if (m.estado === "error") falla(`el render ${rid} falló: ${m.error || "sin detalle"}`);
        if (m.estado === "en_proceso" || m.estado === "generando") {
            return Object.assign({ render: rid, estado: "en_proceso", siguiente: "Todavía se está generando: volvé a pedirlo con ver_render {id, render} en unos segundos." }, extra);
        }
        const datos = Object.assign({ render: rid, estado: "listo", modelo: m.modelo, calidad: m.calidad, tamano: m.tamano, aspecto: m.aspecto, costo_usd_aprox: m.costo_usd_aprox,
            nota_del_modelo: m.nota_modelo || undefined, aprobado: m.aprobado ? true : undefined,
            siguiente: "Revisá la imagen. Si hay que corregir: generar_render con base_render y la corrección. Si el dueño la aprueba: aprobar_render." }, extra);
        const buf = Buffer.from(await almacen.bajarArchivo(m.claude_ruta));
        return { __contenido: [{ type: "text", text: JSON.stringify(datos) }, { type: "image", data: buf.toString("base64"), mimeType: "image/jpeg" }] };
    }

    return [
        {
            def: {
                name: "listar_requerimientos",
                title: "Listar requerimientos",
                description: "Lista los Requerimientos que el dueño cargó en la app (lo que pidió un cliente: descripción, fotos anotadas, PDF, 3D). Por defecto los pendientes (sin proyecto). Usalo cuando el dueño diga \"tengo un requerimiento nuevo\" o nombre a un cliente; después leer_requerimiento.",
                inputSchema: { type: "object", properties: {
                    estado: { type: "string", enum: ESTADOS.concat(["todos"]), description: "Por defecto pendiente." },
                    texto: { type: "string", maxLength: 100, description: "Opcional: parte del título, la descripción o el cliente." },
                } },
                annotations: { readOnlyHint: true },
            },
            async correr(almacen, uid, e) {
                const todos = (await alReq(almacen).leer("requerimientos")) || {};
                const est = e.estado || "pendiente";
                const q = String(e.texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
                const sin = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
                const res = Object.keys(todos).filter((k) => todos[k] && typeof todos[k] === "object")
                    .filter((k) => est === "todos" || (todos[k].estado || "pendiente") === est)
                    .filter((k) => !q || sin(`${todos[k].titulo} ${todos[k].descripcion} ${todos[k].cliente && todos[k].cliente.nombre}`).includes(q))
                    .sort((a, b) => (todos[b].actualizado || 0) - (todos[a].actualizado || 0)).slice(0, 50)
                    .map((k) => {
                        const r = todos[k], adj = r.adjuntos || {}, tipos = {};
                        Object.keys(adj).forEach((x) => { const t = adj[x] && adj[x].tipo; if (t) tipos[t] = (tipos[t] || 0) + 1; });
                        return { id: k, titulo: r.titulo, estado: r.estado || "pendiente", cliente: r.cliente || undefined, adjuntos: tipos,
                            asignado: r.pid ? { cid: r.cid, pid: r.pid, proyecto: r.proyecto_nombre, conv: r.conv } : undefined, actualizado: fecha(r.actualizado) };
                    });
                return { estado: est, requerimientos: res, siguiente: res.length ? "leer_requerimiento {id}" : undefined };
            },
        },
        {
            def: {
                name: "leer_requerimiento",
                title: "Leer un requerimiento",
                description: "Devuelve un Requerimiento completo: descripción del dueño, cliente, adjuntos (fotos con sus anotaciones como datos: cotas, marcas y notas en píxeles de la foto; 3D medido con su tamaño; PDF y otros archivos) y las IMÁGENES para que las mires (fotos anotadas y vistas del 3D, en copias chicas). Si no entran todas, viene \"siguiente_desde\": llamalo de nuevo con desde. Los PDF no se ven por acá: si hace falta leerlos, pedile al dueño que los adjunte en este chat. Para cotizar, después de abrir_cotizacion usá asignar_requerimiento.",
                inputSchema: { type: "object", properties: {
                    id: { type: "string", description: "Id del requerimiento (de listar_requerimientos)." },
                    desde: { type: "integer", minimum: 0, description: "Opcional: desde qué imagen seguir (lo da siguiente_desde)." },
                    sin_imagenes: { type: "boolean", description: "Opcional: solo los datos, sin imágenes." },
                }, required: ["id"] },
                annotations: { readOnlyHint: true },
            },
            async correr(almacen, uid, e) {
                const r = await leerReq(almacen, e.id);
                const adj = r.adjuntos || {};
                const claves = ordenados(adj);
                const datos = {
                    id: e.id, titulo: r.titulo, estado: r.estado || "pendiente", cliente: r.cliente || null,
                    descripcion: r.descripcion || "", creado: fecha(r.creado),
                    asignado: r.pid ? { cid: r.cid, pid: r.pid, proyecto: r.proyecto_nombre, conv: r.conv, adjuntos_en_proyecto: r.adjuntos_proyecto || undefined } : undefined,
                    adjuntos: claves.map((k, i) => resumenAdjunto(k, adj[k], i + 1)),
                    nota: "Las anotaciones están en píxeles de la foto (de, a, en = [x, y]). Las medidas de las cotas son las que escribió el dueño: no las recalcules desde la imagen.",
                };
                const bloques = [];
                if (!e.sin_imagenes) {
                    const lista = [].concat(...claves.map((k) => imagenesDe(k, adj[k])));
                    const desde = Math.min(Math.max(e.desde || 0, 0), lista.length);
                    let usados = 0, i = desde;
                    for (; i < lista.length; i++) {
                        const im = lista[i];
                        let buf;
                        try { buf = Buffer.from(await almacen.bajarArchivo(im.ruta)); } catch (err) { bloques.push({ type: "text", text: `Imagen ${i + 1} (adjunto ${im.adj}): no se pudo leer.` }); continue; }
                        if (im.original && buf.length > 280 * 1024) { bloques.push({ type: "text", text: `Imagen ${i + 1} (adjunto ${im.adj}, ${adj[im.adj].nombre}): es muy pesada para mostrarla (${Math.round(buf.length / 1024)} KB) y no tiene copia chica.` }); continue; }
                        if (usados && usados + buf.length > TOPE_IMAGENES) break;
                        usados += buf.length;
                        const mime = buf[0] === 0x89 ? "image/png" : buf[0] === 0xff ? "image/jpeg" : "image/webp";
                        bloques.push({ type: "text", text: `Imagen ${i + 1} de ${lista.length} · adjunto ${im.adj} (${adj[im.adj].nombre}) · ${im.que}` });
                        bloques.push({ type: "image", data: buf.toString("base64"), mimeType: mime });
                    }
                    datos.imagenes = { total: lista.length, mostradas: `${lista.length ? desde + 1 : 0}–${i}`, siguiente_desde: i < lista.length ? i : undefined };
                }
                return { __contenido: [{ type: "text", text: JSON.stringify(datos) }].concat(bloques) };
            },
        },
        {
            def: {
                name: "asignar_requerimiento",
                title: "Asignar un requerimiento a una cotización",
                description: "Une un Requerimiento a un proyecto y a la cotización abierta (después de abrir_cotizacion; si el cliente o el proyecto no existen, crealos antes con crear_cliente / crear_proyecto). Necesita la confirmación del dueño: registrá con registrar_mensaje_del_dueno su pedido (\"cotizá este requerimiento para…\") y pasá ese dueño:<id>. Hace: la descripción queda en la conversación como contexto (NO es origen: los números que salgan de ahí, confirmalos con el dueño y registralos) y los adjuntos se copian a los del proyecto con ids nuevos (fotos con sus anotaciones → cotas dibujadas citables como dueño:<adjunto>; fotos y PDF → cota_plano:<adjunto>; 3D → medicion_3d y pieza3d:<adjunto>/…). Si ya estaba asignado a este proyecto, no copia de nuevo. Con cotizado:true (al terminar, después de aplicar_al_presupuesto) lo marca cotizado.",
                inputSchema: { type: "object", properties: {
                    id: { type: "string", description: "Id del requerimiento." },
                    cid: { type: "string" }, pid: { type: "string" }, conv: { type: "string", description: "Id de la conversación (de abrir_cotizacion)." },
                    confirmacion: { type: "string", description: "dueño:<id> del mensaje del dueño que pide cotizarlo (o, con cotizado, que confirma que terminó)." },
                    cotizado: { type: "boolean", description: "Opcional: marcarlo cotizado (al terminar)." },
                }, required: ["id", "cid", "pid", "conv", "confirmacion"] },
                annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
            },
            async correr(almacen, uid, e) {
                const nombreProyecto = await proyecto(almacen, e, true);
                const r = await leerReq(almacen, e.id);
                const alA = acotar(almacen, RUTAS.agente(e.cid, e.pid));
                const RC = R.raizConv(e.cid, e.pid, e.conv);
                // la confirmación: un mensaje del dueño de ESTA conversación
                const m = /^dueño:([A-Za-z0-9_-]{1,64})$/.exec(String(e.confirmacion || "").trim());
                if (!m) falla("confirmacion: dueño:<id> (registrá antes el pedido del dueño con registrar_mensaje_del_dueno)");
                const msg = await alA.leer(`${RC}/conversacion/mensajes/${m[1]}`);
                if (!msg || msg.rol !== "dueno") falla(`no hay un mensaje del dueño ${m[1]} en esta cotización`);
                if (msg.copiado_de) falla("esa confirmación es de otra versión: el dueño tiene que confirmar en esta cotización");
                if (r.estado === "descartado") falla("el requerimiento está descartado: el dueño lo puede reabrir en la app");
                if (r.pid && (r.cid !== e.cid || r.pid !== e.pid)) falla(`ya está asignado a otro proyecto (${r.cid}/${r.pid}, ${r.proyecto_nombre || ""}): el dueño lo puede cambiar en la app`);
                const ahora = almacen.ahora();
                if (e.cotizado) {
                    if (!r.pid) falla("primero asignalo");
                    await alReq(almacen).actualizar(`requerimientos/${e.id}`, { estado: "cotizado", cotizado: ahora, actualizado: ahora });
                    return { ok: true, estado: "cotizado" };
                }
                // Ya asignado a este proyecto (desde esta u otra cotización): no se copia de nuevo
                if (r.pid && r.adjuntos_proyecto) {
                    return { ok: true, ya_asignado: true, conv: r.conv, adjuntos: r.adjuntos_proyecto,
                        aviso: r.conv !== e.conv ? `ya estaba asignado a este proyecto desde la cotización ${r.conv}: los adjuntos del proyecto son los mismos` : undefined };
                }
                // 1) la descripción queda en la conversación como CONTEXTO (rol "aviso"), no como origen: puede traer números
                //    del cliente. Los que importan para el costo, que los confirme el dueño (registrar_mensaje_del_dueno).
                let mensaje = null;
                if (String(r.descripcion || "").trim()) {
                    mensaje = await alA.agregar(`${RC}/conversacion/mensajes`, { rol: "aviso", tipo: "requerimiento", texto: `Requerimiento ${e.id}${r.cliente && r.cliente.nombre ? ` · ${r.cliente.nombre}` : ""}:\n${String(r.descripcion).slice(0, 20000)}`, fecha: ahora, via: "requerimiento" });
                }
                // 2) los adjuntos, copiados al proyecto (archivos en agente/{cid}/{pid}/{nuevo}/…)
                const adj = r.adjuntos || {};
                const mapa = {};
                for (const k of ordenados(adj)) {
                    const a = adj[k];
                    if (!a || !["imagen", "pdf", "3d"].includes(a.tipo)) continue;   // "otro" (DWG, Excel…) el agente no lo lee
                    const nuevo = alA.nuevaClave();
                    const base = `agente/${e.cid}/${e.pid}/${nuevo}`;
                    const copiar = async (desde, nombre) => {
                        const buf = await almacen.bajarArchivo(desde);
                        const destino = `${base}/${nombre}`;
                        await almacen.subirArchivo(destino, buf, nombre.endsWith(".json") ? "application/json" : nombre.endsWith(".pdf") ? "application/pdf" : nombre.endsWith(".png") ? "image/png" : nombre.endsWith(".webp") ? "image/webp" : "image/jpeg");
                        return destino;
                    };
                    const meta = { nombre: a.nombre, tipo: a.tipo, mime: a.mime, bytes: a.bytes, fecha: ahora, via: "requerimiento", requerimiento: `${e.id}/${k}` };
                    if (a.tipo === "imagen") {
                        meta.ruta = await copiar(a.ruta, a.ruta.split("/").pop());
                        if (a.anotada_ruta) meta.anotada_ruta = await copiar(a.anotada_ruta, "anotada.jpg");
                        if (a.anotaciones) meta.anotaciones = a.anotaciones;
                        if (a.ancho && a.alto) { meta.ancho = a.ancho; meta.alto = a.alto; }
                    } else if (a.tipo === "pdf") {
                        meta.ruta = await copiar(a.ruta, a.ruta.split("/").pop());
                    } else {
                        meta.medicion_ruta = await copiar(a.medicion_ruta, "medicion.json");
                        meta.resumen = a.resumen; meta.piezas = a.piezas;
                        if (a.tamano_m) meta.tamano_m = a.tamano_m;
                        if (a.unidad) meta.unidad = a.unidad;
                        if (a.vistas_rutas) {
                            meta.vistas_rutas = [];
                            for (let i = 0; i < a.vistas_rutas.length; i++) meta.vistas_rutas.push(await copiar(a.vistas_rutas[i], `vista${i + 1}.jpg`));
                            meta.vistas_nombres = a.vistas_nombres || [];
                        }
                    }
                    Object.keys(meta).forEach((x) => meta[x] === undefined && delete meta[x]);
                    await alA.escribir(`${R.RAIZ(e.cid, e.pid)}/adjuntos/${nuevo}`, meta);
                    mapa[k] = { adjunto: nuevo, tipo: a.tipo, nombre: a.nombre,
                        cita: a.tipo === "3d" ? `medicion_3d {adjunto:"${nuevo}"} → pieza3d:${nuevo}/<p1,p2…>` : a.tipo === "pdf" ? `cota_plano:${nuevo} p.<n> "<cita>"` : (a.anotaciones ? `dueño:${nuevo} (cotas dibujadas) o cota_plano:${nuevo} "<cita>"` : `cota_plano:${nuevo} "<cita>"`) };
                }
                const otros = ordenados(adj).filter((k) => adj[k] && adj[k].tipo === "otro").map((k) => adj[k].nombre);
                await alReq(almacen).actualizar(`requerimientos/${e.id}`, {
                    estado: "asignado", cid: e.cid, pid: e.pid, conv: e.conv, proyecto_nombre: String(nombreProyecto).slice(0, 120),
                    mensaje_descripcion: mensaje, adjuntos_proyecto: mapa, asignado: ahora, actualizado: ahora,
                });
                // para que el Agente IA de la app se entere si abren esta conversación ahí
                await alA.agregar(`${RC}/conversacion/ediciones`, { texto: `Desde Claude: se asignó el requerimiento ${e.id} (${r.titulo || ""}) con ${Object.keys(mapa).length} adjunto(s).`.slice(0, 600), fecha: ahora });
                return { ok: true, proyecto: nombreProyecto, descripcion: mensaje ? "quedó en la conversación como contexto (no es origen): las medidas y cantidades que salgan de ahí, confirmalas con el dueño y registralas" : undefined, adjuntos: mapa,
                    sin_copiar: otros.length ? { archivos: otros, motivo: "no son foto, PDF ni 3D: si hacen falta, pedile al dueño que los adjunte en el chat" } : undefined,
                    siguiente: "buscar_base / medicion_3d → armar_borrador citando estos orígenes" };
            },
        },
        {
            def: {
                name: "generar_render",
                title: "Generar un render (Gemini)",
                description: "Pide un render fotorrealista a Gemini (de la app; modelo fijo: calidad normal = Nano Banana 2.1, ~US$0,03–0,05; alta = Nano Banana Pro, ~US$0,13) a partir de las fotos del requerimiento y tu pedido, y te DEVUELVE LA IMAGEN para que la revises (si tarda más de ~40 s, devuelve el id con estado en_proceso: pedilo con ver_render): si algo no respeta el pedido, llamalo de nuevo con base_render y la corrección. Escribí el prompt como experto (materiales, acabados, iluminación, qué se conserva de la foto); NO pidas cotas ni medidas dibujadas (el modelo inventa números: las medidas van aparte). Gasta plata: no generes de más (máx. " + MAX_RENDERS + " por requerimiento). Queda guardado en el requerimiento; para usarlo como imagen del ítem: aprobar_render.",
                inputSchema: { type: "object", properties: {
                    id: { type: "string", description: "Id del requerimiento." },
                    prompt: { type: "string", maxLength: 6000, description: "Qué generar (en español o inglés)." },
                    referencias: { type: "array", maxItems: 6, items: { type: "string" }, description: "Opcional: ids de adjuntos (adj) del requerimiento a usar como referencia; por defecto, todas sus fotos (hasta 4). Se manda la foto original, sin las cotas dibujadas." },
                    base_render: { type: "string", description: "Opcional: id de un render anterior para corregirlo (va como primera referencia)." },
                    calidad: { type: "string", enum: ["normal", "alta"], description: "Por defecto normal." },
                    aspecto: { type: "string", enum: REN.ASPECTOS, description: "Opcional: por defecto, el de la primera referencia." },
                    tamano: { type: "string", enum: ["1K", "2K"], description: "Por defecto 1K (2K para la versión final)." },
                }, required: ["id", "prompt"] },
                annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
            },
            async correr(almacen, uid, e) {
                const r = await leerReq(almacen, e.id);
                if (r.estado === "descartado") falla("el requerimiento está descartado");
                const prompt = String(e.prompt || "").trim();
                if (prompt.length < 10) falla("el prompt es muy corto: describí qué querés ver");
                const previos = r.renders || {};
                const vigentes = Object.keys(previos).filter((k) => previos[k] && previos[k].estado !== "error");
                if (vigentes.length >= MAX_RENDERS) falla(`ya hay ${MAX_RENDERS} renders en este requerimiento: aprobá uno o pedile al dueño que siga desde la app`);
                if (vigentes.some((k) => ["en_proceso", "generando"].includes(previos[k].estado) && ESPERA.ahora() - (previos[k].fecha || 0) < 5 * 60000)) {
                    falla("ya hay un render generándose en este requerimiento: esperá y miralo con ver_render");
                }
                const adj = r.adjuntos || {};
                // referencias: render base + fotos originales (sin cotas dibujadas) o la vista del 3D
                const refs = [], usadas = [];
                if (e.base_render) {
                    const b = previos[e.base_render];
                    if (!b || !b.ruta) falla(`no existe el render ${e.base_render} (o no terminó) en este requerimiento`);
                    refs.push({ ruta: b.ruta, mime: "image/jpeg" }); usadas.push(`render:${e.base_render}`);
                }
                const ids = (Array.isArray(e.referencias) && e.referencias.length ? e.referencias : ordenados(adj).filter((k) => adj[k].tipo === "imagen").slice(0, 4)).slice(0, 6);
                let primera = null;
                for (const k of ids) {
                    const a = adj[k];
                    if (!a) falla(`no existe el adjunto ${k} en este requerimiento`);
                    if (a.tipo === "imagen") { refs.push({ ruta: a.ruta, mime: a.mime || "image/jpeg" }); usadas.push(k); if (!primera) primera = a; }
                    else if (a.tipo === "3d" && a.vistas_rutas && a.vistas_rutas[0]) { refs.push({ ruta: a.vistas_rutas[0], mime: "image/jpeg" }); usadas.push(`${k}:vista1`); }
                    else falla(`el adjunto ${k} (${a.nombre}) no es una foto ni un 3D con vistas`);
                }
                const base = e.base_render ? previos[e.base_render] : null;
                const aspecto = e.aspecto || (base && base.aspecto) || (primera ? REN.aspectoDe(primera.ancho, primera.alto) : "4:3");
                const calidad = e.calidad === "alta" ? "alta" : "normal";
                const tamano = e.tamano === "2K" ? "2K" : "1K";
                const costo = REN.MODELOS[calidad].usd[tamano];
                const rid = almacen.nuevaClave();
                const ahora = ESPERA.ahora();
                const rutaMeta = `requerimientos/${e.id}/renders/${rid}`;
                await alReq(almacen).escribir(rutaMeta, { estado: "en_proceso", modelo_pedido: REN.MODELOS[calidad].id, calidad, tamano, aspecto,
                    prompt: prompt.slice(0, 6000), referencias: usadas, base_render: e.base_render || null, costo_usd_aprox: costo, fecha: ahora, por: "claude" });
                await alReq(almacen).actualizar(`requerimientos/${e.id}`, { actualizado: ahora });
                await acotar(almacen, [/^render_cola\/[A-Za-z0-9_-]+$/]).escribir(`render_cola/${rid}`, {
                    req: e.id, rid, uid, prompt: prompt + REGLAS_RENDER, referencias: refs, calidad, tamano, aspecto, fecha: ahora });
                console.log("[rubikMcp] generar_render encolado", JSON.stringify({ req: e.id, rid, calidad, tamano, refs: usadas.length, costo }));
                return esperarRender(almacen, e.id, rid, ESPERA.ms, { referencias: usadas, renders_en_el_requerimiento: vigentes.length + 1 });
            },
        },
        {
            def: {
                name: "ver_render",
                title: "Ver un render",
                description: "Estado o imagen de un render pedido con generar_render (si no terminó a tiempo, generar_render devuelve su id con estado en_proceso). Si sigue generándose, esperá unos segundos y volvé a pedirlo. Sin render: lista los del requerimiento.",
                inputSchema: { type: "object", properties: {
                    id: { type: "string", description: "Id del requerimiento." }, render: { type: "string", description: "Opcional: id del render." },
                }, required: ["id"] },
                annotations: { readOnlyHint: true },
            },
            async correr(almacen, uid, e) {
                const r = await leerReq(almacen, e.id);
                const ren = r.renders || {};
                if (!e.render) {
                    return { renders: Object.keys(ren).sort((a, b) => (ren[a].fecha || 0) - (ren[b].fecha || 0)).map((k) => ({ render: k, estado: ren[k].estado || "listo",
                        calidad: ren[k].calidad, tamano: ren[k].tamano, fecha: fecha(ren[k].fecha), aprobado: ren[k].aprobado ? ren[k].aprobado.desc || true : undefined, error: ren[k].error || undefined })),
                    matriz: r.matriz || undefined };
                }
                if (!ID.test(String(e.render)) || !ren[e.render]) falla(`no existe el render ${e.render} en este requerimiento`);
                return esperarRender(almacen, e.id, e.render, Math.min(ESPERA.ms, 15000), {});
            },
        },
        {
            def: {
                name: "aprobar_render",
                title: "Aprobar un render como imagen del ítem",
                description: "Con la confirmación del dueño (dueño:<id> de esta cotización, posterior a que le mostraste el render), el render pasa a ser la IMAGEN PRINCIPAL de un ítem del presupuesto (la que sale en el PDF y en producción). La imagen anterior del ítem no se pierde: queda entre sus imágenes (cortes). El ítem tiene que estar en el presupuesto (después de aplicar_al_presupuesto). El requerimiento tiene que estar asignado a este proyecto.",
                inputSchema: { type: "object", properties: {
                    id: { type: "string", description: "Id del requerimiento." }, render: { type: "string", description: "Id del render (de generar_render)." },
                    cid: { type: "string" }, pid: { type: "string" }, conv: { type: "string" },
                    item: { type: "string", description: "n (posición) o id del ítem del presupuesto (ver_presupuesto)." },
                    confirmacion: { type: "string", description: "dueño:<id> del mensaje del dueño que aprueba el render." },
                }, required: ["id", "render", "cid", "pid", "conv", "item", "confirmacion"] },
                annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
            },
            async correr(almacen, uid, e) {
                await proyecto(almacen, e, true);
                const r = await leerReq(almacen, e.id);
                if (r.cid !== e.cid || r.pid !== e.pid) falla("el requerimiento no está asignado a este proyecto: primero asignar_requerimiento");
                const ren = (r.renders || {})[e.render];
                if (!ID.test(String(e.render || "")) || !ren) falla(`no existe el render ${e.render} en este requerimiento`);
                if (ren.estado && ren.estado !== "listo") falla(`el render ${e.render} no está listo (${ren.estado})`);
                const alA = acotar(almacen, RUTAS.aplicar(e.cid, e.pid));
                const RC = R.raizConv(e.cid, e.pid, e.conv);
                const m = /^dueño:([A-Za-z0-9_-]{1,64})$/.exec(String(e.confirmacion || "").trim());
                if (!m) falla("confirmacion: dueño:<id> (mostrale el render al dueño y registrá su aprobación)");
                const msg = await alA.leer(`${RC}/conversacion/mensajes/${m[1]}`);
                if (!msg || msg.rol !== "dueno" || msg.copiado_de) falla(`no hay un mensaje del dueño ${m[1]} en esta cotización`);
                if (!(msg.fecha > ren.fecha)) falla("la aprobación tiene que ser un mensaje del dueño posterior al render (mostráselo y esperá su respuesta)");
                const rutaPres = `proyectos/${e.cid}/${e.pid}/presupuesto`;
                const items = (await alA.leer(`${rutaPres}/items`)) || [];
                const claves = Array.isArray(items) ? items.map((_, i) => String(i)) : Object.keys(items).sort((a, b) => Number(a) - Number(b));
                const k = claves.find((c) => c === String(e.item) || (items[c] && items[c].id && items[c].id === e.item));
                const it = k != null ? items[k] : null;
                if (!it || it.type === "chapter") falla(`no hay un ítem ${e.item} en el presupuesto (mirá ver_presupuesto)`);
                if (it.render_req && it.render_req.render === e.render) return { ok: true, ya_aprobado: true, item: it.desc, img: it.img };
                // la imagen, con enlace de descarga como las del presupuesto
                const buf = await almacen.bajarArchivo(ren.ruta);
                const ahora = almacen.ahora();
                const url = await almacen.subirArchivo(`presupuesto/render_req_${e.pid}_${e.render}.jpg`, buf, "image/jpeg", { token: REN.nuevoToken() });
                const dia = new Date(ahora - 4 * 3600 * 1000).toISOString().slice(0, 10);
                const respaldo = await alA.agregar(`respaldos_agente/${dia}`, { ruta: `${rutaPres}/items/${k}`, antes: JSON.stringify(it), motivo: "aprobar_render (conector Claude)", conv: e.conv, fecha: ahora, por: uid });
                const cambios = { img: url, render_req: { requerimiento: e.id, render: e.render, fecha: ahora } };
                if (it.img) {
                    const cortes = it.cortes || [];
                    if (Array.isArray(cortes)) cambios.cortes = cortes.concat([it.img]);
                    else { cambios[`cortes/${alA.nuevaClave()}`] = it.img; }
                }
                await alA.actualizar(`${rutaPres}/items/${k}`, cambios);
                await alReq(almacen).actualizar(`requerimientos/${e.id}`, { matriz: e.render, actualizado: ahora, [`renders/${e.render}/aprobado`]: { item: it.id || Number(k), desc: it.desc, fecha: ahora } });
                await alA.agregar(`${RC}/conversacion/mensajes`, { rol: "aviso", fecha: ahora, texto: `🖼 Render aprobado como imagen del ítem "${String(it.desc || "").slice(0, 80)}" (desde Claude).` });
                return { ok: true, item: it.desc, n: Number(k), img: url, imagen_anterior: it.img ? "quedó entre las imágenes del ítem (cortes)" : undefined, respaldo: `respaldos_agente/${dia}/${respaldo}`,
                    aviso: "Si el dueño tiene el presupuesto abierto en la app, que lo recargue." };
            },
        },
    ];
};

module.exports.RUTAS_REQ = RUTAS_REQ;
module.exports.TOPE_IMAGENES = TOPE_IMAGENES;
module.exports.MAX_RENDERS = MAX_RENDERS;
module.exports.configurarEspera = (c) => { ESPERA = Object.assign({}, ESPERA, c); };
