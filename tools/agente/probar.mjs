// Pruebas del Agente IA cotizador. La API de Claude está SIMULADA: no se gasta plata.
// Uso: cd tools/agente && npm test   (necesita `npm install` en functions/ para el SDK; no se llama)
// Todos los datos son inventados (el repo es público).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const N = require('../../public/js/agente-nucleo.js');
const { crearAlmacenMemoria } = require('./almacen-memoria.cjs');
const api = require('../../functions/agente/api.js');
const { ejecutarTurno, armarPedido } = require('../../functions/agente/loop.js');
const H = require('../../functions/agente/herramientas.js');
const hist = require('../../functions/agente/historial.js');
const L = require('../../public/js/lector-3d.js');
const B = require('../../public/js/agente-borrador.js');

let ok = 0;
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
    assert.deepEqual(p.system[0].cache_control, { type: 'ephemeral' });
    assert.deepEqual(p.cache_control, { type: 'ephemeral' });
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
    assert.equal(med.piezas.length, 2); assert.equal(med.piezas[0].largo_mm, 1800);
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
        mensajesDueno: { M1: true }, base: BASE, recargosPresupuesto: { cs: 55, ind: 10, util: 30 } }, extra || {});
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
    // directo = 3×45 + 300 + 300×55 % = 600 ; × 1,10 × 1,30 = 858
    assert.equal(it.pu, 858); assert.equal(it.pu, L.calcPu({ mat: it.apu.mat, mo: it.apu.mo, eq: [], sub: [], cs: 55, ind: 10, util: 30 }));
    assert.equal(it.total, 1716); assert.equal(r.borrador.capitulos[0].total, 1716); assert.equal(r.borrador.total, 1716);
    assert.equal(r.borrador.recargos.origen, 'base:presupuesto/recargos');
    const sinOrigen = B.aplicarOperaciones(null, [{ op: 'item', capitulo: 'X', desc: 'Y', cant: 3 }], ctxValid(), nuevoId);
    assert.equal(sinOrigen.resultados[0].ok, false, 'cantidad del ítem distinta de 1 sin origen');
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
    assert.equal(bb.resultados[0].origen, 'base:materiales/MDF_18'); assert.equal(bb.resultados[0].precio, 120);
    const ra = JSON.parse(cliente.pedidos[2].messages.at(-1).content[0].content);
    assert.equal(ra.aplicadas, 2); assert.equal(ra.rechazadas.length, 1); assert.match(ra.rechazadas[0].motivo, /origen/);
    let bor = alm.datos.proyectos[CID][PID].agente.borrador;
    const it = bor.capitulos[0].items[0];
    assert.equal(it.pu, L.calcPu({ mat: it.apu.mat, mo: it.apu.mo, eq: [], sub: [], cs: 55, ind: 10, util: 30 }));
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
    assert.equal(med.piezas[0].largo_mm, 3600); assert.equal(med.piezas[0].area_cara_m2, 4.32);
});

prueba('herramientas: orden fijo para la caché', () => {
    assert.deepEqual(H.definiciones().map((d) => d.name), ['medicion_3d', 'buscar_base', 'armar_borrador', 'escala_3d', 'guardar_en_base', 'preguntar_al_dueno']);
});

// ------------------------------------------------------------------ correr
for (const [nombre, fn] of pruebas) {
    try { await fn(); ok++; console.log('ok  ', nombre); }
    catch (e) { console.log('FALLA', nombre, '\n     ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n      ') : e); process.exitCode = 1; }
}
console.log(`\n${ok}/${pruebas.length} pruebas OK`);
