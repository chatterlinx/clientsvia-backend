/**
 * FullScenarioRule - Comprehensive scenario validation
 * 
 * This rule checks EVERYTHING that the other rules might miss:
 * 
 * STATUS & LIFECYCLE:
 *   - Status is 'live' (not draft/archived)
 *   - isActive is true
 * 
 * FOLLOW-UP CONFIGURATION:
 *   - followUpQuestionText exists when followUpMode = ASK_FOLLOWUP_QUESTION
 *   - transferTarget exists when followUpMode = TRANSFER
 *   - followUpMessages don't contain banned phrases
 *   - silencePolicy.finalWarning doesn't contain banned phrases
 * 
 * REGEX VALIDATION:
 *   - All regexTriggers compile without errors
 *   - Regex patterns have reasonable complexity
 * 
 * PLACEHOLDER CONSISTENCY:
 *   - All placeholders are from approved list
 *   - Placeholders are consistent across replies
 * 
 * NEGATIVE TRIGGERS:
 *   - negativeTriggers don't overlap with triggers
 * 
 * COOLDOWN:
 *   - cooldownSeconds is reasonable (0-300)
 * 
 * ENTITY CAPTURE:
 *   - entityCapture fields are valid known entities
 * 
 * REPLY BUNDLES:
 *   - replyBundles.short has at least 2 variants
 *   - replyBundles.long has at least 2 variants
 * 
 * This is a DETERMINISTIC rule (no LLM cost).
 */

const BaseRule = require('./BaseRule');
const {
    ALL_BANNED_PHRASES,
    ALLOWED_PLACEHOLDERS,
    BANNED_BEHAVIORS,
    APPROVED_BEHAVIORS,
    SEVERITY,
    RULE_CATEGORIES,
    getContentFields,
    getRuntimeFields,
    getAdminFields,
    SCENARIO_SETTINGS_REGISTRY
} = require('../constants');

class FullScenarioRule extends BaseRule {
    constructor() {
        super();
        this.id = 'full-scenario';
        this.name = 'Full Scenario Check';
        this.description = 'Comprehensive validation of all scenario settings';
        this.severity = SEVERITY.WARNING;
        this.category = RULE_CATEGORIES.COMPLETENESS;
        this.costType = 'deterministic';
        this.enabledByDefault = true;
        
        // Valid entity types
        this.validEntities = [
            'name', 'firstName', 'lastName', 'fullName',
            'phone', 'phone_number', 'phoneNumber',
            'email', 'address', 'street', 'city', 'state', 'zip',
            'issue', 'problem', 'service', 'serviceType',
            'time', 'date', 'time_preference', 'appointment',
            'equipment', 'model', 'brand',
            'urgency', 'priority'
        ];
        
        // Valid channels
        this.validChannels = ['voice', 'sms', 'chat', 'any'];
        
        // Valid action hooks (common ones)
        this.validActionHooks = [
            'offer_scheduling', 'capture_contact', 'log_inquiry',
            'escalate_to_human', 'send_sms', 'send_email',
            'log_sentiment_positive', 'log_sentiment_negative',
            'start_booking', 'confirm_booking', 'cancel_booking',
            'transfer_call', 'end_call', 'play_hold_music'
        ];
        
        // Banned behavior keywords (from screenshots - "Friendly & Warm", "Enthusiastic & Positive" etc.)
        this.bannedBehaviorKeywords = [
            'friendly', 'warm', 'enthusiastic', 'positive', 'excited',
            'cheerful', 'bubbly', 'upbeat', 'casual'
        ];
    }
    
