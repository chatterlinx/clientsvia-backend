# RUNTIME SPECIFICATION V116 - WITH S4A TRIAGE+SCENARIO PIPELINE

**Version:** V116 (Hybrid S4A)  
**Replaces:** V115 (TRIAGE-NUKE)  
**Status:** CANONICAL TRUTH  
**Date:** February 16, 2026

**This is the SINGLE SOURCE OF TRUTH for V116 runtime behavior.**

---

## 🎯 EXECUTION ORDER (Every Turn)

```
┌─────────────────────────────────────────────────────────────────┐
│ S0: STATE LOAD                                                  │
│ Load persisted state from Redis/session                        │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ S1: RUNTIME OWNERSHIP                                           │
│ Set lane (DISCOVERY or BOOKING)                                │
│ Event: SECTION_S1_RUNTIME_OWNER                                │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ S1.5: CONNECTION QUALITY GATE                                   │
│ Check STT confidence + "hello?" patterns (turns 1-2 only)       │
│ Event: SECTION_S1_5_CONNECTION_QUALITY_GATE                    │
│ IF trouble → re-greet or DTMF escape                           │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ S2: INPUT TEXT TRUTH                                            │
│ Log raw text received                                           │
│ Event: INPUT_TEXT_SELECTED                                      │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ S2.5: ESCALATION DETECTION                                      │
│ Check for "speak to manager" patterns                           │
│ IF escalation → transfer immediately                            │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ GREET: GREETING INTERCEPT                                       │
│ Check for "good morning" patterns (0-token instant response)    │
│ IF greeting → return instant response (no further processing)   │
│ Event: GREETING_INTERCEPTED                                     │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ S3: SLOT EXTRACTION                                             │
│ Extract: name, phone, address, call_reason (if volunteered)     │
│ Store: PENDING (not confirmed)                                  │
│ Event: SECTION_S3_SLOT_EXTRACTION                              │
│ Event: SECTION_S3_PENDING_SLOTS_STORED                         │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ S3.5: DETECTION TRIGGER PROCESSING (V116)                       │
│ Check: describingProblem, trustConcern, callerFeelsIgnored,     │
│        refusedSlot                                               │
│ Set: Behavior flags (empathyMode, slotRefusalDetected, etc.)    │
│ Events: SECTION_S3_5_* per trigger type                         │
└─────────────────────────────────────────────────────────────────┘
                          ↓
        ┌───────────────────────────────────────┐
        │   IF lane === 'DISCOVERY'            │
        └───────────────┬───────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────────┐
│ S4A-1: TRIAGE SIGNALS (V116 NEW)                                │
│ Call: TriageEngineRouter.runTriage(userInput, {...})            │
│ Returns: { intentGuess, confidence, callReasonDetail, urgency } │
│ Store: call_reason_detail slot immediately                      │
│ Event: SECTION_S4A_1_TRIAGE_SIGNALS                            │
│ Duration: ~30ms                                                  │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ S4A-2: SCENARIO MATCHING (V116 NEW)                             │
│ Check: disableScenarioAutoResponses === false?                  │
│ Check: autoReplyAllowedScenarioTypes has values?                │
│ Check: triageResult.confidence >= minConfidence?                │
│ IF all true:                                                     │
│   Call: ScenarioEngine.selectResponse(userInput, {              │
│     session: { signals: { triageIntent, callReason, urgency }}, │
│     options: { allowTier3: false, maxCandidates: 3 }            │
│   })                                                             │
│   Validate: confidence >= minConfidence?                         │
│   Validate: scenario.type in autoReplyAllowedTypes?             │
│   IF both true → MATCH                                           │
│ Event: SECTION_S4A_2_SCENARIO_MATCH                            │
│ Duration: ~50-100ms (Tier 1/2 only)                             │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ S4B: OWNER DECISION (V116 NEW)                                  │
│ IF S4A-2 matched:                                                │
│   owner = 'TRIAGE_SCENARIO_PIPELINE'                            │
│   response = scenario.quickReply or scenario.fullReply          │
│   SKIP S4 (DiscoveryFlowRunner)                                 │
│ ELSE:                                                            │
│   owner = 'DISCOVERY_FLOW'                                       │
│   CONTINUE to S4                                                 │
│ Event: SECTION_S4B_DISCOVERY_OWNER_SELECTED                    │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ S4: DISCOVERY FLOW RUNNER (V110 - FALLBACK)                     │
│ IF S4A produced response → SKIP THIS                            │
│ IF S4A no match → RUN THIS                                      │
│ Call: DiscoveryFlowRunner.run({ company, callSid, state })      │
│ Returns: Next discovery step question                           │
│ Event: SECTION_S4_DISCOVERY_ENGINE                             │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ S5: CONSENT GATE                                                 │
│ Detect booking intent (wantsBooking, directIntentPatterns)      │
│ Ask consent if required, bypass if direct intent                │
│ Event: SECTION_S5_CONSENT_GATE                                  │
└─────────────────────────────────────────────────────────────────┘
                          ↓
        ┌───────────────────────────────────────┐
        │   IF lane === 'BOOKING'              │
        └───────────────┬───────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────────┐
│ S6: BOOKING FLOW RUNNER (V110 - DETERMINISTIC)                  │
│ Collect/confirm booking slots                                   │
│ Use pending slots (confirm rather than re-ask)                  │
│ Event: SECTION_S6_BOOKING_FLOW                                  │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ OPENER ENGINE                                                    │
│ Prepend micro-acknowledgment ("Alright.", "I hear you.")        │
│ Event: SECTION_OPENER_ENGINE                                    │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ S0: STATE SAVE                                                   │
│ Persist to Redis + session                                      │
│ Event: SECTION_S0_STATE_SAVE                                    │
└─────────────────────────────────────────────────────────────────┘
                          ↓
                   RETURN RESPONSE
```

