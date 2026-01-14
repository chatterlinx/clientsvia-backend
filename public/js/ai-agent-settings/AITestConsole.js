/**
 * ============================================================================
 * AI TEST CONSOLE - Test your agent without making calls
 * ============================================================================
 * 
 * Features:
 * - Type messages and see how AI responds
 * - Simulate full conversations
 * - View failure patterns from BlackBox
 * - Test specific scenarios (angry caller, emergency, etc.)
 * 
 * ============================================================================
 */

class AITestConsole {
    constructor(companyId) {
        // Robust companyId derivation:
        // - Control Plane passes companyId into constructor
        // - Standalone / deep links may rely on query param (?companyId=...)
        // Never allow downstream calls to hit /api/.../undefined/...
        const qp = new URLSearchParams(window.location.search || '');
        this.companyId = companyId || qp.get('companyId') || qp.get('id') || null;

        if (!this.companyId) {
            console.warn('[AI TEST CONSOLE] ⚠️ No companyId provided. Wiring diagnostics will be disabled until a company is selected.');
        }
        this.conversationHistory = [];
        // Generate truly unique session ID with random component
        this.testSessionId = `fresh-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.knownSlots = {};
        this.debugLog = []; // Running log of all turns
        this.forceNewSession = true;  // Always force new session on init
        
        console.log('[AI TEST CONSOLE] 🆕 Initialized with fresh session:', this.testSessionId);
        
        // Voice features
        this.isListening = false;
        this.recognition = null;
        this.voiceEnabled = true;
        this.voiceInfo = null; // ElevenLabs voice info
        this.audioContext = null;
        this.currentAudio = null;
        this.asrMode = 'deepgram'; // production ASR default
        this.isProdAsrActive = false;
        this.dgSocket = null;
        this.micStream = null;
        this.micProcessor = null;
        this.asrStatus = 'idle';
        
        // Initialize speech recognition
        this.initSpeechRecognition();
        
        // Load voice info
        this.loadVoiceInfo();
    }
    
    /**
     * Load ElevenLabs voice info for this company
     */
    async loadVoiceInfo() {
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            // Add cache-bust to always get fresh data
            const response = await fetch(`/api/admin/ai-test/${this.companyId}/voice-info?_=${Date.now()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            const data = await response.json();
            if (data.success) {
                this.voiceInfo = data.voice;
                console.log('[AI Test] Voice loaded:', this.voiceInfo);
                
                // Update voice status badge if modal is already rendered
                const voiceStatus = document.getElementById('voice-status');
                if (voiceStatus) {
                    voiceStatus.innerHTML = this.voiceInfo?.hasVoice 
                        ? `<span style="color: #3fb950;">🔊 ${this.voiceInfo.voiceName || 'ElevenLabs'}</span>`
                        : `<span style="color: #f0883e;">⚠️ No voice set</span>`;
                }
            }
        } catch (error) {
            console.error('[AI Test] Failed to load voice info:', error);
        }
    }
    
