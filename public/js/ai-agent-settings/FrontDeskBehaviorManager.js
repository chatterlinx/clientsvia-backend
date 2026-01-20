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
    // Visible on-page build stamp so admins can confirm what UI code is running.
    // Keep this human-readable (no giant hashes).
    static UI_BUILD = 'FD-BEHAVIOR_UI_V79.4';
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
            this.promptPackRegistry = result.meta?.promptPackRegistry || { packs: {}, byTrade: {} };

            // V77: Ensure Off-Rails Recovery config shape exists for UI editing
            // (DB may omit nested objects until changed)
            this.config.offRailsRecovery = this.config.offRailsRecovery || {};
            this.config.offRailsRecovery.bridgeBack = this.config.offRailsRecovery.bridgeBack || {};
            this.config.offRailsRecovery.bridgeBack.resumeBooking =
                this.config.offRailsRecovery.bridgeBack.resumeBooking || this.getDefaultConfig().offRailsRecovery.bridgeBack.resumeBooking;

            // V78: Ensure confirmationRequests shape exists
            this.config.confirmationRequests = this.config.confirmationRequests || this.getDefaultConfig().confirmationRequests;

            // Booking interruption behavior (UI-visible)
            this.config.bookingInterruption = this.config.bookingInterruption || this.getDefaultConfig().bookingInterruption;

            // Prompt guards + packs shape
            this.config.promptGuards = this.config.promptGuards || this.getDefaultConfig().promptGuards;
            this.config.promptPacks = this.config.promptPacks || this.getDefaultConfig().promptPacks;

            // Preset Draft overlay (UI-only): if an in-memory preset is loaded, overlay it onto the loaded config.
            // This MUST NOT write to DB; it only affects the UI until user clicks Save.
            try {
                const draft = window.__presetDraft?.payload?.frontDeskBehavior;
                if (draft && typeof draft === 'object') {
                    this.config = { ...this.config, ...draft };
                    this.isDirty = true;
                    console.log('[FRONT DESK BEHAVIOR] ⭐ Preset draft applied (UI-only, not saved)');
                }
            } catch (e) {
                console.warn('[FRONT DESK BEHAVIOR] Preset draft overlay failed:', e);
            }

            // Booking Contract V2 (feature-flagged) - ensure shape exists for UI
            if (this.config.bookingContractV2Enabled === undefined) this.config.bookingContractV2Enabled = false;
            if (!Array.isArray(this.config.slotLibrary)) this.config.slotLibrary = [];
            if (!Array.isArray(this.config.slotGroups)) this.config.slotGroups = [];

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
                const nameSlot = this.config.bookingSlots.find(s => s.id === 'name' || s.type === 'name');
                const phoneSlot = this.config.bookingSlots.find(s => s.id === 'phone' || s.type === 'phone');
                const addressSlot = this.config.bookingSlots.find(s => s.id === 'address' || s.type === 'address');
                
                console.log('[FRONT DESK BEHAVIOR] 📥 BOOKING SLOTS WIRING CHECK:', {
                    totalSlots: this.config.bookingSlots.length,
                    nameSlot: nameSlot ? {
                        id: nameSlot.id,
                        type: nameSlot.type,
                        question: nameSlot.question,  // ✅ Now shows the question!
                        askFullName: nameSlot.askFullName,
                        askMissingNamePart: nameSlot.askMissingNamePart,
                        hasQuestion: !!nameSlot.question ? '✅ WIRED' : '❌ MISSING'
                    } : '❌ NOT FOUND',
                    phoneSlot: phoneSlot ? {
                        id: phoneSlot.id,
                        question: phoneSlot.question,
                        hasQuestion: !!phoneSlot.question ? '✅ WIRED' : '❌ MISSING'
                    } : '❌ NOT FOUND',
                    addressSlot: addressSlot ? {
                        id: addressSlot.id,
                        question: addressSlot.question,
                        hasQuestion: !!addressSlot.question ? '✅ WIRED' : '❌ MISSING'
                    } : '❌ NOT FOUND'
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
                agentName: '',  // No default - must be configured per company
                // V79: Style depth controls (UI controlled)
                warmth: 0.6,
                speakingPace: 'normal'
            },
            bookingPrompts: {
                askName: "May I have your name?",
                askPhone: "What's the best phone number to reach you?",
                askAddress: "What's the service address?",
                askTime: "When works best for you - morning or afternoon?",
                confirmTemplate: "So I have {name} at {address}, {time}. Does that sound right?",
                completeTemplate: "You're all set, {name}! A technician will be out {time}. You'll receive a confirmation text shortly."
            },
            bookingPromptsMap: {},
            serviceFlow: {
                mode: 'hybrid',
                empathyEnabled: false,
                trades: [],
                promptKeysByTrade: {}
            },
            promptGuards: {
                // V83 FIX: Use colons instead of dots - Mongoose Maps don't allow dots in keys
                missingPromptFallbackKey: 'booking:universal:guardrails:missing_prompt_fallback'
            },
            promptPacks: {
                enabled: true,
                selectedByTrade: {
                    universal: 'universal_v1'
                }
            },
            bookingInterruption: {
                enabled: true,
                oneSlotPerTurn: true,
                forceReturnToQuestionAsLastLine: true,
                allowEmpathyLanguage: false,
                maxSentences: 2,
                shortClarificationPatterns: ['mark?', 'yes?', 'hello?', 'what?'],
                // 🆕 Mid-booking interruption handling
                allowedCategories: ['FAQ', 'HOURS', 'SERVICE_AREA', 'PRICING', 'SMALL_TALK', 'EMERGENCY'],
                maxInterruptsBeforeTransfer: 3,
                transferOfferPrompt: "I want to make sure I'm helping you the best way I can. Would you like me to connect you with someone who can answer all your questions, or should we continue with the scheduling?",
                // Multiple variants to avoid robotic repetition
                returnToSlotVariants: [
                    "Now, back to scheduling — {slotQuestion}",
                    "Alright, {slotQuestion}",
                    "So, {slotQuestion}",
                    "Anyway, {slotQuestion}",
                    "Back to your appointment — {slotQuestion}"
                ],
                returnToSlotShortVariants: [
                    "So, {slotQuestion}",
                    "{slotQuestion}",
                    "Alright — {slotQuestion}",
                    "Now, {slotQuestion}"
                ]
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
            forbiddenPhrases: [
                // Generic AI filler questions
                "tell me more about what you need",
                "what specific issues are you experiencing",
                "how can I help you",
                "what can I do for you today",
                // Robotic empathy phrases (sounds AI-generated)
                "I understand that it can be really frustrating",
                "I can see this is really frustrating",
                "I understand how frustrating",
                "I understand that's frustrating",
                "that sounds frustrating",
                "I know how frustrating",
                "that must be frustrating",
                // Generic padding
                "I'm here to help",
                "I appreciate you sharing that",
                "Thank you for your patience"
            ],
            
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
                // Consent Split (trade-agnostic): allow safe scenario types to respond before consent
                // Example: ['FAQ','TROUBLESHOOT'] lets callers get help without enabling booking actions.
                autoReplyAllowedScenarioTypes: [],
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
            },

            // Booking Contract V2 (feature-flagged, OFF by default)
            bookingContractV2Enabled: false,
            slotLibrary: [],
            slotGroups: [],

            // Vendor / Supplier Handling (Call Center directory)
            vendorHandling: {
                vendorFirstEnabled: false,
                enabled: false,
                mode: 'collect_message',
                allowLinkToCustomer: false,
                prompts: {
                    greeting: "Thanks for calling. How can we help?",
                    askSummary: "What can I help you with today?",
                    askOrderNumber: "Do you have an order number or invoice number I should note?",
                    askCustomerName: "Which customer is this regarding?",
                    completion: "Got it. I’ll make sure the team gets this message right away.",
                    transferMessage: "Thank you. Let me connect you to our team."
                }
            },

            // Unit of Work (UoW) - Universal multi-location / multi-job container
            unitOfWork: {
                enabled: false,
                allowMultiplePerCall: false,
                maxUnitsPerCall: 3,
                labelSingular: 'Job',
                labelPlural: 'Jobs',
                perUnitSlotIds: ['address'],
                confirmation: {
                    askAddAnotherPrompt: "Is this for just this location, or do you have another location to add today?",
                    clarifyPrompt: "Just to confirm — do you have another location or job to add today?",
                    nextUnitIntro: "Okay — let’s get the details for the next one.",
                    finalScriptMulti: "Perfect — I’ve got both locations. Our team will take it from here.",
                    yesWords: ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'correct', 'another', 'one more'],
                    noWords: ['no', 'nope', 'nah', 'just this', 'only this', "that's it", 'all set']
                }
            },

            // After-hours message contract (deterministic)
            afterHoursMessageContract: {
                mode: 'inherit_booking_minimum',
                requiredFieldKeys: ['name', 'phone', 'address', 'problemSummary', 'preferredTime'],
                extraSlotIds: []
            },

            // ════════════════════════════════════════════════════════════════════
            // V77: Off-Rails Recovery (Resume Booking Protocol)
            // ════════════════════════════════════════════════════════════════════
            offRailsRecovery: {
                enabled: true,
                bridgeBack: {
                    enabled: true,
                    transitionPhrase: "Now, to help you best,",
                    maxRecoveryAttempts: 3,
                    resumeBooking: {
                        enabled: true,
                        includeValues: false,
                        template: "Okay — back to booking. I have {collectedSummary}. {nextQuestion}",
                        collectedItemTemplate: "{label}",
                        collectedItemTemplateWithValue: "{label}: {value}",
                        separator: ", ",
                        finalSeparator: " and "
                    },
                    // V92: Booking Clarification (meta questions during booking)
                    clarification: {
                        enabled: true,
                        triggers: [
                            "is that what you want",
                            "is that what you need",
                            "what do you want",
                            "what do you need",
                            "what do you mean",
                            "can you explain",
                            "sorry what do you mean"
                        ],
                        template: "No problem — {nextQuestion}"
                    }
                }
            }
            ,

            // ════════════════════════════════════════════════════════════════════
            // V78: Confirmation Requests (repeat what we captured)
            // ════════════════════════════════════════════════════════════════════
            confirmationRequests: {
                enabled: true,
                triggers: [
                    "did you get my",
                    "did you catch my",
                    "did i give you the right",
                    "is that right",
                    "is that correct",
                    "can you repeat",
                    "can you read that back",
                    "can you confirm",
                    "what did you have for my"
                ]
            }
        };
    }

    // Save config to API
    async save() {
        const saveStartTime = performance.now();
        console.log('[FRONT DESK BEHAVIOR] 💾 SAVE CHECKPOINT 1: Starting save operation...');
        
        try {
            // CHECKPOINT 2: Prepare payload
            const prepareStart = performance.now();
            
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
            
            // V83 FIX: Sanitize bookingPromptsMap - convert any dotted keys to colon keys
            // This handles legacy data that might have been loaded with dots
            if (this.config.bookingPromptsMap) {
                const sanitizedMap = {};
                let keysConverted = 0;
                for (const [key, value] of Object.entries(this.config.bookingPromptsMap)) {
                    if (key.includes('.')) {
                        const newKey = key.replace(/\./g, ':');
                        sanitizedMap[newKey] = value;
                        keysConverted++;
                    } else {
                        sanitizedMap[key] = value;
                    }
                }
                this.config.bookingPromptsMap = sanitizedMap;
                if (keysConverted > 0) {
                    console.log(`[FRONT DESK BEHAVIOR] 🔧 V83: Converted ${keysConverted} dotted keys to colon keys in bookingPromptsMap`);
                }
            }
            
            // V83 FIX: Also sanitize promptGuards.missingPromptFallbackKey
            if (this.config.promptGuards?.missingPromptFallbackKey?.includes('.')) {
                const oldKey = this.config.promptGuards.missingPromptFallbackKey;
                this.config.promptGuards.missingPromptFallbackKey = oldKey.replace(/\./g, ':');
                console.log(`[FRONT DESK BEHAVIOR] 🔧 V83: Converted missingPromptFallbackKey: "${oldKey}" → "${this.config.promptGuards.missingPromptFallbackKey}"`);
            }
            
            const payloadSize = JSON.stringify(this.config).length;
            console.log(`[FRONT DESK BEHAVIOR] 💾 SAVE CHECKPOINT 2: Payload prepared in ${(performance.now() - prepareStart).toFixed(1)}ms (${(payloadSize / 1024).toFixed(1)}KB)`);
            
            // CHECKPOINT 3: Make API call
            const apiStart = performance.now();
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token') || sessionStorage.getItem('token');
            
            const response = await fetch(`/api/admin/front-desk-behavior/${this.companyId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(this.config)
            });
            
            const apiTime = performance.now() - apiStart;
            console.log(`[FRONT DESK BEHAVIOR] 💾 SAVE CHECKPOINT 3: API call completed in ${apiTime.toFixed(1)}ms`);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[FRONT DESK BEHAVIOR] ❌ SAVE CHECKPOINT 3 FAILED: HTTP ${response.status}`, errorText);
                throw new Error(`Failed to save (HTTP ${response.status}): ${errorText}`);
            }
            
            // CHECKPOINT 4: Process response
            const processStart = performance.now();
            const responseData = await response.json();
            console.log(`[FRONT DESK BEHAVIOR] 💾 SAVE CHECKPOINT 4: Response processed in ${(performance.now() - processStart).toFixed(1)}ms`);
            
            this.isDirty = false;
            
            // FINAL CHECKPOINT
            const totalTime = performance.now() - saveStartTime;
            if (totalTime > 500) {
                console.warn(`[FRONT DESK BEHAVIOR] ⚠️ SLOW SAVE: Total time ${totalTime.toFixed(1)}ms (>500ms threshold)`);
                console.warn(`[FRONT DESK BEHAVIOR] ⚠️ Breakdown: API=${apiTime.toFixed(1)}ms, Payload=${(payloadSize/1024).toFixed(1)}KB`);
            } else {
                console.log(`[FRONT DESK BEHAVIOR] ✅ SAVE COMPLETE: Total time ${totalTime.toFixed(1)}ms`);
            }
            
            this.showNotification('✅ Front Desk Behavior saved!', 'success');

            // Refresh Config Health in the background (non-blocking).
            // This gives admins immediate feedback without rebuilding verifier logic.
            setTimeout(() => {
                try {
                    const bar = document.getElementById('fdb-verification-bar');
                    if (bar) this.runDeepVerification();
                } catch (e) {
                    // Never let verifier refresh impact save UX
                }
            }, 400);

            return true;
        } catch (error) {
            console.error('[FRONT DESK BEHAVIOR] ❌ SAVE ERROR:', error);
            console.error('[FRONT DESK BEHAVIOR] ❌ Save failed after', (performance.now() - saveStartTime).toFixed(1), 'ms');
            this.showNotification('❌ Save failed: ' + error.message, 'error');
            throw error;
        }
    }

    async previewPromptPackMigration() {
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token') || sessionStorage.getItem('token');
        if (!token) {
            this.showNotification('❌ Missing auth token', 'error');
            return;
        }
        const previewEl = document.getElementById('fdb-pack-migration-preview');
        if (previewEl) previewEl.style.display = 'block';

        try {
            const resp = await fetch(`/api/admin/prompt-packs/migration/preview?companyId=${this.companyId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await resp.json();
            if (!resp.ok || data?.success !== true) {
                throw new Error(data?.error || 'Migration preview failed');
            }
            if (previewEl) previewEl.textContent = JSON.stringify(data.data, null, 2);
            this.showNotification('✅ Migration preview loaded', 'success');
        } catch (error) {
            if (previewEl) previewEl.textContent = `Preview failed: ${error.message}`;
            this.showNotification(`❌ ${error.message}`, 'error');
        }
    }

    async applyPromptPackMigration() {
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token') || sessionStorage.getItem('token');
        if (!token) {
            this.showNotification('❌ Missing auth token', 'error');
            return;
        }
        const previewEl = document.getElementById('fdb-pack-migration-preview');
        if (previewEl) previewEl.style.display = 'block';

        try {
            const resp = await fetch('/api/admin/prompt-packs/migration/apply', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId: this.companyId, appliedBy: 'admin-ui', notes: 'UI migration apply' })
            });
            const data = await resp.json();
            if (!resp.ok || data?.success !== true) {
                throw new Error(data?.error || 'Migration apply failed');
            }
            if (previewEl) previewEl.textContent = JSON.stringify(data.data, null, 2);
            this.showNotification('✅ Migration applied', 'success');
        } catch (error) {
            if (previewEl) previewEl.textContent = `Apply failed: ${error.message}`;
            this.showNotification(`❌ ${error.message}`, 'error');
        }
    }

    async previewPromptPackUpgrade(tradeKey, toPack) {
        if (!tradeKey || !toPack) {
            this.showNotification('❌ Missing trade or pack', 'error');
            return;
        }
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token') || sessionStorage.getItem('token');
        if (!token) {
            this.showNotification('❌ Missing auth token', 'error');
            return;
        }

        const previewEl = document.getElementById(`fdb-pack-preview-${tradeKey}`);
        if (previewEl) previewEl.style.display = 'block';

        try {
            const qs = new URLSearchParams({ companyId: this.companyId, tradeKey, toPack });
            const resp = await fetch(`/api/admin/prompt-packs/upgrade/preview?${qs.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await resp.json();
            if (!resp.ok || data?.success !== true) {
                throw new Error(data?.error || 'Upgrade preview failed');
            }
            if (previewEl) previewEl.textContent = JSON.stringify(data.data, null, 2);
            this.showNotification('✅ Upgrade preview loaded', 'success');
        } catch (error) {
            if (previewEl) previewEl.textContent = `Preview failed: ${error.message}`;
            this.showNotification(`❌ ${error.message}`, 'error');
        }
    }

    async applyPromptPackUpgrade(tradeKey, toPack) {
        if (!tradeKey || !toPack) {
            this.showNotification('❌ Missing trade or pack', 'error');
            return;
        }
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token') || sessionStorage.getItem('token');
        if (!token) {
            this.showNotification('❌ Missing auth token', 'error');
            return;
        }

        const previewEl = document.getElementById(`fdb-pack-preview-${tradeKey}`);
        if (previewEl) previewEl.style.display = 'block';

        try {
            const resp = await fetch('/api/admin/prompt-packs/upgrade/apply', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    companyId: this.companyId,
                    tradeKey,
                    toPack,
                    changedBy: 'admin-ui',
                    notes: 'UI pack upgrade'
                })
            });
            const data = await resp.json();
            if (!resp.ok || data?.success !== true) {
                throw new Error(data?.error || 'Upgrade apply failed');
            }
            if (previewEl) previewEl.textContent = JSON.stringify(data.data, null, 2);
            this.showNotification('✅ Pack upgraded', 'success');
        } catch (error) {
            if (previewEl) previewEl.textContent = `Upgrade failed: ${error.message}`;
            this.showNotification(`❌ ${error.message}`, 'error');
        }
    }

    collectVendorHandlingConfig() {
        const getChecked = (id) => document.getElementById(id)?.checked === true;
        const getValue = (id) => (document.getElementById(id)?.value || '').trim();

        const mode = getValue('fdb-vendor-flow-mode') || 'collect_message';
        return {
            vendorFirstEnabled: getChecked('fdb-vendor-first-enabled') === true,
            enabled: getChecked('fdb-vendor-flow-enabled') === true,
            mode: ['collect_message', 'transfer', 'ignore'].includes(mode) ? mode : 'collect_message',
            allowLinkToCustomer: getChecked('fdb-vendor-allow-link') === true,
            // Prompts are editable later; we keep the existing object if present.
            prompts: this.config.vendorHandling?.prompts || this.getDefaultConfig().vendorHandling.prompts
        };
    }

    collectUnitOfWorkConfig() {
        const getChecked = (id) => document.getElementById(id)?.checked === true;
        const getValue = (id) => (document.getElementById(id)?.value || '').trim();

        const rawPerUnit = getValue('fdb-uow-perUnitSlotIds') || '["address"]';
        let perUnitSlotIds = ['address'];
        try {
            const parsed = JSON.parse(rawPerUnit);
            if (Array.isArray(parsed)) perUnitSlotIds = parsed.map(x => String(x));
        } catch (e) {
            // keep default; UI will show error on save through collectFormData if needed later
        }

        const yesWordsRaw = getValue('fdb-uow-yesWords') || '[]';
        const noWordsRaw = getValue('fdb-uow-noWords') || '[]';
        let yesWords = this.getDefaultConfig().unitOfWork.confirmation.yesWords;
        let noWords = this.getDefaultConfig().unitOfWork.confirmation.noWords;
        try { const p = JSON.parse(yesWordsRaw); if (Array.isArray(p)) yesWords = p.map(x => String(x)); } catch {}
        try { const p = JSON.parse(noWordsRaw); if (Array.isArray(p)) noWords = p.map(x => String(x)); } catch {}

        return {
            enabled: getChecked('fdb-uow-enabled') === true,
            allowMultiplePerCall: getChecked('fdb-uow-allowMultiple') === true,
            maxUnitsPerCall: parseInt(getValue('fdb-uow-maxUnits') || '3', 10) || 3,
            labelSingular: getValue('fdb-uow-labelSingular') || 'Job',
            labelPlural: getValue('fdb-uow-labelPlural') || 'Jobs',
            perUnitSlotIds,
            confirmation: {
                askAddAnotherPrompt: getValue('fdb-uow-askAddAnother') || this.getDefaultConfig().unitOfWork.confirmation.askAddAnotherPrompt,
                clarifyPrompt: getValue('fdb-uow-clarify') || this.getDefaultConfig().unitOfWork.confirmation.clarifyPrompt,
                nextUnitIntro: getValue('fdb-uow-nextIntro') || this.getDefaultConfig().unitOfWork.confirmation.nextUnitIntro,
                finalScriptMulti: getValue('fdb-uow-finalMulti') || this.getDefaultConfig().unitOfWork.confirmation.finalScriptMulti,
                yesWords,
                noWords
            }
        };
    }

    onAfterHoursContractModeChange(mode) {
        const el = document.getElementById('fdb-ah-contract-custom');
        if (!el) return;
        el.style.display = mode === 'custom' ? 'block' : 'none';
    }

    collectAfterHoursMessageContractConfig() {
        const getChecked = (id) => document.getElementById(id)?.checked === true;
        const getValue = (id) => (document.getElementById(id)?.value || '').trim();

        const modeRaw = getValue('fdb-ah-contract-mode') || 'inherit_booking_minimum';
        const mode = ['inherit_booking_minimum', 'custom'].includes(modeRaw) ? modeRaw : 'inherit_booking_minimum';

        // Default: inherit booking minimum (safe baseline)
        if (mode !== 'custom') {
            return {
                mode: 'inherit_booking_minimum',
                requiredFieldKeys: ['name', 'phone', 'address', 'problemSummary', 'preferredTime'],
                extraSlotIds: []
            };
        }

        const requiredFieldKeys = [];
        if (getChecked('fdb-ah-req-name')) requiredFieldKeys.push('name');
        if (getChecked('fdb-ah-req-phone')) requiredFieldKeys.push('phone');
        if (getChecked('fdb-ah-req-address')) requiredFieldKeys.push('address');
        if (getChecked('fdb-ah-req-problem')) requiredFieldKeys.push('problemSummary');
        if (getChecked('fdb-ah-req-time')) requiredFieldKeys.push('preferredTime');

        // Optional extras: booking slot IDs
        const extrasRaw = getValue('fdb-ah-extra-slotIds') || '[]';
        let extraSlotIds = [];
        try {
            const parsed = JSON.parse(extrasRaw);
            if (!Array.isArray(parsed)) {
                throw new Error('Extra slot IDs must be a JSON array');
            }
            extraSlotIds = parsed
                .map(x => String(x || '').trim())
                .filter(Boolean);
            // de-dupe while preserving order
            const seen = new Set();
            extraSlotIds = extraSlotIds.filter(id => (seen.has(id) ? false : (seen.add(id), true)));
        } catch (e) {
            const msg = `After-hours extra slot IDs JSON is invalid: ${e.message}`;
            console.error('[FRONT DESK BEHAVIOR] ❌', msg);
            this.showNotification(`❌ ${msg}`, 'error');
            throw new Error(msg);
        }

        if (requiredFieldKeys.length === 0 && extraSlotIds.length === 0) {
            const msg = 'After-hours custom contract requires at least one required field (or extra slot ID).';
            this.showNotification(`❌ ${msg}`, 'error');
            throw new Error(msg);
        }

        return {
            mode: 'custom',
            requiredFieldKeys,
            extraSlotIds
        };
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
                            <span title="UI Build stamp for Front Desk Behavior page (proves which code is running)"
                                  style="font-size: 0.7rem; padding: 3px 8px; background: #21262d; border: 1px solid #30363d; border-radius: 12px; color: #c9d1d9;">
                                UI Build: ${FrontDeskBehaviorManager.UI_BUILD}
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

                <!-- V57: Deep Verification Health Bar -->
                <div id="fdb-verification-bar" style="margin-bottom: 20px; padding: 16px; background: linear-gradient(135deg, #0d1117, #161b22); border: 1px solid #30363d; border-radius: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <span id="fdb-verify-score" style="font-size: 24px; font-weight: 800; color: #9ca3af;">—%</span>
                            <div>
                                <div id="fdb-verify-status" style="font-size: 13px; font-weight: 600; color: #9ca3af;">Loading verification...</div>
                                <div id="fdb-verify-trade" style="font-size: 11px; color: #6b7280;">Trade: —</div>
                            </div>
                        </div>
                        <button id="fdb-verify-btn" style="padding: 8px 14px; background: linear-gradient(135deg, #3b82f6, #2563eb); border: none; border-radius: 8px; color: white; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                            🔬 Verify Now
                        </button>
                    </div>
                    <div style="margin-top: 12px;">
                        <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                            <div id="fdb-verify-progress" style="height: 100%; width: 0%; background: #9ca3af; transition: width 0.5s, background 0.3s;"></div>
                        </div>
                    </div>
                    <div id="fdb-verify-subtabs" style="margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px;">
                        <!-- Sub-tab badges will be injected here -->
                    </div>
                    <div id="fdb-verify-issues" style="margin-top: 12px; display: none;">
                        <!-- Issues will be shown here -->
                    </div>
                </div>

                <!-- Tab Navigation -->
                <div id="fdb-tabs" style="display: flex; gap: 4px; margin-bottom: 20px; flex-wrap: wrap;">
                    ${this.renderTab('personality', '🎭 Personality', true)}
                    ${this.renderTab('discovery', '🧠 Discovery & Consent')}
                    ${this.renderTab('hours', '🕒 Hours & Availability')}
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
        const warmthPct = Number.isFinite(p.warmth) ? Math.round(p.warmth * 100) : 60;
        const maxWords = Number.isFinite(p.maxResponseWords) ? p.maxResponseWords : 30;
        
        const RECOMMENDED = {
            maxResponseWords: 30,
            warmthPct: 60,
            speakingPace: 'normal'
        };
        
        // Tiny helper for consistent "what does this setting do?" UX.
        // Clickable so it works in all browsers + mobile (no hover dependency).
        const infoIcon = (key) => `
            <button type="button"
                    class="fdb-info-btn"
                    data-info-key="${String(key)}"
                    aria-label="Help"
                    style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; margin-left:8px;
                           border:1px solid #30363d; border-radius:999px; color:#9ca3af; font-size:12px; cursor:pointer; user-select:none;
                           background:#0d1117; padding:0; line-height:18px;">
                i
            </button>
        `;
        
        const warmthHelp = [
            'Warmth controls how empathetic vs direct the AI sounds.',
            'Recommended (World‑Class Default): 60%.',
            'Lower (20–45%): more concise/transactional; can feel robotic if too low.',
            'Higher (75–90%): more reassuring/luxury tone; can feel slow if too high.',
            'Tip: keep warmth ~60% and adjust pace first if you want faster booking.'
        ].join(' ');
        
        const paceHelp = [
            'Speaking Pace controls how quickly the AI moves through the call.',
            'Recommended (World‑Class Default): Normal.',
            'Fast: fewer extra words; better for high call volume + strong scripts.',
            'Slow: more confirmations; better for elderly callers or high-stress scenarios.'
        ].join(' ');
        
        const maxWordsHelp = [
            'Max Response Words is a hard ceiling that prevents the AI from rambling.',
            'Recommended (World‑Class Default): 30 words.',
            'Lower (20–25): very efficient/transactional; can feel abrupt.',
            'Higher (45–60): more explanatory; can feel slow and reduce booking conversion.',
            'Tip: keep this near 30 and use “Warmth” + “Speaking Pace” for most tuning.'
        ].join(' ');
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
                            Max Response Words: <span id="fdb-max-words-val" style="color: #58a6ff;">${maxWords}</span>
                            ${infoIcon('maxResponseWords')}
                            <button type="button"
                                    class="fdb-reset-recommended"
                                    data-reset-key="maxResponseWords"
                                    style="margin-left:10px; padding:2px 8px; font-size:11px; border-radius:999px; cursor:pointer;
                                           border:1px solid #30363d; background:#0d1117; color:#8b949e;">
                                Reset
                            </button>
                        </label>
                        <input type="range" id="fdb-max-words" min="10" max="100" value="${maxWords}" style="width: 100%; accent-color: #58a6ff;">
                        <p style="color: #8b949e; font-size: 0.75rem; margin-top: 4px;">
                            <strong style="color:#fbbf24;">Recommended:</strong> ${RECOMMENDED.maxResponseWords} words (world‑class default). Lower = faster/shorter. Higher = more explanation.
                        </p>
                        <div class="fdb-info-panel" data-info-key="maxResponseWords" style="display:none; margin-top:10px; padding:10px; background:#0d1117; border:1px solid #30363d; border-radius:8px; color:#c9d1d9; font-size:12px; line-height:1.4;">
                            <div style="font-weight:700; color:#fbbf24; margin-bottom:6px;">Max Response Words (anti‑ramble safety)</div>
                            <div>${maxWordsHelp}</div>
                        </div>
                    </div>

                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                            Warmth: <span id="fdb-warmth-val" style="color: #58a6ff;">${warmthPct}%</span>
                            ${infoIcon('warmth')}
                            <button type="button"
                                    class="fdb-reset-recommended"
                                    data-reset-key="warmth"
                                    style="margin-left:10px; padding:2px 8px; font-size:11px; border-radius:999px; cursor:pointer;
                                           border:1px solid #30363d; background:#0d1117; color:#8b949e;">
                                Reset
                            </button>
                        </label>
                        <input type="range" id="fdb-warmth" min="0" max="100" value="${warmthPct}" style="width: 100%; accent-color: #f59e0b;">
                        <p style="color: #8b949e; font-size: 0.75rem; margin-top: 4px;">
                            <strong style="color:#fbbf24;">Recommended:</strong> 60% (world‑class default). Higher warmth = more empathetic. Lower warmth = more direct.
                        </p>
                        <div class="fdb-info-panel" data-info-key="warmth" style="display:none; margin-top:10px; padding:10px; background:#0d1117; border:1px solid #30363d; border-radius:8px; color:#c9d1d9; font-size:12px; line-height:1.4;">
                            <div style="font-weight:700; color:#fbbf24; margin-bottom:6px;">Warmth (how it sounds)</div>
                            <div>${warmthHelp}</div>
                        </div>
                    </div>

                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                            Speaking Pace
                            ${infoIcon('speakingPace')}
                            <button type="button"
                                    class="fdb-reset-recommended"
                                    data-reset-key="speakingPace"
                                    style="margin-left:10px; padding:2px 8px; font-size:11px; border-radius:999px; cursor:pointer;
                                           border:1px solid #30363d; background:#0d1117; color:#8b949e;">
                                Reset
                            </button>
                        </label>
                        <select id="fdb-speaking-pace" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                            <option value="slow" ${(p.speakingPace || 'normal') === 'slow' ? 'selected' : ''}>🐢 Slow - more pauses, more confirmation</option>
                            <option value="normal" ${(p.speakingPace || 'normal') === 'normal' ? 'selected' : ''}>🚶 Normal - balanced</option>
                            <option value="fast" ${(p.speakingPace || 'normal') === 'fast' ? 'selected' : ''}>🏃 Fast - moves through booking quickly</option>
                        </select>
                        <p style="color: #8b949e; font-size: 0.75rem; margin-top: 4px;">
                            <strong style="color:#fbbf24;">Recommended:</strong> Normal (world‑class default).
                        </p>
                        <div class="fdb-info-panel" data-info-key="speakingPace" style="display:none; margin-top:10px; padding:10px; background:#0d1117; border:1px solid #30363d; border-radius:8px; color:#c9d1d9; font-size:12px; line-height:1.4;">
                            <div style="font-weight:700; color:#fbbf24; margin-bottom:6px;">Speaking Pace (how it moves)</div>
                            <div>${paceHelp}</div>
                        </div>
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

    // ============================================================================
    // BUSINESS HOURS - Canonical company truth used by:
    // - AfterHoursEvaluator (single source of truth)
    // - DynamicFlowEngine trigger: after_hours
    //
    // Stored at: aiAgentSettings.businessHours
    // ============================================================================
    renderHoursTab() {
        const bh = (this.config.businessHours && typeof this.config.businessHours === 'object')
            ? this.config.businessHours
            : {};

        const tz = (bh.timezone || 'America/New_York');
        const weekly = (bh.weekly && typeof bh.weekly === 'object') ? bh.weekly : {};
        const holidays = Array.isArray(bh.holidays) ? bh.holidays : [];

        const days = [
            { key: 'mon', label: 'Mon' },
            { key: 'tue', label: 'Tue' },
            { key: 'wed', label: 'Wed' },
            { key: 'thu', label: 'Thu' },
            { key: 'fri', label: 'Fri' },
            { key: 'sat', label: 'Sat' },
            { key: 'sun', label: 'Sun' }
        ];

        const renderDayRow = (d) => {
            const dayVal = (d.key in weekly) ? weekly[d.key] : null;
            const closed = dayVal === null;
            const open = closed ? '' : (dayVal?.open || '');
            const close = closed ? '' : (dayVal?.close || '');
            const disabled = closed ? 'disabled' : '';

            return `
                <div class="bh-row" style="display:flex; align-items:center; gap:10px; padding:10px; border:1px solid #30363d; border-radius:8px; background:#0d1117;">
                    <div style="width:48px; color:#c9d1d9; font-weight:600;">${d.label}</div>
                    <input id="bh-${d.key}-open" ${disabled} placeholder="08:00" value="${open}"
                        style="width:120px; padding:10px; background:#0d1117; border:1px solid #30363d; border-radius:6px; color:#c9d1d9;">
                    <input id="bh-${d.key}-close" ${disabled} placeholder="17:00" value="${close}"
                        style="width:120px; padding:10px; background:#0d1117; border:1px solid #30363d; border-radius:6px; color:#c9d1d9;">
                    <label style="display:flex; align-items:center; gap:8px; margin-left:auto; color:#8b949e; cursor:pointer;">
                        <input id="bh-${d.key}-closed" type="checkbox" ${closed ? 'checked' : ''} style="accent-color:#58a6ff;">
                        Closed
                    </label>
                </div>
            `;
        };

        return `
            <div data-section-id="hours-availability" data-field-id="businessHours"
                 style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:20px;">
                <h3 style="margin:0 0 10px 0; color:#58a6ff;">🕒 Business Hours</h3>
                <p style="color:#8b949e; margin:0 0 18px 0; font-size:0.875rem;">
                    Canonical hours used for after-hours routing (Dynamic Flow trigger <code style="color:#c9d1d9;">after_hours</code>).
                    Stored at <code style="color:#c9d1d9;">aiAgentSettings.businessHours</code>.
                </p>

                <div style="margin-bottom:16px;">
                    <label style="display:block; margin-bottom:6px; color:#c9d1d9; font-weight:600;">Timezone</label>
                    <input id="bh-timezone" value="${tz}" placeholder="America/New_York"
                        style="width: 320px; padding: 10px; background:#0d1117; border:1px solid #30363d; border-radius:6px; color:#c9d1d9;">
                </div>

                <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:16px;">
                    ${days.map(renderDayRow).join('')}
                </div>

                <div style="margin-bottom:16px;">
                    <label style="display:block; margin-bottom:6px; color:#c9d1d9; font-weight:600;">
                        Holidays (YYYY-MM-DD, comma-separated)
                    </label>
                    <input id="bh-holidays" value="${holidays.join(', ')}" placeholder="2026-01-01, 2026-12-25"
                        style="width: 100%; padding: 10px; background:#0d1117; border:1px solid #30363d; border-radius:6px; color:#c9d1d9;">
                </div>

                <div style="display:flex; align-items:center; gap:12px;">
                    <button id="bh-save-btn" type="button"
                        style="padding:10px 16px; background:#238636; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:600;">
                        Save Hours
                    </button>
                    <span id="bh-status" style="color:#8b949e; font-size:0.875rem;"></span>
                </div>
            </div>
        `;
    }

    renderBookingPromptsTab() {
        // Use new bookingSlots if available, otherwise migrate from legacy bookingPrompts
        const slots = this.config.bookingSlots || this.getDefaultBookingSlots();
        const templates = this.config.bookingTemplates || this.config.bookingPrompts || {};
        
        const slotLibraryJson = this.escapeHtml(JSON.stringify(this.config.slotLibrary || [], null, 2));
        const slotGroupsJson = this.escapeHtml(JSON.stringify(this.config.slotGroups || [], null, 2));
        const v2Enabled = this.config.bookingContractV2Enabled === true;
        const vendorHandling = this.config.vendorHandling || {};
        const vendorFirstEnabled = vendorHandling.vendorFirstEnabled === true;
        const vendorEnabled = vendorHandling.enabled === true;
        const vendorMode = vendorHandling.mode || 'collect_message';
        const vendorAllowLinkToCustomer = vendorHandling.allowLinkToCustomer === true;
        const uow = this.config.unitOfWork || {};
        const uowEnabled = uow.enabled === true;
        const uowAllowMultiple = uow.allowMultiplePerCall === true;
        const uowMax = uow.maxUnitsPerCall || 3;
        const uowLabelSingular = uow.labelSingular || 'Job';
        const uowLabelPlural = uow.labelPlural || 'Jobs';
        const uowPerUnitSlotIds = this.escapeHtml(JSON.stringify(uow.perUnitSlotIds || ['address'], null, 0));
        const uowYesWords = this.escapeHtml(JSON.stringify(uow.confirmation?.yesWords || [], null, 0));
        const uowNoWords = this.escapeHtml(JSON.stringify(uow.confirmation?.noWords || [], null, 0));
        const uowAskAddAnother = this.escapeHtml(uow.confirmation?.askAddAnotherPrompt || '');
        const uowClarify = this.escapeHtml(uow.confirmation?.clarifyPrompt || '');
        const uowNextIntro = this.escapeHtml(uow.confirmation?.nextUnitIntro || '');
        const uowFinalMulti = this.escapeHtml(uow.confirmation?.finalScriptMulti || '');

        const serviceFlow = this.config.serviceFlow || {};
        const serviceFlowMode = serviceFlow.mode || 'hybrid';
        const serviceFlowTrades = Array.isArray(serviceFlow.trades) ? serviceFlow.trades : [];
        const serviceFlowTradesValue = this.escapeHtml(serviceFlowTrades.join(', '));
        const serviceFlowPromptsMap = this.config.bookingPromptsMap || {};
        const serviceFlowPromptKeysByTrade = serviceFlow.promptKeysByTrade || {};
        const promptGuards = this.config.promptGuards || {};
        const promptPacks = this.config.promptPacks || {};
        const promptPackRegistry = this.promptPackRegistry || { packs: {}, byTrade: {} };
        const selectedPacksByTrade = promptPacks.selectedByTrade || {};
        // V83 FIX: Use colons instead of dots - Mongoose Maps don't allow dots in keys
        const missingPromptFallbackKey = promptGuards.missingPromptFallbackKey || 'booking:universal:guardrails:missing_prompt_fallback';
        const resolvePackPrompt = (promptKey) => {
            // V83 FIX: Support BOTH dots (legacy prompt packs) and colons (new keys)
            const match = /^booking[.:]([a-z0-9_]+)[.:]/i.exec(String(promptKey || '').trim());
            const tradeKey = match ? match[1].toLowerCase() : 'universal';
            const packId = selectedPacksByTrade[tradeKey] || selectedPacksByTrade.universal || null;
            if (!packId) return '';
            const pack = promptPackRegistry.packs?.[packId] || null;
            return pack?.prompts?.[promptKey] || '';
        };
        const missingPromptFallbackText = this.escapeHtml(
            serviceFlowPromptsMap[missingPromptFallbackKey] || resolvePackPrompt(missingPromptFallbackKey) || ''
        );
        const bookingInterruption = this.config.bookingInterruption || this.getDefaultConfig().bookingInterruption;
        // V83 FIX: Use colons instead of dots - Mongoose Maps don't allow dots in keys
        const interruptionKeys = {
            systemHeader: 'booking:universal:interruption:system_header',
            ackWithName: 'booking:universal:interruption:ack_with_name',
            ackShort: 'booking:universal:interruption:ack_short',
            genericAck: 'booking:universal:interruption:generic_ack',
            prohibitPhrases: 'booking:universal:interruption:prohibit_phrases'
        };
        const interruptionTexts = {
            systemHeader: this.escapeHtml(serviceFlowPromptsMap[interruptionKeys.systemHeader] || resolvePackPrompt(interruptionKeys.systemHeader) || ''),
            ackWithName: this.escapeHtml(serviceFlowPromptsMap[interruptionKeys.ackWithName] || resolvePackPrompt(interruptionKeys.ackWithName) || ''),
            ackShort: this.escapeHtml(serviceFlowPromptsMap[interruptionKeys.ackShort] || resolvePackPrompt(interruptionKeys.ackShort) || ''),
            genericAck: this.escapeHtml(serviceFlowPromptsMap[interruptionKeys.genericAck] || resolvePackPrompt(interruptionKeys.genericAck) || ''),
            prohibitPhrases: this.escapeHtml(serviceFlowPromptsMap[interruptionKeys.prohibitPhrases] || resolvePackPrompt(interruptionKeys.prohibitPhrases) || '')
        };
        const shortClarificationsText = this.escapeHtml(
            Array.isArray(bookingInterruption.shortClarificationPatterns)
                ? bookingInterruption.shortClarificationPatterns.join('\n')
                : ''
        );
        const renderServiceFlowTrade = (tradeKeyRaw) => {
            const tradeKey = String(tradeKeyRaw || '').trim().toLowerCase();
            if (!tradeKey) return '';
            const safeId = tradeKey.replace(/[^a-z0-9]+/gi, '_');
            const existingKeys = serviceFlowPromptKeysByTrade[tradeKey] || {};
            // V83 FIX: Use colons instead of dots - Mongoose Maps don't allow dots in keys
            const keyNonUrgent = existingKeys.nonUrgentConsent || `booking:${tradeKey}:service:non_urgent_consent`;
            const keyUrgent = existingKeys.urgentTriageQuestion || `booking:${tradeKey}:service:urgent_triage_question`;
            const keyPostTriage = existingKeys.postTriageConsent || `booking:${tradeKey}:service:post_triage_consent`;
            const keyClarify = existingKeys.consentClarify || `booking:${tradeKey}:service:consent_clarify`;
            const nonUrgentText = this.escapeHtml(serviceFlowPromptsMap[keyNonUrgent] || resolvePackPrompt(keyNonUrgent) || '');
            const urgentText = this.escapeHtml(serviceFlowPromptsMap[keyUrgent] || resolvePackPrompt(keyUrgent) || '');
            const postTriageText = this.escapeHtml(serviceFlowPromptsMap[keyPostTriage] || resolvePackPrompt(keyPostTriage) || '');
            const clarifyText = this.escapeHtml(serviceFlowPromptsMap[keyClarify] || resolvePackPrompt(keyClarify) || '');

            return `
                <div style="border: 1px solid #30363d; border-radius: 8px; padding: 14px; margin-top: 12px; background: #0d1117;">
                    <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <strong style="color: #58a6ff;">${tradeKey.toUpperCase()}</strong>
                        <span style="color:#8b949e; font-size: 0.75rem;">Prompt keys live in bookingPromptsMap</span>
                    </div>
                    <div style="display:grid; gap: 12px;">
                        <div>
                            <label style="display:block; margin-bottom: 6px; color:#c9d1d9; font-weight: 500;">Non-Urgent Consent</label>
                            <input type="text" value="${this.escapeHtml(keyNonUrgent)}" disabled
                                style="width: 100%; padding: 8px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #6e7681; margin-bottom: 6px;">
                            <textarea id="fdb-sf-${safeId}-nonUrgent" rows="2" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical;">${nonUrgentText}</textarea>
                        </div>
                        <div>
                            <label style="display:block; margin-bottom: 6px; color:#c9d1d9; font-weight: 500;">Urgent Triage Question</label>
                            <input type="text" value="${this.escapeHtml(keyUrgent)}" disabled
                                style="width: 100%; padding: 8px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #6e7681; margin-bottom: 6px;">
                            <textarea id="fdb-sf-${safeId}-urgent" rows="2" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical;">${urgentText}</textarea>
                        </div>
                        <div>
                            <label style="display:block; margin-bottom: 6px; color:#c9d1d9; font-weight: 500;">Post-Triage Consent</label>
                            <input type="text" value="${this.escapeHtml(keyPostTriage)}" disabled
                                style="width: 100%; padding: 8px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #6e7681; margin-bottom: 6px;">
                            <textarea id="fdb-sf-${safeId}-postTriage" rows="2" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical;">${postTriageText}</textarea>
                        </div>
                        <div>
                            <label style="display:block; margin-bottom: 6px; color:#c9d1d9; font-weight: 500;">Consent Clarify (optional)</label>
                            <input type="text" value="${this.escapeHtml(keyClarify)}" disabled
                                style="width: 100%; padding: 8px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #6e7681; margin-bottom: 6px;">
                            <textarea id="fdb-sf-${safeId}-clarify" rows="2" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical;">${clarifyText}</textarea>
                        </div>
                    </div>
                </div>
            `;
        };
        const serviceFlowTradeBlocks = serviceFlowTrades.map(renderServiceFlowTrade).join('');

        // After-hours message contract (deterministic)
        const ah = this.config.afterHoursMessageContract || {};
        const ahMode = ah.mode || 'inherit_booking_minimum';
        const ahRequiredRaw = Array.isArray(ah.requiredFieldKeys) ? ah.requiredFieldKeys : [];
        const ahRequired = ahRequiredRaw.length > 0
            ? ahRequiredRaw
            : ['name', 'phone', 'address', 'problemSummary', 'preferredTime'];
        const ahExtraSlotIds = this.escapeHtml(JSON.stringify(Array.isArray(ah.extraSlotIds) ? ah.extraSlotIds : [], null, 0));
        const ahCustomVisible = ahMode === 'custom';
        const ahReqName = ahRequired.includes('name');
        const ahReqPhone = ahRequired.includes('phone');
        const ahReqAddress = ahRequired.includes('address');
        const ahReqProblem = ahRequired.includes('problemSummary');
        const ahReqTime = ahRequired.includes('preferredTime');

        return `
            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <!-- BOOKING CONTRACT V2 (BETA) - Slot Library + Slot Groups -->
            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <div style="background: #0d1117; border: 1px solid ${v2Enabled ? '#3fb950' : '#30363d'}; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                    <div>
                        <h3 style="margin: 0; color: ${v2Enabled ? '#3fb950' : '#58a6ff'};">🧾 Booking Contract V2 (Beta)</h3>
                        <p style="margin: 6px 0 0 0; color: #8b949e; font-size: 0.8rem;">
                            This is the clean “receptionist requirements” layer: <strong>Slot Library</strong> (what can be collected) + <strong>Slot Groups</strong> (when to ask) compiled using <code style="background:#161b22; padding:2px 6px; border-radius:4px;">session.flags</code>.
                            <br><span style="color:#f0883e;">Safe rollout:</span> V2 is OFF unless you enable it here for this company.
                        </p>
                    </div>
                    <label style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; cursor: pointer;">
                        <input type="checkbox" id="fdb-bcv2-enabled" ${v2Enabled ? 'checked' : ''} style="accent-color: #3fb950; width: 18px; height: 18px;">
                        <span style="color: ${v2Enabled ? '#3fb950' : '#8b949e'}; font-weight: 700;">
                            ${v2Enabled ? 'ENABLED' : 'DISABLED'}
                        </span>
                    </label>
                </div>

                <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px;">
                    <button id="fdb-bcv2-migrate-btn"
                        onclick="window.frontDeskManager.migrateBookingContractV2FromBookingSlots()"
                        style="padding: 8px 12px; background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px; cursor: pointer; font-weight: 600;">
                        🔁 Migrate from current Booking Slots
                    </button>
                    <input id="fdb-bcv2-flags-json" value="{}"
                        placeholder='{"accountType":"commercial"}'
                        style="flex: 1; min-width: 260px; padding: 8px 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-family: monospace; font-size: 12px;">
                    <button id="fdb-bcv2-preview-btn"
                        onclick="window.frontDeskManager.previewBookingContractV2Compile()"
                        style="padding: 8px 12px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 700;">
                        🔍 Preview compile
                    </button>
                </div>

                <div id="fdb-bcv2-preview-status" style="margin-top: 10px; display: none; padding: 10px 12px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #8b949e; font-size: 12px;"></div>
                <pre id="fdb-bcv2-preview-output" style="margin-top: 10px; display: none; padding: 12px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; max-height: 220px; overflow: auto; font-size: 12px;"></pre>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;">
                    <div>
                        <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">
                            Slot Library JSON <span style="color:#6e7681;">(what to collect)</span>
                        </label>
                        <textarea id="fdb-bcv2-slotLibrary-json" rows="10"
                            style="width: 100%; padding: 10px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-family: monospace; font-size: 12px; resize: vertical;">${slotLibraryJson}</textarea>
                    </div>
                    <div>
                        <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">
                            Slot Groups JSON <span style="color:#6e7681;">(when to ask)</span>
                        </label>
                        <textarea id="fdb-bcv2-slotGroups-json" rows="10"
                            style="width: 100%; padding: 10px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-family: monospace; font-size: 12px; resize: vertical;">${slotGroupsJson}</textarea>
                    </div>
                </div>
                <p style="margin: 10px 0 0 0; color: #6e7681; font-size: 0.75rem;">
                    Tip: Dynamic Flows can set flags (e.g. <code style="background:#161b22; padding:2px 6px; border-radius:4px;">accountType=commercial</code>), and Slot Groups can activate additional required questions based on those flags.
                </p>
            </div>
            
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
                <!-- ═══════════════════════════════════════════════════════════════════════ -->
                <!-- VENDOR / SUPPLIER HANDLING (Call Center Directory) -->
                <!-- ═══════════════════════════════════════════════════════════════════════ -->
                <div style="background: #0d1117; border: 1px solid ${vendorFirstEnabled ? '#3fb950' : '#30363d'}; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                    <div style="display:flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                        <div>
                            <h3 style="margin: 0; color: #58a6ff;">🏷️ Vendor / Supplier Calls</h3>
                            <p style="margin: 6px 0 0 0; color: #8b949e; font-size: 0.8rem;">
                                If enabled, inbound calls from known Vendors (by phone) are handled as <strong>non-customer</strong> calls.
                                This prevents supplier numbers from polluting your Customer directory.
                            </p>
                        </div>
                    </div>
                    
                    <div style="display:flex; gap: 14px; flex-wrap: wrap; margin-top: 12px;">
                        <label style="display:flex; align-items:center; gap: 10px; padding: 10px 12px; background:#161b22; border:1px solid #30363d; border-radius: 8px; cursor:pointer;">
                            <input type="checkbox" id="fdb-vendor-first-enabled" ${vendorFirstEnabled ? 'checked' : ''} style="accent-color:#3fb950; width: 18px; height: 18px;">
                            <span style="color:${vendorFirstEnabled ? '#3fb950' : '#8b949e'}; font-weight:700;">
                                Vendor-first identity (recommended)
                            </span>
                        </label>
                        <label style="display:flex; align-items:center; gap: 10px; padding: 10px 12px; background:#161b22; border:1px solid #30363d; border-radius: 8px; cursor:pointer;">
                            <input type="checkbox" id="fdb-vendor-flow-enabled" ${vendorEnabled ? 'checked' : ''} style="accent-color:#3fb950; width: 18px; height: 18px;">
                            <span style="color:${vendorEnabled ? '#3fb950' : '#8b949e'}; font-weight:700;">
                                Enable vendor message flow
                            </span>
                        </label>
                        <label style="display:flex; align-items:center; gap: 8px; padding: 10px 12px; background:#161b22; border:1px solid #30363d; border-radius: 8px;">
                            <span style="color:#8b949e; font-weight:700;">Mode</span>
                            <select id="fdb-vendor-flow-mode" style="padding: 8px 10px; background:#0b0f14; border:1px solid #30363d; border-radius: 6px; color:#c9d1d9;">
                                <option value="collect_message" ${vendorMode === 'collect_message' ? 'selected' : ''}>Collect message → transfer</option>
                                <option value="transfer" ${vendorMode === 'transfer' ? 'selected' : ''}>Transfer immediately (still logs vendor)</option>
                                <option value="ignore" ${vendorMode === 'ignore' ? 'selected' : ''}>Ignore vendor special handling</option>
                            </select>
                        </label>
                        <label style="display:flex; align-items:center; gap: 10px; padding: 10px 12px; background:#161b22; border:1px solid #30363d; border-radius: 8px; cursor:pointer;">
                            <input type="checkbox" id="fdb-vendor-allow-link" ${vendorAllowLinkToCustomer ? 'checked' : ''} style="accent-color:#58a6ff; width: 18px; height: 18px;">
                            <span style="color:#c9d1d9; font-weight:700;">
                                Allow optional “link to customer/work order” questions
                            </span>
                        </label>
                    </div>
                    
                    <p style="margin: 10px 0 0 0; color: #6e7681; font-size: 0.75rem;">
                        Tip: Manage Vendors in the Call Center directory. Vendor-first works by matching the caller’s phone to a saved Vendor phone/secondary phone.
                    </p>
                </div>

                <!-- ═══════════════════════════════════════════════════════════════════════ -->
                <!-- AFTER-HOURS MESSAGE CONTRACT (Deterministic) -->
                <!-- ═══════════════════════════════════════════════════════════════════════ -->
                <div style="background: #0d1117; border: 1px solid ${ahMode === 'custom' ? '#f0883e' : '#30363d'}; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                    <div style="display:flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                        <div>
                            <h3 style="margin: 0; color: #58a6ff;">🌙 After-Hours Message Contract</h3>
                            <p style="margin: 6px 0 0 0; color: #8b949e; font-size: 0.8rem;">
                                Enterprise default: after-hours message-taking asks the <strong>booking minimum</strong> (name, phone, address, issue, time) and requires confirmation.
                                <br><span style="color:#6e7681;">Use <strong>Custom</strong> only if your after-hours policy needs a different required set.</span>
                            </p>
                        </div>
                        <div style="display:flex; align-items:center; gap: 10px; padding: 10px 12px; background:#161b22; border:1px solid #30363d; border-radius: 8px;">
                            <span style="color:#8b949e; font-weight:700;">Mode</span>
                            <select id="fdb-ah-contract-mode"
                                onchange="window.frontDeskManager.onAfterHoursContractModeChange(this.value)"
                                style="padding: 8px 10px; background:#0b0f14; border:1px solid #30363d; border-radius: 6px; color:#c9d1d9;">
                                <option value="inherit_booking_minimum" ${ahMode === 'inherit_booking_minimum' ? 'selected' : ''}>Inherit booking minimum (recommended)</option>
                                <option value="custom" ${ahMode === 'custom' ? 'selected' : ''}>Custom required fields</option>
                            </select>
                        </div>
                    </div>

                    <div id="fdb-ah-contract-custom" style="margin-top: 12px; display: ${ahCustomVisible ? 'block' : 'none'};">
                        <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px;">
                            <div style="display:flex; flex-wrap: wrap; gap: 10px;">
                                <label style="display:flex; align-items:center; gap: 8px; padding: 8px 10px; background:#0b0f14; border:1px solid #30363d; border-radius: 8px; cursor:pointer;">
                                    <input type="checkbox" id="fdb-ah-req-name" ${ahReqName ? 'checked' : ''} style="accent-color:#f0883e; width: 16px; height: 16px;">
                                    <span style="color:#c9d1d9; font-weight:700;">Name</span>
                                </label>
                                <label style="display:flex; align-items:center; gap: 8px; padding: 8px 10px; background:#0b0f14; border:1px solid #30363d; border-radius: 8px; cursor:pointer;">
                                    <input type="checkbox" id="fdb-ah-req-phone" ${ahReqPhone ? 'checked' : ''} style="accent-color:#f0883e; width: 16px; height: 16px;">
                                    <span style="color:#c9d1d9; font-weight:700;">Phone</span>
                                </label>
                                <label style="display:flex; align-items:center; gap: 8px; padding: 8px 10px; background:#0b0f14; border:1px solid #30363d; border-radius: 8px; cursor:pointer;">
                                    <input type="checkbox" id="fdb-ah-req-address" ${ahReqAddress ? 'checked' : ''} style="accent-color:#f0883e; width: 16px; height: 16px;">
                                    <span style="color:#c9d1d9; font-weight:700;">Service Address</span>
                                </label>
                                <label style="display:flex; align-items:center; gap: 8px; padding: 8px 10px; background:#0b0f14; border:1px solid #30363d; border-radius: 8px; cursor:pointer;">
                                    <input type="checkbox" id="fdb-ah-req-problem" ${ahReqProblem ? 'checked' : ''} style="accent-color:#f0883e; width: 16px; height: 16px;">
                                    <span style="color:#c9d1d9; font-weight:700;">Problem Summary</span>
                                </label>
                                <label style="display:flex; align-items:center; gap: 8px; padding: 8px 10px; background:#0b0f14; border:1px solid #30363d; border-radius: 8px; cursor:pointer;">
                                    <input type="checkbox" id="fdb-ah-req-time" ${ahReqTime ? 'checked' : ''} style="accent-color:#f0883e; width: 16px; height: 16px;">
                                    <span style="color:#c9d1d9; font-weight:700;">Preferred Time</span>
                                </label>
                            </div>

                            <div style="margin-top: 12px;">
                                <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">
                                    Extra booking slot IDs (JSON array) <span style="color:#6e7681;">(optional: additional fields to collect after-hours)</span>
                                </label>
                                <input id="fdb-ah-extra-slotIds" value='${ahExtraSlotIds}'
                                    placeholder='["email","gateCode","unitNumber"]'
                                    style="width: 100%; padding: 10px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-family: monospace; font-size: 12px;">
                                <p style="margin: 8px 0 0 0; color:#6e7681; font-size: 0.75rem;">
                                    Tip: these must match <strong>Booking Slots</strong> IDs so the question text stays UI-controlled.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ═══════════════════════════════════════════════════════════════════════ -->
                <!-- UNIT OF WORK (UoW) - Multi-location / multi-job in one call -->
                <!-- ═══════════════════════════════════════════════════════════════════════ -->
                <div style="background: #0d1117; border: 1px solid ${uowEnabled ? '#3fb950' : '#30363d'}; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                    <div>
                        <h3 style="margin: 0; color: #58a6ff;">📦 Unit of Work (Universal)</h3>
                        <p style="margin: 6px 0 0 0; color: #8b949e; font-size: 0.8rem;">
                            Makes multi-location calls safe. Default is <strong>one</strong> unit per call; the AI only adds another after explicit confirmation.
                            This works across trades (service job, delivery stop, appointment, etc.) because it’s just a container + required slots.
                        </p>
                    </div>

                    <div style="display:flex; gap: 14px; flex-wrap: wrap; margin-top: 12px;">
                        <label style="display:flex; align-items:center; gap: 10px; padding: 10px 12px; background:#161b22; border:1px solid #30363d; border-radius: 8px; cursor:pointer;">
                            <input type="checkbox" id="fdb-uow-enabled" ${uowEnabled ? 'checked' : ''} style="accent-color:#3fb950; width: 18px; height: 18px;">
                            <span style="color:${uowEnabled ? '#3fb950' : '#8b949e'}; font-weight:700;">Enable Unit of Work container</span>
                        </label>
                        <label style="display:flex; align-items:center; gap: 10px; padding: 10px 12px; background:#161b22; border:1px solid #30363d; border-radius: 8px; cursor:pointer;">
                            <input type="checkbox" id="fdb-uow-allowMultiple" ${uowAllowMultiple ? 'checked' : ''} style="accent-color:#3fb950; width: 18px; height: 18px;">
                            <span style="color:${uowAllowMultiple ? '#3fb950' : '#8b949e'}; font-weight:700;">Allow multiple per call (explicitly confirmed)</span>
                        </label>
                        <label style="display:flex; align-items:center; gap: 8px; padding: 10px 12px; background:#161b22; border:1px solid #30363d; border-radius: 8px;">
                            <span style="color:#8b949e; font-weight:700;">Max</span>
                            <input id="fdb-uow-maxUnits" value="${uowMax}" type="number" min="1" max="10"
                                style="width: 90px; padding: 8px 10px; background:#0b0f14; border:1px solid #30363d; border-radius: 6px; color:#c9d1d9;">
                        </label>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;">
                        <div>
                            <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">Label (singular)</label>
                            <input id="fdb-uow-labelSingular" value="${this.escapeHtml(uowLabelSingular)}"
                                style="width: 100%; padding: 10px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                        <div>
                            <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">Label (plural)</label>
                            <input id="fdb-uow-labelPlural" value="${this.escapeHtml(uowLabelPlural)}"
                                style="width: 100%; padding: 10px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                    </div>

                    <div style="margin-top: 12px;">
                        <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">
                            Per-unit Slot IDs (JSON array) <span style="color:#6e7681;">(these will be re-collected for each new unit)</span>
                        </label>
                        <input id="fdb-uow-perUnitSlotIds" value='${uowPerUnitSlotIds}'
                            style="width: 100%; padding: 10px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-family: monospace; font-size: 12px;">
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;">
                        <div>
                            <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">Yes words (JSON array)</label>
                            <input id="fdb-uow-yesWords" value='${uowYesWords}'
                                style="width: 100%; padding: 10px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-family: monospace; font-size: 12px;">
                        </div>
                        <div>
                            <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">No words (JSON array)</label>
                            <input id="fdb-uow-noWords" value='${uowNoWords}'
                                style="width: 100%; padding: 10px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-family: monospace; font-size: 12px;">
                        </div>
                    </div>

                    <div style="margin-top: 12px; display:grid; gap: 10px;">
                        <div>
                            <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">Ask “add another?” prompt</label>
                            <input id="fdb-uow-askAddAnother" value="${uowAskAddAnother}"
                                style="width: 100%; padding: 10px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                        <div>
                            <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">Clarify prompt</label>
                            <input id="fdb-uow-clarify" value="${uowClarify}"
                                style="width: 100%; padding: 10px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                        <div>
                            <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">Next unit intro</label>
                            <input id="fdb-uow-nextIntro" value="${uowNextIntro}"
                                style="width: 100%; padding: 10px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                        <div>
                            <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">Final script (multi-unit)</label>
                            <input id="fdb-uow-finalMulti" value="${uowFinalMulti}"
                                style="width: 100%; padding: 10px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                    </div>
                </div>

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
                    <div>
                        <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Missing Prompt Fallback (Guardrail)</label>
                        <input type="text" id="fdb-missingPromptFallbackKey" value="${this.escapeHtml(missingPromptFallbackKey)}"
                            style="width: 100%; padding: 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; margin-bottom: 6px;">
                        <textarea id="fdb-missingPromptFallback" rows="2" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical;">${missingPromptFallbackText || "Would you like to schedule a service visit?"}</textarea>
                        <p style="color:#8b949e; font-size:0.75rem; margin:6px 0 0 0;">Used only if a configured prompt key has no tenant text.</p>
                    </div>
                </div>
            </div>

            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <!-- Booking Interruption Behavior -->
            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <div style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:20px; margin-top:16px;">
                <h3 style="margin: 0 0 10px 0; color: #58a6ff;">🧭 Booking Interruption Behavior</h3>
                <p style="color: #8b949e; margin-bottom: 16px; font-size: 0.8rem;">
                    Slot-safe interruption handling. Text is stored in <code style="background:#0d1117; padding:2px 6px; border-radius:4px;">bookingPromptsMap</code>.
                </p>

                <div style="display:grid; gap:12px; margin-bottom:16px;">
                    <label style="display:flex; align-items:center; gap:10px; color:#c9d1d9;">
                        <input type="checkbox" id="fdb-interrupt-enabled" ${bookingInterruption.enabled !== false ? 'checked' : ''} style="accent-color:#58a6ff;">
                        Enable booking interruption handling
                    </label>
                    <label style="display:flex; align-items:center; gap:10px; color:#c9d1d9;">
                        <input type="checkbox" id="fdb-interrupt-oneSlot" ${bookingInterruption.oneSlotPerTurn !== false ? 'checked' : ''} style="accent-color:#58a6ff;">
                        One slot per turn (never mix questions)
                    </label>
                    <label style="display:flex; align-items:center; gap:10px; color:#c9d1d9;">
                        <input type="checkbox" id="fdb-interrupt-forceReturn" ${bookingInterruption.forceReturnToQuestionAsLastLine !== false ? 'checked' : ''} style="accent-color:#58a6ff;">
                        Force returnToQuestion as last line
                    </label>
                    <label style="display:flex; align-items:center; gap:10px; color:#c9d1d9;">
                        <input type="checkbox" id="fdb-interrupt-allowEmpathy" ${bookingInterruption.allowEmpathyLanguage === true ? 'checked' : ''} style="accent-color:#58a6ff;">
                        Allow empathy language
                    </label>
                    <div>
                        <label style="display:block; margin-bottom:6px; color:#c9d1d9; font-weight:500;">Max acknowledgment sentences</label>
                        <input id="fdb-interrupt-maxSentences" type="number" min="1" max="5" value="${Number(bookingInterruption.maxSentences || 2)}"
                            style="width: 120px; padding: 8px; background:#0d1117; border:1px solid #30363d; border-radius:6px; color:#c9d1d9;">
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:6px; color:#c9d1d9; font-weight:500;">Short Clarification Patterns (one per line)</label>
                        <textarea id="fdb-interrupt-shortClarifications" rows="3" style="width: 100%; padding: 10px; background:#0d1117; border:1px solid #30363d; border-radius:6px; color:#c9d1d9; resize: vertical;">${shortClarificationsText}</textarea>
                    </div>
                </div>

                <!-- ═══════════════════════════════════════════════════════════════════════ -->
                <!-- 🆕 MID-BOOKING INTERRUPTION HANDLING - Humans go off on tangents! -->
                <!-- ═══════════════════════════════════════════════════════════════════════ -->
                <div style="background:#0d1117; border:2px solid #f0883e; border-radius:8px; padding:16px; margin-top:16px;">
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
                        <span style="font-size:20px;">🧠</span>
                        <div>
                            <h4 style="margin:0; color:#f0883e;">Mid-Booking Interruption Handling</h4>
                            <p style="margin:4px 0 0 0; color:#8b949e; font-size:12px;">
                                When caller asks questions mid-booking, AI answers briefly then returns to the slot.
                            </p>
                        </div>
                    </div>
                    
                    <div style="display:grid; gap:14px;">
                        <!-- Allowed Interrupt Categories -->
                        <div>
                            <label style="display:block; margin-bottom:8px; color:#c9d1d9; font-weight:500;">
                                Allowed Interrupt Categories 
                                <span style="color:#6e7681; font-weight:normal; font-size:12px;">(uncheck to ignore that type during booking)</span>
                            </label>
                            <div style="display:flex; flex-wrap:wrap; gap:10px; background:#161b22; padding:12px; border-radius:6px;">
                                ${this.renderInterruptCategoryCheckboxes(bookingInterruption.allowedCategories)}
                            </div>
                            <p style="margin:6px 0 0 0; color:#6e7681; font-size:11px;">
                                Example: If caller asks "do you service Miami?" mid-booking, AI answers (SERVICE_AREA) then returns to slot.
                            </p>
                        </div>
                        
                        <!-- Max Interrupts Before Transfer -->
                        <div style="display:grid; grid-template-columns:200px 1fr; gap:12px; align-items:start;">
                            <div>
                                <label style="display:block; margin-bottom:6px; color:#c9d1d9; font-weight:500;">Max Interrupts Before Transfer</label>
                                <input id="fdb-interrupt-maxBeforeTransfer" type="number" min="0" max="10" 
                                    value="${Number(bookingInterruption.maxInterruptsBeforeTransfer ?? 3)}"
                                    style="width:100%; padding:8px; background:#161b22; border:1px solid #30363d; border-radius:6px; color:#c9d1d9;">
                                <p style="margin:4px 0 0 0; color:#6e7681; font-size:11px;">After this many tangents, offer transfer. (0 = never)</p>
                            </div>
                            <div>
                                <label style="display:block; margin-bottom:6px; color:#c9d1d9; font-weight:500;">Transfer Offer Prompt</label>
                                <textarea id="fdb-interrupt-transferOffer" rows="2" 
                                    placeholder="I want to make sure I'm helping you the best way I can..."
                                    style="width:100%; padding:10px; background:#161b22; border:1px solid #30363d; border-radius:6px; color:#c9d1d9; resize:vertical;">${this.escapeHtml(bookingInterruption.transferOfferPrompt || "I want to make sure I'm helping you the best way I can. Would you like me to connect you with someone who can answer all your questions, or should we continue with the scheduling?")}</textarea>
                            </div>
                        </div>
                        
                        <!-- Return-to-Slot Phrasing (Multiple Variants) -->
                        <div>
                            <label style="display:block; margin-bottom:8px; color:#c9d1d9; font-weight:500;">
                                Return-to-Slot Phrasing 
                                <span style="color:#3fb950; font-weight:normal; font-size:12px;">🎲 AI picks randomly to avoid robotic repetition</span>
                            </label>
                            <p style="margin:0 0 8px 0; color:#6e7681; font-size:12px;">
                                Placeholders: <code style="background:#0d1117; padding:2px 6px; border-radius:4px;">{slotQuestion}</code>
                                <code style="background:#0d1117; padding:2px 6px; border-radius:4px;">{slotLabel}</code>
                                <code style="background:#0d1117; padding:2px 6px; border-radius:4px;">{callerName}</code>
                            </p>
                            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                                <div>
                                    <label style="display:block; margin-bottom:4px; color:#8b949e; font-size:12px;">Standard Variants (one per line)</label>
                                    <textarea id="fdb-interrupt-returnVariants" rows="5" 
                                        placeholder="Now, back to scheduling — {slotQuestion}&#10;Alright, {slotQuestion}&#10;So, {slotQuestion}"
                                        style="width:100%; padding:10px; background:#161b22; border:1px solid #30363d; border-radius:6px; color:#c9d1d9; resize:vertical; font-family:monospace; font-size:12px;">${this.escapeHtml((bookingInterruption.returnToSlotVariants || ["Now, back to scheduling — {slotQuestion}", "Alright, {slotQuestion}", "So, {slotQuestion}", "Anyway, {slotQuestion}", "Back to your appointment — {slotQuestion}"]).join('\n'))}</textarea>
                                </div>
                                <div>
                                    <label style="display:block; margin-bottom:4px; color:#8b949e; font-size:12px;">Short Variants (one per line)</label>
                                    <textarea id="fdb-interrupt-returnShortVariants" rows="5" 
                                        placeholder="So, {slotQuestion}&#10;{slotQuestion}&#10;Alright — {slotQuestion}"
                                        style="width:100%; padding:10px; background:#161b22; border:1px solid #30363d; border-radius:6px; color:#c9d1d9; resize:vertical; font-family:monospace; font-size:12px;">${this.escapeHtml((bookingInterruption.returnToSlotShortVariants || ["So, {slotQuestion}", "{slotQuestion}", "Alright — {slotQuestion}", "Now, {slotQuestion}"]).join('\n'))}</textarea>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div style="display:grid; gap:12px; background:#0d1117; border:1px solid #30363d; border-radius:8px; padding:16px; margin-top:16px;">
                    <div>
                        <label style="display:block; margin-bottom:6px; color:#c9d1d9; font-weight:500;">System Prompt (Interruption)</label>
                        <input type="text" value="${this.escapeHtml(interruptionKeys.systemHeader)}" disabled
                            style="width: 100%; padding: 8px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #6e7681; margin-bottom: 6px;">
                        <textarea id="fdb-interrupt-systemHeader" rows="6" style="width: 100%; padding: 10px; background:#0d1117; border:1px solid #30363d; border-radius:6px; color:#c9d1d9; resize: vertical;">${interruptionTexts.systemHeader}</textarea>
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:6px; color:#c9d1d9; font-weight:500;">Acknowledgment (with name)</label>
                        <input type="text" value="${this.escapeHtml(interruptionKeys.ackWithName)}" disabled
                            style="width: 100%; padding: 8px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #6e7681; margin-bottom: 6px;">
                        <textarea id="fdb-interrupt-ackWithName" rows="2" style="width: 100%; padding: 10px; background:#0d1117; border:1px solid #30363d; border-radius:6px; color:#c9d1d9; resize: vertical;">${interruptionTexts.ackWithName}</textarea>
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:6px; color:#c9d1d9; font-weight:500;">Acknowledgment (short)</label>
                        <input type="text" value="${this.escapeHtml(interruptionKeys.ackShort)}" disabled
                            style="width: 100%; padding: 8px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #6e7681; margin-bottom: 6px;">
                        <textarea id="fdb-interrupt-ackShort" rows="2" style="width: 100%; padding: 10px; background:#0d1117; border:1px solid #30363d; border-radius:6px; color:#c9d1d9; resize: vertical;">${interruptionTexts.ackShort}</textarea>
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:6px; color:#c9d1d9; font-weight:500;">Acknowledgment (generic)</label>
                        <input type="text" value="${this.escapeHtml(interruptionKeys.genericAck)}" disabled
                            style="width: 100%; padding: 8px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #6e7681; margin-bottom: 6px;">
                        <textarea id="fdb-interrupt-genericAck" rows="2" style="width: 100%; padding: 10px; background:#0d1117; border:1px solid #30363d; border-radius:6px; color:#c9d1d9; resize: vertical;">${interruptionTexts.genericAck}</textarea>
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:6px; color:#c9d1d9; font-weight:500;">Prohibited Phrases (one per line)</label>
                        <input type="text" value="${this.escapeHtml(interruptionKeys.prohibitPhrases)}" disabled
                            style="width: 100%; padding: 8px; background: #0b0f14; border: 1px solid #30363d; border-radius: 6px; color: #6e7681; margin-bottom: 6px;">
                        <textarea id="fdb-interrupt-prohibitPhrases" rows="3" style="width: 100%; padding: 10px; background:#0d1117; border:1px solid #30363d; border-radius:6px; color:#c9d1d9; resize: vertical;">${interruptionTexts.prohibitPhrases}</textarea>
                    </div>
                </div>
            </div>

            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <!-- SERVICE CALL FLOW (Existing Units) -->
            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-top: 16px;">
                <h3 style="margin: 0 0 10px 0; color: #58a6ff;">🧰 Service Calls (Existing Units)</h3>
                <p style="color: #8b949e; margin-bottom: 16px; font-size: 0.8rem;">
                    Configure consent and triage prompts per trade. Text is stored in <code style="background:#0d1117; padding:2px 6px; border-radius:4px;">bookingPromptsMap</code>.
                </p>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                    <div>
                        <label style="display:block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Mode</label>
                        <select id="fdb-serviceflow-mode" style="width: 100%; padding: 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                            <option value="off" ${serviceFlowMode === 'off' ? 'selected' : ''}>Off</option>
                            <option value="direct_to_booking" ${serviceFlowMode === 'direct_to_booking' ? 'selected' : ''}>Direct to Booking</option>
                            <option value="hybrid" ${serviceFlowMode === 'hybrid' ? 'selected' : ''}>Hybrid (triage if urgent)</option>
                        </select>
                    </div>
                    <div>
                        <label style="display:block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Trades (comma-separated)</label>
                        <input id="fdb-serviceflow-trades" value="${serviceFlowTradesValue}" placeholder="hvac, plumbing"
                            style="width: 100%; padding: 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                    </div>
                </div>

                <label style="display:flex; align-items: center; gap: 8px; margin-bottom: 12px; color: #c9d1d9;">
                    <input type="checkbox" id="fdb-serviceflow-empathy" ${serviceFlow.empathyEnabled ? 'checked' : ''} style="accent-color: #58a6ff;">
                    Enable empathy/opening acknowledgments for service trades
                </label>

                ${serviceFlowTradeBlocks || '<p style="color: #8b949e; font-size: 0.8rem; margin: 0;">Add trades above and save to configure prompts.</p>'}
            </div>

            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <!-- PROMPT PACKS (Hybrid defaults + overrides) -->
            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-top: 16px;">
                <h3 style="margin: 0 0 10px 0; color: #58a6ff;">📦 Prompt Packs (Hybrid)</h3>
                <p style="color: #8b949e; margin-bottom: 16px; font-size: 0.8rem;">
                    Select a prompt pack per trade. Packs provide defaults; per-company overrides live in <code style="background:#0d1117; padding:2px 6px; border-radius:4px;">bookingPromptsMap</code>.
                </p>

                <label style="display:flex; align-items:center; gap:8px; margin-bottom:12px; color:#c9d1d9;">
                    <input type="checkbox" id="fdb-promptpacks-enabled" ${promptPacks.enabled !== false ? 'checked' : ''} style="accent-color:#58a6ff;">
                    Enable prompt packs
                </label>

                <div style="display:grid; gap: 10px;">
                    ${Object.keys(promptPackRegistry.byTrade || {}).sort().map(trade => {
                        const packOptions = promptPackRegistry.byTrade[trade] || [];
                        const selected = selectedPacksByTrade[trade] || '';
                        const latest = promptPackRegistry.latestByTrade?.[trade] || null;
                        const optionsHtml = packOptions.map(packId => {
                            const pack = promptPackRegistry.packs?.[packId];
                            const label = pack ? `${pack.label} (${pack.id})` : packId;
                            return `<option value="${this.escapeHtml(packId)}" ${packId === selected ? 'selected' : ''}>${this.escapeHtml(label)}</option>`;
                        }).join('');
                        const needsUpgrade = latest && selected && latest !== selected;
                        return `
                            <div style="border: 1px solid #30363d; border-radius: 8px; padding: 12px; background: #0d1117;">
                                <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                    <strong style="color:#c9d1d9;">${this.escapeHtml(trade)}</strong>
                                    ${needsUpgrade ? `<span style="color:#f0883e; font-size:0.8rem;">Upgrade available: ${this.escapeHtml(latest)}</span>` : '<span style="color:#8b949e; font-size:0.8rem;">Up to date</span>'}
                                </div>
                                <div style="display:grid; grid-template-columns: 180px 1fr; gap: 12px; align-items: center;">
                                    <label style="color:#8b949e;">Selected pack</label>
                                    <select data-pack-trade="${this.escapeHtml(trade)}" style="width:100%; padding:8px; background:#0d1117; border:1px solid #30363d; border-radius:6px; color:#c9d1d9;">
                                        <option value="">(none)</option>
                                        ${optionsHtml}
                                    </select>
                                </div>
                                <div style="display:flex; gap:8px; margin-top:10px;">
                                    <button class="btn btn-secondary" onclick="window.frontDeskBehaviorManager.previewPromptPackUpgrade('${this.escapeHtml(trade)}', '${this.escapeHtml(latest || '')}')"
                                        style="padding:6px 10px; font-size:12px;" ${!latest ? 'disabled' : ''}>
                                        Preview Changes
                                    </button>
                                    <button class="btn btn-primary" onclick="window.frontDeskBehaviorManager.applyPromptPackUpgrade('${this.escapeHtml(trade)}', '${this.escapeHtml(latest || '')}')"
                                        style="padding:6px 10px; font-size:12px;" ${!needsUpgrade ? 'disabled' : ''}>
                                        Upgrade Pack
                                    </button>
                                </div>
                                <pre id="fdb-pack-preview-${this.escapeHtml(trade)}" style="margin-top:10px; display:none; padding:10px; background:#0b0f14; border:1px solid #30363d; border-radius:6px; color:#c9d1d9; font-size:12px; white-space:pre-wrap;"></pre>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <!-- PACK UPGRADE PLAYBOOK (Required Checks) -->
            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <div style="background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-top: 16px;">
                <h3 style="margin: 0 0 8px 0; color: #f0883e;">✅ Pack Upgrade Playbook (Required Checks)</h3>
                <div style="display:grid; gap: 6px; font-size: 12px; color:#8b949e;">
                    <div>• clean diff (preview shows zero changes after apply)</div>
                    <div>• history entry recorded (from → to → who → when)</div>
                    <div>• legacy keys remaining = 0</div>
                    <div>• promptGuards fallback key set</div>
                    <div>• live/console test passed with new phrasing</div>
                </div>
            </div>

            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <!-- PROMPT PACK MIGRATION -->
            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-top: 16px;">
                <h3 style="margin: 0 0 10px 0; color: #58a6ff;">🧭 Prompt Pack Migration</h3>
                <p style="color: #8b949e; margin-bottom: 16px; font-size: 0.8rem;">
                    Preview or apply legacy key migration. No changes are made until Apply is used.
                </p>
                <div style="display:flex; gap:8px; margin-bottom:10px;">
                    <button class="btn btn-secondary" onclick="window.frontDeskBehaviorManager.previewPromptPackMigration()" style="padding:6px 10px; font-size:12px;">Preview Migration</button>
                    <button class="btn btn-primary" onclick="window.frontDeskBehaviorManager.applyPromptPackMigration()" style="padding:6px 10px; font-size:12px;">Apply Migration</button>
                </div>
                <pre id="fdb-pack-migration-preview" style="display:none; padding:10px; background:#0b0f14; border:1px solid #30363d; border-radius:6px; color:#c9d1d9; font-size:12px; white-space:pre-wrap;"></pre>
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
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <label style="font-size: 11px; color: #3fb950;">
                                🔍 Variant pairs from your ${(this.config.commonFirstNames || []).length} names:
                            </label>
                            <button onclick="window.frontDeskManager.computeAutoVariants()" 
                                id="fdb-compute-variants-btn"
                                style="padding: 6px 12px; background: #238636; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600;">
                                🔄 Scan Names
                            </button>
                        </div>
                        <div id="fdb-auto-scan-preview" style="padding: 12px; background: #0d1117; border: 1px solid #238636; border-radius: 6px; max-height: 200px; overflow-y: auto;">
                            ${this.renderAutoScanPreviewStatic()}
                        </div>
                        <p style="color: #6e7681; font-size: 0.7rem; margin: 4px 0 0 0;">
                            Click "Scan Names" to detect variant pairs. Only runs when you click (not on every tab switch).
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

            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <!-- V77: RESUME BOOKING PROTOCOL (Off-Rails Recovery → Bridge Back) -->
            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            ${(() => {
                const rb = this.config.offRailsRecovery?.bridgeBack?.resumeBooking || this.getDefaultConfig().offRailsRecovery.bridgeBack.resumeBooking;
                const enabled = rb.enabled !== false;
                return `
                <div style="background: #161b22; border: 1px solid ${enabled ? '#3fb950' : '#30363d'}; border-radius: 8px; padding: 20px; margin-top: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                        <div>
                            <h3 style="margin: 0; color: #3fb950;">🧭 Resume Booking Protocol</h3>
                            <p style="color: #8b949e; font-size: 0.8rem; margin: 4px 0 0 0;">
                                After answering an off-rails question during booking, read a short recap of what’s already collected and continue with the next slot question.
                                <br><span style="color: #6e7681;">UI-controlled. No hidden backend text.</span>
                            </p>
                        </div>
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="fdb-resume-booking-enabled" ${enabled ? 'checked' : ''} 
                                style="accent-color: #3fb950; width: 18px; height: 18px;"
                                onchange="window.frontDeskManager.toggleResumeBookingProtocol(this.checked)">
                            <span style="color: ${enabled ? '#3fb950' : '#8b949e'}; font-weight: 600;">
                                ${enabled ? 'ENABLED' : 'DISABLED'}
                            </span>
                        </label>
                    </div>
                    
                    <div id="fdb-resume-booking-settings" style="display: ${enabled ? 'block' : 'none'};">
                        <div style="display:flex; align-items:center; gap: 12px; margin-bottom: 12px;">
                            <label style="display:flex; align-items:center; gap: 8px; cursor:pointer;">
                                <input type="checkbox" id="fdb-resume-booking-includeValues" ${rb.includeValues === true ? 'checked' : ''} style="accent-color: #3fb950;">
                                <span style="color:#c9d1d9;">Include collected values (reads back what you have)</span>
                            </label>
                            <span style="color:#6e7681; font-size: 0.75rem;">Tip: keep OFF if you don’t want to read back phone/address.</span>
                        </div>
                        
                        <div style="margin-bottom: 12px;">
                            <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">Resume block template</label>
                            <textarea id="fdb-resume-booking-template" rows="2"
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical;">${rb.template || ''}</textarea>
                            <div style="color:#6e7681; font-size: 0.7rem; margin-top: 6px;">
                                Placeholders: <code>{collectedSummary}</code>, <code>{missingSummary}</code>, <code>{nextSlotLabel}</code>, <code>{nextQuestion}</code>
                            </div>
                        </div>
                        
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                            <div>
                                <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">Collected item template (no values)</label>
                                <input id="fdb-resume-booking-itemTemplate" value="${rb.collectedItemTemplate || ''}"
                                    style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                            </div>
                            <div>
                                <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">Collected item template (with values)</label>
                                <input id="fdb-resume-booking-itemTemplateWithValue" value="${rb.collectedItemTemplateWithValue || ''}"
                                    style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                            </div>
                        </div>

                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                            <div>
                                <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">List separator</label>
                                <input id="fdb-resume-booking-separator" value="${rb.separator || ', '}"
                                    style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                            </div>
                            <div>
                                <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">Final separator</label>
                                <input id="fdb-resume-booking-finalSeparator" value="${rb.finalSeparator || ' and '}"
                                    style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                            </div>
                        </div>
                    </div>
                </div>
                `;
            })()}

            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <!-- V92: BOOKING CLARIFICATION (Meta questions during slot collection) -->
            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            ${(() => {
                const bc = this.config.offRailsRecovery?.bridgeBack?.clarification || this.getDefaultConfig().offRailsRecovery.bridgeBack.clarification;
                const enabled = bc.enabled !== false;
                const triggersText = Array.isArray(bc.triggers) ? bc.triggers.join('\n') : '';
                return `
                <div style="background: #161b22; border: 1px solid ${enabled ? '#58a6ff' : '#30363d'}; border-radius: 8px; padding: 20px; margin-top: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                        <div>
                            <h3 style="margin: 0; color: #58a6ff;">🧠 Booking Clarification (Meta Questions)</h3>
                            <p style="color: #8b949e; font-size: 0.8rem; margin: 4px 0 0 0;">
                                Handles confusion like “is that what you want?” or “what do you mean?” during booking.
                                The agent replies using your template and then repeats the <strong>exact</strong> next slot question.
                                <br><span style="color: #6e7681;">UI-controlled. No hidden backend text.</span>
                            </p>
                        </div>
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="fdb-booking-clarification-enabled" ${enabled ? 'checked' : ''} 
                                style="accent-color: #58a6ff; width: 18px; height: 18px;"
                                onchange="window.frontDeskManager.toggleBookingClarificationProtocol(this.checked)">
                            <span style="color: ${enabled ? '#58a6ff' : '#8b949e'}; font-weight: 600;">
                                ${enabled ? 'ENABLED' : 'DISABLED'}
                            </span>
                        </label>
                    </div>

                    <div id="fdb-booking-clarification-settings" style="display: ${enabled ? 'block' : 'none'};">
                        <div style="margin-bottom: 12px;">
                            <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">Trigger phrases (one per line)</label>
                            <textarea id="fdb-booking-clarification-triggers" rows="4"
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical;">${this.escapeHtml(triggersText)}</textarea>
                            <div style="color:#6e7681; font-size: 0.7rem; margin-top: 6px;">
                                Match is case-insensitive substring. Keep phrases specific to avoid false triggers.
                            </div>
                        </div>

                        <div style="margin-bottom: 12px;">
                            <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">Reply template</label>
                            <textarea id="fdb-booking-clarification-template" rows="2"
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical;">${this.escapeHtml(bc.template || '')}</textarea>
                            <div style="color:#6e7681; font-size: 0.7rem; margin-top: 6px;">
                                Placeholders: <code>{nextQuestion}</code>, <code>{nextSlotLabel}</code>
                            </div>
                        </div>
                    </div>
                </div>
                `;
            })()}

            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            <!-- V78: CONFIRMATION REQUESTS (repeat what we captured) -->
            <!-- ═══════════════════════════════════════════════════════════════════════ -->
            ${(() => {
                const cr = this.config.confirmationRequests || this.getDefaultConfig().confirmationRequests;
                const enabled = cr.enabled !== false;
                const triggersText = Array.isArray(cr.triggers) ? cr.triggers.join('\n') : '';
                return `
                <div style="background: #161b22; border: 1px solid ${enabled ? '#58a6ff' : '#30363d'}; border-radius: 8px; padding: 20px; margin-top: 16px;">
                    <div style="display:flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                        <div>
                            <h3 style="margin: 0; color: #58a6ff;">✅ Confirmation Requests</h3>
                            <p style="color: #8b949e; font-size: 0.8rem; margin: 4px 0 0 0;">
                                When callers ask “did you get my name/phone/address right?”, the agent will repeat what’s captured using each slot’s <code>confirmPrompt</code>.
                            </p>
                        </div>
                        <label style="display:flex; align-items:center; gap: 8px; cursor:pointer;">
                            <input type="checkbox" id="fdb-confirm-req-enabled" ${enabled ? 'checked' : ''} style="accent-color:#58a6ff;">
                            <span style="color:${enabled ? '#58a6ff' : '#8b949e'}; font-weight:600;">${enabled ? 'ENABLED' : 'DISABLED'}</span>
                        </label>
                    </div>
                    <div style="margin-top: 10px;">
                        <label style="display:block; color:#8b949e; font-size: 11px; margin-bottom: 6px;">Trigger phrases (one per line, lowercase recommended)</label>
                        <textarea id="fdb-confirm-req-triggers" rows="6"
                            style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-family: monospace; font-size: 12px; resize: vertical;">${triggersText}</textarea>
                    </div>
                </div>
                `;
            })()}
            
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
    
    // Helper to render interrupt category checkboxes (avoids nested template literal issues)
    renderInterruptCategoryCheckboxes(allowedCategories) {
        const categories = allowedCategories || ['FAQ', 'HOURS', 'SERVICE_AREA', 'PRICING', 'SMALL_TALK', 'EMERGENCY'];
        const labels = {
            'FAQ': '❓ FAQ',
            'HOURS': '🕐 Hours',
            'SERVICE_AREA': '📍 Service Area',
            'PRICING': '💰 Pricing',
            'SMALL_TALK': '💬 Small Talk',
            'EMERGENCY': '🚨 Emergency'
        };
        
        return ['FAQ', 'HOURS', 'SERVICE_AREA', 'PRICING', 'SMALL_TALK', 'EMERGENCY'].map(cat => {
            const checked = categories.includes(cat) ? 'checked' : '';
            const label = labels[cat] || cat;
            return '<label style="display:flex; align-items:center; gap:6px; padding:6px 10px; background:#0d1117; border:1px solid #30363d; border-radius:6px; cursor:pointer;">' +
                '<input type="checkbox" class="fdb-interrupt-category" data-category="' + cat + '" ' + checked + ' style="accent-color:#58a6ff;">' +
                '<span style="color:#c9d1d9; font-size:13px;">' + label + '</span>' +
                '</label>';
        }).join('');
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

    // V77: Toggle Resume Booking Protocol UI
    toggleResumeBookingProtocol(enabled) {
        if (!this.config.offRailsRecovery) this.config.offRailsRecovery = {};
        if (!this.config.offRailsRecovery.bridgeBack) this.config.offRailsRecovery.bridgeBack = {};
        if (!this.config.offRailsRecovery.bridgeBack.resumeBooking) {
            this.config.offRailsRecovery.bridgeBack.resumeBooking = this.getDefaultConfig().offRailsRecovery.bridgeBack.resumeBooking;
        }
        
        this.config.offRailsRecovery.bridgeBack.resumeBooking.enabled = enabled === true;
        this.isDirty = true;
        
        // Toggle UI section visibility without full rerender
        const settingsEl = document.getElementById('fdb-resume-booking-settings');
        if (settingsEl) settingsEl.style.display = enabled ? 'block' : 'none';
    }

    // V92: Toggle Booking Clarification Protocol UI
    toggleBookingClarificationProtocol(enabled) {
        if (!this.config.offRailsRecovery) this.config.offRailsRecovery = {};
        if (!this.config.offRailsRecovery.bridgeBack) this.config.offRailsRecovery.bridgeBack = {};
        if (!this.config.offRailsRecovery.bridgeBack.clarification) {
            this.config.offRailsRecovery.bridgeBack.clarification = this.getDefaultConfig().offRailsRecovery.bridgeBack.clarification;
        }

        this.config.offRailsRecovery.bridgeBack.clarification.enabled = enabled === true;
        this.isDirty = true;

        const settingsEl = document.getElementById('fdb-booking-clarification-settings');
        if (settingsEl) settingsEl.style.display = enabled ? 'block' : 'none';
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // V93: SLOT-LEVEL MID-CALL HELPERS (Booking Slot Editor)
    // ═══════════════════════════════════════════════════════════════════════════
    // These are DOM-based helpers used inside the full-screen slot editor modal.
    // We do NOT mutate this.config here; we simply update the editor DOM and
    // collect the values at save time (collectBookingSlotFromEditor).

    generateMidCallRuleId() {
        return `mcr_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    }

    getRecommendedMidCallRulesForSlot(slotIdOrType) {
        const key = (slotIdOrType || '').toString().toLowerCase();
        const base = [
            {
                id: this.generateMidCallRuleId(),
                enabled: true,
                matchType: 'contains',
                action: 'reply_reask',
                cooldownTurns: 2,
                maxPerCall: 2
            }
        ];

        if (key === 'name') {
            return [
                {
                    ...base[0],
                    trigger: 'is that what you want',
                    responseTemplate: 'Sure — {slotQuestion}'
                },
                {
                    ...base[0],
                    id: this.generateMidCallRuleId(),
                    trigger: 'what do you mean',
                    responseTemplate: 'Happy to clarify — {slotQuestion}'
                }
            ];
        }

        if (key === 'phone') {
            return [
                {
                    ...base[0],
                    trigger: 'why do you need',
                    responseTemplate: 'We use it for appointment updates and confirmations. {slotQuestion}'
                },
                {
                    ...base[0],
                    id: this.generateMidCallRuleId(),
                    trigger: 'too many',
                    responseTemplate: 'Got it — just the 10 digits works best (example: {exampleFormat}). {slotQuestion}'
                }
            ];
        }

        if (key === 'address') {
            return [
                {
                    ...base[0],
                    trigger: 'do you need city',
                    responseTemplate: 'Yes — street address and city help us send the technician to the right place. {slotQuestion}'
                },
                {
                    ...base[0],
                    id: this.generateMidCallRuleId(),
                    trigger: 'i don\'t know the zip',
                    responseTemplate: 'That\'s okay — street address and city is enough to start. {slotQuestion}'
                }
            ];
        }

        if (key === 'time' || key === 'datetime' || key === 'date') {
            return [
                {
                    ...base[0],
                    trigger: 'what do you have',
                    responseTemplate: 'We can work around your schedule — {slotQuestion}'
                }
            ];
        }

        return [];
    }

    renderMidCallRulesEditor(slot) {
        const rules = Array.isArray(slot.midCallRules) ? slot.midCallRules : [];
        const slotKey = (slot.id || slot.type || '').toString().toLowerCase();
        const showExampleFormat = slotKey === 'phone';
        const exampleFormat = '(555) 123-4567';

        const rows = rules.length > 0
            ? rules.map((r, idx) => this.renderMidCallRuleRow(r, idx, { showExampleFormat, exampleFormat })).join('')
            : `<div style="padding: 10px 12px; color:#8b949e; font-size: 12px; border: 1px dashed #30363d; border-radius: 8px; background:#0d1117;">
                    No mid-call helpers yet. Click <strong>Add Rule</strong> or <strong>Apply Recommended</strong>.
               </div>`;

        return `
            <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid #30363d;">
                <div style="display:flex; align-items:center; justify-content: space-between; gap: 10px; margin-bottom: 8px;">
                    <div>
                        <div style="font-weight: 900; color:#58a6ff;">🧩 Mid‑Call Helpers (slot‑level)</div>
                        <div style="color:#8b949e; font-size: 12px; margin-top: 2px;">
                            Deterministic quick replies for common “human moments” while collecting this slot. Fires only when we <strong>did not extract</strong> the slot this turn.
                        </div>
                    </div>
                    <div style="display:flex; gap: 8px; flex-wrap: wrap;">
                        <button type="button" onclick="window.frontDeskManager.applyRecommendedMidCallRules()"
                            style="padding: 8px 10px; background:#21262d; border:1px solid #30363d; border-radius: 8px; color:#c9d1d9; cursor:pointer; font-weight:800;">
                            Apply Recommended
                        </button>
                        <button type="button" onclick="window.frontDeskManager.addMidCallRuleRow()"
                            style="padding: 8px 10px; background:#238636; border:none; border-radius: 8px; color:white; cursor:pointer; font-weight:900;">
                            + Add Rule
                        </button>
                    </div>
                </div>

                <div style="display:grid; grid-template-columns: 1.2fr 140px 160px 1.6fr 110px 110px 44px; gap: 8px; align-items:center; padding: 8px 10px; background:#161b22; border:1px solid #30363d; border-radius: 10px; font-size: 11px; color:#8b949e; font-weight:800;">
                    <div>CALLER SAYS (trigger)</div>
                    <div>MATCH</div>
                    <div>ACTION</div>
                    <div>AI RESPONDS (template)</div>
                    <div style="display:flex; align-items:center; gap:6px;">
                        COOLDOWN
                        <button type="button" onclick="window.frontDeskManager.toggleSlotMidCallInfo('cooldown')"
                            style="width:18px; height:18px; border-radius: 999px; border:1px solid #30363d; background:#0d1117; color:#8b949e; cursor:pointer; font-weight:900; line-height: 1;"
                            title="What is cooldown?">i</button>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px;">
                        MAX/CALL
                        <button type="button" onclick="window.frontDeskManager.toggleSlotMidCallInfo('max')"
                            style="width:18px; height:18px; border-radius: 999px; border:1px solid #30363d; background:#0d1117; color:#8b949e; cursor:pointer; font-weight:900; line-height: 1;"
                            title="What is max per call?">i</button>
                    </div>
                    <div></div>
                </div>

                <div class="slot-midcall-rules" style="margin-top: 8px; display:flex; flex-direction: column; gap: 8px;">
                    ${rows}
                </div>

                <div class="midcall-info-panels" style="margin-top: 10px;">
                    <div class="midcall-info-panel" data-midcall-info="cooldown"
                        style="display:none; padding: 10px 12px; background:#0d1117; border:1px solid #30363d; border-radius: 10px; color:#c9d1d9; font-size: 12px; line-height: 1.45;">
                        <div style="font-weight: 900; color:#58a6ff; margin-bottom: 6px;">Cooldown (Recommended: 2)</div>
                        <div><strong>What it means:</strong> how many turns must pass before the <em>same mid‑call rule</em> can fire again.</div>
                        <div style="margin-top: 6px;">
                            <strong>Why 2 is ideal:</strong> prevents “helper loops” if the caller repeats the same confused phrase back‑to‑back.
                        </div>
                        <div style="margin-top: 6px;">
                            <strong>Adjusting:</strong>
                            <br>- Set to <strong>0–1</strong> if callers often repeat themselves and you want the helper to be more persistent.
                            <br>- Set to <strong>3+</strong> if you want it to fire once and then get out of the way.
                        </div>
                    </div>
                    <div class="midcall-info-panel" data-midcall-info="max"
                        style="display:none; padding: 10px 12px; background:#0d1117; border:1px solid #30363d; border-radius: 10px; color:#c9d1d9; font-size: 12px; line-height: 1.45;">
                        <div style="font-weight: 900; color:#58a6ff; margin-bottom: 6px;">Max/Call (Recommended: 2)</div>
                        <div><strong>What it means:</strong> the maximum number of times this rule can fire during the <em>same session/call</em>.</div>
                        <div style="margin-top: 6px;">
                            <strong>Why 2 is ideal:</strong> gives the caller a second chance, but stops repetitive behavior if they keep derailing.
                        </div>
                        <div style="margin-top: 6px;">
                            <strong>Adjusting:</strong>
                            <br>- Set to <strong>1</strong> if you want a strict “one reminder only” policy.
                            <br>- Set to <strong>3–5</strong> if you want the helper to keep guiding longer.
                        </div>
                    </div>
                </div>

                <div style="color:#6e7681; font-size: 11px; margin-top: 8px;">
                    Placeholders: <code>{slotQuestion}</code>, <code>{slotLabel}</code>${showExampleFormat ? `, <code>{exampleFormat}</code>` : ''}.
                </div>
            </div>
        `;
    }

    toggleSlotMidCallInfo(which) {
        const panelRoot = document.querySelector('#fdb-slot-editor-panel .midcall-info-panels');
        if (!panelRoot) return;
        const key = (which || '').toString();
        const panel = panelRoot.querySelector(`.midcall-info-panel[data-midcall-info="${key}"]`);
        if (!panel) return;
        const isOpen = panel.style.display !== 'none';
        // Close all then toggle selected
        panelRoot.querySelectorAll('.midcall-info-panel').forEach(p => { p.style.display = 'none'; });
        panel.style.display = isOpen ? 'none' : 'block';
    }

    renderMidCallRuleRow(rule, idx, { showExampleFormat, exampleFormat }) {
        const r = rule && typeof rule === 'object' ? rule : {};
        const id = (r.id || this.generateMidCallRuleId()).toString();
        const enabled = r.enabled !== false;
        const matchType = (r.matchType || 'contains').toString();
        const action = (r.action || 'reply_reask').toString();
        const trigger = (r.trigger || '').toString();
        const responseTemplate = (r.responseTemplate || '').toString();
        const cooldownTurns = typeof r.cooldownTurns === 'number' ? r.cooldownTurns : 2;
        const maxPerCall = typeof r.maxPerCall === 'number' ? r.maxPerCall : 2;

        const placeholderHint = showExampleFormat
            ? `You can include {exampleFormat} (e.g., ${exampleFormat}).`
            : `Keep it short and end by re-asking {slotQuestion}.`;

        return `
            <div class="midcall-rule-row" data-midcall-idx="${idx}"
                 style="display:grid; grid-template-columns: 1.2fr 140px 160px 1.6fr 110px 110px 44px; gap: 8px; align-items: start; padding: 10px; background:#0d1117; border:1px solid #30363d; border-radius: 10px;">
                <input type="hidden" class="midcall-rule-id" value="${this.escapeHtml(id)}">
                <div style="display:flex; flex-direction: column; gap: 6px;">
                    <label style="display:flex; align-items:center; gap: 8px; font-size: 12px; color:#c9d1d9;">
                        <input type="checkbox" class="midcall-rule-enabled" ${enabled ? 'checked' : ''} style="accent-color:#58a6ff;">
                        <span style="font-weight:800;">Enabled</span>
                    </label>
                    <div style="font-size: 10px; color:#8b949e; font-weight: 800;">Trigger (caller says)</div>
                    <input class="midcall-rule-trigger" value="${this.escapeHtml(trigger)}"
                        placeholder="e.g., is that what you want"
                        style="width:100%; padding: 8px 10px; background:#161b22; border:1px solid #30363d; border-radius: 8px; color:#c9d1d9;">
                </div>

                <div style="display:flex; flex-direction: column; gap: 6px;">
                    <div style="font-size: 10px; color:#8b949e; font-weight: 800;">Match</div>
                    <select class="midcall-rule-matchType"
                        style="width:100%; padding: 8px 10px; background:#161b22; border:1px solid #30363d; border-radius: 8px; color:#c9d1d9;">
                        <option value="exact" ${matchType === 'exact' ? 'selected' : ''}>EXACT</option>
                        <option value="contains" ${matchType !== 'exact' ? 'selected' : ''}>CONTAINS</option>
                    </select>
                    <div style="font-size: 10px; color:#6e7681;">Exact = only identical text</div>
                </div>

                <div style="display:flex; flex-direction: column; gap: 6px;">
                    <div style="font-size: 10px; color:#8b949e; font-weight: 800;">Action</div>
                    <select class="midcall-rule-action"
                        style="width:100%; padding: 8px 10px; background:#161b22; border:1px solid #30363d; border-radius: 8px; color:#c9d1d9;">
                        <option value="reply_reask" ${action === 'reply_reask' ? 'selected' : ''}>Reply + re‑ask slot</option>
                        <option value="escalate" ${action === 'escalate' ? 'selected' : ''}>Escalate / handoff</option>
                    </select>
                    <div style="font-size: 10px; color:#6e7681;">Does not change slot order</div>
                </div>

                <div style="display:flex; flex-direction: column; gap: 6px;">
                    <div style="font-size: 10px; color:#8b949e; font-weight: 800;">Reply template</div>
                    <textarea class="midcall-rule-template" rows="2"
                        placeholder="${this.escapeHtml(placeholderHint)}"
                        style="width:100%; padding: 8px 10px; background:#161b22; border:1px solid #30363d; border-radius: 8px; color:#c9d1d9; resize: vertical;">${this.escapeHtml(responseTemplate)}</textarea>
                    <div style="font-size: 10px; color:#6e7681;">Tip: include <code>{slotQuestion}</code> so the caller stays on track</div>
                </div>

                <div style="display:flex; flex-direction: column; gap: 6px;">
                    <div style="font-size: 10px; color:#8b949e; font-weight: 800;">Cooldown (turns)</div>
                    <input class="midcall-rule-cooldown" type="number" min="0" max="10" value="${cooldownTurns}"
                        style="width:100%; padding: 8px 10px; background:#161b22; border:1px solid #30363d; border-radius: 8px; color:#c9d1d9;">
                    <div style="font-size: 10px; color:#6e7681;">Recommended: 2</div>
                </div>

                <div style="display:flex; flex-direction: column; gap: 6px;">
                    <div style="font-size: 10px; color:#8b949e; font-weight: 800;">Max per call</div>
                    <input class="midcall-rule-max" type="number" min="1" max="10" value="${maxPerCall}"
                        style="width:100%; padding: 8px 10px; background:#161b22; border:1px solid #30363d; border-radius: 8px; color:#c9d1d9;">
                    <div style="font-size: 10px; color:#6e7681;">Scope: this session/call • Recommended: 2</div>
                </div>

                <button type="button" onclick="window.frontDeskManager.removeMidCallRuleRow(${idx})"
                    style="width: 40px; height: 40px; background: transparent; border: 1px solid #f8514940; border-radius: 10px; color: #f85149; cursor: pointer; font-size: 18px; font-weight: 900;"
                    title="Remove this rule">×</button>
            </div>
        `;
    }

    getSlotEditorMidCallContainer() {
        return document.querySelector('#fdb-slot-editor-panel .slot-midcall-rules');
    }

    addMidCallRuleRow() {
        const container = this.getSlotEditorMidCallContainer();
        const panel = document.getElementById('fdb-slot-editor-panel');
        if (!container || !panel) return;
        const slotType = panel.querySelector('#fdb-slot-editor-type')?.value || 'text';
        const slotId = panel.querySelector('.slot-id')?.value || slotType;
        const slotKey = (slotId || slotType).toString().toLowerCase();
        const showExampleFormat = slotKey === 'phone';
        const exampleFormat = '(555) 123-4567';

        const existingRows = container.querySelectorAll('.midcall-rule-row').length;
        const rule = {
            id: this.generateMidCallRuleId(),
            enabled: true,
            matchType: 'contains',
            trigger: '',
            action: 'reply_reask',
            responseTemplate: `No problem — {slotQuestion}`,
            cooldownTurns: 2,
            maxPerCall: 2
        };
        const wrapper = document.createElement('div');
        wrapper.innerHTML = this.renderMidCallRuleRow(rule, existingRows, { showExampleFormat, exampleFormat });
        const rowEl = wrapper.firstElementChild;
        if (rowEl) container.appendChild(rowEl);
        this.isDirty = true;
    }

    removeMidCallRuleRow(idx) {
        const container = this.getSlotEditorMidCallContainer();
        if (!container) return;
        const rows = [...container.querySelectorAll('.midcall-rule-row')];
        const row = rows[idx];
        if (row) row.remove();
        // Re-index by rebuilding (so remove buttons keep working)
        this.reindexMidCallRuleRows();
        this.isDirty = true;
    }

    reindexMidCallRuleRows() {
        const container = this.getSlotEditorMidCallContainer();
        const panel = document.getElementById('fdb-slot-editor-panel');
        if (!container || !panel) return;
        const slotType = panel.querySelector('#fdb-slot-editor-type')?.value || 'text';
        const slotId = panel.querySelector('.slot-id')?.value || slotType;
        const slotKey = (slotId || slotType).toString().toLowerCase();
        const showExampleFormat = slotKey === 'phone';
        const exampleFormat = '(555) 123-4567';

        const existing = [...container.querySelectorAll('.midcall-rule-row')].map((row) => {
            const get = (sel) => row.querySelector(sel);
            return {
                id: get('.midcall-rule-id')?.value || this.generateMidCallRuleId(),
                enabled: get('.midcall-rule-enabled')?.checked === true,
                trigger: get('.midcall-rule-trigger')?.value || '',
                matchType: get('.midcall-rule-matchType')?.value || 'contains',
                action: get('.midcall-rule-action')?.value || 'reply_reask',
                responseTemplate: get('.midcall-rule-template')?.value || '',
                cooldownTurns: parseInt(get('.midcall-rule-cooldown')?.value || '2', 10),
                maxPerCall: parseInt(get('.midcall-rule-max')?.value || '2', 10)
            };
        });

        container.innerHTML = existing.length > 0
            ? existing.map((r, i) => this.renderMidCallRuleRow(r, i, { showExampleFormat, exampleFormat })).join('')
            : `<div style="padding: 10px 12px; color:#8b949e; font-size: 12px; border: 1px dashed #30363d; border-radius: 8px; background:#0d1117;">
                    No mid-call helpers yet. Click <strong>Add Rule</strong> or <strong>Apply Recommended</strong>.
               </div>`;
    }

    async applyRecommendedMidCallRules() {
        const panel = document.getElementById('fdb-slot-editor-panel');
        const container = this.getSlotEditorMidCallContainer();
        if (!panel || !container) return;
        const slotType = panel.querySelector('#fdb-slot-editor-type')?.value || 'text';
        const slotId = panel.querySelector('.slot-id')?.value || slotType;
        const slotKey = (slotId || slotType).toString().toLowerCase();
        const showExampleFormat = slotKey === 'phone';
        const exampleFormat = '(555) 123-4567';

        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token') || sessionStorage.getItem('token');
            if (!token) throw new Error('Not logged in (missing token)');

            // Send both slotId and slotType so backend can resolve granular presets.
            // Precedence: slotId wins over slotType.
            const qSlotId = (slotId || '').toString().trim();
            const qSlotType = (slotType || '').toString().trim();
            const qs = new URLSearchParams();
            if (qSlotId) qs.set('slotId', qSlotId);
            if (qSlotType) qs.set('slotType', qSlotType);

            const response = await fetch(`/api/admin/front-desk/${this.companyId}/presets/midcall?${qs.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (!response.ok || data?.success !== true) {
                throw new Error(data?.error || `Preset fetch failed (HTTP ${response.status})`);
            }
            const rules = Array.isArray(data.rules) ? data.rules : [];
            const banner = data?.presetVersion
                ? `<div style="margin-bottom: 8px; padding: 10px 12px; background: rgba(34, 197, 94, 0.08); border: 1px solid rgba(34, 197, 94, 0.25); border-radius: 10px; color: #86efac; font-size: 12px;">
                        Recommended rules loaded from server presets: <strong>${this.escapeHtml(data.presetVersion)}</strong>
                   </div>`
                : '';

            container.innerHTML = `
                ${banner}
                ${rules.length > 0
                    ? rules.map((r, i) => this.renderMidCallRuleRow(r, i, { showExampleFormat, exampleFormat })).join('')
                    : `<div style="padding: 10px 12px; color:#8b949e; font-size: 12px; border: 1px dashed #30363d; border-radius: 8px; background:#0d1117;">
                            No recommended rules for this slot type.
                       </div>`}
            `;
        } catch (e) {
            // Production policy: no local fallback presets. If server presets can't be loaded,
            // we show a visible error state and keep the existing rules unchanged.
            console.warn('[FRONT DESK] ❌ Mid-call presets fetch failed (no fallback):', e?.message || e);
            container.innerHTML = `
                <div style="padding: 12px; color:#fca5a5; font-size: 12px; border: 1px solid rgba(248, 81, 73, 0.35); border-radius: 10px; background: rgba(248, 81, 73, 0.06);">
                    <div style="font-weight: 900; margin-bottom: 6px;">Could not load recommended presets</div>
                    <div style="color:#c9d1d9;">This action is server-backed (no local fallback). Please refresh and try again.</div>
                </div>
            `;
            this.showNotification(`❌ Presets unavailable: ${(e?.message || 'fetch failed')}`, 'error');
            return;
        }
        this.isDirty = true;
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
        
        // ═══════════════════════════════════════════════════════════════════
        // V45 FIX: PRESERVE precomputedVariantMap when saving!
        // The "Scan Names" button stores this, and we must NOT overwrite it
        // ═══════════════════════════════════════════════════════════════════
        const existingConfig = this.config.nameSpellingVariants || {};
        
        return {
            enabled,
            source,
            mode,
            script,
            maxAsksPerCall: maxAsks,
            variantGroups,
            // CRITICAL: Preserve precomputed map from "Scan Names"
            precomputedVariantMap: existingConfig.precomputedVariantMap || null,
            precomputedAt: existingConfig.precomputedAt || null,
            precomputedFromCount: existingConfig.precomputedFromCount || null
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
            // PERF FIX: Don't auto-compute! Just show cached or placeholder
            // User must click "Scan Names" button to compute
            if (source === 'auto_scan') {
                const previewDiv = document.getElementById('fdb-auto-scan-preview');
                if (previewDiv) {
                    previewDiv.innerHTML = this.renderAutoScanPreviewStatic();
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
    // PERFORMANCE FIX: Cache results to avoid O(n²) calculation on every render
    findAutoVariants(forceRecalc = false) {
        const names = this.config.commonFirstNames || [];
        if (names.length === 0) return [];
        
        // Use cache if available and names haven't changed
        const cacheKey = names.length + '_' + (names[0] || '') + '_' + (names[names.length - 1] || '');
        if (!forceRecalc && this._autoVariantsCache && this._autoVariantsCacheKey === cacheKey) {
            console.log(`[FRONT DESK] ⚡ PERF: Using cached auto-variants (${this._autoVariantsCache.length} pairs)`);
            return this._autoVariantsCache;
        }
        
        const startTime = performance.now();
        console.log(`[FRONT DESK] 🔄 PERF: Computing auto-variants for ${names.length} names (${names.length * (names.length - 1) / 2} comparisons)...`);
        
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
        
        const result = variants.sort((a, b) => a.name1.localeCompare(b.name1));
        
        // Cache the result
        this._autoVariantsCache = result;
        this._autoVariantsCacheKey = cacheKey;
        
        const elapsed = performance.now() - startTime;
        if (elapsed > 50) {
            console.warn(`[FRONT DESK] ⚠️ SLOW PERF: Auto-variants took ${elapsed.toFixed(1)}ms for ${names.length} names`);
        } else {
            console.log(`[FRONT DESK] ✅ PERF: Auto-variants computed in ${elapsed.toFixed(1)}ms (found ${result.length} pairs)`);
        }
        
        return result;
    }
    
    // Clear variant cache when names change
    invalidateAutoVariantsCache() {
        this._autoVariantsCache = null;
        this._autoVariantsCacheKey = null;
        console.log('[FRONT DESK] 🗑️ Auto-variants cache cleared');
    }
    
    // STATIC preview - only shows cached results, NEVER computes
    renderAutoScanPreviewStatic() {
        // Check if we have cached results
        if (this._autoVariantsCache && this._autoVariantsCache.length > 0) {
            const variants = this._autoVariantsCache;
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
        
        // No cached results - show placeholder with instruction
        const nameCount = (this.config.commonFirstNames || []).length;
        return `
            <p style="color: #8b949e; margin: 0; font-style: italic;">
                Click "Scan Names" to detect spelling variants from your ${nameCount} names.
                <br><span style="font-size: 0.7rem; color: #6e7681;">This only runs when you click, not automatically.</span>
            </p>
        `;
    }
    
    // Manual button click - compute variants with progress
    // IMPORTANT: This also builds the precomputedVariantMap for runtime use
    computeAutoVariants() {
        const btn = document.getElementById('fdb-compute-variants-btn');
        const preview = document.getElementById('fdb-auto-scan-preview');
        
        if (!btn || !preview) return;
        
        // Show loading state
        btn.disabled = true;
        btn.innerHTML = '⏳ Scanning...';
        preview.innerHTML = '<p style="color: #f0883e; margin: 0;">Computing variants... This may take a moment for large name lists.</p>';
        
        // Use setTimeout to let UI update before heavy computation
        setTimeout(() => {
            const startTime = performance.now();
            const variants = this.findAutoVariants(true); // force recalculate
            const elapsed = performance.now() - startTime;
            
            console.log(`[FRONT DESK] ✅ Auto-variants computed: ${variants.length} pairs in ${elapsed.toFixed(1)}ms`);
            
            // ═══════════════════════════════════════════════════════════════════
            // CRITICAL: Build precomputedVariantMap for RUNTIME use
            // This map is saved to DB and used by ConversationEngine at runtime
            // Runtime does O(1) lookup instead of O(n²) computation
            // ═══════════════════════════════════════════════════════════════════
            const precomputedMap = {};
            variants.forEach(v => {
                const key1 = v.name1.toLowerCase();
                const key2 = v.name2.toLowerCase();
                if (!precomputedMap[key1]) precomputedMap[key1] = [];
                if (!precomputedMap[key2]) precomputedMap[key2] = [];
                if (!precomputedMap[key1].includes(key2)) precomputedMap[key1].push(key2);
                if (!precomputedMap[key2].includes(key1)) precomputedMap[key2].push(key1);
            });
            
            // Store in config for saving
            if (!this.config.nameSpellingVariants) this.config.nameSpellingVariants = {};
            this.config.nameSpellingVariants.precomputedVariantMap = precomputedMap;
            this.config.nameSpellingVariants.precomputedAt = new Date().toISOString();
            this.config.nameSpellingVariants.precomputedFromCount = (this.config.commonFirstNames || []).length;
            this.isDirty = true;
            
            console.log(`[FRONT DESK] 📦 Precomputed variant map stored for runtime:`, {
                mapKeys: Object.keys(precomputedMap).length,
                pairs: variants.length,
                willSaveOnSave: true
            });
            
            // Update preview with results
            if (variants.length === 0) {
                preview.innerHTML = '<p style="color: #8b949e; margin: 0; font-style: italic;">No 1-character variant pairs found. Try adding more names or use the curated list.</p>';
            } else {
                preview.innerHTML = `
                    <p style="color: #3fb950; margin: 0 0 8px 0; font-weight: 600;">Found ${variants.length} variant pair(s) in ${elapsed.toFixed(0)}ms:</p>
                    <p style="color: #f0883e; font-size: 0.7rem; margin: 0 0 8px 0;">⚡ Click SAVE to enable these for live calls</p>
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
            
            // Reset button
            btn.disabled = false;
            btn.innerHTML = '🔄 Scan Names';
        }, 50); // Small delay for UI to update
    }
    
    // DEPRECATED: Old render function - kept for compatibility but should not be called during render
    renderAutoScanPreview() {
        console.warn('[FRONT DESK] ⚠️ renderAutoScanPreview() called - this should not happen during tab render!');
        return this.renderAutoScanPreviewStatic();
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
        const safeLabel = this.escapeHtml(slot.label || 'Unnamed');
        const safeId = this.escapeHtml(slot.id || `slot_${index}`);
        const safeQuestion = this.escapeHtml((slot.question || '').slice(0, 120));
        const type = slot.type || 'text';
        const required = slot.required !== false;
        const confirmBack = slot.confirmBack === true;

        return `
            <div class="booking-slot-card" data-slot-index="${index}" style="background: #0d1117; border: 1px solid #30363d; border-radius: 10px; padding: 14px 14px;">
                <div style="display:flex; align-items:flex-start; justify-content: space-between; gap: 12px;">
                    <div style="min-width: 0;">
                        <div style="display:flex; align-items:center; gap: 10px; flex-wrap: wrap;">
                            <span style="font-weight: 800; color: #c9d1d9;">${safeLabel}</span>
                            <span style="font-family: monospace; font-size: 12px; color: #8b949e; background: #161b22; border: 1px solid #30363d; padding: 2px 8px; border-radius: 999px;">${safeId}</span>
                            <span style="font-size: 12px; color: #8b949e; background: #161b22; border: 1px solid #30363d; padding: 2px 8px; border-radius: 999px;">type: ${this.escapeHtml(type)}</span>
                            ${required ? `<span style="font-size: 12px; color: #f85149; background: #161b22; border: 1px solid #f8514950; padding: 2px 8px; border-radius: 999px;">required</span>` : `<span style="font-size: 12px; color: #6e7681; background: #161b22; border: 1px solid #30363d; padding: 2px 8px; border-radius: 999px;">optional</span>`}
                            ${confirmBack ? `<span style="font-size: 12px; color: #3fb950; background: #161b22; border: 1px solid #3fb95040; padding: 2px 8px; border-radius: 999px;">confirm back</span>` : ``}
                        </div>
                        <div style="margin-top: 8px; color: #8b949e; font-size: 12px; line-height: 1.35;">
                            <span style="color:#6e7681;">Question:</span>
                            <span style="color:#c9d1d9;">${safeQuestion || '<span style="color:#f0883e;">(not set)</span>'}</span>
                        </div>
                    </div>

                    <div style="display:flex; flex-direction: column; gap: 8px; align-items: flex-end;">
                        <div style="display:flex; gap: 6px;">
                            <button onclick="window.frontDeskManager.moveSlot(${index}, -1)" ${isFirst ? 'disabled' : ''} 
                                style="padding: 6px 10px; background: ${isFirst ? '#21262d' : '#30363d'}; border: none; border-radius: 6px; color: ${isFirst ? '#484f58' : '#c9d1d9'}; cursor: ${isFirst ? 'not-allowed' : 'pointer'}; font-size: 12px;"
                                title="Move up">▲</button>
                            <button onclick="window.frontDeskManager.moveSlot(${index}, 1)" ${isLast ? 'disabled' : ''} 
                                style="padding: 6px 10px; background: ${isLast ? '#21262d' : '#30363d'}; border: none; border-radius: 6px; color: ${isLast ? '#484f58' : '#c9d1d9'}; cursor: ${isLast ? 'not-allowed' : 'pointer'}; font-size: 12px;"
                                title="Move down">▼</button>
                        </div>
                        <div style="display:flex; gap: 6px;">
                            <button onclick="window.frontDeskManager.editBookingSlot(${index})"
                                style="padding: 7px 10px; background: #238636; border: none; border-radius: 6px; color: white; cursor: pointer; font-weight: 800; font-size: 12px;">
                                Edit
                            </button>
                            <button onclick="window.frontDeskManager.removeSlot(${index})"
                                style="padding: 7px 10px; background: #21262d; border: 1px solid #f8514950; border-radius: 6px; color: #f85149; cursor: pointer; font-weight: 800; font-size: 12px;">
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderBookingSlotEditorForm(slot) {
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

        return `
            <div class="booking-slot" style="display:flex; flex-direction: column; gap: 12px;">
                <!-- Row 1: Label, ID, Type -->
                <div style="display: grid; grid-template-columns: 2fr 1fr 1.5fr; gap: 12px; align-items: end;">
                    <div>
                        <label style="display: block; font-size: 11px; color: #8b949e; margin-bottom: 6px;">Label (what admin sees)</label>
                        <input type="text" class="slot-label" value="${this.escapeHtml(slot.label || '')}" placeholder="e.g. Full Name" 
                            style="width: 100%; padding: 10px; background: #0b0f14; border: 1px solid #30363d; border-radius: 8px; color: #c9d1d9;">
                    </div>
                    <div>
                        <label style="display: block; font-size: 11px; color: #8b949e; margin-bottom: 6px;">Slot ID (code reference)</label>
                        <input type="text" class="slot-id" value="${this.escapeHtml(slot.id || '')}" placeholder="e.g. name" 
                            style="width: 100%; padding: 10px; background: #0b0f14; border: 1px solid #30363d; border-radius: 8px; color: #c9d1d9; font-family: monospace; font-size: 12px;">
                    </div>
                    <div>
                        <label style="display: block; font-size: 11px; color: #8b949e; margin-bottom: 6px;">Type</label>
                        <select class="slot-type" id="fdb-slot-editor-type"
                            style="width: 100%; padding: 10px; background: #0b0f14; border: 1px solid #30363d; border-radius: 8px; color: #c9d1d9;">
                            ${typeOptions.map(t => `<option value="${t.value}" ${slot.type === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <!-- Row 2: Question -->
                <div>
                    <label style="display: block; font-size: 11px; color: #8b949e; margin-bottom: 6px;">🎙️ Question AI Asks (exact wording)</label>
                    <input type="text" class="slot-question" value="${this.escapeHtml(slot.question || '')}" placeholder="May I have your name, please?" 
                        style="width: 100%; padding: 12px; background: #0b0f14; border: 1px solid #30363d; border-radius: 8px; color: #c9d1d9; font-size: 14px;">
                </div>

                <!-- Row 3: Required + Confirm Back -->
                <div style="display:flex; gap: 12px; flex-wrap: wrap;">
                    <label style="display:flex; align-items:center; gap: 10px; padding: 10px 12px; background:#0b0f14; border:1px solid #30363d; border-radius: 8px; cursor:pointer;">
                        <input type="checkbox" class="slot-required" ${slot.required !== false ? 'checked' : ''} style="accent-color:#f85149; width: 18px; height: 18px;">
                        <span style="color:#c9d1d9; font-weight:800;">Required</span>
                    </label>
                    <label style="display:flex; align-items:center; gap: 10px; padding: 10px 12px; background:#0b0f14; border:1px solid #30363d; border-radius: 8px; cursor:pointer;">
                        <input type="checkbox" class="slot-confirmBack" ${slot.confirmBack ? 'checked' : ''} style="accent-color:#3fb950; width: 18px; height: 18px;">
                        <span style="color:#c9d1d9; font-weight:800;">Confirm back</span>
                    </label>
                </div>

                <div>
                    <label style="display: block; font-size: 11px; color: #8b949e; margin-bottom: 6px;">Confirm prompt (used only if Confirm back is ON)</label>
                    <input type="text" class="slot-confirmPrompt" value="${this.escapeHtml(confirmPrompt)}" 
                        placeholder="Just to confirm, that's {value}, correct?"
                        style="width: 100%; padding: 10px; background: #0b0f14; border: 1px solid #30363d; border-radius: 8px; color: #c9d1d9; font-size: 12px; ${slot.confirmBack ? '' : 'opacity: 0.5;'}"
                        ${slot.confirmBack ? '' : 'disabled'}>
                </div>

                <!-- Type-Specific Options Container -->
                <div class="slot-type-options" id="fdb-slot-editor-type-options">
                    ${this.renderSlotTypeOptions(slot, 0)}
                </div>

                <!-- Advanced Options -->
                <details style="background: #0b0f14; border-radius: 8px; border: 1px solid #30363d;">
                    <summary style="padding: 10px 12px; cursor: pointer; font-size: 12px; color: #8b949e; user-select: none;">
                        ⚙️ Advanced Options
                    </summary>
                    <div style="padding: 12px; display: grid; gap: 12px; border-top: 1px solid #30363d;">
                        <div>
                            <label style="display: block; font-size: 11px; color: #8b949e; margin-bottom: 6px;">Validation Pattern (regex, optional)</label>
                            <input type="text" class="slot-validation" value="${this.escapeHtml(slot.validation || '')}" 
                                placeholder="e.g. ^[a-zA-Z ]+$ for text only"
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; color: #c9d1d9; font-family: monospace; font-size: 11px;">
                        </div>

                        <label style="display:flex; align-items:center; gap: 10px; padding: 10px 12px; background:#0d1117; border:1px solid #30363d; border-radius: 8px; cursor:pointer;">
                            <input type="checkbox" class="slot-skipIfKnown" ${slot.skipIfKnown ? 'checked' : ''} style="accent-color:#58a6ff; width: 18px; height: 18px;">
                            <span style="color:#c9d1d9; font-weight:800;">Skip if already known (returning customer)</span>
                        </label>

                        <div>
                            <label style="display: block; font-size: 11px; color: #8b949e; margin-bottom: 6px;">AI Helper Note (internal, not spoken)</label>
                            <input type="text" class="slot-helperNote" value="${this.escapeHtml(slot.helperNote || '')}" 
                                placeholder="Internal hint for the AI (not spoken)"
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; color: #c9d1d9; font-size: 12px;">
                        </div>
                    </div>
                </details>
            </div>
        `;
    }

    showBookingSlotEditorModal({ mode, slotIndex = null, slotDraft }) {
        // Close any existing
        this.closeBookingSlotEditorModal();

        const overlay = document.createElement('div');
        overlay.id = 'fdb-slot-editor-overlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 999999;
            background: rgba(0,0,0,0.72);
            display: flex; align-items: stretch; justify-content: stretch;
        `;

        const panel = document.createElement('div');
        panel.id = 'fdb-slot-editor-panel';
        panel.style.cssText = `
            width: 100%; height: 100%;
            background: #0d1117;
            color: #c9d1d9;
            display: flex; flex-direction: column;
        `;

        const title = mode === 'create' ? 'Add Booking Slot' : 'Edit Booking Slot';
        panel.innerHTML = `
            <div style="display:flex; align-items:center; justify-content: space-between; gap: 12px; padding: 16px 18px; border-bottom: 1px solid #30363d;">
                <div style="min-width: 0;">
                    <div style="font-size: 18px; font-weight: 900; color: #58a6ff;">${title}</div>
                    <div style="font-size: 12px; color: #8b949e; margin-top: 2px;">Configure the slot comfortably. This editor is the source of truth.</div>
                </div>
                <div style="display:flex; gap: 10px;">
                    <button id="fdb-slot-editor-copy"
                        style="padding: 10px 14px; background: #1f6feb; border: none; border-radius: 8px; color: white; cursor: pointer; font-weight: 800; display: flex; align-items: center; gap: 6px;"
                        title="Copy all slot settings as JSON for debugging">
                        📋 Copy Settings
                    </button>
                    <button id="fdb-slot-editor-cancel"
                        style="padding: 10px 14px; background: #21262d; border: 1px solid #30363d; border-radius: 8px; color: #c9d1d9; cursor: pointer; font-weight: 800;">
                        Cancel
                    </button>
                    <button id="fdb-slot-editor-save"
                        style="padding: 10px 14px; background: #238636; border: none; border-radius: 8px; color: white; cursor: pointer; font-weight: 900;">
                        Save Slot
                    </button>
                </div>
            </div>

            <div style="flex: 1; overflow: auto; padding: 18px;">
                <div style="max-width: 1100px; margin: 0 auto;">
                    ${this.renderBookingSlotEditorForm(slotDraft)}
                </div>
            </div>
        `;

        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        const close = () => this.closeBookingSlotEditorModal();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        panel.querySelector('#fdb-slot-editor-cancel')?.addEventListener('click', close);

        // Wire copy settings button
        panel.querySelector('#fdb-slot-editor-copy')?.addEventListener('click', () => {
            try {
                const currentSlot = this.collectBookingSlotFromEditor(panel);
                const formattedJson = JSON.stringify(currentSlot, null, 2);
                navigator.clipboard.writeText(formattedJson).then(() => {
                    const btn = panel.querySelector('#fdb-slot-editor-copy');
                    const originalText = btn.innerHTML;
                    btn.innerHTML = '✅ Copied!';
                    btn.style.background = '#238636';
                    setTimeout(() => {
                        btn.innerHTML = originalText;
                        btn.style.background = '#1f6feb';
                    }, 2000);
                }).catch(err => {
                    console.error('Copy failed:', err);
                    alert('Copy failed. Check console for details.');
                });
            } catch (e) {
                console.error('[FRONT DESK] ❌ Copy settings failed', e);
                alert(`Copy failed: ${e.message}`);
            }
        });

        // Wire type change inside modal
        const typeEl = panel.querySelector('#fdb-slot-editor-type');
        if (typeEl) {
            typeEl.addEventListener('change', () => {
                const newType = typeEl.value || 'text';
                slotDraft.type = newType;
                const container = panel.querySelector('#fdb-slot-editor-type-options');
                if (container) {
                    container.innerHTML = this.renderSlotTypeOptions(slotDraft, 0);
                }
            });
        }

        // Wire confirmBack toggle
        const confirmBackEl = panel.querySelector('.slot-confirmBack');
        const confirmPromptEl = panel.querySelector('.slot-confirmPrompt');
        if (confirmBackEl && confirmPromptEl) {
            const syncConfirm = () => {
                const enabled = confirmBackEl.checked === true;
                confirmPromptEl.disabled = !enabled;
                confirmPromptEl.style.opacity = enabled ? '1' : '0.5';
            };
            confirmBackEl.addEventListener('change', syncConfirm);
            syncConfirm();
        }

        // Save
        panel.querySelector('#fdb-slot-editor-save')?.addEventListener('click', () => {
            try {
                const savedSlot = this.collectBookingSlotFromEditor(panel);
                this.upsertBookingSlot(mode, slotIndex, savedSlot);
                this.closeBookingSlotEditorModal();
            } catch (e) {
                console.error('[FRONT DESK] ❌ Slot editor save failed', e);
                alert(`Save failed: ${e.message}`);
            }
        });

        // Focus first input
        setTimeout(() => {
            const first = panel.querySelector('.slot-label');
            if (first) { first.focus(); first.select?.(); }
        }, 50);
    }

    closeBookingSlotEditorModal() {
        const overlay = document.getElementById('fdb-slot-editor-overlay');
        if (overlay) overlay.remove();
    }

    collectBookingSlotFromEditor(panelEl) {
        const el = panelEl.querySelector('.booking-slot');
        if (!el) throw new Error('Slot editor is missing form element');

        const getVal = (selector) => el.querySelector(selector)?.value?.trim() || '';
        const getChecked = (selector) => el.querySelector(selector)?.checked ?? false;
        const getCheckedDefault = (selector, defaultVal) => {
            const elem = el.querySelector(selector);
            return elem ? elem.checked : defaultVal;
        };

        const slotData = {
            id: getVal('.slot-id'),
            label: getVal('.slot-label'),
            question: getVal('.slot-question'),
            required: getCheckedDefault('.slot-required', true),
            type: el.querySelector('.slot-type')?.value || 'text',
            confirmBack: getChecked('.slot-confirmBack'),
            confirmPrompt: getVal('.slot-confirmPrompt') || "Just to confirm, that's {value}, correct?",
            validation: getVal('.slot-validation') || null,
            skipIfKnown: getChecked('.slot-skipIfKnown'),
            helperNote: getVal('.slot-helperNote') || null
        };

        // Validate basics
        if (!slotData.id) throw new Error('Slot ID is required (e.g. "name", "phone", "address")');
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(slotData.id)) {
            throw new Error('Slot ID must be alphanumeric/underscore and start with a letter (e.g. "serviceAddress", "unit_number")');
        }
        if (!slotData.label) throw new Error('Label is required');
        if (!slotData.question) throw new Error('Question is required');

        // Reuse the existing collector by temporarily running the same logic on the editor element
        // (Type-specific options use the same class names as the list view did.)
        // We replicate the relevant parts here to stay deterministic.

        // NAME options
        if (el.querySelector('.slot-askFullName')) slotData.askFullName = getCheckedDefault('.slot-askFullName', false);
        if (el.querySelector('.slot-useFirstNameOnly')) slotData.useFirstNameOnly = getCheckedDefault('.slot-useFirstNameOnly', true);
        if (el.querySelector('.slot-askMissingNamePart')) slotData.askMissingNamePart = getChecked('.slot-askMissingNamePart');
        if (el.querySelector('.slot-confirmSpelling')) slotData.confirmSpelling = getChecked('.slot-confirmSpelling');
        // V59 NUKE: Both first and last name questions MUST be from UI.
        // IMPORTANT: Never inject defaults on save — that can overwrite admin-configured prompts (e.g., debug suffixes like "... 3?").
        if (el.querySelector('.slot-firstNameQuestion')) slotData.firstNameQuestion = getVal('.slot-firstNameQuestion');
        if (el.querySelector('.slot-lastNameQuestion')) slotData.lastNameQuestion = getVal('.slot-lastNameQuestion');
        if (el.querySelector('.slot-duplicateNamePartPrompt')) slotData.duplicateNamePartPrompt = getVal('.slot-duplicateNamePartPrompt') || "";

        // Enforce required name-part prompts when the behavior depends on them
        if ((slotData.type === 'name' || slotData.id === 'name') && slotData.askMissingNamePart === true) {
            if (!slotData.firstNameQuestion || !slotData.firstNameQuestion.trim()) {
                throw new Error('First Name Question is required when "Ask once for missing part" is enabled.');
            }
            if (!slotData.lastNameQuestion || !slotData.lastNameQuestion.trim()) {
                throw new Error('Last Name Question is required when "Ask once for missing part" is enabled.');
            }
        }

        // V93: Slot-level Mid-Call Helpers (collected from slot editor DOM)
        const midCallRows = [...el.querySelectorAll('.midcall-rule-row')];
        if (midCallRows.length > 0) {
            // Clear prior validation UI
            midCallRows.forEach((row) => {
                row.style.outline = '';
                row.style.borderRadius = '';
                row.removeAttribute('data-midcall-error');
            });

            const partialErrors = [];

            slotData.midCallRules = midCallRows.map((row, idx) => {
                const id = row.querySelector('.midcall-rule-id')?.value?.trim() || window.frontDeskManager?.generateMidCallRuleId?.() || `mcr_${Date.now()}`;
                const enabled = row.querySelector('.midcall-rule-enabled')?.checked === true;
                const trigger = row.querySelector('.midcall-rule-trigger')?.value?.trim() || '';
                const matchType = row.querySelector('.midcall-rule-matchType')?.value || 'contains';
                const action = row.querySelector('.midcall-rule-action')?.value || 'reply_reask';
                const responseTemplate = row.querySelector('.midcall-rule-template')?.value?.trim() || '';
                const cooldownTurns = parseInt(row.querySelector('.midcall-rule-cooldown')?.value || '2', 10);
                const maxPerCall = parseInt(row.querySelector('.midcall-rule-max')?.value || '2', 10);

                // Integrity gate: never silently drop partially filled rows.
                // If either side is provided, require both.
                const hasTrigger = !!trigger;
                const hasTemplate = !!responseTemplate;
                if ((hasTrigger && !hasTemplate) || (!hasTrigger && hasTemplate)) {
                    const missing = [];
                    if (!hasTrigger) missing.push('Caller says (trigger)');
                    if (!hasTemplate) missing.push('AI responds (template)');
                    partialErrors.push({ idx, missing });
                    // UI highlight (row-level) for immediate admin feedback
                    row.style.outline = '2px solid rgba(248, 81, 73, 0.75)';
                    row.style.borderRadius = '10px';
                    row.setAttribute('data-midcall-error', `Missing: ${missing.join(', ')}`);
                }

                return {
                    id,
                    enabled,
                    matchType,
                    trigger,
                    action,
                    responseTemplate,
                    cooldownTurns: Number.isFinite(cooldownTurns) ? cooldownTurns : 2,
                    maxPerCall: Number.isFinite(maxPerCall) ? maxPerCall : 2
                };
            }).filter(r => r.trigger && r.responseTemplate);

            if (partialErrors.length > 0) {
                const lines = partialErrors.map(e => `Rule #${e.idx + 1}: missing ${e.missing.join(' + ')}`);
                const msg = `Mid-call helper rules are incomplete:\n${lines.join('\n')}\n\nFix highlighted rows (or delete them) before saving.`;
                this.showNotification(`❌ ${lines[0]}${lines.length > 1 ? ` (+${lines.length - 1} more)` : ''}`, 'error');
                throw new Error(msg);
            }
        } else {
            slotData.midCallRules = [];
        }
        
        // V63 DEBUG: Log name slot collection
        if (slotData.type === 'name' || slotData.id === 'name') {
            console.log('[FRONT DESK] 📝 V63 DEBUG - Collecting name slot:', {
                id: slotData.id,
                type: slotData.type,
                askMissingNamePart: slotData.askMissingNamePart,
                confirmSpelling: slotData.confirmSpelling,
                confirmSpellingCheckbox: el.querySelector('.slot-confirmSpelling'),
                confirmSpellingChecked: el.querySelector('.slot-confirmSpelling')?.checked,
                firstNameQuestion: slotData.firstNameQuestion,
                lastNameQuestion: slotData.lastNameQuestion,
                duplicateNamePartPrompt: slotData.duplicateNamePartPrompt ? '(set)' : '(empty)'
            });
        }

        // PHONE options
        if (el.querySelector('.slot-offerCallerId')) slotData.offerCallerId = getCheckedDefault('.slot-offerCallerId', true);
        if (el.querySelector('.slot-callerIdPrompt')) slotData.callerIdPrompt = getVal('.slot-callerIdPrompt') || "I see you're calling from {callerId} - is that a good number for text confirmations, or would you prefer a different one?";
        if (el.querySelector('.slot-acceptTextMe')) slotData.acceptTextMe = getCheckedDefault('.slot-acceptTextMe', true);
        if (el.querySelector('.slot-breakDownIfUnclear')) slotData.breakDownIfUnclear = getChecked('.slot-breakDownIfUnclear');

        // ADDRESS options
        if (el.querySelector('.slot-addressConfirmLevel')) slotData.addressConfirmLevel = el.querySelector('.slot-addressConfirmLevel')?.value || 'street_city';
        if (el.querySelector('.slot-acceptPartialAddress')) slotData.acceptPartialAddress = getChecked('.slot-acceptPartialAddress');
        if (el.querySelector('.slot-useGoogleMapsValidation')) slotData.useGoogleMapsValidation = getChecked('.slot-useGoogleMapsValidation');
        if (el.querySelector('.slot-googleMapsValidationMode')) slotData.googleMapsValidationMode = el.querySelector('.slot-googleMapsValidationMode')?.value || 'confirm_low_confidence';
        if (el.querySelector('.slot-unitNumberMode')) slotData.unitNumberMode = el.querySelector('.slot-unitNumberMode')?.value || 'smart';
        if (el.querySelector('.slot-unitNumberPrompt')) slotData.unitNumberPrompt = getVal('.slot-unitNumberPrompt') || 'Is there an apartment or unit number?';
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
        
        // V72: SERVICE AREA VALIDATION options
        if (el.querySelector('.slot-serviceAreaEnabled')) slotData.serviceAreaEnabled = getChecked('.slot-serviceAreaEnabled');
        if (el.querySelector('.slot-servicedZipCodes')) {
            const zipsText = getVal('.slot-servicedZipCodes');
            slotData.servicedZipCodes = zipsText ? zipsText.split(',').map(z => z.trim()).filter(z => /^\d{5}$/.test(z)) : [];
        }
        if (el.querySelector('.slot-servicedCities')) {
            const citiesText = getVal('.slot-servicedCities');
            slotData.servicedCities = citiesText ? citiesText.split(',').map(c => c.trim()).filter(c => c) : [];
        }
        if (el.querySelector('.slot-radiusCoverageEnabled')) slotData.radiusCoverageEnabled = getChecked('.slot-radiusCoverageEnabled');
        if (el.querySelector('.slot-centerLat')) {
            const lat = parseFloat(el.querySelector('.slot-centerLat')?.value);
            if (!isNaN(lat)) slotData.centerLat = lat;
        }
        if (el.querySelector('.slot-centerLng')) {
            const lng = parseFloat(el.querySelector('.slot-centerLng')?.value);
            if (!isNaN(lng)) slotData.centerLng = lng;
        }
        if (el.querySelector('.slot-radiusMiles')) {
            const radius = parseInt(el.querySelector('.slot-radiusMiles')?.value);
            if (!isNaN(radius)) slotData.radiusMiles = radius;
        }
        if (el.querySelector('.slot-inAreaResponse')) slotData.inAreaResponse = getVal('.slot-inAreaResponse') || '';
        if (el.querySelector('.slot-outOfAreaResponse')) slotData.outOfAreaResponse = getVal('.slot-outOfAreaResponse') || '';
        if (el.querySelector('.slot-serviceAreaSummary')) slotData.serviceAreaSummary = getVal('.slot-serviceAreaSummary') || '';

        // EMAIL options
        if (el.querySelector('.slot-spellOutEmail')) slotData.spellOutEmail = getCheckedDefault('.slot-spellOutEmail', true);
        if (el.querySelector('.slot-offerToSendText')) slotData.offerToSendText = getChecked('.slot-offerToSendText');

        // DATE/TIME options
        if (el.querySelector('.slot-offerAsap')) slotData.offerAsap = getCheckedDefault('.slot-offerAsap', true);
        if (el.querySelector('.slot-offerMorningAfternoon')) slotData.offerMorningAfternoon = getChecked('.slot-offerMorningAfternoon');
        if (el.querySelector('.slot-asapPhrase')) slotData.asapPhrase = getVal('.slot-asapPhrase') || 'first available';

        // SELECT options
        if (el.querySelector('.slot-selectOptions')) {
            const optionsText = getVal('.slot-selectOptions');
            slotData.selectOptions = optionsText ? optionsText.split('\n').map(o => o.trim()).filter(o => o) : [];
        }
        if (el.querySelector('.slot-allowOther')) slotData.allowOther = getChecked('.slot-allowOther');

        // YES/NO options
        if (el.querySelector('.slot-yesAction')) slotData.yesAction = getVal('.slot-yesAction') || null;
        if (el.querySelector('.slot-noAction')) slotData.noAction = getVal('.slot-noAction') || null;

        // NUMBER options
        if (el.querySelector('.slot-minValue')) {
            const minVal = el.querySelector('.slot-minValue')?.value;
            slotData.minValue = minVal !== '' ? parseFloat(minVal) : null;
        }
        if (el.querySelector('.slot-maxValue')) {
            const maxVal = el.querySelector('.slot-maxValue')?.value;
            slotData.maxValue = maxVal !== '' ? parseFloat(maxVal) : null;
        }
        if (el.querySelector('.slot-unit')) slotData.unit = getVal('.slot-unit') || null;

        return slotData;
    }

    upsertBookingSlot(mode, slotIndex, savedSlot) {
        const slots = this.config.bookingSlots || this.getDefaultBookingSlots();

        // Enforce unique id
        const existing = slots.find((s, idx) => (s?.id === savedSlot.id) && !(mode === 'edit' && idx === slotIndex));
        if (existing) {
            throw new Error(`Slot ID "${savedSlot.id}" already exists. Slot IDs must be unique.`);
        }

        if (mode === 'create') {
            slots.push(savedSlot);
        } else {
            if (slotIndex === null || slotIndex === undefined || !slots[slotIndex]) {
                throw new Error('Invalid slot index for edit');
            }
            slots[slotIndex] = { ...slots[slotIndex], ...savedSlot };
        }

        // Normalize order
        slots.forEach((s, i) => { s.order = i; });
        this.config.bookingSlots = slots;
        this.isDirty = true;

        const container = document.getElementById('booking-slots-container');
        if (container) {
            container.innerHTML = slots.map((slot, idx) => this.renderBookingSlot(slot, idx, slots.length)).join('');
        }
    }

    editBookingSlot(index) {
        const slots = this.config.bookingSlots || [];
        const slot = slots[index];
        if (!slot) return;
        const draft = JSON.parse(JSON.stringify(slot));
        this.showBookingSlotEditorModal({ mode: 'edit', slotIndex: index, slotDraft: draft });
    }
    
    // Render type-specific options based on slot type
    renderSlotTypeOptions(slot, index) {
        const type = slot.type || 'text';
        
        // Name type options
        if (type === 'name' || slot.id === 'name') {
            return `
                <div style="display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; background: #1a2233; border-radius: 4px; border: 1px solid #58a6ff40;">
                    <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
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
                    
                    <!-- V59: Name Questions - UI configurable, NO HARDCODED FALLBACKS -->
                    <div style="display: ${slot.askFullName === true || slot.askMissingNamePart === true ? 'flex' : 'none'}; flex-direction: column; gap: 12px; padding-top: 8px; border-top: 1px solid #30363d;" id="nameQuestionsSection-${index}">
                        <div style="font-size: 11px; color: #f85149; font-weight: 600;">
                            🚨 V59: These questions are REQUIRED when "Ask once for missing part" is enabled. NO hardcoded fallbacks!
                        </div>
                        
                        <!-- First Name Question -->
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <label style="font-size: 11px; color: #58a6ff; font-weight: 600;">
                                📝 First Name Question (when caller gives last name first):
                            </label>
                            <input type="text" class="slot-firstNameQuestion" data-index="${index}" 
                                value="${this.escapeHtml(slot.firstNameQuestion || '')}" 
                                placeholder="And what's your first name?"
                                style="width: 100%; padding: 8px 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px;">
                            <span style="font-size: 10px; color: #8b949e;">Asked when caller says "My name is Smith" (last name only)</span>
                        </div>
                        
                        <!-- Last Name Question -->
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <label style="font-size: 11px; color: #58a6ff; font-weight: 600;">
                                📝 Last Name Question (when asking for missing last name):
                            </label>
                            <input type="text" class="slot-lastNameQuestion" data-index="${index}" 
                                value="${this.escapeHtml(slot.lastNameQuestion || '')}" 
                                placeholder="And what's your last name?"
                                style="width: 100%; padding: 8px 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px;">
                            <span style="font-size: 10px; color: #8b949e;">Use {firstName} to include caller name, e.g. "Got it, {firstName}. And what's your last name?"</span>
                        </div>

                        <!-- V85: Duplicate/unclear last name recovery -->
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <label style="font-size: 11px; color: #f0883e; font-weight: 700;">
                                🧯 Duplicate / Confusing Last Name Prompt (when caller repeats first name)
                            </label>
                            <textarea class="slot-duplicateNamePartPrompt" data-index="${index}" rows="2"
                                placeholder="I just want to make sure I get this right — I have your first name as {firstName}, and I heard {candidate} for your last name. {lastNameQuestion}"
                                style="width: 100%; padding: 8px 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; resize: vertical;">${this.escapeHtml(slot.duplicateNamePartPrompt || '')}</textarea>
                            <span style="font-size: 10px; color: #8b949e;">
                                Placeholders: {firstName}, {candidate}, {lastNameQuestion}. Leave empty to just re-ask the Last Name Question.
                            </span>
                        </div>
                    </div>
                    
                    <!-- V46: Spelling Variant Check - creates a sub-requirement -->
                    <div style="display: flex; align-items: center; gap: 16px; padding-top: 8px; border-top: 1px solid #30363d; flex-wrap: wrap;">
                        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;" title="Check for spelling variants (Mark/Marc, Brian/Bryan) and confirm with caller. Uses your 908 common first names list.">
                            <input type="checkbox" class="slot-confirmSpelling" data-index="${index}" ${slot.confirmSpelling === true ? 'checked' : ''} style="accent-color: #f0883e;">
                            <span style="font-size: 12px; color: ${slot.confirmSpelling ? '#f0883e' : '#c9d1d9'}; font-weight: ${slot.confirmSpelling ? '600' : 'normal'};">
                                ✏️ Confirm spelling variants (Mark/Marc)
                            </span>
                        </label>
                        <span style="font-size: 10px; color: #8b949e; font-style: italic;">
                            Uses Name Spelling Variants config above
                        </span>
                    </div>

                    ${this.renderMidCallRulesEditor(slot)}
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

                    ${this.renderMidCallRulesEditor(slot)}
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
                    
                    <!-- V72: Service Area Validation -->
                    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #30363d;">
                        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px;">
                            <span style="font-size: 11px; color: #da3633; font-weight: 600;">📍 Service Area Validation:</span>
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;" title="Check if address is within your service area before proceeding">
                                <input type="checkbox" class="slot-serviceAreaEnabled" data-index="${index}" ${slot.serviceAreaEnabled ? 'checked' : ''} style="accent-color: #da3633;" onchange="window.frontDeskManager.toggleServiceAreaOptions(${index}, this.checked)">
                                <span style="font-size: 12px; color: #c9d1d9;">Enable service area validation</span>
                            </label>
                        </div>
                        <div class="service-area-options" style="display: ${slot.serviceAreaEnabled ? 'flex' : 'none'}; flex-direction: column; gap: 10px; padding: 10px; background: #0d1117; border-radius: 4px; border: 1px solid #da3633;">
                            
                            <!-- ZIP Codes -->
                            <div>
                                <label style="font-size: 11px; color: #da3633; display: block; margin-bottom: 4px; font-weight: 600;">ZIP Codes We Service (comma-separated):</label>
                                <textarea class="slot-servicedZipCodes" data-index="${index}" rows="2" 
                                    placeholder="33901, 33903, 33904, 33905, 33907, 33908, 33909, 33912, 33913, 33916, 33919"
                                    style="width: 100%; padding: 6px 8px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px; resize: vertical;">${(slot.servicedZipCodes || []).join(', ')}</textarea>
                            </div>
                            
                            <!-- Cities -->
                            <div>
                                <label style="font-size: 11px; color: #da3633; display: block; margin-bottom: 4px; font-weight: 600;">Cities We Service (comma-separated):</label>
                                <input type="text" class="slot-servicedCities" data-index="${index}" 
                                    value="${(slot.servicedCities || []).join(', ')}"
                                    placeholder="Fort Myers, Cape Coral, Naples, Bonita Springs, Estero"
                                    style="width: 100%; padding: 6px 8px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px;">
                            </div>
                            
                            <!-- Radius-based coverage -->
                            <div style="padding: 8px; background: #161b22; border-radius: 4px; border: 1px dashed #30363d;">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                        <input type="checkbox" class="slot-radiusCoverageEnabled" data-index="${index}" ${slot.radiusCoverageEnabled ? 'checked' : ''} style="accent-color: #da3633;">
                                        <span style="font-size: 12px; color: #c9d1d9; font-weight: 600;">🗺️ Use radius coverage (auto-check cities with Google Maps)</span>
                                    </label>
                                </div>
                                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                                    <div style="flex: 1; min-width: 120px;">
                                        <label style="font-size: 10px; color: #8b949e; display: block; margin-bottom: 2px;">Center Latitude:</label>
                                        <input type="number" step="0.0001" class="slot-centerLat" data-index="${index}" 
                                            value="${slot.centerLat || ''}"
                                            placeholder="26.6406"
                                            style="width: 100%; padding: 4px 6px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px;">
                                    </div>
                                    <div style="flex: 1; min-width: 120px;">
                                        <label style="font-size: 10px; color: #8b949e; display: block; margin-bottom: 2px;">Center Longitude:</label>
                                        <input type="number" step="0.0001" class="slot-centerLng" data-index="${index}" 
                                            value="${slot.centerLng || ''}"
                                            placeholder="-81.8723"
                                            style="width: 100%; padding: 4px 6px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px;">
                                    </div>
                                    <div style="flex: 1; min-width: 80px;">
                                        <label style="font-size: 10px; color: #8b949e; display: block; margin-bottom: 2px;">Radius (miles):</label>
                                        <input type="number" class="slot-radiusMiles" data-index="${index}" 
                                            value="${slot.radiusMiles || 25}"
                                            placeholder="25"
                                            style="width: 100%; padding: 4px 6px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px;">
                                    </div>
                                </div>
                                <div style="font-size: 10px; color: #6e7681; margin-top: 6px;">
                                    💡 Tip: Find your coordinates on Google Maps → Right-click your location → Copy coordinates
                                </div>
                            </div>
                            
                            <!-- Responses -->
                            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                                <div style="flex: 1; min-width: 200px;">
                                    <label style="font-size: 10px; color: #8b949e; display: block; margin-bottom: 2px;">✅ In service area response:</label>
                                    <input type="text" class="slot-inAreaResponse" data-index="${index}" 
                                        value="${slot.inAreaResponse || 'Great! We do service {city}. Let me help you get scheduled.'}"
                                        placeholder="Great! We do service {city}."
                                        style="width: 100%; padding: 4px 6px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px;">
                                </div>
                                <div style="flex: 1; min-width: 200px;">
                                    <label style="font-size: 10px; color: #8b949e; display: block; margin-bottom: 2px;">❌ Out of area response:</label>
                                    <input type="text" class="slot-outOfAreaResponse" data-index="${index}" 
                                        value="${slot.outOfAreaResponse || "I'm sorry, we don't service {area}. We cover {serviceAreaSummary}."}"
                                        placeholder="I'm sorry, we don't service {area}."
                                        style="width: 100%; padding: 4px 6px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px;">
                                </div>
                            </div>
                            
                            <!-- Service Area Summary -->
                            <div>
                                <label style="font-size: 10px; color: #8b949e; display: block; margin-bottom: 2px;">Service area summary (used in responses):</label>
                                <input type="text" class="slot-serviceAreaSummary" data-index="${index}" 
                                    value="${slot.serviceAreaSummary || ''}"
                                    placeholder="Fort Myers, Cape Coral, Naples, and surrounding areas"
                                    style="width: 100%; padding: 4px 6px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px;">
                            </div>
                            
                            <div style="font-size: 10px; color: #6e7681; font-style: italic;">
                                📍 When caller gives address or asks "Do you service {city}?", agent checks against your ZIP codes and radius. Use {city}, {area}, {serviceAreaSummary} in responses.
                            </div>
                        </div>
                    </div>

                    ${this.renderMidCallRulesEditor(slot)}
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

                    ${this.renderMidCallRulesEditor(slot)}
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
        // PERF FIX: Use config as source of truth
        const slots = this.config.bookingSlots || [];
        const slot = slots[index];
        if (!slot) return;
        
        slot.type = newType;
        this.isDirty = true;
        
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
    
    // V72: Toggle service area options visibility
    toggleServiceAreaOptions(index, enabled) {
        const slotContainer = document.querySelector(`.slot-serviceAreaEnabled[data-index="${index}"]`)?.closest('.booking-slot');
        if (!slotContainer) return;
        
        const serviceAreaOptions = slotContainer.querySelector('.service-area-options');
        if (serviceAreaOptions) {
            serviceAreaOptions.style.display = enabled ? 'flex' : 'none';
        }
        
        console.log(`[FRONT DESK] Service area validation ${enabled ? 'enabled' : 'disabled'} for slot ${index}`);
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
    
    // NOTE: Golden slot loader removed to prevent outdated slot templates

    // ═══════════════════════════════════════════════════════════════════════
    // BOOKING CONTRACT V2 (BETA) - Safe migration + preview compile
    // ═══════════════════════════════════════════════════════════════════════
    async migrateBookingContractV2FromBookingSlots() {
        const btn = document.getElementById('fdb-bcv2-migrate-btn');
        if (!btn) return;

        const ok = confirm(
            'Migrate current Booking Slots → Booking Contract V2?\n\n' +
            'This will generate slotLibrary + a Base Booking slotGroup.\n' +
            'It does NOT delete your existing bookingSlots.\n\n' +
            'Proceed?'
        );
        if (!ok) return;

        const original = btn.innerHTML;
        try {
            btn.disabled = true;
            btn.innerHTML = '⏳ Migrating...';

            const token = localStorage.getItem('adminToken') || localStorage.getItem('token') || sessionStorage.getItem('token');
            const resp = await fetch(`/api/company/${this.companyId}/booking-contract-v2/migrate/from-bookingSlots`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ enableAfter: false, groupLabel: 'Base Booking' })
            });

            const data = await resp.json();
            if (!resp.ok || !data.success) {
                throw new Error(data.message || data.error || `HTTP ${resp.status}`);
            }

            // Reload Front Desk config (admin endpoint) so UI reflects persisted values
            await this.load();

            const container = document.querySelector('.front-desk-behavior-panel');
            if (container) this.switchTab('booking', container);

            this.showNotification('✅ Migrated Booking Slots → Booking Contract V2 (not enabled yet)', 'success');
        } catch (e) {
            console.error('[FRONT DESK] ❌ V2 migrate failed', e);
            this.showNotification('❌ V2 migrate failed: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }

    async previewBookingContractV2Compile() {
        const statusEl = document.getElementById('fdb-bcv2-preview-status');
        const outEl = document.getElementById('fdb-bcv2-preview-output');
        const btn = document.getElementById('fdb-bcv2-preview-btn');

        const showStatus = (text, tone = 'neutral') => {
            if (!statusEl) return;
            statusEl.style.display = 'block';
            statusEl.style.borderColor = tone === 'error' ? '#f85149' : tone === 'success' ? '#3fb950' : '#30363d';
            statusEl.style.color = tone === 'error' ? '#f85149' : tone === 'success' ? '#3fb950' : '#8b949e';
            statusEl.textContent = text;
        };

        const showOutput = (obj) => {
            if (!outEl) return;
            outEl.style.display = 'block';
            outEl.textContent = JSON.stringify(obj, null, 2);
        };

        try {
            if (btn) {
                btn.disabled = true;
                btn.textContent = '⏳ Previewing...';
            }

            // Parse flags JSON
            const rawFlags = document.getElementById('fdb-bcv2-flags-json')?.value || '{}';
            let flags = {};
            try {
                flags = rawFlags && rawFlags.trim() ? JSON.parse(rawFlags) : {};
            } catch (e) {
                throw new Error(`Flags JSON is invalid: ${e.message}`);
            }

            // Parse editors (so preview reflects unsaved edits)
            const rawLibrary = document.getElementById('fdb-bcv2-slotLibrary-json')?.value || '[]';
            const rawGroups = document.getElementById('fdb-bcv2-slotGroups-json')?.value || '[]';
            const slotLibrary = JSON.parse(rawLibrary);
            const slotGroups = JSON.parse(rawGroups);
            if (!Array.isArray(slotLibrary)) throw new Error('Slot Library must be a JSON array');
            if (!Array.isArray(slotGroups)) throw new Error('Slot Groups must be a JSON array');

            const token = localStorage.getItem('adminToken') || localStorage.getItem('token') || sessionStorage.getItem('token');
            const resp = await fetch(`/api/company/${this.companyId}/booking-contract-v2/compile`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ slotLibrary, slotGroups, flags })
            });

            const data = await resp.json();
            if (!resp.ok || !data.success) {
                throw new Error(data.message || data.error || `HTTP ${resp.status}`);
            }

            const compiled = data.data.compiled;
            const activeCount = (compiled.activeSlotIdsOrdered || []).length;
            const missing = (compiled.missingSlotRefs || []).length;

            if (activeCount === 0) {
                showStatus('❌ Compiled active slots is empty. Check your slotGroups.when and slotGroups.slots.', 'error');
            } else if (missing > 0) {
                showStatus(`❌ Missing slotLibrary ids referenced by groups: ${compiled.missingSlotRefs.slice(0, 5).join(', ')}`, 'error');
            } else {
                showStatus(`✅ Compiled OK: ${activeCount} active slots. Hash: ${compiled.hash}`, 'success');
            }

            showOutput(data.data);
        } catch (e) {
            console.error('[FRONT DESK] ❌ V2 preview failed', e);
            showStatus('❌ Preview failed: ' + e.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔍 Preview compile';
            }
        }
    }
    
    addBookingSlot() {
        const slots = this.config.bookingSlots || this.getDefaultBookingSlots();
        const draft = {
            id: `custom_${Date.now()}`,
            label: 'New Field',
            question: '',
            required: false,
            order: slots.length,
            type: 'text',
            confirmBack: false,
            confirmPrompt: "Just to confirm, {value}?"
        };
        this.showBookingSlotEditorModal({ mode: 'create', slotDraft: draft });
    }
    
    removeSlot(index) {
        const slots = this.config.bookingSlots || [];
        
        if (slots.length <= 1) {
            alert('You must have at least one booking slot.');
            return;
        }
        
        const slot = slots[index];
        if (!slot) {
            console.error(`[FRONT DESK] ❌ removeSlot: Invalid index ${index}`);
            return;
        }
        
        // User confirmation (this blocks main thread - that's expected)
        if (!confirm(`Delete "${slot.label}" slot?`)) {
            return;
        }
        
        // Update data
        slots.splice(index, 1);
        slots.forEach((s, i) => s.order = i);
        this.config.bookingSlots = slots;
        this.isDirty = true;
        
        // Re-render slots only (not full tab)
        document.getElementById('booking-slots-container').innerHTML = 
            slots.map((slot, idx) => this.renderBookingSlot(slot, idx, slots.length)).join('');
        
        console.log(`[FRONT DESK] ✅ Slot removed: ${slot.id}`);
    }
    
    moveSlot(index, direction) {
        // Use config as source of truth
        const slots = this.config.bookingSlots || [];
        const newIndex = index + direction;
        
        if (newIndex < 0 || newIndex >= slots.length) return;
        
        // Swap slots
        [slots[index], slots[newIndex]] = [slots[newIndex], slots[index]];
        
        // Update order values
        slots.forEach((s, i) => s.order = i);
        
        this.config.bookingSlots = slots;
        this.isDirty = true;
        document.getElementById('booking-slots-container').innerHTML = 
            slots.map((slot, idx) => this.renderBookingSlot(slot, idx, slots.length)).join('');
        console.log(`[FRONT DESK] ⏱️ Slot moved: ${index} → ${newIndex}`);
    }
    
    collectBookingSlots() {
        // UI now edits booking slots via full-screen modal; config is the source of truth.
        const slots = Array.isArray(this.config.bookingSlots) ? this.config.bookingSlots : [];
        const normalized = slots.map((s, i) => ({ ...s, order: i }));
        return normalized.length > 0 ? normalized : this.getDefaultBookingSlots();
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // PERF FIX: Lightweight sync from DOM to config (only core fields)
    // Called before add/remove/move operations to capture any user edits
    // ═══════════════════════════════════════════════════════════════════════════
    syncBookingSlotsFromDOM() {
        // No-op: booking slot editing no longer relies on scraping inline DOM.
        return;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 🧠 DYNAMIC FLOWS TAB - Phase 3: Trigger → Event → State → Action
    // ═══════════════════════════════════════════════════════════════════════════
    renderDynamicFlowsTab() {
        return `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                
                <!-- ═══════════════════════════════════════════════════════════════ -->
                <!-- TRADE CATEGORY SELECTOR - Filter templates by industry         -->
                <!-- ═══════════════════════════════════════════════════════════════ -->
                <div style="
                    background: linear-gradient(135deg, #1a1f35 0%, #161b22 100%);
                    border: 1px solid #30363d;
                    border-radius: 8px;
                    padding: 16px;
                    margin-bottom: 20px;
                ">
                    <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 20px;">🏷️</span>
                            <label style="color: #c9d1d9; font-weight: 600; white-space: nowrap;">
                                Trade Category:
                            </label>
                        </div>
                        <select id="fdb-trade-category-select" style="
                            padding: 10px 16px;
                            background: #0d1117;
                            color: #58a6ff;
                            border: 1px solid #30363d;
                            border-radius: 6px;
                            font-size: 14px;
                            font-weight: 600;
                            cursor: pointer;
                            min-width: 200px;
                        ">
                            <option value="">⏳ Loading categories...</option>
                        </select>
                        <span style="color: #8b949e; font-size: 13px; margin-left: auto;">
                            Templates below are filtered by selected category
                        </span>
                    </div>
                </div>
                
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
                                Templates for <span id="fdb-selected-category-name" style="color: #58a6ff;">selected trade category</span>
                            </p>
                        </div>
                    </div>
                    <div id="fdb-templates-list" style="display: flex; flex-direction: column; gap: 8px;">
                        <div style="text-align: center; padding: 20px; color: #8b949e;">
                            Select a trade category above to view templates
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
    
    renderFlowCard(flow, isTemplate = false, isAlreadyCopied = false, matchType = 'key') {
        const statusColor = flow.enabled ? '#238636' : '#6e7681';
        const statusText = flow.enabled ? 'ACTIVE' : 'DISABLED';
        
        const triggerCount = (flow.triggers || []).length;
        const requirementCount = (flow.requirements || []).length;
        const actionCount = (flow.actions || []).length;
        
        // ═══════════════════════════════════════════════════════════════════════════
        // INVALID TEMPLATE WARNING: Templates with 0 triggers cannot be copied
        // ═══════════════════════════════════════════════════════════════════════════
        const isInvalidTemplate = isTemplate && flow.enabled && triggerCount === 0;
        const invalidBadge = isInvalidTemplate ? '<span style="font-size: 11px; padding: 2px 8px; background: #f85149; border-radius: 10px; color: white; font-weight: 600;">⚠️ NEEDS TRIGGERS</span>' : '';
        
        const templateBadge = isTemplate ? '<span style="font-size: 11px; padding: 2px 8px; background: #6e40c9; border-radius: 10px; color: white;">TEMPLATE</span>' : '';
        const priorityBadge = flow.priority > 50 ? '<span style="font-size: 11px; padding: 2px 8px; background: #f85149; border-radius: 10px; color: white;">HIGH PRIORITY</span>' : '';
        
        // Show different badge based on match type
        let alreadyCopiedBadge = '';
        if (isAlreadyCopied) {
            if (matchType === 'name') {
                alreadyCopiedBadge = '<span style="font-size: 11px; padding: 2px 8px; background: #f59e0b; border-radius: 10px; color: black; font-weight: 600;">⚠️ SIMILAR EXISTS</span>';
            } else {
                alreadyCopiedBadge = '<span style="font-size: 11px; padding: 2px 8px; background: #388bfd; border-radius: 10px; color: white;">✓ ADDED</span>';
            }
        }
        
        // Card opacity for already-copied templates
        const cardOpacity = isAlreadyCopied ? 'opacity: 0.6;' : '';
        
        let buttons = '';
        if (isTemplate) {
            if (isAlreadyCopied) {
                // Already copied or similar exists - show indicator
                if (matchType === 'name') {
                    // Similar name exists - still allow copying but warn
                    buttons = `
                        <button class="flow-copy-btn" data-flow-id="${flow._id}" style="
                            padding: 8px 12px;
                            background: #21262d;
                            color: #f59e0b;
                            border: 1px solid #f59e0b;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 12px;
                        ">⚠️ Copy Anyway</button>
                        <span style="
                            padding: 8px 12px;
                            background: #21262d;
                            color: #8b949e;
                            border-radius: 4px;
                            font-size: 11px;
                        ">Similar flow exists</span>
                    `;
                } else {
                    // Exact key match - definitely already added
                    buttons = `
                        <span style="
                            padding: 8px 12px;
                            background: #21262d;
                            color: #388bfd;
                            border: 1px solid #388bfd;
                            border-radius: 4px;
                            font-size: 12px;
                            font-weight: 500;
                        ">✓ Already Added</span>
                    `;
                }
            } else if (isInvalidTemplate) {
                // Template has 0 triggers - cannot be copied
                buttons = `
                    <span style="
                        padding: 8px 12px;
                        background: #21262d;
                        color: #f85149;
                        border: 1px solid #f85149;
                        border-radius: 4px;
                        font-size: 11px;
                        font-weight: 500;
                    ">⚠️ Fix Template (0 Triggers)</span>
                `;
            } else {
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
            }
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
                border: 1px solid ${isAlreadyCopied ? '#388bfd' : '#30363d'};
                border-radius: 8px;
                padding: 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                ${cardOpacity}
                transition: opacity 0.2s ease;
            ">
                <div style="flex: 1;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                        <span style="font-weight: 600; color: #c9d1d9;">${flow.name}</span>
                        <span style="font-size: 11px; padding: 2px 8px; background: ${statusColor}; border-radius: 10px; color: white;">
                            ${statusText}
                        </span>
                        ${templateBadge}
                        ${invalidBadge}
                        ${alreadyCopiedBadge}
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
    
    // ═══════════════════════════════════════════════════════════════════════════
    // TRADE CATEGORY SYSTEM - Filter templates by industry
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Initialize the Dynamic Flows tab with trade categories
     */
    async initDynamicFlowsTab(container) {
        // Store selected trade category (default to first available)
        this.selectedTradeCategoryId = null;
        this.tradeCategoriesCache = [];
        
        // Load trade categories from API
        await this.loadTradeCategories(container);
        
        // Set up trade category dropdown listener
        const dropdown = container.querySelector('#fdb-trade-category-select');
        if (dropdown) {
            dropdown.addEventListener('change', async (e) => {
                this.selectedTradeCategoryId = e.target.value || null;
                const selectedOption = e.target.options[e.target.selectedIndex];
                const categoryName = selectedOption?.text || 'selected trade category';
                
                // Update the label showing which category is selected
                const nameSpan = container.querySelector('#fdb-selected-category-name');
                if (nameSpan) {
                    nameSpan.textContent = categoryName;
                }
                
                // Refresh the flows list with the new filter
                await this.refreshFlowsList(container);
            });
        }
        
        // Initial load of flows
        await this.refreshFlowsList(container);
    }
    
    /**
     * Load trade categories from the API
     */
    async loadTradeCategories(container) {
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const response = await fetch('/api/v2global/trade-categories/categories?includeQnAs=false&includeStats=false', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) throw new Error('Failed to load trade categories');
            
            const result = await response.json();
            this.tradeCategoriesCache = result.data || [];
            
            // Populate the dropdown
            const dropdown = container.querySelector('#fdb-trade-category-select');
            if (dropdown) {
                // Clear existing options
                dropdown.innerHTML = '';
                
                // Add "All Categories" option
                const allOption = document.createElement('option');
                allOption.value = '';
                allOption.textContent = '📂 All Categories';
                dropdown.appendChild(allOption);
                
                // Add each trade category
                this.tradeCategoriesCache.forEach(category => {
                    const option = document.createElement('option');
                    option.value = category._id;
                    option.textContent = `${this.getTradeCategoryIcon(category.name)} ${category.name}`;
                    dropdown.appendChild(option);
                });
                
                // Pre-select HVAC if available (since that's what we're building now)
                const hvacCategory = this.tradeCategoriesCache.find(c => 
                    c.name.toLowerCase().includes('hvac')
                );
                if (hvacCategory) {
                    dropdown.value = hvacCategory._id;
                    this.selectedTradeCategoryId = hvacCategory._id;
                    
                    // Update the category name label
                    const nameSpan = container.querySelector('#fdb-selected-category-name');
                    if (nameSpan) {
                        nameSpan.textContent = hvacCategory.name;
                    }
                }
                
                console.log('[DYNAMIC FLOWS] Trade categories loaded:', this.tradeCategoriesCache.length);
            }
        } catch (error) {
            console.error('[DYNAMIC FLOWS] Failed to load trade categories:', error);
            
            // Show error in dropdown
            const dropdown = container.querySelector('#fdb-trade-category-select');
            if (dropdown) {
                dropdown.innerHTML = '<option value="">⚠️ Failed to load categories</option>';
            }
        }
    }
    
    /**
     * Get an appropriate emoji icon for a trade category
     */
    getTradeCategoryIcon(categoryName) {
        const name = (categoryName || '').toLowerCase();
        if (name.includes('hvac') || name.includes('air') || name.includes('heating')) return '🌡️';
        if (name.includes('plumb')) return '🔧';
        if (name.includes('elect')) return '⚡';
        if (name.includes('dent')) return '🦷';
        if (name.includes('medic') || name.includes('health')) return '🏥';
        if (name.includes('legal') || name.includes('law')) return '⚖️';
        if (name.includes('auto') || name.includes('car')) return '🚗';
        if (name.includes('roof')) return '🏠';
        if (name.includes('pest')) return '🐜';
        return '🏢';
    }
    
    async refreshFlowsList(container) {
        const flowsContainer = container.querySelector('#fdb-flows-list');
        const templatesContainer = container.querySelector('#fdb-templates-list');
        
        if (!flowsContainer) return;
        
        const data = await this.loadDynamicFlows();
        const v1Templates = this.getV1SampleFlows();
        
        // Extract flowKeys that are already in company flows (for "already copied" detection)
        const copiedFlowKeys = new Set(
            (data.flows || [])
                .map(f => f.flowKey?.toLowerCase())
                .filter(Boolean)
        );
        
        // Also track company flow names (normalized) for similarity detection
        // This helps detect "Emergency Service Detection" template when company has similar flow
        const copiedFlowNames = new Set(
            (data.flows || [])
                .map(f => f.name?.toLowerCase().replace(/[^a-z0-9]/g, ''))
                .filter(Boolean)
        );
        
        // Render company flows
        if (data.flows && data.flows.length > 0) {
            flowsContainer.innerHTML = data.flows.map(f => this.renderFlowCard(f, false, false)).join('');
        } else {
            flowsContainer.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #8b949e; background: #0d1117; border: 1px solid #30363d; border-radius: 8px;">
                    <div style="font-size: 48px; margin-bottom: 16px;">🧠</div>
                    <p style="font-weight: 600; margin-bottom: 8px;">No custom flows yet</p>
                    <p style="font-size: 13px;">Add a flow or copy from templates below to get started.</p>
                </div>
            `;
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // FILTER TEMPLATES BY TRADE CATEGORY (ObjectId ONLY - NO NAME LOOKUPS)
        // ═══════════════════════════════════════════════════════════════════════════
        if (templatesContainer) {
            // Start with API-persisted templates (these have real tradeCategoryIds)
            let allTemplates = data.templates || [];
            
            // ═══════════════════════════════════════════════════════════════════════════
            // DEDUPLICATE BY flowKey: DB templates are AUTHORITATIVE over V1 samples
            // If a flowKey exists in DB, don't show the V1 sample (DB is the truth)
            // ═══════════════════════════════════════════════════════════════════════════
            const dbFlowKeys = new Set(allTemplates.map(t => t.flowKey?.toLowerCase()).filter(Boolean));
            
            // ═══════════════════════════════════════════════════════════════════════════
            // V1 SAMPLE TEMPLATES: Show ONLY when "All Categories" selected (no filter)
            // AND only if the flowKey doesn't already exist in DB templates
            // ═══════════════════════════════════════════════════════════════════════════
            if (!this.selectedTradeCategoryId) {
                // "All Categories" mode: show V1 samples that don't duplicate DB templates
                const uniqueV1Samples = v1Templates.filter(v1 => 
                    !dbFlowKeys.has(v1.flowKey?.toLowerCase())
                );
                allTemplates = allTemplates.concat(uniqueV1Samples);
            }
            
            // ═══════════════════════════════════════════════════════════════════════════
            // FILTER BY tradeCategoryId (ObjectId) - THE AUTHORITATIVE KEY
            // Never match by name. ObjectId is the line number. Name is just decoration.
            // ═══════════════════════════════════════════════════════════════════════════
            if (this.selectedTradeCategoryId) {
                allTemplates = allTemplates.filter(t => {
                    // ONLY match by tradeCategoryId (ObjectId)
                    // This is the correct, immutable, database-native way
                    return t.tradeCategoryId === this.selectedTradeCategoryId;
                });
            }
            
            if (allTemplates.length > 0) {
                templatesContainer.innerHTML = allTemplates.map(t => {
                    // Check by flowKey OR by similar name
                    const normalizedName = t.name?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
                    const matchedByKey = copiedFlowKeys.has(t.flowKey?.toLowerCase());
                    const matchedByName = copiedFlowNames.has(normalizedName);
                    const isAlreadyCopied = matchedByKey || matchedByName;
                    const matchType = matchedByKey ? 'key' : (matchedByName ? 'name' : null);
                    return this.renderFlowCard(t, true, isAlreadyCopied, matchType);
                }).join('');
            } else {
                const selectedCategory = this.tradeCategoriesCache.find(c => c._id === this.selectedTradeCategoryId);
                const categoryName = selectedCategory?.name || 'this category';
                templatesContainer.innerHTML = `
                    <div style="text-align: center; padding: 30px; color: #8b949e; background: #0d1117; border: 1px solid #30363d; border-radius: 8px;">
                        <div style="font-size: 32px; margin-bottom: 12px;">📋</div>
                        <p style="font-weight: 600; margin-bottom: 8px;">No templates for ${categoryName}</p>
                        <p style="font-size: 13px;">Templates will appear here when added for this trade category.</p>
                    </div>
                `;
            }
        }
        
        // Attach flow-specific event listeners
        this.attachFlowEventListeners(container);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // V1 SAMPLE FLOWS - STARTER TEMPLATES (JS-BASED, PRE-SEED)
    // ═══════════════════════════════════════════════════════════════════════════
    // 
    // IMPORTANT: These are NOT production templates. They are SEED SOURCES.
    // 
    // The workflow is:
    //   1. V1 samples appear ONLY when "All Categories" is selected (no filter)
    //   2. Admin copies templates into the company
    //   3. After copy, DB templates are the truth, JS samples are ignored
    //   4. Copy-to-Company uses the DROPDOWN-SELECTED tradeCategoryId (not name lookup)
    //
    // NO NAME-BASED LOOKUPS. The dropdown ObjectId is the ONLY source of truth.
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
        // ═══════════════════════════════════════════════════════════════════════════
        // V1 samples have NO tradeCategoryId (they're not in DB yet)
        // They only show when dropdown = "All Categories" (no filter applied)
        // When copied, they inherit the SELECTED dropdown tradeCategoryId
        // ═══════════════════════════════════════════════════════════════════════════
        const tradeCategoryId = null;  // V1 samples are category-agnostic until copied
        const tradeCategoryName = null; // No name - assigned at copy time
        
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
                tradeCategoryId: tradeCategoryId,   // null until copied to DB
                tradeCategoryName: tradeCategoryName, // null - assigned at copy time from dropdown
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
                tradeCategoryId: tradeCategoryId,   // null until copied to DB
                tradeCategoryName: tradeCategoryName, // null - assigned at copy time from dropdown
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
                tradeCategoryId: tradeCategoryId,   // null until copied to DB
                tradeCategoryName: tradeCategoryName, // null - assigned at copy time from dropdown
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
                tradeCategoryId: tradeCategoryId,   // null until copied to DB
                tradeCategoryName: tradeCategoryName, // null - assigned at copy time from dropdown
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
                tradeCategoryId: tradeCategoryId,   // null until copied to DB
                tradeCategoryName: tradeCategoryName, // null - assigned at copy time from dropdown
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
                tradeCategoryId: tradeCategoryId,   // null until copied to DB
                tradeCategoryName: tradeCategoryName, // null - assigned at copy time from dropdown
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
                tradeCategoryId: tradeCategoryId,   // null until copied to DB
                tradeCategoryName: tradeCategoryName, // null - assigned at copy time from dropdown
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
                
                // ═══════════════════════════════════════════════════════════════════
                // V2 TRADE CATEGORY: Use DROPDOWN-SELECTED ObjectId (NEVER name lookup)
                // The dropdown is the ONLY source of truth for tradeCategoryId
                // ═══════════════════════════════════════════════════════════════════
                const selectedCategory = (this.tradeCategoriesCache || []).find(c => 
                    c._id === this.selectedTradeCategoryId
                );
                
                const payload = { 
                    ...sample, 
                    _id: undefined, 
                    isTemplate: false,
                    // tradeCategoryId comes from DROPDOWN SELECTION (ObjectId)
                    tradeCategoryId: this.selectedTradeCategoryId || null,
                    // tradeCategoryName is just display - looked up from selection
                    tradeCategoryName: selectedCategory?.name || null
                };
                
                console.log('[DYNAMIC FLOWS] POST payload (with trade category):', JSON.stringify(payload, null, 2));
                
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

            // For API-persisted templates, include tradeCategoryId from selected category
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const response = await fetch(`/api/company/${this.companyId}/dynamic-flows/from-template`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    templateId,
                    tradeCategoryId: this.selectedTradeCategoryId || null
                })
            });
            
            if (!response.ok) {
                const err = await response.json();
                // Show detailed validation errors if present
                if (err.validationErrors && err.validationErrors.length > 0) {
                    console.error('[DYNAMIC FLOWS] Template validation failed:', err.validationErrors);
                    const errorList = err.validationErrors.join('\n• ');
                    this.showNotification(`Template Invalid:\n• ${errorList}`, 'error');
                    return;
                }
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

        // Defensive: ensure we never stack multiple editor modals (double-modal bug)
        const existing = document.getElementById('flow-editor-modal');
        if (existing) {
            console.warn('[FLOW EDITOR] ⚠️ Existing flow editor modal found - removing before opening a new one');
            existing.remove();
        }
        
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
            
            // ═══════════════════════════════════════════════════════════════════════════
            // V1 ACTION COMPLETENESS VALIDATION
            // Enabled flows MUST have all 4 action types for Wiring to consider them valid:
            // - set_flag, append_ledger, ack_once, transition_mode
            // This prevents the "enabled but invalid" state that causes Wiring penalties
            // ═══════════════════════════════════════════════════════════════════════════
            if (flowData.enabled) {
                const actionTypes = (flowData.actions || []).map(a => a.type);
                const REQUIRED_ACTIONS = ['set_flag', 'append_ledger', 'ack_once', 'transition_mode'];
                const missingActions = REQUIRED_ACTIONS.filter(t => !actionTypes.includes(t));
                
                if (missingActions.length > 0) {
                    // Auto-inject defaults for missing actions
                    console.log('[FLOW EDITOR] Auto-injecting missing actions:', missingActions);
                    
                    const flowKey = flowData.flowKey || flowData.name?.toLowerCase().replace(/\s+/g, '_');
                    const flowName = flowData.name || 'Flow';
                    
                    for (const actionType of missingActions) {
                        if (actionType === 'append_ledger') {
                            flowData.actions.push({
                                timing: 'on_activate',
                                type: 'append_ledger',
                                config: {
                                    type: 'EVENT',
                                    key: flowKey.toUpperCase().replace(/-/g, '_'),
                                    note: `${flowName} triggered`
                                },
                                description: 'Auto-injected ledger entry'
                            });
                        } else if (actionType === 'transition_mode') {
                            flowData.actions.push({
                                timing: 'on_activate',
                                type: 'transition_mode',
                                config: {
                                    targetMode: 'BOOKING',
                                    setBookingLocked: true
                                },
                                description: 'Auto-injected mode transition'
                            });
                        } else if (actionType === 'set_flag') {
                            flowData.actions.push({
                                timing: 'on_activate',
                                type: 'set_flag',
                                config: {
                                    flagName: `dynamicFlow.${flowKey}`,
                                    flagValue: true,
                                    alsoWriteToCallLedgerFacts: true
                                },
                                description: 'Auto-injected flag'
                            });
                        } else if (actionType === 'ack_once') {
                            flowData.actions.push({
                                timing: 'on_activate',
                                type: 'ack_once',
                                config: {
                                    text: '' // Intentionally empty - will use AI-generated acknowledgment
                                },
                                description: 'Auto-injected acknowledgment placeholder'
                            });
                        }
                    }
                    
                    this.showNotification(`Auto-added ${missingActions.length} required action(s): ${missingActions.join(', ')}`, 'info');
                }
            }
            
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
        const defaults = {
            nudgeNamePrompt: "Sure — go ahead.",
            nudgePhonePrompt: "Sure — go ahead with the area code first.",
            nudgeAddressPrompt: "No problem — go ahead with the street address, and include unit number if you have one."
        };
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
                
                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #30363d;">
                    <h4 style="margin: 0 0 8px 0; color: #c9d1d9;">🧲 Nudge Prompts (when caller is hesitant or gives partial input)</h4>
                    <p style="color: #8b949e; margin-bottom: 12px; font-size: 0.8rem;">
                        These are the “gentle push” lines the agent uses instead of breaking down or looping.
                    </p>
                    <div style="display: grid; grid-template-columns: 1fr; gap: 12px;">
                        <div>
                            <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Name Nudge</label>
                            <input type="text" id="fdb-nudge-name" value="${lp.nudgeNamePrompt || defaults.nudgeNamePrompt}"
                                placeholder="${defaults.nudgeNamePrompt}"
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Phone Nudge</label>
                            <input type="text" id="fdb-nudge-phone" value="${lp.nudgePhonePrompt || defaults.nudgePhonePrompt}"
                                placeholder="${defaults.nudgePhonePrompt}"
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Address Nudge</label>
                            <input type="text" id="fdb-nudge-address" value="${lp.nudgeAddressPrompt || defaults.nudgeAddressPrompt}"
                                placeholder="${defaults.nudgeAddressPrompt}"
                                style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        </div>
                    </div>
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
            noResponse: "Hello — are you still there?",
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
                    
                    <!-- Silence / No Response -->
                    <div style="background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 16px;">
                        <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                            <span style="background:#334155; color:#e2e8f0; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:700;">SILENCE</span>
                            <span style="color:#c9d1d9; font-weight:600;">Caller is silent / no input</span>
                        </div>
                        <input type="text" id="fdb-fb-noresponse" value="${fb.noResponse || defaults.noResponse}"
                            placeholder="${defaults.noResponse}"
                            style="width: 100%; padding: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px;">
                        <p style="color:#8b949e; font-size:11px; margin:8px 0 0 0;">
                            Used when the caller doesn’t respond. Keep it short and polite (no blame).
                        </p>
                    </div>
                    
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
        const recommendedConsentPhrases = [
            'schedule a visit',
            'book an appointment',
            'send a technician',
            'come out to my house',
            'set up service',
            'schedule me',
            'can you schedule this',
            'schedule service today'
        ];
        
        // Get current values with defaults
        const bookingRequiresConsent = dc.bookingRequiresExplicitConsent !== false;
        const forceLLMDiscovery = dc.forceLLMDiscovery !== false;
        const disableScenarioAuto = dc.disableScenarioAutoResponses !== false;
        const autoReplyAllowedTypes = Array.isArray(dc.autoReplyAllowedScenarioTypes)
            ? dc.autoReplyAllowedScenarioTypes.map(t => (t || '').toString().trim().toUpperCase()).filter(Boolean)
            : [];
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
                    <h4 style="margin: 0 0 12px 0; color: #f85149; display: flex; align-items: center; gap: 8px;">
                        🔒 Kill Switches (LLM Discovery Controls)
                        <span title="LLM Discovery settings: control whether the LLM speaks first and whether scenarios can auto-respond during discovery." style="color: #8b949e; font-size: 12px; cursor: help;">
                            <i class="fas fa-info-circle"></i>
                        </span>
                    </h4>
                    <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 16px;">
                        These toggles control LLM-led discovery and scenario auto-responses. All should be ON for best results.
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
                        <div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap: wrap;">
                            <button class="btn btn-secondary" style="padding: 8px 10px; font-size: 12px;" onclick="window.frontDeskBehaviorManager.applyRecommendedConsentPhrases()">
                                <i class="fas fa-magic"></i> Apply Recommended
                            </button>
                        </div>
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

                <!-- Consent Split: Safe scenario auto-replies BEFORE consent (multi-tenant safe) -->
                <div style="background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                    <h4 style="margin: 0 0 12px 0; color: #3fb950;">🧩 Consent Split (Non-booking Auto-Replies)</h4>
                    <p style="color: #8b949e; font-size: 0.8rem; margin-bottom: 16px;">
                        Multi-tenant safe rule: you may allow <strong>specific scenario types</strong> to reply before consent, while still requiring explicit consent for <strong>BOOKING</strong>.
                        This is a <em>policy</em> (not trade logic).
                    </p>

                    <div style="display: flex; flex-wrap: wrap; gap: 10px;">
                        <label style="display:flex; align-items:center; gap:8px; padding:10px 12px; border:1px solid #30363d; border-radius:8px; background:#161b22; cursor:pointer;">
                            <input type="checkbox" id="fdb-dc-autoReply-FAQ" ${autoReplyAllowedTypes.includes('FAQ') ? 'checked' : ''} style="accent-color:#3fb950; width:16px; height:16px;">
                            <span style="color:#c9d1d9; font-weight:600;">FAQ</span>
                        </label>
                        <label style="display:flex; align-items:center; gap:8px; padding:10px 12px; border:1px solid #30363d; border-radius:8px; background:#161b22; cursor:pointer;">
                            <input type="checkbox" id="fdb-dc-autoReply-TROUBLESHOOT" ${autoReplyAllowedTypes.includes('TROUBLESHOOT') ? 'checked' : ''} style="accent-color:#3fb950; width:16px; height:16px;">
                            <span style="color:#c9d1d9; font-weight:600;">TROUBLESHOOT</span>
                        </label>
                        <label style="display:flex; align-items:center; gap:8px; padding:10px 12px; border:1px solid #30363d; border-radius:8px; background:#161b22; cursor:pointer;">
                            <input type="checkbox" id="fdb-dc-autoReply-EMERGENCY" ${autoReplyAllowedTypes.includes('EMERGENCY') ? 'checked' : ''} style="accent-color:#3fb950; width:16px; height:16px;">
                            <span style="color:#c9d1d9; font-weight:600;">EMERGENCY</span>
                        </label>
                    </div>

                    <div style="margin-top: 10px; color:#8b949e; font-size:0.75rem;">
                        <div><strong>Important:</strong> BOOKING actions remain consent-gated by <code>bookingRequiresExplicitConsent</code>.</div>
                        <div>If <strong>Scenarios as Context Only</strong> is ON, these types are the only ones allowed to be used verbatim; others stay context-only.</div>
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

    applyRecommendedConsentPhrases() {
        const recommended = [
            'schedule a visit',
            'book an appointment',
            'send a technician',
            'come out to my house',
            'set up service',
            'schedule me',
            'can you schedule this',
            'schedule service today'
        ];
        const textarea = document.getElementById('fdb-dc-wantsBooking');
        const yesWordsInput = document.getElementById('fdb-dc-yesWords');
        if (textarea) textarea.value = recommended.join('\\n');
        // Only populate yes-words if empty to avoid clobbering admin content
        if (yesWordsInput && !yesWordsInput.value.trim()) {
            yesWordsInput.value = 'yes, yeah, yep, please, sure, okay, ok';
        }
        this.showNotification('✅ Applied recommended consent phrases (not saved yet)', 'success');
        this.isDirty = true;
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

        // V57: Deep Verification
        container.querySelector('#fdb-verify-btn')?.addEventListener('click', () => this.runDeepVerification());
        
        // Auto-run verification on load
        setTimeout(() => this.runDeepVerification(), 500);

        // --------------------------------------------------------------------
        // Delegated listeners (work across tab re-renders)
        // switchTab() re-renders innerHTML for fdb-tab-content, so direct
        // element listeners would silently break after navigating.
        // --------------------------------------------------------------------
        if (!this._delegatesBound) {
            this._delegatesBound = true;

            // Slider text updates (personality tab)
            container.addEventListener('input', (e) => {
                const t = e?.target;
                if (!t || !t.id) return;
                if (t.id === 'fdb-max-words') {
                    const val = container.querySelector('#fdb-max-words-val');
                    if (val) val.textContent = t.value;
                }
                if (t.id === 'fdb-warmth') {
                    const val = container.querySelector('#fdb-warmth-val');
                    if (val) val.textContent = `${t.value}%`;
                }
            });

            // V79 UX: Clickable info popovers (no hover dependency)
            container.addEventListener('click', (e) => {
                const btn = e?.target?.closest?.('.fdb-info-btn[data-info-key]');
                if (!btn) return;
                e.preventDefault();
                const key = btn.dataset.infoKey;
                const panel = container.querySelector(`.fdb-info-panel[data-info-key="${key}"]`);
                if (!panel) return;
                const isHidden = panel.style.display === 'none' || !panel.style.display;
                panel.style.display = isHidden ? 'block' : 'none';
            });
            
            // V79.3 UX: Reset-to-recommended buttons for key personality controls
            container.addEventListener('click', (e) => {
                const btn = e?.target?.closest?.('.fdb-reset-recommended[data-reset-key]');
                if (!btn) return;
                e.preventDefault();
                const key = btn.dataset.resetKey;
                
                if (key === 'maxResponseWords') {
                    const slider = container.querySelector('#fdb-max-words');
                    const val = container.querySelector('#fdb-max-words-val');
                    if (slider) slider.value = '30';
                    if (val) val.textContent = '30';
                    this.isDirty = true;
                    return;
                }
                if (key === 'warmth') {
                    const slider = container.querySelector('#fdb-warmth');
                    const val = container.querySelector('#fdb-warmth-val');
                    if (slider) slider.value = '60';
                    if (val) val.textContent = '60%';
                    this.isDirty = true;
                    return;
                }
                if (key === 'speakingPace') {
                    const sel = container.querySelector('#fdb-speaking-pace');
                    if (sel) sel.value = 'normal';
                    this.isDirty = true;
                    return;
                }
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
        // NOTE: legacy UI uses both names in onclick handlers.
        window.frontDeskBehaviorManager = this;
        window.frontDeskManager = this;
    }

    switchTab(tabId, container) {
        const startTime = performance.now();
        console.log(`[FRONT DESK] 🔄 CHECKPOINT: switchTab START - tab: ${tabId}`);
        
        // CHECKPOINT 1: Update tab visual state
        const tabUpdateStart = performance.now();
        container.querySelectorAll('.fdb-tab').forEach(tab => {
            const isActive = tab.dataset.tab === tabId;
            tab.style.background = isActive ? '#21262d' : 'transparent';
            tab.style.color = isActive ? '#58a6ff' : '#8b949e';
            tab.style.border = isActive ? '1px solid #30363d' : '1px solid transparent';
        });
        console.log(`[FRONT DESK] ⏱️ CHECKPOINT 1: Tab styles updated in ${(performance.now() - tabUpdateStart).toFixed(1)}ms`);

        // CHECKPOINT 2: Render tab content
        const renderStart = performance.now();
        const content = container.querySelector('#fdb-tab-content');
        
        // Add data-section-id for deep linking from Wiring Tab
        // Maps internal tab IDs to wiring registry section IDs
        const tabToSectionId = {
            'personality': 'personality',
            'discovery': 'discovery-consent',
            'hours': 'hours-availability',
            'vocabulary': 'vocabulary',
            'booking': 'booking-prompts',
            'flows': 'dynamic-flows',
            'emotions': 'emotions',
            'frustration': 'frustration',
            'escalation': 'escalation',
            'loops': 'loops',
            'forbidden': 'forbidden',
            'detection': 'detection',
            'fallbacks': 'fallbacks',
            'modes': 'modes',
            'test': 'test'
        };
        content.setAttribute('data-section-id', tabToSectionId[tabId] || tabId);
        content.setAttribute('data-section', tabToSectionId[tabId] || tabId);
        
        switch (tabId) {
            case 'personality': content.innerHTML = this.renderPersonalityTab(); break;
            case 'discovery': content.innerHTML = this.renderDiscoveryConsentTab(); break;
            case 'hours': content.innerHTML = this.renderHoursTab(); break;
            case 'vocabulary': content.innerHTML = this.renderVocabularyTab(); break;
            case 'booking': content.innerHTML = this.renderBookingPromptsTab(); break;
            case 'flows': 
                content.innerHTML = this.renderDynamicFlowsTab(); 
                // Load trade categories and flows asynchronously after rendering
                this.initDynamicFlowsTab(container);
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
        console.log(`[FRONT DESK] ⏱️ CHECKPOINT 2: Tab '${tabId}' rendered in ${(performance.now() - renderStart).toFixed(1)}ms`);

        // CHECKPOINT 3: Attach event listeners (only to the new content, not entire container)
        const listenersStart = performance.now();
        this.attachTabSpecificListeners(tabId, content);
        console.log(`[FRONT DESK] ⏱️ CHECKPOINT 3: Event listeners attached in ${(performance.now() - listenersStart).toFixed(1)}ms`);
        
        const totalTime = performance.now() - startTime;
        if (totalTime > 100) {
            console.warn(`[FRONT DESK] ⚠️ SLOW TAB SWITCH: ${tabId} took ${totalTime.toFixed(1)}ms (>100ms threshold)`);
        } else {
            console.log(`[FRONT DESK] ✅ CHECKPOINT COMPLETE: switchTab finished in ${totalTime.toFixed(1)}ms`);
        }
    }
    
    // NEW: Attach only tab-specific listeners instead of ALL listeners
    attachTabSpecificListeners(tabId, content) {
        // Only attach listeners for the current tab's content
        switch (tabId) {
            case 'hours':
                content.querySelectorAll('input[id^="bh-"][type="checkbox"]').forEach(cb => {
                    cb.addEventListener('change', () => {
                        const id = cb.id; // bh-mon-closed
                        const day = id.split('-')[1];
                        const openEl = content.querySelector(`#bh-${day}-open`);
                        const closeEl = content.querySelector(`#bh-${day}-close`);
                        if (!openEl || !closeEl) return;
                        const closed = cb.checked === true;
                        openEl.disabled = closed;
                        closeEl.disabled = closed;
                        if (closed) { openEl.value = ''; closeEl.value = ''; }
                    });
                });
                content.querySelector('#bh-save-btn')?.addEventListener('click', async () => {
                    try {
                        await this.saveBusinessHoursFromUI(content);
                    } catch (e) {
                        // saveBusinessHoursFromUI handles UI messaging
                    }
                });
                break;
            case 'booking':
                // Booking slot drag handles, delete buttons, etc.
                content.querySelectorAll('.booking-slot-delete')?.forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const slotId = e.target.closest('[data-slot-id]')?.dataset.slotId;
                        if (slotId) this.removeBookingSlot(slotId);
                    });
                });
                break;
            case 'frustration':
            case 'escalation':
            case 'forbidden':
                // Trigger add/remove buttons
                const type = tabId;
                const addBtn = content.querySelector(`#fdb-add-${type}`);
                const input = content.querySelector(`#fdb-new-${type}`);
                if (addBtn && input) {
                    addBtn.addEventListener('click', () => this.addTrigger(type, input.value, content));
                    input.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') this.addTrigger(type, input.value, content);
                    });
                }
                break;
            case 'test':
                content.querySelector('#fdb-test-btn')?.addEventListener('click', () => this.testPhrase(content));
                break;
            // Other tabs don't need special listeners or use delegated events
        }
    }

    // Collect business hours from the Hours tab DOM and persist via existing admin endpoint.
    async saveBusinessHoursFromUI(content) {
        const statusEl = content.querySelector('#bh-status');
        const setStatus = (text, color = '#8b949e') => {
            if (!statusEl) return;
            statusEl.textContent = text;
            statusEl.style.color = color;
        };

        try {
            const tz = (content.querySelector('#bh-timezone')?.value || '').trim() || 'America/New_York';
            const holidaysRaw = (content.querySelector('#bh-holidays')?.value || '').trim();
            const holidays = holidaysRaw
                ? holidaysRaw.split(',').map(s => s.trim()).filter(Boolean)
                : [];

            const weekly = {};
            const days = ['mon','tue','wed','thu','fri','sat','sun'];
            for (const d of days) {
                const closed = content.querySelector(`#bh-${d}-closed`)?.checked === true;
                if (closed) {
                    weekly[d] = null;
                    continue;
                }
                const open = (content.querySelector(`#bh-${d}-open`)?.value || '').trim();
                const close = (content.querySelector(`#bh-${d}-close`)?.value || '').trim();
                weekly[d] = { open, close };
            }

            const businessHours = { timezone: tz, weekly, holidays };

            setStatus('Saving...', '#8b949e');
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token') || sessionStorage.getItem('token');
            const resp = await fetch(`/api/admin/front-desk-behavior/${this.companyId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ businessHours })
            });

            const text = await resp.text();
            let json = null;
            try { json = JSON.parse(text); } catch (_) {}

            if (!resp.ok) {
                const msg = json?.error || json?.message || text || `HTTP ${resp.status}`;
                setStatus(`Error: ${msg}`, '#f85149');
                throw new Error(msg);
            }

            // Update local config truth so runtime + UI stay consistent without reload.
            this.config.businessHours = businessHours;
            setStatus('Saved ✅', '#3fb950');
            this.showNotification('✅ Business Hours saved!', 'success');
            return true;
        } catch (e) {
            console.error('[FRONT DESK BEHAVIOR] ❌ BusinessHours save failed:', e);
            this.showNotification(`❌ Business Hours save failed: ${e.message}`, 'error');
            throw e;
        }
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
            const warmthRaw = parseInt(get('fdb-warmth'));
            const warmth = Number.isFinite(warmthRaw) ? Math.max(0, Math.min(1, warmthRaw / 100)) : 0.6;
            const agentNameInput = (get('fdb-agent-name') || '').trim();
            const effectiveAgentName = agentNameInput || 'Front Desk';
            if (!agentNameInput) {
                this.showNotification('ℹ️ Agent name was empty. Set to \"Front Desk\" to avoid blank identity.', 'info');
            }
            this.config.personality = {
                agentName: effectiveAgentName,  // AI receptionist name
                tone: get('fdb-tone'),
                verbosity: get('fdb-verbosity'),
                maxResponseWords: parseInt(get('fdb-max-words')) || 30,
                useCallerName: getChecked('fdb-use-name'),
                warmth,
                speakingPace: get('fdb-speaking-pace') || 'normal'
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

        // Prompt guardrails (missing prompt fallback)
        if (document.getElementById('fdb-missingPromptFallback')) {
            // V83 FIX: Use colons instead of dots - Mongoose Maps don't allow dots in keys
            const missingPromptFallbackKey = get('fdb-missingPromptFallbackKey') || 'booking:universal:guardrails:missing_prompt_fallback';
            const bookingPromptsMap = { ...(this.config.bookingPromptsMap || {}) };
            const fallbackTextRaw = get('fdb-missingPromptFallback');
            if (fallbackTextRaw || fallbackTextRaw === '') {
                bookingPromptsMap[missingPromptFallbackKey] = fallbackTextRaw || bookingPromptsMap[missingPromptFallbackKey] || '';
            }
            this.config.bookingPromptsMap = bookingPromptsMap;
            this.config.promptGuards = {
                ...(this.config.promptGuards || {}),
                missingPromptFallbackKey
            };
        }

        // Booking interruption behavior + prompts
        if (document.getElementById('fdb-interrupt-enabled')) {
            const bookingPromptsMap = { ...(this.config.bookingPromptsMap || {}) };
            // V83 FIX: Use colons instead of dots - Mongoose Maps don't allow dots in keys
            const interruptKeys = {
                systemHeader: 'booking:universal:interruption:system_header',
                ackWithName: 'booking:universal:interruption:ack_with_name',
                ackShort: 'booking:universal:interruption:ack_short',
                genericAck: 'booking:universal:interruption:generic_ack',
                prohibitPhrases: 'booking:universal:interruption:prohibit_phrases'
            };

            bookingPromptsMap[interruptKeys.systemHeader] = get('fdb-interrupt-systemHeader') || '';
            bookingPromptsMap[interruptKeys.ackWithName] = get('fdb-interrupt-ackWithName') || '';
            bookingPromptsMap[interruptKeys.ackShort] = get('fdb-interrupt-ackShort') || '';
            bookingPromptsMap[interruptKeys.genericAck] = get('fdb-interrupt-genericAck') || '';
            bookingPromptsMap[interruptKeys.prohibitPhrases] = get('fdb-interrupt-prohibitPhrases') || '';

            const shortClarifications = (get('fdb-interrupt-shortClarifications') || '')
                .split('\n')
                .map(v => v.trim())
                .filter(Boolean);

            // Collect allowed interrupt categories
            const allowedCategories = [];
            document.querySelectorAll('.fdb-interrupt-category:checked').forEach(cb => {
                const cat = cb.getAttribute('data-category');
                if (cat) allowedCategories.push(cat);
            });

            // Parse return-to-slot variants (one per line)
            const parseVariants = (raw, defaults) => {
                const lines = (raw || '').split('\n').map(v => v.trim()).filter(Boolean);
                return lines.length > 0 ? lines : defaults;
            };
            const defaultReturnVariants = [
                "Now, back to scheduling — {slotQuestion}",
                "Alright, {slotQuestion}",
                "So, {slotQuestion}",
                "Anyway, {slotQuestion}",
                "Back to your appointment — {slotQuestion}"
            ];
            const defaultShortVariants = [
                "So, {slotQuestion}",
                "{slotQuestion}",
                "Alright — {slotQuestion}",
                "Now, {slotQuestion}"
            ];

            this.config.bookingInterruption = {
                enabled: getChecked('fdb-interrupt-enabled') === true,
                oneSlotPerTurn: getChecked('fdb-interrupt-oneSlot') !== false,
                forceReturnToQuestionAsLastLine: getChecked('fdb-interrupt-forceReturn') !== false,
                allowEmpathyLanguage: getChecked('fdb-interrupt-allowEmpathy') === true,
                maxSentences: Number(get('fdb-interrupt-maxSentences') || 2),
                shortClarificationPatterns: shortClarifications,
                // 🆕 Mid-booking interruption handling
                allowedCategories: allowedCategories.length > 0 ? allowedCategories : ['FAQ', 'HOURS', 'SERVICE_AREA', 'PRICING', 'SMALL_TALK', 'EMERGENCY'],
                maxInterruptsBeforeTransfer: Number(get('fdb-interrupt-maxBeforeTransfer') || 3),
                transferOfferPrompt: get('fdb-interrupt-transferOffer') || "I want to make sure I'm helping you the best way I can. Would you like me to connect you with someone who can answer all your questions, or should we continue with the scheduling?",
                // Multiple variants to avoid robotic repetition - AI picks randomly
                returnToSlotVariants: parseVariants(get('fdb-interrupt-returnVariants'), defaultReturnVariants),
                returnToSlotShortVariants: parseVariants(get('fdb-interrupt-returnShortVariants'), defaultShortVariants)
            };

            this.config.bookingPromptsMap = bookingPromptsMap;
        }

        // Service flow (existing unit) prompts
        if (document.getElementById('fdb-serviceflow-mode')) {
            const rawTrades = get('fdb-serviceflow-trades') || '';
            const trades = rawTrades
                .split(',')
                .map(t => String(t || '').trim().toLowerCase())
                .filter(Boolean);

            const promptKeysByTrade = {};
            const bookingPromptsMap = { ...(this.config.bookingPromptsMap || {}) };

            // V83 FIX: Use colons instead of dots - Mongoose Maps don't allow dots in keys
            const buildKey = (trade, suffix) => `booking:${trade}:service:${suffix}`;
            const toSafeId = (trade) => trade.replace(/[^a-z0-9]+/gi, '_');

            for (const trade of trades) {
                const safeId = toSafeId(trade);
                const nonUrgentKey = buildKey(trade, 'non_urgent_consent');
                const urgentKey = buildKey(trade, 'urgent_triage_question');
                const postTriageKey = buildKey(trade, 'post_triage_consent');
                const clarifyKey = buildKey(trade, 'consent_clarify');

                promptKeysByTrade[trade] = {
                    nonUrgentConsent: nonUrgentKey,
                    urgentTriageQuestion: urgentKey,
                    postTriageConsent: postTriageKey,
                    consentClarify: clarifyKey
                };

                bookingPromptsMap[nonUrgentKey] = get(`fdb-sf-${safeId}-nonUrgent`) || '';
                bookingPromptsMap[urgentKey] = get(`fdb-sf-${safeId}-urgent`) || '';
                bookingPromptsMap[postTriageKey] = get(`fdb-sf-${safeId}-postTriage`) || '';
                bookingPromptsMap[clarifyKey] = get(`fdb-sf-${safeId}-clarify`) || '';
            }

            this.config.serviceFlow = {
                mode: get('fdb-serviceflow-mode') || 'hybrid',
                empathyEnabled: getChecked('fdb-serviceflow-empathy') === true,
                trades,
                promptKeysByTrade
            };
            this.config.bookingPromptsMap = bookingPromptsMap;
        }

        // Prompt pack selection
        if (document.getElementById('fdb-promptpacks-enabled')) {
            const selectedByTrade = {};
            const packSelects = document.querySelectorAll('[data-pack-trade]');
            packSelects.forEach(select => {
                const trade = (select.getAttribute('data-pack-trade') || '').toLowerCase();
                const value = select.value || '';
                if (trade && value) {
                    selectedByTrade[trade] = value;
                }
            });
            this.config.promptPacks = {
                enabled: getChecked('fdb-promptpacks-enabled') !== false,
                selectedByTrade
            };
        }

        // Booking Contract V2 (beta)
        if (document.getElementById('fdb-bcv2-enabled')) {
            this.config.bookingContractV2Enabled = getChecked('fdb-bcv2-enabled') === true;

            const parseJsonStrict = (raw, label) => {
                if (!raw || !raw.trim()) return [];
                try {
                    const parsed = JSON.parse(raw);
                    if (!Array.isArray(parsed)) {
                        throw new Error(`${label} must be a JSON array`);
                    }
                    return parsed;
                } catch (e) {
                    const msg = `${label} JSON is invalid: ${e.message}`;
                    console.error('[FRONT DESK BEHAVIOR] ❌', msg);
                    this.showNotification(`❌ ${msg}`, 'error');
                    throw new Error(msg);
                }
            };

            const rawLibrary = get('fdb-bcv2-slotLibrary-json');
            const rawGroups = get('fdb-bcv2-slotGroups-json');
            this.config.slotLibrary = parseJsonStrict(rawLibrary, 'Slot Library');
            this.config.slotGroups = parseJsonStrict(rawGroups, 'Slot Groups');
        }

        // Vendor / Supplier Handling
        if (document.getElementById('fdb-vendor-first-enabled')) {
            this.config.vendorHandling = this.collectVendorHandlingConfig();
        }

        // Unit of Work (UoW)
        if (document.getElementById('fdb-uow-enabled')) {
            this.config.unitOfWork = this.collectUnitOfWorkConfig();
        }

        // After-hours message contract (deterministic)
        if (document.getElementById('fdb-ah-contract-mode')) {
            this.config.afterHoursMessageContract = this.collectAfterHoursMessageContractConfig();
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
                rephraseIntro: get('fdb-rephrase-intro'),
                nudgeNamePrompt: get('fdb-nudge-name'),
                nudgePhonePrompt: get('fdb-nudge-phone'),
                nudgeAddressPrompt: get('fdb-nudge-address')
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
            // Silence / no-response fallback
            if (document.getElementById('fdb-fb-noresponse')) {
                this.config.fallbackResponses.noResponse = get('fdb-fb-noresponse') || 'Hello — are you still there?';
            }
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

            // Consent split allowlist (scenario types allowed to reply before consent)
            const autoReplyAllowedScenarioTypes = [];
            if (getChecked('fdb-dc-autoReply-FAQ')) autoReplyAllowedScenarioTypes.push('FAQ');
            if (getChecked('fdb-dc-autoReply-TROUBLESHOOT')) autoReplyAllowedScenarioTypes.push('TROUBLESHOOT');
            if (getChecked('fdb-dc-autoReply-EMERGENCY')) autoReplyAllowedScenarioTypes.push('EMERGENCY');
            
            // Parse yes words from comma-separated input
            const yesWordsRaw = get('fdb-dc-yesWords') || '';
            const yesWords = yesWordsRaw.split(',').map(w => w.trim().toLowerCase()).filter(w => w);
            
            this.config.discoveryConsent = {
                // Kill switches
                bookingRequiresExplicitConsent: getChecked('fdb-dc-bookingRequiresConsent'),
                forceLLMDiscovery: getChecked('fdb-dc-forceLLMDiscovery'),
                disableScenarioAutoResponses: getChecked('fdb-dc-disableScenarioAuto'),
                // Consent split allowlist (trade-agnostic)
                autoReplyAllowedScenarioTypes,
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
            if (this.config.discoveryConsent.bookingRequiresExplicitConsent && wantsBookingPhrases.length === 0) {
                wantsBookingPhrases.push(
                    'schedule a visit',
                    'book an appointment',
                    'send a technician',
                    'come out to my house',
                    'set up service',
                    'schedule me',
                    'can you schedule this',
                    'schedule service today'
                );
                this.showNotification('⚠️ Consent is required but no phrases were provided. Added recommended consent phrases before saving.', 'warning');
            }
            
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

        // ════════════════════════════════════════════════════════════════════════════
        // V77: Resume Booking Protocol (Off-Rails Recovery → Bridge Back)
        // ════════════════════════════════════════════════════════════════════════════
        if (document.getElementById('fdb-resume-booking-enabled')) {
            if (!this.config.offRailsRecovery) this.config.offRailsRecovery = {};
            if (!this.config.offRailsRecovery.bridgeBack) this.config.offRailsRecovery.bridgeBack = {};
            if (!this.config.offRailsRecovery.bridgeBack.resumeBooking) {
                this.config.offRailsRecovery.bridgeBack.resumeBooking = this.getDefaultConfig().offRailsRecovery.bridgeBack.resumeBooking;
            }

            this.config.offRailsRecovery.bridgeBack.resumeBooking = {
                enabled: document.getElementById('fdb-resume-booking-enabled')?.checked === true,
                includeValues: document.getElementById('fdb-resume-booking-includeValues')?.checked === true,
                template: (document.getElementById('fdb-resume-booking-template')?.value || '').trim(),
                collectedItemTemplate: (document.getElementById('fdb-resume-booking-itemTemplate')?.value || '').trim(),
                collectedItemTemplateWithValue: (document.getElementById('fdb-resume-booking-itemTemplateWithValue')?.value || '').trim(),
                separator: (document.getElementById('fdb-resume-booking-separator')?.value || '').toString(),
                finalSeparator: (document.getElementById('fdb-resume-booking-finalSeparator')?.value || '').toString()
            };
        }

        // ════════════════════════════════════════════════════════════════════════════
        // V92: Booking Clarification (Meta Questions During Booking)
        // ════════════════════════════════════════════════════════════════════════════
        if (document.getElementById('fdb-booking-clarification-enabled')) {
            if (!this.config.offRailsRecovery) this.config.offRailsRecovery = {};
            if (!this.config.offRailsRecovery.bridgeBack) this.config.offRailsRecovery.bridgeBack = {};
            if (!this.config.offRailsRecovery.bridgeBack.clarification) {
                this.config.offRailsRecovery.bridgeBack.clarification = this.getDefaultConfig().offRailsRecovery.bridgeBack.clarification;
            }

            const triggersRaw = (document.getElementById('fdb-booking-clarification-triggers')?.value || '').toString();
            const triggers = triggersRaw
                .split('\n')
                .map(s => s.trim().toLowerCase())
                .filter(Boolean);

            this.config.offRailsRecovery.bridgeBack.clarification = {
                enabled: document.getElementById('fdb-booking-clarification-enabled')?.checked === true,
                triggers,
                template: (document.getElementById('fdb-booking-clarification-template')?.value || '').trim()
            };
        }

        // ════════════════════════════════════════════════════════════════════════════
        // V78: Confirmation Requests
        // ════════════════════════════════════════════════════════════════════════════
        if (document.getElementById('fdb-confirm-req-enabled')) {
            const enabled = document.getElementById('fdb-confirm-req-enabled')?.checked === true;
            const triggersRaw = document.getElementById('fdb-confirm-req-triggers')?.value || '';
            const triggers = triggersRaw
                .split('\n')
                .map(s => s.trim())
                .filter(Boolean);
            this.config.confirmationRequests = { enabled, triggers };
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
        
        // ═══════════════════════════════════════════════════════════════════════════
        // ACTION FIELD VALIDATION - Prevent saving incomplete/empty action configs
        // ═══════════════════════════════════════════════════════════════════════════
        if (!forCopy) {
            const validationErrors = [];
            
            if (actionType === 'set_flag') {
                if (!actionConfig.flagName) {
                    validationErrors.push('SET_FLAG requires a flag name (path)');
                }
            } else if (actionType === 'ack_once') {
                if (!actionConfig.text) {
                    validationErrors.push('ACK_ONCE requires acknowledgment text');
                }
            } else if (actionType === 'append_ledger') {
                if (!actionConfig.type) validationErrors.push('APPEND_LEDGER requires a type (e.g., EVENT, CLAIM)');
                if (!actionConfig.key) validationErrors.push('APPEND_LEDGER requires a key (e.g., BOOKING_INTENT)');
                if (!actionConfig.note) validationErrors.push('APPEND_LEDGER requires a note (human-readable description)');
            }
            
            if (validationErrors.length > 0) {
                this.showNotification(`Validation failed:\n${validationErrors.join('\n')}`, 'error');
                console.error('[FLOW EDITOR] Action validation failed:', validationErrors);
                return null;
            }
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

    // ═══════════════════════════════════════════════════════════════════
    // V57: DEEP VERIFICATION
    // ═══════════════════════════════════════════════════════════════════
    
    async runDeepVerification() {
        console.log('[FRONT DESK] 🔬 Running deep verification...');
        
        const scoreEl = document.getElementById('fdb-verify-score');
        const statusEl = document.getElementById('fdb-verify-status');
        const tradeEl = document.getElementById('fdb-verify-trade');
        const progressEl = document.getElementById('fdb-verify-progress');
        const subtabsEl = document.getElementById('fdb-verify-subtabs');
        const issuesEl = document.getElementById('fdb-verify-issues');
        const verifyBtn = document.getElementById('fdb-verify-btn');
        
        if (!scoreEl) return;
        
        // Show loading state
        scoreEl.textContent = '...';
        scoreEl.style.color = '#9ca3af';
        statusEl.textContent = 'Verifying configuration...';
        if (verifyBtn) {
            verifyBtn.disabled = true;
            verifyBtn.innerHTML = '⏳ Checking...';
        }
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/front-desk/${this.companyId}/verify`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) throw new Error('Verification failed');
            
            const report = await response.json();
            console.log('[FRONT DESK] 🔬 Verification report:', report);
            
            // Update score
            const score = report.overallScore || 0;
            const scoreColor = score === 100 ? '#22c55e' : score >= 70 ? '#f59e0b' : '#ef4444';
            
            scoreEl.textContent = `${score}%`;
            scoreEl.style.color = scoreColor;
            
            // Update status
            const statusText = score === 100 ? '🟢 GREEN — Production Ready' :
                               score >= 70 ? '🟡 YELLOW — Mostly Ready' : '🔴 RED — Needs Configuration';
            statusEl.textContent = statusText;
            statusEl.style.color = scoreColor;
            
            // Update trade key
            tradeEl.textContent = `Trade: ${report.tradeKey || 'universal'}`;
            
            // Update progress bar
            progressEl.style.width = `${score}%`;
            progressEl.style.background = scoreColor;
            
            // Render sub-tab badges
            const subTabs = report.subTabs || {};
            subtabsEl.innerHTML = Object.entries(subTabs).map(([key, tab]) => {
                const tabColor = tab.score === 100 ? '#22c55e' : tab.score >= 70 ? '#f59e0b' : '#ef4444';
                const tabBg = tab.score === 100 ? 'rgba(34, 197, 94, 0.15)' : 
                              tab.score >= 70 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)';
                return `
                    <div class="fdb-verify-badge" style="
                        padding: 6px 10px;
                        background: ${tabBg};
                        border: 1px solid ${tabColor}33;
                        border-radius: 6px;
                        font-size: 11px;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        cursor: pointer;
                    " data-subtab="${key}" title="Click to view ${tab.name} tab">
                        <span>${tab.icon || '📋'}</span>
                        <span style="color: #e0e0e0;">${tab.name}</span>
                        <span style="color: ${tabColor}; font-weight: 700;">${tab.score}%</span>
                        ${tab.issues?.length > 0 ? `<span style="color: ${tabColor};">⚠️</span>` : ''}
                    </div>
                `;
            }).join('');
            
            // Click handler for sub-tab badges
            subtabsEl.querySelectorAll('.fdb-verify-badge').forEach(badge => {
                badge.addEventListener('click', () => {
                    const tabKey = badge.dataset.subtab;
                    // Map verification keys to tab IDs
                    const tabMap = {
                        'personality': 'personality',
                        'discoveryConsent': 'discovery', // V57: Discovery & Consent tab
                        'bookingSlots': 'booking',
                        'responses': 'fallbacks',
                        'greeting': 'personality', // Greeting is in personality
                        'dynamicFlows': 'flows',
                        'vocabulary': 'vocabulary',
                        'loopPrevention': 'loops'
                    };
                    const targetTab = tabMap[tabKey] || tabKey;
                    const tabBtn = document.querySelector(`.fdb-tab[data-tab="${targetTab}"]`);
                    if (tabBtn) tabBtn.click();
                });
            });
            
            // Show issues if any
            const allIssues = report.issues || [];
            const allWarnings = report.warnings || [];
            
            if (allIssues.length > 0 || allWarnings.length > 0) {
                issuesEl.style.display = 'block';
                const detailsId = `fdb-verify-issues-details-${Date.now()}`;
                const safeJson = JSON.stringify({ issues: allIssues, warnings: allWarnings }, null, 2)
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                
                const renderItem = (item, color, borderColor) => `
                    <div style="font-size: 11px; color: ${color}; margin-bottom: 6px; padding-left: 8px; border-left: 2px solid ${borderColor};">
                        <strong>${item.tab || 'General'}</strong>: ${item.description || item.message || '(no description)'}
                        ${item.fix ? `<div style="color: #9ca3af; margin-top: 2px;">Fix: ${item.fix}</div>` : ''}
                    </div>
                `;
                
                issuesEl.innerHTML = `
                    <div style="padding: 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 8px;">
                        <div style="display:flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px;">
                            <div style="font-size: 12px; font-weight: 700; color: #e6edf3;">
                                ${allIssues.length > 0 ? `<span style="color:#f87171;">❌ ${allIssues.length} Error${allIssues.length > 1 ? 's' : ''}</span>` : ''}
                                ${allWarnings.length > 0 ? `<span style="color:#fbbf24; margin-left: 10px;">⚠️ ${allWarnings.length} Warning${allWarnings.length > 1 ? 's' : ''}</span>` : ''}
                            </div>
                            <div style="display:flex; gap: 8px;">
                                <button id="fdb-verify-toggle-details" style="padding: 6px 10px; background:#21262d; border:1px solid #30363d; border-radius:6px; color:#c9d1d9; font-size:11px; cursor:pointer;">
                                    Show details
                                </button>
                                <button id="fdb-verify-copy-issues" style="padding: 6px 10px; background:#0d2818; border:1px solid #238636; border-radius:6px; color:#3fb950; font-size:11px; cursor:pointer;">
                                    Copy
                                </button>
                            </div>
                        </div>
                        
                        <div style="max-height: 120px; overflow-y: auto;">
                            ${allIssues.slice(0, 3).map(i => renderItem(i, '#fca5a5', '#ef4444')).join('')}
                            ${allWarnings.slice(0, 4).map(w => renderItem(w, '#fde68a', '#f59e0b')).join('')}
                            ${(allIssues.length > 3 || allWarnings.length > 4)
                                ? `<div style="font-size: 10px; color: #9ca3af;">Preview shows top items — click “Show details” for full list.</div>`
                                : ''}
                        </div>
                        
                        <div id="${detailsId}" style="display:none; margin-top: 10px;">
                            <div style="padding: 10px; background:#0d1117; border:1px solid #30363d; border-radius:8px; max-height: 220px; overflow:auto;">
                                <pre style="margin:0; color:#c9d1d9; font-size:11px; white-space:pre-wrap;">${safeJson}</pre>
                            </div>
                        </div>
                    </div>
                `;
                
                // Wire up buttons
                const toggleBtn = document.getElementById('fdb-verify-toggle-details');
                const copyBtn = document.getElementById('fdb-verify-copy-issues');
                const detailsEl = document.getElementById(detailsId);
                if (toggleBtn && detailsEl) {
                    toggleBtn.onclick = () => {
                        const isHidden = detailsEl.style.display === 'none';
                        detailsEl.style.display = isHidden ? 'block' : 'none';
                        toggleBtn.textContent = isHidden ? 'Hide details' : 'Show details';
                    };
                }
                if (copyBtn) {
                    copyBtn.onclick = async () => {
                        try {
                            await navigator.clipboard.writeText(JSON.stringify({ issues: allIssues, warnings: allWarnings }, null, 2));
                            this.showNotification('Copied verification issues/warnings', 'success');
                        } catch (e) {
                            this.showNotification('Copy failed (browser permission)', 'warning');
                        }
                    };
                }
            } else {
                issuesEl.style.display = 'none';
            }
            
        } catch (error) {
            console.error('[FRONT DESK] 🔬 Verification error:', error);
            scoreEl.textContent = '?';
            statusEl.textContent = 'Verification failed';
            statusEl.style.color = '#f85149';
        } finally {
            if (verifyBtn) {
                verifyBtn.disabled = false;
                verifyBtn.innerHTML = '🔬 Verify Now';
            }
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
