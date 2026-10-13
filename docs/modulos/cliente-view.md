# Portal del Cliente (cliente-view)

## Qué hace
Portal web público/semipúblico para que el cliente final vea sus proyectos, el avance de obra, renders, presupuestos, estado de pagos y se comunique con Rubik. Es una PWA instalable. Incluye un juego de descuento (moneda y snake), un asistente IA propio, sección de requerimientos, y un sistema de negociación de precios (el cliente puede enviar contraoferta).

## Archivo principal
`public/cliente-view.html`

## Cómo está armado
SPA completa con múltiples vistas internas (landing, home, proyectos, finanzas, IA, juegos, requerimientos). Firebase Auth anónima + Realtime DB + Storage. Usa Phosphor Icons y registro de Service Worker (`/sw-cliente.js`) para PWA. El acceso puede estar protegido por PIN (hash SHA-256 almacenado en `/clientes/$cid/pin_hash`). El layout en desktop imita una red social (cover + avatar + nav tabs). Carga `/js/firecache.js`.

## Estructura de datos en Firebase
- `/clientes/$cid/` — datos del cliente (nombre, logo, rubro, cover, pin_hash)
- `/proyectos/$cid/` — todos los proyectos visibles del cliente (`visible_cliente: true`)
- `/proyectos/$cid/$pid/presupuesto/` — presupuesto escalado (precios con markup)
- `/proyectos/$cid/$pid/pagos_cliente/` — pagos registrados
- `/proyectos/$cid/$pid/gantt/` — avance del cronograma
- `/proyectos/$cid/$pid/disenos/` — renders y fotos para mostrar al cliente
- `/clientes/$cid/juego_moneda_jugado`, `/clientes/$cid/descuento_ganado` — estado de los mini-juegos

## Archivos principales
- `public/cliente-view.html`
- `/js/firecache.js`
- `public/sw-cliente.js` (Service Worker)
- `public/manifest-cliente.json`

## Decisiones tomadas
- Los precios del presupuesto se muestran con un markup ("precio escalado") diferente al costo real.
- El sistema de juegos (moneda/snake) ofrece al cliente un descuento como mecanismo de engagement.
- El acceso anónimo de Firebase permite que el cliente acceda sin crear cuenta, solo con el PIN.
- En desktop el layout se transforma en estilo red social (Facebook-like) con una cover photo ancha.

## Problemas conocidos y pendientes
- Los juegos de descuento tienen un sistema de "solo un intento" que puede resetearse desde `proyectos-cliente.html`.
- La sección de requerimientos en el portal del cliente redirige a `requerimiento-asistido.html` en modo cliente.
