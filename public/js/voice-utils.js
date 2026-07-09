/**
 * voice-utils.js — Voz para los asistentes IA de Rubik OS
 * Provee: TTS (IA habla), Dictado (voz → texto), Grabación (MediaRecorder)
 * Uso: window.VoiceUtils.ttsSpeak(text) | VoiceUtils.ttsToggle() | VoiceUtils.toggleDictation(inputEl, onToggle)
 */
(function () {
    'use strict';
    const V = {};

    /* ───────────── TTS (Text-to-Speech) ───────────────────────────────────── */
    let _ttsOn = false;

    V.ttsEnabled = () => _ttsOn;

    V.ttsToggle = () => {
        _ttsOn = !_ttsOn;
        if (!_ttsOn) V.ttsStop();
        return _ttsOn;
    };

    V.ttsSpeak = (text, lang) => {
        if (!_ttsOn || !window.speechSynthesis) return;
        const clean = (text || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/[*#`_~\[\]]/g, '')
            .replace(/https?:\/\/\S+/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 3000);
        if (!clean) return;

        const utt = new SpeechSynthesisUtterance(clean);
        utt.lang = lang || 'es-ES';
        utt.rate = 1.05;
        utt.pitch = 1;

        // Seleccionar voz en español si está disponible
        const pickVoice = () => {
            const voices = window.speechSynthesis.getVoices();
            const es = voices.find(v => v.lang.startsWith('es') && v.localService) ||
                       voices.find(v => v.lang.startsWith('es'));
            if (es) utt.voice = es;
        };

        if (window.speechSynthesis.getVoices().length > 0) {
            pickVoice();
        } else {
            window.speechSynthesis.onvoiceschanged = pickVoice;
        }

        utt.onend = () => { if (V._onTTSEnd) V._onTTSEnd(); };
        utt.onerror = () => { if (V._onTTSEnd) V._onTTSEnd(); };

        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utt);
    };

    V.ttsStop = () => {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
    };

    /* ───────────── Dictado (Web Speech API) ────────────────────────────────── */
    let _recognition = null;
    let _dictating = false;

    V.hasSpeechRecognition = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);

    /**
     * initDictation — prepara el reconocedor de voz para un input dado.
     * @param {HTMLElement} inputEl   Textarea o input donde va el texto
     * @param {object}      opts      { lang, onStop, onFinal }
     */
    V.initDictation = (inputEl, opts) => {
        opts = opts || {};
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return false;

        // Destruir reconocedor anterior si existe
        if (_recognition) { try { _recognition.abort(); } catch (_) {} }

        _recognition = new SR();
        _recognition.lang = opts.lang || 'es-ES';
        _recognition.continuous = true;
        _recognition.interimResults = true;

        let _base = '';
        _recognition.onresult = (e) => {
            let interim = '', final = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const t = e.results[i][0].transcript;
                if (e.results[i].isFinal) final += t;
                else interim += t;
            }
            inputEl.value = _base + (final || interim);
            try { inputEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
            if (final) { _base += final; if (opts.onFinal) opts.onFinal(_base); }
        };

        _recognition.onend = () => {
            _dictating = false;
            _base = '';
            if (opts.onStop) opts.onStop();
        };

        _recognition.onerror = (e) => {
            if (e.error !== 'aborted' && e.error !== 'no-speech')
                console.warn('[VoiceUtils] recognition error:', e.error);
            _dictating = false;
            _base = '';
            if (opts.onStop) opts.onStop();
        };

        return true;
    };

    V.startDictation = () => {
        if (!_recognition || _dictating) return false;
        _dictating = true;
        try { _recognition.start(); return true; }
        catch (e) { _dictating = false; return false; }
    };

    V.stopDictation = () => {
        if (!_recognition || !_dictating) return;
        try { _recognition.stop(); } catch (_) {}
        _dictating = false;
    };

    V.isDictating = () => _dictating;

    /**
     * toggleDictation — wrapper conveniente: inicia o detiene en un click.
     * Si `autoSend` es true, llama `sendFn()` al terminar (auto-envío).
     */
    V.toggleDictation = (inputEl, opts, autoSend, sendFn) => {
        opts = opts || {};
        if (V.isDictating()) {
            V.stopDictation();
            return false;
        }
        const origOnStop = opts.onStop;
        opts.onStop = () => {
            if (origOnStop) origOnStop();
            if (autoSend && sendFn && (inputEl.value || '').trim()) {
                setTimeout(() => sendFn(), 150);
            }
        };
        V.initDictation(inputEl, opts);
        return V.startDictation();
    };

    /* ───────────── Grabación de Audio (MediaRecorder) ──────────────────────── */
    let _recorder = null;
    let _recChunks = [];

    V.hasRecording = () => !!(navigator.mediaDevices && window.MediaRecorder);

    V.startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            _recChunks = [];
            const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
                .find(m => { try { return MediaRecorder.isTypeSupported(m); } catch (_) { return false; } }) || '';
            _recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
            _recorder.ondataavailable = e => { if (e.data.size > 0) _recChunks.push(e.data); };
            _recorder.start(100);
            return true;
        } catch (e) {
            console.error('[VoiceUtils] startRecording error:', e);
            return false;
        }
    };

    V.stopRecording = () => new Promise(resolve => {
        if (!_recorder || _recorder.state === 'inactive') return resolve(null);
        _recorder.onstop = () => {
            const mime = _recorder.mimeType || 'audio/webm';
            const blob = new Blob(_recChunks, { type: mime });
            _recorder.stream.getTracks().forEach(t => t.stop());
            _recorder = null;
            resolve(blob);
        };
        _recorder.stop();
    });

    V.isRecording = () => !!_recorder;

    V.blobToBase64 = blob => new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onloadend = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
    });

    /* ───────────── Helpers de UI ───────────────────────────────────────────── */
    /**
     * Crea un botón TTS listo para insertar.
     * @param {string} btnId    id del botón
     * @param {string} toggleFn nombre de la función global de toggle
     * @param {string} extraStyle estilos extra CSS
     */
    V.makeTTSButton = (btnId, toggleFn, extraStyle) => {
        const style = `background:none;border:none;cursor:pointer;padding:6px 8px;border-radius:8px;
            color:var(--gray,#888);font-size:18px;display:flex;align-items:center;transition:color .2s;${extraStyle || ''}`;
        return `<button id="${btnId}" onclick="${toggleFn}()" title="Activar/desactivar voz IA" style="${style}">
            <i class="ph-bold ph-speaker-simple-high"></i></button>`;
    };

    /**
     * Actualiza un botón TTS según si está activo.
     */
    V.updateTTSBtn = (btnId) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        if (_ttsOn) {
            btn.style.color = 'var(--purple, #7c3aed)';
            btn.title = 'Voz activa — clic para silenciar';
            btn.innerHTML = '<i class="ph-bold ph-speaker-simple-high"></i>';
        } else {
            btn.style.color = 'var(--gray, #888)';
            btn.title = 'Activar voz IA';
            btn.innerHTML = '<i class="ph-bold ph-speaker-slash"></i>';
        }
    };

    /**
     * Actualiza un botón de micrófono según si está dictando.
     */
    V.updateMicBtn = (btnId) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        if (_dictating) {
            btn.style.background = 'var(--red, #e74c3c)';
            btn.style.color = 'white';
            btn.innerHTML = '<i class="ph-bold ph-stop-circle"></i>';
            btn.title = 'Clic para detener';
        } else {
            btn.style.background = '';
            btn.style.color = '';
            btn.innerHTML = '<i class="ph-bold ph-microphone"></i>';
            btn.title = 'Clic para hablar';
        }
    };

    window.VoiceUtils = V;
})();
