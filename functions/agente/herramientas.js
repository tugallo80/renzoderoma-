/**
 * Herramientas del agente. Todas trabajan sobre código que ya existe (lector-3d.js, la base) y solo
 * tocan el proyecto y los nodos permitidos (ver almacen.js). Cada una valida su entrada antes de correr:
 * con eager_input_streaming la API no la valida.
 */
const N = require("./compartido/agente-nucleo.js");

const RAIZ = (ctx) => `proyectos/${ctx.cid}/${ctx.pid}/agente`;

// ---------------------------------------------------------------- validación de entrada
function validar(schema, valor, camino = "entrada") {
    const errores = [];
    const tipoDe = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
    (function rec(s, v, c) {
        if (!s) return;
        const t = tipoDe(v);
        if (s.type === "integer" ? !(t === "number" && Number.isInteger(v)) : s.type && s.type !== t) {
            errores.push(`${c}: se esperaba ${s.type} y llegó ${t}`); return;
        }
        if (s.enum && !s.enum.includes(v)) errores.push(`${c}: "${v}" no es uno de ${s.enum.join(", ")}`);
        if (t === "object") {
            (s.required || []).forEach((k) => { if (v[k] === undefined) errores.push(`${c}.${k}: falta`); });
            Object.keys(s.properties || {}).forEach((k) => { if (v[k] !== undefined) rec(s.properties[k], v[k], `${c}.${k}`); });
        }
        if (t === "array" && s.items) v.forEach((x, i) => rec(s.items, x, `${c}[${i}]`));
        if (t === "string" && s.maxLength && v.length > s.maxLength) errores.push(`${c}: más de ${s.maxLength} caracteres`);
    })(schema, valor, camino);
    return errores;
}

// ---------------------------------------------------------------- medición 3D
async function cargarMedicion(ctx, id) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(id || ""))) throw new Error(`Adjunto inválido: ${id}`);
    const meta = await ctx.almacen.leer(`${RAIZ(ctx)}/adjuntos/${id}`);
    if (!meta) throw new Error(`No existe el adjunto ${id} en este proyecto.`);
    if (meta.tipo !== "3d" || !meta.medicion_ruta) throw new Error(`El adjunto ${id} (${meta.nombre}) no es un modelo 3D medido.`);
    ctx._mediciones = ctx._mediciones || {};
    if (!ctx._mediciones[id]) {
        const buf = await ctx.almacen.bajarArchivo(meta.medicion_ruta);
        ctx._mediciones[id] = JSON.parse(Buffer.from(buf).toString("utf8"));
    }
    const factor = meta.escala && meta.escala.factor ? meta.escala.factor : 1;
    return { meta, med: N.escalarMedicion(ctx._mediciones[id], factor) };
}

