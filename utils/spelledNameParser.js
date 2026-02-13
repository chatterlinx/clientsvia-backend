/**
 * ============================================================================
 * SPELLED NAME PARSER
 * ============================================================================
 *
 * Parses letter-by-letter name spelling from voice input (STT transcription).
 * Used when the agent asks "Could you spell your last name for me?" and the
 * caller responds with individual letters.
 *
 * SUPPORTED INPUT FORMATS:
 *   1. Individual letters:     "B A R R Y"  or  "b-a-r-r-y"  or  "b, a, r, r, y"
 *   2. NATO phonetic alphabet: "bravo alpha romeo romeo yankee"
 *   3. "As in" pattern:        "B as in boy, A, R, R, Y as in yellow"
 *   4. "For" pattern:          "B for boy, A for apple, R, R, Y"
 *   5. "Like" pattern:         "B like boy, A like apple"
 *   6. Mixed:                  "B as in boy, romeo, R, Y for yellow"
 *
 * DETECTION:
 *   isSpelledInput() detects whether the caller is spelling vs saying a name.
 *
 * RETURNS:
 *   Title-cased reconstructed name: "Barry", "Krazinski", "O'Brien"
 *
 * ============================================================================
 */

const logger = require('./logger');

// ═══════════════════════════════════════════════════════════════════════════════
// NATO PHONETIC ALPHABET → LETTER MAPPING
// ═══════════════════════════════════════════════════════════════════════════════
const NATO_TO_LETTER = {
    'alpha': 'a', 'alfa': 'a',
    'bravo': 'b',
    'charlie': 'c',
    'delta': 'd',
    'echo': 'e',
    'foxtrot': 'f',
    'golf': 'g',
    'hotel': 'h',
    'india': 'i',
    'juliet': 'j', 'juliett': 'j',
    'kilo': 'k',
    'lima': 'l',
    'mike': 'm',
    'november': 'n',
    'oscar': 'o',
    'papa': 'p',
    'quebec': 'q',
    'romeo': 'r',
    'sierra': 's',
    'tango': 't',
    'uniform': 'u',
    'victor': 'v',
    'whiskey': 'w', 'whisky': 'w',
    'xray': 'x', 'x-ray': 'x',
    'yankee': 'y',
    'zulu': 'z'
};

// Common "as in" words that callers use (beyond NATO) → letter mapping
// People say "B as in boy" not "B as in bravo"
const COMMON_WORD_TO_LETTER = {
    // A
    'apple': 'a', 'adam': 'a', 'america': 'a', 'able': 'a', 'anna': 'a', 'ant': 'a',
    // B
    'boy': 'b', 'baker': 'b', 'bob': 'b', 'baby': 'b', 'ball': 'b', 'bat': 'b',
    // C
    'cat': 'c', 'charles': 'c', 'candy': 'c', 'car': 'c', 'chicago': 'c', 'cake': 'c',
    // D
    'dog': 'd', 'david': 'd', 'dan': 'd', 'door': 'd', 'dollar': 'd', 'duck': 'd',
    // E
    'edward': 'e', 'elephant': 'e', 'easy': 'e', 'egg': 'e', 'emily': 'e',
    // F
    'frank': 'f', 'fox': 'f', 'father': 'f', 'fish': 'f', 'florida': 'f', 'freddy': 'f',
    // G
    'george': 'g', 'girl': 'g', 'go': 'g', 'gate': 'g', 'good': 'g', 'grape': 'g',
    // H
    'henry': 'h', 'happy': 'h', 'hat': 'h', 'house': 'h', 'hot': 'h', 'harry': 'h',
    // I
    'ice': 'i', 'island': 'i', 'igloo': 'i', 'italy': 'i', 'iris': 'i',
    // J
    'john': 'j', 'jack': 'j', 'james': 'j', 'jungle': 'j', 'jupiter': 'j', 'joy': 'j',
    // K
    'king': 'k', 'kite': 'k', 'kitchen': 'k', 'kangaroo': 'k', 'kevin': 'k',
    // L
    'larry': 'l', 'lion': 'l', 'love': 'l', 'lake': 'l', 'lemon': 'l', 'lucy': 'l',
    // M
    'mary': 'm', 'man': 'm', 'mother': 'm', 'money': 'm', 'monkey': 'm', 'mango': 'm',
    // N
    'nancy': 'n', 'number': 'n', 'nice': 'n', 'night': 'n', 'nora': 'n', 'nine': 'n',
    // O
    'ocean': 'o', 'orange': 'o', 'oliver': 'o', 'open': 'o', 'ohio': 'o',
    // P
    'peter': 'p', 'paul': 'p', 'pizza': 'p', 'people': 'p', 'park': 'p', 'penny': 'p',
    // Q
    'queen': 'q', 'question': 'q', 'quiet': 'q', 'quilt': 'q',
    // R
    'robert': 'r', 'roger': 'r', 'rain': 'r', 'red': 'r', 'right': 'r', 'rose': 'r',
    // S
    'sam': 's', 'sugar': 's', 'snake': 's', 'sun': 's', 'star': 's', 'sarah': 's',
    // T
    'tom': 't', 'tiger': 't', 'table': 't', 'tree': 't', 'texas': 't', 'time': 't',
    // U
    'uncle': 'u', 'umbrella': 'u', 'under': 'u', 'united': 'u', 'up': 'u',
    // V
    'victory': 'v', 'violet': 'v', 'van': 'v', 'very': 'v', 'voice': 'v',
    // W
    'william': 'w', 'water': 'w', 'woman': 'w', 'world': 'w', 'winter': 'w', 'west': 'w',
    // X
    'xylophone': 'x',
    // Y
    'yellow': 'y', 'yes': 'y', 'young': 'y', 'yoga': 'y',
    // Z
    'zebra': 'z', 'zero': 'z', 'zoo': 'z', 'zipper': 'z', 'zone': 'z'
};

