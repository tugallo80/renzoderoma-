# Licitaciones y Asignaciones

## Qué hace
Gestión de contratos externos y asignaciones internas de trabajo para un proyecto. Muestra un tablero kanban con tres columnas: Enviadas/Esperando, Revisión/Negociación, y Aprobadas. Permite crear licitaciones de tres tipos: Mano de Obra, Obra Vendida y Llave en Mano (M.O. + materiales + gráficos). Calcula la utilidad real del proyecto (cobrado − materiales − M.O. − impuestos).

## Archivo principal
`public/licitaciones.html`

## Cómo está armado
HTML/CSS/JS con Firebase Realtime DB, Storage y Auth. Usa jsPDF para generar PDFs de contratos. Tiene un medidor de producción mensual por trabajador interno (barra de progreso vs. sueldo fijo). El modal de nueva licitación permite asignar ítems del presupuesto, configurar porcentajes entre participantes, y definir precios de materiales gráficos por m². Carga `/js/firecache.js`, `/js/auth-guard.js`.

## Estructura de datos en Firebase
- `/proyectos/$cid/$pid/licitaciones/` — licitaciones con: trabajador, tipo, ítems asignados, monto, estado (pendiente/revision/aprobado), período de planilla, pagos
- `/personal/` — lista de trabajadores/talleres disponibles para asignar
- `/proyectos/$cid/$pid/presupuesto/items/` — ítems del presupuesto para seleccionar en la licitación
- `/proyectos/$cid/$pid/prints/` — artes gráficos para licitaciones de tipo gráfico

## Archivos principales
- `public/licitaciones.html`
- `/js/firecache.js`
- `/js/auth-guard.js`

## Decisiones tomadas
- Una licitación "Mano de Obra" solo tiene el costo de trabajo; "Obra Vendida" incluye todo (precio fijo al contratista); "Llave en Mano" desglosa M.O. + materiales + artes gráficos con precios por m².
- El medidor de producción mensual muestra qué porcentaje del sueldo fijo del trabajador ya se le ha asignado; si supera el 100% se activa el modo "cancheo".
- La adjudicación directa (sin proceso de licitación) tiene su propio flujo simplificado.
- Las licitaciones aprobadas alimentan el cálculo de utilidad real y el módulo de Tesorería.

## Problemas conocidos y pendientes
- No hay firma digital ni confirmación del contratista dentro del sistema.
- El historial de cambios de estado de una licitación no se registra.
