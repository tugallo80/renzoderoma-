// Pruebas de functions/licitaciones/api.js con la base EN MEMORIA (imita al Admin SDK). Datos inventados.
// Uso: cd tools/licitaciones && npm test
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../../functions/licitaciones/api.js');
const { crearAlmacenMemoria } = require('../agente/almacen-memoria.cjs');

const pruebas = [];
const prueba = (n, fn) => pruebas.push([n, fn]);
const DUENO = { uid: 'renzo', rol: 'dueño', nombre: 'Dueño', via: 'app' };
const KAY = { rol: 'dueño', nombre: 'Dueño', telefono: '+59170000000', via: 'whatsapp' };
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]).toString('base64');
const P = { cid: 'cliA', pid: 'proyA' };
let n = 0; const clave = () => 'prueba-' + (++n);

function base() {
    return crearAlmacenMemoria({
        clientes: { cliA: { nombre: 'Cliente Demo' } },
        personal: { wPollo: { nombre: 'Pollo Demo' }, wOtro: { nombre: 'Otro Demo' } },
        proyectos: { cliA: { proyA: { nombre: 'Stand Demo', gasto_total: 500,
            presupuesto: { items: [{ desc: 'Mostrador', prod_resp: '' }, { desc: 'Letrero' }] },
            licitaciones: {
                L1: { id: 'L1', worker_id: 'wPollo', worker_name: 'Pollo Demo', estado: 'aprobado', precio_propuesto: 2548.5, precio_final: 2548.5,
                    tareas: { t1: { task_name: 'Armado', subtotal: 2548.5, originIdx: 0 } }, pagos: { p0: { monto: 500, fecha: '2026-11-01' } } },
                L2: { id: 'L2', worker_id: 'wOtro', worker_name: 'Otro Demo', estado: 'enviado', precio_propuesto: 800, tareas: {} },
            } } } },
    }, L.RUTAS, L.ARCHIVOS);
}
function conEspejo(alm) {
    alm.datos.personal.wPollo.solicitudes = { L1: JSON.parse(JSON.stringify(alm.datos.proyectos.cliA.proyA.licitaciones.L1)) };
    alm.datos.personal.wOtro.solicitudes = { L2: JSON.parse(JSON.stringify(alm.datos.proyectos.cliA.proyA.licitaciones.L2)) };
    return alm;
}
const op = (alm, accion, b, q) => L.atender(alm, Object.assign({ accion, idempotencia: clave() }, P, b), q || DUENO);
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.cuerpo)); return r.cuerpo; };
const err = (r, re) => { assert.notEqual(r.status, 200, 'debía fallar'); if (re) assert.match(r.cuerpo.error, re); };
const hist = (alm) => Object.values(alm.datos.proyectos.cliA.proyA.historial_operaciones || {});
const lic = (alm, k) => alm.datos.proyectos.cliA.proyA.licitaciones[k];

prueba('cambiar_monto en una aprobada: precio final 2.548,50 → 3.000, copia del trabajador e historial; reintentar no repite', async () => {
    const alm = conEspejo(base());
    const b = { accion: 'cambiar_monto', idempotencia: 'wamid.POLLO1', ...P, lid: 'L1', monto: 3000, motivo: 'acordado con Pollo' };
    const r = ok(await L.atender(alm, b, KAY));
    assert.equal(r.licitacion.contrato, 3000);
    assert.equal(r.licitacion.saldo, 2500);
    assert.equal(lic(alm, 'L1').precio_final, 3000);
    assert.equal(lic(alm, 'L1').precio_propuesto, 2548.5, 'el propuesto queda');
    assert.equal(alm.datos.personal.wPollo.solicitudes.L1.precio_final, 3000);
    const h = hist(alm);
    assert.equal(h.length, 1);
    assert.deepEqual([h[0].antes.precio_final, h[0].despues.precio_final], [2548.5, 3000]);
    assert.equal(h[0].por.via, 'whatsapp'); assert.equal(h[0].por.telefono, '+59170000000'); assert.equal(h[0].motivo, 'acordado con Pollo');
    const z = ok(await L.atender(alm, b, KAY));
    assert.equal(z.repetida, true);
    assert.equal(hist(alm).length, 1);
    assert.equal(alm.datos.proyectos.cliA.proyA.gasto_total, 500, 'no toca gasto_total');
});

