# Sesión 7 — Compras y facturas de compra: una sola regla, en el servidor

**Objetivo:** que una compra se registre siempre igual, desde la app o desde Kay por WhatsApp, y deje todo en su
lugar: gasto del proyecto, egreso de Tesorería, crédito fiscal, proveedor y precios, comprobante y quién la cargó.

## 1. Lo que había (19 nov 2026)

| Dónde | Qué hacía | Problema |
|---|---|---|
| `tesoreria.html` → `registrarFacturaCompra` + `syncFacturaCompraABD` | `/compras_facturadas` (push), foto en `facturas_compra/`, proveedor por NIT o nombre (clave push) y si no, uno nuevo | No suma al proyecto ni al balance |
| `compras.html` → chat con IA | Proveedor en `base_datos/proveedores/{NOMBRE}`, material en `base_datos/materiales/{NOMBRE CON ESPACIOS}`, `gasto_total` leyendo y escribiendo (sin transacción), `historial_compras`, `/tesoreria/iva_compras/{mes}` | Otra clave de proveedor y de material (repetidos); **`iva_compras` no lo lee ninguna pantalla**; carreras en `gasto_total` |
| `compras.html` → borrar compra IA | Resta de `gasto_total` | **No borra el registro**: cada clic vuelve a restar |
| `base_datos.html` | Tercer lugar que escribe proveedores (claves push) | — |
| `app-trabajador.html` | `caja_chica/{wid}/gastos` **y** `gasto_total` | El dashboard del proyecto suma `gasto_total` + caja chica: ese gasto se cuenta dos veces |
| `licitaciones.html` | Cambia `gasto_total` según el estado | — |
| `tesoreria.html` → balance | Egresos = pagos de licitaciones + `gastos_adicionales_compras` + cancheos | **Las compras no entran** |

## 2. Decisiones (OK del dueño, 19 nov 2026)

1. **Crédito fiscal en un solo lugar: `/compras_facturadas`** (lo leen la pestaña Impuestos y el inicio). `iva_compras` se
   migra ahí sin duplicar (NIT + número) y se archiva.
2. Las compras viejas de `historial_compras` **entran al balance** de sus meses, marcadas `origen: migrada`.
3. Una compra con precios **actualiza la base**: precio por proveedor siempre, y el precio general del material en su
   registro existente (misma regla anti-repetidos que `guardar_en_base`, `functions/agente/claves.js`).

## 3. El módulo (`functions/compras/`)

Una operación, tres entradas con el mismo código: la app (`/api/compras`, lista blanca hub), Kay (`kayApi`:
`registrar_compra`, `anular_compra`, `balance_mensual`, `balance_proyecto`) y, si hace falta, el conector de Claude.

`/compras/{id}`:
```
{ fecha, mes, total, moneda:"BOB", proyecto: {cid, pid, nombre} | null,
  proveedor_id, proveedor_nombre, factura: {nit, razon_social, nro, cuf, fecha, monto} | null,
  items: [{material, material_clave, cantidad, unidad, precio, subtotal}], nota, comprobante: {ruta, url},
  pagado_con: {medio, persona}, origen: {tipo: directa|solicitud|caja_chica|migrada, ref},
  registrado_por: {uid, rol, nombre, telefono, via: app|whatsapp|agente|migracion},
  idempotencia, creado, estado: registrada|anulada, anulada?: {por, fecha, motivo}, gasto_total_aplicado }
```

| Efecto | Ruta |
|---|---|
| Registro y egreso de Tesorería (por `mes`) | `/compras/{id}` |
| Gasto del proyecto | `/proyectos/{cid}/{pid}/historial_compras/{id}` (espejo, mismo formato + `compra_id`) y `gasto_total` con transacción |
| Crédito fiscal | `/compras_facturadas/{id}` (+ `compra_id`, `proyecto`) |
| Proveedor | `/base_datos/proveedores/{NIT_… \| NOM_…}`: datos sin pisar, `facturas/{id}`, `materiales/{clave}` |
| Precio del material | `/base_datos/materiales/{clave existente o nueva}` |
| Comprobante | Storage `compras/{AAAA-MM}/{id}.{jpg\|png\|webp}` con enlace con token |

Reglas de la operación:
- **Idempotente:** `/compras_idem/{sha256(idempotencia)}` se reserva con transacción. El reintento devuelve la misma compra;
  si el intento anterior se cortó antes de grabar, se completa con el id reservado.
