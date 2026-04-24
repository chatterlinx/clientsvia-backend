/**
 * Unit tests for services/mediaStream/TurnLifecycleAdapter.js
 * Pure state machine — zero network.
 */

const TurnLifecycleAdapter = require('../../services/mediaStream/TurnLifecycleAdapter');

function transcript(text, { isFinal = false, speechFinal = false, confidence = 0.9 } = {}) {
    return {
        is_final: isFinal,
        speech_final: speechFinal,
        channel: { alternatives: [{ transcript: text, confidence }] }
    };
}

describe('TurnLifecycleAdapter.handleTranscript', () => {
    test('interim transcripts emit onPartial, no onFinal', () => {
        const adapter = new TurnLifecycleAdapter();
        const partials = [];
        const finals = [];
        adapter.on('onPartial', (p) => partials.push(p));
        adapter.on('onFinal', (p) => finals.push(p));

        adapter.handleTranscript(transcript('hello'));
        adapter.handleTranscript(transcript('hello world'));

        expect(partials).toHaveLength(2);
        expect(partials[1].text).toBe('hello world');
        expect(partials[1].kind).toBe('interim');
        expect(finals).toHaveLength(0);
    });

    test('is_final (not speech_final) commits segment to buffer but does not emit final', () => {
        const adapter = new TurnLifecycleAdapter();
        const partials = [];
        const finals = [];
        adapter.on('onPartial', (p) => partials.push(p));
        adapter.on('onFinal', (p) => finals.push(p));

        adapter.handleTranscript(transcript('hello', { isFinal: true }));
        adapter.handleTranscript(transcript('world', { isFinal: true }));

        expect(finals).toHaveLength(0);
        // Two interim_committed partials reflecting buffer progress
        expect(partials).toHaveLength(2);
        expect(partials[1].text).toBe('hello world');
        expect(partials[1].kind).toBe('interim_committed');
    });

    test('speech_final commits buffer and emits onFinal with concatenated text', () => {
        const adapter = new TurnLifecycleAdapter();
        const finals = [];
        adapter.on('onFinal', (p) => finals.push(p));

        adapter.handleTranscript(transcript('hello', { isFinal: true }));
        adapter.handleTranscript(transcript('there friend', { isFinal: true, speechFinal: true, confidence: 0.82 }));

        expect(finals).toHaveLength(1);
        expect(finals[0].text).toBe('hello there friend');
        expect(finals[0].confidence).toBe(0.82);
        expect(finals[0].reason).toBe('speech_final');
        expect(finals[0].turnIndex).toBe(1);
    });

    test('adapter resets buffer after emitting onFinal', () => {
        const adapter = new TurnLifecycleAdapter();
        const finals = [];
        adapter.on('onFinal', (p) => finals.push(p));

        adapter.handleTranscript(transcript('first', { isFinal: true, speechFinal: true }));
        adapter.handleTranscript(transcript('second', { isFinal: true, speechFinal: true }));

        expect(finals).toHaveLength(2);
        expect(finals[0].text).toBe('first');
        expect(finals[1].text).toBe('second');
        expect(finals[1].turnIndex).toBe(2);
    });

    test('empty transcript is ignored', () => {
        const adapter = new TurnLifecycleAdapter();
        const partials = [];
        const finals = [];
        adapter.on('onPartial', (p) => partials.push(p));
        adapter.on('onFinal', (p) => finals.push(p));

        adapter.handleTranscript(transcript(''));
        adapter.handleTranscript(transcript('   '));

        expect(partials).toHaveLength(0);
        expect(finals).toHaveLength(0);
    });
});

describe('TurnLifecycleAdapter.handleUtteranceEnd', () => {
    test('commits buffer on UtteranceEnd even without speech_final', () => {
        const adapter = new TurnLifecycleAdapter();
        const finals = [];
        adapter.on('onFinal', (p) => finals.push(p));

        adapter.handleTranscript(transcript('segment one', { isFinal: true }));
        adapter.handleUtteranceEnd({});

        expect(finals).toHaveLength(1);
        expect(finals[0].text).toBe('segment one');
        expect(finals[0].reason).toBe('utterance_end');
    });

    test('uses lastInterim when no committed buffer exists', () => {
        const adapter = new TurnLifecycleAdapter();
        const finals = [];
        adapter.on('onFinal', (p) => finals.push(p));

        adapter.handleTranscript(transcript('interim only'));
        adapter.handleUtteranceEnd({});

        expect(finals).toHaveLength(1);
        expect(finals[0].text).toBe('interim only');
    });

    test('no-op when buffer and interim are both empty', () => {
        const adapter = new TurnLifecycleAdapter();
        const finals = [];
        adapter.on('onFinal', (p) => finals.push(p));
        adapter.handleUtteranceEnd({});
        expect(finals).toHaveLength(0);
    });
});

describe('TurnLifecycleAdapter.handleSpeechStarted (barge-in)', () => {
    test('emits onBargeIn only when TTS is playing', () => {
        const adapter = new TurnLifecycleAdapter();
        const bargeIns = [];
        adapter.on('onBargeIn', (p) => bargeIns.push(p));

        adapter.handleSpeechStarted({});
        expect(bargeIns).toHaveLength(0);

        adapter.setTtsPlaying(true);
        adapter.handleSpeechStarted({});
        expect(bargeIns).toHaveLength(1);

        adapter.setTtsPlaying(false);
        adapter.handleSpeechStarted({});
        expect(bargeIns).toHaveLength(1);
    });
});

describe('TurnLifecycleAdapter.tick', () => {
    test('emits onIdle with correct silentMs', () => {
        const adapter = new TurnLifecycleAdapter();
        const idles = [];
        adapter.on('onIdle', (p) => idles.push(p));

        // Prime lastSegmentAt
        adapter.handleTranscript(transcript('hi'));
        const t = adapter.getState().lastSegmentAt;
        adapter.tick(t + 1500);

        expect(idles).toHaveLength(1);
        expect(idles[0].silentMs).toBe(1500);
    });

    test('silentMs=0 when no events yet', () => {
        const adapter = new TurnLifecycleAdapter();
        const idles = [];
        adapter.on('onIdle', (p) => idles.push(p));
        adapter.tick(1000);
        expect(idles[0].silentMs).toBe(0);
    });
});

describe('TurnLifecycleAdapter error isolation', () => {
    test('handler that throws does not crash the adapter', () => {
        const adapter = new TurnLifecycleAdapter();
        adapter.on('onPartial', () => { throw new Error('boom'); });
        // Should not throw
        expect(() => adapter.handleTranscript(transcript('hi'))).not.toThrow();
    });
});

describe('TurnLifecycleAdapter.on validation', () => {
    test('rejects unknown event names', () => {
        const adapter = new TurnLifecycleAdapter();
        expect(() => adapter.on('onNope', () => {})).toThrow(/Unknown event/);
    });

    test('rejects non-function handlers', () => {
        const adapter = new TurnLifecycleAdapter();
        expect(() => adapter.on('onPartial', 'not a fn')).toThrow(/must be a function/);
    });
});
