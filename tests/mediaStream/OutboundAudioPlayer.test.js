/**
 * OutboundAudioPlayer — unit tests
 *
 * Focus: internal building blocks (voice settings, chunking, media/mark event
 * shapes) + the top-level play() path with a mocked synth that returns a
 * fixed buffer. Does NOT spin up a real WebSocket — uses a fake `ws` with
 * `send`/`readyState`.
 */

'use strict';

describe('OutboundAudioPlayer', () => {
    let player;

    beforeAll(() => {
        // Make sure no real ElevenLabs lookup is attempted.
        process.env.ELEVENLABS_API_KEY = 'test_only';
        player = require('../../services/mediaStream/OutboundAudioPlayer');
    });

    // ------------------------------------------------------------
    // _extractVoiceSettings
    // ------------------------------------------------------------
    describe('_extractVoiceSettings', () => {
        const { _extractVoiceSettings } = require('../../services/mediaStream/OutboundAudioPlayer')._internals;

        test('prefers agent2.voice over legacy voiceSettings', () => {
            const company = {
                aiAgentSettings: {
                    agent2: {
                        voice: {
                            voiceId: 'v-agent2',
                            stability: 0.9,
                            similarityBoost: 0.6,
                            styleExaggeration: 0.1,
                            modelId: 'eleven_custom'
                        }
                    },
                    voiceSettings: {
                        voiceId: 'v-legacy',
                        stability: 0.1,
                        similarityBoost: 0.1,
                        modelId: 'eleven_legacy'
                    }
                }
            };
            const out = _extractVoiceSettings(company);
            expect(out.voiceId).toBe('v-agent2');
            expect(out.stability).toBe(0.9);
            expect(out.similarityBoost).toBe(0.6);
            expect(out.style).toBe(0.1);
            expect(out.modelId).toBe('eleven_custom');
        });

        test('falls back to legacy voiceSettings when agent2.voice absent', () => {
            const company = {
                aiAgentSettings: {
                    voiceSettings: {
                        voiceId: 'v-legacy',
                        stability: 0.42,
                        similarityBoost: 0.5,
                        styleExaggeration: 0.05,
                        modelId: 'eleven_legacy_v2'
                    }
                }
            };
            const out = _extractVoiceSettings(company);
            expect(out.voiceId).toBe('v-legacy');
            expect(out.stability).toBe(0.42);
            expect(out.similarityBoost).toBe(0.5);
            expect(out.style).toBe(0.05);
            expect(out.modelId).toBe('eleven_legacy_v2');
        });

        test('returns null voiceId with sane defaults when no company data', () => {
            const out = _extractVoiceSettings({});
            expect(out.voiceId).toBeNull();
            expect(out.stability).toBe(0.5);
            expect(out.similarityBoost).toBe(0.7);
            expect(out.style).toBe(0);
            expect(out.modelId).toBe('eleven_turbo_v2_5');
        });

        test('null company does not throw', () => {
            const out = _extractVoiceSettings(null);
            expect(out.voiceId).toBeNull();
            expect(out.modelId).toBe('eleven_turbo_v2_5');
        });
    });

    // ------------------------------------------------------------
    // _chunkToBase64Frames
    // ------------------------------------------------------------
    describe('_chunkToBase64Frames', () => {
        const { _chunkToBase64Frames, FRAME_BYTES } = require('../../services/mediaStream/OutboundAudioPlayer')._internals;

        test('FRAME_BYTES is 160 (20ms @ 8kHz ulaw)', () => {
            expect(FRAME_BYTES).toBe(160);
        });

        test('chunks a buffer of exactly 320 bytes into 2 full frames', () => {
            const buf = Buffer.alloc(320, 0xff);
            const frames = _chunkToBase64Frames(buf);
            expect(frames).toHaveLength(2);
            // Each 160-byte frame base64-encodes to 216 chars (ceil(160/3)*4 = 216).
            expect(frames[0].length).toBe(216);
            expect(frames[1].length).toBe(216);
        });

        test('keeps a short trailing frame instead of padding', () => {
            const buf = Buffer.alloc(180, 0x7f);
            const frames = _chunkToBase64Frames(buf);
            expect(frames).toHaveLength(2);
            // Second frame is 20 bytes — base64 of 20 bytes is 28 chars.
            expect(frames[1].length).toBe(28);
        });

        test('empty buffer yields zero frames', () => {
            const frames = _chunkToBase64Frames(Buffer.alloc(0));
            expect(frames).toEqual([]);
        });

        test('round-trip byte fidelity on the first frame', () => {
            const buf = Buffer.from(Array.from({ length: 160 }, (_, i) => i % 256));
            const [b64] = _chunkToBase64Frames(buf);
            const decoded = Buffer.from(b64, 'base64');
            expect(decoded.equals(buf)).toBe(true);
        });
    });

    // ------------------------------------------------------------
    // _buildMediaEvent / _buildMarkEvent
    // ------------------------------------------------------------
    describe('Twilio event shapes', () => {
        const { _buildMediaEvent, _buildMarkEvent } = require('../../services/mediaStream/OutboundAudioPlayer')._internals;

        test('media event shape matches Twilio outbound spec', () => {
            const evt = JSON.parse(_buildMediaEvent('MSxxx', 'AAAB'));
            expect(evt).toEqual({
                event: 'media',
                streamSid: 'MSxxx',
                media: { payload: 'AAAB' }
            });
        });

        test('mark event shape matches Twilio outbound spec', () => {
            const evt = JSON.parse(_buildMarkEvent('MSxxx', 'utt-1'));
            expect(evt).toEqual({
                event: 'mark',
                streamSid: 'MSxxx',
                mark: { name: 'utt-1' }
            });
        });
    });

    // ------------------------------------------------------------
    // play() — end-to-end with mocked synth + fake ws
    // ------------------------------------------------------------
    describe('play()', () => {
        function makeFakeWs({ openState = true, sendBehavior = () => {} } = {}) {
            return {
                readyState: openState ? 1 : 3,
                OPEN: 1,
                sent: [],
                send(payload) {
                    this.sent.push(payload);
                    sendBehavior.call(this, payload);
                }
            };
        }

        const baseCompany = {
            aiAgentSettings: {
                agent2: { voice: { voiceId: 'test-voice', modelId: 'eleven_turbo_v2_5' } }
            }
        };

        test('synthesizes, sends media frames + final mark, returns counters', async () => {
            const ulaw = Buffer.alloc(160 * 3, 0x55); // 3 full frames
            const synth = jest.fn().mockResolvedValue(ulaw);
            const ws = makeFakeWs();

            const result = await player.play({
                ws,
                streamSid: 'MS-test',
                text: 'hello caller',
                company: baseCompany,
                synth
            });

            expect(synth).toHaveBeenCalledTimes(1);
            // Confirm we asked for native ulaw_8000.
            expect(synth.mock.calls[0][0].output_format).toBe('ulaw_8000');
            expect(synth.mock.calls[0][0].voiceId).toBe('test-voice');

            expect(result.framesSent).toBe(3);
            expect(result.cancelled).toBe(false);
            expect(result.markName).toMatch(/^utt-/);
            // 3 media + 1 mark = 4 sends
            expect(ws.sent).toHaveLength(4);
            const last = JSON.parse(ws.sent[3]);
            expect(last.event).toBe('mark');
            expect(last.streamSid).toBe('MS-test');
        });

        test('cancelToken interrupts send loop and suppresses final mark', async () => {
            const ulaw = Buffer.alloc(160 * 200, 0x7f); // 200 frames
            const synth = jest.fn().mockResolvedValue(ulaw);
            const cancelToken = { cancelled: false };
            const ws = makeFakeWs({
                sendBehavior: function () {
                    // Flip cancel on the 5th send to cut the stream short.
                    if (this.sent.length === 5) cancelToken.cancelled = true;
                }
            });

            const result = await player.play({
                ws,
                streamSid: 'MS-cancel',
                text: 'this should get barged',
                company: baseCompany,
                cancelToken,
                synth
            });

            expect(result.cancelled).toBe(true);
            expect(result.markName).toBeNull();
            // No mark event was appended after cancel.
            const kinds = ws.sent.map(s => JSON.parse(s).event);
            expect(kinds).not.toContain('mark');
            // We stopped well short of 200 frames.
            expect(result.framesSent).toBeLessThan(200);
        });

        test('throws when streamSid missing', async () => {
            const ws = makeFakeWs();
            await expect(player.play({
                ws,
                text: 'nope',
                company: baseCompany,
                synth: jest.fn()
            })).rejects.toThrow(/streamSid is required/);
        });

        test('throws when no voiceId resolves for company', async () => {
            const ws = makeFakeWs();
            await expect(player.play({
                ws,
                streamSid: 'MS-x',
                text: 'nope',
                company: { aiAgentSettings: {} },
                synth: jest.fn().mockResolvedValue(Buffer.alloc(160))
            })).rejects.toThrow(/no voiceId resolved/);
        });

        test('returns no-op with empty text (still accepts ws)', async () => {
            const ws = makeFakeWs();
            const result = await player.play({
                ws,
                streamSid: 'MS-x',
                text: '',
                company: baseCompany,
                synth: jest.fn()
            });
            expect(result.framesSent).toBe(0);
            expect(result.cancelled).toBe(true);
            expect(ws.sent).toHaveLength(0);
        });

        test('returns no-op when ws is already closed (readyState !== OPEN)', async () => {
            const ws = makeFakeWs({ openState: false });
            const result = await player.play({
                ws,
                streamSid: 'MS-x',
                text: 'ignored',
                company: baseCompany,
                synth: jest.fn()
            });
            expect(result.framesSent).toBe(0);
            expect(result.cancelled).toBe(true);
        });

        test('propagates synth error', async () => {
            const ws = makeFakeWs();
            const synth = jest.fn().mockRejectedValue(new Error('eleven labs down'));
            await expect(player.play({
                ws,
                streamSid: 'MS-e',
                text: 'x',
                company: baseCompany,
                synth
            })).rejects.toThrow(/eleven labs down/);
            // No frames leaked out before the error.
            expect(ws.sent).toHaveLength(0);
        });

        test('custom markName is used on final mark', async () => {
            const ulaw = Buffer.alloc(160, 0);
            const synth = jest.fn().mockResolvedValue(ulaw);
            const ws = makeFakeWs();
            const result = await player.play({
                ws,
                streamSid: 'MS-m',
                text: 'hi',
                company: baseCompany,
                markName: 'greeting-1',
                synth
            });
            expect(result.markName).toBe('greeting-1');
            const mark = JSON.parse(ws.sent[ws.sent.length - 1]);
            expect(mark.mark.name).toBe('greeting-1');
        });
    });

    // ------------------------------------------------------------
    // clearPlayback — barge-in helper
    // ------------------------------------------------------------
    describe('clearPlayback', () => {
        test('sends a Twilio clear event on an open ws', () => {
            const sends = [];
            const ws = {
                readyState: 1,
                OPEN: 1,
                send(p) { sends.push(p); }
            };
            const ok = player.clearPlayback(ws, 'MS-clear');
            expect(ok).toBe(true);
            expect(sends).toHaveLength(1);
            expect(JSON.parse(sends[0])).toEqual({ event: 'clear', streamSid: 'MS-clear' });
        });

        test('no-op if ws is null', () => {
            expect(player.clearPlayback(null, 'MS')).toBe(false);
        });

        test('no-op if ws not open', () => {
            const ws = { readyState: 3, OPEN: 1, send: () => {} };
            expect(player.clearPlayback(ws, 'MS')).toBe(false);
        });

        test('no-op if streamSid missing', () => {
            const ws = { readyState: 1, OPEN: 1, send: () => {} };
            expect(player.clearPlayback(ws, null)).toBe(false);
        });
    });
});
