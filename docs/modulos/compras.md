# Compras y Materiales

## Qué hace
Gestión de compras y pagos a proveedores de un proyecto específico. Tiene dos pestañas: "Contratos y Anticipos" (solicitudes de compra de talleres/contratistas, estado de contratos con saldo pagado/adeudado, comprobantes de pago) y "Materiales e Insumos" (lista de materiales del presupuesto a comprar, actualización automática de precios desde la BD, historial de compras directas). Incluye chat IA financiero.

## Archivo principal
`public/compras.html`

## Cómo está armado
HTML/CSS/JS con Firebase Realtime DB, Storage y Auth. Usa jsPDF para imprimir la lista de materiales. Tiene un modal de pago con subida de foto del comprobante y lectura IA del monto (Gemini Vision). El tab de materiales cruza los APU de producción (`prod_apu.mat`) con los precios de la BD maestra para pre-llenar precios reales. Carga `/js/firecache.js`, `/js/auth-guard.js`.

## Estructura de datos en Firebase
- `/proyectos/$cid/$pid/licitaciones/` — licitaciones/contratos del proyecto (leídas aquí para mostrar estado)
- `/proyectos/$cid/$pid/presupuesto/items/` — ítems con sus APUs para extraer materiales
- `/proyectos/$cid/$pid/produccion/` — APU real de producción (`prod_apu.mat`) con materiales ajustados
- `/proyectos/$cid/$pid/compras_directas/` — historial de compras directas con comprobantes
- `/proyectos/$cid/$pid/licitaciones/$lid/pagos/` — pagos registrados contra cada contrato

## Archivos principales
- `public/compras.html`
- `/js/firecache.js`
- `/js/auth-guard.js`

## Decisiones tomadas
- La jerarquía de fuentes de materiales es: 1) `prod_apu.mat` (ajuste real de producción), 2) `compras_requeridas` (guardadas), 3) `apu.mat` (APU base del presupuesto).
- El botón "Reparar BD" cruza proveedores con materiales y repara vínculos faltantes.
- El pago de un contrato descuenta del saldo pendiente; si se marca como "gasto directo" no descuenta del contrato.
- El supervisor puede solicitar materiales desde `app-trabajador.html`; esas solicitudes aparecen aquí como "solicitudes de compra".

## Problemas conocidos y pendientes
- No hay flujo de aprobación multi-nivel para compras grandes.
- La notificación al supervisor al aprobar una compra se hace por WhatsApp manual.
