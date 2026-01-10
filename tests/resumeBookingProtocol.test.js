const { buildResumeBookingBlock, joinHumanList } = require('../utils/resumeBookingProtocol');

describe('utils/resumeBookingProtocol', () => {
  test('joinHumanList joins with separators', () => {
    expect(joinHumanList([])).toBe('');
    expect(joinHumanList(['Name'])).toBe('Name');
    expect(joinHumanList(['Name', 'Phone'])).toBe('Name and Phone');
    expect(joinHumanList(['Name', 'Phone', 'Address'])).toBe('Name, Phone and Address');
  });

  test('buildResumeBookingBlock formats collected summary + uses nextQuestion', () => {
    const bookingSlots = [
      { slotId: 'name', label: 'Name', required: true },
      { slotId: 'phone', label: 'Phone', required: true },
      { slotId: 'address', label: 'Address', required: true }
    ];

    const collectedSlots = { name: 'Marc', phone: '(555) 555-5555' };

    const resumeConfig = {
      enabled: true,
      includeValues: false,
      template: 'Resume: {collectedSummary}. Next: {nextQuestion}',
      collectedItemTemplate: '{label}',
      collectedItemTemplateWithValue: '{label}: {value}',
      separator: ', ',
      finalSeparator: ' and '
    };

    const block = buildResumeBookingBlock({
      resumeConfig,
      bookingSlots,
      collectedSlots,
      nextSlot: { slotId: 'address', label: 'Address', question: "What's the service address?" },
      nextQuestion: "What's the service address?"
    });

    expect(block).toBe("Resume: Name and Phone. Next: What's the service address?");
  });

  test('includeValues=true uses value template', () => {
    const bookingSlots = [
      { slotId: 'name', label: 'Name', required: true },
      { slotId: 'phone', label: 'Phone', required: true }
    ];
    const collectedSlots = { name: 'Larry', phone: '555' };
    const resumeConfig = {
      enabled: true,
      includeValues: true,
      template: '{collectedSummary}. {nextQuestion}',
      collectedItemTemplate: '{label}',
      collectedItemTemplateWithValue: '{label}: {value}',
      separator: ', ',
      finalSeparator: ' and '
    };

    const block = buildResumeBookingBlock({
      resumeConfig,
      bookingSlots,
      collectedSlots,
      nextQuestion: 'Next question here'
    });

    expect(block).toBe('Name: Larry and Phone: 555. Next question here');
  });
});

