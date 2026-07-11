/**
 * Rubik OS — Gemini Live WebSocket client
 * Conversación de voz en tiempo real via Gemini 2.0 Flash Live API.
 *
 * Flujo:
 *   1. getApiKey()  → Cloud Function auth-gated → key
 *   2. WebSocket    → wss://generativelanguage.googleapis.com/...?key=KEY
 *   3. Micrófono    → PCM16 16kHz resampled → base64 → WS send
 *   4. Gemini resp  → PCM16 24kHz base64    → decode → AudioContext play
 */
class GeminiLive {
    constructor() {
        this.ws           = null;
        this.audioCtx     = null;
        this.micStream    = null;
        this.micSource    = null;
        this.processor    = null;
        this.audioQueue   = [];
        this.playing      = false;
        this.ready        = false;
        this.nativeRate   = 44100;

        // Callbacks
        this.onReady       = null;  // ()
        this.onUserSpeech  = null;  // (text)
        this.onAISpeech    = null;  // (text)
        this.onStateChange = null;  // ('connecting'|'ready'|'listening'|'thinking'|'speaking'|'error'|'closed')
        this.onError       = null;  // (msg)
    }

    // ─── API key desde Cloud Function auth-gated ────────────────────────────
    async _getKey() {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error('No autenticado');
        const token = await user.getIdToken();
        const res = await fetch('/api/gemini-live-key', {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error('No se pudo obtener credencial Live');
        return (await res.json()).key;
    }

    // ─── Iniciar sesión ─────────────────────────────────────────────────────
    async start(systemInstruction) {
        this._setState('connecting');
        let key;
        try { key = await this._getKey(); } catch(e) { this._onErr(e.message); return; }

        const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${key}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            this.ws.send(JSON.stringify({
                setup: {
                    model: 'models/gemini-2.0-flash-live-001',
                    generation_config: {
                        response_modalities: ['AUDIO'],
                        speech_config: {
                            voice_config: {
                                prebuilt_voice_config: { voice_name: 'Kore' }
                            }
                        }
                    },
                    system_instruction: {
                        parts: [{ text: systemInstruction }]
                    },
                    input_audio_transcription: {},
                    output_audio_transcription: {}
                }
            }));
        };

        this.ws.onmessage = (ev) => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch { return; }
            this._handleMsg(msg);
        };

        this.ws.onerror = () => this._onErr('Error de conexión con Gemini Live');
        this.ws.onclose = (ev) => {
            this._stopMic();
            if (this.audioCtx) { try { this.audioCtx.close(); } catch(_) {} this.audioCtx = null; }
            this.ready = false;
            this._setState(ev.wasClean ? 'closed' : 'error');
        };

        // AudioContext para reproducción — 24kHz = frecuencia de salida de Gemini
        this.audioCtx = new AudioContext();
        this.nativeRate = this.audioCtx.sampleRate;
    }

    // ─── Manejar mensaje WebSocket ──────────────────────────────────────────
    _handleMsg(msg) {
        if (msg.setupComplete) {
            this.ready = true;
            this._setState('ready');
            this._startMic().catch(e => this._onErr('Micrófono no disponible: ' + e.message));
            if (this.onReady) this.onReady();
            return;
        }

        // Audio de respuesta
        const parts = msg.serverContent?.modelTurn?.parts || [];
        let hasAudio = false;
        for (const p of parts) {
            if (p.inlineData?.mimeType?.startsWith('audio/pcm')) {
                this._queueAudio(p.inlineData.data);
                hasAudio = true;
            }
            if (p.text && this.onAISpeech) this.onAISpeech(p.text);
        }
        if (hasAudio) this._setState('speaking');

        // Turno completo del modelo
        if (msg.serverContent?.turnComplete) {
            this._setState('listening');
        }

        // Transcripción de entrada (lo que dijo el usuario)
        const inputTxt = msg.inputTranscription?.text || msg.clientContent?.turns?.[0]?.parts?.[0]?.text;
        if (inputTxt && this.onUserSpeech) this.onUserSpeech(inputTxt);

        // Transcripción de salida (lo que dijo la IA)
        const outputTxt = msg.outputTranscription?.text;
        if (outputTxt && this.onAISpeech) this.onAISpeech(outputTxt);

        // VAD: usuario hablando → interrumpir audio actual
        if (msg.serverContent?.interrupted) {
            this.audioQueue = [];
            this.playing = false;
            this._setState('thinking');
        }
    }

