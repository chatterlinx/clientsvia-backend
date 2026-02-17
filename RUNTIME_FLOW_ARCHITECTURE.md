# 🏗️ RUNTIME FLOW ARCHITECTURE - CURRENT vs TARGET

**Visual diagrams showing execution flow before and after S4A implementation**

---

## 📊 CURRENT RUNTIME FLOW (BROKEN)

```
┌────────────────────────────────────────────────────────────────┐
│ CALL ARRIVES                                                  │
│ Caller: "This is Mrs. Johnson, 123 Market St — AC is down"   │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ S1: RUNTIME OWNERSHIP                                         │
│ ├─ Set lane = DISCOVERY                                      │
│ └─ Event: SECTION_S1_RUNTIME_OWNER                           │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ S1.5: CONNECTION QUALITY GATE (V111)                          │
│ ├─ Check STT confidence: 0.94 ✅                              │
│ ├─ Check trouble phrases: No match ✅                         │
│ └─ Event: SECTION_S1_5_CONNECTION_QUALITY_GATE               │
│    Result: PASS (not a connection issue)                      │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ S2: INPUT TEXT TRUTH                                          │
│ └─ Event: INPUT_TEXT_SELECTED                                │
│    Text: "This is Mrs. Johnson, 123 Market St — AC is down"  │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ S2.5: ESCALATION DETECTION                                    │
│ ├─ Check trigger phrases: No match ✅                         │
│ └─ No event (nothing detected)                                │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ GREET: GREETING INTERCEPT                                     │
│ ├─ Check greetings list: No match ✅                          │
│ └─ No event (not a greeting)                                  │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ S3: SLOT EXTRACTION                                           │
│ ├─ Extract: name = "Johnson"                                 │
│ ├─ Extract: address = "123 Market St Fort Myers"             │
│ ├─ Extract: call_reason_detail = "AC is down"                │
│ └─ Event: SECTION_S3_SLOT_EXTRACTION                         │
│    Slots: ["name", "address", "call_reason_detail"]          │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
             ┌────────────────────────┐
             │ ❌ S4A: TRIAGE CHECK   │
             │ (MISSING - SKIPPED)    │
             └────────────────────────┘
                          │
                          ↓ (falls through immediately)
┌────────────────────────────────────────────────────────────────┐
│ S4: DISCOVERY FLOW RUNNER                                     │
│ ├─ Load discoveryFlow.steps                                  │
│ ├─ Find next unconfirmed slot: address                       │
│ ├─ Generate confirmation: "I have 12155 Metro Pkwy..."       │
│ └─ Event: SECTION_S4_DISCOVERY_ENGINE                        │
│    matchSource: "DISCOVERY_FLOW_RUNNER" ⚠️                    │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ OPENER ENGINE                                                 │
│ ├─ Select opener: "Alright."                                 │
│ └─ Prepend to response                                        │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ RESPONSE TO CALLER                                            │
│ "Alright. I have 12155 Metro Parkway. Is that correct?"      │
│                                                                │
│ ❌ PROBLEM: Caller feels interrogated, not helped             │
│ ❌ PROBLEM: No triage reassurance                             │
│ ❌ PROBLEM: No scenario answer                                │
└────────────────────────────────────────────────────────────────┘
```

**Raw Events Logged:**
1. `SECTION_S1_RUNTIME_OWNER` (lane: DISCOVERY)
2. `SECTION_S1_5_CONNECTION_QUALITY_GATE` (result: PASS)
3. `INPUT_TEXT_SELECTED` (text: "...")
4. `SECTION_S3_SLOT_EXTRACTION` (slots: ["name", "address", "call_reason_detail"])
5. `SECTION_S4_DISCOVERY_ENGINE` (matchSource: "DISCOVERY_FLOW_RUNNER")
6. `SECTION_OPENER_ENGINE` (opener: "Alright.")

