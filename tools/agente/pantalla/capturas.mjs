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
const vistas = await page.evaluate(() => (window._pedidosAgente.find((p) => p.tipo === '3d').vistas || []).map((v) => ({ nombre: v.nombre, datos: v.datos })));
console.log('vistas del 3D', vistas.map((v) => v.nombre + ' ' + Math.round(v.datos.length * 0.75 / 1024) + ' KB').join(', '));
if (vistas.length !== 2) throw new Error('faltan las vistas del 3D');
const { writeFileSync } = await import('node:fs');
vistas.forEach((v, i) => writeFileSync(join(SALIDA, `2b-vista-3d-${i + 1}.jpg`), Buffer.from(v.datos, 'base64')));

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
        base: { materiales: { MDF_18: { n: 'MDF 18 mm blanco', u: 'm2', p: 120, mo_receta: [{ mo: 'LAQUEADO', medida: 'm2_sup' }] }, ACRILICO_3: { n: 'Acrílico 3 mm', u: 'm2', p: 0 }, VINIL: { n: 'Vinil de corte', u: 'm2', p: 45 }, TUBO: { n: 'Tubo 20×40', u: 'ml', p: 18 }, TUBO20: { n: 'Tubo 20×20', u: 'und', p: 60 }, LONA: { n: 'Lona front 13 oz', u: 'm2', p: 40 } },
            mano_obra: { LAQUEADO: { n: 'Laqueado', u: 'm2', p: 35 } }, oficios: {}, rendimientos: {} } };
    let n = 0;
    const r = window.AgenteBorrador.aplicarOperaciones(null, [
        { op: 'item_desde_3d', capitulo: 'Stand demo', adjunto: 'A3D', item3d: 'Mostrador', desc: 'Mostrador recepción', caracteristicas: [
            { texto: 'Frente de 1,80 m × 0,60 m', origen: 'pieza3d:A3D/p1' }, { texto: 'MDF 18 mm laqueado blanco', origen: 'base:materiales/MDF_18' },
            { texto: 'Logo en vinil de 40 cm', origen: 'supuesto:logo proporcional al frente' }, { texto: 'Incluye traslado e instalación; no incluye diseño' }] },
        { op: 'fila', item: 'Mostrador recepción', tipo: 'mat', d: 'Adhesivo lateral', u: 'und', q: 3, origen_q: 'dueño:M1', p: 50, origen_p: 'dueño:M1' },
        { op: 'item_desde_3d', capitulo: 'Stand demo', adjunto: 'A3D', item3d: 'Totem', desc: 'Restauración tótem', materiales: { p3: 'ACRILICO_3' } },
        { op: 'fila', item: 'Restauración tótem', tipo: 'mat', d: 'Vinil frente', origen_q: 'cota_plano:PDF1 p.2 "0,80 x 2,40"', q: 1.92, clave: 'VINIL' },
        { op: 'fila', item: 'Restauración tótem', tipo: 'mo', d: '', origen_q: 'dueño:M1', cerrado: true, p: 1000, origen_p: 'dueño:M1', oficio: 'Don Pedro' },
        { op: 'item', capitulo: 'Stand demo', desc: 'Bastidor con lona 5×3' },
        { op: 'fila', item: 'Bastidor con lona 5×3', tipo: 'mat', d: 'Marco y travesaños', origen_q: 'supuesto:marco perimetral + travesaño cada 1 m', medida: 'ml_largo',
            geometria: [{ desc: 'larguero', cant: 2, largo_m: 5 }, { desc: 'montante', cant: 6, largo_m: 3 }], clave: 'TUBO' },
        { op: 'fila', item: 'Bastidor con lona 5×3', tipo: 'mat', d: 'Lona', origen_q: 'supuesto:lona tensada del tamaño del marco', medida: 'm2_cara', geometria: [{ cant: 1, largo_m: 5, ancho_m: 3 }], clave: 'LONA' },
        { op: 'fila', item: 'Bastidor con lona 5×3', tipo: 'mat', d: 'Patas tubo 20×20', u: 'und', q: 8, origen_q: 'dueño:M1', clave: 'TUBO20', stock_q: 5, origen_stock: 'dueño:M1' },
    ], ctx, () => 'id' + (++n));
    window._fbFalso.set('proyectos/cliDemo/proyDemo/agente/borrador', r.borrador);
});
await page.click('#ag-tab');
await captura('7-borrador');
const feat = await page.evaluate(() => window.AgenteBorrador.aItemsPresupuesto(window._fbFalso.get('proyectos/cliDemo/proyDemo/agente/borrador')).find((x) => x.desc === 'Mostrador recepción').feat);
console.log('feat', JSON.stringify(feat));
if (!/MDF 18 mm/.test(feat) || /Logo/.test(feat)) throw new Error('características mal');
await page.evaluate(() => document.getElementById('ag-borr').scrollTo(0, 99999));
await captura('8-borrador-total');
await page.evaluate(() => { const its = document.querySelectorAll('#ag-borr .ag-it'); its[its.length - 1].scrollIntoView({ block: 'start' }); });
await captura('8b-supuestos-stock-trato');

