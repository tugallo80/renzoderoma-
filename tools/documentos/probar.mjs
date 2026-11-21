// Pruebas de functions/documentos (PDF de la licitación en el servidor) con la base EN MEMORIA. Datos inventados.
// Uso: cd tools/documentos && npm test   (deja las páginas en PNG en ./salida para mirarlas)
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const D = require('../../functions/documentos/index.js');
const { crearAlmacenMemoria } = require('../agente/almacen-memoria.cjs');
const sharp = require('../../functions/node_modules/sharp');

const foto = 'data:image/png;base64,' + (await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 230, g: 120, b: 40 } } }).png().toBuffer()).toString('base64');
const datos = () => ({ proyectos: { cliA: { proyA: {
    nombre: 'Trofeo Demo',
    presupuesto: { items: [
        { desc: 'Trofeo acero inox', cant: 1, und: 'pza', feat: 'Cono de acero inoxidable rolado de 61 cm, medalla interior y base MDF laqueada.', img: foto,
            prod_apu: { mat: [{ d: 'Plancha acero inox 0.8 mm', q: 1, u: 'pl', p: 900 }, { d: 'Vinil azul metalizado', q: 2, u: 'm2', p: 60 }],
                mo: [{ d: 'Rolado y soldadura', q: 6, u: 'hr', p: 35 }] } },
        { desc: 'Cruz acrílico', cant: 1, und: 'pza', img: 'https://ejemplo.com/no-permitida.jpg' },
    ] },
    licitaciones: { L1: { worker_name: 'Imprenta Demo', worker_id: 'w1', precio_propuesto: 1500, estado: 'aprobado', lic_mode: 'mo', tareas: {
        m_0: { parent_desc: 'ÍTEM PRINCIPAL', task_name: 'Trofeo acero inox', subtotal: 1200, cant: 1, und: 'pza', pu: 1200, originIdx: 0, originType: 'main', fecha_entrega: '2026-11-28' },
        m_1: { parent_desc: 'ÍTEM PRINCIPAL', task_name: 'Cruz acrílico', subtotal: 300, cant: 1, und: 'pza', pu: 300, originIdx: 1, originType: 'main', fecha_entrega: 'Sin fecha' },
    } } },
} } } });

let bien = 0, total = 0;
async function prueba(n, fn) { total++; try { await fn(); bien++; console.log('ok  ', n); } catch (e) { console.log('FALLA', n, '\n', e); process.exitCode = 1; } }

await prueba('las copias del servidor son idénticas a las de la pantalla', () => {
    for (const f of ['pdf-licitacion.js', 'pdf-cotizacion.js', 'pdf-produccion.js', 'pdf-liquidacion.js', 'pdf-rendicion.js', 'pdf-contratista.js'])
        assert.equal(readFileSync('../../functions/pdf/compartido/' + f, 'utf8'), readFileSync('../../public/js/' + f, 'utf8'),
            f + ' desactualizado: correr "npm run sincronizar" en tools/documentos');
});

const textoPdf = async (base64) => {
    const pdfjs = await import('../../functions/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
    const tarea = pdfjs.getDocument({ data: new Uint8Array(Buffer.from(base64, 'base64')), isEvalSupported: false });
    const doc = await tarea.promise; let t = '';
    for (let i = 1; i <= doc.numPages; i++) t += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + '\n';
    await tarea.destroy(); return t;
};
const paginasPng = async (base64, prefijo) => {
    const pdfjs = await import('../../functions/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas } = require('../../functions/node_modules/@napi-rs/canvas');
    const tarea = pdfjs.getDocument({ data: new Uint8Array(Buffer.from(base64, 'base64')), disableFontFace: true, isEvalSupported: false });
    const doc = await tarea.promise;
    mkdirSync('salida', { recursive: true });
    for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i); const vp = p.getViewport({ scale: 1.3 });
        const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
        await p.render({ canvasContext: c.getContext('2d'), viewport: vp, canvas: c }).promise;
        writeFileSync(`salida/${prefijo}-${i}.png`, await c.encode('png'));
    }
    const n = doc.numPages; await tarea.destroy(); return n;
};

