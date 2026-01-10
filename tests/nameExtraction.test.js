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

  test('captures last name from human ramble tail: "but it\'s Gonzalez"', () => {
    const text = "my name is Larry pretty long but it's Gonzalez";
    expect(extractName(text, { expectingName: true })).toBe('Larry Gonzalez');
  });

  test('returns null in discovery when no name intent and not expecting', () => {
    expect(extractName('go ahead', { expectingName: false })).toBe(null);
    expect(extractName('yes', { expectingName: false })).toBe(null);
  });
});

