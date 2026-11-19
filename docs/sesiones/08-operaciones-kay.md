# Sesión 8 — Kay modifica licitaciones, producción, Gantt y diseño (operaciones en el servidor)

**Objetivo:** que Kay (WhatsApp, modo dueño) y Claude puedan **modificar** los proyectos, no solo leerlos, con la misma
lógica que las pantallas. Como compras (`docs/sesiones/07-compras.md`): un módulo de servidor por área, las pantallas lo
usan, y el conector lo expone.

## Base común (`functions/operaciones/comun.js`)

- **Quién:** `registrado_por {uid?, rol, nombre, telefono?, via: app|whatsapp|claude}`. La app lo toma del token; Claude lo
  manda; para Kay, `kayApi` lo exige y pone `via: whatsapp`.
- **Idempotencia:** `/operaciones_idem/{sha256(clave)}` = `{estado: en_curso|listo, resultado}`. El reintento devuelve el
  mismo resultado (`repetida: true`); si falla, se libera la clave. Reglas: cerrado.
- **Historial:** `/proyectos/{cid}/{pid}/historial_operaciones/{id}` `{area, ref, op, antes, despues, motivo, por, fecha}`.
- **Transacciones:** nunca devolver `undefined` ante `null` (la primera pasada del Admin SDK ve el valor local vacío).

## Etapa 1 — Licitaciones ✅

`functions/licitaciones/api.js` → `/api/licitaciones` (hub) y conector (`listar_licitaciones`, `modificar_licitacion`).

| Operación | Qué hace | Antes (pantalla) |
|---|---|---|
| `guardar` | Crear/editar desde la pantalla: licitación + copia del trabajador (`personal/{wid}/solicitudes`), quita la copia del trabajador anterior, responsables en el presupuesto si está aprobada; conserva pagos y extras | `set` doble desde el navegador |
| `cambiar_monto` | Aprobada → `precio_final`; si no → `precio_propuesto` | (solo al aprobar) |
| `cambiar_contratista` | Cambia trabajador y mueve la copia | (solo editando todo) |
| `aprobar` / `contra_oferta` / `terminar` | Estado + fechas + copia; aprobar marca el responsable | `update` doble |
| `registrar_pago` | Pago, adelanto o descuento por compra; comprobante en Storage `comprobantes/{cid}/{pid}/{lid}/`; `pagado_con` (caja chica…) | Licitaciones, Tesorería (2) y Compras (2), cada una distinta |
| `anular_pago` | Lo quita de los dos lados con copia en el historial | Compras |
| `agregar_extra` | Extra con copia | Licitaciones |
| `anular` | La quita de la obra y del trabajador; la copia completa queda en el historial | `remove` + **restaba de `gasto_total`** |

**Corrección:** anular una licitación aprobada restaba su monto de `gasto_total`, pero nunca se le había sumado (el
dashboard suma las licitaciones aparte): el gasto del proyecto quedaba por debajo del real. Ahora no lo toca.

Pantallas que pasan a usar el módulo (`public/js/operaciones-api.js`): `licitaciones.html` (guardar, aprobar, contra
oferta, terminar, anular, pago, extra), `tesoreria.html` (anticipo y pago a contratista), `compras.html` (abono, eliminar
pago con motivo, descuento por compra). La asignación automática al Gantt sigue en la pantalla hasta la etapa Gantt.
Las apps de contratista y proveedor gráfico (cerradas desde la Sesión 0) no se tocaron.

Kay: `herramientas_conector` incluye `modificar_licitacion` (`readOnlyHint: false`) y `usar_conector` exige `registrado_por`.

Pruebas: `tools/licitaciones` 6/6 (incluye 2.548,50 → 3.000 con reintento), conector 35/35, reglas 191 OK.

## Etapas siguientes

| Etapa | Área | Operaciones mínimas |
|---|---|---|
| 2 | Gantt (`gantt.html`, `licitaciones.html → autoAssignGantt`) | mover fechas de tarea/subtarea, avance, feriado, asignar desde licitación |
| 3 | Producción (`produccion.html`) | estado/avance del ítem, APU de producción |
| 4 | Diseño (`disenos.html`) | estado, aprobar versión, notas |
