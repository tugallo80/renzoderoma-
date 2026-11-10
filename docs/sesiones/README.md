# Sesiones de trabajo — índice y orden para retomar

Última actualización: 10 nov 2026 (Sesión 2, pasos 2.1–2.3). Plan general y visión: `docs/plan-sesiones.md`.
Cada sesión o subsesión tiene su ficha en esta carpeta.

---

## 1. Sesión 0 cerrada (10 nov 2026)

El dueño confirmó las pruebas en la app y la revisión de claves:
- ✅ a · PDF de Auditoría Impositiva con fotos (ficha 01)
- ✅ b · PDF de Consolidado de Contratistas con la foto correcta por ítem (ficha 03)
- ✅ c · Nombre del cliente en vez del código (PR #266)
- ✅ d · Pagos de Compras visibles al instante y en el balance (PR #267)
- ✅ e · Claves viejas de Gemini y token de Meta revisados

Quedan abiertos, sin bloquear nada: Prioridad 4 (Actions y repo privado), la prueba de permisos con la
llave, y reabrir las apps antes de la salida a la venta (ver `docs/plan-sesiones.md`).

---

## 2. Estado de las fichas

| Ficha | Tema | Estado |
|---|---|---|
| `01-cerrar-api-imagen.md` | Cerrar `/api/imagen` (proxy abierto) | ✅ Cerrada |
| `02-cotizacion.md` | Cotización: Vectorworks → Blender → app; IA solo para fotos y referencias | 🟡 2.2 y 2.3 hechos (script de Blender + botón "Importar 3D" que lee .glb/.fbx en la app) · 2.1 falta validar con el modelo real · sigue 2.4 (depende de la Sesión B) |
| `03-fotos-pdf-rendicion.md` | Fotos repetidas o faltantes en el PDF de rendición de contratistas | ✅ Cerrada |
| *(sin ficha)* PR #266 | Código del cliente en vez de su nombre (Consolidado de Contratistas) | ✅ Cerrada |
| *(sin ficha)* PR #267 | Pagos a trabajadores que no aparecían sin recargar (Compras / Tesorería) | ✅ Cerrada |
| `../plan-sesiones.md` Sesión 0 | Protección: respaldos, seguridad, permisos | ✅ Cerrada · Prioridad 4 queda en paralelo |

---

## 3. Orden propuesto de las próximas sesiones

**Próxima sesión → cerrar el 2.1 con un trabajo real** (correr `inventario()` y `exportar()` sobre el modelo;
traer lo que dice la sección 4). El script del 2.2 ya está hecho y probado (`tools/blender/LEEME.md`).
Después sigue la Sesión A.

```
 Sesión 2 · pasos 2.1–2.2   ── Vectorworks → Blender: ver qué datos llegan y armar el script
        │                      (no toca la app; necesita un trabajo real exportado)
        ▼
 Sesión A · deuda técnica   ── incluye el ID ESTABLE DE ÍTEM (lo pide la ficha 03 y lo
        │                      necesita la importación de Blender) + migración de pagos
        ▼
 Sesión B · base de precios ── unidades, rendimientos y desperdicio por material
        │
        ▼
 Sesión 2 · pasos 2.4–2.6   ── cálculo del APU sin IA, IA para fotos ("Importar 3D", 2.3, ya está)
        │
        ▼
 Sesiones C, E, F, H, G     ── historial, aprendizaje, flujo completo, tesorería, app Android
```

**En paralelo, cuando haya un rato:** Prioridad 4 de la Sesión 0 (menos minutos de GitHub Actions y
después repo privado). No bloquea nada.

### Por qué este orden
- **2.1–2.2 primero:** es lo que más mueve el proyecto y no toca la app. Solo necesita el modelo real.
- **Sesión A antes de importar desde Blender:** hoy los ítems del presupuesto se identifican por su
  **posición**. Al reordenar, las licitaciones apuntan al ítem equivocado (fue la causa de la ficha 03).
  Si la importación de Blender escribe ítems sobre esa base, el problema se multiplica. Primero hay que
  darle a cada ítem un ID fijo.
- **Sesión B antes de 2.4:** sin rendimientos ni desperdicio en la base, el cálculo desde Blender trae
  cantidades exactas pero no precios completos.
- **La Sesión D del plan queda reemplazada** por la ficha 02: con modelo, los números no los pone la IA.

---

## 4. Qué traer a cada sesión

| Sesión | Traer |
|---|---|
| 2 (2.1–2.2) | Un trabajo ya cotizado y exportado a Blender como siempre (`.blend` y, si se puede, el archivo de Vectorworks), lo que se cobró por ese trabajo, el formato de exportación y el conector de Blender que usa Claude |
| A | Nada: es trabajo interno. Antes de migrar: verificar el respaldo (`docs/respaldos.md`) |
| B | Materiales más usados (unidad de compra y precio), proveedores y rendimientos conocidos (ej. cuántos m² rinde una plancha o un litro) |

---

## 5. Arreglos sueltos (subsesiones cortas)

Los problemas que aparecen en el uso diario (como las fichas 03, #266 y #267) se resuelven como
**subsesión corta**: diagnóstico, corrección, ficha si el tema es grande y una prueba para el dueño.
Se anotan en la tabla de la sección 2.

**Pendientes chicos ya detectados:**
- `licitaciones.html` → PDF de propuesta al trabajador: mismo problema de posición del ítem que la ficha 03,
  y además suma todas las artes del ítem, no solo las adjudicadas. Se arregla si aparece en el uso, y de
  raíz en la Sesión A con el ID estable.
