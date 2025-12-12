/**
 * ============================================================================
 * RUNNING SUMMARY SERVICE - Conversation Memory System
 * ============================================================================
 * 
 * This is the "human brain" that makes AI feel like it's actually listening.
 * Instead of re-reading the entire transcript every turn, we maintain a
 * distilled summary of what's important.
 * 
 * THE SECRET SAUCE:
 * - Max 7 bullets, max 15 words each
 * - Updated after EVERY turn
 * - Injected into system prompt
 * - Never read aloud to caller
 * 
 * WHAT IT TRACKS:
 * - What the problem seems to be
 * - What caller has told us (name, phone, address, preferences)
 * - Urgency/emotion level
 * - Any decisions made
 * - Current conversation stage
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

class RunningSummaryService {
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SUMMARY BUILDING
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Build or update the running summary from conversation state
     * 
     * @param {Object} params
     * @param {Array} params.previousSummary - Existing summary bullets
     * @param {Object} params.customerContext - From CustomerService.buildContextForAI
     * @param {Object} params.currentTurn - { userMessage, aiResponse, extractedSlots }
     * @param {Object} params.conversationState - { phase, knownSlots, signals }
     * @param {Object} params.company - Company document for trade context
     * @returns {Array<string>} Updated summary bullets (max 7)
     */
    static buildSummary({
        previousSummary = [],
        customerContext = {},
        currentTurn = {},
        conversationState = {},
        company = {}
    }) {
        const bullets = [];
        
        // ─────────────────────────────────────────────────────────────────────
        // BULLET 1: Customer Identity
        // ─────────────────────────────────────────────────────────────────────
        if (customerContext.isKnown && customerContext.isReturning) {
            let identity = `Returning customer: ${customerContext.name || 'known'}`;
            if (customerContext.totalInteractions > 5) {
                identity += ` (${customerContext.totalInteractions} total contacts)`;
            }
            bullets.push(identity);
        } else if (customerContext.isKnown && customerContext.name) {
            bullets.push(`Customer: ${customerContext.name}`);
        } else if (conversationState.knownSlots?.name) {
            bullets.push(`Customer: ${conversationState.knownSlots.name}`);
        } else {
            bullets.push('New/unknown caller');
        }
        
        // ─────────────────────────────────────────────────────────────────────
        // BULLET 2: Recent Visit Context (Critical for callbacks)
        // ─────────────────────────────────────────────────────────────────────
        if (customerContext.hasRecentVisit && customerContext.lastVisit) {
            const lastVisit = customerContext.lastVisit;
            const daysAgo = Math.floor((Date.now() - new Date(lastVisit.date)) / (1000 * 60 * 60 * 24));
            let visitBullet = `Recent visit ${daysAgo}d ago`;
            if (lastVisit.technicianName) {
                visitBullet += ` (${lastVisit.technicianName})`;
            }
            if (lastVisit.issueDescription) {
                visitBullet += ` - ${lastVisit.issueDescription.substring(0, 30)}`;
            }
            bullets.push(visitBullet);
        }
        
        // ─────────────────────────────────────────────────────────────────────
        // BULLET 3: Current Problem/Issue
        // ─────────────────────────────────────────────────────────────────────
        const problemIndicators = this.extractProblemFromTurn(currentTurn, previousSummary);
        if (problemIndicators) {
            bullets.push(`Issue: ${problemIndicators}`);
        }
        
        // ─────────────────────────────────────────────────────────────────────
        // BULLET 4: Urgency/Emotion Level
        // ─────────────────────────────────────────────────────────────────────
        const emotionBullet = this.assessEmotion(currentTurn, conversationState);
        if (emotionBullet) {
            bullets.push(emotionBullet);
        }
        
        // ─────────────────────────────────────────────────────────────────────
        // BULLET 5: Preferences/Requests
        // ─────────────────────────────────────────────────────────────────────
        const preferences = [];
        if (customerContext.preferredTechnician) {
            preferences.push(`wants ${customerContext.preferredTechnician}`);
        }
        if (conversationState.knownSlots?.preferredTech) {
            preferences.push(`requested ${conversationState.knownSlots.preferredTech}`);
        }
        if (customerContext.preferredTime) {
            preferences.push(`prefers ${customerContext.preferredTime}`);
        }
        if (conversationState.knownSlots?.time) {
            preferences.push(`wants ${conversationState.knownSlots.time}`);
        }
        if (preferences.length > 0) {
            bullets.push(`Preferences: ${preferences.join(', ')}`);
        }
        
        // ─────────────────────────────────────────────────────────────────────
        // BULLET 6: Collected Info Summary
        // ─────────────────────────────────────────────────────────────────────
        const collected = [];
        const slots = conversationState.knownSlots || {};
        if (slots.name) collected.push('name');
        if (slots.phone) collected.push('phone');
        if (slots.address) collected.push('address');
        if (slots.time) collected.push('time');
        if (slots.serviceType) collected.push(slots.serviceType);
        
        if (collected.length > 0) {
            bullets.push(`Collected: ${collected.join(', ')}`);
        }
        
        // ─────────────────────────────────────────────────────────────────────
        // BULLET 7: Current Stage/Next Step
        // ─────────────────────────────────────────────────────────────────────
        const phase = conversationState.phase || 'discovery';
        const stageBullet = this.getStageDescription(phase, conversationState);
        bullets.push(stageBullet);
        
        // ─────────────────────────────────────────────────────────────────────
        // PRESERVE IMPORTANT CONTEXT FROM PREVIOUS SUMMARY
        // ─────────────────────────────────────────────────────────────────────
        // Look for important bullets in previous summary that we shouldn't lose
        for (const prev of previousSummary) {
            // Keep callback status
            if (prev.toLowerCase().includes('callback') && !bullets.some(b => b.includes('callback'))) {
                bullets.push(prev);
            }
            // Keep VIP status
            if (prev.toLowerCase().includes('vip') && !bullets.some(b => b.includes('vip'))) {
                bullets.push(prev);
            }
            // Keep special instructions
            if (prev.toLowerCase().includes('instruction') || prev.toLowerCase().includes('note:')) {
                if (!bullets.some(b => b.includes(prev.substring(0, 20)))) {
                    bullets.push(prev);
                }
            }
        }
        
        // Limit to 7 bullets, prioritize first 7
        return bullets.slice(0, 7);
    }
    
    /**
     * Extract problem description from the current turn
     */
    static extractProblemFromTurn(currentTurn, previousSummary) {
        const userMessage = currentTurn.userMessage?.toLowerCase() || '';
        
        // Check for problem keywords
        const problemPatterns = [
            { pattern: /leak/i, label: 'leak' },
            { pattern: /not (cooling|working|heating)/i, label: 'not working' },
            { pattern: /broken/i, label: 'broken' },
            { pattern: /noise|sound/i, label: 'making noise' },
            { pattern: /water/i, label: 'water issue' },
            { pattern: /hot|warm/i, label: 'not cooling' },
            { pattern: /cold/i, label: 'not heating' },
            { pattern: /smell/i, label: 'smell issue' },
            { pattern: /emergency/i, label: 'EMERGENCY' },
            { pattern: /pain/i, label: 'pain issue' }, // dental
            { pattern: /appointment|schedule|book/i, label: 'wants to schedule' }
        ];
        
        for (const { pattern, label } of problemPatterns) {
            if (pattern.test(userMessage)) {
                return label;
            }
        }
        
        // Check if previous summary has a problem we should preserve
        const prevProblem = previousSummary.find(b => b.toLowerCase().startsWith('issue:'));
        if (prevProblem) {
            return prevProblem.replace('Issue: ', '');
        }
        
        return null;
    }
    
    /**
     * Assess emotional state from conversation
     */
    static assessEmotion(currentTurn, conversationState) {
        const userMessage = currentTurn.userMessage?.toLowerCase() || '';
        const signals = conversationState.signals || {};
        
        // Check for frustration signals
        if (signals.frustrated || 
            /frustrated|annoyed|angry|upset|ridiculous|unacceptable/i.test(userMessage)) {
            return 'Tone: frustrated - handle with care';
        }
        
        // Check for urgency
        if (signals.urgent || 
            /urgent|emergency|asap|immediately|right now|can\'t wait/i.test(userMessage)) {
            return 'Urgency: HIGH - prioritize';
        }
        
        // Check for stress
        if (/worried|concerned|nervous|scared/i.test(userMessage)) {
            return 'Tone: anxious - reassure';
        }
        
        // Check for callback frustration (common pattern)
        if (/again|still|already|just (came|was|were)/i.test(userMessage)) {
            return 'Likely callback - may be frustrated about repeat issue';
        }
        
        return null;
    }
    
    /**
     * Get human-readable stage description
     */
    static getStageDescription(phase, conversationState) {
        const slots = conversationState.knownSlots || {};
        
        switch (phase.toLowerCase()) {
            case 'discovery':
                return 'Stage: Understanding the problem';
            case 'decision':
                return 'Stage: Confirming they want to book';
            case 'booking':
                const missing = [];
                if (!slots.name) missing.push('name');
                if (!slots.phone) missing.push('phone');
                if (!slots.address) missing.push('address');
                if (!slots.time) missing.push('time');
                if (missing.length > 0) {
                    return `Stage: Booking - need ${missing.join(', ')}`;
                }
                return 'Stage: Confirming booking details';
            case 'complete':
                return 'Stage: Booking complete';
            default:
                return `Stage: ${phase}`;
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // PROMPT FORMATTING
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Format summary for injection into system prompt
     * 
     * @param {Array<string>} summary - Summary bullets
     * @returns {string} Formatted prompt section
     */
    static formatForPrompt(summary) {
        if (!summary || summary.length === 0) {
            return '';
        }
        
        return `
═══════════════════════════════════════════════════════════════════════════════
RUNNING CALL SUMMARY (DO NOT READ ALOUD - Internal context only)
═══════════════════════════════════════════════════════════════════════════════
${summary.map(bullet => `• ${bullet}`).join('\n')}
═══════════════════════════════════════════════════════════════════════════════
Use this context to give relevant, personalized responses. Never repeat questions
about information already noted above.
`;
    }
    
    /**
     * Build complete summary for AI including customer context
     * This is the main method called before each AI turn
     * 
     * @param {Object} params
     * @returns {string} Formatted prompt section ready for injection
     */
    static buildAndFormat(params) {
        const summary = this.buildSummary(params);
        return {
            bullets: summary,
            formatted: this.formatForPrompt(summary)
        };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITY METHODS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Detect if this appears to be a callback (recent visit + new issue)
     */
    static detectCallback(customerContext, currentTurn) {
        if (!customerContext.hasRecentVisit) return false;
        
        const userMessage = currentTurn.userMessage?.toLowerCase() || '';
        
        // Keywords that suggest callback
        const callbackIndicators = [
            /just (here|came|was|were|visited)/i,
            /yesterday|today|this morning|last week/i,
            /again|still|same (problem|issue)/i,
            /didn\'t (work|fix|help)/i,
            /came back|returned/i
        ];
        
        return callbackIndicators.some(pattern => pattern.test(userMessage));
    }
    
    /**
     * Extract any new information from the user's message
     * This helps update the customer profile over time
     */
    static extractInfoFromMessage(userMessage) {
        const extracted = {};
        
        // Try to extract phone number
        const phoneMatch = userMessage.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/);
        if (phoneMatch) {
            extracted.phone = phoneMatch[1];
        }
        
        // Try to extract name (after common patterns)
        const namePatterns = [
            /(?:my name is|this is|i'm|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
            /(?:name'?s?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i
        ];
        for (const pattern of namePatterns) {
            const match = userMessage.match(pattern);
            if (match) {
                extracted.name = match[1];
                break;
            }
        }
        
        // Try to extract technician preference
        const techPatterns = [
            /(?:can|want|prefer|request)\s+([A-Z][a-z]+)\s+(?:to come|again|back)/i,
            /(?:send|have)\s+([A-Z][a-z]+)\s+(?:come|back)/i
        ];
        for (const pattern of techPatterns) {
            const match = userMessage.match(pattern);
            if (match) {
                extracted.preferredTechnician = match[1];
                break;
            }
        }
        
        // Try to extract time preference
        const timePatterns = [
            /(?:morning|afternoon|evening)/i,
            /(?:\d{1,2}(?::\d{2})?\s*(?:am|pm))/i,
            /(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i
        ];
        for (const pattern of timePatterns) {
            const match = userMessage.match(pattern);
            if (match) {
                extracted.preferredTime = match[0].toLowerCase();
                break;
            }
        }
        
        return extracted;
    }
}

module.exports = RunningSummaryService;

