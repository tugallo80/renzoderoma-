/**
 * pdf-produccion.js — Órdenes de Producción en PDF: técnica (estructuras), de impresión (artes) y completa. UNA sola versión
 * para la pantalla (produccion.html) y el servidor (functions/documentos, para Kay por WhatsApp).
 * Copia idéntica en functions/pdf/compartido/pdf-produccion.js (tools/documentos: "npm run sincronizar").
 *
 *   PdfProduccion.generar(tipo, {          // tipo: 'produccion' | 'impresion' | 'impresion_con_imagen' | 'completa'
 *     jsPDF, items,                        // ítems del presupuesto (proyectos/{cid}/{pid}/presupuesto/items)
 *     artsData,                            // artes por ítem; si falta, se arman con armarArtes(items, artes_data)
 *     proyecto, cliente, fecha, fechaCorta,
 *     cargarImagen(url),                   // → Promise<dataURL | null>
 *   }) → Promise<{doc, sufijo}>
 *   PdfProduccion.armarArtes(items, artesGuardadas) → artes por ítem: las guardadas (proyectos/…/artes_data) y, para el resto,
 *                                         las que salen de las medidas del APU (como la pestaña Impresión).
 *   PdfProduccion.nombreArchivo({proyecto, cliente, sufijo, fecha: Date}) → "MMDD_PROYECTO_CLIENTE_SUFIJO.pdf"
 */
