# Fix de seguridad — API key de Gemini

**Fecha del fix:** 16 de mayo de 2026
**Proyecto:** rubik-bolivia

---

## 1. Qué pasó

La API key de Google AI Studio para Gemini estaba **hardcodeada en 18 archivos
HTML servidos públicamente** por Firebase Hosting. Adicionalmente, el endpoint
`procesarIngestaIA` del Cloud Function tenía `Access-Control-Allow-Origin: '*'`
sin autenticación, así que cualquiera con la URL podía consumirlo.

Resultado: dos picos de consumo sospechosos consumieron el crédito de Gemini.

## 2. Qué se cambió

| Capa | Antes | Ahora |
|---|---|---|
| Frontend (HTML) | `const API_KEY = "AIza..."` en cada página | Importa `/js/gemini-client.js` (wrapper sin key) |
| Tránsito | `fetch('https://generativelanguage.googleapis.com/...?key=...')` | `POST` al Cloud Function con `Authorization: Bearer <Firebase ID token>` |
| Cloud Function | Key hardcoded, sin auth, CORS `*` | Key vía Secret Manager, valida ID token, CORS restringido a dominios de Rubik |
| Backups | `public/backups/` (servido públicamente, incluía export completo de la DB) | Movidos fuera de `public/` y al `.gitignore` |

Archivos modificados:

- `functions/index.js` — proxy `geminiProxy` autenticado, `procesarIngestaIA` ahora pide token, CORS endurecido
- `functions/package.json` — dependencia explícita `@google/generative-ai`
- `public/js/gemini-client.js` — **nuevo**, drop-in replacement del SDK
- 17 HTML del frontend — la key fue removida y la importación apunta al wrapper local
- `firebase.json` — agrega `backups/**` y patrones `.env` al `ignore` de hosting
- `.gitignore` — patrones para backups, exports de DB y credenciales sueltas

## 3. Pasos para terminar de cerrarlo

### 3.1 — Crear la nueva API key (NO la pegues en código)

1. https://aistudio.google.com/apikey → **Create API key**.
2. Asociala a tu proyecto `rubik-bolivia`.
3. Copiala una sola vez — la vas a pegar en el secret de Firebase, **no en archivos del repo**.

### 3.2 — Configurarla como Secret en Firebase Functions

Desde la raíz del proyecto en tu CMD:

```bash
firebase functions:secrets:set GEMINI_API_KEY
# te pide pegar la key; pegala y dale Enter
```

Para rotarla más adelante, mismo comando: pegás la key nueva y se hace una nueva versión.

### 3.3 — Instalar dependencia nueva y desplegar

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
firebase deploy --only hosting
```

El primer despliegue de funciones te puede pedir confirmar el binding del secret — decile que sí.

### 3.4 — Restringir la key en Google Cloud (defensa en profundidad)

Aunque la key ya no va al cliente, restringila igual:

1. https://console.cloud.google.com/apis/credentials → seleccioná `rubik-bolivia`.
2. Click en la nueva API key → **API restrictions** → marcá únicamente **Generative Language API**.
3. **Application restrictions** → no necesitás restringir por IP porque la key se usa desde Cloud Functions (IPs dinámicas). Dejala en "None" o "IP addresses" con el rango de Cloud Functions si querés ser estricto.

### 3.5 — Alerta de presupuesto

1. https://console.cloud.google.com/billing → tu cuenta de facturación → **Budgets & alerts**.
2. **Create budget** → proyecto `rubik-bolivia` → monto mensual (ej. USD 20).
3. Marcá umbrales 50%, 90%, 100% → habilitá email + Pub/Sub si querés cortar consumo automático.

### 3.6 — Cuota de uso en la Generative Language API

1. https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas → proyecto `rubik-bolivia`.
2. Bajá la cuota de requests por minuto / día a un número conservador (ej. 60 req/min, 5000/día). Si en un día normal usás menos, esto te protege de picos.

### 3.7 — Borrar la carpeta vacía `public/backups`

```cmd
rmdir C:\RUBIK_PROYECTO\public\backups
```

(Quedó vacía después del fix; tus backups reales viven ahora en `C:\RUBIK_PROYECTO\backups_local\`.)

### 3.8 — Bonus: el token de Meta/WhatsApp

En `public/comunicaciones.html` hay un `META_TOKEN = "EAAXD63SrvK..."` también expuesto.
Es un agujero distinto pero del mismo tipo:

1. https://developers.facebook.com → tu app → WhatsApp → Configuración → **revocar / regenerar token**.
2. Mové la llamada a Meta API al Cloud Function (mismo patrón que hicimos con Gemini) y guardá el nuevo token como otro secret:
   ```bash
   firebase functions:secrets:set META_WHATSAPP_TOKEN
   ```

## 4. Verificación rápida después del deploy

1. Loguearte a tu web normalmente.
2. Abrí cualquier módulo que use IA (ej. Chat IA o Compras).
3. Hacé una consulta de prueba.
4. En la consola del navegador, mirá la pestaña **Network** — deberías ver requests a `https://us-central1-rubik-bolivia.cloudfunctions.net/geminiProxy` con header `Authorization: Bearer eyJ...`, NUNCA a `generativelanguage.googleapis.com`.
5. Si abrís "Ver código fuente" en cualquier HTML, no debería aparecer ningún string `AIzaSy...` salvo la apiKey de Firebase en `login.html` (esa es pública por diseño).
