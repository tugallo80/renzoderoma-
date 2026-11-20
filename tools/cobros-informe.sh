#!/usr/bin/env bash
# Informe de cobros — SOLO LECTURA (Sesión 9, unificación de cobros). Lo corre el dueño en Cloud Shell:
#   bash cobros-informe.sh
# Cruza los tres lugares donde hoy se registran cobros y facturas de venta, sin cambiar nada:
#   1) proyectos/{cid}/{pid}/pagos              (panel del proyecto y Tesorería → "pagos del cliente")
#   2) proyectos/{cid}/{pid}/facturas_emitidas  (panel del proyecto → facturas escaneadas)
#   3) /ingresos                                (Tesorería → facturas de venta; el proyecto va por NOMBRE)
# Muestra por cliente y proyecto qué hay en cada lado y marca posibles repetidos. Guarda el detalle en
# ~/informe-cobros-<fecha>.json (queda en tu Cloud Shell; no se manda a ningún lado).
set -euo pipefail
DB="https://rubik-bolivia-default-rtdb.firebaseio.com"
TOKEN="$(gcloud auth print-access-token)"
SALIDA="$HOME/informe-cobros-$(date +%Y-%m-%d).json"

python3 - "$DB" "$TOKEN" "$SALIDA" <<'PY'
import json, sys, urllib.request, urllib.parse, unicodedata, datetime
DB, TOKEN, SALIDA = sys.argv[1:4]

def leer(ruta, shallow=False):
    q = {"access_token": TOKEN}
    if shallow: q["shallow"] = "true"
    url = f"{DB}/{urllib.parse.quote(ruta)}.json?{urllib.parse.urlencode(q)}"
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            sys.exit("❌ Sin permiso para leer la base con tu cuenta (HTTP %d). Corré esto desde Cloud Shell con la cuenta dueña del proyecto." % e.code)
        raise

def num(x):
    try: return round(float(str(x).replace(",", ".")), 2)
    except Exception: return 0.0
def norm(t):
    t = unicodedata.normalize("NFD", str(t or "")).encode("ascii", "ignore").decode().lower()
    return " ".join(t.split())
def fecha(x):
    s = str(x or "")[:10]
    try: return datetime.date.fromisoformat(s)
    except Exception: return None
def bs(n): return f"{n:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + " Bs"

clientes = leer("clientes") or {}
nom_cli = {cid: (c or {}).get("empresa") or (c or {}).get("nombre") or cid for cid, c in clientes.items() if isinstance(c, dict)}
cids = list((leer("proyectos", shallow=True) or {}).keys())
proyectos = {}
for cid in cids:
    pids = list((leer(f"proyectos/{cid}", shallow=True) or {}).keys())
    for pid in pids:
        base = leer(f"proyectos/{cid}/{pid}", shallow=True) or {}
        if not isinstance(base, dict): continue
        proyectos[(cid, pid)] = {
            "nombre": base.get("nombre") if isinstance(base.get("nombre"), str) else pid,
            "estado": base.get("estado") if isinstance(base.get("estado"), str) else None,
            "pagos": (leer(f"proyectos/{cid}/{pid}/pagos") or {}) if base.get("pagos") else {},
            "facturas": (leer(f"proyectos/{cid}/{pid}/facturas_emitidas") or {}) if base.get("facturas_emitidas") else {},
        }
ingresos = leer("ingresos") or {}

por_nombre = {}
for k, p in proyectos.items(): por_nombre.setdefault(norm(p["nombre"]), []).append(k)

informe = {"proyectos": [], "ingresos_sin_proyecto": [], "ingresos_ambiguos": [], "posibles_repetidos": []}
ing_de = {}
for iid, i in ingresos.items():
    if not isinstance(i, dict): continue
    cand = por_nombre.get(norm(i.get("proyecto")), [])
    fila = {"id": iid, "proyecto": i.get("proyecto"), "monto": num(i.get("monto")), "fecha": i.get("fecha"), "nro_factura": i.get("nro_factura"),
            "nit": i.get("nit"), "cliente_rs": i.get("cliente_rs"), "estado_cobro": i.get("estado_cobro"), "fecha_cobro": i.get("fecha_cobro")}
    if len(cand) == 1: ing_de.setdefault(cand[0], []).append(fila)
    elif len(cand) > 1: informe["ingresos_ambiguos"].append(dict(fila, coinciden=[f"{nom_cli.get(c, c)} / {proyectos[(c, p)]['nombre']}" for c, p in cand]))
    else: informe["ingresos_sin_proyecto"].append(fila)

