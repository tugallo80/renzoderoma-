# Integración Kay ↔ app de trabajo (Rubik OS)

Nexo para que **Kay** (asistente personal, repo `tugallo80/desarrollo-personal`, proyecto de Google Cloud
`desarrollo-personal-a831d`) pueda consultar y, más adelante, operar sobre la **app de trabajo** (Rubik OS,
repo `tugallo80/renzoderoma-`, proyecto `rubik-bolivia`). Este documento está igual en los dos repos.

Estado (2026-10-14): conexión desplegada con una sola acción de prueba, de solo lectura:
`listar_proyectos_activos` ("Kay, ¿qué proyectos tengo activos?").

## Principios

1. **La lógica de negocio vive en la app de trabajo.** Kay nunca lee ni escribe la Realtime Database de
   Rubik: pide acciones *por nombre* a una API (`kayApi`) y esa API decide qué hacer.
2. **Solo Renzo, a través de Kay.** Nadie más puede llamar a la API (ni siquiera desde un navegador con
   sesión de Rubik), y dentro de Kay solo la sesión de Renzo puede disparar estas acciones.
3. **Sin claves compartidas.** No hay ningún secreto que crear, copiar ni rotar en ninguno de los dos
   proyectos.
4. **Sumar funciones = agregar una entrada a un registro** de cada lado; el transporte y la seguridad ya
   están resueltos.

## Cómo viaja un pedido

```
Renzo (voz o Modo Kay)
  └─ Kay: herramienta trabajo_proyectos_activos  /  clasificarComando → {tipo:"trabajo"}
       └─ ejecutarComando (functions/index.js, desarrollo-personal)
            └─ llamarApiTrabajo (functions/trabajo.js)
                 1. ¿la sesión es renzoderoma@gmail.com con email verificado?  si no → corta
                 2. pide un token de identidad de Google al servidor de metadatos
                    (cuenta 65148659111-compute@developer.gserviceaccount.com, audiencia = URL de kayApi)
                 3. POST https://us-central1-rubik-bolivia.cloudfunctions.net/kayApi
                    { accion, params }   headers: Authorization + X-Kay-Token (el mismo token)
  ─────────────────────────────── proyecto rubik-bolivia ───────────────────────────────
                 4. Cloud Run: solo deja pasar tokens de esa cuenta (invoker: [cuenta de Kay])
                 5. kayApi (functions/kay-api.js, renzoderoma-): verifica de nuevo X-Kay-Token
                    (firma de Google, audiencia, email exacto de la cuenta de Kay)
                 6. busca la acción en ACCIONES y la ejecuta → { ok, accion, resultado }
       └─ textoResultadoTrabajo arma el texto que Kay dice / muestra en el chat
```

## Seguridad en detalle

| Capa | Dónde | Qué frena |
|---|---|---|
| Dueño de la sesión | `functions/trabajo.js` (Kay) → `esDuenio(uid)` | Otros usuarios de Kay (ej. variante "dania") |
| IAM de Cloud Run | `invoker: [KAY_SA]` en `kayApi` (lo aplica el propio deploy) | Cualquier request sin token de la cuenta de Kay — antes de que corra el código |
| Verificación en código | `verificarKay()` en `functions/kay-api.js` | Lo mismo, aunque alguien deje la función pública por error |
| Registro de acciones | `ACCIONES` en `kay-api.js` | Kay solo puede pedir lo que la API expone; nada de rutas arbitrarias |

- El token dura ~1 hora, está atado a la URL de `kayApi` (audiencia) y lo firma Google: no se guarda en
  ningún lado y no se puede reutilizar contra otro servicio.
- Va en dos headers porque Cloud Run, después de validar `Authorization`, le **saca la firma** antes de
  pasarlo al código; `X-Kay-Token` llega intacto y permite la verificación completa en `kayApi`.
- `kayApi` **no** está detrás de un rewrite de Hosting (`/api/...`): Hosting no manda token de identidad,
  así que con el IAM restringido un rewrite no funcionaría. Se llama a la URL directa.
- La cuenta que se autoriza es la de cómputo por defecto de las Functions de Kay, compartida por todas sus
  Functions. Si algún día se quiere acotar más, el paso es crear una cuenta de servicio dedicada (ej.
  `kay-nexo-trabajo@desarrollo-personal-a831d`), ponerla como `serviceAccount` solo en las Functions que
  usan el nexo, y cambiar `KAY_SA` en `kay-api.js`.

## Contrato de la API

`POST https://us-central1-rubik-bolivia.cloudfunctions.net/kayApi`

```json
{ "accion": "listar_proyectos_activos", "params": {} }
```

Respuestas: `200 { ok: true, accion, resultado }` · `400` acción desconocida · `401` token inválido (en el
código) · `403` rechazado por Cloud Run (HTML) · `405` método distinto de POST · `500` error interno (el
detalle queda en los logs de `kayApi`, no se le devuelve a Kay).

### Acciones disponibles

