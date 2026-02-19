# Agent 2.0 V119 — Hard Isolation Specification

**Date:** February 18, 2026  
**Version:** V119  
**Status:** Implemented  

---

## Executive Summary

Agent 2.0 V119 implements **hard isolation** from all legacy systems. When Agent 2.0 is enabled, it is the **only speaker** during Discovery. Legacy owners (DiscoveryFlowRunner, ScenarioEngine auto-responses, CallReasonExtractor acknowledgments) are **blocked and proven blocked** via raw events.

This is not a soft preference — it's enforced architecture with proof on every turn.

---

## The Problem We Solved

### Before V119
- Agent 2.0 could run, but legacy systems could still be evaluated as fallbacks
- ScenarioEngine ran automatically on every turn (latency + unpredictable responses)
- No proof that legacy owners were actually blocked
- Fallback said "How can I help?" even when we already captured the call reason
- "Greeting hijack" risk where "hi" could match trigger cards competing with problem detection

### After V119
- Legacy owners are **blocked** (not just skipped) when Agent 2.0 is enabled
- ScenarioEngine is **OFF by default** (opt-in only)
- Every turn emits **proof events** showing what was blocked and why
- Fallback distinguishes "reason captured" vs "no reason" — never restarts conversation
- Greetings are handled by strict interceptor **before** Agent 2.0 runs

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CALL TURN PROCESSING                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. GreetingInterceptor (STRICT)                                           │
│     └── Only matches if utterance IS the greeting                          │
│     └── "hi" ✅  |  "hi my AC is broken" ❌                                 │
│                                                                             │
│  2. SlotExtractor (S3)                                                     │
│     └── Extracts name, phone, call_reason_detail                           │
│     └── Results stored in state.plainSlots                                 │
│                                                                             │
│  3. Agent 2.0 Gate Check                                                   │
│     └── IF agent2.enabled && agent2.discovery.enabled:                     │
│         └── EMIT A2_LEGACY_BLOCKED (proof of blocking)                     │
│         └── RUN Agent2DiscoveryRunner.run()                                │
│         └── NO FALLBACK TO LEGACY                                          │
│     └── ELSE:                                                              │
│         └── Run legacy DiscoveryFlowRunner (deprecated path)               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Raw Event Proof Chain

Every turn emits `A2_MIC_OWNER_PROOF` — the **single consolidated event** proving what ran and what didn't.

### A2_MIC_OWNER_PROOF (MANDATORY)

This is the **one event** you check to verify hard isolation:

```json
{
  "type": "A2_MIC_OWNER_PROOF",
  "data": {
    "agent2Enabled": true,
    "agent2Ran": true,
    "agent2Responded": true,
    "finalResponder": "AGENT2_DISCOVERY",
    
    // PROOF: These engines did NOT run
    "greetingInterceptorRan": false,
    "greetingEvaluated": true,
    "greetingMatchedNothing": true,
    "legacyDiscoveryRan": false,
    "scenarioEngineAutoRan": false,
    "callReasonExtractorAckRan": false,
    "consentGateRan": false,
    "bookingFlowRan": false,
    "openerEngineRan": false,
    
    "turn": 1,
    "inputPreview": "my AC is not cooling",
    "responsePreview": "Ok. I'm sorry to hear that..."
  }
}
```

### When Greeting Intercepts (Agent 2.0 Bypassed)

If greeting matches, Agent 2.0 never runs. Proof shows why:

```json
{
  "type": "A2_MIC_OWNER_PROOF",
  "data": {
    "agent2Enabled": true,
    "agent2Ran": false,
    "agent2Responded": false,
    "finalResponder": "GREETING_INTERCEPTOR",
    
    "greetingInterceptorRan": true,
    "greetingMatched": "hi",
    "bypassReason": "GREETING_INTERCEPTED_EARLY_RETURN",
    
    "legacyDiscoveryRan": false,
    "scenarioEngineAutoRan": false,
    "turn": 1,
    "inputPreview": "hi"
  }
}
```

### Full Event Chain (When Agent 2.0 Runs)

| Event | Purpose | Key Fields |
|-------|---------|------------|
| `A2_LEGACY_BLOCKED` | Proves legacy owners were blocked | `blocked: true`, `blockedOwners: [...]` |
| `A2_GATE` | Entry proof with config version | `enabled`, `configHash`, `legacyBlocked`, `scenarioFallbackEnabled` |
| `A2_TRIGGER_EVAL` | Trigger card matching details | `matched`, `cardId`, `matchType`, `evaluated[]` |
| `A2_SCENARIO_EVAL` | Scenario fallback status | `tried: false`, `enabled: false` (by default) |
| `A2_PATH_SELECTED` | Which path was taken | `path: 'TRIGGER_CARD'` / `'FALLBACK_WITH_REASON'` / `'FALLBACK_NO_REASON'` |
| `A2_RESPONSE_READY` | Final response proof | `responsePreview`, `source`, `hasAudio`, `usedCallerName` |
| `A2_MIC_OWNER_PROOF` | **CONSOLIDATED PROOF** | All engines' run status in one event |

