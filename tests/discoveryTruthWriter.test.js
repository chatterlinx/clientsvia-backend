/**
 * DiscoveryTruthWriter Tests
 * 
 * Validates the deterministic truth-capture layer that runs BEFORE gates.
 * Tests: apply(), classifyIntent(), extractSymptoms()
 */

const { apply, classifyIntent, extractSymptoms, VERSION } = require('../services/engine/discovery/DiscoveryTruthWriter');

// ═══════════════════════════════════════════════════════════════════════════════
// classifyIntent() — deterministic keyword matching
// ═══════════════════════════════════════════════════════════════════════════════

describe('classifyIntent()', () => {
    test('detects service_request for AC problems', () => {
        const result = classifyIntent('my system is not cooling at all');
        expect(result.intent).toBe('service_request');
        expect(result.confidence).toBeGreaterThan(0.7);
    });
    
    test('detects service_request for "not pulling"', () => {
        const result = classifyIntent('my system is not pulling right now');
        expect(result.intent).toBe('service_request');
        expect(result.confidence).toBeGreaterThan(0.7);
    });
    
    test('detects service_request for leak', () => {
        const result = classifyIntent('there is water leaking from my unit');
        expect(result.intent).toBe('service_request');
        expect(result.confidence).toBeGreaterThan(0.7);
    });
    
    test('detects service_request for noise', () => {
        const result = classifyIntent('my furnace is making a loud banging noise');
        expect(result.intent).toBe('service_request');
        expect(result.confidence).toBeGreaterThan(0.7);
    });
    
    test('detects schedule intent', () => {
        const result = classifyIntent('I need to schedule an appointment');
        expect(result.intent).toBe('schedule');
        expect(result.confidence).toBeGreaterThan(0.7);
    });
    
    test('detects question intent', () => {
        // "tune up" also matches service_request, so use a pure question
        const result = classifyIntent('how much does it cost for an estimate?');
        expect(result.intent).toBe('question');
        expect(result.confidence).toBeGreaterThan(0.5);
    });
    
    test('detects billing intent', () => {
        const result = classifyIntent('I have a question about my bill and payment');
        expect(result.intent).toBe('billing');
        expect(result.confidence).toBeGreaterThan(0.7);
    });
    
    test('detects complaint intent', () => {
        // Avoid "service" which also matches service_request — use pure complaint words
        const result = classifyIntent('I am very unhappy and disappointed, it was terrible and unprofessional');
        expect(result.intent).toBe('complaint');
        expect(result.confidence).toBeGreaterThan(0.7);
    });
    
    test('returns "other" for greetings', () => {
        const result = classifyIntent('hi good morning');
        expect(result.intent).toBe('other');
        expect(result.confidence).toBe(0);
    });
    
    test('returns "other" for empty string', () => {
        const result = classifyIntent('');
        expect(result.intent).toBe('other');
        expect(result.confidence).toBe(0);
    });
    
    test('higher confidence for multiple keyword matches', () => {
        const single = classifyIntent('its broken');
        const multi = classifyIntent('its broken and leaking water with a burning smell');
        expect(multi.confidence).toBeGreaterThanOrEqual(single.confidence);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// extractSymptoms() — pattern-based symptom extraction
// ═══════════════════════════════════════════════════════════════════════════════

describe('extractSymptoms()', () => {
    test('extracts "AC not cooling" from "not cooling"', () => {
        const symptoms = extractSymptoms('my AC is not cooling');
        expect(symptoms).toContain('AC not cooling');
    });
    
    test('extracts "system not pulling" from "not pulling"', () => {
        const symptoms = extractSymptoms('my system is not pulling right now');
        expect(symptoms).toContain('system not pulling');
    });
    
    test('extracts "leaking" from water leak description', () => {
        const symptoms = extractSymptoms('there is a leak under the unit');
        expect(symptoms).toContain('leaking');
    });
    
    test('extracts multiple symptoms', () => {
        const symptoms = extractSymptoms('its not cooling and there is a burning smell and water leaking');
        expect(symptoms.length).toBeGreaterThanOrEqual(3);
        expect(symptoms).toContain('AC not cooling');
        expect(symptoms).toContain('burning smell');
        expect(symptoms).toContain('leaking');
    });
    
    test('deduplicates symptoms', () => {
        const symptoms = extractSymptoms('no cool and not cooling at all');
        const uniqueSymptoms = [...new Set(symptoms)];
        expect(symptoms.length).toBe(uniqueSymptoms.length);
    });
    
    test('returns empty for greetings', () => {
        const symptoms = extractSymptoms('hi good morning');
        expect(symptoms).toEqual([]);
    });
    
    test('detects maintenance request', () => {
        const symptoms = extractSymptoms('I need a tune up');
        expect(symptoms).toContain('maintenance request');
    });
    
    test('detects thermostat issue', () => {
        const symptoms = extractSymptoms('my thermostat is blank');
        expect(symptoms).toContain('thermostat issue');
    });
    
    test('detects urgent request', () => {
        const symptoms = extractSymptoms('this is an emergency, my AC is not working');
        expect(symptoms).toContain('urgent');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// apply() — full truth capture pipeline
// ═══════════════════════════════════════════════════════════════════════════════

describe('apply()', () => {
    function makeCallState() {
        return {};
    }
    
    const discoveryFlowWithReason = {
        enabled: true,
        steps: [
            { slotId: 'call_reason_detail', order: 1 },
            { slotId: 'name', order: 2 }
        ]
    };
    
    const discoveryFlowWithoutReason = {
        enabled: true,
        steps: [
            { slotId: 'name', order: 1 }
        ]
    };
    
    test('captures first_utterance on Turn 1', () => {
        const callState = makeCallState();
        const truth = apply({
            callState,
            cleanedText: 'my system is not pulling right now',
            turn: 1,
            discoveryFlow: discoveryFlowWithReason,
            callSid: 'CA-test',
            companyId: 'comp-test'
        });
        
        expect(truth.first_utterance).toBe('my system is not pulling right now');
        expect(truth.call_intent_guess).toBe('service_request');
        expect(truth.call_intent_confidence).toBeGreaterThan(0);
        expect(truth.call_reason_detail).toBeTruthy();
        expect(truth.updatedAtTurn).toBe(1);
    });
    
    test('first_utterance is write-once (immutable after Turn 1)', () => {
        const callState = makeCallState();
        apply({
            callState,
            cleanedText: 'my system is not pulling',
            turn: 1,
            discoveryFlow: discoveryFlowWithReason,
            callSid: 'CA-test',
            companyId: 'comp-test'
        });
        
        // Second call on turn 2 should NOT overwrite first_utterance
        const truth = apply({
            callState,
            cleanedText: 'yes please',
            turn: 2,
            discoveryFlow: discoveryFlowWithReason,
            callSid: 'CA-test',
            companyId: 'comp-test'
        });
        
        expect(truth.first_utterance).toBe('my system is not pulling');
    });
    
    test('does NOT write call_reason_detail if slot is not in discoveryFlow', () => {
        const callState = makeCallState();
        const truth = apply({
            callState,
            cleanedText: 'my AC is not cooling',
            turn: 1,
            discoveryFlow: discoveryFlowWithoutReason,
            callSid: 'CA-test',
            companyId: 'comp-test'
        });
        
        expect(truth.first_utterance).toBe('my AC is not cooling');
        expect(truth.call_intent_guess).toBe('service_request');
        // call_reason_detail should NOT be written since it's not in discoveryFlow
        expect(truth.call_reason_detail).toBeNull();
    });
    
    test('writes call_reason_detail when slot IS in discoveryFlow', () => {
        const callState = makeCallState();
        const truth = apply({
            callState,
            cleanedText: 'my AC is not cooling and there is a burning smell',
            turn: 1,
            discoveryFlow: discoveryFlowWithReason,
            callSid: 'CA-test',
            companyId: 'comp-test'
        });
        
        expect(truth.call_reason_detail).toBeTruthy();
        expect(truth.call_reason_detail).toContain('AC not cooling');
        expect(truth.call_reason_detail).toContain('burning smell');
    });
    
    test('handles empty input gracefully', () => {
        const callState = makeCallState();
        const truth = apply({
            callState,
            cleanedText: '',
            turn: 1,
            discoveryFlow: discoveryFlowWithReason,
            callSid: 'CA-test',
            companyId: 'comp-test'
        });
        
        expect(truth.first_utterance).toBeNull();
        expect(truth.call_reason_detail).toBeNull();
        expect(truth.call_intent_guess).toBe('other');
    });
    
    test('handles null discoveryFlow gracefully', () => {
        const callState = makeCallState();
        const truth = apply({
            callState,
            cleanedText: 'my system is broken',
            turn: 1,
            discoveryFlow: null,
            callSid: 'CA-test',
            companyId: 'comp-test'
        });
        
        expect(truth.first_utterance).toBe('my system is broken');
        expect(truth.call_intent_guess).toBe('service_request');
        // No discoveryFlow = no call_reason_detail write allowed
        expect(truth.call_reason_detail).toBeNull();
    });
    
    test('appends new symptoms on later turns without overwriting', () => {
        const callState = makeCallState();
        
        // Turn 1: initial problem
        apply({
            callState,
            cleanedText: 'my AC is not cooling',
            turn: 1,
            discoveryFlow: discoveryFlowWithReason,
            callSid: 'CA-test',
            companyId: 'comp-test'
        });
        
        expect(callState.discovery.truth.call_reason_detail).toBe('AC not cooling');
        
        // Turn 2: additional symptom
        apply({
            callState,
            cleanedText: 'also there is a burning smell',
            turn: 2,
            discoveryFlow: discoveryFlowWithReason,
            callSid: 'CA-test',
            companyId: 'comp-test'
        });
        
        expect(callState.discovery.truth.call_reason_detail).toContain('AC not cooling');
        expect(callState.discovery.truth.call_reason_detail).toContain('burning smell');
    });
    
    test('upgrades intent confidence but does not downgrade', () => {
        const callState = makeCallState();
        
        // Turn 1: strong service_request signal
        apply({
            callState,
            cleanedText: 'my system is not cooling and leaking water and making noise',
            turn: 1,
            discoveryFlow: discoveryFlowWithReason,
            callSid: 'CA-test',
            companyId: 'comp-test'
        });
        
        const confidenceAfterTurn1 = callState.discovery.truth.call_intent_confidence;
        
        // Turn 2: weak/no signal (greeting)
        apply({
            callState,
            cleanedText: 'yes',
            turn: 2,
            discoveryFlow: discoveryFlowWithReason,
            callSid: 'CA-test',
            companyId: 'comp-test'
        });
        
        // Should not have downgraded
        expect(callState.discovery.truth.call_intent_confidence).toBe(confidenceAfterTurn1);
        expect(callState.discovery.truth.call_intent_guess).toBe('service_request');
    });
    
    test('truncates first_utterance at 240 chars', () => {
        const callState = makeCallState();
        const longText = 'a'.repeat(300);
        
        apply({
            callState,
            cleanedText: longText,
            turn: 1,
            discoveryFlow: discoveryFlowWithReason,
            callSid: 'CA-test',
            companyId: 'comp-test'
        });
        
        expect(callState.discovery.truth.first_utterance.length).toBe(240);
    });
    
    test('persists truth in callState.discovery.truth structure', () => {
        const callState = makeCallState();
        apply({
            callState,
            cleanedText: 'hi',
            turn: 1,
            discoveryFlow: discoveryFlowWithReason,
            callSid: 'CA-test',
            companyId: 'comp-test'
        });
        
        expect(callState).toHaveProperty('discovery');
        expect(callState.discovery).toHaveProperty('truth');
        expect(callState.discovery.truth).toHaveProperty('first_utterance');
        expect(callState.discovery.truth).toHaveProperty('call_reason_detail');
        expect(callState.discovery.truth).toHaveProperty('call_intent_guess');
        expect(callState.discovery.truth).toHaveProperty('call_intent_confidence');
        expect(callState.discovery.truth).toHaveProperty('updatedAtTurn');
    });
    
    test('VERSION constant is set', () => {
        expect(VERSION).toBe('DISCOVERY_TRUTH_V1');
    });
});
