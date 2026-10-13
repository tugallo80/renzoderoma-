# Directorio de Clientes

## Qué hace
Gestiona el directorio de empresas/clientes de Rubik. Permite crear, editar y eliminar clientes con logo, rubro, WhatsApp, email, imagen de portada (cover para el timeline del portal) y un PIN de acceso de 4 dígitos para el portal del cliente.

## Archivo principal
`public/clientes.html`

## Cómo está armado
HTML/CSS/JS puro con Firebase Realtime DB y Firebase Storage (logos y covers). Usa Phosphor Icons. Implementa un caché local en `localStorage` (`rubik_clients_meta`) para mostrar la lista instantáneamente antes de que se resuelva la autenticación. El PIN se almacena como hash SHA-256 usando la Web Crypto API. La portada puede generarse con IA (Gemini). Carga `/js/firecache.js` y `/js/auth-guard.js`.

## Estructura de datos en Firebase
- `/clientes/$cid/` — datos del cliente: nombre, rubro, wsp, email, logo (URL Storage), cover (URL Storage), pin_hash, fecha_creacion, fecha_mod

## Archivos principales
- `public/clientes.html`
- `/js/firecache.js`
- `/js/auth-guard.js`
- `/css/responsive.css`

## Decisiones tomadas
- El PIN se hashea en el navegador con SHA-256; nunca viaja en texto plano.
- El caché local muestra la lista al instante (UX offline-first).
- El cover se puede generar con IA usando Gemini a partir del nombre/rubro del cliente.
- Al tocar un cliente se navega a `proyectos-cliente.html` guardando el `cid` en `localStorage`.

## Problemas conocidos y pendientes
- No hay paginación; con muchos clientes la lista puede volverse lenta.
- La eliminación de cliente no limpia automáticamente sus proyectos ni archivos en Storage.
