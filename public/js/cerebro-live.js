/**
 * Rubik OS — CerebroLive
 * Conversación de voz en tiempo real usando Web Speech API + Claude Haiku.
 * Reemplaza Gemini Live WebSocket eliminando dependencia de Google.
 *
 * Flujo:
 *   1. SpeechRecognition  → usuario habla → texto
 *   2. /api/gemini         → Claude Haiku  → respuesta texto
 *   3. SpeechSynthesis    → reproduce respuesta en voz
 *   4. Repite desde 1
 *
 * Misma interfaz de callbacks que la clase anterior GeminiLive.
 */
class CerebroLive {
    constructor() {
        this.recognition        = null;
        this.active             = false;
        this._muted             = false;
        this._speaking          = false;
        this._thinking          = false;
        this._sysPrompt         = '';
        this._pendingRestart    = null;
        this._audioCtx          = null;
        this._currentSource     = null;

        // Callbacks (mismos que GeminiLive para compatibilidad)
        this.onReady       = null;   // ()
        this.onUserSpeech  = null;   // (text)
        this.onAISpeech    = null;   // (text)
        this.onStateChange = null;   // ('connecting'|'ready'|'listening'|'thinking'|'speaking'|'error'|'closed')
        this.onError       = null;   // (msg)
        this.onAction      = null;   // async ({type, data}) — acciones sobre Firebase
    }

