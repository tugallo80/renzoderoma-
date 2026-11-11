/**
 * importar-3d.js — Botón "Importar 3D" de presupuesto.html.
 *
 * El dueño elige el .glb / .gltf / .fbx que le mandó el cliente (o el rubik.json del exportador
 * de Blender), la app lo lee EN EL NAVEGADOR con three.js y arma el desglose con lector-3d.js.
 * El archivo no se sube a ningún lado: solo se guardan los ítems que se confirman.
 *
 * Depende de globals de presupuesto.html: db, firebase, data, dbMats, saveDB, render.
 * three.js se carga recién al usar el botón, desde el import map de presupuesto.html (versión fija).
 */
(function () {
    'use strict';

    var CDN_THREE = 'https://cdn.jsdelivr.net/npm/three@0.170.0/';
    var NUEVO = '__nuevo__';
    var MB_AVISO = 30;   // más que esto suele ser por texturas incrustadas
    var est = null;   // estado de la importación en curso
    var three = null;

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function mm(m) { return Math.round(m * 1000); }
    function catalogo() { return (typeof dbMats !== 'undefined' && dbMats) || {}; }
    function nombreMat(clave) { var m = catalogo()[clave]; return m ? (m.n || m.desc || clave) : null; }

    // ------------------------------------------------------------------ modal
    function crearModal() {
        if ($('mod-imp3d')) return;
        var css = document.createElement('style');
        css.textContent = [
            '#mod-imp3d{position:fixed;inset:0;z-index:9800;background:rgba(0,0,0,.55);display:none;}',
            '#mod-imp3d .i3-box{background:var(--bg);color:var(--text);max-width:720px;margin:0 auto;height:100%;display:flex;flex-direction:column;}',
            '@media(min-width:760px){#mod-imp3d .i3-box{height:auto;max-height:calc(100% - 40px);margin-top:20px;border-radius:14px;overflow:hidden;}}',
            '#mod-imp3d .i3-top{display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--card);border-bottom:1px solid var(--border);}',
            '#mod-imp3d .i3-top b{flex:1;font-size:16px;}',
            '#mod-imp3d .i3-x{background:none;border:none;font-size:26px;line-height:1;color:var(--gray);cursor:pointer;padding:0 4px;}',
            '#mod-imp3d .i3-body{flex:1;overflow-y:auto;padding:12px 16px 20px;-webkit-overflow-scrolling:touch;}',
            '#mod-imp3d .i3-foot{display:flex;gap:8px;padding:10px 16px;padding-bottom:max(10px,env(safe-area-inset-bottom));background:var(--card);border-top:1px solid var(--border);}',
            '#mod-imp3d .i3-btn{border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:10px;padding:11px 14px;font-weight:700;font-size:14px;cursor:pointer;}',
            '#mod-imp3d .i3-btn.prim{background:var(--blue);border-color:var(--blue);color:#fff;flex:1;}',
            '#mod-imp3d .i3-btn:disabled{opacity:.5;}',
            '#mod-imp3d .i3-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:10px;}',
            '#mod-imp3d .i3-nota{font-size:12px;color:var(--gray);line-height:1.4;}',
            '#mod-imp3d .i3-drop{display:block;border:2px dashed var(--border);border-radius:14px;padding:28px 16px;text-align:center;cursor:pointer;background:var(--card);}',
            '#mod-imp3d .i3-drop i{font-size:40px;color:var(--blue);}',
            '#mod-imp3d .i3-seg{display:inline-flex;border:1px solid var(--border);border-radius:9px;overflow:hidden;}',
            '#mod-imp3d .i3-seg button{border:none;background:var(--card);color:var(--text);padding:7px 14px;font-weight:700;cursor:pointer;}',
            '#mod-imp3d .i3-seg button.on{background:var(--blue);color:#fff;}',
            '#mod-imp3d .i3-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}',
            '#mod-imp3d .i3-chip{font-size:12px;font-weight:700;border-radius:20px;padding:4px 10px;background:var(--bg);border:1px solid var(--border);}',
            '#mod-imp3d .i3-chip.rojo{color:var(--red);border-color:var(--red);}',
            '#mod-imp3d .i3-sv{border-left:4px solid var(--red);padding:8px 0 8px 10px;margin-top:8px;}',
            '#mod-imp3d .i3-sv b{color:var(--red);}',
            '#mod-imp3d .i3-row2{display:flex;gap:6px;margin-top:6px;}',
            '#mod-imp3d input.i3-inp,#mod-imp3d select.i3-inp{flex:1;min-width:0;border:1px solid var(--border);border-radius:8px;padding:9px 10px;font-size:15px;background:var(--bg);color:var(--text);}',
            '#mod-imp3d .i3-ih{display:flex;align-items:center;gap:8px;}',
            '#mod-imp3d .i3-ih input[type=text]{flex:1;min-width:0;font-weight:800;font-size:15px;border:none;border-bottom:1px solid var(--border);background:transparent;color:var(--text);padding:6px 2px;}',
            '#mod-imp3d input[type=checkbox]{width:20px;height:20px;flex-shrink:0;accent-color:var(--blue);}',
            '#mod-imp3d .i3-pz{display:flex;gap:8px;padding:10px 0;border-top:1px solid var(--border);}',
            '#mod-imp3d .i3-pz.off{opacity:.45;}',
            '#mod-imp3d .i3-pz .i3-pm{flex:1;min-width:0;}',
            '#mod-imp3d .i3-pn{font-weight:700;font-size:14px;word-break:break-word;}',
            '#mod-imp3d .i3-med{font-size:13px;font-variant-numeric:tabular-nums;margin-top:2px;}',
            '#mod-imp3d .i3-mat{font-size:12px;margin-top:3px;}',
            '#mod-imp3d .i3-mat.ok{color:var(--green);}',
            '#mod-imp3d .i3-mat.mal{color:var(--red);font-weight:700;}',
            '#mod-imp3d .i3-mv{margin-top:6px;font-size:12px;padding:5px 6px;border-radius:7px;border:1px solid var(--border);background:var(--bg);color:var(--text);max-width:100%;}',
            '#mod-imp3d .i3-tag{font-size:10px;font-weight:800;color:var(--orange);margin-left:4px;}'
        ].join('\n');
        document.head.appendChild(css);
        var div = document.createElement('div');
        div.id = 'mod-imp3d';
        div.innerHTML = '<div class="i3-box"><div class="i3-top"><i class="ph-bold ph-cube" style="color:var(--blue);font-size:22px;"></i>' +
            '<b id="i3-titulo">Importar 3D</b><button class="i3-x" onclick="cerrarImportar3D()" aria-label="Cerrar">&times;</button></div>' +
            '<div class="i3-body" id="i3-body"></div><div class="i3-foot" id="i3-foot"></div></div>' +
            '<datalist id="i3-dl-mats"></datalist>';
        document.body.appendChild(div);
    }

    window.abrirImportar3D = function () {
        crearModal();
        est = null;
        $('mod-imp3d').style.display = 'block';
        pasoElegir();
        cargarBase();
    };
    window.cerrarImportar3D = function () {
        if (est && est.filas && !confirm('¿Salir sin agregar los ítems?')) return;
        $('mod-imp3d').style.display = 'none';
        est = null;   // se suelta el modelo de la memoria
    };

    function pasoElegir(error) {
        $('i3-titulo').textContent = 'Importar 3D';
        $('i3-body').innerHTML =
            (error ? '<div class="i3-card" style="border-color:var(--red);color:var(--red);font-weight:700;">' + esc(error) + '</div>' : '') +
            '<label class="i3-drop"><i class="ph-bold ph-upload-simple"></i><div style="font-weight:800;font-size:16px;margin-top:6px;">Elegir el modelo 3D</div>' +
            '<div class="i3-nota">.glb, .gltf, .fbx o un .zip que los tenga — y si lo tenés, el rubik.json de Blender</div>' +
            '<input type="file" id="i3-file" multiple accept=".glb,.gltf,.fbx,.zip,.json,.bin,.skp" style="display:none" onchange="_i3Archivos(this.files)"></label>' +
            '<div class="i3-card" style="margin-top:12px;"><div class="i3-nota"><b>🔒 El archivo no se sube a ningún lado.</b> Se lee en este dispositivo; ' +
            'solo se guardan los ítems que confirmes. Si es un .gltf con su .bin aparte, elegí los dos juntos.</div>' +
            '<div class="i3-nota" style="margin-top:6px;">Consejo: exportá <b>sin texturas</b> (en SketchUp/Vectorworks, "Embed media" desactivado). ' +
            'Las medidas y los nombres de materiales llegan igual y el archivo pesa mucho menos.</div></div>' +
            '<div class="i3-nota">La app arma ítem → piezas → medidas → material. Antes de guardar podés renombrar o juntar ítems, ' +
            'descartar piezas (personas, plantas, entorno) y vincular los materiales que falten.</div>';
        $('i3-foot').innerHTML = '<button class="i3-btn" style="flex:1" onclick="cerrarImportar3D()">Cancelar</button>';
    }

    function pasoCargando(texto) {
        $('i3-body').innerHTML = '<div style="text-align:center;padding:60px 10px;"><i class="ph-bold ph-spinner" style="font-size:36px;color:var(--blue);animation:spin 1s linear infinite;display:inline-block;"></i>' +
            '<div style="margin-top:10px;font-weight:700;">' + esc(texto) + '</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style></div>';
        $('i3-foot').innerHTML = '';
        return new Promise(function (r) { setTimeout(r, 30); });   // deja pintar antes del trabajo pesado
    }

    // ------------------------------------------------------- base de datos
    var basePromesa = null;
    function cargarBase() {
        basePromesa = Promise.all([
            db.ref('base_datos/equivalencias_vw').once('value').then(function (s) { return s.val() || {}; }),
            Object.keys(catalogo()).length ? Promise.resolve(null) :
                db.ref('base_datos/materiales').once('value').then(function (s) { if (typeof dbMats !== 'undefined') dbMats = s.val() || {}; })
        ]).then(function (r) {
            var dl = $('i3-dl-mats'), html = '';
            Object.keys(catalogo()).forEach(function (k) { var m = catalogo()[k]; html += '<option value="' + esc(m.n || m.desc || k) + '">'; });
            dl.innerHTML = html;
            return r[0];
        }).catch(function (e) { console.warn('[importar3d] base', e); return {}; });
        return basePromesa;
    }

    function claveDesdeTexto(txt) {
        var t = String(txt || '').trim().toUpperCase(), cat = catalogo();
        if (!t) return null;
        if (cat[txt]) return txt;
        for (var k in cat) { var m = cat[k]; if (String(m.n || m.desc || '').trim().toUpperCase() === t || k.toUpperCase() === t) return k; }
        return null;
    }

    // ------------------------------------------------------- lectura
    function cargarThree() {
        if (three) return Promise.resolve(three);
        return Promise.all([
            import('three'),
            import('three/addons/loaders/GLTFLoader.js'),
            import('three/addons/loaders/FBXLoader.js'),
            import('three/addons/loaders/DRACOLoader.js')
        ]).then(function (m) {
            three = { THREE: m[0], GLTFLoader: m[1].GLTFLoader, FBXLoader: m[2].FBXLoader, DRACOLoader: m[3].DRACOLoader };
            return three;
        });
    }

    window._i3Archivos = async function (lista) {
        var archivos = Array.from(lista || []);
        if (!archivos.length) return;
        var ext = function (f) { return (f.name.split('.').pop() || '').toLowerCase(); };
        if (archivos.some(function (f) { return ext(f) === 'skp'; })) {
            return pasoElegir('El .skp de SketchUp no se puede leer directo. En SketchUp: Archivo → Exportar → Modelo 3D → FBX o glTF (mejor sin texturas), y elegí ese archivo.');
        }
        // .zip: se sacan solo el modelo, su .bin y el rubik.json (las imágenes ni se descomprimen)
        var zips = archivos.filter(function (f) { return ext(f) === 'zip'; });
        if (zips.length) {
            if (typeof JSZip === 'undefined') return pasoElegir('No se pudo abrir el .zip (falta JSZip). Descomprimilo y elegí el archivo de adentro.');
            try {
                await pasoCargando('Abriendo ' + zips[0].name + '…');
                for (var z = 0; z < zips.length; z++) {
                    var zip = await JSZip.loadAsync(zips[z]);
                    var entradas = Object.keys(zip.files).filter(function (n) {
                        return !zip.files[n].dir && n.indexOf('__MACOSX') < 0 && /\.(glb|gltf|fbx|bin|json)$/i.test(n);
                    });
                    for (var e = 0; e < entradas.length; e++) {
                        var blob = await zip.files[entradas[e]].async('blob');
                        archivos.push(new File([blob], entradas[e].split('/').pop()));
                    }
                }
            } catch (err) { return pasoElegir('No se pudo abrir el .zip: ' + (err && err.message ? err.message : err)); }
            archivos = archivos.filter(function (f) { return ext(f) !== 'zip'; });
        }
        var modelo = archivos.find(function (f) { return ['glb', 'gltf', 'fbx'].indexOf(ext(f)) >= 0; });
        var json = archivos.find(function (f) { return ext(f) === 'json'; });
        if (!modelo && !json) return pasoElegir('No encontré un modelo 3D. Elegí un .glb, .gltf, .fbx, un .zip que lo tenga, o el rubik.json.');
        var pesado = modelo && modelo.size > MB_AVISO * 1024 * 1024 ? Math.round(modelo.size / 1048576) : 0;
        var consejo = 'Pesa ' + pesado + ' MB, seguramente por texturas incrustadas. Se lee igual (sin cargar las texturas), pero puede tardar ' +
            'o quedarse sin memoria en el celular. La próxima vez exportalo sin texturas ("Embed media" / "Incrustar texturas" desactivado).';
        var urls = [];
        try {
            await pasoCargando('Leyendo ' + (json || modelo).name + '…');
            var eqNodo = await (basePromesa || cargarBase());
            est = { archivo: (json || modelo).name, eqNodo: eqNodo, avisos: [] };
            if (pesado && !json) est.avisos.push('⚠ ' + consejo);

            if (json) {
                var datos = JSON.parse(await json.text());
                est.res = Lector3D.desdeRubikJson(datos, eqNodo);
                est.modo = 'rubik';
                if (modelo) est.avisos.push('Se usó ' + json.name + ' (trae los datos de Blender); ' + modelo.name + ' no hizo falta.');
            } else {
                await pasoCargando('Cargando el lector 3D…');
                var T = await cargarThree();
                await pasoCargando('Leyendo ' + modelo.name + '…' + (pesado ? ' (' + pesado + ' MB: puede tardar)' : ''));
                if (pesado) $('i3-body').insertAdjacentHTML('beforeend', '<div class="i3-card" style="border-color:var(--orange);"><div class="i3-nota">⚠ ' + esc(consejo) + '</div></div>');
                var mapa = {}, faltan = [];
                archivos.forEach(function (f) { if (f !== modelo && /\.(bin|gltf)$/i.test(f.name)) { var u = URL.createObjectURL(f); urls.push(u); mapa[f.name] = u; } });
                var manager = new T.THREE.LoadingManager();
                manager.setURLModifier(Lector3D.modificadorURL(mapa, faltan));   // sin texturas ni pedidos afuera
                var buf = await modelo.arrayBuffer();
                if (ext(modelo) === 'fbx') {
                    est.raiz = new T.FBXLoader(manager).parse(buf, '');
                    Lector3D.aplicarPropiedadesFBX(est.raiz, Lector3D.leerPropiedadesFBX(buf));
                    est.tipo = 'fbx';
                } else {
                    var loader = new T.GLTFLoader(manager);
                    loader.register(Lector3D.pluginSinTexturas(T.THREE));
                    var draco = new T.DRACOLoader(); draco.setDecoderPath(CDN_THREE + 'examples/jsm/libs/draco/gltf/');
                    loader.setDRACOLoader(draco);
                    var entrada = ext(modelo) === 'gltf' ? new TextDecoder().decode(buf) : buf;
                    var gltf = await new Promise(function (ok, ko) { loader.parse(entrada, '', ok, ko); }).catch(function (e) {
                        if (faltan.length) throw new Error('Falta el archivo ' + faltan[0] + '. Elegí el .gltf junto con su .bin (o exportá en .glb).');
                        throw e;
                    });
                    draco.dispose();
                    Lector3D.prepararGLTF(gltf);
                    est.raiz = gltf.scene;
                    est.tipo = 'gltf';
                }
                est.det = Lector3D.detectarUnidad(est.raiz, est.tipo);
                est.unidad = est.det.unidad;
                est.factor = Lector3D.FACTORES[est.unidad];   // m por unidad del archivo (cambia al calibrar)
                est.calibrado = null;
                est.modo = '3d';
                await pasoCargando('Midiendo piezas…');
                analizar();
            }
            prepararFilas();
            renderRevision();
        } catch (e) {
            console.error('[importar3d]', e);
            est = null;
            pasoElegir('No se pudo leer el archivo: ' + (e && e.message ? e.message : e));
        } finally {
            urls.forEach(function (u) { URL.revokeObjectURL(u); });
        }
    };

    function analizar() {
        est.res = Lector3D.analizar(est.raiz, {
            factor: est.factor, equivalencias: est.eqNodo,
            archivo: est.archivo, proyecto: est.archivo.replace(/\.[^.]+$/, '')
        });
    }

    function prepararFilas() {
        est.filas = est.res.piezas.map(function (p, i) {
            var descartar = Lector3D.sugerirDescarte(p.pieza) || Lector3D.sugerirDescarte(p.item);
            return Object.assign({}, p, { _i: i, incluir: !descartar, _sugerido: descartar });
        });
        est.items = [];
        est.filas.forEach(function (f) { if (est.items.indexOf(f.item) < 0) est.items.push(f.item); });
        // Archivo "plano" (todo sin grupos): el ítem toma el nombre del archivo, ej. "trofeo"
        var sinItem = [Lector3D.SIN_ITEM, 'Sin ítem'];
        if (est.items.length === 1 && sinItem.indexOf(est.items[0]) >= 0) {
            var nombre = est.archivo.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || est.items[0];
            est.filas.forEach(function (f) { f.item = nombre; });
            est.items = [nombre];
        }
    }

    // Vuelve a medir con otra escala sin perder lo que ya se revisó (ítems, descartes, vínculos)
    async function remedir(texto) {
        var viejas = est.filas, viejosItems = est.items;
        await pasoCargando(texto);
        analizar(); prepararFilas();
        if (viejas && viejas.length === est.filas.length) {
            est.filas.forEach(function (f, i) {
                var v = viejas[i];
                f.incluir = v.incluir; f.item = v.item;
                if (!f.material && v.material) { f.material = v.material; f.revisar = v.revisar; }
            });
            est.items = viejosItems.filter(function (n) { return est.filas.some(function (f) { return f.item === n; }); });
        }
        renderRevision();
    }

    window._i3Unidad = function (u) {
        if (!est || est.modo !== '3d' || (u === est.unidad && !est.calibrado)) return;
        est.unidad = u; est.factor = Lector3D.FACTORES[u]; est.calibrado = null;
        remedir('Midiendo en ' + u + '…');
    };

    // Modelos que no están a escala real: "esta pieza mide X mm" y se escala todo parejo
    window._i3Calibrar = function (i) {
        var f = est.filas[i];
        var txt = prompt('¿Cuánto mide de LARGO "' + f.pieza + '" en la realidad (en mm)?\nEn el modelo mide ' + mm(f.largo) +
            ' mm. Todo el modelo se escala igual.', '');
        if (txt == null) return;
        var real = parseFloat(String(txt).replace(',', '.'));
        if (!(real > 0) || !(f.largo > 0)) { alert('Escribí una medida en mm, por ejemplo 800.'); return; }
        est.factor = est.factor * (real / 1000) / f.largo;
        est.calibrado = { pieza: f.pieza, mm: real };
        remedir('Escalando el modelo…');
    };

    // ------------------------------------------------------- revisión
    function faltantes() {
        // nombres de VW sin vincular entre las piezas incluidas (material principal o acabado)
        var mapa = new Map();
        est.filas.forEach(function (f) {
            if (!f.incluir) return;
            if (!f.material) {
                var k = f.origen_vw || '';
                mapa.set(k, (mapa.get(k) || 0) + f.cant);
            }
            (f.acabados || []).forEach(function (a) { if (!a.material && a.origen_vw) mapa.set(a.origen_vw, (mapa.get(a.origen_vw) || 0) + f.cant); });
        });
        return Array.from(mapa.entries());
    }

    function renderRevision() {
        var incl = est.filas.filter(function (f) { return f.incluir; });
        var totalPiezas = incl.reduce(function (s, f) { return s + f.cant; }, 0);
        var itemsIncl = est.items.filter(function (n) { return incl.some(function (f) { return f.item === n; }); });
        var falta = faltantes();
        $('i3-titulo').textContent = 'Revisar antes de guardar';

        var h = '<div class="i3-card"><div style="font-weight:800;word-break:break-all;">' + esc(est.archivo) + '</div>' +
            '<div class="i3-nota">🔒 Leído en este dispositivo. El archivo no se sube.</div>';
        if (est.modo === '3d') {
            var t = est.det.tamano.map(function (x) { return (x * est.factor).toFixed(2); });
            h += '<div style="margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><span style="font-size:13px;font-weight:700;">Unidad del archivo</span><span class="i3-seg">' +
                ['mm', 'cm', 'm'].map(function (u) { return '<button class="' + (u === est.unidad && !est.calibrado ? 'on' : '') + '" onclick="_i3Unidad(\'' + u + '\')">' + u + '</button>'; }).join('') +
                '</span></div>' +
                (est.calibrado
                    ? '<div class="i3-nota" style="margin-top:6px;color:var(--green);font-weight:700;">📏 Calibrado: "' + esc(est.calibrado.pieza) + '" = ' + est.calibrado.mm + ' mm. Todo el modelo se escaló igual. Tocá mm, cm o m para volver.</div>'
                    : '<div class="i3-nota" style="margin-top:4px;">Detectado: ' + esc(est.det.unidad) + ' (' + esc(est.det.motivo) + ').</div>') +
                '<div class="i3-nota" style="margin-top:4px;">Todo el modelo mide <b>' + t.join(' × ') + ' m</b>. ' +
                (est.calibrado ? '' : '¿No coincide con el plano? Tocá <b>📏</b> en una pieza cuya medida conozcas y escribí su largo real: se escala todo parejo.') + '</div>';
        } else {
            h += '<div class="i3-nota" style="margin-top:6px;">rubik.json de Blender (medidas en metros). ' + esc(est.res.resumen || '') + '</div>';
        }
        est.avisos.forEach(function (a) { h += '<div class="i3-nota" style="margin-top:4px;">' + esc(a) + '</div>'; });
        h += '<div class="i3-chips"><span class="i3-chip">' + totalPiezas + (totalPiezas === 1 ? ' pieza' : ' piezas') + '</span><span class="i3-chip">' + itemsIncl.length + (itemsIncl.length === 1 ? ' ítem' : ' ítems') + '</span>' +
            (falta.length ? '<span class="i3-chip rojo">' + falta.length + ' sin vincular</span>' : '<span class="i3-chip" style="color:var(--green)">materiales vinculados</span>') +
            '</div></div>';

        if (falta.length) {
            h += '<div class="i3-card"><div style="font-weight:800;">Materiales sin vincular</div>' +
                '<div class="i3-nota">Elegí el material de la base. Queda guardado para la próxima importación.</div>';
            falta.forEach(function (par, i) {
                var nombre = par[0];
                h += '<div class="i3-sv"><b>' + (nombre ? esc(nombre) : '(pieza sin material)') + '</b> <span class="i3-nota">· ' + par[1] + ' pieza' + (par[1] > 1 ? 's' : '') +
                    (nombre ? '' : ' — se aplica solo a este archivo') + '</span>' +
                    '<div class="i3-row2"><input class="i3-inp" id="i3-v-' + i + '" list="i3-dl-mats" placeholder="Buscar en materiales…" autocomplete="off">' +
                    '<button class="i3-btn" onclick="_i3Vincular(' + i + ')">Vincular</button></div></div>';
            });
            h += '</div>';
            est._falta = falta;
        }

        est.items.forEach(function (nombre, ii) {
            var filas = est.filas.filter(function (f) { return f.item === nombre; });
            if (!filas.length) return;
            var todas = filas.every(function (f) { return f.incluir; }), alguna = filas.some(function (f) { return f.incluir; });
            h += '<div class="i3-card"><div class="i3-ih"><input type="checkbox" ' + (todas ? 'checked' : '') + ' onchange="_i3ItemIncl(' + ii + ',this.checked)" title="Incluir el ítem">' +
                '<input type="text" value="' + esc(nombre) + '" onchange="_i3Renombrar(' + ii + ',this.value)" aria-label="Nombre del ítem"></div>' +
                '<div class="i3-nota" style="margin:2px 0 4px 28px;">' + (function (n) { return n + (n === 1 ? ' pieza' : ' piezas'); })(filas.reduce(function (s, f) { return s + f.cant; }, 0)) +
                (alguna ? '' : ' · descartado') + ' · tocá el nombre para renombrar; con el mismo nombre que otro, se juntan</div>';
            filas.forEach(function (f) {
                var matTxt, matCls;
                if (f.material) { matTxt = (nombreMat(f.material) || f.material + ' (no está en la base)'); matCls = nombreMat(f.material) ? 'ok' : 'mal'; }
                else { matTxt = (f.origen_vw ? f.origen_vw : 'sin material') + ' — sin vincular'; matCls = 'mal'; }
                var acab = (f.acabados || []).map(function (a) {
                    var n = a.material ? (nombreMat(a.material) || a.material) : (a.origen_vw + ' (sin vincular)');
                    return esc(n) + ' ' + a.area_m2 + ' m²';
                }).join(' · ');
                h += '<div class="i3-pz' + (f.incluir ? '' : ' off') + '"><input type="checkbox" ' + (f.incluir ? 'checked' : '') + ' onchange="_i3Incl(' + f._i + ',this.checked)">' +
                    '<div class="i3-pm"><div class="i3-pn">' + esc(f.pieza) + ' <span style="color:var(--blue)">× ' + f.cant + '</span>' +
                    (f._sugerido ? '<span class="i3-tag">¿entorno?</span>' : '') + '</div>' +
                    '<div class="i3-med">' + mm(f.largo) + ' × ' + mm(f.ancho) + ' × ' + mm(f.espesor) + ' mm · ' + (f.tipo === 'plancha' ? 'plancha' : 'volumen') + '</div>' +
                    '<div class="i3-mat ' + matCls + '">' + esc(matTxt) + '</div>' +
                    (acab ? '<div class="i3-nota">Acabados: ' + acab + '</div>' : '') +
                    (f.motivos || []).filter(function (m) { return /partes sueltas|revisar la unidad/.test(m); }).map(function (m) {
                        return '<div class="i3-nota" style="color:var(--orange);font-weight:700;">⚠ ' + esc(m) + '</div>';
                    }).join('') +
                    (est.modo === '3d' ? '<button class="i3-mv" style="margin-right:6px;" onclick="_i3Calibrar(' + f._i + ')" title="Calibrar la escala con la medida real de esta pieza">📏 Mide…</button>' : '') +
                    '<select class="i3-mv" onchange="_i3Mover(' + f._i + ',this.value)"><option value="">Mover a otro ítem…</option>' +
                    est.items.filter(function (n) { return n !== nombre; }).map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('') +
                    '<option value="' + NUEVO + '">➕ Ítem nuevo…</option></select></div></div>';
            });
            h += '</div>';
        });
        if (!est.filas.length) h += '<div class="i3-card">El archivo no tiene piezas para medir (mallas).</div>';

        var hayCaps = (typeof data !== 'undefined') && data.some(function (it) { return it && it.type === 'chapter'; });
        h += '<label class="i3-card" style="display:flex;gap:10px;align-items:center;"><input type="checkbox" id="i3-cap" ' + (hayCaps ? 'checked' : '') + '>' +
            '<span style="font-size:13px;">Ponerlos en un capítulo nuevo <span class="i3-nota">(al final; no mueve nada de lo que ya está)</span></span></label>';
        $('i3-body').innerHTML = h;
        $('i3-foot').innerHTML = '<button class="i3-btn" onclick="cerrarImportar3D()">Cancelar</button>' +
            '<button class="i3-btn prim" ' + (itemsIncl.length ? '' : 'disabled') + ' onclick="_i3Confirmar()">Agregar ' + itemsIncl.length + ' ítem' + (itemsIncl.length === 1 ? '' : 's') + ' al final</button>';
    }

    function conScroll(fn) {   // re-render sin perder la posición
        var b = $('i3-body'), y = b.scrollTop; fn(); renderRevision(); $('i3-body').scrollTop = y;
    }
    window._i3Incl = function (i, v) { conScroll(function () { est.filas[i].incluir = v; }); };
    window._i3ItemIncl = function (ii, v) { conScroll(function () { est.filas.forEach(function (f) { if (f.item === est.items[ii]) f.incluir = v; }); }); };
    window._i3Renombrar = function (ii, nuevo) {
        var viejo = est.items[ii]; nuevo = String(nuevo || '').trim();
        if (!nuevo || nuevo === viejo) return conScroll(function () {});
        conScroll(function () {
            est.filas.forEach(function (f) { if (f.item === viejo) f.item = nuevo; });
            if (est.items.indexOf(nuevo) >= 0) est.items.splice(ii, 1); else est.items[ii] = nuevo;
        });
    };
    window._i3Mover = function (i, destino) {
        if (!destino) return;
        if (destino === NUEVO) {
            destino = (prompt('Nombre del ítem nuevo:') || '').trim();
            if (!destino) return conScroll(function () {});
        }
        conScroll(function () {
            est.filas[i].item = destino;
            if (est.items.indexOf(destino) < 0) est.items.push(destino);
        });
    };

    window._i3Vincular = async function (i) {
        var par = est._falta[i], origen = par[0];
        var clave = claveDesdeTexto($('i3-v-' + i).value);
        if (!clave) { alert('Elegí un material de la lista (de /base_datos/materiales).'); return; }
        if (origen) {
            var fila = est.filas.find(function (f) { return f.origen_vw === origen; });
            var reg = {
                vw: origen, material: clave,
                tipo: fila && fila.fuente && fila.fuente.origen_vw === 'clase' ? 'clase' : 'material',
                actualizado: firebase.database.ServerValue.TIMESTAMP,
                por: (firebase.auth().currentUser || {}).uid || null
            };
            try { await db.ref('base_datos/equivalencias_vw/' + Lector3D.claveEquivalencia(origen)).set(reg); }
            catch (e) { alert('No se pudo guardar la equivalencia: ' + e.message); return; }
            est.eqNodo[Lector3D.claveEquivalencia(origen)] = { vw: origen, material: clave };
            var eq = Lector3D.cargarEquivalencias(est.eqNodo);
            conScroll(function () { est.filas.forEach(function (f) { Lector3D.resolverMateriales(f, eq); }); });
        } else {
            conScroll(function () {
                est.filas.forEach(function (f) {
                    if (f.incluir && !f.material && !f.origen_vw) {
                        f.material = clave;
                        f.revisar = (f.acabados || []).some(function (a) { return !a.material; });
                    }
                });
            });
        }
    };

    window._i3Confirmar = function () {
        var filas = est.filas.filter(function (f) { return f.incluir; });
        if (!filas.length) return;
        var falta = faltantes().length;
        if (falta && !confirm(falta + ' material' + (falta > 1 ? 'es quedan' : ' queda') + ' sin vincular: van a quedar marcados en rojo en el APU, sin precio. ¿Agregar igual?')) return;
        var nombres = est.items.filter(function (n) { return filas.some(function (f) { return f.item === n; }); });
        var nuevos = Lector3D.armarItems(filas, nombres, catalogo(), function () { return db.ref().push().key; }, {
            archivo: est.archivo, fecha: Date.now(),
            unidad: est.modo !== '3d' ? 'm' : (est.calibrado ? 'calibrado: "' + est.calibrado.pieza + '" = ' + est.calibrado.mm + ' mm (×' + (est.factor / Lector3D.FACTORES[est.unidad]).toFixed(4) + ' ' + est.unidad + ')' : est.unidad)
        });
        if ($('i3-cap') && $('i3-cap').checked) {
            data.push({ type: 'chapter', name: ('3D · ' + est.archivo.replace(/\.[^.]+$/, '')).toUpperCase(), collapsed: false });
        }
        // Siempre al final: las licitaciones apuntan a los ítems por posición (ver ficha 03)
        nuevos.forEach(function (it) { data.push(it); });
        saveDB(true);
        render();
        var marcadas = nuevos.reduce(function (s, it) { return s + it.apu.mat.filter(function (r) { return r.revisar; }).length; }, 0);
        $('mod-imp3d').style.display = 'none';
        est = null;
        setTimeout(function () {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            alert('✅ ' + nuevos.length + ' ítem' + (nuevos.length > 1 ? 's' : '') + ' agregado' + (nuevos.length > 1 ? 's' : '') + ' al final.\n' +
                (marcadas ? marcadas + ' fila' + (marcadas > 1 ? 's' : '') + ' del APU en rojo: falta precio, rendimiento o vincular.\n' : '') +
                'La mano de obra se carga a mano en el APU, como siempre.');
        }, 150);
    };
})();
