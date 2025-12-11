/**
 * ============================================================================
 * FRONT DESK BEHAVIOR MANAGER - UI for LLM-0 Conversation Style
 * ============================================================================
 * 
 * ALL controls are visible - no hidden magic.
 * Edit exactly how the AI talks to callers.
 * 
 * ============================================================================
 */

class FrontDeskBehaviorManager {
    constructor(companyId) {
        this.companyId = companyId;
        this.config = null;
        this.isDirty = false;
        console.log('[FRONT DESK BEHAVIOR] Manager initialized');
    }

    // Load config from API
    async load() {
        try {
            console.log('[FRONT DESK BEHAVIOR] Loading config for:', this.companyId);
            // Check all possible token locations (matches other managers)
            const token = localStorage.getItem('adminToken') || 
                          localStorage.getItem('token') || 
                          sessionStorage.getItem('token');
            
            if (!token) {
                console.warn('[FRONT DESK BEHAVIOR] No auth token found - using defaults');
                this.config = this.getDefaultConfig();
                return this.config;
            }
            
            const response = await fetch(`/api/admin/front-desk-behavior/${this.companyId}`, {
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.status === 401) {
                console.warn('[FRONT DESK BEHAVIOR] Auth failed (401) - check token or deploy status. Using defaults.');
                this.config = this.getDefaultConfig();
                return this.config;
            }
            
            if (!response.ok) {
                console.error('[FRONT DESK BEHAVIOR] API error:', response.status, response.statusText);
                throw new Error(`Failed to load Front Desk Behavior (${response.status})`);
            }
            
            const result = await response.json();
            this.config = result.data;
            console.log('[FRONT DESK BEHAVIOR] Config loaded:', this.config);
            
            return this.config;
        } catch (error) {
            console.error('[FRONT DESK BEHAVIOR] Load error:', error);
            // Fallback to defaults so UI still renders
            this.config = this.getDefaultConfig();
            console.log('[FRONT DESK BEHAVIOR] Using default config as fallback');
            return this.config;
        }
    }

    // Default config for when API is unavailable
    getDefaultConfig() {
        return {
            enabled: true,
            personality: {
                tone: 'warm',
                verbosity: 'concise',
                maxResponseWords: 30,
                useCallerName: true,
                agentName: 'Ashley'
            },
            bookingPrompts: {
                askName: "May I have your name?",
                askPhone: "What's the best phone number to reach you?",
                askAddress: "What's the service address?",
                askTime: "When works best for you - morning or afternoon?",
                confirmTemplate: "So I have {name} at {address}, {time}. Does that sound right?",
                completeTemplate: "You're all set, {name}! A technician will be out {time}. You'll receive a confirmation text shortly."
            },
            emotionResponses: {
                stressed: { enabled: true, acknowledgments: ["I understand, that sounds stressful."], followUp: "Let me help you get this taken care of." },
                frustrated: { enabled: true, acknowledgments: ["I completely understand."], followUp: "I'll get someone scheduled right away.", reduceFriction: true },
                angry: { enabled: true, acknowledgments: ["I'm really sorry you're dealing with this."], followUp: "Let me make this right.", offerEscalation: true },
                friendly: { enabled: true, allowSmallTalk: true },
                joking: { enabled: true, acknowledgments: ["Ha! I like that.", "That's a good one!"], respondInKind: true },
                panicked: { enabled: true, acknowledgments: ["I hear you, that sounds serious."], followUp: "Let me get someone out there right away.", bypassAllQuestions: true, confirmFirst: true }
            },
            frustrationTriggers: ["i don't care", "just send someone", "this is ridiculous", "you're not listening", "i already told you", "stop asking", "forget it", "whatever"],
            escalation: {
                enabled: true,
                maxLoopsBeforeOffer: 3,
                triggerPhrases: ["manager", "supervisor", "real person", "human", "someone else"],
                offerMessage: "I can connect you to someone directly or take a message for a manager. Which would you prefer?",
                transferMessage: "Let me connect you to our team now."
            },
            loopPrevention: {
                enabled: true,
                maxSameQuestion: 2,
                onLoop: 'rephrase',
                rephraseIntro: "Let me try this differently - "
            },
            forbiddenPhrases: ["tell me more about what you need", "what specific issues are you experiencing", "how can I help you", "what can I do for you today"],
            
            // ════════════════════════════════════════════════════════════════════
            // NEW: Detection Triggers - Control what AI detects
            // ════════════════════════════════════════════════════════════════════
            detectionTriggers: {
                // Trust Concern: Caller questions AI competence
                trustConcern: ["can you do", "can you handle", "can you fix", "are you able", "know what you're doing", "qualified", "sure you can", "is this going to work", "you guys any good"],
                // Caller feels ignored
                callerFeelsIgnored: ["you're not listening", "didn't listen", "you didn't hear", "you're ignoring", "you don't get it", "that's not what I said", "you missed"],
                // Caller refuses to give info
                refusedSlot: ["i don't want to", "not going to give", "don't want to share", "not comfortable", "rather not"],
                // Caller describing problem (not answering booking question)
                describingProblem: ["water leak", "thermostat", "not cooling", "not cool", "won't turn", "won't start", "making noise", "making sound", "smell", "broken", "not working", "problem is", "issue is"],
                // Booking intent detection
                wantsBooking: ["fix", "repair", "service", "appointment", "schedule", "technician", "someone", "come out", "send"]
            },
            
            // ════════════════════════════════════════════════════════════════════
            // NEW: Fallback Responses - What AI says when LLM fails
            // These ensure the call NEVER goes silent
            // ════════════════════════════════════════════════════════════════════
            fallbackResponses: {
                // Initial greeting if LLM fails on first turn
                greeting: "Thanks for calling! How can I help you today?",
                // Discovery phase - figuring out what they need
                discovery: "Got it, what's going on — is it not cooling, not heating, making noise, or something else?",
                // Booking slot collection
                askName: "May I have your name please?",
                askPhone: "And what's the best phone number to reach you?",
                askAddress: "What's the service address?",
                askTime: "When works best for you — morning or afternoon? Or I can send someone as soon as possible.",
                // Confirmation
                confirmBooking: "Let me confirm — I have you scheduled. Does that sound right?",
                bookingComplete: "You're all set! A technician will be out and you'll receive a confirmation text shortly. Is there anything else?",
                // Error recovery
                didNotHear: "I'm sorry, I didn't quite catch that. Could you please repeat?",
                connectionIssue: "I'm sorry, I think our connection isn't great. Could you please repeat that?",
                clarification: "I want to make sure I understand correctly. Could you tell me a bit more?",
                // Transfer
                transfering: "Let me connect you with someone who can help you right away. Please hold.",
                // Generic catch-all (last resort)
                generic: "I'm here to help. What can I do for you?"
            },
            
            // ════════════════════════════════════════════════════════════════════
            // NEW: Mode Switching - When to switch between modes
            // ════════════════════════════════════════════════════════════════════
            modeSwitching: {
                // Turns before allowing booking mode
                minTurnsBeforeBooking: 2,
                // Confidence threshold to lock booking
                bookingConfidenceThreshold: 0.75,
                // Auto-switch to rescue mode on frustration
                autoRescueOnFrustration: true,
                // Auto-switch to triage when describing problem
                autoTriageOnProblem: true
            }
        };
    }

    // Save config to API
    async save() {
        try {
            console.log('[FRONT DESK BEHAVIOR] Saving config...');
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token') || sessionStorage.getItem('token');
            
            const response = await fetch(`/api/admin/front-desk-behavior/${this.companyId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(this.config)
            });
            
            if (!response.ok) throw new Error('Failed to save');
            
            this.isDirty = false;
            this.showNotification('✅ Front Desk Behavior saved!', 'success');
            return true;
        } catch (error) {
            console.error('[FRONT DESK BEHAVIOR] Save error:', error);
            this.showNotification('❌ Save failed: ' + error.message, 'error');
            throw error;
        }
    }

    // Render the full UI
    render(container) {
        if (!this.config) {
            container.innerHTML = '<div style="padding: 20px; color: #8b949e;">Loading...</div>';
            return;
        }

        container.innerHTML = `
            <div class="front-desk-behavior-panel" style="padding: 20px; background: #0d1117; color: #e6edf3;">
                
                <!-- Header -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid #30363d; padding-bottom: 16px;">
                    <div>
                        <h2 style="margin: 0; font-size: 1.5rem; color: #58a6ff; display: flex; align-items: center; gap: 10px;">
                            💬 Front Desk Behavior
                            <span style="font-size: 0.75rem; padding: 3px 8px; background: ${this.config.enabled ? '#238636' : '#6e7681'}; border-radius: 12px; color: white;">
                                ${this.config.enabled ? 'ACTIVE' : 'DISABLED'}
                            </span>
                        </h2>
                        <p style="margin: 8px 0 0 0; color: #8b949e; font-size: 0.875rem;">
                            Control exactly how your AI talks to callers. All settings visible - no hidden magic.
                        </p>
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button id="fdb-reset-btn" style="padding: 8px 16px; background: #21262d; color: #8b949e; border: 1px solid #30363d; border-radius: 6px; cursor: pointer;">
                            Reset to Defaults
                        </button>
                        <button id="fdb-save-btn" style="padding: 8px 16px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                            💾 Save Changes
                        </button>
                    </div>
                </div>

                <!-- Tab Navigation -->
                <div id="fdb-tabs" style="display: flex; gap: 4px; margin-bottom: 20px; flex-wrap: wrap;">
                    ${this.renderTab('personality', '🎭 Personality', true)}
                    ${this.renderTab('booking', '📅 Booking Prompts')}
                    ${this.renderTab('emotions', '💭 Emotions')}
                    ${this.renderTab('frustration', '😤 Frustration')}
                    ${this.renderTab('escalation', '🆘 Escalation')}
                    ${this.renderTab('loops', '🔄 Loops')}
                    ${this.renderTab('forbidden', '🚫 Forbidden')}
                    ${this.renderTab('detection', '🔍 Detection')}
                    ${this.renderTab('fallbacks', '🆘 Fallbacks')}
                    ${this.renderTab('modes', '🔀 Modes')}
                    ${this.renderTab('test', '🧪 Test')}
                </div>

                <!-- Tab Content -->
                <div id="fdb-tab-content" style="min-height: 400px;">
                    ${this.renderPersonalityTab()}
                </div>
            </div>
        `;

        this.attachEventListeners(container);
    }

    renderTab(id, label, active = false) {
        return `
            <button class="fdb-tab" data-tab="${id}" style="
                padding: 10px 16px;
                background: ${active ? '#21262d' : 'transparent'};
                color: ${active ? '#58a6ff' : '#8b949e'};
                border: ${active ? '1px solid #30363d' : '1px solid transparent'};
                border-radius: 6px;
                cursor: pointer;
                font-size: 0.875rem;
            ">${label}</button>
        `;
    }

    renderPersonalityTab() {
        const p = this.config.personality || {};
        return `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="margin: 0 0 16px 0; color: #58a6ff;">🎭 Personality Settings</h3>
                <p style="color: #8b949e; margin-bottom: 20px; font-size: 0.875rem;">Control the overall tone and style of your AI receptionist.</p>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Tone</label>
                        <select id="fdb-tone" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                            <option value="warm" ${p.tone === 'warm' ? 'selected' : ''}>🌟 Warm - Friendly and caring</option>
                            <option value="professional" ${p.tone === 'professional' ? 'selected' : ''}>💼 Professional - Business-like</option>
                            <option value="casual" ${p.tone === 'casual' ? 'selected' : ''}>😊 Casual - Laid-back</option>
                            <option value="formal" ${p.tone === 'formal' ? 'selected' : ''}>🎩 Formal - Very proper</option>
                        </select>
                    </div>
                    
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Response Length</label>
                        <select id="fdb-verbosity" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                            <option value="concise" ${p.verbosity === 'concise' ? 'selected' : ''}>📝 Concise - Short and direct</option>
                            <option value="balanced" ${p.verbosity === 'balanced' ? 'selected' : ''}>⚖️ Balanced - Medium length</option>
                            <option value="detailed" ${p.verbosity === 'detailed' ? 'selected' : ''}>📖 Detailed - More explanation</option>
                        </select>
                    </div>
                    
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                            Max Response Words: <span id="fdb-max-words-val" style="color: #58a6ff;">${p.maxResponseWords || 30}</span>
                        </label>
                        <input type="range" id="fdb-max-words" min="10" max="100" value="${p.maxResponseWords || 30}" style="width: 100%; accent-color: #58a6ff;">
                    </div>
                    
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Use Caller's Name</label>
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px;">
                            <input type="checkbox" id="fdb-use-name" ${p.useCallerName !== false ? 'checked' : ''} style="accent-color: #58a6ff; width: 18px; height: 18px;">
                            <span style="color: #c9d1d9;">Address caller by name once known</span>
                        </label>
                    </div>
                </div>
            </div>
        `;
    }

    renderBookingPromptsTab() {
        const bp = this.config.bookingPrompts || {};
        return `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="margin: 0 0 16px 0; color: #58a6ff;">📅 Booking Prompts</h3>
                <p style="color: #8b949e; margin-bottom: 20px; font-size: 0.875rem;">What the AI says when collecting booking information. Use {name}, {address}, {time} as placeholders.</p>
                
                <div style="display: flex; flex-direction: column; gap: 16px;">
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Ask for Name</label>
                        <input type="text" id="fdb-askName" value="${bp.askName || "May I have your name?"}" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Ask for Phone</label>
                        <input type="text" id="fdb-askPhone" value="${bp.askPhone || "What's the best phone number to reach you?"}" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Ask for Address</label>
                        <input type="text" id="fdb-askAddress" value="${bp.askAddress || "What's the service address?"}" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Ask for Time</label>
                        <input type="text" id="fdb-askTime" value="${bp.askTime || "When works best for you - morning or afternoon?"}" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Confirmation Template</label>
                        <textarea id="fdb-confirmTemplate" rows="2" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical;">${bp.confirmTemplate || "So I have {name} at {address}, {time}. Does that sound right?"}</textarea>
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Completion Message</label>
                        <textarea id="fdb-completeTemplate" rows="2" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical;">${bp.completeTemplate || "You're all set, {name}! A technician will be out {time}. You'll receive a confirmation text shortly."}</textarea>
                    </div>
                </div>
            </div>
        `;
    }

    renderEmotionsTab() {
        const er = this.config.emotionResponses || {};
        return `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="margin: 0 0 16px 0; color: #58a6ff;">💭 Emotion Intelligence</h3>
                <p style="color: #8b949e; margin-bottom: 20px; font-size: 0.875rem;">
                    AI naturally detects emotions and responds appropriately. These toggles control <strong>behavior rules</strong>, not scripts.
                </p>
                
                <!-- SIMPLE TOGGLES - Let AI generate its own words -->
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    
                    <!-- Stressed -->
                    <label style="display: flex; align-items: center; gap: 12px; padding: 14px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; cursor: pointer;">
                        <input type="checkbox" id="fdb-emotion-stressed-enabled" ${er.stressed?.enabled !== false ? 'checked' : ''} style="accent-color: #58a6ff; width: 18px; height: 18px;">
                        <div>
                            <span style="color: #c9d1d9; font-weight: 600;">😟 Stressed</span>
                            <p style="margin: 4px 0 0 0; color: #8b949e; font-size: 12px;">AI will be reassuring and helpful</p>
                        </div>
                    </label>
                    
                    <!-- Frustrated -->
                    <div style="padding: 14px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px;">
                        <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
                            <input type="checkbox" id="fdb-emotion-frustrated-enabled" ${er.frustrated?.enabled !== false ? 'checked' : ''} style="accent-color: #58a6ff; width: 18px; height: 18px;">
                            <div>
                                <span style="color: #c9d1d9; font-weight: 600;">😤 Frustrated</span>
                                <p style="margin: 4px 0 0 0; color: #8b949e; font-size: 12px;">AI will empathize and move faster</p>
                            </div>
                        </label>
                        <label style="display: flex; align-items: center; gap: 8px; margin: 10px 0 0 30px; cursor: pointer;">
                            <input type="checkbox" id="fdb-emotion-frustrated-reduce" ${er.frustrated?.reduceFriction ? 'checked' : ''} style="accent-color: #f0883e;">
                            <span style="color: #f0883e; font-size: 13px;">Skip optional questions</span>
                        </label>
                    </div>
                    
                    <!-- Angry -->
                    <div style="padding: 14px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px;">
                        <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
                            <input type="checkbox" id="fdb-emotion-angry-enabled" ${er.angry?.enabled !== false ? 'checked' : ''} style="accent-color: #58a6ff; width: 18px; height: 18px;">
                            <div>
                                <span style="color: #c9d1d9; font-weight: 600;">😠 Angry</span>
                                <p style="margin: 4px 0 0 0; color: #8b949e; font-size: 12px;">AI will apologize and de-escalate</p>
                            </div>
                        </label>
                        <label style="display: flex; align-items: center; gap: 8px; margin: 10px 0 0 30px; cursor: pointer;">
                            <input type="checkbox" id="fdb-emotion-angry-escalate" ${er.angry?.offerEscalation ? 'checked' : ''} style="accent-color: #f85149;">
                            <span style="color: #f85149; font-size: 13px;">Offer escalation to human</span>
                        </label>
                    </div>
                    
                    <!-- Friendly -->
                    <div style="padding: 14px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px;">
                        <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
                            <input type="checkbox" id="fdb-emotion-friendly-enabled" ${er.friendly?.enabled !== false ? 'checked' : ''} style="accent-color: #58a6ff; width: 18px; height: 18px;">
                            <div>
                                <span style="color: #c9d1d9; font-weight: 600;">😊 Friendly</span>
                                <p style="margin: 4px 0 0 0; color: #8b949e; font-size: 12px;">AI will be warm and personable</p>
                            </div>
                        </label>
                        <label style="display: flex; align-items: center; gap: 8px; margin: 10px 0 0 30px; cursor: pointer;">
                            <input type="checkbox" id="fdb-emotion-friendly-smalltalk" ${er.friendly?.allowSmallTalk ? 'checked' : ''} style="accent-color: #3fb950;">
                            <span style="color: #3fb950; font-size: 13px;">Allow brief small talk</span>
                        </label>
                    </div>
                    
                    <!-- Joking -->
                    <div style="padding: 14px; background: #0d1117; border: 1px solid #3fb950; border-radius: 8px;">
                        <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
                            <input type="checkbox" id="fdb-emotion-joking-enabled" ${er.joking?.enabled !== false ? 'checked' : ''} style="accent-color: #58a6ff; width: 18px; height: 18px;">
                            <div>
                                <span style="color: #c9d1d9; font-weight: 600;">😄 Joking/Playful</span>
                                <p style="margin: 4px 0 0 0; color: #8b949e; font-size: 12px;">AI knows "I'm dying here" is hyperbole, not emergency</p>
                            </div>
                        </label>
                        <label style="display: flex; align-items: center; gap: 8px; margin: 10px 0 0 30px; cursor: pointer;">
                            <input type="checkbox" id="fdb-emotion-joking-respond" ${er.joking?.respondInKind !== false ? 'checked' : ''} style="accent-color: #3fb950;">
                            <span style="color: #3fb950; font-size: 13px;">Match their playful energy</span>
                        </label>
                    </div>
                    
                    <!-- Panicked/Emergency -->
                    <div style="padding: 14px; background: #1a0d0d; border: 1px solid #f85149; border-radius: 8px;">
                        <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
                            <input type="checkbox" id="fdb-emotion-panicked-enabled" ${er.panicked?.enabled !== false ? 'checked' : ''} style="accent-color: #58a6ff; width: 18px; height: 18px;">
                            <div>
                                <span style="color: #f85149; font-weight: 600;">🚨 Emergency/Panicked</span>
                                <p style="margin: 4px 0 0 0; color: #8b949e; font-size: 12px;">AI recognizes real danger: gas leak, smoke, fire, flooding</p>
                            </div>
                        </label>
                        <div style="margin: 10px 0 0 30px;">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" id="fdb-emotion-panicked-bypass" ${er.panicked?.bypassAllQuestions !== false ? 'checked' : ''} style="accent-color: #f85149;">
                                <span style="color: #f85149; font-size: 13px;">Skip questions, dispatch immediately</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; margin-top: 6px; cursor: pointer;">
                                <input type="checkbox" id="fdb-emotion-panicked-confirm" ${er.panicked?.confirmFirst !== false ? 'checked' : ''} style="accent-color: #f0883e;">
                                <span style="color: #f0883e; font-size: 13px;">Ask "Are you in immediate danger?" first</span>
                            </label>
                        </div>
                    </div>
                    
                </div>
            </div>
        `;
    }

    // REMOVED: renderEmotionSection - No longer needed
    // AI generates its own words. We only control behavior rules via toggles.

    renderFrustrationTab() {
        const triggers = this.config.frustrationTriggers || [];
        return `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="margin: 0 0 16px 0; color: #f0883e;">😤 Frustration Triggers</h3>
                <p style="color: #8b949e; margin-bottom: 20px; font-size: 0.875rem;">Phrases that indicate the caller is losing patience. When detected, the AI will reduce friction.</p>
                
                <div id="fdb-frustration-list" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px;">
                    ${triggers.map((t, i) => this.renderTriggerChip(t, i, 'frustration')).join('')}
                </div>
                
                <div style="display: flex; gap: 10px;">
                    <input type="text" id="fdb-new-frustration" placeholder="Add new trigger phrase..." 
                        style="flex: 1; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                    <button id="fdb-add-frustration" style="padding: 10px 20px; background: #f0883e; color: #0d1117; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                        + Add
                    </button>
                </div>
            </div>
        `;
    }

    renderTriggerChip(text, index, type) {
        return `
            <span style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: #21262d; border: 1px solid #30363d; border-radius: 20px; color: #c9d1d9; font-size: 0.875rem;">
                "${text}"
                <button onclick="window.frontDeskBehaviorManager.removeTrigger('${type}', ${index})" 
                    style="background: none; border: none; color: #f85149; cursor: pointer; font-size: 1rem; padding: 0; line-height: 1;">×</button>
            </span>
        `;
    }

    renderEscalationTab() {
        const e = this.config.escalation || {};
        const triggers = e.triggerPhrases || [];
        return `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="margin: 0 0 16px 0; color: #f85149;">🆘 Escalation Settings</h3>
                <p style="color: #8b949e; margin-bottom: 20px; font-size: 0.875rem;">When to offer connecting the caller to a human.</p>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" id="fdb-escalation-enabled" ${e.enabled !== false ? 'checked' : ''} style="accent-color: #58a6ff; width: 18px; height: 18px;">
                        <span style="color: #c9d1d9; font-weight: 500;">Enable escalation system</span>
                    </label>
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                        Max loops before offering escalation: <span style="color: #58a6ff;">${e.maxLoopsBeforeOffer || 3}</span>
                    </label>
                    <input type="range" id="fdb-max-loops" min="1" max="5" value="${e.maxLoopsBeforeOffer || 3}" style="width: 50%; accent-color: #58a6ff;">
                </div>
                
                <h4 style="color: #c9d1d9; margin: 20px 0 12px 0;">Escalation Trigger Phrases</h4>
                <div id="fdb-escalation-list" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px;">
                    ${triggers.map((t, i) => this.renderTriggerChip(t, i, 'escalation')).join('')}
                </div>
                
                <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                    <input type="text" id="fdb-new-escalation" placeholder="Add escalation trigger..." 
                        style="flex: 1; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                    <button id="fdb-add-escalation" style="padding: 10px 20px; background: #f85149; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                        + Add
                    </button>
                </div>
                
                <div style="margin-top: 20px;">
                    <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Offer Message</label>
                    <textarea id="fdb-escalation-offer" rows="2" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical;">${e.offerMessage || ''}</textarea>
                </div>
                
                <div style="margin-top: 12px;">
                    <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Transfer Message</label>
                    <input type="text" id="fdb-escalation-transfer" value="${e.transferMessage || ''}" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                </div>
            </div>
        `;
    }

    renderLoopsTab() {
        const lp = this.config.loopPrevention || {};
        return `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="margin: 0 0 16px 0; color: #58a6ff;">🔄 Loop Prevention</h3>
                <p style="color: #8b949e; margin-bottom: 20px; font-size: 0.875rem;">Prevent the AI from asking the same question repeatedly.</p>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" id="fdb-loop-enabled" ${lp.enabled !== false ? 'checked' : ''} style="accent-color: #58a6ff; width: 18px; height: 18px;">
                        <span style="color: #c9d1d9; font-weight: 500;">Enable loop prevention</span>
                    </label>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                            Max times to ask same question: <span style="color: #58a6ff;">${lp.maxSameQuestion || 2}</span>
                        </label>
                        <input type="range" id="fdb-max-same-q" min="1" max="5" value="${lp.maxSameQuestion || 2}" style="width: 100%; accent-color: #58a6ff;">
                    </div>
                    
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">When loop detected</label>
                        <select id="fdb-on-loop" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                            <option value="rephrase" ${lp.onLoop === 'rephrase' ? 'selected' : ''}>🔄 Rephrase the question</option>
                            <option value="skip" ${lp.onLoop === 'skip' ? 'selected' : ''}>⏭️ Skip and move on</option>
                            <option value="escalate" ${lp.onLoop === 'escalate' ? 'selected' : ''}>🆘 Offer escalation</option>
                        </select>
                    </div>
                </div>
                
                <div style="margin-top: 20px;">
                    <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Rephrase Introduction</label>
                    <input type="text" id="fdb-rephrase-intro" value="${lp.rephraseIntro || 'Let me try this differently - '}" 
                        style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                </div>
            </div>
        `;
    }

    renderForbiddenTab() {
        const phrases = this.config.forbiddenPhrases || [];
        return `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="margin: 0 0 16px 0; color: #f85149;">🚫 Forbidden Phrases</h3>
                <p style="color: #8b949e; margin-bottom: 20px; font-size: 0.875rem;">The AI will never say these phrases. Add anything that sounds robotic or annoying.</p>
                
                <div id="fdb-forbidden-list" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;">
                    ${phrases.map((p, i) => `
                        <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px;">
                            <span style="color: #f85149; font-size: 1.2rem;">🚫</span>
                            <span style="flex: 1; color: #c9d1d9;">"${p}"</span>
                            <button onclick="window.frontDeskBehaviorManager.removeTrigger('forbidden', ${i})" 
                                style="background: none; border: none; color: #f85149; cursor: pointer; font-size: 1.2rem;">×</button>
                        </div>
                    `).join('')}
                </div>
                
                <div style="display: flex; gap: 10px;">
                    <input type="text" id="fdb-new-forbidden" placeholder="Add forbidden phrase..." 
                        style="flex: 1; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                    <button id="fdb-add-forbidden" style="padding: 10px 20px; background: #f85149; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                        + Add
                    </button>
                </div>
            </div>
        `;
    }

    // ════════════════════════════════════════════════════════════════════
    // NEW TAB: Detection Triggers
    // ════════════════════════════════════════════════════════════════════
    renderDetectionTab() {
        const dt = this.config.detectionTriggers || {};
        return `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="margin: 0 0 16px 0; color: #a371f7;">🔍 Detection Triggers</h3>
                <p style="color: #8b949e; margin-bottom: 20px; font-size: 0.875rem;">
                    These patterns control WHAT the AI detects in caller speech. Add phrases that trigger each behavior.
                </p>
                
                <!-- Trust Concern -->
                <div style="margin-bottom: 24px; border: 1px solid #30363d; border-radius: 8px; padding: 16px; background: #0d1117;">
                    <h4 style="margin: 0 0 8px 0; color: #f0883e;">🤔 Trust Concern Detection</h4>
                    <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 12px;">When caller questions if AI can actually help them</p>
                    <div id="fdb-trust-list" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
                        ${(dt.trustConcern || []).map((t, i) => this.renderDetectionChip(t, i, 'trustConcern')).join('')}
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <input type="text" id="fdb-new-trustConcern" placeholder="e.g., 'are you sure you can help'" 
                            style="flex: 1; padding: 8px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        <button onclick="window.frontDeskBehaviorManager.addDetection('trustConcern')" 
                            style="padding: 8px 16px; background: #f0883e; color: #0d1117; border: none; border-radius: 6px; cursor: pointer;">+ Add</button>
                    </div>
                </div>
                
                <!-- Caller Feels Ignored -->
                <div style="margin-bottom: 24px; border: 1px solid #30363d; border-radius: 8px; padding: 16px; background: #0d1117;">
                    <h4 style="margin: 0 0 8px 0; color: #f85149;">😤 Caller Feels Ignored Detection</h4>
                    <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 12px;">When caller explicitly says AI isn't listening</p>
                    <div id="fdb-ignored-list" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
                        ${(dt.callerFeelsIgnored || []).map((t, i) => this.renderDetectionChip(t, i, 'callerFeelsIgnored')).join('')}
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <input type="text" id="fdb-new-callerFeelsIgnored" placeholder="e.g., 'you're not listening to me'" 
                            style="flex: 1; padding: 8px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        <button onclick="window.frontDeskBehaviorManager.addDetection('callerFeelsIgnored')" 
                            style="padding: 8px 16px; background: #f85149; color: white; border: none; border-radius: 6px; cursor: pointer;">+ Add</button>
                    </div>
                </div>
                
                <!-- Refused Slot -->
                <div style="margin-bottom: 24px; border: 1px solid #30363d; border-radius: 8px; padding: 16px; background: #0d1117;">
                    <h4 style="margin: 0 0 8px 0; color: #8b949e;">🙅 Refused Slot Detection</h4>
                    <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 12px;">When caller refuses to give info (name, phone, etc.)</p>
                    <div id="fdb-refused-list" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
                        ${(dt.refusedSlot || []).map((t, i) => this.renderDetectionChip(t, i, 'refusedSlot')).join('')}
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <input type="text" id="fdb-new-refusedSlot" placeholder="e.g., 'I don't want to give that'" 
                            style="flex: 1; padding: 8px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        <button onclick="window.frontDeskBehaviorManager.addDetection('refusedSlot')" 
                            style="padding: 8px 16px; background: #6e7681; color: white; border: none; border-radius: 6px; cursor: pointer;">+ Add</button>
                    </div>
                </div>
                
                <!-- Describing Problem -->
                <div style="margin-bottom: 24px; border: 1px solid #30363d; border-radius: 8px; padding: 16px; background: #0d1117;">
                    <h4 style="margin: 0 0 8px 0; color: #58a6ff;">🔧 Problem Description Detection</h4>
                    <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 12px;">When caller describes their issue (triggers triage mode)</p>
                    <div id="fdb-problem-list" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
                        ${(dt.describingProblem || []).map((t, i) => this.renderDetectionChip(t, i, 'describingProblem')).join('')}
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <input type="text" id="fdb-new-describingProblem" placeholder="e.g., 'water leaking'" 
                            style="flex: 1; padding: 8px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        <button onclick="window.frontDeskBehaviorManager.addDetection('describingProblem')" 
                            style="padding: 8px 16px; background: #58a6ff; color: white; border: none; border-radius: 6px; cursor: pointer;">+ Add</button>
                    </div>
                </div>
                
                <!-- Wants Booking -->
                <div style="border: 1px solid #30363d; border-radius: 8px; padding: 16px; background: #0d1117;">
                    <h4 style="margin: 0 0 8px 0; color: #3fb950;">📅 Booking Intent Detection</h4>
                    <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 12px;">When caller wants to schedule an appointment</p>
                    <div id="fdb-booking-list" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
                        ${(dt.wantsBooking || []).map((t, i) => this.renderDetectionChip(t, i, 'wantsBooking')).join('')}
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <input type="text" id="fdb-new-wantsBooking" placeholder="e.g., 'schedule a visit'" 
                            style="flex: 1; padding: 8px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        <button onclick="window.frontDeskBehaviorManager.addDetection('wantsBooking')" 
                            style="padding: 8px 16px; background: #3fb950; color: white; border: none; border-radius: 6px; cursor: pointer;">+ Add</button>
                    </div>
                </div>
            </div>
        `;
    }
    
    renderDetectionChip(text, index, type) {
        const colors = {
            trustConcern: '#f0883e',
            callerFeelsIgnored: '#f85149',
            refusedSlot: '#8b949e',
            describingProblem: '#58a6ff',
            wantsBooking: '#3fb950'
        };
        return `
            <span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: ${colors[type]}20; border: 1px solid ${colors[type]}40; border-radius: 16px; color: ${colors[type]}; font-size: 0.8rem;">
                "${text}"
                <button onclick="window.frontDeskBehaviorManager.removeDetection('${type}', ${index})" 
                    style="background: none; border: none; color: ${colors[type]}; cursor: pointer; font-size: 1rem; padding: 0; line-height: 1;">×</button>
            </span>
        `;
    }
    
    addDetection(type) {
        const input = document.getElementById(`fdb-new-${type}`);
        if (!input || !input.value.trim()) return;
        
        if (!this.config.detectionTriggers) this.config.detectionTriggers = {};
        if (!this.config.detectionTriggers[type]) this.config.detectionTriggers[type] = [];
        
        this.config.detectionTriggers[type].push(input.value.trim().toLowerCase());
        input.value = '';
        this.isDirty = true;
        
        const container = document.querySelector('.front-desk-behavior-panel');
        if (container) this.switchTab('detection', container);
    }
    
    removeDetection(type, index) {
        if (this.config.detectionTriggers?.[type]) {
            this.config.detectionTriggers[type].splice(index, 1);
            this.isDirty = true;
            
            const container = document.querySelector('.front-desk-behavior-panel');
            if (container) this.switchTab('detection', container);
        }
    }
    
    // ════════════════════════════════════════════════════════════════════
    // NEW TAB: Fallback Responses
    // ════════════════════════════════════════════════════════════════════
    renderFallbacksTab() {
        const fb = this.config.fallbackResponses || {};
        // Get defaults for prefilling
        const defaults = this.getDefaultConfig().fallbackResponses;
        
        return `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="margin: 0 0 16px 0; color: #f85149;">🆘 Fallback Responses</h3>
                <p style="color: #8b949e; margin-bottom: 20px; font-size: 0.875rem;">
                    What the AI says when the LLM fails or times out. <strong>These ensure the call NEVER goes silent.</strong>
                </p>
                
                <div style="display: flex; flex-direction: column; gap: 16px;">
                    
                    <!-- Section: Initial & Discovery -->
                    <div style="border-bottom: 1px solid #30363d; padding-bottom: 16px; margin-bottom: 8px;">
                        <h4 style="color: #58a6ff; margin: 0 0 12px 0; font-size: 0.9rem;">🎬 Initial & Discovery</h4>
                        
                        <div style="margin-bottom: 12px;">
                            <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                                👋 Greeting Fallback <span style="color: #8b949e; font-weight: normal;">(first turn if LLM fails)</span>
                            </label>
                            <input type="text" id="fdb-fb-greeting" value="${fb.greeting || defaults.greeting}" 
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                        
                        <div>
                            <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                                🔍 Discovery Fallback <span style="color: #8b949e; font-weight: normal;">(figuring out what they need)</span>
                            </label>
                            <input type="text" id="fdb-fb-discovery" value="${fb.discovery || defaults.discovery}" 
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                    </div>
                    
                    <!-- Section: Booking Slots -->
                    <div style="border-bottom: 1px solid #30363d; padding-bottom: 16px; margin-bottom: 8px;">
                        <h4 style="color: #3fb950; margin: 0 0 12px 0; font-size: 0.9rem;">📅 Booking Slot Collection</h4>
                        
                        <div style="margin-bottom: 12px;">
                            <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                                👤 Ask Name
                            </label>
                            <input type="text" id="fdb-fb-askName" value="${fb.askName || defaults.askName}" 
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                        
                        <div style="margin-bottom: 12px;">
                            <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                                📞 Ask Phone
                            </label>
                            <input type="text" id="fdb-fb-askPhone" value="${fb.askPhone || defaults.askPhone}" 
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                        
                        <div style="margin-bottom: 12px;">
                            <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                                📍 Ask Address
                            </label>
                            <input type="text" id="fdb-fb-askAddress" value="${fb.askAddress || defaults.askAddress}" 
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                        
                        <div>
                            <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                                🕐 Ask Time
                            </label>
                            <input type="text" id="fdb-fb-askTime" value="${fb.askTime || defaults.askTime}" 
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                    </div>
                    
                    <!-- Section: Confirmation -->
                    <div style="border-bottom: 1px solid #30363d; padding-bottom: 16px; margin-bottom: 8px;">
                        <h4 style="color: #a371f7; margin: 0 0 12px 0; font-size: 0.9rem;">✅ Confirmation</h4>
                        
                        <div style="margin-bottom: 12px;">
                            <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                                ✔️ Confirm Booking
                            </label>
                            <input type="text" id="fdb-fb-confirmBooking" value="${fb.confirmBooking || defaults.confirmBooking}" 
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                        
                        <div>
                            <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                                🎉 Booking Complete
                            </label>
                            <input type="text" id="fdb-fb-bookingComplete" value="${fb.bookingComplete || defaults.bookingComplete}" 
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                    </div>
                    
                    <!-- Section: Error Recovery -->
                    <div style="border-bottom: 1px solid #30363d; padding-bottom: 16px; margin-bottom: 8px;">
                        <h4 style="color: #f0883e; margin: 0 0 12px 0; font-size: 0.9rem;">🔄 Error Recovery</h4>
                        
                        <div style="margin-bottom: 12px;">
                            <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                                👂 Didn't Hear <span style="color: #8b949e; font-weight: normal;">(STT failed)</span>
                            </label>
                            <input type="text" id="fdb-fb-didNotHear" value="${fb.didNotHear || defaults.didNotHear}" 
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                        
                        <div style="margin-bottom: 12px;">
                            <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                                📶 Connection Issue <span style="color: #8b949e; font-weight: normal;">(blame connection, not caller)</span>
                            </label>
                            <input type="text" id="fdb-fb-connectionIssue" value="${fb.connectionIssue || defaults.connectionIssue}" 
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                        
                        <div>
                            <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                                🤔 Clarification <span style="color: #8b949e; font-weight: normal;">(need more info)</span>
                            </label>
                            <input type="text" id="fdb-fb-clarification" value="${fb.clarification || defaults.clarification}" 
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                    </div>
                    
                    <!-- Section: Transfer & Catch-All -->
                    <div>
                        <h4 style="color: #f85149; margin: 0 0 12px 0; font-size: 0.9rem;">📞 Transfer & Catch-All</h4>
                        
                        <div style="margin-bottom: 12px;">
                            <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                                📞 Transferring <span style="color: #8b949e; font-weight: normal;">(before connecting to human)</span>
                            </label>
                            <input type="text" id="fdb-fb-transfering" value="${fb.transfering || defaults.transfering}" 
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                        
                        <div>
                            <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                                🆘 Generic Fallback <span style="color: #8b949e; font-weight: normal;">(absolute last resort)</span>
                            </label>
                            <input type="text" id="fdb-fb-generic" value="${fb.generic || defaults.generic}" 
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    // ════════════════════════════════════════════════════════════════════
    // NEW TAB: Mode Switching
    // ════════════════════════════════════════════════════════════════════
    renderModesTab() {
        const ms = this.config.modeSwitching || {};
        return `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="margin: 0 0 16px 0; color: #a371f7;">🔀 Mode Switching</h3>
                <p style="color: #8b949e; margin-bottom: 20px; font-size: 0.875rem;">
                    Control when the AI switches between Discovery, Booking, Triage, and Rescue modes.
                </p>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                            Minimum Turns Before Booking: <span style="color: #58a6ff;">${ms.minTurnsBeforeBooking || 2}</span>
                        </label>
                        <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 8px;">
                            AI won't jump to booking until this many conversation turns
                        </p>
                        <input type="range" id="fdb-ms-minTurns" min="0" max="5" value="${ms.minTurnsBeforeBooking || 2}" 
                            style="width: 100%; accent-color: #58a6ff;">
                    </div>
                    
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                            Booking Confidence Threshold: <span style="color: #58a6ff;">${((ms.bookingConfidenceThreshold || 0.75) * 100).toFixed(0)}%</span>
                        </label>
                        <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 8px;">
                            How confident AI must be before locking into booking mode
                        </p>
                        <input type="range" id="fdb-ms-confidence" min="50" max="100" value="${((ms.bookingConfidenceThreshold || 0.75) * 100).toFixed(0)}" 
                            style="width: 100%; accent-color: #58a6ff;">
                    </div>
                </div>
                
                <div style="margin-top: 24px; display: flex; flex-direction: column; gap: 12px;">
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px;">
                        <input type="checkbox" id="fdb-ms-autoRescue" ${ms.autoRescueOnFrustration !== false ? 'checked' : ''} 
                            style="accent-color: #f85149; width: 18px; height: 18px;">
                        <div>
                            <span style="color: #c9d1d9; font-weight: 500;">🆘 Auto-switch to Rescue on Frustration</span>
                            <p style="color: #8b949e; font-size: 0.8rem; margin: 4px 0 0 0;">
                                When frustration is detected, immediately switch to rescue mode
                            </p>
                        </div>
                    </label>
                    
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px;">
                        <input type="checkbox" id="fdb-ms-autoTriage" ${ms.autoTriageOnProblem !== false ? 'checked' : ''} 
                            style="accent-color: #58a6ff; width: 18px; height: 18px;">
                        <div>
                            <span style="color: #c9d1d9; font-weight: 500;">🔧 Auto-switch to Triage on Problem Description</span>
                            <p style="color: #8b949e; font-size: 0.8rem; margin: 4px 0 0 0;">
                                When caller describes their issue, switch to diagnostic mode
                            </p>
                        </div>
                    </label>
                </div>
            </div>
        `;
    }

    renderTestTab() {
        return `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="margin: 0 0 16px 0; color: #58a6ff;">🧪 Test Phrase</h3>
                <p style="color: #8b949e; margin-bottom: 20px; font-size: 0.875rem;">Test how the AI would respond to different caller emotions.</p>
                
                <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                    <input type="text" id="fdb-test-phrase" placeholder="e.g., 'this is ridiculous, just send someone'" 
                        style="flex: 1; padding: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 1rem;">
                    <button id="fdb-test-btn" style="padding: 12px 24px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                        🧪 Test
                    </button>
                </div>
                
                <div id="fdb-test-result" style="display: none; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 16px;"></div>
            </div>
        `;
    }

    attachEventListeners(container) {
        // Tab switching
        container.querySelectorAll('.fdb-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab, container));
        });

        // Save button
        container.querySelector('#fdb-save-btn')?.addEventListener('click', () => this.collectAndSave());

        // Reset button
        container.querySelector('#fdb-reset-btn')?.addEventListener('click', () => this.resetToDefaults());

        // Slider updates
        const maxWordsSlider = container.querySelector('#fdb-max-words');
        if (maxWordsSlider) {
            maxWordsSlider.addEventListener('input', (e) => {
                const val = container.querySelector('#fdb-max-words-val');
                if (val) val.textContent = e.target.value;
            });
        }

        // Add trigger buttons
        ['frustration', 'escalation', 'forbidden'].forEach(type => {
            const addBtn = container.querySelector(`#fdb-add-${type}`);
            const input = container.querySelector(`#fdb-new-${type}`);
            if (addBtn && input) {
                addBtn.addEventListener('click', () => this.addTrigger(type, input.value, container));
                input.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') this.addTrigger(type, input.value, container);
                });
            }
        });

        // Test button
        container.querySelector('#fdb-test-btn')?.addEventListener('click', () => this.testPhrase(container));

        // Make manager globally accessible
        window.frontDeskBehaviorManager = this;
    }

    switchTab(tabId, container) {
        container.querySelectorAll('.fdb-tab').forEach(tab => {
            const isActive = tab.dataset.tab === tabId;
            tab.style.background = isActive ? '#21262d' : 'transparent';
            tab.style.color = isActive ? '#58a6ff' : '#8b949e';
            tab.style.border = isActive ? '1px solid #30363d' : '1px solid transparent';
        });

        const content = container.querySelector('#fdb-tab-content');
        switch (tabId) {
            case 'personality': content.innerHTML = this.renderPersonalityTab(); break;
            case 'booking': content.innerHTML = this.renderBookingPromptsTab(); break;
            case 'emotions': content.innerHTML = this.renderEmotionsTab(); break;
            case 'frustration': content.innerHTML = this.renderFrustrationTab(); break;
            case 'escalation': content.innerHTML = this.renderEscalationTab(); break;
            case 'loops': content.innerHTML = this.renderLoopsTab(); break;
            case 'forbidden': content.innerHTML = this.renderForbiddenTab(); break;
            case 'detection': content.innerHTML = this.renderDetectionTab(); break;
            case 'fallbacks': content.innerHTML = this.renderFallbacksTab(); break;
            case 'modes': content.innerHTML = this.renderModesTab(); break;
            case 'test': content.innerHTML = this.renderTestTab(); break;
        }

        this.attachEventListeners(container.closest('.front-desk-behavior-panel')?.parentElement || container);
    }

    addTrigger(type, value, container) {
        if (!value || !value.trim()) return;
        
        if (type === 'escalation') {
            if (!this.config.escalation) this.config.escalation = {};
            if (!this.config.escalation.triggerPhrases) this.config.escalation.triggerPhrases = [];
            this.config.escalation.triggerPhrases.push(value.trim().toLowerCase());
        } else if (type === 'forbidden') {
            if (!this.config.forbiddenPhrases) this.config.forbiddenPhrases = [];
            this.config.forbiddenPhrases.push(value.trim());
        } else {
            if (!this.config.frustrationTriggers) this.config.frustrationTriggers = [];
            this.config.frustrationTriggers.push(value.trim().toLowerCase());
        }
        
        this.isDirty = true;
        this.switchTab(type === 'escalation' ? 'escalation' : type, container);
        
        const input = container.querySelector(`#fdb-new-${type}`);
        if (input) input.value = '';
    }

    removeTrigger(type, index) {
        if (type === 'escalation') {
            this.config.escalation?.triggerPhrases?.splice(index, 1);
        } else if (type === 'forbidden') {
            this.config.forbiddenPhrases?.splice(index, 1);
        } else {
            this.config.frustrationTriggers?.splice(index, 1);
        }
        
        this.isDirty = true;
        
        const container = document.querySelector('.front-desk-behavior-panel');
        if (container) this.switchTab(type === 'escalation' ? 'escalation' : type, container);
    }

    collectFormData() {
        const get = (id) => document.getElementById(id)?.value;
        const getChecked = (id) => document.getElementById(id)?.checked;

        if (document.getElementById('fdb-tone')) {
            this.config.personality = {
                tone: get('fdb-tone'),
                verbosity: get('fdb-verbosity'),
                maxResponseWords: parseInt(get('fdb-max-words')) || 30,
                useCallerName: getChecked('fdb-use-name')
            };
        }

        if (document.getElementById('fdb-askName')) {
            this.config.bookingPrompts = {
                askName: get('fdb-askName'),
                askPhone: get('fdb-askPhone'),
                askAddress: get('fdb-askAddress'),
                askTime: get('fdb-askTime'),
                confirmTemplate: get('fdb-confirmTemplate'),
                completeTemplate: get('fdb-completeTemplate')
            };
        }

        // Simplified emotion toggles - AI generates its own words
        if (!this.config.emotionResponses) this.config.emotionResponses = {};
        
        // Simple enabled toggles for each emotion
        ['stressed', 'frustrated', 'angry', 'friendly', 'joking', 'panicked'].forEach(emotion => {
            const enabledEl = document.getElementById(`fdb-emotion-${emotion}-enabled`);
            if (enabledEl) {
                this.config.emotionResponses[emotion] = {
                    enabled: enabledEl.checked
                };
            }
        });
        
        // Extra behavior rules for specific emotions
        if (document.getElementById('fdb-emotion-frustrated-reduce')) {
            this.config.emotionResponses.frustrated.reduceFriction = getChecked('fdb-emotion-frustrated-reduce');
        }
        if (document.getElementById('fdb-emotion-angry-escalate')) {
            this.config.emotionResponses.angry.offerEscalation = getChecked('fdb-emotion-angry-escalate');
        }
        if (document.getElementById('fdb-emotion-friendly-smalltalk')) {
            this.config.emotionResponses.friendly.allowSmallTalk = getChecked('fdb-emotion-friendly-smalltalk');
        }
        if (document.getElementById('fdb-emotion-joking-respond')) {
            this.config.emotionResponses.joking.respondInKind = getChecked('fdb-emotion-joking-respond');
        }
        if (document.getElementById('fdb-emotion-panicked-bypass')) {
            this.config.emotionResponses.panicked.bypassAllQuestions = getChecked('fdb-emotion-panicked-bypass');
        }
        if (document.getElementById('fdb-emotion-panicked-confirm')) {
            this.config.emotionResponses.panicked.confirmFirst = getChecked('fdb-emotion-panicked-confirm');
        }

        if (document.getElementById('fdb-escalation-enabled') !== null) {
            this.config.escalation = {
                ...this.config.escalation,
                enabled: getChecked('fdb-escalation-enabled'),
                maxLoopsBeforeOffer: parseInt(document.getElementById('fdb-max-loops')?.value) || 3,
                offerMessage: get('fdb-escalation-offer'),
                transferMessage: get('fdb-escalation-transfer')
            };
        }

        if (document.getElementById('fdb-loop-enabled') !== null) {
            this.config.loopPrevention = {
                enabled: getChecked('fdb-loop-enabled'),
                maxSameQuestion: parseInt(document.getElementById('fdb-max-same-q')?.value) || 2,
                onLoop: get('fdb-on-loop'),
                rephraseIntro: get('fdb-rephrase-intro')
            };
        }
        
        // Fallback responses (all 12 fields)
        if (document.getElementById('fdb-fb-discovery')) {
            this.config.fallbackResponses = {
                // Initial & Discovery
                greeting: get('fdb-fb-greeting'),
                discovery: get('fdb-fb-discovery'),
                // Booking Slots
                askName: get('fdb-fb-askName'),
                askPhone: get('fdb-fb-askPhone'),
                askAddress: get('fdb-fb-askAddress'),
                askTime: get('fdb-fb-askTime'),
                // Confirmation
                confirmBooking: get('fdb-fb-confirmBooking'),
                bookingComplete: get('fdb-fb-bookingComplete'),
                // Error Recovery
                didNotHear: get('fdb-fb-didNotHear'),
                connectionIssue: get('fdb-fb-connectionIssue'),
                clarification: get('fdb-fb-clarification'),
                // Transfer & Catch-All
                transfering: get('fdb-fb-transfering'),
                generic: get('fdb-fb-generic')
            };
        }
        
        // Mode switching
        if (document.getElementById('fdb-ms-minTurns')) {
            this.config.modeSwitching = {
                minTurnsBeforeBooking: parseInt(document.getElementById('fdb-ms-minTurns')?.value) || 2,
                bookingConfidenceThreshold: (parseInt(document.getElementById('fdb-ms-confidence')?.value) || 75) / 100,
                autoRescueOnFrustration: getChecked('fdb-ms-autoRescue'),
                autoTriageOnProblem: getChecked('fdb-ms-autoTriage')
            };
        }
    }

    async collectAndSave() {
        this.collectFormData();
        await this.save();
    }

    async resetToDefaults() {
        if (!confirm('Reset all Front Desk Behavior settings to defaults?')) return;
        
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token') || sessionStorage.getItem('token');
            const response = await fetch(`/api/admin/front-desk-behavior/${this.companyId}/reset`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) throw new Error('Reset failed');
            
            const result = await response.json();
            this.config = result.data;
            
            const container = document.querySelector('.front-desk-behavior-panel')?.parentElement;
            if (container) this.render(container);
            
            this.showNotification('✅ Reset to defaults', 'success');
        } catch (error) {
            this.showNotification('❌ Reset failed: ' + error.message, 'error');
        }
    }

