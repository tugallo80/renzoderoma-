/**
 * Documentos en PDF generados en el SERVIDOR (para Kay por WhatsApp): el mismo dibujo que la pantalla.
 *
 *   licitacion {cid, pid, id, modo?: general|detalle} → functions/pdf/compartido/pdf-licitacion.js (copia idéntica de
 *              public/js/pdf-licitacion.js, el que usa licitaciones.html)
 *   cotizacion {cid, pid, modo?: normal|impuestos_por_item} → pdf-cotizacion.js (presupuesto.html)
 *   orden      {cid, pid, modo?: produccion|impresion|impresion_con_imagen|completa} → pdf-produccion.js (produccion.html)
 *   liquidacion {cid, pid, id} → pdf-liquidacion.js (compras.html del proyecto): contrato, anticipos/pagos, saldo y comprobantes
 *   contratista {worker_id | nombre, proyectos?: [{cid, pid}]} → pdf-contratista.js (Tesorería → Contratistas): todos sus contratos,
 *              con extras, pagos, comprobantes y la rendición de cada proyecto → total a pagar
 *   rendicion  {worker_id | telefono, desde?, hasta?, cid?, pid?} → pdf-rendicion.js (Tesorería → Rendiciones): caja chica, gastos, saldo y recibos
 * Los tres módulos son copias idénticas de public/js/ (functions/pdf/compartido/).
 *
 * Devuelve {nombre, mime, base64, bytes, paginas, ruta}: el PDF también queda guardado en Storage
 * (documentos/{cid}/{pid}/{nombre}, solo para la app; sin enlace público).
 * Imágenes: solo de nuestro Storage (o data:), con tope de tamaño y pasadas a JPEG de ≤1600 px (WhatsApp acepta hasta ~100 MB,
 * pero el PDF queda liviano).
 */
const fs = require("fs");
const path = require("path");
const C = require("../operaciones/comun");

const MAX_PDF = 10 * 1024 * 1024;
const MAX_IMG = 12 * 1024 * 1024;
const IMG_OK = /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//;

const RUTAS = [/^proyectos\/[^/]+\/[^/]+\/(nombre|licitaciones\/[^/]+|presupuesto|presupuesto\/items|monto_cierre|artes_data)$/, /^clientes\/[^/]+\/nombre$/,
    /^caja_chica\/[^/]+$/, /^personal$/, /^personal\/[^/]+\/(nombre|telefono)$/,   // rendición
    /^proyectos$/];   // consolidado del contratista (todos sus contratos)
const ARCHIVOS = [/^documentos\/[^/]+\/[^/]+\/[A-Za-z0-9_.-]+\.pdf$/, /^documentos\/(rendiciones|contratistas)\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.pdf$/];

let _jsPDF = null;
function jsPDF() {
    if (!_jsPDF) {
        const { jsPDF: J } = require("jspdf");
        require("jspdf-autotable").applyPlugin(J);
        _jsPDF = J;
    }
    return _jsPDF;
}
const fechaBo = (ms) => { const [a, m, d] = C.hoyBolivia(ms).split("-"); return `${Number(d)}/${Number(m)}/${a}`; };

/** Imágenes para el PDF: data URL JPEG (o PNG si trae transparencia, salvo soloJpeg) + medidas, con caché por pedido.
 *  soloJpeg: como getBase64ImageFromUrl de presupuesto/producción (canvas → JPEG); el fondo transparente queda blanco. */
