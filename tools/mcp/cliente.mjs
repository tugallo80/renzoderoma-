// Cliente MCP de prueba: levanta el conector en un puerto local con Firebase SIMULADO, hace el login OAuth por HTTP
// (registro dinámico → pantalla de login → código → token, como claude.ai) y con el SDK oficial de MCP lista las
// herramientas y llama a algunas. No toca la base real ni gasta plata.
// Uso: cd functions && npm install; cd ../tools/mcp && npm run cliente
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { crearEntorno, PKCE } from './entorno.mjs';
const require = createRequire(import.meta.url);
const fn = createRequire(new URL('../../functions/package.json', import.meta.url));
const express = fn('express');
const { Client } = fn('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = fn('@modelcontextprotocol/sdk/client/streamableHttp.js');
const MCP = require('../../functions/mcp/index.js');

const ent = crearEntorno();
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));
app.use((req, res) => MCP.atender(ent.dep, req, res).catch((e) => { console.error(e); res.status(500).end(); }));
const servidor = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
const URLBASE = `http://127.0.0.1:${servidor.address().port}`;
const ir = (p, op) => fetch(URLBASE + p, Object.assign({ redirect: 'manual' }, op));
const MCP_URL = `${URLBASE}/mcp`;
let pasos = 0;
const paso = (t) => console.log(`ok   ${++pasos}. ${t}`);

