// Deploy forzado: 2026-05-26
/**
 * Cloud Functions — Rubik OS
 * VERSION TAG: rubik-2026-05-26-v1
 *
 * Migrado a firebase-functions v2 (Gen 2 / Cloud Run).
 * El frontend llama a las funciones a través de Firebase Hosting rewrites:
 *   /api/gemini    -> geminiProxy
 *   /api/ingesta   -> procesarIngestaIA
 *   /api/whatsapp  -> whatsappWebhook
 *   /api/imagen    -> proxyImagen
 */

const { onRequest } = require("firebase-functions/v2/https");
const { onValueCreated } = require("firebase-functions/v2/database");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();

// Secrets gestionados por Firebase Secret Manager
const GEMINI_API_KEY        = defineSecret("GEMINI_API_KEY");
const WHATSAPP_TOKEN        = defineSecret("WHATSAPP_TOKEN");
const WHATSAPP_VERIFY_TOKEN = defineSecret("WHATSAPP_VERIFY_TOKEN");

const ALLOWED_ORIGINS = new Set([
    "https://rubikbolivia.com",
    "https://www.rubikbolivia.com",
    "https://rubik-bolivia.web.app",
    "https://rubik-bolivia.firebaseapp.com",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
]);

function applyCors(req, res) {
    const origin = req.headers.origin || "";
    if (ALLOWED_ORIGINS.has(origin)) {
        res.set("Access-Control-Allow-Origin", origin);
        res.set("Vary", "Origin");
    }
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Max-Age", "3600");
}

async function requireAuth(req, res) {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
        res.status(401).json({ error: "Falta header Authorization: Bearer <id_token>" });
        return null;
    }
    const idToken = header.substring("Bearer ".length).trim();
    try {
        return await admin.auth().verifyIdToken(idToken);
    } catch (e) {
        console.warn("Token rechazado:", e.message);
        res.status(401).json({ error: "ID token inválido o expirado" });
        return null;
    }
}

const HTTP_OPTS = {
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: 540,
    memory: "2GiB",
    cpu: 1,
    concurrency: 1,
    region: "us-central1",
    invoker: "public",
    cors: false,
};

// geminiProxy con minInstances:1 para evitar cold starts en el cotizador del cliente
const GEMINI_PROXY_OPTS = {
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: 540,
    memory: "2GiB",
    cpu: 1,
    concurrency: 4,
    minInstances: 1,
    region: "us-central1",
    invoker: "public",
    cors: false,
};

