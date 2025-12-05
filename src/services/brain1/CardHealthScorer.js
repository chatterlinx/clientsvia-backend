/**
 * ============================================================================
 * CARD HEALTH SCORER - BRAIN-1 QUALITY GATE
 * ============================================================================
 * 
 * Prevents "empty shell" triage cards from winning high-confidence matches.
 * A card with just an opening line and no real flow should NOT be allowed
 * to handle the entire turn.
 * 
 * MULTI-TENANT SAFE: Evaluates card structure, not content.
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');

/**
 * Calculate a health score for a triage card/scenario
 * 
 * Higher score = more complete, safer to use as primary handler
 * 
 * @param {Object} card - The triage card or scenario object
 * @returns {Object} - { score: number, reasons: string[], isHealthy: boolean }
 */
function calculateHealthScore(card) {
    if (!card) {
        return { score: 0, reasons: ['Card is null'], isHealthy: false };
    }
    
    let score = 0;
    const reasons = [];
    
    // ════════════════════════════════════════════════════════════════════════════
    // CONTENT CHECKS
    // ════════════════════════════════════════════════════════════════════════════
    
    // 1. Has opening line (basic requirement)
    const openingLine = card.response || card.openingLine || 
                        card.frontlinePlaybook?.openingLine || '';
    if (openingLine && openingLine.length >= 20) {
        score += 1;
        reasons.push('Has opening line (20+ chars)');
    }
    
    // 2. Has substantive response content (not just a one-liner)
    if (openingLine.length >= 100) {
        score += 1;
        reasons.push('Has substantive content (100+ chars)');
    }
    
    // 3. Has questions or steps defined
    const questions = card.questions || card.frontlinePlaybook?.questions || [];
    const steps = card.steps || card.frontlinePlaybook?.steps || [];
    if (questions.length >= 1 || steps.length >= 1) {
        score += 2; // This is important
        reasons.push(`Has ${questions.length} questions, ${steps.length} steps`);
    }
    
    // 4. Has a defined next action (booking, transfer, escalation)
    const hasBookingAction = card.routing === 'BOOK' || card.routing === 'SCHEDULE' ||
                             card.action === 'BOOK' || card.action === 'SCHEDULE';
    const hasTransferAction = card.routing === 'TRANSFER' || card.action === 'TRANSFER' ||
                              card.transferTarget || card.frontlinePlaybook?.transferTo;
    const hasEscalation = card.escalationPath || card.frontlinePlaybook?.escalation;
    
    if (hasBookingAction || hasTransferAction || hasEscalation) {
        score += 1;
        reasons.push('Has defined next action');
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // KEYWORD/TRIGGER QUALITY
    // ════════════════════════════════════════════════════════════════════════════
    
    // 5. Has specific keywords (not just generic synonyms)
    const triggers = card.triggers || card.quickRuleConfig?.keywordsMustHave || [];
    const synonyms = card.synonyms || card.quickRuleConfig?.keywordsShouldHave || [];
    
    if (triggers.length >= 2) {
        score += 1;
        reasons.push(`Has ${triggers.length} specific triggers`);
    }
    
    // 6. Penalize cards with only 1-word generic triggers
    const hasOnlyGenericTriggers = triggers.length <= 1 && 
        triggers.every(t => t.split(/\s+/).length === 1 && t.length < 10);
    if (hasOnlyGenericTriggers && triggers.length > 0) {
        score -= 1;
        reasons.push('Has only generic single-word triggers');
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // HEALTH THRESHOLD
    // ════════════════════════════════════════════════════════════════════════════
    
    // A card is "healthy" if it scores >= 2
    // This means it has at least:
    // - An opening line + one other thing (questions, steps, action, etc.)
    const isHealthy = score >= 2;
    
    return { 
        score: Math.max(0, score), // Don't go negative
        reasons, 
        isHealthy,
        cardName: card.name || card.triageLabel || card.title || 'Unknown'
    };
}

/**
 * Quick check if a card is healthy enough to be a primary handler
 * 
 * @param {Object} card - The triage card or scenario
 * @returns {boolean}
 */
function isCardHealthy(card) {
    return calculateHealthScore(card).isHealthy;
}

/**
 * Log health scores for debugging
 * 
 * @param {Object[]} cards - Array of cards to evaluate
 * @param {string} context - Context string for logging
 */
function logCardHealthReport(cards, context = '') {
    const results = cards.map(card => {
        const health = calculateHealthScore(card);
        return {
            name: health.cardName,
            score: health.score,
            healthy: health.isHealthy
        };
    });
    
    const healthyCount = results.filter(r => r.healthy).length;
    const unhealthyCount = results.length - healthyCount;
    
    logger.info('[CARD HEALTH] 📊 Report', {
        context,
        total: results.length,
        healthy: healthyCount,
        unhealthy: unhealthyCount,
        sample: results.slice(0, 5)
    });
    
    return { results, healthyCount, unhealthyCount };
}

module.exports = {
    calculateHealthScore,
    isCardHealthy,
    logCardHealthReport
};