    async check(scenario, context = {}) {
        const violations = [];
        
        // ════════════════════════════════════════════════════════════════════════════════
        // OWNERSHIP ENFORCEMENT: Only audit content-owned fields
        // ════════════════════════════════════════════════════════════════════════════════
        // Non-content fields (runtime/admin/system) are NOT scenario-owned.
        // Report them as INFO if present (legacy data), but don't fail on them.
        // ════════════════════════════════════════════════════════════════════════════════
        
        const strippedFields = this._reportNonContentFields(scenario);
        violations.push(...strippedFields);
        
        // ════════════════════════════════════════════════════════════════════════════════
        // CONTENT CHECKS ONLY (ownership === 'content')
        // ════════════════════════════════════════════════════════════════════════════════
        
        // 1. Status & Lifecycle (content)
        violations.push(...this._checkStatus(scenario));
        
        // 2. Follow-up Configuration - SKIP (runtime/admin owned)
        // violations.push(...this._checkFollowUpConfig(scenario));
        
        // 3. Banned phrases in CONTENT text fields only
        violations.push(...this._checkContentTextFields(scenario));
        
        // 4. Regex Validation (content)
        violations.push(...this._checkRegexPatterns(scenario));
        
        // 5. Placeholder Consistency (content)
        violations.push(...this._checkPlaceholderConsistency(scenario));
        
        // 6. Negative Triggers (content)
        violations.push(...this._checkNegativeTriggers(scenario));
        
        // 7. Cooldown - SKIP (admin owned)
        // violations.push(...this._checkCooldown(scenario));
        
        // 8. Entity Capture (content)
        violations.push(...this._checkEntityCapture(scenario));
        
        // 9. Reply Bundles - SKIP (system/future)
        // violations.push(...this._checkReplyBundles(scenario));
        
        // 10. Silence Policy - SKIP (admin owned)
        // violations.push(...this._checkSilencePolicy(scenario));
        
        // 11. Timed Follow-Up - SKIP (admin owned)
        // violations.push(...this._checkTimedFollowUp(scenario));
        
        // 12. Behavior Selection (content)
        violations.push(...this._checkBehavior(scenario));
        
        // 13. Action Hooks - SKIP (admin owned)
        // violations.push(...this._checkActionHooks(scenario));
        
        // 14. Channel (content)
        violations.push(...this._checkChannel(scenario));
        
        // 15. Min Confidence (content)
        violations.push(...this._checkMinConfidence(scenario));
        
        // 16. Entity Validation Rules - SKIP (admin owned)
        // violations.push(...this._checkEntityValidation(scenario));
        
        // 17. Dynamic Variables - SKIP (admin owned)
        // violations.push(...this._checkDynamicVariables(scenario));
        
        // 18. TTS Override - SKIP (admin owned)
        // violations.push(...this._checkTTSOverride(scenario));
        
        return violations;
    }
    
    /**
     * ════════════════════════════════════════════════════════════════════════════════
     * REPORT NON-CONTENT FIELDS (ownership !== 'content')
     * ════════════════════════════════════════════════════════════════════════════════
     * 
     * If scenario contains fields that are NOT content-owned, report as INFO.
     * This alerts users to legacy data but doesn't fail the audit.
     */
    _reportNonContentFields(scenario) {
        const violations = [];
        const runtimeFields = getRuntimeFields();
        const adminFields = getAdminFields();
        const nonContentFields = [...runtimeFields, ...adminFields];
        
        const presentNonContentFields = [];
        
        for (const field of nonContentFields) {
            const value = scenario[field];
            if (value !== undefined && value !== null) {
                // Check if it's a non-empty value
                const isEmpty = Array.isArray(value) ? value.length === 0 
                    : typeof value === 'object' ? Object.keys(value).length === 0
                    : false;
                
                if (!isEmpty) {
                    presentNonContentFields.push(field);
                }
            }
        }
        
        // Report as single INFO message if any non-content fields present
        if (presentNonContentFields.length > 0) {
            const originalSeverity = this.severity;
            this.severity = SEVERITY.INFO;
            
            violations.push(this.createViolation({
                field: '_nonContentFields',
                value: presentNonContentFields.join(', '),
                message: `Legacy non-content fields present (ignored): ${presentNonContentFields.slice(0, 5).join(', ')}${presentNonContentFields.length > 5 ? '...' : ''}`,
                suggestion: 'These fields are runtime/admin-owned, not scenario content. They will be stripped on save.',
                meta: { 
                    checkType: 'ownershipEnforcement',
                    nonContentFields: presentNonContentFields,
                    fieldCount: presentNonContentFields.length
                }
            }));
            
            this.severity = originalSeverity;
        }
        
        return violations;
    }
    