function crearCargador({ soloJpeg = false } = {}) {
    const sharp = require("sharp");
    const medidas = new Map();
    const cache = new Map();
    async function convertir(buf) {
        const img = sharp(buf, { failOn: "none" }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true });
        const meta = await sharp(buf, { failOn: "none" }).metadata();
        const png = !!meta.hasAlpha && !soloJpeg;
        const { data, info } = await (png ? img.png() : img.flatten({ background: "#ffffff" }).jpeg({ quality: 80 })).toBuffer({ resolveWithObject: true });
        const url = `data:image/${png ? "png" : "jpeg"};base64,${data.toString("base64")}`;
        medidas.set(url, { w: info.width, h: info.height });
        return url;
    }
    async function cargarImagen(url) {
        if (!url || typeof url !== "string") return null;
        if (cache.has(url)) return cache.get(url);
        const p = (async () => {
            try {
                if (url === "logo") return convertir(fs.readFileSync(path.join(__dirname, "logo.png")));
                if (url === "logo-presupuesto") return convertir(fs.readFileSync(path.join(__dirname, "logo-presupuesto.jpg")));
                if (url === "logo-liquidacion") return convertir(fs.readFileSync(path.join(__dirname, "logo-liquidacion.jpg")));
                if (url.startsWith("data:image/")) return convertir(Buffer.from(url.split(",")[1] || "", "base64"));
                if (!IMG_OK.test(url)) return null;   // solo nuestro Storage
                const r = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
                if (!r.ok) return null;
                const buf = Buffer.from(await r.arrayBuffer());
                if (!buf.length || buf.length > MAX_IMG) return null;
                return await convertir(buf);
            } catch (e) { console.warn("[documentos] imagen:", e.message); return null; }
        })();
        cache.set(url, p);
        return p;
    }
    const dimensiones = async (u) => medidas.get(u) || { w: 800, h: 600 };
    return { cargarImagen, dimensiones };
}

async function pdfLicitacion(almacen, b) {
    const cid = C.id(b.cid, "Cliente"), pid = C.id(b.pid, "Proyecto"), lid = C.id(b.id, "Licitación");
    const modo = b.modo === "detalle" ? "detalle" : "general";
    const [pName, lic, items] = await Promise.all([
        almacen.leer(`proyectos/${cid}/${pid}/nombre`), almacen.leer(`proyectos/${cid}/${pid}/licitaciones/${lid}`), almacen.leer(`proyectos/${cid}/${pid}/presupuesto/items`),
    ]);
    if (pName == null) C.falla("No existe el proyecto.", 404);
    if (!lic) C.falla("No existe la licitación.", 404);
    if (!lic.tareas) C.falla("La licitación no tiene tareas.");
    const P = require("../pdf/compartido/pdf-licitacion.js");
    const { cargarImagen, dimensiones } = crearCargador();
    const doc = await P.generar({ jsPDF: jsPDF(), lic, licKey: lid, items: items || {}, pName: String(pName), modo, fecha: fechaBo(almacen.ahora()),
        cargarImagen, dimensiones, logoUrl: "logo" });
    return { nombre: P.nombreArchivo(String(pName), lid, modo), doc };
}

/** Fecha de hoy en Bolivia como Date local (para los nombres MMDD_…) */
const hoyComoDate = (ms) => { const [a, m, d] = C.hoyBolivia(ms).split("-").map(Number); return new Date(a, m - 1, d); };

async function datosProyecto(almacen, b) {
    const cid = C.id(b.cid, "Cliente"), pid = C.id(b.pid, "Proyecto");
    const [nombre, cliente] = await Promise.all([almacen.leer(`proyectos/${cid}/${pid}/nombre`), almacen.leer(`clientes/${cid}/nombre`)]);
    if (nombre == null) C.falla("No existe el proyecto.", 404);
    return { cid, pid, proyecto: String(nombre), cliente: cliente ? String(cliente) : "CLIENTE" };
}

async function pdfCotizacion(almacen, b) {
    const p = await datosProyecto(almacen, b);
    const modo = b.modo === "impuestos_por_item" ? "impuestos_por_item" : "normal";
    const [pres, cierre] = await Promise.all([almacen.leer(`proyectos/${p.cid}/${p.pid}/presupuesto`), almacen.leer(`proyectos/${p.cid}/${p.pid}/monto_cierre`)]);
    if (!pres || !pres.items) C.falla("El proyecto no tiene presupuesto.", 404);
    const P = require("../pdf/compartido/pdf-cotizacion.js");
    const { cargarImagen } = crearCargador({ soloJpeg: true });
    const doc = await P.generar({ jsPDF: jsPDF(), modo, pres, montoCierre: parseFloat(cierre) || 0, proyecto: p.proyecto, cliente: p.cliente,
        fechaHoy: fechaBo(almacen.ahora()), logo: await cargarImagen("logo-presupuesto"), cargarImagen });
    return { nombre: P.nombreArchivo({ proyecto: p.proyecto, cliente: p.cliente, modo, fecha: hoyComoDate(almacen.ahora()) }), doc };
}

