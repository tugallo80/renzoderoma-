/**
 * Rubik OS — cliente Gemini con proxy autenticado.
 *
 * Antes: cada página llamaba directo a Gemini con la API key en el HTML.
 * Ahora: este módulo expone la misma forma del SDK, pero por debajo
 * envía cada request al Cloud Function `geminiProxy`, autenticando con
 * el ID token de Firebase del usuario logueado. La API key NUNCA viaja
 * al navegador.
 *
 * Uso:
 *   import { GoogleGenerativeAI } from "/js/gemini-client.js";
 *   const genAI = new GoogleGenerativeAI();      // sin key
 *   const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
 *   const result = await model.generateContent(parts);
 *   const text = result.response.text();
 *
 * Para llamadas estilo REST (fetch directo a generativelanguage.googleapis.com),
 * usar `callGemini` en su lugar — devuelve el shape REST nativo.
 */

// URL relativa: Firebase Hosting rewrite la enruta a la Cloud Function `geminiProxy`.
// Same-origin = sin CORS y URL estable independiente del hash de Cloud Run.
const PROXY_URL = "/api/gemini";

async function getIdToken() {
    // Hook opcional para módulos que ya tienen un getter custom
    if (typeof window !== "undefined" && typeof window.rubikGetIdToken === "function") {
        const t = await window.rubikGetIdToken();
        if (!t) throw new Error("Usuario no autenticado.");
        return t;
    }
    if (typeof window === "undefined" || !window.firebase || typeof window.firebase.auth !== "function") {
        throw new Error("Firebase Auth SDK no cargado. Agrega <script src='https://www.gstatic.com/firebasejs/9.1.3/firebase-auth-compat.js'></script>.");
    }
    let user = window.firebase.auth().currentUser;
    if (!user) {
        // Auth puede tardar un instante en hidratarse después de un page-load.
        // Esperamos hasta 5s a que onAuthStateChanged dispare.
        user = await new Promise((resolve) => {
            let done = false;
            const unsub = window.firebase.auth().onAuthStateChanged((u) => {
                if (done) return;
                done = true; unsub(); resolve(u);
            });
            setTimeout(() => {
                if (done) return;
                done = true; try { unsub(); } catch(e) {} resolve(null);
            }, 5000);
        });
    }
    if (!user) throw new Error("Usuario no autenticado. Iniciá sesión nuevamente.");
    return await user.getIdToken();
}

async function postProxy(payload, { retries = 3, delayMs = 1500 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        // En reintentos, esperar con backoff exponencial
        if (attempt > 0) {
            await new Promise(r => setTimeout(r, delayMs * attempt));
        }
        let token;
        try { token = await getIdToken(); } catch(e) { throw e; } // no reintentar auth errors
        let res, rawText;
        try {
            res = await fetch(PROXY_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
            });
            rawText = await res.text();
        } catch(networkErr) {
            lastErr = new Error(`Error de red: ${networkErr.message}`);
            continue; // red caída → reintentar
        }

        // 502/503/504 = Cloud Function fría o sobrecargada → reintentar
        if (res.status === 502 || res.status === 503 || res.status === 504) {
            lastErr = new Error(`Proxy temporalmente no disponible (${res.status}). Reintentando...`);
            console.warn(`[gemini-client] ${res.status} en intento ${attempt + 1}/${retries + 1}, reintentando...`);
            continue;
        }

        if (!res.ok) {
            let detail = rawText;
            try {
                const err = JSON.parse(rawText);
                detail = err.detalle ? `${err.error || ""} — ${err.detalle}` : (err.error || rawText);
            } catch { /* mantener rawText */ }
            throw new Error(`Gemini proxy ${res.status}: ${detail}`);
        }

        try { return JSON.parse(rawText); }
        catch { throw new Error(`Respuesta no-JSON del proxy: ${rawText.slice(0, 200)}`); }
    }
    throw lastErr || new Error("Gemini proxy no respondió después de varios intentos. Intenta de nuevo.");
}

/**
 * Llamada estilo REST (para reemplazar fetch directos a
 * https://generativelanguage.googleapis.com/...:generateContent).
 * Devuelve el shape REST de Gemini ({ candidates: [...] }).
 */
export async function callGemini({ model, contents, parts, text, generationConfig }) {
    const payload = { model };
    if (generationConfig) payload.generationConfig = generationConfig;
    if (contents) payload.contents = contents;
    else if (Array.isArray(parts)) payload.parts = parts;
    else if (typeof text === "string") payload.text = text;
    else throw new Error("callGemini requiere contents, parts o text.");
    return await postProxy(payload);
}

/**
 * Extrae todas las imágenes inline (base64) de una respuesta de Gemini.
 * Devuelve [{ mimeType, data, dataUrl }] listas para usar en <img src="...">.
 */
export function extractImages(geminiResponse) {
    const images = [];
    const candidates = geminiResponse?.candidates || [];
    for (const cand of candidates) {
        const parts = cand?.content?.parts || [];
        for (const p of parts) {
            const inline = p.inlineData || p.inline_data;
            if (inline && inline.data && (inline.mimeType || inline.mime_type || "").startsWith("image/")) {
                const mimeType = inline.mimeType || inline.mime_type;
                images.push({
                    mimeType,
                    data: inline.data,
                    dataUrl: `data:${mimeType};base64,${inline.data}`,
                });
            }
        }
    }
    return images;
}

