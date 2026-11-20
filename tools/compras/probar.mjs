// Pruebas del módulo de compras (functions/compras/api.js) con la base EN MEMORIA. Datos inventados (el repo es público).
// Uso: cd tools/compras && npm test
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../../functions/compras/api.js');
const { crearAlmacenMemoria } = require('../agente/almacen-memoria.cjs');

const pruebas = [];
const prueba = (n, fn) => pruebas.push([n, fn]);
const DUENO = { uid: 'renzo', rol: 'dueño', nombre: 'Dueño', via: 'app' };
const KAY = { rol: 'compras', nombre: 'Encargado demo', telefono: '+59170000000', via: 'whatsapp' };
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]).toString('base64');

function base(extra) {
    return crearAlmacenMemoria(Object.assign({
        clientes: { cliA: { nombre: 'Cliente Demo' } },
        proyectos: { cliA: { proyA: { nombre: 'Stand Demo', monto_cierre: 10000, gasto_total: 100 } } },
        base_datos: {
            proveedores: { '-Pviejo': { nombre: 'Ferretería Demo', nit: '1234567' } },
            materiales: { 'MDF 18MM': { n: 'MDF 18MM', u: 'plancha', p: 300 } },
        },
        ingresos: { i1: { monto: 5000, fecha: '2026-11-05', proyecto: 'Stand Demo' } },
    }, extra || {}), C.RUTAS, C.ARCHIVOS);
}
const reg = (alm, b, q) => C.atender(alm, { accion: 'registrar', ...b }, q || DUENO);
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.cuerpo)); return r.cuerpo; };
const err = (r, txt) => { assert.notEqual(r.status, 200, 'debía fallar'); if (txt) assert.match(r.cuerpo.error, txt); };

prueba('factura sin proyecto: compra, crédito fiscal, proveedor nuevo por NIT y foto', async () => {
    const alm = base();
    const c = ok(await reg(alm, { idempotencia: 'msg-0001', factura: { nit: '987654321', razon_social: 'Maderas Demo SRL', nro: '55', cuf: 'ABC 123', fecha: '2026-11-10', monto: 450 }, total: 450, foto: { datos_base64: JPG } }));
    const D = alm.datos;
    assert.equal(c.repetida, false);
    assert.equal(c.proveedor_id, 'NIT_987654321');
    assert.equal(D.compras[c.id].mes, '2026-11');
    assert.equal(D.compras[c.id].registrado_por.via, 'app');
    assert.equal(D.compras_facturadas[c.id].nro_factura, '55');
    assert.equal(D.compras_facturadas[c.id].cuf, 'ABC123');
    assert.equal(D.compras_facturadas[c.id].compra_id, c.id);
    assert.equal(D.base_datos.proveedores.NIT_987654321.nombre, 'Maderas Demo SRL');
    assert.equal(D.base_datos.proveedores.NIT_987654321.facturas[c.id].monto, 450);
    assert.ok(alm.archivos.has(`compras/2026-11/${c.id}.jpg`));
    assert.match(D.compras[c.id].comprobante.url, /token=/);
});

prueba('compra de proyecto con ítems: gasto_total con transacción, espejo, precios sin repetidos, proveedor existente por NIT', async () => {
    const alm = base();
    const c = ok(await reg(alm, { idempotencia: 'msg-0002', cid: 'cliA', pid: 'proyA', fecha: '2026-11-12',
        proveedor: { nombre: 'FERRETERIA DEMO', nit: '1234567' },
        items: [{ material: 'mdf 18mm', cantidad: 2, unidad: 'plancha', precio: 310 }, { material: 'Tornillo 2"', cantidad: 100, precio: 0.5 }] }, KAY));
    const D = alm.datos;
    assert.equal(c.proveedor_id, '-Pviejo', 'usa el proveedor que ya existía (mismo NIT)');
    assert.equal(D.compras[c.id].total, 670);
    assert.equal(D.proyectos.cliA.proyA.gasto_total, 770);
    assert.equal(D.proyectos.cliA.proyA.historial_compras[c.id].compra_id, c.id);
    assert.equal(D.base_datos.materiales['MDF 18MM'].p, 310, 'actualiza el registro con espacios');
    assert.equal(D.base_datos.materiales.MDF_18MM, undefined, 'no crea el repetido');
    assert.equal(D.base_datos.materiales['TORNILLO_2"'].n, 'Tornillo 2"');
    assert.equal(D.base_datos.proveedores['-Pviejo'].materiales['MDF 18MM'].precio, 310);
    assert.equal(D.compras[c.id].registrado_por.telefono, '+59170000000');
    assert.equal(D.compras_facturadas, undefined, 'sin factura no hay crédito fiscal');
});

