# Sesión 1 — Cerrar `/api/imagen` (`proxyImagen`)

Pendiente de la Prioridad 2 (Seguridad) de la Sesión 0. Ver `docs/plan-sesiones.md`.

**Estado (6 nov 2026):** cambio implementado y desplegado. Se aceptan los buckets
`rubik-bolivia.firebasestorage.app` y `rubik-bolivia.appspot.com` (por si hay comprobantes viejos) y solo
JPEG, PNG, GIF y WebP. Falta la prueba 3 (PDF real) que hace el dueño.

## Qué es hoy

- Function `proxyImagen` en `functions/index.js` (sección "PROXY IMÁGENES"), expuesta en
  `rubikbolivia.com/api/imagen` por el rewrite de `firebase.json`.
- Configuración: `invoker: "public"`, sin login. Recibe `?url=` y hace `fetch(url)` a **cualquier** dirección,
  devuelve el cuerpo con el `Content-Type` que mande el origen y agrega `Access-Control-Allow-Origin: *`.
- Para qué existe: armar el PDF de "Auditoría Impositiva IVA/IT" en `public/tesoreria.html`
  (`urlToBase64`). Pasa a base64 la foto del comprobante de cada compra facturada, que está en
  Firebase Storage (bucket `rubik-bolivia.firebasestorage.app`). El navegador no puede leerla directo por CORS.
- Es el **único** lugar del código que la usa.

## Por qué es un riesgo

1. **Proxy abierto**: cualquiera en internet puede usar nuestra Function para bajar cualquier cosa. Eso
   nos cuesta (tiempo de CPU y tráfico) y hace que los pedidos salgan desde Google con nuestro proyecto.
2. **Contenido ajeno servido desde `rubikbolivia.com`**: si alguien pasa la URL de una página HTML suya, la
   respuesta llega con `Content-Type: text/html` desde nuestro dominio. Ese HTML corre con el origen de la
   app, donde está guardada la sesión de Firebase del dueño (XSS). Con un enlace armado alcanza para
   intentarlo.
3. **Pedidos internos (SSRF)**: puede apuntar a direcciones internas de Google. El servidor de metadata
   exige un encabezado especial y por eso hoy no responde, pero queda la puerta abierta.

## Cambio propuesto (solo código, se despliega al mergear)

**En la Function (`functions/index.js`):**
- Exigir login con la lista blanca: usar el `requireAuth(req, res)` que ya existe (ID token + `/acceso/hub/{uid}`).
- Aceptar solo URLs de nuestro Storage: `https://firebasestorage.googleapis.com/v0/b/rubik-bolivia.firebasestorage.app/o/...`
  (comparar `URL.host` y el prefijo del `pathname`, no con `includes`). Cualquier otra → 400.
- `fetch(url, { redirect: "error" })` para que no la redirijan afuera del bucket.
- Devolver solo `image/*` (si no, 415) y cortar en un tamaño máximo (por ejemplo 10 MB → 413).
- Encabezados de respuesta: `X-Content-Type-Options: nosniff`, `Cache-Control: private, max-age=3600`.
  Sacar `Access-Control-Allow-Origin: *` (se llama desde el mismo dominio vía el rewrite).
- No devolver `e.message` al cliente; loguearlo y responder un error genérico.

**En la página (`public/tesoreria.html`, `urlToBase64`):**
- Mandar `Authorization: Bearer ${await _getHubToken()}`, igual que las otras llamadas de esa página.

## Alternativa descartada por ahora

Configurar CORS en el bucket y borrar la Function: el navegador bajaría la imagen directo. Queda más
simple, pero hay que hacerlo en Cloud Shell (`gcloud storage buckets update --cors-file`) y probarlo
con todas las URLs viejas de comprobantes. Se puede retomar más adelante. Restringir la Function cierra el
riesgo hoy sin tocar la consola.

## Prueba (después del deploy)

1. Sin login: `curl -i "https://rubikbolivia.com/api/imagen?url=https://example.com"` → **401**.
2. Con login pero URL de otro sitio → **400** (se prueba desde la consola del navegador en la app con la sesión
   del dueño: `fetch('/api/imagen?url=' + encodeURIComponent('https://example.com'), {headers:{Authorization:'Bearer '+await firebase.auth().currentUser.getIdToken()}}).then(r=>r.status)`).
3. Uso real: en Tesorería, generar el PDF de Auditoría Impositiva de un mes con compras que tengan foto de
   comprobante → las fotos tienen que salir en el PDF.

## Al terminar

- Marcar en `docs/plan-sesiones.md` (Prioridad 2) el ítem de `/api/imagen` y sacarlo de "Pendientes para la próxima sesión".