// ============================================================================
// PROXY GENÉRICO — reemplaza las llamadas directas a Gemini desde el frontend
// ============================================================================
exports.geminiProxy = onRequest(GEMINI_PROXY_OPTS, async (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método no permitido" });
    }

    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    try {
        const { GoogleGenerativeAI } = require("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());

        const body = req.body || {};
        const requestedModel = body.model || "gemini-2.5-flash";
        const generationConfig = body.generationConfig;
        // systemInstruction enviado por el frontend (presupuesto, cotizador, etc.)
        const systemInstruction = body.systemInstruction || null;

        async function llamarModelo(modelName) {
            const modelOpts = {
                model: modelName,
                ...(generationConfig ? { generationConfig } : {}),
                ...(systemInstruction ? { systemInstruction } : {}),
            };
            const model = genAI.getGenerativeModel(modelOpts);
            let result;
            if (body.contents) {
                // Formato nativo Gemini SDK — { systemInstruction ya en modelOpts, contents aquí }
                result = await model.generateContent({ contents: body.contents });
            } else if (Array.isArray(body.parts)) {
                result = await model.generateContent(body.parts);
            } else if (typeof body.prompt === "string" || typeof body.text === "string") {
                // Formato simplificado del frontend: { prompt, model, image? }
                const promptText = body.prompt || body.text;
                const parts = [{ text: promptText }];
                // Soporte de imagen inline: { data: base64, mimeType: "image/jpeg" }
                if (body.image && body.image.data && body.image.mimeType) {
                    parts.unshift({ inlineData: { data: body.image.data, mimeType: body.image.mimeType } });
                }
                result = await model.generateContent(parts);
            } else {
                throw new Error("El body debe contener 'contents', 'parts', 'prompt' o 'text'");
            }
            return result;
        }

        // Cadena de fallback: 2.5-flash → 2.0-flash → 1.5-flash
        const FALLBACK_CHAIN = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
        let result;
        let lastErr;
        const modelsToTry = requestedModel === "gemini-2.5-flash"
            ? FALLBACK_CHAIN
            : [requestedModel, "gemini-2.0-flash", "gemini-1.5-flash"];

        for (const modelName of modelsToTry) {
            try {
                result = await llamarModelo(modelName);
                if (modelName !== requestedModel) {
                    console.warn(`geminiProxy: fallback usado — ${requestedModel} → ${modelName}`);
                }
                break;
            } catch (err) {
                lastErr = err;
                const msg = err.message || String(err);
                const isRetriable = msg.includes("503") || msg.includes("unavailable") ||
                    msg.includes("high demand") || msg.includes("Service Unavailable") ||
                    msg.includes("500") || msg.includes("Internal") || msg.includes("overloaded");
                if (!isRetriable) throw err; // error definitivo, no reintentar
                console.warn(`geminiProxy: ${modelName} falló (${msg.slice(0,80)}), probando siguiente…`);
            }
        }
        if (!result) throw lastErr || new Error("Todos los modelos fallaron");

        let text = "";
        try { text = result.response.text() || ""; } catch (_) { text = ""; }

        // ── Generación de imagen (Imagen 3) ──────────────────────────
        if (body.generateImage) {
            const imgModel = genAI.getGenerativeModel({ model: "imagen-3.0-generate-001" });
            try {
                const imgResult = await imgModel.generateImages({
                    prompt: body.prompt || body.text || "",
                    number_of_images: 1,
                    aspect_ratio: "16:9",
                });
                const b64 = imgResult.images[0].imageBytes;
                const imageUrl = `data:image/png;base64,${b64}`;
                return res.status(200).json({ imageUrl });
            } catch(imgErr) {
                console.error("imagen-3 error:", imgErr.message);
                return res.status(500).json({ error: "No se pudo generar imagen", detalle: imgErr.message });
            }
        }

        return res.status(200).json({
            text,
            candidates: result.response.candidates,
            promptFeedback: result.response.promptFeedback,
        });
    } catch (error) {
        console.error("geminiProxy error:", error);
        return res.status(500).json({
            error: "Error interno del servidor",
            detalle: error.message || String(error),
        });
    }
});

