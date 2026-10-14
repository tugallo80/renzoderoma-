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

// ── Acciones ──────────────────────────────────────────────────────────────────

// Ciclo de vida de un proyecto (cliente-view.html, interno/dashboard.html,
// index.html): requerimiento → cotizacion → propuesta_enviada → negociando →
// contrato_firmado → planificacion → produccion → entregado (o cancelado).
// Activo = todo lo que no terminó. Sin estado se muestra como "Planificación".
const ESTADOS_TERMINADOS = new Set(["entregado", "cancelado"]);

async function listarProyectosActivos() {
    const cids = Object.keys(await leerShallow("proyectos"));
    const porCliente = await mapConLimite(cids, 8, async (cid) => {
        // Solo el nombre (empresa o nombre, como el hub): el nodo del cliente
        // puede traer el logo embebido.
        const [empresa, nombreCliente, pidsObj] = await Promise.all([
            leerRest(`clientes/${cid}/empresa`, false).catch(() => null),
            leerRest(`clientes/${cid}/nombre`, false).catch(() => null),
            leerShallow(`proyectos/${cid}`),
        ]);
        const pids = Object.keys(pidsObj).filter((pid) => pidsObj[pid] === true);
        const proyectos = await mapConLimite(pids, 8, (pid) => leerShallow(`proyectos/${cid}/${pid}`));
        const cliente = [empresa, nombreCliente].find((n) => typeof n === "string" && n) || "Sin cliente";
        return proyectos
            .filter((p) => typeof p.nombre === "string" && p.nombre)
            .map((p) => ({
                cliente,
                nombre: p.nombre,
                estado: p.estado || "planificacion",
                fecha: typeof p.fecha_creacion === "string" ? p.fecha_creacion.slice(0, 10) : null,
                tipo: p.tipo || null,
            }));
    });
    const todos = porCliente.flat();
    const proyectos = todos
        .filter((p) => !ESTADOS_TERMINADOS.has(p.estado))
        .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    // Conteo de los que quedaron afuera: si Kay dice "0 activos", esto muestra
    // si es que de verdad están todos terminados o si no se leyó nada.
    const terminados = {};
    for (const p of todos) if (ESTADOS_TERMINADOS.has(p.estado)) terminados[p.estado] = (terminados[p.estado] || 0) + 1;
    return { total: proyectos.length, proyectos, terminados, clientesLeidos: cids.length };
}

const ACCIONES = {
    listar_proyectos_activos: {
        soloLectura: true,
        descripcion: "Proyectos que no están entregados ni cancelados, de todos los clientes.",
        ejecutar: listarProyectosActivos,
    },
};

// ── Endpoint ──────────────────────────────────────────────────────────────────
// POST { accion, params } → 200 { ok: true, accion, resultado } | { ok: false, error }
exports.kayApi = onRequest({
    region: "us-central1",
    invoker: [KAY_SA],
    timeoutSeconds: 60,
    memory: "256MiB",
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
