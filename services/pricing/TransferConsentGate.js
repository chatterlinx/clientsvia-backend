/**
 * ============================================================================
 * TRANSFER CONSENT GATE
 * ============================================================================
 *
 * Enforces explicit consent before any call transfer occurs.
 * The gate only activates when a transfer offer is pending.
 */

const AFFIRMATIVE_PATTERNS = [
    /^yes\b/,
    /^yeah\b/,
    /^yep\b/,
    /^sure\b/,
    /^ok\b/,
    /^okay\b/,
    /^please\b/,
    /^go ahead\b/,
    /^sounds good\b/,
    /^absolutely\b/,
    /^definitely\b/,
    /^that works\b/,
    /^please do\b/,
    /^transfer me\b/,
    /^connect me\b/,
    /^yes please\b/
];

const NEGATIVE_PATTERNS = [
    /^no\b/,
    /^nope\b/,
    /^nah\b/,
    /^not now\b/,
    /^not today\b/,
    /^no thanks\b/,
    /^no thank you\b/,
    /^don\'t\b/,
    /^do not\b/,
    /^rather not\b/,
    /^not really\b/
];

const MAX_CONSENT_WORDS = 8;

function normalizeInput(text) {
    return String(text || '').toLowerCase().trim();
}

function isShortUtterance(text) {
    if (!text) return false;
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    return wordCount > 0 && wordCount <= MAX_CONSENT_WORDS;
}

function matchPatterns(text, patterns) {
    return patterns.some(pattern => pattern.test(text));
}

function detectConsentDecision(userText) {
    const normalized = normalizeInput(userText);
    if (!normalized) {
        return { decision: 'none', reason: 'empty_input' };
    }

    if (matchPatterns(normalized, NEGATIVE_PATTERNS)) {
        return { decision: 'decline', reason: 'explicit_no' };
    }

    if (isShortUtterance(normalized) && matchPatterns(normalized, AFFIRMATIVE_PATTERNS)) {
        return { decision: 'accept', reason: 'explicit_yes' };
    }

    return { decision: 'none', reason: 'no_explicit_consent' };
}

function canTransferCall({ userText, transferOfferPending }) {
    if (!transferOfferPending) {
        return {
            allowed: false,
            decision: 'none',
            reason: 'no_pending_offer'
        };
    }

    const decision = detectConsentDecision(userText);

    return {
        allowed: decision.decision === 'accept',
        decision: decision.decision,
        reason: decision.reason
    };
}

module.exports = {
    canTransferCall,
    detectConsentDecision
};