### Example Event Sequence (BlackBox)

```json
// Turn 1: Caller says "my AC is not cooling"
{ "type": "A2_LEGACY_BLOCKED", "data": { "blocked": true, "blockedOwners": ["DiscoveryFlowRunner", "ScenarioEngine_auto"] } }
{ "type": "A2_GATE", "data": { "enabled": true, "configHash": "cfg_a3f2b1c0", "scenarioFallbackEnabled": false } }
{ "type": "A2_TRIGGER_EVAL", "data": { "matched": true, "cardId": "ac.not_cooling", "matchType": "KEYWORD" } }
{ "type": "A2_SCENARIO_EVAL", "data": { "tried": false, "enabled": false, "reason": "playbook.useScenarioFallback is not true" } }
{ "type": "A2_PATH_SELECTED", "data": { "path": "TRIGGER_CARD", "cardId": "ac.not_cooling" } }
{ "type": "A2_RESPONSE_READY", "data": { "path": "TRIGGER_CARD", "source": "card:ac.not_cooling", "responsePreview": "Ok. I'm sorry to hear..." } }
{ "type": "A2_MIC_OWNER_PROOF", "data": { "agent2Ran": true, "greetingInterceptorRan": false, "legacyDiscoveryRan": false, "finalResponder": "AGENT2_DISCOVERY" } }
```

---

## Hard Isolation Requirements (Non-Negotiables)

### A) Single Mic-Owner Rule (Hard Return)

When Agent 2.0 Discovery is enabled, the runtime MUST:

1. Run Agent 2.0 Discovery
2. **Return immediately** after Agent 2.0 produces a response
3. **Prevent any other speaker** from executing:
   - ❌ DiscoveryFlowRunner (legacy)
   - ❌ ScenarioEngine auto-responses
   - ❌ CallReasonExtractor acknowledgment hijack
   - ❌ ConsentGate (during discovery)
   - ❌ BookingFlowRunner (during discovery)
   - ❌ OpenerEngine prepends (skipped for Agent 2.0)

**Implementation:** Lines 964-1010 in `FrontDeskCoreRuntime.js` — Agent 2.0 sets `ownerResult`, then legacy path is blocked by `if (!ownerResult && !agent2WasEnabled)` check.

### B) Greetings Cannot Hijack Real Sentences

Greetings only match if the utterance is **basically only a greeting**:

| Input | Result | Reason |
|-------|--------|--------|
| "hi" | ✅ Greeting | Short, just greeting |
| "hello" | ✅ Greeting | Short, just greeting |
| "hi there" | ✅ Greeting | Greeting + 1 filler word max |
| "hi my name is marc" | ❌ NOT greeting | Has real content after greeting |
| "hi my AC is broken" | ❌ NOT greeting | Has problem statement |

**Rule:** After removing greeting word(s), only 1 filler word max can remain. Any real content = not a greeting.

**Implementation:** `GreetingInterceptor.isShortGreeting()` enforces this. See `services/engine/interceptors/GreetingInterceptor.js` lines 45-69.

### C) Scenario Fallback is Explicit + UI Gated

ScenarioEngine fallback is **OFF by default**:

```javascript
playbook: {
  useScenarioFallback: false,  // V119: Must be explicitly enabled
}
```

Only enabled via Agent 2.0 UI (`playbook.useScenarioFallback: true`).

When disabled, emits proof:
```json
{ "type": "A2_SCENARIO_EVAL", "data": { "tried": false, "enabled": false, "reason": "playbook.useScenarioFallback is not true" } }
```

### D) Raw Event Proof Required Every Turn

`A2_MIC_OWNER_PROOF` MUST fire every turn showing:

```javascript
{
  agent2Enabled: true,
  agent2Ran: true,
  greetingInterceptorRan: false,
  legacyDiscoveryRan: false,
  scenarioEngineAutoRan: false,
  bookingFlowRan: false,
  finalResponder: "AGENT2_DISCOVERY"
}
```

Without this event, isolation is not proven.

---

## Acceptance Tests

### Test 1: Agent 2.0 Blocks Legacy Discovery

**Input:** "my AC is not cooling" (Agent 2.0 enabled)

