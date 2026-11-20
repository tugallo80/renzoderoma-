/**
 * Finanzas de un proyecto — UNA sola fórmula de venta, gasto, cobrado y utilidad (Sesión 9, Lote 2;
 * docs/sesiones/09-auditoria.md e1/e2/e3). La usan el panel del proyecto (/api/proyectos), Tesorería y Kay.
 *
 * Venta:   (monto de cierre o presupuesto con descuento e impuestos) + extras aprobados del cliente.
 * Gasto:   compras (historial_compras, sin anuladas) + gastos adicionales de compras + caja chica GASTADA del proyecto
 *          (sin pedidos pendientes) + gastos rendidos por supervisores + trabajos extra aprobados de supervisores
 *          + mano de obra de licitaciones aprobadas/adjudicadas/terminadas.
 *          La mano de obra va de dos formas (decisión del dueño): CONTRATADA (contrato + extras) y PAGADA.
 *          → utilidad_esperada (con lo contratado) y utilidad_con_pagado (con lo ya pagado).
 * Cobrado: los pagos del proyecto (cada cobro de /cobros deja ahí su parte: functions/cobros). Las facturas de venta de
 *          Tesorería se muestran aparte: facturado no es cobrado. saldo_por_cobrar = venta − cobrado.
 * gasto_total (contador viejo) se muestra solo como referencia: mezclaba compras y caja chica (contada dos veces).
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const APROBADAS = ["aprobado", "adjudicado", "terminado"];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (x) => { const n = typeof x === "string" ? parseFloat(x.replace(",", ".")) : Number(x); return isFinite(n) ? n : 0; };
const valores = (o) => (o && typeof o === "object" ? Object.values(o) : []).filter((x) => x && typeof x === "object");
const sumar = (lista, f) => r2(lista.reduce((s, x) => s + num(f(x)), 0));
const norm = (t) => String(t || "").trim().toLowerCase();

/** Venta del proyecto (igual que el panel): monto de cierre o presupuesto con descuento e impuestos, + extras aprobados. */
function venta(p) {
    const pres = p && p.presupuesto, extras = p && p.extras, cierre = p && p.monto_cierre;
    const items = valores(pres && pres.items).filter((it) => it.type !== "chapter" && it.activo !== false);   // el ojo apagado no suma (como presupuesto.html)
    const subtotal = sumar(items, (it) => num(it.cant) * num(it.pu));
    const descuento = r2(pres && pres.descuento);
    const baseImp = r2(subtotal - descuento);
    const impuestos = pres && pres.impuestos ? r2(baseImp * 0.16) : 0;
    const presupuesto = r2(baseImp + impuestos);
    const extrasCliente = sumar(valores(extras).filter((e) => e.estado === "aprobado"), (e) => e.precio);
    const final = r2((num(cierre) > 0 ? num(cierre) : presupuesto) + extrasCliente);
    return { presupuesto, subtotal, descuento, impuestos, monto_cierre: num(cierre) > 0 ? r2(cierre) : null, extras_cliente: extrasCliente, final };
}

/** Nodos que lee (para crearAlmacen). */
const RUTAS = [/^proyectos\/[^/]+\/[^/]+(\/|$)/, /^caja_chica$/, /^supervisores$/, /^ingresos$/];

