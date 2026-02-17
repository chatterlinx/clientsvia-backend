# 🔧 IMPLEMENTATION PLAN: S4A Triage/Scenario Layer
**Date:** February 16, 2026  
**Priority:** CRITICAL  
**Estimated Time:** 4-6 hours  
**Files to Modify:** 4 files

---

## 📋 OVERVIEW

**Problem:** Runtime skips triage/scenario layer and goes straight to DiscoveryFlowRunner, making callers feel interrogated instead of helped.

**Solution:** Insert S4A (Triage/Scenario Check) between S3 (Slot Extraction) and S4 (Discovery Flow Runner).

**Evidence Required:** Every turn must emit `SECTION_S4A_TRIAGE_CHECK` and `SECTION_S4B_DISCOVERY_OWNER_SELECTED` events.

---

## 🎯 IMPLEMENTATION STEPS

### STEP 1: Create TriageScenarioMatcher.js

**File:** `services/engine/TriageScenarioMatcher.js` (NEW)

**Purpose:** Centralized scenario matching logic with proof events.

```javascript
/**
 * ============================================================================
 * TRIAGE SCENARIO MATCHER - S4A Layer
 * ============================================================================
 * 
 * Checks if caller's utterance matches a scenario that should provide an
 * immediate reply (before asking discovery questions).
 * 
 * CONFIG PATHS:
 * - frontDeskBehavior.discoveryConsent.disableScenarioAutoResponses
 * - frontDeskBehavior.discoveryConsent.autoReplyAllowedScenarioTypes
 * - frontDeskBehavior.triage.enabled
 * - frontDeskBehavior.triage.minConfidence
 * - frontDeskBehavior.detectionTriggers.describingProblem
 * 
 * EVENTS EMITTED:
 * - SECTION_S4A_TRIAGE_CHECK (always)
 * - SECTION_S4B_DISCOVERY_OWNER_SELECTED (always)
 * 
 * ============================================================================
 */

const logger = require('../../utils/logger');
const { matchScenario } = require('../ScenarioMatcher'); // Your existing scenario engine

class TriageScenarioMatcher {
    /**
     * Attempt to match a scenario for immediate reply.
     * 
     * @param {Object} params
     * @param {Object} params.company - Company record
     * @param {String} params.userInput - Caller utterance
     * @param {Object} params.state - Call state
     * @param {String} params.callSid - Call SID
     * @returns {Object} { matched, scenarioId, scenarioType, score, response, turnEventBuffer }
     */
    static async match({ company, userInput, state, callSid }) {
        const turnEventBuffer = [];
        
        const bufferEvent = (type, data) => {
            turnEventBuffer.push({
                callId: callSid,
                companyId: company?._id?.toString?.(),
                turn: state?.turnCount || 0,
                type,
                data,
                isCritical: false,
                ts: new Date().toISOString()
            });
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 1: Check if triage/scenario layer is enabled
        // ═══════════════════════════════════════════════════════════════════════
        const dcConfig = company?.aiAgentSettings?.frontDeskBehavior?.discoveryConsent || {};
        const triageConfig = company?.aiAgentSettings?.frontDeskBehavior?.triage || {};
        const detectionTriggers = company?.aiAgentSettings?.frontDeskBehavior?.detectionTriggers || {};
        
        const disableScenarioAutoResponses = dcConfig.disableScenarioAutoResponses === true;
        const autoReplyAllowedTypes = Array.isArray(dcConfig.autoReplyAllowedScenarioTypes) 
            ? dcConfig.autoReplyAllowedScenarioTypes 
            : [];
        const triageEnabled = triageConfig.enabled !== false; // Default: enabled
        const minConfidence = triageConfig.minConfidence || 0.62;
        const describingProblemTriggers = detectionTriggers.describingProblem || [];
        
        // Check if caller is describing a problem (triggers triage mode)
        const isDescribingProblem = describingProblemTriggers.some(trigger => {
            const triggerLower = (trigger || '').toLowerCase();
            const inputLower = (userInput || '').toLowerCase();
            return inputLower.includes(triggerLower);
        });
        
        const hasCallReason = !!(state?.plainSlots?.call_reason_detail);
        
        // Should we attempt triage?
        const shouldAttemptTriage = !disableScenarioAutoResponses 
            && triageEnabled 
            && autoReplyAllowedTypes.length > 0
            && (isDescribingProblem || hasCallReason);
        
        if (!shouldAttemptTriage) {
            // Triage disabled or no reason to attempt
            const reason = disableScenarioAutoResponses 
                ? 'DISABLED_BY_CONFIG_disableScenarioAutoResponses'
                : !triageEnabled 
                ? 'DISABLED_BY_CONFIG_triage.enabled'
                : autoReplyAllowedTypes.length === 0
                ? 'NO_ALLOWED_TYPES'
                : 'NO_PROBLEM_DESCRIPTION_OR_CALL_REASON';
            
            bufferEvent('SECTION_S4A_TRIAGE_CHECK', {
                attempted: false,
                disableScenarioAutoResponses,
                triageEnabled,
                autoReplyAllowedTypes,
                isDescribingProblem,
                hasCallReason,
                reason
            });
            
            bufferEvent('SECTION_S4B_DISCOVERY_OWNER_SELECTED', {
                owner: 'DISCOVERY_FLOW',
                reason: `TRIAGE_${reason}`
            });
            
            return {
                matched: false,
                scenarioId: null,
                scenarioType: null,
                score: 0,
                response: null,
                turnEventBuffer
            };
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 2: Attempt scenario matching
        // ═══════════════════════════════════════════════════════════════════════
        let matchResult = null;
        try {
            // Use your existing scenario matcher
            matchResult = await matchScenario({
                company,
                userInput,
                state,
                allowedTypes: autoReplyAllowedTypes,
                minConfidence
            });
        } catch (err) {
            logger.error('[TRIAGE_SCENARIO_MATCHER] Match error:', {
                callSid,
                error: err.message,
                stack: err.stack
            });
            
            bufferEvent('SECTION_S4A_TRIAGE_CHECK', {
                attempted: true,
                disableScenarioAutoResponses,
                autoReplyAllowedTypes,
                error: err.message,
                reason: 'MATCH_ERROR'
            });
            
            bufferEvent('SECTION_S4B_DISCOVERY_OWNER_SELECTED', {
                owner: 'DISCOVERY_FLOW',
                reason: 'TRIAGE_MATCH_ERROR'
            });
            
            return {
                matched: false,
                scenarioId: null,
                scenarioType: null,
                score: 0,
                response: null,
                turnEventBuffer
            };
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 3: Evaluate match result
        // ═══════════════════════════════════════════════════════════════════════
        const topScenarioId = matchResult?.scenarioId || null;
        const topScenarioType = matchResult?.scenarioType || null;
        const topScenarioScore = matchResult?.score || 0;
        const topScenarioResponse = matchResult?.response || null;
        
        const scoreAboveThreshold = topScenarioScore >= minConfidence;
        const typeAllowed = autoReplyAllowedTypes.includes(topScenarioType);
        const matched = scoreAboveThreshold && typeAllowed && topScenarioResponse;
        
        // EMIT S4A TRIAGE CHECK (proof of attempt)
        bufferEvent('SECTION_S4A_TRIAGE_CHECK', {
            attempted: true,
            disableScenarioAutoResponses,
            autoReplyAllowedTypes,
            minConfidence,
            topScenarioId,
            topScenarioScore,
            topScenarioType,
            scoreAboveThreshold,
            typeAllowed,
            selected: matched,
            reason: matched 
                ? 'SCORE_ABOVE_THRESHOLD_AND_TYPE_ALLOWED'
                : !scoreAboveThreshold
                ? 'SCORE_TOO_LOW'
                : !typeAllowed
                ? 'TYPE_NOT_ALLOWED'
                : 'NO_RESPONSE_GENERATED'
        });
        
        // EMIT S4B OWNER SELECTION (proof of decision)
        if (matched) {
            bufferEvent('SECTION_S4B_DISCOVERY_OWNER_SELECTED', {
                owner: 'TRIAGE',
                scenarioId: topScenarioId,
                scenarioType: topScenarioType,
                score: topScenarioScore,
                reason: 'TRIAGE_SCORE_ABOVE_THRESHOLD_AND_TYPE_ALLOWED'
            });
            
            logger.info('[TRIAGE_SCENARIO_MATCHER] Scenario matched', {
                callSid,
                scenarioId: topScenarioId,
                scenarioType: topScenarioType,
                score: topScenarioScore
            });
        } else {
            bufferEvent('SECTION_S4B_DISCOVERY_OWNER_SELECTED', {
                owner: 'DISCOVERY_FLOW',
                reason: matched === false && !scoreAboveThreshold
                    ? 'TRIAGE_SCORE_TOO_LOW'
                    : 'TRIAGE_TYPE_NOT_ALLOWED'
            });
            
            logger.info('[TRIAGE_SCENARIO_MATCHER] No scenario match - falling through to Discovery', {
                callSid,
                topScenarioId,
                topScenarioScore,
                minConfidence,
                typeAllowed
            });
        }
        
        return {
            matched,
            scenarioId: topScenarioId,
            scenarioType: topScenarioType,
            score: topScenarioScore,
            response: matched ? topScenarioResponse : null,
            turnEventBuffer
        };
    }
}

module.exports = { TriageScenarioMatcher };
```

