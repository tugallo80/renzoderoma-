# Sesión 4 — Agente IA cotizador (Etapa 1)

**Objetivo:** un chat dentro del presupuesto donde el dueño sube todo junto (3D, PDF, fotos, capturas), explica el contexto
escribiendo o hablando, y el agente arma el **borrador del presupuesto y del APU**, que se sigue corrigiendo en el mismo chat.

**Principio (heredado de la ficha 02):** el cómputo lo hace el algoritmo; la IA lee y ordena. Medidas y cantidades salen de la
medición 3D, precios y rendimientos de la base; lo que falta se le pregunta al dueño o sale de una cota del plano citada.
Se hace cumplir **en el código**: la herramienta del borrador rechaza filas sin origen y calcula los totales.

Modelo: **Claude Opus 5.5** (`claude-opus-5-5`), configurable en `/config/agente` para comparar con Sonnet 5.5 (y más adelante Gemini).

---

## Entregas

| # | Qué | Estado |
|---|---|---|
| 1 | Chat + adjuntos + 🎤 + 🔊 + medidor de costos, con herramientas mínimas (`medicion_3d`, `preguntar_al_dueno`) | ✅ 12 nov 2026 |
| 2 | Herramientas de base y 3D + borrador con validación de origen | ✅ 12 nov 2026 |
| 3 | Editor de anotaciones de fotos | ✅ 12 nov 2026 |
| 4 | Aplicar al presupuesto + memoria simple | ✅ 12 nov 2026 |
| 2b | Supuestos (cotizar solo con texto), stock propio, trato cerrado, normas constructivas, adjuntos numerados y vistas del 3D (pedido de la sesión maestra) | ✅ 12 nov 2026 |

---

## Cómo funciona (entrega 1)

```
presupuesto.html ── botón "Agente IA" (antes "3D" / "Importar 3D") ── agente-chat.js
   │  📎 un solo botón: 3D (FBX/GLB/glTF/ZIP/rubik.json), PDF, fotos, capturas — tipo por contenido (Lector3D.detectarTipo)
   │     · 3D: se mide EN EL NAVEGADOR (misma lectura que Importar 3D, window.Importar3D) → se sube solo la medición rubik/1
   │     · PDF (≤ 20 MB) tal cual · fotos reducidas a 2000 px JPEG
   ▼
POST /api/agente  (agenteApi: requireAuth + lista blanca hub)
   adjuntar → Storage agente/{cid}/{pid}/{id}/… + /proyectos/{cid}/{pid}/agente/adjuntos/{id}
   enviar   → mensaje en conversacion/mensajes + historial de la API + /agente_cola/{push}
   ▼
agenteTurno (trigger de /agente_cola, 540 s, secreto ANTHROPIC_API_KEY)
   loop con el SDK oficial (@anthropic-ai/sdk, client.beta.messages.stream().finalMessage())
   · thinking adaptativo · effort "high" (configurable) · caché del sistema + herramientas y caché automática de la conversación
   · fallbacks por rechazo del servidor: betas ["server-side-fallback-2026-07-01"], fallbacks "default" (Opus/Sonnet 5.5)
   · herramientas con eager_input_streaming → la entrada se valida en el código antes de correr
   · PDF como documento nativo, imágenes como imagen nativa, 3D como texto + herramienta medicion_3d
   · estado/progreso en /proyectos/{cid}/{pid}/agente/estado ("Midiendo el 3D…") → el chat lo escucha
   · si se acerca a los 400 s, guarda y encola la continuación (el celular puede bloquearse sin cortar nada)
```

### Datos

```
/proyectos/{cid}/{pid}/agente/
   conversacion/mensajes/{push}   { rol: dueno|agente|aviso, texto, adjuntos?, preguntas?, costo_usd?, fecha, turno }
   conversacion/api               texto JSON con el historial de la API (adjuntos como {type:"adjunto", id}; thinking tal cual)
   adjuntos/{id}                  { nombre, tipo: 3d|pdf|imagen, ruta | medicion_ruta, resumen, tamano_m, anotaciones? }
   estado                         { fase: en_cola|trabajando|esperando_dueno|listo|error|tope, texto, actualizado, turno }
   costos/total, costos/llamadas  medidor por cotización
   detener                        el dueño pidió cortar
/agente_cola/{push}               { cid, pid, uid, turno, pasar_tope, continuar? }   (reglas: nadie desde la app)
/agente_costos/{yyyy-mm}/{cid}_{pid} y /_total   { usd, entrada, salida, cache_escrita, cache_leida, llamadas } (hub lee, nadie escribe)
/config/agente                    { modelo, effort, tope_mensual_usd, aviso_pct, max_tokens, fallbacks, precios? }
/agente_memoria/notas/{push}      { texto } — se lee al empezar cada conversación (la herramienta llega en la entrega 4)
```

