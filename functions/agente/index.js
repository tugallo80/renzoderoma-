/**
 * Agente IA cotizador (Etapa 1). Ver docs/sesiones/04-agente-ia.md.
 *   agenteApi    → /api/agente (HTTP, requireAuth + lista blanca hub)
 *   agenteTurno  → trigger de /agente_cola/{id}: corre el loop con Claude (hasta 540 s; si no alcanza, se encola la continuación)
 * La clave de Anthropic vive solo acá (secreto ANTHROPIC_API_KEY).
 */
const { onRequest } = require("firebase-functions/v2/https");
const { onValueCreated } = require("firebase-functions/v2/database");
const admin = require("firebase-admin");
const { crearAlmacen } = require("./almacen");
const { atender } = require("./api");
const { ejecutarTurno } = require("./loop");
const { esHub } = require("../acceso");

function crearApi({ requireAuth, applyCors }) {
    return onRequest({ region: "us-central1", timeoutSeconds: 120, memory: "512MiB", invoker: "public", cors: false }, async (req, res) => {
        applyCors(req, res);
        if (req.method === "OPTIONS") return res.status(204).send("");
        if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
        const usuario = await requireAuth(req, res);
        if (!usuario) return;
        const r = await atender(crearAlmacen(admin), req.body, usuario.uid);
        res.status(r.status).json(r.cuerpo);
    });
}

function crearTrigger({ ANTHROPIC_API_KEY }) {
    return onValueCreated({ ref: "/agente_cola/{id}", region: "us-central1", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540, memory: "1GiB" }, async (event) => {
        const pedido = event.data.val() || {};
        await event.data.ref.remove();
        // Defensa extra: la cola solo la escribe la Function, pero igual se revisa la lista blanca.
        if (!pedido.cid || !pedido.pid || !(await esHub(pedido.uid))) {
            console.warn("[agenteTurno] pedido rechazado", pedido.cid, pedido.pid);
            return;
        }
        const Anthropic = require("@anthropic-ai/sdk");
        const cliente = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), maxRetries: 3, timeout: 5 * 60 * 1000 });
        const r = await ejecutarTurno({ almacen: crearAlmacen(admin), cliente, esErrorAPI: (e) => e instanceof Anthropic.APIError }, pedido);
        console.log("[agenteTurno]", pedido.cid, pedido.pid, r.fin, r.costo || 0, r.error || "");
    });
}

module.exports = { crearApi, crearTrigger };
