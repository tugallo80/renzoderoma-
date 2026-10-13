# Portafolio Web Admin

## Qué hace
Panel de administración para gestionar el portafolio público de rubikbolivia.com. Permite agregar, editar y eliminar proyectos que aparecen en `landing.html`. Cada proyecto tiene imagen, título, descripción y categoría. Incluye un importador masivo con IA que analiza imágenes y genera título/descripción/categoría automáticamente; también importa desde Google Drive o desde PDF (extrayendo una página por proyecto).

## Archivo principal
`public/portafolio-admin.html`

## Cómo está armado
HTML/CSS/JS oscuro (dark-only) con Firebase Realtime DB, Storage y Auth. Usa iconos inline SVG (sin Phosphor). El importador masivo procesa imágenes en lote llamando a Gemini para cada una y las sube a Storage. La importación desde Google Drive requiere configuración de OAuth2 en Google Cloud Console (con instrucciones inline). Carga `/js/auth-guard.js`.

## Estructura de datos en Firebase
- `/portafolio/` — colección de proyectos del portafolio: título, descripción, categoría, imagen URL (Storage), orden

## Archivos principales
- `public/portafolio-admin.html`
- `/js/auth-guard.js`

## Decisiones tomadas
- La interfaz es dark-only (estilo #000) para diferenciarse visualmente del resto del sistema.
- El importador con IA es el flujo principal para añadir muchos proyectos de una vez (se menciona "79 imágenes").
- La importación desde PDF usa pdf.js para extraer cada página como imagen y luego la analiza Gemini.
- Los proyectos en `/portafolio/` son independientes de `/proyectos/$cid/$pid/`; son entidades de portafolio público.

## Problemas conocidos y pendientes
- La integración con Google Drive requiere configurar manualmente `GDRIVE_CLIENT_ID` y `GDRIVE_API_KEY` en el código.
- No hay sistema de orden manual (drag & drop) para reordenar los proyectos del portafolio.
- El importador no deduplica; si se importa la misma imagen dos veces crea dos entradas.
