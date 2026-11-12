// Pruebas del Agente IA cotizador. La API de Claude está SIMULADA: no se gasta plata.
// Uso: cd tools/agente && npm test   (necesita `npm install` en functions/ para el SDK; no se llama)
// Todos los datos son inventados (el repo es público).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.AGENTE_LOG = '0';

const N = require('../../public/js/agente-nucleo.js');
const { crearAlmacenMemoria } = require('./almacen-memoria.cjs');
const api = require('../../functions/agente/api.js');
const { ejecutarTurno, armarPedido } = require('../../functions/agente/loop.js');
const H = require('../../functions/agente/herramientas.js');
const hist = require('../../functions/agente/historial.js');
const L = require('../../public/js/lector-3d.js');
const B = require('../../public/js/agente-borrador.js');

let ok = 0;
/** Fila de la tabla compacta de medicion_3d como objeto (columnas → valores). */
const fila3d = (med, i) => Object.fromEntries(med.columnas.map((c, k) => [c, med.piezas[i][k]]));
const pruebas = [];
function prueba(nombre, fn) { pruebas.push([nombre, fn]); }

// ------------------------------------------------------------------ datos inventados
const CID = 'cliDemo', PID = 'proyDemo';
const RAIZ = `proyectos/${CID}/${PID}/agente`;
const MEDICION = {
    formato: 'rubik/1', archivo: 'stand-demo.fbx', unidad: 'm', resumen: '3 piezas distintas en 2 ítems.',
    piezas: [
        { item: 'Mostrador demo', pieza: 'Tapa', material: 'MDF_18', origen_vw: 'MDF 18', cant: 1, largo: 1.8, ancho: 0.6, espesor: 0.018, tipo: 'plancha', area_m2: 2.2536, area_cara_m2: 1.08, perimetro_ml: 4.8, volumen_m3: 0.01944, acabados: [] },
        { item: 'Mostrador demo', pieza: 'Lateral', material: 'MDF_18', cant: 2, largo: 0.9, ancho: 0.6, espesor: 0.018, tipo: 'plancha', area_m2: 1.1448, area_cara_m2: 0.54, perimetro_ml: 3.0, volumen_m3: 0.00972, acabados: [] },
        { item: 'Totem demo', pieza: 'Cuerpo', material: null, origen_vw: 'Acrilico', cant: 1, largo: 2.4, ancho: 0.8, espesor: 0.3, tipo: 'volumen', area_m2: 5.76, volumen_m3: 0.576, acabados: [] },
    ],
};
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('contenido inventado')]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);

function nuevoAlmacen(extra) { return crearAlmacenMemoria(Object.assign({ acceso: { hub: { renzo: true } } }, extra || {})); }

/** Cliente simulado: devuelve las respuestas en orden y guarda los pedidos. */
function clienteFalso(respuestas) {
    const pedidos = [];
    return {
        pedidos,
        beta: { messages: { stream(params) {
            pedidos.push(JSON.parse(JSON.stringify(params)));
            const r = respuestas.shift();
            if (!r) throw new Error('el cliente falso se quedó sin respuestas');
            return { finalMessage: async () => (typeof r === 'function' ? r(params) : r) };
        } } },
    };
}
const uso = (e, s, w, l) => ({ input_tokens: e, output_tokens: s, cache_creation_input_tokens: w || 0, cache_read_input_tokens: l || 0 });
const texto = (t, u) => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 'firma' }, { type: 'text', text: t }], usage: u || uso(1000, 200, 3000, 0) });
const herramienta = (name, input, id, u) => ({ model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'text', text: 'Reviso el 3D.' }, { type: 'tool_use', id: id || 'toolu_1', name, input }], usage: u || uso(1500, 100, 0, 3000) });

async function adjuntar3D(alm) {
    const r = await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: '3d', nombre: 'stand-demo.fbx', medicion: MEDICION, tamano_m: [2.4, 0.8, 1.2], unidad: 'cm' }, 'renzo');
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
    return r.cuerpo.id;
}

// ------------------------------------------------------------------ núcleo compartido
prueba('las copias de functions/agente/compartido son idénticas al original', () => {
    for (const f of ['agente-nucleo.js', 'agente-borrador.js', 'lector-3d.js']) {
        assert.equal(readFileSync(`../../functions/agente/compartido/${f}`, 'utf8'), readFileSync(`../../public/js/${f}`, 'utf8'),
            `${f} desactualizado: correr "npm run sincronizar" en tools/agente`);
    }
});

prueba('medidor: costo de Opus 5.5 con caché escrita y leída', () => {
    const c = N.costoDeUso(uso(1_000_000, 100_000, 200_000, 2_000_000), 'claude-opus-5-5');
    // 1M×4 + 0,1M×20 + 0,2M×5 + 2M×0,20 = 4 + 2 + 1 + 0,4
    assert.equal(c.usd, 7.4);
    assert.equal(c.entrada, 1_000_000); assert.equal(c.cache_leida, 2_000_000);
});

prueba('medidor: Sonnet 5.5 y Haiku 5.5 a su precio', () => {
    assert.equal(N.costoDeUso(uso(1_000_000, 1_000_000), 'claude-sonnet-5-5').usd, 12);
    assert.equal(N.costoDeUso(uso(1_000_000, 1_000_000, 0, 1_000_000), 'claude-haiku-5-5').usd, 0.61);
});

prueba('medidor: caché de 1 h a 2× la entrada y fallback con iterations por modelo', () => {
    const u = uso(0, 0, 1_000_000, 0); u.cache_creation = { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 };
    assert.equal(N.costoDeUso(u, 'claude-opus-5-5').usd, 8);
    const f = { iterations: [Object.assign({ model: 'claude-opus-5-5', type: 'message' }, uso(1_000_000, 0)), Object.assign({ model: 'claude-opus-4-8', type: 'fallback_message' }, uso(1_000_000, 0))] };
    const c = N.costoDeUso(f, 'claude-opus-4-8');
    assert.equal(c.usd, 9); assert.deepEqual(c.modelos, { 'claude-opus-5-5': 4, 'claude-opus-4-8': 5 });
});

prueba('medidor: modelo sin precio queda anotado (no se inventa)', () => {
    const c = N.costoDeUso(uso(1000, 1000), 'claude-desconocido-9');
    assert.equal(c.usd, 0); assert.deepEqual(c.sin_precio, ['claude-desconocido-9']);
});

prueba('medidor: acumulado, mes de Bolivia y tope', () => {
    const a = N.sumarCosto(N.sumarCosto(null, { entrada: 10, salida: 5, cache_escrita: 0, cache_leida: 1, usd: 0.5 }), { entrada: 1, salida: 1, cache_escrita: 2, cache_leida: 0, usd: 0.25 });
    assert.deepEqual(a, { entrada: 11, salida: 6, cache_escrita: 2, cache_leida: 1, usd: 0.75, llamadas: 2 });
    assert.equal(N.mesClave(Date.UTC(2026, 11, 1, 2, 0)), '2026-11');   // 1 dic 02:00 UTC = 30 nov en Bolivia
    assert.equal(N.estadoTope(10, { tope_mensual_usd: 30, aviso_pct: 80 }).nivel, 'ok');
    assert.equal(N.estadoTope(25, { tope_mensual_usd: 30, aviso_pct: 80 }).nivel, 'aviso');
    assert.equal(N.estadoTope(30, { tope_mensual_usd: 30, aviso_pct: 80 }).nivel, 'tope');
});

prueba('config: el modelo es configurable y los valores raros se ignoran', () => {
    const c = N.configEfectiva({ modelo: 'claude-sonnet-5-5', effort: 'mucho', tope_mensual_usd: '12', max_tokens: 999999 });
    assert.equal(c.modelo, 'claude-sonnet-5-5'); assert.equal(c.effort, 'high'); assert.equal(c.tope_mensual_usd, 12); assert.equal(c.max_tokens, 128000);
    assert.equal(N.configEfectiva(null).modelo, 'claude-opus-5-5');
    assert.equal(N.configEfectiva({ modelo: 'gpt; drop' }).modelo, 'claude-opus-5-5');
});

prueba('origen: se reconocen los cuatro tipos y se rechaza lo demás', () => {
    assert.deepEqual(N.parsearOrigen('pieza3d:-K1/p2'), { tipo: 'pieza3d', ref: '-K1/p2', texto: 'pieza3d:-K1/p2' });
    assert.equal(N.parsearOrigen('dueno:-Kmsg').tipo, 'dueño');
    assert.equal(N.parsearOrigen('cota_plano:-K3 p.2 "4,00 m"').tipo, 'cota_plano');
    assert.equal(N.parsearOrigen('base:materiales/MDF_18').tipo, 'base');
    assert.equal(N.parsearOrigen('lo estimé'), null);
    assert.equal(N.parsearOrigen('ia:supuesto'), null);
    assert.equal(N.parsearOrigen(''), null);
});

prueba('medición: escala pareja (largos ×f, áreas ×f², volúmenes ×f³) y resumen con indicadores', () => {
    const e = N.escalarMedicion(MEDICION, 2);
    assert.equal(e.piezas[0].largo, 3.6); assert.equal(e.piezas[0].area_cara_m2, 4.32); assert.equal(e.piezas[0].volumen_m3, 0.15552);
    assert.equal(MEDICION.piezas[0].largo, 1.8, 'no cambia el original');
    const r = N.resumenMedicion(MEDICION);
    assert.equal(r.piezas[1].id, 'p2'); assert.equal(r.piezas[1].largo_mm, 900);
    const mostrador = r.items.find((x) => x.item === 'Mostrador demo').indicadores_ruta_b;
    assert.equal(mostrador.piezas, 3); assert.equal(mostrador.m2_tablero, 2.16); assert.equal(mostrador.ml_canto, 10.8);
});

prueba('historial: tras un fallback a mitad de respuesta se omiten thinking/tool_use previos', () => {
    const c = [{ type: 'thinking', thinking: '', signature: 'a' }, { type: 'text', text: 'Hola' }, { type: 'tool_use', id: 't0', name: 'x', input: {} },
        { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } }, { type: 'thinking', thinking: '', signature: 'b' }, { type: 'text', text: 'Sigo' }];
    assert.deepEqual(hist.contenidoParaHistorial(c).map((b) => b.type), ['text', 'fallback', 'thinking', 'text']);
    assert.equal(hist.contenidoParaHistorial([{ type: 'text', text: 'x' }]).length, 1);
});

prueba('herramientas: validación de entrada (eager_input_streaming no valida en la API)', () => {
    const def = H.definiciones().find((d) => d.name === 'medicion_3d');
    assert.equal(def.eager_input_streaming, true);
    assert.deepEqual(H.validar(def.input_schema, { adjunto: 'x' }), []);
    assert.ok(H.validar(def.input_schema, {}).length);
    assert.ok(H.validar(def.input_schema, { adjunto: 3 }).length);
});

prueba('almacén: el agente no puede tocar nada fuera del proyecto y los nodos permitidos', async () => {
    const alm = nuevoAlmacen();
    await assert.rejects(alm.leer(`proyectos/${CID}/${PID}/pagos`));
    await assert.rejects(alm.escribir('clientes/x', 1));
    await assert.rejects(alm.leer('acceso/hub'));
    await assert.rejects(alm.subirArchivo('comprobantes/x.jpg', Buffer.from('x'), 'image/jpeg'));
    await assert.rejects(alm.leer(`proyectos/${CID}/../x/agente`));
    await alm.leer(`${RAIZ}/estado`);
    await alm.leer('base_datos/materiales');
});

// ------------------------------------------------------------------ API: adjuntar y enviar
prueba('adjuntar: PDF, imagen y medición 3D van a agente/{cid}/{pid}/…; se rechaza lo que no es', async () => {
    const alm = nuevoAlmacen();
    const pdf = await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: 'pdf', nombre: 'planos demo.pdf', datos: PDF.toString('base64') }, 'renzo');
    assert.equal(pdf.status, 200);
    assert.match(pdf.cuerpo.meta.ruta, new RegExp(`^agente/${CID}/${PID}/`));
    const img = await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: 'imagen', nombre: 'foto.jpg', datos: JPG.toString('base64') }, 'renzo');
    assert.equal(img.status, 200); assert.equal(img.cuerpo.meta.mime, 'image/jpeg');
    const id3d = await adjuntar3D(alm);
    assert.equal(alm.datos.proyectos[CID][PID].agente.adjuntos[id3d].tipo, '3d');
    const falso = await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: 'pdf', nombre: 'x.pdf', datos: JPG.toString('base64') }, 'renzo');
    assert.equal(falso.status, 400);
    const raro = await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: 'exe', datos: 'AA==' }, 'renzo');
    assert.equal(raro.status, 400);
    const sinProyecto = await api.atender(alm, { accion: 'adjuntar', cid: '../x', pid: PID, tipo: 'pdf' }, 'renzo');
    assert.equal(sinProyecto.status, 400);
});

prueba('enviar: guarda el mensaje, arma el historial con los adjuntos y encola; un segundo envío espera (409)', async () => {
    const alm = nuevoAlmacen({ agente_memoria: { notas: { a: { texto: 'El vinil de corte lo cobra por m² de plancha entera.' } } } });
    const id3d = await adjuntar3D(alm);
    const r = await api.atender(alm, { accion: 'enviar', cid: CID, pid: PID, texto: 'Stand demo, entrega el viernes', adjuntos: [id3d] }, 'renzo');
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
    const h = JSON.parse(alm.datos.proyectos[CID][PID].agente.conversacion.api);
    assert.equal(h.length, 1);
    assert.match(h[0].content[0].text, /Memoria guardada.*vinil de corte/s);
    assert.deepEqual(h[0].content[1], { type: 'adjunto', id: id3d });
    assert.match(h[0].content[2].text, new RegExp(`Mensaje ${r.cuerpo.mensaje} del dueño`));
    assert.equal(Object.keys(alm.datos.agente_cola).length, 1);
    assert.equal(alm.datos.proyectos[CID][PID].agente.estado.fase, 'en_cola');
    const otra = await api.atender(alm, { accion: 'enviar', cid: CID, pid: PID, texto: 'otra cosa' }, 'renzo');
    assert.equal(otra.status, 409);
    const vacio = await api.atender(alm, { accion: 'enviar', cid: CID, pid: 'otroProy', texto: '  ' }, 'renzo');
    assert.equal(vacio.status, 400);
});

