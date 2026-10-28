# Tesorería y Finanzas

## Qué hace
Central financiera global de la empresa. Consolida: buzón de licitaciones pendientes de aprobación, contratos activos, planillas de trabajadores y supervisores (con anticipos y cancheos), registro de ingresos por proyecto, resumen de impuestos (IVA/IT), un consolidado por contratista con exportación a PDF, y un **tab Clientes** para el estado de cuenta y cobro por cliente.

## Archivo principal
`public/tesoreria.html`

## Cómo está armado
HTML/CSS/JS con Firebase Realtime DB y Storage. Librerías: jsPDF + jspdf-autotable, SheetJS/XLSX (exportar RCV SIAT para impuestos). Carga `/js/firecache.js`, `/js/auth-guard.js`, `/js/viewmode.js`. En mobile usa una barra de navegación inferior para cambiar entre las pestañas (Licitaciones, Cancheos, Planillas, Ingresos, Impuestos).

## Estructura de datos en Firebase
- `/proyectos/$cid/$pid/licitaciones/` — licitaciones por proyecto (leídas globalmente)
- `/proyectos/$cid/$pid/pagos/` — pagos recibidos de clientes (compartido con dashboard-proyecto.html)
- `/proyectos/$cid/$pid/monto_cierre` — monto de contrato fijo (override del presupuesto)
- `/proyectos/$cid/$pid/estado` — estado del proyecto (ver estados más abajo)
- `/personal/` — trabajadores con sueldo base
- `/supervisores/` — supervisores con sus planillas
- `/proyectos/$cid/$pid/anticipos/` — anticipos y pagos a trabajadores
- `/proyectos/$cid/$pid/cancheos/` — cancheos generados cuando el trabajador supera su meta

## Archivos principales
- `public/tesoreria.html`
- `/js/viewmode.js`
- `/js/firecache.js`
- `/js/auth-guard.js`

## Tab Clientes (Estado de Cuenta)
Agregado en octubre 2026. Consolida todos los proyectos de cada cliente para el cobro:
- Muestra clientes como tarjetas colapsadas (acordeón). Se expanden al hacer clic.
- **Filtro de estados**: solo aparecen proyectos en `produccion`, `entregado` o `cerrado`. Se excluyen `cotizacion` y `planificacion`.
- **Proyectos cerrados**: cuentan en el balance histórico (contratado + cobrado) pero con saldo = 0 (declarado liquidado). Badge verde "✓ Cerrado", sin checkbox ni botón de pago.
- **Checkboxes**: selección de proyectos a incluir en el PDF de cobro.
- **PDF**: botón grande al abrir el acordeón + botón chico siempre visible en el header. Usa jsPDF.
- Pagos leídos desde `/proyectos/$cid/$pid/pagos/` — el mismo nodo que usa `dashboard-proyecto.html`.

## Estados de proyecto
- `cotizacion` — propuesta inicial, sin contrato firmado. Solo visible en presupuesto/cotización.
- `planificacion` — proyecto aprobado pero aún no iniciado.
- `produccion` — en fabricación/ejecución.
- `entregado` — entregado al cliente, pendiente de cierre de cobro.
- `cerrado` — pagado y liquidado (declaración manual). Saldo = 0 en Tesorería Clientes.

## Decisiones tomadas
- Las planillas de cancheo se autogeneran desde la pestaña Planillas cuando un trabajador supera su meta mensual; no se crean manualmente.
- El consolidado de contratistas cruza datos de múltiples proyectos para ver el total pagado/adeudado a cada proveedor.
- La exportación SIAT genera el archivo Excel con el formato requerido por el SIN (Bolivia).
- Los pagos a contratistas pueden registrarse con foto del comprobante y lectura IA del monto.
- `--accent` no está definido en tesoreria.html; los botones PDF usan `#5856d6` explícito.

## Problemas conocidos y pendientes
- El módulo de "Ingresos" es básico y no tiene gráficas de tendencia.
- La conciliación bancaria no está implementada.
- El tab Clientes no tiene paginación: si hay muchos clientes con muchos proyectos puede ser lento.
