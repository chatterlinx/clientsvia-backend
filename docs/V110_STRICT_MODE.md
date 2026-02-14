# V110 Call Flow — Scenario-First Architecture

**Date:** 2026-02-13 (updated 2026-02-14)  
**Status:** ACTIVE  
**Trigger:** Discovery Flow configured in UI

---

## The Customer Experience

### Fast Path (caller gives name + address + "I need service")

```
Turn 1: "Hi, my name is Mark Johnson, 1212 Cleveland Ave Fort Myers.
         I need AC service — you installed a motor last week and it failed."

  → Implicit consent detected ("need service")
  → Slots captured: name, address, call_reason
  → Scenario acknowledges: "Got it, Mark — sorry about that.
    We'll pull up your service history and check warranty coverage.
    I have you at 1212 Cleveland Ave in Fort Myers — is that correct?
    And is the number you're calling from the best one for text updates?"

Turn 2: "Yes, that's right."
  → discoveryComplete → BOOKING flow starts
```

### Standard Path (caller describes problem, no address yet)

```
Turn 1: "My AC isn't cooling."
  → Scenario: "Got it — we can help with that.
    Would you like me to schedule a service call?"

Turn 2: "Yes"
  → schedulingAccepted = true
  → "Perfect. What's the full service address?"

Turn 3-4: Info collection
  → "And what's your first and last name?"
  → "Is the number you're calling from the best one for text updates?"

Turn 5+: BOOKING flow (remaining slots)
```

---

## Architecture Layers

### Layer 1 — Scheduling Acceptance Detector (above V110 Discovery)

Detects caller intent to schedule via three channels:

| Channel | Example | Config Path |
|---------|---------|-------------|
| **Explicit consent** | "yes", "go ahead" (when consentPending) | `frontDesk.discoveryConsent.consentPhrases` |
| **Booking keywords** | "schedule", "book", "appointment" | `frontDesk.detectionTriggers.directIntentPatterns` |
| **Implicit service requests** | "I need service", "send someone", "come out" | `frontDesk.detectionTriggers.implicitConsentPhrases` |

All phrases are **config-driven per company** (Control Plane Wiring tab).

Key behavior: In V110, detection **defers signals** — it does NOT set `aiResult` or short-circuit scenarios. Instead, it stores `_deferredBookingSignals` on the session. Scenarios speak first (acknowledge + funnel). The deferred signals are injected into the final response, so FrontDeskRuntime sees both the scenario reply AND the scheduling acceptance.

### Layer 2 — V110 Discovery Flow (UI-configured steps)

Your Discovery Flow steps: name, phone, address, call_reason.

Each step has a `confirmMode` from the UI:
- `smart_if_captured` — confirm if captured ("I have your name as Mark"), ask if missing
- `confirm_if_from_caller_id` — confirm phone from caller ID
- `never` — don't confirm (e.g., call_reason)

**Policy:** If captured → confirm. If missing → ask. Never re-ask.

### Layer 3 — Booking Flow (after Discovery complete)

Enters ONLY when `schedulingAccepted AND discoveryComplete`.
BookingFlowRunner handles remaining booking slots.

---

## Lane Transition (FrontDeskRuntime.determineLane)

```
if hasDiscoveryFlow:
    if schedulingAccepted AND discoveryComplete → BOOKING
    else → DISCOVERY
```

Within DISCOVERY, there are two sub-phases:

| Phase | Trigger | Who Speaks |
|-------|---------|-----------|
| **Scenario Q&A** | `schedulingAccepted = false` | Scenarios are PRIMARY brain (acknowledge + funnel) |
| **Info Collection** | `schedulingAccepted = true` | LLM collects V110 steps (confirm captured, ask missing) |

---

## Deferred Signal Architecture

```
ConversationEngine:
  1. Booking intent detected (implicit/explicit/keyword)
  2. V110? → Store _deferredBookingSignals, DON'T set aiResult
  3. Scenarios run → generate acknowledgment + funnel response
  4. At end of processTurn, merge deferred signals into aiResult.signals
  5. Return: scenario response + deferToBookingRunner signal

FrontDeskRuntime.handleDiscoveryLane:
  6. Receives signals.deferToBookingRunner
  7. Check V110 → merge filledSlots into allCaptured
  8. If missingSlots > 0 → set schedulingAccepted, return scenario response
  9. If discoveryComplete → lock booking, run BookingFlowRunner
```

---

## LLM Prompt Rules (HybridReceptionistLLM)

The LLM receives different instruction sets based on scheduling state:

### Pre-acceptance (schedulingAccepted = false)
- Acknowledge caller's problem using scenario knowledge
- Offer scheduling: "Would you like me to schedule a service call?"
- Do NOT ask for name/phone/address yet
- If caller says "I need service" → treat as consent

### Post-acceptance, info missing (schedulingAccepted = true, missingSlots > 0)
- CONFIRM captured slots: "I have your name as {value}"
- ASK missing slots: "What's the service address?"
- Combine confirm + ask in one response
- End with: "Once you confirm, I'll get this scheduled."

### Post-acceptance, complete (schedulingAccepted = true, missingSlots = 0)
- Proceed to booking

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

## Implicit Consent — "I need service" = scheduling accepted

When a caller's words imply they want service, the system treats it as consent:

| Phrase | Detection |
|--------|-----------|
| "I need service" / "I need AC service" | implicit_service_request |
| "Send someone" / "Send someone out" | implicit_service_request |
| "Come out" / "Come take a look" | implicit_service_request |
| "Need repair" / "Need it fixed" | implicit_service_request |
| "I need a technician" | implicit_service_request |

Config: `frontDesk.detectionTriggers.implicitConsentPhrases` (per-company).

The agent does NOT waste a turn asking "Would you like to schedule?" — it confirms captured info and proceeds.

---

## Redis Persistence

| Field | Saved | Loaded |
|-------|-------|--------|
| `schedulingAccepted` | v2twilio → Redis | FrontDeskRuntime.determineLane |
| `bookingConsentPending` | v2twilio → Redis | ConversationEngine consent detector |
| `booking.consentGiven` | v2twilio → Redis | FrontDeskRuntime + ConversationEngine |

---

## Files Changed

| File | Change |
|------|--------|
| `ConversationEngine.js` | Booking detection runs in ALL modes (not skipped in strict) |
| `ConversationEngine.js` | V110 implicit consent detection (`implicitConsentPhrases`) |
| `ConversationEngine.js` | V110 deferred signals (scenarios speak first, signals injected after) |
| `ConversationEngine.js` | LLM context includes `schedulingAccepted` + `confirmPolicy` |
| `FrontDeskRuntime.js` | Booking signal handler merges `filledSlots` + `slotsCollected` |
| `FrontDeskRuntime.js` | Signal handler checks `signals.schedulingAccepted` |
| `HybridReceptionistLLM.js` | V110-aware LLM prompt: confirm captured / ask missing |
| `v2twilio.js` | `schedulingAccepted` persisted to Redis |
| `v2Company.js` | Schema: `implicitConsentPhrases` added to `detectionTriggers` |
| `runtimeReaders.map.js` | Wiring map: `implicitConsentPhrases` config path |

---

## Non-V110 Backward Compatibility

Companies WITHOUT a Discovery Flow: zero changes. Legacy booking detection, phrase matching, and consent gates all preserved. The `if (hasDiscoveryFlow)` / `if (!hasDiscoveryFlow)` guards ensure complete isolation.