---

### STEP 2: Modify FrontDeskCoreRuntime.js

**File:** `services/engine/FrontDeskCoreRuntime.js`

**Location:** Between S3 (Slot Extraction) and S4 (Discovery Flow Runner)

**Line:** Insert at approximately line 650 (after slot extraction, before discovery flow)

**Import at top:**
```javascript
const { TriageScenarioMatcher } = require('./TriageScenarioMatcher');
```

**Insert S4A layer (after S3 slot extraction):**

```javascript
            // ═══════════════════════════════════════════════════════════════════════════
            // S4A: TRIAGE/SCENARIO REPLY LAYER (V116 - CRITICAL FIX)
            // ═══════════════════════════════════════════════════════════════════════════
            // WIRED FROM: frontDeskBehavior.discoveryConsent.disableScenarioAutoResponses
            //             frontDeskBehavior.discoveryConsent.autoReplyAllowedScenarioTypes
            //             frontDeskBehavior.triage.enabled
            //             frontDeskBehavior.triage.minConfidence
            //             frontDeskBehavior.detectionTriggers.describingProblem
            // 
            // PURPOSE: Provide immediate reassurance/help to caller BEFORE interrogating
            // for booking slots. If caller says "AC is down", they get triage help first,
            // then discovery asks for details later.
            // 
            // OWNER SELECTION ORDER:
            // 1. Triage/Scenario (if enabled and matched)
            // 2. Discovery Flow Runner (fallback)
            // 
            // EVENTS EMITTED (ALWAYS):
            // - SECTION_S4A_TRIAGE_CHECK (proof of attempt)
            // - SECTION_S4B_DISCOVERY_OWNER_SELECTED (proof of decision)
            // ═══════════════════════════════════════════════════════════════════════════
            
            let triageResult = null;
            
            if (state.lane === 'DISCOVERY') {
                currentSection = 'S4A_TRIAGE_SCENARIO_CHECK';
                
                triageResult = await TriageScenarioMatcher.match({
                    company,
                    userInput,
                    state,
                    callSid
                });
                
                // Merge triage events into our buffer
                if (triageResult.turnEventBuffer) {
                    turnEventBuffer.push(...triageResult.turnEventBuffer);
                }
            }
            
            // ═══════════════════════════════════════════════════════════════════════════
            // S4 / S5 / S6: DISCOVERY → CONSENT → BOOKING (existing code)
            // ═══════════════════════════════════════════════════════════════════════════
            
            // Check if triage produced a reply
            const triageMatched = triageResult?.matched === true;
            
            if (triageMatched && triageResult.response) {
                // Triage/Scenario matched - use that response
                ownerResult = {
                    response: triageResult.response,
                    matchSource: 'TRIAGE_SCENARIO',
                    scenarioId: triageResult.scenarioId,
                    scenarioType: triageResult.scenarioType,
                    score: triageResult.score,
                    state: state
                };
                
                logger.info('[FRONT_DESK_CORE_RUNTIME] Triage scenario matched - using scenario reply', {
                    callSid,
                    scenarioId: triageResult.scenarioId,
                    scenarioType: triageResult.scenarioType,
                    score: triageResult.score
                });
            } else {
                // No triage match - fall through to Discovery Flow Runner
                // (EXISTING CODE BLOCK STARTS HERE)
                
                if (state.lane === 'BOOKING') {
                    // ... existing booking flow code ...
                } else if (state.lane === 'DISCOVERY') {
                    // ... existing discovery flow code ...
                    // (Lines 645-744 of current file remain unchanged)
                }
            }
```

