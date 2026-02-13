/**
 * ============================================================================
 * BOOKING FLOW RESOLVER
 * ============================================================================
 * 
 * Resolves the appropriate booking flow for a given context.
 * 
 * This is the bridge between UI configuration (Wiring Tab) and runtime.
 * 
 * RESOLUTION PRIORITY:
 * 1. companyId + trade + serviceType (most specific)
 * 2. companyId + trade
 * 3. companyId default
 * 
 * FLOW STRUCTURE:
 * A flow is an ordered list of steps, where each step defines:
 * - id: Unique step identifier
 * - fieldKey: The slot key to collect (name, phone, address, time, etc.)
 * - prompt: The exact question to ask
 * - reprompt: The clarification prompt if validation fails
 * - validation: Validation rules (optional)
 * - required: Whether this step is required
 * - order: Step order
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');

/**
 * Default step prompts when company hasn't configured custom ones.
 * These are fallbacks - UI configuration should always be used when available.
 */
const DEFAULT_STEP_PROMPTS = {
    name: {
        prompt: "May I have your name, please?",
        reprompt: "I didn't quite catch that. Could you tell me your name?"
    },
    phone: {
        prompt: "And what's the best phone number to reach you?",
        reprompt: "I'm sorry, I didn't get that number. Can you repeat your phone number?"
    },
    address: {
        prompt: "What is the service address?",
        reprompt: "I want to make sure I have the right address. Can you say it one more time?"
    },
    // ═══════════════════════════════════════════════════════════════════════
    // V92: ADDRESS-RELATED FOLLOW-UP STEPS
    // These are triggered conditionally by Google Geo validation
    // ═══════════════════════════════════════════════════════════════════════
    propertyType: {
        prompt: "Is this a house, apartment, condo, or business location?",
        reprompt: "Just to clarify, is this a residential home, an apartment, or a commercial location?"
    },
    unit: {
        prompt: "What's the apartment or unit number?",
        reprompt: "I didn't catch the unit number. Could you repeat that?"
    },
    gateAccess: {
        prompt: "Is there a gate or secured entry to get to your location?",
        reprompt: "Does the technician need a gate code or any special access instructions?"
    },
    gateCode: {
        prompt: "What's the gate code?",
        reprompt: "I didn't catch that. What's the gate code the technician should use?"
    },
    accessInstructions: {
        prompt: "Any special instructions for the technician to get to your unit?",
        reprompt: "Are there any access instructions or notes for the technician?"
    },
    // ═══════════════════════════════════════════════════════════════════════
    time: {
        prompt: "When would work best for you?",
        reprompt: "What time works best for your schedule?"
    },
    email: {
        prompt: "What's your email address?",
        reprompt: "Can you spell out your email address for me?"
    },
    serviceType: {
        prompt: "What type of service do you need?",
        reprompt: "What service are you looking for today?"
    }
};

/**
 * Validation patterns for common field types
 */
