# Sesión 6 — IA de render y requerimiento visual

**Fase 0 (13 nov 2026): inventario e investigación** (abajo). **Visto bueno del dueño el 13 nov, con cambios** → ver "Decisiones".

## Decisiones del dueño (13 nov 2026)
1. Se llama **"Requerimiento"** (no "Ficha visual"): es el punto de partida del proyecto. El dueño carga lo que pidió el
   cliente **sin ejecutar ninguna IA**: cliente (existente, nuevo u opcional), descripción (texto o dictado), adjuntos de
   cualquier tipo (PDF, fotos, capturas, renders, 3D medido en el navegador), fotos anotadas con el anotador del agente.
   Queda **pendiente** → asignado → cotizado. Datos en `/requerimientos/{id}`, archivos en Storage `requerimientos/{id}/…`,
   solo la lista blanca del hub. Acceso desde `index.html`: la tarjeta "Requerimiento nuevo" **reemplaza a "Cerebro
   Ejecutivo"** (su código queda comentado hasta que el dueño confirme). Lista de pendientes en la misma pantalla.
2. Se **borra el módulo viejo `requerimiento-asistido`** (página, enlaces y botones, también en el portal del cliente).
   **Los datos `/requerimientos_asistidos` NO se borran**: quedan como archivo.
3. El trabajo lo hace **Claude desde su plataforma** (proyecto RUBIK AGENTE APP + conector + skill), no el Agente IA de la
   app (que queda como está). Herramientas nuevas: `listar_requerimientos`, `leer_requerimiento` (imágenes como contenido
   `image`), `asignar_requerimiento`, `generar_render`, `aprobar_render` (con confirmación del dueño). Claude divide en
   ítems según el pedido.
4. Gemini: **Nano Banana 2.1** por defecto, **Pro** como "alta calidad", modelo fijo en el servidor. Las cotas las dibuja
   la app, nunca la IA.
5. Se retiran el botón **Render** de Presupuesto (los dos generadores) y **Medir** de Diseños. **Presupuesto IA no se toca.**
6. Primero una prueba mínima de imagen en el conector.

## Entregas
| # | Qué | Estado |
|---|---|---|
| 1 | Herramienta `prueba_imagen` (devuelve un PNG hecho en el servidor) para confirmar que claude.ai le pasa la imagen a Claude | ✅ mergeada · falta la prueba del dueño |
| 2 | Pantalla Requerimiento (formulario, adjuntos, anotador, lista de pendientes) + tarjeta en `index.html` + reglas | ✅ PR listo · espera el OK de la maestra para mergear (toca `functions/`) |
| 3 | Borrar `requerimiento-asistido` (sin tocar los datos) | pendiente |
| 4 | Conector: `listar_requerimientos`, `leer_requerimiento`, `asignar_requerimiento` + skill | pendiente (toca `functions/`) |
| 5 | Conector: `generar_render` (Nano Banana 2.1 / Pro fijo) y `aprobar_render` + skill | pendiente (toca `functions/`) |
| 6 | Retirar Render y Medir; matriz en el ítem, PDF y producción | pendiente |

### Entrega 2 — cómo quedó
- **Pantalla** `public/requerimiento.html`, desde la tarjeta **"Requerimiento nuevo"** del inicio (reemplaza a Cerebro
  Ejecutivo, cuyo código queda comentado en `index.html`; la tarjeta muestra cuántos hay pendientes).
  - Cliente: uno de la app, un nombre nuevo (lo crea Claude al asignar) o ninguno.
  - Descripción por texto o dictado 🎤 (el dictado del navegador; sin IA).
  - Adjuntos todos juntos (elegir, arrastrar o pegar): fotos y capturas (se achican a 2000 px), PDF, 3D (FBX, GLB,
    glTF, rubik.json o .zip: se mide en el navegador con `importar-3d.js` + `lector-3d.js` y se guardan la medición y dos
    vistas), y cualquier otro archivo tal cual (DWG, Excel…; hasta 20 MB).
  - Fotos: ✏️ abre el **anotador del agente** (`agente-anotador.js`); se guardan la foto original, la anotada, las
    anotaciones como datos y el estado del editor (para volver a editarlas).
  - De cada foto (y de la anotada) el navegador guarda además una **copia chica "para Claude"** (lado ≤ 1024 px,
    ≤ 90 KB ≈ 120.000 caracteres en base64), para que el conector la devuelva como imagen sin pasarse del límite de
    claude.ai. El servidor no tiene librerías de imagen. Probado con una foto de ruido de 3000×2000: 89 KB.
  - Guardar deja el requerimiento **pendiente**. Lista con filtros (pendientes y asignados / cotizados / descartados);
    tocar uno lo abre para editar (también con `requerimiento.html#<id>`). Descartar y reabrir.
