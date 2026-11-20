# Sesión 10 — Cobros y facturas de venta: un solo registro (app y Kay)

**Problema (informe de cobros, Sesión 9):** los cobros estaban en tres lugares que no se hablaban. Por un lado, los pagos
de cada proyecto (panel del proyecto y estado de cuenta de Tesorería, con campos distintos). Por otro, `/ingresos`
(facturas de venta y "cobros" de Tesorería, unidos al proyecto **por nombre**). Y además, las facturas escaneadas
en el proyecto. Un pago que cubría varios proyectos no tenía cómo cargarse.
Decisión del dueño: archivar lo viejo (`archivar-proyectos.html`) y arrancar limpio con esto.

## Modelo (`functions/cobros/api.js`, `/api/cobros`, Kay por `kayApi`)

- **Factura de venta** → `/ingresos/{fid}` (Impuestos ya la lee) con `origen: "modulo"` y `cid`/`pid` (el proyecto por su
  código, no por el nombre). Tiene `cobrado`, `cobros {cobroId: monto}` y `estado_cobro` (pendiente, parcial o cobrado).
  Se copia en `proyectos/{cid}/{pid}/facturas_emitidas/{fid}`, que lee el panel y el portal del cliente.
  No se repite el número de factura (con el mismo NIT).
- **Cobro** → `/cobros/{id}` `{cid, cliente, fecha, monto, concepto, medio, comprobante, aplicaciones: [{pid, proyecto, monto, factura_id?}]}`.
  Las aplicaciones tienen que sumar el total, y una factura no puede recibir más que su saldo.
  Cada aplicación se copia en `proyectos/{cid}/{pid}/pagos/{id}_{n}` con `cobro_id`. Así el panel, el estado de cuenta,
  el portal y la fórmula de finanzas lo ven sin cambios.
- **Anular** en lugar de borrar: un cobro se quita de cada proyecto y de sus facturas; una factura solo se anula si no
  tiene cobros. Todo es idempotente, deja historial en `historial_operaciones` de cada proyecto y lleva `registrado_por`.
- `pendientes {cid, monto?}`: lista los proyectos del cliente con venta (fórmula única), cobrado y saldo. Deja afuera
  los que están en cotización y los archivados. Incluye las facturas sin cobrar y, si se pasa un monto, sugiere un
  reparto (lo más viejo primero). `otros` son el resto de sus proyectos (por ejemplo, un anticipo antes del contrato).
- Reglas: `/cobros` lo lee el hub y solo lo escribe la Function. Storage: `cobros/AAAA-MM/{id}.ext` y `facturas_venta/AAAA-MM/{id}.ext`.

## Pantallas

- **Tesorería → Cobros:** monto y fecha → cliente → reparto entre sus proyectos, con lo que falta cobrar en cada uno y
  la factura a la que se aplica. Se puede agregar otro proyecto del cliente. Abajo se ve el historial de cobros nuevos,
  con opción de anular.
- **Tesorería → Facturas de venta:** el proyecto se elige de la lista ("Proyecto · Cliente"). "Cobrado" registra el
  cobro. "Marcar cobrada" registra el cobro del saldo. El tacho anula (las viejas se borran como antes).
- **Tesorería → Estado de cuenta → pago:** pasa por el módulo.
- **Cuentas por cobrar:** lo cobrado sale de los pagos del proyecto (antes, de `/ingresos` por nombre).
- **KPI de utilidad global:** ingresos = cobros + registros viejos de `/ingresos`. Las facturas del módulo no suman
  dos veces.
- **Panel del proyecto:** el pago manual y el escaneado van como cobro de ese proyecto, y el ✕ anula el cobro (de
  todos los proyectos si fue repartido). La factura escaneada va al registro único y su ✕ la anula.
- **`balance_mensual`** (Kay): `ingresos.total` = cobros + registros viejos. Aparte informa `facturado` y
  `debito_fiscal_iva_13`.

## Kay (WhatsApp)

`cobros_pendientes`, `listar_cobros` (lectura) y `registrar_cobro`, `anular_cobro`, `registrar_factura_venta`,
`anular_factura_venta` (escritura, con `registrado_por`). Flujo esperado: "me pagó TAG 20.000 por los dos stands" →
`cobros_pendientes {cid, monto: 20000}` → Kay propone el reparto → con el sí del dueño, `registrar_cobro`.
Del lado de Kay (repo desarrollo-personal) falta sumar las herramientas.

## Sin migración

Los pagos viejos de cada proyecto siguen contando tal cual (no tienen `cobro_id`). Las facturas viejas de `/ingresos`
y de los proyectos quedan como están. Lo viejo se archiva.

Pruebas: `tools/cobros` 6/6, `tools/compras` 9/9 (balance con cobros), reglas 186 OK, prueba de Tesorería en navegador.