prueba('idempotencia: reintentar devuelve la misma compra y no suma dos veces', async () => {
    const alm = base();
    const b = { idempotencia: 'wamid.XYZ', cid: 'cliA', pid: 'proyA', total: 50, proveedor: { nombre: 'Kiosco Demo' } };
    const a = ok(await reg(alm, b)), z = ok(await reg(alm, b));
    assert.equal(z.id, a.id); assert.equal(z.repetida, true);
    assert.equal(Object.keys(alm.datos.compras).length, 1);
    assert.equal(alm.datos.proyectos.cliA.proyA.gasto_total, 150);
});

prueba('reintento después de un corte: completa la compra con el id reservado, sin duplicar', async () => {
    const alm = base();
    const C2 = require('../../functions/compras/api.js');
    const crypto = require('crypto');
    const ki = crypto.createHash('sha256').update('corte-1').digest('hex').slice(0, 40);
    alm.datos.compras_idem = { [ki]: { id: '-Kreservado', creado: 1 } };
    const c = ok(await C2.atender(alm, { accion: 'registrar', idempotencia: 'corte-1', cid: 'cliA', pid: 'proyA', total: 20, proveedor: { nombre: 'X' } }, DUENO));
    assert.equal(c.id, '-Kreservado'); assert.equal(c.repetida, false);
    assert.equal(alm.datos.proyectos.cliA.proyA.gasto_total, 120);
    ok(await C2.atender(alm, { accion: 'registrar', idempotencia: 'corte-1', cid: 'cliA', pid: 'proyA', total: 20, proveedor: { nombre: 'X' } }, DUENO));
    assert.equal(alm.datos.proyectos.cliA.proyA.gasto_total, 120);
});

prueba('validaciones: no escribe nada si algo está mal', async () => {
    const alm = base();
    err(await reg(alm, { total: 10, proveedor: { nombre: 'X' } }), /idempotencia/);
    err(await reg(alm, { idempotencia: 'v-0001', total: 100, items: [{ material: 'A', cantidad: 1, precio: 10 }], proveedor: { nombre: 'X' } }), /no coincide/);
    err(await reg(alm, { idempotencia: 'v-0002', total: 100, factura: { nro: '1' } }), /NIT/);
    err(await reg(alm, { idempotencia: 'v-0003', total: 100, factura: { nit: '123456' } }), /número/);
    err(await reg(alm, { idempotencia: 'v-0004', total: 100, cid: 'cliA', pid: 'noExiste', proveedor: { nombre: 'X' } }), /proyecto/);
    err(await reg(alm, { idempotencia: 'v-0005', total: -5, proveedor: { nombre: 'X' } }), /Total/);
    err(await reg(alm, { idempotencia: 'v-0006', total: 5, fecha: '13/11/2026', proveedor: { nombre: 'X' } }), /Fecha/);
    err(await reg(alm, { idempotencia: 'v-0007', total: 5, proveedor: { nombre: 'X' }, foto: { datos_base64: Buffer.from('hola').toString('base64') } }), /JPG/);
    assert.equal(alm.datos.compras, undefined);
    assert.equal(alm.datos.compras_idem, undefined, 'tampoco reserva idempotencia');
});

prueba('anular: resta del gasto, marca la factura y el espejo; anular dos veces no resta dos veces', async () => {
    const alm = base();
    const c = ok(await reg(alm, { idempotencia: 'an-0001', cid: 'cliA', pid: 'proyA', total: 200, factura: { nit: '1234567', nro: '9', fecha: '2026-11-01' } }));
    assert.equal(alm.datos.proyectos.cliA.proyA.gasto_total, 300);
    err(await C.atender(alm, { accion: 'anular', id: c.id }, DUENO), /motivo/);
    ok(await C.atender(alm, { accion: 'anular', id: c.id, motivo: 'cargada dos veces' }, DUENO));
    const r = ok(await C.atender(alm, { accion: 'anular', id: c.id, motivo: 'otra vez' }, DUENO));
    assert.equal(r.ya_estaba_anulada, true);
    const D = alm.datos;
    assert.equal(D.proyectos.cliA.proyA.gasto_total, 100);
    assert.equal(D.compras[c.id].estado, 'anulada');
    assert.equal(D.compras_facturadas[c.id].anulada, true);
    assert.equal(D.proyectos.cliA.proyA.historial_compras[c.id].anulada, true);
    // reintentar el registro de una compra anulada no la vuelve a sumar
    ok(await reg(alm, { idempotencia: 'an-0001', cid: 'cliA', pid: 'proyA', total: 200, factura: { nit: '1234567', nro: '9', fecha: '2026-11-01' } }));
    assert.equal(D.proyectos.cliA.proyA.gasto_total, 100);
});

