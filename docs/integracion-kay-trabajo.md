# Integración Kay ↔ app de trabajo (Rubik OS)

Nexo para que **Kay** (asistente personal, repo `tugallo80/desarrollo-personal`, proyecto de Google Cloud
`desarrollo-personal-a831d`) pueda consultar y, más adelante, operar sobre la **app de trabajo** (Rubik OS,
repo `tugallo80/renzoderoma-`, proyecto `rubik-bolivia`). Este documento está igual en los dos repos.

Estado (2026-10-14): conexión desplegada con una sola acción de prueba, de solo lectura:
`listar_proyectos_activos` ("Kay, ¿qué proyectos tengo activos?").
2026-11-17: `buscar_proyecto`, `detalle_proyecto` y `requerimientos_pendientes` (solo lectura), para el modo dueño de
Kay recepcionista por WhatsApp ("¿cómo va el stand de X?", "¿cuánto me pagó?", "¿qué está atrasado?").
2026-11-19: `herramientas_conector` y `usar_conector`: Kay usa las mismas herramientas de lectura que el conector de Claude
(mismo código y rutas). Los proyectos se leen con el Admin SDK, como el conector (la lectura REST `shallow` devolvía vacío).
2026-11-19: **compras** — `registrar_compra`, `anular_compra` (escriben) y `balance_mensual`, `balance_proyecto` (lectura),
con el mismo módulo que usa la app (`functions/compras/api.js`, `/api/compras`). Detalle en `docs/sesiones/07-compras.md`.
2026-11-19: **operar proyectos por el conector — licitaciones (etapa 1)**: `herramientas_conector` devuelve también las
herramientas de **escritura** permitidas a Kay (hoy `modificar_licitacion`, con `annotations.readOnlyHint: false`) y
`usar_conector` las acepta solo con `registrado_por`. Misma lógica que la pantalla (`functions/licitaciones/api.js`).
Siguen Gantt, Producción y Diseño. Detalle en `docs/sesiones/08-operaciones-kay.md`.
2026-11-20: **cobros y facturas de venta** — `cobros_pendientes`, `listar_cobros` (lectura), `registrar_cobro`,
`anular_cobro`, `registrar_factura_venta`, `anular_factura_venta` (escriben, con `registrado_por`): un pago repartido
entre varios proyectos del cliente. Mismo módulo que Tesorería (`functions/cobros/api.js`). Detalle en `docs/sesiones/10-cobros.md`.
2026-11-20: **crear licitaciones y cambiar la etapa del proyecto por el conector** — `buscar_trabajador` (lectura),
`crear_licitacion` y `cambiar_estado_proyecto` (escritura, en `ESCRITURA_KAY`). Crear usa la misma operación que la pantalla
(`guardar` de `functions/licitaciones/api.js`); la etapa, `functions/proyectos/estado.js` (también la usan el panel del proyecto
y la lista del cliente).
2026-11-20: **PDF en el servidor** — `pdf_documento { tipo: licitacion, cid, pid, id, modo?: general|detalle }` (lectura) →
`{ nombre, mime: "application/pdf", base64, bytes, paginas }`, el mismo PDF que descarga la pantalla de Licitaciones
(`public/js/pdf-licitacion.js`, copia en `functions/pdf/compartido/`). Kay lo sube a WhatsApp como documento.
2026-11-21: `pdf_documento` suma **cotización** (`tipo: cotizacion`, `modo: normal|impuestos_por_item`: el PDF del presupuesto para
el cliente) y **órdenes de Producción** (`tipo: orden`, `modo: produccion|impresion|impresion_con_imagen|completa`), con el mismo
código que `presupuesto.html` y `produccion.html` (`public/js/pdf-cotizacion.js` y `pdf-produccion.js`).
2026-11-21: **gastos de funcionamiento del taller**: `registrar_compra` acepta `categoria` (alquiler, mantenimiento, herramientas,
servicios, otros; sin cid/pid) y hay `gastos_funcionamiento { mes? }` (lectura). `balance_mensual` separa compras de proyectos,
funcionamiento y sin clasificar. Detalle en `docs/sesiones/07-compras.md`.
2026-11-21: **`registrar_trabajador`** (escritura): Kay da de alta en Personal a un trabajador o proveedor (ej. una imprenta)
para poder licitarle; `buscar_trabajador` avisa si el nombre está solo en Proveedores.
2026-11-21: `pdf_documento` suma **liquidación de contrato** (`tipo: liquidacion, cid, pid, id`): el estado del contrato para mandarle
al trabajador o proveedor (monto acordado, anticipos y pagos, saldo pendiente, desglose y comprobantes), el mismo PDF que
"Liquidación" en Compras del proyecto (`public/js/pdf-liquidacion.js`).
2026-11-19: `buscar_contacto` (lectura): Kay por WhatsApp busca por nombre el teléfono de alguien del personal,
un proveedor o un cliente cuando el dueño le pide "mandale a José Luis…" y no está en su agenda.

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
| `listar_proyectos_activos` | sí | — | `{ total, proyectos: [{ cliente, nombre, estado, fecha, tipo }], terminados: { entregado, cerrado, cancelado }, archivados, clientesLeidos }` |
| `buscar_proyecto` | sí | `{ texto }` | `{ total, proyectos: [{ cid, pid, cliente, nombre, estado, fecha }] }` (nombre del proyecto o del cliente, todos los estados, 10 más nuevos) |
| `detalle_proyecto` | sí | `{ cid, pid }` | `{ cliente, nombre, estado, fecha, inicio, presupuesto: { items, total_bs, capitulos }, monto_cierre_bs, gasto_total_bs, cobrado_bs, ultimos_pagos, cronograma: { tareas, avance_promedio, atrasadas, proximas } }` |
| `herramientas_conector` | sí | — | `{ herramientas: [{ name, description, inputSchema, annotations: { readOnlyHint } }] }`: las de lectura del conector MCP "Rubik" (las mismas de Claude), sin `prueba_imagen` ni `ver_render`, **más las de escritura permitidas a Kay** (`ESCRITURA_KAY` en `kay-api.js`: hoy `modificar_licitacion`, `crear_licitacion`, `cambiar_estado_proyecto` y `registrar_trabajador`), marcadas `readOnlyHint: false`. Kay pide el sí del dueño antes de usar una de escritura |
| `usar_conector` | sí* | `{ nombre, args }` | `{ error, texto, imagenes_omitidas? }`: corre esa herramienta con el usuario hub del dueño y el almacén del conector (`RUTAS_MCP`). *Con una herramienta de escritura, `args.registrado_por: {rol, nombre, telefono}` es obligatorio (va al historial; la vía la pone el servidor: `whatsapp`) y conviene `args.idempotencia` = id del mensaje de WhatsApp |
| `requerimiento` | **no** | `{ accion: crear\|editar\|adjuntar, … }` (los mismos campos que `/api/requerimiento`; adjuntar solo `pdf` o `imagen`) | `{ error, id? }`: corre `requerimientos/api.js → atender` con el usuario hub del dueño. Kay confirma con el dueño antes |
| `cotizar_requerimiento` | **no** | `{ id, cid?, pid?, cliente_nombre?, proyecto_nombre?, nota? }` | `{ error, cid, pid, conv, turno, proyecto, adjuntos }`: crea cliente/proyecto si faltan, abre una cotización nueva, registra la confirmación del dueño, `asignar_requerimiento` y encola el turno del Agente IA (Claude, API de Anthropic) |
| `estado_cotizacion` | sí | `{ cid, pid, conv }` | `{ fase: en_cola\|trabajando\|listo\|esperando_dueno\|tope\|error, texto, ultimo_mensaje?, borrador? }` |
| `mensaje_agente` | **no** | `{ cid, pid, conv, texto }` | `{ error, turno }`: respuesta o cambio del dueño al Agente IA (otro turno) |
| `requerimientos_pendientes` | sí | — | `{ total, requerimientos: [{ titulo, cliente, descripcion, actualizado }] }` (sin proyecto, 20 más nuevos) |
| `registrar_compra` | **no** | `{ idempotencia, total?, fecha?, cid?, pid?, proveedor?: {nombre, nit?, contacto?}, factura?: {nit, razon_social?, nro, cuf?, fecha?, monto?}, items?: [{material, cantidad, unidad?, precio}], nota?, foto?: {datos_base64, mime?}, pagado_con?: {medio, persona?}, categoria?: alquiler\|mantenimiento\|herramientas\|servicios\|otros (gasto de funcionamiento del taller, sin cid/pid), registrado_por: {rol, nombre, telefono} }` | `{ error, id, repetida, proveedor_id, proveedor_nuevo?, resumen }`. Una sola operación: `/compras`, gasto del proyecto (`historial_compras` + `gasto_total` con transacción), crédito fiscal en `/compras_facturadas` si hay factura, proveedor (`NIT_…`/`NOM_…`) y precios, foto en Storage. **`idempotencia` = id del mensaje de WhatsApp**: reintentar devuelve la misma compra (`repetida: true`). Kay confirma con quien la carga antes |
| `anular_compra` | **no** | `{ id, motivo, registrado_por }` | `{ error, ok, id, ya_estaba_anulada? }`: no borra; resta del gasto del proyecto una sola vez y marca la factura como anulada |
| `gastos_funcionamiento` | sí | `{ mes?: "AAAA-MM", meses?: 6 }` | `{ mes, total, por_categoria, gastos: [{id, fecha, categoria, total, proveedor, nota, factura, comprobante, pagado_con}], historial: [{mes, total, por_categoria}] }`: lo que cuesta tener el taller abierto |
| `balance_mensual` | sí | `{ mes: "AAAA-MM" }` | `{ mes, ingresos: {total (cobros + registros viejos), registros, cobros, facturado, debito_fiscal_iva_13}, egresos: {total, compras, pagos_contratistas, pagos_cancheos, cantidad_compras, compras_de_proyectos, funcionamiento: {total, por_categoria}, compras_sin_clasificar}, resultado, impuestos: {compras_con_factura, monto_facturado, credito_fiscal_iva_13}, nota }` |
| `cobros_pendientes` | sí | `{ cid, monto? }` | `{ cliente, proyectos: [{pid, proyecto, venta, cobrado, saldo}], otros, facturas_pendientes: [{id, pid, nro_factura, saldo}], saldo_total, reparto_sugerido?, sin_asignar? }`: usarlo antes de `registrar_cobro` para proponer el reparto |
| `listar_cobros` | sí | `{ cid?, pid?, desde?, hasta? }` | `{ cobros: [{id, fecha, cliente, monto, aplicaciones}], facturas: [{id, nro_factura, monto, cobrado, estado_cobro}], total_cobrado }` |
| `registrar_cobro` | **no** | `{ idempotencia, cid, monto, fecha?, concepto?, medio?, aplicaciones: [{pid, monto, factura_id?}], foto?, registrado_por }` | `{ id, aplicaciones }`. Las aplicaciones suman el monto; con el sí del dueño al reparto |
| `anular_cobro` | **no** | `{ idempotencia, id, motivo, registrado_por }` | `{ ok }`: lo quita de cada proyecto y de sus facturas |
| `registrar_factura_venta` | **no** | `{ idempotencia, cid, pid, monto, nro_factura, fecha?, nit?, cuf?, cliente_rs?, foto?, registrado_por }` | `{ id }` (no repite número de factura) |
| `anular_factura_venta` | **no** | `{ idempotencia, id, motivo, registrado_por }` | `{ ok }` (solo sin cobros aplicados) |
| `pdf_documento` | sí | `{ tipo: "licitacion", cid, pid, id, modo?: "general"\|"detalle" }` · `{ tipo: "liquidacion", cid, pid, id }` (estado del contrato: acordado, anticipos, saldo) · `{ tipo: "cotizacion", cid, pid, modo?: "normal"\|"impuestos_por_item" }` · `{ tipo: "orden", cid, pid, modo?: "produccion"\|"impresion"\|"impresion_con_imagen"\|"completa" }` | `{ nombre, mime: "application/pdf", base64, bytes, paginas }` (máx. 10 MB). El mismo PDF que descarga la pantalla (Licitaciones, Compras → Liquidación, Presupuesto o Producción), generado en el servidor (`functions/documentos`); queda una copia en Storage (`documentos/{cid}/{pid}/`, sin enlace público). Fotos solo de nuestro Storage, achicadas a ≤1600 px. La cotización usa lo **guardado** del presupuesto (fecha, impuestos, descuento, condiciones, monto de cierre) |
| `balance_proyecto` | sí | `{ cid, pid }` | La **fórmula única** del panel del proyecto (`functions/proyectos/finanzas.js`, Sesión 9 Lote 2): `{ proyecto, venta: {presupuesto, monto_cierre, extras_cliente, final}, gasto: {compras, compras_adicionales, caja_chica, caja_chica_pendiente, supervisores_gastos, supervisores_extras, mano_obra_contratada, mano_obra_extras, mano_obra_pagada, esperado, con_pagado}, utilidad_esperada, utilidad_con_pagado, cobrado: {pagos_proyecto, facturado_tesoreria, cobrado_tesoreria}, saldo_por_cobrar, contratistas: [{trabajador, contrato, extras, pagado, saldo}] }` |
| `buscar_contacto` | sí | `{ nombre }` | `{ encontrados: [{ nombre, telefono, origen: personal\|proveedor\|cliente, detalle }] }` (hasta 5, el mejor primero; sin sueldos ni datos internos) |

