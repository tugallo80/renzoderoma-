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

### En el proyecto (decisión del dueño, 2026-11-21)

En **Compras del proyecto**, cada tarjeta de contratista suma, debajo de su contrato y sus anticipos, el bloque
**"Plata para gastos (rendición)"**:
- Lo entregado, lo rendido, lo por aprobar y el saldo, **solo de este proyecto**.
- Botones entregar, cargar gasto (ya asignados al proyecto) y PDF del proyecto.
- Aprobar, rechazar y anular ahí mismo.

Las personas que tienen plata para gastos del proyecto pero no tienen contrato en él salen abajo, en "otras personas". Tesorería
→ Rendiciones queda como la vista **global** por persona (varios proyectos y plata general).
- **Anticipo ≠ plata para gastos:** el anticipo es parte del contrato y se descuenta en la Liquidación; la plata para
  gastos se rinde con recibos.
- Servidor: `proyecto {cid, pid}` (por persona) y `estado {…, cid, pid}` (una persona, solo ese proyecto). Los registros
  viejos sin `pid` se asignan por nombre del proyecto, como en `finanzas.js`. El PDF con proyecto dice "solo este proyecto".

### Link para rendir sin app (mientras no haya grupos de WhatsApp con Kay)

- El dueño toca **"Mandarle link para rendir"** en Compras del proyecto (link de ese proyecto) o en Tesorería → Rendiciones
  (link general). Se crea un link personal, se copia y se abre WhatsApp con el mensaje (al número de Personal, si lo tiene).
  Kay también lo puede crear con `rendicion_link`.
- `public/rendir.html` es una mini app sin login, para el celular:
  - muestra el saldo de la persona (recibido, rendido, por rendir);
  - se carga cada compra en renglones (detalle, cantidad, unidad, precio c/u), con subtotal y total automáticos;
  - se agrega dónde se compró, la fecha y la foto del recibo, que se achica en el teléfono;
  - lleva el historial de lo que ya mandó, con su estado;
  - guarda un borrador por si se cierra.
- Lo que envía queda **por aprobar**, en su proyecto si el link es de un proyecto, con `via: link`.
- **Seguridad:**
  - El token va en el `#` del link, así no llega a los registros del hosting.
  - En la base solo se guarda su hash (`/rendicion_links`, cerrado a la app).
  - El link vence a los 30 días (configurable hasta 90) y se puede revocar (`revocar_link`).
  - Solo deja ver y cargar los gastos de esa persona.
- `functions/rendiciones/link.js` → `/api/rendir` (`rendirLink`, público, valida el token).

## PDF

`public/js/pdf-rendicion.js` (`PdfRendicion`, copia en `functions/pdf/compartido/`) tiene el resumen, los movimientos con
su estado y el anexo de recibos. El servidor lo genera con `pdf_documento { tipo: rendicion, worker_id | telefono, desde?, hasta? }`.

## Kay

`rendicion_estado`, `rendiciones_resumen` (lectura) y `rendicion_entregar`, `rendicion_gasto`, `rendicion_aprobar`,
`rendicion_rechazar`, `rendicion_anular` (escritura, con `registrado_por`; el rol decide pendiente o aprobado).
Del lado de Kay (desarrollo-personal) faltan las herramientas y reconocer al trabajador por su número.

Pruebas: `tools/rendiciones` 6/6, `tools/documentos` 8/8.
