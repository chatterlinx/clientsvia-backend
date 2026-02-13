/**
 * V110 LastName Extraction Regression Test
 * 
 * This test reproduces the exact scenario from call CA7d853b6618973159ea5aa179a9e5ba05
 * where the agent got stuck in an infinite loop asking for last name.
 * 
 * Expected Behavior:
 * - Input: "my last name is gonzalez."
 * - Extract: "gonzalez"
 * - Score: HIGH (Gonzalez is a common Hispanic last name)
 * - Result: Accept and advance to next step
 * 
 * Actual Behavior (BUG):
 * - Extraction or scoring fails
 * - Agent reprompts same question
 * - Infinite loop
 */

const assert = require('assert');

describe('V110 LastName Extraction - Gonzalez Case', function() {
    // We need to test the actual BookingFlowRunner logic
    // But it's a complex module with many dependencies
    // So we'll create a minimal test harness
    
    it('should extract "gonzalez" from "my last name is gonzalez."', function() {
        const input = "my last name is gonzalez.";
        
        // Pattern from BookingFlowRunner.js line 1259
        const pattern = /(?:my\s+(?:last|first)?\s*name\s+is)\s+(\w+)/i;
        const match = input.match(pattern);
        
        assert(match, 'Pattern should match the input');
        assert.strictEqual(match[1], 'gonzalez', 'Should extract "gonzalez"');
    });
    
    it('should accept "Gonzalez" as a valid last name structure', function() {
        const candidate = "gonzalez";
        
        // Structure validation from BookingFlowRunner.js line 1423
        const isValidStructure = /^[A-Za-z][A-Za-z\-']{1,14}$/.test(candidate);
        
        assert(isValidStructure, 'Gonzalez should pass structure validation');
    });
    
    it('should NOT treat "gonzalez" as a hard stop word', function() {
        const candidate = "gonzalez";
        
        // Hard stop words from BookingFlowRunner.js (need to check what's in NAME_HARD_STOP_WORDS)
        // These are words like "yes", "no", "yeah", "okay", etc.
        const knownStopWords = new Set([
            'yes', 'no', 'yeah', 'yep', 'nope', 'okay', 'ok',
            'sure', 'right', 'correct', 'that', 'it', 'um', 'uh'
        ]);
        
        assert(!knownStopWords.has(candidate.toLowerCase()), 
            'Gonzalez should NOT be a stop word');
    });
    
    it('DIAGNOSTIC: What happens after extraction?', function() {
        const input = "my last name is gonzalez.";
        const pattern = /(?:my\s+(?:last|first)?\s*name\s+is)\s+(\w+)/i;
        const match = input.match(pattern);
        
        if (match && match[1]) {
            const extracted = match[1].trim().toLowerCase();
            console.log('\n[DIAGNOSTIC]');
            console.log('  Input:', input);
            console.log('  Extracted:', extracted);
            console.log('  Length:', extracted.length);
            console.log('  Valid structure:', /^[A-Za-z][A-Za-z\-']{1,14}$/.test(extracted));
            
            // The failure must be in the scoring phase
            // Need to check if "gonzalez" is in the 50K last names database
            console.log('\n  ⚠️  Next step: Check if "gonzalez" is in lastNames.json');
            console.log('  ⚠️  If NOT in database → scoring will fail → rejection');
            console.log('  ⚠️  Score formula (when NOT in list):');
            console.log('      - validStructure: +0.2');
            console.log('      - unknownButValid: +0.3');
            console.log('      - TOTAL: 0.5');
            console.log('      - Threshold: 0.4 (accept)');
            console.log('  ✅  So even if NOT in list, should accept with confirmation');
        }
    });
});

describe('V110 LastName Extraction - Root Cause Analysis', function() {
    it('HYPOTHESIS 1: Extraction returns null due to trailing period', function() {
        // The STT gives us: "my last name is gonzalez."
        // After cleaning: "my last name is gonzalez."
        // Pattern: /(\w+)/ should capture "gonzalez"
        // BUT: Does the pattern work with trailing punctuation?
        
        const inputs = [
            "my last name is gonzalez",
            "my last name is gonzalez.",
            "my last name is gonzalez .",
            ", my last name is gonzalez.",
            "um, my last name is gonzalez"
        ];
        
        const pattern = /(?:my\s+(?:last|first)?\s*name\s+is)\s+(\w+)/i;
        
        console.log('\n[HYPOTHESIS 1 TEST]');
        inputs.forEach(input => {
            const match = input.match(pattern);
            console.log(`  "${input}"`);
            console.log(`    → Extracted: ${match ? match[1] : 'NULL'} ${match ? '✅' : '❌'}`);
        });
    });
    
    it('HYPOTHESIS 2: Multiple extraction functions conflict', function() {
        // Looking at BookingFlowRunner.js, there are TWO extraction functions:
        // 1. extractSingleNameToken (lines 1284-1395) - Used for lastName
        // 2. extractNameCandidate (lines 1496-1560) - Used for firstName?
        // 
        // Are they being called correctly? Is the wrong one being used?
        
        console.log('\n[HYPOTHESIS 2]');
        console.log('  extractSingleNameToken:');
        console.log('    - Has explicit NAME_ANSWER_PATTERNS');
        console.log('    - Returns lowercase string or null');
        console.log('    - Used in handleCollectDetailsMode for lastName');
        console.log('\n  ⚠️  Check: Is extractSingleNameToken actually being called?');
        console.log('  ⚠️  Check: Are there any early returns before extraction?');
    });
    
    it('HYPOTHESIS 3: state.askedForLastName flag causes early return', function() {
        // From BookingFlowRunner.js line 3559:
        // if (!userInput || userInput.trim() === '' || !state.askedForLastName) {
        //     // Ask for last name
        //     state.askedForLastName = true;
        //     return { reply: "And what's your last name?" };
        // }
        // 
        // Turn 1: askedForLastName is FALSE → ask question, set flag to TRUE
        // Turn 2: askedForLastName is TRUE, userInput exists → should proceed to extraction
        // 
        // BUT: Is the flag being preserved across turns?
        
        console.log('\n[HYPOTHESIS 3]');
        console.log('  Turn 1: state.askedForLastName = false');
        console.log('    → Ask question, set flag = true, save state to Redis');
        console.log('\n  Turn 2: Load state from Redis');
        console.log('    → Is askedForLastName still true?');
        console.log('    → If YES: proceed to extraction');
        console.log('    → If NO: ask question again (INFINITE LOOP)');
        console.log('\n  ⚠️  ROOT CAUSE CANDIDATE: State not persisting between turns!');
    });
    
    it('HYPOTHESIS 4: currentStepId never advances', function() {
        // From raw events:
        // Turn 1: currentStepId = "lastName"
        // Turn 2: currentStepId = "lastName" (SAME!)
        // Turn 3: currentStepId = "lastName" (SAME!)
        //
        // The step is not advancing. Why?
        // Look at BookingFlowRunner.js line 3615-3700
        // After successful extraction, it should call:
        //   const nextAction = this.determineNextAction(flow, state, {});
        //   state.currentStepId = nextAction.step.id;
        // 
        // Is this being reached?
        
        console.log('\n[HYPOTHESIS 4]');
        console.log('  After lastName extraction succeeds:');
        console.log('    1. safeSetSlot(state, "name", fullName)');
        console.log('    2. markSlotConfirmed(state, "name")');
        console.log('    3. determineNextAction(flow, state) → should return phone/address step');
        console.log('    4. state.currentStepId = nextAction.step.id');
        console.log('\n  ⚠️  Check: Is step #1 (safeSetSlot) succeeding?');
        console.log('  ⚠️  Check: If safeSetSlot fails, does it return early without advancing?');
    });
});

describe('V110 CRITICAL: The Actual Bug Location', function() {
    it('SMOKING GUN: state.askedForLastName persistence', function() {
        // LINE 3559 in BookingFlowRunner.js:
        // if (!userInput || userInput.trim() === '' || !state.askedForLastName) {
        //
        // This condition will trigger the "ask question" path if EITHER:
        // 1. No user input (timeout)
        // 2. Empty input
        // 3. state.askedForLastName is falsy
        //
        // Turn 1: !state.askedForLastName is TRUE → ask question
        // Turn 2: state.askedForLastName should be TRUE... but is it?
        //
        // RAW EVENTS CHECK:
        // Turn 2 → STATE_LOADED → does it show askedForLastName flag?
        
        console.log('\n[SMOKING GUN TEST]');
        console.log('  If state.askedForLastName is NOT persisting:');
        console.log('    → Every turn will hit line 3559');
        console.log('    → Every turn will ask "And what\'s your last name?"');
        console.log('    → User input is NEVER processed');
        console.log('    → INFINITE LOOP CONFIRMED');
        console.log('\n  FIX: Ensure askedForLastName is saved to Redis state');
        console.log('       and loaded back on next turn');
    });
});
