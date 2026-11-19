/**
 * Compras (docs/sesiones/07-compras.md).
 *   comprasApi → /api/compras (HTTP, requireAuth + lista blanca hub). Kay usa el mismo módulo desde kayApi.
 * Quién registra lo pone el servidor (uid y email del token), nunca el pedido.
 */
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { crearAlmacen } = require("../agente/almacen");
const { atender, RUTAS, ARCHIVOS } = require("./api");

const almacenCompras = () => crearAlmacen(admin, RUTAS, ARCHIVOS);

function crearApi({ requireAuth, applyCors }) {
    return onRequest({ region: "us-central1", timeoutSeconds: 60, memory: "512MiB", invoker: "public", cors: false }, async (req, res) => {
        applyCors(req, res);
        if (req.method === "OPTIONS") return res.status(204).send("");
        if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
        const usuario = await requireAuth(req, res);
        if (!usuario) return;
        const quien = { uid: usuario.uid, rol: "dueño", nombre: usuario.name || usuario.email || null, via: "app" };
        const r = await atender(almacenCompras(), req.body, quien);
        res.status(r.status).json(r.cuerpo);
    });
}

module.exports = { crearApi, almacenCompras };
