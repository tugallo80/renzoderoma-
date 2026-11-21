/**
 * Rendición de cuentas de la plata entregada a un trabajador o contratista para gastos (caja chica): una sola lógica para
 * Tesorería (/api/rendiciones) y Kay por WhatsApp. Usa el nodo que ya existía: /caja_chica/{wid}/{depositos, gastos}
 * (lo leen la app del trabajador y la fórmula de finanzas del proyecto, que solo cuenta los gastos aprobados).
 *
 *   entregado: depósitos (lo que el dueño le dio)
 *   gastos:    lo que rindió, con foto del recibo. Si lo carga el trabajador (Kay por WhatsApp) queda "pendiente" hasta que el
 *              dueño lo aprueba; si lo carga el dueño, queda "aprobado". Con proyecto (pid) cuenta como gasto del proyecto
 *              al aprobarse (functions/proyectos/finanzas.js).
 *   saldo en mano = entregado − gastos aprobados − gastos pendientes   (lo que le queda; negativo = el dueño le debe)
 *
 * Operaciones (la persona: worker_id, o telefono si coincide con uno solo en Personal):
 *   estado         {worker_id|telefono, desde?, hasta?, cid?, pid?} → movimientos, totales y saldo (con cid/pid: solo ese proyecto)
 *   resumen        {}                                              → todas las personas con movimientos: saldo y pendientes
 *   proyecto       {cid, pid}                                      → por persona, la plata para gastos de ese proyecto (Compras del proyecto)
 *   entregar       {persona, monto, fecha?, concepto?, cid?, pid?, medio?, foto?}
 *   registrar_gasto {persona, monto, concepto, fecha?, cid?, pid?, proveedor?, foto?}   (via whatsapp del trabajador → pendiente)
 *   aprobar / rechazar {persona, id, motivo?}                      (gastos pendientes)
 *   anular         {persona, tipo: deposito|gasto, id, motivo}
 *   crear_link     {persona, cid?, pid?, dias?}  → link personal a rendir.html (mini app sin login) · revocar_link {id} · links {persona}
 * Gastos con detalle: items [{detalle, cantidad, unidad, precio}] → el monto es la suma (subtotal = cantidad × precio).
 * El link (functions/rendiciones/link.js) guarda solo el hash del token en /rendicion_links (cerrado a la app).
 * Escrituras idempotentes, con quién y cuándo; nada se borra.
 */
const crypto = require("crypto");
const C = require("../operaciones/comun");
const { falla, r2, texto, numero, fecha, id } = C;

const MEDIOS = ["transferencia", "qr", "efectivo", "otro"];
const NO_CUENTAN = ["rechazado", "anulado"];

const RUTAS = [
    /^caja_chica(\/|$)/,
    /^rendicion_links(\/|$)/,
    /^personal$/,
    /^personal\/[^/]+\/(nombre|telefono)$/,
    /^proyectos\/[^/]+\/[^/]+\/nombre$/,
    /^clientes\/[^/]+\/(nombre|empresa)$/,
    /^operaciones_idem(\/|$)/,
];
const ARCHIVOS = [/^rendiciones\/[A-Za-z0-9_-]+\/\d{4}-\d{2}\/[A-Za-z0-9_-]+\.(jpg|png|webp|pdf)$/];

const valores = (o) => Object.entries(o && typeof o === "object" ? o : {}).filter(([, v]) => v && typeof v === "object");
const soloDigitos = (t) => String(t || "").replace(/\D/g, "");
const montoDe = (x) => Number(x.monto_total != null ? x.monto_total : x.monto) || 0;
const fechaDe = (x) => String(x.fecha || "").slice(0, 10) || (x.timestamp ? new Date(x.timestamp).toISOString().slice(0, 10) : "");

/** worker_id, o el teléfono de quien escribe por WhatsApp (últimos 8 dígitos, como en Bolivia). */
async function persona(almacen, b) {
    if (b.worker_id) {
        const wid = id(b.worker_id, "Trabajador");
        const nombre = await almacen.leer(`personal/${wid}/nombre`);
        if (nombre == null) falla("No existe esa persona en Personal.", 404);
        return { wid, nombre: String(nombre) };
    }
    const tel = soloDigitos(b.telefono).slice(-8);
    if (tel.length < 7) falla("Decí de quién es la rendición (worker_id o teléfono).");
    const ps = valores(await almacen.leer("personal")).filter(([, w]) => soloDigitos(w.telefono).slice(-8) === tel);
    if (!ps.length) falla("Ese número no está en Personal.", 404);
    if (ps.length > 1) falla(`Ese número está en ${ps.length} personas: ${ps.map(([k, w]) => `${w.nombre} (${k})`).join(", ")}. Pasá worker_id.`, 409);
    return { wid: ps[0][0], nombre: String(ps[0][1].nombre || ps[0][0]) };
}