try {
    // 1. sin token: 401 con el puntero a los metadatos (lo que dispara el login en claude.ai)
    let r = await ir('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
    assert.equal(r.status, 401);
    const www = r.headers.get('www-authenticate');
    assert.match(www, /resource_metadata="https:\/\/rubikbolivia\.com\/\.well-known\/oauth-protected-resource\/mcp"/);
    paso('sin token → 401 + WWW-Authenticate');
    r = await ir('/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + 'x'.repeat(43), 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 401); assert.match(r.headers.get('www-authenticate'), /invalid_token/);
    paso('token inventado → 401 invalid_token');

    // 2. descubrimiento
    const prm = await (await ir('/.well-known/oauth-protected-resource/mcp')).json();
    assert.equal(prm.resource, 'https://rubikbolivia.com/mcp');
    const asm = await (await ir('/.well-known/oauth-authorization-server')).json();
    assert.deepEqual(asm.code_challenge_methods_supported, ['S256']);
    paso('metadatos RFC 9728 y RFC 8414');

    // 3. registro dinámico
    r = await ir('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_name: 'prueba' }) });
    assert.equal(r.status, 201);
    const cli = await r.json();
    paso('registro dinámico ' + cli.client_id.slice(0, 8) + '…');

    // 4. pantalla de login (HTML con CSP) → el navegador manda el ID token de Firebase (simulado) → código
    const pk = PKCE();
    const q = new URLSearchParams({ response_type: 'code', client_id: cli.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: pk.challenge, code_challenge_method: 'S256', state: 'st1', scope: 'rubik', resource: 'https://rubikbolivia.com/mcp' });
    r = await ir('/oauth/authorize?' + q);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const html = await r.text();
    const solicitud = /var SOL="([^"]+)"/.exec(html)[1];
    r = await ir('/oauth/authorize', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://otra.example' }, body: JSON.stringify({ solicitud, decision: 'permitir', id_token: 'idtoken:renzo' }) });
    assert.equal(r.status, 403);
    r = await ir('/oauth/authorize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ solicitud, decision: 'permitir', id_token: 'idtoken:renzo' }) });
    const vuelta = new URL((await r.json()).redirect);
    assert.equal(vuelta.searchParams.get('state'), 'st1');
    paso('login con la cuenta hub → código para claude.ai');

    // 5. token (form-urlencoded; JSON da 415)
    const form = { grant_type: 'authorization_code', code: vuelta.searchParams.get('code'), code_verifier: pk.verifier, client_id: cli.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', resource: 'https://rubikbolivia.com/mcp' };
    r = await ir('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    assert.equal(r.status, 415);
    r = await ir('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
    assert.equal(r.status, 200);
    const tok = await r.json();
    paso('token (expira en ' + tok.expires_in + ' s, con refresh)');

    // 6. cliente MCP oficial
    const cliente = new Client({ name: 'cliente-prueba-rubik', version: '1.0.0' });
    await cliente.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers: { Authorization: `Bearer ${tok.access_token}` } } }));
    assert.match(cliente.getInstructions() || '', /Un ítem es lo que se entrega/);
    const { tools } = await cliente.listTools();
    console.log('     herramientas:', tools.map((t) => t.name).join(', '));
    assert.ok(tools.length >= 15);
    paso('initialize + tools/list');

    const json = (res) => { assert.ok(!res.isError, res.content[0].text); return JSON.parse(res.content[0].text); };
    const clientes = json(await cliente.callTool({ name: 'listar_clientes', arguments: {} }));
    assert.equal(clientes.clientes[0].cid, 'cliDemo');
    const proys = json(await cliente.callTool({ name: 'listar_proyectos', arguments: { cid: 'cliDemo' } }));
    console.log('     proyectos:', proys.proyectos.map((p) => `${p.nombre} (${p.estado}, Bs ${p.total})`).join(' · '));
    const ab = json(await cliente.callTool({ name: 'abrir_cotizacion', arguments: { cid: 'cliDemo', pid: 'proyDemo', titulo: 'Prueba del cliente MCP' } }));
    const C = { cid: 'cliDemo', pid: 'proyDemo', conv: ab.conv };
    const m = json(await cliente.callTool({ name: 'registrar_mensaje_del_dueno', arguments: { ...C, texto: 'Un letrero de 2 m de canto PVC' } }));
    const b = json(await cliente.callTool({ name: 'armar_borrador', arguments: { ...C, operaciones: [
        { op: 'capitulo', nombre: 'Letreros' }, { op: 'item', capitulo: 'Letreros', desc: 'Letrero demo', und: 'pza', caracteristicas: [{ texto: 'Letrero con canto blanco' }] },
        { op: 'fila', item: 'Letrero demo', tipo: 'mat', d: 'Canto', clave: 'CANTO_PVC', q: 2, origen_q: m.origen }] } }));
    assert.equal(b.rechazadas.length, 0, JSON.stringify(b.rechazadas));
    console.log('     borrador: total Bs', b.borrador.total);
    const malo = await cliente.callTool({ name: 'aplicar_al_presupuesto', arguments: { ...C, confirmacion: 'dueño:-Kfalso' } });
    assert.equal(malo.isError, true);
    paso('listar_clientes, listar_proyectos, abrir_cotizacion, registrar_mensaje_del_dueno, armar_borrador; aplicar sin confirmación → error');

    // 7. GET al MCP: 405 (no hay stream de servidor)
    // imagen en el resultado (sesión 6): llega como bloque image por el SDK real
    const img = await cliente.callTool({ name: 'prueba_imagen', arguments: {} });
    assert.ok(!img.isError);
    assert.deepEqual(img.content.map((c) => c.type), ['text', 'image']);
    assert.equal(img.content[1].mimeType, 'image/png');
    assert.equal(Buffer.from(img.content[1].data, 'base64').subarray(1, 4).toString(), 'PNG');
    paso('prueba_imagen → texto + imagen PNG');

    r = await ir('/mcp', { headers: { Authorization: `Bearer ${tok.access_token}`, Accept: 'text/event-stream' } });
    assert.equal(r.status, 405);
    paso('GET /mcp → 405');

    // 8. revocado: el mismo token ya no entra
    await ir('/oauth/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tok.access_token }) });
    await assert.rejects(cliente.listTools());
    paso('token revocado → sin acceso');
    await cliente.close().catch(() => {});
    console.log(`\nCliente MCP: ${pasos} pasos OK`);
} catch (e) {
    console.error('FALLA', e); process.exitCode = 1;
} finally {
    servidor.close();
}
