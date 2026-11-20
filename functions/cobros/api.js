/**
 * Cobros y facturas de venta — una sola lógica en el servidor (Sesión 9, unificación de cobros). La usan Tesorería, el
 * panel del proyecto (/api/cobros) y Kay (kayApi). Antes: pagos sueltos en cada proyecto (dos pantallas, campos
 * distintos), facturas de venta en /ingresos unidas al proyecto por NOMBRE y facturas escaneadas aparte en el proyecto.
 *
 * Datos:
 *   /ingresos/{fid}   factura de venta (lo que ya lee Impuestos): {is_facturado: true, origen: "modulo", cid, pid, proyecto,
 *                     monto, fecha, nro_factura, nit, cuf, cliente_rs, archivo, cobrado, cobros {cobroId: monto},
 *                     estado_cobro: pendiente|parcial|cobrado, fecha_cobro, anulada?, registrado_por}
 *                     + espejo en /proyectos/{cid}/{pid}/facturas_emitidas/{fid} (panel del proyecto y portal del cliente).
 *   /cobros/{id}      la plata que entra: {cid, cliente, fecha, monto, concepto, medio, comprobante,
 *                     aplicaciones: [{pid, proyecto, monto, factura_id?}], anulado?, registrado_por}
 *                     + espejo por proyecto en /proyectos/{cid}/{pid}/pagos/{id}_{n} {monto, fecha, nota, cobro_id, comprobante_url}
 *                     (así el panel, el estado de cuenta, el portal del cliente y la fórmula de finanzas lo ven sin cambios).
 * Un cobro puede repartirse entre varios proyectos del mismo cliente (y aplicarse a sus facturas).
 * Anular en vez de borrar; todo idempotente y con historial en cada proyecto.
 *
 * Operaciones:
 *   pendientes       {cid, monto?}                  → proyectos del cliente con venta, cobrado y saldo; facturas sin cobrar;
 *                                                     con monto, un reparto sugerido (lo más viejo primero)
 *   listar           {cid?, pid?, desde?, hasta?}   → cobros y facturas
 *   registrar_factura {cid, pid, monto, fecha?, nro_factura, nit?, cuf?, cliente_rs?, foto?}
 *   anular_factura   {id, motivo}
 *   registrar_cobro  {cid, monto, fecha?, concepto?, medio?, aplicaciones: [{pid, monto, factura_id?}] | pid, foto?}
 *   anular_cobro     {id, motivo}
 */
const crypto = require("crypto");
const C = require("../operaciones/comun");
const { falla, r2, texto, numero, fecha, id } = C;
const { venta } = require("../proyectos/finanzas");

const MEDIOS = ["transferencia", "qr", "efectivo", "cheque", "deposito", "otro"];
const PRE_CONTRATO = ["requerimiento", "cotizacion", "propuesta_enviada", "negociando", "borrador", "cancelado"];
const TOL = 0.01;

const RUTAS = [
    /^proyectos\/[^/]+\/[^/]+\/(nombre|estado|archivado|fecha_creacion|pagos|facturas_emitidas|historial_operaciones)(\/|$)/,
    /^proyectos\/[^/]+$/,
    /^clientes\/[^/]+\/(nombre|empresa)$/,
    /^ingresos(\/|$)/,
    /^cobros(\/|$)/,
    /^operaciones_idem(\/|$)/,
];
const ARCHIVOS = [/^(cobros|facturas_venta)\/\d{4}-\d{2}\/[A-Za-z0-9_-]+\.(jpg|png|webp|pdf)$/];

const valores = (o) => Object.entries(o && typeof o === "object" ? o : {}).filter(([, v]) => v && typeof v === "object");
const sumar = (lista, f) => r2(lista.reduce((s, x) => s + (Number(f(x)) || 0), 0));
const nombreCliente = async (almacen, cid) => (await almacen.leer(`clientes/${cid}/empresa`)) || (await almacen.leer(`clientes/${cid}/nombre`)) || null;

async function proyectoDe(almacen, cid, pid) {
    id(cid, "Cliente"); id(pid, "Proyecto");
    const nombre = await almacen.leer(`proyectos/${cid}/${pid}/nombre`);
    if (nombre == null) falla(`No existe el proyecto ${pid} en ese cliente.`, 404);
    return String(nombre);
}