    /**
     * Check CONTENT-OWNED text fields only for banned phrases
     */
    _checkContentTextFields(scenario) {
        const violations = [];
        
        // Only check content-owned text fields (not followUpMessages, timedFollowUp, etc.)
        const contentTextFields = [
            { name: 'notes', value: scenario.notes }  // Notes are content-owned (just for admin reference)
        ];
        
        // followUpPrompts is system-owned, skip it
        // followUpMessages would be runtime-owned, skip it
        
        for (const field of contentTextFields) {
            if (!field.value) continue;
            const banned = this.containsPhrase(field.value, ALL_BANNED_PHRASES);
            if (banned) {
                violations.push(this.createViolation({
                    field: field.name,
                    value: field.value,
                    message: `Contains banned phrase: "${banned}"`,
                    suggestion: 'Remove banned phrase',
                    meta: { checkType: 'bannedPhrase', bannedPhrase: banned }
                }));
            }
        }
        
        return violations;
    }
    
    /**
     * Check scenario status
     */
    _checkStatus(scenario) {
        const violations = [];
        
        if (scenario.status && scenario.status !== 'live') {
            violations.push(this.createViolation({
                field: 'status',
                value: scenario.status,
                message: `Scenario status is "${scenario.status}" - not live`,
                suggestion: 'Change status to "live" to activate this scenario',
                meta: { checkType: 'status' }
            }));
        }
        
        if (scenario.isActive === false) {
            violations.push(this.createViolation({
                field: 'isActive',
                value: false,
                message: 'Scenario is disabled (isActive = false)',
                suggestion: 'Set isActive to true to enable this scenario',
                meta: { checkType: 'status' }
            }));
        }
        
        return violations;
    }
    
    /**
     * Check follow-up configuration consistency
     */
    _checkFollowUpConfig(scenario) {
        const violations = [];
        const followUpMode = scenario.followUpMode;
        
        if (followUpMode === 'ASK_FOLLOWUP_QUESTION' && !scenario.followUpQuestionText) {
            violations.push(this.createViolation({
                field: 'followUpQuestionText',
                value: null,
                message: 'followUpMode is ASK_FOLLOWUP_QUESTION but followUpQuestionText is missing',
                suggestion: 'Add a follow-up question text',
                meta: { checkType: 'followUp' }
            }));
        }
        
        if (followUpMode === 'TRANSFER' && !scenario.transferTarget) {
            violations.push(this.createViolation({
                field: 'transferTarget',
                value: null,
                message: 'followUpMode is TRANSFER but transferTarget is missing',
                suggestion: 'Add a transfer target (queue or extension)',
                meta: { checkType: 'followUp' }
            }));
        }
        
        // Check followUpQuestionText for banned phrases
        if (scenario.followUpQuestionText) {
            const banned = this.containsPhrase(scenario.followUpQuestionText, ALL_BANNED_PHRASES);
            if (banned) {
                violations.push(this.createViolation({
                    field: 'followUpQuestionText',
                    value: scenario.followUpQuestionText,
                    message: `Follow-up question contains banned phrase: "${banned}"`,
                    suggestion: 'Remove banned phrase from follow-up question',
                    meta: { checkType: 'followUp', bannedPhrase: banned }
                }));
            }
        }
        
        return violations;
    }
    
    // _checkAllTextFields REMOVED - replaced by _checkContentTextFields
    // Non-content fields (followUpFunnel, followUpMessages, followUpPrompts) are runtime-owned
    
    /**
     * Check regex patterns are valid and reasonable
     */
    _checkRegexPatterns(scenario) {
        const violations = [];
        const regexTriggers = scenario.regexTriggers || [];
        
        for (let i = 0; i < regexTriggers.length; i++) {
            const pattern = regexTriggers[i];
            if (!pattern) continue;
            
            // Check if it compiles
            try {
                const regex = new RegExp(pattern, 'i');
                
                // Check for overly broad patterns
                if (pattern === '.*' || pattern === '.+' || pattern === '\\w+') {
                    violations.push(this.createViolation({
                        field: `regexTriggers[${i}]`,
                        value: pattern,
                        message: 'Regex pattern is too broad - will match almost everything',
                        suggestion: 'Make the pattern more specific',
                        meta: { checkType: 'regex' }
                    }));
                }
                
                // Check for patterns without word boundaries (might over-match)
                if (!pattern.includes('\\b') && pattern.length < 10) {
                    violations.push(this.createViolation({
                        field: `regexTriggers[${i}]`,
                        value: pattern,
                        message: 'Regex lacks word boundaries (\\b) - may match unintended substrings',
                        suggestion: 'Add \\b at start and end for word boundaries',
                        meta: { checkType: 'regex' }
                    }));
                }
                
            } catch (e) {
                // Invalid regex - already caught by TriggersRule, but include here for completeness
                violations.push(this.createViolation({
                    field: `regexTriggers[${i}]`,
                    value: pattern,
                    message: `Invalid regex: ${e.message}`,
                    suggestion: 'Fix regex syntax',
                    meta: { checkType: 'regex', error: e.message }
                }));
            }
        }
        
        return violations;
    }
    
