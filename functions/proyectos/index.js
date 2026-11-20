/**
 * Proyectos (Sesión 9, Lote 2): /api/proyectos (lista blanca hub).
 *   finanzas {cid, pid} → la fórmula única de venta, gasto, cobrado y utilidad (functions/proyectos/finanzas.js).
 * Kay usa la misma fórmula (kayApi → balance_proyecto).
 */
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { crearAlmacen } = require("../agente/almacen");
const F = require("./finanzas");

const almacenFinanzas = () => crearAlmacen(admin, F.RUTAS, []);

async function atender(almacen, b) {
    try {
        if (!b || b.accion !== "finanzas") return { status: 400, cuerpo: { error: "Acción desconocida." } };
        return { status: 200, cuerpo: await F.calcular(almacen, b.cid, b.pid) };
    } catch (e) {
        if (e.status) return { status: e.status, cuerpo: { error: e.message } };
        console.error("[proyectosApi]", e);
        return { status: 500, cuerpo: { error: "Error interno." } };
    }
}

function crearApi({ requireAuth, applyCors }) {
    return onRequest({ region: "us-central1", timeoutSeconds: 60, memory: "512MiB", invoker: "public", cors: false }, async (req, res) => {
        applyCors(req, res);
        if (req.method === "OPTIONS") return res.status(204).send("");
        if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
        const usuario = await requireAuth(req, res);
        if (!usuario) return;
        const r = await atender(almacenFinanzas(), req.body || {});
        res.status(r.status).json(r.cuerpo);
    });
}

module.exports = { crearApi, atender, almacenFinanzas };
