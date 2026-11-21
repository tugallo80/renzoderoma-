/**
 * Compras (docs/sesiones/07-compras.md) — UNA sola regla de negocio para registrar compras y facturas de compra.
 * La usan la app (/api/compras, lista blanca hub) y Kay (kayApi → registrar_compra, anular_compra, balances).
 *
 * Una compra es UNA operación que deja todo en su lugar:
 *   /compras/{id}                                   el registro (es también el egreso de Tesorería, por mes)
 *   /proyectos/{cid}/{pid}/historial_compras/{id}   espejo para las pantallas de hoy (+ gasto_total con transacción)
 *   /compras_facturadas/{id}                        crédito fiscal (ÚNICO lugar; lo lee la pestaña Impuestos)
 *   /base_datos/proveedores/{clave}                 proveedor (clave NIT_… o NOM_…), sus facturas y precios
 *   /base_datos/materiales/{clave}                  precio del material (sin crear repetidos: functions/agente/claves.js)
 *   Storage compras/{AAAA-MM}/{id}.{ext}            foto del comprobante
 * Reintentar con la misma `idempotencia` no duplica (/compras_idem). Las compras no se borran: se anulan.
 *
 * Acciones:
 *   registrar        {idempotencia, total?, fecha?, cid?, pid?, proveedor?: {nombre, nit?, contacto?},
 *                     factura?: {nit, razon_social?, nro, cuf?, fecha?, monto?}, items?: [{material, cantidad, unidad?, precio}],
 *                     nota?, foto?: {datos_base64, mime?} (JPG/PNG/WEBP/PDF), pagado_con?: {medio, persona?}, origen?: {tipo, ref?},
 *                     items_referencia?: true (precios leídos de un recibo: no tienen que sumar exacto al total),
 *                     categoria?: alquiler|mantenimiento|herramientas|servicios|otros (gasto de funcionamiento del taller, sin proyecto)}
 *                    → {id, repetida, proveedor_id, resumen}
 *   anular           {id, motivo} → {ok, id}
 *   balance_mensual  {mes: "AAAA-MM"}   (el balance de un proyecto: functions/proyectos/finanzas.js); separa compras de proyectos,
 *                    funcionamiento (por categoría) y sin clasificar
 *   funcionamiento   {mes?, meses?} → gastos de funcionamiento del mes, total por categoría y los meses anteriores
 * `quien` (lo pone el servidor, nunca el pedido de la app): {uid?, rol, nombre, telefono?, via: "app"|"whatsapp"}.
 */
const crypto = require("crypto");
const { norm, resolverClave } = require("../agente/claves");

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-\d{2}$/;
const MAX_FOTO = 8 * 1024 * 1024;
const MAX_ITEMS = 100;
const TOLERANCIA_BS = 1;
const MEDIOS = ["transferencia", "qr", "efectivo", "caja_chica", "tarjeta", "otro"];
const ORIGENES = ["directa", "solicitud", "caja_chica", "migrada"];
// Gastos de funcionamiento del taller (sin proyecto): van al balance mensual aparte de los costos de los proyectos.
// Las herramientas, cuando exista el módulo de inventario, además entran ahí.
const CATEGORIAS = ["alquiler", "mantenimiento", "herramientas", "servicios", "otros"];
const VIAS = ["app", "whatsapp", "agente", "migracion"];

/** Nodos de la base que toca este módulo (crearAlmacen los verifica en cada lectura y escritura). */
const RUTAS = [
    /^compras(\/|$)/, /^compras_idem(\/|$)/, /^compras_facturadas(\/|$)/,
    /^base_datos\/proveedores(\/|$)/, /^base_datos\/proveedores_alias(\/|$)/, /^base_datos\/materiales(\/|$)/,
    /^proyectos\/[^/]+\/[^/]+\/(nombre|estado|monto_cierre|gasto_total|gastos_adicionales_compras|historial_compras|licitaciones)(\/|$)/,
    /^proyectos\/[^/]+$/, /^clientes$/, /^ingresos$/, /^cobros$/, /^cancheos$/,
];
const ARCHIVOS = [/^compras\/\d{4}-\d{2}\/[A-Za-z0-9_-]+\.(jpg|png|webp|pdf)$/];

