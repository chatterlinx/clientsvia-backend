# CANONICAL CONTRACT V1 - PRODUCTION CONSTITUTION
## ClientsVia AI Receptionist System

**Version:** 1.0.0  
**Frozen Date:** December 18, 2025  
**Status:** LOCKED - Do not modify without version increment

---

## 🔒 NON-NEGOTIABLE RULES

1. **Every decision is scoped by `companyId`** - config, prompts, rules, scenarios, booking flows
2. **DISCOVERY = LLM allowed** (bounded by company tools + scenarios)
3. **BOOKING = Deterministic state machine** (LLM cannot invent booking prompts)
4. **LLM in BOOKING only for**: interrupt Q&A (answer question, then resume)

---

## 📋 CANONICAL SLOT SCHEMA (LOCKED)

```javascript
// This is the ONLY allowed structure for booking slots
// NO ALIASES. NO ALTERNATIVES. NO EXCEPTIONS.

session.booking = {
  consentGiven: Boolean,        // Hard gate for BOOKING mode
  consentPhrase: String,        // What phrase triggered consent
  consentTurn: Number,          // Which turn consent was given
  consentTimestamp: Date,
  
  activeSlot: String,           // Current slot being collected: 'name' | 'phone' | 'address' | 'time'
  
  slots: {
    name: {
      first: String | null,     // "John"
      last: String | null,      // "Smith"
      full: String | null       // "John Smith" (computed when both parts present)
    },
    phone: String | null,       // "555-123-4567"
    address: {
      full: String | null,      // "123 Main St, Anytown"
      street: String | null,    // "123 Main St"
      city: String | null,      // "Anytown"
      unit: String | null       // "Apt 2B"
    },
    time: {
      preference: String | null, // "ASAP" | "morning" | "afternoon" | "specific"
      window: String | null      // "8-10" | "10-12" | "2025-12-20 10:00"
    }
  },
  
  meta: {
    name: {
      lastConfirmed: Boolean,           // Did user confirm the partial name?
      askedMissingPartOnce: Boolean,    // Did we ask for missing part?
      assumedSingleTokenAs: String,     // "first" | "last" (heuristic)
      source: String                    // "user" | "assumed" | "confirmed"
    },
    phone: {
      usedCallerId: Boolean,
      confirmed: Boolean
    },
    address: {
      confirmed: Boolean
    },
    time: {
      isAsap: Boolean,
      confirmed: Boolean
    }
  }
};
```

---

## 📋 COMPANY CONFIG STRUCTURE (LOCKED)

```javascript
// frontDeskBehavior.bookingSlots[] - Array of slot configurations
// Each slot has these fields:

{
  id: String,           // 'name' | 'phone' | 'address' | 'time' | 'custom_*'
  label: String,        // "Full Name" (UI display)
  question: String,     // "May I have your name please?" (EXACT text AI says)
  required: Boolean,
  order: Number,
  type: String,         // 'name' | 'phone' | 'address' | 'time' | 'text' | 'select'
  
  // Confirmation
  confirmBack: Boolean,
  confirmPrompt: String, // "Got it, {value}. Did I get that right?"
  
  // Name-specific
  nameOptions: {
    askFullName: Boolean,           // Ask for first + last
    useFirstNameOnly: Boolean,      // Use first name when referring back
    askOnceForMissingPart: Boolean, // Ask for missing half once
    defaultAssumeSingleTokenAs: String // "first" | "last"
  },
  
  // Phone-specific
  offerCallerId: Boolean,
  callerIdPrompt: String,
  
  // Time-specific
  offerAsap: Boolean,
  offerMorningAfternoon: Boolean,
  asapPhrase: String
}
```

---

## 📋 DISCOVERY CONSENT CONFIG (LOCKED)

```javascript
// frontDeskBehavior.discoveryConsent

{
  // Kill Switches
  bookingRequiresExplicitConsent: Boolean, // Master gate
  forceLLMDiscovery: Boolean,              // LLM always speaks in discovery
  disableScenarioAutoResponses: Boolean,   // Scenarios are tools, not scripts
  
  // Consent Detection
  consentQuestionTemplate: String,  // "Would you like me to schedule an appointment?"
  consentYesWords: String[],        // ["yes", "yeah", "please", "sure"]
  consentRequiresYesAfterPrompt: Boolean,
  
  // Pre-consent Requirements
  minDiscoveryFieldsBeforeConsent: String[] // ["issueSummary"]
}
```

