#!/usr/bin/env node
// Verifica que un respaldo JSON de la Realtime Database se pueda leer.
// Solo imprime estructura y conteos: nunca muestra valores (montos, nombres, etc.).
// Uso: node verificar-respaldo.js <archivo.json | archivo.json.gz>
const fs = require('fs');
const zlib = require('zlib');

const ruta = process.argv[2];
if (!ruta) { console.error('Uso: node verificar-respaldo.js <archivo.json[.gz]>'); process.exit(2); }

let buf = fs.readFileSync(ruta);
const bytes = buf.length;
if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);

let db;
try { db = JSON.parse(buf.toString('utf8')); }
catch (e) { console.error('❌ El archivo NO es JSON válido:', e.message); process.exit(1); }
if (!db || typeof db !== 'object') { console.error('❌ El respaldo está vacío o no es un objeto.'); process.exit(1); }

const contar = (n) => (n && typeof n === 'object') ? Object.keys(n).length : 0;
let hojas = 0;
(function recorrer(n) { if (n && typeof n === 'object') Object.values(n).forEach(recorrer); else hojas++; })(db);

console.log(`Archivo: ${ruta} (${(bytes / 1048576).toFixed(2)} MB en disco, ${(buf.length / 1048576).toFixed(2)} MB de JSON)`);
console.log(`Valores totales: ${hojas}\n`);
console.log('Nodo raíz'.padEnd(28) + 'hijos');
for (const k of Object.keys(db).sort()) console.log(k.padEnd(28) + contar(db[k]));

// Nodos que la app usa y que deberían estar en un respaldo completo
const esperados = ['proyectos', 'clientes', 'base_datos', 'personal', 'caja_chica'];
const faltan = esperados.filter(k => !(k in db));

// Conteos de proyectos y de subnodos sensibles (sin leer su contenido)
let proyectos = 0; const sub = {};
for (const cid of Object.keys(db.proyectos || {})) {
  for (const pid of Object.keys(db.proyectos[cid] || {})) {
    proyectos++;
    for (const s of Object.keys(db.proyectos[cid][pid] || {})) sub[s] = (sub[s] || 0) + 1;
  }
}
console.log(`\nClientes: ${contar(db.clientes)} · Proyectos: ${proyectos}`);
for (const s of ['presupuesto', 'pagos', 'pagos_cliente', 'compras', 'gantt']) {
  console.log(`  proyectos con ${s}: ${sub[s] || 0}`);
}

if (faltan.length) { console.log(`\n⚠️  Faltan nodos esperados: ${faltan.join(', ')}`); process.exit(1); }
console.log('\n✅ Respaldo legible y con los nodos principales.');