// ============================================================================
// Motor de Ingesta Inteligente Multimodal
// ============================================================================
exports.procesarIngestaIA = onRequest(HTTP_OPTS, async (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método no permitido" });
    }

    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    try {
        const { GoogleGenerativeAI } = require("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const { textPrompt, imagesBase64, pdfBase64, tipoIngesta } = req.body || {};

        const systemPrompt = `
Eres el "Cerebro Central" de Ingesta de Datos de Rubik OS.
Tu tarea es analizar archivos (imágenes, PDFs), enlaces web y consultas para extraer información técnica y estructurar su guardado, O BIEN responder consultas sobre costos para el mercado boliviano.

REGLAS CRÍTICAS DE SALIDA JSON:
Debes responder SIEMPRE con un objeto JSON válido. Nunca texto plano.

ESCENARIO A (El usuario pide registrar/crear algo):
Usa este formato según la categoría:
- Para 'materiales': { "categoria": "materiales", "datos": [ { "n": "Nombre Material", "u": "unidad", "p": precio_estimado } ] }
- Para 'mano_obra': { "categoria": "mano_obra", "datos": [ { "n": "Cargo/Rol", "u": "jornal o hr", "p": precio_estimado } ] }
- Para 'items' (APU): { "categoria": "items", "datos": [ { "desc": "Nombre", "und": "pza", "feat": "Características", "apu": { "mat": [{"d": "Mat","u": "und","q": 1,"p": 100}], "mo": [], "eq": [], "sub": [], "util": 50, "ind": 10 } } ] }

ESCENARIO B (El usuario hace una pregunta):
Si la consulta no es una orden de registro, responde amablemente en un campo "mensaje".
Formato: { "mensaje": "Tu respuesta conversacional aquí." }

Usuario solicita ingesta/consulta en categoría: ${tipoIngesta}
Consulta/Links: ${textPrompt || "No proporcionado."}
`;

        const parts = [{ text: systemPrompt }];

        if (Array.isArray(imagesBase64) && imagesBase64.length > 0) {
            imagesBase64.forEach((img) => {
                if (typeof img === "string" && img.includes(",")) {
                    const base64Data = img.split(",")[1];
                    const mimeTypeMatch = img.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/);
                    const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/jpeg";
                    parts.push({ inlineData: { data: base64Data, mimeType } });
                }
            });
        }

        if (pdfBase64 && typeof pdfBase64 === "string" && pdfBase64.includes(",")) {
            const base64Data = pdfBase64.split(",")[1];
            parts.push({ inlineData: { data: base64Data, mimeType: "application/pdf" } });
        }

        const result = await model.generateContent({
            contents: [{ role: "user", parts }],
        });

        const rawText = result.response.text();
        let parsedResponse;
        try {
            const cleanText = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
            parsedResponse = JSON.parse(cleanText);
        } catch (e) {
            parsedResponse = { mensaje: rawText.trim() };
        }

        return res.status(200).json(parsedResponse);
    } catch (error) {
        console.error("procesarIngestaIA error:", error);
        return res.status(500).json({
            error: "Error interno del servidor",
            detalle: error.message || String(error),
        });
    }
});

// ============================================================================
// WHATSAPP AI AGENT — Webhook de Meta  v2 (sistema de roles)
// ============================================================================
//
// ROLES:
//   ADMIN      — número 76868833 / 59176868833 (Renzo, acceso total)
//   SUPERVISOR — personal con tipo:"supervisor" en /personal
//   TRABAJADOR — personal con telefono en /personal (sin tipo supervisor)
//   CLIENTE    — clientes con wsp/whatsapp en /clientes
//   DESCONOCIDO— número no registrado
//
// Estructura Firebase Realtime DB:
//   /whatsapp_historial/{phone}/mensajes/{pushId} -> { role, text, ts }
//   /whatsapp_historial/{phone}/meta -> { nombre, rol, ultimaInteraccion }
//

// ── Helpers ────────────────────────────────────────────────────────────────

/** Normaliza teléfono: quita prefijo 591, deja solo dígitos locales bolivianos */
function normalizarTel(tel) {
    if (!tel) return "";
    const s = String(tel).replace(/\D/g, "");
    if (s.startsWith("591") && s.length > 8) return s.slice(3);
    return s;
}

/** Envía un mensaje de texto por WhatsApp API de Meta */
async function enviarWA(phoneNumberId, to, texto, waToken) {
    const https = require("https");
    const waUrl = "https://graph.facebook.com/v20.0/" + phoneNumberId + "/messages";
    const payload = JSON.stringify({
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: texto },
    });
    return new Promise(function(resolve, reject) {
        const req = https.request(waUrl, {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + waToken,
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
            },
        }, function(r) {
            let data = "";
            r.on("data", function(c) { data += c; });
            r.on("end", function() {
                console.log("WA API (" + r.statusCode + "): " + data.slice(0, 120));
                resolve();
            });
        });
        req.on("error", reject);
        req.write(payload);
        req.end();
    });
}