prueba('balance mensual (ingresos, compras, contratistas, IVA), sin contar anuladas', async () => {
    const alm = base({ proyectos: { cliA: { proyA: { nombre: 'Stand Demo', monto_cierre: 10000, gasto_total: 0,
        licitaciones: { l1: { estado: 'adjudicado', precio_final: 3000, pagos: { p1: { monto: 1000, fecha: '2026-11-20' }, p2: { monto: 500, fecha: '2026-10-02' } } } } } } } });
    const a = ok(await reg(alm, { idempotencia: 'b-0001', cid: 'cliA', pid: 'proyA', total: 1000, fecha: '2026-11-03', factura: { nit: '1234567', nro: '1', fecha: '2026-11-03' } }));
    ok(await reg(alm, { idempotencia: 'b-0002', total: 200, fecha: '2026-11-04', proveedor: { nombre: 'Kiosco' } }));
    const x = ok(await reg(alm, { idempotencia: 'b-0003', total: 999, fecha: '2026-11-04', proveedor: { nombre: 'Kiosco' } }));
    ok(await C.atender(alm, { accion: 'anular', id: x.id, motivo: 'prueba' }, DUENO));
    ok(await reg(alm, { idempotencia: 'b-0004', total: 70, fecha: '2026-10-30', proveedor: { nombre: 'Kiosco' } }));
    const m = ok(await C.atender(alm, { accion: 'balance_mensual', mes: '2026-11' }, DUENO));
    assert.equal(m.ingresos.total, 5000);
    assert.equal(m.egresos.compras, 1200);
    assert.equal(m.egresos.pagos_contratistas, 1000);
    assert.equal(m.resultado, 2800);
    assert.equal(m.impuestos.monto_facturado, 1000);
    assert.equal(m.impuestos.credito_fiscal_iva_13, 130);
    err(await C.atender(alm, { accion: 'balance_mensual', mes: 'noviembre' }, DUENO), /Mes/);
});

prueba('comprobante PDF e ítems de referencia que no suman exacto', async () => {
    const alm = base();
    const pdf = Buffer.from('%PDF-1.4 demo').toString('base64');
    const c = ok(await reg(alm, { idempotencia: 'pdf-0001', total: 95, proveedor: { nombre: 'Kiosco' }, foto: { datos_base64: pdf },
        items_referencia: true, items: [{ material: 'Lija 220', cantidad: 10, precio: 10 }] }));
    assert.ok(alm.archivos.has(`compras/${alm.datos.compras[c.id].mes}/${c.id}.pdf`));
    assert.equal(alm.datos.compras[c.id].items_diferencia, -5);
    assert.equal(alm.datos.base_datos.materiales.LIJA_220.p, 10);
});

prueba('clave de proveedor: NIT o nombre normalizado; alias de la migración', async () => {
    assert.equal(C.claveProveedor('Ferretería  El Sol', ''), 'NOM_FERRETERIA_EL_SOL');
    assert.equal(C.claveProveedor('x', '12.345-67'), 'NIT_1234567');
    const r = C.buscarProveedor({ NIT_1234567: { nombre: 'A' } }, { NOM_VIEJO: 'NIT_1234567' }, 'Viejo', '');
    assert.deepEqual(r, { clave: 'NIT_1234567', existe: true });
});

let n = 0;
for (const [nombre, fn] of pruebas) {
    try { await fn(); n++; console.log('ok  ', nombre); }
    catch (e) { console.log('FALLA', nombre, '\n', e); process.exitCode = 1; }
}
console.log(`\n${n}/${pruebas.length} pruebas OK`);
