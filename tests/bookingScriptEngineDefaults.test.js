const BookingScriptEngine = require('../services/BookingScriptEngine');

describe('BookingScriptEngine V116 — V110 only, no legacy fallback', () => {

  test('V110 slotRegistry + bookingFlow returns configured slots', () => {
    const company = {
      _id: 'test-v110',
      aiAgentSettings: {
        frontDeskBehavior: {
          slotRegistry: {
            slots: [
              { id: 'name', type: 'name_first', label: 'Full Name', required: true },
              { id: 'phone', type: 'phone', label: 'Phone Number', required: true }
            ]
          },
          bookingFlow: {
            version: 'v1',
            enabled: true,
            steps: [
              { stepId: 'b1', slotId: 'name', order: 0, ask: 'May I have your name please?' },
              { stepId: 'b2', slotId: 'phone', order: 1, ask: 'And a good phone number to reach you?' }
            ]
          }
        }
      }
    };

    const { slots, isConfigured, source } = BookingScriptEngine.getBookingSlotsFromCompany(company, { contextFlags: {} });
    expect(isConfigured).toBe(true);
    expect(source).toBe('V110_SLOT_REGISTRY');
    expect(slots).toHaveLength(2);
    expect(slots[0].slotId).toBe('name');
    expect(slots[0].question).toBe('May I have your name please?');
    expect(slots[1].slotId).toBe('phone');
    expect(slots[1].question).toBe('And a good phone number to reach you?');
  });

  test('V110 name slot preserves lastNameQuestion from step config', () => {
    const company = {
      _id: 'test-v110-name',
      aiAgentSettings: {
        frontDeskBehavior: {
          slotRegistry: {
            slots: [
              { id: 'name', type: 'name_first', label: 'Full Name', required: true }
            ]
          },
          bookingFlow: {
            version: 'v1',
            enabled: true,
            steps: [
              { stepId: 'b1', slotId: 'name', order: 0, ask: 'What is your first name?', lastNameQuestion: "And what's your last name 3?" }
            ]
          }
        }
      }
    };

    const { slots, isConfigured } = BookingScriptEngine.getBookingSlotsFromCompany(company, { contextFlags: {} });
    expect(isConfigured).toBe(true);
    const nameSlot = slots.find(s => s.slotId === 'name');
    expect(nameSlot).toBeTruthy();
    expect(nameSlot.lastNameQuestion).toBe("And what's your last name 3?");
    expect(nameSlot._v110).toBe(true);
  });

  test('legacy bookingSlots path returns empty and source NOT_CONFIGURED (TRAPPED)', () => {
    const company = {
      _id: 'test-legacy-trapped',
      aiAgentSettings: {
        frontDeskBehavior: {
          bookingSlots: [
            { id: 'name', type: 'name', question: 'Your name?', required: true }
          ]
        }
      }
    };

    const { slots, isConfigured, source } = BookingScriptEngine.getBookingSlotsFromCompany(company, { contextFlags: {} });
    // V116: Legacy path is TRAPPED — returns empty
    expect(isConfigured).toBe(false);
    expect(source).toBe('NOT_CONFIGURED');
    expect(slots).toHaveLength(0);
  });

  test('legacy callFlowEngine.bookingFields path returns empty (TRAPPED)', () => {
    const company = {
      _id: 'test-legacy-cfe',
      aiAgentSettings: {
        callFlowEngine: {
          bookingFields: [
            { id: 'name', question: 'Name?', required: true }
          ]
        },
        frontDeskBehavior: {}
      }
    };

    const { slots, isConfigured, source } = BookingScriptEngine.getBookingSlotsFromCompany(company, { contextFlags: {} });
    expect(isConfigured).toBe(false);
    expect(source).toBe('NOT_CONFIGURED');
    expect(slots).toHaveLength(0);
  });

  test('no company returns safe empty result', () => {
    const result = BookingScriptEngine.getBookingSlotsFromCompany(null);
    expect(result.isConfigured).toBe(false);
    expect(result.source).toBe('NO_COMPANY');
    expect(result.slots).toHaveLength(0);
  });

  test('getNextRequiredSlot returns first missing required slot', () => {
    const slots = [
      { slotId: 'name', required: true, order: 0 },
      { slotId: 'phone', required: true, order: 1 },
      { slotId: 'notes', required: false, order: 2 }
    ];
    const collected = { name: 'John' };
    const next = BookingScriptEngine.getNextRequiredSlot(slots, collected);
    expect(next.slotId).toBe('phone');
  });

  test('isBookingComplete returns true when all required slots filled', () => {
    const slots = [
      { slotId: 'name', required: true },
      { slotId: 'phone', required: true },
      { slotId: 'notes', required: false }
    ];
    const collected = { name: 'John', phone: '555-1234' };
    expect(BookingScriptEngine.isBookingComplete(slots, collected)).toBe(true);
  });

  test('isBookingComplete returns false when required slot is empty', () => {
    const slots = [
      { slotId: 'name', required: true },
      { slotId: 'phone', required: true }
    ];
    const collected = { name: 'John', phone: '' };
    expect(BookingScriptEngine.isBookingComplete(slots, collected)).toBe(false);
  });

  test('convertLegacyBookingPrompts is trapped and returns empty array', () => {
    const result = BookingScriptEngine.convertLegacyBookingPrompts({ askName: 'Name?', askPhone: 'Phone?' });
    expect(result).toEqual([]);
  });
});