// ------------------------------------------------------------------ loop con la API simulada
async function turnoListo(alm, texto, adjuntos) {
    const r = await api.atender(alm, { accion: 'enviar', cid: CID, pid: PID, texto, adjuntos: adjuntos || [] }, 'renzo');
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
    const cola = alm.datos.agente_cola; const k = Object.keys(cola)[0]; const pedido = cola[k]; delete cola[k];
    return pedido;
}

prueba('pedido a la API: Opus 5.5, thinking adaptativo, effort high, caché y fallbacks por rechazo', () => {
    const p = armarPedido(N.configEfectiva({}), [{ role: 'user', content: 'hola' }]);
    assert.equal(p.model, 'claude-opus-5-5');
    assert.deepEqual(p.thinking, { type: 'adaptive' });
    assert.deepEqual(p.output_config, { effort: 'high' });
    assert.deepEqual(p.system[0].cache_control, { type: 'ephemeral', ttl: '1h' }, 'caché de 1 h: el dueño tarda más de 5 min entre turnos');
    assert.deepEqual(p.cache_control, { type: 'ephemeral', ttl: '1h' });
    assert.deepEqual(armarPedido(N.configEfectiva({ cache_ttl: '5m' }), []).cache_control, { type: 'ephemeral' });
    assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']); assert.equal(p.fallbacks, 'default');
    assert.ok(p.tools.every((t) => t.eager_input_streaming === true));
    assert.equal(armarPedido(N.configEfectiva({ modelo: 'claude-haiku-5-5' }), []).fallbacks, undefined, 'Haiku no tiene fallback del servidor');
    assert.equal(JSON.stringify(armarPedido(N.configEfectiva({}), [])).includes('Date'), false);
});

prueba('turno completo: 3D → medicion_3d → respuesta; costos por llamada en el proyecto y en el mes', async () => {
    const alm = nuevoAlmacen();
    const id3d = await adjuntar3D(alm);
    const pedido = await turnoListo(alm, 'Cotizá el mostrador del 3D', [id3d]);
    const cliente = clienteFalso([herramienta('medicion_3d', { adjunto: id3d, item: 'Mostrador demo' }), texto('El mostrador tiene 3 piezas de MDF 18.')]);
    const r = await ejecutarTurno({ almacen: alm, cliente }, pedido);
    assert.equal(r.fin, 'listo');
    // la medición llegó al modelo como tool_result, con las medidas del algoritmo
    const tr = cliente.pedidos[1].messages.at(-1).content[0];
    assert.equal(tr.type, 'tool_result');
    const med = JSON.parse(tr.content);
    assert.equal(med.piezas.length, 2); assert.equal(fila3d(med, 0).largo_mm, 1800);
    assert.ok(tr.content.length < 900, 'resultado compacto: ' + tr.content.length + ' caracteres');
    // el 3D va como texto (lo midió la app), sin el archivo
    assert.ok(cliente.pedidos[0].messages[0].content.some((b) => b.type === 'text' && /medicion_3d/.test(b.text)));
    const ag = alm.datos.proyectos[CID][PID].agente;
    const msgs = Object.values(ag.conversacion.mensajes);
    assert.equal(msgs.at(-1).rol, 'agente'); assert.match(msgs.at(-1).texto, /3 piezas/);
    assert.equal(ag.estado.fase, 'listo');
    // 1500 e ×4 + 100 s ×20 + 3000 l ×0,2 = 0,0086 ; 1000×4 + 200×20 + 3000×5 = 0,023
    assert.equal(ag.costos.total.usd, 0.0316); assert.equal(ag.costos.total.llamadas, 2);
    assert.equal(Object.keys(ag.costos.llamadas).length, 2);
    const mes = N.mesClave(alm.ahora());
    assert.equal(alm.datos.agente_costos[mes]._total.usd, 0.0316);
    assert.equal(alm.datos.agente_costos[mes][`${CID}_${PID}`].llamadas, 2);
    assert.equal(msgs.at(-1).costo_usd, 0.0316);
    // los thinking blocks se guardan tal cual para la próxima llamada
    const h = JSON.parse(ag.conversacion.api);
    assert.equal(h.at(-1).content[0].signature, 'firma');
});

prueba('PDF e imagen se mandan como documento e imagen nativos', async () => {
    const alm = nuevoAlmacen();
    const pdf = (await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: 'pdf', nombre: 'planos.pdf', datos: PDF.toString('base64') }, 'renzo')).cuerpo.id;
    const img = (await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: 'imagen', nombre: 'totem.jpg', datos: JPG.toString('base64') }, 'renzo')).cuerpo.id;
    const pedido = await turnoListo(alm, 'Mirá esto', [pdf, img]);
    const cliente = clienteFalso([texto('Listo.')]);
    await ejecutarTurno({ almacen: alm, cliente }, pedido);
    const c = cliente.pedidos[0].messages[0].content;
    const doc = c.find((b) => b.type === 'document');
    assert.equal(doc.source.media_type, 'application/pdf'); assert.equal(Buffer.from(doc.source.data, 'base64').toString(), PDF.toString());
    assert.equal(c.find((b) => b.type === 'image').source.media_type, 'image/jpeg');
});

prueba('preguntar_al_dueno corta el turno y deja las preguntas en el chat', async () => {
    const alm = nuevoAlmacen();
    const pedido = await turnoListo(alm, 'Restaurar el tótem');
    const cliente = clienteFalso([herramienta('preguntar_al_dueno', { preguntas: [{ pregunta: '¿El tótem se restaura completo o solo la cara frontal?' }] })]);
    const r = await ejecutarTurno({ almacen: alm, cliente }, pedido);
    assert.equal(r.fin, 'pregunta'); assert.equal(cliente.pedidos.length, 1);
    const ag = alm.datos.proyectos[CID][PID].agente;
    assert.equal(ag.estado.fase, 'esperando_dueno');
    const m = Object.values(ag.conversacion.mensajes).at(-1);
    assert.equal(m.preguntas[0].pregunta, '¿El tótem se restaura completo o solo la cara frontal?');
    // la respuesta del dueño se suma al mismo mensaje de usuario que tiene el tool_result
    await alm.escribir(`${RAIZ}/estado`, { fase: 'listo' });
    await turnoListo(alm, 'Solo la cara frontal');
    const h = JSON.parse(alm.datos.proyectos[CID][PID].agente.conversacion.api);
    assert.equal(h.at(-1).role, 'user');
    assert.deepEqual(h.at(-1).content.map((b) => b.type), ['tool_result', 'text']);
});

prueba('tope mensual: frena antes de llamar; "Seguir igual" (pasar_tope) continúa', async () => {
    const alm = nuevoAlmacen({ config: { agente: { tope_mensual_usd: 5 } } });
    const mes = N.mesClave(Date.now());
    alm.datos.agente_costos = { [mes]: { _total: { usd: 5.2 } } };
    // el reloj del almacén falso arranca en nov 2026: se usa el mes del reloj
    alm.datos.agente_costos[N.mesClave(alm.ahora())] = { _total: { usd: 5.2 } };
    const pedido = await turnoListo(alm, 'Hola');
    const cliente = clienteFalso([texto('Sigo.')]);
    const r = await ejecutarTurno({ almacen: alm, cliente }, pedido);
    assert.equal(r.fin, 'tope'); assert.equal(cliente.pedidos.length, 0);
    assert.equal(alm.datos.proyectos[CID][PID].agente.estado.fase, 'tope');
    const r2 = await api.atender(alm, { accion: 'reintentar', cid: CID, pid: PID, pasar_tope: true }, 'renzo');
    assert.equal(r2.status, 200);
    const cola = alm.datos.agente_cola; const k = Object.keys(cola)[0]; const p2 = cola[k]; delete cola[k];
    assert.equal(p2.pasar_tope, true);
    const r3 = await ejecutarTurno({ almacen: alm, cliente }, p2);
    assert.equal(r3.fin, 'listo'); assert.equal(cliente.pedidos.length, 1);
});

prueba('rechazo: se avisa y la respuesta rechazada no entra al historial', async () => {
    const alm = nuevoAlmacen();
    const pedido = await turnoListo(alm, 'Hola');
    const cliente = clienteFalso([{ model: 'claude-opus-5-5', stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, content: [], usage: uso(100, 0) }]);
    const r = await ejecutarTurno({ almacen: alm, cliente }, pedido);
    assert.equal(r.fin, 'rechazo');
    const h = JSON.parse(alm.datos.proyectos[CID][PID].agente.conversacion.api);
    assert.equal(h.at(-1).role, 'user');
    assert.match(Object.values(alm.datos.proyectos[CID][PID].agente.conversacion.mensajes).at(-1).texto, /no quiso seguir/);
});

prueba('max_tokens con una herramienta a medio escribir: no se corre y se repite con más espacio', async () => {
    const alm = nuevoAlmacen();
    const id3d = await adjuntar3D(alm);
    const pedido = await turnoListo(alm, 'Hola');
    const cortada = { model: 'claude-opus-5-5', stop_reason: 'max_tokens', content: [{ type: 'tool_use', id: 't9', name: 'medicion_3d', input: { adjunto: id3d } }], usage: uso(10, 10) };
    const cliente = clienteFalso([cortada, texto('Listo.')]);
    const r = await ejecutarTurno({ almacen: alm, cliente }, pedido);
    assert.equal(r.fin, 'listo');
    assert.equal(cliente.pedidos[1].max_tokens, 64000);
    assert.equal(JSON.parse(alm.datos.proyectos[CID][PID].agente.conversacion.api).some((m) => JSON.stringify(m).includes('t9')), false);
});

prueba('herramienta con entrada inválida vuelve como error (no se corre)', async () => {
    const alm = nuevoAlmacen();
    const pedido = await turnoListo(alm, 'Hola');
    const cliente = clienteFalso([herramienta('medicion_3d', { adjunto: 42 }), texto('Perdón.')]);
    await ejecutarTurno({ almacen: alm, cliente }, pedido);
    const tr = cliente.pedidos[1].messages.at(-1).content[0];
    assert.equal(tr.is_error, true); assert.match(tr.content, /INVALID_INPUT/);
});

prueba('turno largo: antes del límite de la Function se guarda y se encola la continuación', async () => {
    const alm = nuevoAlmacen();
    const id3d = await adjuntar3D(alm);
    const pedido = await turnoListo(alm, 'Hola');
    const cliente = clienteFalso([() => { alm.avanzar(500 * 1000); return herramienta('medicion_3d', { adjunto: id3d }); }]);
    const r = await ejecutarTurno({ almacen: alm, cliente }, pedido);
    assert.equal(r.fin, 'continua');
    const cola = Object.values(alm.datos.agente_cola);
    assert.equal(cola.length, 1); assert.equal(cola[0].continuar, true); assert.equal(cola[0].llamadas, 1);
    const cliente2 = clienteFalso([texto('Terminé.')]);
    const r2 = await ejecutarTurno({ almacen: alm, cliente: cliente2 }, cola[0]);
    assert.equal(r2.fin, 'listo');
    assert.equal(cliente2.pedidos[0].messages.at(-1).content[0].type, 'tool_result');
});

prueba('detener: el dueño corta el turno antes de la próxima llamada', async () => {
    const alm = nuevoAlmacen();
    const pedido = await turnoListo(alm, 'Hola');
    await api.atender(alm, { accion: 'detener', cid: CID, pid: PID }, 'renzo');
    const cliente = clienteFalso([texto('x')]);
    const r = await ejecutarTurno({ almacen: alm, cliente }, pedido);
    assert.equal(r.fin, 'detenido'); assert.equal(cliente.pedidos.length, 0);
});

prueba('error de la API: queda el aviso y el estado "error" para reintentar', async () => {
    const alm = nuevoAlmacen();
    const pedido = await turnoListo(alm, 'Hola');
    class APIError extends Error {}
    const cliente = { beta: { messages: { stream() { return { finalMessage: async () => { throw new APIError('529 overloaded'); } }; } } } };
    const r = await ejecutarTurno({ almacen: alm, cliente, esErrorAPI: (e) => e instanceof APIError }, pedido);
    assert.equal(r.fin, 'error');
    assert.equal(alm.datos.proyectos[CID][PID].agente.estado.fase, 'error');
    const re = await api.atender(alm, { accion: 'reintentar', cid: CID, pid: PID }, 'renzo');
    assert.equal(re.status, 200);
});

prueba('archivo: devuelve el adjunto del proyecto para verlo en el chat', async () => {
    const alm = nuevoAlmacen();
    const id = (await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: 'imagen', nombre: 'f.jpg', datos: JPG.toString('base64') }, 'renzo')).cuerpo.id;
    const r = await api.atender(alm, { accion: 'archivo', cid: CID, pid: PID, id }, 'renzo');
    assert.equal(Buffer.from(r.cuerpo.datos, 'base64').length, JPG.length);
    assert.equal((await api.atender(alm, { accion: 'archivo', cid: CID, pid: 'otro', id }, 'renzo')).status, 404);
});


// ------------------------------------------------------------------ entrega 2: base, borrador y validación de origen
const BASE = {
    materiales: {
        MDF_18: { n: 'MDF 18 mm blanco', u: 'm2', p: 120, mo_receta: [{ mo: 'LAQUEADO', medida: 'm2_sup', factor: 1 }] },
        ACRILICO_3: { n: 'Acrílico 3 mm', u: 'm2', p: 0, falta_precio: true },
        VINIL_CORTE: { n: 'Vinil de corte', u: 'm2', p: 45 },
    },
    mano_obra: { LAQUEADO: { n: 'Laqueado', u: 'm2', p: 35 }, INSTALACION: { n: 'Instalación', u: 'glb', p: 300 } },
    oficios: { CARPINTERO: { nombre: 'Carpintero', costo_jornal: 200 } },
    rendimientos: { MUEBLE_MEL: { oficio: 'CARPINTERO', indicador: 'm2_tablero', por_jornal: 3, trabajo: 'Mueble' } },
};
function ctxValid(extra) {
    return Object.assign({ adjuntos: { A3D: { tipo: '3d' }, PDF1: { tipo: 'pdf' }, FOTO: { tipo: 'imagen' } }, mediciones: { A3D: MEDICION },
        mensajesDueno: { M1: true }, base: BASE, recargosPresupuesto: { cs_planilla: 55, ind: 10, util: 30, desde: "Ítem demo" } }, extra || {});
}
let idn = 0; const nuevoId = () => 'id' + (++idn);