// 9) Editor de anotaciones: foto inventada (dibujada en el navegador), cota, círculo y nota
await page.click('#ag-tab');
const fotoB64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 1600; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 1600); g.addColorStop(0, '#c9d6df'); g.addColorStop(1, '#8a9ba8'); x.fillStyle = g; x.fillRect(0, 0, 1200, 1600);
    x.fillStyle = '#6d4c41'; x.fillRect(0, 1350, 1200, 250);
    x.fillStyle = '#263238'; x.fillRect(420, 250, 360, 1150); x.fillStyle = '#ef6c00'; x.fillRect(450, 300, 300, 700);
    x.fillStyle = '#fff'; x.font = 'bold 70px sans-serif'; x.fillText('DEMO', 500, 600);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
});
await page.setInputFiles('#ag-file', [{ name: 'totem-foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(fotoB64, 'base64') }]);
await page.waitForSelector('#ag-adj button[aria-label="Anotar la foto"]');
await page.click('#ag-adj button[aria-label="Anotar la foto"]');
await page.waitForSelector('#mod-anot', { state: 'visible' });
await page.waitForTimeout(300);
const caja = await page.locator('#an-svg').boundingBox();
const P = (fx, fy) => [caja.x + caja.width * fx, caja.y + caja.height * fy];
async function arrastrar(a, b) { await page.mouse.move(...a); await page.mouse.down(); await page.mouse.move(...b, { steps: 6 }); await page.mouse.up(); }
// cota del alto del tótem (de arriba a abajo, a la derecha)
await arrastrar(P(0.70, 0.156), P(0.70, 0.875));
await page.fill('#an-in-0', '2,40 m'); await page.fill('#an-in-1', 'alto total del tótem'); await page.click('#an-b-ok');
// cota del ancho, con ticks
await page.click('#an-ext');
await arrastrar(P(0.35, 0.93), P(0.65, 0.93));
await page.fill('#an-in-0', '0,80 m'); await page.click('#an-b-ok');
// círculo en el cartel naranja y nota
await page.click('[data-h="circulo"]');
await arrastrar(P(0.38, 0.33), P(0.62, 0.42));
await page.click('[data-h="nota"]');
await page.mouse.click(...P(0.25, 0.55));
await page.fill('#an-in-0', 'restaurar pintura'); await page.click('#an-b-ok');
await captura('9-editor-anotaciones');
// deshacer y rehacer
await page.click('#an-undo'); await page.click('#an-redo');
await page.click('#mod-anot .prim');
await page.waitForFunction(() => window._pedidosAgente.some((p) => p.anotaciones));
const anot = await page.evaluate(() => window._pedidosAgente.find((p) => p.anotaciones));
console.log('anotaciones', JSON.stringify(anot.anotaciones));
if (anot.anotaciones.length !== 4 || !anot.anotada || anot.anotaciones[0].valor !== '2,40 m') throw new Error('anotaciones mal');
await page.waitForTimeout(300);
await captura('10-foto-anotada-lista');
await page.evaluate(() => { const b = document.createElement('canvas'); });
const anotadaB64 = anot.anotada;
await page.evaluate((b64) => { const w = window.open ? null : null; document.body.insertAdjacentHTML('beforeend', '<img id="anotada-prueba" style="position:fixed;inset:0;z-index:99999;width:100%;height:100%;object-fit:contain;background:#000;" src="data:image/jpeg;base64,' + b64 + '">'); }, anotadaB64);
await captura('11-imagen-anotada-que-recibe-el-agente');

// 12) Aplicar al presupuesto
await page.evaluate(() => document.getElementById('anotada-prueba').remove());
page.on('dialog', (d) => d.accept());
await page.click('#ag-tab');
await page.evaluate(() => document.getElementById('ag-borr').scrollTo(0, 99999));
await captura('12-aplicar');
await page.click('#ag-aplicar .ag-btn.prim');
await page.waitForTimeout(300);
const aplicado = await page.evaluate(() => ({ ids: data.map((x) => x.desc || x.name), origen: data.filter((x) => x.type === 'item').map((x) => x.origen), guardado: window._guardado }));
console.log('presupuesto', JSON.stringify(aplicado));
if (aplicado.ids[0] !== 'Ítem que ya estaba' || !aplicado.guardado || aplicado.origen.filter((o) => o === 'agente').length !== 2) throw new Error('aplicar falló');
if (aplicado.ids.includes('Bastidor con lona 5×3')) throw new Error('se aplicó un ítem con supuestos sin confirmar');
await page.click('.ag-sup .ag-btn.prim');
await page.waitForTimeout(300);
await page.click('#ag-aplicar .ag-btn.prim');
await page.waitForTimeout(300);
const tras = await page.evaluate(() => data.map((x) => x.desc || x.name));
console.log('después de confirmar', JSON.stringify(tras));
if (!tras.includes('Bastidor con lona 5×3') || tras.filter((x) => x === 'Mostrador recepción').length !== 1) throw new Error('confirmar supuestos / re-aplicar falló');
await page.evaluate(() => document.getElementById('ag-borr').scrollTo(0, 99999));
await captura('13-aplicado');

// 14) Desde la etiqueta "Agente" del presupuesto: abre el chat con el ítem en foco
await page.evaluate(() => { window.cerrarAgenteIA(); const it = data.find((x) => x.desc === 'Restauración tótem'); window.abrirAgenteIA(null, { item: it.id, desc: it.desc }); });
await page.waitForTimeout(900);
const fo = await page.evaluate(() => ({ txt: document.getElementById('ag-txt').value, borr: document.getElementById('ag-borr').style.display,
    top: (() => { const el = document.querySelector('#ag-borr .ag-it[data-id]'); const all = [...document.querySelectorAll('#ag-borr .ag-it')]; const t = all.find((x) => x.textContent.includes('Restauración tótem')); return t.getBoundingClientRect().top; })() }));
console.log('foco', JSON.stringify(fo));
if (fo.txt !== 'Sobre «Restauración tótem»: ' || fo.borr !== 'block' || fo.top > 400) throw new Error('el foco del ítem no funcionó');
await captura('14-foco-desde-presupuesto');

// 14b) Edición a mano sin IA
await page.evaluate(() => { window._agVerBorrador(true); });
await page.click('#ag-borr .ag-it[data-id] .ag-ed');
await page.waitForSelector('#ag-edit', { state: 'visible' });
await page.fill('#ag-e-cant', '2');
await captura('14b-edicion-a-mano');
await page.click('#ag-e-ok');
await page.waitForTimeout(400);
const ed = await page.evaluate(() => ({ cant: window._fbFalso.get('proyectos/cliDemo/proyDemo/agente/borrador/capitulos/0/items/0/cant'),
    ediciones: Object.keys(window._fbFalso.get('proyectos/cliDemo/proyDemo/agente/conversacion/ediciones') || {}).length,
    pedidosNuevos: window._pedidosAgente.filter((p) => p.accion === 'enviar').length }));
console.log('edición a mano', JSON.stringify(ed));
if (ed.cant !== 2 || ed.ediciones !== 1) throw new Error('la edición a mano no se guardó');
await page.click('#mod-agente .ag-ico[aria-label="Configuración"]');
await captura('14c-config-modelo-correcciones');
await page.click('#mod-agente .ag-ico[aria-label="Configuración"]');

// 15) Varias conversaciones: ＋ Nueva empieza de cero; la anterior queda en la lista
await page.evaluate(() => { window._agVerBorrador(false); });
await page.click('#ag-convbar .ag-btn');
await page.waitForTimeout(400);
const nueva = await page.evaluate(() => ({ msgs: document.querySelectorAll('#ag-msgs .ag-m').length, tab: document.getElementById('ag-tab').style.display, titulo: document.querySelector('#ag-convbar b').textContent }));
console.log('nueva', JSON.stringify(nueva));
if (nueva.msgs !== 0 || nueva.tab !== 'none') throw new Error('la conversación nueva no arrancó vacía');
await captura('15-conversacion-nueva');
await page.click('#ag-convbar .ag-convsel');
await page.waitForTimeout(300);
await captura('16-lista-conversaciones');
const filas = await page.evaluate(() => document.querySelectorAll('#ag-p-convs > div[style*="border-bottom"]').length);
if (filas !== 2) throw new Error('la lista debería tener 2 conversaciones y tiene ' + filas);
// volver a la primera
await page.click('#ag-p-convs > div[style*="border-bottom"]:last-child span');
await page.waitForTimeout(400);
const vuelta = await page.evaluate(() => document.querySelectorAll('#ag-msgs .ag-m').length);
console.log('mensajes al volver a la primera', vuelta);
if (vuelta < 2) throw new Error('no volvió a la primera conversación');

// 17) Arrastrar y soltar sobre el panel, y pegar del portapapeles
await page.evaluate(() => { window._agNueva(); });
await page.waitForTimeout(400);
const antesDrop = await page.evaluate(() => window._pedidosAgente.filter((p) => p.accion === 'adjuntar').length);
await page.evaluate(async () => {
    const png = await new Promise((r) => { const c = document.createElement('canvas'); c.width = 320; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#e53935'; x.fillRect(0, 0, 320, 200); c.toBlob(r, 'image/png'); });
    const dt = new DataTransfer();
    dt.items.add(new File([png], 'foto-del-cliente.png', { type: 'image/png' }));
    dt.items.add(new File(['%PDF-1.4\n% inventado'], 'lista-de-items.pdf', { type: 'application/pdf' }));
    const caja = document.querySelector('#mod-agente .ag-box');
    caja.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    caja.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    window._zonaVisible = document.getElementById('ag-soltar').style.display;
    caja.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
});
await page.waitForFunction((n) => window._pedidosAgente.filter((p) => p.accion === 'adjuntar').length >= n + 2, antesDrop, { timeout: 15000 });
const drop = await page.evaluate((n) => ({ zona: window._zonaVisible, zonaDespues: document.getElementById('ag-soltar').style.display,
    nuevos: window._pedidosAgente.filter((p) => p.accion === 'adjuntar').slice(n).map((p) => p.tipo + ':' + p.nombre) }), antesDrop);
console.log('drop', JSON.stringify(drop));
if (drop.zona !== 'flex' || drop.zonaDespues !== 'none' || !drop.nuevos.includes('imagen:foto-del-cliente.png') || !drop.nuevos.includes('pdf:lista-de-items.pdf')) throw new Error('arrastrar y soltar falló');
// pegar: una captura sin nombre (como la de Ctrl+V) junto con texto → el texto queda, la imagen va como adjunto "captura-…"
await page.fill('#ag-txt', 'Mirá esto: ');
await page.evaluate(async () => {
    const png = await new Promise((r) => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; c.getContext('2d').fillRect(0, 0, 400, 300); c.toBlob(r, 'image/png'); });
    const dt = new DataTransfer();
    dt.items.add(new File([png], 'image.png', { type: 'image/png' }));
    dt.setData('text/plain', 'texto copiado del mail');
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    document.getElementById('ag-txt').dispatchEvent(ev);
    window._pegadoCancelado = ev.defaultPrevented;
});
await page.waitForFunction((n) => window._pedidosAgente.filter((p) => p.accion === 'adjuntar').length >= n + 3, antesDrop, { timeout: 15000 });
const pegado = await page.evaluate(() => ({ ultimo: window._pedidosAgente.filter((p) => p.accion === 'adjuntar').at(-1).nombre, cancelado: window._pegadoCancelado }));
console.log('pegado', JSON.stringify(pegado));
if (!/^captura-\d{4}-\d{2}-\d{2}-\d{4}\.png$/.test(pegado.ultimo) || pegado.cancelado) throw new Error('pegar falló');
await page.waitForTimeout(300);
await captura('17-soltar-y-pegar');
// la zona resaltada mientras se arrastra
await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'x.pdf', { type: 'application/pdf' })); document.querySelector('#mod-agente .ag-box').dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true })); });
await captura('18-zona-soltar');

