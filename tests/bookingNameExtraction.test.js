const ConversationEngine = require('../services/ConversationEngine');

function buildCompany(overrides = {}) {
  return {
    aiAgentSettings: {
      frontDeskBehavior: {
        commonFirstNames: ['Mark', 'Marc', 'John'],
        ...(overrides.frontDeskBehavior || {})
      },
      nameStopWords: {
        enabled: true,
        custom: []
      },
      ...(overrides.aiAgentSettings || {})
    }
  };
}

function buildNameSlotConfig(overrides = {}) {
  return {
    askFullName: false,
    confirmPrompt: "Just to confirm, that's {value}, correct?",
    lastNameQuestion: 'Thanks, {firstName}. And your last name?',
    ...overrides
  };
}

describe('Booking name handling', () => {
  test('single token completes name in first-name mode', () => {
    const company = buildCompany();
    const nameSlotConfig = buildNameSlotConfig({ askFullName: false });

    const { reply, state } = ConversationEngine.__testHandleNameSlotTurn({
      userText: 'mark',
      company,
      nameSlotConfig
    });

    expect(state.slots.name).toBe('Mark');
    expect(state.nameMeta.first).toBe('Mark');
    expect(state.nameMeta.last).toBeNull();
    expect(reply.toLowerCase()).toContain('confirm');
    expect(reply.toLowerCase()).toContain('mark');
  });

  test('single token becomes partial in full-name mode and asks for last name', () => {
    const company = buildCompany();
    const nameSlotConfig = buildNameSlotConfig({ askFullName: true });

    const { reply, state } = ConversationEngine.__testHandleNameSlotTurn({
      userText: 'mark',
      company,
      nameSlotConfig
    });

    expect(state.slots.name).toBeUndefined();
    expect(state.nameMeta.first).toBe('Mark');
    expect(state.nameMeta.last).toBeNull();
    expect(state.nameMeta.askedMissingPartOnce).toBe(true);
    expect(reply.toLowerCase()).toContain('last name');
  });

  test('full name completes slot in full-name mode', () => {
    const company = buildCompany();
    const nameSlotConfig = buildNameSlotConfig({ askFullName: true });

    const { reply, state } = ConversationEngine.__testHandleNameSlotTurn({
      userText: 'mark johnson',
      company,
      nameSlotConfig
    });

    expect(state.slots.name).toBe('Mark Johnson');
    expect(state.nameMeta.first).toBe('Mark');
    expect(state.nameMeta.last).toBe('Johnson');
    expect(reply.toLowerCase()).toContain('confirm');
    expect(reply.toLowerCase()).toContain('mark johnson');
  });
});
