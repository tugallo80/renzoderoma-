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
| `agregar_items` / `cambiar_item` / `quitar_item` | Ítems de una licitación ya creada (mismo `alcance` que crear); el contrato se ajusta por la diferencia, con copia e historial. Trabajo nuevo va como ítem, no como extra | (solo editando todo) |
| `anular_extra` | Quita un extra con motivo (para pasarlo a ítem) | — |
| `anular` | La quita de la obra y del trabajador; la copia completa queda en el historial | `remove` + **restaba de `gasto_total`** |

**Corrección:** anular una licitación aprobada restaba su monto de `gasto_total`, pero nunca se le había sumado (el
dashboard suma las licitaciones aparte): el gasto del proyecto quedaba por debajo del real. Ahora no lo toca.

Pantallas que pasan a usar el módulo (`public/js/operaciones-api.js`): `licitaciones.html` (guardar, aprobar, contra
oferta, terminar, anular, pago, extra), `tesoreria.html` (anticipo y pago a contratista), `compras.html` (abono, eliminar
pago con motivo, descuento por compra). La asignación automática al Gantt sigue en la pantalla hasta la etapa Gantt.
Las apps de contratista y proveedor gráfico (cerradas desde la Sesión 0) no se tocaron.

Lectura `ver` (`ver_licitacion` en el conector): ítems con su clave `tarea` y extras.

Kay: `herramientas_conector` incluye `modificar_licitacion` (`readOnlyHint: false`) y `usar_conector` exige `registrado_por`.

Pruebas: `tools/licitaciones` 6/6 (incluye 2.548,50 → 3.000 con reintento), conector 35/35, reglas 191 OK.

## Crear licitaciones y etapa del proyecto ✅ (2026-11-20)

- `crear` (`functions/licitaciones/api.js`): arma la licitación desde un alcance simple (ítems del presupuesto por índice
  o renglones libres, con monto) y la guarda con `guardar`, igual que la pantalla. El trabajador o proveedor se indica por
  `worker_id` o por nombre (si coincide uno solo). `trabajadores {texto}` busca en `personal` y solo devuelve id, nombre y tipo.
  Conector: `buscar_trabajador`, `crear_licitacion`.
- `cambiar_estado` (`functions/proyectos/estado.js`, `/api/proyectos`): etapa con historial antes → después. La usan el
  panel del proyecto (cerrar, fijar cierre, aceptar oferta, factura → entregado) y la lista del cliente (editar).
  Conector: `cambiar_estado_proyecto`.
- Kay: `ESCRITURA_KAY` suma `crear_licitacion` y `cambiar_estado_proyecto`.
- Pruebas: licitaciones 8/8, proyectos 5/5, conector 36/36.

## PDF de la licitación en el servidor ✅ (2026-11-20)

- `public/js/pdf-licitacion.js` (`PdfLicitacion.generar`): el dibujo del PDF de propuesta (general y detallada) que antes
  vivía adentro de `licitaciones.html`. Lo usan la pantalla y el servidor (copia idéntica en `functions/pdf/compartido/`;
  `npm run sincronizar` en `tools/documentos`; la prueba avisa si difieren).
- `functions/documentos`: arma el PDF con jsPDF 4 + autotable 5 en Node (la pantalla sigue con 2.5.1 del CDN; misma API,
  mismo resultado: comparado página por página). Fotos: solo de nuestro Storage, pasadas a JPEG de ≤1600 px con sharp.
  Lo que no tiene el servidor: las artes gráficas que la pantalla carga en memoria (`_licArtsData`).
- Kay: `pdf_documento` en `kayApi` (1 GiB, 120 s) → base64 del PDF; queda una copia en `documentos/{cid}/{pid}/`.
- Cotización y órdenes ✅ (2026-11-21), mismo patrón:
  - `public/js/pdf-cotizacion.js` (`PdfCotizacion`): "Presupuesto maestro" y "con impuestos por ítem" de `presupuesto.html`,
    con `membrete` (logo + pie) que también usa el PDF del correo. La pantalla le pasa lo que tiene en pantalla; el servidor, lo
    guardado en `presupuesto` (`fecha`, `impuestos`, `descuento`, `descuento_pct`, `cond`) y `monto_cierre`.
  - `public/js/pdf-produccion.js` (`PdfProduccion`): órdenes de `produccion.html` (técnica/estructuras, impresión, impresión
    solo con captura, completa). `armarArtes(items, artes_data)` repite los pasos de la pantalla: las artes guardadas mandan
    y el resto sale de las medidas del APU.
  - Comparadas con jsPDF 2.5.1 (pantalla) y 4.2.1 (servidor): iguales.
- Propuesta detallada sin costos internos (2026-11-21, pedido del dueño): en licitaciones de mano de obra o de ítem completo,
  el modo detalle muestra **lo contratado** (tareas con su precio acordado) y los materiales del ítem solo como referencia de
  cantidades, **sin precios** (son costos del presupuesto de Rubik), y "TOTAL CONTRATADO". Llave en mano sigue con materiales
  y mano de obra con precios (son los acordados con el contratista).
- Liquidación de contrato ✅ (2026-11-21): `public/js/pdf-liquidacion.js` (`PdfLiquidacion`), el PDF "Liquidación" de
  `compras.html` (acordado, anticipos y pagos, saldo, anexo técnico y comprobantes). `pdf_documento {tipo: liquidacion, cid, pid, id}`.
- Pruebas: `tools/documentos` 7/7 (deja las páginas en `salida/` para mirarlas).

## Etapas siguientes

| Etapa | Área | Operaciones mínimas |
|---|---|---|
| 2 | Gantt (`gantt.html`, `licitaciones.html → autoAssignGantt`) | mover fechas de tarea/subtarea, avance, feriado, asignar desde licitación |
| 3 | Producción (`produccion.html`) | estado/avance del ítem, APU de producción |
| 4 | Diseño (`disenos.html`) | estado, aprobar versión, notas |
