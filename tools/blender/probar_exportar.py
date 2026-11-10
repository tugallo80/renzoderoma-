"""
probar_exportar.py — Prueba de exportar_rubik.py con una escena armada por código.

Se corre de dos formas (las dos borran la escena abierta: usar un archivo nuevo):
  - En la sesión de Claude o una PC con Python 3.11+:  pip install bpy  y después
        python tools/blender/probar_exportar.py
  - Dentro de Blender (Archivo > Nuevo, después por el MCP o la consola de Python):
        exec(open(r"C:/ruta/al/repo/tools/blender/probar_exportar.py", encoding="utf-8").read())

Arma un "Mostrador recepción" y una "Repisa" con nombres y materiales como los de Vectorworks,
con un modificador, una pieza girada, una pieza repetida, una sin material y un símbolo (instancia).
Termina con "TODO OK" o con el primer error.
"""

import json
import math
import os
import sys
import tempfile

try:
    _AQUI = os.path.dirname(os.path.abspath(__file__))
except NameError:  # dentro de Blender con exec(): __file__ no existe
    _AQUI = None

import bpy

if "exportar" not in globals():
    if _AQUI is None:
        raise RuntimeError("Primero hacé exec() de exportar_rubik.py, o corré este archivo con python.")
    sys.path.insert(0, _AQUI)
    from exportar_rubik import (  # noqa: E402
        exportar, medidas_orientadas, agrupar_piezas, normalizar_nombre, buscar_equivalencia,
    )


def _cerca(a, b, tol=1e-3):
    return abs(a - b) <= tol


def probar_geometria_pura():
    # Caja 1.8 x 0.6 x 0.018 girada 30° en Z y 10° en X, con la rotación "horneada" en los vértices
    import itertools
    L, A, E = 1.8, 0.6, 0.018
    vs = [(x * L, y * A, z * E) for x, y, z in itertools.product((-.5, .5), repeat=3)]

    def rot(v, ax, ang):
        c, s = math.cos(ang), math.sin(ang)
        x, y, z = v
        if ax == "z":
            return (c * x - s * y, s * x + c * y, z)
        return (x, c * y - s * z, s * y + c * z)
    vs = [rot(rot(v, "x", math.radians(10)), "z", math.radians(30)) for v in vs]
    # índices de product: (x,y,z) bits → 0..7
    caras = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    l, a, e = medidas_orientadas(vs, caras)
    assert _cerca(l, L) and _cerca(a, A) and _cerca(e, E), (l, a, e)
    assert normalizar_nombre("MDF-18-Blanco.003") == "MDF-18-Blanco"
    assert buscar_equivalencia(" mdf-18-blanco ", {"MDF-18-Blanco": "X"}) == "X"
    assert buscar_equivalencia("MDF-15", {"MDF-18-Blanco": "X"}) is None
    print("  geometría pura: OK")


def _material(nombre):
    return bpy.data.materials.get(nombre) or bpy.data.materials.new(nombre)


def _caja(nombre, dims, ubic=(0, 0, 0), rot=(0, 0, 0), mat=None, coleccion=None, padre=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=ubic, rotation=rot)
    o = bpy.context.active_object
    o.name = nombre
    o.scale = dims
    if mat:
        o.data.materials.append(_material(mat))
    if coleccion:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coleccion.objects.link(o)
    if padre:
        o.parent = padre
    return o


