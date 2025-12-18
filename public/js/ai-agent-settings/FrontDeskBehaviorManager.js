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
            
            // 👤 DEBUG: Log commonFirstNames from API
            console.log('[FRONT DESK BEHAVIOR] 👤 CHECKPOINT: commonFirstNames from API:', {
                count: (this.config.commonFirstNames || []).length,
                names: this.config.commonFirstNames || [],
                hasCommonFirstNames: !!this.config.commonFirstNames
            });
            
            // 🔍 DEBUG: Log exactly what bookingSlots came from API
            if (this.config.bookingSlots) {
                const nameSlot = this.config.bookingSlots.find(s => s.id === 'name');
                console.log('[FRONT DESK BEHAVIOR] 📥 NAME SLOT FROM API:', {
                    id: nameSlot?.id,
                    type: nameSlot?.type,
                    askFullName: nameSlot?.askFullName,
                    useFirstNameOnly: nameSlot?.useFirstNameOnly,
                    askMissingNamePart: nameSlot?.askMissingNamePart,
                    '🔴 askMissingNamePart value': nameSlot?.askMissingNamePart === true ? '✅ TRUE' : '❌ FALSE/UNDEFINED'
                });
            } else {
                console.log('[FRONT DESK BEHAVIOR] ⚠️ No bookingSlots in API response!');
            }
            
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
            conversationStyle: 'balanced', // confident | balanced | polite
            personality: {
                tone: 'warm',
                verbosity: 'concise',
                maxResponseWords: 30,
                useCallerName: true,
                agentName: ''  // No default - must be configured per company
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
                // ════════════════════════════════════════════════════════════════════
                // 🤔 TRUST CONCERN: Caller questions if AI can help (5-8 examples)
                // AI should reassure: "Absolutely! I can help with that..."
                // ════════════════════════════════════════════════════════════════════
                trustConcern: [
                    "are you a robot",
                    "are you real",
                    "is this AI",
                    "am I talking to a computer",
                    "can I speak to a person",
                    "let me talk to a human",
                    "can you actually help",
                    "do you know what you're doing"
                ],
                
                // ════════════════════════════════════════════════════════════════════
                // 😤 CALLER FEELS IGNORED: Caller says AI isn't listening (5-8 examples)
                // AI should acknowledge: "I hear you, let me make sure I understand..."
                // ════════════════════════════════════════════════════════════════════
                callerFeelsIgnored: [
                    "you're not listening",
                    "that's not what I said",
                    "I already told you",
                    "you keep asking the same thing",
                    "hello are you there",
                    "did you hear me",
                    "you're not getting it",
                    "I just said that"
                ],
                
                // ════════════════════════════════════════════════════════════════════
                // 🙅 REFUSED SLOT: Caller refuses to give info (8-12 examples)
                // AI should respect: "No problem, we can work around that..."
                // ════════════════════════════════════════════════════════════════════
                refusedSlot: [
                    "I don't want to give",
                    "why do you need that",
                    "that's private",
                    "I'd rather not say",
                    "none of your business",
                    "just send someone",
                    "skip that",
                    "I'll tell the technician",
                    "can we skip this",
                    "I'm not comfortable"
                ],
                
                // ════════════════════════════════════════════════════════════════════
                // 🔧 DESCRIBING PROBLEM: Caller describing issue (10-15 examples)
                // These are GENERIC - work for any industry. AI should listen & acknowledge.
                // ════════════════════════════════════════════════════════════════════
                describingProblem: [
                    "not working",
                    "broken",
                    "stopped working",
                    "won't turn on",
                    "won't start",
                    "making noise",
                    "making a sound",
                    "leaking",
                    "smells weird",
                    "something's wrong",
                    "having issues with",
                    "problem with",
                    "acting up",
                    "doesn't work",
                    "quit working"
                ],
                
                // ════════════════════════════════════════════════════════════════════
                // 📅 WANTS BOOKING: Caller wants to schedule (5-8 examples)
                // AI should transition to booking: "I can help with that! Let me get..."
                // ════════════════════════════════════════════════════════════════════
                wantsBooking: [
                    "schedule",
                    "appointment",
                    "send someone",
                    "come out",
                    "fix this",
                    "repair",
                    "service call",
                    "book a time",
                    "get someone here"
                ]
            },
            
            // ════════════════════════════════════════════════════════════════════
            // SIMPLIFIED: Recovery Protocol
            // Step 1: Simple fallback (FREE), Step 4: Escalation (last resort)
            // ════════════════════════════════════════════════════════════════════
            fallbackResponses: {
                // Step 1: Didn't understand - ask to repeat (FREE)
                didNotUnderstand: "I'm sorry, could you repeat that?",
                // Step 4: Escalation - transfer or callback (last resort)
                escalation: "Let me get someone who can help you better. One moment please."
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
            },
            
            // ════════════════════════════════════════════════════════════════════
            // V22: Discovery & Consent Gate (LLM-led architecture)
            // ════════════════════════════════════════════════════════════════════
            discoveryConsent: {
                // Kill switches (all ON by default for V22)
                bookingRequiresExplicitConsent: true,  // Booking ONLY after consent
                forceLLMDiscovery: true,               // LLM always speaks in discovery
                disableScenarioAutoResponses: true,    // Scenarios are context only
                // Consent question
                consentQuestionTemplate: "Would you like me to schedule an appointment for you?",
                // Yes words (after consent question)
                consentYesWords: ["yes", "yeah", "yep", "please", "sure", "okay", "ok", "correct", "sounds good"],
                // What must be captured before asking consent
                minDiscoveryFieldsBeforeConsent: ["issueSummary"]
            },
            
            // ════════════════════════════════════════════════════════════════════
            // V22: Vocabulary Guardrails (multi-tenant safety)
            // ════════════════════════════════════════════════════════════════════
            vocabularyGuardrails: {
                // Words AI CAN use (leave empty for any)
                allowedServiceNouns: [],
                // Words AI must NEVER use
                forbiddenWords: [],
                // Replacements for forbidden words
                replacementMap: {}
            }
        };
    }

    // Save config to API
    async save() {
        try {
            console.log('[FRONT DESK BEHAVIOR] Saving config...');
            // Log booking slots specifically to debug askMissingNamePart
            if (this.config.bookingSlots) {
                const nameSlot = this.config.bookingSlots.find(s => s.id === 'name');
                console.log('[FRONT DESK BEHAVIOR] 📋 NAME SLOT BEING SAVED:', {
                    id: nameSlot?.id,
                    type: nameSlot?.type,
                    askFullName: nameSlot?.askFullName,
                    useFirstNameOnly: nameSlot?.useFirstNameOnly,
                    askMissingNamePart: nameSlot?.askMissingNamePart,
                    '🔴 askMissingNamePart value': nameSlot?.askMissingNamePart === true ? '✅ TRUE' : '❌ FALSE/UNDEFINED'
                });
            }
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
                    ${this.renderTab('discovery', '🧠 Discovery & Consent')}
                    ${this.renderTab('vocabulary', '📝 Vocabulary')}
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
                
                <!-- Agent Name - Full Width -->
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                        🤖 AI Receptionist Name
                    </label>
                    <input type="text" id="fdb-agent-name" 
                        value="${p.agentName || ''}" 
                        placeholder="e.g., Sarah, Alex, Jordan (leave empty for no name)"
                        style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px;">
                    <p style="color: #8b949e; font-size: 0.75rem; margin-top: 4px;">
                        The name your AI will use when introducing itself. Example: "Hi, this is <strong>${p.agentName || '[Name]'}</strong> from [Company]"
                    </p>
                </div>
                
                <!-- Greeting Responses - Time-of-Day Specific -->
                <div style="margin-bottom: 20px; padding: 16px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px;">
                    <label style="display: block; margin-bottom: 12px; color: #c9d1d9; font-weight: 500;">
                        👋 Greeting Responses
                        <span style="background: #238636; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 8px;">0 TOKENS</span>
                    </label>
                    <p style="color: #8b949e; font-size: 0.75rem; margin-bottom: 16px;">
                        When callers say "hi", "hello", or time-based greetings - AI responds with the appropriate time-of-day greeting. <strong style="color: #3fb950;">No LLM needed!</strong>
                    </p>
                    
                    <div style="display: grid; gap: 12px;">
                        <div>
                            <label style="display: block; margin-bottom: 4px; color: #8b949e; font-size: 0.8rem;">🌅 Morning (before 12pm):</label>
                            <input type="text" id="fdb-greeting-morning" 
                                value="${this.config.conversationStages?.greetingResponses?.morning || 'Good morning! How can I help you today?'}" 
                                placeholder="Good morning! How can I help you today?"
                                style="width: 100%; padding: 8px 12px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 0.85rem;">
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 4px; color: #8b949e; font-size: 0.8rem;">☀️ Afternoon (12pm - 5pm):</label>
                            <input type="text" id="fdb-greeting-afternoon" 
                                value="${this.config.conversationStages?.greetingResponses?.afternoon || 'Good afternoon! How can I help you today?'}" 
                                placeholder="Good afternoon! How can I help you today?"
                                style="width: 100%; padding: 8px 12px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 0.85rem;">
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 4px; color: #8b949e; font-size: 0.8rem;">🌙 Evening (after 5pm):</label>
                            <input type="text" id="fdb-greeting-evening" 
                                value="${this.config.conversationStages?.greetingResponses?.evening || 'Good evening! How can I help you today?'}" 
                                placeholder="Good evening! How can I help you today?"
                                style="width: 100%; padding: 8px 12px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 0.85rem;">
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 4px; color: #8b949e; font-size: 0.8rem;">👋 Generic (for "hi", "hello"):</label>
                            <input type="text" id="fdb-greeting-generic" 
                                value="${this.config.conversationStages?.greetingResponses?.generic || 'Hi there! How can I help you today?'}" 
                                placeholder="Hi there! How can I help you today?"
                                style="width: 100%; padding: 8px 12px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 0.85rem;">
                        </div>
                    </div>
                </div>
                
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
                
                <!-- Conversation Style - Full Width Section -->
                <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid #30363d;">
                    <h4 style="margin: 0 0 8px 0; color: #58a6ff;">🎯 Conversation Style</h4>
                    <p style="color: #8b949e; margin-bottom: 16px; font-size: 0.8rem;">
                        How should the AI approach booking? This affects how decisively the AI guides callers toward scheduling.
                    </p>
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
                        <label style="display: flex; flex-direction: column; padding: 16px; background: ${(this.config.conversationStyle || 'balanced') === 'confident' ? '#238636' : '#0d1117'}; border: 2px solid ${(this.config.conversationStyle || 'balanced') === 'confident' ? '#238636' : '#30363d'}; border-radius: 8px; cursor: pointer; transition: all 0.2s;">
                            <input type="radio" name="fdb-conversation-style" value="confident" ${(this.config.conversationStyle || 'balanced') === 'confident' ? 'checked' : ''} style="display: none;">
                            <span style="font-size: 1.5rem; margin-bottom: 8px;">⭐</span>
                            <span style="font-weight: 600; color: #c9d1d9; margin-bottom: 4px;">Confident</span>
                            <span style="font-size: 0.75rem; color: #8b949e;">"Let's get you scheduled"</span>
                            <span style="font-size: 0.7rem; color: #8b949e; margin-top: 8px;">Best for: HVAC, Plumbing, Medical</span>
                        </label>
                        <label style="display: flex; flex-direction: column; padding: 16px; background: ${(this.config.conversationStyle || 'balanced') === 'balanced' ? '#238636' : '#0d1117'}; border: 2px solid ${(this.config.conversationStyle || 'balanced') === 'balanced' ? '#238636' : '#30363d'}; border-radius: 8px; cursor: pointer; transition: all 0.2s;">
                            <input type="radio" name="fdb-conversation-style" value="balanced" ${(this.config.conversationStyle || 'balanced') === 'balanced' ? 'checked' : ''} style="display: none;">
                            <span style="font-size: 1.5rem; margin-bottom: 8px;">🤝</span>
                            <span style="font-weight: 600; color: #c9d1d9; margin-bottom: 4px;">Balanced</span>
                            <span style="font-size: 0.75rem; color: #8b949e;">"I can help with that"</span>
                            <span style="font-size: 0.7rem; color: #8b949e; margin-top: 8px;">Universal default - works for all</span>
                        </label>
                        <label style="display: flex; flex-direction: column; padding: 16px; background: ${(this.config.conversationStyle || 'balanced') === 'polite' ? '#238636' : '#0d1117'}; border: 2px solid ${(this.config.conversationStyle || 'balanced') === 'polite' ? '#238636' : '#30363d'}; border-radius: 8px; cursor: pointer; transition: all 0.2s;">
                            <input type="radio" name="fdb-conversation-style" value="polite" ${(this.config.conversationStyle || 'balanced') === 'polite' ? 'checked' : ''} style="display: none;">
                            <span style="font-size: 1.5rem; margin-bottom: 8px;">🎩</span>
                            <span style="font-weight: 600; color: #c9d1d9; margin-bottom: 4px;">Polite</span>
                            <span style="font-size: 0.75rem; color: #8b949e;">"Would you like me to...?"</span>
                            <span style="font-size: 0.7rem; color: #8b949e; margin-top: 8px;">Best for: Legal, Luxury, Consulting</span>
                        </label>
                    </div>
                    
                    <!-- Style Acknowledgments - Customizable phrases -->
                    <div style="margin-top: 20px; padding: 16px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px;">
                        <h5 style="margin: 0 0 12px 0; color: #c9d1d9; font-size: 0.9rem;">
                            💬 Style Acknowledgments
                            <span style="font-weight: normal; color: #8b949e; font-size: 0.75rem; margin-left: 8px;">
                                What AI says when acknowledging a request
                            </span>
                        </h5>
                        <div style="display: grid; gap: 12px;">
                            <div>
                                <label style="display: block; margin-bottom: 4px; color: #8b949e; font-size: 0.8rem;">⭐ Confident Style:</label>
                                <input type="text" id="fdb-ack-confident" 
                                    value="${this.config.styleAcknowledgments?.confident || "Let's get this taken care of."}" 
                                    placeholder="Let's get this taken care of."
                                    style="width: 100%; padding: 8px 12px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 0.85rem;">
                            </div>
                            <div>
                                <label style="display: block; margin-bottom: 4px; color: #8b949e; font-size: 0.8rem;">🤝 Balanced Style:</label>
                                <input type="text" id="fdb-ack-balanced" 
                                    value="${this.config.styleAcknowledgments?.balanced || "I can help with that!"}" 
                                    placeholder="I can help with that!"
                                    style="width: 100%; padding: 8px 12px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 0.85rem;">
                            </div>
                            <div>
                                <label style="display: block; margin-bottom: 4px; color: #8b949e; font-size: 0.8rem;">🎩 Polite Style:</label>
                                <input type="text" id="fdb-ack-polite" 
                                    value="${this.config.styleAcknowledgments?.polite || "I'd be happy to help."}" 
                                    placeholder="I'd be happy to help."
                                    style="width: 100%; padding: 8px 12px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 0.85rem;">
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderBookingPromptsTab() {
        // Use new bookingSlots if available, otherwise migrate from legacy bookingPrompts
        const slots = this.config.bookingSlots || this.getDefaultBookingSlots();
        const templates = this.config.bookingTemplates || this.config.bookingPrompts || {};
        
        return `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div>
                        <h3 style="margin: 0; color: #58a6ff;">📋 Booking Slots</h3>
                        <p style="color: #8b949e; font-size: 0.8rem; margin: 4px 0 0 0;">Information AI collects during booking. Drag to reorder, add custom fields.</p>
                    </div>
                    <button onclick="window.frontDeskManager.addBookingSlot()" style="padding: 8px 16px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
                        + Add Slot
                    </button>
                </div>
                
                <div id="booking-slots-container" style="display: flex; flex-direction: column; gap: 8px;">
                    ${slots.map((slot, idx) => this.renderBookingSlot(slot, idx, slots.length)).join('')}
                </div>
                
                ${slots.length === 0 ? '<p style="color: #f85149; text-align: center; padding: 20px;">No booking slots configured. Click "+ Add Slot" to add one.</p>' : ''}
            </div>
            
            <!-- Templates Section -->
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="margin: 0 0 16px 0; color: #58a6ff;">💬 Booking Messages</h3>
                <p style="color: #8b949e; margin-bottom: 16px; font-size: 0.8rem;">Use {slotId} placeholders matching your slot IDs above (e.g., {name}, {phone}, {address}).</p>
                
                <div style="display: flex; flex-direction: column; gap: 16px;">
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Confirmation Template</label>
                        <textarea id="fdb-confirmTemplate" rows="2" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical;">${templates.confirmTemplate || "Let me confirm — I have {name} at {address}, {time}. Does that sound right?"}</textarea>
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Completion Message</label>
                        <textarea id="fdb-completeTemplate" rows="2" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical;">${templates.completeTemplate || "You're all set, {name}! A technician will be out {time}. You'll receive a confirmation text shortly."}</textarea>
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="fdb-offerAsap" ${templates.offerAsap !== false ? 'checked' : ''} style="accent-color: #58a6ff;">
                            <span style="color: #c9d1d9;">Offer "ASAP" option</span>
                        </label>
                        <input type="text" id="fdb-asapPhrase" value="${templates.asapPhrase || "Or I can send someone as soon as possible."}" style="flex: 1; padding: 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                    </div>
                </div>
            </div>
            
            <!-- Common First Names Section -->
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-top: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
                    <div>
                        <h3 style="margin: 0; color: #58a6ff;">👤 Common First Names</h3>
                        <p style="color: #8b949e; font-size: 0.8rem; margin: 4px 0 0 0;">
                            When a caller gives a single name like "Mark", the AI checks this list to determine if it's a first name or last name.
                            <br>If found here → asks for <strong>last name</strong>. If not found → assumes last name, asks for <strong>first name</strong>.
                        </p>
                    </div>
                    <button onclick="window.frontDeskManager.addCommonFirstName()" style="padding: 8px 16px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; white-space: nowrap;">
                        + Add Name
                    </button>
                </div>
                
                <div id="common-first-names-container" style="display: flex; flex-wrap: wrap; gap: 8px; max-height: 200px; overflow-y: auto; padding: 12px; background: #0d1117; border-radius: 6px; border: 1px solid #30363d;">
                    ${this.renderCommonFirstNameTags()}
                </div>
                
                <div style="margin-top: 12px; display: flex; gap: 8px; align-items: center;">
                    <input type="text" id="fdb-new-first-name" placeholder="Enter names (comma-separated for bulk: John, Jane, Mike)" 
                        style="flex: 1; padding: 8px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;"
                        onkeypress="if(event.key === 'Enter') window.frontDeskManager.addCommonFirstName()">
                    <button onclick="window.frontDeskManager.copyAllFirstNames()" 
                        style="padding: 8px 12px; background: #21262d; color: #8b949e; border: 1px solid #30363d; border-radius: 6px; cursor: pointer; font-size: 0.75rem; white-space: nowrap;"
                        title="Copy all names to clipboard (comma-separated)">
                        📋 Copy All
                    </button>
                    <span style="color: #8b949e; font-size: 0.75rem;">${(this.config.commonFirstNames || []).length} names</span>
                </div>
            </div>
        `;
    }
    
    renderCommonFirstNameTags() {
        const names = this.config.commonFirstNames || [];
        if (names.length === 0) {
            return '<p style="color: #8b949e; margin: 0; font-style: italic;">No names configured. Add common first names to help AI recognize "Mark" vs "Subach".</p>';
        }
        return names.map((name, idx) => `
            <span class="first-name-tag" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: #21262d; border: 1px solid #30363d; border-radius: 16px; font-size: 0.8rem; color: #c9d1d9;">
                ${name}
                <button onclick="window.frontDeskManager.removeCommonFirstName(${idx})" 
                    style="background: none; border: none; color: #f85149; cursor: pointer; padding: 0; font-size: 14px; line-height: 1;"
                    title="Remove ${name}">×</button>
            </span>
        `).join('');
    }
    
    addCommonFirstName() {
        console.log('[FRONT DESK] 👤 CHECKPOINT: addCommonFirstName called');
        const input = document.getElementById('fdb-new-first-name');
        const rawInput = input?.value?.trim();
        if (!rawInput) {
            console.log('[FRONT DESK] 👤 CHECKPOINT: No input value');
            return;
        }
        
        console.log('[FRONT DESK] 👤 CHECKPOINT: Raw input:', rawInput);
        
        if (!this.config.commonFirstNames) {
            this.config.commonFirstNames = [];
            console.log('[FRONT DESK] 👤 CHECKPOINT: Initialized empty commonFirstNames array');
        }
        
        // Support bulk insertion: split by comma, semicolon, or newline
        const namesToAdd = rawInput
            .split(/[,;\n]+/)
            .map(n => n.trim())
            .filter(n => n.length > 0);
        
        if (namesToAdd.length === 0) return;
        
        const existingLower = new Set(this.config.commonFirstNames.map(n => n.toLowerCase()));
        const added = [];
        const skipped = [];
        
        for (const name of namesToAdd) {
            const lowerName = name.toLowerCase();
            if (existingLower.has(lowerName)) {
                skipped.push(name);
            } else {
                this.config.commonFirstNames.push(name);
                existingLower.add(lowerName);
                added.push(name);
            }
        }
        
        // Sort alphabetically
        this.config.commonFirstNames.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        
        // Clear input and re-render
        input.value = '';
        this.updateCommonFirstNamesDisplay();
        this.isDirty = true;
        
        // Show feedback
        console.log('[FRONT DESK] 👤 CHECKPOINT: Names processed', { 
            added, 
            skipped, 
            totalNow: this.config.commonFirstNames.length,
            fullList: this.config.commonFirstNames
        });
        
        if (namesToAdd.length > 1) {
            const msg = `Added ${added.length} name(s)` + (skipped.length > 0 ? `, skipped ${skipped.length} duplicate(s)` : '');
            console.log('[FRONT DESK] Bulk name insert:', { added, skipped });
        }
        
        // Brief visual feedback
        const container = document.getElementById('common-first-names-container');
        if (container) {
            container.style.borderColor = '#238636';
            setTimeout(() => { container.style.borderColor = '#30363d'; }, 1000);
        }
    }
    
    removeCommonFirstName(index) {
        if (!this.config.commonFirstNames) return;
        this.config.commonFirstNames.splice(index, 1);
        this.updateCommonFirstNamesDisplay();
        this.isDirty = true;
    }
    
    copyAllFirstNames() {
        const names = this.config.commonFirstNames || [];
        if (names.length === 0) {
            alert('No names to copy.');
            return;
        }
        
        // Copy as comma-separated list (easy to paste into AI or compare)
        const text = names.join(', ');
        
        navigator.clipboard.writeText(text).then(() => {
            console.log('[FRONT DESK] 👤 Copied all names to clipboard:', names.length);
            
            // Visual feedback on button
            const btn = document.querySelector('button[onclick*="copyAllFirstNames"]');
            if (btn) {
                const originalText = btn.innerHTML;
                btn.innerHTML = '✅ Copied!';
                btn.style.background = '#238636';
                btn.style.color = 'white';
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.style.background = '#21262d';
                    btn.style.color = '#8b949e';
                }, 2000);
            }
        }).catch(err => {
            console.error('[FRONT DESK] Copy failed:', err);
            // Fallback: show in alert for manual copy
            prompt('Copy these names:', text);
        });
    }
    
    updateCommonFirstNamesDisplay() {
        const container = document.getElementById('common-first-names-container');
        if (container) {
            container.innerHTML = this.renderCommonFirstNameTags();
        }
        // Update count
        const countEl = document.querySelector('#fdb-new-first-name')?.parentElement?.querySelector('span');
        if (countEl) {
            countEl.textContent = `${(this.config.commonFirstNames || []).length} names`;
        }
    }
    
    renderBookingSlot(slot, index, totalSlots) {
        const isFirst = index === 0;
        const isLast = index === totalSlots - 1;
        
        // Extended type options with descriptions
        const typeOptions = [
            { value: 'name', label: '👤 Name', desc: 'Customer name with smart options' },
            { value: 'phone', label: '📞 Phone', desc: 'Phone number with caller ID options' },
            { value: 'address', label: '📍 Address', desc: 'Service/mailing address' },
            { value: 'email', label: '📧 Email', desc: 'Email address' },
            { value: 'date', label: '📅 Date', desc: 'Date picker' },
            { value: 'time', label: '🕐 Time', desc: 'Preferred time slot' },
            { value: 'datetime', label: '📆 Date & Time', desc: 'Combined date and time' },
            { value: 'select', label: '📋 Choice List', desc: 'Select from options you define' },
            { value: 'yesno', label: '✅ Yes/No', desc: 'Simple yes or no question' },
            { value: 'number', label: '🔢 Number', desc: 'Numeric value' },
            { value: 'text', label: '📝 Text', desc: 'Free-form text input' },
            { value: 'textarea', label: '📄 Long Text', desc: 'Multi-line description' },
            { value: 'custom', label: '⚙️ Custom', desc: 'Custom field type' }
        ];
        
        const defaultConfirmPrompts = {
            name: "Got it, {value}. Did I get that right?",
            phone: "Just to confirm, that's {value}, correct?",
            address: "So that's {value}, right?",
            email: "I have {value} as your email. Is that correct?",
            date: "So that's {value}?",
            time: "So {value} works for you?",
            datetime: "So {value}?",
            select: "You selected {value}, correct?",
            yesno: "Just to confirm, {value}?",
            number: "That's {value}?",
            text: "Just to confirm, {value}?",
            textarea: "Got it, thank you for those details.",
            custom: "Just to confirm, {value}?"
        };
        const confirmPrompt = slot.confirmPrompt || defaultConfirmPrompts[slot.type] || defaultConfirmPrompts.text;
        
        // Determine which type-specific options to show
        const isNameType = slot.type === 'name' || slot.id === 'name';
        const isPhoneType = slot.type === 'phone' || slot.id === 'phone';
        const isAddressType = slot.type === 'address' || slot.id === 'address';
        const isSelectType = slot.type === 'select';
        const isDateTimeType = ['date', 'time', 'datetime'].includes(slot.type);
        const isNumberType = slot.type === 'number';
        
        return `
            <div class="booking-slot" data-slot-index="${index}" data-slot-type="${slot.type}" style="background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 16px;">
                <div style="display: flex; align-items: flex-start; gap: 12px;">
                    <!-- Reorder Buttons -->
                    <div style="display: flex; flex-direction: column; gap: 4px; padding-top: 4px;">
                        <button onclick="window.frontDeskManager.moveSlot(${index}, -1)" ${isFirst ? 'disabled' : ''} 
                            style="width: 28px; height: 24px; background: ${isFirst ? '#21262d' : '#30363d'}; border: none; border-radius: 4px; color: ${isFirst ? '#484f58' : '#c9d1d9'}; cursor: ${isFirst ? 'not-allowed' : 'pointer'}; font-size: 14px;"
                            title="Move up">▲</button>
                        <button onclick="window.frontDeskManager.moveSlot(${index}, 1)" ${isLast ? 'disabled' : ''} 
                            style="width: 28px; height: 24px; background: ${isLast ? '#21262d' : '#30363d'}; border: none; border-radius: 4px; color: ${isLast ? '#484f58' : '#c9d1d9'}; cursor: ${isLast ? 'not-allowed' : 'pointer'}; font-size: 14px;"
                            title="Move down">▼</button>
                    </div>
                    
                    <!-- Slot Content -->
                    <div style="flex: 1; display: flex; flex-direction: column; gap: 10px;">
                        <!-- Row 1: Label, ID, Type -->
                        <div style="display: flex; gap: 12px; align-items: flex-end;">
                            <div style="flex: 2;">
                                <label style="display: block; font-size: 11px; color: #8b949e; margin-bottom: 4px;">Label (what admin sees)</label>
                                <input type="text" class="slot-label" data-index="${index}" value="${slot.label || ''}" placeholder="e.g. Full Name" 
                                    style="width: 100%; padding: 8px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9;">
                            </div>
                            <div style="flex: 1;">
                                <label style="display: block; font-size: 11px; color: #8b949e; margin-bottom: 4px;">Slot ID (code reference)</label>
                                <input type="text" class="slot-id" data-index="${index}" value="${slot.id || ''}" placeholder="e.g. name" 
                                    style="width: 100%; padding: 8px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-family: monospace; font-size: 12px;">
                            </div>
                            <div style="flex: 1.5;">
                                <label style="display: block; font-size: 11px; color: #8b949e; margin-bottom: 4px;">Type</label>
                                <select class="slot-type" data-index="${index}" onchange="window.frontDeskManager.onSlotTypeChange(${index}, this.value)"
                                    style="width: 100%; padding: 8px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9;">
                                    ${typeOptions.map(t => `<option value="${t.value}" ${slot.type === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        
                        <!-- Row 2: Question -->
                        <div>
                            <label style="display: block; font-size: 11px; color: #8b949e; margin-bottom: 4px;">🎙️ Question AI Asks (exact wording)</label>
                            <input type="text" class="slot-question" data-index="${index}" value="${slot.question || ''}" placeholder="May I have your full name?" 
                                style="width: 100%; padding: 10px 12px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 14px;">
                        </div>
                        
                        <!-- Row 3: Confirm Back -->
                        <div style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: #161b22; border-radius: 4px; border: 1px solid ${slot.confirmBack ? '#238636' : '#30363d'};">
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap;" title="Repeat value back for confirmation">
                                <input type="checkbox" class="slot-confirmBack" data-index="${index}" ${slot.confirmBack ? 'checked' : ''} 
                                    style="accent-color: #238636;" onchange="window.frontDeskManager.toggleConfirmPrompt(${index}, this.checked)">
                                <span style="font-size: 12px; color: ${slot.confirmBack ? '#3fb950' : '#8b949e'};">🔄 Confirm Back</span>
                            </label>
                            <input type="text" class="slot-confirmPrompt" data-index="${index}" value="${confirmPrompt}" 
                                placeholder="Just to confirm, that's {value}, correct?"
                                style="flex: 1; padding: 6px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; ${slot.confirmBack ? '' : 'opacity: 0.5;'}"
                                ${slot.confirmBack ? '' : 'disabled'}>
                        </div>
                        
                        <!-- Type-Specific Options Container -->
                        <div class="slot-type-options" data-index="${index}">
                            ${this.renderSlotTypeOptions(slot, index)}
                        </div>
                        
                        <!-- Advanced Options (collapsible) -->
                        <details style="background: #161b22; border-radius: 4px; border: 1px solid #30363d;">
                            <summary style="padding: 8px 12px; cursor: pointer; font-size: 12px; color: #8b949e; user-select: none;">
                                ⚙️ Advanced Options
                            </summary>
                            <div style="padding: 12px; display: flex; flex-direction: column; gap: 10px; border-top: 1px solid #30363d;">
                                <!-- Validation Pattern -->
                                <div>
                                    <label style="display: block; font-size: 11px; color: #8b949e; margin-bottom: 4px;">Validation Pattern (regex, optional)</label>
                                    <input type="text" class="slot-validation" data-index="${index}" value="${slot.validation || ''}" 
                                        placeholder="e.g. ^[a-zA-Z ]+$ for text only"
                                        style="width: 100%; padding: 6px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-family: monospace; font-size: 11px;">
                                </div>
                                
                                <!-- Skip If Known -->
                                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                    <input type="checkbox" class="slot-skipIfKnown" data-index="${index}" ${slot.skipIfKnown ? 'checked' : ''} style="accent-color: #58a6ff;">
                                    <span style="font-size: 12px; color: #c9d1d9;">Skip if already known (returning customer)</span>
                                </label>
                                
                                <!-- Help Text -->
                                <div>
                                    <label style="display: block; font-size: 11px; color: #8b949e; margin-bottom: 4px;">AI Helper Note (internal, not spoken)</label>
                                    <input type="text" class="slot-helperNote" data-index="${index}" value="${slot.helperNote || ''}" 
                                        placeholder="e.g. Accept partial address if caller is unsure"
                                        style="width: 100%; padding: 6px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px;">
                                </div>
                            </div>
                        </details>
                    </div>
                    
                    <!-- Required Toggle & Delete -->
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; padding-top: 16px;">
                        <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;" title="Required field">
                            <input type="checkbox" class="slot-required" data-index="${index}" ${slot.required !== false ? 'checked' : ''} style="accent-color: #f85149;">
                            <span style="font-size: 11px; color: ${slot.required !== false ? '#f85149' : '#8b949e'};">Req</span>
                        </label>
                        <button onclick="window.frontDeskManager.removeSlot(${index})" 
                            style="width: 28px; height: 28px; background: #21262d; border: 1px solid #f8514950; border-radius: 4px; color: #f85149; cursor: pointer; font-size: 14px;"
                            title="Delete slot">🗑</button>
                    </div>
                </div>
            </div>
        `;
    }
    
    // Render type-specific options based on slot type
    renderSlotTypeOptions(slot, index) {
        const type = slot.type || 'text';
        
        // Name type options
        if (type === 'name' || slot.id === 'name') {
            return `
                <div style="display: flex; align-items: center; gap: 16px; padding: 10px 12px; background: #1a2233; border-radius: 4px; border: 1px solid #58a6ff40; flex-wrap: wrap;">
                    <span style="font-size: 11px; color: #58a6ff; font-weight: 600;">👤 Name Options:</span>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;" title="Ask for first AND last name">
                        <input type="checkbox" class="slot-askFullName" data-index="${index}" ${slot.askFullName !== false ? 'checked' : ''} style="accent-color: #58a6ff;">
                        <span style="font-size: 12px; color: #c9d1d9;">Ask full name</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;" title="When referring to caller later, use first name only">
                        <input type="checkbox" class="slot-useFirstNameOnly" data-index="${index}" ${slot.useFirstNameOnly !== false ? 'checked' : ''} style="accent-color: #58a6ff;">
                        <span style="font-size: 12px; color: #c9d1d9;">Call by first name</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;" title="If caller gives only first or last name, politely ask once for the other part">
                        <input type="checkbox" class="slot-askMissingNamePart" data-index="${index}" ${slot.askMissingNamePart ? 'checked' : ''} style="accent-color: #58a6ff;">
                        <span style="font-size: 12px; color: #c9d1d9;">Ask once for missing part</span>
                    </label>
                </div>
            `;
        }
        
        // Phone type options
        if (type === 'phone' || slot.id === 'phone') {
            return `
                <div style="display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; background: #1a2233; border-radius: 4px; border: 1px solid ${slot.offerCallerId !== false ? '#238636' : '#58a6ff40'};">
                    <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                        <span style="font-size: 11px; color: #58a6ff; font-weight: 600;">📞 Phone Options:</span>
                        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;" title="Offer to use the number they're calling from">
                            <input type="checkbox" class="slot-offerCallerId" data-index="${index}" ${slot.offerCallerId !== false ? 'checked' : ''} 
                                style="accent-color: #238636;" onchange="window.frontDeskManager.toggleCallerIdPrompt(${index}, this.checked)">
                            <span style="font-size: 12px; color: ${slot.offerCallerId !== false ? '#3fb950' : '#c9d1d9'};">Offer to use caller ID</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;" title="Accept 'text me' as confirmation they can receive SMS">
                            <input type="checkbox" class="slot-acceptTextMe" data-index="${index}" ${slot.acceptTextMe !== false ? 'checked' : ''} style="accent-color: #58a6ff;">
                            <span style="font-size: 12px; color: #c9d1d9;">Accept "text me" response</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;" title="If AI doesn't understand, ask area code first then rest of number">
                            <input type="checkbox" class="slot-breakDownIfUnclear" data-index="${index}" ${slot.breakDownIfUnclear ? 'checked' : ''} style="accent-color: #f0883e;">
                            <span style="font-size: 12px; color: #c9d1d9;">Break down if unclear (area code → number)</span>
                        </label>
                    </div>
                    <input type="text" class="slot-callerIdPrompt" data-index="${index}" 
                        value="${slot.callerIdPrompt || "I see you're calling from {callerId} - is that a good number for text confirmations, or would you prefer a different one?"}" 
                        placeholder="I see you're calling from {callerId} - is that good for texts?"
                        style="width: 100%; padding: 6px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; ${slot.offerCallerId !== false ? '' : 'opacity: 0.5;'}"
                        ${slot.offerCallerId !== false ? '' : 'disabled'}>
                </div>
            `;
        }
        
        // Address type options
        if (type === 'address' || slot.id === 'address') {
            return `
                <div style="display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; background: #1a2233; border-radius: 4px; border: 1px solid #58a6ff40;">
                    <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                        <span style="font-size: 11px; color: #58a6ff; font-weight: 600;">📍 Address Options:</span>
                        <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: #8b949e;">
                            Confirm back:
                            <select class="slot-addressConfirmLevel" data-index="${index}" style="padding: 4px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px;">
                                <option value="street_only" ${slot.addressConfirmLevel === 'street_only' ? 'selected' : ''}>Street only</option>
                                <option value="street_city" ${(slot.addressConfirmLevel === 'street_city' || !slot.addressConfirmLevel) ? 'selected' : ''}>Street + City</option>
                                <option value="full" ${slot.addressConfirmLevel === 'full' ? 'selected' : ''}>Full address</option>
                            </select>
                        </label>
                    </div>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="checkbox" class="slot-acceptPartialAddress" data-index="${index}" ${slot.acceptPartialAddress ? 'checked' : ''} style="accent-color: #58a6ff;">
                        <span style="font-size: 12px; color: #c9d1d9;">Accept partial address if caller unsure (e.g. "somewhere on Main St")</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;" title="If AI doesn't understand, ask street → city → zip step by step">
                        <input type="checkbox" class="slot-breakDownIfUnclear" data-index="${index}" ${slot.breakDownIfUnclear ? 'checked' : ''} style="accent-color: #f0883e;">
                        <span style="font-size: 12px; color: #c9d1d9;">Break down if unclear (street → city → zip)</span>
                    </label>
                </div>
            `;
        }
        
        // Email type options
        if (type === 'email') {
            return `
                <div style="display: flex; align-items: center; gap: 16px; padding: 10px 12px; background: #1a2233; border-radius: 4px; border: 1px solid #58a6ff40; flex-wrap: wrap;">
                    <span style="font-size: 11px; color: #58a6ff; font-weight: 600;">📧 Email Options:</span>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="checkbox" class="slot-spellOutEmail" data-index="${index}" ${slot.spellOutEmail !== false ? 'checked' : ''} style="accent-color: #58a6ff;">
                        <span style="font-size: 12px; color: #c9d1d9;">AI spells back email for confirmation</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="checkbox" class="slot-offerToSendText" data-index="${index}" ${slot.offerToSendText ? 'checked' : ''} style="accent-color: #58a6ff;">
                        <span style="font-size: 12px; color: #c9d1d9;">Offer "I can text you to confirm the spelling"</span>
                    </label>
                </div>
            `;
        }
        
        // Date/Time type options
        if (['date', 'time', 'datetime'].includes(type)) {
            return `
                <div style="display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; background: #1a2233; border-radius: 4px; border: 1px solid #58a6ff40;">
                    <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                        <span style="font-size: 11px; color: #58a6ff; font-weight: 600;">🕐 Scheduling Options:</span>
                        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                            <input type="checkbox" class="slot-offerAsap" data-index="${index}" ${slot.offerAsap !== false ? 'checked' : ''} style="accent-color: #238636;">
                            <span style="font-size: 12px; color: #c9d1d9;">Offer "as soon as possible"</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                            <input type="checkbox" class="slot-offerMorningAfternoon" data-index="${index}" ${slot.offerMorningAfternoon ? 'checked' : ''} style="accent-color: #58a6ff;">
                            <span style="font-size: 12px; color: #c9d1d9;">Accept "morning" or "afternoon"</span>
                        </label>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <label style="font-size: 12px; color: #8b949e;">ASAP phrase:</label>
                        <input type="text" class="slot-asapPhrase" data-index="${index}" value="${slot.asapPhrase || 'first available'}" 
                            style="flex: 1; padding: 4px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px;">
                    </div>
                </div>
            `;
        }
        
        // Select/Choice type options
        if (type === 'select') {
            const options = slot.selectOptions || [];
            return `
                <div style="display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; background: #1a2233; border-radius: 4px; border: 1px solid #58a6ff40;">
                    <span style="font-size: 11px; color: #58a6ff; font-weight: 600;">📋 Choice Options (one per line):</span>
                    <textarea class="slot-selectOptions" data-index="${index}" rows="4" 
                        placeholder="Option 1\nOption 2\nOption 3"
                        style="width: 100%; padding: 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; resize: vertical;">${options.join('\n')}</textarea>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="checkbox" class="slot-allowOther" data-index="${index}" ${slot.allowOther ? 'checked' : ''} style="accent-color: #58a6ff;">
                        <span style="font-size: 12px; color: #c9d1d9;">Allow "Other" option (AI will ask to specify)</span>
                    </label>
                </div>
            `;
        }
        
        // Yes/No type options
        if (type === 'yesno') {
            return `
                <div style="display: flex; align-items: center; gap: 16px; padding: 10px 12px; background: #1a2233; border-radius: 4px; border: 1px solid #58a6ff40; flex-wrap: wrap;">
                    <span style="font-size: 11px; color: #58a6ff; font-weight: 600;">✅ Yes/No Options:</span>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <label style="font-size: 12px; color: #8b949e;">If Yes:</label>
                        <input type="text" class="slot-yesAction" data-index="${index}" value="${slot.yesAction || ''}" 
                            placeholder="continue to next slot"
                            style="width: 150px; padding: 4px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px;">
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <label style="font-size: 12px; color: #8b949e;">If No:</label>
                        <input type="text" class="slot-noAction" data-index="${index}" value="${slot.noAction || ''}" 
                            placeholder="skip to slot X"
                            style="width: 150px; padding: 4px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px;">
                    </div>
                </div>
            `;
        }
        
        // Number type options
        if (type === 'number') {
            return `
                <div style="display: flex; align-items: center; gap: 16px; padding: 10px 12px; background: #1a2233; border-radius: 4px; border: 1px solid #58a6ff40; flex-wrap: wrap;">
                    <span style="font-size: 11px; color: #58a6ff; font-weight: 600;">🔢 Number Options:</span>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <label style="font-size: 12px; color: #8b949e;">Min:</label>
                        <input type="number" class="slot-minValue" data-index="${index}" value="${slot.minValue || ''}" 
                            style="width: 60px; padding: 4px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px;">
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <label style="font-size: 12px; color: #8b949e;">Max:</label>
                        <input type="number" class="slot-maxValue" data-index="${index}" value="${slot.maxValue || ''}" 
                            style="width: 60px; padding: 4px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px;">
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <label style="font-size: 12px; color: #8b949e;">Unit:</label>
                        <input type="text" class="slot-unit" data-index="${index}" value="${slot.unit || ''}" 
                            placeholder="e.g. years, units"
                            style="width: 80px; padding: 4px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px;">
                    </div>
                </div>
            `;
        }
        
        // Default - no special options
        return '';
    }
    
    // Handle slot type change - re-render type-specific options
    onSlotTypeChange(index, newType) {
        const slot = this.collectBookingSlots()[index];
        if (!slot) return;
        
        slot.type = newType;
        
        // Update the type options container
        const optionsContainer = document.querySelector(`.slot-type-options[data-index="${index}"]`);
        if (optionsContainer) {
            optionsContainer.innerHTML = this.renderSlotTypeOptions(slot, index);
        }
        
        // Update the slot container's data attribute
        const slotContainer = document.querySelector(`.booking-slot[data-slot-index="${index}"]`);
        if (slotContainer) {
            slotContainer.setAttribute('data-slot-type', newType);
        }
    }
    
    toggleConfirmPrompt(index, enabled) {
        const promptInput = document.querySelector(`.slot-confirmPrompt[data-index="${index}"]`);
        const container = promptInput?.parentElement;
        if (promptInput) {
            promptInput.disabled = !enabled;
            promptInput.style.opacity = enabled ? '1' : '0.5';
        }
        if (container) {
            container.style.borderColor = enabled ? '#238636' : '#30363d';
            const label = container.querySelector('span');
            if (label) label.style.color = enabled ? '#3fb950' : '#8b949e';
        }
    }
    
    toggleCallerIdPrompt(index, enabled) {
        const promptInput = document.querySelector(`.slot-callerIdPrompt[data-index="${index}"]`);
        const container = promptInput?.parentElement;
        if (promptInput) {
            promptInput.disabled = !enabled;
            promptInput.style.opacity = enabled ? '1' : '0.5';
        }
        if (container) {
            container.style.borderColor = enabled ? '#238636' : '#30363d';
            const label = container.querySelector('span:last-of-type');
            if (label) label.style.color = enabled ? '#3fb950' : '#c9d1d9';
        }
    }
    
    getDefaultBookingSlots() {
        // ════════════════════════════════════════════════════════════════
        // UI DEFAULTS for new/unconfigured companies
        // These are ONLY shown in UI before first save - then database is used
        // ════════════════════════════════════════════════════════════════
        const bp = this.config.bookingPrompts || {};
        return [
            { 
                id: 'name', 
                label: 'Full Name', 
                question: bp.askName || "May I have your name please?", 
                required: true, 
                order: 0, 
                type: 'name',  // Use the new 'name' type
                confirmBack: false, 
                confirmPrompt: "Got it, {value}. Did I get that right?", 
                askFullName: true, 
                useFirstNameOnly: true, 
                askMissingNamePart: false 
            },
            { 
                id: 'phone', 
                label: 'Phone Number', 
                question: bp.askPhone || "What is the best phone number to reach you?", 
                required: true, 
                order: 1, 
                type: 'phone', 
                confirmBack: true, 
                confirmPrompt: "Just to confirm, that's {value}, correct?", 
                offerCallerId: true, 
                acceptTextMe: true,
                callerIdPrompt: "I see you're calling from {callerId} - is that a good number for text confirmations, or would you prefer a different one?" 
            },
            { 
                id: 'address', 
                label: 'Service Address', 
                question: bp.askAddress || "What is the service address?", 
                required: true, 
                order: 2, 
                type: 'address', 
                confirmBack: false, 
                confirmPrompt: "So that's {value}, right?", 
                addressConfirmLevel: 'street_city',
                acceptPartialAddress: false
            },
            { 
                id: 'time', 
                label: 'Preferred Time', 
                question: bp.askTime || "When works best for you?", 
                required: false, 
                order: 3, 
                type: 'time', 
                confirmBack: false, 
                confirmPrompt: "So {value} works for you?",
                offerAsap: true,
                offerMorningAfternoon: true,
                asapPhrase: "first available"
            }
        ];
    }
    
    addBookingSlot() {
        const slots = this.collectBookingSlots();
        const newId = `custom_${Date.now()}`;
        slots.push({
            id: newId,
            label: 'New Field',
            question: '',
            required: false,
            order: slots.length,
            type: 'text',  // Start with text, user can change to any type
            confirmBack: false,
            confirmPrompt: "Just to confirm, {value}?"
        });
        
        // Update config and re-render
        this.config.bookingSlots = slots;
        document.getElementById('booking-slots-container').innerHTML = 
            slots.map((slot, idx) => this.renderBookingSlot(slot, idx, slots.length)).join('');
        
        // Focus the new slot's label input
        setTimeout(() => {
            const inputs = document.querySelectorAll('.slot-label');
            if (inputs.length > 0) {
                inputs[inputs.length - 1].focus();
                inputs[inputs.length - 1].select();
            }
        }, 100);
    }
    
    removeSlot(index) {
        const slots = this.collectBookingSlots();
        if (slots.length <= 1) {
            alert('You must have at least one booking slot.');
            return;
        }
        
        const slot = slots[index];
        if (!confirm(`Delete "${slot.label}" slot?`)) return;
        
        slots.splice(index, 1);
        // Re-index order
        slots.forEach((s, i) => s.order = i);
        
        this.config.bookingSlots = slots;
        document.getElementById('booking-slots-container').innerHTML = 
            slots.map((slot, idx) => this.renderBookingSlot(slot, idx, slots.length)).join('');
    }
    
    moveSlot(index, direction) {
        const slots = this.collectBookingSlots();
        const newIndex = index + direction;
        
        if (newIndex < 0 || newIndex >= slots.length) return;
        
        // Swap slots
        [slots[index], slots[newIndex]] = [slots[newIndex], slots[index]];
        
        // Update order values
        slots.forEach((s, i) => s.order = i);
        
        this.config.bookingSlots = slots;
        document.getElementById('booking-slots-container').innerHTML = 
            slots.map((slot, idx) => this.renderBookingSlot(slot, idx, slots.length)).join('');
    }
    
    collectBookingSlots() {
        const slots = [];
        const slotElements = document.querySelectorAll('.booking-slot');
        
        slotElements.forEach((el, index) => {
            // Helper function to safely get element value
            const getVal = (selector) => el.querySelector(selector)?.value?.trim() || '';
            const getChecked = (selector) => el.querySelector(selector)?.checked ?? false;
            const getCheckedDefault = (selector, defaultVal) => {
                const elem = el.querySelector(selector);
                return elem ? elem.checked : defaultVal;
            };
            
            const slotData = {
                // Basic fields
                id: getVal('.slot-id') || `slot_${index}`,
                label: getVal('.slot-label') || 'Unnamed',
                question: getVal('.slot-question') || '',
                required: getCheckedDefault('.slot-required', true),
                order: index,
                type: el.querySelector('.slot-type')?.value || 'text',
                confirmBack: getChecked('.slot-confirmBack'),
                confirmPrompt: getVal('.slot-confirmPrompt') || "Just to confirm, that's {value}, correct?",
                
                // Advanced options (all types)
                validation: getVal('.slot-validation') || null,
                skipIfKnown: getChecked('.slot-skipIfKnown'),
                helperNote: getVal('.slot-helperNote') || null
            };
            
            // ═══════════════════════════════════════════════════════════════
            // TYPE-SPECIFIC OPTIONS
            // ═══════════════════════════════════════════════════════════════
            
            // NAME options
            if (el.querySelector('.slot-askFullName')) {
                slotData.askFullName = getCheckedDefault('.slot-askFullName', true);
            }
            if (el.querySelector('.slot-useFirstNameOnly')) {
                slotData.useFirstNameOnly = getCheckedDefault('.slot-useFirstNameOnly', true);
            }
            if (el.querySelector('.slot-askMissingNamePart')) {
                slotData.askMissingNamePart = getChecked('.slot-askMissingNamePart');
            }
            
            // PHONE options
            if (el.querySelector('.slot-offerCallerId')) {
                slotData.offerCallerId = getCheckedDefault('.slot-offerCallerId', true);
            }
            if (el.querySelector('.slot-callerIdPrompt')) {
                slotData.callerIdPrompt = getVal('.slot-callerIdPrompt') || "I see you're calling from {callerId} - is that a good number for text confirmations, or would you prefer a different one?";
            }
            if (el.querySelector('.slot-acceptTextMe')) {
                slotData.acceptTextMe = getCheckedDefault('.slot-acceptTextMe', true);
            }
            
            // BREAK DOWN IF UNCLEAR (works for phone AND address)
            if (el.querySelector('.slot-breakDownIfUnclear')) {
                slotData.breakDownIfUnclear = getChecked('.slot-breakDownIfUnclear');
            }
            
            // ADDRESS options
            if (el.querySelector('.slot-addressConfirmLevel')) {
                slotData.addressConfirmLevel = el.querySelector('.slot-addressConfirmLevel')?.value || 'street_city';
            }
            if (el.querySelector('.slot-acceptPartialAddress')) {
                slotData.acceptPartialAddress = getChecked('.slot-acceptPartialAddress');
            }
            
            // EMAIL options
            if (el.querySelector('.slot-spellOutEmail')) {
                slotData.spellOutEmail = getCheckedDefault('.slot-spellOutEmail', true);
            }
            if (el.querySelector('.slot-offerToSendText')) {
                slotData.offerToSendText = getChecked('.slot-offerToSendText');
            }
            
            // DATE/TIME options
            if (el.querySelector('.slot-offerAsap')) {
                slotData.offerAsap = getCheckedDefault('.slot-offerAsap', true);
            }
            if (el.querySelector('.slot-offerMorningAfternoon')) {
                slotData.offerMorningAfternoon = getChecked('.slot-offerMorningAfternoon');
            }
            if (el.querySelector('.slot-asapPhrase')) {
                slotData.asapPhrase = getVal('.slot-asapPhrase') || 'first available';
            }
            
            // SELECT options
            if (el.querySelector('.slot-selectOptions')) {
                const optionsText = getVal('.slot-selectOptions');
                slotData.selectOptions = optionsText ? optionsText.split('\n').map(o => o.trim()).filter(o => o) : [];
            }
            if (el.querySelector('.slot-allowOther')) {
                slotData.allowOther = getChecked('.slot-allowOther');
            }
            
            // YES/NO options
            if (el.querySelector('.slot-yesAction')) {
                slotData.yesAction = getVal('.slot-yesAction') || null;
            }
            if (el.querySelector('.slot-noAction')) {
                slotData.noAction = getVal('.slot-noAction') || null;
            }
            
            // NUMBER options
            if (el.querySelector('.slot-minValue')) {
                const minVal = el.querySelector('.slot-minValue')?.value;
                slotData.minValue = minVal !== '' ? parseFloat(minVal) : null;
            }
            if (el.querySelector('.slot-maxValue')) {
                const maxVal = el.querySelector('.slot-maxValue')?.value;
                slotData.maxValue = maxVal !== '' ? parseFloat(maxVal) : null;
            }
            if (el.querySelector('.slot-unit')) {
                slotData.unit = getVal('.slot-unit') || null;
            }
            
            slots.push(slotData);
        });
        
        return slots.length > 0 ? slots : this.getDefaultBookingSlots();
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
        // Get defaults for pre-population
        const defaults = this.getDefaultConfig().detectionTriggers;
        
        // Ensure detectionTriggers exists
        if (!this.config.detectionTriggers) this.config.detectionTriggers = {};
        const dt = this.config.detectionTriggers;
        
        // Pre-populate with defaults if arrays are empty (for existing companies)
        const categories = ['trustConcern', 'callerFeelsIgnored', 'refusedSlot', 'describingProblem', 'wantsBooking'];
        categories.forEach(key => {
            if (!dt[key] || dt[key].length === 0) {
                dt[key] = defaults[key] || [];
            }
        });
        
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
    // TIERED FALLBACK: Honesty-First Recovery Protocol
    // - NEVER pretend to understand when you don't
    // - NEVER say "Got it" if you didn't get it
    // - Blame the connection, not the caller
    // ════════════════════════════════════════════════════════════════════
    renderFallbacksTab() {
        const fb = this.config.fallbackResponses || {};
        const companyName = this.companyName || 'our company';
        const defaults = {
            greeting: `Thanks for calling ${companyName}! How can I help you today?`,
            didNotUnderstandTier1: "I'm sorry, the connection was a little rough and I didn't catch that. Can you please say that one more time?",
            didNotUnderstandTier2: "I'm still having trouble hearing you clearly. Could you repeat that a bit slower for me?",
            didNotUnderstandTier3: "It sounds like this connection isn't great. Do you want me to have someone from the office call or text you back to help you?"
        };
        
        return `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="margin: 0 0 8px 0; color: #f0883e;">🔄 Tiered Fallback Protocol</h3>
                <p style="color: #8b949e; margin-bottom: 16px; font-size: 0.875rem;">
                    When AI doesn't understand, be <strong>HONEST</strong> about it. Never fake understanding.
                </p>
                
                <!-- HONESTY RULES BOX -->
                <div style="background: #1c1917; border: 2px solid #dc2626; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                    <div style="font-size: 13px; color: #fca5a5; font-weight: 600; margin-bottom: 8px;">🚨 HONESTY RULES (AI follows these)</div>
                    <ul style="color: #d6d3d1; font-size: 12px; margin: 0; padding-left: 20px; line-height: 1.8;">
                        <li>NEVER say "Got it" or "Okay" if you didn't actually understand</li>
                        <li>NEVER guess the problem or list possible issues</li>
                        <li>Blame the <strong>connection</strong>, not the caller</li>
                        <li>When using fallback, ONLY ask to repeat or offer callback</li>
                    </ul>
                </div>
                
                <!-- Protocol Flow Diagram -->
                <div style="background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                    <div style="font-size: 12px; color: #8b949e; font-family: monospace; line-height: 1.8;">
                        <div style="color: #58a6ff; margin-bottom: 8px;">📞 CALL HANDLING FLOW:</div>
                        <div style="margin-left: 16px;">
                            <div>✅ Understood → AI responds normally</div>
                            <div style="margin-top: 4px; color: #3fb950;">❓ 1st miss → <strong>Tier 1</strong>: Apologize + ask to repeat</div>
                            <div style="margin-top: 4px; color: #fbbf24;">❓ 2nd miss → <strong>Tier 2</strong>: Still patient + ask slower</div>
                            <div style="margin-top: 4px; color: #f87171;">❓ 3rd miss → <strong>Tier 3</strong>: Offer callback bailout</div>
                        </div>
                    </div>
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 20px;">
                    
                    <!-- Tier 1: First Miss -->
                    <div style="background: #0d2818; border: 1px solid #238636; border-radius: 8px; padding: 16px;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                            <span style="background: #238636; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">TIER 1</span>
                            <span style="color: #3fb950; font-weight: 600;">First Miss</span>
                            <span style="color: #8b949e; font-size: 12px;">(soft, apologetic)</span>
                        </div>
                        <input type="text" id="fdb-fb-tier1" value="${fb.didNotUnderstandTier1 || defaults.didNotUnderstandTier1}" 
                            placeholder="${defaults.didNotUnderstandTier1}"
                            style="width: 100%; padding: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px;">
                        <p style="color: #8b949e; font-size: 11px; margin: 8px 0 0 0;">
                            Blame the connection, apologize gently, ask for one more try. Most callers repeat clearly.
                        </p>
                    </div>
                    
                    <!-- Tier 2: Second Miss -->
                    <div style="background: #422006; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                            <span style="background: #f59e0b; color: black; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">TIER 2</span>
                            <span style="color: #fbbf24; font-weight: 600;">Second Miss</span>
                            <span style="color: #8b949e; font-size: 12px;">(still patient, ask to slow down)</span>
                        </div>
                        <input type="text" id="fdb-fb-tier2" value="${fb.didNotUnderstandTier2 || defaults.didNotUnderstandTier2}" 
                            placeholder="${defaults.didNotUnderstandTier2}"
                            style="width: 100%; padding: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px;">
                        <p style="color: #8b949e; font-size: 11px; margin: 8px 0 0 0;">
                            Still being patient. Ask them to slow down - this helps with accents and background noise.
                        </p>
                    </div>
                    
                    <!-- Tier 3: Bailout -->
                    <div style="background: #450a0a; border: 1px solid #ef4444; border-radius: 8px; padding: 16px;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                            <span style="background: #ef4444; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">TIER 3</span>
                            <span style="color: #f87171; font-weight: 600;">Bailout</span>
                            <span style="color: #8b949e; font-size: 12px;">(offer callback - last resort)</span>
                        </div>
                        <input type="text" id="fdb-fb-tier3" value="${fb.didNotUnderstandTier3 || defaults.didNotUnderstandTier3}" 
                            placeholder="${defaults.didNotUnderstandTier3}"
                            style="width: 100%; padding: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px;">
                        <p style="color: #8b949e; font-size: 11px; margin: 8px 0 0 0;">
                            When all else fails, offer a human callback. Never abandon the caller. This is RARE (~1% of calls).
                        </p>
                    </div>
                    
                </div>
                
                <!-- Stats/Tips -->
                <div style="background: #0d1117; border: 1px dashed #30363d; border-radius: 8px; padding: 12px; margin-top: 20px;">
                    <p style="color: #8b949e; font-size: 12px; margin: 0;">
                        💡 <strong>Pro tip:</strong> 95% of issues resolve at Tier 1. If you're hitting Tier 3 often, check your STT settings or vocabulary hints.
                    </p>
                </div>
            </div>
        `;
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // V22 TAB: Discovery & Consent Gate
    // ════════════════════════════════════════════════════════════════════════════
    // Controls WHEN booking is allowed and HOW consent is detected.
    // This is the heart of the V22 LLM-led discovery architecture.
    // ════════════════════════════════════════════════════════════════════════════
    renderDiscoveryConsentTab() {
        const dc = this.config.discoveryConsent || {};
        const dt = this.config.detectionTriggers || {};
        
        // Get current values with defaults
        const bookingRequiresConsent = dc.bookingRequiresExplicitConsent !== false;
        const forceLLMDiscovery = dc.forceLLMDiscovery !== false;
        const disableScenarioAuto = dc.disableScenarioAutoResponses !== false;
        const consentQuestion = dc.consentQuestionTemplate || "Would you like me to schedule an appointment for you?";
        const consentYesWords = (dc.consentYesWords || ['yes', 'yeah', 'yep', 'please', 'sure', 'okay', 'ok']).join(', ');
        const wantsBookingPhrases = (dt.wantsBooking || []).join('\n');
        const minFields = dc.minDiscoveryFieldsBeforeConsent || ['issueSummary'];
        
        return `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="margin: 0 0 8px 0; color: #3fb950;">🧠 Discovery & Consent Gate</h3>
                <p style="color: #8b949e; margin-bottom: 20px; font-size: 0.875rem;">
                    <strong>V22 Architecture:</strong> LLM speaks first during discovery. Booking ONLY starts after explicit caller consent.
                </p>
                
                <!-- Kill Switches Section -->
                <div style="background: #0d1117; border: 2px solid #f85149; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                    <h4 style="margin: 0 0 12px 0; color: #f85149;">🔒 Kill Switches (Safety Controls)</h4>
                    <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 16px;">
                        These toggles control the core V22 behavior. All should be ON for best results.
                    </p>
                    
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <label style="display: flex; align-items: center; gap: 12px; cursor: pointer; padding: 12px; background: #161b22; border: 1px solid #30363d; border-radius: 6px;">
                            <input type="checkbox" id="fdb-dc-bookingRequiresConsent" ${bookingRequiresConsent ? 'checked' : ''} 
                                style="accent-color: #3fb950; width: 20px; height: 20px;">
                            <div>
                                <span style="color: #c9d1d9; font-weight: 600;">📋 Booking Requires Explicit Consent</span>
                                <p style="color: #8b949e; font-size: 0.75rem; margin: 4px 0 0 0;">
                                    Booking mode ONLY activates when caller explicitly agrees to schedule. (Recommended: ON)
                                </p>
                            </div>
                        </label>
                        
                        <label style="display: flex; align-items: center; gap: 12px; cursor: pointer; padding: 12px; background: #161b22; border: 1px solid #30363d; border-radius: 6px;">
                            <input type="checkbox" id="fdb-dc-forceLLMDiscovery" ${forceLLMDiscovery ? 'checked' : ''} 
                                style="accent-color: #3fb950; width: 20px; height: 20px;">
                            <div>
                                <span style="color: #c9d1d9; font-weight: 600;">🧠 Force LLM Discovery (No Scripted Responses)</span>
                                <p style="color: #8b949e; font-size: 0.75rem; margin: 4px 0 0 0;">
                                    LLM ALWAYS speaks during discovery - no state machine shortcuts. (Recommended: ON)
                                </p>
                            </div>
                        </label>
                        
                        <label style="display: flex; align-items: center; gap: 12px; cursor: pointer; padding: 12px; background: #161b22; border: 1px solid #30363d; border-radius: 6px;">
                            <input type="checkbox" id="fdb-dc-disableScenarioAuto" ${disableScenarioAuto ? 'checked' : ''} 
                                style="accent-color: #3fb950; width: 20px; height: 20px;">
                            <div>
                                <span style="color: #c9d1d9; font-weight: 600;">📚 Scenarios as Context Only (No Verbatim)</span>
                                <p style="color: #8b949e; font-size: 0.75rem; margin: 4px 0 0 0;">
                                    Scenarios inform the LLM but are never read word-for-word. (Recommended: ON)
                                </p>
                            </div>
                        </label>
                    </div>
                </div>
                
                <!-- Consent Detection Section -->
                <div style="background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                    <h4 style="margin: 0 0 12px 0; color: #58a6ff;">🎯 Consent Detection</h4>
                    <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 16px;">
                        These phrases trigger booking mode. Caller must say one of these to start scheduling.
                    </p>
                    
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                            📝 Consent Phrases (one per line)
                        </label>
                        <textarea id="fdb-dc-wantsBooking" rows="6" 
                            placeholder="schedule an appointment\nbook a service\nsend someone out\nwhen can you come\nset up a time"
                            style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-family: monospace; font-size: 0.85rem; resize: vertical;">${wantsBookingPhrases}</textarea>
                        <p style="color: #8b949e; font-size: 0.7rem; margin-top: 4px;">
                            Examples: "schedule", "book", "send someone", "appointment", "when can you come"
                        </p>
                    </div>
                    
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                            ✅ "Yes" Words (comma-separated)
                        </label>
                        <input type="text" id="fdb-dc-yesWords" value="${consentYesWords}"
                            placeholder="yes, yeah, yep, please, sure, okay, ok, correct"
                            style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.85rem;">
                        <p style="color: #8b949e; font-size: 0.7rem; margin-top: 4px;">
                            Words that count as "yes" after AI asks the consent question
                        </p>
                    </div>
                </div>
                
                <!-- Consent Question Section -->
                <div style="background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                    <h4 style="margin: 0 0 12px 0; color: #a371f7;">💬 Consent Question</h4>
                    <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 16px;">
                        The question AI asks when it believes caller might want to book. Customize per trade.
                    </p>
                    
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                            🎤 Consent Question Template
                        </label>
                        <input type="text" id="fdb-dc-consentQuestion" value="${consentQuestion}"
                            placeholder="Would you like me to schedule an appointment for you?"
                            style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.9rem;">
                        <p style="color: #8b949e; font-size: 0.7rem; margin-top: 4px;">
                            <strong>HVAC:</strong> "Would you like me to schedule a service appointment?"<br>
                            <strong>Dental:</strong> "Would you like me to schedule an appointment for you?"<br>
                            <strong>Legal:</strong> "Would you like me to set up a consultation?"
                        </p>
                    </div>
                </div>
                
                <!-- Minimum Discovery Fields -->
                <div style="background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 16px;">
                    <h4 style="margin: 0 0 12px 0; color: #f0883e;">📋 Required Before Consent</h4>
                    <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 16px;">
                        What must be captured BEFORE AI can ask the consent question. Prevents premature booking.
                    </p>
                    
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                            <input type="checkbox" id="fdb-dc-minField-issueSummary" ${minFields.includes('issueSummary') ? 'checked' : ''} 
                                style="accent-color: #f0883e; width: 16px; height: 16px;">
                            <span style="color: #c9d1d9;">Issue Summary (what's the problem)</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                            <input type="checkbox" id="fdb-dc-minField-serviceType" ${minFields.includes('serviceType') ? 'checked' : ''} 
                                style="accent-color: #f0883e; width: 16px; height: 16px;">
                            <span style="color: #c9d1d9;">Service Type (what kind of service)</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                            <input type="checkbox" id="fdb-dc-minField-urgency" ${minFields.includes('urgency') ? 'checked' : ''} 
                                style="accent-color: #f0883e; width: 16px; height: 16px;">
                            <span style="color: #c9d1d9;">Urgency Level (how urgent)</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                            <input type="checkbox" id="fdb-dc-minField-existingCustomer" ${minFields.includes('existingCustomer') ? 'checked' : ''} 
                                style="accent-color: #f0883e; width: 16px; height: 16px;">
                            <span style="color: #c9d1d9;">Existing Customer (have we served them before)</span>
                        </label>
                    </div>
                </div>
            </div>
        `;
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // V22 TAB: Vocabulary Guardrails
    // ════════════════════════════════════════════════════════════════════════════
    // Prevents cross-trade contamination (HVAC words in dental, etc.)
    // ════════════════════════════════════════════════════════════════════════════
    renderVocabularyTab() {
        const vg = this.config.vocabularyGuardrails || {};
        
        const allowedNouns = (vg.allowedServiceNouns || []).join(', ');
        const forbiddenWords = (vg.forbiddenWords || []).join(', ');
        const replacementMap = vg.replacementMap || {};
        const replacementPairs = Object.entries(replacementMap).map(([k, v]) => `${k} → ${v}`).join('\\n');
        
        return `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="margin: 0 0 8px 0; color: #f0883e;">📝 Vocabulary Guardrails</h3>
                <p style="color: #8b949e; margin-bottom: 20px; font-size: 0.875rem;">
                    <strong>Multi-Tenant Safety:</strong> Prevent cross-trade word contamination. A dental office should never say "technician".
                </p>
                
                <!-- Allowed Service Nouns -->
                <div style="background: #0d1117; border: 1px solid #238636; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; color: #3fb950;">✅ Allowed Service Nouns</h4>
                    <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 12px;">
                        Words the AI CAN use when referring to service/staff. Leave empty to allow any.
                    </p>
                    
                    <input type="text" id="fdb-vg-allowedNouns" value="${allowedNouns}"
                        placeholder="e.g., technician, appointment, service call (for HVAC) or dentist, hygienist, appointment (for dental)"
                        style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.85rem;">
                    <p style="color: #8b949e; font-size: 0.7rem; margin-top: 8px;">
                        <strong>HVAC:</strong> technician, service call, unit, system, repair<br>
                        <strong>Dental:</strong> dentist, hygienist, appointment, cleaning, checkup<br>
                        <strong>Legal:</strong> attorney, consultation, case, meeting
                    </p>
                </div>
                
                <!-- Forbidden Words -->
                <div style="background: #0d1117; border: 1px solid #f85149; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; color: #f85149;">🚫 Forbidden Words</h4>
                    <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 12px;">
                        Words the AI must NEVER use. These will be blocked or replaced.
                    </p>
                    
                    <input type="text" id="fdb-vg-forbiddenWords" value="${forbiddenWords}"
                        placeholder="e.g., technician, dispatch (for dental) or hygienist, dentist (for HVAC)"
                        style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.85rem;">
                    <p style="color: #8b949e; font-size: 0.7rem; margin-top: 8px;">
                        <strong>Dental forbids:</strong> technician, dispatch, unit, repair<br>
                        <strong>HVAC forbids:</strong> hygienist, dentist, cleaning<br>
                        <strong>Legal forbids:</strong> technician, repair, cleaning
                    </p>
                </div>
                
                <!-- Replacement Map -->
                <div style="background: #0d1117; border: 1px solid #a371f7; border-radius: 8px; padding: 16px;">
                    <h4 style="margin: 0 0 12px 0; color: #a371f7;">🔄 Word Replacements</h4>
                    <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 12px;">
                        If a forbidden word must be used, replace it with an approved alternative.
                    </p>
                    
                    <textarea id="fdb-vg-replacements" rows="4" 
                        placeholder="technician → team member\ndispatch → send\nunit → system"
                        style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-family: monospace; font-size: 0.85rem; resize: vertical;">${replacementPairs}</textarea>
                    <p style="color: #8b949e; font-size: 0.7rem; margin-top: 8px;">
                        Format: <code style="background: #30363d; padding: 2px 6px; border-radius: 3px;">forbidden word → replacement</code> (one per line)
                    </p>
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

        // Conversation style radio buttons - update card highlighting
        container.querySelectorAll('input[name="fdb-conversation-style"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                // Update all card styles
                container.querySelectorAll('input[name="fdb-conversation-style"]').forEach(r => {
                    const label = r.closest('label');
                    if (label) {
                        if (r.checked) {
                            label.style.background = '#238636';
                            label.style.borderColor = '#238636';
                        } else {
                            label.style.background = '#0d1117';
                            label.style.borderColor = '#30363d';
                        }
                    }
                });
                console.log('[FRONT DESK BEHAVIOR] 🎯 Style changed to:', e.target.value);
            });
        });

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
            case 'discovery': content.innerHTML = this.renderDiscoveryConsentTab(); break;
            case 'vocabulary': content.innerHTML = this.renderVocabularyTab(); break;
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
                agentName: get('fdb-agent-name') || '',  // AI receptionist name
                tone: get('fdb-tone'),
                verbosity: get('fdb-verbosity'),
                maxResponseWords: parseInt(get('fdb-max-words')) || 30,
                useCallerName: getChecked('fdb-use-name')
            };
        }
        
        // Collect conversation style from radio buttons
        const styleRadio = document.querySelector('input[name="fdb-conversation-style"]:checked');
        if (styleRadio) {
            this.config.conversationStyle = styleRadio.value;
            console.log('[FRONT DESK BEHAVIOR] 🎯 Conversation style:', this.config.conversationStyle);
        }
        
        // Collect style acknowledgments
        if (document.getElementById('fdb-ack-confident')) {
            this.config.styleAcknowledgments = {
                confident: get('fdb-ack-confident') || "Let's get this taken care of.",
                balanced: get('fdb-ack-balanced') || "I can help with that!",
                polite: get('fdb-ack-polite') || "I'd be happy to help."
            };
            console.log('[FRONT DESK BEHAVIOR] 💬 Style acknowledgments:', this.config.styleAcknowledgments);
        }
        
        // Collect time-of-day greeting responses (for ConversationStateMachine)
        if (document.getElementById('fdb-greeting-morning')) {
            // Ensure conversationStages exists
            if (!this.config.conversationStages) {
                this.config.conversationStages = { enabled: true };
            }
            this.config.conversationStages.greetingResponses = {
                morning: get('fdb-greeting-morning') || "Good morning! How can I help you today?",
                afternoon: get('fdb-greeting-afternoon') || "Good afternoon! How can I help you today?",
                evening: get('fdb-greeting-evening') || "Good evening! How can I help you today?",
                generic: get('fdb-greeting-generic') || "Hi there! How can I help you today?"
            };
            console.log('[FRONT DESK BEHAVIOR] 👋 Greeting responses saved:', this.config.conversationStages.greetingResponses);
        }

        // Collect dynamic booking slots
        if (document.getElementById('booking-slots-container')) {
            this.config.bookingSlots = this.collectBookingSlots();
            this.config.bookingTemplates = {
                confirmTemplate: get('fdb-confirmTemplate'),
                completeTemplate: get('fdb-completeTemplate'),
                offerAsap: getChecked('fdb-offerAsap'),
                asapPhrase: get('fdb-asapPhrase')
            };
            // Also update legacy bookingPrompts for backward compatibility
            const slots = this.config.bookingSlots;
            this.config.bookingPrompts = {
                askName: slots.find(s => s.id === 'name')?.question || '',
                askPhone: slots.find(s => s.id === 'phone')?.question || '',
                askAddress: slots.find(s => s.id === 'address')?.question || '',
                askTime: slots.find(s => s.id === 'time')?.question || '',
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
        
        // Legacy greeting response - keep for backward compatibility
        // New time-of-day greetings are saved above in conversationStages.greetingResponses
        // This fallback is used if the new fields don't exist
        if (document.getElementById('fdb-greeting-generic')) {
            this.config.fallbackResponses = this.config.fallbackResponses || {};
            // Use the generic greeting as the fallback
            this.config.fallbackResponses.greeting = get('fdb-greeting-generic') || 'Hi there! How can I help you today?';
        }
        
        // Tiered Fallback Protocol (honesty-first recovery)
        if (document.getElementById('fdb-fb-tier1')) {
            this.config.fallbackResponses = this.config.fallbackResponses || {};
            // New tiered fallbacks
            this.config.fallbackResponses.didNotUnderstandTier1 = get('fdb-fb-tier1') || "I'm sorry, the connection was a little rough and I didn't catch that. Can you please say that one more time?";
            this.config.fallbackResponses.didNotUnderstandTier2 = get('fdb-fb-tier2') || "I'm still having trouble hearing you clearly. Could you repeat that a bit slower for me?";
            this.config.fallbackResponses.didNotUnderstandTier3 = get('fdb-fb-tier3') || "It sounds like this connection isn't great. Do you want me to have someone from the office call or text you back to help you?";
            // Keep backward compat aliases
            this.config.fallbackResponses.didNotUnderstand = get('fdb-fb-tier1') || "I'm sorry, the connection was a little rough and I didn't catch that. Can you please say that one more time?";
            this.config.fallbackResponses.escalation = get('fdb-fb-tier3') || "It sounds like this connection isn't great. Do you want me to have someone from the office call or text you back to help you?";
            console.log('[FRONT DESK BEHAVIOR] 🔄 Tiered fallbacks saved');
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
        
        // ════════════════════════════════════════════════════════════════════════════
        // V22: Discovery & Consent Gate Settings
        // ════════════════════════════════════════════════════════════════════════════
        if (document.getElementById('fdb-dc-bookingRequiresConsent')) {
            // Collect minimum discovery fields
            const minFields = [];
            if (getChecked('fdb-dc-minField-issueSummary')) minFields.push('issueSummary');
            if (getChecked('fdb-dc-minField-serviceType')) minFields.push('serviceType');
            if (getChecked('fdb-dc-minField-urgency')) minFields.push('urgency');
            if (getChecked('fdb-dc-minField-existingCustomer')) minFields.push('existingCustomer');
            
            // Parse yes words from comma-separated input
            const yesWordsRaw = get('fdb-dc-yesWords') || '';
            const yesWords = yesWordsRaw.split(',').map(w => w.trim().toLowerCase()).filter(w => w);
            
            this.config.discoveryConsent = {
                // Kill switches
                bookingRequiresExplicitConsent: getChecked('fdb-dc-bookingRequiresConsent'),
                forceLLMDiscovery: getChecked('fdb-dc-forceLLMDiscovery'),
                disableScenarioAutoResponses: getChecked('fdb-dc-disableScenarioAuto'),
                // Consent question
                consentQuestionTemplate: get('fdb-dc-consentQuestion') || "Would you like me to schedule an appointment for you?",
                // Yes words
                consentYesWords: yesWords.length > 0 ? yesWords : ['yes', 'yeah', 'yep', 'please', 'sure', 'okay', 'ok'],
                // Minimum fields before consent
                minDiscoveryFieldsBeforeConsent: minFields.length > 0 ? minFields : ['issueSummary']
            };
            console.log('[FRONT DESK BEHAVIOR] 🧠 V22 Discovery consent saved:', this.config.discoveryConsent);
            
            // Also update detectionTriggers.wantsBooking from the textarea
            const wantsBookingRaw = get('fdb-dc-wantsBooking') || '';
            const wantsBookingPhrases = wantsBookingRaw.split('\n').map(p => p.trim().toLowerCase()).filter(p => p);
            
            if (!this.config.detectionTriggers) this.config.detectionTriggers = {};
            this.config.detectionTriggers.wantsBooking = wantsBookingPhrases;
            console.log('[FRONT DESK BEHAVIOR] 🎯 Consent phrases saved:', wantsBookingPhrases);
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // V22: Vocabulary Guardrails Settings
        // ════════════════════════════════════════════════════════════════════════════
        if (document.getElementById('fdb-vg-allowedNouns')) {
            // Parse allowed nouns
            const allowedNounsRaw = get('fdb-vg-allowedNouns') || '';
            const allowedNouns = allowedNounsRaw.split(',').map(w => w.trim().toLowerCase()).filter(w => w);
            
            // Parse forbidden words
            const forbiddenWordsRaw = get('fdb-vg-forbiddenWords') || '';
            const forbiddenWords = forbiddenWordsRaw.split(',').map(w => w.trim().toLowerCase()).filter(w => w);
            
            // Parse replacement map
            const replacementsRaw = get('fdb-vg-replacements') || '';
            const replacementMap = {};
            replacementsRaw.split('\n').forEach(line => {
                const parts = line.split('→').map(p => p.trim());
                if (parts.length === 2 && parts[0] && parts[1]) {
                    replacementMap[parts[0].toLowerCase()] = parts[1];
                }
            });
            
            this.config.vocabularyGuardrails = {
                allowedServiceNouns: allowedNouns,
                forbiddenWords: forbiddenWords,
                replacementMap: replacementMap
            };
            console.log('[FRONT DESK BEHAVIOR] 📝 V22 Vocabulary guardrails saved:', this.config.vocabularyGuardrails);
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