- **Function** `requerimientoApi` en `/api/requerimiento` (`functions/requerimientos/`): solo lista blanca hub, valida
  todo (tipos, tamaños, anotaciones, miniaturas) y no deja archivos sueltos si algo falla. No llama a ninguna IA.
- **Datos** `/requerimientos/{id}`: `estado` (pendiente → asignado → cotizado, o descartado), `cliente`
  (`{cid, nombre}` o `{nombre, nuevo:true}`), `descripcion`, `titulo`, `adjuntos/{adj}` (tipo, nombre, rutas, anotaciones,
  miniatura), `creado`, `actualizado`, `por`. Más adelante, `cid`/`pid` al asignar.
  **Reglas:** el hub lee; **nadie escribe desde el navegador** (solo la Function y el conector).
- **Archivos** en Storage `requerimientos/{id}/{adj}/…`, los escribe y lee solo el servidor. Las reglas de Storage están
  en la consola: conviene agregar, igual que para el agente,
  `match /requerimientos/{todo=**} { allow read, write: if false; }`.
- `functions/agente/almacen.js`: `crearAlmacen` acepta otras carpetas de Storage (por defecto, las del agente, como antes)
  y suma `borrarArchivo`. El Agente IA no cambia.
- `public/js/vistas-3d.js`: copia de las vistas 3D del chat del agente (el agente no se tocó; puede pasar a usarlo).
- Pruebas: `tools/requerimientos` (7, Firebase simulado), `tools/agente` (62) y `tools/mcp` (21) OK. En Chromium, con
  Firebase simulado: crear con foto + PDF + DWG (un solo `crear` aunque suban en paralelo), anotar, reabrir por `#id`,
  descartar y la tarjeta del inicio con el contador. **No se probó en el navegador la medición de un 3D real** (es el
  mismo código del agente).

### Prueba de la entrega 2 (dueño, en la app)
1. Inicio → **Requerimiento nuevo**. Elegí un cliente, dictá o escribí el pedido, adjuntá una foto, un PDF y un 3D.
2. En la foto, ✏️ → poné una cota y una nota → Listo. Tiene que decir "1 anotación" (o las que pusiste).
3. **Guardar** → aparece en la lista como *pendiente* y el inicio muestra el número.
4. Salí, volvé a entrar, tocá el requerimiento: tiene que estar todo. Volvé a anotar la foto: aparecen las cotas de antes.

### Prueba de la entrega 1 (dueño, en claude.ai)
En un chat del proyecto RUBIK AGENTE APP: *"probá prueba_imagen"*. Claude tiene que decir un **número de 4 cifras** y los
colores de las esquinas (rojo arriba a la izquierda, verde arriba a la derecha, azul abajo a la izquierda, amarillo abajo
a la derecha). El número **no viaja en el texto**: si lo dice bien, la ve. Se puede comparar abriendo el desplegable de la
herramienta en el chat, o en los logs (`[rubikMcp] prueba_imagen {"codigo":…}` del servicio `rubikmcp`).
Después: *"probá prueba_imagen con peso_kb 100"* (≈143.000 caracteres, cerca del límite de claude.ai) y con 300, para
saber hasta qué tamaño llega. Con eso se fija el tamaño de las imágenes que devuelven `leer_requerimiento` y `generar_render`.

---


---

## 1. Inventario real del código

### Herramientas de imagen que hay hoy