El almacén del agente (`functions/agente/almacen.js`) solo deja tocar esas rutas (más lectura de `/base_datos` y del
presupuesto); lo verifica la prueba "el agente no puede tocar nada fuera del proyecto".

### Medidor de costos

- Cada llamada registra `usage` (entrada, salida, caché escrita y leída) y el costo en USD con la tabla de precios de
  `agente-nucleo.js` (Opus 5.5: 4 / 20 por millón, caché leída 0,20, escrita 5; Sonnet 5.5: 2 / 10, leída 0,10; Haiku 5.5:
  0,10 / 0,50). Si hubo fallback, se cobra cada `usage.iterations` a su modelo. La caché de 1 h se cobra 2 × entrada.
- En el chat: **esta cotización** y **mes** arriba (naranja al llegar al aviso, rojo en el tope); tocando, el detalle por llamada.
- **Tope mensual** (`/config/agente/tope_mensual_usd`, por defecto US$ 30, aviso al 80 %): antes de cada llamada se mira
  el gasto del mes; si se pasó, el agente frena y muestra **"Seguir igual"** (sigue solo ese turno). Se cambia en ⚙.

### Voz

- 🎤 dictado con Web Speech API (`es-BO`, y `es-419` si no está); llena el cuadro para revisar antes de mandar. Sin Web
  Speech (Firefox): nota de voz grabada y transcrita con el proxy `/api/gemini` que ya existe.
- 🔊 en cada respuesta: `/api/tts`; si falla, la voz del teléfono.

### Compartir → Rubik

`/compartir/elegir.html` ahora abre el **Agente IA** del proyecto elegido con los archivos adjuntos (`?agente=<envío>`);
una casilla permite usar "Importar 3D" como respaldo. "Importar 3D" sigue en ⚙ del agente.

### Storage (pendiente de revisar por el dueño)

Las reglas de Storage **no están en el repo** (se manejan en la consola) y el deploy no las toca. Los archivos del agente
los escribe y lee **solo la Function** (admin), nunca el navegador, así que no hace falta abrir nada. Para cerrarlos del
todo, agregar en la consola de Firebase → Storage → Reglas, **antes** de cualquier regla general:

```
match /agente/{todo=**} {
  allow read, write: if false;   // solo la Function (cuenta de servicio) los usa
}
```

Ojo: si en la consola hay una regla general del tipo `match /{allPaths=**} { allow read: if request.auth != null; }`,
cualquier usuario con login (también los anónimos de las otras apps) podría leer un archivo si conoce su ruta: en Storage
las reglas se suman. Hay que revisarla.

## Entrega 2 — borrador con validación de origen

Lógica pura en `public/js/agente-borrador.js` (la usan la Function, vía copia en `functions/agente/compartido/`, y el chat).

**Herramientas nuevas** (orden fijo, para la caché):

| Herramienta | Qué hace |
|---|---|
| `buscar_base` | Busca materiales, mano de obra, oficios, rendimientos y equivalencias por palabras (sin acentos) y espesor; cada resultado trae su origen `base:<nodo>/<clave>` |
| `armar_borrador` | Operaciones `capitulo`, `item`, `item_desde_3d`, `fila`, `quitar`, `recargos`. Aplica las válidas, devuelve las rechazadas con el motivo y el borrador con totales calculados por la herramienta |
| `escala_3d` | Calibra la escala del 3D con una cota del plano o un dato del dueño (nunca con un supuesto). Escala parejo: largos ×f, áreas ×f², volúmenes ×f³ |
| `guardar_en_base` | Material, mano de obra, oficio, rendimiento o receta, **solo con la confirmación del dueño** (`dueño:<id de su mensaje>`). Deja historial en `/base_datos/historial_cambios` |

