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
        this.companyId = companyId;
        this.conversationHistory = [];
        this.testSessionId = `test-${Date.now()}`;
        this.knownSlots = {};
        this.debugLog = []; // Running log of all turns
        
        // Voice features
        this.isListening = false;
        this.recognition = null;
        this.voiceEnabled = true;
        this.voiceInfo = null; // ElevenLabs voice info
        this.audioContext = null;
        this.currentAudio = null;
        
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
                this.sendMessage(transcript);
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
        
        if (this.isListening) {
            btn.style.background = '#f85149';
            btn.style.animation = 'pulse 1s infinite';
            btn.innerHTML = '🎙️ Listening...';
        } else {
            btn.style.background = '#238636';
            btn.style.animation = 'none';
            btn.innerHTML = '🎤 Speak';
        }
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
                            <div style="padding: 8px 16px; border-top: 1px solid #30363d; display: flex; gap: 10px; align-items: center; background: #161b22;">
                                <span style="color: #8b949e; font-size: 12px;">🎙️ Voice Mode:</span>
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
    async sendMessage(customMessage = null) {
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
                    visitorInfo: {
                        userAgent: navigator.userAgent,
                        pageUrl: window.location.href
                    }
                })
            });
            
            const data = await response.json();
            
            // Remove typing indicator
            document.getElementById(typingId)?.remove();
            
            if (data.success) {
                // ═══════════════════════════════════════════════════════════════
                // UPDATE EVERYTHING SIMULTANEOUSLY
                // ═══════════════════════════════════════════════════════════════
                
                // Map new API response format to expected format
                const debug = data.debug || {};
                const metadata = {
                    latencyMs: debug.latencyMs,
                    tokensUsed: debug.tokensUsed,
                    mode: debug.phase || 'booking',
                    slots: debug.slotsCollected || {},
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
                    mode: debug.phase,
                    customerContext: debug.customerContext,
                    runningSummary: debug.runningSummary,
                    slotsCollected: debug.slotsCollected,
                    historySent: debug.historySent || 0,
                    bookingConfig: debug.bookingConfig,  // Shows what prompts AI was given
                    timestamp: new Date().toISOString()
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
                
                // 3. Update slots if any collected
                if (debug.slotsCollected) {
                    this.knownSlots = { ...this.knownSlots, ...debug.slotsCollected };
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
            
            html += `
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 11px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                    <!-- Source Badge -->
                    <span style="background: ${source.color}; color: ${source.textColor}; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 10px;">
                        ${source.icon} ${source.label}
                    </span>
                    ${metadata.latencyMs ? `<span style="color: ${metadata.latencyMs < 500 ? '#3fb950' : metadata.latencyMs < 1500 ? '#f0883e' : '#f85149'};">⚡ ${metadata.latencyMs}ms</span>` : ''}
                    ${metadata.tokensUsed ? `<span style="color: #8b949e;">🎯 ${metadata.tokensUsed} tokens</span>` : ''}
                    ${metadata.mode ? `<span style="color: #58a6ff;">📍 ${metadata.mode}</span>` : ''}
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
     * Reset the conversation
     */
    resetConversation() {
        this.conversationHistory = [];
        this.knownSlots = {};
        this.lastDebug = null;
        this.debugLog = [];
        this.testSessionId = `test-${Date.now()}`;
        
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
     * Copy full debug log to clipboard for sharing
     */
    copyDebug() {
        const separator = '═'.repeat(50);
        const thinSeparator = '─'.repeat(50);
        
        let text = `${separator}
AI TEST CONSOLE - FULL DEBUG LOG
${separator}
Session: ${this.testSessionId}
Total Turns: ${this.debugLog.length}
Slots Collected: ${Object.entries(this.knownSlots).filter(([k,v]) => v).map(([k,v]) => `${k}=${v}`).join(', ') || 'None'}
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
            
            // Add booking config if available - shows what prompts AI was given
            if (entry.bookingConfig) {
                const bc = entry.bookingConfig;
                const slotsInfo = bc.slots?.map(s => `    - [${s.id}] "${s.question}" ${s.required ? '(required)' : '(optional)'}`).join('\n') || '    (none configured)';
                text += `📋 BOOKING CONFIG (What AI sees):
  Source: ${bc.source || 'N/A'} ${bc.isConfigured ? '✅' : '⚠️ NOT CONFIGURED'}
  Slot Questions:
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
     * Switch between analysis and failures tabs
     */
    switchTab(tab) {
        document.getElementById('tab-analysis').style.background = tab === 'analysis' ? '#161b22' : 'transparent';
        document.getElementById('tab-analysis').style.color = tab === 'analysis' ? '#58a6ff' : '#8b949e';
        document.getElementById('tab-analysis').style.borderBottom = tab === 'analysis' ? '2px solid #58a6ff' : 'none';
        
        document.getElementById('tab-failures').style.background = tab === 'failures' ? '#161b22' : 'transparent';
        document.getElementById('tab-failures').style.color = tab === 'failures' ? '#f85149' : '#8b949e';
        document.getElementById('tab-failures').style.borderBottom = tab === 'failures' ? '2px solid #f85149' : 'none';
        
        if (tab === 'analysis') {
            this.updateAnalysis();
        } else {
            this.loadFailureReport();
        }
    }

    /**
     * Update the analysis panel with current session data
     */
    updateAnalysis(metadata = null) {
        const content = document.getElementById('report-content');
        
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
                    ${thinkingHtml}
                    ${bookingHtml}
                </div>
            `;
            }).join('')
            : '<div style="text-align: center; color: #6e7681; padding: 12px;">Send a message to see debug log</div>';
        
        content.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 12px;">
                
                <!-- Session Header -->
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #161b22; border-radius: 6px;">
                    <div>
                        <span style="color: #8b949e; font-size: 10px;">SESSION</span>
                        <div style="color: #c9d1d9; font-size: 11px; font-family: monospace;">${this.testSessionId.substring(0, 20)}</div>
                    </div>
                    <div style="text-align: right;">
                        <span style="color: #58a6ff; font-size: 18px; font-weight: bold;">${this.debugLog.length}</span>
                        <div style="color: #8b949e; font-size: 10px;">turns</div>
                    </div>
                </div>
                
                <!-- Slots Summary -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div style="background: #161b22; border-radius: 6px; padding: 8px;">
                        <div style="color: #3fb950; font-size: 10px; margin-bottom: 4px;">✓ COLLECTED</div>
                        <div style="display: flex; flex-wrap: wrap; gap: 4px;">${slotsCollected}</div>
                    </div>
                    <div style="background: #161b22; border-radius: 6px; padding: 8px;">
                        <div style="color: #f0883e; font-size: 10px; margin-bottom: 4px;">⏳ NEED</div>
                        <div style="display: flex; flex-wrap: wrap; gap: 4px;">${slotsMissing}</div>
                    </div>
                </div>
                
                <!-- Running Debug Log -->
                <div style="background: #0d1117; border: 1px solid #f0883e; border-radius: 8px; overflow: hidden;">
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #161b22; border-bottom: 1px solid #30363d;">
                        <h4 style="margin: 0; color: #f0883e; font-size: 12px;">🔧 DEBUG LOG (All Turns)</h4>
                        <button onclick="window.aiTestConsole.copyDebug()" style="background: #238636; border: none; color: white; padding: 4px 10px; border-radius: 4px; font-size: 10px; cursor: pointer; font-weight: bold;">📋 Copy All</button>
                    </div>
                    <div style="max-height: 300px; overflow-y: auto; padding: 8px 12px; font-family: monospace;">
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

