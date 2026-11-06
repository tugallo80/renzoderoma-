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

## Cómo llegan los datos de Blender (propuesta)

**Paso 1 — Archivo (simple, sin riesgo).**
1. Un **add-on de Blender** (Python, botón "Exportar a Rubik") recorre los objetos del modelo y genera un
   archivo `.json`.
2. En `presupuesto.html`, botón **"Importar de Blender"**: elegís el archivo y se crean o actualizan los ítems
   con sus medidas y materiales.

No toca permisos, ni la nube, ni claves. Lo podés usar desde el primer día.

**Paso 2 — Directo (después, cuando el paso 1 funcione bien).**
El add-on manda el modelo directo a la app, sin pasar por un archivo. Necesita un login desde Blender.
Se diseña con la misma seguridad de la Sesión 0: lista blanca y una Function propia.

### Qué exporta Blender por cada objeto (borrador)

```json
{
  "proyecto": "stand-feria-2026",
  "unidad": "m",
  "piezas": [
    {
      "item": "Mostrador recepción",          // colección de Blender = ítem del presupuesto
      "pieza": "Tapa superior",               // nombre del objeto
      "material": "MDF_18_BLANCO",            // propiedad rubik_material → clave en /base_datos/materiales
      "cant": 1,
      "largo": 1.80, "ancho": 0.60, "espesor": 0.018,
      "area_m2": 1.08,                        // área de caras visibles (para pintura/laminado)
      "volumen_m3": 0.0194,
      "acabados": ["laca_blanca", "canto_pvc"]
    }
  ]
}
```

- **Colección de Blender = ítem del presupuesto.** Los objetos de adentro son sus piezas.
- **Material:** cada objeto lleva una propiedad `rubik_material` con la clave del catálogo. Si falta o no
  existe en la base, el ítem queda en **rojo** ("material sin vincular") y no se inventa un precio.
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

1. **Versión de Blender** que usás y si ya tenés materiales con nombre fijo (ej. "MDF 18 blanco").
2. **¿Cómo organizás un modelo?** ¿Una colección por mueble o ítem? ¿Usás modificadores (array, mirror,
   solidify)? El add-on tiene que leer el resultado final, con los modificadores aplicados.
3. **Qué medís de cada pieza para cotizar:** ¿plancha (corte), m² de acabado, ml de canto, kg de metal?
4. **Mano de obra:** ¿sale de rendimientos por operación (m²/día) o se sigue cargando a mano por ítem?
5. **Camino B:** ¿lo usa solo el equipo interno o también va a responder al cliente por WhatsApp?
6. **Prioridad:** ¿arrancamos por el Camino A (Blender) o primero por el B (remodelar la IA actual)?

**Traé para la sesión:** un modelo `.blend` real de un trabajo ya cotizado, y el presupuesto final que
se cobró por ese trabajo. Con eso probamos que el Camino A llega a un número parecido.

---

## Orden de trabajo propuesto

- [ ] **2.1** Definir el formato del JSON con un modelo real (las decisiones 1–3)
- [ ] **2.2** Add-on de Blender "Exportar a Rubik" (archivo `.json`)
- [ ] **2.3** "Importar de Blender" en `presupuesto.html` → ítems + `measures`, con materiales vinculados o en rojo
- [ ] **2.4** Cálculo medidas → APU con datos de la base (origen `blender`)
- [ ] **2.5** Remodelar "Presupuesto IA" como Camino B: sin precios, con confianza y marcado "Estimado IA"
- [ ] **2.6** Prueba con el trabajo real: comparar el Camino A con lo que se cobró
- [ ] **2.7** (después) Paso 2: envío directo de Blender a la app con login

**Depende de:** Sesión B (precios, unidades, rendimientos y desperdicio en la base). Se puede arrancar con
2.1–2.3 en paralelo, porque traer medidas exactas no necesita precios.
