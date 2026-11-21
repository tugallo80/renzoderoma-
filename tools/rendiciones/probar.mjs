// Pruebas de functions/rendiciones/api.js con la base EN MEMORIA. Datos inventados. Uso: cd tools/rendiciones && npm test
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../../functions/rendiciones/api.js');
const F = require('../../functions/proyectos/finanzas.js');
const D = require('../../functions/documentos/index.js');
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
const nuevo = () => crearAlmacenMemoria(datos(), R.RUTAS.concat(D.RUTAS), R.ARCHIVOS.concat(D.ARCHIVOS));
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
