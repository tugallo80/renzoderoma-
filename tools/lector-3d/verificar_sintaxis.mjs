// Verifica la sintaxis de todo el JS de las páginas que toca "Importar 3D" (scripts en línea y archivos).
//   node verificar_sintaxis.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const tmp = mkdtempSync(join(tmpdir(), 'sintaxis-'));
let mal = 0, n = 0;
function chequear(nombre, codigo, modulo) {
  const f = join(tmp, `${n++}.${modulo ? 'mjs' : 'js'}`);
  writeFileSync(f, codigo);
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { mal++; console.log(`FALLA ${nombre}:\n${e.stderr.toString().split('\n').slice(0, 6).join('\n')}`); }
}
for (const pag of ['presupuesto.html', 'computo.html']) {
  const html = readFileSync(join(RAIZ, pag), 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, i = 0;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (/\bsrc=/.test(attrs) || !m[2].trim()) continue;
    if (/type=["']importmap["']/.test(attrs)) { try { JSON.parse(m[2]); } catch (e) { mal++; console.log(`FALLA ${pag} importmap: ${e.message}`); } continue; }
    chequear(`${pag} script #${++i}`, m[2], /type=["']module["']/.test(attrs));
  }
  console.log(`  ${pag}: ${i} scripts en línea`);
}
for (const js of ['js/lector-3d.js', 'js/importar-3d.js', 'js/apu-utils.js']) chequear(js, readFileSync(join(RAIZ, js), 'utf8'), false);
console.log(mal ? `${mal} con errores` : 'Sintaxis OK');
process.exit(mal ? 1 : 0);
