// Deploy forzado: 2026-07-09
/**
 * Cloud Functions — Rubik OS
 * VERSION TAG: rubik-2026-07-08-v3
 *
 * Migrado a firebase-functions v2 (Gen 2 / Cloud Run).
 *
 * Arquitectura de IA:
 *   - Texto / presupuesto / cotización → Claude (Anthropic)
 *   - Ingesta base de datos (materiales, APU, MO) → Claude
 *   - Generación de renders: Claude optimiza el prompt → Gemini genera la imagen
 *   - WhatsApp bot → Gemini
 *
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
const ANTHROPIC_API_KEY     = defineSecret("ANTHROPIC_API_KEY");
const WHATSAPP_TOKEN        = defineSecret("WHATSAPP_TOKEN");
const WHATSAPP_VERIFY_TOKEN = defineSecret("WHATSAPP_VERIFY_TOKEN");
const ADMIN_IMPORT_KEY      = defineSecret("ADMIN_IMPORT_KEY");

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

// ── Claude helpers ────────────────────────────────────────────────────────────

/** Convierte partes de formato Gemini a bloques de contenido de Claude */
function geminiPartsToClaudeContent(parts) {
    return parts.map(p => {
        if (p.text !== undefined) return { type: "text", text: p.text };
        const inline = p.inlineData || p.inline_data;
        if (inline) {
            const mime = inline.mimeType || inline.mime_type || "image/jpeg";
            if (mime === "application/pdf") {
                return { type: "document", source: { type: "base64", media_type: "application/pdf", data: inline.data } };
            }
            return { type: "image", source: { type: "base64", media_type: mime, data: inline.data } };
        }
        return { type: "text", text: JSON.stringify(p) };
    });
}

/** Llama a Claude API con retry para errores transitorios (529 overloaded, 503, 502).
 *  Usa prompt caching en el system prompt para reducir costos ~80% en requests repetidos. */
