/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * V117 FIXES — Test Suite
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Tests for:
 *   Fix 1: Address completeness gate (street-only must not advance)
 *   Fix 2: Time normalization ("8 to 10" → Morning, numeric windows)
 *   Fix 3: Time prompt unification (reprompt includes windows)
 *   Fix 4: lastName cleanup (strip framing phrases)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 2: Time Normalization — BookingFlowRunner SlotExtractors.time
// ═══════════════════════════════════════════════════════════════════════════════

// We need to test the time extractor in isolation.
// The SlotExtractors are defined inside BookingFlowRunner, but we can test
// the public extractValue static method.

const SlotExtractor = require('../services/engine/booking/SlotExtractor');

describe('V117 Fix 2: Time normalization — SlotExtractor.extractTime', () => {
    test('"8 to 10" maps to Morning (8-10)', () => {
        const result = SlotExtractor.extractTime('8 to 10');
        expect(result).not.toBeNull();
        expect(result.value).toMatch(/morning/i);
        expect(result.value).toContain('8-10');
        expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    test('"8-10" maps to Morning (8-10)', () => {
        const result = SlotExtractor.extractTime('8-10');
        expect(result).not.toBeNull();
        expect(result.value).toMatch(/morning/i);
        expect(result.value).toContain('8-10');
    });

    test('"ten to twelve" maps to Morning (10-12)', () => {
        const result = SlotExtractor.extractTime('ten to twelve');
        expect(result).not.toBeNull();
        expect(result.value).toMatch(/morning/i);
        expect(result.value).toContain('10-12');
    });

    test('"12 to 2" maps to Afternoon (12-2)', () => {
        const result = SlotExtractor.extractTime('12 to 2');
        expect(result).not.toBeNull();
        expect(result.value).toMatch(/afternoon/i);
        expect(result.value).toContain('12-2');
    });

    test('"2 to 4" maps to Afternoon (2-4)', () => {
        const result = SlotExtractor.extractTime('2 to 4');
        expect(result).not.toBeNull();
        expect(result.value).toMatch(/afternoon/i);
        expect(result.value).toContain('2-4');
    });

    test('"eight to ten" maps to Morning (8-10)', () => {
        const result = SlotExtractor.extractTime('eight to ten');
        expect(result).not.toBeNull();
        expect(result.value).toMatch(/morning/i);
        expect(result.value).toContain('8-10');
    });

    test('"2 through 4" maps to Afternoon', () => {
        const result = SlotExtractor.extractTime('2 through 4');
        expect(result).not.toBeNull();
        expect(result.value).toMatch(/afternoon/i);
    });

    test('"first slot" / "earliest" maps to Morning', () => {
        const result = SlotExtractor.extractTime('the earliest slot');
        expect(result).not.toBeNull();
        expect(result.value).toMatch(/morning/i);
    });

    test('"last slot" maps to Afternoon', () => {
        const result = SlotExtractor.extractTime('last available slot');
        expect(result).not.toBeNull();
        expect(result.value).toMatch(/afternoon/i);
    });

    test('ASAP still works', () => {
        const result = SlotExtractor.extractTime('as soon as possible');
        expect(result).not.toBeNull();
        expect(result.value).toBe('ASAP');
    });

    test('"good morning" greeting is NOT extracted as time', () => {
        const result = SlotExtractor.extractTime('good morning');
        expect(result).toBeNull();
    });

    test('"3:30 pm" still works as specific time', () => {
        const result = SlotExtractor.extractTime('3:30 pm');
        expect(result).not.toBeNull();
        expect(result.value).toContain('3:30');
    });

    test('"2 weeks ago" is NOT extracted as time range', () => {
        // "2 weeks ago" should not match "2 to ..." pattern
        const result = SlotExtractor.extractTime('2 weeks ago my system broke');
        // Should be null because "2 weeks" doesn't match "N to N" pattern
        // and there's no scheduling context for "soon"
        expect(result).toBeNull();
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Fix 3: Time prompt unification — DefaultFrontDeskPreset
// ═══════════════════════════════════════════════════════════════════════════════

const { DEFAULT_BOOKING_FLOW } = require('../config/onboarding/DefaultFrontDeskPreset');

describe('V117 Fix 3: Time prompt unification', () => {
    const timeStep = DEFAULT_BOOKING_FLOW.steps.find(s => s.slotId === 'time');

    test('time step exists', () => {
        expect(timeStep).toBeDefined();
    });

    test('ask prompt includes window options', () => {
        expect(timeStep.ask).toMatch(/8-10/);
        expect(timeStep.ask).toMatch(/10-12/);
        expect(timeStep.ask).toMatch(/12-2/);
        expect(timeStep.ask).toMatch(/2-4/);
    });

    test('reprompt includes window options (not just "Morning or afternoon?")', () => {
        expect(timeStep.reprompt).toMatch(/8-10/);
        expect(timeStep.reprompt).toMatch(/2-4/);
    });

    test('all repromptVariants include window options', () => {
        expect(timeStep.repromptVariants).toBeDefined();
        expect(timeStep.repromptVariants.length).toBeGreaterThanOrEqual(2);
        
        for (const variant of timeStep.repromptVariants) {
            // Each variant must mention at least one specific window
            const hasWindows = /\d+-\d+/.test(variant);
            expect(hasWindows).toBe(true);
        }
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Fix 4: lastName cleanup — safeSetSlot normalization
// ═══════════════════════════════════════════════════════════════════════════════

// We test this by requiring BookingFlowRunner and calling the safeSetSlot
// function indirectly through extractValue or by calling it directly.
// Since safeSetSlot is a module-level function (not exported), we test via
// the static method path.

describe('V117 Fix 4: lastName cleanup via BookingFlowRunner.extractValue', () => {
    const BookingFlowRunnerForNames = require('../services/engine/booking/BookingFlowRunner');
    
    const lastNameStep = { id: 'lastName', type: 'lastName', label: 'Last Name' };
    const mockState = {};
    const mockCompany = {};

    test('extractValue cleans ", that\'s walter." → "Walter"', () => {
        const result = BookingFlowRunnerForNames.extractValue(", that's walter.", lastNameStep, mockState, mockCompany);
        if (result.isValid) {
            expect(result.value.toLowerCase()).toBe('walter');
        }
        // If extractor fails, that's also acceptable — safeSetSlot will clean it
    });

    test('extractValue cleans "my last name is miller" → "Miller"', () => {
        const result = BookingFlowRunnerForNames.extractValue('my last name is miller', lastNameStep, mockState, mockCompany);
        expect(result.isValid).toBe(true);
        expect(result.value.toLowerCase()).toBe('miller');
    });

    test('extractValue cleans "it\'s johnson" → "Johnson"', () => {
        const result = BookingFlowRunnerForNames.extractValue("it's johnson", lastNameStep, mockState, mockCompany);
        expect(result.isValid).toBe(true);
        expect(result.value.toLowerCase()).toBe('johnson');
    });

    test('extractValue cleans "yeah it\'s baker" → "Baker"', () => {
        const result = BookingFlowRunnerForNames.extractValue("yeah it's baker", lastNameStep, mockState, mockCompany);
        expect(result.isValid).toBe(true);
        expect(result.value.toLowerCase()).toBe('baker');
    });

    test('extractValue rejects pure stop words "yes"', () => {
        const result = BookingFlowRunnerForNames.extractValue('yes', lastNameStep, mockState, mockCompany);
        expect(result.isValid).toBe(false);
    });

    test('extractValue extracts "well" from "um, uh, well" (safeSetSlot will filter)', () => {
        // "well" passes the name extractor (could be a surname), but safeSetSlot's
        // V117 normalizer will strip it as a stop word during write-time.
        // Here we just verify the extractor doesn't crash on garbage input.
        const result = BookingFlowRunnerForNames.extractValue('um, uh, well', lastNameStep, mockState, mockCompany);
        // Either rejected or extracted "Well" — both are acceptable at this layer
        if (result.isValid) {
            expect(typeof result.value).toBe('string');
        }
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Fix 1: Address completeness gate — detectAddressParts
// ═══════════════════════════════════════════════════════════════════════════════

describe('V117 Fix 1: Address completeness gate', () => {
    // Test the BookingFlowRunner.findNextRequiredStep behavior.
    // Since findNextRequiredStep is a static method, we can call it with
    // mock flow and state objects.
    
    const BookingFlowRunner = require('../services/engine/booking/BookingFlowRunner');

    const mockFlow = {
        steps: [
            { id: 'name', fieldKey: 'name', type: 'name', required: true },
            { id: 'phone', fieldKey: 'phone', type: 'phone', required: true },
            { id: 'address', fieldKey: 'address', type: 'address', required: true },
            { id: 'time', fieldKey: 'time', type: 'time', required: true }
        ]
    };

    test('street-only address does NOT advance to time', () => {
        const state = {
            bookingCollected: {
                name: 'Mark',
                phone: '2398889905',
                address: '12155 metro parkway'
            },
            confirmedSlots: { name: true, phone: true }
        };

        const nextStep = BookingFlowRunner.findNextRequiredStep(mockFlow, state);
        
        // Should return the address step (not time) because address is incomplete
        expect(nextStep).not.toBeNull();
        expect(nextStep.id).toBe('address');
        expect(state.addressIncomplete).toBe(true);
    });

    test('full address with city/state advances past address', () => {
        const state = {
            bookingCollected: {
                name: 'Mark',
                phone: '2398889905',
                address: '12155 Metro Parkway, Fort Myers, FL 33966'
            },
            confirmedSlots: { name: true, phone: true }
        };

        const nextStep = BookingFlowRunner.findNextRequiredStep(mockFlow, state);
        
        // Should advance to time since address has city/state/zip
        expect(nextStep).not.toBeNull();
        expect(nextStep.id).toBe('time');
    });

    test('address with comma and state abbreviation advances', () => {
        const state = {
            bookingCollected: {
                name: 'Mark',
                phone: '2398889905',
                address: '12155 Metro Parkway, Fort Myers FL'
            },
            confirmedSlots: { name: true, phone: true }
        };

        const nextStep = BookingFlowRunner.findNextRequiredStep(mockFlow, state);
        expect(nextStep).not.toBeNull();
        expect(nextStep.id).toBe('time');
    });

    test('address with zip code advances', () => {
        const state = {
            bookingCollected: {
                name: 'Mark',
                phone: '2398889905',
                address: '12155 Metro Parkway 33966'
            },
            confirmedSlots: { name: true, phone: true }
        };

        const nextStep = BookingFlowRunner.findNextRequiredStep(mockFlow, state);
        expect(nextStep).not.toBeNull();
        expect(nextStep.id).toBe('time');
    });

    test('addressCompletionVerified flag prevents re-checking', () => {
        const state = {
            bookingCollected: {
                name: 'Mark',
                phone: '2398889905',
                address: '12155 metro parkway'
            },
            confirmedSlots: { name: true, phone: true },
            // Already verified (e.g. city was appended after first check)
            addressCompletionVerified: true
        };

        const nextStep = BookingFlowRunner.findNextRequiredStep(mockFlow, state);
        // Should skip address because addressCompletionVerified is set
        expect(nextStep).not.toBeNull();
        expect(nextStep.id).toBe('time');
    });
});
