/**
 * Documentos en PDF generados en el SERVIDOR (para Kay por WhatsApp): el mismo dibujo que la pantalla.
 *
 *   licitacion {cid, pid, id, modo?: general|detalle} → functions/pdf/compartido/pdf-licitacion.js (copia idéntica de
 *              public/js/pdf-licitacion.js, el que usa licitaciones.html)
 *   cotizacion, orden → todavía no (siguiente etapa: presupuesto.html y órdenes).
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

const RUTAS = [/^proyectos\/[^/]+\/[^/]+\/(nombre|licitaciones\/[^/]+|presupuesto\/items)$/];
const ARCHIVOS = [/^documentos\/[^/]+\/[^/]+\/[A-Za-z0-9_.-]+\.pdf$/];

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

/** Imágenes para el PDF: data URL JPEG (o PNG si trae transparencia) + medidas, con caché por pedido. */
function crearCargador() {
    const sharp = require("sharp");
    const medidas = new Map();
    const cache = new Map();
    async function convertir(buf) {
        const img = sharp(buf, { failOn: "none" }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true });
        const meta = await sharp(buf, { failOn: "none" }).metadata();
        const png = !!meta.hasAlpha;
        const { data, info } = await (png ? img.png() : img.jpeg({ quality: 80 })).toBuffer({ resolveWithObject: true });
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

const TIPOS = {
    licitacion: pdfLicitacion,
};

/** {tipo, cid, pid, id, modo?} → {nombre, mime, base64, bytes, paginas, ruta}. */
async function generar(almacen, b) {
    const tipo = String((b && b.tipo) || "");
    if (["cotizacion", "orden"].includes(tipo)) C.falla(`El PDF de ${tipo} todavía no se genera en el servidor (por ahora: licitacion).`, 501);
    const fn = TIPOS[tipo];
    if (!fn) C.falla("Tipo de documento inválido (licitacion).");
    const { nombre, doc } = await fn(almacen, b);
    const buf = Buffer.from(doc.output("arraybuffer"));
    if (buf.length > MAX_PDF) C.falla(`El PDF pesa ${(buf.length / 1048576).toFixed(1)} MB (máximo 10 MB). Probá el modo general.`, 413);
    const ruta = `documentos/${b.cid}/${b.pid}/${nombre}`;
    await almacen.subirArchivo(ruta, buf, "application/pdf").catch((e) => console.warn("[documentos] no se guardó en Storage:", e.message));
    return { nombre, mime: "application/pdf", base64: buf.toString("base64"), bytes: buf.length, paginas: doc.getNumberOfPages(), ruta };
}

module.exports = { generar, RUTAS, ARCHIVOS, TIPOS };
