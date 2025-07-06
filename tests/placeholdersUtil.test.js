const { applyPlaceholders } = require('../utils/placeholders');

test('replaces placeholders in text', () => {
  const text = 'Hello {{name}}, welcome to {{city}}.';
  const placeholders = [{ name: 'name', value: 'Bob' }, { name: 'city', value: 'Paris' }];
  expect(applyPlaceholders(text, placeholders)).toBe('Hello Bob, welcome to Paris.');
});
