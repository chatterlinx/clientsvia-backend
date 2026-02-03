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
    static resolve({ companyId, trade, serviceType, company }) {
        if (!company) {
            logger.warn('[BOOKING FLOW RESOLVER] No company provided, using defaults', { companyId });
            return this.buildDefaultFlow(companyId);
        }
        
        const aiSettings = company.aiAgentSettings || {};
        const frontDeskBehavior = aiSettings.frontDeskBehavior || {};
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92 FIX: Read from CORRECT path
        // ═══════════════════════════════════════════════════════════════════════
        // The UI saves booking slots to: aiAgentSettings.frontDeskBehavior.bookingSlots
        // Previously was reading from: aiAgentSettings.bookingSlots (WRONG!)
        // Also check legacy path for backward compatibility
        // ═══════════════════════════════════════════════════════════════════════
        const bookingSlots = frontDeskBehavior.bookingSlots || aiSettings.bookingSlots || [];
        const bookingTemplates = aiSettings.bookingTemplates || {};
        const bookingPromptsMap = aiSettings.bookingPromptsMap || new Map();
        
        logger.debug('[BOOKING FLOW RESOLVER] Resolving flow', {
            companyId: company._id?.toString(),
            hasFrontDeskSlots: !!frontDeskBehavior.bookingSlots?.length,
            hasLegacySlots: !!aiSettings.bookingSlots?.length,
            slotCount: bookingSlots.length,
            slotIds: bookingSlots.map(s => s.id || s.slotId).slice(0, 10)
        });
        
        // If no booking slots configured, use defaults
        if (bookingSlots.length === 0) {
            logger.warn('[BOOKING FLOW RESOLVER] No booking slots configured, using defaults', { 
                companyId: company._id,
                companyName: company.name,
                checkedPaths: ['aiAgentSettings.frontDeskBehavior.bookingSlots', 'aiAgentSettings.bookingSlots']
            });
            return this.buildDefaultFlow(companyId, bookingTemplates);
        }
        
        // Build flow from UI-configured booking slots
        const steps = this.buildStepsFromSlots(bookingSlots, bookingPromptsMap, company);
        
        // Generate flow ID
        const flowId = this.generateFlowId(company, trade, serviceType);
        
        const flow = {
            flowId,
            flowName: `${company.name || 'Company'} Booking Flow`,
            steps,
            confirmationTemplate: bookingTemplates.confirmTemplate || 
                "Let me confirm: I have {name} at {phone}, service address {address}. Is that correct?",
            completionTemplate: bookingTemplates.completeTemplate ||
                "Your appointment has been scheduled. Is there anything else I can help you with?",
            source: 'company_config',
            trade: trade || null,
            serviceType: serviceType || null,
            companyId: company._id?.toString() || companyId
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
            
            // Get prompt from various sources (priority order)
            const prompt = this.getSlotPrompt(slot, slotId, slotType, bookingPromptsMap, company);
            const reprompt = this.getSlotReprompt(slot, slotId, slotType, bookingPromptsMap, company);
            
            steps.push({
                id: slotId,
                fieldKey: slotId,
                type: slotType,
                label: slot.label || slotType,
                prompt,
                reprompt,
                required: slot.required !== false, // Default to required
                order: slot.order || steps.length + 1,
                validation: this.buildValidation(slot, slotType),
                // Slot-specific options (for specialized handlers)
                options: this.extractSlotOptions(slot)
            });
        }
        
        return steps;
    }
    
    /**
     * Get the primary prompt for a slot
     */
    static getSlotPrompt(slot, slotId, slotType, bookingPromptsMap, company) {
        // 1. Direct slot question
        if (slot.question && slot.question !== '/* USE UI CONFIG */') {
            return slot.question;
        }
        
        // 2. Booking prompts map (key format: "booking:{slotId}:question")
        if (bookingPromptsMap instanceof Map) {
            const mapPrompt = bookingPromptsMap.get(`booking:${slotId}:question`);
            if (mapPrompt) return mapPrompt;
        } else if (typeof bookingPromptsMap === 'object') {
            const mapPrompt = bookingPromptsMap[`booking:${slotId}:question`];
            if (mapPrompt) return mapPrompt;
        }
        
        // 3. Legacy bookingPrompts object
        const legacyPrompts = company.aiAgentSettings?.bookingPrompts || {};
        const legacyKey = `ask${slotType.charAt(0).toUpperCase() + slotType.slice(1)}`;
        if (legacyPrompts[legacyKey]) {
            return legacyPrompts[legacyKey];
        }
        
        // 4. Default fallback
        return DEFAULT_STEP_PROMPTS[slotType]?.prompt || `What is your ${slotType}?`;
    }
    
    /**
     * Get the reprompt (clarification) for a slot
     */
    static getSlotReprompt(slot, slotId, slotType, bookingPromptsMap, company) {
        // 1. Direct slot reprompt
        if (slot.reprompt) {
            return slot.reprompt;
        }
        
        // 2. Confirm prompt can be used as reprompt
        if (slot.confirmPrompt) {
            return slot.confirmPrompt;
        }
        
        // 3. Booking prompts map
        if (bookingPromptsMap instanceof Map) {
            const mapReprompt = bookingPromptsMap.get(`booking:${slotId}:reprompt`);
            if (mapReprompt) return mapReprompt;
        } else if (typeof bookingPromptsMap === 'object') {
            const mapReprompt = bookingPromptsMap[`booking:${slotId}:reprompt`];
            if (mapReprompt) return mapReprompt;
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
        if (slot.type === 'name') {
            options.askFullName = slot.askFullName;
            options.askMissingNamePart = slot.askMissingNamePart;
            options.useFirstNameOnly = slot.useFirstNameOnly;
            options.lastNameQuestion = slot.lastNameQuestion;
            options.firstNameQuestion = slot.firstNameQuestion;
            options.duplicateNamePartPrompt = slot.duplicateNamePartPrompt;
            // V92: Spelling confirmation
            options.confirmSpelling = slot.confirmSpelling;
            options.helperNote = slot.helperNote;
        }
        
        // Phone options
        if (slot.type === 'phone') {
            options.offerCallerId = slot.offerCallerId;
            options.callerIdPrompt = slot.callerIdPrompt;
        }
        
        // Address options
        if (slot.type === 'address') {
            options.addressConfirmLevel = slot.addressConfirmLevel;
            options.useGoogleMapsValidation = slot.useGoogleMapsValidation;
            options.unitNumberMode = slot.unitNumberMode;
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
        const companySlug = (company.slug || company.name || 'unknown')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '_')
            .substring(0, 20);
        
        const tradeSlug = trade ? `_${trade.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : '';
        const serviceSlug = serviceType ? `_${serviceType.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : '';
        
        return `${companySlug}${tradeSlug}${serviceSlug}_booking_v1`;
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
            completionTemplate: templates.completeTemplate ||
                "Your appointment has been scheduled. Is there anything else I can help you with?",
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
