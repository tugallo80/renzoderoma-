// Prueba el lector 3D de la app (public/js/lector-3d.js) contra el script de Blender.
//
//   cd tools/lector-3d && npm install && npm test
//
// Lee ejemplos/ejemplo.glb y ejemplos/ejemplo.fbx con los mismos loaders de three.js que usa la app
// y compara pieza por pieza con ejemplos/esperado.json, que es lo que da tools/blender/exportar_rubik.py
// para la misma escena (se regeneran con `python generar_ejemplos.py`, necesita `pip install bpy`).
// Datos inventados: ningún archivo de cliente.
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require('../../public/js/lector-3d.js');

// three avisa cuando no encuentra texturas (no hay); se silencia para que la salida se lea
const warn = console.warn; console.warn = (...a) => { if (!String(a[0]).startsWith('THREE.')) warn(...a); };

let ok = 0, mal = 0;
function chk(desc, cond, detalle) {
  if (cond) ok++; else { mal++; console.log('FALLA:', desc, detalle !== undefined ? JSON.stringify(detalle) : ''); }
}
const cerca = (a, b, tol) => a === b || (a != null && b != null && Math.abs(a - b) <= tol);
const leer = (n) => { const b = readFileSync(join(AQUI, 'ejemplos', n)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

const esperado = JSON.parse(readFileSync(join(AQUI, 'ejemplos', 'esperado.json'), 'utf8'));
const eq = JSON.parse(readFileSync(join(AQUI, 'ejemplos', 'equivalencias.json'), 'utf8'));

// --- 1. Geometría pura: la misma caja girada que prueba probar_exportar.py --------------------
{
  const [Lg, A, E] = [1.8, 0.6, 0.018];
  const vs = [];
  for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) vs.push([x * Lg, y * A, z * E]);
  const rot = (v, ax, g) => { const c = Math.cos(g), s = Math.sin(g); const [x, y, z] = v;
    return ax === 'z' ? [c * x - s * y, s * x + c * y, z] : [x, c * y - s * z, s * y + c * z]; };
  const r = vs.map(v => rot(rot(v, 'x', 10 * Math.PI / 180), 'z', 30 * Math.PI / 180));
  const caras = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  const [l, a, e] = L.medidasOrientadas(r, caras);
  chk('caja girada: medidas', cerca(l, Lg, 1e-3) && cerca(a, A, 1e-3) && cerca(e, E, 1e-3), [l, a, e]);
  chk('caja cerrada', L.mallaCerrada(caras));
  chk('volumen caja', cerca(L.volumenMalla(r, caras), Lg * A * E, 1e-9));
  chk('normalizar .003', L.normalizarNombre('MDF-18-Blanco.003') === 'MDF-18-Blanco');
  chk('equivalencia sin mayúsculas', L.buscarEquivalencia(' mdf-18-blanco ', { 'MDF-18-Blanco': 'X' }) === 'X');
  chk('clave de equivalencia', L.claveEquivalencia(' MDF 18.Blanco/2 ') === 'mdf 18_blanco_2');
}

// --- 2. GLB y FBX contra esperado.json -------------------------------------------------------
function comparar(nombre, r) {
  const mapa = (rr) => new Map(rr.piezas.map(p => [`${p.item === 'Sin ítem' ? L.SIN_ITEM : p.item}|${p.pieza}`, p]));
  const esp = mapa(esperado), obt = mapa(r);
  chk(`${nombre}: mismas piezas`, esp.size === obt.size && [...esp.keys()].every(k => obt.has(k)),
    { esperado: [...esp.keys()], obtenido: [...obt.keys()] });
  for (const [k, e] of esp) {
    const o = obt.get(k);
    if (!o) continue;
    const d = `${nombre} ${k}`;
    chk(`${d}: cant`, o.cant === e.cant, [o.cant, e.cant]);
    for (const c of ['largo', 'ancho', 'espesor']) chk(`${d}: ${c}`, cerca(o[c], e[c], 0.001), [o[c], e[c]]);
    chk(`${d}: tipo`, o.tipo === e.tipo);
    chk(`${d}: origen_vw`, o.origen_vw === e.origen_vw, [o.origen_vw, e.origen_vw]);
    chk(`${d}: material`, o.material === e.material, [o.material, e.material]);
    chk(`${d}: revisar`, o.revisar === e.revisar);
    chk(`${d}: partes`, o.partes === (e.partes ?? 1), [o.partes, e.partes]);
    chk(`${d}: área`, cerca(o.area_m2, e.area_m2, Math.max(1e-4, e.area_m2 * 0.002)), [o.area_m2, e.area_m2]);
    chk(`${d}: área cara`, cerca(o.area_cara_m2, e.area_cara_m2, 1e-3), [o.area_cara_m2, e.area_cara_m2]);
    chk(`${d}: perímetro`, cerca(o.perimetro_ml, e.perimetro_ml, 1e-3));
    chk(`${d}: volumen`, cerca(o.volumen_m3, e.volumen_m3, Math.max(2e-6, (e.volumen_m3 || 0) * 0.002)), [o.volumen_m3, e.volumen_m3]);
    chk(`${d}: fuente`, o.fuente.item === e.fuente.item && o.fuente.origen_vw === e.fuente.origen_vw, [o.fuente, e.fuente]);
    const ac = (p) => p.acabados.map(a => `${a.origen_vw}>${a.material}`).sort().join(';');
    chk(`${d}: acabados`, ac(o) === ac(e), [ac(o), ac(e)]);
    for (const a of e.acabados) {
      const b = o.acabados.find(x => x.origen_vw === a.origen_vw && x.material === a.material);
      chk(`${d}: m² del acabado ${a.origen_vw || a.material}`, b && cerca(b.area_m2, a.area_m2, Math.max(1e-4, a.area_m2 * 0.002)), [b && b.area_m2, a.area_m2]);
    }
  }
  chk(`${nombre}: ítems`, JSON.stringify([...r.items].sort()) === JSON.stringify(esperado.items.map(i => i === 'Sin ítem' ? L.SIN_ITEM : i).sort()), r.items);
  chk(`${nombre}: sin_equivalencia`, JSON.stringify(r.sin_equivalencia) === JSON.stringify(esperado.sin_equivalencia), r.sin_equivalencia);
  chk(`${nombre}: formato`, r.formato === 'rubik/1' && r.unidad === 'm');
  console.log(`  ${nombre}: ${r.resumen}`);
}

// Como en la app: plugin sin texturas + modificador de URLs. El ejemplo trae una textura incrustada ("Piel")
// y la prueba comprueba que la imagen NO se lee ni se decodifica (los archivos reales vienen con 100+ MB de texturas).
let imagenesLeidas = 0, imagenesPedidas = [];
const cargador = (Clase) => {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(L.modificadorURL({}, []));
  return new Clase(manager);
};
const lgltf = cargador(GLTFLoader);
lgltf.register(L.pluginSinTexturas(THREE));
lgltf.register((parser) => { const orig = parser.loadImageSource.bind(parser); parser.loadImageSource = (...a) => { imagenesLeidas++; return orig(...a); }; return { name: 'espia' }; });
const gltf = await new Promise((ok, ko) => lgltf.parse(leer('ejemplo.glb'), '', ok, ko));
chk('GLB: la textura incrustada no se lee', imagenesLeidas === 0, imagenesLeidas);
L.prepararGLTF(gltf);
const uGlb = L.detectarUnidad(gltf.scene, 'gltf');
chk('GLB: unidad m', uGlb.unidad === 'm', uGlb);
comparar('GLB', L.analizar(gltf.scene, { equivalencias: eq, factor: uGlb.factor, archivo: 'ejemplo.glb' }));

const bufFbx = leer('ejemplo.fbx');
// FBXLoader saca la imagen incrustada a un blob: el modificador lo cambia por 1 píxel antes de decodificar
globalThis.window = { URL: { createObjectURL: () => 'blob:incrustada-' + Math.random() } };
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(v) { imagenesPedidas.push(v); } }) };
const fbx = cargador(FBXLoader).parse(bufFbx, '');
chk('FBX: la textura incrustada no se decodifica', imagenesPedidas.length > 0 && imagenesPedidas.every(u => u === L.PIXEL), imagenesPedidas);
chk('URL: .bin elegido pasa, .bin que falta se avisa, textura → 1 píxel', (() => {
  const faltan = []; const m = L.modificadorURL({ 'a.bin': 'blob:a' }, faltan);
  return m('a.bin') === 'blob:a' && m('blob:a') === 'blob:a' && m('b.bin') === 'b.bin' && faltan[0] === 'b.bin' &&
    m('tex/madera.jpg') === L.PIXEL && m('data:image/png;base64,xx') === L.PIXEL && m('data:application/octet-stream;base64,xx').startsWith('data:application');
})());
L.aplicarPropiedadesFBX(fbx, L.leerPropiedadesFBX(bufFbx));
const uFbx = L.detectarUnidad(fbx, 'fbx');
chk('FBX: unidad cm (Blender exporta en cm)', uFbx.unidad === 'cm', uFbx);
comparar('FBX', L.analizar(fbx, { equivalencias: eq, factor: uFbx.factor, archivo: 'ejemplo.fbx' }));