/** Lee los últimos N mensajes del historial de un número */
async function leerHistorial(db, phone, n) {
    try {
        const snap = await db.ref("/whatsapp_historial/" + phone + "/mensajes")
            .orderByChild("ts").limitToLast(n).get();
        if (!snap.exists()) return "";
        const lineas = [];
        snap.forEach(function(h) {
            const d = h.val();
            lineas.push((d.role === "user" ? "Usuario" : "RUBIK") + ": " + d.text);
        });
        return lineas.length ? "\n\nCONVERSACION PREVIA:\n" + lineas.join("\n") : "";
    } catch (e) {
        return "";
    }
}

/** Guarda mensaje en historial y actualiza meta */
async function guardarHistorial(db, phone, textUser, textBot, nombre, rol) {
    const ref = db.ref("/whatsapp_historial/" + phone + "/mensajes");
    const ts = Date.now();
    await ref.push({ role: "user",  text: textUser, ts });
    await ref.push({ role: "model", text: textBot,  ts: ts + 1 });
    await db.ref("/whatsapp_historial/" + phone + "/meta").update({
        nombre, rol,
        ultimoMensaje: textUser,
        ultimaRespuesta: textBot,
        ultimaInteraccion: ts,
    });
}

/** Identifica rol del número emisor consultando Firebase */
async function identificarRol(db, phone) {
    const phoneNorm = normalizarTel(phone);

    // ADMIN — número del dueño
    const ADMIN_PHONES = ["76868833", "59176868833"];
    if (ADMIN_PHONES.includes(phone) || ADMIN_PHONES.includes(phoneNorm)) {
        return { rol: "ADMIN", nombre: "Renzo", id: "RENZO_INTERNO", data: {} };
    }

    // TRABAJADOR / SUPERVISOR — buscar en /personal
    try {
        const persSnap = await db.ref("/personal").get();
        if (persSnap.exists()) {
            let encontrado = null;
            persSnap.forEach(function(child) {
                const p = child.val();
                if (!p || encontrado) return;
                const tel = normalizarTel(p.telefono || p.phone || p.whatsapp || "");
                if (tel === phoneNorm || tel === phone) {
                    encontrado = { key: child.key, data: p };
                }
            });
            if (encontrado) {
                const d = encontrado.data;
                const esSupervisor = d.tipo === "supervisor" || d.rol === "supervisor";
                return {
                    rol: esSupervisor ? "SUPERVISOR" : "TRABAJADOR",
                    nombre: d.nombre || encontrado.key,
                    id: encontrado.key,
                    data: d,
                };
            }
        }
    } catch (e) {
        console.warn("Error buscando personal:", e.message);
    }

    // CLIENTE — buscar en /clientes por wsp o whatsapp
    try {
        const cliSnap = await db.ref("/clientes").get();
        if (cliSnap.exists()) {
            let encontrado = null;
            cliSnap.forEach(function(child) {
                const c = child.val();
                if (!c || encontrado) return;
                const tel1 = normalizarTel(c.wsp || "");
                const tel2 = normalizarTel(c.whatsapp || "");
                if ([tel1, tel2].includes(phoneNorm) || [tel1, tel2].includes(phone)) {
                    encontrado = { key: child.key, data: c };
                }
            });
            if (encontrado) {
                return {
                    rol: "CLIENTE",
                    nombre: encontrado.data.nombre || encontrado.key,
                    id: encontrado.key,
                    data: encontrado.data,
                };
            }
        }
    } catch (e) {
        console.warn("Error buscando cliente:", e.message);
    }

    return { rol: "DESCONOCIDO", nombre: "Desconocido", id: null, data: {} };
}