**Missing Events:**
- ❌ `SECTION_S4A_TRIAGE_CHECK` (doesn't exist)
- ❌ `SECTION_S4B_DISCOVERY_OWNER_SELECTED` (doesn't exist)

**matchSource:** Always `"DISCOVERY_FLOW_RUNNER"` (100%)

---

## 🎯 TARGET RUNTIME FLOW (AFTER FIX)

```
┌────────────────────────────────────────────────────────────────┐
│ CALL ARRIVES                                                  │
│ Caller: "This is Mrs. Johnson, 123 Market St — AC is down"   │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ S1: RUNTIME OWNERSHIP                                         │
│ ├─ Set lane = DISCOVERY                                      │
│ └─ Event: SECTION_S1_RUNTIME_OWNER                           │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ S1.5: CONNECTION QUALITY GATE                                 │
│ ├─ Check STT confidence: 0.94 ✅                              │
│ └─ Event: SECTION_S1_5_CONNECTION_QUALITY_GATE               │
│    Result: PASS                                                │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ S2: INPUT TEXT TRUTH                                          │
│ └─ Event: INPUT_TEXT_SELECTED                                │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ S2.5: ESCALATION DETECTION                                    │
│ └─ No match ✅                                                │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ GREET: GREETING INTERCEPT                                     │
│ └─ No match ✅                                                │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ S3: SLOT EXTRACTION                                           │
│ ├─ Extract: name = "Johnson"                                 │
│ ├─ Extract: address = "123 Market St Fort Myers"             │
│ ├─ Extract: call_reason_detail = "AC is down"                │
│ ├─ Store as PENDING (not confirmed yet)                      │
│ └─ Event: SECTION_S3_SLOT_EXTRACTION                         │
│    Event: SECTION_S3_PENDING_SLOTS_STORED ✅ NEW             │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ S3.5: DETECTION TRIGGER PROCESSING ✅ NEW                     │
│ ├─ Check describingProblem: "AC is down" matches ✅          │
│ ├─ Activate triage mode                                      │
│ └─ Event: SECTION_S3_5_DESCRIBING_PROBLEM_DETECTED ✅ NEW    │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ S4A: TRIAGE/SCENARIO CHECK ✅ NEW LAYER                       │
│ ├─ Read config: disableScenarioAutoResponses = false ✅      │
│ ├─ Read config: autoReplyAllowedTypes = ["FAQ",              │
│ │                "TROUBLESHOOT", "EMERGENCY"] ✅              │
│ ├─ Read config: triage.enabled = true ✅                     │
│ ├─ Read config: triage.minConfidence = 0.62 ✅               │
│ ├─ Attempt scenario match:                                   │
│ │   └─ Input: "AC is down"                                   │
│ │   └─ Match: "ac_not_cooling_v2" (TROUBLESHOOT)             │
│ │   └─ Score: 0.89 ✅ (above 0.62 threshold)                 │
│ │   └─ Type: TROUBLESHOOT ✅ (in allowed types)              │
│ ├─ TRIAGE MATCHED ✅                                          │
│ └─ Event: SECTION_S4A_TRIAGE_CHECK ✅ NEW                    │
│    {                                                           │
│      "attempted": true,                                        │
│      "disableScenarioAutoResponses": false,                   │
│      "autoReplyAllowedTypes": ["FAQ","TROUBLESHOOT",...],     │
│      "topScenarioId": "ac_not_cooling_v2",                    │
│      "topScenarioScore": 0.89,                                │
│      "topScenarioType": "TROUBLESHOOT",                       │
│      "selected": true,                                         │
│      "reason": "SCORE_ABOVE_THRESHOLD_AND_TYPE_ALLOWED"       │
│    }                                                           │
│ └─ Event: SECTION_S4B_DISCOVERY_OWNER_SELECTED ✅ NEW        │
│    { "owner": "TRIAGE", "scenarioId": "ac_not_cooling_v2" }  │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ TRIAGE RESPONSE GENERATED                                     │
│ ├─ Use scenario reply template                               │
│ ├─ Inject pending slots: {name: "Johnson", address: "..."}   │
│ └─ Response: "Got it, Mrs. Johnson — AC down at 123 Market   │
│    St in Fort Myers. Quick question: is the system           │
│    completely not turning on, or is it running but not        │
│    cooling?"                                                   │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
             ┌────────────────────────┐
             │ S4: DISCOVERY FLOW     │
             │ (SKIPPED - triage      │
             │  provided reply)       │
             └────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ OPENER ENGINE                                                 │
│ ├─ Select opener: "Alright."                                 │
│ └─ Prepend to response                                        │
└────────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────┐
│ RESPONSE TO CALLER                                            │
│ "Alright. Got it, Mrs. Johnson — AC down at 123 Market St    │
│  in Fort Myers. Quick question: is the system completely not  │
│  turning on, or is it running but not cooling?"               │
│                                                                │
│ ✅ SUCCESS: Caller feels heard                                │
│ ✅ SUCCESS: Triage question asked                             │
│ ✅ SUCCESS: Pending slots used for context                    │
└────────────────────────────────────────────────────────────────┘
```

**Raw Events Logged:**
1. `SECTION_S1_RUNTIME_OWNER` (lane: DISCOVERY)
2. `SECTION_S1_5_CONNECTION_QUALITY_GATE` (result: PASS)
3. `INPUT_TEXT_SELECTED` (text: "...")
4. `SECTION_S3_SLOT_EXTRACTION` (slots: ["name", "address", "call_reason_detail"])
5. **`SECTION_S3_PENDING_SLOTS_STORED`** ✅ NEW (confirmedStatus: "PENDING")
6. **`SECTION_S3_5_DESCRIBING_PROBLEM_DETECTED`** ✅ NEW (trigger: "AC is down")
7. **`SECTION_S4A_TRIAGE_CHECK`** ✅ NEW (selected: true, score: 0.89)
8. **`SECTION_S4B_DISCOVERY_OWNER_SELECTED`** ✅ NEW (owner: "TRIAGE")
9. `SECTION_OPENER_ENGINE` (opener: "Alright.")

**matchSource:** `"TRIAGE_SCENARIO"` ✅

---

## 🔄 MULTI-TURN FLOW - CURRENT vs TARGET

### TURN 1: Initial Call

#### Current (Broken)
```
Caller: "AC is down"
  ↓
S3: Extract call_reason_detail = "AC is down"
  ↓
S4A: ❌ MISSING
  ↓
S4: DiscoveryFlowRunner
  └─ "What's your name?"
  
matchSource: "DISCOVERY_FLOW_RUNNER"
Caller feels: ❌ Interrogated
```

#### Target (Fixed)
```
Caller: "AC is down"
  ↓
S3: Extract call_reason_detail = "AC is down"
  ↓
S4A: Triage Check
  ├─ Match: "ac_not_cooling_v2" (score: 0.89)
  └─ Reply: "Got it — AC down. Is it not turning on, or running but not cooling?"
  
matchSource: "TRIAGE_SCENARIO"
Caller feels: ✅ Heard and helped
```

### TURN 2: Triage Response

#### Current (Broken)
```
Caller: "Mark Johnson, 123 Market St"
  ↓
S3: Extract name = "Mark", lastName = "Johnson", address confirmed
  ↓
S4A: ❌ MISSING
  ↓
S4: DiscoveryFlowRunner
  └─ "I have 12155 Metro Parkway. Is that correct?"
  
matchSource: "DISCOVERY_FLOW_RUNNER"
Caller feels: ❌ Confused (wrong address?)
```

#### Target (Fixed)
```
Caller: "It's running but not blowing cold air"
  ↓
S3: Extract triage answer
  ↓
S4A: Triage Check
  ├─ Match: "ac_running_not_cooling" (score: 0.91)
  └─ Reply: "Got it — system's running but not cooling. That's likely a refrigerant or compressor issue. Would you like me to schedule a technician?"
  
matchSource: "TRIAGE_SCENARIO"
Caller feels: ✅ Helped, ready to book
```

### TURN 3: Consent + Booking

#### Current (Broken)
```
Caller: "Yes, schedule someone"
  ↓
S5: Consent Gate
  ├─ Detect directIntentPatterns: "schedule someone" ✅
  └─ Bypass consent, go to booking
  ↓
S6: BookingFlowRunner
  └─ "What's your name?" (again!)
  
matchSource: "BOOKING_FLOW_RUNNER"
Caller feels: ❌ Frustrated (already gave name!)
```

#### Target (Fixed)
```
Caller: "Yes, schedule someone"
  ↓
S5: Consent Gate
  ├─ Detect directIntentPatterns: "schedule someone" ✅
  └─ Bypass consent, go to booking
  ↓
S6: BookingFlowRunner
  ├─ Check pendingSlots: name, address already captured ✅
  └─ "Perfect — just confirming: first name is? Last name Johnson? Address 123 Market St?"
  
matchSource: "BOOKING_FLOW_RUNNER"
Caller feels: ✅ Efficient (only confirms, doesn't re-ask)
```

---

## 🗺️ OWNER SELECTION DECISION TREE (TARGET)

```
                    ┌─────────────────┐
                    │  Call Turn In   │
                    └────────┬────────┘
                             │
                             ↓
                ┌────────────────────────┐
                │ Is lane = BOOKING?     │
                └────────┬───────────┬───┘
                        YES          NO
                         │            │
                         ↓            ↓
            ┌──────────────────┐  ┌──────────────────────────┐
            │ S6: BOOKING FLOW │  │ Is Connection Quality    │
            │ (skip S4A/S4)    │  │ issue detected?          │
            └──────────────────┘  └─────┬────────────────┬───┘
                                       YES              NO
                                        │                │
                                        ↓                ↓
                            ┌────────────────────┐  ┌────────────────────┐
                            │ Connection Quality │  │ Is greeting?       │
                            │ Recovery (DTMF)    │  │ ("good morning")   │
                            └────────────────────┘  └───┬────────────┬───┘
                                                       YES          NO
                                                        │            │
                                                        ↓            ↓
                                        ┌──────────────────────┐  ┌────────────────┐
                                        │ Greeting Intercept   │  │ S3: Extract    │
                                        │ (instant 0-token)    │  │ Slots          │
                                        └──────────────────────┘  └────────┬───────┘
                                                                           │
                                                                           ↓
                                                        ┌──────────────────────────────┐
                                                        │ S4A: TRIAGE/SCENARIO CHECK   │
                                                        │ ✅ NEW LAYER                 │
                                                        └─────┬────────────────────┬───┘
                                                             │                    │
                                    ┌────────────────────────┤                    │
                                    │                        │                    │
                                    ↓                        ↓                    ↓
                        ┌────────────────────┐   ┌──────────────────┐   ┌──────────────────┐
                        │ Config Check:      │   │ Config Check:    │   │ Config Check:    │
                        │ disableScenario    │   │ triage.enabled   │   │ hasCallReason    │
                        │ AutoResponses?     │   │ = true?          │   │ OR describing    │
                        └─────┬──────────────┘   └─────┬────────────┘   │ Problem?         │
                             │                        │                └─────┬────────────┘
                             ↓                        ↓                      │
                        ┌────────┐              ┌────────┐                  │
                        │ = true │              │ = true │                  ↓
                        └────┬───┘              └────┬───┘              ┌────────┐
                             │                       │                  │ = true │
                             ↓                       ↓                  └────┬───┘
                        ┌─────────────────────────────────┐                 │
                        │ SKIP TRIAGE                     │                 │
                        │ Event: S4A_TRIAGE_CHECK         │◄────────────────┘
                        │   attempted: false               │     (ALL must be true)
                        │   reason: "DISABLED_BY_CONFIG"  │
                        └─────────┬───────────────────────┘
                                  │
                                  ↓
                        ┌─────────────────────┐
                        │ S4B: OWNER = FLOW   │
                        │ Fall through to     │
                        │ DiscoveryFlowRunner │
                        └─────────────────────┘
                        
                             OR
                             
                        ┌─────────────────────────────────┐
                        │ ATTEMPT SCENARIO MATCH          │
                        │ ├─ Match scenarios              │
                        │ ├─ Score vs minConfidence       │
                        │ └─ Type in allowedTypes?        │
                        └─────────┬───────────────────────┘
                                  │
                        ┌─────────┴─────────┐
                       YES                 NO
                        │                   │
                        ↓                   ↓
        ┌───────────────────────┐  ┌──────────────────────┐
        │ S4B: OWNER = TRIAGE   │  │ S4B: OWNER = FLOW    │
        │ Use scenario response │  │ Fall through to      │
        │ Event: matched ✅     │  │ DiscoveryFlowRunner  │
        └───────────────────────┘  └──────────────────────┘
```

---

## 📊 CONFIG FLAG → RUNTIME DECISION MAP

| Flag | Current Runtime Behavior | Target Runtime Behavior |
|------|-------------------------|-------------------------|
| `disableScenarioAutoResponses: true` | ❌ **Ignored** - triage never runs | ✅ **Checked** - triage skipped, event logged |
| `disableScenarioAutoResponses: false` | ❌ **Ignored** - triage never runs | ✅ **Checked** - triage attempted |
| `autoReplyAllowedScenarioTypes: []` | ❌ **Ignored** - never read | ✅ **Checked** - triage skipped if empty |
| `autoReplyAllowedScenarioTypes: ["FAQ"]` | ❌ **Ignored** - never read | ✅ **Checked** - only FAQ scenarios allowed |
| `triage.enabled: false` | ❌ **Ignored** - never read | ✅ **Checked** - triage skipped |
| `triage.enabled: true` | ❌ **Ignored** - never read | ✅ **Checked** - triage attempted |
| `triage.minConfidence: 0.62` | ❌ **Ignored** - never read | ✅ **Checked** - score cutoff |
| `detectionTriggers.describingProblem` | ❌ **Ignored** - never read | ✅ **Checked** - activates triage mode |

---

## 🎯 EVENT PROOF REQUIREMENTS

### Every Turn Must Emit (Target State)

**S4A Event (ALWAYS):**
```json
{
  "type": "SECTION_S4A_TRIAGE_CHECK",
  "data": {
    "attempted": true | false,
    "disableScenarioAutoResponses": true | false,
    "autoReplyAllowedTypes": ["FAQ", "TROUBLESHOOT", "EMERGENCY"],
    "minConfidence": 0.62,
    "topScenarioId": "ac_not_cooling_v2" | null,
    "topScenarioScore": 0.89 | 0,
    "topScenarioType": "TROUBLESHOOT" | null,
    "scoreAboveThreshold": true | false,
    "typeAllowed": true | false,
    "selected": true | false,
    "reason": "SCORE_ABOVE_THRESHOLD_AND_TYPE_ALLOWED" 
           | "SCORE_TOO_LOW" 
           | "TYPE_NOT_ALLOWED" 
           | "DISABLED_BY_CONFIG_disableScenarioAutoResponses"
           | "NO_ALLOWED_TYPES"
  }
}
```

**S4B Event (ALWAYS):**
```json
{
  "type": "SECTION_S4B_DISCOVERY_OWNER_SELECTED",
  "data": {
    "owner": "TRIAGE" | "DISCOVERY_FLOW",
    "scenarioId": "ac_not_cooling_v2" | null,
    "scenarioType": "TROUBLESHOOT" | null,
    "score": 0.89 | null,
    "reason": "TRIAGE_SCORE_ABOVE_THRESHOLD_AND_TYPE_ALLOWED"
           | "TRIAGE_SCORE_TOO_LOW"
           | "TRIAGE_TYPE_NOT_ALLOWED"
           | "TRIAGE_DISABLED_BY_CONFIG_disableScenarioAutoResponses"
           | "TRIAGE_NO_ALLOWED_TYPES"
  }
}
```

**These events are NON-NEGOTIABLE. If they don't exist, runtime is not wired.**

---

## 🔍 VALIDATION QUERIES

### After Implementation, Run These Queries

**1. Check if S4A events exist:**
```javascript
db.rawEvents.countDocuments({
  type: "SECTION_S4A_TRIAGE_CHECK"
})

// Should return: > 0 (if implemented)
// Currently returns: 0 (doesn't exist)
```

**2. Check owner selection distribution:**
```javascript
db.rawEvents.aggregate([
  { $match: { type: "SECTION_S4B_DISCOVERY_OWNER_SELECTED" } },
  { $group: { 
      _id: "$data.owner", 
      count: { $sum: 1 } 
  }}
])

// Target result:
// { _id: "TRIAGE", count: 650 }       (65%)
// { _id: "DISCOVERY_FLOW", count: 350 } (35%)

// Current result:
// No documents (event doesn't exist)
```

**3. Check matchSource distribution:**
```javascript
db.rawEvents.aggregate([
  { $match: { 
      type: "CORE_RUNTIME_OWNER_RESULT",
      "data.matchSource": { $exists: true }
  }},
  { $group: { 
      _id: "$data.matchSource", 
      count: { $sum: 1 } 
  }}
])

// Target result:
// { _id: "TRIAGE_SCENARIO", count: 650 }       (65%)
// { _id: "DISCOVERY_FLOW_RUNNER", count: 350 } (35%)

// Current result:
// { _id: "DISCOVERY_FLOW_RUNNER", count: 1000 } (100%)
```

**4. Verify triage config is being read:**
```javascript
db.rawEvents.findOne({
  type: "SECTION_S4A_TRIAGE_CHECK",
  "data.attempted": true
})

// Target: Should find documents
// Current: Returns null (doesn't exist)
```

---

## 🎭 EXAMPLE SCENARIOS - BEFORE & AFTER

### Scenario A: AC Not Cooling

**Before (Current):**
```
Turn 1:
  Caller: "AC not cooling"
  System: "What's your name?"
  matchSource: DISCOVERY_FLOW_RUNNER ❌
  
Turn 2:
  Caller: "Mark Johnson"
  System: "I have Mark. Is that correct?"
  matchSource: DISCOVERY_FLOW_RUNNER ❌
  
Turn 3:
  Caller: "Yes"
  System: "What's the address?"
  matchSource: DISCOVERY_FLOW_RUNNER ❌
  
Caller feels: ❌ Interrogated, not helped
```

**After (Target):**
```
Turn 1:
  Caller: "AC not cooling"
  System: "Got it — AC not cooling. Is it not turning on, or running but not cooling?"
  matchSource: TRIAGE_SCENARIO ✅
  Events: [S4A_TRIAGE_CHECK (selected: true), S4B_OWNER (TRIAGE)]
  
Turn 2:
  Caller: "Running but not cold"
  System: "That's likely a refrigerant or compressor issue. Would you like me to schedule a tech?"
  matchSource: TRIAGE_SCENARIO ✅
  Events: [S4A_TRIAGE_CHECK (selected: true), S4B_OWNER (TRIAGE)]
  
Turn 3:
  Caller: "Yes please"
  System: "Perfect. What's your first and last name?"
  matchSource: BOOKING_FLOW_RUNNER ✅
  lane: BOOKING
  
Caller feels: ✅ Helped first, booking feels natural
```

### Scenario B: Mrs. Johnson (Full Info Upfront)

**Before (Current):**
```
Turn 1:
  Caller: "This is Mrs. Johnson, 123 Market St Fort Myers — AC is down"
  System: "I have 12155 Metro Parkway. Is that correct?"
  matchSource: DISCOVERY_FLOW_RUNNER ❌
  pendingSlots: {} (not using extracted slots for context!)
  
Caller feels: ❌ Not listening, wrong address
```

**After (Target):**
```
Turn 1:
  Caller: "This is Mrs. Johnson, 123 Market St Fort Myers — AC is down"
  System: "Got it, Mrs. Johnson — AC down at 123 Market St in Fort Myers. Quick question: is it not turning on, or running but not cooling?"
  matchSource: TRIAGE_SCENARIO ✅
  pendingSlots: { name: "Johnson", address: "123 Market St Fort Myers", call_reason: "AC is down" }
  Events: [S3_PENDING_SLOTS_STORED, S4A_TRIAGE_CHECK (selected: true)]
  
Caller feels: ✅ Heard, understood, helped
```

---

## 🚀 IMPLEMENTATION CHECKPOINTS

### Checkpoint 1: Config Fix
- [ ] `disableScenarioAutoResponses: false`
- [ ] `autoReplyAllowedScenarioTypes` has values
- [ ] Save config
- **Test:** Query database, verify values saved
- **Result:** Config ready, but runtime still broken

### Checkpoint 2: S4A Triage Layer
- [ ] Create `TriageScenarioMatcher.js`
- [ ] Insert S4A code in `FrontDeskCoreRuntime.js`
- [ ] Add `TriageScenarioMatcher` import
- **Test:** Make call, check raw events for `SECTION_S4A_TRIAGE_CHECK`
- **Result:** Triage attempted, owner selection logged

### Checkpoint 3: Pending Slot Buffer
- [ ] Modify `StateStore.js` (add pendingSlots)
- [ ] Modify `SlotExtractor.js` (store as pending)
- [ ] Modify `DiscoveryFlowRunner.js` (skip pending confirmations)
- **Test:** Make call with upfront info, verify slots stored as pending
- **Result:** Context-aware responses, no re-asking

### Checkpoint 4: Detection Trigger Wiring
- [ ] Wire `describingProblem` → activate triage
- [ ] Wire `trustConcern` → empathy mode
- [ ] Wire `callerFeelsIgnored` → acknowledgment
- [ ] Wire `refusedSlot` → graceful handling
- **Test:** Make calls with each trigger phrase
- **Result:** Adaptive behavior based on caller patterns

### Checkpoint 5: Validation
- [ ] Run validation queries (see above)
- [ ] Verify matchSource distribution: 60-70% TRIAGE, 30-40% DISCOVERY_FLOW
- [ ] Verify all events logged
- **Result:** System behaves as configured

---

## 📋 FINAL CHECKLIST

Before marking "wiring complete," verify:

- [ ] Every config flag in Front Desk has corresponding runtime check
- [ ] Every turn emits `SECTION_S4A_TRIAGE_CHECK` (proof of attempt)
- [ ] Every turn emits `SECTION_S4B_DISCOVERY_OWNER_SELECTED` (proof of decision)
- [ ] `matchSource: "TRIAGE_SCENARIO"` appears 60-70% of turns
- [ ] `matchSource: "DISCOVERY_FLOW_RUNNER"` appears 30-40% of turns (fallback only)
- [ ] Pending slots stored during discovery, confirmed during booking
- [ ] Mrs. Johnson scenario works correctly (caller feels heard)
- [ ] Raw events queryable for debugging
- [ ] No config flags ignored by runtime

**If all checked:** ✅ WIRING COMPLETE

**If any unchecked:** ⚠️ WIRING INCOMPLETE

---

**END OF RUNTIME FLOW ARCHITECTURE**

*Use this document to validate implementation.*  
*All events must exist, all flags must be checked.*