prueba('cambiar_monto en una no aprobada cambia el propuesto; aprobar fija el final y marca el responsable en el presupuesto', async () => {
    const alm = conEspejo(base());
    ok(await op(alm, 'cambiar_monto', { lid: 'L2', monto: 900 }));
    assert.equal(lic(alm, 'L2').precio_propuesto, 900); assert.equal(lic(alm, 'L2').precio_final, undefined);
    ok(await op(alm, 'aprobar', { lid: 'L1' }));
    assert.equal(alm.datos.proyectos.cliA.proyA.presupuesto.items[0].prod_resp, 'Pollo Demo');
    const r = ok(await op(alm, 'aprobar', { lid: 'L2' }));
    assert.equal(r.licitacion.precio_final, 900); assert.equal(lic(alm, 'L2').estado, 'aprobado');
    err(await op(alm, 'contra_oferta', { lid: 'L1', precio: 2000 }), /aprobada/);
    ok(await op(alm, 'terminar', { lid: 'L1' }));
    assert.equal(lic(alm, 'L1').estado, 'terminado');
});

prueba('pagos: registrar (con comprobante y caja chica) y anular con motivo; extras; saldo', async () => {
    const alm = conEspejo(base());
    const r = ok(await op(alm, 'registrar_pago', { lid: 'L1', monto: 700, tipo: 'adelanto', fecha: '2026-11-19', foto: { datos_base64: JPG }, pagado_con: { medio: 'caja_chica', persona: 'Encargado' } }, KAY));
    const pg = lic(alm, 'L1').pagos[r.pago];
    assert.equal(pg.tipo, 'adelanto'); assert.equal(pg.nota, 'Adelanto'); assert.equal(pg.pagado_con.medio, 'caja_chica');
    assert.ok(alm.archivos.has(`comprobantes/cliA/proyA/L1/${r.pago}.jpg`)); assert.match(r.comprobante, /token=/);
    assert.equal(alm.datos.personal.wPollo.solicitudes.L1.pagos[r.pago].monto, 700);
    assert.equal(r.licitacion.pagado, 1200);
    const e = ok(await op(alm, 'agregar_extra', { lid: 'L1', monto: 150, descripcion: 'Pintura extra' }));
    assert.equal(e.licitacion.saldo, 2548.5 + 150 - 1200);
    err(await op(alm, 'anular_pago', { lid: 'L1', pago: r.pago }), /motivo/);
    ok(await op(alm, 'anular_pago', { lid: 'L1', pago: r.pago, motivo: 'cargado dos veces' }));
    assert.equal(lic(alm, 'L1').pagos[r.pago], undefined);
    assert.equal(alm.datos.personal.wPollo.solicitudes.L1.pagos[r.pago], undefined);
    assert.ok(hist(alm).some((h) => h.op === 'anular_pago' && h.antes.monto === 700));
});

prueba('cambiar_contratista mueve la copia del trabajador; anular quita todo, guarda la copia y no toca gasto_total', async () => {
    const alm = conEspejo(base());
    ok(await op(alm, 'cambiar_contratista', { lid: 'L1', worker_id: 'wOtro' }));
    assert.equal(lic(alm, 'L1').worker_name, 'Otro Demo');
    assert.equal(alm.datos.personal.wPollo.solicitudes.L1, undefined);
    assert.equal(alm.datos.personal.wOtro.solicitudes.L1.worker_id, 'wOtro');
    err(await op(alm, 'anular', { lid: 'L1' }), /motivo/);
    const r = ok(await op(alm, 'anular', { lid: 'L1', motivo: 'se canceló el ítem' }));
    assert.equal(lic(alm, 'L1'), undefined);
    assert.equal(alm.datos.personal.wOtro.solicitudes.L1, undefined);
    assert.equal(alm.datos.proyectos.cliA.proyA.gasto_total, 500);
    const copia = alm.datos.proyectos.cliA.proyA.historial_operaciones[r.copia_en_historial];
    assert.equal(copia.antes.precio_final, 2548.5);
});

