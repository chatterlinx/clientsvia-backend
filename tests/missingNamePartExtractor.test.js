const { extractMissingNamePart } = require('../services/booking/MissingNamePartExtractor');

describe('MissingNamePartExtractor', () => {
  test('blocks trade/problem sentences (never extracts name part)', () => {
    const res1 = extractMissingNamePart({
      userText: "it's not cooling",
      expectingPart: 'LAST_NAME',
      recentNamePrompt: true,
      allowBareToken: true
    });
    expect(res1.extracted).toBe(null);
    expect(res1.outcome).toBe('skipped_trade_sentence');

    const res2 = extractMissingNamePart({
      userText: "it's leaking from the unit",
      expectingPart: 'LAST_NAME',
      recentNamePrompt: true,
      allowBareToken: true
    });
    expect(res2.extracted).toBe(null);
    expect(res2.outcome).toBe('skipped_trade_sentence');
  });

  test('requires recent name prompt for bare token capture', () => {
    const res = extractMissingNamePart({
      userText: 'Walter',
      expectingPart: 'LAST_NAME',
      recentNamePrompt: false,
      allowBareToken: true
    });
    expect(res.extracted).toBe(null);
    expect(res.outcome).toBe('not_recent_name_prompt');
  });

  test('extracts last name from explicit "my last name is X"', () => {
    const res = extractMissingNamePart({
      userText: 'My last name is Stevens',
      expectingPart: 'LAST_NAME',
      recentNamePrompt: true,
      allowBareToken: true
    });
    expect(res.extracted).toBe('Stevens');
    expect(res.outcome).toBe('explicit_last_name');
  });

  test('extracts from "This is John Stevens speaking"', () => {
    const last = extractMissingNamePart({
      userText: 'This is John Stevens speaking',
      expectingPart: 'LAST_NAME',
      recentNamePrompt: true,
      allowBareToken: false
    });
    expect(last.extracted).toBe('Stevens');
    expect(last.outcome).toBe('explicit_full_name');

    const first = extractMissingNamePart({
      userText: 'This is John Stevens speaking',
      expectingPart: 'FIRST_NAME',
      recentNamePrompt: true,
      allowBareToken: false
    });
    expect(first.extracted).toBe('John');
    expect(first.outcome).toBe('explicit_full_name');
  });
});

