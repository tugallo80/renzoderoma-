# Proyectos del Cliente

## Qué hace
Carpeta de proyectos de un cliente específico. Muestra todos sus proyectos como iconos en una grilla estilo iOS con filtro por mes. Permite crear, editar, duplicar y eliminar proyectos, cambiar su estado, notificar al cliente por WhatsApp o correo, y controlar la visibilidad en el portal del cliente.

## Archivo principal
`public/proyectos-cliente.html`

## Cómo está armado
HTML/CSS/JS con Firebase Realtime DB, Storage y Auth. Usa Phosphor Icons. Los proyectos se muestran en una grilla `repeat(4, 1fr)` en mobile y `auto-fill minmax(88px)` en desktop. La foto de portada se puede subir, pegar (Ctrl+V), editar (rotar/brillo en canvas), o generar con IA (Gemini Imagen). Incluye un `long-press` para abrir el menú de acciones. Carga `/js/firecache.js`, `/js/auth-guard.js`.

## Estructura de datos en Firebase
- `/proyectos/$cid/` — todos los proyectos del cliente
- `/proyectos/$cid/$pid/` — datos del proyecto: nombre, status, fecha, visible_cliente, foto (URL Storage)
- `/clientes/$cid/juego_moneda_jugado`, etc. — limpiados desde aquí con "Limpiar Intentos"

## Archivos principales
- `public/proyectos-cliente.html`
- `/js/firecache.js`
- `/js/auth-guard.js`

## Decisiones tomadas
- Al crear un proyecto en "Modo Agencia" se abre `agencia.html` en lugar de `presupuesto.html` para el formato de cotización de agencia.
- El filtro por mes usa chips scrolleables horizontalmente basados en la fecha del proyecto.
- La duplicación de proyectos crea una copia completa del nodo Firebase (incluyendo presupuesto) con un nuevo `pid`.
- El botón "Ver como Cliente" abre `cliente-view.html` en una nueva pestaña para previsualizar el portal.

## Problemas conocidos y pendientes
- El editor de imagen inline (canvas) es básico: solo rotación y brillo.
- No hay búsqueda de proyectos dentro de la carpeta del cliente.