class ErrorPedido extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }
const falla = (m, s) => { throw new ErrorPedido(m, s); };

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const texto = (t, max) => String(t == null ? "" : t).replace(/\s+/g, " ").trim().slice(0, max);
function numero(x, que, { min = 0, cero = false } = {}) {
    const n = typeof x === "string" ? parseFloat(x.replace(/\s/g, "").replace(",", ".")) : Number(x);
    if (!isFinite(n) || n < min || (!cero && n === 0)) falla(`${que} inválido.`);
    return r2(n);
}
const hoyBolivia = (ms) => new Date((ms || Date.now()) - 4 * 3600 * 1000).toISOString().slice(0, 10);
function fecha(f, que, ahora) {
    if (f == null || f === "") return hoyBolivia(ahora);
    const t = String(f).trim().slice(0, 10);
    if (!FECHA.test(t) || isNaN(Date.parse(t))) falla(`${que} inválida (AAAA-MM-DD).`);
    return t;
}
const soloDigitos = (s) => String(s || "").replace(/\D+/g, "");

// ------------------------------------------------------------------ proveedores
/** Clave nueva de proveedor: por NIT si tiene; si no, por nombre normalizado. */
function claveProveedor(nombre, nit) {
    const d = soloDigitos(nit);
    if (d.length >= 5) return "NIT_" + d;
    const n = norm(nombre).toUpperCase().replace(/\s+/g, "_").slice(0, 70);
    return n ? "NOM_" + n : "NOM_SIN_NOMBRE";
}
/** Busca el proveedor que ya existe (alias de la migración, NIT, nombre) o devuelve la clave nueva. */
function buscarProveedor(provs, alias, nombre, nit) {
    const clave = claveProveedor(nombre, nit);
    if (alias && alias[clave] && provs[alias[clave]]) return { clave: alias[clave], existe: true };
    if (provs[clave]) return { clave, existe: true };
    const d = soloDigitos(nit);
    if (d.length >= 5) {
        const k = Object.keys(provs).find((k) => provs[k] && soloDigitos(provs[k].nit) === d);
        if (k) return { clave: k, existe: true };
    }
    const nn = norm(nombre);
    if (nn) {
        const k = Object.keys(provs).find((k) => provs[k] && (norm(provs[k].nombre) === nn || norm(k) === nn));
        if (k) return { clave: k, existe: true };
    }
    return { clave, existe: false };
}

// ------------------------------------------------------------------ validación
function limpiarFactura(f, total, ahora) {
    if (f == null) return null;
    if (typeof f !== "object" || Array.isArray(f)) falla("Factura inválida.");
    const nit = soloDigitos(f.nit);
    if (nit.length < 5) falla("La factura necesita el NIT del proveedor.");
    const nro = texto(f.nro, 40);
    if (!nro) falla("La factura necesita su número.");
    return {
        nit, nro, razon_social: texto(f.razon_social, 160), cuf: texto(f.cuf, 120).replace(/\s+/g, ""),
        fecha: fecha(f.fecha, "Fecha de la factura", ahora),
        monto: f.monto == null || f.monto === "" ? total : numero(f.monto, "Monto de la factura"),
    };
}
function limpiarItems(items) {
    if (items == null) return [];
    if (!Array.isArray(items)) falla("Los ítems tienen que ser una lista.");
    if (items.length > MAX_ITEMS) falla(`Máximo ${MAX_ITEMS} ítems por compra.`);
    return items.map((it, i) => {
        const material = texto(it && it.material, 120);
        if (!material) falla(`Al ítem ${i + 1} le falta el material.`);
        const cantidad = numero(it.cantidad == null ? 1 : it.cantidad, `Cantidad del ítem ${i + 1}`);
        const precio = numero(it.precio, `Precio del ítem ${i + 1}`, { cero: true });
        return { material, cantidad, unidad: texto(it.unidad, 20) || "und", precio, subtotal: r2(cantidad * precio) };
    });
}
function limpiarQuien(q) {
    const via = VIAS.includes(q && q.via) ? q.via : "app";
    return { uid: q && q.uid ? String(q.uid).slice(0, 128) : null, rol: texto(q && q.rol, 30) || "dueño", nombre: texto(q && q.nombre, 80) || null,
        telefono: q && q.telefono ? texto(q.telefono, 20) : null, via };
}
function leerFoto(foto) {
    if (foto == null) return null;
    const datos = String((foto && foto.datos_base64) || "").replace(/^data:[^,]*,/, "");
    if (!datos) falla("La foto está vacía.");
    const buf = Buffer.from(datos, "base64");
    if (!buf.length) falla("La foto está vacía.");
    if (buf.length > MAX_FOTO) falla("El comprobante pesa más de 8 MB.", 413);
    const ext = buf[0] === 0xff && buf[1] === 0xd8 ? "jpg" : buf[0] === 0x89 && buf[1] === 0x50 ? "png"
        : buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP" ? "webp"
        : buf.slice(0, 5).toString() === "%PDF-" ? "pdf" : null;
    if (!ext) falla("El comprobante tiene que ser JPG, PNG, WEBP o PDF.");
    return { buf, ext, mime: ext === "jpg" ? "image/jpeg" : ext === "pdf" ? "application/pdf" : "image/" + ext };
}
const claveIdem = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 40);

