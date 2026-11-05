#!/usr/bin/env bash
# Prueba, desde una sesión de Claude, los permisos de claude-code en rubik-bolivia (solo lecturas).
# Uso: bash tools/probar-permisos-claude-code.sh <scratchpad>   (la llave se escribe ahí, nunca en el repo)
S="${1:?Pasá el scratchpad de la sesión}"
[ -f $S/sa.json ] || { echo "$GCP_SA_KEY_B64" | base64 -d > $S/sa.json; chmod 600 $S/sa.json; }
export CLOUDSDK_CONFIG=$S/gcloud; unset CLOUDSDK_AUTH_ACCESS_TOKEN
gcloud auth list --format="value(account)" 2>/dev/null | grep -q claude-code || gcloud auth activate-service-account --key-file=$S/sa.json -q 2>&1 | tail -1
P=rubik-bolivia; T=$(gcloud auth print-access-token)
r() { printf "%-48s" "$1"; shift; out=$("$@" 2>&1); c=$?; if [ $c -eq 0 ]; then echo "PERMITIDO  $(echo "$out" | head -1 | cut -c1-60)"; else echo "DENEGADO   $(echo "$out" | grep -oE 'PERMISSION_DENIED|403|401|denied|does not have|Permission' | head -1)"; fi; }
h() { code=$(curl -s -o $S/resp -w '%{http_code}' -H "Authorization: Bearer $T" -H "x-goog-user-project: $P" "$1"); [ "$code" = 200 ] && echo ok || { echo "HTTP $code" >&2; return 1; }; }
echo "== Debería quedar PERMITIDO después de aplicar =="
r "Logs de kayApi"            gcloud logging read 'resource.labels.service_name="kayapi"' --project=$P --limit=1 --freshness=30d --format="value(timestamp)"
r "Lista de Functions"        gcloud functions list --project=$P --format="value(name)"
r "Servicios Cloud Run"       gcloud run services list --project=$P --region=us-central1 --format="value(metadata.name)"
r "Versiones de Hosting"      h "https://firebasehosting.googleapis.com/v1beta1/sites/rubik-bolivia/releases?pageSize=1"
echo "== Debe seguir DENEGADO siempre =="
r "Leer la base (/acceso, shallow)" h "https://rubik-bolivia-default-rtdb.firebaseio.com/acceso.json?shallow=true&access_token=$T"
r "Listar bucket de respaldos" gcloud storage ls gs://rubik-bolivia-default-rtdb-backups --project=$P
r "Listar usuarios de Auth"   h "https://identitytoolkit.googleapis.com/v1/projects/$P/accounts:batchGet?maxResults=1"
r "Leer secreto GEMINI_API_KEY" gcloud secrets versions access latest --secret=GEMINI_API_KEY --project=$P
r "Ver política IAM"          gcloud projects get-iam-policy $P --format="value(etag)"
