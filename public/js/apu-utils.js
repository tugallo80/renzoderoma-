/**
 * apu-utils.js - Normalizacion blindada de APU para Rubik Bolivia
 * Version unica y definitiva.
 */
(function(global) {
    'use strict';

    function toApuArr(v) {
        if (!v) return [];
        if (typeof v === 'string') { try { v = JSON.parse(v); } catch(e) { return []; } }
        var arr = Array.isArray(v) ? v : Object.values(v);
        return arr.map(normApuRow).filter(function(r) { return r !== null; });
    }

    function normApuRow(r) {
        if (!r || typeof r !== 'object') return null;
        var d = r.d || r.item || r.nombre || r.desc || r.name || r.description || r.material || '';
        var u = r.u || r.und || r.unidad || r.unit || r.units || 'und';
        var qRaw = r.q != null ? r.q : (r.cant != null ? r.cant : (r.cantidad != null ? r.cantidad : (r.quantity != null ? r.quantity : (r.qty != null ? r.qty : 0))));
        var pRaw = r.p != null ? r.p : (r.prec != null ? r.prec : (r.precio != null ? r.precio : (r.pu != null ? r.pu : (r.pz != null ? r.pz : (r.price != null ? r.price : (r.costo != null ? r.costo : (r.cost != null ? r.cost : (r.valor != null ? r.valor : (r.monto != null ? r.monto : 0)))))))));
        var q = parseFloat(qRaw) || 0;
        var p = parseFloat(pRaw) || 0;
        if (!d && p === 0 && q === 0) return null;
        return Object.assign({}, r, { d: d, u: u, q: q, p: p });
    }

    function normPct(v, fallback) {
        var n = parseFloat(v) || 0;
        if (n > 0 && n < 1) return Math.round(n * 100);
        return n || fallback || null;
    }

    function normalizeApu(raw, itemRoot) {
        if (!raw && !itemRoot) {
            console.warn('[ApuUtils] normalizeApu: raw y itemRoot son null/undefined');
        }

        var apuSource = null;

        // 1. Caso normal: raw es el objeto apu
        if (raw && typeof raw === 'object') {
            apuSource = raw;
        }

        // 2. La IA pone mat/mo directamente en el item raiz
        if ((!apuSource || (!apuSource.mat && !apuSource.mo)) && itemRoot) {
            if (itemRoot.mat || itemRoot.mo) {
                apuSource = { mat: itemRoot.mat, mo: itemRoot.mo, eq: itemRoot.eq, sub: itemRoot.sub, util: itemRoot.util, ind: itemRoot.ind };
            }
        }

        // 3. La IA usa nombres alternativos para el objeto APU
        if ((!apuSource || (!apuSource.mat && !apuSource.mo)) && itemRoot) {
            var altKeys = ['analysis', 'breakdown', 'components', 'desglose', 'partidas', 'costos', 'budget'];
            for (var ki = 0; ki < altKeys.length; ki++) {
                var k = altKeys[ki];
                if (itemRoot[k] && typeof itemRoot[k] === 'object') {
                    var c = itemRoot[k];
                    if (c.mat || c.mo || c.materiales || c.mano_obra) {
                        apuSource = c;
                        console.log('[ApuUtils] APU encontrado en campo alternativo:', k);
                        break;
                    }
                }
            }
        }

        apuSource = apuSource || {};

        var util = normPct(apuSource.util, 50) || normPct(itemRoot && itemRoot.util, 50) || 50;
        var ind  = normPct(apuSource.ind,  10) || normPct(itemRoot && itemRoot.ind,  10) || 10;
        var csRaw = apuSource.cs != null ? apuSource.cs : (itemRoot && itemRoot.cs != null ? itemRoot.cs : null);
        var cs = csRaw !== null ? (normPct(csRaw, 0) || 0) : 55; // 55% cargas sociales Bolivia por defecto

        var result = {
            mat:  toApuArr(apuSource.mat  || apuSource.materiales  || apuSource.materials  || apuSource.Materiales),
            mo:   toApuArr(apuSource.mo   || apuSource.mano_obra   || apuSource.labor      || apuSource.manodeobra),
            eq:   toApuArr(apuSource.eq   || apuSource.equipos     || apuSource.equipment  || apuSource.Equipos),
            sub:  toApuArr(apuSource.sub  || apuSource.subcontratos|| apuSource.subcontract|| apuSource.Subcontratos),
            util: util,
            ind:  ind,
            cs:   cs
        };

        if (result.mat.length === 0 && result.mo.length === 0) {
            console.warn('[ApuUtils] APU vacio. apuSource keys:', Object.keys(apuSource));
        }

        return result;
    }

    function calcPuFromApu(apuObj) {
        var moBase = 0;
        (apuObj.mo || []).forEach(function(x) { moBase += (parseFloat(x.q) || 0) * (parseFloat(x.p) || 0); });
        var cs = apuObj.cs != null ? parseFloat(apuObj.cs) : 55;
        var csAmt = moBase * cs / 100;
        var dir = moBase + csAmt;
        ['mat','eq','sub'].forEach(function(t) {
            (apuObj[t] || []).forEach(function(x) { dir += (parseFloat(x.q) || 0) * (parseFloat(x.p) || 0); });
        });
        return dir * (1 + (apuObj.ind || 10) / 100) * (1 + (apuObj.util || 50) / 100);
    }

    global.ApuUtils = { toApuArr: toApuArr, normApuRow: normApuRow, normPct: normPct, normalizeApu: normalizeApu, calcPuFromApu: calcPuFromApu };

})(window);
