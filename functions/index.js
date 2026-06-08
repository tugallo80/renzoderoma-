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
// WHATSAPP AI AGENT — Webhook de Meta
// ============================================================================
//
// Estructura en Firebase Realtime DB:
//   /whatsapp_clientes/{phone}  -> { cid, nombre }
//   /whatsapp_historial/{phone}/mensajes/{pushId} -> { role, text, ts }
//
exports.whatsappWebhook = onRequest(
    {
        secrets: [GEMINI_API_KEY, WHATSAPP_TOKEN, WHATSAPP_VERIFY_TOKEN],
        timeoutSeconds: 60,
        memory: "512MiB",
        cpu: 1,
        minInstances: 1,
        region: "us-central1",
        invoker: "public",
        cors: false,
    },
    async (req, res) => {

        // ── GET: verificación inicial del webhook por Meta ─────────────────
        if (req.method === "GET") {
            const mode      = req.query["hub.mode"];
            const token     = req.query["hub.verify_token"];
            const challenge = req.query["hub.challenge"];
            if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN.value()) {
                console.log("Webhook verificado por Meta OK");
                return res.status(200).send(challenge);
            }
            return res.status(403).send("Token invalido");
        }

        if (req.method !== "POST") return res.status(405).send("Metodo no permitido");

        // Responder 200 de inmediato — Meta reintenta si no recibe respuesta rapida
        res.status(200).send("OK");

        try {
            const body   = req.body || {};
            const entry  = (body.entry || [])[0];
            const change = (entry && entry.changes) ? entry.changes[0] : null;
            const value  = change ? change.value : null;

            // Solo procesar mensajes entrantes de texto
            const messages = value && value.messages;
            if (!messages || !messages[0]) return;
            const msg = messages[0];
            if (msg.type !== "text") return;

            const fromPhone     = msg.from;
            const textRecibido  = msg.text.body.trim();
            const phoneNumberId = value.metadata ? value.metadata.phone_number_id : null;

            console.log("Mensaje de " + fromPhone + ": " + textRecibido);

            const db = admin.database();

            // ── 1. Identificar cliente ─────────────────────────────────────
            const clienteSnap = await db.ref("/whatsapp_clientes/" + fromPhone).get();
            const clienteData = clienteSnap.exists() ? clienteSnap.val() : null;
            const cid         = clienteData ? clienteData.cid : null;
            const nombreCliente = clienteData ? (clienteData.nombre || "Cliente") : "Cliente";

            // ── 2. Contexto de proyectos activos ───────────────────────────
            let contextoProyectos = "";
            if (cid) {
                try {
                    const proySnap = await db.ref("/proyectos")
                        .orderByChild("cid").equalTo(cid).limitToFirst(5).get();
                    if (proySnap.exists()) {
                        const lineas = [];
                        proySnap.forEach(function(p) {
                            const d = p.val();
                            if (!d || d.archivado) return;
                            const items = d.presupuesto && d.presupuesto.items
                                ? (Array.isArray(d.presupuesto.items)
                                    ? d.presupuesto.items
                                    : Object.values(d.presupuesto.items))
                                : [];
                            const resumen = items
                                .filter(function(it) { return it && it.type !== "chapter"; })
                                .map(function(it) {
                                    return "  - " + (it.desc || it.nombre || "Item") + ": " + (it.precioFinal || it.total || 0) + " Bs";
                                }).join("\n");
                            lineas.push(
                                "Proyecto: \"" + (d.nombre || "Sin nombre") + "\" | Estado: " +
                                (d.estado || "en curso") + " | Total: " +
                                (d.presupuesto && d.presupuesto.total ? d.presupuesto.total : 0) + " Bs\n" + resumen
                            );
                        });
                        if (lineas.length > 0) {
                            contextoProyectos = "\n\nPROYECTOS ACTIVOS:\n" + lineas.join("\n\n");
                        }
                    }
                } catch (e) {
                    console.warn("Error leyendo proyectos:", e.message);
                }
            }

            // ── 3. Historial de conversación (últimos 6 mensajes) ──────────
            let historialStr = "";
            try {
                const histSnap = await db.ref("/whatsapp_historial/" + fromPhone + "/mensajes")
                    .orderByChild("ts").limitToLast(6).get();
                if (histSnap.exists()) {
                    const lineas = [];
                    histSnap.forEach(function(h) {
                        const d = h.val();
                        lineas.push((d.role === "user" ? "Cliente" : "RUBIK") + ": " + d.text);
                    });
                    if (lineas.length > 0) {
                        historialStr = "\n\nCONVERSACION PREVIA:\n" + lineas.join("\n");
                    }
                }
            } catch (e) {
                console.warn("Error leyendo historial:", e.message);
            }

            // ── 4. Llamar a Gemini ─────────────────────────────────────────
            const { GoogleGenerativeAI } = require("@google/generative-ai");
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
            const aiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

            const prompt =
                "Sos el asistente de WhatsApp de RUBIK Bolivia — empresa de señaletica, publicidad y rotulacion.\n" +
                "Tu nombre es Rubik Asistente. Respondés de forma amable, profesional y concisa (maximo 3 parrafos cortos).\n" +
                "Usas español latinoamericano. Nunca revelas precios internos ni margenes de utilidad.\n\n" +
                "CLIENTE: " + nombreCliente + " | Numero: +" + fromPhone +
                " | Vinculado al sistema: " + (cid ? "SI" : "NO") + "\n" +
                contextoProyectos + "\n" +
                historialStr + "\n\n" +
                "MENSAJE ACTUAL DEL CLIENTE: \"" + textRecibido + "\"\n\n" +
                "INSTRUCCIONES:\n" +
                "- Si pregunta por el estado de su proyecto, usa la info de PROYECTOS ACTIVOS.\n" +
                "- Si pide una cotizacion nueva, pide los detalles (medidas, material, cantidad, uso).\n" +
                "- Si no estas seguro, di que consultaras con el equipo y que lo contactaran pronto.\n" +
                "- Si el cliente NO esta vinculado, invitalo a: https://rubikbolivia.com/cliente-view.html\n" +
                "- Responde SOLO el texto del mensaje, sin JSON, sin markdown, sin asteriscos.";

            const aiResult = await aiModel.generateContent(prompt);
            const respuesta = aiResult.response.text().trim();

            console.log("Respuesta IA: " + respuesta.substring(0, 100));

            // ── 5. Enviar por WhatsApp API de Meta ─────────────────────────
            if (phoneNumberId) {
                const https = require("https");
                const waUrl = "https://graph.facebook.com/v20.0/" + phoneNumberId + "/messages";
                const payload = JSON.stringify({
                    messaging_product: "whatsapp",
                    to: fromPhone,
                    type: "text",
                    text: { body: respuesta },
                });

                await new Promise(function(resolve, reject) {
                    const options = {
                        method: "POST",
                        headers: {
                            "Authorization": "Bearer " + WHATSAPP_TOKEN.value(),
                            "Content-Type": "application/json",
                            "Content-Length": Buffer.byteLength(payload),
                        },
                    };
                    const waReq = https.request(waUrl, options, function(r) {
                        let data = "";
                        r.on("data", function(chunk) { data += chunk; });
                        r.on("end", function() {
                            console.log("WhatsApp API (" + r.statusCode + "): " + data);
                            resolve();
                        });
                    });
                    waReq.on("error", reject);
                    waReq.write(payload);
                    waReq.end();
                });
            }

            // ── 6. Guardar historial en Firebase ───────────────────────────
            const histRef = db.ref("/whatsapp_historial/" + fromPhone + "/mensajes");
            const ts = Date.now();
            await histRef.push({ role: "user",  text: textRecibido, ts: ts });
            await histRef.push({ role: "model", text: respuesta,    ts: ts + 1 });

            await db.ref("/whatsapp_historial/" + fromPhone + "/meta").update({
                ultimoMensaje:       textRecibido,
                ultimaRespuesta:     respuesta,
                ultimaInteraccion:   ts,
                nombre:              nombreCliente,
            });

        } catch (err) {
            console.error("whatsappWebhook error:", err);
        }
    }
);