    /**
     * Check placeholder consistency across all replies
     */
    _checkPlaceholderConsistency(scenario) {
        const violations = [];
        const allReplies = [
            ...(scenario.quickReplies || []),
            ...(scenario.fullReplies || []),
            ...(scenario.quickReplies_noName || []),
            ...(scenario.fullReplies_noName || [])
        ];
        
        const foundPlaceholders = new Set();
        
        for (const reply of allReplies) {
            const text = typeof reply === 'string' ? reply : reply?.text;
            if (!text) continue;
            
            const placeholders = this.extractPlaceholders(text);
            for (const ph of placeholders) {
                foundPlaceholders.add(ph.toLowerCase());
                
                // Placeholder validation happens in PersonalizationRule (catalog-governed)
            }
        }
        
        // Check for inconsistent {callerName} vs {callerFirstName}
        if (foundPlaceholders.has('{callername}') && foundPlaceholders.has('{callerfirstname}')) {
            violations.push(this.createViolation({
                field: 'replies',
                value: 'mixed',
                message: 'Inconsistent placeholder usage: both {callerName} and {callerFirstName} used',
                suggestion: 'Use one name token consistently throughout',
                meta: { checkType: 'placeholder' }
            }));
        }
        
        return violations;
    }
    
    /**
     * Check negative triggers don't overlap with triggers
     */
    _checkNegativeTriggers(scenario) {
        const violations = [];
        const triggers = (scenario.triggers || []).map(t => t?.toLowerCase());
        const negativeTriggers = scenario.negativeTriggers || [];
        
        for (let i = 0; i < negativeTriggers.length; i++) {
            const negTrigger = (negativeTriggers[i] || '').toLowerCase();
            
            // Check if negative trigger is also a positive trigger
            if (triggers.includes(negTrigger)) {
                violations.push(this.createViolation({
                    field: `negativeTriggers[${i}]`,
                    value: negativeTriggers[i],
                    message: 'Negative trigger is also a positive trigger - will never match',
                    suggestion: 'Remove from either triggers or negativeTriggers',
                    meta: { checkType: 'negativeTrigger' }
                }));
            }
            
            // Check if negative trigger is a subset of any positive trigger
            for (const trigger of triggers) {
                if (trigger && trigger.includes(negTrigger) && trigger !== negTrigger) {
                    violations.push(this.createViolation({
                        field: `negativeTriggers[${i}]`,
                        value: negativeTriggers[i],
                        message: `Negative trigger "${negTrigger}" is substring of trigger "${trigger}" - may prevent valid matches`,
                        suggestion: 'Review negative trigger specificity',
                        meta: { checkType: 'negativeTrigger' }
                    }));
                    break;
                }
            }
        }
        
        return violations;
    }
    
    /**
     * Check cooldown is reasonable
     */
    _checkCooldown(scenario) {
        const violations = [];
        const cooldown = scenario.cooldownSeconds;
        
        if (cooldown !== undefined && cooldown !== null) {
            if (cooldown < 0) {
                violations.push(this.createViolation({
                    field: 'cooldownSeconds',
                    value: cooldown,
                    message: 'Cooldown cannot be negative',
                    suggestion: 'Set to 0 or a positive number',
                    meta: { checkType: 'cooldown' }
                }));
            }
            
            if (cooldown > 300) {
                violations.push(this.createViolation({
                    field: 'cooldownSeconds',
                    value: cooldown,
                    message: `Cooldown of ${cooldown}s (${Math.round(cooldown/60)} minutes) is very long`,
                    suggestion: 'Consider reducing cooldown - scenario might not fire when needed',
                    meta: { checkType: 'cooldown' }
                }));
            }
        }
        
        return violations;
    }
    
