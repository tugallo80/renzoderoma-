/**
 * Servidor de autorización OAuth 2.1 del conector MCP "Rubik" (docs/sesiones/05-rubik-agente-app.md).
 * El login es con Firebase Auth (la cuenta de la app) y solo pasa quien está en /acceso/hub/{uid}.
 *
 * Lo que pide claude.ai (claude.com/docs/connectors/building/authentication):
 *   - 401 con WWW-Authenticate: Bearer resource_metadata="…" para empezar el login;
 *   - metadatos del recurso (RFC 9728) con resource = la URL exacta del conector, y del servidor (RFC 8414);
 *   - PKCE S256 siempre; cliente público (token_endpoint_auth_method "none");
 *   - identidad del cliente por Client ID Metadata Document (CIMD) o, si no, registro dinámico (RFC 7591);
 *   - redirect https://claude.ai/api/mcp/auth_callback (Claude Code: loopback en cualquier puerto);
 *   - refresh tokens rotativos e invalid_grant cuando no sirven.
 *
 * Todo es puro (sin HTTP): recibe un almacén (mcp_oauth/…) y dependencias inyectadas, así las pruebas lo simulan.
 * Los códigos y tokens se guardan solo como hash SHA-256: nunca en claro.
 */
const crypto = require("crypto");

const DURACION = {
    solicitud: 10 * 60 * 1000,          // pantalla de login abierta
    codigo: 5 * 60 * 1000,               // código de autorización (un solo uso)
    acceso: 60 * 60 * 1000,              // access token: 1 h
    refresco: 30 * 24 * 60 * 60 * 1000, // refresh token: 30 días, rotativo
};
const SCOPE = "rubik";
const RAIZ = "mcp_oauth";

const sha = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const azar = (n = 32) => crypto.randomBytes(n).toString("base64url");
const b64url = (buf) => Buffer.from(buf).toString("base64url");

class ErrorOAuth extends Error {
    constructor(error, descripcion, status) { super(descripcion || error); this.error = error; this.descripcion = descripcion; this.status = status || 400; }
}