**Important:** The existing discovery/booking flow code (lines 645-744) should be **wrapped inside the `else` block** so it only runs if triage didn't match.

---

### STEP 3: Add Pending Slot Buffer to StateStore.js

**File:** `services/engine/StateStore.js`

**Purpose:** Separate pending (unconfirmed) slots from confirmed slots.

**Changes:**

**1. Add pendingSlots to state initialization:**
```javascript
static load(callState) {
    return {
        lane: callState?.sessionMode || 'DISCOVERY',
        sessionMode: callState?.sessionMode || 'DISCOVERY',
        turnCount: callState?.turnCount || 0,
        plainSlots: { ...(callState?.plainSlots || {}) },
        pendingSlots: { ...(callState?.pendingSlots || {}) },  // NEW
        confirmedSlots: { ...(callState?.confirmedSlots || {}) },  // NEW (separate from plain)
        // ... rest of state ...
    };
}
```

**2. Add pendingSlots to state persistence:**
```javascript
static persist(callState, updatedState) {
    return {
        ...callState,
        sessionMode: updatedState.lane || updatedState.sessionMode || 'DISCOVERY',
        turnCount: (callState?.turnCount || 0) + 1,
        plainSlots: { ...(updatedState.plainSlots || {}) },
        pendingSlots: { ...(updatedState.pendingSlots || {}) },  // NEW
        confirmedSlots: { ...(updatedState.confirmedSlots || {}) },  // NEW
        // ... rest of state ...
    };
}
```

