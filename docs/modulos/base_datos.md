# Base de Datos Maestra

## Qué hace
Directorio y matriz de costos de Rubik Ingeniería. Gestiona: personal/talleres (trabajadores internos, supervisores, contratistas, empresas de gráficos), proveedores, materiales con precios, mano de obra, gastos/equipos, APUs predefinidos, e inventario IA. Sirve como fuente de autocompletado y sincronización de precios en el presupuesto y producción.

## Archivo principal
`public/base_datos.html`

## Cómo está armado
HTML/CSS/JS con Firebase Realtime DB y Firebase Auth. Usa Phosphor Icons. Tiene un Cerebro Central IA (chat modal con Gemini) que puede escanear facturas, actualizar precios con lenguaje natural, responder consultas sobre proveedores y limpiar duplicados. La carga inicial descarga solo los 6 nodos necesarios en paralelo (optimización de rendimiento). Carga `/js/firecache.js`, `/js/auth-guard.js`, y `gemini-client.js` como módulo ES.

## Estructura de datos en Firebase
- `/personal/` — trabajadores, supervisores, contratistas, talleres (tipo, especialidad, sueldo, wsp)
- `/base_datos/proveedores/` — proveedores con categoría y teléfono
- `/base_datos/materiales/` — materiales con precio, unidad y proveedor referencial
- `/base_datos/mano_obra/` — tarifas de mano de obra por unidad
- `/base_datos/otros/` — gastos generales y equipos
- `/base_datos/inventario/` — inventario escaneado por IA

## Archivos principales
- `public/base_datos.html`
- `/js/firecache.js`
- `/js/auth-guard.js`
- `/js/gemini-client.js`

## Decisiones tomadas
- Antes la página descargaba 12MB completos del nodo raíz; se refactorizó para cargar solo ~250KB en paralelo.
- El chat IA tiene acceso de escritura a los nodos de la BD para actualizar precios directamente desde la conversación.
- La pestaña "Inventario IA" usa Gemini Vision para escanear herramientas/materiales sobrantes y registrarlos automáticamente.
- La limpieza de duplicados agrupa materiales por similitud de nombre y permite eliminarlos uno por uno.

## Problemas conocidos y pendientes
- Los APUs predefinidos se cargan como objeto vacío (`dbData.apu = {}`); la pestaña APUs no está completamente implementada.
- No hay control de versiones de precios; cada actualización sobreescribe el valor anterior.
