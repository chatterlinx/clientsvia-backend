'use strict';

/**
 * Unit tests for services/engine/kc/AnchorSynonymResolver.
 *
 * The resolver underpins the UAP "Logic 1 / Word Gate" synonym expansion.
 * These tests lock the contract:
 *   - Empty config → empty map → literal-only matching (legacy behaviour).
 *   - Platform map honoured.
 *   - Tenant override REPLACES platform list for that key (no surprise unions).
 *   - Tenant empty array DISABLES platform synonyms for that key.
 *   - Multi-token synonyms require ALL tokens present in input.
 *   - Apostrophes survive normalisation symmetrically on both sides.
 *   - Real-world Turn 1 scenario ("system is not cooling" / anchors
 *     ["ac","not","cooling"]) hits 3/3 with the platform default seed.
 */

const { stem } = require('../utils/stem');
const R = require('../services/engine/kc/AnchorSynonymResolver');

function tokenize(s) {
    const raw = String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    return { inputExact: new Set(raw), inputStems: new Set(raw.map(stem)) };
}

beforeEach(() => {
    R._resetAdminSettingsCache();
});

describe('AnchorSynonymResolver.resolveSynonyms', () => {
    test('empty config returns empty map', async () => {
        const map = await R.resolveSynonyms({ company: null, adminSettings: {} });
        expect(map.size).toBe(0);
    });

    test('platform synonyms loaded via globalHub', async () => {
        const adminSettings = {
            globalHub: {
                anchorSynonyms: {
                    ac: ['system', 'unit', 'air conditioner'],
                },
            },
        };
        const map = await R.resolveSynonyms({ company: null, adminSettings });
        expect(map.size).toBe(1);
        expect(map.has('ac')).toBe(true);
        expect(map.get('ac')).toHaveLength(3);
    });

    test('tenant override REPLACES platform list (no union)', async () => {
        const adminSettings = {
            globalHub: { anchorSynonyms: { ac: ['system', 'unit', 'air conditioner'] } },
        };
        const company = {
            aiAgentSettings: {
                agent2: {
                    speechDetection: {
                        anchorSynonyms: { ac: ['only this one phrase'] },
                    },
                },
            },
        };
        const map = await R.resolveSynonyms({ company, adminSettings });
        expect(map.get('ac')).toHaveLength(1);
        expect(map.get('ac')[0].original).toBe('only this one phrase');
    });

    test('tenant empty array DISABLES platform synonyms for that key', async () => {
        const adminSettings = {
            globalHub: { anchorSynonyms: { ac: ['system', 'unit'] } },
        };
        const company = {
            aiAgentSettings: { agent2: { speechDetection: { anchorSynonyms: { ac: [] } } } },
        };
        const map = await R.resolveSynonyms({ company, adminSettings });
        expect(map.has('ac')).toBe(false);
    });

    test('tenant adds keys not in platform map', async () => {
        const adminSettings = {
            globalHub: { anchorSynonyms: { ac: ['system'] } },
        };
        const company = {
            aiAgentSettings: {
                agent2: {
                    speechDetection: {
                        anchorSynonyms: { thermostat: ['stat', 'tstat'] },
                    },
                },
            },
        };
        const map = await R.resolveSynonyms({ company, adminSettings });
        expect(map.has('ac')).toBe(true);
        // Anchor key is stem("thermostat"). Stemmer doesn't strip — ends in "t",
        // no rule fires. So key is "thermostat" verbatim.
        expect(map.has('thermostat')).toBe(true);
        expect(map.size).toBe(2);
    });

    test('null/undefined company falls back to platform only', async () => {
        const adminSettings = {
            globalHub: { anchorSynonyms: { ac: ['system'] } },
        };
        const map = await R.resolveSynonyms({ company: null, adminSettings });
        expect(map.size).toBe(1);
    });
});

