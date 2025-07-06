const { findCachedAnswer } = require('../utils/aiAgent');

describe('findCachedAnswer', () => {
  const entries = [
    { question: 'How do I reset my thermostat?', answer: 'Press the reset button.', keywords: ['reset', 'thermostat'] }
  ];

  test('exact match', () => {
    const ans = findCachedAnswer(entries, 'How do I reset my thermostat?');
    expect(ans).toBe('Press the reset button.');
  });

  test('partial match', () => {
    const ans = findCachedAnswer(entries, 'thermostat reset');
    expect(ans).toBe('Press the reset button.');
  });

  test('keyword match', () => {
    const ans = findCachedAnswer(entries, 'I need to reset');
    expect(ans).toBe('Press the reset button.');
  });

  test('no match returns null', () => {
    const ans = findCachedAnswer(entries, 'Completely unrelated question');
    expect(ans).toBeNull();
  });
});
