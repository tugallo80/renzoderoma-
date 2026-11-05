#!/usr/bin/env bash
# Permisos mínimos de la cuenta claude-code en el proyecto rubik-bolivia.
# Lo corre el dueño en Cloud Shell:  bash permisos-claude-code.sh [revisar|aplicar|quitar]
#   revisar (por defecto): solo muestra los roles actuales de la cuenta. No cambia nada.
#   aplicar: agrega los roles de solo lectura de abajo y vuelve a revisar.
#   quitar:  saca esos mismos roles (volver atrás).
# Para probar los permisos desde una sesión de Claude: tools/probar-permisos-claude-code.sh
set -euo pipefail

PROYECTO="rubik-bolivia"
CUENTA="claude-code@desarrollo-personal-a831d.iam.gserviceaccount.com"
MIEMBRO="serviceAccount:$CUENTA"
MODO="${1:-revisar}"

# Roles de solo lectura: ver logs, estado de Functions/Cloud Run y versiones de Hosting.
ROLES=(
  roles/logging.viewer                     # logs de Functions (no incluye logs privados ni de acceso a datos)
  roles/cloudfunctions.viewer              # lista y estado de las Functions
  roles/run.viewer                         # estado de los servicios Cloud Run (Functions Gen 2)
  roles/firebasehosting.viewer             # versiones y archivos publicados en Hosting
  roles/serviceusage.serviceUsageConsumer  # poder usar las APIs de este proyecto (no da acceso a datos)
)

# Roles que NO debe tener nunca: administración de IAM o acceso a datos (pagos, clientes, respaldos, usuarios, secretos).
PROHIBIDOS='roles/(owner|editor|viewer|firebase\.|firebasedatabase\.|firebaseauth\.|storage\.|secretmanager\.|iam\.|resourcemanager\.|datastore\.|cloudfunctions\.(admin|developer)|run\.(admin|developer)|firebasehosting\.admin)'

revisar() {
  echo "Cuenta: $CUENTA"
  echo "Roles actuales en $PROYECTO:"
  ACTUALES=$(gcloud projects get-iam-policy "$PROYECTO" --flatten="bindings[].members" \
    --filter="bindings.members:$MIEMBRO" --format="value(bindings.role)" | sort)
  if [ -z "$ACTUALES" ]; then echo "  (ninguno)"; else echo "$ACTUALES" | sed 's/^/  /'; fi
  MALOS=$(echo "$ACTUALES" | grep -E "^$PROHIBIDOS" || true)
  if [ -n "$MALOS" ]; then
    echo "⚠️  Tiene roles que NO debería tener (sacalos a mano y avisame):"; echo "$MALOS" | sed 's/^/  /'
  else
    echo "✅ Sin roles de administración de IAM ni de acceso a datos."
  fi
}

case "$MODO" in
  revisar) revisar ;;
  aplicar)
    for R in "${ROLES[@]}"; do
      gcloud projects add-iam-policy-binding "$PROYECTO" --member="$MIEMBRO" --role="$R" \
        --condition=None --format=none && echo "+ $R"
    done
    revisar ;;
  quitar)
    for R in "${ROLES[@]}"; do
      gcloud projects remove-iam-policy-binding "$PROYECTO" --member="$MIEMBRO" --role="$R" \
        --condition=None --format=none 2>/dev/null && echo "- $R" || echo "  (no tenía $R)"
    done
    revisar ;;
  *) echo "Uso: bash permisos-claude-code.sh [revisar|aplicar|quitar]"; exit 2 ;;
esac
