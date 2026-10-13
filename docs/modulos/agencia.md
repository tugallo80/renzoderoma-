# Presupuesto Agencia

## Qué hace
Módulo de cotización en formato de agencia (para proyectos de eventos, stands, activaciones). Organiza el presupuesto en secciones con una tabla de ítems (detalle, cantidad, días, costo unitario, total). Calcula subtotal, fee de agencia (%), impuestos (%), y total final. Soporta multi-moneda (Bs y USD con tipo de cambio configurable), paquetes de proyecto con colores, y filtrado por socio/proveedor. Exporta a PDF (imprimible), Excel y tiene modo compartir link para socios.

## Archivo principal
`public/agencia.html`

## Cómo está armado
HTML/CSS/JS con Firebase Realtime DB, Storage y Auth. Librerías: SheetJS/XLSX (Excel), fflate (compresión). Usa Phosphor Icons. Tiene un sistema de paquetes (color-coded) para agrupar secciones. El modo "Modo Socio" oculta botones internos y muestra un badge. La barra de acción inferior es fija; hay también un panel de mini-totales flotante por encima de ella. Carga `/js/firecache.js`, `/js/auth-guard.js`.

## Estructura de datos en Firebase
- `/proyectos/$cid/$pid/agencia/` — datos completos del presupuesto de agencia: meta (cliente, actividad, fechas, tipo de cambio, fee, impuestos), secciones con ítems, logos, paquetes
- `/personal/` — lista de socios/colaboradores para asignar ítems

## Archivos principales
- `public/agencia.html`
- `/js/firecache.js`
- `/js/auth-guard.js`

## Decisiones tomadas
- Es un módulo separado de `presupuesto.html` porque el formato de agencia (secciones tabulares con días, fee %, multi-socio) es diferente del presupuesto de obra.
- Se activa al crear un proyecto con el toggle "Modo Agencia" en `proyectos-cliente.html`.
- El tipo de cambio Bs/$ se configura por presupuesto; los ítems en USD se convierten antes del fee.
- El link de compartir con socios genera una URL con token que activa el "Modo Socio" (solo lectura de las secciones asignadas).

## Problemas conocidos y pendientes
- La importación IA de ítems desde texto/PDF está disponible pero es experimental.
- No hay historial de versiones del presupuesto de agencia.