// ------------------------------------------------------------------ registrar
async function registrar(almacen, b, quienCrudo) {
    const quien = limpiarQuien(quienCrudo);
    const ahora = almacen.ahora();
    const idem = texto(b.idempotencia, 200);
    if (idem.length < 6) falla("Falta la clave de idempotencia (identifica el pedido para no duplicarlo).");

    // validar TODO antes de escribir
    const items = limpiarItems(b.items);
    const suma = r2(items.reduce((s, it) => s + it.subtotal, 0));
    let total = b.total == null || b.total === "" ? null : numero(b.total, "Total");
    if (total == null) { if (!(suma > 0)) falla("Falta el total de la compra."); total = suma; }
    // items_referencia: los ítems son precios leídos de un recibo (por IA) y pueden no sumar exacto al total (descuentos,
    // redondeos): se guardan igual y se marca la diferencia. Sin esa marca, tienen que coincidir.
    const itemsRef = b.items_referencia === true;
    if (!itemsRef && items.length && suma > 0 && Math.abs(suma - total) > TOLERANCIA_BS) falla(`La suma de los ítems (${suma} Bs) no coincide con el total (${total} Bs).`);
    const factura = limpiarFactura(b.factura, total, ahora);
    const f = fecha(b.fecha || (factura && factura.fecha), "Fecha", ahora);
    const prov = b.proveedor && typeof b.proveedor === "object" ? b.proveedor : {};
    const provNombre = texto(prov.nombre || (factura && factura.razon_social), 120) || (factura ? "" : "PROVEEDOR LOCAL");
    const provNit = soloDigitos(prov.nit || (factura && factura.nit));
    if (!provNombre && !provNit) falla("Falta el proveedor.");
    const categoria = b.categoria == null || b.categoria === "" ? null
        : CATEGORIAS.includes(b.categoria) ? b.categoria : falla(`Categoría inválida: ${CATEGORIAS.join(", ")}.`);
    if (categoria && (b.cid || b.pid)) falla("Los gastos de funcionamiento (categoría) no van a un proyecto.");
    let proyecto = null;
    if (b.cid || b.pid) {
        if (!ID.test(String(b.cid || "")) || !ID.test(String(b.pid || ""))) falla("Proyecto inválido.");
        const nombre = await almacen.leer(`proyectos/${b.cid}/${b.pid}/nombre`);
        if (nombre == null) falla("No existe el proyecto.", 404);
        proyecto = { cid: b.cid, pid: b.pid, nombre: String(nombre).slice(0, 160) };
    }
    const medio = b.pagado_con && MEDIOS.includes(b.pagado_con.medio) ? b.pagado_con.medio : null;
    const origenTipo = b.origen && ORIGENES.includes(b.origen.tipo) && b.origen.tipo !== "migrada" ? b.origen.tipo : "directa";
    const foto = leerFoto(b.foto);

    // idempotencia: el primero que llega reserva el id; los reintentos reciben la misma compra
    const ki = claveIdem(idem);
    const nuevoId = almacen.nuevaClave();
    const t = await almacen.transaccion(`compras_idem/${ki}`, (v) => (v ? undefined : { id: nuevoId, creado: ahora }));
    let id = nuevoId;
    if (!t.ok) {
        id = t.valor && t.valor.id;
        if (!id || !ID.test(String(id))) falla("No se pudo reservar la compra; reintentá.", 409);
        const previa = await almacen.leer(`compras/${id}`);
        if (previa) {
            if (previa.proyecto && previa.estado === "registrada") await aplicarGasto(almacen, id, previa, +1);   // por si el intento anterior se cortó antes
            return { id, repetida: true, proveedor_id: previa.proveedor_id, resumen: resumen(previa) };
        }
        // el intento anterior reservó el id pero se cortó antes de grabar: se completa con el mismo id
    }
    const mes = f.slice(0, 7);

    // proveedor y materiales (lectura de la base para no crear repetidos)
    const [provs, alias, mats] = await Promise.all([
        almacen.leer("base_datos/proveedores"), almacen.leer("base_datos/proveedores_alias"), items.length ? almacen.leer("base_datos/materiales") : null,
    ]);
    const pv = buscarProveedor(provs || {}, alias || {}, provNombre, provNit);
    const provPrevio = (provs || {})[pv.clave] || {};

    let comprobante = null;
    if (foto) {
        const ruta = `compras/${mes}/${id}.${foto.ext}`;
        const url = await almacen.subirArchivo(ruta, foto.buf, foto.mime, { token: crypto.randomUUID() });
        comprobante = { ruta, url };
    }

    const itemsConClave = items.map((it) => ({ ...it, material_clave: resolverClave(mats || {}, it.material).clave }));
    const compra = {
        fecha: f, mes, total, moneda: "BOB", proyecto, categoria, proveedor_id: pv.clave, proveedor_nombre: provNombre || provPrevio.nombre || provNit,
        factura, items: itemsConClave.length ? itemsConClave : null, nota: texto(b.nota, 500) || null, comprobante,
        pagado_con: medio ? { medio, persona: texto(b.pagado_con.persona, 80) || null } : null,
        origen: { tipo: origenTipo, ref: b.origen && b.origen.ref ? texto(b.origen.ref, 120) : null },
        registrado_por: quien, idempotencia: ki, creado: ahora, estado: "registrada",
        items_diferencia: itemsRef && items.length && Math.abs(suma - total) > TOLERANCIA_BS ? r2(total - suma) : null,
    };

    const m = {};
    m[`compras/${id}`] = compra;
    // proveedor: datos de contacto sin pisar lo que ya tiene
    const pBase = `base_datos/proveedores/${pv.clave}`;
    if (!pv.existe) { m[`${pBase}/nombre`] = compra.proveedor_nombre; m[`${pBase}/creado`] = ahora; m[`${pBase}/origen`] = "compra"; }
    if (provNit && !provPrevio.nit) m[`${pBase}/nit`] = provNit;
    if (prov.contacto && !provPrevio.contacto) m[`${pBase}/contacto`] = texto(prov.contacto, 80);
    m[`${pBase}/ultima_compra`] = f;
    if (factura) {
        m[`${pBase}/facturas/${id}`] = { nro_factura: factura.nro, fecha: factura.fecha, monto: factura.monto, cuf: factura.cuf, descripcion: compra.nota || "", compra_id: id };
        m[`compras_facturadas/${id}`] = {
            nit: factura.nit, proveedor: compra.proveedor_nombre, razon_social: factura.razon_social, nro_factura: factura.nro, cuf: factura.cuf,
            monto: factura.monto, fecha: factura.fecha, descripcion: compra.nota || (proyecto ? proyecto.nombre : ""),
            comprobante: comprobante ? comprobante.url : null, compra_id: id, proyecto: proyecto ? proyecto.nombre : null, timestamp: ahora,
        };
    }
    // precios: por proveedor siempre; el general del material, en su registro (sin crear repetidos)
    itemsConClave.forEach((it) => {
        if (!(it.precio > 0)) return;
        m[`${pBase}/materiales/${it.material_clave}`] = { precio: it.precio, und: it.unidad, fecha_act: f, compra_id: id };
        const previo = (mats || {})[it.material_clave];
        const mb = `base_datos/materiales/${it.material_clave}`;
        if (!previo) { m[`${mb}/n`] = it.material; m[`${mb}/u`] = it.unidad; m[`${mb}/origen`] = "compra"; }
        m[`${mb}/p`] = it.precio; m[`${mb}/proveedor_ref`] = compra.proveedor_nombre; m[`${mb}/fecha_mod`] = ahora; m[`${mb}/falta_precio`] = null;
    });
    if (proyecto) {
        m[`proyectos/${proyecto.cid}/${proyecto.pid}/historial_compras/${id}`] = {
            proveedor: compra.proveedor_nombre, total, fecha: f, comprobante: comprobante ? comprobante.url : null,
            nota: compra.nota || (factura ? `Factura ${factura.nro}` : "Compra"), compra_id: id, registrado_por: quien.nombre || quien.rol,
        };
    }
    await almacen.actualizarVarios(m);
    if (proyecto) await aplicarGasto(almacen, id, compra, +1);
    return { id, repetida: false, proveedor_id: pv.clave, proveedor_nuevo: !pv.existe, resumen: resumen(compra) };
}

