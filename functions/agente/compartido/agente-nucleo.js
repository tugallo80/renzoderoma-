/**
 * agente-nucleo.js — Lógica pura del Agente IA cotizador (sin DOM, sin Firebase).
 *
 * La usan el navegador (window.AgenteNucleo) y la Cloud Function (functions/agente/compartido/,
 * copia exacta que verifica tools/agente/probar.mjs). Regla de oro: el agente no inventa números;
 * los costos, los totales y la validación de origen se calculan acá, nunca en el modelo.
 */
(function (global) {
    'use strict';

    // ---------------------------------------------------------------------
    // Configuración por defecto (se pisa con /config/agente)
    // ---------------------------------------------------------------------
    // Precios en USD por millón de tokens (tabla del skill claude-api, nov 2026).
    // cache_escrita = escritura de caché de 5 min (1,25 × entrada); la de 1 h cuesta 2 × entrada.
    var PRECIOS_DEFECTO = {
        'claude-opus-5-5':   { entrada: 4,    salida: 20,  cache_escrita: 5,     cache_leida: 0.20 },
        'claude-sonnet-5-5': { entrada: 2,    salida: 10,  cache_escrita: 2.5,   cache_leida: 0.10 },
        'claude-haiku-5-5':  { entrada: 0.10, salida: 0.50, cache_escrita: 0.125, cache_leida: 0.01 },
        // Modelos a los que puede caer un rechazo (fallbacks "default")
        'claude-opus-5':     { entrada: 5,    salida: 25,  cache_escrita: 6.25,  cache_leida: 0.50 },
        'claude-opus-4-8':   { entrada: 5,    salida: 25,  cache_escrita: 6.25,  cache_leida: 0.50 },
        'claude-sonnet-5':   { entrada: 2,    salida: 10,  cache_escrita: 2.5,   cache_leida: 0.20 }
    };

    var CONFIG_DEFECTO = {
        modelo: 'claude-opus-5-5',
        effort: 'high',
        effort_correcciones: 'medium',   // turnos después del primer borrador (effort por mensaje: no rompe la caché)
        modelo_correcciones: 'igual',    // modelo de los turnos después del primer borrador ("igual" = el principal)
        cache_ttl: '1h',                 // el dueño tarda más de 5 min entre turnos: con 5 min la caché vencía y se reescribía todo
        max_tokens: 32000,
        tope_mensual_usd: 30,     // frena al pasarlo (con opción de seguir)
        aviso_pct: 80,            // avisa al llegar a este % del tope
        fallbacks: true,          // fallbacks por rechazo del servidor (Opus 5.5 / Sonnet 5.5)
        max_llamadas_turno: 30
    };

    var EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
    // Effort por mensaje (beta mid-conversation-output-config-2026-07-01), con thinking adaptativo
    var MODELOS_EFFORT_POR_MENSAJE = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5', 'claude-fable-5-2', 'claude-fable-5-1'];
    var MODELOS_CON_FALLBACK = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5'];

    function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }
    function redondear(x, dec) { var f = Math.pow(10, dec == null ? 2 : dec); return Math.round(num(x) * f) / f; }

    /** Config efectiva: defaults + lo guardado en /config/agente (valores inválidos se ignoran). */
    function configEfectiva(guardada) {
        var g = guardada || {}, c = Object.assign({}, CONFIG_DEFECTO);
        if (typeof g.modelo === 'string' && /^claude-[a-z0-9-]+$/.test(g.modelo)) c.modelo = g.modelo;
        if (EFFORTS.indexOf(g.effort) >= 0) c.effort = g.effort;
        if (EFFORTS.indexOf(g.effort_correcciones) >= 0 || g.effort_correcciones === 'igual') c.effort_correcciones = g.effort_correcciones;
        if (g.modelo_correcciones === 'igual' || (typeof g.modelo_correcciones === 'string' && /^claude-[a-z0-9-]+$/.test(g.modelo_correcciones))) c.modelo_correcciones = g.modelo_correcciones;
        if (g.cache_ttl === '5m' || g.cache_ttl === '1h') c.cache_ttl = g.cache_ttl;
        ['max_tokens', 'tope_mensual_usd', 'aviso_pct', 'max_llamadas_turno'].forEach(function (k) {
            if (g[k] != null && num(g[k]) > 0) c[k] = num(g[k]);
        });
        c.max_tokens = Math.min(Math.round(c.max_tokens), 128000);
        if (g.fallbacks === false) c.fallbacks = false;
        c.precios = Object.assign({}, PRECIOS_DEFECTO, g.precios || {});
        return c;
    }

    // ---------------------------------------------------------------------
    // Medidor de costos
    // ---------------------------------------------------------------------
    /**
     * Costo de una respuesta de la API a partir de su `usage`.
     * Si hubo fallback por rechazo, `usage.iterations` trae una entrada por modelo: se cobra cada una a su precio.
     * Devuelve tokens (entrada, salida, cache_escrita, cache_leida), usd y el detalle por modelo.
     */
    function costoDeUso(usage, modelo, precios) {
        precios = precios || PRECIOS_DEFECTO;
        usage = usage || {};
        var partes = Array.isArray(usage.iterations) && usage.iterations.length ? usage.iterations : [usage];
        var tot = { entrada: 0, salida: 0, cache_escrita: 0, cache_leida: 0, usd: 0, sin_precio: [], modelos: {} };
        partes.forEach(function (u) {
            var m = u.model || modelo;
            var p = precios[m];
            var cc = u.cache_creation || null;
            var esc1h = cc ? num(cc.ephemeral_1h_input_tokens) : 0;
            var esc = num(u.cache_creation_input_tokens);
            var e = num(u.input_tokens), s = num(u.output_tokens), l = num(u.cache_read_input_tokens);
            tot.entrada += e; tot.salida += s; tot.cache_escrita += esc; tot.cache_leida += l;
            var usd = 0;
            if (p) {
                usd = (e * p.entrada + s * p.salida + (esc - esc1h) * p.cache_escrita + esc1h * p.entrada * 2 + l * p.cache_leida) / 1e6;
            } else if (tot.sin_precio.indexOf(m) < 0) tot.sin_precio.push(m);
            tot.usd += usd;
            tot.modelos[m] = redondear((tot.modelos[m] || 0) + usd, 6);
        });
        tot.usd = redondear(tot.usd, 6);
        return tot;
    }

    /** % de la entrada que vino de la caché (leída) en una llamada: para ver si la caché funciona. */
    function pctCache(c) {
        var tot = num(c.entrada) + num(c.cache_escrita) + num(c.cache_leida);
        return tot > 0 ? Math.round(num(c.cache_leida) / tot * 100) : 0;
    }

    /** Suma un costo a un acumulado (para las transacciones de RTDB). */
    function sumarCosto(acc, c) {
        acc = acc || {};
        var r = {};
        ['entrada', 'salida', 'cache_escrita', 'cache_leida'].forEach(function (k) { r[k] = num(acc[k]) + num(c[k]); });
        r.usd = redondear(num(acc.usd) + num(c.usd), 6);
        r.llamadas = num(acc.llamadas) + 1;
        return r;
    }

    /** Mes de facturación en hora de Bolivia (UTC−4): "2026-11". */
    function mesClave(ms) {
        var d = new Date((ms == null ? Date.now() : ms) - 4 * 3600 * 1000);
        return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2);
    }

    /** Estado del tope mensual: "ok", "aviso" (≥ aviso_pct %) o "tope" (≥ 100 %). */
    function estadoTope(gastoMes, config) {
        var c = config || CONFIG_DEFECTO;
        var tope = num(c.tope_mensual_usd), g = num(gastoMes);
        if (!(tope > 0)) return { nivel: 'ok', pct: 0, gasto: g, tope: 0 };
        var pct = g / tope * 100;
        return { nivel: pct >= 100 ? 'tope' : pct >= num(c.aviso_pct || 80) ? 'aviso' : 'ok', pct: redondear(pct, 1), gasto: redondear(g, 4), tope: tope };
    }

    /**
     * Costo aproximado de una corrección chica con la conversación ya compactada (para mostrar en ⚙):
     * 2 llamadas, prefijo de ~15.000 tokens leído de la caché, ~2.000 de entrada nueva y ~1.500 de salida (con pensamiento) cada una.
     */
    function costoCorreccionEstimado(modelo, precios) {
        var p = (precios || PRECIOS_DEFECTO)[modelo];
        if (!p) return null;
        return redondear(2 * (15000 * p.cache_leida + 2000 * p.entrada + 1500 * p.salida) / 1e6, 4);
    }

    function usd(x) {
        var v = num(x);
        return 'US$ ' + (v < 0.01 && v > 0 ? v.toFixed(4) : v.toFixed(2));
    }

    // ---------------------------------------------------------------------
    // Origen de cada número (se valida en la herramienta, no en el prompt)
    //   pieza3d:<adjunto>/<pieza>   base:<nodo>/<clave>   cota_plano:<adjunto> p.<n> "<cita>"   dueño:<mensaje>
    //   supuesto:<explicación>  (propuesta constructiva del agente: se ve aparte y no se aplica hasta que el dueño la confirma)
    // ---------------------------------------------------------------------
    var TIPOS_ORIGEN = ['pieza3d', 'base', 'cota_plano', 'dueño', 'supuesto', 'calculo'];

    function parsearOrigen(texto) {
        var t = String(texto == null ? '' : texto).trim();
        var m = /^([a-zñ_0-9]+)\s*:\s*([\s\S]+)$/i.exec(t);
        if (!m) return null;
        var tipo = m[1].toLowerCase();
        if (tipo === 'dueno') tipo = 'dueño';
        if (tipo === 'pieza_3d' || tipo === '3d') tipo = 'pieza3d';
        if (tipo === 'cota' || tipo === 'plano') tipo = 'cota_plano';
        if (tipo === 'supuestos') tipo = 'supuesto';
        if (TIPOS_ORIGEN.indexOf(tipo) < 0) return null;
        var ref = m[2].trim();
        if (!ref) return null;
        return { tipo: tipo, ref: ref, texto: tipo + ':' + ref };
    }

    // ---------------------------------------------------------------------
    // Medición 3D (rubik/1) — escala y resumen para la herramienta medicion_3d
    // ---------------------------------------------------------------------
    /** Escala parejo un resultado rubik/1 (largos × f, áreas × f², volúmenes × f³). No cambia el original. */
    function escalarMedicion(med, f) {
        f = num(f) || 1;
        if (f === 1) return med;
        var r = JSON.parse(JSON.stringify(med));
        (r.piezas || []).forEach(function (p) {
            ['largo', 'ancho', 'espesor', 'perimetro_ml'].forEach(function (k) { if (p[k] != null) p[k] = redondear(p[k] * f, 6); });
            ['area_m2', 'area_cara_m2'].forEach(function (k) { if (p[k] != null) p[k] = redondear(p[k] * f * f, 6); });
            if (p.volumen_m3 != null) p.volumen_m3 = redondear(p.volumen_m3 * f * f * f, 8);
            (p.acabados || []).forEach(function (a) { if (a.area_m2 != null) a.area_m2 = redondear(a.area_m2 * f * f, 6); });
            p.tipo = p.espesor != null && p.espesor <= 0.06 ? 'plancha' : (p.tipo || 'volumen');
        });
        if (r.tamano_m) r.tamano_m = r.tamano_m.map(function (x) { return redondear(x * f, 4); });
        return r;
    }

    /** Id estable de una pieza dentro de una medición: "<n>" (posición en rubik/1). */
    function idPieza(i) { return 'p' + (i + 1); }

    /**
     * Lo que ve el agente de una medición: piezas con medidas en mm, áreas, perímetros y los
     * indicadores de la ruta B por ítem. Sin precios (esos salen de la base).
     */
    function resumenMedicion(med, opciones) {
        opciones = opciones || {};
        var piezas = (med.piezas || []).map(function (p, i) {
            var r = {
                id: idPieza(i), item: p.item, pieza: p.pieza, cant: p.cant || 1,
                largo_mm: Math.round(num(p.largo) * 1000), ancho_mm: Math.round(num(p.ancho) * 1000), espesor_mm: redondear(num(p.espesor) * 1000, 1),
                tipo: p.tipo, area_m2: p.area_m2 != null ? redondear(p.area_m2, 4) : null
            };
            if (p.area_cara_m2 != null) r.area_cara_m2 = redondear(p.area_cara_m2, 4);
            if (p.perimetro_ml != null) r.perimetro_ml = redondear(p.perimetro_ml, 3);
            if (p.volumen_m3 != null) r.volumen_m3 = redondear(p.volumen_m3, 6);
            if (p.material) r.material_base = p.material;
            if (p.origen_vw) r.material_en_archivo = p.origen_vw;
            if ((p.acabados || []).length) r.acabados = p.acabados.map(function (a) { return { material_base: a.material || null, en_archivo: a.origen_vw || null, area_m2: redondear(a.area_m2, 4) }; });
            if (p.partes > 1) r.partes_sueltas = p.partes;
            if ((p.motivos || []).length) r.avisos = p.motivos;
            return r;
        });
        var items = [];
        piezas.forEach(function (p) { if (items.indexOf(p.item) < 0) items.push(p.item); });
        var porItem = items.map(function (n) {
            var ps = (med.piezas || []).filter(function (p) { return p.item === n; });
            var ind = { piezas: 0, m2_tablero: 0, ml_canto: 0, m2_superficie: 0, m3: 0 };
            ps.forEach(function (p) {
                var c = p.cant || 1;
                ind.piezas += c;
                if (p.tipo === 'plancha') {
                    ind.m2_tablero += (p.area_cara_m2 != null ? p.area_cara_m2 : p.largo * p.ancho) * c;
                    ind.ml_canto += (p.perimetro_ml != null ? p.perimetro_ml : 2 * (p.largo + p.ancho)) * c;
                }
                ind.m2_superficie += num(p.area_m2) * c;
                ind.m3 += (p.volumen_m3 != null ? p.volumen_m3 : p.largo * p.ancho * p.espesor) * c;
            });
            Object.keys(ind).forEach(function (k) { ind[k] = redondear(ind[k], 4); });
            return { item: n, indicadores_ruta_b: ind };
        });
        var r = {
            archivo: med.archivo || null, unidad: 'mm (áreas en m², perímetros en ml)',
            escala: opciones.escala || null, piezas: piezas, items: porItem,
            sin_equivalencia: med.sin_equivalencia || [], resumen: med.resumen || ''
        };
        if (opciones.tamano_m) r.tamano_total_mm = opciones.tamano_m.map(function (x) { return Math.round(x * 1000); });
        return r;
    }

    // ---------------------------------------------------------------------
    // Texto para mostrar
    // ---------------------------------------------------------------------
    /** Texto limpio para leer en voz alta (sin markdown ni tablas). */
    function textoParaVoz(t) {
        return String(t || '')
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/^\s*\|.*\|\s*$/gm, ' ')
            .replace(/[*#`_~>]/g, '')
            .replace(/https?:\/\/\S+/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 4500);
    }

    var api = {
        PRECIOS_DEFECTO: PRECIOS_DEFECTO, CONFIG_DEFECTO: CONFIG_DEFECTO, EFFORTS: EFFORTS, MODELOS_CON_FALLBACK: MODELOS_CON_FALLBACK, MODELOS_EFFORT_POR_MENSAJE: MODELOS_EFFORT_POR_MENSAJE, pctCache: pctCache, costoCorreccionEstimado: costoCorreccionEstimado,
        configEfectiva: configEfectiva, costoDeUso: costoDeUso, sumarCosto: sumarCosto, mesClave: mesClave, estadoTope: estadoTope, usd: usd,
        TIPOS_ORIGEN: TIPOS_ORIGEN, parsearOrigen: parsearOrigen,
        escalarMedicion: escalarMedicion, resumenMedicion: resumenMedicion, idPieza: idPieza,
        textoParaVoz: textoParaVoz, redondear: redondear
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else global.AgenteNucleo = api;
})(typeof window !== 'undefined' ? window : globalThis);
