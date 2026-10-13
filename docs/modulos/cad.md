# CAD (Editor Vectorial)

## Qué hace
Editor vectorial 2D en el navegador para crear planos y esquemas técnicos. Soporta herramientas de línea, rectángulo, círculo, texto, medida/cota, y selección. Tiene sistema de capas (layer panel deslizable), grilla configurable, modos de unidad (mm/cm/m/px) y exportación. Permite guardar en Firebase y volver al módulo de Diseños.

## Archivo principal
`public/cad.html`

## Cómo está armado
HTML/JS puro con un `<canvas>` 2D como superficie de dibujo. Firebase Realtime DB para persistencia del archivo CAD. Usa Phosphor Icons (cargado desde unpkg). La interfaz tiene una top bar fija con herramientas y una bottom bar con herramientas secundarias. El panel de capas es un drawer lateral deslizable. No carga `/js/firecache.js`; solo usa `/js/auth-guard.js` para proteger la ruta.

## Estructura de datos en Firebase
- `/proyectos/$cid/$pid/cad/` — datos del archivo CAD (capas, formas, propiedades de canvas)

## Archivos principales
- `public/cad.html`
- `/js/auth-guard.js`

## Decisiones tomadas
- El canvas usa `touch-action: none` para capturar todos los eventos táctiles y evitar scroll no deseado.
- Las capas se pueden ocultar/bloquear individualmente para facilitar el trabajo con diseños complejos.
- La grilla con snapping facilita el dibujo preciso; el espaciado es configurable en tiempo real.
- No depende de ninguna librería de terceros para el motor de dibujo; todo está implementado en vanilla JS.

## Problemas conocidos y pendientes
- No hay exportación a DXF/SVG; solo se puede guardar en Firebase o hacer captura del canvas.
- El historial de deshacer/rehacer (undo/redo) es limitado.
- La herramienta de texto no soporta estilos avanzados (negrita, tamaño variable).
