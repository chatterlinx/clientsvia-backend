/**
 * Import-level smoke test for services/mediaStream/MediaStreamServer.js.
 *
 * Full WS integration (handshake → start → media → turn) requires mocking
 * the @deepgram/sdk live client and spinning up an http.Server; that belongs
 * to the C3 integration suite and is deferred to the live smoke test. This
 * file guards against broken imports / missing exports / typos.
 */

describe('MediaStreamServer module', () => {
    test('exports attachMediaStreamServer + MS_PATH', () => {
        process.env.DEEPGRAM_API_KEY = 'test_only';
        const mod = require('../../services/mediaStream/MediaStreamServer');
        expect(typeof mod.attachMediaStreamServer).toBe('function');
        expect(mod.MS_PATH).toBe('/api/twilio/media-stream');
        expect(mod._internals).toBeDefined();
    });

    test('attachMediaStreamServer is a no-op when DEEPGRAM_API_KEY missing', () => {
        delete process.env.DEEPGRAM_API_KEY;
        jest.resetModules();
        const { attachMediaStreamServer } = require('../../services/mediaStream/MediaStreamServer');
        // Build a fake http.Server stand-in
        const fakeServer = { on: jest.fn() };
        attachMediaStreamServer(fakeServer);
        // Without API key, no upgrade listener should be installed
        expect(fakeServer.on).not.toHaveBeenCalled();
    });
});
