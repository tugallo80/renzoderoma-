# Presupuesto Maestro

## Qué hace
Editor completo de presupuestos por proyecto. Permite armar ítems con cantidad, precio unitario y APU (análisis de precios unitarios), organizados en capítulos arrastrables. Calcula subtotal, descuento, IVA 13%, IT 3% y total en bolivianos. Exporta a PDF, Excel y permite enviar por correo.

## Archivo principal
`public/presupuesto.html`

## Cómo está armado
HTML/CSS/JS puro con Firebase Realtime DB y Storage. Librerías: JSZip, SortableJS (drag & drop de capítulos/ítems), jsPDF + jspdf-autotable (PDF), SheetJS/XLSX (Excel), pdf.js (lectura de PDFs importados para extracción IA). Carga `/js/firecache.js`, `/js/auth-guard.js`, `/js/apu-utils.js` (utilidades APU) y `/js/viewmode.js` (adaptación desktop/mobile). El modo mobile activa una barra de acciones inferior fija.

## Estructura de datos en Firebase
- `/proyectos/$cid/$pid/presupuesto/` — objeto con ítems, condiciones (pago, validez, montaje, desmontaje, impuestos), descuento y fecha
- `/base_datos/materiales/`, `/base_datos/mano_obra/`, `/base_datos/otros/` — autocompletado de precios desde la BD maestra

## Archivos principales
- `public/presupuesto.html`
- `/js/apu-utils.js`
- `/js/viewmode.js`
- `/js/firecache.js`
- `/js/auth-guard.js`

## Decisiones tomadas
- pdf.js se usa solo para leer/renderizar PDFs importados (extracción IA), no para generar; jsPDF genera los PDFs de salida.
- El botón "Actualizar Precios BD" sincroniza los precios de cada ítem con la base de datos maestra.
- El modo "Copiar ítems" permite seleccionar ítems y copiarlos a otro proyecto.
- El "Presupuesto IA" llama a Gemini para generar ítems desde una descripción de texto o imagen.

## Problemas conocidos y pendientes
- En proyectos con más de ~200 ítems el re-render puede ser lento.
- El historial de versiones del presupuesto no está implementado.
- La integración de Render 3D está como botón pero la funcionalidad depende de un servicio externo.
