/**
 * paste-image.js — Rubik OS
 * Habilita pegar imágenes con Ctrl+V en todas las zonas de upload de la app.
 *
 * Uso: incluir este script en cualquier página que tenga inputs type="file" de imagen.
 * El script detecta automáticamente todos los file inputs con accept="image/*"
 * y sus contenedores clickeables (upload-box, drop-zone, etc.).
 *
 * También expone: window.attachPasteToInput(fileInputId) para casos manuales.
 */

(function() {
    'use strict';

    // Inyectar indicador visual de "pegar" en los contenedores de upload
    const PASTE_HINT_HTML = `<span class="paste-hint" style="
        display:inline-block; margin-top:4px; font-size:11px;
        color:var(--text-muted, #888); opacity:0.7; pointer-events:none;
    ">o pega con Ctrl+V</span>`;

    function injectHint(container) {
        if (!container || container.querySelector('.paste-hint')) return;
        container.insertAdjacentHTML('beforeend', PASTE_HINT_HTML);
    }

    // Convierte un File/Blob en un FileList simulado y lo asigna al input
    function assignFileToInput(input, file) {
        if (!input) return false;
        try {
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        } catch(e) {
            console.warn('paste-image: no se pudo asignar archivo al input', e);
            return false;
        }
    }

    // Obtiene imagen del clipboard event
    function getImageFromClipboard(e) {
        const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
        if (!items) return null;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                return item.getAsFile();
            }
        }
        return null;
    }

    // Mapa: inputId → handler registrado (para evitar duplicados)
    const registered = new WeakSet();

    /**
     * Vincula un file input para recibir imágenes pegadas con Ctrl+V.
     * Busca el contenedor padre más cercano con clase upload-box/drop-zone/etc.
     * y le añade el hint visual.
     */
    window.attachPasteToInput = function(inputOrId) {
        const input = typeof inputOrId === 'string'
            ? document.getElementById(inputOrId)
            : inputOrId;
        if (!input || registered.has(input)) return;
        registered.add(input);

        // Buscar contenedor padre visual
        const container = input.closest(
            '.logo-upload-box, .cover-upload-box, .upload-card, ' +
            '[ondrop], [ondragover], ' +
            '.drop-zone, .upload-zone, .foto-zone, ' +
            '[style*="dashed"]'
        );
        if (container) injectHint(container);
    };

    // ── Listener global de paste ────────────────────────────────────────────────
    // Orden de prioridad al pegar:
    // 1. Si hay un input de archivo "activo" (el usuario hizo foco en su contenedor)
    // 2. Si el cursor está dentro de un contenedor de upload
    // 3. Primer file input de imagen visible en el modal/formulario activo

    let activeUploadInput = null; // el último input que recibió hover/focus

    function setActive(inputId) {
        const el = typeof inputId === 'string' ? document.getElementById(inputId) : inputId;
        if (el) activeUploadInput = el;
    }

    // Marcar como activo cuando el mouse entra al contenedor
    function bindContainerHover(container, input) {
        container.addEventListener('mouseenter', () => setActive(input), { passive: true });
        container.addEventListener('focusin',    () => setActive(input), { passive: true });
    }

    document.addEventListener('paste', function(e) {
        // No interferir si el usuario está pegando texto en un input/textarea
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' && document.activeElement.type !== 'file') return;
        if (tag === 'TEXTAREA') return;

        const file = getImageFromClipboard(e);
        if (!file) return;

        // Prioridad 1: input activo por hover
        if (activeUploadInput && assignFileToInput(activeUploadInput, file)) {
            e.preventDefault();
            flashFeedback(activeUploadInput);
            return;
        }

        // Prioridad 2: buscar el modal/dialog abierto y su primer file input de imagen
        const openModal = document.querySelector(
            '.modal-overlay[style*="flex"], .modal[style*="flex"], ' +
            '.modal-overlay[style*="block"], .modal[style*="block"], ' +
            '[class*="modal"]:not([style*="none"]):not([style*="display: none"])'
        );
        const scope = openModal || document;
        const inputs = scope.querySelectorAll('input[type="file"][accept*="image"]');
        for (const inp of inputs) {
            // Preferir inputs visibles o con contenedor visible
            const parent = inp.parentElement;
            if (parent && parent.offsetParent !== null) {
                if (assignFileToInput(inp, file)) {
                    e.preventDefault();
                    flashFeedback(inp);
                    return;
                }
            }
        }

        // Prioridad 3: cualquier file input de imagen en la página
        const anyInput = document.querySelector('input[type="file"][accept*="image"]');
        if (anyInput && assignFileToInput(anyInput, file)) {
            e.preventDefault();
            flashFeedback(anyInput);
        }
    }, false);

    // Feedback visual breve en el contenedor al pegar
    function flashFeedback(input) {
        const container = input.closest(
            '.logo-upload-box, .cover-upload-box, .upload-card, ' +
            '[ondrop], [ondragover], [style*="dashed"]'
        ) || input.parentElement;
        if (!container) return;
        const prev = container.style.outline;
        container.style.outline = '2px solid var(--green, #34c759)';
        container.style.transition = 'outline 0.3s';
        setTimeout(() => { container.style.outline = prev || ''; }, 1000);
    }

    // ── Auto-setup al cargar el DOM ──────────────────────────────────────────────
    function setup() {
        document.querySelectorAll('input[type="file"][accept*="image"]').forEach(input => {
            window.attachPasteToInput(input);
            const container = input.closest(
                '.logo-upload-box, .cover-upload-box, .upload-card, ' +
                '[ondrop], [style*="dashed"]'
            ) || input.parentElement;
            if (container) bindContainerHover(container, input);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setup);
    } else {
        setup();
    }

    // Re-ejecutar setup si se abren modales dinámicamente (MutationObserver)
    const observer = new MutationObserver(() => setup());
    observer.observe(document.body, { childList: true, subtree: true });

})();