prueba('guardar desde la pantalla: crea con la copia del trabajador y conserva pagos al editar', async () => {
    const alm = conEspejo(base());
    const c = ok(await op(alm, 'guardar', { licitacion: { worker_id: 'wPollo', estado: 'aprobado', precio_propuesto: 1200, lic_mode: 'mo', tareas: { a: { task_name: 'Letrero', subtotal: 1200, originIdx: 1 } } } }));
    const nueva = lic(alm, c.lid);
    assert.equal(nueva.worker_name, 'Pollo Demo'); assert.equal(nueva.cid, 'cliA');
    assert.equal(alm.datos.personal.wPollo.solicitudes[c.lid].precio_propuesto, 1200);
    assert.equal(alm.datos.proyectos.cliA.proyA.presupuesto.items[1].prod_resp, 'Pollo Demo');
    ok(await op(alm, 'guardar', { lid: 'L1', licitacion: { worker_id: 'wOtro', estado: 'aprobado', precio_propuesto: 2600, tareas: {} } }));
    assert.equal(lic(alm, 'L1').pagos.p0.monto, 500, 'los pagos no se pierden al editar');
    assert.equal(alm.datos.personal.wPollo.solicitudes.L1, undefined, 'la copia del trabajador anterior se quita');
    err(await op(alm, 'guardar', { licitacion: { worker_id: 'noExiste', tareas: {} } }), /trabajador/);
});

prueba('validaciones y listar (por proyecto y buscando al trabajador en todos)', async () => {
    const alm = base();
    err(await L.atender(alm, { accion: 'cambiar_monto', ...P, lid: 'L1', monto: 10 }, DUENO), /idempotencia/);
    err(await op(alm, 'cambiar_monto', { lid: 'L1', monto: 0 }), /Monto/);
    err(await op(alm, 'cambiar_monto', { lid: 'noExiste', monto: 10 }), /No existe/);
    err(await op(alm, 'cambiar_monto', { pid: 'noExiste', lid: 'L1', monto: 10 }), /proyecto/);
    err(await op(alm, 'borrar_todo', { lid: 'L1' }), /desconocida/);
    const l = ok(await L.atender(alm, { accion: 'listar', ...P }, DUENO));
    assert.equal(l.licitaciones.length, 2);
    const p = ok(await L.atender(alm, { accion: 'listar', texto: 'pollo' }, DUENO));
    assert.equal(p.licitaciones.length, 1); assert.equal(p.licitaciones[0].pid, 'proyA'); assert.equal(p.licitaciones[0].contrato, 2548.5); assert.equal(p.licitaciones[0].saldo, 2048.5);
    err(await L.atender(alm, { accion: 'listar' }, DUENO), /texto/);
});

prueba('crear por Kay: proveedor por nombre, ítem del presupuesto + renglón libre, adjudicación directa', async () => {
    const alm = base();
    alm.datos.personal.wDate = { nombre: 'Datecolor Industria Gráfica', especialidad: 'imprenta', tipo: 'proveedor' };
    const t = ok(await L.atender(alm, { accion: 'trabajadores', texto: 'datecolor' }, DUENO));
    assert.deepEqual(t.trabajadores.map((w) => w.worker_id), ['wDate']);
    const r = ok(await op(alm, 'crear', { trabajador: 'Datecolor', tipo: 'grafico', estado: 'aprobado',
        alcance: [{ item: 1, monto: 450 }, { descripcion: 'Placa grabada', cant: 2, monto: 300 }] }, KAY));
    assert.equal(r.op, 'crear');
    const l = lic(alm, r.lid);
    assert.equal(l.worker_id, 'wDate'); assert.equal(l.is_grafico, true); assert.equal(l.estado, 'aprobado');
    assert.equal(l.precio_propuesto, 750); assert.equal(l.precio_final, 750);
    assert.equal(l.tareas.m_1.task_name, 'Letrero'); assert.equal(l.tareas.m_1.originIdx, 1);
    assert.equal(l.tareas.libre_1.pu, 150);
    assert.ok(alm.datos.personal.wDate.solicitudes[r.lid], 'copia para el proveedor');
    assert.equal(alm.datos.proyectos.cliA.proyA.presupuesto.items[1].print_resp, 'Datecolor Industria Gráfica', 'responsable de impresión');
    const h = hist(alm).find((x) => x.ref === r.lid);
    assert.equal(h.op, 'crear'); assert.equal(h.por.via, 'whatsapp');
});

