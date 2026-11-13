// Pruebas de /api/requerimiento (sesión 6): Firebase SIMULADO, datos inventados (el repo es público), sin IA.
// Uso: cd functions && npm install; cd ../tools/requerimientos && npm test
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const API = require('../../functions/requerimientos/api.js');
const { crearAlmacenMemoria } = require('../agente/almacen-memoria.cjs');
const IMG = require('../../functions/mcp/imagen.js');

const DATOS = () => ({ clientes: { cliDemo: { nombre: 'Cervecería Demo', rubro: 'bebidas' } }, proyectos: { cliDemo: { p1: { nombre: 'Stand feria' } } } });
const nuevo = () => crearAlmacenMemoria(DATOS(), API.RUTAS, API.ARCHIVOS);
const png = IMG.imagenDePrueba(0).buffer;
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const b64 = (b) => Buffer.from(b).toString('base64');
const pedir = (al, cuerpo) => API.atender(al, cuerpo, 'renzo');
const ok = async (al, cuerpo) => { const r = await pedir(al, cuerpo); assert.equal(r.status, 200, JSON.stringify(r.cuerpo)); return r.cuerpo; };
const mal = async (al, cuerpo, re, status = 400) => { const r = await pedir(al, cuerpo); assert.equal(r.status, status, JSON.stringify(r.cuerpo)); if (re) assert.match(r.cuerpo.error, re); return r.cuerpo; };

const pruebas = [];
const prueba = (n, fn) => pruebas.push([n, fn]);

prueba('crear: pendiente, con cliente existente o nombre nuevo, título de la descripción', async () => {
    const al = nuevo();
    const a = await ok(al, { accion: 'crear', cliente: { cid: 'cliDemo' }, descripcion: 'Stand de 3x3 con mostrador\nmelamina blanca' });
    const r = al.datos.requerimientos[a.id];
    assert.equal(r.estado, 'pendiente');
    assert.deepEqual(r.cliente, { cid: 'cliDemo', nombre: 'Cervecería Demo' });
    assert.equal(r.titulo, 'Stand de 3x3 con mostrador');
    assert.equal(r.por, 'renzo');
    const b = await ok(al, { accion: 'crear', cliente: { nombre: '  Farmacia Inventada ' } });
    assert.deepEqual(al.datos.requerimientos[b.id].cliente, { nombre: 'Farmacia Inventada', nuevo: true });
    assert.equal(al.datos.requerimientos[b.id].titulo, 'Pedido de Farmacia Inventada');
    const c = await ok(al, { accion: 'crear' });
    assert.ok(!al.datos.requerimientos[c.id].cliente);
    await mal(al, { accion: 'crear', cliente: { cid: 'noExiste' } }, /No existe el cliente/);
    await mal(al, { accion: 'crear', cliente: { cid: '../x' } }, /Cliente inválido/);
    await mal(al, { accion: 'crear', cliente: 'texto' }, /Cliente inválido/);
    await mal(al, { accion: 'otra' }, /Acción desconocida/);
    await mal(al, null, /Acción desconocida/);
});

prueba('editar: cambia descripción y cliente; no edita descartados ni ids raros', async () => {
    const al = nuevo();
    const { id } = await ok(al, { accion: 'crear', descripcion: 'uno' });
    await ok(al, { accion: 'editar', id, descripcion: 'Letrero luminoso 2 m', cliente: { cid: 'cliDemo' } });
    assert.equal(al.datos.requerimientos[id].titulo, 'Letrero luminoso 2 m');
    assert.equal(al.datos.requerimientos[id].cliente.cid, 'cliDemo');
    await ok(al, { accion: 'editar', id, descripcion: 'Stand de 3×3 para la feria, mostrador de melamina blanca y logo luminoso con letras corpóreas' });
    assert.equal(al.datos.requerimientos[id].titulo, 'Stand de 3×3 para la feria, mostrador de melamina blanca y logo…');
    await ok(al, { accion: 'editar', id, cliente: null });
    assert.equal(al.datos.requerimientos[id].cliente, undefined);
    await ok(al, { accion: 'descartar', id });
    await mal(al, { accion: 'editar', id, descripcion: 'x' }, /descartado/, 409);
    const re = await ok(al, { accion: 'reabrir', id });
    assert.equal(re.estado, 'pendiente');
    await mal(al, { accion: 'reabrir', id }, /Solo se reabre/);
    await mal(al, { accion: 'editar', id: 'a/b' }, /inválido/);
    await mal(al, { accion: 'editar', id: 'noHay' }, /No existe/, 404);
});

