# Lector 3D de la app ("Importar 3D") — pruebas

El botón **Importar 3D** de `presupuesto.html` lee un `.glb`, `.gltf` o `.fbx` (o el `rubik.json` de
`tools/blender/exportar_rubik.py`) **en el navegador**, con three.js 0.170.0, y arma el mismo desglose `rubik/1`
que el script de Blender. El archivo no se sube a ningún lado.

| Archivo | Qué es |
|---|---|
| `public/js/lector-3d.js` | Lógica pura (sin DOM ni Firebase): medidas, ítems, materiales, unidades, APU. Corre igual en Node |
| `public/js/importar-3d.js` | Pantalla del botón: elegir archivo, revisión, vincular materiales, guardar |
| `generar_ejemplos.py` | Arma una escena inventada con `bpy` y escribe `ejemplos/` (GLB, FBX y lo que da el script de Blender) |
| `probar_lector.mjs` | Lee el GLB y el FBX con los mismos loaders de la app y compara pieza por pieza con `esperado.json` |
| `verificar_sintaxis.mjs` | Revisa la sintaxis de todos los `<script>` de `presupuesto.html` y `computo.html` |

## Correr las pruebas

```bash
cd tools/lector-3d
npm install          # three 0.170.0 (la misma versión que carga la app)
npm test             # probar_lector.mjs + verificar_sintaxis.mjs → "303 OK, 0 fallas" y "Sintaxis OK"
```

Para regenerar los ejemplos (solo si cambia la escena o el script de Blender):

```bash
pip install bpy      # Python 3.13; en la sesión de Claude funciona
python tools/lector-3d/generar_ejemplos.py
```

**Nunca** poner acá archivos de clientes: el repo es público. Los ejemplos son datos inventados.

## Cómo decide cada dato (igual que el script de Blender)

| Dato | De dónde sale |
|---|---|
| ítem | propiedad `rubik_item` → padre más alto (grupo) → **"Sin agrupar"**. Si todo cuelga de un único contenedor, se baja un nivel |
| pieza | nombre original del objeto, sin `.001` (three.js cambia los nombres; se usa el original que guarda el loader) |
| origen_vw | propiedad de clase (`vw_clase`, `clase`, `class`, `layer`…) → material con más superficie |
| medidas | caja más ajustada aunque la pieza esté girada; vértices soldados a 0,01 mm para saber si la malla es cerrada |
| unidad | glTF: metros. FBX: `UnitScaleFactor`. Si el modelo mide más de 200 en esa unidad, se sugiere una más chica. Siempre se puede cambiar (mm, cm, m) |

Diferencias con el script de Blender que vienen del formato, no del lector:
- **FBX y glTF no traen colecciones** de Blender: un ítem armado solo por colección llega como "Sin agrupar"
  (se renombra en la revisión). Los grupos (padres) sí llegan.
- **Los símbolos** llegan como copias: se cuentan bien, pero el ítem es el grupo que los contiene.
- FBXLoader no lee propiedades personalizadas; `leerPropiedadesFBX()` las saca del archivo (binario o ASCII).