prueba('origen: se rechaza lo que no existe (pieza, clave, adjunto, mensaje) y la cota sin cita', () => {
    const c = ctxValid();
    assert.equal(B.validarOrigen('pieza3d:A3D/p1,p2', c).ok, true);
    assert.match(B.validarOrigen('pieza3d:A3D/p9', c).error, /no existe la pieza p9/);
    assert.match(B.validarOrigen('pieza3d:OTRO/p1', c).error, /no es un 3D/);
    assert.equal(B.validarOrigen('base:materiales/MDF_18', c).ok, true);
    assert.match(B.validarOrigen('base:materiales/INVENTADO', c).error, /no existe/);
    assert.equal(B.validarOrigen('cota_plano:PDF1 p.2 "4,00 m"', c).ok, true);
    assert.match(B.validarOrigen('cota_plano:PDF1 "4,00 m"', c).error, /página/);
    assert.match(B.validarOrigen('cota_plano:PDF1 p.2 "ancho total"', c).error, /número/);
    assert.equal(B.validarOrigen('cota_plano:FOTO "2,40"', c).ok, true);
    assert.equal(B.validarOrigen('dueño:M1', c).ok, true);
    assert.match(B.validarOrigen('dueño:M9', c).error, /no hay un mensaje/);
    assert.match(B.validarOrigen('calculo:3*2', c).error, /no se acepta/);
    assert.equal(B.validarOrigen(undefined, c).ok, false);
});

prueba('borrador: una fila SIN origen se rechaza; las válidas quedan', () => {
    const r = B.aplicarOperaciones(null, [
        { op: 'item', capitulo: 'Stand', desc: 'Adhesivos' },
        { op: 'fila', item: 'Adhesivos', tipo: 'mat', d: 'Vinil', u: 'm2', q: 2, clave: 'VINIL_CORTE' },
        { op: 'fila', item: 'Adhesivos', tipo: 'mat', d: 'Vinil', u: 'm2', q: 2, origen_q: 'me parece', clave: 'VINIL_CORTE' },
        { op: 'fila', item: 'Adhesivos', tipo: 'mat', d: 'Vinil', u: 'm2', q: 2, origen_q: 'dueño:M1', clave: 'VINIL_CORTE' },
    ], ctxValid(), nuevoId);
    assert.deepEqual(r.resultados.map((x) => x.ok), [true, false, false, true]);
    assert.match(r.resultados[1].error, /falta el origen/);
    assert.equal(r.borrador.capitulos[0].items[0].apu.mat.length, 1);
});

prueba('borrador: con pieza3d la cantidad la calcula la herramienta (no el modelo) y el precio sale de la base', () => {
    const r = B.aplicarOperaciones(null, [
        { op: 'item', capitulo: 'Stand', desc: 'Mostrador' },
        { op: 'fila', item: 'Mostrador', tipo: 'mat', d: 'Vinil frente', origen_q: 'pieza3d:A3D/p1,p2', medida: 'm2_cara', q: 99, clave: 'VINIL_CORTE', p: 1 },
        { op: 'fila', item: 'Mostrador', tipo: 'mat', d: 'Sin medida', origen_q: 'pieza3d:A3D/p1', q: 3 },
        { op: 'fila', item: 'Mostrador', tipo: 'mo', d: 'Laqueado 2 manos', origen_q: 'pieza3d:A3D/p1', medida: 'm2_sup', factor: 2, clave: 'LAQUEADO' },
        { op: 'fila', item: 'Mostrador', tipo: 'mo', d: 'Laqueado 3 manos', origen_q: 'pieza3d:A3D/p1', medida: 'm2_sup', factor: 3, clave: 'LAQUEADO' },
    ], ctxValid(), nuevoId);
    const it = r.borrador.capitulos[0].items[0];
    // p1: 1 × 1,08 m² + p2: 2 × 0,54 m² = 2,16 m² (el modelo había puesto 99)
    assert.equal(it.apu.mat[0].q, 2.16); assert.equal(it.apu.mat[0].p, 45); assert.equal(it.apu.mat[0].origen_p, 'base:materiales/VINIL_CORTE');
    assert.match(it.apu.mat[0].nota, /había puesto 99/);
    assert.equal(r.resultados[2].ok, false); assert.match(r.resultados[2].error, /medida/);
    assert.equal(r.resultados[3].ok, false, 'factor sin origen'); assert.match(r.resultados[3].error, /origen_factor/);
    assert.equal(r.resultados[4].ok, false);
});

prueba('borrador: sin clave, el precio solo con origen dueño:/cota_plano:; sin precio queda marcado', () => {
    const r = B.aplicarOperaciones(null, [
        { op: 'item', capitulo: 'Stand', desc: 'Tótem' },
        { op: 'fila', item: 'Tótem', tipo: 'sub', d: 'Pintura automotriz', u: 'glb', q: 1, origen_q: 'dueño:M1', p: 800 },
        { op: 'fila', item: 'Tótem', tipo: 'sub', d: 'Pintura automotriz', u: 'glb', q: 1, origen_q: 'dueño:M1', p: 800, origen_p: 'dueño:M1' },
        { op: 'fila', item: 'Tótem', tipo: 'mat', d: 'Acrílico frente', u: 'm2', q: 1.92, origen_q: 'cota_plano:PDF1 p.1 "0,80 x 2,40"', clave: 'ACRILICO_3' },
        { op: 'fila', item: 'Tótem', tipo: 'mat', d: 'Tornillería', u: 'glb', q: 1, origen_q: 'dueño:M1' },
    ], ctxValid(), nuevoId);
    assert.deepEqual(r.resultados.map((x) => x.ok), [true, false, true, true, true]);
    const it = r.borrador.capitulos[0].items[0];
    assert.equal(it.apu.sub[0].p, 800);
    assert.equal(it.apu.mat[0].revisar, 'sin precio en la base');
    assert.equal(it.apu.mat[1].revisar, 'falta precio');
    assert.equal(r.borrador.filas_marcadas, 2);
});

prueba('borrador: los totales los calcula la herramienta con la lógica del APU (recargos del presupuesto)', () => {
    const r = B.aplicarOperaciones(null, [
        { op: 'item', capitulo: 'Stand', desc: 'Adhesivos', cant: 2, cant_origen: 'dueño:M1', pu: 1, total: 1 },
        { op: 'fila', item: 'Adhesivos', tipo: 'mat', d: 'Vinil', origen_q: 'dueño:M1', q: 3, clave: 'VINIL_CORTE' },
        { op: 'fila', item: 'Adhesivos', tipo: 'mo', d: 'Instalación', origen_q: 'dueño:M1', q: 1, clave: 'INSTALACION' },
    ], ctxValid(), nuevoId);
    const it = r.borrador.capitulos[0].items[0];
    // la instalación no es personal en planilla: sin cargas sociales. directo = 3×45 + 300 = 435 ; × 1,10 × 1,30 = 622,05
    assert.equal(it.pu, 622.05); assert.equal(it.pu, L.calcPu({ mat: it.apu.mat, mo: it.apu.mo, eq: [], sub: [], cs: 0, ind: 10, util: 30 }));
    assert.equal(it.total, 1244.1); assert.equal(r.borrador.capitulos[0].total, 1244.1); assert.equal(r.borrador.total, 1244.1);
    assert.deepEqual(it.grupos, { mat: 135, mo: 300, mo_planilla: 0, cs: 0, eq: 0, sub: 0, directo: 435 });
    assert.equal(r.borrador.recargos.origen, 'base:presupuesto/recargos');
    const sinOrigen = B.aplicarOperaciones(null, [{ op: 'item', capitulo: 'X', desc: 'Y', cant: 3 }], ctxValid(), nuevoId);
    assert.equal(sinOrigen.resultados[0].ok, false, 'cantidad del ítem distinta de 1 sin origen');
});

prueba('recargos: cargas sociales solo sobre la MO en planilla; al aplicar, la otra MO pasa a "otros gastos" sin CS y el precio es el mismo', () => {
    const r = B.aplicarOperaciones(null, [
        { op: 'item', capitulo: 'Stand', desc: 'Stand ferial', cant: 1 },
        { op: 'fila', item: 'Stand ferial', tipo: 'mat', d: 'Vinil', origen_q: 'dueño:M1', q: 2, clave: 'VINIL_CORTE' },
        { op: 'fila', item: 'Stand ferial', tipo: 'mo', d: 'Armado (jornales)', u: 'jornal', origen_q: 'dueño:M1', q: 2, p: 200, origen_p: 'dueño:M1', planilla: true, origen_planilla: 'dueño:M1' },
        { op: 'fila', item: 'Stand ferial', tipo: 'mo', d: 'Laqueado por m²', origen_q: 'dueño:M1', q: 4, clave: 'LAQUEADO' },
        { op: 'fila', item: 'Stand ferial', tipo: 'mo', d: 'Pintor', cerrado: true, p: 500, origen_p: 'dueño:M1', origen_q: 'dueño:M1' },
        { op: 'fila', item: 'Stand ferial', tipo: 'sub', d: 'Corte láser (terceros)', origen_q: 'dueño:M1', q: 1, p: 250, origen_p: 'dueño:M1' },
        { op: 'fila', item: 'Stand ferial', tipo: 'mo', d: 'Supuesta', origen_q: 'dueño:M1', q: 1, p: 100, origen_p: 'dueño:M1', planilla: true, origen_planilla: 'supuesto:creo que sí' },
        { op: 'fila', item: 'Stand ferial', tipo: 'mo', d: 'Trato en planilla', cerrado: true, p: 100, origen_p: 'dueño:M1', origen_q: 'dueño:M1', planilla: true, origen_planilla: 'dueño:M1' },
        { op: 'fila', item: 'Stand ferial', tipo: 'mat', d: 'X', origen_q: 'dueño:M1', q: 1, clave: 'VINIL_CORTE', planilla: true, origen_planilla: 'dueño:M1' },
    ], ctxValid(), nuevoId);
    assert.deepEqual(r.resultados.slice(6).map(x => x.ok), [false, false, false]);
    assert.match(r.resultados[6].error, /no se supone/); assert.match(r.resultados[7].error, /trato/); assert.match(r.resultados[8].error, /solo para mano de obra/);
    const it = r.borrador.capitulos[0].items[0];
    // CS 55 % solo sobre los 400 de planilla (220); laqueado 140 y trato 500 sin CS
    assert.deepEqual(it.grupos, { mat: 90, mo: 1040, mo_planilla: 400, cs: 220, eq: 0, sub: 250, directo: 1600 });
    assert.equal(it.pu, 2288);   // 1600 × 1,10 × 1,30
    const items = B.aItemsPresupuesto(r.borrador, {});
    const ap = items.find(x => x.type === 'item');
    assert.equal(ap.apu.cs, 55); assert.equal(ap.apu.mo.length, 1); assert.equal(ap.apu.mo[0].planilla, true);
    assert.deepEqual(ap.apu.eq.map(f => f.d), ['MO sin CS · Laqueado por m²', 'MO sin CS · Pintor']);
    assert.equal(ap.pu, it.pu, 'el presupuesto calcula el mismo precio con su única cs por ítem');
    // ítem sin planilla: cs 0 y la MO queda en mano de obra
    const r2 = B.aplicarOperaciones(r.borrador, [{ op: 'item', capitulo: 'Stand', desc: 'Letrero' }, { op: 'fila', item: 'Letrero', tipo: 'mo', d: 'Instalación', origen_q: 'dueño:M1', q: 1, clave: 'INSTALACION' }], ctxValid(), nuevoId);
    const ap2 = B.aItemsPresupuesto(r2.borrador, {}).find(x => x.desc === 'Letrero');
    assert.equal(ap2.apu.cs, 0); assert.equal(ap2.apu.mo.length, 1); assert.equal(ap2.pu, 429);   // 300 × 1,10 × 1,30
});

prueba('recargos: nada inventado — sin datos del dueño quedan los por defecto del APU (10/15, CS 0) sin confirmar, y la planilla sin % queda marcada', () => {
    const c = ctxValid({ recargosPresupuesto: null });
    const r = B.aplicarOperaciones(null, [
        { op: 'item', capitulo: 'Stand', desc: 'Panel' },
        { op: 'fila', item: 'Panel', tipo: 'mo', d: 'Armado', u: 'jornal', origen_q: 'dueño:M1', q: 1, p: 200, origen_p: 'dueño:M1', planilla: true, origen_planilla: 'dueño:M1' },
        { op: 'recargos', ind: 10, util: 50, origen: 'supuesto:lo normal' },
        { op: 'recargos', ind: 10, util: 50, origen: 'base:presupuesto/recargos' },
    ], c, nuevoId);
    assert.equal(r.resultados[2].ok, false); assert.match(r.resultados[2].error, /no se suponen/);
    assert.equal(r.resultados[3].ok, false);
    const b = r.borrador;
    assert.equal(b.recargos.pendiente, true); assert.equal(b.recargos.ind, 10); assert.equal(b.recargos.util, 15); assert.equal(b.recargos.cs_planilla, null);
    const it = b.capitulos[0].items[0];
    assert.equal(it.pu, 253);   // 200 × 1,10 × 1,15, sin CS porque no hay %
    assert.match(it.apu.mo[0].revisar, /cargas sociales/);
    assert.match(B.resumen(b).recargos, /SIN CONFIRMAR/);
    // el dueño los dice: se cargan, deja de estar pendiente y la fila se desmarca
    const r2 = B.aplicarOperaciones(b, [{ op: 'recargos', ind: 12, util: 20, cs_planilla: 55, origen: 'dueño:M1' }], c, nuevoId);
    assert.equal(r2.resultados[0].ok, true);
    assert.equal(r2.borrador.recargos.pendiente, undefined);
    const it2 = r2.borrador.capitulos[0].items[0];
    assert.equal(it2.apu.mo[0].revisar, undefined);
    assert.equal(it2.pu, 416.64);   // 200 × 1,55 × 1,12 × 1,20
});

