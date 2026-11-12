/**
 * Herramientas del agente. Todas trabajan sobre código que ya existe (lector-3d.js, la base) y solo
 * tocan el proyecto y los nodos permitidos (ver almacen.js). Cada una valida su entrada antes de correr:
 * con eager_input_streaming la API no la valida.
 */
const N = require("./compartido/agente-nucleo.js");
const B = require("./compartido/agente-borrador.js");

const R = require("./rutas");
const RAIZ = (ctx) => R.RAIZ(ctx.cid, ctx.pid);                 // proyecto: adjuntos
const RC = (ctx) => R.raizConv(ctx.cid, ctx.pid, ctx.conv);      // conversación: mensajes, borrador, rondas

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


// ---------------------------------------------------------------- contexto para validar orígenes
const NODOS = ["materiales", "mano_obra", "oficios", "rendimientos", "equivalencias_vw"];
async function base(ctx) {
    if (!ctx._base) {
        ctx._base = {};
        for (const n of NODOS) ctx._base[n] = (await ctx.almacen.leer(`base_datos/${n}`)) || {};
    }
    return ctx._base;
}

async function recargosPresupuesto(ctx) {
    const items = await ctx.almacen.leer(`proyectos/${ctx.cid}/${ctx.pid}/presupuesto/items`);
    const lista = Array.isArray(items) ? items : Object.values(items || {});
    for (let i = lista.length - 1; i >= 0; i--) {
        const a = lista[i] && lista[i].apu;
        if (a && (a.util != null || a.ind != null || a.cs != null)) {
            const pct = (v, d) => { const n = parseFloat(v); return isFinite(n) ? (n > 0 && n < 1 ? n * 100 : n) : d; };
            return { cs: pct(a.cs, 55), ind: pct(a.ind, 10), util: pct(a.util, 50) };
        }
    }
    return null;
}

async function contexto(ctx) {
    const adjuntos = (await ctx.almacen.leer(`${RAIZ(ctx)}/adjuntos`)) || {};
    const mediciones = {};
    for (const id of Object.keys(adjuntos)) {
        if (adjuntos[id].tipo === "3d") { try { mediciones[id] = (await cargarMedicion(ctx, id)).med; } catch (e) { /* sin medición */ } }
    }
    const msgs = (await ctx.almacen.leer(`${RC(ctx)}/conversacion/mensajes`)) || {};
    const mensajesDueno = {};
    Object.keys(msgs).forEach((k) => { if (msgs[k] && msgs[k].rol === "dueno") mensajesDueno[k] = true; });
    return { adjuntos, mediciones, mensajesDueno, base: await base(ctx), recargosPresupuesto: await recargosPresupuesto(ctx) };
}

// ---------------------------------------------------------------- buscar en la base
function normalizar(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9.,]+/g, " ").trim(); }
function espesorDe(m, clave) {
    const e = parseFloat(m && (m.espesor_mm != null ? m.espesor_mm : m.espesor));
    if (e > 0) return e;
    const t = `${(m && (m.n || m.desc)) || ""} ${clave}`;
    const r = /(\d+(?:[.,]\d+)?)\s*mm\b/i.exec(t) || /\b(?:mdf|melamina|terciado|acrilico|acrílico|pvc|foam|trupan)\D{0,6}(\d+(?:[.,]\d+)?)\b/i.exec(t);
    return r ? parseFloat(r[1].replace(",", ".")) : null;
}
function precioDe(m) { const p = parseFloat(m && (m.p != null ? m.p : m.pu)); return p > 0 ? Math.round(p * 100) / 100 : null; }

