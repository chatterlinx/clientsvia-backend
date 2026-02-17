/**
 * ════════════════════════════════════════════════════════════════════════════
 * CALL REASON EXTRACTOR (S5)
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * Extracts the caller's reason/problem from their utterance.
 * This is a simple pattern-based extractor - no LLM needed.
 * 
 * Examples:
 *   "My AC isn't cooling" → "AC isn't cooling"
 *   "The heater is broken" → "heater is broken"
 *   "It's 90 degrees in my house" → "90 degrees in house"
 * 
 * Config: frontDeskBehavior (industry-specific patterns can be added)
 * 
 * ════════════════════════════════════════════════════════════════════════════
 */

// Problem indicator patterns - these suggest the caller is describing an issue
const PROBLEM_PATTERNS = [
    // HVAC-specific problems
    /(?:my\s+)?(?:ac|a\.?c\.?|air\s*condition(?:er|ing)?)\s+(?:is\s+)?(?:not\s+)?(\w+ing|\w+ed|broken|down|out)/i,
    /(?:my\s+)?(?:heat(?:er|ing)?|furnace)\s+(?:is\s+)?(?:not\s+)?(\w+ing|\w+ed|broken|down|out)/i,
    /(?:my\s+)?(?:unit|system)\s+(?:is\s+)?(?:not\s+)?(\w+ing|\w+ed|broken|down|out)/i,
    
    // Temperature problems
    /(?:it'?s?\s+)?(\d+)\s*degrees/i,
    /(?:too\s+)?(hot|cold|warm|freezing)/i,
    
    // General service problems
    /(?:not\s+)?(?:working|cooling|heating|running|turning\s+on)/i,
    /(?:is\s+)?(?:broken|leaking|making\s+noise|frozen)/i,
    
    // Water/plumbing (if applicable)
    /(?:no\s+)?(?:hot\s+)?water/i,
    /(?:leak(?:ing)?|flood(?:ing)?|clog(?:ged)?|drain)/i
];

// Strong negative/problem phrases that should beat "was working" style clauses.
const STRONG_NEGATIVE_PHRASES = [
    /\bnot\s+cool(?:ing)?\b/i,
    /\bisn'?t\s+cool(?:ing)?\b/i,
    /\bwon'?t\s+cool\b/i,
    /\bnot\s+heat(?:ing)?\b/i,
    /\bisn'?t\s+heat(?:ing)?\b/i,
    /\bnot\s+work(?:ing)?\b/i,
    /\bisn'?t\s+work(?:ing)?\b/i,
    /\bwon'?t\s+work\b/i,
    /\bbroken\b/i,
    /\bdown\b/i,
    /\bout\b/i,
    /\bstopped\b/i,
    /\bleak(?:ing)?\b/i,
    /\bfrozen\b/i,
    /\bmaking\s+noise\b/i,
    /\bno\s+(?:hot\s+)?water\b/i
];

// Clauses that often appear but are not the problem (must be de-prioritized).
const DEPRIORITIZED_CLAUSES = [
    /\bwas\s+working\b/i,
    /\bworking\s+fine\b/i,
    /\bused\s+to\s+work\b/i
];

const SUBJECT_HINTS = [
    { re: /\b(?:ac|a\.?c\.?|air\s*condition(?:er|ing)?)\b/i, label: 'AC' },
    { re: /\b(?:heater|heating|furnace)\b/i, label: 'heater' },
    { re: /\b(?:unit|system)\b/i, label: 'system' },
    { re: /\bwater\s*heater\b/i, label: 'water heater' },
    { re: /\bdrain\b/i, label: 'drain' }
];

function normalize(text = '') {
    // Expand common contractions to help regex matching.
    return `${text}`
        .replace(/\bit'?s\b/gi, 'it is')
        .replace(/\bcan'?t\b/gi, 'can not')
        .replace(/\bwon'?t\b/gi, 'will not')
        .replace(/\bisn'?t\b/gi, 'is not')
        .replace(/\baren'?t\b/gi, 'are not')
        .replace(/\s+/g, ' ')
        .trim();
}

function pickSubject(text) {
    for (const { re, label } of SUBJECT_HINTS) {
        if (re.test(text)) return label;
    }
    return null;
}

function buildReason({ subject, phrase }) {
    const p = `${phrase || ''}`.trim();
    if (!p) return null;
    if (!subject) return p;
    const lower = p.toLowerCase();
    const subjLower = subject.toLowerCase();
    if (lower.startsWith(subjLower)) return p;
    // If phrase is "not cooling", prefer "system not cooling" when we have a subject.
    if (/^(not|is not|will not)\s+/.test(lower)) return `${subject} ${p.replace(/^is\s+not\s+/i, 'not ').replace(/^will\s+not\s+/i, 'not ')}`;
    return `${subject} ${p}`;
}

/**
 * Extract the call reason from user input
 * Returns a short summary of the problem, or null if no problem detected
 * 
 * @param {string} text - User's utterance
 * @returns {string|null} Short problem summary or null
 */
function extract(text) {
    if (!text || text.length < 10) return null;

    const normalized = normalize(text);
    const textLower = normalized.toLowerCase();
    
    // Skip if this is just a greeting or confirmation
    if (/^(yes|no|yeah|yep|nope|ok|okay|sure|hi|hello|good\s+(morning|afternoon|evening))[\s.,!?]*$/i.test(text.trim())) {
        return null;
    }
    
    // Look for problem indicators
    let hasProblem = false;
    for (const pattern of PROBLEM_PATTERNS) {
        if (pattern.test(textLower)) {
            hasProblem = true;
            break;
        }
    }
    
    if (!hasProblem) return null;
    
    // ───────────────────────────────────────────────────────────────────────────
    // Enterprise extraction strategy:
    // - Prefer strong negative/problem clauses (e.g., "not cooling") over
    //   "was working" clauses that often precede the real problem.
    // - When the utterance contains contrast (e.g., "but now"), bias toward
    //   the later clause.
    // ───────────────────────────────────────────────────────────────────────────
    const subject = pickSubject(normalized);
    const clauses = normalized
        .split(/\b(?:but|however|though|now|suddenly|all\s+of\s+a\s+sudden)\b/gi)
        .map((c) => `${c}`.trim())
        .filter(Boolean);

    const candidates = [];

    for (let idx = 0; idx < clauses.length; idx += 1) {
        const clause = clauses[idx];
        const clauseLower = clause.toLowerCase();
        const positionBonus = idx === clauses.length - 1 ? 10 : 0; // later clause tends to hold the actual problem
        const deprioritized = DEPRIORITIZED_CLAUSES.some((re) => re.test(clause));

        // Strong negative phrases first.
        for (const re of STRONG_NEGATIVE_PHRASES) {
            const m = clause.match(re);
            if (m) {
                const phrase = m[0];
                const reason = buildReason({ subject, phrase });
                candidates.push({
                    reason,
                    score: 100 + positionBonus + (deprioritized ? -50 : 0)
                });
                break; // one strong phrase is enough per clause
            }
        }

        // Temperature mention is a weak/secondary signal.
        const tempMatch = clause.match(/(?:it\s+is\s+)?(\d+)\s*degrees/i);
        if (tempMatch) {
            candidates.push({
                reason: `${tempMatch[1]} degrees`,
                score: 40 + positionBonus + (deprioritized ? -50 : 0)
            });
        }
    }

    // Pick best candidate if any.
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0]?.reason ? `${candidates[0].reason}`.trim() : null;
    if (best) {
        // Avoid returning non-problem framing like "system was working" unless it's the only option.
        if (DEPRIORITIZED_CLAUSES.some((re) => re.test(best)) && candidates.length > 1) {
            const nextBest = candidates.find((c) => c.reason && !DEPRIORITIZED_CLAUSES.some((re) => re.test(c.reason)));
            if (nextBest?.reason) return nextBest.reason.trim().slice(0, 60);
        }
        return best.slice(0, 60);
    }
    
    // If we detected a problem but didn't extract a strong candidate,
    // fall back to a safe generic summary.
    return subject ? `${subject} issue` : 'service issue';
}

module.exports = {
    extract,
    PROBLEM_PATTERNS
};
