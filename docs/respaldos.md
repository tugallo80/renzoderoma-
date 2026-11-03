# Respaldos de la Realtime Database

Base: `rubik-bolivia-default-rtdb` (proyecto `rubik-bolivia`). Los respaldos contienen pagos y datos de clientes:
**nunca** van al repo ni a `public/`.

## Estado (2 nov 2026)

- Respaldos automáticos diarios: **activos**, bucket `rubik-bolivia-default-rtdb-backups`.
- Respaldo manual completo: 2 nov 2026, en el mismo bucket + copia JSON en la PC.
- El respaldo del 2 nov figura como **Completa** en la consola.
- **Verificación de lectura: se hace justo antes de la migración de la Sesión A** (bloque de Cloud Shell abajo).
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

## Verificar que se pueda leer (justo antes de migrar)

Se corre en **Cloud Shell** (no hace falta el repo ni Node en la PC):
https://shell.cloud.google.com/?project=rubik-bolivia

1. Elegir el respaldo más reciente del bucket (el script muestra cuál toma):

```bash
RESPALDO=$(gsutil ls -r 'gs://rubik-bolivia-default-rtdb-backups/**' | grep -E '\.json(\.gz)?$' | grep -vi rules | sort | tail -1); echo "Respaldo: $RESPALDO"
```

2. Copiarlo, verificarlo y borrar la copia local (tiene datos sensibles). El repo va a ser privado, así que
   Cloud Shell no puede bajar el script de GitHub: **pedirle a Claude el bloque con `tools/verificar-respaldo.js`
   incluido** (versión actual de `main`). El bloque termina con `rm -rf` de la copia.

Debe terminar con ✅. Anotar el conteo de "proyectos con pagos_cliente" como referencia para la migración.

Acepta `.json` y `.json.gz`. Muestra solo estructura y conteos (clientes, proyectos, cuántos tienen
`pagos`/`pagos_cliente`/`presupuesto`…), nunca valores. Sale con error si el archivo está roto o faltan nodos
principales.

## Antecedente: export publicado en el sitio (hasta mayo 2026)

- Archivo: `/backups/rubik-bolivia-default-rtdb-export.json`, export completo de la base del **29 abr 2026**.
- Estuvo publicado en versiones de Hosting del **29 abr 2026 al 10 may 2026**, siempre el mismo archivo (misma huella).
  Se publicaba porque se desplegaba `public/` entero desde la PC; el fix del 16 may lo sacó de `public/`.
- Verificado el 2 nov 2026: las 3 URLs (rubikbolivia.com, web.app, firebaseapp.com) dan 404. Nunca estuvo en git.
- Contenido: solo datos del negocio (clientes, proyectos, pagos, personal, caja chica, WhatsApp, etc.).
  Sin claves de Google, tokens de Meta, contraseñas ni `config_ia` → no hubo credenciales para rotar.
- No se puede saber si alguien lo descargó (Hosting no guardaba registros de acceso).
- Retención de versiones de Hosting limitada a 20 (nov 2026): las versiones que lo contenían se borran.
- PIN de clientes (`pin_hash`, SHA-256 sin sal) se tratan como expuestos → ver "Antes de la salida a la venta"
  en `docs/plan-sesiones.md`.

## Restaurar si una migración sale mal

1. Tomar el respaldo previo a la migración (bucket o PC). Si es `.gz`, descomprimir.
2. **Preferir restaurar solo el nodo afectado:** extraer ese subárbol del JSON (ej. `proyectos`), ir a ese nodo
   en la consola → ⋮ → **Importar JSON**. Reemplaza solo ese nodo; el resto de la base no se toca.
3. **Restauración total** (último recurso): Importar JSON en la raíz. Pisa todo lo escrito después del respaldo.
4. Correr el verificador y revisar en la app los módulos afectados.

Las migraciones se prueban primero sobre una copia, nunca directo sobre la base real.