/** Construye contexto de proyectos según el rol */
async function contextoProyectos(db, rol, id) {
    try {
        const proySnap = await db.ref("/proyectos").get();
        if (!proySnap.exists()) return "";
        const lineas = [];

        proySnap.forEach(function(cliNode) {
            const cid = cliNode.key;
            // Para CLIENTE solo sus proyectos; para ADMIN/SUPERVISOR todos
            if (rol === "CLIENTE" && cid !== id) return;

            cliNode.forEach(function(proyNode) {
                const p = proyNode.val();
                if (!p || p.archivado) return;

                // Para TRABAJADOR solo proyectos donde aparece asignado
                if (rol === "TRABAJADOR") {
                    let asignado = false;
                    if (p.gantt && p.gantt.items) {
                        const items = Array.isArray(p.gantt.items) ? p.gantt.items : Object.values(p.gantt.items);
                        items.forEach(function(it) {
                            if (!it || !it.subtasks) return;
                            const subs = Array.isArray(it.subtasks) ? it.subtasks : Object.values(it.subtasks);
                            subs.forEach(function(s) {
                                if (s && s.worker && s.worker.toUpperCase().includes(id.toUpperCase().replace(/_/g, " "))) asignado = true;
                            });
                        });
                    }
                    if (!asignado) return;
                }

                const nombre = p.nombre || proyNode.key;
                const estado = p.estado || "sin estado";
                const total  = p.presupuesto_total || (p.presupuesto && p.presupuesto.total) || 0;

                // Tareas del gantt
                let tareasStr = "";
                if (p.gantt && p.gantt.items) {
                    const items = Array.isArray(p.gantt.items) ? p.gantt.items : Object.values(p.gantt.items);
                    const tareas = [];
                    items.forEach(function(it) {
                        if (!it || !it.subtasks) return;
                        const subs = Array.isArray(it.subtasks) ? it.subtasks : Object.values(it.subtasks);
                        subs.forEach(function(s) {
                            if (!s) return;
                            tareas.push("  • " + (s.name || "tarea") + " [" + (s.progress || 0) + "%] worker:" + (s.worker || "libre"));
                        });
                    });
                    if (tareas.length) tareasStr = "\n  Tareas:\n" + tareas.slice(0, 8).join("\n");
                }

                // Presupuesto: solo para ADMIN, ocultar para otros
                let presStr = "";
                if (rol === "ADMIN") {
                    presStr = " | Total: " + total + " Bs";
                    if (p.gasto_total) presStr += " | Gasto: " + p.gasto_total + " Bs";
                } else if (rol === "CLIENTE") {
                    // Cliente ve su total sin margen interno
                    presStr = " | Presupuesto aprobado: " + total + " Bs";
                }

                lineas.push("Proyecto: \"" + nombre + "\" (cid:" + cid + "/pid:" + proyNode.key + ") | Estado: " + estado + presStr + tareasStr);
            });
        });

        return lineas.length ? "\n\nPROYECTOS:\n" + lineas.join("\n\n") : "";
    } catch (e) {
        console.warn("Error leyendo proyectos:", e.message);
        return "";
    }
}

/** Construye contexto de precios y proveedores (solo ADMIN) */
async function contextoPrecios(db) {
    try {
        const [matsSnap, provSnap] = await Promise.all([
            db.ref("/base_datos/materiales").limitToFirst(30).get(),
            db.ref("/base_datos/proveedores").limitToFirst(15).get(),
        ]);
        let ctx = "";
        if (matsSnap.exists()) {
            const mats = [];
            matsSnap.forEach(function(m) {
                const d = m.val();
                if (d && d.nombre) mats.push(d.nombre + ": " + (d.precio || "?") + " " + (d.unidad || "und"));
            });
            if (mats.length) ctx += "\n\nMATERIALES BD:\n" + mats.join("\n");
        }
        if (provSnap.exists()) {
            const provs = [];
            provSnap.forEach(function(p) {
                const d = p.val();
                if (!d) return;
                const nombre = d.nombre || p.key;
                const contacto = d.contacto || "";
                const mats = d.materiales ? Object.keys(d.materiales).slice(0, 3).join(", ") : "";
                provs.push(nombre + (contacto ? " (tel:" + contacto + ")" : "") + (mats ? " — " + mats : ""));
            });
            if (provs.length) ctx += "\n\nPROVEEDORES:\n" + provs.join("\n");
        }
        return ctx;
    } catch (e) {
        return "";
    }
}

