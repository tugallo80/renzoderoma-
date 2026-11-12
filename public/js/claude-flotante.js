/**
 * Rubik OS — Botón flotante "Rubik Agente App" (Claude)
 *
 * Abre el proyecto "RUBIK AGENTE APP" de claude.ai:
 *  - PC: en una ventana chica aparte, al costado (claude.ai no se puede incrustar dentro de otra web).
 *  - Celular: abre la app de Claude si está instalada (o claude.ai).
 * El enlace del proyecto se pega una vez y queda en /config/claude_proyecto_url.
 * Mantener apretado (o clic derecho) el botón para cambiar el enlace.
 * Lo carga auth-guard.js solo en páginas del hub con sesión iniciada.
 */
(function () {
    if (window.__rubikClaudeFlotante) return;
    window.__rubikClaudeFlotante = true;

    var RUTA = 'config/claude_proyecto_url';
    var LOCAL = 'rubik_claude_proyecto_url';
    var url = null;

    function leerLocal() { try { return localStorage.getItem(LOCAL); } catch (e) { return null; } }
    function guardarLocal(v) { try { localStorage.setItem(LOCAL, v); } catch (e) {} }
    function db() { try { return window.firebase && firebase.database ? firebase.database() : null; } catch (e) { return null; } }

    url = leerLocal();
    var d = db();
    if (d) d.ref(RUTA).once('value').then(function (s) { if (s.val()) { url = s.val(); guardarLocal(url); } }).catch(function () {});

    function esCelular() {
        return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || window.innerWidth < 768;
    }

    function pedirEnlace() {
        var v = prompt(
            'Pegá el enlace de tu proyecto "RUBIK AGENTE APP" de Claude.\n' +
            '(En claude.ai abrí el proyecto y copiá la dirección: https://claude.ai/project/…)',
            url || 'https://claude.ai/project/'
        );
        if (v === null) return null;
        v = v.trim();
        if (!/^https:\/\/claude\.ai\//.test(v)) { alert('El enlace tiene que empezar con https://claude.ai/'); return null; }
        url = v; guardarLocal(v);
        var d2 = db(); if (d2) d2.ref(RUTA).set(v).catch(function () {});
        return v;
    }

    function abrir() {
        var destino = url || pedirEnlace();
        if (!destino) return;
        if (esCelular()) {
            window.open(destino, '_blank');   // Android/iOS abre la app de Claude si está instalada
            return;
        }
        var w = 440, h = Math.min(820, (screen.availHeight || 900) - 80);
        var left = (screen.availLeft || 0) + (screen.availWidth || 1400) - w - 20;
        var win = window.open(destino, 'rubik_claude', 'popup=yes,width=' + w + ',height=' + h + ',left=' + left + ',top=40');
        if (!win) window.open(destino, '_blank');   // si el navegador bloquea la ventana chica
        else try { win.focus(); } catch (e) {}
    }

    function crear() {
        if (document.getElementById('rubik-claude-fab')) return;
        var b = document.createElement('button');
        b.id = 'rubik-claude-fab';
        b.type = 'button';
        b.title = 'Rubik Agente App (Claude) · mantener apretado para cambiar el enlace';
        b.setAttribute('aria-label', 'Abrir Rubik Agente App en Claude');
        b.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="#fff" d="M12 2l1.6 6.2L20 6l-4.4 4.6L22 12l-6.4 1.4L20 18l-6.4-2.2L12 22l-1.6-6.2L4 18l4.4-4.6L2 12l6.4-1.4L4 6l6.4 2.2z"/></svg>';
        // Simétrico al botón de configuración del inicio (bottom/right 20px, 45×45): acá bottom/left 20px.
        b.style.cssText = 'position:fixed;left:20px;bottom:20px;z-index:900;' +
            'width:45px;height:45px;border-radius:50%;border:none;cursor:pointer;background:#d97757;' +
            'box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;padding:0;';
        // Si la página tiene una barra fija abajo (barra de acciones del celular en Presupuesto), subir por encima
        function ubicar() {
            var barra = document.getElementById('mobile-action-bar');
            var alto = (barra && getComputedStyle(barra).display !== 'none') ? barra.offsetHeight : 0;
            b.style.bottom = (alto ? alto + 14 : 20) + 'px';
        }
        ubicar(); window.addEventListener('resize', ubicar); setTimeout(ubicar, 1500);

        var timer = null, largo = false;
        b.addEventListener('pointerdown', function () { largo = false; timer = setTimeout(function () { largo = true; pedirEnlace(); }, 700); });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { b.addEventListener(ev, function () { clearTimeout(timer); }); });
        b.addEventListener('click', function (e) { if (largo) { e.preventDefault(); return; } abrir(); });
        b.addEventListener('contextmenu', function (e) { e.preventDefault(); pedirEnlace(); });
        document.body.appendChild(b);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', crear); else crear();
})();
