# Hub Administrativo (index)

## Qué hace
Es la pantalla de inicio de Rubik OS: muestra el menú principal con accesos directos a todos los módulos del sistema. También aloja el "Cerebro Ejecutivo" (chat IA con visión global de proyectos y clientes) y el Laboratorio IA para editar los prompts del sistema.

## Archivo principal
`public/index.html`

## Cómo está armado
SPA de una sola pantalla en HTML/CSS/JS puro. Usa Firebase Auth (email/password) + Realtime DB. Íconos: Phosphor Icons. Incluye un modal de chat IA con dos modos: Consultor (Gemini vía Cloud Function) y Flash (generador de presupuesto rápido). También integra Gemini Live (llamada de voz en tiempo real con Web Audio). Carga `/js/firecache.js` y `/js/auth-guard.js` para caché y protección de ruta.

## Estructura de datos en Firebase
- `/clientes/` — leído para el badge de correo no leído
- `/notificaciones/hub/` — notificaciones globales
- `/feed_actividad/` — feed de actividad reciente
- `/config_ia/` — prompts del Cerebro Ejecutivo (editados desde el Laboratorio IA)

## Archivos principales
- `public/index.html`
- `/js/firecache.js`
- `/js/auth-guard.js`
- `/js/gemini-client.js` (importado como módulo ES)
- `/js/gemini-live.js` / `/js/cerebro-live.js` (Gemini Live)
- `/js/voice-utils.js`

## Decisiones tomadas
- El hub es PWA (manifest.json, apple-touch-icon) para poder instalarse en iOS/Android.
- El modo oscuro se toglea con `body.dark-mode` y se persiste por CSS custom properties.
- El botón de correo tiene un badge con contador de mensajes no leídos cargado desde Firebase.
- El Laboratorio IA (engranaje) permite editar prompts del sistema sin deployar código.

## Problemas conocidos y pendientes
- La pantalla home no tiene lista de proyectos recientes; el usuario siempre entra por "Clientes & Proyectos".
- El Cerebro Ejecutivo carga todo el contexto de clientes al inicio, lo que puede ser lento con muchos registros.
