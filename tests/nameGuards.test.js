const { isSuspiciousDuplicateName } = require('../utils/nameGuards');

describe('utils/nameGuards.isSuspiciousDuplicateName', () => {
  test('flags duplicate when name is common first name', () => {
    const common = ['mark', 'marc', 'john'];
    expect(isSuspiciousDuplicateName('Mark', 'Mark', common)).toBe(true);
    expect(isSuspiciousDuplicateName('Marc', 'Marc', common)).toBe(true);
  });

  test('does not flag when names differ', () => {
    const common = ['mark', 'marc', 'john'];
    expect(isSuspiciousDuplicateName('Marc', 'Mark', common)).toBe(false);
  });

  test('does not flag duplicate if not in common list', () => {
    const common = ['mark', 'marc', 'john'];
    expect(isSuspiciousDuplicateName('Subach', 'Subach', common)).toBe(false);
  });
});
