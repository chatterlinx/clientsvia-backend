/**
 * ============================================================================
 * DYNAMIC FLOW MODEL - Trigger → Event → State → Action System
 * ============================================================================
 * 
 * This is the "brain stem" of the conversation system.
 * 
 * ARCHITECTURE:
 * 1. TRIGGERS detect intent/context from caller utterances
 * 2. EVENTS are fired when triggers match
 * 3. REQUIREMENTS are activated (fields to collect, actions to perform)
 * 4. ACTIONS execute (lookups, state changes, response rules)
 * 
 * STORAGE:
 * - Global templates (read-only, shared across companies)
 * - Company-specific flows (editable copies with overrides)
 * 
 * MULTI-TENANT: Always scoped by companyId
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

// ════════════════════════════════════════════════════════════════════════════
// TRIGGER SCHEMA - How to detect this flow should activate
// ════════════════════════════════════════════════════════════════════════════
const TriggerSchema = new Schema({
    // Trigger type
    type: {
        type: String,
        enum: [
            'phrase',           // Exact/fuzzy phrase match
            'keyword',          // Keyword presence
            'regex',            // Regex pattern
            'intent',           // Intent classification
            'slot_value',       // When a slot has specific value
            'slot_missing',     // When a slot is missing
            'turn_count',       // After N turns
            'time_elapsed',     // After N seconds
            'previous_flow',    // After another flow completes
            'customer_flag',    // Customer has specific flag (returning, VIP, etc.)
            'composite'         // Multiple conditions (AND/OR)
        ],
        required: true
    },
    
    // Trigger configuration based on type
    config: {
        // For 'phrase' type
        phrases: [{ type: String }],        // ["returning customer", "been here before"]
        fuzzy: { type: Boolean, default: true },
        
        // For 'keyword' type
        keywords: [{ type: String }],       // ["emergency", "urgent", "asap"]
        matchAll: { type: Boolean, default: false },  // AND vs OR
        
        // For 'regex' type
        pattern: { type: String },          // "\\b(member|membership)\\s*(id|number)?\\b"
        flags: { type: String, default: 'i' },
        
        // For 'intent' type
        intents: [{ type: String }],        // ["wants_booking", "has_complaint"]
        minConfidence: { type: Number, default: 0.7 },
        
        // For 'slot_value' type
        slotId: { type: String },           // "issue"
        slotValues: [{ type: String }],     // ["emergency", "no heat", "no ac"]
        
        // For 'slot_missing' type
        missingSlots: [{ type: String }],   // ["name", "phone"]
        
        // For 'turn_count' type
        minTurns: { type: Number },
        maxTurns: { type: Number },
        
        // For 'time_elapsed' type
        minSeconds: { type: Number },
        maxSeconds: { type: Number },
        
        // For 'previous_flow' type
        flowIds: [{ type: Schema.Types.ObjectId, ref: 'DynamicFlow' }],
        
        // For 'customer_flag' type
        flags: [{ type: String }],          // ["returning", "vip", "membership"]
        
        // For 'composite' type
        operator: { type: String, enum: ['AND', 'OR'], default: 'AND' },
        subTriggers: [{ type: Schema.Types.Mixed }]  // Nested trigger configs
    },
    
    // Priority (higher = evaluated first)
    priority: { type: Number, default: 0 },
    
    // Description for UI
    description: { type: String, trim: true }
}, { _id: false });

// ════════════════════════════════════════════════════════════════════════════
// REQUIREMENT SCHEMA - What must be collected/done when flow activates
// ════════════════════════════════════════════════════════════════════════════
const RequirementSchema = new Schema({
    // Requirement type
    type: {
        type: String,
        enum: [
            'collect_slot',     // Collect a booking slot
            'collect_custom',   // Collect custom field
            'verify_slot',      // Verify/confirm a slot value
            'lookup',           // Perform a lookup (customer, membership, etc.)
            'set_flag',         // Set a session flag
            'set_fact',         // Add to session.memory.facts
            'acknowledge',      // Acknowledge something caller said
            'response_rule'     // Add a response rule/constraint
        ],
        required: true
    },
    
    // Requirement configuration
    config: {
        // For 'collect_slot' / 'verify_slot'
        slotId: { type: String },
        required: { type: Boolean, default: true },
        askImmediately: { type: Boolean, default: false },
        customPrompt: { type: String, trim: true },
        
        // For 'collect_custom'
        fieldId: { type: String },
        fieldLabel: { type: String },
        fieldType: { type: String, enum: ['text', 'number', 'date', 'choice'], default: 'text' },
        choices: [{ type: String }],
        
        // For 'lookup'
        lookupType: { type: String },       // "customer", "membership", "appointment"
        lookupKey: { type: String },        // Which slot to use as lookup key
        storeAs: { type: String },          // Where to store result in session
        
        // For 'set_flag'
        flagName: { type: String },
        flagValue: { type: Schema.Types.Mixed, default: true },
        
        // For 'set_fact'
        factKey: { type: String },
        factValue: { type: String },        // Can include {slot} placeholders
        
        // For 'acknowledge'
        acknowledgment: { type: String },   // "I see you're a returning customer"
        onlyOnce: { type: Boolean, default: true },
        
        // For 'response_rule'
        rule: { type: String },             // "never_say_new_customer", "use_first_name"
        ruleConfig: { type: Schema.Types.Mixed }
    },
    
    // Order within flow
    order: { type: Number, default: 0 },
    
    // Description for UI
    description: { type: String, trim: true }
}, { _id: false });

// ════════════════════════════════════════════════════════════════════════════
// ACTION SCHEMA - What to do when flow completes or at specific points
// ════════════════════════════════════════════════════════════════════════════
const ActionSchema = new Schema({
    // When to execute
    timing: {
        type: String,
        enum: [
            'on_activate',      // When flow first activates
            'on_complete',      // When all requirements met
            'on_timeout',       // If flow times out
            'on_cancel',        // If flow is cancelled
            'each_turn'         // Every turn while flow is active
        ],
        default: 'on_complete'
    },
    
    // Action type
    type: {
        type: String,
        enum: [
            'transition_mode',  // Change session.mode
            'activate_flow',    // Activate another flow
            'deactivate_flow',  // Deactivate a flow
            'send_response',    // Send a specific response
            'set_next_slot',    // Set which slot to collect next
            'create_record',    // Create a booking/appointment record
            'notify',           // Send notification (internal)
            'transfer',         // Transfer to live agent
            'end_call',         // End the conversation
            'custom'            // Custom action (webhook, etc.)
        ],
        required: true
    },
    
    // Action configuration
    config: {
        // For 'transition_mode'
        targetMode: { type: String, enum: ['DISCOVERY', 'BOOKING', 'COMPLETE', 'TRANSFER'] },
        
        // For 'activate_flow' / 'deactivate_flow'
        flowId: { type: Schema.Types.ObjectId, ref: 'DynamicFlow' },
        flowName: { type: String },
        
        // For 'send_response'
        response: { type: String, trim: true },
        appendToNext: { type: Boolean, default: false },
        
        // For 'set_next_slot'
        slotId: { type: String },
        
        // For 'create_record'
        recordType: { type: String },       // "booking", "callback", "lead"
        
        // For 'notify'
        notifyType: { type: String },       // "email", "sms", "webhook"
        notifyTarget: { type: String },
        notifyMessage: { type: String },
        
        // For 'transfer'
        transferTo: { type: String },
        transferReason: { type: String },
        
        // For 'custom'
        customAction: { type: String },
        customConfig: { type: Schema.Types.Mixed }
    },
    
    // Description for UI
    description: { type: String, trim: true }
}, { _id: false });

// ════════════════════════════════════════════════════════════════════════════
// MAIN DYNAMIC FLOW SCHEMA
// ════════════════════════════════════════════════════════════════════════════
const DynamicFlowSchema = new Schema({
    // ─────────────────────────────────────────────────────────────────────────
    // IDENTITY
    // ─────────────────────────────────────────────────────────────────────────
    name: { 
        type: String, 
        required: true, 
        trim: true 
    },
    
    description: { 
        type: String, 
        trim: true 
    },
    
    // Unique key for referencing (e.g., "returning_customer", "emergency_service")
    flowKey: { 
        type: String, 
        required: true, 
        trim: true,
        lowercase: true
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // OWNERSHIP
    // ─────────────────────────────────────────────────────────────────────────
    // If null, this is a global template
    // If set, this is a company-specific flow
    companyId: { 
        type: Schema.Types.ObjectId, 
        ref: 'v2Company',
        index: true,
        default: null
    },
    
    // If this is a copy of a global template, reference it here
    templateId: { 
        type: Schema.Types.ObjectId, 
        ref: 'DynamicFlow',
        default: null
    },
    
    // Trade type (for trade-specific flows)
    tradeType: {
        type: String,
        enum: ['hvac', 'plumbing', 'electrical', 'dental', 'medical', 'legal', 'general', null],
        default: null
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // STATUS
    // ─────────────────────────────────────────────────────────────────────────
    enabled: { 
        type: Boolean, 
        default: true 
    },
    
    // Global templates are read-only
    isTemplate: { 
        type: Boolean, 
        default: false 
    },
    
    // Priority for evaluation order (higher = first)
    priority: { 
        type: Number, 
        default: 0 
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // FLOW CONFIGURATION
    // ─────────────────────────────────────────────────────────────────────────
    
    // Triggers that activate this flow
    triggers: [TriggerSchema],
    
    // Requirements when flow is active (standard slots)
    requirements: [RequirementSchema],
    
    // ─────────────────────────────────────────────────────────────────────────
    // CUSTOM FIELDS (Flow-Owned)
    // ─────────────────────────────────────────────────────────────────────────
    // These are flow-specific fields like clientId, gateCode, unitNumber.
    // They use their own prompts (not Booking Prompts).
    // Stored in session.dynamicFlows.facts at runtime.
    // ─────────────────────────────────────────────────────────────────────────
    customFields: [{
        // Unique key for this field (e.g., "clientId", "gateCode")
        fieldKey: { type: String, required: true, trim: true },
        
        // Human-readable label (e.g., "Client ID")
        label: { type: String, trim: true },
        
        // The exact question to ask (flow owns this, not Booking Prompts)
        prompt: { type: String, required: true, trim: true },
        
        // Collection order (lower = earlier). Standard slots use 10-50.
        order: { type: Number, default: 25 },
        
        // Is this field required?
        required: { type: Boolean, default: true },
        
        // Validation rules
        validation: {
            type: { type: String, enum: ['text', 'number', 'phone', 'email', 'regex'], default: 'text' },
            pattern: { type: String }, // For regex validation
            minLength: { type: Number },
            maxLength: { type: Number },
            min: { type: Number }, // For number validation
            max: { type: Number }
        }
    }],
    
    // Actions to execute
    actions: [ActionSchema],
    
    // ─────────────────────────────────────────────────────────────────────────
    // BEHAVIOR SETTINGS
    // ─────────────────────────────────────────────────────────────────────────
    settings: {
        // Can this flow run alongside other flows?
        allowConcurrent: { type: Boolean, default: true },
        
        // Flows that this one conflicts with (mutex)
        conflictsWith: [{ type: String }],  // flowKeys
        
        // Maximum time this flow can be active (seconds)
        maxDurationSeconds: { type: Number, default: null },
        
        // Should this flow persist across turns?
        persistent: { type: Boolean, default: true },
        
        // Can this flow be re-activated after completing?
        reactivatable: { type: Boolean, default: false },
        
        // Minimum confidence to activate
        minConfidence: { type: Number, default: 0.7 },
        
        // Should we log detailed trace?
        enableTrace: { type: Boolean, default: true }
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // METADATA
    // ─────────────────────────────────────────────────────────────────────────
    metadata: {
        version: { type: Number, default: 1 },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
        lastModifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        usageCount: { type: Number, default: 0 },
        lastUsedAt: { type: Date },
        tags: [{ type: String }]
    }
    
}, { 
    timestamps: true,
    collection: 'dynamic_flows'
});

// ════════════════════════════════════════════════════════════════════════════
// INDEXES
// ════════════════════════════════════════════════════════════════════════════
DynamicFlowSchema.index({ companyId: 1, enabled: 1, priority: -1 });
DynamicFlowSchema.index({ companyId: 1, flowKey: 1 }, { unique: true, sparse: true });
DynamicFlowSchema.index({ isTemplate: 1, enabled: 1 });
DynamicFlowSchema.index({ tradeType: 1, isTemplate: 1 });

// ════════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Get all enabled flows for a company
 * 
 * CRITICAL MULTI-TENANT RULE:
 * Runtime ONLY uses company-specific flows.
 * Global templates are NEVER used directly in runtime.
 * Companies must COPY templates to use them.
 * 
 * This prevents cross-tenant contamination.
 */