async function proyectoOpcional(almacen, b) {
    if (!b.cid && !b.pid) return null;
    const cid = id(b.cid, "Cliente"), pid = id(b.pid, "Proyecto");
    const nombre = await almacen.leer(`proyectos/${cid}/${pid}/nombre`);
    if (nombre == null) falla("No existe el proyecto.", 404);
    return { cid, pid, nombre: String(nombre) };
}

async function subirFoto(almacen, wid, f, ident, foto) {
    const comp = C.leerComprobante(foto);
    if (!comp) return null;
    return almacen.subirArchivo(`rendiciones/${wid}/${f.slice(0, 7)}/${ident}.${comp.ext}`, comp.buf, comp.mime, { token: crypto.randomUUID() });
}

/** filtro: (movimiento crudo) → bool, para quedarse con un proyecto (los totales también salen de ese proyecto). */
function calcular(caja, desde, hasta, filtro) {
    const enRango = (f) => (!desde || f >= desde) && (!hasta || f <= hasta);
    const ok = filtro || (() => true);
    const deps = valores(caja && caja.depositos).filter(([, d]) => ok(d)).map(([k, d]) => ({ id: k, tipo: "deposito", fecha: fechaDe(d), monto: r2(montoDe(d)), concepto: d.nota || d.concepto || "Entrega",
        proyecto: d.proyecto || null, pid: d.pid || null, medio: d.medio || null, comprobante: d.comprobante || null, estado: d.anulado ? "anulado" : "entregado", por: d.registrado_por || null }));
    const gas = valores(caja && caja.gastos).filter(([, g]) => ok(g)).map(([k, g]) => ({ id: k, tipo: "gasto", fecha: fechaDe(g), monto: r2(montoDe(g)),
        concepto: g.concepto || g.descripcion || g.desc || g.proveedor || "Gasto", proveedor: g.proveedor || null, proyecto: g.proyecto || null, pid: g.pid || null,
        comprobante: g.comprobante || (Array.isArray(g.fotos) ? g.fotos[0] : null) || null, estado: g.estado || "aprobado", motivo: g.motivo_rechazo || null, por: g.registrado_por || null }));
    const movs = deps.concat(gas).filter((m) => enRango(m.fecha)).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const suma = (l) => r2(l.reduce((s, m) => s + m.monto, 0));
    // el saldo es de toda la historia (no del rango): lo que tiene en mano hoy
    const entregado = suma(deps.filter((d) => d.estado !== "anulado"));
    const aprobado = suma(gas.filter((g) => g.estado === "aprobado" || !g.estado));
    const pendiente = suma(gas.filter((g) => g.estado === "pendiente"));
    return {
        movimientos: movs,
        totales: { entregado, gastado_aprobado: aprobado, pendiente_de_aprobar: pendiente, rechazado: suma(gas.filter((g) => g.estado === "rechazado")),
            saldo_en_mano: r2(entregado - aprobado - pendiente) },
        en_rango: { entregado: suma(movs.filter((m) => m.tipo === "deposito" && m.estado !== "anulado")), gastado: suma(movs.filter((m) => m.tipo === "gasto" && !NO_CUENTAN.includes(m.estado))) },
        pendientes: gas.filter((g) => g.estado === "pendiente").map((g) => g.id),
    };
}

/** Movimientos de un proyecto: por pid, o por nombre en los registros viejos sin pid (como finanzas.js). */
const delProyecto = (pid, nombre) => {
    const n = String(nombre || "").trim().toLowerCase();
    return (x) => (x.pid ? x.pid === pid : !!n && String(x.proyecto || "").trim().toLowerCase() === n);
};