| Acción | Solo lectura | Params | Resultado |
|---|---|---|---|
| `listar_proyectos_activos` | sí | — | `{ total, proyectos: [{ cliente, nombre, estado, fecha, tipo }], terminados: { entregado, cancelado }, clientesLeidos }` |

`listar_proyectos_activos`: recorre `/proyectos/$cid/$pid` de todos los clientes y devuelve los que **no** están
`entregado` ni `cancelado`. El ciclo de vida completo de un proyecto es `requerimiento` → `cotizacion` →
`propuesta_enviada` → `negociando` → `contrato_firmado` → `planificacion` → `produccion` → `entregado` (o
`cancelado`), repartido entre `cliente-view.html`, `interno/dashboard.html`, `index.html` y
`proyectos-cliente.html`; sin estado cuenta como `planificacion`. (La primera versión solo contaba
`planificacion`/`produccion` — el selector de `proyectos-cliente.html` — y Kay respondía "no tenés proyectos
activos".) `terminados` y `clientesLeidos` sirven para diagnosticar un "0 activos": Kay los menciona en ese caso.
Por voz, más de 12 activos se resumen por estado + los 12 más recientes. Nombre del cliente: `empresa` o
`nombre`, como el hub. Lee con la REST API y `?shallow=true` para traer solo los campos simples del
proyecto (nombre, estado, fecha) y no bajarse presupuesto, APU, gantt, etc. del mismo nodo. Del cliente lee
solo `/clientes/$cid/nombre`. Ordenado por fecha, más nuevo primero.

## Del lado de Kay

- `functions/trabajo.js`: `llamarApiTrabajo(uid, accion, params)` — dueño, token y llamada.
- `functions/index.js`:
  - `ACCIONES_TRABAJO`: acciones que Kay sabe pedir.
  - `ejecutarComando` → rama `tipo: 'trabajo'` (genérica para todas las acciones).
  - `textoResultadoTrabajo`: cómo se cuenta cada resultado (lo usa `textoConfirmacionVoz`).
  - `mapearHerramientaAComando`: `trabajo_proyectos_activos` → `{ tipo: 'trabajo', accion: 'listar_proyectos_activos' }`.
  - `clasificarComando` (Modo Kay de texto): tipo (10) `{"tipo": "trabajo", "accion": ...}`.
- `src/lib/jarvisLiveHerramientas.js`: herramienta de voz `trabajo_proyectos_activos` + una línea en las
  instrucciones de Kay.
- Los proyectos **no** entran al contexto de Kay en cada turno (ni completo ni compacto de voz): se
  consultan solo cuando se piden.
- Queda en el "Registro de Kay" (Configuración) como cualquier otra herramienta de voz.

## Cómo sumar una función nueva

1. **renzoderoma-** — `functions/kay-api.js`: agregar una entrada a `ACCIONES`:
   ```js
   mi_accion: { soloLectura: true, descripcion: "...", ejecutar: async (params) => { /* validar params */ return {...} } },
   ```
   Validar `params` adentro (vienen de un modelo de IA). Para escrituras, reusar la misma lógica que usa la
   app (no escribir rutas "a mano" distintas a las del frontend) y marcar `soloLectura: false`.
2. Mergear `renzoderoma-` primero (el deploy de Functions sale solo porque cambia `functions/`).
3. **desarrollo-personal** — en `functions/index.js`: sumar la acción a `ACCIONES_TRABAJO`, su texto en
   `textoResultadoTrabajo`, el `case` en `mapearHerramientaAComando` y (si se quiere por texto) el ejemplo en
   el tipo (10) de `clasificarComando`. En `src/lib/jarvisLiveHerramientas.js`: la herramienta y, si hace
   falta, una línea en las instrucciones. Para acciones que **modifican** algo, que Kay lea lo que va a hacer
   y espere confirmación explícita antes de llamar la herramienta (como `responder_correo`).
4. Actualizar la tabla "Acciones disponibles" de este documento en **los dos repos**.

## Deploy y diagnóstico

- `renzoderoma-`: `firebase-hosting-merge.yml` despliega Functions con `FIREBASE_TOKEN` cuando cambia
  `functions/`; ese deploy aplica también el permiso de invocación (`invoker`). No hizo falta ningún paso
  manual ni secreto nuevo.
- `desarrollo-personal`: `deploy.yml` al mergear a `main`. Sin cambios nativos (no hace falta AAB).
- Si Kay dice "no pude consultar tu app de trabajo (401/403)": revisar que `KAY_SA` en `kay-api.js` siga
  siendo la cuenta con la que corren las Functions de Kay, y que `URL_API` / `URL_API_TRABAJO` coincidan
  (es la audiencia del token). Logs: Function `kayApi` en `rubik-bolivia` (prefijo `[kayApi]`) y
  `llamarApiTrabajo` en `desarrollo-personal`.
- La cuenta `claude-code` de las sesiones de Claude no tiene permisos en `rubik-bolivia`, así que desde la
  sesión no se pueden leer esos logs.
