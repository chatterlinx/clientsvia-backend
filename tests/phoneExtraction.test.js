const { extractPhoneFromText } = require('../utils/phone');

describe('extractPhoneFromText', () => {
  test('extracts a standard 10-digit phone', () => {
    expect(extractPhoneFromText('my number is 239-565-7257')).toBe('(239) 565-7257');
  });

  test('handles 11 digits starting with country code 1', () => {
    expect(extractPhoneFromText('call me at 1 (239) 565-7257')).toBe('(239) 565-7257');
  });

  test('handles 11 digits without country code by preferring first 10 digits (extra digit at end)', () => {
    // Regression: previously took the LAST 10 digits, scrambling (239...) -> (395...)
    expect(extractPhoneFromText('the number is 239-565-7257 5')).toBe('(239) 565-7257');
  });

  test('returns local 7-digit format when area code missing', () => {
    expect(extractPhoneFromText('my number is 3421947')).toBe('342-1947');
  });
});

