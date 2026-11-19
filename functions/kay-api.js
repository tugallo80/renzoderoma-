/**
 * API de Kay — el nexo entre Kay (app personal, proyecto desarrollo-personal-a831d)
 * y Rubik OS. Detalle completo en docs/integracion-kay-trabajo.md.
 *
 * Kay NUNCA toca la base de datos de Rubik: solo pide acciones por nombre y la
 * lógica de negocio vive acá. Para sumar una función nueva alcanza con agregar
 * una entrada a ACCIONES (y la herramienta correspondiente del lado de Kay).
 *
 * Seguridad (dos capas, sin claves compartidas):
 *   1. Cloud Run solo deja pasar requests con un token de identidad de Google
 *      de la cuenta de servicio de Kay (`invoker: [KAY_SA]`, lo aplica el deploy).
 *   2. Acá se vuelve a verificar el mismo token (header X-Kay-Token, que Google
 *      no modifica — al Authorization le saca la firma): firma, audiencia y email.
 *      Protege aunque alguien deje la función pública por error.
 * Del lado de Kay, solo la sesión de Renzo puede disparar estas llamadas.
 */

const { onRequest } = require("firebase-functions/v2/https");
const { OAuth2Client, GoogleAuth } = require("google-auth-library");

// Cuenta con la que corren las Cloud Functions de Kay (compute por defecto de Gen2).
const KAY_SA = "65148659111-compute@developer.gserviceaccount.com";
const URL_API = "https://us-central1-rubik-bolivia.cloudfunctions.net/kayApi";
const DB_URL = "https://rubik-bolivia-default-rtdb.firebaseio.com";

const oauthClient = new OAuth2Client();
const googleAuth = new GoogleAuth({
    scopes: [
        "https://www.googleapis.com/auth/firebase.database",
        "https://www.googleapis.com/auth/userinfo.email",
    ],
});

async function verificarKay(req) {
    const token = String(req.headers["x-kay-token"] || "").trim();
    if (!token) return false;
    try {
        const ticket = await oauthClient.verifyIdToken({ idToken: token, audience: URL_API });
        const p = ticket.getPayload();
        return p.email === KAY_SA && p.email_verified === true;
    } catch (e) {
        console.warn("[kayApi] token rechazado:", e.message);
        return false;
    }
}

