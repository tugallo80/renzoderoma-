# Tesorería y Finanzas

## Qué hace
Central financiera global de la empresa. Consolida: buzón de licitaciones pendientes de aprobación, contratos activos, planillas de trabajadores y supervisores (con anticipos y cancheos), registro de ingresos por proyecto, resumen de impuestos (IVA/IT), y un consolidado por contratista con exportación a PDF. Muestra la utilidad neta total de caja.

## Archivo principal
`public/tesoreria.html`

## Cómo está armado
HTML/CSS/JS con Firebase Realtime DB y Storage. Librerías: jsPDF + jspdf-autotable, SheetJS/XLSX (exportar RCV SIAT para impuestos). Carga `/js/firecache.js`, `/js/auth-guard.js`, `/js/viewmode.js`. En mobile usa una barra de navegación inferior para cambiar entre las pestañas (Licitaciones, Cancheos, Planillas, Ingresos, Impuestos).

## Estructura de datos en Firebase
- `/proyectos/$cid/$pid/licitaciones/` — licitaciones por proyecto (leídas globalmente)
- `/proyectos/$cid/$pid/pagos_cliente/` — pagos recibidos de clientes
- `/personal/` — trabajadores con sueldo base
- `/supervisores/` — supervisores con sus planillas
- `/proyectos/$cid/$pid/anticipos/` — anticipos y pagos a trabajadores
- `/proyectos/$cid/$pid/cancheos/` — cancheos generados cuando el trabajador supera su meta

## Archivos principales
- `public/tesoreria.html`
- `/js/viewmode.js`
- `/js/firecache.js`
- `/js/auth-guard.js`

## Decisiones tomadas
- Las planillas de cancheo se autogeneran desde la pestaña Planillas cuando un trabajador supera su meta mensual; no se crean manualmente.
- El consolidado de contratistas cruza datos de múltiples proyectos para ver el total pagado/adeudado a cada proveedor.
- La exportación SIAT genera el archivo Excel con el formato requerido por el SIN (Bolivia).
- Los pagos a contratistas pueden registrarse con foto del comprobante y lectura IA del monto.

## Problemas conocidos y pendientes
- El módulo de "Ingresos" es básico y no tiene gráficas de tendencia.
- La conciliación bancaria no está implementada.