---

### STEP 4: Modify SlotExtractor to use Pending Slots

**File:** `services/engine/booking/SlotExtractor.js`

**Change:** When extracting slots during discovery, store them as **pending** (not confirmed).

**Find the extraction result code (approximately line 150-200):**

**BEFORE:**
```javascript
// Store extracted slots
state.plainSlots = state.plainSlots || {};
state.plainSlots.name = extractedName;
state.plainSlots.phone = extractedPhone;
// ... etc
```

**AFTER:**
```javascript
// Store extracted slots as PENDING during discovery
const isPendingPhase = state.lane === 'DISCOVERY' || state.sessionMode === 'DISCOVERY';

if (isPendingPhase) {
    // Discovery phase: store as pending (not confirmed)
    state.pendingSlots = state.pendingSlots || {};
    state.pendingSlots.name = extractedName;
    state.pendingSlots.phone = extractedPhone;
    state.pendingSlots.address = extractedAddress;
    state.pendingSlots.call_reason_detail = extractedReason;
    
    // Also copy to plainSlots for backward compatibility
    state.plainSlots = state.plainSlots || {};
    Object.assign(state.plainSlots, state.pendingSlots);
    
    // EMIT PENDING SLOTS EVENT
    bufferEvent('SECTION_S3_PENDING_SLOTS_STORED', {
        slotsExtracted: Object.keys(state.pendingSlots),
        confirmedStatus: 'PENDING',
        reason: 'EXTRACTED_DURING_DISCOVERY'
    });
} else {
    // Booking phase: confirm pending slots
    state.confirmedSlots = state.confirmedSlots || {};
    state.confirmedSlots.name = extractedName;
    state.confirmedSlots.phone = extractedPhone;
    state.confirmedSlots.address = extractedAddress;
    
    // EMIT CONFIRMATION EVENT
    bufferEvent('SECTION_S6_PENDING_SLOTS_CONFIRMED', {
        slotsConfirmed: Object.keys(state.confirmedSlots),
        confirmedStatus: 'CONFIRMED',
        reason: 'CONFIRMED_DURING_BOOKING'
    });
}
```

---

### STEP 5: Update Discovery Flow Runner to use Pending Slots

**File:** `services/engine/DiscoveryFlowRunner.js`

**Change:** Use `pendingSlots` for context, don't ask to confirm them yet.

**Find the `buildDeterministicPrompt` method (line ~150):**

**BEFORE:**
```javascript
static buildDeterministicPrompt(company, plainSlots = {}, confirmedSlots = {}, fullState = null) {
    const steps = [...(company?.aiAgentSettings?.frontDeskBehavior?.discoveryFlow?.steps || [])]
        .sort((a, b) => (a.order || 0) - (b.order || 0));

    for (const step of steps) {
        const value = plainSlots[step.slotId];
        const isConfirmed = confirmedSlots[step.slotId] === true;
        
        if (!value) {
            return step.ask || step.reprompt || `What is your ${step.slotId}?`;
        }
        // ... confirmation logic ...
    }
}
```

