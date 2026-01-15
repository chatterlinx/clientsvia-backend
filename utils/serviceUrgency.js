const URGENT_KEYWORDS = [
    'not cooling',
    "won't cool",
    'no cooling',
    'no cold air',
    'no air',
    'blowing warm',
    'blowing hot',
    'smell',
    'burning smell',
    'smoke',
    'sparking',
    'leaking',
    'leak',
    'water on the floor',
    'water coming down',
    'flood',
    'completely dead',
    "won't turn on",
    'shut off',
    'shutting off',
    'iced up',
    'frozen'
];

function classifyServiceUrgency(text = '') {
    const normalized = String(text || '').toLowerCase();
    for (const keyword of URGENT_KEYWORDS) {
        if (normalized.includes(keyword)) {
            return 'urgent';
        }
    }
    return 'normal';
}

module.exports = {
    classifyServiceUrgency,
    URGENT_KEYWORDS
};
