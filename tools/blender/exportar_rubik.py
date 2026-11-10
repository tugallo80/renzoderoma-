"""
exportar_rubik.py — Lee la escena de Blender y escribe `rubik.json` para cotizar en Rubik.

Lo corre Claude dentro de Blender, por MCP, en la PC del dueño (ver `LEEME.md`).
Las medidas, cantidades y materiales salen del modelo. El script NO inventa nada:
si una pieza no tiene material vinculado, queda con `revisar: true` y el motivo.

Uso dentro de Blender (consola de Python o el MCP):

    exec(open(r"C:/ruta/al/repo/tools/blender/exportar_rubik.py", encoding="utf-8").read())
    resultado = exportar(
        ruta_salida=r"C:/trabajos/stand/rubik.json",          # opcional: por defecto, al lado del .blend
        equivalencias=r"C:/trabajos/equivalencias_vw.json",     # opcional: {"MDF-18-Blanco": "MDF_18_BLANCO"}
        proyecto="stand-feria-2026",                            # opcional: por defecto, el nombre del .blend
    )
    print(resultado["resumen"])

Formato del JSON: ver `docs/sesiones/02-cotizacion.md` (sección "Formato de rubik.json").
Las funciones de geometría (`medidas_orientadas`, etc.) son Python puro, para poder probarlas sin Blender.
"""

import json
import math
import os
import re
from datetime import datetime, timezone

FORMATO = "rubik/1"

# Por debajo de este espesor (m) la pieza se considera "plancha" (tablero, chapa, vidrio…)
ESPESOR_MAX_PLANCHA = 0.06
# Redondeo para agrupar piezas iguales (m). 1 mm.
TOLERANCIA_AGRUPAR = 0.001

# Propiedades personalizadas donde puede venir la clase de Vectorworks (IFC, FBX con datos, o cargadas a mano).
# Se buscan en el objeto, después en sus padres, en ese orden. Comparación sin mayúsculas.
PROPS_CLASE_VW = ("vw_clase", "vw_class", "clase", "class", "ifcclass_vw", "layer", "capa")
# Propiedad opcional para forzar el ítem del presupuesto desde Vectorworks o a mano.
PROPS_ITEM = ("rubik_item", "item")
# Nombres de colección que no cuentan como ítem (las crean los importadores).
COLECCIONES_IGNORADAS = {"scene collection", "collection", "colección", "coleccion"}


# ---------------------------------------------------------------------------
# Geometría pura (sin bpy)
# ---------------------------------------------------------------------------

def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norm(a):
    return math.sqrt(_dot(a, a))


def _unit(a):
    n = _norm(a)
    return (a[0] / n, a[1] / n, a[2] / n) if n > 1e-12 else None


def area_poligono(puntos):
    """Área de un polígono plano 3D (lista de (x,y,z))."""
    if len(puntos) < 3:
        return 0.0
    acc = (0.0, 0.0, 0.0)
    p0 = puntos[0]
    for i in range(1, len(puntos) - 1):
        c = _cross(_sub(puntos[i], p0), _sub(puntos[i + 1], p0))
        acc = (acc[0] + c[0], acc[1] + c[1], acc[2] + c[2])
    return _norm(acc) / 2.0


def normal_poligono(puntos):
    acc = (0.0, 0.0, 0.0)
    p0 = puntos[0]
    for i in range(1, len(puntos) - 1):
        c = _cross(_sub(puntos[i], p0), _sub(puntos[i + 1], p0))
        acc = (acc[0] + c[0], acc[1] + c[1], acc[2] + c[2])
    return _unit(acc)


def volumen_malla(vertices, caras):
    """Volumen con signo por el teorema de la divergencia. Válido si la malla es cerrada."""
    v = 0.0
    for cara in caras:
        p0 = vertices[cara[0]]
        for i in range(1, len(cara) - 1):
            v += _dot(p0, _cross(vertices[cara[i]], vertices[cara[i + 1]])) / 6.0
    return abs(v)