// --- 3. Unidades: el mismo modelo escalado a mm se detecta y se lee igual -----------------------
{
  const g2 = await new Promise((ok, ko) => lgltf.parse(leer('ejemplo.glb'), '', ok, ko));
  L.prepararGLTF(g2);
  g2.scene.scale.setScalar(1000);   // como si alguien exportara mm sin escalar
  const u = L.detectarUnidad(g2.scene, 'gltf');
  chk('glTF en mm sin escalar → sugiere mm', u.unidad === 'mm', u);
  const r = L.analizar(g2.scene, { equivalencias: eq, factor: u.factor });
  const tapa = r.piezas.find(p => p.pieza === 'Tapa superior');
  chk('mm: tapa 1.8 × 0.6 × 0.018 m', tapa && cerca(tapa.largo, 1.8, 1e-3) && cerca(tapa.espesor, 0.018, 1e-4), tapa);
}

{
  // SketchUp exporta FBX en mm (UnitScaleFactor 0.1)
  const g = new THREE.Group(); g.userData.unitScaleFactor = 0.1;
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1800, 600, 18)));
  const u = L.detectarUnidad(g, 'fbx');
  chk('FBX de SketchUp en mm', u.unidad === 'mm', u);
}

// --- 4. Archivo "plano": sin grupos, sin nombres, sin materiales --------------------------------
{
  const escena = new THREE.Group();
  const caja = (x, y, z, px) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), new THREE.MeshStandardMaterial()); m.position.x = px; return m; };
  escena.add(caja(1.2, 0.6, 0.018, 0), caja(1.2, 0.6, 0.018, 3), caja(0.5, 0.5, 0.5, 6));
  const r = L.analizar(escena, {});
  chk('plano: todo en "Sin agrupar"', r.items.length === 1 && r.items[0] === L.SIN_ITEM, r.items);
  chk('plano: dos tableros iguales se suman', r.piezas.some(p => p.cant === 2 && p.tipo === 'plancha'), r.piezas.map(p => p.cant));
  chk('plano: sin material → revisar', r.piezas.every(p => p.revisar && p.origen_vw === null));
  // Un contenedor único (lo agregan algunos exportadores) no se toma como ítem si hay grupos debajo
  const raiz = new THREE.Group(); const cont = new THREE.Group(); cont.name = 'Exportado desde VW';
  const g1 = new THREE.Group(); g1.name = 'Mesa'; const g2 = new THREE.Group(); g2.name = 'Silla';
  g1.add(caja(1, 1, 0.02, 0)); g2.add(caja(0.4, 0.4, 0.02, 2)); cont.add(g1, g2); raiz.add(cont);
  const r2 = L.analizar(raiz, {});
  chk('contenedor único se saltea', JSON.stringify(r2.items) === '["Mesa","Silla"]', r2.items);
  // Instancias (EXT_mesh_gpu_instancing → InstancedMesh): cada una cuenta
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.4, 0.03), new THREE.MeshStandardMaterial({ name: 'MDF-18-Blanco' }), 3);
  for (let i = 0; i < 3; i++) inst.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i, 0, 0));
  inst.name = 'Asiento';
  const r3 = L.analizar(inst.parent ? inst.parent : (() => { const g = new THREE.Group(); g.add(inst); return g; })(), { equivalencias: eq });
  chk('instancias: 3 asientos', r3.piezas.length === 1 && r3.piezas[0].cant === 3 && r3.piezas[0].material === 'MDF_18_BLANCO', r3.piezas);
  // Ocultos
  const g3 = new THREE.Group(); const vis = caja(1, 1, 0.02, 0); vis.name = 'Visible'; const oc = caja(1, 1, 0.02, 0); oc.name = 'Oculto'; oc.visible = false;
  g3.add(vis, oc);
  const r4 = L.analizar(g3, {});
  chk('ocultos no se cuentan', r4.piezas.length === 1 && r4.ocultos_salteados[0] === 'Oculto', r4);
}