async function llamarClaude(anthropicKey, messages, systemText, maxTokens, model) {
    const body = {
        model: model || "claude-haiku-4-5",
        max_tokens: Math.min(maxTokens || 4096, 8192),
        messages,
    };
    // Prompt caching: cachea el system prompt (se reutiliza por 5 min, costo 10% en hits)
    if (systemText) {
        body.system = [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }];
    }

    const reqHeaders = {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        "Content-Type": "application/json",
    };
    const reqBodyStr = JSON.stringify(body);

    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 3000 * attempt));
        let res;
        try {
            res = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: reqHeaders,
                body: reqBodyStr,
            });
        } catch (netErr) {
            lastErr = netErr;
            console.warn(`[llamarClaude] red error intento ${attempt + 1}:`, netErr.message);
            continue;
        }
        // Retry en errores transitorios de Anthropic
        if (res.status === 529 || res.status === 503 || res.status === 502) {
            lastErr = new Error(`Claude API transitorio ${res.status} (intento ${attempt + 1})`);
            console.warn(`[llamarClaude]`, lastErr.message);
            continue;
        }
        const data = await res.json();
        if (!res.ok) {
            throw new Error(`Claude API ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
        }
        return data.content?.find(b => b.type === "text")?.text || "";
    }
    throw lastErr || new Error("Claude API: sin respuesta tras 3 intentos");
}

/**
 * Claude optimiza el prompt antes de enviarlo a Gemini para generación de imagen.
 * Recibe la descripción del usuario (y opcionalmente imagen de referencia)
 * y devuelve un prompt técnico detallado en inglés para los modelos de Gemini.
 */
async function claudeOptimizarPromptImagen(anthropicKey, descripcion, referenceImageData, referenceImageMime) {
    const content = [];
    if (referenceImageData) {
        content.push({
            type: "image",
            source: { type: "base64", media_type: referenceImageMime || "image/jpeg", data: referenceImageData },
        });
    }
    content.push({
        type: "text",
        text: `You are an expert at writing image generation prompts for photorealistic renders of signage, advertising, and branding installations in Latin America.

Based on the client's description${referenceImageData ? " and the reference image provided" : ""}, write a detailed image generation prompt in English.

Requirements:
- Photorealistic render quality, professional photography style
- Specify exact lighting (time of day, direction, intensity)
- Describe materials and textures in detail
- Include camera angle and perspective
- Specify Bolivian/Latin American urban or commercial context
- Include color palette details
- Maximum 300 words
- Return ONLY the prompt text, no explanations or preamble

Client description: ${descripcion}`,
    });

    try {
        const refined = await llamarClaude(anthropicKey, [{ role: "user", content }], null, 600);
        return refined.trim();
    } catch (e) {
        console.warn("Claude prompt refinement failed, using original:", e.message);
        return descripcion;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Credencial Gemini Live — devuelve la API key a usuarios autenticados.
// El WebSocket de Gemini Live no se puede proxy por Cloud Functions HTTP,
// así que el cliente lo conecta directo con la key obtenida aquí.
// ─────────────────────────────────────────────────────────────────────────────
exports.geminiLiveKey = onRequest({
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: 10,
    memory: "128MiB",
    region: "us-central1",
    invoker: "public",
    cors: false,
}, async (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const decoded = await requireAuth(req, res);
    if (!decoded) return;
    return res.status(200).json({ key: GEMINI_API_KEY.value() });
});

// ── Opciones de funciones ─────────────────────────────────────────────────────

// procesarIngestaIA: Claude (base de datos — materiales, APU, mano de obra)
const HTTP_OPTS = {
    secrets: [ANTHROPIC_API_KEY],
    timeoutSeconds: 540,
    memory: "2GiB",
    cpu: 1,
    concurrency: 1,
    region: "us-central1",
    invoker: "public",
    cors: false,
};

// geminiProxy: Claude para texto + Claude→Gemini para imágenes
const GEMINI_PROXY_OPTS = {
    secrets: [GEMINI_API_KEY, ANTHROPIC_API_KEY],
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
// PROXY GENÉRICO — texto via Claude, imágenes via Claude→Gemini
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
        const body = req.body || {};
        const geminiKey    = GEMINI_API_KEY.value();
        const anthropicKey = ANTHROPIC_API_KEY.value();

        // ── Generación de imagen — Claude optimiza el prompt → Gemini genera ──
        if (body.generateImage) {
            const userDescription = body.prompt || body.text || "imagen profesional corporativa";
            const errors = [];

            // Claude refina el prompt antes de enviarlo a Gemini
            const imgPrompt = await claudeOptimizarPromptImagen(
                anthropicKey,
                userDescription,
                body.referenceImage?.data,
                body.referenceImage?.mimeType
            );
            console.log("Claude→Gemini optimized prompt:", imgPrompt.slice(0, 200));

            // Parts para Gemini (incluye imágenes de referencia si las hay)
            const userParts = [];
            if (body.referenceImage?.data) {
                userParts.push({ inlineData: { data: body.referenceImage.data, mimeType: body.referenceImage.mimeType || "image/jpeg" } });
            }
            if (body.volumetryImage?.data) {
                userParts.push({ inlineData: { data: body.volumetryImage.data, mimeType: body.volumetryImage.mimeType || "image/jpeg" } });
            }
            if (Array.isArray(body.detalleImages)) {
                body.detalleImages.forEach(img => {
                    if (img?.data) userParts.push({ inlineData: { data: img.data, mimeType: img.mimeType || "image/jpeg" } });
                });
            }
            userParts.push({ text: imgPrompt });

            // ── 1. Descubrir modelos disponibles via ListModels ──────────────
            let dynamicImageModels = [];
            let dynamicImagenModels = [];
            try {
                const listRes = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}&pageSize=200`,
                    { method: "GET" }
                );
                const listData = await listRes.json();
                const allNames = (listData.models || []).map((m) => m.name.replace("models/", ""));
                console.log("ALL_MODELS:", allNames.join(" | "));
                dynamicImageModels = allNames.filter((n) =>
                    n.includes("image-generation") || n.includes("flash-image") || n.includes("pro-image")
                );
                dynamicImagenModels = allNames.filter((n) => n.startsWith("imagen"));
            } catch(e) {
                console.warn("ListModels failed:", e.message);
            }

            // ── 2. Gemini generateContent con responseModalities IMAGE ────────
            const geminiModels = [...new Set([
                ...dynamicImageModels,
                "gemini-2.5-flash-image-generation",
                "gemini-2.5-pro-image-generation",
            ])];
            for (const m of geminiModels) {
                try {
                    const r = await fetch(
                        `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${geminiKey}`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                contents: [{ role: "user", parts: userParts }],
                                generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
                            }),
                        }
                    );
                    const d = await r.json();
                    if (!r.ok) { errors.push(`${m} → ${r.status}: ${d?.error?.message || "?"}`); continue; }
                    for (const p of (d?.candidates?.[0]?.content?.parts || [])) {
                        const inline = p.inlineData || p.inline_data;
                        if (inline?.data) return res.status(200).json({ imageUrl: `data:${inline.mimeType || "image/png"};base64,${inline.data}` });
                    }
                    errors.push(`${m} → sin imagen (${d?.candidates?.[0]?.finishReason || "?"})`);
                } catch(e) { errors.push(`${m} → excepcion: ${e.message}`); }
            }

            // ── 3. Imagen via generateImages y predict ───────────────────────
            const imagenModels = [...new Set([
                ...dynamicImagenModels,
                "imagen-3.0-generate-002",
                "imagen-3.0-fast-generate-001",
                "imagen-4.0-generate-preview-06-02",
                "imagen-4.0-fast-generate-preview-06-02",
            ])];
            for (const m of imagenModels) {
                try {
                    const r = await fetch(
                        `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateImages?key=${geminiKey}`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ prompt: imgPrompt, number_of_images: 1, output_mime_type: "image/jpeg" }),
                        }
                    );
                    const d = await r.json();
                    if (r.ok) {
                        const img = d?.generatedImages?.[0]?.image || d?.images?.[0];
                        const b64 = img?.imageBytes || img?.bytesBase64Encoded;
                        if (b64) return res.status(200).json({ imageUrl: `data:${img?.mimeType || "image/jpeg"};base64,${b64}` });
                    }
                    errors.push(`${m}(generateImages) → ${r.status}: ${d?.error?.message || "?"}`);
                } catch(e) { errors.push(`${m}(generateImages) → excepcion: ${e.message}`); }

                try {
                    const r = await fetch(
                        `https://generativelanguage.googleapis.com/v1beta/models/${m}:predict?key=${geminiKey}`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ instances: [{ prompt: imgPrompt }], parameters: { sampleCount: 1, aspectRatio: "1:1" } }),
                        }
                    );
                    const d = await r.json();
                    if (r.ok) {
                        const pred = d?.predictions?.[0];
                        if (pred?.bytesBase64Encoded) return res.status(200).json({ imageUrl: `data:${pred.mimeType || "image/png"};base64,${pred.bytesBase64Encoded}` });
                    }
                    errors.push(`${m}(predict) → ${r.status}: ${d?.error?.message || "?"}`);
                } catch(e) { errors.push(`${m}(predict) → excepcion: ${e.message}`); }
            }

            console.error("imagen-gen ALL FAILED:", errors.join(" | "));
            const creditsMsg = "prepayment credits are depleted";
            const allCredits = errors.length > 0 && errors.every(e => e.includes("429") && e.includes(creditsMsg));
            if (allCredits) {
                return res.status(402).json({
                    error: "Créditos de Google AI agotados",
                    detalle: "Recargá créditos en aistudio.google.com/billing para continuar generando renders.",
                });
            }
            return res.status(500).json({ error: "Ningún modelo de imagen disponible.", detalle: errors.join(" | ") });
        }

        // ── Generación de texto — Claude ──────────────────────────────────────
        const generationConfig = body.generationConfig;
        const systemInstruction = body.systemInstruction;

        // Sufijo de dominio que se agrega a todo system prompt de presupuesto/cotización
        const DOMAIN_SUFFIX = `

RUBROS DE MANO DE OBRA — BOLIVIA (Santa Cruz): Usá SIEMPRE rubros específicos al trabajo. Ejemplos críticos:
- Espejos/vidrio → VIDRERO (corte, biselado, colocación con silicona) — jornal 150-200 Bs
- Soldadura → SOLDADOR ESTRUCTURAL — jornal 200-280 Bs
- Cerrajería armado → MAESTRO CERRAJERO — jornal 130-180 Bs
- Pintura → PINTOR — jornal 120-160 Bs
- Lona/tensado → TENSADOR — m2 8-12 Bs
- Instalación general → INSTALADOR — jornal 100-150 Bs
NUNCA usar "MANO DE OBRA" genérico.

MATERIALES — ESPEJOS/VIDRIO: Para paneles de espejo la estructura es tubín metálico + espejos. NO incluir plancha galvanizada ni MDF a menos que el usuario lo pida. El área de espejo = área total del panel MENOS las aperturas (huecos TV, ventanas, etc.). Calculá siempre esa resta.`;

        let systemText = null;
        if (systemInstruction) {
            if (typeof systemInstruction === "string") {
                systemText = systemInstruction + DOMAIN_SUFFIX;
            } else if (Array.isArray(systemInstruction.parts)) {
                systemText = systemInstruction.parts.map(p => p.text || "").join("\n") + DOMAIN_SUFFIX;
            } else if (typeof systemInstruction.text === "string") {
                systemText = systemInstruction.text + DOMAIN_SUFFIX;
            }
        } else {
            systemText = DOMAIN_SUFFIX.trim();
        }

        let messages;
        if (body.contents) {
            messages = body.contents.map(c => ({
                role: c.role === "model" ? "assistant" : "user",
                content: geminiPartsToClaudeContent(c.parts || []),
            }));
        } else if (Array.isArray(body.parts)) {
            messages = [{ role: "user", content: geminiPartsToClaudeContent(body.parts) }];
        } else if (typeof body.prompt === "string" || typeof body.text === "string") {
            const content = [];
            if (body.image?.data) {
                content.push({ type: "image", source: { type: "base64", media_type: body.image.mimeType || "image/jpeg", data: body.image.data } });
            }
            content.push({ type: "text", text: body.prompt || body.text });
            messages = [{ role: "user", content }];
        } else {
            throw new Error("El body debe contener 'contents', 'parts', 'prompt' o 'text'");
        }

        // advancedModel=true usa Opus para análisis complejos (producción, APU con imágenes)
        const chosenModel = body.advancedModel === true ? "claude-opus-4-8" : "claude-haiku-4-5";
        const maxOut = body.advancedModel === true
            ? Math.min(generationConfig?.maxOutputTokens || 8192, 8192)
            : generationConfig?.maxOutputTokens;
        const text = await llamarClaude(anthropicKey, messages, systemText, maxOut, chosenModel);

        // Devolver en formato Gemini para que el frontend existente lo lea sin cambios
        return res.status(200).json({
            candidates: [{ content: { parts: [{ text }], role: "model" }, finishReason: "STOP" }],
            promptFeedback: null,
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
// Motor de Ingesta Inteligente Multimodal — Claude
// (organización de base de datos: materiales, APU, mano de obra)
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
        const anthropicKey = ANTHROPIC_API_KEY.value();
        const { textPrompt, imagesBase64, pdfBase64, tipoIngesta } = req.body || {};

        const systemPrompt = `Eres el "Cerebro Central" de Ingesta de Datos de Rubik OS.
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
Consulta/Links: ${textPrompt || "No proporcionado."}`;

        const userContent = [];

        if (Array.isArray(imagesBase64) && imagesBase64.length > 0) {
            imagesBase64.forEach(img => {
                if (typeof img === "string" && img.includes(",")) {
                    const b64 = img.split(",")[1];
                    const mimeMatch = img.match(/data:([^;]+);/);
                    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
                    userContent.push({ type: "image", source: { type: "base64", media_type: mime, data: b64 } });
                }
            });
        }

        if (pdfBase64 && typeof pdfBase64 === "string" && pdfBase64.includes(",")) {
            const b64 = pdfBase64.split(",")[1];
            userContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } });
        }

        userContent.push({ type: "text", text: "Procesa la solicitud y devuelve el JSON correspondiente." });

        const rawText = await llamarClaude(
            anthropicKey,
            [{ role: "user", content: userContent }],
            systemPrompt,
            4096
        );

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

