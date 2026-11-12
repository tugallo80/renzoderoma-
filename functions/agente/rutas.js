/**
 * Rutas del agente en RTDB. Varias conversaciones por proyecto:
 *   proyecto:      proyectos/{cid}/{pid}/agente/            adjuntos, estado (un turno a la vez por proyecto), detener,
 *                                                           actual (conversación abierta), conversaciones_meta/{conv}
 *   conversación:  "principal" = las rutas de siempre (agente/conversacion, agente/borrador, agente/costos, …): así la
 *                  conversación que ya existía en cada proyecto queda como la primera, sin migrar datos.
 *                  Las nuevas: agente/conversaciones/{conv}/conversacion, /borrador, /costos, /rondas_preguntas
 */
const PRINCIPAL = "principal";
const ID_CONV = /^[A-Za-z0-9_-]{1,64}$/;
const RAIZ = (cid, pid) => `proyectos/${cid}/${pid}/agente`;
function convValida(conv) { return !conv || conv === PRINCIPAL || ID_CONV.test(String(conv)); }
function raizConv(cid, pid, conv) {
    if (!conv || conv === PRINCIPAL) return RAIZ(cid, pid);
    if (!ID_CONV.test(String(conv))) throw new Error("Conversación inválida");
    return `${RAIZ(cid, pid)}/conversaciones/${conv}`;
}
module.exports = { PRINCIPAL, RAIZ, raizConv, convValida };
