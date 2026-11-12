/**
 * Herramientas del conector MCP "Rubik" (etapa 1). Ver docs/sesiones/05-rubik-agente-app.md.
 *
 * - Las de cotizar son LAS MISMAS del Agente IA de la app (functions/agente/herramientas.js): misma validación de origen,
 *   recetas, rutas A/B, alternativas, "por confirmar", características, normas y memoria. Acá solo se les agrega
 *   cid/pid/conv (en la app los pone el chat) y se corren con el mismo contexto.
 * - La cotización termina en el MISMO borrador del agente: /proyectos/{cid}/{pid}/agente/conversaciones/{conv}/borrador
 *   (una conversación por chat de Claude). El dueño lo ve y lo aplica desde la app, o con aplicar_al_presupuesto.
 * - Cada herramienta valida su entrada y corre con un almacén ACOTADO a los nodos que le tocan (almacen.acotar).
 * - Lo que el dueño dice en el chat de Claude vale como origen "dueño:<id>" solo si se registró con
 *   registrar_mensaje_del_dueno (queda en la conversación de la app, como si lo hubiera escrito ahí).
 */
const AG = require("../agente/herramientas");
const B = require("../agente/compartido/agente-borrador.js");
const N = require("../agente/compartido/agente-nucleo.js");
const R = require("../agente/rutas");
const API = require("../agente/api");
const { acotar } = require("../agente/almacen");

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const lista = (x) => (Array.isArray(x) ? x : Object.keys(x || {}).sort((a, b) => Number(a) - Number(b)).map((k) => x[k])).filter(Boolean);

class ErrorHerramienta extends Error {}
const falla = (m) => { throw new ErrorHerramienta(m); };

// ---------------------------------------------------------------- nodos que puede tocar cada grupo de herramientas
const RUTAS = {
    clientes: () => [/^clientes(\/|$)/],
    proyectos: (cid) => [new RegExp(`^proyectos/${esc(cid)}(/[^/]+)?(/(nombre|estado|fecha_creacion|tipo|orden))?$`), new RegExp(`^clientes/${esc(cid)}$`)],
    presupuesto: (cid, pid) => [new RegExp(`^proyectos/${esc(cid)}/${esc(pid)}(/(nombre|estado|presupuesto)(/.*)?)?$`)],
    // lo mismo que el agente de la app, pero solo de ESTE proyecto
    agente: (cid, pid) => [
        new RegExp(`^proyectos/${esc(cid)}/${esc(pid)}/agente(/|$)`),
        new RegExp(`^proyectos/${esc(cid)}/${esc(pid)}/presupuesto(/|$)`),
        /^base_datos(\/|$)/, /^agente_memoria(\/|$)/, /^config\/agente$/,
    ],
    aplicar: (cid, pid) => [
        new RegExp(`^proyectos/${esc(cid)}/${esc(pid)}/(agente|presupuesto)(/|$)`),
        /^respaldos_agente\/\d{4}-\d{2}-\d{2}(\/|$)/,
    ],
    base: () => [/^base_datos(\/|$)/],
    memoria: () => [/^agente_memoria(\/|$)/, /^base_datos(\/|$)/],
};

// ---------------------------------------------------------------- esquemas comunes
const P_CID = { type: "string", description: "Id del cliente (de listar_clientes)." };
const P_PID = { type: "string", description: "Id del proyecto (de listar_proyectos)." };
const P_CONV = { type: "string", description: "Id de la conversación de esta cotización (lo da abrir_cotizacion). Usá siempre el mismo en todo el chat." };

function conProyecto(schema, conConv) {
    const s = JSON.parse(JSON.stringify(schema || { type: "object", properties: {} }));
    s.properties = Object.assign({ cid: P_CID, pid: P_PID }, conConv ? { conv: P_CONV } : {}, s.properties || {});
    s.required = ["cid", "pid"].concat(conConv ? ["conv"] : [], s.required || []);
    return s;
}

