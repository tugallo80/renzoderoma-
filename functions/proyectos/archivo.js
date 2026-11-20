/**
 * Archivar proyectos viejos (Sesión 9): para arrancar limpio sin borrar nada.
 *
 * Un proyecto archivado queda con `archivado: true` y `archivado_info {fecha, por, motivo}`; su etapa (`estado`) NO cambia,
 * así al desarchivar vuelve tal cual. Se deja de ver en: la lista del cliente (salvo el chip "Archivados"), Tesorería
 * (balances, contratos, estado de cuenta), el inicio, el contexto de Kay y listar_proyectos del conector.
 * No toca los registros fiscales (/ingresos, compras): siguen en Impuestos.
 *
 *   archivar    {proyectos: [{cid, pid}], motivo?, idempotencia}  → {archivados, ya_estaban}
 *   desarchivar {proyectos: [{cid, pid}], idempotencia}           → {desarchivados, no_estaban}
 * Varios a la vez (hasta 500) en UNA escritura, con una entrada en el historial de cada proyecto.
 */
const C = require("../operaciones/comun");

const MAX = 500;

async function existe(almacen, base) {
    const [nombre, estado] = await Promise.all([almacen.leer(`${base}/nombre`), almacen.leer(`${base}/estado`)]);
    if (nombre != null || estado != null) return true;
    // nodos sin nombre (quedaron a medias): se pueden archivar si tienen algo
    const [pagos, facts, pres] = await Promise.all([almacen.leer(`${base}/pagos`), almacen.leer(`${base}/facturas_emitidas`), almacen.leer(`${base}/presupuesto`)]);
    return pagos != null || facts != null || pres != null;
}

function lista(proyectos) {
    if (!Array.isArray(proyectos) || !proyectos.length) C.falla("Elegí al menos un proyecto.");
    if (proyectos.length > MAX) C.falla(`Máximo ${MAX} proyectos por vez.`);
    const vistos = new Set();
    return proyectos.map((p) => ({ cid: C.id(p && p.cid, "Cliente"), pid: C.id(p && p.pid, "Proyecto") }))
        .filter((p) => { const k = p.cid + "/" + p.pid; if (vistos.has(k)) return false; vistos.add(k); return true; });
}

async function cambiar(almacen, b, quien, archivar) {
    const ps = lista(b.proyectos);
    const motivo = C.texto(b.motivo, 200) || null;
    return C.unaVez(almacen, b.idempotencia, async () => {
        const estados = await Promise.all(ps.map(async (p) => {
            const base = `proyectos/${p.cid}/${p.pid}`;
            if (!(await existe(almacen, base))) C.falla(`No existe el proyecto ${p.cid}/${p.pid}.`, 404);
            return { p, base, ya: (await almacen.leer(`${base}/archivado`)) === true };
        }));
        const mapa = {}; const hechos = []; const sinCambio = [];
        const fecha = almacen.ahora();
        estados.forEach(({ p, base, ya }) => {
            if (ya === archivar) { sinCambio.push(p); return; }
            mapa[`${base}/archivado`] = archivar ? true : null;
            mapa[`${base}/archivado_info`] = archivar ? { fecha, por: quien, motivo } : null;
            const [ruta, val] = C.entradaHistorial(almacen, p.cid, p.pid, {
                area: "proyecto", op: archivar ? "archivar" : "desarchivar", antes: { archivado: ya }, despues: { archivado: archivar }, motivo, quien,
            });
            mapa[ruta] = val;
            hechos.push(p);
        });
        if (hechos.length) await almacen.actualizarVarios(mapa);
        return archivar ? { archivados: hechos.length, ya_estaban: sinCambio.length } : { desarchivados: hechos.length, no_estaban: sinCambio.length };
    });
}

const archivar = (almacen, b, quien) => cambiar(almacen, b, quien, true);
const desarchivar = (almacen, b, quien) => cambiar(almacen, b, quien, false);

module.exports = { archivar, desarchivar, MAX, RUTAS: [/^operaciones_idem\/[a-f0-9]{40}$/] };
