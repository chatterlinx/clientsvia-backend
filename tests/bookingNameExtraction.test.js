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
    confirmBack: true,
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
    expect(state.activeSlot).toBe('name');
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
    expect(state.activeSlot).toBe('name');
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
    expect(state.activeSlot).toBe('name');
  });

  test('confirmBack: yes keeps name and advances to phone', () => {
    const company = buildCompany();
    const nameSlotConfig = buildNameSlotConfig({ askFullName: false });

    const { reply, state } = ConversationEngine.__testHandleNameSlotTurn({
      userText: 'yes',
      company,
      nameSlotConfig,
      currentSlots: { name: 'Mark' },
      nameMeta: { first: 'Mark', last: null, confirmed: false },
      activeSlot: 'name',
      phoneQuestion: "What's the best phone number to reach you?"
    });

    expect(state.slots.name).toBe('Mark');
    expect(state.nameMeta.confirmed).toBe(true);
    expect(state.activeSlot).toBe('phone');
    expect(reply.toLowerCase()).toContain('phone');
  });

  test('confirmBack: no with correction rewrites name and re-confirms', () => {
    const company = buildCompany();
    const nameSlotConfig = buildNameSlotConfig({ askFullName: false });

    const { reply, state } = ConversationEngine.__testHandleNameSlotTurn({
      userText: "no, it's mark johnson",
      company,
      nameSlotConfig,
      currentSlots: { name: 'Mark' },
      nameMeta: { first: 'Mark', last: null, confirmed: false },
      activeSlot: 'name'
    });

    expect(state.slots.name).toBe('Mark Johnson');
    expect(state.nameMeta.first).toBe('Mark');
    expect(state.nameMeta.last).toBe('Johnson');
    expect(state.nameMeta.confirmed).toBe(false);
    expect(state.activeSlot).toBe('name');
    expect(reply.toLowerCase()).toContain('mark johnson');
    expect(reply.toLowerCase()).toContain('confirm');
  });

  test('confirmBack: abort intent ends booking', () => {
    const company = buildCompany();
    const nameSlotConfig = buildNameSlotConfig({ askFullName: false });

    const { reply, state } = ConversationEngine.__testHandleNameSlotTurn({
      userText: "no actually I don't want to schedule",
      company,
      nameSlotConfig,
      currentSlots: { name: 'Mark' },
      nameMeta: { first: 'Mark', last: null, confirmed: false },
      activeSlot: 'name',
      abortReply: "Got it! I've taken down your information. Someone will be in touch soon. Is there anything else?"
    });

    expect(state.bookingAborted).toBe(true);
    expect(state.activeSlot).toBeNull();
    expect(reply.toLowerCase()).toContain('taken down your information');
  });

  test('confirmBack: silence reprompts once then aborts', () => {
    const company = buildCompany();
    const nameSlotConfig = buildNameSlotConfig({ askFullName: false });
    const abortReply = "Got it! I've taken down your information. Someone will be in touch soon. Is there anything else?";

    const first = ConversationEngine.__testHandleNameSlotTurn({
      userText: '',
      company,
      nameSlotConfig,
      currentSlots: { name: 'Mark' },
      nameMeta: { first: 'Mark', last: null, confirmed: false, confirmSilenceCount: 0 },
      activeSlot: 'name',
      abortReply
    });

    expect(first.state.activeSlot).toBe('name');
    expect(first.state.nameMeta.confirmSilenceCount).toBe(1);
    expect(first.reply.toLowerCase()).toContain('confirm');

    const second = ConversationEngine.__testHandleNameSlotTurn({
      userText: '',
      company,
      nameSlotConfig,
      currentSlots: { name: 'Mark' },
      nameMeta: { first: 'Mark', last: null, confirmed: false, confirmSilenceCount: 1 },
      activeSlot: 'name',
      abortReply
    });

    expect(second.state.bookingAborted).toBe(true);
    expect(second.state.activeSlot).toBeNull();
    expect(second.reply.toLowerCase()).toContain('taken down your information');
  });
});
