const { findFirstMatchingRule, recordRuleFired } = require('../utils/slotMidCallRules');

describe('slotMidCallRules', () => {
  test('matches contains rule and respects cooldown/max per call', () => {
    const rules = [
      {
        id: 'r1',
        enabled: true,
        matchType: 'contains',
        trigger: 'what do you mean',
        action: 'reply_reask',
        responseTemplate: 'No problem — {slotQuestion}',
        cooldownTurns: 2,
        maxPerCall: 2
      }
    ];

    let state = {};

    const m1 = findFirstMatchingRule({ userText: 'sorry, what do you mean?', rules, stateForSlot: state, turnNumber: 10 });
    expect(m1 && m1.id).toBe('r1');
    state = recordRuleFired({ rule: m1, stateForSlot: state, turnNumber: 10 });

    // Cooldown blocks immediate re-fire
    const m2 = findFirstMatchingRule({ userText: 'what do you mean?', rules, stateForSlot: state, turnNumber: 11 });
    expect(m2).toBe(null);

    // After cooldown, can fire again
    const m3 = findFirstMatchingRule({ userText: 'what do you mean?', rules, stateForSlot: state, turnNumber: 13 });
    expect(m3 && m3.id).toBe('r1');
    state = recordRuleFired({ rule: m3, stateForSlot: state, turnNumber: 13 });

    // Max per call reached
    const m4 = findFirstMatchingRule({ userText: 'what do you mean?', rules, stateForSlot: state, turnNumber: 20 });
    expect(m4).toBe(null);
  });

  test('exact match requires normalized equality', () => {
    const rules = [
      { id: 'r2', enabled: true, matchType: 'exact', trigger: 'is that what you want', responseTemplate: 'x', cooldownTurns: 0, maxPerCall: 3 }
    ];
    const m1 = findFirstMatchingRule({ userText: 'Is  that   what you want', rules, stateForSlot: {}, turnNumber: 1 });
    expect(m1 && m1.id).toBe('r2');
    const m2 = findFirstMatchingRule({ userText: 'is that what you want?', rules, stateForSlot: {}, turnNumber: 1 });
    expect(m2).toBe(null);
  });
});

