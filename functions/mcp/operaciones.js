/**
 * Herramientas del conector para OPERAR los proyectos (docs/sesiones/08-operaciones-kay.md): las mismas operaciones de
 * servidor que usan las pantallas (functions/licitaciones/api.js…). Las usan Claude (claude.ai) y Kay (WhatsApp, por
 * kayApi → usar_conector). Las de escritura piden registrado_por e idempotencia y dejan historial en el proyecto.
 */
const L = require("../licitaciones/api");

const REGISTRADO_POR = {
    type: "object", description: "Quién pide el cambio: {rol: dueño|supervisor|compras|…, nombre, telefono?}. Va al historial.",
    properties: { rol: { type: "string", maxLength: 30 }, nombre: { type: "string", maxLength: 80 }, telefono: { type: "string", maxLength: 20 } },
    required: ["rol", "nombre"],
};
const IDEM = { type: "string", minLength: 6, maxLength: 200, description: "Clave única del pedido (ej. el id del mensaje): repetirla no repite el cambio." };

/** Corre una operación de un módulo y convierte su {status, cuerpo} en resultado o error de herramienta. */
function correrModulo(falla, mod, almacenDe) {
    return async (almacen, uid, accion, args, quien) => {
        const r = await mod.atender(almacenDe(almacen), Object.assign({}, args, { accion }), quien);
        if (r.status !== 200) falla((r.cuerpo && r.cuerpo.error) || `Error ${r.status}`);
        return r.cuerpo;
    };
}

module.exports = function crear({ falla, acotar }) {
    const lic = correrModulo(falla, L, (a) => acotar(a, L.RUTAS));
    const quienDe = (uid, rp) => ({ uid, rol: rp && rp.rol, nombre: rp && rp.nombre, telefono: rp && rp.telefono, via: (rp && rp.via) || "claude" });

    return [
        {
            def: {
                name: "listar_licitaciones",
                title: "Listar licitaciones",
                description: "Licitaciones (mano de obra, gráficos, supervisión) de un proyecto {cid, pid}, o de todos los proyectos buscando por trabajador {texto}. Por cada una: trabajador, estado, contrato (precio final si está aprobada; si no, el propuesto), extras, pagado y saldo. Usalo antes de modificar_licitacion para tener cid, pid y lid.",
                inputSchema: { type: "object", properties: {
                    cid: { type: "string" }, pid: { type: "string" },
                    texto: { type: "string", maxLength: 60, description: "Parte del nombre del trabajador (obligatorio sin cid/pid)." },
                } },
                annotations: { readOnlyHint: true },
            },
            async correr(almacen, uid, e) { return lic(almacen, uid, "listar", e, null); },
        },
        {
            def: {
                name: "modificar_licitacion",
                title: "Modificar una licitación",
                description: "Cambia una licitación con la misma lógica que la pantalla de Licitaciones (copia del trabajador, responsables en el presupuesto, historial antes → después). PEDÍ EL SÍ DEL DUEÑO ANTES, diciendo qué vas a cambiar y los montos. Operaciones: cambiar_monto {monto, motivo?} (si está aprobada cambia el precio final; si no, el propuesto) · cambiar_contratista {worker_id} · aprobar {precio_final?} · contra_oferta {precio} · terminar · registrar_pago {monto, fecha?, concepto?, tipo?: pago|adelanto|descuento_compra, pagado_con?: {medio: transferencia|qr|efectivo|caja_chica|otro, persona?}} · anular_pago {pago, motivo} · agregar_extra {monto, descripcion, fecha?} · anular {motivo} (la quita; la copia queda en el historial). No toca gasto_total.",
                inputSchema: { type: "object", properties: {
                    cid: { type: "string" }, pid: { type: "string" }, lid: { type: "string", description: "Id de la licitación (de listar_licitaciones)." },
                    operacion: { type: "string", enum: ["cambiar_monto", "cambiar_contratista", "aprobar", "contra_oferta", "terminar", "registrar_pago", "anular_pago", "agregar_extra", "anular"] },
                    monto: { type: "number", minimum: 0.01 }, precio: { type: "number", minimum: 0.01 }, precio_final: { type: "number", minimum: 0.01 },
                    worker_id: { type: "string" }, motivo: { type: "string", maxLength: 300 }, fecha: { type: "string", description: "AAAA-MM-DD" },
                    concepto: { type: "string", maxLength: 200 }, descripcion: { type: "string", maxLength: 300 }, pago: { type: "string" },
                    tipo: { type: "string", enum: ["pago", "adelanto", "descuento_compra"] },
                    pagado_con: { type: "object", properties: { medio: { type: "string", enum: ["transferencia", "qr", "efectivo", "caja_chica", "otro"] }, persona: { type: "string", maxLength: 80 } } },
                    idempotencia: IDEM, registrado_por: REGISTRADO_POR,
                }, required: ["cid", "pid", "lid", "operacion", "idempotencia", "registrado_por"] },
                annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
            },
            async correr(almacen, uid, e) {
                const { operacion, registrado_por, ...args } = e;
                return lic(almacen, uid, operacion, args, quienDe(uid, registrado_por));
            },
        },
    ];
};