- **`gasto_total` una sola vez:** la marca `gasto_total_aplicado` cambia con transacción y solo quien la cambia toca
  `gasto_total` (también con transacción). Vale para reintentos y para anular.
- **Validaciones antes de escribir:** total > 0 y que coincida con la suma de los ítems (±1 Bs); factura con NIT (≥5
  dígitos) y número; fechas AAAA-MM-DD; proyecto existente; foto JPG/PNG/WEBP ≤ 8 MB.
- **Anular, no borrar:** marca la compra, la factura y el espejo; resta del gasto una vez.
- **Quién:** lo pone el servidor (app: uid y email del token; Kay: `registrado_por` + `via: whatsapp`).
- Reglas de la base: `/compras` la lee el hub y la escribe solo la Function; `/compras_idem` nadie desde el navegador.

## 4. Etapas

| Etapa | Qué | Estado |
|---|---|---|
| 1 | Módulo, `/api/compras`, acciones de Kay, reglas, pruebas (`tools/compras`, 8/8; reglas 187 OK) | ✅ |
| 2 | Tesorería y el chat de Compras usan `/api/compras` (`public/js/compras-api.js`); anular en vez de borrar; el balance de Tesorería suma `/compras`; Impuestos e inicio no cuentan las anuladas | ✅ |
| 3 | Migración en Cloud Shell: `revisar` (dry-run con informe) → `respaldar` → `aplicar` (pide SI). `iva_compras` → `compras_facturadas`; `historial_compras` → `/compras` (`origen: migrada`); proveedores a `NIT_…`/`NOM_…` con `proveedores_alias`. Después se cierran en las reglas las escrituras del navegador sobre compras y facturas | ⏳ (necesita OK) |
| 4 | Documento de Kay igual en los dos repos | 🟡 este repo hecho; falta copiarlo a `desarrollo-personal` |

### Etapa 2 en detalle

- **Tesorería → Cargar factura de compra:** llama a `registrar` con la factura y el comprobante (foto o PDF). Ahora pide el
  NIT (≥5 dígitos): una factura sin NIT no sirve como crédito fiscal. La clave de idempotencia vale hasta que se guarda,
  así que dos toques en Guardar no duplican. Eliminar una factura nueva la **anula** (pide el motivo); las viejas, sin
  `compra_id`, se siguen borrando como antes hasta la migración.
- **Compras → chat con IA:** la IA lee el recibo como antes y la app manda una sola operación con `items_referencia: true`
  (los precios leídos pueden no sumar exacto al total). El comprobante lo guarda el servidor (ya no `comprobantes/` desde
  el navegador). Si el servidor rechaza algo, el chat lo muestra en rojo.
- **Borrar compra:** las nuevas se anulan en el servidor; las viejas se borran **y** restan una sola vez con transacción
  (antes restaban en cada clic y el registro quedaba).
- **Balance de Tesorería:** suma `/compras` como egreso. Pestaña Impuestos e inicio: filtran las anuladas.
- `compras_facturadas` sigue escribible desde el navegador solo para las facturas viejas (borrar y adjuntar foto); se
  cierra en la etapa 3, después de migrarlas.

## 5. Lo que viene (diseño, sin construir)

- **Personas y roles:** `/personas/{id}`: `{nombre, telefono, roles: [dueño|supervisor|trabajador|contratista|compras],
  proyectos: {cid_pid: true}, permisos?, enlaces: {personal, supervisores}}` + índice `/personas_tel/{+591…} → id` para que
  Kay sepa quién escribe. Permisos en el servidor: trabajador registra en sus proyectos; supervisor además aprueba hasta un
  monto; compras cotiza y paga; dueño todo.
- **Solicitudes de compra:** `/solicitudes_compra/{id}` con estados **pedida → cotizando → cotizada → aprobada → pagada →
  recibida** (+ rechazada, cancelada): `items, proyecto, solicitante`, `cotizaciones/{id}: {proveedor_id, monto, validez,
  adjuntos[], qr_pago}`, `aprobacion`, `pago {comprobante, monto, por}`, `recepcion {por, fotos}`, `historial_estados` y
  `compra_id` (al pagar se crea la compra con `origen: solicitud`). Las de hoy (`proyectos/…/solicitudes_compra`) se migran.
- **Caja chica por persona:** `/caja_chica/{persona}/movimientos/{id}` con `tipo: deposito|gasto|rendicion|devolucion`; el
  saldo se calcula. Un gasto de caja chica es una compra con `pagado_con: caja_chica` (cuenta una sola vez: arregla el doble
  conteo del dashboard).
