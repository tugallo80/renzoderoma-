/**
 * Etapa (estado) del proyecto — una sola operación para la app, Kay y Claude (Sesión 9): cambia proyectos/{cid}/{pid}/estado
 * y deja historial antes → después (historial_operaciones). Idempotente.
 *   cambiar_estado {cid, pid, estado, motivo?, idempotencia}
 */
const C = require("../operaciones/comun");

// Ciclo del proyecto (el mismo de proyectos-cliente.html, el inicio, el panel y Kay)
const ESTADOS = ["requerimiento", "cotizacion", "propuesta_enviada", "negociando", "contrato_firmado", "planificacion",
    "produccion", "entregado", "cerrado", "cancelado"];

async function cambiarEstado(almacen, b, quien) {
    const cid = C.id(b.cid, "Cliente"), pid = C.id(b.pid, "Proyecto");
    const estado = String(b.estado || "").trim();
    if (!ESTADOS.includes(estado)) C.falla(`Estado inválido. Usá uno de: ${ESTADOS.join(", ")}.`);
    const motivo = C.texto(b.motivo, 300) || null;
    return C.unaVez(almacen, b.idempotencia, async () => {
        const base = `proyectos/${cid}/${pid}`;
        const nombre = await almacen.leer(`${base}/nombre`);
        if (nombre == null) C.falla("No existe el proyecto.", 404);
        const antes = (await almacen.leer(`${base}/estado`)) || null;
        if (antes === estado) return { ok: true, cid, pid, proyecto: nombre, estado, sin_cambios: true };
        const m = { [`${base}/estado`]: estado, [`${base}/estado_cambiado`]: { fecha: almacen.ahora(), antes, por: quien } };
        const [hk, hv] = C.entradaHistorial(almacen, cid, pid, { area: "proyecto", op: "cambiar_estado", antes: { estado: antes }, despues: { estado }, motivo, quien });
        m[hk] = hv;
        await almacen.actualizarVarios(m);
        return { ok: true, cid, pid, proyecto: nombre, antes, estado };
    });
}

module.exports = { cambiarEstado, ESTADOS };