**AFTER:**
```javascript
static buildDeterministicPrompt(company, plainSlots = {}, confirmedSlots = {}, fullState = null) {
    const steps = [...(company?.aiAgentSettings?.frontDeskBehavior?.discoveryFlow?.steps || [])]
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    
    const pendingSlots = fullState?.pendingSlots || {};

    for (const step of steps) {
        const value = plainSlots[step.slotId];
        const isPending = !!pendingSlots[step.slotId];  // NEW
        const isConfirmed = confirmedSlots[step.slotId] === true;
        
        if (!value) {
            return step.ask || step.reprompt || `What is your ${step.slotId}?`;
        }
        
        // If slot is pending (extracted during discovery), use it for context but don't confirm yet
        if (isPending && !isConfirmed) {
            // Skip confirmation during discovery - will confirm later in booking
            logger.info('[DISCOVERY_FLOW] Slot is pending, skipping confirmation until booking', {
                slotId: step.slotId,
                value: value
            });
            continue; // Move to next step
        }
        
        // ... rest of confirmation logic ...
    }
}
```

---

### STEP 6: Wire Detection Triggers to Behaviors

**File:** `services/engine/FrontDeskCoreRuntime.js`

**Location:** After S3 slot extraction, before S4A triage check

**Add detection trigger processing:**

```javascript
            // ═══════════════════════════════════════════════════════════════════════════
            // S3.5: DETECTION TRIGGER PROCESSING (V116)
            // ═══════════════════════════════════════════════════════════════════════════
            // WIRED FROM: frontDeskBehavior.detectionTriggers
            // 
            // PURPOSE: Detect caller patterns and adjust behavior accordingly.
            // ═══════════════════════════════════════════════════════════════════════════
            
            currentSection = 'S3_5_DETECTION_TRIGGERS';
            const detectionTriggers = company?.aiAgentSettings?.frontDeskBehavior?.detectionTriggers || {};
            const inputLower = (userInput || '').toLowerCase();
            
            // Check: Trust Concern
            const trustConcernTriggered = (detectionTriggers.trustConcern || []).some(trigger => 
                inputLower.includes((trigger || '').toLowerCase())
            );
            if (trustConcernTriggered) {
                state._empathyMode = 'trust_concern';
                bufferEvent('SECTION_S3_5_TRUST_CONCERN_DETECTED', {
                    trigger: 'trustConcern',
                    action: 'ACTIVATE_EMPATHY_MODE'
                });
            }
            
            // Check: Caller Feels Ignored
            const callerFeelsIgnoredTriggered = (detectionTriggers.callerFeelsIgnored || []).some(trigger => 
                inputLower.includes((trigger || '').toLowerCase())
            );
            if (callerFeelsIgnoredTriggered) {
                state._empathyMode = 'feels_ignored';
                bufferEvent('SECTION_S3_5_CALLER_FEELS_IGNORED_DETECTED', {
                    trigger: 'callerFeelsIgnored',
                    action: 'ACTIVATE_EMPATHY_MODE'
                });
            }
            
            // Check: Refused Slot
            const refusedSlotTriggered = (detectionTriggers.refusedSlot || []).some(trigger => 
                inputLower.includes((trigger || '').toLowerCase())
            );
            if (refusedSlotTriggered) {
                state._slotRefusalDetected = true;
                bufferEvent('SECTION_S3_5_REFUSED_SLOT_DETECTED', {
                    trigger: 'refusedSlot',
                    action: 'MARK_SLOT_AS_OPTIONAL'
                });
            }
```

---

## 📊 SUCCESS VALIDATION

### Test Scenario 1: Mrs. Johnson (AC Down)

**Input:** "This is Mrs. Johnson, 123 Market St Fort Myers — AC is down."

