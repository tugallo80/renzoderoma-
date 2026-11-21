// Pruebas de functions/rendiciones/api.js con la base EN MEMORIA. Datos inventados. Uso: cd tools/rendiciones && npm test
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../../functions/rendiciones/api.js');
const F = require('../../functions/proyectos/finanzas.js');
const D = require('../../functions/documentos/index.js');
const LINK = require('../../functions/rendiciones/link.js');
const A = require('../../functions/avisos/index.js');
const { crearAlmacenMemoria } = require('../agente/almacen-memoria.cjs');

const DUENO = { uid: 'renzo', rol: 'dueño', nombre: 'Renzo', via: 'app' };
const POLLO = { rol: 'trabajador', nombre: 'Pollo', telefono: '+59170000001', via: 'whatsapp' };
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]).toString('base64');
const datos = () => ({
    personal: { wPollo: { nombre: 'Pollo Demo', telefono: '70000001', tipo: 'externo' }, wJuan: { nombre: 'Juan Demo', telefono: '70000002' } },
    clientes: { cliA: { nombre: 'Cliente Demo' } },
    proyectos: { cliA: { proyA: { nombre: 'Stand Demo', presupuesto: { items: [{ desc: 'Stand', cant: 1, pu: 1000 }] } } } },
    // un registro viejo de la app del trabajador (sin estado = cuenta como aprobado)
    caja_chica: { wPollo: { gastos: { viejo: { proyecto: 'Stand Demo', concepto: 'Clavos', monto: 30, fecha: '2026-11-01' } } } },
});
const nuevo = () => crearAlmacenMemoria(datos(), R.RUTAS.concat(D.RUTAS, A.RUTAS), R.ARCHIVOS.concat(D.ARCHIVOS));
let n = 0;
const op = (al, b, q = DUENO) => R.atender(al, Object.assign({ idempotencia: 'rend-' + (++n) }, b), q);
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.cuerpo)); return r.cuerpo; };

let bien = 0, total = 0;
async function prueba(nombre, fn) { total++; try { await fn(); bien++; console.log('ok  ', nombre); } catch (e) { console.log('FALLA', nombre, '\n', e); process.exitCode = 1; } }

await prueba('entrega del dueño, gasto del trabajador por su teléfono (pendiente), aprobar y saldo', async () => {
    const al = nuevo();
    ok(await op(al, { accion: 'entregar', worker_id: 'wPollo', monto: 500, fecha: '2026-11-02', concepto: 'Para materiales del stand', cid: 'cliA', pid: 'proyA', medio: 'efectivo' }));
    const g = ok(await op(al, { accion: 'registrar_gasto', telefono: '+591 70000001', monto: 120, concepto: 'Pintura', proveedor: 'Ferretería X', cid: 'cliA', pid: 'proyA', fecha: '2026-11-03', foto: { datos_base64: JPG } }, POLLO));
    assert.equal(g.estado, 'pendiente'); assert.equal(g.con_comprobante, true); assert.equal(g.nombre, 'Pollo Demo');
    let e = ok(await R.atender(al, { accion: 'estado', worker_id: 'wPollo' }, DUENO));
    assert.deepEqual(e.totales, { entregado: 500, gastado_aprobado: 30, pendiente_de_aprobar: 120, rechazado: 0, saldo_en_mano: 350 });
    // el pendiente no cuenta como gasto del proyecto hasta aprobarse
    let fin = await F.calcular(crearAlmacenMemoria(al.datos, F.RUTAS), 'cliA', 'proyA');
    assert.equal(fin.gasto.caja_chica, 30); assert.equal(fin.gasto.caja_chica_pendiente, 120);
    ok(await op(al, { accion: 'aprobar', worker_id: 'wPollo', id: g.id }));
    fin = await F.calcular(crearAlmacenMemoria(al.datos, F.RUTAS), 'cliA', 'proyA');
    assert.equal(fin.gasto.caja_chica, 150, 'aprobado → gasto del proyecto');
    assert.equal((await op(al, { accion: 'aprobar', worker_id: 'wPollo', id: g.id })).status, 409, 'ya aprobado');
    e = ok(await R.atender(al, { accion: 'estado', worker_id: 'wPollo' }, DUENO));
    assert.equal(e.totales.saldo_en_mano, 350); assert.equal(e.totales.gastado_aprobado, 150);
});