tot = {"pagos": 0, "n_pagos": 0, "facturas": 0, "n_facturas": 0, "ingresos": 0, "n_ingresos": 0, "cobrado_ing": 0}
for (cid, pid), p in sorted(proyectos.items(), key=lambda kv: (nom_cli.get(kv[0][0], ""), kv[1]["nombre"])):
    pagos = [dict(id=k, monto=num(v.get("monto")), fecha=v.get("fecha"), nota=v.get("nota") or v.get("concepto")) for k, v in (p["pagos"] or {}).items() if isinstance(v, dict)]
    facts = [dict(id=k, monto=num(v.get("monto")), fecha=v.get("fecha"), nro_factura=v.get("nro_factura"), nit=v.get("nit_cliente")) for k, v in (p["facturas"] or {}).items() if isinstance(v, dict)]
    ings = ing_de.get((cid, pid), [])
    if not (pagos or facts or ings): continue
    # repetidos: misma factura en el proyecto y en Tesorería; pago del proyecto ≈ cobro de Tesorería (mismo monto, ±3 días)
    for f in facts:
        for i in ings:
            if f["nro_factura"] and str(f["nro_factura"]).strip() == str(i["nro_factura"] or "").strip():
                informe["posibles_repetidos"].append({"tipo": "factura en el proyecto y en Tesorería", "cliente": nom_cli.get(cid, cid), "proyecto": p["nombre"], "nro_factura": f["nro_factura"], "monto_proyecto": f["monto"], "monto_tesoreria": i["monto"]})
    for pg in pagos:
        for i in ings:
            if i["estado_cobro"] != "cobrado": continue
            fp, fi = fecha(pg["fecha"]), fecha(i["fecha_cobro"] or i["fecha"])
            if abs(pg["monto"] - i["monto"]) < 0.01 and fp and fi and abs((fp - fi).days) <= 3:
                informe["posibles_repetidos"].append({"tipo": "pago del proyecto = cobro en Tesorería", "cliente": nom_cli.get(cid, cid), "proyecto": p["nombre"], "monto": pg["monto"], "fecha_pago": pg["fecha"], "fecha_cobro": i["fecha_cobro"] or i["fecha"], "factura": i["nro_factura"]})
    fila = {"cliente": nom_cli.get(cid, cid), "proyecto": p["nombre"], "estado": p["estado"], "cid": cid, "pid": pid,
            "pagos": {"n": len(pagos), "total": round(sum(x["monto"] for x in pagos), 2), "detalle": pagos},
            "facturas_proyecto": {"n": len(facts), "total": round(sum(x["monto"] for x in facts), 2), "detalle": facts},
            "ingresos_tesoreria": {"n": len(ings), "total": round(sum(x["monto"] for x in ings), 2), "cobrado": round(sum(x["monto"] for x in ings if x["estado_cobro"] == "cobrado"), 2), "detalle": ings}}
    informe["proyectos"].append(fila)
    tot["pagos"] += fila["pagos"]["total"]; tot["n_pagos"] += len(pagos)
    tot["facturas"] += fila["facturas_proyecto"]["total"]; tot["n_facturas"] += len(facts)
    tot["ingresos"] += fila["ingresos_tesoreria"]["total"]; tot["n_ingresos"] += len(ings); tot["cobrado_ing"] += fila["ingresos_tesoreria"]["cobrado"]

# pagos del mismo cliente el mismo día en varios proyectos (un pago que cubre varios proyectos)
grupos = {}
for f in informe["proyectos"]:
    for pg in f["pagos"]["detalle"]:
        grupos.setdefault((f["cliente"], str(pg["fecha"])[:10]), []).append((f["proyecto"], pg["monto"]))
informe["pagos_mismo_dia_varios_proyectos"] = [{"cliente": c, "fecha": d, "proyectos": v} for (c, d), v in grupos.items() if len({x[0] for x in v}) > 1]

with open(SALIDA, "w") as fh: json.dump(informe, fh, ensure_ascii=False, indent=1)

print("══════════════════ INFORME DE COBROS (solo lectura) ══════════════════")
print(f"Pagos del cliente en los proyectos:   {tot['n_pagos']:>4}  · {bs(tot['pagos'])}")
print(f"Facturas emitidas en los proyectos:   {tot['n_facturas']:>4}  · {bs(tot['facturas'])}")
print(f"Facturas de venta en Tesorería:       {tot['n_ingresos']:>4}  · {bs(tot['ingresos'])} (cobrado {bs(tot['cobrado_ing'])})")
print(f"Tesorería sin proyecto reconocible:   {len(informe['ingresos_sin_proyecto']):>4}   · con nombre repetido: {len(informe['ingresos_ambiguos'])}")
print(f"Posibles repetidos:                   {len(informe['posibles_repetidos']):>4}")
print(f"Pagos el mismo día en varios proyectos del mismo cliente: {len(informe['pagos_mismo_dia_varios_proyectos'])}")
print("──────────────────────────────────────────────────────────────────────")
for f in informe["proyectos"]:
    print(f"{f['cliente'][:22]:<22} · {f['proyecto'][:30]:<30} pagos {f['pagos']['n']:>2} {bs(f['pagos']['total']):>16} │ fact.proy {f['facturas_proyecto']['n']:>2} │ Tesorería {f['ingresos_tesoreria']['n']:>2} {bs(f['ingresos_tesoreria']['total']):>16}")
if informe["posibles_repetidos"]:
    print("────────────────────────── POSIBLES REPETIDOS ─────────────────────────")
    for r in informe["posibles_repetidos"]: print(" ·", json.dumps(r, ensure_ascii=False))
if informe["ingresos_sin_proyecto"]:
    print("──────────────── TESORERÍA SIN PROYECTO RECONOCIBLE (primeros 20) ─────────────")
    for r in informe["ingresos_sin_proyecto"][:20]: print(f" · {r['proyecto']!s:<30} {bs(r['monto']):>16}  fact. {r['nro_factura']}  {r['fecha']}")
print("──────────────────────────────────────────────────────────────────────")
print(f"✅ Listo. Detalle completo en {SALIDA} (no se cambió nada en la base).")
PY