function normalizarTel(tel) {
    if (!tel) return "";
    const s = String(tel).replace(/\D/g, "");
    if (s.startsWith("591") && s.length > 8) return s.slice(3);
    return s;
}

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

async function identificarRol(db, phone) {
    const phoneNorm = normalizarTel(phone);
    const ADMIN_PHONES = ["76868833", "59176868833"];
    if (ADMIN_PHONES.includes(phone) || ADMIN_PHONES.includes(phoneNorm)) {
        return { rol: "ADMIN", nombre: "Renzo", id: "RENZO_INTERNO", data: {} };
    }
    try {
        const persSnap = await db.ref("/personal").get();
        if (persSnap.exists()) {
            let encontrado = null;
            persSnap.forEach(function(child) {
                const p = child.val();
                if (!p || encontrado) return;
                const tel = normalizarTel(p.telefono || p.phone || p.whatsapp || "");
                if (tel === phoneNorm || tel === phone) encontrado = { key: child.key, data: p };
            });
            if (encontrado) {
                const d = encontrado.data;
                const esSupervisor = d.tipo === "supervisor" || d.rol === "supervisor";
                return { rol: esSupervisor ? "SUPERVISOR" : "TRABAJADOR", nombre: d.nombre || encontrado.key, id: encontrado.key, data: d };
            }
        }
    } catch (e) { console.warn("Error buscando personal:", e.message); }
    try {
        const cliSnap = await db.ref("/clientes").get();
        if (cliSnap.exists()) {
            let encontrado = null;
            cliSnap.forEach(function(child) {
                const c = child.val();
                if (!c || encontrado) return;
                const tel1 = normalizarTel(c.wsp || "");
                const tel2 = normalizarTel(c.whatsapp || "");
                if ([tel1, tel2].includes(phoneNorm) || [tel1, tel2].includes(phone)) encontrado = { key: child.key, data: c };
            });
            if (encontrado) return { rol: "CLIENTE", nombre: encontrado.data.nombre || encontrado.key, id: encontrado.key, data: encontrado.data };
        }
    } catch (e) { console.warn("Error buscando cliente:", e.message); }
    return { rol: "DESCONOCIDO", nombre: "Desconocido", id: null, data: {} };
}