await prueba('licitación modo general: PDF válido, guardado en Storage, fotos solo de nuestro Storage', async () => {
    const al = crearAlmacenMemoria(datos(), D.RUTAS, D.ARCHIVOS);
    const r = await D.generar(al, { tipo: 'licitacion', cid: 'cliA', pid: 'proyA', id: 'L1' });
    assert.equal(r.mime, 'application/pdf');
    assert.equal(r.nombre, 'propuesta_general_Trofeo_Demo_L1.pdf');
    assert.ok(Buffer.from(r.base64, 'base64').subarray(0, 5).toString() === '%PDF-');
    assert.equal(r.paginas, 3, 'portada + anexo de cada ítem (la foto de la cruz no es de nuestro Storage: se omite, como en la pantalla si no carga)');
    assert.ok(al.archivos.has('documentos/cliA/proyA/propuesta_general_Trofeo_Demo_L1.pdf'));
    assert.equal(await paginasPng(r.base64, 'general'), 3);
});

await prueba('licitación modo detalle: materiales y mano de obra del ítem', async () => {
    const al = crearAlmacenMemoria(datos(), D.RUTAS, D.ARCHIVOS);
    const r = await D.generar(al, { tipo: 'licitacion', cid: 'cliA', pid: 'proyA', id: 'L1', modo: 'detalle' });
    assert.equal(r.nombre, 'propuesta_detallada_Trofeo_Demo_L1.pdf');
    await paginasPng(r.base64, 'detalle');
    const txt = await textoPdf(r.base64);
    assert.match(txt, /TRABAJO CONTRATADO/); assert.match(txt, /TOTAL CONTRATADO/);
    assert.match(txt, /Plancha acero inox 0\.8 mm/, 'el material sale como referencia');
    assert.doesNotMatch(txt, /900,00/, 'sin el precio interno del material (900 Bs)');
    assert.doesNotMatch(txt, /35,00/, 'sin el precio interno de la mano de obra (35 Bs/hr)');
    // llave en mano: los precios acordados con el contratista sí salen
    const d = datos(); const L = d.proyectos.cliA.proyA.licitaciones.L1;
    L.lic_mode = 'llave_en_mano';
    L.tareas = { a: { parent_desc: 'Trofeo acero inox', task_name: 'Plancha inox', originType: 'llm_mat', originIdx: 0, cant: 1, und: 'pl', pu: 700, subtotal: 700 },
        b: { parent_desc: 'Trofeo acero inox', task_name: 'Rolado y soldado', originType: 'llm_mo', originIdx: 0, cant: 1, und: 'glb', pu: 800, subtotal: 800 } };
    const llm = await D.generar(crearAlmacenMemoria(d, D.RUTAS, D.ARCHIVOS), { tipo: 'licitacion', cid: 'cliA', pid: 'proyA', id: 'L1', modo: 'detalle' });
    const t2 = await textoPdf(llm.base64);
    assert.match(t2, /TOTAL MATERIALES/); assert.match(t2, /700,00/);
});

await prueba('errores: licitación o proyecto inexistente, tipo inválido', async () => {
    const al = crearAlmacenMemoria(datos(), D.RUTAS, D.ARCHIVOS);
    await assert.rejects(D.generar(al, { tipo: 'licitacion', cid: 'cliA', pid: 'proyA', id: 'NO' }), (e) => e.status === 404);
    await assert.rejects(D.generar(al, { tipo: 'licitacion', cid: 'cliA', pid: 'nada', id: 'L1' }), (e) => e.status === 404);
    await assert.rejects(D.generar(al, { tipo: 'otro' }), (e) => e.status === 400);
});

const conPresupuesto = () => {
    const d = datos();
    d.clientes = { cliA: { nombre: 'Strativa Demo' } };
    const p = d.proyectos.cliA.proyA;
    p.presupuesto.items.unshift({ type: 'chapter', name: 'Trofeos' });
    p.presupuesto.items.forEach((it) => { if (it.type !== 'chapter') { it.pu = it.desc.startsWith('Trofeo') ? 1450 : 180; it.prod_resp = 'Imprenta Demo';
        it.proceso_ia = [{ m: 'Roladora', d: 'Rolar la plancha en cono' }]; } });
    p.presupuesto.items.push({ desc: 'Vinil adhesivo azul metalizado', und: 'm2', cant: 2, pu: 60, measures: [{ d: 'Franjas', b: 61, h: 10, c: 8 }] });
    Object.assign(p.presupuesto, { fecha: '2026-11-21', impuestos: true, descuento: 50, descuento_pct: 0, cond: { pago: '50% / 50%', validez: '15 días', montaje: true } });
    p.monto_cierre = 0;
    p.artes_data = { 3: [{ id: 'manual_1', nombre: 'Franjas cono', base: 61, altura: 10, cantidad: 8, material: 'Adhesivo Vinílico', precio: 60, imgRef: foto }] };
    return d;
};

