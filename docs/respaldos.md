# Respaldos de la Realtime Database

Base: `rubik-bolivia-default-rtdb` (proyecto `rubik-bolivia`). Los respaldos contienen pagos y datos de clientes:
**nunca** van al repo ni a `public/`.

## Estado (2 nov 2026)

- Respaldos automáticos diarios: **activos**, bucket `rubik-bolivia-default-rtdb-backups`.
- Respaldo manual completo: 2 nov 2026, en el mismo bucket + copia JSON en la PC.
- Pendiente: correr `tools/verificar-respaldo.js` sobre la copia de la PC.
- No cubierto: archivos de Storage (fotos, PDFs, diseños).

## Ver / configurar respaldos automáticos

https://console.firebase.google.com/project/rubik-bolivia/database/rubik-bolivia-default-rtdb/backups

Copia diaria del JSON (`.json.gz`) y de las reglas en Cloud Storage. Requiere plan Blaze.

## Respaldo manual

https://console.firebase.google.com/project/rubik-bolivia/database/rubik-bolivia-default-rtdb/data

- **PC:** menú ⋮ del panel de datos → **Exportar JSON**.
- **Celular:** Chrome → ⋮ → **Sitio de escritorio**, y lo mismo.
- Nombrar `respaldo-rubik-AAAA-MM-DD.json` y guardar en la PC y en una carpeta privada de Drive.

**Antes de cualquier migración de datos** (ej. `pagos_cliente/` → `pagos/`): respaldo manual justo antes.

## Verificar que se pueda leer

```bash
node tools/verificar-respaldo.js respaldo-rubik-AAAA-MM-DD.json
```

Acepta `.json` y `.json.gz`. Muestra solo estructura y conteos (clientes, proyectos, cuántos tienen
`pagos`/`pagos_cliente`/`presupuesto`…), nunca valores. Sale con error si el archivo está roto o faltan nodos
principales.

## Restaurar si una migración sale mal

1. Tomar el respaldo previo a la migración (bucket o PC). Si es `.gz`, descomprimir.
2. **Preferir restaurar solo el nodo afectado:** extraer ese subárbol del JSON (ej. `proyectos`), ir a ese nodo
   en la consola → ⋮ → **Importar JSON**. Reemplaza solo ese nodo; el resto de la base no se toca.
3. **Restauración total** (último recurso): Importar JSON en la raíz. Pisa todo lo escrito después del respaldo.
4. Correr el verificador y revisar en la app los módulos afectados.

Las migraciones se prueban primero sobre una copia, nunca directo sobre la base real.
