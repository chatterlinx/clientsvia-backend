const { classifyServiceUrgency } = require('../utils/serviceUrgency');

describe('serviceUrgency', () => {
    it('returns urgent for critical HVAC phrases', () => {
        expect(classifyServiceUrgency('My AC is not cooling at all')).toBe('urgent');
        expect(classifyServiceUrgency('There is a burning smell from the unit')).toBe('urgent');
        expect(classifyServiceUrgency('It is blowing warm air')).toBe('urgent');
    });

    it('returns normal for non-urgent service requests', () => {
        expect(classifyServiceUrgency('I just need AC service')).toBe('normal');
        expect(classifyServiceUrgency('Looking for maintenance and a tune up')).toBe('normal');
    });
});