(function (global) {
    'use strict';

    function getValidKeys(obj) { if(!obj) return []; return Object.keys(obj).filter(k => obj[k] != null && typeof obj[k] === 'object'); }

    function getValidStringsKeys(obj) { if(!obj) return []; return Object.keys(obj).filter(k => obj[k] != null && typeof obj[k] === 'string'); }

    function stripZeros(num) { return Math.round((parseFloat(num) || 0) * 100) / 100; }

    function isGraphicTarget(desc, unit) {
        let u = String(unit || '').toLowerCase().trim();
        let d = String(desc || '').toLowerCase().trim();
        // Excluir mano de obra y materiales/accesorios no gráficos
        if (/jornal|jornada|hr|hora/.test(u)) return false;
        if (/tornillo|accesorio|herramienta|rotulista|instalaci|montaje|tensado|clamp|tirafondo|perno|bisagra|soldador|tesador|soldadura|pintor|pintura|electrici|carpinter|plomero|albanil|albañil|mano.de.obra|logistica|logística|colgado|desmontaje|flete|transporte/.test(d)) return false;
        return (u.indexOf('m2') !== -1 || u.indexOf('mt2') !== -1 || /lona|vinil|adhesivo|impresi|banner|microperforado/.test(d));
    }

    function detectMaterialFromName(name) {
        const n = (name || '').toLowerCase();
        if (n.includes('backlight')) return 'Lona Backlight';
        if (n.includes('mesh')) return 'Lona Mesh';
        if (n.includes('lona mate') || n.includes('mate')) return 'Lona Mate';
        if (n.includes('lona')) return 'Lona';
        if (n.includes('adhesivo mate')) return 'Adhesivo Mate';
        if (n.includes('adhesivo trans')) return 'Adhesivo Transparente';
        if (n.includes('adhesivo') || n.includes('vinil') || n.includes('vinyl')) return 'Adhesivo Vinílico';
        if (n.includes('banner')) return 'Banner';
        if (n.includes('microper')) return 'Microperforado';
        if (n.includes('sublim') || n.includes('tela')) return 'Tela Sublimada';
        if (n.includes('pvc') || n.includes('foam')) return 'PVC Foam';
        return 'Lona';
    }

    function calcArtM2(art) {
        // Si el arte tiene m2 precomputado del APU (sin desglose base/altura), usarlo directo
        if (art.m2_directo && art.m2_directo > 0) return parseFloat(art.m2_directo);
        const b = parseFloat(art.base) || 0;
        const h = parseFloat(art.altura) || 0;
        const c = parseFloat(art.cantidad) || 1;
        if (b <= 0 || h <= 0) return 0;
        // Detectar unidad automáticamente:
        // Si base >= 5 OR altura >= 5 → asumimos cm (ej: 75x92, 282x92, 46x92)
        // Si base < 5 AND altura < 5 → asumimos metros (ej: 0.75x0.12, 1.2x2.29)
        // Umbral de 5: ningún arte en cm mide menos de 5cm, y ningún arte en metros mide más de 5m
        const enCm = (b >= 5 || h >= 5);
        if (enCm) return (b / 100) * (h / 100) * c;
        return b * h * c; // ya en metros
    }

    function nombreArchivo(o) {
        const d = o.fecha instanceof Date ? o.fecha : new Date(); const mm = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0');
        let pName = (o.proyecto||'PROYECTO').replace(/[^a-zA-Z0-9_\- ]/g, "").trim().replace(/ /g, '_');
        let cName = (o.cliente||'CLIENTE').replace(/[^a-zA-Z0-9_\- ]/g, "").trim().replace(/ /g, '_');
        return `${mm}${dd}_${pName}_${cName}_${o.sufijo}.pdf`;
    }

    /** Los mismos pasos que _loadArtsFromFirebase + _initAllArtsData de produccion.html, sin pantalla. */
    function armarArtes(items, guardadas) {
        const allItems = items || [];
        const artsData = {};
        const iniciados = new Set();
        Object.keys(guardadas || {}).forEach(itemIdx => {
            const saved = guardadas[itemIdx];
            iniciados.add(String(itemIdx));
            artsData[itemIdx] = Array.isArray(saved) ? saved : [];
        });
    function getPrecioFromApu(itemIdx, material) {
            const item = allItems[itemIdx];
            if (!item || !item.apu) return 0;
            const matL = material.toLowerCase();
            for (const t of ['mat', 'sub']) {
                const sec = item.apu[t];
                if (!sec) continue;
                const keys = getValidKeys(sec);
                for (const k of keys) {
                    const m = sec[k];
                    const mName = (m.d || '').toLowerCase();
                    if (mName.includes('lona') || mName.includes('adhesivo') || mName.includes('vinil') || mName.includes('banner') || mName.includes('sublim')) {
                        return parseFloat(m.p || m.pu || 0);
                    }
                }
            }
            return 0;
        }
    function _initAllArtsData(iniciados) {
            getValidKeys(allItems).forEach(idx => {
                const item = allItems[idx];
                if (!item || item.type === 'chapter') return;
                const mainIsG = isGraphicTarget(item.desc, item.und);
                const gApus = [];
                if (item.apu) {
                    ['mat','sub','mo','eq'].forEach(t => {
                        if (item.apu[t]) getValidKeys(item.apu[t]).forEach(aIdx => {
                            const apu = item.apu[t][aIdx];
                            if (isGraphicTarget(apu.d, apu.u)) gApus.push({ t, aIdx, apu });
                        });
                    });
                }
                if (!mainIsG && gApus.length === 0) return;
                if (iniciados.has(String(idx))) return; // ya inicializado (incluso si vacío)
                artsData[idx] = [];
                // calcArtM2 detecta unidad automáticamente — guardar tal como vienen
                if (mainIsG && item.measures) {
                    getValidKeys(item.measures).forEach(mIdx => {
                        const m = item.measures[mIdx];
                        if (!m.d && !m.b) return;
                        const mat = detectMaterialFromName(m.d || item.desc);
                        artsData[idx].push({ id: 'm_'+mIdx, nombre: m.desc||m.d||item.desc, base: parseFloat(m.b)||0, altura: parseFloat(m.h)||0, cantidad: parseFloat(m.c)||1, material: mat, precio: getPrecioFromApu(idx,mat), imgRef: m.img||'', fromApuIdx: null });
                    });
                }
                gApus.forEach(pack => {
                    if (pack.apu.measures) {
                        getValidKeys(pack.apu.measures).forEach(mIdx => {
                            const m = pack.apu.measures[mIdx];
                            if (!m.d && !m.b) return;
                            const mat = detectMaterialFromName(m.d || pack.apu.d);
                            artsData[idx].push({ id: 'apu_'+pack.t+'_'+pack.aIdx+'_'+mIdx, nombre: m.desc||m.d||pack.apu.d, base: parseFloat(m.b)||0, altura: parseFloat(m.h)||0, cantidad: parseFloat(m.c)||1, material: mat, precio: parseFloat(pack.apu.p||pack.apu.pu||0)||getPrecioFromApu(idx,mat), imgRef: m.img||'', fromApuIdx: pack.aIdx });
                        });
                    } else {
                        const mat = detectMaterialFromName(pack.apu.d);
                        const und2 = (pack.apu.u || pack.apu.und || '').toLowerCase();
                        const qVal2 = parseFloat(pack.apu.q || 1);
                        const esM2b = und2 === 'm2' || und2 === 'm²';
                        artsData[idx].push({ id: 'apu_'+pack.t+'_'+pack.aIdx, nombre: pack.apu.d, base: 0, altura: 0, cantidad: qVal2, material: mat, precio: parseFloat(pack.apu.p||pack.apu.pu||0), imgRef: '', fromApuIdx: pack.aIdx, m2_directo: esM2b ? qVal2 : 0 });
                    }
                });
                iniciados.add(String(idx)); // marcar como inicializado
            });
        }
        _initAllArtsData(iniciados);
        return artsData;
    }

    function crear(ctx) {
        const allItems = ctx.items || [];
        const artsData = ctx.artsData || armarArtes(allItems, ctx.artesGuardadas);

    async function exportPdfCompleto() {
            // Genera artes + producción en un solo jsPDF doc
            const jsPDF = ctx.jsPDF;
            const doc = new jsPDF('p', 'mm', 'a4');
            const margin = 14; const pageW = 210; const usableW = pageW - margin * 2;
            const pName = ctx.proyecto || 'Proyecto';
            const fecha = ctx.fecha;
    
            // ── Portada ──
            doc.setFillColor(0,122,255); doc.rect(0,0,pageW,40,'F');
            doc.setTextColor(255,255,255); doc.setFont(undefined,'bold'); doc.setFontSize(16);
            doc.text('ORDEN DE PRODUCCIÓN COMPLETA', margin, 18);
            doc.setFontSize(10); doc.setFont(undefined,'normal');
            doc.text('Rubik Bolivia  ·  ' + pName, margin, 27);
            doc.text('Fecha: ' + fecha, pageW - margin, 27, { align:'right' });
    
            let y = 50;
    
            // ── Sección Artes ──
            const artsItems = [];
            let totalM2G = 0, totalBsG = 0;
            getValidKeys(allItems).forEach(i => {
                const item = allItems[i];
                if (!item || item.type === 'chapter') return;
                const arts = (artsData && artsData[i]) || [];
                if (arts.length === 0) return;
                let iM2 = 0, iBs = 0;
                const rows = arts.map(art => {
                    const m2 = calcArtM2(art);
                    const pu = parseFloat(art.precio) || 0;
                    const bs = m2 * pu;
                    iM2 += m2; iBs += bs; totalM2G += m2; totalBsG += bs;
                    return [art.nombre||'—', art.base+'x'+art.altura, art.cantidad, art.material, m2.toFixed(2), pu > 0 ? pu.toFixed(2) : '—', bs > 0 ? bs.toFixed(2) : '—'];
                });
                artsItems.push({ item, arts, rows, iM2, iBs });
            });
    
            if (artsItems.length > 0) {
                doc.setFont(undefined,'bold'); doc.setFontSize(12); doc.setTextColor(175,82,222);
                doc.text('SECCIÓN 1 — ARTES E IMPRESIÓN', margin, y); y += 8;
    
                const td = [];
                artsItems.forEach(ic => ic.rows.forEach((row, rI) => td.push([rI===0?ic.item.desc:'', ...row])));
                doc.autoTable({
                    startY: y,
                    head: [['Item','Arte','B x H (cm)','Cant','Material','m²','P.U. (Bs)','Subtotal (Bs)']],
                    body: td, theme:'grid',
                    headStyles:{ fillColor:[175,82,222], fontSize:7, fontStyle:'bold' },
                    styles:{ fontSize:7, cellPadding:1.5 },
                    columnStyles:{ 0:{fontStyle:'bold',cellWidth:30}, 5:{halign:'right'}, 6:{halign:'right'}, 7:{halign:'right',fontStyle:'bold'} }
                });
                y = doc.lastAutoTable.finalY + 5;
                doc.setFillColor(175,82,222); doc.rect(margin,y,usableW,7,'F');
                doc.setTextColor(255,255,255); doc.setFont(undefined,'bold'); doc.setFontSize(8);
                doc.text(`TOTAL IMPRESIÓN: ${totalM2G.toFixed(2)} m²   |   TOTAL: ${totalBsG.toFixed(2)} Bs`, margin+2, y+5);
                y += 14;
            }
    
            // ── Sección Producción ──
            // Only add a page if there was arts content; otherwise continue on page 1
            if (artsItems.length > 0) { doc.addPage(); y = margin; } else { y += 6; }
            doc.setFont(undefined,'bold'); doc.setFontSize(12); doc.setTextColor(0,122,255);
            doc.text('SECCIÓN 2 — PRODUCCIÓN Y ESTRUCTURAS', margin, y); y += 10;
    
            // Reutilizar lógica de exportPdfItems pero escribiendo en doc existente
            // (delegamos a una versión que recibe el doc)
            await _exportItemsIntoDoc(doc, y, margin, pageW, usableW);
    
            return { doc, sufijo: "ORDEN_COMPLETA" };
        }

    async function _exportItemsIntoDoc(doc, y, margin, pageW, usableW) {
            getValidKeys(allItems).forEach((i) => {
                const item = allItems[i];
                if (!item) return;
                if (item.type === 'chapter') {
                    if (y > 260) { doc.addPage(); y = margin; }
                    doc.setFillColor(0,80,160); doc.rect(margin, y, usableW, 8, 'F');
                    doc.setTextColor(255,255,255); doc.setFont(undefined,'bold'); doc.setFontSize(10);
                    // Chapters use item.name; item.desc is a fallback
                    doc.text((item.name || item.desc || 'Capítulo').substring(0, 80), margin + 3, y + 5.5); y += 12;
                    return;
                }
                if (y > 250) { doc.addPage(); y = margin; }
                // Item title
                doc.setFont(undefined,'bold'); doc.setFontSize(9); doc.setTextColor(0,80,160);
                const _titleLines = doc.splitTextToSize((item.desc || 'Ítem'), usableW - 2);
                doc.text(_titleLines, margin, y + 5);
                y += _titleLines.length * 5 + 2;
                // Quantity line
                doc.setFont(undefined,'normal'); doc.setFontSize(8); doc.setTextColor(80,80,80);
                doc.text('Cant: ' + (item.cant||'') + ' ' + (item.und||''), margin, y);
                y += 5;
                // Feat (description / medidas reales) — now starts AFTER the title+cant block
                if (item.feat) {
                    const _featTxt = (item.feat || '').replace(/\n/g, ' | ').substring(0, 300);
                    const _fl = doc.splitTextToSize(_featTxt, usableW - 2);
                    doc.setFontSize(7.5); doc.setFont(undefined, 'italic'); doc.setTextColor(100, 100, 100);
                    doc.text(_fl, margin, y);
                    y += _fl.length * 4 + 2;
                }
                y += 2; // padding before tables
    
                // Materiales (sin precios)
                if (item.prod_apu && item.prod_apu.mat && item.prod_apu.mat.length > 0) {
                    const matRows = item.prod_apu.mat.filter(m=>m.d).map(m => [m.d, m.q + ' ' + (m.u||'')]);
                    if (matRows.length > 0) {
                        doc.autoTable({
                            startY: y,
                            head: [['Material requerido', 'Cantidad']],
                            body: matRows, theme:'striped',
                            headStyles:{ fillColor:[80,80,80], fontSize:7, fontStyle:'bold' },
                            styles:{ fontSize:7, cellPadding:1.5 },
                            columnStyles:{ 0:{cellWidth:120}, 1:{cellWidth:40, halign:'right'} }
                        });
                        y = doc.lastAutoTable.finalY + 4;
                    }
                } else if ((item.prod_apu && item.prod_apu.mat) || (item.apu && item.apu.mat)) {
                    const _mSrc2 = (item.prod_apu && item.prod_apu.mat && Object.keys(item.prod_apu.mat).length > 0) ? item.prod_apu.mat : item.apu.mat;
                    const apuMats = Object.values(_mSrc2).filter(m=>m.d && !isGraphicTarget(m.d,m.u));
                    if (apuMats.length > 0) {
                        const matRows = apuMats.map(m => [m.d, m.q + ' ' + (m.u||'')]);
                        doc.autoTable({
                            startY: y,
                            head: [['Material requerido', 'Cantidad']],
                            body: matRows, theme:'striped',
                            headStyles:{ fillColor:[80,80,80], fontSize:7, fontStyle:'bold' },
                            styles:{ fontSize:7, cellPadding:1.5 },
                            columnStyles:{ 0:{cellWidth:120}, 1:{cellWidth:40, halign:'right'} }
                        });
                        y = doc.lastAutoTable.finalY + 4;
                    }
                }
    
                // Mano de obra (solo descripción, sin precio)
                if (item.prod_apu && item.prod_apu.mo && item.prod_apu.mo.length > 0) {
                    const moRows = item.prod_apu.mo.filter(m=>m.d).map(m => [m.d, m.q + ' ' + (m.u||'') + (m.modo && m.modo!=='hr' ? ' ('+m.modo+')' : '')]);
                    if (moRows.length > 0) {
                        doc.autoTable({
                            startY: y,
                            head: [['Mano de obra', 'Cantidad/Modo']],
                            body: moRows, theme:'striped',
                            headStyles:{ fillColor:[120,80,0], fontSize:7, fontStyle:'bold', textColor:255 },
                            styles:{ fontSize:7, cellPadding:1.5 },
                            columnStyles:{ 0:{cellWidth:120}, 1:{cellWidth:40, halign:'right'} }
                        });
                        y = doc.lastAutoTable.finalY + 4;
                    }
                }
    
                // Proceso IA
                if (item.proceso_ia && item.proceso_ia.length > 0) {
                    const rows = item.proceso_ia.map(r => [r.m||'', r.d||'']);
                    doc.autoTable({
                        startY: y,
                        head: [['Herramienta / Material', 'Paso de fabricación']],
                        body: rows, theme:'striped',
                        headStyles:{ fillColor:[0,122,255], fontSize:7 },
                        styles:{ fontSize:7, cellPadding:1.5 },
                        columnStyles:{ 0:{cellWidth:40, fontStyle:'bold'}, 1:{} }
                    });
                    y = doc.lastAutoTable.finalY + 6;
                }
            });
        }

    async function exportPdfPrints(soloConImagen = false) {
            // artsData lo arma quien llama (la pantalla con lo que tiene cargado; el servidor con armarArtes)
    
            const jsPDF = ctx.jsPDF;
            const doc = new jsPDF('p', 'mm', 'a4');
            const margin = 12; const pageW = 210; const usableW = pageW - margin * 2;
            let y = margin;
            const pName = ctx.proyecto || 'Proyecto';
            const fecha = ctx.fecha;
    
            // ── HEADER ──
            doc.setFillColor(175, 82, 222); doc.rect(0, 0, pageW, 28, 'F');
            doc.setTextColor(255,255,255); doc.setFont(undefined,'bold'); doc.setFontSize(13);
            doc.text('ORDEN DE IMPRESIÓN — RUBIK BOLIVIA', margin, 11);
            doc.setFontSize(8); doc.setFont(undefined,'normal');
            doc.text('Proyecto: ' + pName + (soloConImagen ? '   [Solo artes con captura]' : ''), margin, 19);
            doc.text('Fecha: ' + fecha, pageW - margin, 19, { align:'right' });
            y = 34;
    
            let totalM2Global = 0; let totalBsGlobal = 0;
            let itemsConArtes = [];
    
            // Helper: imagen válida = base64 O url http(s)
            const tieneImagen = (imgRef) => imgRef && (imgRef.startsWith('data:image') || imgRef.startsWith('http'));
    
            getValidKeys(allItems).forEach((i) => {
                const item = allItems[i];
                if (!item || item.type === 'chapter') return;
                const allArts = (artsData && artsData[i]) || [];
                // Filtrar según modo
                const arts = soloConImagen
                    ? allArts.filter(a => tieneImagen(a.imgRef))
                    : allArts;
                if (arts.length === 0) return;
                let itemM2 = 0; let itemBs = 0;
                arts.forEach(art => {
                    const m2 = calcArtM2(art);
                    const bs = m2 * (parseFloat(art.precio) || 0);
                    itemM2 += m2; itemBs += bs;
                    totalM2Global += m2; totalBsGlobal += bs;
                });
                itemsConArtes.push({ item, arts, itemM2, itemBs });
            });
    
            if (itemsConArtes.length === 0) {
                doc.setTextColor(0,0,0); doc.setFontSize(11);
                doc.text(soloConImagen ? 'No hay artes con captura registrada.' : 'No hay artes registrados.', margin, y);
                return { doc, sufijo: "ORDEN_IMPRESION" };
            }
    
            // ── TABLA RESUMEN ──
            const tableData = [];
            itemsConArtes.forEach(ic => {
                ic.arts.forEach((art, rI) => {
                    const m2 = calcArtM2(art);
                    const bs = m2 * (parseFloat(art.precio) || 0);
                    const pu = parseFloat(art.precio) || 0;
                    tableData.push([
                        rI === 0 ? (ic.item.desc || '').substring(0,35) : '',
                        (art.nombre || '—').substring(0,40),
                        art.base + ' x ' + art.altura,
                        String(art.cantidad),
                        (art.material || '').substring(0,16),
                        m2.toFixed(2),
                        pu > 0 ? pu.toFixed(2) : '—',
                        bs > 0 ? bs.toFixed(2) : '—'
                    ]);
                });
            });
    
            doc.autoTable({
                startY: y,
                head: [['Item', 'Arte', 'B x H (cm)', 'Cant', 'Material', 'm²', 'P.U. Bs', 'Subtotal Bs']],
                body: tableData,
                theme: 'grid',
                headStyles: { fillColor: [175,82,222], fontSize: 7, fontStyle: 'bold', textColor: 255 },
                styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
                columnStyles: {
                    0: { fontStyle:'bold', cellWidth: 32 },
                    1: { cellWidth: 45 },
                    2: { cellWidth: 22, halign:'center' },
                    3: { cellWidth: 10, halign:'center' },
                    4: { cellWidth: 26 },
                    5: { cellWidth: 14, halign:'right', fontStyle:'bold', textColor: [0,80,160] },
                    6: { cellWidth: 16, halign:'right' },
                    7: { cellWidth: 18, halign:'right', fontStyle:'bold', textColor: [52,199,89] }
                }
            });
            y = doc.lastAutoTable.finalY + 5;
    
            // Barra total
            doc.setFillColor(175,82,222); doc.rect(margin, y, usableW, 8, 'F');
            doc.setTextColor(255,255,255); doc.setFont(undefined,'bold'); doc.setFontSize(8.5);
            const totalTxt = `TOTAL: ${totalM2Global.toFixed(2)} m²   |   ${totalBsGlobal.toFixed(2)} Bs`;
            doc.text(totalTxt, margin + 3, y + 5.5);
            y += 14;
    
            // ── DETALLE POR ÍTEM: una fila por arte, layout horizontal ──
            for (const ic of itemsConArtes) {
                // Cabecera de ítem
                if (y > 255) { doc.addPage(); y = margin; }
                doc.setFillColor(230,220,250); doc.rect(margin, y, usableW, 7, 'F');
                doc.setFont(undefined,'bold'); doc.setFontSize(9); doc.setTextColor(80,0,160);
                doc.text((ic.item.desc || '').substring(0,80), margin + 3, y + 5);
                y += 10;
    
                for (const art of ic.arts) {
                    const m2 = calcArtM2(art);
                    const bs = m2 * (parseFloat(art.precio) || 0);
                    const hasImg = tieneImagen(art.imgRef);
    
                    // Altura de fila: con imagen = 34mm, sin imagen = 18mm
                    const rowH = hasImg ? 34 : 18;
                    if (y + rowH > 280) { doc.addPage(); y = margin; }
    
                    // Borde contenedor
                    doc.setDrawColor(210,210,210); doc.setLineWidth(0.3);
                    doc.rect(margin, y, usableW, rowH);
    
                    // ── Zona izquierda: datos del arte ──
                    // Imagen siempre 30mm máximo — info ocupa el resto
                    const IMG_COL = 32; // 30mm imagen + 2mm margen
                    const infoW = hasImg ? usableW - IMG_COL : usableW;
                    const tx = margin + 3;
    
                    // Nombre del arte
                    doc.setFont(undefined,'bold'); doc.setFontSize(8.5); doc.setTextColor(0,0,0);
                    const nombreLines = doc.splitTextToSize(art.nombre || 'Arte sin nombre', infoW - 4);
                    doc.text(nombreLines, tx, y + 5);
                    const afterNombre = y + 5 + (nombreLines.length * 4.5);
    
                    // Dimensiones + cantidad
                    doc.setFont(undefined,'normal'); doc.setFontSize(7.5); doc.setTextColor(60,60,60);
                    doc.text('Base: ' + art.base + ' cm   Altura: ' + art.altura + ' cm   Cant: ' + art.cantidad + ' pza(s)', tx, afterNombre + 1);
    
                    // Material
                    doc.setFont(undefined,'bold'); doc.setFontSize(7); doc.setTextColor(120,0,200);
                    doc.text('Material: ' + (art.material || '—'), tx, afterNombre + 6);
    
                    // m² (sin precio — PDF va al trabajador/cliente)
                    doc.setFont(undefined,'bold'); doc.setFontSize(7.5); doc.setTextColor(0,80,160);
                    doc.text('Superficie: ' + m2.toFixed(2) + ' m²', tx, afterNombre + 11.5);
    
                    // ── Zona derecha: imagen referencial ──
                    if (hasImg) {
                        try {
                            // Celda de imagen: máximo 30mm de ancho y rowH-4 de alto
                            const maxImgW = 30;
                            const maxImgH = rowH - 4;
                            const imgX = margin + infoW + 2;
                            let imgData = art.imgRef;
                            if (art.imgRef.startsWith('http')) {
                                imgData = await ctx.cargarImagen(art.imgRef);
                            }
                            if (imgData) {
                                // Usar getImageProperties de jsPDF para no crear Image() extra
                                let natW = maxImgW, natH = maxImgH;
                                try {
                                    const props = doc.getImageProperties(imgData);
                                    if (props && props.width && props.height) {
                                        natW = props.width; natH = props.height;
                                    }
                                } catch(_) {}
                                // Contain: escalar para caber en maxImgW × maxImgH
                                const scale = Math.min(maxImgW / natW, maxImgH / natH);
                                const drawW = Math.min(natW * scale, maxImgW);
                                const drawH = Math.min(natH * scale, maxImgH);
                                // Centrar dentro de la celda de imagen
                                const offX = (maxImgW - drawW) / 2;
                                const offY = (maxImgH - drawH) / 2;
                                // Dibujar borde de celda primero
                                doc.setDrawColor(180,180,180); doc.setLineWidth(0.2);
                                doc.rect(imgX, y + 2, maxImgW, maxImgH);
                                doc.addImage(imgData, 'JPEG', imgX + offX, y + 2 + offY, drawW, drawH);
                            }
                        } catch(imgErr) { /* imagen no disponible */ }
                    }
    
                    y += rowH + 2;
                }
    
                // Subtotal del ítem
                doc.setFont(undefined,'bold'); doc.setFontSize(7.5); doc.setTextColor(100,100,100);
                doc.text('Subtotal ' + (ic.item.desc||'').substring(0,30) + ': ' + ic.itemM2.toFixed(2) + ' m²', margin, y + 4);
                y += 9;
            }
    
            // Total final al pie
            if (y > 270) { doc.addPage(); y = margin; }
            doc.setFillColor(175,82,222); doc.rect(margin, y, usableW, 9, 'F');
            doc.setTextColor(255,255,255); doc.setFont(undefined,'bold'); doc.setFontSize(9);
            doc.text('TOTAL IMPRESIÓN: ' + totalM2Global.toFixed(2) + ' m²', margin + 3, y + 6);
    
            return { doc, sufijo: "ORDEN_IMPRESION" };
        }

    async function exportPdfItems() {
            const jsPDF = ctx.jsPDF; const doc = new jsPDF('p', 'mm', 'a4');
            const margin = 15; let y = margin;
            
            doc.setFontSize(22); doc.setFont(undefined, 'bold'); doc.text("PRODUCCIÓN TÉCNICA - RUBIK OS", margin, y + 10);
            doc.setFontSize(11); doc.setFont(undefined, 'normal'); doc.text(`PROYECTO: ${ctx.proyecto}`, margin, y + 20); doc.text(`FECHA DE EMISIÓN: ${ctx.fechaCorta || ctx.fecha}`, margin, y + 26);
            y += 40;
            
            const summaryRows = [];
            getValidKeys(allItems).forEach((i) => {
                let item = allItems[i];
                if(!item || item.type === 'chapter') { summaryRows.push([{content: (item.name||'').toUpperCase(), colSpan: 3, styles: {fillColor: [220,220,220], fontStyle:'bold'}}]); } 
                else {
                    let mIsG = isGraphicTarget(item.desc, item.und); let hasS = !mIsG; 
                    if(item.apu) { ['mat', 'sub', 'mo', 'eq'].forEach(t => { if(item.apu[t]) { getValidKeys(item.apu[t]).forEach(aIdx => { if(!isGraphicTarget(item.apu[t][aIdx].d, item.apu[t][aIdx].u)) hasS = true; }); } }); }
                    if(hasS) summaryRows.push([`${stripZeros(item.cant)} ${item.und}`, item.desc, item.prod_resp || 'Sin asignar']); 
                }
            });
    
            doc.autoTable({ startY: y, head: [['CANT', 'ÍTEM', 'RESPONSABLE']], body: summaryRows, theme: 'grid', headStyles: { fillColor: [0, 122, 255] } });
            doc.addPage(); y = margin; 
    
            let validItemIndices = getValidKeys(allItems);
            let isFirstPage = true;
            
            for (let i of validItemIndices) {
                let item = allItems[i]; if(!item || item.type === 'chapter') continue; 
                let mIsG = isGraphicTarget(item.desc, item.und); let hasS = !mIsG;
                if(item.apu) { ['mat', 'sub', 'mo', 'eq'].forEach(t => { if(item.apu[t]) { getValidKeys(item.apu[t]).forEach(aIdx => { if(!isGraphicTarget(item.apu[t][aIdx].d, item.apu[t][aIdx].u)) hasS = true; }); } }); }
                if(!hasS) continue; 
    
                if(!isFirstPage) { doc.addPage(); }
                isFirstPage = false;
                y = margin;
    
                const startY = y; doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.setTextColor(0, 100, 255);
                let title = `${stripZeros(item.cant)} ${item.und} - ${item.desc}`;
                let splitTitle = doc.splitTextToSize(title, 170); doc.text(splitTitle, margin + 5, y + 7); y += (splitTitle.length * 6) + 4;
    
                let infoStartY = y;
                doc.setFontSize(9); doc.setFont(undefined, 'normal');
    
                let leftText = "";
                if(item.feat) leftText += `DESCRIPCIÓN:\n${item.feat}\n\n`;
                let rootMKeys = getValidKeys(item.measures);
                if(rootMKeys.length > 0 && !mIsG) {
                    leftText += 'CÓMPUTO MÉTRICO:\n';
                    rootMKeys.forEach(mIdx => { let m = item.measures[mIdx]; if(m.d || m.b) leftText += `- ${m.d}: ${m.b} x ${m.h} (${m.c})\n`; });
                }
                if(item.apu) {
                    ['mat', 'sub'].forEach(t => {
                        if(item.apu[t]) {
                            getValidKeys(item.apu[t]).forEach(aIdx => {
                                let apu = item.apu[t][aIdx];
                                let apuM = getValidKeys(apu.measures);
                                if(apuM.length > 0 && !isGraphicTarget(apu.d, apu.u)) {
                                    leftText += `\nCORTES [${apu.d}]:\n`;
                                    apuM.forEach(mIdx => { let m = apu.measures[mIdx]; if(m.d || m.b) leftText += `- ${m.d}: ${m.b} x ${m.h} (${m.c})\n`; });
                                }
                            });
                        }
                    });
                }
                let leftLines = doc.splitTextToSize(leftText.trim() || 'Sin descripción detallada.', 85);
    
                let rightText = "MATERIALES REQUERIDOS:\n";
                let hasMats = false;
                const _matSrc = (item.prod_apu && item.prod_apu.mat && getValidKeys(item.prod_apu.mat).length > 0) ? item.prod_apu.mat : (item.apu && item.apu.mat ? item.apu.mat : null);
                if(_matSrc) {
                    let mats = getValidKeys(_matSrc);
                    if(mats.length > 0) {
                        hasMats = true;
                        mats.forEach(mIdx => { let m = _matSrc[mIdx]; if(m.d && !isGraphicTarget(m.d, m.u)) { rightText += `• ${m.d} : ${stripZeros(m.q)} ${m.u||''}
    `; } });
                    }
                }
                if(!hasMats) rightText += "Ninguno especificado.";
                let rightLines = doc.splitTextToSize(rightText.trim(), 85);
    
                let maxLines = Math.max(leftLines.length, rightLines.length);
                let boxHeight = (maxLines * 4) + 16; 
    
                doc.setDrawColor(200); doc.setFillColor(250, 250, 250);
                doc.rect(margin, infoStartY, 180, boxHeight, 'FD');
    
                doc.setTextColor(0);
                doc.setFont(undefined, 'bold'); doc.text("RESPONSABLE: ", margin + 5, infoStartY + 6);
                doc.setFont(undefined, 'normal'); doc.text(item.prod_resp || "Sin asignar", margin + 35, infoStartY + 6);
    
                doc.text(leftLines, margin + 5, infoStartY + 14);
                doc.text(rightLines, margin + 95, infoStartY + 14);
    
                doc.setDrawColor(220); doc.line(margin + 90, infoStartY + 10, margin + 90, infoStartY + boxHeight - 3);
    
                y = infoStartY + boxHeight + 5;
    
                if(item.proceso_ia) {
                    doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.text("FICHA DE FABRICACIÓN (IA):", margin, y); y += 4;
                    const rowsIA = item.proceso_ia.map(r => [r.m, r.d]);
                    doc.autoTable({ 
                        startY: y, 
                        head: [['Material/Herramienta', 'Proceso Puntual']], 
                        body: rowsIA, 
                        theme: 'striped', 
                        styles: { cellPadding: 1.5, fontSize: 8, textColor: [40,40,40] },
                        headStyles: { fillColor: [0, 122, 255], fontSize: 9, cellPadding: 2 },
                        alternateRowStyles: { fillColor: [245, 245, 245] },
                        foot: [[{ content: "Pregúntale a la IA en tu app para más detalles.", colSpan: 2, styles: { fontStyle: 'italic', halign: 'center', fontSize: 7, textColor: [150,150,150] } }]] 
                    });
                    y = doc.lastAutoTable.finalY + 8;
                }
    
                let images = [];
                if(item.img) { let b = await ctx.cargarImagen(item.img); if(b) images.push(b); }
                if(item.op_images) { for(let opIdx of getValidStringsKeys(item.op_images)) { let b = await ctx.cargarImagen(item.op_images[opIdx]); if(b) images.push(b); } }
                if(item.cortes) { for(let cIdx of getValidStringsKeys(item.cortes)) { let b = await ctx.cargarImagen(item.cortes[cIdx]); if(b) images.push(b); } }
                if(item.apu) {
                    for(let t of ['mat', 'sub']) {
                        if(item.apu[t]) {
                            for(let aIdx of getValidKeys(item.apu[t])) {
                                let apu = item.apu[t][aIdx];
                                if(apu.corte_url) { let b = await ctx.cargarImagen(apu.corte_url); if(b) images.push(b); }
                            }
                        }
                    }
                }
    
                const pad = 3;
                const drawBoxImg = (b64, xP, yP, bW, bH) => {
                    const innerW = bW - (pad*2); const innerH = bH - (pad*2);
                    if(b64 && b64.startsWith('data:image')) {
                        try {
                            let format = b64.indexOf('data:image/png') === 0 ? 'PNG' : 'JPEG';
                            const props = doc.getImageProperties(b64);
                            if(props && props.width && props.height) {
                                const ratio = props.width / props.height;
                                let w = innerW, h = w / ratio; if(h > innerH) { h = innerH; w = h * ratio; }
                                let cx = xP + pad + (innerW - w)/2; let cy = yP + pad + (innerH - h)/2;
                                doc.addImage(b64, format, cx, cy, w, h);
                                doc.setDrawColor(220); doc.rect(xP, yP, bW, bH);
                            }
                        } catch(e) { }
                    }
                };
    
                const pageH = 297;             
                const bottomMargin = 15;       
                const colW = 90, rowH = 90;    
                let col = 0;
                let imagesStartY = y;
    
                for (let j = 0; j < images.length; j++) {
                    if (col === 0 && y + rowH > pageH - bottomMargin) {
                        doc.setDrawColor(100); doc.rect(margin, imagesStartY - 2, 180, (y - imagesStartY) + 4);
    
                        doc.addPage(); y = margin;
                        doc.setFontSize(13); doc.setFont(undefined, 'bold'); doc.setTextColor(0, 100, 255);
                        const cont = doc.splitTextToSize(`${item.desc} — continuación`, 170);
                        doc.text(cont, margin, y + 6);
                        y += (cont.length * 6) + 6;
                        imagesStartY = y;
                    }
                    const px = margin + col * colW;
                    drawBoxImg(images[j], px, y, colW, rowH);
                    col++;
                    if (col >= 2) { col = 0; y += rowH; }
                }
                if (col > 0) y += rowH; 
    
                if (images.length > 0) {
                    doc.setDrawColor(100); doc.rect(margin, imagesStartY - 2, 180, (y - imagesStartY) + 4);
                }
            }
    
            return { doc, sufijo: "ESTRUCTURAS" };
        }

        return { exportPdfCompleto, exportPdfPrints, exportPdfItems };
    }

    function generar(tipo, ctx) {
        const g = crear(ctx);
        if (tipo === 'impresion') return g.exportPdfPrints(false);
        if (tipo === 'impresion_con_imagen') return g.exportPdfPrints(true);
        if (tipo === 'completa') return g.exportPdfCompleto();
        return g.exportPdfItems();
    }

    const api = { generar, armarArtes, nombreArchivo, isGraphicTarget, calcArtM2 };
    global.PdfProduccion = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
