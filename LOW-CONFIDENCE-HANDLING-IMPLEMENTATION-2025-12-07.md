# Low Confidence Handling - Enterprise STT Quality Guard

**Implementation Date:** December 7, 2025  
**Status:** ✅ COMPLETE

---

## Executive Summary

This implementation adds a **Low Confidence Handling** system to the LLM-0 Controls. When Speech-to-Text (STT) confidence is below a configurable threshold, the AI politely asks the caller to repeat instead of guessing and potentially making wrong interpretations.

**Key Principle:** *One repeat is forgivable. A wrong interpretation is unforgivable.*

---

## What Was Built

### 1. Schema Addition (`models/v2Company.js`)

Added `lowConfidenceHandling` to `llm0Controls`:

```javascript
lowConfidenceHandling: {
    enabled: { type: Boolean, default: true },
    threshold: { type: Number, default: 60, min: 30, max: 90 },  // 0-100%
    action: { 
        type: String, 
        enum: ['repeat', 'guess_with_context', 'accept'],
        default: 'repeat'
    },
    repeatPhrase: { type: String, default: "Sorry, there's some background noise — could you say that again?" },
    maxRepeatsBeforeEscalation: { type: Number, default: 2, min: 1, max: 5 },
    escalatePhrase: { type: String, default: "I'm having trouble hearing you clearly. Let me get someone to help you." },
    preserveBookingOnLowConfidence: { type: Boolean, default: true },
    bookingRepeatPhrase: { type: String, default: "Sorry, I didn't catch that. Could you repeat that for me?" },
    logToBlackBox: { type: Boolean, default: true }
}
```

### 2. UI Panel (`public/js/ai-agent-settings/LLM0ControlsManager.js`)

Added `renderLowConfidencePanel()` method with:

- **Threshold slider** (30-90%)
- **Action dropdown** (repeat/guess_with_context/accept)
- **Customizable phrases** for standard and booking flows
- **Escalation settings** (max repeats, escalation phrase)
- **Advanced options** (preserve booking mode, log to Black Box)
- **Professional explanation text** for admins

### 3. Handler Service (`services/LowConfidenceHandler.js`)

Created new service with:

- `checkConfidence()` - Main function to check STT confidence and return action
- `resetRepeatCounter()` - Reset counter when high-confidence received
- `getSettings()` - Get merged settings for a company
- `validateSettings()` - Validate API input

### 4. Black Box Events (`services/BlackBoxLogger.js`)

Added quick log methods:

- `lowConfidenceHit()` - Logs when low confidence detected
- `lowConfidenceEscalation()` - Logs when escalating to human

### 5. API Routes (`routes/admin/llm0Controls.js`)

Updated to handle `lowConfidenceHandling` and `smartConfirmation` sections:

- GET endpoint returns merged settings with defaults
- PUT endpoint saves new settings
- Reset endpoint resets to defaults

---

## Call Flow Integration

The priority order in the call flow should be:

```
1. SILENCE CHECK       → "Are you there?"
2. LOW CONFIDENCE      → "Could you repeat that?" (THIS)
3. SPAM DETECTION      → Polite dismiss
4. BOOKING HARD LOCK   → Continue booking (bypass Brain-1)
5. FRUSTRATION         → Escalate to human
6. NORMAL PROCESSING   → Brain-1 → Triage → etc.
```

**Note:** The handler service is built and ready. Runtime wiring in `v2twilio.js` should call `LowConfidenceHandler.checkConfidence()` BEFORE routing to Brain-1.

---

## Why This Works (Business Case)

### What Loses Customers ❌
- Agent misunderstands → wrong response
- Agent loops endlessly
- Booking intent missed due to mishearing
- Wrong triage → wrong technician
- Frustration → hang up → lost revenue

### What Saves Customers ✅
- Polite "Could you repeat that?" (3 seconds)
- Correct understanding → correct action
- Booking locked properly
- Right technician dispatched
- Happy customer → revenue

### Industry Standard
This is the same approach used by:
- Google Contact Center AI
- Amazon Lex
- Five9 Intelligent Routing
- Nuance Enterprise Speech

---

## Files Modified

| File | Change |
|------|--------|
| `models/v2Company.js` | Added `lowConfidenceHandling` schema |
| `public/js/ai-agent-settings/LLM0ControlsManager.js` | Added UI panel |
| `services/LowConfidenceHandler.js` | **NEW** - Handler service |
| `services/BlackBoxLogger.js` | Added quick log methods |
| `routes/admin/llm0Controls.js` | Updated GET/PUT/RESET |

---

## Testing Checklist

- [ ] UI panel renders in Control Plane → Live Agent Status → LLM-0 Controls
- [ ] Threshold slider works (30-90%)
- [ ] Settings save correctly
- [ ] Settings load on refresh
- [ ] Reset to defaults works
- [ ] Black Box logs LOW_CONFIDENCE_HIT events
- [ ] Black Box logs LOW_CONFIDENCE_ESCALATION events

---

## Future Enhancements

1. **Runtime Wiring** - Wire `LowConfidenceHandler.checkConfidence()` into `v2twilio.js` call flow
2. **Guess with Context** - Implement `guess_with_context` action using conversation history
3. **Two Thresholds** - Add `hardFloor` (45%) and `softFloor` (65%) for tiered handling
4. **Analytics** - Track low confidence rates per company/template for optimization

---

## Admin Explanation (For Dashboard)

> **Low Confidence Handling (Recommended Setting)**
>
> When the AI isn't fully confident in what the caller said, it will **politely ask them to repeat themselves** instead of guessing.
>
> This does **NOT** lose you calls — it protects them.
>
> Background noise, weak cell signal, or unclear speech can cause the transcription engine to mis-hear phrases. If the system proceeds with a **wrong interpretation**, this can lead to incorrect routing, failed booking detection, frustrated callers, and lost revenue.
>
> A polite clarification avoids all of this. The system does not hang up, block, or ignore the caller. It simply asks once more — and then proceeds with correct, confident understanding.

---

**Implementation Complete** ✅

