const BookingScriptEngine = require('../services/BookingScriptEngine');

describe('BookingScriptEngine.getBookingSlotsFromCompany default backfill', () => {
  test('backfills duplicateNamePartPrompt for name slot when missing in DB bookingSlots', () => {
    const company = {
      _id: 'test-company',
      aiAgentSettings: {
        frontDeskBehavior: {
          bookingSlots: [
            {
              id: 'name',
              type: 'name',
              question: 'May I have your name, please sir 1?',
              askFullName: true,
              askMissingNamePart: true,
              confirmSpelling: true,
              // Intentionally missing duplicateNamePartPrompt
              lastNameQuestion: "And what's your last name 3?"
            }
          ]
        }
      }
    };

    const { slots, isConfigured } = BookingScriptEngine.getBookingSlotsFromCompany(company, { contextFlags: {} });
    expect(isConfigured).toBe(true);
    const nameSlot = slots.find(s => s.slotId === 'name' || s.type === 'name');
    expect(nameSlot).toBeTruthy();
    // Should be backfilled from DEFAULT_BOOKING_SLOTS
    expect(typeof nameSlot.duplicateNamePartPrompt === 'string' || nameSlot.duplicateNamePartPrompt === null).toBe(true);
    expect(nameSlot.duplicateNamePartPrompt).toBeTruthy();
  });
});

