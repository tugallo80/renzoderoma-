/**
 * Conector MCP remoto "Rubik" (rubikMcp) para claude.ai — docs/sesiones/05-rubik-agente-app.md.
 * Una sola Function atiende (por Firebase Hosting, rubikbolivia.com):
 *   /mcp                                          MCP, transporte HTTP streamable (sin sesión, respuestas JSON)
 *   /.well-known/oauth-protected-resource[/mcp]   metadatos del recurso (RFC 9728)
 *   /.well-known/oauth-authorization-server       metadatos del servidor OAuth (RFC 8414)
 *   /oauth/register | authorize | token | revoke  OAuth 2.1 (CIMD o registro dinámico, PKCE S256, refresh rotativo)
 * El login es con la cuenta de la app (Firebase Auth) y solo pasa la lista blanca /acceso/hub/{uid}.
 * No usa ninguna API paga: las cotizaciones las hace Claude con la suscripción del dueño.
 */
const crypto = require("crypto");
const OA = require("./oauth");
const P = require("./pantalla");
const H = require("./herramientas");
const { crearAlmacen } = require("../agente/almacen");

const BASE = (process.env.RUBIK_MCP_BASE || "https://rubikbolivia.com").replace(/\/+$/, "");
const CFG = { base: BASE, recurso: `${BASE}/mcp` };

/** Nodos que puede tocar el conector (cada herramienta, además, se acota a los suyos). */
const RUTAS_MCP = [
    /^mcp_oauth(\/|$)/,
    /^clientes(\/|$)/,
    /^proyectos\/[^/]+(\/|$)/,
    /^base_datos(\/|$)/,
    /^agente_memoria(\/|$)/,
    /^config\/agente(\/|$)/,
    /^respaldos_agente(\/|$)/,
];

const INSTRUCCIONES = `Conector de la app de Rubik Bolivia (taller de stands, mobiliario, letreros). Con él cotizás en la app del dueño, con sus reglas:
- Un ítem es lo que se entrega; materiales y mano de obra van dentro del APU.
- Cada número tiene origen (pieza3d, base, cota_plano, dueño, supuesto confirmado). No inventes precios: salen de la base. Los totales los calcula armar_borrador.
- Una sola ronda de preguntas, concretas y del proyecto. Alternativas y "por confirmar" fuera del total. Características para el cliente sin datos internos.
- Los recargos (cargas sociales, indirectos, utilidad) los decide el dueño: no los cambies por tu cuenta.
Flujo: listar_clientes → listar_proyectos (o crear_cliente / crear_proyecto) → abrir_cotizacion (una por chat; guardá cid, pid y conv) → registrar_mensaje_del_dueno y registrar_lectura_de_archivo para tener orígenes → buscar_base / medicion_3d → armar_borrador → ver_borrador → aplicar_al_presupuesto (con la confirmación del dueño).
Si está el skill "cotizar-en-rubik", seguilo. Respondé en español de Bolivia, corto.`;

function dependencias(admin, esHub) {
    return {
        almacen: crearAlmacen(admin, RUTAS_MCP),
        ahora: () => Date.now(),
        esHub,
        verificarIdToken: (t) => admin.auth().verifyIdToken(t, true),
        traerJson: async (url) => {
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), 5000);
            try {
                const r = await fetch(url, { signal: ctl.signal, redirect: "error", headers: { Accept: "application/json" } });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const txt = await r.text();
                if (txt.length > 20000) throw new Error("documento demasiado grande");
                return JSON.parse(txt);
            } finally { clearTimeout(timer); }
        },
        log: (...a) => console.warn(...a),
    };
}

// ---------------------------------------------------------------- MCP
let SDK = null;
function sdk() {
    if (!SDK) {
        SDK = {
            Server: require("@modelcontextprotocol/sdk/server/index.js").Server,
            Transporte: require("@modelcontextprotocol/sdk/server/streamableHttp.js").StreamableHTTPServerTransport,
            tipos: require("@modelcontextprotocol/sdk/types.js"),
        };
    }
    return SDK;
}

function crearServidorMcp(almacen, uid) {
    const { Server, tipos } = sdk();
    const s = new Server({ name: "rubik", title: "Rubik Bolivia", version: "1.0.0" }, { capabilities: { tools: {} }, instructions: INSTRUCCIONES });
    s.setRequestHandler(tipos.ListToolsRequestSchema, async () => ({ tools: H.definiciones() }));
    s.setRequestHandler(tipos.CallToolRequestSchema, async (req) => H.llamar(almacen, uid, req.params.name, req.params.arguments || {}));
    return s;
}