**Expected A2_MIC_OWNER_PROOF:**
```json
{
  "agent2Enabled": true,
  "agent2Ran": true,
  "legacyDiscoveryRan": false,
  "finalResponder": "AGENT2_DISCOVERY"
}
```

**FAIL if:** `legacyDiscoveryRan: true` or `finalResponder` is not Agent 2.0

### Test 2: Greeting Does Not Hijack Problem Statement

**Input:** "hi my AC is broken"

**Expected:** Greeting interceptor evaluates but does NOT match (blocked by short-greeting gate). Agent 2.0 runs.

**Expected GREETING_EVALUATED:**
```json
{
  "inputPreview": "hi my AC is broken",
  "inputWordCount": 5,
  "isShortGreeting": false,
  "matched": false,
  "blockedReason": "UTTERANCE_TOO_LONG_FOR_GREETING"
}
```

**Expected A2_MIC_OWNER_PROOF:**
```json
{
  "greetingInterceptorRan": false,
  "greetingEvaluated": true,
  "greetingBlocked": true,
  "greetingBlockReason": "UTTERANCE_TOO_LONG",
  "agent2Ran": true,
  "finalResponder": "AGENT2_DISCOVERY"
}
```

**FAIL if:** `GREETING_EVALUATED.matched: true` or `finalResponder: "GREETING_INTERCEPTOR"`

### Test 3: Pure Greeting Bypasses Agent 2.0

**Input:** "hi"

**Expected:** Greeting interceptor matches and returns. Agent 2.0 does NOT run.

**Expected A2_MIC_OWNER_PROOF:**
```json
{
  "greetingInterceptorRan": true,
  "greetingMatched": "hi",
  "agent2Ran": false,
  "finalResponder": "GREETING_INTERCEPTOR",
  "bypassReason": "GREETING_INTERCEPTED_EARLY_RETURN"
}
```

**FAIL if:** `agent2Ran: true`

### Test 4: ScenarioEngine is OFF by Default

**Input:** Any unmatched utterance (Agent 2.0 enabled, no trigger card matches)

**Expected A2_SCENARIO_EVAL:**
```json
{
  "tried": false,
  "enabled": false,
  "reason": "playbook.useScenarioFallback is not true (V119 default: OFF)"
}
```

**FAIL if:** `tried: true` when `useScenarioFallback` is not explicitly set

### Test 5: Fallback With Reason Does Not Restart Conversation

**Input:** Unmatched utterance, but `call_reason_detail` already captured

**Expected A2_PATH_SELECTED:**
```json
{
  "path": "FALLBACK_WITH_REASON",
  "capturedReasonPreview": "AC not cooling"
}
```

**Expected Response Pattern:** "Ok. I'm sorry to hear that. It sounds like [reason]. Would you like to schedule a technician?"

**FAIL if:** Response contains "How can I help you today?"

### Test 6: Fallback Without Reason Can Ask Open Question

**Input:** Unmatched utterance, no `call_reason_detail`

**Expected A2_PATH_SELECTED:**
```json
{
  "path": "FALLBACK_NO_REASON"
}
```

**Expected Response Pattern:** "Ok. How can I help you today?"

**PASS:** Only this path may ask the open question.

---

## Key Changes

### 1. ScenarioEngine is OFF by Default

**Before:** ScenarioEngine ran automatically as fallback on every turn.

**After:** ScenarioEngine only runs if `playbook.useScenarioFallback: true` (opt-in).

```javascript
// Config default
playbook: {
  useScenarioFallback: false,  // V119: OFF by default
  // ...
}
```

**Proof event when disabled:**
```json
{ "type": "A2_SCENARIO_EVAL", "data": { "tried": false, "enabled": false, "reason": "playbook.useScenarioFallback is not true (V119 default: OFF)" } }
```

### 2. Distinct Fallback Paths

**Before:** Single fallback that always said "How can I help you today?" — even when we already knew the reason.

**After:** Two distinct paths:

| Path | Condition | Response Pattern |
|------|-----------|------------------|
| `FALLBACK_NO_REASON` | No `call_reason_detail` captured | "Ok. How can I help you today?" |
| `FALLBACK_WITH_REASON` | `call_reason_detail` exists | "Ok. I'm sorry to hear that. It sounds like [reason]. Would you like to schedule a technician?" |

**Critical:** When we have a captured reason, we **never** restart the conversation. We acknowledge what we heard and offer next steps.

### 3. Legacy Blocked Proof Event

**New event emitted in FrontDeskCoreRuntime before Agent 2.0 runs:**

```javascript
bufferEvent('A2_LEGACY_BLOCKED', {
    blocked: true,
    blockedOwners: [
        'DiscoveryFlowRunner',
        'ScenarioEngine_auto',
        'CallReasonExtractor_ack',
        'S4A_Pipeline'
    ],
    reason: 'Agent 2.0 enabled - legacy owners will NOT be evaluated',
    turn,
    uiBuild: 'AGENT2_UI_V0.8'
});
```