async function calcular(almacen, cid, pid) {
    if (!ID.test(String(cid || "")) || !ID.test(String(pid || ""))) throw Object.assign(new Error("Proyecto inválido."), { status: 400 });
    const base = `proyectos/${cid}/${pid}`;
    const leer = (r) => almacen.leer(r).catch(() => null);
    const [nombre, pres, extras, lics, hist, adic, cierre, pagos, gt, cajas, sups, ingresos] = await Promise.all([
        leer(`${base}/nombre`), leer(`${base}/presupuesto`), leer(`${base}/extras`), leer(`${base}/licitaciones`), leer(`${base}/historial_compras`),
        leer(`${base}/gastos_adicionales_compras`), leer(`${base}/monto_cierre`), leer(`${base}/pagos`), leer(`${base}/gasto_total`),
        leer("caja_chica"), leer("supervisores"), leer("ingresos"),
    ]);
    if (nombre == null) throw Object.assign(new Error("No existe el proyecto."), { status: 404 });

    // ---- venta (igual que el panel del proyecto)
    const v = venta({ presupuesto: pres, extras, monto_cierre: cierre });
    const ventaFinal = v.final;

    // ---- gasto
    const compras = sumar(valores(hist).filter((c) => !c.anulada && c.estado !== "anulada"), (c) => c.total);
    const adicionales = r2(adic);
    const nombreN = norm(nombre);
    const cajaChica = []; let cajaPendiente = 0;
    Object.entries(cajas || {}).forEach(([wid, w]) => valores(w && w.gastos).forEach((g) => {
        const esDelProyecto = g.pid ? g.pid === pid : norm(g.proyecto) === nombreN;
        if (!esDelProyecto) return;
        const monto = num(g.monto_total || g.monto);
        if (["pendiente", "rechazado", "anulado"].includes(g.estado)) { cajaPendiente += monto; return; }
        cajaChica.push({ wid, monto });
    }));
    const cajaGastada = sumar(cajaChica, (x) => x.monto);
    let supGastos = 0, supExtras = 0;
    Object.values(sups || {}).forEach((s) => {
        const p = s && s.proyectos && s.proyectos[pid];
        if (!p) return;
        supGastos += valores(p.gastos).reduce((t, g) => t + num(g.monto), 0);
        supExtras += valores(p.extras).filter((e) => e.aprobado === true).reduce((t, e) => t + num(e.monto), 0);
    });
    supGastos = r2(supGastos); supExtras = r2(supExtras);
    let moContratado = 0, moPagado = 0, moExtras = 0; const contratistas = [];
    Object.entries(lics || {}).forEach(([lid, l]) => {
        if (!l || typeof l !== "object") return;
        const pagado = valores(l.pagos).reduce((t, p) => t + num(p.monto), 0);
        moPagado += pagado;   // lo pagado cuenta siempre (salió la plata), aunque no esté aprobada
        if (!APROBADAS.includes(l.estado)) return;
        const contrato = num(l.precio_final || l.precio_propuesto);
        const ext = valores(l.extras).reduce((t, e) => t + num(e.monto), 0);
        moContratado += contrato; moExtras += ext;
        contratistas.push({ lid, trabajador: l.worker_name || l.worker_id || null, contrato: r2(contrato), extras: r2(ext), pagado: r2(pagado), saldo: r2(contrato + ext - pagado) });
    });
    moContratado = r2(moContratado); moExtras = r2(moExtras); moPagado = r2(moPagado);

    const otrosGastos = r2(compras + adicionales + cajaGastada + supGastos + supExtras);
    const gastoEsperado = r2(otrosGastos + moContratado + moExtras);
    const gastoPagado = r2(otrosGastos + moPagado);

    // ---- cobrado: los pagos del proyecto (incluye la parte de cada cobro registrado en /cobros, que se copia acá).
    // Las facturas de Tesorería se muestran aparte (facturado no es cobrado).
    const pagosProyecto = sumar(valores(pagos), (p) => p.monto);
    const ing = valores(ingresos).filter((i) => i.is_facturado !== false && !i.anulada && i.tipo !== "cobro")
        .filter((i) => (i.pid && i.pid === pid) || (!i.pid && norm(i.proyecto) === nombreN));
    const facturado = sumar(ing, (i) => i.monto);
    const cobradoIngresos = sumar(ing.filter((i) => i.estado_cobro === "cobrado"), (i) => i.monto);

    return {
        proyecto: { cid, pid, nombre },
        venta: v,
        gasto: {
            compras, compras_adicionales: adicionales, caja_chica: cajaGastada, caja_chica_pendiente: r2(cajaPendiente),
            supervisores_gastos: supGastos, supervisores_extras: supExtras,
            mano_obra_contratada: moContratado, mano_obra_extras: moExtras, mano_obra_pagada: moPagado,
            esperado: gastoEsperado, con_pagado: gastoPagado,
        },
        utilidad_esperada: r2(ventaFinal - gastoEsperado),
        utilidad_con_pagado: r2(ventaFinal - gastoPagado),
        cobrado: { pagos_proyecto: pagosProyecto, facturado_tesoreria: facturado, cobrado_tesoreria: cobradoIngresos },
        saldo_por_cobrar: r2(ventaFinal - pagosProyecto),
        contratistas,
        referencia: { gasto_total_viejo: r2(gt), nota: "gasto_total era un contador que mezclaba compras y caja chica (a veces contada dos veces); ya no se usa para la utilidad." },
    };
}

module.exports = { calcular, venta, RUTAS, APROBADAS };