function estadoFactura(f) {
    const cobrado = r2(Object.values(f.cobros || {}).reduce((s, x) => s + (Number(x) || 0), 0));
    return { cobrado, estado_cobro: cobrado <= TOL ? "pendiente" : cobrado + TOL >= Number(f.monto) ? "cobrado" : "parcial" };
}
const facturaVigente = (f) => f && f.is_facturado && !f.anulada && f.estado !== "anulada";
const saldoFactura = (f) => r2(Number(f.monto) - estadoFactura(f).cobrado);

async function subir(almacen, carpeta, fechaDoc, ident, foto) {
    const comp = C.leerComprobante(foto);
    if (!comp) return null;
    return almacen.subirArchivo(`${carpeta}/${fechaDoc.slice(0, 7)}/${ident}.${comp.ext}`, comp.buf, comp.mime, { token: crypto.randomUUID() });
}

// ------------------------------------------------------------------ lectura
async function pendientes(almacen, b) {
    const cid = id(b.cid, "Cliente");
    const [ps, ingresos, cliente] = await Promise.all([almacen.leer(`proyectos/${cid}`), almacen.leer("ingresos"), nombreCliente(almacen, cid)]);
    if (!ps) falla("Ese cliente no tiene proyectos.", 404);
    const proyectos = valores(ps).filter(([, p]) => p.archivado !== true && typeof p.nombre === "string" && !PRE_CONTRATO.includes(p.estado))
        .map(([pid, p]) => {
            const v = venta(p).final;
            const cobrado = sumar(valores(p.pagos).map(([, x]) => x), (x) => x.monto);
            return { pid, proyecto: p.nombre, estado: p.estado || "planificacion", fecha: String(p.fecha_creacion || "").slice(0, 10) || null,
                venta: v, cobrado, saldo: r2(v - cobrado) };
        }).sort((a, b) => String(a.fecha || "").localeCompare(String(b.fecha || "")));
    const facturas = valores(ingresos).filter(([, f]) => facturaVigente(f) && f.cid === cid && saldoFactura(f) > TOL)
        .map(([fid, f]) => ({ id: fid, pid: f.pid || null, proyecto: f.proyecto || null, nro_factura: f.nro_factura || null, fecha: f.fecha || null,
            monto: r2(f.monto), saldo: saldoFactura(f) }));
    const conSaldo = new Set(proyectos.filter((p) => p.saldo > TOL).map((p) => p.pid));
    // el resto de sus proyectos (sin saldo, o en cotización: p. ej. un anticipo antes del contrato), por si el dueño elige otro
    const otros = valores(ps).filter(([pid, p]) => !conSaldo.has(pid) && p.archivado !== true && typeof p.nombre === "string")
        .map(([pid, p]) => ({ pid, proyecto: p.nombre, estado: p.estado || "planificacion" }));
    const r = { cid, cliente, proyectos: proyectos.filter((p) => p.saldo > TOL), otros, facturas_pendientes: facturas,
        saldo_total: sumar(proyectos.filter((p) => p.saldo > TOL), (p) => p.saldo) };
    if (b.monto != null) {
        let resto = numero(b.monto, "Monto");
        r.reparto_sugerido = [];
        for (const p of r.proyectos) {
            if (resto <= TOL) break;
            const m = r2(Math.min(resto, p.saldo));
            const f = facturas.find((x) => x.pid === p.pid && x.saldo + TOL >= m) || null;
            r.reparto_sugerido.push({ pid: p.pid, proyecto: p.proyecto, monto: m, factura_id: f ? f.id : null, nro_factura: f ? f.nro_factura : null });
            resto = r2(resto - m);
        }
        if (resto > TOL) r.sin_asignar = resto;   // pagó más que el saldo: el dueño decide a qué proyecto va
        r.nota = "Es una sugerencia (lo más viejo primero): confirmá el reparto con el dueño antes de registrar.";
    }
    return r;
}

