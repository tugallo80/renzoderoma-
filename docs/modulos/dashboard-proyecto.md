# Dashboard del Proyecto

## Qué hace
HUB central de cada proyecto: muestra el resumen financiero (venta base, cierre + extras, gasto real, utilidad neta) y es el punto de entrada a todos los submódulos del proyecto (Diseños, Presupuesto, Gantt, Producción, Compras, Licitaciones, Requerimiento Asistido). También permite registrar anticipos/pagos del cliente, emitir facturas y enviar notas de cobro por mail con PDF adjunto.

## Archivo principal
`public/dashboard-proyecto.html`

## Cómo está armado
HTML/CSS/JS con Firebase Realtime DB. Usa jsPDF para generar PDFs de recibos y notas de cobro. Incluye un chat IA flotante (Gemini) con contexto del proyecto específico, y un módulo de escaneo IA de comprobantes/facturas (imagen o PDF). Carga `/js/firecache.js` y `/js/auth-guard.js`. El `cid` y `pid` se leen de `localStorage`.

## Estructura de datos en Firebase
- `/proyectos/$cid/$pid/nombre` — nombre del proyecto
- `/proyectos/$cid/$pid/estado` — estado del proyecto (`cotizacion`/`planificacion`/`produccion`/`entregado`/`cerrado`)
- `/proyectos/$cid/$pid/presupuesto/` — para calcular venta base
- `/proyectos/$cid/$pid/monto_cierre` — monto fijo de cierre (override del presupuesto; eliminar para revincularlo)
- `/proyectos/$cid/$pid/pagos/` — pagos recibidos del cliente (compartido con tab Clientes de Tesorería)
- `/proyectos/$cid/$pid/facturas_emitidas/` — facturas registradas
- `/proyectos/$cid/$pid/visible_cliente` — flag de visibilidad en portal

## Archivos principales
- `public/dashboard-proyecto.html`
- `/js/firecache.js`
- `/js/auth-guard.js`

## Flujo de estados (botones rápidos en Cierre y Facturación)
- "Cerrar Trato" / "Fijar Monto" → `produccion`
- "Guardar Factura" → `entregado`
- **"Cerrar Proyecto (Pagado/Liquidado)"** → `cerrado` (solo visible cuando estado = `entregado`)

## Monto de cierre
- Si se fija un monto manual, se desvincula del presupuesto. Un aviso naranja lo indica.
- El botón **×** junto al campo elimina `monto_cierre` de la DB y vuelve a usar el presupuesto.

## Decisiones tomadas
- El dashboard no tiene datos propios; todo lo calcula leyendo los nodos del proyecto en tiempo real.
- Los módulos se abren pasando `cid` y `pid` por `localStorage` (no por URL params) para simplificar la navegación mobile.
- La negociación cliente-empresa ocurre aquí: el cliente puede enviar una contraoferta desde su portal, y el admin la acepta o contrapropone.
- El escaneo IA de boucher extrae monto y fecha automáticamente con Gemini Vision.
- Los pagos registrados aquí (`/proyectos/$cid/$pid/pagos/`) son los mismos que lee Tesorería tab Clientes.

## Problemas conocidos y pendientes
- No hay historial de cambios ni auditoría de quién modificó el cierre.
- El cálculo de "Gasto Real" agrega datos de múltiples nodos y puede tardar en proyectos grandes.
- Al cerrar un proyecto, el saldo en Tesorería queda en 0 sin verificar si los pagos registrados cubren el monto de cierre.
