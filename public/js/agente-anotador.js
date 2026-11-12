/**
 * agente-anotador.js — Editor de anotaciones sobre fotos para el Agente IA (entrega 3).
 *
 * Capa VECTORIAL (SVG) sobre la foto, editable y con deshacer/rehacer:
 *   📏 cota      línea fina con flechas o ticks y el valor en una etiqueta chica semitransparente, corrida de la línea
 *   ⭕ ▭ marca    círculo/elipse o rectángulo
 *   T  nota      texto en un punto
 * Al terminar devuelve: las anotaciones en JSON (coordenadas en píxeles de la foto que se manda) y la foto anotada
 * (JPEG). Al agente se le mandan la foto original + la anotada + el JSON, para que lea los valores sin adivinar:
 *   { tipo:"cota", n, valor:"4,00 m", de:[x,y], a:[x,y], extremos:"flechas"|"ticks", nota? }
 *   { tipo:"marca", n, forma:"circulo"|"rectangulo", de:[x,y], a:[x,y], nota? }
 *   { tipo:"nota", n, texto, en:[x,y] }
 * Uso: AgenteAnotador.editar({ blob, ancho, alto, canvas }, nombre, previas?) → Promise<null | {cancelado} | {anotaciones, blob, miniatura, editor}>
 * (null = "Mandar sin anotar").
 */
