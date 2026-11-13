#!/usr/bin/env bash
# Reglas de Firebase Storage del proyecto rubik-bolivia (no están en el repo: se manejan en la consola).
# Lo corre el dueño en Cloud Shell:
#   bash storage-reglas.sh revisar   → muestra las reglas actuales y avisa si hay reglas generales abiertas. No cambia nada.
#   bash storage-reglas.sh aplicar   → agrega el bloqueo de /agente y /requerimientos (solo las Functions los usan)
#                                      y publica las reglas nuevas. Imprime cómo volver atrás.
#   bash storage-reglas.sh volver <ruleset>  → vuelve a publicar un conjunto de reglas anterior.
set -euo pipefail

PROYECTO="rubik-bolivia"
BUCKET="rubik-bolivia.firebasestorage.app"
API="https://firebaserules.googleapis.com/v1"
RELEASE="projects/$PROYECTO/releases/firebase.storage/$BUCKET"
MODO="${1:-revisar}"

TOKEN="$(gcloud auth print-access-token)"
h=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "X-Goog-User-Project: $PROYECTO")

actual_ruleset() {
    curl -sf "${h[@]}" "$API/$RELEASE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["rulesetName"])'
}
contenido() {
    curl -sf "${h[@]}" "$API/$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["source"]["files"][0]["content"])'
}
publicar() {   # $1 = ruleset a publicar
    curl -sf -X PATCH "${h[@]}" "$API/$RELEASE" \
        -d "{\"release\":{\"name\":\"$RELEASE\",\"rulesetName\":\"$1\"}}" >/dev/null
}

case "$MODO" in
  revisar)
    RS="$(actual_ruleset)"
    echo "Reglas publicadas hoy en Storage ($BUCKET):"
    echo "  conjunto: $RS"
    echo "------------------------------------------------------------"
    contenido "$RS"
    echo "------------------------------------------------------------"
    C="$(contenido "$RS")"
    if echo "$C" | grep -qE 'match /requerimientos/'; then echo "✅ Ya tiene la regla de /requerimientos"; else echo "⏳ Falta la regla de /requerimientos"; fi
    if echo "$C" | grep -qE 'match /agente/';         then echo "✅ Ya tiene la regla de /agente";         else echo "⏳ Falta la regla de /agente"; fi
    if echo "$C" | grep -qE 'match /\{[a-zA-Z]+=\*\*\}'; then
      echo "⚠️  Hay una regla general (match /{…=**}). En Firebase las reglas se SUMAN: si esa regla permite leer,"
      echo "    el bloqueo de /agente y /requerimientos no alcanza. Mandale esta salida a Claude antes de aplicar."
    fi
    ;;
  aplicar)
    RS="$(actual_ruleset)"
    C="$(contenido "$RS")"
    NUEVO="$(python3 - "$C" <<'PY'
import sys, re
c = sys.argv[1]
bloques = []
if not re.search(r'match /agente/', c):
    bloques.append("    // Archivos del Agente IA: solo las Functions (cuenta de servicio) los usan\n    match /agente/{todo=**} { allow read, write: if false; }")
if not re.search(r'match /requerimientos/', c):
    bloques.append("    // Archivos de los requerimientos: solo las Functions los usan\n    match /requerimientos/{todo=**} { allow read, write: if false; }")
if not bloques:
    print("SIN_CAMBIOS"); sys.exit(0)
m = re.search(r'match\s+/b/\{[^}]+\}/o\s*\{', c)
if not m:
    print("NO_ENCONTRE"); sys.exit(0)
print(c[:m.end()] + "\n" + "\n".join(bloques) + "\n" + c[m.end():])
PY
)"
    if [ "$NUEVO" = "SIN_CAMBIOS" ]; then echo "✅ Ya estaban las dos reglas. No cambié nada."; exit 0; fi
    if [ "$NUEVO" = "NO_ENCONTRE" ]; then echo "❌ No encontré el bloque 'match /b/{bucket}/o {'. No cambié nada: mandale la salida de 'revisar' a Claude."; exit 1; fi
    echo "Reglas nuevas:"; echo "------------------------------------------------------------"; echo "$NUEVO"; echo "------------------------------------------------------------"
    read -r -p "¿Publico estas reglas? Escribí SI: " OK
    [ "$OK" = "SI" ] || { echo "No se publicó nada."; exit 0; }
    CUERPO="$(python3 -c 'import json,sys; print(json.dumps({"source":{"files":[{"name":"storage.rules","content":sys.argv[1]}]}}))' "$NUEVO")"
    NRS="$(curl -sf -X POST "${h[@]}" "$API/projects/$PROYECTO/rulesets" -d "$CUERPO" | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')"
    publicar "$NRS"
    echo "✅ Publicado: $NRS"
    echo "Para volver atrás:  bash storage-reglas.sh volver $RS"
    ;;
  volver)
    [ -n "${2:-}" ] || { echo "Uso: bash storage-reglas.sh volver projects/$PROYECTO/rulesets/<id>"; exit 2; }
    publicar "$2"; echo "✅ Vuelto a: $2"
    ;;
  *) echo "Uso: bash storage-reglas.sh [revisar|aplicar|volver <ruleset>]"; exit 2 ;;
esac