This proves that when Agent 2.0 runs, legacy code paths are **blocked**, not just skipped.

### 4. Config Hash for Version Tracking

Every `A2_GATE` event includes a config hash:

```javascript
configHash: 'cfg_a3f2b1c0'  // Computed from: rules count, ackWord, useScenarioFallback, updatedAt
```

This lets you verify exactly which config was active during any turn.

### 5. Personalized Acknowledgment (High Confidence Only)

When caller name is extracted with high confidence (≥0.85), Agent 2.0 uses it once:

- **With name:** "Ok, Marc. Our service call is $89..."
- **Without name:** "Ok. Our service call is $89..."

Rules:
- Only use name if confidence ≥ 0.85 (explicit "my name is..." extraction)
- Only use once per turn (not repetitive)
- Never guess or use low-confidence names

---

## Greeting Isolation (Unchanged but Verified)

Greetings are handled by `GreetingInterceptor` **before** Agent 2.0 runs. The interceptor uses strict matching:

| Input | Result |
|-------|--------|
| "hi" | ✅ Greeting — handled by interceptor |
| "hello" | ✅ Greeting — handled by interceptor |
| "hi there" | ✅ Greeting — handled by interceptor |
| "hi my name is marc" | ❌ NOT greeting — goes to Agent 2.0 |
| "hi my AC is broken" | ❌ NOT greeting — goes to Agent 2.0 |

**Rule:** After removing the greeting word(s), only 1 filler word max can remain. Real content = not a greeting.

Greetings are **not trigger cards**. They are a separate, strict interceptor that runs first.

---

## Files Modified

| File | Changes |
|------|---------|
| `services/engine/agent2/Agent2DiscoveryRunner.js` | V119 header, A2_GATE event, A2_PATH_SELECTED, A2_RESPONSE_READY, distinct fallbacks, ScenarioEngine opt-in, buildAck() for personalization |
| `services/engine/FrontDeskCoreRuntime.js` | A2_LEGACY_BLOCKED event before Agent 2.0 runs |
| `routes/admin/agent2.js` | `useScenarioFallback: false` default, documented fallback fields |

---

## Verification Checklist

To verify V119 is working correctly, check BlackBox for these events:

### ✅ Legacy Blocked
```
A2_LEGACY_BLOCKED.blocked = true
A2_LEGACY_BLOCKED.blockedOwners includes 'DiscoveryFlowRunner'
```

### ✅ ScenarioEngine Off
```
A2_SCENARIO_EVAL.enabled = false
A2_SCENARIO_EVAL.tried = false
```

### ✅ Correct Fallback Path
When `call_reason_detail` exists:
```
A2_PATH_SELECTED.path = 'FALLBACK_WITH_REASON'
```

When no reason captured:
```
A2_PATH_SELECTED.path = 'FALLBACK_NO_REASON'
```

### ✅ Trigger Card Match
When card matches:
```
A2_PATH_SELECTED.path = 'TRIGGER_CARD'
A2_PATH_SELECTED.cardId = 'pricing.service_call'
```

### ✅ Response Source Proof
```
A2_RESPONSE_READY.source = 'card:pricing.service_call'
A2_RESPONSE_READY.responsePreview = 'Ok. Our service call is $89...'
```

---

## What This Enables

1. **Single Mic Ownership:** Agent 2.0 is the only speaker when enabled. No competing brains.

2. **Deterministic Behavior:** Trigger cards provide predictable, testable responses.

3. **Provable Decisions:** Every turn has a complete audit trail in BlackBox.

4. **Safe Legacy Removal:** With proof that legacy isn't running, we can confidently delete legacy code after validation.

5. **Answer-First Discovery:** Agent 2.0 responds to the caller's problem first, doesn't immediately ask for name/address.

---

## Next Steps

1. **Validate with 50+ calls** — Verify raw events show correct paths
2. **Build more Trigger Cards** — Replace ScenarioEngine content with deterministic cards
3. **Delete legacy code** — Once proof shows legacy isn't needed, remove DiscoveryFlowRunner entirely
4. **Build Agent 2.0 Booking** — Separate module for intake flow after discovery

---

## Summary

V119 is not a feature — it's **enforcement**. When Agent 2.0 is enabled:

- Legacy code is **blocked** (proven)
- ScenarioEngine is **off** (proven)
- Fallbacks are **distinct** (no conversation restart when reason captured)
- Every decision is **traceable** (raw events)

This is the foundation for deleting legacy code with confidence.
