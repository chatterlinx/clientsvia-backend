# 🚨 FRONT DESK WIRING GAP ANALYSIS
**Date:** February 16, 2026  
**Issue:** Configuration exists but runtime doesn't consult it  
**Severity:** CRITICAL - System behavior does not match config intent

---

## 🔥 THE SMOKING GUN

### What the audit said:
✅ "All tabs save to database correctly"  
✅ "Discovery Flow is fully wired"  
✅ "Events log to JSON raw events"

### What the audit MISSED:
❌ **Runtime doesn't check scenario/triage config before DiscoveryFlowRunner**  
❌ **No SECTION_S4A_TRIAGE_CHECK event exists**  
❌ **No proof of owner selection decision-making**  
❌ **`disableScenarioAutoResponses` flag is ignored at runtime**

---

## 📍 CURRENT RUNTIME EXECUTION ORDER (As-Is)

**File:** `services/engine/FrontDeskCoreRuntime.js`

```javascript
processTurn() {
  // S1: Runtime Ownership (line 132)
  ├─ Set lane = DISCOVERY or BOOKING
  
  // S1.5: Connection Quality Gate (line 146)
  ├─ Check for "hello?" / low STT confidence
  
  // S2: Input Text Truth (line 248)
  ├─ Log what text we got
  
  // S2.5: Escalation Detection (line 269)
  ├─ Check for "speak to manager"
  
  // GREET: Greeting Intercept (line 341)
  ├─ Check for "good morning" → instant response
  
  // S3: Slot Extraction (line 429)
  ├─ Extract name/phone/address/call_reason_detail
  
  // 🚨 MISSING: S4A TRIAGE/SCENARIO CHECK
  // (Should happen here, doesn't exist)
  
  // S4: Discovery Flow Runner (line 698-700)
  ├─ Ask for next discovery step
  └─ ALWAYS runs (no scenario layer check)
  
  // S5: Consent Gate (line 651 or 714)
  ├─ "Would you like me to schedule?"
  
  // S6: Booking Flow (line 695 or 739)
  ├─ Collect booking slots
  
  // OPEN: Opener Engine (line 768)
  └─ Prepend "Alright." micro-ack
}
```

**The gap:** Between S3 (Slot Extraction) and S4 (Discovery Flow), there should be **S4A: Triage/Scenario Reply Layer**.

---

## ❌ MISSING RUNTIME CODE

### What should exist but doesn't:

```javascript
// MISSING: S4A - Triage/Scenario Reply Layer (should be ~line 650)
currentSection = 'S4A_TRIAGE_SCENARIO_CHECK';

const dcConfig = company?.aiAgentSettings?.frontDeskBehavior?.discoveryConsent || {};
const disableScenarioAutoResponses = dcConfig.disableScenarioAutoResponses !== false;
const autoReplyAllowedTypes = dcConfig.autoReplyAllowedScenarioTypes || [];

let triageReply = null;
let triageAttempted = false;

if (!disableScenarioAutoResponses && autoReplyAllowedTypes.length > 0) {
    // Attempt triage/scenario matching
    triageAttempted = true;
    
    const triageResult = await TriageEngine.match({
        company,
        callSid,
        userInput,
        state,
        allowedTypes: autoReplyAllowedTypes
    });
    
    // EMIT TRIAGE CHECK EVENT (proof of attempt)
    bufferEvent('SECTION_S4A_TRIAGE_CHECK', {
        attempted: true,
        disableScenarioAutoResponses,
        autoReplyAllowedTypes,
        topScenarioId: triageResult.scenarioId,
        topScenarioScore: triageResult.score,
        topScenarioType: triageResult.type,
        selected: triageResult.score >= THRESHOLD,
        reason: triageResult.score >= THRESHOLD 
            ? 'SCORE_ABOVE_THRESHOLD' 
            : 'SCORE_TOO_LOW'
    });
    
    if (triageResult.score >= THRESHOLD) {
        // Use scenario reply
        triageReply = triageResult.response;
        
        // EMIT OWNER SELECTION (proof of decision)
        bufferEvent('SECTION_S4B_DISCOVERY_OWNER_SELECTED', {
            owner: 'TRIAGE',
            scenarioId: triageResult.scenarioId,
            scenarioType: triageResult.type,
            score: triageResult.score,
            reason: 'TRIAGE_SCORE_ABOVE_THRESHOLD'
        });
    }
} else {
    // Triage disabled - emit proof
    bufferEvent('SECTION_S4A_TRIAGE_CHECK', {
        attempted: false,
        disableScenarioAutoResponses,
        autoReplyAllowedTypes,
        reason: disableScenarioAutoResponses 
            ? 'DISABLED_BY_CONFIG' 
            : 'NO_ALLOWED_TYPES'
    });
}

// If triage didn't produce a reply, fall through to DiscoveryFlowRunner
if (!triageReply) {
    bufferEvent('SECTION_S4B_DISCOVERY_OWNER_SELECTED', {
        owner: 'DISCOVERY_FLOW',
        reason: triageReply === null 
            ? 'TRIAGE_NO_MATCH' 
            : 'TRIAGE_DISABLED'
    });
    
    ownerResult = DiscoveryFlowRunner.run({ company, callSid, userInput, state });
} else {
    ownerResult = {
        response: triageReply,
        matchSource: 'TRIAGE_SCENARIO',
        state: state
    };
}
```

