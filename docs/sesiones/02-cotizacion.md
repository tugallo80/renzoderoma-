# Sesión 2 — Cotización: datos reales de Blender primero, IA donde no hay modelo

**Objetivo:** remodelar cómo se cotiza para que las **cantidades y medidas salgan de datos reales**
(modelo de Blender + base de precios) y la IA quede solo donde no hay modelo: fotos, referencias o
descripciones del cliente.

Reemplaza el enfoque de la "Sesión D" de `docs/plan-sesiones.md`. Esa sesión hacía que la IA
calculara todo, con más contexto. Acá la IA deja de calcular cantidades cuando hay un modelo.

---

## La idea en una frase

> **Si hay modelo 3D, la IA no inventa números.** Blender da las medidas, la base de datos da los
> precios y rendimientos, y el sistema hace la cuenta. La IA solo cotiza "a ojo" cuando no hay modelo,
> y lo marca como estimado.

## Dos caminos para cotizar

| | **Camino A — Con modelo (Blender)** | **Camino B — Sin modelo (IA)** |
|---|---|---|
| Cuándo | Ya diseñaste la pieza en Blender | El cliente manda una foto, una referencia o una idea |
| De dónde salen las medidas | Del modelo (exactas) | La IA las estima desde la imagen o el texto |
| De dónde salen los materiales | El material asignado a cada objeto en Blender → `/base_datos/materiales/` | La IA los propone y se ligan a la base cuando existen |
| Precios | Siempre de la base de datos | Siempre de la base de datos (la IA no pone precios) |
| Cómo queda marcado | **Exacto** | **Estimado IA** + confianza (alta/media/baja) |
| Para qué sirve | Presupuesto final, compras, plano de corte | Precio rápido para responder al cliente, antes de diseñar |

Cuando un ítem de **B** se aprueba y se diseña en Blender, se **re-cotiza por A** y reemplaza al estimado.

---

## Qué hay hoy (y qué se remodela)

| Hoy | Archivo | Qué pasa en la remodelación |
|---|---|---|
| "Presupuesto IA": descripción o imagen → Gemini/Claude arma ítems y APU **con cantidades y precios** | `public/presupuesto.html` (`abrirModalIABudget`) | Pasa a ser el **Camino B**. La IA devuelve ítems y materiales con **cantidades estimadas**, sin precios. Los precios los pone la base. Cada ítem queda marcado "Estimado IA" |
| Cómputo métrico manual (piezas con largo/ancho/alto, plano de corte) | `public/computo.html` → `items/$idx/measures` | **Recibe las piezas desde Blender** en vez de cargarlas a mano. El plano de corte sigue funcionando igual |
| Requerimiento asistido (el cliente mide, la IA arma el APU) | `public/requerimiento-asistido.html` | Queda como está para obras donde mide el cliente. Se revisa en una sesión aparte |
| APU por ítem (materiales `mat`, mano de obra `mo`, `eq`, `sub`) | `public/js/apu-utils.js` | Se agrega el origen de cada fila: `blender`, `ia` o `manual` |
| Prompts editables | `/config_ia/prompts/` | El prompt del Camino B se reescribe: "estimá cantidades, no pongas precios, decí tu confianza" |

---

## La línea Vectorworks → Blender → app

Así trabaja el dueño: **diseña en Vectorworks**, exporta a Blender, y en Blender trabaja **Claude conectado
por MCP**. No es necesario saber usar Blender: Claude corre los scripts adentro.

```
Vectorworks ──(exportar)──▶ Blender ──(script en el repo, lo corre Claude por MCP)──▶ rubik.json ──▶ app
 diseño, clases,              geometría +                  lee piezas, medidas y            "Importar de
 materiales                   nombres de VW                material de cada objeto           Blender"
```

- **El script vive en este repo** (`tools/blender/exportar_rubik.py`), versionado como el resto. Claude lo
  ejecuta en Blender por MCP, así que no hace falta instalar un add-on a mano.
- **Lo que manda es Vectorworks:** el material de cada pieza sale de la **clase** o del **material** de VW, que
  llega a Blender como nombre del objeto o del material. Una tabla `/base_datos/equivalencias_vw/`
  traduce ese nombre a la clave del catálogo (ej. clase `MDF-18-Blanco` → `MDF_18_BLANCO`). Se carga
  una sola vez y después se reusa.
- **Si algo no tiene equivalencia**, el ítem queda en rojo en la app y se vincula una sola vez desde ahí.

**Paso 1 — Archivo (simple, sin riesgo).** El script genera `rubik.json` y en `presupuesto.html`, el botón
**"Importar de Blender"** crea o actualiza los ítems con sus medidas. No toca permisos, nube ni claves.

**Paso 2 — Directo (después, cuando el paso 1 funcione bien).** El script manda los datos directo a la app.
Necesita un login desde Blender, y se diseña con la misma seguridad de la Sesión 0: lista blanca y una
Function propia.

