// Pruebas del conector MCP "Rubik": login OAuth, herramientas y el flujo propuesta → confirmación.
// Firebase está SIMULADO (almacén en memoria, ID tokens falsos): no toca la base real ni gasta plata.
// Todos los datos son inventados (el repo es público).
// Uso: cd functions && npm install; cd ../tools/mcp && npm test
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { crearEntorno, tokenPara, PKCE } from './entorno.mjs';
const require = createRequire(import.meta.url);
const OA = require('../../functions/mcp/oauth.js');
const H = require('../../functions/mcp/herramientas.js');
const { acotar } = require('../../functions/agente/almacen.js');

const pruebas = [];
const prueba = (n, fn) => pruebas.push([n, fn]);
const llamar = async (ent, nombre, entrada, uid = 'renzo') => {
    const r = await H.llamar(ent.almacen, uid, nombre, entrada);
    const t = r.content[0].text;
    return { error: !!r.isError, texto: t, json: (() => { try { return JSON.parse(t); } catch (e) { return null; } })() };
};
const ok = async (ent, nombre, entrada) => { const r = await llamar(ent, nombre, entrada); assert.ok(!r.error, `${nombre}: ${r.texto}`); return r.json; };

// ------------------------------------------------------------------ OAuth
prueba('metadatos: recurso = URL exacta del conector, PKCE S256, CIMD y cliente público', async () => {
    const m = OA.metadatos({ base: 'https://rubikbolivia.com', recurso: 'https://rubikbolivia.com/mcp' });
    assert.equal(m.recurso.resource, 'https://rubikbolivia.com/mcp');
    assert.deepEqual(m.recurso.authorization_servers, ['https://rubikbolivia.com']);
    assert.deepEqual(m.servidor.code_challenge_methods_supported, ['S256']);
    assert.equal(m.servidor.client_id_metadata_document_supported, true);
    assert.ok(m.servidor.token_endpoint_auth_methods_supported.includes('none'));
});

prueba('registro dinámico: solo redirect de claude.ai o loopback', async () => {
    const ent = crearEntorno();
    const r = await OA.registrar(ent.dep, { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_name: 'Claude' });
    assert.match(r.client_id, /^rbk_/);
    await assert.rejects(OA.registrar(ent.dep, { redirect_uris: ['https://malo.example/cb'] }), /invalid_redirect_uri|Solo se aceptan/);
    await assert.rejects(OA.registrar(ent.dep, { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'client_secret_basic' }));
    assert.ok(OA.redirectPermitido('http://127.0.0.1:53111/callback'));
    assert.ok(!OA.redirectPermitido('https://claude.ai.malo.example/api/mcp/auth_callback'));
});