    /**
     * Check entity capture fields are valid
     */
    _checkEntityCapture(scenario) {
        const violations = [];
        const entityCapture = scenario.entityCapture || [];
        
        for (let i = 0; i < entityCapture.length; i++) {
            const entity = entityCapture[i];
            if (!entity) continue;
            
            const isValid = this.validEntities.some(
                valid => valid.toLowerCase() === entity.toLowerCase()
            );
            
            if (!isValid) {
                violations.push(this.createViolation({
                    field: `entityCapture[${i}]`,
                    value: entity,
                    message: `Unknown entity type: "${entity}"`,
                    suggestion: `Valid entities: ${this.validEntities.slice(0, 10).join(', ')}...`,
                    meta: { checkType: 'entityCapture', entity }
                }));
            }
        }
        
        return violations;
    }
    
    /**
     * Check reply bundles have variety
     */
    _checkReplyBundles(scenario) {
        const violations = [];
        const bundles = scenario.replyBundles;
        
        if (!bundles) return violations;
        
        // Check short replies
        if (bundles.short && Array.isArray(bundles.short)) {
            if (bundles.short.length === 1) {
                violations.push(this.createViolation({
                    field: 'replyBundles.short',
                    value: `${bundles.short.length} variant`,
                    message: 'Only 1 short reply variant - AI will sound repetitive',
                    suggestion: 'Add at least 2-3 short reply variants',
                    meta: { checkType: 'replyBundles' }
                }));
            }
            
            // Check each bundle for banned phrases
            for (let i = 0; i < bundles.short.length; i++) {
                const text = bundles.short[i]?.text;
                if (text) {
                    const banned = this.containsPhrase(text, ALL_BANNED_PHRASES);
                    if (banned) {
                        violations.push(this.createViolation({
                            field: `replyBundles.short[${i}]`,
                            value: text,
                            message: `Contains banned phrase: "${banned}"`,
                            suggestion: 'Remove banned phrase',
                            meta: { checkType: 'replyBundles', bannedPhrase: banned }
                        }));
                    }
                }
            }
        }
        
        // Check long replies
        if (bundles.long && Array.isArray(bundles.long)) {
            if (bundles.long.length === 1) {
                violations.push(this.createViolation({
                    field: 'replyBundles.long',
                    value: `${bundles.long.length} variant`,
                    message: 'Only 1 long reply variant - AI will sound repetitive',
                    suggestion: 'Add at least 2-3 long reply variants',
                    meta: { checkType: 'replyBundles' }
                }));
            }
            
            for (let i = 0; i < bundles.long.length; i++) {
                const text = bundles.long[i]?.text;
                if (text) {
                    const banned = this.containsPhrase(text, ALL_BANNED_PHRASES);
                    if (banned) {
                        violations.push(this.createViolation({
                            field: `replyBundles.long[${i}]`,
                            value: text,
                            message: `Contains banned phrase: "${banned}"`,
                            suggestion: 'Remove banned phrase',
                            meta: { checkType: 'replyBundles', bannedPhrase: banned }
                        }));
                    }
                }
            }
        }
        
        return violations;
    }
    
    /**
     * Check silence policy
     */
    _checkSilencePolicy(scenario) {
        const violations = [];
        const policy = scenario.silencePolicy;
        
        if (!policy) return violations;
        
        // Check finalWarning for banned phrases
        if (policy.finalWarning) {
            const banned = this.containsPhrase(policy.finalWarning, ALL_BANNED_PHRASES);
            if (banned) {
                violations.push(this.createViolation({
                    field: 'silencePolicy.finalWarning',
                    value: policy.finalWarning,
                    message: `Silence warning contains banned phrase: "${banned}"`,
                    suggestion: 'Remove banned phrase from silence warning',
                    meta: { checkType: 'silencePolicy', bannedPhrase: banned }
                }));
            }
        }
        
        // Check maxConsecutive is reasonable
        if (policy.maxConsecutive !== undefined) {
            if (policy.maxConsecutive < 1) {
                violations.push(this.createViolation({
                    field: 'silencePolicy.maxConsecutive',
                    value: policy.maxConsecutive,
                    message: 'maxConsecutive must be at least 1',
                    suggestion: 'Set to 2-3 for reasonable patience',
                    meta: { checkType: 'silencePolicy' }
                }));
            }
            
            if (policy.maxConsecutive > 5) {
                violations.push(this.createViolation({
                    field: 'silencePolicy.maxConsecutive',
                    value: policy.maxConsecutive,
                    message: `maxConsecutive of ${policy.maxConsecutive} is very patient - may frustrate callers`,
                    suggestion: 'Consider reducing to 2-3',
                    meta: { checkType: 'silencePolicy' }
                }));
            }
        }
        
        return violations;
    }
    