def armar_escena():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    escena = bpy.context.scene
    escena.unit_settings.system = "METRIC"
    escena.unit_settings.scale_length = 1.0

    # Ítem 1: "Mostrador recepción" como colección (capa de VW)
    mostrador = bpy.data.collections.new("Mostrador recepción")
    escena.collection.children.link(mostrador)
    tapa = _caja("Tapa superior", (1.8, 0.6, 0.018), (0, 0, 1.0), mat="MDF-18-Blanco", coleccion=mostrador)
    # Laterales iguales → cant 2 (uno con nombre duplicado de Blender)
    _caja("Lateral", (0.018, 0.6, 0.982), (-0.891, 0, 0.5), mat="MDF-18-Blanco", coleccion=mostrador)
    _caja("Lateral.001", (0.018, 0.6, 0.982), (0.891, 0, 0.5), mat="MDF-18-Blanco", coleccion=mostrador)
    # Frente girado 15° y con modificador Solidify sobre un plano (espesor lo da el modificador)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -0.31, 0.5), rotation=(math.radians(90), 0, math.radians(15)))
    frente = bpy.context.active_object
    frente.name = "Frente curvo"
    frente.scale = (1.764, 0.982, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = frente.modifiers.new("Espesor", "SOLIDIFY")
    mod.thickness = 0.009
    mod.offset = 0
    frente.data.materials.append(_material("MDF-9-Laca"))
    frente.data.materials.append(_material("Canto PVC Blanco"))
    # Canto: asignar las caras de borde (las que agrega Solidify usan material_offset_rim)
    mod.material_offset_rim = 1
    for c in list(frente.users_collection):
        c.objects.unlink(frente)
    mostrador.objects.link(frente)
    # Pieza sin material → revisar
    _caja("Zócalo", (1.7, 0.08, 0.018), (0, -0.2, 0.04), coleccion=mostrador)

    # Ítem 2: "Repisa" como grupo de VW (empty padre) con una clase como propiedad
    grupo = bpy.data.objects.new("Repisa", None)
    escena.collection.objects.link(grupo)
    estante = _caja("Estante", (1.2, 0.3, 0.025), (3, 0, 1.2), mat="Material genérico", padre=grupo)
    estante["vw_clase"] = "Melamina-25-Roble"
    _caja("Ménsula", (0.05, 0.25, 0.003), (3, 0, 1.15), rot=(0, math.radians(90), 0), mat="Fierro-3mm", padre=grupo)

    # Ítem 3: símbolo de VW = colección instanciada dos veces
    simbolo = bpy.data.collections.new("SIM Banqueta")
    asiento = _caja("Asiento", (0.4, 0.4, 0.03), (0, 0, 0.45), mat="MDF-18-Blanco", coleccion=simbolo)
    for i in range(2):
        inst = bpy.data.objects.new(f"Banqueta {i + 1}", None)
        inst.instance_type = "COLLECTION"
        inst.instance_collection = simbolo
        inst.location = (5 + i, 0, 0)
        escena.collection.objects.link(inst)

    # Oculto: no tiene que salir
    oculto = _caja("Referencia oculta", (1, 1, 1), (9, 9, 9), mat="MDF-18-Blanco", coleccion=mostrador)
    oculto.hide_set(True)
    return escena


def probar_escena():
    armar_escena()
    eq = {
        "MDF-18-Blanco": "MDF_18_BLANCO",
        "MDF-9-Laca": {"vw": "MDF-9-Laca", "material": "MDF_9", "acabados": ["LACA_BLANCA"]},
        "Canto PVC Blanco": "CANTO_PVC_BLANCO",
        "Melamina-25-Roble": "MELAMINA_25_ROBLE",
    }
    salida = os.path.join(tempfile.mkdtemp(), "rubik.json")
    r = exportar(ruta_salida=salida, equivalencias=eq, proyecto="prueba")
    with open(salida, encoding="utf-8") as f:
        datos = json.load(f)
    print("  " + datos["resumen"])
    piezas = {(p["item"], p["pieza"]): p for p in datos["piezas"]}
    for k, p in piezas.items():
        print(f"    {k[0]:22} {k[1]:16} {p['cant']}× {p['largo']:.3f}×{p['ancho']:.3f}×{p['espesor']:.3f} "
              f"{p['origen_vw']!s:20} → {p['material']!s:18} revisar={p['revisar']}")

    assert datos["formato"] == "rubik/1"
    tapa = piezas[("Mostrador recepción", "Tapa superior")]
    assert (tapa["largo"], tapa["ancho"], tapa["espesor"]) == (1.8, 0.6, 0.018), tapa
    assert tapa["material"] == "MDF_18_BLANCO" and not tapa["revisar"]
    assert _cerca(tapa["volumen_m3"], 1.8 * 0.6 * 0.018, 1e-6)
    assert _cerca(tapa["perimetro_ml"], 4.8)

    lat = piezas[("Mostrador recepción", "Lateral")]
    assert lat["cant"] == 2 and len(lat["objetos"]) == 2, lat
    assert _cerca(lat["largo"], 0.982) and _cerca(lat["espesor"], 0.018)

    fr = piezas[("Mostrador recepción", "Frente curvo")]
    assert _cerca(fr["largo"], 1.764) and _cerca(fr["ancho"], 0.982) and _cerca(fr["espesor"], 0.009), fr
    assert fr["material"] == "MDF_9"
    origenes_ac = {a["origen_vw"]: a for a in fr["acabados"]}
    assert "Canto PVC Blanco" in origenes_ac, fr["acabados"]
    assert _cerca(origenes_ac["Canto PVC Blanco"]["area_m2"], 2 * (1.764 + 0.982) * 0.009, 1e-4)
    assert any(a["material"] == "LACA_BLANCA" for a in fr["acabados"])

    zo = piezas[("Mostrador recepción", "Zócalo")]
    assert zo["origen_vw"] is None and zo["material"] is None and zo["revisar"]

    est = piezas[("Repisa", "Estante")]
    assert est["origen_vw"] == "Melamina-25-Roble" and est["material"] == "MELAMINA_25_ROBLE"
    assert est["fuente"]["item"] == "padre" and est["fuente"]["origen_vw"] == "clase"
    men = piezas[("Repisa", "Ménsula")]
    assert men["origen_vw"] == "Fierro-3mm" and men["material"] is None and men["revisar"]
    assert _cerca(men["espesor"], 0.003)

    asientos = [p for (it, pz), p in piezas.items() if pz == "Asiento"]
    total = sum(p["cant"] for p in asientos)
    # 2 instancias del símbolo (la colección del símbolo no está en la escena, así que el original no cuenta)
    assert total == 2, asientos
    assert all(p["fuente"]["item"] == "simbolo" for p in asientos)

    assert "Referencia oculta" in datos["ocultos_salteados"]
    assert not any(pz == "Referencia oculta" for _, pz in piezas)
    assert "Fierro-3mm" in datos["sin_equivalencia"]
    print("  escena de prueba: OK")


def main():
    print("Probando exportar_rubik.py — Blender", bpy.app.version_string)
    probar_geometria_pura()
    probar_escena()
    print("TODO OK")


main()
