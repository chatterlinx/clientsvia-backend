const { buildAccessSnapshot } = require('../utils/accessFlow');

describe('access flow booking snapshot scenarios', () => {
  test('house, no gate', () => {
    const snapshot = buildAccessSnapshot({
      propertyType: 'house',
      access: { gatedCommunity: false }
    });

    expect(snapshot.property.type).toBe('house');
    expect(snapshot.access.gatedCommunity).toBe(false);
    expect(snapshot.property.unit).toBe(null);
    expect(snapshot.access.gateAccessType).toEqual([]);
  });

  test('condo with unit + gate code', () => {
    const snapshot = buildAccessSnapshot({
      propertyType: 'condo/townhome',
      unit: '302B',
      access: {
        gatedCommunity: true,
        gateAccessType: ['code'],
        gateCode: '1972'
      }
    });

    expect(snapshot.property.type).toBe('condo/townhome');
    expect(snapshot.property.unit).toBe('302B');
    expect(snapshot.access.gatedCommunity).toBe(true);
    expect(snapshot.access.gateAccessType).toEqual(['code']);
    expect(snapshot.access.gateCode).toBe('1972');
    expect(snapshot.access.gateGuardNotifyRequired).toBe(false);
  });

  test('condo with guard only', () => {
    const snapshot = buildAccessSnapshot({
      propertyType: 'condo/townhome',
      access: {
        gatedCommunity: true,
        gateAccessType: ['guard'],
        gateGuardNotifyRequired: true,
        gateGuardNotes: 'Customer will notify guard.'
      }
    });

    expect(snapshot.access.gateAccessType).toEqual(['guard']);
    expect(snapshot.access.gateGuardNotifyRequired).toBe(true);
    expect(snapshot.access.gateGuardNotes).toBe('Customer will notify guard.');
  });

  test('gated community with code + guard', () => {
    const snapshot = buildAccessSnapshot({
      propertyType: 'condo/townhome',
      unit: '302B',
      access: {
        gatedCommunity: true,
        gateAccessType: ['code', 'guard'],
        gateCode: '1972',
        gateGuardNotifyRequired: true
      }
    });

    expect(snapshot.access.gateAccessType).toEqual(['code', 'guard']);
    expect(snapshot.access.gateCode).toBe('1972');
    expect(snapshot.access.gateGuardNotifyRequired).toBe(true);
  });

  test('commercial suite', () => {
    const snapshot = buildAccessSnapshot({
      propertyType: 'commercial',
      unit: 'Suite 500',
      access: {
        gatedCommunity: false
      }
    });

    expect(snapshot.property.type).toBe('commercial');
    expect(snapshot.property.unit).toBe('Suite 500');
    expect(snapshot.access.gatedCommunity).toBe(false);
  });

  test('user refuses details', () => {
    const snapshot = buildAccessSnapshot({
      propertyType: 'other',
      unitNotApplicable: true,
      access: {
        accessResolution: 'unknown_or_not_given',
        unitResolution: 'unknown_or_not_given'
      }
    });

    expect(snapshot.property.type).toBe('other');
    expect(snapshot.property.unitNotApplicable).toBe(true);
    expect(snapshot.access.accessResolution).toBe('unknown_or_not_given');
    expect(snapshot.access.unitResolution).toBe('unknown_or_not_given');
  });
});