    // ─── Iniciar sesión ──────────────────────────────────────────────────────
    async start(sysPrompt) {
        this._sysPrompt = sysPrompt;
        this._setState('connecting');

        // Verificar acceso al micrófono
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop());
        } catch(e) {
            this._onErr('Micrófono no disponible: ' + e.message);
            return;
        }

        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            this._onErr('Tu navegador no soporta reconocimiento de voz');
            return;
        }

        this._setupRecognition(SR);
        this.active = true;

        this._setState('ready');
        if (this.onReady) this.onReady();

        // Saludo automático para confirmar que el audio funciona
        setTimeout(() => {
            if (this.active) this._speak('Hola jefe, ¿en qué lo puedo ayudar?');
        }, 700);
    }

    // ─── Configurar SpeechRecognition ────────────────────────────────────────
    _setupRecognition(SR) {
        this.recognition = new SR();
        this.recognition.lang            = navigator.language || 'es-BO';
        this.recognition.continuous      = false;
        this.recognition.interimResults  = false;
        this.recognition.maxAlternatives = 1;

        this.recognition.onstart = () => {
            if (!this._speaking && !this._thinking) this._setState('listening');
        };

        this.recognition.onresult = (ev) => {
            const text = ev.results[0][0].transcript.trim();
            if (!text) return;
            if (this.onUserSpeech) this.onUserSpeech(text);
            this._askClaude(text);
        };

        this.recognition.onerror = (ev) => {
            if (ev.error === 'no-speech' || ev.error === 'aborted') {
                this._scheduleRestart(500);
            } else if (ev.error === 'not-allowed') {
                this._onErr('Permiso de micrófono denegado');
            } else {
                this._scheduleRestart(1000);
            }
        };

        this.recognition.onend = () => {
            if (this.active && !this._muted && !this._speaking && !this._thinking) {
                this._scheduleRestart(350);
            }
        };
    }

    _startListening() {
        if (!this.active || this._muted || !this.recognition) return;
        if (this._speaking || this._thinking) return;
        try { this.recognition.start(); } catch(_) {}
    }

    _scheduleRestart(delay) {
        if (this._pendingRestart) clearTimeout(this._pendingRestart);
        this._pendingRestart = setTimeout(() => {
            this._pendingRestart = null;
            this._startListening();
        }, delay);
    }

    // ─── Llamar a Claude via /api/gemini ────────────────────────────────────
    async _askClaude(userText) {
        this._thinking = true;
        this._setState('thinking');

        try {
            let headers = { 'Content-Type': 'application/json' };
            try {
                const user = firebase.auth().currentUser;
                if (user) headers['Authorization'] = 'Bearer ' + await user.getIdToken();
            } catch(_) {}

            const resp = await fetch('/api/gemini', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: userText }] }],
                    systemInstruction: { parts: [{ text: this._sysPrompt }] },
                    generationConfig: { maxOutputTokens: 250 }
                })
            });

            const data = await resp.json();
            const aiText = data.text
                || data.candidates?.[0]?.content?.parts?.[0]?.text
                || '';

            this._thinking = false;

            // Parsear y ejecutar bloques de acción — se eliminan del texto hablado
            let spokenText = aiText;
            if (aiText.trim() && this.onAction) {
                const actionRe = /(ACTUALIZAR_CAMPO|CREAR_CLIENTE|AGREGAR_MATERIAL):\s*(\{[^\n\r]+\})/g;
                let m;
                while ((m = actionRe.exec(aiText)) !== null) {
                    try { await this.onAction({ type: m[1], data: JSON.parse(m[2]) }); } catch(_) {}
                    spokenText = spokenText.replace(m[0], '').trim();
                }
            }

            spokenText = this._cleanForSpeech(spokenText);
            if (spokenText) {
                if (this.onAISpeech) this.onAISpeech(spokenText);
                this._speak(spokenText);
            } else {
                this._scheduleRestart(300);
            }
        } catch(e) {
            this._thinking = false;
            this._scheduleRestart(1000);
        }
    }

    // ─── TTS via Google Cloud Neural2 + fallback SpeechSynthesis ────────────
    async _speak(text) {
        this._speaking = true;
        this._setState('speaking');
        window.speechSynthesis.cancel();

        const done = () => {
            this._currentSource = null;
            this._speaking = false;
            if (this.active && !this._muted) this._scheduleRestart(400);
            else this._setState('listening');
        };

        // Intentar Google Cloud TTS (Neural2 — voz natural masculina)
        try {
            let headers = { 'Content-Type': 'application/json' };
            try {
                const user = firebase.auth().currentUser;
                if (user) headers['Authorization'] = 'Bearer ' + await user.getIdToken();
            } catch(_) {}

            const resp = await fetch('/api/tts', {
                method: 'POST',
                headers,
                body: JSON.stringify({ text })
            });

            if (resp.ok) {
                const data = await resp.json();
                if (data.audioContent) {
                    await this._playMp3(data.audioContent, done);
                    return;
                }
            }
        } catch(_) {}

        // Fallback: SpeechSynthesis del navegador
        this._speakFallback(text, done);
    }

    async _playMp3(b64, onEnd) {
        try {
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

            if (!this._audioCtx || this._audioCtx.state === 'closed') {
                this._audioCtx = new AudioContext();
            }
            if (this._audioCtx.state === 'suspended') {
                await this._audioCtx.resume();
            }

            const audioBuffer = await this._audioCtx.decodeAudioData(bytes.buffer);
            const source = this._audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this._audioCtx.destination);
            source.onended = onEnd;
            this._currentSource = source;
            source.start();
        } catch(e) {
            console.warn('MP3 playback error, usando fallback:', e.message);
            onEnd();
        }
    }

    _speakFallback(text, done) {
        const utt = new SpeechSynthesisUtterance(text);
        utt.lang   = 'es';
        utt.rate   = 0.94;
        utt.pitch  = 1.05;
        utt.volume = 1.0;

        const trySpeak = () => {
            const voices = window.speechSynthesis.getVoices();
            const esp = voices.find(v => v.lang.startsWith('es') && v.localService)
                     || voices.find(v => v.lang.startsWith('es'))
                     || null;
            if (esp) utt.voice = esp;
            utt.onend   = done;
            utt.onerror = done;
            window.speechSynthesis.speak(utt);
        };

        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            trySpeak();
        } else {
            window.speechSynthesis.onvoiceschanged = () => {
                window.speechSynthesis.onvoiceschanged = null;
                trySpeak();
            };
            setTimeout(trySpeak, 500);
        }
    }

    // ─── Control público ─────────────────────────────────────────────────────
    mute(isMuted) {
        this._muted = isMuted;
        if (isMuted) {
            if (this.recognition) { try { this.recognition.abort(); } catch(_) {} }
            window.speechSynthesis.cancel();
            if (this._currentSource) { try { this._currentSource.stop(); } catch(_) {} this._currentSource = null; }
            this._speaking = false;
        } else {
            if (this.active) this._scheduleRestart(200);
        }
    }

    stop() {
        this.active   = false;
        this._muted   = false;
        this._speaking = false;
        this._thinking = false;
        if (this._pendingRestart) { clearTimeout(this._pendingRestart); this._pendingRestart = null; }
        if (this.recognition) { try { this.recognition.abort(); } catch(_) {} this.recognition = null; }
        window.speechSynthesis.cancel();
        if (this._currentSource) { try { this._currentSource.stop(); } catch(_) {} this._currentSource = null; }
        if (this._audioCtx) { try { this._audioCtx.close(); } catch(_) {} this._audioCtx = null; }
        this._setState('closed');
    }

    // Elimina markdown y símbolos que suenan raro al ser leídos en voz alta
    _cleanForSpeech(text) {
        return text
            .replace(/```[\s\S]*?```/g, '')          // bloques de código
            .replace(/`([^`]+)`/g, '$1')              // código inline
            .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1') // negrita / cursiva
            .replace(/_{1,3}([^_\n]+)_{1,3}/g, '$1') // subrayado markdown
            .replace(/^#{1,6}\s+/gm, '')              // encabezados
            .replace(/→|←|⟶|⟹|►|▶/g, ',')          // flechas → coma
            .replace(/^[-•*]\s+/gm, '')               // viñetas
            .replace(/^\d+\.\s+/gm, '')               // listas numeradas
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // links markdown
            .replace(/\|/g, ', ')                     // tablas
            .replace(/\n+/g, ' ')                     // saltos de línea → espacio
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    _setState(s) { if (this.onStateChange) this.onStateChange(s); }
    _onErr(msg)  { if (this.onError) this.onError(msg); this._setState('error'); }
}

window.CerebroLive = CerebroLive;
// Alias para compatibilidad con código que usaba GeminiLive
window.GeminiLive = CerebroLive;
