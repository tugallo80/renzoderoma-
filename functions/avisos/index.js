/**
 * Avisos de Rubik para Kay → el dueño los recibe por WhatsApp (decisión del dueño: WhatsApp para TODAS las notificaciones).
 *
 * Buzón /avisos_kay/{id} (solo Functions; la app no lo lee ni escribe):
 *   {tipo, texto, datos, creado, entregado: false, entregado_en?}
 * Cada módulo que necesita avisar agrega la entrada en la MISMA escritura que el cambio (entrada()), y después llama a
 * empujar(): si Kay registró su URL (kayApi → avisos_configurar), se le manda un POST con un token de identidad de Google
 * de estas Functions (audience = esa URL) para que avise al instante. Si falla o no hay URL, Kay los pide con
 * avisos_pendientes y confirma con avisos_confirmar: nunca se pierde uno.
 *
 * Tipos (se irán sumando):
 *   rendicion_por_aprobar  {worker_id, nombre, gasto_id, monto, concepto, proyecto, cid, pid, renglones, con_recibo, con_factura, via}
 */
const RUTAS = [/^avisos_kay(\/|$)/, /^config\/kay_avisos$/];
const URL_OK = /^https:\/\/[a-z0-9.-]+\.(run\.app|cloudfunctions\.net)(\/[A-Za-z0-9._~\/-]*)?$/;

function entrada(almacen, { tipo, texto, datos }) {
    const k = almacen.nuevaClave();
    return [`avisos_kay/${k}`, { tipo, texto: String(texto || "").slice(0, 1000), datos: JSON.parse(JSON.stringify(datos || {})), creado: almacen.ahora(), entregado: false }];
}

async function pendientes(almacen, b) {
    const limite = Math.min(Math.max(parseInt(b && b.limite, 10) || 20, 1), 100);
    const todos = (await almacen.leer("avisos_kay")) || {};
    const lista = Object.entries(todos).filter(([, a]) => a && !a.entregado)
        .sort((a, z) => (a[1].creado || 0) - (z[1].creado || 0)).slice(0, limite)
        .map(([id, a]) => ({ id, tipo: a.tipo, texto: a.texto, datos: a.datos || {}, creado: new Date(a.creado).toISOString() }));
    return { avisos: lista, quedan: Object.values(todos).filter((a) => a && !a.entregado).length };
}

async function confirmar(almacen, b) {
    const ids = Array.isArray(b && b.ids) ? b.ids.filter((x) => /^[A-Za-z0-9_-]{1,64}$/.test(String(x))).slice(0, 100) : [];
    if (!ids.length) return { ok: true, confirmados: 0 };
    const m = {};
    for (const id of ids) {
        if (await almacen.leer(`avisos_kay/${id}/tipo`)) { m[`avisos_kay/${id}/entregado`] = true; m[`avisos_kay/${id}/entregado_en`] = almacen.ahora(); }
    }
    if (Object.keys(m).length) await almacen.actualizarVarios(m);
    return { ok: true, confirmados: Object.keys(m).length / 2 };
}

async function configurar(almacen, b) {
    const url = String((b && b.url) || "").trim();
    if (url && !URL_OK.test(url)) throw Object.assign(new Error("La URL tiene que ser https de Cloud Run o Cloud Functions."), { status: 400 });
    await almacen.escribir("config/kay_avisos", url ? { url, actualizado: almacen.ahora() } : null);
    return { ok: true, url: url || null };
}

/** Token de identidad de Google de la cuenta de estas Functions, para la URL de Kay (servidor de metadatos). */
async function tokenIdentidad(audience) {
    const u = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?format=full&audience=" + encodeURIComponent(audience);
    const r = await fetch(u, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error("metadatos " + r.status);
    return r.text();
}

/** Le avisa a Kay que hay avisos nuevos (con los pendientes en el cuerpo). Nunca tira error: si falla, Kay los pide después. */
async function empujar(almacen, opciones) {
    try {
        const cfg = await almacen.leer("config/kay_avisos");
        if (!cfg || !cfg.url || !URL_OK.test(cfg.url)) return { empujado: false, motivo: "sin URL de Kay" };
        const { avisos } = await pendientes(almacen, { limite: 20 });
        if (!avisos.length) return { empujado: false, motivo: "nada pendiente" };
        const token = await ((opciones && opciones.tokenIdentidad) || tokenIdentidad)(cfg.url);
        const enviar = (opciones && opciones.fetch) || fetch;
        const r = await enviar(cfg.url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
            body: JSON.stringify({ origen: "rubik", avisos }), signal: AbortSignal.timeout(5000) });
        return { empujado: r.ok, status: r.status };
    } catch (e) {
        console.warn("[avisos] no se pudo empujar a Kay:", e.message);
        return { empujado: false, motivo: e.message };
    }
}

module.exports = { RUTAS, entrada, pendientes, confirmar, configurar, empujar, URL_OK };