prueba('crear: nombre ambiguo, ítem inexistente o sin alcance se rechazan sin escribir', async () => {
    const alm = base();
    err(await op(alm, 'crear', { trabajador: 'Demo', alcance: [{ descripcion: 'x', monto: 1 }] }), /coinciden/);
    err(await op(alm, 'crear', { worker_id: 'wPollo', alcance: [{ item: 9, monto: 1 }] }), /no existe/);
    err(await op(alm, 'crear', { worker_id: 'wPollo', alcance: [] }), /alcance/);
    err(await op(alm, 'crear', { worker_id: 'wPollo', estado: 'terminado', alcance: [{ descripcion: 'x', monto: 1 }] }), /Estado/);
    assert.equal(Object.keys(alm.datos.proyectos.cliA.proyA.licitaciones).length, 2);
});

prueba('registrar_trabajador: alta en Personal (sin sueldo), repetido y aviso si está solo en Proveedores', async () => {
    const alm = base();
    alm.datos.base_datos = { proveedores: { x1: { nombre: 'Datecolor Industria Gráfica', categoria: 'imprenta', telefono: '70000000' } } };
    const b = ok(await L.atender(alm, { accion: 'trabajadores', texto: 'datecolor' }, DUENO));
    assert.equal(b.total, 0); assert.equal(b.en_proveedores[0].nombre, 'Datecolor Industria Gráfica'); assert.match(b.nota, /Personal/);
    const r = ok(await op(alm, 'registrar_trabajador', { nombre: 'Juan Datecolor', tipo: 'graficos', especialidad: 'Imprenta', telefono: '+591 700-00000' }, KAY));
    assert.equal(r.worker_id, 'Juan_Datecolor');
    const w = alm.datos.personal.Juan_Datecolor;
    assert.equal(w.tipo, 'graficos'); assert.equal(w.telefono, '+59170000000'); assert.equal(w.sueldo, undefined); assert.equal(w.creado_por.via, 'whatsapp');
    err(await op(alm, 'registrar_trabajador', { nombre: 'Juan Datecolor', tipo: 'graficos' }), /Ya existe/);
    ok(await op(alm, 'registrar_trabajador', { nombre: 'Juan Datecolor', tipo: 'graficos', telefono: '71111111', actualizar: true }));
    assert.equal(alm.datos.personal.Juan_Datecolor.telefono, '71111111');
    err(await op(alm, 'registrar_trabajador', { nombre: 'X', tipo: 'jefe' }), /Tipo/);
    // ya se le puede licitar
    const c = ok(await op(alm, 'crear', { trabajador: 'datecolor', tipo: 'grafico', alcance: [{ descripcion: 'Vinil', monto: 100 }] }));
    assert.equal(lic(alm, c.lid).worker_id, 'Juan_Datecolor');
});