await prueba('cotización: normal (vertical) e impuestos por ítem (horizontal), con anexo fotográfico y nombre de archivo', async () => {
    const al = crearAlmacenMemoria(conPresupuesto(), D.RUTAS, D.ARCHIVOS);
    const n = await D.generar(al, { tipo: 'cotizacion', cid: 'cliA', pid: 'proyA' });
    assert.match(n.nombre, /^\d{4}_TROFEO_DEMO_STRATIVA_DEMO\.pdf$/);
    assert.ok(n.paginas >= 2, 'tabla + anexo fotográfico');
    await paginasPng(n.base64, 'cotizacion');
    const i = await D.generar(al, { tipo: 'cotizacion', cid: 'cliA', pid: 'proyA', modo: 'impuestos_por_item' });
    assert.match(i.nombre, /_CON_IMP\.pdf$/);
    await paginasPng(i.base64, 'cotizacion-imp');
    await assert.rejects(D.generar(crearAlmacenMemoria({ proyectos: { cliA: { proyA: { nombre: 'Vacío' } } } }, D.RUTAS, D.ARCHIVOS),
        { tipo: 'cotizacion', cid: 'cliA', pid: 'proyA' }), (e) => e.status === 404);
});

await prueba('órdenes: producción, impresión (artes guardadas + las de las medidas), solo con imagen y completa', async () => {
    const al = crearAlmacenMemoria(conPresupuesto(), D.RUTAS, D.ARCHIVOS);
    const P = require('../../functions/pdf/compartido/pdf-produccion.js');
    const artes = P.armarArtes(al.datos.proyectos.cliA.proyA.presupuesto.items, al.datos.proyectos.cliA.proyA.artes_data);
    assert.equal(artes[3][0].id, 'manual_1', 'la guardada manda (no se rearma desde las medidas)');
    const sufijos = {};
    for (const modo of D.TIPOS_ORDEN) {
        const r = await D.generar(al, { tipo: 'orden', cid: 'cliA', pid: 'proyA', modo });
        sufijos[modo] = r.nombre.replace(/^\d{4}_Trofeo_Demo_Strativa_Demo_/, '');
        await paginasPng(r.base64, 'orden-' + modo);
    }
    assert.deepEqual(sufijos, { produccion: 'ESTRUCTURAS.pdf', impresion: 'ORDEN_IMPRESION.pdf', impresion_con_imagen: 'ORDEN_IMPRESION.pdf', completa: 'ORDEN_COMPLETA.pdf' });
});

await prueba('liquidación de contrato: acordado, anticipos, saldo y comprobante', async () => {
    const d = datos();
    d.proyectos.cliA.proyA.licitaciones.L1.pagos = {
        p1: { monto: 500, fecha: '2026-11-15', nota: 'Anticipo', tipo: 'adelanto', comprobante: foto },
        p2: { monto: 200, fecha: '2026-11-18', nota: 'Segundo anticipo', tipo: 'adelanto' } };
    const al = crearAlmacenMemoria(d, D.RUTAS, D.ARCHIVOS);
    const r = await D.generar(al, { tipo: 'liquidacion', cid: 'cliA', pid: 'proyA', id: 'L1' });
    assert.equal(r.nombre, 'Liquidacion_Imprenta_Demo.pdf');
    assert.ok(r.paginas >= 3, 'resumen + anexo técnico + comprobantes');
    await paginasPng(r.base64, 'liquidacion');
});

