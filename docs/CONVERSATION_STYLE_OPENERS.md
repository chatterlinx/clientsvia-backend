# Conversation Style: Openers — Pre-Prompt Micro-Acknowledgments

**Date:** 2026-02-14  
**Status:** ACTIVE  
**Config:** `frontDesk.conversationStyle.openers`

---

## Problem

Dead air while the LLM/scenario processes. Caller speaks → silence → agent responds. Feels robotic.

## Solution

Layer 0 micro-acknowledgments. A fast "Alright." or "I hear you." prepended to the response before TTS renders it. The caller hears an instant acknowledgment while the full answer follows.

---

## Architecture

```
Layer 0: OpenerEngine          ← "Alright." (instant, pre-prompt)
Layer 1: Scheduling Detector   ← implicit consent / explicit consent
Layer 2: V110 Discovery Flow   ← name, phone, address (confirm/ask)
Layer 3: Booking Flow           ← remaining booking slots
```

OpenerEngine runs INSIDE `handleDiscoveryLane()` in `FrontDeskRuntime.js`, after the scenario/LLM response is generated, but BEFORE it's returned to Twilio. It prepends the micro-ack to the final response string.

---

## Selection Logic

```
1. If frustrationKeywords matched → pick from frustration[]
2. Else if urgencyKeywords matched → pick from urgency[]
3. Else if mode='reflect_first' and reason_short exists → reflectionTemplate
4. Else pick from general[]
```

### Smart Guards

- **Turn 0 (greeting):** Skip — the greeting IS the opener.
- **Response already starts with an ack:** Skip — don't double-ack ("Alright. Alright, we can help...").
- **Disabled or mode='off':** Skip entirely.

---

## Config (UI → Control Plane Wiring)

**Path:** `frontDesk.conversationStyle.openers`  
**Schema:** `v2Company.frontDeskBehavior.openers`

```json
{
  "enabled": true,
  "mode": "reflect_first",
  "general": [
    "Alright.",
    "Okay.",
    "Perfect.",
    "Sounds good.",
    "Understood."
  ],
  "frustration": [
    "I hear you.",
    "Yeah, that's frustrating.",
    "Sorry about that."
  ],
  "urgency": [
    "Okay — we'll move quick.",
    "Alright — let's get this handled."
  ],
  "urgencyKeywords": [
    "asap", "as soon as possible", "today", "right now",
    "immediately", "urgent", "emergency"
  ],
  "frustrationKeywords": [
    "again", "still", "warranty", "last week", "second time",
    "didn't fix", "did not fix", "same problem", "not working again"
  ],
  "reflectionTemplate": "{reason_short} — okay."
}
```

### Modes

| Mode | Behavior |
|------|----------|
| `reflect_first` | Use reflection template if `reason_short` captured, else keyword-matched ack |
| `micro_ack_only` | Skip reflection, just use micro-acks from pools |
| `off` | No opener prepended at all |

---

## Examples

### Frustration detected

Caller: "This is the second time it broke. You didn't fix it last week."  
Agent: **"I hear you."** Got it — that's frustrating, especially after a recent repair...

### Urgency detected

Caller: "I need someone out here today, it's 95 degrees."  
Agent: **"Okay — we'll move quick."** Let me get this scheduled...

### Reflection mode

Caller: "My AC isn't cooling."  
Reason captured: "AC not cooling"  
Agent: **"AC not cooling — okay."** We can help with that...

### General (no keywords matched)

Caller: "Yeah, we need to get this checked out."  
Agent: **"Sounds good."** Would you like me to schedule a service call?

---

## Files

| File | Role |
|------|------|
| `services/engine/OpenerEngine.js` | Selection logic + prepend helper |
| `services/engine/FrontDeskRuntime.js` | Integration point (handleDiscoveryLane) |
| `models/v2Company.js` | Schema for openers config |
| `services/wiring/runtimeReaders.map.js` | Wiring map + global defaults |

---

## Per-Company Override

Global defaults apply to all tenants. To override for a specific company, set the fields under `company.aiAgentSettings.frontDeskBehavior.openers` in the database or via the UI. Any field not set falls back to the global default.

---

## Debugging

The opener debug info appears in:
- `result.debug.opener` in the FrontDeskRuntime return value
- BlackBox `FRONT_DESK_TURN_COMPLETE` event (responsePreview shows the prepended opener)
- Logger: `[FRONT_DESK_RUNTIME] Opener prepended` with tone + opener text