async function contextoProyectos(db, rol, id) {
    try {
        const proySnap = await db.ref("/proyectos").get();
        if (!proySnap.exists()) return "";
        const lineas = [];
        proySnap.forEach(function(cliNode) {
            const cid = cliNode.key;
            if (rol === "CLIENTE" && cid !== id) return;
            cliNode.forEach(function(proyNode) {
                const p = proyNode.val();
                if (!p || p.archivado) return;
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
                let presStr = "";
                if (rol === "ADMIN") {
                    presStr = " | Total: " + total + " Bs";
                    if (p.gasto_total) presStr += " | Gasto: " + p.gasto_total + " Bs";
                } else if (rol === "CLIENTE") {
                    presStr = " | Presupuesto aprobado: " + total + " Bs";
                }
                lineas.push("Proyecto: \"" + nombre + "\" (cid:" + cid + "/pid:" + proyNode.key + ") | Estado: " + estado + presStr + tareasStr);
            });
        });
        return lineas.length ? "\n\nPROYECTOS:\n" + lineas.join("\n\n") : "";
    } catch (e) { console.warn("Error leyendo proyectos:", e.message); return ""; }
}

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
    } catch (e) { return ""; }
}

function buildPrompt(rol, nombre, contexto, historial, mensaje) {
    const base =
        "Sos el asistente de WhatsApp de RUBIK Bolivia — empresa de señaletica, publicidad y rotulacion.\n" +
        "Tu nombre es Rubik Asistente. Respondés en español latinoamericano, de forma amable, profesional y concisa (maximo 3 parrafos cortos).\n" +
        "Nunca uses markdown, asteriscos ni JSON en tu respuesta — solo texto plano.\n\n";
    let instrucciones = "";
    if (rol === "ADMIN") {
        instrucciones = "ROL: ADMIN (Renzo, dueño de RUBIK Bolivia). Tenes acceso total al sistema.\nPodes consultar proyectos, precios, proveedores, finanzas, inventario y personal.\nSi pide una cotizacion, construila con los materiales de la BD.\nSi piden reportes financieros, resume los datos disponibles.\nNunca reveles margenes de ganancia ni precios internos a nadie que no sea ADMIN.\n";
    } else if (rol === "SUPERVISOR") {
        instrucciones = "ROL: SUPERVISOR de obra. Podes consultar estado de proyectos y tareas asignadas.\nNO tenes acceso a datos financieros, margenes ni precios de costo.\n";
    } else if (rol === "TRABAJADOR") {
        instrucciones = "ROL: TRABAJADOR. Solo podes consultar tus tareas y el estado de los proyectos en los que participas.\nNo tenes acceso a datos de otros trabajadores ni informacion financiera.\n";
    } else if (rol === "CLIENTE") {
        instrucciones = "ROL: CLIENTE. Solo podes consultar el estado de avance de TUS proyectos.\nNo tenes acceso a proyectos de otros clientes ni a informacion interna.\n";
    } else {
        instrucciones = "ROL: Visitante no registrado. Podes dar informacion general sobre RUBIK Bolivia (servicios, contacto).\nPara mas informacion invita al usuario a contactarse por los canales oficiales.\n";
    }
    const historialTxt = historial.length
        ? "\n\nHISTORIAL RECIENTE:\n" + historial.map(function(h) {
            return (h.role === "user" ? "Usuario" : "Asistente") + ": " + h.content;
          }).join("\n")
        : "";
    return base + instrucciones + (contexto ? "\n\nDATOS DEL SISTEMA:" + contexto : "") + historialTxt + "\n\nMensaje actual del usuario: " + mensaje;
}

