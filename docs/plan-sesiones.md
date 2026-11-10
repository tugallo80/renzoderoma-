# Plan de Sesiones — Rubik Bolivia OS

Última actualización: 10 nov 2026. **Para retomar, empezar por `docs/sesiones/README.md`** (orden y estado de las sesiones).

---

## Visión

Convertir la app en un sistema donde la IA no es un "diagramador de presupuestos" sino un **motor experto** que conoce cómo trabaja Rubik Bolivia: sus materiales, proveedores, rendimientos, tiempos de producción y precios reales. El objetivo final es que con planos + descripción, el sistema genere automáticamente presupuesto → orden de producción → Gantt → lista de compras → borradores de licitaciones, con mínima corrección manual.

---

## El flujo ideal (estado futuro)

```
Cliente llama / manda planos
        ↓
Agente recibe: imagen de plano + descripción de voz o texto
        ↓
Extrae: dimensiones, materiales especificados, acabados, cantidad de piezas
        ↓
Busca en historial: proyectos similares completados con datos reales
        ↓
Genera APUs con precios reales de base de datos actualizada
        ↓
Produce presupuesto → lo envía al cliente
        ↓
Cliente aprueba → sistema genera automáticamente:
  - Orden de producción (ODP) por ítem
  - Gantt con tiempos reales del equipo
  - Lista de compras con proveedores preferidos
  - Borradores de licitaciones de mano de obra
        ↓
Ejecución → registros de gastos reales
        ↓
Cierre: comparación presupuestado vs real → alimenta historial
```

---

## Por qué la IA cotiza mal hoy

El problema no es Gemini — es que opera en vacío:
- No sabe cómo trabaja Rubik Bolivia específicamente
- La base de datos de precios puede estar incompleta o desactualizada
- No tiene memoria de proyectos anteriores similares
- Lee las fotos de planos y adivina sin extraer datos estructurados
- Cuando el usuario corrige una cotización, esa corrección se pierde

---

## Sesiones planificadas

---

### Sesión 0 — Protección antes de tocar datos
**Objetivo**: poder deshacer cualquier error antes de migrar datos (Sesión A) o tocar permisos.

**Estado: ✅ cerrada el 10 nov 2026** (pruebas del dueño en `docs/sesiones/README.md`, sección 1)

| Prioridad | Estado |
|---|---|
| 1 — Respaldos | ✅ Hecha. Solo falta verificar el respaldo justo antes de la migración de la Sesión A |
| 2 — Seguridad | ✅ Hecha: pasos B, C y D, `/api/imagen` cerrado y claves viejas Gemini/Meta revisadas |
| 3 — Permisos | ✅ Hecha (roles verificados en Cloud Shell). Prueba con la llave pendiente |
| 4 — Despliegue | ⏳ En paralelo, no bloquea (hoy es automático al mergear a `main`) |

Paso D de la Prioridad 2 (consola de Firebase, hecho por el dueño y verificado):
D1 login anónimo desactivado · D2 registro abierto con email desactivado ·
D3 borrados `test@rubikbolivia.com` y 35 usuarios anónimos (queda solo la cuenta del dueño) ·
D4 retención de versiones de Hosting limitada a 20.

**Próxima sesión** → Sesión 2, pasos 2.1–2.2 (ver `docs/sesiones/README.md`, sección 3).
Además: Prioridad 4 (Actions y repo privado) y, antes de la salida a la venta, reabrir las apps (ver abajo).

**Prioridad 1 — Respaldos** (ver `docs/respaldos.md`)
- [x] Respaldos automáticos diarios activos (bucket `rubik-bolivia-default-rtdb-backups`)
- [x] Respaldo manual completo (2 nov 2026) + copia JSON en la PC
- [x] Procedimiento de restauración documentado
- [x] Script `tools/verificar-respaldo.js`
- [ ] Verificar que el respaldo se pueda leer → se hace justo antes de la migración de la Sesión A (Cloud Shell, ver `docs/respaldos.md`)