const TIPOS_ORDEN = ["produccion", "impresion", "impresion_con_imagen", "completa"];
async function pdfOrden(almacen, b) {
    const p = await datosProyecto(almacen, b);
    const modo = TIPOS_ORDEN.includes(b.modo) ? b.modo : "produccion";
    const [items, artes] = await Promise.all([almacen.leer(`proyectos/${p.cid}/${p.pid}/presupuesto/items`), almacen.leer(`proyectos/${p.cid}/${p.pid}/artes_data`)]);
    if (!items) C.falla("El proyecto no tiene presupuesto.", 404);
    const P = require("../pdf/compartido/pdf-produccion.js");
    const { cargarImagen } = crearCargador({ soloJpeg: true });
    const r = await P.generar(modo, { jsPDF: jsPDF(), items, artsData: P.armarArtes(items, artes || {}), proyecto: p.proyecto, cliente: p.cliente,
        fecha: fechaBo(almacen.ahora()), fechaCorta: fechaBo(almacen.ahora()), cargarImagen });
    return { nombre: P.nombreArchivo({ proyecto: p.proyecto, cliente: p.cliente, sufijo: r.sufijo, fecha: hoyComoDate(almacen.ahora()) }), doc: r.doc };
}

async function pdfLiquidacion(almacen, b) {
    const cid = C.id(b.cid, "Cliente"), pid = C.id(b.pid, "Proyecto"), lid = C.id(b.id, "Licitación");
    const [pName, lic, items] = await Promise.all([
        almacen.leer(`proyectos/${cid}/${pid}/nombre`), almacen.leer(`proyectos/${cid}/${pid}/licitaciones/${lid}`), almacen.leer(`proyectos/${cid}/${pid}/presupuesto/items`),
    ]);
    if (pName == null) C.falla("No existe el proyecto.", 404);
    if (!lic) C.falla("No existe la licitación.", 404);
    const P = require("../pdf/compartido/pdf-liquidacion.js");
    const { cargarImagen, dimensiones } = crearCargador({ soloJpeg: true });
    // la rendición de esta persona en este proyecto (si tiene): suma o descuenta en el total a pagar
    let rendicion = null;
    if (lic.worker_id) {
        const R = require("../rendiciones/api");
        const r = await R.atender(almacen, { accion: "estado", worker_id: lic.worker_id, cid, pid }).catch(() => null);
        if (r && r.status === 200) rendicion = r.cuerpo;
    }
    const doc = await P.generar({ jsPDF: jsPDF(), lic, budgetItems: items || [], proyecto: String(pName), fecha: fechaBo(almacen.ahora()), rendicion,
        logo: await cargarImagen("logo-liquidacion"), cargarImagen, cargarComprobante: cargarImagen, dimensiones });
    return { nombre: P.nombreArchivo(lic), doc };
}

async function pdfRendicion(almacen, b) {
    const R = require("../rendiciones/api");
    const r = await R.atender(almacen, { accion: "estado", worker_id: b.worker_id, telefono: b.telefono, desde: b.desde, hasta: b.hasta, cid: b.cid, pid: b.pid });
    if (r.status !== 200) C.falla(r.cuerpo.error, r.status);
    const P = require("../pdf/compartido/pdf-rendicion.js");
    const { cargarImagen, dimensiones } = crearCargador({ soloJpeg: true });
    const doc = await P.generar({ jsPDF: jsPDF(), estado: r.cuerpo, fecha: fechaBo(almacen.ahora()), logo: await cargarImagen("logo-liquidacion"), cargarImagen, dimensiones });
    return { nombre: P.nombreArchivo(r.cuerpo), doc, ruta: `documentos/rendiciones/${r.cuerpo.worker_id}/${P.nombreArchivo(r.cuerpo)}` };
}