// --- 4b. Modelo real (estructura del trofeo, sin datos del cliente): piezas unidas, escala y malla pesada ---------
{
  chk('contarPartes: dos cajas sueltas', L.contarPartes(8, [[0, 1, 2, 3], [4, 5, 6, 7]]) === 2);
  // "Letras de un logo" en un solo objeto: 3 cajas sueltas en una malla → partes 3 y para revisar
  const geos = [0, 1, 2].map(i => new THREE.BoxGeometry(0.1, 0.15, 0.005).translate(i * 0.2, 0, 0));
  const pos = [], idx = []; let base = 0;
  for (const g of geos) { const a = g.attributes.position; for (let i = 0; i < a.count; i++) pos.push(a.getX(i), a.getY(i), a.getZ(i)); g.index.array.forEach(k => idx.push(k + base)); base += a.count; }
  const letras = new THREE.BufferGeometry(); letras.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); letras.setIndex(idx);
  const raiz = new THREE.Group(); const m = new THREE.Mesh(letras, new THREE.MeshStandardMaterial()); m.name = 'Logo '; raiz.add(m);
  // Escala no uniforme + giro de 90° en el objeto (como en el archivo real): se aplica matrixWorld
  const tapa = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()); tapa.name = 'pANEL Frente';
  tapa.scale.set(0.9, 0.3, 0.004); tapa.rotation.set(Math.PI / 2, 0, Math.PI / 2); raiz.add(tapa);
  const r = L.analizar(raiz, {});
  const logo = r.piezas.find(p => p.pieza === 'Logo');
  chk('logo: 3 partes sueltas, para revisar', logo && logo.partes === 3 && logo.revisar && /3 partes sueltas/.test(logo.motivos.join()), logo);
  chk('nombre con espacio al final se recorta', !!logo);
  const cruz = r.piezas.find(p => p.pieza === 'pANEL Frente');
  chk('escala no uniforme + giro: 900 × 300 × 4 mm', cruz && cerca(cruz.largo, 0.9, 1e-4) && cerca(cruz.ancho, 0.3, 1e-4) && cerca(cruz.espesor, 0.004, 1e-5) && cruz.partes === 1, cruz);
  // Modelo en cm leído como m → pieza de 31 m → aviso
  const grande = new THREE.Group(); grande.add(new THREE.Mesh(new THREE.BoxGeometry(31, 1, 1)));
  const rg = L.analizar(grande, {});
  chk('pieza de más de 20 m → revisar la unidad', rg.piezas[0].revisar && /revisar la unidad/.test(rg.piezas[0].motivos.join()), rg.piezas[0].motivos);
  // Calibración: el trofeo medía 310 unidades y el real ~0,8 m → factor = 0,8 / 310
  const trofeo = new THREE.Group(); trofeo.add(new THREE.Mesh(new THREE.BoxGeometry(80, 310, 60)));
  const det = L.detectarUnidad(trofeo, 'gltf');
  const r1 = L.analizar(trofeo, { factor: L.FACTORES[det.unidad] });
  const factor = L.FACTORES[det.unidad] * 0.8 / r1.piezas[0].largo;
  const r2 = L.analizar(trofeo, { factor });
  chk('calibrar con una medida conocida escala todo parejo', cerca(r2.piezas[0].largo, 0.8, 1e-4) && cerca(r2.piezas[0].ancho, 0.8 * 80 / 310, 1e-4), r2.piezas[0]);
  // Malla pesada: ~400.000 caras (el cuerpo del trofeo). Tiene que medirse en pocos segundos.
  const esfera = new THREE.Mesh(new THREE.SphereGeometry(0.4, 448, 448)); esfera.name = 'Cuerpo';
  const ge = new THREE.Group(); ge.add(esfera);
  const t0 = performance.now();
  const re = L.analizar(ge, {});
  const ms = Math.round(performance.now() - t0);
  const caras = esfera.geometry.index.count / 3;
  console.log(`  malla pesada: ${caras} caras medidas en ${ms} ms`);
  chk('malla de ~400.000 caras en menos de 8 s', caras > 390000 && ms < 8000 && cerca(re.piezas[0].largo, 0.8, 1e-3), { caras, ms });
}