    // ─── Micrófono → PCM16 16kHz → WebSocket ───────────────────────────────
    async _startMic() {
        this.micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
        });
        this.micSource = this.audioCtx.createMediaStreamSource(this.micStream);

        // ScriptProcessor: ampliamente soportado, deprecado pero funcional
        this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
        this.processor.onaudioprocess = (e) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.ready) return;
            const f32 = e.inputBuffer.getChannelData(0);
            const resampled = this._resample(f32, this.nativeRate, 16000);
            const pcm16 = this._f32ToPcm16(resampled);
            const b64 = this._toBase64(pcm16.buffer);
            this.ws.send(JSON.stringify({
                realtimeInput: {
                    mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: b64 }]
                }
            }));
        };

        this.micSource.connect(this.processor);
        // Conectar a destination para que el ScriptProcessor procese
        this.processor.connect(this.audioCtx.destination);
        this._setState('listening');
    }

    _stopMic() {
        if (this.processor)  { try { this.processor.disconnect(); } catch(_) {} this.processor = null; }
        if (this.micSource)  { try { this.micSource.disconnect(); } catch(_) {} this.micSource = null; }
        if (this.micStream)  { this.micStream.getTracks().forEach(t => t.stop()); this.micStream = null; }
    }

    // ─── Cola de audio PCM24kHz → reproducción ──────────────────────────────
    _queueAudio(b64) {
        this.audioQueue.push(b64);
        if (!this.playing) this._playNext();
    }

    _playNext() {
        if (!this.audioCtx || this.audioQueue.length === 0) {
            this.playing = false;
            return;
        }
        this.playing = true;
        const b64 = this.audioQueue.shift();

        // Decode base64 → Uint8Array → Int16Array → Float32Array
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const pcm16 = new Int16Array(bytes.buffer);
        const f32   = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) f32[i] = pcm16[i] / 32768;

        // Gemini outputs 24kHz PCM
        const buf = this.audioCtx.createBuffer(1, f32.length, 24000);
        buf.copyToChannel(f32, 0);
        const src = this.audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(this.audioCtx.destination);
        src.onended = () => this._playNext();
        src.start();
    }

    // ─── Enviar texto al Live session ────────────────────────────────────────
    sendText(text) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.ready) return;
        this.ws.send(JSON.stringify({
            clientContent: {
                turns: [{ role: 'user', parts: [{ text }] }],
                turnComplete: true
            }
        }));
        this._setState('thinking');
    }

    // ─── Terminar sesión ─────────────────────────────────────────────────────
    stop() {
        this._stopMic();
        this.audioQueue = [];
        this.playing    = false;
        this.ready      = false;
        if (this.ws) { try { this.ws.close(); } catch(_) {} this.ws = null; }
        if (this.audioCtx) { try { this.audioCtx.close(); } catch(_) {} this.audioCtx = null; }
        this._setState('closed');
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────
    _resample(f32, fromRate, toRate) {
        if (fromRate === toRate) return f32;
        const ratio = fromRate / toRate;
        const out   = new Float32Array(Math.round(f32.length / ratio));
        for (let i = 0; i < out.length; i++) {
            const src = i * ratio;
            const lo  = Math.floor(src);
            const hi  = Math.min(lo + 1, f32.length - 1);
            const t   = src - lo;
            out[i]    = f32[lo] * (1 - t) + f32[hi] * t;
        }
        return out;
    }

    _f32ToPcm16(f32) {
        const out = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
            out[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32768)));
        }
        return out;
    }

    _toBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    }

    _setState(s) { if (this.onStateChange) this.onStateChange(s); }
    _onErr(msg)  { if (this.onError) this.onError(msg); this._setState('error'); }
}

window.GeminiLive = GeminiLive;
