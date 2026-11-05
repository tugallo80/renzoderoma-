# Rubik Bolivia — Reglas de Oro para Claude

## PR y Deploy

1. **Siempre crear el PR automáticamente** después de cada push — sin esperar que el usuario lo pida. Ya tienes todos los accesos.

2. **Siempre mergear el PR automáticamente** después de crearlo — usar `mcp__github__merge_pull_request` con `merge_method: "squash"` al rama `main`. El deploy a Firebase se dispara solo al mergear.

3. El deploy solo ocurre cuando se mergea a `main` via la GitHub Action "Deploy to Firebase on merge". Nunca queda código pendiente de deploy.

## Idioma

Responder siempre en **español** — en el chat, mensajes de commit y descripciones de PR.

## Integración con Kay

`functions/kay-api.js` (`kayApi`) es la API que usa Kay (asistente personal, repo `tugallo80/desarrollo-personal`).
Solo la invoca la cuenta de servicio de Kay (IAM + verificación en código). Para sumar una función: entrada nueva en
`ACCIONES`. Detalle en `docs/integracion-kay-trabajo.md`.

## Google Cloud desde la sesión de Claude

Las sesiones tienen la variable `GCP_SA_KEY_B64`: llave JSON en base64 de la cuenta de servicio
`claude-code@desarrollo-personal-a831d.iam.gserviceaccount.com` (la misma que usa `desarrollo-personal`).

```bash
S=<scratchpad de la sesión>            # NUNCA dentro del repo
echo "$GCP_SA_KEY_B64" | base64 -d > $S/sa.json && chmod 600 $S/sa.json
export CLOUDSDK_CONFIG=$S/gcloud
unset CLOUDSDK_AUTH_ACCESS_TOKEN       # si queda seteada, pisa a la cuenta de servicio
gcloud auth activate-service-account --key-file=$S/sa.json
P=rubik-bolivia
gcloud logging read 'resource.labels.service_name="kayapi"' --project=$P --limit=20   # logs de una Function
```

En `rubik-bolivia` tiene **solo lectura** (`tools/permisos-claude-code.sh`): logs, estado de Functions y
Cloud Run, y versiones de Hosting. **No** puede leer la base (pagos, clientes), el bucket de respaldos, los
usuarios de Auth ni los secretos, ni ver o cambiar IAM. Para comprobarlo: `bash tools/probar-permisos-claude-code.sh $S`.

Reglas:
- La llave nunca se commitea, ni se imprime, ni se copia dentro del repo.
- La cuenta no puede leer la política IAM: para saber si tiene un permiso, probar la operación.
- Cambios de IAM los hace el dueño en Cloud Shell, con script revisado antes (`tools/permisos-claude-code.sh`).
- Si hace falta un permiso nuevo, proponerlo y pedir aprobación; nunca roles de datos ni de administración de IAM.

## Proyecto

- Firebase Hosting + Cloud Functions Gen 2 (us-central1)
- Rama de desarrollo: `claude/mobile-project-setup-check-7itnug`
- Repo: `tugallo80/renzoderoma-`
- App live: rubikbolivia.com
