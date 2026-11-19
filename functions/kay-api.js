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
const permitida = (d) => d && !HERRAMIENTAS_EXCLUIDAS.has(d.name) && d.annotations && d.annotations.readOnlyHint === true;

async function herramientasConector() {
    const { H } = await conector();
    return {
        herramientas: H.definiciones().filter(permitida).map((d) => ({ name: d.name, description: d.description, inputSchema: d.inputSchema })),
    };
}

async function usarConector(params) {
    const { H, uid, almacen } = await conector();
    const nombre = String(params.nombre || "");
    if (!permitida(H.definiciones().find((d) => d.name === nombre))) return { error: true, texto: `Herramienta no permitida: ${nombre}` };
    const r = await H.llamar(almacen, uid, nombre, params.args && typeof params.args === "object" ? params.args : {});
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
    requerimientos_pendientes: {
        soloLectura: true,
        descripcion: "Requerimientos cargados que todavía no tienen proyecto.",
        ejecutar: requerimientosPendientes,
    },
};

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
