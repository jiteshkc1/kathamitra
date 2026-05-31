/**
 * ============================================================================
 * KATHA MITRA - Speech API Abstraction Layer (speech.js)
 * ============================================================================
 * Handles Web Speech API interaction for STT and TTS.
 * Prefers a native Hindi voice when available, otherwise falls back to a
 * system voice, and finally to remote audio if needed.
 * ============================================================================
 */

class SpeechService {
    constructor() {
        this.language = 'hi-IN';
        this.recognition = null;
        this.ttsVoice = null;
        this.hasHindiVoice = false;
        this.isListening = false;
        this.isPaused = false;
        this.isSpeaking = false;
        this.activeSpeechMode = null;
        this.stopRequested = false;

        // Single audio element for fallback TTS.
        this.fallbackAudio = new Audio();
        this.isFallbackPlaying = false;

        this.initSTT();
        this.initTTS();
    }

    initSTT() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('Speech Recognition API is not supported in this browser.');
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.lang = this.language;
        this.recognition.continuous = false;
        this.recognition.interimResults = false;
        this.recognition.maxAlternatives = 1;
    }

    initTTS() {
        if (!('speechSynthesis' in window)) return;

        this.loadVoices();
        let attempts = 0;
        const timer = setInterval(() => {
            this.loadVoices();
            attempts++;
            if (this.ttsVoice || attempts > 10) clearInterval(timer);
        }, 500);

        window.speechSynthesis.onvoiceschanged = () => this.loadVoices();
    }

    loadVoices() {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length === 0) return;

        const maleHints = ['male', 'man', 'ravi', 'hemant', 'neeraj', 'abhijeet', 'arun'];
        const isHindiVoice = (voice) =>
            voice.lang.startsWith('hi') ||
            voice.name.toLowerCase().includes('hindi');
        const isLikelyMaleVoice = (voice) => {
            const voiceName = voice.name.toLowerCase();
            return maleHints.some((hint) => voiceName.includes(hint));
        };

        const hindiMaleVoice = voices.find((voice) => isHindiVoice(voice) && isLikelyMaleVoice(voice));
        const hindiVoice = voices.find((voice) => isHindiVoice(voice));
        const fallbackMaleVoice = voices.find((voice) => isLikelyMaleVoice(voice));

        const fallbackVoice =
            fallbackMaleVoice ||
            voices.find((voice) => voice.default) ||
            voices.find((voice) => voice.lang.startsWith('en')) ||
            voices[0];

        this.ttsVoice = hindiMaleVoice || hindiVoice || fallbackVoice || null;
        this.hasHindiVoice = Boolean(hindiMaleVoice || hindiVoice);

        if (hindiMaleVoice) {
            console.log('Found preferred male Hindi TTS voice:', hindiMaleVoice.name);
        } else if (hindiVoice) {
            console.log('Found native Hindi TTS voice:', hindiVoice.name);
        } else if (this.ttsVoice) {
            console.log('No Hindi voice found. Using fallback voice:', this.ttsVoice.name);
        } else {
            console.log('No system TTS voice found. Will use cloud fallback TTS.');
        }
    }

    isSTTSupported() {
        return this.recognition !== null;
    }

    isTTSSupported() {
        return ('speechSynthesis' in window) || (typeof Audio !== 'undefined');
    }

    cancelAll() {
        this.stopRequested = true;
        this.isPaused = false;
        this.isSpeaking = false;
        this.activeSpeechMode = null;

        if ('speechSynthesis' in window && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
            window.speechSynthesis.cancel();
        }

        if (this.isFallbackPlaying) {
            this.fallbackAudio.pause();
            this.fallbackAudio.currentTime = 0;
            this.isFallbackPlaying = false;
        }

        if (this.recognition && this.isListening) {
            this.recognition.stop();
            this.isListening = false;
        }
    }

    async speak(text) {
        this.cancelAll();
        this.stopRequested = false;
        this.isPaused = false;
        this.isSpeaking = true;

        text = this.prepareSpeechText(text);
        if (!text) {
            this.isSpeaking = false;
            return false;
        }

        const chunks = [];
        const rawChunks = text.match(/[^.!?।\n]+[.!?।\n]*/g) || [text];

        for (let chunk of rawChunks) {
            chunk = chunk.trim();
            if (!chunk) continue;

            if (chunk.length > 180) {
                const subchunks = chunk.match(/.{1,180}(?=\s|,|$)/g) || [chunk.substring(0, 180)];
                chunks.push(...subchunks);
            } else {
                chunks.push(chunk);
            }
        }

        let playedAnyChunk = false;

        for (const chunk of chunks) {
            if (this.stopRequested) break;
            if (!chunk.trim()) continue;
            const played = await this._speakChunk(chunk.trim());
            playedAnyChunk = playedAnyChunk || played;
        }

        this.isSpeaking = false;
        this.activeSpeechMode = null;
        this.isPaused = false;
        return playedAnyChunk;
    }

    pause() {
        if (!this.isSpeaking || this.isPaused) return false;

        if (this.activeSpeechMode === 'native' && 'speechSynthesis' in window && window.speechSynthesis.speaking) {
            window.speechSynthesis.pause();
            this.isPaused = true;
            return true;
        }

        if (this.activeSpeechMode === 'fallback' && this.isFallbackPlaying) {
            this.fallbackAudio.pause();
            this.isPaused = true;
            return true;
        }

        return false;
    }

    resume() {
        if (!this.isSpeaking || !this.isPaused) return false;

        if (this.activeSpeechMode === 'native' && 'speechSynthesis' in window) {
            window.speechSynthesis.resume();
            this.isPaused = false;
            return true;
        }

        if (this.activeSpeechMode === 'fallback' && this.isFallbackPlaying) {
            const resumeAttempt = this.fallbackAudio.play();
            if (resumeAttempt && typeof resumeAttempt.catch === 'function') {
                resumeAttempt.catch((error) => {
                    console.error('Fallback audio resume blocked:', error);
                });
            }
            this.isPaused = false;
            return true;
        }

        return false;
    }

    prepareSpeechText(text) {
        return String(text || '')
            // Remove emoji and symbol-style characters that sound awkward in TTS.
            .replace(/[\u{1F300}-\u{1FAFF}]/gu, ' ')
            .replace(/[•→➡️🔊🎙️💬🧠🪞🙏🌟☸]/gu, ' ')
            // Turn emphatic punctuation into a normal sentence stop.
            .replace(/[!?]+/g, '।')
            // Clean repeated danda/periods.
            .replace(/([।.]){2,}/g, '।')
            // Remove brackets and quote marks that do not help narration.
            .replace(/["'“”‘’(){}\[\]]/g, ' ')
            // Normalize whitespace.
            .replace(/\s+/g, ' ')
            .trim();
    }

    _speakChunk(text) {
        return new Promise((resolve) => {
            const playCloudFallback = () => {
                const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=hi&q=${encodeURIComponent(text)}`;
                this.activeSpeechMode = 'fallback';
                this.isFallbackPlaying = true;
                this.fallbackAudio.src = url;

                this.fallbackAudio.onended = () => {
                    this.isFallbackPlaying = false;
                    this.isPaused = false;
                    resolve(true);
                };

                this.fallbackAudio.onerror = () => {
                    this.isFallbackPlaying = false;
                    this.isPaused = false;
                    console.error('Cloud TTS failed for chunk:', text);
                    resolve(false);
                };

                this.fallbackAudio.play().catch((error) => {
                    this.isFallbackPlaying = false;
                    console.error('Fallback audio play blocked:', error);
                    resolve(false);
                });
            };

            const playNativeTTS = () => {
                if (!('speechSynthesis' in window) || !this.ttsVoice) {
                    playCloudFallback();
                    return;
                }

                this.activeSpeechMode = 'native';
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = this.language;
                utterance.voice = this.ttsVoice;
                utterance.volume = 1;
                utterance.rate = this.hasHindiVoice ? 0.95 : 0.9;
                utterance.pitch = 1;

                utterance.onend = () => {
                    this.isPaused = false;
                    resolve(true);
                };
                utterance.onerror = (event) => {
                    this.isPaused = false;
                    console.error('Native TTS failed for chunk:', text, event.error);
                    playCloudFallback();
                };

                try {
                    window.speechSynthesis.speak(utterance);
                } catch (error) {
                    console.error('Native TTS threw an error:', error);
                    playCloudFallback();
                }
            };

            playNativeTTS();
        });
    }

    listen() {
        return this._listenInternal({
            silenceMs: 1200,
            initialSilenceMs: 5000,
            continuous: false,
            interimResults: false
        });
    }

    listenUntilPause(silenceMs = 3000) {
        return this._listenInternal({
            silenceMs,
            initialSilenceMs: 8000,
            continuous: true,
            interimResults: true
        });
    }

    _listenInternal({ silenceMs, initialSilenceMs, continuous, interimResults }) {
        return new Promise((resolve, reject) => {
            if (!this.isSTTSupported()) {
                reject(new Error('Speech recognition not supported in this browser'));
                return;
            }

            if (this.isListening) this.recognition.stop();
            this.isListening = true;
            this.recognition.continuous = continuous;
            this.recognition.interimResults = interimResults;

            let finalTranscript = '';
            let latestTranscript = '';
            let heardSpeech = false;
            let initialTimer = null;
            let silenceTimer = null;

            const clearTimers = () => {
                if (initialTimer) {
                    clearTimeout(initialTimer);
                    initialTimer = null;
                }
                if (silenceTimer) {
                    clearTimeout(silenceTimer);
                    silenceTimer = null;
                }
            };

            const finishListening = (value) => {
                clearTimers();
                this.isListening = false;
                this.recognition.continuous = false;
                this.recognition.interimResults = false;
                resolve((value || '').trim());
            };

            const failListening = (error) => {
                clearTimers();
                this.isListening = false;
                this.recognition.continuous = false;
                this.recognition.interimResults = false;
                reject(error);
            };

            const restartSilenceTimer = () => {
                if (silenceTimer) clearTimeout(silenceTimer);
                silenceTimer = setTimeout(() => {
                    if (this.isListening) {
                        this.recognition.stop();
                    }
                }, silenceMs);
            };

            initialTimer = setTimeout(() => {
                if (this.isListening && !heardSpeech) {
                    this.recognition.stop();
                }
            }, initialSilenceMs);

            this.recognition.onresult = (event) => {
                heardSpeech = true;
                if (initialTimer) {
                    clearTimeout(initialTimer);
                    initialTimer = null;
                }

                let interimTranscript = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscript += `${transcript} `;
                    } else {
                        interimTranscript += transcript;
                    }
                }

                latestTranscript = `${finalTranscript} ${interimTranscript}`.trim();
                console.log('Recognized:', latestTranscript);
                restartSilenceTimer();
            };

            this.recognition.onerror = (event) => {
                console.error('STT Error:', event.error);
                if (event.error === 'no-speech') {
                    finishListening(latestTranscript);
                    return;
                }

                let errorMessage = 'कुछ गलती हो गई। कृपया फिर से प्रयास करें।';
                if (event.error === 'not-allowed') errorMessage = 'माइक्रोफोन की अनुमति नहीं मिली।';
                else if (event.error === 'network') errorMessage = 'इंटरनेट कनेक्शन की समस्या है।';

                failListening(new Error(errorMessage));
            };

            this.recognition.onend = () => {
                if (!this.isListening) return;
                finishListening(latestTranscript || finalTranscript);
            };

            try {
                this.recognition.start();
            } catch (error) {
                failListening(error);
            }
        });
    }
}

window.speechService = new SpeechService();