### Qué exporta Blender por cada objeto (borrador)

```json
{
  "proyecto": "stand-feria-2026",
  "unidad": "m",
  "piezas": [
    {
      "item": "Mostrador recepción",          // colección de Blender = ítem del presupuesto
      "pieza": "Tapa superior",               // nombre del objeto
      "origen_vw": "MDF-18-Blanco",           // clase/material de Vectorworks tal como llegó a Blender
      "material": "MDF_18_BLANCO",            // clave en /base_datos/materiales (vía equivalencias_vw)
      "cant": 1,
      "largo": 1.80, "ancho": 0.60, "espesor": 0.018,
      "area_m2": 1.08,                        // área de caras visibles (para pintura/laminado)
      "volumen_m3": 0.0194,
      "acabados": ["laca_blanca", "canto_pvc"]
    }
  ]
}
```

- **Ítem del presupuesto:** se arma por capa, grupo o símbolo de Vectorworks (lo que llegue a Blender
  como colección o padre). Lo definimos con un modelo real.
- **Material:** sale de la clase o material de VW, vía `equivalencias_vw`. Si no tiene equivalencia, el
  ítem queda en **rojo** ("material sin vincular") y no se inventa un precio.
- **Piezas** → van a `items/$idx/measures` de `computo.html`. Así siguen funcionando el plano de corte y
  el cálculo por planchas o barras.

### Cómo se pasa de medidas a precio (sin IA)

```
pieza (medidas) → cantidad de material según su unidad (m², ml, planchas, kg)
               × (1 + desperdicio % del material)
               × precio de /base_datos/materiales
+ mano de obra por operación (rendimientos de la base: ej. "laqueado: X m²/día")
= APU del ítem (filas marcadas origen: "blender")
```

Esto **depende de la Sesión B** (base de precios con unidad de compra, rendimiento y desperdicio).
Sin esos datos, el Camino A puede traer cantidades exactas, pero no precios completos.

---

## Camino B — IA para fotos y referencias (remodelado)

- **Entrada:** fotos o referencias del cliente + una descripción corta + el tipo de trabajo (stand, vitrina,
  mueble, prop…).
- **La IA devuelve un JSON**, no un presupuesto armado: ítems, medidas estimadas, materiales sugeridos con
  la **clave del catálogo** y la **confianza** de cada dato.
- **El sistema** busca los precios en la base y arma el APU. Lo que no encuentra queda en rojo.
- **Lo que no hace la IA:** poner precios, inventar materiales fuera del catálogo, o presentar un estimado como
  si fuera exacto.
- **Más adelante (Sesión E):** cuando corregís un estimado, la corrección se guarda como ejemplo para la próxima.

---

## Decisiones que tomamos al arrancar la sesión

1. **Cómo exportás de Vectorworks a Blender:** ¿qué formato (FBX, OBJ, glTF, IFC)? Con IFC llegan también
   las clases y los registros de VW. Con FBX/OBJ llegan sobre todo nombres.
2. **Cómo organizás en Vectorworks:** ¿usás clases por material (ej. "MDF 18 blanco")? ¿Capas o grupos por
   mueble? Esa organización es la que el script va a leer.
3. **Qué medís de cada pieza para cotizar:** ¿plancha (corte), m² de acabado, ml de canto, kg de metal?
4. **Mano de obra:** ¿sale de rendimientos por operación (m²/día) o se sigue cargando a mano por ítem?
5. **Camino B:** ¿lo usa solo el equipo interno o también va a responder al cliente por WhatsApp?
6. **Qué MCP de Blender usás con Claude** (para que el script corra igual en tu PC).

**Traé para la sesión (desde tu PC):** un trabajo real ya cotizado, exportado a Blender como lo hacés siempre
(el `.blend`, y si podés el archivo de Vectorworks), y el presupuesto final que se cobró. Con eso probamos que
el Camino A llega a un número parecido.

---

## Orden de trabajo propuesto

- [ ] **2.1** Con un modelo real: ver qué llega de Vectorworks a Blender y definir el JSON (las decisiones 1–3)
- [ ] **2.2** Script `tools/blender/exportar_rubik.py` (lo corre Claude por MCP) + tabla `equivalencias_vw`
- [ ] **2.3** "Importar de Blender" en `presupuesto.html` → ítems + `measures`, con materiales vinculados o en rojo
- [ ] **2.4** Cálculo medidas → APU con datos de la base (origen `blender`)
- [ ] **2.5** Remodelar "Presupuesto IA" como Camino B: sin precios, con confianza y marcado "Estimado IA"
- [ ] **2.6** Prueba con el trabajo real: comparar el Camino A con lo que se cobró
- [ ] **2.7** (después) Paso 2: envío directo de Blender a la app con login

**Depende de:** Sesión B (precios, unidades, rendimientos y desperdicio en la base). Se puede arrancar con
2.1–2.3 en paralelo, porque traer medidas exactas no necesita precios.