/** Revisa cid/pid/conv y que el proyecto exista. */
async function proyecto(almacen, e, conConv) {
    if (!ID.test(String(e.cid || "")) || !ID.test(String(e.pid || ""))) falla("cid/pid inválidos");
    if (conConv && (!e.conv || !ID.test(String(e.conv)) || e.conv === R.PRINCIPAL)) falla("conv inválida: abrí la cotización con abrir_cotizacion y usá su id");
    const al = acotar(almacen, RUTAS.presupuesto(e.cid, e.pid));
    const p = (await al.leer(`proyectos/${e.cid}/${e.pid}/nombre`)) || ((await al.leer(`proyectos/${e.cid}/${e.pid}/estado`)) != null ? "(sin nombre)" : null);
    if (p == null) falla(`no existe el proyecto ${e.pid} del cliente ${e.cid}`);
    if (conConv && !(await almacen.leer(`proyectos/${e.cid}/${e.pid}/agente/conversaciones_meta/${e.conv}`))) falla(`no existe la conversación ${e.conv} en este proyecto: abrila con abrir_cotizacion`);
    return p;
}

/** Corre una herramienta del agente de la app con el contexto de este proyecto y conversación. */
async function correrDelAgente(nombre, almacen, uid, e, entrada) {
    const h = AG.HERRAMIENTAS.find((x) => x.def.name === nombre);
    const ctx = { almacen: acotar(almacen, RUTAS.agente(e.cid || "-", e.pid || "-")), cid: e.cid, pid: e.pid, conv: e.conv, uid, mensajesAgente: [] };
    return h.correr(ctx, entrada);
}

const sinProyecto = (e) => { const x = Object.assign({}, e); delete x.cid; delete x.pid; delete x.conv; return x; };
const defAgente = (nombre) => AG.HERRAMIENTAS.find((x) => x.def.name === nombre).def;

const NOTA_ORIGEN = "\nEn este chat (Claude, fuera de la app): lo que dice el dueño se cita como dueño:<id> con el id que devuelve registrar_mensaje_del_dueno; una cota leída de un PDF o una foto adjuntos al chat, como cota_plano:<id> p.<n> \"<cita>\" con el id de registrar_lectura_de_archivo.";

// ---------------------------------------------------------------- resúmenes
function totalItems(items) {
    let total = 0, n = 0, apagados = 0;
    lista(items).forEach((x) => {
        if (x.type === "chapter") return;
        n++;
        if (x.activo === false) { apagados++; return; }
        total += (parseFloat(x.pu) || 0) * (parseFloat(x.cant) || 0);
    });
    return { items: n, total: r2(total), fuera_del_total: apagados || undefined };
}

function filaApu(f, i) {
    const x = [i + 1, f.d, `${f.q} ${f.u || ""}`.trim(), f.p];
    const o = [f.origen_q && `q ${f.origen_q}`, f.origen_p && `p ${f.origen_p}`].filter(Boolean).join(" · ");
    if (o) x.push(o);
    return x;
}

