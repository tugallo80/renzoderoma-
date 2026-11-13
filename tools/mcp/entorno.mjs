// Firebase simulado para las pruebas del conector MCP: almacén en memoria, ID tokens falsos y documentos CIMD fijos.
// Datos inventados.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { crearAlmacenMemoria } = require('../agente/almacen-memoria.cjs');
const OA = require('../../functions/mcp/oauth.js');
const { RUTAS_MCP, ARCHIVOS_MCP, ARCHIVOS_MCP_LECTURA, CFG } = require('../../functions/mcp/index.js');

export const DATOS = () => ({
    acceso: { hub: { renzo: true } },
    clientes: { cliDemo: { nombre: 'Cliente Demo', rubro: 'eventos', wsp: '', email: '' } },
    proyectos: {
        cliDemo: {
            proyDemo: {
                nombre: 'Proyecto demo', estado: 'produccion', fecha_creacion: '2026-10-01T00:00:00.000Z',
                pagos: { a: { monto: 1 } },
                presupuesto: { items: [
                    { type: 'chapter', name: 'MOBILIARIO' },
                    { type: 'item', id: 'itExistente', desc: 'Mesa demo', und: 'pza', cant: 2, pu: 750, apu: { mat: [{ d: 'MDF 18 mm', u: 'pl', q: 1, p: 250 }], mo: [], eq: [], sub: [], cs: 55, ind: 10, util: 50 } },
                    { type: 'item', id: 'itApagado', desc: 'Opcional demo', und: 'glb', cant: 1, pu: 999, activo: false },
                ] },
            },
            proyOtro: { nombre: 'Otro demo', estado: 'cotizacion' },
        },
    },
    base_datos: {
        materiales: { MDF_18: { n: 'MDF blanco 18 mm', u: 'pl', p: 250, espesor_mm: 18 }, CANTO_PVC: { n: 'Canto PVC blanco', u: 'ml', p: 4 } },
        mano_obra: { CARPINTERIA: { n: 'Carpintería', u: 'm2', p: 80 } },
        oficios: {}, rendimientos: {}, equivalencias_vw: {},
    },
});

export function PKCE() {
    const verifier = crypto.randomBytes(40).toString('base64url');
    return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

export function crearEntorno(op = {}) {
    const almacen = crearAlmacenMemoria(DATOS(), RUTAS_MCP, ARCHIVOS_MCP, ARCHIVOS_MCP_LECTURA);
    let desfase = 0;
    const traidos = [];
    const dep = {
        almacen,
        ahora: () => 1762900000000 + desfase,
        esHub: async (uid) => almacen.datos.acceso.hub[uid] === true,
        verificarIdToken: async (t) => { const m = /^idtoken:(\w+)$/.exec(t); if (!m) throw new Error('token inválido'); return { uid: m[1] }; },
        traerJson: async (url) => { traidos.push(url); if (!op.documentos || !op.documentos[url]) throw new Error('404'); return op.documentos[url]; },
        log: () => {},
    };
    return { almacen, dep, cfg: CFG, traidos, avanzar: (ms) => { desfase += ms; } };
}

/** Hace el login completo (como claude.ai) y devuelve los tokens. */
export async function tokenPara(ent, uid, clientId, redirect = 'https://claude.ai/api/mcp/auth_callback') {
    const pk = PKCE();
    const ini = await OA.iniciarAutorizacion(ent.dep, ent.cfg, { response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: pk.challenge, code_challenge_method: 'S256', resource: ent.cfg.recurso, scope: 'rubik' });
    const fin = await OA.completarAutorizacion(ent.dep, ent.cfg, { solicitud: ini.solicitud, decision: 'permitir', id_token: `idtoken:${uid}` });
    const code = new URL(fin.redirect).searchParams.get('code');
    return OA.token(ent.dep, ent.cfg, { grant_type: 'authorization_code', code, code_verifier: pk.verifier, client_id: clientId, redirect_uri: redirect, resource: ent.cfg.recurso });
}
