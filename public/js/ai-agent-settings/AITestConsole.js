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
            const response = await fetch(`/api/admin/ai-test/${this.companyId}/voice-info`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            const data = await response.json();
            if (data.success) {
                this.voiceInfo = data.voice;
                console.log('[AI Test] Voice loaded:', this.voiceInfo);
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
    open() {
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
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const response = await fetch(`/api/admin/ai-test/${this.companyId}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    message,
                    sessionId: this.testSessionId,
                    conversationHistory: this.conversationHistory,
                    knownSlots: this.knownSlots
                })
            });
            
            const data = await response.json();
            
            // Remove typing indicator
            document.getElementById(typingId)?.remove();
            
            if (data.success) {
                // Save debug info FIRST so it's available for the bubble
                this.lastDebug = data.debug;
                console.log('[AI Test] Debug info:', data.debug);
                
                // Add AI response with source badge
                this.addChatBubble(data.reply, 'ai', data.metadata, false, data.debug);
                
                // 🔊 SPEAK the response!
                this.speakResponse(data.reply);
                
                // Update conversation history
                this.conversationHistory.push(
                    { role: 'user', content: message },
                    { role: 'assistant', content: data.reply }
                );
                
                // Update slots if any collected
                if (data.metadata?.slots) {
                    this.knownSlots = { ...this.knownSlots, ...data.metadata.slots };
                }
                
                // Update analysis panel
                this.updateAnalysis(data.metadata);
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
     * Copy debug info to clipboard for sharing
     */
    copyDebug() {
        const debug = this.lastDebug;
        const history = this.conversationHistory;
        
        const text = `
=== AI TEST CONSOLE DEBUG ===
Session: ${this.testSessionId}
Total Turns: ${history.length / 2}

--- Last Turn Debug ---
Turn #: ${debug?.turnCount || 'N/A'}
History Sent: ${debug?.historyReceived || 0} messages
Quick Answer: ${debug?.wasQuickAnswer ? 'Yes' : 'No'}
Triage Match: ${debug?.triageMatched ? 'Yes' : 'No'}

--- Conversation History ---
${history.map((h, i) => `${i+1}. [${h.role}]: ${h.content}`).join('\n')}

--- Slots Collected ---
${Object.entries(this.knownSlots).filter(([k,v]) => v).map(([k,v]) => `${k}: ${v}`).join('\n') || 'None'}
`.trim();
        
        navigator.clipboard.writeText(text).then(() => {
            alert('✅ Debug info copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy:', err);
            // Fallback: show in prompt
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
        
        content.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 16px;">
                
                <!-- Session Info -->
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px;">
                    <h4 style="margin: 0 0 8px 0; color: #8b949e; font-size: 12px;">SESSION</h4>
                    <div style="color: #c9d1d9; font-family: monospace; font-size: 11px;">${this.testSessionId}</div>
                    <div style="margin-top: 4px; color: #8b949e; font-size: 11px;">${this.conversationHistory.length / 2} turns</div>
                </div>
                
                <!-- Slots Collected -->
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px;">
                    <h4 style="margin: 0 0 8px 0; color: #3fb950; font-size: 12px;">✓ COLLECTED</h4>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">${slotsCollected}</div>
                </div>
                
                <!-- Slots Missing -->
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px;">
                    <h4 style="margin: 0 0 8px 0; color: #f0883e; font-size: 12px;">⏳ STILL NEED</h4>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">${slotsMissing}</div>
                </div>
                
                ${metadata ? `
                <!-- Last Response Metrics -->
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px;">
                    <h4 style="margin: 0 0 8px 0; color: #58a6ff; font-size: 12px;">📊 LAST RESPONSE</h4>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px;">
                        <div style="color: #8b949e;">Latency:</div>
                        <div style="color: ${metadata.latencyMs < 500 ? '#3fb950' : metadata.latencyMs < 1000 ? '#f0883e' : '#f85149'};">${metadata.latencyMs || '—'}ms</div>
                        
                        <div style="color: #8b949e;">Tokens:</div>
                        <div style="color: #c9d1d9;">${metadata.tokensUsed || '—'}</div>
                        
                        <div style="color: #8b949e;">Mode:</div>
                        <div style="color: #c9d1d9;">${metadata.mode || 'discovery'}</div>
                        
                        <div style="color: #8b949e;">Next:</div>
                        <div style="color: #c9d1d9;">${metadata.needsInfo || 'none'}</div>
                    </div>
                </div>
                ` : ''}
                
                <!-- Debug Panel - Shows what LLM received -->
                <div style="background: #1a1d23; border: 1px solid #f0883e; border-radius: 8px; padding: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <h4 style="margin: 0; color: #f0883e; font-size: 12px;">🔧 DEBUG (What LLM Received)</h4>
                        <button onclick="window.aiTestConsole.copyDebug()" style="background: #30363d; border: none; color: #8b949e; padding: 4px 8px; border-radius: 4px; font-size: 10px; cursor: pointer;">📋 Copy</button>
                    </div>
                    ${this.lastDebug ? `
                    <div style="font-size: 11px; color: #8b949e; display: grid; gap: 6px;">
                        <div><strong style="color: #c9d1d9;">Turn #:</strong> ${this.lastDebug.turnCount || 1}</div>
                        <div><strong style="color: #c9d1d9;">History sent:</strong> ${this.lastDebug.historyReceived || 0} messages</div>
                        ${this.lastDebug.historyPreview?.length > 0 ? `
                        <div style="background: #161b22; padding: 6px; border-radius: 4px; margin-top: 4px;">
                            <div style="color: #58a6ff; font-size: 10px; margin-bottom: 4px;">Last history sent:</div>
                            ${this.lastDebug.historyPreview.map(h => `
                                <div style="color: ${h.role === 'user' ? '#3fb950' : '#58a6ff'}; font-size: 10px;">
                                    ${h.role}: ${h.content}
                                </div>
                            `).join('')}
                        </div>
                        ` : ''}
                        <div><strong style="color: #c9d1d9;">Quick Answer:</strong> ${this.lastDebug.wasQuickAnswer ? '✅ Yes' : '❌ No'}</div>
                        <div><strong style="color: #c9d1d9;">Triage Match:</strong> ${this.lastDebug.triageMatched ? '✅ Yes' : '❌ No'}</div>
                    </div>
                    ` : `
                    <div style="font-size: 11px; color: #6e7681; text-align: center; padding: 8px;">
                        Send a message to see debug info
                    </div>
                    `}
                </div>
                
                <!-- Tips -->
                <div style="background: #1c2128; border: 1px solid #30363d; border-radius: 8px; padding: 12px;">
                    <h4 style="margin: 0 0 8px 0; color: #a371f7; font-size: 12px;">💡 TESTING TIPS</h4>
                    <ul style="margin: 0; padding-left: 16px; color: #8b949e; font-size: 11px; line-height: 1.6;">
                        <li>Try interrupting mid-booking</li>
                        <li>Ask off-topic questions</li>
                        <li>Be vague or give partial info</li>
                        <li>Test with frustration phrases</li>
                        <li>Check emergency detection</li>
                    </ul>
                </div>
            </div>
        `;
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