    /**
     * Initialize browser speech recognition
     */
    initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            console.warn('[AI Test] Speech recognition not supported in this browser');
            return;
        }
        
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
        
        this.recognition.onresult = (event) => {
            const transcript = Array.from(event.results)
                .map(result => result[0].transcript)
                .join('');
            
            // Update the input field with what's being said
            const input = document.getElementById('test-user-input');
            if (input) input.value = transcript;
            
            // If final result, send the message
            if (event.results[0].isFinal) {
                this.sendMessage(transcript, { asrProvider: 'browser', source: 'test_console' });
            }
        };
        
        this.recognition.onend = () => {
            this.isListening = false;
            this.updateMicButton();
        };
        
        this.recognition.onerror = (event) => {
            console.error('[AI Test] Speech recognition error:', event.error);
            this.isListening = false;
            this.updateMicButton();
            
            if (event.error === 'not-allowed') {
                this.addChatBubble('⚠️ Microphone access denied. Please allow microphone in your browser settings.', 'ai', null, true);
            }
        };
    }
    
    /**
     * Toggle microphone listening
     */
    toggleMic() {
        if (this.asrMode === 'deepgram') {
            if (this.isProdAsrActive) {
                this.stopProductionASR();
            } else {
                this.startProductionASR();
            }
            return;
        }

        // Dev path: browser ASR
        if (!this.recognition) {
            this.addChatBubble('⚠️ Speech recognition not supported in this browser. Try Chrome.', 'ai', null, true);
            return;
        }
        
        if (this.isListening) {
            this.recognition.stop();
            this.isListening = false;
        } else {
            this.recognition.start();
            this.isListening = true;
        }
        
        this.updateMicButton();
    }
    
    /**
     * Update mic button appearance
     */
    updateMicButton() {
        const btn = document.getElementById('mic-button');
        if (!btn) return;
        
        const active = this.asrMode === 'deepgram' ? this.isProdAsrActive : this.isListening;
        if (active) {
            btn.style.background = '#f85149';
            btn.style.animation = 'pulse 1s infinite';
            btn.innerHTML = '🎙️ Listening...';
        } else {
            btn.style.background = '#238636';
            btn.style.animation = 'none';
            btn.innerHTML = '🎤 Speak';
        }
    }

    setAsrMode(mode) {
        const nextMode = mode === 'browser' ? 'browser' : 'deepgram';
        if (this.asrMode === nextMode) return;
        // Stop any active streams before switching
        if (this.isProdAsrActive) {
            this.stopProductionASR();
        }
        if (this.isListening && this.recognition) {
            this.recognition.stop();
            this.isListening = false;
        }
        this.asrMode = nextMode;
        this.updateAsrModeUI();
        this.updateMicButton();
    }

    updateAsrModeUI() {
        const prodBtn = document.getElementById('asr-mode-prod');
        const devBtn = document.getElementById('asr-mode-dev');
        const badge = document.getElementById('asr-mode-badge');

        if (prodBtn && devBtn) {
            if (this.asrMode === 'deepgram') {
                prodBtn.style.background = '#238636';
                prodBtn.style.color = '#fff';
                devBtn.style.background = '#30363d';
                devBtn.style.color = '#c9d1d9';
            } else {
                prodBtn.style.background = '#30363d';
                prodBtn.style.color = '#c9d1d9';
                devBtn.style.background = '#238636';
                devBtn.style.color = '#fff';
            }
        }

        if (badge) {
            badge.textContent = this.asrMode === 'deepgram'
                ? 'ASR: Deepgram (production config)'
                : 'ASR: Browser (dev-only)';
        }
    }

    async startProductionASR() {
        try {
            this.isProdAsrActive = false; // set true only after mic+ws ready
            this.asrStatus = 'connecting';
            this.updateMicButton();

            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const wsScheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
            const url = new URL(`${wsScheme}://${window.location.host}/api/test-console/asr`);
            if (this.companyId) url.searchParams.set('companyId', this.companyId);
            if (token) url.searchParams.set('token', token);

            this.dgSocket = new WebSocket(url.toString());
            this.dgSocket.binaryType = 'arraybuffer';

            this.dgSocket.onopen = async () => {
                this.asrStatus = 'streaming';
                // Start microphone capture after WS is ready
                try {
                    await this.startMicCapture();
                    this.isProdAsrActive = true;
                } catch (err) {
                    console.error('[AI Test] Mic capture failed', err);
                    this.addChatBubble('⚠️ Microphone capture failed. Check permissions and try again.', 'ai', null, true);
                    this.stopProductionASR();
                    return;
                }
                this.updateMicButton();
            };

            this.dgSocket.onmessage = (event) => {
                try {
                    const payload = JSON.parse(event.data);
                    if (payload.type === 'final' && payload.text) {
                        this.sendMessage(payload.text, { asrProvider: 'deepgram', source: 'test_console' });
                    }
                } catch (err) {
                    console.error('[AI Test] Failed to parse ASR message', err);
                }
            };

            this.dgSocket.onerror = (err) => {
                console.error('[AI Test] Deepgram WS error', err);
                this.addChatBubble('⚠️ Production ASR error. Falling back to dev mode.', 'ai', null, true);
                this.stopProductionASR();
            };

            this.dgSocket.onclose = () => {
                this.stopProductionASR();
            };
        } catch (error) {
            console.error('[AI Test] Failed to start production ASR', error);
            this.addChatBubble('⚠️ Unable to start production ASR.', 'ai', null, true);
            this.stopProductionASR();
        }
    }

    async startMicCapture() {
        if (this.micProcessor) return;
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('getUserMedia not available');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000,
                noiseSuppression: true,
                echoCancellation: true
            }
        });
        this.micStream = stream;
        this.audioContext = new AudioContext({ sampleRate: 16000 });
        try {
            await this.audioContext.resume();
        } catch (e) {
            console.warn('[AI Test] AudioContext resume warning', e);
        }
        const source = this.audioContext.createMediaStreamSource(stream);
        const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (event) => {
            if (!this.dgSocket || this.dgSocket.readyState !== WebSocket.OPEN) return;
            const input = event.inputBuffer.getChannelData(0);
            // Convert Float32 to 16-bit PCM
            const pcm = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) {
                const s = Math.max(-1, Math.min(1, input[i]));
                pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            this.dgSocket.send(pcm.buffer);
        };
        source.connect(processor);
        processor.connect(this.audioContext.destination);
        this.micProcessor = processor;
    }

    stopProductionASR() {
        this.asrStatus = 'idle';
        this.isProdAsrActive = false;
        if (this.dgSocket && this.dgSocket.readyState === WebSocket.OPEN) {
            this.dgSocket.close();
        }
        this.dgSocket = null;
        if (this.micProcessor) {
            try { this.micProcessor.disconnect(); } catch (e) {}
        }
        if (this.audioContext) {
            try { this.audioContext.close(); } catch (e) {}
        }
        if (this.micStream) {
            this.micStream.getTracks().forEach(t => t.stop());
        }
        this.audioContext = null;
        this.micProcessor = null;
        this.micStream = null;
        this.updateMicButton();
    }
    
    /**
     * Speak the AI response using ElevenLabs TTS
     */
    async speakResponse(text) {
        if (!this.voiceEnabled) return;
        
        // Stop any current audio
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
        
        // Check if voice is configured
        if (!this.voiceInfo?.hasVoice) {
            console.warn('[AI Test] No ElevenLabs voice configured, using browser TTS fallback');
            this.speakBrowserFallback(text);
            return;
        }
        
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const response = await fetch(`/api/admin/ai-test/${this.companyId}/tts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ text })
            });
            
            const data = await response.json();
            
            if (data.success && data.audio) {
                // Play the audio
                const audioBlob = this.base64ToBlob(data.audio, 'audio/mpeg');
                const audioUrl = URL.createObjectURL(audioBlob);
                
                this.currentAudio = new Audio(audioUrl);
                this.currentAudio.play();
                
                // Clean up URL after playback
                this.currentAudio.onended = () => {
                    URL.revokeObjectURL(audioUrl);
                };
                
                console.log('[AI Test] 🔊 Playing ElevenLabs audio:', this.voiceInfo.voiceName);
            } else {
                console.error('[AI Test] TTS failed:', data.error);
                this.speakBrowserFallback(text);
            }
        } catch (error) {
            console.error('[AI Test] TTS error:', error);
            this.speakBrowserFallback(text);
        }
    }
    
    /**
     * Convert base64 to blob
     */
    base64ToBlob(base64, mimeType) {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    }
    
    /**
     * Browser TTS fallback (when ElevenLabs not available)
     */
    speakBrowserFallback(text) {
        if (!window.speechSynthesis) return;
        
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => 
            v.name.includes('Samantha') || 
            v.name.includes('Karen') || 
            v.name.includes('Google US English Female') ||
            (v.lang === 'en-US' && v.name.includes('Female'))
        ) || voices.find(v => v.lang === 'en-US') || voices[0];
        
        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }
        
        window.speechSynthesis.speak(utterance);
    }
    
    /**
     * Toggle voice output
     */
    toggleVoice() {
        this.voiceEnabled = !this.voiceEnabled;
        const btn = document.getElementById('voice-toggle');
        if (btn) {
            btn.innerHTML = this.voiceEnabled ? '🔊 Voice On' : '🔇 Voice Off';
            btn.style.background = this.voiceEnabled ? '#238636' : '#30363d';
        }
    }

    /**
     * Open the test console modal
     */
    async open() {
        // Reload voice info to get latest settings (in case user changed voice in settings)
        await this.loadVoiceInfo();
        
        const modal = document.createElement('div');
        modal.id = 'ai-test-console-modal';
        modal.innerHTML = this.render();
        document.body.appendChild(modal);
        
        this.attachEventListeners();
        this.loadFailureReport();
        this.updateAsrModeUI();
    }

    /**
     * Render the console UI
     */
    render() {
        return `
            <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.85); z-index: 10000; display: flex; align-items: center; justify-content: center;">
                <div style="background: #0d1117; border: 1px solid #30363d; border-radius: 12px; width: 95%; max-width: 1200px; height: 90vh; display: flex; flex-direction: column; overflow: hidden;">
                    
                    <!-- Header -->
                    <div style="padding: 16px 20px; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <h2 style="margin: 0; color: #58a6ff; font-size: 18px;">🧪 AI Test Console</h2>
                            <p style="margin: 4px 0 0 0; color: #8b949e; font-size: 12px;">Test conversations without making real calls</p>
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div id="voice-status" style="background: #21262d; padding: 6px 12px; border-radius: 6px; font-size: 11px;">
                                ${this.voiceInfo?.hasVoice 
                                    ? `<span style="color: #3fb950;">🔊 ${this.voiceInfo.voiceName || 'ElevenLabs'}</span>`
                                    : `<span style="color: #f0883e;">⚠️ No voice set</span>`
                                }
                            </div>
                            <button onclick="document.getElementById('ai-test-console-modal').remove()" 
                                style="background: none; border: none; color: #8b949e; font-size: 24px; cursor: pointer;">×</button>
                        </div>
                    </div>
                    
                    <!-- Main Content -->
                    <div style="flex: 1; display: flex; overflow: hidden;">
                        
                        <!-- Left: Chat Panel -->
                        <div style="flex: 1; display: flex; flex-direction: column; border-right: 1px solid #30363d;">
                            
                            <!-- Quick Scenarios -->
                            <div style="padding: 12px; border-bottom: 1px solid #30363d; display: flex; gap: 8px; flex-wrap: wrap;">
                                <span style="color: #8b949e; font-size: 12px; padding: 6px 0;">Test:</span>
                                <button onclick="window.aiTestConsole.sendScenario('basic')" class="scenario-btn">👋 Basic Call</button>
                                <button onclick="window.aiTestConsole.sendScenario('frustrated')" class="scenario-btn">😤 Frustrated</button>
                                <button onclick="window.aiTestConsole.sendScenario('emergency')" class="scenario-btn">🚨 Emergency</button>
                                <button onclick="window.aiTestConsole.sendScenario('joking')" class="scenario-btn">😄 Joking</button>
                                <button onclick="window.aiTestConsole.sendScenario('question')" class="scenario-btn">❓ Question</button>
                                <button onclick="window.aiTestConsole.sendScenario('booking')" class="scenario-btn">📅 Full Booking</button>
                            </div>
                            
                            <!-- Chat Messages -->
                            <div id="test-chat-messages" style="flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px;">
                                <div style="text-align: center; color: #8b949e; padding: 40px;">
                                    <div style="font-size: 48px; margin-bottom: 12px;">💬</div>
                                    <p>Start typing to test the AI agent</p>
                                    <p style="font-size: 12px;">Or click a scenario above</p>
                                </div>
                            </div>
                            
                            <!-- Voice Controls -->
                            <div style="padding: 8px 16px; border-top: 1px solid #30363d; display: flex; gap: 10px; align-items: center; background: #161b22; flex-wrap: wrap;">
                                <span style="color: #8b949e; font-size: 12px;">🎙️ Voice Mode:</span>
                                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                                    <button id="asr-mode-prod" onclick="window.aiTestConsole.setAsrMode('deepgram')" 
                                        style="padding: 6px 10px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px;">
                                        Production ASR (Deepgram)
                                    </button>
                                    <button id="asr-mode-dev" onclick="window.aiTestConsole.setAsrMode('browser')" 
                                        style="padding: 6px 10px; background: #30363d; color: #c9d1d9; border: none; border-radius: 6px; cursor: pointer; font-size: 12px;">
                                        Dev (Browser ASR)
                                    </button>
                                </div>
                                <div id="asr-mode-badge" style="color: #8b949e; font-size: 12px;">ASR: Deepgram (production config)</div>
                                <button id="mic-button" onclick="window.aiTestConsole.toggleMic()" 
                                    style="padding: 8px 16px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; transition: all 0.2s;">
                                    🎤 Speak
                                </button>
                                <button id="voice-toggle" onclick="window.aiTestConsole.toggleVoice()" 
                                    style="padding: 8px 16px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;">
                                    🔊 Voice On
                                </button>
                                <span style="color: #6e7681; font-size: 11px; margin-left: auto;">Click "Speak" and talk — AI will respond with voice!</span>
                            </div>
                            
                            <!-- Text Input -->
                            <div style="padding: 16px; border-top: 1px solid #30363d; display: flex; gap: 10px;">
                                <input type="text" id="test-user-input" placeholder="Or type a message..." 
                                    style="flex: 1; padding: 12px 16px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; color: #c9d1d9; font-size: 14px;"
                                    onkeypress="if(event.key==='Enter') window.aiTestConsole.sendMessage()">
                                <button onclick="window.aiTestConsole.sendMessage()" 
                                    style="padding: 12px 24px; background: #58a6ff; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
                                    Send
                                </button>
                                <button onclick="window.aiTestConsole.resetConversation()" 
                                    style="padding: 12px 16px; background: #30363d; color: #c9d1d9; border: none; border-radius: 8px; cursor: pointer;">
                                    🔄
                                </button>
                            </div>
                        </div>
                        
                        <!-- Right: Report Panel -->
                        <div style="width: 400px; display: flex; flex-direction: column; overflow: hidden;">
                            
                            <!-- Tabs -->
                            <div style="display: flex; border-bottom: 1px solid #30363d;">
                                <button id="tab-analysis" onclick="window.aiTestConsole.switchTab('analysis')" 
                                    style="flex: 1; padding: 12px; background: #161b22; border: none; color: #58a6ff; cursor: pointer; border-bottom: 2px solid #58a6ff;">
                                    📊 Analysis
                                </button>
                                <button id="tab-failures" onclick="window.aiTestConsole.switchTab('failures')" 
                                    style="flex: 1; padding: 12px; background: transparent; border: none; color: #8b949e; cursor: pointer;">
                                    ⚠️ Failures
                                </button>
                                <button id="tab-wiring" onclick="window.aiTestConsole.switchTab('wiring')" 
                                    style="flex: 1; padding: 12px; background: transparent; border: none; color: #8b949e; cursor: pointer;">
                                    🔌 Wiring
                                </button>
                            </div>
                            
                            <!-- Tab Content -->
                            <div id="report-content" style="flex: 1; overflow-y: auto; padding: 16px;">
                                <div style="text-align: center; color: #8b949e; padding: 20px;">
                                    Loading analysis...
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <style>
                .scenario-btn {
                    padding: 6px 12px;
                    background: #21262d;
                    border: 1px solid #30363d;
                    border-radius: 6px;
                    color: #c9d1d9;
                    cursor: pointer;
                    font-size: 12px;
                    transition: all 0.2s;
                }
                .scenario-btn:hover {
                    background: #30363d;
                    border-color: #58a6ff;
                }
                .chat-bubble-user {
                    background: #238636;
                    color: white;
                    padding: 10px 14px;
                    border-radius: 12px 12px 4px 12px;
                    max-width: 80%;
                    align-self: flex-end;
                }
                .chat-bubble-ai {
                    background: #21262d;
                    color: #c9d1d9;
                    padding: 10px 14px;
                    border-radius: 12px 12px 12px 4px;
                    max-width: 80%;
                    align-self: flex-start;
                    border: 1px solid #30363d;
                }
                .chat-bubble-ai.error {
                    border-color: #f85149;
                    background: #2a1c1c;
                }
            </style>
        `;
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        window.aiTestConsole = this;
    }

    /**
     * Send a message to the AI
     * 
     * CRITICAL: Uses the unified chat API (/api/chat/message)
     * This means ALL test interactions are treated as REAL customer interactions:
     * - Sessions appear in Call Center with channel: 'website'
     * - Customer profiles are created/updated
     * - AI doesn't know it's a "test"
     */
    async sendMessage(customMessage = null, meta = {}) {
        const input = document.getElementById('test-user-input');
        const message = customMessage || input.value.trim();
        if (!message) return;
        
        input.value = '';
        
        // Add user message to chat
        this.addChatBubble(message, 'user');
        
        // Show typing indicator
        const typingId = this.addTypingIndicator();
        
        try {
            // Use the unified chat API - same as website visitors
            // Include auth token if available (for debugging/admin features)
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const headers = {
                'Content-Type': 'application/json'
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            const response = await fetch(`/api/chat/message`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    companyId: this.companyId,
                    message,
                    sessionId: this.testSessionId,
                    includeDebug: true,  // Get debug info for the console
                    forceNewSession: this.forceNewSession || false,  // Force new session after reset
                    metadata: (typeof meta === 'object' && meta !== null) ? meta : {},
                    visitorInfo: {
                        userAgent: navigator.userAgent,
                        pageUrl: window.location.href
                    }
                })
            });
            
            // Clear the force flag after first message
            if (this.forceNewSession) {
                console.log('[AI TEST CONSOLE] 🆕 forceNewSession sent, clearing flag');
                this.forceNewSession = false;
            }
            
            const data = await response.json();
            
            // Remove typing indicator
            document.getElementById(typingId)?.remove();
            
            if (data.success) {
                // ═══════════════════════════════════════════════════════════════
                // UPDATE EVERYTHING SIMULTANEOUSLY
                // ═══════════════════════════════════════════════════════════════
                
                // Map new API response format to expected format
                // debug: full debug payload (slots, bookingConfig, etc.)
                // debugSnapshot: compact truth bundle used for wiring evidence (templateRefs, scenarioCount, killSwitches)
                const debug = data.debug || {};
                const debugSnapshot = data.debugSnapshot || debug.debugSnapshot || null;
                // Slots can come from multiple places - prioritize slotDiagnostics for accuracy
                const collectedSlots = debug.slotDiagnostics?.slotsAfterMerge || 
                                       data.slotsCollected || 
                                       data.metadata?.slots || 
                                       {};
                const metadata = {
                    latencyMs: debug.latencyMs,
                    tokensUsed: debug.tokensUsed,
                    // V22: Use mode from v22BlackBox, fallback to phase for backward compat
                    mode: debug.v22BlackBox?.mode || debug.mode || debug.phase || 'DISCOVERY',
                    slots: collectedSlots,
                    needsInfo: null
                };
                
                // 1. Save debug info FIRST
                this.lastDebug = debug;
                this.lastMetadata = metadata;
                
                // Store session ID for future requests
                if (data.sessionId) {
                    this.testSessionId = data.sessionId;
                }
                
                // Add to running debug log
                const source = debug.responseSource === 'quick_answer' ? 'QUICK_ANSWER' : 
                               debug.responseSource === 'triage' ? 'TRIAGE' : 
                               debug.responseSource === 'template' ? 'TEMPLATE' : 'LLM';
                               
                this.debugLog.push({
                    turn: debug.turnNumber || this.debugLog.length + 1,
                    userMessage: message,
                    aiResponse: data.response,
                    source,
                    latencyMs: debug.latencyMs,
                    tokens: debug.tokensUsed,
                    // V22: Use mode from v22BlackBox, fallback to phase for backward compat
                    mode: debug.v22BlackBox?.mode || debug.mode || debug.phase || 'DISCOVERY',
                    customerContext: debug.customerContext,
                    runningSummary: debug.runningSummary,
                    slotsCollected: debug.slotsCollected,
                    historySent: debug.historySent || 0,
                    bookingConfig: debug.bookingConfig,  // Shows what prompts AI was given
                    slotDiagnostics: debug.slotDiagnostics,  // Slot extraction details
                    llmBrain: debug.llmBrain,  // 🧠 LLM decision details
                    dynamicFlow: debug.dynamicFlow,  // 🧠 V41: Dynamic Flow Engine trace
                    timestamp: new Date().toISOString(),
                    // 🎯 LIVE SESSION INSPECTOR: Store FULL debug for inspector access
                    debug: debug,  // Full debug object for Live Session Inspector
                    debugSnapshot  // Truth bundle for wiring diagnostics
                });
                
                console.log('[AI Test] Response received:', {
                    source,
                    latency: debug.latencyMs,
                    phase: debug.phase,
                    customer: debug.customerContext?.name || 'unknown'
                });
                
                // 2. Update conversation history
                this.conversationHistory.push(
                    { role: 'user', content: message },
                    { role: 'assistant', content: data.response }
                );
                
                // 3. Update slots if any collected (from slotDiagnostics or top-level)
                const slotsToMerge = debug.slotDiagnostics?.slotsAfterMerge || 
                                     data.slotsCollected || 
                                     {};
                if (Object.keys(slotsToMerge).length > 0) {
                    this.knownSlots = { ...this.knownSlots, ...slotsToMerge };
                    console.log('[AI Test] 📦 Slots updated:', this.knownSlots);
                }
                
                // 4. Add AI response bubble with source badge
                this.addChatBubble(data.response, 'ai', metadata, false, debug);
                
                // 5. Update analysis panel immediately (both panels sync)
                this.updateAnalysis(metadata);
                
                // 6. Flash the debug panel to show it updated
                const debugPanel = document.querySelector('[style*="border: 1px solid #f0883e"]');
                if (debugPanel) {
                    debugPanel.style.boxShadow = '0 0 10px #f0883e';
                    setTimeout(() => { debugPanel.style.boxShadow = 'none'; }, 500);
                }
                
                // 7. Speak the response (async, doesn't block)
                this.speakResponse(data.response);
            } else {
                this.addChatBubble(`Error: ${data.error}`, 'ai', null, true);
            }
            
        } catch (error) {
            document.getElementById(typingId)?.remove();
            this.addChatBubble(`Connection error: ${error.message}`, 'ai', null, true);
        }
    }

    /**
     * Add a chat bubble to the conversation
     */
    addChatBubble(text, sender, metadata = null, isError = false, debug = null) {
        const container = document.getElementById('test-chat-messages');
        
        // Clear placeholder if first message
        if (container.querySelector('div[style*="text-align: center"]')) {
            container.innerHTML = '';
        }
        
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble-${sender}${isError ? ' error' : ''}`;
        
        let html = text;
        
        // Add metadata for AI responses
        if (sender === 'ai' && metadata && !isError) {
            // Determine the source of this response (use passed debug or fallback to lastDebug)
            const debugInfo = debug || this.lastDebug || {};
            const source = this.getResponseSource(debugInfo, metadata);
            
            // Check if this might be a wiring issue (fallback, no scenarios, etc.)
            const mightBeWiringIssue = source.label === 'FALLBACK' || 
                                       source.label === 'LLM' ||
                                       debugInfo.scenarioCount === 0 ||
                                       debugInfo.noScenariosAvailable;
            
            html += `
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 11px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                    <!-- Source Badge -->
                    <span style="background: ${source.color}; color: ${source.textColor}; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 10px;">
                        ${source.icon} ${source.label}
                    </span>
                    ${metadata.latencyMs ? `<span style="color: ${metadata.latencyMs < 500 ? '#3fb950' : metadata.latencyMs < 1500 ? '#f0883e' : '#f85149'};">⚡ ${metadata.latencyMs}ms</span>` : ''}
                    ${metadata.tokensUsed ? `<span style="color: #8b949e;">🎯 ${metadata.tokensUsed} tokens</span>` : ''}
                    ${metadata.mode ? `<span style="color: #58a6ff;">📍 ${metadata.mode}</span>` : ''}
                    ${mightBeWiringIssue ? `
                        <button onclick="window.aiTestConsole.switchTab('wiring')" 
                            style="background: #38bdf8; color: #000; border: none; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; cursor: pointer;">
                            🔌 Check Wiring
                        </button>
                    ` : ''}
                </div>
            `;
        }
        
        // Add "Check Wiring" for error responses
        if (isError) {
            html += `
                <div style="margin-top: 8px;">
                    <button onclick="window.aiTestConsole.switchTab('wiring')" 
                        style="background: #38bdf8; color: #000; border: none; padding: 6px 12px; border-radius: 4px; font-size: 11px; font-weight: 700; cursor: pointer;">
                        🔌 Check Wiring for Issues
                    </button>
                </div>
            `;
        }
        
        bubble.innerHTML = html;
        container.appendChild(bubble);
        container.scrollTop = container.scrollHeight;
    }
    
    /**
     * Determine the source of an AI response
     */
    getResponseSource(debug, metadata) {
        // Check what generated this response
        if (debug.wasQuickAnswer) {
            return {
                label: 'QUICK ANSWER',
                icon: '⚡',
                color: '#238636',
                textColor: 'white',
                description: 'Matched FAQ database'
            };
        }
        
        if (debug.triageMatched) {
            return {
                label: 'TRIAGE',
                icon: '🔍',
                color: '#1f6feb',
                textColor: 'white',
                description: 'Matched triage card'
            };
        }
        
        if (debug.wasEmergency) {
            return {
                label: 'EMERGENCY',
                icon: '🚨',
                color: '#da3633',
                textColor: 'white',
                description: 'Emergency detected'
            };
        }
        
        if (debug.wasFallback) {
            return {
                label: 'FALLBACK',
                icon: '⚠️',
                color: '#f0883e',
                textColor: 'white',
                description: 'LLM failed, used fallback'
            };
        }
        
        // Default: LLM generated
        return {
            label: 'LLM',
            icon: '🤖',
            color: '#8b5cf6',
            textColor: 'white',
            description: 'Generated by GPT-4o-mini'
        };
    }

    /**
     * Add typing indicator
     */
    addTypingIndicator() {
        const container = document.getElementById('test-chat-messages');
        const id = `typing-${Date.now()}`;
        
        const indicator = document.createElement('div');
        indicator.id = id;
        indicator.className = 'chat-bubble-ai';
        indicator.innerHTML = '<span style="animation: pulse 1s infinite;">●</span> <span style="animation: pulse 1s infinite 0.2s;">●</span> <span style="animation: pulse 1s infinite 0.4s;">●</span>';
        indicator.style.cssText = 'display: flex; gap: 4px;';
        
        container.appendChild(indicator);
        container.scrollTop = container.scrollHeight;
        
        return id;
    }

    /**
     * Send a pre-defined scenario
     */
    async sendScenario(type) {
        this.resetConversation();
        
        const scenarios = {
            basic: [
                "Hi, my AC isn't working"
            ],
            frustrated: [
                "This is ridiculous, I've been waiting all day and nobody showed up!",
                "I called yesterday and nothing happened!"
            ],
            emergency: [
                "I smell gas in my house! What do I do?!"
            ],
            joking: [
                "Man, I'm dying here! It's like an oven in my house haha"
            ],
            question: [
                "How much do you charge for a tune-up?",
                "Do you service Fort Myers?"
            ],
            booking: [
                "I need someone to come look at my AC",
                "John Smith",
                "239-555-1234",
                "123 Main Street, Naples",
                "Tomorrow morning works"
            ]
        };
        
        const messages = scenarios[type] || scenarios.basic;
        
        for (const msg of messages) {
            await this.sendMessage(msg);
            await new Promise(r => setTimeout(r, 1000)); // Small delay between messages
        }
    }

    /**
     * Reset the conversation - COMPLETELY FRESH START
     */
    resetConversation() {
        // Generate truly unique session ID with random component
        const uniqueId = `fresh-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        console.log('[AI TEST CONSOLE] 🔄 RESET: Old session:', this.testSessionId);
        console.log('[AI TEST CONSOLE] 🔄 RESET: New session:', uniqueId);
        
        this.conversationHistory = [];
        this.knownSlots = {};
        this.lastDebug = null;
        this.debugLog = [];
        this.testSessionId = uniqueId;
        this.forceNewSession = true;  // Force backend to create new session on next message
        
        const container = document.getElementById('test-chat-messages');
        container.innerHTML = `
            <div style="text-align: center; color: #8b949e; padding: 40px;">
                <div style="font-size: 48px; margin-bottom: 12px;">💬</div>
                <p>Conversation reset!</p>
                <p style="font-size: 12px;">Start a new test</p>
            </div>
        `;
        
        this.updateAnalysis();
    }
    
    /**
     * Copy FULL diagnostic JSON for troubleshooting (includes everything)
     */
    copyFullDiagnostic() {
        const lastEntry = this.debugLog[this.debugLog.length - 1];
        const diagnostic = {
            _timestamp: new Date().toISOString(),
            _purpose: 'FULL DIAGNOSTIC FOR TROUBLESHOOTING',
            
            session: {
                sessionId: this.testSessionId,
                companyId: this.companyId,
                totalTurns: this.debugLog.length,
                knownSlots: this.knownSlots
            },
            
            liveInspector: {
                mode: lastEntry?.debug?.v22BlackBox?.mode || lastEntry?.mode || 'UNKNOWN',
                activeFlow: lastEntry?.dynamicFlow || null,
                bookingConfig: lastEntry?.bookingConfig || lastEntry?.debug?.bookingConfig || null,
                slotDiagnostics: lastEntry?.slotDiagnostics || lastEntry?.debug?.slotDiagnostics || null
            },
            
            lastTurn: lastEntry ? {
                turn: lastEntry.turn,
                userMessage: lastEntry.userMessage,
                aiResponse: lastEntry.aiResponse,
                source: lastEntry.source,
                mode: lastEntry.mode,
                latencyMs: lastEntry.latencyMs,
                tokens: lastEntry.tokens
            } : null,
            
            // Full debug from last turn (all the details)
            fullDebug: lastEntry?.debug || this.lastDebug || null,
            
            // All turns summary
            allTurns: this.debugLog.map(e => ({
                turn: e.turn,
                user: e.userMessage?.substring(0, 50),
                ai: e.aiResponse?.substring(0, 50),
                source: e.source,
                mode: e.mode
            }))
        };
        
        const json = JSON.stringify(diagnostic, null, 2);
        navigator.clipboard.writeText(json).then(() => {
            alert('✅ Full diagnostic copied to clipboard!\n\nPaste it to share for troubleshooting.');
        }).catch(err => {
            console.error('Copy failed:', err);
            // Fallback: show in console
            console.log('=== FULL DIAGNOSTIC ===');
            console.log(json);
            alert('Could not copy to clipboard. Check browser console for the diagnostic.');
        });
    }
    
    /**
     * Copy full debug log to clipboard for sharing
     */
    copyDebug() {
        const separator = '═'.repeat(50);
        const thinSeparator = '─'.repeat(50);
        
        // Calculate totals
        const totalTokens = this.debugLog.reduce((sum, entry) => sum + (entry.tokens || 0), 0);
        const totalLatency = this.debugLog.reduce((sum, entry) => sum + (entry.latencyMs || 0), 0);
        // GPT-4o-mini pricing: ~$0.15 per 1M input tokens, ~$0.60 per 1M output tokens
        // Rough estimate: ~$0.30 per 1M tokens average
        const estimatedCost = (totalTokens / 1000000) * 0.30;
        
        // Get engine version from last debug entry
        const lastEngineVersion = this.debugLog.length > 0 ? 
            (this.debugLog[this.debugLog.length - 1].debug?.engineVersion || 'UNKNOWN') : 'NO_TURNS';
        
        let text = `${separator}
AI TEST CONSOLE - FULL DEBUG LOG
${separator}
🔧 ENGINE VERSION: ${lastEngineVersion}
Session: ${this.testSessionId}
Total Turns: ${this.debugLog.length}
Slots Collected: ${Object.entries(this.knownSlots).filter(([k,v]) => v).map(([k,v]) => `${k}=${v}`).join(', ') || 'None'}
${separator}
💰 CONVERSATION COST:
   Total Tokens: ${totalTokens.toLocaleString()}
   Total Latency: ${(totalLatency / 1000).toFixed(1)}s
   Est. Cost: $${estimatedCost.toFixed(6)} (~$${(estimatedCost * 1000).toFixed(3)} per 1000 calls)
${separator}

`;
        
        // Add each turn
        this.debugLog.forEach((entry, i) => {
            text += `${thinSeparator}
TURN ${entry.turn}
${thinSeparator}
Source: ${entry.source}
Latency: ${entry.latencyMs}ms | Tokens: ${entry.tokens} | Mode: ${entry.mode}
History Sent: ${entry.historySent} messages

USER: ${entry.userMessage}

AI: ${entry.aiResponse}

`;
            // Add thinking process if available
            if (entry.thinkingProcess) {
                const tp = entry.thinkingProcess;
                text += `🧠 AI THINKING PROCESS:
  1. Quick Answers: ${tp.quickAnswers?.result || 'N/A'}
  2. Triage: ${tp.triage?.result || 'N/A'}
  3. Emergency: ${tp.emergency?.result || 'N/A'}
  4. Response Source: ${tp.responseSource?.result || 'N/A'}

`;
            }
            
            // 🚨 Show error info if LLM failed (llmBrain contains the error from HybridReceptionistLLM)
            if (entry.llmBrain?.error) {
                const errorInfo = entry.llmBrain;
                text += `🚨 ERROR DETECTED (LLM call failed):
  Error: ${errorInfo.errorMessage || 'Unknown error'}
  Type: ${errorInfo.errorName || errorInfo.errorType || 'N/A'}
  Code: ${errorInfo.errorCode || 'N/A'}
  Engine Action: ${errorInfo.engineAction?.error || 'N/A'}
  LLM Decision: ${typeof errorInfo.llmDecision === 'object' ? JSON.stringify(errorInfo.llmDecision) : errorInfo.llmDecision || 'N/A'}
  Prompt Summary: ${typeof errorInfo.promptSummary === 'object' ? JSON.stringify(errorInfo.promptSummary) : errorInfo.promptSummary || 'N/A'}

`;
            }
            
            // Add booking config if available - shows what prompts AI was given
            if (entry.bookingConfig) {
                const bc = entry.bookingConfig;
                let slotsInfo = '';
                if (bc.slots && bc.slots.length > 0) {
                    slotsInfo = bc.slots.map(s => {
                        let slotLine = `    - [${s.id}] "${s.question}" ${s.required ? '(required)' : '(optional)'}`;
                        
                        // Show name options
                        if (s.nameOptions) {
                            const opts = [];
                            if (s.nameOptions.askFullName) opts.push('askFullName✅');
                            if (s.nameOptions.useFirstNameOnly) opts.push('useFirstNameOnly✅');
                            if (s.nameOptions.askMissingNamePart) opts.push('askMissingNamePart✅');
                            else opts.push('askMissingNamePart❌');
                            slotLine += `\n      👤 Name: ${opts.join(', ')}`;
                        }
                        
                        // Show phone options
                        if (s.phoneOptions) {
                            const opts = [];
                            if (s.phoneOptions.offerCallerId) opts.push('offerCallerId✅');
                            if (s.phoneOptions.acceptTextMe) opts.push('acceptTextMe✅');
                            if (s.phoneOptions.breakDownIfUnclear) opts.push('breakDownIfUnclear✅');
                            if (opts.length) slotLine += `\n      📞 Phone: ${opts.join(', ')}`;
                        }
                        
                        // Show address options
                        if (s.addressOptions) {
                            slotLine += `\n      📍 Address: level=${s.addressOptions.addressConfirmLevel}`;
                            if (s.addressOptions.acceptPartialAddress) slotLine += ', acceptPartial✅';
                            if (s.addressOptions.breakDownIfUnclear) slotLine += ', breakDownIfUnclear✅';
                        }
                        
                        // Show confirm back
                        if (s.confirmBack) {
                            slotLine += `\n      🔄 ConfirmBack: "${s.confirmBack}"`;
                        }
                        
                        return slotLine;
                    }).join('\n');
                } else {
                    slotsInfo = '    (none configured)';
                }
                
                text += `📋 BOOKING CONFIG (What AI sees):
  Source: ${bc.source || 'N/A'} ${bc.isConfigured ? '✅' : '⚠️ NOT CONFIGURED'}
  Slots with Options:
${slotsInfo}

`;
            }
        });
        
        text += `${separator}
END OF DEBUG LOG
${separator}`;
        
        navigator.clipboard.writeText(text).then(() => {
            // Show brief toast instead of alert
            const toast = document.createElement('div');
            toast.style.cssText = 'position: fixed; bottom: 20px; right: 20px; background: #238636; color: white; padding: 12px 20px; border-radius: 8px; font-size: 14px; z-index: 99999;';
            toast.textContent = '✅ Debug log copied!';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2000);
        }).catch(err => {
            console.error('Failed to copy:', err);
            prompt('Copy this debug info:', text);
        });
    }

    /**
     * Switch between analysis, failures, and wiring tabs
     */
    switchTab(tab) {
        // Reset all tabs
        const tabs = ['analysis', 'failures', 'wiring'];
        const colors = { analysis: '#58a6ff', failures: '#f85149', wiring: '#38bdf8' };
        
        tabs.forEach(t => {
            const btn = document.getElementById(`tab-${t}`);
            if (btn) {
                btn.style.background = tab === t ? '#161b22' : 'transparent';
                btn.style.color = tab === t ? colors[t] : '#8b949e';
                btn.style.borderBottom = tab === t ? `2px solid ${colors[t]}` : 'none';
            }
        });
        
        if (tab === 'analysis') {
            this.updateAnalysis();
        } else if (tab === 'failures') {
            this.loadFailureReport();
        } else if (tab === 'wiring') {
            this.loadWiringDiagnostics();
        }
    }
    
    /**
     * Load wiring diagnostics - EVIDENCE-BASED using last debugSnapshot
     * NOT heuristic guessing - uses actual test evidence
     */
    async loadWiringDiagnostics() {
        const content = document.getElementById('report-content');
        content.innerHTML = `
            <div style="text-align: center; color: #8b949e; padding: 20px;">
                <span style="animation: pulse 1s infinite;">●</span> Loading wiring diagnostics...
            </div>
        `;
        
        try {
            if (!this.companyId) {
                content.innerHTML = `
                    <div style="background:#2d1c1c; border:1px solid #f85149; border-radius:8px; padding:12px; color:#fca5a5; font-size:12px;">
                        ❌ Cannot run wiring diagnostics: <strong>companyId is missing</strong>.<br>
                        Open Test Agent from Control Plane (it injects the companyId), or append <code style="background:#0d1117; padding:2px 6px; border-radius:6px;">?companyId=...</code> to the URL.
                    </div>
                `;
                return;
            }
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            
            // Get last debug snapshot from test session (evidence-first)
            // Prefer the compact truth bundle that includes templateReferences/scenarioCount/killSwitches.
            const lastDebugEntry = this.debugLog.length > 0 ? this.debugLog[this.debugLog.length - 1] : null;
            const debugSnapshot = lastDebugEntry?.debugSnapshot || lastDebugEntry?.debug?.debugSnapshot || null;
            
            let diagnostics;
            
            if (debugSnapshot) {
                // EVIDENCE-BASED: Use actual debugSnapshot from test
                console.log('[AI Test] 🔬 Running evidence-based diagnosis with debugSnapshot');
                const response = await fetch(`/api/admin/wiring-status/${this.companyId}/diagnose`, {
                    method: 'POST',
                    headers: { 
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ debugSnapshot })
                });
                diagnostics = await response.json();
                diagnostics._hasEvidence = true;
            } else {
                // FALLBACK: Quick diagnostics (no test evidence yet)
                console.log('[AI Test] ⚠️ No test run yet, using quick diagnostics');
                const response = await fetch(`/api/admin/wiring-status/${this.companyId}/quick-diagnostics`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                diagnostics = await response.json();
                diagnostics._hasEvidence = false;
            }
            
            // Store for PATCH JSON export
            this.lastDiagnostics = diagnostics;
            
            this.renderWiringDiagnostics(diagnostics);
            
        } catch (error) {
            console.error('[AI Test] Failed to load wiring diagnostics:', error);
            content.innerHTML = `
                <div style="color: #f85149; padding: 20px; text-align: center;">
                    ❌ Failed to load diagnostics: ${error.message}
                </div>
            `;
        }
    }
    
    /**
     * Render wiring diagnostics - EVIDENCE-BASED with raw values
     * Shows: Evidence → Rule → Fix → Deep Link
     */
    renderWiringDiagnostics(diagnostics) {
        const content = document.getElementById('report-content');
        const isHealthy = diagnostics.healthy;
        const issues = diagnostics.issues || [];
        const evidence = diagnostics.evidence || {};
        const hasEvidence = diagnostics._hasEvidence;
        
        // Group issues by severity
        const critical = issues.filter(i => i.severity === 'CRITICAL');
        const high = issues.filter(i => i.severity === 'HIGH');
        const medium = issues.filter(i => i.severity === 'MEDIUM');
        
        content.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 12px;">
                
                <!-- Evidence Source Banner -->
                <div style="background: ${hasEvidence ? '#1c2128' : '#2d2712'}; border: 1px solid ${hasEvidence ? '#a371f7' : '#f0883e'}; border-radius: 6px; padding: 8px 12px; font-size: 11px;">
                    ${hasEvidence 
                        ? `<span style="color: #a371f7;">🔬 Evidence-Based:</span> <span style="color: #8b949e;">Diagnosis from actual test debugSnapshot</span>`
                        : `<span style="color: #f0883e;">⚠️ No Test Yet:</span> <span style="color: #8b949e;">Run a test to see evidence-based diagnosis</span>`
                    }
                </div>
                
                <!-- Health Status -->
                <div style="background: ${isHealthy ? '#1c2d1c' : '#2d1c1c'}; border: 1px solid ${isHealthy ? '#238636' : '#f85149'}; border-radius: 8px; padding: 12px; display: flex; align-items: center; gap: 12px;">
                    <div style="font-size: 28px;">${isHealthy ? '✅' : '🔴'}</div>
                    <div>
                        <div style="font-size: 14px; font-weight: 700; color: ${isHealthy ? '#3fb950' : '#f85149'};">
                            ${isHealthy ? 'Wiring Healthy' : `${critical.length} Critical Issues`}
                        </div>
                        <div style="font-size: 10px; color: #8b949e;">
                            ${diagnostics.summary?.total || 0} total • ${diagnostics.generationTimeMs || 0}ms
                        </div>
                    </div>
                </div>
                
                <!-- RAW EVIDENCE PANEL (THE TRUTH) -->
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px;">
                    <h4 style="margin: 0 0 10px 0; color: #58a6ff; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">
                        📊 Raw Evidence (What Was Observed)
                    </h4>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; font-size: 11px;">
                        <div style="background: #0d1117; padding: 6px 8px; border-radius: 4px;">
                            <span style="color: #8b949e;">responseSource:</span>
                            <span style="color: ${evidence.responseSource === 'LLM' || evidence.responseSource === 'FALLBACK' ? '#f85149' : '#3fb950'}; font-weight: 600; margin-left: 4px;">
                                ${evidence.responseSource || 'N/A'}
                            </span>
                        </div>
                        <div style="background: #0d1117; padding: 6px 8px; border-radius: 4px;">
                            <span style="color: #8b949e;">mode:</span>
                            <span style="color: #58a6ff; font-weight: 600; margin-left: 4px;">${evidence.mode || 'N/A'}</span>
                        </div>
                        <div style="background: #0d1117; padding: 6px 8px; border-radius: 4px;">
                            <span style="color: #8b949e;">scenarioCount:</span>
                            <span style="color: ${(evidence.scenarioCount || 0) > 0 ? '#3fb950' : '#f85149'}; font-weight: 600; margin-left: 4px;">
                                ${evidence.scenarioCount ?? 'N/A'}
                            </span>
                        </div>
                        <div style="background: #0d1117; padding: 6px 8px; border-radius: 4px;">
                            <span style="color: #8b949e;">templateRefs:</span>
                            <span style="color: ${(evidence.templateReferences || 0) > 0 ? '#3fb950' : '#f85149'}; font-weight: 600; margin-left: 4px;">
                                ${evidence.templateReferences ?? 'N/A'}
                            </span>
                        </div>
                        <div style="background: #0d1117; padding: 6px 8px; border-radius: 4px; grid-column: span 2;">
                            <span style="color: #8b949e;">killSwitches:</span>
                            <span style="color: ${evidence.killSwitches?.forceLLMDiscovery || evidence.killSwitches?.disableScenarioAutoResponses ? '#f85149' : '#3fb950'}; font-weight: 600; margin-left: 4px;">
                                forceLLM=${evidence.killSwitches?.forceLLMDiscovery ?? 'N/A'}, disableAuto=${evidence.killSwitches?.disableScenarioAutoResponses ?? 'N/A'}
                            </span>
                        </div>
                    </div>
                </div>
                
                <!-- CRITICAL ISSUES -->
                ${critical.length > 0 ? `
                    <div style="background: #161b22; border: 1px solid #f85149; border-radius: 8px; padding: 12px;">
                        <h4 style="margin: 0 0 10px 0; color: #f85149; font-size: 11px; text-transform: uppercase;">
                            🔴 Critical (${critical.length})
                        </h4>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            ${critical.map(issue => this.renderDiagnosticIssue(issue)).join('')}
                        </div>
                    </div>
                ` : ''}
                
                <!-- HIGH ISSUES -->
                ${high.length > 0 ? `
                    <div style="background: #161b22; border: 1px solid #f0883e; border-radius: 8px; padding: 12px;">
                        <h4 style="margin: 0 0 10px 0; color: #f0883e; font-size: 11px; text-transform: uppercase;">
                            🟠 High (${high.length})
                        </h4>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            ${high.map(issue => this.renderDiagnosticIssue(issue)).join('')}
                        </div>
                    </div>
                ` : ''}
                
                <!-- MEDIUM ISSUES -->
                ${medium.length > 0 ? `
                    <div style="background: #161b22; border: 1px solid #8b949e; border-radius: 8px; padding: 12px;">
                        <h4 style="margin: 0 0 10px 0; color: #8b949e; font-size: 11px; text-transform: uppercase;">
                            ⚪ Medium (${medium.length})
                        </h4>
                        <div style="display: flex; flex-direction: column; gap: 6px;">
                            ${medium.map(issue => this.renderDiagnosticIssue(issue)).join('')}
                        </div>
                    </div>
                ` : ''}
                
                <!-- NO ISSUES -->
                ${issues.length === 0 ? `
                    <div style="background: #1c2d1c; border: 1px solid #238636; border-radius: 8px; padding: 16px; text-align: center;">
                        <div style="font-size: 20px; margin-bottom: 6px;">🎉</div>
                        <div style="font-size: 13px; color: #3fb950; font-weight: 600;">All Systems Operational</div>
                        <div style="font-size: 11px; color: #8b949e; margin-top: 4px;">No configuration issues detected</div>
                    </div>
                ` : ''}
                
                <!-- EXPORT BUTTONS -->
                <div style="display: flex; gap: 8px;">
                    <button onclick="window.aiTestConsole.copyPatchJson()" 
                        style="flex: 1; padding: 10px; background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; cursor: pointer; font-size: 12px; font-weight: 600;">
                        📋 Copy PATCH JSON
                    </button>
                    <button onclick="window.aiTestConsole.downloadPatchJson()" 
                        style="flex: 1; padding: 10px; background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; cursor: pointer; font-size: 12px; font-weight: 600;">
                        💾 Download .json
                    </button>
                    <button onclick="window.aiTestConsole.openWiringTab()" 
                        style="flex: 1; padding: 10px; background: linear-gradient(135deg, #38bdf8 0%, #0ea5e9 100%); color: #000; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 700;">
                        🔌 Full Wiring →
                    </button>
                </div>
            </div>
        `;
    }
    
    /**
     * Render a single diagnostic issue with evidence
     */
    renderDiagnosticIssue(issue) {
        const evidenceStr = issue.evidence 
            ? Object.entries(issue.evidence).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
            : '';
        
        return `
            <div style="background: #0d1117; border-radius: 6px; padding: 10px;">
                <div style="font-size: 12px; font-weight: 700; color: #c9d1d9; margin-bottom: 4px;">
                    ${issue.title}
                </div>
                ${evidenceStr ? `
                    <div style="font-size: 10px; color: #f85149; background: rgba(248,81,73,0.1); padding: 4px 6px; border-radius: 4px; margin-bottom: 6px; font-family: monospace;">
                        📌 Evidence: ${evidenceStr}
                    </div>
                ` : ''}
                <div style="font-size: 10px; color: #8b949e; margin-bottom: 6px;">
                    ${issue.rule || ''}
                </div>
                <div style="display: flex; gap: 6px; align-items: center;">
                    <div style="font-size: 10px; color: #58a6ff; background: rgba(88,166,255,0.1); padding: 4px 8px; border-radius: 4px; flex: 1;">
                        💡 ${issue.fix}
                    </div>
                    ${issue.deepLink ? `
                        <a href="${issue.deepLink}" target="_blank" style="font-size: 10px; color: #a371f7; text-decoration: none;">
                            🔗 →
                        </a>
                    ` : ''}
                </div>
                ${issue.nodeId ? `
                    <div style="font-size: 9px; color: #6e7681; margin-top: 4px; font-family: monospace;">
                        nodeId: ${issue.nodeId}
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    /**
     * Copy PATCH JSON to clipboard
     * This is the actionable export for instant fix instructions
     */
    copyPatchJson() {
        const patchJson = this.lastDiagnostics?.patchJson;
        
        if (!patchJson) {
            alert('No diagnostics available. Run a test first.');
            return;
        }
        
        const jsonStr = JSON.stringify(patchJson, null, 2);
        
        navigator.clipboard.writeText(jsonStr).then(() => {
            // Flash success
            const btn = document.querySelector('[onclick*="copyPatchJson"]');
            if (btn) {
                const original = btn.innerHTML;
                btn.innerHTML = '✅ Copied!';
                btn.style.background = '#238636';
                setTimeout(() => {
                    btn.innerHTML = original;
                    btn.style.background = '#21262d';
                }, 1500);
            }
        }).catch(err => {
            console.error('[AI Test] Failed to copy:', err);
            alert('Failed to copy. Check console.');
        });
    }
    
    /**
     * Download PATCH JSON as a file
     * Filename: wiring-patch-{companyId}-{timestamp}.json
     */
    downloadPatchJson() {
        const patchJson = this.lastDiagnostics?.patchJson;
        
        if (!patchJson) {
            alert('No diagnostics available. Run a test first.');
            return;
        }
        
        const jsonStr = JSON.stringify(patchJson, null, 2);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `wiring-patch-${this.companyId}-${timestamp}.json`;
        
        // Create blob and download
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Flash success
        const btn = document.querySelector('[onclick*="downloadPatchJson"]');
        if (btn) {
            const original = btn.innerHTML;
            btn.innerHTML = '✅ Downloaded!';
            btn.style.background = '#238636';
            setTimeout(() => {
                btn.innerHTML = original;
                btn.style.background = '#21262d';
            }, 1500);
        }
        
        console.log(`[AI Test] Downloaded: ${filename}`);
    }
    
    /**
     * Open the Wiring Tab in the Control Plane
     * CRITICAL: Must close modal BEFORE navigation or user sees nothing change
     */
    openWiringTab() {
        // FIXED: Correct modal ID is 'ai-test-console-modal', not 'ai-test-modal'
        const modal = document.getElementById('ai-test-console-modal');
        if (modal) modal.remove();
        
        // Switch to Wiring tab in Control Plane
        if (typeof switchTab === 'function') {
            switchTab('wiring');
        } else if (window.switchTab) {
            window.switchTab('wiring');
        } else {
            // Fallback: navigate with query param
            window.location.href = `/control-plane-v2.html?companyId=${this.companyId}&tab=wiring`;
        }
    }

    /**
     * Update the analysis panel with current session data
     * NOW INCLUDES: Live Session Inspector (slots, mode, flow, trace)
     */
    updateAnalysis(metadata = null) {
        const content = document.getElementById('report-content');
        
        // ═══════════════════════════════════════════════════════════════════════
        // LIVE SESSION INSPECTOR - The "call slot boxes" view
        // ═══════════════════════════════════════════════════════════════════════
        const lastDebugEntry = this.debugLog.length > 0 ? this.debugLog[this.debugLog.length - 1] : null;
        const lastDebug = lastDebugEntry?.debug || {};
        
        // Extract key runtime state
        const currentMode = lastDebug?.v22BlackBox?.mode || lastDebug?.v22?.mode || lastDebugEntry?.mode || 'DISCOVERY';
        const activeFlow = lastDebug?.dynamicFlow || null;
        const stageInfo = lastDebug?.stageInfo || {};
        const slotDiagnostics = lastDebug?.slotDiagnostics || {};
        const bookingConfig = lastDebugEntry?.bookingConfig || lastDebug?.bookingConfig || {};
        
        // Get configured booking slots (from config) vs collected values
        const configuredSlots = (bookingConfig?.slots || []);
        const collectedSlots = slotDiagnostics?.slotsAfterMerge || this.knownSlots || {};
        
        // Build slot boxes UI - shows each configured slot with fill status
        const slotBoxesHtml = configuredSlots.length > 0 
            ? configuredSlots.map(slot => {
                const slotId = slot.id || slot.slotId;
                const value = collectedSlots[slotId];
                const isFilled = value !== undefined && value !== null && value !== '';
                const isRequired = slot.required !== false;
                
                return `
                    <div style="background: ${isFilled ? '#0d2818' : '#1a1a1a'}; border: 1px solid ${isFilled ? '#238636' : isRequired ? '#f0883e' : '#30363d'}; border-radius: 6px; padding: 8px; min-width: 100px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="color: ${isFilled ? '#3fb950' : '#8b949e'}; font-size: 10px; font-weight: 600; text-transform: uppercase;">${slotId}</span>
                            <span style="font-size: 12px;">${isFilled ? '✅' : isRequired ? '⏳' : '○'}</span>
                        </div>
                        <div style="color: ${isFilled ? '#e6edf3' : '#6e7681'}; font-size: 12px; min-height: 18px; word-break: break-word;">
                            ${isFilled ? value : '—'}
                        </div>
                        ${slot.confirmBack ? `<div style="color: #58a6ff; font-size: 9px; margin-top: 2px;">🔁 Confirm</div>` : ''}
                    </div>
                `;
            }).join('')
            : `
                <div style="text-align: center; color: #6e7681; padding: 12px; grid-column: 1 / -1;">
                    <div style="font-size: 24px; margin-bottom: 4px;">📋</div>
                    <div>No booking slots configured</div>
                    <div style="font-size: 10px; color: #8b949e; margin-top: 4px;">Go to Front Desk → Booking Prompts to set up</div>
                </div>
            `;
        
        // Build active flow status
        const flowStatus = activeFlow && (activeFlow.flowsActivated?.length > 0 || activeFlow.triggersFired?.length > 0) 
            ? `
                <div style="background: #1a2d1a; border: 1px solid #238636; border-radius: 6px; padding: 8px;">
                    <div style="color: #3fb950; font-size: 10px; font-weight: 600; margin-bottom: 4px;">🌊 ACTIVE FLOW</div>
                    ${activeFlow.flowsActivated?.length > 0 
                        ? activeFlow.flowsActivated.map(f => `
                            <div style="color: #e6edf3; font-size: 11px;">• ${f.flowKey || f.key || f} ${f.step ? `(step: ${f.step})` : ''}</div>
                        `).join('')
                        : '<div style="color: #8b949e; font-size: 11px;">No flow currently active</div>'
                    }
                    ${activeFlow.triggersFired?.length > 0 
                        ? `<div style="color: #f0883e; font-size: 10px; margin-top: 4px;">Triggers fired: ${activeFlow.triggersFired.map(t => t.key || t).join(', ')}</div>`
                        : ''
                    }
                </div>
            `
            : `
                <div style="background: #1a1a1a; border: 1px solid #30363d; border-radius: 6px; padding: 8px;">
                    <div style="color: #6e7681; font-size: 10px; font-weight: 600; margin-bottom: 4px;">🌊 ACTIVE FLOW</div>
                    <div style="color: #6e7681; font-size: 11px;">None active</div>
                </div>
            `;
        
        // Build decision trace (why the agent did what it did)
        const lastEntry = this.debugLog[this.debugLog.length - 1];
        const inBookingMode = (currentMode || '').toUpperCase() === 'BOOKING' || (stageInfo?.currentStage || '').toLowerCase() === 'booking';
        const promptFrom = inBookingMode ? (bookingConfig?.source || 'unknown') : '—';
        const snap = lastEntry?.debugSnapshot || lastDebug?.debugSnapshot || null;
        const templateRefs = snap?.templateReferences || lastDebug?.templateReferences || lastDebugEntry?.templateReferences || [];
        const templateRefsCount = Array.isArray(templateRefs) ? templateRefs.length : 0;
        const templateWiringStatus = templateRefsCount > 0 ? `✅ (${templateRefsCount})` : '❌ (none)';

        const decisionTrace = lastEntry ? `
            <div style="background: #1c1c3a; border: 1px solid #8957e5; border-radius: 6px; padding: 8px;">
                <div style="color: #a78bfa; font-size: 10px; font-weight: 600; margin-bottom: 6px;">🎯 DECISION TRACE</div>
                <div style="display: grid; grid-template-columns: 100px 1fr; gap: 4px; font-size: 11px;">
                    <span style="color: #6e7681;">Source:</span>
                    <span style="color: #e6edf3;">${lastEntry.source || '—'}</span>
                    
                    <span style="color: #6e7681;">Prompt from:</span>
                    <span style="color: #e6edf3;">${promptFrom}</span>

                    <span style="color: #6e7681;">Template:</span>
                    <span style="color: ${templateRefsCount > 0 ? '#3fb950' : '#f85149'};">${templateWiringStatus}</span>
                    
                    <span style="color: #6e7681;">Action:</span>
                    <span style="color: #e6edf3;">${lastDebug?.stateMachine?.action || lastEntry.llmBrain?.engineAction?.normalizedSlot ? 'COLLECT_SLOT' : 'REPLY'}</span>
                </div>
            </div>
        ` : '';
        
        // Legacy slot display for backward compat
        const slotsCollected = Object.entries(this.knownSlots)
            .filter(([k, v]) => v)
            .map(([k, v]) => `<span style="background: #238636; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${k}: ${v}</span>`)
            .join(' ') || '<span style="color: #8b949e;">None yet</span>';
        
        const slotsMissing = ['name', 'phone', 'address', 'time']
            .filter(s => !this.knownSlots[s])
            .map(s => `<span style="background: #f0883e; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${s}</span>`)
            .join(' ') || '<span style="color: #3fb950;">All collected! ✓</span>';
        
        // Build the running debug log with thinking process
        const debugLogHtml = this.debugLog.length > 0 
            ? this.debugLog.map((entry, i) => {
                // Build thinking process section if available
                let thinkingHtml = '';
                if (entry.thinkingProcess) {
                    const tp = entry.thinkingProcess;
                    thinkingHtml = `
                        <div style="background: #161b22; border-radius: 4px; padding: 6px 8px; margin: 6px 0; font-size: 10px;">
                            <div style="color: #f0883e; font-weight: bold; margin-bottom: 4px;">🧠 AI THINKING:</div>
                            <div style="color: ${tp.quickAnswers?.matched ? '#3fb950' : '#6e7681'};">1. Quick Answers: ${tp.quickAnswers?.matched ? '✅ MATCHED' : '❌ No match'}</div>
                            <div style="color: ${tp.triage?.matched ? '#3fb950' : '#6e7681'};">2. Triage: ${tp.triage?.matched ? '✅ ' + (tp.triage?.cardName || 'MATCHED') : '❌ No match'}</div>
                            <div style="color: ${tp.emergency?.detected ? '#f85149' : '#6e7681'};">3. Emergency: ${tp.emergency?.detected ? '⚠️ DETECTED' : '✅ Normal'}</div>
                            <div style="color: #58a6ff;">4. Source: ${tp.responseSource?.result || entry.source}</div>
                        </div>
                    `;
                }
                
                // Build booking config section if available
                let bookingHtml = '';
                if (entry.bookingConfig && entry.bookingConfig.source) {
                    const bc = entry.bookingConfig;
                    const isNotSaved = bc.source?.includes('NOT SAVED') || bc.source?.includes('hardcoded');
                    bookingHtml = `
                        <div style="background: ${isNotSaved ? '#3d1f00' : '#0d2818'}; border: 1px solid ${isNotSaved ? '#f0883e' : '#238636'}; border-radius: 4px; padding: 6px 8px; margin: 6px 0; font-size: 10px;">
                            <div style="color: ${isNotSaved ? '#f0883e' : '#3fb950'}; font-weight: bold; margin-bottom: 4px;">📋 BOOKING QUESTIONS: ${bc.source}</div>
                            ${bc.configuredQuestions?.slice(0, 5).map(q => `<div style="color: #8b949e; font-size: 9px; margin-left: 8px;">• ${q}</div>`).join('') || ''}
                            ${isNotSaved ? '<div style="color: #f0883e; font-size: 9px; margin-top: 4px;">⚠️ Questions not in database - using code defaults!</div>' : ''}
                        </div>
                    `;
                }
                
                // 🧠 LLM BRAIN DECISION - Show what the LLM decided and what the engine did
                let llmBrainHtml = '';
                if (entry.llmBrain) {
                    const brain = entry.llmBrain;
                    llmBrainHtml = `
                        <div style="background: #1c1c3a; border: 1px solid #8957e5; border-radius: 4px; padding: 6px 8px; margin: 6px 0; font-size: 10px;">
                            <div style="color: #8957e5; font-weight: bold; margin-bottom: 6px;">🧠 LLM BRAIN DECISION</div>
                            
                            <div style="margin-bottom: 6px;">
                                <div style="color: #58a6ff; font-size: 9px; margin-bottom: 2px;">📥 What LLM saw:</div>
                                <div style="color: #8b949e; font-size: 9px; margin-left: 8px;">• Have: ${brain.promptSummary?.slotsHave?.join(', ') || 'nothing'}</div>
                                <div style="color: #8b949e; font-size: 9px; margin-left: 8px;">• Need: ${brain.promptSummary?.slotsNeed?.join(' → ') || 'nothing'}</div>
                                <div style="color: #8b949e; font-size: 9px; margin-left: 8px;">• Style: ${brain.promptSummary?.style || 'balanced'}</div>
                            </div>
                            
                            <div style="margin-bottom: 6px;">
                                <div style="color: #f0883e; font-size: 9px; margin-bottom: 2px;">📤 What LLM returned:</div>
                                <div style="color: #f0883e; font-size: 9px; margin-left: 8px;">• slot: "${brain.llmDecision?.slotChosen || 'none'}"</div>
                                <div style="color: #f0883e; font-size: 9px; margin-left: 8px;">• ack: "${brain.llmDecision?.acknowledgment || '(none)'}"</div>
                            </div>
                            
                            <div>
                                <div style="color: #3fb950; font-size: 9px; margin-bottom: 2px;">⚙️ What Engine did:</div>
                                <div style="color: #3fb950; font-size: 9px; margin-left: 8px;">• Slot: ${brain.engineAction?.normalizedSlot || 'none'}</div>
                                ${brain.engineAction?.questionInjected ? `<div style="color: #3fb950; font-size: 9px; margin-left: 8px;">• Question injected: "${brain.engineAction.questionInjected}"</div>` : ''}
                            </div>
                            
                            <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed #30363d;">
                                <div style="color: #6e7681; font-size: 9px;">📊 Prompt: ${brain.performance?.promptTokens || 0} tokens | Completion: ${brain.performance?.completionTokens || 0} tokens</div>
                            </div>
                        </div>
                    `;
                }
                
                // 🧠 V41: DYNAMIC FLOW TRACE - Show what flows were triggered
                let dynamicFlowHtml = '';
                if (entry.dynamicFlow && entry.dynamicFlow.trace) {
                    const t = entry.dynamicFlow.trace;
                    const firedHtml = (t.triggersFired || []).map(f => `<span style="background:#f0883e20;color:#f0883e;padding:1px 4px;border-radius:3px;font-size:9px;margin-right:4px;">${f.key}${f.matchScore ? ' (' + Math.round(f.matchScore * 100) + '% ' + (f.matchScoreSource || 'heuristic') + ')' : ''}</span>`).join('');
                    const actionsHtml = (t.actionsExecuted || []).map(a => `<div style="color:#58a6ff;font-size:9px;">• ${a.type}${a.payload ? ' ' + JSON.stringify(a.payload) : ''}</div>`).join('');
                    const ledgerHtml = (t.ledgerAppends || []).map(l => `<div style="color:#8b949e;font-size:9px;">• ${l.type || ''}:${l.key || ''}</div>`).join('');
                    const modeChange = t.modeChange ? `<div style="color:#f0883e;font-size:9px;">Mode: ${t.modeChange.from || 'unknown'} → ${t.modeChange.to}</div>` : '';
                    
                    dynamicFlowHtml = `
                        <div style="background: #1a2d1a; border: 1px solid #238636; border-radius: 4px; padding: 6px 8px; margin: 6px 0; font-size: 10px;">
                            <div style="color: #3fb950; font-weight: bold; margin-bottom: 4px;">🧠 Dynamic Flow Trace (Turn ${t.turn})</div>
                            <div style="color:#8b949e;font-size:9px; margin-bottom:2px;">Time: ${new Date(t.timestamp).toLocaleTimeString()}</div>
                            <div style="color:#8b949e;font-size:9px; margin-bottom:2px;">Input: ${(t.inputSnippet || '').substring(0,120)}</div>
                            <div style="color:#8b949e;font-size:9px; margin-bottom:2px;">Evaluated: ${t.evaluatedCount || 0}</div>
                            ${firedHtml ? `<div style="margin-bottom:4px;"><div style="color:#f0883e;font-size:9px;">Fired:</div><div>${firedHtml}</div></div>` : ''}
                            ${actionsHtml ? `<div style="margin-bottom:4px;"><div style="color:#58a6ff;font-size:9px;">Actions:</div>${actionsHtml}</div>` : ''}
                            ${ledgerHtml ? `<div style="margin-bottom:4px;"><div style="color:#8b949e;font-size:9px;">Ledger:</div>${ledgerHtml}</div>` : ''}
                            ${modeChange}
                        </div>
                    `;
                }
                
                return `
                <div style="padding: 8px 0; ${i > 0 ? 'border-top: 1px dashed #30363d;' : ''}">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span style="color: #58a6ff; font-weight: bold;">Turn ${entry.turn}</span>
                        <span style="background: ${this.getSourceColor(entry.source)}; color: white; padding: 1px 6px; border-radius: 3px; font-size: 9px;">${entry.source}</span>
                    </div>
                    <div style="color: #3fb950; font-size: 11px; margin-bottom: 2px;">
                        👤 ${entry.userMessage?.substring(0, 60)}${entry.userMessage?.length > 60 ? '...' : ''}
                    </div>
                    <div style="color: #8b949e; font-size: 11px; margin-bottom: 4px;">
                        🤖 ${entry.aiResponse?.substring(0, 60)}${entry.aiResponse?.length > 60 ? '...' : ''}
                    </div>
                    <div style="display: flex; gap: 8px; font-size: 10px; color: #6e7681;">
                        <span>⚡${entry.latencyMs}ms</span>
                        <span>🎯${entry.tokens}</span>
                        <span>📍${entry.mode}</span>
                        <span>📨${entry.historySent} hist</span>
                    </div>
                    ${dynamicFlowHtml}
                    ${thinkingHtml}
                    ${llmBrainHtml}
                    ${bookingHtml}
                </div>
            `;
            }).join('')
            : '<div style="text-align: center; color: #6e7681; padding: 12px;">Send a message to see debug log</div>';
        
        // Calculate totals for live display
        const totalTokens = this.debugLog.reduce((sum, entry) => sum + (entry.tokens || 0), 0);
        const totalLatency = this.debugLog.reduce((sum, entry) => sum + (entry.latencyMs || 0), 0);
        const avgLatency = this.debugLog.length > 0 ? Math.round(totalLatency / this.debugLog.length) : 0;
        // GPT-4o-mini pricing estimate
        const estimatedCost = (totalTokens / 1000000) * 0.30;
        const costPer1000 = estimatedCost * 1000;
        
        // Get engine version from last debug entry
        const engineVersion = this.debugLog.length > 0 ? 
            (this.debugLog[this.debugLog.length - 1].debug?.engineVersion || '⚠️ UNKNOWN') : '(no turns yet)';
        
        content.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 12px;">
                
                <!-- ═══════════════════════════════════════════════════════════════════════
                     🎯 LIVE SESSION INSPECTOR - Real-time call state (what you asked for!)
                     ═══════════════════════════════════════════════════════════════════════ -->
                <div style="background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); border: 2px solid #8b5cf6; border-radius: 10px; overflow: hidden;">
                    <div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: white; font-weight: 700; font-size: 13px;">📡 LIVE SESSION INSPECTOR</span>
                        <span style="color: white; font-size: 10px; opacity: 0.8;">Updates every turn</span>
                    </div>
                    
                    <div style="padding: 12px; display: flex; flex-direction: column; gap: 10px;">
                        
                        <!-- Session + Mode Row -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                            <div style="background: #161b22; border-radius: 6px; padding: 8px;">
                                <div style="color: #8b949e; font-size: 9px; margin-bottom: 2px;">SESSION</div>
                                <div style="color: #e6edf3; font-size: 11px; font-family: monospace;">${this.testSessionId.substring(0, 18)}...</div>
                            </div>
                            <div style="background: ${currentMode === 'BOOKING' ? '#0d2818' : currentMode === 'COMPLETE' ? '#1a2d1a' : '#1a1a1a'}; border: 1px solid ${currentMode === 'BOOKING' ? '#238636' : currentMode === 'COMPLETE' ? '#3fb950' : '#30363d'}; border-radius: 6px; padding: 8px;">
                                <div style="color: #8b949e; font-size: 9px; margin-bottom: 2px;">MODE</div>
                                <div style="color: ${currentMode === 'BOOKING' ? '#3fb950' : currentMode === 'COMPLETE' ? '#58a6ff' : '#f0883e'}; font-size: 14px; font-weight: 700;">${currentMode}</div>
                            </div>
                        </div>
                        
                        <!-- Active Flow Status -->
                        ${flowStatus}
                        
                        <!-- SLOT BOXES - The "call slot boxes" you wanted -->
                        <div>
                            <div style="color: #8b949e; font-size: 10px; margin-bottom: 6px; display: flex; justify-content: space-between;">
                                <span>📦 BOOKING SLOTS ${inBookingMode ? '' : '<span style="color:#6e7681;">(standby)</span>'}</span>
                                <span>${Object.values(collectedSlots).filter(v => v).length}/${configuredSlots.length} filled</span>
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 6px;">
                                ${slotBoxesHtml}
                            </div>
                        </div>
                        
                        <!-- Decision Trace -->
                        ${decisionTrace}
                        
                    </div>
                </div>
                
                <!-- 🔧 ENGINE VERSION - Verify deployment -->
                <div style="background: #0d2818; border: 1px solid #238636; border-radius: 6px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #3fb950; font-size: 11px;">🔧 ENGINE:</span>
                    <span style="color: #58a6ff; font-weight: bold; font-size: 12px; font-family: monospace;">${engineVersion}</span>
                </div>
                
                <!-- 💰 COST TRACKER - Shows total tokens and estimated cost -->
                <div style="background: linear-gradient(135deg, #1a1f35 0%, #0d1117 100%); border: 1px solid #58a6ff; border-radius: 8px; padding: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="color: #58a6ff; font-weight: bold; font-size: 12px;">💰 CONVERSATION COST</span>
                        <span style="color: #8b949e; font-size: 10px;">GPT-4o-mini rates</span>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; text-align: center;">
                        <div>
                            <div style="color: #f0883e; font-size: 20px; font-weight: bold;">${totalTokens.toLocaleString()}</div>
                            <div style="color: #8b949e; font-size: 9px;">TOKENS</div>
                        </div>
                        <div>
                            <div style="color: #3fb950; font-size: 20px; font-weight: bold;">$${estimatedCost.toFixed(4)}</div>
                            <div style="color: #8b949e; font-size: 9px;">THIS CALL</div>
                        </div>
                        <div>
                            <div style="color: #a371f7; font-size: 20px; font-weight: bold;">$${costPer1000.toFixed(2)}</div>
                            <div style="color: #8b949e; font-size: 9px;">PER 1K CALLS</div>
                        </div>
                        <div>
                            <div style="color: #58a6ff; font-size: 20px; font-weight: bold;">${avgLatency}ms</div>
                            <div style="color: #8b949e; font-size: 9px;">AVG LATENCY</div>
                        </div>
                    </div>
                </div>
                
                <!-- Running Debug Log -->
                <div style="background: #0d1117; border: 1px solid #f0883e; border-radius: 8px; overflow: hidden;">
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #161b22; border-bottom: 1px solid #30363d;">
                        <h4 style="margin: 0; color: #f0883e; font-size: 12px;">🔧 DEBUG LOG</h4>
                        <div style="display: flex; gap: 6px;">
                            <button onclick="window.aiTestConsole.copyFullDiagnostic()" style="background: #8b5cf6; border: none; color: white; padding: 4px 10px; border-radius: 4px; font-size: 10px; cursor: pointer; font-weight: bold;">🔍 Full Diagnostic</button>
                            <button onclick="window.aiTestConsole.copyDebug()" style="background: #238636; border: none; color: white; padding: 4px 10px; border-radius: 4px; font-size: 10px; cursor: pointer; font-weight: bold;">📋 Copy Log</button>
                        </div>
                    </div>
                    <div style="max-height: 250px; overflow-y: auto; padding: 8px 12px; font-family: monospace;">
                        ${debugLogHtml}
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * Get color for source badge
     */
    getSourceColor(source) {
        const colors = {
            'LLM': '#8b5cf6',
            'QUICK_ANSWER': '#238636',
            'TRIAGE': '#1f6feb',
            'FALLBACK': '#f0883e',
            'EMERGENCY': '#da3633'
        };
        return colors[source] || '#6e7681';
    }

    /**
     * Load failure report from BlackBox
     */
    async loadFailureReport() {
        const content = document.getElementById('report-content');
        
        content.innerHTML = `
            <div style="text-align: center; color: #8b949e; padding: 20px;">
                Loading failure analysis...
            </div>
        `;
        
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const response = await fetch(`/api/admin/ai-test/${this.companyId}/failures`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.renderFailureReport(data.report);
            } else {
                content.innerHTML = `<div style="color: #f85149; padding: 20px;">Failed to load: ${data.error}</div>`;
            }
            
        } catch (error) {
            content.innerHTML = `<div style="color: #f85149; padding: 20px;">Error: ${error.message}</div>`;
        }
    }

    /**
     * Render the failure report
     */
    renderFailureReport(report) {
        const content = document.getElementById('report-content');
        
        content.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 16px;">
                
                <!-- Summary -->
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px;">
                    <h4 style="margin: 0 0 12px 0; color: #c9d1d9; font-size: 14px;">📈 Last 24 Hours</h4>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; text-align: center;">
                        <div>
                            <div style="font-size: 24px; color: #3fb950; font-weight: bold;">${report.successCount || 0}</div>
                            <div style="font-size: 11px; color: #8b949e;">Successful</div>
                        </div>
                        <div>
                            <div style="font-size: 24px; color: #f85149; font-weight: bold;">${report.failureCount || 0}</div>
                            <div style="font-size: 11px; color: #8b949e;">Fallbacks</div>
                        </div>
                    </div>
                    <div style="margin-top: 12px; text-align: center;">
                        <div style="font-size: 28px; color: ${(report.successRate || 0) > 80 ? '#3fb950' : (report.successRate || 0) > 50 ? '#f0883e' : '#f85149'}; font-weight: bold;">
                            ${report.successRate || 0}%
                        </div>
                        <div style="font-size: 11px; color: #8b949e;">Success Rate</div>
                    </div>
                </div>
                
                <!-- Common Failures -->
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px;">
                    <h4 style="margin: 0 0 12px 0; color: #f85149; font-size: 12px;">🔥 TOP FAILURES</h4>
                    ${(report.topFailures || []).length > 0 ? `
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            ${report.topFailures.map(f => `
                                <div style="background: #2a1c1c; border: 1px solid #f8514930; border-radius: 6px; padding: 10px;">
                                    <div style="font-size: 12px; color: #f85149; margin-bottom: 4px;">${f.type}</div>
                                    <div style="font-size: 11px; color: #8b949e;">${f.count} occurrences</div>
                                    ${f.example ? `<div style="font-size: 10px; color: #6e7681; margin-top: 4px; font-style: italic;">"${f.example.substring(0, 50)}..."</div>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    ` : '<div style="color: #3fb950; font-size: 12px;">🎉 No failures detected!</div>'}
                </div>
                
                <!-- Slow Responses -->
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px;">
                    <h4 style="margin: 0 0 8px 0; color: #f0883e; font-size: 12px;">🐌 SLOW RESPONSES</h4>
                    <div style="font-size: 12px; color: #c9d1d9;">
                        Avg latency: <strong>${report.avgLatency || 0}ms</strong>
                    </div>
                    <div style="font-size: 11px; color: #8b949e; margin-top: 4px;">
                        ${(report.avgLatency || 0) < 500 ? '✅ Good' : (report.avgLatency || 0) < 1000 ? '⚠️ Acceptable' : '❌ Too slow'}
                    </div>
                </div>
                
                <!-- Suggestions -->
                ${(report.suggestions || []).length > 0 ? `
                <div style="background: #1c2128; border: 1px solid #a371f7; border-radius: 8px; padding: 12px;">
                    <h4 style="margin: 0 0 8px 0; color: #a371f7; font-size: 12px;">💡 SUGGESTIONS</h4>
                    <ul style="margin: 0; padding-left: 16px; color: #c9d1d9; font-size: 11px; line-height: 1.6;">
                        ${report.suggestions.map(s => `<li>${s}</li>`).join('')}
                    </ul>
                </div>
                ` : ''}
            </div>
        `;
    }
}

// Export
window.AITestConsole = AITestConsole;