/**
 * Helper de alto nivel para generar UNA imagen técnica con Gemini.
 * Si `model` es "auto" (default) prueba varios modelos en orden hasta que uno funcione.
 * Devuelve dataUrl de la imagen, o lanza error con detalle del último intento.
 */
export async function generateImage({ prompt, referenceImages = [], model = "auto" }) {
    const parts = [];
    for (const ref of referenceImages) {
        if (typeof ref === "string" && ref.startsWith("data:")) {
            const [meta, b64] = ref.split(",");
            const mimeType = (meta.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
            parts.push({ inlineData: { data: b64, mimeType } });
        } else if (ref && ref.data && ref.mimeType) {
            parts.push({ inlineData: { data: ref.data, mimeType: ref.mimeType } });
        }
    }
    parts.push({ text: prompt });

    // Lista de modelos de imagen a probar en orden — si uno tira 404, salta al siguiente
    const candidatos = model === "auto"
        ? [
            "gemini-2.5-flash-image",
            "gemini-2.0-flash-preview-image-generation",
            "gemini-2.0-flash-exp-image-generation",
            "gemini-2.0-flash-exp",
        ]
        : [model];

    let lastErr;
    for (const m of candidatos) {
        try {
            const data = await postProxy({
                model: m,
                contents: [{ role: "user", parts }],
                generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
            });
            const images = extractImages(data);
            if (images.length > 0) return images[0].dataUrl;

            const txt = (data?.text
                || data?.candidates?.[0]?.content?.parts?.[0]?.text
                || "").trim();
            const finishReason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "";
            lastErr = new Error("Modelo " + m + " no produjo imagen. " + (finishReason ? "finishReason=" + finishReason + " " : "") + (txt ? "texto=" + txt.slice(0, 200) : ""));
            continue;
        } catch (e) {
            lastErr = e;
            // Si es 404 (modelo no encontrado), seguir con el siguiente
            if ((e.message || "").includes("404") || (e.message || "").toLowerCase().includes("not found")) {
                console.warn(`Modelo ${m} no disponible, intentando siguiente...`);
                continue;
            }
            // Otros errores (auth, quota, etc.) no se reintentan con otro modelo
            throw e;
        }
    }
    throw lastErr || new Error("Ningún modelo de imagen disponible.");
}

/**
 * Efecto typewriter: muestra el texto carácter por carácter en un elemento DOM.
 * Uso:
 *   const el = document.createElement('div');
 *   chatBox.appendChild(el);
 *   await typewriterAppend(el, "Hola, esto es una respuesta...");
 *
 * @param {HTMLElement} el   - Elemento donde se escribe
 * @param {string}      text - Texto completo a mostrar
 * @param {number}      [speed=12] - ms por carácter (12ms ≈ 80 chars/seg)
 */
export function typewriterAppend(el, text, speed = 12) {
    return new Promise((resolve) => {
        let i = 0;
        // Pre-procesar: convertir \n → <br> y **bold** → <b>
        const html = text
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
            .replace(/\n/g, '<br>');
        // Usar innerHTML directamente para respetar las etiquetas
        // Dividir en tokens (texto plano + etiquetas HTML)
        const tokens = [];
        const tagRe = /<[^>]+>/g;
        let last = 0, m;
        while ((m = tagRe.exec(html)) !== null) {
            if (m.index > last) tokens.push({ type: 'text', val: html.slice(last, m.index) });
            tokens.push({ type: 'tag', val: m[0] });
            last = m.index + m[0].length;
        }
        if (last < html.length) tokens.push({ type: 'text', val: html.slice(last) });

        let built = '';
        let ti = 0; let ci = 0;
        function step() {
            if (ti >= tokens.length) { el.innerHTML = built; resolve(); return; }
            const tok = tokens[ti];
            if (tok.type === 'tag') {
                built += tok.val; ti++; ci = 0; el.innerHTML = built; step(); return;
            }
            // texto: un carácter por tick
            if (ci < tok.val.length) {
                built += tok.val[ci++]; el.innerHTML = built;
                setTimeout(step, speed);
            } else { ti++; ci = 0; step(); }
        }
        step();
    });
}

/**
 * Drop-in replacement de `@google/generative-ai`.
 * Ignora el argumento `apiKey` — la key real vive en el Cloud Function.
 */
export class GoogleGenerativeAI {
    constructor(_apiKeyIgnored) {
        // intencionalmente vacío: ya no hay key en el cliente.
    }

    getGenerativeModel(opts = {}) {
        const modelName = opts.model || "gemini-2.5-flash";
        const generationConfig = opts.generationConfig;

        return {
            generateContent: async (input) => {
                const payload = { model: modelName };
                if (generationConfig) payload.generationConfig = generationConfig;

                if (typeof input === "string") {
                    payload.parts = [{ text: input }];
                } else if (Array.isArray(input)) {
                    payload.parts = input.map((p) => (typeof p === "string" ? { text: p } : p));
                } else if (input && typeof input === "object") {
                    if (Array.isArray(input.contents)) payload.contents = input.contents;
                    else if (Array.isArray(input.parts)) payload.parts = input.parts;
                    else throw new Error("Formato de input no soportado.");
                } else {
                    throw new Error("Input vacío para generateContent.");
                }

                const data = await postProxy(payload);
                // Devolvemos el mismo shape que expone el SDK oficial.
                return {
                    response: {
                        text: () => data.text || "",
                        candidates: data.candidates,
                        promptFeedback: data.promptFeedback,
                    },
                };
            },
        };
    }
}