// ------------------------------------------------------------------ lectura
async function estado(almacen, b) {
    const p = await persona(almacen, b);
    const desde = b.desde ? fecha(b.desde, "Desde") : null, hasta = b.hasta ? fecha(b.hasta, "Hasta") : null;
    const proy = await proyectoOpcional(almacen, b);
    const caja = await almacen.leer(`caja_chica/${p.wid}`);
    const r = calcular(caja, desde, hasta, proy ? delProyecto(proy.pid, proy.nombre) : null);
    return Object.assign({ worker_id: p.wid, nombre: p.nombre, desde, hasta, proyecto: proy ? proy.nombre : null, cid: proy ? proy.cid : null, pid: proy ? proy.pid : null }, r,
        { nota: r.totales.saldo_en_mano < 0 ? `Gastó ${r2(-r.totales.saldo_en_mano)} Bs más de lo entregado: se le debe.` : null });
}

async function resumen(almacen) {
    const [cajas, ps] = await Promise.all([almacen.leer("caja_chica"), almacen.leer("personal")]);
    const lista = Object.keys(cajas || {}).filter((k) => C.ID.test(k)).map((wid) => {
        const r = calcular(cajas[wid]);
        return { worker_id: wid, nombre: (ps && ps[wid] && ps[wid].nombre) || wid, ...r.totales, pendientes: r.pendientes.length };
    }).filter((x) => x.entregado || x.gastado_aprobado || x.pendiente_de_aprobar)
        .sort((a, b) => b.pendientes - a.pendientes || Math.abs(b.saldo_en_mano) - Math.abs(a.saldo_en_mano));
    return { personas: lista, total_en_mano: r2(lista.reduce((s, x) => s + Math.max(0, x.saldo_en_mano), 0)), gastos_por_aprobar: lista.reduce((s, x) => s + x.pendientes, 0) };
}

async function proyecto(almacen, b) {
    const proy = await proyectoOpcional(almacen, { cid: b.cid, pid: b.pid || falla("Falta el proyecto.") });
    const [cajas, ps] = await Promise.all([almacen.leer("caja_chica"), almacen.leer("personal")]);
    const filtro = delProyecto(proy.pid, proy.nombre);
    const personas = {};
    Object.keys(cajas || {}).filter((k) => C.ID.test(k)).forEach((wid) => {
        const r = calcular(cajas[wid], null, null, filtro);
        if (!r.movimientos.length) return;
        personas[wid] = { worker_id: wid, nombre: (ps && ps[wid] && ps[wid].nombre) || wid, totales: r.totales, movimientos: r.movimientos, pendientes: r.pendientes };
    });
    return { cid: proy.cid, pid: proy.pid, proyecto: proy.nombre, personas };
}

// ------------------------------------------------------------------ escritura
async function entregar(almacen, b, quien) {
    const p = await persona(almacen, b);
    const monto = numero(b.monto, "Monto");
    const f = fecha(b.fecha, "Fecha", almacen.ahora());
    const medio = b.medio ? (MEDIOS.includes(b.medio) ? b.medio : falla("Medio inválido (transferencia, qr, efectivo, otro).")) : null;
    return C.unaVez(almacen, b.idempotencia, async () => {
        const proy = await proyectoOpcional(almacen, b);
        const k = almacen.nuevaClave();
        const comprobante = b.foto ? await subirFoto(almacen, p.wid, f, k, b.foto) : null;
        const dep = { monto, fecha: f, nota: texto(b.concepto, 200) || "Entrega para gastos", proyecto: proy ? proy.nombre : null, cid: proy ? proy.cid : null, pid: proy ? proy.pid : null,
            medio, comprobante, registrado_por: quien, timestamp: almacen.ahora() };
        await almacen.escribir(`caja_chica/${p.wid}/depositos/${k}`, dep);
        const e = calcular(await almacen.leer(`caja_chica/${p.wid}`));
        return { ok: true, id: k, worker_id: p.wid, nombre: p.nombre, monto, saldo_en_mano: e.totales.saldo_en_mano };
    });
}

/** Renglones del gasto (mini app del link o la pantalla): {desc, cant, und, pu, monto} como ya los muestra la app del trabajador. */
function limpiarItems(items) {
    if (items == null) return null;
    if (!Array.isArray(items) || !items.length) falla("El detalle está vacío.");
    if (items.length > 60) falla("Máximo 60 renglones.");
    return items.map((it, n) => {
        const desc = texto(it && (it.detalle || it.desc), 120) || falla(`Renglón ${n + 1}: falta el detalle.`);
        const cant = numero(it.cantidad != null ? it.cantidad : it.cant, `Cantidad del renglón ${n + 1}`);
        const pu = numero(it.precio != null ? it.precio : it.pu, `Precio del renglón ${n + 1}`);
        return { desc, cant, und: texto(it.unidad || it.und, 20) || "und", pu, monto: r2(cant * pu) };
    });
}