---

## 🔒 SPEAKER OWNERSHIP CONTRACT V116

**Authorized Speakers (6):**

| Module | When Can Speak | What It Says | Constraints |
|--------|----------------|--------------|-------------|
| **GreetingInterceptor** | Turn 1, greeting detected | Instant greeting response | 0-token, pattern match only |
| **S4A Pipeline** | Discovery lane, scenario matched | Reassurance + triage question | Confidence >= 0.62, type allowed, Tier 1/2 only |
| **DiscoveryFlowRunner** | Discovery lane, S4A no match | Discovery step question | Deterministic, UI-configured |
| **ConsentGate** | Discovery complete or intent detected | Consent question | UI-configured template |
| **BookingFlowRunner** | Booking lane | Booking slot questions | Deterministic, UI-configured |
| **OpenerEngine** | Any turn with response | Micro-acknowledgment prepend | Context-aware selection |

**Arbitration Rules:**
1. Only ONE module generates primary response per turn (no conflicts)
2. OpenerEngine may prepend to any primary response
3. Earlier speakers pre-empt later speakers (waterfall)
4. Fallback path always available (DiscoveryFlowRunner)

**Violations:**
- Multiple speakers generating primary response → SPEAKER_OWNER_COLLISION event
- Unauthorized module speaking → SPEAKER_CONTRACT_VIOLATION event

---

## 🎚️ CONFIGURATION GATES

### **Master Kill Switch:**
```javascript
company.aiAgentSettings.frontDeskBehavior.discoveryConsent.disableScenarioAutoResponses
```
- `true` → S4A skipped entirely (V115 behavior)
- `false` → S4A active (V116 behavior)

### **Feature Flag:**
```javascript
company.aiAgentSettings.frontDeskBehavior._experimentalS4A
```
- `false` → S4A disabled for this company
- `true` → S4A enabled for this company

### **Global Kill Switch:**
```javascript
adminSettings.globalKillSwitches.s4aTriageScenarioPipeline
```
- `true` → S4A disabled platform-wide (emergency)
- `false` → S4A follows per-company config

### **Execution Logic:**
```javascript
// Check flags in order (fastest to slowest)
if (adminSettings.globalKillSwitches.s4aTriageScenarioPipeline === true) {
    // Global kill - skip S4A
    return { attempted: false, reason: 'GLOBAL_KILL_SWITCH' };
}

if (company._experimentalS4A === false) {
    // Company feature flag - skip S4A
    return { attempted: false, reason: 'FEATURE_FLAG_DISABLED' };
}

if (dcConfig.disableScenarioAutoResponses === true) {
    // Master toggle - skip S4A
    return { attempted: false, reason: 'CONFIG_DISABLED' };
}

// All gates pass - attempt S4A
```

