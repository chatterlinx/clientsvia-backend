/**
 * MediaStreamServer — smoke + internals tests
 *
 * Full WS integration (handshake → start → media → turn) requires mocking
 * the @deepgram/sdk live client and spinning up an http.Server; that belongs
 * to the live smoke test. This file guards against broken imports, missing
 * exports, and validates internal helpers that don't need a real WS.
 */

describe('MediaStreamServer module', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    test('exports attachMediaStreamServer + MS_PATH + DEFAULT_MAX_TURN_MS', () => {
        process.env.DEEPGRAM_API_KEY = 'test_only';
        const mod = require('../../services/mediaStream/MediaStreamServer');
        expect(typeof mod.attachMediaStreamServer).toBe('function');
        expect(mod.MS_PATH).toBe('/api/twilio/media-stream');
        expect(mod.DEFAULT_MAX_TURN_MS).toBe(15000);
        expect(mod._internals).toBeDefined();
    });

    test('exposes expected internals for testing', () => {
        process.env.DEEPGRAM_API_KEY = 'test_only';
        const { _internals } = require('../../services/mediaStream/MediaStreamServer');
        expect(typeof _internals._appendTrace).toBe('function');
        expect(typeof _internals._redirectCallToFallback).toBe('function');
        expect(typeof _internals._loadTenantContext).toBe('function');
        expect(typeof _internals._runTurn).toBe('function');
    });

    test('attachMediaStreamServer is a no-op when DEEPGRAM_API_KEY missing', () => {
        delete process.env.DEEPGRAM_API_KEY;
        const { attachMediaStreamServer } = require('../../services/mediaStream/MediaStreamServer');
        // Build a fake http.Server stand-in
        const fakeServer = { on: jest.fn() };
        attachMediaStreamServer(fakeServer);
        // Without API key, no upgrade listener should be installed
        expect(fakeServer.on).not.toHaveBeenCalled();
    });
});

// ----------------------------------------------------------------
// _redirectCallToFallback — Twilio REST rescue path
// ----------------------------------------------------------------
describe('_redirectCallToFallback', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.DEEPGRAM_API_KEY = 'test_only';
    });

    test('returns false when callSid missing', async () => {
        const { _internals } = require('../../services/mediaStream/MediaStreamServer');
        const ok = await _internals._redirectCallToFallback({ _id: 'x' }, null);
        expect(ok).toBe(false);
    });

    test('returns false when twilioConfig missing credentials', async () => {
        const { _internals } = require('../../services/mediaStream/MediaStreamServer');
        const ok = await _internals._redirectCallToFallback(
            { _id: 'c-1', twilioConfig: { accountSid: null } },
            'CA123'
        );
        expect(ok).toBe(false);
    });

    test('returns false when no host hint and no PUBLIC_APP_HOST env', async () => {
        const prior = process.env.PUBLIC_APP_HOST;
        delete process.env.PUBLIC_APP_HOST;

        // Mock twilio so we never attempt a real network call.
        const mockUpdate = jest.fn();
        jest.doMock('twilio', () => jest.fn(() => ({
            calls: jest.fn(() => ({ update: mockUpdate }))
        })));

        const { _internals } = require('../../services/mediaStream/MediaStreamServer');
        const ok = await _internals._redirectCallToFallback(
            {
                _id: 'c-1',
                twilioConfig: { accountSid: 'ACxxx', authToken: 'tok' }
            },
            'CA999',
            null // no host hint
        );
        expect(ok).toBe(false);
        expect(mockUpdate).not.toHaveBeenCalled();

        if (prior) process.env.PUBLIC_APP_HOST = prior;
    });

    test('calls Twilio client.calls(sid).update with per-tenant fallback URL', async () => {
        const mockUpdate = jest.fn().mockResolvedValue({});
        const mockCalls = jest.fn(() => ({ update: mockUpdate }));
        jest.doMock('twilio', () => jest.fn(() => ({ calls: mockCalls })));

        const { _internals } = require('../../services/mediaStream/MediaStreamServer');
        const company = {
            _id: 'tenant-42',
            twilioConfig: { accountSid: 'ACxxx', authToken: 'tok' }
        };
        const ok = await _internals._redirectCallToFallback(company, 'CAabc123', 'example.com');
        expect(ok).toBe(true);
        expect(mockCalls).toHaveBeenCalledWith('CAabc123');
        expect(mockUpdate).toHaveBeenCalledWith({
            url: 'https://example.com/api/twilio/media-stream/tenant-42/fallback',
            method: 'POST'
        });
    });

    test('returns false on Twilio client error (never throws)', async () => {
        jest.doMock('twilio', () => jest.fn(() => ({
            calls: jest.fn(() => ({
                update: jest.fn().mockRejectedValue(new Error('network down'))
            }))
        })));
        const { _internals } = require('../../services/mediaStream/MediaStreamServer');
        const ok = await _internals._redirectCallToFallback(
            {
                _id: 'c',
                twilioConfig: { accountSid: 'AC', authToken: 't' }
            },
            'CA1',
            'h.com'
        );
        expect(ok).toBe(false);
    });
});

