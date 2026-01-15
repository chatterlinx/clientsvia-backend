const ConversationEngine = require('../services/ConversationEngine');

function buildCompany() {
  return {
    aiAgentSettings: {
      frontDeskBehavior: {
        bookingAbortPhrases: [
          "don't want to schedule",
          'cancel',
          'never mind'
        ]
      }
    }
  };
}

function buildSlotConfig(overrides = {}) {
  return {
    confirmBack: true,
    confirmPrompt: "Just to confirm, that's {value}, correct?",
    question: 'What is the value?',
    ...overrides
  };
}

describe('ConfirmBack contract for phone/address/time', () => {
  test('phone confirm yes advances to address', () => {
    const { reply, state } = ConversationEngine.__testHandleConfirmSlotTurn({
      slotType: 'phone',
      userText: 'yes',
      company: buildCompany(),
      slotConfig: buildSlotConfig({ question: "What's the best phone number to reach you?" }),
      slotMeta: { pendingConfirm: true, confirmed: false },
      currentSlots: { phone: '2395551234' },
      nextSlotType: 'address',
      nextQuestion: "What's the service address?"
    });

    expect(state.slotMeta.confirmed).toBe(true);
    expect(state.activeSlot).toBe('address');
    expect(reply.toLowerCase()).toContain('address');
  });

  test('phone confirm no with correction re-confirms', () => {
    const { reply, state } = ConversationEngine.__testHandleConfirmSlotTurn({
      slotType: 'phone',
      userText: 'no, it is 2395557777',
      company: buildCompany(),
      slotConfig: buildSlotConfig({ question: "What's the best phone number to reach you?" }),
      slotMeta: { pendingConfirm: true, confirmed: false },
      currentSlots: { phone: '2395551234' },
      extractedValue: '2395557777',
      nextSlotType: 'address',
      nextQuestion: "What's the service address?"
    });

    expect(state.slots.phone).toBe('2395557777');
    expect(state.slotMeta.pendingConfirm).toBe(true);
    expect(state.activeSlot).toBe('phone');
    expect(reply.toLowerCase()).toContain('confirm');
  });

  test('phone confirm abort ends booking', () => {
    const { reply, state } = ConversationEngine.__testHandleConfirmSlotTurn({
      slotType: 'phone',
      userText: "no actually I don't want to schedule",
      company: buildCompany(),
      slotConfig: buildSlotConfig(),
      slotMeta: { pendingConfirm: true, confirmed: false },
      currentSlots: { phone: '2395551234' },
      abortReply: 'Got it, we can stop here.'
    });

    expect(state.bookingAborted).toBe(true);
    expect(state.activeSlot).toBeNull();
    expect(reply.toLowerCase()).toContain('stop');
  });

  test('address confirm yes advances to time', () => {
    const { reply, state } = ConversationEngine.__testHandleConfirmSlotTurn({
      slotType: 'address',
      userText: 'yes',
      company: buildCompany(),
      slotConfig: buildSlotConfig({ question: "What's the service address?" }),
      slotMeta: { pendingConfirm: true, confirmed: false },
      currentSlots: { address: '123 Main St' },
      nextSlotType: 'time',
      nextQuestion: 'When would be a good time?'
    });

    expect(state.slotMeta.confirmed).toBe(true);
    expect(state.activeSlot).toBe('time');
    expect(reply.toLowerCase()).toContain('time');
  });

  test('address confirm no with correction re-confirms', () => {
    const { reply, state } = ConversationEngine.__testHandleConfirmSlotTurn({
      slotType: 'address',
      userText: 'no, it is 500 Elm St',
      company: buildCompany(),
      slotConfig: buildSlotConfig({ question: "What's the service address?" }),
      slotMeta: { pendingConfirm: true, confirmed: false },
      currentSlots: { address: '123 Main St' },
      extractedValue: '500 Elm St'
    });

    expect(state.slots.address).toBe('500 Elm St');
    expect(state.slotMeta.pendingConfirm).toBe(true);
    expect(state.activeSlot).toBe('address');
    expect(reply.toLowerCase()).toContain('confirm');
  });

  test('address confirm abort ends booking', () => {
    const { reply, state } = ConversationEngine.__testHandleConfirmSlotTurn({
      slotType: 'address',
      userText: 'cancel',
      company: buildCompany(),
      slotConfig: buildSlotConfig(),
      slotMeta: { pendingConfirm: true, confirmed: false },
      currentSlots: { address: '123 Main St' },
      abortReply: 'Got it, we can stop here.'
    });

    expect(state.bookingAborted).toBe(true);
    expect(state.activeSlot).toBeNull();
    expect(reply.toLowerCase()).toContain('stop');
  });

  test('time confirm yes completes without re-asking', () => {
    const { reply, state } = ConversationEngine.__testHandleConfirmSlotTurn({
      slotType: 'time',
      userText: 'yes',
      company: buildCompany(),
      slotConfig: buildSlotConfig({ question: 'When would be a good time?' }),
      slotMeta: { pendingConfirm: true, confirmed: false },
      currentSlots: { time: 'tomorrow afternoon' },
      nextSlotType: null,
      nextQuestion: ''
    });

    expect(state.slotMeta.confirmed).toBe(true);
    expect(state.activeSlot).toBeNull();
    expect(reply).toBe('');
  });

  test('time confirm no with correction re-confirms', () => {
    const { reply, state } = ConversationEngine.__testHandleConfirmSlotTurn({
      slotType: 'time',
      userText: 'no, next tuesday at 3',
      company: buildCompany(),
      slotConfig: buildSlotConfig({ question: 'When would be a good time?' }),
      slotMeta: { pendingConfirm: true, confirmed: false },
      currentSlots: { time: 'tomorrow afternoon' },
      extractedValue: 'next tuesday at 3'
    });

    expect(state.slots.time).toBe('next tuesday at 3');
    expect(state.slotMeta.pendingConfirm).toBe(true);
    expect(state.activeSlot).toBe('time');
    expect(reply.toLowerCase()).toContain('confirm');
  });

  test('time confirm silence reprompts then aborts', () => {
    const abortReply = 'Got it, we can stop here.';
    const first = ConversationEngine.__testHandleConfirmSlotTurn({
      slotType: 'time',
      userText: '',
      company: buildCompany(),
      slotConfig: buildSlotConfig({ question: 'When would be a good time?' }),
      slotMeta: { pendingConfirm: true, confirmed: false, confirmSilenceCount: 0 },
      currentSlots: { time: 'tomorrow afternoon' },
      abortReply
    });

    expect(first.state.activeSlot).toBe('time');
    expect(first.state.slotMeta.confirmSilenceCount).toBe(1);
    expect(first.reply.toLowerCase()).toContain('confirm');

    const second = ConversationEngine.__testHandleConfirmSlotTurn({
      slotType: 'time',
      userText: '',
      company: buildCompany(),
      slotConfig: buildSlotConfig({ question: 'When would be a good time?' }),
      slotMeta: { pendingConfirm: true, confirmed: false, confirmSilenceCount: 1 },
      currentSlots: { time: 'tomorrow afternoon' },
      abortReply
    });

    expect(second.state.bookingAborted).toBe(true);
    expect(second.state.activeSlot).toBeNull();
    expect(second.reply.toLowerCase()).toContain('stop');
  });

  test('email confirm yes records trace', () => {
    const trace = [];
    const { reply, state } = ConversationEngine.__testHandleConfirmSlotTurn({
      slotType: 'email',
      userText: 'yes',
      company: buildCompany(),
      slotConfig: buildSlotConfig({ question: "What's the best email?" }),
      slotMeta: { pendingConfirm: true, confirmed: false },
      currentSlots: { email: 'mark@example.com' },
      nextSlotType: null,
      nextQuestion: '',
      decisionTrace: trace
    });

    expect(state.slotMeta.confirmed).toBe(true);
    expect(state.confirmBackTrace[0].slot).toBe('email');
    expect(state.confirmBackTrace[0].outcome).toBe('CONFIRMED');
    expect(reply).toBe('');
  });

  test('email confirm no records correction trace', () => {
    const trace = [];
    const { state } = ConversationEngine.__testHandleConfirmSlotTurn({
      slotType: 'email',
      userText: 'no, it is mark2@example.com',
      company: buildCompany(),
      slotConfig: buildSlotConfig({ question: "What's the best email?" }),
      slotMeta: { pendingConfirm: true, confirmed: false },
      currentSlots: { email: 'mark@example.com' },
      extractedValue: 'mark2@example.com',
      decisionTrace: trace
    });

    expect(state.slots.email).toBe('mark2@example.com');
    expect(state.confirmBackTrace[0].slot).toBe('email');
    expect(state.confirmBackTrace[0].outcome).toBe('CORRECTION');
  });

  test('serviceType silence abort records trace', () => {
    const trace = [];
    const abortReply = 'Got it, we can stop here.';
    const { state } = ConversationEngine.__testHandleConfirmSlotTurn({
      slotType: 'serviceType',
      userText: '',
      company: buildCompany(),
      slotConfig: buildSlotConfig({ question: 'What type of visit?' }),
      slotMeta: { pendingConfirm: true, confirmed: false, confirmSilenceCount: 1 },
      currentSlots: { serviceType: 'repair' },
      abortReply,
      decisionTrace: trace
    });

    expect(state.bookingAborted).toBe(true);
  });
});
