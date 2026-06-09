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
            "Si pide contactar un proveedor, incluí su número de contacto.\n" +
            "Respondé de forma ejecutiva y directa — sos el jefe.\n";
    } else if (rol === "SUPERVISOR") {
        instrucciones =
            "ROL: SUPERVISOR. Tenes acceso a los proyectos asignados a vos.\n" +
            "Podes ver tareas, estados y avances. NO tenes acceso a precios internos ni utilidades.\n" +
            "Si necesitas información fuera de tu alcance, indicá que consultará con Renzo.\n";
    } else if (rol === "TRABAJADOR") {
        instrucciones =
            "ROL: TRABAJADOR. Solo ves los proyectos donde estás asignado.\n" +
            "Podes consultar qué tareas tenés hoy, cómo realizarlas, y reportar avances.\n" +
            "NO tenes acceso a presupuestos, utilidades ni proyectos de otros.\n" +
            "Si el trabajador necesita comprar algo, pedile: ¿para qué proyecto? ¿qué necesita? y avisale que lo gestionarás con Renzo.\n";
    } else if (rol === "CLIENTE") {
        instrucciones =
            "ROL: CLIENTE. Solo ves tus propios proyectos.\n" +
            "Podes consultar estado de tu proyecto, pedir fotos de avance, hacer consultas y cotizaciones.\n" +
            "NO revelar precios internos, márgenes ni datos de otros clientes.\n" +
            "Si necesita algo fuera de lo disponible, decile que el equipo lo contactará pronto.\n";
    } else {
        instrucciones =
            "ROL: DESCONOCIDO. Este número no está registrado en el sistema.\n" +
            "Saludalo amablemente e indicale que para ser atendido debe registrarse en: https://rubikbolivia.com/cliente-view.html\n" +
            "No brindes información del negocio hasta que esté registrado.\n";
    }

    return (
        base +
        instrucciones + "\n" +
        "USUARIO: " + nombre + " | Teléfono: +" + "\n" +
        contexto +
        historial + "\n\n" +
        "MENSAJE: \"" + mensaje + "\""
    );
}

// ── Webhook principal ──────────────────────────────────────────────────────

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

        // ── GET: verificación del webhook por Meta ─────────────────────────
        if (req.method === "GET") {
            const mode      = req.query["hub.mode"];
            const token     = req.query["hub.verify_token"];
            const challenge = req.query["hub.challenge"];
            // Comparar contra el secret Y contra el valor hardcodeado como fallback
            const expectedToken = (WHATSAPP_VERIFY_TOKEN.value() || "").trim();
            const VERIFY_FALLBACK = "rubik-webhook-2026";
            if (mode === "subscribe" && (token === expectedToken || token === VERIFY_FALLBACK)) {
                console.log("Webhook verificado OK, token:", token);
                return res.status(200).send(challenge);
            }
            console.log("Token invalido recibido:", token, "| esperado:", expectedToken);
            return res.status(403).send("Token invalido");
        }

        if (req.method !== "POST") return res.status(405).send("Metodo no permitido");

        // Responder 200 inmediato — Meta reintenta si no recibe respuesta rápida
        res.status(200).send("OK");

        try {
            const body   = req.body || {};
            const entry  = (body.entry || [])[0];
            const change = (entry && entry.changes) ? entry.changes[0] : null;
            const value  = change ? change.value : null;
            const messages = value && value.messages;
            if (!messages || !messages[0]) return;

            const msg           = messages[0];
            const fromPhone     = msg.from;
            const phoneNumberId = value.metadata ? value.metadata.phone_number_id : null;
            const msgType       = msg.type;

            // Por ahora procesamos texto e imagen
            if (msgType !== "text" && msgType !== "image") return;

            const textRecibido = msgType === "text"
                ? msg.text.body.trim()
                : "[El usuario envió una imagen]" + (msg.image && msg.image.caption ? " — " + msg.image.caption : "");

            console.log("[WA] De:" + fromPhone + " Tipo:" + msgType + " Msg:" + textRecibido.slice(0, 80));

            const db = admin.database();

            // ── 1. Identificar rol ─────────────────────────────────────────
            const usuario = await identificarRol(db, fromPhone);
            const { rol, nombre, id } = usuario;
            console.log("[WA] Rol identificado:", rol, nombre);

            // ── 2. Construir contexto según rol ────────────────────────────
            let contexto = "";

            if (rol !== "DESCONOCIDO") {
                // Todos ven proyectos (filtrados por rol)
                contexto += await contextoProyectos(db, rol, id);
            }

            if (rol === "ADMIN") {
                // Admin además ve precios y proveedores
                contexto += await contextoPrecios(db);
            }

            // ── 3. Historial conversación ──────────────────────────────────
            const historial = await leerHistorial(db, fromPhone, 8);

            // ── 4. Llamar a Gemini ─────────────────────────────────────────
            const { GoogleGenerativeAI } = require("@google/generative-ai");
            const genAI   = new GoogleGenerativeAI(GEMINI_API_KEY.value());
            const aiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

            const prompt  = buildPrompt(rol, nombre, contexto, historial, textRecibido);
            const aiResult = await aiModel.generateContent(prompt);
            const respuesta = aiResult.response.text().trim();

            console.log("[WA] Respuesta IA (" + rol + "): " + respuesta.slice(0, 100));

            // ── 5. Enviar respuesta por WhatsApp ───────────────────────────
            if (phoneNumberId) {
                await enviarWA(phoneNumberId, fromPhone, respuesta, WHATSAPP_TOKEN.value());
            }

            // ── 6. Guardar historial ───────────────────────────────────────
            await guardarHistorial(db, fromPhone, textRecibido, respuesta, nombre, rol);

        } catch (err) {
            console.error("[WA] Error:", err.message || err);
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