prueba('recargos: un borrador viejo con 55/10/50 por defecto se rehace con los del presupuesto', () => {
    const viejo = { capitulos: [{ id: 'c', nombre: 'S', items: [{ id: 'i', desc: 'A', cant: 1, und: 'glb', apu: { mat: [], mo: [{ d: 'MO', u: 'glb', q: 1, p: 100 }], eq: [], sub: [] } }] }],
        recargos: { cs: 55, ind: 10, util: 50, origen: 'apu-utils (por defecto)' }, version: 3 };
    const b = B.calcularTotales(B.normalizar(viejo), ctxValid());
    assert.equal(b.recargos.origen, 'base:presupuesto/recargos'); assert.equal(b.recargos.util, 30);
    assert.equal(b.capitulos[0].items[0].pu, 143);   // 100 × 1,10 × 1,30, sin CS
    const sinPres = B.calcularTotales(B.normalizar(viejo), ctxValid({ recargosPresupuesto: null }));
    assert.equal(sinPres.recargos.pendiente, true); assert.equal(sinPres.recargos.util, 15);
});

prueba('recargos del presupuesto: solo ítems del dueño (los aplicados por el agente no cuentan), sin valores por defecto', async () => {
    const alm = nuevoAlmacen();
    const pres = (items) => { alm.datos.proyectos = { [CID]: { [PID]: { presupuesto: { items } } } }; };
    const ctx = { almacen: alm, cid: CID, pid: PID };
    pres([]); assert.equal(await H.recargosPresupuesto(ctx), null);
    pres([{ type: 'item', desc: 'Del agente', origen: 'agente', agente: {}, apu: { cs: 55, ind: 10, util: 50 } }]);
    assert.equal(await H.recargosPresupuesto(ctx), null, 'lo que aplicó el agente no realimenta los recargos');
    pres([
        { type: 'item', desc: 'Mueble con planilla', apu: { cs: 55, ind: 10, util: 15 } },
        { type: 'item', desc: 'Tarifa m²', apu: { cs: 0, ind: 8, util: 20 } },
        { type: 'item', desc: 'Del agente', origen: 'agente', agente: {}, apu: { cs: 55, ind: 10, util: 50 } },
    ]);
    assert.deepEqual(await H.recargosPresupuesto(ctx), { ind: 8, util: 20, cs_planilla: 55, desde: 'Tarifa m²' });
    pres([{ type: 'item', desc: 'Solo util', apu: { util: 15 } }]);
    assert.equal(await H.recargosPresupuesto(ctx), null, 'sin indirectos y utilidad juntos no hay recargos (no se completa con defaults)');
});

prueba('borrador: item_desde_3d usa el algoritmo de Importar 3D (materiales, receta de MO, ruta B)', () => {
    const r = B.aplicarOperaciones(null, [
        { op: 'item_desde_3d', capitulo: 'Stand', adjunto: 'A3D', item3d: 'Mostrador demo' },
        { op: 'item_desde_3d', capitulo: 'Stand', adjunto: 'A3D', item3d: 'Totem demo', materiales: { p3: 'ACRILICO_3' }, desc: 'Tótem' },
        { op: 'item_desde_3d', capitulo: 'Stand', adjunto: 'A3D', item3d: 'Mostrador demo', ruta: 'B', rendimiento: 'MUEBLE_MEL', desc: 'Mostrador por trato' },
        { op: 'item_desde_3d', capitulo: 'Stand', adjunto: 'A3D', item3d: 'No existe' },
        { op: 'item_desde_3d', capitulo: 'Stand', adjunto: 'A3D', item3d: 'Totem demo', materiales: { p3: 'INVENTADO' } },
    ], ctxValid(), nuevoId);
    assert.deepEqual(r.resultados.map((x) => x.ok), [true, true, true, false, false]);
    const [m, t, mb] = r.borrador.capitulos[0].items;
    const esperado = L.armarApu(MEDICION.piezas.slice(0, 2), BASE.materiales, { catalogoMO: BASE.mano_obra });
    assert.equal(m.apu.mat[0].q, esperado.mat[0].q); assert.equal(m.apu.mat[0].p, 120);
    assert.equal(m.apu.mat[0].origen_q, 'pieza3d:A3D/p1,p2'); assert.equal(m.apu.mat[0].origen_p, 'base:materiales/MDF_18');
    assert.equal(m.apu.mo[0].clave, 'LAQUEADO'); assert.equal(m.apu.mo[0].q, esperado.mo[0].q);
    assert.equal(m.measures.length, 2);
    assert.equal(t.apu.mat[0].clave, 'ACRILICO_3'); assert.ok(t.apu.mat[0].revisar);
    // ruta B: 2,16 m² de tablero ÷ 3 por jornal = 0,72 jornales × 200 = 144 (referencia)
    assert.equal(mb.apu.mo.length, 1); assert.equal(mb.apu.mo[0].trato, true); assert.equal(mb.apu.mo[0].p, 144);
});

prueba('borrador: corrección "eran tres adhesivos, no dos" reemplaza la fila y recalcula', () => {
    const c = ctxValid({ mensajesDueno: { M1: true, M2: true } });
    let r = B.aplicarOperaciones(null, [
        { op: 'item', capitulo: 'Stand', desc: 'Adhesivos' },
        { op: 'fila', item: 'Adhesivos', tipo: 'mat', d: 'Adhesivo lateral', u: 'und', q: 2, origen_q: 'dueño:M1', p: 50, origen_p: 'dueño:M1' },
    ], c, nuevoId);
    const antes = r.borrador.total;
    r = B.aplicarOperaciones(r.borrador, [{ op: 'fila', item: 'Adhesivos', tipo: 'mat', reemplaza: 1, d: 'Adhesivo lateral', u: 'und', q: 3, origen_q: 'dueño:M2', p: 50, origen_p: 'dueño:M1' }], c, nuevoId);
    const f = r.borrador.capitulos[0].items[0].apu.mat;
    assert.equal(f.length, 1); assert.equal(f[0].q, 3); assert.equal(f[0].origen_q, 'dueño:M2');
    assert.equal(r.borrador.total, Math.round(antes * 1.5 * 100) / 100);
    assert.equal(r.borrador.version, 2);
});

prueba('borrador → ítems del presupuesto: id estable, origen "agente", capítulos y pu recalculado', () => {
    const r = B.aplicarOperaciones(null, [{ op: 'item_desde_3d', capitulo: 'Stand demo', adjunto: 'A3D', item3d: 'Mostrador demo', desc: 'Mostrador' }], ctxValid(), nuevoId);
    const items = B.aItemsPresupuesto(r.borrador, { fecha: 1 });
    assert.equal(items[0].type, 'chapter'); assert.equal(items[0].name, 'STAND DEMO');
    const it = items[1];
    assert.equal(it.type, 'item'); assert.equal(it.origen, 'agente'); assert.equal(it.id, r.borrador.capitulos[0].items[0].id);
    assert.equal(it.pu, r.borrador.capitulos[0].items[0].pu);
    assert.equal(it.apu.mat[0].origen_q, 'pieza3d:A3D/p1,p2'); assert.equal(it.measures.length, 2); assert.equal(it.measures_modo, 'plancha');
    assert.equal(JSON.stringify(it).includes('undefined'), false);
});

async function proyectoConBase(extra) {
    const alm = nuevoAlmacen(Object.assign({ base_datos: JSON.parse(JSON.stringify(BASE)) }, extra || {}));
    alm.datos.proyectos = { [CID]: { [PID]: { presupuesto: { items: [{ type: 'item', desc: 'Viejo', apu: { mat: [], mo: [], cs: 55, ind: 10, util: 30 } }] } } } };
    return alm;
}

prueba('flujo con la API simulada: adjuntar → borrador → corrección (sin origen rechazada, totales de la herramienta)', async () => {
    const alm = await proyectoConBase();
    const id3d = await adjuntar3D(alm);
    const p1 = await turnoListo(alm, 'Cotizá el mostrador, lleva 2 adhesivos de 50 Bs', [id3d]);
    const msg1 = Object.keys(alm.datos.proyectos[CID][PID].agente.conversacion.mensajes)[0];
    const cliente = clienteFalso([
        herramienta('buscar_base', { texto: 'mdf', espesor_mm: 18 }, 't1'),
        herramienta('armar_borrador', { operaciones: [
            { op: 'item_desde_3d', capitulo: 'Stand', adjunto: id3d, item3d: 'Mostrador demo', desc: 'Mostrador' },
            { op: 'fila', item: 'Mostrador', tipo: 'mat', d: 'Adhesivo', u: 'und', q: 2, p: 50 },
            { op: 'fila', item: 'Mostrador', tipo: 'mat', d: 'Adhesivo', u: 'und', q: 2, origen_q: `dueño:${msg1}`, p: 50, origen_p: `dueño:${msg1}` },
        ] }, 't2'),
        texto('Listo el borrador del mostrador.'),
    ]);
    assert.equal((await ejecutarTurno({ almacen: alm, cliente }, p1)).fin, 'listo');
    const bb = JSON.parse(cliente.pedidos[1].messages.at(-1).content[0].content);
    assert.equal(bb.resultados[0].origen, 'base:materiales/MDF_18'); assert.equal(bb.resultados[0].p, 120); assert.equal(bb.resultados[0].receta, 'LAQUEADO:m2_sup');
    const ra = JSON.parse(cliente.pedidos[2].messages.at(-1).content[0].content);
    assert.equal(ra.aplicadas, 2); assert.equal(ra.rechazadas.length, 1); assert.match(ra.rechazadas[0].motivo, /origen/);
    let bor = alm.datos.proyectos[CID][PID].agente.borrador;
    const it = bor.capitulos[0].items[0];
    // la MO no es de planilla: sin cargas sociales aunque el presupuesto tenga un ítem con 55 %
    assert.equal(it.pu, L.calcPu({ mat: it.apu.mat, mo: it.apu.mo, eq: [], sub: [], cs: 0, ind: 10, util: 30 }));
    assert.equal(bor.recargos.cs_planilla, 55); assert.equal(bor.recargos.origen, 'base:presupuesto/recargos');
    assert.equal(bor.total, it.total);
    const total1 = bor.total;
    // corrección del dueño
    const p2 = await turnoListo(alm, 'Eran tres adhesivos, no dos');
    const msgs = Object.keys(alm.datos.proyectos[CID][PID].agente.conversacion.mensajes).filter((k) => alm.datos.proyectos[CID][PID].agente.conversacion.mensajes[k].rol === 'dueno');
    const msg2 = msgs.at(-1);
    const nAdh = it.apu.mat.findIndex((f) => f.d === 'Adhesivo') + 1;
    const cliente2 = clienteFalso([
        herramienta('armar_borrador', { operaciones: [{ op: 'fila', item: it.id, tipo: 'mat', reemplaza: nAdh, d: 'Adhesivo', u: 'und', q: 3, origen_q: `dueño:${msg2}`, p: 50, origen_p: `dueño:${msg1}` }] }, 't3'),
        texto('Corregido: 3 adhesivos.'),
    ]);
    assert.equal((await ejecutarTurno({ almacen: alm, cliente: cliente2 }, p2)).fin, 'listo');
    bor = alm.datos.proyectos[CID][PID].agente.borrador;
    assert.equal(bor.capitulos[0].items[0].apu.mat[nAdh - 1].q, 3);
    // un adhesivo más: 50 × 1,10 × 1,30 = 71,50
    assert.equal(Math.round((bor.total - total1) * 100) / 100, 71.5);
});

prueba('guardar_en_base: sin confirmación del dueño no guarda; con ella guarda y deja historial', async () => {
    const alm = await proyectoConBase();
    const p1 = await turnoListo(alm, 'El acrílico de 3 mm sale 180 el m², guardalo');
    const msg = Object.keys(alm.datos.proyectos[CID][PID].agente.conversacion.mensajes)[0];
    const cliente = clienteFalso([
        herramienta('guardar_en_base', { nodo: 'materiales', clave: 'ACRILICO_3', datos: { p: 180 }, confirmacion: 'dueño:INVENTADO' }, 't1'),
        herramienta('guardar_en_base', { nodo: 'materiales', clave: 'ACRILICO_3', datos: { p: 180 }, confirmacion: `dueño:${msg}` }, 't2'),
        herramienta('guardar_en_base', { nodo: 'receta', clave: 'ACRILICO_3', datos: { pasos: [{ mo: 'NO_EXISTE', medida: 'm2_cara' }] }, confirmacion: `dueño:${msg}` }, 't3'),
        texto('Guardado.'),
    ]);
    await ejecutarTurno({ almacen: alm, cliente }, p1);
    assert.equal(cliente.pedidos[1].messages.at(-1).content[0].is_error, true);
    assert.equal(alm.datos.base_datos.materiales.ACRILICO_3.p, 180);
    assert.equal(alm.datos.base_datos.materiales.ACRILICO_3.falta_precio, undefined);
    const h = Object.values(alm.datos.base_datos.historial_cambios);
    assert.equal(h.length, 1); assert.deepEqual(h[0].cambios.p, { antes: 0, despues: 180 });
    assert.equal(cliente.pedidos[3].messages.at(-1).content[0].is_error, true, 'receta con mano de obra inexistente');
});

