const {
  normalizePhoneNumber,
  extractDigits,
  numbersMatch,
} = require('../utils/phone');

describe('normalizePhoneNumber', () => {
  test('adds +1 to 10 digit numbers', () => {
    expect(normalizePhoneNumber('1234567890')).toBe('+11234567890');
  });

  test('strips formatting and retains country code', () => {
    expect(normalizePhoneNumber('+1 (234) 567-8901')).toBe('+12345678901');
  });

  test('returns null for empty input', () => {
    expect(normalizePhoneNumber('')).toBeNull();
  });
});

describe('extractDigits', () => {
  test('removes non-digit characters', () => {
    expect(extractDigits('+1 (234) 567-8901')).toBe('12345678901');
  });

  test('returns empty string for undefined', () => {
    expect(extractDigits(undefined)).toBe('');
  });
});

describe('numbersMatch', () => {
  test('matches numbers ignoring formatting and country code', () => {
    expect(numbersMatch('+1 (234) 567-8901', '2345678901')).toBe(true);
  });

  test('detects different numbers', () => {
    expect(numbersMatch('1234567890', '1234567891')).toBe(false);
  });
});