/** Construye el system prompt según el rol */
function buildPrompt(rol, nombre, contexto, historial, mensaje) {
    const base =
        "Sos el asistente de WhatsApp de RUBIK Bolivia — empresa de señaletica, publicidad y rotulacion.\n" +
        "Tu nombre es Rubik Asistente. Respondés en español latinoamericano, de forma amable, profesional y concisa (maximo 3 parrafos cortos).\n" +
        "Nunca uses markdown, asteriscos ni JSON en tu respuesta — solo texto plano.\n\n";

    let instrucciones = "";

    if (rol === "ADMIN") {
        instrucciones =
            "ROL: ADMIN (Renzo, dueño de RUBIK Bolivia). Tenes acceso total al sistema.\n" +
            "Podes consultar proyectos, precios, proveedores, finanzas, inventario y personal.\n" +
            "Si pide una cotizacion, construila con los materiales de la BD.\n" +
            "Si pide una cotizacion, construila con los materiales de la BD.\n" +
            "Si piden reportes financieros, resume los datos disponibles.\n" +
            "Nunca reveles margenes de ganancia ni precios internos a nadie que no sea ADMIN.\n";
    } else if (rol === "SUPERVISOR") {
        instrucciones =
            "ROL: SUPERVISOR de obra. Podes consultar estado de proyectos y tareas asignadas.\n" +
            "NO tenes acceso a datos financieros, margenes ni precios de costo.\n";
    } else if (rol === "TRABAJADOR") {
        instrucciones =
            "ROL: TRABAJADOR. Solo podes consultar tus tareas y el estado de los proyectos en los que participas.\n" +
            "No tenes acceso a datos de otros trabajadores ni informacion financiera.\n";
    } else if (rol === "CLIENTE") {
        instrucciones =
            "ROL: CLIENTE. Solo podes consultar el estado de avance de TUS proyectos.\n" +
            "No tenes acceso a proyectos de otros clientes ni a informacion interna.\n";
    } else {
        instrucciones =
            "ROL: Visitante no registrado. Podes dar informacion general sobre RUBIK Bolivia (servicios, contacto).\n" +
            "Para mas informacion invita al usuario a contactarse por los canales oficiales.\n";
    }

    const historialTxt = historial.length
        ? "\n\nHISTORIAL RECIENTE:\n" + historial.map(function(h) {
            return (h.role === "user" ? "Usuario" : "Asistente") + ": " + h.content;
          }).join("\n")
        : "";

    return base + instrucciones + (contexto ? "\n\nDATOS DEL SISTEMA:" + contexto : "") + historialTxt + "\n\nMensaje actual del usuario: " + mensaje;
}

// ─────────────────────────────────────────────────────────
// WHATSAPP WEBHOOK
// ─────────────────────────────────────────────────────────

const WA_OPTS = {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60,
    secrets: [WHATSAPP_TOKEN, WHATSAPP_VERIFY_TOKEN, GEMINI_API_KEY],
    invoker: "public",
};