/**
 * Suma (+1) o resta (-1) la compra en gasto_total UNA sola vez: la marca compras/{id}/gasto_total_aplicado cambia con
 * transacción y solo quien la cambia toca gasto_total (también con transacción). Reintentos y anulaciones dobles no duplican.
 */
async function aplicarGasto(almacen, id, c, signo) {
    // Ojo (Admin SDK): la primera pasada de una transacción ve el valor LOCAL, que suele estar vacío. Devolver undefined ahí
    // la cancela sin preguntarle al servidor: ante null se devuelve null para que el servidor compare y la reintente.
    const t = await almacen.transaccion(`compras/${id}/gasto_total_aplicado`, (v) => (signo > 0 ? (v ? undefined : true) : (v === true ? false : v == null ? null : undefined)));
    if (!t.ok || t.valor !== (signo > 0)) return false;
    await almacen.transaccion(`proyectos/${c.proyecto.cid}/${c.proyecto.pid}/gasto_total`, (v) => Math.max(0, r2((parseFloat(v) || 0) + signo * c.total)));
    return true;
}

function resumen(c) {
    const partes = [`${c.total} Bs a ${c.proveedor_nombre || c.proveedor_id}`, c.fecha];
    if (c.proyecto) partes.push(`proyecto ${c.proyecto.nombre}`);
    if (c.factura) partes.push(`factura ${c.factura.nro}`);
    if (c.estado === "anulada") partes.push("ANULADA");
    return partes.join(" · ");
}

