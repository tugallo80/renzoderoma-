// Pruebas del módulo de cobros y facturas de venta (functions/cobros/api.js) con la base EN MEMORIA. Datos inventados.
// Uso: cd tools/cobros && npm test
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const K = require('../../functions/cobros/api.js');
const F = require('../../functions/proyectos/finanzas.js');
const { crearAlmacenMemoria } = require('../agente/almacen-memoria.cjs');

const DUENO = { uid: 'renzo', rol: 'dueño', nombre: 'Dueño', via: 'app' };
const KAY = { rol: 'dueño', nombre: 'Renzo', telefono: '+59170000000', via: 'whatsapp' };
const item = (pu) => ({ items: [{ desc: 'Stand', cant: 1, pu }] });
const datos = () => ({
    clientes: { tag: { empresa: 'TAG Demo' }, otro: { nombre: 'Otro' } },
    proyectos: {
        tag: {
            pA: { nombre: 'Stand A', estado: 'produccion', fecha_creacion: '2026-09-01', presupuesto: item(12000) },
            pB: { nombre: 'Stand B', estado: 'entregado', fecha_creacion: '2026-10-01', presupuesto: item(8000), pagos: { viejo: { monto: 1000, fecha: '2026-10-05', nota: 'anticipo' } } },
            pC: { nombre: 'Stand C', estado: 'cotizacion', fecha_creacion: '2026-11-01', presupuesto: item(5000) },
            pV: { nombre: 'Viejo', estado: 'cerrado', archivado: true, presupuesto: item(9999) },
        },
        otro: { pX: { nombre: 'X', estado: 'produccion', presupuesto: item(100) } },
    },
});
const nuevo = () => crearAlmacenMemoria(datos(), K.RUTAS, K.ARCHIVOS);
let n = 0;
const pedir = async (al, b, q = DUENO) => { const r = await K.atender(al, Object.assign({ idempotencia: 'clave-' + (++n) }, b), q); return r; };
const ok = async (al, b, q) => { const r = await pedir(al, b, q); assert.equal(r.status, 200, JSON.stringify(r.cuerpo)); return r.cuerpo; };

let bien = 0;
async function prueba(nombre, fn) { try { await fn(); bien++; console.log('ok  ', nombre); } catch (e) { console.log('FALLA', nombre, '\n', e); process.exitCode = 1; } }

await prueba('pendientes: saldo por proyecto (sin cotizaciones ni archivados) y reparto sugerido', async () => {
    const al = nuevo();
    const r = await ok(al, { accion: 'pendientes', cid: 'tag', monto: 15000 });
    assert.deepEqual(r.proyectos.map((p) => [p.proyecto, p.saldo]), [['Stand A', 12000], ['Stand B', 7000]]);
    assert.equal(r.saldo_total, 19000);
    assert.deepEqual(r.reparto_sugerido.map((x) => [x.pid, x.monto]), [['pA', 12000], ['pB', 3000]], 'lo más viejo primero');
    const r2 = await ok(al, { accion: 'pendientes', cid: 'tag', monto: 20000 });
    assert.equal(r2.sin_asignar, 1000, 'lo que sobra no se inventa');
});

await prueba('factura de venta: queda en Tesorería unida al proyecto y en el panel; no se repite el número', async () => {
    const al = nuevo();
    const f = await ok(al, { accion: 'registrar_factura', cid: 'tag', pid: 'pA', monto: 12000, fecha: '2026-11-10', nro_factura: '152', nit: '123' });
    const ing = await al.leer(`ingresos/${f.id}`);
    assert.equal(ing.is_facturado, true); assert.equal(ing.pid, 'pA'); assert.equal(ing.proyecto, 'Stand A'); assert.equal(ing.estado_cobro, 'pendiente');
    assert.equal((await al.leer(`proyectos/tag/pA/facturas_emitidas/${f.id}`)).nro_factura, '152');
    const rep = await pedir(al, { accion: 'registrar_factura', cid: 'tag', pid: 'pB', monto: 1, nro_factura: '152', nit: '123' });
    assert.equal(rep.status, 409);
    assert.equal((await pedir(al, { accion: 'registrar_factura', cid: 'tag', pid: 'noExiste', monto: 1, nro_factura: '9' })).status, 404);
});

await prueba('un cobro repartido en dos proyectos (TAG pagó 20.000 por los dos stands) con factura', async () => {
    const al = nuevo();
    const f = await ok(al, { accion: 'registrar_factura', cid: 'tag', pid: 'pA', monto: 12000, nro_factura: '200' });
    const c = await ok(al, { accion: 'registrar_cobro', cid: 'tag', monto: 19000, fecha: '2026-11-15', concepto: 'Pago stands', medio: 'transferencia',
        aplicaciones: [{ pid: 'pA', monto: 12000, factura_id: f.id }, { pid: 'pB', monto: 7000 }],
        foto: { datos_base64: Buffer.from('%PDF-1.4 demo').toString('base64') } }, KAY);
    assert.ok(c.comprobante);
    const cobro = await al.leer(`cobros/${c.id}`);
    assert.equal(cobro.cliente, 'TAG Demo'); assert.equal(cobro.registrado_por.via, 'whatsapp');
    const pA = await al.leer(`proyectos/tag/pA/pagos/${c.id}_0`), pB = await al.leer(`proyectos/tag/pB/pagos/${c.id}_1`);
    assert.equal(pA.monto, 12000); assert.equal(pA.factura, '200'); assert.equal(pB.monto, 7000); assert.equal(pB.cobro_id, c.id);
    const ing = await al.leer(`ingresos/${f.id}`);
    assert.equal(ing.estado_cobro, 'cobrado'); assert.equal(ing.cobrado, 12000); assert.equal(ing.fecha_cobro, '2026-11-15');
    // la fórmula de finanzas lo ve sin cambios
    const fin = await F.calcular(crearAlmacenMemoria(al.datos, F.RUTAS), 'tag', 'pB');
    assert.equal(fin.cobrado.pagos_proyecto, 8000); assert.equal(fin.saldo_por_cobrar, 0);
    const pend = await ok(al, { accion: 'pendientes', cid: 'tag' });
    assert.equal(pend.proyectos.length, 0, 'todo cobrado');
    const lis = await ok(al, { accion: 'listar', cid: 'tag' });
    assert.equal(lis.total_cobrado, 19000); assert.equal(lis.cobros[0].aplicaciones.length, 2);
});

