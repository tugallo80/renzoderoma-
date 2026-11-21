/**
 * /api/rendir — la mini app sin login (public/rendir.html) que el dueño le manda al contratista por WhatsApp para rendir
 * sus gastos. El token (en el # del link, nunca va a los logs del hosting) identifica a la persona y, si el link es de un
 * proyecto, al proyecto. Solo deja: ver su saldo y sus gastos, y cargar un gasto con detalle y comprobante, que queda
 * PENDIENTE hasta que el dueño lo aprueba. Vence y se puede revocar (functions/rendiciones/api.js → crear_link).
 *   {token, accion: "info"}                                                    → {nombre, proyecto, totales, gastos}
 *   {token, accion: "gasto", idempotencia, items, fecha?, proveedor?, foto?}    → {ok, id, total, saldo_en_mano}
 */
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { crearAlmacen } = require("../agente/almacen");
const R = require("./api");
const C = require("../operaciones/comun");

async function atender(almacen, b) {
    return C.responder("rendirLink", async () => {
        const l = await R.porToken(almacen, b && b.token);
        const filtro = { worker_id: l.wid, cid: l.cid || undefined, pid: l.pid || undefined };
        if (b.accion === "info") {
            const e = await R.estado(almacen, filtro);
            return {
                nombre: l.nombre, proyecto: l.proyecto || null, vence: new Date(l.vence).toISOString().slice(0, 10), totales: e.totales,
                movimientos: e.movimientos.slice(0, 40).map((m) => ({ tipo: m.tipo, fecha: m.fecha, monto: m.monto, concepto: m.concepto, estado: m.estado, motivo: m.motivo || null })),
            };
        }
        if (b.accion === "gasto") {
            const quien = { rol: "trabajador", nombre: l.nombre, via: "link" };
            const r = await R.registrarGasto(almacen, Object.assign({}, filtro, { idempotencia: b.idempotencia, items: b.items, fecha: b.fecha, proveedor: b.proveedor,
                concepto: b.concepto, foto: b.foto }), C.limpiarQuien(quien, "link"));
            if (!r.repetida) await almacen.escribir(`rendicion_links/${l.h}/usado`, (Number(l.usado) || 0) + 1).catch(() => {});
            return { ok: true, id: r.id, estado: r.estado, saldo_en_mano: r.saldo_en_mano, repetida: !!r.repetida };
        }
        C.falla("Acción desconocida.");
    });
}

function crearApi({ applyCors }) {
    return onRequest({ region: "us-central1", timeoutSeconds: 60, memory: "512MiB", invoker: "public", cors: false }, async (req, res) => {
        applyCors(req, res);
        if (req.method === "OPTIONS") return res.status(204).send("");
        if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
        const r = await atender(crearAlmacen(admin, R.RUTAS, R.ARCHIVOS), req.body || {});
        res.status(r.status).json(r.cuerpo);
    });
}

module.exports = { crearApi, atender };
