/**
 * Licitaciones (docs/sesiones/08-operaciones-kay.md) — una sola lógica en el servidor para lo que hoy hacían
 * licitaciones.html, Tesorería y Compras desde el navegador. La usan la app (/api/licitaciones) y Kay/Claude (conector).
 *
 * Una licitación vive en /proyectos/{cid}/{pid}/licitaciones/{lid} y su copia para el trabajador en
 * /personal/{wid}/solicitudes/{lid} (las dos se escriben juntas). Cada cambio deja historial en
 * /proyectos/{cid}/{pid}/historial_operaciones (antes → después, quién, motivo) y es idempotente.
 *
 * Operaciones (todas con {cid, pid, idempotencia}; las que cambian algo, también {lid}):
 *   listar               {texto?}                       → licitaciones con contrato, pagado, extras y saldo
 *   guardar              {lid?, licitacion}             → crear/editar desde la pantalla (alcance completo)
 *   cambiar_monto        {lid, monto, motivo?}          aprobada → precio_final; si no, precio_propuesto
 *   cambiar_contratista  {lid, worker_id}
 *   aprobar              {lid, precio_final?}           → estado aprobado (+ responsable en los ítems del presupuesto)
 *   contra_oferta        {lid, precio}
 *   terminar             {lid}
 *   registrar_pago       {lid, monto, fecha?, concepto?, tipo?: pago|adelanto|descuento_compra, foto?, pagado_con?}
 *   anular_pago          {lid, pago, motivo}
 *   agregar_extra        {lid, monto, descripcion, fecha?}
 *   anular               {lid, motivo}                  → la quita (de la obra y del trabajador); la copia queda en el historial
 * gasto_total NO se toca: las licitaciones nunca se le sumaban (el dashboard las cuenta aparte), así que anular ya no
 * le resta (antes lo hacía y dejaba el gasto del proyecto por debajo del real).
 */
const crypto = require("crypto");
const C = require("../operaciones/comun");
const { falla, r2, texto, numero, fecha, id } = C;

const APROBADAS = ["aprobado", "adjudicado", "terminado"];
const ESTADOS = ["pendiente", "espera_cotizacion", "enviado", "revisado", "contra_oferta", "aprobado", "adjudicado", "terminado", "rechazado", "anulada", "eliminado"];
const TIPOS_PAGO = ["pago", "adelanto", "descuento_compra"];
const MEDIOS = ["transferencia", "qr", "efectivo", "caja_chica", "otro"];

const RUTAS = [
    /^proyectos\/[^/]+\/[^/]+\/(nombre|licitaciones|historial_operaciones)(\/|$)/,
    /^proyectos\/[^/]+\/[^/]+\/presupuesto\/items\/\d+\/(prod_resp|print_resp)$/,
    /^proyectos\/[^/]+$/,          // listar en todos los proyectos (buscar a un trabajador)
    /^clientes$/,
    /^personal\/[^/]+\/(nombre|solicitudes)(\/|$)/,
    /^operaciones_idem(\/|$)/,
];
const ARCHIVOS = [/^comprobantes\/[^/]+\/[^/]+\/[^/]+\/[A-Za-z0-9_-]+\.(jpg|png|webp|pdf)$/];

const base = (b) => `proyectos/${b.cid}/${b.pid}/licitaciones`;
const contrato = (l) => r2(Number(l.precio_final || l.precio_propuesto) || 0);
const sumar = (o, campo = "monto") => r2(Object.values(o || {}).reduce((s, x) => s + (Number(x && x[campo]) || 0), 0));

function resumen(lid, l) {
    const extras = sumar(l.extras), pagado = sumar(l.pagos);
    return {
        lid, trabajador: l.worker_name || l.worker_id || null, worker_id: l.worker_id || null, estado: l.estado || null,
        tipo: l.is_supervision ? "supervision" : l.is_grafico ? "grafico" : l.lic_mode === "llave_en_mano" ? "llave_en_mano" : "mano_de_obra",
        precio_propuesto: r2(l.precio_propuesto), precio_final: l.precio_final != null ? r2(l.precio_final) : null,
        contrato: contrato(l), extras, pagado, saldo: r2(contrato(l) + extras - pagado), periodo: l.periodo || null,
        tareas: Object.keys(l.tareas || {}).length,
    };
}

