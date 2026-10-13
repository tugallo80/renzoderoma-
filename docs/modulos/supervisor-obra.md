# Supervisor de Obra

## Qué hace
Panel de control operativo para supervisores en terreno. Muestra el avance general del proyecto con barra de progreso, y permite gestionar: cronograma (actualizar avances por subtarea y subir fotos), diseños (acceso a planos del proyecto), producción (estado de ítems), compras (materiales y contratos), finanzas del proyecto y extras. Incluye un chat IA contextual con acceso a todo el proyecto.

## Archivo principal
`public/supervisor-obra.html`

## Cómo está armado
HTML/CSS/JS con Firebase Realtime DB y Storage. Usa Phosphor Icons. Se accede con parámetros `?cid=&pid=&wid=` en la URL (no depende de `localStorage`). El módulo lee todo el nodo del proyecto de una vez (`proyectos/$cid/$pid`) y renderiza las vistas desde esos datos. Tiene un visor de fotos táctil y carga `/js/firecache.js`, `/js/auth-guard.js`.

## Estructura de datos en Firebase
- `/proyectos/$cid/$pid/` — nodo completo del proyecto (presupuesto, gantt, produccion, compras, etc.)
- Escribe en `/proyectos/$cid/$pid/gantt/items/[idx]/subtasks/[key]/progress` — avance de subtarea
- Escribe en `/proyectos/$cid/$pid/gantt/items/[idx]/subtasks/[key]/fotos/` — fotos de avance

## Archivos principales
- `public/supervisor-obra.html`
- `/js/firecache.js`
- `/js/auth-guard.js`

## Decisiones tomadas
- El supervisor accede por URL directa (no necesita login de admin); usa Firebase Auth diferenciado para supervisores.
- Todo el contexto del proyecto se inyecta en `window.rubikContext` para que el chat IA lo use directamente.
- Las fotos se capturan con `capture="environment"` para abrir la cámara trasera directamente en mobile.
- Las pestañas "Finanzas" y "Extras" muestran información de solo lectura para el supervisor.

## Problemas conocidos y pendientes
- La vista de compras muestra solicitudes pero el supervisor no puede aprobarlas directamente (solo visualiza).
- No hay notificación push al admin cuando el supervisor sube una foto o actualiza el avance.