**Prioridad 2 — Seguridad**
- [x] Revisar el export que estuvo publicado en `public/backups/` (ver `docs/respaldos.md`, "Antecedente")
- [x] Confirmar que la clave de Gemini y el token de Meta no están en el historial de git
- [x] Confirmar que la clave vieja de Gemini y el token viejo de Meta están revocados (`tools/revisar-claves-viejas.sh`, nov 2026)
- [x] Reglas: toda la base solo para la lista blanca `/acceso/hub/{uid}` (pruebas en `tools/probar-reglas`) — PR #256, probado en PC y teléfono el 2 nov 2026
- [x] Functions: IA, TTS, Gemini Live y correo solo para la lista blanca (`functions/acceso.js`) — PR #256
- [x] Desactivar el login anónimo y el registro abierto con email en Firebase Auth (paso D1–D2, nov 2026)
- [x] Borrar la cuenta de prueba `test@rubikbolivia.com` y los 35 usuarios anónimos (paso D3): queda solo la cuenta del dueño
- [x] Limitar la retención de versiones de Hosting a 20 (paso D4): se borran las versiones con el export
- [x] `/api/imagen` (`proxyImagen`): solo lista blanca, solo imágenes de nuestro Storage (`docs/sesiones/01-cerrar-api-imagen.md`).
      Probado por el dueño (PDF de Auditoría Impositiva con fotos)

**Prioridad 3 — Permisos**
- [x] Permisos mínimos para la cuenta `claude-code` en `rubik-bolivia` (sin admin de IAM ni lectura de pagos): aplicados 5 roles de solo lectura
      (`logging.viewer`, `cloudfunctions.viewer`, `run.viewer`, `firebasehosting.viewer`, `serviceusage.serviceUsageConsumer`), nov 2026
- [x] Script de Cloud Shell para revisarlo antes de correrlo: `tools/permisos-claude-code.sh [revisar|aplicar|quitar]`
- [ ] Prueba con la llave (`tools/probar-permisos-claude-code.sh`, esperado: 4 PERMITIDO y 5 DENEGADO): **pendiente**, la bloquea el control de
      credenciales de la sesión. Mientras tanto se verifica con `bash permisos-claude-code.sh revisar` en Cloud Shell (lista los roles).

**Prioridad 4 — Despliegue**
- [x] Revisar el despliegue actual: automático con GitHub Action `firebase-hosting-merge.yml` al mergear a `main`
      (hosting + reglas siempre; functions si cambia `functions/`) + vista previa en cada PR
- [ ] Optimizar minutos: no correr si solo cambian docs, desplegar solo lo que cambió, cachés, límite de tiempo,
      quitar la vista previa de PR (estimado hoy ~70–200 min/mes → ~40–60)
- [ ] Después de optimizar: pasar el repo a privado (hoy es público y Actions no descuenta minutos)
- [ ] Verificar que lo que se publicaría sea igual a lo que está en rubikbolivia.com


**Antes de la salida a la venta** (hoy la app la usa solo el dueño):
- [ ] Reabrir con permisos mínimos las apps cerradas en la Sesión 0: cliente-view (y juegos), app-trabajador,
      contratista, supervisor de obra, proveedor gráfico/agencia. Su código sigue en `public/`; solo se les cerró
      el acceso a los datos. Cada una necesita su propio permiso acotado (ej. claim por cliente), no `auth != null`.
- [ ] PIN de clientes: resetear todos y guardarlos con hash seguro del lado del servidor (el `pin_hash` actual es
      SHA-256 sin sal y estuvo en el export publicado hasta mayo 2026).
- [ ] Volver a habilitar el login anónimo solo si alguna de esas apps lo necesita.

---

### Sesión A — Infraestructura base (deuda técnica)
**Objetivo**: dejar la app sin bugs estructurales antes de construir encima.

- [ ] **Antes de migrar:** respaldo manual + verificación en Cloud Shell (`docs/respaldos.md`)
- [ ] **ID estable por ítem del presupuesto** (hoy se identifican por posición: al reordenar, licitaciones y PDFs
      apuntan al ítem equivocado — ver `docs/sesiones/03-fotos-pdf-rendicion.md`). Necesario antes de importar desde Blender
