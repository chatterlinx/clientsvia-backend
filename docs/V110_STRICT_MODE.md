# V110 Owner Priority — Deterministic Lane Architecture

**Date:** 2026-02-13  
**Status:** ACTIVE  
**Trigger:** Discovery Flow configured in UI  
**Replaces:** Kill switches, consent gates, phrase detection

---

## Architecture

When a V110 Discovery Flow is configured, lane transition is **pure state**:

```
if missingDiscoverySlots > 0  → DISCOVERY
if missingDiscoverySlots === 0 → BOOKING
```

No phrase detection. No kill switches. No consent gates.

---

## Owner Priority (Permanent, Not Toggleable)

| Owner | Mic | What It Does |
|-------|-----|-------------|
| **Discovery** | Owns until slots captured | Collects: reason → name → phone → address |
| **Triage/Scenarios** | Enrichment only | Sets tags, call_reason_detail, routing hints. Cannot output booking prompts. |
| **Booking** | Owns after discovery completes | Collects remaining slots: lastName, time, etc. |

### Discovery Completion IS Consent

In V110, the caller voluntarily provides their name, phone, and address through Discovery.
That IS consent. No separate consent gate is needed. `bookingRequiresExplicitConsent` is not
consulted when V110 Discovery Flow is active.

---

## What This Replaces

### Kill Switches (Removed from V110 Control Flow)

| Old Toggle | Old Purpose | V110 Replacement |
|-----------|------------|-----------------|
| `bookingRequiresExplicitConsent` | Block booking without "yes" | Discovery completion IS consent |
| `disableScenarioAutoResponses` | Muzzle scenarios in discovery | Owner priority: scenarios enrich, don't speak booking |
| `forceLLMDiscovery` | Force LLM over scenarios | Scenarios are smart, not muzzled. Output constrained by owner. |

These toggles still exist for **non-V110 companies** (backward compatibility).
For V110 companies, they are **not consulted** for lane decisions.

### Phrase Detection (Removed from V110 Lane Logic)

| Old Mechanism | Old Purpose | V110 Replacement |
|--------------|------------|-----------------|
| `directIntentPatterns` | Detect "book" / "schedule" to trigger booking | State-based: discoveryComplete → BOOKING |
| `wantsBooking` triggers | Same | Same |
| Smart patterns | Regex matching | Removed entirely (legacy only) |
| Fallback patterns | Default when no config | Removed entirely (legacy only) |

---

## How It Works

### FrontDeskRuntime.determineLane()

```javascript
const discoverySteps = getConfig('frontDesk.discoveryFlow.steps', []);
const hasDiscoveryFlow = discoverySteps.length > 0;

if (hasDiscoveryFlow) {
    // Required steps = all steps with slotId, minus call_reason_detail (passive)
    const requiredSteps = discoverySteps.filter(step => 
        step.slotId && step.slotId !== 'call_reason_detail'
    );
    
    const missingSlots = requiredSteps.filter(step => {
        const val = allCaptured[step.slotId];
        return !val || (typeof val === 'string' && val.trim() === '');
    });
    
    if (missingSlots.length > 0) return LANES.DISCOVERY;
    else return LANES.BOOKING;
}
```

### ConversationEngine Owner Policy

```javascript
const killSwitches = hasV110DiscoveryFlow
    ? {
        bookingRequiresConsent: false,       // Discovery completion IS consent
        forceLLMDiscovery: false,             // Scenarios can inform, LLM speaks
        disableScenarioAutoResponses: false,  // Scenarios run, constrained by owner
        v110OwnerPriority: true               // ← This drives all downstream logic
    }
    : { /* legacy kill switches */ };
```

### Scenario Behavior in Discovery (V110)

- Scenarios **run** and **match** (triage fills call_reason_detail, tags, priority hints)
- Scenarios **can auto-respond** (tier-1 short-circuit still works)
- BUT: scheduling language is **stripped** from scenario output
- No consent questions injected during Discovery
- LLM receives scenarios as `enrichment_only` context, not `may_verbatim`

---

## What's Allowed vs Not Allowed

### Allowed (Permanent Standards)

- Permanent protocol enforcement ("Discovery owns the mic")
- Company-scoped config (per companyID)
- Template seeding that writes correct defaults on onboarding
- Schema fixes so fields persist correctly
- Deterministic lane/state machine logic

### Not Allowed

- Emergency toggles that shut off major subsystems
- "Disable X" as a permanent strategy
- Temp files/presets that don't become canonical wiring truth
- Phrase detection for lane transitions (state-based only)

---

## Expected Call Flow

```
Turn 1: "Hi, my name is Mark. I'm having air conditioning problems."
  → Discovery: captures call_reason_detail (triage), name="Mark"
  → Missing: phone, address
  → Agent asks for phone (next Discovery step)

Turn 2: "Yeah, this number works."
  → Discovery: captures phone from caller ID
  → Missing: address
  → Agent asks for address

Turn 3: "123 Main Street, Fort Myers."
  → Discovery: captures address
  → Missing: none → discoveryComplete = true
  → Lane: BOOKING (automatic, no phrase detection needed)
  → BookingFlowRunner starts: "And what's your last name, Mark?"

Turn 4+: Booking flow finishes remaining slots
```

---

## Raw Event Markers

### V110 Owner Priority Active
```json
{
  "type": "DECISION_TRACE",
  "data": {
    "reason": "v110_discovery_owns_mic",
    "missingSlots": ["phone", "address"],
    "capturedSlots": ["name"]
  }
}
```

### Discovery Complete → Booking
```json
{
  "type": "DECISION_TRACE",
  "data": {
    "reason": "v110_discovery_complete",
    "capturedSlots": ["name", "phone", "address"]
  }
}
```

### Legacy Mode (No Discovery Flow)
```json
{
  "type": "LOG",
  "message": "LEGACY MODE: No V110 Discovery Flow - using hardcoded patterns"
}
```

---

## Files Changed

| File | Change | Lines |
|------|--------|-------|
| `services/engine/FrontDeskRuntime.js` | Pure state-based lane transition | ~80 lines (replaced ~130) |
| `services/ConversationEngine.js` | Owner priority replaces kill switches | ~60 lines changed |
| `models/v2Company.js` | Added directIntentPatterns to schema | 14 lines |

---

## Non-V110 Backward Compatibility

Companies WITHOUT a Discovery Flow configured continue to use:
- Legacy kill switches (bookingRequiresExplicitConsent, etc.)
- Phrase detection for booking intent
- Smart patterns and fallback patterns
- Consent gate for booking entry

**Zero changes for non-V110 companies.**