async function atenderMcp(dep, req, res) {
    // Solo pedidos de servidor a servidor (claude.ai) o de clientes locales: un navegador de otra web no entra.
    const origen = req.headers.origin;
    if (origen && !/^https:\/\/(claude\.ai|claude\.com|rubikbolivia\.com)$/.test(origen) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origen)) {
        return res.status(403).json({ error: "Origen no permitido" });
    }
    const acceso = await OA.verificarAcceso(dep, CFG, req.headers.authorization);
    if (!acceso) {
        res.set("WWW-Authenticate", OA.wwwAuthenticate(CFG, req.headers.authorization ? "invalid_token" : null));
        return res.status(401).json({ error: "invalid_token", error_description: "Hace falta iniciar sesión en Rubik." });
    }
    if (req.method !== "POST") { res.set("Allow", "POST"); return res.status(405).json({ error: "Este servidor no abre streams GET: usá POST." }); }
    const { Transporte } = sdk();
    const servidor = crearServidorMcp(dep.almacen, acceso.uid);
    const transporte = new Transporte({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transporte.close().catch(() => {}); servidor.close().catch(() => {}); });
    await servidor.connect(transporte);
    req.auth = { token: "-", clientId: acceso.client_id, scopes: acceso.scopes, expiresAt: Math.floor(acceso.vence / 1000), extra: { uid: acceso.uid } };
    await transporte.handleRequest(req, res, req.body);
}

// ---------------------------------------------------------------- OAuth (HTTP)
function errorOAuth(res, e) {
    if (e instanceof OA.ErrorOAuth) return res.status(e.status).json({ error: e.error, error_description: e.descripcion });
    console.error("[rubikMcp] oauth", e);
    return res.status(500).json({ error: "server_error" });
}

function html(res, contenido, nonce, status) {
    res.set("Content-Security-Policy", P.csp(nonce));
    res.set("X-Frame-Options", "DENY");
    res.set("Referrer-Policy", "no-referrer");
    res.status(status || 200).type("html").send(contenido);
}

async function atender(dep, req, res) {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    const ruta = (req.path || "/").replace(/\/+$/, "") || "/";
    const meta = OA.metadatos(CFG);
    // CORS solo para los metadatos y el token (clientes basados en navegador, como el inspector de MCP)
    if (ruta.startsWith("/.well-known/") || ruta === "/oauth/token" || ruta === "/oauth/register" || ruta === "/oauth/revoke") {
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Protocol-Version");
        res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        if (req.method === "OPTIONS") return res.status(204).send("");
    }
    try {
        if (ruta === "/mcp") return await atenderMcp(dep, req, res);
        if (ruta === "/.well-known/oauth-protected-resource" || ruta === "/.well-known/oauth-protected-resource/mcp") return res.json(meta.recurso);
        if (ruta === "/.well-known/oauth-authorization-server" || ruta === "/.well-known/openid-configuration") return res.json(meta.servidor);
        if (ruta === "/oauth/register") {
            if (req.method !== "POST") return res.status(405).send("");
            return res.status(201).json(await OA.registrar(dep, req.body));
        }
        if (ruta === "/oauth/authorize") {
            const nonce = crypto.randomBytes(16).toString("base64");
            if (req.method === "GET") {
                try {
                    const r = await OA.iniciarAutorizacion(dep, CFG, req.query || {});
                    if (r.redirect) return res.redirect(302, r.redirect);
                    return html(res, P.login(Object.assign({ nonce }, r)), nonce);
                } catch (e) {
                    if (e instanceof OA.ErrorOAuth) return html(res, P.error({ texto: e.descripcion, nonce }), nonce, 400);
                    throw e;
                }
            }
            if (req.method === "POST") {
                // la pantalla manda JSON (mismo origen); se rechaza cualquier otro origen
                if (req.headers.origin && req.headers.origin !== BASE) return res.status(403).json({ error: "access_denied" });
                return res.json(await OA.completarAutorizacion(dep, CFG, req.body || {}));
            }
            return res.status(405).send("");
        }
        if (ruta === "/oauth/token") {
            if (req.method !== "POST") return res.status(405).send("");
            if (!/application\/x-www-form-urlencoded/.test(req.headers["content-type"] || "")) return res.status(415).json({ error: "invalid_request", error_description: "Usá application/x-www-form-urlencoded." });
            res.set("Pragma", "no-cache");
            return res.json(await OA.token(dep, CFG, req.body || {}));
        }
        if (ruta === "/oauth/revoke") {
            if (req.method !== "POST") return res.status(405).send("");
            return res.json(await OA.revocar(dep, req.body || {}));
        }
        if (ruta === "/oauth/ayuda") { const n = crypto.randomBytes(16).toString("base64"); return html(res, P.ayuda(n), n); }
        return res.status(404).json({ error: "No existe" });
    } catch (e) {
        return errorOAuth(res, e);
    }
}

function crearFuncion({ admin, esHub }) {
    const { onRequest } = require("firebase-functions/v2/https");
    let dep = null;
    return onRequest({ region: "us-central1", timeoutSeconds: 60, memory: "512MiB", invoker: "public", cors: false, concurrency: 20 }, async (req, res) => {
        dep = dep || dependencias(admin, esHub);
        await atender(dep, req, res);
    });
}

module.exports = { crearFuncion, atender, crearServidorMcp, CFG, RUTAS_MCP, INSTRUCCIONES };
