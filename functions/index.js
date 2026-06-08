const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

admin.initializeApp();
const db = admin.database();

const cfg = {
    GEMINI_KEY:      process.env.GEMINI_KEY      || '',
    WA_VERIFY_TOKEN: process.env.WA_VERIFY_TOKEN || 'rubik2026',
    WA_TOKEN:        process.env.WA_TOKEN        || '',
    WA_PHONE_ID:     process.env.WA_PHONE_ID     || '1100203513168717',
    ADMIN_PHONE:     process.env.ADMIN_PHONE     || '',
};

exports.geminiProxy = onRequest({ region: 'us-central1', cors: true }, async (req, res) => {
    if (req.method !== 'POST') return res.sendStatus(405);
    try {
        const body = req.body;
        const model = body.model || 'gemini-2.0-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.GEMINI_KEY}`;
        const resp = await axios.post(url, {
            contents: body.contents,
            ...(body.generationConfig ? { generationConfig: body.generationConfig } : {}),
            ...(body.systemInstruction ? { systemInstruction: body.systemInstruction } : {}),
        });
        return res.json(resp.data);
    } catch (e) {
        console.error('geminiProxy error:', e?.response?.data || e.message);
        return res.status(500).json({ error: e?.response?.data || e.message });
    }
});

exports.webhook = onRequest({ region: 'us-central1' }, async (req, res) => {
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'], token = req.query['hub.verify_token'], challenge = req.query['hub.challenge'];
        if (mode === 'subscribe' && token === cfg.WA_VERIFY_TOKEN) return res.status(200).send(challenge);
        return res.sendStatus(403);
    }
    if (req.method === 'POST') {
        try {
            const body = req.body;
            if (body.object === 'whatsapp_business_account') {
                for (const entry of (body.entry || [])) {
                    for (const change of (entry.changes || [])) {
                        for (const msg of ((change.value || {}).messages || [])) {
                            if (msg.type === 'text') await handleMessage(msg.from, msg.text.body);
                        }
                    }
                }
            }
            return res.sendStatus(200);
        } catch (e) { console.error('webhook error:', e); return res.sendStatus(500); }
    }
    res.sendStatus(405);
});

async function handleMessage(from, text) {
    try {
        const { role, userData } = await identificarUsuario(from);
        const contexto = await construirContexto(role, userData);
        const respuesta = await generarRespuesta(text, contexto, role);
        await enviarMensaje(from, respuesta);
    } catch (e) { console.error('handleMessage error:', e); await enviarMensaje(from, 'Error. Intentá de nuevo.'); }
}

async function identificarUsuario(phone) {
    const clean = phone.replace(/\D/g,'');
    const sin591 = clean.startsWith('591') ? clean.slice(3) : clean;
    const con591 = clean.startsWith('591') ? clean : '591'+clean;
    const match = (tel) => { const t=(tel||'').replace(/\D/g,''); return t&&(t===clean||t===sin591||t===con591); };
    if (match(cfg.ADMIN_PHONE)) return { role:'admin', userData:{nombre:'Admin'} };
    const [ps, cs] = await Promise.all([db.ref('personal').once('value'), db.ref('clientes').once('value')]);
    for (const p of Object.values(ps.val()||{})) if (match(p.telefono)) return { role: p.tipo||'trabajador', userData: p };
    for (const [cid,c] of Object.entries(cs.val()||{})) if (match(c.wsp)) return { role:'cliente', userData:{...c,cid} };
    return { role:'desconocido', userData:null };
}

async function construirContexto(role, userData) {
    if (role==='admin') {
        const snap = await db.ref('proyectos').once('value');
        const res = Object.entries(snap.val()||{}).flatMap(([,ps])=>Object.values(ps).map(p=>`• ${p.nombre||'?'} (${p.estado||'activo'})`)).slice(0,20).join('\n');
        return `ACCESO TOTAL.\nProyectos:\n${res}`;
    }
    if (['interno','supervisor','externo','contratista','empresa','trabajador'].includes(role))
        return `Trabajador: ${userData?.nombre||'?'}, especialidad: ${userData?.especialidad||'N/A'}.`;
    if (role==='cliente') {
        const snap = await db.ref(`proyectos/${userData.cid}`).once('value');
        const lista = Object.values(snap.val()||{}).map(p=>`• ${p.nombre}: ${p.estado||'en proceso'}`).join('\n');
        return `Cliente: ${userData.nombre}.\nProyectos:\n${lista||'Sin proyectos.'}`;
    }
    return 'Usuario no registrado.';
}

async function generarRespuesta(mensaje, contexto, role) {
    const genAI = new GoogleGenerativeAI(cfg.GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model:'gemini-2.0-flash' });
    const system = `Sos el asistente IA de Rubik Bolivia. Respondé en español, conciso, máximo 3 párrafos. Rol: ${role}.\nContexto: ${contexto}`;
    const result = await model.generateContent(`${system}\n\nUsuario: ${mensaje}`);
    return result.response.text();
}

async function enviarMensaje(to, text) {
    await axios.post(`https://graph.facebook.com/v20.0/${cfg.WA_PHONE_ID}/messages`,
        { messaging_product:'whatsapp', to, type:'text', text:{ body:text.slice(0,4096) } },
        { headers:{ Authorization:`Bearer ${cfg.WA_TOKEN}`, 'Content-Type':'application/json' } }
    );
}
