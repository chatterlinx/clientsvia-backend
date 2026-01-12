const { detectBookingClarification } = require('../utils/bookingClarification');

describe('detectBookingClarification', () => {
  test('matches clarification trigger inside longer utterance (case-insensitive)', () => {
    const triggers = ['is that what you want', 'what do you mean'];
    const text = 'Sure my name my first name is that what you want';
    expect(detectBookingClarification(text, triggers)).toBe(true);
  });

  test('returns false when no triggers match', () => {
    const triggers = ['is that what you want'];
    const text = 'my name is Mark';
    expect(detectBookingClarification(text, triggers)).toBe(false);
  });

  test('returns false with invalid inputs', () => {
    expect(detectBookingClarification(null, ['x'])).toBe(false);
    expect(detectBookingClarification('hi', null)).toBe(false);
    expect(detectBookingClarification('hi', [])).toBe(false);
  });
});