**This code does NOT exist in FrontDeskCoreRuntime.js.**

---

## 🗂️ CONFIG KEYS → RUNTIME MAPPING

### Discovery & Consent Tab (Tab 2)

| Config Key | Current Storage Path | Runtime Usage | Status |
|------------|---------------------|---------------|--------|
| `discoveryConsent.bookingRequiresExplicitConsent` | `frontDeskBehavior.discoveryConsent.bookingRequiresExplicitConsent` | ✅ Used by ConsentGate.js | **WIRED** |
| `discoveryConsent.forceLLMDiscovery` | `frontDeskBehavior.discoveryConsent.forceLLMDiscovery` | ❌ NOT CHECKED | **BROKEN** |
| `discoveryConsent.disableScenarioAutoResponses` | `frontDeskBehavior.discoveryConsent.disableScenarioAutoResponses` | ❌ NOT CHECKED | **BROKEN** |
| `discoveryConsent.autoReplyAllowedScenarioTypes` | `frontDeskBehavior.discoveryConsent.autoReplyAllowedScenarioTypes` | ❌ NOT CHECKED | **BROKEN** |
| `discoveryConsent.consentQuestionTemplate` | `frontDeskBehavior.discoveryConsent.consentQuestionTemplate` | ✅ Used by ConsentGate.js | **WIRED** |
| `discoveryConsent.consentYesWords` | `frontDeskBehavior.discoveryConsent.consentYesWords` | ✅ Used by ConsentGate.js | **WIRED** |

**3 out of 6 keys are completely ignored by runtime.**

### Detection Tab (Tab 10)

| Config Key | Current Storage Path | Runtime Usage | Status |
|------------|---------------------|---------------|--------|
| `detectionTriggers.wantsBooking` | `frontDeskBehavior.detectionTriggers.wantsBooking` | ✅ Used by ConsentGate.js | **WIRED** |
| `detectionTriggers.directIntentPatterns` | `frontDeskBehavior.detectionTriggers.directIntentPatterns` | ✅ Used by ConsentGate.js | **WIRED** |
| `detectionTriggers.describingProblem` | `frontDeskBehavior.detectionTriggers.describingProblem` | ❌ NOT CHECKED | **BROKEN** |
| `detectionTriggers.trustConcern` | `frontDeskBehavior.detectionTriggers.trustConcern` | ❌ NOT CHECKED | **BROKEN** |
| `detectionTriggers.callerFeelsIgnored` | `frontDeskBehavior.detectionTriggers.callerFeelsIgnored` | ❌ NOT CHECKED | **BROKEN** |
| `detectionTriggers.refusedSlot` | `frontDeskBehavior.detectionTriggers.refusedSlot` | ❌ NOT CHECKED | **BROKEN** |

**4 out of 6 keys are completely ignored by runtime.**

### Discovery Flow Tab (Tab 5)

| Config Key | Current Storage Path | Runtime Usage | Status |
|------------|---------------------|---------------|--------|
| `slotRegistry.slots` | `frontDeskBehavior.slotRegistry.slots` | ✅ Used by SlotExtractor | **WIRED** |
| `discoveryFlow.steps` | `frontDeskBehavior.discoveryFlow.steps` | ✅ Used by DiscoveryFlowRunner | **WIRED** |
| `bookingFlow.steps` | `frontDeskBehavior.bookingFlow.steps` | ✅ Used by BookingFlowRunner | **WIRED** |
| `openers` | `frontDeskBehavior.openers` | ✅ Used by OpenerEngine | **WIRED** |
| `discoveryResponseTemplates` | `frontDeskBehavior.discoveryResponseTemplates` | ✅ Used by DiscoveryFlowRunner | **WIRED** |
| `triage.enabled` | `frontDeskBehavior.triage.enabled` | ❌ NOT CHECKED | **BROKEN** |
| `triage.minConfidence` | `frontDeskBehavior.triage.minConfidence` | ❌ NOT CHECKED | **BROKEN** |
| `triage.autoOnProblem` | `frontDeskBehavior.triage.autoOnProblem` | ❌ NOT CHECKED | **BROKEN** |

