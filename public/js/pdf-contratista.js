/**
 * pdf-contratista.js — Consolidado de un contratista o proveedor (Tesorería → Contratistas): todos sus contratos con
 * resumen, desglose técnico con fotos, pagos y comprobantes. UNA sola versión para Tesorería y el servidor (Kay por
 * WhatsApp). Copia idéntica en functions/pdf/compartido/pdf-contratista.js.
 * El acordado incluye los extras, y la plata para gastos (rendición) de cada proyecto suma o descuenta en el TOTAL A PAGAR.
 *
 *   PdfContratista.generar({
 *     jsPDF, workerName, fecha, logo,
 *     items: [{cid, pid, pid_nombre, licId, lic, budgetItems, rendicion?}],   // rendicion: "estado" de esa persona en ese proyecto
 *     cargarImagen(url) → Promise<dataURL|null>, dimensiones(dataURL) → Promise<{w, h}>,
 *   }) → Promise<jsPDF>
 *   PdfContratista.nombreArchivo(workerName, fecha) → "Contratista_<Nombre>_<fecha>.pdf"
 */
(function (global) {
    'use strict';
    function fMoneyCT(n) { return parseFloat(n||0).toLocaleString('es-BO',{minimumFractionDigits:2,maximumFractionDigits:2}); }
    const TIPOS_CON_FOTO_PROPIA = new Set(['art', 'llm_art', 'llm_mat']);
    const _ctNorm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    // Ítem del presupuesto de una tarea: verifica por descripción que originIdx siga apuntando al mismo ítem (no adivina)
    function itemDeTareaCT(budgetItems, t) {
        if (!t || !budgetItems) return null;
        const desc = _ctNorm(t.originType === 'main' ? t.task_name : (t.parent_desc || t.parentDesc));
        const porIdx = t.originIdx !== undefined ? budgetItems[t.originIdx] : null;
        if (porIdx && (!desc || _ctNorm(porIdx.desc) === desc)) return porIdx;
        if (!desc) return null;
        return Object.values(budgetItems).find(it => it && it.type !== 'chapter' && _ctNorm(it.desc) === desc) || null;
    }
    function fotoDeItem(it) {
        if (!it) return null;
        if (it.img) return it.img;
        const ops = it.op_images ? Object.values(it.op_images).filter(u => typeof u === 'string' && u) : [];
        return ops[0] || null;
    }
    const extrasDe = (lic) => Object.values(lic.extras || {}).reduce((s, x) => s + parseFloat((x && x.monto) || 0), 0);
    const acordadoDe = (lic) => parseFloat(lic.precio_final || lic.precio_propuesto || 0) + extrasDe(lic);
    function nombreArchivo(workerName, fecha) {
        return `Contratista_${String(workerName || '').replace(/[^a-z0-9]/gi,'_').substring(0,30)}_${String(fecha || '').replace(/\//g,'-')}.pdf`;
    }

    let ctx = null;
    async function imgConDims(url) {
        const b64 = await ctx.cargarImagen(url).catch(() => null);
        if (!b64 || !b64.startsWith('data:image')) return null;
        const d = await ctx.dimensiones(b64).catch(() => ({ w: 1, h: 1 }));
        return { b64, w: d.w || 1, h: d.h || 1 };
    }

    async function generar(c) {
        ctx = c;
        const workerName = ctx.workerName || '', items = ctx.items || [];
        const jsPDF = ctx.jsPDF;
        const doc = new jsPDF('p', 'mm', 'a4');
        const margin = 14;
        const pw = doc.internal.pageSize.getWidth();
        const today = ctx.fecha || '';

        // Load logo once
        let logoB64 = ctx.logo || null;

        function drawHeader(doc, wName, subtitle) {
            doc.setFillColor(0, 0, 0);
            doc.rect(0, 0, pw, 28, 'F');
            if (logoB64) doc.addImage(logoB64, 'JPEG', 4, 3, 22, 22);
            doc.setFontSize(14); doc.setFont(undefined,'bold'); doc.setTextColor(255,255,255);
            doc.text(wName.toUpperCase(), pw/2, 11, {align:'center'});
            doc.setFontSize(8); doc.setFont(undefined,'normal');
            doc.text(subtitle || `Generado: ${today}`, pw/2, 18, {align:'center'});
            doc.text('RUBIK BOLIVIA — CONSOLIDADO DE CONTRATOS', pw/2, 24, {align:'center'});
            doc.setTextColor(0,0,0);
        }

        // ── PÁGINA 1: Resumen de todos los proyectos ──
        drawHeader(doc, workerName, `Resumen Consolidado  |  ${today}`);
        let y = 34;
        doc.setFontSize(12); doc.setFont(undefined,'bold');
        doc.text('RESUMEN DE PROYECTOS', margin, y); y += 6;

        let grandAcordado = 0, grandPagado = 0;
        const summaryBody = items.map(({ pid_nombre, lic }) => {
            const pagosArr = Object.values(lic.pagos || {});
            const acordado = acordadoDe(lic);   // contrato + extras
            const pagado = pagosArr.reduce((s,p) => s + parseFloat(p.monto||0), 0);
            const saldo = acordado - pagado;
            grandAcordado += acordado;
            grandPagado += pagado;
            return [pid_nombre, (lic.estado||'').toUpperCase(), fMoneyCT(acordado)+' Bs', fMoneyCT(pagado)+' Bs', fMoneyCT(saldo)+' Bs'];
        });
        const grandSaldo = grandAcordado - grandPagado;
        summaryBody.push([
            { content: 'TOTAL GENERAL', colSpan: 2, styles:{fontStyle:'bold',fillColor:[240,240,240]} },
            { content: fMoneyCT(grandAcordado)+' Bs', styles:{fontStyle:'bold',halign:'right',fillColor:[240,240,240]} },
            { content: fMoneyCT(grandPagado)+' Bs', styles:{fontStyle:'bold',halign:'right',fillColor:[240,240,240]} },
            { content: fMoneyCT(grandSaldo)+' Bs', styles:{fontStyle:'bold',halign:'right',fillColor:[240,240,240],textColor:grandSaldo>0?[200,30,30]:[34,139,34]} }
        ]);

        doc.autoTable({
            startY: y,
            head: [['Proyecto','Estado','Acordado','Pagado','Saldo']],
            body: summaryBody,
            theme:'grid',
            headStyles:{fillColor:[0,0,0],fontSize:8,halign:'center'},
            styles:{fontSize:8},
            columnStyles:{0:{cellWidth:62},1:{cellWidth:24,halign:'center'},2:{halign:'right'},3:{halign:'right'},4:{halign:'right'}},
            margin:{left:margin,right:margin}
        });
        y = doc.lastAutoTable.finalY + 10;

        // Plata para gastos (rendición) de estos proyectos: lo aprobado de más se suma, lo no rendido se descuenta
        const rends = items.map(it => it.rendicion && it.rendicion.movimientos && it.rendicion.movimientos.length ? { nombre: it.pid_nombre, t: it.rendicion.totales } : null)
            .filter(Boolean).filter((r, k, a) => a.findIndex(x => x.nombre === r.nombre) === k);
        const netoRend = Math.round(rends.reduce((s, r) => s + r.t.gastado_aprobado - r.t.entregado, 0) * 100) / 100;
        if (rends.length) {
            doc.setFontSize(11); doc.setFont(undefined,'bold');
            doc.text('PLATA PARA GASTOS (RENDICIÓN)', margin, y); y += 4;
            doc.autoTable({
                startY: y, head: [['Proyecto','Entregado','Rendido','Por aprobar','Saldo (+ a favor)']],
                body: rends.map(r => [r.nombre, fMoneyCT(r.t.entregado)+' Bs', fMoneyCT(r.t.gastado_aprobado)+' Bs', fMoneyCT(r.t.pendiente_de_aprobar)+' Bs',
                    (r.t.gastado_aprobado - r.t.entregado >= 0 ? '+' : '−') + fMoneyCT(Math.abs(r.t.gastado_aprobado - r.t.entregado))+' Bs']),
                theme:'grid', headStyles:{fillColor:[52,199,89],fontSize:8,halign:'center'}, styles:{fontSize:8},
                columnStyles:{1:{halign:'right'},2:{halign:'right'},3:{halign:'right'},4:{halign:'right'}}, margin:{left:margin,right:margin}
            });
            y = doc.lastAutoTable.finalY + 10;
        }
        const totalAPagar = Math.round((grandSaldo + netoRend) * 100) / 100;
        doc.setFontSize(13); doc.setFont(undefined,'bold');
        doc.setTextColor(...(Math.abs(totalAPagar) < 0.005 ? [34,139,34] : totalAPagar > 0 ? [200,30,30] : [0,90,160]));
        doc.text(Math.abs(totalAPagar) < 0.005 ? '✓ TODOS LOS CONTRATOS LIQUIDADOS' : totalAPagar > 0 ? `TOTAL A PAGAR: ${fMoneyCT(totalAPagar)} Bs` : `SALDO A FAVOR DE RUBIK: ${fMoneyCT(-totalAPagar)} Bs`, margin, y);
        if (rends.length && netoRend) {
            doc.setFontSize(8); doc.setFont(undefined,'normal'); doc.setTextColor(100,100,100);
            doc.text(`Saldo de contratos ${fMoneyCT(grandSaldo)} Bs ${netoRend >= 0 ? '+' : '−'} rendición ${fMoneyCT(Math.abs(netoRend))} Bs`, margin, y + 6);
        }
        doc.setTextColor(0,0,0);

        // ── Páginas de detalle por proyecto ──
        for (const { cid, pid, pid_nombre, licId, lic, budgetItems: _bi } of items) {
            doc.addPage();
            drawHeader(doc, workerName, `Proyecto: ${pid_nombre}  |  Fecha: ${today}`);
            let y = 34;

            // Budget items for measurement lookup
            const budgetItems = _bi || {};

            // originIdx es la posición del ítem al adjudicar; si el presupuesto se reordenó o se
            // insertaron ítems, apunta a otro. Se verifica por descripción antes de usarlo.
            function itemDeTarea(t) { return itemDeTareaCT(budgetItems, t); }

            function getMedida(t) {
                const fmMed = (b,h) => `${parseFloat(b).toFixed(2)}×${parseFloat(h).toFixed(2)}`;
                let medida = '';
                // 1. Direct t.measures
                if (t.measures) {
                    if (parseFloat(t.measures.b)>0 && parseFloat(t.measures.h)>0) {
                        medida = fmMed(t.measures.b, t.measures.h);
                    } else {
                        const measArr = Array.isArray(t.measures) ? t.measures : Object.values(t.measures).filter(v=>v&&typeof v==='object');
                        const m0 = measArr.find(m=>m&&parseFloat(m.b)>0&&parseFloat(m.h)>0);
                        if (m0) medida = fmMed(m0.b, m0.h);
                    }
                }
                // 2. MO: mo_partes with unit conversion
                if (!medida && t.originType==='mo' && t.originIdx!==undefined && t.originApuidx!==undefined) {
                    const itMo = itemDeTarea(t);
                    if (itMo && itMo.prod_apu && itMo.prod_apu.mo) {
                        const moArr = Array.isArray(itMo.prod_apu.mo) ? itMo.prod_apu.mo : Object.values(itMo.prod_apu.mo);
                        const moEntry = moArr[parseInt(t.originApuidx)];
                        if (moEntry && moEntry.mo_partes) {
                            const partes = Array.isArray(moEntry.mo_partes) ? moEntry.mo_partes : Object.values(moEntry.mo_partes);
                            const toCm = moEntry.mo_input_und === 'cm' ? 1 : 100;
                            const p0 = partes.find(p=>parseFloat(p.base)>0&&parseFloat(p.altura)>0);
                            if (p0) medida = fmMed(parseFloat(p0.base)*toCm, parseFloat(p0.altura)*toCm);
                        }
                        if (!medida && itMo.prod_apu.mat) {
                            const matArrMo = Array.isArray(itMo.prod_apu.mat) ? itMo.prod_apu.mat : Object.values(itMo.prod_apu.mat);
                            for (const matE of matArrMo) {
                                if (!matE || !matE.es_arte) continue;
                                if (parseFloat(matE.b)>0&&parseFloat(matE.h)>0) { medida=fmMed(matE.b,matE.h); break; }
                                const mA = Array.isArray(matE.measures)?matE.measures:(matE.measures?Object.values(matE.measures):[]);
                                const ms = mA.filter(m=>m&&parseFloat(m.b)>0&&parseFloat(m.h)>0);
                                if (ms.length) { medida=fmMed(ms[0].b,ms[0].h); break; }
                            }
                        }
                    }
                }
                // 3. Fallback: prod_apu.mat (impressions / mat tasks)
                if (!medida && t.originIdx!==undefined) {
                    const itItem = itemDeTarea(t);
                    if (itItem && itItem.prod_apu && itItem.prod_apu.mat) {
                        const matArr = Array.isArray(itItem.prod_apu.mat) ? itItem.prod_apu.mat : Object.values(itItem.prod_apu.mat);
                        const idx2use = t.originMatidx!==undefined ? parseInt(t.originMatidx) : null;
                        const matList = (idx2use!==null && matArr[idx2use]) ? [matArr[idx2use]] : matArr;
                        for (const matE of matList) {
                            if (!matE) continue;
                            if (parseFloat(matE.b)>0&&parseFloat(matE.h)>0) { medida=fmMed(matE.b,matE.h); break; }
                            const mA2 = Array.isArray(matE.measures)?matE.measures:(matE.measures?Object.values(matE.measures):[]);
                            const ms2 = mA2.filter(m=>m&&parseFloat(m.b)>0&&parseFloat(m.h)>0);
                            if (ms2.length) { medida=fmMed(ms2[0].b,ms2[0].h); break; }
                        }
                    }
                }
                return medida;
            }

            // ── 1. Resumen financiero ──
            const pagosArr = Object.values(lic.pagos || {}).sort((a,b)=>(a.fecha||'')>(b.fecha||'')?1:-1);
            const extrasLic = extrasDe(lic);
            const acordado = acordadoDe(lic);   // contrato + extras
            const pagado = pagosArr.reduce((s,p) => s+parseFloat(p.monto||0), 0);
            const saldo = acordado - pagado;

            doc.setFontSize(10); doc.setFont(undefined,'bold');
            doc.text('1. RESUMEN FINANCIERO', margin, y); y += 4;
            doc.autoTable({
                startY: y,
                head: [['CONCEPTO','MONTO']],
                body: [
                    ['ESTADO', (lic.estado||'').toUpperCase()],
                    ['TIPO', lic.is_grafico ? 'Empresa Gráfica' : 'Contratista Obra'],
                    ...(extrasLic ? [['CONTRATO', fMoneyCT(acordado - extrasLic) + ' Bs'], ['EXTRAS', fMoneyCT(extrasLic) + ' Bs']] : []),
                    ['MONTO ACORDADO', fMoneyCT(acordado) + ' Bs'],
                    ['TOTAL PAGADO', fMoneyCT(pagado) + ' Bs'],
                    ['SALDO PENDIENTE', fMoneyCT(saldo) + ' Bs']
                ],
                theme:'grid', headStyles:{fillColor:[0,0,0]}, styles:{fontSize:8},
                columnStyles:{0:{fontStyle:'bold',cellWidth:80},1:{halign:'right'}},
                margin:{left:margin,right:margin}
            });
            y = doc.lastAutoTable.finalY + 8;

            // ── 2. Desglose técnico de tareas ──
            const tareas = Array.isArray(lic.tareas) ? lic.tareas : Object.values(lic.tareas || {});
            if (tareas.length) {
                if (y > 240) { doc.addPage(); drawHeader(doc, workerName, `Proyecto: ${pid_nombre}  |  Desglose técnico`); y = 34; }
                doc.setFontSize(10); doc.setFont(undefined,'bold');
                doc.text('2. DESGLOSE TÉCNICO DE TAREAS', margin, y); y += 4;

                const groupOrder = [];
                const groups = {};
                tareas.forEach(t => {
                    if (!t) return;
                    const gk = t.originIdx !== undefined ? String(t.originIdx) : 'general';
                    if (!groups[gk]) { groups[gk] = { parentDesc: t.parent_desc || t.parentDesc || t.desc || 'General', tasks: [] }; groupOrder.push(gk); }
                    groups[gk].tasks.push(t);
                });

                const bodyData = [];
                const rowImgs = [];   // rowImgs[índice de fila] = { b64, w, h }
                const _cacheImg = {};
                const cargarImg = async url => {
                    if (!url) return null;
                    if (!(url in _cacheImg)) _cacheImg[url] = await imgConDims(url);
                    return _cacheImg[url];
                };
                for (const gk of groupOrder) {
                    const grp = groups[gk];
                    // Foto del ítem: la actual del presupuesto/producción; si no hay, la guardada al adjudicar
                    const it = itemDeTarea(grp.tasks[0]);
                    const fotoItem = fotoDeItem(it) || grp.tasks.map(t => t.img || t.imgRef).find(Boolean) || null;
                    bodyData.push([
                        { content: grp.parentDesc.toUpperCase(), colSpan: 5, styles:{fillColor:[230,240,255],fontStyle:'bold',fontSize:8,textColor:[0,80,180]} },
                        { content: '', styles:{fillColor:[230,240,255]} }
                    ]);
                    rowImgs[bodyData.length - 1] = await cargarImg(fotoItem);
                    for (const t of grp.tasks) {
                        const cantF = parseFloat(t.cant || 1);
                        const pu = parseFloat(t.pu || t.precio || 0);
                        const subtotal = parseFloat(t.subtotal || (cantF * pu));
                        const medida = getMedida(t);
                        bodyData.push([t.task_name || t.desc || '', medida, cantF.toFixed(2), fMoneyCT(pu)+' Bs', fMoneyCT(subtotal)+' Bs', '']);
                        // Foto propia solo para artes y cortes de material, y si no repite la del ítem
                        const propia = TIPOS_CON_FOTO_PROPIA.has(t.originType) ? (t.corte_url || t.img || t.imgRef || null) : null;
                        if (propia && propia !== fotoItem) rowImgs[bodyData.length - 1] = await cargarImg(propia);
                    }
                }

                doc.autoTable({
                    startY: y, margin:{left:margin,right:margin},
                    head: [['Tarea','Medidas','Cant','P.U.','Subtotal','Img']],
                    body: bodyData,
                    theme:'grid',
                    headStyles:{fillColor:[0,0,0],halign:'center',fontSize:8},
                    styles:{fontSize:7,valign:'middle',overflow:'linebreak'},
                    columnStyles:{0:{cellWidth:52},1:{cellWidth:28},2:{cellWidth:12,halign:'center'},3:{cellWidth:26,halign:'right'},4:{cellWidth:26,halign:'right'},5:{cellWidth:22,halign:'center'}},
                    didParseCell: d => { if (d.section === 'body' && rowImgs[d.row.index]) d.cell.styles.minCellHeight = 22; },
                    didDrawCell: d => {
                        if (d.section !== 'body' || d.column.index !== 5) return;
                        const im = rowImgs[d.row.index];
                        if (!im) return;
                        const maxW = 18, maxH = 18;
                        const k = Math.min(maxW / im.w, maxH / im.h);
                        const w = im.w * k, h = im.h * k;
                        const mime = im.b64.startsWith('data:image/png') ? 'PNG' : 'JPEG';
                        try { doc.addImage(im.b64, mime, d.cell.x + (d.cell.width - w) / 2, d.cell.y + (d.cell.height - h) / 2, w, h); } catch(e) {}
                    }
                });
                y = doc.lastAutoTable.finalY + 8;

                const totalTareas = tareas.reduce((s,t)=>s+parseFloat(t.subtotal||t.pu||0),0);
                if (y > 270) { doc.addPage(); drawHeader(doc,workerName,`Proyecto: ${pid_nombre}`); y=34; }
                doc.setFontSize(9); doc.setFont(undefined,'bold');
                doc.text(`TOTAL TAREAS: ${fMoneyCT(totalTareas)} Bs`, margin, y); y += 8;
            }

            // ── 3. Historial de pagos ──
            if (pagosArr.length) {
                if (y > 230) { doc.addPage(); drawHeader(doc,workerName,`Proyecto: ${pid_nombre}  |  Pagos`); y=34; }
                doc.setFontSize(10); doc.setFont(undefined,'bold');
                doc.text('3. HISTORIAL DE PAGOS', margin, y); y += 4;
                doc.autoTable({
                    startY: y, margin:{left:margin,right:margin},
                    head: [['#','Fecha','Concepto','Monto','Comprobante']],
                    body: pagosArr.map((p,i) => [i+1, p.fecha||'', p.concepto||p.nota||'Abono', fMoneyCT(p.monto)+' Bs', p.comprobante?'Adjunto':'—']),
                    theme:'grid', headStyles:{fillColor:[52,199,89]}, styles:{fontSize:8},
                    columnStyles:{0:{cellWidth:8,halign:'center'},3:{halign:'right'},4:{halign:'center'}},
                    margin:{left:margin,right:margin}
                });
                y = doc.lastAutoTable.finalY + 8;

                if (y > 270) { doc.addPage(); drawHeader(doc,workerName,`Proyecto: ${pid_nombre}`); y=34; }
                const ok = saldo <= 0;
                doc.setFontSize(12); doc.setFont(undefined,'bold');
                doc.setTextColor(...(ok?[34,139,34]:[255,149,0]));
                doc.text(ok ? '✓ CONTRATO LIQUIDADO' : `SALDO PENDIENTE: ${fMoneyCT(saldo)} Bs`, margin, y);
                doc.setTextColor(0,0,0); y += 10;

                // ── 4. Comprobantes como imágenes ──
                const conComp = pagosArr.filter(p => p.comprobante);
                if (conComp.length) {
                    doc.addPage(); drawHeader(doc,workerName,`Proyecto: ${pid_nombre}  |  Comprobantes`);
                    doc.setFontSize(12); doc.setFont(undefined,'bold'); doc.setTextColor(52,199,89);
                    doc.text('COMPROBANTES DE PAGO', margin, 34); doc.setTextColor(0,0,0);
                    let cy = 42, cx = margin;
                    const MAX_W = 85, MAX_H = 120, gap = 8;
                    for (const p of conComp) {
                        const b64 = await ctx.cargarImagen(p.comprobante).catch(() => null);
                        if (!b64) continue;
                        const _d = await ctx.dimensiones(b64).catch(() => ({ w: 1, h: 1 }));
                        const natW = _d.w || 1, natH = _d.h || 1;
                        const ratio = natH/natW;
                        let dw=MAX_W, dh=MAX_W*ratio;
                        if (dh>MAX_H) { dh=MAX_H; dw=MAX_H/ratio; }
                        if (cx+dw > 195) { cx=margin; cy+=MAX_H+14; }
                        if (cy+dh+8 > 275) { doc.addPage(); drawHeader(doc,workerName,`Comprobantes`); cx=margin; cy=34; }
                        doc.setFontSize(7); doc.setFont(undefined,'bold');
                        doc.text(`${p.fecha||''} — ${fMoneyCT(p.monto||0)} Bs  |  ${p.concepto||'Pago'}`, cx, cy-2);
                        const mime = b64.startsWith('data:image/png')?'PNG':'JPEG';
                        doc.addImage(b64, mime, cx, cy, dw, dh);
                        cx += dw+gap;
                    }
                }
            }
        }

        return doc;
    }

    const api = { generar, nombreArchivo, acordadoDe };
    global.PdfContratista = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
