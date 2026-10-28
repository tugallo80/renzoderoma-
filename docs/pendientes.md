# Pendientes y Problemas Conocidos

Último update: octubre 2026. Refleja todo lo observado en la sesión de trabajo.

---

## Tesorería — Tab Clientes

- **Cobrado siempre 0**: los proyectos de STRATIVA muestran Cobrado = 0,00 aunque tengan pagos. Hay que verificar que los pagos estén en el nodo `/proyectos/$cid/$pid/pagos/` (no en `pagos_cliente/` ni otro path). Posible migración de datos necesaria.
- **"Cerrar Proyecto" sin verificación de saldo**: al marcar un proyecto como cerrado, el saldo queda en 0 en Tesorería aunque los pagos registrados no cubran el monto de cierre. No hay advertencia ni cálculo de diferencia.
- **Sin paginación**: si un cliente tiene 20+ proyectos, la carga puede ser lenta y el acordeón muy largo.
- **`--accent` no definido en tesoreria.html**: los botones PDF usan `#5856d6` hardcodeado. Si se cambia el tema de color del sistema, estos botones no seguirán el cambio.
- **Botón PDF chico en header invisible en mobile**: en pantallas pequeñas el header del acordeón queda apretado (nombre + saldo + PDF + flecha). En mobile podría solaparse.
- **El PDF de cobro no muestra el monto de cierre si es manual**: el PDF genera el estado de cuenta pero no hace referencia explícita a si el contrato viene del presupuesto o de un monto fijo.

## Dashboard Proyecto

- **Monto de cierre se desvincula silenciosamente**: cuando se usa "Fijar Monto" o "Guardar Factura" o "Cerrar Trato", el sistema setea `estado → produccion/entregado` automáticamente pero también fija `monto_cierre`. El usuario puede no darse cuenta de que se desvinculó del presupuesto hasta ver el aviso naranja.
- **No hay auditoría de cambios de estado**: no se registra quién ni cuándo cambió el estado de un proyecto (cotizacion → produccion → entregado → cerrado).
- **Botón "Cerrar Proyecto" solo aparece en `entregado`**: si un proyecto quedó en `produccion` (caso frecuente), el botón no aparece y hay que ir a Editar para cambiarlo a `cerrado` manualmente.
- **`cotizacion` no tiene botón de reversión**: si un proyecto se movió de `cotizacion` a otro estado y se quiere revertir, hay que editar la DB directamente.

## Proyectos (proyectos-cliente.html)

- **Estado `cerrado` no tiene color diferenciado en el contador de estados** del header (si existiera un resumen por estados). Solo el ícono ✅ en la grilla lo distingue.
- **Long-press en mobile a veces dispara `click` también**: al abrir el menú contextual con long-press, en algunos dispositivos se ejecuta también el tap (abre el proyecto). Workaround parcial con `e.preventDefault()`.
- **Sin búsqueda dentro del cliente**: con un cliente que tiene 30+ proyectos, no hay forma de filtrar por nombre.

## Presupuesto

- **APU truncado en ítems complejos**: `maxOutputTokens: 16000` en Gemini resolvió los casos conocidos, pero ítems con 30+ materiales/MO pueden seguir fallando. No hay retry automático con ítem solo cuando falla en lote.
- **El presupuesto no se "bloquea" al pasar a producción**: sigue editable aunque el proyecto esté en `produccion` o `entregado`. Cambios post-cierre no quedan registrados.
- **No hay historial de versiones**: no se puede ver cómo era el presupuesto antes de un cambio.

## General / Arquitectura

- **Nodo de pagos inconsistente**: en algunos proyectos los pagos del cliente están en `pagos/` y en otros puede haber restos en `pagos_cliente/` (path antiguo). Antes de confiar en el tab Clientes de Tesorería conviene revisar si hay datos en ambos paths.
- **17 ramas antiguas sin eliminar**: ramas pre-main con historia sin ancestro común. No aportan contenido (verificado con merge simulation) pero quedan como ruido en el repo. El usuario pidió no borrarlas.
- **Variables CSS no documentadas**: `--accent`, `--blue`, `--green`, `--orange`, `--red`, `--gray`, `--border`, `--card`, `--bg`, `--text` no tienen un archivo de tokens centralizado. Cada módulo puede sobreescribirlas o no definirlas.
- **`localStorage` para `cid`/`pid`**: la navegación entre módulos usa `localStorage` en lugar de URL params. Si el usuario abre dos proyectos en pestañas distintas, los valores se pisan.
- **Sin modo offline**: la app requiere conexión a Firebase. No hay caché de datos para uso offline (aunque `firecache.js` parece apuntar a algo, no está documentado qué cubre).

## Opciones redundantes detectadas

- **"Registrar Anticipo / Pago"** existe en `dashboard-proyecto.html` Y en el modal `mod-pago-cliente` de `tesoreria.html`. Ambos escriben al mismo nodo `pagos/` — son equivalentes, pero el usuario podría no saber que lo que registra en uno aparece en el otro.
- **"Consolidado PDF" y "Resumen PDF"** en dashboard-proyecto parecen generar documentos similares. La diferencia (con/sin precios unitarios) no está documentada en la UI.
- **Botón "Actualizar" en tab Clientes**: carga los datos al abrir el tab, pero también hay un botón manual de recarga. Si los datos cambian en tiempo real (otro usuario registra un pago), el tab no se actualiza solo — hay que tocar "Actualizar".

## Mejoras identificadas (no urgentes)

- Agregar verificación antes de cerrar un proyecto: si `pagos_total < monto_cierre`, mostrar advertencia con la diferencia antes de confirmar.
- El botón "Cerrar Proyecto" podría aparecer también en estado `produccion` (no solo `entregado`).
- El tab Clientes podría filtrar/ordenar: por saldo mayor, por cliente, por proyectos sin pago.
- El PDF de cobro podría incluir datos de contacto del cliente (teléfono, email) si están en `/clientes/$cid/`.
- Migrar nodo `pagos_cliente/` → `pagos/` en proyectos que usen el path antiguo.
