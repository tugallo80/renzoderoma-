/**
 * pdf-rendicion.js — PDF de la rendición de cuentas de una persona (caja chica): lo entregado, los gastos con su estado,
 * el saldo en mano y los recibos. UNA sola versión para Tesorería (pantalla) y el servidor (functions/documentos, para
 * que Kay lo mande por WhatsApp). Copia idéntica en functions/pdf/compartido/pdf-rendicion.js.
 *
 *   PdfRendicion.generar({
 *     jsPDF, estado,                 // estado = respuesta de la operación "estado" de functions/rendiciones
 *     fecha, logo,                   // logo: dataURL JPEG (o null)
 *     cargarImagen(url),             // → Promise<dataURL | null>   (recibos)
 *     dimensiones(dataURL),          // → Promise<{w, h}>
 *   }) → Promise<jsPDF>
 *   PdfRendicion.nombreArchivo(estado) → "Rendicion_<Nombre>[_<Proyecto>].pdf"  (estado con proyecto: solo ese proyecto)
 */
(function (global) {
    'use strict';
    var fM = function (n) { return parseFloat(n || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var limpio = function (s) { return String(s == null ? '' : s).replace(/[\u{1F000}-\u{1FFFF}]/gu, '').trim(); };
    var fechaBo = function (f) { var p = String(f || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : (f || ''); };
    var ESTADOS = { entregado: 'Entregado', aprobado: 'Aprobado', pendiente: 'Por aprobar', rechazado: 'Rechazado', anulado: 'Anulado' };

    var seguro = function (t) { return String(t || '').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/ /g, '_'); };
    function nombreArchivo(e) { return 'Rendicion_' + (seguro(e && e.nombre) || 'Persona') + (e && e.proyecto ? '_' + seguro(e.proyecto).slice(0, 30) : '') + '.pdf'; }

    async function generar(o) {
        var e = o.estado, doc = new o.jsPDF('p', 'mm', 'a4');
        var W = 210, mL = 15, mR = 15, usableW = W - mL - mR;
        var cargarImagen = o.cargarImagen || function () { return Promise.resolve(null); };
        var dimensiones = o.dimensiones || function () { return Promise.resolve({ w: 1, h: 1 }); };
        var t = e.totales || {};

        // ── Encabezado ──
        doc.setFillColor(0, 122, 255); doc.rect(0, 0, W, 28, 'F');
        doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
        doc.text('RENDICIÓN DE CUENTAS', W / 2, 12, { align: 'center' });
        doc.setFontSize(9); doc.setFont('helvetica', 'normal');
        var periodo = e.desde || e.hasta ? ('   |   PERIODO: ' + (e.desde ? fechaBo(e.desde) : '…') + ' a ' + (e.hasta ? fechaBo(e.hasta) : 'hoy')) : '';
        doc.text('PERSONA: ' + limpio(e.nombre) + (e.proyecto ? '   |   PROYECTO: ' + limpio(e.proyecto) : '') + periodo + '   |   ' + (o.fecha || ''), W / 2, 21, { align: 'center' });
        try { if (o.logo) doc.addImage(o.logo, 'JPEG', 4, 3, 22, 22); } catch (er) { /* sin logo */ }
        doc.setTextColor(0, 0, 0);

        // ── 1. Resumen ──
        var y = 36;
        doc.setFontSize(12); doc.setFont('helvetica', 'bold');
        doc.text('1. RESUMEN', mL, y);
        doc.autoTable({
            startY: y + 4, head: [['CONCEPTO', 'MONTO']],
            body: [
                ['TOTAL ENTREGADO', fM(t.entregado) + ' Bs'],
                ['GASTOS APROBADOS', fM(t.gastado_aprobado) + ' Bs'],
                ['GASTOS POR APROBAR', fM(t.pendiente_de_aprobar) + ' Bs'],
                [t.saldo_en_mano < 0 ? 'SALDO A FAVOR DE LA PERSONA (se le debe)' : 'SALDO EN MANO (por rendir o devolver)', fM(Math.abs(t.saldo_en_mano)) + ' Bs'],
            ],
            theme: 'grid', headStyles: { fillColor: [0, 122, 255] }, margin: { left: mL, right: mR },
            columnStyles: { 1: { halign: 'right', cellWidth: 45 } },
            didParseCell: function (d) { if (d.section === 'body' && d.row.index === 3) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = t.saldo_en_mano < 0 ? [200, 60, 0] : [0, 90, 0]; } },
        });
        y = doc.lastAutoTable.finalY + 10;

        // ── 2. Movimientos ──
        doc.setFontSize(12); doc.setFont('helvetica', 'bold');
        doc.text('2. MOVIMIENTOS', mL, y);
        var movs = (e.movimientos || []).slice().sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); });
        if (movs.length) {
            doc.autoTable({
                startY: y + 4, head: [['Fecha', 'Tipo', 'Concepto', 'Proyecto', 'Estado', 'Monto']],
                body: movs.map(function (m) {
                    var signo = m.tipo === 'deposito' ? '+ ' : '- ';
                    return [fechaBo(m.fecha), m.tipo === 'deposito' ? 'Entrega' : 'Gasto', limpio(m.concepto) + (m.proveedor ? ' (' + limpio(m.proveedor) + ')' : ''),
                        limpio(m.proyecto || 'General'), ESTADOS[m.estado] || m.estado, signo + fM(m.monto) + ' Bs'];
                }),
                theme: 'striped', headStyles: { fillColor: [52, 199, 89] }, styles: { fontSize: 8, overflow: 'linebreak' }, margin: { left: mL, right: mR },
                columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 16 }, 2: { cellWidth: 58 }, 3: { cellWidth: 34 }, 4: { cellWidth: 22 }, 5: { cellWidth: 30, halign: 'right' } },
                didParseCell: function (d) {
                    if (d.section !== 'body') return;
                    var m = movs[d.row.index];
                    if (m && (m.estado === 'rechazado' || m.estado === 'anulado')) d.cell.styles.textColor = [160, 160, 160];
                    else if (d.column.index === 5) d.cell.styles.textColor = m && m.tipo === 'deposito' ? [0, 120, 40] : [200, 40, 40];
                },
            });
            y = doc.lastAutoTable.finalY + 8;
        } else {
            doc.setFontSize(10); doc.setFont('helvetica', 'italic');
            doc.text('Sin movimientos en el periodo.', mL, y + 8); y += 16;
        }
        if (y > 270) { doc.addPage(); y = 20; }
        doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 100, 100);
        doc.text(e.proyecto ? 'Solo la plata para gastos de este proyecto. Los gastos rechazados o anulados no cuentan.'
            : 'Los gastos rechazados o anulados no cuentan. El saldo es de toda la cuenta, no solo del periodo.', mL, y);
        doc.setTextColor(0, 0, 0);

        // ── 3. Recibos ──
        var conRecibo = movs.filter(function (m) { return m.comprobante && m.estado !== 'anulado'; });
        if (conRecibo.length) {
            doc.addPage();
            doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(52, 199, 89);
            doc.text('ANEXO: RECIBOS Y COMPROBANTES', mL, 20);
            doc.setTextColor(0, 0, 0);
            var MAX_W = 85, MAX_H = 115, gap = 10, cx = mL, cy = 30, filaH = 0;
            for (var i = 0; i < conRecibo.length; i++) {
                var m = conRecibo[i], b64 = null;
                try { b64 = await cargarImagen(m.comprobante); } catch (er) { b64 = null; }
                if (!b64) continue;
                var dm = await dimensiones(b64).catch(function () { return { w: 1, h: 1 }; });
                var ratio = (dm.h || 1) / (dm.w || 1);
                var dW = MAX_W, dH = MAX_W * ratio;
                if (dH > MAX_H) { dH = MAX_H; dW = MAX_H / ratio; }
                if (cx + dW > W - mR + 0.1) { cx = mL; cy += filaH + 14; filaH = 0; }
                if (cy + dH + 8 > 285) { doc.addPage(); cx = mL; cy = 20; filaH = 0; }
                doc.setFontSize(7); doc.setFont('helvetica', 'bold');
                doc.text(fechaBo(m.fecha) + ' — ' + limpio(m.concepto).substring(0, 40) + ' — ' + fM(m.monto) + ' Bs', cx, cy - 2);
                try { doc.addImage(b64, b64.indexOf('data:image/png') === 0 ? 'PNG' : 'JPEG', cx, cy, dW, dH); } catch (er) { continue; }
                cx += dW + gap; filaH = Math.max(filaH, dH);
            }
        }
        return doc;
    }

    var api = { generar: generar, nombreArchivo: nombreArchivo };
    global.PdfRendicion = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
