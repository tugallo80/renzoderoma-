/**
 * Mail functions — conecta rubikbolivia.com a Zoho Mail vía IMAP/SMTP.
 * Credenciales NUNCA salen al cliente; todas las operaciones son backend-only.
 */

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { ImapFlow } = require("imapflow");
const nodemailer = require("nodemailer");
const { simpleParser } = require("mailparser");

const ZOHO_MAIL_PASSWORD = defineSecret("ZOHO_MAIL_PASSWORD");

const ZOHO_USER = "renzo@rubikbolivia.com";
// Zoho Workplace con dominio propio usa imappro.zoho.com
const IMAP_HOST = "imappro.zoho.com";
const IMAP_PORT = 993;
const SMTP_HOST = "smtppro.zoho.com";
const SMTP_PORT = 465;

const ALLOWED_ORIGINS = new Set([
    "https://rubikbolivia.com",
    "https://www.rubikbolivia.com",
    "https://rubik-bolivia.web.app",
    "https://rubik-bolivia.firebaseapp.com",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
]);

function applyCors(req, res, methods = "GET, POST, OPTIONS") {
    const origin = req.headers.origin || "";
    if (ALLOWED_ORIGINS.has(origin)) {
        res.set("Access-Control-Allow-Origin", origin);
        res.set("Vary", "Origin");
    }
    res.set("Access-Control-Allow-Methods", methods);
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Max-Age", "3600");
}

async function requireAuth(req, res) {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
        res.status(401).json({ error: "Falta header Authorization: Bearer <id_token>" });
        return null;
    }
    const idToken = header.substring("Bearer ".length).trim();
    try {
        return await admin.auth().verifyIdToken(idToken);
    } catch (e) {
        console.warn("Token rechazado:", e.message);
        res.status(401).json({ error: "ID token inválido o expirado" });
        return null;
    }
}

function makeImapClient(password) {
    return new ImapFlow({
        host: IMAP_HOST,
        port: IMAP_PORT,
        secure: true,
        auth: { user: ZOHO_USER, pass: password },
        logger: false,
        tls: { rejectUnauthorized: true },
        socketTimeout: 15000,
        connectionTimeout: 15000,
    });
}

function imapErrMsg(e) {
    // imapflow expone responseText en errores de comando IMAP
    return e.responseText || e.response || e.message || String(e);
}

// ── GET /api/mail/folders ────────────────────────────────────────────────────

exports.mailFolders = onRequest(
    { secrets: [ZOHO_MAIL_PASSWORD], region: "us-central1" },
    async (req, res) => {
        applyCors(req, res, "GET, OPTIONS");
        if (req.method === "OPTIONS") return res.status(204).send("");
        if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });

        const user = await requireAuth(req, res);
        if (!user) return;

        const client = makeImapClient(ZOHO_MAIL_PASSWORD.value());
        try {
            await client.connect();
            const list = await client.list();
            const folders = list
                .filter(f => !f.flags.has("\\Noselect"))
                .map(f => ({ path: f.path, name: f.name, flags: [...f.flags] }));
            return res.status(200).json({ folders });
        } catch (e) {
            console.error("[mailFolders]", e.message, e.responseText || "");
            return res.status(500).json({ error: imapErrMsg(e) });
        } finally {
            await client.logout().catch(() => {});
        }
    }
);

// ── GET /api/mail/inbox?folder=INBOX&page=1&limit=20 ────────────────────────

exports.mailInbox = onRequest(
    { secrets: [ZOHO_MAIL_PASSWORD], region: "us-central1" },
    async (req, res) => {
        applyCors(req, res, "GET, OPTIONS");
        if (req.method === "OPTIONS") return res.status(204).send("");
        if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });

        const user = await requireAuth(req, res);
        if (!user) return;

        const folder = req.query.folder || "INBOX";
        const page   = Math.max(1, parseInt(req.query.page  || "1",  10));
        const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit || "20", 10)));

        const client = makeImapClient(ZOHO_MAIL_PASSWORD.value());
        try {
            await client.connect();
            const mailbox = await client.mailboxOpen(folder, { readOnly: true });
            const total = mailbox.exists;

            if (total === 0) {
                await client.logout().catch(() => {});
                return res.status(200).json({ messages: [], total: 0, page, limit });
            }

            // Fetch most-recent first: compute UID range for page
            const start = Math.max(1, total - (page - 1) * limit - limit + 1);
            const end   = Math.max(1, total - (page - 1) * limit);
            if (start > end) {
                await client.logout().catch(() => {});
                return res.status(200).json({ messages: [], total, page, limit });
            }

            const messages = [];
            for await (const msg of client.fetch(`${start}:${end}`, {
                uid: true,
                flags: true,
                envelope: true,
                bodyStructure: true,
            })) {
                const from = msg.envelope.from?.[0] || {};
                messages.push({
                    uid:      msg.uid,
                    seq:      msg.seq,
                    subject:  msg.envelope.subject || "(sin asunto)",
                    from:     from.name
                        ? `${from.name} <${from.mailbox}@${from.host}>`
                        : `${from.mailbox}@${from.host}`,
                    date:     msg.envelope.date?.toISOString() || null,
                    seen:     msg.flags.has("\\Seen"),
                    flagged:  msg.flags.has("\\Flagged"),
                    hasAttachment: hasAttachmentInStructure(msg.bodyStructure),
                });
            }

            // Devolver en orden más-reciente primero
            messages.reverse();
            return res.status(200).json({ messages, total, page, limit });
        } catch (e) {
            console.error("[mailInbox]", e.message, e.responseText || "");
            return res.status(500).json({ error: imapErrMsg(e) });
        } finally {
            await client.logout().catch(() => {});
        }
    }
);