prueba('login completo: código → token → acceso; PKCE y un solo uso', async () => {
    const ent = crearEntorno();
    const cli = await OA.registrar(ent.dep, { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
    const pk = PKCE();
    const ini = await OA.iniciarAutorizacion(ent.dep, ent.cfg, { response_type: 'code', client_id: cli.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: pk.challenge, code_challenge_method: 'S256', state: 'xyz', resource: ent.cfg.recurso });
    assert.ok(ini.solicitud);
    const fin = await OA.completarAutorizacion(ent.dep, ent.cfg, { solicitud: ini.solicitud, decision: 'permitir', id_token: 'idtoken:renzo' });
    const u = new URL(fin.redirect);
    assert.equal(u.origin + u.pathname, 'https://claude.ai/api/mcp/auth_callback');
    assert.equal(u.searchParams.get('state'), 'xyz');
    assert.equal(u.searchParams.get('iss'), ent.cfg.base);
    const code = u.searchParams.get('code');
    // la solicitud es de un solo uso
    await assert.rejects(OA.completarAutorizacion(ent.dep, ent.cfg, { solicitud: ini.solicitud, decision: 'permitir', id_token: 'idtoken:renzo' }), /venció/);
    // verifier equivocado
    const base = { grant_type: 'authorization_code', code, client_id: cli.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', resource: ent.cfg.recurso };
    await assert.rejects(OA.token(ent.dep, ent.cfg, { ...base, code_verifier: 'x'.repeat(50) }), (e) => e.error === 'invalid_grant');
    // el código ya se gastó en el intento fallido: un código se usa una sola vez
    await assert.rejects(OA.token(ent.dep, ent.cfg, { ...base, code_verifier: pk.verifier }), (e) => e.error === 'invalid_grant');
    // de nuevo, bien
    const t = await tokenPara(ent, 'renzo', cli.client_id);
    assert.equal(t.token_type, 'Bearer');
    assert.equal(t.expires_in, 3600);
    const acc = await OA.verificarAcceso(ent.dep, ent.cfg, `Bearer ${t.access_token}`);
    assert.equal(acc.uid, 'renzo');
    // en la base solo quedan hashes
    assert.ok(!JSON.stringify(ent.almacen.datos.mcp_oauth).includes(t.access_token));
    assert.ok(!JSON.stringify(ent.almacen.datos.mcp_oauth).includes(t.refresh_token));
});

prueba('login: rechazo sin token, con token inválido, vencido y fuera de la lista blanca', async () => {
    const ent = crearEntorno();
    assert.equal(await OA.verificarAcceso(ent.dep, ent.cfg, undefined), null);
    assert.equal(await OA.verificarAcceso(ent.dep, ent.cfg, 'Bearer ' + 'a'.repeat(43)), null);
    // cuenta que no está en /acceso/hub: no recibe código
    const cli = await OA.registrar(ent.dep, { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
    const pk = PKCE();
    const ini = await OA.iniciarAutorizacion(ent.dep, ent.cfg, { response_type: 'code', client_id: cli.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: pk.challenge, code_challenge_method: 'S256' });
    const fin = await OA.completarAutorizacion(ent.dep, ent.cfg, { solicitud: ini.solicitud, decision: 'permitir', id_token: 'idtoken:intruso' });
    assert.equal(new URL(fin.redirect).searchParams.get('error'), 'access_denied');
    assert.equal(new URL(fin.redirect).searchParams.get('code'), null);
    // ID token falso
    const ini2 = await OA.iniciarAutorizacion(ent.dep, ent.cfg, { response_type: 'code', client_id: cli.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: pk.challenge, code_challenge_method: 'S256' });
    await assert.rejects(OA.completarAutorizacion(ent.dep, ent.cfg, { solicitud: ini2.solicitud, decision: 'permitir', id_token: 'cualquier-cosa' }), /verificar tu sesión/);
    // token bueno, pero vence
    const t = await tokenPara(ent, 'renzo', cli.client_id);
    ent.avanzar(61 * 60 * 1000);
    assert.equal(await OA.verificarAcceso(ent.dep, ent.cfg, `Bearer ${t.access_token}`), null);
    // token bueno, pero sacan al usuario de la lista blanca
    const t2 = await tokenPara(ent, 'renzo', cli.client_id);
    ent.almacen.datos.acceso.hub.renzo = false;
    assert.equal(await OA.verificarAcceso(ent.dep, ent.cfg, `Bearer ${t2.access_token}`), null);
});

prueba('authorize: redirect ajena, sin PKCE o resource de otro servidor', async () => {
    const ent = crearEntorno();
    const cli = await OA.registrar(ent.dep, { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
    const base = { response_type: 'code', client_id: cli.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: PKCE().challenge, code_challenge_method: 'S256' };
    await assert.rejects(OA.iniciarAutorizacion(ent.dep, ent.cfg, { ...base, redirect_uri: 'https://malo.example/cb' }), /redirect_uri/);
    assert.match((await OA.iniciarAutorizacion(ent.dep, ent.cfg, { ...base, code_challenge_method: 'plain' })).redirect, /error=invalid_request/);
    assert.match((await OA.iniciarAutorizacion(ent.dep, ent.cfg, { ...base, resource: 'https://otro.example/mcp' })).redirect, /error=invalid_target/);
    await assert.rejects(OA.iniciarAutorizacion(ent.dep, ent.cfg, { ...base, client_id: 'rbk_noexiste_noexiste_1' }), /client_id/);
});

prueba('CIMD: documento de Claude válido; host ajeno o client_id distinto se rechazan', async () => {
    const url = 'https://claude.ai/oauth/claude-code-client-metadata';
    const ent = crearEntorno({ documentos: { [url]: { client_id: url, client_name: 'Claude Code', redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' },
        'https://claude.ai/otro': { client_id: 'https://claude.ai/distinto', redirect_uris: ['http://localhost/callback'] } } });
    const ini = await OA.iniciarAutorizacion(ent.dep, ent.cfg, { response_type: 'code', client_id: url, redirect_uri: 'http://localhost:51234/callback', code_challenge: PKCE().challenge, code_challenge_method: 'S256' });
    assert.equal(ini.cliente, 'claude.ai');
    await assert.rejects(OA.obtenerCliente(ent.dep, 'https://malo.example/cliente.json'), /solo acepta/);
    await assert.rejects(OA.obtenerCliente(ent.dep, 'https://claude.ai/otro'), /no coincide/);
    assert.equal(ent.traidos.includes('https://malo.example/cliente.json'), false, 'no se va a buscar un host ajeno');
});

prueba('refresh: rota; reusar uno viejo corta toda la conexión; revocar', async () => {
    const ent = crearEntorno();
    const cli = await OA.registrar(ent.dep, { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
    const t1 = await tokenPara(ent, 'renzo', cli.client_id);
    const t2 = await OA.token(ent.dep, ent.cfg, { grant_type: 'refresh_token', refresh_token: t1.refresh_token, client_id: cli.client_id });
    assert.notEqual(t2.refresh_token, t1.refresh_token);
    assert.equal(await OA.verificarAcceso(ent.dep, ent.cfg, `Bearer ${t1.access_token}`), null, 'el acceso viejo se borra al rotar');
    assert.ok(await OA.verificarAcceso(ent.dep, ent.cfg, `Bearer ${t2.access_token}`));
    await assert.rejects(OA.token(ent.dep, ent.cfg, { grant_type: 'refresh_token', refresh_token: t1.refresh_token }), (e) => e.error === 'invalid_grant');
    assert.equal(await OA.verificarAcceso(ent.dep, ent.cfg, `Bearer ${t2.access_token}`), null, 'reuso → familia revocada');
    const t3 = await tokenPara(ent, 'renzo', cli.client_id);
    await OA.revocar(ent.dep, { token: t3.refresh_token });
    assert.equal(await OA.verificarAcceso(ent.dep, ent.cfg, `Bearer ${t3.access_token}`), null);
    await assert.rejects(OA.token(ent.dep, ent.cfg, { grant_type: 'refresh_token', refresh_token: t3.refresh_token }), (e) => e.error === 'invalid_grant');
});

// ------------------------------------------------------------------ herramientas
prueba('clientes y proyectos: crear, no duplicar, listar con estado y total', async () => {
    const ent = crearEntorno();
    const c = await ok(ent, 'crear_cliente', { nombre: 'Cervecería Demo', rubro: 'bebidas' });
    assert.equal(c.creado, true);
    const dup = await ok(ent, 'crear_cliente', { nombre: 'cerveceria demo' });
    assert.equal(dup.creado, false);
    assert.equal(dup.ya_existe.cid, c.cid);
    const l = await ok(ent, 'listar_clientes', { texto: 'cerve' });
    assert.ok(l.clientes.some((x) => x.cid === c.cid));
    const p = await ok(ent, 'crear_proyecto', { cid: c.cid, nombre: 'Stand feria demo', mes: '2026-11' });
    assert.equal(p.estado, 'cotizacion');
    assert.equal(ent.almacen.datos.proyectos[c.cid][p.pid].fecha_creacion, '2026-11-01T00:00:00.000Z');
    assert.equal((await ok(ent, 'crear_proyecto', { cid: c.cid, nombre: 'STAND FERIA DEMO' })).creado, false);
    const lp = await ok(ent, 'listar_proyectos', { cid: 'cliDemo' });
    const pd = lp.proyectos.find((x) => x.pid === 'proyDemo');
    assert.equal(pd.estado, 'produccion');
    assert.equal(pd.total, 1500);
    assert.equal(pd.fuera_del_total, 1);
    assert.equal((await llamar(ent, 'crear_proyecto', { cid: 'noexiste', nombre: 'X y' })).error, true);
});

prueba('ver_presupuesto: ítems con total y el APU de uno con su origen', async () => {
    const ent = crearEntorno();
    const r = await ok(ent, 'ver_presupuesto', { cid: 'cliDemo', pid: 'proyDemo', item: 'itExistente' });
    assert.equal(r.total, 1500);
    assert.equal(r.filas[0].capitulo, 'MOBILIARIO');
    assert.equal(r.detalle.desc, 'Mesa demo');
    assert.equal(r.detalle.mat[0][1], 'MDF 18 mm');
});

prueba('flujo de cotización: abrir → registrar lo del dueño → borrador con origen → aplicar solo con confirmación', async () => {
    const ent = crearEntorno();
    const ab = await ok(ent, 'abrir_cotizacion', { cid: 'cliDemo', pid: 'proyDemo', titulo: 'Mostrador demo' });
    assert.ok(ab.conv && ab.nueva);
    assert.match(ab.contexto, /Normas constructivas/);
    assert.match(ab.contexto, /Mesa demo/, 'el presupuesto actual va en el contexto para no duplicar');
    const C = { cid: 'cliDemo', pid: 'proyDemo', conv: ab.conv };
    // sin origen: rechazado por la misma validación del agente de la app
    const malo = await ok(ent, 'armar_borrador', { ...C, operaciones: [{ op: 'capitulo', nombre: 'Stand' }, { op: 'item', capitulo: 'Stand', desc: 'Mostrador', und: 'pza', cant: 1 }, { op: 'fila', item: 'Mostrador', tipo: 'mat', d: 'MDF', clave: 'MDF_18', q: 3 }] });
    assert.equal(malo.rechazadas.length, 1);
    assert.match(malo.rechazadas[0].motivo, /origen/);
    // dueño: inventado no vale
    const inv = await ok(ent, 'armar_borrador', { ...C, operaciones: [{ op: 'fila', item: 'Mostrador', tipo: 'mat', d: 'MDF', clave: 'MDF_18', q: 3, origen_q: 'dueño:-Kinventado' }] });
    assert.equal(inv.rechazadas.length, 1);
    const m = await ok(ent, 'registrar_mensaje_del_dueno', { ...C, texto: 'Van 3 planchas de MDF 18 para el mostrador' });
    assert.equal(m.origen, `dueño:${m.id}`);
    const b = await ok(ent, 'armar_borrador', { ...C, operaciones: [
        { op: 'fila', item: 'Mostrador', tipo: 'mat', d: 'MDF 18', clave: 'MDF_18', q: 3, origen_q: m.origen, p: 1 },
        { op: 'item', item: 'Mostrador', id: malo.borrador.capitulos[0].items[0].id, capitulo: 'Stand', desc: 'Mostrador', caracteristicas: [{ texto: 'Mostrador en MDF con acabado blanco' }] },
    ] });
    assert.equal(b.rechazadas.length, 0, JSON.stringify(b.rechazadas));
    const fila = b.borrador.capitulos[0].items[0].mat[0];
    assert.equal(fila[3], 250, 'el precio sale de la base aunque se mande otro');
    // el mensaje quedó en la conversación de la app
    const msgs = ent.almacen.datos.proyectos.cliDemo.proyDemo.agente.conversaciones[ab.conv].conversacion.mensajes;
    assert.equal(msgs[m.id].rol, 'dueno');
    assert.equal(msgs[m.id].via, 'claude');
    const vb = await ok(ent, 'ver_borrador', C);
    assert.ok(vb.total > 0);
    // aplicar sin confirmación o con un mensaje que no es del dueño: no
    assert.equal((await llamar(ent, 'aplicar_al_presupuesto', { ...C, confirmacion: 'dueño:-Knoexiste' })).error, true);
    assert.equal((await llamar(ent, 'aplicar_al_presupuesto', { ...C, confirmacion: 'aplicalo' })).error, true);
    assert.equal(ent.almacen.datos.proyectos.cliDemo.proyDemo.presupuesto.items.length, 3, 'nada cambió');
    const conf = await ok(ent, 'registrar_mensaje_del_dueno', { ...C, texto: 'Dale, aplicalo al presupuesto' });
    const ap = await ok(ent, 'aplicar_al_presupuesto', { ...C, confirmacion: conf.origen });
    assert.equal(ap.agregados, 1);
    const items = ent.almacen.datos.proyectos.cliDemo.proyDemo.presupuesto.items;
    assert.equal(items[0].desc, undefined); assert.equal(items[1].desc, 'Mesa demo', 'lo que había no se movió');
    const nuevo = items.find((x) => x.type === 'item' && x.origen === 'agente');
    assert.equal(nuevo.agente.conv, ab.conv);
    assert.equal(nuevo.feat, '• Mostrador en MDF con acabado blanco');
    // respaldo antes de aplicar
    const dia = Object.keys(ent.almacen.datos.respaldos_agente)[0];
    const resp = Object.values(ent.almacen.datos.respaldos_agente[dia])[0];
    assert.equal(JSON.parse(resp.antes).length, 3);
    // reaplicar: se actualiza en su lugar, no se duplica
    const ap2 = await ok(ent, 'aplicar_al_presupuesto', { ...C, confirmacion: conf.origen });
    assert.equal(ap2.agregados, 0); assert.equal(ap2.actualizados, 1);
    // retomar la conversación en el mismo chat
    const re = await ok(ent, 'abrir_cotizacion', { cid: 'cliDemo', pid: 'proyDemo', conv: ab.conv });
    assert.equal(re.nueva, false);
    assert.ok(re.borrador.total > 0);
});

prueba('lectura de un PDF del chat: su id sirve para citar una cota del plano', async () => {
    const ent = crearEntorno();
    const { conv } = await ok(ent, 'abrir_cotizacion', { cid: 'cliDemo', pid: 'proyDemo' });
    const C = { cid: 'cliDemo', pid: 'proyDemo', conv };
    const a = await ok(ent, 'registrar_lectura_de_archivo', { ...C, nombre: 'planos-demo.pdf', tipo: 'pdf', resumen: 'p.2: mostrador 1,80 m de frente' });
    const b = await ok(ent, 'armar_borrador', { ...C, operaciones: [{ op: 'capitulo', nombre: 'Stand' }, { op: 'item', capitulo: 'Stand', desc: 'Mostrador', und: 'pza' },
        { op: 'fila', item: 'Mostrador', tipo: 'mat', d: 'Canto', clave: 'CANTO_PVC', q: 1.8, origen_q: `cota_plano:${a.id} p.2 "1,80 m"` }] });
    assert.equal(b.rechazadas.length, 0, JSON.stringify(b.rechazadas));
    assert.equal(ent.almacen.datos.proyectos.cliDemo.proyDemo.agente.adjuntos[a.id].sin_archivo, true);
});

prueba('cada herramienta toca solo lo suyo: otro proyecto, otra conversación y nodos ajenos', async () => {
    const ent = crearEntorno();
    const { conv } = await ok(ent, 'abrir_cotizacion', { cid: 'cliDemo', pid: 'proyDemo' });
    // la conversación es de otro proyecto
    assert.equal((await llamar(ent, 'ver_borrador', { cid: 'cliDemo', pid: 'proyOtro', conv })).error, true);
    // la conversación "principal" (la del chat de la app) no se toca desde Claude
    assert.equal((await llamar(ent, 'ver_borrador', { cid: 'cliDemo', pid: 'proyDemo', conv: 'principal' })).error, true);
    // ids con caracteres raros
    assert.equal((await llamar(ent, 'ver_presupuesto', { cid: 'cliDemo/../x', pid: 'proyDemo' })).error, true);
    // el almacén acotado no deja salir de su lista
    const al = acotar(ent.almacen, H.RUTAS.agente('cliDemo', 'proyDemo'));
    await assert.rejects(al.leer('proyectos/cliDemo/proyDemo/pagos'), /no tiene acceso/);
    await assert.rejects(al.escribir('proyectos/cliDemo/proyOtro/agente/x', 1), /no tiene acceso/);
    await assert.rejects(acotar(ent.almacen, H.RUTAS.clientes()).leer('proyectos'), /no tiene acceso/);
    // la memoria no se borra desde Claude
    assert.equal((await llamar(ent, 'memoria', { accion: 'borrar', id: 'x' })).error, true);
    // entrada inválida
    const r = await llamar(ent, 'armar_borrador', { cid: 'cliDemo', pid: 'proyDemo', conv, operaciones: 'no' });
    assert.match(r.texto, /entrada_invalida/);
    // nadie escribió en pagos ni en otro proyecto
    assert.deepEqual(ent.almacen.datos.proyectos.cliDemo.proyDemo.pagos, { a: { monto: 1 } });
});

prueba('buscar_base y guardar_en_base: lo mismo que el agente, con la confirmación del dueño', async () => {
    const ent = crearEntorno();
    const r = await ok(ent, 'buscar_base', { texto: 'mdf' });
    assert.equal(r.resultados[0].origen, 'base:materiales/MDF_18');
    const { conv } = await ok(ent, 'abrir_cotizacion', { cid: 'cliDemo', pid: 'proyDemo' });
    const C = { cid: 'cliDemo', pid: 'proyDemo', conv };
    assert.equal((await llamar(ent, 'guardar_en_base', { ...C, nodo: 'materiales', clave: 'LONA_DEMO', datos: { n: 'Lona demo', u: 'm2', p: 30 }, confirmacion: 'dueño:-Knada' })).error, true);
    const m = await ok(ent, 'registrar_mensaje_del_dueno', { ...C, texto: 'Guardá la lona demo a 30 Bs el m2' });
    const g = await ok(ent, 'guardar_en_base', { ...C, nodo: 'materiales', clave: 'LONA_DEMO', datos: { n: 'Lona demo', u: 'm2', p: 30 }, confirmacion: m.origen });
    assert.equal(g.origen, 'base:materiales/LONA_DEMO');
    assert.ok(Object.values(ent.almacen.datos.base_datos.historial_cambios).some((h) => h.ruta === 'base_datos/materiales/LONA_DEMO'));
});

prueba('las definiciones: nombres únicos, esquemas de objeto y anotaciones de solo lectura', async () => {
    const d = H.definiciones();
    assert.equal(new Set(d.map((x) => x.name)).size, d.length);
    d.forEach((x) => { assert.equal(x.inputSchema.type, 'object', x.name); assert.ok(x.description.length > 20, x.name); });
    assert.equal(d.find((x) => x.name === 'listar_clientes').annotations.readOnlyHint, true);
    assert.equal(d.find((x) => x.name === 'aplicar_al_presupuesto').annotations.readOnlyHint, false);
    assert.ok(!d.find((x) => x.name === 'memoria').inputSchema.properties.accion.enum.includes('borrar'));
});

prueba('skill cotizar-en-rubik: frontmatter válido y el ZIP publicado igual a la carpeta', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { execFileSync } = await import('node:child_process');
    const dir = new URL('../../skills/cotizar-en-rubik/', import.meta.url).pathname;
    const md = readFileSync(dir + 'SKILL.md', 'utf8');
    const fm = /^---\nname: ([^\n]+)\ndescription: ([^\n]+)\n---\n/.exec(md);
    assert.ok(fm, 'frontmatter');
    assert.equal(fm[1], 'cotizar-en-rubik');
    assert.ok(/^[a-z0-9-]{1,64}$/.test(fm[1]));
    assert.ok(fm[2].length <= 1024);
    assert.ok(md.split('\n').length < 500);
    // todas las herramientas que nombra el skill existen
    const nombres = H.definiciones().map((d) => d.name);
    const citadas = [...readFileSync(dir + 'referencias/herramientas.md', 'utf8').matchAll(/\*\*`([a-z_0-9]+)`\*\*/g)].map((m) => m[1]);
    citadas.forEach((n) => assert.ok(nombres.includes(n), 'el skill nombra ' + n));
    nombres.forEach((n) => assert.ok(citadas.includes(n), 'falta documentar ' + n + ' en el skill'));
    const zip = new URL('../../public/downloads/cotizar-en-rubik.zip', import.meta.url).pathname;
    const archivos = [];
    (function rec(d, rel) { readdirSync(d).forEach((f) => { const p = d + f; if (statSync(p).isDirectory()) rec(p + '/', rel + f + '/'); else archivos.push(rel + f); }); })(dir, 'cotizar-en-rubik/');
    archivos.forEach((f) => assert.equal(execFileSync('unzip', ['-p', zip, f]).toString(), readFileSync(dir + f.slice('cotizar-en-rubik/'.length), 'utf8'), `${f}: regenerá el ZIP con npm run skill`));
});

// ------------------------------------------------------------------ correr
let bien = 0;
for (const [n, fn] of pruebas) {
    try { await fn(); bien++; console.log('ok  ', n); }
    catch (e) { console.log('FALLA', n, '\n', e); process.exitCode = 1; }
}
console.log(`\n${bien}/${pruebas.length} pruebas OK`);
