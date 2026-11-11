/**
 * lector-3d.js — Lee un modelo 3D ya cargado con three.js y arma el desglose `rubik/1`
 * (el mismo formato que escribe tools/blender/exportar_rubik.py).
 *
 * No toca el DOM ni Firebase y no importa three.js: recibe los objetos ya cargados
 * (GLTFLoader / FBXLoader). Así se usa igual en el navegador (window.Lector3D) y en
 * Node para las pruebas (module.exports). La interfaz está en importar-3d.js.
 *
 * Misma lógica que el script de Blender:
 *   - ítem: propiedad `rubik_item` → padre más alto (grupo de VW) → "Sin agrupar"
 *   - pieza: nombre del objeto sin el ".001"
 *   - origen_vw: propiedad de clase de VW (vw_clase, clase, class, layer…) → material con más superficie
 *   - medidas: caja más ajustada aunque la pieza esté girada (medidas_orientadas)
 *   - área de todas las caras, una cara y perímetro (planchas), volumen si la malla es cerrada
 *   - piezas iguales (ítem, nombre, origen, medidas al mm) se suman en `cant`
 * Nada se inventa: sin equivalencia → material null y revisar: true.
 */
(function (global) {
    'use strict';

    var FORMATO = 'rubik/1';
    var ESPESOR_MAX_PLANCHA = 0.06;   // m — por debajo es "plancha"
    var TOLERANCIA_AGRUPAR = 0.001;   // m — 1 mm
    var ESCALA_SOSPECHOSA_M = 20;     // m — una pieza más larga casi seguro es un modelo en mm o cm leído como m
    var SOLDAR = 1e5;                 // vértices a menos de 0,01 mm se consideran el mismo
    var SIN_ITEM = 'Sin agrupar';

    var PROPS_CLASE_VW = ['vw_clase', 'vw_class', 'clase', 'class', 'ifcclass_vw', 'layer', 'capa'];
    var PROPS_ITEM = ['rubik_item', 'item'];
    // Nodos que agregan los exportadores y no son un ítem
    var NODOS_IGNORADOS = ['scene collection', 'collection', 'colección', 'coleccion', 'scene', 'escena',
        'rootnode', 'root', 'auxscene', 'gltf_scenerootnode', 'sketchfab_model', 'world'];
    // Nombres que suelen ser entorno (personas, plantas, cámaras): se sugiere descartarlos
    var RE_ENTORNO = /(^|[^a-z])(persona|personas|people|person|human|humano|hombre|mujer|ni[nñ]o|figura|silueta|planta|plantas|plant|arbol|árbol|tree|maceta|vegetaci[oó]n|entorno|context|contexto|c[aá]mara|camera|light|luz|lampara_ref|referencia|auto|car|veh[ií]culo)([^a-z]|$)/i;

    // ---------------------------------------------------------------------
    // Geometría pura (igual que exportar_rubik.py)
    // ---------------------------------------------------------------------
    function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
    function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function norm(a) { return Math.sqrt(dot(a, a)); }
    function unit(a) { var n = norm(a); return n > 1e-12 ? [a[0] / n, a[1] / n, a[2] / n] : null; }

    function sumaCruces(puntos) {
        var acc = [0, 0, 0], p0 = puntos[0];
        for (var i = 1; i < puntos.length - 1; i++) {
            var c = cross(sub(puntos[i], p0), sub(puntos[i + 1], p0));
            acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
        }
        return acc;
    }
    function areaPoligono(puntos) { return puntos.length < 3 ? 0 : norm(sumaCruces(puntos)) / 2; }
    function normalPoligono(puntos) { return unit(sumaCruces(puntos)); }

    function volumenMalla(vertices, caras) {
        var v = 0;
        caras.forEach(function (cara) {
            var p0 = vertices[cara[0]];
            for (var i = 1; i < cara.length - 1; i++) v += dot(p0, cross(vertices[cara[i]], vertices[cara[i + 1]])) / 6;
        });
        return Math.abs(v);
    }

    function mallaCerrada(caras) {
        if (!caras.length) return false;
        var n = 0;   // claves numéricas a*n+b: mucho más rápido que texto en mallas de 400.000 caras
        caras.forEach(function (cara) { for (var i = 0; i < cara.length; i++) if (cara[i] >= n) n = cara[i] + 1; });
        var cuenta = new Map();
        caras.forEach(function (cara) {
            for (var i = 0; i < cara.length; i++) {
                var a = cara[i], b = cara[(i + 1) % cara.length];
                var k = a < b ? a * n + b : b * n + a;
                cuenta.set(k, (cuenta.get(k) || 0) + 1);
            }
        });
        for (var c of cuenta.values()) if (c !== 2) return false;
        return true;
    }

    /** Cuántas partes sueltas (islas) tiene la malla. Más de 1 = piezas unidas en un solo objeto. */
    function contarPartes(nVertices, caras) {
        var padre = new Int32Array(nVertices), usado = new Uint8Array(nVertices), i;
        for (i = 0; i < nVertices; i++) padre[i] = i;
        function raiz(x) { while (padre[x] !== x) { padre[x] = padre[padre[x]]; x = padre[x]; } return x; }
        caras.forEach(function (cara) {
            var r0 = raiz(cara[0]);
            for (var k = 0; k < cara.length; k++) {
                usado[cara[k]] = 1;
                var r = raiz(cara[k]);
                if (r !== r0) padre[r] = r0;
            }
        });
        var raices = new Set();
        for (i = 0; i < nVertices; i++) if (usado[i]) raices.add(raiz(i));
        return raices.size;
    }

    function baseDesde(eje) {
        var aux = Math.abs(eje[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        var u = unit(cross(eje, aux));
        return [u, cross(eje, u)];
    }

    function round9(x) { return Math.round(x * 1e9) / 1e9; }

    function casco2d(puntos) {
        // ordenar y sacar repetidos (como sorted(set(...)) en Python, sin claves de texto: rápido en mallas grandes)
        var orden = puntos.map(function (p) { return [round9(p[0]), round9(p[1])]; })
            .sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
        var pts = [];
        for (var j = 0; j < orden.length; j++) {
            var u = pts[pts.length - 1];
            if (!u || u[0] !== orden[j][0] || u[1] !== orden[j][1]) pts.push(orden[j]);
        }
        if (pts.length <= 2) return pts;
        function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
        var inf = [], sup = [], i;
        for (i = 0; i < pts.length; i++) {
            while (inf.length >= 2 && cr(inf[inf.length - 2], inf[inf.length - 1], pts[i]) <= 0) inf.pop();
            inf.push(pts[i]);
        }
        for (i = pts.length - 1; i >= 0; i--) {
            while (sup.length >= 2 && cr(sup[sup.length - 2], sup[sup.length - 1], pts[i]) <= 0) sup.pop();
            sup.push(pts[i]);
        }
        return inf.slice(0, -1).concat(sup.slice(0, -1));
    }

    function rectMinimo2d(puntos) {
        var casco = casco2d(puntos);
        if (casco.length === 0) return [0, 0];
        if (casco.length <= 2) {
            return casco.length === 2 ? [Math.hypot(casco[0][0] - casco[1][0], casco[0][1] - casco[1][1]), 0] : [0, 0];
        }
        var mejor = null, n = casco.length;
        for (var i = 0; i < n; i++) {
            var p = casco[i], q = casco[(i + 1) % n];
            var dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
            if (L < 1e-12) continue;
            var ux = dx / L, uy = dy / L;
            var aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
            for (var j = 0; j < n; j++) {
                var a = casco[j][0] * ux + casco[j][1] * uy, b = -casco[j][0] * uy + casco[j][1] * ux;
                if (a < aMin) aMin = a; if (a > aMax) aMax = a; if (b < bMin) bMin = b; if (b > bMax) bMax = b;
            }
            var la = aMax - aMin, lb = bMax - bMin;
            if (mejor === null || la * lb < mejor[0] * mejor[1] - 1e-15) mejor = [la, lb];
        }
        return mejor || [0, 0];
    }

    function extension(vertices, eje) {
        var mn = Infinity, mx = -Infinity;
        for (var i = 0; i < vertices.length; i++) { var s = dot(vertices[i], eje); if (s < mn) mn = s; if (s > mx) mx = s; }
        return mx - mn;
    }

    function r3(c) { return Math.round(c * 1000) / 1000 + 0; }
    function compararTuplas(a, b) { for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] - b[i]; } return 0; }

    /** Largo, ancho y espesor (m) de la caja más ajustada, de mayor a menor. Igual que en Python. */
    function medidasOrientadas(vertices, caras, ejesLocales) {
        if (!vertices.length) return [0, 0, 0];
        var candidatos = [];
        if (ejesLocales) candidatos.push(ejesLocales.map(function (e) { return extension(vertices, e); }));

        var porDir = new Map();
        caras.forEach(function (cara) {
            var pts = cara.length === 3 ? [vertices[cara[0]], vertices[cara[1]], vertices[cara[2]]] : cara.map(function (i) { return vertices[i]; });
            var cr = sumaCruces(pts), largoCr = norm(cr), a = largoCr / 2;
            if (a < 1e-12 || largoCr <= 1e-12) return;
            var n = [cr[0] / largoCr, cr[1] / largoCr, cr[2] / largoCr];
            var k = n.map(r3), kn = k.map(function (c) { return -c + 0; });
            var clave = compararTuplas(k, kn) >= 0 ? k : kn;
            // clave numérica: cada componente redondeado a 0,001 está en [-1000, 1000]
            var ks = (Math.round(clave[0] * 1000) + 1000) * 4004001 + (Math.round(clave[1] * 1000) + 1000) * 2001 + (Math.round(clave[2] * 1000) + 1000);
            var prev = porDir.get(ks);
            porDir.set(ks, prev ? [prev[0] + a, prev[1]] : [a, n]);
        });
        Array.from(porDir.values()).sort(function (x, y) { return y[0] - x[0]; }).slice(0, 3).forEach(function (par) {
            var eje = par[1], b = baseDesde(eje), u = b[0], w = b[1];
            var pts2 = vertices.map(function (v) { return [dot(v, u), dot(v, w)]; });
            var r = rectMinimo2d(pts2);
            candidatos.push([r[0], r[1], extension(vertices, eje)]);
        });
        if (!candidatos.length) candidatos.push([[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(function (e) { return extension(vertices, e); }));

        function vol(d) { var s = d.slice().sort(function (a, b) { return b - a; }); return [s[0] * s[1] * s[2], s[0] * s[1]]; }
        var mejor = candidatos[0], mv = vol(mejor);
        for (var i = 1; i < candidatos.length; i++) {
            var v = vol(candidatos[i]);
            if (compararTuplas(v, mv) < 0) { mejor = candidatos[i]; mv = v; }
        }
        return mejor.slice().sort(function (a, b) { return b - a; });
    }

    function redondear(x, dec) { var f = Math.pow(10, dec == null ? 4 : dec); return Math.round(Number(x) * f) / f; }

    function normalizarNombre(nombre) {
        if (nombre == null) return null;
        return String(nombre).trim().replace(/\.\d{3}$/, '');
    }

    /** Clave de /base_datos/equivalencias_vw/{clave}: minúsculas, sin espacios al borde, sin . # $ [ ] / */
    function claveEquivalencia(vw) {
        return String(vw || '').trim().toLowerCase().replace(/[.#$\[\]\/]/g, '_');
    }

    /** Acepta {"MDF-18": "MDF_18"} o el nodo de Firebase {clave: {vw, material, acabados}}. */
    function cargarEquivalencias(fuente) {
        var salida = {};
        Object.keys(fuente || {}).forEach(function (k) {
            var v = fuente[k];
            if (v && typeof v === 'object' && 'vw' in v) salida[v.vw] = v; else salida[k] = v;
        });
        return salida;
    }

    function buscarEquivalencia(origen, eq) {
        if (!origen || !eq) return null;
        if (Object.prototype.hasOwnProperty.call(eq, origen)) return eq[origen];
        var clave = String(origen).trim().toLowerCase();
        for (var k in eq) if (String(k).trim().toLowerCase() === clave) return eq[k];
        return null;
    }

    function claveMaterial(dato) {
        if (dato == null) return null;
        if (typeof dato === 'object') return dato.material || null;
        return String(dato);
    }

    function agruparPiezas(piezas) {
        var grupos = new Map(), orden = [];
        piezas.forEach(function (p) {
            var t = TOLERANCIA_AGRUPAR;
            var k = JSON.stringify([p.item, p.pieza, p.origen_vw,
                Math.round(p.largo / t), Math.round(p.ancho / t), Math.round(p.espesor / t),
                p.acabados.map(function (a) { return String(a.origen_vw || a.material); }).sort()]);
            if (grupos.has(k)) {
                var g = grupos.get(k);
                g.cant += p.cant;
                g.objetos = g.objetos.concat(p.objetos);
            } else {
                grupos.set(k, Object.assign({}, p, { objetos: p.objetos.slice() }));
                orden.push(k);
            }
        });
        return orden.map(function (k) { return grupos.get(k); });
    }

    // ---------------------------------------------------------------------
    // Lectura de objetos three.js (duck typing: no importa three)
    // ---------------------------------------------------------------------
    function nombreDe(obj) {
        if (!obj) return '';
        var ud = obj.userData || {};
        return String(ud.name || ud.originalName || obj.name || '');
    }

    function prop(obj, nombres) {
        var ud = (obj && obj.userData) || {};
        var bajas = {};
        Object.keys(ud).forEach(function (k) { bajas[k.toLowerCase()] = k; });
        for (var i = 0; i < nombres.length; i++) {
            var k = bajas[nombres[i]];
            if (k === undefined) continue;
            var v = ud[k];
            if ((typeof v === 'string' || typeof v === 'number') && String(v).trim()) return String(v).trim();
        }
        return null;
    }

    function esIgnorado(obj) {
        var n = nombreDe(obj).trim().toLowerCase();
        return !n || NODOS_IGNORADOS.indexOf(n) >= 0;
    }

    /** Marca las primitivas de una malla glTF con varios materiales para leerlas como una sola pieza. */
    function prepararGLTF(gltf) {
        var asoc = gltf && gltf.parser && gltf.parser.associations;
        if (!asoc) return gltf;
        gltf.scene.traverse(function (o) {
            if (!o.isMesh) return;
            var a = asoc.get(o);
            if (a && a.primitives !== undefined && a.nodes === undefined && o.parent) {
                o.userData.__rubikPrimitiva = true;
                o.parent.userData.__rubikPieza = true;
            }
        });
        return gltf;
    }

    /**
     * Propiedades personalizadas de cada objeto de un FBX (ej. la clase de Vectorworks en `vw_clase`).
     * FBXLoader no las pasa a three.js, así que se leen acá: Objects → Model → Properties70 → P con flag "U".
     * Devuelve { nombreDelObjeto: { prop: valor } }. Binario (7.x) o ASCII. Si algo no se entiende, devuelve {}.
     */
    function leerPropiedadesFBX(buffer) {
        var salida = {};
        try {
            var bytes = new Uint8Array(buffer), dv = new DataView(buffer);
            var cabecera = String.fromCharCode.apply(null, bytes.subarray(0, 20));
            var txt = function (a, b) { return new TextDecoder('utf-8').decode(bytes.subarray(a, b)); };
            if (cabecera.indexOf('Kaydara FBX Binary') !== 0) {
                // ASCII: Model: id, "Model::Nombre", "Mesh" { ... P: "prop", "KString", "", "U", "valor"
                var t = new TextDecoder('utf-8').decode(bytes), actual = null, re = /Model:\s*[-\d]+,\s*"(?:Model::)?([^"]*)"|P:\s*"([^"]*)",\s*"[^"]*",\s*"[^"]*",\s*"([^"]*)",\s*("([^"]*)"|[-\d.eE+]+)/g, m;
                while ((m = re.exec(t))) {
                    if (m[1] !== undefined) { actual = m[1]; continue; }
                    if (actual && m[3].indexOf('U') >= 0) (salida[actual] = salida[actual] || {})[m[2]] = m[5] !== undefined ? m[5] : Number(m[4]);
                }
                return salida;
            }
            var version = dv.getUint32(23, true), off = 27, largo = version >= 7500 ? 8 : 4;
            var u = function (o) { return largo === 8 ? Number(dv.getBigUint64(o, true)) : dv.getUint32(o, true); };
            function props(o, n) {
                var vals = [];
                for (var i = 0; i < n; i++) {
                    var tipo = String.fromCharCode(bytes[o]); o++;
                    if (tipo === 'S' || tipo === 'R') { var l = dv.getUint32(o, true); vals.push(tipo === 'S' ? txt(o + 4, o + 4 + l) : null); o += 4 + l; }
                    else if (tipo === 'Y') { vals.push(dv.getInt16(o, true)); o += 2; }
                    else if (tipo === 'C') { vals.push(bytes[o]); o += 1; }
                    else if (tipo === 'I') { vals.push(dv.getInt32(o, true)); o += 4; }
                    else if (tipo === 'F') { vals.push(dv.getFloat32(o, true)); o += 4; }
                    else if (tipo === 'D') { vals.push(dv.getFloat64(o, true)); o += 8; }
                    else if (tipo === 'L') { vals.push(null); o += 8; }
                    else if ('fdlib'.indexOf(tipo) >= 0) { vals.push(null); o += 12 + dv.getUint32(o + 8, true); }
                    else throw new Error('tipo FBX desconocido');
                }
                return vals;
            }
            // Recorre nodos; `ruta` = nombres de los nodos padres
            function nodo(o, ruta, modelo) {
                var fin = u(o), n = u(o + largo), lenNombre = bytes[o + 3 * largo];
                if (fin === 0) return null;
                var nombre = txt(o + 3 * largo + 1, o + 3 * largo + 1 + lenNombre);
                var p = o + 3 * largo + 1 + lenNombre;
                var inicioHijos = p + u(o + 2 * largo);
                var interesa = ruta.length < 3 && (nombre === 'Objects' || nombre === 'Model' || nombre === 'Properties70');
                if (nombre === 'Model' && ruta[ruta.length - 1] === 'Objects') {
                    var v = props(p, Math.min(n, 2));
                    modelo = String(v[1] || '').split('\u0000')[0].replace(/^Model::/, '');
                }
                if (nombre === 'P' && modelo && ruta[ruta.length - 1] === 'Properties70') {
                    var pv = props(p, n);
                    if (String(pv[3] || '').indexOf('U') >= 0 && pv[0]) (salida[modelo] = salida[modelo] || {})[pv[0]] = pv[4];
                }
                if (interesa || nombre === 'Properties70') {
                    var h = inicioHijos;
                    while (h < fin) { var sig = nodo(h, ruta.concat(nombre), modelo); if (sig === null) break; h = sig; }
                }
                return fin;
            }
            while (off < bytes.length - 3 * largo) { var s2 = nodo(off, [], null); if (!s2) break; off = s2; }
        } catch (e) { /* propiedades opcionales: si falla, se sigue sin ellas */ }
        return salida;
    }

    /** Copia esas propiedades al userData de los objetos (por nombre original), sin pisar lo que ya haya. */
    function aplicarPropiedadesFBX(raiz, propiedades) {
        raiz.traverse(function (o) {
            var p = propiedades[nombreDe(o)];
            if (!p) return;
            Object.keys(p).forEach(function (k) { if (o.userData[k] === undefined) o.userData[k] = p[k]; });
        });
        return raiz;
    }

    /**
     * Plugin de GLTFLoader que NO carga texturas: devuelve una textura vacía sin leer ni decodificar la imagen.
     * Para medir alcanza con la geometría y el nombre del material, y así un archivo de 100+ MB con
     * texturas no agota la memoria del celular. Uso: loader.register(Lector3D.pluginSinTexturas(THREE)).
     */
    function pluginSinTexturas(THREE) {
        return function () {
            return { name: 'rubik_sin_texturas', loadTexture: function () { return Promise.resolve(new THREE.Texture()); } };
        };
    }

    var PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    /**
     * Para LoadingManager.setURLModifier: nada se pide afuera y ninguna imagen se decodifica.
     *   - archivos que eligió el usuario (ej. el .bin de un .gltf) → su blob (`mapa`: nombre → url)
     *   - .bin que falta → se deja (falla, y `faltan` dice cuál)
     *   - imágenes (archivo, blob incrustado del FBX o data:image) → 1 píxel
     */
    function modificadorURL(mapa, faltan) {
        var propias = Object.keys(mapa || {}).map(function (k) { return mapa[k]; });
        return function (url) {
            if (/^blob:/.test(url)) return propias.indexOf(url) >= 0 ? url : PIXEL;
            if (/^data:image\//.test(url)) return PIXEL;
            if (/^data:/.test(url)) return url;
            var base = decodeURIComponent(String(url).split(/[\\/]/).pop().split('?')[0]);
            if (mapa && mapa[base]) return mapa[base];
            if (/\.bin$/i.test(base)) { if (faltan) faltan.push(base); return url; }
            return PIXEL;
        };
    }

    function matMul(a, b) {   // matrices 4x4 column-major (como three.js)
        var r = new Array(16);
        for (var c = 0; c < 4; c++) for (var f = 0; f < 4; f++) {
            var s = 0;
            for (var k = 0; k < 4; k++) s += a[k * 4 + f] * b[c * 4 + k];
            r[c * 4 + f] = s;
        }
        return r;
    }
    function aplicar(m, x, y, z) {
        return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
    }
    function ejesDe(m) {
        var ejes = [];
        for (var i = 0; i < 3; i++) {
            var u = unit([m[i * 4], m[i * 4 + 1], m[i * 4 + 2]]);
            if (!u) return null;
            ejes.push(u);
        }
        return ejes;
    }

    function visibleEnCadena(obj, raiz) {
        for (var o = obj; o && o !== raiz; o = o.parent) if (o.visible === false) return false;
        return true;
    }

    /**
     * Junta las mallas de una pieza en vértices soldados (m), triángulos y el material de cada triángulo.
     * `mallas`: [{mesh, matriz}] — matriz = matrixWorld (o matrixWorld × instancia).
     */
    function datosMalla(mallas, factor) {
        var vertices = [], caras = [], matsCara = [], indice = new Map();
        mallas.forEach(function (mm) {
            var geo = mm.mesh.geometry, pos = geo && geo.attributes && geo.attributes.position;
            if (!pos) return;
            var m = mm.matriz, mapa = new Array(pos.count);
            for (var i = 0; i < pos.count; i++) {
                var w = aplicar(m, pos.getX(i), pos.getY(i), pos.getZ(i));
                w = [w[0] * factor, w[1] * factor, w[2] * factor];
                var k = Math.round(w[0] * SOLDAR) + ',' + Math.round(w[1] * SOLDAR) + ',' + Math.round(w[2] * SOLDAR);
                var id = indice.get(k);
                if (id === undefined) { id = vertices.length; indice.set(k, id); vertices.push(w); }
                mapa[i] = id;
            }
            var idx = geo.index, nTri = Math.floor((idx ? idx.count : pos.count) / 3);
            var mats = Array.isArray(mm.mesh.material) ? mm.mesh.material : [mm.mesh.material];
            var grupos = (geo.groups && geo.groups.length) ? geo.groups : null;
            function nombreMat(t) {
                var mi = 0;
                if (grupos) {
                    var g = grupos.find(function (gr) { return t * 3 >= gr.start && t * 3 < gr.start + gr.count; });
                    if (!g) return undefined;   // triángulo fuera de todo grupo: three no lo dibuja
                    mi = g.materialIndex || 0;
                }
                var mat = mats[mi];
                // '__DEFAULT' = material que inventa three.js cuando la pieza no trae ninguno
                return mat && mat.name && mat.name !== '__DEFAULT' ? mat.name : null;
            }
            for (var t = 0; t < nTri; t++) {
                var a = idx ? idx.getX(t * 3) : t * 3, b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
                var cara = [mapa[a], mapa[b], mapa[c]];
                if (cara[0] === cara[1] || cara[1] === cara[2] || cara[0] === cara[2]) continue;
                var nm = nombreMat(t);
                if (nm === undefined) continue;
                caras.push(cara); matsCara.push(nm);
            }
        });
        return { vertices: vertices, caras: caras, matsCara: matsCara };
    }

    function piezaDesde(objPieza, mallas, matrizPieza, cadena, factor, eq, nombreItem, fuenteItem) {
        var d = datosMalla(mallas, factor);
        if (!d.vertices.length || !d.caras.length) return null;
        var med = medidasOrientadas(d.vertices, d.caras, ejesDe(matrizPieza));
        var largo = med[0], ancho = med[1], espesor = med[2];

        var areaPorMat = new Map(), areaTotal = 0;
        d.caras.forEach(function (cara, i) {
            var a = areaPoligono(cara.map(function (k) { return d.vertices[k]; }));
            areaTotal += a;
            var nm = d.matsCara[i];
            areaPorMat.set(nm, (areaPorMat.get(nm) || 0) + a);
        });
        var cerrada = mallaCerrada(d.caras);
        var partes = contarPartes(d.vertices.length, d.caras);
        var volumen = cerrada ? volumenMalla(d.vertices, d.caras) : null;

        var clase = null;
        for (var i = 0; i < cadena.length && !clase; i++) clase = prop(cadena[i], PROPS_CLASE_VW);
        var matsOrd = Array.from(areaPorMat.entries()).sort(function (x, y) { return y[1] - x[1]; })
            .map(function (e) { return e[0]; }).filter(function (m) { return m; });

        var origen = null, fuenteOrigen = null, secundarios = [];
        if (clase) { origen = clase; fuenteOrigen = 'clase'; secundarios = matsOrd.slice(1); }
        else if (matsOrd.length) { origen = normalizarNombre(matsOrd[0]); fuenteOrigen = 'material'; secundarios = matsOrd.slice(1); }

        var motivos = [];
        var datoEq = buscarEquivalencia(origen, eq);
        var material = claveMaterial(datoEq);
        if (origen == null) motivos.push('sin material ni clase de Vectorworks');
        else if (material == null) motivos.push("'" + origen + "' sin equivalencia en equivalencias_vw");
        if (partes > 1) motivos.push(partes + ' partes sueltas en un solo objeto: puede ser más de una pieza');
        if (largo > ESCALA_SOSPECHOSA_M) motivos.push('mide ' + largo.toFixed(1) + ' m: revisar la unidad (¿el modelo está en mm o cm?)');
        if (!cerrada) motivos.push('malla abierta: volumen no calculado');

        var acabados = [];
        secundarios.forEach(function (m) {
            var nm = normalizarNombre(m);
            if (nm === origen) return;
            var claveAc = claveMaterial(buscarEquivalencia(nm, eq));
            acabados.push({ origen_vw: nm, material: claveAc, area_m2: redondear(areaPorMat.get(m)) });
            if (claveAc == null) motivos.push("acabado '" + nm + "' sin equivalencia");
        });
        if (datoEq && typeof datoEq === 'object') {
            (datoEq.acabados || []).forEach(function (ac) {
                acabados.push({ origen_vw: null, material: ac, area_m2: redondear(areaTotal), desde: 'equivalencia' });
            });
        }

        var esPlancha = espesor <= ESPESOR_MAX_PLANCHA;
        var nombre = nombreDe(objPieza);
        return {
            item: nombreItem,
            pieza: normalizarNombre(nombre) || 'Pieza',
            origen_vw: origen,
            material: material,
            cant: 1,
            largo: redondear(largo), ancho: redondear(ancho), espesor: redondear(espesor),
            tipo: esPlancha ? 'plancha' : 'volumen',
            area_m2: redondear(areaTotal),
            area_cara_m2: esPlancha ? redondear(largo * ancho) : null,
            perimetro_ml: esPlancha ? redondear(2 * (largo + ancho)) : null,
            volumen_m3: volumen != null ? redondear(volumen, 6) : null,
            partes: partes,
            acabados: acabados,
            revisar: material == null || acabados.some(function (a) { return a.material == null; }) ||
                partes > 1 || largo > ESCALA_SOSPECHOSA_M,
            motivos: motivos,
            fuente: { item: fuenteItem, origen_vw: fuenteOrigen },
            objetos: [nombre]
        };
    }

    /** Ancestros de `obj` entre él (excluido) y la raíz (excluida), del más alto al más bajo. */
    function ancestros(obj, raiz) {
        var cad = [];
        for (var p = obj.parent; p && p !== raiz; p = p.parent) cad.unshift(p);
        return cad.filter(function (o) { return !esIgnorado(o); });
    }

    /**
     * Recorre la escena y devuelve las piezas sueltas (sin agrupar todavía).
     * opciones: { factor (m por unidad del archivo), equivalencias, incluirOcultos }
     */
    function leerEscena(raiz, opciones) {
        opciones = opciones || {};
        var factor = opciones.factor || 1;
        var eq = cargarEquivalencias(opciones.equivalencias);
        if (raiz.updateMatrixWorld) raiz.updateMatrixWorld(true);

        // 1) Juntar las piezas: cada malla, o el grupo de primitivas de una malla glTF con varios materiales
        var piezas = [], ocultos = [];
        raiz.traverse(function (o) {
            if (o.userData && o.userData.__rubikPieza) {
                var hijas = o.children.filter(function (h) { return h.isMesh && h.userData.__rubikPrimitiva; });
                if (hijas.length) piezas.push({ obj: o, mallas: hijas });
            }
            if (o.isMesh && !o.userData.__rubikPrimitiva) piezas.push({ obj: o, mallas: [o] });
        });

        // 2) Ítems: el padre más alto. Si TODAS las piezas cuelgan del mismo nodo (un "contenedor"
        //    que agrega el exportador o el archivo entero), se baja un nivel.
        var cadenas = piezas.map(function (p) { return ancestros(p.obj, raiz); });
        var comun = 0;
        while (cadenas.length && cadenas.every(function (c) { return c.length > comun + 1 && c[comun] === cadenas[0][comun]; })) comun++;

        var salida = [];
        piezas.forEach(function (p, i) {
            var nombre = nombreDe(p.obj);
            if (!opciones.incluirOcultos && !visibleEnCadena(p.obj, raiz)) {
                if (ocultos.indexOf(nombre) < 0) ocultos.push(nombre);
                return;
            }
            var cad = cadenas[i];
            var item = null, fuenteItem = 'ninguno';
            var arriba = [p.obj].concat(cad.slice().reverse());
            for (var k = 0; k < arriba.length && !item; k++) { item = prop(arriba[k], PROPS_ITEM); if (item) fuenteItem = 'propiedad'; }
            if (!item && cad.length > comun) { item = normalizarNombre(nombreDe(cad[comun])); fuenteItem = 'padre'; }
            if (!item) item = SIN_ITEM;

            var instancias = (p.obj.isInstancedMesh && p.obj.count) ? p.obj.count : 0;
            var base = p.obj.matrixWorld.elements;
            var n = instancias || 1;
            for (var j = 0; j < n; j++) {
                var matriz = base;
                if (instancias) {
                    var im = p.obj.instanceMatrix.array.slice(j * 16, j * 16 + 16);
                    matriz = matMul(base, im);
                }
                var mallas = p.mallas.map(function (m) {
                    return { mesh: m, matriz: m === p.obj ? matriz : matMul(matriz, m.matrix.elements) };
                });
                var pz = piezaDesde(p.obj, mallas, matriz, [p.obj].concat(cad.slice().reverse()), factor, eq, item, fuenteItem);
                if (pz) salida.push(pz);
            }
        });
        return { piezas: salida, ocultos: ocultos.sort() };
    }

    function armarResultado(piezas, proyecto, archivo, salteados) {
        var agrupadas = agruparPiezas(piezas);
        var items = [];
        agrupadas.forEach(function (p) { if (items.indexOf(p.item) < 0) items.push(p.item); });
        var aRevisar = agrupadas.filter(function (p) { return p.revisar; });
        var sinEq = Array.from(new Set(agrupadas.filter(function (p) { return p.origen_vw && p.material == null; })
            .map(function (p) { return p.origen_vw; }))).sort();
        var total = agrupadas.reduce(function (s, p) { return s + p.cant; }, 0);
        var resumen = agrupadas.length + ' piezas distintas (' + total + ' en total) en ' + items.length +
            ' ítems. ' + aRevisar.length + ' para revisar.';
        if (sinEq.length) resumen += ' Sin equivalencia: ' + sinEq.join(', ') + '.';
        return {
            formato: FORMATO,
            proyecto: proyecto || 'sin-nombre',
            archivo: archivo || null,
            generado: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'),
            unidad: 'm',
            items: items,
            piezas: agrupadas,
            sin_equivalencia: sinEq,
            ocultos_salteados: salteados || [],
            resumen: resumen
        };
    }

    /** Punto de entrada: escena three.js → rubik/1. */
    function analizar(raiz, opciones) {
        opciones = opciones || {};
        var r = leerEscena(raiz, opciones);
        return armarResultado(r.piezas, opciones.proyecto, opciones.archivo, r.ocultos);
    }

    // ---------------------------------------------------------------------
    // Unidades
    // ---------------------------------------------------------------------
    var FACTORES = { mm: 0.001, cm: 0.01, m: 1 };

    /** Tamaño total (en unidades del archivo) de lo visible. */
    function tamanoEscena(raiz) {
        if (raiz.updateMatrixWorld) raiz.updateMatrixWorld(true);
        var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        raiz.traverse(function (o) {
            if (!o.isMesh || !visibleEnCadena(o, raiz)) return;
            var pos = o.geometry && o.geometry.attributes.position;
            if (!pos) return;
            var m = o.matrixWorld.elements;
            for (var i = 0; i < pos.count; i++) {
                var w = aplicar(m, pos.getX(i), pos.getY(i), pos.getZ(i));
                for (var k = 0; k < 3; k++) { if (w[k] < mn[k]) mn[k] = w[k]; if (w[k] > mx[k]) mx[k] = w[k]; }
            }
        });
        if (mn[0] === Infinity) return [0, 0, 0];
        return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    }

    /**
     * Unidad del archivo.
     *   - FBX: GlobalSettings.UnitScaleFactor (cm por unidad), que FBXLoader deja en userData.unitScaleFactor.
     *   - glTF: el estándar dice metros.
     * Si el tamaño total no tiene sentido para un mueble o stand (más de 200 en la unidad elegida),
     * se sugiere la unidad más chica que lo deja razonable. El usuario siempre puede cambiarla.
     */
    function detectarUnidad(raiz, tipo) {
        var tam = tamanoEscena(raiz), mayor = Math.max(tam[0], tam[1], tam[2]);
        var unidad = 'm', motivo = 'glTF siempre viene en metros';
        if (tipo === 'fbx') {
            var usf = raiz.userData && Number(raiz.userData.unitScaleFactor);
            if (usf > 0) {
                var mPorU = usf / 100, mejor = 'm', dif = Infinity;
                Object.keys(FACTORES).forEach(function (u) {
                    var d = Math.abs(Math.log(FACTORES[u] / mPorU));
                    if (d < dif) { dif = d; mejor = u; }
                });
                unidad = mejor; motivo = 'el FBX dice 1 unidad = ' + redondear(usf, 4) + ' cm';
            } else { unidad = 'cm'; motivo = 'el FBX no dice la unidad; se asume cm'; }
        }
        if (mayor * FACTORES[unidad] > 200) {
            var alt = mayor * 0.01 <= 200 ? 'cm' : 'mm';
            if (mayor * FACTORES[alt] > 200) alt = 'mm';
            motivo += '; mide ' + Math.round(mayor) + ' unidades, se toma ' + alt;
            unidad = alt;
        }
        return { unidad: unidad, factor: FACTORES[unidad], motivo: motivo, tamano: tam };
    }

    // ---------------------------------------------------------------------
    // rubik.json del exportador de Blender
    // ---------------------------------------------------------------------
    function desdeRubikJson(json, equivalencias) {
        if (!json || json.formato !== FORMATO || !Array.isArray(json.piezas)) {
            throw new Error('No es un rubik.json (formato ' + FORMATO + ').');
        }
        var r = JSON.parse(JSON.stringify(json));
        var eq = cargarEquivalencias(equivalencias);
        r.piezas.forEach(function (p) { resolverMateriales(p, eq); });
        r.sin_equivalencia = Array.from(new Set(r.piezas.filter(function (p) { return p.origen_vw && p.material == null; })
            .map(function (p) { return p.origen_vw; }))).sort();
        return r;
    }

    /** Completa material y acabados que no tenían equivalencia con la tabla actual (sin pisar lo que ya tiene). */
    function resolverMateriales(p, eq) {
        if (p.material == null && p.origen_vw) {
            var dato = buscarEquivalencia(p.origen_vw, eq);
            p.material = claveMaterial(dato);
            if (p.material && dato && typeof dato === 'object') {
                (dato.acabados || []).forEach(function (ac) {
                    if (!(p.acabados || []).some(function (a) { return a.material === ac; })) {
                        (p.acabados = p.acabados || []).push({ origen_vw: null, material: ac, area_m2: p.area_m2, desde: 'equivalencia' });
                    }
                });
            }
        }
        (p.acabados || []).forEach(function (a) {
            if (a.material == null && a.origen_vw) a.material = claveMaterial(buscarEquivalencia(a.origen_vw, eq));
        });
        p.revisar = p.material == null || (p.acabados || []).some(function (a) { return a.material == null; }) ||
            (p.partes || 1) > 1 || p.largo > ESCALA_SOSPECHOSA_M;
        return p;
    }

    // ---------------------------------------------------------------------
    // Del desglose al presupuesto
    // ---------------------------------------------------------------------
    function sugerirDescarte(texto) { return RE_ENTORNO.test(String(texto || '').replace(/[\s_.\-]+/g, ' ')); }

    function medidaDePieza(p) {
        return {
            c: p.cant, l: redondear(p.largo), a: redondear(p.ancho), h: redondear(p.espesor), p: 0,
            desc: p.pieza + ' · ' + (p.origen_vw || 'sin material')
        };
    }
    function modoMedidas(piezas) {
        return piezas.length && piezas.every(function (p) { return p.tipo === 'plancha'; }) ? 'plancha' : 'volumen';
    }

    function familiaUnidad(u) {
        var s = String(u || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/²/g, '2').replace(/³/g, '3').replace(/[\s.]/g, '');
        if (['m2', 'mt2', 'mts2', 'metro2', 'metros2', 'metrocuadrado', 'metroscuadrados'].indexOf(s) >= 0) return 'm2';
        if (['m3', 'mt3', 'mts3', 'metro3', 'metrocubico', 'metroscubicos'].indexOf(s) >= 0) return 'm3';
        if (['ml', 'm', 'mt', 'mts', 'metro', 'metros', 'metrolineal', 'metroslineales'].indexOf(s) >= 0) return 'ml';
        if (['und', 'u', 'un', 'unid', 'unidad', 'unidades', 'pza', 'pz', 'pieza', 'piezas'].indexOf(s) >= 0) return 'und';
        return null;
    }

    function fmt(x, d) { return (Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).toString(); }

    /**
     * Cantidad de un material principal para un grupo de piezas, según la unidad del catálogo.
     * Devuelve { q, motivo } — si no se puede sin un rendimiento, q = 0 y el motivo explica qué falta.
     */
    function cantidadPrincipal(piezas, unidad) {
        var fam = familiaUnidad(unidad), q = 0, i, p;
        var neto = piezas.reduce(function (s, x) { return s + (x.tipo === 'plancha' ? x.area_cara_m2 * x.cant : 0); }, 0);
        if (fam === 'und') { q = piezas.reduce(function (s, x) { return s + x.cant; }, 0); return { q: q, nota: q + ' piezas' }; }
        if (fam === 'ml') {
            q = piezas.reduce(function (s, x) { return s + x.largo * x.cant; }, 0);
            return { q: redondear(q, 3), nota: 'suma de largos: ' + fmt(q, 3) + ' ml' };
        }
        if (fam === 'm2') {
            for (i = 0; i < piezas.length; i++) {
                p = piezas[i];
                if (p.tipo !== 'plancha') return { q: 0, motivo: 'pieza de volumen ("' + p.pieza + '"): definir qué caras cuentan como m²' };
            }
            return { q: redondear(neto, 4), nota: 'una cara de cada plancha: ' + fmt(neto, 3) + ' m² (sin desperdicio)' };
        }
        if (fam === 'm3') {
            for (i = 0; i < piezas.length; i++) {
                if (piezas[i].volumen_m3 == null) return { q: 0, motivo: 'malla abierta en "' + piezas[i].pieza + '": sin volumen' };
                q += piezas[i].volumen_m3 * piezas[i].cant;
            }
            return { q: redondear(q, 5), nota: 'volumen: ' + fmt(q, 4) + ' m³' };
        }
        var detalle = neto > 0 ? ' (piezas: ' + fmt(neto, 3) + ' m² netos; usar CÓMPUTO para el plano de corte)' : '';
        return { q: 0, motivo: 'falta el rendimiento para la unidad "' + (unidad || '?') + '"' + detalle };
    }

    function cantidadAcabado(filas, unidad) {   // filas: [{pieza, acabado}]
        var fam = familiaUnidad(unidad);
        var area = filas.reduce(function (s, f) { return s + (f.acabado.area_m2 || 0) * f.pieza.cant; }, 0);
        if (fam === 'm2') return { q: redondear(area, 4), nota: 'superficie del acabado: ' + fmt(area, 3) + ' m²' };
        var per = filas.reduce(function (s, f) { return s + (f.pieza.perimetro_ml || 0) * f.pieza.cant; }, 0);
        if (fam === 'ml') return { q: 0, motivo: 'definir los ml (qué lados llevan canto; perímetro total: ' + fmt(per, 2) + ' ml)' };
        return { q: 0, motivo: 'falta el rendimiento para la unidad "' + (unidad || '?') + '" (superficie: ' + fmt(area, 3) + ' m²)' };
    }

    function precioDe(m) { var p = parseFloat(m && (m.p != null ? m.p : m.pu)); return isFinite(p) && p > 0 ? Math.round(p * 100) / 100 : 0; }

    /**
     * APU de materiales de un ítem a partir de sus piezas.
     * catalogo = /base_datos/materiales ({clave: {n|desc, u|und, p|pu}}).
     * Una fila por material principal y otra por acabado. Sin precio o sin rendimiento: q/p en 0 y `revisar`.
     */
    function armarApuMateriales(piezas, catalogo) {
        catalogo = catalogo || {};
        var principales = new Map(), acabados = new Map(), sinVincular = new Map();
        piezas.forEach(function (p) {
            if (p.material) {
                if (!principales.has(p.material)) principales.set(p.material, []);
                principales.get(p.material).push(p);
            } else {
                var k = p.origen_vw || 'Sin material';
                if (!sinVincular.has(k)) sinVincular.set(k, []);
                sinVincular.get(k).push(p);
            }
            (p.acabados || []).forEach(function (a) {
                var k2 = a.material ? 'M:' + a.material : 'O:' + (a.origen_vw || '?');
                if (!acabados.has(k2)) acabados.set(k2, []);
                acabados.get(k2).push({ pieza: p, acabado: a });
            });
        });

        var filas = [];
        function fila(clave, cat, calc, piezasFila, extra) {
            var u = cat ? (cat.u || cat.und || 'und') : 'und';
            var p = cat ? precioDe(cat) : 0;
            var motivos = [];
            if (!cat) { if (!calc.motivo) motivos.push(clave ? '"' + clave + '" no está en el catálogo' : 'material sin vincular'); }
            else if (!p) motivos.push('sin precio en la base');
            if (calc.motivo) motivos.push(calc.motivo);
            var r = Object.assign({
                d: cat ? (cat.n || cat.desc || clave) : (extra && extra.d) || clave,
                u: u, q: calc.q || 0, p: p, origen: '3d', clave: clave || null
            }, extra || {});
            if (calc.nota) r.nota = calc.nota;
            if (motivos.length) r.revisar = motivos.join(' · ');
            if (piezasFila) { r.measures = piezasFila.map(medidaDePieza); r.measures_modo = modoMedidas(piezasFila); }
            // Material que propuso la IA leyendo el PDF y el dueño aceptó: queda marcado con su confianza
            var deIA = (piezasFila || []).filter(function (x) { return x.material_desde === 'pdf_ia'; });
            if (deIA.length) {
                r.segun = 'PDF (IA)';
                r.confianza = deIA.map(function (x) { return x.material_confianza || 'baja'; })
                    .sort(function (a, b) { return CONF.indexOf(a) - CONF.indexOf(b); })[0];
                r.nota = 'material según PDF (IA), confianza ' + r.confianza + (r.nota ? ' · ' + r.nota : '');
            }
            filas.push(r);
        }
        principales.forEach(function (ps, clave) {
            var cat = catalogo[clave];
            fila(clave, cat, cat ? cantidadPrincipal(ps, cat.u || cat.und) : { q: 0 }, ps);
        });
        acabados.forEach(function (fs, k) {
            var clave = k.indexOf('M:') === 0 ? k.slice(2) : null;
            if (!clave) {
                fila(null, null, { q: 0, motivo: 'acabado "' + k.slice(2) + '" sin vincular' }, null, { d: k.slice(2) });
                return;
            }
            var cat = catalogo[clave];
            fila(clave, cat, cat ? cantidadAcabado(fs, cat.u || cat.und) : { q: 0 }, null, { acabado: true });
        });
        sinVincular.forEach(function (ps, nombre) {
            fila(null, null, { q: 0, motivo: '"' + nombre + '" sin vincular a la base' }, ps, { d: nombre });
        });
        return filas;
    }

    function calcPu(apu) {
        var mo = 0, dir = 0;
        (apu.mo || []).forEach(function (x) { mo += (parseFloat(x.q) || 0) * (parseFloat(x.p) || 0); });
        dir = mo + mo * (parseFloat(apu.cs) || 0) / 100;
        ['mat', 'eq', 'sub'].forEach(function (t) { (apu[t] || []).forEach(function (x) { dir += (parseFloat(x.q) || 0) * (parseFloat(x.p) || 0); }); });
        return Math.round(dir * (1 + (parseFloat(apu.ind) || 0) / 100) * (1 + (parseFloat(apu.util) || 0) / 100) * 100) / 100;
    }

    /**
     * Ítems nuevos del presupuesto a partir de las piezas revisadas (ya sin las descartadas).
     * nuevoId(): genera un id estable (en la app, un push id de Firebase).
     * El orden de los ítems es el de `nombresItems`. Se agregan AL FINAL: no se reordena nada.
     */
    function armarItems(piezas, nombresItems, catalogo, nuevoId, meta) {
        meta = meta || {};
        return nombresItems.map(function (nombre) {
            var ps = piezas.filter(function (p) { return p.item === nombre; });
            if (!ps.length) return null;
            var apu = { mat: armarApuMateriales(ps, catalogo), mo: [], eq: [], sub: [], util: 50, ind: 10, cs: 55 };
            var pendientes = apu.mat.filter(function (r) { return r.revisar; }).length;
            var item = {
                type: 'item', id: nuevoId(), origen: '3d',
                desc: nombre, und: 'glb', cant: 1, pu: calcPu(apu), feat: '',
                apu: apu,
                measures: ps.map(medidaDePieza), measures_modo: modoMedidas(ps),
                import3d: {
                    archivo: meta.archivo || null, fecha: meta.fecha || Date.now(), unidad_archivo: meta.unidad || null,
                    pdf: meta.pdf || null,
                    piezas: ps.reduce(function (s, p) { return s + p.cant; }, 0), filas_a_revisar: pendientes
                }
            };
            return JSON.parse(JSON.stringify(item));   // sin undefined (Firebase no los acepta)
        }).filter(Boolean);
    }

    // ---------------------------------------------------------------------
    // PDF del cliente → IA → propuestas (nunca se aplican solas)
    // ---------------------------------------------------------------------
    var CONF = ['baja', 'media', 'alta'];
    function normConf(c) { c = String(c || '').toLowerCase(); return CONF.indexOf(c) >= 0 ? c : 'baja'; }
    function numOnull(x) { var n = parseFloat(x); return isFinite(n) && n > 0 ? n : null; }
    function textoComparable(s) {
        return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, ' ').trim();
    }

    /**
     * Cuerpo para /api/gemini (mismo proxy y modelo que "Presupuesto IA").
     * datos: { texto, imagenes: [base64 jpeg sin prefijo], piezas: filas del lector, tamano_mm: [x,y,z], catalogo }
     */
    function armarPedidoPDF(datos) {
        var piezas = (datos.piezas || []).map(function (p) {
            return '- "' + p.pieza + '" × ' + p.cant + ': ' + Math.round(p.largo * 1000) + ' × ' + Math.round(p.ancho * 1000) + ' × ' +
                Math.round(p.espesor * 1000) + ' mm' + (p.origen_vw ? ' (material en el 3D: ' + p.origen_vw + ')' : ' (sin material en el 3D)');
        }).join('\n');
        var cat = Object.keys(datos.catalogo || {}).slice(0, 600).map(function (k) {
            var m = datos.catalogo[k]; return k + ' = ' + (m.n || m.desc || k) + (m.u ? ' [' + m.u + ']' : '');
        }).join('\n');
        var sys = [
            'Leés el PDF descriptivo o de planos que mandó un cliente para cotizar una pieza de carpintería/metalmecánica (mueble, stand, trofeo, exhibidor).',
            'El modelo 3D del cliente trae la geometría pero puede no estar a escala y no trae materiales. Tu trabajo es sacar del PDF lo que el 3D no trae.',
            'REGLAS: no inventes. Si un dato no está en el PDF, poné null. Medidas siempre en milímetros.',
            'confianza: "alta" = escrito tal cual en el PDF; "media" = deducido de una cota o de la escala del plano; "baja" = interpretación dudosa.',
            'cita: el texto o la cota del PDF de donde sale el dato (corto). pagina: número de página del PDF donde está.',
            'medidas_generales: las medidas TOTALES del objeto terminado (alto, ancho, fondo), no las de una pieza.',
            'pieza_3d: si la pieza del PDF es una de las piezas del modelo 3D, su nombre EXACTO de la lista; si no, null.',
            'material_clave: SOLO una clave de la lista del catálogo que corresponda al material descripto; si ninguna corresponde, null (y describilo en material_texto).',
            'Devolvé SOLO este JSON, sin texto antes ni después:',
            '{"medidas_generales":{"alto_mm":null,"ancho_mm":null,"fondo_mm":null,"confianza":"alta","cita":"","pagina":null},' +
            '"piezas":[{"nombre_pdf":"","pieza_3d":null,"largo_mm":null,"ancho_mm":null,"espesor_mm":null,"cantidad":null,' +
            '"material_texto":null,"material_clave":null,"acabados":[],"confianza":"media","cita":""}],"notas":""}'
        ].join('\n');
        var partes = [{ text: 'PIEZAS DEL MODELO 3D (medidas tal como vienen en el archivo, quizás sin escala):\n' + (piezas || '(ninguna)') +
            (datos.tamano_mm ? '\nTamaño total del modelo: ' + datos.tamano_mm.map(Math.round).join(' × ') + ' mm' : '') }];
        partes.push({ text: 'CATÁLOGO DE MATERIALES (clave = nombre [unidad]):\n' + (cat || '(vacío)') });
        partes.push({ text: 'TEXTO DEL PDF:\n' + (String(datos.texto || '').slice(0, 30000) || '(sin texto: ver las imágenes)') });
        (datos.imagenes || []).forEach(function (b64, i) {
            partes.push({ text: '[Página ' + (i + 1) + ' del PDF como imagen]' });
            partes.push({ inlineData: { data: b64, mimeType: 'image/jpeg' } });
        });
        return {
            model: 'gemini-2.5-flash',
            systemInstruction: { parts: [{ text: sys }] },
            contents: [{ role: 'user', parts: partes }],
            generationConfig: { maxOutputTokens: 8000, temperature: 0, responseMimeType: 'application/json' }
        };
    }

    /** Respuesta de /api/gemini → datos normalizados (o error claro). */
    function leerRespuestaPDF(resp) {
        var txt = resp && resp.candidates && resp.candidates[0] && resp.candidates[0].content &&
            (resp.candidates[0].content.parts || []).map(function (p) { return p.text || ''; }).join('');
        if (!txt) throw new Error('La IA no devolvió nada.');
        txt = txt.replace(/```json|```/g, '').trim();
        var a = txt.indexOf('{'), b = txt.lastIndexOf('}');
        var d = JSON.parse(txt.slice(a, b + 1));
        var g = d.medidas_generales || {};
        return {
            medidas_generales: {
                alto_mm: numOnull(g.alto_mm), ancho_mm: numOnull(g.ancho_mm), fondo_mm: numOnull(g.fondo_mm),
                confianza: normConf(g.confianza), cita: String(g.cita || '').slice(0, 200),
                pagina: numOnull(g.pagina) ? Math.round(numOnull(g.pagina)) : null
            },
            piezas: (Array.isArray(d.piezas) ? d.piezas : []).map(function (p) {
                return {
                    nombre_pdf: String(p.nombre_pdf || '').trim(), pieza_3d: p.pieza_3d ? String(p.pieza_3d).trim() : null,
                    largo_mm: numOnull(p.largo_mm), ancho_mm: numOnull(p.ancho_mm), espesor_mm: numOnull(p.espesor_mm),
                    cantidad: numOnull(p.cantidad) ? Math.round(numOnull(p.cantidad)) : null,
                    material_texto: p.material_texto ? String(p.material_texto) : null,
                    material_clave: p.material_clave ? String(p.material_clave) : null,
                    acabados: Array.isArray(p.acabados) ? p.acabados.map(String) : [],
                    confianza: normConf(p.confianza), cita: String(p.cita || '').slice(0, 200)
                };
            }),
            notas: String(d.notas || '').slice(0, 1000)
        };
    }

    /** Fila del 3D que corresponde a una pieza del PDF: nombre exacto (sin mayúsculas ni espacios), o por palabras. */
    function buscarFila(filas, pz) {
        var objetivo = textoComparable(pz.pieza_3d || pz.nombre_pdf);
        if (!objetivo) return null;
        var exacta = filas.find(function (f) { return textoComparable(f.pieza) === objetivo; });
        if (exacta) return exacta;
        var pal = objetivo.split(' ').filter(function (w) { return w.length > 2; });
        var mejor = null, puntos = 0;
        filas.forEach(function (f) {
            var fp = textoComparable(f.pieza).split(' ');
            var n = pal.filter(function (w) { return fp.indexOf(w) >= 0; }).length;
            if (n > puntos) { puntos = n; mejor = f; }
        });
        return puntos > 0 && puntos >= Math.ceil(pal.length / 2) ? mejor : null;
    }

    /**
     * Propuestas para confirmar una por una. No cambia nada.
     *   escala: la medida mayor del PDF contra la mayor del modelo (factor relativo)
     *   material: clave del catálogo para una pieza sin material (solo si la clave existe)
     *   cantidad / medida: lo que dice el PDF de cada pieza
     * tamanoM: tamaño total del modelo en metros con la escala actual.
     */
    function propuestasPDF(info, filas, tamanoM, catalogo) {
        var out = [];
        var g = info.medidas_generales || {};
        var nombres = { alto_mm: 'alto total', ancho_mm: 'ancho total', fondo_mm: 'fondo total' };
        var genN = ['alto_mm', 'ancho_mm', 'fondo_mm'].filter(function (k) { return g[k]; })
            .map(function (k) { return { mm: g[k], nombre: nombres[k] }; }).sort(function (a, b) { return b.mm - a.mm; });
        var gen = genN.map(function (x) { return x.mm; });
        var mod = (tamanoM || []).map(function (x) { return x * 1000; }).sort(function (a, b) { return b - a; });
        if (gen.length && mod[0] > 0) {
            var r = gen[0] / mod[0];
            var conf = g.confianza;
            // Si hay dos medidas y la segunda escala distinto (>10 %), baja la confianza
            if (gen.length > 1 && mod[1] > 0 && Math.abs(gen[1] / mod[1] / r - 1) > 0.1) conf = 'baja';
            if (Math.abs(r - 1) > 0.02) {
                out.push({
                    tipo: 'escala', factor: r, confianza: conf, cita: g.cita, pagina: g.pagina,
                    dimension: genN[0].nombre, mm: Math.round(gen[0]),
                    texto: 'Medida mayor según el PDF: ' + Math.round(gen[0]) + ' mm. En el modelo: ' + Math.round(mod[0]) +
                        ' mm. Escalar todo ×' + (r < 0.01 ? r.toExponential(2) : r.toFixed(4)) + '.'
                });
            }
        }
        (info.piezas || []).forEach(function (pz) {
            var f = buscarFila(filas, pz);
            var nombre = f ? f.pieza : null;
            if (pz.material_clave || pz.material_texto) {
                var cat = pz.material_clave && catalogo && catalogo[pz.material_clave];
                out.push({
                    tipo: 'material', pieza: nombre, nombre_pdf: pz.nombre_pdf, clave: cat ? pz.material_clave : null,
                    confianza: pz.confianza, cita: pz.cita, aplicable: !!(f && cat),
                    texto: (nombre ? '"' + nombre + '"' : '"' + pz.nombre_pdf + '" (no se encontró en el 3D)') + ': ' +
                        (cat ? (cat.n || cat.desc || pz.material_clave) : 'material "' + (pz.material_texto || pz.material_clave) + '" — no está en la base, vincularlo a mano') +
                        (pz.acabados.length ? ' · acabados: ' + pz.acabados.join(', ') : '')
                });
            }
            if (f && pz.cantidad && pz.cantidad !== f.cant) {
                out.push({ tipo: 'cantidad', pieza: nombre, cantidad: pz.cantidad, confianza: pz.confianza, cita: pz.cita, aplicable: true,
                    texto: '"' + nombre + '": ' + pz.cantidad + ' unidades según el PDF (el 3D tiene ' + f.cant + ').' });
            }
            if (f && pz.largo_mm) {
                var dims = [pz.largo_mm, pz.ancho_mm, pz.espesor_mm].filter(Boolean).sort(function (a, b) { return b - a; });
                var difiere = Math.abs(dims[0] / (f.largo * 1000) - 1) > 0.02;
                if (difiere) {
                    out.push({ tipo: 'medida', pieza: nombre, largo_mm: dims[0], confianza: pz.confianza, cita: pz.cita, aplicable: true,
                        texto: '"' + nombre + '" mide ' + dims.map(Math.round).join(' × ') + ' mm según el PDF (en el modelo: ' +
                            Math.round(f.largo * 1000) + ' × ' + Math.round(f.ancho * 1000) + ' × ' + Math.round(f.espesor * 1000) + ' mm). Calibrar la escala con esta pieza.' });
                }
            }
        });
        return out;
    }

    var api = {
        FORMATO: FORMATO, SIN_ITEM: SIN_ITEM, FACTORES: FACTORES, ESPESOR_MAX_PLANCHA: ESPESOR_MAX_PLANCHA,
        medidasOrientadas: medidasOrientadas, areaPoligono: areaPoligono, volumenMalla: volumenMalla, mallaCerrada: mallaCerrada, contarPartes: contarPartes,
        normalizarNombre: normalizarNombre, claveEquivalencia: claveEquivalencia, cargarEquivalencias: cargarEquivalencias,
        buscarEquivalencia: buscarEquivalencia, agruparPiezas: agruparPiezas,
        prepararGLTF: prepararGLTF, pluginSinTexturas: pluginSinTexturas, modificadorURL: modificadorURL, PIXEL: PIXEL, leerPropiedadesFBX: leerPropiedadesFBX, aplicarPropiedadesFBX: aplicarPropiedadesFBX, leerEscena: leerEscena, armarResultado: armarResultado, analizar: analizar,
        tamanoEscena: tamanoEscena, detectarUnidad: detectarUnidad,
        desdeRubikJson: desdeRubikJson, resolverMateriales: resolverMateriales,
        sugerirDescarte: sugerirDescarte, familiaUnidad: familiaUnidad, cantidadPrincipal: cantidadPrincipal,
        armarApuMateriales: armarApuMateriales,
        armarPedidoPDF: armarPedidoPDF, leerRespuestaPDF: leerRespuestaPDF, propuestasPDF: propuestasPDF, buscarFila: buscarFila, armarItems: armarItems, calcPu: calcPu, medidaDePieza: medidaDePieza
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else global.Lector3D = api;
})(typeof window !== 'undefined' ? window : globalThis);