function hasAttachmentInStructure(struct) {
    if (!struct) return false;
    if (struct.disposition?.value?.toLowerCase() === "attachment") return true;
    if (struct.childNodes) {
        return struct.childNodes.some(c => hasAttachmentInStructure(c));
    }
    return false;
}

// ── GET /api/mail/message?folder=INBOX&uid=1234 ─────────────────────────────

exports.mailMessage = onRequest(
    { secrets: [ZOHO_MAIL_PASSWORD], region: "us-central1" },
    async (req, res) => {
        applyCors(req, res, "GET, OPTIONS");
        if (req.method === "OPTIONS") return res.status(204).send("");
        if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });

        const user = await requireAuth(req, res);
        if (!user) return;

        const folder = req.query.folder || "INBOX";
        const uid    = parseInt(req.query.uid || "0", 10);
        if (!uid) return res.status(400).json({ error: "Falta uid" });

        const client = makeImapClient(ZOHO_MAIL_PASSWORD.value());
        try {
            await client.connect();
            await client.mailboxOpen(folder);

            let rawBuffer = null;
            for await (const msg of client.fetch({ uid }, { source: true }, { uid: true })) {
                rawBuffer = msg.source;
            }
            if (!rawBuffer) {
                await client.logout().catch(() => {});
                return res.status(404).json({ error: "Mensaje no encontrado" });
            }

            // Marcar como leído
            await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true });

            const parsed = await simpleParser(rawBuffer);

            const attachments = (parsed.attachments || []).map(a => ({
                filename:    a.filename || "adjunto",
                contentType: a.contentType,
                size:        a.size,
                cid:         a.cid || null,
                // No enviamos el contenido binario — el cliente puede solicitarlo
                // con un endpoint separado si fuera necesario
            }));

            return res.status(200).json({
                uid,
                subject:     parsed.subject || "(sin asunto)",
                from:        parsed.from?.text || "",
                to:          parsed.to?.text   || "",
                cc:          parsed.cc?.text   || "",
                date:        parsed.date?.toISOString() || null,
                html:        parsed.html || null,
                text:        parsed.text || null,
                attachments,
            });
        } catch (e) {
            console.error("[mailMessage]", e.message, e.responseText || "");
            return res.status(500).json({ error: imapErrMsg(e) });
        } finally {
            await client.logout().catch(() => {});
        }
    }
);

// ── POST /api/mail/send ──────────────────────────────────────────────────────
// Body JSON: { to, subject, text?, html?, cc?, bcc?, replyToUid?, replyToFolder? }

exports.mailSend = onRequest(
    { secrets: [ZOHO_MAIL_PASSWORD], region: "us-central1" },
    async (req, res) => {
        applyCors(req, res, "POST, OPTIONS");
        if (req.method === "OPTIONS") return res.status(204).send("");
        if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

        const user = await requireAuth(req, res);
        if (!user) return;

        const { to, subject, text, html, cc, bcc, replyToUid, replyToFolder } = req.body || {};
        if (!to || !subject) {
            return res.status(400).json({ error: "Faltan campos: to, subject" });
        }
        if (!text && !html) {
            return res.status(400).json({ error: "Se requiere text o html en el cuerpo" });
        }

        let inReplyTo = undefined;
        let references = undefined;

        // Si es respuesta, obtener Message-ID del original para threading
        if (replyToUid && replyToFolder) {
            const imapClient = makeImapClient(ZOHO_MAIL_PASSWORD.value());
            try {
                await imapClient.connect();
                await imapClient.mailboxOpen(replyToFolder, { readOnly: true });
                let rawOriginal = null;
                for await (const msg of imapClient.fetch(
                    { uid: replyToUid },
                    { source: true },
                    { uid: true }
                )) {
                    rawOriginal = msg.source;
                }
                if (rawOriginal) {
                    const parsedOriginal = await simpleParser(rawOriginal);
                    inReplyTo  = parsedOriginal.messageId;
                    references = [
                        ...(parsedOriginal.references || []),
                        parsedOriginal.messageId,
                    ].filter(Boolean).join(" ");
                }
            } catch (e) {
                console.warn("[mailSend] no se pudo obtener In-Reply-To:", e.message);
            } finally {
                await imapClient.logout().catch(() => {});
            }
        }

        const transport = nodemailer.createTransport({
            host:   SMTP_HOST,
            port:   SMTP_PORT,
            secure: true,
            auth:   { user: ZOHO_USER, pass: ZOHO_MAIL_PASSWORD.value() },
        });

        const mailOptions = {
            from:    `Renzo De Roma <${ZOHO_USER}>`,
            to,
            subject,
            ...(cc  ? { cc }  : {}),
            ...(bcc ? { bcc } : {}),
            ...(text ? { text } : {}),
            ...(html ? { html } : {}),
            ...(inReplyTo  ? { inReplyTo }  : {}),
            ...(references ? { references } : {}),
        };

        try {
            const info = await transport.sendMail(mailOptions);
            console.log("[mailSend] enviado:", info.messageId);
            return res.status(200).json({ ok: true, messageId: info.messageId });
        } catch (e) {
            console.error("[mailSend]", e.message);
            return res.status(500).json({ error: e.message || String(e) });
        }
    }
);
