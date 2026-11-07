# Subsesión — Fotos en el PDF de rendición de contratistas (Tesorería)

**Problema reportado (7 nov 2026):** en Tesorería, el PDF de rendición de cuentas con el trabajador
o contratista no muestra las fotos de los detalles, o las **repite** (la foto de un ítem aparece en otro).
Eso confunde al trabajador.

## Cómo viajan las fotos hoy

```
Presupuesto ─▶ ítem.img (1ª foto) · ítem.cortes · ítem.op_images
     │            ▲
     │            └── Producción agrega/cambia fotos en el MISMO ítem (presupuesto/items/{idx}/…)
     ▼
Licitación (al adjudicar) ─▶ copia la foto a cada tarea: tarea.img = ítem.img (o arte / corte)
     │                        y guarda originIdx = POSICIÓN del ítem en el presupuesto
     ▼
Tesorería → Contratistas → PDF  (`_ctGenerarPDFContratistaItems` en `public/tesoreria.html`)
```

## Causas encontradas en el código

1. **Fotos repetidas: se asignaban por nombre de tarea.** El PDF buscaba la fila cuyo texto empezaba con los
   primeros 10 caracteres del nombre de la tarea y le ponía la foto. Tareas con nombres parecidos en ítems
   distintos ("Pintura de…", "Armado de…", "Instalación…") se quedaban con la foto del primer ítem.
2. **Fotos que faltan: solo se usaba la copia del momento de adjudicar.** Si el ítem no tenía foto al
   adjudicar, o se cambió en Producción después, el PDF no la veía.
3. **Misma foto en cada fila:** todas las tareas de un ítem llevan la misma `img` del ítem, así que la foto se
   repetía en cada fila del mismo ítem.
4. **Índice viejo (`originIdx`).** Es la posición del ítem en el presupuesto al adjudicar. Si después se
   reordenan, insertan o borran ítems, apunta a **otro ítem**. Afectaba las fotos y también la columna de
   **medidas**.

Se verificó que el bucket de Storage permite que el navegador baje las imágenes (CORS abierto), así que la
carga en sí no era el problema.

## Corrección (hecha)

En `public/tesoreria.html`:
- **Una foto por ítem**, en la fila de título del ítem: la **actual** del presupuesto o de Producción
  (`img`, o la primera de `op_images`). Si no hay, se usa la guardada al adjudicar.
- **Foto propia en la fila de la tarea** solo para artes y cortes de material (`art`, `llm_art`, `llm_mat`), y
  solo si es distinta de la del ítem.
- **Las fotos se asignan por fila**, no por nombre, así que ya no se cruzan entre ítems.
- **`_ctItemDeTarea`:** verifica que `originIdx` siga apuntando al ítem con la misma descripción. Si no,
  lo busca por descripción. Si no lo encuentra, no adivina. Se usa para las fotos y para las medidas.
- Las fotos mantienen su proporción (antes se estiraban a 18×16 mm) y cada imagen se baja una sola vez.

## Prueba (la hace el dueño)

1. Tesorería → Contratistas → elegir un contratista con un proyecto que tenga fotos → exportar PDF.
2. Cada ítem tiene que mostrar **su** foto, una vez, en la fila del título del ítem.
3. Un ítem cuya foto se cambió en Producción tiene que mostrar la foto nueva.
4. Las medidas tienen que corresponder al ítem correcto.

## Pendiente relacionado

- `public/licitaciones.html` → `exportarPropuestaPDF` (propuesta al trabajador) tiene el mismo problema del
  **índice viejo**. Además suma **todas** las artes del ítem, no solo las adjudicadas. Corregir con la misma
  lógica si el problema aparece también ahí.
- A futuro (Sesión A): guardar en la tarea un **id estable del ítem** en vez de la posición, para no depender
  de la descripción.
