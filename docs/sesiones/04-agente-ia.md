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
| 3 | Editor de anotaciones de fotos | ⏳ |
| 4 | Aplicar al presupuesto + memoria simple | ⏳ |

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

### Pruebas (sin gastar plata)

- `cd tools/agente && npm test` — 38 pruebas (entrega 2: orígenes inválidos, fila sin origen rechazada, cantidad calculada
  desde el 3D ignorando la del modelo, precio de la base, totales = `calcPu`, item_desde_3d con ruta A y B, corrección "eran tres
  adhesivos", ítems para el presupuesto, flujo completo adjuntar → borrador → corrección con la API simulada, guardar_en_base con
  y sin confirmación, escala con cota). Entrega 1: 26 pruebas con la API **simulada**: medidor (Opus, Sonnet, Haiku, caché 1 h, fallback por
  modelo, tope), configuración, orígenes, escala de la medición, historial con fallback, validación de entradas, rutas
  prohibidas, adjuntar, enviar (con memoria), turno completo 3D → `medicion_3d` → respuesta con costos, PDF/imagen nativos,
  preguntas que cortan el turno, tope y "Seguir igual", rechazo, `max_tokens` con herramienta cortada, entrada inválida,
  continuación por tiempo, detener, error y reintento. También verifica que `functions/agente/compartido/` sea copia exacta
  de `public/js/` (`npm run sincronizar` la actualiza).
- `node pantalla/capturas.mjs` — capturas en tamaño celular (Pixel 7) con Firebase y `/api/agente` simulados; mide un GLB
  de ejemplo de verdad con el lector 3D.
- `tools/probar-reglas` — 170 OK, con las reglas nuevas de `agente_cola` y `agente_costos`.

### La prueba real la hace el dueño

1. Abrir un presupuesto → **Agente IA** → ⚙: dejar Opus 5.5, esfuerzo Alto, tope.
2. 📎 un FBX + el PDF de planos + una foto; escribir o dictar el contexto; enviar.
3. Mirar el progreso, las preguntas y el costo de la cotización. Probar 🔊.
