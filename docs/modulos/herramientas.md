# Herramientas

## Qué hace
Página de descarga del Rubik Agent, un agente IA de escritorio para Windows. El agente controla el mouse y teclado del PC usando lenguaje natural, permitiendo ejecutar tareas en Vectorworks, navegadores y cualquier programa de Windows. La página provee instrucciones de instalación paso a paso y los tres archivos necesarios para correr el agente.

## Archivo principal
`public/herramientas.html`

## Cómo está armado
Página HTML/CSS estática sin JavaScript dinámico ni Firebase. Usa Phosphor Icons (CDN unpkg). Diseño responsive con soporte automático de modo oscuro vía `@media (prefers-color-scheme: dark)`. No requiere autenticación; es accesible públicamente. Los archivos se sirven estáticamente desde `/downloads/rubik-agent/`.

## Estructura de datos en Firebase
No usa Firebase. Los archivos de descarga son estáticos en Firebase Hosting.

## Archivos principales
- `public/herramientas.html`
- `public/downloads/rubik-agent/agent.py` — script Python del agente
- `public/downloads/rubik-agent/requirements.txt` — dependencias Python
- `public/downloads/rubik-agent/INSTALAR.md` — instrucciones de instalación

## Decisiones tomadas
- La página es completamente estática para que sea accesible sin login y cargue rápido.
- Los tres archivos del agente se sirven con el atributo `download` para forzar la descarga en lugar de abrirlos en el navegador.
- El agente Python se autentica con el email y contraseña de rubikbolivia.com al iniciarse (no requiere API key separada).
- Las instrucciones se muestran inline en la misma página para minimizar fricción.

## Problemas conocidos y pendientes
- El agente solo soporta Windows; no hay versión para macOS o Linux.
- La versión del agente no está versionada en la URL; actualizar `agent.py` sobreescribe el archivo sin aviso a usuarios que ya lo descargaron.