async function registrarGasto(almacen, b, quien) {
    const p = await persona(almacen, b);
    const items = limpiarItems(b.items);
    const monto = items ? r2(items.reduce((s, it) => s + it.monto, 0)) : numero(b.monto, "Monto");
    if (monto <= 0) falla("El total tiene que ser mayor a cero.");
    if (monto > 200000) falla("El total es demasiado alto para una rendición: revisalo.");
    const concepto = texto(b.concepto, 200) || (items ? items.map((it) => it.desc).join(", ").slice(0, 200) : "");
    if (!concepto) falla("Falta en qué se gastó (concepto).");
    const f = fecha(b.fecha, "Fecha", almacen.ahora());
    // lo que carga el trabajador queda para que el dueño lo apruebe; lo que carga el dueño (app o su WhatsApp) va aprobado
    const esDueno = quien.rol === "dueño";
    return C.unaVez(almacen, b.idempotencia, async () => {
        const proy = await proyectoOpcional(almacen, b);
        const k = almacen.nuevaClave();
        const comprobante = b.foto ? await subirFoto(almacen, p.wid, f, k, b.foto) : null;
        const g = { monto, monto_total: monto, fecha: f, concepto, proveedor: texto(b.proveedor, 120) || null, items: items || null,
            proyecto: proy ? proy.nombre : null, cid: proy ? proy.cid : null, pid: proy ? proy.pid : null, comprobante,
            estado: esDueno ? "aprobado" : "pendiente", registrado_por: quien, timestamp: almacen.ahora(),
            ...(esDueno ? { aprobado_por: { por: quien, fecha: almacen.ahora() } } : {}) };
        await almacen.escribir(`caja_chica/${p.wid}/gastos/${k}`, g);
        const e = calcular(await almacen.leer(`caja_chica/${p.wid}`));
        return { ok: true, id: k, worker_id: p.wid, nombre: p.nombre, estado: g.estado, saldo_en_mano: e.totales.saldo_en_mano, con_comprobante: !!comprobante };
    });
}

async function decidir(almacen, b, quien, aprobar) {
    const p = await persona(almacen, b);
    const gid = id(b.id, "Gasto");
    const motivo = texto(b.motivo, 200) || null;
    if (!aprobar && !motivo) falla("Falta el motivo del rechazo.");
    return C.unaVez(almacen, b.idempotencia, async () => {
        const ruta = `caja_chica/${p.wid}/gastos/${gid}`;
        const g = await almacen.leer(ruta);
        if (!g) falla("No existe ese gasto.", 404);
        if ((g.estado || "aprobado") !== "pendiente") falla(`Ese gasto ya está ${g.estado || "aprobado"}.`, 409);
        const m = { [`${ruta}/estado`]: aprobar ? "aprobado" : "rechazado" };
        m[`${ruta}/${aprobar ? "aprobado_por" : "rechazado_por"}`] = { por: quien, fecha: almacen.ahora() };
        if (!aprobar) m[`${ruta}/motivo_rechazo`] = motivo;
        await almacen.actualizarVarios(m);
        const e = calcular(await almacen.leer(`caja_chica/${p.wid}`));
        return { ok: true, id: gid, estado: aprobar ? "aprobado" : "rechazado", saldo_en_mano: e.totales.saldo_en_mano };
    });
}

async function anular(almacen, b, quien) {
    const p = await persona(almacen, b);
    const tipo = b.tipo === "deposito" ? "depositos" : b.tipo === "gasto" ? "gastos" : falla("tipo: deposito o gasto.");
    const k = id(b.id, "Movimiento");
    const motivo = texto(b.motivo, 200);
    if (!motivo) falla("Falta el motivo.");
    return C.unaVez(almacen, b.idempotencia, async () => {
        const ruta = `caja_chica/${p.wid}/${tipo}/${k}`;
        const x = await almacen.leer(ruta);
        if (!x) falla("No existe ese movimiento.", 404);
        const info = { motivo, por: quien, fecha: almacen.ahora() };
        await almacen.actualizarVarios(tipo === "depositos"
            ? { [`${ruta}/anulado`]: true, [`${ruta}/anulado_info`]: info }
            : { [`${ruta}/estado`]: "anulado", [`${ruta}/anulado_info`]: info });
        const e = calcular(await almacen.leer(`caja_chica/${p.wid}`));
        return { ok: true, id: k, saldo_en_mano: e.totales.saldo_en_mano };
    });
}

