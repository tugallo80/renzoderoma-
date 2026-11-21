/**
 * Base común de las operaciones de servidor por área (licitaciones, gantt, producción, diseño), como compras:
 *   - quién: registrado_por {uid?, rol, nombre, telefono?, via} (lo pone el servidor o Kay, nunca la pantalla)
 *   - idempotencia: /operaciones_idem/{sha256} — reintentar con la misma clave devuelve el mismo resultado
 *   - historial: /proyectos/{cid}/{pid}/historial_operaciones/{id} {area, ref, op, antes, despues, motivo, por, fecha}
 * Ojo (Admin SDK): la primera pasada de una transacción ve el valor LOCAL (vacío). Nunca devolver undefined ante null
 * si el servidor puede tener un valor: se cancela sin preguntar (ver docs/sesiones/07-compras.md).
 */
const crypto = require("crypto");

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const VIAS = ["app", "whatsapp", "claude", "agente", "migracion", "link"];   // link: mini app sin login (rendir.html)
const EN_CURSO_MS = 2 * 60000;

class ErrorPedido extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }
const falla = (m, s) => { throw new ErrorPedido(m, s); };

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const texto = (t, max) => String(t == null ? "" : t).replace(/\s+/g, " ").trim().slice(0, max);
function numero(x, que, { min = 0, cero = false } = {}) {
    const n = typeof x === "string" ? parseFloat(x.replace(/\s/g, "").replace(",", ".")) : Number(x);
    if (!isFinite(n) || n < min || (!cero && n === 0)) falla(`${que} inválido.`);
    return r2(n);
}
const hoyBolivia = (ms) => new Date((ms || Date.now()) - 4 * 3600 * 1000).toISOString().slice(0, 10);
function fecha(f, que, ahora) {
    if (f == null || f === "") return hoyBolivia(ahora);
    const t = String(f).trim().slice(0, 10);
    if (!FECHA.test(t) || isNaN(Date.parse(t))) falla(`${que} inválida (AAAA-MM-DD).`);
    return t;
}
function id(x, que) { if (!ID.test(String(x || ""))) falla(`${que} inválido.`); return String(x); }

function limpiarQuien(q, viaPorDefecto) {
    const via = VIAS.includes(q && q.via) ? q.via : (viaPorDefecto || "app");
    return { uid: q && q.uid ? String(q.uid).slice(0, 128) : null, rol: texto(q && q.rol, 30) || "dueño", nombre: texto(q && q.nombre, 80) || null,
        telefono: q && q.telefono ? texto(q.telefono, 20) : null, via };
}

/** Comprobante (foto o PDF) en base64: {buf, ext, mime}. */
function leerComprobante(foto, max = 8 * 1024 * 1024) {
    if (foto == null) return null;
    const datos = String((foto && foto.datos_base64) || "").replace(/^data:[^,]*,/, "");
    if (!datos) falla("El comprobante está vacío.");
    const buf = Buffer.from(datos, "base64");
    if (!buf.length) falla("El comprobante está vacío.");
    if (buf.length > max) falla("El comprobante pesa más de 8 MB.", 413);
    const ext = buf[0] === 0xff && buf[1] === 0xd8 ? "jpg" : buf[0] === 0x89 && buf[1] === 0x50 ? "png"
        : buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP" ? "webp"
        : buf.slice(0, 5).toString() === "%PDF-" ? "pdf" : null;
    if (!ext) falla("El comprobante tiene que ser JPG, PNG, WEBP o PDF.");
    return { buf, ext, mime: ext === "jpg" ? "image/jpeg" : ext === "pdf" ? "application/pdf" : "image/" + ext };
}

/**
 * Corre fn() una sola vez por clave de idempotencia. Reintentos: devuelven el resultado guardado ({..., repetida: true}).
 * Si otro pedido con la misma clave sigue en curso (< 2 min), 409; si quedó colgado, se toma.
 */
async function unaVez(almacen, clave, fn) {
    const c = texto(clave, 200);
    if (c.length < 6) falla("Falta la clave de idempotencia (identifica el pedido para no repetirlo).");
    const k = crypto.createHash("sha256").update(c).digest("hex").slice(0, 40);
    const ruta = `operaciones_idem/${k}`;
    const ahora = almacen.ahora();
    const t = await almacen.transaccion(ruta, (v) => (v && !(v.estado === "en_curso" && ahora - (v.creado || 0) > EN_CURSO_MS) ? undefined : { estado: "en_curso", creado: ahora }));
    if (!t.ok) {
        const v = t.valor || {};
        if (v.estado === "listo") return Object.assign({}, v.resultado || {}, { repetida: true });
        falla("Ese pedido se está procesando; reintentá en un momento.", 409);
    }
    try {
        const r = await fn();
        await almacen.escribir(ruta, { estado: "listo", creado: ahora, fin: almacen.ahora(), resultado: JSON.parse(JSON.stringify(r || {})) });
        return r;
    } catch (e) {
        await almacen.borrar(ruta).catch(() => {});   // falló sin escribir: se puede reintentar con la misma clave
        throw e;
    }
}

/** Entrada del historial del proyecto (para agregar a una escritura de varias rutas). */
function entradaHistorial(almacen, cid, pid, { area, ref, op, antes, despues, motivo, quien }) {
    const k = almacen.nuevaClave();
    const limpio = (o) => (o === undefined ? null : JSON.parse(JSON.stringify(o)));
    return [`proyectos/${cid}/${pid}/historial_operaciones/${k}`, {
        area, ref: ref || null, op, antes: limpio(antes), despues: limpio(despues), motivo: motivo || null, por: quien, fecha: almacen.ahora(),
    }];
}

/** Envoltorio de atender(): ErrorPedido → {status, error}; el resto, 500 sin detalle. */
async function responder(nombre, fn) {
    try { return { status: 200, cuerpo: await fn() }; }
    catch (e) {
        if (e instanceof ErrorPedido) return { status: e.status, cuerpo: { error: e.message } };
        console.error(`[${nombre}]`, e);
        return { status: 500, cuerpo: { error: "Error interno." } };
    }
}

module.exports = { ID, ErrorPedido, falla, r2, texto, numero, fecha, id, hoyBolivia, limpiarQuien, leerComprobante, unaVez, entradaHistorial, responder };