// ------------------------------------------------------------------ anular
async function anular(almacen, b, quienCrudo) {
    const quien = limpiarQuien(quienCrudo);
    if (!ID.test(String(b.id || ""))) falla("Compra inválida.");
    const motivo = texto(b.motivo, 300);
    if (!motivo) falla("Falta el motivo de la anulación.");
    const ahora = almacen.ahora();
    // la transacción marca la compra: dos anulaciones a la vez no restan dos veces
    const t = await almacen.transaccion(`compras/${b.id}/estado`, (v) => (v === "registrada" ? "anulada" : v == null ? null : undefined));
    if (t.valor == null) falla("No existe la compra.", 404);
    if (!t.ok) return { ok: true, id: b.id, ya_estaba_anulada: true };
    const c = await almacen.leer(`compras/${b.id}`);
    const m = {};
    m[`compras/${b.id}/anulada`] = { por: quien, fecha: ahora, motivo };
    if (c.factura) {
        m[`compras_facturadas/${b.id}/anulada`] = true;
        m[`base_datos/proveedores/${c.proveedor_id}/facturas/${b.id}/anulada`] = true;
    }
    if (c.proyecto) m[`proyectos/${c.proyecto.cid}/${c.proyecto.pid}/historial_compras/${b.id}/anulada`] = true;
    await almacen.actualizarVarios(m);
    if (c.proyecto) await aplicarGasto(almacen, b.id, c, -1);
    return { ok: true, id: b.id, resumen: resumen({ ...c, estado: "anulada" }) };
}

