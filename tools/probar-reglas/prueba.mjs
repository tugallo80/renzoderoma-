// Prueba las reglas de la base en el emulador (requiere Java).
// Uso: cd tools/probar-reglas && npm install && npm test
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { ref, get, set, update } from 'firebase/database';

const env = await initializeTestEnvironment({
  projectId: 'demo-rubik',
  database: { host: '127.0.0.1', port: 9000, rules: readFileSync('../../database.rules.json', 'utf8') },
});
await env.withSecurityRulesDisabled(async (c) => {
  await set(ref(c.database(), 'acceso/hub/renzo'), true);
  await set(ref(c.database(), 'proyectos/c1/p1'), { nombre: 'P', pagos: { a: { monto: 1 } }, agencia: { x: 1 } });
  await set(ref(c.database(), 'portafolio/a'), { t: 1 });
});

const hub   = env.authenticatedContext('renzo', { email: 'r@x.com' }).database();
const otro  = env.authenticatedContext('intruso', { email: 'i@x.com' }).database();
const anon  = env.authenticatedContext('anon1', { firebase: { sign_in_provider: 'anonymous' } }).database();
const nadie = env.unauthenticatedContext().database();

const rutas = ['proyectos', 'proyectos/c1/p1/pagos', 'proyectos/c1/p1/agencia', 'proyectos/c1/p1/compras',
  'proyectos/c1/p1/licitaciones', 'clientes/c1/pin_hash', 'personal', 'supervisores/w1', 'caja_chica',
  'ingresos', 'compras_facturadas', 'base_datos/materiales', 'config_ia', 'notificaciones/hub',
  'whatsapp_historial', 'gantt/c1', 'requerimientos_asistidos/c1', 'feed_actividad'];

