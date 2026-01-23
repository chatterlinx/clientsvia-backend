/**
 * ResponseLengthRule - Checks response word counts
 * 
 * Rules:
 * - Quick replies: Max 20 words
 * - Full replies: Max 25 words
 * - Acknowledgments: Max 3 words
 * 
 * Dispatchers are efficient - every word moves toward resolution.
 * 
 * This is a DETERMINISTIC rule (no LLM cost).
 */

const BaseRule = require('./BaseRule');
const { RESPONSE_LIMITS, SEVERITY, RULE_CATEGORIES } = require('../constants');

class ResponseLengthRule extends BaseRule {
    constructor() {
        super();
        this.id = 'response-length';
        this.name = 'Response Length Check';
        this.description = 'Ensures responses are concise and dispatcher-appropriate';
        this.severity = SEVERITY.WARNING;
        this.category = RULE_CATEGORIES.STRUCTURE;
        this.costType = 'deterministic';
        this.enabledByDefault = true;
    }
    
    async check(scenario, context = {}) {
        const violations = [];
        
        // Check quick replies
        const quickReplies = scenario.quickReplies || [];
        for (let i = 0; i < quickReplies.length; i++) {
            const wordCount = this.countWords(quickReplies[i]);
            if (wordCount > RESPONSE_LIMITS.quickReply.maxWords) {
                violations.push(this.createViolation({
                    field: `quickReplies[${i}]`,
                    value: quickReplies[i],
                    message: `Quick reply is ${wordCount} words (max ${RESPONSE_LIMITS.quickReply.maxWords})`,
                    suggestion: 'Shorten to under 20 words - remove filler, get to the point',
                    meta: { wordCount, limit: RESPONSE_LIMITS.quickReply.maxWords }
                }));
            }
        }
        
        // Check quick replies (no name variants)
        const quickRepliesNoName = scenario.quickReplies_noName || [];
        for (let i = 0; i < quickRepliesNoName.length; i++) {
            const wordCount = this.countWords(quickRepliesNoName[i]);
            if (wordCount > RESPONSE_LIMITS.quickReply.maxWords) {
                violations.push(this.createViolation({
                    field: `quickReplies_noName[${i}]`,
                    value: quickRepliesNoName[i],
                    message: `Quick reply (no name) is ${wordCount} words (max ${RESPONSE_LIMITS.quickReply.maxWords})`,
                    suggestion: 'Shorten to under 20 words',
                    meta: { wordCount, limit: RESPONSE_LIMITS.quickReply.maxWords }
                }));
            }
        }
        
        // Check full replies
        const fullReplies = scenario.fullReplies || [];
        for (let i = 0; i < fullReplies.length; i++) {
            const wordCount = this.countWords(fullReplies[i]);
            if (wordCount > RESPONSE_LIMITS.fullReply.maxWords) {
                violations.push(this.createViolation({
                    field: `fullReplies[${i}]`,
                    value: fullReplies[i],
                    message: `Full reply is ${wordCount} words (max ${RESPONSE_LIMITS.fullReply.maxWords})`,
                    suggestion: 'Shorten to under 25 words - dispatchers are efficient',
                    meta: { wordCount, limit: RESPONSE_LIMITS.fullReply.maxWords }
                }));
            }
        }
        
        // Check full replies (no name variants)
        const fullRepliesNoName = scenario.fullReplies_noName || [];
        for (let i = 0; i < fullRepliesNoName.length; i++) {
            const wordCount = this.countWords(fullRepliesNoName[i]);
            if (wordCount > RESPONSE_LIMITS.fullReply.maxWords) {
                violations.push(this.createViolation({
                    field: `fullReplies_noName[${i}]`,
                    value: fullRepliesNoName[i],
                    message: `Full reply (no name) is ${wordCount} words (max ${RESPONSE_LIMITS.fullReply.maxWords})`,
                    suggestion: 'Shorten to under 25 words',
                    meta: { wordCount, limit: RESPONSE_LIMITS.fullReply.maxWords }
                }));
            }
        }
        
        // Check follow-up messages
        const followUpMessages = scenario.followUpMessages || [];
        for (let i = 0; i < followUpMessages.length; i++) {
            const wordCount = this.countWords(followUpMessages[i]);
            if (wordCount > RESPONSE_LIMITS.quickReply.maxWords) {
                violations.push(this.createViolation({
                    field: `followUpMessages[${i}]`,
                    value: followUpMessages[i],
                    message: `Follow-up message is ${wordCount} words (max ${RESPONSE_LIMITS.quickReply.maxWords})`,
                    suggestion: 'Keep follow-ups short and direct',
                    meta: { wordCount, limit: RESPONSE_LIMITS.quickReply.maxWords }
                }));
            }
        }
        
        return violations;
    }
}

module.exports = ResponseLengthRule;
