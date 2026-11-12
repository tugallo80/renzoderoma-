# Herramientas del conector "Rubik"

Todas validan su entrada, solo tocan los nodos que les corresponden y devuelven JSON. Los errores vuelven con el motivo:
corregí y reintentá; si falta un dato, preguntalo.

## Clientes y proyectos
- **`listar_clientes`** `{texto?}` → `cid`, nombre, rubro.
- **`crear_cliente`** `{nombre, rubro?, wsp?, email?}` → si ya existe uno con ese nombre devuelve `ya_existe` y no crea nada.
  Solo con `forzar: true` si el dueño confirma que es otro. Logo, portada y PIN se cargan en la app.
- **`listar_proyectos`** `{cid, estado?, texto?}` → `pid`, nombre, estado (cotizacion, planificacion, produccion, entregado,
  cerrado), mes, ítems, total del presupuesto (sin impuestos ni descuento; lo apagado no suma).
- **`crear_proyecto`** `{cid, nombre, estado?="cotizacion", mes?="AAAA-MM", agencia?}` → no duplica (igual que clientes).
- **`ver_presupuesto`** `{cid, pid, item?}` → capítulos e ítems (n, id, cant, PU, total, apagado, del agente); con `item`
  (n o id), el APU con el origen de cada fila y las características.

## Cotizar
- **`abrir_cotizacion`** `{cid, pid, titulo?}` → `conv` nueva + contexto (normas, memoria, presupuesto actual) + adjuntos
  del proyecto. Con `{conv}` retoma: borrador y últimos mensajes. **Una por chat.**
- **`registrar_mensaje_del_dueno`** `{cid, pid, conv, texto}` → `dueño:<id>`. Lo que dijo el dueño, textual. Queda en la
  conversación de la app.
- **`registrar_lectura_de_archivo`** `{cid, pid, conv, nombre, tipo: pdf|imagen, resumen}` → id del adjunto para
  `cota_plano:`. Resumen ≤ 3000 caracteres con renglones, cotas tal cual (con página), materiales y notas.
- **`buscar_base`** `{texto, nodo?, espesor_mm?, claves?, limite?}` → materiales, mano de obra, oficios, rendimientos y
  equivalencias con su origen `base:…`. Una búsqueda por cosa (en paralelo). Si no está, no lo inventes.
- **`medicion_3d`** `{cid, pid, adjunto, item?, piezas?}` → tabla de piezas (largo, ancho, espesor, m², ml, m³, material).
  Única fuente de medidas del 3D. Consultalo una vez.
- **`escala_3d`** `{cid, pid, conv, adjunto, medida_mm, eje | pieza+dimension, origen}` → calibra un 3D que no está a escala,
  solo con `cota_plano:` o `dueño:`.
- **`armar_borrador`** `{cid, pid, conv, operaciones[]}` → aplica en orden; devuelve aplicadas, rechazadas (con motivo) y el
  borrador con totales calculados. Operaciones:
  - `capitulo {nombre}`
  - `item {capitulo, desc, und?, cant?, cant_origen?, caracteristicas?, condicion?, grupo?, id?}`
  - `item_desde_3d {capitulo, adjunto, item3d | piezas[], desc?, caracteristicas?, materiales?: {"p1":"CLAVE"}, ruta?: "A"|"B", rendimiento?}`
    — el algoritmo de Importar 3D arma el APU (materiales por unidad, planchas, barras; mano de obra por receta = ruta A, o
    trato con el oficio = ruta B).
  - `fila {item, tipo: mat|mo|eq|sub, d, origen_q, q? | medida | geometria, clave? | p + origen_p, stock_q?, origen_stock?, cerrado?, oficio?, reemplaza?}`
  - `confirmar_supuestos {item?, confirmacion: "dueño:<id>"}`
  - `quitar {item} | {item, tipo, fila} | {capitulo}`
  - `recargos {cs, ind, util, origen}` — **solo si el dueño da los porcentajes**.
- **`ver_borrador`** `{cid, pid, conv, items?}` → totales, avisos; con `items` (ids), sus filas y características.
- **`aplicar_al_presupuesto`** `{cid, pid, conv, confirmacion: "dueño:<id>", con_capitulos?}` → misma lógica del botón de la
  app: lo nuevo al final, lo ya aplicado se actualiza en su lugar sin reordenar (las licitaciones apuntan por posición),
  alternativas y "por confirmar" apagadas, supuestos sin confirmar no pasan. Deja una copia en `/respaldos_agente`.
- **`guardar_en_base`** `{cid, pid, conv, nodo, clave, datos, confirmacion}` → material, mano de obra, oficio, rendimiento o
  receta nuevos o corregidos, con historial. Solo con la confirmación del dueño.
- **`memoria`** `{accion: anotar|leer, tipo: nota|norma, texto?}` → notas del dueño y normas del taller, compartidas entre
  proyectos (las mismas del Agente IA de la app). Borrar: en la app (⚙).

## Ejemplo corto

```
listar_clientes {texto:"paceña"} → cid
listar_proyectos {cid} → pid
abrir_cotizacion {cid, pid, titulo:"Trofeo"} → conv
registrar_mensaje_del_dueno {…, texto:"son 3 trofeos de 45 cm de alto, base de MDF negro"} → dueño:-N1
buscar_base {texto:"mdf negro"} · buscar_base {texto:"acrilico"}
(preguntas, una ronda) → respuesta → registrar_mensaje_del_dueno → dueño:-N2
armar_borrador {…, operaciones:[capitulo, item {desc:"Trofeo", cant:3, cant_origen:"dueño:-N1", caracteristicas:[…]}, fila…, fila…]}
"aplicalo" → registrar_mensaje_del_dueno → dueño:-N3 → aplicar_al_presupuesto {…, confirmacion:"dueño:-N3"}
```