    async testPhrase(container) {
        const phrase = document.getElementById('fdb-test-phrase')?.value;
        if (!phrase) {
            this.showNotification('Enter a phrase to test', 'warning');
            return;
        }

        const resultDiv = document.getElementById('fdb-test-result');
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = '<div style="color: #8b949e;">Testing...</div>';

        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token') || sessionStorage.getItem('token');
            
            if (!token) {
                resultDiv.innerHTML = `<div style="color: #f85149;">Error: Not logged in. Please refresh and login again.</div>`;
                return;
            }
            
            const response = await fetch(`/api/admin/front-desk-behavior/${this.companyId}/test-emotion`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ phrase })
            });

            const result = await response.json();
            
            if (result.success) {
                const d = result.data;
                const emojis = { neutral: '😐', friendly: '😊', joking: '😄', stressed: '😟', frustrated: '😤', angry: '😠' };
                
                resultDiv.innerHTML = `
                    <h4 style="margin: 0 0 16px 0; color: #58a6ff;">Test Results</h4>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                        <div style="padding: 12px; background: #161b22; border-radius: 6px;">
                            <div style="color: #8b949e; font-size: 0.75rem; margin-bottom: 4px;">DETECTED EMOTION</div>
                            <div style="color: #c9d1d9; font-size: 1.2rem; font-weight: 600;">
                                ${emojis[d.detectedEmotion] || '😐'} ${d.detectedEmotion.toUpperCase()}
                            </div>
                        </div>
                        
                        <div style="padding: 12px; background: #161b22; border-radius: 6px;">
                            <div style="color: #8b949e; font-size: 0.75rem; margin-bottom: 4px;">MATCHED TRIGGERS</div>
                            <div style="color: ${d.matchedFrustration.length > 0 ? '#f0883e' : '#3fb950'};">
                                ${d.matchedFrustration.length > 0 
                                    ? d.matchedFrustration.map(t => `"${t}"`).join(', ') 
                                    : 'None matched'}
                            </div>
                        </div>
                    </div>
                    
                    ${d.sampleAcknowledgment ? `
                        <div style="margin-top: 16px; padding: 12px; background: #161b22; border-radius: 6px; border-left: 3px solid #58a6ff;">
                            <div style="color: #8b949e; font-size: 0.75rem; margin-bottom: 4px;">AI WOULD SAY</div>
                            <div style="color: #c9d1d9;">"${d.sampleAcknowledgment}"</div>
                            <div style="color: #58a6ff; margin-top: 6px;">${d.followUp}</div>
                        </div>
                    ` : ''}
                    
                    <div style="margin-top: 16px; display: flex; gap: 12px;">
                        ${d.reduceFriction ? '<span style="padding: 4px 10px; background: #f0883e20; color: #f0883e; border-radius: 4px; font-size: 0.875rem;">⚡ Would reduce friction</span>' : ''}
                        ${d.offerEscalation ? '<span style="padding: 4px 10px; background: #f8514920; color: #f85149; border-radius: 4px; font-size: 0.875rem;">🆘 Would offer escalation</span>' : ''}
                    </div>
                `;
            } else {
                resultDiv.innerHTML = `<div style="color: #f85149;">Error: ${result.message}</div>`;
            }
        } catch (error) {
            resultDiv.innerHTML = `<div style="color: #f85149;">Error: ${error.message}</div>`;
        }
    }

    showNotification(message, type = 'info') {
        const colors = { success: '#238636', error: '#f85149', warning: '#f0883e', info: '#58a6ff' };
        
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed; top: 20px; right: 20px; padding: 12px 20px;
            background: ${colors[type]}; color: white; border-radius: 8px;
            font-weight: 500; z-index: 10000; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => notification.remove(), 3000);
    }
}

// Export globally
window.FrontDeskBehaviorManager = FrontDeskBehaviorManager;
console.log('[FRONT DESK BEHAVIOR] ✅ Manager loaded globally');
