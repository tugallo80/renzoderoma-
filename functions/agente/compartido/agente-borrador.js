/**
 * agente-borrador.js — Borrador del presupuesto que arma el Agente IA (lógica pura, navegador y Function).
 *
 * REGLA: ninguna fila sin origen. Cada número lleva de dónde sale y se valida contra lo que existe:
 *   pieza3d:<adjunto>/<p1,p2…>   la cantidad la CALCULA esta herramienta desde la medición (no la escribe el modelo)
 *   base:<nodo>/<clave>          el precio sale de la base (si la fila tiene clave, siempre se toma de ahí)
 *   cota_plano:<adjunto> p.<n> "<cita>"   una cota escrita en un PDF o una foto adjunta (con la cita)
 *   dueño:<id de mensaje>        algo que dijo el dueño en este chat
 *   supuesto:<explicación>       propuesta constructiva del agente (sin planos): la cantidad sale de la "geometria" que propone,
 *                                calculada acá; se ve aparte y NO se aplica al presupuesto hasta que el dueño la confirma
 * Los totales (pu del APU, total del ítem, del capítulo y general) los calcula esta herramienta con la misma
 * lógica que "Importar 3D" (Lector3D.calcPu, armarApu con recetas, rutas A/B y recargos).
 */
(function (global) {
    'use strict';
    var L = global.Lector3D || (typeof require === 'function' ? require('./lector-3d.js') : null);
    var N = global.AgenteNucleo || (typeof require === 'function' ? require('./agente-nucleo.js') : null);

    var TIPOS_FILA = ['mat', 'mo', 'eq', 'sub'];
    var NODOS_BASE = ['materiales', 'mano_obra', 'oficios', 'rendimientos', 'equivalencias_vw', 'presupuesto'];
    var MEDIDAS = ['m2_cara', 'm2_sup', 'ml_perimetro', 'ml_largo', 'und', 'm3', 'glb'];
    var MEDIDAS_GEO = ['ml_largo', 'm2_cara', 'und', 'ml_perimetro'];

    /**
     * Cantidad desde una geometría propuesta (sin 3D): [{desc, cant, largo_m, ancho_m?}].
     * ml_largo = Σ cant × largo · m2_cara = Σ cant × largo × ancho · ml_perimetro = Σ cant × 2(largo + ancho) · und = Σ cant.
     */
    function cantidadGeometria(geo, medida) {
        if (!Array.isArray(geo) || !geo.length || geo.length > 60) return { error: 'geometria: lista de piezas [{desc, cant, largo_m, ancho_m?}] (1 a 60)' };
        if (MEDIDAS_GEO.indexOf(medida) < 0) return { error: 'con geometria, "medida" es ' + MEDIDAS_GEO.join(', ') };
        var q = 0, partes = [];
        for (var i = 0; i < geo.length; i++) {
            var g = geo[i] || {}, c = num(g.cant == null ? 1 : g.cant), l = num(g.largo_m), a = num(g.ancho_m);
            if (!(c > 0)) return { error: 'geometria[' + i + ']: cant inválida' };
            if (medida !== 'und' && !(l > 0)) return { error: 'geometria[' + i + ']: falta largo_m' };
            if ((medida === 'm2_cara' || medida === 'ml_perimetro') && !(a > 0)) return { error: 'geometria[' + i + ']: falta ancho_m' };
            var v = medida === 'und' ? c : medida === 'ml_largo' ? c * l : medida === 'm2_cara' ? c * l * a : c * 2 * (l + a);
            q += v;
            partes.push((txt(g.desc, 60) || 'pieza') + ' ' + c + (medida === 'und' ? '' : ' × ' + l + (medida === 'm2_cara' ? ' × ' + a : medida === 'ml_perimetro' ? ' (perímetro con ' + a + ')' : '')));
        }
        return { q: r4(q), nota: 'calculado (' + medida + '): ' + partes.join(' + ') + ' = ' + r4(q) };
    }

    function num(x) { var n = parseFloat(x); return isFinite(n) ? n : NaN; }
    function r2(x) { return Math.round(x * 100) / 100; }
    function r4(x) { return Math.round(x * 10000) / 10000; }
    function txt(x, max) { return String(x == null ? '' : x).trim().slice(0, max || 300); }
    function clon(x) { return JSON.parse(JSON.stringify(x)); }

    function vacio() { return { capitulos: [], recargos: null, version: 0 }; }

    // ------------------------------------------------------------------ validación de origen
    /**
     * ctx: { adjuntos: {id: meta}, mediciones: {id: rubik/1 ya escalado}, base: {materiales, mano_obra, oficios, rendimientos, equivalencias_vw},
     *        mensajesDueno: {id: true}, recargosPresupuesto }
     * Devuelve { ok, origen, error, piezas? }.
     */
    function validarOrigen(texto, ctx, para) {
        var o = N.parsearOrigen(texto);
        if (!o) return { ok: false, error: 'falta el origen o no es válido ("' + txt(texto, 60) + '"): usá pieza3d:, base:, cota_plano: o dueño:' };
        if (o.tipo === 'calculo') return { ok: false, error: 'el origen "calculo:" no se acepta: la cuenta la hace la herramienta (usá pieza3d: con "medida")' };
        if (o.tipo === 'pieza3d') {
            var m = /^([A-Za-z0-9_-]+)\/(.+)$/.exec(o.ref);
            if (!m) return { ok: false, error: 'pieza3d: va como pieza3d:<adjunto>/<p1,p2…>' };
            var med = ctx.mediciones && ctx.mediciones[m[1]];
            if (!med) return { ok: false, error: 'el adjunto ' + m[1] + ' no es un 3D medido de este proyecto' };
            var ids = m[2].split(/[,\s]+/).filter(Boolean), piezas = [];
            for (var i = 0; i < ids.length; i++) {
                var idx = /^p(\d+)$/.exec(ids[i]);
                var p = idx ? med.piezas[parseInt(idx[1], 10) - 1] : null;
                if (!p) return { ok: false, error: 'no existe la pieza ' + ids[i] + ' en el 3D ' + m[1] };
                piezas.push(p);
            }
            return { ok: true, origen: o, piezas: piezas, adjunto: m[1], ids: ids };
        }
        if (o.tipo === 'base') {
            var b = /^([a-z_]+)\/(.+)$/.exec(o.ref);
            if (!b || NODOS_BASE.indexOf(b[1]) < 0) return { ok: false, error: 'base: va como base:<materiales|mano_obra|oficios|rendimientos>/<clave>' };
            if (b[1] === 'presupuesto') return ctx.recargosPresupuesto ? { ok: true, origen: o } : { ok: false, error: 'el presupuesto no tiene recargos cargados' };
            if (!(ctx.base && ctx.base[b[1]] && ctx.base[b[1]][b[2]])) return { ok: false, error: 'no existe ' + b[1] + '/' + b[2] + ' en la base' };
            return { ok: true, origen: o, nodo: b[1], clave: b[2], dato: ctx.base[b[1]][b[2]] };
        }
        if (o.tipo === 'cota_plano') {
            var c = /^([A-Za-z0-9_-]+)\s*(?:p\.?\s*(\d+))?\s*["“«](.+)["”»]\s*$/.exec(o.ref);
            if (!c) return { ok: false, error: 'cota_plano: va como cota_plano:<adjunto> p.<página> "<texto citado tal cual>"' };
            var a = ctx.adjuntos && ctx.adjuntos[c[1]];
            if (!a || (a.tipo !== 'pdf' && a.tipo !== 'imagen')) return { ok: false, error: 'el adjunto ' + c[1] + ' no es un PDF ni una foto de este proyecto' };
            if (a.tipo === 'pdf' && !c[2]) return { ok: false, error: 'en un PDF la cota va con la página (p.<n>)' };
            if (!/\d/.test(c[3])) return { ok: false, error: 'la cita de la cota tiene que tener el número tal como está escrito' };
            return { ok: true, origen: o };
        }
        if (o.tipo === 'supuesto') {
            if (o.ref.length < 8) return { ok: false, error: 'supuesto: explicá la propuesta constructiva (ej. "marco perimetral de tubo 20×40")' };
            return { ok: true, origen: o };
        }
        if (o.tipo === 'dueño') {
            var id = o.ref.split(/\s/)[0];
            if (!(ctx.mensajesDueno && ctx.mensajesDueno[id])) {
                if (ctx.adjuntos && ctx.adjuntos[id] && ctx.adjuntos[id].anotaciones) return { ok: true, origen: o };   // cota dibujada por el dueño en una foto
                return { ok: false, error: 'no hay un mensaje del dueño con id ' + id };
            }
            return { ok: true, origen: o };
        }
        return { ok: false, error: 'origen desconocido' };
    }

    // ------------------------------------------------------------------ búsqueda en el borrador
    function buscarCapitulo(b, ref) {
        var r = txt(ref, 200).toLowerCase();
        return b.capitulos.find(function (c) { return c.id === ref || c.nombre.toLowerCase() === r; }) || null;
    }
    function buscarItem(b, ref) {
        var r = txt(ref, 200).toLowerCase();
        for (var i = 0; i < b.capitulos.length; i++) {
            var it = b.capitulos[i].items.find(function (x) { return x.id === ref || x.desc.toLowerCase() === r; });
            if (it) return { item: it, capitulo: b.capitulos[i] };
        }
        return null;
    }

    // ------------------------------------------------------------------ filas
    function precioBase(clave, tipo, ctx) {
        var nodo = tipo === 'mo' ? 'mano_obra' : 'materiales';
        var cat = ctx.base && ctx.base[nodo] && ctx.base[nodo][clave];
        if (!cat) return null;
        var p = num(cat.p != null ? cat.p : cat.pu);
        return { cat: cat, nodo: nodo, p: p > 0 ? r2(p) : 0, u: cat.u || cat.und || 'und', d: cat.n || cat.desc || clave };
    }

    /** Arma una fila validada. Devuelve { fila } o { error }. */
    function armarFila(op, tipo, ctx) {
        if (op.cerrado && op.q == null) op = Object.assign({}, op, { q: 1 });   // un trato cerrado es un global
        var f = { d: txt(op.d, 200), u: txt(op.u, 20) || 'und', q: 0, p: 0 };
        var motivos = [];
        // --- cantidad
        var vq = validarOrigen(op.origen_q, ctx, 'q');
        if (!vq.ok) return { error: 'cantidad: ' + vq.error };
        if (vq.origen.tipo === 'pieza3d') {
            var medida = MEDIDAS.indexOf(op.medida) >= 0 ? op.medida : null;
            if (!medida) return { error: 'con pieza3d: hace falta "medida" (' + MEDIDAS.join(', ') + '): la cantidad la calcula la herramienta' };
            var q = medida === 'glb' ? 1 : vq.piezas.reduce(function (s, p) { return s + L.cantidadMedida(medida, p); }, 0);
            var factor = 1;
            if (op.factor != null && num(op.factor) !== 1) {
                var vf = validarOrigen(op.origen_factor, ctx, 'factor');
                if (!vf.ok || vf.origen.tipo === 'pieza3d') return { error: 'factor ' + op.factor + ': necesita origen_factor (dueño:, cota_plano: o base:) — ' + (vf.error || 'pieza3d no vale para un factor') };
                factor = num(op.factor);
                if (!(factor > 0)) return { error: 'factor inválido' };
                f.factor = factor; f.origen_factor = vf.origen.texto;
            }
            f.q = r4(q * factor);
            f.medida = medida;
            f.nota = 'calculado: ' + medida + ' de ' + vq.ids.join(', ') + (factor !== 1 ? ' × ' + factor : '');
            if (op.q != null && Math.abs(num(op.q) - f.q) > 0.0005 * Math.max(1, f.q)) f.nota += ' (el agente había puesto ' + op.q + '; vale el cálculo)';
        } else if (vq.origen.tipo === 'base') {
            return { error: 'cantidad: base: es para precios, no para cantidades' };
        } else if (op.geometria) {
            var cg = cantidadGeometria(op.geometria, op.medida);
            if (cg.error) return { error: cg.error };
            f.q = cg.q; f.geometria = clon(op.geometria); f.medida = op.medida; f.nota = cg.nota;
            if (op.q != null && Math.abs(num(op.q) - f.q) > 0.0005 * Math.max(1, f.q)) f.nota += ' (el agente había puesto ' + op.q + '; vale el cálculo)';
        } else if (vq.origen.tipo === 'supuesto') {
            return { error: 'cantidad con supuesto: hace falta "geometria" (las piezas que proponés con sus medidas) y "medida": la cuenta la hace la herramienta' };
        } else {
            var qv = num(op.q);
            if (!(qv >= 0)) return { error: 'cantidad: falta q (número) para el origen ' + vq.origen.tipo };
            f.q = r4(qv);
        }
        f.origen_q = vq.origen.texto;
        if (vq.origen.tipo === 'supuesto') { f.supuesto = true; f.confirmado = false; }
        // --- stock propio: la parte en stock va a costo 0, se compra el resto
        if (op.stock_q != null && num(op.stock_q) > 0) {
            var vs = validarOrigen(op.origen_stock, ctx, 'stock');
            if (!vs.ok || vs.origen.tipo !== 'dueño') return { error: 'stock propio: necesita origen_stock dueño:<mensaje> (lo que dijo el dueño que tiene en el taller)' };
            var sq = num(op.stock_q);
            f.q_total = f.q; f.stock_q = r4(Math.min(sq, f.q)); f.origen_stock = vs.origen.texto;
            f.q = r4(Math.max(0, f.q - sq));
            f.nota = (f.nota ? f.nota + ' · ' : '') + f.stock_q + ' de stock propio (sin costo) + ' + f.q + ' a comprar';
            if (sq > f.q_total) f.nota += ' (sobra stock: ' + r4(sq - f.q_total) + ')';
        }
        // --- trato cerrado por el dueño (ruta B): monto fijo que reemplaza la referencia calculada
        if (op.cerrado) {
            if (tipo !== 'mo') return { error: 'cerrado: solo para mano de obra' };
            var vc = validarOrigen(op.origen_p, ctx, 'p');
            if (!vc.ok || vc.origen.tipo !== 'dueño' || !(num(op.p) > 0)) return { error: 'trato cerrado: p (monto) con origen_p dueño:<mensaje>' };
            var quien = txt(op.oficio || op.trabajadores, 80);
            return { fila: { d: f.d || ('Trato cerrado' + (quien ? ' con ' + quien : '')), u: 'glb', q: 1, p: r2(num(op.p)), origen_q: f.origen_q, origen_p: vc.origen.texto,
                trato: true, cerrado: true, oficio: quien || null, nota: 'monto cerrado por el dueño' + (quien ? ' (' + quien + ')' : '') } };
        }
        // --- precio
        if (op.clave) {
            var pb = precioBase(op.clave, tipo, ctx);
            if (!pb) return { error: 'la clave ' + op.clave + ' no está en la base (' + (tipo === 'mo' ? 'mano_obra' : 'materiales') + '): buscala con buscar_base o pedí guardarla' };
            f.clave = op.clave; f.d = f.d || pb.d; f.u = txt(op.u, 20) || pb.u;
            if (pb.p > 0) { f.p = pb.p; f.origen_p = 'base:' + pb.nodo + '/' + op.clave; }
            else motivos.push('sin precio en la base');
            if (op.p != null && num(op.p) !== f.p && pb.p > 0) f.nota = (f.nota ? f.nota + ' · ' : '') + 'precio de la base (el agente había puesto ' + op.p + ')';
        } else if (op.p != null && num(op.p) > 0) {
            var vp = validarOrigen(op.origen_p, ctx, 'p');
            if (!vp.ok) return { error: 'precio: ' + vp.error };
            if (vp.origen.tipo === 'pieza3d' || vp.origen.tipo === 'supuesto') return { error: 'precio: los precios salen de la base, del dueño o de una cota (no de ' + vp.origen.tipo + ':)' };
            if (vp.origen.tipo === 'base') {
                var pb2 = precioBase(vp.clave, tipo, ctx);
                if (!pb2 || !(pb2.p > 0)) return { error: 'precio: ' + vp.origen.texto + ' no tiene precio en la base' };
                f.p = pb2.p; f.clave = vp.clave;
            } else f.p = r2(num(op.p));
            f.origen_p = vp.origen.texto;
        } else motivos.push('falta precio');
        if (!f.d) return { error: 'falta la descripción (d)' };
        if (f.u === 'jornal' && f.medida && f.medida !== 'und') motivos.push('falta el rendimiento para pasar ' + f.medida + ' a jornales');
        if (op.nota) f.nota = (f.nota ? f.nota + ' · ' : '') + txt(op.nota, 200);
        if (motivos.length) f.revisar = motivos.join(' · ');
        return { fila: f };
    }

    // ------------------------------------------------------------------ ítem desde el 3D (el algoritmo de Importar 3D)
    function convertirFila3D(r, tipo, adjunto, ids, nodoP) {
        var f = { d: r.d, u: r.u, q: r.q || 0, p: r.p || 0, origen_q: 'pieza3d:' + adjunto + '/' + ids.join(','), auto: true };
        if (r.clave) f.clave = r.clave;
        if (r.trato) {
            f.trato = true; f.referencia = true; f.origen_q = 'base:rendimientos (trato)';
            if (r.p > 0) f.origen_p = 'base:rendimientos+oficios (referencia: ' + (r.jornales || '?') + ' jornales del 3D)';
        } else if (f.p > 0 && r.clave) f.origen_p = 'base:' + nodoP + '/' + r.clave;
        if (r.nota) f.nota = r.nota;
        if (r.revisar) f.revisar = r.revisar;
        if (r.measures) f.measures = r.measures;
        if (r.measures_modo) f.measures_modo = r.measures_modo;
        return f;
    }

    function itemDesde3D(op, ctx) {
        var med = ctx.mediciones && ctx.mediciones[op.adjunto];
        if (!med) return { error: 'el adjunto ' + op.adjunto + ' no es un 3D medido de este proyecto' };
        var ids = [];
        med.piezas.forEach(function (p, i) {
            var id = 'p' + (i + 1);
            if ((op.piezas && op.piezas.length) ? op.piezas.indexOf(id) >= 0 : p.item === op.item3d) ids.push(id);
        });
        if (!ids.length) return { error: 'ninguna pieza del 3D coincide (item3d "' + txt(op.item3d, 80) + '" / piezas ' + (op.piezas || []).join(',') + ')' };
        var mats = op.materiales || {};
        var errores = [];
        var piezas = ids.map(function (id) {
            var p = clon(med.piezas[parseInt(id.slice(1), 10) - 1]);
            if (mats[id]) {
                if (!(ctx.base.materiales && ctx.base.materiales[mats[id]])) errores.push('material ' + mats[id] + ' (pieza ' + id + ') no está en la base');
                else { p.material = mats[id]; p.material_desde = 'agente'; }
            }
            p.item = '__item';
            return p;
        });
        if (errores.length) return { error: errores.join(' · ') };
        var ruta = op.ruta === 'B' ? 'B' : 'A';
        var rend = null, oficio = null;
        if (ruta === 'B' && op.rendimiento) {
            rend = ctx.base.rendimientos && ctx.base.rendimientos[op.rendimiento];
            if (!rend) return { error: 'el rendimiento ' + op.rendimiento + ' no está en la base' };
            oficio = ctx.base.oficios && ctx.base.oficios[rend.oficio];
        }
        var apu = L.armarApu(piezas, ctx.base.materiales || {}, { catalogoMO: ctx.base.mano_obra || {}, ruta: ruta, rendimiento: rend, oficio: oficio });
        return {
            ids: ids, ruta: ruta,
            apu: {
                mat: apu.mat.map(function (r) { return convertirFila3D(r, 'mat', op.adjunto, ids, 'materiales'); }),
                mo: apu.mo.map(function (r) { return convertirFila3D(r, 'mo', op.adjunto, ids, 'mano_obra'); }),
                eq: [], sub: []
            },
            measures: piezas.map(L.medidaDePieza),
            measures_modo: piezas.every(function (p) { return p.tipo === 'plancha'; }) ? 'plancha' : 'volumen'
        };
    }

    // ------------------------------------------------------------------ operaciones
    /**
     * Aplica operaciones al borrador. Las válidas se aplican; las inválidas se rechazan con su motivo.
     * nuevoId(): id estable (push id en la Function).
     */
    /** Borrador tal como vuelve de RTDB (listas como objetos, listas vacías ausentes) → arreglos. */
    function normalizar(borrador) {
        var lista = function (v) { return Array.isArray(v) ? v.filter(function (x) { return x != null; }) : v ? Object.keys(v).sort(function (a, b) { return a - b; }).map(function (k) { return v[k]; }) : []; };
        var b = borrador ? clon(borrador) : vacio();
        b.capitulos = lista(b.capitulos);
        b.capitulos.forEach(function (c) { c.items = lista(c.items); c.items.forEach(function (it) { it.apu = it.apu || {}; TIPOS_FILA.forEach(function (t) { it.apu[t] = lista(it.apu[t]); }); }); });
        return b;
    }

    /** Botón "Confirmar supuestos" del chat: confirma los de un ítem (o todos) y recalcula. */
    function confirmarSupuestos(borrador, itemId, confirmacion) {
        var b = normalizar(borrador), n = 0;
        b.capitulos.forEach(function (c) { c.items.forEach(function (it) { if (!itemId || it.id === itemId) n += confirmarItem(it, confirmacion); }); });
        calcularTotales(b, null);
        return { borrador: b, confirmadas: n };
    }

    function aplicarOperaciones(borrador, ops, ctx, nuevoId) {
        var b = normalizar(borrador);
        var resultados = [];
        (ops || []).forEach(function (op, i) {
            var r = { n: i + 1, op: op && op.op };
            try { aplicarUna(b, op || {}, ctx, nuevoId, r); }
            catch (e) { r.ok = false; r.error = e.message; }
            resultados.push(r);
        });
        b.version = (b.version || 0) + 1;
        calcularTotales(b, ctx);
        return { borrador: b, resultados: resultados };
    }

    /**
     * CARACTERÍSTICAS del ítem (campo "feat" del presupuesto: va al PDF del cliente y a licitaciones). 3 a 6 líneas cortas:
     * medidas generales, materiales y acabados, composición, qué incluye y qué no. Sin precios ni datos internos.
     * Cada línea con números necesita origen (validado); una línea con supuesto sin confirmar no sale al presupuesto.
     */
    var RE_INTERNO = /\bBs\b|\$|precio|costo|trato|stock|recargo|utilidad|jornal|cargas sociales|indirectos|margen/i;
    function fijarCaracteristicas(it, lineas, ctx) {
        if (!Array.isArray(lineas)) return 'caracteristicas: lista de líneas [{texto, origen?}]';
        if (lineas.length > 8) return 'caracteristicas: hasta 8 líneas (mejor 3 a 6)';
        var salida = [];
        for (var i = 0; i < lineas.length; i++) {
            var l = typeof lineas[i] === 'string' ? { texto: lineas[i] } : (lineas[i] || {});
            var t = txt(l.texto, 200).replace(/^[•\-*]\s*/, '');
            if (!t) continue;
            if (t.length > 160) return 'característica ' + (i + 1) + ': más de 160 caracteres (que sea corta)';
            if (RE_INTERNO.test(t)) return 'característica ' + (i + 1) + ': sin precios ni datos internos (trato, stock, recargos): "' + t.slice(0, 60) + '"';
            var c = { texto: t };
            if (l.origen || /\d/.test(t)) {
                var v = validarOrigen(l.origen, ctx, 'caracteristica');
                if (!v.ok) return 'característica ' + (i + 1) + ' ("' + t.slice(0, 40) + '"): ' + v.error;
                if (v.origen.tipo === 'base' && /^\d/.test(t)) return 'característica ' + (i + 1) + ': base: no da medidas';
                c.origen = v.origen.texto;
                if (v.origen.tipo === 'supuesto') { c.supuesto = true; c.confirmado = false; }
            }
            salida.push(c);
        }
        it.caracteristicas = salida;
        return null;
    }
    /** Texto limpio para el presupuesto (sin orígenes; sin los supuestos sin confirmar). */
    function textoCaracteristicas(it) {
        return (it.caracteristicas || []).filter(function (c) { return !c.supuesto || c.confirmado; }).map(function (c) { return '• ' + c.texto; }).join('\n');
    }

    var CONDICIONES = ['alternativa', 'por_confirmar'];
    var NOMBRE_CONDICION = { alternativa: 'ALTERNATIVA', por_confirmar: 'POR CONFIRMAR' };

    function itemNuevo(op, nuevoId) {
        return { id: nuevoId(), desc: txt(op.desc, 200), und: txt(op.und, 20) || 'glb', cant: 1, apu: { mat: [], mo: [], eq: [], sub: [] } };
    }

    function fijarCant(it, op, ctx) {
        if (op.cant == null) return null;
        var c = num(op.cant);
        if (!(c > 0)) return 'cant inválida';
        if (c !== 1) {
            var v = validarOrigen(op.cant_origen, ctx, 'cant');
            if (!v.ok) return 'cant ' + c + ': ' + v.error;
            if (v.origen.tipo === 'base') return 'cant: base: no da cantidades';
            it.cant_origen = v.origen.texto;
            if (v.origen.tipo === 'supuesto') it.cant_confirmada = false; else delete it.cant_confirmada;
        } else { delete it.cant_origen; delete it.cant_confirmada; }
        it.cant = c;
        return null;
    }

    function aplicarUna(b, op, ctx, nuevoId, r) {
        switch (op.op) {
            case 'capitulo': {
                var nombre = txt(op.nombre, 120);
                if (!nombre) throw new Error('falta el nombre del capítulo');
                var c = op.id ? buscarCapitulo(b, op.id) : buscarCapitulo(b, nombre);
                if (c) c.nombre = nombre; else { c = { id: nuevoId(), nombre: nombre, items: [] }; b.capitulos.push(c); }
                r.ok = true; r.id = c.id; return;
            }
            case 'item': case 'item_desde_3d': {
                var ex = op.id ? buscarItem(b, op.id) : null;
                if (op.id && !ex) throw new Error('no existe el ítem ' + op.id);
                var cap = op.capitulo ? buscarCapitulo(b, op.capitulo) : (ex ? ex.capitulo : null);
                if (!cap && op.capitulo) { cap = { id: nuevoId(), nombre: txt(op.capitulo, 120), items: [] }; b.capitulos.push(cap); }
                if (!cap) { cap = b.capitulos[b.capitulos.length - 1]; if (!cap) { cap = { id: nuevoId(), nombre: 'GENERAL', items: [] }; b.capitulos.push(cap); } }
                var it = ex ? ex.item : itemNuevo(op, nuevoId);
                if (op.op === 'item_desde_3d') {
                    var d3 = itemDesde3D(op, ctx);
                    if (d3.error) throw new Error(d3.error);
                    if (!op.desc && !ex) it.desc = txt(op.item3d || 'Ítem del 3D', 200);
                    it.desde3d = { adjunto: op.adjunto, item3d: op.item3d || null, piezas: d3.ids, ruta: d3.ruta, rendimiento: op.rendimiento || null, materiales: op.materiales || null };
                    it.measures = d3.measures; it.measures_modo = d3.measures_modo;
                    // las filas automáticas se rehacen; las agregadas a mano por el agente se conservan
                    var hayCerrado = (it.apu.mo || []).some(function (f) { return f.cerrado; });
                    TIPOS_FILA.forEach(function (t) {
                        var nuevas = (d3.apu[t] || []).filter(function (f) { return !(hayCerrado && t === 'mo' && f.trato); });
                        it.apu[t] = nuevas.concat((it.apu[t] || []).filter(function (f) { return !f.auto; }));
                    });
                }
                if (op.desc) it.desc = txt(op.desc, 200);
                if (!it.desc) throw new Error('falta la descripción del ítem');
                if (it.desc.length > 80) throw new Error('la descripción del ítem es larga (' + it.desc.length + ' caracteres): que sea un nombre claro ("Trofeo Paceña"); el detalle va en caracteristicas');
                if (op.caracteristicas) { var ec = fijarCaracteristicas(it, op.caracteristicas, ctx); if (ec) throw new Error(ec); }
                if (op.und) it.und = txt(op.und, 20);
                var e = fijarCant(it, op, ctx); if (e) throw new Error(e);
                if (op.nota != null) it.nota = txt(op.nota, 400);
                // Alternativas excluyentes y renglones "por confirmar": se cotizan pero NO suman al total
                if (op.condicion !== undefined) {
                    if (op.condicion === null || op.condicion === '' || op.condicion === 'normal') { delete it.condicion; delete it.grupo; }
                    else if (CONDICIONES.indexOf(op.condicion) >= 0) { it.condicion = op.condicion; if (op.grupo) it.grupo = txt(op.grupo, 80); }
                    else throw new Error('condicion: alternativa, por_confirmar o normal');
                }
                if (!ex) cap.items.push(it);
                else if (cap !== ex.capitulo) { ex.capitulo.items = ex.capitulo.items.filter(function (x) { return x !== it; }); cap.items.push(it); }
                r.ok = true; r.id = it.id; return;
            }
            case 'fila': {
                var t = TIPOS_FILA.indexOf(op.tipo) >= 0 ? op.tipo : null;
                if (!t) throw new Error('tipo de fila: mat, mo, eq o sub');
                var en = buscarItem(b, op.item);
                if (!en) throw new Error('no existe el ítem ' + op.item);
                var res = armarFila(op, t, ctx);
                if (res.error) throw new Error(res.error);
                if (res.fila.cerrado) en.item.apu.mo = en.item.apu.mo.filter(function (x) { return !(x.trato && !x.cerrado); });
                var filas = en.item.apu[t];
                if (op.reemplaza != null) {
                    var k = parseInt(op.reemplaza, 10);
                    if (!(k >= 1 && k <= filas.length)) throw new Error('no existe la fila ' + op.reemplaza + ' en ' + t);
                    filas[k - 1] = res.fila;
                } else filas.push(res.fila);
                r.ok = true; r.item = en.item.id; return;
            }
            case 'quitar': {
                if (op.fila != null) {
                    var en2 = buscarItem(b, op.item);
                    if (!en2) throw new Error('no existe el ítem ' + op.item);
                    var fs = en2.item.apu[op.tipo];
                    var k2 = parseInt(op.fila, 10);
                    if (!fs || !(k2 >= 1 && k2 <= fs.length)) throw new Error('no existe la fila ' + op.fila);
                    fs.splice(k2 - 1, 1);
                } else if (op.item) {
                    var en3 = buscarItem(b, op.item);
                    if (!en3) throw new Error('no existe el ítem ' + op.item);
                    en3.capitulo.items = en3.capitulo.items.filter(function (x) { return x !== en3.item; });
                } else if (op.capitulo) {
                    var c3 = buscarCapitulo(b, op.capitulo);
                    if (!c3) throw new Error('no existe el capítulo ' + op.capitulo);
                    b.capitulos = b.capitulos.filter(function (x) { return x !== c3; });
                } else throw new Error('quitar: indicá item, fila o capitulo');
                r.ok = true; return;
            }
            case 'confirmar_supuestos': {
                var vcs = validarOrigen(op.confirmacion, ctx, 'confirmacion');
                if (!vcs.ok || vcs.origen.tipo !== 'dueño') throw new Error('confirmar_supuestos: necesita confirmacion dueño:<mensaje donde el dueño los confirma>');
                var objetivo = op.item ? [buscarItem(b, op.item)] : [];
                if (op.item && !objetivo[0]) throw new Error('no existe el ítem ' + op.item);
                if (!op.item) b.capitulos.forEach(function (c) { c.items.forEach(function (it) { objetivo.push({ item: it }); }); });
                var n = 0;
                objetivo.forEach(function (o) { n += confirmarItem(o.item, vcs.origen.texto); });
                r.ok = true; r.confirmadas = n; return;
            }
            case 'recargos': {
                var v = validarOrigen(op.origen, ctx, 'recargos');
                if (!v.ok) throw new Error('recargos: ' + v.error);
                if (v.origen.tipo === 'pieza3d') throw new Error('recargos: pieza3d no vale');
                var rc = v.origen.texto === 'base:presupuesto/recargos' && ctx.recargosPresupuesto ? clon(ctx.recargosPresupuesto) : {};
                ['cs', 'ind', 'util'].forEach(function (k) { if (op[k] != null) { var x = num(op[k]); if (!(x >= 0 && x < 500)) throw new Error('recargo ' + k + ' inválido'); rc[k] = x; } });
                if (rc.cs == null || rc.ind == null || rc.util == null) throw new Error('recargos: faltan cs, ind o util');
                rc.origen = v.origen.texto;
                b.recargos = rc;
                r.ok = true; return;
            }
            default: throw new Error('operación desconocida: ' + op.op);
        }
    }

    /** Marca como confirmadas las filas con supuesto de un ítem (y su cantidad). Devuelve cuántas. */
    function confirmarItem(it, confirmacion) {
        var n = 0;
        TIPOS_FILA.forEach(function (t) { (it.apu[t] || []).forEach(function (f) { if (f.supuesto && !f.confirmado) { f.confirmado = true; f.confirmacion = confirmacion; n++; } }); });
        if (it.cant_confirmada === false) { it.cant_confirmada = true; n++; }
        (it.caracteristicas || []).forEach(function (c) { if (c.supuesto && !c.confirmado) { c.confirmado = true; c.confirmacion = confirmacion; } });
        return n;
    }
    function supuestosPendientes(it) {
        var n = it.cant_confirmada === false ? 1 : 0;
        TIPOS_FILA.forEach(function (t) { (it.apu[t] || []).forEach(function (f) { if (f.supuesto && !f.confirmado) n++; }); });
        return n;
    }

    /**
     * Un ítem es lo que el cliente compra y se le entrega (el trofeo, el mostrador, el letrero, el traslado y montaje).
     * Materiales, mano de obra, equipos, fijaciones y pintura van DENTRO de su APU. Aviso si un ítem parece ser solo un
     * componente de costo de otro: solo mano de obra, o solo un material genérico ("armado", "fijaciones"…), o con ese nombre.
     */
    var RE_COMPONENTE = /^(armado|ensamblado|ensamble|fijaci[oó]n|fijaciones|torniller[ií]a|mano de obra|m\.?\s?o\.?\b|pintura|soldadura|corte|rolado|lijado|accesorios|insumos|materiales)\b/i;
    var RE_ENTREGABLE_SERVICIO = /traslado|montaje|instalaci[oó]n|transporte|flete|desmontaje|log[ií]stica|dise[ñn]o|restauraci[oó]n|mantenimiento/i;
    var AVISO_COMPONENTE = '¿esto no es parte del APU de otro ítem?';
    function itemSospechoso(it) {
        if (it.desde3d) return null;
        var desc = String(it.desc || '').trim();
        if (RE_ENTREGABLE_SERVICIO.test(desc)) return null;
        if (RE_COMPONENTE.test(desc)) return AVISO_COMPONENTE;
        var mat = it.apu.mat || [], mo = it.apu.mo || [], eq = it.apu.eq || [], sub = it.apu.sub || [];
        if (mo.length && !mat.length && !eq.length && !sub.length) return AVISO_COMPONENTE;
        if (!mo.length && !eq.length && !sub.length && mat.length === 1 && RE_COMPONENTE.test(String(mat[0].d || ''))) return AVISO_COMPONENTE;
        return null;
    }

    // ------------------------------------------------------------------ totales (los calcula la herramienta)
    function calcularTotales(b, ctx) {
        var rc = b.recargos || (ctx && ctx.recargosPresupuesto ? Object.assign({ origen: 'base:presupuesto/recargos' }, ctx.recargosPresupuesto) : { cs: 55, ind: 10, util: 50, origen: 'apu-utils (por defecto)' });
        if (!b.recargos) b.recargos = rc;
        var total = 0, marcadas = 0, pendientes = 0, aparte = [];
        b.capitulos.forEach(function (c) {
            var tc = 0;
            c.items.forEach(function (it) {
                var apu = { mat: it.apu.mat, mo: it.apu.mo, eq: it.apu.eq, sub: it.apu.sub, cs: rc.cs, ind: rc.ind, util: rc.util };
                it.pu = L.calcPu(apu);
                // totales por grupo (costo directo por unidad, sin indirectos ni utilidad), como el APU del presupuesto
                var sg = function (fs) { return r2((fs || []).reduce(function (s, f) { return s + (num(f.q) || 0) * (num(f.p) || 0); }, 0)); };
                it.grupos = { mat: sg(it.apu.mat), mo: sg(it.apu.mo), cs: r2(sg(it.apu.mo) * (num(rc.cs) || 0) / 100), eq: sg(it.apu.eq), sub: sg(it.apu.sub) };
                it.total = r2(it.pu * (num(it.cant) || 0));
                it.marcadas = TIPOS_FILA.reduce(function (s, t) { return s + it.apu[t].filter(function (f) { return f.revisar; }).length; }, 0);
                it.supuestos_pendientes = supuestosPendientes(it);
                var sos = itemSospechoso(it);
                if (sos) it.aviso = sos; else delete it.aviso;
                marcadas += it.marcadas; pendientes += it.supuestos_pendientes;
                if (it.condicion) aparte.push({ id: it.id, desc: it.desc, condicion: it.condicion, grupo: it.grupo || null, total: it.total });
                else tc += it.total;
            });
            c.total = r2(tc);
            total += c.total;
        });
        b.total = r2(total);
        b.filas_marcadas = marcadas;
        b.supuestos_pendientes = pendientes;
        b.aparte = aparte;   // alternativas y "por confirmar": cotizadas, fuera del total
        return b;
    }

    /** Resumen compacto para devolverle al modelo después de cada operación. */
    /**
     * Resumen compacto para devolverle al modelo después de cada operación: totales de todo y filas solo de los ítems tocados
     * (los demás ya los vio). Sin "tocados", todos los ítems con filas.
     */
    function resumen(b, tocados) {
        var verFilas = function (id) { return !tocados || tocados.indexOf(id) >= 0; };
        return {
            total: b.total, fuera_del_total: (b.aparte || []).length ? (b.aparte || []).map(function (a) { return a.desc + ' (' + NOMBRE_CONDICION[a.condicion] + '): ' + a.total; }) : undefined,
            filas_marcadas: b.filas_marcadas, supuestos_sin_confirmar: b.supuestos_pendientes || 0,
            recargos: [b.recargos && b.recargos.cs, b.recargos && b.recargos.ind, b.recargos && b.recargos.util].join('/') + ' % (cs/ind/util)',
            capitulos: b.capitulos.map(function (c) {
                return { id: c.id, nombre: c.nombre, total: c.total, items: c.items.map(function (it) {
                    var o = { id: it.id, desc: it.desc, cant: it.cant + ' ' + it.und, pu: it.pu, total: it.total };
                    if (it.supuestos_pendientes) o.supuestos_sin_confirmar = it.supuestos_pendientes;
                    if (it.aviso) o.aviso = it.aviso;
                    if (it.condicion) o.condicion = NOMBRE_CONDICION[it.condicion] + ' (no suma al total)' + (it.grupo ? ' · ' + it.grupo : '');
                    if (!(it.caracteristicas || []).length) o.aviso = (o.aviso ? o.aviso + ' · ' : '') + 'faltan las características para el cliente';
                    else if (verFilas(it.id)) o.caracteristicas = it.caracteristicas.map(function (c) { return c.texto + (c.supuesto && !c.confirmado ? ' (supuesto sin confirmar)' : ''); });
                    if (verFilas(it.id)) TIPOS_FILA.forEach(function (t) {
                        if (it.apu[t].length) o[t] = it.apu[t].map(function (f, i) {
                            // [n, d, "q u", p, marca]
                            var marca = [f.revisar, f.supuesto ? (f.confirmado ? 'supuesto ok' : 'supuesto sin confirmar') : '', f.stock_q ? 'stock ' + f.stock_q : '', f.cerrado ? 'trato cerrado' : ''].filter(Boolean).join(' · ');
                            var x = [i + 1, f.d, f.q + ' ' + f.u, f.p];
                            if (marca) x.push(marca);
                            return x;
                        });
                    });
                    else if (it.marcadas) o.filas_marcadas = it.marcadas;
                    return o;
                }) };
            })
        };
    }

    /**
     * Ítems para "Aplicar al presupuesto": formato de presupuesto.html (como armarItems de Importar 3D),
     * con id estable (el del borrador), origen "agente" y los capítulos como filas "chapter".
     */
    function aItemsPresupuesto(b, opciones) {
        opciones = opciones || {};
        b = normalizar(b);
        var rc = b.recargos || {};
        var salida = [];
        b.capitulos.forEach(function (c) {
            var listos = c.items.filter(function (it) { return !supuestosPendientes(it); });
            if (!listos.length) return;
            if (opciones.capitulos !== false) salida.push({ type: 'chapter', name: String(c.nombre).toUpperCase(), collapsed: false, id: c.id, origen: 'agente' });
            listos.forEach(function (it) {
                var limpia = function (f) {
                    var x = { d: f.d, u: f.u, q: f.q, p: f.p, origen: 'agente', origen_q: f.origen_q || null, origen_p: f.origen_p || null };
                    ['clave', 'nota', 'revisar', 'trato', 'referencia', 'cerrado', 'supuesto', 'confirmacion', 'stock_q', 'q_total', 'origen_stock', 'geometria', 'measures', 'measures_modo'].forEach(function (k) { if (f[k] != null) x[k] = f[k]; });
                    return x;
                };
                var item = {
                    type: 'item', id: it.id, origen: 'agente', desc: it.desc, und: it.und || 'glb', cant: it.cant, feat: textoCaracteristicas(it),
                    apu: { mat: it.apu.mat.map(limpia), mo: it.apu.mo.map(limpia), eq: it.apu.eq.map(limpia), sub: it.apu.sub.map(limpia), cs: rc.cs, ind: rc.ind, util: rc.util },
                    agente: { conv: opciones.conv || 'principal', condicion: it.condicion || null, grupo: it.grupo || null, version: b.version, cant_origen: it.cant_origen || null, desde3d: it.desde3d || null, filas_a_revisar: it.marcadas || 0, aplicado: opciones.fecha || null }
                };
                item.pu = L.calcPu(item.apu);
                // fuera del total: se usa el "ojo" del presupuesto (activo: false, no suma ni sale en el PDF)
                if (it.condicion) item.activo = false;
                if (it.measures) { item.measures = it.measures; item.measures_modo = it.measures_modo || 'volumen'; }
                salida.push(JSON.parse(JSON.stringify(item)));
            });
        });
        return salida;
    }

    /**
     * Suma los ítems del borrador al presupuesto (arreglo `data` de presupuesto.html) sin reordenar nada:
     * - un ítem o capítulo que ya se aplicó antes (mismo id) se actualiza EN SU LUGAR (las licitaciones apuntan por posición);
     * - lo nuevo va AL FINAL.
     * Devuelve { data, agregados, actualizados }.
     */
    function aplicarAlPresupuesto(data, items) {
        var salida = (data || []).slice(), agregados = 0, actualizados = 0;
        var porId = {};
        salida.forEach(function (x, i) { if (x && x.id) porId[x.id] = i; });
        items.forEach(function (it) {
            if (it.id && porId[it.id] != null) {
                var viejo = salida[porId[it.id]];
                if (it.type === 'chapter') { salida[porId[it.id]] = Object.assign({}, viejo, { name: it.name }); return; }
                // se conserva lo que el presupuesto le agregó al ítem (fotos, notas de licitación, etc.)
                salida[porId[it.id]] = Object.assign({}, viejo, it);
                actualizados++;
            } else {
                salida.push(it);
                if (it.type === 'item') agregados++;
            }
        });
        return { data: salida, agregados: agregados, actualizados: actualizados };
    }

    /**
     * Edición A MANO del dueño en el borrador (sin IA, costo 0): nombre, cantidad, características o borrar una fila.
     * El origen de lo editado es el mensaje "editado por el dueño" que registra el chat (msgId).
     * Devuelve { borrador, texto } (texto = resumen para el chat y para el próximo turno del agente) o { error }.
     */
    function editarManual(borrador, cambio, msgId) {
        var b = normalizar(borrador), o = 'dueño:' + msgId, partes = [];
        var en = buscarItem(b, cambio.item);
        if (!en) return { error: 'no existe el ítem' };
        var it = en.item, antes = it.desc;
        if (cambio.desc != null) {
            var d = txt(cambio.desc, 200);
            if (!d) return { error: 'el nombre no puede quedar vacío' };
            if (d.length > 80) return { error: 'el nombre es largo: el detalle va en las características' };
            if (d !== it.desc) { partes.push('nombre "' + it.desc + '" → "' + d + '"'); it.desc = d; }
        }
        if (cambio.cant != null) {
            var c = num(cambio.cant);
            if (!(c > 0)) return { error: 'cantidad inválida' };
            if (c !== it.cant) { partes.push('cantidad ' + it.cant + ' → ' + c); it.cant = c; if (c !== 1) it.cant_origen = o; else delete it.cant_origen; delete it.cant_confirmada; }
        }
        if (cambio.caracteristicas != null) {
            var lineas = (Array.isArray(cambio.caracteristicas) ? cambio.caracteristicas : String(cambio.caracteristicas).split('\n'))
                .map(function (t) { return txt(t, 200).replace(/^[•\-*]\s*/, ''); }).filter(Boolean);
            var e = fijarCaracteristicas(it, lineas.map(function (t) { return { texto: t, origen: /\d/.test(t) ? o : undefined }; }), { mensajesDueno: (function () { var m = {}; m[msgId] = true; return m; })() });
            if (e) return { error: e };
            partes.push('características: ' + lineas.join(' / '));
        }
        if (cambio.quitar) {
            var fs = it.apu[cambio.quitar.tipo], k = parseInt(cambio.quitar.n, 10);
            if (!fs || !(k >= 1 && k <= fs.length)) return { error: 'no existe esa fila' };
            partes.push('borró la fila "' + fs[k - 1].d + '" (' + TIT_FILA[cambio.quitar.tipo] + ')');
            fs.splice(k - 1, 1);
        }
        if (!partes.length) return { error: 'no hay cambios' };
        b.version = (b.version || 0) + 1;
        calcularTotales(b, null);
        return { borrador: b, texto: '«' + antes + '»: ' + partes.join('; ') };
    }
    var TIT_FILA = { mat: 'materiales', mo: 'mano de obra', eq: 'equipo', sub: 'subcontratos' };

    var api = { CONDICIONES: CONDICIONES, NOMBRE_CONDICION: NOMBRE_CONDICION, editarManual: editarManual, textoCaracteristicas: textoCaracteristicas, fijarCaracteristicas: fijarCaracteristicas, itemSospechoso: itemSospechoso, AVISO_COMPONENTE: AVISO_COMPONENTE, normalizar: normalizar, confirmarSupuestos: confirmarSupuestos, confirmarItem: confirmarItem, supuestosPendientes: supuestosPendientes, cantidadGeometria: cantidadGeometria, aplicarAlPresupuesto: aplicarAlPresupuesto, vacio: vacio, validarOrigen: validarOrigen, armarFila: armarFila, aplicarOperaciones: aplicarOperaciones,
        calcularTotales: calcularTotales, resumen: resumen, aItemsPresupuesto: aItemsPresupuesto, MEDIDAS: MEDIDAS, TIPOS_FILA: TIPOS_FILA };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else global.AgenteBorrador = api;
})(typeof window !== 'undefined' ? window : globalThis);
