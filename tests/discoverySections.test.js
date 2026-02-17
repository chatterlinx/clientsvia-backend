const assert = require('assert');

jest.mock('../services/wiring/AWConfigReader', () => ({
    read: (_reader, _path, fallback) => fallback
}));

const { DiscoveryFlowRunner } = require('../services/engine/DiscoveryFlowRunner');

describe('Discovery sections (S4) are stable and ordered', () => {
    it('emits sectioned S4 events when emitEvent is provided', () => {
        const company = {
            aiAgentSettings: {
                frontDeskBehavior: {
                    slotRegistry: {
                        slots: [
                            { id: 'call_reason_detail', required: false, discoveryFillAllowed: true },
                            { id: 'name', required: true, discoveryFillAllowed: true }
                        ]
                    },
                    discoveryFlow: {
                        enabled: true,
                        steps: [
                            { stepId: 'd0', slotId: 'call_reason_detail', order: 0, ask: 'Got it.', reprompt: 'What can I help you with today?', confirmMode: 'never' },
                            { stepId: 'd1', slotId: 'name', order: 1, askMissing: "What's your first name?", repromptMissing: "Sorry — what's your first name?", ask: 'I have {value}. Is that right?', confirmMode: 'smart_if_captured' }
                        ]
                    }
                }
            }
        };

        const emitted = [];
        const emitEvent = (type, data) => emitted.push({ type, data });

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
            state,
            emitEvent,
            turn: 1
        });

        assert.ok(result?.response);

        const types = emitted.map((e) => e.type);
        const requiredInOrder = [
            'SECTION_S4_0_DISCOVERY_START',
            'SECTION_S4_1_ENGINE_STATE_BUILT',
            'SECTION_S4_2_STEP_ENGINE_RESULT',
            'SECTION_S4_3_PLAIN_SLOTS_MERGED',
            'SECTION_S4_4_POINTERS_ENSURED',
            // Either step_engine_reply path or forced_prompt path, but both must end with:
            'SECTION_S4_6_REPLY_SANITIZED',
            'SECTION_S4_7_DISCOVERY_END'
        ];

        // Ensure all required are present
        for (const t of requiredInOrder) {
            assert.ok(types.includes(t), `missing ${t}`);
        }

        // Ensure the prefix order is stable (first five must be in order)
        const idx = (t) => types.indexOf(t);
        assert.ok(idx('SECTION_S4_0_DISCOVERY_START') < idx('SECTION_S4_1_ENGINE_STATE_BUILT'));
        assert.ok(idx('SECTION_S4_1_ENGINE_STATE_BUILT') < idx('SECTION_S4_2_STEP_ENGINE_RESULT'));
        assert.ok(idx('SECTION_S4_2_STEP_ENGINE_RESULT') < idx('SECTION_S4_3_PLAIN_SLOTS_MERGED'));
        assert.ok(idx('SECTION_S4_3_PLAIN_SLOTS_MERGED') < idx('SECTION_S4_4_POINTERS_ENSURED'));
        assert.ok(idx('SECTION_S4_4_POINTERS_ENSURED') < idx('SECTION_S4_7_DISCOVERY_END'));
    });
});