async function listar(almacen, b) {
    const cid = b.cid ? id(b.cid, "Cliente") : null, pid = b.pid ? id(b.pid, "Proyecto") : null;
    const desde = b.desde ? fecha(b.desde, "Desde") : null, hasta = b.hasta ? fecha(b.hasta, "Hasta") : null;
    const enRango = (f) => (!desde || String(f || "") >= desde) && (!hasta || String(f || "") <= hasta);
    const [cobros, ingresos] = await Promise.all([almacen.leer("cobros"), almacen.leer("ingresos")]);
    const lc = valores(cobros).filter(([, c]) => (!cid || c.cid === cid) && (!pid || (c.aplicaciones || []).some((a) => a && a.pid === pid)) && enRango(c.fecha))
        .map(([k, c]) => ({ id: k, fecha: c.fecha, cliente: c.cliente, monto: r2(c.monto), concepto: c.concepto || null, anulado: !!c.anulado,
            aplicaciones: (c.aplicaciones || []).filter(Boolean).map((a) => ({ pid: a.pid, proyecto: a.proyecto, monto: r2(a.monto), factura_id: a.factura_id || null })) }))
        .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const lf = valores(ingresos).filter(([, f]) => f.is_facturado && (!cid || f.cid === cid) && (!pid || f.pid === pid) && enRango(f.fecha))
        .map(([k, f]) => Object.assign({ id: k, fecha: f.fecha, proyecto: f.proyecto || null, cid: f.cid || null, pid: f.pid || null, nro_factura: f.nro_factura || null,
            monto: r2(f.monto), anulada: !!f.anulada }, estadoFactura(f)))
        .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    return { cobros: lc, facturas: lf, total_cobrado: sumar(lc.filter((c) => !c.anulado), (c) => c.monto) };
}

// ------------------------------------------------------------------ facturas de venta
async function registrarFactura(almacen, b, quien) {
    const cid = id(b.cid, "Cliente"), pid = id(b.pid, "Proyecto");
    const monto = numero(b.monto, "Monto");
    const nro = texto(b.nro_factura, 30);
    if (!nro) falla("Falta el número de factura.");
    const f = fecha(b.fecha, "Fecha", almacen.ahora());
    const nit = texto(b.nit, 20);
    return C.unaVez(almacen, b.idempotencia, async () => {
        const proyecto = await proyectoDe(almacen, cid, pid);
        const ingresos = (await almacen.leer("ingresos")) || {};
        const repetida = valores(ingresos).find(([, x]) => facturaVigente(x) && String(x.nro_factura || "").trim() === nro && (!nit || !x.nit || String(x.nit) === nit));
        if (repetida) falla(`La factura ${nro} ya está registrada (${repetida[1].proyecto || "sin proyecto"}, ${r2(repetida[1].monto)} Bs).`, 409);
        const fid = almacen.nuevaClave();
        const archivo = b.foto ? await subir(almacen, "facturas_venta", f, fid, b.foto) : null;
        const fac = {
            is_facturado: true, origen: "modulo", cid, pid, proyecto, monto, fecha: f, nro_factura: nro, nit: nit || "", cuf: texto(b.cuf, 120) || "",
            cliente_rs: texto(b.cliente_rs, 120) || "", archivo: archivo || null, cobrado: 0, estado_cobro: "pendiente", fecha_cobro: "",
            registrado_por: quien, timestamp: almacen.ahora(),
        };
        const mapa = {
            [`ingresos/${fid}`]: fac,
            [`proyectos/${cid}/${pid}/facturas_emitidas/${fid}`]: { factura_id: fid, nro_factura: nro, nit_cliente: nit || null, razon_social: fac.cliente_rs || null,
                cuf: fac.cuf || null, fecha: f, monto, url: archivo || null, timestamp: fac.timestamp },
        };
        const [h, v] = C.entradaHistorial(almacen, cid, pid, { area: "cobros", ref: fid, op: "registrar_factura", despues: { nro_factura: nro, monto }, quien });
        mapa[h] = v;
        await almacen.actualizarVarios(mapa);
        return { ok: true, id: fid, proyecto, nro_factura: nro, monto, archivo };
    });
}

