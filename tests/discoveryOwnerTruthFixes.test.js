const assert = require('assert');
const { StateStore } = require('../services/engine/StateStore');

jest.mock('../services/wiring/AWConfigReader', () => ({
    read: (_reader, _path, fallback) => fallback,
    getGlobalFirstNames: () => ['mark', 'john', 'mike'],
    getGlobalLastNames: () => ['smith', 'johnson', 'garcia']
}));
jest.mock('../services/BlackBoxLogger', () => ({
    logEvent: () => Promise.resolve()
}));

const SlotExtractor = require('../services/engine/booking/SlotExtractor');
const { StepEngine } = require('../services/engine/StepEngine');
const { DiscoveryFlowRunner } = require('../services/engine/DiscoveryFlowRunner');

describe('Discovery truth hardening', () => {
    it('derives legacy presence flags from slots on persist', () => {
        const callState = {
            callReasonCaptured: false,
            namePresent: false,
            addressPresent: false
        };
        const state = {
            lane: 'DISCOVERY',
            plainSlots: {
                call_reason_detail: 'AC not cooling',
                name: 'Mark',
                address: '123 Main St'
            },
            discovery: {},
            consent: {},
            booking: {}
        };

        const persisted = StateStore.persist(callState, state);
        assert.strictEqual(persisted.callReasonCaptured, true);
        assert.strictEqual(persisted.namePresent, true);
        assert.strictEqual(persisted.addressPresent, true);
    });

    it('marks callReasonCaptured true when reason exists in pending slots', () => {
        const callState = {
            slots: {},
            pendingSlots: {
                call_reason_detail: 'water leak'
            }
        };

        const loaded = StateStore.load(callState);
        assert.strictEqual(loaded.callReasonCaptured, true);
    });

    it('treats pending name/address as present for truth flags', () => {
        const callState = {
            slots: {},
            pendingSlots: {
                name: 'Mark',
                address: '123 Main St'
            }
        };
        const loaded = StateStore.load(callState);
        assert.strictEqual(loaded.namePresent, true);
        assert.strictEqual(loaded.addressPresent, true);
    });

    it('extracts call_reason_detail from utterance when slot exists in registry', () => {
        const extracted = SlotExtractor.extractAll('my AC is not cooling and leaking water', {
            turnCount: 1,
            slotRegistry: {
                slots: [
                    { id: 'call_reason_detail', discoveryFillAllowed: true }
                ]
            }
        });

        assert.ok(extracted.call_reason_detail);
        assert.strictEqual(extracted.call_reason_detail.source, 'utterance');
        assert.ok(
            extracted.call_reason_detail.value.includes('AC not cooling') ||
            extracted.call_reason_detail.value.includes('water leak')
        );
    });

    it('does not extract call_reason_detail for greeting-only utterance', () => {
        const extracted = SlotExtractor.extractAll('good morning', {
            turnCount: 1,
            slotRegistry: {
                slots: [
                    { id: 'call_reason_detail', discoveryFillAllowed: true }
                ]
            }
        });

        assert.strictEqual(extracted.call_reason_detail, undefined);
    });

    it('does not extract call_reason_detail when slot is not configured', () => {
        const extracted = SlotExtractor.extractAll('my AC is not cooling', {
            turnCount: 1,
            slotRegistry: {
                slots: [{ id: 'name', discoveryFillAllowed: true }]
            }
        });

        assert.strictEqual(extracted.call_reason_detail, undefined);
    });

    it('normalizes duplicate discovery step orders at runtime', () => {
        const company = {
            aiAgentSettings: {
                frontDeskBehavior: {
                    slotRegistry: {
                        slots: [
                            { id: 'call_reason_detail', required: false },
                            { id: 'name', required: true }
                        ]
                    },
                    discoveryFlow: {
                        enabled: true,
                        steps: [
                            { stepId: 'd0', slotId: 'call_reason_detail', order: 3, ask: 'What can I help with?', confirmMode: 'never' },
                            { stepId: 'd1', slotId: 'name', order: 3, ask: 'What is your first name?', confirmMode: 'never' }
                        ]
                    }
                }
            }
        };
        const engine = StepEngine.forCall({ company, callId: 'CA-test' });
        const orders = (engine.discoveryFlow.steps || []).map((s) => s.order);
        assert.strictEqual(new Set(orders).size, orders.length);
    });

    it('uses discovery reprompt as initial ask when askMissing/ask are absent (UI-driven)', () => {
        const company = {
            aiAgentSettings: {
                frontDeskBehavior: {
                    slotRegistry: {
                        slots: [
                            { id: 'call_reason_detail', required: true, discoveryFillAllowed: true }
                        ]
                    },
                    discoveryFlow: {
                        enabled: true,
                        steps: [
                            // Simulates UI that only provides a Reprompt field.
                            { stepId: 'd0', slotId: 'call_reason_detail', order: 0, reprompt: 'What can I help you with today?', confirmMode: 'never' }
                        ]
                    }
                }
            }
        };
        const engine = StepEngine.forCall({ company, callId: 'CA-test' });
        const result = engine.runDiscoveryStep({
            state: {
                currentFlow: 'discovery',
                collectedSlots: {},
                confirmedSlots: {},
                repromptCount: {},
                pendingConfirmation: null,
                currentStepId: null,
                currentSlotId: null,
                slotMeta: {}
            },
            userInput: '',
            extractedSlots: {}
        });
        // First ask should come from reprompt when no ask/askMissing exists.
        assert.ok(`${result.reply || ''}`.toLowerCase().includes('what can i help you with today'));
    });

    it('ensures discovery step pointers are never persisted as null', () => {
        const company = {
            aiAgentSettings: {
                frontDeskBehavior: {
                    discoveryFlow: {
                        enabled: true,
                        steps: [
                            { stepId: 'd0', slotId: 'call_reason_detail', order: 0, ask: 'Got it.', reprompt: 'What can I help you with today?', confirmMode: 'never' },
                            { stepId: 'd1', slotId: 'name', order: 1, ask: 'What is your first name?', confirmMode: 'never' }
                        ]
                    }
                }
            }
        };
        const state = {
            lane: 'DISCOVERY',
            plainSlots: {},
            slotMeta: {},
            discovery: {
                currentStepId: null,
                currentSlotId: null,
                repromptCount: {},
                confirmedSlots: {},
                pendingConfirmation: null
            },
            booking: {}
        };

        const result = DiscoveryFlowRunner.run({
            company,
            callSid: 'CA-test',
            userInput: '',
            state
        });

        assert.ok(result.state.discovery.currentStepId);
        assert.ok(result.state.discovery.currentSlotId);
    });

    it('persists and reloads discoveryComplete flag', () => {
        const callState = {};
        const state = {
            lane: 'DISCOVERY',
            plainSlots: { call_reason_detail: 'AC not cooling' },
            discovery: { currentStepId: 'd3', currentSlotId: 'address', complete: true },
            consent: {},
            booking: {}
        };

        const persisted = StateStore.persist(callState, state);
        assert.strictEqual(persisted.discoveryComplete, true);

        const loaded = StateStore.load(persisted);
        assert.strictEqual(loaded.discovery.complete, true);
    });
});