**Expected Raw Events:**
```json
[
  {
    "type": "SECTION_S3_SLOT_EXTRACTION",
    "data": {
      "slotsExtracted": ["name", "address", "call_reason_detail"]
    }
  },
  {
    "type": "SECTION_S3_PENDING_SLOTS_STORED",
    "data": {
      "slotsExtracted": ["name", "address", "call_reason_detail"],
      "confirmedStatus": "PENDING"
    }
  },
  {
    "type": "SECTION_S4A_TRIAGE_CHECK",
    "data": {
      "attempted": true,
      "disableScenarioAutoResponses": false,
      "autoReplyAllowedTypes": ["FAQ", "TROUBLESHOOT", "EMERGENCY"],
      "topScenarioId": "ac_not_cooling_v2",
      "topScenarioScore": 0.89,
      "topScenarioType": "TROUBLESHOOT",
      "selected": true,
      "reason": "SCORE_ABOVE_THRESHOLD_AND_TYPE_ALLOWED"
    }
  },
  {
    "type": "SECTION_S4B_DISCOVERY_OWNER_SELECTED",
    "data": {
      "owner": "TRIAGE",
      "scenarioId": "ac_not_cooling_v2",
      "scenarioType": "TROUBLESHOOT",
      "score": 0.89,
      "reason": "TRIAGE_SCORE_ABOVE_THRESHOLD_AND_TYPE_ALLOWED"
    }
  }
]
```

**Expected Response:**
"Got it, Mrs. Johnson — AC down at 123 Market St in Fort Myers. Quick question: is the system completely not turning on, or is it running but not cooling?"

**Expected `matchSource`:** `"TRIAGE_SCENARIO"`

---

### Test Scenario 2: No Scenario Match

**Input:** "Hi, I'm calling about... uh... not sure."

**Expected Raw Events:**
```json
[
  {
    "type": "SECTION_S4A_TRIAGE_CHECK",
    "data": {
      "attempted": true,
      "selected": false,
      "reason": "SCORE_TOO_LOW"
    }
  },
  {
    "type": "SECTION_S4B_DISCOVERY_OWNER_SELECTED",
    "data": {
      "owner": "DISCOVERY_FLOW",
      "reason": "TRIAGE_SCORE_TOO_LOW"
    }
  },
  {
    "type": "SECTION_S4_DISCOVERY_ENGINE",
    "data": { ... }
  }
]
```

**Expected Response:** Discovery step question (from DiscoveryFlowRunner)

**Expected `matchSource`:** `"DISCOVERY_FLOW_RUNNER"`

---

### Test Scenario 3: Triage Disabled

**Config:** `disableScenarioAutoResponses: true`

**Input:** "AC is down."

**Expected Raw Events:**
```json
[
  {
    "type": "SECTION_S4A_TRIAGE_CHECK",
    "data": {
      "attempted": false,
      "disableScenarioAutoResponses": true,
      "reason": "DISABLED_BY_CONFIG_disableScenarioAutoResponses"
    }
  },
  {
    "type": "SECTION_S4B_DISCOVERY_OWNER_SELECTED",
    "data": {
      "owner": "DISCOVERY_FLOW",
      "reason": "TRIAGE_DISABLED_BY_CONFIG_disableScenarioAutoResponses"
    }
  }
]
```

**Expected Response:** Discovery step question (triage skipped by config)

**Expected `matchSource`:** `"DISCOVERY_FLOW_RUNNER"`

---

## 🚀 DEPLOYMENT CHECKLIST

- [ ] Create `TriageScenarioMatcher.js`
- [ ] Modify `FrontDeskCoreRuntime.js` (add S4A layer)
- [ ] Modify `StateStore.js` (add pendingSlots)
- [ ] Modify `SlotExtractor.js` (store as pending during discovery)
- [ ] Modify `DiscoveryFlowRunner.js` (skip pending slot confirmation)
- [ ] Add detection trigger processing to `FrontDeskCoreRuntime.js`
- [ ] Test with Mrs. Johnson scenario
- [ ] Verify raw events in database
- [ ] Update `DISCOVERY_FLOW_DEEP_DIVE.md` documentation
- [ ] Add unit tests for `TriageScenarioMatcher`
- [ ] Deploy to staging
- [ ] Monitor `matchSource` distribution (target: 60-70% TRIAGE)
- [ ] Deploy to production

---

## 📝 NOTES

1. **Backward Compatibility:** `plainSlots` still populated for legacy code paths.
2. **Event Proof:** Every turn emits `S4A_TRIAGE_CHECK` and `S4B_OWNER_SELECTED` (no guessing).
3. **Config Fix:** User must change `disableScenarioAutoResponses: false` to enable.
4. **Performance:** Triage check adds ~100-200ms (acceptable for better UX).

---

**END OF IMPLEMENTATION PLAN**

*Generated: February 16, 2026*  
*Priority: CRITICAL*  
*Complexity: Medium*
