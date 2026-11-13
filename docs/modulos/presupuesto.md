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
- "Importar 3D" (`/js/lector-3d.js` + `/js/importar-3d.js`, three.js 0.170.0 por import map) lee .glb/.gltf/.fbx o
  `rubik.json` en el navegador, sin subir el archivo, y agrega ítems **al final** con `id`, `origen: "3d"`, `measures`
  y APU de materiales (filas sin precio o rendimiento quedan con `revisar`). Guarda `/base_datos/equivalencias_vw/`.
  Detalle: `docs/sesiones/02-cotizacion.md` (paso 2.3) y `tools/lector-3d/LEEME.md`.
- "Compartir → Rubik" (Android, hub instalado como app): `manifest.json` → `share_target`; `/compartir/sw-hub.js`
  (scope `/compartir/`, sin caché) guarda el archivo en IndexedDB y `presupuesto.html?importar3d=<id>` lo abre en
  "Importar 3D" y lo borra.

## Problemas conocidos y pendientes
- En proyectos con más de ~200 ítems el re-render puede ser lento.
- El historial de versiones del presupuesto no está implementado.
- (Sesión 6) Se retiraron el botón **Render**, el cubito "Render Axonométrico IA" de cada ítem y "⚡ Generar Render IA" del menú de la foto: ahora el botón **Requerimiento** abre `requerimiento.html` y el render lo hace Claude (`generar_render` / `aprobar_render` → `item.img`). El código de los modales viejos sigue, sin botones. **Presupuesto IA no se tocó** (usa su anotador `mod-medicion-pres`).
- La generación APU por lotes (Gemini) tiene `maxOutputTokens: 16000`; ítems muy complejos con muchos materiales/MO pueden seguir truncando si el JSON supera ese límite.