// ---------------------------------------------------------------- redirect y clientes
/** Solo claude.ai (y claude.com) y loopback (Claude Code, pruebas): nada más puede recibir un código. */
function redirectPermitido(uri) {
    let u;
    try { u = new URL(String(uri)); } catch (e) { return false; }
    if (u.hash || u.username || u.password) return false;
    if (u.protocol === "https:" && ["claude.ai", "claude.com"].includes(u.hostname) && u.pathname === "/api/mcp/auth_callback" && !u.port) return true;
    if (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return true;
    return false;
}

/** Igualdad de redirect; en loopback se ignora el puerto (como dice la doc de Claude Code). */
function mismoRedirect(a, b) {
    if (a === b) return true;
    try {
        const x = new URL(a), y = new URL(b);
        const loop = (u) => u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
        return loop(x) && loop(y) && x.hostname === y.hostname && x.pathname === y.pathname && x.search === y.search;
    } catch (e) { return false; }
}

/** Hosts de los que se aceptan Client ID Metadata Documents (evita que la Function vaya a buscar URLs cualquiera). */
function hostCimdPermitido(url) {
    try {
        const u = new URL(url);
        if (u.protocol !== "https:" || u.port || u.hash || u.username) return false;
        return /(^|\.)claude\.(ai|com)$/.test(u.hostname) || /(^|\.)anthropic\.com$/.test(u.hostname);
    } catch (e) { return false; }
}

/**
 * Devuelve el cliente { client_id, redirect_uris, nombre, tipo } o tira invalid_client.
 * CIMD: client_id es una URL https; se trae el documento y se valida. DCR: client_id registrado en /register.
 */
async function obtenerCliente(dep, clientId) {
    const id = String(clientId || "");
    if (!id) throw new ErrorOAuth("invalid_client", "Falta client_id.");
    if (/^https:\/\//.test(id)) {
        if (!hostCimdPermitido(id)) throw new ErrorOAuth("invalid_client", "Este servidor solo acepta documentos de cliente de Claude; usá el registro dinámico.");
        const cache = await dep.almacen.leer(`${RAIZ}/cimd/${sha(id)}`);
        if (cache && cache.vence > dep.ahora()) return cache.cliente;
        let doc;
        try { doc = await dep.traerJson(id); } catch (e) { throw new ErrorOAuth("invalid_client", "No se pudo leer el documento del cliente."); }
        if (!doc || doc.client_id !== id) throw new ErrorOAuth("invalid_client", "El documento del cliente no coincide con su client_id.");
        const uris = (Array.isArray(doc.redirect_uris) ? doc.redirect_uris : []).map(String).filter(redirectPermitido);
        if (!uris.length) throw new ErrorOAuth("invalid_client", "El cliente no declara una redirect_uri permitida.");
        const cliente = { client_id: id, redirect_uris: uris, nombre: new URL(id).hostname, tipo: "cimd" };
        await dep.almacen.escribir(`${RAIZ}/cimd/${sha(id)}`, { cliente, vence: dep.ahora() + 60 * 60 * 1000 });
        return cliente;
    }
    if (!/^rbk_[A-Za-z0-9_-]{16,64}$/.test(id)) throw new ErrorOAuth("invalid_client", "client_id desconocido.");
    const c = await dep.almacen.leer(`${RAIZ}/clientes/${id}`);
    if (!c) throw new ErrorOAuth("invalid_client", "client_id desconocido.");
    return { client_id: id, redirect_uris: c.redirect_uris || [], nombre: c.nombre || "cliente", tipo: "dcr" };
}

/** Registro dinámico de clientes (RFC 7591): solo clientes públicos con redirect de Claude o loopback. */
async function registrar(dep, cuerpo) {
    const b = cuerpo || {};
    const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
    if (!uris.length || uris.length > 10) throw new ErrorOAuth("invalid_redirect_uri", "Hace falta redirect_uris (1 a 10).");
    const malas = uris.filter((u) => !redirectPermitido(u));
    if (malas.length) throw new ErrorOAuth("invalid_redirect_uri", "Solo se aceptan https://claude.ai/api/mcp/auth_callback y direcciones locales (loopback).");
    if (b.token_endpoint_auth_method && b.token_endpoint_auth_method !== "none") throw new ErrorOAuth("invalid_client_metadata", "Solo clientes públicos (token_endpoint_auth_method none).");
    const gt = b.grant_types || ["authorization_code", "refresh_token"];
    if (!Array.isArray(gt) || gt.some((g) => !["authorization_code", "refresh_token"].includes(g))) throw new ErrorOAuth("invalid_client_metadata", "grant_types: authorization_code y refresh_token.");
    const id = "rbk_" + azar(18);
    const nombre = String(b.client_name || "cliente").slice(0, 80);
    await dep.almacen.escribir(`${RAIZ}/clientes/${id}`, { redirect_uris: uris, nombre, creado: dep.ahora() });
    return {
        client_id: id, client_id_issued_at: Math.floor(dep.ahora() / 1000), client_name: nombre, redirect_uris: uris,
        token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: SCOPE,
    };
}

// ---------------------------------------------------------------- metadatos
function metadatos(cfg) {
    const base = cfg.base;
    return {
        servidor: {
            issuer: base,
            authorization_endpoint: `${base}/oauth/authorize`,
            token_endpoint: `${base}/oauth/token`,
            registration_endpoint: `${base}/oauth/register`,
            revocation_endpoint: `${base}/oauth/revoke`,
            response_types_supported: ["code"],
            response_modes_supported: ["query"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none"],
            revocation_endpoint_auth_methods_supported: ["none"],
            scopes_supported: [SCOPE],
            client_id_metadata_document_supported: true,
            service_documentation: `${base}/oauth/ayuda`,
        },
        recurso: {
            resource: cfg.recurso,
            authorization_servers: [base],
            scopes_supported: [SCOPE],
            bearer_methods_supported: ["header"],
            resource_name: "Rubik Bolivia",
        },
    };
}

function wwwAuthenticate(cfg, error) {
    return `Bearer resource_metadata="${cfg.base}/.well-known/oauth-protected-resource/mcp", scope="${SCOPE}"` + (error ? `, error="${error}"` : "");
}

// ---------------------------------------------------------------- /authorize
/**
 * GET /oauth/authorize: valida el pedido y guarda una "solicitud" (10 min) que la pantalla de login completa.
 * Errores de client_id o redirect_uri NO redirigen (se muestran); el resto vuelve al cliente con ?error=.
 */
async function iniciarAutorizacion(dep, cfg, q) {
    const cliente = await obtenerCliente(dep, q.client_id);
    const redirect = String(q.redirect_uri || "");
    if (!redirect || !redirectPermitido(redirect) || !cliente.redirect_uris.some((u) => mismoRedirect(u, redirect))) {
        throw new ErrorOAuth("invalid_request", "redirect_uri no registrada para este cliente.");
    }
    const volver = (error, descripcion) => ({ redirect: conParametros(redirect, { error, error_description: descripcion, state: q.state, iss: cfg.base }) });
    if (q.response_type !== "code") return volver("unsupported_response_type", "Solo response_type=code.");
    if (!q.code_challenge || q.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) return volver("invalid_request", "PKCE S256 obligatorio.");
    if (q.resource && q.resource !== cfg.recurso) return volver("invalid_target", "resource no es este servidor.");
    const scopes = String(q.scope || SCOPE).split(/\s+/).filter(Boolean);
    if (scopes.some((s) => s !== SCOPE && s !== "offline_access")) return volver("invalid_scope", `Scope admitido: ${SCOPE}.`);
    const id = azar(24);
    await dep.almacen.escribir(`${RAIZ}/solicitudes/${sha(id)}`, {
        client_id: cliente.client_id, cliente_nombre: cliente.nombre, redirect_uri: redirect, code_challenge: q.code_challenge,
        state: q.state ? String(q.state).slice(0, 500) : null, resource: cfg.recurso, scope: SCOPE, vence: dep.ahora() + DURACION.solicitud,
    });
    return { solicitud: id, cliente: cliente.nombre, redirectHost: new URL(redirect).host };
}

/**
 * POST /oauth/authorize: la pantalla manda el ID token de Firebase (el dueño ya entró) y su decisión.
 * Solo la lista blanca hub recibe un código.
 */
async function completarAutorizacion(dep, cfg, b) {
    const ruta = `${RAIZ}/solicitudes/${sha(String(b.solicitud || ""))}`;
    const sol = b.solicitud ? await dep.almacen.leer(ruta) : null;
    if (!sol || sol.vence < dep.ahora()) throw new ErrorOAuth("invalid_request", "El pedido de acceso venció. Volvé a conectar desde Claude.");
    await dep.almacen.borrar(ruta);   // un solo uso
    if (b.decision !== "permitir") return { redirect: conParametros(sol.redirect_uri, { error: "access_denied", state: sol.state, iss: cfg.base }) };
    let usuario;
    try { usuario = await dep.verificarIdToken(String(b.id_token || "")); } catch (e) { throw new ErrorOAuth("access_denied", "No se pudo verificar tu sesión. Volvé a entrar.", 401); }
    if (!usuario || !usuario.uid || !(await dep.esHub(usuario.uid))) {
        dep.log("[mcp-oauth] acceso negado (fuera de la lista blanca)");
        return { redirect: conParametros(sol.redirect_uri, { error: "access_denied", error_description: "Esta cuenta no tiene acceso a Rubik.", state: sol.state, iss: cfg.base }), negado: true };
    }
    const code = azar(32);
    await dep.almacen.escribir(`${RAIZ}/codigos/${sha(code)}`, {
        client_id: sol.client_id, redirect_uri: sol.redirect_uri, code_challenge: sol.code_challenge, resource: sol.resource, scope: sol.scope,
        uid: usuario.uid, vence: dep.ahora() + DURACION.codigo,
    });
    return { redirect: conParametros(sol.redirect_uri, { code, state: sol.state, iss: cfg.base }) };
}

function conParametros(uri, params) {
    const u = new URL(uri);
    Object.keys(params).forEach((k) => { if (params[k] != null && params[k] !== "") u.searchParams.set(k, params[k]); });
    return u.toString();
}

// ---------------------------------------------------------------- /token
async function emitirTokens(dep, datos, familia) {
    const acceso = azar(32), refresco = azar(32), ahora = dep.ahora();
    const fam = familia || azar(12);
    const comun = { uid: datos.uid, client_id: datos.client_id, resource: datos.resource, scope: datos.scope, familia: fam };
    await dep.almacen.escribir(`${RAIZ}/tokens/${sha(acceso)}`, Object.assign({ tipo: "acceso", vence: ahora + DURACION.acceso }, comun));
    await dep.almacen.escribir(`${RAIZ}/tokens/${sha(refresco)}`, Object.assign({ tipo: "refresco", vence: ahora + DURACION.refresco, acceso: sha(acceso) }, comun));
    if (!familia) await dep.almacen.escribir(`${RAIZ}/familias/${fam}`, { uid: datos.uid, client_id: datos.client_id, creada: ahora });
    await dep.almacen.actualizar(`${RAIZ}/familias/${fam}`, { ultimo_uso: ahora });
    return { access_token: acceso, token_type: "Bearer", expires_in: Math.round(DURACION.acceso / 1000), refresh_token: refresco, scope: datos.scope };
}

async function revocarFamilia(dep, fam) {
    if (!fam) return;
    await dep.almacen.actualizar(`${RAIZ}/familias/${fam}`, { revocada: dep.ahora() });
}

/**
 * Marca un código o refresh como usado en una transacción (un solo uso aunque lleguen dos pedidos a la vez).
 * Ojo con RTDB: la primera vuelta puede llegar con null aunque haya dato; devolver null hace que reintente con el valor real.
 */
async function marcarUsado(dep, ruta, sirve) {
    const marca = azar(8);
    const t = await dep.almacen.transaccion(ruta, (cur) => (cur == null ? null : sirve(cur) ? Object.assign({}, cur, { usado: marca }) : undefined));
    const mio = !!(t.ok && t.valor && t.valor.usado === marca);
    return { mio, valor: t.valor };
}

async function token(dep, cfg, b) {
    const gt = b.grant_type;
    if (gt === "authorization_code") {
        if (!b.code || !b.code_verifier) throw new ErrorOAuth("invalid_request", "Faltan code y code_verifier.");
        const ruta = `${RAIZ}/codigos/${sha(b.code)}`;
        // un solo uso, aunque lleguen dos pedidos a la vez
        const t = await marcarUsado(dep, ruta, (cur) => !cur.usado);
        const c = t.mio ? t.valor : null;
        if (!c || c.vence < dep.ahora()) throw new ErrorOAuth("invalid_grant", "Código inválido, vencido o ya usado.");
        await dep.almacen.borrar(ruta);
        if (b.client_id !== c.client_id) throw new ErrorOAuth("invalid_grant", "El código es de otro cliente.");
        if (!b.redirect_uri || !mismoRedirect(c.redirect_uri, String(b.redirect_uri))) throw new ErrorOAuth("invalid_grant", "redirect_uri distinta.");
        if (b.resource && b.resource !== c.resource) throw new ErrorOAuth("invalid_target", "resource no es este servidor.");
        if (b64url(crypto.createHash("sha256").update(String(b.code_verifier)).digest()) !== c.code_challenge) throw new ErrorOAuth("invalid_grant", "PKCE: code_verifier no corresponde.");
        if (!(await dep.esHub(c.uid))) throw new ErrorOAuth("invalid_grant", "La cuenta ya no tiene acceso.");
        return emitirTokens(dep, c, null);
    }
    if (gt === "refresh_token") {
        if (!b.refresh_token) throw new ErrorOAuth("invalid_request", "Falta refresh_token.");
        const ruta = `${RAIZ}/tokens/${sha(b.refresh_token)}`;
        const t = await marcarUsado(dep, ruta, (cur) => cur.tipo === "refresco" && !cur.usado);
        if (!t.mio) {
            // reutilizar un refresh ya rotado = posible robo: se corta toda la familia
            if (t.valor && t.valor.usado) { await revocarFamilia(dep, t.valor.familia); dep.log("[mcp-oauth] refresh reutilizado: familia revocada"); }
            throw new ErrorOAuth("invalid_grant", "refresh_token inválido.");
        }
        const r = t.valor;
        const fam = await dep.almacen.leer(`${RAIZ}/familias/${r.familia}`);
        if (r.vence < dep.ahora() || !fam || fam.revocada) throw new ErrorOAuth("invalid_grant", "refresh_token vencido o revocado.");
        if (b.client_id && b.client_id !== r.client_id) throw new ErrorOAuth("invalid_grant", "refresh_token de otro cliente.");
        if (b.resource && b.resource !== r.resource) throw new ErrorOAuth("invalid_target", "resource no es este servidor.");
        if (!(await dep.esHub(r.uid))) throw new ErrorOAuth("invalid_grant", "La cuenta ya no tiene acceso.");
        if (r.acceso) await dep.almacen.borrar(`${RAIZ}/tokens/${r.acceso}`);
        return emitirTokens(dep, r, r.familia);
    }
    throw new ErrorOAuth("unsupported_grant_type", "grant_type admitido: authorization_code o refresh_token.");
}

/** RFC 7009: revoca el token y toda su familia (el acceso y los refresh de esa conexión). Siempre 200. */
async function revocar(dep, b) {
    if (!b || !b.token) return {};
    const t = await dep.almacen.leer(`${RAIZ}/tokens/${sha(b.token)}`);
    if (t) await revocarFamilia(dep, t.familia);
    return {};
}

/**
 * Verifica el Bearer de cada pedido al MCP. Devuelve { uid, client_id, scopes, vence } o null (→ 401).
 * Revisa vencimiento, familia revocada, que el token sea para este recurso y que el usuario siga en la lista blanca.
 */
async function verificarAcceso(dep, cfg, header) {
    const m = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(String(header || "").trim());
    if (!m) return null;
    const t = await dep.almacen.leer(`${RAIZ}/tokens/${sha(m[1])}`);
    if (!t || t.tipo !== "acceso" || t.vence < dep.ahora() || t.resource !== cfg.recurso) return null;
    const fam = await dep.almacen.leer(`${RAIZ}/familias/${t.familia}`);
    if (!fam || fam.revocada) return null;
    if (!(await dep.esHub(t.uid))) return null;
    return { uid: t.uid, client_id: t.client_id, scopes: String(t.scope || SCOPE).split(" "), vence: t.vence };
}

module.exports = {
    ErrorOAuth, SCOPE, DURACION, sha, metadatos, wwwAuthenticate, redirectPermitido, mismoRedirect, hostCimdPermitido,
    obtenerCliente, registrar, iniciarAutorizacion, completarAutorizacion, token, revocar, verificarAcceso,
};
