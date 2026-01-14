const { extractName } = require('../utils/nameExtraction');

describe('utils/nameExtraction.extractName', () => {
  test('extracts first name in booking context from short response', () => {
    expect(extractName('Mark', { expectingName: true })).toBe('Mark');
    expect(extractName('yes, Mark', { expectingName: true })).toBe('Mark');
  });

  test('extracts from explicit name statement', () => {
    expect(extractName("yes my name is Mark", { expectingName: true })).toBe('Mark');
    expect(extractName("my name is John Smith", { expectingName: true })).toBe('John Smith');
  });

  test('does NOT treat trade/problem utterances as names when only expectingName (guardrail)', () => {
    expect(extractName("it's not cooling", { expectingName: true })).toBe(null);
    expect(extractName("it's not quite cooling", { expectingName: true })).toBe(null);
    expect(extractName("it's leaking from the unit", { expectingName: true })).toBe(null);
  });

  test('captures explicit last name at the end of a rambling last-name sentence (avoids "Little")', () => {
    const text = "show me my last name is a little complicated I hope you don't mess it up Gonzalez";
    expect(extractName(text, { expectingName: true })).toBe('Gonzalez');
  });

  test('does not treat the words "Last Name" as a name when caller provides no surname yet', () => {
    expect(extractName('my last name is', { expectingName: true })).toBe(null);
    expect(extractName('my last name is a little complicated', { expectingName: true })).toBe(null);
  });
  
  test('prefers the LAST "my name is ..." clause in rambling input', () => {
    const text = "well my name is kind of complicated you know i have a 3 family members with different names and my name is Gonzalez";
    expect(extractName(text, { expectingName: true })).toBe('Gonzalez');
  });

  test('returns null in discovery when no name intent and not expecting', () => {
    expect(extractName('go ahead', { expectingName: false })).toBe(null);
    expect(extractName('yes', { expectingName: false })).toBe(null);
  });

  test('extracts full name from "This is John Stevens speaking"', () => {
    expect(extractName('This is John Stevens speaking', { expectingName: true })).toBe('John Stevens');
  });
});

