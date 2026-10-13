# Requerimiento Asistido

## Qué hace
Herramienta para que el admin arme un formulario de requerimiento de medidas y lo envíe al cliente. El admin define ítems (con foto de referencia/render y descripción técnica), elige qué dimensiones necesita que el cliente mida, y Gemini estructura el APU y precio estimado por ítem. Cuando el cliente responde con sus medidas, la IA recalcula y el admin aprueba e inyecta los ítems directamente en el presupuesto del proyecto.

## Archivo principal
`public/requerimiento-asistido.html`

## Cómo está armado
HTML/CSS/JS con Firebase Realtime DB, Storage y Auth. Librerías: jsPDF (exportar PDF), SheetJS/XLSX (exportar Excel). Tiene un modal de edición de ítem con uploader de foto, selector de dimensiones por chips, y un panel de lectura de cotas del plano con IA (Gemini Vision). El estado del requerimiento fluye: borrador → enviado → medidas_recibidas → aprobado. Carga `/js/firecache.js`, `/js/auth-guard.js`.

## Estructura de datos en Firebase
- `/requerimientos_asistidos/$cid/$pid/$reqId/` — datos del requerimiento: título, nota, estado, ítems (cada ítem con descripción, foto URL, dimensiones a pedir, respuestas del cliente, APU generado por IA, precio estimado)
- `/proyectos/$cid/$pid/req_asistido_id/` — referencia al `reqId` activo del proyecto

## Archivos principales
- `public/requerimiento-asistido.html`
- `/js/firecache.js`
- `/js/auth-guard.js`

## Decisiones tomadas
- El flujo es admin-first: el admin define los ítems y los manda al cliente; el cliente mide y responde desde su portal (`cliente-view.html`).
- "Estructurar con IA" llama a Gemini con la descripción técnica (no visible al cliente) y genera un APU completo con materiales y precios.
- "Leer con IA" sobre la imagen del plano extrae las cotas automáticamente para pre-llenar el panel de medidas.
- "Aprobar e Inyectar" crea ítems reales en `/proyectos/$cid/$pid/presupuesto/items/` usando los datos del APU generado.

## Problemas conocidos y pendientes
- No hay notificación automática al cliente cuando se crea o actualiza un requerimiento; se notifica manualmente por WhatsApp o correo desde el botón "Enviar al Cliente".
- Un proyecto solo puede tener un requerimiento activo a la vez; no hay historial de requerimientos anteriores.
