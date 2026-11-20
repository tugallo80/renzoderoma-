# Sesión 9 · Etapa 0 — Auditoría y limpieza (diagnóstico)

**Fecha:** 20 nov 2026 · **Alcance:** solo lectura del código de `main` (commit `3ec5ed5`). No se tocó código, reglas ni datos,
y no se leyó la base real. Cuando algo depende de lo que hay guardado en la base (o en Meta, o afuera del repo), se dice
**"no se puede saber leyendo el código"**.

**Para qué sirve:** la app se hizo pantalla por pantalla durante un año. Antes de pasar la lógica al servidor por áreas
(como ya se hizo con `functions/compras` y `functions/licitaciones`), hay que saber qué pantallas están vivas, quién
escribe cada dato, dónde se cuenta dos veces y qué se puede borrar sin riesgo.

Cómo leer las marcas:
- 🟢 viva y en uso · 🟡 viva pero cerrada (sin acceso a datos desde la Sesión 0) · 🔴 muerta / huérfana · 🔁 duplicada o casi igual
- **Grave** = da números falsos o pierde datos · **Medio** = puede fallar o confundir · **Menor** = orden o costo

---

## Resumen en 10 líneas

1. **El gasto del proyecto se calcula de 4 maneras distintas** (dashboard, Tesorería, Kay "balance", Kay "detalle"), y ninguna da lo mismo.
2. **El dashboard del proyecto no cuenta casi ninguna mano de obra:** solo suma licitaciones en estado `adjudicado`, pero la pantalla y el servidor las aprueban como `aprobado`/`terminado` (`dashboard-proyecto.html:375`). La utilidad que muestra está inflada.
3. **Doble conteo de caja chica confirmado** (app-trabajador suma a `gasto_total` y el dashboard vuelve a sumar `caja_chica`), y además el dashboard cuenta como gasto los pedidos **pendientes** del supervisor.
4. **Editar a una persona en Base de Datos borra todo lo que cuelga de ella** (licitaciones copiadas, pagos): `base_datos.html:566-567` hace `set` (pisa) y, si cambia el nombre, `remove` del registro viejo.
5. **El presupuesto abierto pisa lo que otros escriben mientras está abierto** (Producción, Compras, Diseños, el conector de Claude): `presupuesto.html:1122` reescribe todo el nodo `presupuesto` con lo que cargó al abrir.
6. **El bot viejo de WhatsApp (`whatsappWebhook`) está roto y, si Meta todavía le manda mensajes, le pasa a la IA la lista de TODOS los proyectos de cualquiera que escriba** (llama `identificarRol(from)` sin la base, `functions/index.js:1068`), sin verificar la firma de Meta.
7. Hay **4 Functions sin nadie que las llame** (`procesarIngestaIA`, `importarAdmin`, `geminiLiveKey`, y en la práctica `whatsappWebhook`) y `geminiProxy` tiene una instancia de 2 GB siempre prendida.
8. **"Cobrado" tiene dos fuentes**: `proyectos/…/pagos` (dashboard) e `ingresos` (Tesorería, unido por *nombre* del proyecto). Kay responde distinto según la acción.
9. Las **notificaciones al hub** (de clientes, trabajadores, supervisores) se escriben pero **solo las lee una página huérfana** (`interno/dashboard.html`): nadie las ve.
10. **~1,7 MB de basura publicada** (volcados del navegador: `_DataURI/`, `www.gstatic.com/`, `cdn.jsdelivr.net/`, `rubikbolivia.com/`…) y código muerto (`compras.html:1308-1472`, `js/gemini-live.js`).

**Lote recomendado primero:** Lote 1 (borrar archivos muertos, riesgo casi nulo) en paralelo con el **Lote 2 (una sola
fórmula de gasto y cobrado del proyecto, en el servidor)**, que es el que corrige los números que el dueño mira. Ver sección f.

---

## a) Inventario de páginas

Cómo se llega: **Hub** (`index.html`) → Requerimiento, Clientes, Base de Datos, Tesorería, Portafolio, Correo, Herramientas.
Clientes → `proyectos-cliente.html` → `dashboard-proyecto.html` → (vía `abrirModulo`) Presupuesto/Agencia, Producción,
Compras, Gantt, Licitaciones, Diseños. Base de Datos → enlaces a las apps de cada persona (`getLinkBase`,
`base_datos.html:611`). Clientes/Proyectos → `cliente-view.html`.

### Hub (lista blanca, en uso)

