# Dashboard del Proyecto

## Qué hace
HUB central de cada proyecto: muestra el resumen financiero (venta base, cierre + extras, gasto real, utilidad neta) y es el punto de entrada a todos los submódulos del proyecto (Diseños, Presupuesto, Gantt, Producción, Compras, Licitaciones, Requerimiento Asistido). También permite registrar anticipos/pagos del cliente, emitir facturas y enviar notas de cobro por mail con PDF adjunto.

## Archivo principal
`public/dashboard-proyecto.html`

## Cómo está armado
HTML/CSS/JS con Firebase Realtime DB. Usa jsPDF para generar PDFs de recibos y notas de cobro. Incluye un chat IA flotante (Gemini) con contexto del proyecto específico, y un módulo de escaneo IA de comprobantes/facturas (imagen o PDF). Carga `/js/firecache.js` y `/js/auth-guard.js`. El `cid` y `pid` se leen de `localStorage`.

## Estructura de datos en Firebase
- `/proyectos/$cid/$pid/nombre` — nombre del proyecto
- `/proyectos/$cid/$pid/presupuesto/` — para calcular venta base
- `/proyectos/$cid/$pid/cierre/` — monto de cierre negociado
- `/proyectos/$cid/$pid/pagos_cliente/` — pagos recibidos
- `/proyectos/$cid/$pid/facturas_emitidas/` — facturas registradas
- `/proyectos/$cid/$pid/visible_cliente` — flag de visibilidad en portal

## Archivos principales
- `public/dashboard-proyecto.html`
- `/js/firecache.js`
- `/js/auth-guard.js`

## Decisiones tomadas
- El dashboard no tiene datos propios; todo lo calcula leyendo los nodos del proyecto en tiempo real.
- Los módulos se abren pasando `cid` y `pid` por `localStorage` (no por URL params) para simplificar la navegación mobile.
- La negociación cliente-empresa ocurre aquí: el cliente puede enviar una contraoferta desde su portal, y el admin la acepta o contrapropone.
- El escaneo IA de boucher extrae monto y fecha automáticamente con Gemini Vision.

## Problemas conocidos y pendientes
- No hay historial de cambios ni auditoría de quién modificó el cierre.
- El cálculo de "Gasto Real" agrega datos de múltiples nodos y puede tardar en proyectos grandes.
