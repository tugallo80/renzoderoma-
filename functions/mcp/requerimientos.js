/**
 * Herramientas del conector para los Requerimientos (sesión 6, docs/sesiones/06-render-requerimiento.md).
 * El dueño carga en la app lo que pidió el cliente (requerimiento.html, sin IA); Claude lo toma desde acá:
 *   listar_requerimientos  → los pendientes (o de otro estado)
 *   leer_requerimiento     → descripción, cliente, adjuntos con sus anotaciones como datos y las fotos como imagen
 *   asignar_requerimiento  → lo une a un proyecto y a una cotización: la descripción queda como mensaje del dueño y los
 *                            adjuntos se copian a los del proyecto (mismo formato que el Agente IA), así medicion_3d y los
 *                            orígenes dueño:/cota_plano:/pieza3d: funcionan igual. Con cotizado:true lo marca cotizado.
 * Se arma con las ayudas de herramientas.js (sin require circular).
 */
const R = require("../agente/rutas");

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ESTADOS = ["pendiente", "asignado", "cotizado", "descartado"];
/** Lo que devuelve leer_requerimiento por llamada: unos 300 KB de imágenes (probado en claude.ai hasta ~300 KB). */
const TOPE_IMAGENES = 300 * 1024;
/** Nodos de la base que tocan estas herramientas (además del cerco del conector). */
const RUTAS_REQ = [/^requerimientos(\/|$)/];

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
    ];
};

module.exports.RUTAS_REQ = RUTAS_REQ;
module.exports.TOPE_IMAGENES = TOPE_IMAGENES;