// --- 5. FBX ASCII: propiedades personalizadas ---------------------------------------------------
{
  const ascii = `; FBX 7.4.0 project file\nObjects:  {\n\tModel: 123, "Model::Estante", "Mesh" {\n\t\tProperties70:  {\n\t\t\tP: "vw_clase", "KString", "", "A+U", "Melamina-25-Roble"\n\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",0,0,0\n\t\t}\n\t}\n}\n`;
  const p = L.leerPropiedadesFBX(new TextEncoder().encode(ascii).buffer);
  chk('FBX ASCII: vw_clase', p.Estante && p.Estante.vw_clase === 'Melamina-25-Roble' && !('Lcl Translation' in p.Estante), p);
}

// --- 6. rubik.json del exportador: se lee igual y completa equivalencias nuevas -----------------
{
  const r = L.desdeRubikJson(esperado, Object.assign({}, eq, { 'Fierro-3mm': { vw: 'Fierro-3mm', material: 'FIERRO_3MM' } }));
  const men = r.piezas.find(p => p.pieza === 'Ménsula');
  chk('rubik.json: Fierro vinculado con la tabla de la app', men.material === 'FIERRO_3MM' && !men.revisar, men);
  chk('rubik.json: sin_equivalencia actualizado', JSON.stringify(r.sin_equivalencia) === '["Piel"]', r.sin_equivalencia);
  let error = null; try { L.desdeRubikJson({ formato: 'otro' }); } catch (e) { error = e; }
  chk('rubik.json inválido → error claro', error && /rubik\/1/.test(error.message));
}

