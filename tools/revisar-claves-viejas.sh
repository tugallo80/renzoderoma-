#!/usr/bin/env bash
# Revisa (y opcionalmente borra) claves viejas de Gemini y revisa el token de WhatsApp (Meta).
# Lo corre el dueño en Cloud Shell:  bash revisar-claves-viejas.sh [revisar|borrar]
#   revisar (por defecto): solo muestra. No cambia nada.
#   borrar: borra las claves de Gemini que NO son la que está en uso (pide confirmación).
# Nunca imprime una clave ni un token completo: solo los últimos 4 caracteres.
set -uo pipefail

PROYECTO="rubik-bolivia"
MODO="${1:-revisar}"
GEMINI_API="generativelanguage.googleapis.com"

fin4() { local v="$1"; echo "…${v: -4}"; }

# ── Gemini ────────────────────────────────────────────────────────────────────
EN_USO=$(gcloud secrets versions access latest --secret=GEMINI_API_KEY --project="$PROYECTO" 2>/dev/null)
if [ -z "$EN_USO" ]; then echo "❌ No pude leer el secreto GEMINI_API_KEY en $PROYECTO"; exit 1; fi
echo "== Gemini =="
echo "Clave en uso (secreto GEMINI_API_KEY): $(fin4 "$EN_USO")"
echo

# Las claves de AI Studio viven en proyectos "gen-lang-client-…"; por eso se revisan todos los proyectos.
A_BORRAR=()
for P in $(gcloud projects list --format="value(projectId)" 2>/dev/null); do
  CLAVES=$(gcloud services api-keys list --project="$P" \
    --format="value(name,displayName,createTime.date('%Y-%m-%d'),restrictions.apiTargets[].service.list())" 2>/dev/null) || continue
  [ -z "$CLAVES" ] && continue
  echo "Proyecto $P:"
  while IFS=$'\t' read -r NOMBRE DISPLAY CREADA SERVICIOS; do
    [ -z "$NOMBRE" ] && continue
    VALOR=$(gcloud services api-keys get-key-string "$NOMBRE" --format="value(keyString)" 2>/dev/null)
    ES_GEMINI=no
    if [[ "$SERVICIOS" == *"$GEMINI_API"* || "$P" == gen-lang-client-* || "$DISPLAY" =~ [Gg]emini|[Gg]enerative ]]; then ES_GEMINI=si; fi
    if [ "$VALOR" = "$EN_USO" ]; then ESTADO="✅ EN USO"
    elif [ "$ES_GEMINI" = si ]; then ESTADO="⚠️  VIEJA (Gemini, no se usa)"; A_BORRAR+=("$NOMBRE")
    else ESTADO="   otra clave (no es de Gemini, no se toca)"; fi
    printf "  %-34s %-8s creada %s  %s\n" "${DISPLAY:-(sin nombre)}" "$(fin4 "$VALOR")" "$CREADA" "$ESTADO"
  done <<< "$CLAVES"
done
echo
if [ ${#A_BORRAR[@]} -eq 0 ]; then
  echo "✅ No quedan claves viejas de Gemini."
elif [ "$MODO" = borrar ]; then
  read -r -p "¿Borrar ${#A_BORRAR[@]} clave(s) vieja(s) de Gemini? Escribí SI: " OK
  if [ "$OK" = SI ]; then
    for N in "${A_BORRAR[@]}"; do gcloud services api-keys delete "$N" --quiet && echo "  borrada $N"; done
  else echo "  No se borró nada."; fi
else
  echo "Hay ${#A_BORRAR[@]} clave(s) vieja(s). Para borrarlas: bash revisar-claves-viejas.sh borrar"
fi

# ── Meta (WhatsApp) ───────────────────────────────────────────────────────────
echo
echo "== Meta (WhatsApp) =="
WA=$(gcloud secrets versions access latest --secret=WHATSAPP_TOKEN --project="$PROYECTO" 2>/dev/null)
if [ -z "$WA" ]; then echo "❌ No pude leer el secreto WHATSAPP_TOKEN"; exit 1; fi
echo "Token en uso (secreto WHATSAPP_TOKEN): $(fin4 "$WA")"
curl -s -G "https://graph.facebook.com/v21.0/debug_token" \
  --data-urlencode "input_token=$WA" --data-urlencode "access_token=$WA" | python3 -c '
import sys, json, datetime
d = json.load(sys.stdin).get("data", {})
exp = d.get("expires_at", 0)
print("  válido:", "sí" if d.get("is_valid") else "NO")
print("  tipo:", d.get("type", "?"), "· app:", d.get("application", "?"))
print("  vence:", "nunca (token permanente)" if not exp else datetime.datetime.fromtimestamp(exp).strftime("%Y-%m-%d"))'
echo
echo "Meta no deja listar tokens viejos por API. Si el token viejo era temporal (24 h) ya venció."
echo "Si era de un usuario del sistema: Business Manager → Usuarios del sistema → Revocar tokens,"
echo "y después generá uno nuevo y actualizá el secreto WHATSAPP_TOKEN."