def malla_cerrada(caras):
    """Cada arista compartida por exactamente dos caras."""
    if not caras:
        return False
    cuenta = {}
    for cara in caras:
        n = len(cara)
        for i in range(n):
            a, b = cara[i], cara[(i + 1) % n]
            k = (a, b) if a < b else (b, a)
            cuenta[k] = cuenta.get(k, 0) + 1
    return all(c == 2 for c in cuenta.values())


def _base_desde(eje):
    """Dos ejes perpendiculares a `eje` (unitario)."""
    aux = (1.0, 0.0, 0.0) if abs(eje[0]) < 0.9 else (0.0, 1.0, 0.0)
    u = _unit(_cross(eje, aux))
    w = _cross(eje, u)
    return u, w


def _casco_2d(puntos):
    """Casco convexo (monotone chain). puntos: lista de (x,y)."""
    pts = sorted(set((round(p[0], 9), round(p[1], 9)) for p in puntos))
    if len(pts) <= 2:
        return pts

    def cr(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    inf, sup = [], []
    for p in pts:
        while len(inf) >= 2 and cr(inf[-2], inf[-1], p) <= 0:
            inf.pop()
        inf.append(p)
    for p in reversed(pts):
        while len(sup) >= 2 and cr(sup[-2], sup[-1], p) <= 0:
            sup.pop()
        sup.append(p)
    return inf[:-1] + sup[:-1]


def _rect_minimo_2d(puntos):
    """Rectángulo de área mínima que contiene los puntos 2D. Devuelve (lado_a, lado_b)."""
    casco = _casco_2d(puntos)
    if len(casco) == 0:
        return 0.0, 0.0
    if len(casco) <= 2:
        if len(casco) == 2:
            return math.dist(casco[0], casco[1]), 0.0
        return 0.0, 0.0
    mejor = None
    n = len(casco)
    for i in range(n):
        p, q = casco[i], casco[(i + 1) % n]
        dx, dy = q[0] - p[0], q[1] - p[1]
        L = math.hypot(dx, dy)
        if L < 1e-12:
            continue
        ux, uy = dx / L, dy / L
        a_s = [x * ux + y * uy for x, y in casco]
        b_s = [-x * uy + y * ux for x, y in casco]
        la, lb = max(a_s) - min(a_s), max(b_s) - min(b_s)
        if mejor is None or la * lb < mejor[0] * mejor[1] - 1e-15:
            mejor = (la, lb)
    return mejor or (0.0, 0.0)


def _extension(vertices, eje):
    s = [_dot(v, eje) for v in vertices]
    return max(s) - min(s)


def medidas_orientadas(vertices, caras, ejes_locales=None):
    """
    Largo, ancho y espesor (m) de la caja más ajustada a la pieza, sin importar cómo esté girada.

    Prueba dos candidatos y se queda con el de menor volumen:
      1. Los ejes del objeto (`ejes_locales`, si vienen): sirve cuando Vectorworks exporta la pieza
         con su rotación en el objeto.
      2. El eje de la cara más grande como "espesor", y en ese plano el rectángulo mínimo
         (sirve cuando la rotación quedó "horneada" en los vértices).
    Devuelve (largo, ancho, espesor) ordenados de mayor a menor.
    """
    if not vertices:
        return (0.0, 0.0, 0.0)
    candidatos = []
    if ejes_locales:
        dims = [_extension(vertices, e) for e in ejes_locales]
        candidatos.append(dims)

    # Agrupar áreas por dirección de normal (caras coplanares o paralelas suman juntas).
    por_dir = {}
    for cara in caras:
        pts = [vertices[i] for i in cara]
        a = area_poligono(pts)
        if a < 1e-12:
            continue
        n = normal_poligono(pts)
        if n is None:
            continue
        # misma dirección sin importar el sentido (n y -n cuentan juntas)
        k = tuple(round(c, 3) + 0.0 for c in n)
        clave = max(k, tuple(-c + 0.0 for c in k))
        ac, nv = por_dir.get(clave, (0.0, n))
        por_dir[clave] = (ac + a, nv)
    for _, (_, eje) in sorted(por_dir.items(), key=lambda kv: -kv[1][0])[:3]:
        u, w = _base_desde(eje)
        pts2 = [(_dot(v, u), _dot(v, w)) for v in vertices]
        la, lb = _rect_minimo_2d(pts2)
        candidatos.append([la, lb, _extension(vertices, eje)])

    if not candidatos:
        # Sin caras (puntos o aristas sueltas): caja alineada a los ejes globales.
        candidatos.append([_extension(vertices, e) for e in ((1, 0, 0), (0, 1, 0), (0, 0, 1))])

    def vol(d):
        s = sorted(d, reverse=True)
        # Si hay espesor 0 (pieza plana), comparar por área
        return (s[0] * s[1] * s[2], s[0] * s[1])

    mejor = min(candidatos, key=vol)
    largo, ancho, espesor = sorted(mejor, reverse=True)
    return (largo, ancho, espesor)


def redondear(x, decimales=4):
    return round(float(x), decimales)


def normalizar_nombre(nombre):
    """Quita sufijos que agregan Blender y los importadores: 'MDF-18.001' → 'MDF-18'."""
    if nombre is None:
        return None
    n = str(nombre).strip()
    return re.sub(r"\.\d{3}$", "", n)       # sufijo de duplicado de Blender


def buscar_equivalencia(origen, equivalencias):
    """Busca la clave de catálogo para un nombre de Vectorworks. Sin mayúsculas ni espacios extra."""
    if not origen or not equivalencias:
        return None
    if origen in equivalencias:
        return equivalencias[origen]
    clave = origen.strip().lower()
    for k, v in equivalencias.items():
        if str(k).strip().lower() == clave:
            return v
    return None


def cargar_equivalencias(fuente):
    """
    Acepta: None, un dict, o la ruta a un JSON. El JSON puede ser:
      {"MDF-18-Blanco": "MDF_18_BLANCO", ...}   (simple)
      o el nodo /base_datos/equivalencias_vw exportado de Firebase:
      {"<id>": {"vw": "MDF-18-Blanco", "material": "MDF_18_BLANCO", ...}, ...}
    Devuelve {nombre_vw: dato}, donde dato es la clave (str) o un dict con "material" y "acabados".
    """
    if fuente is None:
        return {}
    if isinstance(fuente, str):
        with open(fuente, encoding="utf-8") as f:
            fuente = json.load(f)
    salida = {}
    for k, v in (fuente or {}).items():
        if isinstance(v, dict) and "vw" in v:
            salida[v["vw"]] = v
        else:
            salida[k] = v
    return salida


def _clave_material(dato):
    if dato is None:
        return None
    if isinstance(dato, dict):
        return dato.get("material")
    return str(dato)


def agrupar_piezas(piezas):
    """Junta piezas iguales (mismo ítem, nombre, origen y medidas al mm) sumando `cant`."""
    grupos = {}
    orden = []
    for p in piezas:
        t = TOLERANCIA_AGRUPAR
        k = (
            p["item"], p["pieza"], p["origen_vw"],
            round(p["largo"] / t), round(p["ancho"] / t), round(p["espesor"] / t),
            tuple(sorted(str(a["origen_vw"] or a["material"]) for a in p["acabados"])),
        )
        if k in grupos:
            g = grupos[k]
            g["cant"] += p["cant"]
            g["objetos"].extend(p["objetos"])
        else:
            grupos[k] = dict(p, objetos=list(p["objetos"]))
            orden.append(k)
    return [grupos[k] for k in orden]


# ---------------------------------------------------------------------------
# Lectura de la escena (bpy)
# ---------------------------------------------------------------------------

def _prop(id_block, nombres):
    """Busca una propiedad personalizada por nombre (sin mayúsculas)."""
    if id_block is None:
        return None
    try:
        claves = list(id_block.keys())
    except Exception:
        return None
    bajas = {str(k).lower(): k for k in claves}
    for n in nombres:
        if n in bajas:
            v = id_block[bajas[n]]
            if isinstance(v, (str, int, float)) and str(v).strip():
                return str(v).strip()
    return None


def _cadena_padres(obj):
    cadena = []
    p = obj.parent
    while p is not None:
        cadena.append(p)
        p = p.parent
    return cadena


def _coleccion_de(obj, escena):
    """Ruta de colecciones del objeto, de la más externa a la más interna."""
    padres = {}

    def recorrer(col, ruta):
        for hija in col.children:
            padres[hija.name] = ruta + [hija.name]
            recorrer(hija, ruta + [hija.name])

    recorrer(escena.collection, [])
    for col in obj.users_collection:
        if col == escena.collection:
            continue
        return padres.get(col.name, [col.name])
    return []


def _item_de(obj, instanciador, escena):
    """
    Ítem del presupuesto:
      1. Propiedad `rubik_item` (si alguien la cargó).
      2. Si viene de una instancia (símbolo de VW): el padre más alto del instanciador, o el nombre del símbolo.
      3. El padre más alto del objeto (grupo de VW que llega como "empty").
      4. La colección más interna (capa o clase de VW que llega como colección).
      5. "Sin ítem".
    """
    for fuente in [obj] + _cadena_padres(obj):
        v = _prop(fuente, PROPS_ITEM)
        if v:
            return v, "propiedad"
    if instanciador is not None:
        v = _prop(instanciador, PROPS_ITEM)
        if v:
            return v, "propiedad"
        cad = _cadena_padres(instanciador)
        if cad:
            return normalizar_nombre(cad[-1].name), "simbolo"
        col = getattr(instanciador, "instance_collection", None)
        return normalizar_nombre((col or instanciador).name), "simbolo"
    cad = _cadena_padres(obj)
    if cad:
        return normalizar_nombre(cad[-1].name), "padre"
    ruta = [c for c in _coleccion_de(obj, escena) if c.lower() not in COLECCIONES_IGNORADAS]
    if ruta:
        return normalizar_nombre(ruta[-1]), "coleccion"
    return "Sin ítem", "ninguno"


def _clase_vw(obj, instanciador):
    for fuente in [obj] + _cadena_padres(obj) + ([instanciador] if instanciador else []):
        v = _prop(fuente, PROPS_CLASE_VW)
        if v:
            return v
    return None


def _datos_malla(obj_eval, matriz, escala_unidad):
    """Vértices en metros (mundo), caras, y material de cada cara."""
    malla = obj_eval.to_mesh()
    try:
        vertices = []
        for v in malla.vertices:
            w = matriz @ v.co
            vertices.append((w.x * escala_unidad, w.y * escala_unidad, w.z * escala_unidad))
        caras = [tuple(p.vertices) for p in malla.polygons]
        mats_cara = [p.material_index for p in malla.polygons]
        nombres_mat = []
        for slot in obj_eval.material_slots:
            nombres_mat.append(slot.material.name if slot.material else None)
        return vertices, caras, mats_cara, nombres_mat
    finally:
        obj_eval.to_mesh_clear()


def _ejes_locales(matriz):
    ejes = []
    for i in range(3):
        col = (matriz[0][i], matriz[1][i], matriz[2][i])
        u = _unit(col)
        if u is None:
            return None
        ejes.append(u)
    return ejes


def pieza_desde_objeto(obj_eval, matriz, instanciador, escena, escala_unidad, equivalencias):
    vertices, caras, mats_cara, nombres_mat = _datos_malla(obj_eval, matriz, escala_unidad)
    if not vertices:
        return None

    largo, ancho, espesor = medidas_orientadas(vertices, caras, _ejes_locales(matriz))

    # Área por material (para saber cuál es el principal y cuáles son acabados)
    area_por_mat = {}
    area_total = 0.0
    for cara, im in zip(caras, mats_cara):
        a = area_poligono([vertices[i] for i in cara])
        area_total += a
        nombre = nombres_mat[im] if 0 <= im < len(nombres_mat) else None
        area_por_mat[nombre] = area_por_mat.get(nombre, 0.0) + a

    cerrada = malla_cerrada(caras)
    volumen = volumen_malla(vertices, caras) if cerrada else None

    original = obj_eval.original if hasattr(obj_eval, "original") else obj_eval
    clase = _clase_vw(original, instanciador)
    mats_ordenados = [m for m, _ in sorted(area_por_mat.items(), key=lambda kv: -kv[1]) if m]

    # origen_vw: la clase de VW si vino como propiedad; si no, el material con más área.
    if clase:
        # El material con más superficie es el del cuerpo de la pieza (textura de render de VW):
        # no es un acabado aparte. Los demás sí.
        origen, fuente_origen = clase, "clase"
        secundarios = mats_ordenados[1:]
    elif mats_ordenados:
        origen, fuente_origen = normalizar_nombre(mats_ordenados[0]), "material"
        secundarios = mats_ordenados[1:]
    else:
        origen, fuente_origen = None, None
        secundarios = []

    revisar = []
    dato_eq = buscar_equivalencia(origen, equivalencias)
    material = _clave_material(dato_eq)
    if origen is None:
        revisar.append("sin material ni clase de Vectorworks")
    elif material is None:
        revisar.append(f"'{origen}' sin equivalencia en equivalencias_vw")
    if not cerrada:
        revisar.append("malla abierta: volumen no calculado")

    acabados = []
    for m in secundarios:
        nm = normalizar_nombre(m)
        if nm == origen:
            continue
        clave_ac = _clave_material(buscar_equivalencia(nm, equivalencias))
        acabados.append({
            "origen_vw": nm,
            "material": clave_ac,
            "area_m2": redondear(area_por_mat[m]),
        })
        if clave_ac is None:
            revisar.append(f"acabado '{nm}' sin equivalencia")
    if isinstance(dato_eq, dict):
        for ac in dato_eq.get("acabados") or []:
            acabados.append({"origen_vw": None, "material": ac, "area_m2": redondear(area_total),
                             "desde": "equivalencia"})

    item, fuente_item = _item_de(original, instanciador, escena)
    es_plancha = espesor <= ESPESOR_MAX_PLANCHA

    return {
        "item": item,
        "pieza": normalizar_nombre(original.name),
        "origen_vw": origen,
        "material": material,
        "cant": 1,
        "largo": redondear(largo),
        "ancho": redondear(ancho),
        "espesor": redondear(espesor),
        "tipo": "plancha" if es_plancha else "volumen",
        "area_m2": redondear(area_total),
        "area_cara_m2": redondear(largo * ancho) if es_plancha else None,
        "perimetro_ml": redondear(2 * (largo + ancho)) if es_plancha else None,
        "volumen_m3": redondear(volumen, 6) if volumen is not None else None,
        "acabados": acabados,
        # Para revisar = falta vincular algo. La malla abierta es solo un aviso.
        "revisar": material is None or any(a["material"] is None for a in acabados),
        "motivos": revisar,
        "fuente": {"item": fuente_item, "origen_vw": fuente_origen},
        "objetos": [original.name],
    }


def leer_escena(equivalencias=None, incluir_ocultos=False):
    """Recorre el depsgraph evaluado (modificadores aplicados, instancias resueltas)."""
    import bpy  # noqa: solo dentro de Blender

    escena = bpy.context.scene
    depsgraph = bpy.context.evaluated_depsgraph_get()
    escala_unidad = escena.unit_settings.scale_length or 1.0
    eq = cargar_equivalencias(equivalencias)

    tipos = {"MESH", "CURVE", "SURFACE", "META", "FONT"}
    # Ocultos en la vista o en el render: no se cotizan (el depsgraph ya no trae los ocultos en la vista).
    salteados = sorted(
        o.name for o in escena.objects
        if o.type in tipos and (not o.visible_get() or o.hide_render)
    )
    piezas = []
    for inst in depsgraph.object_instances:
        obj = inst.object
        if obj.type not in tipos:
            continue
        original = obj.original
        if not incluir_ocultos and not inst.is_instance and original.name in salteados:
            continue
        instanciador = inst.parent.original if inst.is_instance and inst.parent else None
        matriz = inst.matrix_world.copy()
        p = pieza_desde_objeto(obj, matriz, instanciador, escena, escala_unidad, eq)
        if p is not None:
            piezas.append(p)
    return piezas, salteados


def armar_resultado(piezas, proyecto, archivo_origen=None, salteados=None):
    agrupadas = agrupar_piezas(piezas)
    items = []
    for p in agrupadas:
        if p["item"] not in items:
            items.append(p["item"])
    a_revisar = [p for p in agrupadas if p["revisar"]]
    sin_eq = sorted({p["origen_vw"] for p in agrupadas if p["origen_vw"] and p["material"] is None})
    resumen = (
        f"{len(agrupadas)} piezas distintas ({sum(p['cant'] for p in agrupadas)} en total) "
        f"en {len(items)} ítems. {len(a_revisar)} para revisar."
    )
    if sin_eq:
        resumen += " Sin equivalencia: " + ", ".join(sin_eq) + "."
    return {
        "formato": FORMATO,
        "proyecto": proyecto,
        "archivo": archivo_origen,
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "unidad": "m",
        "items": items,
        "piezas": agrupadas,
        "sin_equivalencia": sin_eq,
        "ocultos_salteados": salteados or [],
        "resumen": resumen,
    }


def exportar(ruta_salida=None, equivalencias=None, proyecto=None, incluir_ocultos=False):
    """Punto de entrada. Escribe rubik.json y devuelve el resultado (dict)."""
    import bpy  # noqa

    blend = bpy.data.filepath or None
    if proyecto is None:
        proyecto = os.path.splitext(os.path.basename(blend))[0] if blend else "sin-nombre"
    if ruta_salida is None:
        carpeta = os.path.dirname(blend) if blend else os.getcwd()
        ruta_salida = os.path.join(carpeta, "rubik.json")

    piezas, salteados = leer_escena(equivalencias, incluir_ocultos)
    resultado = armar_resultado(piezas, proyecto, os.path.basename(blend) if blend else None, salteados)
    with open(ruta_salida, "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False, indent=2)
    resultado["ruta_salida"] = ruta_salida
    return resultado


def inventario():
    """
    Diagnóstico para el paso 2.1: qué trajo Vectorworks a Blender, sin calcular nada.
    Devuelve colecciones, padres, materiales y propiedades personalizadas de cada objeto.
    """
    import bpy  # noqa

    escena = bpy.context.scene
    objetos = []
    for o in escena.objects:
        objetos.append({
            "nombre": o.name,
            "tipo": o.type,
            "padre": o.parent.name if o.parent else None,
            "colecciones": _coleccion_de(o, escena),
            "materiales": [s.material.name if s.material else None for s in o.material_slots],
            "propiedades": {str(k): str(o[k])[:80] for k in o.keys() if not str(k).startswith("_")},
            "modificadores": [m.type for m in getattr(o, "modifiers", [])],
            "instancia_de": o.instance_collection.name if getattr(o, "instance_collection", None) else None,
        })
    return {
        "unidad_escena": escena.unit_settings.system,
        "escala": escena.unit_settings.scale_length,
        "objetos": objetos,
        "materiales": [m.name for m in bpy.data.materials],
    }
