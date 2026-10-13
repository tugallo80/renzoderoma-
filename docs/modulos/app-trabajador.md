# App Trabajador (interno)

## Qué hace
Aplicación mobile-first para los trabajadores internos de Rubik. Permite ver la agenda diaria con tareas asignadas por proyecto, actualizar el avance, ver los diseños/planos, solicitar materiales, gestionar la caja chica (rendición de gastos con foto de comprobante), y consultar saldo y cancheos. Incluye el Supervisor Rubik IA (chat técnico con Gemini), un escáner de inventario por foto, y un sistema de generación de PDFs de solicitud de materiales.

## Archivo principal
`public/interno/app-trabajador.html`

## Cómo está armado
HTML/CSS/JS con Firebase Realtime DB, Storage y Auth. Usa jsPDF para generar PDFs de solicitudes. Usa Phosphor Icons (desde unpkg). No carga `/js/auth-guard.js`; implementa su propio sistema de login/identificación de trabajador. La IA (Gemini) está integrada en el modal "Supervisor Rubik IA" con tres pestañas: chat técnico, solicitud de materiales, y escáner de inventario. El visor de fotos es táctil (full-screen).

## Estructura de datos en Firebase
- `/personal/` — datos del trabajador (nombre, tipo, especialidad)
- `/proyectos/$cid/$pid/gantt/items/` — tareas del día del trabajador
- `/proyectos/$cid/$pid/produccion/` — ítems de producción asignados al trabajador
- `/proyectos/$cid/$pid/disenos/` — planos y renders visibles
- `/caja_chica/$uid/` — saldo y movimientos de caja chica del trabajador
- `/base_datos/inventario/` — inventario escaneado por el trabajador

## Archivos principales
- `public/interno/app-trabajador.html`
- `/js/firecache.js`

## Decisiones tomadas
- La app usa rutas relativas (`../` para imágenes) porque está en el subdirectorio `/interno/`.
- El trabajador se identifica por `uid` de Firebase Auth; el sistema muestra solo sus tareas y saldo.
- El escáner de inventario usa Gemini Vision para identificar herramientas/materiales y registrarlos en `/base_datos/inventario/`.
- La solicitud de materiales genera un PDF descargable y se puede enviar por WhatsApp; no crea automáticamente un registro en compras (eso lo hace el admin desde `compras.html`).

## Problemas conocidos y pendientes
- El modo de grabación de voz (`btn-ai-mic`) está incluido pero la función de reconocimiento de voz no está completamente implementada para todos los dispositivos.
- No hay notificación al trabajador cuando se le asignan nuevas tareas; debe abrir la app para verlas.
