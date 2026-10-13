# Correo

## Qué hace
Cliente de correo electrónico integrado en Rubik OS. Muestra las bandejas (Inbox, Enviados, Borradores, etc.), permite leer mensajes con soporte HTML, responder, responder a todos, reenviar y redactar nuevos correos. Incluye un panel IA que resume la bandeja de entrada o redacta respuestas con Gemini.

## Archivo principal
`public/correo.html`

## Cómo está armado
HTML/CSS/JS puro con Firebase Auth para identificar al usuario. No usa Firebase Realtime DB directamente; las operaciones de correo se hacen contra una Cloud Function (o servicio de backend) autenticada que expone la cuenta de Gmail/IMAP. Layout de tres columnas: sidebar (carpetas), lista de mensajes y panel de lectura. Responsive mobile: el sidebar es un drawer, la lista y el panel se alternan. Tiene un FAB para redactar en mobile. El panel IA es un drawer inferior que llama a Gemini.

## Estructura de datos en Firebase
- No escribe en Realtime DB. Usa Firebase Auth solo para autenticación del usuario.
- Los mensajes se cargan y envían a través del backend (Cloud Function).

## Archivos principales
- `public/correo.html`
- `/js/firecache.js` (no cargado en esta página)

## Decisiones tomadas
- El layout imita a clientes de correo de escritorio (Gmail/Mail.app) con tres columnas en desktop y vista single-column en mobile.
- Los mensajes HTML se renderizan en un `<iframe>` para aislar estilos externos.
- El badge de mensajes no leídos se muestra en el botón de correo del hub (index.html).
- La paginación de la lista es por páginas (anterior/siguiente) en lugar de scroll infinito.

## Problemas conocidos y pendientes
- La integración con el backend de correo depende de una Cloud Function no documentada aquí; si el token IMAP expira hay que reconfigurar.
- No hay soporte para adjuntos en la vista de lectura (solo texto/HTML).
- La búsqueda filtra solo los mensajes ya cargados en memoria, no hace búsqueda remota en el servidor.
