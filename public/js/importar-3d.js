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
    // Lo que el dueño va cargando (arranca en blanco): se guarda con fecha_mod y deja un historial simple
    // en /base_datos/historial_cambios {ruta, cambios: {campo: {antes, despues}}, que, fecha, por} para ver cómo evoluciona.
    async function guardarAprendido(ruta, cambios, que) {
        var ref = db.ref(ruta), antes = null;
        try { antes = (await ref.once('value')).val(); } catch (e) { antes = null; }
        var nuevo = Object.assign({}, cambios, { fecha_mod: firebase.database.ServerValue.TIMESTAMP });
        await ref.update(nuevo);
        var resumen = {};
        Object.keys(cambios).forEach(function (k) { resumen[k] = { antes: antes && antes[k] !== undefined ? antes[k] : null, despues: cambios[k] === undefined ? null : cambios[k] }; });
        Promise.resolve(db.ref('base_datos/historial_cambios').push({ ruta: ruta, que: que || '', cambios: JSON.parse(JSON.stringify(resumen)),
            fecha: firebase.database.ServerValue.TIMESTAMP, por: (firebase.auth().currentUser || {}).uid || null }))
            .catch(function (e) { console.warn('[importar3d] historial', e); });
        return nuevo;
    }

    function catalogoMO() { return (typeof dbMo !== 'undefined' && dbMo) || {}; }
    // Ruta B (trato): oficios con su costo por jornal, rendimientos por oficio/indicador, y la ruta preferida por tipo de ítem
    var oficiosBD = {}, rendimientosBD = {}, prefsMO = {};
    function bs(x) { return (Math.round((parseFloat(x) || 0) * 100) / 100).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

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
            '#mod-imp3d .i3-tag{font-size:10px;font-weight:800;color:var(--orange);margin-left:4px;}',
            '#mod-imp3d .i3-ia{font-size:10px;font-weight:800;color:var(--purple);border:1px solid var(--purple);border-radius:6px;padding:1px 5px;white-space:nowrap;}',
            '#mod-imp3d .i3-prop{display:flex;gap:8px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--border);}',
            '#mod-imp3d .i3-prop .i3-pm{flex:1;min-width:0;font-size:13px;}',
            '#mod-imp3d .i3-prop .i3-btn{padding:7px 10px;font-size:12px;flex-shrink:0;}',
            '#mod-imp3d .i3-cita{font-size:11px;color:var(--gray);font-style:italic;margin-top:2px;}'
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
    window.$_i3IrIA = function () {
        $('mod-imp3d').style.display = 'none'; est = null;
        window.abrirModalIABudget();
    };

    // Recargos del APU: no hay una configuración global; se toman del último ítem del presupuesto que los tenga
    // (el dueño los edita en cada APU) y si no, los valores por defecto de ApuUtils.normalizeApu (apu-utils.js).
    function recargosDelPresupuesto() {
        var d = (window.ApuUtils && ApuUtils.normalizeApu({ mat: [], mo: [] }, {})) || {};
        var lista = (typeof data !== 'undefined' && Array.isArray(data)) ? data : [];
        for (var i = lista.length - 1; i >= 0; i--) {
            var a = lista[i] && lista[i].type !== 'chapter' && lista[i].apu;
            if (a && a.util != null && a.ind != null && ((a.mat && a.mat.length) || (a.mo && a.mo.length))) {
                return { cs: a.cs != null ? parseFloat(a.cs) || 0 : d.cs, ind: parseFloat(a.ind) || 0, util: parseFloat(a.util) || 0,
                    desde: 'el último ítem del presupuesto con APU ("' + String(lista[i].desc || '').slice(0, 40) + '")' };
            }
        }
        return { cs: d.cs, ind: d.ind, util: d.util, desde: 'los valores por defecto del APU (apu-utils.js)' };
    }

    window.cerrarImportar3D = function () {
        if (est && est.filas && !confirm('¿Salir sin agregar los ítems?')) return;
        $('mod-imp3d').style.display = 'none';
        est = null;   // se suelta el modelo de la memoria
    };

    function pasoElegir(error, irIA) {
        $('i3-titulo').textContent = 'Importar 3D';
        $('i3-body').innerHTML =
            (error ? '<div class="i3-card" style="border-color:var(--red);color:var(--red);font-weight:700;">' + esc(error) +
                (irIA && typeof window.abrirModalIABudget === 'function' ? '<div><button class="i3-btn prim" style="margin-top:10px;" onclick="$_i3IrIA()">Abrir Presupuesto IA</button></div>' : '') + '</div>' : '') +
            '<label class="i3-drop"><i class="ph-bold ph-upload-simple"></i><div style="font-weight:800;font-size:16px;margin-top:6px;">Elegir el modelo 3D</div>' +
            '<div class="i3-nota">.glb, .gltf, .fbx o un .zip que los tenga — y si lo tenés, el rubik.json de Blender</div>' +
            '<div class="i3-nota" style="margin-top:4px;"><b>Si tenés el PDF, el plano o una foto/render, elegilo junto con el 3D</b>: la IA lee de qué material es cada pieza y la medida total (escala). ' +
            'Las medidas y cantidades las calcula la app con la geometría. Para cotizar sin 3D, usá "Presupuesto IA".</div>' +
            '<div class="i3-nota" style="margin-top:4px;">📱 <b>En el celular:</b> desde Drive o WhatsApp tocá <b>Compartir → Rubik</b> (con el hub instalado como app). No hace falta descargarlo.</div>' +
            '<input type="file" id="i3-file" multiple accept=".glb,.gltf,.fbx,.zip,.json,.bin,.skp,.pdf,.jpg,.jpeg,.png,.webp,application/octet-stream,model/gltf-binary,model/gltf+json,application/zip,application/pdf,application/json,image/jpeg,image/png,image/webp" style="display:none" onchange="_i3Archivos(this.files)"></label>' +
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
                db.ref('base_datos/materiales').once('value').then(function (s) { if (typeof dbMats !== 'undefined') dbMats = s.val() || {}; }),
            Object.keys(catalogoMO()).length ? Promise.resolve(null) :
                db.ref('base_datos/mano_obra').once('value').then(function (s) { if (typeof dbMo !== 'undefined') dbMo = s.val() || {}; }),
            db.ref('base_datos/oficios').once('value').then(function (s) { oficiosBD = s.val() || {}; }),
            db.ref('base_datos/rendimientos').once('value').then(function (s) { rendimientosBD = s.val() || {}; }),
            db.ref('base_datos/preferencias_mo').once('value').then(function (s) { prefsMO = s.val() || {}; })
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

    // Cada archivo con el nombre que corresponde a su contenido (Drive/WhatsApp en Android mandan
    // archivos sin extensión, con otro nombre o con type vacío / application/octet-stream).
    async function normalizarArchivos(archivos) {
        var salida = [], raros = [];
        for (var i = 0; i < archivos.length; i++) {
            var f = archivos[i], tipo = null;
            try { tipo = Lector3D.detectarTipo(f.name, f.type, new Uint8Array(await f.slice(0, 4096).arrayBuffer())); } catch (e) { tipo = null; }
            if (tipo === 'json' && !/"formato"\s*:\s*"rubik\//.test((await f.slice(0, 4096).text()))) {
                // JSON sin pistas al principio: se mira entero (glTF tiene "asset", rubik.json tiene "formato")
                try { var j = JSON.parse(await f.text()); if (j && j.asset) tipo = 'gltf'; else if (!(j && j.formato)) tipo = null; } catch (e) { tipo = null; }
            }
            if (!tipo) { raros.push(f); continue; }
            var nombre = Lector3D.nombreConTipo(f.name, tipo);
            salida.push(nombre === f.name ? f : new File([f], nombre, { type: f.type || '' }));
        }
        return { archivos: salida, raros: raros };
    }

    function describir(f) {
        return '"' + (f.name || '(sin nombre)') + '" · tipo: ' + (f.type || '(vacío)') + ' · ' +
            (f.size >= 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : f.size >= 1024 ? Math.round(f.size / 1024) + ' KB' : f.size + ' bytes');
    }

    window._i3Archivos = async function (lista) {
        var originales = Array.from(lista || []);
        if (!originales.length) return;
        await pasoCargando('Revisando ' + (originales[0].name || 'el archivo') + '…');
        var norm = await normalizarArchivos(originales);
        var archivos = norm.archivos;
        if (!archivos.length) {
            return pasoElegir('No reconozco este archivo como modelo 3D, PDF o .zip. Recibí: ' + norm.raros.map(describir).join(' / ') +
                '. Si es un FBX, probá exportarlo de nuevo o mandarlo dentro de un .zip.');
        }
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
                        var base = n.split('/').pop();
                        return !zip.files[n].dir && n.indexOf('__MACOSX') < 0 && base.charAt(0) !== '.' &&
                            (/\.(glb|gltf|fbx|bin|json|pdf)$/i.test(n) || base.indexOf('.') < 0);   // también sin extensión
                    });
                    var sacados = [];
                    for (var e = 0; e < entradas.length; e++) {
                        var blob = await zip.files[entradas[e]].async('blob');
                        sacados.push(new File([blob], entradas[e].split('/').pop()));
                    }
                    archivos = archivos.concat((await normalizarArchivos(sacados)).archivos);
                }
            } catch (err) { return pasoElegir('No se pudo abrir el .zip: ' + (err && err.message ? err.message : err)); }
            archivos = archivos.filter(function (f) { return ext(f) !== 'zip'; });
        }
        var modelo = archivos.find(function (f) { return ['glb', 'gltf', 'fbx'].indexOf(ext(f)) >= 0; });
        // Documento para leer materiales: PDF, plano o foto/render (opcional, junto con el 3D)
        var pdfJunto = archivos.find(function (f) { return ext(f) === 'pdf'; }) ||
            archivos.find(function (f) { return ['jpg', 'jpeg', 'png', 'webp'].indexOf(ext(f)) >= 0; });
        var json = archivos.find(function (f) { return ext(f) === 'json'; });
        if (!modelo && !json && pdfJunto) {
            return pasoElegir('"Importar 3D" necesita el modelo 3D: el cómputo lo hace la app con la geometría. ' +
                'Para cotizar solo con un PDF o una foto usá "Presupuesto IA".', true);
        }
        if (!modelo && !json) {
            return pasoElegir('No encontré un modelo 3D. Elegí un .glb, .gltf, .fbx, un .zip que lo tenga, o el rubik.json. Recibí: ' +
                originales.map(describir).join(' / ') + '.');
        }
        var pesado = modelo && modelo.size > MB_AVISO * 1024 * 1024 ? Math.round(modelo.size / 1048576) : 0;
        var consejo = 'Pesa ' + pesado + ' MB, seguramente por texturas incrustadas. Se lee igual (sin cargar las texturas), pero puede tardar ' +
            'o quedarse sin memoria en el celular. La próxima vez exportalo sin texturas ("Embed media" / "Incrustar texturas" desactivado).';
        var urls = [];
        try {
            await pasoCargando('Leyendo ' + (json || modelo).name + '…');
            var eqNodo = await (basePromesa || cargarBase());
            est = { archivo: (json || modelo).name, eqNodo: eqNodo, avisos: [], desp: {}, recargos: recargosDelPresupuesto(), recetaPend: [] };
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
            pedirRecetas();   // materiales ya vinculados que todavía no tienen receta de mano de obra
            if (pdfJunto) window._i3PDF(pdfJunto);   // si eligió el PDF junto con el 3D, se lee enseguida
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
                ['material_desde', 'material_confianza'].forEach(function (k) { if (v[k]) f[k] = v[k]; });
            });
            est.items = viejosItems.filter(function (n) { return est.filas.some(function (f) { return f.item === n; }); });
        }
        renderRevision();
    }

    window._i3Unidad = function (u) {
        if (!est || est.modo !== '3d' || (u === est.unidad && !est.calibrado)) return;
        est.unidad = u;
        cambiarEscala(Lector3D.FACTORES[u], null, 'Midiendo en ' + u + '…');
    };

    function tamanoM() { return est.det.tamano.map(function (x) { return x * est.factor; }); }
    function fmtTam(m) {
        var mx = Math.max.apply(null, m), u, f, d;
        if (mx >= 1) { u = 'm'; f = 1; d = 2; } else if (mx >= 0.01) { u = 'cm'; f = 100; d = mx >= 0.1 ? 0 : 1; } else { u = 'mm'; f = 1000; d = 1; }
        return m.map(function (x) { return (x * f).toFixed(d); }).join(' × ') + ' ' + u;
    }
    function opcionesEscala() {
        var base = Lector3D.FACTORES[est.unidad];
        return [
            { etiqueta: 'Como vino (' + est.unidad + ')', factor: base },
            { etiqueta: '÷ 10', factor: base / 10 },
            { etiqueta: '÷ 100', factor: base / 100 },
            { etiqueta: '÷ 1000', factor: base / 1000 },
            { etiqueta: 'Pulgadas (× 25,4 mm)', factor: 0.0254 }
        ];
    }
    function textoCalibrado() {
        var c = est.calibrado;
        if (c.tipo === 'rapida') return 'Escala: ' + c.pieza + '.';
        return 'Calibrado: ' + c.pieza + ' = ' + c.mm + ' mm.';
    }
    function cambiarEscala(factor, calibrado, texto) {
        est.factor = factor; est.calibrado = calibrado;
        if (est.pdf) { est.pdf.auto = null; if (est.pdf.aplicadas) delete est.pdf.aplicadas['escala||']; }
        remedir(texto || 'Escalando el modelo…');
    }
    window._i3Escala = function (i) {
        var o = opcionesEscala()[i];
        cambiarEscala(o.factor, i === 0 ? null : { tipo: 'rapida', pieza: o.etiqueta }, 'Escalando ' + o.etiqueta + '…');
    };
    window._i3MedidaTotal = function () {
        var eje = +$('i3-dim').value, real = parseFloat(String($('i3-dim-mm').value).replace(',', '.'));
        var nombre = ['ancho total', 'alto total', 'fondo total'][eje];
        if (!(real > 0) || !(est.det.tamano[eje] > 0)) { alert('Escribí la medida real en mm, por ejemplo 800.'); return; }
        cambiarEscala((real / 1000) / est.det.tamano[eje], { pieza: nombre, mm: real });
    };
    window._i3DeshacerPDF = function () {
        var d = est.pdf && est.pdf.deshacer;
        if (!d) return;
        est.factor = d.factor; est.calibrado = d.calibrado;
        est.pdf.auto = null; est.pdf.deshacer = null; delete est.pdf.aplicadas['escala||'];
        remedir('Volviendo a la escala anterior…');
    };

    // Modelos que no están a escala real: "esta pieza mide X mm" y se escala todo parejo
    window._i3Calibrar = function (i) {
        var f = est.filas[i];
        var txt = prompt('¿Cuánto mide de LARGO "' + f.pieza + '" en la realidad (en mm)?\nEn el modelo mide ' + mm(f.largo) +
            ' mm.\nSe ajustan TODAS las piezas del archivo.', '');
        if (txt == null) return;
        var real = parseFloat(String(txt).replace(',', '.'));
        if (!(real > 0) || !(f.largo > 0)) { alert('Escribí una medida en mm, por ejemplo 800.'); return; }
        cambiarEscala(est.factor * (real / 1000) / f.largo, { pieza: '"' + f.pieza + '"', mm: real });
    };

    // ------------------------------------------------------- PDF del cliente (opcional)
    // El PDF no se guarda en ningún lado. Su texto (y las páginas sin texto, como imagen) se mandan a la IA
    // por /api/gemini (mismo proxy con token del hub que "Presupuesto IA"). La IA solo PROPONE: escala,
    // material y cantidades; cada propuesta se aplica a mano y queda marcada "según PDF (IA)".
    function tarjetaPDF() {
        var h = '<div class="i3-card" id="i3-pdf" style="border:2px solid var(--purple);"><div style="font-weight:800;">📄 Paso 2 · ¿Tenés el PDF, el plano o una foto/render?</div>';
        var entrada = '<input type="file" accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" style="display:none" onchange="_i3PDF(this.files[0])">';
        if (!est.pdf) {
            return h + '<div class="i3-nota" style="margin:4px 0 8px;">La IA <b>solo lee de qué material es cada pieza</b> (con su cita) y la <b>medida total</b> del plano para calibrar la escala. ' +
                'Medidas, cantidades, áreas y planchas las calcula la app con la geometría del 3D.</div>' +
                '<label class="i3-btn prim" style="display:inline-block;">Subir PDF o foto' + entrada + '</label>' +
                '<div class="i3-nota" style="margin-top:8px;">🔒 No se guarda. Pero, a diferencia del 3D, <b>su contenido se envía a la IA</b> (Gemini, por el servidor de Rubik) para leerlo.</div></div>';
        }
        if (est.pdf.estado === 'leyendo') return h + '<div class="i3-nota" style="margin-top:6px;">⏳ ' + esc(est.pdf.paso || 'Leyendo…') + '</div></div>';
        if (est.pdf.estado === 'error') {
            return h + '<div class="i3-nota" style="color:var(--red);font-weight:700;margin-top:6px;">' + esc(est.pdf.error) + '</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;"><button class="i3-btn prim" onclick="_i3PDF()">Reintentar</button>' +
                '<label class="i3-btn" style="display:inline-block;">Otro PDF o foto' + entrada + '</label></div>' +
                (est.pdf.crudo ? '<details style="margin-top:8px;"><summary class="i3-nota">Detalle técnico</summary><pre style="white-space:pre-wrap;word-break:break-all;font-size:11px;' +
                    'background:var(--bg);padding:8px;border-radius:8px;margin:6px 0 0;">' + esc(est.pdf.crudo) + '</pre></details>' : '') + '</div>';
        }
        var props = propuestasActuales();
        h += '<div class="i3-nota" style="margin:4px 0;">' + esc(est.pdf.nombre) + ' · ' + est.pdf.paginas + ' pág. · leído por la IA. ' +
            (est.pdf.auto ? 'La escala ya se calibró (arriba, con Deshacer). ' : '') + 'Los materiales no se aplican solos: tocá <b>Aplicar</b> en lo que esté bien ' +
            '(los que no están en la base se pueden crear, sin precio).</div>' +
            (props.some(function (p) { return !est.pdf.aplicadas[claveProp(p)] && (p.confianza === 'alta' || p.confianza === 'media') && p.tipo === 'material' && p.clave; })
                ? '<button class="i3-btn prim" style="margin:4px 0;" onclick="_i3AplicarTodo()">Aplicar los materiales de confianza alta y media</button>' : '');
        if (!props.length) h += '<div class="i3-nota">La IA no encontró en el PDF nada para proponer.</div>';
        props.forEach(function (p, i) {
            var hecho = est.pdf.aplicadas[claveProp(p)];
            h += '<div class="i3-prop"><div class="i3-pm"><div><span class="i3-ia">' + esc(p.tipo) + ' · ' + esc(p.confianza) + '</span> ' + esc(p.texto) + '</div>' +
                (p.cita ? '<div class="i3-cita">“' + esc(p.cita) + '”' + (p.pagina ? ' (pág. ' + p.pagina + ')' : '') + '</div>' : '') + '</div>' +
                (hecho ? '<span style="color:var(--green);font-weight:800;font-size:12px;">✓ aplicado</span>'
                    : (p.aplicable === false ? '' : (p.tipo === 'material' && !p.clave
                        ? (p.crear ? '<button class="i3-btn" onclick="_i3AplicarProp(' + i + ')">＋ Crear material</button>' : '')
                        : '<button class="i3-btn" onclick="_i3AplicarProp(' + i + ')">Aplicar</button>'))) + '</div>';
        });
        if (est.pdf.info.notas) h += '<div class="i3-nota" style="margin-top:6px;">Notas de la IA: ' + esc(est.pdf.info.notas) + '</div>';
        if (est.pdf.info.incompleta) h += '<div class="i3-nota" style="margin-top:6px;color:var(--orange);">⚠ La respuesta de la IA vino cortada: puede faltar alguna pieza. Podés tocar Reintentar.</div>' +
            '<button class="i3-btn" style="margin-top:6px;" onclick="_i3PDF()">Reintentar</button>';
        return h + '</div>';
    }

    function tarjetaEscala() {
        var h = '';
            // Escala rápida: factores redondos, cada uno con cómo quedaría el modelo entero
            h += '<div class="i3-card"><div style="font-weight:800;">' + (est.pdf && est.pdf.auto ? 'Escala a mano' : 'Sin PDF: ¿el tamaño no tiene sentido?') + '</div>' +
                '<div class="i3-nota" style="margin-top:2px;">Elegí el que corresponda (los modelos suelen venir corridos por un factor redondo):</div><div class="i3-chips">' +
                opcionesEscala().map(function (o, i) {
                    var on = Math.abs(est.factor / o.factor - 1) < 1e-9;
                    return '<button class="i3-btn' + (on ? ' prim' : '') + '" style="flex:0 0 auto;padding:7px 10px;font-size:12px;text-align:left;" onclick="_i3Escala(' + i + ')">' +
                        '<b>' + esc(o.etiqueta) + '</b><br><span style="font-weight:400;">' + fmtTam(est.det.tamano.map(function (x) { return x * o.factor; })) + '</span></button>';
                }).join('') + '</div>';
            // Medida total conocida (alto, ancho o fondo): la que el dueño suele saber
            var tm = tamanoM();
            h += '<div style="margin-top:10px;font-size:13px;font-weight:700;">📏 ¿Sabés una medida total real?</div>' +
                '<div class="i3-row2"><select class="i3-inp" id="i3-dim" style="flex:1.3;">' +
                [['1', 'Alto'], ['0', 'Ancho'], ['2', 'Fondo']].map(function (d) {
                    return '<option value="' + d[0] + '">' + d[1] + ' (hoy ' + Math.round(tm[+d[0]] * 1000) + ' mm)</option>';
                }).join('') + '</select><input class="i3-inp" id="i3-dim-mm" type="number" inputmode="decimal" placeholder="mm reales">' +
                '<button class="i3-btn" onclick="_i3MedidaTotal()">Calibrar</button></div>' +
                '<div class="i3-nota" style="margin-top:4px;">También podés tocar <b>📏 Mide…</b> en una pieza. Calibrar una pieza o una medida total <b>ajusta todas las piezas del archivo</b>.</div></div>';
        return h;
    }

    function claveProp(p) { return [p.tipo, p.pieza || '', p.clave || p.cantidad || p.largo_mm || ''].join('|'); }
    function propuestasActuales() {
        if (!est.pdf || !est.pdf.info) return [];
        var tam = est.modo === '3d' ? est.det.tamano.map(function (x) { return x * est.factor; }) : null;
        return Lector3D.propuestasPDF(est.pdf.info, est.filas, tam, catalogo(), est.eqNodo).filter(function (p) {
            if (est.modo !== '3d' && p.tipo === 'escala') return false;   // rubik.json ya viene en metros
            if (p.tipo !== 'escala' && p.tipo !== 'material') return false;
            // la escala ya aplicada deja de proponerse (si no, se vuelve a ofrecer con factor ~1)
            return !(p.tipo === 'escala' && est.pdf.aplicadas['escala||']);
        });
    }

    async function imagenDeFoto(archivo) {
        var url = URL.createObjectURL(archivo);
        try {
            var img = await new Promise(function (ok, ko) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = function () { ko(new Error('No se pudo abrir la imagen.')); }; i.src = url; });
            var esc2 = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
            c.width = Math.round(img.width * esc2); c.height = Math.round(img.height * esc2);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            var b64 = c.toDataURL('image/jpeg', 0.75).split(',')[1];
            c.width = c.height = 0;
            return { texto: '', imagenes: [b64], paginas: 1 };
        } finally { URL.revokeObjectURL(url); }
    }

    async function textoEImagenesPDF(archivo) {
        if (/^image\//.test(archivo.type) || /\.(jpe?g|png|webp)$/i.test(archivo.name)) return imagenDeFoto(archivo);
        if (!window.pdfjsLib) throw new Error('No se pudo cargar el lector de PDF (pdf.js).');
        var doc = await window.pdfjsLib.getDocument({ data: await archivo.arrayBuffer() }).promise;
        var texto = '', imagenes = [], n = Math.min(doc.numPages, 30);
        for (var i = 1; i <= n; i++) {
            est.pdf.paso = 'Leyendo página ' + i + ' de ' + n + '…'; refrescarPDF();
            var pag = await doc.getPage(i);
            var tc = await pag.getTextContent();
            var t = tc.items.map(function (x) { return x.str; }).join(' ').replace(/\s+/g, ' ').trim();
            texto += '\n--- Página ' + i + ' ---\n' + t;
            // Planos escaneados o dibujos (poco texto): la página va como imagen, hasta 6
            if (t.length < 200 && imagenes.length < 6) {
                var vp = pag.getViewport({ scale: 1 }), escala = Math.min(2, 1400 / Math.max(vp.width, vp.height));
                var v2 = pag.getViewport({ scale: escala }), c = document.createElement('canvas');
                c.width = v2.width; c.height = v2.height;
                await pag.render({ canvasContext: c.getContext('2d'), viewport: v2 }).promise;
                imagenes.push(c.toDataURL('image/jpeg', 0.7).split(',')[1]);
                c.width = c.height = 0;
            }
        }
        doc.destroy && doc.destroy();
        return { texto: texto, imagenes: imagenes, paginas: doc.numPages };
    }

    function refrescarPDF() { var el = $('i3-pdf'); if (el) el.outerHTML = tarjetaPDF(); }

    async function pedirIA(pedido) {
        var usuario = firebase.auth().currentUser;
        var headers = { 'Content-Type': 'application/json' };
        if (usuario) headers['Authorization'] = 'Bearer ' + await usuario.getIdToken();
        var ctrl = new AbortController(), reloj = setTimeout(function () { ctrl.abort(); }, 120000);
        try {
            var resp = await fetch('/api/gemini', { method: 'POST', headers: headers, body: JSON.stringify(pedido), signal: ctrl.signal });
            if (!resp.ok) {
                var cuerpo = ''; try { cuerpo = (await resp.text()).slice(0, 300); } catch (e) { /* nada */ }
                var err = new Error('La IA respondió ' + resp.status + (resp.status === 401 || resp.status === 403 ? ' (sesión del hub vencida: recargá la página)' : ''));
                err.crudo = cuerpo; throw err;
            }
            return await resp.json();
        } finally { clearTimeout(reloj); }
    }

    window._i3PDF = async function (archivo) {
        if (!archivo) archivo = est && est.pdf && est.pdf.archivo;   // "Reintentar"
        if (!archivo || !est) return;
        est.pdf = { estado: 'leyendo', nombre: archivo.name, archivo: archivo, aplicadas: {}, paso: 'Abriendo ' + archivo.name + '…' };
        refrescarPDF();
        try {
            var c = await textoEImagenesPDF(archivo);
            est.pdf.paginas = c.paginas;
            var datos = {
                texto: c.texto, imagenes: c.imagenes, piezas: est.filas.filter(function (f) { return f.incluir; }),
                tamano_mm: est.modo === '3d' ? est.det.tamano.map(function (x) { return x * est.factor * 1000; }) : null,
                catalogo: catalogo()
            };
            est.pdf.paso = 'La IA está leyendo el PDF (puede tardar un minuto)…'; refrescarPDF();
            try {
                est.pdf.info = Lector3D.leerRespuestaPDF(await pedirIA(Lector3D.armarPedidoPDF(datos)));
            } catch (e1) {
                if (!e1.ia) throw e1;   // error de red o del servidor: no se reintenta solo
                // Respuesta ilegible o cortada: un reintento con esquema compacto y más espacio
                console.warn('[importar3d] respuesta de la IA ilegible, reintento compacto', e1.crudo);
                est.pdf.paso = 'La respuesta vino incompleta; pidiendo una versión más corta…'; refrescarPDF();
                est.pdf.info = Lector3D.leerRespuestaPDF(await pedirIA(Lector3D.armarPedidoPDF(datos, { compacto: true })));
            }
            est.pdf.estado = 'listo';
            // Textos de material del PDF que ya se vincularon antes: se aplican solos (la próxima vez no se pregunta)
            propuestasActuales().forEach(function (p) {
                if (p.tipo === 'material' && p.auto) aplicarMaterial(p, p.clave, true);
            });
            setTimeout(pedirRecetas, 0);
            // Medida total con confianza alta o media → la escala se calibra sola (con Deshacer). Lo demás, solo propuesto.
            var escala = est.modo === '3d' && propuestasActuales().find(function (p) { return p.tipo === 'escala'; });
            if (escala && (escala.confianza === 'alta' || escala.confianza === 'media')) {
                est.pdf.deshacer = { factor: est.factor, calibrado: est.calibrado };
                est.factor = est.factor * escala.factor;
                est.calibrado = { pieza: escala.dimension + ' según PDF (IA)', mm: escala.mm };
                est.pdf.auto = { dimension: escala.dimension, mm: escala.mm, pagina: escala.pagina, confianza: escala.confianza, cita: escala.cita };
                est.pdf.aplicadas['escala||'] = true;
                return remedir('Calibrando la escala según el PDF…');
            }
        } catch (e) {
            console.warn('[importar3d] pdf', e);
            est.pdf.estado = 'error';
            est.pdf.error = e && e.ia ? 'La IA no devolvió datos legibles.' :
                'No se pudo leer el PDF: ' + (e && e.name === 'AbortError' ? 'la IA tardó demasiado' : (e && e.message ? e.message : e));
            est.pdf.crudo = e && e.crudo ? e.crudo : '';
        }
        conScroll(function () {});
    };

    // Vincula el material a la pieza y recuerda "texto del PDF → material" en /base_datos/equivalencias_vw (tipo "pdf")
    function aplicarMaterial(p, clave, recordado) {
        est.filas.forEach(function (f) {
            if (f.pieza !== p.pieza) return;
            f.material = clave; f.material_desde = recordado ? 'equivalencia' : 'pdf_ia'; f.material_confianza = p.confianza;
            f.revisar = (f.acabados || []).some(function (a) { return !a.material; }) || (f.partes || 1) > 1 || !f.largo;
        });
        est.pdf.aplicadas[claveProp(p)] = true;
        if (!recordado && p.texto_pdf) {
            var k = Lector3D.claveEquivalencia(p.texto_pdf);
            est.eqNodo[k] = { vw: p.texto_pdf, material: clave };
            db.ref('base_datos/equivalencias_vw/' + k).set({
                vw: p.texto_pdf, material: clave, tipo: 'pdf', actualizado: firebase.database.ServerValue.TIMESTAMP,
                por: (firebase.auth().currentUser || {}).uid || null
            }).catch(function (e) { console.warn('[importar3d] equivalencia', e); });
        }
    }

    // Material que no está en la base: se crea con nombre, unidad y espesor sugeridos y SIN precio ("falta precio")
    async function crearMaterial(sug) {
        var nombre = prompt('Crear material en la base (sin precio: lo cargás después).\nNombre:', sug.n);
        if (nombre == null || !nombre.trim()) return null;
        var unidad = prompt('Unidad de compra (m2, ml, plancha, barra, und, kg, lt):', sug.u || 'und');
        if (unidad == null || !unidad.trim()) return null;
        var clave = Lector3D.claveBase(nombre);
        var reg = { desc: nombre.trim(), n: nombre.trim(), u: unidad.trim(), p: 0, falta_precio: true, origen: 'pdf_ia',
            creado: firebase.database.ServerValue.TIMESTAMP };
        if (sug.espesor_mm) reg.espesor_mm = sug.espesor_mm;
        await db.ref('base_datos/materiales/' + clave).set(reg);
        catalogo()[clave] = Object.assign({}, reg, { creado: Date.now() });
        return clave;
    }

    window._i3AplicarTodo = function () {
        var hechas = 0;
        conScroll(function () {
            propuestasActuales().forEach(function (p) {
                if (est.pdf.aplicadas[claveProp(p)] || !(p.confianza === 'alta' || p.confianza === 'media')) return;
                var fila = p.pieza ? est.filas.find(function (f) { return f.pieza === p.pieza; }) : null;
                if (!fila) return;
                if (p.tipo === 'material' && p.clave) { aplicarMaterial(p, p.clave); hechas++; }
            });
        });
        if (!hechas) alert('No hay materiales de confianza alta o media para aplicar (los materiales nuevos se crean de a uno).');
        pedirRecetas();
    };

    window._i3AplicarProp = async function (i) {
        var p = propuestasActuales()[i];
        if (!p) return;
        var k = claveProp(p);
        var fila = p.pieza ? est.filas.find(function (f) { return f.pieza === p.pieza; }) : null;
        if (p.tipo === 'escala') {
            est.factor = est.factor * p.factor;
            est.calibrado = { pieza: p.dimension + ' según PDF (IA)', mm: p.mm };
            k = 'escala||';
            est.pdf.aplicadas[k] = true;
            remedir('Escalando según el PDF…');
            return;
        }
        if (!fila) return;
        var claveNueva = null;
        if (p.tipo === 'material' && !p.clave) {
            if (!p.crear) return;
            try { claveNueva = await crearMaterial(p.crear); } catch (e) { alert('No se pudo crear el material: ' + e.message); return; }
            if (!claveNueva) return;
        }
        conScroll(function () {
            if (p.tipo === 'material') aplicarMaterial(p, p.clave || claveNueva);
            est.pdf.aplicadas[k] = true;
        });
        pedirRecetas();
    };

    // ------------------------------------------------------- APU por ítem (lo que ve el dueño ANTES de agregar)
    // Cómputo = algoritmo: cantidades desde la geometría; precios y unidades de la base; mano de obra por receta del material.
    function tarjetaApu(nombre, ps) {
        if (!ps.length) return '';
        var rt = rutaDe(nombre, ps);
        var apu = Lector3D.armarApu(ps, catalogo(), { desperdicios: est.desp, catalogoMO: catalogoMO(), recargos: est.recargos,
            ruta: rt.ruta, rendimiento: rt.rend, oficio: rt.oficio });
        var r = Lector3D.resumenApu(apu), rc = est.recargos;
        var sinReceta = rt.ruta === 'B' ? [] : Lector3D.materialesSinReceta(ps, catalogo());
        var h = '<div style="margin-top:10px;padding:10px;border-radius:10px;background:var(--bg);">' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;">' +
            '<b>APU estimado</b><span style="font-size:17px;font-weight:800;color:var(--green);">' + bs(r.pu) + ' Bs <span class="i3-nota">/ unidad</span></span></div>' +
            '<div class="i3-nota">Materiales ' + bs(r.materiales) + ' · Mano de obra ' + bs(r.mano_obra) + ' (+' + rc.cs + ' % cargas) · +' + rc.ind + ' % indirectos · +' + rc.util + ' % utilidad' +
            (r.sin_precio ? ' · <b style="color:var(--red);">' + r.sin_precio + ' fila' + (r.sin_precio > 1 ? 's' : '') + ' sin precio</b>' : '') +
            (sinReceta.length ? ' · <b style="color:var(--orange);">' + sinReceta.length + ' material' + (sinReceta.length > 1 ? 'es' : '') + ' sin receta de mano de obra</b>' : '') + '</div>' +
            '<details style="margin-top:6px;"><summary class="i3-nota" style="cursor:pointer;">Ver el detalle (' + r.filas + ' filas)</summary>';
        h += '<div style="font-size:12px;font-weight:800;margin-top:8px;">Materiales <span class="i3-nota">(cantidades de la geometría)</span></div>';
        apu.mat.forEach(function (x) {
            var cat = x.clave && catalogo()[x.clave];
            var tieneReceta = cat && (Lector3D.recetaDe(cat) || cat.mo_receta_ninguna);
            h += '<div style="font-size:12px;padding:5px 0;border-top:1px solid var(--border);"><div style="display:flex;justify-content:space-between;gap:6px;">' +
                '<span>' + esc(x.d) + (x.segun ? ' <span class="i3-ia">material según ' + esc(x.segun) + '</span>' : '') + '</span><b>' + (x.p > 0 ? bs(x.q * x.p) : '<span style="color:var(--red);">falta precio</span>') + '</b></div>' +
                '<div class="i3-nota">' + x.q + ' ' + esc(x.u) + ' × ' + bs(x.p) + (x.nota ? ' · ' + esc(x.nota) : '') + '</div>' +
                (x.revisar ? '<div style="color:var(--red);font-size:11px;">⚠ ' + esc(x.revisar) + '</div>' : '') +
                (x.clave && x.desperdicio != null ? '<label class="i3-nota" style="display:flex;align-items:center;gap:6px;margin-top:3px;">Desperdicio ' +
                    '<input type="number" inputmode="decimal" min="0" max="100" step="1" value="' + x.desperdicio + '" style="width:60px;padding:4px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);" ' +
                    'onchange="_i3Desp(\'' + esc(x.clave) + '\',this.value)"> %</label>' : '') +
                (x.falta_plancha ? '<button class="i3-btn" style="padding:5px 9px;font-size:11px;margin-top:4px;margin-right:4px;" onclick="_i3TamPlancha(\'' + esc(x.clave) + '\')">Cargar el tamaño de la plancha</button>' : '') +
                (x.falta_barra ? '<button class="i3-btn" style="padding:5px 9px;font-size:11px;margin-top:4px;margin-right:4px;" onclick="_i3LargoBarra(\'' + esc(x.clave) + '\')">Cargar el largo de la barra</button>' : '') +
                (cat && !x.acabado && rutaDe(nombre).ruta !== 'B' ? '<button class="i3-btn" style="padding:5px 9px;font-size:11px;margin-top:4px;" onclick="_i3Receta(\'' + esc(x.clave) + '\')">' +
                    (tieneReceta ? '✎ Mano de obra de este material' : '＋ Armar la mano de obra de este material') + '</button>' : '') + '</div>';
        });
        h += '<div style="font-size:12px;font-weight:800;margin-top:8px;">Mano de obra <span class="i3-nota">(' +
            (rt.ruta === 'B' ? 'por trato: referencia para negociar' : 'receta de cada material × geometría') + ')</span></div>';
        if (!apu.mo.length) h += '<div class="i3-nota">' + (sinReceta.length ? 'Los materiales todavía no tienen receta: armala una vez y queda guardada.' : 'Sin mano de obra en las recetas.') + '</div>';
        apu.mo.forEach(function (x) {
            h += '<div style="font-size:12px;padding:5px 0;border-top:1px solid var(--border);"><div style="display:flex;justify-content:space-between;gap:6px;">' +
                '<span>' + esc(x.d) + (x.referencia ? ' <span class="i3-ia">referencia para negociar</span>' : '') + '</span><b>' + (x.p > 0 && x.q > 0 ? bs(x.q * x.p) : '<span style="color:var(--red);">' + (x.p > 0 ? 'falta cantidad' : 'falta precio') + '</span>') + '</b></div>' +
                '<div class="i3-nota">' + x.q + ' ' + esc(x.u) + ' × ' + bs(x.p) + ' · ' + esc(x.nota) + '</div>' +
                (x.revisar ? '<div style="color:var(--red);font-size:11px;">⚠ ' + esc(x.revisar) + '</div>' : '') + '</div>';
        });
        return h + '</details></div>';
    }

    // ---------- Ruta de mano de obra por ítem: A = por medida (receta del material) · B = por trato (oficio + rendimiento)
    function claveItem(nombre) { return Lector3D.claveEquivalencia(nombre); }
    function rutaDe(nombre, ps) {
        est.rutas = est.rutas || {};
        var r = est.rutas[nombre];
        if (!r) {
            var pref = prefsMO[claveItem(nombre)];
            ps = ps || est.filas.filter(function (f) { return f.item === nombre && f.incluir; });
            r = est.rutas[nombre] = pref ? { ruta: pref.ruta === 'B' ? 'B' : 'A', rendKey: pref.rendimiento || null, desde: 'preferencia' }
                : { ruta: Lector3D.rutaSugerida(ps), rendKey: null, desde: 'sugerida' };
        }
        r.rend = r.rendKey ? rendimientosBD[r.rendKey] || null : null;
        r.oficio = r.rend ? oficiosBD[r.rend.oficio] || null : null;
        return r;
    }
    function guardarPreferencia(nombre) {
        var r = est.rutas[nombre];
        prefsMO[claveItem(nombre)] = { ruta: r.ruta, rendimiento: r.rendKey || null };
        db.ref('base_datos/preferencias_mo/' + claveItem(nombre)).set({ item: nombre, ruta: r.ruta, rendimiento: r.rendKey || null,
            actualizado: firebase.database.ServerValue.TIMESTAMP }).catch(function (e) { console.warn('[importar3d] preferencia', e); });
    }
    function etiquetaRend(k) {
        var x = rendimientosBD[k] || {}, of = oficiosBD[x.oficio] || {}, ind = Lector3D.INDICADORES[x.indicador] || {};
        return (of.nombre || x.oficio || '?') + (x.trabajo ? ' · ' + x.trabajo : '') + ' — ' +
            (x.indicador === 'letras_por_alto' ? 'letras por tramos de alto' : (x.por_jornal || '?') + ' ' + (ind.unidad || '') + ' por jornal');
    }

    function tarjetaRuta(nombre, ps) {
        if (!ps.length) return '';
        var rt = rutaDe(nombre, ps), i = est.items.indexOf(nombre);
        var h = '<div style="margin-top:10px;"><div class="i3-nota" style="font-weight:700;color:var(--text);">Mano de obra de este ítem</div>' +
            '<div class="i3-seg" style="margin-top:4px;display:flex;">' +
            '<button class="' + (rt.ruta === 'A' ? 'on' : '') + '" style="flex:1;font-size:12px;" onclick="_i3Ruta(' + i + ',\'A\')">Por medida<br><span style="font-weight:400;">receta del material</span></button>' +
            '<button class="' + (rt.ruta === 'B' ? 'on' : '') + '" style="flex:1;font-size:12px;" onclick="_i3Ruta(' + i + ',\'B\')">Por trato<br><span style="font-weight:400;">oficio + rendimiento</span></button></div>' +
            '<div class="i3-nota" style="margin-top:3px;">' + (rt.desde === 'preferencia' ? 'Como la última vez para este tipo de ítem.' : rt.desde === 'sugerida' ?
                (rt.ruta === 'A' ? 'Sugerida: casi todo es plano (lona, vinilo, chapa).' : 'Sugerida: tiene volumen o muchas piezas (mueble, letra).') : '') + '</div>';
        if (rt.ruta === 'B') {
            var keys = Object.keys(rendimientosBD);
            h += '<div class="i3-row2"><select class="i3-inp" onchange="_i3Rend(' + i + ',this.value)"><option value="">' + (keys.length ? 'Elegí el rendimiento…' : 'Todavía no hay rendimientos cargados') + '</option>' +
                keys.map(function (k) { return '<option value="' + esc(k) + '"' + (k === rt.rendKey ? ' selected' : '') + '>' + esc(etiquetaRend(k)) + '</option>'; }).join('') +
                '</select><button class="i3-btn" onclick="_i3NuevoRend(' + i + ')">＋ Nuevo</button>' +
                (rt.rend ? '<button class="i3-btn" onclick="_i3EditarRend(' + i + ')" title="Corregir el rendimiento guardado">✎</button>' : '') + '</div>';
            if (rt.rend) {
                var c = Lector3D.jornalesTrato(ps, rt.rend), ind = Lector3D.INDICADORES[rt.rend.indicador] || {};
                h += '<div class="i3-nota" style="margin-top:4px;">Del 3D: <b>' + c.indicador + ' ' + esc(ind.unidad || '') + '</b> (' + esc(ind.nombre || '') + ')' +
                    (c.jornales != null ? ' → <b>' + c.jornales + ' jornales</b>' : '') + (rt.oficio && parseFloat(rt.oficio.costo_jornal) > 0 ? ' × ' + bs(rt.oficio.costo_jornal) + ' Bs/jornal' : '') + '</div>';
                if (rt.oficio && !(parseFloat(rt.oficio.costo_jornal) > 0)) {
                    h += '<button class="i3-btn" style="padding:5px 9px;font-size:11px;margin-top:4px;" onclick="_i3CostoOficio(\'' + esc(rt.rend.oficio) + '\')">Cargar el costo del jornal de ' + esc(rt.oficio.nombre) + '</button>';
                }
            }
        }
        return h + '</div>';
    }

    window._i3Ruta = function (i, ruta) { var n = est.items[i]; conScroll(function () { rutaDe(n).ruta = ruta; est.rutas[n].desde = 'elegida'; guardarPreferencia(n); }); pedirRecetas(); };
    window._i3Rend = function (i, k) { var n = est.items[i]; conScroll(function () { rutaDe(n).rendKey = k || null; guardarPreferencia(n); }); };
    window._i3CostoOficio = async function (k) {
        var of = oficiosBD[k] || {};
        var v = parseFloat(String(prompt('Costo de un jornal de ' + (of.nombre || k) + ' (Bs):', '') || '').replace(',', '.'));
        if (!(v > 0)) return;
        try { await guardarAprendido('base_datos/oficios/' + k, { costo_jornal: v }, 'costo del jornal'); of.costo_jornal = v; } catch (e) { alert('No se pudo guardar: ' + e.message); return; }
        conScroll(function () {});
    };

    // Rendimiento nuevo: se carga UNA vez y queda en /base_datos/rendimientos (y el oficio en /base_datos/oficios)
    window._i3EditarRend = function (i) {
        var nombre = est.items[i], rt = rutaDe(nombre), x = rt.rend;
        if (!x) return;
        var tramos = (Array.isArray(x.tramos) ? x.tramos : Object.keys(x.tramos || {}).map(function (k) { return x.tramos[k]; }))
            .map(function (t) { return { hasta_mm: t.hasta_mm || '', por_jornal: t.por_jornal || '' }; });
        while (tramos.length < 3) tramos.push({ hasta_mm: '', por_jornal: '' });
        est.nuevoRend = { item: i, clave: rt.rendKey, oficio: x.oficio, indicador: x.indicador, por_jornal: x.por_jornal || '',
            trabajo: x.trabajo || '', notas: x.notas || '', tramos: tramos };
        pintarNuevoRend();
    };

    window._i3NuevoRend = function (i) {
        var nombre = est.items[i];
        est.nuevoRend = { item: i, oficio: '', indicador: 'm2_tablero', por_jornal: '', trabajo: nombre, notas: '', tramos: [{ hasta_mm: '', por_jornal: '' }, { hasta_mm: '', por_jornal: '' }, { hasta_mm: '', por_jornal: '' }] };
        pintarNuevoRend();
    };
    function pintarNuevoRend() {
        var r = est.nuevoRend, ps = est.filas.filter(function (f) { return f.item === est.items[r.item] && f.incluir; });
        var ofs = Object.keys(oficiosBD).sort(function (a, b) { return String(oficiosBD[a].nombre).localeCompare(String(oficiosBD[b].nombre)); });
        var h = '<div style="font-weight:800;font-size:15px;">' + (r.clave ? 'Corregir el rendimiento' : 'Rendimiento para negociar el trato') + '</div>' +
            '<div class="i3-nota" style="margin:4px 0 8px;">Se carga <b>una vez</b>: cuánto produce el oficio en un jornal, medido con algo que la app saca del 3D. ' +
            'Jornales = indicador ÷ rendimiento; referencia = jornales × costo del jornal.</div>' +
            '<label class="i3-nota">Oficio</label><select class="i3-inp" style="width:100%;" onchange="_i3NR(\'oficio\',this.value)"><option value="">Elegí…</option>' +
            ofs.map(function (k) { return '<option value="' + esc(k) + '"' + (k === r.oficio ? ' selected' : '') + '>' + esc(oficiosBD[k].nombre) +
                (parseFloat(oficiosBD[k].costo_jornal) > 0 ? ' · ' + bs(oficiosBD[k].costo_jornal) + ' Bs/jornal' : ' · sin costo') + '</option>'; }).join('') +
            '<option value="__nuevo">＋ Oficio nuevo…</option></select>' +
            '<label class="i3-nota" style="margin-top:8px;display:block;">Se mide en</label><select class="i3-inp" style="width:100%;" onchange="_i3NR(\'indicador\',this.value)">' +
            Object.keys(Lector3D.INDICADORES).map(function (k) {
                return '<option value="' + k + '"' + (k === r.indicador ? ' selected' : '') + '>' + esc(Lector3D.INDICADORES[k].nombre) + ' — este ítem: ' + Lector3D.indicadorItem(k, ps) + '</option>';
            }).join('') + '</select>';
        if (r.indicador === 'letras_por_alto') {
            h += '<div class="i3-nota" style="margin-top:8px;">Letras por jornal según el alto (cada letra se mide del 3D):</div>' + r.tramos.map(function (t, j) {
                return '<div style="display:flex;gap:6px;margin-top:4px;align-items:center;"><span class="i3-nota">hasta</span><input class="i3-inp" type="number" inputmode="decimal" placeholder="alto" value="' + t.hasta_mm + '" onchange="_i3NRT(' + j + ',\'hasta_mm\',this.value)">' +
                    '<span class="i3-nota">mm:</span><input class="i3-inp" type="number" inputmode="decimal" placeholder="letras/jornal" value="' + t.por_jornal + '" onchange="_i3NRT(' + j + ',\'por_jornal\',this.value)"></div>';
            }).join('');
        } else {
            h += '<label class="i3-nota" style="margin-top:8px;display:block;">Cuánto hace en un jornal (' + esc(Lector3D.INDICADORES[r.indicador].unidad) + ')</label>' +
                '<input class="i3-inp" style="width:100%;" type="number" inputmode="decimal" value="' + r.por_jornal + '" onchange="_i3NR(\'por_jornal\',this.value)">';
        }
        h += '<label class="i3-nota" style="margin-top:8px;display:block;">Tipo de trabajo</label><input class="i3-inp" style="width:100%;" value="' + esc(r.trabajo) + '" onchange="_i3NR(\'trabajo\',this.value)">' +
            '<label class="i3-nota" style="margin-top:8px;display:block;">Notas</label><input class="i3-inp" style="width:100%;" value="' + esc(r.notas) + '" onchange="_i3NR(\'notas\',this.value)">' +
            '<div style="display:flex;gap:8px;margin-top:12px;"><button class="i3-btn prim" onclick="_i3NRGuardar()">Guardar</button><button class="i3-btn" onclick="_i3NRCerrar()">Cancelar</button></div>';
        var cont = $('i3-receta');
        if (!cont) {
            cont = document.createElement('div'); cont.id = 'i3-receta';
            cont.style.cssText = 'position:fixed;inset:0;z-index:9900;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;';
            cont.innerHTML = '<div id="i3-receta-box" class="i3-card" style="width:100%;max-width:620px;max-height:85vh;overflow-y:auto;margin:0;border-radius:16px 16px 0 0;padding:16px;padding-bottom:max(16px,env(safe-area-inset-bottom));"></div>';
            $('mod-imp3d').appendChild(cont);
        }
        $('i3-receta-box').innerHTML = h;
    }
    window._i3NR = async function (campo, v) {
        var r = est.nuevoRend;
        if (campo === 'oficio' && v === '__nuevo') {
            var nombre = (prompt('Nombre del oficio (ej. Carpintero, Letrista, Soldador):', '') || '').trim();
            if (nombre) {
                var costo = parseFloat(String(prompt('Costo de un jornal de ' + nombre + ' en Bs (vacío si no lo sabés todavía):', '') || '').replace(',', '.'));
                var k = Lector3D.claveBase(nombre), reg = { nombre: nombre };
                if (costo > 0) reg.costo_jornal = costo;
                try { await guardarAprendido('base_datos/oficios/' + k, reg, 'oficio nuevo'); oficiosBD[k] = Object.assign({}, reg); r.oficio = k; } catch (e) { alert('No se pudo crear: ' + e.message); }
            }
        } else r[campo] = v;
        pintarNuevoRend();
    };
    window._i3NRT = function (j, campo, v) { est.nuevoRend.tramos[j][campo] = v; };
    window._i3NRCerrar = function () { var c = $('i3-receta'); if (c) c.remove(); est.nuevoRend = null; };
    window._i3NRGuardar = async function () {
        var r = est.nuevoRend;
        if (!r.oficio) return alert('Elegí el oficio.');
        var reg = { oficio: r.oficio, indicador: r.indicador, trabajo: String(r.trabajo || '').trim(), notas: String(r.notas || '').trim() };
        if (r.indicador === 'letras_por_alto') {
            reg.tramos = r.tramos.map(function (t) { return { hasta_mm: parseFloat(t.hasta_mm) || null, por_jornal: parseFloat(String(t.por_jornal).replace(',', '.')) || null }; })
                .filter(function (t) { return t.por_jornal > 0; });
            if (!reg.tramos.length) return alert('Cargá al menos un tramo con letras por jornal.');
        } else {
            reg.por_jornal = parseFloat(String(r.por_jornal).replace(',', '.'));
            if (!(reg.por_jornal > 0)) return alert('Cargá cuánto hace en un jornal.');
        }
        if (reg.indicador === 'letras_por_alto') reg.por_jornal = null; else reg.tramos = null;
        var k = r.clave || Lector3D.claveBase((oficiosBD[r.oficio] || {}).nombre + ' ' + reg.indicador + ' ' + (reg.trabajo || ''));
        try { await guardarAprendido('base_datos/rendimientos/' + k, reg, r.clave ? 'rendimiento corregido' : 'rendimiento nuevo'); }
        catch (e) { alert('No se pudo guardar: ' + e.message); return; }
        rendimientosBD[k] = JSON.parse(JSON.stringify(reg));
        var nombre = est.items[r.item];
        window._i3NRCerrar();
        conScroll(function () { var rt = rutaDe(nombre); rt.ruta = 'B'; rt.rendKey = k; guardarPreferencia(nombre); });
    };

    window._i3TamPlancha = async function (clave) {
        var cat = catalogo()[clave] || {}, n = cat.n || cat.desc || clave;
        var l = parseFloat(String(prompt('Plancha de "' + n + '": LARGO (en m, cm o mm):', '') || '').replace(',', '.'));
        if (!(l > 0)) return;
        var a = parseFloat(String(prompt('Plancha de "' + n + '": ANCHO (en m, cm o mm):', '') || '').replace(',', '.'));
        if (!(a > 0)) return;
        try { await guardarAprendido('base_datos/materiales/' + clave, { plancha_largo: l, plancha_ancho: a }, 'tamaño de la plancha'); }
        catch (e) { alert('No se pudo guardar: ' + e.message); return; }
        cat.plancha_largo = l; cat.plancha_ancho = a;
        conScroll(function () {});
    };
    window._i3LargoBarra = async function (clave) {
        var cat = catalogo()[clave] || {}, n = cat.n || cat.desc || clave;
        var l = parseFloat(String(prompt('Barra de "' + n + '": LARGO (en m, cm o mm):', '') || '').replace(',', '.'));
        if (!(l > 0)) return;
        try { await guardarAprendido('base_datos/materiales/' + clave, { barra_largo: l }, 'largo de la barra'); }
        catch (e) { alert('No se pudo guardar: ' + e.message); return; }
        cat.barra_largo = l;
        conScroll(function () {});
    };

    window._i3Desp = function (clave, v) { conScroll(function () { est.desp[clave] = Math.max(0, Math.min(100, parseFloat(String(v).replace(',', '.')) || 0)); }); };

    function tarjetaRecargos() {
        var rc = est.recargos, campo = function (k, t) {
            return '<label class="i3-nota" style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:90px;">' + t +
                '<input type="number" inputmode="decimal" min="0" step="1" value="' + rc[k] + '" style="padding:7px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:15px;" ' +
                'onchange="_i3Recargo(\'' + k + '\',this.value)"></label>';
        };
        return '<div class="i3-card"><div style="font-weight:800;">Recargos del APU</div>' +
            '<div class="i3-nota">Tomados de ' + esc(rc.desde) + '. Se pueden cambiar acá (y después en el APU de cada ítem).</div>' +
            '<div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">' + campo('cs', 'Cargas sociales %') + campo('ind', 'Indirectos %') + campo('util', 'Utilidad %') + '</div></div>';
    }
    window._i3Recargo = function (k, v) { conScroll(function () { est.recargos[k] = Math.max(0, parseFloat(String(v).replace(',', '.')) || 0); est.recargos.desde = 'lo que pusiste acá'; }); };

    // ---------- Receta de mano de obra por material: se arma UNA vez y queda en /base_datos/materiales/{k}/mo_receta
    var NOMBRES_MEDIDA = [['m2_cara', 'm² de una cara (corte, enchapado)'], ['m2_sup', 'm² de toda la superficie (laca, pintura, ploteo)'],
        ['ml_perimetro', 'ml de perímetro (canto, pulido de cantos)'], ['ml_largo', 'ml de largo (soldadura, perfiles)'],
        ['und', 'por pieza (armado, colocación)'], ['m3', 'm³ de volumen'], ['glb', 'una vez por ítem']];

    function pedirRecetas() {
        if (!est) return;
        var usados = est.filas.filter(function (f) { return f.incluir && rutaDe(f.item).ruta !== 'B'; });
        est.recetaPend = Lector3D.materialesSinReceta(usados, catalogo()).filter(function (k) { return !(est.recetaOmitida || {})[k]; });
        if (est.recetaPend.length && !$('i3-receta')) window._i3Receta(est.recetaPend[0], true);
    }

    window._i3Receta = function (clave, automatico) {
        var cat = catalogo()[clave];
        if (!cat) return;
        est.receta = { clave: clave, automatico: !!automatico, pasos: JSON.parse(JSON.stringify(Lector3D.recetaDe(cat) || [])) };
        if (!est.receta.pasos.length) est.receta.pasos.push({ mo: '', medida: 'm2_cara', factor: 1 });
        pintarReceta();
    };

    function pintarReceta() {
        var r = est.receta, cat = catalogo()[r.clave], mo = catalogoMO();
        var opcionesMO = Object.keys(mo).sort(function (a, b) { return String(mo[a].n || mo[a].desc || a).localeCompare(String(mo[b].n || mo[b].desc || b)); })
            .map(function (k) { return [k, (mo[k].n || mo[k].desc || k) + ' [' + (mo[k].u || mo[k].und || '?') + ']' + (precioMO(mo[k]) ? '' : ' (sin precio)')]; });
        var h = '<div style="font-weight:800;font-size:15px;">Mano de obra de "' + esc(cat.n || cat.desc || r.clave) + '"</div>' +
            '<div class="i3-nota" style="margin:4px 0 8px;">Se arma <b>una sola vez</b> y queda guardada en la base: cada pieza con este material suma sola su mano de obra ' +
            '(cantidad de la geometría × precio de la base).</div>';
        r.pasos.forEach(function (p, i) {
            h += '<div style="border-top:1px solid var(--border);padding:8px 0;">' +
                '<select class="i3-inp" style="width:100%;" onchange="_i3RecetaPaso(' + i + ',\'mo\',this.value)"><option value="">Elegí la mano de obra…</option>' +
                opcionesMO.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === p.mo ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') +
                '<option value="__nueva">＋ Crear mano de obra nueva (sin precio)…</option></select>' +
                '<div style="display:flex;gap:6px;margin-top:6px;"><select class="i3-inp" style="flex:3;" onchange="_i3RecetaPaso(' + i + ',\'medida\',this.value)">' +
                NOMBRES_MEDIDA.map(function (m) { return '<option value="' + m[0] + '"' + (m[0] === p.medida ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select>' +
                '<input class="i3-inp" style="flex:1;min-width:60px;" type="number" inputmode="decimal" step="0.1" min="0" value="' + (p.factor || 1) + '" title="Factor (ej. 2 = dos manos)" onchange="_i3RecetaPaso(' + i + ',\'factor\',this.value)">' +
                '<button class="i3-btn" style="padding:6px 10px;" onclick="_i3RecetaPaso(' + i + ',\'quitar\')">✕</button></div></div>';
        });
        h += '<button class="i3-btn" style="margin-top:6px;" onclick="_i3RecetaPaso(-1,\'agregar\')">＋ Otro trabajo</button>' +
            '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;"><button class="i3-btn prim" onclick="_i3RecetaGuardar(false)">Guardar</button>' +
            '<button class="i3-btn" onclick="_i3RecetaGuardar(true)">No lleva mano de obra</button>' +
            '<button class="i3-btn" onclick="_i3RecetaCerrar()">Después</button></div>';
        var cont = $('i3-receta');
        if (!cont) {
            cont = document.createElement('div'); cont.id = 'i3-receta';
            cont.style.cssText = 'position:fixed;inset:0;z-index:9900;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;';
            cont.innerHTML = '<div id="i3-receta-box" class="i3-card" style="width:100%;max-width:620px;max-height:85vh;overflow-y:auto;margin:0;border-radius:16px 16px 0 0;padding:16px;padding-bottom:max(16px,env(safe-area-inset-bottom));"></div>';
            $('mod-imp3d').appendChild(cont);
        }
        $('i3-receta-box').innerHTML = h;
    }
    function precioMO(m) { var p = parseFloat(m && (m.p != null ? m.p : m.pu)); return p > 0 ? p : 0; }

    window._i3RecetaPaso = async function (i, campo, v) {
        var r = est.receta;
        if (campo === 'agregar') r.pasos.push({ mo: '', medida: 'und', factor: 1 });
        else if (campo === 'quitar') r.pasos.splice(i, 1);
        else if (campo === 'factor') r.pasos[i].factor = Math.max(0, parseFloat(String(v).replace(',', '.')) || 1);
        else if (campo === 'mo' && v === '__nueva') {
            var nombre = prompt('Nombre de la mano de obra nueva (queda en la base sin precio):', '');
            if (nombre && nombre.trim()) {
                var unidad = prompt('Unidad (m2, ml, und, glb, jornal, hr):', NOMBRES_MEDIDA[0][0] === r.pasos[i].medida ? 'm2' : 'und') || 'und';
                var clave = Lector3D.claveBase(nombre);
                var reg = { desc: nombre.trim(), n: nombre.trim(), u: unidad.trim(), p: 0, falta_precio: true, origen: 'receta', creado: firebase.database.ServerValue.TIMESTAMP };
                try { await db.ref('base_datos/mano_obra/' + clave).set(reg); catalogoMO()[clave] = Object.assign({}, reg, { creado: Date.now() }); r.pasos[i].mo = clave; }
                catch (e) { alert('No se pudo crear: ' + e.message); }
            }
        } else r.pasos[i][campo] = v;
        pintarReceta();
    };

    window._i3RecetaGuardar = async function (ninguna) {
        var r = est.receta, pasos = r.pasos.filter(function (p) { return p.mo; }).map(function (p) { return { mo: p.mo, medida: p.medida, factor: parseFloat(p.factor) || 1 }; });
        if (!ninguna && !pasos.length) { alert('Elegí al menos una mano de obra, o tocá "No lleva mano de obra".'); return; }
        var ref = db.ref('base_datos/materiales/' + r.clave), cat = catalogo()[r.clave];
        try {
            if (ninguna) { await guardarAprendido('base_datos/materiales/' + r.clave, { mo_receta: null, mo_receta_ninguna: true }, 'receta de mano de obra'); delete cat.mo_receta; cat.mo_receta_ninguna = true; }
            else { await guardarAprendido('base_datos/materiales/' + r.clave, { mo_receta: pasos, mo_receta_ninguna: null }, 'receta de mano de obra'); cat.mo_receta = pasos; delete cat.mo_receta_ninguna; }
        } catch (e) { alert('No se pudo guardar la receta: ' + e.message); return; }
        window._i3RecetaCerrar(true);
    };

    window._i3RecetaCerrar = function (guardada) {
        var r = est.receta;
        if (!guardada && r) (est.recetaOmitida = est.recetaOmitida || {})[r.clave] = true;   // "Después": no insistir en esta importación
        var c = $('i3-receta'); if (c) c.remove();
        est.receta = null;
        conScroll(function () {});
        if (r && r.automatico) pedirRecetas();   // la siguiente que falte
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
            if (est.pdf && est.pdf.auto) {
                var au = est.pdf.auto;
                h += '<div style="margin-top:10px;padding:10px;border-radius:10px;background:rgba(175,82,222,.1);border:1px solid var(--purple);font-size:13px;">' +
                    '<b style="color:var(--purple);">📄 Escala calibrada según el PDF:</b> ' + esc(au.dimension) + ' ' + au.mm + ' mm' +
                    (au.pagina ? ' (pág. ' + au.pagina + ')' : '') + ' · confianza ' + esc(au.confianza) +
                    (au.cita ? '<div class="i3-cita">“' + esc(au.cita) + '”</div>' : '') +
                    '<div style="margin-top:6px;"><button class="i3-btn" style="padding:6px 12px;font-size:12px;" onclick="_i3DeshacerPDF()">Deshacer</button> ' +
                    '<span class="i3-nota">Se ajustaron todas las piezas del archivo.</span></div></div>';
            }
            h += '<div style="margin-top:10px;font-size:14px;">Todo el modelo mide <b>' + fmtTam(tamanoM()) + '</b></div>' +
                (est.calibrado
                    ? '<div class="i3-nota" style="margin-top:4px;color:var(--green);font-weight:700;">📏 ' + esc(textoCalibrado()) + ' Se ajustaron todas las piezas del archivo.</div>'
                    : '<div class="i3-nota" style="margin-top:4px;">Unidad detectada: ' + esc(est.det.unidad) + ' (' + esc(est.det.motivo) + ').</div>');
        } else {
            h += '<div class="i3-nota" style="margin-top:6px;">rubik.json de Blender (medidas en metros). ' + esc(est.res.resumen || '') + '</div>';
        }
        est.avisos.forEach(function (a) { h += '<div class="i3-nota" style="margin-top:4px;">' + esc(a) + '</div>'; });
        h += '<div class="i3-chips"><span class="i3-chip">' + totalPiezas + (totalPiezas === 1 ? ' pieza' : ' piezas') + '</span><span class="i3-chip">' + itemsIncl.length + (itemsIncl.length === 1 ? ' ítem' : ' ítems') + '</span>' +
            (falta.length ? '<span class="i3-chip rojo">' + falta.length + ' sin vincular</span>' : '<span class="i3-chip" style="color:var(--green)">materiales vinculados</span>') +
            '</div></div>';

        h += tarjetaPDF();
        if (est.modo === '3d') h += tarjetaEscala();
        h += tarjetaRecargos();

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
                    '<div class="i3-med">' + (f.largo ? mm(f.largo) + ' × ' + mm(f.ancho) + ' × ' + mm(f.espesor) + ' mm · ' + (f.tipo === 'plancha' ? 'plancha' : 'volumen') : '<span style="color:var(--orange);font-weight:700;">sin medidas en el PDF</span>') +
                    (f.medidas_desde === 'pdf_ia' ? ' <span class="i3-ia">según PDF (IA) · ' + esc(f.medidas_confianza) + '</span>' : '') + '</div>' +
                    '<div class="i3-mat ' + matCls + '">' + esc(matTxt) +
                    (f.material_desde === 'pdf_ia' ? ' <span class="i3-ia">según PDF (IA) · ' + esc(f.material_confianza) + '</span>' : '') + '</div>' +

                    (acab ? '<div class="i3-nota">Acabados: ' + acab + '</div>' : '') +
                    (f.motivos || []).filter(function (m) { return /partes sueltas|revisar la unidad/.test(m); }).map(function (m) {
                        return '<div class="i3-nota" style="color:var(--orange);font-weight:700;">⚠ ' + esc(m) + '</div>';
                    }).join('') +
                    (est.modo === '3d' ? '<button class="i3-mv" style="margin-right:6px;" onclick="_i3Calibrar(' + f._i + ')" title="Calibrar la escala con la medida real de esta pieza">📏 Mide…</button>' : '') +
                    '<select class="i3-mv" onchange="_i3Mover(' + f._i + ',this.value)"><option value="">Mover a otro ítem…</option>' +
                    est.items.filter(function (n) { return n !== nombre; }).map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('') +
                    '<option value="' + NUEVO + '">➕ Ítem nuevo…</option></select></div></div>';
            });
            h += tarjetaRuta(nombre, filas.filter(function (f) { return f.incluir; }));
            h += tarjetaApu(nombre, filas.filter(function (f) { return f.incluir; }));
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
                tipo: fila && fila.fuente && fila.fuente.origen_vw === 'clase' ? 'clase' : (fila && fila.fuente && fila.fuente.origen_vw === 'pdf' ? 'pdf' : 'material'),
                actualizado: firebase.database.ServerValue.TIMESTAMP,
                por: (firebase.auth().currentUser || {}).uid || null
            };
            try { await db.ref('base_datos/equivalencias_vw/' + Lector3D.claveEquivalencia(origen)).set(reg); }
            catch (e) { alert('No se pudo guardar la equivalencia: ' + e.message); return; }
            est.eqNodo[Lector3D.claveEquivalencia(origen)] = { vw: origen, material: clave };
            var eq = Lector3D.cargarEquivalencias(est.eqNodo);
            conScroll(function () { est.filas.forEach(function (f) { Lector3D.resolverMateriales(f, eq); }); });
            pedirRecetas();
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
            archivo: est.archivo, fecha: Date.now(), pdf: est.pdf && est.pdf.info ? est.pdf.nombre : null,
            unidad: est.modo !== '3d' ? 'm' : (est.calibrado ? textoCalibrado() + ' (×' + (est.factor / Lector3D.FACTORES[est.unidad]).toPrecision(4) + ' sobre ' + est.unidad + ')' : est.unidad)
        }, { desperdicios: est.desp, catalogoMO: catalogoMO(), recargos: est.recargos, rutaPorItem: (function () {
            var m = {};
            nombres.forEach(function (n) { var rt = rutaDe(n); m[n] = { ruta: rt.ruta, rendimiento: rt.rend, oficio: rt.oficio }; });
            return m;
        })() });
        if ($('i3-cap') && $('i3-cap').checked) {
            data.push({ type: 'chapter', name: ('3D · ' + est.archivo.replace(/\.[^.]+$/, '')).toUpperCase(), collapsed: false });
        }
        // Siempre al final: las licitaciones apuntan a los ítems por posición (ver ficha 03)
        nuevos.forEach(function (it) { data.push(it); });
        saveDB(true);
        render();
        var marcadas = nuevos.reduce(function (s, it) { return s + it.apu.mat.concat(it.apu.mo).filter(function (r) { return r.revisar; }).length; }, 0);
        var conMO = nuevos.some(function (it) { return it.apu.mo.length; });
        $('mod-imp3d').style.display = 'none';
        est = null;
        setTimeout(function () {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            alert('✅ ' + nuevos.length + ' ítem' + (nuevos.length > 1 ? 's' : '') + ' agregado' + (nuevos.length > 1 ? 's' : '') + ' al final.\n' +
                (marcadas ? marcadas + ' fila' + (marcadas > 1 ? 's' : '') + ' del APU en rojo: falta precio, rendimiento o vincular.\n' : '') +
                (conMO ? 'Mano de obra: por medida (receta del material) o por trato (referencia para negociar; el monto cerrado va en licitaciones).'
                    : 'Sin mano de obra todavía: armá las recetas o los rendimientos desde "Importar 3D", o cargala a mano en el APU.'));
        }, 150);
    };

    // ------------------------------------------------- "Compartir → Rubik" (Android)
    // El service worker /compartir/sw-hub.js deja los archivos en IndexedDB; acá se toman (y se borran).
    async function revisarCompartidos() {
        if (!window.Compartidos3D || !window.indexedDB) return;
        var q = new URLSearchParams(location.search), pedido = q.get('importar3d');
        var lista;
        try { lista = await Compartidos3D.pendientes(); } catch (e) { return; }
        if (pedido) {   // sacar el parámetro de la URL (si se recarga, no vuelve a importar)
            q.delete('importar3d');
            history.replaceState({}, document.title, location.pathname + '?' + q.toString());
        }
        if (!lista.length) return;
        var envio = lista.find(function (e) { return e.id === pedido; }) || lista[0];
        if (!(pedido && envio.id === pedido) &&
            !confirm('Tenés un archivo compartido a Rubik: ' + envio.nombres.join(', ') + '.\n¿Importarlo en este presupuesto?\n(Cancelar: queda guardado para otro proyecto, hasta 24 h.)')) return;
        var archivos = await Compartidos3D.tomar(envio.id);   // lo borra de IndexedDB
        if (!archivos.length) return;
        window.abrirImportar3D();
        window._i3Archivos(archivos);
    }
    // Proyectos recientes (para "¿Dónde lo importo?" de /compartir/elegir.html). Solo en este teléfono.
    function anotarReciente() {
        try {
            var q = new URLSearchParams(location.search);
            var cid = q.get('cid') || localStorage.getItem('rubik_client_id'), pid = q.get('pid') || localStorage.getItem('rubik_current_pid');
            if (!cid || !pid) return;
            var r = JSON.parse(localStorage.getItem('rubik_recientes') || '[]').filter(function (x) { return !(x.cid === cid && x.pid === pid); });
            r.unshift({ cid: cid, pid: pid, pname: localStorage.getItem('rubik_current_pname') || 'Proyecto',
                cname: localStorage.getItem('rubik_client_name') || 'Cliente', ts: Date.now() });
            localStorage.setItem('rubik_recientes', JSON.stringify(r.slice(0, 10)));
        } catch (e) { /* sin localStorage: no hay recientes */ }
    }
    window.addEventListener('load', function () { anotarReciente(); setTimeout(revisarCompartidos, 1200); });
})();