// ── Lectura liviana de Realtime Database ──────────────────────────────────────
// /proyectos/$cid/$pid guarda también presupuesto, APU, gantt, etc. — leerlo con
// el Admin SDK bajaría todo. La REST API con ?shallow=true devuelve solo los
// valores simples de un nodo (nombre, estado, fecha...) y `true` para los hijos.
async function leerRest(ruta, shallow = true) {
    const token = await googleAuth.getAccessToken();
    const r = await fetch(`${DB_URL}/${ruta}.json${shallow ? "?shallow=true" : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`RTDB ${r.status} leyendo ${ruta}`);
    return r.json();
}
const leerShallow = async (ruta) => (await leerRest(ruta)) || {};

// Corre fn sobre items con un máximo de `limite` en paralelo.
async function mapConLimite(items, limite, fn) {
    const out = new Array(items.length);
    let i = 0;
    async function trabajador() {
        while (i < items.length) {
            const idx = i++;
            out[idx] = await fn(items[idx]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
    return out;
}

// ── Conector de Claude (mismas herramientas, mismo código y mismas rutas permitidas) ──
// Kay (modo dueño por WhatsApp) usa las herramientas del conector MCP "Rubik" en vez de lecturas propias:
// así sabe lo mismo que Claude. Corren con el usuario hub del dueño (por su email) y el almacén del
// conector (functions/mcp/index.js → RUTAS_MCP). Etapa 1: solo las de lectura (readOnlyHint).
const EMAIL_DUENO = "renzoderoma@gmail.com";
// Devuelven imágenes grandes o son de prueba: no sirven por WhatsApp.
const HERRAMIENTAS_EXCLUIDAS = new Set(["prueba_imagen", "ver_render"]);
let contextoConector = null;
async function conector() {
    if (contextoConector) return contextoConector;
    const admin = require("firebase-admin");
    const H = require("./mcp/herramientas");
    const M = require("./mcp");
    const { crearAlmacen } = require("./agente/almacen");
    const { esHub } = require("./acceso");
    const u = await admin.auth().getUserByEmail(EMAIL_DUENO);
    if (!(await esHub(u.uid))) throw new Error("el dueño no está en la lista blanca hub");
    contextoConector = { H, uid: u.uid, almacen: crearAlmacen(admin, M.RUTAS_MCP, M.ARCHIVOS_MCP, M.ARCHIVOS_MCP_LECTURA) };
    return contextoConector;
}
// Escritura (docs/sesiones/08-operaciones-kay.md): solo estas, con registrado_por; Kay pide el sí del dueño antes de cada una.
const ESCRITURA_KAY = new Set(["modificar_licitacion"]);
const esEscritura = (d) => d && ESCRITURA_KAY.has(d.name) && d.annotations && d.annotations.readOnlyHint === false;
const permitida = (d) => d && !HERRAMIENTAS_EXCLUIDAS.has(d.name) && d.annotations && (d.annotations.readOnlyHint === true || esEscritura(d));

async function herramientasConector() {
    const { H } = await conector();
    return {
        herramientas: H.definiciones().filter(permitida).map((d) => ({ name: d.name, description: d.description, inputSchema: d.inputSchema,
            annotations: { readOnlyHint: d.annotations.readOnlyHint === true } })),
    };
}

async function usarConector(params) {
    const { H, uid, almacen } = await conector();
    const nombre = String(params.nombre || "");
    const def = H.definiciones().find((d) => d.name === nombre);
    if (!permitida(def)) return { error: true, texto: `Herramienta no permitida: ${nombre}` };
    const args = params.args && typeof params.args === "object" ? Object.assign({}, params.args) : {};
    if (esEscritura(def)) {
        // escritura: siempre con quién la pide (va al historial); la vía la pone el servidor
        const rp = args.registrado_por && typeof args.registrado_por === "object" ? args.registrado_por : (params.registrado_por || null);
        if (!rp || !rp.rol || !rp.nombre) return { error: true, texto: "Falta registrado_por {rol, nombre, telefono} para modificar." };
        args.registrado_por = { rol: String(rp.rol), nombre: String(rp.nombre), telefono: rp.telefono ? String(rp.telefono) : undefined, via: "whatsapp" };
        console.log(`[kayApi] usar_conector ${nombre} ${args.operacion || ""} por ${args.registrado_por.rol}`);
    }
    const r = await H.llamar(almacen, uid, nombre, args);
    const contenido = Array.isArray(r.content) ? r.content : [];
    const imagenes = contenido.filter((c) => c.type === "image").length;
    return {
        error: !!r.isError,
        texto: contenido.filter((c) => c.type === "text").map((c) => c.text).join("\n").slice(0, 60000),
        ...(imagenes ? { imagenes_omitidas: imagenes } : {}),
    };
}

// Requerimientos desde WhatsApp (etapa 2): la misma API de la app (requerimientos/api.js → atender), con el
// usuario hub del dueño. Solo crear, editar y adjuntar (pdf o imagen); Kay confirma con el dueño antes.
async function requerimiento(params) {
    const { uid } = await conector();
    const admin = require("firebase-admin");
    const REQ = require("./requerimientos/api");
    const { crearAlmacen } = require("./agente/almacen");
    const accion = String(params.accion || "");
    if (!["crear", "editar", "adjuntar"].includes(accion)) return { error: true, texto: `Acción no permitida: ${accion}` };
    if (accion === "adjuntar" && !["pdf", "imagen"].includes(params.tipo)) return { error: true, texto: "Solo se adjuntan PDF o imágenes." };
    const r = await REQ.atender(crearAlmacen(admin, REQ.RUTAS, REQ.ARCHIVOS), { ...params, accion }, uid);
    console.log(`[kayApi] requerimiento ${accion}: ${r.status}`);
    return r.status === 200 ? { error: false, ...r.cuerpo } : { error: true, texto: (r.cuerpo && r.cuerpo.error) || `Error ${r.status}` };
}

// ── Cotizar desde WhatsApp (etapa 3) ──
// El mismo circuito que Claude con el conector: cliente → proyecto → conversación nueva del Agente IA →
// mensaje del dueño (confirmación) → asignar_requerimiento (copia los adjuntos) → turno del Agente IA
// (agente/api.js → enviar, que encola en /agente_cola; lo corre agenteTurno con Claude).
async function herramienta(nombre, args) {
    const { H, uid, almacen } = await conector();
    const r = await H.llamar(almacen, uid, nombre, args);
    const texto = (r.content || []).filter((c) => c.type === "text").map((c) => c.text)[0] || "";
    if (r.isError) throw new Error(`${nombre}: ${texto.slice(0, 300)}`);
    try { return JSON.parse(texto); } catch { return { texto }; }
}
function almacenAgente() {
    const admin = require("firebase-admin");
    const { crearAlmacen } = require("./agente/almacen");
    return crearAlmacen(admin);
}

async function cotizarRequerimiento(params) {
    const { uid, almacen } = await conector();
    const id = String(params.id || "");
    if (!ID_RTDB.test(id)) return { error: true, texto: "Falta el id del requerimiento." };
    const req = await almacen.leer(`requerimientos/${id}`);
    if (!req) return { error: true, texto: "No existe ese requerimiento." };
    if (req.estado === "descartado") return { error: true, texto: "El requerimiento está descartado." };
    const nota = String(params.nota || "").trim().slice(0, 2000);
    let cid = params.cid || (req.cliente && req.cliente.cid) || req.cid;
    let pid = params.pid || req.pid;
    if (!cid) {
        const nombre = String(params.cliente_nombre || (req.cliente && req.cliente.nombre) || "").trim();
        if (!nombre) return { error: true, texto: "El requerimiento no tiene cliente: decime de qué cliente es." };
        const c = await herramienta("crear_cliente", { nombre });
        cid = c.cid || (c.ya_existe && c.ya_existe.cid);
    }
    if (!pid) {
        const p = await herramienta("crear_proyecto", { cid, nombre: String(params.proyecto_nombre || req.titulo || "Proyecto desde WhatsApp").slice(0, 120) });
        pid = p.pid || (p.ya_existe && p.ya_existe.pid);
    }
    if (!ID_RTDB.test(String(cid)) || !ID_RTDB.test(String(pid))) return { error: true, texto: "No pude armar el cliente o el proyecto." };
    const ab = await herramienta("abrir_cotizacion", { cid, pid, titulo: `WhatsApp: ${String(req.titulo || "cotización").slice(0, 45)}` });
    const conv = ab.conv;
    const conf = await herramienta("registrar_mensaje_del_dueno", { cid, pid, conv, texto: `(Por WhatsApp, a Kay) Cotizá el requerimiento ${id}.${nota ? ` ${nota}` : ""}` });
    const asig = await herramienta("asignar_requerimiento", { id, cid, pid, conv, confirmacion: conf.origen });
    const adjuntos = Object.values(asig.adjuntos || {}).map((a) => a && a.adjunto).filter(Boolean);
    const API = require("./agente/api");
    const env = await API.enviar(almacenAgente(), {
        cid, pid, conv, adjuntos,
        texto: `Cotizá el requerimiento ${id} (${req.titulo || ""}), que está en esta conversación con sus adjuntos. Lo pidió el dueño por WhatsApp.${nota ? ` Nota del dueño: ${nota}` : ""} Armá el borrador con la base de precios; lo que no esté claro, dejalo como supuesto o "por confirmar" y preguntame lo indispensable en una sola ronda.`,
    }, uid);
    console.log(`[kayApi] cotizar ${id}: ${cid}/${pid}/${conv} turno ${env.turno}`);
    return { error: false, cid, pid, conv, turno: env.turno, proyecto: asig.proyecto || ab.proyecto, adjuntos: adjuntos.length };
}

// Estado del turno del Agente IA en esa conversación y, si terminó, el borrador y su último mensaje.
async function estadoCotizacion(params) {
    const { cid, pid, conv } = params;
    if (![cid, pid, conv].every((x) => ID_RTDB.test(String(x || "")))) return { error: true, texto: "Faltan cid, pid o conv." };
    const R = require("./agente/rutas");
    const al = almacenAgente();
    const est = (await al.leer(`${R.RAIZ(cid, pid)}/estado`)) || {};
    const fase = est.conv && est.conv !== conv ? "listo" : est.fase || "en_cola";
    const salida = { error: false, fase, texto: est.texto || "" };
    if (["listo", "esperando_dueno", "tope", "error"].includes(fase)) {
        const msgs = (await al.leer(`${R.raizConv(cid, pid, conv)}/conversacion/mensajes`)) || {};
        const ultimo = Object.keys(msgs).sort().reverse().map((k) => msgs[k]).find((m) => m && m.rol !== "dueno" && m.rol !== "aviso");
        if (ultimo) salida.ultimo_mensaje = String(ultimo.texto || "").slice(0, 3000);
        try { salida.borrador = await herramienta("ver_borrador", { cid, pid, conv }); } catch (e) { salida.borrador = null; }
    }
    return salida;
}

// El dueño le contesta al Agente IA (cuando pregunta algo) o le pide un cambio: otro turno en la misma conversación.
async function mensajeAgente(params) {
    const { uid } = await conector();
    const { cid, pid, conv } = params;
    const texto = String(params.texto || "").trim().slice(0, 4000);
    if (![cid, pid, conv].every((x) => ID_RTDB.test(String(x || ""))) || !texto) return { error: true, texto: "Faltan datos." };
    const API = require("./agente/api");
    const env = await API.enviar(almacenAgente(), { cid, pid, conv, texto: `(Por WhatsApp) ${texto}` }, uid);
    return { error: false, turno: env.turno };
}

// Proyectos de todos los clientes, leídos como el conector (Admin SDK), solo los campos simples.
async function proyectosDeTodos() {
    const { almacen } = await conector();
    const clientes = (await almacen.leer("clientes")) || {};
    const cids = Object.keys(clientes).filter((k) => clientes[k] && typeof clientes[k] === "object");
    const porCliente = await mapConLimite(cids, 6, async (cid) => {
        const ps = (await almacen.leer(`proyectos/${cid}`).catch(() => null)) || {};
        const cliente = clientes[cid].empresa || clientes[cid].nombre || "Sin cliente";
        return Object.keys(ps)
            .filter((pid) => ps[pid] && typeof ps[pid] === "object" && typeof ps[pid].nombre === "string")
            .map((pid) => ({
                cid, pid, cliente, nombre: ps[pid].nombre, estado: typeof ps[pid].estado === "string" ? ps[pid].estado : "planificacion",
                fecha: typeof ps[pid].fecha_creacion === "string" ? ps[pid].fecha_creacion.slice(0, 10) : null, tipo: ps[pid].tipo || null,
            }));
    });
    const todos = porCliente.flat();
    console.log(`[kayApi] proyectos: clientes=${cids.length} proyectos=${todos.length}`);
    return { todos, clientesLeidos: cids.length };
}

// ── Acciones ──────────────────────────────────────────────────────────────────

// Ciclo de vida de un proyecto (cliente-view.html, interno/dashboard.html,
// index.html): requerimiento → cotizacion → propuesta_enviada → negociando →
// contrato_firmado → planificacion → produccion → entregado (o cancelado).
// Activo = todo lo que no terminó. Sin estado se muestra como "Planificación".
const ESTADOS_TERMINADOS = new Set(["entregado", "cancelado"]);

async function listarProyectosActivos() {
    const { todos, clientesLeidos } = await proyectosDeTodos();
    const proyectos = todos
        .filter((p) => !ESTADOS_TERMINADOS.has(p.estado))
        .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""))
        .map(({ cid, pid, ...p }) => p);
    const terminados = {};
    for (const p of todos) if (ESTADOS_TERMINADOS.has(p.estado)) terminados[p.estado] = (terminados[p.estado] || 0) + 1;
    return { total: proyectos.length, proyectos, terminados, clientesLeidos };
}

// ── Detalle de proyectos (Kay recepcionista en modo dueño, por WhatsApp) ──────

const sinAcentos = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const ID_RTDB = /^[A-Za-z0-9_-]{1,64}$/;
const r2 = (n) => Math.round(n * 100) / 100;
const listaDe = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []).filter(Boolean);
const nombreCliente = async (cid) => {
    const [empresa, nombre] = await Promise.all([
        leerRest(`clientes/${cid}/empresa`, false).catch(() => null),
        leerRest(`clientes/${cid}/nombre`, false).catch(() => null),
    ]);
    return [empresa, nombre].find((n) => typeof n === "string" && n) || "Sin cliente";
};

// Busca proyectos por nombre del proyecto o del cliente (todos los estados).
async function buscarProyecto(params) {
    const q = sinAcentos(params.texto).slice(0, 80);
    if (q.length < 2) throw new Error("texto muy corto");
    const { todos } = await proyectosDeTodos();
    const proyectos = todos
        .filter((p) => sinAcentos(p.cliente).includes(q) || sinAcentos(p.nombre).includes(q))
        .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""))
        .slice(0, 10)
        .map(({ tipo, ...p }) => p);
    return { total: proyectos.length, proyectos };
}

// Estado, plata y avance de un proyecto (de buscar_proyecto: cid + pid). Solo lectura.
async function detalleProyecto(params) {
    const { cid, pid } = params;
    if (!ID_RTDB.test(String(cid || "")) || !ID_RTDB.test(String(pid || ""))) throw new Error("cid/pid inválidos");
    const base = `proyectos/${cid}/${pid}`;
    const [simple, cliente, pres, gantt, pagos] = await Promise.all([
        conector().then(({ almacen }) => almacen.leer(base)).then((v) => v || {}),
        nombreCliente(cid),
        leerRest(`${base}/presupuesto/items`, false).catch(() => null),
        leerRest(`${base}/gantt`, false).catch(() => null),
        leerRest(`${base}/pagos`, false).catch(() => null),
    ]);
    if (typeof simple.nombre !== "string") throw new Error("no existe ese proyecto");
    const items = listaDe(pres);
    let total = 0;
    let nItems = 0;
    const capitulos = [];
    for (const x of items) {
        if (x.type === "chapter") { if (x.name) capitulos.push(String(x.name)); continue; }
        nItems++;
        if (x.activo !== false) total += (parseFloat(x.pu) || 0) * (parseFloat(x.cant) || 0);
    }
    const hoy = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10); // Bolivia
    const tareas = [];
    const gItems = gantt && typeof gantt === "object" ? gantt : {};
    Object.keys(gItems).forEach((idx) => {
        const g = gItems[idx];
        if (!g || !g.subtasks) return;
        const it = items[Number(idx)];
        Object.values(g.subtasks).forEach((t) => {
            if (!t) return;
            tareas.push({
                item: (it && it.desc) || null, tarea: t.name || null,
                inicio: typeof t.start === "string" ? t.start.slice(0, 10) : null,
                fin: typeof t.end === "string" ? t.end.slice(0, 10) : null,
                avance: parseInt(t.progress || 0, 10) || 0,
            });
        });
    });
    const avance = tareas.length ? Math.round(tareas.reduce((a, t) => a + t.avance, 0) / tareas.length) : null;
    const atrasadas = tareas.filter((t) => t.fin && t.fin < hoy && t.avance < 100).slice(0, 5);
    const proximas = tareas.filter((t) => t.avance < 100 && (!t.fin || t.fin >= hoy))
        .sort((a, b) => (a.inicio || a.fin || "9").localeCompare(b.inicio || b.fin || "9")).slice(0, 5);
    const listaPagos = listaDe(pagos).filter((p) => parseFloat(p.monto) > 0)
        .map((p) => ({ monto: r2(parseFloat(p.monto)), fecha: typeof p.fecha === "string" ? p.fecha.slice(0, 10) : null, nota: p.nota || p.descripcion || null }))
        .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    const num = (v) => (Number.isFinite(parseFloat(v)) ? r2(parseFloat(v)) : null);
    return {
        cliente, nombre: simple.nombre, estado: simple.estado || "planificacion",
        fecha: typeof simple.fecha_creacion === "string" ? simple.fecha_creacion.slice(0, 10) : null,
        inicio: typeof simple.fecha_inicio === "string" ? simple.fecha_inicio.slice(0, 10) : null,
        presupuesto: { items: nItems, total_bs: r2(total), capitulos: capitulos.slice(0, 15) },
        monto_cierre_bs: num(simple.monto_cierre), gasto_total_bs: num(simple.gasto_total),
        cobrado_bs: r2(listaPagos.reduce((a, p) => a + p.monto, 0)), ultimos_pagos: listaPagos.slice(0, 3),
        cronograma: { tareas: tareas.length, avance_promedio: avance, atrasadas, proximas },
    };
}

// Requerimientos que cargó el dueño y todavía no tienen proyecto.
async function requerimientosPendientes() {
    const todos = (await leerRest("requerimientos", false).catch(() => null)) || {};
    const res = Object.keys(todos).filter((k) => todos[k] && typeof todos[k] === "object" && (todos[k].estado || "pendiente") === "pendiente")
        .sort((a, b) => (todos[b].actualizado || 0) - (todos[a].actualizado || 0)).slice(0, 20)
        .map((k) => {
            const r = todos[k];
            return {
                titulo: r.titulo || null,
                cliente: (r.cliente && (r.cliente.nombre || r.cliente.empresa)) || null,
                descripcion: String(r.descripcion || "").slice(0, 300) || null,
                actualizado: r.actualizado ? new Date(r.actualizado).toISOString().slice(0, 10) : null,
            };
        });
    return { total: res.length, requerimientos: res };
}

// ── Compras: el mismo módulo que /api/compras (functions/compras/api.js, docs/sesiones/07-compras.md) ──
// Kay dice quién la registra (registrado_por: {rol, nombre, telefono}); la operación es idempotente por `idempotencia`
// (usar el id del mensaje de WhatsApp): reintentar no duplica.
async function compras(accion, params) {
    const C = require("./compras/api");
    const { almacenCompras } = require("./compras");
    const { registrado_por, ...resto } = params || {};
    const rp = registrado_por && typeof registrado_por === "object" ? registrado_por : {};
    const quien = { rol: rp.rol || "dueño", nombre: rp.nombre || null, telefono: rp.telefono || null, via: "whatsapp" };
    const r = await C.atender(almacenCompras(), { ...resto, accion }, quien);
    console.log(`[kayApi] compras ${accion}: ${r.status}`);
    return r.status === 200 ? { error: false, ...r.cuerpo } : { error: true, texto: (r.cuerpo && r.cuerpo.error) || `Error ${r.status}` };
}

const ACCIONES = {
    listar_proyectos_activos: {
        soloLectura: true,
        descripcion: "Proyectos que no están entregados ni cancelados, de todos los clientes.",
        ejecutar: listarProyectosActivos,
    },
    buscar_proyecto: {
        soloLectura: true,
        descripcion: "Proyectos (de cualquier estado) cuyo nombre o cliente contiene { texto }.",
        ejecutar: buscarProyecto,
    },
    detalle_proyecto: {
        soloLectura: true,
        descripcion: "Estado, presupuesto, cobros y avance del cronograma de un proyecto { cid, pid }.",
        ejecutar: detalleProyecto,
    },
    herramientas_conector: {
        soloLectura: true,
        descripcion: "Definiciones de las herramientas de lectura del conector de Claude (las mismas que usa Claude).",
        ejecutar: herramientasConector,
    },
    usar_conector: {
        soloLectura: true,
        descripcion: "Corre una herramienta de lectura del conector { nombre, args } con el usuario hub del dueño.",
        ejecutar: usarConector,
    },
    requerimiento: {
        soloLectura: false,
        descripcion: "Crea, edita o adjunta (pdf/imagen) un requerimiento, con la API de la app { accion, ... }.",
        ejecutar: requerimiento,
    },
    cotizar_requerimiento: {
        soloLectura: false,
        descripcion: "Manda un requerimiento a cotizar al Agente IA { id, cid?, pid?, cliente_nombre?, proyecto_nombre?, nota? }.",
        ejecutar: cotizarRequerimiento,
    },
    estado_cotizacion: {
        soloLectura: true,
        descripcion: "Estado del turno del Agente IA { cid, pid, conv } y, si terminó, el borrador.",
        ejecutar: estadoCotizacion,
    },
    mensaje_agente: {
        soloLectura: false,
        descripcion: "Le manda un mensaje del dueño al Agente IA en esa cotización { cid, pid, conv, texto }.",
        ejecutar: mensajeAgente,
    },
    registrar_compra: {
        soloLectura: false,
        descripcion: "Registra una compra (gasto del proyecto, egreso, crédito fiscal si es factura, proveedor y precios) "
            + "{ idempotencia, total?, fecha?, cid?, pid?, proveedor?: {nombre, nit?, contacto?}, factura?: {nit, razon_social?, nro, cuf?, fecha?, monto?}, "
            + "items?: [{material, cantidad, unidad?, precio}], nota?, foto?: {datos_base64, mime?}, pagado_con?: {medio, persona?}, "
            + "registrado_por: {rol, nombre, telefono} } → { id, repetida, proveedor_id, resumen }",
        ejecutar: (p) => compras("registrar", p),
    },
    anular_compra: {
        soloLectura: false,
        descripcion: "Anula una compra (no se borra; resta del gasto del proyecto y marca la factura) { id, motivo, registrado_por }.",
        ejecutar: (p) => compras("anular", p),
    },
    balance_mensual: {
        soloLectura: true,
        descripcion: "Ingresos, egresos (compras, contratistas, cancheos), resultado e IVA de compras de un mes { mes: \"AAAA-MM\" }.",
        ejecutar: (p) => compras("balance_mensual", p),
    },
    balance_proyecto: {
        soloLectura: true,
        descripcion: "Monto de cierre, cobrado y gastos (compras, contratistas) de un proyecto { cid, pid }.",
        ejecutar: (p) => compras("balance_proyecto", p),
    },
    buscar_contacto: {
        soloLectura: true,
        descripcion: "Busca un contacto por nombre en personal, proveedores y clientes { nombre } → { encontrados: [{nombre, telefono, origen, detalle}] } (hasta 5, el mejor primero).",
        ejecutar: buscarContacto,
    },
    requerimientos_pendientes: {
        soloLectura: true,
        descripcion: "Requerimientos cargados que todavía no tienen proyecto.",
        ejecutar: requerimientosPendientes,
    },
};

// ── Contactos de la base de Rubik (Kay por WhatsApp: "mandale a José Luis…") ──────────────────────
// Busca por nombre en /personal (trabajadores, supervisores, contratistas), /base_datos/proveedores y
// /clientes. Solo devuelve nombre, teléfono y de dónde sale: nada de sueldos ni datos internos.
const sinTildes = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();

async function buscarContacto(params) {
    const buscado = sinTildes(params.nombre).slice(0, 80);
    if (!buscado) throw new Error("Falta el nombre");
    const admin = require("firebase-admin");
    const db = admin.database();
    const [personal, proveedores, clientes] = await Promise.all(
        ["personal", "base_datos/proveedores", "clientes"].map((r) => db.ref(r).get().then((s) => s.val() || {}).catch(() => ({}))));
    const lista = [];
    const sumar = (obj, origen, arma) => Object.keys(obj).forEach((k) => {
        const v = obj[k];
        if (v && typeof v === "object") { const c = arma(v, k); if (c.nombre && c.telefono) lista.push(Object.assign({ origen }, c)); }
    });
    sumar(personal, "personal", (v, k) => ({ nombre: v.nombre || k.replace(/_/g, " "), telefono: String(v.telefono || v.whatsapp || v.phone || "").trim(), detalle: [v.tipo, v.especialidad].filter(Boolean).join(" · ") || null }));
    sumar(proveedores, "proveedor", (v) => ({ nombre: v.nombre || v.razon_social || "", telefono: String(v.telefono || v.contacto || "").replace(/^S\/N$/i, "").trim(), detalle: v.categoria || null }));
    sumar(clientes, "cliente", (v, k) => ({ nombre: [v.nombre, v.empresa].filter(Boolean).join(" · ") || k, telefono: String(v.wsp || v.whatsapp || v.telefono || "").trim(), detalle: null }));
    const palabras = buscado.split(" ");
    const encontrados = lista
        .map((c) => {
            const n = sinTildes(c.nombre);
            const exacto = n === buscado;
            const todas = palabras.every((p) => new RegExp(`\\b${p}\\b`).test(n));
            const algunas = palabras.filter((p) => p.length > 2 && new RegExp(`\\b${p}\\b`).test(n)).length;
            return { c, puntos: exacto ? 1000 : todas ? 100 + palabras.length : algunas };
        })
        .filter((x) => x.puntos > 0)
        .sort((a, b) => b.puntos - a.puntos)
        .slice(0, 5)
        .map((x) => x.c);
    console.log(`[kayApi] buscar_contacto: ${lista.length} contactos, ${encontrados.length} coincidencias`);
    return { encontrados };
}

// ── Endpoint ──────────────────────────────────────────────────────────────────
// POST { accion, params } → 200 { ok: true, accion, resultado } | { ok: false, error }
exports.kayApi = onRequest({
    region: "us-central1",
    invoker: [KAY_SA],
    timeoutSeconds: 60,
    memory: "512MiB",
    cors: false,
}, async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });
    if (!(await verificarKay(req))) return res.status(401).json({ ok: false, error: "No autorizado" });

    const { accion, params } = req.body || {};
    const def = Object.prototype.hasOwnProperty.call(ACCIONES, accion) ? ACCIONES[accion] : null;
    if (!def) return res.status(400).json({ ok: false, error: `Acción desconocida: ${accion}` });

    try {
        const resultado = await def.ejecutar(params && typeof params === "object" ? params : {});
        console.log(`[kayApi] ${accion} ok`);
        return res.status(200).json({ ok: true, accion, resultado });
    } catch (e) {
        console.error(`[kayApi] ${accion} falló:`, e.message);
        return res.status(500).json({ ok: false, error: "Error interno ejecutando la acción" });
    }
});