prueba('escala_3d: con una cota del plano escala todas las piezas; con un supuesto no', async () => {
    const alm = await proyectoConBase();
    const id3d = await adjuntar3D(alm);
    const pdf = (await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: 'pdf', nombre: 'planos.pdf', datos: PDF.toString('base64') }, 'renzo')).cuerpo.id;
    const p1 = await turnoListo(alm, 'Hola', [id3d, pdf]);
    const cliente = clienteFalso([
        herramienta('escala_3d', { adjunto: id3d, medida_mm: 2400, eje: 'alto', origen: 'me parece' }, 't1'),
        herramienta('escala_3d', { adjunto: id3d, pieza: 'p1', dimension: 'largo', medida_mm: 3600, origen: `cota_plano:${pdf} p.1 "3600"` }, 't2'),
        herramienta('medicion_3d', { adjunto: id3d, piezas: ['p1'] }, 't3'),
        texto('Escalado.'),
    ]);
    await ejecutarTurno({ almacen: alm, cliente }, p1);
    assert.equal(cliente.pedidos[1].messages.at(-1).content[0].is_error, true);
    const med = JSON.parse(cliente.pedidos[3].messages.at(-1).content[0].content);
    assert.equal(fila3d(med, 0).largo_mm, 3600); assert.equal(fila3d(med, 0).m2_cara, 4.32);
});

prueba('foto anotada: al agente le llegan la original, la anotada y el JSON de las anotaciones', async () => {
    const alm = nuevoAlmacen();
    const anotaciones = [{ tipo: 'cota', n: 1, valor: '2,40 m', de: [840, 250], a: [840, 1400], extremos: 'flechas', nota: 'alto total' }, { tipo: 'nota', n: 2, texto: 'restaurar', en: [300, 880] }];
    const r = await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: 'imagen', nombre: 'totem.jpg', datos: JPG.toString('base64'), anotada: JPG.toString('base64'), anotaciones, ancho: 1200, alto: 1600 }, 'renzo');
    assert.equal(r.status, 200);
    assert.match(r.cuerpo.meta.anotada_ruta, /anotada\.jpg$/);
    const pedido = await turnoListo(alm, 'Mirá la foto', [r.cuerpo.id]);
    const cliente = clienteFalso([texto('Veo la cota de 2,40 m.')]);
    await ejecutarTurno({ almacen: alm, cliente }, pedido);
    const c = cliente.pedidos[0].messages[0].content;
    assert.equal(c.filter((b) => b.type === 'image').length, 2, 'original + anotada');
    const j = c.find((b) => b.type === 'text' && /Anotaciones del dueño/.test(b.text));
    assert.ok(j); assert.match(j.text, /"valor":"2,40 m"/); assert.match(j.text, new RegExp('dueño:' + r.cuerpo.id));
    // la cota dibujada por el dueño vale como origen dueño:<adjunto>
    const v = await H.contexto({ almacen: alm, cid: CID, pid: PID });
    assert.equal(B.validarOrigen('dueño:' + r.cuerpo.id, v).ok, true);
    const muchas = await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: 'imagen', nombre: 'x.jpg', datos: JPG.toString('base64'), anotaciones: Array.from({ length: 300 }, () => ({ tipo: 'nota', texto: 'x'.repeat(700) })) }, 'renzo');
    assert.equal(muchas.status, 400);
});

prueba('herramientas: orden fijo para la caché', () => {
    assert.deepEqual(H.definiciones().map((d) => d.name), ['medicion_3d', 'buscar_base', 'armar_borrador', 'escala_3d', 'guardar_en_base', 'memoria', 'resumen_de_lectura', 'ver_adjunto', 'preguntar_al_dueno']);
});

// ------------------------------------------------------------------ entrega 4: aplicar y memoria
prueba('aplicar al presupuesto: lo nuevo va al final; lo ya aplicado se actualiza en su lugar', () => {
    const data = [{ type: 'item', id: 'viejo1', desc: 'Existente', pu: 10, apu: {} }, { type: 'item', id: 'viejo2', desc: 'Otro', pu: 5 }];
    let r = B.aplicarOperaciones(null, [{ op: 'item_desde_3d', capitulo: 'Stand', adjunto: 'A3D', item3d: 'Mostrador demo', desc: 'Mostrador' }], ctxValid(), nuevoId);
    const a1 = B.aplicarAlPresupuesto(data, B.aItemsPresupuesto(r.borrador));
    assert.deepEqual(a1.data.map((x) => x.id), ['viejo1', 'viejo2', r.borrador.capitulos[0].id, r.borrador.capitulos[0].items[0].id]);
    assert.equal(a1.agregados, 1); assert.equal(data.length, 2, 'no cambia el original');
    // el dueño le puso fotos al ítem en el presupuesto y después corrige el borrador y vuelve a aplicar
    a1.data[3].fotos = ['f1.jpg'];
    a1.data.push({ type: 'item', id: 'manual', desc: 'Agregado a mano' });
    r = B.aplicarOperaciones(r.borrador, [
        { op: 'fila', item: 'Mostrador', tipo: 'mat', d: 'Adhesivo', u: 'und', q: 3, origen_q: 'dueño:M1', p: 50, origen_p: 'dueño:M1' },
        { op: 'item', capitulo: 'Stand', desc: 'Transporte', cant: 1 },
    ], ctxValid(), nuevoId);
    const a2 = B.aplicarAlPresupuesto(a1.data, B.aItemsPresupuesto(r.borrador));
    assert.deepEqual(a2.data.map((x) => x.desc || x.name), ['Existente', 'Otro', 'STAND', 'Mostrador', 'Agregado a mano', 'Transporte']);
    assert.equal(a2.actualizados, 1); assert.equal(a2.agregados, 1);
    assert.deepEqual(a2.data[3].fotos, ['f1.jpg'], 'conserva lo que se agregó en el presupuesto');
    assert.ok(a2.data[3].apu.mat.some((f) => f.d === 'Adhesivo')); assert.equal(a2.data[3].origen, 'agente');
});

prueba('memoria: anota, se lee al empezar la próxima conversación y se puede borrar', async () => {
    const alm = nuevoAlmacen();
    const p1 = await turnoListo(alm, 'El vinil lo cobro por plancha entera, acordate');
    const cliente = clienteFalso([herramienta('memoria', { accion: 'anotar', texto: 'El vinil de corte se cobra por plancha entera, no por m² neto.' }, 't1'), texto('Anotado.')]);
    await ejecutarTurno({ almacen: alm, cliente }, p1);
    const notas = alm.datos.agente_memoria.notas;
    const id = Object.keys(notas)[0];
    assert.match(notas[id].texto, /plancha entera/); assert.equal(notas[id].proyecto, `${CID}/${PID}`);
    // otro proyecto: la memoria viene en el primer mensaje
    const r = await api.atender(alm, { accion: 'enviar', cid: CID, pid: 'otroProyecto', texto: 'Nuevo stand' }, 'renzo');
    const h = JSON.parse(alm.datos.proyectos[CID].otroProyecto.agente.conversacion.api);
    assert.match(h[0].content[0].text, /plancha entera/);
    assert.equal(r.status, 200);
    const ctx = { almacen: alm, cid: CID, pid: PID, mensajesAgente: [] };
    const b = await H.ejecutar(ctx, { type: 'tool_use', id: 'x', name: 'memoria', input: { accion: 'borrar', id } });
    assert.equal(b.is_error, undefined);
    assert.equal(Object.keys(alm.datos.agente_memoria.notas || {}).length, 0);
});

prueba('flujo completo con la API simulada: adjuntar → borrador → corrección → aplicar', async () => {
    const alm = await proyectoConBase();
    const id3d = await adjuntar3D(alm);
    const p1 = await turnoListo(alm, 'Mostrador para la feria', [id3d]);
    await ejecutarTurno({ almacen: alm, cliente: clienteFalso([
        herramienta('armar_borrador', { operaciones: [{ op: 'item_desde_3d', capitulo: 'Feria', adjunto: id3d, item3d: 'Mostrador demo', desc: 'Mostrador' }] }, 't1'),
        texto('Borrador listo.')]) }, p1);
    const p2 = await turnoListo(alm, 'Sumale 2 adhesivos de 50');
    const m2 = Object.entries(alm.datos.proyectos[CID][PID].agente.conversacion.mensajes).filter(([, v]) => v.rol === 'dueno').at(-1)[0];
    await ejecutarTurno({ almacen: alm, cliente: clienteFalso([
        herramienta('armar_borrador', { operaciones: [{ op: 'fila', item: 'Mostrador', tipo: 'mat', d: 'Adhesivo', u: 'und', q: 2, origen_q: `dueño:${m2}`, p: 50, origen_p: `dueño:${m2}` }] }, 't2'),
        texto('Sumados.')]) }, p2);
    const bor = alm.datos.proyectos[CID][PID].agente.borrador;
    const presupuesto = alm.datos.proyectos[CID][PID].presupuesto.items;
    const r = B.aplicarAlPresupuesto(presupuesto, B.aItemsPresupuesto(bor));
    assert.equal(r.data[0].desc, 'Viejo', 'lo que había queda primero');
    const it = r.data.at(-1);
    assert.equal(it.desc, 'Mostrador'); assert.equal(it.origen, 'agente'); assert.equal(it.id, bor.capitulos[0].items[0].id);
    assert.equal(it.pu, bor.capitulos[0].items[0].pu);
    assert.ok(it.apu.mat.every((f) => f.origen_q), 'toda fila aplicada conserva su origen');
});

// ------------------------------------------------------------------ entrega 2b: supuestos, stock propio, trato cerrado, adjuntos numerados, normas
const BASE_2B = { materiales: { TUBO_20X40: { n: 'Tubo 20×40 (ml)', u: 'ml', p: 18 }, TUBO_20X20: { n: 'Tubo 20×20', u: 'und', p: 60 }, LONA: { n: 'Lona front 13 oz', u: 'm2', p: 40 } },
    mano_obra: {}, oficios: { SOLDADOR: { nombre: 'Soldador', costo_jornal: 220 } }, rendimientos: {} };
const ctx2b = () => ctxValid({ base: Object.assign({}, BASE, { materiales: Object.assign({}, BASE.materiales, BASE_2B.materiales) }), mensajesDueno: { M1: true, M2: true } });

prueba('supuesto: la cantidad sale de la geometría propuesta (la calcula la herramienta), el precio de la base', () => {
    const r = B.aplicarOperaciones(null, [
        { op: 'item', capitulo: 'Bastidores', desc: 'Bastidor con lona 5×3' },
        { op: 'fila', item: 'Bastidor con lona 5×3', tipo: 'mat', d: 'Marco perimetral', origen_q: 'supuesto:marco perimetral de tubo 20×40', medida: 'ml_largo', q: 99,
            geometria: [{ desc: 'larguero', cant: 2, largo_m: 5 }, { desc: 'montante', cant: 2, largo_m: 3 }], clave: 'TUBO_20X40' },
        { op: 'fila', item: 'Bastidor con lona 5×3', tipo: 'mat', d: 'Lona', origen_q: 'supuesto:lona del tamaño del bastidor', medida: 'm2_cara', geometria: [{ desc: 'lona', cant: 1, largo_m: 5, ancho_m: 3 }], clave: 'LONA' },
        { op: 'fila', item: 'Bastidor con lona 5×3', tipo: 'mat', d: 'Travesaños', origen_q: 'supuesto:travesaño cada metro', q: 4, clave: 'TUBO_20X40' },
        { op: 'fila', item: 'Bastidor con lona 5×3', tipo: 'mat', d: 'Pintura', origen_q: 'dueño:M1', q: 1, p: 120, origen_p: 'supuesto:lo que suele salir' },
        { op: 'fila', item: 'Bastidor con lona 5×3', tipo: 'mat', d: 'X', origen_q: 'supuesto:corto', medida: 'und', geometria: [{ cant: 1 }] },
    ], ctx2b(), nuevoId);
    assert.deepEqual(r.resultados.map((x) => x.ok), [true, true, true, false, false, false]);
    assert.match(r.resultados[3].error, /geometria/); assert.match(r.resultados[4].error, /precios salen de la base/); assert.match(r.resultados[5].error, /explicá/);
    const it = r.borrador.capitulos[0].items[0];
    assert.equal(it.apu.mat[0].q, 16); assert.equal(it.apu.mat[0].p, 18); assert.match(it.apu.mat[0].nota, /había puesto 99/);
    assert.equal(it.apu.mat[1].q, 15);
    assert.equal(it.apu.mat[0].supuesto, true); assert.equal(it.apu.mat[0].confirmado, false);
    assert.equal(r.borrador.supuestos_pendientes, 2);
    // no se aplica hasta confirmar
    assert.equal(B.aItemsPresupuesto(r.borrador).length, 0);
    const mal = B.aplicarOperaciones(r.borrador, [{ op: 'confirmar_supuestos', item: it.id, confirmacion: 'me parece bien' }], ctx2b(), nuevoId);
    assert.equal(mal.resultados[0].ok, false);
    const ok = B.aplicarOperaciones(r.borrador, [{ op: 'confirmar_supuestos', item: it.id, confirmacion: 'dueño:M2' }], ctx2b(), nuevoId);
    assert.equal(ok.resultados[0].confirmadas, 2); assert.equal(ok.borrador.supuestos_pendientes, 0);
    const items = B.aItemsPresupuesto(ok.borrador);
    assert.equal(items.length, 2); assert.equal(items[1].apu.mat[0].supuesto, true); assert.equal(items[1].apu.mat[0].confirmacion, 'dueño:M2');
    // botón del chat
    const boton = B.confirmarSupuestos(JSON.parse(JSON.stringify(r.borrador)), it.id, 'dueño:botón');
    assert.equal(boton.confirmadas, 2); assert.equal(boton.borrador.supuestos_pendientes, 0);
});

prueba('supuesto en la cantidad del ítem también espera confirmación', () => {
    const r = B.aplicarOperaciones(null, [{ op: 'item', capitulo: 'X', desc: 'Bastidor', cant: 2, cant_origen: 'supuesto:uno por cada cara del ingreso' },
        { op: 'fila', item: 'Bastidor', tipo: 'mat', d: 'Lona', origen_q: 'dueño:M1', q: 15, clave: 'LONA' }], ctx2b(), nuevoId);
    assert.equal(r.borrador.supuestos_pendientes, 1); assert.equal(B.aItemsPresupuesto(r.borrador).length, 0);
});