- [ ] Migrar nodo `pagos_cliente/` → `pagos/` en proyectos existentes (script de migración en Cloud Functions o directo en DB)
- [ ] Cambiar `localStorage` para `cid`/`pid` por URL hash params (`#cid=X&pid=Y`) en todos los módulos — resuelve el bug de múltiples pestañas y permite links compartibles
- [ ] Crear `public/css/variables.css` con todos los tokens de color (`--accent`, `--blue`, `--green`, etc.) e incluirlo en todos los HTML
- [ ] Verificar que el tab Clientes de Tesorería muestre Cobrado correcto después de la migración

**Entrada necesaria**: ninguna adicional, es trabajo técnico interno.

---

### Sesión B — Base de datos de precios como fuente de verdad
**Objetivo**: que la IA tenga precios reales, unidades correctas y rendimientos por material.

**Problema actual**: la BD de materiales/mano de obra existe pero puede estar incompleta, con unidades inconsistentes o precios desactualizados. La IA usa lo que hay y genera errores.

**Trabajo**:
- [ ] Auditar `/base_datos/materiales/`, `/base_datos/mano_obra/`, `/base_datos/otros/`
- [ ] Agregar campos faltantes: proveedor preferido, unidad de compra, unidad de uso, rendimiento (ej: 1 litro de pintura cubre X m²), desperdicio típico (%)
- [ ] Crear interfaz de admin para mantener la BD (hoy no hay forma cómoda de editarla)
- [ ] Agregar precios con fecha de vigencia para detectar cuándo están desactualizados

**Entrada necesaria para esta sesión**:
- Lista de proveedores que usás habitualmente con los materiales que comprás a cada uno
- Unidades en las que comprás vs. unidades en que cotizás (ej: comprás pintura en litros, cotizás en m²)
- Rendimientos reales que conocés por experiencia (cuánto material lleva un m² de cada tipo de acabado)

---

### Sesión C — Historial de proyectos como memoria de la IA
**Objetivo**: que proyectos completados alimenten la experiencia del sistema.

**Problema actual**: cuando un proyecto cierra, los datos reales (materiales finales, horas reales, costo total real) no se guardan en ningún formato que la IA pueda consultar.

**Trabajo**:
- [ ] Al cerrar un proyecto, guardar un "resumen de cierre" estructurado: tipo de proyecto, dimensiones/m², materiales realmente usados con cantidades finales, horas reales por operación, costo real total, diferencia vs. presupuestado
- [ ] Crear nodo `/historial_proyectos/` en Firebase con estos resúmenes indexados por tipo
- [ ] Interface para ver y corregir el historial (algunos proyectos viejos necesitarán entrada manual)

**Entrada necesaria**:
- Los 5-10 proyectos más representativos que hiciste (con sus costos reales) para cargar el historial inicial manualmente

---

### Sesión D — IA con contexto de empresa (reemplazada por `docs/sesiones/02-cotizacion.md`)
> **Nov 2026:** se replantea en `docs/sesiones/02-cotizacion.md`. Con modelo de Blender, las cantidades salen
> del modelo y de la base, no de la IA. La IA queda para fotos y referencias del cliente (estimado marcado).

**Objetivo**: reescribir el motor de cotización para que la IA actúe como experto en Rubik Bolivia.

**El prompt actual**: descripción/imagen → Gemini → APU genérico

**El prompt mejorado**:
```
Sos el cotizador experto de Rubik Bolivia, empresa de fabricación de 
stands, exhibidores y mobiliario para eventos en Bolivia.

PRECIOS Y MATERIALES: [base de datos actualizada]
PROYECTOS SIMILARES COMPLETADOS: [top 3 del historial más parecidos]
ESTÁNDARES DE PRODUCCIÓN DE LA EMPRESA: [tiempos reales por operación]
PLANO/DESCRIPCIÓN: [input del usuario]

Extraé primero las dimensiones y materiales del plano.
Luego generá los APUs usando nuestros precios y rendimientos reales.
Indicá confianza (alta/media/baja) por cada ítem y motivo si es baja.
```

