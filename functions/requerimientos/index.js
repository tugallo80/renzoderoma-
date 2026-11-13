/**
 * Requerimientos (sesión 6, docs/sesiones/06-render-requerimiento.md).
 *   requerimientoApi → /api/requerimiento (HTTP, requireAuth + lista blanca hub). No llama a ninguna IA.
 */
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { crearAlmacen } = require("../agente/almacen");
const { atender, RUTAS, ARCHIVOS } = require("./api");

function crearApi({ requireAuth, applyCors }) {
    return onRequest({ region: "us-central1", timeoutSeconds: 120, memory: "512MiB", invoker: "public", cors: false }, async (req, res) => {
        applyCors(req, res);
        if (req.method === "OPTIONS") return res.status(204).send("");
        if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
        const usuario = await requireAuth(req, res);
        if (!usuario) return;
        const r = await atender(crearAlmacen(admin, RUTAS, ARCHIVOS), req.body, usuario.uid);
        res.status(r.status).json(r.cuerpo);
    });
}

module.exports = { crearApi };