DynamicFlowSchema.statics.getFlowsForCompany = async function(companyId, tradeType = null) {
    const mongoose = require('mongoose');
    
    // ═══════════════════════════════════════════════════════════════════════════
    // MULTI-TENANT ISOLATION: ONLY company-specific flows
    // Global templates are NEVER included in runtime
    // Companies must explicitly copy templates to use them
    // ═══════════════════════════════════════════════════════════════════════════
    const companyFlows = await this.find({
        companyId: new mongoose.Types.ObjectId(companyId),
        enabled: true,
        isTemplate: false  // Extra safety: never include templates
    }).sort({ priority: -1 }).lean();
    
    return companyFlows;
};

/**
 * Create a company copy of a template
 */
DynamicFlowSchema.statics.createFromTemplate = async function(templateId, companyId, overrides = {}) {
    const template = await this.findById(templateId).lean();
    if (!template) {
        throw new Error('Template not found');
    }
    
    // Remove template-specific fields
    delete template._id;
    delete template.createdAt;
    delete template.updatedAt;
    
    // Create company copy
    const companyFlow = {
        ...template,
        companyId,
        templateId,
        isTemplate: false,
        ...overrides,
        metadata: {
            ...template.metadata,
            version: 1,
            usageCount: 0,
            lastUsedAt: null
        }
    };
    
    return this.create(companyFlow);
};

