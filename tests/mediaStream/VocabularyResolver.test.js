/**
 * Unit tests for services/mediaStream/VocabularyResolver.js
 * C2 — platform vocabulary + config resolver.
 *
 * AWConfigReader.getGlobalFirstNames is mocked so tests run without a cache
 * warm-up or DB.
 */

jest.mock('../../services/wiring/AWConfigReader', () => ({
    getGlobalFirstNames: jest.fn(() => ['Marc', 'Emily', 'Jose'])
}));

const {
    resolveKeywords,
    _internals
} = require('../../services/mediaStream/VocabularyResolver');

function parseOut(out) {
    return out.map(s => {
        const idx = s.lastIndexOf(':');
        return { phrase: s.slice(0, idx), boost: Number(s.slice(idx + 1)) };
    });
}

function makeCompany(keywords = [], trade = '') {
    return {
        trade,
        aiAgentSettings: {
            agent2: {
                speechDetection: { keywords }
            }
        }
    };
}

function makeAdmin(tradeVocabs = []) {
    return {
        globalHub: {
            phraseIntelligence: { tradeVocabularies: tradeVocabs }
        }
    };
}

describe('VocabularyResolver.normPhrase', () => {
    test('trims, lowercases, collapses whitespace', () => {
        expect(_internals.normPhrase('  Hello   WORLD  ')).toBe('hello world');
        expect(_internals.normPhrase(null)).toBe('');
        expect(_internals.normPhrase(undefined)).toBe('');
    });
});

describe('VocabularyResolver.normaliseBoost', () => {
    test('clamps to Deepgram 0-4 range', () => {
        expect(_internals.normaliseBoost(0)).toBe(1);
        expect(_internals.normaliseBoost(-1)).toBe(1);
        expect(_internals.normaliseBoost(1)).toBe(1);
        expect(_internals.normaliseBoost(2)).toBe(2);
        expect(_internals.normaliseBoost(3)).toBe(2);
        expect(_internals.normaliseBoost(4)).toBe(3);
        expect(_internals.normaliseBoost(6)).toBe(3);
        expect(_internals.normaliseBoost(7)).toBe(4);
        expect(_internals.normaliseBoost(10)).toBe(4);
        expect(_internals.normaliseBoost('garbage')).toBe(1);
    });
});

describe('VocabularyResolver.resolveKeywords', () => {
    test('returns empty when company has no keywords, no trade, and first names empty', () => {
        const AWConfigReader = require('../../services/wiring/AWConfigReader');
        AWConfigReader.getGlobalFirstNames.mockReturnValueOnce([]);
        const out = resolveKeywords(makeCompany([]), makeAdmin([]));
        expect(out).toEqual([]);
    });

    test('includes tenant-enabled keywords, skips disabled', () => {
        const company = makeCompany([
            { phrase: 'Foo Brand', boost: 5, enabled: true },
            { phrase: 'Nope', boost: 10, enabled: false },
            { phrase: 'Bar', enabled: true }
        ]);
        const out = resolveKeywords(company, makeAdmin([]));
        const parsed = parseOut(out);
        const phrases = parsed.map(p => p.phrase);
        expect(phrases).toContain('foo brand');
        expect(phrases).toContain('bar');
        expect(phrases).not.toContain('nope');
    });

    test('includes trade terms matched by trade key (case-insensitive)', () => {
        const company = makeCompany([], 'hvac');
        const admin = makeAdmin([
            { tradeKey: 'HVAC', terms: ['ac maintenance', 'furnace repair'] },
            { tradeKey: 'PLUMBING', terms: ['pipe leak'] }
        ]);
        const out = resolveKeywords(company, admin);
        const phrases = parseOut(out).map(p => p.phrase);
        expect(phrases).toContain('ac maintenance');
        expect(phrases).toContain('furnace repair');
        expect(phrases).not.toContain('pipe leak');
    });

    test('includes platform first names as low-boost hints', () => {
        const out = resolveKeywords(makeCompany([]), makeAdmin([]));
        const phrases = parseOut(out).map(p => p.phrase);
        expect(phrases).toContain('marc');
        expect(phrases).toContain('emily');
    });

    test('dedupe keeps highest boost across sources', () => {
        // "ac maintenance" appears in tenant (boost 5→3) and trade (boost 2)
        const company = makeCompany([
            { phrase: 'ac maintenance', boost: 5, enabled: true }
        ], 'hvac');
        const admin = makeAdmin([
            { tradeKey: 'hvac', terms: ['ac maintenance'] }
        ]);
        const out = resolveKeywords(company, admin);
        const occurrences = out.filter(s => s.startsWith('ac maintenance:'));
        expect(occurrences).toHaveLength(1);
        // tenant raw boost 5 → normalised 3
        expect(occurrences[0]).toBe('ac maintenance:3');
    });

    test('output is sorted boost descending', () => {
        const company = makeCompany([
            { phrase: 'low', boost: 1, enabled: true },
            { phrase: 'mid', boost: 3, enabled: true },
            { phrase: 'high', boost: 10, enabled: true }
        ]);
        const out = resolveKeywords(company, makeAdmin([]));
        const parsed = parseOut(out);
        // "high" (10→4) should come before "mid" (3→2) before "low" (1→1)
        const highIdx = parsed.findIndex(p => p.phrase === 'high');
        const midIdx  = parsed.findIndex(p => p.phrase === 'mid');
        const lowIdx  = parsed.findIndex(p => p.phrase === 'low');
        expect(highIdx).toBeLessThan(midIdx);
        expect(midIdx).toBeLessThan(lowIdx);
    });

    test('caps at MAX_KEYWORDS (100) entries', () => {
        const kws = [];
        for (let i = 0; i < 200; i++) kws.push({ phrase: `kw${i}`, boost: 3, enabled: true });
        const out = resolveKeywords(makeCompany(kws), makeAdmin([]));
        expect(out.length).toBe(_internals.MAX_KEYWORDS);
    });

    test('returns [] gracefully when admin/company are null', () => {
        // First-names mock still returns 3 names, but no crash expected
        const out = resolveKeywords(null, null);
        expect(Array.isArray(out)).toBe(true);
        // Only first names contribute when company is null
        const phrases = parseOut(out).map(p => p.phrase);
        expect(phrases).toContain('marc');
    });

    test('format is "phrase:boost" strings', () => {
        const company = makeCompany([{ phrase: 'Brand Name', boost: 7, enabled: true }]);
        const out = resolveKeywords(company, makeAdmin([]));
        const hit = out.find(s => s.startsWith('brand name:'));
        expect(hit).toBe('brand name:4'); // boost 7 → normalised 4
    });

    test('no hardcoded HVAC fallback anywhere', () => {
        const company = makeCompany([]);
        const admin = makeAdmin([]);
        const out = resolveKeywords(company, admin);
        const joined = out.join('|').toLowerCase();
        // Sanity: none of the old hardcoded HVAC terms should appear from nowhere
        expect(joined).not.toMatch(/hvac/);
        expect(joined).not.toMatch(/thermostat/);
        expect(joined).not.toMatch(/furnace/);
        expect(joined).not.toMatch(/gas leak/);
    });
});
