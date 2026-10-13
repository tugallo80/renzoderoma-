# Diseños y Archivos

## Qué hace
Repositorio de archivos del proyecto organizado en pestañas: Renders, Fotos, Planos y Cortes (estructura por ítem del presupuesto), Documentación y Enlaces. Permite subir múltiples archivos, pegar imágenes desde el portapapeles (Ctrl+V), ver imágenes en un visor táctil con zoom, guardar en el dispositivo y compartir por WhatsApp.

## Archivo principal
`public/disenos.html`

## Cómo está armado
HTML/CSS/JS con Firebase Realtime DB y Firebase Storage. Usa Phosphor Icons. Incluye un visor de imágenes full-screen con gestos táctiles (pinch zoom), navegación entre fotos y descarga. La pestaña "Planos y Cortes" estructura las imágenes por ítem del presupuesto (acordeón). Los admins pueden subir/eliminar; los trabajadores (`mode=worker`) solo ven. Carga `/js/firecache.js`, `/js/auth-guard.js`. Tiene un chat IA para conceptualización de diseños.

## Estructura de datos en Firebase
- `/proyectos/$cid/$pid/disenos/renders/` — array de URLs de renders (Storage)
- `/proyectos/$cid/$pid/disenos/fotos/` — fotos del proyecto
- `/proyectos/$cid/$pid/disenos/planos/` — planos y cortes por ítem (indexado igual que presupuesto)
- `/proyectos/$cid/$pid/disenos/docs/` — documentos con URL y nombre
- `/proyectos/$cid/$pid/disenos/links/` — enlaces externos

## Archivos principales
- `public/disenos.html`
- `/js/firecache.js`
- `/js/auth-guard.js`

## Decisiones tomadas
- El paste global (Ctrl+V) detecta si hay un ítem activo (tab Planos) y sube al ítem, o si no va a la galería general.
- Los trabajadores acceden con `?mode=worker` en la URL y ven los mismos archivos pero sin controles de subida/eliminación.
- El módulo CAD se abre desde aquí como pantalla separada (`cad.html`).
- La herramienta de medición IA (`Medir`) permite acotar dimensiones sobre las imágenes.

## Problemas conocidos y pendientes
- Los PDFs se muestran en lista pero no se previsualizan inline (se abren en nueva pestaña).
- No hay orden manual de imágenes; se muestran por orden de subida.