exports.whatsappWebhook = onRequest(WA_OPTS, async (req, res) => {
    // ── GET: verificación del webhook ──
    if (req.method === "GET") {
        const verifyToken = (WHATSAPP_VERIFY_TOKEN.value && WHATSAPP_VERIFY_TOKEN.value()) || "rubik-webhook-2026";
        const mode      = req.query["hub.mode"];
        const token     = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];
        if (mode === "subscribe" && token === verifyToken) {
            console.log("Webhook verificado OK");
            return res.status(200).send(challenge);
        }
        return res.status(403).send("Token inválido");
    }

    // ── POST: mensajes entrantes ──
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    try {
        const body = req.body;
        const entry    = body?.entry?.[0];
        const changes  = entry?.changes?.[0];
        const value    = changes?.value;
        const messages = value?.messages;
        if (!messages || !messages.length) return res.status(200).send("OK");

        const msg         = messages[0];
        const from        = msg.from;                          // número del usuario
        const phoneNumberId = value?.metadata?.phone_number_id;
        const waToken     = WHATSAPP_TOKEN.value();
        const geminiKey   = GEMINI_API_KEY.value();

        // Solo texto e imágenes por ahora
        const msgType = msg.type;
        let textoUsuario = "";
        let imagenB64 = null;
        let imagenMime = "image/jpeg";

        if (msgType === "text") {
            textoUsuario = msg.text?.body || "";
        } else if (msgType === "image") {
            const mediaId = msg.image?.id;
            textoUsuario  = msg.image?.caption || "Analiza esta imagen";
            // Descargar imagen de WhatsApp
            try {
                const mediaRes = await fetch(
                    "https://graph.facebook.com/v20.0/" + mediaId,
                    { headers: { Authorization: "Bearer " + waToken } }
                );
                const mediaData = await mediaRes.json();
                const imgRes = await fetch(mediaData.url, {
                    headers: { Authorization: "Bearer " + waToken }
                });
                const arrayBuf = await imgRes.arrayBuffer();
                imagenB64  = Buffer.from(arrayBuf).toString("base64");
                imagenMime = msg.image?.mime_type || "image/jpeg";
            } catch(e) {
                console.error("Error descargando imagen WA:", e.message);
                textoUsuario = "No se pudo procesar la imagen. " + textoUsuario;
            }
        } else {
            return res.status(200).send("OK"); // tipo no soportado
        }

        if (!textoUsuario.trim()) return res.status(200).send("OK");

        const db   = admin.database();
        const rol  = await identificarRol(from);
        const nombre = rol === "ADMIN" ? "Renzo" : from;

        // Contexto de proyectos y precios según rol
        let contexto = await contextoProyectos(db, rol, from);
        if (rol === "ADMIN") contexto += await contextoPrecios(db);

        // Historial de conversación
        const historial = await leerHistorial(db, from);

        // Construir prompt
        const systemPrompt = buildPrompt(rol, nombre, contexto, historial, textoUsuario);

        // Llamar Gemini
        const parts = [];
        if (imagenB64) {
            parts.push({ inlineData: { mimeType: imagenMime, data: imagenB64 } });
        }
        parts.push({ text: textoUsuario });

        const geminiRes = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + geminiKey,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ role: "user", parts }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
                })
            }
        );
        const geminiData = await geminiRes.json();
        const respuesta  = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text
            || "No pude procesar tu consulta en este momento.";

        // Guardar en historial
        await guardarHistorial(db, from, textoUsuario, respuesta);

        // Enviar respuesta por WhatsApp
        await enviarWA(phoneNumberId, from, respuesta, waToken);

        return res.status(200).send("OK");
    } catch (e) {
        console.error("Error en whatsappWebhook:", e);
        return res.status(200).send("OK"); // siempre 200 para Meta
    }
});

// ─────────────────────────────────────────────────────────
// PROXY IMÁGENES (Firebase Storage → PDF sin CORS)
// ─────────────────────────────────────────────────────────
exports.proxyImagen = onRequest(
    { region: "us-central1", memory: "256MiB", timeoutSeconds: 30, invoker: "public" },
    async (req, res) => {
        const url = req.query.url;
        if (!url) return res.status(400).send("Falta parámetro url");
        try {
            const response = await fetch(url);
            if (!response.ok) return res.status(response.status).send("Error al obtener imagen");
            const contentType = response.headers.get("content-type") || "image/jpeg";
            const buffer = Buffer.from(await response.arrayBuffer());
            res.set("Access-Control-Allow-Origin", "*");
            res.set("Cache-Control", "public, max-age=3600");
            res.set("Content-Type", contentType);
            res.send(buffer);
        } catch(e) {
            res.status(500).send("Error: " + e.message);
        }
    }
);