/**
 * Get global templates
 */
DynamicFlowSchema.statics.getTemplates = async function(tradeType = null) {
    const query = { isTemplate: true, enabled: true };
    
    if (tradeType) {
        query.$or = [
            { tradeType: tradeType },
            { tradeType: null },
            { tradeType: 'general' }
        ];
    }
    
    return this.find(query).sort({ priority: -1 }).lean();
};

/**
 * Increment usage count
 */
DynamicFlowSchema.statics.recordUsage = async function(flowId) {
    return this.updateOne(
        { _id: flowId },
        { 
            $inc: { 'metadata.usageCount': 1 },
            $set: { 'metadata.lastUsedAt': new Date() }
        }
    );
};

// ════════════════════════════════════════════════════════════════════════════
// INSTANCE METHODS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Check if this flow's triggers match the current context
 */
DynamicFlowSchema.methods.evaluateTriggers = function(context) {
    const { userText, session, customer, slots } = context;
    
    for (const trigger of this.triggers) {
        const match = evaluateSingleTrigger(trigger, context);
        if (match.matched) {
            return {
                matched: true,
                trigger: trigger,
                confidence: match.confidence,
                matchedValue: match.matchedValue
            };
        }
    }
    
    return { matched: false };
};

// Helper function to evaluate a single trigger
function evaluateSingleTrigger(trigger, context) {
    const { userText, session, customer, slots } = context;
    const userTextLower = (userText || '').toLowerCase();
    
    switch (trigger.type) {
        case 'phrase': {
            const phrases = trigger.config.phrases || [];
            for (const phrase of phrases) {
                const phraseLower = phrase.toLowerCase();
                if (trigger.config.fuzzy) {
                    // Fuzzy: contains
                    if (userTextLower.includes(phraseLower)) {
                        return { matched: true, confidence: 0.8, matchedValue: phrase };
                    }
                } else {
                    // Exact match
                    if (userTextLower === phraseLower) {
                        return { matched: true, confidence: 1.0, matchedValue: phrase };
                    }
                }
            }
            break;
        }
        
        case 'keyword': {
            const keywords = trigger.config.keywords || [];
            const matchedKeywords = keywords.filter(kw => 
                userTextLower.includes(kw.toLowerCase())
            );
            
            if (trigger.config.matchAll) {
                // AND: all keywords must match
                if (matchedKeywords.length === keywords.length) {
                    return { matched: true, confidence: 0.9, matchedValue: matchedKeywords };
                }
            } else {
                // OR: any keyword matches
                if (matchedKeywords.length > 0) {
                    return { matched: true, confidence: 0.7, matchedValue: matchedKeywords };
                }
            }
            break;
        }
        
        case 'regex': {
            try {
                const regex = new RegExp(trigger.config.pattern, trigger.config.flags || 'i');
                const match = userText.match(regex);
                if (match) {
                    return { matched: true, confidence: 0.85, matchedValue: match[0] };
                }
            } catch (e) {
                // Invalid regex - skip
            }
            break;
        }
        
        case 'slot_value': {
            const slotValue = slots?.[trigger.config.slotId];
            if (slotValue) {
                const slotValues = trigger.config.slotValues || [];
                const slotValueLower = slotValue.toLowerCase();
                for (const sv of slotValues) {
                    if (slotValueLower.includes(sv.toLowerCase())) {
                        return { matched: true, confidence: 0.9, matchedValue: slotValue };
                    }
                }
            }
            break;
        }
        
        case 'slot_missing': {
            const missingSlots = trigger.config.missingSlots || [];
            const actuallyMissing = missingSlots.filter(s => !slots?.[s]);
            if (actuallyMissing.length === missingSlots.length) {
                return { matched: true, confidence: 1.0, matchedValue: actuallyMissing };
            }
            break;
        }
        
        case 'turn_count': {
            const turnCount = session?.metrics?.totalTurns || 0;
            const min = trigger.config.minTurns || 0;
            const max = trigger.config.maxTurns || Infinity;
            if (turnCount >= min && turnCount <= max) {
                return { matched: true, confidence: 1.0, matchedValue: turnCount };
            }
            break;
        }
        
        case 'customer_flag': {
            const flags = trigger.config.flags || [];
            for (const flag of flags) {
                if (customer?.[flag] || customer?.flags?.[flag] || session?.signals?.[flag]) {
                    return { matched: true, confidence: 1.0, matchedValue: flag };
                }
            }
            break;
        }
        
        case 'composite': {
            const subTriggers = trigger.config.subTriggers || [];
            const results = subTriggers.map(st => evaluateSingleTrigger(st, context));
            
            if (trigger.config.operator === 'AND') {
                if (results.every(r => r.matched)) {
                    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
                    return { matched: true, confidence: avgConfidence, matchedValue: results };
                }
            } else {
                const matched = results.find(r => r.matched);
                if (matched) {
                    return matched;
                }
            }
            break;
        }
    }
    
    return { matched: false };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORT
// ════════════════════════════════════════════════════════════════════════════

const DynamicFlow = mongoose.model('DynamicFlow', DynamicFlowSchema);

module.exports = DynamicFlow;