async function proyecto(almacen, b) {
    id(b.cid, "Cliente"); id(b.pid, "Proyecto");
    const nombre = await almacen.leer(`proyectos/${b.cid}/${b.pid}/nombre`);
    if (nombre == null) falla("No existe el proyecto.", 404);
    return String(nombre);
}
async function cargar(almacen, b) {
    id(b.lid, "Licitación");
    const l = await almacen.leer(`${base(b)}/${b.lid}`);
    if (!l) falla("No existe la licitación.", 404);
    return l;
}
/** Copia del trabajador: se actualiza solo si existe (algunas, como las internas viejas, no la tienen). */
async function espejo(almacen, wid, lid) {
    if (!wid || !C.ID.test(String(wid))) return null;
    return (await almacen.leer(`personal/${wid}/solicitudes/${lid}`)) ? `personal/${wid}/solicitudes/${lid}` : null;
}
function poner(m, rutas, campos) {
    rutas.filter(Boolean).forEach((r) => Object.keys(campos).forEach((k) => { m[`${r}/${k}`] = campos[k] === undefined ? null : campos[k]; }));
}

/** Responsable en los ítems del presupuesto que toca la licitación (lo que hacía la pantalla al aprobar). */
async function marcarResponsable(almacen, b, l, m) {
    const nombre = l.worker_name;
    if (!nombre) return;
    const campo = l.is_grafico ? "print_resp" : "prod_resp";
    const idxs = [...new Set(Object.values(l.tareas || {}).map((t) => t && t.originIdx).filter((i) => Number.isInteger(Number(i)) && i !== null && i !== ""))].map(Number);
    for (const i of idxs) {
        const ruta = `proyectos/${b.cid}/${b.pid}/presupuesto/items/${i}/${campo}`;
        const actual = String((await almacen.leer(ruta)) || "");
        if (!actual.split(/,\s*/).includes(nombre)) m[ruta] = actual ? `${actual}, ${nombre}` : nombre;
    }
}

async function aplicar(almacen, b, quien, op, l, campos, extra = {}) {
    const m = {};
    const ruta = `${base(b)}/${b.lid}`;
    poner(m, [ruta, await espejo(almacen, l.worker_id, b.lid)], campos);
    const antes = {}; Object.keys(campos).forEach((k) => { antes[k] = l[k] === undefined ? null : l[k]; });
    const [hk, hv] = C.entradaHistorial(almacen, b.cid, b.pid, { area: "licitaciones", ref: b.lid, op, antes, despues: campos, motivo: extra.motivo, quien });
    m[hk] = hv;
    if (extra.responsable) await marcarResponsable(almacen, b, Object.assign({}, l, campos), m);
    await almacen.actualizarVarios(m);
    return { ok: true, lid: b.lid, op, licitacion: resumen(b.lid, Object.assign({}, l, campos)) };
}

