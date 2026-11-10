"""
generar_ejemplos.py — Arma una escena de ejemplo (datos inventados) y escribe, en `ejemplos/`:

  - ejemplo.glb      → como lo exportaría Blender o Vectorworks a glTF binario
  - ejemplo.fbx      → lo mismo en FBX
  - esperado.json    → lo que da `tools/blender/exportar_rubik.py` para la MISMA escena (rubik/1)

Con eso `probar_lector.mjs` comprueba que el lector de la app (public/js/lector-3d.js) da lo mismo
que el script de Blender. Ningún archivo de cliente: todo se genera acá.

Uso (necesita el módulo bpy de PyPI, Python 3.13):
    pip install bpy
    python tools/lector-3d/generar_ejemplos.py
"""

import json
import math
import os
import sys

import bpy

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, "..", "blender"))
from exportar_rubik import exportar  # noqa: E402

SALIDA = os.path.join(AQUI, "ejemplos")

# Equivalencias de prueba (mismo formato que /base_datos/equivalencias_vw o el JSON simple)
EQUIVALENCIAS = {
    "MDF-18-Blanco": "MDF_18_BLANCO",
    "MDF-9-Laca": {"vw": "MDF-9-Laca", "material": "MDF_9", "acabados": ["LACA_BLANCA"]},
    "Canto PVC Blanco": "CANTO_PVC_BLANCO",
    "Melamina-25-Roble": "MELAMINA_25_ROBLE",
    "Vidrio-6": "VIDRIO_6",
}


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


def _grupo(nombre, ubic=(0, 0, 0)):
    g = bpy.data.objects.new(nombre, None)
    g.location = ubic
    bpy.context.scene.collection.objects.link(g)
    return g


def armar_escena():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    escena = bpy.context.scene
    escena.unit_settings.system = "METRIC"
    escena.unit_settings.scale_length = 1.0

    # Ítem 1: "Mostrador recepción" como grupo de VW (empty padre)
    mostrador = _grupo("Mostrador recepción")
    _caja("Tapa superior", (1.8, 0.6, 0.018), (0, 0, 1.0), mat="MDF-18-Blanco", padre=mostrador)
    _caja("Lateral", (0.018, 0.6, 0.982), (-0.891, 0, 0.5), mat="MDF-18-Blanco", padre=mostrador)
    _caja("Lateral.001", (0.018, 0.6, 0.982), (0.891, 0, 0.5), mat="MDF-18-Blanco", padre=mostrador)
    # Frente girado y con Solidify (el espesor lo da el modificador) + canto en otro material
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -0.31, 0.5),
                                     rotation=(math.radians(90), 0, math.radians(15)))
    frente = bpy.context.active_object
    frente.name = "Frente curvo"
    frente.scale = (1.764, 0.982, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = frente.modifiers.new("Espesor", "SOLIDIFY")
    mod.thickness = 0.009
    mod.offset = 0
    mod.material_offset_rim = 1
    frente.data.materials.append(_material("MDF-9-Laca"))
    frente.data.materials.append(_material("Canto PVC Blanco"))
    frente.parent = mostrador
    # Pieza sin material → revisar
    _caja("Zócalo", (1.7, 0.08, 0.018), (0, -0.2, 0.04), padre=mostrador)

    # Ítem 2: "Repisa" (grupo) con la clase de VW como propiedad y una pieza girada sin equivalencia
    repisa = _grupo("Repisa", (3, 0, 0))
    est = _caja("Estante", (1.2, 0.3, 0.025), (3, 0, 1.2), mat="Material genérico", padre=repisa)
    est["vw_clase"] = "Melamina-25-Roble"
    _caja("Ménsula", (0.05, 0.25, 0.003), (2.6, 0, 1.15), rot=(0, math.radians(90), math.radians(20)),
          mat="Fierro-3mm", padre=repisa)
    _caja("Ménsula.001", (0.05, 0.25, 0.003), (3.4, 0, 1.15), rot=(0, math.radians(90), math.radians(20)),
          mat="Fierro-3mm", padre=repisa)

    # Ítem 3: "Vitrina" como grupo anidado (grupo dentro de grupo): el ítem es el padre más alto
    vitrina = _grupo("Vitrina", (6, 0, 0))
    puerta = _grupo("Puerta", (6, 0, 0))
    puerta.parent = vitrina
    _caja("Vidrio", (0.6, 0.006, 1.2), (6, 0.3, 0.8), mat="Vidrio-6", padre=puerta)
    _caja("Base", (0.62, 0.4, 0.1), (6, 0, 0.05), mat="MDF-18-Blanco", padre=vitrina)

    # Entorno suelto (sin grupo): una "persona" de referencia → en la app se sugiere descartar
    _caja("Persona 1.75", (0.45, 0.25, 1.75), (-2, 0, 0.875), mat="Piel")

    # Textura incrustada en "Piel" (como los FBX de SketchUp con "Embed media"): el lector no la decodifica
    img = bpy.data.images.new("textura-piel", 32, 32)
    img.pixels = [0.8, 0.6, 0.5, 1.0] * (32 * 32)
    img.file_format = "PNG"
    img.filepath_raw = os.path.join(SALIDA, "textura-piel.png")
    img.save()
    piel = _material("Piel")
    piel.use_nodes = True
    nodo = piel.node_tree.nodes.new("ShaderNodeTexImage")
    nodo.image = img
    piel.node_tree.links.new(nodo.outputs["Color"], piel.node_tree.nodes["Principled BSDF"].inputs["Base Color"])

    # Oculto: no tiene que salir ni en el script ni en los archivos exportados
    oc = _caja("Referencia oculta", (1, 1, 1), (9, 9, 9), mat="MDF-18-Blanco")
    oc.hide_set(True)
    oc.hide_render = True
    return escena


def main():
    os.makedirs(SALIDA, exist_ok=True)
    armar_escena()
    esperado = exportar(ruta_salida=os.path.join(SALIDA, "esperado.json"),
                        equivalencias=EQUIVALENCIAS, proyecto="ejemplo")
    print("esperado:", esperado["resumen"])

    # Solo lo visible (como exporta el dueño), con modificadores aplicados y propiedades
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(filepath=os.path.join(SALIDA, "ejemplo.glb"), export_format="GLB",
                              use_visible=True, export_apply=True, export_extras=True)
    bpy.ops.export_scene.fbx(filepath=os.path.join(SALIDA, "ejemplo.fbx"), use_visible=True,
                             use_mesh_modifiers=True, use_custom_props=True,
                             path_mode="COPY", embed_textures=True)
    os.remove(os.path.join(SALIDA, "textura-piel.png"))   # queda solo dentro del GLB y el FBX
    with open(os.path.join(SALIDA, "equivalencias.json"), "w", encoding="utf-8") as f:
        json.dump(EQUIVALENCIAS, f, ensure_ascii=False, indent=2)
    for n in sorted(os.listdir(SALIDA)):
        print(f"  {n:20} {os.path.getsize(os.path.join(SALIDA, n)):>8} bytes")


main()
