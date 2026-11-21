/**
 * pdf-cotizacion.js — PDF del presupuesto/cotización para el cliente. UNA sola versión para la pantalla (presupuesto.html,
 * jsPDF del navegador) y el servidor (functions/documentos, para Kay por WhatsApp).
 * Copia idéntica en functions/pdf/compartido/pdf-cotizacion.js (tools/documentos: "npm run sincronizar").
 *
 *   PdfCotizacion.generar({
 *     jsPDF,                         // constructor (con el plugin autoTable aplicado)
 *     modo,                          // 'normal' (PRESUPUESTO MAESTRO, vertical) | 'impuestos_por_item' (horizontal, IVA e IT por ítem)
 *     pres,                          // proyectos/{cid}/{pid}/presupuesto: {items, fecha, impuestos, descuento, descuento_pct, cond}
 *     montoCierre, proyecto, cliente, fechaHoy,
 *     logo,                          // dataURL JPEG del logo (o null)
 *     cargarImagen(url),             // → Promise<dataURL JPEG | null> (anexo fotográfico y planos)
 *   }) → Promise<jsPDF>
 *   PdfCotizacion.nombreArchivo({proyecto, cliente, modo, fecha: Date}) → "MMDD_PROYECTO_CLIENTE[_CON_IMP].pdf"
 *   PdfCotizacion.membrete(doc, logo) → logo arriba y pie de Rubik en todas las páginas (también lo usan otros PDF del presupuesto)
 */
