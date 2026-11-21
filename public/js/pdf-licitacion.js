/**
 * pdf-licitacion.js — PDF de la propuesta de una licitación (general o detallada). UNA sola versión para la pantalla
 * (licitaciones.html, jsPDF del navegador) y el servidor (functions/documentos, para Kay por WhatsApp).
 * Copia idéntica en functions/pdf/compartido/pdf-licitacion.js (tools/documentos: "npm run sincronizar").
 *
 *   PdfLicitacion.generar({
 *     jsPDF,                       // constructor (con el plugin autoTable aplicado)
 *     lic, licKey, items, pName,   // licitación, su id, ítems del presupuesto y nombre del proyecto
 *     modo,                        // 'general' (tabla resumen) | 'detalle' (materiales y mano de obra por ítem)
 *     fecha,                       // texto de la fecha (ej. "20/11/2026")
 *     cargarImagen(url),           // → Promise<dataURL | null>
 *     dimensiones(dataURL),        // → Promise<{w, h}>
 *     logoUrl, artes               // logo de la portada; artes gráficas por ítem (solo la pantalla las tiene cargadas)
 *   }) → Promise<jsPDF>
 *   PdfLicitacion.nombreArchivo(pName, licKey, modo) → "propuesta_general_<proyecto>_<id>.pdf"
 */
