const { renderBracedTemplate } = require('../utils/promptTemplate');

describe('utils/promptTemplate.renderBracedTemplate', () => {
  test('replaces known placeholders and leaves unknown placeholders intact', () => {
    const out = renderBracedTemplate('Hi {firstName} {unknown}.', { firstName: 'Marc' });
    expect(out).toBe('Hi Marc {unknown}.');
  });

  test('renders empty string for non-string templates', () => {
    expect(renderBracedTemplate(null, { a: 1 })).toBe('');
  });
});

