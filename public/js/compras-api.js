/**
 * Cliente de /api/compras (functions/compras, docs/sesiones/07-compras.md). Las pantallas ya no escriben compras ni
 * facturas de compra en la base: le piden la operación al servidor, que deja todo en su lugar (proyecto, Tesorería,
 * crédito fiscal, proveedor, precios, comprobante).
 *
 *   RubikCompras.nuevaClave()                       → clave de idempotencia para un envío (reintentar con la misma no duplica)
 *   RubikCompras.registrar({idempotencia, ...})     → {id, repetida, proveedor_id, resumen}
 *   RubikCompras.anular(id, motivo)                 → {ok, id}
 *   RubikCompras.dataUrlABase64(dataUrl)            → {datos_base64, mime}
 */
(function (global) {
    'use strict';

    async function token() {
        const u = firebase.auth().currentUser;
        if (u) return u.getIdToken();
        return new Promise((ok, ko) => {
            const des = firebase.auth().onAuthStateChanged((x) => { des(); x ? x.getIdToken().then(ok, ko) : ko(new Error('Sesión vencida: recargá la página.')); });
        });
    }

    /** POST con reintentos ante cortes de red o 502/503/504 (la operación es idempotente). */
    async function llamar(cuerpo) {
        const body = JSON.stringify(cuerpo);
        for (let intento = 0; ; intento++) {
            let r = null, red = null;
            try {
                r = await fetch('/api/compras', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + await token() }, body });
            } catch (e) { red = e; }
            const transitorio = red || [502, 503, 504].indexOf(r.status) >= 0;
            if (transitorio && intento < 3) { await new Promise((ok) => setTimeout(ok, 1500 * (intento + 1))); continue; }
            if (red) throw new Error('Sin conexión (' + (red.message || 'red') + ').');
            let j = {};
            try { j = await r.json(); } catch (e) { j = {}; }
            if (!r.ok) throw new Error(j.error || ('Error ' + r.status));
            return j;
        }
    }

    function nuevaClave() {
        if (global.crypto && crypto.randomUUID) return 'app-' + crypto.randomUUID();
        return 'app-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
    }

    function dataUrlABase64(dataUrl) {
        const m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(String(dataUrl || ''));
        return m ? { datos_base64: m[3], mime: m[1] || null } : null;
    }

    global.RubikCompras = {
        nuevaClave,
        dataUrlABase64,
        registrar: (datos) => llamar(Object.assign({ accion: 'registrar' }, datos)),
        anular: (id, motivo) => llamar({ accion: 'anular', id, motivo }),
        balanceMensual: (mes) => llamar({ accion: 'balance_mensual', mes }),
        balanceProyecto: (cid, pid) => llamar({ accion: 'balance_proyecto', cid, pid }),
    };
})(window);