(function (global) {
    'use strict';

    var COLORES = ['#ff3b30', '#ffcc00', '#00e5ff', '#ffffff'];
    var SVGNS = 'http://www.w3.org/2000/svg';
    var st = null;   // estado del editor abierto

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function clon(x) { return JSON.parse(JSON.stringify(x)); }
    function el(tag, attrs, padre) {
        var e = document.createElementNS(SVGNS, tag);
        Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
        if (padre) padre.appendChild(e);
        return e;
    }

    // ------------------------------------------------------------------ geometría (compartida entre pantalla y exportación)
    /** Medidas de trazo y texto en píxeles de la foto: finas, proporcionales al tamaño. */
    function escala(w, h) {
        var lado = Math.max(w, h);
        return { trazo: Math.max(1.5, lado / 900), punta: Math.max(7, lado / 110), tick: Math.max(5, lado / 160), letra: Math.max(13, Math.round(lado / 60)), pad: Math.max(3, lado / 400) };
    }
    /** Dónde va la etiqueta de una cota: al costado de la línea (perpendicular), para no taparla. */
    function posEtiqueta(a, b, e) {
        var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
        var nx = -dy / L, ny = dx / L;
        if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }   // siempre hacia "arriba"
        var off = e.letra * 0.9;
        var ang = Math.atan2(dy, dx) * 180 / Math.PI;
        if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
        return { x: (a[0] + b[0]) / 2 + nx * off, y: (a[1] + b[1]) / 2 + ny * off, ang: ang };
    }
    function anchoTexto(t, letra) { return String(t).length * letra * 0.58 + 2; }

    // ------------------------------------------------------------------ dibujo SVG (pantalla)
    function dibujar() {
        var g = st.capa;
        while (g.firstChild) g.removeChild(g.firstChild);
        var e = escala(st.w, st.h);
        st.anot.forEach(function (a, i) { dibujarUna(g, a, e, i === st.sel); });
        if (st.borrador) dibujarUna(g, st.borrador, e, false);
        $('an-undo').disabled = !st.historial.length;
        $('an-redo').disabled = !st.rehacer.length;
        $('an-cuenta').textContent = st.anot.length ? st.anot.length + (st.anot.length > 1 ? ' anotaciones' : ' anotación') : 'Sin anotaciones';
    }
    function etiqueta(g, x, y, texto, e, color, ang) {
        var w = anchoTexto(texto, e.letra), h = e.letra * 1.25;
        var grupo = el('g', { transform: 'translate(' + x + ',' + y + ') rotate(' + (ang || 0) + ')' }, g);
        var fondo = el('rect', { x: -w / 2 - e.pad, y: -h / 2, width: w + 2 * e.pad, height: h, rx: h / 4, fill: 'rgba(0,0,0,0.45)' }, grupo);
        var t = el('text', { x: 0, y: e.letra * 0.36, 'text-anchor': 'middle', 'font-size': e.letra, 'font-family': 'system-ui,-apple-system,sans-serif', 'font-weight': '700', fill: color }, grupo);
        t.textContent = texto;
        try { var real = t.getComputedTextLength(); if (real > 0) { fondo.setAttribute('x', -real / 2 - e.pad); fondo.setAttribute('width', real + 2 * e.pad); } } catch (er) { /* sin medida: queda la estimada */ }
        return grupo;
    }
    function dibujarUna(g, a, e, seleccionada) {
        var color = a.color || COLORES[0];
        var grupo = el('g', { 'data-i': st.anot.indexOf(a) }, g);
        var trazo = { stroke: color, 'stroke-width': e.trazo, fill: 'none', 'stroke-linecap': 'round' };
        if (seleccionada) el(a.tipo === 'nota' ? 'circle' : 'rect', a.tipo === 'nota' ? { cx: a.en[0], cy: a.en[1], r: e.letra * 1.6, fill: 'rgba(0,122,255,.18)' } :
            { x: Math.min(a.de[0], a.a[0]) - e.letra, y: Math.min(a.de[1], a.a[1]) - e.letra * 2, width: Math.abs(a.a[0] - a.de[0]) + 2 * e.letra, height: Math.abs(a.a[1] - a.de[1]) + 3 * e.letra, fill: 'rgba(0,122,255,.12)', stroke: '#007aff', 'stroke-dasharray': '6 4', 'stroke-width': e.trazo }, grupo);
        if (a.tipo === 'cota') {
            el('line', Object.assign({ x1: a.de[0], y1: a.de[1], x2: a.a[0], y2: a.a[1] }, trazo), grupo);
            var dx = a.a[0] - a.de[0], dy = a.a[1] - a.de[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
            [[a.de, 1], [a.a, -1]].forEach(function (p) {
                var x = p[0][0], y = p[0][1], s = p[1];
                if (a.extremos === 'ticks') {
                    var t = e.tick;   // tick a 45°, estilo plano de arquitectura
                    el('line', Object.assign({ x1: x - (ux - uy) * t * 0.7, y1: y - (uy + ux) * t * 0.7, x2: x + (ux - uy) * t * 0.7, y2: y + (uy + ux) * t * 0.7 }, trazo), grupo);
                } else {
                    var pnt = e.punta, ax = x + s * ux * pnt, ay = y + s * uy * pnt;
                    el('polyline', Object.assign({ points: (ax - uy * pnt * 0.4) + ',' + (ay + ux * pnt * 0.4) + ' ' + x + ',' + y + ' ' + (ax + uy * pnt * 0.4) + ',' + (ay - ux * pnt * 0.4) }, trazo), grupo);
                }
            });
            if (a.valor) { var pe = posEtiqueta(a.de, a.a, e); etiqueta(grupo, pe.x, pe.y, a.valor, e, color, pe.ang); }
        } else if (a.tipo === 'marca') {
            var x0 = Math.min(a.de[0], a.a[0]), y0 = Math.min(a.de[1], a.a[1]), w = Math.abs(a.a[0] - a.de[0]), h = Math.abs(a.a[1] - a.de[1]);
            if (a.forma === 'circulo') el('ellipse', Object.assign({ cx: x0 + w / 2, cy: y0 + h / 2, rx: w / 2, ry: h / 2 }, trazo), grupo);
            else el('rect', Object.assign({ x: x0, y: y0, width: w, height: h, rx: e.trazo }, trazo), grupo);
            if (a.nota) etiqueta(grupo, x0 + w / 2, y0 - e.letra * 0.9, a.nota, e, color, 0);
        } else if (a.tipo === 'nota') {
            el('circle', { cx: a.en[0], cy: a.en[1], r: e.trazo * 2, fill: color }, grupo);
            etiqueta(grupo, a.en[0], a.en[1] - e.letra * 0.9, a.texto, e, color, 0);
        }
    }

    // ------------------------------------------------------------------ exportar (canvas con la misma geometría)
    function exportar() {
        var cv = document.createElement('canvas'); cv.width = st.w; cv.height = st.h;
        var cx = cv.getContext('2d');
        cx.drawImage(st.base, 0, 0, st.w, st.h);
        var e = escala(st.w, st.h);
        cx.lineCap = 'round'; cx.lineJoin = 'round';
        function linea(x1, y1, x2, y2) { cx.beginPath(); cx.moveTo(x1, y1); cx.lineTo(x2, y2); cx.stroke(); }
        function etq(x, y, texto, color, ang) {
            cx.save(); cx.translate(x, y); cx.rotate((ang || 0) * Math.PI / 180);
            cx.font = '700 ' + e.letra + 'px system-ui,-apple-system,sans-serif';
            var w = cx.measureText(texto).width, h = e.letra * 1.25;
            cx.fillStyle = 'rgba(0,0,0,0.45)';
            if (cx.roundRect) { cx.beginPath(); cx.roundRect(-w / 2 - e.pad, -h / 2, w + 2 * e.pad, h, h / 4); cx.fill(); } else cx.fillRect(-w / 2 - e.pad, -h / 2, w + 2 * e.pad, h);
            cx.fillStyle = color; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(texto, 0, 1);
            cx.restore();
        }
        st.anot.forEach(function (a) {
            var color = a.color || COLORES[0];
            cx.strokeStyle = color; cx.fillStyle = color; cx.lineWidth = e.trazo;
            if (a.tipo === 'cota') {
                linea(a.de[0], a.de[1], a.a[0], a.a[1]);
                var dx = a.a[0] - a.de[0], dy = a.a[1] - a.de[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
                [[a.de, 1], [a.a, -1]].forEach(function (p) {
                    var x = p[0][0], y = p[0][1], s = p[1];
                    if (a.extremos === 'ticks') { var t = e.tick * 0.7; linea(x - (ux - uy) * t, y - (uy + ux) * t, x + (ux - uy) * t, y + (uy + ux) * t); }
                    else { var pnt = e.punta, ax = x + s * ux * pnt, ay = y + s * uy * pnt; linea(ax - uy * pnt * 0.4, ay + ux * pnt * 0.4, x, y); linea(x, y, ax + uy * pnt * 0.4, ay - ux * pnt * 0.4); }
                });
                if (a.valor) { var pe = posEtiqueta(a.de, a.a, e); etq(pe.x, pe.y, a.valor, color, pe.ang); }
            } else if (a.tipo === 'marca') {
                var x0 = Math.min(a.de[0], a.a[0]), y0 = Math.min(a.de[1], a.a[1]), w = Math.abs(a.a[0] - a.de[0]), h = Math.abs(a.a[1] - a.de[1]);
                cx.beginPath();
                if (a.forma === 'circulo') cx.ellipse(x0 + w / 2, y0 + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); else cx.rect(x0, y0, w, h);
                cx.stroke();
                if (a.nota) etq(x0 + w / 2, y0 - e.letra * 0.9, a.nota, color, 0);
            } else if (a.tipo === 'nota') {
                cx.beginPath(); cx.arc(a.en[0], a.en[1], e.trazo * 2, 0, Math.PI * 2); cx.fill();
                etq(a.en[0], a.en[1] - e.letra * 0.9, a.texto, color, 0);
            }
        });
        return cv;
    }

    /** JSON para el agente: coordenadas enteras, sin color, numeradas. */
    function paraAgente(lista) {
        return lista.map(function (a, i) {
            var r = { tipo: a.tipo, n: i + 1 };
            var p = function (q) { return [Math.round(q[0]), Math.round(q[1])]; };
            if (a.tipo === 'cota') { r.valor = a.valor; r.de = p(a.de); r.a = p(a.a); r.extremos = a.extremos || 'flechas'; r.largo_px = Math.round(Math.hypot(a.a[0] - a.de[0], a.a[1] - a.de[1])); }
            if (a.tipo === 'marca') { r.forma = a.forma; r.de = p(a.de); r.a = p(a.a); }
            if (a.tipo === 'nota') { r.texto = a.texto; r.en = p(a.en); }
            if (a.nota) r.nota = a.nota;
            return r;
        });
    }

    // ------------------------------------------------------------------ interfaz
    function crear() {
        if ($('mod-anot')) return;
        var css = document.createElement('style');
        css.textContent = [
            '#mod-anot{position:fixed;inset:0;z-index:9900;background:#111;display:none;flex-direction:column;color:#fff;font-family:system-ui,-apple-system,sans-serif;touch-action:none;}',
            '#mod-anot .an-top,#mod-anot .an-bar{display:flex;align-items:center;gap:6px;padding:8px 10px;background:#1c1c1e;}',
            '#mod-anot .an-top b{flex:1;text-align:center;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '#mod-anot .an-bar{justify-content:space-between;flex-wrap:wrap;padding-bottom:max(8px,env(safe-area-inset-bottom));}',
            '#mod-anot button{background:#2c2c2e;color:#fff;border:1px solid #3a3a3c;border-radius:10px;padding:8px 10px;font-size:14px;font-weight:700;cursor:pointer;min-width:42px;}',
            '#mod-anot button.on{background:#007aff;border-color:#007aff;} #mod-anot button:disabled{opacity:.35;}',
            '#mod-anot button.prim{background:#34c759;border-color:#34c759;}',
            '#mod-anot .an-zona{flex:1;position:relative;overflow:hidden;}',
            '#mod-anot .an-lienzo{position:absolute;left:0;top:0;transform-origin:0 0;}',
            '#mod-anot .an-lienzo img,#mod-anot .an-lienzo svg{position:absolute;left:0;top:0;width:100%;height:100%;display:block;}',
            '#mod-anot .an-col{width:26px;height:26px;border-radius:50%;min-width:26px;padding:0;border:2px solid #555;}',
            '#mod-anot .an-col.on{border-color:#fff;box-shadow:0 0 0 2px #007aff;}',
            '#mod-anot .an-ayuda{font-size:12px;color:#aaa;padding:4px 10px;background:#1c1c1e;text-align:center;}',
            '#an-dlg{position:fixed;inset:0;z-index:9950;background:rgba(0,0,0,.6);display:none;align-items:flex-end;justify-content:center;}',
            '#an-dlg .box{background:#fff;color:#1c1c1e;width:100%;max-width:520px;border-radius:16px 16px 0 0;padding:16px;padding-bottom:max(16px,env(safe-area-inset-bottom));}',
            '#an-dlg label{display:block;font-size:13px;font-weight:700;margin-top:8px;} #an-dlg input{width:100%;box-sizing:border-box;font-size:18px;padding:10px;border:1px solid #ccc;border-radius:10px;margin-top:4px;}',
            '#an-dlg .fila{display:flex;gap:8px;margin-top:12px;} #an-dlg .fila button{flex:1;padding:12px;border-radius:10px;border:1px solid #ccc;background:#f2f2f7;font-weight:700;font-size:15px;}',
            '#an-dlg .fila button.prim{background:#007aff;border-color:#007aff;color:#fff;} #an-dlg .fila button.borrar{color:#ff3b30;}'
        ].join('\n');
        document.head.appendChild(css);
        var d = document.createElement('div');
        d.id = 'mod-anot';
        d.innerHTML =
            '<div class="an-top"><button onclick="_anCancelar()">Cancelar</button><b id="an-titulo">Anotar foto</b><button onclick="_anSinAnotar()" title="Mandar la foto sin anotar">Sin anotar</button><button class="prim" onclick="_anListo()">Listo</button></div>' +
            '<div class="an-bar" style="justify-content:flex-start;">' +
            '  <button data-h="cota" onclick="_anHerr(\'cota\')" class="on">📏 Cota</button>' +
            '  <button data-h="circulo" onclick="_anHerr(\'circulo\')">⭕</button>' +
            '  <button data-h="rectangulo" onclick="_anHerr(\'rectangulo\')">▭</button>' +
            '  <button data-h="nota" onclick="_anHerr(\'nota\')">T Nota</button>' +
            '  <button data-h="mover" onclick="_anHerr(\'mover\')" title="Mover / tocar para editar">✋</button>' +
            '</div>' +
            '<div class="an-ayuda" id="an-ayuda"></div>' +
            '<div class="an-zona" id="an-zona"><div class="an-lienzo" id="an-lienzo"><img id="an-img" alt=""><svg id="an-svg"><g id="an-capa"></g></svg></div></div>' +
            '<div class="an-bar">' +
            '  <span style="display:flex;gap:6px;align-items:center;">' + COLORES.map(function (c, i) { return '<button class="an-col' + (i ? '' : ' on') + '" style="background:' + c + '" onclick="_anColor(' + i + ')" aria-label="Color"></button>'; }).join('') + '</span>' +
            '  <button id="an-ext" onclick="_anExtremos()" title="Extremos de la cota">→← flechas</button>' +
            '  <span style="display:flex;gap:6px;"><button onclick="_anZoom(1.5)" aria-label="Acercar">＋</button><button onclick="_anZoom(1/1.5)" aria-label="Alejar">－</button></span>' +
            '  <span style="display:flex;gap:6px;"><button id="an-undo" onclick="_anDeshacer()" aria-label="Deshacer">↶</button><button id="an-redo" onclick="_anRehacer()" aria-label="Rehacer">↷</button></span>' +
            '  <span id="an-cuenta" style="font-size:12px;color:#aaa;width:100%;text-align:center;"></span>' +
            '</div>';
        document.body.appendChild(d);
        var dlg = document.createElement('div');
        dlg.id = 'an-dlg';
        document.body.appendChild(dlg);
        var svg = $('an-svg');
        svg.addEventListener('pointerdown', abajo);
        svg.addEventListener('pointermove', mover);
        svg.addEventListener('pointerup', arriba);
        svg.addEventListener('pointercancel', function () { st.borrador = null; st.arrastre = null; dibujar(); });
    }

    var AYUDA = {
        cota: 'Arrastrá de un extremo al otro y escribí la medida (ej. 4,00 m).',
        circulo: 'Arrastrá para marcar con un círculo.', rectangulo: 'Arrastrá para marcar con un rectángulo.',
        nota: 'Tocá donde va la nota.', mover: 'Arrastrá para mover la foto. Tocá una anotación para editarla o borrarla.'
    };

    function punto(ev) {
        var svg = $('an-svg'), pt = svg.createSVGPoint();
        pt.x = ev.clientX; pt.y = ev.clientY;
        var p = pt.matrixTransform(svg.getScreenCTM().inverse());
        return [Math.max(0, Math.min(st.w, p.x)), Math.max(0, Math.min(st.h, p.y))];
    }
    function aplicarVista() {
        $('an-lienzo').style.transform = 'translate(' + st.vista.x + 'px,' + st.vista.y + 'px) scale(' + st.vista.z + ')';
    }
    function encajar() {
        var z = $('an-zona'), W = z.clientWidth, H = z.clientHeight;
        var f = Math.min(W / st.w, H / st.h);
        var lz = $('an-lienzo'); lz.style.width = st.w * f + 'px'; lz.style.height = st.h * f + 'px';
        st.vista = { z: 1, x: (W - st.w * f) / 2, y: (H - st.h * f) / 2, base: f };
        aplicarVista();
    }
    function guardarHistoria() { st.historial.push(clon(st.anot)); st.rehacer = []; if (st.historial.length > 100) st.historial.shift(); }

    function abajo(ev) {
        ev.preventDefault();
        $('an-svg').setPointerCapture(ev.pointerId);
        var p = punto(ev);
        if (st.herr === 'mover') {
            var gi = ev.target.closest && ev.target.closest('g[data-i]');
            st.arrastre = { x: ev.clientX, y: ev.clientY, vx: st.vista.x, vy: st.vista.y, toque: gi ? parseInt(gi.getAttribute('data-i'), 10) : -1, movio: false };
            return;
        }
        if (st.herr === 'nota') { st.arrastre = { nota: p }; return; }
        st.arrastre = { de: p };
        st.borrador = st.herr === 'cota' ? { tipo: 'cota', de: p, a: p, color: st.color, extremos: st.extremos } :
            { tipo: 'marca', forma: st.herr, de: p, a: p, color: st.color };
        dibujar();
    }
    function mover(ev) {
        if (!st || !st.arrastre) return;
        if (st.herr === 'mover') {
            var dx = ev.clientX - st.arrastre.x, dy = ev.clientY - st.arrastre.y;
            if (Math.abs(dx) + Math.abs(dy) > 6) st.arrastre.movio = true;
            st.vista.x = st.arrastre.vx + dx; st.vista.y = st.arrastre.vy + dy; aplicarVista();
            return;
        }
        if (st.borrador) { st.borrador.a = punto(ev); dibujar(); }
    }
    function arriba(ev) {
        if (!st || !st.arrastre) return;
        var a = st.arrastre; st.arrastre = null;
        if (st.herr === 'mover') { if (!a.movio && a.toque >= 0) editar(a.toque); return; }
        if (a.nota) { pedir({ titulo: 'Nota', campos: [['texto', 'Texto', '']] }, function (v) { if (v.texto) { guardarHistoria(); st.anot.push({ tipo: 'nota', texto: v.texto, en: a.nota, color: st.color }); } dibujar(); }); return; }
        var b = st.borrador; st.borrador = null;
        var minimo = Math.max(st.w, st.h) / 60;
        if (!b || Math.hypot(b.a[0] - b.de[0], b.a[1] - b.de[1]) < minimo) { dibujar(); return; }
        if (b.tipo === 'cota') {
            dibujar(); st.borrador = b; dibujar();
            pedir({ titulo: 'Medida de la cota', campos: [['valor', 'Medida (como la escribirías en el plano)', '', 'ej. 4,00 m'], ['nota', 'Nota (opcional)', '', 'ej. ancho total del frente']] }, function (v) {
                st.borrador = null;
                if (v && v.valor) { guardarHistoria(); b.valor = v.valor; if (v.nota) b.nota = v.nota; st.anot.push(b); }
                dibujar();
            });
        } else {
            guardarHistoria(); st.anot.push(b); dibujar();
        }
    }

    function editar(i) {
        var a = st.anot[i];
        st.sel = i; dibujar();
        var campos = a.tipo === 'cota' ? [['valor', 'Medida', a.valor || ''], ['nota', 'Nota', a.nota || '']] :
            a.tipo === 'nota' ? [['texto', 'Texto', a.texto || '']] : [['nota', 'Nota de la marca', a.nota || '']];
        pedir({ titulo: 'Editar anotación', campos: campos, borrar: true }, function (v, borrar) {
            st.sel = -1;
            if (borrar) { guardarHistoria(); st.anot.splice(i, 1); }
            else if (v) {
                guardarHistoria();
                Object.keys(v).forEach(function (k) { if (v[k]) a[k] = v[k]; else delete a[k]; });
                if (a.tipo === 'cota' && !a.valor) st.anot.splice(i, 1);
                if (a.tipo === 'nota' && !a.texto) st.anot.splice(i, 1);
            }
            dibujar();
        });
    }

    /** Diálogo chico (abajo, cómodo en el celular). cb(valores | null, borrar) */
    function pedir(op, cb) {
        var d = $('an-dlg');
        d.innerHTML = '<div class="box"><b>' + esc(op.titulo) + '</b>' + op.campos.map(function (c, i) {
            return '<label>' + esc(c[1]) + '<input id="an-in-' + i + '" value="' + esc(c[2]) + '" placeholder="' + esc(c[3] || '') + '" autocomplete="off"></label>';
        }).join('') + '<div class="fila">' + (op.borrar ? '<button class="borrar" id="an-b-borrar">Borrar</button>' : '') +
            '<button id="an-b-cancelar">Cancelar</button><button class="prim" id="an-b-ok">Listo</button></div></div>';
        d.style.display = 'flex';
        var cerrar = function (v, borrar) { d.style.display = 'none'; cb(v, borrar); };
        var leer = function () { var v = {}; op.campos.forEach(function (c, i) { v[c[0]] = $('an-in-' + i).value.trim().slice(0, 120); }); return v; };
        $('an-b-ok').onclick = function () { cerrar(leer()); };
        $('an-b-cancelar').onclick = function () { cerrar(null); };
        if (op.borrar) $('an-b-borrar').onclick = function () { cerrar(null, true); };
        d.querySelectorAll('input').forEach(function (inp) { inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); cerrar(leer()); } }; });
        setTimeout(function () { var i0 = $('an-in-0'); if (i0) i0.focus(); }, 50);
    }

    window._anHerr = function (h) {
        st.herr = h;
        document.querySelectorAll('#mod-anot [data-h]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-h') === h); });
        $('an-ayuda').textContent = AYUDA[h];
    };
    window._anColor = function (i) {
        st.color = COLORES[i];
        document.querySelectorAll('#mod-anot .an-col').forEach(function (b, k) { b.classList.toggle('on', k === i); });
    };
    window._anExtremos = function () {
        st.extremos = st.extremos === 'ticks' ? 'flechas' : 'ticks';
        $('an-ext').textContent = st.extremos === 'ticks' ? '/ ticks /' : '→← flechas';
    };
    window._anZoom = function (f) {
        var z = $('an-zona'), cx = z.clientWidth / 2, cy = z.clientHeight / 2;
        var nz = Math.max(1, Math.min(8, st.vista.z * f)), k = nz / st.vista.z;
        st.vista.x = cx - (cx - st.vista.x) * k; st.vista.y = cy - (cy - st.vista.y) * k; st.vista.z = nz;
        if (nz === 1) encajar(); else aplicarVista();
    };
    window._anDeshacer = function () { if (!st.historial.length) return; st.rehacer.push(clon(st.anot)); st.anot = st.historial.pop(); st.sel = -1; dibujar(); };
    window._anRehacer = function () { if (!st.rehacer.length) return; st.historial.push(clon(st.anot)); st.anot = st.rehacer.pop(); dibujar(); };

    function cerrar(resultado) {
        $('mod-anot').style.display = 'none';
        URL.revokeObjectURL(st.url);
        var r = st.resolver; st = null; r(resultado);
    }
    window._anCancelar = function () {
        if (st.anot.length && !confirm('¿Descartar la foto y sus anotaciones?')) return;
        cerrar({ cancelado: true });
    };
    window._anSinAnotar = function () { cerrar(null); };
    window._anListo = function () {
        if (!st.anot.length) return cerrar(null);
        var cv = exportar();
        var mini = document.createElement('canvas'), f = 120 / Math.max(st.w, st.h);
        mini.width = Math.round(st.w * f); mini.height = Math.round(st.h * f);
        mini.getContext('2d').drawImage(cv, 0, 0, mini.width, mini.height);
        var editorState = clon(st.anot), anot = paraAgente(st.anot), miniatura = mini.toDataURL('image/jpeg', 0.6);
        cv.toBlob(function (blob) { cerrar({ anotaciones: anot, blob: blob, miniatura: miniatura, editor: editorState }); }, 'image/jpeg', 0.86);
    };

    function editarFoto(red, nombre, previas) {
        crear();
        return new Promise(function (resolver) {
            var url = URL.createObjectURL(red.blob);
            st = { w: red.ancho, h: red.alto, anot: previas ? clon(previas) : [], historial: [], rehacer: [], herr: 'cota', color: COLORES[0], extremos: 'flechas', sel: -1, resolver: resolver, url: url };
            $('an-titulo').textContent = 'Anotar · ' + (nombre || 'foto');
            var svg = $('an-svg'); svg.setAttribute('viewBox', '0 0 ' + st.w + ' ' + st.h);
            st.capa = $('an-capa');
            var img = $('an-img');
            img.onload = function () { st.base = img; encajar(); dibujar(); };
            img.src = url;
            $('mod-anot').style.display = 'flex';
            window._anHerr('cota'); window._anColor(0);
            if (st.extremos !== 'flechas') window._anExtremos();
        });
    }

    global.AgenteAnotador = { editar: editarFoto, escala: escala, posEtiqueta: posEtiqueta, paraAgente: paraAgente };
})(typeof window !== 'undefined' ? window : globalThis);