const WA_OPTS = {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60,
    secrets: [WHATSAPP_TOKEN, WHATSAPP_VERIFY_TOKEN, GEMINI_API_KEY],
    invoker: "public",
};

exports.whatsappWebhook = onRequest(WA_OPTS, async (req, res) => {
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
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    try {
        const body = req.body;
        const entry    = body?.entry?.[0];
        const changes  = entry?.changes?.[0];
        const value    = changes?.value;
        const messages = value?.messages;
        if (!messages || !messages.length) return res.status(200).send("OK");
        const msg         = messages[0];
        const from        = msg.from;
        const phoneNumberId = value?.metadata?.phone_number_id;
        const waToken     = WHATSAPP_TOKEN.value();
        const geminiKey   = GEMINI_API_KEY.value();
        const msgType = msg.type;
        let textoUsuario = "";
        let imagenB64 = null;
        let imagenMime = "image/jpeg";
        if (msgType === "text") {
            textoUsuario = msg.text?.body || "";
        } else if (msgType === "image") {
            const mediaId = msg.image?.id;
            textoUsuario  = msg.image?.caption || "Analiza esta imagen";
            try {
                const mediaRes = await fetch("https://graph.facebook.com/v20.0/" + mediaId, { headers: { Authorization: "Bearer " + waToken } });
                const mediaData = await mediaRes.json();
                const imgRes = await fetch(mediaData.url, { headers: { Authorization: "Bearer " + waToken } });
                const arrayBuf = await imgRes.arrayBuffer();
                imagenB64  = Buffer.from(arrayBuf).toString("base64");
                imagenMime = msg.image?.mime_type || "image/jpeg";
            } catch(e) {
                console.error("Error descargando imagen WA:", e.message);
                textoUsuario = "No se pudo procesar la imagen. " + textoUsuario;
            }
        } else {
            return res.status(200).send("OK");
        }
        if (!textoUsuario.trim()) return res.status(200).send("OK");
        const db   = admin.database();
        const rol  = await identificarRol(from);
        const nombre = rol === "ADMIN" ? "Renzo" : from;
        let contexto = await contextoProyectos(db, rol, from);
        if (rol === "ADMIN") contexto += await contextoPrecios(db);
        const historial = await leerHistorial(db, from);
        const systemPrompt = buildPrompt(rol, nombre, contexto, historial, textoUsuario);
        const parts = [];
        if (imagenB64) parts.push({ inlineData: { mimeType: imagenMime, data: imagenB64 } });
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
        const respuesta  = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "No pude procesar tu consulta en este momento.";
        await guardarHistorial(db, from, textoUsuario, respuesta);
        await enviarWA(phoneNumberId, from, respuesta, waToken);
        return res.status(200).send("OK");
    } catch (e) {
        console.error("Error en whatsappWebhook:", e);
        return res.status(200).send("OK");
    }
});

