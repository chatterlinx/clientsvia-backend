const { parseSpellingVariantPrompt, parseSpellingVariantResponse } = require('../utils/nameSpellingVariant');

describe('nameSpellingVariant utils', () => {
  test('parses assistant prompt "Mark with a K or Marc with a C?"', () => {
    const variant = parseSpellingVariantPrompt('Just to confirm — Mark with a K or Marc with a C?');
    expect(variant).toEqual({
      hasVariant: true,
      optionA: 'Mark',
      optionB: 'Marc',
      letterA: 'K',
      letterB: 'C'
    });
  });

  test('detects user choice from phrased response "who is Marc with a C"', () => {
    const variant = {
      optionA: 'Mark',
      optionB: 'Marc',
      letterA: 'K',
      letterB: 'C'
    };

    const chosen = parseSpellingVariantResponse('who is Marc with a C', variant);
    expect(chosen).toBe('Marc');
  });

  test('returns null when response is unclear (no guessing)', () => {
    const variant = {
      optionA: 'Mark',
      optionB: 'Marc',
      letterA: 'K',
      letterB: 'C'
    };

    const chosen = parseSpellingVariantResponse('hmm not sure', variant);
    expect(chosen).toBe(null);
  });
});