// --- 7. Al presupuesto: ítems al final, id estable, measures y APU sin inventar ------------------
{
  const r = L.analizar(gltf.scene, { equivalencias: eq });
  const catalogo = {
    MDF_18_BLANCO: { n: 'MDF 18mm Blanco', u: 'm2', p: 95 },
    MDF_9: { n: 'MDF 9mm', u: 'plancha', p: 210 },          // sin rendimiento: no se calcula
    CANTO_PVC_BLANCO: { n: 'Canto PVC blanco', u: 'ml', p: 3.5 },
    LACA_BLANCA: { n: 'Laca blanca', u: 'm2', p: 0 },          // sin precio
    VIDRIO_6: { n: 'Vidrio 6mm', u: 'm2', p: 180 },
    MELAMINA_25_ROBLE: { n: 'Melamina 25 roble', u: 'und', p: 40 },
  };
  let n = 0;
  const piezas = r.piezas.filter(p => !L.sugerirDescarte(p.pieza));
  chk('se sugiere descartar la persona', r.piezas.length - piezas.length === 1 && L.sugerirDescarte('Persona 1.75'));
  chk('no se descarta un mueble', !L.sugerirDescarte('Mostrador recepción') && !L.sugerirDescarte('Planchas MDF'));
  const items = L.armarItems(piezas, [...new Set(piezas.map(p => p.item))], catalogo, () => 'id' + (++n), { archivo: 'ejemplo.glb' });
  chk('3 ítems', items.length === 3, items.map(i => i.desc));
  chk('ids estables y origen 3d', items.every(i => i.id && i.origen === '3d' && i.type === 'item'));
  const mos = items.find(i => i.desc === 'Mostrador recepción');
  chk('measures en formato de computo.html', mos.measures.length === 4 && mos.measures.every(m => ['c', 'l', 'a', 'h', 'p', 'desc'].every(k => k in m)), mos.measures);
  chk('measures: laterales con c = 2', mos.measures.some(m => m.c === 2 && m.l === 0.982 && m.a === 0.6 && m.h === 0.018));
  chk('measures_modo plancha', mos.measures_modo === 'plancha');
  const fila = (it, d) => it.apu.mat.find(x => x.d === d);
  const mdf18 = fila(mos, 'MDF 18mm Blanco');
  // tapa 1.8×0.6 + 2 laterales 0.982×0.6 (el zócalo no tiene material)
  chk('MDF 18 en m²: una cara de cada plancha', mdf18 && cerca(mdf18.q, 1.08 + 2 * 0.5892, 1e-3) && mdf18.p === 95 && !mdf18.revisar, mdf18);
  chk('MDF 18 lleva sus piezas para el plano de corte', mdf18.measures.length === 2 && mdf18.measures_modo === 'plancha');
  const mdf9 = fila(mos, 'MDF 9mm');
  chk('MDF 9 en planchas: sin rendimiento → q 0 y marcada', mdf9 && mdf9.q === 0 && mdf9.p === 210 && /rendimiento/.test(mdf9.revisar), mdf9);
  const laca = fila(mos, 'Laca blanca');
  chk('laca sin precio → p 0 y marcada', laca && laca.p === 0 && /sin precio/.test(laca.revisar) && cerca(laca.q, 3.5139, 1e-3), laca);
  const canto = fila(mos, 'Canto PVC blanco');
  chk('canto en ml → no se inventan los lados', canto && canto.q === 0 && /canto/.test(canto.revisar), canto);
  const zocalo = mos.apu.mat.find(x => x.d === 'Sin material');
  chk('pieza sin material → fila marcada sin vincular', zocalo && zocalo.q === 0 && zocalo.p === 0 && /sin vincular/.test(zocalo.revisar), zocalo);
  chk('mano de obra vacía (manual)', mos.apu.mo.length === 0);
  chk('pu = solo lo calculado (MDF 18) con indirectos y utilidad', cerca(mos.pu, Math.round(mdf18.q * 95 * 1.1 * 1.5 * 100) / 100, 0.01), mos.pu);
  const rep = items.find(i => i.desc === 'Repisa');
  const mel = fila(rep, 'Melamina 25 roble');
  chk('melamina por unidad = cantidad de piezas', mel && mel.q === 1, mel);
  const fierro = rep.apu.mat.find(x => x.d === 'Fierro-3mm');
  chk('Fierro sin equivalencia → marcada', fierro && /sin vincular/.test(fierro.revisar));
  chk('sin undefined (Firebase)', !JSON.stringify(items).includes('undefined') && JSON.stringify(JSON.parse(JSON.stringify(items))) === JSON.stringify(items));
  // La lista existente no se toca: los ítems van al final
  const presupuesto = [{ type: 'chapter', name: 'A' }, { type: 'item', desc: 'Viejo' }];
  const antes = JSON.stringify(presupuesto);
  presupuesto.push(...items);
  chk('ítems al final, sin mover los existentes', JSON.stringify(presupuesto.slice(0, 2)) === antes && presupuesto.length === 5);
}