// ------------------------------------------------------------------ balances (lectura)
const enMes = (f, mes) => typeof f === "string" && f.slice(0, 7) === mes;
const vivas = (o) => Object.entries(o || {}).filter(([, v]) => v && typeof v === "object" && v.estado !== "anulada" && !v.anulada);

async function balanceMensual(almacen, b) {
    const mes = String(b.mes || "").trim() || hoyBolivia(almacen.ahora()).slice(0, 7);
    if (!MES.test(mes)) falla("Mes inválido (AAAA-MM).");
    const [compras, facturas, ingresos, cancheos, clientes, cobros] = await Promise.all([
        almacen.leer("compras"), almacen.leer("compras_facturadas"), almacen.leer("ingresos"), almacen.leer("cancheos"), almacen.leer("clientes"),
        almacen.leer("cobros").catch(() => null),
    ]);
    const cDelMes = vivas(compras).filter(([, c]) => c.mes === mes);
    const egCompras = r2(cDelMes.reduce((s, [, c]) => s + (Number(c.total) || 0), 0));
    const sumaDe = (lista) => r2(lista.reduce((s, [, c]) => s + (Number(c.total) || 0), 0));
    const func = cDelMes.filter(([, c]) => c.categoria);
    const porCategoria = {};
    func.forEach(([, c]) => { porCategoria[c.categoria] = r2((porCategoria[c.categoria] || 0) + (Number(c.total) || 0)); });
    let pagosContratistas = 0;
    for (const cid of Object.keys(clientes || {})) {
        const ps = (await almacen.leer(`proyectos/${cid}`).catch(() => null)) || {};
        Object.values(ps).forEach((p) => Object.values((p && p.licitaciones) || {}).forEach((l) => Object.values((l && l.pagos) || {}).forEach((pay) => {
            if (pay && enMes(pay.fecha, mes)) pagosContratistas += Number(pay.monto) || 0;
        })));
    }
    let pagosCancheos = 0;
    Object.values(cancheos || {}).forEach((c) => Object.values((c && c.pagos) || {}).forEach((pay) => { if (pay && enMes(pay.fecha, mes)) pagosCancheos += Number(pay.monto) || 0; }));
    // Ingresos = plata cobrada: los cobros (functions/cobros) + los registros viejos de /ingresos (como antes). Las facturas
    // del módulo de cobros no suman acá (su plata entra por el cobro): van en "facturado" y en el débito fiscal.
    const ingMes = vivas(ingresos).filter(([, i]) => enMes(i.fecha, mes)).map(([, i]) => i);
    const ing = ingMes.filter((i) => i.origen !== "modulo");
    const cobMes = Object.values(cobros || {}).filter((c) => c && !c.anulado && enMes(c.fecha, mes));
    const totalIngresos = r2(ing.reduce((s, i) => s + (Number(i.monto) || 0), 0) + cobMes.reduce((s, c) => s + (Number(c.monto) || 0), 0));
    const facturadoVenta = r2(ingMes.filter((i) => i.is_facturado).reduce((s, i) => s + (Number(i.monto) || 0), 0));
    const credito = vivas(facturas).filter(([, f]) => enMes(f.fecha, mes));
    const montoFacturado = r2(credito.reduce((s, [, f]) => s + (Number(f.monto) || 0), 0));
    const egresos = r2(egCompras + pagosContratistas + pagosCancheos);
    return {
        mes, ingresos: { total: totalIngresos, registros: ing.length, cobros: cobMes.length, facturado: facturadoVenta, debito_fiscal_iva_13: r2(facturadoVenta * 0.13) },
        egresos: { total: egresos, compras: egCompras, pagos_contratistas: r2(pagosContratistas), pagos_cancheos: r2(pagosCancheos), cantidad_compras: cDelMes.length,
            // compras = de_proyectos + funcionamiento + sin_clasificar
            compras_de_proyectos: sumaDe(cDelMes.filter(([, c]) => c.proyecto)),
            funcionamiento: { total: sumaDe(func), por_categoria: porCategoria },
            compras_sin_clasificar: sumaDe(cDelMes.filter(([, c]) => !c.proyecto && !c.categoria)) },
        resultado: r2(totalIngresos - egresos),
        impuestos: { compras_con_factura: credito.length, monto_facturado: montoFacturado, credito_fiscal_iva_13: r2(montoFacturado * 0.13) },
        nota: "Egresos: compras registradas + pagos a contratistas y cancheos con fecha en el mes. Los gastos adicionales de compras sin fecha no entran.",
    };
}

