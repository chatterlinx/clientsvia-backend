/**
 * BannedPhrasesRule - Checks for chatbot/help desk language
 * 
 * Dispatchers don't say:
 * - "Got it" / "No problem" / "Absolutely" (help desk)
 * - "We're here to help" / "Thank you for reaching out" (chatbot)
 * - "Have you checked..." / "Have you tried..." (troubleshooting)
 * 
 * This is a DETERMINISTIC rule (no LLM cost).
 */

const BaseRule = require('./BaseRule');
const {
    CHATBOT_PHRASES,
    HELPDESK_PHRASES,
    TROUBLESHOOTING_PHRASES,
    SEVERITY,
    RULE_CATEGORIES,
    APPROVED_ACKNOWLEDGMENTS
} = require('../constants');

class BannedPhrasesRule extends BaseRule {
    constructor() {
        super();
        this.id = 'banned-phrases';
        this.name = 'Banned Phrases Check';
        this.description = 'Detects chatbot, help desk, and troubleshooting language that breaks dispatcher persona';
        this.severity = SEVERITY.ERROR;
        this.category = RULE_CATEGORIES.TONE;
        this.costType = 'deterministic';
        this.enabledByDefault = true;
        
        // ════════════════════════════════════════════════════════════════════════════════
        // SEVERITY LEVELS BY PHRASE TYPE:
        // - Chatbot phrases = ERROR (sounds like AI, breaks persona)
        // - Help desk phrases = WARNING (style issue, not fatal)
        // - Troubleshooting phrases = ERROR (wrong role, technician's job)
        // ════════════════════════════════════════════════════════════════════════════════
        this.phraseCategories = {
            chatbot: {
                phrases: CHATBOT_PHRASES,
                label: 'Chatbot language',
                severity: SEVERITY.ERROR,  // ERROR - breaks dispatcher persona
                suggestion: 'Remove this phrase entirely - dispatchers don\'t talk like chatbots'
            },
            helpdesk: {
                phrases: HELPDESK_PHRASES,
                label: 'Help desk language',
                severity: SEVERITY.WARNING,  // WARNING - style issue, not fatal
                suggestion: `Replace with: "${APPROVED_ACKNOWLEDGMENTS.slice(0, 3).join('" or "')}"`
            },
            troubleshooting: {
                phrases: TROUBLESHOOTING_PHRASES,
                label: 'Troubleshooting question',
                severity: SEVERITY.ERROR,  // ERROR - wrong role
                suggestion: 'Remove - troubleshooting is the technician\'s job, not the dispatcher\'s'
            }
        };
    }
    
    async check(scenario, context = {}) {
        const violations = [];
        
        // Fields to check for banned phrases
        const fieldsToCheck = [
            { name: 'quickReplies', values: scenario.quickReplies || [] },
            { name: 'fullReplies', values: scenario.fullReplies || [] },
            { name: 'quickReplies_noName', values: scenario.quickReplies_noName || [] },
            { name: 'fullReplies_noName', values: scenario.fullReplies_noName || [] }
        ];
        
        for (const field of fieldsToCheck) {
            for (let i = 0; i < field.values.length; i++) {
                const value = field.values[i];
                if (!value) continue;
                
                // Check each category of banned phrases
                for (const [categoryKey, categoryData] of Object.entries(this.phraseCategories)) {
                    const foundPhrase = this.containsPhrase(value, categoryData.phrases);
                    if (foundPhrase) {
                        const fieldPath = field.values.length > 1 
                            ? `${field.name}[${i}]` 
                            : field.name;
                        
                        // Use category-specific severity (help desk = warning, chatbot/troubleshooting = error)
                        const originalSeverity = this.severity;
                        this.severity = categoryData.severity || SEVERITY.ERROR;
                        
                        violations.push(this.createViolation({
                            field: fieldPath,
                            value: value,
                            message: `Contains ${categoryData.label}: "${foundPhrase}"`,
                            suggestion: categoryData.suggestion,
                            meta: {
                                phraseCategory: categoryKey,
                                foundPhrase: foundPhrase
                            }
                        }));
                        
                        // Restore original severity
                        this.severity = originalSeverity;
                    }
                }
            }
        }
        
        return violations;
    }
}

module.exports = BannedPhrasesRule;
