/**
 * vistas-3d.js — Vistas de un modelo 3D (isométrica y frente) con el número de cada pieza (p1, p2… = orden de rubik/1),
 * dibujadas en el navegador con three.js. Sirven para que Claude relacione el 3D con fotos, renders y planos.
 * Copia de la función del chat del Agente IA (js/agente-chat.js), que no se tocó (sesión 6): cuando se pueda,
 * el agente puede pasar a usar este módulo.
 * Uso: Vistas3D.render(raiz, medicion) → Promise<[{nombre, datos(base64 JPEG), miniatura(dataURL|null)}]>
 * Necesita window.Importar3D (js/importar-3d.js) para cargar three.js.
 */
(function (global) {
    'use strict';
    function aBase64(blob) {
        return new Promise(function (ok, ko) {
            var fr = new FileReader();
            fr.onload = function () { ok(String(fr.result).split(',')[1] || ''); };
            fr.onerror = function () { ko(new Error('No se pudo leer la vista.')); };
            fr.readAsDataURL(blob);
        });
    }

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

    global.Vistas3D = { render: renderVistas };
})(window);