---

## 📊 STATE MANAGEMENT V116

### **State Structure:**

```javascript
state = {
    // Core state
    lane: 'DISCOVERY' | 'BOOKING',
    sessionMode: 'DISCOVERY' | 'BOOKING',  // Alias for lane
    turnCount: 0,
    
    // Slot storage (3-tier)
    plainSlots: { ... },        // Backward compatible (all slots)
    pendingSlots: { ... },      // NEW: Extracted, not confirmed
    confirmedSlots: { ... },    // NEW: Booking-confirmed
    
    // Slot metadata (NEW)
    _slotMeta: {
        name: {
            source: 'extracted' | 'caller_id' | 'triage' | 'booking',
            confirmedAt: ISO timestamp | null,
            confirmedInTurn: number | null,
            isPending: boolean
        }
    },
    
    // Discovery state
    discovery: {
        currentStepId: 'd0' | 'd1' | ...,
        currentSlotId: 'call_reason_detail' | 'name' | ...,
        pendingConfirmation: slotId | null,
        confirmedSlots: { slotId: true },
        repromptCount: { slotId: count }
    },
    
    // Booking state
    booking: {
        confirmedSlots: { slotId: true }
    },
    
    // Consent state
    consent: {
        pending: boolean,
        askedExplicitly: boolean,
        bypassedByDirectIntent: boolean
    },
    
    // Behavior flags (NEW)
    _empathyMode: 'trust_concern' | 'feels_ignored' | null,
    _slotRefusalDetected: boolean,
    _bookingIntentDetected: boolean
}
```

### **Slot Lifecycle:**

```
EXTRACTION (S3)
  ├─ Slot extracted from utterance
  ├─ Stored in: state.pendingSlots[slotId]
  ├─ Also copied to: state.plainSlots[slotId] (backward compat)
  └─ Metadata: { source: 'extracted', isPending: true }
       ↓
DISCOVERY USE (S4A/S4)
  ├─ Pending slots used for CONTEXT
  ├─ "Got it, Mrs. Johnson — AC down at 123 Market St"
  └─ NOT confirmed yet (don't ask "Is that correct?")
       ↓
BOOKING CONFIRMATION (S6)
  ├─ Pending slots CONFIRMED
  ├─ "Just confirming: first name? Last name Johnson? Address 123 Market St?"
  ├─ Moved to: state.confirmedSlots[slotId]
  └─ Metadata: { confirmedAt: timestamp, confirmedInTurn: 5 }
```

---

## 🔄 S4A PIPELINE SPECIFICATION

### **S4A-1: TRIAGE SIGNALS**

**Purpose:** Extract caller intent, call reason, and urgency

**Execution:**
```javascript
const triageConfig = company.aiAgentSettings.frontDeskBehavior.triage || {};
const triageEnabled = triageConfig.enabled !== false;

if (triageEnabled) {
    triageResult = await TriageEngineRouter.runTriage(userInput, {
        company, companyId, callSid, turnNumber: turn
    });
    
    // Store call_reason_detail immediately
    if (triageResult?.callReasonDetail) {
        state.pendingSlots.call_reason_detail = triageResult.callReasonDetail;
        state.plainSlots.call_reason_detail = triageResult.callReasonDetail;
        state._slotMeta.call_reason_detail = {
            source: 'triage',
            isPending: true,
            extractedInTurn: turn
        };
    }
}
```

**Output Contract:**
```javascript
{
    intentGuess: 'service_request' | 'pricing' | 'status' | 'complaint' | 'other',
    confidence: 0.0-1.0,
    callReasonDetail: string | null,
    matchedCardId: string | null,
    signals: { urgency: 'normal' | 'urgent' | 'emergency' }
}
```

**Event:**
```javascript
SECTION_S4A_1_TRIAGE_SIGNALS: {
    attempted: boolean,
    triageEnabled: boolean,
    intentGuess: string,
    confidence: number,
    callReasonDetail: string,
    urgency: string,
    durationMs: number
}
```