function entrada(nodo, clave, m) {
    // Compacto: solo lo que sirve para el borrador (sin campos vacíos)
    const o = { origen: `base:${nodo}/${clave}` };
    const pon = (k, v) => { if (v !== null && v !== undefined && v !== "") o[k] = v; };
    if (nodo === "materiales" || nodo === "mano_obra") {
        pon("n", m.n || m.desc || clave); pon("u", m.u || m.und || null);
        const p = precioDe(m); o.p = p == null ? "sin precio" : p;
        if (nodo === "materiales") {
            pon("esp_mm", espesorDe(m, clave));
            if (m.plancha_largo || m.largo) o.plancha = [m.plancha_largo || m.largo, m.plancha_ancho || m.ancho];
            pon("barra", m.barra_largo || null);
            if (m.mo_receta) o.receta = (Array.isArray(m.mo_receta) ? m.mo_receta : Object.values(m.mo_receta)).map((x) => `${x.mo}:${x.medida}${x.factor && x.factor !== 1 ? "×" + x.factor : ""}`).join(", ");
            else if (m.mo_receta_ninguna) o.receta = "no lleva";
        }
    } else if (nodo === "oficios") {
        pon("n", m.nombre || clave); pon("jornal", parseFloat(m.costo_jornal) > 0 ? parseFloat(m.costo_jornal) : "sin costo");
    } else if (nodo === "rendimientos") {
        pon("oficio", m.oficio); pon("indicador", m.indicador); pon("por_jornal", m.por_jornal != null ? m.por_jornal : "falta"); pon("trabajo", m.trabajo || null);
        if (m.tramos) o.tramos = m.tramos;
    } else if (nodo === "equivalencias_vw") {
        pon("texto", m.vw); pon("material", m.material);
    }
    return o;
}

/**
 * Resultado compacto de medicion_3d: una fila por pieza (columnas fijas) en vez de objetos con nombres de campo repetidos.
 * Menos tokens en cada vuelta del loop (el resultado queda en el historial).
 */
const COLUMNAS_3D = ["id", "item", "pieza", "cant", "largo_mm", "ancho_mm", "espesor_mm", "tipo", "m2_cara", "m2_total", "ml_perimetro", "m3", "material_base", "material_archivo"];
function compactarMedicion(r) {
    const avisos = {};
    const filas = r.piezas.map((p) => {
        const av = [].concat(p.avisos || [], p.partes_sueltas ? [`${p.partes_sueltas} partes sueltas`] : [], (p.acabados || []).map((a) => `acabado ${a.material_base || a.en_archivo || "?"} ${a.area_m2} m²`));
        if (av.length) avisos[p.id] = av;
        return [p.id, p.item, p.pieza, p.cant, p.largo_mm, p.ancho_mm, p.espesor_mm, p.tipo === "plancha" ? "pl" : "vol",
            p.area_cara_m2 != null ? p.area_cara_m2 : null, p.area_m2, p.perimetro_ml != null ? p.perimetro_ml : null,
            p.tipo === "plancha" ? null : (p.volumen_m3 != null ? p.volumen_m3 : null), p.material_base || null, p.material_en_archivo || null];
    });
    const out = { adjunto: r.adjunto, columnas: COLUMNAS_3D, piezas: filas,
        items: r.items.map((x) => Object.assign({ item: x.item }, x.indicadores_ruta_b)) };
    if (Object.keys(avisos).length) out.avisos = avisos;
    if (r.tamano_total_mm) out.tamano_total_mm = r.tamano_total_mm;
    if (r.escala) out.escala = r.escala.texto || r.escala.factor;
    if (r.sin_equivalencia && r.sin_equivalencia.length) out.sin_equivalencia = r.sin_equivalencia;
    if (r.aviso) out.aviso = r.aviso;
    if (r.aviso_escala) out.aviso_escala = r.aviso_escala;
    return out;
}