prueba('stock propio: la parte en stock va a costo 0 y se compra el resto', () => {
    const r = B.aplicarOperaciones(null, [
        { op: 'item', capitulo: 'X', desc: 'Estructura' },
        { op: 'fila', item: 'Estructura', tipo: 'mat', d: 'Tubo 20×20', u: 'und', q: 8, origen_q: 'dueño:M1', clave: 'TUBO_20X20', stock_q: 5, origen_stock: 'dueño:M2' },
        { op: 'fila', item: 'Estructura', tipo: 'mat', d: 'Tubo 20×20', u: 'und', q: 8, origen_q: 'dueño:M1', clave: 'TUBO_20X20', stock_q: 5 },
    ], ctx2b(), nuevoId);
    assert.deepEqual(r.resultados.map((x) => x.ok), [true, true, false]);
    const f = r.borrador.capitulos[0].items[0].apu.mat[0];
    assert.equal(f.q_total, 8); assert.equal(f.stock_q, 5); assert.equal(f.q, 3); assert.equal(f.p, 60);
    assert.match(f.nota, /5 de stock propio \(sin costo\) \+ 3 a comprar/);
    assert.equal(r.borrador.capitulos[0].items[0].pu, L.calcPu({ mat: [{ q: 3, p: 60 }], mo: [], eq: [], sub: [], cs: 55, ind: 10, util: 30 }));
});

prueba('trato cerrado por el dueño: reemplaza la referencia de la ruta B y sobrevive a rehacer el ítem', () => {
    let r = B.aplicarOperaciones(null, [{ op: 'item_desde_3d', capitulo: 'S', adjunto: 'A3D', item3d: 'Mostrador demo', ruta: 'B', rendimiento: 'MUEBLE_MEL', desc: 'Mostrador' }], ctxValid(), nuevoId);
    assert.equal(r.borrador.capitulos[0].items[0].apu.mo[0].p, 144);
    r = B.aplicarOperaciones(r.borrador, [
        { op: 'fila', item: 'Mostrador', tipo: 'mo', d: '', origen_q: 'dueño:M1', cerrado: true, p: 1000, origen_p: 'dueño:M1', oficio: 'Don Pedro y su ayudante' },
        { op: 'fila', item: 'Mostrador', tipo: 'mo', d: 'x', origen_q: 'dueño:M1', cerrado: true, p: 1000, origen_p: 'base:mano_obra/LAQUEADO' },
    ], ctxValid(), nuevoId);
    assert.deepEqual(r.resultados.map((x) => x.ok), [true, false]);
    let mo = r.borrador.capitulos[0].items[0].apu.mo;
    assert.equal(mo.length, 1); assert.equal(mo[0].cerrado, true); assert.equal(mo[0].p, 1000);
    assert.equal(mo[0].d, 'Trato cerrado con Don Pedro y su ayudante'); assert.equal(mo[0].nota, 'monto cerrado por el dueño (Don Pedro y su ayudante)');
    const id = r.borrador.capitulos[0].items[0].id;
    r = B.aplicarOperaciones(r.borrador, [{ op: 'item_desde_3d', id, adjunto: 'A3D', item3d: 'Mostrador demo', ruta: 'B', rendimiento: 'MUEBLE_MEL' }], ctxValid(), nuevoId);
    mo = r.borrador.capitulos[0].items[0].apu.mo;
    assert.equal(mo.length, 1); assert.equal(mo[0].cerrado, true);
});

prueba('adjuntos numerados en orden (foto / captura / PDF / 3D) y vistas del 3D como imágenes', async () => {
    const alm = nuevoAlmacen();
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    const f = (await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: 'imagen', nombre: 'IMG_123.jpg', datos: JPG.toString('base64') }, 'renzo')).cuerpo.id;
    const c = (await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: 'imagen', nombre: 'chat.png', datos: PNG.toString('base64') }, 'renzo')).cuerpo.id;
    const d = (await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: 'pdf', nombre: 'planos.pdf', datos: PDF.toString('base64') }, 'renzo')).cuerpo.id;
    const r3 = await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: '3d', nombre: 'stand.fbx', medicion: MEDICION,
        vistas: [{ nombre: 'isométrica', datos: JPG.toString('base64') }, { nombre: 'frente', datos: JPG.toString('base64') }] }, 'renzo');
    assert.equal(r3.cuerpo.meta.vistas_rutas.length, 2);
    const pedido = await turnoListo(alm, 'Te adjunto todo', [f, c, d, r3.cuerpo.id]);
    const cliente = clienteFalso([texto('Visto.')]);
    await ejecutarTurno({ almacen: alm, cliente }, pedido);
    const tx = cliente.pedidos[0].messages[0].content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    assert.match(tx, /Adjunto 1 · foto · IMG_123\.jpg/); assert.match(tx, /Adjunto 2 · captura · chat\.png/);
    assert.match(tx, /Adjunto 3 · PDF · planos\.pdf/); assert.match(tx, /Adjunto 4 · 3D \(resumen de medición\) · stand\.fbx/);
    assert.match(tx, /Vista 1 del 3D \(isométrica\)/);
    assert.equal(cliente.pedidos[0].messages[0].content.filter((b) => b.type === 'image').length, 4);
    const malo = await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: '3d', nombre: 'x', medicion: MEDICION, vistas: [{ datos: PDF.toString('base64') }] }, 'renzo');
    assert.equal(malo.status, 400);
});

prueba('normas constructivas: memoria tipo norma va a /agente_memoria/normas y se lee al empezar', async () => {
    const alm = nuevoAlmacen();
    const ctx = { almacen: alm, cid: CID, pid: PID, mensajesAgente: [] };
    const r = await H.ejecutar(ctx, { type: 'tool_use', id: 'x', name: 'memoria', input: { accion: 'anotar', tipo: 'norma', texto: 'Los bastidores llevan tubo 20×40 con travesaño cada 1 m.' } });
    assert.equal(r.is_error, undefined);
    assert.equal(Object.values(alm.datos.agente_memoria.normas)[0].texto, 'Los bastidores llevan tubo 20×40 con travesaño cada 1 m.');
    await api.atender(alm, { accion: 'enviar', cid: CID, pid: PID, texto: 'Bastidor 5×3' }, 'renzo');
    const h = JSON.parse(alm.datos.proyectos[CID][PID].agente.conversacion.api);
    assert.match(h[0].content[0].text, /Normas constructivas del taller[\s\S]*travesaño cada 1 m/);
});

prueba('solo texto con la API simulada: despiece supuesto → no se aplica → el dueño confirma por chat → se aplica', async () => {
    const alm = nuevoAlmacen({ base_datos: { materiales: BASE_2B.materiales, mano_obra: {}, oficios: {}, rendimientos: {} } });
    const p1 = await turnoListo(alm, 'Bastidor con lona de 5×3 con patitas para pararse, se instala en el local');
    await ejecutarTurno({ almacen: alm, cliente: clienteFalso([
        herramienta('armar_borrador', { operaciones: [
            { op: 'item', capitulo: 'Bastidores', desc: 'Bastidor con lona 5×3 autoportante' },
            { op: 'fila', item: 'Bastidor con lona 5×3 autoportante', tipo: 'mat', d: 'Marco y travesaños', origen_q: 'supuesto:marco perimetral + 4 travesaños de 3 m (uno por metro)', medida: 'ml_largo',
                geometria: [{ desc: 'larguero', cant: 2, largo_m: 5 }, { desc: 'montante/travesaño', cant: 6, largo_m: 3 }], clave: 'TUBO_20X40' },
            { op: 'fila', item: 'Bastidor con lona 5×3 autoportante', tipo: 'mat', d: 'Lona', origen_q: 'supuesto:lona tensada del tamaño del marco', medida: 'm2_cara', geometria: [{ cant: 1, largo_m: 5, ancho_m: 3 }], clave: 'LONA' },
        ] }, 't1'),
        texto('Propuse marco de tubo 20×40 con travesaño cada metro y lona tensada. ¿Te sirve?')]) }, p1);
    let bor = alm.datos.proyectos[CID][PID].agente.borrador;
    assert.equal(bor.capitulos[0].items[0].apu.mat[0].q, 28);
    assert.equal(B.aItemsPresupuesto(bor).length, 0, 'sin confirmar no se aplica');
    const p2 = await turnoListo(alm, 'Sí, así los hacemos siempre');
    const m2 = Object.entries(alm.datos.proyectos[CID][PID].agente.conversacion.mensajes).filter(([, v]) => v.rol === 'dueno').at(-1)[0];
    await ejecutarTurno({ almacen: alm, cliente: clienteFalso([
        herramienta('armar_borrador', { operaciones: [{ op: 'confirmar_supuestos', confirmacion: `dueño:${m2}` }] }, 't2'),
        herramienta('memoria', { accion: 'anotar', tipo: 'norma', texto: 'Bastidores: tubo 20×40 con travesaño cada 1 m, lona tensada.' }, 't3'),
        texto('Confirmado y anotado como norma.')]) }, p2);
    bor = alm.datos.proyectos[CID][PID].agente.borrador;
    assert.equal(bor.supuestos_pendientes, 0);
    const items = B.aItemsPresupuesto(bor);
    assert.equal(items.filter((x) => x.type === 'item').length, 1);
    assert.ok(alm.datos.agente_memoria.normas);
});

// ------------------------------------------------------------------ estructura: un ítem = lo que se entrega (pedido del dueño tras el trofeo)
prueba('ítems sospechosos: componentes de costo armados como ítem aparte llevan aviso', () => {
    const r = B.aplicarOperaciones(null, [
        { op: 'item_desde_3d', capitulo: 'Trofeo', adjunto: 'A3D', piezas: ['p1', 'p2', 'p3'], desc: 'Trofeo demo' },
        { op: 'item', capitulo: 'Trofeo', desc: 'Armado y fijaciones' },
        { op: 'fila', item: 'Armado y fijaciones', tipo: 'mat', d: 'Tornillería', u: 'glb', q: 1, origen_q: 'dueño:M1' },
        { op: 'item', capitulo: 'Trofeo', desc: 'Mano de obra: corte, rolado, soldadura' },
        { op: 'fila', item: 'Mano de obra: corte, rolado, soldadura', tipo: 'mo', d: 'Soldador', u: 'glb', q: 1, origen_q: 'dueño:M1', clave: 'INSTALACION' },
        { op: 'item', capitulo: 'Trofeo', desc: 'Base decorativa' },
        { op: 'fila', item: 'Base decorativa', tipo: 'mo', d: 'Pulido', u: 'glb', q: 1, origen_q: 'dueño:M1', clave: 'INSTALACION' },
        { op: 'item', capitulo: 'Trofeo', desc: 'Traslado y montaje' },
        { op: 'fila', item: 'Traslado y montaje', tipo: 'mo', d: 'Instalación', u: 'glb', q: 1, origen_q: 'dueño:M1', clave: 'INSTALACION' },
        { op: 'item', capitulo: 'Trofeo', desc: 'Adhesivo de piso' },
        { op: 'fila', item: 'Adhesivo de piso', tipo: 'mat', d: 'Vinil', origen_q: 'dueño:M1', q: 2, clave: 'VINIL_CORTE' },
    ], ctxValid(), nuevoId);
    const av = Object.fromEntries(r.borrador.capitulos[0].items.map((it) => [it.desc, it.aviso || null]));
    assert.equal(av['Trofeo demo'], null, 'varias piezas del 3D = un ítem, sin aviso');
    assert.equal(av['Armado y fijaciones'], B.AVISO_COMPONENTE);
    assert.equal(av['Mano de obra: corte, rolado, soldadura'], B.AVISO_COMPONENTE);
    assert.equal(av['Base decorativa'], B.AVISO_COMPONENTE, 'solo mano de obra');
    assert.equal(av['Traslado y montaje'], null, 'el traslado y montaje sí es un entregable');
    assert.equal(av['Adhesivo de piso'], null);
    const res = B.resumen(r.borrador);
    assert.match(res.capitulos[0].items.find((x) => x.desc === 'Armado y fijaciones').aviso, /¿esto no es parte del APU de otro ítem\?/);
    assert.equal(r.borrador.capitulos[0].items[0].measures.length, 3);
});

prueba('norma inicial "un ítem = lo que se entrega": se siembra una vez y, si el dueño la borra, no vuelve', async () => {
    const alm = nuevoAlmacen();
    await api.atender(alm, { accion: 'enviar', cid: CID, pid: PID, texto: 'Trofeo' }, 'renzo');
    assert.match(alm.datos.agente_memoria.normas.inicial_estructura_items.texto, /Un ítem es lo que el cliente compra/);
    assert.match(JSON.parse(alm.datos.proyectos[CID][PID].agente.conversacion.api)[0].content[0].text, /Normas constructivas del taller[\s\S]*Un ítem es lo que el cliente compra/);
    delete alm.datos.agente_memoria.normas.inicial_estructura_items;
    await api.atender(alm, { accion: 'enviar', cid: CID, pid: 'otroProyecto', texto: 'Otro' }, 'renzo');
    assert.equal((alm.datos.agente_memoria.normas || {}).inicial_estructura_items, undefined);
    const { SISTEMA } = require('../../functions/agente/prompt.js');
    assert.match(SISTEMA, /Un ítem es lo que el cliente compra y se le entrega/);
});

// ------------------------------------------------------------------ costo: una sola ronda, effort de correcciones, caché, resultados compactos
prueba('una sola ronda de preguntas: la segunda sin "motivo" se rechaza', async () => {
    const alm = nuevoAlmacen();
    const p1 = await turnoListo(alm, 'Trofeo');
    await ejecutarTurno({ almacen: alm, cliente: clienteFalso([herramienta('preguntar_al_dueno', { preguntas: [{ pregunta: '1. ¿Alto total?' }, { pregunta: '2. ¿Base de mármol o MDF?' }] })]) }, p1);
    assert.equal(alm.datos.proyectos[CID][PID].agente.rondas_preguntas, 1);
    const p2 = await turnoListo(alm, '1. 40 cm 2. MDF');
    const cliente = clienteFalso([herramienta('preguntar_al_dueno', { preguntas: [{ pregunta: '¿Color?' }] }, 't2'), texto('Armo el borrador con supuestos.')]);
    const r = await ejecutarTurno({ almacen: alm, cliente }, p2);
    assert.equal(r.fin, 'listo');
    const tr = cliente.pedidos[1].messages.at(-1).content[0];
    assert.equal(tr.is_error, true); assert.match(tr.content, /Ya hiciste la ronda/);
    const p3 = await turnoListo(alm, 'Cambió: ahora son 3 trofeos distintos');
    const c3 = clienteFalso([herramienta('preguntar_al_dueno', { preguntas: [{ pregunta: '¿Los 3 del mismo alto?' }], motivo: 'el dueño cambió a 3 trofeos' }, 't3')]);
    assert.equal((await ejecutarTurno({ almacen: alm, cliente: c3 }, p3)).fin, 'pregunta');
});

