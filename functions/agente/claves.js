/**
 * Claves de la base (/base_datos/materiales, mano_obra…): encontrar el registro que ya existe aunque su clave tenga
 * espacios o guiones bajos, para ACTUALIZARLO en vez de crear un repetido. Lo usan guardar_en_base (agente y conector)
 * y el registro de compras (functions/compras).
 */
const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Clave de la base a usar para guardar: si el registro ya existe (tal cual, con espacios, o con espacios ↔ guiones bajos),
 * la suya, para ACTUALIZARLO en vez de crear un repetido. Si es nuevo: MAYÚSCULAS_CON_GUIONES.
 */
function resolverClave(dic, crudo) {
    const t = String(crudo == null ? "" : crudo).trim();
    if (!t) return { clave: "", existe: false };
    const segura = t.replace(/[.#$[\]/]+/g, "_").slice(0, 80);
    const nueva = t.toUpperCase().replace(/[.#$[\]/\s]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 80);
    for (const k of [segura, segura.toUpperCase(), nueva]) if (k && dic && Object.prototype.hasOwnProperty.call(dic, k)) return { clave: k, existe: true };
    const comp = (k) => String(k).toUpperCase().replace(/[.#$[\]/\s_]+/g, "_").replace(/^_|_$/g, "");
    const hit = Object.keys(dic || {}).find((k) => comp(k) === nueva);
    return hit ? { clave: hit, existe: true } : { clave: nueva, existe: false };
}

module.exports = { norm, resolverClave };
