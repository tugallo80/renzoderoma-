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
const AG = require('../../functions/agente/herramientas.js');

/** Una cotización vieja hecha en el chat de la app (conversación "principal") y aplicada al presupuesto. */
async function cotizacionViejaDeLaApp(ent) {
    const raiz = 'proyectos/cliDemo/proyDemo/agente';
    await ent.almacen.escribir(`${raiz}/conversacion/mensajes/-Kapp1`, { rol: 'dueno', texto: 'Stand con mostrador de melamina 18 mm, 2 planchas, con masillado y pintura', fecha: ent.almacen.ahora() });
    const ctx = { almacen: acotar(ent.almacen, H.RUTAS.agente('cliDemo', 'proyDemo')), cid: 'cliDemo', pid: 'proyDemo', uid: 'renzo', mensajesAgente: [] };
    const armar = AG.HERRAMIENTAS.find((h) => h.def.name === 'armar_borrador');
    const r = await armar.correr(ctx, { operaciones: [
        { op: 'capitulo', nombre: 'Stand' },
        { op: 'item', capitulo: 'Stand', desc: 'Mostrador', und: 'pza', caracteristicas: [{ texto: 'Mostrador con acabado pintado' }] },
        { op: 'fila', item: 'Mostrador', tipo: 'mat', d: 'Melamina 18', clave: 'MDF_18', q: 2, origen_q: 'dueño:-Kapp1' },
        { op: 'fila', item: 'Mostrador', tipo: 'mo', d: 'Masillado y pintura', clave: 'CARPINTERIA', q: 2, origen_q: 'dueño:-Kapp1' },
    ] });
    assert.equal(r.rechazadas.length, 0, JSON.stringify(r.rechazadas));
    const conf = await ok(ent, 'registrar_mensaje_del_dueno', { cid: 'cliDemo', pid: 'proyDemo', conv: 'principal', texto: 'aplicalo' });
    const ap = await ok(ent, 'aplicar_al_presupuesto', { cid: 'cliDemo', pid: 'proyDemo', conv: 'principal', confirmacion: conf.origen });
    assert.equal(ap.agregados, 1);
    const items = ent.almacen.datos.proyectos.cliDemo.proyDemo.presupuesto.items;
    return { n: items.findIndex((x) => x.desc === 'Mostrador'), item: items.find((x) => x.desc === 'Mostrador') };
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push([n, fn]);
const llamar = async (ent, nombre, entrada, uid = 'renzo') => {
    const r = await H.llamar(ent.almacen, uid, nombre, entrada);
    const t = r.content[0].text;
    return { error: !!r.isError, texto: t, json: (() => { try { return JSON.parse(t); } catch (e) { return null; } })() };
};
const r2 = (x) => Math.round(x * 100) / 100;
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
    // "principal" solo existe si el chat de la app tiene algo (acá no)
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

prueba('ajustar una cotización vieja: listar_cotizaciones y retomar la conversación principal desde un ítem', async () => {
    const ent = crearEntorno();
    const { n, item } = await cotizacionViejaDeLaApp(ent);
    assert.equal(item.agente.conv, 'principal');
    const nueva = await ok(ent, 'abrir_cotizacion', { cid: 'cliDemo', pid: 'proyDemo', titulo: 'Otra cosa' });
    const l = await ok(ent, 'listar_cotizaciones', { cid: 'cliDemo', pid: 'proyDemo' });
    const pr = l.cotizaciones.find((c) => c.conv === 'principal');
    assert.ok(pr, 'la principal aparece aunque no tenga meta');
    assert.equal(pr.items_en_presupuesto[0].desc, 'Mostrador');
    assert.equal(pr.aplicado.version, pr.borrador.version);
    assert.equal(l.cotizaciones.find((c) => c.conv === nueva.conv).origen, 'Claude');
    // retomar desde el ítem del presupuesto (por posición y por id)
    const ab = await ok(ent, 'abrir_cotizacion', { cid: 'cliDemo', pid: 'proyDemo', item: String(n) });
    assert.equal(ab.conv, 'principal');
    assert.equal(ab.nueva, false);
    assert.equal(ab.item_en_foco.desc, 'Mostrador');
    assert.equal((await ok(ent, 'abrir_cotizacion', { cid: 'cliDemo', pid: 'proyDemo', item: item.id })).conv, 'principal');
    assert.ok(ab.ultimos_mensajes.some((m) => m.id === '-Kapp1'));
    // un ítem cargado a mano no tiene conversación
    assert.match((await llamar(ent, 'abrir_cotizacion', { cid: 'cliDemo', pid: 'proyDemo', item: 'itExistente' })).texto, /no lo creó el Agente/);
    // corregir en el lugar: el agente de la app se entera en su próximo turno
    const m = await ok(ent, 'registrar_mensaje_del_dueno', { cid: 'cliDemo', pid: 'proyDemo', conv: 'principal', texto: 'sin masillado ni pintura' });
    const b = await ok(ent, 'armar_borrador', { cid: 'cliDemo', pid: 'proyDemo', conv: 'principal', operaciones: [{ op: 'quitar', item: item.id, tipo: 'mo', fila: 1 }] });
    assert.equal(b.aplicadas, 1);
    const ed = Object.values(ent.almacen.datos.proyectos.cliDemo.proyDemo.agente.conversacion.ediciones);
    assert.match(ed[0].texto, /^Desde Claude: 1 cambios/);
    // y una conversación que no existe sigue rechazada
    assert.equal((await llamar(ent, 'ver_borrador', { cid: 'cliDemo', pid: 'proyOtro', conv: 'principal' })).error, true);
    void m;
});

prueba('versión económica: copia aparte, aplicar entra aparte y apagar la anterior solo con propuesta → confirmación', async () => {
    const ent = crearEntorno();
    const { item } = await cotizacionViejaDeLaApp(ent);
    const P = { cid: 'cliDemo', pid: 'proyDemo' };
    const totalAntes = (await ok(ent, 'ver_presupuesto', P)).total;
    const v = await ok(ent, 'nueva_version', { ...P, conv: 'principal', titulo: 'Versión 2 – económica' });
    assert.notEqual(v.conv, 'principal');
    const it2 = v.borrador.capitulos[0].items[0];
    assert.notEqual(it2.id, item.id, 'ids nuevos: al aplicar entra aparte');
    assert.equal(v.borrador.capitulos[0].nombre, 'Stand (Versión 2 – económica)');
    const C = { ...P, conv: v.conv };
    // la versión anterior quedó intacta
    assert.equal(ent.almacen.datos.proyectos.cliDemo.proyDemo.agente.borrador.capitulos[0].items[0].id, item.id);
    // los orígenes dueño: de la versión anterior siguen valiendo en la copia
    const b = await ok(ent, 'armar_borrador', { ...C, operaciones: [{ op: 'fila', item: it2.id, tipo: 'mat', d: 'MDF 18', clave: 'MDF_18', q: 2, origen_q: 'dueño:-Kapp1', reemplaza: 1 }, { op: 'quitar', item: it2.id, tipo: 'mo', fila: 1 }] });
    assert.equal(b.rechazadas.length, 0, JSON.stringify(b.rechazadas));
    // el "aplicalo" copiado de la versión anterior no sirve: hay que confirmar de nuevo
    const copiado = Object.entries(ent.almacen.datos.proyectos.cliDemo.proyDemo.agente.conversaciones[v.conv].conversacion.mensajes).find(([, m]) => m.texto === 'aplicalo')[0];
    assert.match((await llamar(ent, 'aplicar_al_presupuesto', { ...C, confirmacion: `dueño:${copiado}` })).texto, /versión anterior/);
    const si = await ok(ent, 'registrar_mensaje_del_dueno', { ...C, texto: 'aplicá la económica' });
    const ap = await ok(ent, 'aplicar_al_presupuesto', { ...C, confirmacion: si.origen });
    assert.equal(ap.agregados, 1);
    assert.equal(ap.version_anterior.conv, 'principal');
    assert.deepEqual(ap.version_anterior.items_prendidos.map((x) => x.desc), ['Mostrador']);
    const items = () => ent.almacen.datos.proyectos.cliDemo.proyDemo.presupuesto.items;
    assert.equal(items().filter((x) => x.desc === 'Mostrador').length, 2, 'las dos versiones en el presupuesto');
    // paso 1: propuesta, no cambia nada
    const vieja = items().find((x) => x.id === item.id);
    const pr = await ok(ent, 'proponer_apagar_items', { ...P, items: [item.id], motivo: 'reemplazado por la Versión 2 – económica' });
    assert.ok(pr.propuesta);
    assert.equal(items().find((x) => x.id === item.id).activo, undefined, 'la propuesta no cambia nada');
    assert.ok(pr.efecto_en_total < 0);
    // una respuesta anterior a la propuesta no la confirma
    assert.match((await llamar(ent, 'confirmar_propuesta', { ...C, propuesta: pr.propuesta, confirmacion: si.origen })).texto, /posterior a la propuesta/);
    assert.match((await llamar(ent, 'confirmar_propuesta', { ...C, propuesta: pr.propuesta, confirmacion: 'dueño:-Kinventado' })).texto, /confirmación del dueño/);
    // paso 2: con el sí del dueño
    const dale = await ok(ent, 'registrar_mensaje_del_dueno', { ...C, texto: 'sí, apagá la versión anterior' });
    const cf = await ok(ent, 'confirmar_propuesta', { ...C, propuesta: pr.propuesta, confirmacion: dale.origen });
    assert.equal(cf.cambiados, 1);
    assert.equal(items().find((x) => x.id === item.id).activo, false, 'apagado, no borrado');
    assert.ok(items().some((x) => x.id === item.id));
    const nueva = items().find((x) => x.agente && x.agente.conv === v.conv && x.type === 'item');
    assert.equal(cf.total, r2(totalAntes - vieja.pu * vieja.cant + nueva.pu * nueva.cant), 'el total ya no suma la versión anterior');
    // respaldo del presupuesto antes de apagar
    const resp = Object.values(Object.values(ent.almacen.datos.respaldos_agente).pop()).find((x) => /confirmar_propuesta/.test(x.motivo));
    assert.ok(JSON.parse(resp.antes).find((x) => x.id === item.id).activo !== false);
    // un solo uso; y el mismo sí no confirma otra propuesta
    assert.match((await llamar(ent, 'confirmar_propuesta', { ...C, propuesta: pr.propuesta, confirmacion: dale.origen })).texto, /ya está aplicada/);
    const pr2 = await ok(ent, 'proponer_apagar_items', { ...P, items: [item.id], accion: 'prender', motivo: 'volver atrás' });
    assert.match((await llamar(ent, 'confirmar_propuesta', { ...C, propuesta: pr2.propuesta, confirmacion: dale.origen })).texto, /posterior|ya confirmó/);
    // se puede volver a prender, con otra confirmación
    const otra = await ok(ent, 'registrar_mensaje_del_dueno', { ...C, texto: 'prendela de nuevo' });
    await ok(ent, 'confirmar_propuesta', { ...C, propuesta: pr2.propuesta, confirmacion: otra.origen });
    assert.equal(items().find((x) => x.id === item.id).activo, true);
    // listar_cotizaciones muestra de qué versión salió
    const l = await ok(ent, 'listar_cotizaciones', P);
    assert.equal(l.cotizaciones.find((c) => c.conv === v.conv).basada_en, 'principal');
});

prueba('propuesta: si el presupuesto cambió desde la propuesta, no se aplica', async () => {
    const ent = crearEntorno();
    const { conv } = await ok(ent, 'abrir_cotizacion', { cid: 'cliDemo', pid: 'proyDemo' });
    const C = { cid: 'cliDemo', pid: 'proyDemo', conv };
    const pr = await ok(ent, 'proponer_apagar_items', { cid: 'cliDemo', pid: 'proyDemo', items: ['1'], motivo: 'prueba' });
    assert.equal((await ok(ent, 'proponer_apagar_items', { cid: 'cliDemo', pid: 'proyDemo', items: ['2'], motivo: 'ya apagado' })).propuesta, null);
    // el dueño movió ítems en la app
    ent.almacen.datos.proyectos.cliDemo.proyDemo.presupuesto.items.splice(1, 0, { type: 'item', desc: 'Nuevo a mano', cant: 1, pu: 10 });
    const si = await ok(ent, 'registrar_mensaje_del_dueno', { ...C, texto: 'sí' });
    assert.match((await llamar(ent, 'confirmar_propuesta', { ...C, propuesta: pr.propuesta, confirmacion: si.origen })).texto, /cambió/);
    assert.equal(ent.almacen.datos.proyectos.cliDemo.proyDemo.presupuesto.items[2].activo, undefined, 'nada se apagó');
});

prueba('si el Agente IA de la app está trabajando en esa conversación, Claude no escribe', async () => {
    const ent = crearEntorno();
    const { conv } = await ok(ent, 'abrir_cotizacion', { cid: 'cliDemo', pid: 'proyDemo' });
    const C = { cid: 'cliDemo', pid: 'proyDemo', conv };
    ent.almacen.datos.proyectos.cliDemo.proyDemo.agente.estado = { fase: 'trabajando', actualizado: ent.almacen.ahora(), conv };
    assert.match((await llamar(ent, 'registrar_mensaje_del_dueno', { ...C, texto: 'hola' })).texto, /trabajando/);
    assert.equal((await llamar(ent, 'ver_borrador', C)).error, false, 'leer sí');
    ent.almacen.avanzar(11 * 60 * 1000);   // un turno colgado más de 10 min no bloquea
    assert.equal((await llamar(ent, 'registrar_mensaje_del_dueno', { ...C, texto: 'hola' })).error, false);
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

// ------------------------------------------------------------------ imágenes (sesión 6)
prueba('prueba_imagen: devuelve texto + PNG válido con el código dibujado, sin tocar la base', async () => {
    const ent = crearEntorno();
    const antes = JSON.stringify(ent.almacen.datos);
    const r = await H.llamar(ent.almacen, 'renzo', 'prueba_imagen', {});
    assert.ok(!r.isError, JSON.stringify(r));
    assert.equal(r.content.length, 2);
    assert.equal(r.content[0].type, 'text');
    assert.equal(r.content[1].type, 'image');
    assert.equal(r.content[1].mimeType, 'image/png');
    const buf = Buffer.from(r.content[1].data, 'base64');
    assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // CRC de cada bloque y decodificación de los píxeles
    const IMG = require('../../functions/mcp/imagen.js');
    const zlib = require('zlib');
    let p = 8, idat = [], ancho = 0, alto = 0;
    while (p < buf.length) {
        const n = buf.readUInt32BE(p), tipo = buf.toString('ascii', p + 4, p + 8), datos = buf.subarray(p + 8, p + 8 + n);
        assert.equal(buf.readUInt32BE(p + 8 + n), IMG.crc32(buf.subarray(p + 4, p + 8 + n)), 'CRC de ' + tipo);
        if (tipo === 'IHDR') { ancho = datos.readUInt32BE(0); alto = datos.readUInt32BE(4); }
        if (tipo === 'IDAT') idat.push(datos);
        p += 12 + n;
    }
    const filas = zlib.inflateSync(Buffer.concat(idat));
    assert.equal(filas.length, (ancho * 3 + 1) * alto);
    const px = (x, y) => [...filas.subarray(y * (ancho * 3 + 1) + 1 + x * 3, y * (ancho * 3 + 1) + 1 + x * 3 + 3)];
    assert.deepEqual(px(5, 5), [220, 30, 30]);          // arriba izquierda: rojo
    assert.deepEqual(px(ancho - 5, 5), [30, 170, 60]);  // arriba derecha: verde
    // el código no viaja en el texto
    assert.ok(!/\b\d{4}\b(?! caracteres)/.test(r.content[0].text.replace(/\d+×\d+|\d+ KB|\d+ caracteres/g, '')));
    // hay cifras dibujadas (píxeles oscuros en la zona del número)
    let oscuros = 0; for (let y = 110; y < 250; y++) for (let x = 140; x < 600; x++) if (px(x, y)[0] < 50) oscuros++;
    assert.ok(oscuros > 2000);
    assert.equal(JSON.stringify(ent.almacen.datos), antes);
});

prueba('prueba_imagen: peso_kb agranda la imagen y se acota; entrada inválida se rechaza', async () => {
    const ent = crearEntorno();
    const chica = await H.llamar(ent.almacen, 'renzo', 'prueba_imagen', {});
    const grande = await H.llamar(ent.almacen, 'renzo', 'prueba_imagen', { peso_kb: 100 });
    const kb = (r) => Buffer.from(r.content[1].data, 'base64').length / 1024;
    assert.ok(kb(chica) < 10, 'chica: ' + kb(chica));
    assert.ok(kb(grande) > 95 && kb(grande) < 110, 'grande: ' + kb(grande));
    const tope = await H.llamar(ent.almacen, 'renzo', 'prueba_imagen', { peso_kb: 1e6 });
    assert.ok(kb(tope) < 410);
    const mala = await H.llamar(ent.almacen, 'renzo', 'prueba_imagen', { peso_kb: 'mucho' });
    assert.ok(mala.isError);
    // las demás herramientas siguen devolviendo un solo bloque de texto
    const otra = await H.llamar(ent.almacen, 'renzo', 'listar_clientes', {});
    assert.equal(otra.content.length, 1);
    assert.equal(otra.content[0].type, 'text');
});

// ------------------------------------------------------------------ requerimientos (sesión 6, entrega 4)
const REQ = require('../../functions/requerimientos/api.js');
const JPGr = (n = 10) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]);
const MED = { formato: 'rubik/1', archivo: 'stand.fbx', unidad: 'm', resumen: '1 pieza', piezas: [
    { item: 'Mostrador demo', pieza: 'Tapa', material: 'MDF_18', cant: 1, largo: 1.8, ancho: 0.6, espesor: 0.018, tipo: 'plancha', area_m2: 2.2536, area_cara_m2: 1.08, perimetro_ml: 4.8, volumen_m3: 0.01944, acabados: [] }] };
async function requerimientoDemo(ent, extra = {}) {
    // la app (requerimientoApi) sí escribe en requerimientos/: mismo almacén, con su permiso de Storage
    const app = Object.assign({}, ent.almacen, {
        subirArchivo: async (r, buf, mime) => { assert.match(r, /^requerimientos\//); ent.almacen.archivos.set(r, { buf: Buffer.from(buf), mime }); },
        borrarArchivo: async (r) => { ent.almacen.archivos.delete(r); },
    });
    const api = (b) => REQ.atender(app, b, 'renzo').then((r) => { assert.equal(r.status, 200, JSON.stringify(r.cuerpo)); return r.cuerpo; });
    const { id } = await api({ accion: 'crear', cliente: { cid: 'cliDemo' }, descripcion: 'Mostrador de 1,80 m de largo en MDF blanco, con logo' });
    const anot = [{ tipo: 'cota', n: 1, valor: '1,80 m', de: [10, 10], a: [500, 10] }];
    const foto = await api({ accion: 'adjuntar', id, tipo: 'imagen', nombre: 'mostrador.jpg', datos: JPGr(500).toString('base64'), anotada: JPGr(400).toString('base64'), anotaciones: anot, ancho: 800, alto: 600, para_claude: JPGr(extra.kbClaude ? extra.kbClaude * 1024 : 50).toString('base64'), anotada_claude: JPGr(extra.kbClaude ? extra.kbClaude * 1024 : 40).toString('base64') });
    const pdf = await api({ accion: 'adjuntar', id, tipo: 'pdf', nombre: 'plano.pdf', datos: Buffer.from('%PDF-1.4 inventado').toString('base64') });
    const t3d = await api({ accion: 'adjuntar', id, tipo: '3d', nombre: 'stand.fbx', medicion: MED, tamano_m: [1.8, 0.9, 0.6], vistas: [{ nombre: 'isométrica', datos: JPGr(extra.kbClaude ? extra.kbClaude * 1024 : 30).toString('base64') }] });
    const otro = await api({ accion: 'adjuntar', id, tipo: 'otro', nombre: 'planta.dwg', datos: Buffer.from('AC1032').toString('base64') });
    return { id, foto: foto.adj, pdf: pdf.adj, t3d: t3d.adj, otro: otro.adj };
}
const contenido = (r) => ({ datos: JSON.parse(r.content[0].text), bloques: r.content.slice(1) });

prueba('requerimientos: listar pendientes y leer con imágenes (foto anotada y vista del 3D)', async () => {
    const ent = crearEntorno();
    const q = await requerimientoDemo(ent);
    const l = await ok(ent, 'listar_requerimientos', {});
    assert.equal(l.requerimientos.length, 1);
    assert.deepEqual(l.requerimientos[0].adjuntos, { imagen: 1, pdf: 1, '3d': 1, otro: 1 });
    assert.equal((await ok(ent, 'listar_requerimientos', { texto: 'MOSTRADOR' })).requerimientos.length, 1);
    assert.equal((await ok(ent, 'listar_requerimientos', { texto: 'trofeo' })).requerimientos.length, 0);
    assert.equal((await ok(ent, 'listar_requerimientos', { estado: 'cotizado' })).requerimientos.length, 0);
    const r = await H.llamar(ent.almacen, 'renzo', 'leer_requerimiento', { id: q.id });
    assert.ok(!r.isError, JSON.stringify(r));
    const { datos, bloques } = contenido(r);
    assert.equal(datos.descripcion, 'Mostrador de 1,80 m de largo en MDF blanco, con logo');
    assert.equal(datos.adjuntos.length, 4);
    assert.deepEqual(datos.adjuntos[0].anotaciones[0].valor, '1,80 m');
    const imgs = bloques.filter((b) => b.type === 'image');
    assert.equal(imgs.length, 2);
    // la foto que se muestra es la copia anotada "para Claude"
    assert.equal(Buffer.from(imgs[0].data, 'base64').length, JPGr(40).length);
    assert.match(bloques[0].text, /foto anotada/);
    assert.match(bloques[2].text, /vista isométrica del 3D/);
    assert.equal(datos.imagenes.siguiente_desde, undefined);
    const sin = contenido(await H.llamar(ent.almacen, 'renzo', 'leer_requerimiento', { id: q.id, sin_imagenes: true }));
    assert.equal(sin.bloques.length, 0);
    assert.ok((await llamar(ent, 'leer_requerimiento', { id: 'noExiste' })).error);
    assert.ok((await llamar(ent, 'leer_requerimiento', { id: '../x' })).error);
});

prueba('requerimientos: leer pagina las imágenes con un tope de ~300 KB por respuesta', async () => {
    const ent = crearEntorno();
    const q = await requerimientoDemo(ent, { kbClaude: 150 });
    const a = contenido(await H.llamar(ent.almacen, 'renzo', 'leer_requerimiento', { id: q.id }));
    assert.equal(a.bloques.filter((b) => b.type === 'image').length, 1);
    assert.equal(a.datos.imagenes.siguiente_desde, 1);
    const b = contenido(await H.llamar(ent.almacen, 'renzo', 'leer_requerimiento', { id: q.id, desde: 1 }));
    assert.equal(b.bloques.filter((x) => x.type === 'image').length, 1);
    assert.equal(b.datos.imagenes.siguiente_desde, undefined);
});

prueba('requerimientos: asignar pide confirmación, copia los adjuntos al proyecto y sirven como origen', async () => {
    const ent = crearEntorno();
    const q = await requerimientoDemo(ent);
    const ab = await ok(ent, 'abrir_cotizacion', { cid: 'cliDemo', pid: 'proyOtro', titulo: 'Mostrador del requerimiento' });
    const C = { cid: 'cliDemo', pid: 'proyOtro', conv: ab.conv };
    assert.match((await llamar(ent, 'asignar_requerimiento', { ...C, id: q.id, confirmacion: 'dueño:-Kinventado' })).texto, /no hay un mensaje del dueño/);
    assert.match((await llamar(ent, 'asignar_requerimiento', { ...C, id: q.id, confirmacion: 'sí' })).texto, /confirmacion/);
    const m = await ok(ent, 'registrar_mensaje_del_dueno', { ...C, texto: 'cotizá el requerimiento del mostrador' });
    const r = await ok(ent, 'asignar_requerimiento', { ...C, id: q.id, confirmacion: m.origen });
    assert.ok(r.ok);
    assert.equal(r.descripcion_origen, undefined);
    // la descripción queda como contexto (aviso), no como mensaje del dueño
    const msgs = Object.values(ent.almacen.datos.proyectos.cliDemo.proyOtro.agente.conversaciones[ab.conv].conversacion.mensajes);
    assert.ok(msgs.some((x) => x.rol === 'aviso' && /Mostrador de 1,80 m/.test(x.texto)));
    assert.ok(!msgs.some((x) => x.rol === 'dueno' && /Mostrador de 1,80 m/.test(x.texto)));
    assert.deepEqual(Object.keys(r.adjuntos).sort(), [q.foto, q.pdf, q.t3d].sort());
    assert.ok(r.sin_copiar.archivos.includes('planta.dwg'));
    const raiz = ent.almacen.datos.proyectos.cliDemo.proyOtro.agente;
    const fotoP = raiz.adjuntos[r.adjuntos[q.foto].adjunto];
    assert.equal(fotoP.tipo, 'imagen'); assert.equal(fotoP.anotaciones[0].valor, '1,80 m');
    assert.match(fotoP.ruta, /^agente\/cliDemo\/proyOtro\//);
    assert.ok(ent.almacen.archivos.has(fotoP.ruta) && ent.almacen.archivos.has(fotoP.anotada_ruta));
    const d3 = raiz.adjuntos[r.adjuntos[q.t3d].adjunto];
    assert.ok(ent.almacen.archivos.has(d3.medicion_ruta) && ent.almacen.archivos.has(d3.vistas_rutas[0]));
    const msg = raiz.conversaciones && Object.values(raiz.conversaciones)[0];
    const req = ent.almacen.datos.requerimientos[q.id];
    assert.equal(req.estado, 'asignado'); assert.equal(req.pid, 'proyOtro'); assert.equal(req.conv, ab.conv);
    // medicion_3d lee el 3D copiado
    const med = await ok(ent, 'medicion_3d', { ...C, adjunto: r.adjuntos[q.t3d].adjunto });
    assert.ok(JSON.stringify(med).includes('Tapa'));
    // la cota dibujada en la foto vale como origen dueño:<adjunto>; la descripción, como dueño:<mensaje>
    const b = await ok(ent, 'armar_borrador', { ...C, operaciones: [
        { op: 'capitulo', nombre: 'Mostrador' },
        { op: 'item', capitulo: 'Mostrador', desc: 'Mostrador', und: 'pza', cant: 1, cant_origen: m.origen, caracteristicas: [{ texto: 'Mostrador en MDF blanco' }] },
        { op: 'fila', item: 'Mostrador', tipo: 'mat', d: 'MDF 18', clave: 'MDF_18', q: 1.8, origen_q: `dueño:${r.adjuntos[q.foto].adjunto}` },
    ] });
    assert.equal(b.rechazadas.length, 0, JSON.stringify(b.rechazadas));
    // repetir (también desde otra cotización del mismo proyecto): no copia de nuevo; otro proyecto: no
    const r2 = await ok(ent, 'asignar_requerimiento', { ...C, id: q.id, confirmacion: m.origen });
    assert.ok(r2.ya_asignado);
    const abB = await ok(ent, 'abrir_cotizacion', { cid: 'cliDemo', pid: 'proyOtro', titulo: 'otra del mismo proyecto' });
    const mB = await ok(ent, 'registrar_mensaje_del_dueno', { cid: 'cliDemo', pid: 'proyOtro', conv: abB.conv, texto: 'asignalo' });
    const r3 = await ok(ent, 'asignar_requerimiento', { cid: 'cliDemo', pid: 'proyOtro', conv: abB.conv, id: q.id, confirmacion: mB.origen });
    assert.ok(r3.ya_asignado && r3.aviso);
    assert.equal(Object.keys(raiz.adjuntos).length, 3);
    // el conector nunca escribe en la carpeta de los requerimientos
    await assert.rejects(ent.almacen.subirArchivo(`requerimientos/${q.id}/x/y.jpg`, JPGr(), 'image/jpeg'), /fuera/);
    const ab2 = await ok(ent, 'abrir_cotizacion', { cid: 'cliDemo', pid: 'proyDemo', titulo: 'otra' });
    const m2 = await ok(ent, 'registrar_mensaje_del_dueno', { cid: 'cliDemo', pid: 'proyDemo', conv: ab2.conv, texto: 'asignalo acá' });
    assert.match((await llamar(ent, 'asignar_requerimiento', { cid: 'cliDemo', pid: 'proyDemo', conv: ab2.conv, id: q.id, confirmacion: m2.origen })).texto, /ya está asignado a otro proyecto/);
    // marcar cotizado
    const m3 = await ok(ent, 'registrar_mensaje_del_dueno', { ...C, texto: 'listo, quedó' });
    await ok(ent, 'asignar_requerimiento', { ...C, id: q.id, confirmacion: m3.origen, cotizado: true });
    assert.equal(ent.almacen.datos.requerimientos[q.id].estado, 'cotizado');
    assert.equal((await ok(ent, 'listar_requerimientos', { estado: 'cotizado' })).requerimientos.length, 1);
});

prueba('requerimientos: descartado no se asigna; el conector no toca otras carpetas de Storage', async () => {
    const ent = crearEntorno();
    const q = await requerimientoDemo(ent);
    await REQ.atender(ent.almacen, { accion: 'descartar', id: q.id }, 'renzo');
    const ab = await ok(ent, 'abrir_cotizacion', { cid: 'cliDemo', pid: 'proyOtro', titulo: 'x' });
    const C = { cid: 'cliDemo', pid: 'proyOtro', conv: ab.conv };
    const m = await ok(ent, 'registrar_mensaje_del_dueno', { ...C, texto: 'cotizalo' });
    assert.match((await llamar(ent, 'asignar_requerimiento', { ...C, id: q.id, confirmacion: m.origen })).texto, /descartado/);
    // una confirmación copiada de otra versión no vale
    ent.almacen.datos.proyectos.cliDemo.proyOtro.agente.conversaciones[ab.conv].conversacion.mensajes[m.id].copiado_de = 'otra';
    await REQ.atender(ent.almacen, { accion: 'reabrir', id: q.id }, 'renzo');
    assert.match((await llamar(ent, 'asignar_requerimiento', { ...C, id: q.id, confirmacion: m.origen })).texto, /otra versión/);
    await assert.rejects(ent.almacen.subirArchivo('compras/x/y.jpg', JPGr(), 'image/jpeg'), /fuera/);
});

// ------------------------------------------------------------------ correr
let bien = 0;
for (const [n, fn] of pruebas) {
    try { await fn(); bien++; console.log('ok  ', n); }
    catch (e) { console.log('FALLA', n, '\n', e); process.exitCode = 1; }
}
console.log(`\n${bien}/${pruebas.length} pruebas OK`);