let ok = 0, mal = 0;
async function chk(desc, p, debe) {
  try { await (debe ? assertSucceeds(p) : assertFails(p)); ok++; }
  catch (e) { mal++; console.log('FALLA:', desc, e.message); }
}
for (const r of rutas) {
  await chk(`hub lee ${r}`, get(ref(hub, r)), true);
  await chk(`hub escribe ${r}`, set(ref(hub, r + '/_t'), 1), true);
  for (const [n, db] of [['otro-email', otro], ['anónimo', anon], ['sin login', nadie]]) {
    await chk(`${n} lee ${r}`, get(ref(db, r)), false);
    await chk(`${n} escribe ${r}`, set(ref(db, r + '/_t'), 1), false);
  }
}
await chk('público lee portafolio', get(ref(nadie, 'portafolio')), true);
// Agente IA: la cola solo la toca la Function; los costos los lee el hub y no los escribe nadie desde la app
await chk('hub NO lee agente_cola', get(ref(hub, 'agente_cola')), false);
await chk('hub NO escribe agente_cola', set(ref(hub, 'agente_cola/x'), { cid: 'c1' }), false);
// Sesión 6: requerimientos (el hub lee, escribe solo la Function) y cola de renders (solo Functions)
await chk('hub lee requerimientos', get(ref(hub, 'requerimientos')), true);
await chk('hub NO escribe requerimientos', set(ref(hub, 'requerimientos/x'), { estado: 'pendiente' }), false);
await chk('anónimo NO lee requerimientos', get(ref(anon, 'requerimientos')), false);
await chk('hub NO lee render_cola', get(ref(hub, 'render_cola')), false);
await chk('hub NO escribe render_cola', set(ref(hub, 'render_cola/x'), { req: 'r' }), false);
// Compras (docs/sesiones/07-compras.md): el hub lee, escribe solo la Function; la idempotencia nadie desde el navegador
await chk('hub NO lee pdf_cola', get(ref(hub, 'pdf_cola')), false);
await chk('hub NO escribe pdf_cola', set(ref(hub, 'pdf_cola/x'), { req: 'r', adj: 'a' }), false);
await chk('hub NO lee operaciones_idem', get(ref(hub, 'operaciones_idem')), false);
await chk('hub NO escribe operaciones_idem', set(ref(hub, 'operaciones_idem/x'), { estado: 'listo' }), false);
await chk('hub lee compras', get(ref(hub, 'compras')), true);
await chk('hub NO escribe compras', set(ref(hub, 'compras/x'), { total: 1 }), false);
await chk('anónimo NO lee compras', get(ref(anon, 'compras')), false);
// Cobros (functions/cobros): el hub lee, escribe solo la Function
await chk('hub NO lee rendicion_links', get(ref(hub, 'rendicion_links')), false);
await chk('hub NO escribe rendicion_links', set(ref(hub, 'rendicion_links/x'), { wid: 'w' }), false);
await chk('hub lee cobros', get(ref(hub, 'cobros')), true);
await chk('hub NO escribe cobros', set(ref(hub, 'cobros/x'), { monto: 1 }), false);
await chk('anónimo NO lee cobros', get(ref(anon, 'cobros')), false);
await chk('hub NO lee compras_idem', get(ref(hub, 'compras_idem')), false);
await chk('hub NO escribe compras_idem', set(ref(hub, 'compras_idem/x'), { id: 'y' }), false);
await chk('hub sigue escribiendo compras_facturadas (hasta la etapa 2)', set(ref(hub, 'compras_facturadas/x'), { monto: 1 }), true);
await chk('hub lee agente_costos', get(ref(hub, 'agente_costos/2026-11/_total')), true);
await chk('hub NO escribe agente_costos', set(ref(hub, 'agente_costos/2026-11/_total'), { usd: 0 }), false);
await chk('anónimo NO lee agente_costos', get(ref(anon, 'agente_costos')), false);
// conector MCP: tokens y clientes OAuth solo la Function; respaldos: el hub lee, nadie escribe
await chk('hub NO lee mcp_oauth', get(ref(hub, 'mcp_oauth/tokens')), false);
await chk('hub NO escribe mcp_oauth', set(ref(hub, 'mcp_oauth/tokens/x'), { uid: 'renzo' }), false);
await chk('nadie lee mcp_oauth', get(ref(nadie, 'mcp_oauth')), false);
await chk('hub lee respaldos_agente', get(ref(hub, 'respaldos_agente/2026-11-12')), true);
await chk('hub NO escribe respaldos_agente', set(ref(hub, 'respaldos_agente/2026-11-12/x'), { a: 1 }), false);
await chk('intruso NO lee respaldos_agente', get(ref(otro, 'respaldos_agente')), false);
await chk('hub escribe config/agente', set(ref(hub, 'config/agente/tope_mensual_usd'), 30), true);
await chk('anónimo NO lee la conversación del agente', get(ref(anon, 'proyectos/c1/p1/agente')), false);
await chk('anónimo escribe portafolio', set(ref(anon, 'portafolio/b'), 1), false);
await chk('otro-email escribe portafolio', set(ref(otro, 'portafolio/b'), 1), false);
await chk('hub escribe portafolio', set(ref(hub, 'portafolio/b'), 1), true);
await chk('hub lee su entrada en acceso', get(ref(hub, 'acceso/hub/renzo')), true);
await chk('hub NO escribe acceso', set(ref(hub, 'acceso/hub/intruso'), true), false);
await chk('otro NO se agrega a acceso', set(ref(otro, 'acceso/hub/intruso'), true), false);
await chk('otro NO lee acceso de hub', get(ref(otro, 'acceso/hub/renzo')), false);
await chk('anónimo NO lee acceso', get(ref(anon, 'acceso')), false);
await chk('hub update multi-ruta', update(ref(hub), { 'proyectos/c1/p1/nombre': 'Q', 'notificaciones/hub/n1': { read: true } }), true);
await chk('hub NO lee la raíz completa', get(ref(hub)), false);

console.log(`\n${ok} OK, ${mal} fallas`);
await env.cleanup();
process.exit(mal ? 1 : 0);
