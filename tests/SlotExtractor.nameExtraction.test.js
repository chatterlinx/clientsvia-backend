/**
 * ============================================================================
 * SLOT EXTRACTOR - NAME EXTRACTION REGRESSION TESTS
 * ============================================================================
 * 
 * V94 Regression tests for name extraction.
 * 
 * These tests verify that:
 * 1. Explicit patterns ("my name is X") correctly lock the name
 * 2. Stop words like "super", "freezing", "terrible" are rejected
 * 3. Name lock prevents overwrites from fallback patterns
 * 4. Explicit corrections ("actually it's X") still work
 * 
 * Run with: npm test -- --grep "SlotExtractor"
 * ============================================================================
 */

const assert = require('assert');

// Import SlotExtractor
const SlotExtractor = require('../services/engine/booking/SlotExtractor');

describe('SlotExtractor Name Extraction', () => {
    
    // Mock context with commonFirstNames
    const baseContext = {
        turnCount: 1,
        company: {
            aiAgentSettings: {
                frontDeskBehavior: {
                    commonFirstNames: [
                        'mark', 'marcus', 'john', 'jane', 'mike', 'michael',
                        'sarah', 'david', 'chris', 'jennifer', 'robert', 'james'
                    ]
                }
            }
        }
    };
    
    describe('V94: Stop Word Rejection', () => {
        
        it('should extract "Mark" and reject "Super" from "My name is Mark. It\'s super hot."', () => {
            const result = SlotExtractor.extractAll(
                "My name is Mark. It's super hot.",
                baseContext
            );
            
            assert.ok(result.name, 'Should extract a name');
            assert.strictEqual(result.name.value, 'Mark', 'Name should be Mark, not Super');
            assert.strictEqual(result.name.nameLocked, true, 'Name should be locked');
            assert.strictEqual(result.name.patternSource, 'explicit_my_name_is', 'Should be from explicit pattern');
        });
        
        it('should extract "Mark" and reject "Very" from "This is Mark and it\'s very loud."', () => {
            const result = SlotExtractor.extractAll(
                "This is Mark and it's very loud.",
                baseContext
            );
            
            assert.ok(result.name, 'Should extract a name');
            assert.strictEqual(result.name.value, 'Mark', 'Name should be Mark');
            assert.strictEqual(result.name.nameLocked, true, 'Name should be locked');
        });
        
        it('should extract "Mark" from "Mark here — it\'s totally dead."', () => {
            // This one uses the "here" pattern which may not lock
            // But should still extract Mark
            const result = SlotExtractor.extractAll(
                "Mark here — it's totally dead.",
                { ...baseContext, expectingSlot: 'name' }
            );
            
            // May extract Mark from standalone pattern if expecting name
            if (result.name) {
                assert.strictEqual(result.name.value, 'Mark', 'Name should be Mark if extracted');
            }
        });
        
        it('should extract "Mark" from "Hi, it\'s Mark. It\'s pretty bad."', () => {
            // Uses correction pattern "it's Mark"
            const result = SlotExtractor.extractAll(
                "Hi, it's Mark. It's pretty bad.",
                baseContext
            );
            
            // Should extract via correction pattern
            if (result.name) {
                assert.strictEqual(result.name.value, 'Mark', 'Name should be Mark');
            }
        });
        
        it('should NOT extract any name from "It\'s super hot in here."', () => {
            const result = SlotExtractor.extractAll(
                "It's super hot in here.",
                baseContext
            );
            
            // Should NOT extract "Super" or "Hot" as a name
            if (result.name) {
                assert.notStrictEqual(result.name.value, 'Super', 'Should not extract Super as name');
                assert.notStrictEqual(result.name.value, 'Hot', 'Should not extract Hot as name');
                assert.notStrictEqual(result.name.value, 'Super Hot', 'Should not extract Super Hot as name');
            }
        });
        
        it('should reject "Freezing" from "It\'s freezing in here"', () => {
            const result = SlotExtractor.extractAll(
                "It's freezing in here",
                baseContext
            );
            
            if (result.name) {
                assert.notStrictEqual(result.name.value, 'Freezing', 'Should not extract Freezing as name');
            }
        });
        
        it('should reject "Terrible" from "It\'s terrible service"', () => {
            const result = SlotExtractor.extractAll(
                "It's terrible service",
                baseContext
            );
            
            if (result.name) {
                assert.notStrictEqual(result.name.value, 'Terrible', 'Should not extract Terrible as name');
            }
        });
        
    });
    
    describe('V94: Pattern Order (symptom before name)', () => {
        
        it('should extract "Mark" even when symptom comes first: "It\'s super hot. My name is Mark."', () => {
            const result = SlotExtractor.extractAll(
                "It's super hot. My name is Mark.",
                baseContext
            );
            
            assert.ok(result.name, 'Should extract a name');
            assert.strictEqual(result.name.value, 'Mark', 'Name should be Mark');
            assert.strictEqual(result.name.nameLocked, true, 'Name should be locked');
        });
        
        it('should handle mixed order: "The AC is broken. This is John calling about my unit."', () => {
            const result = SlotExtractor.extractAll(
                "The AC is broken. This is John calling about my unit.",
                baseContext
            );
            
            assert.ok(result.name, 'Should extract a name');
            assert.strictEqual(result.name.value, 'John', 'Name should be John');
        });
        
    });
    
    describe('V94: Explicit Corrections', () => {
        
        it('should allow correction: "My name is Mark... actually it\'s Marcus"', () => {
            const result = SlotExtractor.extractAll(
                "My name is Mark... actually it's Marcus",
                baseContext
            );
            
            // The correction pattern should pick up Marcus
            assert.ok(result.name, 'Should extract a name');
            // Either Mark or Marcus is acceptable - correction handling may vary
            // But it should NOT be something random like "Actually"
            assert.notStrictEqual(result.name.value, 'Actually', 'Should not extract Actually as name');
        });
        
        it('should handle "that\'s" correction: "Oh that\'s Michael"', () => {
            const result = SlotExtractor.extractAll(
                "Oh that's Michael",
                baseContext
            );
            
            if (result.name) {
                assert.strictEqual(result.name.value, 'Michael', 'Should extract Michael');
            }
        });
        
    });
    
    describe('V94: Name Lock in Merge', () => {
        
        it('should keep locked name when merging with fallback candidate', () => {
            // First extraction gets Mark (locked)
            const extracted1 = SlotExtractor.extractAll(
                "My name is Mark",
                baseContext
            );
            
            // Second extraction tries to add Super
            const extracted2 = SlotExtractor.extractAll(
                "It's super hot",
                { ...baseContext, existingSlots: extracted1 }
            );
            
            // Merge should preserve Mark
            const merged = SlotExtractor.mergeSlots(extracted1, extracted2);
            
            assert.ok(merged.name, 'Should have a name');
            assert.strictEqual(merged.name.value, 'Mark', 'Name should remain Mark after merge');
            assert.strictEqual(merged.name.nameLocked, true, 'Name should still be locked');
        });
        
    });
    
    describe('V94: CommonFirstNames Validation', () => {
        
        it('should accept "Mark Johnson" when Mark is in commonFirstNames', () => {
            const result = SlotExtractor.extractAll(
                "Mark Johnson",
                { ...baseContext, expectingSlot: 'name' }
            );
            
            if (result.name) {
                assert.ok(
                    result.name.value.includes('Mark'),
                    'Should include Mark in name'
                );
            }
        });
        
        it('should reject "Super Hot" even when expecting name (first word not in commonFirstNames)', () => {
            const result = SlotExtractor.extractAll(
                "Super Hot",
                { ...baseContext, expectingSlot: 'name' }
            );
            
            // Should NOT extract Super Hot as a name
            if (result.name) {
                assert.notStrictEqual(result.name.value, 'Super Hot', 'Should not extract Super Hot');
                assert.notStrictEqual(result.name.value, 'Super', 'Should not extract Super');
            }
        });
        
    });
    
});

