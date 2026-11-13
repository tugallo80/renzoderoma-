/**
 * Cliente de Gemini (Nano Banana) para los renders de los Requerimientos (sesión 6, entrega 5;
 * docs/sesiones/06-render-requerimiento.md). Lo usa SOLO la Function renderTurno (functions/render/index.js), que tiene
 * el secreto; el conector (rubikMcp) no tiene secretos.
 *
 * - El modelo está FIJO acá (no se elige de una lista): normal = Nano Banana 2.1, alta = Nano Banana Pro.
 * - Antes de generar se revisa con ListModels (gratis, con caché) que la clave tenga el modelo. Si no lo tiene, error claro:
 *   nunca se usa otro modelo en silencio. La lista se loguea una vez.
 * - Gemini devuelve PNG (la API no deja pedir JPEG): se pasa a JPEG con sharp; una copia chica es la que ve Claude.
 * - El cliente HTTP se inyecta (configurar): las pruebas usan uno simulado y no gastan plata.
 */
const crypto = require("crypto");

const MODELOS = {
    normal: { id: "gemini-nano-banana-2.1", nombre: "Nano Banana 2.1", usd: { "1K": 0.034, "2K": 0.05 } },
    alta: { id: "gemini-3-pro-image", nombre: "Nano Banana Pro", usd: { "1K": 0.134, "2K": 0.134 } },
};
const ASPECTOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const CACHE_MODELOS_MS = 6 * 3600 * 1000;
const BASE = "https://generativelanguage.googleapis.com/v1beta";

let cfg = { clave: () => null, fetch: (...a) => fetch(...a), ahora: () => Date.now(), log: (...a) => console.log(...a) };
let cache = null;   // { hasta, nombres:Set }
let logueado = false;

function configurar(c) { cfg = Object.assign({}, cfg, c); cache = null; }

class ErrorRender extends Error {}

async function modelosDisponibles() {
    if (cache && cache.hasta > cfg.ahora()) return cache.nombres;
    const clave = cfg.clave();
    if (!clave) throw new ErrorRender("falta la clave de Gemini en el servidor");
    const nombres = new Set();
    let token = "";
    for (let i = 0; i < 10; i++) {
        const r = await cfg.fetch(`${BASE}/models?pageSize=200${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`, { headers: { "x-goog-api-key": clave } });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new ErrorRender(`Gemini no respondió la lista de modelos (${r.status}${d && d.error && d.error.message ? `: ${String(d.error.message).slice(0, 160)}` : ""})`);
        (d.models || []).forEach((m) => nombres.add(String(m.name || "").replace(/^models\//, "")));
        if (!d.nextPageToken) break;
        token = d.nextPageToken;
    }
    if (!logueado) {
        logueado = true;
        cfg.log("[render] modelos de imagen con esta clave:", [...nombres].filter((n) => /image|banana/i.test(n)).join(" | ") || "(ninguno)");
    }
    cache = { hasta: cfg.ahora() + CACHE_MODELOS_MS, nombres };
    return nombres;
}

/** Aspecto soportado más cercano a ancho/alto. */
function aspectoDe(ancho, alto) {
    if (!(ancho > 0 && alto > 0)) return "4:3";
    const r = ancho / alto;
    let mejor = "4:3", dif = Infinity;
    ASPECTOS.forEach((a) => { const [x, y] = a.split(":").map(Number); const d = Math.abs(Math.log(r / (x / y))); if (d < dif) { dif = d; mejor = a; } });
    return mejor;
}

/**
 * Llama a Gemini. referencias: [{buf, mime}]. Devuelve { png: Buffer, mime, texto, modelo, uso }.
 */
async function generar({ calidad, prompt, referencias, aspecto, tamano }) {
    const m = MODELOS[calidad] || MODELOS.normal;
    const disponibles = await modelosDisponibles();
    if (!disponibles.has(m.id)) {
        throw new ErrorRender(`la clave de Gemini no tiene acceso al modelo ${m.id} (${m.nombre}). Habilitalo en Google AI Studio (o revisá la facturación); no se usa otro modelo en su lugar.`);
    }
    const parts = (referencias || []).map((r) => ({ inlineData: { mimeType: r.mime, data: Buffer.from(r.buf).toString("base64") } }));
    parts.push({ text: prompt });
    const cuerpo = {
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: aspecto, imageSize: tamano } },
    };
    const r = await cfg.fetch(`${BASE}/models/${m.id}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.clave() }, body: JSON.stringify(cuerpo),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
        const msg = d && d.error && d.error.message ? String(d.error.message).slice(0, 300) : "";
        if (r.status === 429) throw new ErrorRender(`Gemini rechazó por cuota o créditos (429). ${msg}`);
        throw new ErrorRender(`Gemini respondió ${r.status}. ${msg}`);
    }
    const cand = (d.candidates || [])[0] || {};
    // las partes con thought:true son borradores intermedios: vale la última imagen final
    const imgs = ((cand.content && cand.content.parts) || []).filter((p) => (p.inlineData || p.inline_data) && !p.thought);
    const texto = ((cand.content && cand.content.parts) || []).filter((p) => p.text && !p.thought).map((p) => p.text).join(" ").trim();
    if (!imgs.length) {
        const motivo = cand.finishReason || (d.promptFeedback && d.promptFeedback.blockReason) || "sin imagen";
        throw new ErrorRender(`Gemini no devolvió imagen (${motivo})${texto ? `: ${texto.slice(0, 300)}` : ""}`);
    }
    const ultima = imgs[imgs.length - 1].inlineData || imgs[imgs.length - 1].inline_data;
    return { png: Buffer.from(ultima.data, "base64"), mime: ultima.mimeType || ultima.mime_type || "image/png", texto, modelo: m.id, uso: d.usageMetadata || null };
}

/** JPEG grande (para el ítem y el PDF) y copia chica para Claude (≤ ~100 KB). */
async function prepararSalidas(buf) {
    const sharp = require("sharp");
    const meta = await sharp(buf).metadata();
    const grande = await sharp(buf).flatten({ background: "#ffffff" }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    let chica = null;
    for (const [lado, q] of [[1024, 78], [1024, 65], [860, 62], [720, 55]]) {
        chica = await sharp(buf).flatten({ background: "#ffffff" }).resize({ width: lado, height: lado, fit: "inside", withoutEnlargement: true }).jpeg({ quality: q, mozjpeg: true }).toBuffer();
        if (chica.length <= 100 * 1024) break;
    }
    const mini = await sharp(buf).flatten({ background: "#ffffff" }).resize({ width: 240, height: 240, fit: "inside" }).jpeg({ quality: 60 }).toBuffer();
    return { grande, chica, miniatura: `data:image/jpeg;base64,${mini.toString("base64")}`, ancho: meta.width, alto: meta.height };
}

const nuevoToken = () => crypto.randomUUID();

module.exports = { MODELOS, ASPECTOS, configurar, generar, modelosDisponibles, aspectoDe, prepararSalidas, nuevoToken, ErrorRender };
