/**
 * Páginas de un PDF como imágenes (para que Claude lea planos por el conector, igual que las vistas del 3D).
 * pdfjs-dist (build "legacy" para Node) + @napi-rs/canvas (binario precompilado, anda en Functions Gen2 / Node 24).
 *
 *   renderizar(buf, op) → { total, paginas: [{ n, jpg, claude, ancho, alto, texto }] }
 *     jpg     página completa, lado mayor ~2000 px (se leen las cotas de un plano)
 *     claude  la misma página en una copia que entra en una respuesta del conector (≤ ~280 KB; si hace falta, baja la
 *             calidad y después el tamaño, nunca menos de 1400 px)
 *     texto   el texto de la página si el PDF es vectorial (vacío si es escaneado)
 */
const path = require("path");

const LADO = 2000;
const MAX_PAGINAS = 20;
const TOPE_CLAUDE = 280 * 1024;
const MAX_TEXTO = 4000;

let _pdfjs = null;
async function pdfjs() {
    if (!_pdfjs) _pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    return _pdfjs;
}
const dirPdfjs = () => path.dirname(require.resolve("pdfjs-dist/package.json"));

/** Copia para el conector: JPEG que entre en TOPE_CLAUDE (calidad 80→55, después achica de a 15 %). */
async function copiaClaude(jpg, ancho, alto) {
    if (jpg.length <= TOPE_CLAUDE) return jpg;
    const sharp = require("sharp");
    let lado = Math.max(ancho, alto), mejor = jpg;
    for (let i = 0; i < 6; i++) {
        for (const q of [80, 68, 55]) {
            const out = await sharp(jpg).resize({ width: ancho >= alto ? lado : null, height: alto > ancho ? lado : null, withoutEnlargement: true })
                .jpeg({ quality: q, mozjpeg: true }).toBuffer();
            mejor = out;
            if (out.length <= TOPE_CLAUDE) return out;
        }
        if (lado <= 1400) break;
        lado = Math.max(1400, Math.round(lado * 0.85));
    }
    return mejor;
}

async function renderizar(buf, op = {}) {
    const { getDocument } = await pdfjs();
    const { createCanvas } = require("@napi-rs/canvas");
    const dir = dirPdfjs();
    const tarea = getDocument({
        data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
        standardFontDataUrl: path.join(dir, "standard_fonts") + path.sep, cMapUrl: path.join(dir, "cmaps") + path.sep, cMapPacked: true,
        verbosity: 0,
    });
    const doc = await tarea.promise;
    const total = doc.numPages;
    const hasta = Math.min(total, op.maxPaginas || MAX_PAGINAS);
    const lado = op.lado || LADO;
    const paginas = [];
    try {
        for (let n = 1; n <= hasta; n++) {
            const pg = await doc.getPage(n);
            const v1 = pg.getViewport({ scale: 1 });
            const vp = pg.getViewport({ scale: lado / Math.max(v1.width, v1.height) });
            const cv = createCanvas(Math.max(1, Math.round(vp.width)), Math.max(1, Math.round(vp.height)));
            const ctx = cv.getContext("2d");
            ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height);   // los PDF transparentes salían negros
            await pg.render({ canvasContext: ctx, canvas: cv, viewport: vp }).promise;
            const jpg = Buffer.from(await cv.encode("jpeg", 82));
            let texto = "";
            try {
                const tc = await pg.getTextContent();
                texto = tc.items.map((it) => (it.str || "") + (it.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXTO);
            } catch (e) { texto = ""; }
            const claude = await copiaClaude(jpg, cv.width, cv.height);
            paginas.push({ n, jpg, claude, ancho: cv.width, alto: cv.height, texto });
            pg.cleanup();
        }
    } finally {
        await Promise.resolve(tarea.destroy()).catch(() => {});
    }
    return { total, paginas };
}

module.exports = { renderizar, LADO, MAX_PAGINAS, TOPE_CLAUDE };