---

## 📋 VOCABULARY GUARDRAILS (LOCKED)

```javascript
// frontDeskBehavior.vocabularyGuardrails

{
  forbiddenWords: String[],     // ["technician"] for dental
  replacementMap: Object,       // { "technician": "team member" }
  allowedServiceNouns: String[] // ["appointment", "dentist"] for dental
}
```

---

## 🔄 STATE MACHINE TRANSITIONS (LOCKED)

```
┌─────────────┐
│  DISCOVERY  │ ← LLM speaks, scenarios as tools
└──────┬──────┘
       │ Explicit consent detected
       │ (consentYesWords + lastAgentIntent === OFFER_SCHEDULE)
       ▼
┌─────────────┐
│   BOOKING   │ ← Deterministic prompts ONLY
└──────┬──────┘
       │ All required slots collected
       ▼
┌─────────────┐
│  COMPLETE   │ ← Confirmation + handoff
└─────────────┘
```

### Mode Rules

| Mode | Who Speaks | LLM Allowed? | Source of Prompts |
|------|-----------|--------------|-------------------|
| DISCOVERY | LLM | Yes | LLM + Scenarios |
| BOOKING | BookingEngine | Only for interrupts | UI Config ONLY |
| COMPLETE | BookingEngine | No | UI Config ONLY |

---

## 📋 NAME SLOT STATE MACHINE (LOCKED)

```
┌─────────────────┐
│ No name yet     │
└────────┬────────┘
         │ User provides name
         ▼
┌─────────────────┐
│ Single token?   │──No──► Full name captured → Move to PHONE
└────────┬────────┘
         │ Yes (e.g., "Subach")
         ▼
┌─────────────────┐
│ Confirm back    │ "Got it, Subach. Did I get that right?"
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
   Yes       No
    │         │
    ▼         ▼
┌─────────┐ ┌─────────────┐
│ Ask     │ │ Reset state │
│ missing │ │ Re-ask name │
│ part    │ └─────────────┘
└────┬────┘
     │ User provides missing part
     ▼
┌─────────────────┐
│ Full name       │
│ captured        │ → Move to PHONE
└─────────────────┘
```

---

## 📋 INTERRUPT DETECTION RULES (LOCKED)

```javascript
// STRICT interrupt detection - DO NOT loosen these rules

function isInterruptQuestion(userText) {
  const text = userText.trim();
  const lower = text.toLowerCase();
  
  // Rule 1: Question mark = definitely a question
  const hasQuestionMark = text.endsWith('?');
  
  // Rule 2: Starts with question words (NOT "is" alone)
  const startsWithQuestionWord = /^(what|when|where|why|how|can you|could you|do you|does|are you|will you)\b/i.test(text);
  
  // Rule 3: Contains interrupt keywords
  const hasInterruptKeywords = /\b(soonest|earliest|available|price|cost|how much|warranty|hours|open|close)\b/i.test(lower);
  
  // Rule 4: EXCLUDE slot answers
  const looksLikeSlotAnswer = 
    /^(my name|name is|i'm|it's|call me|yes|yeah|no|nope)/i.test(text) ||
    /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(text) ||  // phone
    /^\d+\s+\w+/.test(text);                         // address
  
  return (hasQuestionMark || startsWithQuestionWord || hasInterruptKeywords) && !looksLikeSlotAnswer;
}
```

---

## 📋 CONSENT DETECTION RULES (LOCKED)

```javascript
// Context-aware consent - "yes" only triggers if lastAgentIntent === OFFER_SCHEDULE

function detectBookingConsent(userText, session) {
  const lower = userText.toLowerCase().trim();
  
  // Explicit booking phrases (always trigger)
  const explicitPhrases = [
    'schedule an appointment',
    'book an appointment',
    'send someone out',
    'need a technician',
    'come out today'
  ];
  
  for (const phrase of explicitPhrases) {
    if (lower.includes(phrase)) return { hasConsent: true, reason: 'explicit_phrase' };
  }
  
  // Yes words (only if last intent was OFFER_SCHEDULE)
  const yesWords = ['yes', 'yeah', 'yep', 'please', 'sure', 'okay', 'ok', 'sounds good', 'absolutely'];
  const lastWasOffer = session.lastAgentIntent === 'OFFER_SCHEDULE';
  
  if (lastWasOffer) {
    for (const word of yesWords) {
      if (lower.includes(word) && !lower.includes('no')) {
        return { hasConsent: true, reason: 'yes_after_offer' };
      }
    }
  }
  
  return { hasConsent: false };
}
```

