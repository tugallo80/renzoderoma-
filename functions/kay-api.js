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

// Activo = todo lo que no está entregado. Los proyectos sin estado se muestran
// como "Planificación" en proyectos-cliente.html, así que cuentan como activos.
const ESTADOS_ACTIVOS = new Set(["planificacion", "produccion"]);

async function listarProyectosActivos() {
    const cids = Object.keys(await leerShallow("proyectos"));
    const porCliente = await mapConLimite(cids, 8, async (cid) => {
        // Solo el nombre: el nodo del cliente puede traer el logo embebido.
        const [nombreCliente, pidsObj] = await Promise.all([
            leerRest(`clientes/${cid}/nombre`, false).catch(() => null),
            leerShallow(`proyectos/${cid}`),
        ]);
        const pids = Object.keys(pidsObj).filter((pid) => pidsObj[pid] === true);
        const proyectos = await mapConLimite(pids, 8, (pid) => leerShallow(`proyectos/${cid}/${pid}`));
        return proyectos
            .filter((p) => typeof p.nombre === "string" && p.nombre && ESTADOS_ACTIVOS.has(p.estado || "planificacion"))
            .map((p) => ({
                cliente: typeof nombreCliente === "string" && nombreCliente ? nombreCliente : "Sin cliente",
                nombre: p.nombre,
                estado: p.estado || "planificacion",
                fecha: typeof p.fecha_creacion === "string" ? p.fecha_creacion.slice(0, 10) : null,
                tipo: p.tipo || null,
            }));
    });
    const proyectos = porCliente.flat().sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    return { total: proyectos.length, proyectos };
}

const ACCIONES = {
    listar_proyectos_activos: {
        soloLectura: true,
        descripcion: "Proyectos en planificación o en producción, de todos los clientes.",
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
