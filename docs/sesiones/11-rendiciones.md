# Sesión 11 — Rendición de cuentas (caja chica por persona)

**Pedido del dueño:** controlar la plata que le da a un trabajador o contratista para gastos (materiales, pasajes…) y que la
persona rinda con recibos, también por WhatsApp con Kay.

## Modelo (`functions/rendiciones/api.js`, `/api/rendiciones`, Kay por `kayApi`)

Usa el nodo que ya existía, `/caja_chica/{wid}`, así sirve lo que ya está cargado. Lo leen la app del trabajador y la fórmula
de finanzas del proyecto, que solo cuenta los gastos aprobados.
- `depositos/{id}`: lo que el dueño le dio `{monto, fecha, nota, proyecto, cid, pid, medio, comprobante, registrado_por}`.
  Si se anula, queda `anulado: true` y no cuenta.
- `gastos/{id}`: lo que rinde `{monto, concepto, proveedor, proyecto, cid, pid, comprobante, estado, registrado_por}`.
  - Si lo carga el trabajador (Kay por WhatsApp, rol distinto de dueño) queda **pendiente**; si lo carga el dueño, **aprobado**.
  - Pendiente → aprobar o rechazar (con motivo); también se puede anular.
  - Los registros viejos sin `estado` cuentan como aprobados.
- `saldo_en_mano` = entregado − gastos aprobados − pendientes. Si es negativo, gastó más de lo entregado y se le debe.
- Si el gasto tiene proyecto (`pid`), al aprobarse cuenta como gasto del proyecto (`finanzas.js`: los pendientes aparecen como "pedido pendiente").
- La persona se indica por `worker_id` o por **teléfono** (últimos 8 dígitos, si coincide con una sola persona en Personal).
  Así Kay reconoce a quien le escribe.
- Recibos en Storage: `rendiciones/{wid}/AAAA-MM/{id}.ext`.

Operaciones: `estado`, `resumen`, `entregar`, `registrar_gasto`, `aprobar`, `rechazar`, `anular`. Las escrituras son
idempotentes y registran quién y cuándo.

## Pantalla

Tesorería → **Rendiciones** (en el celular, "Rendir"):
- Arriba: el resumen de todas las personas, con su saldo y los gastos por aprobar.
- Al elegir una persona: los totales; los botones entregar plata, cargar gasto (con recibo y proyecto) y PDF; los
  movimientos, donde se aprueba, se rechaza o se anula.

## PDF

`public/js/pdf-rendicion.js` (`PdfRendicion`, copia en `functions/pdf/compartido/`) tiene el resumen, los movimientos con
su estado y el anexo de recibos. El servidor lo genera con `pdf_documento { tipo: rendicion, worker_id | telefono, desde?, hasta? }`.

## Kay

`rendicion_estado`, `rendiciones_resumen` (lectura) y `rendicion_entregar`, `rendicion_gasto`, `rendicion_aprobar`,
`rendicion_rechazar`, `rendicion_anular` (escritura, con `registrado_por`; el rol decide pendiente o aprobado).
Del lado de Kay (desarrollo-personal) faltan las herramientas y reconocer al trabajador por su número.

Pruebas: `tools/rendiciones` 4/4, `tools/documentos` 8/8.