---

## 📋 GOLDEN TEST TRANSCRIPT (MUST ALWAYS PASS)

```
Turn 1:
  User: "Hi I'm having air-conditioning issues today"
  Mode: DISCOVERY
  Slots: {}
  AI: [LLM responds empathetically, asks about issue]
  lastAgentIntent: DISCOVERY

Turn 2:
  User: "The thermostat is blank and there's water dripping"
  Mode: DISCOVERY
  Slots: {}
  AI: [LLM uses scenario knowledge, offers to schedule]
  lastAgentIntent: OFFER_SCHEDULE

Turn 3:
  User: "Yes please"
  Mode: BOOKING (transition!)
  Slots: {}
  AI: "Perfect! Let me get your information. May I have your name please?"
  lastAgentIntent: BOOKING_SLOT_QUESTION

Turn 4:
  User: "Subach"
  Mode: BOOKING
  Slots: { name: { last: "Subach" } }
  AI: "Got it, Subach. Did I get that right?"
  lastAgentIntent: BOOKING_SLOT_QUESTION

Turn 5:
  User: "yes"
  Mode: BOOKING
  Slots: { name: { last: "Subach" } }
  AI: "And what's your first name?"
  lastAgentIntent: BOOKING_SLOT_QUESTION

Turn 6:
  User: "John"
  Mode: BOOKING
  Slots: { name: { first: "John", last: "Subach", full: "John Subach" } }
  AI: "Perfect, John Subach. What's the best phone number to reach you?"
  lastAgentIntent: BOOKING_SLOT_QUESTION

Turn 7:
  User: "555-123-4567"
  Mode: BOOKING
  Slots: { name: {...}, phone: "555-123-4567" }
  AI: "Thank you. What's the service address?"
  lastAgentIntent: BOOKING_SLOT_QUESTION

Turn 8:
  User: "123 Main Street, Anytown"
  Mode: BOOKING
  Slots: { name: {...}, phone: "...", address: { full: "123 Main Street, Anytown" } }
  AI: "Perfect. When works best for you?"
  lastAgentIntent: BOOKING_SLOT_QUESTION

Turn 9:
  User: "As soon as possible"
  Mode: COMPLETE
  Slots: { name: {...}, phone: "...", address: {...}, time: { preference: "ASAP" } }
  AI: "Great! I have all your information. We'll get a technician out to you as soon as possible."
```

---

## 🚫 DO NOT VIOLATE

1. **Never use `time` and `timePreference` interchangeably** - Always use `time.preference`
2. **Never call LLM for booking prompts** - Use UI config ONLY
3. **Never skip consent detection** - Even for "obvious" booking intent
4. **Never hardcode trade-specific language** - Use vocabularyGuardrails
5. **Never re-ask a captured slot** - Check `slots` before asking
6. **Never assume "yes" means booking consent** - Check lastAgentIntent

---

## 📁 FILE RESPONSIBILITIES

| File | Responsibility |
|------|---------------|
| `ConversationEngine.js` | Mode routing, consent detection, session management |
| `BookingScriptEngine.js` | Slot extraction, booking config loading |
| `HybridReceptionistLLM.js` | LLM calls for discovery + interrupts |
| `ConversationStateMachine.js` | Legacy - DO NOT USE in BOOKING mode |
| `v2Company.js` | Schema definition (source of truth) |
| `ConversationSession.js` | Session schema with booking state |

---

## ✅ CHECKLIST FOR AI CODER

Before any code change:
- [ ] Does it respect the canonical slot schema?
- [ ] Does it check `session.mode` before deciding who speaks?
- [ ] Does it use UI config for booking prompts (not hardcoded)?
- [ ] Does it track `lastAgentIntent` after every response?
- [ ] Does it pass the golden test transcript?

---

**This document is the production constitution.**  
**Every company, every trade, every future engineer follows it.**