**3 out of 8 keys are completely ignored by runtime.**

---

## 🎯 THE MRS. JOHNSON SCENARIO - CURRENT VS DESIRED

### Current Behavior (Broken)

**Caller:** "This is Mrs. Johnson, 123 Market St Fort Myers — AC is down."

**Runtime Flow:**
1. ✅ S3: Slot Extraction
   - Extracts: `name: "Johnson"`, `address: "123 Market St Fort Myers"`, `call_reason_detail: "AC is down"`
2. ❌ S4A: Triage/Scenario Check
   - **SKIPPED** (code doesn't exist)
3. ✅ S4: Discovery Flow Runner
   - Asks: "I have 12155 Metro Parkway. Is that correct?"
4. ❌ Caller gets interrogated, not reassured

**Raw Events:**
```json
[
  { "type": "SECTION_S3_SLOT_EXTRACTION", "data": { ... } },
  { "type": "SECTION_S4_DISCOVERY_ENGINE", "data": { "currentSlotId": "address" } }
]
```

**No triage event. No proof of why triage was skipped.**

### Desired Behavior (Fixed)

**Caller:** "This is Mrs. Johnson, 123 Market St Fort Myers — AC is down."

**Runtime Flow:**
1. ✅ S3: Slot Extraction
   - Extracts: `name: "Johnson"`, `address: "123 Market St Fort Myers"`, `call_reason_detail: "AC is down"`
   - **Store as PENDING (unconfirmed)**
2. ✅ S4A: Triage/Scenario Check
   - Matches: "AC not cooling" scenario (type: TROUBLESHOOT)
   - Score: 0.89 (above threshold)
   - **Reply:** "Got it, Mrs. Johnson — AC down at 123 Market St in Fort Myers. Quick question: is the system completely not turning on, or is it running but not cooling?"
3. ⏭️ S4: Discovery Flow Runner
   - **SKIPPED** (triage provided reply)
4. ✅ Caller feels heard, gets triage question

**Raw Events:**
```json
[
  {
    "type": "SECTION_S3_SLOT_EXTRACTION",
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
      "reason": "SCORE_ABOVE_THRESHOLD"
    }
  },
  {
    "type": "SECTION_S4B_DISCOVERY_OWNER_SELECTED",
    "data": {
      "owner": "TRIAGE",
      "scenarioId": "ac_not_cooling_v2",
      "scenarioType": "TROUBLESHOOT",
      "score": 0.89,
      "reason": "TRIAGE_SCORE_ABOVE_THRESHOLD"
    }
  }
]
```

**Later, when consent is given and booking starts:**

**Runtime:** "Perfect — just confirming: your first name is? And last name is Johnson? Service address is 123 Market St, Fort Myers — correct?"

**Slots confirmed during booking, not interrogated during discovery.**

---

## 📊 KEEP/DELETE/WIRE MATRIX

### Tab 1: Personality
| Component | Keep/Delete | Wiring Status | Action Required |
|-----------|-------------|---------------|-----------------|
| AI Name | ✅ KEEP | ✅ WIRED | None |
| Greeting Responses | ✅ KEEP | ✅ WIRED | None |
| Tone/Warmth/Pace | ✅ KEEP | ✅ WIRED | None |
| Forbidden Phrases | ✅ KEEP | ✅ WIRED | None |

### Tab 2: Discovery & Consent ⚠️ CRITICAL GAPS
| Component | Keep/Delete | Wiring Status | Action Required |
|-----------|-------------|---------------|-----------------|
| Connection Quality Gate | ✅ KEEP | ✅ WIRED | None |
| `bookingRequiresExplicitConsent` | ✅ KEEP | ✅ WIRED | None |
| `forceLLMDiscovery` | ⚠️ KEEP | ❌ **BROKEN** | **Add runtime check** |
| `disableScenarioAutoResponses` | ⚠️ KEEP | ❌ **BROKEN** | **Add runtime check** |
| `autoReplyAllowedScenarioTypes` | ⚠️ KEEP | ❌ **BROKEN** | **Add runtime check** |
| Consent Question/Yes Words | ✅ KEEP | ✅ WIRED | None |

**Priority:** Fix `disableScenarioAutoResponses` and `autoReplyAllowedScenarioTypes` wiring

### Tab 5: Discovery Flow
| Component | Keep/Delete | Wiring Status | Action Required |
|-----------|-------------|---------------|-----------------|
| Slot Registry | ✅ KEEP | ✅ WIRED | None |
| Discovery Flow Steps | ✅ KEEP | ✅ WIRED | None |
| Booking Flow Steps | ✅ KEEP | ✅ WIRED | None |
| Openers | ✅ KEEP | ✅ WIRED | None |
| V110 Response Templates | ✅ KEEP | ✅ WIRED | None |
| `triage.enabled` | ⚠️ KEEP | ❌ **BROKEN** | **Add S4A layer** |
| `triage.minConfidence` | ⚠️ KEEP | ❌ **BROKEN** | **Add S4A layer** |
| `triage.autoOnProblem` | ⚠️ KEEP | ❌ **BROKEN** | **Add S4A layer** |

**Priority:** Implement S4A Triage/Scenario layer

### Tab 10: Detection ⚠️ CRITICAL GAPS
| Component | Keep/Delete | Wiring Status | Action Required |
|-----------|-------------|---------------|-----------------|
| `wantsBooking` | ✅ KEEP | ✅ WIRED | None |
| `directIntentPatterns` | ✅ KEEP | ✅ WIRED | None |
| `describingProblem` | ⚠️ KEEP | ❌ **BROKEN** | **Trigger triage on match** |
| `trustConcern` | ⚠️ KEEP | ❌ **BROKEN** | **Add empathy layer** |
| `callerFeelsIgnored` | ⚠️ KEEP | ❌ **BROKEN** | **Add empathy layer** |
| `refusedSlot` | ⚠️ KEEP | ❌ **BROKEN** | **Handle gracefully** |

**Priority:** Wire detection triggers to behavior changes

### Tabs 3, 4, 6, 7, 8, 9, 11, 12
| Tab | Wiring Status | Issues |
|-----|---------------|--------|
| Tab 3: Hours | ✅ WIRED | None |
| Tab 4: Vocabulary | ✅ WIRED | None |
| Tab 6: Booking Prompts | ✅ WIRED | Legacy path mixing (minor) |
| Tab 7: Global Settings | ✅ WIRED | None |
| Tab 8: Emotions | ⚠️ PARTIAL | No LLM prompt injection |
| Tab 9: Loops | ✅ WIRED | None |
| Tab 11: LLM-0 Controls | ⏳ UNKNOWN | Not audited |
| Tab 12: Test | ✅ WIRED | None |

---

## 🔧 IMMEDIATE FIX CHECKLIST

### 1. Add S4A Triage/Scenario Layer
**File:** `services/engine/FrontDeskCoreRuntime.js`  
**Location:** Between S3 (Slot Extraction) and S4 (Discovery Flow Runner)  
**Lines:** Insert at ~line 650

**Code to add:**
- Check `discoveryConsent.disableScenarioAutoResponses`
- Check `discoveryConsent.autoReplyAllowedScenarioTypes`
- Call `TriageEngine.match()` if enabled
- Emit `SECTION_S4A_TRIAGE_CHECK` event (always)
- Emit `SECTION_S4B_DISCOVERY_OWNER_SELECTED` event (always)
- If triage match → use scenario reply
- If no match → fall through to DiscoveryFlowRunner

### 2. Add Pending Slot Buffer
**File:** `services/engine/StateStore.js`  
**Change:** Add `pendingSlots` object separate from `confirmedSlots`

**Logic:**
- S3 extraction → store in `state.pendingSlots`
- Discovery uses pending slots for context
- Booking confirms pending slots → move to `state.confirmedSlots`

### 3. Wire Detection Triggers to Behaviors
**File:** `services/engine/FrontDeskCoreRuntime.js`

**Mappings:**
- `describingProblem` → Activate triage mode
- `trustConcern` → Inject empathy layer
- `callerFeelsIgnored` → Add acknowledgment
- `refusedSlot` → Handle gracefully (don't loop)

### 4. Add Raw Event Proof
**Events to add:**
- `SECTION_S4A_TRIAGE_CHECK`
- `SECTION_S4B_DISCOVERY_OWNER_SELECTED`
- `SECTION_S3_PENDING_SLOTS_STORED`
- `SECTION_S6_PENDING_SLOTS_CONFIRMED`

### 5. Update Front Desk UI Labels
**File:** `public/js/ai-agent-settings/FrontDeskBehaviorManager.js`

**Changes:**
- Tab 2: Add warning if `disableScenarioAutoResponses: true` with visual indicator
- Tab 10: Show which detection triggers are actually wired vs cosmetic
- Add "Wiring Status" badge next to each setting (✅ WIRED, ❌ BROKEN, ⏳ PARTIAL)

---

## 🎯 CORRECT RUNTIME OWNER SELECTION ORDER

### Proposed S4 Section (Discovery Owner Selection)

```
S3: Slot Extraction
  ↓
S4A: Triage/Scenario Check
  ├─ IF disableScenarioAutoResponses = false
  │  AND autoReplyAllowedTypes has items
  │  AND describingProblem detected OR call_reason_detail extracted
  │  ├─ Attempt scenario match
  │  ├─ IF score >= triage.minConfidence
  │  │  └─ OWNER = TRIAGE (emit scenario reply)
  │  └─ ELSE
  │     └─ Fall through to S4B
  └─ ELSE
     └─ Fall through to S4B (emit reason: DISABLED)
  ↓
S4B: Discovery Flow Runner
  ├─ IF S4A didn't produce reply
  │  └─ OWNER = DISCOVERY_FLOW
  └─ Ask next discovery step
  ↓
S5: Consent Gate
  ↓
S6: Booking Flow
```

**EMIT PROOF AT EVERY DECISION POINT.**

---

## 🔍 EXISTING CONFIG ANALYSIS

### Your Current Config (Inferred from User Statement)

```json
{
  "discoveryConsent": {
    "bookingRequiresExplicitConsent": true,
    "forceLLMDiscovery": true,
    "disableScenarioAutoResponses": true,  // ❌ KILLING SCENARIOS
    "autoReplyAllowedScenarioTypes": [      // ⚠️ IGNORED
      "FAQ",
      "TROUBLESHOOT",
      "EMERGENCY"
    ]
  }
}
```

**The problem:** `disableScenarioAutoResponses: true` **nukes the entire triage layer**, even though you specified allowed types.

**The fix:**
```json
{
  "discoveryConsent": {
    "bookingRequiresExplicitConsent": true,
    "forceLLMDiscovery": false,  // ✅ Allow scenarios
    "disableScenarioAutoResponses": false,  // ✅ ENABLE SCENARIOS
    "autoReplyAllowedScenarioTypes": [
      "FAQ",
      "TROUBLESHOOT",
      "EMERGENCY"
    ]
  }
}
```

**But even with this change, it won't work until runtime checks the flags.**

---

## 📈 SUCCESS METRICS

### Before Fix (Current State)
- `matchSource: "DISCOVERY_FLOW_RUNNER"` = **100%** of turns
- `matchSource: "TRIAGE_SCENARIO"` = **0%** of turns
- `SECTION_S4A_TRIAGE_CHECK` events = **0** (doesn't exist)
- Caller satisfaction = **Low** (feels interrogated)

### After Fix (Target State)
- `matchSource: "TRIAGE_SCENARIO"` = **60-70%** of turns (when call reason known)
- `matchSource: "DISCOVERY_FLOW_RUNNER"` = **30-40%** of turns (when no match)
- `SECTION_S4A_TRIAGE_CHECK` events = **100%** of turns (proof of attempt)
- Caller satisfaction = **High** (feels heard, gets help)

---

## 🚀 NEXT STEPS

1. **Implement S4A Triage Layer** (services/engine/FrontDeskCoreRuntime.js)
2. **Add Pending Slot Buffer** (services/engine/StateStore.js)
3. **Wire Detection Triggers** (services/engine/FrontDeskCoreRuntime.js)
4. **Add Raw Event Proof** (4 new event types)
5. **Update UI Wiring Badges** (FrontDeskBehaviorManager.js)
6. **Test Mrs. Johnson Scenario** (validation)
7. **Update Documentation** (DISCOVERY_FLOW_DEEP_DIVE.md)

---

**CONCLUSION:**

The audit was correct that config **saves** to the database. But it missed that runtime **ignores** critical flags:
- `disableScenarioAutoResponses`
- `autoReplyAllowedScenarioTypes`
- `triage.enabled`
- `detectionTriggers.describingProblem`
- `detectionTriggers.trustConcern`
- `detectionTriggers.callerFeelsIgnored`
- `detectionTriggers.refusedSlot`

**You have a Ferrari in the garage (config), but the engine (runtime) is only using 1st gear (DiscoveryFlowRunner).**

The fix is clear: **Add S4A Triage/Scenario layer with proof events.**

---

**END OF WIRING GAP ANALYSIS**

*Generated: February 16, 2026*  
*Severity: CRITICAL*  
*Impact: 100% of discovery turns bypass triage/scenarios*