// ---------------------------------------------------------------- herramientas
const HERRAMIENTAS = [
    // ---------- clientes y proyectos
    {
        def: {
            name: "listar_clientes",
            title: "Listar clientes",
            description: "Lista los clientes de Rubik (id, nombre, rubro). Filtrá por texto (sin acentos). Para trabajar con un cliente usá su id en listar_proyectos.",
            inputSchema: { type: "object", properties: { texto: { type: "string", description: "Opcional: parte del nombre o del rubro." }, limite: { type: "integer", description: "Por defecto 50, máximo 200." } } },
            annotations: { readOnlyHint: true },
        },
        async correr(almacen, uid, e) {
            const todos = (await acotar(almacen, RUTAS.clientes()).leer("clientes")) || {};
            const q = norm(e.texto);
            const res = Object.keys(todos).filter((k) => todos[k] && typeof todos[k] === "object")
                .map((k) => ({ cid: k, nombre: todos[k].nombre || "(sin nombre)", rubro: todos[k].rubro || undefined }))
                .filter((c) => !q || norm(`${c.nombre} ${c.rubro || ""}`).includes(q))
                .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
            const lim = Math.min(Math.max(parseInt(e.limite || 50, 10) || 50, 1), 200);
            return { encontrados: res.length, clientes: res.slice(0, lim) };
        },
    },
    {
        def: {
            name: "crear_cliente",
            title: "Crear cliente",
            description: "Crea un cliente nuevo en el directorio de Rubik (como en clientes.html). Si ya hay uno con el mismo nombre, NO lo crea y devuelve el existente (para crearlo igual: forzar true, solo si el dueño lo confirma). El logo, la portada y el PIN del portal se cargan después en la app.",
            inputSchema: {
                type: "object",
                properties: {
                    nombre: { type: "string", maxLength: 120 }, rubro: { type: "string", maxLength: 120 },
                    wsp: { type: "string", maxLength: 40, description: "WhatsApp, si el dueño lo dio." }, email: { type: "string", maxLength: 120 },
                    forzar: { type: "boolean" },
                },
                required: ["nombre"],
            },
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        },
        async correr(almacen, uid, e) {
            const al = acotar(almacen, RUTAS.clientes());
            const nombre = String(e.nombre).trim();
            if (nombre.length < 2) falla("nombre muy corto");
            if (e.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email)) falla("email inválido");
            const todos = (await al.leer("clientes")) || {};
            const igual = Object.keys(todos).find((k) => todos[k] && norm(todos[k].nombre) === norm(nombre));
            if (igual && !e.forzar) return { creado: false, ya_existe: { cid: igual, nombre: todos[igual].nombre }, aviso: "Ya hay un cliente con ese nombre: usá ese cid. Si el dueño confirma que es otro, repetí con forzar: true." };
            const ahora = new Date(almacen.ahora()).toISOString();
            const cid = await al.agregar("clientes", { nombre, rubro: String(e.rubro || "").trim(), wsp: String(e.wsp || "").trim(), email: String(e.email || "").trim(), logo: "", cover: "", fecha_creacion: ahora, fecha_mod: ahora, creado_por: "claude" });
            return { creado: true, cid, nombre };
        },
    },
    {
        def: {
            name: "listar_proyectos",
            title: "Listar proyectos de un cliente",
            description: "Lista los proyectos de un cliente con su estado (cotizacion, planificacion, produccion, entregado, cerrado), mes, cantidad de ítems y total del presupuesto (sin impuestos ni descuento; los ítems apagados no suman), y cuántas cotizaciones del agente tiene.",
            inputSchema: { type: "object", properties: { cid: P_CID, estado: { type: "string", enum: ["cotizacion", "planificacion", "produccion", "entregado", "cerrado"] }, texto: { type: "string" } }, required: ["cid"] },
            annotations: { readOnlyHint: true },
        },
        async correr(almacen, uid, e) {
            if (!ID.test(String(e.cid || ""))) falla("cid inválido");
            const al = acotar(almacen, [new RegExp(`^proyectos/${esc(e.cid)}$`), new RegExp(`^clientes/${esc(e.cid)}$`)]);
            const cli = await al.leer(`clientes/${e.cid}`);
            if (!cli) falla(`no existe el cliente ${e.cid}`);
            const ps = (await al.leer(`proyectos/${e.cid}`)) || {};
            const q = norm(e.texto);
            const res = Object.keys(ps).filter((k) => ps[k] && typeof ps[k] === "object").map((k) => {
                const p = ps[k], pres = p.presupuesto || {};
                const ag = p.agente || {};
                return Object.assign({ pid: k, nombre: p.nombre || "(sin nombre)", estado: typeof p.estado === "string" ? p.estado : "planificacion",
                    mes: String(p.fecha_creacion || "").slice(0, 7) || undefined, tipo: p.tipo || undefined },
                totalItems(pres.items), { cotizaciones_agente: Object.keys(ag.conversaciones_meta || {}).length || undefined });
            }).filter((p) => (!e.estado || p.estado === e.estado) && (!q || norm(p.nombre).includes(q)))
                .sort((a, b) => String(b.mes || "").localeCompare(String(a.mes || "")));
            return { cliente: cli.nombre, proyectos: res };
        },
    },
    {
        def: {
            name: "crear_proyecto",
            title: "Crear proyecto",
            description: "Crea un proyecto dentro de un cliente (como en proyectos-cliente.html), por defecto en estado \"cotizacion\". Si ya hay uno con el mismo nombre en ese cliente, no lo crea y devuelve el existente (forzar: true para crearlo igual, si el dueño lo confirma).",
            inputSchema: {
                type: "object",
                properties: {
                    cid: P_CID, nombre: { type: "string", maxLength: 120 },
                    estado: { type: "string", enum: ["cotizacion", "planificacion", "produccion", "entregado", "cerrado"] },
                    mes: { type: "string", description: "Opcional: AAAA-MM del proyecto (por defecto, este mes)." },
                    agencia: { type: "boolean", description: "Formato de cotización de agencia (solo si el dueño lo pide)." },
                    forzar: { type: "boolean" },
                },
                required: ["cid", "nombre"],
            },
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        },
        async correr(almacen, uid, e) {
            if (!ID.test(String(e.cid || ""))) falla("cid inválido");
            const al = acotar(almacen, RUTAS.proyectos(e.cid));
            if (!(await al.leer(`clientes/${e.cid}`))) falla(`no existe el cliente ${e.cid}`);
            const nombre = String(e.nombre).trim();
            if (nombre.length < 2) falla("nombre muy corto");
            if (e.mes && !/^\d{4}-(0[1-9]|1[0-2])$/.test(e.mes)) falla("mes: AAAA-MM");
            const ps = (await acotar(almacen, [new RegExp(`^proyectos/${esc(e.cid)}$`)]).leer(`proyectos/${e.cid}`)) || {};
            const igual = Object.keys(ps).find((k) => ps[k] && norm(ps[k].nombre) === norm(nombre));
            if (igual && !e.forzar) return { creado: false, ya_existe: { pid: igual, nombre: ps[igual].nombre, estado: ps[igual].estado }, aviso: "Ya hay un proyecto con ese nombre en este cliente: usá ese pid. Si es otro, repetí con forzar: true." };
            const fecha = e.mes ? `${e.mes}-01T00:00:00.000Z` : new Date(almacen.ahora()).toISOString();
            const datos = { nombre, estado: e.estado || "cotizacion", fecha_creacion: fecha, orden: Object.keys(ps).length };
            if (e.agencia) datos.tipo = "agencia";
            const pid = await al.agregar(`proyectos/${e.cid}`, datos);
            return { creado: true, cid: e.cid, pid, nombre, estado: datos.estado, siguiente: "abrir_cotizacion para empezar a cotizar en este proyecto" };
        },
    },
    {
        def: {
            name: "ver_presupuesto",
            title: "Ver presupuesto",
            description: "Muestra el presupuesto de un proyecto tal como está en la app: capítulos, ítems (n = posición, id, nombre, cantidad, unidad, PU, total, si está apagado o es del agente) y el total. Con \"item\" (n o id) trae además el APU de ese ítem (filas mat/mo/eq/sub con su origen) y sus características.",
            inputSchema: { type: "object", properties: { cid: P_CID, pid: P_PID, item: { type: "string", description: "Opcional: n (posición) o id del ítem para ver su APU." } }, required: ["cid", "pid"] },
            annotations: { readOnlyHint: true },
        },
        async correr(almacen, uid, e) {
            const nombre = await proyecto(almacen, e, false);
            const al = acotar(almacen, RUTAS.presupuesto(e.cid, e.pid));
            const estado = await al.leer(`proyectos/${e.cid}/${e.pid}/estado`);
            const pres = (await al.leer(`proyectos/${e.cid}/${e.pid}/presupuesto`)) || {};
            const items = lista(pres.items);
            const salida = { proyecto: nombre, estado: typeof estado === "string" ? estado : "planificacion", ...totalItems(items),
                impuestos: pres.impuestos || undefined, descuento: pres.descuento || pres.descuento_pct ? { bs: pres.descuento || 0, pct: pres.descuento_pct || 0 } : undefined, filas: [] };
            items.forEach((x, i) => {
                if (x.type === "chapter") { salida.filas.push({ n: i, capitulo: x.name }); return; }
                const f = { n: i, id: x.id || undefined, desc: x.desc, cant: `${x.cant} ${x.und || ""}`.trim(), pu: r2(x.pu), total: r2((parseFloat(x.pu) || 0) * (parseFloat(x.cant) || 0)) };
                if (x.activo === false) f.apagado = true;
                if (x.origen === "agente") f.agente = (x.agente && x.agente.condicion) || true;
                salida.filas.push(f);
            });
            if (e.item != null && e.item !== "") {
                const k = items.findIndex((x, i) => String(i) === String(e.item) || (x.id && x.id === e.item));
                const it = items[k];
                if (!it || it.type === "chapter") falla(`no hay un ítem ${e.item}`);
                const apu = it.apu || {};
                salida.detalle = { n: k, desc: it.desc, caracteristicas: it.feat || undefined, recargos: { cs: apu.cs, ind: apu.ind, util: apu.util },
                    mat: lista(apu.mat).map(filaApu), mo: lista(apu.mo).map(filaApu), eq: lista(apu.eq).map(filaApu), sub: lista(apu.sub).map(filaApu) };
            }
            return salida;
        },
    },

    // ---------- cotizar: abrir, registrar lo del chat, borrador
    {
        def: {
            name: "abrir_cotizacion",
            title: "Abrir cotización",
            description: "Empieza una cotización en un proyecto: crea una conversación NUEVA del Agente IA de la app (sin historial, con su propio borrador) y devuelve su id (conv), las normas del taller, la memoria del dueño, el presupuesto actual (para no duplicar) y los adjuntos del proyecto (3D medidos en la app, PDF y fotos con su resumen). Usá UNA conversación por chat de Claude: si ya la abriste en este chat, pasá su conv para retomarla (devuelve el borrador y los últimos mensajes).",
            inputSchema: { type: "object", properties: { cid: P_CID, pid: P_PID, conv: { type: "string", description: "Opcional: para retomar una conversación ya abierta." }, titulo: { type: "string", maxLength: 60, description: "Opcional: título corto (ej. \"Stand feria\")." } }, required: ["cid", "pid"] },
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        },
        async correr(almacen, uid, e) {
            const nombre = await proyecto(almacen, e, false);
            const al = acotar(almacen, RUTAS.agente(e.cid, e.pid));
            const raiz = R.RAIZ(e.cid, e.pid);
            let conv = e.conv, nueva = false;
            if (conv) {
                if (!ID.test(String(conv)) || conv === R.PRINCIPAL || !(await al.leer(`${raiz}/conversaciones_meta/${conv}`))) falla(`no existe la conversación ${conv} en este proyecto`);
            } else {
                try { conv = (await API.nuevaConversacion(al, { cid: e.cid, pid: e.pid })).conv; } catch (err) { falla(err.message); }
                nueva = true;
                await al.actualizar(`${raiz}/conversaciones_meta/${conv}`, { origen: "claude", ...(e.titulo ? { titulo: String(e.titulo).slice(0, 60), titulo_auto: false } : { titulo: "Cotización desde Claude" }) });
            }
            const adj = (await al.leer(`${raiz}/adjuntos`)) || {};
            const adjuntos = Object.keys(adj).sort().map((id, i) => {
                const a = adj[id];
                const o = { id, n: i + 1, tipo: a.tipo, nombre: a.nombre };
                if (a.tipo === "3d") o.medicion = `${a.resumen || ""}${a.escala ? ` · escala ${a.escala.texto || a.escala.factor}` : ""} (usá medicion_3d)`;
                if (a.resumen_lectura) o.resumen = String(a.resumen_lectura).slice(0, 1500);
                if (a.anotaciones) o.cotas_del_dueno = `origen dueño:${id}`;
                return o;
            });
            const salida = { conv, nueva, proyecto: nombre, cid: e.cid, pid: e.pid, adjuntos };
            if (nueva) salida.contexto = await API.textoInicial(al, e.cid, e.pid);
            else {
                const RC = R.raizConv(e.cid, e.pid, conv);
                const b = await al.leer(`${RC}/borrador`);
                if (b) salida.borrador = B.resumen(B.normalizar(b));
                const msgs = (await al.leer(`${RC}/conversacion/mensajes`)) || {};
                salida.ultimos_mensajes = Object.keys(msgs).sort().slice(-10).map((k) => ({ id: k, rol: msgs[k].rol, texto: String(msgs[k].texto || "").slice(0, 500) }));
                salida.contexto = await API.textoInicial(al, e.cid, e.pid);
            }
            salida.recordatorio = "Guardá cid, pid y conv y usalos en todo el chat. Registrá cada dato del dueño con registrar_mensaje_del_dueno antes de citarlo.";
            return salida;
        },
    },
    {
        def: {
            name: "registrar_mensaje_del_dueno",
            title: "Registrar lo que dijo el dueño",
            description: "Guarda en la conversación de la app, TEXTUAL, lo que el dueño escribió en este chat (medidas, precios, cantidades, confirmaciones, tratos, stock). Devuelve el id para citarlo como origen dueño:<id> en armar_borrador, escala_3d, guardar_en_base o aplicar_al_presupuesto. Solo palabras del dueño, nunca tuyas ni resumidas con números que él no dijo.",
            inputSchema: conProyecto({ type: "object", properties: { texto: { type: "string", maxLength: 4000, description: "Lo que dijo el dueño, tal cual (podés recortar lo que no tiene que ver)." } }, required: ["texto"] }, true),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        },
        async correr(almacen, uid, e) {
            await proyecto(almacen, e, true);
            const t = String(e.texto || "").trim();
            if (!t) falla("texto vacío");
            const al = acotar(almacen, RUTAS.agente(e.cid, e.pid));
            const id = await al.agregar(`${R.raizConv(e.cid, e.pid, e.conv)}/conversacion/mensajes`, { rol: "dueno", texto: t, fecha: almacen.ahora(), uid, via: "claude" });
            return { id, origen: `dueño:${id}` };
        },
    },
    {
        def: {
            name: "registrar_lectura_de_archivo",
            title: "Registrar lectura de un archivo del chat",
            description: "Cuando el dueño adjunta un PDF, una foto o una captura en ESTE chat, registralo con un resumen de lo que sirve para cotizar (renglones, cotas tal cual con su página, materiales, cantidades, notas del cliente). Queda como adjunto del proyecto (solo el resumen; el archivo no se sube) y devuelve el id para citar cotas: cota_plano:<id> p.<n> \"<texto tal cual>\". Una vez por archivo.",
            inputSchema: conProyecto({ type: "object", properties: {
                nombre: { type: "string", maxLength: 200 }, tipo: { type: "string", enum: ["pdf", "imagen"] },
                resumen: { type: "string", maxLength: 3000 },
            }, required: ["nombre", "tipo", "resumen"] }, true),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        },
        async correr(almacen, uid, e) {
            await proyecto(almacen, e, true);
            const al = acotar(almacen, RUTAS.agente(e.cid, e.pid));
            const id = await al.agregar(`${R.RAIZ(e.cid, e.pid)}/adjuntos`, { nombre: String(e.nombre).slice(0, 200), tipo: e.tipo, fecha: almacen.ahora(), via: "claude", conv: e.conv, sin_archivo: true, resumen_lectura: String(e.resumen).slice(0, 3000) });
            return { id, cita_como: `cota_plano:${id}${e.tipo === "pdf" ? " p.<n>" : ""} "<texto tal cual>"` };
        },
    },
    {
        def: Object.assign({}, defAgente("buscar_base"), { title: "Buscar en la base" }),
        sinProyecto: true,
        annotations: { readOnlyHint: true },
        async correr(almacen, uid, e) { return correrDelAgente("buscar_base", acotar(almacen, RUTAS.base()), uid, {}, e); },
    },
    {
        def: Object.assign({}, defAgente("medicion_3d"), { title: "Medición del 3D", inputSchema: conProyecto(defAgente("medicion_3d").input_schema, false),
            description: defAgente("medicion_3d").description + " Los 3D se adjuntan en la app (Agente IA del proyecto, 📎): el navegador los mide. Sus ids salen en abrir_cotizacion." }),
        annotations: { readOnlyHint: true },
        async correr(almacen, uid, e) { await proyecto(almacen, e, false); return correrDelAgente("medicion_3d", almacen, uid, e, sinProyecto(e)); },
    },
    {
        def: Object.assign({}, defAgente("escala_3d"), { title: "Escala del 3D", inputSchema: conProyecto(defAgente("escala_3d").input_schema, true), description: defAgente("escala_3d").description + NOTA_ORIGEN }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        async correr(almacen, uid, e) { await proyecto(almacen, e, true); return correrDelAgente("escala_3d", almacen, uid, e, sinProyecto(e)); },
    },
    {
        def: Object.assign({}, defAgente("armar_borrador"), { title: "Armar el borrador", inputSchema: conProyecto(defAgente("armar_borrador").input_schema, true), description: defAgente("armar_borrador").description + NOTA_ORIGEN }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        async correr(almacen, uid, e) { await proyecto(almacen, e, true); return correrDelAgente("armar_borrador", almacen, uid, e, sinProyecto(e)); },
    },
    {
        def: {
            name: "ver_borrador",
            title: "Ver el borrador",
            description: "Muestra el borrador de esta cotización con los totales que calculó la herramienta. Sin \"items\": capítulos e ítems con totales y avisos. Con \"items\" (ids): también sus filas del APU y características.",
            inputSchema: conProyecto({ type: "object", properties: { items: { type: "array", items: { type: "string" } } } }, true),
            annotations: { readOnlyHint: true },
        },
        async correr(almacen, uid, e) {
            await proyecto(almacen, e, true);
            const b = await acotar(almacen, RUTAS.agente(e.cid, e.pid)).leer(`${R.raizConv(e.cid, e.pid, e.conv)}/borrador`);
            if (!b) return { vacio: true, aviso: "Todavía no hay borrador en esta cotización." };
            const nb = B.normalizar(b);
            const out = B.resumen(nb, Array.isArray(e.items) ? e.items : []);
            out.version = nb.version;
            if (b.aplicado) out.aplicado = { version: b.aplicado.version, fecha: b.aplicado.fecha };
            return out;
        },
    },
    {
        def: {
            name: "aplicar_al_presupuesto",
            title: "Aplicar al presupuesto",
            description: "Pasa el borrador de esta cotización al presupuesto del proyecto, con la MISMA lógica del botón \"Aplicar al presupuesto\" de la app: lo nuevo va al final, lo ya aplicado (mismo id) se actualiza en su lugar sin reordenar, alternativas y \"por confirmar\" quedan apagadas (no suman), y los ítems con supuestos sin confirmar no se pasan. Antes guarda una copia del presupuesto en /respaldos_agente. Solo con la confirmación explícita del dueño (dueño:<id> de su mensaje \"aplicalo\").",
            inputSchema: conProyecto({ type: "object", properties: {
                confirmacion: { type: "string", description: "dueño:<id del mensaje donde el dueño pide aplicar>." },
                con_capitulos: { type: "boolean", description: "Por defecto true." },
            }, required: ["confirmacion"] }, true),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        },
        async correr(almacen, uid, e) {
            await proyecto(almacen, e, true);
            const al = acotar(almacen, RUTAS.aplicar(e.cid, e.pid));
            const RC = R.raizConv(e.cid, e.pid, e.conv);
            const o = N.parsearOrigen(e.confirmacion);
            const msgs = (await al.leer(`${RC}/conversacion/mensajes`)) || {};
            const ref = o && o.tipo === "dueño" ? String(o.ref).split(/\s/)[0] : null;
            if (!ref || !msgs[ref] || msgs[ref].rol !== "dueno") falla("hace falta la confirmación del dueño: registrá su mensaje (\"aplicalo\") con registrar_mensaje_del_dueno y pasá dueño:<id>");
            const borr = await al.leer(`${RC}/borrador`);
            if (!borr) falla("no hay borrador en esta cotización");
            const nb = B.normalizar(borr);
            const ahora = almacen.ahora();
            const items = B.aItemsPresupuesto(nb, { conv: e.conv, capitulos: e.con_capitulos !== false, fecha: ahora });
            const nItems = items.filter((x) => x.type === "item").length;
            const pendientes = [];
            nb.capitulos.forEach((c) => c.items.forEach((it) => { if (B.supuestosPendientes(it)) pendientes.push(it.desc); }));
            if (!nItems) falla("no hay ítems listos para aplicar" + (pendientes.length ? ` (con supuestos sin confirmar: ${pendientes.join(", ")}; confirmalos con armar_borrador → confirmar_supuestos)` : ""));
            const rutaPres = `proyectos/${e.cid}/${e.pid}/presupuesto`;
            const pres = (await al.leer(rutaPres)) || {};
            const dia = new Date(ahora - 4 * 3600 * 1000).toISOString().slice(0, 10);
            const respaldo = await al.agregar(`respaldos_agente/${dia}`, { ruta: rutaPres, antes: pres.items ? JSON.stringify(pres.items) : null, motivo: "aplicar_al_presupuesto (conector Claude)", conv: e.conv, version: nb.version, fecha: ahora, uid });
            const r = B.aplicarAlPresupuesto(lista(pres.items), items);
            await al.escribir(`${rutaPres}/items`, JSON.parse(JSON.stringify(r.data)));
            await al.escribir(`${RC}/borrador/aplicado`, { fecha: ahora, version: nb.version, agregados: r.agregados, actualizados: r.actualizados, por: uid, via: "claude" });
            await al.agregar(`${RC}/conversacion/mensajes`, { rol: "aviso", fecha: ahora, texto: `✅ Borrador v${nb.version} aplicado al presupuesto desde Claude: ${r.agregados} ítems nuevos${r.actualizados ? `, ${r.actualizados} actualizados` : ""} (Bs ${nb.total}).` });
            return { ok: true, agregados: r.agregados, actualizados: r.actualizados, total_borrador: nb.total, respaldo: `respaldos_agente/${dia}/${respaldo}`,
                no_aplicados_por_supuestos: pendientes.length ? pendientes : undefined,
                aviso: "Si el dueño tiene el presupuesto abierto en la app, que lo recargue antes de editarlo (si no, su pantalla vieja puede pisar estos cambios)." };
        },
    },
    {
        def: Object.assign({}, defAgente("guardar_en_base"), { title: "Guardar en la base", inputSchema: conProyecto(defAgente("guardar_en_base").input_schema, true), description: defAgente("guardar_en_base").description + NOTA_ORIGEN }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        async correr(almacen, uid, e) { await proyecto(almacen, e, true); return correrDelAgente("guardar_en_base", almacen, uid, e, sinProyecto(e)); },
    },
    {
        def: (() => {
            const d = JSON.parse(JSON.stringify(defAgente("memoria")));
            d.input_schema.properties.accion.enum = ["anotar", "leer"];   // borrar: desde ⚙ en la app
            d.description += " Desde Claude solo anotar y leer; para borrar una nota, en la app (Agente IA → ⚙).";
            return Object.assign(d, { title: "Memoria y normas del taller" });
        })(),
        sinProyecto: true,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        async correr(almacen, uid, e) {
            if (e.accion === "borrar") falla("para borrar, en la app (Agente IA → ⚙)");
            return correrDelAgente("memoria", acotar(almacen, RUTAS.memoria()), uid, { cid: "claude", pid: "-" }, e);
        },
    },
];

// normaliza: input_schema (formato del agente) → inputSchema (MCP)
HERRAMIENTAS.forEach((h) => {
    if (h.def.input_schema && !h.def.inputSchema) h.def.inputSchema = h.def.input_schema;
    delete h.def.input_schema;
    delete h.def.eager_input_streaming;
    if (h.annotations) h.def.annotations = h.annotations;
});

function definiciones() {
    return HERRAMIENTAS.map((h) => ({ name: h.def.name, title: h.def.title, description: h.def.description, inputSchema: h.def.inputSchema, annotations: h.def.annotations }));
}

/** Corre una herramienta: valida la entrada y nunca tira (los errores vuelven como isError, como pide MCP). */
async function llamar(almacen, uid, nombre, entrada) {
    const h = HERRAMIENTAS.find((x) => x.def.name === nombre);
    const txt = (t) => [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t) }];
    if (!h) return { content: txt(`No existe la herramienta ${nombre}.`), isError: true };
    const e = entrada && typeof entrada === "object" && !Array.isArray(entrada) ? entrada : {};
    const errores = AG.validar(h.def.inputSchema, e);
    if (errores.length) return { content: txt({ entrada_invalida: errores.slice(0, 10) }), isError: true };
    try {
        const r = await h.correr(almacen, uid, e);
        let t = JSON.stringify(r);
        if (t.length > 120000) t = t.slice(0, 120000) + "…[recortado: pedí menos datos]";
        return { content: txt(t) };
    } catch (err) {
        if (!(err instanceof ErrorHerramienta)) console.warn("[rubikMcp]", nombre, String(err.message).slice(0, 200));
        return { content: txt(`Error: ${err.message}`), isError: true };
    }
}

module.exports = { HERRAMIENTAS, definiciones, llamar, RUTAS };
