# Requerimiento

## Qué hace
Punto de partida de un proyecto: el dueño carga lo que pidió el cliente (cliente, descripción por texto o dictado y
adjuntos de cualquier tipo, con fotos anotadas) **sin ejecutar ninguna IA**. Después Claude lo toma desde el proyecto
RUBIK AGENTE APP con el conector "Rubik". Detalle y decisiones: `docs/sesiones/06-render-requerimiento.md`.

## Archivo principal
`public/requerimiento.html` (tarjeta "Requerimiento nuevo" del inicio).

## Cómo está armado
- Guarda todo con `/api/requerimiento` (`functions/requerimientos/`); la base `/requerimientos` no se escribe desde el
  navegador. Lee `/requerimientos` y `/clientes` en vivo.
- Reusa del Agente IA, sin cambiarlos: `js/agente-anotador.js` (cotas y notas como datos), `js/importar-3d.js` +
  `js/lector-3d.js` (medir 3D en el navegador) y `js/vistas-3d.js` (vistas del 3D con el número de cada pieza).

## Estructura de datos en Firebase
- `/requerimientos/{id}`: estado, cliente, descripcion, titulo, adjuntos/{adj}, creado, actualizado, por (y cid/pid al asignar).
- Storage `requerimientos/{id}/{adj}/…`: original, anotada, medición y vistas del 3D, PDF u otro archivo.

## Pendientes
- Herramientas del conector para leerlo y asignarlo (entrega 4) y botón "Pedile a Claude".