(function (global) {
    'use strict';

    function fMoney(num) { return parseFloat(num || 0).toLocaleString('es-BO', {minimumFractionDigits: 2, maximumFractionDigits: 2}); }
    function stripZeros(num) { return Math.round((parseFloat(String(num).replace(',', '.')) || 0) * 100) / 100; }
    var lista = function (x) { return (Array.isArray(x) ? x : Object.keys(x || {}).sort(function (a, b) { return Number(a) - Number(b); }).map(function (k) { return x[k]; })).filter(Boolean); };

    function _pdfCeldaDesc(doc) {
        const esDesc = d => d.section === 'body' && d.cell.raw && typeof d.cell.raw === 'object' && d.cell.raw._type === 'item_desc';
        const pad = (st, lado) => { const p = st.cellPadding; return typeof p === 'number' ? p : ((p && p[lado]) || 0); };
        return {
            didParseCell: function(d) {
                if (!esDesc(d)) return;
                const raw = d.cell.raw, st = d.cell.styles, fs = st.fontSize || 10;
                const ancho = (typeof st.cellWidth === 'number' ? st.cellWidth : 90) - pad(st, 'left') - pad(st, 'right') - 0.5;
                const titulo = String(raw._title || '-');
                let resto = String(raw.content || '');
                if (resto.indexOf(titulo) === 0) resto = resto.slice(titulo.length);
                const lineas = resto.split('\n').map(l => l.trim()).filter(Boolean);
                doc.setFontSize(fs);
                doc.setFont(undefined, 'bold');   const tit = doc.splitTextToSize(titulo, ancho);
                doc.setFont(undefined, 'normal'); const cuerpo = [];
                lineas.forEach(l => cuerpo.push.apply(cuerpo, doc.splitTextToSize(l, ancho)));
                raw._tit = tit; raw._cuerpo = cuerpo;
                d.cell.text = tit.concat(cuerpo);   // con esto autoTable calcula la altura de la fila
            },
            willDrawCell: function(d) { if (esDesc(d)) d.cell.text = []; },   // el texto lo dibuja didDrawCell
            didDrawCell: function(d) {
                if (!esDesc(d) || !d.cell.raw._tit) return;
                const raw = d.cell.raw, fs = d.cell.styles.fontSize || 10;
                const lh = fs * doc.getLineHeightFactor() / doc.internal.scaleFactor;
                const pl = typeof d.cell.padding === 'function' ? d.cell.padding('left') : 3;
                const pt = typeof d.cell.padding === 'function' ? d.cell.padding('top') : 3;
                let y = d.cell.y + pt; const x = d.cell.x + pl;
                doc.setFontSize(fs); doc.setTextColor(0, 0, 0);
                doc.setFont(undefined, 'bold');   raw._tit.forEach(l => { doc.text(l, x, y, { baseline: 'top' }); y += lh; });
                doc.setFont(undefined, 'normal'); raw._cuerpo.forEach(l => { doc.text(l, x, y, { baseline: 'top' }); y += lh; });
            }
        };
    }

    function _pdfSinCapitulosVacios(rows) {
        return rows.filter((r, i) => {
            const c = r[0];
            if (!(c && typeof c === 'object' && c._cap)) return true;
            const sig = rows[i + 1];
            return !!sig && !!(sig[0] && typeof sig[0] === 'object' && sig[0]._type === 'item_desc');
        });
    }

    function _pdfAddMembrete(doc, logoB64) {
        const pageW  = doc.internal.pageSize.getWidth();
        const pageH  = doc.internal.pageSize.getHeight();
        const n      = doc.internal.getNumberOfPages();
        const isLand = pageW > pageH;
        const lw = isLand ? 30 : 26;  // ancho logo
        const lh = isLand ? 14 : 12;  // alto logo
        const footY  = pageH - 8;

        for (let i = 1; i <= n; i++) {
            doc.setPage(i);
            // ── Logo esquina superior derecha ──
            if (logoB64) {
                try { doc.addImage(logoB64, 'JPEG', pageW - lw - 10, 5, lw, lh); } catch(e) {}
            }
            // ── Línea separadora roja ──
            doc.setDrawColor(220, 31, 31);
            doc.setLineWidth(0.45);
            doc.line(14, footY - 6, pageW - 14, footY - 6);
            // ── Texto del pie ──
            doc.setFontSize(7);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(100, 100, 100);
            doc.text(
                'Renzo  |  Rubik Corp.   ·   Rubik Bolivia — Ingenieria Creativa   ·   +591 76868833   ·   rubikbolivia.com',
                14, footY
            );
            doc.text(`${i} / ${n}`, pageW - 14, footY, { align: 'right' });
            // reset
            doc.setTextColor(0, 0, 0);
            doc.setLineWidth(0.2);
            doc.setDrawColor(0, 0, 0);
        }
    }

    function nombreArchivo(o) {
        var dDate = o.fecha instanceof Date ? o.fecha : new Date();
        var mm = String(dDate.getMonth() + 1).padStart(2, '0'); var dd = String(dDate.getDate()).padStart(2, '0');
        var safeProName = String(o.proyecto || 'PROYECTO').toUpperCase().replace(/\n/g, ' ').replace(/[^a-zA-Z0-9_\- ]/g, "").trim().replace(/ /g, '_');
        var safeCliName = String(o.cliente || 'CLIENTE').toUpperCase().replace(/\n/g, ' ').replace(/[^a-zA-Z0-9_\- ]/g, "").trim().replace(/ /g, '_');
        return mm + dd + '_' + safeProName + '_' + safeCliName + (o.modo === 'impuestos_por_item' ? '_CON_IMP' : '') + '.pdf';
    }

    async function normal(o) {
        const jsPDF = o.jsPDF, pres = o.pres || {}, cond = pres.cond || {}, items = lista(pres.items);
        const montoCierre = parseFloat(o.montoCierre) || 0, logoB64 = o.logo || null;
        const cargarImagen = o.cargarImagen || function () { return Promise.resolve(null); };
        const doc = new jsPDF();
            doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.text("PRESUPUESTO MAESTRO", 14, 20); 
            doc.setFontSize(10); doc.setFont(undefined, 'normal');
            
            let pNameStr = (o.proyecto || 'PROYECTO').toUpperCase().replace(/\n/g, ' '); 
            let cNameStr = (o.cliente || 'CLIENTE').toUpperCase().replace(/\n/g, ' ');
            let dateStrVal = pres.fecha || o.fechaHoy || new Date().toLocaleDateString();

            doc.text(`Cliente: ${cNameStr}`, 14, 30); doc.text(`Proyecto: ${pNameStr}`, 14, 35); doc.text(`Fecha: ${dateStrVal}`, 14, 40);
            
            const rows = []; const anexos = []; let subtotal = 0;
            
            items.forEach(item => {
                if(item.type === 'chapter') { 
                    let chapName = (item.name || 'CAPÍTULO').toUpperCase();
                    rows.push([{content: chapName, colSpan: 5, _cap: true, styles: {fillColor: [220,220,220], fontStyle:'bold'}}]); 
                } 
                else {
                    // Saltar ítems inactivos (ojito apagado)
                    if(item.activo === false) return;
                    let desc = item.desc || '-';
                    if(item.feat) { const lineas = item.feat.split('\n'); lineas.forEach(linea => { const t = linea.trim().replace(/^[-–•*]+\s*/, ''); if(t) desc += `\n• ${t}`; }); }
                    if(item.img) anexos.push({ desc: (item.desc || 'Item') + " (Ref)", img: item.img });
                    if(item.cortes && Array.isArray(item.cortes)) item.cortes.forEach((c, idx) => anexos.push({ desc: (item.desc || 'Item') + ` (Corte Ppal ${idx+1})`, img: c }));
                    if(item.apu) { ['mat', 'sub', 'mo', 'eq'].forEach(t => { if(item.apu[t] && Array.isArray(item.apu[t])) { item.apu[t].forEach(mat => { if(mat.corte_url) anexos.push({ desc: (item.desc || 'Item') + ` - Plano: ${mat.d || ''}`, img: mat.corte_url }); }); } }); }

                    let cant = stripZeros(item.cant); let pu = stripZeros(item.pu); const totalItem = cant * pu; subtotal += totalItem;
                    rows.push([{content: desc, _type:'item_desc', _title: item.desc||'-'}, item.und || 'glb', cant, fMoney(pu), fMoney(totalItem)]);
                }
            });

            if (typeof doc.autoTable !== 'function') throw new Error("La librería de Tablas no cargó.");

            const _desc1 = _pdfCeldaDesc(doc);
            doc.autoTable({ startY: 45, head: [['Descripción', 'Und', 'Cant', 'P.U. (Bs)', 'Total (Bs)']], body: _pdfSinCapitulosVacios(rows),
                styles: { cellPadding: 3, fontSize: 9 }, margin: { top: 20, bottom: 22 }, rowPageBreak: 'avoid',
                columnStyles: { 0: { cellWidth: 97 }, 1: { cellWidth: 16, halign: 'center' }, 2: { cellWidth: 14, halign: 'center' }, 3: { cellWidth: 26, halign: 'right' }, 4: { cellWidth: 28, halign: 'right' } },
                didParseCell: _desc1.didParseCell, willDrawCell: _desc1.willDrawCell, didDrawCell: _desc1.didDrawCell
            });
            const descPct = parseFloat(pres.descuento_pct) || 0;
            const descVal = Math.round(subtotal * descPct / 100 * 100) / 100;
            const base = subtotal - descVal;
            const conImp = !!pres.impuestos;
            // Calcular espacio necesario para el bloque de totales + condiciones
            const _espacioTotal = 10 + 5 + (descVal>0?5:0) + (conImp?10:0) + (montoCierre>0?18:12) + 30;
            let finalY = doc.lastAutoTable.finalY + 5;
            // Si no cabe el bloque completo en la página actual, agregar fila de total a la tabla misma
            // usando una fila especial, y luego continuar en nueva página solo si hay imágenes
            const _limite = doc.internal.pageSize.getHeight() - 22;   // el pie de página ocupa los últimos ~16 mm
            if (finalY + _espacioTotal > _limite) {
                // Agregar el total como última fila de la tabla en la página actual
                doc.autoTable({
                    startY: finalY,
                    body: [
                        [{ content: '', colSpan: 3 },
                         { content: 'Subtotal:', styles: { halign: 'right', fontStyle: 'bold' } },
                         { content: fMoney(subtotal) + ' Bs', styles: { halign: 'right', fontStyle: 'bold' } }],
                        ...(descVal > 0 ? [[{ content: '', colSpan: 3 },
                         { content: (descPct > 0 ? descPct + '% Descuento:' : 'Descuento:'), styles: { halign: 'right' } },
                         { content: '- ' + fMoney(descVal) + ' Bs', styles: { halign: 'right' } }]] : []),
                        ...(conImp ? [
                            [{ content: '', colSpan: 3 },
                             { content: 'IVA (13%):', styles: { halign: 'right' } },
                             { content: fMoney(base*0.13) + ' Bs', styles: { halign: 'right' } }],
                            [{ content: '', colSpan: 3 },
                             { content: 'IT (3%):', styles: { halign: 'right' } },
                             { content: fMoney(base*0.03) + ' Bs', styles: { halign: 'right' } }]
                        ] : []),
                        [{ content: '', colSpan: 3 },
                         { content: montoCierre > 0 ? 'PRECIO NEGOCIADO:' : 'TOTAL FINAL:', styles: { halign: 'right', fontStyle: 'bold', fontSize: 11, textColor: montoCierre > 0 ? [34,139,34] : [0,0,200] } },
                         { content: fMoney(montoCierre > 0 ? montoCierre : (conImp ? base*1.16 : subtotal)) + ' Bs', styles: { halign: 'right', fontStyle: 'bold', fontSize: 11, textColor: montoCierre > 0 ? [34,139,34] : [0,0,200] } }]
                    ],
                    theme: 'plain',
                    styles: { fontSize: 9, cellPadding: 2 },
                    columnStyles: { 0:{cellWidth:70}, 1:{cellWidth:15}, 2:{cellWidth:15}, 3:{cellWidth:45}, 4:{cellWidth:40} }
                });
                finalY = doc.lastAutoTable.finalY + 8;
            } else {
                finalY += 5;
                doc.setFontSize(9); doc.setFont(undefined, 'normal');
                doc.text(`Subtotal:`, 140, finalY); doc.text(`${fMoney(subtotal)} Bs`, 195, finalY, {align:'right'}); finalY += 5;
                if(descVal > 0) { doc.text(descPct > 0 ? descPct + '% Descuento:' : 'Descuento:', 140, finalY); doc.text(`- ${fMoney(descVal)} Bs`, 195, finalY, {align:'right'}); finalY += 5; }
                if(conImp) { doc.text(`IVA (13%):`, 140, finalY); doc.text(`${fMoney(base*0.13)} Bs`, 195, finalY, {align:'right'}); finalY += 5; doc.text(`IT (3%):`, 140, finalY); doc.text(`${fMoney(base*0.03)} Bs`, 195, finalY, {align:'right'}); finalY += 5; }
                if(montoCierre > 0) {
                    // Caja verde destacada para precio negociado
                    doc.setFillColor(34, 139, 34);
                    doc.rect(130, finalY - 1, 65, 9, 'F');
                    doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.setTextColor(255, 255, 255);
                    doc.text(`PRECIO NEGOCIADO:`, 132, finalY + 5);
                    doc.text(`${fMoney(montoCierre)} Bs`, 193, finalY + 5, {align:'right'});
                    doc.setTextColor(0, 0, 0); finalY += 12;
                } else {
                    doc.setFontSize(11); doc.setFont(undefined, 'bold');
                    doc.setFillColor(0, 0, 200); doc.rect(130, finalY - 1, 65, 9, 'F');
                    doc.setTextColor(255,255,255);
                    doc.text(`TOTAL FINAL:`, 132, finalY + 5);
                    doc.text(`${fMoney(conImp ? base*1.16 : subtotal)} Bs`, 193, finalY + 5, {align:'right'});
                    doc.setTextColor(0,0,0); finalY += 12;
                }
            }

            // Condiciones: nunca debajo del pie de página
            const _lineasCond = [`• Pago: ${cond.pago || '-'}`, `• Validez: ${cond.validez || '-'}`];
            if(!!cond.montaje) _lineasCond.push(`• Incluye Montaje`);
            if(!!cond.desmontaje) _lineasCond.push(`• Incluye Desmontaje`);
            if (finalY + 7 + _lineasCond.length * 5 > _limite) { doc.addPage(); finalY = 25; }
            doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.text("CONDICIONES:", 14, finalY); finalY+=7; doc.setFontSize(9); doc.setFont(undefined, 'normal');
            _lineasCond.forEach(l => { doc.text(l, 14, finalY); finalY += 5; });

            if(anexos.length > 0) {
                doc.addPage(); doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.text("ANEXO FOTOGRÁFICO Y PLANOS", 14, 20); let py = 30;
                for(let i=0; i<anexos.length; i++) {
                    let it = anexos[i]; if(py > 200) { doc.addPage(); py = 20; }
                    doc.setDrawColor(200); doc.rect(14, py, 180, 100); doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.text(`${i+1}. ${it.desc}`, 16, py+10);
                    try { let b64 = await cargarImagen(it.img); if(b64) { const ratio = doc.getImageProperties(b64).width / doc.getImageProperties(b64).height; let w = 160, h = w / ratio; if(h > 80) { h = 80; w = h * ratio; } doc.addImage(b64, 'JPEG', 14 + (180-w)/2, py + 15 + (85-h)/2, w, h); } } catch(e){} py += 110;
                }
            }
        _pdfAddMembrete(doc, logoB64);
        return doc;
    }

    async function impuestosPorItem(o) {
        const jsPDF = o.jsPDF, pres = o.pres || {}, cond = pres.cond || {}, items = lista(pres.items);
        const logoB64 = o.logo || null;
        const cargarImagen = o.cargarImagen || function () { return Promise.resolve(null); };
        // A4 landscape = 297 x 210 mm  (margins: left 14, right 14 → usable 269mm)
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            // Thin accent line under header area
            doc.setDrawColor(30, 58, 95); doc.setLineWidth(0.5);
            doc.line(14, 42, 283, 42);

            doc.setFontSize(15); doc.setFont(undefined, 'bold'); doc.setTextColor(30, 58, 95);
            doc.text("PRESUPUESTO CON IMPUESTOS", 14, 17);
            doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(60, 60, 60);

            let pNameStr = (o.proyecto || 'PROYECTO').toUpperCase().replace(/\n/g, ' ');
            let cNameStr = (o.cliente || 'CLIENTE').toUpperCase().replace(/\n/g, ' ');
            let dateStrVal = pres.fecha || o.fechaHoy || new Date().toLocaleDateString();

            doc.text(`Cliente: ${cNameStr}`, 14, 25);
            doc.text(`Proyecto: ${pNameStr}`, 14, 31);
            doc.text(`Fecha: ${dateStrVal}`, 14, 37);
            doc.setTextColor(0, 0, 0); // reset

            // ── Build rows ───────────────────────────────────────────────────
            const IVA_RATE = 0.13;
            const IT_RATE = 0.03;

            const rows = [];
            const anexos = [];
            let sumTotal = 0, sumIVA = 0, sumIT = 0, sumConImp = 0;

            items.forEach(item => {
                if (item.type === 'chapter') {
                    let chapName = (item.name || 'CAPÍTULO').toUpperCase();
                    rows.push([{
                        content: chapName, colSpan: 8, _cap: true,
                        styles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold', fontSize: 7.5 }
                    }]);
                } else {
                    if (item.activo === false) return;
                    let _descTitle = item.desc || '-';
                    let desc = _descTitle;
                    if (item.feat) {
                        const lineas = item.feat.split('\n');
                        lineas.forEach(l => { const t = l.trim().replace(/^[-–•*]+\s*/, ''); if (t) desc += `\n• ${t}`; });
                    }
                    // Recolectar imágenes — igual que exportPDF()
                    if (item.img) anexos.push({ desc: (item.desc || 'Item') + " (Ref)", img: item.img });
                    if (item.cortes && Array.isArray(item.cortes)) {
                        item.cortes.forEach((c, idx) => anexos.push({ desc: (item.desc || 'Item') + ` (Corte Ppal ${idx+1})`, img: c }));
                    }
                    if (item.apu) {
                        ['mat', 'sub', 'mo', 'eq'].forEach(t => {
                            if (item.apu[t] && Array.isArray(item.apu[t])) {
                                item.apu[t].forEach(mat => { if (mat.corte_url) anexos.push({ desc: (item.desc || 'Item') + ` - Plano: ${mat.d || ''}`, img: mat.corte_url }); });
                            }
                        });
                    }

                    const cant = stripZeros(item.cant);
                    const pu   = stripZeros(item.pu);
                    const total   = cant * pu;
                    const iva     = total * IVA_RATE;
                    const it      = total * IT_RATE;
                    const conImp  = total + iva + it;

                    sumTotal  += total;
                    sumIVA    += iva;
                    sumIT     += it;
                    sumConImp += conImp;

                    rows.push([
                        {content: desc, _type:'item_desc', _title: _descTitle},
                        item.und || 'glb',
                        cant,
                        fMoney(pu),
                        // col 4: separator antes de impuestos — borde izquierdo grueso via didDrawCell
                        fMoney(total),
                        fMoney(iva),
                        fMoney(it),
                        { content: fMoney(conImp), styles: { fontStyle: 'bold', textColor: [0, 110, 0] } }
                    ]);
                }
            });

            // Fila de totales al final
            rows.push([
                { content: 'TOTALES', colSpan: 4, styles: { fontStyle: 'bold', halign: 'right', fillColor: [235, 240, 250], textColor: [30, 58, 95] } },
                { content: fMoney(sumTotal), styles: { fontStyle: 'bold', fillColor: [235, 240, 250] } },
                { content: fMoney(sumIVA),   styles: { fontStyle: 'bold', fillColor: [235, 240, 250] } },
                { content: fMoney(sumIT),    styles: { fontStyle: 'bold', fillColor: [235, 240, 250] } },
                { content: fMoney(sumConImp), styles: { fontStyle: 'bold', textColor: [0, 100, 0], fillColor: [210, 245, 220] } }
            ]);

            if (typeof doc.autoTable !== 'function') throw new Error("La librería de Tablas no cargó.");

            // Anchuras: 14 + 85 + 15 + 18 + 28 + 30 + 25 + 22 + 31 + 14 = 282 ✓ (269mm usable)
            const _desc2 = _pdfCeldaDesc(doc);
            doc.autoTable({
                startY: 45,
                margin: { top: 20, left: 14, right: 14, bottom: 22 },
                head: [[
                    { content: 'Descripción' },
                    { content: 'Und', styles: { halign: 'center' } },
                    { content: 'Cant', styles: { halign: 'center' } },
                    { content: 'P.U. (Bs)', styles: { halign: 'right' } },
                    { content: 'Total (Bs)', styles: { halign: 'right' } },
                    { content: 'IVA 13%', styles: { halign: 'right' } },
                    { content: 'IT 3%',   styles: { halign: 'right' } },
                    { content: 'Total c/Imp', styles: { halign: 'right' } }
                ]],
                body: _pdfSinCapitulosVacios(rows),
                styles: {
                    cellPadding: { top: 2, bottom: 2, left: 3, right: 3 },
                    fontSize: 7,
                    lineColor: [210, 215, 225],
                    lineWidth: 0.2
                },
                headStyles: {
                    fillColor: [30, 58, 95],
                    textColor: 255,
                    fontStyle: 'bold',
                    fontSize: 7.5,
                    lineWidth: 0
                },
                alternateRowStyles: { fillColor: [248, 250, 252] },
                columnStyles: {
                    0: { cellWidth: 88 },
                    1: { cellWidth: 15, halign: 'center' },
                    2: { cellWidth: 18, halign: 'center' },
                    3: { cellWidth: 28, halign: 'right' },
                    // col 4 = Total — tiene borde izquierdo de separación
                    4: { cellWidth: 30, halign: 'right' },
                    5: { cellWidth: 25, halign: 'right' },
                    6: { cellWidth: 22, halign: 'right' },
                    // col 7 = Total c/Imp — columna destacada
                    7: { cellWidth: 33, halign: 'right', fillColor: [245, 255, 248] }
                },
                // Separador visual entre "Total" y bloque de impuestos, y antes de "Total c/Imp"
                rowPageBreak: 'avoid',
                didParseCell: function(d) { _desc2.didParseCell(d); },
                willDrawCell: function(d) { _desc2.willDrawCell(d); },
                didDrawCell: function(d) {
                    _desc2.didDrawCell(d);   // título en negrita + viñetas (col 0)
                    if (d.section === 'body' || d.section === 'head') {
                        // Línea azul sutil a la izquierda de col 4 (Total) — separa datos base de impuestos
                        if (d.column.index === 4) {
                            doc.setDrawColor(100, 130, 180);
                            doc.setLineWidth(0.5);
                            doc.line(d.cell.x, d.cell.y, d.cell.x, d.cell.y + d.cell.height);
                        }
                        // Línea verde sutil a la izquierda de col 7 (Total c/Imp)
                        if (d.column.index === 7) {
                            doc.setDrawColor(40, 160, 80);
                            doc.setLineWidth(0.6);
                            doc.line(d.cell.x, d.cell.y, d.cell.x, d.cell.y + d.cell.height);
                        }
                    }
                }
            });

            // ── Condiciones (igual que exportPDF) ───────────────────────────
            let finalY = doc.lastAutoTable.finalY + 8;
            if (finalY + 30 > doc.internal.pageSize.getHeight() - 22) { doc.addPage(); finalY = 25; }
            const descPct2 = parseFloat(pres.descuento_pct) || 0;
            const descVal = parseFloat(pres.descuento) || 0;

            doc.setFontSize(8); doc.setFont(undefined, 'normal');
            doc.text(`Subtotal:`, 200, finalY); doc.text(`${fMoney(sumTotal)} Bs`, 283, finalY, { align: 'right' }); finalY += 5;
            if (descVal > 0) { doc.text(descPct2 > 0 ? descPct2 + '% Descuento:' : 'Descuento:', 200, finalY); doc.text(`- ${fMoney(descVal)} Bs`, 283, finalY, { align: 'right' }); finalY += 5; }
            doc.text(`IVA (13%):`, 200, finalY); doc.text(`${fMoney(sumIVA)} Bs`, 283, finalY, { align: 'right' }); finalY += 5;
            doc.text(`IT (3%):`,   200, finalY); doc.text(`${fMoney(sumIT)} Bs`, 283, finalY, { align: 'right' }); finalY += 5;
            doc.setFontSize(9); doc.setFont(undefined, 'bold'); doc.setTextColor(0, 100, 0);
            doc.text(`TOTAL CON IMPUESTOS:`, 200, finalY + 2); doc.text(`${fMoney(sumConImp)} Bs`, 283, finalY + 2, { align: 'right' });
            doc.setTextColor(0, 0, 0); doc.setFont(undefined, 'normal'); doc.setFontSize(8);

            finalY += 12;
            // Condiciones: nunca debajo del pie de página (el pie ocupa los últimos ~16 mm)
            if (finalY + 6 + 4 * 5 > doc.internal.pageSize.getHeight() - 22) { doc.addPage(); finalY = 25; }
            doc.setFontSize(9); doc.setFont(undefined, 'bold'); doc.text("CONDICIONES:", 14, finalY); finalY += 6;
            doc.setFontSize(8); doc.setFont(undefined, 'normal');
            doc.text(`• Pago: ${cond.pago || '-'}`, 14, finalY); finalY += 5;
            doc.text(`• Validez: ${cond.validez || '-'}`, 14, finalY); finalY += 5;
            if (!!cond.montaje) { doc.text(`• Incluye Montaje`, 14, finalY); finalY += 5; }
            if (!!cond.desmontaje) { doc.text(`• Incluye Desmontaje`, 14, finalY); finalY += 5; }

            // ── Anexo fotográfico (idéntico a exportPDF) ─────────────────────
            if (anexos.length > 0) {
                doc.addPage();
                doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.setTextColor(30, 58, 95);
                doc.text("ANEXO FOTOGRÁFICO Y PLANOS", 14, 18);
                doc.setTextColor(0, 0, 0);
                // landscape usable: 269mm wide → imágenes pueden ser más anchas
                let py = 28;
                for (let i = 0; i < anexos.length; i++) {
                    let it = anexos[i];
                    if (py > 165) { doc.addPage(); py = 20; }
                    doc.setDrawColor(200); doc.setLineWidth(0.3);
                    doc.rect(14, py, 268, 120);
                    doc.setFontSize(9); doc.setFont(undefined, 'bold');
                    doc.text(`${i + 1}. ${it.desc}`, 16, py + 10);
                    try {
                        let b64 = await cargarImagen(it.img);
                        if (b64) {
                            const props = doc.getImageProperties(b64);
                            const ratio = props.width / props.height;
                            let w = 240, h = w / ratio;
                            if (h > 100) { h = 100; w = h * ratio; }
                            doc.addImage(b64, 'JPEG', 14 + (268 - w) / 2, py + 14 + (106 - h) / 2, w, h);
                        }
                    } catch (e) {}
                    py += 128;
                }
            }
        _pdfAddMembrete(doc, logoB64);
        return doc;
    }

    function generar(o) { return (o && o.modo === 'impuestos_por_item') ? impuestosPorItem(o) : normal(o); }

    var api = { generar: generar, nombreArchivo: nombreArchivo, membrete: _pdfAddMembrete };
    global.PdfCotizacion = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