**Trabajo**:
- [ ] Diseñar el "contexto de empresa" como documento que se inyecta en cada prompt (quién es Rubik, cómo trabaja, qué produce)
- [ ] Sistema de búsqueda en historial: dado un nuevo proyecto, encontrar los 3 más similares automáticamente
- [ ] Extracción estructurada de planos: antes de cotizar, extraer un JSON con dimensiones, materiales, acabados
- [ ] Indicador de confianza por ítem: cuando la IA no está segura, lo dice en lugar de inventar
- [ ] Guardar correcciones del usuario como ejemplos para el próximo prompt similar

---

### Sesión E — Retroalimentación y aprendizaje
**Objetivo**: que cada corrección manual mejore las cotizaciones futuras.

**Trabajo**:
- [ ] Al editar un ítem de presupuesto, opción "Guardar como corrección" que registra: descripción del ítem, valor generado por IA, valor correcto, motivo (si el usuario lo escribe)
- [ ] Estas correcciones se acumulan en `/correcciones_ia/` y se incluyen automáticamente en futuros prompts similares como ejemplos
- [ ] Panel de revisión de correcciones acumuladas

---

### Sesión F — Flujo automatizado end-to-end
**Objetivo**: planos + descripción → todo el flujo generado automáticamente.

**Prerequisitos**: sesiones B, C, D completadas.

**Trabajo**:
- [ ] Botón "Generar flujo completo" en el proyecto aprobado
- [ ] Agente que en secuencia genera: ODP por ítem del presupuesto aprobado → Gantt con tiempos reales del equipo → lista de compras agrupada por proveedor → borradores de licitaciones con las operaciones de mano de obra
- [ ] Todo revisable y editable antes de confirmar
- [ ] Notificación interna cuando el flujo está listo para revisión

---

### Sesión G — App Android nativa
**Objetivo**: app instalable en Android con acceso a cámara y micrófono para el flujo de voz + planos.

**Opciones**:
- **TWA (Trusted Web Activity)**: 1-2 días de trabajo, sin reescribir nada. Queda en Play Store. Limitación: sin acceso a hardware nativo más allá de lo que permite el browser.
- **Capacitor**: misma web app envuelta en shell nativo. Acceso a cámara, micrófono, archivos locales. Habilita el "llamada de voz + foto de plano → cotización". Recomendado para el caso de uso objetivo.

**Trabajo con Capacitor**:
- [ ] Instalar Capacitor y configurar el proyecto Android
- [ ] Plugin de cámara para captura de planos directamente desde la app
- [ ] Plugin de micrófono para dictado de descripción del proyecto
- [ ] Integración con Claude API (o Gemini) para procesamiento de voz en tiempo real
- [ ] Build de APK firmado para instalación directa (o Google Play)

---

### Sesión H — Tesorería completa y cierres
**Objetivo**: cerrar el ciclo financiero con datos correctos.

**Prerequisitos**: Sesión A (migración de datos).

- [ ] Verificación antes de cerrar proyecto: si pagos < monto de cierre, mostrar diferencia y pedir confirmación explícita
- [ ] Tab Clientes con datos reales (depende de la migración)
- [ ] Reporte mensual de rentabilidad por proyecto (presupuestado vs real)
- [ ] Exportación SIAT mejorada

---

## Problemas conocidos priorizados

Ver `docs/pendientes.md` para el inventario completo. Los más críticos:

1. **`pagos/` vs `pagos_cliente/`** — Tesorería Clientes muestra Cobrado = 0 en proyectos con pagos. Bloquea el módulo financiero. → Sesión A.
2. **IA sin contexto de empresa** — Cotizaciones con errores que cascadean a todo el flujo. → Sesiones B, C, D.
3. **Sin retroalimentación de correcciones** — El sistema no aprende. → Sesión E.
4. **`localStorage` cid/pid** — Bug multi-tab, links no compartibles. → Sesión A.

---

## Contexto para arrancar sesiones

Al iniciar cada sesión, compartir este archivo + `docs/pendientes.md` como contexto.

Para la **Sesión B** específicamente, preparar:
- Lista de materiales que más usás (con la unidad en que los comprás y el precio actual)
- Proveedores principales
- Rendimientos que conocés de memoria (ej: "1 hoja de MDF 18mm de 1.22x2.44m nos alcanza para X m² de panel terminado")
- Tipos de trabajo que más repetís (stands modulares, vitrinas, muebles de exhibición, props, etc.)