prueba('correcciones con effort "medium" por mensaje (no se toca el effort del pedido) y prefijo de caché estable', async () => {
    const alm = await proyectoConBase();
    const pdf = (await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: 'pdf', nombre: 'planos.pdf', datos: PDF.toString('base64') }, 'renzo')).cuerpo.id;
    const p1 = await turnoListo(alm, 'Mostrador según el plano', [pdf]);
    const msg1 = Object.keys(alm.datos.proyectos[CID][PID].agente.conversacion.mensajes)[0];
    const c1 = clienteFalso([
        herramienta('armar_borrador', { operaciones: [{ op: 'item', capitulo: 'S', desc: 'Mostrador' }, { op: 'fila', item: 'Mostrador', tipo: 'mat', d: 'MDF', origen_q: `dueño:${msg1}`, q: 2, clave: 'MDF_18' }] }, 't1'),
        texto('Borrador listo.')]);
    await ejecutarTurno({ almacen: alm, cliente: c1 }, p1);
    assert.equal(c1.pedidos[0].messages.some((m) => m.role === 'system'), false, 'el primer turno va con el effort normal');
    assert.equal((c1.pedidos[0].betas || []).includes('mid-conversation-output-config-2026-07-01'), false);
    // corrección
    const r2 = await api.atender(alm, { accion: 'enviar', cid: CID, pid: PID, texto: 'Eran 3 planchas' }, 'renzo');
    assert.equal(r2.cuerpo.effort, 'medium');
    const cola = alm.datos.agente_cola; const k = Object.keys(cola)[0]; const p2 = cola[k]; delete cola[k];
    const c2 = clienteFalso([texto('Corregido.')]);
    await ejecutarTurno({ almacen: alm, cliente: c2 }, p2);
    const req = c2.pedidos[0];
    assert.deepEqual(req.output_config, { effort: 'high' }, 'el effort del pedido no cambia (no rompe la caché)');
    assert.deepEqual(req.messages.at(-1), { role: 'system', content: [], output_config: { effort: 'medium' } });
    assert.ok(req.betas.includes('mid-conversation-output-config-2026-07-01')); assert.ok(req.betas.includes('server-side-fallback-2026-07-01'));
    // dentro del turno de lectura, cada llamada repite la anterior byte a byte (el PDF va en el primer mensaje)
    assert.equal(JSON.stringify(c1.pedidos[1].messages.slice(0, c1.pedidos[0].messages.length)), JSON.stringify(c1.pedidos[0].messages));
    assert.equal(c1.pedidos[0].messages[0].content.some((b) => b.type === 'document'), true);
    // la primera corrección compacta: ya no va el PDF, va su resumen
    assert.equal(JSON.stringify(req.messages).includes('"type":"document"'), false);
    assert.deepEqual(req.cache_control, { type: 'ephemeral', ttl: '1h' });
    // otra corrección: no se repite el mensaje de effort
    await api.atender(alm, { accion: 'enviar', cid: CID, pid: PID, texto: 'Y sacá el canto' }, 'renzo').catch(() => {});
    await alm.escribir(`${RAIZ}/estado`, { fase: 'listo' });
    const r3 = await api.atender(alm, { accion: 'enviar', cid: CID, pid: PID, texto: 'Y sacá el canto' }, 'renzo');
    assert.equal(r3.status, 200);
    const h = JSON.parse(alm.datos.proyectos[CID][PID].agente.conversacion.api);
    assert.equal(h.filter((m) => m.role === 'system').length, 1);
    // entre correcciones (ya compactado) el prefijo es idéntico: la caché se lee
    const cola3 = alm.datos.agente_cola; const k3 = Object.keys(cola3)[0]; const p3 = cola3[k3]; delete cola3[k3];
    const c3 = clienteFalso([texto('Hecho.')]);
    await ejecutarTurno({ almacen: alm, cliente: c3 }, p3);
    const antes = c2.pedidos[0].messages;
    assert.equal(JSON.stringify(c3.pedidos[0].messages.slice(0, antes.length)), JSON.stringify(antes), 'prefijo idéntico entre turnos');
    // con "igual" en la configuración, no se cambia
    const alm2 = nuevoAlmacen({ config: { agente: { effort_correcciones: 'igual' } } });
    alm2.datos.proyectos = { [CID]: { [PID]: { agente: { borrador: { total: 10, capitulos: [{ id: 'c' }] } } } } };
    const r4 = await api.atender(alm2, { accion: 'enviar', cid: CID, pid: PID, texto: 'x' }, 'renzo');
    assert.equal(r4.cuerpo.effort, 'high');
});

prueba('medidor: % de la entrada que vino de la caché en cada llamada', async () => {
    assert.equal(N.pctCache({ entrada: 1000, cache_escrita: 0, cache_leida: 9000 }), 90);
    assert.equal(N.pctCache({ entrada: 0, cache_escrita: 0, cache_leida: 0 }), 0);
    const alm = nuevoAlmacen();
    const p = await turnoListo(alm, 'Hola');
    await ejecutarTurno({ almacen: alm, cliente: clienteFalso([texto('Hola.', uso(500, 100, 0, 4500))]) }, p);
    assert.equal(Object.values(alm.datos.proyectos[CID][PID].agente.costos.llamadas)[0].pct_cache, 90);
});

prueba('resultados compactos: buscar_base sin campos vacíos ni repetidos', async () => {
    const alm = await proyectoConBase();
    const ctx = { almacen: alm, cid: CID, pid: PID, mensajesAgente: [] };
    const r = await H.ejecutar(ctx, { type: 'tool_use', id: 'x', name: 'buscar_base', input: { texto: 'acrilico' } });
    const j = JSON.parse(r.content);
    assert.deepEqual(j.resultados[0], { origen: 'base:materiales/ACRILICO_3', n: 'Acrílico 3 mm', u: 'm2', p: 'sin precio', esp_mm: 3 });
    assert.ok(r.content.length < 200, r.content);
});

// ------------------------------------------------------------------ características del ítem (campo feat: PDF del cliente)
prueba('características: con origen en los números, sin datos internos, y van a "feat" al aplicar', () => {
    const c = ctxValid({ mensajesDueno: { M1: true, M2: true } });
    const caract = [
        { texto: 'Alto total 1,80 m × 0,60 m de fondo', origen: 'pieza3d:A3D/p1' },
        { texto: 'MDF 18 mm laqueado blanco', origen: 'base:materiales/MDF_18' },
        { texto: 'Logo en vinil de corte de 40 cm', origen: 'supuesto:logo proporcional al frente' },
        { texto: 'Incluye traslado e instalación en La Paz; no incluye diseño' },
    ];
    let r = B.aplicarOperaciones(null, [
        { op: 'item_desde_3d', capitulo: 'S', adjunto: 'A3D', item3d: 'Mostrador demo', desc: 'Mostrador de recepción', caracteristicas: caract },
        { op: 'item', capitulo: 'S', desc: 'Trofeo', caracteristicas: [{ texto: 'Alto 40 cm' }] },
        { op: 'item', capitulo: 'S', desc: 'Trofeo 2', caracteristicas: [{ texto: 'Precio especial 300 Bs', origen: 'dueño:M1' }] },
        { op: 'item', capitulo: 'S', desc: 'Copa de acero inoxidable con base de mármol, disco grabado, cruz de bronce y placa con nombres de los ganadores' },
        { op: 'item', capitulo: 'S', desc: 'Trofeo 3', caracteristicas: [{ texto: 'Mano de obra por trato con el soldador' }] },
    ], c, nuevoId);
    assert.deepEqual(r.resultados.map((x) => x.ok), [true, false, false, false, false]);
    assert.match(r.resultados[1].error, /falta el origen/); assert.match(r.resultados[2].error, /sin precios/);
    assert.match(r.resultados[3].error, /descripción del ítem es larga/); assert.match(r.resultados[4].error, /datos internos/);
    const it = r.borrador.capitulos[0].items[0];
    assert.equal(it.caracteristicas[0].origen, 'pieza3d:A3D/p1');
    // el supuesto sin confirmar no sale al presupuesto
    let items = B.aItemsPresupuesto(r.borrador);
    assert.equal(items[1].feat, '• Alto total 1,80 m × 0,60 m de fondo\n• MDF 18 mm laqueado blanco\n• Incluye traslado e instalación en La Paz; no incluye diseño');
    assert.equal(items[1].desc, 'Mostrador de recepción');
    r = B.aplicarOperaciones(r.borrador, [{ op: 'confirmar_supuestos', item: it.id, confirmacion: 'dueño:M2' }], c, nuevoId);
    items = B.aItemsPresupuesto(r.borrador);
    assert.match(items[1].feat, /Logo en vinil de corte de 40 cm/);
    // reaplicar actualiza desc y feat del ítem ya aplicado, en su lugar
    const data = B.aplicarAlPresupuesto([{ type: 'item', id: 'x', desc: 'Otro' }], items).data;
    r = B.aplicarOperaciones(r.borrador, [{ op: 'item', id: it.id, desc: 'Mostrador recepción curvo', caracteristicas: [{ texto: 'MDF 18 mm laqueado negro', origen: 'dueño:M2' }] }], c, nuevoId);
    const a2 = B.aplicarAlPresupuesto(data, B.aItemsPresupuesto(r.borrador));
    assert.equal(a2.data[2].desc, 'Mostrador recepción curvo'); assert.equal(a2.data[2].feat, '• MDF 18 mm laqueado negro'); assert.equal(a2.actualizados, 1);
    // el resumen para el agente muestra las características del ítem tocado y avisa si faltan
    const res = B.resumen(r.borrador, [it.id]);
    assert.deepEqual(res.capitulos[0].items[0].caracteristicas, ['MDF 18 mm laqueado negro']);
    const sin = B.aplicarOperaciones(null, [{ op: 'item', capitulo: 'S', desc: 'Letrero' }], c, nuevoId);
    assert.match(B.resumen(sin.borrador).capitulos[0].items[0].aviso, /faltan las características/);
});

// ------------------------------------------------------------------ varias conversaciones por proyecto
prueba('conversaciones: "＋ Nueva" empieza de cero (sin historial ni adjuntos) con el resumen del presupuesto; la anterior queda en la lista', async () => {
    const alm = await proyectoConBase();
    alm.datos.proyectos[CID][PID].presupuesto.items = [{ type: 'chapter', name: 'TROFEOS' }, { type: 'item', id: 'tA', desc: 'Trofeo Paceña', cant: 1, und: 'pza', pu: 850, origen: 'agente' }];
    const id3d = await adjuntar3D(alm);
    const p1 = await turnoListo(alm, 'Cotizá la copa', [id3d]);
    await ejecutarTurno({ almacen: alm, cliente: clienteFalso([
        herramienta('armar_borrador', { operaciones: [{ op: 'item_desde_3d', capitulo: 'Trofeos', adjunto: id3d, item3d: 'Mostrador demo', desc: 'Copa grande' }] }, 't1'), texto('Listo.')]) }, p1);
    const ag = () => alm.datos.proyectos[CID][PID].agente;
    assert.equal(ag().conversaciones_meta.principal.titulo, 'Copa grande', 'título automático: el primer ítem');
    // nueva conversación
    const n = await api.atender(alm, { accion: 'nueva', cid: CID, pid: PID }, 'renzo');
    assert.equal(n.status, 200); const conv = n.cuerpo.conv;
    assert.equal(ag().actual, conv); assert.equal(ag().conversaciones_meta[conv].titulo, 'Nueva conversación');
    const r = await api.atender(alm, { accion: 'enviar', cid: CID, pid: PID, conv, texto: 'Ahora un letrero de 2×1 m' }, 'renzo');
    assert.equal(r.status, 200); assert.equal(r.cuerpo.conv, conv);
    const h = JSON.parse(ag().conversaciones[conv].conversacion.api);
    assert.equal(h.length, 1);
    assert.match(h[0].content[0].text, /Presupuesto actual de este proyecto[\s\S]*Trofeo Paceña · 1 pza · Bs 850/);
    assert.equal(h[0].content.some((b) => b.type === 'adjunto'), false, 'sin los adjuntos de la otra conversación');
    assert.equal(JSON.stringify(h).includes('Cotizá la copa'), false, 'sin la conversación anterior');
    assert.equal(ag().conversaciones_meta[conv].titulo, 'Ahora un letrero de 2×1 m');
    const cola = alm.datos.agente_cola; const k = Object.keys(cola)[0]; const p2 = cola[k]; delete cola[k];
    assert.equal(p2.conv, conv);
    // mientras trabaja, otra conversación del mismo proyecto espera (un turno a la vez por proyecto)
    const bloqueado = await api.atender(alm, { accion: 'enviar', cid: CID, pid: PID, texto: 'algo en la principal' }, 'renzo');
    assert.equal(bloqueado.status, 409);
    await ejecutarTurno({ almacen: alm, cliente: clienteFalso([
        herramienta('armar_borrador', { operaciones: [{ op: 'item', capitulo: 'Letreros', desc: 'Letrero 2×1', caracteristicas: [{ texto: 'Lona impresa' }] }] }, 't2'), texto('Armado.', uso(1_000_000, 0))]) }, p2);
    // borrador, mensajes y costos de cada conversación por separado
    assert.equal(ag().conversaciones[conv].borrador.capitulos[0].items[0].desc, 'Letrero 2×1');
    assert.equal(ag().borrador.capitulos[0].items[0].desc, 'Copa grande', 'el borrador de la principal no cambia');
    assert.ok(ag().conversaciones[conv].costos.total.usd >= 4);
    assert.ok(ag().conversaciones_meta[conv].costo_usd >= 4);
    assert.equal(ag().conversaciones_meta[conv].titulo, 'Letrero 2×1');
    assert.equal(ag().estado.conv, conv);
    // aplicar desde cada conversación: los ítems llevan su conversación y no se pisan
    const a = B.aItemsPresupuesto(ag().borrador, { conv: 'principal' });
    const b2 = B.aItemsPresupuesto(ag().conversaciones[conv].borrador, { conv });
    let data = B.aplicarAlPresupuesto([], a).data;
    data = B.aplicarAlPresupuesto(data, b2).data;
    assert.deepEqual(data.filter((x) => x.type === 'item').map((x) => [x.desc, x.agente.conv]), [['Copa grande', 'principal'], ['Letrero 2×1', conv]]);
    const re = B.aplicarAlPresupuesto(data, b2);
    assert.equal(re.agregados, 0); assert.equal(re.actualizados, 1);
    assert.equal(re.data.find((x) => x.desc === 'Copa grande').agente.conv, 'principal');
    // conversación inválida
    assert.equal((await api.atender(alm, { accion: 'enviar', cid: CID, pid: PID, conv: '../x', texto: 'x' }, 'renzo')).status, 400);
});

