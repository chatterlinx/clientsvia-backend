/**
 * Shared scenario type detection + normalization.
 * Used by Golden Autofill, admin save flows, and scripts.
 */

const TYPE_KEYWORDS = {
    EMERGENCY: [
        'emergency', 'urgent', 'gas leak', 'no heat', 'no cool', 'freezing',
        'flooding', 'dangerous', 'carbon monoxide', 'smoke', 'fire', 'water damage',
        'broken pipe', 'no power', 'sparking', 'electrical shock', 'burning smell',
        'ceiling leak', 'sewage', 'overflow', 'total failure', 'not turning on'
    ],
    BOOKING: [
        'book', 'schedule', 'appointment', 'reschedule', 'cancel appointment',
        'someone come out', 'send a tech', 'technician visit', 'set up service',
        'when available', 'next available', 'time slot', 'calendar'
    ],
    TRANSFER: [
        'speak to human', 'talk to someone', 'real person', 'manager',
        'supervisor', 'service advisor', 'representative', 'transfer me',
        'connect me', 'let me talk to'
    ],
    SMALL_TALK: [
        'how are you', 'thank you', 'thanks', 'goodbye', 'bye', 'have a nice day',
        'wrong number', 'wrong department', 'sorry', 'oops', 'never mind',
        'just kidding', 'hello', 'hi there', 'good morning', 'good afternoon'
    ],
    BILLING: [
        'billing', 'invoice', 'invoicing', 'bill', 'payment', 'pay', 'paid',
        'charge', 'charges', 'refund', 'refunded', 'credit', 'debit', 'receipt',
        'account balance', 'statement', 'past due', 'collections', 'finance'
    ],
    TROUBLESHOOT: [
        'troubleshoot', 'troubleshooting', 'diagnose', 'diagnostic', 'help me fix',
        'not working', 'stopped working', 'keeps', 'won\'t', 'will not', 'why is',
        'error code', 'making noise', 'leaking', 'rattling', 'smells', 'smell',
        'intermittent', 'reset', 'breaker', 'fuse',
        // HVAC/common field-service phrasing
        'fan not spinning', 'not spinning', 'outdoor fan', 'condenser fan', 'outdoor unit', 'condenser',
        'ac not cooling', 'not cooling', 'no cooling', 'not blowing cold', 'not blowing',
        'compressor', 'capacitor', 'contactors', 'contactor',
        // Additional HVAC terms
        'thermostat', 'furnace', 'air handler', 'coil', 'frozen', 'ice', 'icing',
        'refrigerant', 'freon', 'low charge', 'high pressure', 'low pressure',
        'ductwork', 'duct', 'vents', 'airflow', 'filter', 'blower'
    ],
    FAQ: [
        'pricing', 'cost', 'how much', 'warranty', 'financing', 'membership',
        'service area', 'do you service', 'accept credit',
        'hours', 'open', 'closed', 'location', 'address', 'reviews'
    ],
    SYSTEM: [
        'hold please', 'one moment', 'got it', 'understood', 'okay',
        'processing', 'looking up', 'checking'
    ]
};

const VALID_TYPES = new Set([
    'EMERGENCY', 'BOOKING', 'FAQ', 'TROUBLESHOOT', 'BILLING', 'TRANSFER',
    'SMALL_TALK', 'SYSTEM',
    // Legacy (accepted for backward compatibility)
    'INFO_FAQ', 'ACTION_FLOW', 'SYSTEM_ACK',
    'UNKNOWN'
]);

function normalizeScenarioType(value, { allowUnknown = false } = {}) {
    if (value === undefined || value === null) {
        return null;
    }
    
    const normalized = String(value).trim();
    if (!normalized) {
        return null;
    }
    
    const upper = normalized.toUpperCase();
    if (upper === 'UNKNOWN' && !allowUnknown) {
        return null;
    }
    
    return VALID_TYPES.has(upper) ? upper : null;
}

function detectScenarioType(scenario = {}, categoryName = '') {
    const explicitType = normalizeScenarioType(scenario.scenarioType, { allowUnknown: false });
    if (explicitType) {
        return explicitType;
    }
    
    const triggers = Array.isArray(scenario.triggers) ? scenario.triggers : [];
    const searchText = [
        scenario.name || '',
        categoryName || '',
        ...triggers
    ].join(' ').toLowerCase();
    
    for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
        if (keywords.some(keyword => searchText.includes(keyword))) {
            return type;
        }
    }
    
    // Last-resort guess (UNKNOWN scenarios don't route at runtime).
    return 'FAQ';
}

module.exports = {
    TYPE_KEYWORDS,
    detectScenarioType,
    normalizeScenarioType
};
