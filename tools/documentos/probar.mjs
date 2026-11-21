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

await prueba('la copia del servidor es idéntica a la de la pantalla', () => {
    assert.equal(readFileSync('../../functions/pdf/compartido/pdf-licitacion.js', 'utf8'), readFileSync('../../public/js/pdf-licitacion.js', 'utf8'),
        'pdf-licitacion.js desactualizado: correr "npm run sincronizar" en tools/documentos');
});

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
});

await prueba('errores: cotización todavía no, licitación o proyecto inexistente, tipo inválido', async () => {
    const al = crearAlmacenMemoria(datos(), D.RUTAS, D.ARCHIVOS);
    await assert.rejects(D.generar(al, { tipo: 'cotizacion', cid: 'cliA', pid: 'proyA' }), (e) => e.status === 501);
    await assert.rejects(D.generar(al, { tipo: 'licitacion', cid: 'cliA', pid: 'proyA', id: 'NO' }), (e) => e.status === 404);
    await assert.rejects(D.generar(al, { tipo: 'licitacion', cid: 'cliA', pid: 'nada', id: 'L1' }), (e) => e.status === 404);
    await assert.rejects(D.generar(al, { tipo: 'otro' }), (e) => e.status === 400);
});

console.log(`\n${bien}/${total} pruebas OK`);
