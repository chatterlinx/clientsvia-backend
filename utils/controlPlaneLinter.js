/**
 * ============================================================================
 * CONTROL PLANE LINTER - Copy Performance & Quality Checker
 * ============================================================================
 * 
 * PURPOSE: Enforce copy quality and performance constraints
 * 
 * CHECKS:
 * - Greeting < 25 words (warning), < 35 words (hard fail if voice)
 * - No repeated phrases
 * - No robotic filler like "Got it, what's going on — is it not cooling…"
 * - Contains at least one: empathy line OR direct action line
 * - Placeholder correctness (standardize to {{companyName}} etc.)
 * 
 * OUTPUT:
 * - Performance Score: 0-100
 * - Fix Suggestions: specific, actionable
 * - Grade: A-F
 * 
 * ============================================================================
 */

const { extractPlaceholders, validatePlaceholders, normalizeKey } = require('./placeholderStandard');

// ═══════════════════════════════════════════════════════════════════════════
// LINT RULES
// ═══════════════════════════════════════════════════════════════════════════

const LINT_RULES = {
    // ─────────────────────────────────────────────────────────────────────────
    // WORD COUNT RULES
    // ─────────────────────────────────────────────────────────────────────────
    GREETING_MAX_WORDS_25: {
        id: 'GREETING_MAX_WORDS_25',
        severity: 'warning',
        penalty: 10,
        description: 'Greeting should be under 25 words for optimal TTS performance',
        check: (text) => {
            const words = countWords(text);
            return words <= 25;
        },
        suggestion: (text) => {
            const words = countWords(text);
            return `Greeting has ${words} words. Reduce to under 25 for ~2.5s TTS.`;
        }
    },
    
    GREETING_MAX_WORDS_35: {
        id: 'GREETING_MAX_WORDS_35',
        severity: 'error',
        penalty: 25,
        description: 'Greeting MUST be under 35 words for voice',
        check: (text) => {
            const words = countWords(text);
            return words <= 35;
        },
        suggestion: (text) => {
            const words = countWords(text);
            return `Greeting has ${words} words. MUST reduce to under 35 for voice.`;
        }
    },
    
    BOOKING_QUESTION_MAX_15: {
        id: 'BOOKING_QUESTION_MAX_15',
        severity: 'warning',
        penalty: 5,
        description: 'Booking questions should be under 15 words',
        check: (text) => countWords(text) <= 15,
        suggestion: (text) => `Question has ${countWords(text)} words. Keep under 15 for clarity.`
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // FILLER & ROBOTIC PATTERNS
    // ─────────────────────────────────────────────────────────────────────────
    NO_FILLER_PHRASES: {
        id: 'NO_FILLER_PHRASES',
        severity: 'warning',
        penalty: 8,
        description: 'Avoid filler phrases that waste time',
        patterns: [
            /\bgot it\b/i,
            /\bum\b/i,
            /\buh\b/i,
            /\bso,?\s/i,
            /\bwell,?\s/i,
            /\bbasically\b/i,
            /\byou know\b/i,
            /\bi see\b/i,
            /\bjust to let you know\b/i,
            /\bas i mentioned\b/i
        ],
        check: (text) => {
            return !LINT_RULES.NO_FILLER_PHRASES.patterns.some(p => p.test(text));
        },
        suggestion: (text) => {
            const found = LINT_RULES.NO_FILLER_PHRASES.patterns
                .filter(p => p.test(text))
                .map(p => text.match(p)?.[0]);
            return `Remove filler phrases: ${found.join(', ')}`;
        }
    },
    
    NO_ROBOTIC_PHRASES: {
        id: 'NO_ROBOTIC_PHRASES',
        severity: 'error',
        penalty: 15,
        description: 'Avoid robotic/AI-revealing phrases',
        patterns: [
            /\bi am an? ai\b/i,
            /\bi am a virtual\b/i,
            /\bas an ai assistant\b/i,
            /\bi'm programmed to\b/i,
            /\bmy programming\b/i,
            /\bi don't have feelings\b/i,
            /\bi cannot feel\b/i,
            /\bi'm a chatbot\b/i,
            /\bI'm an automated\b/i
        ],
        check: (text) => {
            return !LINT_RULES.NO_ROBOTIC_PHRASES.patterns.some(p => p.test(text));
        },
        suggestion: () => 'Remove AI-revealing phrases. Speak naturally like a human receptionist.'
    },
    
    NO_COMPOUND_QUESTIONS: {
        id: 'NO_COMPOUND_QUESTIONS',
        severity: 'warning',
        penalty: 5,
        description: 'Avoid compound questions (asking multiple things at once)',
        patterns: [
            /\?\s*(?:and|or)\s+/i,
            /what.*\?\s*(?:is|are|do)/i,
            /\?\s*what\s/i
        ],
        check: (text) => {
            const questionMarks = (text.match(/\?/g) || []).length;
            return questionMarks <= 1;
        },
        suggestion: () => 'Ask one question at a time for clarity.'
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // EMPATHY & TONE
    // ─────────────────────────────────────────────────────────────────────────
    HAS_EMPATHY_OR_ACTION: {
        id: 'HAS_EMPATHY_OR_ACTION',
        severity: 'info',
        penalty: 3,
        description: 'Should have empathy or direct action',
        empathyPatterns: [
            /\bunderstand\b/i,
            /\bsorry\b/i,
            /\bfrustrat/i,
            /\bhear you\b/i,
            /\bhelp you\b/i,
            /\bappreciate\b/i,
            /\bthank/i
        ],
        actionPatterns: [
            /\blet me\b/i,
            /\bi can\b/i,
            /\bwe'll\b/i,
            /\bschedule\b/i,
            /\bget you\b/i,
            /\bsend\b/i,
            /\barrange\b/i
        ],
        check: (text) => {
            const hasEmpathy = LINT_RULES.HAS_EMPATHY_OR_ACTION.empathyPatterns.some(p => p.test(text));
            const hasAction = LINT_RULES.HAS_EMPATHY_OR_ACTION.actionPatterns.some(p => p.test(text));
            return hasEmpathy || hasAction;
        },
        suggestion: () => 'Add empathy ("I understand") or action ("Let me help you").'
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // PLACEHOLDER RULES
    // ─────────────────────────────────────────────────────────────────────────
    PLACEHOLDER_FORMAT: {
        id: 'PLACEHOLDER_FORMAT',
        severity: 'warning',
        penalty: 5,
        description: 'Placeholders should use {{camelCase}} format',
        check: (text) => {
            const validation = validatePlaceholders(text);
            return validation.suggestions.length === 0;
        },
        suggestion: (text) => {
            const validation = validatePlaceholders(text);
            return validation.suggestions.join('; ');
        }
    },
    
    PLACEHOLDER_LEGACY_FORMAT: {
        id: 'PLACEHOLDER_LEGACY_FORMAT',
        severity: 'error',
        penalty: 15,
        description: 'Legacy placeholder formats detected - must use {{camelCase}}',
        patterns: [
            /\{[a-z_]+\}/g,        // {companyname}
            /\$\{[a-zA-Z_]+\}/g,   // ${companyName}
            /%[a-zA-Z_]+%/g        // %companyname%
        ],
        check: (text) => {
            return !LINT_RULES.PLACEHOLDER_LEGACY_FORMAT.patterns.some(p => p.test(text));
        },
        suggestion: (text) => {
            const found = [];
            LINT_RULES.PLACEHOLDER_LEGACY_FORMAT.patterns.forEach(p => {
                const matches = text.match(p);
                if (matches) found.push(...matches);
            });
            return `Legacy placeholders found: ${found.join(', ')}. Use {{camelCase}} format instead.`;
        }
    },
    
    HAS_COMPANY_NAME: {
        id: 'HAS_COMPANY_NAME',
        severity: 'info',
        penalty: 2,
        description: 'Greeting should include {{companyName}}',
        check: (text) => {
            return /\{\{companyName\}\}/i.test(text) || /\{\{company_?name\}\}/i.test(text);
        },
        suggestion: () => 'Add {{companyName}} to personalize the greeting.'
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // REPETITION
    // ─────────────────────────────────────────────────────────────────────────
    NO_REPEATED_PHRASES: {
        id: 'NO_REPEATED_PHRASES',
        severity: 'warning',
        penalty: 5,
        description: 'Avoid repeating the same phrase',
        check: (text) => {
            const words = text.toLowerCase().split(/\s+/);
            const phrases = [];
            for (let i = 0; i < words.length - 2; i++) {
                phrases.push(words.slice(i, i + 3).join(' '));
            }
            const unique = new Set(phrases);
            return unique.size === phrases.length || phrases.length < 3;
        },
        suggestion: () => 'Remove repeated phrases for variety.'
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // SENTENCE STRUCTURE
    // ─────────────────────────────────────────────────────────────────────────
    NO_RUN_ON_SENTENCES: {
        id: 'NO_RUN_ON_SENTENCES',
        severity: 'warning',
        penalty: 5,
        description: 'Avoid run-on sentences (50+ characters without punctuation)',
        check: (text) => {
            const segments = text.split(/[.!?,;]/);
            return !segments.some(s => s.trim().length > 80);
        },
        suggestion: () => 'Break long sentences into shorter ones.'
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // BOOKING RULES
    // ─────────────────────────────────────────────────────────────────────────
    BOOKING_ENABLED_NO_SLOTS: {
        id: 'BOOKING_ENABLED_NO_SLOTS',
        severity: 'warning',
        penalty: 10,
        description: 'Booking is enabled but no slots are configured',
        // This is checked at config level, not text level
        check: () => true, // Always passes text check, handled separately
        suggestion: () => 'Configure booking slots or disable booking if running discovery-only.'
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function countWords(text) {
    if (!text) return 0;
    return text.split(/\s+/).filter(w => w.length > 0).length;
}

function estimateTTSSeconds(text) {
    const words = countWords(text);
    // ~150 words per minute = 2.5 words per second
    return words / 2.5;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN LINTER FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lint the entire control plane config
 * @param {Object} config - Effective config object
 * @param {Object} placeholders - Placeholder map for substitution
 * @returns {Object} Lint results with score, grade, issues
 */
function lintControlPlane(config, placeholders = {}) {
    const issues = [];
    let totalPenalty = 0;
    
    // ─────────────────────────────────────────────────────────────────────────
    // LINT GREETING
    // ─────────────────────────────────────────────────────────────────────────
    const greetingText = config.greeting?.raw || config.greeting?.preview || '';
    
    if (greetingText) {
        // Word count checks
        if (!LINT_RULES.GREETING_MAX_WORDS_35.check(greetingText)) {
            issues.push({
                field: 'greeting',
                rule: 'GREETING_MAX_WORDS_35',
                severity: 'error',
                message: LINT_RULES.GREETING_MAX_WORDS_35.suggestion(greetingText)
            });
            totalPenalty += LINT_RULES.GREETING_MAX_WORDS_35.penalty;
        } else if (!LINT_RULES.GREETING_MAX_WORDS_25.check(greetingText)) {
            issues.push({
                field: 'greeting',
                rule: 'GREETING_MAX_WORDS_25',
                severity: 'warning',
                message: LINT_RULES.GREETING_MAX_WORDS_25.suggestion(greetingText)
            });
            totalPenalty += LINT_RULES.GREETING_MAX_WORDS_25.penalty;
        }
        
        // Filler check
        if (!LINT_RULES.NO_FILLER_PHRASES.check(greetingText)) {
            issues.push({
                field: 'greeting',
                rule: 'NO_FILLER_PHRASES',
                severity: 'warning',
                message: LINT_RULES.NO_FILLER_PHRASES.suggestion(greetingText)
            });
            totalPenalty += LINT_RULES.NO_FILLER_PHRASES.penalty;
        }
        
        // Robotic check
        if (!LINT_RULES.NO_ROBOTIC_PHRASES.check(greetingText)) {
            issues.push({
                field: 'greeting',
                rule: 'NO_ROBOTIC_PHRASES',
                severity: 'error',
                message: LINT_RULES.NO_ROBOTIC_PHRASES.suggestion(greetingText)
            });
            totalPenalty += LINT_RULES.NO_ROBOTIC_PHRASES.penalty;
        }
        
        // Company name check
        if (!LINT_RULES.HAS_COMPANY_NAME.check(greetingText)) {
            issues.push({
                field: 'greeting',
                rule: 'HAS_COMPANY_NAME',
                severity: 'info',
                message: LINT_RULES.HAS_COMPANY_NAME.suggestion()
            });
            totalPenalty += LINT_RULES.HAS_COMPANY_NAME.penalty;
        }
        
        // Placeholder format check (warning for style issues)
        if (!LINT_RULES.PLACEHOLDER_FORMAT.check(greetingText)) {
            issues.push({
                field: 'greeting',
                rule: 'PLACEHOLDER_FORMAT',
                severity: 'warning',
                message: LINT_RULES.PLACEHOLDER_FORMAT.suggestion(greetingText)
            });
            totalPenalty += LINT_RULES.PLACEHOLDER_FORMAT.penalty;
        }
        
        // Legacy placeholder format check (ERROR - must fix)
        if (!LINT_RULES.PLACEHOLDER_LEGACY_FORMAT.check(greetingText)) {
            issues.push({
                field: 'greeting',
                rule: 'PLACEHOLDER_LEGACY_FORMAT',
                severity: 'error',
                message: LINT_RULES.PLACEHOLDER_LEGACY_FORMAT.suggestion(greetingText)
            });
            totalPenalty += LINT_RULES.PLACEHOLDER_LEGACY_FORMAT.penalty;
        }
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // LINT BOOKING QUESTIONS
    // ─────────────────────────────────────────────────────────────────────────
    const bookingSlots = config.booking?.slots || [];
    
    bookingSlots.forEach((slot, index) => {
        const questionText = slot.question || '';
        
        if (questionText && !LINT_RULES.BOOKING_QUESTION_MAX_15.check(questionText)) {
            issues.push({
                field: `booking.slots[${index}].question`,
                rule: 'BOOKING_QUESTION_MAX_15',
                severity: 'warning',
                message: `Slot "${slot.key}": ${LINT_RULES.BOOKING_QUESTION_MAX_15.suggestion(questionText)}`
            });
            totalPenalty += LINT_RULES.BOOKING_QUESTION_MAX_15.penalty;
        }
        
        // Check for compound questions
        if (questionText && !LINT_RULES.NO_COMPOUND_QUESTIONS.check(questionText)) {
            issues.push({
                field: `booking.slots[${index}].question`,
                rule: 'NO_COMPOUND_QUESTIONS',
                severity: 'warning',
                message: `Slot "${slot.key}": ${LINT_RULES.NO_COMPOUND_QUESTIONS.suggestion()}`
            });
            totalPenalty += LINT_RULES.NO_COMPOUND_QUESTIONS.penalty;
        }
    });
    
    // ─────────────────────────────────────────────────────────────────────────
    // LINT FALLBACK RESPONSES
    // ─────────────────────────────────────────────────────────────────────────
    const fallbackTexts = [
        { key: 'notOfferedReply', text: config.fallbacks?.notOfferedReply },
        { key: 'unknownIntentReply', text: config.fallbacks?.unknownIntentReply },
        { key: 'afterHoursReply', text: config.fallbacks?.afterHoursReply }
    ];
    
    fallbackTexts.forEach(({ key, text }) => {
        if (text) {
            // Check for empathy or action
            if (!LINT_RULES.HAS_EMPATHY_OR_ACTION.check(text)) {
                issues.push({
                    field: `fallbacks.${key}`,
                    rule: 'HAS_EMPATHY_OR_ACTION',
                    severity: 'info',
                    message: `${key}: ${LINT_RULES.HAS_EMPATHY_OR_ACTION.suggestion()}`
                });
                totalPenalty += LINT_RULES.HAS_EMPATHY_OR_ACTION.penalty;
            }
            
            // Check for robotic phrases
            if (!LINT_RULES.NO_ROBOTIC_PHRASES.check(text)) {
                issues.push({
                    field: `fallbacks.${key}`,
                    rule: 'NO_ROBOTIC_PHRASES',
                    severity: 'error',
                    message: `${key}: ${LINT_RULES.NO_ROBOTIC_PHRASES.suggestion()}`
                });
                totalPenalty += LINT_RULES.NO_ROBOTIC_PHRASES.penalty;
            }
            
            // Check for LEGACY PLACEHOLDER FORMATS (critical - prevents runtime bugs)
            if (!LINT_RULES.PLACEHOLDER_LEGACY_FORMAT.check(text)) {
                issues.push({
                    field: `fallbacks.${key}`,
                    rule: 'PLACEHOLDER_LEGACY_FORMAT',
                    severity: 'error',
                    message: `${key}: ${LINT_RULES.PLACEHOLDER_LEGACY_FORMAT.suggestion(text)}`
                });
                totalPenalty += LINT_RULES.PLACEHOLDER_LEGACY_FORMAT.penalty;
            }
        }
    });
    
    // ─────────────────────────────────────────────────────────────────────────
    // BOOKING ENABLED BUT NO SLOTS WARNING
    // ─────────────────────────────────────────────────────────────────────────
    if (config.booking?.enabled && (config.booking?.slotsCount === 0 || config.booking?.slots?.length === 0)) {
        issues.push({
            field: 'booking',
            rule: 'BOOKING_ENABLED_NO_SLOTS',
            severity: 'warning',
            message: LINT_RULES.BOOKING_ENABLED_NO_SLOTS.suggestion()
        });
        totalPenalty += LINT_RULES.BOOKING_ENABLED_NO_SLOTS.penalty;
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // CALCULATE SCORE & GRADE
    // ─────────────────────────────────────────────────────────────────────────
    const score = Math.max(0, 100 - totalPenalty);
    
    let grade;
    if (score >= 95) grade = 'A+';
    else if (score >= 90) grade = 'A';
    else if (score >= 85) grade = 'A-';
    else if (score >= 80) grade = 'B+';
    else if (score >= 75) grade = 'B';
    else if (score >= 70) grade = 'B-';
    else if (score >= 65) grade = 'C+';
    else if (score >= 60) grade = 'C';
    else if (score >= 55) grade = 'C-';
    else if (score >= 50) grade = 'D';
    else grade = 'F';
    
    return {
        score,
        grade,
        totalPenalty,
        issues,
        issuesByField: groupBy(issues, 'field'),
        issuesBySeverity: {
            error: issues.filter(i => i.severity === 'error'),
            warning: issues.filter(i => i.severity === 'warning'),
            info: issues.filter(i => i.severity === 'info')
        },
        summary: {
            errors: issues.filter(i => i.severity === 'error').length,
            warnings: issues.filter(i => i.severity === 'warning').length,
            info: issues.filter(i => i.severity === 'info').length
        }
    };
}

/**
 * Group array by key
 */
function groupBy(arr, key) {
    return arr.reduce((acc, item) => {
        const k = item[key];
        if (!acc[k]) acc[k] = [];
        acc[k].push(item);
        return acc;
    }, {});
}

/**
 * Lint a single text field
 * @param {String} text - Text to lint
 * @param {Array} ruleIds - Specific rules to apply (or all if empty)
 * @returns {Object} Lint results
 */
function lintText(text, ruleIds = []) {
    const issues = [];
    let totalPenalty = 0;
    
    const rulesToApply = ruleIds.length > 0 
        ? ruleIds.map(id => LINT_RULES[id]).filter(Boolean)
        : Object.values(LINT_RULES);
    
    rulesToApply.forEach(rule => {
        if (!rule.check(text)) {
            issues.push({
                rule: rule.id,
                severity: rule.severity,
                message: typeof rule.suggestion === 'function' ? rule.suggestion(text) : rule.description
            });
            totalPenalty += rule.penalty;
        }
    });
    
    const score = Math.max(0, 100 - totalPenalty);
    
    return {
        text,
        score,
        issues,
        wordCount: countWords(text),
        estimatedTTSSeconds: estimateTTSSeconds(text)
    };
}

module.exports = {
    lintControlPlane,
    lintText,
    countWords,
    estimateTTSSeconds,
    LINT_RULES
};

