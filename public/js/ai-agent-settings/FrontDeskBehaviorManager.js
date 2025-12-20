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
            
            // 🔇 V36: Load custom fillers from fillerWords.custom (if exists)
            if (this.config.fillerWords?.custom) {
                this.config.customFillers = this.config.fillerWords.custom;
                console.log('[FRONT DESK BEHAVIOR] 🔇 Custom fillers loaded from DB:', {
                    count: this.config.customFillers.length,
                    fillers: this.config.customFillers
                });
            } else {
                this.config.customFillers = [];
            }
            
            // 🚫 V36: Load custom stop words from nameStopWords.custom (if exists)
            if (this.config.nameStopWords?.custom) {
                this.config.customStopWords = this.config.nameStopWords.custom;
                this.config.nameStopWordsEnabled = this.config.nameStopWords.enabled !== false;
                console.log('[FRONT DESK BEHAVIOR] 🚫 Custom stop words loaded from DB:', {
                    enabled: this.config.nameStopWordsEnabled,
                    count: this.config.customStopWords.length,
                    words: this.config.customStopWords
                });
            } else {
                this.config.customStopWords = [];
                this.config.nameStopWordsEnabled = true;
            }
            
            // 🔤 V36: Load inherited synonyms from active AiCore template
            await this.loadInheritedSynonyms(token);
            
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

    // ═══════════════════════════════════════════════════════════════════════════
    // V36: Load inherited synonyms from active AiCore template's synonymMap
    // ═══════════════════════════════════════════════════════════════════════════
    async loadInheritedSynonyms(token) {
        try {
            // First, get the company's template references
            const companyResponse = await fetch(`/api/company/${this.companyId}`, {
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!companyResponse.ok) {
                console.warn('[FRONT DESK BEHAVIOR] 🔤 Could not fetch company for template refs');
                return;
            }
            
            const companyData = await companyResponse.json();
            const company = companyData.company || companyData;
            const templateRefs = company.aiAgentSettings?.templateReferences || [];
            const activeRef = templateRefs.find(ref => ref.enabled !== false);
            
            if (!activeRef?.templateId) {
                console.log('[FRONT DESK BEHAVIOR] 🔤 No active template - no inherited synonyms');
                this.config.inheritedSynonyms = {};
                return;
            }
            
            // Fetch the template's synonymMap from Global AI Brain endpoint
            // This returns { synonyms: { "air conditioner": ["ac", "a/c", ...], ... } }
            // Correct endpoint: /api/admin/global-instant-responses/:id/synonyms
            const synonymsResponse = await fetch(`/api/admin/global-instant-responses/${activeRef.templateId}/synonyms`, {
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!synonymsResponse.ok) {
                console.warn('[FRONT DESK BEHAVIOR] 🔤 Could not fetch template synonyms:', activeRef.templateId);
                // Try fallback to template endpoint
                await this.loadInheritedSynonymsFallback(token, activeRef.templateId);
                return;
            }
            
            const synonymsData = await synonymsResponse.json();
            
            // Store RAW format for card display (same as Global AI Brain)
            // Format: { "air conditioner": ["ac", "a/c", "cooling"], "furnace": ["heater", "heat"] }
            const templateSynonyms = synonymsData.synonyms || {};
            this.config.inheritedSynonymsRaw = templateSynonyms;
            
            // Also create flattened format for engine compatibility
            // Format: { "ac": "air conditioner", "a/c": "air conditioner", "cooling": "air conditioner" }
            const inheritedSynonyms = {};
            for (const [technical, colloquials] of Object.entries(templateSynonyms)) {
                if (Array.isArray(colloquials)) {
                    for (const colloquial of colloquials) {
                        inheritedSynonyms[colloquial.toLowerCase()] = technical;
                    }
                }
            }
            
            this.config.inheritedSynonyms = inheritedSynonyms;
            this.config.activeTemplateName = synonymsData.templateName || synonymsData.name || 'Unknown Template';
            
            console.log('[FRONT DESK BEHAVIOR] 🔤 Inherited synonyms loaded from Global AI Brain:', {
                templateId: activeRef.templateId,
                templateName: this.config.activeTemplateName,
                technicalTerms: Object.keys(templateSynonyms).length,
                totalColloquials: Object.keys(inheritedSynonyms).length,
                rawSample: Object.entries(templateSynonyms).slice(0, 2)
            });
            
            // Also load filler words from template
            await this.loadInheritedFillers(token, activeRef.templateId);
            
        } catch (error) {
            console.error('[FRONT DESK BEHAVIOR] 🔤 Error loading inherited synonyms:', error);
            this.config.inheritedSynonyms = {};
        }
    }
    
    // Load filler words from template
    async loadInheritedFillers(token, templateId) {
        try {
            const fillersResponse = await fetch(`/api/admin/global-instant-responses/${templateId}/filler-words`, {
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!fillersResponse.ok) {
                console.warn('[FRONT DESK BEHAVIOR] 🔇 Could not fetch template fillers');
                this.config.inheritedFillers = [];
                return;
            }
            
            const fillersData = await fillersResponse.json();
            this.config.inheritedFillers = fillersData.fillerWords || [];
            
            console.log('[FRONT DESK BEHAVIOR] 🔇 Inherited fillers loaded:', {
                templateId,
                count: this.config.inheritedFillers.length,
                sample: this.config.inheritedFillers.slice(0, 10)
            });
            
        } catch (error) {
            console.error('[FRONT DESK BEHAVIOR] 🔇 Error loading inherited fillers:', error);
            this.config.inheritedFillers = [];
        }
    }
    
    // Fallback: Try to load from template directly if synonyms endpoint fails
    async loadInheritedSynonymsFallback(token, templateId) {
        try {
            const templateResponse = await fetch(`/api/admin/aicore-templates/${templateId}`, {
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!templateResponse.ok) {
                console.warn('[FRONT DESK BEHAVIOR] 🔤 Fallback also failed');
                this.config.inheritedSynonyms = {};
                this.config.inheritedSynonymsRaw = {};
                return;
            }
            
            const templateData = await templateResponse.json();
            const template = templateData.template || templateData;
            
            // Try multiple possible locations for synonyms
            let rawSynonyms = {};
            
            // Location 1: template.synonymMap (Map or Object)
            if (template?.synonymMap) {
                rawSynonyms = template.synonymMap instanceof Map 
                    ? Object.fromEntries(template.synonymMap)
                    : template.synonymMap;
            }
            
            // Location 2: template.nlpConfig.synonyms (older format)
            if (template?.nlpConfig?.synonyms && Object.keys(rawSynonyms).length === 0) {
                rawSynonyms = template.nlpConfig.synonyms;
            }
            
            // Store RAW format for card display
            this.config.inheritedSynonymsRaw = rawSynonyms;
            
            // Create flattened format for engine compatibility
            const inheritedSynonyms = {};
            for (const [technical, colloquials] of Object.entries(rawSynonyms)) {
                if (Array.isArray(colloquials)) {
                    for (const colloquial of colloquials) {
                        inheritedSynonyms[colloquial.toLowerCase()] = technical;
                    }
                }
            }
            
            this.config.inheritedSynonyms = inheritedSynonyms;
            this.config.activeTemplateName = template?.name || 'Unknown Template';
            
            console.log('[FRONT DESK BEHAVIOR] 🔤 Inherited synonyms loaded (fallback):', {
                templateId,
                templateName: template?.name,
                technicalTerms: Object.keys(rawSynonyms).length,
                totalColloquials: Object.keys(inheritedSynonyms).length
            });
            
        } catch (error) {
            console.error('[FRONT DESK BEHAVIOR] 🔤 Fallback error:', error);
            this.config.inheritedSynonyms = {};
            this.config.inheritedSynonymsRaw = {};
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
            
            // 👤 DEBUG: Log commonFirstNames being saved
            console.log('[FRONT DESK BEHAVIOR] 👤 CHECKPOINT: commonFirstNames BEING SAVED:', {
                count: (this.config.commonFirstNames || []).length,
                names: this.config.commonFirstNames || [],
                hasCommonFirstNames: !!this.config.commonFirstNames,
                fullConfig: JSON.stringify(this.config.commonFirstNames)
            });
            
            // 🎯 DEBUG: Log bookingOutcome being saved
            console.log('[FRONT DESK BEHAVIOR] 🎯 CHECKPOINT: bookingOutcome BEING SAVED:', {
                mode: this.config.bookingOutcome?.mode,
                hasBookingOutcome: !!this.config.bookingOutcome
            });
            
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
                    ${this.renderTab('flows', '🧠 Dynamic Flows')}
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
                
                <!-- Greeting Responses - V36 Clean 2-Column Table with Add Button -->
                <div style="margin-bottom: 20px; padding: 16px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <div>
                            <label style="color: #c9d1d9; font-weight: 500; display: flex; align-items: center; gap: 8px;">
                        👋 Greeting Responses
                                <span style="background: #238636; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px;">0 TOKENS</span>
                    </label>
                            <p style="color: #8b949e; font-size: 0.75rem; margin: 4px 0 0 0;">
                                Instant responses to caller greetings. <strong style="color: #3fb950;">No LLM needed!</strong>
                            </p>
                        </div>
                        <button type="button" onclick="window.frontDeskManager.addGreetingRow()" 
                            style="padding: 8px 16px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(35, 134, 54, 0.3);">
                            <span style="font-size: 1.1rem;">+</span> Add Greeting
                        </button>
                    </div>
                    
                    <!-- Clean 2-Column Table -->
                    <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden;">
                        <!-- Table Header -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr 50px; background: #21262d; border-bottom: 1px solid #30363d;">
                            <div style="padding: 12px 16px; color: #8b949e; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                                Caller Says (Trigger)
                        </div>
                            <div style="padding: 12px 16px; color: #8b949e; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                                AI Responds
                        </div>
                            <div></div>
                        </div>
                        
                        <!-- Table Body -->
                        <div id="fdb-greeting-rows" style="display: flex; flex-direction: column;">
                            ${this.renderGreetingRows()}
                        </div>
                    </div>
                    
                    <!-- Legend -->
                    <div style="display: flex; gap: 16px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #21262d;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="background: #238636; color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">EXACT</span>
                            <span style="color: #6e7681; font-size: 0.7rem;">Matches exact phrase only</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="background: #58a6ff; color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">FUZZY</span>
                            <span style="color: #6e7681; font-size: 0.7rem;">Matches variations (e.g., "morning" → "good morning")</span>
                        </div>
                    </div>
                    
                    <p style="color: #6e7681; font-size: 0.7rem; margin-top: 8px;">
                        💡 <strong>Tip:</strong> Use <code style="background: #21262d; padding: 1px 4px; border-radius: 3px;">{time}</code> for dynamic time → "Good {time}!" becomes "Good morning!"
                    </p>
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
            
            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <!-- NAME SPELLING VARIANTS - Ask "Mark with K or C?" (V30) -->
            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <div style="background: #161b22; border: 1px solid ${this.config.nameSpellingVariants?.enabled ? '#f0883e' : '#30363d'}; border-radius: 8px; padding: 20px; margin-top: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
                    <div>
                        <h3 style="margin: 0; color: #f0883e;">✏️ Name Spelling Variants</h3>
                        <p style="color: #8b949e; font-size: 0.8rem; margin: 4px 0 0 0;">
                            <strong>Optional:</strong> Ask about spelling for names with common variants (Mark/Marc, Brian/Bryan).
                            <br><span style="color: #f85149;">⚠️ OFF by default</span> — Only enable for dental/medical/membership where exact spelling matters.
                        </p>
                    </div>
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" id="fdb-spelling-enabled" ${this.config.nameSpellingVariants?.enabled ? 'checked' : ''} 
                            style="accent-color: #f0883e; width: 18px; height: 18px;"
                            onchange="window.frontDeskManager.toggleSpellingVariants(this.checked)">
                        <span style="color: ${this.config.nameSpellingVariants?.enabled ? '#f0883e' : '#8b949e'}; font-weight: 600;">
                            ${this.config.nameSpellingVariants?.enabled ? 'ENABLED' : 'DISABLED'}
                        </span>
                    </label>
                </div>
                
                <div id="spelling-variants-settings" style="display: ${this.config.nameSpellingVariants?.enabled ? 'block' : 'none'};">
                    <!-- SOURCE SELECTION - Curated List vs Auto-Scan -->
                    <div style="margin-bottom: 16px; padding: 12px; background: #0d1117; border-radius: 6px; border: 1px solid #58a6ff;">
                        <label style="display: block; font-size: 11px; color: #58a6ff; margin-bottom: 8px; font-weight: 600;">📋 Variant Source:</label>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="radio" name="spelling-source" value="curated_list" 
                                    ${(this.config.nameSpellingVariants?.source || 'curated_list') === 'curated_list' ? 'checked' : ''}
                                    style="accent-color: #58a6ff;"
                                    onchange="window.frontDeskManager.toggleSpellingSource('curated_list')">
                                <span style="color: #c9d1d9; font-size: 0.875rem;">
                                    <strong>Use curated list below</strong> 
                                    <span style="color: #8b949e;">(manual control, 8-20 groups)</span>
                                </span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="radio" name="spelling-source" value="auto_scan" 
                                    ${this.config.nameSpellingVariants?.source === 'auto_scan' ? 'checked' : ''}
                                    style="accent-color: #58a6ff;"
                                    onchange="window.frontDeskManager.toggleSpellingSource('auto_scan')">
                                <span style="color: #c9d1d9; font-size: 0.875rem;">
                                    <strong>Auto-scan Common First Names</strong> 
                                    <span style="color: #3fb950;">(${(this.config.commonFirstNames || []).length} names)</span>
                                    <span style="color: #8b949e;">— finds all 1-char variants automatically</span>
                                </span>
                            </label>
                        </div>
                        <p style="color: #6e7681; font-size: 0.7rem; margin: 8px 0 0 0;">
                            Auto-scan checks your full name list for pairs like Mark/Marc, Sara/Sarah automatically. No manual entry needed.
                        </p>
                    </div>
                    
                    <!-- Mode Selection -->
                    <div style="margin-bottom: 16px; padding: 12px; background: #0d1117; border-radius: 6px; border: 1px solid #30363d;">
                        <label style="display: block; font-size: 11px; color: #8b949e; margin-bottom: 8px;">When to ask about spelling:</label>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="radio" name="spelling-mode" value="1_char_only" 
                                    ${(this.config.nameSpellingVariants?.mode || '1_char_only') === '1_char_only' ? 'checked' : ''}
                                    style="accent-color: #f0883e;">
                                <span style="color: #c9d1d9; font-size: 0.875rem;">
                                    <strong>1-character difference only</strong> 
                                    <span style="color: #8b949e;">(recommended: Mark/Marc, Eric/Erik)</span>
                                </span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="radio" name="spelling-mode" value="any_variant" 
                                    ${this.config.nameSpellingVariants?.mode === 'any_variant' ? 'checked' : ''}
                                    style="accent-color: #f0883e;">
                                <span style="color: #c9d1d9; font-size: 0.875rem;">
                                    <strong>Any variant in list</strong>
                                    <span style="color: #8b949e;">(includes Steven/Stephen, Sean/Shawn)</span>
                                </span>
                            </label>
                        </div>
                    </div>
                    
                    <!-- Script Template -->
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; font-size: 11px; color: #8b949e; margin-bottom: 4px;">Spelling question script:</label>
                        <input type="text" id="fdb-spelling-script" 
                            value="${this.config.nameSpellingVariants?.script || 'Just to confirm — {optionA} with a {letterA} or {optionB} with a {letterB}?'}"
                            placeholder="Just to confirm — {optionA} with a {letterA} or {optionB} with a {letterB}?"
                            style="width: 100%; padding: 10px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        <p style="color: #6e7681; font-size: 0.7rem; margin: 4px 0 0 0;">
                            Placeholders: {optionA}, {optionB} = names, {letterA}, {letterB} = differing letters<br>
                            Example output: "Just to confirm — Mark with a K or Marc with a C?"
                        </p>
                    </div>
                    
                    <!-- Variant Groups (only shown for curated_list) -->
                    <div id="fdb-curated-list-section" style="margin-bottom: 12px; display: ${(this.config.nameSpellingVariants?.source || 'curated_list') === 'curated_list' ? 'block' : 'none'};">
                        <label style="display: block; font-size: 11px; color: #8b949e; margin-bottom: 4px;">
                            Name variant groups <span style="color: #6e7681;">(format: Name → Variant1, Variant2)</span>
                        </label>
                        <textarea id="fdb-variant-groups" rows="8" 
                            placeholder="Mark → Marc
Brian → Bryan
Eric → Erik
Jon → John
Sara → Sarah
Cathy → Kathy
Steven → Stephen
Sean → Shawn, Shaun"
                            style="width: 100%; padding: 10px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-family: monospace; font-size: 0.85rem; resize: vertical;">${this.renderVariantGroupsText()}</textarea>
                        <p style="color: #6e7681; font-size: 0.7rem; margin: 4px 0 0 0;">
                            One group per line. AI will only ask if caller's name matches a group AND mode criteria is met.
                        </p>
                    </div>
                    
                    <!-- Auto-Scan Preview (only shown for auto_scan) -->
                    <div id="fdb-auto-scan-section" style="margin-bottom: 12px; display: ${this.config.nameSpellingVariants?.source === 'auto_scan' ? 'block' : 'none'};">
                        <label style="display: block; font-size: 11px; color: #3fb950; margin-bottom: 4px;">
                            🔍 Auto-detected variant pairs from your ${(this.config.commonFirstNames || []).length} names:
                        </label>
                        <div id="fdb-auto-scan-preview" style="padding: 12px; background: #0d1117; border: 1px solid #238636; border-radius: 6px; max-height: 200px; overflow-y: auto;">
                            ${this.renderAutoScanPreview()}
                        </div>
                        <p style="color: #6e7681; font-size: 0.7rem; margin: 4px 0 0 0;">
                            These pairs were automatically found by scanning your Common First Names list for 1-character differences.
                        </p>
                    </div>
                    
                    <!-- Max Asks Per Call -->
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <label style="font-size: 0.875rem; color: #c9d1d9;">Max spelling questions per call:</label>
                        <select id="fdb-spelling-max-asks" style="padding: 6px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                            <option value="1" ${(this.config.nameSpellingVariants?.maxAsksPerCall || 1) === 1 ? 'selected' : ''}>1 (recommended)</option>
                            <option value="2" ${this.config.nameSpellingVariants?.maxAsksPerCall === 2 ? 'selected' : ''}>2</option>
                            <option value="0" ${this.config.nameSpellingVariants?.maxAsksPerCall === 0 ? 'selected' : ''}>Unlimited</option>
                        </select>
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
            
            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <!-- BOOKING OUTCOME - What AI says when all slots are collected -->
            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-top: 16px;">
                <div style="margin-bottom: 16px;">
                    <h3 style="margin: 0; color: #58a6ff;">🎯 Booking Outcome</h3>
                    <p style="color: #8b949e; font-size: 0.8rem; margin: 4px 0 0 0;">
                        What the AI says when all booking information is collected. 
                        <strong style="color: #f0883e;">Default: "Confirmed on Call" - no callbacks unless you enable them.</strong>
                    </p>
                </div>
                
                ${this.renderBookingOutcomeSection()}
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
    
    // ═══════════════════════════════════════════════════════════════════════════
    // GREETING RESPONSES (V32) - Two-column format with fuzzy matching
    // ═══════════════════════════════════════════════════════════════════════════
    
    renderGreetingRows() {
        // Initialize greetings array if not exists
        // Check both locations: config.greetingRules (UI state) and config.conversationStages.greetingRules (from API)
        if (!this.config.greetingRules) {
            // Try to load from conversationStages (from API)
            const savedRules = this.config.conversationStages?.greetingRules;
            if (savedRules && savedRules.length > 0) {
                this.config.greetingRules = savedRules;
                console.log('[FRONT DESK BEHAVIOR] 👋 Loaded greetingRules from conversationStages:', savedRules.length);
            } else {
                // Convert old format to new format (first-time migration)
                // V36: Use EXACT for time-of-day greetings, FUZZY for generic greetings
                const oldGreetings = this.config.conversationStages?.greetingResponses || {};
                this.config.greetingRules = [
                    { trigger: 'good morning', fuzzy: false, response: oldGreetings.morning || 'Good morning! How can I help you today?' },
                    { trigger: 'good afternoon', fuzzy: false, response: oldGreetings.afternoon || 'Good afternoon! How can I help you today?' },
                    { trigger: 'good evening', fuzzy: false, response: oldGreetings.evening || 'Good evening! How can I help you today?' },
                    { trigger: 'hi', fuzzy: true, response: oldGreetings.generic || 'Hi there! How can I help you today?' },
                    { trigger: 'hello', fuzzy: true, response: oldGreetings.generic || 'Hello! How can I help you today?' },
                    { trigger: 'hey', fuzzy: true, response: oldGreetings.generic || 'Hey there! How can I help you today?' }
                ];
                console.log('[FRONT DESK BEHAVIOR] 👋 Created default greetingRules from legacy format');
            }
        }
        
        const greetings = this.config.greetingRules || [];
        
        if (greetings.length === 0) {
            return `
                <div style="padding: 40px 20px; text-align: center;">
                    <div style="font-size: 2.5rem; margin-bottom: 12px; opacity: 0.5;">👋</div>
                    <p style="color: #8b949e; margin: 0 0 8px 0; font-size: 0.9rem;">No greetings configured</p>
                    <p style="color: #6e7681; margin: 0; font-size: 0.8rem;">Click "Add Greeting" above to create your first greeting response</p>
                </div>
            `;
        }
        
        return greetings.map((g, idx) => `
            <div class="greeting-row" data-idx="${idx}" style="display: grid; grid-template-columns: 1fr 1fr 50px; border-bottom: 1px solid #30363d; transition: background 0.15s;">
                <!-- Column 1: Trigger with Exact/Fuzzy Toggle -->
                <div style="padding: 12px 16px; display: flex; flex-direction: column; gap: 8px;">
                    <input type="text" 
                        class="greeting-trigger" 
                        value="${this.escapeHtml(g.trigger || '')}" 
                        placeholder="e.g., good morning, hi, hello..."
                        onchange="window.frontDeskManager.updateGreetingRow(${idx}, 'trigger', this.value)"
                        style="width: 100%; padding: 10px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.9rem;">
                    <div style="display: flex; gap: 8px;">
                        <button type="button" 
                            onclick="window.frontDeskManager.setGreetingMatchType(${idx}, false)"
                            style="flex: 1; padding: 6px 12px; background: ${!g.fuzzy ? '#238636' : '#21262d'}; border: 1px solid ${!g.fuzzy ? '#238636' : '#30363d'}; border-radius: 4px; color: ${!g.fuzzy ? 'white' : '#8b949e'}; cursor: pointer; font-size: 0.75rem; font-weight: 600; transition: all 0.15s;">
                            EXACT
                        </button>
                        <button type="button" 
                            onclick="window.frontDeskManager.setGreetingMatchType(${idx}, true)"
                            style="flex: 1; padding: 6px 12px; background: ${g.fuzzy ? '#58a6ff' : '#21262d'}; border: 1px solid ${g.fuzzy ? '#58a6ff' : '#30363d'}; border-radius: 4px; color: ${g.fuzzy ? 'white' : '#8b949e'}; cursor: pointer; font-size: 0.75rem; font-weight: 600; transition: all 0.15s;">
                            FUZZY
                        </button>
                    </div>
                </div>
                
                <!-- Column 2: Response -->
                <div style="padding: 12px 16px; display: flex; align-items: center;">
                    <input type="text" 
                        class="greeting-response" 
                        value="${this.escapeHtml(g.response || '')}" 
                        placeholder="AI response to caller..."
                        onchange="window.frontDeskManager.updateGreetingRow(${idx}, 'response', this.value)"
                        style="width: 100%; padding: 10px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.9rem;">
                </div>
                
                <!-- Delete Button -->
                <div style="padding: 12px 8px; display: flex; align-items: center; justify-content: center;">
                    <button type="button" 
                        onclick="window.frontDeskManager.removeGreetingRow(${idx})"
                        style="width: 32px; height: 32px; background: transparent; border: 1px solid #f8514940; border-radius: 6px; color: #f85149; cursor: pointer; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; transition: all 0.15s;"
                        onmouseover="this.style.background='#f8514920'; this.style.borderColor='#f85149'"
                        onmouseout="this.style.background='transparent'; this.style.borderColor='#f8514940'"
                        title="Remove this greeting">×</button>
                </div>
            </div>
        `).join('');
    }
    
    setGreetingMatchType(idx, fuzzy) {
        if (!this.config.greetingRules || !this.config.greetingRules[idx]) return;
        
        this.config.greetingRules[idx].fuzzy = fuzzy;
        this.isDirty = true;
        
        // Re-render to update button states
        const container = document.getElementById('fdb-greeting-rows');
        if (container) {
            container.innerHTML = this.renderGreetingRows();
        }
        
        console.log(`[FRONT DESK] 👋 Set greeting ${idx} match type to ${fuzzy ? 'FUZZY' : 'EXACT'}`);
    }
    
    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#039;');
    }
    
    addGreetingRow() {
        if (!this.config.greetingRules) {
            this.config.greetingRules = [];
        }
        
        this.config.greetingRules.push({
            trigger: '',
            fuzzy: true,
            response: ''
        });
        
        // Re-render the rows
        const container = document.getElementById('fdb-greeting-rows');
        if (container) {
            container.innerHTML = this.renderGreetingRows();
        }
        
        this.isDirty = true;
        console.log('[FRONT DESK] 👋 Added new greeting row');
    }
    
    updateGreetingRow(idx, field, value) {
        if (!this.config.greetingRules || !this.config.greetingRules[idx]) return;
        
        this.config.greetingRules[idx][field] = value;
        this.isDirty = true;
        console.log(`[FRONT DESK] 👋 Updated greeting ${idx}: ${field} = ${value}`);
    }
    
    removeGreetingRow(idx) {
        if (!this.config.greetingRules) return;
        
        const removed = this.config.greetingRules.splice(idx, 1);
        console.log('[FRONT DESK] 👋 Removed greeting:', removed[0]?.trigger);
        
        // Re-render the rows
        const container = document.getElementById('fdb-greeting-rows');
        if (container) {
            container.innerHTML = this.renderGreetingRows();
        }
        
        this.isDirty = true;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // NAME SPELLING VARIANTS (V30)
    // ═══════════════════════════════════════════════════════════════════════════
    
    renderVariantGroupsText() {
        const groups = this.config.nameSpellingVariants?.variantGroups || {};
        if (Object.keys(groups).length === 0) {
            // Return default examples
            return `Mark → Marc
Brian → Bryan
Eric → Erik
Jon → John
Sara → Sarah
Cathy → Kathy
Steven → Stephen
Sean → Shawn, Shaun`;
        }
        return Object.entries(groups)
            .map(([name, variants]) => `${name} → ${Array.isArray(variants) ? variants.join(', ') : variants}`)
            .join('\n');
    }
    
    toggleSpellingVariants(enabled) {
        if (!this.config.nameSpellingVariants) {
            this.config.nameSpellingVariants = {
                enabled: false,
                mode: '1_char_only',
                maxAsksPerCall: 1,
                script: 'Just to confirm — {optionA} with a {letterA} or {optionB} with a {letterB}?',
                variantGroups: {}
            };
        }
        this.config.nameSpellingVariants.enabled = enabled;
        
        // Toggle visibility
        const settingsDiv = document.getElementById('spelling-variants-settings');
        if (settingsDiv) {
            settingsDiv.style.display = enabled ? 'block' : 'none';
        }
        
        // Update label
        const labelSpan = document.querySelector('#fdb-spelling-enabled')?.parentElement?.querySelector('span');
        if (labelSpan) {
            labelSpan.textContent = enabled ? 'ENABLED' : 'DISABLED';
            labelSpan.style.color = enabled ? '#f0883e' : '#8b949e';
        }
        
        // Update border
        const container = document.querySelector('#fdb-spelling-enabled')?.closest('div[style*="border"]');
        if (container) {
            container.style.borderColor = enabled ? '#f0883e' : '#30363d';
        }
        
        this.isDirty = true;
        console.log('[FRONT DESK] ✏️ Spelling variants toggled:', enabled);
    }
    
    parseVariantGroups(text) {
        const groups = {};
        const lines = text.split('\n').filter(l => l.trim());
        
        for (const line of lines) {
            // Support both → and -> as separators
            const parts = line.split(/→|->/).map(p => p.trim());
            if (parts.length === 2 && parts[0] && parts[1]) {
                const name = parts[0];
                const variants = parts[1].split(',').map(v => v.trim()).filter(v => v);
                if (variants.length > 0) {
                    groups[name] = variants;
                }
            }
        }
        
        return groups;
    }
    
    collectSpellingVariantsConfig() {
        const enabled = document.getElementById('fdb-spelling-enabled')?.checked || false;
        const source = document.querySelector('input[name="spelling-source"]:checked')?.value || 'curated_list';
        const mode = document.querySelector('input[name="spelling-mode"]:checked')?.value || '1_char_only';
        const script = document.getElementById('fdb-spelling-script')?.value || 'Just to confirm — {optionA} with a {letterA} or {optionB} with a {letterB}?';
        const maxAsks = parseInt(document.getElementById('fdb-spelling-max-asks')?.value || '1', 10);
        const variantGroupsText = document.getElementById('fdb-variant-groups')?.value || '';
        const variantGroups = this.parseVariantGroups(variantGroupsText);
        
        return {
            enabled,
            source,
            mode,
            script,
            maxAsksPerCall: maxAsks,
            variantGroups
        };
    }
    
    toggleSpellingSource(source) {
        const curatedSection = document.getElementById('fdb-curated-list-section');
        const autoScanSection = document.getElementById('fdb-auto-scan-section');
        
        if (curatedSection) {
            curatedSection.style.display = source === 'curated_list' ? 'block' : 'none';
        }
        if (autoScanSection) {
            autoScanSection.style.display = source === 'auto_scan' ? 'block' : 'none';
            // Refresh preview when switching to auto-scan
            if (source === 'auto_scan') {
                const previewDiv = document.getElementById('fdb-auto-scan-preview');
                if (previewDiv) {
                    previewDiv.innerHTML = this.renderAutoScanPreview();
                }
            }
        }
        
        this.isDirty = true;
        console.log('[FRONT DESK] ✏️ Spelling source changed:', source);
    }
    
    // Calculate Levenshtein distance between two strings
    levenshteinDistance(str1, str2) {
        const m = str1.length;
        const n = str2.length;
        const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
        
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (str1[i - 1] === str2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1];
                } else {
                    dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
                }
            }
        }
        return dp[m][n];
    }
    
    // Find the differing character between two names (for 1-char difference)
    findDifferingChar(name1, name2) {
        const n1 = name1.toLowerCase();
        const n2 = name2.toLowerCase();
        
        // Same length - find the different character
        if (n1.length === n2.length) {
            for (let i = 0; i < n1.length; i++) {
                if (n1[i] !== n2[i]) {
                    return { letter1: name1[i].toUpperCase(), letter2: name2[i].toUpperCase() };
                }
            }
        }
        
        // Different length - find the extra character
        const longer = n1.length > n2.length ? name1 : name2;
        const shorter = n1.length > n2.length ? name2 : name1;
        
        for (let i = 0; i < longer.length; i++) {
            if (shorter[i] !== longer[i]?.toLowerCase()) {
                return { 
                    letter1: n1.length > n2.length ? longer[i].toUpperCase() : 'no ' + longer[i].toUpperCase(),
                    letter2: n1.length > n2.length ? 'no ' + longer[i].toUpperCase() : longer[i].toUpperCase()
                };
            }
        }
        
        // Last character is extra
        const extraChar = longer[longer.length - 1];
        return {
            letter1: n1.length > n2.length ? extraChar.toUpperCase() : 'no ' + extraChar.toUpperCase(),
            letter2: n1.length > n2.length ? 'no ' + extraChar.toUpperCase() : extraChar.toUpperCase()
        };
    }
    
    // Auto-scan common first names for 1-character variants
    findAutoVariants() {
        const names = this.config.commonFirstNames || [];
        if (names.length === 0) return [];
        
        const variants = [];
        const processed = new Set();
        
        // Compare each pair of names
        for (let i = 0; i < names.length; i++) {
            for (let j = i + 1; j < names.length; j++) {
                const name1 = names[i];
                const name2 = names[j];
                const key = [name1.toLowerCase(), name2.toLowerCase()].sort().join('|');
                
                if (processed.has(key)) continue;
                
                const distance = this.levenshteinDistance(name1.toLowerCase(), name2.toLowerCase());
                
                if (distance === 1) {
                    const diff = this.findDifferingChar(name1, name2);
                    variants.push({
                        name1,
                        name2,
                        letter1: diff.letter1,
                        letter2: diff.letter2
                    });
                    processed.add(key);
                }
            }
        }
        
        return variants.sort((a, b) => a.name1.localeCompare(b.name1));
    }
    
    renderAutoScanPreview() {
        const variants = this.findAutoVariants();
        
        if (variants.length === 0) {
            return '<p style="color: #8b949e; margin: 0; font-style: italic;">No 1-character variant pairs found in your name list. Add more names below, or use the curated list.</p>';
        }
        
        return `
            <p style="color: #3fb950; margin: 0 0 8px 0; font-weight: 600;">Found ${variants.length} variant pair(s):</p>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                ${variants.map(v => `
                    <span style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; background: #21262d; border: 1px solid #238636; border-radius: 16px; font-size: 0.8rem; color: #c9d1d9;">
                        <strong>${v.name1}</strong> <span style="color: #8b949e;">(${v.letter1})</span>
                        ↔
                        <strong>${v.name2}</strong> <span style="color: #8b949e;">(${v.letter2})</span>
                    </span>
                `).join('')}
            </div>
        `;
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
    
    // ═══════════════════════════════════════════════════════════════════════════
    // BOOKING OUTCOME SECTION
    // ═══════════════════════════════════════════════════════════════════════════
    // Controls what AI says when all slots are collected.
    // DEFAULT: "Confirmed on Call" - no callbacks unless explicitly enabled.
    // ═══════════════════════════════════════════════════════════════════════════
    
    renderBookingOutcomeSection() {
        const outcome = this.config.bookingOutcome || {};
        const mode = outcome.mode || 'confirmed_on_call';
        const finalScripts = outcome.finalScripts || {};
        
        const modes = [
            { 
                value: 'confirmed_on_call', 
                label: '✅ Confirmed on Call', 
                desc: 'Appointment confirmed immediately. No callback needed.',
                default: "Perfect, {name}. You're all set. Your appointment is scheduled for {timePreference}. If anything changes, you can call us back anytime. Is there anything else I can help you with today?",
                recommended: true
            },
            { 
                value: 'pending_dispatch', 
                label: '📋 Pending Dispatch', 
                desc: 'Info sent to dispatch for review and confirmation.',
                default: "Thanks, {name}. I've logged everything and sent it to dispatch. They'll review and confirm the time shortly. Anything else I can help with?"
            },
            { 
                value: 'callback_required', 
                label: '📞 Callback Required', 
                desc: 'Team member will call back to finalize. Use sparingly.',
                default: "Thanks, {name}. A team member will reach out shortly to finalize your appointment. Is there anything else?"
            },
            { 
                value: 'transfer_to_scheduler', 
                label: '🔄 Transfer to Scheduler', 
                desc: 'Immediately transfer to human scheduler.',
                default: "I'm going to transfer you now to our scheduler to get this confirmed."
            },
            { 
                value: 'after_hours_hold', 
                label: '🌙 After-Hours Hold', 
                desc: 'Special handling for after-hours calls.',
                default: "We're currently closed, but I've captured your request. We'll follow up first thing when we open. If this is urgent, I can transfer you now."
            }
        ];
        
        return `
            <div style="display: flex; flex-direction: column; gap: 16px;">
                <!-- Mode Selection -->
                <div>
                    <label style="display: block; margin-bottom: 8px; color: #c9d1d9; font-weight: 500;">Outcome Mode</label>
                    <select id="fdb-booking-outcome-mode" onchange="window.frontDeskManager.updateBookingOutcomeMode(this.value)"
                        style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px;">
                        ${modes.map(m => `
                            <option value="${m.value}" ${mode === m.value ? 'selected' : ''}>
                                ${m.label}${m.recommended ? ' (Recommended)' : ''}
                            </option>
                        `).join('')}
                    </select>
                    <p id="fdb-outcome-mode-desc" style="color: #8b949e; font-size: 0.75rem; margin: 6px 0 0 0;">
                        ${modes.find(m => m.value === mode)?.desc || ''}
                    </p>
                </div>
                
                <!-- Final Script for Selected Mode -->
                <div>
                    <label style="display: block; margin-bottom: 8px; color: #c9d1d9; font-weight: 500;">
                        Final Script 
                        <span style="color: #8b949e; font-weight: normal; font-size: 0.8rem;">(what AI says when booking completes)</span>
                    </label>
                    <textarea id="fdb-booking-outcome-script" rows="3" 
                        onchange="window.frontDeskManager.updateBookingOutcomeScript(this.value)"
                        style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical; font-family: inherit;"
                    >${finalScripts[mode] || modes.find(m => m.value === mode)?.default || ''}</textarea>
                    <p style="color: #6e7681; font-size: 0.7rem; margin: 6px 0 0 0;">
                        Placeholders: {name}, {phone}, {address}, {timePreference}, {trade}, {serviceType}, {caseId}, {issue}
                    </p>
                </div>
                
                <!-- ASAP Variant -->
                <div style="border-top: 1px solid #30363d; padding-top: 16px; margin-top: 8px;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 12px;">
                        <input type="checkbox" id="fdb-use-asap-variant" 
                            ${outcome.useAsapVariant !== false ? 'checked' : ''}
                            onchange="window.frontDeskManager.updateBookingOutcomeAsap(this.checked)"
                            style="accent-color: #58a6ff;">
                        <span style="color: #c9d1d9;">Use special script for ASAP/urgent requests</span>
                    </label>
                    <textarea id="fdb-asap-variant-script" rows="2" 
                        onchange="window.frontDeskManager.updateBookingOutcomeAsapScript(this.value)"
                        style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical; font-family: inherit; ${outcome.useAsapVariant === false ? 'opacity: 0.5;' : ''}"
                        ${outcome.useAsapVariant === false ? 'disabled' : ''}
                    >${outcome.asapVariantScript || "Perfect, {name}. I've marked this as urgent. Someone will be in touch shortly to confirm the earliest available time. Anything else?"}</textarea>
                </div>
                
                <!-- Custom Override (Advanced) -->
                <details style="border-top: 1px solid #30363d; padding-top: 16px; margin-top: 8px;">
                    <summary style="color: #8b949e; cursor: pointer; font-size: 0.85rem;">⚙️ Advanced: Custom Override Script</summary>
                    <div style="margin-top: 12px;">
                        <p style="color: #6e7681; font-size: 0.75rem; margin-bottom: 8px;">
                            If set, this script overrides ALL mode-specific scripts. Leave empty to use mode defaults.
                        </p>
                        <textarea id="fdb-custom-final-script" rows="2" 
                            onchange="window.frontDeskManager.updateBookingOutcomeCustom(this.value)"
                            placeholder="Leave empty to use mode-specific scripts above"
                            style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical; font-family: inherit;"
                        >${outcome.customFinalScript || ''}</textarea>
                    </div>
                </details>
            </div>
        `;
    }
    
    updateBookingOutcomeMode(mode) {
        if (!this.config.bookingOutcome) {
            this.config.bookingOutcome = {};
        }
        this.config.bookingOutcome.mode = mode;
        this.isDirty = true;
        
        // Update description
        const descEl = document.getElementById('fdb-outcome-mode-desc');
        const modes = {
            'confirmed_on_call': 'Appointment confirmed immediately. No callback needed.',
            'pending_dispatch': 'Info sent to dispatch for review and confirmation.',
            'callback_required': 'Team member will call back to finalize. Use sparingly.',
            'transfer_to_scheduler': 'Immediately transfer to human scheduler.',
            'after_hours_hold': 'Special handling for after-hours calls.'
        };
        if (descEl) {
            descEl.textContent = modes[mode] || '';
        }
        
        // Update script textarea with mode's default if not already customized
        const scriptEl = document.getElementById('fdb-booking-outcome-script');
        const finalScripts = this.config.bookingOutcome.finalScripts || {};
        if (scriptEl && !finalScripts[mode]) {
            const defaults = {
                'confirmed_on_call': "Perfect, {name}. You're all set. Your appointment is scheduled for {timePreference}. If anything changes, you can call us back anytime. Is there anything else I can help you with today?",
                'pending_dispatch': "Thanks, {name}. I've logged everything and sent it to dispatch. They'll review and confirm the time shortly. Anything else I can help with?",
                'callback_required': "Thanks, {name}. A team member will reach out shortly to finalize your appointment. Is there anything else?",
                'transfer_to_scheduler': "I'm going to transfer you now to our scheduler to get this confirmed.",
                'after_hours_hold': "We're currently closed, but I've captured your request. We'll follow up first thing when we open. If this is urgent, I can transfer you now."
            };
            scriptEl.value = defaults[mode] || '';
        } else if (scriptEl && finalScripts[mode]) {
            scriptEl.value = finalScripts[mode];
        }
        
        console.log('[FRONT DESK] Booking outcome mode changed:', mode);
    }
    
    updateBookingOutcomeScript(script) {
        if (!this.config.bookingOutcome) {
            this.config.bookingOutcome = {};
        }
        if (!this.config.bookingOutcome.finalScripts) {
            this.config.bookingOutcome.finalScripts = {};
        }
        const mode = this.config.bookingOutcome.mode || 'confirmed_on_call';
        this.config.bookingOutcome.finalScripts[mode] = script;
        this.isDirty = true;
        console.log('[FRONT DESK] Booking outcome script updated for mode:', mode);
    }
    
    updateBookingOutcomeAsap(enabled) {
        if (!this.config.bookingOutcome) {
            this.config.bookingOutcome = {};
        }
        this.config.bookingOutcome.useAsapVariant = enabled;
        this.isDirty = true;
        
        // Enable/disable the ASAP script textarea
        const scriptEl = document.getElementById('fdb-asap-variant-script');
        if (scriptEl) {
            scriptEl.disabled = !enabled;
            scriptEl.style.opacity = enabled ? '1' : '0.5';
        }
        
        console.log('[FRONT DESK] ASAP variant enabled:', enabled);
    }
    
    updateBookingOutcomeAsapScript(script) {
        if (!this.config.bookingOutcome) {
            this.config.bookingOutcome = {};
        }
        this.config.bookingOutcome.asapVariantScript = script;
        this.isDirty = true;
        console.log('[FRONT DESK] ASAP variant script updated');
    }
    
    updateBookingOutcomeCustom(script) {
        if (!this.config.bookingOutcome) {
            this.config.bookingOutcome = {};
        }
        this.config.bookingOutcome.customFinalScript = script || null;
        this.isDirty = true;
        console.log('[FRONT DESK] Custom final script updated:', script ? 'set' : 'cleared');
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
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;" title="Require BOTH first AND last name. If OFF, single name is accepted.">
                        <input type="checkbox" class="slot-askFullName" data-index="${index}" ${slot.askFullName === true ? 'checked' : ''} style="accent-color: #58a6ff;">
                        <span style="font-size: 12px; color: #c9d1d9;">Require full name (first + last)</span>
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
                    
                    <!-- V35: Google Maps Validation -->
                    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #30363d;">
                        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px;">
                            <span style="font-size: 11px; color: #238636; font-weight: 600;">🗺️ Google Maps Validation:</span>
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;" title="Use Google Maps to validate and normalize addresses (requires API key)">
                                <input type="checkbox" class="slot-useGoogleMapsValidation" data-index="${index}" ${slot.useGoogleMapsValidation ? 'checked' : ''} style="accent-color: #238636;" onchange="window.frontDeskManager.toggleGoogleMapsOptions(${index}, this.checked)">
                                <span style="font-size: 12px; color: #c9d1d9;">Enable Google Maps validation</span>
                    </label>
                        </div>
                        <div class="google-maps-options" style="display: ${slot.useGoogleMapsValidation ? 'flex' : 'none'}; flex-direction: column; gap: 8px; padding: 8px; background: #0d1117; border-radius: 4px; border: 1px solid #238636;">
                            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <label style="font-size: 12px; color: #8b949e;">Validation mode:</label>
                                <select class="slot-googleMapsValidationMode" data-index="${index}" style="padding: 4px 8px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px;">
                                    <option value="silent" ${slot.googleMapsValidationMode === 'silent' ? 'selected' : ''}>Silent (normalize only, never ask)</option>
                                    <option value="confirm_low_confidence" ${(slot.googleMapsValidationMode === 'confirm_low_confidence' || !slot.googleMapsValidationMode) ? 'selected' : ''}>Confirm if low confidence</option>
                                    <option value="always_confirm" ${slot.googleMapsValidationMode === 'always_confirm' ? 'selected' : ''}>Always confirm normalized address</option>
                                </select>
                            </div>
                            <div style="font-size: 10px; color: #6e7681; font-style: italic; margin-top: 4px;">
                                💡 Google Maps validates silently in the background — never blocks conversation or asks redundant questions.
                            </div>
                        </div>
                    </div>
                    
                    <!-- V35: Unit/Apartment Number Detection (World-Class) -->
                    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #30363d;">
                        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px;">
                            <span style="font-size: 11px; color: #f0883e; font-weight: 600;">🏢 Unit/Apartment Detection:</span>
                            <select class="slot-unitNumberMode" data-index="${index}" style="padding: 4px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px;" onchange="window.frontDeskManager.toggleUnitOptions(${index}, this.value)">
                                <option value="smart" ${(slot.unitNumberMode === 'smart' || !slot.unitNumberMode) ? 'selected' : ''}>🧠 Smart (detect condos, apartments, offices)</option>
                                <option value="always" ${slot.unitNumberMode === 'always' ? 'selected' : ''}>✅ Always ask for unit number</option>
                                <option value="never" ${slot.unitNumberMode === 'never' ? 'selected' : ''}>❌ Never ask (single-family homes only)</option>
                            </select>
                        </div>
                        <div class="unit-options" style="display: ${slot.unitNumberMode !== 'never' ? 'flex' : 'none'}; flex-direction: column; gap: 8px; padding: 8px; background: #0d1117; border-radius: 4px; border: 1px solid #f0883e;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <label style="font-size: 12px; color: #8b949e; white-space: nowrap;">Unit prompt:</label>
                                <input type="text" class="slot-unitNumberPrompt" data-index="${index}" value="${slot.unitNumberPrompt || 'Is there an apartment or unit number?'}" 
                                    style="flex: 1; padding: 4px 8px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px;">
                            </div>
                            
                            <!-- Prompt Variants -->
                            <div style="display: flex; flex-direction: column; gap: 4px;">
                                <label style="font-size: 11px; color: #8b949e;">Prompt variants (one per line, agent picks randomly):</label>
                                <textarea class="slot-unitPromptVariants" data-index="${index}" rows="3" 
                                    placeholder="Is there an apartment or unit number?\nWhat's the apartment or suite number?\nIs there a unit or building number I should note?"
                                    style="width: 100%; padding: 6px 8px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px; resize: vertical;">${(slot.unitPromptVariants || ['Is there an apartment or unit number?', "What's the apartment or suite number?", 'Is there a unit or building number I should note?']).join('\n')}</textarea>
                            </div>
                            
                            <!-- Smart Mode Options -->
                            <div class="smart-mode-options" style="display: ${slot.unitNumberMode !== 'always' ? 'block' : 'none'}; margin-top: 8px; padding: 8px; background: #161b22; border-radius: 4px; border: 1px dashed #30363d;">
                                <div style="font-size: 11px; color: #f0883e; font-weight: 600; margin-bottom: 8px;">🧠 Smart Detection Settings:</div>
                                
                                <!-- Trigger Words -->
                                <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px;">
                                    <label style="font-size: 11px; color: #8b949e;">Trigger words (ask for unit if address contains these):</label>
                                    <textarea class="slot-unitTriggerWords" data-index="${index}" rows="2" 
                                        placeholder="apartment, condo, tower, plaza, suite, office..."
                                        style="width: 100%; padding: 6px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px; resize: vertical;">${(slot.unitTriggerWords || []).join(', ')}</textarea>
                                    <div style="font-size: 10px; color: #6e7681;">Default triggers: apartment, condo, tower, plaza, suite, loft, manor, terrace, village, office, etc.</div>
                                </div>
                                
                                <!-- ZIP Code Rules -->
                                <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                                    <div style="flex: 1; min-width: 200px;">
                                        <label style="font-size: 11px; color: #8b949e; display: block; margin-bottom: 4px;">Always ask in these ZIPs (downtown, urban):</label>
                                        <input type="text" class="slot-unitAlwaysAskZips" data-index="${index}" 
                                            value="${(slot.unitAlwaysAskZips || []).join(', ')}"
                                            placeholder="33101, 33130, 33132..."
                                            style="width: 100%; padding: 4px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px;">
                                    </div>
                                    <div style="flex: 1; min-width: 200px;">
                                        <label style="font-size: 11px; color: #8b949e; display: block; margin-bottom: 4px;">Never ask in these ZIPs (rural, single-family):</label>
                                        <input type="text" class="slot-unitNeverAskZips" data-index="${index}" 
                                            value="${(slot.unitNeverAskZips || []).join(', ')}"
                                            placeholder="33912, 33913..."
                                            style="width: 100%; padding: 4px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px;">
                                    </div>
                                </div>
                            </div>
                            
                            <div style="font-size: 10px; color: #6e7681; font-style: italic; margin-top: 4px;">
                                🏢 Smart mode detects: condos, apartments, office buildings, towers, plazas, and more. Customize with trigger words and ZIP rules.
                            </div>
                        </div>
                    </div>
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
    
    // V35: Toggle Google Maps validation options visibility
    toggleGoogleMapsOptions(index, enabled) {
        const optionsContainer = document.querySelector(`.slot-useGoogleMapsValidation[data-index="${index}"]`)?.closest('.booking-slot')?.querySelector('.google-maps-options');
        if (optionsContainer) {
            optionsContainer.style.display = enabled ? 'flex' : 'none';
        }
        console.log(`[FRONT DESK] Google Maps validation ${enabled ? 'enabled' : 'disabled'} for slot ${index}`);
    }
    
    // V35: Toggle unit number options visibility based on mode
    toggleUnitOptions(index, mode) {
        const slotContainer = document.querySelector(`.slot-unitNumberMode[data-index="${index}"]`)?.closest('.booking-slot');
        if (!slotContainer) return;
        
        const unitOptions = slotContainer.querySelector('.unit-options');
        const smartModeOptions = slotContainer.querySelector('.smart-mode-options');
        
        if (unitOptions) {
            unitOptions.style.display = mode !== 'never' ? 'flex' : 'none';
        }
        if (smartModeOptions) {
            smartModeOptions.style.display = mode === 'smart' ? 'block' : 'none';
        }
        
        console.log(`[FRONT DESK] Unit detection mode changed to '${mode}' for slot ${index}`);
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
                askFullName: false,  // 🎯 Default FALSE - "prompt as law" - only ask last name if explicitly required
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
                acceptPartialAddress: false,
                // V35: Google Maps validation (off by default - enable per company)
                useGoogleMapsValidation: false,
                googleMapsValidationMode: 'confirm_low_confidence',
                // V35: Unit/Apartment Detection (World-Class)
                unitNumberMode: 'smart', // smart | always | never
                unitNumberPrompt: 'Is there an apartment or unit number?',
                unitPromptVariants: [
                    'Is there an apartment or unit number?',
                    "What's the apartment or suite number?",
                    'Is there a unit or building number I should note?'
                ],
                unitTriggerWords: [], // Additional custom triggers
                unitAlwaysAskZips: [], // Downtown/urban ZIPs
                unitNeverAskZips: [] // Rural/single-family ZIPs
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
            
            // NAME options - Default askFullName to FALSE (prompt as law)
            if (el.querySelector('.slot-askFullName')) {
                slotData.askFullName = getCheckedDefault('.slot-askFullName', false);
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
            
            // V35: GOOGLE MAPS VALIDATION options
            if (el.querySelector('.slot-useGoogleMapsValidation')) {
                slotData.useGoogleMapsValidation = getChecked('.slot-useGoogleMapsValidation');
            }
            if (el.querySelector('.slot-googleMapsValidationMode')) {
                slotData.googleMapsValidationMode = el.querySelector('.slot-googleMapsValidationMode')?.value || 'confirm_low_confidence';
            }
            
            // V35: UNIT/APARTMENT DETECTION options (World-Class)
            if (el.querySelector('.slot-unitNumberMode')) {
                slotData.unitNumberMode = el.querySelector('.slot-unitNumberMode')?.value || 'smart';
            }
            if (el.querySelector('.slot-unitNumberPrompt')) {
                slotData.unitNumberPrompt = getVal('.slot-unitNumberPrompt') || 'Is there an apartment or unit number?';
            }
            if (el.querySelector('.slot-unitPromptVariants')) {
                const variantsText = getVal('.slot-unitPromptVariants');
                slotData.unitPromptVariants = variantsText ? variantsText.split('\n').map(v => v.trim()).filter(v => v) : [];
            }
            if (el.querySelector('.slot-unitTriggerWords')) {
                const triggerText = getVal('.slot-unitTriggerWords');
                slotData.unitTriggerWords = triggerText ? triggerText.split(',').map(w => w.trim().toLowerCase()).filter(w => w) : [];
            }
            if (el.querySelector('.slot-unitAlwaysAskZips')) {
                const zipsText = getVal('.slot-unitAlwaysAskZips');
                slotData.unitAlwaysAskZips = zipsText ? zipsText.split(',').map(z => z.trim()).filter(z => /^\d{5}$/.test(z)) : [];
            }
            if (el.querySelector('.slot-unitNeverAskZips')) {
                const zipsText = getVal('.slot-unitNeverAskZips');
                slotData.unitNeverAskZips = zipsText ? zipsText.split(',').map(z => z.trim()).filter(z => /^\d{5}$/.test(z)) : [];
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

    // ═══════════════════════════════════════════════════════════════════════════
    // 🧠 DYNAMIC FLOWS TAB - Phase 3: Trigger → Event → State → Action
    // ═══════════════════════════════════════════════════════════════════════════
    renderDynamicFlowsTab() {
        return `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <div>
                        <h3 style="margin: 0; color: #58a6ff;">🧠 Dynamic Flows</h3>
                        <p style="color: #8b949e; margin: 8px 0 0 0; font-size: 0.875rem;">
                            Trigger-based conversation flows. The brain stem that controls how conversations evolve.
                        </p>
                    </div>
                    <button id="fdb-add-flow-btn" style="padding: 10px 20px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                        ➕ Add Flow
                    </button>
                </div>
                
                <!-- Flow List -->
                <div id="fdb-flows-list" style="display: flex; flex-direction: column; gap: 12px;">
                    <div style="text-align: center; padding: 40px; color: #8b949e;">
                        <div style="font-size: 48px; margin-bottom: 16px;">⏳</div>
                        <p>Loading flows...</p>
                    </div>
                </div>
                
                <!-- Templates Section -->
                <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid #30363d;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <div>
                            <h4 style="color: #c9d1d9; margin: 0;">📋 Available Templates</h4>
                            <p style="color: #8b949e; font-size: 13px; margin: 4px 0 0 0;">
                                Global templates you can copy and customize for this company.
                            </p>
                        </div>
                        <button id="fdb-seed-templates-btn" style="
                            padding: 8px 16px;
                            background: #6e40c9;
                            color: white;
                            border: none;
                            border-radius: 6px;
                            cursor: pointer;
                            font-size: 12px;
                            font-weight: 600;
                        ">🌱 Seed Templates</button>
                    </div>
                    <div id="fdb-templates-list" style="display: flex; flex-direction: column; gap: 8px;">
                        <div style="text-align: center; padding: 20px; color: #8b949e;">
                            Loading templates...
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    async loadDynamicFlows() {
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const response = await fetch(`/api/company/${this.companyId}/dynamic-flows?includeTemplates=true`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) throw new Error('Failed to load flows');
            
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('[DYNAMIC FLOWS] Load error:', error);
            return { flows: [], templates: [] };
        }
    }
    
    renderFlowCard(flow, isTemplate = false) {
        const statusColor = flow.enabled ? '#238636' : '#6e7681';
        const statusText = flow.enabled ? 'ACTIVE' : 'DISABLED';
        
        const triggerCount = (flow.triggers || []).length;
        const requirementCount = (flow.requirements || []).length;
        const actionCount = (flow.actions || []).length;
        
        const templateBadge = isTemplate ? '<span style="font-size: 11px; padding: 2px 8px; background: #6e40c9; border-radius: 10px; color: white;">TEMPLATE</span>' : '';
        const priorityBadge = flow.priority > 50 ? '<span style="font-size: 11px; padding: 2px 8px; background: #f85149; border-radius: 10px; color: white;">HIGH PRIORITY</span>' : '';
        
        let buttons = '';
        if (isTemplate) {
            buttons = `
                <button class="flow-copy-btn" data-flow-id="${flow._id}" style="
                    padding: 8px 12px;
                    background: #238636;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                ">📋 Copy to Company</button>
            `;
        } else {
            buttons = `
                <button class="flow-toggle-btn" data-flow-id="${flow._id}" data-enabled="${flow.enabled}" style="
                    padding: 8px 12px;
                    background: ${flow.enabled ? '#6e7681' : '#238636'};
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                ">${flow.enabled ? '⏸️ Disable' : '▶️ Enable'}</button>
                <button class="flow-edit-btn" data-flow-id="${flow._id}" style="
                    padding: 8px 12px;
                    background: #21262d;
                    color: #c9d1d9;
                    border: 1px solid #30363d;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                ">✏️ Edit</button>
                <button class="flow-delete-btn" data-flow-id="${flow._id}" style="
                    padding: 8px 12px;
                    background: #21262d;
                    color: #f85149;
                    border: 1px solid #30363d;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                ">🗑️</button>
            `;
        }
        
        return `
            <div class="flow-card" data-flow-id="${flow._id}" style="
                background: #0d1117;
                border: 1px solid #30363d;
                border-radius: 8px;
                padding: 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            ">
                <div style="flex: 1;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                        <span style="font-weight: 600; color: #c9d1d9;">${flow.name}</span>
                        <span style="font-size: 11px; padding: 2px 8px; background: ${statusColor}; border-radius: 10px; color: white;">
                            ${statusText}
                        </span>
                        ${templateBadge}
                        ${priorityBadge}
                    </div>
                    <p style="color: #8b949e; font-size: 13px; margin: 0 0 8px 0;">${flow.description || 'No description'}</p>
                    <div style="display: flex; gap: 16px; font-size: 12px; color: #6e7681;">
                        <span>🎯 ${triggerCount} triggers</span>
                        <span>📋 ${requirementCount} requirements</span>
                        <span>⚡ ${actionCount} actions</span>
                        <span style="color: #58a6ff;">Key: ${flow.flowKey}</span>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    ${buttons}
                </div>
            </div>
        `;
    }
    
    async refreshFlowsList(container) {
        const flowsContainer = container.querySelector('#fdb-flows-list');
        const templatesContainer = container.querySelector('#fdb-templates-list');
        
        if (!flowsContainer) return;
        
        const data = await this.loadDynamicFlows();
        const v1Templates = this.getV1SampleFlows();
        
        // Render company flows
        if (data.flows && data.flows.length > 0) {
            flowsContainer.innerHTML = data.flows.map(f => this.renderFlowCard(f, false)).join('');
        } else {
            flowsContainer.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #8b949e; background: #0d1117; border: 1px solid #30363d; border-radius: 8px;">
                    <div style="font-size: 48px; margin-bottom: 16px;">🧠</div>
                    <p style="font-weight: 600; margin-bottom: 8px;">No custom flows yet</p>
                    <p style="font-size: 13px;">Add a flow or copy from templates below to get started.</p>
                </div>
            `;
        }
        
        // Render templates
        if (templatesContainer) {
            const allTemplates = (data.templates || []).concat(v1Templates);
            if (allTemplates.length > 0) {
                templatesContainer.innerHTML = allTemplates.map(t => this.renderFlowCard(t, true)).join('');
            } else {
                templatesContainer.innerHTML = '<p style="color: #6e7681; font-size: 13px;">No templates available.</p>';
            }
        } else if (templatesContainer) {
            templatesContainer.innerHTML = '<p style="color: #6e7681; font-size: 13px;">No templates available.</p>';
        }
        
        // Attach flow-specific event listeners
        this.attachFlowEventListeners(container);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // V1 SAMPLE FLOWS - WORLD-CLASS PRODUCTION-READY TEMPLATES
    // ═══════════════════════════════════════════════════════════════════════════
    // 
    // ACTION ORDER (MANDATORY FOR V1):
    //   1. SET_FLAG (first - sets state)
    //   2. APPEND_LEDGER (second - logs the event)
    //   3. ACK_ONCE (third - speaks to caller)
    //   4. TRANSITION_MODE (LAST - changes mode)
    //
    // PRIORITY HIERARCHY:
    //   200 = EMERGENCY (blocks all others, allowConcurrent=false)
    //   100 = CANCELLATION/COMPLAINT (high priority)
    //    60 = RETURNING CUSTOMER (fires before booking if both match)
    //    55 = NEW CUSTOMER
    //    50 = BOOKING INTENT (standard)
    //    45 = QUOTE REQUEST (lowest)
    //
    // ═══════════════════════════════════════════════════════════════════════════
    getV1SampleFlows() {
        return [
            // ─────────────────────────────────────────────────────────────────────
            // 1. 🚨 EMERGENCY SERVICE (Priority 200 - HIGHEST)
            // ─────────────────────────────────────────────────────────────────────
            // BLOCKS all lower-priority flows with allowConcurrent=false
            // Fast-tracks to booking with priority flag
            // HIGH PRECISION phrases only - no "not cooling" (too broad)
            // Includes safety/liability ACK for gas/smoke/fire/CO
            // ─────────────────────────────────────────────────────────────────────
            {
                _id: 'template-emergency-service',
                name: '🚨 Emergency Service Detection',
                description: 'Detects TRUE emergencies (gas leak, fire, flooding, CO). Includes safety directive. Blocks all other flows.',
                flowKey: 'emergency_service',
                enabled: true,
                priority: 200,
                triggers: [{
                    type: 'phrase',
                    config: { 
                        phrases: [
                            // URGENCY INDICATORS
                            'emergency',
                            'urgent',
                            'asap',
                            'right now',
                            'immediately',
                            'dangerous',
                            'dangerous situation',
                            // COMPLETE SYSTEM FAILURE (extreme conditions)
                            'no heat at all',
                            'heat completely out',
                            'no ac at all',
                            'ac completely out',
                            'no cooling at all',
                            'no heating at all',
                            // WATER EMERGENCIES
                            'flooding',
                            'flooded',
                            'water everywhere',
                            'water pouring',
                            'ceiling leaking',
                            'active leak',
                            'burst pipe',
                            'pipe burst',
                            'broken pipe',
                            'pipes burst',
                            'frozen pipes',
                            // GAS EMERGENCIES (high liability)
                            'gas leak',
                            'leaking gas',
                            'smell gas',
                            'smells like gas',
                            'i smell gas',
                            'gas smell',
                            // FIRE/SMOKE/ELECTRICAL (high liability)
                            'fire',
                            'smoke',
                            'smoke smell',
                            'burning smell',
                            'burning wire smell',
                            'electrical smell',
                            'electrical burning smell',
                            'sparks',
                            'sparking',
                            'electrical fire',
                            // CARBON MONOXIDE (life safety)
                            'carbon monoxide',
                            'carbon monoxide alarm',
                            'co detector',
                            'co alarm',
                            'alarm going off'
                        ], 
                        fuzzy: true 
                    },
                    priority: 10,
                    minConfidence: 0.7
                }],
                actions: [
                    // 1. SET_FLAG first
                    {
                        timing: 'on_activate',
                        type: 'set_flag',
                        config: { 
                            flagName: 'priorityLevel', 
                            flagValue: 'emergency',
                            alsoWriteToCallLedgerFacts: true
                        }
                    },
                    // 2. APPEND_LEDGER second
                    {
                        timing: 'on_activate',
                        type: 'append_ledger',
                        config: { 
                            type: 'EVENT', 
                            key: 'EMERGENCY_DETECTED', 
                            note: 'Emergency keywords detected. Blocking lower-priority flows and fast-tracking to booking.' 
                        }
                    },
                    // 3. ACK_ONCE third - INCLUDES SAFETY DIRECTIVE for liability
                    {
                        timing: 'on_activate',
                        type: 'ack_once',
                        config: { 
                            text: 'Got it — that sounds urgent. If you\'re smelling gas, seeing smoke, sparks, or a CO alarm is going off, please get to a safe place and call 911 first. If it\'s safe to continue, I\'m going to get a technician scheduled as quickly as possible. Let me grab a few details.' 
                        }
                    },
                    // 4. TRANSITION_MODE last
                    {
                        timing: 'on_activate',
                        type: 'transition_mode',
                        config: { 
                            targetMode: 'BOOKING', 
                            setBookingLocked: true 
                        }
                    }
                ],
                settings: {
                    allowConcurrent: false,  // BLOCKS all lower-priority flows
                    persistent: true,
                    reactivatable: false,
                    minConfidence: 0.7
                },
                meta: { createdFromTemplate: true, category: 'priority' }
            },
            
            // ─────────────────────────────────────────────────────────────────────
            // 2. 🔄 RETURNING CUSTOMER CLAIM (Priority 60)
            // ─────────────────────────────────────────────────────────────────────
            // Fires BEFORE booking_intent if both match in same utterance
            // Sets flag for CRM lookup, can fire alongside booking
            // ─────────────────────────────────────────────────────────────────────
            {
                _id: 'template-returning-customer',
                name: '🔄 Returning Customer Claim',
                description: 'Detects existing/returning customers. Sets flag for CRM lookup and personalizes the conversation.',
                flowKey: 'returning_customer_claim',
                enabled: true,
                priority: 60,
                triggers: [{
                    type: 'phrase',
                    config: { 
                        phrases: [
                            'long time customer',
                            'longtime customer',
                            'returning customer',
                            'existing customer',
                            'current customer',
                            'been with you',
                            'been with you guys',
                            'been using you',
                            'been using you guys',
                            'use you guys',
                            'you guys have been out',
                            'you came out before',
                            'you were here before',
                            'you installed',
                            'you put in',
                            'you serviced',
                            'you fixed',
                            'you repaired',
                            'worked with you before',
                            'used you before',
                            'called before',
                            'loyal customer',
                            'years ago',
                            'last year',
                            'last time',
                            'previous service'
                        ], 
                        fuzzy: true 
                    },
                    priority: 10,
                    minConfidence: 0.75
                }],
                actions: [
                    // 1. SET_FLAG first
                    {
                        timing: 'on_activate',
                        type: 'set_flag',
                        config: { 
                            flagName: 'returningCustomerClaim', 
                            flagValue: true,
                            alsoWriteToCallLedgerFacts: true
                        }
                    },
                    // 2. APPEND_LEDGER second
                    {
                        timing: 'on_activate',
                        type: 'append_ledger',
                        config: { 
                            type: 'CLAIM', 
                            key: 'RETURNING_CUSTOMER', 
                            note: 'Caller identified as returning/existing customer. Flag set for CRM lookup.' 
                        }
                    },
                    // 3. ACK_ONCE third (NO transition - let booking handle that)
                    {
                        timing: 'on_activate',
                        type: 'ack_once',
                        config: { 
                            text: 'Perfect — thanks for letting me know you\'ve worked with us before.' 
                        }
                    }
                ],
                settings: {
                    allowConcurrent: true,  // Can fire alongside booking_intent
                    persistent: true,
                    reactivatable: false,
                    minConfidence: 0.75
                },
                meta: { createdFromTemplate: true, category: 'core' }
            },
            
            // ─────────────────────────────────────────────────────────────────────
            // 3. ✨ NEW CUSTOMER (Priority 55)
            // ─────────────────────────────────────────────────────────────────────
            // Detects first-time callers, welcomes them warmly
            // ─────────────────────────────────────────────────────────────────────
            {
                _id: 'template-new-customer',
                name: '✨ New Customer Detection',
                description: 'Detects first-time callers. Welcomes them warmly and sets flag for special handling.',
                flowKey: 'new_customer',
                enabled: true,
                priority: 55,
                triggers: [{
                    type: 'phrase',
                    config: { 
                        phrases: [
                            'first time calling',
                            'first time caller',
                            'never called before',
                            'never used you',
                            'new customer',
                            'new here',
                            'first time using',
                            'just found you',
                            'just discovered you',
                            'saw your ad',
                            'found you online',
                            'found you on google',
                            'found you on yelp',
                            'someone recommended',
                            'friend recommended',
                            'neighbor recommended',
                            'family recommended',
                            'got a referral',
                            'was referred',
                            'heard about you'
                        ], 
                        fuzzy: true 
                    },
                    priority: 10,
                    minConfidence: 0.75
                }],
                actions: [
                    // 1. SET_FLAG first
                    {
                        timing: 'on_activate',
                        type: 'set_flag',
                        config: { 
                            flagName: 'newCustomer', 
                            flagValue: true,
                            alsoWriteToCallLedgerFacts: true
                        }
                    },
                    // 2. APPEND_LEDGER second
                    {
                        timing: 'on_activate',
                        type: 'append_ledger',
                        config: { 
                            type: 'CLAIM', 
                            key: 'NEW_CUSTOMER', 
                            note: 'Caller identified as first-time/new customer.' 
                        }
                    },
                    // 3. ACK_ONCE third
                    {
                        timing: 'on_activate',
                        type: 'ack_once',
                        config: { 
                            text: 'Welcome! We\'re glad you reached out. I\'d be happy to help you today.' 
                        }
                    }
                ],
                settings: {
                    allowConcurrent: true,
                    persistent: true,
                    reactivatable: false,
                    minConfidence: 0.75
                },
                meta: { createdFromTemplate: true, category: 'core' }
            },
            
            // ─────────────────────────────────────────────────────────────────────
            // 4. 📅 BOOKING INTENT (Priority 50 - Standard)
            // ─────────────────────────────────────────────────────────────────────
            // The main booking flow - transitions to BOOKING mode
            // ─────────────────────────────────────────────────────────────────────
            {
                _id: 'template-booking-intent',
                name: '📅 Standard Booking Intent',
                description: 'Detects when caller wants to schedule service. Transitions to BOOKING mode.',
                flowKey: 'booking_intent',
                enabled: true,
                priority: 50,
                triggers: [{
                    type: 'phrase',
                    config: { 
                        phrases: [
                            'schedule',
                            'book',
                            'appointment',
                            'schedule an appointment',
                            'book an appointment',
                            'make an appointment',
                            'set up an appointment',
                            'schedule a visit',
                            'schedule service',
                            'book a service',
                            'need someone to come out',
                            'need someone out',
                            'send someone',
                            'send a technician',
                            'send somebody',
                            'come out',
                            'come by',
                            'stop by',
                            'when can you come',
                            'when is the next available',
                            'next available',
                            'get on the schedule',
                            'put me on the schedule',
                            'available today',
                            'available tomorrow',
                            'available this week',
                            'come today',
                            'come tomorrow'
                        ], 
                        fuzzy: true 
                    },
                    priority: 10,
                    minConfidence: 0.75
                }],
                actions: [
                    // 1. APPEND_LEDGER first (no flag needed for booking)
                    {
                        timing: 'on_activate',
                        type: 'append_ledger',
                        config: { 
                            type: 'EVENT', 
                            key: 'BOOKING_INTENT', 
                            note: 'Caller expressed intent to schedule service. Transitioning to BOOKING mode.' 
                        }
                    },
                    // 2. ACK_ONCE second
                    {
                        timing: 'on_activate',
                        type: 'ack_once',
                        config: { 
                            text: 'Got it — I can get that scheduled for you. Let me grab a few details real quick.' 
                        }
                    },
                    // 3. TRANSITION_MODE last
                    {
                        timing: 'on_activate',
                        type: 'transition_mode',
                        config: { 
                            targetMode: 'BOOKING', 
                            setBookingLocked: true 
                        }
                    }
                ],
                settings: {
                    allowConcurrent: true,
                    persistent: true,
                    reactivatable: false,
                    minConfidence: 0.75
                },
                meta: { createdFromTemplate: true, category: 'core' }
            },
            
            // ─────────────────────────────────────────────────────────────────────
            // 5. 💰 QUOTE REQUEST (Priority 45 - Lowest)
            // ─────────────────────────────────────────────────────────────────────
            // Detects pricing inquiries - sets flag, doesn't transition
            // ─────────────────────────────────────────────────────────────────────
            {
                _id: 'template-quote-request',
                name: '💰 Quote/Pricing Request',
                description: 'Detects pricing inquiries. Sets flag and acknowledges - does NOT transition to booking.',
                flowKey: 'quote_request',
                enabled: true,
                priority: 45,
                triggers: [{
                    type: 'phrase',
                    config: { 
                        phrases: [
                            'how much',
                            'how much does',
                            'how much do you charge',
                            'what do you charge',
                            'what does it cost',
                            'what\'s the cost',
                            'what\'s the price',
                            'price for',
                            'cost for',
                            'pricing',
                            'estimate',
                            'quote',
                            'get a quote',
                            'free estimate',
                            'ballpark',
                            'rough idea',
                            'general idea',
                            'rates',
                            'your rates',
                            'service fee',
                            'trip charge',
                            'diagnostic fee',
                            'inspection fee'
                        ], 
                        fuzzy: true 
                    },
                    priority: 10,
                    minConfidence: 0.75
                }],
                actions: [
                    // 1. SET_FLAG first
                    {
                        timing: 'on_activate',
                        type: 'set_flag',
                        config: { 
                            flagName: 'wantsQuote', 
                            flagValue: true,
                            alsoWriteToCallLedgerFacts: true
                        }
                    },
                    // 2. APPEND_LEDGER second
                    {
                        timing: 'on_activate',
                        type: 'append_ledger',
                        config: { 
                            type: 'EVENT', 
                            key: 'QUOTE_REQUEST', 
                            note: 'Caller inquired about pricing. Flag set - awaiting details for accurate quote.' 
                        }
                    },
                    // 3. ACK_ONCE third (NO transition - need more info first)
                    {
                        timing: 'on_activate',
                        type: 'ack_once',
                        config: { 
                            text: 'I can definitely help with pricing. Let me get a few details so I can give you an accurate estimate.' 
                        }
                    }
                ],
                settings: {
                    allowConcurrent: true,
                    persistent: true,
                    reactivatable: false,
                    minConfidence: 0.75
                },
                meta: { createdFromTemplate: true, category: 'sales' }
            },
            
            // ─────────────────────────────────────────────────────────────────────
            // 6. ❌ CANCELLATION REQUEST (Priority 100)
            // ─────────────────────────────────────────────────────────────────────
            // High priority - caller wants to cancel existing appointment
            // ─────────────────────────────────────────────────────────────────────
            {
                _id: 'template-cancellation',
                name: '❌ Cancellation Request',
                description: 'Detects when caller wants to cancel an existing appointment. High priority handling.',
                flowKey: 'cancellation_request',
                enabled: true,
                priority: 100,
                triggers: [{
                    type: 'phrase',
                    config: { 
                        phrases: [
                            'cancel',
                            'cancel my appointment',
                            'cancel the appointment',
                            'cancel service',
                            'need to cancel',
                            'want to cancel',
                            'have to cancel',
                            'cancellation',
                            'cancel that',
                            'don\'t need you to come',
                            'don\'t come',
                            'not going to be home',
                            'won\'t be there',
                            'can\'t make it',
                            'something came up',
                            'plans changed'
                        ], 
                        fuzzy: true 
                    },
                    priority: 10,
                    minConfidence: 0.75
                }],
                actions: [
                    // 1. SET_FLAG first
                    {
                        timing: 'on_activate',
                        type: 'set_flag',
                        config: { 
                            flagName: 'wantsCancellation', 
                            flagValue: true,
                            alsoWriteToCallLedgerFacts: true
                        }
                    },
                    // 2. APPEND_LEDGER second
                    {
                        timing: 'on_activate',
                        type: 'append_ledger',
                        config: { 
                            type: 'EVENT', 
                            key: 'CANCELLATION_REQUEST', 
                            note: 'Caller requested to cancel existing appointment.' 
                        }
                    },
                    // 3. ACK_ONCE third
                    {
                        timing: 'on_activate',
                        type: 'ack_once',
                        config: { 
                            text: 'No problem — I can help you with that cancellation. Let me look up your appointment.' 
                        }
                    }
                ],
                settings: {
                    allowConcurrent: false,  // Don't mix with booking
                    persistent: true,
                    reactivatable: false,
                    minConfidence: 0.75
                },
                meta: { createdFromTemplate: true, category: 'service' }
            },
            
            // ─────────────────────────────────────────────────────────────────────
            // 7. 📆 RESCHEDULE REQUEST (Priority 90)
            // ─────────────────────────────────────────────────────────────────────
            // Caller wants to reschedule, not cancel
            // ─────────────────────────────────────────────────────────────────────
            {
                _id: 'template-reschedule',
                name: '📆 Reschedule Request',
                description: 'Detects when caller wants to reschedule an existing appointment.',
                flowKey: 'reschedule_request',
                enabled: true,
                priority: 90,
                triggers: [{
                    type: 'phrase',
                    config: { 
                        phrases: [
                            'reschedule',
                            'reschedule my appointment',
                            'change my appointment',
                            'move my appointment',
                            'different time',
                            'different day',
                            'change the time',
                            'change the date',
                            'push it back',
                            'move it up',
                            'earlier time',
                            'later time',
                            'next week instead',
                            'another day'
                        ], 
                        fuzzy: true 
                    },
                    priority: 10,
                    minConfidence: 0.75
                }],
                actions: [
                    // 1. SET_FLAG first
                    {
                        timing: 'on_activate',
                        type: 'set_flag',
                        config: { 
                            flagName: 'wantsReschedule', 
                            flagValue: true,
                            alsoWriteToCallLedgerFacts: true
                        }
                    },
                    // 2. APPEND_LEDGER second
                    {
                        timing: 'on_activate',
                        type: 'append_ledger',
                        config: { 
                            type: 'EVENT', 
                            key: 'RESCHEDULE_REQUEST', 
                            note: 'Caller requested to reschedule existing appointment.' 
                        }
                    },
                    // 3. ACK_ONCE third
                    {
                        timing: 'on_activate',
                        type: 'ack_once',
                        config: { 
                            text: 'Sure thing — let me help you find a better time. What works for you?' 
                        }
                    }
                ],
                settings: {
                    allowConcurrent: false,
                    persistent: true,
                    reactivatable: false,
                    minConfidence: 0.75
                },
                meta: { createdFromTemplate: true, category: 'service' }
            }
        ];
    }
    
    attachFlowEventListeners(container) {
        // Toggle buttons
        container.querySelectorAll('.flow-toggle-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const flowId = btn.dataset.flowId;
                const currentEnabled = btn.dataset.enabled === 'true';
                await this.toggleFlow(flowId, !currentEnabled);
                await this.refreshFlowsList(container);
            });
        });
        
        // Copy template buttons
        container.querySelectorAll('.flow-copy-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const templateId = btn.dataset.flowId;
                await this.copyTemplateToCompany(templateId);
                await this.refreshFlowsList(container);
            });
        });
        
        // Delete buttons
        container.querySelectorAll('.flow-delete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const flowId = btn.dataset.flowId;
                if (confirm('Delete this flow? This cannot be undone.')) {
                    await this.deleteFlow(flowId);
                    await this.refreshFlowsList(container);
                }
            });
        });
        
        // Edit buttons - Open modal editor
        container.querySelectorAll('.flow-edit-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const flowId = btn.dataset.flowId;
                await this.openFlowEditor(flowId, container);
            });
        });
        
        // Add flow button
        const addBtn = container.querySelector('#fdb-add-flow-btn');
        if (addBtn) {
            addBtn.addEventListener('click', async () => {
                await this.openFlowEditor(null, container); // null = new flow
            });
        }
        
        // Seed templates button (Admin only)
        const seedBtn = container.querySelector('#fdb-seed-templates-btn');
        if (seedBtn) {
            seedBtn.addEventListener('click', async () => {
                seedBtn.disabled = true;
                seedBtn.textContent = '⏳ Seeding...';
                
                try {
                    const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
                    const response = await fetch('/api/admin/dynamic-flows/seed-templates', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (!response.ok) {
                        const err = await response.json();
                        throw new Error(err.error || 'Failed to seed templates');
                    }
                    
                    const data = await response.json();
                    console.log('[DYNAMIC FLOWS] Seed result:', data);
                    
                    this.showNotification(
                        `✅ Templates seeded! Created: ${data.results.created.length}, Updated: ${data.results.updated.length}`,
                        'success'
                    );
                    
                    // Reload the dynamic flows tab to show new templates
                    await this.refreshFlowsList(container);
                    
                } catch (error) {
                    console.error('[DYNAMIC FLOWS] Seed error:', error);
                    this.showNotification(error.message, 'error');
                } finally {
                    seedBtn.disabled = false;
                    seedBtn.textContent = '🌱 Seed Templates';
                }
            });
        }
    }
    
    async toggleFlow(flowId, enabled) {
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const response = await fetch(`/api/company/${this.companyId}/dynamic-flows/${flowId}/toggle`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ enabled })
            });
            
            if (!response.ok) throw new Error('Failed to toggle flow');
            
            this.showNotification(`Flow ${enabled ? 'enabled' : 'disabled'}`, 'success');
        } catch (error) {
            console.error('[DYNAMIC FLOWS] Toggle error:', error);
            this.showNotification('Failed to toggle flow', 'error');
        }
    }
    
    async copyTemplateToCompany(templateId) {
        try {
            // Handle local V1 sample templates (not persisted)
            const sample = this.getV1SampleFlows().find(t => t._id === templateId);
            if (sample) {
                console.log('[DYNAMIC FLOWS] Copying V1 sample template:', templateId);
                console.log('[DYNAMIC FLOWS] Template actions:', JSON.stringify(sample.actions, null, 2));
                
                const payload = { ...sample, _id: undefined, isTemplate: false };
                console.log('[DYNAMIC FLOWS] POST payload:', JSON.stringify(payload, null, 2));
                
                const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
                const createResp = await fetch(`/api/company/${this.companyId}/dynamic-flows`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                if (!createResp.ok) {
                    const err = await createResp.json();
                    throw new Error(err.error || 'Failed to create sample flow');
                }
                const result = await createResp.json();
                console.log('[DYNAMIC FLOWS] Created flow:', JSON.stringify(result, null, 2));
                this.showNotification('Sample flow created for company!', 'success');
                return;
            }

            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const response = await fetch(`/api/company/${this.companyId}/dynamic-flows/from-template`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ templateId })
            });
            
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to copy template');
            }
            
            this.showNotification('Template copied to company!', 'success');
        } catch (error) {
            console.error('[DYNAMIC FLOWS] Copy error:', error);
            this.showNotification(error.message, 'error');
        }
    }
    
    async deleteFlow(flowId) {
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const response = await fetch(`/api/company/${this.companyId}/dynamic-flows/${flowId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) throw new Error('Failed to delete flow');
            
            this.showNotification('Flow deleted', 'success');
        } catch (error) {
            console.error('[DYNAMIC FLOWS] Delete error:', error);
            this.showNotification('Failed to delete flow', 'error');
        }
    }
    
    // Placeholder (custom fields disabled for V1)
    renderCustomFieldsTable() {
        return `
            <div style="text-align: center; padding: 12px; color: #6e7681; font-size: 12px;">
                Custom fields / unified needs are parked for V1. Focus on triggers, ack, flags, mode.
            </div>
        `;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // 🧠 DYNAMIC FLOW EDITOR MODAL
    // ═══════════════════════════════════════════════════════════════════════════
    
    async openFlowEditor(flowId, container) {
        let flow = null;
        
        // Load existing flow if editing
        if (flowId) {
            // First check if this is a local V1 sample template
            const sampleTemplates = this.getV1SampleFlows();
            const sampleMatch = sampleTemplates.find(t => t._id === flowId);
            
            if (sampleMatch) {
                // Use the sample template data directly (it's local, not in DB)
                flow = { ...sampleMatch };
                console.log('[FLOW EDITOR] Loaded V1 sample template:', flowId);
            } else {
                // Try to load from API (DB-persisted flows)
                try {
                    const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
                    const response = await fetch(`/api/company/${this.companyId}/dynamic-flows/${flowId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (response.ok) {
                        const data = await response.json();
                        flow = data.flow;
                    }
                } catch (err) {
                    console.error('[FLOW EDITOR] Load error:', err);
                }
            }
        }
        
        // Default empty flow structure
        const defaultFlow = {
            name: '',
            description: '',
            flowKey: '',
            enabled: true,
            priority: 50,
            triggers: [{ type: 'phrase', config: { phrases: [], fuzzy: true }, priority: 10 }],
            requirements: [],
            customFields: [], // Flow-owned custom fields (clientId, gateCode, etc.)
            actions: [{ timing: 'on_activate', type: 'transition_mode', config: { targetMode: 'BOOKING' } }],
            settings: {
                allowConcurrent: true,
                minConfidence: 0.7,
                persistent: true,
                reactivatable: false
            }
        };
        
        const editFlow = flow || defaultFlow;
        const isNew = !flowId;
        
        // Create modal
        const modal = document.createElement('div');
        modal.id = 'flow-editor-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.8);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        `;
        
        modal.innerHTML = `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 12px; width: 100%; max-width: 800px; max-height: 90vh; overflow-y: auto;">
                <!-- Header -->
                <div style="padding: 20px; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center;">
                    <h2 style="margin: 0; color: #c9d1d9;">🧠 ${isNew ? 'Create New Flow' : 'Edit Flow'}</h2>
                    <button id="flow-editor-close" style="background: none; border: none; color: #8b949e; font-size: 24px; cursor: pointer;">✕</button>
                </div>
                
                <!-- Body -->
                <div style="padding: 20px;">
                    <!-- Basic Info -->
                    <div style="margin-bottom: 24px;">
                        <h3 style="color: #58a6ff; margin: 0 0 16px 0; font-size: 14px;">📋 Basic Information</h3>
                        
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                            <div>
                                <label style="color: #8b949e; font-size: 12px; display: block; margin-bottom: 6px;">Flow Name *</label>
                                <input type="text" id="flow-name" value="${editFlow.name || ''}" placeholder="e.g., Emergency Service Detection" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px;">
                            </div>
                            <div>
                                <label style="color: #8b949e; font-size: 12px; display: block; margin-bottom: 6px;">Flow Key * (lowercase, no spaces)</label>
                                <input type="text" id="flow-key" value="${editFlow.flowKey || ''}" placeholder="e.g., emergency_service" ${!isNew ? 'disabled' : ''} style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px; ${!isNew ? 'opacity: 0.6;' : ''}">
                            </div>
                        </div>
                        
                        <div style="margin-top: 12px;">
                            <label style="color: #8b949e; font-size: 12px; display: block; margin-bottom: 6px;">Description</label>
                            <textarea id="flow-description" placeholder="What does this flow do?" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px; min-height: 60px; resize: vertical;">${editFlow.description || ''}</textarea>
                        </div>
                        
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px;">
                            <div>
                                <label style="color: #8b949e; font-size: 12px; display: block; margin-bottom: 6px;">Priority (higher = evaluated first)</label>
                                <input type="number" id="flow-priority" value="${editFlow.priority || 50}" min="0" max="1000" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px;">
                            </div>
                            <div>
                                <label style="color: #8b949e; font-size: 12px; display: block; margin-bottom: 6px;">Status</label>
                                <select id="flow-enabled" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px;">
                                    <option value="true" ${editFlow.enabled ? 'selected' : ''}>✅ Enabled</option>
                                    <option value="false" ${!editFlow.enabled ? 'selected' : ''}>⏸️ Disabled</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Triggers -->
                    <div style="margin-bottom: 24px;">
                        <h3 style="color: #58a6ff; margin: 0 0 16px 0; font-size: 14px;">🎯 Triggers (when to activate this flow)</h3>
                        
                        <div style="background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 16px;">
                            <div style="margin-bottom: 12px;">
                                <label style="color: #8b949e; font-size: 12px; display: block; margin-bottom: 6px;">Trigger Type</label>
                                <select id="flow-trigger-type" style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px;">
                                    <option value="phrase" ${editFlow.triggers?.[0]?.type === 'phrase' ? 'selected' : ''}>📝 Phrase Match (fuzzy)</option>
                                    <option value="keyword" ${editFlow.triggers?.[0]?.type === 'keyword' ? 'selected' : ''}>🔑 Keyword Match</option>
                                    <option value="regex" ${editFlow.triggers?.[0]?.type === 'regex' ? 'selected' : ''}>🔧 Regex Pattern</option>
                                </select>
                            </div>
                            
                            <div>
                                <label style="color: #8b949e; font-size: 12px; display: block; margin-bottom: 6px;">Trigger Phrases/Keywords (one per line)</label>
                                <textarea id="flow-trigger-phrases" placeholder="schedule an appointment&#10;book a visit&#10;need someone to come out" style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px; min-height: 100px; resize: vertical; font-family: monospace;">${(editFlow.triggers?.[0]?.config?.phrases || editFlow.triggers?.[0]?.config?.keywords || []).join('\n')}</textarea>
                            </div>
                            
                            <div style="margin-top: 12px;">
                                <label style="display: flex; align-items: center; gap: 8px; color: #8b949e; font-size: 12px; cursor: pointer;">
                                    <input type="checkbox" id="flow-trigger-fuzzy" ${editFlow.triggers?.[0]?.config?.fuzzy !== false ? 'checked' : ''} style="accent-color: #58a6ff;">
                                    Fuzzy matching (contains vs exact)
                                </label>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Actions -->
                    <div style="margin-bottom: 24px;">
                        <h3 style="color: #58a6ff; margin: 0 0 16px 0; font-size: 14px;">⚡ Actions (what to do when triggered)</h3>
                        
                        <div style="background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 16px;">
                            <div style="margin-bottom: 12px;">
                                <label style="color: #8b949e; font-size: 12px; display: block; margin-bottom: 6px;">Primary Action</label>
                                <select id="flow-action-type" style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px;">
                                    <option value="transition_mode" ${editFlow.actions?.[0]?.type === 'transition_mode' ? 'selected' : ''}>🔄 Transition Mode</option>
                                    <option value="ack_once" ${editFlow.actions?.[0]?.type === 'ack_once' ? 'selected' : ''}>💬 Ack Once</option>
                                    <option value="set_flag" ${editFlow.actions?.[0]?.type === 'set_flag' ? 'selected' : ''}>🚩 Set Flag</option>
                                    <option value="append_ledger" ${editFlow.actions?.[0]?.type === 'append_ledger' ? 'selected' : ''}>📜 Append Ledger</option>
                                </select>
                            </div>
                            
                            <!-- Mode transition config -->
                            <div id="action-config-transition" style="${editFlow.actions?.[0]?.type === 'transition_mode' || !editFlow.actions?.[0]?.type ? '' : 'display: none;'}">
                                <label style="color: #8b949e; font-size: 12px; display: block; margin-bottom: 6px;">Target Mode</label>
                                <select id="flow-action-mode" style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px;">
                                    <option value="BOOKING" ${editFlow.actions?.[0]?.config?.targetMode === 'BOOKING' ? 'selected' : ''}>📅 BOOKING</option>
                                    <option value="DISCOVERY" ${editFlow.actions?.[0]?.config?.targetMode === 'DISCOVERY' ? 'selected' : ''}>🔍 DISCOVERY</option>
                                    <option value="COMPLETE" ${editFlow.actions?.[0]?.config?.targetMode === 'COMPLETE' ? 'selected' : ''}>✅ COMPLETE</option>
                                    <option value="TRANSFER" ${editFlow.actions?.[0]?.config?.targetMode === 'TRANSFER' ? 'selected' : ''}>📞 TRANSFER</option>
                                </select>
                            </div>
                            
                            <!-- Flag config -->
                            <div id="action-config-flag" style="${editFlow.actions?.[0]?.type === 'set_flag' ? '' : 'display: none;'}">
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                                    <div>
                                        <label style="color: #8b949e; font-size: 12px; display: block; margin-bottom: 6px;">Flag Name</label>
                                        <input type="text" id="flow-action-flag-name" value="${editFlow.actions?.[0]?.config?.flagName || ''}" placeholder="e.g., isEmergency" style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px;">
                                    </div>
                                    <div>
                                        <label style="color: #8b949e; font-size: 12px; display: block; margin-bottom: 6px;">Flag Value</label>
                                        <input type="text" id="flow-action-flag-value" value="${editFlow.actions?.[0]?.config?.flagValue || 'true'}" placeholder="true" style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px;">
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Response config -->
                            <div id="action-config-response" style="${editFlow.actions?.[0]?.type === 'ack_once' ? '' : 'display: none;'}">
                                <label style="color: #8b949e; font-size: 12px; display: block; margin-bottom: 6px;">Ack Text (once)</label>
                                <textarea id="flow-action-response" placeholder="Got it — I can get that scheduled. I’ll grab a few details real quick." style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px; min-height: 60px; resize: vertical;">${editFlow.actions?.[0]?.config?.text || ''}</textarea>
                            </div>

                            <!-- Ledger config -->
                            <div id="action-config-ledger" style="${editFlow.actions?.[0]?.type === 'append_ledger' ? '' : 'display: none;'}">
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px;">
                                    <div>
                                        <label style="color: #8b949e; font-size: 12px; display: block; margin-bottom: 6px;">Ledger Type</label>
                                        <input type="text" id="flow-ledger-type" value="${editFlow.actions?.[0]?.config?.type || ''}" placeholder="EVENT" style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px;">
                                    </div>
                                    <div>
                                        <label style="color: #8b949e; font-size: 12px; display: block; margin-bottom: 6px;">Ledger Key</label>
                                        <input type="text" id="flow-ledger-key" value="${editFlow.actions?.[0]?.config?.key || ''}" placeholder="BOOKING_INTENT" style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px;">
                                    </div>
                                </div>
                                <label style="color: #8b949e; font-size: 12px; display: block; margin-bottom: 6px;">Note</label>
                                <textarea id="flow-ledger-note" placeholder="Caller expressed intent to schedule service." style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px; min-height: 60px; resize: vertical;">${editFlow.actions?.[0]?.config?.note || ''}</textarea>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Requirements (hidden in V1 to avoid second booking system) -->
                    <div style="margin-bottom: 24px; display: none;">
                        <h3 style="color: #58a6ff; margin: 0 0 8px 0; font-size: 14px;">📋 Requirements</h3>
                        <div style="color: #6e7681; font-size: 12px;">Requirements/custom fields are parked for V1. Booking engine owns slot prompts.</div>
                    </div>
                    
                    <!-- Settings -->
                    <div style="margin-bottom: 24px;">
                        <h3 style="color: #58a6ff; margin: 0 0 16px 0; font-size: 14px;">⚙️ Settings</h3>
                        
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                            <label style="display: flex; align-items: center; gap: 8px; padding: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #8b949e; font-size: 12px; cursor: pointer;">
                                <input type="checkbox" id="flow-allow-concurrent" ${editFlow.settings?.allowConcurrent !== false ? 'checked' : ''} style="accent-color: #58a6ff;">
                                Allow concurrent with other flows
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; padding: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #8b949e; font-size: 12px; cursor: pointer;">
                                <input type="checkbox" id="flow-persistent" ${editFlow.settings?.persistent !== false ? 'checked' : ''} style="accent-color: #58a6ff;">
                                Persistent across turns
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; padding: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #8b949e; font-size: 12px; cursor: pointer;">
                                <input type="checkbox" id="flow-reactivatable" ${editFlow.settings?.reactivatable ? 'checked' : ''} style="accent-color: #58a6ff;">
                                Can re-activate after completing
                            </label>
                            <div style="padding: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px;">
                                <label style="color: #8b949e; font-size: 12px; display: block; margin-bottom: 6px;">Min Confidence (0-1)</label>
                                <input type="number" id="flow-min-confidence" value="${editFlow.settings?.minConfidence || 0.7}" min="0" max="1" step="0.05" style="width: 100%; padding: 6px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px;">
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Footer -->
                <div style="padding: 20px; border-top: 1px solid #30363d; display: flex; justify-content: flex-end; gap: 12px;">
                    <button id="flow-editor-cancel" style="padding: 10px 20px; background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px; cursor: pointer; font-size: 14px;">Cancel</button>
                    <button id="flow-editor-copy-json" style="padding: 10px 20px; background: #30363d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px; cursor: pointer; font-size: 14px;">📋 Copy JSON</button>
                    <button id="flow-editor-save" style="padding: 10px 20px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;">💾 ${isNew ? 'Create Flow' : 'Save Changes'}</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Action type toggle
        const actionTypeSelect = modal.querySelector('#flow-action-type');
        actionTypeSelect.addEventListener('change', () => {
            modal.querySelector('#action-config-transition').style.display = actionTypeSelect.value === 'transition_mode' ? '' : 'none';
            modal.querySelector('#action-config-flag').style.display = actionTypeSelect.value === 'set_flag' ? '' : 'none';
            modal.querySelector('#action-config-response').style.display = actionTypeSelect.value === 'ack_once' ? '' : 'none';
            modal.querySelector('#action-config-ledger').style.display = actionTypeSelect.value === 'append_ledger' ? '' : 'none';
        });
        
        // ═══════════════════════════════════════════════════════════════════════════
        // Custom Fields Table Handlers
        // ═══════════════════════════════════════════════════════════════════════════
        
        // Track custom fields in memory
        let customFieldsData = [...(editFlow.customFields || [])];
        
        // Re-render the custom fields table
        const rerenderCustomFields = () => {
            const container = modal.querySelector('#flow-custom-fields-container');
            if (container) {
                container.innerHTML = this.renderCustomFieldsTable(customFieldsData);
                attachCustomFieldDeleteHandlers();
            }
        };
        
        // Attach delete handlers to all delete buttons
        const attachCustomFieldDeleteHandlers = () => {
            modal.querySelectorAll('.custom-field-delete').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.idx);
                    customFieldsData.splice(idx, 1);
                    rerenderCustomFields();
                });
            });
        };
        
        // Add Field button
        const addFieldBtn = modal.querySelector('#flow-add-custom-field');
        if (addFieldBtn) {
            addFieldBtn.addEventListener('click', () => {
                // Collect current values from table before adding
                customFieldsData = this.collectCustomFieldsFromTable(modal);
                // Add new empty field
                customFieldsData.push({
                    fieldKey: '',
                    label: '',
                    prompt: '',
                    order: 25,
                    required: true,
                    validation: { type: 'text' }
                });
                rerenderCustomFields();
            });
        }
        
        // Initial attach of delete handlers
        attachCustomFieldDeleteHandlers();
        
        // Close handlers
        const closeModal = () => modal.remove();
        modal.querySelector('#flow-editor-close').addEventListener('click', closeModal);
        modal.querySelector('#flow-editor-cancel').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

        // Copy JSON handler (uses normalized payload)
        // Pass editFlow so we can include ALL actions (not just the single dropdown selection)
        // FALLBACK: If editFlow is broken/incomplete but matches a sample template's flowKey, use template data
        const copyBtn = modal.querySelector('#flow-editor-copy-json');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                let effectiveEditFlow = editFlow;
                
                // Check if this flow matches a sample template and should use template data
                if (editFlow?.flowKey) {
                    const sampleTemplates = this.getV1SampleFlows();
                    const matchingTemplate = sampleTemplates.find(t => t.flowKey === editFlow.flowKey);
                    
                    if (matchingTemplate) {
                        // Check for broken/incomplete company flow:
                        // 1. Empty trigger phrases
                        const hasTriggerPhrases = editFlow.triggers?.[0]?.config?.phrases?.length > 0;
                        // 2. Missing required actions (should have at least ack_once or append_ledger)
                        const hasAckOnce = editFlow.actions?.some(a => a.type === 'ack_once' && a.config?.text);
                        const hasAppendLedger = editFlow.actions?.some(a => a.type === 'append_ledger' && a.config?.type);
                        // 3. Empty action configs
                        const hasEmptyConfigs = editFlow.actions?.some(a => {
                            const cfg = a.config || {};
                            return (a.type === 'set_flag' && !cfg.flagName) ||
                                   (a.type === 'ack_once' && !cfg.text) ||
                                   (a.type === 'append_ledger' && !cfg.type && !cfg.key);
                        });
                        
                        const isBroken = !hasTriggerPhrases || !hasAckOnce || !hasAppendLedger || hasEmptyConfigs;
                        
                        if (isBroken) {
                            console.log('[COPY JSON] ⚠️ Company flow is broken/incomplete, using FULL sample template for:', editFlow.flowKey);
                            console.log('[COPY JSON] Issues detected:', {
                                hasTriggerPhrases,
                                hasAckOnce,
                                hasAppendLedger,
                                hasEmptyConfigs
                            });
                            // Use the ENTIRE template (triggers + actions + settings)
                            effectiveEditFlow = {
                                ...editFlow,
                                triggers: matchingTemplate.triggers,
                                actions: matchingTemplate.actions,
                                settings: { ...editFlow.settings, ...matchingTemplate.settings }
                            };
                        }
                    }
                }
                
                const flowPayload = this.buildFlowPayloadFromModal(modal, isNew, { forCopy: true, editFlow: effectiveEditFlow });
                if (!flowPayload) return;
                navigator.clipboard.writeText(JSON.stringify(flowPayload, null, 2))
                    .then(() => this.showNotification('Flow JSON copied (using template data)', 'success'))
                    .catch(() => this.showNotification('Copy failed', 'error'));
            });
        }
        
        // Save handler
        modal.querySelector('#flow-editor-save').addEventListener('click', async () => {
            const flowData = this.buildFlowPayloadFromModal(modal, isNew, { forCopy: false });
            if (!flowData) return;
            
            // Save
            try {
                const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
                const url = isNew 
                    ? `/api/company/${this.companyId}/dynamic-flows`
                    : `/api/company/${this.companyId}/dynamic-flows/${flowId}`;
                const method = isNew ? 'POST' : 'PUT';
                
                const response = await fetch(url, {
                    method,
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(flowData)
                });
                
                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || 'Failed to save flow');
                }
                
                this.showNotification(isNew ? 'Flow created!' : 'Flow updated!', 'success');
                closeModal();
                await this.refreshFlowsList(container);
                
            } catch (error) {
                console.error('[FLOW EDITOR] Save error:', error);
                this.showNotification(error.message, 'error');
            }
        });
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
                
                ${this.renderFastPathSection()}
            </div>
        `;
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // 🚀 FAST-PATH BOOKING SECTION
    // ════════════════════════════════════════════════════════════════════════════
    // When caller clearly wants service NOW, skip troubleshooting and offer booking.
    // Does NOT auto-switch to BOOKING - still requires explicit consent.
    // ════════════════════════════════════════════════════════════════════════════
    renderFastPathSection() {
        const fp = this.config.fastPathBooking || {};
        const enabled = fp.enabled !== false;
        const keywords = (fp.triggerKeywords || [
            // Direct booking requests (with need/want variations)
            "send someone", "send somebody", 
            "get someone out", "get somebody out",
            "need you out", "need someone out", "need somebody out",
            "want someone out", "want somebody out", "want you out",
            "come out", "come out here", "come today",
            "schedule", "book", "appointment", "technician",
            // Frustration / done troubleshooting
            "fix it", "just fix it", "just want it fixed",
            "sick of it", "sick of this", "I don't care",
            // Urgency
            "need service", "need help now", "asap", "emergency", "urgent",
            // Refusal to continue discovery
            "I'm done", "just get someone", "just get somebody"
        ]).join(', ');
        const offerScript = fp.offerScript || "Got it — I completely understand. We can get someone out to you. Would you like me to schedule a technician now?";
        const oneQuestionScript = fp.oneQuestionScript || "";
        const maxQuestions = fp.maxDiscoveryQuestions || 2;
        
        return `
            <!-- Fast-Path Booking -->
            <div style="background: #0d1117; border: 1px solid #58a6ff; border-radius: 8px; padding: 16px; margin-top: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <h4 style="margin: 0; color: #58a6ff;">🚀 Fast-Path Booking (Respect Caller Urgency)</h4>
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" id="fdb-fp-enabled" ${enabled ? 'checked' : ''} 
                            onchange="window.frontDeskManager.toggleFastPathFields(this.checked)"
                            style="accent-color: #58a6ff; width: 18px; height: 18px;">
                        <span style="color: #c9d1d9; font-weight: 600;">${enabled ? 'Enabled' : 'Disabled'}</span>
                    </label>
                </div>
                
                <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 16px;">
                    When caller says "I need you out here" or "just fix it", skip troubleshooting and offer scheduling immediately.
                    <br><strong>Note:</strong> This does NOT auto-book. Caller must still say "yes" to enter booking mode.
                </p>
                
                <div id="fdb-fp-fields" style="display: ${enabled ? 'block' : 'none'};">
                    <!-- Trigger Keywords -->
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                            Trigger Keywords <span style="color: #8b949e; font-weight: normal;">(comma-separated)</span>
                        </label>
                        <textarea id="fdb-fp-keywords" rows="3"
                            placeholder="send someone, need you out here, fix it, sick of it, asap..."
                            style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.85rem; resize: vertical;">${keywords}</textarea>
                        <p style="color: #6e7681; font-size: 0.7rem; margin-top: 4px;">
                            If caller uses any of these phrases, fast-path activates.
                        </p>
                    </div>
                    
                    <!-- Offer Script -->
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                            Offer Script <span style="color: #f85149;">*</span>
                        </label>
                        <textarea id="fdb-fp-offerScript" rows="2"
                            placeholder="Got it — I completely understand. We can get someone out to you. Would you like me to schedule a technician now?"
                            style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.85rem; resize: vertical;">${offerScript}</textarea>
                        <p style="color: #6e7681; font-size: 0.7rem; margin-top: 4px;">
                            What AI says when fast-path triggers. Must include a scheduling offer + question.
                        </p>
                    </div>
                    
                    <!-- Optional Pre-Question -->
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                            Pre-Offer Question <span style="color: #8b949e; font-weight: normal;">(optional)</span>
                        </label>
                        <input type="text" id="fdb-fp-oneQuestion" value="${oneQuestionScript}"
                            placeholder="e.g., Just to help the tech prepare, is the unit completely off or running but not cooling?"
                            style="width: 100%; padding: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.85rem;">
                        <p style="color: #6e7681; font-size: 0.7rem; margin-top: 4px;">
                            One quick question before offering (helps tech prepare). Leave empty to skip straight to offer.
                        </p>
                    </div>
                    
                    <!-- Max Questions -->
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                            Max Discovery Questions Before Offer
                        </label>
                        <select id="fdb-fp-maxQuestions" 
                            style="padding: 8px 12px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                            <option value="1" ${maxQuestions === 1 ? 'selected' : ''}>1 question</option>
                            <option value="2" ${maxQuestions === 2 ? 'selected' : ''}>2 questions (default)</option>
                            <option value="3" ${maxQuestions === 3 ? 'selected' : ''}>3 questions</option>
                            <option value="5" ${maxQuestions === 5 ? 'selected' : ''}>5 questions</option>
                        </select>
                        <p style="color: #6e7681; font-size: 0.7rem; margin-top: 4px;">
                            If urgency detected, offer scheduling after this many questions max.
                        </p>
                    </div>
                </div>
            </div>
        `;
    }
    
    toggleFastPathFields(enabled) {
        const fields = document.getElementById('fdb-fp-fields');
        if (fields) {
            fields.style.display = enabled ? 'block' : 'none';
        }
        this.isDirty = true;
    }
    
    toggleCallerVocabularyFields(enabled) {
        const fields = document.getElementById('fdb-cv-fields');
        if (fields) {
            fields.style.display = enabled ? 'block' : 'none';
        }
        this.isDirty = true;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V36: CALLER VOCABULARY - 2-Column Table with Inherited + Custom Synonyms
    // ═══════════════════════════════════════════════════════════════════════════
    
    renderInheritedSynonyms() {
        // Get inherited synonyms from template - stored as { technical: [colloquials] }
        const templateSynonyms = this.config.inheritedSynonymsRaw || {};
        const entries = Object.entries(templateSynonyms);
        const templateName = this.config.activeTemplateName || 'No Template';
        
        // Empty state
        if (entries.length === 0) {
            return `
                <div style="padding: 30px 20px; text-align: center;">
                    <div style="font-size: 1.5rem; margin-bottom: 8px; opacity: 0.4;">📚</div>
                    <p style="color: #6e7681; margin: 0; font-size: 0.8rem;">No inherited synonyms from template</p>
                    <p style="color: #484f58; margin: 4px 0 0 0; font-size: 0.7rem;">Select an AiCore template with synonyms configured</p>
                </div>
            `;
        }
        
        // Render cards like Global AI Brain
        const cards = entries.map(([technical, colloquials]) => {
            const terms = Array.isArray(colloquials) ? colloquials : [];
            const termBadges = terms.map(t => 
                `<span style="display: inline-block; padding: 4px 10px; background: #238636; color: white; border-radius: 4px; font-size: 0.8rem; margin: 2px;">${this.escapeHtml(t)}</span>`
            ).join('');
            
            return `
                <div style="background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 12px; margin-bottom: 8px;">
                    <div style="margin-bottom: 8px;">
                        <span style="color: #8b949e; font-size: 0.75rem;">Technical Term:</span>
                        <span style="color: #58a6ff; font-weight: 600; font-size: 0.95rem; margin-left: 8px;">${this.escapeHtml(technical)}</span>
                    </div>
                    <div>
                        <span style="color: #8b949e; font-size: 0.75rem;">Colloquial Terms (${terms.length}):</span>
                        <div style="margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px;">
                            ${termBadges || '<span style="color: #484f58; font-size: 0.8rem; font-style: italic;">None</span>'}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        return `
            <!-- Scrollable Cards Container -->
            <div style="max-height: 250px; overflow-y: auto; padding: 8px;">
                ${cards}
            </div>
            <!-- Footer with count and template name -->
            <div style="padding: 8px 16px; background: #21262d; border-top: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center;">
                <span style="color: #6e7681; font-size: 0.75rem;">${entries.length} mapping${entries.length !== 1 ? 's' : ''} • ${entries.reduce((sum, [_, terms]) => sum + (Array.isArray(terms) ? terms.length : 0), 0)} total terms</span>
                <span style="color: #3fb950; font-size: 0.75rem;">📦 ${this.escapeHtml(templateName)}</span>
            </div>
        `;
    }
    
    renderSynonymRows() {
        // Initialize synonyms array if not exists
        if (!this.config.callerVocabularySynonyms) {
            // Convert from old synonymMap format
            const oldMap = this.config.callerVocabulary?.synonymMap || {};
            this.config.callerVocabularySynonyms = Object.entries(oldMap).map(([slang, meaning]) => ({
                slang: slang,
                meaning: meaning
            }));
            console.log('[FRONT DESK] 🔤 Migrated synonymMap to callerVocabularySynonyms:', this.config.callerVocabularySynonyms.length);
        }
        
        const synonyms = this.config.callerVocabularySynonyms || [];
        
        if (synonyms.length === 0) {
            return `
                <div style="padding: 30px 20px; text-align: center;">
                    <div style="font-size: 1.5rem; margin-bottom: 8px; opacity: 0.5;">🔧</div>
                    <p style="color: #8b949e; margin: 0 0 4px 0; font-size: 0.85rem;">No company-specific synonyms</p>
                    <p style="color: #6e7681; margin: 0; font-size: 0.75rem;">Click "Add Synonym" to add custom slang translations</p>
                </div>
            `;
        }
        
        // Scrollable container for rows
        return `
            <div style="max-height: 200px; overflow-y: auto;">
                ${synonyms.map((s, idx) => `
                    <div class="synonym-row" data-idx="${idx}" style="display: grid; grid-template-columns: 1fr 1fr 50px; border-bottom: 1px solid #30363d; transition: background 0.15s;">
                        <!-- Column 1: Caller Slang -->
                        <div style="padding: 10px 16px;">
                            <input type="text" 
                                class="synonym-slang" 
                                value="${this.escapeHtml(s.slang || '')}" 
                                placeholder="e.g., pulling, froze up..."
                                onchange="window.frontDeskManager.updateSynonymRow(${idx}, 'slang', this.value)"
                                style="width: 100%; padding: 8px 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.85rem;">
                        </div>
                        
                        <!-- Column 2: Standard Meaning -->
                        <div style="padding: 10px 16px;">
                            <input type="text" 
                                class="synonym-meaning" 
                                value="${this.escapeHtml(s.meaning || '')}" 
                                placeholder="e.g., cooling, frozen coils..."
                                onchange="window.frontDeskManager.updateSynonymRow(${idx}, 'meaning', this.value)"
                                style="width: 100%; padding: 8px 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.85rem;">
                        </div>
                        
                        <!-- Delete Button -->
                        <div style="padding: 10px 8px; display: flex; align-items: center; justify-content: center;">
                            <button type="button" 
                                onclick="window.frontDeskManager.removeSynonymRow(${idx})"
                                style="width: 28px; height: 28px; background: transparent; border: 1px solid #f8514940; border-radius: 6px; color: #f85149; cursor: pointer; font-size: 1rem; display: flex; align-items: center; justify-content: center; transition: all 0.15s;"
                                onmouseover="this.style.background='#f8514920'; this.style.borderColor='#f85149'"
                                onmouseout="this.style.background='transparent'; this.style.borderColor='#f8514940'"
                                title="Remove this synonym">×</button>
                        </div>
                    </div>
                `).join('')}
            </div>
            <!-- Footer with count -->
            <div style="padding: 6px 16px; background: #21262d; border-top: 1px solid #30363d; text-align: center;">
                <span style="color: #6e7681; font-size: 0.7rem;">${synonyms.length} custom synonym${synonyms.length !== 1 ? 's' : ''}</span>
            </div>
        `;
    }
    
    addSynonymRow() {
        if (!this.config.callerVocabularySynonyms) {
            this.config.callerVocabularySynonyms = [];
        }
        
        this.config.callerVocabularySynonyms.push({
            slang: '',
            meaning: ''
        });
        
        // Re-render the rows
        const container = document.getElementById('fdb-cv-synonym-rows');
        if (container) {
            container.innerHTML = this.renderSynonymRows();
        }
        
        this.isDirty = true;
        console.log('[FRONT DESK] 🔤 Added new synonym row');
    }
    
    updateSynonymRow(idx, field, value) {
        if (!this.config.callerVocabularySynonyms || !this.config.callerVocabularySynonyms[idx]) return;
        
        this.config.callerVocabularySynonyms[idx][field] = value;
        this.isDirty = true;
        console.log(`[FRONT DESK] 🔤 Updated synonym ${idx}: ${field} = ${value}`);
    }
    
    removeSynonymRow(idx) {
        if (!this.config.callerVocabularySynonyms) return;
        
        const removed = this.config.callerVocabularySynonyms.splice(idx, 1);
        console.log('[FRONT DESK] 🔤 Removed synonym:', removed[0]?.slang);
        
        // Re-render the rows
        const container = document.getElementById('fdb-cv-synonym-rows');
        if (container) {
            container.innerHTML = this.renderSynonymRows();
        }
        
        this.isDirty = true;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V36: FILLER WORDS - Inherited + Custom
    // ═══════════════════════════════════════════════════════════════════════════
    
    renderInheritedFillers() {
        const fillers = this.config.inheritedFillers || [];
        const templateName = this.config.activeTemplateName || 'No Template';
        
        if (fillers.length === 0) {
            return `
                <div style="padding: 30px 20px; text-align: center;">
                    <div style="font-size: 1.5rem; margin-bottom: 8px; opacity: 0.4;">🔇</div>
                    <p style="color: #6e7681; margin: 0; font-size: 0.8rem;">No inherited filler words from template</p>
                    <p style="color: #484f58; margin: 4px 0 0 0; font-size: 0.7rem;">Select an AiCore template with fillers configured</p>
                </div>
            `;
        }
        
        // Render as badge cloud
        const badges = fillers.map(f => 
            `<span style="display: inline-block; padding: 4px 10px; background: #238636; color: white; border-radius: 4px; font-size: 0.8rem; margin: 3px;">${this.escapeHtml(f)}</span>`
        ).join('');
        
        return `
            <!-- Scrollable Badge Container -->
            <div style="max-height: 150px; overflow-y: auto; padding: 12px;">
                <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                    ${badges}
                </div>
            </div>
            <!-- Footer with count and template name -->
            <div style="padding: 8px 16px; background: #21262d; border-top: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center;">
                <span style="color: #6e7681; font-size: 0.75rem;">${fillers.length} filler word${fillers.length !== 1 ? 's' : ''}</span>
                <span style="color: #3fb950; font-size: 0.75rem;">📦 ${this.escapeHtml(templateName)}</span>
            </div>
        `;
    }
    
    renderCustomFillers() {
        // Initialize custom fillers array if not exists
        if (!this.config.customFillers) {
            this.config.customFillers = [];
        }
        
        const fillers = this.config.customFillers || [];
        
        if (fillers.length === 0) {
            return `
                <div style="padding: 30px 20px; text-align: center;">
                    <div style="font-size: 1.5rem; margin-bottom: 8px; opacity: 0.5;">🔧</div>
                    <p style="color: #8b949e; margin: 0 0 4px 0; font-size: 0.85rem;">No company-specific filler words</p>
                    <p style="color: #6e7681; margin: 0; font-size: 0.75rem;">Click "Add Filler" to add custom noise words</p>
                </div>
            `;
        }
        
        // Render as editable badges with delete
        const badges = fillers.map((f, idx) => `
            <span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px 4px 12px; background: #a371f7; color: white; border-radius: 4px; font-size: 0.8rem; margin: 3px;">
                ${this.escapeHtml(f)}
                <button type="button" 
                    onclick="window.frontDeskManager.removeFillerWord(${idx})"
                    style="background: rgba(255,255,255,0.2); border: none; color: white; width: 18px; height: 18px; border-radius: 50%; cursor: pointer; font-size: 0.7rem; display: flex; align-items: center; justify-content: center;"
                    title="Remove">×</button>
            </span>
        `).join('');
        
        return `
            <!-- Scrollable Badge Container -->
            <div style="max-height: 150px; overflow-y: auto; padding: 12px;">
                <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                    ${badges}
                </div>
            </div>
            <!-- Footer with count -->
            <div style="padding: 8px 16px; background: #21262d; border-top: 1px solid #30363d; text-align: center;">
                <span style="color: #6e7681; font-size: 0.75rem;">${fillers.length} custom filler${fillers.length !== 1 ? 's' : ''}</span>
            </div>
        `;
    }
    
    addFillerWord() {
        const word = prompt('Enter filler word to add (e.g., "um", "like", "basically"):');
        if (!word || !word.trim()) return;
        
        const normalized = word.toLowerCase().trim();
        
        if (!this.config.customFillers) {
            this.config.customFillers = [];
        }
        
        // Check for duplicates
        if (this.config.customFillers.includes(normalized)) {
            alert('This filler word already exists!');
            return;
        }
        
        this.config.customFillers.push(normalized);
        
        // Re-render
        const container = document.getElementById('fdb-custom-fillers');
        if (container) {
            container.innerHTML = this.renderCustomFillers();
        }
        
        this.isDirty = true;
        console.log('[FRONT DESK] 🔇 Added filler word:', normalized);
    }
    
    removeFillerWord(idx) {
        if (!this.config.customFillers) return;
        
        const removed = this.config.customFillers.splice(idx, 1);
        console.log('[FRONT DESK] 🔇 Removed filler word:', removed[0]);
        
        // Re-render
        const container = document.getElementById('fdb-custom-fillers');
        if (container) {
            container.innerHTML = this.renderCustomFillers();
        }
        
        this.isDirty = true;
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // V36: NAME STOP WORDS - Words that should NEVER be extracted as names
    // ════════════════════════════════════════════════════════════════════════════
    
    toggleStopWordsFields(enabled) {
        const fields = document.getElementById('fdb-stopwords-fields');
        if (fields) {
            fields.style.display = enabled ? 'block' : 'none';
        }
        this.config.nameStopWordsEnabled = enabled;
        this.isDirty = true;
    }
    
    // Platform default stop words (read-only, shown for reference)
    getPlatformStopWords() {
        return [
            // Greetings & fillers
            'hi', 'hello', 'hey', 'good', 'morning', 'afternoon', 'evening', 'night',
            'uh', 'um', 'erm', 'hmm', 'ah', 'oh', 'well', 'so', 'like', 'just',
            // Confirmations
            'yeah', 'yes', 'sure', 'okay', 'ok', 'alright', 'right', 'yep', 'yup',
            'go', 'ahead', 'absolutely', 'definitely', 'certainly', 'perfect', 'sounds',
            // Common words & auxiliary verbs
            'the', 'that', 'this', 'what', 'please', 'thanks', 'thank', 'you',
            'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'has', 'have', 'had',
            'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might',
            'it', 'its', 'my', 'your', 'our', 'their', 'his', 'her', 'a', 'an', 'and', 'or', 'but',
            // Common sentence starters
            'to', 'see', 'if', 'we', 'get', 'somebody', 'someone', 'here', 'there', 'today', 'now',
            // Common verbs
            'having', 'doing', 'calling', 'looking', 'trying', 'getting', 'going', 'coming',
            'waiting', 'hoping', 'thinking', 'wondering', 'needing', 'wanting', 'asking',
            'dealing', 'experiencing', 'seeing', 'feeling', 'hearing', 'running', 'working',
            // Problem-related words
            'failing', 'broken', 'leaking', 'stopped', 'making', 'noise', 'noisy', 'loud',
            'not', 'wont', 'doesnt', 'isnt', 'cant', 'problem', 'problems', 'issue', 'issues',
            'trouble', 'troubles', 'wrong', 'weird', 'strange', 'acting', 'up', 'down', 'out'
        ];
    }
    
    renderPlatformStopWords() {
        const words = this.getPlatformStopWords();
        const badges = words.map(w => `
            <span style="display: inline-block; padding: 3px 8px; background: #238636; color: white; border-radius: 4px; font-size: 0.75rem; margin: 2px;">
                ${this.escapeHtml(w)}
            </span>
        `).join('');
        
        return `
            <div style="display: flex; flex-wrap: wrap; gap: 2px;">
                ${badges}
            </div>
            <div style="padding: 8px 0 0 0; text-align: center;">
                <span style="color: #6e7681; font-size: 0.75rem;">${words.length} platform stop words</span>
            </div>
        `;
    }
    
    renderCustomStopWords() {
        if (!this.config.customStopWords) {
            this.config.customStopWords = [];
        }
        
        const words = this.config.customStopWords || [];
        
        if (words.length === 0) {
            return `
                <div style="padding: 30px 20px; text-align: center;">
                    <div style="font-size: 1.5rem; margin-bottom: 8px; opacity: 0.5;">🔧</div>
                    <p style="color: #8b949e; margin: 0 0 4px 0; font-size: 0.85rem;">No company-specific stop words</p>
                    <p style="color: #6e7681; margin: 0; font-size: 0.75rem;">Click "Add Stop Word" to add custom exclusions</p>
                </div>
            `;
        }
        
        // Render as editable badges with delete
        const badges = words.map((w, idx) => `
            <span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px 4px 12px; background: #f85149; color: white; border-radius: 4px; font-size: 0.8rem; margin: 3px;">
                ${this.escapeHtml(w)}
                <button type="button" 
                    onclick="window.frontDeskManager.removeStopWord(${idx})"
                    style="background: rgba(255,255,255,0.2); border: none; color: white; width: 18px; height: 18px; border-radius: 50%; cursor: pointer; font-size: 0.7rem; display: flex; align-items: center; justify-content: center;"
                    title="Remove">×</button>
            </span>
        `).join('');
        
        return `
            <div style="display: flex; flex-wrap: wrap; gap: 4px; padding: 12px;">
                ${badges}
            </div>
        `;
    }
    
    addStopWord() {
        const word = prompt('Enter word that should NEVER be extracted as a name:');
        if (!word || !word.trim()) return;
        
        const normalized = word.toLowerCase().trim();
        
        if (!this.config.customStopWords) {
            this.config.customStopWords = [];
        }
        
        // Check for duplicates
        if (this.config.customStopWords.includes(normalized)) {
            alert('This stop word already exists!');
            return;
        }
        
        // Check if it's already a platform default
        if (this.getPlatformStopWords().includes(normalized)) {
            alert('This word is already in the platform defaults!');
            return;
        }
        
        this.config.customStopWords.push(normalized);
        
        // Re-render
        const container = document.getElementById('fdb-custom-stopwords');
        if (container) {
            container.innerHTML = this.renderCustomStopWords();
        }
        
        this.isDirty = true;
        console.log('[FRONT DESK] 🚫 Added stop word:', normalized);
    }
    
    removeStopWord(idx) {
        if (!this.config.customStopWords) return;
        
        const removed = this.config.customStopWords.splice(idx, 1);
        console.log('[FRONT DESK] 🚫 Removed stop word:', removed[0]);
        
        // Re-render
        const container = document.getElementById('fdb-custom-stopwords');
        if (container) {
            container.innerHTML = this.renderCustomStopWords();
        }
        
        this.isDirty = true;
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // V22 TAB: Vocabulary Guardrails
    // ════════════════════════════════════════════════════════════════════════════
    // Prevents cross-trade contamination (HVAC words in dental, etc.)
    // ════════════════════════════════════════════════════════════════════════════
    renderVocabularyTab() {
        const vg = this.config.vocabularyGuardrails || {};
        const cv = this.config.callerVocabulary || {};
        
        const allowedNouns = (vg.allowedServiceNouns || []).join(', ');
        const forbiddenWords = (vg.forbiddenWords || []).join(', ');
        const replacementMap = vg.replacementMap || {};
        const replacementPairs = Object.entries(replacementMap).map(([k, v]) => `${k} → ${v}`).join('\\n');
        
        // Caller vocabulary synonym map
        const synonymMap = cv.synonymMap || {};
        const synonymPairs = Object.entries(synonymMap).map(([k, v]) => `${k} → ${v}`).join('\\n');
        const cvEnabled = cv.enabled !== false;
        
        return `
            <!-- ═══════════════════════════════════════════════════════════════════ -->
            <!-- CALLER VOCABULARY - Industry slang/synonym mapping (INPUT) V36 -->
            <!-- ═══════════════════════════════════════════════════════════════════ -->
            <div style="background: #161b22; border: 1px solid #58a6ff; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
                    <div>
                        <h3 style="margin: 0 0 8px 0; color: #58a6ff;">🗣️ Caller Vocabulary (Industry Slang)</h3>
                        <p style="color: #8b949e; font-size: 0.875rem; margin: 0;">
                            <strong>Understand caller slang:</strong> When caller says "not pulling", AI understands they mean "not cooling".
                            <br><span style="color: #6e7681;">This is for what the <strong>caller</strong> says (input), not what the AI says (output).</span>
                        </p>
                    </div>
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px;">
                        <input type="checkbox" id="fdb-cv-enabled" ${cvEnabled ? 'checked' : ''} 
                            onchange="window.frontDeskManager.toggleCallerVocabularyFields(this.checked)"
                            style="accent-color: #58a6ff; width: 16px; height: 16px;">
                        <span style="color: #c9d1d9; font-size: 0.85rem; font-weight: 500;">Enabled</span>
                    </label>
                </div>
                
                <div id="fdb-cv-fields" style="display: ${cvEnabled ? 'block' : 'none'};">
                    
                    <!-- ═══════════════════════════════════════════════════════════════════ -->
                    <!-- SOURCE 1: INHERITED FROM AICORE TEMPLATE (Read-Only) -->
                    <!-- ═══════════════════════════════════════════════════════════════════ -->
                    <div style="background: #0d1117; border: 1px solid #238636; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="background: #238636; color: white; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">INHERITED</span>
                                <h4 style="margin: 0; color: #3fb950; font-size: 0.95rem;">📚 Template Synonyms (from AiCore)</h4>
                            </div>
                            <span style="color: #6e7681; font-size: 0.75rem;">Read-only • From selected template</span>
                        </div>
                        <div id="fdb-cv-inherited-synonyms" style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; overflow: hidden;">
                            ${this.renderInheritedSynonyms()}
                        </div>
                        <p style="color: #6e7681; font-size: 0.7rem; margin: 8px 0 0 0;">
                            💡 These come from your selected AiCore template. To change them, edit the template in AiBrain.
                        </p>
                    </div>
                    
                    <!-- ═══════════════════════════════════════════════════════════════════ -->
                    <!-- SOURCE 2: COMPANY-SPECIFIC SYNONYMS (Editable Table) -->
                    <!-- ═══════════════════════════════════════════════════════════════════ -->
                    <div style="background: #0d1117; border: 1px solid #58a6ff; border-radius: 8px; padding: 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="background: #58a6ff; color: white; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">CUSTOM</span>
                                <h4 style="margin: 0; color: #58a6ff; font-size: 0.95rem;">🔧 Company Synonyms (Overrides)</h4>
                            </div>
                            <button type="button" onclick="window.frontDeskManager.addSynonymRow()" 
                                style="padding: 8px 16px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(35, 134, 54, 0.3);">
                                <span style="font-size: 1.1rem;">+</span> Add Synonym
                            </button>
                        </div>
                        <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 12px;">
                            Add company-specific slang that's not in the template. These override template synonyms.
                        </p>
                        
                        <!-- Clean 2-Column Table -->
                        <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden;">
                            <!-- Table Header -->
                            <div style="display: grid; grid-template-columns: 1fr 1fr 50px; background: #21262d; border-bottom: 1px solid #30363d;">
                                <div style="padding: 12px 16px; color: #8b949e; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                                    Caller Says (Slang)
                                </div>
                                <div style="padding: 12px 16px; color: #8b949e; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                                    AI Understands (Standard)
                                </div>
                                <div></div>
                            </div>
                            
                            <!-- Table Body -->
                            <div id="fdb-cv-synonym-rows" style="display: flex; flex-direction: column;">
                                ${this.renderSynonymRows()}
                            </div>
                        </div>
                        
                        <p style="color: #6e7681; font-size: 0.7rem; margin: 12px 0 0 0;">
                            <strong>Examples:</strong> pulling → cooling, froze up → frozen coils, went out → stopped working
                        </p>
                    </div>
                </div>
            </div>
            
            <!-- ═══════════════════════════════════════════════════════════════════ -->
            <!-- FILLER WORDS - Words to ignore during intent matching V36 -->
            <!-- ═══════════════════════════════════════════════════════════════════ -->
            <div style="background: #161b22; border: 1px solid #a371f7; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
                    <div>
                        <h3 style="margin: 0 0 8px 0; color: #a371f7;">🔇 Filler Words (Noise Removal)</h3>
                        <p style="color: #8b949e; font-size: 0.875rem; margin: 0;">
                            <strong>Remove noise:</strong> Words like "um", "like", "you know" are stripped before AI processes input.
                            <br><span style="color: #6e7681;">This improves intent detection accuracy by removing conversational noise.</span>
                        </p>
                    </div>
                </div>
                
                <!-- ═══════════════════════════════════════════════════════════════════ -->
                <!-- SOURCE 1: INHERITED FILLERS FROM TEMPLATE (Read-Only) -->
                <!-- ═══════════════════════════════════════════════════════════════════ -->
                <div style="background: #0d1117; border: 1px solid #238636; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="background: #238636; color: white; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">INHERITED</span>
                            <h4 style="margin: 0; color: #3fb950; font-size: 0.95rem;">📚 Template Fillers (from AiCore)</h4>
                        </div>
                        <span style="color: #6e7681; font-size: 0.75rem;">Read-only • From selected template</span>
                    </div>
                    <div id="fdb-inherited-fillers" style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; overflow: hidden;">
                        ${this.renderInheritedFillers()}
                    </div>
                    <p style="color: #6e7681; font-size: 0.7rem; margin: 8px 0 0 0;">
                        💡 These come from your selected AiCore template. To change them, edit the template in AiBrain.
                    </p>
                </div>
                
                <!-- ═══════════════════════════════════════════════════════════════════ -->
                <!-- SOURCE 2: COMPANY-SPECIFIC FILLERS (Editable) -->
                <!-- ═══════════════════════════════════════════════════════════════════ -->
                <div style="background: #0d1117; border: 1px solid #a371f7; border-radius: 8px; padding: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="background: #a371f7; color: white; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">CUSTOM</span>
                            <h4 style="margin: 0; color: #a371f7; font-size: 0.95rem;">🔧 Company Fillers (Additional)</h4>
                        </div>
                        <button type="button" onclick="window.frontDeskManager.addFillerWord()" 
                            style="padding: 8px 16px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(35, 134, 54, 0.3);">
                            <span style="font-size: 1.1rem;">+</span> Add Filler
                        </button>
                    </div>
                    <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 12px;">
                        Add company-specific filler words. These are added to (not replacing) template fillers.
                    </p>
                    
                    <!-- Filler Words Display -->
                    <div id="fdb-custom-fillers" style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; overflow: hidden;">
                        ${this.renderCustomFillers()}
                    </div>
                    
                    <p style="color: #6e7681; font-size: 0.7rem; margin: 12px 0 0 0;">
                        <strong>Examples:</strong> um, uh, like, you know, basically, actually, so, well
                    </p>
                </div>
            </div>
            
            <!-- ═══════════════════════════════════════════════════════════════════ -->
            <!-- V36: NAME STOP WORDS - Words that should NEVER be extracted as names -->
            <!-- ═══════════════════════════════════════════════════════════════════ -->
            <div style="background: #161b22; border: 1px solid #f85149; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
                    <div>
                        <h3 style="margin: 0 0 8px 0; color: #f85149;">🚫 Name Extraction Stop Words</h3>
                        <p style="color: #8b949e; font-size: 0.875rem; margin: 0;">
                            <strong>Prevent false name extraction:</strong> Words like "to", "see", "if" should NEVER be extracted as names.
                            <br><span style="color: #6e7681;">Example: "I am trying <strong>to see</strong> if..." should NOT extract "to see" as a name.</span>
                        </p>
                    </div>
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px;">
                        <input type="checkbox" id="fdb-stopwords-enabled" ${this.config.nameStopWordsEnabled !== false ? 'checked' : ''} 
                            onchange="window.frontDeskManager.toggleStopWordsFields(this.checked)"
                            style="accent-color: #f85149; width: 16px; height: 16px;">
                        <span style="color: #c9d1d9; font-size: 0.85rem; font-weight: 500;">Enabled</span>
                    </label>
                </div>

                <div id="fdb-stopwords-fields" style="display: ${this.config.nameStopWordsEnabled !== false ? 'block' : 'none'};">
                    <!-- PLATFORM DEFAULT STOP WORDS (Read-Only) -->
                    <div style="background: #0d1117; border: 1px solid #238636; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="background: #238636; color: white; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">PLATFORM</span>
                                <h4 style="margin: 0; color: #3fb950; font-size: 0.95rem;">📚 Default Stop Words (Built-in)</h4>
                            </div>
                            <span style="color: #6e7681; font-size: 0.75rem;">Read-only • Platform defaults</span>
                        </div>
                        <div id="fdb-platform-stopwords" style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px; max-height: 150px; overflow-y: auto;">
                            ${this.renderPlatformStopWords()}
                        </div>
                        <p style="color: #6e7681; font-size: 0.7rem; margin: 8px 0 0 0;">
                            💡 These are platform defaults that prevent common false positives. Add custom words below if needed.
                        </p>
                    </div>

                    <!-- CUSTOM COMPANY STOP WORDS (Editable) -->
                    <div style="background: #0d1117; border: 1px solid #f85149; border-radius: 8px; padding: 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="background: #f85149; color: white; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">CUSTOM</span>
                                <h4 style="margin: 0; color: #f85149; font-size: 0.95rem;">🔧 Company Stop Words (Additional)</h4>
                            </div>
                            <button type="button" onclick="window.frontDeskManager.addStopWord()" 
                                style="padding: 8px 16px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(35, 134, 54, 0.3);">
                                <span style="font-size: 1.1rem;">+</span> Add Stop Word
                            </button>
                        </div>
                        <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 12px;">
                            Add company-specific words that should never be extracted as names.
                        </p>
                        
                        <div id="fdb-custom-stopwords" style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; max-height: 200px; overflow-y: auto;">
                            ${this.renderCustomStopWords()}
                        </div>
                        <div style="padding: 8px 16px; background: #21262d; border-top: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center; border-radius: 0 0 8px 8px; margin-top: -1px;">
                            <span style="color: #6e7681; font-size: 0.75rem;">${(this.config.customStopWords || []).length} custom stop word${(this.config.customStopWords || []).length !== 1 ? 's' : ''}</span>
                        </div>
                        <p style="color: #6e7681; font-size: 0.7rem; margin: 12px 0 0 0;">
                            <strong>Examples:</strong> Company-specific words that might be mistaken for names in your industry.
                        </p>
                    </div>
                </div>
            </div>
            
            <!-- ═══════════════════════════════════════════════════════════════════ -->
            <!-- AI VOCABULARY GUARDRAILS (OUTPUT) -->
            <!-- ═══════════════════════════════════════════════════════════════════ -->
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="margin: 0 0 8px 0; color: #f0883e;">📝 AI Vocabulary Guardrails</h3>
                <p style="color: #8b949e; margin-bottom: 20px; font-size: 0.875rem;">
                    <strong>Multi-Tenant Safety:</strong> Control what words the <strong>AI</strong> can say. A dental office should never say "technician".
                    <br><span style="color: #6e7681;">This is for what the <strong>AI</strong> says (output), not what the caller says (input).</span>
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
            case 'flows': 
                content.innerHTML = this.renderDynamicFlowsTab(); 
                // Load flows asynchronously after rendering
                this.refreshFlowsList(container);
                break;
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
        
        // V32: Collect greeting rules (new 2-column format with fuzzy matching)
        if (document.getElementById('fdb-greeting-rows')) {
            // greetingRules is already maintained by addGreetingRow/updateGreetingRow/removeGreetingRow
            // Just ensure it's properly formatted and log it
            const rules = this.config.greetingRules || [];
            
            // Filter out empty rules
            const filteredRules = rules.filter(r => r.trigger && r.trigger.trim());
            
            // Ensure conversationStages exists
            if (!this.config.conversationStages) {
                this.config.conversationStages = { enabled: true };
            }
            
            // Store greetingRules in BOTH places for compatibility:
            // 1. At config.greetingRules (for UI state)
            // 2. At config.conversationStages.greetingRules (for backend/API)
            this.config.greetingRules = filteredRules;
            this.config.conversationStages.greetingRules = filteredRules;
            
            // Map new rules to old format (find first matching trigger for each time period)
            const findResponse = (triggers) => {
                for (const t of triggers) {
                    const rule = filteredRules.find(r => 
                        r.trigger.toLowerCase().includes(t.toLowerCase())
                    );
                    if (rule) return rule.response;
                }
                return null;
            };
            
            this.config.conversationStages.greetingResponses = {
                morning: findResponse(['morning', 'gm']) || "Good morning! How can I help you today?",
                afternoon: findResponse(['afternoon']) || "Good afternoon! How can I help you today?",
                evening: findResponse(['evening']) || "Good evening! How can I help you today?",
                generic: findResponse(['hi', 'hello', 'hey']) || "Hi there! How can I help you today?"
            };
            
            console.log('[FRONT DESK BEHAVIOR] 👋 V32 Greeting rules saved:', this.config.conversationStages.greetingRules);
            console.log('[FRONT DESK BEHAVIOR] 👋 Legacy format:', this.config.conversationStages.greetingResponses);
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
        
        // ═══════════════════════════════════════════════════════════════════
        // BOOKING OUTCOME - What AI says when all slots collected
        // ═══════════════════════════════════════════════════════════════════
        // bookingOutcome is already updated via onChange handlers, but ensure it's in config
        if (!this.config.bookingOutcome) {
            this.config.bookingOutcome = {
                mode: 'confirmed_on_call',
                useAsapVariant: true
            };
        }
        console.log('[FRONT DESK BEHAVIOR] 🎯 Booking outcome:', this.config.bookingOutcome);

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
        // 🚀 Fast-Path Booking Settings
        // ════════════════════════════════════════════════════════════════════════════
        if (document.getElementById('fdb-fp-enabled')) {
            // Parse trigger keywords from comma-separated textarea
            const keywordsRaw = get('fdb-fp-keywords') || '';
            const keywords = keywordsRaw.split(',').map(k => k.trim().toLowerCase()).filter(k => k);
            
            this.config.fastPathBooking = {
                enabled: getChecked('fdb-fp-enabled'),
                triggerKeywords: keywords,
                offerScript: get('fdb-fp-offerScript') || "Got it — I completely understand. We can get someone out to you. Would you like me to schedule a technician now?",
                oneQuestionScript: get('fdb-fp-oneQuestion') || "",
                maxDiscoveryQuestions: parseInt(get('fdb-fp-maxQuestions')) || 2
            };
            console.log('[FRONT DESK BEHAVIOR] 🚀 Fast-Path Booking saved:', this.config.fastPathBooking);
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
        
        // ════════════════════════════════════════════════════════════════════════════
        // V36: Caller Vocabulary Settings (Industry Slang Translation) - 2-Column Table
        // ════════════════════════════════════════════════════════════════════════════
        if (document.getElementById('fdb-cv-enabled')) {
            const enabled = getChecked('fdb-cv-enabled');
            
            // Convert array format to synonymMap for backend compatibility
            const synonyms = this.config.callerVocabularySynonyms || [];
            const synonymMap = {};
            synonyms.forEach(s => {
                if (s.slang && s.slang.trim() && s.meaning && s.meaning.trim()) {
                    synonymMap[s.slang.toLowerCase().trim()] = s.meaning.trim();
                }
            });
            
            this.config.callerVocabulary = {
                enabled: enabled,
                synonymMap: synonymMap,
                logTranslations: true  // Always log for debugging
            };
            console.log('[FRONT DESK BEHAVIOR] 🔤 V36 Caller vocabulary saved:', {
                enabled,
                synonymCount: Object.keys(synonymMap).length,
                synonymMap
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // V36: Custom Filler Words (Company-Specific Noise Removal)
        // ════════════════════════════════════════════════════════════════════════════
        const fillerEnabled = document.getElementById('fdb-fillers-enabled')?.checked ?? true;
        const customFillers = this.config.customFillers || [];
        
        // Save to fillerWords.custom in the schema
        if (!this.config.fillerWords) {
            this.config.fillerWords = {};
        }
        this.config.fillerWords.custom = customFillers;
        this.config.fillerWordsEnabled = fillerEnabled;
        
        console.log('[FRONT DESK BEHAVIOR] 🔇 V36 Custom fillers saved:', {
            enabled: fillerEnabled,
            count: customFillers.length,
            fillers: customFillers
        });
        
        // ════════════════════════════════════════════════════════════════════════════
        // V36: Name Stop Words (Words that should NEVER be extracted as names)
        // ════════════════════════════════════════════════════════════════════════════
        const stopWordsEnabled = document.getElementById('fdb-stopwords-enabled')?.checked ?? true;
        const customStopWords = this.config.customStopWords || [];
        
        // Save to nameStopWords in the schema
        if (!this.config.nameStopWords) {
            this.config.nameStopWords = {};
        }
        this.config.nameStopWords.enabled = stopWordsEnabled;
        this.config.nameStopWords.custom = customStopWords;
        this.config.nameStopWordsEnabled = stopWordsEnabled;
        
        console.log('[FRONT DESK BEHAVIOR] 🚫 V36 Name stop words saved:', {
            enabled: stopWordsEnabled,
            count: customStopWords.length,
            words: customStopWords
        });
        
        // ════════════════════════════════════════════════════════════════════════════
        // V30: Name Spelling Variants (Mark with K or C?)
        // ════════════════════════════════════════════════════════════════════════════
        if (document.getElementById('fdb-spelling-enabled')) {
            this.config.nameSpellingVariants = this.collectSpellingVariantsConfig();
            console.log('[FRONT DESK BEHAVIOR] ✏️ V30 Name spelling variants saved:', this.config.nameSpellingVariants);
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

    // Build flow payload from modal
    // forCopy: returns normalized DFLOW_V1 shape
    // editFlow: pass the original flow data so we can include ALL actions (not just dropdown)
    // default: returns backend payload (DB shape)
    buildFlowPayloadFromModal(modal, isNew, { forCopy = false, editFlow = null } = {}) {
        const name = modal.querySelector('#flow-name').value.trim();
        const flowKeyRaw = modal.querySelector('#flow-key').value.trim();
        const flowKey = flowKeyRaw.toLowerCase().replace(/\s+/g, '_');
        const description = modal.querySelector('#flow-description').value.trim();
        const priority = parseInt(modal.querySelector('#flow-priority').value) || 50;
        const enabled = modal.querySelector('#flow-enabled').value === 'true';
        
        if (!name) {
            this.showNotification('Flow name is required', 'error');
            return null;
        }
        if (isNew && !flowKey) {
            this.showNotification('Flow key is required', 'error');
            return null;
        }
        
        const triggerPhrases = modal.querySelector('#flow-trigger-phrases').value.split('\n').map(p => p.trim()).filter(p => p);
        const triggerFuzzy = modal.querySelector('#flow-trigger-fuzzy').checked;
        const minConfidence = parseFloat(modal.querySelector('#flow-min-confidence').value) || 0.75;
        
        const trigger = {
            type: 'phrase',
            config: { phrases: triggerPhrases, fuzzy: triggerFuzzy },
            priority: 10,
            minConfidence
        };
        
        // Helper to convert string "true"/"false" to boolean
        const parseBoolean = (val) => {
            if (typeof val === 'boolean') return val;
            if (val === 'true') return true;
            if (val === 'false') return false;
            return val; // Leave as-is if not a boolean string
        };
        
        const actionType = modal.querySelector('#flow-action-type').value;
        let actionConfig = {};
        if (actionType === 'transition_mode') {
            actionConfig = { targetMode: modal.querySelector('#flow-action-mode').value || 'BOOKING', setBookingLocked: true };
        } else if (actionType === 'set_flag') {
            const rawValue = modal.querySelector('#flow-action-flag-value').value.trim() || 'true';
            actionConfig = { 
                flagName: modal.querySelector('#flow-action-flag-name').value.trim(),
                flagValue: parseBoolean(rawValue),
                alsoWriteToCallLedgerFacts: true
            };
        } else if (actionType === 'ack_once') {
            actionConfig = { text: modal.querySelector('#flow-action-response').value.trim() };
        } else if (actionType === 'append_ledger') {
            actionConfig = { 
                type: (modal.querySelector('#flow-ledger-type')?.value || '').trim(),
                key: (modal.querySelector('#flow-ledger-key')?.value || '').trim(),
                note: (modal.querySelector('#flow-ledger-note')?.value || '').trim()
            };
        }
        
        const action = {
            timing: 'on_activate',
            type: actionType,
            config: actionConfig
        };
        
        const settings = {
            allowConcurrent: modal.querySelector('#flow-allow-concurrent').checked,
            persistent: modal.querySelector('#flow-persistent').checked,
            reactivatable: modal.querySelector('#flow-reactivatable').checked,
            minConfidence
        };
        
        if (forCopy) {
            // Normalized DFLOW_V1 shape
            // Use editFlow's data when available (for Copy JSON on existing flows)
            
            // Use editFlow's trigger phrases if available and non-empty
            const effectiveTriggerPhrases = (editFlow?.triggers?.[0]?.config?.phrases?.length > 0)
                ? editFlow.triggers[0].config.phrases
                : triggerPhrases;
            const effectiveTriggerFuzzy = editFlow?.triggers?.[0]?.config?.fuzzy ?? triggerFuzzy;
            const effectiveMinConfidence = editFlow?.settings?.minConfidence ?? minConfidence;
            
            // If editFlow has multiple actions, use ALL of them (not just dropdown selection)
            const actionsToNormalize = (editFlow?.actions && editFlow.actions.length > 0) 
                ? editFlow.actions 
                : [action];
            
            const normalizedActions = actionsToNormalize.map(a => {
                const aType = a.type;
                const aConfig = a.config || {};
                
                if (aType === 'ack_once') {
                    return { 
                        type: 'ACK_ONCE', 
                        payload: { text: aConfig.text || '' } 
                    };
                }
                if (aType === 'transition_mode') {
                    return { 
                        type: 'TRANSITION_MODE', 
                        payload: { 
                            targetMode: aConfig.targetMode || 'BOOKING', 
                            setBookingLocked: aConfig.setBookingLocked !== false 
                        } 
                    };
                }
                if (aType === 'set_flag') {
                    // Ensure value is always present (default to true if undefined)
                    const flagValue = aConfig.flagValue !== undefined ? parseBoolean(aConfig.flagValue) : true;
                    return { 
                        type: 'SET_FLAG', 
                        payload: { 
                            path: aConfig.flagName || '', 
                            value: flagValue,
                            alsoWriteToCallLedgerFacts: aConfig.alsoWriteToCallLedgerFacts !== false 
                        } 
                    };
                }
                if (aType === 'append_ledger') {
                    return { 
                        type: 'APPEND_LEDGER', 
                        payload: { 
                            entry: { 
                                type: aConfig.type || '', 
                                key: aConfig.key || '', 
                                note: aConfig.note || '',
                                flowKey: flowKey
                            } 
                        } 
                    };
                }
                // Unknown action type - preserve as-is
                return { type: aType.toUpperCase(), payload: aConfig };
            });
            
            // Use effective settings from editFlow when available
            const effectivePersistent = editFlow?.settings?.persistent ?? modal.querySelector('#flow-persistent').checked;
            const effectiveAllowConcurrent = editFlow?.settings?.allowConcurrent ?? modal.querySelector('#flow-allow-concurrent').checked;
            const effectiveReactivatable = editFlow?.settings?.reactivatable ?? modal.querySelector('#flow-reactivatable').checked;
            
            return {
                version: 'DFLOW_V1',
                flowKey,
                name,
                description,
                enabled,
                priority,
                trigger: {
                    type: 'PHRASE_MATCH',
                    fuzzy: effectiveTriggerFuzzy,
                    phrases: effectiveTriggerPhrases,
                    minConfidence: effectiveMinConfidence
                },
                settings: {
                    persistentAcrossTurns: effectivePersistent,
                    allowConcurrentWithOtherFlows: effectiveAllowConcurrent,
                    canReactivateAfterCompleting: effectiveReactivatable
                },
                actions: normalizedActions,
                meta: {}
            };
        }
        
        // Backend payload (DB shape)
        return {
            name,
            description,
            priority,
            enabled,
            flowKey,
            triggers: [trigger],
            actions: [action],
            settings
        };
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