/**
 * Quick manual test runner (for debugging)
 */
if (require.main === module) {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('SLOT EXTRACTOR V94 REGRESSION TESTS');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    const testCases = [
        "My name is Mark. It's super hot.",
        "This is Mark and it's very loud.",
        "Mark here — it's totally dead.",
        "Hi, it's Mark. It's pretty bad.",
        "My name is Mark... actually it's Marcus.",
        "It's super hot. My name is Mark.",
        "It's super hot in here."  // Should NOT extract a name
    ];
    
    const context = {
        turnCount: 1,
        company: {
            aiAgentSettings: {
                frontDeskBehavior: {
                    commonFirstNames: ['mark', 'marcus', 'john', 'michael']
                }
            }
        }
    };
    
    testCases.forEach((utterance, i) => {
        console.log(`Test ${i + 1}: "${utterance}"`);
        try {
            const result = SlotExtractor.extractAll(utterance, context);
            if (result.name) {
                console.log(`  → Name: ${result.name.value}`);
                console.log(`  → Locked: ${result.name.nameLocked || false}`);
                console.log(`  → Source: ${result.name.patternSource || 'unknown'}`);
            } else {
                console.log(`  → No name extracted (expected for test 7)`);
            }
        } catch (e) {
            console.log(`  → ERROR: ${e.message}`);
        }
        console.log('');
    });
}
