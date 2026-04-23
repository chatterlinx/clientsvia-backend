/**
 * Unit tests for services/mediaStream/ConfigResolver.js
 * C2 — platform vocabulary + config resolver.
 */

const {
    resolveMediaStreamConfig,
    isMediaStreamsEnabled,
    HARDCODED_FALLBACKS
} = require('../../services/mediaStream/ConfigResolver');

function makeCompany(overrides = {}) {
    return {
        aiAgentSettings: {
            agent2: {
                mediaStreams: overrides
            }
        }
    };
}

function makeAdminSettings(overrides = {}) {
    return {
        globalHub: {
            mediaStreams: overrides
        }
    };
}

describe('ConfigResolver.resolveMediaStreamConfig', () => {
    test('returns hardcoded fallbacks when both inputs are empty', () => {
        const r = resolveMediaStreamConfig(null, null);
        expect(r.model).toBe(HARDCODED_FALLBACKS.model);
        expect(r.endpointingMs).toBe(HARDCODED_FALLBACKS.endpointingMs);
        expect(r.utteranceEndMs).toBe(HARDCODED_FALLBACKS.utteranceEndMs);
        expect(r.language).toBe(HARDCODED_FALLBACKS.language);
        expect(r.enabled).toBe(false);
        expect(r.source.model).toBe('fallback');
        expect(r.source.language).toBe('fallback');
    });

    test('returns platform defaults when tenant has none', () => {
        const admin = makeAdminSettings({
            defaultModel: 'nova-2',
            defaultEndpointingMs: 500,
            defaultUtteranceEndMs: 1200,
            defaultLanguage: 'es-ES'
        });
        const r = resolveMediaStreamConfig(makeCompany({}), admin);
        expect(r.model).toBe('nova-2');
        expect(r.endpointingMs).toBe(500);
        expect(r.utteranceEndMs).toBe(1200);
        expect(r.language).toBe('es-ES');
        expect(r.source.model).toBe('platform');
        expect(r.source.endpointingMs).toBe('platform');
    });

    test('tenant overrides beat platform defaults', () => {
        const admin = makeAdminSettings({
            defaultModel: 'nova-3',
            defaultEndpointingMs: 300,
            defaultLanguage: 'en-US'
        });
        const company = makeCompany({
            enabled: true,
            model: 'nova-2-phonecall',
            endpointingMs: 800,
            languageOverride: 'fr-FR'
        });
        const r = resolveMediaStreamConfig(company, admin);
        expect(r.enabled).toBe(true);
        expect(r.model).toBe('nova-2-phonecall');
        expect(r.endpointingMs).toBe(800);
        expect(r.language).toBe('fr-FR');
        expect(r.source.model).toBe('tenant');
        expect(r.source.endpointingMs).toBe('tenant');
        expect(r.source.language).toBe('tenant');
        // utteranceEndMs should fall through since tenant didn't set it
        expect(r.utteranceEndMs).toBe(HARDCODED_FALLBACKS.utteranceEndMs);
        expect(r.source.utteranceEndMs).toBe('fallback');
    });

    test('null tenant values fall through to platform', () => {
        const admin = makeAdminSettings({ defaultModel: 'nova-3' });
        const company = makeCompany({ model: null, endpointingMs: null });
        const r = resolveMediaStreamConfig(company, admin);
        expect(r.model).toBe('nova-3');
        expect(r.source.model).toBe('platform');
    });

    test('enabled defaults to false when missing', () => {
        expect(resolveMediaStreamConfig({}, {}).enabled).toBe(false);
        expect(resolveMediaStreamConfig(makeCompany({}), {}).enabled).toBe(false);
        expect(resolveMediaStreamConfig(makeCompany({ enabled: true }), {}).enabled).toBe(true);
    });

    test('numeric zero is accepted (edge case — endpointing 0 might be valid tuning)', () => {
        const company = makeCompany({ endpointingMs: 0 });
        const r = resolveMediaStreamConfig(company, {});
        expect(r.endpointingMs).toBe(0);
        expect(r.source.endpointingMs).toBe('tenant');
    });
});

describe('ConfigResolver.isMediaStreamsEnabled', () => {
    test('returns false for missing/null/false', () => {
        expect(isMediaStreamsEnabled(null)).toBe(false);
        expect(isMediaStreamsEnabled({})).toBe(false);
        expect(isMediaStreamsEnabled(makeCompany({}))).toBe(false);
        expect(isMediaStreamsEnabled(makeCompany({ enabled: false }))).toBe(false);
    });

    test('returns true only when explicitly enabled', () => {
        expect(isMediaStreamsEnabled(makeCompany({ enabled: true }))).toBe(true);
    });
});
