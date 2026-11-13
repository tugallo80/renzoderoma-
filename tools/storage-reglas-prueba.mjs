// Prueba de las reglas de Storage de tools/storage-reglas.sh (modo cerrar) en el emulador:
//   copiar el bloque de reglas a storage.rules y correr:
//   npx firebase emulators:exec --only storage --project demo-rubik "node storage-reglas-prueba.mjs"
//   (necesita firebase-tools, @firebase/rules-unit-testing y firebase). Todo tiene que salir con ✔.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import fs from 'fs';
const env = await initializeTestEnvironment({ projectId: 'demo-rubik', storage: { rules: fs.readFileSync('storage.rules','utf8'), host:'127.0.0.1', port:9199 } });
const u = env.authenticatedContext('dueno').storage();
const a = env.unauthenticatedContext().storage();
const img = new Uint8Array([1,2,3]);
async function t(n,esp,p){ let ok; try{ await p; ok=true;}catch(e){ok=false;} console.log(ok===esp?'✔':'✘ FALLA', n, ok?'permitido':'negado'); }
await t('dueño sube presupuesto/x.jpg', true, u.ref('presupuesto/p1_img_1.jpg').put(img));
await t('dueño lee presupuesto/x.jpg', true, u.ref('presupuesto/p1_img_1.jpg').getDownloadURL());
await t('dueño sube en subcarpeta proyectos/a/b/c.jpg', true, u.ref('proyectos/a/b/c.jpg').put(img));
await t('dueño sube en raíz x.jpg', true, u.ref('x.jpg').put(img));
await t('anónimo sube presupuesto (negar)', false, a.ref('presupuesto/z.jpg').put(img));
await t('anónimo lee presupuesto (negar)', false, a.ref('presupuesto/p1_img_1.jpg').getDownloadURL());
await t('anónimo sube raíz (negar)', false, a.ref('y.jpg').put(img));
await t('dueño sube agente/x (negar)', false, u.ref('agente/x.jpg').put(img));
await t('dueño lee agente/a/b (negar)', false, u.ref('agente/a/b.jpg').getDownloadURL());
await t('dueño sube requerimientos/r/x (negar)', false, u.ref('requerimientos/r/x.jpg').put(img));
await env.cleanup();