async function pdfContratista(almacen, b) {
    const wid = b.worker_id ? C.id(b.worker_id, "Trabajador") : null;
    const nombreQ = String(b.nombre || "").trim().toLowerCase();
    let workerName = wid ? await almacen.leer(`personal/${wid}/nombre`) : null;
    if (!wid && !nombreQ) C.falla("Decí de quién (worker_id o nombre).");
    const filtroProy = Array.isArray(b.proyectos) && b.proyectos.length ? new Set(b.proyectos.map((p) => `${p.cid}/${p.pid}`)) : null;
    const todos = (await almacen.leer("proyectos")) || {};
    const items = [];
    Object.entries(todos).forEach(([cid, ps]) => Object.entries(ps || {}).forEach(([pid, proy]) => {
        if (!proy || typeof proy !== "object" || proy.archivado === true || !proy.licitaciones) return;
        if (filtroProy && !filtroProy.has(`${cid}/${pid}`)) return;
        Object.entries(proy.licitaciones).forEach(([licId, lic]) => {
            if (!lic || lic.is_supervision || lic.is_internal_assignment) return;
            const nom = lic.worker_name || lic.nombre_trabajador || lic.trabajador_nombre || lic.worker_id || "";
            const es = wid ? lic.worker_id === wid || (workerName && nom === workerName) : String(nom).trim().toLowerCase() === nombreQ;
            if (!es) return;
            if (!workerName) workerName = nom;
            items.push({ cid, pid, pid_nombre: proy.nombre || pid, licId, lic, budgetItems: (proy.presupuesto && proy.presupuesto.items) || {} });
        });
    }));
    if (!items.length) C.falla("No encontré contratos de esa persona.", 404);
    const R = require("../rendiciones/api");
    for (const it of items) {
        if (!it.lic.worker_id) continue;
        const r = await R.atender(almacen, { accion: "estado", worker_id: it.lic.worker_id, cid: it.cid, pid: it.pid }).catch(() => null);
        if (r && r.status === 200) it.rendicion = r.cuerpo;
    }
    const P = require("../pdf/compartido/pdf-contratista.js");
    const { cargarImagen, dimensiones } = crearCargador({ soloJpeg: true });
    const fecha = fechaBo(almacen.ahora());
    const doc = await P.generar({ jsPDF: jsPDF(), workerName: String(workerName), fecha, logo: await cargarImagen("logo-liquidacion"), items, cargarImagen, dimensiones });
    const nombre = P.nombreArchivo(String(workerName), fecha);
    return { nombre, doc, ruta: `documentos/contratistas/${String(wid || nombre).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60)}/${nombre}` };
}

const TIPOS = {
    licitacion: pdfLicitacion,
    cotizacion: pdfCotizacion,
    orden: pdfOrden,
    liquidacion: pdfLiquidacion,
    rendicion: pdfRendicion,
    contratista: pdfContratista,
};

/** {tipo, cid, pid, id, modo?} → {nombre, mime, base64, bytes, paginas, ruta}. */
async function generar(almacen, b) {
    const tipo = String((b && b.tipo) || "");
    const fn = Object.prototype.hasOwnProperty.call(TIPOS, tipo) ? TIPOS[tipo] : null;
    if (!fn) C.falla("Tipo de documento inválido (licitacion, liquidacion, contratista, rendicion, cotizacion u orden).");
    const { nombre, doc, ruta: rutaPropia } = await fn(almacen, b);
    const buf = Buffer.from(doc.output("arraybuffer"));
    if (buf.length > MAX_PDF) C.falla(`El PDF pesa ${(buf.length / 1048576).toFixed(1)} MB (máximo 10 MB). Probá el modo general.`, 413);
    const ruta = rutaPropia || `documentos/${b.cid}/${b.pid}/${nombre}`;
    await almacen.subirArchivo(ruta, buf, "application/pdf").catch((e) => console.warn("[documentos] no se guardó en Storage:", e.message));
    return { nombre, mime: "application/pdf", base64: buf.toString("base64"), bytes: buf.length, paginas: doc.getNumberOfPages(), ruta };
}

module.exports = { generar, RUTAS, ARCHIVOS, TIPOS, TIPOS_ORDEN };