`listar_proyectos_activos`: recorre `/proyectos/$cid/$pid` de todos los clientes y devuelve los que **no** están
`entregado`, `cerrado` ni `cancelado`, ni **archivados** (`archivado: true`, pantalla `archivar-proyectos.html`: proyectos
viejos que el dueño guardó para arrancar limpio; no se borran y `archivados` dice cuántos hay). El ciclo de vida completo de un proyecto es `requerimiento` → `cotizacion` →
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

## Herramientas de escritura del conector (operar proyectos)

| Herramienta | Qué hace | Args |
|---|---|---|
| `listar_licitaciones` (lectura) | Licitaciones de un proyecto, o de todos buscando al trabajador: estado, contrato, extras, pagado, saldo | `{ cid, pid }` o `{ texto }` |
| `modificar_licitacion` | Misma lógica que la pantalla de Licitaciones: copia del trabajador, responsables en el presupuesto, historial antes → después en `proyectos/{cid}/{pid}/historial_operaciones`. No toca `gasto_total` | `{ cid, pid, lid, operacion: cambiar_monto\|cambiar_contratista\|aprobar\|contra_oferta\|terminar\|registrar_pago\|anular_pago\|agregar_extra\|anular, …, idempotencia, registrado_por }` |
| `buscar_trabajador` (lectura) | Trabajadores y proveedores de la base (`personal`) por nombre, empresa o especialidad → `worker_id`, nombre, tipo, especialidad. Si no hay nadie en Personal pero sí en Proveedores (`base_datos/proveedores`, que no sirve para licitar), lo dice en `en_proveedores` + `nota` | `{ texto }` |
| `registrar_trabajador` | Alta en Personal como Base de datos → Personal (la clave sale del nombre, sin tildes; sin sueldo). Si ya existe devuelve el error con su `worker_id` (con `actualizar: true` cambia tipo, especialidad o teléfono) | `{ nombre, tipo: graficos\|externo\|empresa\|interno\|supervisor, especialidad?, telefono?, actualizar?, idempotencia, registrado_por }` |
| `crear_licitacion` | Encarga trabajo a alguien de la base con la operación `guardar` de la pantalla (copia del trabajador; si queda `aprobado`, responsable en los ítems del presupuesto; historial). El total es la suma del alcance | `{ cid, pid, worker_id \| trabajador, alcance: [{ item?, descripcion?, cant?, und?, monto }], tipo?: mano_de_obra\|grafico\|llave_en_mano\|supervision, estado?: enviado\|aprobado, periodo?, nota?, idempotencia, registrado_por }` |
| `cambiar_estado_proyecto` | Etapa del proyecto con historial antes → después (`functions/proyectos/estado.js`, la misma que usan el panel y la lista del cliente) | `{ cid, pid, estado: requerimiento\|cotizacion\|propuesta_enviada\|negociando\|contrato_firmado\|planificacion\|produccion\|entregado\|cerrado\|cancelado, motivo?, idempotencia, registrado_por }` |

Ejemplo (Kay, después del sí del dueño): `usar_conector { nombre: "modificar_licitacion", args: { cid, pid, lid,
operacion: "cambiar_monto", monto: 3000, motivo: "acordado con Pollo", idempotencia: "<id del mensaje>",
registrado_por: { rol: "dueño", nombre: "Renzo", telefono: "+591…" } } }`.

Ejemplo (encargo a una imprenta): `buscar_trabajador { texto: "datecolor" }` → `worker_id`; `ver_presupuesto` → índice del
ítem; con el sí del dueño, `usar_conector { nombre: "crear_licitacion", args: { cid, pid, worker_id, tipo: "grafico",
estado: "aprobado", alcance: [{ item: 0, monto: 450 }], idempotencia: "<id del mensaje>", registrado_por: {…} } }`.