// ============================================================================
// Asistente Caja Chica / Auditor Contable (trigger Realtime DB) — v2
// ============================================================================
exports.asistenteCajaChica = onValueCreated(
    {
        ref: "/caja_chica/{workerId}/gastos/{gastoId}",
        region: "us-central1",
        cpu: 1,
        memory: "1GiB",
        timeoutSeconds: 120,
        secrets: [GEMINI_API_KEY],
    },
    async (event) => {
        const snapshot = event.data;
        if (!snapshot.exists()) return null;

        const gastoData = snapshot.val();
        if (!gastoData || !gastoData.fotos) return null;

        try {
            const { GoogleGenerativeAI } = require("@google/generative-ai");
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

            const imageUrl = gastoData.fotos[0];
            const filePath = decodeURIComponent(imageUrl.split("/o/")[1].split("?")[0]);
            const bucket = admin.storage().bucket();
            const [fileBuffer] = await bucket.file(filePath).download();

            const prompt = "Actua como auditor contable de Bolivia. Analiza la imagen y extrae en JSON: nit, nro_documento, monto_validado, categoria, comentario_ia";

            const result = await model.generateContent({ contents: [{ role: "user", parts: [
                { inlineData: { mimeType: "image/jpeg", data: fileBuffer.toString("base64") } },
                { text: prompt }
            ]}]});

            let iaResult = {};
            try {
                const raw = result.response.text();
                const clean = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
                const start = clean.indexOf("{"); const end = clean.lastIndexOf("}");
                if (start !== -1 && end !== -1) iaResult = JSON.parse(clean.substring(start, end + 1));
            } catch (_) {}

            const ref = event.ref;
            await ref.update({ ia_auditoria: iaResult, ia_procesado: true });
            return null;

        } catch (err) {
            console.error("asistenteCajaChica error:", err);
            return null;
        }
    }
);