    /**
     * Check Timed Follow-Up (Auto-Prompt) settings
     */
    _checkTimedFollowUp(scenario) {
        const violations = [];
        const timedFollowUp = scenario.timedFollowUp;
        
        if (!timedFollowUp || !timedFollowUp.enabled) return violations;
        
        // Check delay is reasonable
        if (timedFollowUp.delaySeconds !== undefined) {
            if (timedFollowUp.delaySeconds < 10) {
                violations.push(this.createViolation({
                    field: 'timedFollowUp.delaySeconds',
                    value: timedFollowUp.delaySeconds,
                    message: `Delay of ${timedFollowUp.delaySeconds}s is too short - will interrupt caller`,
                    suggestion: 'Set to at least 30-60 seconds',
                    meta: { checkType: 'timedFollowUp' }
                }));
            }
            
            if (timedFollowUp.delaySeconds > 120) {
                violations.push(this.createViolation({
                    field: 'timedFollowUp.delaySeconds',
                    value: timedFollowUp.delaySeconds,
                    message: `Delay of ${timedFollowUp.delaySeconds}s (${Math.round(timedFollowUp.delaySeconds/60)} min) is very long`,
                    suggestion: 'Consider 30-60 seconds for typical calls',
                    meta: { checkType: 'timedFollowUp' }
                }));
            }
        }
        
        // Check timed follow-up messages for banned phrases
        const messages = timedFollowUp.messages || [];
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (!msg) continue;
            
            const banned = this.containsPhrase(msg, ALL_BANNED_PHRASES);
            if (banned) {
                violations.push(this.createViolation({
                    field: `timedFollowUp.messages[${i}]`,
                    value: msg,
                    message: `Timed follow-up contains banned phrase: "${banned}"`,
                    suggestion: 'Use dispatcher-style prompts like "Are you still there?" or "Hello?"',
                    meta: { checkType: 'timedFollowUp', bannedPhrase: banned }
                }));
            }
            
            // Check for chatbot-style messages
            const chatbotPhrases = ['if you need me', 'here to help', 'take your time', 'whenever you\'re ready'];
            for (const phrase of chatbotPhrases) {
                if (msg.toLowerCase().includes(phrase)) {
                    violations.push(this.createViolation({
                        field: `timedFollowUp.messages[${i}]`,
                        value: msg,
                        message: `Chatbot-style phrase: "${phrase}"`,
                        suggestion: 'Dispatchers say "Are you still there?" or "Hello?" - not supportive phrases',
                        meta: { checkType: 'timedFollowUp', chatbotPhrase: phrase }
                    }));
                    break;
                }
            }
        }
        
