const { findCachedAnswer } = require('../utils/aiAgent');

describe('findCachedAnswer - Enhanced Q&A Matching', () => {
  const entries = [
    { 
      question: 'How do I reset my thermostat?', 
      answer: 'Press the reset button on the thermostat for 5 seconds.', 
      keywords: ['reset', 'thermostat'] 
    },
    { 
      question: 'My air conditioner is leaking water', 
      answer: 'Check the drain pan and clean the condensate drain.', 
      keywords: ['ac', 'air conditioner', 'leaking', 'water'] 
    },
    { 
      question: 'How to schedule an appointment?', 
      answer: 'Call us at 555-0123 or use our online booking system.', 
      keywords: ['schedule', 'appointment', 'booking'] 
    },
    {
      question: 'What are your business hours?',
      answer: 'We are open Monday to Friday 8 AM to 6 PM.',
      keywords: ['hours', 'time', 'open']
    }
  ];

  describe('Exact matching', () => {
    test('exact question match', () => {
      const ans = findCachedAnswer(entries, 'How do I reset my thermostat?');
      expect(ans).toBe('Press the reset button on the thermostat for 5 seconds.');
    });

    test('exact keyword match', () => {
      const ans = findCachedAnswer(entries, 'thermostat');
      expect(ans).toBe('Press the reset button on the thermostat for 5 seconds.');
    });
  });

  describe('High-confidence fuzzy matching', () => {
    test('minor typos and variations', () => {
      const ans = findCachedAnswer(entries, 'How do I reset my thermostat');
      expect(ans).toBe('Press the reset button on the thermostat for 5 seconds.');
    });

    test('similar phrasing', () => {
      const ans = findCachedAnswer(entries, 'My AC is leaking water');
      expect(ans).toBe('Check the drain pan and clean the condensate drain.');
    });
  });

  describe('Contextual word matching', () => {
    test('multiple relevant words', () => {
      const ans = findCachedAnswer(entries, 'thermostat reset help');
      expect(ans).toBe('Press the reset button on the thermostat for 5 seconds.');
    });

    test('reordered words with context', () => {
      const ans = findCachedAnswer(entries, 'reset my thermostat please');
      expect(ans).toBe('Press the reset button on the thermostat for 5 seconds.');
    });

    test('business hours inquiry', () => {
      const ans = findCachedAnswer(entries, 'what time are you open');
      expect(ans).toBe('We are open Monday to Friday 8 AM to 6 PM.');
    });
  });

  describe('False positive prevention', () => {
    test('single word match should NOT trigger', () => {
      // "leaking" appears in AC question but this is about plumbing
      const ans = findCachedAnswer(entries, 'my sink is leaking badly');
      expect(ans).toBeNull();
    });

    test('insufficient context should NOT trigger', () => {
      // Just "reset" without "thermostat" context should not match
      const ans = findCachedAnswer(entries, 'how to reset password');
      expect(ans).toBeNull();
    });

    test('unrelated context should NOT trigger', () => {
      // "schedule" appears but context is different
      const ans = findCachedAnswer(entries, 'what is the bus schedule');
      expect(ans).toBeNull();
    });

    test('partial word overlap insufficient', () => {
      // Only one word "time" matches but context is wrong
      const ans = findCachedAnswer(entries, 'what time is dinner');
      expect(ans).toBeNull();
    });
  });

  describe('Edge cases', () => {
    test('empty input returns null', () => {
      const ans = findCachedAnswer(entries, '');
      expect(ans).toBeNull();
    });

    test('null input returns null', () => {
      const ans = findCachedAnswer(entries, null);
      expect(ans).toBeNull();
    });

    test('empty entries returns null', () => {
      const ans = findCachedAnswer([], 'some question');
      expect(ans).toBeNull();
    });

    test('null entries returns null', () => {
      const ans = findCachedAnswer(null, 'some question');
      expect(ans).toBeNull();
    });
  });

  describe('Short phrases handling', () => {
    test('short relevant phrase should match', () => {
      const ans = findCachedAnswer(entries, 'business hours');
      expect(ans).toBe('We are open Monday to Friday 8 AM to 6 PM.');
    });

    test('very short relevant phrase should match', () => {
      const ans = findCachedAnswer(entries, 'hours');
      expect(ans).toBe('We are open Monday to Friday 8 AM to 6 PM.');
    });
  });
});