await prueba('rechazar con motivo, anular una entrega, el dueño carga gasto aprobado y saldo negativo (se le debe)', async () => {
    const al = nuevo();
    const d = ok(await op(al, { accion: 'entregar', worker_id: 'wJuan', monto: 100 }));
    const g1 = ok(await op(al, { accion: 'registrar_gasto', worker_id: 'wJuan', monto: 80, concepto: 'Taxi' }, { rol: 'trabajador', nombre: 'Juan', via: 'whatsapp' }));
    assert.equal((await op(al, { accion: 'rechazar', worker_id: 'wJuan', id: g1.id })).status, 400, 'sin motivo no');
    ok(await op(al, { accion: 'rechazar', worker_id: 'wJuan', id: g1.id, motivo: 'No era del proyecto' }));
    const g2 = ok(await op(al, { accion: 'registrar_gasto', worker_id: 'wJuan', monto: 160, concepto: 'Vinil' }));
    assert.equal(g2.estado, 'aprobado', 'lo que carga el dueño va aprobado');
    let e = ok(await R.atender(al, { accion: 'estado', worker_id: 'wJuan' }, DUENO));
    assert.equal(e.totales.saldo_en_mano, -60); assert.match(e.nota, /se le debe/); assert.equal(e.totales.rechazado, 80);
    ok(await op(al, { accion: 'anular', worker_id: 'wJuan', tipo: 'deposito', id: d.id, motivo: 'cargada dos veces' }));
    e = ok(await R.atender(al, { accion: 'estado', worker_id: 'wJuan' }, DUENO));
    assert.equal(e.totales.entregado, 0); assert.equal(e.movimientos.find((m) => m.id === d.id).estado, 'anulado');
    const res = ok(await R.atender(al, { accion: 'resumen' }, DUENO));
    assert.deepEqual(res.personas.map((p) => p.worker_id).sort(), ['wJuan', 'wPollo']);
});

await prueba('validaciones: teléfono desconocido, persona inexistente, sin concepto, sin clave', async () => {
    const al = nuevo();
    assert.equal((await op(al, { accion: 'registrar_gasto', telefono: '79999999', monto: 1, concepto: 'x' }, POLLO)).status, 404);
    assert.equal((await op(al, { accion: 'entregar', worker_id: 'nadie', monto: 1 })).status, 404);
    assert.equal((await op(al, { accion: 'registrar_gasto', worker_id: 'wPollo', monto: 1 })).status, 400);
    assert.equal((await R.atender(al, { accion: 'entregar', worker_id: 'wPollo', monto: 1 }, DUENO)).status, 400);
    assert.equal((await R.atender(al, { accion: 'borrar' }, DUENO)).status, 400);
});

await prueba('por proyecto: Compras del proyecto ve solo la plata de ese proyecto (también registros viejos por nombre)', async () => {
    const al = nuevo();
    al.datos.proyectos.cliA.proyB = { nombre: 'Otro Stand' };
    ok(await op(al, { accion: 'entregar', worker_id: 'wPollo', monto: 500, cid: 'cliA', pid: 'proyA' }));
    ok(await op(al, { accion: 'entregar', worker_id: 'wPollo', monto: 200, cid: 'cliA', pid: 'proyB' }));
    ok(await op(al, { accion: 'registrar_gasto', worker_id: 'wPollo', monto: 50, concepto: 'Lija', cid: 'cliA', pid: 'proyB' }, POLLO));
    ok(await op(al, { accion: 'entregar', worker_id: 'wJuan', monto: 100 }));   // general, sin proyecto
    const r = ok(await R.atender(al, { accion: 'proyecto', cid: 'cliA', pid: 'proyA' }, DUENO));
    assert.deepEqual(Object.keys(r.personas), ['wPollo'], 'Juan no tiene nada en este proyecto');
    assert.deepEqual(r.personas.wPollo.totales, { entregado: 500, gastado_aprobado: 30, pendiente_de_aprobar: 0, rechazado: 0, saldo_en_mano: 470 }, 'el viejo "Clavos" va por nombre');
    const e = ok(await R.atender(al, { accion: 'estado', worker_id: 'wPollo', cid: 'cliA', pid: 'proyB' }, DUENO));
    assert.equal(e.proyecto, 'Otro Stand'); assert.deepEqual([e.totales.entregado, e.totales.pendiente_de_aprobar, e.totales.saldo_en_mano], [200, 50, 150]);
    const g = ok(await R.atender(al, { accion: 'estado', worker_id: 'wPollo' }, DUENO));
    assert.equal(g.totales.saldo_en_mano, 620, 'global: 700 − 30 − 50');
    const pdf = await D.generar(al, { tipo: 'rendicion', worker_id: 'wPollo', cid: 'cliA', pid: 'proyB' });
    assert.equal(pdf.nombre, 'Rendicion_Pollo_Demo_Otro_Stand.pdf');
    assert.equal((await R.atender(al, { accion: 'proyecto', cid: 'cliA' }, DUENO)).status, 400);
});