**Cómo se hace cumplir "no inventar números" (en código):**
- Toda fila necesita `origen_q`; se valida que exista lo citado: la pieza en la medición, la clave en la base, el adjunto
  PDF/foto con página y una cita que tenga el número, o el id de un mensaje del dueño. `calculo:` y textos libres se rechazan.
- Con `pieza3d:` la **cantidad la calcula la herramienta** (`medida`: m2_cara, m2_sup, ml_perimetro, ml_largo, und, m3, glb ×
  `factor`, que a su vez necesita origen). Lo que haya puesto el modelo se ignora y queda anotado.
- Con `clave`, el **precio sale siempre de la base**. Sin clave, solo con `origen_p` del dueño o de una cota. Sin precio → `p 0`
  y fila marcada ("sin precio en la base" / "falta precio").
- `item_desde_3d` usa `Lector3D.armarApu` (el algoritmo de Importar 3D): materiales por unidad, planchas, barras, receta de
  mano de obra (ruta A) o fila de trato con el oficio (ruta B). Rehacerlo conserva las filas agregadas a mano.
- Totales (pu con cargas sociales, indirectos y utilidad; total de ítem, capítulo y general) con `Lector3D.calcPu`. Recargos:
  los del último ítem con APU del presupuesto (`base:presupuesto/recargos`) o los que diga el dueño.
- Cantidad del ítem distinta de 1 también necesita origen.

**En el chat:** botón verde **📋 Bs total** arriba → capítulos → ítems → APU, con una etiqueta por número: **3D** (medido),
**base**, **plano** (cota), **vos** (lo dijiste). Filas marcadas en rojo con el motivo.

## Entrega 3 — editor de anotaciones de fotos

`public/js/agente-anotador.js`. Cada foto adjunta se sube enseguida; el **✏️** de su chip abre el editor (pantalla completa):

- **📏 Cota:** se arrastra de un extremo al otro y se escribe la medida tal como va en el plano ("4,00 m") y una nota
  opcional. Línea **fina** (proporcional a la foto, ~1/900 del lado mayor), extremos con **flechas** o **ticks** a 45°, y el
  número en una etiqueta **chica y semitransparente corrida al costado de la línea**, para no tapar la foto.
- **⭕ / ▭ marcas** (con nota opcional) y **T notas** de texto. Cuatro colores para que se vean sobre cualquier foto.
- **✋** mover la foto y tocar una anotación para editarla o borrarla; **＋ / －** zoom; **↶ / ↷** deshacer y rehacer.
- Es una **capa vectorial (SVG)**: se puede volver a abrir y seguir editando antes de mandar.
- Al tocar **Listo** se sube de nuevo: la **foto original**, la **foto anotada** (JPEG dibujado con la misma geometría) y el
  **JSON** de las anotaciones en píxeles de la foto:
  `{tipo:"cota", n, valor:"2,40 m", de:[x,y], a:[x,y], extremos:"flechas"|"ticks", largo_px, nota?}`,
  `{tipo:"marca", n, forma:"circulo"|"rectangulo", de, a, nota?}`, `{tipo:"nota", n, texto, en}`.
- Al agente le llegan las dos imágenes y el JSON, con la indicación de que las cotas son del dueño: en el borrador valen
  como origen **`dueño:<id del adjunto>`** (lo verifica la validación de origen).
- El dibujador de cotas de "Presupuesto IA" queda como estaba (ese módulo se retira cuando el agente lo reemplace).

## Entrega 4 — aplicar al presupuesto y memoria

**"Aplicar al presupuesto"** (al final de la vista del borrador, `AgenteBorrador.aItemsPresupuesto` + `aplicarAlPresupuesto`):
- Convierte el borrador al formato de `presupuesto.html` (como `armarItems` de Importar 3D): cada ítem con su **id estable**
  (el del borrador), `origen: "agente"`, el APU con recargos, `pu` recalculado, las `measures` del 3D (para CÓMPUTO) y
  `agente: { version, cant_origen, desde3d, filas_a_revisar }`. Cada fila conserva `origen_q` / `origen_p`.
