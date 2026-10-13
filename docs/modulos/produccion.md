# Control de Producción

## Qué hace
Tablero de control de fabricación por proyecto. Muestra los ítems del presupuesto como tarjetas de tarea con estado (pendiente/en proceso/instalado/listo), fotos de avance, APU real de producción con materiales y mano de obra, y una pestaña de "Área de Impresión" para gestionar artes gráficos con dimensiones, materiales y precios por m².

## Archivo principal
`public/produccion.html`

## Cómo está armado
HTML/CSS/JS con Firebase Realtime DB, Storage, Auth. Librerías: jsPDF + jspdf-autotable, html2canvas, html2pdf.js. Carga `/js/viewmode.js` (modo mobile con barra inferior), `/js/firecache.js`, `/js/auth-guard.js`. Incluye un visor de imágenes táctil (pinch/zoom), un panel de anotaciones (PAN) sobre fotos, y un motor IA para sugerir materiales y procesos basado en la descripción del ítem.

## Estructura de datos en Firebase
- `/proyectos/$cid/$pid/presupuesto/items/` — ítems base (descripción, cantidad, APU)
- `/proyectos/$cid/$pid/produccion/` — estado por ítem, fotos, notas, APU real (`prod_apu`)
- `/proyectos/$cid/$pid/prints/` — artes gráficos (dimensiones, material, precio, imagen referencia)
- `/base_datos/materiales/` — autocompletado de materiales en el APU de producción

## Archivos principales
- `public/produccion.html`
- `/js/viewmode.js`
- `/js/firecache.js`
- `/js/auth-guard.js`

## Decisiones tomadas
- Los ítems se leen del presupuesto; producción solo agrega el estado y las fotos encima.
- El APU real (`prod_apu`) es independiente del APU del presupuesto y puede diferir del estimado.
- Las fotos se suben a Firebase Storage y se referencian por URL en el nodo de producción.
- Solo los admins ven los botones de "Optimizar con IA" y "Exportar PDF"; los trabajadores tienen vista reducida.

## Problemas conocidos y pendientes
- La función de anotación sobre fotos (PAN) es experimental y puede tener problemas en iOS.
- No hay historial de cambios de estado por ítem.
