const {
  isAffirmative,
  isNegative,
  normalizePropertyType,
  parseGateAccessType,
  normalizeUnitValue
} = require('../utils/accessFlow');

describe('utils/accessFlow', () => {
  test('affimative/negative detection', () => {
    expect(isAffirmative('yes')).toBe(true);
    expect(isAffirmative('yep')).toBe(true);
    expect(isNegative('no')).toBe(true);
    expect(isNegative('nope')).toBe(true);
  });

  test('property type normalization', () => {
    expect(normalizePropertyType('Condo')).toBe('condo/townhome');
    expect(normalizePropertyType('Apartment')).toBe('apartment');
    expect(normalizePropertyType('Mobile home')).toBe('mobile_home');
    expect(normalizePropertyType('Commercial office')).toBe('commercial');
    expect(normalizePropertyType('Single family house')).toBe('house');
    expect(normalizePropertyType('Other')).toBe('other');
  });

  test('gate access type parsing', () => {
    expect(parseGateAccessType('gate code')).toEqual(['code']);
    expect(parseGateAccessType('guard')).toEqual(['guard']);
    expect(parseGateAccessType('code and guard')).toEqual(['code', 'guard']);
  });

  test('unit normalization', () => {
    expect(normalizeUnitValue('Unit 302B')).toBe('302B');
    expect(normalizeUnitValue('Apt 12')).toBe('12');
    expect(normalizeUnitValue('#7')).toBe('7');
  });
});