await prueba('link para rendir sin app: info, gasto con renglones (pendiente, en su proyecto), reintento, revocar, vencido', async () => {
    const al = nuevo();
    ok(await op(al, { accion: 'entregar', worker_id: 'wPollo', monto: 500, cid: 'cliA', pid: 'proyA' }));
    const l = ok(await op(al, { accion: 'crear_link', worker_id: 'wPollo', cid: 'cliA', pid: 'proyA' }));
    assert.match(l.url, /^https:\/\/rubikbolivia\.com\/rendir\.html#[A-Za-z0-9_-]{20,}$/);
    const token = l.url.split('#')[1];
    const enLaBase = JSON.stringify(al.datos.rendicion_links);
    assert.ok(!enLaBase.includes(token), 'solo se guarda el hash del token');
    const info = ok(await LINK.atender(al, { token, accion: 'info' }));
    assert.equal(info.nombre, 'Pollo Demo'); assert.equal(info.proyecto, 'Stand Demo'); assert.equal(info.totales.entregado, 500);
    const g = { token, accion: 'gasto', idempotencia: 'link-abc123', proveedor: 'Ferretería X', fecha: '2026-11-20',
        items: [{ detalle: 'Tornillos 2"', cantidad: 100, unidad: 'und', precio: 0.5 }, { detalle: 'Pintura', cantidad: 2, unidad: 'gal', precio: 85 }],
        foto: { datos_base64: JPG } };
    const r = ok(await LINK.atender(al, g));
    assert.equal(r.estado, 'pendiente'); assert.equal(r.saldo_en_mano, 500 - 30 - 220);
    const gasto = al.datos.caja_chica.wPollo.gastos[r.id];
    assert.equal(gasto.monto, 220); assert.equal(gasto.pid, 'proyA'); assert.equal(gasto.items[0].monto, 50); assert.equal(gasto.registrado_por.via, 'link');
    assert.ok(gasto.comprobante);
    assert.equal(ok(await LINK.atender(al, g)).repetida, true, 'reintentar no duplica');
    assert.equal(al.datos.rendicion_links[l.id].usado, 1);
    assert.equal((await LINK.atender(al, { ...g, idempotencia: 'link-otro1', items: [{ detalle: 'x', cantidad: 1, precio: 0 }] })).status, 400, 'precio cero no');
    assert.equal((await LINK.atender(al, { token: 'no-existe-este-token-123', accion: 'info' })).status, 401);
    ok(await op(al, { accion: 'revocar_link', id: l.id }));
    assert.equal((await LINK.atender(al, { token, accion: 'info' })).status, 401, 'revocado');
    const l2 = ok(await op(al, { accion: 'crear_link', worker_id: 'wPollo', dias: 1 }));
    al.datos.rendicion_links[l2.id].vence = 1;
    assert.equal((await LINK.atender(al, { token: l2.url.split('#')[1], accion: 'info' })).status, 401, 'vencido');
    const ls = ok(await R.atender(al, { accion: 'links', worker_id: 'wPollo' }, DUENO));
    assert.equal(ls.links.length, 2); assert.ok(ls.links.every((x) => !x.vigente));
});

await prueba('aviso para el dueño (WhatsApp vía Kay) cuando el trabajador rinde; factura → crédito fiscal al aprobar; anular la descuenta', async () => {
    const al = nuevo();
    const l = ok(await op(al, { accion: 'crear_link', worker_id: 'wPollo', cid: 'cliA', pid: 'proyA' }));
    const r = ok(await LINK.atender(al, { token: l.url.split('#')[1], accion: 'gasto', idempotencia: 'link-fac001',
        items: [{ detalle: 'Pintura', cantidad: 2, unidad: 'gal', precio: 85 }], proveedor: 'Ferretería X', factura: { nit: '1234567', nro: '889' } }));
    assert.equal(r.estado, 'pendiente');
    const p = await A.pendientes(al, {});
    assert.equal(p.avisos.length, 1);
    const av = p.avisos[0];
    assert.equal(av.tipo, 'rendicion_por_aprobar');
    assert.match(av.texto, /Pollo Demo rindió 170,00 Bs en Stand Demo: Pintura \(1 renglón\), sin recibo, factura 889\. Está por aprobar\./);
    assert.deepEqual([av.datos.worker_id, av.datos.gasto_id, av.datos.pid, av.datos.via], ['wPollo', r.id, 'proyA', 'link']);
    // lo que carga el dueño (aprobado) no avisa
    ok(await op(al, { accion: 'registrar_gasto', worker_id: 'wPollo', monto: 10, concepto: 'Agua' }));
    assert.equal((await A.pendientes(al, {})).avisos.length, 1);
    // Kay lo manda, el dueño dice que sí: aprobar → crédito fiscal
    assert.equal((await A.confirmar(al, { ids: [av.id] })).confirmados, 1);
    assert.equal((await A.pendientes(al, {})).avisos.length, 0);
    ok(await op(al, { accion: 'aprobar', worker_id: av.datos.worker_id, id: av.datos.gasto_id }, { rol: 'dueño', nombre: 'Renzo', via: 'whatsapp' }));
    const cf = al.datos.compras_facturadas[r.id];
    assert.deepEqual([cf.nit, cf.nro_factura, cf.monto, cf.origen], ['1234567', '889', 170, 'rendicion']);
    const fin = await F.calcular(crearAlmacenMemoria(al.datos, F.RUTAS), 'cliA', 'proyA');
    assert.equal(fin.gasto.compras, 0, 'no se cuenta dos veces como compra'); assert.equal(fin.gasto.caja_chica, 200, '30 viejo + 170');
    ok(await op(al, { accion: 'anular', worker_id: 'wPollo', tipo: 'gasto', id: r.id, motivo: 'factura mal' }));
    assert.equal(al.datos.compras_facturadas[r.id].anulada, true);
    assert.equal((await op(al, { accion: 'registrar_gasto', worker_id: 'wPollo', monto: 5, concepto: 'x', factura: { nit: '123' } })).status, 400, 'factura sin número');
});

await prueba('empujar a Kay: solo con URL registrada (https de Cloud Run/Functions) y con token de identidad', async () => {
    const al = nuevo();
    ok(await op(al, { accion: 'registrar_gasto', worker_id: 'wPollo', monto: 20, concepto: 'Taxi' }, POLLO));
    assert.equal((await A.empujar(al)).motivo, 'sin URL de Kay');
    await assert.rejects(A.configurar(al, { url: 'http://evil.example.com/x' }));
    await A.configurar(al, { url: 'https://kayavisos-abc123-uc.a.run.app' });
    const llamadas = [];
    const r = await A.empujar(al, { tokenIdentidad: async (aud) => 'tok-' + aud.length, fetch: async (u, o) => { llamadas.push({ u, o }); return { ok: true, status: 200 }; } });
    assert.equal(r.empujado, true);
    assert.equal(llamadas[0].u, 'https://kayavisos-abc123-uc.a.run.app');
    assert.match(llamadas[0].o.headers.Authorization, /^Bearer tok-/);
    assert.equal(JSON.parse(llamadas[0].o.body).avisos[0].tipo, 'rendicion_por_aprobar');
    const falla = await A.empujar(al, { tokenIdentidad: async () => { throw new Error('sin metadatos'); } });
    assert.equal(falla.empujado, false, 'si falla no rompe nada: Kay los pide después');
});

await prueba('PDF de rendición (pdf_documento tipo rendicion)', async () => {
    const al = nuevo();
    ok(await op(al, { accion: 'entregar', worker_id: 'wPollo', monto: 500, fecha: '2026-11-02' }));
    ok(await op(al, { accion: 'registrar_gasto', worker_id: 'wPollo', monto: 120, concepto: 'Pintura', fecha: '2026-11-03' }, POLLO));
    const r = await D.generar(al, { tipo: 'rendicion', worker_id: 'wPollo' });
    assert.equal(r.nombre, 'Rendicion_Pollo_Demo.pdf');
    assert.ok(Buffer.from(r.base64, 'base64').subarray(0, 5).toString() === '%PDF-');
    assert.ok(al.archivos.has('documentos/rendiciones/wPollo/Rendicion_Pollo_Demo.pdf'));
});

console.log(`\n${bien}/${total} pruebas OK`);