// Merge NATO + common words into one lookup
const WORD_TO_LETTER = { ...NATO_TO_LETTER, ...COMMON_WORD_TO_LETTER };

// Set of all known NATO/common words for quick detection
const KNOWN_SPELLING_WORDS = new Set(Object.keys(WORD_TO_LETTER));

// ═══════════════════════════════════════════════════════════════════════════════
// PATTERNS for detecting "as in", "for", "like" constructs
// ═══════════════════════════════════════════════════════════════════════════════
// "B as in boy" → captures letter=B, word=boy
// "B for boy"   → captures letter=B, word=boy
// "B like boy"  → captures letter=B, word=boy
const AS_IN_PATTERN = /\b([a-z])\s+(?:as\s+in|for|like)\s+(\w+)/gi;

// Single letter (isolated): "B" between word boundaries/separators
const SINGLE_LETTER_PATTERN = /^[a-zA-Z]$/;

// ═══════════════════════════════════════════════════════════════════════════════
// DETECTION: Is the caller spelling a name?
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect whether the input looks like the caller is spelling out a name
 * rather than saying a name normally.
 *
 * @param {string} input - Raw STT transcription
 * @returns {boolean} True if input appears to be spelled letters
 */
function isSpelledInput(input) {
    if (!input || typeof input !== 'string') return false;

    const text = input.trim().toLowerCase();
    if (text.length < 2) return false;

    // Signal 1: Contains "as in" / "for" / "like" letter constructs
    if (/\b[a-z]\s+(?:as\s+in|for|like)\s+\w+/i.test(text)) {
        return true;
    }

    // Signal 2: Mostly single letters separated by spaces, commas, dashes, periods
    // "b a r r y" or "b, a, r, r, y" or "b-a-r-r-y" or "b. a. r. r. y."
    const tokens = text.split(/[\s,.\-]+/).filter(t => t.length > 0);
    const singleLetterCount = tokens.filter(t => SINGLE_LETTER_PATTERN.test(t)).length;

    if (tokens.length >= 2 && singleLetterCount / tokens.length >= 0.6) {
        return true;
    }

    // Signal 3: Contains 3+ NATO/common spelling words
    const natoCount = tokens.filter(t => KNOWN_SPELLING_WORDS.has(t)).length;
    if (natoCount >= 3) {
        return true;
    }

    // Signal 4: Dash-separated single letters "b-a-r-r-y"
    if (/^[a-z](-[a-z]){2,}$/i.test(text.replace(/\s/g, ''))) {
        return true;
    }

    return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARSER: Extract letters from spelled input → reconstruct name
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse a spelled name from STT transcription and reconstruct the name.
 *
 * @param {string} input - Raw STT transcription of spelled letters
 * @returns {{ parsed: boolean, name: string|null, letters: string[], confidence: number, raw: string }}
 */
function parseSpelledName(input) {
    if (!input || typeof input !== 'string') {
        return { parsed: false, name: null, letters: [], confidence: 0, raw: input };
    }

    const raw = input.trim();
    let text = raw.toLowerCase();
    const letters = [];

    // Strip conversational filler from start
    text = text
        .replace(/^(?:yeah|yes|sure|ok|okay|so|um|uh|well|it's|its|that's|that\s+is)\s+/i, '')
        .replace(/^(?:my\s+(?:last\s+)?name\s+is\s+(?:spelled?\s+)?)/i, '')
        .replace(/^(?:it'?s\s+(?:spelled?\s+)?)/i, '')
        .trim();

    // ─── Strategy 1: Extract "X as in word" / "X for word" / "X like word" ───
    // Process these FIRST because they're the most explicit signal
    let asInText = text;
    let match;
    const asInPositions = []; // Track which parts we've consumed

    AS_IN_PATTERN.lastIndex = 0;
    while ((match = AS_IN_PATTERN.exec(text)) !== null) {
        const letter = match[1].toLowerCase();
        const word = match[2].toLowerCase();

        // Validate: the word should start with the stated letter, OR be a known spelling word
        if (word.startsWith(letter) || WORD_TO_LETTER[word] === letter) {
            letters.push(letter);
            asInPositions.push({ start: match.index, end: match.index + match[0].length });
        } else if (WORD_TO_LETTER[word]) {
            // Word is known but letter doesn't match — trust the word (STT may have garbled the letter)
            letters.push(WORD_TO_LETTER[word]);
            asInPositions.push({ start: match.index, end: match.index + match[0].length });
        }
    }

    // Remove consumed "as in" segments and parse remaining tokens
    if (asInPositions.length > 0) {
        // Build a string with consumed parts removed
        let remaining = text;
        // Process from end to start to preserve indices
        for (let i = asInPositions.length - 1; i >= 0; i--) {
            const pos = asInPositions[i];
            remaining = remaining.substring(0, pos.start) + ' ' + remaining.substring(pos.end);
        }

        // Parse remaining tokens (single letters or NATO words between the "as in" phrases)
        const remainingTokens = remaining.split(/[\s,.\-;:]+/).filter(t => t.length > 0);
        // We need to figure out positions — simpler: re-parse the full input linearly

        // Reset and do a single linear pass instead
        letters.length = 0;
    }

    // ─── Strategy 2: Linear token-by-token parsing (handles all formats) ───
    // Split on separators, then classify each token
    const tokens = text.split(/[\s,.\-;:]+/).filter(t => t.length > 0);
    letters.length = 0; // Reset from strategy 1

    let i = 0;
    while (i < tokens.length) {
        const token = tokens[i];

        // Case A: Single letter
        if (SINGLE_LETTER_PATTERN.test(token)) {
            // Check if next tokens are "as in X" / "for X" / "like X"
            if (i + 2 < tokens.length &&
                ['as', 'for', 'like'].includes(tokens[i + 1])) {
                // "B as ..." or "B for X" or "B like X"
                if (tokens[i + 1] === 'as' && i + 3 < tokens.length && tokens[i + 2] === 'in') {
                    // "B as in X" — skip "as", "in", and the word
                    letters.push(token.toLowerCase());
                    i += 4; // skip letter + "as" + "in" + word
                } else {
                    // "B for X" or "B like X"
                    letters.push(token.toLowerCase());
                    i += 3; // skip letter + "for/like" + word
                }
            } else {
                // Standalone single letter
                letters.push(token.toLowerCase());
                i += 1;
            }
        }
        // Case B: NATO/common word
        else if (WORD_TO_LETTER[token]) {
            letters.push(WORD_TO_LETTER[token]);
            i += 1;
        }
        // Case C: "as" / "in" / "for" / "like" (orphaned connectors — skip)
        else if (['as', 'in', 'for', 'like', 'and', 'then'].includes(token)) {
            i += 1;
        }
        // Case D: "double" + letter/word → repeat the next letter
        else if (token === 'double' && i + 1 < tokens.length) {
            const next = tokens[i + 1];
            const letter = SINGLE_LETTER_PATTERN.test(next)
                ? next.toLowerCase()
                : (WORD_TO_LETTER[next] || null);
            if (letter) {
                letters.push(letter);
                letters.push(letter);
                i += 2;
            } else {
                i += 1;
            }
        }
        // Case E: Multi-letter word that's NOT a known spelling word
        // Could be a filler word or STT artifact — skip it
        else {
            // Check if it's a garbled single letter (e.g., STT heard "bee" for "B")
            const phonetic = resolvePhoneticLetter(token);
            if (phonetic) {
                letters.push(phonetic);
            }
            // Otherwise skip — it's noise
            i += 1;
        }
    }

    // ─── Build the result ───
    if (letters.length < 2) {
        logger.debug('[SPELLED NAME PARSER] Too few letters extracted', {
            raw,
            letters,
            tokenCount: tokens.length
        });
        return { parsed: false, name: null, letters, confidence: 0, raw };
    }

    const name = titleCase(letters.join(''));
    const confidence = computeSpellingConfidence(letters, tokens);

    logger.info('[SPELLED NAME PARSER] Parsed spelled name', {
        raw: raw.substring(0, 80),
        name,
        letterCount: letters.length,
        confidence: confidence.toFixed(2)
    });

    return { parsed: true, name, letters, confidence, raw };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve phonetic letter sounds that STT might transcribe as words.
 * "bee" → b, "see" → c, "dee" → d, "gee" → g, etc.
 */
function resolvePhoneticLetter(word) {
    const PHONETIC_SOUNDS = {
        'ay': 'a', 'eh': 'a',
        'bee': 'b',
        'see': 'c', 'sea': 'c', 'cee': 'c',
        'dee': 'd',
        'ee': 'e',
        'eff': 'f', 'ef': 'f',
        'gee': 'g',
        'aitch': 'h', 'ach': 'h',
        'eye': 'i',
        'jay': 'j',
        'kay': 'k',
        'el': 'l', 'ell': 'l',
        'em': 'm',
        'en': 'n',
        'oh': 'o',
        'pee': 'p',
        'cue': 'q', 'queue': 'q',
        'are': 'r', 'ar': 'r',
        'ess': 's',
        'tee': 't',
        'you': 'u',
        'vee': 'v',
        'double you': 'w', 'doubleyou': 'w',
        'ex': 'x',
        'why': 'y', 'wye': 'y',
        'zee': 'z', 'zed': 'z'
    };
    return PHONETIC_SOUNDS[word.toLowerCase()] || null;
}

/**
 * Compute confidence score for the parsed spelling.
 * Higher when more tokens were successfully resolved as letters.
 */
function computeSpellingConfidence(letters, tokens) {
    if (tokens.length === 0) return 0;

    // What fraction of input tokens contributed to letters?
    // Filter out connector words (as, in, for, like, and)
    const contentTokens = tokens.filter(t =>
        !['as', 'in', 'for', 'like', 'and', 'then', 'double'].includes(t)
    );

    if (contentTokens.length === 0) return 0;

    // Each letter should correspond to roughly 1 content token
    const ratio = Math.min(1, letters.length / contentTokens.length);

    // Bonus for longer names (more signal)
    const lengthBonus = Math.min(0.1, letters.length * 0.01);

    return Math.min(1, ratio * 0.9 + lengthBonus + 0.05);
}

/**
 * Title case a single word: "barry" → "Barry"
 */
function titleCase(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════
module.exports = {
    isSpelledInput,
    parseSpelledName,
    // Exposed for testing
    NATO_TO_LETTER,
    WORD_TO_LETTER,
    resolvePhoneticLetter
};
