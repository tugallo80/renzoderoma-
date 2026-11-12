# Sesión 5 — RUBIK AGENTE APP (cotizar desde Claude con la suscripción)

**Objetivo:** en la app de Claude (celular y PC) hay un proyecto **"RUBIK AGENTE APP"**. Cada chat es una cotización y guarda su
contexto. Desde ahí Claude opera la app de Rubik (rubikbolivia.com) con el conector **Rubik**: clientes, proyectos,
presupuestos, base y borrador del Agente IA. Las cotizaciones las hace Claude con **tu suscripción**, no con la API que se paga
por uso (el Agente IA de la app sigue funcionando igual, con su medidor de costos).

| Etapa | Qué | Estado |
|---|---|---|
| 1 | Login (OAuth) + leer clientes, proyectos, presupuesto y base + crear cliente y proyecto + cotizar hasta el borrador y aplicarlo + skill + esta guía | ✅ PR de esta etapa |
<<<<<<< HEAD
| 1b | Ajustar cotizaciones existentes: listar cotizaciones, retomar desde un ítem (también las viejas del chat de la app), nueva versión y apagar la anterior con propuesta → confirmación (pedido de la sesión maestra, caso STAND NEXCORP) | ✅ PR de esta entrega |
=======
>>>>>>> origin/claude/rubik-conector-mcp
| 2 | Mantenimiento de la base: precios, materiales nuevos, duplicados (propuesta → confirmación → respaldo) | pendiente |
| 3 | Cronograma, producción, impresiones y licitaciones desde los ítems aplicados | pendiente |

---

## Guía para el dueño (paso a paso)

### 0. Antes de empezar
- Necesitás un plan **Pro o Max** de Claude (los skills no están en el plan gratis).
- La cuenta para entrar es **la misma de la app de Rubik** (tu email y contraseña). Solo entran las cuentas autorizadas.
- Los pasos 1 a 3 se hacen **una sola vez, en la PC** (claude.ai en el navegador o la app de escritorio). Después, todo
  queda también en el celular.

