const {
  normalizeCityStatePhrase,
  parseCityStatePhrase,
  combineAddressParts
} = require('../utils/addressNormalization');

describe('utils/addressNormalization', () => {
  test('strips leading "that\'s in" phrases', () => {
    expect(normalizeCityStatePhrase("That's in Fort Myers, Florida.")).toBe('Fort Myers, Florida');
    expect(normalizeCityStatePhrase("it's in Orlando FL")).toBe('Orlando FL');
  });

  test('parses city/state from comma or space', () => {
    expect(parseCityStatePhrase('Fort Myers, Florida')).toEqual({ city: 'Fort Myers', state: 'Florida' });
    expect(parseCityStatePhrase('Fort Myers FL')).toEqual({ city: 'Fort Myers', state: 'FL' });
  });

  test('combines street + city + state cleanly', () => {
    expect(combineAddressParts('12155 Metro Parkway', 'Fort Myers', 'Florida'))
      .toBe('12155 Metro Parkway, Fort Myers, Florida');
  });
});