| Dónde | Qué hace | Cómo guarda |
|---|---|---|
| **Render** en Presupuesto (`abrirModalRender3D`, `presupuesto.html`, modal `mod-render3d`) | 3 pasos: descripción + referencia del cliente + plano con medidas + detalles + elementos (material/estructura/acabado) + dimensiones → `generarRender3D` → "Marcar cambios" (pincel por colores) → "Aprobar y Cotizar" (`aprobarRender3D`): **Gemini 2.5 Flash** arma el APU a partir del texto y crea un ítem nuevo | `item.img` = **data URL base64 dentro de la base** (no sube a Storage) |
| **Render del ítem** (`abrirRenderItem`, menú de foto del ítem "⚡ Generar…", modal `mod-render-item`) | Igual, pero sobre un ítem existente con sus fotos como referencia | Sube a Storage `presupuesto/render_item_*` → `item.img` o `item.cortes` (si falla la subida, guarda el base64) |
| **Anotador de Presupuesto** (`abrirMedicionPres`, modal `mod-medicion-pres`, prefijo `pmed`) | Cotas, notas y marcas en canvas. Lo usan: Presupuesto IA (fotos adjuntas), Render, Render del ítem, `ctx_img` y "📐 Medir / Anotar" del ítem | **Rasteriza a PNG**: las cotas quedan pintadas, no se pueden editar ni leer como datos. Sube a `presupuesto/medir_*` → `item.img` o `item.cortes` |
| **Medir en Diseños** (`disenos.html`, modal `mod-medicion`, prefijo `med`) | **Copia aparte** del mismo anotador | PNG a `disenos/{cid}/{pid}/fotos/medicion_*` |
| **Diseños** (`disenos.html`) | Galería por pestañas (Renders, Fotos, Planos y Cortes por ítem, Docs, Enlaces) + chat IA de conceptualización con `generateImage` de `js/gemini-client.js` | `/proyectos/{cid}/{pid}/disenos/*` y escribe `cortes` / `op_images` en los ítems |
| **CAD** (`cad.html`) | Editor vectorial 2D propio (líneas, cotas, capas) | `/proyectos/{cid}/{pid}/cad` |
| **Anotador del Agente IA** (`js/agente-anotador.js`, 378 líneas) | Capa **vectorial SVG** sobre la foto: cotas finas con flechas/ticks, marcas, notas, deshacer/rehacer, re-editable. Devuelve **JSON de anotaciones** + JPEG anotada + miniatura | Lo sube `functions/agente/api.js` junto a la original; al modelo le llegan original + anotada + JSON |
| **Requerimiento asistido** (`requerimiento-asistido.html`) | ⚠️ Ya existe algo con ese nombre: formulario de **medidas que llena el cliente** desde su portal | `/requerimientos_asistidos/{cid}/{pid}/{reqId}` |
| 3D existente | `importar-3d.js` + `lector-3d.js` (three.js 0.170 en el navegador) leen .glb/.fbx/rubik.json de Blender y arman el desglose | No sube el archivo |

### Cómo se genera la imagen (`/api/gemini` → `geminiProxy`, `functions/index.js`)
1. Con `generateImage: true`, **Claude** (`claudeOptimizarPromptImagen`) reescribe el pedido como prompt en inglés. Solo ve la imagen de referencia, no el plano ni los detalles.
2. Llama a `ListModels` y prueba **en el orden que devuelva Google** todos los modelos cuyo nombre tenga `flash-image` o `pro-image`. Después prueba nombres fijos que ya no existen (`gemini-2.5-flash-image-generation`, Imagen 3 y 4). **El modelo que responde no está fijado**: puede ser uno deprecado o el Pro (4 veces más caro), según la lista.
3. No pide proporción (`aspectRatio`) ni resolución. Devuelve un data URL.
- `js/gemini-client.js` (Diseños) tiene **su propia lista** de modelos, todos viejos (`gemini-2.5-flash-image`, `gemini-2.0-*`).
- En los logs de `geminiproxy` de los últimos 30 días (lo que guarda Cloud Logging) **no hay ninguna generación de imagen**: la herramienta casi no se usa hoy.

### Imágenes del ítem: quién las lee

| Campo | Lo escribe | PDF del presupuesto | Producción | Portal del cliente |
|---|---|---|---|---|
| `item.img` (principal) | Foto del ítem, Render, Anotador | ✅ (anexos y ficha) | ✅ | ✅ |
| `item.cortes` | Render del ítem, Anotador, Diseños | — | ✅ (PDF de producción) | ✅ |
| `item.op_images` | Producción, Diseños | — | ✅ | ✅ |
| `item.ctx_img` | Contexto de Presupuesto IA (comprimida a 512 px) | — | — | — |
| `apu[].corte_url` | Detalle por renglón del APU | — | — | — |
| `disenos/renders`, `disenos/fotos`… | Diseños | — | — | — |

### Qué se repite y qué se unifica
- **Tres anotadores**: `pmed` (Presupuesto), `med` (Diseños, copia) y el del agente. Los dos primeros pierden las cotas al rasterizar. → Queda **solo el del agente**.
- **Dos generadores** (Render nuevo y Render del ítem) con prompts y pasos casi iguales, más el de Diseños con otra lista de modelos. → **Un solo** "Crear render".
- **Tres listas de modelos** de imagen. → Una sola, con el modelo fijado en el servidor.
- `item.img` en base64 dentro de la base (Render nuevo). → Siempre a Storage.
- **Presupuesto IA no se toca** (lo sigue usando el dueño), aunque usa el anotador `pmed`.

