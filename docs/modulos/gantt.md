# Cronograma Gantt

## Qué hace
Cronograma interactivo tipo Gantt para planificar y controlar el avance de obra. Muestra los ítems del presupuesto como filas con barras de tiempo arrastrables, subtareas con porcentaje de avance, galería de fotos por tarea, y un indicador global de progreso del proyecto. Exportable a PDF (A3 landscape).

## Archivo principal
`public/gantt.html`

## Cómo está armado
HTML/CSS/JS puro con Firebase Realtime DB y Storage. Usa Phosphor Icons. El Gantt se renderiza sobre un contenedor con scroll horizontal; las celdas de día son divs de ancho fijo (`--day-w: 45px`). En modo mobile (portrait) muestra una lista de tarjetas en lugar del Gantt; en landscape muestra el Gantt real reduciendo el sidebar. Implementa un selector de feriados/días libres. Carga `/js/viewmode.js`, `/js/firecache.js`, `/js/auth-guard.js`.

## Estructura de datos en Firebase
- `/proyectos/$cid/$pid/gantt/` — estructura del cronograma: fechas de inicio/fin del proyecto, items con sus subtareas (nombre, fecha inicio, fecha fin, progreso, responsable, fotos)
- `/proyectos/$cid/$pid/gantt/feriados/` — días no laborables configurados

## Archivos principales
- `public/gantt.html`
- `/js/viewmode.js`
- `/js/firecache.js`
- `/js/auth-guard.js`

## Decisiones tomadas
- Los ítems del Gantt están indexados igual que los del presupuesto para mantener correspondencia.
- La impresión CSS usa `@page { size: A3 landscape }` y elimina el `position:sticky` del header para evitar overlaps en el PDF.
- En mobile landscape el sidebar se reduce a 160px para dar más espacio al timeline.
- Las fotos de avance se vinculan directamente desde el módulo de Producción.

## Problemas conocidos y pendientes
- No hay lógica de dependencias entre tareas (predecessoras).
- El arrastre de barras para mover fechas no está implementado; las fechas se editan en un modal.
- En proyectos con muchos ítems el scroll horizontal puede ser incómodo en móvil portrait.