// ------------------------------------------------------------------ operaciones
const OPS = {
    async listar(almacen, b) {
        const q = texto(b.texto, 60).toLowerCase();
        const coincide = (l) => !q || String(l.worker_name || "").toLowerCase().includes(q);
        if (b.cid && b.pid) {
            const nombre = await proyecto(almacen, b);
            const ls = (await almacen.leer(base(b))) || {};
            return { proyecto: nombre, licitaciones: Object.keys(ls).filter((k) => ls[k] && coincide(ls[k])).map((k) => resumen(k, ls[k])) };
        }
        if (!q) falla("Sin proyecto, pasá texto (nombre del trabajador) para buscar en todos.");
        const clientes = (await almacen.leer("clientes")) || {};
        const res = [];
        for (const cid of Object.keys(clientes)) {
            const ps = (await almacen.leer(`proyectos/${cid}`).catch(() => null)) || {};
            Object.keys(ps).forEach((pid) => Object.entries((ps[pid] && ps[pid].licitaciones) || {}).forEach(([k, l]) => {
                if (l && coincide(l)) res.push(Object.assign({ cid, pid, proyecto: ps[pid].nombre || pid }, resumen(k, l)));
            }));
        }
        return { licitaciones: res.slice(0, 50) };
    },

    async guardar(almacen, b, quien) {
        const nombreP = await proyecto(almacen, b);
        const p = b.licitacion && typeof b.licitacion === "object" ? b.licitacion : falla("Falta la licitación.");
        const wid = id(p.worker_id, "Trabajador");
        const wNombre = await almacen.leer(`personal/${wid}/nombre`);
        if (wNombre == null) falla("No existe el trabajador.", 404);
        const lid = b.lid ? id(b.lid, "Licitación") : almacen.nuevaClave();
        const vieja = b.lid ? await almacen.leer(`${base(b)}/${lid}`) : null;
        if (b.lid && !vieja) falla("No existe la licitación.", 404);
        if (p.estado != null && !ESTADOS.includes(p.estado)) falla("Estado inválido.");
        const tareas = p.tareas && typeof p.tareas === "object" ? p.tareas : {};
        if (JSON.stringify(tareas).length > 400000) falla("La licitación tiene demasiadas tareas.");
        const nueva = Object.assign({}, vieja || {}, JSON.parse(JSON.stringify(p)), {
            id: lid, cid: b.cid, pid: b.pid, pName: p.pName || nombreP, worker_id: wid, worker_name: String(wNombre).slice(0, 120),
            precio_propuesto: r2(p.precio_propuesto), tareas,
        });
        // lo que la pantalla no puede pisar: pagos, extras e historial se conservan
        if (vieja) { nueva.pagos = vieja.pagos || null; nueva.extras = vieja.extras || null; }
        if (!vieja && !nueva.fecha_envio) nueva.fecha_envio = new Date(almacen.ahora()).toISOString();
        const m = {};
        m[`${base(b)}/${lid}`] = nueva;
        m[`personal/${wid}/solicitudes/${lid}`] = nueva;
        if (vieja && vieja.worker_id && vieja.worker_id !== wid && C.ID.test(String(vieja.worker_id))) m[`personal/${vieja.worker_id}/solicitudes/${lid}`] = null;
        const [hk, hv] = C.entradaHistorial(almacen, b.cid, b.pid, { area: "licitaciones", ref: lid, op: vieja ? "editar" : "crear",
            antes: vieja ? { contrato: contrato(vieja), estado: vieja.estado, trabajador: vieja.worker_name, tareas: Object.keys(vieja.tareas || {}).length } : null,
            despues: { contrato: contrato(nueva), estado: nueva.estado, trabajador: nueva.worker_name, tareas: Object.keys(tareas).length }, quien });
        m[hk] = hv;
        if (APROBADAS.includes(nueva.estado)) await marcarResponsable(almacen, b, nueva, m);
        await almacen.actualizarVarios(m);
        return { ok: true, lid, op: vieja ? "editar" : "crear", licitacion: resumen(lid, nueva) };
    },

    async cambiar_monto(almacen, b, quien) {
        await proyecto(almacen, b);
        const l = await cargar(almacen, b);
        const monto = numero(b.monto, "Monto");
        const campo = APROBADAS.includes(l.estado) ? "precio_final" : "precio_propuesto";
        return aplicar(almacen, b, quien, "cambiar_monto", l, { [campo]: monto, fecha_cambio_monto: almacen.ahora() }, { motivo: texto(b.motivo, 300) || null });
    },

    async cambiar_contratista(almacen, b, quien) {
        await proyecto(almacen, b);
        const l = await cargar(almacen, b);
        const wid = id(b.worker_id, "Trabajador");
        if (wid === l.worker_id) return { ok: true, lid: b.lid, op: "cambiar_contratista", sin_cambios: true, licitacion: resumen(b.lid, l) };
        const nombre = await almacen.leer(`personal/${wid}/nombre`);
        if (nombre == null) falla("No existe el trabajador.", 404);
        const nueva = Object.assign({}, l, { worker_id: wid, worker_name: String(nombre).slice(0, 120) });
        const m = {};
        m[`${base(b)}/${b.lid}/worker_id`] = wid; m[`${base(b)}/${b.lid}/worker_name`] = nueva.worker_name;
        if (l.worker_id && C.ID.test(String(l.worker_id))) m[`personal/${l.worker_id}/solicitudes/${b.lid}`] = null;
        m[`personal/${wid}/solicitudes/${b.lid}`] = nueva;
        const [hk, hv] = C.entradaHistorial(almacen, b.cid, b.pid, { area: "licitaciones", ref: b.lid, op: "cambiar_contratista",
            antes: { worker_id: l.worker_id, trabajador: l.worker_name }, despues: { worker_id: wid, trabajador: nueva.worker_name }, motivo: texto(b.motivo, 300) || null, quien });
        m[hk] = hv;
        if (APROBADAS.includes(l.estado)) await marcarResponsable(almacen, b, nueva, m);
        await almacen.actualizarVarios(m);
        return { ok: true, lid: b.lid, op: "cambiar_contratista", licitacion: resumen(b.lid, nueva) };
    },

    async aprobar(almacen, b, quien) {
        await proyecto(almacen, b);
        const l = await cargar(almacen, b);
        if (l.estado === "terminado") falla("La licitación ya está terminada.");
        const precio = b.precio_final == null || b.precio_final === "" ? numero(l.precio_propuesto, "Precio propuesto") : numero(b.precio_final, "Precio final");
        return aplicar(almacen, b, quien, "aprobar", l, { estado: "aprobado", precio_final: precio, fecha_aprobacion: almacen.ahora() }, { responsable: true });
    },

    async contra_oferta(almacen, b, quien) {
        await proyecto(almacen, b);
        const l = await cargar(almacen, b);
        if (APROBADAS.includes(l.estado)) falla("Ya está aprobada: para cambiar el monto usá cambiar_monto.");
        return aplicar(almacen, b, quien, "contra_oferta", l, { estado: "contra_oferta", precio_contra: numero(b.precio, "Contra oferta") });
    },

    async terminar(almacen, b, quien) {
        await proyecto(almacen, b);
        const l = await cargar(almacen, b);
        if (!APROBADAS.includes(l.estado)) falla("Solo se termina una licitación aprobada.");
        return aplicar(almacen, b, quien, "terminar", l, { estado: "terminado", fecha_terminado: almacen.ahora() });
    },

    async registrar_pago(almacen, b, quien) {
        await proyecto(almacen, b);
        const l = await cargar(almacen, b);
        const monto = numero(b.monto, "Monto");
        const tipo = TIPOS_PAGO.includes(b.tipo) ? b.tipo : "pago";
        const medio = b.pagado_con && MEDIOS.includes(b.pagado_con.medio) ? b.pagado_con.medio : null;
        const f = fecha(b.fecha, "Fecha", almacen.ahora());
        const comp = C.leerComprobante(b.foto);
        const pk = almacen.nuevaClave();
        let comprobante = b.comprobante_url && /^https:\/\/firebasestorage\.googleapis\.com\//.test(String(b.comprobante_url)) ? String(b.comprobante_url) : null;
        if (comp) comprobante = await almacen.subirArchivo(`comprobantes/${b.cid}/${b.pid}/${b.lid}/${pk}.${comp.ext}`, comp.buf, comp.mime, { token: crypto.randomUUID() });
        const pago = { monto, fecha: f, concepto: texto(b.concepto, 200) || (tipo === "adelanto" ? "Adelanto" : "Pago"), tipo,
            comprobante: comprobante || null, pagado_con: medio ? { medio, persona: texto(b.pagado_con.persona, 80) || null } : null,
            wid: l.worker_id || null, registrado_por: quien, timestamp: almacen.ahora() };
        pago.nota = pago.concepto;   // Tesorería y Compras muestran 'nota'; Licitaciones, 'concepto'
        const m = {};
        m[`${base(b)}/${b.lid}/pagos/${pk}`] = pago;
        const esp = await espejo(almacen, l.worker_id, b.lid);
        if (esp) m[`${esp}/pagos/${pk}`] = pago;
        const [hk, hv] = C.entradaHistorial(almacen, b.cid, b.pid, { area: "licitaciones", ref: b.lid, op: "registrar_pago", antes: { pagado: sumar(l.pagos) },
            despues: { pago: pk, monto, tipo, pagado: r2(sumar(l.pagos) + monto) }, motivo: pago.concepto, quien });
        m[hk] = hv;
        await almacen.actualizarVarios(m);
        const r = resumen(b.lid, Object.assign({}, l, { pagos: Object.assign({}, l.pagos, { [pk]: pago }) }));
        return { ok: true, lid: b.lid, op: "registrar_pago", pago: pk, comprobante: pago.comprobante, licitacion: r };
    },

    async anular_pago(almacen, b, quien) {
        await proyecto(almacen, b);
        const l = await cargar(almacen, b);
        const pk = id(b.pago, "Pago");
        const pago = (l.pagos || {})[pk];
        if (!pago) falla("No existe ese pago.", 404);
        const motivo = texto(b.motivo, 300);
        if (!motivo) falla("Falta el motivo.");
        const m = {};
        m[`${base(b)}/${b.lid}/pagos/${pk}`] = null;
        const esp = await espejo(almacen, l.worker_id, b.lid);
        if (esp) m[`${esp}/pagos/${pk}`] = null;
        const [hk, hv] = C.entradaHistorial(almacen, b.cid, b.pid, { area: "licitaciones", ref: b.lid, op: "anular_pago", antes: { pago: pk, ...pago }, despues: null, motivo, quien });
        m[hk] = hv;
        await almacen.actualizarVarios(m);
        const pagos = Object.assign({}, l.pagos); delete pagos[pk];
        return { ok: true, lid: b.lid, op: "anular_pago", licitacion: resumen(b.lid, Object.assign({}, l, { pagos })) };
    },

    async agregar_extra(almacen, b, quien) {
        await proyecto(almacen, b);
        const l = await cargar(almacen, b);
        const monto = numero(b.monto, "Monto");
        const descripcion = texto(b.descripcion, 300);
        if (!descripcion) falla("Falta la descripción del extra.");
        const ek = almacen.nuevaClave();
        const extra = { descripcion, monto, fecha: fecha(b.fecha, "Fecha", almacen.ahora()), registrado_por: quien, timestamp: almacen.ahora() };
        const m = {};
        m[`${base(b)}/${b.lid}/extras/${ek}`] = extra;
        const esp = await espejo(almacen, l.worker_id, b.lid);
        if (esp) m[`${esp}/extras/${ek}`] = extra;
        const [hk, hv] = C.entradaHistorial(almacen, b.cid, b.pid, { area: "licitaciones", ref: b.lid, op: "agregar_extra", antes: { extras: sumar(l.extras) }, despues: { extra: ek, monto, extras: r2(sumar(l.extras) + monto) }, motivo: descripcion, quien });
        m[hk] = hv;
        await almacen.actualizarVarios(m);
        return { ok: true, lid: b.lid, op: "agregar_extra", extra: ek, licitacion: resumen(b.lid, Object.assign({}, l, { extras: Object.assign({}, l.extras, { [ek]: extra }) })) };
    },

    async anular(almacen, b, quien) {
        await proyecto(almacen, b);
        const l = await cargar(almacen, b);
        const motivo = texto(b.motivo, 300);
        if (!motivo) falla("Falta el motivo de la anulación.");
        const m = {};
        m[`${base(b)}/${b.lid}`] = null;
        if (l.worker_id && C.ID.test(String(l.worker_id))) m[`personal/${l.worker_id}/solicitudes/${b.lid}`] = null;
        const [hk, hv] = C.entradaHistorial(almacen, b.cid, b.pid, { area: "licitaciones", ref: b.lid, op: "anular", antes: l, despues: null, motivo, quien });
        m[hk] = hv;
        await almacen.actualizarVarios(m);
        return { ok: true, lid: b.lid, op: "anular", copia_en_historial: hk.split("/").pop(), anulada: resumen(b.lid, l) };
    },
};
const LECTURA = ["listar"];

async function atender(almacen, cuerpo, quienCrudo) {
    const b = cuerpo && typeof cuerpo === "object" && !Array.isArray(cuerpo) ? cuerpo : {};
    return C.responder("licitacionesApi", async () => {
        const op = OPS[b.accion];
        if (!op || !Object.prototype.hasOwnProperty.call(OPS, b.accion)) falla("Acción desconocida.");
        if (LECTURA.includes(b.accion)) return op(almacen, b);
        const quien = C.limpiarQuien(quienCrudo);
        return C.unaVez(almacen, b.idempotencia, () => op(almacen, b, quien));
    });
}

module.exports = { atender, RUTAS, ARCHIVOS, OPS, LECTURA, APROBADAS };