### 1. Agregar el conector "Rubik"
1. En claude.ai: **Customize (Personalizar) → Connectors (Conectores)**.
2. **＋ Add → Add custom connector** (Agregar conector personalizado).
3. Nombre: `Rubik` · URL: **`https://rubikbolivia.com/mcp`**.
4. En *Authentication* dejá **Sign in now** (iniciar sesión ahora). En *OAuth client*, la opción recomendada
   (**Use Claude's published identity**); si diera error, probá **Register automatically**. No hace falta poner client id ni clave.
5. **Add**. Se abre la pantalla **"Conectar Claude con Rubik"**: entrá con tu email y contraseña de la app y tocá
   **Entrar y permitir** (si ya estabas adentro, **Permitir acceso**). Vuelve solo a Claude.

> La sesión dura una hora y Claude la renueva sola por 30 días. Si un día te pide entrar de nuevo, es lo mismo del paso 5.

### 2. Subir el skill "cotizar-en-rubik"
1. Bajá el archivo: **https://rubikbolivia.com/downloads/cotizar-en-rubik.zip** (no lo descomprimas).
2. **Settings (Configuración) → Capabilities (Funciones)**: activá **Code execution and file creation** (los skills lo necesitan).
3. **Customize → Skills → ＋ (subir skill)** y elegí el ZIP. Revisalo y tocá **Turn on** (activar).

### 3. Crear el proyecto "RUBIK AGENTE APP"
1. **Projects (Proyectos) → ＋ New Project**. Nombre: `RUBIK AGENTE APP`.
2. **Set project instructions** (instrucciones del proyecto) y pegá el texto de abajo.
3. Listo. No hace falta subir archivos al proyecto.

**Texto para las instrucciones del proyecto** (copiar tal cual):

```
Sos el cotizador de Rubik Bolivia y trabajás conmigo (el dueño) en la app de Rubik a través del conector "Rubik".
Cada chat de este proyecto es UNA cotización: al empezar, ubicá el cliente y el proyecto (o crealos si te lo pido) y abrí la
cotización con abrir_cotizacion una sola vez; usá el mismo cid, pid y conv en todo el chat.
Seguí siempre el skill "cotizar-en-rubik":
- Un ítem es lo que se entrega; materiales y mano de obra van dentro del APU.
- Cada número tiene origen (3D, base, plano, lo que yo dije, supuesto que yo confirmé). No inventes precios: si falta, queda marcado.
- Lo que te digo en el chat registralo textual con registrar_mensaje_del_dueno antes de usarlo; los PDF y fotos que adjunto,
  con registrar_lectura_de_archivo.
- Una sola ronda de preguntas, concretas y de este proyecto.
- Alternativas y "por confirmar" van fuera del total.
- Características para el cliente, sin datos internos.
- Respetá el stock propio, los tratos que cierro y las normas del taller.
- Los recargos los decido yo: no los cambies.
- No apliques al presupuesto ni guardes en la base sin que te lo diga.
Respondé en español de Bolivia, corto, pensado para leer en el celular.
```

### 4. Cotizar (celular o PC)
1. Abrí el proyecto **RUBIK AGENTE APP** → **chat nuevo** (uno por cotización).
2. Revisá que el conector esté prendido: botón **＋** del cuadro de texto → **Connectors** → **Rubik** activado.
3. Escribí o dictá el pedido y adjuntá lo que tengas (PDF, fotos, capturas). Ejemplo:
   *"Cliente Paceña, proyecto Feria 2026: 3 trofeos de 45 cm, base MDF negro, te paso el render."*
4. La primera vez que use cada herramienta, Claude te pide permiso: **Always allow** (permitir siempre) para las de leer y
   armar el borrador; para **aplicar al presupuesto** conviene dejar **Allow once** (te pregunta cada vez).
5. Claude lee, busca en la base y te hace **una ronda de preguntas**. Respondé todo junto.
6. Arma el **borrador**. Lo ves en el chat (resumen) y completo en la app: proyecto → presupuesto → **Agente IA** → la
   conversación "Cotización desde Claude" (o el título que le pusiste) → **📋**.
7. Corregí por el chat ("eran tres adhesivos"). Cuando esté bien: **"aplicalo"**. Los ítems quedan al final del presupuesto con
   la etiqueta 🤖 Agente. **Si tenías el presupuesto abierto en la app, recargalo antes de tocarlo.**
8. Para seguir otro día, volvé al **mismo chat**: Claude retoma la misma cotización.

**3D:** los modelos 3D (FBX, GLB, ZIP) se siguen adjuntando en la app (Agente IA del proyecto → 📎), porque la medición la hace
el navegador. Después, en el chat de Claude, decí "usá el 3D que subí": aparece en la cotización.

<<<<<<< HEAD
### 4b. Ajustar una cotización que ya existe (ej. "el cliente la vio alta")
1. Chat nuevo en el proyecto: *"Entrá a STAND NEXCORP y ajustá el mostrador: MDF en vez de melamina, sin masillado ni pintura."*
2. Claude busca el proyecto y sus cotizaciones (también las que hiciste en el chat de la app) y abre la que creó ese ítem.
3. Te pregunta una sola cosa: **¿corrijo esa versión o hago una versión nueva?**
   - **Corregir:** cambia el borrador y, cuando digas "aplicalo", actualiza los mismos ítems del presupuesto en su lugar.
   - **Versión nueva** (lo mejor si el cliente ya vio la anterior): ver 4c.
4. El ahorro sale de cambios reales del APU (material, mano de obra que se saca). Claude no toca los recargos ni baja precios a mano.

### 4c. Versión económica
1. *"Hacé una versión económica"* → Claude copia la cotización a una conversación nueva ("Versión 2 – económica"); la anterior
   queda igual.
2. Ajusta lo que pidas y te muestra los dos totales.
3. *"Aplicalo"* → los ítems nuevos entran **aparte** en el presupuesto, con su capítulo "(Versión 2 – económica)".
4. Claude te pregunta si **apaga los ítems de la versión anterior** (el ojo del presupuesto: no suman ni salen en el PDF, pero
   **no se borran**). Te muestra la lista; solo si decís que sí, los apaga. Los podés volver a prender cuando quieras (desde la app
   o pidiéndoselo a Claude).

=======
>>>>>>> origin/claude/rubik-conector-mcp
### 5. Límites de uso de la suscripción
- Cada plan tiene un **límite por sesión** (se reinicia 5 horas después de tu primer mensaje) y un **límite semanal**. No hay
  un número fijo de mensajes: depende del largo de la conversación, los archivos, el modelo y el esfuerzo. El plan **Max** da 5 veces
  el uso del **Pro**. Lo ves en **Settings → Usage**.
- **Los conectores y las herramientas gastan bastante** (cada llamada suma texto a la conversación), igual que los PDF grandes y
  los chats muy largos. Para rendir más: **un chat por cotización**, adjuntá solo lo necesario, y para otra cotización abrí otro chat.
- El uso es el mismo para claude.ai, la app de escritorio, el celular y Claude Code: todo suma al mismo límite.
- Si llegás al límite: esperás al reinicio (o activás créditos de uso extra en la configuración del plan). **Nada se pierde**: el
  borrador ya está guardado en la app y podés terminarlo ahí con el Agente IA (ese sí gasta API) o seguir el chat después.

### 6. Seguridad y cómo cortar el acceso
- Solo entran las cuentas de la lista blanca de la app (`/acceso/hub`). Si se saca una cuenta de esa lista, pierde el acceso al
  conector en el siguiente pedido.
- Para desconectar Claude: **Customize → Connectors → Rubik → Disconnect/Remove**. Para cortar todas las sesiones del conector
  desde Firebase: borrar el nodo `/mcp_oauth/familias` (o una familia) en la consola.
- El conector no lee pagos, compras ni licitaciones, y no borra nada. Antes de aplicar al presupuesto deja una copia en
  `/respaldos_agente/{fecha}`.

---

## Cómo está armado (técnico)

```
claude.ai (web, escritorio, celular) ──HTTPS──▶ rubikbolivia.com (Firebase Hosting)
   /mcp                                    ─┐
   /.well-known/oauth-protected-resource[/mcp]│ rewrites → Cloud Function Gen 2 rubikMcp (us-central1, 512 MiB, 60 s)
   /.well-known/oauth-authorization-server   │   functions/mcp/index.js   HTTP: MCP + OAuth
   /oauth/register|authorize|token|revoke   ─┘   functions/mcp/oauth.js   servidor OAuth 2.1 (puro, probado)
                                                 functions/mcp/pantalla.js login y consentimiento (Firebase Auth en el navegador)
                                                 functions/mcp/herramientas.js  herramientas (reusan functions/agente/*)
```

### Transporte
- SDK oficial `@modelcontextprotocol/sdk` 1.32.2 (servidor de bajo nivel `Server` con los esquemas JSON del agente, para no duplicar
  validación). **HTTP streamable sin sesión** (`sessionIdGenerator: undefined`) y **respuestas JSON** (`enableJsonResponse`): cada
  POST crea el servidor, responde y cierra. `GET /mcp` → 405 (no hay stream del servidor). No hay estado en memoria entre pedidos.
- Hosting corta los pedidos a Functions a los **60 s**: las herramientas son lecturas y escrituras de la base, muy por debajo.
- `Origin` ajeno → 403 (solo claude.ai/claude.com, la propia web y loopback).

### Login (OAuth 2.1, verificado contra la doc de claude.ai de nov 2026)
- `401` + `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp", scope="rubik"` dispara el login.
- Metadatos del recurso (RFC 9728): `resource` = `https://rubikbolivia.com/mcp` (la URL exacta que se carga en Claude),
  `authorization_servers` = `["https://rubikbolivia.com"]`. Metadatos del servidor (RFC 8414) en la raíz.
- Identidad del cliente: **CIMD** (`client_id_metadata_document_supported: true`, `token_endpoint_auth_methods_supported: ["none"]`),
  solo de hosts de Claude (claude.ai, claude.com, anthropic.com: la Function no va a buscar URLs cualquiera); se valida que el
  documento tenga su propio `client_id` y que declare la `redirect_uri`. Respaldo: **registro dinámico** (RFC 7591), solo clientes
  públicos con redirect `https://claude.ai/api/mcp/auth_callback` (o claude.com) o loopback (Claude Code, pruebas).
- `/oauth/authorize` (GET) valida todo y guarda una **solicitud** de 10 min; la pantalla (CSP con nonce, `frame-ancestors 'none'`)
  hace el login con Firebase Auth **en el navegador** (la contraseña nunca pasa por la Function) y manda el **ID token**, que se
  verifica con `verifyIdToken(…, checkRevoked)`; solo la **lista blanca hub** recibe código. Un POST desde otro origen → 403.
- PKCE **S256 obligatorio**. Código de 5 min y un solo uso (transacción). `resource` (RFC 8707) se valida si viene. Se devuelve `iss`.
- Tokens opacos: **acceso 1 h**, **refresh 30 días rotativo**. En la base solo hay **hashes SHA-256**. Reusar un refresh ya rotado
  revoca toda la "familia" (la conexión). `/oauth/revoke` (RFC 7009). Cada pedido al MCP revisa vencimiento, familia, recurso y
  que el usuario siga en la lista blanca.
- Datos: `/mcp_oauth/{clientes,cimd,solicitudes,codigos,tokens,familias}` — reglas: nadie desde la app (`.read/.write: false`).

### Herramientas (etapa 1)
Reutilizan el código del Agente IA (`functions/agente/herramientas.js`, `agente-borrador.js`, `lector-3d.js`, `agente-nucleo.js`):
misma validación de origen, recetas, rutas A/B, alternativas y "por confirmar", características, normas y memoria.

| Herramienta | Toca | Notas |
|---|---|---|
| `listar_clientes`, `crear_cliente` | `/clientes` | crear no duplica (mismo nombre → devuelve el existente; `forzar`) |
| `listar_proyectos`, `crear_proyecto` | `/proyectos/{cid}` (nombre, estado, fecha, tipo, orden) | mismos campos que `proyectos-cliente.html` |
| `ver_presupuesto` | lee `/proyectos/{cid}/{pid}/presupuesto` | ítems, totales, APU con orígenes |
| `abrir_cotizacion` | `…/agente` | conversación nueva (`api.nuevaConversacion`) + contexto (`api.textoInicial`): normas, memoria, presupuesto |
| `registrar_mensaje_del_dueno` | `…/agente/conversaciones/{conv}/conversacion/mensajes` | `{rol: "dueno", via: "claude"}` → vale como `dueño:<id>` |
| `registrar_lectura_de_archivo` | `…/agente/adjuntos` | `{sin_archivo: true, resumen_lectura}` → vale para `cota_plano:` |
| `buscar_base`, `medicion_3d`, `escala_3d`, `armar_borrador`, `guardar_en_base`, `memoria` | lo mismo que en la app | las del agente, con `cid/pid/conv`; `memoria` sin borrar |
| `ver_borrador` | lee el borrador | `B.resumen` |
<<<<<<< HEAD
| `aplicar_al_presupuesto` | `…/presupuesto/items`, `…/borrador/aplicado`, `/respaldos_agente/{fecha}` | `B.aItemsPresupuesto` + `B.aplicarAlPresupuesto`; solo con `dueño:<id>` (no vale uno copiado de otra versión); si la conversación es una versión nueva, devuelve `version_anterior` con los ítems que siguen prendidos |
| `listar_cotizaciones` | lee `…/agente/conversaciones_meta`, borradores, costos y `…/presupuesto/items` | incluye `principal` si tiene algo; ítems aplicados por conversación (`agente.conv`) |
| `abrir_cotizacion` con `item` o `conv: "principal"` | lee `…/presupuesto/items` | retoma la conversación que creó el ítem (`agente.conv`, o `principal` si no tiene) |
| `nueva_version` | `…/agente/conversaciones/{nueva}` | copia el borrador con ids nuevos de capítulos e ítems (al aplicar entra aparte), capítulos renombrados con el título, mensajes del dueño copiados con las mismas claves (`copiado_de`) para que sus orígenes sigan valiendo; meta `basada_en` |
| `proponer_apagar_items` | `…/agente/propuestas/{id}` | paso 1: guarda la lista exacta (n, id, nombre); no cambia nada; vence en 24 h |
| `confirmar_propuesta` | `…/presupuesto/items`, `…/agente/propuestas`, `…/agente/confirmaciones/{msg}`, `/respaldos_agente` | paso 2: mensaje del dueño posterior a la propuesta y no copiado, que no haya confirmado otra; verifica que el presupuesto no cambió; respaldo; `activo: false/true` (el ojo), nunca borra |

- **Cerco por herramienta:** `almacen.acotar(almacen, rutas)` — cada herramienta corre con un almacén que solo deja tocar sus nodos
  (además del cerco general de la Function, `RUTAS_MCP`). La conversación `principal` (la del chat de la app) no se toca desde Claude.
- **Conversación `principal`** (la primera del chat de la app): se puede retomar desde Claude. Para no pisarse con la app, las
  herramientas que escriben **esperan si el Agente IA de la app está trabajando en esa conversación** (`agente/estado`, menos de
  10 min). Lo que cambia `armar_borrador` o `confirmar_propuesta` queda en `conversacion/ediciones` ("Desde Claude: …"): el agente
  de la app lo recibe en su próximo turno, igual que las ediciones a mano.
=======
| `aplicar_al_presupuesto` | `…/presupuesto/items`, `…/borrador/aplicado`, `/respaldos_agente/{fecha}` | `B.aItemsPresupuesto` + `B.aplicarAlPresupuesto`; solo con `dueño:<id>` |

- **Cerco por herramienta:** `almacen.acotar(almacen, rutas)` — cada herramienta corre con un almacén que solo deja tocar sus nodos
  (además del cerco general de la Function, `RUTAS_MCP`). La conversación `principal` (la del chat de la app) no se toca desde Claude.
>>>>>>> origin/claude/rubik-conector-mcp
- La conversación de Claude es una conversación más del Agente IA (`conversaciones_meta/{conv}.origen = "claude"`): el dueño la ve,
  la puede seguir en la app y la aplica con el mismo botón. Su `conversacion/api` queda vacía (no hay historial de la API): si se
  sigue en la app, el agente de la app arranca con el contexto inicial y el borrador.
- **Instrucciones del servidor** (`initialize.instructions`): un resumen de las reglas del dueño, por si el skill no está activo.

### Skill
`skills/cotizar-en-rubik/` (SKILL.md + `referencias/`). El ZIP que se sube a claude.ai se regenera con
`cd tools/mcp && npm run skill` y se publica en `public/downloads/cotizar-en-rubik.zip` (la prueba verifica que coincidan).

### Deploy
- Nueva Function `rubikMcp` (en `functions/index.js`) → el merge **despliega Functions** (corta adjuntos en curso e invalida la
  caché del Agente IA una vez). Coordinar con la sesión maestra antes de mergear.
- `firebase.json`: rewrites de `/mcp`, `/.well-known/oauth-*`, `/.well-known/openid-configuration` y `/oauth/**` a `rubikMcp`.
- `database.rules.json`: `mcp_oauth` cerrado, `respaldos_agente` lectura hub.
- Dependencias nuevas en `functions/`: `@modelcontextprotocol/sdk` y `zod` (peer del SDK).
- Después del deploy, verificar: `curl -s https://rubikbolivia.com/.well-known/oauth-protected-resource/mcp` y
  `curl -si -X POST https://rubikbolivia.com/mcp` (tiene que dar 401 con `WWW-Authenticate`).

### Pruebas (sin gastar plata, Firebase simulado, datos inventados)
<<<<<<< HEAD
- `cd tools/mcp && npm test` — 19 pruebas. Entrega 1b: listar cotizaciones con la `principal` y sus ítems aplicados, retomar
  desde un ítem (n o id), ítem cargado a mano rechazado, corrección en el lugar avisada a la app; versión económica (ids nuevos,
  orígenes copiados válidos, confirmación copiada rechazada, entra aparte, `version_anterior`), propuesta que no cambia nada,
  confirmación anterior a la propuesta o inventada rechazada, apagar con respaldo y total que baja, un solo uso, el mismo "sí" no
  confirma otra, volver a prender; presupuesto cambiado → no se aplica; agente de la app trabajando → Claude no escribe.
  Entrega 1 (15): metadatos; registro dinámico (redirect ajena rechazada); login completo con PKCE y un
=======
- `cd tools/mcp && npm test` — 15 pruebas: metadatos; registro dinámico (redirect ajena rechazada); login completo con PKCE y un
>>>>>>> origin/claude/rubik-conector-mcp
  solo uso; **rechazo sin token, con token inventado, vencido y fuera de la lista blanca**; authorize con redirect ajena, sin PKCE o
  con otro `resource`; CIMD (host ajeno ni se va a buscar); refresh rotativo, reuso → conexión revocada, `revoke`; clientes y
  proyectos sin duplicar; presupuesto con APU; **flujo abrir → registrar → borrador con origen → aplicar solo con confirmación
  (y respaldo; reaplicar actualiza en su lugar)**; cota de un PDF del chat; cerco (otro proyecto, conversación `principal`, pagos);
  `buscar_base` y `guardar_en_base` con confirmación; definiciones; skill y ZIP.
- `cd tools/mcp && npm run cliente` — **cliente MCP de prueba**: levanta el conector en un puerto local, hace el login por HTTP
  (401 → metadatos → registro → pantalla → código → token, JSON en `/token` → 415) y con el SDK oficial lista las herramientas
  y llama `listar_clientes`, `listar_proyectos`, `abrir_cotizacion`, `registrar_mensaje_del_dueno`, `armar_borrador`; `GET` → 405;
  token revocado → sin acceso.
- `cd tools/agente && npm test` — las 62 del Agente IA siguen pasando. `tools/probar-reglas` — 176 OK.

### Pendientes / próximas etapas
- **Etapa 2:** mantenimiento de la base (precios, materiales nuevos, ordenar, duplicados) con propuesta → confirmación con el id
  de la propuesta → respaldo en `/respaldos_agente/{fecha}` → historial.
- **Etapa 3:** cronograma, producción, impresiones y licitaciones desde los ítems aplicados.
- Ver adjuntos de la app (PDF, fotos) desde Claude: hoy llegan con su resumen de lectura; las imágenes completas superan el
  límite de 150.000 caracteres por resultado de claude.ai.
- Limpieza periódica de tokens y solicitudes vencidos en `/mcp_oauth` (son pocos bytes; hoy no molesta).
