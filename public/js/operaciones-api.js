/**
 * Cliente de las operaciones de servidor por área (docs/sesiones/08-operaciones-kay.md): /api/licitaciones (y, en las
 * etapas siguientes, gantt, producción y diseño). Las pantallas ya no escriben esas áreas en la base: piden la operación
 * y el servidor aplica la misma lógica que usan Kay y Claude (historial, copia del trabajador, idempotencia).
 *
 *   RubikOps.licitaciones(accion, datos)   → resultado (lanza Error con el motivo si el servidor rechaza)
 *   RubikOps.proyectos(accion, datos)      → archivar / desarchivar varios proyectos
 *   RubikOps.cobros(accion, datos)         → pendientes, registrar_cobro, registrar_factura, anular_* (functions/cobros)
 *   RubikOps.rendiciones(accion, datos)    → estado, resumen, entregar, registrar_gasto, aprobar, rechazar, anular (functions/rendiciones)
 *   RubikOps.archivoABase64(file)          → {datos_base64, mime}  (comprobantes)
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
    function clave() {
        return 'app-' + (global.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
    }
    /** POST con reintentos ante cortes o 502/503/504, siempre con la MISMA clave: no se repite la operación. */
    async function llamar(area, cuerpo) {
        const body = JSON.stringify(Object.assign({ idempotencia: clave() }, cuerpo));
        for (let intento = 0; ; intento++) {
            let r = null, red = null;
            try { r = await fetch('/api/' + area, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + await token() }, body }); }
            catch (e) { red = e; }
            const transitorio = red || [502, 503, 504].indexOf(r.status) >= 0;
            if (transitorio && intento < 3) { await new Promise((ok) => setTimeout(ok, 1500 * (intento + 1))); continue; }
            if (red) throw new Error('Sin conexión (' + (red.message || 'red') + ').');
            let j = {};
            try { j = await r.json(); } catch (e) { j = {}; }
            if (!r.ok) throw new Error(j.error || ('Error ' + r.status));
            return j;
        }
    }
    function archivoABase64(file) {
        return new Promise((ok, ko) => {
            if (!file) return ok(null);
            const fr = new FileReader();
            fr.onload = () => { const m = /^data:([^;,]+)?;base64,(.*)$/.exec(String(fr.result)); ok(m ? { datos_base64: m[2], mime: m[1] || null } : null); };
            fr.onerror = () => ko(new Error('No se pudo leer el archivo.'));
            fr.readAsDataURL(file);
        });
    }
    /** Crea el link personal para rendir (rendir.html) y ofrece mandarlo por WhatsApp o copiarlo. */
    async function linkRendicion(wid, cid, pid) {
        const r = await llamar('rendiciones', { accion: 'crear_link', worker_id: wid, cid: cid || undefined, pid: pid || undefined });
        let tel = '';
        try { tel = String((await firebase.database().ref('personal/' + wid + '/telefono').once('value')).val() || '').replace(/\D/g, ''); } catch (e) { tel = ''; }
        if (tel && tel.length === 8) tel = '591' + tel;
        const msg = `Hola ${r.nombre}, este es tu link para rendir los gastos${r.proyecto ? ' de ' + r.proyecto : ''} (cargá cada compra con su precio y la foto del recibo): ${r.url}\nVence el ${r.vence}.`;
        try { await navigator.clipboard.writeText(r.url); } catch (e) { /* sin portapapeles */ }
        if (confirm(`Link creado y copiado (vence el ${r.vence}).\n\n¿Abrir WhatsApp para mandárselo a ${r.nombre}${tel ? '' : ' (no tiene teléfono cargado: elegís el chat)'}?`)) {
            window.open('https://wa.me/' + (tel || '') + '?text=' + encodeURIComponent(msg), '_blank');
        } else { window.prompt('Copiá el link:', r.url); }
        return r;
    }
    function dataUrlABase64(u) { const m = /^data:([^;,]+)?;base64,(.*)$/.exec(String(u || '')); return m ? { datos_base64: m[2], mime: m[1] || null } : null; }
    global.RubikOps = {
        licitaciones: (accion, datos) => llamar('licitaciones', Object.assign({ accion }, datos)),
        proyectos: (accion, datos) => llamar('proyectos', Object.assign({ accion }, datos)),   // archivar / desarchivar / finanzas
        cobros: (accion, datos) => llamar('cobros', Object.assign({ accion }, datos)),         // cobros y facturas de venta
        rendiciones: (accion, datos) => llamar('rendiciones', Object.assign({ accion }, datos)), // caja chica: entregas, gastos, aprobar
        linkRendicion,
        archivoABase64, dataUrlABase64, nuevaClave: clave,
    };
})(window);