await prueba('liquidación del caso de Pollo: contrato 3.000 + extra 300, rendición 1.500 entregado / 1.590 aprobado → total a pagar 3.390', async () => {
    const d = datos();
    d.personal = { wPollo: { nombre: 'POLLO', telefono: '70000001' } };
    const L = d.proyectos.cliA.proyA.licitaciones.L1;
    Object.assign(L, { worker_id: 'wPollo', worker_name: 'POLLO', precio_final: 3000, precio_propuesto: 3000,
        extras: { e1: { monto: 300, descripcion: 'Mantenimiento y masillado de todo', fecha: '2026-11-21' } }, pagos: null });
    d.caja_chica = { wPollo: {
        depositos: { a: { monto: 1500, fecha: '2026-11-21', nota: 'Anticipo caja chica', pid: 'proyA', cid: 'cliA', proyecto: 'Trofeo Demo' } },
        gastos: { b: { monto: 1590, fecha: '2026-11-21', concepto: 'Insumos y fletes', pid: 'proyA', cid: 'cliA', proyecto: 'Trofeo Demo', estado: 'aprobado' } },
        otro: null } };
    d.caja_chica.wPollo.depositos.z = { monto: 999, fecha: '2026-11-21', nota: 'De otro proyecto', pid: 'otroP' };
    const r = await D.generar(crearAlmacenMemoria(d, D.RUTAS, D.ARCHIVOS), { tipo: 'liquidacion', cid: 'cliA', pid: 'proyA', id: 'L1' });
    const txt = await textoPdf(r.base64);
    assert.match(txt, /EXTRAS \(1\)/); assert.match(txt, /MONTO TOTAL ACORDADO\s+3\.300,00 Bs/);
    assert.match(txt, /SALDO DEL CONTRATO\s+3\.300,00 Bs/);
    assert.match(txt, /A FAVOR DEL CONTRATISTA \(se le suma\)\s+90,00 Bs/, 'solo la plata de este proyecto (no los 999 de otro)');
    assert.match(txt, /TOTAL A PAGAR: 3\.390,00 Bs/);
    await paginasPng(r.base64, 'liquidacion-pollo');
});

await prueba('rendición de cuentas: entregado, gastos con estado, saldo y recibos', async () => {
    const d = datos();
    d.personal = { wPollo: { nombre: 'Pollo Demo', telefono: '70000001' } };
    d.caja_chica = { wPollo: {
        depositos: { a: { monto: 500, fecha: '2026-11-02', nota: 'Para materiales', proyecto: 'Trofeo Demo' } },
        gastos: { b: { monto: 120, fecha: '2026-11-03', concepto: 'Pintura', proveedor: 'Ferretería', proyecto: 'Trofeo Demo', estado: 'aprobado', comprobante: foto },
            c: { monto: 45, fecha: '2026-11-04', concepto: 'Taxi', estado: 'pendiente' }, e: { monto: 80, fecha: '2026-11-05', concepto: 'Almuerzo', estado: 'rechazado' } } } };
    const r = await D.generar(crearAlmacenMemoria(d, D.RUTAS, D.ARCHIVOS), { tipo: 'rendicion', worker_id: 'wPollo' });
    const txt = await textoPdf(r.base64);
    assert.match(txt, /RENDICIÓN DE CUENTAS/); assert.match(txt, /335,00/, 'saldo en mano 500 − 120 − 45');
    await paginasPng(r.base64, 'rendicion');
});

await prueba('balance completo del contratista (Tesorería): todos sus contratos con extras, pagos y rendición → total a pagar', async () => {
    const d = datos();
    d.personal = { wPollo: { nombre: 'POLLO', telefono: '70000001' } };
    const L = d.proyectos.cliA.proyA.licitaciones.L1;
    Object.assign(L, { worker_id: 'wPollo', worker_name: 'POLLO', precio_final: 3000, precio_propuesto: 3000,
        extras: { e1: { monto: 300, descripcion: 'Masillado', fecha: '2026-11-21' } }, pagos: { p1: { monto: 1000, fecha: '2026-11-20', tipo: 'adelanto' } } });
    d.caja_chica = { wPollo: {
        depositos: { a: { monto: 1500, fecha: '2026-11-21', pid: 'proyA', cid: 'cliA' } },
        gastos: { b: { monto: 1590, fecha: '2026-11-21', concepto: 'Insumos', pid: 'proyA', cid: 'cliA', estado: 'aprobado' } } } };
    const al = crearAlmacenMemoria(d, D.RUTAS, D.ARCHIVOS);
    const r = await D.generar(al, { tipo: 'contratista', worker_id: 'wPollo' });
    assert.match(r.nombre, /^Contratista_POLLO_/);
    const txt = await textoPdf(r.base64);
    assert.match(txt, /3\.300,00/, 'acordado con el extra');
    assert.match(txt, /2\.390,00/, '3.300 − 1.000 pagado + 90 de la rendición');
    const porNombre = await D.generar(crearAlmacenMemoria(datos(), D.RUTAS, D.ARCHIVOS), { tipo: 'contratista', nombre: 'nadie' }).catch((e) => e);
    assert.ok(porNombre instanceof Error || porNombre.status === 404);
    await paginasPng(r.base64, 'contratista');
});

console.log(`\n${bien}/${total} pruebas OK`);