**Duration:** ~20-40ms (deterministic keyword matching)

---

### **S4A-2: SCENARIO MATCHING**

**Purpose:** Find scenario response using triage context

**Execution:**
```javascript
const dcConfig = company.aiAgentSettings.frontDeskBehavior.discoveryConsent || {};
const disableScenarioAutoResponses = dcConfig.disableScenarioAutoResponses === true;
const autoReplyAllowedTypes = dcConfig.autoReplyAllowedScenarioTypes || [];
const minConfidence = triageConfig.minConfidence || 0.62;

const shouldAttempt = !disableScenarioAutoResponses 
    && autoReplyAllowedTypes.length > 0
    && triageResult?.confidence >= minConfidence;

if (shouldAttempt) {
    scenarioResult = await ScenarioEngine.selectResponse({
        companyId,
        tradeKey: company.tradeKey || 'hvac',
        text: userInput,
        session: {
            sessionId: callSid,
            signals: {
                triageIntent: triageResult.intentGuess,
                callReason: triageResult.callReasonDetail,
                urgency: triageResult.signals.urgency,
                extractedSlots: state.pendingSlots
            }
        },
        options: {
            allowTier3: false,  // Only Tier 1/2 (fast)
            maxCandidates: 3
        }
    });
    
    // Validate match
    const matched = scenarioResult.selected
        && scenarioResult.confidence >= minConfidence
        && autoReplyAllowedTypes.includes(scenarioResult.scenario?.type);
}
```

**Output Contract:**
```javascript
{
    selected: boolean,
    tier: 'TIER_1' | 'TIER_2' | null,
    scenario: {
        scenarioId: string,
        title: string,
        type: 'FAQ' | 'TROUBLESHOOT' | 'EMERGENCY',
        quickReply: string,
        fullReply: string
    },
    confidence: 0.0-1.0,
    matchMeta: { ... }
}
```

**Event:**
```javascript
SECTION_S4A_2_SCENARIO_MATCH: {
    attempted: boolean,
    disableScenarioAutoResponses: boolean,
    autoReplyAllowedTypes: string[],
    scenarioId: string | null,
    scenarioType: string | null,
    tier: string | null,
    confidence: number,
    minConfidence: number,
    matched: boolean,
    typeAllowed: boolean,
    durationMs: number
}
```

**Duration:** ~50-100ms (Tier 1/2 matching)

---

### **S4B: OWNER DECISION**

**Purpose:** Emit proof of who responded and why

**Decision Logic:**
```javascript
if (scenarioResult?.matched && scenarioResult.confidence >= minConfidence 
    && autoReplyAllowedTypes.includes(scenarioResult.scenario.type)) {
    
    // S4A SPEAKS
    owner = 'TRIAGE_SCENARIO_PIPELINE';
    response = scenarioResult.scenario.quickReply || scenarioResult.scenario.fullReply;
    skipDiscoveryFlow = true;
    
} else {
    // DISCOVERY FLOW SPEAKS
    owner = 'DISCOVERY_FLOW';
    response = null;  // Will be generated by DiscoveryFlowRunner
    skipDiscoveryFlow = false;
}
```

**Event:**
```javascript
SECTION_S4B_DISCOVERY_OWNER_SELECTED: {
    owner: 'TRIAGE_SCENARIO_PIPELINE' | 'DISCOVERY_FLOW',
    scenarioId: string | null,
    triageIntent: string | null,
    urgency: string | null,
    reason: 'TRIAGE_AND_SCENARIO_MATCHED' | 'NO_TRIAGE_MATCH' | 'NO_SCENARIO_MATCH' 
           | 'SCORE_TOO_LOW' | 'TYPE_NOT_ALLOWED' | 'CONFIG_DISABLED'
}
```

---

## 🛡️ SAFETY INVARIANTS (Never Violate)

### **1. Never Block Booking**
- S4A must NOT prevent caller from reaching booking flow
- If scenario response is given, must still allow booking intent detection
- Consent gate always runs after S4A
- Invariant check: Every call with booking intent must reach booking lane

### **2. Never Hallucinate Actions**
- Scenarios must NOT say "dispatching now" unless actually dispatching
- Scenarios must NOT say "scheduled for tomorrow" unless actually scheduled
- Policy: Reassurance only (no action claims)