describe('AnchorSynonymResolver.matchAnchor', () => {
    let synonymMap;
    beforeAll(async () => {
        synonymMap = await R.resolveSynonyms({
            company: null,
            adminSettings: {
                globalHub: {
                    anchorSynonyms: {
                        ac: ['system', 'unit', 'air conditioner', 'central air'],
                        not: ["ain't", "isn't", "doesn't"],
                        broken: ['busted', "doesn't work"],
                    },
                },
            },
        });
    });

    test('Turn 1 of CAe8e444a9 — system is not cooling — passes 3/3 anchors', () => {
        const { inputExact, inputStems } = tokenize('system is not cooling');
        const anchors = ['ac', 'not', 'cooling'];
        const results = anchors.map(aw =>
            R.matchAnchor({ anchorWord: aw, inputExact, inputStems, synonymMap })
        );
        const hits = results.filter(r => r.matched).length;
        expect(hits).toBe(3);
        expect(results[0]).toEqual({ matched: true, via: 'synonym', synonymPhrase: 'system' });
        expect(results[1]).toEqual({ matched: true, via: 'literal' });
        expect(results[2]).toEqual({ matched: true, via: 'literal' });
    });

    test('off-topic input still misses unrelated anchors', () => {
        const { inputExact, inputStems } = tokenize('what time do you open');
        const anchors = ['ac', 'not', 'cooling'];
        const results = anchors.map(aw =>
            R.matchAnchor({ anchorWord: aw, inputExact, inputStems, synonymMap })
        );
        const hits = results.filter(r => r.matched).length;
        expect(hits).toBe(0);
    });

    test("apostrophe form caller (it isn't working) hits anchor 'not' via synonym", () => {
        const { inputExact, inputStems } = tokenize("it isn't working");
        const r = R.matchAnchor({ anchorWord: 'not', inputExact, inputStems, synonymMap });
        expect(r.matched).toBe(true);
        expect(r.via).toBe('synonym');
        expect(r.synonymPhrase).toBe("isn't");
    });

    test('multi-token synonym requires ALL tokens present', () => {
        // "doesn't work" → tokens ["doesn","t","work"]
        // Caller "it doesn't run" has "doesn" + "t" but not "work" → MISS
        const { inputExact, inputStems } = tokenize("it doesn't run");
        const r = R.matchAnchor({ anchorWord: 'broken', inputExact, inputStems, synonymMap });
        expect(r.matched).toBe(false);
    });

    test('multi-token synonym matches when all tokens present', () => {
        const { inputExact, inputStems } = tokenize("it doesn't work");
        const r = R.matchAnchor({ anchorWord: 'broken', inputExact, inputStems, synonymMap });
        expect(r.matched).toBe(true);
        expect(r.via).toBe('synonym');
    });

    test('literal match always wins over synonym (zero-cost shortcut)', () => {
        const { inputExact, inputStems } = tokenize('the AC is not cooling');
        const r = R.matchAnchor({ anchorWord: 'ac', inputExact, inputStems, synonymMap });
        expect(r.matched).toBe(true);
        expect(r.via).toBe('literal');
    });

    test('empty synonym map → literal-only behaviour (legacy)', () => {
        const empty = new Map();
        const { inputExact, inputStems } = tokenize('system is not cooling');
        const r = R.matchAnchor({ anchorWord: 'ac', inputExact, inputStems, synonymMap: empty });
        expect(r.matched).toBe(false);
        expect(r.via).toBe('none');
    });

    test('null anchorWord returns no match', () => {
        const { inputExact, inputStems } = tokenize('system');
        const r = R.matchAnchor({ anchorWord: null, inputExact, inputStems, synonymMap });
        expect(r.matched).toBe(false);
    });
});

describe('AnchorSynonymResolver.computeAnchorAnchoredWindow', () => {
    let synonymMap;
    beforeAll(async () => {
        synonymMap = await R.resolveSynonyms({
            company: null,
            adminSettings: {
                globalHub: {
                    anchorSynonyms: {
                        ac: ['system', 'unit'],
                    },
                },
            },
        });
    });

    test('Turn 2-style compound input — slices around "pay ... again"', () => {
        // Caller compound utterance — wide first clause, tight question second clause.
        const result = R.computeAnchorAnchoredWindow({
            rawInput:    'how much would it cost would somebody come back and would i have to pay again',
            anchorWords: ['pay', 'again'],
            synonymMap,
            paddingWords: 2,
        });
        expect(result).not.toBeNull();
        // Window should contain both anchors and be much shorter than the full input.
        expect(result.window).toContain('pay');
        expect(result.window).toContain('again');
        // Should NOT contain the unrelated front clause "how much would it cost".
        expect(result.window.startsWith('how')).toBe(false);
    });

    test('synonym-anchored — caller used "system" for anchor "ac"', () => {
        const result = R.computeAnchorAnchoredWindow({
            rawInput:    "the system is not cooling and it's making a weird noise too",
            anchorWords: ['ac', 'cooling'],
            synonymMap,
            paddingWords: 2,
        });
        expect(result).not.toBeNull();
        // "system" satisfied "ac" via synonym; "cooling" was literal. Window
        // should bracket those positions.
        expect(result.window).toContain('system');
        expect(result.window).toContain('cooling');
    });

    test('returns null when no anchor positions found in input', () => {
        const result = R.computeAnchorAnchoredWindow({
            rawInput:    'what time do you open',
            anchorWords: ['ac', 'pay'],
            synonymMap,
            paddingWords: 2,
        });
        expect(result).toBeNull();
    });

    test('respects padding bounds at input edges', () => {
        // Anchor at position 0 — padding can't go negative.
        const result = R.computeAnchorAnchoredWindow({
            rawInput:    'pay again now please',
            anchorWords: ['pay', 'again'],
            synonymMap,
            paddingWords: 5,
        });
        expect(result).not.toBeNull();
        expect(result.span.min).toBe(0);
        expect(result.window).toBe('pay again now please');  // padding clipped at end
    });

    test('handles empty / nullish input gracefully', () => {
        expect(R.computeAnchorAnchoredWindow({ rawInput: '', anchorWords: ['ac'], synonymMap })).toBeNull();
        expect(R.computeAnchorAnchoredWindow({ rawInput: 'hello', anchorWords: [], synonymMap })).toBeNull();
        expect(R.computeAnchorAnchoredWindow({ rawInput: null, anchorWords: ['ac'], synonymMap })).toBeNull();
    });
});