        return violations;
    }
    
    /**
     * Check behavior selection
     */
    _checkBehavior(scenario) {
        const violations = [];
        const behavior = scenario.behavior;
        
        if (!behavior) return violations;
        
        const lowerBehavior = behavior.toLowerCase();
        
        // Check for banned behavior keywords
        for (const keyword of this.bannedBehaviorKeywords) {
            if (lowerBehavior.includes(keyword)) {
                violations.push(this.createViolation({
                    field: 'behavior',
                    value: behavior,
                    message: `Behavior "${behavior}" contains banned keyword "${keyword}" - makes AI chatty`,
                    suggestion: 'Use: calm_professional, empathetic_reassuring, or professional_efficient',
                    meta: { checkType: 'behavior', bannedKeyword: keyword }
                }));
                break;
            }
        }
        
        return violations;
    }
    
    /**
     * Check action hooks are valid
     */
    _checkActionHooks(scenario) {
        const violations = [];
        const hooks = scenario.actionHooks || [];
        
        for (let i = 0; i < hooks.length; i++) {
            const hook = hooks[i];
            if (!hook) continue;
            
            // Check if hook looks valid (contains underscore, reasonable length)
            if (!hook.includes('_') && hook.length > 20) {
                violations.push(this.createViolation({
                    field: `actionHooks[${i}]`,
                    value: hook,
                    message: `Action hook "${hook}" looks malformed - may be concatenated hooks`,
                    suggestion: 'Separate hooks with commas (e.g., "offer_scheduling, capture_contact")',
                    meta: { checkType: 'actionHooks' }
                }));
            }
            
            // Check if it's a known hook
            const isKnown = this.validActionHooks.some(valid => 
                hook.toLowerCase().includes(valid.toLowerCase())
            );
            
            if (!isKnown && hook.length > 5) {
                // Just info, not error - custom hooks are allowed
                this.severity = SEVERITY.INFO;
                violations.push(this.createViolation({
                    field: `actionHooks[${i}]`,
                    value: hook,
                    message: `Custom action hook: "${hook}" - verify it exists`,
                    suggestion: `Common hooks: ${this.validActionHooks.slice(0, 5).join(', ')}...`,
                    meta: { checkType: 'actionHooks' }
                }));
                this.severity = SEVERITY.WARNING;
            }
        }
        
        return violations;
    }
    
    /**
     * Check channel is valid
     */
    _checkChannel(scenario) {
        const violations = [];
        const channel = scenario.channel;
        
        if (!channel) return violations;
        
        if (!this.validChannels.includes(channel.toLowerCase())) {
            violations.push(this.createViolation({
                field: 'channel',
                value: channel,
                message: `Invalid channel: "${channel}"`,
                suggestion: `Valid channels: ${this.validChannels.join(', ')}`,
                meta: { checkType: 'channel' }
            }));
        }
        
        return violations;
    }
    
    /**
     * Check minConfidence is reasonable
     */
    _checkMinConfidence(scenario) {
        const violations = [];
        const minConfidence = scenario.minConfidence;
        const scenarioType = scenario.scenarioType;
        
        if (minConfidence === undefined || minConfidence === null) return violations;
        
        // Already checked in PriorityRule, but add type-specific checks here
        
        // SMALL_TALK with high confidence is wrong
        if (scenarioType === 'SMALL_TALK' && minConfidence > 0.7) {
            violations.push(this.createViolation({
                field: 'minConfidence',
                value: minConfidence,
                message: `SMALL_TALK scenario with high confidence (${minConfidence}) - greetings should match easily`,
                suggestion: 'Lower to 0.4-0.6 for small talk',
                meta: { checkType: 'minConfidence', scenarioType }
            }));
        }
        
        // EMERGENCY with high confidence might miss urgent calls
        if (scenarioType === 'EMERGENCY' && minConfidence > 0.8) {
            violations.push(this.createViolation({
                field: 'minConfidence',
                value: minConfidence,
                message: `EMERGENCY scenario with very high confidence (${minConfidence}) may miss urgent calls`,
                suggestion: 'Lower to 0.5-0.7 to catch more emergency variations',
                meta: { checkType: 'minConfidence', scenarioType }
            }));
        }
        
        return violations;
    }
    
    /**
     * Check entity validation rules (regex patterns)
     */
    _checkEntityValidation(scenario) {
        const violations = [];
        const entityValidation = scenario.entityValidation;
        
        if (!entityValidation) return violations;
        
        // entityValidation is a Map, iterate its entries
        const entries = entityValidation instanceof Map 
            ? Array.from(entityValidation.entries())
            : Object.entries(entityValidation);
        
        for (const [entityName, rules] of entries) {
            if (!rules) continue;
            
            // Check regex pattern if present
            if (rules.pattern || rules.regex) {
                const pattern = rules.pattern || rules.regex;
                try {
                    new RegExp(pattern);
                } catch (e) {
                    violations.push(this.createViolation({
                        field: `entityValidation.${entityName}.pattern`,
                        value: pattern,
                        message: `Invalid regex pattern for ${entityName}: ${e.message}`,
                        suggestion: 'Fix the regex syntax',
                        meta: { checkType: 'entityValidation', entity: entityName }
                    }));
                }
            }
            
            // Check prompt for banned phrases
            if (rules.prompt) {
                const banned = this.containsPhrase(rules.prompt, ALL_BANNED_PHRASES);
                if (banned) {
                    violations.push(this.createViolation({
                        field: `entityValidation.${entityName}.prompt`,
                        value: rules.prompt,
                        message: `Entity prompt contains banned phrase: "${banned}"`,
                        suggestion: 'Use dispatcher-style prompts',
                        meta: { checkType: 'entityValidation', entity: entityName, bannedPhrase: banned }
                    }));
                }
            }
        }
        
        return violations;
    }
    
    /**
     * Check dynamic variables / template variables
     */
    _checkDynamicVariables(scenario) {
        const violations = [];
        const dynamicVariables = scenario.dynamicVariables;
        
        if (!dynamicVariables) return violations;
        
        const entries = dynamicVariables instanceof Map 
            ? Array.from(dynamicVariables.entries())
            : Object.entries(dynamicVariables);
        
        for (const [varName, fallbackValue] of entries) {
            if (!varName) continue;
            
            // Check variable name format
            const expectedPlaceholder = `{${varName}}`;
            const isApproved = ALLOWED_PLACEHOLDERS.some(
                ph => ph.toLowerCase() === expectedPlaceholder.toLowerCase()
            );
            
            if (!isApproved) {
                this.severity = SEVERITY.INFO;
                violations.push(this.createViolation({
                    field: `dynamicVariables.${varName}`,
                    value: fallbackValue,
                    message: `Custom variable {${varName}} - not in standard list`,
                    suggestion: `Standard variables: ${ALLOWED_PLACEHOLDERS.join(', ')}`,
                    meta: { checkType: 'dynamicVariables', variable: varName }
                }));
                this.severity = SEVERITY.WARNING;
            }
            
            // Check fallback value doesn't have banned phrases
            if (fallbackValue) {
                const banned = this.containsPhrase(fallbackValue, ALL_BANNED_PHRASES);
                if (banned) {
                    violations.push(this.createViolation({
                        field: `dynamicVariables.${varName}`,
                        value: fallbackValue,
                        message: `Fallback value contains banned phrase: "${banned}"`,
                        suggestion: 'Use neutral fallback values',
                        meta: { checkType: 'dynamicVariables', variable: varName, bannedPhrase: banned }
                    }));
                }
            }
        }
        
        return violations;
    }
    
    /**
     * Check TTS override settings
     */
    _checkTTSOverride(scenario) {
        const violations = [];
        const ttsOverride = scenario.ttsOverride;
        
        if (!ttsOverride) return violations;
        
        // Check rate is reasonable
        if (ttsOverride.rate) {
            const rate = parseFloat(ttsOverride.rate);
            if (!isNaN(rate)) {
                if (rate < 0.5) {
                    violations.push(this.createViolation({
                        field: 'ttsOverride.rate',
                        value: ttsOverride.rate,
                        message: `TTS rate ${ttsOverride.rate} is very slow - may frustrate callers`,
                        suggestion: 'Use 0.9-1.1 for natural speech',
                        meta: { checkType: 'ttsOverride' }
                    }));
                }
                if (rate > 1.5) {
                    violations.push(this.createViolation({
                        field: 'ttsOverride.rate',
                        value: ttsOverride.rate,
                        message: `TTS rate ${ttsOverride.rate} is very fast - may be hard to understand`,
                        suggestion: 'Use 0.9-1.1 for natural speech',
                        meta: { checkType: 'ttsOverride' }
                    }));
                }
            }
        }
        
        // Check pitch is reasonable
        if (ttsOverride.pitch) {
            const pitch = ttsOverride.pitch.replace('%', '').replace('+', '').replace('-', '');
            const pitchNum = parseFloat(pitch);
            if (!isNaN(pitchNum) && Math.abs(pitchNum) > 20) {
                violations.push(this.createViolation({
                    field: 'ttsOverride.pitch',
                    value: ttsOverride.pitch,
                    message: `TTS pitch ${ttsOverride.pitch} is extreme - may sound unnatural`,
                    suggestion: 'Use ±10% for subtle adjustments',
                    meta: { checkType: 'ttsOverride' }
                }));
            }
        }
        
        return violations;
    }
}

module.exports = FullScenarioRule;