// ------------------------------------------------------------------ costo de una corrección: compactación, caché 1 h, ver_adjunto, modelo, edición a mano
const tokensDe = (pedido) => Math.round(JSON.stringify({ s: pedido.system, t: pedido.tools, m: pedido.messages }).length / 4);   // aprox. 4 caracteres por token
async function cotizacionConAdjuntos(alm) {
    // un PDF "grande" (~240 KB ≈ 80.000 tokens en base64) y una foto: lo típico de una cotización real
    const pdfGrande = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(240000, 65)]);
    const pdf = (await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: 'pdf', nombre: 'planos.pdf', datos: pdfGrande.toString('base64') }, 'renzo')).cuerpo.id;
    const foto = (await api.atender(alm, { accion: 'adjuntar', cid: CID, pid: PID, tipo: 'imagen', nombre: 'copa.jpg', datos: Buffer.concat([JPG, Buffer.alloc(60000, 1)]).toString('base64') }, 'renzo')).cuerpo.id;
    const p1 = await turnoListo(alm, 'Trofeo según el plano', [pdf, foto]);
    const m1 = Object.keys(alm.datos.proyectos[CID][PID].agente.conversacion.mensajes)[0];
    const c1 = clienteFalso([
        herramienta('resumen_de_lectura', { adjuntos: [{ id: pdf, resumen: 'Plano p.1: Trofeo Paceña, alto total 45 cm ("450"), copa de acero, base de MDF 18 mm laqueada negra.' }, { id: foto, resumen: 'Foto de la copa de referencia, acabado espejo.' }] }, 'r1'),
        herramienta('armar_borrador', { operaciones: [{ op: 'item', capitulo: 'Trofeos', desc: 'Trofeo Paceña', caracteristicas: [{ texto: 'Alto total 45 cm', origen: `cota_plano:${pdf} p.1 "450"` }] },
            { op: 'fila', item: 'Trofeo Paceña', tipo: 'mat', d: 'MDF', origen_q: `dueño:${m1}`, q: 1, clave: 'MDF_18' }] }, 'r2'),
        texto('Borrador listo.')]);
    await ejecutarTurno({ almacen: alm, cliente: c1 }, p1);
    return { pdf, foto, c1 };
}

prueba('corrección "agregá las características": antes vs después (compactación + caché 1 h)', async () => {
    const alm = await proyectoConBase();
    const { pdf, c1 } = await cotizacionConAdjuntos(alm);
    const precios = N.PRECIOS_DEFECTO;
    // ANTES: la corrección mandaba todo el historial con el PDF y la foto; con caché de 5 min vencida → se reescribía todo
    const tokAntes = tokensDe(c1.pedidos.at(-1)) + 300;
    const antes = N.costoDeUso({ input_tokens: 300, cache_creation_input_tokens: tokAntes - 300, cache_read_input_tokens: 0, output_tokens: 1500 }, 'claude-opus-5-5', precios).usd;
    // DESPUÉS: la primera corrección compacta (los adjuntos → su resumen de lectura)
    const p2 = await turnoListo(alm, 'Agregá las características');
    const c2 = clienteFalso([texto('Agregadas.')]);
    await ejecutarTurno({ almacen: alm, cliente: c2 }, p2);
    const req = c2.pedidos[0];
    const j = JSON.stringify(req.messages);
    assert.equal(j.includes('"type":"document"') || j.includes('"type":"image"'), false, 'sin PDF ni imágenes');
    assert.match(j, /alto total 45 cm/); assert.match(j, /Trofeo Paceña/); assert.match(j, /ver_adjunto/);
    assert.ok(alm.datos.proyectos[CID][PID].agente.conversacion.api_antes_de_compactar, 'el historial completo queda guardado');
    const tokDespues = tokensDe(req);
    // la compactación escribe una vez el prefijo chico (1 h); las correcciones siguientes lo leen
    const despuesPrimera = N.costoDeUso({ input_tokens: 300, cache_creation: { ephemeral_1h_input_tokens: tokDespues - 300 }, cache_creation_input_tokens: tokDespues - 300, output_tokens: 1500 }, 'claude-opus-5-5', precios).usd;
    const despues = N.costoDeUso({ input_tokens: 300, cache_read_input_tokens: tokDespues - 300, output_tokens: 1500 }, 'claude-opus-5-5', precios).usd;
    const sonnet = N.costoDeUso({ input_tokens: 300, cache_read_input_tokens: tokDespues - 300, output_tokens: 1500 }, 'claude-sonnet-5-5', precios).usd;
    console.log(`      tokens por llamada: antes ≈ ${tokAntes}, después ≈ ${tokDespues}`);
    console.log(`      corrección (1 llamada): antes ${N.usd(antes)} · primera tras compactar ${N.usd(despuesPrimera)} · siguientes ${N.usd(despues)} (Sonnet 5.5: ${N.usd(sonnet)})`);
    assert.ok(tokDespues < tokAntes / 5, 'el contexto se achica mucho');
    assert.ok(despues < antes / 5 && despues < 0.05, 'la corrección baja a centavos');
});

prueba('ver_adjunto: el adjunto vuelve solo en ese turno; la próxima corrección lo vuelve a compactar', async () => {
    const alm = await proyectoConBase();
    const { pdf } = await cotizacionConAdjuntos(alm);
    const p2 = await turnoListo(alm, 'Revisá la cota del plano');
    const c2 = clienteFalso([herramienta('ver_adjunto', { id: pdf }, 'v1'), texto('Visto.')]);
    await ejecutarTurno({ almacen: alm, cliente: c2 }, p2);
    const tr = c2.pedidos[1].messages.at(-1).content[0];
    assert.equal(tr.type, 'tool_result'); assert.ok(tr.content.some((b) => b.type === 'document'), 'el PDF vuelve dentro del resultado');
    const p3 = await turnoListo(alm, 'Ok, sumá 2');
    const c3 = clienteFalso([texto('Listo.')]);
    await ejecutarTurno({ almacen: alm, cliente: c3 }, p3);
    assert.equal(JSON.stringify(c3.pedidos[0].messages).includes('"type":"document"'), false);
});

prueba('modelo de las correcciones configurable: el primer borrador con el principal, después el elegido', async () => {
    const alm = await proyectoConBase({ config: { agente: { modelo_correcciones: 'claude-sonnet-5-5' } } });
    const { c1 } = await cotizacionConAdjuntos(alm);
    assert.equal(c1.pedidos[0].model, 'claude-opus-5-5');
    const p2 = await turnoListo(alm, 'Cambiá el nombre');
    const c2 = clienteFalso([texto('Hecho.')]);
    await ejecutarTurno({ almacen: alm, cliente: c2 }, p2);
    assert.equal(c2.pedidos[0].model, 'claude-sonnet-5-5');
    assert.equal(N.configEfectiva({}).modelo_correcciones, 'igual', 'por defecto, el mismo modelo principal');
    assert.ok(N.costoCorreccionEstimado('claude-haiku-5-5') < N.costoCorreccionEstimado('claude-sonnet-5-5'));
    assert.ok(N.costoCorreccionEstimado('claude-sonnet-5-5') < N.costoCorreccionEstimado('claude-opus-5-5'));
});

prueba('edición a mano sin IA: nombre, cantidad, características y borrar fila; el agente se entera en el próximo turno', async () => {
    const alm = await proyectoConBase();
    await cotizacionConAdjuntos(alm);
    const ag = () => alm.datos.proyectos[CID][PID].agente;
    const it = ag().borrador.capitulos[0].items[0];
    const r = B.editarManual(ag().borrador, { item: it.id, desc: 'Trofeo Paceña 2026', cant: 3, caracteristicas: 'Alto 45 cm\nCopa de acero espejo\nBase MDF laqueada negra' }, 'MSG1');
    assert.equal(r.error, undefined, r.error);
    const it2 = r.borrador.capitulos[0].items[0];
    assert.equal(it2.desc, 'Trofeo Paceña 2026'); assert.equal(it2.cant, 3); assert.equal(it2.cant_origen, 'dueño:MSG1');
    assert.equal(it2.caracteristicas[0].origen, 'dueño:MSG1'); assert.equal(it2.total, Math.round(it2.pu * 3 * 100) / 100);
    assert.match(r.texto, /cantidad 1 → 3/);
    assert.match(B.editarManual(ag().borrador, { item: it.id, caracteristicas: 'Precio 300 Bs' }, 'M').error, /datos internos/);
    const sinFila = B.editarManual(r.borrador, { item: it.id, quitar: { tipo: 'mat', n: 1 } }, 'MSG2');
    assert.equal(sinFila.borrador.capitulos[0].items[0].apu.mat.length, 0); assert.match(sinFila.texto, /borró la fila "MDF/);
    // el chat lo registra y el próximo turno lo recibe
    await alm.escribir(`${RAIZ}/borrador`, sinFila.borrador);
    await alm.agregar(`${RAIZ}/conversacion/ediciones`, { texto: r.texto });
    await alm.agregar(`${RAIZ}/conversacion/ediciones`, { texto: sinFila.texto });
    await api.atender(alm, { accion: 'enviar', cid: CID, pid: PID, texto: 'Revisá' }, 'renzo');
    const h = JSON.parse(ag().conversacion.api);
    assert.match(JSON.stringify(h), /Cambios que hizo el dueño a mano[\s\S]*cantidad 1 → 3[\s\S]*borró la fila/);
    assert.equal(ag().conversacion.ediciones, undefined, 'se consumen');
});

// ------------------------------------------------------------------ alternativas y "por confirmar": se cotizan, no suman
prueba('alternativas excluyentes y "por confirmar" no suman al total; al aplicar quedan con el ojo apagado', () => {
    const c = ctxValid();
    let r = B.aplicarOperaciones(null, [
        { op: 'item', capitulo: 'Obra', desc: 'Stand completo', caracteristicas: [{ texto: 'Stand de feria' }] },
        { op: 'fila', item: 'Stand completo', tipo: 'sub', d: 'Stand', u: 'glb', q: 1, origen_q: 'dueño:M1', p: 1000, origen_p: 'dueño:M1' },
        { op: 'item', capitulo: 'Obra', desc: 'Ventanas opción 1', condicion: 'alternativa', grupo: 'Ventanas' },
        { op: 'fila', item: 'Ventanas opción 1', tipo: 'sub', d: 'Ventana', u: 'glb', q: 1, origen_q: 'dueño:M1', p: 500, origen_p: 'dueño:M1' },
        { op: 'item', capitulo: 'Obra', desc: 'Ventanas opción 2', condicion: 'alternativa', grupo: 'Ventanas' },
        { op: 'fila', item: 'Ventanas opción 2', tipo: 'sub', d: 'Ventana', u: 'glb', q: 1, origen_q: 'dueño:M1', p: 700, origen_p: 'dueño:M1' },
        { op: 'item', capitulo: 'Obra', desc: 'Señalética exterior', condicion: 'por_confirmar' },
        { op: 'item', capitulo: 'Obra', desc: 'Otra', condicion: 'opcional' },
    ], c, nuevoId);
    assert.equal(r.resultados.at(-1).ok, false);
    const pu = (p) => L.calcPu({ mat: [], mo: [], eq: [], sub: [{ q: 1, p }], cs: 55, ind: 10, util: 30 });
    assert.equal(r.borrador.total, pu(1000), 'solo suma el ítem normal');
    assert.equal(r.borrador.capitulos[0].total, pu(1000));
    assert.deepEqual(r.borrador.aparte.map((a) => [a.desc, a.condicion]), [['Ventanas opción 1', 'alternativa'], ['Ventanas opción 2', 'alternativa'], ['Señalética exterior', 'por_confirmar']]);
    const res = B.resumen(r.borrador);
    assert.equal(res.fuera_del_total.length, 3);
    assert.match(res.capitulos[0].items[1].condicion, /ALTERNATIVA \(no suma al total\) · Ventanas/);
    const items = B.aItemsPresupuesto(r.borrador).filter((x) => x.type === 'item');
    assert.equal(items[0].activo, undefined);
    assert.equal(items[1].activo, false); assert.equal(items[1].agente.condicion, 'alternativa'); assert.equal(items[1].agente.grupo, 'Ventanas');
    assert.equal(items[3].activo, false); assert.equal(items[3].agente.condicion, 'por_confirmar');
    // vuelve al total con "normal"
    const id = r.borrador.capitulos[0].items[1].id;
    r = B.aplicarOperaciones(r.borrador, [{ op: 'item', id, condicion: 'normal' }], c, nuevoId);
    assert.equal(r.borrador.total, Math.round((pu(1000) + pu(500)) * 100) / 100);
    const { SISTEMA } = require('../../functions/agente/prompt.js');
    assert.match(SISTEMA, /NUNCA sumes alternativas excluyentes al total/);
});

// ------------------------------------------------------------------ correr
for (const [nombre, fn] of pruebas) {
    try { await fn(); ok++; console.log('ok  ', nombre); }
    catch (e) { console.log('FALLA', nombre, '\n     ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n      ') : e); process.exitCode = 1; }
}
console.log(`\n${ok}/${pruebas.length} pruebas OK`);
