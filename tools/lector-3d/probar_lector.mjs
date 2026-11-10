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

const gltf = await new Promise((ok, ko) => new GLTFLoader().parse(leer('ejemplo.glb'), '', ok, ko));
L.prepararGLTF(gltf);
const uGlb = L.detectarUnidad(gltf.scene, 'gltf');
chk('GLB: unidad m', uGlb.unidad === 'm', uGlb);
comparar('GLB', L.analizar(gltf.scene, { equivalencias: eq, factor: uGlb.factor, archivo: 'ejemplo.glb' }));

const bufFbx = leer('ejemplo.fbx');
const fbx = new FBXLoader().parse(bufFbx, '');
L.aplicarPropiedadesFBX(fbx, L.leerPropiedadesFBX(bufFbx));
const uFbx = L.detectarUnidad(fbx, 'fbx');
chk('FBX: unidad cm (Blender exporta en cm)', uFbx.unidad === 'cm', uFbx);
comparar('FBX', L.analizar(fbx, { equivalencias: eq, factor: uFbx.factor, archivo: 'ejemplo.fbx' }));

// --- 3. Unidades: el mismo modelo escalado a mm se detecta y se lee igual -----------------------
{
  const g2 = await new Promise((ok, ko) => new GLTFLoader().parse(leer('ejemplo.glb'), '', ok, ko));
  L.prepararGLTF(g2);
  g2.scene.scale.setScalar(1000);   // como si alguien exportara mm sin escalar
  const u = L.detectarUnidad(g2.scene, 'gltf');
  chk('glTF en mm sin escalar → sugiere mm', u.unidad === 'mm', u);
  const r = L.analizar(g2.scene, { equivalencias: eq, factor: u.factor });
  const tapa = r.piezas.find(p => p.pieza === 'Tapa superior');
  chk('mm: tapa 1.8 × 0.6 × 0.018 m', tapa && cerca(tapa.largo, 1.8, 1e-3) && cerca(tapa.espesor, 0.018, 1e-4), tapa);
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

console.log(`\n${ok} OK, ${mal} fallas`);
process.exit(mal ? 1 : 0);