/** Gastos de funcionamiento de un mes (lista y total por categoría) + los totales de los meses anteriores para comparar. */
async function funcionamiento(almacen, b) {
    const mes = String(b.mes || "").trim() || hoyBolivia(almacen.ahora()).slice(0, 7);
    if (!MES.test(mes)) falla("Mes inválido (AAAA-MM).");
    const meses = Math.min(Math.max(parseInt(b.meses, 10) || 6, 1), 24);
    const compras = vivas(await almacen.leer("compras")).filter(([, c]) => c.categoria);
    const delMes = compras.filter(([, c]) => c.mes === mes).sort((a, z) => String(z[1].fecha).localeCompare(String(a[1].fecha)));
    const porCategoria = {};
    delMes.forEach(([, c]) => { porCategoria[c.categoria] = r2((porCategoria[c.categoria] || 0) + (Number(c.total) || 0)); });
    const [a, m] = mes.split("-").map(Number);
    const historial = [];
    for (let i = meses - 1; i >= 0; i--) {
        const d = new Date(Date.UTC(a, m - 1 - i, 1)); const mk = d.toISOString().slice(0, 7);
        const cs = compras.filter(([, c]) => c.mes === mk);
        const pc = {}; cs.forEach(([, c]) => { pc[c.categoria] = r2((pc[c.categoria] || 0) + (Number(c.total) || 0)); });
        historial.push({ mes: mk, total: r2(cs.reduce((s, [, c]) => s + (Number(c.total) || 0), 0)), por_categoria: pc });
    }
    return {
        mes, categorias: CATEGORIAS, total: r2(delMes.reduce((s, [, c]) => s + (Number(c.total) || 0), 0)), por_categoria: porCategoria,
        gastos: delMes.map(([id, c]) => ({ id, fecha: c.fecha, categoria: c.categoria, total: r2(c.total), proveedor: c.proveedor_nombre || null, nota: c.nota || null,
            factura: c.factura ? c.factura.nro : null, comprobante: c.comprobante ? c.comprobante.url : null, pagado_con: c.pagado_con ? c.pagado_con.medio : null })),
        historial,
    };
}

// ------------------------------------------------------------------ entrada
async function atender(almacen, cuerpo, quien) {
    const b = cuerpo && typeof cuerpo === "object" && !Array.isArray(cuerpo) ? cuerpo : {};
    try {
        switch (b.accion) {
            case "registrar": return { status: 200, cuerpo: await registrar(almacen, b, quien) };
            case "anular": return { status: 200, cuerpo: await anular(almacen, b, quien) };
            case "balance_mensual": return { status: 200, cuerpo: await balanceMensual(almacen, b) };
            case "funcionamiento": return { status: 200, cuerpo: await funcionamiento(almacen, b) };
            // balance_proyecto pasó a functions/proyectos/finanzas.js (fórmula única, Sesión 9 Lote 2)
            default: throw new ErrorPedido("Acción desconocida.");
        }
    } catch (e) {
        if (e instanceof ErrorPedido) return { status: e.status, cuerpo: { error: e.message } };
        console.error("[comprasApi]", b.accion, e);
        return { status: 500, cuerpo: { error: "Error interno." } };
    }
}

module.exports = { CATEGORIAS, funcionamiento, atender, RUTAS, ARCHIVOS, claveProveedor, buscarProveedor, ErrorPedido };
