# V110 Call Flow — Scenario-First Architecture

**Date:** 2026-02-13  
**Status:** ACTIVE  
**Trigger:** Discovery Flow configured in UI

---

## The Customer Experience

```
Turn 1: Caller complains
  → Scenario: "Got it — [acknowledge problem]. Would you like me to schedule a service call?"

Turn 2: Caller says yes
  → schedulingAccepted = true
  → "Perfect. What's your first and last name?"

Turn 3-4: Info collection
  → "Best number for text updates?"
  → "What's the full service address?"

Turn 5+: Booking flow
  → BookingFlowRunner handles remaining slots (last name, time, etc.)
```

---

## Architecture

### Lane Transition (FrontDeskRuntime.determineLane)

```
if hasDiscoveryFlow:
    if schedulingAccepted AND discoveryComplete → BOOKING
    else → DISCOVERY
```

Within DISCOVERY, there are two sub-phases:

| Phase | Trigger | Who Speaks |
|-------|---------|-----------|
| **Scenario Q&A** | `schedulingAccepted = false` | Scenarios are PRIMARY brain (acknowledge + funnel) |
| **Info Collection** | `schedulingAccepted = true` | LLM collects V110 steps (name, phone, address) |

### Booking Signal Handling (handleDiscoveryLane)

When ConversationEngine signals booking intent in V110:

1. **DON'T** set `bookingModeLocked = true`
2. **DO** set `callState.schedulingAccepted = true`
3. Return the scenario response (includes the funnel)
4. Next turn: `determineLane` sees `schedulingAccepted + !complete` → still DISCOVERY
5. LLM knows `schedulingAccepted = true` + `missingSlots` → starts collecting info
6. When info captured: `determineLane` → BOOKING

---

## Scenario Response Contract

Every scenario response in Discovery must follow this structure:

### A. Reassure / Answer
> "Got it — a blank thermostat usually means power isn't getting to the system."

### B. Optional Safety Clarifier
> "Is it completely out right now?"

### C. Funnel Question
> "Would you like me to schedule a service call?"

### Hard Rule — Scenarios in Discovery CANNOT ask:
- Morning or afternoon
- Time windows
- Appointment dates
- Pricing deep dives

These belong in **Booking flow only** (after name/phone/address captured).

---

## The 2 Decision Detectors

### 1. Scheduling Acceptance
Caller says: yes / schedule / book it / send someone / ok / please do / come out  
→ `schedulingAccepted = true` → enter V110 info collection

### 2. Refusal / More Questions  
Caller says: no / just asking / not yet / how much  
→ Stay in scenario Q&A mode, keep answering, keep funneling

---

## What If Caller Asks Questions?

Scenarios handle it naturally with answer + funnel:

| Caller | Agent (Scenario) |
|--------|-----------------|
| "How much is it?" | "Exact price depends on diagnosis. Would you like me to schedule a tech?" |
| "Can you come today?" | "We'll try for soonest available. Want me to schedule it now?" |
| "Is this an emergency?" | "If you have no cooling and it's affecting safety, we treat it as urgent. Want me to schedule?" |

---

## Priority Order

1. **Scenario response** (first — acknowledge + answer)
2. **Scheduling offer** (always included unless caller explicitly refuses)
3. If accepted → **V110 Discovery steps** (name → phone → address)
4. Then → **Booking flow** (remaining slots)

---

## What's Allowed vs Not Allowed

### Allowed
- Scenarios as PRIMARY brain in Discovery
- Scheduling offers in scenario responses (that's the funnel)
- Consent detection as scheduling acceptance detector
- State-based lane transition (accepted + complete → BOOKING)
- Company-scoped config (per companyID)

### Not Allowed
- Kill switches that muzzle scenarios
- Stripping scheduling language from scenario output
- Skipping scenarios to force info collection on Turn 1
- Phrase detection for lane transitions
- Booking-time prompts in Discovery (morning/afternoon)

---

## Files Changed

| File | Change |
|------|--------|
| `FrontDeskRuntime.js` | `determineLane()`: schedulingAccepted + discoveryComplete → BOOKING |
| `FrontDeskRuntime.js` | `handleDiscoveryLane()`: V110 sets schedulingAccepted, not bookingModeLocked |
| `ConversationEngine.js` | Scenarios are PRIMARY brain (not enrichment-only) |
| `ConversationEngine.js` | Scheduling language stays (not stripped). Only booking-time prompts stripped. |
| `ConversationEngine.js` | Consent detection works as scheduling acceptance detector |

---

## Non-V110 Backward Compatibility

Companies WITHOUT a Discovery Flow: zero changes. Legacy kill switches, phrase detection, and consent gates all preserved.