// ----------------------------------------------------------------
// _appendTrace — fire-and-forget CallTranscriptV2 append
// ----------------------------------------------------------------
describe('_appendTrace', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.DEEPGRAM_API_KEY = 'test_only';
    });

    test('no-op when companyId or callSid missing', () => {
        const { _internals } = require('../../services/mediaStream/MediaStreamServer');
        // Should not throw, should not hit the model.
        expect(() => _internals._appendTrace(null, 'CA', 'MS_X', {})).not.toThrow();
        expect(() => _internals._appendTrace('c-1', null, 'MS_X', {})).not.toThrow();
    });

    test('swallows all errors from appendTrace (never blocks)', () => {
        const mockAppend = jest.fn().mockRejectedValue(new Error('mongo down'));
        jest.doMock('../../models/CallTranscriptV2', () => ({ appendTrace: mockAppend }));

        const { _internals } = require('../../services/mediaStream/MediaStreamServer');
        // Calling with valid args still returns void — the catch handler is
        // attached inside the function. The test passes if no exception
        // propagates out.
        expect(() => _internals._appendTrace('c', 'CA', 'MS_TURN_EMITTED', { text: 'x' }, 3))
            .not.toThrow();
    });

    test('passes normalised trace shape to CallTranscriptV2.appendTrace', () => {
        const mockAppend = jest.fn().mockResolvedValue({});
        jest.doMock('../../models/CallTranscriptV2', () => ({ appendTrace: mockAppend }));

        const { _internals } = require('../../services/mediaStream/MediaStreamServer');
        _internals._appendTrace('c-1', 'CA-sid', 'MS_STREAM_OPENED', { streamSid: 'MS' }, 0);

        expect(mockAppend).toHaveBeenCalledTimes(1);
        const [cid, csid, entries] = mockAppend.mock.calls[0];
        expect(cid).toBe('c-1');
        expect(csid).toBe('CA-sid');
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            kind: 'MS_STREAM_OPENED',
            turnNumber: 0,
            payload: { streamSid: 'MS' }
        });
        expect(typeof entries[0].ts).toBe('string');
    });
});

// ----------------------------------------------------------------
// _stampSttProvider — C6 STT observability (dual-write)
// ----------------------------------------------------------------
describe('_stampSttProvider', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.DEEPGRAM_API_KEY = 'test_only';
    });

    test('no-op when callSid missing (CallSummary keys by twilioSid)', () => {
        const mockTranscript = jest.fn().mockResolvedValue({});
        const mockSummary = jest.fn().mockResolvedValue({});
        jest.doMock('../../models/CallTranscriptV2', () => ({ setSttProvider: mockTranscript }));
        jest.doMock('../../models/CallSummary', () => ({ setSttProvider: mockSummary }));

        const { _internals } = require('../../services/mediaStream/MediaStreamServer');
        _internals._stampSttProvider('c-1', null, 'media-streams');

        // Transcript requires both IDs; Summary requires callSid. Both skip.
        expect(mockTranscript).not.toHaveBeenCalled();
        expect(mockSummary).not.toHaveBeenCalled();
    });

    test('no-op when companyId missing (transcript needs it; summary gated too)', () => {
        const mockTranscript = jest.fn().mockResolvedValue({});
        const mockSummary = jest.fn().mockResolvedValue({});
        jest.doMock('../../models/CallTranscriptV2', () => ({ setSttProvider: mockTranscript }));
        jest.doMock('../../models/CallSummary', () => ({ setSttProvider: mockSummary }));

        const { _internals } = require('../../services/mediaStream/MediaStreamServer');
        _internals._stampSttProvider(null, 'CA-999', 'media-streams');

        expect(mockTranscript).not.toHaveBeenCalled();
        // Summary still runs — it only needs twilioSid.
        expect(mockSummary).toHaveBeenCalledWith('CA-999', 'media-streams');
    });

    test('dual-writes both models with the same provider value', () => {
        const mockTranscript = jest.fn().mockResolvedValue({});
        const mockSummary = jest.fn().mockResolvedValue({});
        jest.doMock('../../models/CallTranscriptV2', () => ({ setSttProvider: mockTranscript }));
        jest.doMock('../../models/CallSummary', () => ({ setSttProvider: mockSummary }));

        const { _internals } = require('../../services/mediaStream/MediaStreamServer');
        _internals._stampSttProvider('c-1', 'CA-abc', 'media-streams');

        expect(mockTranscript).toHaveBeenCalledWith('c-1', 'CA-abc', 'media-streams');
        expect(mockSummary).toHaveBeenCalledWith('CA-abc', 'media-streams');
    });

    test('passes "mixed" through unchanged for the sticky-flip case', () => {
        const mockTranscript = jest.fn().mockResolvedValue({});
        const mockSummary = jest.fn().mockResolvedValue({});
        jest.doMock('../../models/CallTranscriptV2', () => ({ setSttProvider: mockTranscript }));
        jest.doMock('../../models/CallSummary', () => ({ setSttProvider: mockSummary }));

        const { _internals } = require('../../services/mediaStream/MediaStreamServer');
        _internals._stampSttProvider('c-1', 'CA-abc', 'mixed');

        expect(mockTranscript).toHaveBeenCalledWith('c-1', 'CA-abc', 'mixed');
        expect(mockSummary).toHaveBeenCalledWith('CA-abc', 'mixed');
    });

    test('swallows model-side rejections (never blocks the call)', () => {
        const mockTranscript = jest.fn().mockRejectedValue(new Error('mongo down'));
        const mockSummary = jest.fn().mockRejectedValue(new Error('mongo down'));
        jest.doMock('../../models/CallTranscriptV2', () => ({ setSttProvider: mockTranscript }));
        jest.doMock('../../models/CallSummary', () => ({ setSttProvider: mockSummary }));

        const { _internals } = require('../../services/mediaStream/MediaStreamServer');
        expect(() => _internals._stampSttProvider('c-1', 'CA-x', 'media-streams')).not.toThrow();
    });
});
