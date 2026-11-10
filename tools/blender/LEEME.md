# Blender → Rubik: cómo sacar las medidas del modelo

Este script lee el modelo que exportaste de Vectorworks a Blender y arma un archivo `rubik.json` con
**cada pieza, su cantidad, sus medidas y su material**. Ese archivo es el que después importa la app
(paso 2.3, todavía no está).

**Vos no tenés que tocar Blender ni escribir código.** Lo hace Claude, conectado a tu Blender por MCP.

---

## Lo que hacés vos

1. Exportás de Vectorworks a Blender como siempre y abrís el archivo en Blender.
2. Guardás el `.blend` (así el `rubik.json` queda en la misma carpeta).
3. Con el MCP de Blender conectado, le pedís a Claude, por ejemplo:

   > "Corré el exportador de Rubik en el Blender abierto. El repo está en `C:\…\renzoderoma-`."

4. Claude te devuelve un resumen así:

   > 23 piezas distintas (41 en total) en 5 ítems. 3 para revisar. Sin equivalencia: Fierro-3mm, Vidrio-6.

   - **"Para revisar"** = piezas sin material vinculado. El script **no inventa nada**: las deja marcadas.
   - **"Sin equivalencia"** = nombres de Vectorworks que todavía no están en la tabla de equivalencias.
     Se cargan una sola vez (ver abajo) y la próxima ya salen bien.

---

## Lo que hace Claude (detalle técnico)

Claude manda este código a Blender por el MCP (herramienta tipo `execute_blender_code`):

```python
RUTA = r"C:/ruta/al/repo/tools/blender"
exec(open(RUTA + "/exportar_rubik.py", encoding="utf-8").read())

# 1) La primera vez con un modelo nuevo: ver qué trajo Vectorworks (paso 2.1)
import json; print(json.dumps(inventario(), ensure_ascii=False, indent=1)[:20000])

# 2) Exportar
r = exportar(
    equivalencias=RUTA + "/equivalencias_vw.json",   # opcional; si no existe, no pasarlo
    # ruta_salida=r"C:/trabajos/x/rubik.json",       # opcional; por defecto al lado del .blend
    # proyecto="stand-feria-2026",                   # opcional; por defecto, el nombre del .blend
)
print(r["resumen"]); print(r["ruta_salida"])
```

- Si el MCP no deja leer archivos del disco, Claude pega el contenido de `exportar_rubik.py` en el mismo
  mensaje y después llama a `exportar(...)`.
- `inventario()` no calcula nada: lista colecciones, padres, materiales y propiedades de cada objeto. Sirve
  para ver cómo llegó organizado el modelo antes de confiar en los números.

### Cómo decide cada dato

| Dato | De dónde sale |
|---|---|
| **ítem** | 1) propiedad `rubik_item` si existe · 2) símbolo de VW (instancia): nombre del símbolo · 3) el padre más alto (grupo de VW) · 4) la colección (capa/clase de VW) |
| **pieza** | Nombre del objeto, sin el `.001` que agrega Blender |
| **origen_vw** | 1) propiedad `vw_clase` / `clase` / `class` / `layer` (si vino de IFC o se cargó) · 2) el material con más superficie |
| **material** | `origen_vw` traducido por la tabla de equivalencias. Si no está: `null` y `revisar: true` |
| **acabados** | Los otros materiales de la pieza (ej. canto, laca) con sus m², y los acabados que diga la equivalencia |
| **largo × ancho × espesor** | La caja más ajustada a la pieza, **aunque esté girada**. Ordenado de mayor a menor |
| **cant** | Piezas iguales (mismo ítem, nombre, material y medidas al mm) se juntan y suman |
| **area_m2** | Superficie total de todas las caras (para pintura o laminado) |
| **area_cara_m2 / perimetro_ml** | Solo en planchas (espesor ≤ 6 cm): una cara y el perímetro (tope de canto) |
| **volumen_m3** | Volumen real si la malla es cerrada; si no, `null` y un aviso |

- Se lee la escena **con los modificadores aplicados** (sin cambiar el archivo) y con los símbolos resueltos.
- Los objetos **ocultos** no se cuentan (quedan listados en `ocultos_salteados`).
- Unidades: siempre **metros**, aunque la escena esté en mm o cm.

---

## Tabla de equivalencias (`equivalencias_vw.json`)

Traduce el nombre que trae Vectorworks a la clave del catálogo de la app (`/base_datos/materiales/`).
Mientras el paso 2.3 no esté, es un archivo JSON simple:

```json
{
  "MDF-18-Blanco": "MDF_18_BLANCO",
  "MDF-9-Laca": { "vw": "MDF-9-Laca", "material": "MDF_9", "acabados": ["LACA_BLANCA"] }
}
```

Cuando esté el paso 2.3 vivirá en la app, en `/base_datos/equivalencias_vw/` (diseño en
`docs/sesiones/02-cotizacion.md`), y se podrá exportar de ahí con el mismo formato.

---

## Probar que funciona

- **En la sesión de Claude o una PC con Python:** `pip install bpy` y `python tools/blender/probar_exportar.py`.
- **En Blender:** *Archivo → Nuevo* (la prueba **borra la escena**), y pedirle a Claude que corra
  `probar_exportar.py` después de `exportar_rubik.py`. Tiene que terminar con `TODO OK`.

La prueba arma un mostrador, una repisa y un símbolo con nombres tipo Vectorworks, un modificador, una pieza
girada, piezas repetidas y una sin material, y revisa las medidas y las marcas de "revisar".