const VALIDATION_PATTERNS = {
    phone: {
        pattern: /^[\d\-\(\)\s\.]{10,}$/,
        minDigits: 10,
        extract: (text) => text.replace(/\D/g, '')
    },
    email: {
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        extract: (text) => text.toLowerCase().trim()
    },
    name: {
        pattern: /^[A-Za-z][A-Za-z\s\-'\.]{1,}$/,
        minLength: 2,
        extract: (text) => text.trim()
    }
};

class BookingFlowResolver {
    
    /**
     * ========================================================================
     * RESOLVE - Get the appropriate booking flow for a context
     * ========================================================================
     * 
     * @param {Object} params - Resolution parameters
     * @param {string} params.companyId - Company ID (required)
     * @param {string} params.trade - Trade category (e.g., 'hvac', 'plumbing')
     * @param {string} params.serviceType - Specific service type
     * @param {Object} params.company - Company document with aiAgentSettings
     * 
     * @returns {Object} Resolved flow:
     * {
     *     flowId: 'hvac_repair_v1',
     *     flowName: 'HVAC Repair Booking',
     *     steps: [
     *         { id: 'name', fieldKey: 'name', prompt: '...', reprompt: '...', required: true, order: 1 },
     *         { id: 'phone', fieldKey: 'phone', prompt: '...', reprompt: '...', required: true, order: 2 },
     *         ...
     *     ],
     *     confirmationTemplate: 'Let me confirm: {name} at {phone}...',
     *     completionTemplate: 'Your appointment has been scheduled...',
     *     source: 'company_config' | 'default'
     * }
     */
    static resolve({ companyId, trade, serviceType, company, awReader }) {
        if (!company) {
            logger.warn('[BOOKING FLOW RESOLVER] No company provided, using defaults', { companyId });
            return this.buildDefaultFlow(companyId);
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V110 ONLY: READ FROM SLOT REGISTRY + BOOKING FLOW (SOLE SOURCE OF TRUTH)
        // ═══════════════════════════════════════════════════════════════════════
        // All legacy paths (bookingSlots, bookingFields, bookingPrompts) have been
        // permanently removed. V110 slotRegistry + bookingFlow is the only path.
        // ═══════════════════════════════════════════════════════════════════════
        
        let slotRegistry, bookingFlow, bookingSlots, bookingTemplates, bookingBehavior, bookingOutcome;
        let aiSettings, frontDeskBehavior;
        let configSource = 'unknown';

        // Initialize defaults to prevent undefined reference errors
        aiSettings = company.aiAgentSettings || {};
        frontDeskBehavior = aiSettings.frontDeskBehavior || {};
        
        if (awReader && typeof awReader.get === 'function') {
            // V110: Traced reads through AWConfigReader
            awReader.setReaderId('BookingFlowResolver.resolve.v110');
            
            // V110 CANONICAL: Read slot registry and booking flow
            slotRegistry = awReader.getObject('frontDesk.slotRegistry') || {};
            bookingFlow = awReader.getObject('frontDesk.bookingFlow') || {};
            
            const v110Slots = slotRegistry.slots || [];
            const v110Steps = bookingFlow.steps || [];
            
            if (v110Slots.length > 0 && v110Steps.length > 0) {
                configSource = 'V110_SLOT_REGISTRY';
                bookingSlots = this._mergeV110SlotsWithSteps(v110Slots, v110Steps);
                
                logger.info('[BOOKING FLOW RESOLVER] V110: Using slotRegistry + bookingFlow', {
                    companyId: company._id?.toString(),
                    slotCount: v110Slots.length,
                    stepCount: v110Steps.length,
                    mergedSlotIds: bookingSlots.map(s => s.id || s.slotId)
                });
            } else {
                // V110 not configured — NO legacy fallback. Fail closed.
                configSource = 'NONE';
                bookingSlots = [];
                
                logger.error('[BOOKING FLOW RESOLVER] V110 slotRegistry/bookingFlow NOT configured — no slots available', {
                    companyId: company._id?.toString(),
                    hasSlots: v110Slots.length > 0,
                    hasSteps: v110Steps.length > 0
                });
            }
            
            bookingTemplates = awReader.getObject('frontDesk.bookingTemplates') || {};
            bookingBehavior = awReader.getObject('frontDesk.bookingBehavior') || {};
            bookingOutcome = awReader.getObject('frontDesk.bookingOutcome') || {};
            
        } else {
            // Fallback: Direct access (no AWConfigReader)
            logger.warn('[BOOKING FLOW RESOLVER] No AWConfigReader - using direct access (untraced)', {
                companyId: company._id?.toString()
            });
            
            // V110 only via direct access
            slotRegistry = frontDeskBehavior.slotRegistry || {};
            bookingFlow = frontDeskBehavior.bookingFlow || {};
            
            const v110Slots = slotRegistry.slots || [];
            const v110Steps = bookingFlow.steps || [];
            
            if (v110Slots.length > 0 && v110Steps.length > 0) {
                configSource = 'V110_SLOT_REGISTRY_DIRECT';
                bookingSlots = this._mergeV110SlotsWithSteps(v110Slots, v110Steps);
            } else {
                configSource = 'NONE';
                bookingSlots = [];
            }
            
            bookingTemplates = frontDeskBehavior.bookingTemplates || {};
            bookingBehavior = frontDeskBehavior.bookingBehavior || {};
            bookingOutcome = frontDeskBehavior.bookingOutcome || {};
        }
        
        const bookingPromptsMap = company.aiAgentSettings?.bookingPromptsMap || new Map();
        const checkedPaths = [
            'frontDesk.slotRegistry.slots (V110 CANONICAL)',
            'frontDesk.bookingFlow.steps (V110 CANONICAL)'
        ];
        
        logger.debug('[BOOKING FLOW RESOLVER] Resolving flow', {
            companyId: company._id?.toString(),
            configSource,
            slotCount: bookingSlots?.length || 0,
            slotIds: (bookingSlots || []).map(s => s.id || s.slotId).slice(0, 10),
            usedAwReader: !!(awReader && typeof awReader.get === 'function')
        });
        
        // If no booking slots configured, use defaults
        if (!bookingSlots || bookingSlots.length === 0) {
            logger.warn('[BOOKING FLOW RESOLVER] No booking slots configured, using defaults', { 
                companyId: company._id,
                companyName: company.name,
                configSource,
                checkedPaths
            });
            const defaultFlow = this.buildDefaultFlow(companyId, bookingTemplates);
            defaultFlow.resolution = {
                source: 'default',
                status: 'DEFAULT_FALLBACK',
                configSource,
                checkedPaths,
                slotCount: 0
            };
            return defaultFlow;
        }
        
        // Build flow from UI-configured booking slots
        const steps = this.buildStepsFromSlots(bookingSlots, bookingPromptsMap, company);
        
        // Generate flow ID
        const flowId = this.generateFlowId(company, trade, serviceType);
        
        // ═══════════════════════════════════════════════════════════════════════
        // Template resolution: bookingBehavior > bookingOutcome > bookingTemplates > hardcoded
        // ═══════════════════════════════════════════════════════════════════════
        
        const confirmationTemplate = 
            bookingBehavior.confirmationPrompt ||
            bookingOutcome.confirmationPrompt ||
            bookingOutcome.scripts?.final_confirmation ||
            bookingTemplates.confirmTemplate;
        
        const completionTemplate = 
            bookingBehavior.completionPrompt ||
            bookingOutcome.completionPrompt ||
            bookingOutcome.scripts?.booking_complete ||
            bookingTemplates.completeTemplate;
        
        logger.debug('[BOOKING FLOW RESOLVER] Template sources', {
            companyId: company._id?.toString(),
            confirmationSource: confirmationTemplate 
                ? (bookingBehavior.confirmationPrompt ? 'bookingBehavior' :
                   bookingOutcome.confirmationPrompt ? 'bookingOutcome' :
                   bookingOutcome.scripts?.final_confirmation ? 'bookingOutcome.scripts' :
                   bookingTemplates.confirmTemplate ? 'bookingTemplates' : 'unknown')
                : 'hardcoded',
            confirmationTemplatePreview: confirmationTemplate?.substring(0, 60) || 'NONE'
        });
        
        const flow = {
            flowId,
            flowName: `${company.name || 'Company'} Booking Flow`,
            steps,
            // V96j: Use resolved templates, with explicit source tracking
            confirmationTemplate: confirmationTemplate || 
                "Let me confirm: I have {name} at {phone}, service address {address}. Is that correct?",
            confirmationTemplateSource: confirmationTemplate 
                ? (bookingBehavior.confirmationPrompt ? 'bookingBehavior' : 
                   bookingOutcome.confirmationPrompt || bookingOutcome.scripts?.final_confirmation ? 'bookingOutcome' :
                   bookingTemplates.confirmTemplate ? 'bookingTemplates' : 'config_unknown')
                : 'hardcoded_default',
            completionTemplate: completionTemplate ||
                "Your appointment has been scheduled. Is there anything else I can help you with?",
            completionTemplateSource: completionTemplate ? 'config' : 'hardcoded_default',
            // V96j: Booking behavior options from Booking Prompt tab
            enforcePromptOrder: bookingBehavior.enforcePromptOrder === true,
            confirmIfPreFilled: bookingBehavior.confirmIfPreFilled !== false, // Default true for backward compat
            alwaysAskEvenIfFilled: Array.isArray(bookingBehavior.alwaysAskEvenIfFilled) 
                ? bookingBehavior.alwaysAskEvenIfFilled 
                : [],
            source: 'company_config',
            trade: trade || null,
            serviceType: serviceType || null,
            companyId: company._id?.toString() || companyId,
            resolution: {
                source: 'company_config',
                status: 'OK',
                configSource,
                checkedPaths,
                slotCount: bookingSlots.length
            }
        };
        
        logger.info('[BOOKING FLOW RESOLVER] Flow resolved', {
            flowId: flow.flowId,
            stepCount: flow.steps.length,
            requiredSteps: flow.steps.filter(s => s.required).map(s => s.fieldKey),
            source: flow.source
        });
        
        return flow;
    }
    
    /**
     * ========================================================================
     * BUILD STEPS FROM SLOTS - Convert UI-configured slots to flow steps
     * ========================================================================
     */
    static buildStepsFromSlots(bookingSlots, bookingPromptsMap, company) {
        const steps = [];
        
        // Sort by order, then by required (required first)
        const sortedSlots = [...bookingSlots].sort((a, b) => {
            // First by explicit order
            const orderA = typeof a.order === 'number' ? a.order : 999;
            const orderB = typeof b.order === 'number' ? b.order : 999;
            if (orderA !== orderB) return orderA - orderB;
            
            // Then by required (required first)
            if (a.required && !b.required) return -1;
            if (!a.required && b.required) return 1;
            
            return 0;
        });
        
        for (const slot of sortedSlots) {
            const slotId = slot.slotId || slot.id || slot.type;
            const slotType = slot.type || slotId;
            
            // Get prompt from various sources (priority order) WITH SOURCE TRACKING
            // V94: Track exactly where each prompt came from for BOOKING_PROMPT_RESOLVED event
            const promptResult = this.getSlotPromptWithSource(slot, slotId, slotType, bookingPromptsMap, company);
            const reprompt = this.getSlotReprompt(slot, slotId, slotType, bookingPromptsMap, company);
            
            steps.push({
                id: slotId,
                fieldKey: slotId,
                type: slotType,
                label: slot.label || slotType,
                prompt: promptResult.prompt,
                reprompt,
                required: slot.required !== false, // Default to required
                order: slot.order || steps.length + 1,
                validation: this.buildValidation(slot, slotType),
                // Slot-specific options (for specialized handlers)
                options: this.extractSlotOptions(slot),
                // V94: Source tracking for BOOKING_PROMPT_RESOLVED event
                promptSource: promptResult.source,
                promptPath: promptResult.path
            });
        }
        
        return steps;
    }
    
    /**
     * Get the primary prompt for a slot WITH SOURCE TRACKING
     * V110: All prompts come from bookingFlow.steps (merged into slot.question) or bookingPromptsMap
     */
    static getSlotPromptWithSource(slot, slotId, slotType, bookingPromptsMap, company) {
        // 1. V110: slot.question (from bookingFlow.steps merged into slot via _mergeV110SlotsWithSteps)
        if (slot.question && slot.question !== '/* USE UI CONFIG */') {
            return { 
                prompt: slot.question, 
                source: 'V110:bookingFlow.steps',
                path: `frontDeskBehavior.bookingFlow.steps[${slotId}].ask`
            };
        }
        
        // 2. Booking prompts map (key format: "booking:{slotId}:question")
        if (bookingPromptsMap instanceof Map) {
            const mapPrompt = bookingPromptsMap.get(`booking:${slotId}:question`);
            if (mapPrompt) {
                return { 
                    prompt: mapPrompt, 
                    source: 'bookingPromptsMap',
                    path: `aiAgentSettings.bookingPromptsMap['booking:${slotId}:question']`
                };
            }
        } else if (typeof bookingPromptsMap === 'object') {
            const mapPrompt = bookingPromptsMap[`booking:${slotId}:question`];
            if (mapPrompt) {
                return { 
                    prompt: mapPrompt, 
                    source: 'bookingPromptsMap',
                    path: `aiAgentSettings.bookingPromptsMap['booking:${slotId}:question']`
                };
            }
        }
        
        // 3. Default fallback (hardcoded defaults - no UI config)
        return { 
            prompt: DEFAULT_STEP_PROMPTS[slotType]?.prompt || `What is your ${slotType}?`,
            source: 'defaults',
            path: 'DEFAULT_STEP_PROMPTS'
        };
    }
    
    /**
     * Get the primary prompt for a slot (backward compatible)
     */
    static getSlotPrompt(slot, slotId, slotType, bookingPromptsMap, company) {
        return this.getSlotPromptWithSource(slot, slotId, slotType, bookingPromptsMap, company).prompt;
    }
    
    /**
     * Get the reprompt (clarification) for a slot
     * 
     * V97e FIX: DO NOT use confirmPrompt as reprompt fallback!
     * - reprompt: "I didn't catch that. What is your address?" (asking again)
     * - confirmPrompt: "Just to confirm, that's {value}, correct?" (confirming)
     * These serve different purposes. confirmPrompt has {value} placeholder
     * that won't be replaced in reprompt context → garbled output.
     */
    static getSlotReprompt(slot, slotId, slotType, bookingPromptsMap, company) {
        // 1. Direct slot reprompt
        if (slot.reprompt) {
            return slot.reprompt;
        }
        
        // 2. Booking prompts map
        if (bookingPromptsMap instanceof Map) {
            const mapReprompt = bookingPromptsMap.get(`booking:${slotId}:reprompt`);
            if (mapReprompt) return mapReprompt;
        } else if (typeof bookingPromptsMap === 'object') {
            const mapReprompt = bookingPromptsMap[`booking:${slotId}:reprompt`];
            if (mapReprompt) return mapReprompt;
        }
        
        // 3. Use slot's question/prompt if available (better than generic)
        // V97e: This is safer than confirmPrompt because questions don't have {value}
        if (slot.question) {
            return `I didn't quite catch that. ${slot.question}`;
        }
        
        // 4. Default fallback
        return DEFAULT_STEP_PROMPTS[slotType]?.reprompt || 
            `I didn't quite catch that. What is your ${slotType}?`;
    }
    
    /**
     * Build validation rules for a slot
     */
    static buildValidation(slot, slotType) {
        const validation = {
            required: slot.required !== false,
            type: slotType
        };
        
        // Custom validation regex from UI
        if (slot.validation) {
            validation.pattern = slot.validation;
        }
        
        // Type-specific validation
        const typeValidation = VALIDATION_PATTERNS[slotType];
        if (typeValidation) {
            if (!validation.pattern && typeValidation.pattern) {
                validation.pattern = typeValidation.pattern;
            }
            if (typeValidation.minDigits) {
                validation.minDigits = typeValidation.minDigits;
            }
            if (typeValidation.minLength) {
                validation.minLength = typeValidation.minLength;
            }
        }
        
        return validation;
    }
    
    /**
     * Extract slot-specific options for specialized handlers
     * ═══════════════════════════════════════════════════════════════════════
     * V92 FIX: Include ALL booking prompt tab settings
     * These must be passed through to BookingFlowRunner so it can use them
     * ═══════════════════════════════════════════════════════════════════════
     */
    static extractSlotOptions(slot) {
        const options = {};
        
        // ═══════════════════════════════════════════════════════════════════
        // NAME OPTIONS - Full name handling, spelling confirmation, etc.
        // ═══════════════════════════════════════════════════════════════════
        const isNameSlot = slot.type === 'name' || slot.type === 'name_first' || slot.type === 'name_last' 
            || slot.id === 'name' || slot.id === 'lastName' || slot.id === 'firstName';
        if (isNameSlot) {
            options.askFullName = slot.askFullName;
            options.askMissingNamePart = slot.askMissingNamePart;
            options.useFirstNameOnly = slot.useFirstNameOnly;
            options.lastNameQuestion = slot.lastNameQuestion;
            options.firstNameQuestion = slot.firstNameQuestion;
            options.duplicateNamePartPrompt = slot.duplicateNamePartPrompt;
            // V92: Spelling confirmation
            options.confirmSpelling = slot.confirmSpelling;
            options.helperNote = slot.helperNote;
            // V118: Name extraction policy — defines HOW names are parsed
            // This is the extraction contract: singleTokenOnly, candidateStrategy, etc.
            if (slot.nameExtractionPolicy) {
                options.nameExtractionPolicy = slot.nameExtractionPolicy;
            }
        }
        
        // Phone options
        if (slot.type === 'phone') {
            options.offerCallerId = slot.offerCallerId;
            options.callerIdPrompt = slot.callerIdPrompt;
            
            // V96n FIX: Extract ALL phone options from Control Plane
            options.acceptTextMe = slot.acceptTextMe;
            options.breakDownIfUnclear = slot.breakDownIfUnclear;
            options.areaCodePrompt = slot.areaCodePrompt;
            options.restOfNumberPrompt = slot.restOfNumberPrompt;
        }
        
        // Address options
        if (slot.type === 'address') {
            options.addressConfirmLevel = slot.addressConfirmLevel;
            options.useGoogleMapsValidation = slot.useGoogleMapsValidation;
            options.unitNumberMode = slot.unitNumberMode;
            
            // V96n FIX: Extract ALL address options from Control Plane
            // These were configured but never passed to BookingFlowRunner!
            options.breakDownIfUnclear = slot.breakDownIfUnclear;
            options.acceptPartialAddress = slot.acceptPartialAddress;
            options.partialAddressPrompt = slot.partialAddressPrompt;
            options.streetBreakdownPrompt = slot.streetBreakdownPrompt;
            options.cityPrompt = slot.cityPrompt;
            options.missingCityStatePrompt = slot.missingCityStatePrompt;
            options.zipPrompt = slot.zipPrompt;
            
            // City/State requirements
            options.requireCity = slot.requireCity !== false; // Default true if not explicitly false
            options.requireState = slot.requireState !== false;
            options.requireZip = slot.requireZip === true; // Default false
            
            // Unit prompts
            options.unitPrompt = slot.unitPrompt;
            options.unitPromptVariants = slot.unitPromptVariants;
            options.unitTypePrompt = slot.unitTypePrompt;
            options.unitNumberPrompt = slot.unitNumberPrompt;
            
            // Always/Never ask unit for specific zips
            options.unitAlwaysAskZips = slot.unitAlwaysAskZips;
            options.unitNeverAskZips = slot.unitNeverAskZips;
        }
        
        // Time options
        if (slot.type === 'time') {
            options.offerAsap = slot.offerAsap;
            options.asapPhrase = slot.asapPhrase;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // COMMON OPTIONS - Apply to all slot types
        // ═══════════════════════════════════════════════════════════════════
        options.confirmBack = slot.confirmBack;
        options.confirmPrompt = slot.confirmPrompt;
        options.skipIfKnown = slot.skipIfKnown;
        options.midCallRules = slot.midCallRules;
        
        return options;
    }
    
    /**
     * Generate a flow ID for tracking
     */
    static generateFlowId(company, trade, serviceType) {
        const companySlug = (company.slug || company.name || company.companyName || 'unknown')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '_')
            .substring(0, 20);
        
        const tradeSlug = trade ? `_${trade.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : '';
        const serviceSlug = serviceType ? `_${serviceType.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : '';
        
        return `${companySlug}${tradeSlug}${serviceSlug}_booking_v1`;
    }
    
    /**
     * ========================================================================
     * V110: MERGE SLOT REGISTRY WITH BOOKING FLOW STEPS
     * ========================================================================
     * Combines V110 slot definitions with booking flow step prompts to create
     * a unified slot array compatible with the existing flow processing.
     * 
     * SlotRegistry provides: id, type, label, required, extraction rules
     * BookingFlow provides: ask, confirmPrompt, reprompt, correctionPrompt
     * 
     * Result: Array of slots with all properties merged
     * ========================================================================
     */
    static _mergeV110SlotsWithSteps(slots, steps) {
        if (!slots || !steps) return [];
        
        // Create a map of steps by slotId for O(1) lookup
        const stepsBySlotId = new Map();
        for (const step of steps) {
            if (step.slotId) {
                stepsBySlotId.set(step.slotId, step);
            }
        }
        
        // Merge slot definitions with step prompts
        const mergedSlots = [];
        
        for (const slot of slots) {
            const slotId = slot.id || slot.slotId;
            const step = stepsBySlotId.get(slotId);
            
            // Build merged slot object
            const mergedSlot = {
                // From SlotRegistry
                id: slotId,
                slotId: slotId, // Alias for compatibility
                type: slot.type || 'text',
                label: slot.label || slotId,
                required: slot.required !== false,
                discoveryFillAllowed: slot.discoveryFillAllowed !== false,
                bookingConfirmRequired: slot.bookingConfirmRequired !== false,
                extraction: slot.extraction || {},
                
                // From BookingFlow step (if exists)
                question: step?.ask || DEFAULT_STEP_PROMPTS[slotId]?.prompt || `What is your ${slotId}?`,
                prompt: step?.ask || DEFAULT_STEP_PROMPTS[slotId]?.prompt || `What is your ${slotId}?`,
                confirmPrompt: step?.confirmPrompt || null,
                reprompt: step?.reprompt || DEFAULT_STEP_PROMPTS[slotId]?.reprompt || `Could you repeat your ${slotId}?`,
                repromptVariants: step?.repromptVariants || [],
                confirmRetryPrompt: step?.confirmRetryPrompt || null,
                correctionPrompt: step?.correctionPrompt || null,
                
                // Additional step metadata
                stepId: step?.stepId || `step_${slotId}`,
                order: step?.order || slot.order || 999,
                
                // V110 flag for tracing
                _v110Source: true
            };
            
            // Handle name-specific fields
            if (slotId === 'name' || slot.type === 'name_first') {
                mergedSlot.firstNameQuestion = step?.ask || mergedSlot.question;
                mergedSlot.lastNameQuestion = step?.lastNameQuestion || "And what's your last name?";
            }
            
            mergedSlots.push(mergedSlot);
        }
        
        // Sort by order
        mergedSlots.sort((a, b) => (a.order || 999) - (b.order || 999));
        
        logger.debug('[BOOKING FLOW RESOLVER] V110: Merged slots with steps', {
            inputSlots: slots.length,
            inputSteps: steps.length,
            outputSlots: mergedSlots.length,
            slotIds: mergedSlots.map(s => s.id)
        });
        
        return mergedSlots;
    }
    
    /**
     * ========================================================================
     * BUILD DEFAULT FLOW - Fallback when no UI config exists
     * ========================================================================
     */
    static buildDefaultFlow(companyId, templates = {}) {
        return {
            flowId: `default_booking_v2`,  // V92: Updated to v2 with conditional steps
            flowName: 'Default Booking Flow',
            steps: [
                {
                    id: 'name',
                    fieldKey: 'name',
                    type: 'name',
                    label: 'Name',
                    prompt: DEFAULT_STEP_PROMPTS.name.prompt,
                    reprompt: DEFAULT_STEP_PROMPTS.name.reprompt,
                    required: true,
                    order: 1,
                    validation: { required: true, type: 'name', minLength: 2 },
                    options: {}
                },
                {
                    id: 'phone',
                    fieldKey: 'phone',
                    type: 'phone',
                    label: 'Phone',
                    prompt: DEFAULT_STEP_PROMPTS.phone.prompt,
                    reprompt: DEFAULT_STEP_PROMPTS.phone.reprompt,
                    required: true,
                    order: 2,
                    validation: { required: true, type: 'phone', minDigits: 10 },
                    options: {}
                },
                {
                    id: 'address',
                    fieldKey: 'address',
                    type: 'address',
                    label: 'Address',
                    prompt: DEFAULT_STEP_PROMPTS.address.prompt,
                    reprompt: DEFAULT_STEP_PROMPTS.address.reprompt,
                    required: true,
                    order: 3,
                    validation: { required: true, type: 'address' },
                    options: { useGoogleMapsValidation: true }
                },
                // ═══════════════════════════════════════════════════════════════════
                // V92: CONDITIONAL ADDRESS FOLLOW-UP STEPS
                // These only trigger when Google Geo validation detects the need
                // ═══════════════════════════════════════════════════════════════════
                {
                    id: 'propertyType',
                    fieldKey: 'propertyType',
                    type: 'select',
                    label: 'Property Type',
                    prompt: DEFAULT_STEP_PROMPTS.propertyType.prompt,
                    reprompt: DEFAULT_STEP_PROMPTS.propertyType.reprompt,
                    required: true,
                    order: 4,
                    validation: { required: true, type: 'select' },
                    options: {
                        choices: ['house', 'apartment', 'condo', 'townhouse', 'commercial', 'mobile home', 'other']
                    },
                    // Only ask if Google Geo detected possible multi-unit OR ambiguous
                    condition: { stateKey: 'addressValidation.needsUnit', equals: true }
                },
                {
                    id: 'unit',
                    fieldKey: 'unit',
                    type: 'text',
                    label: 'Unit/Apt Number',
                    prompt: DEFAULT_STEP_PROMPTS.unit.prompt,
                    reprompt: DEFAULT_STEP_PROMPTS.unit.reprompt,
                    required: true,
                    order: 5,
                    validation: { required: true, type: 'text' },
                    options: {},
                    // Only ask if property type is apartment/condo/commercial or needsUnit is true
                    condition: { stateKey: 'addressNeedsUnit', equals: true }
                },
                {
                    id: 'gateAccess',
                    fieldKey: 'gateAccess',
                    type: 'yesno',
                    label: 'Gated/Secured Entry',
                    prompt: DEFAULT_STEP_PROMPTS.gateAccess.prompt,
                    reprompt: DEFAULT_STEP_PROMPTS.gateAccess.reprompt,
                    required: true,
                    order: 6,
                    validation: { required: true, type: 'yesno' },
                    options: {},
                    // Only ask for multi-unit properties
                    condition: { 
                        stateKey: 'collected.propertyType', 
                        in: ['apartment', 'condo', 'townhouse', 'commercial'] 
                    }
                },
                {
                    id: 'gateCode',
                    fieldKey: 'gateCode',
                    type: 'text',
                    label: 'Gate Code',
                    prompt: DEFAULT_STEP_PROMPTS.gateCode.prompt,
                    reprompt: DEFAULT_STEP_PROMPTS.gateCode.reprompt,
                    required: true,
                    order: 7,
                    validation: { required: true, type: 'text' },
                    options: {},
                    // Only ask if they said there IS a gate
                    condition: { stateKey: 'collected.gateAccess', equals: 'yes' }
                },
                // ═══════════════════════════════════════════════════════════════════
                {
                    id: 'time',
                    fieldKey: 'time',
                    type: 'time',
                    label: 'Preferred Time',
                    prompt: DEFAULT_STEP_PROMPTS.time.prompt,
                    reprompt: DEFAULT_STEP_PROMPTS.time.reprompt,
                    required: false,
                    order: 10,
                    validation: { required: false, type: 'time' },
                    options: {}
                }
            ],
            confirmationTemplate: templates.confirmTemplate ||
                "Let me confirm: I have {name} at {phone}, service address {address}. Is that correct?",
            confirmationTemplateSource: templates.confirmTemplate ? 'config' : 'hardcoded_default',
            completionTemplate: templates.completeTemplate ||
                "Your appointment has been scheduled. Is there anything else I can help you with?",
            completionTemplateSource: templates.completeTemplate ? 'config' : 'hardcoded_default',
            // V96j: Default behavior options (can be overridden in company config)
            enforcePromptOrder: false,
            confirmIfPreFilled: true, // Default: ask to confirm pre-filled slots
            alwaysAskEvenIfFilled: [],
            source: 'default',
            companyId
        };
    }
    
    /**
     * ========================================================================
     * GET STEP BY ID - Get a specific step from a flow
     * ========================================================================
     */
    static getStepById(flow, stepId) {
        if (!flow || !flow.steps) return null;
        return flow.steps.find(s => s.id === stepId);
    }
    
    /**
     * ========================================================================
     * GET NEXT STEP - Get the next step after a given step
     * ========================================================================
     */
    static getNextStep(flow, currentStepId) {
        if (!flow || !flow.steps || flow.steps.length === 0) return null;
        
        const currentIndex = flow.steps.findIndex(s => s.id === currentStepId);
        
        if (currentIndex === -1) {
            // Current step not found, return first step
            return flow.steps[0];
        }
        
        if (currentIndex >= flow.steps.length - 1) {
            // No more steps
            return null;
        }
        
        return flow.steps[currentIndex + 1];
    }
    
    /**
     * ========================================================================
     * GET FIRST REQUIRED STEP - Get the first required step that's not filled
     * ========================================================================
     */
    static getFirstMissingRequiredStep(flow, collectedData = {}) {
        if (!flow || !flow.steps) return null;
        
        for (const step of flow.steps) {
            if (!step.required) continue;
            
            const fieldKey = step.fieldKey || step.id;
            const value = collectedData[fieldKey];
            
            if (!value || (typeof value === 'string' && value.trim() === '')) {
                return step;
            }
        }
        
        return null; // All required steps are filled
    }
}

module.exports = BookingFlowResolver;
module.exports.DEFAULT_STEP_PROMPTS = DEFAULT_STEP_PROMPTS;
module.exports.VALIDATION_PATTERNS = VALIDATION_PATTERNS;
