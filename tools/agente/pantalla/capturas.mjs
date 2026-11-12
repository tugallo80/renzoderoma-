// Capturas en tamaño celular del chat del agente (Firebase y /api/agente simulados; datos inventados).
// Uso: cd tools/agente && node pantalla/capturas.mjs   → deja los PNG en tools/agente/pantalla/salida/
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import http from 'node:http';
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const RAIZ = resolve(new URL('../../..', import.meta.url).pathname);
const SALIDA = resolve(new URL('./salida', import.meta.url).pathname);
mkdirSync(SALIDA, { recursive: true });
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.fbx': 'application/octet-stream', '.pdf': 'application/pdf' };
const srv = http.createServer((req, res) => {
    const ruta = join(RAIZ, decodeURIComponent(req.url.split('?')[0]));
    if (!ruta.startsWith(RAIZ) || !existsSync(ruta) || statSync(ruta).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TIPOS[extname(ruta)] || 'application/octet-stream' });
    res.end(readFileSync(ruta));
}).listen(0);
const URL_BASE = `http://127.0.0.1:${srv.address().port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
await page.goto(`${URL_BASE}/tools/agente/pantalla/arnes.html`);
await page.waitForFunction(() => window.abrirAgenteIA && window.Importar3D);

const paso = process.argv[2] || 'todo';
async function captura(nombre) { await page.waitForTimeout(250); await page.screenshot({ path: join(SALIDA, nombre + '.png') }); console.log('captura', nombre); }

// 1) Chat vacío
await page.evaluate(() => window.abrirAgenteIA());
await captura('1-chat-vacio');

// 2) Adjuntar 3D + PDF + foto juntos (un solo botón)
await page.evaluate(() => { window.AgenteAnotador = null; });
const PDF = Buffer.from('%PDF-1.4\n% planos inventados\n');
const JPG = readFileSync(join(RAIZ, 'public/icons/hub-192.png'));
await page.setInputFiles('#ag-file', [
    { name: 'stand-demo.glb', mimeType: 'model/gltf-binary', buffer: readFileSync(join(RAIZ, 'tools/lector-3d/ejemplos/ejemplo.glb')) },
    { name: 'planos-demo.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: 'totem.png', mimeType: 'image/png', buffer: JPG },
]);
await page.waitForFunction(() => document.querySelectorAll('#ag-adj .ag-chip').length >= 3 && !document.querySelector('#ag-adj .ag-spin'), null, { timeout: 30000 });
await page.fill('#ag-txt', 'Stand para el cliente demo, entrega el viernes 20. Hay que restaurar el tótem y cambiar los adhesivos.');
await captura('2-adjuntos-listos');
const pedidos = await page.evaluate(() => window._pedidosAgente.map((p) => ({ accion: p.accion, tipo: p.tipo, piezas: p.medicion ? p.medicion.piezas.length : null })));
console.log('pedidos', JSON.stringify(pedidos));
if (!pedidos.some((p) => p.tipo === '3d' && p.piezas > 0)) throw new Error('el 3D no se midió');

// 3) Enviar → progreso → respuesta con preguntas y costo
await page.evaluate(() => {
    window._guionAgente = [
        (F, R) => F.set(R + '/estado', { fase: 'trabajando', texto: 'Buscando materiales en la base…', actualizado: Date.now() }),
    ];
});
await page.click('#ag-env');
await page.waitForTimeout(500);
await captura('3-trabajando');
await page.evaluate(() => {
    const F = window._fbFalso, R = 'proyectos/cliDemo/proyDemo/agente';
    const k = '-Z000001';
    F.set(R + '/conversacion/mensajes/' + k, { rol: 'agente', fecha: Date.now(), costo_usd: 0.1843, texto: 'Medí el 3D: **Mostrador** (3 piezas de MDF 18) y **Tótem** (1 pieza de 2,40 × 0,80 m). Armé el borrador con lo que sale del 3D y de la base.\n\nQuedaron marcadas 2 filas: el acrílico no tiene precio en la base.', preguntas: [
        { pregunta: '¿El tótem se restaura completo o solo la cara frontal de 0,80 × 2,40 m?', para_que: 'Ítem "Restauración tótem": define los m² de pintura' },
        { pregunta: '¿Los adhesivos nuevos van en las dos caras laterales del mostrador?', para_que: 'Cantidad de vinil' }] });
    F.set(R + '/estado', { fase: 'esperando_dueno', texto: '', actualizado: Date.now() });
    F.set(R + '/costos/total', { usd: 0.1843, llamadas: 3 });
    F.set('agente_costos/' + window.AgenteNucleo.mesClave() + '/_total', { usd: 25.4, llamadas: 120 });
    F.set(R + '/costos/llamadas/-L1', { fecha: Date.now(), modelo: 'claude-opus-5-5', entrada: 2120, salida: 830, cache_escrita: 15400, cache_leida: 0, usd: 0.1022 });
    F.set(R + '/costos/llamadas/-L2', { fecha: Date.now(), modelo: 'claude-opus-5-5', entrada: 410, salida: 1520, cache_escrita: 900, cache_leida: 15400, usd: 0.0435 });
});
await captura('4-respuesta-preguntas');
await page.click('#ag-costo');
await captura('5-detalle-costos');
await page.click('#ag-costo');
await page.evaluate(() => window._fbFalso.set('proyectos/cliDemo/proyDemo/agente/conversacion/mensajes/-Z000002', { rol: 'aviso', tipo: 'tope', fecha: Date.now(), texto: 'Se llegó al tope mensual del agente (US$ 30.20 de US$ 30.00). Paré antes de seguir gastando.' }));
await page.evaluate(() => window._fbFalso.set('agente_costos/' + window.AgenteNucleo.mesClave() + '/_total', { usd: 30.2, llamadas: 140 }));
await captura('6-tope');

// 7) Borrador con el origen de cada número (armado con la misma herramienta que usa la Function)
await page.evaluate(() => {
    const med = { piezas: [
        { item: 'Mostrador', pieza: 'Tapa', material: 'MDF_18', cant: 1, largo: 1.8, ancho: 0.6, espesor: 0.018, tipo: 'plancha', area_m2: 2.2536, area_cara_m2: 1.08, perimetro_ml: 4.8, volumen_m3: 0.0194, acabados: [] },
        { item: 'Mostrador', pieza: 'Lateral', material: 'MDF_18', cant: 2, largo: 0.9, ancho: 0.6, espesor: 0.018, tipo: 'plancha', area_m2: 1.1448, area_cara_m2: 0.54, perimetro_ml: 3.0, volumen_m3: 0.0097, acabados: [] },
        { item: 'Totem', pieza: 'Cuerpo', material: null, origen_vw: 'Acrilico', cant: 1, largo: 2.4, ancho: 0.8, espesor: 0.3, tipo: 'volumen', area_m2: 5.76, volumen_m3: 0.576, acabados: [] }] };
    const ctx = { adjuntos: { A3D: { tipo: '3d' }, PDF1: { tipo: 'pdf' } }, mediciones: { A3D: med }, mensajesDueno: { M1: true },
        recargosPresupuesto: { cs: 55, ind: 10, util: 30 },
        base: { materiales: { MDF_18: { n: 'MDF 18 mm blanco', u: 'm2', p: 120, mo_receta: [{ mo: 'LAQUEADO', medida: 'm2_sup' }] }, ACRILICO_3: { n: 'Acrílico 3 mm', u: 'm2', p: 0 }, VINIL: { n: 'Vinil de corte', u: 'm2', p: 45 } },
            mano_obra: { LAQUEADO: { n: 'Laqueado', u: 'm2', p: 35 } }, oficios: {}, rendimientos: {} } };
    let n = 0;
    const r = window.AgenteBorrador.aplicarOperaciones(null, [
        { op: 'item_desde_3d', capitulo: 'Stand demo', adjunto: 'A3D', item3d: 'Mostrador', desc: 'Mostrador recepción' },
        { op: 'fila', item: 'Mostrador recepción', tipo: 'mat', d: 'Adhesivo lateral', u: 'und', q: 3, origen_q: 'dueño:M1', p: 50, origen_p: 'dueño:M1' },
        { op: 'item_desde_3d', capitulo: 'Stand demo', adjunto: 'A3D', item3d: 'Totem', desc: 'Restauración tótem', materiales: { p3: 'ACRILICO_3' } },
        { op: 'fila', item: 'Restauración tótem', tipo: 'mat', d: 'Vinil frente', origen_q: 'cota_plano:PDF1 p.2 "0,80 x 2,40"', q: 1.92, clave: 'VINIL' },
    ], ctx, () => 'id' + (++n));
    window._fbFalso.set('proyectos/cliDemo/proyDemo/agente/borrador', r.borrador);
});
await page.click('#ag-tab');
await captura('7-borrador');
await page.evaluate(() => document.getElementById('ag-borr').scrollTo(0, 99999));
await captura('8-borrador-total');

console.log(errores.length ? 'ERRORES EN LA PÁGINA:\n' + errores.join('\n') : 'sin errores en la página');
await browser.close(); srv.close();
if (errores.length) process.exitCode = 1;