await prueba('cobro: el reparto tiene que sumar el total, la factura no se pasa de su saldo y no puede ser de otro cliente', async () => {
    const al = nuevo();
    assert.equal((await pedir(al, { accion: 'registrar_cobro', cid: 'tag', monto: 100, aplicaciones: [{ pid: 'pA', monto: 60 }] })).status, 400);
    const f = await ok(al, { accion: 'registrar_factura', cid: 'tag', pid: 'pA', monto: 500, nro_factura: '7' });
    const pasa = await pedir(al, { accion: 'registrar_cobro', cid: 'tag', monto: 600, aplicaciones: [{ pid: 'pA', monto: 600, factura_id: f.id }] });
    assert.equal(pasa.status, 400); assert.match(pasa.cuerpo.error, /saldo/);
    const fo = await ok(al, { accion: 'registrar_factura', cid: 'otro', pid: 'pX', monto: 100, nro_factura: '8' });
    assert.equal((await pedir(al, { accion: 'registrar_cobro', cid: 'tag', monto: 50, aplicaciones: [{ pid: 'pA', monto: 50, factura_id: fo.id }] })).status, 400);
    assert.equal((await pedir(al, { accion: 'registrar_cobro', cid: 'tag', monto: 50, aplicaciones: [{ pid: 'pX', monto: 50 }] })).status, 404, 'proyecto de otro cliente');
    assert.equal(await al.leer('cobros'), null, 'nada a medias');
    // atajo de un solo proyecto y pago parcial de la factura
    await ok(al, { accion: 'registrar_cobro', cid: 'tag', monto: 200, pid: 'pA', factura_id: f.id });
    assert.equal((await al.leer(`ingresos/${f.id}`)).estado_cobro, 'parcial');
});

await prueba('anular cobro: quita la parte de cada proyecto y devuelve la factura a pendiente; reintento idempotente', async () => {
    const al = nuevo();
    const f = await ok(al, { accion: 'registrar_factura', cid: 'tag', pid: 'pA', monto: 12000, nro_factura: '300' });
    const c = await ok(al, { accion: 'registrar_cobro', cid: 'tag', monto: 13000, aplicaciones: [{ pid: 'pA', monto: 12000, factura_id: f.id }, { pid: 'pB', monto: 1000 }] });
    assert.equal((await pedir(al, { accion: 'anular_factura', id: f.id, motivo: 'error' })).status, 409, 'con cobros no se anula la factura');
    const clave = 'anular-' + c.id;
    await ok(al, { accion: 'anular_cobro', id: c.id, motivo: 'transferencia rechazada', idempotencia: clave });
    const otra = await ok(al, { accion: 'anular_cobro', id: c.id, motivo: 'otra vez', idempotencia: clave });
    assert.equal(otra.repetida, true);
    assert.equal(await al.leer(`proyectos/tag/pA/pagos/${c.id}_0`), null);
    assert.equal(await al.leer(`proyectos/tag/pB/pagos/${c.id}_1`), null);
    assert.ok(await al.leer('proyectos/tag/pB/pagos/viejo'), 'los pagos viejos no se tocan');
    const ing = await al.leer(`ingresos/${f.id}`);
    assert.equal(ing.estado_cobro, 'pendiente'); assert.equal(ing.cobrado, 0);
    assert.equal((await al.leer(`cobros/${c.id}`)).anulado, true);
    await ok(al, { accion: 'anular_factura', id: f.id, motivo: 'mal emitida' });
    assert.equal(await al.leer(`proyectos/tag/pA/facturas_emitidas/${f.id}`), null);
    assert.equal((await al.leer(`ingresos/${f.id}`)).anulada, true);
    const hist = Object.values(await al.leer('proyectos/tag/pA/historial_operaciones')).map((h) => h.op);
    assert.deepEqual(hist, ['registrar_factura', 'registrar_cobro', 'anular_cobro', 'anular_factura']);
});

await prueba('acción desconocida o sin clave de idempotencia', async () => {
    const al = nuevo();
    assert.equal((await K.atender(al, { accion: 'borrar_todo' }, DUENO)).status, 400);
    assert.equal((await K.atender(al, { accion: 'registrar_cobro', cid: 'tag', monto: 1, pid: 'pA' }, DUENO)).status, 400);
});

console.log(`\n${bien}/6 pruebas OK`);
