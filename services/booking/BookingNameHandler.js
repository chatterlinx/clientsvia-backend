/**
 * BookingNameHandler - boxed name state machine.
 *
 * States: INIT → AWAITING_LAST → AWAITING_SPELLING → COMPLETE
 * Pure reducer: deterministic inputs/outputs for easy testing and caching.
 */

const STATES = Object.freeze({
    INIT: 'INIT',
    AWAITING_LAST: 'AWAITING_LAST',
    AWAITING_SPELLING: 'AWAITING_SPELLING',
    COMPLETE: 'COMPLETE'
});

const NAME_STOP_WORDS = new Set([
    'is', 'are', 'was', 'were', 'be', 'been', 'am',
    'the', 'my', 'its', "it's", 'a', 'an', 'name', 'last', 'first',
    'yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'no', 'nope',
    'hi', 'hello', 'hey', 'please', 'thanks', 'thank', 'you',
    'it', 'that', 'this', 'what', 'and', 'or', 'but', 'to', 'for',
    'got', 'two', 'kids', 'there', 'uh', 'um', 'yup', 'yep'
]);

function isValidName(token = '') {
    const clean = token.replace(/[^a-zA-Z'-]/g, '');
    if (!clean || clean.length < 2) return false;
    if (NAME_STOP_WORDS.has(clean.toLowerCase())) return false;
    if (/^(do|does|did|will|would|could|should|can|may|might)$/i.test(clean)) return false;
    return true;
}

function titleCase(token) {
    if (!token) return token;
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function normalizeInput(text = '') {
    return text.trim();
}

function extractSingleName(text) {
    const words = normalizeInput(text).split(/\s+/);
    const candidates = words
        .map((w) => w.replace(/[^a-zA-Z'-]/g, ''))
        .filter(isValidName);
    if (candidates.length === 0) return null;
    return titleCase(candidates[candidates.length - 1]); // prefer last meaningful word
}

function extractFullNameParts(text) {
    const words = normalizeInput(text).split(/\s+/);
    const candidates = words
        .map((w) => w.replace(/[^a-zA-Z'-]/g, ''))
        .filter(isValidName)
        .map(titleCase);
    if (candidates.length === 0) return { first: null, last: null };
    if (candidates.length === 1) return { first: candidates[0], last: null };
    return { first: candidates[0], last: candidates.slice(1).join(' ') };
}

function extractLastNamePhrase(text) {
    const m = text.match(/last\s+name\s+(?:is\s+)?([A-Za-z'-]+)/i);
    if (m && isValidName(m[1])) {
        return titleCase(m[1]);
    }
    return null;
}

function extractSpellingVariant(text) {
    // Accept "Mark with a k" / "Marc with a c"
    const m = text.match(/([A-Za-z]+)\s+with\s+a\s+([a-z])/i);
    if (m && isValidName(m[1])) {
        const base = titleCase(m[1]);
        const letter = m[2].toLowerCase();
        // Replace last character with provided letter if single-letter tweak
        if (base.length > 1) {
            return base.slice(0, -1) + letter.toUpperCase();
        }
        return base;
    }
    return null;
}

function extractLastNamePhrase(text) {
    const m = text.match(/last\s+name\s+(?:is\s+)?([A-Za-z'-]+)/i);
    if (m && isValidName(m[1])) {
        return titleCase(m[1]);
    }
    return null;
}

function createContext(options = {}) {
    return {
        state: STATES.INIT,
        slots: {
            name: null,
            first: null,
            last: null,
            partialName: null
        },
        prompts: [],
        lastPrompt: null,
        options: {
            askMissingNamePart: options.askMissingNamePart === true,
            confirmSpelling: options.confirmSpelling === true
        }
    };
}

function step(ctx, event) {
    if (!event || event.type !== 'input') return ctx;
    const text = normalizeInput(event.text || '');
    if (!text) return ctx;

    switch (ctx.state) {
        case STATES.INIT: {
            const { first, last } = extractFullNameParts(text);
            if (first && last) {
                ctx.slots.first = first;
                ctx.slots.last = last;
                ctx.slots.name = `${first} ${last}`.trim();
                ctx.state = ctx.options.confirmSpelling ? STATES.AWAITING_SPELLING : STATES.COMPLETE;
                break;
            }
            if (first && ctx.options.askMissingNamePart) {
                ctx.slots.first = first;
                ctx.slots.partialName = first;
                ctx.state = STATES.AWAITING_LAST;
                ctx.prompts.push('What is your last name?');
                break;
            }
            const single = extractSingleName(text);
            if (single) {
                ctx.slots.first = single;
                ctx.slots.partialName = single;
                ctx.state = ctx.options.askMissingNamePart
                    ? STATES.AWAITING_LAST
                    : (ctx.options.confirmSpelling ? STATES.AWAITING_SPELLING : STATES.COMPLETE);
                if (ctx.state === STATES.AWAITING_LAST) {
                    if (ctx.lastPrompt !== 'ask_last_name') {
                        ctx.prompts.push('What is your last name?');
                        ctx.lastPrompt = 'ask_last_name';
                    } else {
                        ctx.prompts.push('Could you share your last name?');
                        ctx.lastPrompt = 'ask_last_name_rephrase';
                    }
                }
                break;
            }
            break;
        }
        case STATES.AWAITING_LAST: {
            const phraseLast = extractLastNamePhrase(text);
            if (phraseLast) {
                ctx.slots.last = phraseLast;
                ctx.slots.name = `${ctx.slots.first || ''} ${phraseLast}`.trim();
                ctx.state = ctx.options.confirmSpelling ? STATES.AWAITING_SPELLING : STATES.COMPLETE;
                break;
            }
            const spellingVariant = extractSpellingVariant(text);
            if (spellingVariant && ctx.slots.first && !ctx.slots.last) {
                ctx.slots.last = spellingVariant;
                ctx.slots.name = `${ctx.slots.first} ${spellingVariant}`.trim();
                ctx.state = ctx.options.confirmSpelling ? STATES.AWAITING_SPELLING : STATES.COMPLETE;
                break;
            }
            const last = extractSingleName(text);
            if (last) {
                ctx.slots.last = last;
                ctx.slots.name = `${ctx.slots.first || ''} ${last}`.trim();
                ctx.state = ctx.options.confirmSpelling ? STATES.AWAITING_SPELLING : STATES.COMPLETE;
                break;
            }
            // Re-ask with rephrase if we already asked last name
            if (ctx.lastPrompt === 'ask_last_name') {
                ctx.prompts.push('I want to be sure I heard that right—what is your last name?');
                ctx.lastPrompt = 'ask_last_name_rephrase';
            } else if (ctx.lastPrompt === 'ask_last_name_rephrase') {
                // cap re-asks here; let ConversationEngine handle bail-out
            }
            break;
        }
        case STATES.AWAITING_SPELLING: {
            const hint = text.toLowerCase();
            if (/with a [a-z]/.test(hint) && ctx.slots.name) {
                ctx.state = STATES.COMPLETE;
                break;
            }
            const { first, last } = extractFullNameParts(text);
            if (first && last) {
                ctx.slots.first = first;
                ctx.slots.last = last;
                ctx.slots.name = `${first} ${last}`.trim();
                ctx.state = STATES.COMPLETE;
                break;
            }
            const spellingVariant = extractSpellingVariant(text);
            if (spellingVariant && ctx.slots.first && !ctx.slots.last) {
                ctx.slots.last = spellingVariant;
                ctx.slots.name = `${ctx.slots.first} ${spellingVariant}`.trim();
                ctx.state = STATES.COMPLETE;
                break;
            }
            const single = extractSingleName(text);
            if (single && ctx.slots.first && !ctx.slots.last) {
                ctx.slots.last = single;
                ctx.slots.name = `${ctx.slots.first} ${single}`.trim();
                ctx.state = STATES.COMPLETE;
                break;
            }
            if (single && !ctx.slots.first) {
                ctx.slots.first = single;
                ctx.slots.name = single;
                ctx.state = STATES.COMPLETE;
            }
            break;
        }
        case STATES.COMPLETE:
        default:
            break;
    }

    return ctx;
}

module.exports = {
    STATES,
    createContext,
    step,
    isValidName,
    extractSingleName,
    extractFullNameParts
};