### **3. Never Make Commitments**
- No pricing guarantees ("only $99")
- No timing commitments ("within 2 hours")
- No service promises ("we definitely can fix that")
- Policy: Informational only

### **4. Never Leak PII**
- ScenarioEngine enforces tenant isolation
- Scenarios filtered by company.tradeKey
- No cross-tenant data in responses

### **5. Always Have Fallback**
- ScenarioEngine error → Fall through to DiscoveryFlowRunner
- TriageEngineRouter error → Fall through to DiscoveryFlowRunner
- Performance timeout → Fall through to DiscoveryFlowRunner
- NO scenario match → Fall through to DiscoveryFlowRunner

---

## ⚡ PERFORMANCE SLOs

### **Per-Section Budget:**

| Section | p50 | p95 | p99 | Hard Limit |
|---------|-----|-----|-----|------------|
| S1 (Ownership) | <5ms | <10ms | <20ms | 50ms |
| S1.5 (Connection) | <10ms | <20ms | <30ms | 100ms |
| S2 (Input Truth) | <5ms | <10ms | <20ms | 50ms |
| S3 (Extraction) | <20ms | <40ms | <60ms | 150ms |
| **S4A-1 (Triage)** | **<30ms** | **<50ms** | **<80ms** | **200ms** |
| **S4A-2 (Scenario)** | **<60ms** | **<100ms** | **<150ms** | **300ms** |
| S4 (Discovery) | <30ms | <50ms | <80ms | 200ms |
| S5 (Consent) | <20ms | <40ms | <60ms | 150ms |
| S6 (Booking) | <30ms | <50ms | <80ms | 200ms |
| OPEN (Opener) | <10ms | <20ms | <30ms | 100ms |
| **Total Turn** | **<300ms** | **<500ms** | **<1000ms** | **2000ms** |

**Circuit Breaker:**
- If S4A total (S4A-1 + S4A-2) > 500ms → emit warning, fall through
- If any section exceeds hard limit → emit alert

---

## 📋 EVENT TAXONOMY (Complete)

### **Required Events (Every Turn):**

**Core Events:**
- `SECTION_S1_RUNTIME_OWNER` - Lane selection
- `INPUT_TEXT_SELECTED` - Input logged
- `SECTION_S3_SLOT_EXTRACTION` - Slots extracted

**S4A Events (NEW):**
- `SECTION_S4A_1_TRIAGE_SIGNALS` - Triage attempted (always logged)
- `SECTION_S4A_2_SCENARIO_MATCH` - Scenario match attempted (always logged)
- `SECTION_S4B_DISCOVERY_OWNER_SELECTED` - Owner decided (always logged)

**Conditional Events:**
- `SECTION_S1_5_CONNECTION_QUALITY_GATE` - If connection issue
- `GREETING_INTERCEPTED` - If greeting detected
- `SECTION_S3_PENDING_SLOTS_STORED` - If slots extracted
- `SECTION_S3_5_*` - If detection triggers matched
- `SECTION_S4_DISCOVERY_ENGINE` - If DiscoveryFlowRunner runs
- `SECTION_S5_CONSENT_GATE` - If consent checked
- `SECTION_S6_BOOKING_FLOW` - If booking runs
- `SECTION_OPENER_ENGINE` - If opener applied

**Error Events:**
- `S4A_TRIAGE_ERROR` - TriageEngineRouter error
- `S4A_SCENARIO_ERROR` - ScenarioEngine error
- `S4A_PERFORMANCE_WARNING` - Circuit breaker triggered
- `SPEAKER_OWNER_COLLISION` - Multiple speakers conflict

---

## 🎯 SUCCESS CRITERIA (Defined)

### **Primary KPI: Booking Conversion**

**Definition:**
```
Booking Conversion = (Calls with booking_request created) 
                    / (Calls with service_request intent detected)
```

**Baseline:** 40% (1,000 calls, January 2026)

**Target:** 65% (+25% relative lift)

**Measurement Window:** 2 weeks post-100% rollout

**Cohort:** All calls with `triageResult.intentGuess === 'service_request'`