// 19) Adjunto que falla: un 503 suelto se reintenta solo; si sigue fallando, Enviar pregunta "¿reintentar o enviar sin él?"
await page.evaluate(() => { window._agNueva(); });
await page.waitForTimeout(400);
await page.evaluate(() => { window._fallarAdjuntar = 1; });
await page.setInputFiles('#ag-file', [{ name: 'lista-cliente.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% lista inventada') }]);
await page.waitForFunction(() => document.querySelector('#ag-adj .ag-chip') && !document.querySelector('#ag-adj .ag-spin'), null, { timeout: 20000 });
const solo = await page.evaluate(() => document.querySelector('#ag-adj .ag-chip').className);
console.log('503 suelto', solo);
if (/error/.test(solo)) throw new Error('el 503 suelto no se reintentó solo');
await page.evaluate(() => { document.querySelector('#ag-adj .ag-chip button[aria-label="Quitar"]').click(); window._fallarAdjuntar = 10; });
await page.setInputFiles('#ag-file', [{ name: 'lista-cliente.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% lista inventada') }]);
await page.waitForSelector('#ag-adj .ag-chip.error', { timeout: 30000 });
await page.fill('#ag-txt', 'Cotizá según la lista');
await page.click('#ag-env');
await page.waitForSelector('#ag-f-re', { state: 'visible' });
await captura('19-adjunto-fallido');
await page.evaluate(() => { window._fallarAdjuntar = 0; });
const enviadosAntes = await page.evaluate(() => window._pedidosAgente.filter((p) => p.accion === 'enviar').length);
await page.click('#ag-f-re');
await page.waitForFunction((n) => window._pedidosAgente.filter((p) => p.accion === 'enviar').length > n, enviadosAntes, { timeout: 20000 });
const env = await page.evaluate(() => window._pedidosAgente.filter((p) => p.accion === 'enviar').at(-1));
console.log('enviado tras reintentar', JSON.stringify({ texto: env.texto, adjuntos: env.adjuntos.length }));
if (env.adjuntos.length !== 1) throw new Error('no se mandó el adjunto reintentado');

console.log(errores.length ? 'ERRORES EN LA PÁGINA:\n' + errores.join('\n') : 'sin errores en la página');
await browser.close(); srv.close();
if (errores.length) process.exitCode = 1;
