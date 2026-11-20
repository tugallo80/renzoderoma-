/**
 * Proyectos (Sesión 9, Lote 2): /api/proyectos (lista blanca hub).
 *   finanzas {cid, pid} → la fórmula única de venta, gasto, cobrado y utilidad (functions/proyectos/finanzas.js).
 *   archivar / desarchivar {proyectos: [{cid, pid}], motivo?, idempotencia} → functions/proyectos/archivo.js.
 *   cambiar_estado {cid, pid, estado, motivo?, idempotencia} → functions/proyectos/estado.js (también el conector).
 * Kay usa la misma fórmula (kayApi → balance_proyecto).
 */
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { crearAlmacen } = require("../agente/almacen");
const F = require("./finanzas");
const A = require("./archivo");
const E = require("./estado");
const C = require("../operaciones/comun");

const RUTAS = F.RUTAS.concat(A.RUTAS);
const almacenFinanzas = () => crearAlmacen(admin, RUTAS, []);

async function atender(almacen, b, quien) {
    try {
        const accion = b && b.accion;
        if (accion === "finanzas") return { status: 200, cuerpo: await F.calcular(almacen, b.cid, b.pid) };
        if (accion === "archivar" || accion === "desarchivar") {
            const q = C.limpiarQuien(quien, "app");
            return { status: 200, cuerpo: await (accion === "archivar" ? A.archivar : A.desarchivar)(almacen, b, q) };
        }
        if (accion === "cambiar_estado") return { status: 200, cuerpo: await E.cambiarEstado(almacen, b, C.limpiarQuien(quien, "app")) };
        return { status: 400, cuerpo: { error: "Acción desconocida." } };
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
        const quien = { uid: usuario.uid, rol: "dueño", nombre: usuario.name || usuario.email || null, via: "app" };
        const r = await atender(almacenFinanzas(), req.body || {}, quien);
        res.status(r.status).json(r.cuerpo);
    });
}

module.exports = { crearApi, atender, almacenFinanzas, RUTAS };
