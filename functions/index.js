const { onRequest } = require('firebase-functions/v2/https');
const { defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

admin.initializeApp();
const db = admin.database();

// Variables de entorno (se configuran con: firebase functions:secrets:set NOMBRE)
const WA_VERIFY_TOKEN = defineString('WA_VERIFY_TOKEN', { default: 'rubik2026' });
const WA_TOKEN       = defineString('WA_TOKEN');
const WA_PHONE_ID    = defineString('WA_PHONE_ID', { default: '1100203513168717' });
const ADMIN_PHONE    = defineString('ADMIN_PHONE');
const GEMINI_KEY     = defineString('GEMINI_KEY');

exports.webhook = onRequest({ region: 'us-central1' }, async (req, res) => {
    // Verificación del webhook (Meta llama con GET al configurarlo)
    if (req.method === 'GET') {
        const mode      = req.query['hub.mode'];
        const token     = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        if (mode === 'subscribe' && token === WA_VERIFY_TOKEN.value()) {
            return res.status(200).send(challenge);
        }
        return res.sendStatus(403);
    }

    if (req.method === 'POST') {
        try {
            const body = req.body;
            if (body.object === 'whatsapp_business_account') {
                for (const entry of (body.entry || [])) {
                    for (const change of (entry.changes || [])) {
                        const msgs = (change.value || {}).messages || [];
                        for (const msg of msgs) {
                            if (msg.type === 'text') {
                                await handleMessage(msg.from, msg.text.body);
                            } else if (msg.type === 'image') {
                                await handleMessage(msg.from, '[imagen recibida] ¿Qué necesitás sobre esta imagen?');
                            }
                        }
                    }
                }
            }
            return res.sendStatus(200);
        } catch (e) {
            console.error('Error webhook:', e);
            return res.sendStatus(500);
        }
    }
    res.sendStatus(405);
});

// ─── Manejo principal del mensaje ────────────────────────────────────────────
async function handleMessage(from, text) {
    try {
        const { role, userData } = await identificarUsuario(from);
        const contexto = await construirContexto(role, userData);
        const respuesta = await generarRespuesta(text, contexto, role, userData);
        await enviarMensaje(from, respuesta);
    } catch (e) {
        console.error('Error handleMessage:', e);
        await enviarMensaje(from, 'Ocurrió un error procesando tu mensaje. Intentá de nuevo en un momento.');
    }
}

// ─── Identificar usuario por número de teléfono ──────────────────────────────
async function identificarUsuario(phone) {
    const clean = phone.replace(/\D/g, '');
    const sin591 = clean.startsWith('591') ? clean.slice(3) : clean;
    const con591 = clean.startsWith('591') ? clean : '591' + clean;

    // Admin
    const adminNum = ADMIN_PHONE.value().replace(/\D/g, '');
    if (adminNum && (clean === adminNum || sin591 === adminNum || con591 === adminNum)) {
        return { role: 'admin', userData: { nombre: 'Admin' } };
    }

    // Personal (trabajadores, supervisores, contratistas)
    const personalSnap = await db.ref('personal').once('value');
    const personal = personalSnap.val() || {};
    for (const [, p] of Object.entries(personal)) {
        const tel = (p.telefono || '').replace(/\D/g, '');
        if (tel && (tel === clean || tel === sin591 || tel === con591)) {
            return { role: p.tipo || 'trabajador', userData: p };
        }
    }

    // Clientes
    const clientesSnap = await db.ref('clientes').once('value');
    const clientes = clientesSnap.val() || {};
    for (const [cid, c] of Object.entries(clientes)) {
        const wsp = (c.wsp || '').replace(/\D/g, '');
        if (wsp && (wsp === clean || wsp === sin591 || wsp === con591)) {
            return { role: 'cliente', userData: { ...c, cid } };
        }
    }

    return { role: 'desconocido', userData: null };
}

// ─── Construir contexto de Firebase según rol ─────────────────────────────────
async function construirContexto(role, userData) {
    if (role === 'admin') {
        const snap = await db.ref('proyectos').once('value');
        const proyectos = snap.val() || {};
        let resumen = [];
        for (const [cid, proy] of Object.entries(proyectos)) {
            for (const [pid, p] of Object.entries(proy)) {
                resumen.push(`[${cid}/${pid}] ${p.nombre || 'Sin nombre'} — ${p.estado || 'activo'}`);
            }
        }
        return `ACCESO TOTAL. Proyectos en sistema:\n${resumen.slice(0, 30).join('\n')}`;
    }

    if (['interno', 'supervisor', 'externo', 'contratista', 'empresa', 'trabajador'].includes(role)) {
        const nombre = userData?.nombre || 'Trabajador';
        const especialidad = userData?.especialidad || '';
        // Buscar proyectos donde aparece su nombre en licitaciones
        return `Trabajador: ${nombre}${especialidad ? ' — ' + especialidad : ''}. Podés consultar tus proyectos asignados, materiales necesarios, procesos de fabricación y estado de las órdenes de producción.`;
    }

    if (role === 'cliente') {
        const cid = userData?.cid;
        if (!cid) return 'Cliente sin proyectos registrados.';
        const snap = await db.ref(`proyectos/${cid}`).once('value');
        const proyectos = snap.val() || {};
        const lista = Object.entries(proyectos)
            .map(([pid, p]) => `• ${p.nombre || pid}: ${p.estado || 'en proceso'}`)
            .join('\n');
        return `Cliente: ${userData.nombre || 'Cliente'}.\nTus proyectos:\n${lista || 'Sin proyectos activos.'}`;
    }

    return 'Usuario no registrado en el sistema Rubik Bolivia.';
}

// ─── Generar respuesta con Gemini ─────────────────────────────────────────────
async function generarRespuesta(mensaje, contexto, role, userData) {
    const genAI = new GoogleGenerativeAI(GEMINI_KEY.value());
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const permisos = {
        admin:       'Tenés acceso total al sistema. Podés consultar y gestionar todo.',
        supervisor:  'Podés ver proyectos asignados, personal, materiales y órdenes de producción.',
        interno:     'Podés ver tus órdenes de trabajo y materiales asignados.',
        externo:     'Podés ver los trabajos que te fueron asignados.',
        contratista: 'Podés ver los contratos y trabajos asignados.',
        empresa:     'Podés ver los servicios contratados.',
        trabajador:  'Podés ver tus órdenes de trabajo.',
        cliente:     'Podés ver el estado de tus proyectos, presupuestos y avances.',
        desconocido: 'Tu número no está registrado en el sistema. Contactá a Rubik Bolivia para ser registrado.'
    };

    const system = `Sos el asistente IA de Rubik Bolivia, empresa de señalética, carpintería, metalmecanica e impresión gran formato en Santa Cruz, Bolivia.
Respondé en español, de forma concisa y profesional. Máximo 3 párrafos.
Rol del usuario: ${role}. ${permisos[role] || ''}
Contexto actual del sistema:
${contexto}`;

    const result = await model.generateContent(`${system}\n\nMensaje del usuario: ${mensaje}`);
    return result.response.text();
}

// ─── Enviar mensaje por WhatsApp ──────────────────────────────────────────────
async function enviarMensaje(to, text) {
    const url = `https://graph.facebook.com/v20.0/${WA_PHONE_ID.value()}/messages`;
    await axios.post(url, {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text.slice(0, 4096) }
    }, {
        headers: {
            Authorization: `Bearer ${WA_TOKEN.value()}`,
            'Content-Type': 'application/json'
        }
    });
}
