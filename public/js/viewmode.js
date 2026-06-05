/**
 * Rubik OS — View Mode (PC/Móvil)
 * Lee localStorage.rubik_view_mode y aplica body[data-view="..."].
 * Valores: "web", "mobile", "auto" (default).
 */
(function () {
    function apply() {
        try {
            const v = localStorage.getItem('rubik_view_mode');
            const mode = (v === 'web' || v === 'mobile') ? v : 'auto';
            if (document.body) {
                document.body.setAttribute('data-view', mode);
            }
        } catch (_) {}
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', apply);
    } else {
        apply();
    }
    // Permite cambiar el modo en runtime desde cualquier parte
    window.rubikSetView = function (mode) {
        if (['web', 'mobile', 'auto'].indexOf(mode) === -1) mode = 'auto';
        localStorage.setItem('rubik_view_mode', mode);
        if (document.body) document.body.setAttribute('data-view', mode);
    };
})();
