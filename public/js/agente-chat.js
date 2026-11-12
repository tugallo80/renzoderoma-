/**
 * agente-chat.js — Chat del "Agente IA" cotizador en presupuesto.html (Etapa 1).
 *
 * El dueño adjunta todo junto (3D, PDF, fotos, capturas), escribe o dicta el contexto, y el agente
 * (Cloud Function /api/agente + trigger agenteTurno, con Claude) arma el borrador. El chat escucha el
 * estado y los mensajes en RTDB (/proyectos/{cid}/{pid}/agente/…), así que no depende de una conexión larga.
 *
 * El 3D se mide EN EL NAVEGADOR con Lector3D (la misma lectura de "Importar 3D", vía window.Importar3D):
 * se sube solo la medición rubik/1, nunca el modelo. Depende de globals de presupuesto.html: db, firebase, cid, pid.
 */
(function () {
    'use strict';

    var N = window.AgenteNucleo;
    var MAX_PDF_MB = 20, MAX_IMG_LADO = 2000;
    var abierto = false, escuchas = [], escuchasConv = [], mensajes = {}, estado = {}, costoProyecto = {}, costoMes = {}, config = {}, borrador = null, verBorrador = false;
    // Varias conversaciones por proyecto: "principal" = la que ya existía (rutas de siempre); las nuevas en agente/conversaciones/{id}
    var conv = 'principal', metas = {}, costoPrincipal = {};
    var pendientes = [];   // adjuntos del próximo mensaje: {clave, nombre, tipo, estado: 'procesando'|'listo'|'error', id, error, miniatura}
    var audioActual = null, reconocimiento = null, grabador = null;

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function raiz() { return 'proyectos/' + cid + '/' + pid + '/agente'; }
    function raizConv() { return conv === 'principal' ? raiz() : raiz() + '/conversaciones/' + conv; }
    function cfg() { return N.configEfectiva(config); }

    // ------------------------------------------------------------------ estilos y estructura
    function crearModal() {
        if ($('mod-agente')) return;
        var css = document.createElement('style');
        css.textContent = [
            '#mod-agente{position:fixed;inset:0;z-index:9850;background:rgba(0,0,0,.55);display:none;}',
            '#mod-agente .ag-box{background:var(--bg);color:var(--text);max-width:760px;margin:0 auto;height:100%;display:flex;flex-direction:column;}',
            '@media(min-width:800px){#mod-agente .ag-box{height:calc(100% - 40px);margin-top:20px;border-radius:14px;overflow:hidden;}}',
            '#mod-agente .ag-top{display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--card);border-bottom:1px solid var(--border);}',
            '#mod-agente .ag-top b{font-size:16px;white-space:nowrap;}',
            '@media(max-width:480px){#mod-agente .ag-top.con-borrador .ag-tit{display:none;}}',
            '#mod-agente .ag-ico{background:none;border:none;font-size:22px;line-height:1;color:var(--gray);cursor:pointer;padding:4px 6px;}',
            '#mod-agente .ag-costo{flex:1;min-width:0;text-align:right;font-size:11px;line-height:1.25;color:var(--gray);cursor:pointer;background:none;border:none;font-family:inherit;}',
            '#mod-agente .ag-costo b{font-size:12px;color:var(--text);}',
            '#mod-agente .ag-costo.aviso b{color:var(--orange);} #mod-agente .ag-costo.tope b{color:var(--red);}',
            '#mod-agente .ag-panel{background:var(--card);border-bottom:1px solid var(--border);padding:10px 14px;font-size:12px;max-height:45vh;overflow-y:auto;display:none;}',
            '#mod-agente .ag-panel table{width:100%;border-collapse:collapse;font-size:11px;} #mod-agente .ag-panel td,#mod-agente .ag-panel th{padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;} #mod-agente .ag-panel td:first-child,#mod-agente .ag-panel th:first-child{text-align:left;}',
            '#mod-agente .ag-panel label{display:block;font-weight:700;margin-top:8px;} #mod-agente .ag-panel select,#mod-agente .ag-panel input{box-sizing:border-box;width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;margin-top:3px;}',
            '#mod-agente .ag-convbar{display:flex;gap:8px;align-items:center;padding:6px 12px;background:var(--card);border-bottom:1px solid var(--border);}',
            '#mod-agente .ag-convsel{flex:1;min-width:0;text-align:left;background:none;border:none;color:var(--text);font-size:13px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:inherit;padding:4px 0;}',
            '#mod-agente .ag-convsel span{color:var(--gray);}',
            '#mod-agente .ag-msgs{flex:1;overflow-y:auto;padding:12px 12px 6px;-webkit-overflow-scrolling:touch;}',
            '#mod-agente .ag-m{max-width:88%;margin:0 0 10px;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;word-wrap:break-word;white-space:normal;}',
            '#mod-agente .ag-m.dueno{margin-left:auto;background:var(--blue);color:#fff;border-bottom-right-radius:4px;}',
            '#mod-agente .ag-m.agente{background:var(--card);border:1px solid var(--border);border-bottom-left-radius:4px;}',
            '#mod-agente .ag-m.agente.parcial{opacity:.75;font-size:13px;}',
            '#mod-agente .ag-m.aviso{max-width:100%;background:rgba(255,149,0,.12);border:1px solid var(--orange);font-size:13px;}',
            '#mod-agente .ag-m.aviso.error{background:rgba(255,59,48,.08);border-color:var(--red);}',
            '#mod-agente .ag-pie{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:11px;color:var(--gray);}',
            '#mod-agente .ag-m.dueno .ag-pie{color:rgba(255,255,255,.8);}',
            '#mod-agente .ag-voz{border:1px solid var(--border);background:var(--bg);border-radius:14px;padding:3px 9px;font-size:13px;cursor:pointer;color:var(--text);}',
            '#mod-agente .ag-preg{margin:8px 0 0;padding-left:18px;} #mod-agente .ag-preg li{margin-bottom:6px;font-weight:600;} #mod-agente .ag-preg small{display:block;font-weight:400;color:var(--gray);}',
            '#mod-agente .ag-chip{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:4px 9px;margin:4px 4px 0 0;border-radius:12px;font-size:12px;background:rgba(0,0,0,.08);border:1px solid var(--border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '#mod-agente .ag-m.dueno .ag-chip{background:rgba(255,255,255,.18);border-color:rgba(255,255,255,.35);color:#fff;}',
            '#mod-agente .ag-chip.error{border-color:var(--red);color:var(--red);} #mod-agente .ag-chip img{width:26px;height:26px;object-fit:cover;border-radius:4px;}',
            '#mod-agente .ag-chip button{background:none;border:none;color:inherit;font-size:15px;cursor:pointer;padding:0 0 0 2px;}',
            '#mod-agente .ag-estado{display:none;align-items:center;gap:8px;padding:8px 14px;font-size:13px;background:var(--card);border-top:1px solid var(--border);}',
            '#mod-agente .ag-spin{width:14px;height:14px;border:2px solid var(--border);border-top-color:var(--blue);border-radius:50%;animation:agspin .8s linear infinite;flex:none;}',
            '@keyframes agspin{to{transform:rotate(360deg);}}',
            '#mod-agente .ag-btn{border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:10px;padding:7px 12px;font-weight:700;font-size:13px;cursor:pointer;}',
            '#mod-agente .ag-btn.prim{background:var(--blue);border-color:var(--blue);color:#fff;}',
            '#mod-agente .ag-adj{padding:0 12px;background:var(--card);}',
            '#mod-agente .ag-comp{display:flex;align-items:flex-end;gap:6px;padding:8px 10px;padding-bottom:max(8px,env(safe-area-inset-bottom));background:var(--card);border-top:1px solid var(--border);}',
            '#mod-agente .ag-comp textarea{flex:1;box-sizing:border-box;height:42px;min-height:42px;max-height:140px;resize:none;border:1px solid var(--border);border-radius:20px;padding:10px 14px;font-size:16px;font-family:inherit;background:var(--bg);color:var(--text);}',
            '#mod-agente .ag-red{width:42px;height:42px;flex:none;border-radius:50%;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:19px;cursor:pointer;display:flex;align-items:center;justify-content:center;}',
            '#mod-agente .ag-red.enviar{background:var(--blue);border-color:var(--blue);color:#fff;} #mod-agente .ag-red:disabled{opacity:.45;}',
            '#mod-agente .ag-red.grabando{background:var(--red);border-color:var(--red);color:#fff;animation:agpulso 1.2s ease-in-out infinite;}',
            '@keyframes agpulso{50%{opacity:.6;}}',
            '#mod-agente .ag-vacio{color:var(--gray);font-size:14px;line-height:1.5;padding:18px 6px;text-align:center;}',
            '#mod-agente .ag-m code{background:rgba(0,0,0,.07);padding:0 4px;border-radius:4px;font-size:12px;}',
            '#mod-agente .ag-tab{border:1px solid var(--green);color:var(--green);background:none;border-radius:14px;padding:5px 10px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;}',
            '#mod-agente .ag-tab.on{background:var(--green);color:#fff;}',
            '#mod-agente .ag-borr{flex:1;overflow-y:auto;padding:10px 12px;display:none;-webkit-overflow-scrolling:touch;}',
            '#mod-agente .ag-cap{margin-bottom:14px;} #mod-agente .ag-cap>h3{font-size:13px;letter-spacing:.5px;margin:4px 0 6px;display:flex;justify-content:space-between;}',
            '#mod-agente .ag-it{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin-bottom:8px;}',
            '#mod-agente .ag-it-cab{display:flex;justify-content:space-between;gap:8px;font-weight:700;font-size:14px;}',
            '#mod-agente .ag-it-sub{font-size:12px;color:var(--gray);margin-top:2px;}',
            '#mod-agente .ag-f{display:grid;grid-template-columns:1fr auto;gap:2px 8px;font-size:12px;padding:6px 0;border-top:1px dashed var(--border);}',
            '#mod-agente .ag-f .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}',
            '#mod-agente .ag-f .ori{grid-column:1/-1;color:var(--gray);font-size:11px;}',
            '#mod-agente .ag-f.marcada{background:rgba(255,59,48,.06);} #mod-agente .ag-f.marcada .rev{grid-column:1/-1;color:var(--red);font-size:11px;font-weight:700;}',
            '#mod-agente .ag-o{display:inline-block;padding:0 5px;border-radius:6px;font-size:10px;font-weight:800;margin-right:3px;background:rgba(0,0,0,.07);}',
            '#mod-agente .ag-o.pieza3d{background:rgba(52,199,89,.15);color:#1e7f3a;} #mod-agente .ag-o.base{background:rgba(0,122,255,.12);color:#0a58c2;}',
            '#mod-agente .ag-o.cota_plano{background:rgba(175,82,222,.14);color:#7a2fa0;} #mod-agente .ag-o.dueño{background:rgba(255,149,0,.16);color:#a35f00;}',
            '#mod-agente .ag-o.supuesto{background:rgba(90,200,250,.22);color:#0b6e99;}',
            '#mod-agente .ag-f.supuesto{background:rgba(90,200,250,.10);border-left:3px solid #5ac8fa;padding-left:6px;}',
            '#mod-agente .ag-f.supuesto.ok{border-left-color:var(--green);background:none;}',
            '#mod-agente .ag-ed{background:none;border:1px solid var(--border);border-radius:6px;padding:0 5px;font-size:12px;cursor:pointer;color:var(--gray);margin-left:4px;}',
            '#ag-edit{position:fixed;inset:0;z-index:9960;background:rgba(0,0,0,.5);display:none;align-items:flex-end;justify-content:center;}',
            '#ag-edit .box{background:var(--card);color:var(--text);width:100%;max-width:560px;border-radius:16px 16px 0 0;padding:16px;padding-bottom:max(16px,env(safe-area-inset-bottom));}',
            '#ag-edit label{display:block;font-size:13px;font-weight:700;margin-top:8px;} #ag-edit input,#ag-edit textarea{width:100%;box-sizing:border-box;font-size:16px;padding:9px;border:1px solid var(--border);border-radius:10px;margin-top:3px;background:var(--bg);color:var(--text);font-family:inherit;}',
            '#mod-agente .ag-sup{margin-top:8px;padding:8px;border-radius:10px;background:rgba(90,200,250,.12);font-size:12px;display:flex;gap:8px;align-items:center;}',
            '#mod-agente .ag-tot{position:sticky;bottom:0;background:var(--bg);padding:10px 2px;font-weight:800;display:flex;justify-content:space-between;border-top:2px solid var(--text);}'
        ].join('\n');
        document.head.appendChild(css);
        var div = document.createElement('div');
        div.id = 'mod-agente';
        div.innerHTML =
            '<div class="ag-box" role="dialog" aria-label="Agente IA">' +
            '  <div class="ag-top">' +
            '    <b>🤖<span class="ag-tit"> Agente IA</span></b>' +
            '    <button class="ag-tab" id="ag-tab" onclick="_agVerBorrador()" style="display:none;">📋 Borrador</button>' +
            '    <button class="ag-costo" id="ag-costo" onclick="_agPanel(\'costos\')" title="Costo de la API">…</button>' +
            '    <button class="ag-ico" onclick="_agPanel(\'config\')" title="Configuración" aria-label="Configuración">⚙</button>' +
            '    <button class="ag-ico" onclick="cerrarAgenteIA()" aria-label="Cerrar" style="font-size:28px;">×</button>' +
            '  </div>' +
            '  <div class="ag-convbar" id="ag-convbar"></div>' +
            '  <div class="ag-panel" id="ag-p-convs"></div>' +
            '  <div class="ag-panel" id="ag-p-costos"></div>' +
            '  <div class="ag-panel" id="ag-p-config"></div>' +
            '  <div class="ag-msgs" id="ag-msgs"></div>' +
            '  <div class="ag-borr" id="ag-borr"></div>' +
            '  <div class="ag-estado" id="ag-estado"></div>' +
            '  <div class="ag-adj" id="ag-adj"></div>' +
            '  <div class="ag-comp">' +
            '    <button class="ag-red" onclick="document.getElementById(\'ag-file\').click()" title="Adjuntar 3D, PDF, fotos o capturas" aria-label="Adjuntar">📎</button>' +
            '    <textarea id="ag-txt" rows="1" placeholder="Escribí o dictá con 🎤…" oninput="_agAuto(this)" onkeydown="_agTecla(event)"></textarea>' +
            '    <button class="ag-red" id="ag-mic" onclick="_agMic()" title="Dictar" aria-label="Dictar">🎤</button>' +
            '    <button class="ag-red enviar" id="ag-env" onclick="_agEnviar()" title="Enviar" aria-label="Enviar">➤</button>' +
            '  </div>' +
            '  <input type="file" id="ag-file" multiple style="display:none" onchange="_agArchivos(this.files); this.value=\'\';">' +
            '</div>';
        document.body.appendChild(div);
    }

    // ------------------------------------------------------------------ abrir / cerrar y escuchas en RTDB
    var foco = null;   // {item, desc}: ítem del presupuesto sobre el que se abrió el agente
    window.abrirAgenteIA = function (archivos, enfoque) {
        foco = enfoque && enfoque.item ? enfoque : null;
        crearModal();
        $('mod-agente').style.display = 'block';
        document.body.style.overflow = 'hidden';
        if (!abierto) { abierto = true; escuchar(); }
        var elegir = foco && foco.conv ? Promise.resolve(foco.conv) : (escuchasConv.length ? Promise.resolve(conv) :
            db.ref(raiz() + '/actual').once('value').then(function (s) { return s.val() || 'principal'; }).catch(function () { return 'principal'; }));
        elegir.then(function (c) { if (c !== conv || !escuchasConv.length) { conv = c; escucharConv(); } if (foco) enfocarItem(); });
        pintarMensajes(); pintarEstado(); pintarCosto(); pintarAdjuntos(); pintarBorrador();
        if (archivos && archivos.length) window._agArchivos(archivos);
        setTimeout(function () { var m = $('ag-msgs'); if (m) m.scrollTop = m.scrollHeight; }, 50);
        if (foco) {
            var t = $('ag-txt');
            if (t && !t.value.trim()) { t.value = 'Sobre «' + (foco.desc || 'este ítem') + '»: '; window._agAuto(t); }
            enfocarItem();
            setTimeout(function () { if (t) { t.focus(); try { t.setSelectionRange(t.value.length, t.value.length); } catch (e) { /* nada */ } } }, 350);
        }
    };

    window.cerrarAgenteIA = function () {
        $('mod-agente').style.display = 'none';
        document.body.style.overflow = '';
        pararAudio(); pararMic();
        escuchas.forEach(function (f) { f(); }); escuchas = []; abierto = false;
        escuchasConv.forEach(function (f) { f(); }); escuchasConv = [];
    };

    function on(ref, evento, fn) { ref.on(evento, fn, function (e) { console.warn('[agente]', e && e.message); }); escuchas.push(function () { ref.off(evento, fn); }); }

    function escuchar() {
        on(db.ref(raiz() + '/estado'), 'value', function (s) { estado = s.val() || {}; pintarEstado(); });
        on(db.ref(raiz() + '/conversaciones_meta'), 'value', function (s) { metas = s.val() || {}; pintarConvs(); pintarCosto(); });
        on(db.ref(raiz() + '/costos/total'), 'value', function (s) { costoPrincipal = s.val() || {}; pintarConvs(); pintarCosto(); });
        on(db.ref('agente_costos/' + N.mesClave() + '/_total'), 'value', function (s) { costoMes = s.val() || {}; pintarCosto(); });
        on(db.ref('config/agente'), 'value', function (s) { config = s.val() || {}; pintarCosto(); if ($('ag-p-config').style.display === 'block') pintarConfig(); });
    }
    /** Escuchas de la conversación abierta (se rehacen al cambiar de conversación). */
    function escucharConv() {
        escuchasConv.forEach(function (f) { f(); }); escuchasConv = [];
        mensajes = {}; borrador = null; costoProyecto = {};
        var onC = function (ref, ev, fn) { ref.on(ev, fn, function (e) { console.warn('[agente]', e && e.message); }); escuchasConv.push(function () { ref.off(ev, fn); }); };
        var refM = db.ref(raizConv() + '/conversacion/mensajes').limitToLast(200);
        onC(refM, 'child_added', function (s) { mensajes[s.key] = s.val(); pintarMensajes(true); });
        onC(refM, 'child_changed', function (s) { mensajes[s.key] = s.val(); pintarMensajes(); });
        onC(db.ref(raizConv() + '/borrador'), 'value', function (s) { borrador = s.val(); pintarBorrador(); });
        onC(db.ref(raizConv() + '/costos/total'), 'value', function (s) { costoProyecto = s.val() || {}; pintarCosto(); });
        pintarMensajes(true); pintarBorrador(); pintarConvs(); pintarCosto();
    }
    function cambiarConv(nueva) {
        if (nueva === conv && escuchasConv.length) return;
        conv = nueva || 'principal';
        pendientes = []; pintarAdjuntos();
        if (foco && foco.conv !== conv) { foco = null; var t = $('ag-txt'); if (t && /^Sobre «[^»]*»: $/.test(t.value)) { t.value = ''; window._agAuto(t); } }
        if (verBorrador) window._agVerBorrador(false);
        $('ag-p-convs').style.display = 'none';
        escucharConv();
    }

    // ------------------------------------------------------------------ conversaciones del proyecto
    function listaConvs() {
        var l = Object.keys(metas).map(function (k) { return Object.assign({ id: k }, metas[k]); });
        if (!metas.principal && (costoPrincipal.llamadas || conv === 'principal')) l.push({ id: 'principal', titulo: 'Primera conversación', creada: 0 });
        l.forEach(function (c) { if (c.id === 'principal') c.costo_usd = costoPrincipal.usd || 0; });
        return l.sort(function (a, b) { return (b.creada || 0) - (a.creada || 0); });
    }
    function costoTotalProyecto() { return listaConvs().reduce(function (s, c) { return s + (Number(c.costo_usd) || 0); }, 0); }
    function pintarConvs() {
        var bar = $('ag-convbar'); if (!bar) return;
        var l = listaConvs(), act = l.find(function (c) { return c.id === conv; }) || { titulo: conv === 'principal' ? 'Primera conversación' : 'Nueva conversación' };
        bar.innerHTML = '<button class="ag-convsel" onclick="_agPanel(\'convs\')">💬 <b>' + esc(act.titulo || 'Conversación') + '</b>' + (l.length > 1 ? ' <span>(' + l.length + ') ▾</span>' : ' ▾') + '</button>' +
            '<button class="ag-btn" onclick="_agNueva()" title="Empezar otra conversación en este proyecto (otro ítem)">＋ Nueva</button>';
        var p = $('ag-p-convs');
        if (p.style.display === 'block') p.innerHTML = '<b>Conversaciones de este proyecto</b><div style="color:var(--gray);margin:2px 0 6px;">Cada una tiene su propio chat, adjuntos y borrador. Total del proyecto: <b>' + N.usd(costoTotalProyecto()) + '</b></div>' +
            l.map(function (c) {
                return '<div style="display:flex;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);' + (c.id === conv ? 'font-weight:800;' : '') + '"><span style="flex:1;cursor:pointer;" onclick="_agAbrirConv(\'' + esc(c.id) + '\')">' +
                    (c.id === conv ? '▶ ' : '') + esc(c.titulo || 'Conversación') + '</span><span style="color:var(--gray);">' + (c.creada ? new Date(c.creada).toLocaleDateString('es-BO') + ' · ' : '') + N.usd(c.costo_usd || 0) + '</span></div>';
            }).join('');
    }
    window._agAbrirConv = function (id) { cambiarConv(id); db.ref(raiz() + '/actual').set(id).catch(function () {}); };
    window._agNueva = async function () {
        if (trabajando()) return alert('Esperá a que el agente termine.');
        try { var r = await llamar({ accion: 'nueva' }); cambiarConv(r.conv); }
        catch (e) { alert(e.message); }
    };

    // ------------------------------------------------------------------ mensajes
    function formato(t) {
        var h = esc(t);
        h = h.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
        h = h.replace(/^\s*[-•]\s+(.*)$/gm, '• $1');
        return h.replace(/\n/g, '<br>');
    }
    function hora(ms) { if (typeof ms !== 'number') return ''; try { return new Date(ms).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
    function iconoTipo(t) { return t === '3d' ? '🧊' : t === 'pdf' ? '📄' : t === 'imagen' ? '🖼' : '📎'; }

    function pintarMensajes(alFinal) {
        var cont = $('ag-msgs');
        if (!cont) return;
        var cerca = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 120;
        var claves = Object.keys(mensajes).sort();
        if (!claves.length) {
            cont.innerHTML = '<div class="ag-vacio"><div style="font-size:34px;">🤖</div>Mandá todo junto con 📎: el 3D, los PDF de planos, fotos o capturas de WhatsApp.<br>' +
                'Contá el contexto escribiendo o con 🎤: <i>"stand para tal cliente, entrega el viernes, hay que restaurar el tótem"</i>.<br><br>' +
                'Las medidas salen del 3D y los precios de la base: el agente no inventa números; lo que falta te lo pregunta.</div>';
            return;
        }
        cont.innerHTML = claves.map(function (k) {
            var m = mensajes[k] || {};
            var adj = (m.adjuntos || []).map(function (a) { return '<span class="ag-chip">' + iconoTipo(a.tipo) + ' ' + esc(a.nombre) + '</span>'; }).join('');
            if (m.rol === 'dueno') {
                return '<div class="ag-m dueno">' + (m.texto ? formato(m.texto) : '') + (adj ? '<div>' + adj + '</div>' : '') +
                    '<div class="ag-pie">' + hora(m.fecha) + '</div></div>';
            }
            if (m.rol === 'aviso') {
                var b = m.tipo === 'tope' ? '<button class="ag-btn prim" onclick="_agReintentar(true)">Seguir igual</button>' :
                    m.tipo === 'error' ? '<button class="ag-btn" onclick="_agReintentar(false)">Reintentar</button>' : '';
                return '<div class="ag-m aviso' + (m.tipo === 'error' ? ' error' : '') + '">' + formato(m.texto) + (b ? '<div class="ag-pie">' + b + '</div>' : '') + '</div>';
            }
            var preg = (m.preguntas || []).length ? '<ol class="ag-preg">' + m.preguntas.map(function (p) {
                return '<li>' + esc(p.pregunta) + (p.para_que ? '<small>' + esc(p.para_que) + '</small>' : '') + '</li>';
            }).join('') + '</ol>' : '';
            var pie = '<div class="ag-pie">' + (m.parcial ? '' : '<button class="ag-voz" onclick="_agVoz(\'' + k + '\', this)" aria-label="Escuchar">🔊</button>') +
                '<span>' + hora(m.fecha) + (m.costo_usd != null ? ' · ' + N.usd(m.costo_usd) : '') + '</span></div>';
            return '<div class="ag-m agente' + (m.parcial ? ' parcial' : '') + '">' + formato(m.texto || '') + preg + pie + '</div>';
        }).join('');
        if (alFinal || cerca) cont.scrollTop = cont.scrollHeight;
    }

    // ------------------------------------------------------------------ borrador (capítulos → ítems → APU, con el origen de cada número)
    function bs(x) { return (Math.round((parseFloat(x) || 0) * 100) / 100).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function lista(v) { return Array.isArray(v) ? v : v ? Object.keys(v).sort(function (a, b) { return a - b; }).map(function (k) { return v[k]; }) : []; }
    var NOMBRE_ORIGEN = { pieza3d: '3D', base: 'base', cota_plano: 'plano', 'dueño': 'vos', supuesto: 'supuesto' };
    function chipOrigen(o) {
        if (!o) return '';
        var t = (/^([a-zñ_0-9]+):/i.exec(o) || [])[1] || '';
        return '<span class="ag-o ' + esc(t) + '" title="' + esc(o) + '">' + esc(NOMBRE_ORIGEN[t] || t || '?') + '</span>';
    }
    var TIT = { mat: 'Materiales', mo: 'Mano de obra', eq: 'Equipo', sub: 'Subcontratos' };
    function pintarBorrador() {
        var tab = $('ag-tab'), el = $('ag-borr');
        if (!tab || !el) return;
        var caps = borrador ? lista(borrador.capitulos) : [];
        tab.style.display = caps.length ? '' : 'none';
        tab.parentNode.classList.toggle('con-borrador', !!caps.length);
        tab.innerHTML = '📋 ' + (caps.length ? 'Bs ' + bs(borrador.total) : 'Borrador');
        tab.classList.toggle('on', verBorrador);
        if (!caps.length) { if (verBorrador) window._agVerBorrador(false); return; }
        var rc = borrador.recargos || {};
        el.innerHTML = '<div class="ag-it-sub" style="margin-bottom:8px;">Borrador v' + (borrador.version || 1) + ' · recargos: cargas sociales ' + (rc.cs != null ? rc.cs : '?') + ' %, indirectos ' +
            (rc.ind != null ? rc.ind : '?') + ' %, utilidad ' + (rc.util != null ? rc.util : '?') + ' % ' + chipOrigen(rc.origen) +
            (borrador.filas_marcadas ? ' · <b style="color:var(--red);">' + borrador.filas_marcadas + ' fila' + (borrador.filas_marcadas > 1 ? 's marcadas' : ' marcada') + '</b>' : '') + '</div>' +
            caps.map(function (c) {
                return '<div class="ag-cap"><h3><span>' + esc(String(c.nombre || '').toUpperCase()) + '</span><span>Bs ' + bs(c.total) + '</span></h3>' +
                    lista(c.items).map(function (it) {
                        var apu = it.apu || {};
                        var filas = ['mat', 'mo', 'eq', 'sub'].map(function (t) {
                            var fs = lista(apu[t]);
                            if (!fs.length) return '';
                            return '<div class="ag-it-sub" style="margin-top:6px;font-weight:700;">' + TIT[t] + '</div>' + fs.map(function (f, fi) {
                                return '<div class="ag-f' + (f.revisar ? ' marcada' : '') + (f.supuesto ? ' supuesto' + (f.confirmado ? ' ok' : '') : '') + '"><span>' + esc(f.d) +
                                    (f.cerrado ? ' <b style="color:var(--orange);font-size:10px;">TRATO CERRADO</b>' : '') + (f.supuesto ? ' <span style="font-size:10px;font-weight:700;color:' + (f.confirmado ? 'var(--green)' : '#0b6e99') + ';">' + (f.confirmado ? '✓ confirmado' : 'supuesto sin confirmar') + '</span>' : '') +
                                    '</span><span class="num">' + bs(f.q * f.p) + ' <button class="ag-ed" onclick="_agBorrarFila(\'' + esc(it.id) + '\',\'' + t + '\',' + (fi + 1) + ')" title="Borrar la fila (sin IA)" aria-label="Borrar fila">🗑</button></span>' +
                                    '<span class="ori">' + chipOrigen(f.origen_q) + (f.stock_q ? f.q_total + ' ' + esc(f.u) + ' − stock propio ' + chipOrigen(f.origen_stock) + f.stock_q + ' = ' : '') + f.q + ' ' + esc(f.u) + ' × ' + (f.p ? chipOrigen(f.origen_p) + bs(f.p) : '—') +
                                    (f.factor ? ' · factor ' + f.factor + ' ' + chipOrigen(f.origen_factor) : '') + (f.nota ? ' · ' + esc(f.nota) : '') + '</span>' +
                                    (f.revisar ? '<span class="rev">⚠ ' + esc(f.revisar) + '</span>' : '') + '</div>';
                            }).join('');
                        }).join('');
                        return '<div class="ag-it" data-id="' + esc(it.id) + '"><div class="ag-it-cab"><span>' + esc(it.desc) +
                            ' <button class="ag-ed" onclick="_agEditar(\'' + esc(it.id) + '\')" title="Editar a mano (sin IA, gratis)" aria-label="Editar">✎</button></span><span>Bs ' + bs(it.total) + '</span></div>' +
                            '<div class="ag-it-sub">' + (it.cant != null ? it.cant : 1) + ' ' + esc(it.und || 'glb') + (it.cant_origen ? ' ' + chipOrigen(it.cant_origen) : '') +
                            ' × Bs ' + bs(it.pu) + ' (precio unitario con recargos)' + (it.desde3d ? ' · del 3D, ruta ' + esc(it.desde3d.ruta || 'A') : '') +
                            (it.marcadas ? ' · <b style="color:var(--red);">' + it.marcadas + (it.marcadas > 1 ? ' marcadas' : ' marcada') + '</b>' : '') + '</div>' +
                            ((it.caracteristicas || []).length ? '<div style="font-size:12px;margin:4px 0 2px;line-height:1.4;">' + lista(it.caracteristicas).map(function (c) {
                                var pend = c.supuesto && !c.confirmado;
                                return '<div' + (pend ? ' style="color:#0b6e99;"' : '') + '>• ' + esc(c.texto) + ' ' + chipOrigen(c.origen) + (pend ? ' <i>(supuesto: sale al presupuesto cuando lo confirmes)</i>' : '') + '</div>';
                            }).join('') + '</div>' : '<div class="ag-it-sub" style="color:var(--orange);">Sin características para el cliente: pedíselas al agente.</div>') +
                            (it.nota ? '<div class="ag-it-sub">' + esc(it.nota) + '</div>' : '') +
                            (it.aviso ? '<div class="ag-it-sub" style="color:var(--orange);font-weight:700;">⚠ ' + esc(it.aviso) + '</div>' : '') + filas +
                            (it.supuestos_pendientes ? '<div class="ag-sup"><span style="flex:1;">' + it.supuestos_pendientes + ' supuesto' + (it.supuestos_pendientes > 1 ? 's' : '') +
                                ' del agente sin confirmar: este ítem no se aplica al presupuesto hasta que los confirmes (o corregilos por el chat).</span>' +
                                '<button class="ag-btn prim" onclick="_agConfirmarSup(\'' + it.id + '\')">Confirmar supuestos</button></div>' : '') + '</div>';
                    }).join('') + '</div>';
            }).join('') +
            '<div class="ag-tot"><span>TOTAL BORRADOR</span><span>Bs ' + bs(borrador.total) + '</span></div>' +
            '<div class="ag-it-sub" style="margin:8px 0 4px;">Los totales los calcula la app (no la IA). Etiquetas: ' + chipOrigen('pieza3d:') + 'medido del 3D · ' +
            chipOrigen('base:') + 'base de precios · ' + chipOrigen('cota_plano:') + 'cota del plano · ' + chipOrigen('dueño:') + 'lo dijiste vos · ' + chipOrigen('supuesto:') + 'propuesta del agente (hay que confirmarla). Para corregir, escribilo en el chat.</div>' +
            '<div id="ag-aplicar"></div>';
        if (window._agPintarAplicar) window._agPintarAplicar();
        if (foco && !foco.hecho) enfocarItem();
    }
    // ------------------------------------------------------------------ aplicar al presupuesto (al final, id estable, origen "agente")
    window._agPintarAplicar = function () {
        var el = $('ag-aplicar');
        if (!el || !borrador) return;
        var ap = borrador.aplicado;
        el.innerHTML = '<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px;margin:10px 0 20px;">' +
            (ap ? '<div class="ag-it-sub" style="margin-bottom:8px;">✅ Aplicada la versión ' + ap.version + ' (' + hora(ap.fecha) + '): ' + ap.agregados + ' ítems nuevos' +
                (ap.actualizados ? ', ' + ap.actualizados + ' actualizados' : '') + '.' + (ap.version !== borrador.version ? ' <b>Hay cambios después de aplicar.</b>' : '') + '</div>' : '') +
            '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:8px;"><input type="checkbox" id="ag-con-cap" checked> Con sus capítulos</label>' +
            '<button class="ag-btn prim" style="width:100%;padding:12px;font-size:15px;" onclick="_agAplicar()">' + (ap ? 'Aplicar de nuevo al presupuesto' : 'Aplicar al presupuesto') + '</button>' +
            (borrador.supuestos_pendientes ? '<div style="color:#0b6e99;font-weight:700;font-size:12px;margin-bottom:6px;">Los ítems con supuestos sin confirmar no se aplican todavía.</div>' : '') +
            '<div class="ag-it-sub" style="margin-top:6px;">Los ítems van al final del presupuesto. Si ya se aplicaron, se actualizan en su lugar (no se reordena nada).' +
            (borrador.filas_marcadas ? (borrador.filas_marcadas > 1 ? ' Las ' + borrador.filas_marcadas + ' filas marcadas quedan' : ' La fila marcada queda') + ' en rojo en el APU.' : '') + '</div></div>';
    };
    window._agAplicar = function () {
        if (!borrador || typeof data === 'undefined' || !window.AgenteBorrador) return alert('No se pudo leer el presupuesto.');
        var items = AgenteBorrador.aItemsPresupuesto(borrador, { conv: conv, capitulos: $('ag-con-cap') ? $('ag-con-cap').checked : true, fecha: Date.now() });
        var n = items.filter(function (x) { return x.type === 'item'; }).length;
        if (!n) return alert(borrador.supuestos_pendientes ? 'Todos los ítems tienen supuestos sin confirmar: confirmalos primero.' : 'El borrador no tiene ítems.');
        if (!confirm('¿Agregar ' + n + ' ítem' + (n > 1 ? 's' : '') + ' del borrador al presupuesto (Bs ' + bs(borrador.total) + ')?' +
            (borrador.filas_marcadas ? '\n' + borrador.filas_marcadas + ' filas quedan marcadas (sin precio o sin rendimiento).' : ''))) return;
        var r = AgenteBorrador.aplicarAlPresupuesto(data, items);
        data.length = 0; r.data.forEach(function (x) { data.push(x); });
        if (typeof saveDB === 'function') saveDB(true);
        if (typeof render === 'function') render();
        var ap = { fecha: firebase.database.ServerValue.TIMESTAMP, version: borrador.version, agregados: r.agregados, actualizados: r.actualizados, por: (firebase.auth().currentUser || {}).uid || null };
        db.ref(raizConv() + '/borrador/aplicado').set(ap).catch(function (e) { console.warn('[agente] aplicado', e); });
        db.ref(raizConv() + '/conversacion/mensajes').push({ rol: 'aviso', fecha: firebase.database.ServerValue.TIMESTAMP,
            texto: '✅ Borrador v' + borrador.version + ' aplicado al presupuesto: ' + r.agregados + ' ítems nuevos' + (r.actualizados ? ', ' + r.actualizados + ' actualizados' : '') + ' (Bs ' + bs(borrador.total) + ').' });
        alert('✅ Listo: ' + r.agregados + ' ítems agregados al final' + (r.actualizados ? ' y ' + r.actualizados + ' actualizados en su lugar' : '') + '.');
    };

    // ------------------------------------------------------------------ edición a mano (sin IA, costo 0)
    function buscarItemBorrador(id) {
        var b = AgenteBorrador.normalizar(borrador), r = null;
        b.capitulos.forEach(function (c) { c.items.forEach(function (it) { if (it.id === id) r = it; }); });
        return r;
    }
    async function guardarEdicion(cambio) {
        if (trabajando()) { alert('Esperá a que el agente termine para editar.'); return false; }
        var ref = db.ref(raizConv() + '/conversacion/mensajes').push();
        var r = AgenteBorrador.editarManual(borrador, cambio, ref.key);
        if (r.error) { alert(r.error); return false; }
        try {
            await ref.set({ rol: 'dueno', tipo: 'edicion', texto: '✎ Editado a mano (sin IA) ' + r.texto, fecha: firebase.database.ServerValue.TIMESTAMP });
            await db.ref(raizConv() + '/borrador').set(JSON.parse(JSON.stringify(r.borrador)));
            await db.ref(raizConv() + '/conversacion/ediciones').push({ texto: r.texto, fecha: firebase.database.ServerValue.TIMESTAMP });
            return true;
        } catch (e) { alert('No se pudo guardar: ' + e.message); return false; }
    }
    window._agEditar = function (id) {
        var it = buscarItemBorrador(id);
        if (!it) return;
        var d = $('ag-edit');
        if (!d) { d = document.createElement('div'); d.id = 'ag-edit'; document.body.appendChild(d); }
        d.innerHTML = '<div class="box"><b>Editar a mano (sin IA, gratis)</b>' +
            '<label>Nombre del ítem<input id="ag-e-desc" maxlength="80" value="' + esc(it.desc) + '"></label>' +
            '<label>Cantidad (' + esc(it.und || 'glb') + ')<input id="ag-e-cant" type="number" min="0" step="any" inputmode="decimal" value="' + esc(it.cant) + '"></label>' +
            '<label>Características para el cliente (una por renglón)<textarea id="ag-e-car" rows="5">' + esc(lista(it.caracteristicas).map(function (c) { return c.texto; }).join('\n')) + '</textarea></label>' +
            '<div style="display:flex;gap:8px;margin-top:12px;"><button class="ag-btn" style="flex:1;padding:12px;" onclick="document.getElementById(\'ag-edit\').style.display=\'none\'">Cancelar</button>' +
            '<button class="ag-btn prim" style="flex:1;padding:12px;" id="ag-e-ok">Guardar</button></div>' +
            '<div class="ag-it-sub" style="margin-top:6px;">Se guarda sin llamar al agente; en tu próximo mensaje se entera de lo que cambiaste.</div></div>';
        d.style.display = 'flex';
        $('ag-e-ok').onclick = async function () {
            var cambio = { item: id };
            var nd = $('ag-e-desc').value.trim(), nc = parseFloat($('ag-e-cant').value), car = $('ag-e-car').value;
            if (nd !== it.desc) cambio.desc = nd;
            if (nc !== Number(it.cant)) cambio.cant = nc;
            var viejas = lista(it.caracteristicas).map(function (c) { return c.texto; }).join('\n');
            if (car.trim() !== viejas.trim()) cambio.caracteristicas = car;
            if (Object.keys(cambio).length === 1) { d.style.display = 'none'; return; }
            if (await guardarEdicion(cambio)) d.style.display = 'none';
        };
    };
    window._agBorrarFila = function (id, tipo, n) {
        var it = buscarItemBorrador(id), f = it && lista(it.apu && it.apu[tipo])[n - 1];
        if (!f || !confirm('¿Borrar la fila "' + f.d + '"? (sin IA)')) return;
        guardarEdicion({ item: id, quitar: { tipo: tipo, n: n } });
    };

    window._agConfirmarSup = function (itemId) {
        if (trabajando()) return alert('Esperá a que el agente termine para confirmar.');
        var r = AgenteBorrador.confirmarSupuestos(borrador, itemId, 'dueño:botón "Confirmar supuestos"');
        db.ref(raizConv() + '/borrador').set(JSON.parse(JSON.stringify(r.borrador))).catch(function (e) { alert('No se pudo guardar: ' + e.message); });
    };
    /** Lleva el borrador al ítem en foco y lo resalta (si el borrador ya cargó; si no, se reintenta al llegar). */
    function enfocarItem() {
        if (!foco) return;
        var el = document.querySelector('#ag-borr .ag-it[data-id="' + String(foco.item).replace(/"/g, '') + '"]');
        if (!el) return;
        window._agVerBorrador(true);
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
        el.style.transition = 'box-shadow .3s'; el.style.boxShadow = '0 0 0 3px var(--green)';
        setTimeout(function () { el.style.boxShadow = ''; }, 2500);
        foco.hecho = true;
    }
    window._agVerBorrador = function (forzar) {
        verBorrador = typeof forzar === 'boolean' ? forzar : !verBorrador;
        $('ag-borr').style.display = verBorrador ? 'block' : 'none';
        $('ag-msgs').style.display = verBorrador ? 'none' : 'block';
        $('ag-tab').classList.toggle('on', verBorrador);
        if (!verBorrador) { var m = $('ag-msgs'); m.scrollTop = m.scrollHeight; }
    };

    // ------------------------------------------------------------------ estado (progreso)
    function trabajando() {
        var viejo = Date.now() - (estado.actualizado || 0) > 10 * 60 * 1000;
        return (estado.fase === 'trabajando' || estado.fase === 'en_cola') && !viejo;
    }
    function pintarEstado() {
        var el = $('ag-estado');
        if (!el) return;
        var h = '';
        var otra = estado.conv && estado.conv !== conv;
        if (trabajando() && otra) {
            h = '<div class="ag-spin"></div><span style="flex:1;">El agente está trabajando en otra conversación de este proyecto.</span><button class="ag-btn" onclick="_agAbrirConv(\'' + esc(estado.conv) + '\')">Ver</button>';
        } else if (otra && (estado.fase === 'error' || estado.fase === 'tope')) {
            h = '';
        } else if (trabajando()) {
            h = '<div class="ag-spin"></div><span style="flex:1;">' + esc(estado.texto || 'Trabajando…') + '</span>' +
                '<button class="ag-btn" onclick="_agDetener()">Detener</button>';
        } else if ((estado.fase === 'trabajando' || estado.fase === 'en_cola')) {
            h = '<span style="flex:1;">⚠ El agente dejó de responder.</span><button class="ag-btn" onclick="_agReintentar(false)">Reintentar</button>';
        } else if (estado.fase === 'error') {
            h = '<span style="flex:1;color:var(--red);">⚠ ' + esc(estado.texto || 'Error') + '</span><button class="ag-btn" onclick="_agReintentar(false)">Reintentar</button>';
        }
        el.innerHTML = h;
        el.style.display = h ? 'flex' : 'none';
        if (estado.conv && estado.conv === conv && estado.fase !== 'trabajando' && estado.fase !== 'en_cola') pintarConvs();
        var env = $('ag-env'); if (env) env.disabled = trabajando() || pendientes.some(function (p) { return p.estado === 'procesando'; });
    }

    // ------------------------------------------------------------------ costos
    function pintarCosto() {
        var el = $('ag-costo');
        if (!el) return;
        var c = cfg(), t = N.estadoTope(costoMes.usd || 0, c);
        el.className = 'ag-costo' + (t.nivel !== 'ok' ? ' ' + t.nivel : '');
        el.innerHTML = 'Conv. <b>' + N.usd(costoProyecto.usd || 0) + '</b> · Proy. ' + N.usd(costoTotalProyecto()) + '<br>Mes <b>' + N.usd(costoMes.usd || 0) + '</b>/' + Math.round(c.tope_mensual_usd) + ' ▾';
        if ($('ag-p-costos').style.display === 'block') pintarDetalleCostos();
    }
    function pintarDetalleCostos() {
        var p = $('ag-p-costos'), c = cfg(), t = N.estadoTope(costoMes.usd || 0, c);
        p.innerHTML = '<div>Cargando…</div>';
        db.ref(raizConv() + '/costos/llamadas').limitToLast(60).once('value').then(function (s) {
            var filas = [];
            s.forEach(function (ch) { filas.push(ch.val()); });
            filas.reverse();
            p.innerHTML = (t.nivel !== 'ok' ? '<div style="color:var(' + (t.nivel === 'tope' ? '--red' : '--orange') + ');font-weight:700;margin-bottom:6px;">' +
                (t.nivel === 'tope' ? 'Se llegó al tope mensual: el agente frena antes de cada llamada (podés seguir igual).' : 'Ya se usó el ' + Math.round(t.pct) + ' % del tope mensual.') + '</div>' : '') +
                '<div style="margin-bottom:6px;">Esta conversación: <b>' + N.usd(costoProyecto.usd || 0) + '</b> en ' + (costoProyecto.llamadas || 0) + ' llamadas · Proyecto (todas las conversaciones): <b>' + N.usd(costoTotalProyecto()) + '</b> · Mes: <b>' +
                N.usd(costoMes.usd || 0) + '</b> (' + (costoMes.llamadas || 0) + ' llamadas, todos los proyectos)</div>' +
                (filas.length ? '<table><tr><th>Hora</th><th>Modelo</th><th>Entrada nueva</th><th>Salida (con pensamiento)</th><th>Caché esc.</th><th>Caché leída</th><th title="% de la entrada que vino de la caché">De caché</th><th>USD</th></tr>' +
                    filas.map(function (f) {
                        return '<tr><td>' + hora(f.fecha) + '</td><td>' + esc(String(f.modelo || '').replace('claude-', '')) + '</td><td>' + (f.entrada || 0) +
                            '</td><td>' + (f.salida || 0) + '</td><td>' + (f.cache_escrita || 0) + '</td><td>' + (f.cache_leida || 0) + '</td><td>' + (f.pct_cache != null ? f.pct_cache : N.pctCache(f)) + ' %</td><td>' + N.usd(f.usd) + '</td></tr>';
                    }).join('') + '</table>' : '<div>Todavía no hubo llamadas en este proyecto.</div>') +
                '<div style="margin-top:6px;color:var(--gray);">Precio por millón de tokens según la configuración (Opus 5.5: 4 entrada / 20 salida / 0,20 caché leída). "De caché" alto (70 % o más desde la segunda llamada) = la caché funciona.</div>';
        }).catch(function (e) { p.innerHTML = 'No se pudo leer el detalle: ' + esc(e.message); });
    }

    function pintarConfig() {
        var c = cfg(), p = $('ag-p-config');
        var opc = function (lista, val) { return lista.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === val ? ' selected' : '') + '>' + x[1] + '</option>'; }).join(''); };
        p.innerHTML = '<b>Configuración del agente</b> <span style="color:var(--gray);">(vale para todos los proyectos)</span>' +
            '<label>Modelo<select id="ag-c-modelo">' + opc([['claude-opus-5-5', 'Claude Opus 5.5 (recomendado)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (más barato)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (el más barato)']], c.modelo) + '</select></label>' +
            '<label>Esfuerzo<select id="ag-c-effort">' + opc([['low', 'Bajo'], ['medium', 'Medio'], ['high', 'Alto (recomendado)'], ['xhigh', 'Muy alto'], ['max', 'Máximo']], c.effort) + '</select></label>' +
            '<label>Modelo en las correcciones (después del primer borrador)<select id="ag-c-modelo2">' + opc([['igual', 'El mismo modelo principal']].concat(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map(function (m) {
                var est = N.costoCorreccionEstimado(m, c.precios);
                return [m, ({ 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5' })[m] + (est != null ? ' · ≈ ' + N.usd(est) + ' por corrección' : '')];
            })), c.modelo_correcciones) + '</select></label>' +
            '<div style="color:var(--gray);font-size:11px;">Estimado de una corrección chica con la conversación ya compactada (sin contar la primera escritura de la caché). Cambiar de modelo empieza otra caché.</div>' +
            '<label>Esfuerzo en las correcciones (después del primer borrador)<select id="ag-c-effort2">' + opc([['low', 'Bajo'], ['medium', 'Medio (recomendado: más barato)'], ['high', 'Alto'], ['igual', 'Igual que el primero']], c.effort_correcciones) + '</select></label>' +
            '<label>Tope mensual (US$)<input id="ag-c-tope" type="number" min="1" step="1" inputmode="decimal" value="' + c.tope_mensual_usd + '"></label>' +
            '<label>Avisar al llegar al (%)<input id="ag-c-aviso" type="number" min="10" max="100" step="5" value="' + c.aviso_pct + '"></label>' +
            '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;"><button class="ag-btn prim" onclick="_agGuardarConfig()">Guardar</button>' +
            '<button class="ag-btn" onclick="cerrarAgenteIA(); abrirImportar3D();">Importar 3D (respaldo)</button></div>' +
            '<div style="margin-top:14px;"><b>Memoria del agente</b> <span style="color:var(--gray);">(correcciones y decisiones que recuerda entre proyectos)</span><div id="ag-memoria">Cargando…</div></div>';
        Promise.all(['normas', 'notas'].map(function (n) { return db.ref('agente_memoria/' + n).limitToLast(100).once('value').then(function (s) { return { n: n, s: s }; }); })).then(function (rs) {
            var h = [];
            rs.forEach(function (r) {
                var filas = [];
                r.s.forEach(function (ch) { var v = ch.val() || {}; filas.push('<div style="display:flex;gap:6px;align-items:flex-start;padding:5px 0;border-bottom:1px solid var(--border);"><span style="flex:1;">' + esc(v.texto) +
                    '</span><button class="ag-btn" style="padding:2px 8px;" onclick="_agBorrarMemoria(\'' + r.n + '\',\'' + ch.key + '\')" aria-label="Borrar">×</button></div>'); });
                if (filas.length) h.push('<div style="font-weight:700;margin-top:6px;">' + (r.n === 'normas' ? 'Normas constructivas del taller' : 'Notas') + '</div>' + filas.reverse().join(''));
            });
            var m = $('ag-memoria'); if (m) m.innerHTML = h.length ? h.join('') : '<div style="color:var(--gray);padding:4px 0;">Todavía no anotó nada. Cuando lo corrijas, te propone recordarlo.</div>';
        }).catch(function (e) { var m = $('ag-memoria'); if (m) m.textContent = 'No se pudo leer: ' + e.message; });
    }
    window._agBorrarMemoria = function (nodo, k) {
        if (!confirm('¿Borrar esta entrada de la memoria?')) return;
        db.ref('agente_memoria/' + nodo + '/' + k).remove().then(pintarConfig).catch(function (e) { alert(e.message); });
    };
    window._agGuardarConfig = function () {
        var v = { modelo: $('ag-c-modelo').value, effort: $('ag-c-effort').value, effort_correcciones: $('ag-c-effort2').value, modelo_correcciones: $('ag-c-modelo2').value,
            tope_mensual_usd: parseFloat($('ag-c-tope').value) || N.CONFIG_DEFECTO.tope_mensual_usd,
            aviso_pct: parseFloat($('ag-c-aviso').value) || N.CONFIG_DEFECTO.aviso_pct,
            actualizado: firebase.database.ServerValue.TIMESTAMP };
        db.ref('config/agente').update(v).then(function () { $('ag-p-config').style.display = 'none'; })
            .catch(function (e) { alert('No se pudo guardar: ' + e.message); });
    };
    window._agPanel = function (cual) {
        ['convs', 'costos', 'config'].forEach(function (x) {
            var p = $('ag-p-' + x), ver = x === cual && p.style.display !== 'block';
            p.style.display = ver ? 'block' : 'none';
            if (ver) { if (x === 'costos') pintarDetalleCostos(); else if (x === 'convs') pintarConvs(); else pintarConfig(); }
        });
    };

    // ------------------------------------------------------------------ llamar a /api/agente
    async function llamar(cuerpo) {
        var u = firebase.auth().currentUser;
        if (!u) throw new Error('Sesión vencida: recargá la página.');
        var r = await fetch('/api/agente', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + await u.getIdToken() },
            body: JSON.stringify(Object.assign({ cid: cid, pid: pid, conv: conv }, cuerpo)) });
        var j = {};
        try { j = await r.json(); } catch (e) { j = {}; }
        if (!r.ok) throw new Error(j.error || ('El agente respondió ' + r.status + (r.status === 413 ? ' (archivo muy pesado)' : '')));
        return j;
    }

    // ------------------------------------------------------------------ adjuntos (un solo botón para todo)
    function aBase64(blob) {
        return new Promise(function (ok, ko) {
            var fr = new FileReader();
            fr.onload = function () { ok(String(fr.result).split(',')[1] || ''); };
            fr.onerror = function () { ko(new Error('No se pudo leer el archivo.')); };
            fr.readAsDataURL(blob);
        });
    }
    function cargarImagen(blob) {
        return new Promise(function (ok, ko) {
            var url = URL.createObjectURL(blob), img = new Image();
            img.onload = function () { ok(img); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); };
            img.onerror = function () { URL.revokeObjectURL(url); ko(new Error('No se pudo abrir la imagen.')); };
            img.src = url;
        });
    }
    /** Foto lista para la API: lado mayor ≤ 2000 px, JPEG, < 4,5 MB. */
    async function reducirImagen(archivo) {
        var img = await cargarImagen(archivo);
        var f = Math.min(1, MAX_IMG_LADO / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.max(1, Math.round(img.naturalWidth * f)), h = Math.max(1, Math.round(img.naturalHeight * f));
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0, w, h);
        var calidad = 0.86, blob;
        do { blob = await new Promise(function (r) { cv.toBlob(r, 'image/jpeg', calidad); }); calidad -= 0.12; } while (blob && blob.size > 4.5 * 1048576 && calidad > 0.3);
        return { blob: blob, ancho: w, alto: h, canvas: cv };
    }

    function agregarPendiente(nombre, tipo) {
        var p = { clave: Math.random().toString(36).slice(2), nombre: nombre, tipo: tipo, estado: 'procesando' };
        pendientes.push(p); pintarAdjuntos();
        return p;
    }
    function marcar(p, cambios) { Object.assign(p, cambios); pintarAdjuntos(); }
    function pintarAdjuntos() {
        var el = $('ag-adj');
        if (!el) return;
        el.innerHTML = pendientes.length ? '<div style="padding:6px 0 2px;">' + pendientes.map(function (p) {
            var ico = p.estado === 'procesando' ? '<span class="ag-spin" style="width:11px;height:11px;"></span>' : p.estado === 'error' ? '⚠' : (p.miniatura ? '<img src="' + p.miniatura + '" alt="">' : iconoTipo(p.tipo));
            return '<span class="ag-chip' + (p.estado === 'error' ? ' error' : '') + '" title="' + esc(p.error || p.nombre) + '">' + ico + ' ' + esc(p.estado === 'error' ? p.nombre + ': ' + p.error : (p.nota || p.nombre)) +
                (p.anotable && p.estado === 'listo' && window.AgenteAnotador ? '<button onclick="_agAnotar(\'' + p.clave + '\')" aria-label="Anotar la foto" title="Dibujar cotas, marcas y notas">✏️</button>' : '') +
                (p.estado !== 'procesando' ? '<button onclick="_agQuitar(\'' + p.clave + '\')" aria-label="Quitar">×</button>' : '') + '</span>';
        }).join('') + '</div>' : '';
        pintarEstado();
    }
    window._agQuitar = function (clave) { pendientes = pendientes.filter(function (p) { return p.clave !== clave; }); pintarAdjuntos(); };

    /**
     * Vistas del 3D para el agente (isométrica y frente) con el número de cada pieza (p1, p2… = orden de rubik/1).
     * El modelo no "ve" el FBX: con esto relaciona las piezas con las fotos, el render y el PDF. Si falla, se sigue sin vistas.
     */
    async function renderVistas(raiz, res) {
        var T = (await window.Importar3D.three()).THREE;
        var W = 1000, H = 750, vistas = [];
        var renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(W, H, false); renderer.setClearColor(0xffffff, 1);
        var escena = new T.Scene();
        var padre = raiz.parent; escena.add(raiz);
        escena.overrideMaterial = new T.MeshNormalMaterial({ side: T.DoubleSide });
        raiz.updateMatrixWorld(true);
        // centro de cada objeto de cada pieza; el encuadre es el de las piezas medidas (no el entorno del archivo)
        var marcas = [], caja = new T.Box3();
        (res.piezas || []).forEach(function (p, i) {
            (p.objetos || []).forEach(function (nombre) {
                var o = raiz.getObjectByName(nombre);
                if (!o) return;
                var c = new T.Box3().setFromObject(o);
                if (!c.isEmpty()) { caja.union(c); marcas.push({ id: 'p' + (i + 1), pos: c.getCenter(new T.Vector3()) }); }
            });
        });
        if (caja.isEmpty()) caja.setFromObject(raiz);
        var centro = caja.getCenter(new T.Vector3()), tam = caja.getSize(new T.Vector3());
        var radio = Math.max(tam.x, tam.y, tam.z) || 1;
        [['isométrica', new T.Vector3(1, 0.8, 1)], ['frente', new T.Vector3(0, 0, 1)]].forEach(function (v) {
            var dir = v[1].clone().normalize();
            var asp = W / H, m = radio * 0.62;
            var cam = new T.OrthographicCamera(-m * asp, m * asp, m, -m, -radio * 10, radio * 10);
            cam.position.copy(centro.clone().add(dir.multiplyScalar(radio * 2))); cam.up.set(0, 1, 0); cam.lookAt(centro); cam.updateMatrixWorld();
            // encuadre justo: las 8 esquinas de la caja en coordenadas de la cámara, con margen y la proporción de la imagen
            var mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
            [caja.min.x, caja.max.x].forEach(function (x) { [caja.min.y, caja.max.y].forEach(function (y) { [caja.min.z, caja.max.z].forEach(function (z) {
                var q = new T.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse);
                mn[0] = Math.min(mn[0], q.x); mn[1] = Math.min(mn[1], q.y); mx[0] = Math.max(mx[0], q.x); mx[1] = Math.max(mx[1], q.y);
            }); }); });
            var cxm = (mn[0] + mx[0]) / 2, cym = (mn[1] + mx[1]) / 2, hw = Math.max((mx[0] - mn[0]) / 2, 1e-6) * 1.12, hh = Math.max((mx[1] - mn[1]) / 2, 1e-6) * 1.12;
            if (hw / hh > asp) hh = hw / asp; else hw = hh * asp;
            cam.left = cxm - hw; cam.right = cxm + hw; cam.top = cym + hh; cam.bottom = cym - hh;
            cam.updateProjectionMatrix();
            renderer.render(escena, cam);
            var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
            var cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0);
            cx.font = 'bold 18px system-ui,sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
            var puestas = [];   // evita que las etiquetas se pisen: se corren hacia abajo
            marcas.forEach(function (mk) {
                var q = mk.pos.clone().project(cam), x = (q.x + 1) / 2 * W, y = (1 - q.y) / 2 * H;
                if (x < 0 || x > W || y < 0 || y > H) return;
                var w = cx.measureText(mk.id).width + 10;
                if (puestas.some(function (o) { return o.id === mk.id && Math.abs(o.x - x) < 30 && Math.abs(o.y - y) < 30; })) return;
                for (var k = 0; k < 12 && puestas.some(function (o) { return Math.abs(o.x - x) < (o.w + w) / 2 && Math.abs(o.y - y) < 24; }); k++) y += 24;
                puestas.push({ id: mk.id, x: x, y: y, w: w });
                cx.fillStyle = 'rgba(0,0,0,0.65)'; cx.fillRect(x - w / 2, y - 12, w, 24);
                cx.fillStyle = '#fff'; cx.fillText(mk.id, x, y + 1);
            });
            cx.fillStyle = '#333'; cx.textAlign = 'left'; cx.font = '15px system-ui,sans-serif';
            cx.fillText('Vista ' + v[0] + ' · números = piezas de medicion_3d', 10, H - 14);
            vistas.push({ nombre: v[0], canvas: cv });
        });
        escena.remove(raiz); if (padre) padre.add(raiz);
        escena.overrideMaterial.dispose(); renderer.dispose();
        var salida = [];
        for (var i = 0; i < vistas.length; i++) {
            var blob = await new Promise(function (r) { vistas[i].canvas.toBlob(r, 'image/jpeg', 0.82); });
            salida.push({ nombre: vistas[i].nombre, datos: await aBase64(blob), miniatura: i === 0 ? vistas[i].canvas.toDataURL('image/jpeg', 0.5) : null });
        }
        return salida;
    }

    async function adjuntar3D(modelo, archivos, json) {
        var p = agregarPendiente((json || modelo).name, '3d');
        var urls = [];
        try {
            if (!window.Importar3D) throw new Error('No cargó el lector 3D.');
            marcar(p, { nota: 'Midiendo ' + (json || modelo).name + '…' });
            var eq = await window.Importar3D.equivalencias();
            var res, tam = null, unidad = 'm', leido = null;
            if (json) {
                res = Lector3D.desdeRubikJson(JSON.parse(await json.text()), eq);
            } else {
                leido = await window.Importar3D.leerModelo(modelo, archivos, urls);
                var det = Lector3D.detectarUnidad(leido.raiz, leido.tipo);
                var factor = Lector3D.FACTORES[det.unidad];
                res = Lector3D.analizar(leido.raiz, { factor: factor, equivalencias: eq, archivo: modelo.name, proyecto: modelo.name.replace(/\.[^.]+$/, '') });
                tam = det.tamano.map(function (x) { return x * factor; });
                unidad = det.unidad + (det.motivo ? ' (' + det.motivo + ')' : '');
            }
            if (!res.piezas || !res.piezas.length) throw new Error('El modelo no tiene piezas medibles.');
            var vistas = [];
            if (leido) {
                marcar(p, { nota: 'Dibujando las vistas…' });
                try { vistas = await renderVistas(leido.raiz, res); } catch (ev) { console.warn('[agente] vistas del 3D', ev); vistas = []; }
                if (vistas[0]) marcar(p, { miniatura: vistas[0].miniatura });
            }
            marcar(p, { nota: 'Subiendo la medición…' });
            var r = await llamar({ accion: 'adjuntar', tipo: '3d', nombre: (json || modelo).name, medicion: res, tamano_m: tam, unidad: unidad,
                vistas: vistas.map(function (v) { return { nombre: v.nombre, datos: v.datos }; }) });
            marcar(p, { estado: 'listo', id: r.id, nota: (json || modelo).name + ' · ' + res.piezas.length + ' piezas' });
        } catch (e) {
            console.error('[agente] 3D', e);
            marcar(p, { estado: 'error', error: e.message || String(e) });
        } finally { urls.forEach(function (u) { URL.revokeObjectURL(u); }); }
    }

    async function adjuntarPDF(f) {
        var p = agregarPendiente(f.name, 'pdf');
        try {
            if (f.size > MAX_PDF_MB * 1048576) throw new Error('pesa ' + (f.size / 1048576).toFixed(1) + ' MB (máximo ' + MAX_PDF_MB + ' MB)');
            var r = await llamar({ accion: 'adjuntar', tipo: 'pdf', nombre: f.name, datos: await aBase64(f) });
            marcar(p, { estado: 'listo', id: r.id });
        } catch (e) { marcar(p, { estado: 'error', error: e.message }); }
    }

    async function adjuntarImagen(f) {
        var p = agregarPendiente(f.name, 'imagen');
        try {
            var red = await reducirImagen(f);
            marcar(p, { miniatura: red.canvas.toDataURL('image/jpeg', 0.5), red: red });
            var r = await llamar({ accion: 'adjuntar', tipo: 'imagen', nombre: f.name, datos: await aBase64(red.blob), ancho: red.ancho, alto: red.alto });
            marcar(p, { estado: 'listo', id: r.id, anotable: true });
        } catch (e) { marcar(p, { estado: 'error', error: e.message }); }
    }

    /** ✏️ en el chip de una foto: editor de anotaciones; se sube de nuevo con la anotada y el JSON (reemplaza a la anterior). */
    window._agAnotar = async function (clave) {
        var p = pendientes.find(function (x) { return x.clave === clave; });
        if (!p || !p.red || !window.AgenteAnotador) return;
        var r = await window.AgenteAnotador.editar(p.red, p.nombre, p.anotacionesEditor);
        if (!r || r.cancelado || !r.anotaciones || !r.anotaciones.length) return;
        marcar(p, { estado: 'procesando', nota: 'Subiendo la foto anotada…' });
        try {
            var res = await llamar({ accion: 'adjuntar', tipo: 'imagen', nombre: p.nombre, datos: await aBase64(p.red.blob), ancho: p.red.ancho, alto: p.red.alto,
                anotada: await aBase64(r.blob), anotaciones: r.anotaciones });
            marcar(p, { estado: 'listo', id: res.id, miniatura: r.miniatura, anotacionesEditor: r.editor, nota: p.nombre + ' · ' + r.anotaciones.length + (r.anotaciones.length > 1 ? ' anotaciones' : ' anotación') });
        } catch (e) { marcar(p, { estado: 'error', error: e.message }); }
    };

    window._agArchivos = async function (lista) {
        var originales = Array.from(lista || []);
        if (!originales.length) return;
        if (!window.Importar3D) { alert('Todavía se está cargando la página. Probá de nuevo en un segundo.'); return; }
        var norm = await window.Importar3D.normalizarArchivos(originales);
        norm.raros.forEach(function (f) { var p = agregarPendiente(f.name || 'archivo', '?'); marcar(p, { estado: 'error', error: 'no es 3D, PDF, foto ni .zip' }); });
        var archivos = norm.archivos, ext = function (f) { return (f.name.split('.').pop() || '').toLowerCase(); };
        for (var i = 0; i < archivos.length; i++) {
            if (ext(archivos[i]) !== 'zip') continue;
            try { archivos = archivos.concat(await window.Importar3D.extraerZip(archivos[i], true)); }
            catch (e) { var pz = agregarPendiente(archivos[i].name, '?'); marcar(pz, { estado: 'error', error: e.message }); }
        }
        archivos = archivos.filter(function (f) { return ext(f) !== 'zip'; });
        archivos.filter(function (f) { return ext(f) === 'skp'; }).forEach(function (f) {
            marcar(agregarPendiente(f.name, '3d'), { estado: 'error', error: 'el .skp no se lee directo: exportalo a FBX o glTF desde SketchUp' });
        });
        var modelos = archivos.filter(function (f) { return ['glb', 'gltf', 'fbx'].indexOf(ext(f)) >= 0; });
        var jsons = archivos.filter(function (f) { return ext(f) === 'json'; });
        var tareas = [];
        modelos.forEach(function (m) { tareas.push(adjuntar3D(m, archivos, null)); });
        if (!modelos.length) jsons.forEach(function (j) { tareas.push(adjuntar3D(null, archivos, j)); });
        archivos.filter(function (f) { return ext(f) === 'pdf'; }).forEach(function (f) { tareas.push(adjuntarPDF(f)); });
        // Las fotos de a una (el editor de anotaciones se abre para cada una)
        var fotos = archivos.filter(function (f) { return Lector3D.detectarTipo(f.name, f.type, new Uint8Array(0)) === 'imagen' || /\.(jpe?g|png|webp)$/i.test(f.name); });
        await Promise.all(tareas);
        for (var k = 0; k < fotos.length; k++) await adjuntarImagen(fotos[k]);
    };

    // ------------------------------------------------------------------ enviar, reintentar, detener
    window._agAuto = function (t) { t.style.height = 'auto'; if (t.value) t.style.height = Math.min(140, t.scrollHeight) + 'px'; else t.style.height = ''; };
    window._agTecla = function (e) {
        if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer:fine)').matches) { e.preventDefault(); window._agEnviar(); }
    };
    window._agEnviar = async function () {
        var t = $('ag-txt'), texto = t.value.trim();
        var listos = pendientes.filter(function (p) { return p.estado === 'listo'; });
        if (pendientes.some(function (p) { return p.estado === 'procesando'; })) return alert('Esperá a que terminen de procesarse los adjuntos.');
        if (!texto && !listos.length) return;
        pararMic();
        var btn = $('ag-env'); btn.disabled = true;
        try {
            await llamar({ accion: 'enviar', texto: texto, adjuntos: listos.map(function (p) { return p.id; }) });
            t.value = ''; window._agAuto(t);
            pendientes = pendientes.filter(function (p) { return p.estado === 'error' ? false : listos.indexOf(p) < 0; });
            pintarAdjuntos();
        } catch (e) { alert(e.message); }
        finally { btn.disabled = false; pintarEstado(); }
    };
    window._agReintentar = async function (pasarTope) {
        try { await llamar({ accion: 'reintentar', pasar_tope: !!pasarTope }); } catch (e) { alert(e.message); }
    };
    window._agDetener = async function () {
        try { await llamar({ accion: 'detener' }); } catch (e) { alert(e.message); }
    };

    // ------------------------------------------------------------------ 🔊 parlante (/api/tts)
    function pararAudio() { if (audioActual) { try { audioActual.pause(); } catch (e) { /* nada */ } audioActual = null; } document.querySelectorAll('#mod-agente .ag-voz').forEach(function (b) { b.textContent = '🔊'; }); }
    window._agVoz = async function (clave, btn) {
        if (audioActual && btn.textContent === '⏹') { pararAudio(); return; }
        pararAudio();
        var m = mensajes[clave] || {};
        var texto = N.textoParaVoz((m.texto || '') + ((m.preguntas || []).length ? '. ' + m.preguntas.map(function (p) { return p.pregunta; }).join('. ') : ''));
        if (!texto) return;
        btn.textContent = '…';
        try {
            var u = firebase.auth().currentUser;
            var r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (u ? await u.getIdToken() : '') }, body: JSON.stringify({ text: texto }) });
            var j = await r.json();
            if (!r.ok || !j.audioContent) throw new Error(j.error || 'sin audio');
            audioActual = new Audio('data:audio/mp3;base64,' + j.audioContent);
            btn.textContent = '⏹';
            audioActual.onended = function () { btn.textContent = '🔊'; audioActual = null; };
            await audioActual.play();
        } catch (e) {
            btn.textContent = '🔊';
            if (window.speechSynthesis) {   // alternativa: la voz del teléfono
                var ut = new SpeechSynthesisUtterance(texto); ut.lang = 'es-419'; window.speechSynthesis.speak(ut);
            } else alert('No se pudo leer en voz alta: ' + e.message);
        }
    };

    // ------------------------------------------------------------------ 🎤 dictado (Web Speech API; si no hay, nota de voz transcrita)
    function pararMic() {
        if (reconocimiento) { try { reconocimiento.stop(); } catch (e) { /* nada */ } }
        if (grabador && grabador.state === 'recording') grabador.stop();
    }
    function marcarMic(on) { var b = $('ag-mic'); if (b) { b.classList.toggle('grabando', !!on); b.textContent = on ? '⏹' : '🎤'; } }
    window._agMic = function () {
        if (reconocimiento || (grabador && grabador.state === 'recording')) { pararMic(); return; }
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SR) return dictar(SR, 'es-BO');
        notaDeVoz();
    };
    function dictar(SR, idioma) {
        var t = $('ag-txt'), base = t.value ? t.value.replace(/\s+$/, '') + ' ' : '';
        var rec = new SR();
        rec.lang = idioma; rec.continuous = true; rec.interimResults = true;
        var finalTxt = '';
        rec.onresult = function (ev) {
            var interino = '';
            for (var i = ev.resultIndex; i < ev.results.length; i++) {
                if (ev.results[i].isFinal) finalTxt += ev.results[i][0].transcript + ' ';
                else interino += ev.results[i][0].transcript;
            }
            t.value = base + finalTxt + interino; window._agAuto(t);
        };
        rec.onerror = function (ev) {
            if (ev.error === 'language-not-supported' && idioma === 'es-BO') { reconocimiento = null; marcarMic(false); dictar(SR, 'es-419'); return; }
            if (ev.error === 'not-allowed') alert('El navegador no dio permiso para el micrófono.');
        };
        rec.onend = function () { reconocimiento = null; marcarMic(false); t.value = t.value.replace(/\s+$/, ''); window._agAuto(t); };
        try { rec.start(); reconocimiento = rec; marcarMic(true); } catch (e) { reconocimiento = null; notaDeVoz(); }
    }
    async function notaDeVoz() {
        if (!navigator.mediaDevices || !window.MediaRecorder) return alert('Este navegador no permite dictar. Usá el micrófono del teclado del teléfono.');
        try {
            var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            var partes = [];
            grabador = new MediaRecorder(stream);
            grabador.ondataavailable = function (e) { if (e.data.size) partes.push(e.data); };
            grabador.onstop = async function () {
                stream.getTracks().forEach(function (tr) { tr.stop(); });
                marcarMic(false);
                var blob = new Blob(partes, { type: grabador.mimeType || 'audio/webm' });
                var t = $('ag-txt'); var antes = t.value; t.value = (antes ? antes + ' ' : '') + '(transcribiendo…)';
                try {
                    var texto = await transcribir(blob);
                    t.value = (antes ? antes.replace(/\s+$/, '') + ' ' : '') + texto;
                } catch (e) { t.value = antes; alert('No se pudo transcribir la nota de voz: ' + e.message); }
                window._agAuto(t);
            };
            grabador.start(); marcarMic(true);
        } catch (e) { alert('No se pudo usar el micrófono: ' + e.message); }
    }
    /** Nota de voz → texto con el proxy /api/gemini que ya existe (solo si el navegador no tiene dictado). */
    async function transcribir(blob) {
        var u = firebase.auth().currentUser;
        var r = await fetch('/api/gemini', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (u ? await u.getIdToken() : '') },
            body: JSON.stringify({ model: 'gemini-2.5-flash', contents: [{ role: 'user', parts: [
                { text: 'Transcribí literalmente esta nota de voz en español de Bolivia. Devolvé solo el texto, sin comentarios.' },
                { inlineData: { mimeType: (blob.type || 'audio/webm').split(';')[0], data: await aBase64(blob) } }] }] }) });
        if (!r.ok) throw new Error('respuesta ' + r.status);
        var j = await r.json();
        var c = j && j.candidates && j.candidates[0] && j.candidates[0].content;
        var texto = c && c.parts ? c.parts.map(function (p) { return p.text || ''; }).join('').trim() : '';
        if (!texto) throw new Error('vino vacía');
        return texto;
    }

    // ------------------------------------------------------------------ "Compartir → Rubik" con destino Agente IA
    async function revisarCompartidos() {
        var q = new URLSearchParams(location.search), id = q.get('agente');
        if (!id || !window.Compartidos3D || !window.indexedDB) return;
        q.delete('agente');
        history.replaceState({}, document.title, location.pathname + '?' + q.toString());
        var archivos = [];
        try { archivos = await Compartidos3D.tomar(id); } catch (e) { archivos = []; }   // lo borra de IndexedDB
        window.abrirAgenteIA(archivos);
    }
    window.addEventListener('load', function () { setTimeout(revisarCompartidos, 1200); });
})();