async function anularFactura(almacen, b, quien) {
    const fid = id(b.id, "Factura");
    const motivo = texto(b.motivo, 200);
    if (!motivo) falla("Falta el motivo.");
    return C.unaVez(almacen, b.idempotencia, async () => {
        const f = await almacen.leer(`ingresos/${fid}`);
        if (!f || !f.is_facturado) falla("No existe esa factura.", 404);
        if (f.anulada) return { ok: true, id: fid, ya_estaba_anulada: true };
        if (Object.keys(f.cobros || {}).length) falla("Esa factura tiene cobros aplicados: anulá primero esos cobros.", 409);
        const mapa = { [`ingresos/${fid}/anulada`]: true, [`ingresos/${fid}/anulada_info`]: { motivo, por: quien, fecha: almacen.ahora() } };
        if (f.cid && f.pid) {
            mapa[`proyectos/${f.cid}/${f.pid}/facturas_emitidas/${fid}`] = null;
            const [h, v] = C.entradaHistorial(almacen, f.cid, f.pid, { area: "cobros", ref: fid, op: "anular_factura", antes: { nro_factura: f.nro_factura, monto: f.monto }, motivo, quien });
            mapa[h] = v;
        }
        await almacen.actualizarVarios(mapa);
        return { ok: true, id: fid };
    });
}

// ------------------------------------------------------------------ cobros
async function registrarCobro(almacen, b, quien) {
    const cid = id(b.cid, "Cliente");
    const monto = numero(b.monto, "Monto");
    const f = fecha(b.fecha, "Fecha", almacen.ahora());
    let apl = Array.isArray(b.aplicaciones) ? b.aplicaciones : b.pid ? [{ pid: b.pid, monto, factura_id: b.factura_id }] : null;
    if (!apl || !apl.length) falla("Decí a qué proyecto(s) va el cobro (aplicaciones).");
    if (apl.length > 30) falla("Máximo 30 proyectos por cobro.");
    apl = apl.map((a) => ({ pid: id(a && a.pid, "Proyecto"), monto: numero(a.monto, "Monto de la aplicación"), factura_id: a.factura_id ? id(a.factura_id, "Factura") : null }));
    const suma = r2(apl.reduce((s, a) => s + a.monto, 0));
    if (Math.abs(suma - monto) > TOL) falla(`El reparto suma ${suma} Bs y el cobro es de ${monto} Bs: tienen que coincidir.`);
    const medio = b.medio ? (MEDIOS.includes(b.medio) ? b.medio : falla("Medio de pago inválido.")) : null;
    const concepto = texto(b.concepto, 200) || null;
    return C.unaVez(almacen, b.idempotencia, async () => {
        const cliente = await nombreCliente(almacen, cid);
        for (const a of apl) a.proyecto = await proyectoDe(almacen, cid, a.pid);
        // facturas: que sean del cliente y que no se pasen de su saldo (sumando lo de este mismo cobro)
        const facturas = {};
        for (const a of apl.filter((x) => x.factura_id)) {
            const fac = facturas[a.factura_id] || (facturas[a.factura_id] = await almacen.leer(`ingresos/${a.factura_id}`));
            if (!facturaVigente(fac)) falla(`La factura ${a.factura_id} no existe o está anulada.`, 404);
            if (fac.cid && fac.cid !== cid) falla(`La factura ${fac.nro_factura} es de otro cliente.`);
        }
        const porFactura = {};
        apl.filter((x) => x.factura_id).forEach((a) => { porFactura[a.factura_id] = r2((porFactura[a.factura_id] || 0) + a.monto); });
        Object.entries(porFactura).forEach(([fid, m]) => {
            if (m > saldoFactura(facturas[fid]) + TOL) falla(`La factura ${facturas[fid].nro_factura} tiene un saldo de ${saldoFactura(facturas[fid])} Bs y le estás aplicando ${m} Bs.`);
        });
        const cobroId = almacen.nuevaClave();
        const comprobante = b.foto ? await subir(almacen, "cobros", f, cobroId, b.foto) : null;
        const cobro = { cid, cliente, fecha: f, monto, concepto, medio, comprobante: comprobante || null,
            aplicaciones: apl.map((a) => ({ pid: a.pid, proyecto: a.proyecto, monto: a.monto, factura_id: a.factura_id || null })),
            registrado_por: quien, creado: almacen.ahora() };
        const mapa = { [`cobros/${cobroId}`]: cobro };
        apl.forEach((a, n) => {
            const fac = a.factura_id ? facturas[a.factura_id] : null;
            mapa[`proyectos/${cid}/${a.pid}/pagos/${cobroId}_${n}`] = { monto: a.monto, fecha: f, nota: concepto || (apl.length > 1 ? `Cobro repartido (${monto} Bs)` : "Cobro"),
                cobro_id: cobroId, factura: fac ? fac.nro_factura || null : null, comprobante_url: comprobante || null, timestamp: cobro.creado };
            const [h, v] = C.entradaHistorial(almacen, cid, a.pid, { area: "cobros", ref: cobroId, op: "registrar_cobro", despues: { monto: a.monto, de_un_cobro_de: monto }, quien });
            mapa[h] = v;
        });
        Object.entries(porFactura).forEach(([fid, m]) => {
            const fac = facturas[fid];
            const nuevo = estadoFactura({ monto: fac.monto, cobros: Object.assign({}, fac.cobros, { [cobroId]: m }) });
            mapa[`ingresos/${fid}/cobros/${cobroId}`] = m;
            mapa[`ingresos/${fid}/cobrado`] = nuevo.cobrado;
            mapa[`ingresos/${fid}/estado_cobro`] = nuevo.estado_cobro;
            mapa[`ingresos/${fid}/fecha_cobro`] = nuevo.estado_cobro === "cobrado" ? f : "";
        });
        await almacen.actualizarVarios(mapa);
        return { ok: true, id: cobroId, cliente, monto, fecha: f, aplicaciones: cobro.aplicaciones, comprobante };
    });
}