prueba('adjuntar: foto con anotaciones, PDF, 3D con vistas y otro archivo; todo en Storage requerimientos/', async () => {
    const al = nuevo();
    const { id } = await ok(al, { accion: 'crear', descripcion: 'Mueble' });
    const anot = [{ tipo: 'cota', n: 1, valor: '1,20 m', de: [10, 10], a: [200, 10] }];
    const f = await ok(al, { accion: 'adjuntar', id, tipo: 'imagen', nombre: 'foto.png', datos: b64(png), anotada: b64(jpg), anotaciones: anot, ancho: 640, alto: 360, miniatura: 'data:image/jpeg;base64,' + b64(jpg), para_claude: b64(jpg), anotada_claude: b64(jpg) });
    assert.ok(al.archivos.has(`requerimientos/${id}/${f.adj}/claude.jpg`));
    assert.ok(al.archivos.has(`requerimientos/${id}/${f.adj}/anotada_claude.jpg`));
    assert.equal(f.meta.tipo, 'imagen'); assert.equal(f.meta.mime, 'image/png');
    assert.deepEqual(f.meta.anotaciones, anot);
    assert.ok(al.archivos.has(`requerimientos/${id}/${f.adj}/original.png`));
    assert.ok(al.archivos.has(`requerimientos/${id}/${f.adj}/anotada.jpg`));
    const p = await ok(al, { accion: 'adjuntar', id, tipo: 'pdf', nombre: 'plano cliente.pdf', datos: b64('%PDF-1.4 inventado') });
    assert.equal(p.meta.ruta, `requerimientos/${id}/${p.adj}/plano_cliente.pdf`);
    const t = await ok(al, { accion: 'adjuntar', id, tipo: '3d', nombre: 'stand.fbx', medicion: { formato: 'rubik/1', piezas: [{ nombre: 'panel' }, { nombre: 'mostrador' }] }, tamano_m: [3, 2.5, 3], unidad: 'mm', vistas: [{ nombre: 'isométrica', datos: b64(jpg) }] });
    assert.equal(t.meta.piezas, 2); assert.deepEqual(t.meta.tamano_m, [3, 2.5, 3]);
    assert.equal(t.meta.vistas_rutas.length, 1);
    const o = await ok(al, { accion: 'adjuntar', id, tipo: 'otro', nombre: '<script>.dwg', datos: b64('cualquier cosa') });
    assert.equal(o.meta.mime, 'application/octet-stream');
    assert.ok(!o.meta.ruta.includes('<'));
    assert.equal(Object.keys(al.datos.requerimientos[id].adjuntos).length, 4);
    for (const k of al.archivos.keys()) assert.match(k, /^requerimientos\//);
    // archivo: devuelve la original, la anotada y la vista
    const ar = await ok(al, { accion: 'archivo', id, adj: f.adj });
    assert.deepEqual(Buffer.from(ar.datos, 'base64'), png);
    const an = await ok(al, { accion: 'archivo', id, adj: f.adj, anotada: true });
    assert.deepEqual(Buffer.from(an.datos, 'base64'), jpg);
    const vi = await ok(al, { accion: 'archivo', id, adj: t.adj, vista: 1 });
    assert.deepEqual(Buffer.from(vi.datos, 'base64'), jpg);
    await mal(al, { accion: 'archivo', id, adj: p.adj, anotada: true }, /no tiene/, 404);
});

prueba('adjuntar: valida tipos, contenido y tamaños; si falla no deja archivos sueltos', async () => {
    const al = nuevo();
    const { id } = await ok(al, { accion: 'crear' });
    await mal(al, { accion: 'adjuntar', id, tipo: 'exe', datos: b64('x') }, /no admitido/);
    await mal(al, { accion: 'adjuntar', id, tipo: 'pdf', datos: b64('hola') }, /no es un PDF/);
    await mal(al, { accion: 'adjuntar', id, tipo: 'imagen', datos: b64('<svg/>') }, /JPG, PNG o WEBP/);
    await mal(al, { accion: 'adjuntar', id, tipo: 'imagen' }, /Falta el contenido/);
    await mal(al, { accion: 'adjuntar', id, tipo: '3d', medicion: { piezas: 'no' } }, /medición/);
    await mal(al, { accion: 'adjuntar', id, tipo: 'imagen', datos: b64(png), anotaciones: 'texto' }, /lista/);
    await mal(al, { accion: 'adjuntar', id, tipo: 'imagen', datos: b64(png), miniatura: 'javascript:alert(1)' }, /Miniatura/);
    await mal(al, { accion: 'adjuntar', id, tipo: 'imagen', datos: b64(png), anotada: b64(png) }, /anotada tiene que ser JPG/);
    await mal(al, { accion: 'adjuntar', id, tipo: 'imagen', datos: b64(png), para_claude: b64(png) }, /para Claude tiene que ser JPG/);
    await mal(al, { accion: 'adjuntar', id, tipo: 'imagen', datos: b64(png), para_claude: Buffer.concat([jpg, Buffer.alloc(API.MAX.claude)]).toString('base64') }, /máximo/, 413);
    await mal(al, { accion: 'adjuntar', id, tipo: 'otro', datos: Buffer.alloc(API.MAX.otro + 10).toString('base64') }, /máximo/, 413);
    assert.equal(al.archivos.size, 0, 'quedaron archivos de pedidos fallidos: ' + [...al.archivos.keys()]);
    assert.equal(al.datos.requerimientos[id].adjuntos, undefined);
});

prueba('anotar de nuevo y quitar: la original no cambia; quitar borra los archivos', async () => {
    const al = nuevo();
    const { id } = await ok(al, { accion: 'crear' });
    const f = await ok(al, { accion: 'adjuntar', id, tipo: 'imagen', nombre: 'f.png', datos: b64(png) });
    await mal(al, { accion: 'anotar', id, adj: f.adj, anotaciones: [{ tipo: 'nota', n: 1, texto: 'x', en: [1, 1] }] }, /Falta el contenido/);
    const r = await ok(al, { accion: 'anotar', id, adj: f.adj, anotada: b64(jpg), anotada_claude: b64(jpg), anotaciones: [{ tipo: 'nota', n: 1, texto: 'vidrio templado', en: [5, 5] }] });
    assert.ok(al.archivos.has(`requerimientos/${id}/${f.adj}/anotada_claude.jpg`));
    assert.equal(r.anotaciones, 1);
    assert.ok(al.archivos.has(`requerimientos/${id}/${f.adj}/anotada.jpg`));
    assert.deepEqual(al.archivos.get(`requerimientos/${id}/${f.adj}/original.png`).buf, png);
    await ok(al, { accion: 'anotar', id, adj: f.adj, anotaciones: [] });
    assert.ok(!al.archivos.has(`requerimientos/${id}/${f.adj}/anotada.jpg`));
    assert.ok(!al.archivos.has(`requerimientos/${id}/${f.adj}/anotada_claude.jpg`));
    assert.equal(al.datos.requerimientos[id].adjuntos[f.adj].anotaciones, undefined);
    const p = await ok(al, { accion: 'adjuntar', id, tipo: 'pdf', nombre: 'a.pdf', datos: b64('%PDF-x') });
    await mal(al, { accion: 'anotar', id, adj: p.adj, anotaciones: [] }, /Solo se anotan fotos/);
    await ok(al, { accion: 'quitar', id, adj: f.adj });
    await ok(al, { accion: 'quitar', id, adj: p.adj });
    assert.equal(al.archivos.size, 0);
    await mal(al, { accion: 'quitar', id, adj: f.adj }, /No existe/, 404);
});

prueba('cerco: la Function no puede tocar otros nodos ni otras carpetas de Storage', async () => {
    const al = nuevo();
    await assert.rejects(al.escribir('proyectos/cliDemo/p1/nombre', 'x'), /no tiene acceso/);
    await assert.rejects(al.leer('clientes/cliDemo/rubro'), /no tiene acceso/);
    await assert.rejects(al.subirArchivo('agente/c/p/x/a.jpg', jpg, 'image/jpeg'), /fuera/);
    await assert.rejects(al.subirArchivo('requerimientos/a/../b/c', jpg, 'image/jpeg'), /fuera/);
});

prueba('reglas: /requerimientos lo lee el hub y no se escribe desde el navegador', async () => {
    const { readFileSync } = await import('node:fs');
    const txt = readFileSync(new URL('../../database.rules.json', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    const reglas = JSON.parse(txt).rules.requerimientos;
    assert.equal(reglas['.write'], false);
    assert.match(reglas['.read'], /acceso'\)\.child\('hub'\)/);
    const fb = JSON.parse(readFileSync(new URL('../../firebase.json', import.meta.url), 'utf8'));
    assert.ok(fb.hosting.rewrites.some((r) => r.source === '/api/requerimiento' && r.function.functionId === 'requerimientoApi'));
});

let bien = 0;
for (const [n, fn] of pruebas) {
    try { await fn(); bien++; console.log('ok  ', n); }
    catch (e) { console.log('FALLA', n, '\n', e); process.exitCode = 1; }
}
console.log(`\n${bien}/${pruebas.length} pruebas OK`);