- Lo **nuevo va al final**; si se vuelve a aplicar después de corregir, lo ya aplicado (mismo id) se **actualiza en su
  lugar** y conserva lo que se le agregó en el presupuesto (fotos, etc.). Nunca se reordena (las licitaciones apuntan por posición).
- Opcional: con sus capítulos. Queda `borrador/aplicado` con versión y cantidades, y un aviso en el chat.
- En el presupuesto, esos ítems muestran la etiqueta **Agente** (con ⚠n si hay filas marcadas) y en el APU el origen de cada fila.

**Memoria simple** (`memoria`): anotar, leer o borrar notas cortas en `/agente_memoria/notas/{push}` `{ texto, fecha, proyecto, uid }`.
Se leen al empezar cada conversación (van en el primer mensaje). En ⚙ se ven y se pueden borrar.

## Entrega 2b — cotizar solo con texto, stock propio, trato cerrado (pedido del dueño vía la sesión maestra)

- **Origen `supuesto:<explicación>`** para la propuesta constructiva del agente cuando no hay planos ni fotos ("bastidor con lona
  de 5×3 con patitas"): el agente no frena pidiendo planos, propone un despiece y manda la **geometría** (`[{desc, cant, largo_m,
  ancho_m?}]` + `medida`: ml_largo, m2_cara, ml_perimetro, und). **La cantidad la calcula la herramienta** (ej. 2 × 5 + 6 × 3 =
  28 ml); un `q` escrito a mano con supuesto se rechaza. Los precios siguen saliendo de la base (supuesto no vale como origen de precio).
  - Las filas con supuesto se ven en **celeste** ("supuesto sin confirmar") y **no se aplican al presupuesto** hasta que el dueño
    las confirma: botón **"Confirmar supuestos"** por ítem, u operación `confirmar_supuestos` con `dueño:<mensaje>` si lo confirma por chat.
  - La geometría también se puede usar con `dueño:` o `cota_plano:` (cuando el dueño da medidas).
- **Stock propio** ("en el taller tengo 5 tubos"): `stock_q` + `origen_stock dueño:<mensaje>` → la fila guarda el total, la parte en
  stock va a costo 0 y se cobra lo que falta comprar ("5 de stock propio (sin costo) + 3 a comprar").
- **Trato cerrado por el dueño** ("la mano de obra la cierro en 1000 Bs con Don Pedro"): fila de mano de obra `cerrado: true`, monto
  con `origen_p dueño:`; reemplaza la referencia calculada de la ruta B y se mantiene si se rehace el ítem desde el 3D. Se ve
  "TRATO CERRADO" y la nota "monto cerrado por el dueño (Don Pedro)".
- **Normas constructivas** (`memoria` con `tipo: "norma"` → `/agente_memoria/normas/`): cómo construye el taller ("bastidores con
  tubo 20×40 y travesaño cada 1 m"). Van primero en el mensaje inicial de cada conversación y se ven/borran en ⚙.
- **Adjuntos numerados** en el orden en que se subieron, con su clase: "Adjunto 1 · foto · IMG_123.jpg", "Adjunto 2 · captura · …"
  (PNG o nombre de captura), "Adjunto 3 · PDF", "Adjunto 4 · 3D (resumen de medición)". El dueño puede decir "la foto 2".
- **Vistas del 3D:** al adjuntar un 3D, el navegador dibuja con three.js una vista **isométrica** y una de **frente**, encuadradas en
  las piezas medidas, con el **número de cada pieza** (p1, p2… = ids de `medicion_3d`). Se suben como JPG junto a la medición y le
  llegan al agente como imágenes, para relacionar el 3D con las fotos, el render y el PDF (las medidas siguen saliendo de `medicion_3d`).

## Corrección de estructura: un ítem = lo que se entrega (tras la primera cotización real, un trofeo)

El agente había armado como ítems aparte cosas que eran componentes de costo ("Armado y fijaciones", "Mano de obra: corte,
rolado, soldadura…"); el dueño quería **un solo ítem: el trofeo**.
- **Regla en el prompt:** un ítem es lo que el cliente compra y se le entrega (trofeo, mostrador, letrero, adhesivo de piso,
  traslado y montaje), con cantidad y unidad. Materiales, mano de obra, equipos, fijaciones, armado y pintura van **dentro del APU**.
  Varias piezas del 3D de un mismo objeto = un ítem (`item_desde_3d` con `piezas`). Si el cliente manda una lista de ítems, esa
  lista manda. Si conviene separar algo, se pregunta antes.
- **Aviso en el validador** (`itemSospechoso`): un ítem que se llama como un componente ("armado", "fijaciones", "mano de obra",
  "pintura"…), que solo tiene mano de obra, o solo un material genérico, queda con **"¿esto no es parte del APU de otro ítem?"**
  (en el resumen que recibe el agente y en naranja en el chat). No avisa en ítems del 3D ni en servicios entregables (traslado,
  montaje, instalación, transporte, diseño, restauración).
- **Norma inicial** del dueño en `/agente_memoria/normas/inicial_estructura_items`: la Function la siembra **una sola vez**
  (marca en `/agente_memoria/sembradas/`); si el dueño la borra en ⚙, no vuelve.

## Menos costo por cotización (la primera real costó US$ 0,55 al primer pedido y US$ 1,88 con varias rondas)

- **Una sola ronda de preguntas.** Flujo en dos fases en el prompt: (a) lectura: lee todo, mide una vez, busca en la base y hace
  **todas** las preguntas que cambian el costo juntas y numeradas (lo obvio va como supuesto declarado); (b) borrador completo de
  una vez. En el código, `preguntar_al_dueno` cuenta las rondas (`agente/rondas_preguntas`): **una segunda ronda se rechaza** salvo
  con `motivo` (el dueño cambió algo). Acepta hasta 10 preguntas.
- **Correcciones con effort `medium`.** Después del primer borrador, `enviar` agrega un mensaje de sistema de effort
  (`{role:"system", content:[], output_config:{effort:"medium"}}`, beta `mid-conversation-output-config-2026-07-01`) en vez de
  cambiar el effort del pedido, que rompería la caché. Configurable en ⚙ ("Esfuerzo en las correcciones": bajo, medio, alto o igual)
  → `/config/agente/effort_correcciones`. Solo en modelos que lo soportan (Opus 5.5, Sonnet 5.5, Haiku 5.5…).
- **Caché verificada en pruebas:** los PDF, imágenes y vistas del 3D van en los primeros mensajes (antes del último punto de caché),
  la expansión de adjuntos es determinista y el pedido siguiente repite el anterior **byte a byte** como prefijo. En el detalle de
  costos hay una columna **"De caché"** (% de la entrada leída de la caché en cada llamada).
- **Resultados de herramientas compactos:** `medicion_3d` devuelve una tabla (columnas + una fila por pieza); `buscar_base` solo los
  campos útiles y sin vacíos (12 resultados por defecto); `armar_borrador` devuelve los totales de todo y las filas **solo de los
  ítems que tocó**.
- El costo de cada turno se sigue mostrando junto a la respuesta.

## Características del ítem (campo CARACTERÍSTICAS / `feat`, va al PDF del cliente y a licitaciones)

En el primer borrador aplicado (Trofeo Paceña) el campo quedó vacío. Ahora:
- `item` e `item_desde_3d` llevan **`caracteristicas`**: 3 a 6 líneas cortas para el cliente (medidas generales, materiales y
  acabados, composición, qué incluye y qué no). Cada línea con números lleva **origen** validado; las que mencionan precios o datos
  internos (Bs, precio, costo, trato, stock, recargos, utilidad, jornal…) **se rechazan**; máximo 160 caracteres por línea.
- **`desc` corta** (un nombre claro, hasta 80 caracteres): una descripción larga se rechaza con "el detalle va en caracteristicas".
- Al **aplicar**, `feat` = el texto limpio ("• línea" por renglón, sin orígenes). Una línea con **supuesto sin confirmar no sale**
  hasta que se confirma (no bloquea el ítem). Al **reaplicar**, `desc` y `feat` se actualizan en su lugar.
- En el chat se ven debajo del nombre del ítem, con su origen; si faltan, aviso naranja. El agente recibe "faltan las características
  para el cliente" en el resumen. Se corrigen por chat.

## Del presupuesto al agente

En `presupuesto.html`, la etiqueta verde **🤖 Agente** de un ítem aplicado abre el **Agente IA del proyecto con ese ítem en foco**:
el borrador se abre, se desplaza a ese ítem y lo resalta, y el cuadro de texto queda con "Sobre «Trofeo Paceña»: " para la corrección.
Si el ítem tiene filas sin precio, al lado aparece **⚠n APU**, que abre el APU. Es la misma plantilla del ítem en celular y escritorio.

## Varias conversaciones por proyecto

Para cotizar **otro ítem en el mismo proyecto** sin arrastrar el contexto (ni su costo) de la conversación anterior:
- Barra arriba del chat: **💬 título (n) ▾** abre la lista "Conversaciones de este proyecto" (título automático, fecha y costo) y
  **＋ Nueva** empieza una conversación de cero: historial vacío, sin adjuntos anteriores, con su propio borrador.
- **Datos:** la conversación que ya existía es `principal` y sigue en las rutas de siempre (`agente/conversacion`, `agente/borrador`,
  `agente/costos`, `agente/rondas_preguntas`): no hubo que migrar nada. Las nuevas: `agente/conversaciones/{conv}/…`. Por proyecto
  quedan los adjuntos, el estado (un turno a la vez por proyecto), `actual` (la abierta) y `conversaciones_meta/{conv}`
  `{ titulo, titulo_auto, creada, costo_usd }`. Rutas en `functions/agente/rutas.js`.
- **Título automático:** el primer mensaje y, cuando aparece, el nombre del primer ítem del borrador.
- **Al empezar una conversación nueva** el agente recibe un resumen compacto del presupuesto actual (capítulos, nombres de ítems,
  cantidades y totales, sin APU) para no duplicar, más las normas y la memoria. No recibe la conversación anterior.
- **Aplicar** agrega o actualiza solo los ítems de esa conversación (ids estables); cada ítem aplicado guarda `agente.conv`.
  La etiqueta **🤖 Agente** del presupuesto abre la conversación que creó ese ítem.
- **Costos:** arriba, "Conv." (la abierta) y "Proy." (todas las conversaciones), además del mes; el detalle muestra los dos.
  Si el agente trabaja en otra conversación del proyecto, el chat lo avisa con "Ver".

## Correcciones a centavos (una corrección de 3 líneas costaba ~US$ 0,57)

**Diagnóstico con los logs de `agenteTurno` (12 nov):** 16:03 → 0,55 · 16:11 → 0,61 · **16:16 → 0,18** · 16:23 → 0,54 · 16:35 → 0,57.
El único barato fue el que llegó a menos de 5 min del anterior: la **caché de 5 min vencía** entre turno y turno (el dueño tarda
más en responder) y cada corrección reescribía toda la conversación con el PDF y las fotos (~100.000 tokens). Además, entre 16:23
y 16:35 hubo dos deploys que cambiaron el prompt y las herramientas, lo que invalida la caché una vez. El effort por mensaje no era la
causa (ya no se toca el effort del pedido).

**Cambios:**
- **Caché de 1 h** en el sistema y en la conversación (`ttl: "1h"`, `/config/agente/cache_ttl`). La escritura cuesta 2× la entrada,
  pero se lee durante una hora.
- **Compactación después del primer borrador:** el agente guarda con **`resumen_de_lectura`** lo relevante de cada adjunto (renglones,
  cotas con página, materiales, citas). En el primer mensaje del dueño con borrador hecho, el historial se reemplaza por: contexto
  del proyecto + resumen de cada adjunto + borrador actual + últimos mensajes (el historial completo queda en
  `conversacion/api_antes_de_compactar`; los adjuntos, en Storage). No quedan thinking ni resultados viejos, así que no hay problema
  con el historial editado.
- **`ver_adjunto(id)`:** vuelve a mostrar un adjunto completo dentro del resultado, solo hasta la próxima compactación.
- **Modelo en las correcciones** en ⚙ (por defecto, el mismo principal), con el costo estimado de una corrección con cada uno
  (`costoCorreccionEstimado`: ≈ US$ 0,08 Opus 5.5 · 0,04 Sonnet 5.5 · 0,004 Haiku 5.5, 2 llamadas con contexto compactado).
- **Edición a mano sin IA (costo 0):** ✎ en cada ítem (nombre, cantidad, características) y 🗑 en cada fila. Se guarda sin llamar al
  agente, queda en el chat como "✎ Editado a mano" (origen `dueño:` de ese mensaje) y el agente lo recibe en su próximo turno como
  "Cambios que hizo el dueño a mano".
- **Detalle de costos:** entrada nueva, caché leída, caché escrita y salida (con pensamiento) por llamada. La Function también deja
  en el log los tokens de cada llamada (sin datos del cliente), para diagnosticar.

**Estimado (prueba con `usage` simulado del tamaño real del pedido):** la misma corrección pasa de **~US$ 0,56** (≈ 105.000 tokens
reescritos) a **~US$ 0,07** la primera vez (la que compacta) y **~US$ 0,03** las siguientes con Opus 5.5 (≈ 5.000 tokens leídos de
la caché + salida); con Sonnet 5.5, ~US$ 0,02. El piso son el prompt y las herramientas (~5.000 tokens, leídos de la caché).

## Arrastrar y soltar, y pegar

- **Arrastrar y soltar (PC):** se pueden soltar archivos sobre todo el panel del chat. Mientras se arrastra, aparece la zona
  "📎 Soltá acá los archivos". Van por el mismo camino que el 📎 (detección por contenido, 3D medido en el navegador, ZIP, PDF, fotos).
- **Pegar (PC y celular):** Ctrl+V o "Pegar" en el cuadro de texto adjunta las imágenes y los archivos del portapapeles. Una imagen sin
  nombre propio queda como `captura-AAAA-MM-DD-HHMM.png` (se puede anotar con ✏️ y el agente la ve como "captura"). El texto pegado
  no se toca. En Android funciona si el navegador expone el pegado de imágenes; si no, no pasa nada.

## Alternativas, "por confirmar" y adjuntos que fallan

- **Conflictos entre el dueño y los documentos** (regla en el prompt): si la lista del cliente trae alternativas excluyentes ("ventanas
  opción 1 y 2, cotizar por separado") o renglones "por confirmar", el agente lo detecta y lo resuelve en la única ronda de preguntas
  (citando el documento) o lo toma como supuesto si es obvio. **Nunca suma alternativas excluyentes al total**, aunque le pidan un solo ítem.
- `armar_borrador`: `condicion: "alternativa"` (con `grupo`, ej. "Ventanas") o `"por_confirmar"` en `item` / `item_desde_3d`; `"normal"`
  la vuelve al total. Esos ítems **se cotizan pero no suman** (capítulo y total); el borrador los lista en `aparte` y el chat los muestra
  con borde punteado, "ALTERNATIVA · Ventanas — no suma al total" y una línea "Aparte, fuera del total" debajo del total.
- **Al aplicar** se reutiliza lo que ya tenía el presupuesto: el **ojo apagado** (`activo: false`), que no suma al total ni sale en el
  PDF, más la etiqueta **ALTERNATIVA / POR CONFIRMAR** junto a "🤖 Agente" (`agente.condicion`, `agente.grupo`).
  *Pendiente a decidir:* si las alternativas deberían salir en el PDF del cliente como "opcionales" (hoy el PDF omite los ítems apagados).
- **Adjunto que falla:** el 503 de un PDF de ~90 KB no llegó a la Function (en los logs de `agenteapi` todas las subidas dieron 200);
  coincidió con un deploy (16:58–16:59), cuando Hosting no tiene la revisión lista. Ahora el chat **reintenta solo** los 502/503/504 y
  los cortes de red (hasta 3 veces; "enviar", solo el 503, para no duplicar el mensaje). El chip con error tiene **↻**, y si al tocar
  Enviar queda algún adjunto fallido aparece **"1 adjunto no se cargó: Reintentar / Enviar sin él / Cancelar"**.

### Pruebas (sin gastar plata)

- `cd tools/agente && npm test` — 62 pruebas (alternativas y por confirmar fuera del total, ojo apagado al aplicar). 61 pruebas (costo de una corrección antes y después, ver_adjunto, modelo de correcciones,
  edición a mano). 57 pruebas (conversaciones: nueva de cero con el resumen del presupuesto, borrador y costos por
  conversación, título automático, un turno a la vez por proyecto, aplicar sin pisar la otra). 56 pruebas (características: origen en números, sin datos internos, desc larga rechazada, supuesto
  que no sale hasta confirmar, feat al aplicar y al reaplicar). 55 pruebas (costo: segunda ronda rechazada sin motivo, effort medium por mensaje sin tocar el del
  pedido, prefijo idéntico entre llamadas, % de caché, resultados compactos). 51 pruebas (estructura: avisos de ítems-componente, trofeo de 3 piezas = 1 ítem, norma inicial
  sembrada una vez). 49 pruebas (2b: geometría supuesta calculada por la herramienta y precio de la base, supuestos
  que no se aplican hasta confirmar, stock a costo 0, trato cerrado que reemplaza la referencia, adjuntos numerados y vistas del 3D,
  normas, flujo solo con texto → confirmación por chat → aplicar). 42 pruebas (entrega 4: aplicar al final y actualizar en su lugar, memoria entre proyectos,
  flujo completo adjuntar → borrador → corrección → aplicar). 39 pruebas (entrega 3: foto anotada → original + anotada + JSON al modelo, cota del dueño como origen,
  límite de anotaciones). 38 pruebas (entrega 2: orígenes inválidos, fila sin origen rechazada, cantidad calculada
  desde el 3D ignorando la del modelo, precio de la base, totales = `calcPu`, item_desde_3d con ruta A y B, corrección "eran tres
  adhesivos", ítems para el presupuesto, flujo completo adjuntar → borrador → corrección con la API simulada, guardar_en_base con
  y sin confirmación, escala con cota). Entrega 1: 26 pruebas con la API **simulada**: medidor (Opus, Sonnet, Haiku, caché 1 h, fallback por
  modelo, tope), configuración, orígenes, escala de la medición, historial con fallback, validación de entradas, rutas
  prohibidas, adjuntar, enviar (con memoria), turno completo 3D → `medicion_3d` → respuesta con costos, PDF/imagen nativos,
  preguntas que cortan el turno, tope y "Seguir igual", rechazo, `max_tokens` con herramienta cortada, entrada inválida,
  continuación por tiempo, detener, error y reintento. También verifica que `functions/agente/compartido/` sea copia exacta
  de `public/js/` (`npm run sincronizar` la actualiza).
- `node pantalla/capturas.mjs` — capturas (también simula `drop` de una imagen y un PDF, y `paste` de una captura con texto) — capturas (entrega 3: dibuja 2 cotas, un círculo y una nota con el mouse sobre una foto inventada,
  deshace/rehace y verifica el JSON y la imagen anotada) — capturas en tamaño celular (Pixel 7) con Firebase y `/api/agente` simulados; mide un GLB
  de ejemplo de verdad con el lector 3D.
- `tools/probar-reglas` — 170 OK, con las reglas nuevas de `agente_cola` y `agente_costos`.

### La prueba real la hace el dueño

1. Abrir un presupuesto → **Agente IA** → ⚙: dejar Opus 5.5, esfuerzo Alto, tope.
2. 📎 un FBX + el PDF de planos + una foto (✏️ para marcar una cota); escribir o dictar el contexto; enviar.
3. Mirar el progreso, las preguntas y el costo de la cotización. Probar 🔊.
4. Abrir **📋 Borrador**: ver de dónde sale cada número; corregir algo por el chat.
5. **Aplicar al presupuesto** y revisar los ítems "Agente" al final (y su APU).
6. Para comparar modelos: repetir la misma cotización en otro proyecto con Sonnet 5.5 (⚙) y comparar borrador y costo.

### Totales por grupo en el borrador del chat (PR abierto, sin mergear)

Cada ítem del borrador muestra sus totales por grupo, igual que el APU del presupuesto (#300). Son costo directo por unidad, sin indirectos ni utilidad:
- materiales;
- mano de obra, con las cargas sociales aparte;
- sub-ítems;
- otros gastos.

Los calcula `AgenteBorrador.calcularTotales` (`it.grupos`). Los recargos no cambian: el dueño los ajusta en el APU.

### Pendientes / próximas etapas
- Reglas de Storage en la consola (ver arriba).
- Comparar con Gemini con las mismas cotizaciones (hoy `/config/agente` elige entre modelos de Claude).
- Retirar "Presupuesto IA" cuando el agente lo reemplace; "Importar 3D" sigue como respaldo en ⚙.