// ─────────────────────────────────────────────────────────
// TTS PROXY — Google Cloud Text-to-Speech Neural2 voices
// Usa ADC (metadata server) — no requiere secretos adicionales.
// Requiere que la Cloud Text-to-Speech API esté habilitada en el proyecto GCP.
// ─────────────────────────────────────────────────────────
exports.ttsProxy = onRequest({
    timeoutSeconds: 15,
    memory: "256MiB",
    region: "us-central1",
    invoker: "public",
    cors: false,
}, async (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    try {
        const { text, voice } = req.body || {};
        if (!text || typeof text !== "string") return res.status(400).json({ error: "Falta campo text" });

        // ADC via metadata server (disponible en todos los Cloud Functions / Cloud Run)
        const tokenResp = await fetch(
            "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
            { headers: { "Metadata-Flavor": "Google" } }
        );
        const { access_token } = await tokenResp.json();

        const ttsResp = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + access_token,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                input: { text: text.slice(0, 5000) },
                voice: {
                    languageCode: "es-US",
                    name: voice || "es-US-Neural2-B",
                },
                audioConfig: {
                    audioEncoding: "MP3",
                    speakingRate: 0.94,
                    pitch: 0.0,
                },
            }),
        });

        if (!ttsResp.ok) {
            const errData = await ttsResp.json().catch(() => ({}));
            console.error("TTS API error:", ttsResp.status, errData);
            return res.status(ttsResp.status).json({ error: errData?.error?.message || "TTS error" });
        }

        const data = await ttsResp.json();
        return res.status(200).json({ audioContent: data.audioContent });

    } catch (e) {
        console.error("ttsProxy error:", e);
        return res.status(500).json({ error: e.message });
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

// ============================================================================
// IMPORTACIÓN BULK ADMIN — para agentes automatizados (scraping, migraciones)
// Protegido por X-Admin-Key (ADMIN_IMPORT_KEY en Secret Manager)
// Escribe directamente a Firebase Realtime Database sin requerir auth de usuario
// ============================================================================
exports.importarAdmin = onRequest({
    secrets: [ADMIN_IMPORT_KEY],
    timeoutSeconds: 120,
    memory: "512MiB",
    region: "us-central1",
    invoker: "public",
    cors: false,
}, async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

    const key = req.headers["x-admin-key"] || "";
    if (!key || key !== ADMIN_IMPORT_KEY.value()) {
        return res.status(401).json({ error: "Clave de administrador inválida" });
    }

    const { materiales = [], mano_obra = [], items_apu = [] } = req.body || {};
    const db = admin.database();

    function toKey(nombre) {
        return String(nombre).toUpperCase().replace(/[.#$[\]/\s]+/g, "_").slice(0, 80);
    }

    const resultados = { materiales: 0, mano_obra: 0, items: 0, errores: [] };

    for (const mat of materiales) {
        try {
            const k = toKey(mat.n || mat.nombre || "");
            if (!k) continue;
            const payload = { n: k, u: (mat.u || "und").toLowerCase(), p: parseFloat(mat.p) || 0, desc: k, und: (mat.u || "und").toLowerCase(), pu: parseFloat(mat.p) || 0 };
            if (mat.proveedor) payload.proveedor = mat.proveedor;
            await db.ref(`base_datos/materiales/${k}`).update(payload);
            resultados.materiales++;
        } catch (e) { resultados.errores.push(`mat:${mat.n} → ${e.message}`); }
    }

    for (const mo of mano_obra) {
        try {
            const k = toKey(mo.n || mo.nombre || "");
            if (!k) continue;
            const payload = { n: k, u: (mo.u || "jornal").toLowerCase(), p: parseFloat(mo.p) || 0, desc: k, und: (mo.u || "jornal").toLowerCase(), pu: parseFloat(mo.p) || 0 };
            await db.ref(`base_datos/mano_obra/${k}`).update(payload);
            resultados.mano_obra++;
        } catch (e) { resultados.errores.push(`mo:${mo.n} → ${e.message}`); }
    }

    for (const item of items_apu) {
        try {
            const k = toKey(item.desc || "");
            if (!k) continue;
            await db.ref(`base_datos/items/${k}`).update(item);
            resultados.items++;
        } catch (e) { resultados.errores.push(`item:${item.desc} → ${e.message}`); }
    }

    console.log("importarAdmin:", JSON.stringify(resultados));
    return res.status(200).json({ ok: true, cargados: resultados });
});
