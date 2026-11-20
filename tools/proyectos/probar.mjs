// Pruebas de functions/proyectos/finanzas.js con la base EN MEMORIA. Datos inventados. Uso: cd tools/proyectos && npm test
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('../../functions/proyectos/finanzas.js');
const P = require('../../functions/proyectos/index.js');
const { crearAlmacenMemoria } = require('../agente/almacen-memoria.cjs');

const datos = () => ({
    proyectos: { cliA: { proyA: {
        nombre: 'Stand Demo', monto_cierre: 0, gasto_total: 9999,
        presupuesto: { descuento: 100, impuestos: true, items: [
            { type: 'chapter', desc: 'Cap' }, { desc: 'Mostrador', cant: 2, pu: 500 }, { desc: 'Apagado', cant: 1, pu: 1000, activo: false }] },
        extras: { e1: { estado: 'aprobado', precio: 200 }, e2: { estado: 'pendiente', precio: 999 } },
        historial_compras: { c1: { total: 300 }, c2: { total: 50, anulada: true } },
        gastos_adicionales_compras: 40,
        licitaciones: {
            L1: { worker_name: 'Pollo', estado: 'aprobado', precio_propuesto: 2548.5, precio_final: 3000, extras: { x: { monto: 100 } }, pagos: { p: { monto: 1000 } } },
            L2: { worker_name: 'Otro', estado: 'enviado', precio_propuesto: 800, pagos: { p: { monto: 50 } } },
            L3: { worker_name: 'Viejo', estado: 'adjudicado', precio_final: 500 } },
        pagos: { a: { monto: 700 } },
    } } },
    caja_chica: { w1: { gastos: {
        g1: { proyecto: 'Stand Demo', monto: 80 },                 // gastado, por nombre (registro viejo)
        g2: { pid: 'proyA', proyecto: 'Otro nombre', monto_total: 20 },  // gastado, por pid
        g3: { pid: 'proyA', monto: 500, estado: 'pendiente' },     // pedido pendiente: no es gasto
        g4: { proyecto: 'Otro proyecto', monto: 999 } } } },
    supervisores: { s1: { proyectos: { proyA: { gastos: { a: { monto: 60 } }, extras: { b: { monto: 30, aprobado: true }, c: { monto: 77 } }, depositos: { d: { monto: 1000 } } } } } },
    ingresos: { i1: { proyecto: 'Stand Demo', monto: 1160, estado_cobro: 'cobrado' }, i2: { proyecto: 'Stand Demo', monto: 200 }, i3: { proyecto: 'Otro', monto: 5 } },
});

let ok = 0;
async function prueba(n, fn) { try { await fn(); ok++; console.log('ok  ', n); } catch (e) { console.log('FALLA', n, '\n', e); process.exitCode = 1; } }

await prueba('venta, gastos por fuente, dos utilidades y cobrado por separado', async () => {
    const r = await F.calcular(crearAlmacenMemoria(datos(), F.RUTAS), 'cliA', 'proyA');
    assert.equal(r.venta.subtotal, 1000, 'el ítem con el ojo apagado no suma');
    assert.equal(r.venta.presupuesto, 1044);   // (1000 - 100) × 1,16
    assert.equal(r.venta.final, 1244);          // + extra aprobado 200
    const g = r.gasto;
    assert.equal(g.compras, 300, 'sin anuladas');
    assert.equal(g.compras_adicionales, 40);
    assert.equal(g.caja_chica, 100, 'por nombre o por pid, sin el pedido pendiente');
    assert.equal(g.caja_chica_pendiente, 500);
    assert.equal(g.supervisores_gastos, 60);
    assert.equal(g.supervisores_extras, 30, 'solo extras aprobados; los depósitos no son gasto');
    assert.equal(g.mano_obra_contratada, 3500, 'aprobada 3000 + adjudicada 500; la enviada no');
    assert.equal(g.mano_obra_extras, 100);
    assert.equal(g.mano_obra_pagada, 1050, 'lo pagado cuenta aunque la licitación no esté aprobada');
    assert.equal(g.esperado, 300 + 40 + 100 + 60 + 30 + 3500 + 100);
    assert.equal(g.con_pagado, 300 + 40 + 100 + 60 + 30 + 1050);
    assert.equal(r.utilidad_esperada, 1244 - g.esperado);
    assert.equal(r.utilidad_con_pagado, 1244 - g.con_pagado);
    assert.deepEqual(r.cobrado, { pagos_proyecto: 700, facturado_tesoreria: 1360, cobrado_tesoreria: 1160 });
    assert.equal(r.contratistas.find((c) => c.trabajador === 'Pollo').saldo, 2100);
    assert.equal(r.referencia.gasto_total_viejo, 9999, 'el contador viejo no entra en la utilidad');
});

await prueba('monto de cierre reemplaza al presupuesto; proyecto inexistente o inválido', async () => {
    const d = datos(); d.proyectos.cliA.proyA.monto_cierre = 5000;
    const r = await F.calcular(crearAlmacenMemoria(d, F.RUTAS), 'cliA', 'proyA');
    assert.equal(r.venta.final, 5200);
    const alm = crearAlmacenMemoria(d, F.RUTAS);
    assert.equal((await P.atender(alm, { accion: 'finanzas', cid: 'cliA', pid: 'noExiste' })).status, 404);
    assert.equal((await P.atender(alm, { accion: 'finanzas', cid: '../x', pid: 'p' })).status, 400);
    assert.equal((await P.atender(alm, { accion: 'otra' })).status, 400);
    assert.equal((await P.atender(alm, { accion: 'finanzas', cid: 'cliA', pid: 'proyA' })).status, 200);
});

console.log(`\n${ok}/2 pruebas OK`);
