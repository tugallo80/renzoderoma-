# Sesiones de trabajo — índice y orden para retomar

Última actualización: 10 nov 2026. Plan general y visión: `docs/plan-sesiones.md`.
Cada sesión o subsesión tiene su ficha en esta carpeta.

---

## 1. Para retomar: primero cerrar lo pendiente (lo hace el dueño, ~20 min)

Son pruebas de cambios ya desplegados y una revisión de consola. No hace falta Claude.

| # | Qué probar o hacer | Dónde | Resultado esperado |
|---|---|---|---|
| a | PDF de **Auditoría Impositiva** de un mes con fotos de comprobantes | Tesorería → Impuestos | Salen las fotos (ficha 01) |
| b | PDF de **Consolidado de Contratistas** de un trabajador con fotos | Tesorería → Licitaciones | Cada ítem con **su** foto, una vez; medidas correctas (ficha 03) |
| c | Lista de proyectos en Consolidado de Contratistas | Tesorería → Licitaciones | Nombre del cliente, no un código tipo `-Ows…` (PR #266) |
| d | Cargar un pago en **Compras** con Tesorería abierta en otra pestaña y exportar el balance sin recargar | Compras + Tesorería | El pago aparece al instante y está en el PDF (PR #267) |
| e | Revisar claves viejas de Gemini y token de Meta | Cloud Shell, desde la PC: `bash revisar-claves-viejas.sh` | Una sola clave de Gemini **EN USO**; token de WhatsApp válido |

Si algo falla, avisar con el proyecto y el trabajador del ejemplo. Con todo en ✅ se cierra la **Sesión 0**.

---

## 2. Estado de las fichas

| Ficha | Tema | Estado |
|---|---|---|
| `01-cerrar-api-imagen.md` | Cerrar `/api/imagen` (proxy abierto) | ✅ Desplegado · falta prueba **a** |
| `02-cotizacion.md` | Cotización: Vectorworks → Blender → app; IA solo para fotos y referencias | 📝 Planificada · esperando el modelo real |
| `03-fotos-pdf-rendicion.md` | Fotos repetidas o faltantes en el PDF de rendición de contratistas | ✅ Desplegado · falta prueba **b** |
| *(sin ficha)* PR #266 | Código del cliente en vez de su nombre (Consolidado de Contratistas) | ✅ Desplegado · falta prueba **c** |
| *(sin ficha)* PR #267 | Pagos a trabajadores que no aparecían sin recargar (Compras / Tesorería) | ✅ Desplegado · falta prueba **d** |
| `../plan-sesiones.md` Sesión 0 | Protección: respaldos, seguridad, permisos | 🟡 Casi cerrada · falta **e** y la Prioridad 4 |

---

## 3. Orden propuesto de las próximas sesiones

```
 Sesión 0 (cerrar)          ── pruebas a–e
        │
        ▼
 Sesión 2 · pasos 2.1–2.2   ── Vectorworks → Blender: ver qué datos llegan y armar el script
        │                      (no toca la app; necesita un trabajo real exportado)
        ▼
 Sesión A · deuda técnica   ── incluye el ID ESTABLE DE ÍTEM (lo pide la ficha 03 y lo
        │                      necesita la importación de Blender) + migración de pagos
        ▼
 Sesión B · base de precios ── unidades, rendimientos y desperdicio por material
        │
        ▼
 Sesión 2 · pasos 2.3–2.6   ── "Importar de Blender", cálculo del APU sin IA, IA para fotos
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