prueba('ítems de una licitación existente: ver, agregar (del presupuesto y libres), cambiar precio, quitar, anular extra; contrato por diferencia', async () => {
    const alm = conEspejo(base());
    // L1: aprobada, contrato 2.548,50 con la tarea t1 (Armado) del ítem 0
    alm.datos.proyectos.cliA.proyA.licitaciones.L1.extras = { x1: { monto: 300, descripcion: 'Masillado' } };
    const v = ok(await L.atender(alm, { accion: 'ver', ...P, lid: 'L1' }, DUENO));
    assert.deepEqual(v.tareas.map((t) => [t.tarea, t.subtotal]), [['t1', 2548.5]]); assert.equal(v.extras[0].extra, 'x1');
    const a = ok(await op(alm, 'agregar_items', { lid: 'L1', alcance: [{ item: 1, monto: 600 }, { descripcion: 'Desmontaje', monto: 500 }] }, KAY));
    assert.equal(a.contrato_antes, 2548.5); assert.equal(a.contrato, 3648.5);
    const l = lic(alm, 'L1');
    assert.equal(l.precio_final, 3648.5); assert.equal(l.tareas.m_1.task_name, 'Letrero'); assert.equal(l.tareas.m_1.subtotal, 600);
    assert.equal(alm.datos.personal.wPollo.solicitudes.L1.precio_final, 3648.5, 'copia del trabajador');
    assert.ok(Object.values(alm.datos.personal.wPollo.solicitudes.L1.tareas).some((t) => t.task_name === 'Desmontaje'));
    assert.equal(alm.datos.proyectos.cliA.proyA.presupuesto.items[1].prod_resp, 'Pollo Demo', 'responsable en el ítem nuevo');
    err(await op(alm, 'agregar_items', { lid: 'L1', alcance: [{ item: 1, monto: 1 }] }), /ya está/);
    ok(await op(alm, 'cambiar_item', { lid: 'L1', tarea: 'm_1', monto: 450, motivo: 'acordado' }));
    assert.equal(lic(alm, 'L1').precio_final, 3498.5); assert.equal(lic(alm, 'L1').tareas.m_1.pu, 450);
    const libre = Object.keys(lic(alm, 'L1').tareas).find((k) => k.startsWith('libre_'));
    err(await op(alm, 'quitar_item', { lid: 'L1', tarea: libre }), /motivo/);
    ok(await op(alm, 'quitar_item', { lid: 'L1', tarea: libre, motivo: 'no va' }));
    assert.equal(lic(alm, 'L1').precio_final, 2998.5); assert.equal(lic(alm, 'L1').tareas[libre], undefined);
    ok(await op(alm, 'anular_extra', { lid: 'L1', extra: 'x1', motivo: 'pasó a ítem' }));
    assert.equal((lic(alm, 'L1').extras || {}).x1, undefined);
    const ops = hist(alm).filter((h) => h.ref === 'L1').map((h) => h.op);
    assert.deepEqual(ops, ['agregar_items', 'cambiar_item', 'quitar_item', 'anular_extra']);
    // en una no aprobada cambia el propuesto
    ok(await op(alm, 'agregar_items', { lid: 'L2', alcance: [{ descripcion: 'Pintura', monto: 200 }] }));
    assert.equal(lic(alm, 'L2').precio_propuesto, 1000); assert.equal(lic(alm, 'L2').precio_final, undefined);
    // detalle (ficha del PDF) y vincular un trabajo suelto a un ítem del presupuesto, sin cambiar el monto
    ok(await op(alm, 'agregar_items', { lid: 'L2', alcance: [{ descripcion: 'Tesado de lona', detalle: 'Lona front 3x2 en bastidor', cant: 6, und: 'm2', monto: 60 }] }));
    const k2 = Object.keys(lic(alm, 'L2').tareas).find((k) => lic(alm, 'L2').tareas[k].task_name === 'Tesado de lona');
    assert.equal(lic(alm, 'L2').tareas[k2].feat, 'Lona front 3x2 en bastidor');
    ok(await op(alm, 'cambiar_item', { lid: 'L2', tarea: k2, monto: 60, item: 1, detalle: 'Con grapas' }));
    assert.equal(lic(alm, 'L2').tareas[k2].originIdx, 1); assert.equal(lic(alm, 'L2').tareas[k2].feat, 'Con grapas');
    assert.equal(lic(alm, 'L2').precio_propuesto, 1060);
    err(await op(alm, 'cambiar_item', { lid: 'L2', tarea: k2, monto: 60, item: 99 }), /no existe/);
});

let bien = 0;
for (const [nombre, fn] of pruebas) {
    try { await fn(); bien++; console.log('ok  ', nombre); }
    catch (e) { console.log('FALLA', nombre, '\n', e); process.exitCode = 1; }
}
console.log(`\n${bien}/${pruebas.length} pruebas OK`);
