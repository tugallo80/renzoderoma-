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

## Requerimientos (lo que el dueño cargó en la app, sin IA)
- **`listar_requerimientos`** `{estado?="pendiente"|asignado|cotizado|descartado|todos, texto?}` → id, título, estado,
  cliente (`cid` o nombre nuevo), cuántos adjuntos de cada tipo, a qué proyecto está asignado.
- **`leer_requerimiento`** `{id, desde?, sin_imagenes?}` → descripción, cliente, adjuntos (fotos con `anotaciones`: cotas,
  marcas y notas en píxeles de la foto; 3D con piezas y tamaño; PDF y otros) **y las imágenes** (foto anotada o foto, vistas
  del 3D) hasta ~300 KB por respuesta; si quedan, `imagenes.siguiente_desde`.
- **`asignar_requerimiento`** `{id, cid, pid, conv, confirmacion: dueño:<id>, cotizado?}` → lo une a esta cotización: la
  descripción queda como mensaje del dueño (`descripcion_origen`) y fotos, PDF y 3D se copian a los adjuntos del proyecto
  (`adjuntos`: id nuevo y cómo citarlo). Repetirlo no copia de nuevo. Con `cotizado: true` lo marca cotizado.

## Cotizar
- **`listar_cotizaciones`** `{cid, pid}` → las conversaciones del Agente IA del proyecto (de la app y de Claude): título, fecha,
  costo de la API, versión y total del borrador, si se aplicó, de qué versión salió (`basada_en`) y los ítems del presupuesto que
  aplicó cada una. `principal` es la primera del chat de la app (ahí están las cotizaciones viejas).
- **`abrir_cotizacion`** `{cid, pid, titulo?}` → `conv` nueva + contexto (normas, memoria, presupuesto actual) + adjuntos
  del proyecto. Con `{conv}` (también `"principal"`) o con `{item}` (n o id de un ítem del presupuesto que aplicó el agente)
  retoma la conversación que lo creó: borrador, últimos mensajes, `item_en_foco` e ítems que ya están en el presupuesto.
  **Una por chat.** Si el Agente IA de la app está trabajando en esa conversación, las herramientas que escriben esperan.
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
- **`nueva_version`** `{cid, pid, conv, titulo, renombrar_capitulos?}` → copia el borrador de `conv` a una conversación nueva
  (ej. "Versión 2 – económica") con ids nuevos: al aplicarla, sus ítems entran **aparte** y la versión anterior queda intacta.
  Los capítulos se renombran con el título. Devuelve la `conv` nueva: usala en el resto del chat.
- **`aplicar_al_presupuesto`** `{cid, pid, conv, confirmacion: "dueño:<id>", con_capitulos?}` → misma lógica del botón de la
  app: lo nuevo al final, lo ya aplicado se actualiza en su lugar sin reordenar (las licitaciones apuntan por posición),
  alternativas y "por confirmar" apagadas, supuestos sin confirmar no pasan. Deja una copia en `/respaldos_agente`.
- **`proponer_apagar_items`** `{cid, pid, items[], accion?: apagar|prender, motivo}` → paso 1: no cambia nada, guarda una
  **propuesta** con la lista exacta y devuelve su id. Apagar = el ojo del presupuesto: no suma ni sale en el PDF, **no se borra**.
- **`confirmar_propuesta`** `{cid, pid, conv, propuesta, confirmacion: "dueño:<id>"}` → paso 2: solo con la respuesta del dueño
  registrada **después** de la propuesta. Verifica que el presupuesto no haya cambiado, guarda respaldo y avisa en la app.
- **`guardar_en_base`** `{cid, pid, conv, nodo, clave, datos, confirmacion}` → material, mano de obra, oficio, rendimiento o
  receta nuevos o corregidos, con historial. Solo con la confirmación del dueño.
- **`memoria`** `{accion: anotar|leer, tipo: nota|norma, texto?}` → notas del dueño y normas del taller, compartidas entre
  proyectos (las mismas del Agente IA de la app). Borrar: en la app (⚙).
- **`prueba_imagen`** `{peso_kb?}` → solo para probar el conector cuando el dueño lo pida: devuelve una imagen de
  prueba con un número de 4 cifras y una esquina de cada color. Decile el número y los colores que ves; si no ves la
  imagen, decilo tal cual (no adivines).

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