| Página | Para qué | Lee | Escribe | Functions | Estado |
|---|---|---|---|---|---|
| `index.html` | Inicio, Laboratorio IA (prompts, etiquetas, reglas técnicas), Cerebro, "Flash" que crea cliente/proyecto | `config_ia/*`, **todo** `proyectos`, `clientes`, `base_datos`, `personal`, `ingresos`, `compras_facturadas` (para el consultor IA, `:1045-1050`), `requerimientos`, `interfaz_wa/entrada` | `config_ia/*`, `proyectos/{cid}/{pid}` (Flash), `clientes` (push), `base_datos/materiales/{k}`, `interfaz_wa/*` | `/api/gemini`, `/api/mail/inbox`, `/api/tts` | 🟢 (el oyente de `interfaz_wa` está muerto, ver e) |
| `requerimiento.html` | Lo que pidió el cliente (sin IA) | `clientes`, `requerimientos` | — (todo por `/api/requerimiento`) | `/api/requerimiento`, `/api/gemini` | 🟢 ya en el servidor |
| `clientes.html` | Directorio de clientes, PIN | `clientes` | `clientes/{cid}` (push/update/**remove**), `pin_hash` | `/api/gemini` | 🟢 |
| `proyectos-cliente.html` | Proyectos de un cliente: crear, editar, duplicar, borrar, visibilidad, reset de juegos | `clientes/{cid}`, `proyectos/{cid}` | `proyectos/{cid}` (push/update/**remove**), `visible_cliente`, campos de juegos | `/api/gemini` | 🟢 · 🔁 `duplicarProyecto` también en dashboard |
| `dashboard-proyecto.html` | Ficha del proyecto: venta, gasto, utilidad, pagos del cliente, facturas, negociación, duplicar | `presupuesto`, `extras`, `licitaciones`, `gasto_total`, `monto_cierre`, `negociacion`, `pagos`, `facturas_emitidas`, **todo `caja_chica`**, `base_datos`, `config_ia` | `monto_cierre`, `estado`, `negociacion`, `factura_url`, `pagos` (push), `facturas_emitidas` (push/remove), `visible_cliente`, proyecto duplicado | `/api/gemini`, `/api/mail/send` | 🟢 · cálculo de gasto con errores (e1, e2) |
| `presupuesto.html` | Cotización, PDF, agente IA, importar 3D | `base_datos/*`, `personal`, `presupuesto`, `monto_cierre`, `diseno`, `config_ia/reglas_tecnicas`, `clientes` | **todo `presupuesto`** (`set`), `presupuesto_total`, `base_datos/items/{desc}`, `base_datos/unidades`, `base_datos/{mat,mo}` (vía `importar-3d.js`), copia de ítems a otro proyecto | `/api/gemini`, `/api/agente`, `/api/tts`, `/api/mail/send` | 🟢 · pisa (e5) |
| `agencia.html` | Presupuesto para proyectos tipo agencia | `proyectos/{cid}/{pid}/agencia` | ídem | `/api/gemini` | 🟢 · 🔁 variante de presupuesto |
| `produccion.html` | APU de producción, artes, imágenes de operación | `presupuesto/items` (en vivo), `artes_data`, `licitaciones`, `base_datos/*`, `personal`, `diseno` | `presupuesto/items/{n}/…` (prod_apu, feat, notas, op_images, fotos, medidas), `artes_data`, actualización de precios a la raíz (`:5967`) | `/api/gemini` | 🟢 · ítems por posición |
| `compras.html` | Materiales a comprar, solicitudes de obra, chat IA de compras, pagos a contratistas | proyecto en vivo, `historial_compras`, `base_datos/{materiales,proveedores}` | `presupuesto/items/{n}/compras_requeridas`, `…/prod_apu/mat`, `solicitudes_compra/{id}`, **`gastos_adicionales_compras`** (sin transacción), borra `historial_compras` viejas + `gasto_total` | `/api/compras`, `/api/licitaciones`, `/api/gemini` | 🟢 · código muerto `:1308-1472` |
| `licitaciones.html` | Licitaciones a contratistas, PDF de propuesta, asignación al Gantt | `presupuesto/items`, `artes_data`, `gantt/items`, `licitaciones`, `personal`, `supervisores/…` | `gantt/items` (auto-asignar, `:1541-1543`), `supervisores/{wid}/proyectos/{pid}/{extras}` (`:2336`, `:2362`); el resto por servidor | `/api/licitaciones`, `/api/gemini` | 🟢 casi todo en el servidor |
| `gantt.html` | Cronograma | `personal`, proyecto, `presupuesto/items`, `config_ia` | `gantt/items/{n}/subtasks/*`, `gantt_config` | `/api/gemini` | 🟢 · diagnóstico IA lee ruta vacía (e) |
| `disenos.html` | Archivos y diseños, cortes | `diseno`, `presupuesto/items` | `diseno/*` (push/**remove**), `presupuesto/items/{n}/cortes` | `/api/gemini` | 🟢 |
| `cad.html` | Editor CAD 2D/3D | `presupuesto/items`, `cad/drawings` | `cad/drawings`, `presupuesto/items/{k}/fotos` | — | 🟢 (llega desde Diseños/Producción) |
| `computo.html` | Cómputo métrico con IA desde imágenes | `presupuesto/items/{n}` | **reemplaza el ítem entero** (`:441`), `diseno/planos` | `/api/gemini` | 🟢 · pisa (e) |
| `tesoreria.html` | Finanzas: ingresos, cobros, compras, impuestos, planillas, contratistas, supervisores | **todo `proyectos`**, `ingresos`, `compras`, `compras_facturadas`, `cancheos`, `personal`, `supervisores`, `clientes` | `ingresos` (push/update/**remove**), `compras_facturadas` viejas (update/remove), `proyectos/…/pagos` (`:4121`) | `/api/compras`, `/api/licitaciones`, `/api/imagen`, `/api/gemini` | 🟢 |
| `base_datos.html` | Catálogos: materiales, MO, otros, inventario, proveedores, **personal**; chat IA que aplica cambios | `personal`, `base_datos/*` | `personal/{nombre}` (**set + remove**), `base_datos/*` (update/push/**remove**), cambios de la IA a la raíz (`:1007`) | `/api/gemini` | 🟢 · pisa personas (e4) |
| `portafolio-admin.html` | Portafolio público | `portafolio` | `portafolio` | `/api/gemini` | 🟢 |
| `correo.html` | Correo Zoho | — | — | `/api/mail/*`, `/api/gemini` | 🟢 |
| `herramientas.html` | Descarga de Rubik Agent | — | — | — | 🟢 |
| `compartir/elegir.html` | Destino de "Compartir" del teléfono (archivos 3D) | `clientes`, `proyectos/{cid}` | `clientes` (push), `proyectos/{cid}` (push) | — | 🟢 |
| `login.html`, `landing.html`, `404.html`, `privacidad.html` | Entrada, página pública, error, política (probablemente exigida por Meta) | `portafolio` (landing) | — | — | 🟢 |

### Apps de clientes y personas (🟡 cerradas desde la Sesión 0: las reglas solo dejan entrar al hub)

| Página | Para qué | Lee | Escribe | Notas |
|---|---|---|---|---|
| `cliente-view.html` | Portal del cliente (presupuesto, aprobar, extras, chat, pedir proyecto) | `clientes/{cid}` (incluye `pin_hash`), `proyectos/{cid}`, **todo `base_datos` y todo `proyectos`** (`:3237`, `:3248`) | `proyectos/{cid}/*`, `notificaciones/*`, `feed_actividad`, **`requerimientos_asistidos`** (módulo retirado, `:3981`) | PIN verificado en el navegador; al reabrir no puede leer todo `proyectos` |
| `juego-moneda.html`, `juego-viborita.html` | Juegos de descuento del cliente | `clientes/{cid}`, `proyectos/{cid}` | `proyectos/{cid}/{pid}` (descuento) | Enlazados desde cliente-view |
| `juego-ruleta-taba-squishi.html` | Otro juego | — | — | 🔴 nadie lo enlaza |
| `interno/app-trabajador.html` | App de planta: tareas Gantt, licitaciones, caja chica, chat, inventario | `personal`, `base_datos/proveedores`, `personal/{id}/{solicitudes,sueldo,pagos}`, proyecto, `caja_chica/{id}` | `caja_chica/{id}/gastos` **+ `gasto_total`** (`:1083-1087`), progreso y fotos del Gantt, `chat`, `notificaciones/hub`, `base_datos/inventario` | Botón a `inventario.html`, que **no existe** (`:424`) |
| `supervisor-index.html` → `supervisor-obra.html` | App del supervisor de obra | `personal/{wid}`, todo `proyectos`, proyecto en vivo, `supervisores/{wid}/…` | `caja_chica/{wid}/gastos` (**pedido pendiente**, `:518-530`), `supervisores/{wid}/proyectos/{pid}/{depositos,gastos,extras}`, progreso y fotos del Gantt, `notificaciones/hub` | 🔁 con contratista |
| `contratista/index.html` → `contratista/obra.html` | App del contratista | `personal/{wid}/…`, todo `proyectos`, ítems, Gantt | `personal/{wid}/solicitudes/*` **y** `licitaciones/*` (doble escritura), progreso y fotos del Gantt, `solicitudes_compra` | Acepta poniendo estado `adjudicado` (`index.html:331`) |
| `proveedor-grafico.html` | App de imprenta | `personal/{id}`, licitaciones | `licitaciones/*`, `personal/…/solicitudes/*`, `presupuesto/items/{n}/print_status` | |

### Huérfanas, muertas o basura publicada (🔴)

| Archivo | Qué es | Evidencia |
|---|---|---|
| `public/_DataURI/` (177 archivos), `www.gstatic.com/`, `cdn.jsdelivr.net/`, `fonts.googleapis.com/`, `unpkg.com/` | Volcado del navegador ("guardar todo" de DevTools): fuentes `.ts` de Firebase, un `chrome-extension://…`, CSS de íconos | Nada los referencia. Se publican en rubikbolivia.com (~1,7 MB, 316 archivos contando `rubikbolivia.com/`). El historial no muestra el origen (clon corto) |
| `public/rubikbolivia.com/index.html` + `logo.jpg` | Copia vieja de un "Panel de Control" | Enlaza `rrhh-planillas.html` (no existe) e `interno/dashboard.html` |
| `interno/dashboard.html` | Panel interno viejo: notificaciones del hub, chat con clientes, aprobar extras/negociaciones | Solo lo enlaza la copia anterior. **Es el único lector de `notificaciones/hub`** (e9). Enlaza `../personal.html` (no existe) |
| `apu.html` | Página "Page Not Found" genérica de Firebase con otro nombre | Está en la lista de exentos de `auth-guard.js:13` |
| `js/gemini-live.js` | Cliente viejo de Gemini Live | Ninguna página lo carga (`cerebro-live.js` lo reemplazó y crea el alias `GeminiLive`). Es el único que llama `/api/gemini-live-key` |
| `compras.html:1308-1472` | "Actualizador de precios con BD + IA" | Está **dentro** de `<script src="/js/viewmode.js?v=1">`: el navegador ignora el código interno. El botón `btn-act-precios` (`:163`) llama a una función que no existe → error al tocarlo |

### Duplicadas o casi iguales (🔁)

| Qué | Dónde | Diferencia |
|---|---|---|
| Duplicar proyecto | `dashboard-proyecto.html:409` y `proyectos-cliente.html:793` | El del dashboard copia **todo** (pagos, licitaciones, `gasto_total`, `historial_compras`, chat…). El otro quita licitaciones, pagos y compras pero copia `gasto_total`, `historial_compras`, `gastos_adicionales_compras`, `monto_cierre`, `facturas_emitidas` |
| Avance y fotos de tareas del Gantt | `app-trabajador.html:1062-1071`, `supervisor-obra.html:356,1025`, `contratista/obra.html:376-393` | Tres copias del mismo código |
| Lista de "mis proyectos" por persona | `supervisor-index.html`, `contratista/index.html`, `app-trabajador.html`, `proveedor-grafico.html` | Cuatro maneras de decidir si una licitación está activa (`adjudicado`/`aprobado`/`terminado`/`enviado`) |
| Crear proyecto | `proyectos-cliente.html`, `index.html` (Flash), `compartir/elegir.html`, `cliente-view.html`, conector MCP | `fecha_creacion` como `AAAA-MM-DD` (Flash, `index.html:1658`) o ISO completo (los demás); campos iniciales distintos |
| Crear cliente | `clientes.html`, `index.html:1999`, `compartir/elegir.html:164`, conector MCP | — |
| Pagos del cliente | `dashboard-proyecto.html:491,1410` y `tesoreria.html:4121` → `proyectos/…/pagos`; **además** `tesoreria.html:824` → `ingresos` (tipo `cobro`) | Dos lugares para "el cliente pagó" (e8) |
| `requireAuth` | `functions/index.js:66` y `functions/mail.js:65` | Misma función copiada |
| Configuración de Firebase | 31 páginas la repiten | Ninguna diferencia hoy; `firecache.js` la podría centralizar |

---

## b) Mapa de nodos de la base

Solo lo que importa para la limpieza. "Pantalla:línea" o "Function". En **negrita**, los problemas.

### Dinero y gasto del proyecto

| Nodo | Quién escribe | Quién lee | Problema |
|---|---|---|---|
| `proyectos/{cid}/{pid}/gasto_total` | `functions/compras` (transacción, una vez); **`app-trabajador.html:1086`** (lee y suma, sin transacción); `compras.html:1300` (resta al borrar compras viejas) | dashboard, `interno/dashboard`, Kay, `balance_proyecto`, bot WhatsApp | Contador derivado que tocan 3 lugares; mezcla compras + caja chica |
| `…/gastos_adicionales_compras` | **`compras.html:532`** (`set(valorEnMemoria + monto)`, sin transacción) | Tesorería (balance), `balance_proyecto` | **El dashboard no lo cuenta**; dos pestañas abiertas pierden un gasto |
| `…/historial_compras/{id}` | `functions/compras` (espejo); `compras.html` borra las viejas | Compras, `balance_proyecto` | Etapa 3 de compras (migración) pendiente |
| `/compras/{id}` | Solo `functions/compras` | Tesorería (balance), Kay | ✅ ya ordenado |
| `/compras_facturadas/{id}` | `functions/compras`; Tesorería (viejas) | Tesorería impuestos, inicio | Se cierra en la etapa 3 de compras |
| `caja_chica/{persona}/gastos` | `app-trabajador.html:1083` (gasto hecho, `fecha` AAAA-MM-DD, sin `pid`, `proyecto` = **nombre**); `supervisor-obra.html:530` (**pedido pendiente**, `monto_total`, `fecha_registro` en formato local, con `pid`) | dashboard (todo el nodo, filtra por **nombre**), app-trabajador | **Mismo nodo, dos significados y dos formatos**; Tesorería no lo lee: nadie aprueba esos pedidos |
| `caja_chica/{persona}/depositos` | **Nadie** en el código | app-trabajador (saldo) | El saldo de caja chica solo puede bajar. No se puede saber si hay depósitos viejos en la base |
| `supervisores/{wid}/proyectos/{pid}/{depositos,gastos,extras}` | `supervisor-obra.html`, `licitaciones.html:2336` | Tesorería (planillas de supervisores) | Otra "caja chica" del supervisor; clave por `pid` sin `cid` |
| `…/licitaciones/{lid}` (+ `pagos`, `extras`) | `functions/licitaciones`; apps contratista/gráfico (cerradas) | dashboard, Tesorería, Compras, Kay | ✅ en el servidor. **El dashboard solo cuenta `adjudicado`** (e2) |
| `personal/{wid}/solicitudes/{lid}` | `functions/licitaciones` (copia); apps cerradas | apps de personas | Copia de la licitación; se pierde al editar la persona (e4) |
| `…/pagos` (del cliente) | dashboard (2), Tesorería (1) | dashboard, Kay `detalle_proyecto` | Ver `ingresos` |
| `/ingresos` | Tesorería (facturas de venta y cobros, `proyecto` = **nombre**) | Tesorería, inicio, `balance_proyecto` (filtra por nombre) | **Dos fuentes de "cobrado"** (e8) |
| `…/monto_cierre`, `presupuesto_total` | dashboard; `presupuesto.html:1115` (en cada recálculo) | varias | `presupuesto_total` excluye ítems apagados; el dashboard recalcula la venta **incluyéndolos** (`:358`) |
| `/cancheos` | No se encontró quién escribe en el repo | Tesorería, `functions/compras`, Kay | No se puede saber si tiene datos sin leer la base |
| `/tesoreria/iva_compras` | Ya nadie (lo escribía el chat viejo de Compras) | Nadie | Se migra en la etapa 3 de compras |

### Presupuesto, producción y diseño

| Nodo | Quién escribe | Problema |
|---|---|---|
| `…/presupuesto` (entero) | **`presupuesto.html:1122` (`set` de todo, con lo cargado al abrir, `:713`)**; conector MCP (con respaldo); Flash; cliente-view | Pisa lo que escribieron otros mientras estaba abierto (e5) |
| `…/presupuesto/items/{n}/…` | Producción (`prod_apu`, `feat`, `notas`, `op_images`, `fotos`, `measures`), Compras (`compras_requeridas`, `prod_apu/mat`), Diseños (`cortes`), CAD (`fotos`), Cómputo (**ítem entero**), proveedor-gráfico (`print_status`), licitaciones (responsables, servidor) | Todo por **posición** `{n}` (pendiente de la Sesión A) |
| Fotos de un ítem | `items/{n}/img`, `fotos`, `op_images`, `cortes`, `measures/{m}/img`, `apu/…/measures/{m}/img`, `apu/…/corte_url`; y del proyecto `diseno/{fotos,planos,docs,enlaces}` | **7 lugares** para fotos; Producción tiene una rama de borrado distinta para cada uno (`:3468-3475`) |
| `…/gantt/items/{n}/subtasks/{k}` | gantt, licitaciones (auto-asignar), apps de obra (avance/fotos) | `worker` es **texto libre con el nombre** |
| `/gantt/{cid}/{pid}` (raíz) | Nadie en el código | Solo lo lee `gantt.html:1207` (diagnóstico IA): analiza un nodo vacío salvo datos viejos |
| `…/artes_data`, `…/agencia`, `…/cad/drawings` | Producción/Licitaciones, Agencia, CAD | Sin problemas vistos |

### Catálogos (`base_datos`)

| Nodo | Claves | Quién escribe | Problema |
|---|---|---|---|
| `materiales` | `NOMBRE EN MAYÚSCULAS` (con espacios) en base_datos/presupuesto; `NOMBRE_CON_GUIONES` en `importarAdmin`; clave existente o nueva en `functions/agente/claves.js` y compras | base_datos (4 lugares), presupuesto, importar-3d, producción, compras (reparar proveedor), `index.html:2004`, agente, compras API, `importarAdmin` | Campos duplicados en el mismo registro (`n`/`desc`, `u`/`und`, `p`/`pu`, `proveedor`/`proveedor_ref`) |
| `proveedores` | **push** (`base_datos.html:577,1052`), **`NOMBRE`** (chat viejo de compras), **`NIT_…`/`NOM_…`** (`functions/compras/api.js:69-71`) | 4 escritores | Mismo proveedor bajo varias claves; el material guarda el proveedor por **nombre** |
| `items` | `desc` sin caracteres prohibidos (`presupuesto.html`), `DESC_CON_GUIONES` (`importarAdmin`) | presupuesto, base_datos, importarAdmin | — |
| `inventario` | push | base_datos, **app-trabajador** | — |
| `unidades`, `otros`, `oficios`, `rendimientos`, `preferencias_mo`, `equivalencias_vw`, `historial_cambios` | — | importar-3d, presupuesto, agente | Sin problemas vistos |

### Mensajes, avisos y configuración

| Nodo | Escribe | Lee | Estado |
|---|---|---|---|
| `notificaciones/hub` | cliente-view, app-trabajador, supervisor-obra | **solo `interno/dashboard.html` (huérfana)** | Nadie las ve (e9) |
| `notificaciones/clientes/{cid}` | `interno/dashboard.html` | cliente-view | Huérfano + cerrado |
| `feed_actividad` | cliente-view | **nadie** | Muerto |
| `interfaz_wa/entrada` · `salida` | **nadie en el repo** escribe `entrada`; `index.html` escribe `salida` | `index.html:1679,1770` | Oyente muerto (salvo un programa externo que no está en el repo) |
| `whatsapp_historial/{tel}` | `whatsappWebhook` | nadie en la app | — |
| `whatsapp_clientes` | nadie | nadie | Solo en la documentación |
| `config/admin_phone` | **nadie** | supervisor-obra, contratista | Siempre usa el número fijo `59176868833` (repetido 21 veces en el código) |
| `requerimientos_asistidos` | **cliente-view `:3981`** (sigue escribiendo) | dashboard-proyecto | El módulo se retiró en la sesión 6 |
| `personal/{id}/pagos` | **nadie** | app-trabajador | No se sabe si hay datos viejos |

---

## c) Personas: cómo están hoy

Hoy **no hay un registro de personas**: cada tipo vive en un lugar distinto y se identifica por nombre o por una clave
hecha con el nombre. Ninguna tiene el teléfono en formato único.

| Quién | Dónde | Clave | Teléfono | Cómo lo identifica cada parte |
|---|---|---|---|---|
| Trabajador de planta | `personal/{clave}` `tipo: interno` | **El nombre con `_`** (`base_datos.html:561`) | `telefono` (texto libre) | app-trabajador recibe `?user=Nombre` y busca por nombre; si no lo encuentra inventa la clave (`:461-463`) |
| Supervisor | `personal/{clave}` `tipo: supervisor` **+** `supervisores/{clave}/proyectos/{pid}/…` | nombre con `_` | `telefono` | `?wid=clave`; Tesorería une los dos por la clave |
| Contratista | `personal/{clave}` `tipo: externo` o `empresa` | nombre con `_` | `telefono` | `?wid=clave`; licitaciones usan `worker_id` = clave |
| Imprenta | `personal/{clave}` `tipo: graficos` | nombre con `_` | `telefono` | `?wid=clave` |
| En el Gantt | `subtasks/{k}/worker` | **texto con el nombre** | — | El bot viejo y app-trabajador comparan textos |
| Caja chica | `caja_chica/{clave}` | clave de `personal` (o el nombre inventado) | — | — |
| Proveedor | `base_datos/proveedores/{push \| NOMBRE \| NIT_… \| NOM_…}` | 3 esquemas | `telefono` **y** `contacto` (copia, o `"S/N"`) | Materiales lo nombran por texto (`proveedor`) |
| Cliente | `clientes/{push}` | push | `wsp` (el bot también busca `whatsapp`) | PIN `pin_hash` (SHA-256 sin sal) |
| Dueño | Lista blanca `acceso/hub/{uid}`; bot viejo: teléfonos fijos `76868833`/`59176868833` (`functions/index.js:860`) | uid | — | — |
| Quién hizo algo | `registrado_por {uid, rol, nombre, telefono, via}` en compras y licitaciones (servidor) | — | — | ✅ ya existe en los módulos nuevos |

**Duplicados y riesgos que alimentan la etapa 1 (registro único con teléfono y rol):**
1. **La clave es el nombre.** Dos personas con el mismo nombre se pisan; corregir un nombre crea otra persona y borra la vieja con todo lo suyo (e4). `caja_chica/{vieja}`, `supervisores/{vieja}` y los `worker_id` de licitaciones quedan apuntando a la clave borrada.
2. **Una persona puede ser supervisor y contratista a la vez** (ej. un supervisor que también toma una licitación): hoy son dos registros o un `tipo` que cambia.
3. **Un proveedor que también es contratista** (taller) está en `personal` y en `proveedores` sin relación.
4. **Teléfonos sin formato** (con o sin 591, espacios): Kay (`buscar_contacto`) y el bot comparan normalizando de forma distinta.
5. `kayApi.buscar_contacto` (`functions/kay-api.js:464-490`) ya junta `personal`, `proveedores` y `clientes`: es el mejor punto de partida para armar `/personas` + `/personas_tel` (diseño en `07-compras.md`, sección 5).

---

## d) Functions

| Function | Ruta | Quién la llama | Estado | Riesgo |
|---|---|---|---|---|
| `geminiProxy` | `/api/gemini` | ~25 pantallas | 🟢 | **`minInstances: 1` con 2 GB** (`functions/index.js:264`): una instancia prendida todo el mes (costo fijo). Decisión del dueño |
| `agenteApi`, `agenteTurno` | `/api/agente` + cola | Presupuesto (agente), conector | 🟢 | — |
| `requerimientoApi` | `/api/requerimiento` | Requerimiento, Kay | 🟢 | — |
| `comprasApi` | `/api/compras` | Tesorería, Compras, Kay | 🟢 | — |
| `licitacionesApi` | `/api/licitaciones` | Licitaciones, Tesorería, Compras, conector | 🟢 | — |
| `rubikMcp` | `/mcp`, OAuth | claude.ai | 🟢 | Público por diseño, con OAuth |
| `renderTurno`, `pdfPaginas` | colas | conector | 🟢 | — |
| `kayApi` | URL directa | Kay | 🟢 | Solo cuenta de servicio de Kay |
| `ttsProxy` | `/api/tts` | agente-chat, cerebro-live | 🟢 | — |
| `mailFolders/Inbox/Message/Send` | `/api/mail/*` | Correo, inicio, dashboard, presupuesto | 🟢 | `requireAuth` copiado |
| `proxyImagen` | `/api/imagen` | Tesorería | 🟢 | Cerrado en la Sesión 0 |
| **`geminiLiveKey`** | `/api/gemini-live-key` | **Nadie** (solo `js/gemini-live.js`, que nadie carga) | 🔴 | Entrega la clave completa de Gemini (pendiente de la Sesión 0). **Borrarla resuelve ese pendiente** |
| **`procesarIngestaIA`** | `/api/ingesta` | **Nadie** en el repo | 🔴 | 2 GB, 540 s, clave de Anthropic |
| **`importarAdmin`** | URL directa, `invoker: public` | **Nadie** en el repo ni en Rubik Agent | 🔴 | Escribe en `base_datos` con una clave fija (`X-Admin-Key`), sin lista blanca ni historial, con otro esquema de claves. No se puede saber si algún script externo la usa (revisar logs antes de borrar) |
| **`whatsappWebhook`** | `/api/whatsapp` | Meta (si sigue configurado: **no se puede saber por el código**) | 🔴 roto | Ver e6: llamada mal hecha, sin verificar firma, token de verificación con valor por defecto escrito en el código (`rubik-webhook-2026`). Kay ya cubre WhatsApp |

---

## e) Errores concretos

### Datos que se cuentan dos veces (o ninguna)

| # | Gravedad | Dónde | Qué pasa |
|---|---|---|---|
| e1 | **Grave** | `interno/app-trabajador.html:1083-1087` + `dashboard-proyecto.html:373,377` | **Confirmado.** El gasto de caja chica se guarda en `caja_chica` **y** se suma a `gasto_total`; el dashboard suma `gasto_total` + `caja_chica` → doble. Además el dashboard cuenta como gasto los **pedidos pendientes** del supervisor (`supervisor-obra.html:518-530`, `estado: 'pendiente'`), y filtra por **nombre** del proyecto tomado de `localStorage` (`:272`): con dos pestañas o dos proyectos del mismo nombre, mezcla |
| e2 | **Grave** | `dashboard-proyecto.html:375` | Solo suma licitaciones con `estado === 'adjudicado'`. Aprobar desde la pantalla o el servidor deja `aprobado` (`functions/licitaciones/api.js:191`) y luego `terminado`; `adjudicado` solo lo pone la app del contratista (cerrada). **La mano de obra casi nunca entra al gasto del dashboard** → utilidad inflada |
| e3 | **Grave** | dashboard vs Tesorería vs Kay | Cuatro fórmulas de "gasto": dashboard = `gasto_total` + licitaciones adjudicadas + caja chica; Tesorería (`tesoreria.html:910-921`) = pagos de licitaciones + `gastos_adicionales_compras` + cancheos + `/compras`; `balance_proyecto` (`functions/compras/api.js:327`) = compras + contratado + pagado; Kay `detalle_proyecto` = `gasto_total`. El dashboard no ve `gastos_adicionales_compras`; Tesorería no ve caja chica ni gastos de supervisores |
| e8 | Medio | `tesoreria.html:824` vs `dashboard-proyecto.html:491` | "Cobrado" en dos lugares: `ingresos` (unido por nombre) y `proyectos/…/pagos`. Kay `balance_proyecto` usa el primero (`compras/api.js:344`) y `detalle_proyecto` el segundo (`kay-api.js:346`). El balance general de Tesorería ignora `pagos`. No se puede saber sin leer la base si el dueño carga el mismo cobro en los dos |
| e10 | Medio | `dashboard-proyecto.html:358` vs `presupuesto.html:1090` | Venta: el presupuesto excluye ítems apagados (`activo === false`), el dashboard los incluye |
| e11 | Medio | Duplicar proyecto (los dos) | La copia arrastra `gasto_total` y `historial_compras` (y en el dashboard, pagos y licitaciones): el proyecto nuevo nace con gastos y cobros que no son suyos |

### Escrituras que pisan

| # | Gravedad | Dónde | Qué pasa |
|---|---|---|---|
| e4 | **Grave** | `base_datos.html:557-569` | `guardarPersonal`: `set` reemplaza a la persona con solo 5 campos → **borra `solicitudes` (copias de licitaciones) y `pagos`** en cada edición. Si cambia el nombre, además `remove` del registro viejo |
| e5 | **Grave** | `presupuesto.html:1118-1124` (carga única `:713`) | Guarda **todo** `presupuesto` con lo que tenía en memoria. Lo que Producción, Compras, Diseños, CAD, imprenta o el conector de Claude escribieron mientras estaba abierto se pierde en el siguiente autoguardado (1 s después de cualquier cambio) |
| e12 | Medio | `computo.html:201,441` | Lee un ítem, el usuario mide, y **reemplaza el ítem entero** |
| e13 | Medio | `compras.html:532` | `gastos_adicionales_compras = valorEnMemoria + monto` sin transacción |
| e14 | Medio | `app-trabajador.html:1085-1086` | `gasto_total` leer-y-escribir sin transacción (además del doble conteo) |
| e15 | Medio | `contratista/index.html:320`, `proveedor-grafico.html:397-406,515-530` | Escriben la licitación y la copia del trabajador por separado (apps cerradas: se resuelve al reabrirlas usando `/api/licitaciones`) |

### Borrados sin respaldo

| # | Gravedad | Dónde | Qué pasa |
|---|---|---|---|
| e16 | **Grave** | `proyectos-cliente.html:817-820` | Borra el proyecto entero: licitaciones y sus pagos (desaparecen del balance de Tesorería), compras, chat. Quedan colgando `/compras/{id}`, copias en `personal/…/solicitudes`, `supervisores/…/{pid}` |
| e17 | Medio | `clientes.html:535-537` | Dice "eliminar este cliente **y todos sus proyectos**" pero solo borra `clientes/{cid}`: los proyectos quedan huérfanos (siguen sumando en Tesorería sin cliente) |
| e18 | Medio | `base_datos.html:598,608,1208` y chat IA `:996` | Borra materiales/MO/proveedores (también a pedido de la IA) sin copia |
| e19 | Menor | `tesoreria.html:2229`, `dashboard-proyecto.html:546`, `disenos.html:383`, `produccion.html:3470-3474` | Ingresos, facturas emitidas, archivos y fotos se borran sin respaldo |

Hay respaldo diario de toda la base (Sesión 0), así que se puede recuperar, pero a mano y perdiendo lo del día.

### Seguridad

| # | Gravedad | Dónde | Qué pasa |
|---|---|---|---|
| e6 | **Grave si Meta sigue apuntando ahí** | `functions/index.js:1068-1073` | `identificarRol(from)` se llama sin la base (la función espera `(db, phone)`, `:858`): falla, devuelve un objeto y **`contextoProyectos` arma la lista de TODOS los proyectos** (nombre, cid/pid, estado, tareas y nombres de trabajadores) para **cualquier número que escriba**. La IA tiene instrucción de "visitante" pero el dato está en el mensaje. No verifica la firma `X-Hub-Signature-256`: cualquiera puede gastar Gemini mandando POST. Si nadie le escribe ya, solo es código roto |
| e20 | Medio | `importarAdmin` (`functions/index.js:1213`) | Público con clave fija; escribe la base sin lista blanca ni historial |
| e21 | Medio | `geminiLiveKey` | Entrega la clave de Gemini al navegador (sin uso: se puede borrar) |
| e22 | Medio (al reabrir apps) | `cliente-view.html:1445,3237,3248` | El PIN se compara en el navegador leyendo `pin_hash`; la app lee **todo** `base_datos` y **todo** `proyectos`. Al reabrir, esto no puede volver tal cual (ya anotado en el plan) |
| e23 | Menor | `public/_DataURI/…` etc. | Basura publicada; no se vio nada secreto (la clave web de Firebase es pública por diseño) |

### Otros errores encontrados

| # | Dónde | Qué pasa |
|---|---|---|
| e7 | `compras.html:163` + `:1308-1472` | Botón "Actualizar Precios BD" llama a una función que no existe (código dentro de `<script src>`) |
| e9 | `notificaciones/hub` | Avisos de clientes y trabajadores que nadie ve en el hub |
| e24 | `gantt.html:1207` | El diagnóstico IA del Gantt lee `/gantt/{cid}/{pid}` en vez de `proyectos/{cid}/{pid}/gantt` |
| e25 | `index.html:1679-1770` | Oyente `interfaz_wa/entrada`: nadie en el repo lo alimenta |
| e26 | `app-trabajador.html:424`, `interno/dashboard.html:228`, `rubikbolivia.com/index.html:62` | Enlaces a páginas que no existen (`inventario.html`, `personal.html`, `rrhh-planillas.html`) |
| e27 | `cliente-view.html:3981` | Sigue escribiendo en `requerimientos_asistidos` (módulo retirado) |

---

## f) Plan de limpieza por lotes

Cada lote es **un PR chico y revisable**. Orden pensado para: primero lo que no tiene riesgo, después lo que corrige
números, después lo que necesita mover datos. Los lotes que tocan datos reales van con respaldo verificado y OK del dueño.

| Lote | Qué | Tipo | Riesgo | Necesita |
|---|---|---|---|---|
| **1** | **Borrar basura publicada y código muerto:** `public/_DataURI/`, `www.gstatic.com/`, `cdn.jsdelivr.net/`, `fonts.googleapis.com/`, `unpkg.com/`, `rubikbolivia.com/`, `apu.html` (y sacarlo de `auth-guard.js`), `js/gemini-live.js`, el bloque `compras.html:1308-1472` + su botón, `juego-ruleta-taba-squishi.html`, enlaces rotos (e26) | Se borra | **Muy bajo** (nada los usa; se verifica en la vista previa del PR) | — |
| **2** | **Una sola fórmula de gasto y cobrado del proyecto, en el servidor** (`functions/proyectos` o ampliar `balance_proyecto`): compras + `gastos_adicionales_compras` + licitaciones (`aprobado`/`adjudicado`/`terminado`, contratado y pagado por separado) + caja chica **gastada** (no pendiente, por `pid`). Dashboard, Tesorería y Kay la usan. Arregla e1 (lectura), e2, e3, e10 | Se une | Medio (cambian los números que ve el dueño: es lo buscado) | Decidir con el dueño qué es "gasto" y qué es "cobrado" (e8) |
| 3 | **Cortar el doble conteo en origen:** app-trabajador deja de sumar a `gasto_total` (e1, e14); el pedido del supervisor pasa a `solicitudes_compra` y no a `caja_chica` | Se arregla | Bajo (apps cerradas: no entran datos nuevos hoy). Los `gasto_total` viejos ya inflados **no se pueden corregir sin leer la base**: queda para la migración de caja chica | — |
| 4 | **Escrituras que pisan:** `guardarPersonal` con `update` y sin borrar al renombrar (e4); presupuesto guarda solo lo que cambió (`update` por ítem) o avisa si otro escribió (e5); cómputo actualiza solo `measures`/`cant` (e12); transacción en `gastos_adicionales_compras` (e13) | Se arregla | Medio (presupuesto es la pantalla más grande: probar con el dueño) | — |
| 5 | **Retirar Functions sin uso:** `geminiLiveKey` (cierra el pendiente de la Sesión 0), `procesarIngestaIA`, `importarAdmin`; `whatsappWebhook` retirar (Kay lo reemplaza) o, si se quiere, arreglar + firma | Se borra | Bajo | Antes: revisar 30 días de logs de cada una (`gcloud logging read`, la cuenta de Claude puede) y que el dueño confirme en Meta si el webhook sigue configurado |
| 6 | **Borrar → archivar:** proyecto y cliente se marcan `archivado` (con copia en `respaldos_agente` como hace el conector) en vez de `remove` (e16, e17); un solo "duplicar proyecto" en el servidor que no copie dinero (e11) | Se une + arregla | Medio | — |
| 7 | **Avisos y restos:** decidir si `notificaciones/hub` se muestra en el hub o se borra junto con `interno/dashboard.html`, `feed_actividad`, oyente `interfaz_wa`, `config/admin_phone` (e9, e25); cliente-view deja de escribir `requerimientos_asistidos` (e27); diagnóstico Gantt lee la ruta correcta (e24) | Se borra / arregla | Bajo | Decisión del dueño sobre los avisos |
| 8 | **Registro único de personas** (etapa 1 de la maestra): `/personas/{id}` + `/personas_tel`, con enlaces a la clave vieja de `personal`, `supervisores`, `caja_chica` y `proveedores`; las pantallas dejan de usar el nombre como clave | Se une | Alto (migración) | Respaldo verificado + OK. Depende de 4 (para no perder datos mientras tanto) |
| 9 | Caja chica por persona (`movimientos`), solicitudes de compra únicas y Gantt/producción/diseño al servidor | Se une | — | **Lo hace la maestra** (fuera de esta etapa) |

**Recomendación:** empezar por el **Lote 1** (es limpieza pura, se revisa rápido y saca ~1,7 MB y ~170 líneas muertas)
y seguir de inmediato con el **Lote 2**, porque hoy el dashboard muestra utilidades que no son reales (e1 + e2).
El **Lote 4 (e4)** conviene antes que cualquier edición de personas en Base de Datos: hasta entonces, **no editar
personas que tengan licitaciones** (se pierden sus copias y pagos).

### Lo que no se puede saber leyendo el código

- Si Meta sigue mandando mensajes a `/api/whatsapp`, y si `importarAdmin`/`procesarIngestaIA` reciben llamadas de afuera (se ve en los logs).
- Cuánto de `gasto_total` actual es caja chica contada dos veces (hay que leer la base: lo hace la migración, con OK).
- Si hay datos en `/gantt` (raíz), `caja_chica/*/depositos`, `personal/*/pagos`, `cancheos`, `interfaz_wa`.
- Si el dueño carga los cobros en `ingresos` **y** en los pagos del proyecto (doble) o solo en uno.
- Si algún programa externo escribe en `interfaz_wa/entrada`.

## Avance (maestra)

- e5 (bot de WhatsApp de Rubik mostraba todos los proyectos a cualquier número): corregido, PR #345.
- e4 (editar persona borraba licitaciones y pagos) y e5-presupuesto (guardar pisaba a otros): corregidos, PR #346.
- Lote 1: PR #347 (subsesión).
- **Lote 2 — fórmula única de finanzas del proyecto** (`functions/proyectos/finanzas.js`, `/api/proyectos`): venta (sin ítems
  con el ojo apagado) + extras; gasto = compras sin anuladas + gastos adicionales + caja chica GASTADA (por pid o nombre, sin
  pendientes) + rendiciones de supervisores + mano de obra de licitaciones aprobadas/adjudicadas/terminadas. Decisión del
  dueño: la mano de obra se muestra **contratada** (utilidad esperada) y **pagada** (utilidad con lo pagado). Cobrado: las dos
  fuentes por separado hasta definir el registro de cobros (un pago puede cubrir varios proyectos con varias facturas).
  `gasto_total` queda solo como referencia. La usan el panel del proyecto y Kay (`balance_proyecto`); Tesorería, después.


### Archivar proyectos viejos (arranque limpio)

El dueño cargó pocas ventas y pagos en la app vieja: en vez de reconstruir todo, archiva lo viejo y arranca limpio.
- Pantalla `archivar-proyectos.html` (botón **Archivar** en Clientes): todos los proyectos de todos los clientes, filtros por
  año, etapa, cliente y texto, "elegir los que se ven" y **"elegir todos los creados antes de <fecha>"**; un toque archiva
  todos los elegidos. Pestaña Archivados para desarchivar. Los nodos sin nombre aparecen como "(sin nombre · código)".
  Sin `fecha_creacion`, la fecha sale del código del proyecto (los códigos de Firebase llevan la hora de creación).
- Servidor: `/api/proyectos` acciones `archivar` / `desarchivar` (`functions/proyectos/archivo.js`): hasta 500 por pedido,
  una sola escritura, idempotente, entrada `archivar`/`desarchivar` en `historial_operaciones` de cada proyecto.
  Marca `archivado: true` + `archivado_info {fecha, por, motivo}`; la etapa (`estado`) no cambia. Nada se borra.
- Dejan de verse en: lista del cliente (chip "🗄️ Archivados" para verlos), Tesorería (balances, contratos, estado de
  cuenta), inicio (contexto del chat IA), dashboard interno, supervisores, Kay (contexto de WhatsApp y
  `listar_proyectos_activos`, que además ya no cuenta los `cerrado`) y `listar_proyectos` del conector (salvo
  `incluir_archivados`). Las facturas (`/ingresos`) y compras siguen en Impuestos: son registros fiscales.
- Pruebas: `tools/proyectos` 4/4.