(function (global) {
    'use strict';

    function getValidObjects(obj) { if (!obj) return []; return Object.values(obj).filter(function (x) { return x != null && typeof x === 'object'; }); }
    var fM = function (n) { return parseFloat(n || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var cleanTxt = function (s) { return String(s || '').replace(/[\u{1F000}-\u{1FFFF}]/gu, '').trim(); };
    var lista = function (x) { return Array.isArray(x) ? x : Object.values(x || {}); };

    function nombreArchivo(pName, licKey, modo) {
        var safeName = String(pName || '').replace(/[^a-zA-Z0-9\-_]/g, '_').substring(0, 30);
        var sufijo = modo === 'detalle' ? 'detallada' : 'general';
        return 'propuesta_' + sufijo + '_' + safeName + '_' + String(licKey || '').slice(-6) + '.pdf';
    }

    async function generar(o) {
        var modo = o.modo || 'general';
        var lic = o.lic, pName = o.pName || '', allPItems = o.items || {};
        var artes = o.artes || {};
        var cargarImagen = o.cargarImagen || function () { return Promise.resolve(null); };
        var dimensiones = o.dimensiones || function () { return Promise.resolve({ w: 800, h: 600 }); };
        if (!lic || !lic.tareas) throw new Error('No hay datos de esta licitación.');
        var doc = new o.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        var W = 210, mL = 14, mR = 14, usableW = W - mL - mR;

        // ── Agrupar tareas por originIdx ──
        var groupOrder = [], groups = {};
        Object.values(lic.tareas).forEach(function (t) {
            if (!t) return;
            var k = (t.originIdx != null) ? String(t.originIdx) : '_' + String(t.task_name || '').slice(0, 8);
            if (!groups[k]) {
                var it = (t.originIdx != null) ? (allPItems[t.originIdx] || null) : null;
                groups[k] = { idx: t.originIdx, label: t.parent_desc || t.task_name || 'Ítem', subtotal: 0, item: it, imgs: [], tareas: [], fechaEntrega: '' };
                groupOrder.push(k);
            }
            groups[k].subtotal += parseFloat(t.subtotal || 0);
            groups[k].tareas.push(t);
            if (!groups[k].fechaEntrega && t.fecha_entrega && t.fecha_entrega !== 'Sin fecha') groups[k].fechaEntrega = t.fecha_entrega;
        });

        // Recolectar imágenes de producción por ítem
        groupOrder.forEach(function (k) {
            var g = groups[k], seen = new Set();
            var addImg = function (u) { if (u && typeof u === 'string' && !seen.has(u)) { seen.add(u); g.imgs.push(u); } };
            g.tareas.forEach(function (t) {
                addImg(t.img);
                if (t.op_images) lista(t.op_images).forEach(addImg);
                if (t.cortes) lista(t.cortes).forEach(addImg);
            });
            var it = g.item;
            if (it) {
                addImg(it.img);
                if (it.op_images) lista(it.op_images).forEach(addImg);
                if (it.cortes) lista(it.cortes).forEach(addImg);
                if (it.prod_apu && it.prod_apu.mat) lista(it.prod_apu.mat).forEach(function (m) { if (m && m.corte_url) addImg(m.corte_url); });
            }
            if (artes[k]) (artes[k] || []).forEach(function (art) { if (art.imgRef) addImg(art.imgRef); });
        });

        var calcTotal = groupOrder.reduce(function (s, k) { return s + groups[k].subtotal; }, 0);
        var totalFinal = parseFloat(lic.precio_propuesto || lic.precio_final || calcTotal);
        var workerName = lic.worker_name || lic.worker_id || '';

        // ── Header azul (portada) ──
        var tituloPortada = modo === 'detalle' ? 'PROPUESTA DETALLADA' : 'PROPUESTA ECONÓMICA';
        doc.setFillColor(0, 122, 255); doc.rect(0, 0, W, 30, 'F');
        doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
        doc.text(tituloPortada, W / 2, 13, { align: 'center' });
        doc.setFontSize(9); doc.setFont('helvetica', 'normal');
        doc.text(cleanTxt(pName), W / 2, 21, { align: 'center' });
        doc.setTextColor(0, 0, 0);
        try { var logo = o.logoUrl ? await cargarImagen(o.logoUrl) : null; if (logo) doc.addImage(logo, 'PNG', W - mR - 22, 3, 24, 24); } catch (e) { /* sin logo */ }
        var yH = 38;
        if (workerName) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text('Contratista: ' + workerName, mL, yH); }
        doc.setFontSize(9); doc.text('Fecha: ' + (o.fecha || new Date().toLocaleDateString('es-BO')), W - mR, yH, { align: 'right' });

        // ════════════ MODO GENERAL — tabla resumen (1 fila por ítem) ════════════
        if (modo === 'general') {
            var rows = groupOrder.map(function (k, i) {
                var g = groups[k];
                var lbl = cleanTxt(g.label).substring(0, 90);
                var fe = g.fechaEntrega ? '   —   Entrega: ' + g.fechaEntrega : '';
                return [String(i + 1), lbl + fe, fM(g.subtotal) + ' Bs'];
            });
            doc.autoTable({
                startY: 44,
                head: [['#', 'Ítem / Descripción', 'Total']],
                body: rows,
                foot: [['', 'TOTAL', fM(totalFinal) + ' Bs']],
                theme: 'striped',
                headStyles: { fillColor: [0, 122, 255], textColor: 255, fontStyle: 'bold', fontSize: 10, cellPadding: 4 },
                footStyles: { fillColor: [20, 20, 20], textColor: 255, fontStyle: 'bold', fontSize: 11, cellPadding: 5 },
                columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 1: { cellWidth: 148 }, 2: { cellWidth: 24, halign: 'right', fontStyle: 'bold' } },
                styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
                margin: { left: mL, right: mR },
            });
        }

        // ════════════ MODO DETALLE — desglose costo por ítem ════════════
        var licMode = lic.lic_mode || o.licMode || 'mo';
        var isLlm = (licMode === 'llave_en_mano');
        var nombreDe = function (m) { return cleanTxt(isLlm ? (m.task_name || m.desc || '') : m.d); };
        if (modo === 'detalle') {
            var y = 44;
            var grandTotalMo = 0, grandTotalMat = 0;
            for (var gi = 0; gi < groupOrder.length; gi++) {
                var g = groups[groupOrder[gi]], it = g.item;
                var checkedMatIdxs = new Set(g.tareas.filter(function (t) { return t.originType === 'venta_mat'; }).map(function (t) { return t.originMatidx; }));
                var checkedMoIdxs = new Set(g.tareas.filter(function (t) { return t.originType === 'venta_mo'; }).map(function (t) { return t.originMoidx; }));
                var _apuMoArrFull = (it && it.apu && it.apu.mo) ? getValidObjects(it.apu.mo) : [];
                var _apuMatArrFull = (it && it.apu && it.apu.mat) ? getValidObjects(it.apu.mat) : [];
                var prodMo = it && it.prod_apu && it.prod_apu.mo ? lista(it.prod_apu.mo) : [];
                var prodMat = it && it.prod_apu && it.prod_apu.mat ? lista(it.prod_apu.mat) : [];
                var moSrc = isLlm
                    ? g.tareas.filter(function (t) { return t.originType === 'llm_mo'; })
                    : (prodMo.length > 0
                        ? (checkedMoIdxs.size > 0 ? prodMo.filter(function (m, i) { return checkedMoIdxs.has(i); }) : prodMo)
                        : (_apuMoArrFull.length > 0
                            ? (checkedMoIdxs.size > 0 ? _apuMoArrFull.filter(function (m, i) { return checkedMoIdxs.has(i); }) : _apuMoArrFull)
                            : []));
                var matSrc = isLlm
                    ? g.tareas.filter(function (t) { return t.originType === 'llm_mat'; })
                    : (prodMat.length > 0
                        ? (checkedMatIdxs.size > 0 ? prodMat.filter(function (m, i) { return checkedMatIdxs.has(i) && !m.es_arte; }) : prodMat.filter(function (m) { return !m.es_arte; }))
                        : (_apuMatArrFull.length > 0
                            ? (checkedMatIdxs.size > 0 ? _apuMatArrFull.filter(function (m, i) { return checkedMatIdxs.has(i) && m.d && !m.es_arte; }) : _apuMatArrFull.filter(function (m) { return m.d && !m.es_arte; }))
                            : []));

                // Nueva página si no cabe
                var minH = 14 + (matSrc.length + moSrc.length) * 5 + 20;
                if (y + minH > 270) {
                    doc.addPage();
                    doc.setFillColor(0, 122, 255); doc.rect(0, 0, W, 30, 'F');
                    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
                    doc.text('PROPUESTA DETALLADA (cont.)', W / 2, 13, { align: 'center' });
                    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
                    doc.text(cleanTxt(pName), W / 2, 21, { align: 'center' });
                    doc.setTextColor(0, 0, 0); y = 36;
                }

                // Cabecera del ítem
                var lblD = cleanTxt(g.label).substring(0, 85);
                doc.setFillColor(20, 20, 20); doc.rect(mL - 2, y, usableW + 4, 10, 'F');
                doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
                doc.text(lblD, mL, y + 7);
                doc.text(fM(g.subtotal) + ' Bs', W - mR, y + 7, { align: 'right' });
                doc.setTextColor(0, 0, 0); y += 14;

                // prod_apu ya tiene cant total; apu legacy usa cant por unidad → multiplicar
                var usandoProdApuPdf = prodMo.length > 0;
                var itemCant = usandoProdApuPdf ? 1 : parseFloat((it && it.cant) || 1);
                var filaDe = function (m) {
                    return [
                        nombreDe(m).substring(0, 55),
                        isLlm ? parseFloat(m.cant || 0).toFixed(2) : (parseFloat(m.q || 0) * itemCant).toFixed(2),
                        (isLlm ? m.und : m.u) || '',
                        fM(isLlm ? m.pu : m.p) + ' Bs',
                        fM(isLlm ? m.subtotal : parseFloat(m.q || 0) * itemCant * parseFloat(m.p || 0)) + ' Bs',
                    ];
                };
                var colsApu = { 0: { cellWidth: 85 }, 1: { cellWidth: 18, halign: 'right' }, 2: { cellWidth: 12 }, 3: { cellWidth: 22, halign: 'right' }, 4: { cellWidth: 25, halign: 'right' } };

                if (matSrc.length > 0) {
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(0, 100, 200);
                    doc.text('MATERIALES', mL, y); y += 3; doc.setTextColor(0, 0, 0);
                    doc.autoTable({
                        startY: y, head: [['Material', 'Cant.', 'U.', 'P.U.', 'Subtotal']], body: matSrc.map(filaDe), theme: 'plain',
                        headStyles: { fillColor: [230, 240, 255], fontSize: 7, cellPadding: 2, fontStyle: 'bold' }, columnStyles: colsApu,
                        styles: { fontSize: 7.5, cellPadding: 2, overflow: 'linebreak' }, margin: { left: mL, right: mR }, tableWidth: usableW,
                    });
                    y = doc.lastAutoTable.finalY + 3;
                }
                if (moSrc.length > 0) {
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(200, 100, 0);
                    doc.text('MANO DE OBRA', mL, y); y += 3; doc.setTextColor(0, 0, 0);
                    doc.autoTable({
                        startY: y, head: [['Actividad', 'Cant.', 'U.', 'P.U.', 'Subtotal']], body: moSrc.map(filaDe), theme: 'plain',
                        headStyles: { fillColor: [255, 245, 225], fontSize: 7, cellPadding: 2, fontStyle: 'bold' }, columnStyles: colsApu,
                        styles: { fontSize: 7.5, cellPadding: 2, overflow: 'linebreak' }, margin: { left: mL, right: mR }, tableWidth: usableW,
                    });
                    y = doc.lastAutoTable.finalY + 3;
                }
                if (!matSrc.length && !moSrc.length) {
                    // Fallback: tareas individuales
                    doc.autoTable({
                        startY: y, head: [['Trabajo', 'Und', 'Cant', 'P.U.', 'Subtotal']],
                        body: g.tareas.map(function (t) { return [cleanTxt(t.task_name || t.desc || '').substring(0, 65), t.und || 'u', parseFloat(t.cant || 0).toFixed(2), fM(t.pu) + ' Bs', fM(t.subtotal) + ' Bs']; }),
                        theme: 'plain', headStyles: { fillColor: [240, 240, 240], fontSize: 7, cellPadding: 2, fontStyle: 'bold' },
                        columnStyles: { 0: { cellWidth: 90 }, 1: { cellWidth: 12, halign: 'center' }, 2: { cellWidth: 16, halign: 'right' }, 3: { cellWidth: 24, halign: 'right' }, 4: { cellWidth: 20, halign: 'right' } },
                        styles: { fontSize: 7.5, cellPadding: 2 }, margin: { left: mL, right: mR }, tableWidth: usableW,
                    });
                    y = doc.lastAutoTable.finalY + 3;
                }

                // ── Subtotales por ítem ──
                var _calcSub = function (src) { return src.reduce(function (s, m) { return s + (isLlm ? parseFloat(m.subtotal || 0) : parseFloat(m.q || 0) * itemCant * parseFloat(m.p || 0)); }, 0); };
                var totalMoItem = _calcSub(moSrc);
                var totalMatItem = _calcSub(matSrc);
                grandTotalMo += totalMoItem;
                grandTotalMat += totalMatItem;
                if (moSrc.length > 0 || matSrc.length > 0) {
                    var rowH = 8;
                    doc.setFillColor(245, 245, 247); doc.rect(mL - 2, y, usableW + 4, rowH, 'F');
                    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(110, 110, 115);
                    var subX = mL + 3;
                    if (moSrc.length > 0) { doc.text('M.O.: ' + fM(totalMoItem) + ' Bs', subX, y + 5.5); subX += 55; }
                    if (matSrc.length > 0) doc.text('Mat.: ' + fM(totalMatItem) + ' Bs', subX, y + 5.5);
                    doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 20);
                    doc.text('TOTAL ÍTEM: ' + fM(totalMoItem + totalMatItem) + ' Bs', W - mR, y + 5.5, { align: 'right' });
                    doc.setTextColor(0, 0, 0);
                    y += rowH + 2;
                }
                y += 4;
            }

            // Pie con desglose MO / Mat / Total
            if (y + 34 > 272) { doc.addPage(); y = 20; }
            doc.setFillColor(255, 245, 225); doc.rect(mL - 2, y, usableW + 4, 9, 'F');
            doc.setDrawColor(210, 210, 215); doc.setLineWidth(0.2);
            doc.rect(mL - 2, y, usableW + 4, 9, 'S');
            doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(160, 80, 0);
            doc.text('TOTAL MANO DE OBRA', mL + 2, y + 6.5);
            doc.text(fM(grandTotalMo) + ' Bs', W - mR, y + 6.5, { align: 'right' });
            y += 9;
            doc.setFillColor(230, 240, 255); doc.rect(mL - 2, y, usableW + 4, 9, 'F');
            doc.rect(mL - 2, y, usableW + 4, 9, 'S');
            doc.setTextColor(0, 70, 160);
            doc.text('TOTAL MATERIALES', mL + 2, y + 6.5);
            doc.text(fM(grandTotalMat) + ' Bs', W - mR, y + 6.5, { align: 'right' });
            y += 9;
            doc.setFillColor(20, 20, 20); doc.rect(mL - 2, y, usableW + 4, 13, 'F');
            doc.setTextColor(255, 255, 255); doc.setFontSize(12);
            doc.text('TOTAL GENERAL', mL + 2, y + 9.5);
            doc.text(fM(totalFinal) + ' Bs', W - mR, y + 9.5, { align: 'right' });
            doc.setTextColor(0, 0, 0);
        }

        // ════════════ ANEXOS — ítem por ítem: descripción + materiales + imágenes ════════════
        for (var ai = 0; ai < groupOrder.length; ai++) {
            var ga = groups[groupOrder[ai]], ita = ga.item;
            var moSrcA = isLlm ? ga.tareas.filter(function (t) { return t.originType === 'llm_mo'; }) : ((ita && ita.prod_apu && ita.prod_apu.mo) ? lista(ita.prod_apu.mo) : []);
            var matSrcA = isLlm ? ga.tareas.filter(function (t) { return t.originType === 'llm_mat'; }) : ((ita && ita.prod_apu && ita.prod_apu.mat) ? lista(ita.prod_apu.mat).filter(function (m) { return !m.es_arte; }) : []);
            var featTxt = ita && ita.feat ? cleanTxt(ita.feat) : '';
            var lblItem = cleanTxt(ga.label).substring(0, 85);
            var uniqueImgs = ga.imgs.slice(0, 10);
            if (!(featTxt || matSrcA.length || moSrcA.length || uniqueImgs.length)) continue;

            doc.addPage();
            doc.setFillColor(20, 20, 20); doc.rect(0, 0, W, 18, 'F');
            doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
            doc.text(lblItem, mL, 11);
            doc.text(fM(ga.subtotal) + ' Bs', W - mR, 11, { align: 'right' });
            if (ga.fechaEntrega) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text('Entrega: ' + ga.fechaEntrega, mL, 16); }
            doc.setTextColor(0, 0, 0);
            var ya = 25;

            if (featTxt) {
                doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0, 100, 200);
                doc.text('DESCRIPCIÓN', mL, ya); ya += 5; doc.setTextColor(0, 0, 0);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
                var lines = doc.splitTextToSize(featTxt, usableW);
                var maxL = Math.min(lines.length, 18);
                doc.text(lines.slice(0, maxL), mL, ya);
                ya += maxL * 5 + 5;
            }
            var listaRecursos = function (titulo, color, src) {
                if (!src.length) return;
                if (ya > 248) { doc.addPage(); ya = 14; }
                doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(color[0], color[1], color[2]);
                doc.text(titulo, mL, ya); ya += 5; doc.setTextColor(0, 0, 0);
                src.forEach(function (m) {
                    if (ya > 265) { doc.addPage(); ya = 14; }
                    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
                    var mName = nombreDe(m).substring(0, 56);
                    var mCant = parseFloat((isLlm ? m.cant : m.q) || 0).toFixed(2);
                    var mUnd = (isLlm ? m.und : m.u) || '';
                    doc.text('•  ' + mName + '   ×   ' + mCant + ' ' + mUnd, mL + 3, ya);
                    ya += 5.5;
                });
                ya += 4;
            };
            listaRecursos('MATERIALES REQUERIDOS', [0, 100, 200], matSrcA);
            listaRecursos('MANO DE OBRA', [200, 100, 0], moSrcA);

            // ── Imágenes de producción ──
            for (var ii = 0; ii < uniqueImgs.length; ii++) {
                var imgData = null;
                try { imgData = await cargarImagen(uniqueImgs[ii]); } catch (e) { imgData = null; }
                if (!imgData) continue;
                var dims = { w: 800, h: 600 };
                try { dims = await dimensiones(imgData); } catch (e) { /* tamaño por defecto */ }
                var maxH = Math.min(297 - ya - 20, 140);
                if (maxH < 35) {
                    doc.addPage();
                    doc.setFillColor(20, 20, 20); doc.rect(0, 0, W, 14, 'F');
                    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
                    doc.text(lblItem, W / 2, 9.5, { align: 'center' });
                    doc.setTextColor(0, 0, 0);
                    ya = 18;
                }
                var maxH2 = Math.min(297 - ya - 16, 200);
                var scale = Math.min(usableW / dims.w, maxH2 / dims.h);
                var dW = dims.w * scale, dH = dims.h * scale;
                var iX = mL + (usableW - dW) / 2;
                var fmt = imgData.startsWith('data:image/png') ? 'PNG' : 'JPEG';
                try { doc.addImage(imgData, fmt, iX, ya, dW, dH); }
                catch (e) { try { doc.addImage(imgData, 'PNG', iX, ya, dW, dH); } catch (e2) { continue; } }
                // Badge precio
                var bW = 56, bH = 11;
                doc.setFillColor(0, 0, 0); doc.roundedRect(iX + dW - bW, ya + dH - bH, bW, bH, 2, 2, 'F');
                doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
                doc.text(fM(ga.subtotal) + ' Bs', iX + dW - bW / 2, ya + dH - bH + 7.5, { align: 'center' });
                doc.setTextColor(0, 0, 0);
                ya += dH + 7;
            }
        }
        return doc;
    }

    var api = { generar: generar, nombreArchivo: nombreArchivo };
    global.PdfLicitacion = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