const HERRAMIENTAS = [
    {
        def: {
            name: "medicion_3d",
            description: "Consulta lo que la app midió de un modelo 3D adjunto (formato rubik/1): piezas con largo, ancho y espesor en mm, cantidad, tipo (plancha o volumen), área total y de una cara en m², perímetro en ml, volumen en m³, material del archivo o de la base, acabados, avisos, y por ítem los indicadores de la ruta B (m² de tablero, ml de canto, m² de superficie, piezas, m³). Es la ÚNICA fuente de medidas y cantidades del 3D. Devuelve una tabla compacta (columnas + una fila por pieza; pl = plancha, vol = volumen). Usá el id de pieza (p1, p2…) como origen: pieza3d:<adjunto>/<id>. Podés filtrar por ítem o por ids de pieza. Consultalo una vez y reusá lo que ya leíste.",
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
            return compactarMedicion(r);
        },
    },
    {
        def: {
            name: "buscar_base",
            description: "Busca en la base de Rubik: materiales (nombre, unidad, precio, espesor, plancha, receta de mano de obra), mano de obra (unidad y precio), oficios (costo del jornal), rendimientos (por jornal, por indicador) y equivalencias (texto del archivo o del PDF → material). Búsqueda por palabras sin acentos y, para materiales, por espesor en mm. Cada resultado trae su origen (base:<nodo>/<clave>) para usar en el borrador. Si algo no aparece, NO lo inventes: queda marcado o se pregunta.",
            input_schema: {
                type: "object",
                properties: {
                    texto: { type: "string", description: "Palabras a buscar (ej. \"mdf blanco\", \"vinil corte\", \"carpintero\"). Vacío: lista todo el nodo (hasta el límite)." },
                    nodo: { type: "string", enum: ["materiales", "mano_obra", "oficios", "rendimientos", "equivalencias_vw", "todos"], description: "Dónde buscar (por defecto: todos)." },
                    espesor_mm: { type: "number", description: "Opcional: solo materiales de este espesor (±0,5 mm)." },
                    claves: { type: "array", items: { type: "string" }, description: "Opcional: traer estas claves exactas." },
                    limite: { type: "integer", description: "Máximo de resultados (por defecto 12, máximo 60). Buscá varias cosas en una sola llamada si podés (texto con varias palabras clave no sirve: hacé llamadas en paralelo)." },
                },
            },
        },
        progreso: "Buscando en la base…",
        async correr(ctx, e) {
            const bd = await base(ctx);
            const nodos = !e.nodo || e.nodo === "todos" ? NODOS : [e.nodo];
            const palabras = normalizar(e.texto).split(" ").filter((w) => w.length > 1);
            const limite = Math.min(Math.max(parseInt(e.limite || 12, 10) || 12, 1), 60);
            const res = [];
            for (const n of nodos) {
                for (const k of Object.keys(bd[n] || {})) {
                    const m = bd[n][k];
                    if (!m || typeof m !== "object") continue;
                    if (e.claves && e.claves.length) { if (e.claves.includes(k)) res.push({ p: 99, x: entrada(n, k, m) }); continue; }
                    const hay = normalizar(`${k} ${m.n || ""} ${m.desc || ""} ${m.nombre || ""} ${m.vw || ""} ${m.trabajo || ""} ${m.oficio || ""}`);
                    const puntos = palabras.filter((w) => hay.includes(w)).length;
                    if (palabras.length && puntos < Math.ceil(palabras.length / 2)) continue;
                    if (e.espesor_mm != null && n === "materiales") { const es = espesorDe(m, k); if (!(es != null && Math.abs(es - e.espesor_mm) <= 0.5)) continue; }
                    res.push({ p: puntos, x: entrada(n, k, m) });
                }
            }
            res.sort((a, b) => b.p - a.p);
            const salida = res.slice(0, limite).map((r) => r.x);
            return { encontrados: res.length, resultados: salida,
                ...(salida.length ? {} : { aviso: "No hay nada parecido en la base. No lo inventes: dejalo marcado sin precio o preguntá; si el dueño lo confirma, guardalo con guardar_en_base." }) };
        },
    },
    {
        def: {
            name: "armar_borrador",
            description: `Crea o edita el BORRADOR del presupuesto (capítulos → ítems → APU con filas mat/mo/eq/sub). Aplica una lista de operaciones en orden; las válidas quedan y las inválidas vuelven rechazadas con su motivo. Devuelve el borrador resumido con los totales, que CALCULA ESTA HERRAMIENTA (pu del APU con recargos, total del ítem, del capítulo y general): nunca los calcules vos.
Operaciones (campo "op"):
- capitulo {nombre, id?}: crea o renombra.
- item_desde_3d {capitulo, adjunto, item3d | piezas[], desc?, caracteristicas?, materiales?: {"p1":"CLAVE_BASE"}, ruta?: "A"|"B", rendimiento?: clave, cant?, cant_origen?}: el algoritmo de Importar 3D arma el APU desde la medición: materiales por unidad (m², ml, planchas, barras…), mano de obra por receta del material (ruta A) o una fila de trato con el oficio (ruta B, referencia para negociar). Si lo repetís sobre el mismo ítem (id), rehace las filas automáticas y conserva las tuyas.
- item {capitulo, desc, und?, cant?, cant_origen?, caracteristicas?, nota?, id?}: ítem sin 3D (o para editar desc/cant/características de uno existente con id).
- desc: nombre corto y claro, lo que se entrega ("Trofeo Paceña"), máximo 80 caracteres; el detalle va en caracteristicas.
- caracteristicas (en item e item_desde_3d): 3 a 6 líneas cortas PARA EL CLIENTE (van al PDF): medidas generales (alto × ancho × fondo), materiales y acabados, composición si ayuda, qué incluye y qué no (traslado, instalación, diseño). [{texto, origen}]: toda línea con números lleva origen (pieza3d:, cota_plano:, dueño: o supuesto:). Sin precios ni datos internos (trato, stock, recargos): se rechazan. Una línea con supuesto sin confirmar no sale al presupuesto hasta que se confirme.
- fila {item, tipo: mat|mo|eq|sub, d, u?, origen_q, medida?, q?, geometria?, factor?, origen_factor?, clave?, p?, origen_p?, stock_q?, origen_stock?, cerrado?, oficio?, nota?, reemplaza?: n}:
  · origen_q "pieza3d:<adjunto>/<p1,p2>": la cantidad la calcula la herramienta con "medida" (m2_cara, m2_sup, ml_perimetro, ml_largo, und, m3, glb) × factor.
  · origen_q "supuesto:<explicación>" (sin planos ni 3D, tu propuesta constructiva): mandá "geometria" [{desc, cant, largo_m, ancho_m?}] y "medida" (ml_largo, m2_cara, ml_perimetro, und); la herramienta calcula la cantidad. Esas filas quedan "sin confirmar" y NO se aplican al presupuesto hasta que el dueño las confirme.
  · origen_q "dueño:<mensaje>" o "cota_plano:<adjunto> p.<n> \\"<cita>\\"": va q (o geometria si te dio medidas).
  · Con clave (de buscar_base) el precio sale SIEMPRE de la base; sin clave, p solo con origen_p dueño: o cota_plano:. Sin precio, la fila queda marcada.
  · Stock propio ("en el taller tengo 5 tubos"): stock_q + origen_stock dueño:<mensaje>; esa parte va a costo 0 y se compra el resto.
  · Trato cerrado por el dueño (tipo mo, cerrado: true, p = monto, origen_p dueño:<mensaje>, oficio o trabajadores): reemplaza la referencia calculada de la ruta B.
- confirmar_supuestos {item?, confirmacion: dueño:<mensaje>}: cuando el dueño acepta tu propuesta (sin item: todos).
- quitar {item} | {item, tipo, fila: n} | {capitulo}.
- recargos {cs, ind, util, origen}: cargas sociales, indirectos y utilidad en %; origen "base:presupuesto/recargos" (los del presupuesto) o "dueño:<mensaje>". Si no se cargan, se usan los del presupuesto.
"item" en fila/quitar: id del ítem o su descripción exacta.`,
            input_schema: {
                type: "object",
                properties: {
                    operaciones: { type: "array", items: { type: "object", properties: { op: { type: "string", enum: ["capitulo", "item", "item_desde_3d", "fila", "quitar", "recargos", "confirmar_supuestos"] } }, required: ["op"] } },
                },
                required: ["operaciones"],
            },
        },
        progreso: "Armando el borrador…",
        async correr(ctx, e) {
            const v = await contexto(ctx);
            const actual = await ctx.almacen.leer(`${RC(ctx)}/borrador`);
            const r = B.aplicarOperaciones(actual, e.operaciones.slice(0, 80), v, () => ctx.almacen.nuevaClave());
            const aplicadas = r.resultados.filter((x) => x.ok).length;
            if (aplicadas) {
                r.borrador.actualizado = ctx.almacen.ahora();
                await ctx.almacen.escribir(`${RC(ctx)}/borrador`, JSON.parse(JSON.stringify(r.borrador)));
                // título automático de la conversación: el primer ítem
                const rutaMeta = `${RAIZ(ctx)}/conversaciones_meta/${ctx.conv || R.PRINCIPAL}`;
                const meta = await ctx.almacen.leer(rutaMeta).catch(() => null);
                const primero = r.borrador.capitulos.reduce((a, c) => a || (c.items[0] && c.items[0].desc), null);
                if (meta && meta.titulo_auto && primero) await ctx.almacen.actualizar(rutaMeta, { titulo: primero.slice(0, 60), titulo_auto: false });
            }
            return {
                aplicadas, rechazadas: r.resultados.filter((x) => !x.ok).map((x) => ({ n: x.n, op: x.op, motivo: x.error })),
                borrador: B.resumen(r.borrador, r.resultados.filter((x) => x.ok).map((x) => x.item || x.id).filter(Boolean)),
            };
        },
    },
    {
        def: {
            name: "escala_3d",
            description: "Calibra la escala de un 3D adjunto cuando el modelo no está a escala real: con una medida total del modelo (alto, ancho o fondo) o la de una pieza, que sale de una cota del plano o la dijo el dueño. Escala parejo todas las piezas (largos ×f, áreas ×f², volúmenes ×f³). Nunca con una medida supuesta.",
            input_schema: {
                type: "object",
                properties: {
                    adjunto: { type: "string" },
                    medida_mm: { type: "number", description: "La medida real en mm." },
                    eje: { type: "string", enum: ["alto", "ancho", "fondo"], description: "Medida total del modelo entero (o usá pieza + dimension)." },
                    pieza: { type: "string", description: "Id de pieza (p1…)." },
                    dimension: { type: "string", enum: ["largo", "ancho", "espesor"] },
                    origen: { type: "string", description: "cota_plano:<adjunto> p.<n> \"<cita>\" o dueño:<mensaje>." },
                },
                required: ["adjunto", "medida_mm", "origen"],
            },
        },
        progreso: "Calibrando la escala del 3D…",
        async correr(ctx, e) {
            const v = await contexto(ctx);
            const o = B.validarOrigen(e.origen, v);
            if (!o.ok) throw new Error("origen: " + o.error);
            if (o.origen.tipo !== "cota_plano" && o.origen.tipo !== "dueño") throw new Error("la escala solo se calibra con una cota del plano o un dato del dueño");
            const meta = await ctx.almacen.leer(`${RAIZ(ctx)}/adjuntos/${e.adjunto}`);
            if (!meta || meta.tipo !== "3d") throw new Error("no es un 3D medido");
            const crudo = ctx._mediciones && ctx._mediciones[e.adjunto] ? ctx._mediciones[e.adjunto] : (await cargarMedicion(ctx, e.adjunto)) && ctx._mediciones[e.adjunto];
            let medido;
            if (e.pieza) {
                const i = /^p(\d+)$/.exec(e.pieza); const p = i && crudo.piezas[parseInt(i[1], 10) - 1];
                if (!p || !e.dimension) throw new Error("pieza o dimensión inválida");
                medido = p[e.dimension];
            } else if (e.eje && meta.tamano_m) {
                medido = meta.tamano_m[{ ancho: 0, alto: 1, fondo: 2 }[e.eje]];
            } else throw new Error("indicá eje (si el 3D trae su tamaño total) o pieza + dimension");
            if (!(medido > 0) || !(e.medida_mm > 0)) throw new Error("medida inválida");
            const factor = (e.medida_mm / 1000) / medido;
            const escala = { factor: Math.round(factor * 1e6) / 1e6, origen: o.origen.texto, texto: `${e.pieza ? e.pieza + " " + e.dimension : e.eje} = ${e.medida_mm} mm`, fecha: ctx.almacen.ahora() };
            await ctx.almacen.actualizar(`${RAIZ(ctx)}/adjuntos/${e.adjunto}`, { escala });
            ctx._mediciones = {};   // se vuelve a leer escalada
            return { ok: true, factor: escala.factor, nota: `Todas las piezas quedaron × ${escala.factor.toFixed(4)}. Volvé a consultar medicion_3d y rehacé los ítems del 3D (item_desde_3d) para que tomen la escala.` };
        },
    },
    {
        def: {
            name: "guardar_en_base",
            description: "Guarda en la base algo NUEVO o una corrección que el dueño CONFIRMÓ explícitamente en este chat: un material (con o sin precio), una mano de obra, un oficio con su costo por jornal, un rendimiento o la receta de mano de obra de un material. Deja historial del cambio. Sin la confirmación del dueño (su id de mensaje) no se guarda nada.",
            input_schema: {
                type: "object",
                properties: {
                    nodo: { type: "string", enum: ["materiales", "mano_obra", "oficios", "rendimientos", "receta"] },
                    clave: { type: "string", description: "Clave (MAYÚSCULAS_CON_GUIONES). Para receta: la clave del material." },
                    datos: { type: "object", description: "materiales/mano_obra: {n, u, p?, espesor_mm?, plancha_largo?, plancha_ancho?, barra_largo?} · oficios: {nombre, costo_jornal?} · rendimientos: {oficio, indicador, por_jornal, trabajo?} · receta: {pasos: [{mo, medida, factor?}]} o {ninguna: true}" },
                    confirmacion: { type: "string", description: "dueño:<id del mensaje donde el dueño lo confirma>." },
                },
                required: ["nodo", "clave", "datos", "confirmacion"],
            },
        },
        progreso: "Guardando en la base…",
        async correr(ctx, e) {
            const v = await contexto(ctx);
            const o = N.parsearOrigen(e.confirmacion);
            if (!o || o.tipo !== "dueño" || !v.mensajesDueno[o.ref.split(/\s/)[0]]) throw new Error("hace falta la confirmación del dueño: dueño:<id de su mensaje>");
            const clave = String(e.clave).toUpperCase().trim().replace(/[.#$[\]/\s]+/g, "_").slice(0, 80);
            if (!clave) throw new Error("clave inválida");
            const d = e.datos || {};
            const numOk = (x) => x == null || (isFinite(parseFloat(x)) && parseFloat(x) >= 0);
            let ruta, cambios = {};
            const pick = (ks) => ks.forEach((k) => { if (d[k] !== undefined && d[k] !== null && d[k] !== "") cambios[k] = typeof d[k] === "string" ? d[k].slice(0, 200) : d[k]; });
            if (e.nodo === "materiales" || e.nodo === "mano_obra") {
                ruta = `base_datos/${e.nodo}/${clave}`;
                pick(["n", "u", "p", "espesor_mm", "plancha_largo", "plancha_ancho", "barra_largo"]);
                if (!cambios.n && !(await ctx.almacen.leer(ruta))) throw new Error("falta el nombre (n)");
                ["p", "espesor_mm", "plancha_largo", "plancha_ancho", "barra_largo"].forEach((k) => { if (!numOk(cambios[k])) throw new Error(k + " inválido"); if (cambios[k] != null) cambios[k] = parseFloat(cambios[k]); });
                if (cambios.p == null && !(await ctx.almacen.leer(ruta))) { cambios.p = 0; cambios.falta_precio = true; }
                if (cambios.p > 0) cambios.falta_precio = null;
                cambios.origen = "agente";
            } else if (e.nodo === "oficios") {
                ruta = `base_datos/oficios/${clave}`; pick(["nombre", "costo_jornal"]);
                if (!numOk(cambios.costo_jornal)) throw new Error("costo_jornal inválido");
            } else if (e.nodo === "rendimientos") {
                ruta = `base_datos/rendimientos/${clave}`; pick(["oficio", "indicador", "por_jornal", "trabajo", "notas", "tramos"]);
                if (cambios.indicador && !["m2_tablero", "ml_canto", "m2_superficie", "piezas", "m3", "letras_por_alto"].includes(cambios.indicador)) throw new Error("indicador inválido");
                if (!numOk(cambios.por_jornal)) throw new Error("por_jornal inválido");
            } else if (e.nodo === "receta") {
                ruta = `base_datos/materiales/${clave}`;
                if (!v.base.materiales[clave]) throw new Error("no existe el material " + clave);
                if (d.ninguna) cambios = { mo_receta: null, mo_receta_ninguna: true };
                else {
                    const pasos = (Array.isArray(d.pasos) ? d.pasos : []).map((x) => ({ mo: String(x.mo || ""), medida: String(x.medida || ""), factor: parseFloat(x.factor) > 0 ? parseFloat(x.factor) : 1 }));
                    if (!pasos.length || pasos.some((x) => !v.base.mano_obra[x.mo] || !B.MEDIDAS.includes(x.medida))) throw new Error("cada paso necesita una mano de obra que exista (mo) y una medida válida");
                    cambios = { mo_receta: pasos, mo_receta_ninguna: null };
                }
            }
            if (!Object.keys(cambios).length) throw new Error("no hay datos para guardar");
            const antes = await ctx.almacen.leer(ruta);
            cambios.fecha_mod = ctx.almacen.ahora();
            await ctx.almacen.actualizar(ruta, cambios);
            const resumen = {};
            Object.keys(cambios).forEach((k) => { resumen[k] = { antes: antes && antes[k] !== undefined ? antes[k] : null, despues: cambios[k] === undefined ? null : cambios[k] }; });
            await ctx.almacen.agregar("base_datos/historial_cambios", { ruta, que: `agente: ${e.nodo}`, cambios: JSON.parse(JSON.stringify(resumen)), fecha: ctx.almacen.ahora(), por: ctx.uid || null, confirmacion: o.texto, proyecto: `${ctx.cid}/${ctx.pid}` });
            ctx._base = null;
            return { ok: true, guardado: ruta, origen: `base:${e.nodo === "receta" ? "materiales" : e.nodo}/${clave}` };
        },
    },
    {
        def: {
            name: "memoria",
            description: "Memoria simple del agente, compartida entre proyectos (/agente_memoria). tipo \"nota\": correcciones y decisiones del dueño (cómo cobra algo, qué no le gusta). tipo \"norma\": cómo construye este taller, cuando el dueño corrige o confirma un criterio constructivo (\"nuestros bastidores llevan tubo 20×40 con travesaño cada 1 m\"); usá las normas en las próximas propuestas. Una idea corta por entrada, sin datos confidenciales del cliente. También podés leer o borrar.",
            input_schema: {
                type: "object",
                properties: {
                    accion: { type: "string", enum: ["anotar", "leer", "borrar"] },
                    tipo: { type: "string", enum: ["nota", "norma"], description: "Por defecto nota." },
                    texto: { type: "string", description: "La nota (para anotar), máximo 400 caracteres." },
                    id: { type: "string", description: "Id de la nota (para borrar)." },
                },
                required: ["accion"],
            },
        },
        progreso: (e) => (e.accion === "anotar" ? "Anotando en la memoria…" : "Leyendo la memoria…"),
        async correr(ctx, e) {
            if (e.accion === "anotar") {
                const t = String(e.texto || "").trim();
                if (!t) throw new Error("falta el texto de la nota");
                const id = await ctx.almacen.agregar(`agente_memoria/${e.tipo === "norma" ? "normas" : "notas"}`, { texto: t.slice(0, 400), fecha: ctx.almacen.ahora(), proyecto: `${ctx.cid}/${ctx.pid}`, uid: ctx.uid || null });
                return { ok: true, id };
            }
            if (e.accion === "borrar") {
                if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(e.id || ""))) throw new Error("id inválido");
                const nodo = e.tipo === "norma" ? "normas" : "notas";
                if (!(await ctx.almacen.leer(`agente_memoria/${nodo}/${e.id}`))) throw new Error("no existe esa entrada en " + nodo);
                await ctx.almacen.borrar(`agente_memoria/${nodo}/${e.id}`);
                return { ok: true };
            }
            const notas = (await ctx.almacen.leer("agente_memoria/notas")) || {};
            const normas = (await ctx.almacen.leer("agente_memoria/normas")) || {};
            return { notas: Object.keys(notas).slice(-100).map((k) => ({ id: k, texto: notas[k].texto })),
                normas: Object.keys(normas).slice(-100).map((k) => ({ id: k, texto: normas[k].texto })) };
        },
    },
    {
        def: {
            name: "preguntar_al_dueno",
            description: "UNA SOLA RONDA de preguntas por cotización: después de leer todo, medir y buscar en la base, mandá juntas (numeradas, hasta 10) TODAS las preguntas que cambian el costo; lo obvio va como supuesto declarado, no como pregunta. TERMINA el turno hasta que el dueño responda. Una segunda ronda solo si el dueño cambió algo (con \"motivo\"). Nada de opciones múltiples genéricas.",
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
                    motivo: { type: "string", description: "Solo para una ronda más después de la primera: qué cambió el dueño que obliga a preguntar de nuevo." },
                },
                required: ["preguntas"],
            },
        },
        progreso: "Preparando preguntas…",
        async correr(ctx, e) {
            const rondas = Number(await ctx.almacen.leer(`${RC(ctx)}/rondas_preguntas`)) || 0;
            if (rondas >= 1 && !String(e.motivo || "").trim()) {
                throw new Error("Ya hiciste la ronda de preguntas de esta cotización. Avanzá con supuestos declarados; preguntá de nuevo solo si el dueño cambió algo, explicándolo en \"motivo\".");
            }
            const preguntas = e.preguntas.filter((p) => p && String(p.pregunta || "").trim()).slice(0, 10)
                .map((p) => ({ pregunta: String(p.pregunta).trim().slice(0, 500), para_que: p.para_que ? String(p.para_que).slice(0, 200) : null }));
            if (!preguntas.length) throw new Error("No llegó ninguna pregunta.");
            ctx.cortarTurno = true;
            await ctx.almacen.escribir(`${RC(ctx)}/rondas_preguntas`, rondas + 1);
            ctx.mensajesAgente.push({ rol: "agente", texto: (e.avance ? String(e.avance).trim() + "\n\n" : "") + (rondas ? "Por el cambio, necesito que me confirmes:" : "Antes de armar el borrador, respondeme todo junto (podés contestar por número):"), preguntas });
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

module.exports = { definiciones, ejecutar, validar, HERRAMIENTAS, cargarMedicion, contexto };
