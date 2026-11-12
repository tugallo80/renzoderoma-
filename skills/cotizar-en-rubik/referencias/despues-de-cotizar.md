# Después de cotizar: cronograma, producción, impresiones y licitaciones

Todo parte de los **ítems aplicados al presupuesto** (un ítem = lo que se entrega). Hoy (etapa 1) el conector cotiza y aplica;
las herramientas de esta parte llegan en la etapa 3. Mientras tanto, ayudá al dueño a decidir y dejá todo listo para cargar en
la app.

## Cronograma (gantt)
- Una fila por ítem aplicado, con sus subtareas (compra de materiales, corte, armado, pintura, impresión, traslado, montaje).
- Duraciones: salen de los rendimientos de la base o de lo que diga el dueño; si no hay, preguntá (una ronda).
- Respetá feriados y días libres del proyecto. Fechas de entrega y montaje: las da el dueño.
- En la app: `gantt.html` del proyecto (`/proyectos/{cid}/{pid}/gantt`).

## Producción
- Una tarjeta por ítem (pendiente → en proceso → instalado → listo), con el APU real de producción.
- Ordená por fecha de entrega y por taller (carpintería, metal, impresión).
- En la app: `produccion.html` (`/proyectos/{cid}/{pid}/produccion`).

## Impresiones
- Cada arte gráfico con medidas (ancho × alto en m), material (lona, vinil, adhesivo de piso…), cantidad y terminación.
  Las medidas salen del 3D, del plano o del dueño, con su origen, igual que en la cotización.
- En la app: pestaña "Área de Impresión" de producción (`/proyectos/{cid}/{pid}/prints`).

## Licitaciones
- Según lo que se decida en el chat: Mano de Obra, Obra Vendida o Llave en Mano (M.O. + materiales + gráficos).
- Se asignan ítems del presupuesto **por posición** (por eso aplicar nunca reordena) a un trabajador o taller de `/personal`,
  con monto y porcentajes entre participantes. El monto de referencia sale del APU (mano de obra) o del trato cerrado.
- Nunca mandes al cliente datos internos de una licitación.
- En la app: `licitaciones.html` (`/proyectos/{cid}/{pid}/licitaciones`).
