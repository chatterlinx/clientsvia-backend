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
        
        // Organize banned phrases by type for better suggestions
        this.phraseCategories = {
            chatbot: {
                phrases: CHATBOT_PHRASES,
                label: 'Chatbot language',
                suggestion: 'Remove this phrase entirely - dispatchers don\'t talk like chatbots'
            },
            helpdesk: {
                phrases: HELPDESK_PHRASES,
                label: 'Help desk language',
                suggestion: `Replace with: "${APPROVED_ACKNOWLEDGMENTS.slice(0, 3).join('" or "')}"`
            },
            troubleshooting: {
                phrases: TROUBLESHOOTING_PHRASES,
                label: 'Troubleshooting question',
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
            { name: 'fullReplies_noName', values: scenario.fullReplies_noName || [] },
            { name: 'followUpMessages', values: scenario.followUpMessages || [] },
            { name: 'followUpQuestionText', values: scenario.followUpQuestionText ? [scenario.followUpQuestionText] : [] }
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
                    }
                }
            }
        }
        
        return violations;
    }
}

module.exports = BannedPhrasesRule;
