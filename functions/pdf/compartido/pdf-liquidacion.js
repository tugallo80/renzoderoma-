/**
 * pdf-liquidacion.js — "Liquidación de contrato" de una licitación: monto acordado, pagado (anticipos y pagos), saldo,
 * desglose técnico y comprobantes. UNA sola versión para la pantalla (compras.html del proyecto) y el servidor
 * (functions/documentos, para que Kay se la mande al contratista por WhatsApp).
 * Copia idéntica en functions/pdf/compartido/pdf-liquidacion.js (tools/documentos: "npm run sincronizar").
 *
 *   PdfLiquidacion.generar({
 *     jsPDF, lic, budgetItems,        // licitación y los ítems del presupuesto (para medidas e imágenes del anexo)
 *     proyecto, fecha, logo,          // logo: dataURL JPEG (o null)
 *     rendicion,                      // opcional: "estado" de functions/rendiciones de esta persona EN ESTE PROYECTO
 *     cargarImagen(url),              // → Promise<dataURL JPEG | null>   (anexo técnico)
 *     cargarComprobante(url),         // → Promise<dataURL | null>        (fotos de los comprobantes)
 *     dimensiones(dataURL),           // → Promise<{w, h}>
 *   }) → Promise<jsPDF>
 *   PdfLiquidacion.nombreArchivo(lic) → "Liquidacion_<Contratista>.pdf"
 */
