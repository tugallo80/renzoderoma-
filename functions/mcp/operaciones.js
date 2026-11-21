/**
 * Herramientas del conector para OPERAR los proyectos (docs/sesiones/08-operaciones-kay.md): las mismas operaciones de
 * servidor que usan las pantallas (functions/licitaciones/api.js…). Las usan Claude (claude.ai) y Kay (WhatsApp, por
 * kayApi → usar_conector). Las de escritura piden registrado_por e idempotencia y dejan historial en el proyecto.
 */
const L = require("../licitaciones/api");
const P = require("../proyectos");
const E = require("../proyectos/estado");

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
    const proy = correrModulo(falla, P, (a) => acotar(a, P.RUTAS));
    const quienDe = (uid, rp) => ({ uid, rol: rp && rp.rol, nombre: rp && rp.nombre, telefono: rp && rp.telefono, via: (rp && rp.via) || "claude" });

    return [
        {
            def: {
                name: "buscar_trabajador",
                title: "Buscar trabajador o proveedor",
                description: "Busca en la base de personal (trabajadores, contratistas y proveedores como imprentas) por nombre, empresa o especialidad {texto}. Devuelve worker_id, nombre, tipo y especialidad: usalo para crear_licitacion o cambiar_contratista.",
                inputSchema: { type: "object", properties: { texto: { type: "string", maxLength: 80 } } },
                annotations: { readOnlyHint: true },
            },
            async correr(almacen, uid, e) { return lic(almacen, uid, "trabajadores", e, null); },
        },
        {
            def: {
                name: "registrar_trabajador",
                title: "Dar de alta a un trabajador o proveedor",
                description: "Da de alta a alguien en Personal (como Base de datos → Personal), para poder licitarle trabajo. PEDÍ EL SÍ DEL DUEÑO ANTES (nombre, tipo y teléfono). tipo: graficos (imprenta / empresa de gráficos), externo (contratista de mano de obra), empresa (taller de servicios), interno (planta), supervisor. El sueldo no se carga acá. Si ya existe, devuelve su worker_id (con actualizar: true cambia tipo, especialidad o teléfono).",
                inputSchema: { type: "object", properties: {
                    nombre: { type: "string", maxLength: 80 }, tipo: { type: "string", enum: ["graficos", "externo", "empresa", "interno", "supervisor"] },
                    especialidad: { type: "string", maxLength: 80 }, telefono: { type: "string", maxLength: 20, description: "WhatsApp, con código de país (591…)." },
                    actualizar: { type: "boolean" }, idempotencia: IDEM, registrado_por: REGISTRADO_POR,
                }, required: ["nombre", "tipo", "idempotencia", "registrado_por"] },
                annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
            },
            async correr(almacen, uid, e) {
                const { registrado_por, ...args } = e;
                return lic(almacen, uid, "registrar_trabajador", args, quienDe(uid, registrado_por));
            },
        },
        {
            def: {
                name: "crear_licitacion",
                title: "Crear una licitación",
                description: "Crea una licitación (encargo a un trabajador o proveedor de la base) con la misma lógica que la pantalla de Licitaciones: copia para el trabajador, responsable en los ítems del presupuesto si queda aprobada, historial. PEDÍ EL SÍ DEL DUEÑO ANTES (a quién, qué y por cuánto). alcance: renglones {item?: índice del ítem del presupuesto (ver_presupuesto), descripcion?, cant?, und?, monto}; el total es la suma de los montos. estado: enviado (propuesta al trabajador, por defecto) o aprobado (adjudicación directa). tipo: mano_de_obra (por defecto), grafico (imprenta), llave_en_mano, supervision. Trabajador por worker_id (buscar_trabajador) o por nombre si hay uno solo que coincide.",
                inputSchema: { type: "object", properties: {
                    cid: { type: "string" }, pid: { type: "string" },
                    worker_id: { type: "string" }, trabajador: { type: "string", maxLength: 80, description: "Nombre (si no tenés worker_id)." },
                    alcance: { type: "array", minItems: 1, maxItems: 60, items: { type: "object", properties: {
                        item: { type: "integer", minimum: 0 }, descripcion: { type: "string", maxLength: 200 }, cant: { type: "number", minimum: 0.0001 },
                        und: { type: "string", maxLength: 20 }, monto: { type: "number", minimum: 0.01 } }, required: ["monto"] } },
                    tipo: { type: "string", enum: ["mano_de_obra", "grafico", "llave_en_mano", "supervision"] },
                    estado: { type: "string", enum: ["enviado", "aprobado"] },
                    periodo: { type: "string", description: "Mes de planilla AAAA-MM (por defecto el actual)." },
                    nota: { type: "string", maxLength: 500 },
                    idempotencia: IDEM, registrado_por: REGISTRADO_POR,
                }, required: ["cid", "pid", "alcance", "idempotencia", "registrado_por"] },
                annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
            },
            async correr(almacen, uid, e) {
                const { registrado_por, ...args } = e;
                return lic(almacen, uid, "crear", args, quienDe(uid, registrado_por));
            },
        },
        {
            def: {
                name: "cambiar_estado_proyecto",
                title: "Cambiar la etapa de un proyecto",
                description: "Cambia la etapa (estado) de un proyecto con historial antes → después, como el panel del proyecto. PEDÍ EL SÍ DEL DUEÑO ANTES. Etapas: " + E.ESTADOS.join(", ") + ".",
                inputSchema: { type: "object", properties: {
                    cid: { type: "string" }, pid: { type: "string" }, estado: { type: "string", enum: E.ESTADOS },
                    motivo: { type: "string", maxLength: 300 }, idempotencia: IDEM, registrado_por: REGISTRADO_POR,
                }, required: ["cid", "pid", "estado", "idempotencia", "registrado_por"] },
                annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
            },
            async correr(almacen, uid, e) {
                const { registrado_por, ...args } = e;
                return proy(almacen, uid, "cambiar_estado", args, quienDe(uid, registrado_por));
            },
        },
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
                name: "ver_licitacion",
                title: "Ver el detalle de una licitación",
                description: "Una licitación {cid, pid, lid} con sus ítems (tareas: clave, nombre, cantidad, unidad, precio, subtotal) y sus extras (clave, descripción, monto). Usalo antes de cambiar_item, quitar_item o anular_extra.",
                inputSchema: { type: "object", properties: { cid: { type: "string" }, pid: { type: "string" }, lid: { type: "string" } }, required: ["cid", "pid", "lid"] },
                annotations: { readOnlyHint: true },
            },
            async correr(almacen, uid, e) { return lic(almacen, uid, "ver", e, null); },
        },
        {
            def: {
                name: "modificar_licitacion",
                title: "Modificar una licitación",
                description: "Cambia una licitación con la misma lógica que la pantalla de Licitaciones (copia del trabajador, responsables en el presupuesto, historial antes → después). PEDÍ EL SÍ DEL DUEÑO ANTES, diciendo qué vas a cambiar y los montos. Operaciones: "
                    + "ÍTEMS (lo que el trabajador ve en su propuesta; usá ver_licitacion para las claves): agregar_items {alcance: [{item?: índice del presupuesto, descripcion?, cant?, und?, monto}]} (sumar trabajo al contrato COMO ÍTEMS, no como extra) · cambiar_item {tarea, monto, cant?, descripcion?} (precio de un ítem por trabajador) · quitar_item {tarea, motivo}; el contrato se ajusta por diferencia · "
                    + "cambiar_monto {monto, motivo?} (solo el total; si está aprobada cambia el precio final, si no, el propuesto) · cambiar_contratista {worker_id} · aprobar {precio_final?} · contra_oferta {precio} · terminar · registrar_pago {monto, fecha?, concepto?, tipo?: pago|adelanto|descuento_compra, pagado_con?: {medio: transferencia|qr|efectivo|caja_chica|otro, persona?}} · anular_pago {pago, motivo} · "
                    + "agregar_extra {monto, descripcion, fecha?} (algo aparte del alcance, que no va como ítem) · anular_extra {extra, motivo} · anular {motivo} (la quita; la copia queda en el historial). No toca gasto_total.",
                inputSchema: { type: "object", properties: {
                    cid: { type: "string" }, pid: { type: "string" }, lid: { type: "string", description: "Id de la licitación (de listar_licitaciones)." },
                    operacion: { type: "string", enum: ["agregar_items", "cambiar_item", "quitar_item", "cambiar_monto", "cambiar_contratista", "aprobar", "contra_oferta", "terminar", "registrar_pago", "anular_pago", "agregar_extra", "anular_extra", "anular"] },
                    alcance: { type: "array", maxItems: 30, items: { type: "object", properties: { item: { type: "integer", minimum: 0 }, descripcion: { type: "string", maxLength: 200 },
                        cant: { type: "number", minimum: 0.0001 }, und: { type: "string", maxLength: 20 }, monto: { type: "number", minimum: 0.01 } }, required: ["monto"] } },
                    tarea: { type: "string", description: "Clave de la tarea (ítem) en la licitación, de ver_licitacion." }, extra: { type: "string", description: "Clave del extra, de ver_licitacion." },
                    cant: { type: "number", minimum: 0.0001 },
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
