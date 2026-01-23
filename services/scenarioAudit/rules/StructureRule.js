/**
 * StructureRule - Checks scenario structure and flow
 * 
 * Rules:
 * - Quick replies = Classification questions (diagnose the issue)
 * - Full replies = Booking momentum (schedule the service)
 * - Booking language should NOT appear in quick replies
 * - Classification questions should NOT appear in full replies
 * 
 * The dispatcher flow: CLASSIFY → BOOK
 * 
 * This is a DETERMINISTIC rule (no LLM cost).
 */

const BaseRule = require('./BaseRule');
const { BOOKING_PHRASES, SEVERITY, RULE_CATEGORIES } = require('../constants');

class StructureRule extends BaseRule {
    constructor() {
        super();
        this.id = 'structure';
        this.name = 'Response Structure Check';
        this.description = 'Ensures quick replies classify and full replies book';
        this.severity = SEVERITY.WARNING;
        this.category = RULE_CATEGORIES.STRUCTURE;
        this.costType = 'deterministic';
        this.enabledByDefault = true;
        
        // Booking phrases should NOT appear in quick replies
        this.bookingPhrases = BOOKING_PHRASES;
        
        // Scenario types that are exceptions (booking language OK in quick replies)
        this.bookingExceptions = [
            'BOOKING',
            'EMERGENCY'
        ];
    }
    
    async check(scenario, context = {}) {
        const violations = [];
        
        // Skip check for booking/emergency scenarios
        const scenarioType = scenario.scenarioType || '';
        if (this.bookingExceptions.includes(scenarioType)) {
            return violations;
        }
        
        // Check quick replies for booking language
        violations.push(...this._checkQuickRepliesForBooking(scenario));
        
        // Check for stacked acknowledgments
        violations.push(...this._checkStackedAcknowledgments(scenario));
        
        // Check for multiple questions in one reply
        violations.push(...this._checkMultipleQuestions(scenario));
        
        return violations;
    }
    
    /**
     * Booking language in quick replies = wrong structure
     */
    _checkQuickRepliesForBooking(scenario) {
        const violations = [];
        const quickReplies = scenario.quickReplies || [];
        
        for (let i = 0; i < quickReplies.length; i++) {
            const foundPhrase = this.containsPhrase(quickReplies[i], this.bookingPhrases);
            if (foundPhrase) {
                violations.push(this.createViolation({
                    field: `quickReplies[${i}]`,
                    value: quickReplies[i],
                    message: `Quick reply contains booking language: "${foundPhrase}"`,
                    suggestion: 'Quick replies should CLASSIFY (ask diagnostic questions). Move booking language to fullReplies.',
                    meta: { foundPhrase, issue: 'booking_in_quick' }
                }));
            }
        }
        
        // Also check no-name variants
        const quickRepliesNoName = scenario.quickReplies_noName || [];
        for (let i = 0; i < quickRepliesNoName.length; i++) {
            const foundPhrase = this.containsPhrase(quickRepliesNoName[i], this.bookingPhrases);
            if (foundPhrase) {
                violations.push(this.createViolation({
                    field: `quickReplies_noName[${i}]`,
                    value: quickRepliesNoName[i],
                    message: `Quick reply (no name) contains booking language: "${foundPhrase}"`,
                    suggestion: 'Quick replies should CLASSIFY. Move booking language to fullReplies_noName.',
                    meta: { foundPhrase, issue: 'booking_in_quick' }
                }));
            }
        }
        
        return violations;
    }
    
    /**
     * Stacked acknowledgments = "I understand. Alright. Let's..." (bad)
     */
    _checkStackedAcknowledgments(scenario) {
        const violations = [];
        const acknowledgments = ['i understand', 'alright', 'okay', 'got it', 'no problem'];
        
        const allReplies = [
            ...(scenario.quickReplies || []),
            ...(scenario.fullReplies || []),
            ...(scenario.quickReplies_noName || []),
            ...(scenario.fullReplies_noName || [])
        ];
        
        for (const reply of allReplies) {
            if (!reply) continue;
            const lowerReply = reply.toLowerCase();
            
            // Count how many acknowledgments appear
            let ackCount = 0;
            for (const ack of acknowledgments) {
                if (lowerReply.includes(ack)) {
                    ackCount++;
                }
            }
            
            if (ackCount > 1) {
                violations.push(this.createViolation({
                    field: 'replies',
                    value: reply,
                    message: 'Contains stacked acknowledgments (multiple "I understand" / "Alright" / "Okay")',
                    suggestion: 'Pick ONE acknowledgment, never stack. Example: "I understand. Is the unit running?"',
                    meta: { issue: 'stacked_acknowledgments', ackCount }
                }));
            }
        }
        
        return violations;
    }
    
    /**
     * Multiple questions in one reply = bad
     */
    _checkMultipleQuestions(scenario) {
        const violations = [];
        
        const allReplies = [
            ...(scenario.quickReplies || []),
            ...(scenario.fullReplies || []),
            ...(scenario.quickReplies_noName || []),
            ...(scenario.fullReplies_noName || [])
        ];
        
        for (const reply of allReplies) {
            if (!reply) continue;
            
            // Count question marks
            const questionCount = (reply.match(/\?/g) || []).length;
            
            if (questionCount > 1) {
                violations.push(this.createViolation({
                    field: 'replies',
                    value: reply,
                    message: `Contains ${questionCount} questions (should be 1 max)`,
                    suggestion: 'Ask only ONE question per response. Split into multiple scenarios if needed.',
                    meta: { issue: 'multiple_questions', questionCount }
                }));
            }
        }
        
        return violations;
    }
}

module.exports = StructureRule;