---

## 2. Investigación (con fuentes)

### Abrir Claude desde la app
- **Claude Desktop**: `claude://claude.ai/new?q=<texto>` **deja el texto escrito** (no lo envía; corta en ~14.000 caracteres). `claude://claude.ai/project/{id}` abre el proyecto, pero **no está documentado** cargar texto dentro de un proyecto. ([soporte](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link))
- **Celular**: los únicos enlaces documentados son de Claude Code; para chat o proyectos no hay nada. ([soporte](https://support.claude.com/en/articles/14898120-open-the-claude-mobile-app-with-a-link))
- `https://claude.ai/new?q=` en el navegador: **no es oficial**; hay reportes de que cambió.
- **No existe forma oficial** de que una app inicie una conversación dentro de la suscripción. Siempre la empieza el dueño.
- Hoy la app ya tiene el botón flotante que abre el proyecto (`js/claude-flotante.js`, enlace `claude.ai/project/…`).

### Imágenes por el conector MCP de claude.ai
- **Devolver imagen: sí.** claude.ai acepta resultados de herramienta con texto e imagen. El modelo la ve; el chat la muestra solo dentro del desplegable de la herramienta. Límite del resultado **~150.000 caracteres** y **240 s** por llamada; la documentación recomienda no mandar imágenes grandes en base64. ([connectors](https://claude.com/docs/connectors/building.md), [troubleshooting](https://claude.com/docs/connectors/building/mcp-apps/troubleshooting.md))
  - Hay un reporte (1 ago 2026, sin respuesta) de imágenes que llegan **vacías** con conectores remotos ([issue](https://github.com/anthropics/claude-ai-mcp/issues/238)). **Hay que probarlo en el conector Rubik** antes de apoyarse en esto.
- **Recibir la imagen que el dueño adjuntó en el chat: no.** El modelo no puede pasar los bytes del adjunto a una herramienta y no hay mecanismo oficial de subida. Camino que funciona: la foto se sube **a la app** y la herramienta recibe el **id**. (Claude puede leer el adjunto él mismo y registrar lo que ve, como hoy con `registrar_lectura_de_archivo`.)
- Precios API (para el Agente IA de la app): Opus 5.5 $4 / $20 por millón de tokens, Sonnet 5.5 $2 / $10 ([precios](https://platform.claude.com/docs/en/about-claude/pricing)).

### Gemini para render con referencia
| Modelo | Estado | USD por imagen |
|---|---|---|
| `gemini-nano-banana-2.1` | Nuevo (oct 2026), recomendado por Google | 1K $0,034 · 2K $0,050 · 4K $0,113 |
| `gemini-3-pro-image-preview` (Pro) | Preview, mayor calidad, hasta 14 referencias | 1K/2K $0,134 · 4K $0,24 |
| `gemini-3.1-flash-image` | Deprecado (oct 2026) | 1K $0,067 |
| `gemini-2.5-flash-image` | Deprecado, se apaga el 15 mar 2027 | $0,039 |
| Imagen 4 | **Apagado** en la Gemini API (ago 2026) | — |

- **Sin capa gratuita** para imágenes. El "thinking" se cobra aparte: el costo real es algo mayor.
- **No hay edición por máscara**: solo por instrucciones. No está documentado que respete la proporción de la foto: hay que pedir `aspectRatio`.
- **Medidas**: Google no promete precisión dimensional. Sirve para un **render de venta**, no para planos. Las cotas **se dibujan encima en la app**, con los datos del requerimiento; nunca se le piden al modelo.
- No pude abrir directo ai.google.dev desde esta sesión (red): los precios salen de extractos de las páginas oficiales. **Confirmar en la [página de precios](https://ai.google.dev/gemini-api/docs/pricing)** y con `ListModels` de la llave real antes de fijar el modelo.

### 3D
| Opción | Costo | Sirve para |
|---|---|---|
| **three.js en el navegador** (ya está en la app, v0.170) | $0 | Volumetría paramétrica con medidas exactas (cajas, paneles, letras). Se puede "vestir" la captura con Gemini |
| Blender sin pantalla en Cloud Run | ~$0,05 por render en CPU, ~$0,67/h con GPU L4 (estimación) + armar y mantener escenas | Fotorrealismo controlado; solo con volumen |
| APIs imagen→3D (Tripo $0,20–0,30, Meshy) | Por modelo | Mallas sin escala real: **no sirven** para fabricar |

---

## 3. Propuesta de lógica

**Base común: un "Requerimiento visual" guardado en la app**, al que llegan los dos caminos. Nombre a definir para no confundir con *Requerimiento asistido* (medidas del cliente). Propuesta: **"Ficha visual"** por ítem.

```
/proyectos/{cid}/{pid}/fichas/{fid}
  item_idx?            (ítem del presupuesto al que pertenece; puede nacer sin ítem)
  foto_original        (Storage)
  anotaciones          (JSON del anotador del agente: cotas, marcas, notas)
  foto_anotada         (Storage, JPEG)
  pedido               (texto: qué quiere el cliente)
  materialidad         (propuesta del experto: estructura, revestimiento, acabado)
  renders: [{url, modelo, prompt, costo, fecha, origen: app|claude}]
  matriz               (url del render aprobado)  → se copia a item.img
  estado               borrador | render | aprobado
```

### Opción A — Todo en la app (Gemini directo)
Foto → anotador del agente → "Crear render": el servidor arma el prompt con pedido + JSON de cotas + materialidad, llama a **un modelo fijo** (Nano Banana 2.1, Pro como opción) con `aspectRatio` de la foto → el dueño aprueba → matriz en el ítem.
- ➕ Rápido, desde el celular, ~$0,04 por render.
- ➖ Sin "ojo experto" que revise el render y proponga materialidad (salvo que lo haga el Agente IA, que se paga por API).

### Opción B — Todo desde Claude (conector)
Herramientas nuevas: `crear_ficha` (desde una foto ya subida a la app), `leer_ficha` (devuelve foto anotada chica + JSON), `generar_render` (llama a Gemini del servidor y **devuelve la imagen** para que Claude la mire y corrija), `aprobar_render` (con confirmación del dueño, la deja como `item.img`).
- ➕ Claude analiza, propone materialidad, revisa el render, itera y sigue con la cotización. Usa la suscripción.
- ➖ La foto no puede viajar del chat a la herramienta: hay que subirla a la app o a una página de subida. Ver imágenes en el resultado depende de una prueba real.

### Opción C (recomendada) — A + B sobre la misma Ficha
- **Desde la app:** foto → anotador único → dos botones: **"Crear render"** (opción A, directo) y **"Pedile a Claude"**: abre el proyecto de Claude (en Desktop con el texto cargado; en el celular, copia al portapapeles "Revisá la ficha F-123 del proyecto X") y el dueño lo envía.
- **Desde Claude con una foto en el chat:** Claude responde con un **enlace de subida** de la app (página corta, con login, `rubikbolivia.com/ficha/nueva?cid&pid`) o el dueño la sube desde la app; la herramienta trabaja con el id. Claude registra lo que leyó de la foto como hoy.
- En los dos casos `generar_render` corre en el servidor y queda en la ficha, con costo registrado. Después sigue la cotización de siempre (`armar_borrador`…).

### Lo que propongo además
1. **Fijar el modelo en el servidor** y retirar la búsqueda dinámica y las listas viejas (también la de `gemini-client.js`).
2. **Las cotas nunca dentro del render.** El render es la imagen limpia; el PDF y producción muestran la foto anotada **y** el render (las cotas salen del JSON, no de la IA).
3. **3D**: con three.js, cuando haya medidas suficientes (caja, panel, letrero), generar una volumetría simple y usarla como **segunda referencia** del render: así la proporción del render respeta las medidas. Blender en la nube solo si el volumen lo justifica.
4. Guardar todo en Storage, nunca base64 en la base.

### Preguntas para el dueño
1. ¿Opción C? ¿Y el nombre "Ficha visual"?
2. Modelo por defecto: ¿Nano Banana 2.1 (~$0,04) con botón "alta calidad" Pro (~$0,13)?
3. ¿La ficha pertenece a un ítem o puede haber una ficha de proyecto que después se reparte en ítems?
4. ¿Se retiran los botones **Render** (Presupuesto) y **Medir** (Diseños), redirigiendo a la ficha? (Presupuesto IA queda como está.)
5. Antes de construir, ¿probamos con una herramienta mínima del conector si claude.ai le muestra la imagen a Claude? Toca `functions/` (corte breve del Agente IA y del conector al desplegar).

## Fases siguientes (después del visto bueno)
1. Interfaz única en la app: Ficha visual con el anotador del agente.
2. Herramientas del conector y skill (`skills/cotizar-en-rubik` + ZIP).
3. Matriz en el ítem, el PDF y producción.
4. 3D con three.js, si se aprueba.