// ------------------------------------------------------------------ link personal (mini app sin login)
const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex").slice(0, 40);
const DIAS_LINK = 30;

async function crearLink(almacen, b, quien) {
    const p = await persona(almacen, b);
    const dias = Math.min(Math.max(parseInt(b.dias, 10) || DIAS_LINK, 1), 90);
    return C.unaVez(almacen, b.idempotencia, async () => {
        const proy = await proyectoOpcional(almacen, b);
        const token = crypto.randomBytes(24).toString("base64url");
        const h = hashToken(token);
        const vence = almacen.ahora() + dias * 86400000;
        await almacen.escribir(`rendicion_links/${h}`, { wid: p.wid, nombre: p.nombre, cid: proy ? proy.cid : null, pid: proy ? proy.pid : null,
            proyecto: proy ? proy.nombre : null, creado: almacen.ahora(), vence, activo: true, creado_por: quien });
        return { ok: true, id: h, url: `https://rubikbolivia.com/rendir.html#${token}`, vence: new Date(vence).toISOString().slice(0, 10), nombre: p.nombre, proyecto: proy ? proy.nombre : null };
    });
}
async function revocarLink(almacen, b, quien) {
    const h = String(b.id || "");
    if (!/^[a-f0-9]{40}$/.test(h)) falla("Link inválido.");
    const l = await almacen.leer(`rendicion_links/${h}`);
    if (!l) falla("No existe ese link.", 404);
    await almacen.actualizarVarios({ [`rendicion_links/${h}/activo`]: false, [`rendicion_links/${h}/revocado`]: { por: quien, fecha: almacen.ahora() } });
    return { ok: true, id: h };
}
async function links(almacen, b) {
    const p = await persona(almacen, b);
    const ahora = almacen.ahora();
    const ls = valores(await almacen.leer("rendicion_links")).filter(([, l]) => l.wid === p.wid)
        .map(([h, l]) => ({ id: h, proyecto: l.proyecto || null, creado: new Date(l.creado).toISOString().slice(0, 10), vence: new Date(l.vence).toISOString().slice(0, 10),
            vigente: !!l.activo && l.vence > ahora, usado: l.usado || 0 }))
        .sort((a, z) => String(z.creado).localeCompare(String(a.creado)));
    return { worker_id: p.wid, nombre: p.nombre, links: ls };
}
/** Para el link: valida el token y devuelve {wid, nombre, cid, pid, proyecto, h}. */
async function porToken(almacen, token) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ""))) falla("Link inválido.", 401);
    const h = hashToken(token);
    const l = await almacen.leer(`rendicion_links/${h}`);
    if (!l || !l.activo) falla("Este link ya no está activo. Pedile uno nuevo a Rubik.", 401);
    if (l.vence <= almacen.ahora()) falla("Este link venció. Pedile uno nuevo a Rubik.", 401);
    return Object.assign({ h }, l);
}

const LECTURA = { estado, resumen, proyecto, links };
const ESCRITURA = { crear_link: crearLink, revocar_link: revocarLink, entregar, registrar_gasto: registrarGasto, aprobar: (a, b, q) => decidir(a, b, q, true), rechazar: (a, b, q) => decidir(a, b, q, false), anular };

function atender(almacen, b, quienCrudo, viaPorDefecto) {
    return C.responder("rendiciones", async () => {
        const accion = b && b.accion;
        if (Object.prototype.hasOwnProperty.call(LECTURA, accion)) return LECTURA[accion](almacen, b);
        if (Object.prototype.hasOwnProperty.call(ESCRITURA, accion)) return ESCRITURA[accion](almacen, b, C.limpiarQuien(quienCrudo || b.registrado_por, viaPorDefecto || "app"));
        falla("Acción desconocida.");
    });
}

module.exports = { atender, calcular, porToken, estado, registrarGasto, hashToken, RUTAS, ARCHIVOS, MEDIOS };
