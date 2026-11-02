/**
 * Acceso "hub" — misma lista blanca que usan las reglas de la base:
 * /acceso/hub/{uid} = true (se edita solo desde la consola de Firebase).
 */

const admin = require("firebase-admin");

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // uid → vence (solo se cachean accesos permitidos)

async function esHub(uid) {
    if (!uid) return false;
    if ((cache.get(uid) || 0) > Date.now()) return true;
    const snap = await admin.database().ref(`acceso/hub/${uid}`).once("value");
    const ok = snap.val() === true;
    if (ok) cache.set(uid, Date.now() + CACHE_MS);
    return ok;
}

module.exports = { esHub };