// --- 8. PDF del cliente: pedido a la IA, respuesta y propuestas (datos inventados) -------------------
{
  // Modelo plano, sin escala real ni materiales (como el trofeo): 3 piezas
  const raiz = new THREE.Group();
  const caja = (n, x, y, z, px) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), new THREE.MeshStandardMaterial()); m.name = n; m.position.x = px; raiz.add(m); };
  caja('Base ', 120, 120, 10, 0); caja('pANEL Frente', 200, 80, 4, 300); caja('Columna', 30, 30, 150, 600);
  const det = L.detectarUnidad(raiz, 'fbx');
  const r = L.analizar(raiz, { factor: det.factor });
  const filas = r.piezas.map(p => ({ ...p, incluir: true }));
  const catalogo = { ACRILICO_4: { n: 'Acrílico 4mm transparente', u: 'm2', p: 260 }, MDF_18: { n: 'MDF 18mm', u: 'm2', p: 95 } };
  const pedido = L.armarPedidoPDF({ texto: 'Copa institucional. Alto total 800 mm.', imagenes: ['QUJD'], piezas: filas,
    tamano_mm: det.tamano.map(x => x * det.factor * 1000), catalogo });
  const todo = JSON.stringify(pedido);
  chk('pedido: mismo modelo y proxy que Presupuesto IA', pedido.model === 'gemini-2.5-flash' && pedido.contents[0].role === 'user');
  chk('pedido: lleva piezas, catálogo, texto e imagen', todo.includes('pANEL Frente') && todo.includes('ACRILICO_4 = Acrílico 4mm') &&
    todo.includes('Alto total 800 mm') && pedido.contents[0].parts.some(p => p.inlineData && p.inlineData.mimeType === 'image/jpeg'));
  chk('pedido: pide no inventar y JSON', /no inventes/i.test(pedido.systemInstruction.parts[0].text) && pedido.generationConfig.temperature === 0);

  // Respuesta simulada de Gemini (con ```json y texto suelto, como a veces llega)
  const json = {
    medidas_generales: { alto_mm: 800, ancho_mm: 480, fondo_mm: 480, confianza: 'alta', cita: 'Alto total 800 mm' },
    piezas: [
      { nombre_pdf: 'Panel frontal', pieza_3d: 'pANEL Frente', largo_mm: 800, ancho_mm: 320, espesor_mm: 4, cantidad: 2,
        material_texto: 'acrílico transparente 4 mm', material_clave: 'ACRILICO_4', acabados: ['pulido de cantos'], confianza: 'alta', cita: 'Panel frontal acrílico 4mm (x2)' },
      { nombre_pdf: 'columna central', pieza_3d: null, largo_mm: null, cantidad: null, material_texto: 'Inox', material_clave: 'INOX_INVENTADO', confianza: 'media', cita: 'columna en acero inox' },
      { nombre_pdf: 'Placa grabada', pieza_3d: null, material_texto: 'bronce', material_clave: null, confianza: 'baja', cita: 'placa' }
    ], notas: 'El PDF no dice el espesor de la base.'
  };
  const resp = { candidates: [{ content: { parts: [{ text: 'Acá va:\n```json\n' + JSON.stringify(json) + '\n```' }] } }] };
  const info = L.leerRespuestaPDF(resp);
  chk('respuesta: se lee aunque venga con ```json', info.medidas_generales.alto_mm === 800 && info.piezas.length === 3 && info.piezas[0].cantidad === 2);
  let err = null; try { L.leerRespuestaPDF({ candidates: [] }); } catch (e) { err = e; }
  chk('respuesta vacía → error claro', err && /no devolvió/.test(err.message));

  const tam = det.tamano.map(x => x * det.factor);
  const props = L.propuestasPDF(info, filas, tam, catalogo);
  const esc = props.find(p => p.tipo === 'escala');
  chk('propone escala con la medida mayor del PDF', esc && cerca(esc.factor * Math.max(...tam) * 1000, 800, 0.5) && esc.confianza !== undefined, esc);
  const mat = props.find(p => p.tipo === 'material' && p.pieza === 'pANEL Frente');
  chk('propone material de la base para la pieza del 3D', mat && mat.clave === 'ACRILICO_4' && mat.aplicable && mat.confianza === 'alta', mat);
  const inox = props.find(p => p.tipo === 'material' && p.nombre_pdf === 'columna central');
  chk('busca la pieza por nombre parecido ("columna central" → Columna)', inox && inox.pieza === 'Columna');
  chk('clave que no está en el catálogo → no se aplica, se vincula a mano', inox && inox.clave === null && inox.aplicable === false && /no está en la base/.test(inox.texto), inox);
  const placa = props.find(p => p.nombre_pdf === 'Placa grabada');
  chk('pieza del PDF que no está en el 3D → solo informativa', placa && placa.pieza === null && placa.aplicable === false);
  chk('propone cantidad del PDF', props.some(p => p.tipo === 'cantidad' && p.pieza === 'pANEL Frente' && p.cantidad === 2));
  chk('propone calibrar con la medida de una pieza', props.some(p => p.tipo === 'medida' && p.pieza === 'pANEL Frente' && p.largo_mm === 800));
  chk('nada cambia sin aplicar', filas.every(f => f.material === null && f.cant === 1));

  // Aceptada en la revisión → el APU la marca "según PDF (IA)" con su confianza
  const panel = filas.find(f => f.pieza === 'pANEL Frente');
  Object.assign(panel, { material: 'ACRILICO_4', material_desde: 'pdf_ia', material_confianza: 'alta', revisar: false });
  const fila = L.armarApuMateriales([panel], catalogo).find(x => x.clave === 'ACRILICO_4');
  chk('APU: fila marcada según PDF (IA)', fila && fila.segun === 'PDF (IA)' && fila.confianza === 'alta' && /según PDF \(IA\)/.test(fila.nota), fila);
}

console.log(`\n${ok} OK, ${mal} fallas`);
process.exit(mal ? 1 : 0);
