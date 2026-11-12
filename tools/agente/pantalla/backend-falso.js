// Backend falso de /api/agente y /api/tts para las capturas (no llama a ninguna API real).
(function () {
    var F = window._fbFalso, n = 0;
    var R = function () { return 'proyectos/' + window.cid + '/' + window.pid + '/agente'; };
    window._pedidosAgente = [];
    var fetchReal = window.fetch;
    function resp(o, st) { return Promise.resolve(new Response(JSON.stringify(o), { status: st || 200, headers: { 'Content-Type': 'application/json' } })); }
    function agregar(r, v) { var k = '-B' + String(++n).padStart(6, '0'); F.set(r + '/' + k, v); return k; }
    window.fetch = function (url, op) {
        if (url === '/api/tts') return resp({ error: 'sin audio en la prueba' }, 500);
        if (url !== '/api/agente') return fetchReal.apply(this, arguments);
        var b = JSON.parse(op.body); window._pedidosAgente.push(b);
        if (b.accion === 'adjuntar') {
            var id = '-A' + String(++n).padStart(6, '0');
            F.set(R() + '/adjuntos/' + id, { nombre: b.nombre, tipo: b.tipo, anotaciones: b.anotaciones || null });
            return resp({ ok: true, id: id });
        }
        if (b.accion === 'enviar') {
            var adj = (b.adjuntos || []).map(function (id) { var m = F.get(R() + '/adjuntos/' + id); return { id: id, nombre: m.nombre, tipo: m.tipo }; });
            agregar(R() + '/conversacion/mensajes', { rol: 'dueno', texto: b.texto, adjuntos: adj.length ? adj : null, fecha: Date.now() });
            F.set(R() + '/estado', { fase: 'trabajando', texto: 'Midiendo el 3D…', actualizado: Date.now() });
            (window._guionAgente || []).forEach(function (paso, i) {
                setTimeout(function () { paso(F, R(), agregar); }, 300 * (i + 1));
            });
            return resp({ ok: true });
        }
        return resp({ ok: true });
    };
})();
