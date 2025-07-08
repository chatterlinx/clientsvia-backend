const { applyPlaceholders } = require('../utils/placeholders');

test('replaces placeholders with double curly braces in text', () => {
  const text = 'Hello {{name}}, welcome to {{city}}.';
  const placeholders = [{ name: 'name', value: 'Bob' }, { name: 'city', value: 'Paris' }];
  expect(applyPlaceholders(text, placeholders)).toBe('Hello Bob, welcome to Paris.');
});

test('replaces placeholders with single curly braces in text', () => {
  const text = 'Hello {name}, welcome to {city}.';
  const placeholders = [{ name: 'name', value: 'Bob' }, { name: 'city', value: 'Paris' }];
  expect(applyPlaceholders(text, placeholders)).toBe('Hello Bob, welcome to Paris.');
});

test('replaces placeholders with mixed formats in text', () => {
  const text = 'Hello {name}, welcome to {{city}}.';
  const placeholders = [{ name: 'name', value: 'Bob' }, { name: 'city', value: 'Paris' }];
  expect(applyPlaceholders(text, placeholders)).toBe('Hello Bob, welcome to Paris.');
});