**Attribution:** Group by `matchSource` tag (TRIAGE_SCENARIO vs DISCOVERY_FLOW)

**Validation Query:**
```javascript
db.rawEvents.aggregate([
  { $match: {
      timestamp: { $gte: new Date("2026-02-20"), $lte: new Date("2026-03-05") },
      type: "SECTION_S4B_DISCOVERY_OWNER_SELECTED"
  }},
  { $lookup: {
      from: "bookingRequests",
      localField: "callId",
      foreignField: "callId",
      as: "booking"
  }},
  { $group: {
      _id: "$data.owner",
      totalCalls: { $sum: 1 },
      bookings: { $sum: { $cond: [{ $gt: [{ $size: "$booking" }, 0] }, 1, 0] } },
      conversionRate: { $avg: { $cond: [{ $gt: [{ $size: "$booking" }, 0] }, 1, 0] } }
  }}
])
```

**Expected Result:**
```json
[
  {
    "_id": "TRIAGE_SCENARIO_PIPELINE",
    "totalCalls": 650,
    "bookings": 520,
    "conversionRate": 0.80
  },
  {
    "_id": "DISCOVERY_FLOW",
    "totalCalls": 350,
    "bookings": 140,
    "conversionRate": 0.40
  }
]
```

**Overall Conversion:** (520 + 140) / (650 + 350) = 66% ✅

---

### **Secondary KPIs:**

**matchSource Distribution:**
- Target: 60-70% TRIAGE_SCENARIO, 30-40% DISCOVERY_FLOW
- Hard stop: <20% TRIAGE_SCENARIO (not working)

**Latency p95:**
- Target: <500ms
- Hard stop: >800ms

**Error Rate:**
- Target: <0.1%
- Hard stop: >1%

**Call Reason Capture Rate:**
- Target: >90% of calls have call_reason_detail populated
- Measurement: Check `state.plainSlots.call_reason_detail !== null`

---

## 🚨 ROLLBACK PLAN

### **Trigger Conditions:**

**Auto-Rollback (Immediate):**
- Global kill switch activated manually
- Error rate > 1% sustained for 1 hour
- Conversion drop > 10% relative

**Manual Rollback (On-Call Decision):**
- Conversion drop 5-10% (investigate, may rollback)
- Latency p95 > 800ms (performance unacceptable)
- Customer complaints spike

### **Rollback Procedure:**

**Option 1: Global Kill Switch (Instant)**
```javascript
db.adminSettings.updateOne(
    {},
    { $set: { "globalKillSwitches.s4aTriageScenarioPipeline": true } }
)
```
**Impact:** All companies disable S4A immediately, revert to V115 behavior

**Option 2: Feature Flag Rollback (Per-Company)**
```javascript
db.companies.updateMany(
    { "aiAgentSettings.frontDeskBehavior._experimentalS4A": true },
    { $set: { "aiAgentSettings.frontDeskBehavior._experimentalS4A": false } }
)
```
**Impact:** Gradual rollback, can keep working companies enabled

**Option 3: Config Rollback (Master Toggle)**
```javascript
db.companies.updateMany(
    {},
    { $set: { "aiAgentSettings.frontDeskBehavior.discoveryConsent.disableScenarioAutoResponses": true } }
)
```
**Impact:** Full revert to V115 behavior

**No code deployment needed for rollback. All toggles are runtime-checked.**

---

## 📚 RELATED DOCUMENTS

- `S4A_MASTER_IMPLEMENTATION_TRACKER.md` - Implementation progress
- `RISK_REGISTER_S4A.md` - Risk assessment
- `OBSERVABILITY_PLAN_S4A.md` - Monitoring strategy
- `SUCCESS_METRICS_S4A.md` - Measurement methodology

---

## Approval Signatures

**Chief Architect:** _________________ Date: _______

**Product Lead:** _________________ Date: _______

**Engineering Manager:** _________________ Date: _______

**QA Lead:** _________________ Date: _______

---

**Status:** PROPOSED (awaiting governance gate completion)  
**Next:** Complete Runtime Spec, Risk Register, Observability Plan  
**After:** Implement with full approval

---

**END OF ADR-001**

*Formal architectural decision.*  
*All stakeholders must review and approve.*  
*No implementation until governance gates pass.*