(function (global) {
    'use strict';
    function fMoney(num) { return parseFloat(num || 0).toLocaleString('es-BO', {minimumFractionDigits: 2, maximumFractionDigits: 2}); }
    function nombreArchivo(lic) { return `Liquidacion_${((lic && lic.worker_name) || 'Contrato').replace(/ /g,'_')}.pdf`; }

    async function generar(ctx) {
        const jsPDF = ctx.jsPDF, lic = ctx.lic, budgetItems = ctx.budgetItems || [];
        if (!lic) throw new Error('No se encontró el contrato.');
        const doc = new jsPDF('p', 'mm', 'a4');
        const margin = 15;

        // Pagos ordenados cronológicamente
        const pagosArr = lic.pagos
            ? Object.values(lic.pagos).sort((a,b) => (a.fecha||'') > (b.fecha||'') ? 1 : -1)
            : [];
        // Contrato + extras (los extras agregados después también se le deben: antes no se sumaban)
        const extrasArr = lic.extras ? Object.values(lic.extras).filter(x => x && typeof x === 'object').sort((a,b) => (a.fecha||'') > (b.fecha||'') ? 1 : -1) : [];
        const contrato = parseFloat(lic.precio_final || lic.precio_propuesto || 0);
        const totalExtras = extrasArr.reduce((s,x) => s + parseFloat(x.monto||0), 0);
        let totalProp = contrato + totalExtras;
        let totalPagado = pagosArr.reduce((s,p) => s + parseFloat(p.monto||0), 0);
        let saldo = totalProp - totalPagado;
        // Rendición de la plata para gastos de este proyecto: lo aprobado que gastó de más se le suma; lo que tiene sin rendir se descuenta
        const rend = ctx.rendicion && ctx.rendicion.movimientos && ctx.rendicion.movimientos.length ? ctx.rendicion.totales : null;
        const netoRend = rend ? Math.round((rend.gastado_aprobado - rend.entregado) * 100) / 100 : 0;
        const totalAPagar = Math.round((saldo + netoRend) * 100) / 100;

        // ══ HOJA 1: ENCABEZADO CON LOGO ══
        // Barra azul de encabezado
        doc.setFillColor(0, 122, 255);
        doc.rect(0, 0, 210, 28, 'F');
        doc.setTextColor(255,255,255); doc.setFont(undefined,'bold'); doc.setFontSize(18);
        doc.text("LIQUIDACIÓN DE CONTRATO", 105, 12, {align:'center'});
        doc.setFontSize(9); doc.setFont(undefined,'normal');
        doc.text(`PROYECTO: ${ctx.proyecto || 'Proyecto'}   |   CONTRATISTA: ${lic.worker_name}   |   ${ctx.fecha}`, 105, 21, {align:'center'});
        // Logo Rubik (LOGO-IA-RUBIK.jpg no tiene espacios en el nombre)
        try {
            const rubikLogoB64 = ctx.logo || null;
            if (rubikLogoB64) doc.addImage(rubikLogoB64, 'JPEG', 4, 3, 22, 22);
        } catch(e) { /* logo no disponible */ }
        doc.setTextColor(0);

        let y = 35;
        doc.setFontSize(12); doc.setFont(undefined, 'bold');
        doc.text("1. RESUMEN FINANCIERO DEL TRATO", margin, y);
        doc.autoTable({
            startY: y + 5,
            head: [['CONCEPTO', 'MONTO']],
            body: [
                ['MONTO DEL CONTRATO', fMoney(contrato) + ' Bs'],
                ...(extrasArr.length ? [['EXTRAS (' + extrasArr.length + ')', fMoney(totalExtras) + ' Bs'], ['MONTO TOTAL ACORDADO', fMoney(totalProp) + ' Bs']] : [['MONTO TOTAL ACORDADO', fMoney(totalProp) + ' Bs']]),
                ['TOTAL DESEMBOLSADO (PAGADO)', fMoney(totalPagado) + ' Bs'],
                ['SALDO DEL CONTRATO', fMoney(saldo) + ' Bs']
            ],
            theme: 'grid', headStyles: { fillColor: [0, 122, 255] }
        });

        y = doc.lastAutoTable.finalY + 12;
        doc.setFontSize(12); doc.setFont(undefined, 'bold');
        doc.text("2. HISTORIAL DE PAGOS Y ANTICIPOS", margin, y);
        if (pagosArr.length > 0) {
            doc.autoTable({
                startY: y + 5,
                head: [['Fecha', 'Concepto', 'Monto']],
                body: pagosArr.map(p => [
                    new Date(p.fecha+'T12:00:00').toLocaleDateString('es-BO'),
                    p.nota || 'Abono',
                    fMoney(parseFloat(p.monto||0)) + ' Bs'
                ]),
                theme: 'striped', headStyles: { fillColor: [52, 199, 89] }
            });
            y = doc.lastAutoTable.finalY + 12;
        } else {
            doc.setFontSize(10); doc.setFont(undefined, 'italic');
            doc.text("No se registran pagos realizados a este contrato.", margin, y + 8);
            y += 15;
        }

        if (extrasArr.length) {
            if (y > 240) { doc.addPage(); y = 20; }
            doc.setFontSize(12); doc.setFont(undefined, 'bold');
            doc.text("EXTRAS DEL CONTRATO", margin, y);
            doc.autoTable({
                startY: y + 5, head: [['Fecha', 'Descripción', 'Monto']],
                body: extrasArr.map(x => [x.fecha ? new Date(String(x.fecha).slice(0,10)+'T12:00:00').toLocaleDateString('es-BO') : '-', x.descripcion || x.desc || 'Extra', fMoney(parseFloat(x.monto||0)) + ' Bs']),
                theme: 'striped', headStyles: { fillColor: [255, 149, 0] }
            });
            y = doc.lastAutoTable.finalY + 12;
        }

        if (rend) {
            if (y > 230) { doc.addPage(); y = 20; }
            doc.setFontSize(12); doc.setFont(undefined, 'bold');
            doc.text("3. PLATA PARA GASTOS (RENDICIÓN) DE ESTE PROYECTO", margin, y);
            doc.autoTable({
                startY: y + 5, head: [['CONCEPTO', 'MONTO']],
                body: [
                    ['ENTREGADO PARA GASTOS', fMoney(rend.entregado) + ' Bs'],
                    ['GASTOS RENDIDOS Y APROBADOS', fMoney(rend.gastado_aprobado) + ' Bs'],
                    ...(rend.pendiente_de_aprobar ? [['GASTOS POR APROBAR (no se cuentan todavía)', fMoney(rend.pendiente_de_aprobar) + ' Bs']] : []),
                    [netoRend >= 0 ? 'A FAVOR DEL CONTRATISTA (se le suma)' : 'SIN RENDIR (se le descuenta)', fMoney(Math.abs(netoRend)) + ' Bs'],
                ],
                theme: 'grid', headStyles: { fillColor: [52, 199, 89] }
            });
            y = doc.lastAutoTable.finalY + 12;
        }

        if (y > 250) { doc.addPage(); y = 20; }
        const saldoOk = totalAPagar <= 0.005 && totalAPagar >= -0.005;
        doc.setFontSize(14); doc.setFont(undefined, 'bold');
        doc.setTextColor(...(saldoOk ? [52,199,89] : totalAPagar > 0 ? [255,149,0] : [200,40,40]));
        doc.text(saldoOk ? '✓ CONTRATO LIQUIDADO' : totalAPagar > 0 ? `TOTAL A PAGAR: ${fMoney(totalAPagar)} Bs` : `SALDO A FAVOR DE RUBIK: ${fMoney(-totalAPagar)} Bs`, margin, y);
        if (rend && netoRend) {
            doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(100,100,100);
            doc.text(`Saldo del contrato ${fMoney(saldo)} Bs ${netoRend >= 0 ? '+' : '−'} rendición ${fMoney(Math.abs(netoRend))} Bs`, margin, y + 6);
        }
        doc.setTextColor(0);

        // ══ HOJA 2: ANEXO TÉCNICO AGRUPADO POR ÍTEM ══
        if (lic.tareas) {
            doc.addPage();
            doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(0,122,255);
            doc.text("ANEXO: DESGLOSE TÉCNICO Y GRÁFICO", margin, 20);
            doc.setTextColor(0);

            // Agrupar tareas por originIdx preservando el orden de primera aparición
            const groupOrder = [];
            const groups = {};
            for (let tId in lic.tareas) {
                let t = lic.tareas[tId]; if (!t) continue;
                const gk = t.originIdx !== undefined ? String(t.originIdx) : 'z_general';
                if (!groups[gk]) { groups[gk] = { parentDesc: t.parent_desc || t.desc || 'General', tasks: [] }; groupOrder.push(gk); }
                groups[gk].tasks.push(t);
            }

            const bodyData = [];
            for (let gk of groupOrder) {
                const grp = groups[gk];
                // Cabecera del grupo (ítem padre)
                bodyData.push([{ content: grp.parentDesc.toUpperCase(), colSpan: 5, styles: { fillColor: [230,240,255], fontStyle:'bold', fontSize:8, textColor:[0,80,180] } }, { content: '', colSpan: 1, styles: { fillColor: [230,240,255] } }]);

                for (let t of grp.tasks) {
                    let medida = '-';
                    let b64 = null;

                    const fmMed = (b, h) => `${parseFloat(b).toFixed(2)} × ${parseFloat(h).toFixed(2)} cm`;

                    // ── MEDIDAS: fuente primaria = t.measures ──
                    if (t.measures) {
                        if (parseFloat(t.measures.b) > 0 && parseFloat(t.measures.h) > 0) {
                            medida = fmMed(t.measures.b, t.measures.h);
                        } else {
                            const measArr = Array.isArray(t.measures)
                                ? t.measures
                                : Object.values(t.measures).filter(v => v && typeof v === 'object');
                            const m0 = measArr.find(m => m && parseFloat(m.b) > 0 && parseFloat(m.h) > 0);
                            if (m0) medida = fmMed(m0.b, m0.h);
                        }
                    }
                    // ── MO: mo_partes (computo métrico) → mat con es_arte (cantidad copiada de impresión) ──
                    if (medida === '-' && t.originType === 'mo' && t.originIdx !== undefined && t.originApuidx !== undefined) {
                        const itItemMo = budgetItems[t.originIdx];
                        if (itItemMo?.prod_apu?.mo) {
                            const moArr = Array.isArray(itItemMo.prod_apu.mo)
                                ? itItemMo.prod_apu.mo
                                : Object.values(itItemMo.prod_apu.mo);
                            const moEntry = moArr[parseInt(t.originApuidx)];
                            if (moEntry?.mo_partes) {
                                const partes = Array.isArray(moEntry.mo_partes) ? moEntry.mo_partes : Object.values(moEntry.mo_partes);
                                const toCm = moEntry.mo_input_und === 'cm' ? 1 : 100;
                                const p0 = partes.find(p => parseFloat(p.base) > 0 && parseFloat(p.altura) > 0);
                                if (p0) medida = fmMed(parseFloat(p0.base) * toCm, parseFloat(p0.altura) * toCm);
                            }
                            if (medida === '-' && itItemMo?.prod_apu?.mat) {
                                const matArrMo = Array.isArray(itItemMo.prod_apu.mat)
                                    ? itItemMo.prod_apu.mat
                                    : Object.values(itItemMo.prod_apu.mat);
                                for (const matE of matArrMo) {
                                    if (!matE || !matE.es_arte) continue;
                                    if (parseFloat(matE.b) > 0 && parseFloat(matE.h) > 0) { medida = fmMed(matE.b, matE.h); break; }
                                    const mArr = Array.isArray(matE.measures) ? matE.measures : (matE.measures ? Object.values(matE.measures) : []);
                                    const ms = mArr.filter(m => m && parseFloat(m.b) > 0 && parseFloat(m.h) > 0);
                                    if (ms.length > 0) { medida = fmMed(ms[0].b, ms[0].h); break; }
                                }
                            }
                        }
                    }
                    // ── FALLBACK: prod_apu.mat (medidas de IMPRESIONES en producción) ──
                    if (medida === '-' && t.originIdx !== undefined) {
                        const itItem = budgetItems[t.originIdx];
                        if (itItem?.prod_apu?.mat) {
                            const matArr = Array.isArray(itItem.prod_apu.mat)
                                ? itItem.prod_apu.mat
                                : Object.values(itItem.prod_apu.mat);
                            const idx2use = (t.originMatidx !== undefined) ? parseInt(t.originMatidx) : null;
                            const matList = (idx2use !== null && matArr[idx2use]) ? [matArr[idx2use]] : matArr;
                            for (const matE of matList) {
                                if (!matE) continue;
                                if (parseFloat(matE.b) > 0 && parseFloat(matE.h) > 0) { medida = fmMed(matE.b, matE.h); break; }
                                const measArr2 = Array.isArray(matE.measures) ? matE.measures : (matE.measures ? Object.values(matE.measures) : []);
                                const ms = measArr2.filter(m => m && parseFloat(m.b) > 0 && parseFloat(m.h) > 0);
                                if (ms.length > 0) { medida = fmMed(ms[0].b, ms[0].h); break; }
                            }
                        }
                    }

                    // ── IMAGEN ──
                    if (t.img) {
                        b64 = await ctx.cargarImagen(t.img);
                    } else if (t.originIdx !== undefined) {
                        const itItem = budgetItems[t.originIdx];
                        const idx2use = (t.originMatidx !== undefined) ? t.originMatidx : null;
                        const matE = idx2use !== null ? itItem?.prod_apu?.mat?.[idx2use] : null;
                        const imgSrc = matE?.corte_url || matE?.img || null;
                        if (imgSrc) b64 = await ctx.cargarImagen(imgSrc);
                    }

                    const cantFmt = parseFloat(parseFloat(t.cant||0).toFixed(2));
                    bodyData.push([t.task_name||t.desc, medida, cantFmt, fMoney(t.pu)+' Bs', fMoney(t.subtotal)+' Bs', b64]);
                }
            }

            if (bodyData.length > 0) {
                doc.autoTable({
                    startY: 28,
                    head: [['Tarea / Arte', 'Medida (Base×Alt)', 'Cant', 'P.U.', 'Subtotal', 'Imagen']],
                    body: bodyData,
                    theme: 'grid',
                    headStyles: { fillColor: [0,122,255], halign:'center', fontSize:8 },
                    styles: { fontSize: 7, valign: 'middle' },
                    columnStyles: { 0:{cellWidth:52}, 1:{cellWidth:28,halign:'center'}, 2:{cellWidth:12,halign:'center'}, 3:{cellWidth:20,halign:'right'}, 4:{cellWidth:22,halign:'right'}, 5:{cellWidth:28,halign:'center'} },
                    didParseCell: function(d) {
                        if (d.column.index === 5 && d.cell.section === 'body' && Array.isArray(d.row.raw)) {
                            d.cell.text = ''; d.cell.styles.minCellHeight = 20;
                        }
                    },
                    didDrawCell: function(d) {
                        if (d.column.index === 5 && d.cell.section === 'body' && Array.isArray(d.row.raw)) {
                            const img = d.cell.raw;
                            if (img && typeof img === 'string' && img.startsWith('data:image')) {
                                doc.addImage(img, 'JPEG', d.cell.x+2, d.cell.y+2, 24, 16);
                            }
                        }
                    }
                });
            }

            // Subtotal del anexo
            const subTotalAnexo = Object.values(lic.tareas).reduce((s,t) => s + parseFloat(t.subtotal||0), 0);
            let yFin = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : 200;
            if (yFin > 270) { doc.addPage(); yFin = 20; }
            doc.setFontSize(10); doc.setFont(undefined, 'bold');
            doc.text(`TOTAL CONTRATO: ${fMoney(subTotalAnexo)} Bs`, margin, yFin);
        }

        // ══ HOJA 3: COMPROBANTES DE PAGO ══
        // Mostrar página de comprobantes si hay CUALQUIER pago (con o sin imagen adjunta)
        if (pagosArr.length > 0) {
            doc.addPage();
            doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(52,199,89);
            doc.text("ANEXO: COMPROBANTES DE PAGO", margin, 20);
            doc.setTextColor(0);

            // Tabla resumen de pagos
            doc.autoTable({
                startY: 26,
                head: [['#', 'Fecha', 'Concepto', 'Monto', 'Comprobante']],
                body: pagosArr.map((p, i) => [
                    i+1,
                    new Date(p.fecha+'T12:00:00').toLocaleDateString('es-BO'),
                    p.nota || 'Abono',
                    fMoney(parseFloat(p.monto||0)) + ' Bs',
                    p.comprobante ? 'Adjunto' : 'Sin imagen'
                ]),
                theme: 'grid',
                headStyles: { fillColor: [52,199,89] },
                styles: { fontSize: 8 },
                columnStyles: { 0:{cellWidth:8,halign:'center'}, 3:{halign:'right'}, 4:{halign:'center'} }
            });

            // Imágenes de comprobantes (si existen)
            const pagosConComp = pagosArr.filter(p => p.comprobante);
            if (pagosConComp.length > 0) {
                let cy = doc.lastAutoTable.finalY + 10;
                doc.setFontSize(11); doc.setFont(undefined,'bold');
                if (cy > 255) { doc.addPage(); cy = 15; }
                doc.text("Imágenes adjuntas:", margin, cy); cy += 6;

                const MAX_W = 85, MAX_H = 125, gap = 8;
                let cx = margin;
                for (let p of pagosConComp) {
                    let b64 = null;
                    try { b64 = await ctx.cargarComprobante(p.comprobante); } catch(e2) { b64 = null; }
                    if (!b64) continue;

                    // Obtener dimensiones reales para preservar proporción
                    const dimC = await ctx.dimensiones(b64).catch(() => ({ w: 1, h: 1 }));
                    const natW = dimC.w || 1, natH = dimC.h || 1;
                    const ratio = natH / natW;
                    let drawW = MAX_W, drawH = MAX_W * ratio;
                    if (drawH > MAX_H) { drawH = MAX_H; drawW = MAX_H / ratio; }

                    if (cx + drawW > 195) { cx = margin; cy += MAX_H + 14; }
                    if (cy + drawH + 8 > 275) { doc.addPage(); cx = margin; cy = 15; }
                    doc.setFontSize(7); doc.setFont(undefined, 'bold');
                    doc.text(`${new Date(p.fecha+'T12:00:00').toLocaleDateString('es-BO')} — ${fMoney(p.monto||0)} Bs`, cx, cy - 2);
                    const mimeGuess = b64.startsWith('data:image/png') ? 'PNG' : 'JPEG';
                    doc.addImage(b64, mimeGuess, cx, cy, drawW, drawH);
                    cx += drawW + gap;
                }
            }
        }

        return doc;
    }

    const api = { generar, nombreArchivo };
    global.PdfLiquidacion = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