const HERRAMIENTAS = [
    {
        def: {
            name: "medicion_3d",
            description: "Consulta lo que la app midió de un modelo 3D adjunto (formato rubik/1): piezas con largo, ancho y espesor en mm, cantidad, tipo (plancha o volumen), área total y de una cara en m², perímetro en ml, volumen en m³, material del archivo o de la base, acabados, avisos, y por ítem los indicadores de la ruta B (m² de tablero, ml de canto, m² de superficie, piezas, m³). Es la ÚNICA fuente de medidas y cantidades del 3D. Usá el id de pieza (p1, p2…) como origen: pieza3d:<adjunto>/<id>. Podés filtrar por ítem o por ids de pieza.",
            input_schema: {
                type: "object",
                properties: {
                    adjunto: { type: "string", description: "Id del adjunto 3D (aparece como [Adjunto <id> · … · modelo 3D medido por la app])." },
                    item: { type: "string", description: "Opcional: solo las piezas de este ítem del 3D." },
                    piezas: { type: "array", items: { type: "string" }, description: "Opcional: ids de pieza (p1, p2…)." },
                },
                required: ["adjunto"],
            },
        },
        progreso: "Midiendo el 3D…",
        async correr(ctx, e) {
            const { meta, med } = await cargarMedicion(ctx, e.adjunto);
            const r = N.resumenMedicion(med, { escala: meta.escala || null, tamano_m: meta.tamano_m ? N.escalarMedicion({ piezas: [], tamano_m: meta.tamano_m }, (meta.escala || {}).factor || 1).tamano_m : null });
            r.adjunto = e.adjunto;
            if (e.item) { r.piezas = r.piezas.filter((p) => p.item === e.item); r.items = r.items.filter((x) => x.item === e.item); }
            if (e.piezas && e.piezas.length) r.piezas = r.piezas.filter((p) => e.piezas.includes(p.id));
            if (!r.piezas.length) r.aviso = "Ninguna pieza coincide con el filtro. Ítems del 3D: " + N.resumenMedicion(med).items.map((x) => x.item).join(", ");
            if (!meta.escala) r.aviso_escala = "Escala tal como vino en el archivo (" + (meta.unidad || "?") + "). Si el plano da una medida total distinta, puede no estar a escala: preguntalo o usá la cota del plano.";
            return r;
        },
    },
    {
        def: {
            name: "preguntar_al_dueno",
            description: "Le hace al dueño preguntas concretas de ESTE proyecto que no se pueden sacar del 3D, de los documentos, de la base ni de la memoria, y TERMINA el turno hasta que responda. Juntá todas las preguntas en una sola llamada. Nada de opciones múltiples genéricas.",
            input_schema: {
                type: "object",
                properties: {
                    preguntas: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                pregunta: { type: "string", description: "La pregunta, corta y con el dato concreto que falta." },
                                para_que: { type: "string", description: "Para qué fila o ítem hace falta (opcional)." },
                            },
                            required: ["pregunta"],
                        },
                    },
                    avance: { type: "string", description: "Una o dos líneas de lo que ya quedó hecho (opcional)." },
                },
                required: ["preguntas"],
            },
        },
        progreso: "Preparando preguntas…",
        async correr(ctx, e) {
            const preguntas = e.preguntas.filter((p) => p && String(p.pregunta || "").trim()).slice(0, 8)
                .map((p) => ({ pregunta: String(p.pregunta).trim().slice(0, 500), para_que: p.para_que ? String(p.para_que).slice(0, 200) : null }));
            if (!preguntas.length) throw new Error("No llegó ninguna pregunta.");
            ctx.cortarTurno = true;
            ctx.mensajesAgente.push({ rol: "agente", texto: (e.avance ? String(e.avance).trim() + "\n\n" : "") + "Necesito que me confirmes:", preguntas });
            return { ok: true, nota: "Preguntas enviadas al dueño. El turno termina acá: no sigas hasta su respuesta." };
        },
    },
];

function definiciones() {
    // Orden fijo (la caché depende del prefijo exacto). eager_input_streaming: se valida acá.
    return HERRAMIENTAS.map((h) => Object.assign({}, h.def, { eager_input_streaming: true }));
}

/** Ejecuta un bloque tool_use y devuelve el tool_result (nunca tira: los errores vuelven como is_error). */
async function ejecutar(ctx, bloque) {
    const h = HERRAMIENTAS.find((x) => x.def.name === bloque.name);
    const res = (contenido, error) => ({ type: "tool_result", tool_use_id: bloque.id, content: typeof contenido === "string" ? contenido : JSON.stringify(contenido), ...(error ? { is_error: true } : {}) });
    if (!h) return res(`No existe la herramienta ${bloque.name}.`, true);
    if (!bloque.input || typeof bloque.input !== "object" || Array.isArray(bloque.input)) {
        return res({ INVALID_JSON: String(JSON.stringify(bloque.input)).slice(0, 2000) }, true);
    }
    const errores = validar(h.def.input_schema, bloque.input);
    if (errores.length) return res({ INVALID_INPUT: errores.slice(0, 10) }, true);
    try {
        if (ctx.progreso && h.progreso) await ctx.progreso(typeof h.progreso === "function" ? h.progreso(bloque.input) : h.progreso);
        return res(await h.correr(ctx, bloque.input));
    } catch (e) {
        return res(`Error: ${e.message}`, true);
    }
}

module.exports = { definiciones, ejecutar, validar, HERRAMIENTAS, cargarMedicion };
