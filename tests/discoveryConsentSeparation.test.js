const assert = require('assert');
const { FrontDeskCoreRuntime } = require('../services/engine/FrontDeskCoreRuntime');

jest.mock('../utils/logger', () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  security: () => {}
}));

jest.mock('../services/wiring/AWConfigReader', () => ({
  read: (_reader, _path, fallback) => fallback,
  getGlobalFirstNames: () => ['mark', 'john', 'mike'],
  getGlobalLastNames: () => ['smith', 'johnson', 'garcia']
}));

jest.mock('../services/BlackBoxLogger', () => ({
  logEvent: () => Promise.resolve()
}));

jest.mock('../services/ScenarioEngine', () => ({
  selectResponse: async () => ({ selected: false })
}));

describe('Discovery/Booking separation', () => {
  it('does not ask booking consent until discovery is complete', async () => {
    const company = {
      _id: 'c1',
      aiAgentSettings: {
        frontDeskBehavior: {
          // Keep gates enabled by default, but nothing should trigger.
          escalation: { enabled: false },
          connectionQualityGate: { enabled: false },
          openers: { enabled: false },
          discoveryConsent: {
            enabled: true,
            consentQuestion: 'Would you like to book an appointment?'
          },
          slotRegistry: {
            slots: [
              { id: 'call_reason_detail', required: true, discoveryFillAllowed: true },
              { id: 'name', required: true, discoveryFillAllowed: true },
              { id: 'phone', required: true, discoveryFillAllowed: true },
              { id: 'address', required: true, discoveryFillAllowed: true }
            ]
          },
          discoveryFlow: {
            enabled: true,
            steps: [
              { stepId: 'd0', slotId: 'call_reason_detail', order: 0, askMissing: 'What can I help you with today?', repromptMissing: 'What can I help you with today?', confirmMode: 'never' },
              { stepId: 'd1', slotId: 'name', order: 1, askMissing: "What's your first name?", repromptMissing: "Sorry — what's your first name?", confirmMode: 'never' },
              { stepId: 'd2', slotId: 'phone', order: 2, askMissing: "What's the best phone number to reach you?", repromptMissing: "What's the best phone number to reach you?", confirmMode: 'never' },
              { stepId: 'd3', slotId: 'address', order: 3, askMissing: "What's the service address?", repromptMissing: "What's the service address?", confirmMode: 'never' }
            ]
          }
        }
      }
    };

    const callState = { turnCount: 0, sessionMode: 'DISCOVERY', slots: {} };

    // Turn 1: caller provides reason only
    const r1 = await FrontDeskCoreRuntime.processTurn(
      company.aiAgentSettings,
      callState,
      'My AC is not cooling.',
      { company, callSid: 'CA-test', companyId: 'c1', callerPhone: '+123', turnCount: 1 }
    );

    const r1Text = `${r1.response || ''}`.toLowerCase();
    assert.ok(r1Text.includes("what's your") || r1Text.includes('first name'));
    assert.ok(!r1Text.includes('book an appointment'));
    assert.ok(Array.isArray(r1.turnEventBuffer));
    assert.strictEqual(r1.turnEventBuffer.some((e) => e.type === 'CONSENT_GATE_ASK'), false);
  });
});