async function anularCobro(almacen, b, quien) {
    const cobroId = id(b.id, "Cobro");
    const motivo = texto(b.motivo, 200);
    if (!motivo) falla("Falta el motivo.");
    return C.unaVez(almacen, b.idempotencia, async () => {
        const c = await almacen.leer(`cobros/${cobroId}`);
        if (!c) falla("No existe ese cobro.", 404);
        if (c.anulado) return { ok: true, id: cobroId, ya_estaba_anulado: true };
        const mapa = { [`cobros/${cobroId}/anulado`]: true, [`cobros/${cobroId}/anulado_info`]: { motivo, por: quien, fecha: almacen.ahora() } };
        const apl = (c.aplicaciones || []).filter(Boolean);
        apl.forEach((a, n) => {
            mapa[`proyectos/${c.cid}/${a.pid}/pagos/${cobroId}_${n}`] = null;
            const [h, v] = C.entradaHistorial(almacen, c.cid, a.pid, { area: "cobros", ref: cobroId, op: "anular_cobro", antes: { monto: a.monto }, motivo, quien });
            mapa[h] = v;
        });
        for (const fid of [...new Set(apl.map((a) => a.factura_id).filter(Boolean))]) {
            const fac = await almacen.leer(`ingresos/${fid}`);
            if (!fac) continue;
            const cobros = Object.assign({}, fac.cobros); delete cobros[cobroId];
            const nuevo = estadoFactura({ monto: fac.monto, cobros });
            mapa[`ingresos/${fid}/cobros/${cobroId}`] = null;
            mapa[`ingresos/${fid}/cobrado`] = nuevo.cobrado;
            mapa[`ingresos/${fid}/estado_cobro`] = nuevo.estado_cobro;
            if (nuevo.estado_cobro !== "cobrado") mapa[`ingresos/${fid}/fecha_cobro`] = "";
        }
        await almacen.actualizarVarios(mapa);
        return { ok: true, id: cobroId };
    });
}

const OPS = {
    pendientes: { leer: true, fn: pendientes },
    listar: { leer: true, fn: listar },
    registrar_factura: { fn: registrarFactura },
    anular_factura: { fn: anularFactura },
    registrar_cobro: { fn: registrarCobro },
    anular_cobro: { fn: anularCobro },
};

/** {status, cuerpo}. quien: lo pone el servidor (app: token; Kay: kayApi; Claude: el conector). */
function atender(almacen, b, quien, viaPorDefecto) {
    return C.responder("cobros", async () => {
        const op = OPS[b && b.accion];
        if (!op) falla("Acción desconocida.");
        return op.fn(almacen, b, C.limpiarQuien(quien || b.registrado_por, viaPorDefecto || "app"));
    });
}

module.exports = { atender, OPS, RUTAS, ARCHIVOS, MEDIOS, estadoFactura };
