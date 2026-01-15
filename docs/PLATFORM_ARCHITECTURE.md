# ClientsVia Platform Architecture - Complete Wiring Guide

## Executive Summary

This document maps how configuration flows from **UI → Database → Runtime → Response**.

---

## 🔴 CRITICAL ISSUES IDENTIFIED (Jan 5, 2026)

### Issue 1: Greeting Intercept Bug
- **UI Shows**: "good morning" → "Good morning! How can I help you today?"
- **Runtime Does**: Skips greeting intercept, says "connection was rough"
- **Root Cause**: V34 logic treats ANY `providedSessionId` as "existing session"
- **Bug Location**: `ConversationEngine.js` line ~1760-1771

### Issue 2: Redis Cache Stale Data
- **Symptom**: `scenarioCount: 0` at runtime, but diagnostic shows 71
- **Root Cause**: Redis cached empty result BEFORE templateReferences were added
- **Cache TTL**: 5 minutes (300 seconds)
- **Fix**: Clear Redis cache or wait for TTL expiry

### Issue 3: Booking Slots Not Recognized
- **UI Shows**: 7 booking slots configured
- **Runtime Shows**: `bookingConfig.isConfigured: false`
- **Root Cause**: Slots have `hasQuestion: false` - missing required `question` field

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CONTROL PLANE UI                                       │
│  (public/control-plane-v2.html, public/js/ai-agent-settings/*.js)               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ Personality  │  │ Discovery &  │  │   Booking    │  │    Dynamic Flows     │ │
│  │  Tab         │  │  Consent     │  │   Prompts    │  │                      │ │
│  │              │  │  Tab         │  │   Tab        │  │   (DynamicFlow       │ │
│  │ • AI Name    │  │              │  │              │  │    collection)       │ │
│  │ • Greetings  │  │ • Kill       │  │ • Slot       │  │                      │ │
│  │ • Tone       │  │   Switches   │  │   Config     │  │ • Emergency Detection│ │
│  └──────┬───────┘  │ • Consent    │  │ • Questions  │  │ • Booking Intent     │ │
│         │          │   Words      │  │ • Validation │  │ • After Hours        │ │
│         │          └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘ │
│         │                 │                 │                     │             │
└─────────┼─────────────────┼─────────────────┼─────────────────────┼─────────────┘
          │                 │                 │                     │
          ▼                 ▼                 ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              MONGODB                                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │                     Company (v2Company collection)                          ││
│  │                                                                             ││
│  │  aiAgentSettings: {                                                         ││
│  │    frontDeskBehavior: {                                                     ││
│  │      greeting: { text, enabled }           ← Personality Tab                ││
│  │      greetingResponses: [                  ← Personality Tab (instant)      ││
│  │        { trigger, response, matchType }                                     ││
│  │      ]                                                                      ││
│  │      conversationStyle: "balanced"         ← Personality Tab                ││
│  │      personality: { level, empathy }       ← Personality Tab                ││
│  │      discoveryConsent: {                   ← Discovery & Consent Tab        ││
│  │        forceLLMDiscovery: true/false                                        ││
│  │        disableScenarioAutoResponses: true/false                             ││
│  │        autoReplyAllowedScenarioTypes: []                                    ││
│  │        bookingRequiresExplicitConsent: true/false                           ││
│  │      }                                                                      ││
│  │      bookingSlots: [                       ← Booking Prompts Tab            ││
│  │        { id, type, question, required }    ⚠️ BROKEN: question missing!     ││
│  │      ]                                                                      ││
│  │    }                                                                        ││
│  │    templateReferences: [                   ← Template references (manual)  ││
│  │      { templateId, enabled, priority }     ⚠️ CACHING ISSUE!                ││
│  │    ]                                                                        ││
│  │  }                                                                          ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │              GlobalInstantResponseTemplate collection                        ││
│  │                                                                             ││
│  │  _id: 68fb535130d19aec696d8123  (HVAC Trade Knowledge Template V1.1)        ││
│  │  categories: [                                                              ││
│  │    { categoryId, name, scenarios: [                                         ││
│  │      { scenarioId, name, scenarioType, triggers, negatives,                 ││
│  │        quickReplies, fullReplies }                                          ││
│  │    ]}                                                                       ││
│  │  ]                                                                          ││
│  │  Total: 71 scenarios across 33 categories                                   ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │                    DynamicFlow collection                                    ││
│  │                                                                             ││
│  │  Templates (isTemplate: true, companyId: null):                             ││
│  │    • emergency_detection                                                    ││
│  │    • booking_intent                                                         ││
│  │    • after_hours_routing                                                    ││
│  │    • technician_request                                                     ││
│  │                                                                             ││
│  │  Company Flows (isTemplate: false, companyId: <id>):                        ││
│  │    • Copied from templates via "Copy Templates to Company"                  ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
          │
          │ Company.findById() + ScenarioPoolService.getScenarioPoolForCompany()
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              REDIS CACHE                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Key: "scenario-pool:{companyId}"                                               │
│  TTL: 300 seconds (5 minutes)                                                   │
│  Value: { scenarios: [...], templatesUsed: [...], effectiveConfigVersion }      │
│                                                                                  │
│  ⚠️ PROBLEM: Caches empty result, doesn't auto-invalidate on config change     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
          │
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CONVERSATION ENGINE                                      │
│                    (services/ConversationEngine.js)                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  processTurn() - THE SINGLE ENTRY POINT FOR ALL CHANNELS                        │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                  │
│  CHECKPOINT 1: Start                                                            │
│       │                                                                         │
│       ▼                                                                         │
│  CHECKPOINT 2: Load company from MongoDB                                        │
│       │         • Company.findById(companyId)                                   │
│       │         • Also loads CheatSheets, Template                              │
│       ▼                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  GREETING INTERCEPT (0 tokens)                                          │   │
│  │  ─────────────────────────────────────────────────────────────────────  │   │
│  │  BEFORE session is created!                                             │   │
│  │                                                                         │   │
│  │  Checks: company.aiAgentSettings.frontDeskBehavior.greetingResponses    │   │
│  │                                                                         │   │
│  │  ⚠️ BUG: V34 logic skips if ANY providedSessionId exists               │   │
│  │          Even "fresh-*" IDs are treated as "existing session"           │   │
│  │                                                                         │   │
│  │  Code location: lines 1760-1778                                         │   │
│  │                                                                         │   │
│  │  if (shouldTreatAsTimePreference) {                                     │   │
│  │    log('🕐 V34: Ambiguous word in existing session, skipping...')       │   │
│  │  }                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│       │                                                                         │
│       ▼                                                                         │
│  CHECKPOINT 3: Customer lookup                                                  │
│       │                                                                         │
│       ▼                                                                         │
│  CHECKPOINT 4: Session management                                               │
│       │         • Get or create session                                         │
│       │         • Load locks, memory, phase                                     │
│       ▼                                                                         │
│  CHECKPOINT 5-7: Build context                                                  │
│       │         • Customer context                                              │
│       │         • Running summary                                               │
│       │         • History                                                       │
│       ▼                                                                         │
│  CHECKPOINT 8: Slot extraction                                                  │
│       │         • Programmatic extraction (name, phone, address, time)          │
│       │         • Uses company.aiAgentSettings.frontDeskBehavior.bookingSlots   │
│       │         ⚠️ BUG: Slots missing "question" field → isConfigured: false    │
│       ▼                                                                         │
│  CHECKPOINT 9: Mode Control (DISCOVERY vs BOOKING)                              │
│       │                                                                         │
│       ├───► BOOKING MODE (consent given, deterministic)                         │
│       │     • BookingStateMachine handles slot collection                       │
│       │                                                                         │
│       └───► DISCOVERY MODE (LLM-led)                                            │
│             │                                                                   │
│             ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  SCENARIO RETRIEVAL                                                     │   │
│  │  ─────────────────────────────────────────────────────────────────────  │   │
│  │                                                                         │   │
│  │  1. Read company.aiAgentSettings.templateReferences                     │   │
│  │  2. Call ScenarioPoolService.getScenarioPoolForCompany()                │   │
│  │     → Checks Redis cache first (key: "scenario-pool:{companyId}")       │   │
│  │     → If cache miss, loads from MongoDB                                 │   │
│  │     → Caches result for 5 minutes                                       │   │
│  │                                                                         │   │
│  │  ⚠️ BUG: Cached empty result from BEFORE templateReferences existed    │   │
│  │          effectiveConfigVersion: null (should be hash)                  │   │
│  │                                                                         │   │
│  │  3. Call LLMDiscoveryEngine.retrieveRelevantScenarios()                 │   │
│  │  4. HybridScenarioSelector.findBestMatch() for utterance                │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│             │                                                                   │
│             ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  LLM CALL (HybridReceptionistLLM)                                       │   │
│  │  ─────────────────────────────────────────────────────────────────────  │   │
│  │                                                                         │   │
│  │  Builds prompt with:                                                    │   │
│  │  • Company greeting/tone from frontDeskBehavior                         │   │
│  │  • Scenario knowledge as tools (if any retrieved)                       │   │
│  │  • Emotion detection result                                             │   │
│  │  • State summary (to prevent repetition)                                │   │
│  │                                                                         │   │
│  │  ⚠️ ISSUE: If scenarioCount=0, LLM has no knowledge base               │   │
│  │            Falls back to generic responses                              │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│             │                                                                   │
│             ▼                                                                   │
│  CHECKPOINT 10: Update session                                                  │
│       │         • Save locks, memory                                            │
│       │         • Log to BlackBox                                               │
│       ▼                                                                         │
│  RETURN RESPONSE                                                                │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Tab-by-Tab Configuration Mapping

### 🎭 Personality Tab
| UI Field | Database Path | Runtime Usage |
|----------|--------------|---------------|
| AI Receptionist Name | `aiAgentSettings.aiName` | Included in LLM system prompt |
| Greeting Responses | `aiAgentSettings.frontDeskBehavior.greetingResponses[]` | **CHECKPOINT 2.7** - Instant intercept (0 tokens) |
| Conversation Style | `aiAgentSettings.frontDeskBehavior.conversationStyle` | LLM prompt tone |
| Professionalism Level | `aiAgentSettings.frontDeskBehavior.personality.professionalismLevel` | LLM prompt |
| Empathy Level | `aiAgentSettings.frontDeskBehavior.personality.empathyLevel` | LLM prompt |

**⚠️ BROKEN**: Greeting responses are being skipped due to V34 bug

---

### 🎯 Discovery & Consent Tab
| UI Field | Database Path | Runtime Usage |
|----------|--------------|---------------|
| Force LLM Discovery | `aiAgentSettings.frontDeskBehavior.discoveryConsent.forceLLMDiscovery` | Kill switch - LLM always speaks |
| Disable Scenario Auto-Responses | `aiAgentSettings.frontDeskBehavior.discoveryConsent.disableScenarioAutoResponses` | Scenarios as context only |
| Auto-Reply Allowed Types | `aiAgentSettings.frontDeskBehavior.discoveryConsent.autoReplyAllowedScenarioTypes` | `['FAQ','TROUBLESHOOT','EMERGENCY']` can auto-respond |
| Booking Requires Consent | `aiAgentSettings.frontDeskBehavior.discoveryConsent.bookingRequiresExplicitConsent` | Must detect "yes" before booking |
| Consent Yes Words | `aiAgentSettings.frontDeskBehavior.discoveryConsent.consentYesWords` | Words that trigger consent |

**STATUS**: Working correctly (kill switches loading properly)

---

### 📋 Booking Prompts Tab
| UI Field | Database Path | Runtime Usage |
|----------|--------------|---------------|
| Booking Slots | `aiAgentSettings.frontDeskBehavior.bookingSlots[]` | Slot collection sequence |
| Slot.id | `bookingSlots[].id` | Slot identifier |
| Slot.question | `bookingSlots[].question` | **REQUIRED** - What AI asks |
| Slot.type | `bookingSlots[].type` | name/phone/address/datetime |
| Slot.required | `bookingSlots[].required` | Must collect before booking |
| Slot.confirmBack | `bookingSlots[].confirmBack` | Repeat back to confirm |

**⚠️ BROKEN**: Slots have `hasQuestion: false` in debug log. The `question` field is missing or named differently (maybe `prompt` instead of `question`).

---

### 🔄 Dynamic Flows Tab
| Feature | Database Collection | Runtime Usage |
|---------|-------------------|---------------|
| Flow Templates | `DynamicFlow` (isTemplate: true) | Blueprints - not executed directly |
| Company Flows | `DynamicFlow` (isTemplate: false, companyId: X) | Actually executed at runtime |
| Emergency Detection | `DynamicFlow.flowKey: 'emergency_detection'` | CHECKPOINT 3 - Dynamic Flow Engine |
| Booking Intent | `DynamicFlow.flowKey: 'booking_intent'` | Detects scheduling requests |

**STATUS**: `triggersEvaluated: 0` suggests no company flows exist (only templates)

---

## Data Flow: Config Change → Runtime

```
User saves in UI
      │
      ▼
POST /api/admin/front-desk-behavior/{companyId}
      │
      ▼
Updates Company document in MongoDB
      │
      ▼
⚠️ Redis cache NOT invalidated automatically!
      │
      ▼
Runtime still uses cached (stale) scenario pool
      │
      ▼
Must wait 5 minutes OR manually clear cache
```

---

## Fix Checklist

### 1. Greeting Intercept Bug (HIGH PRIORITY)
**File**: `services/ConversationEngine.js` ~line 1760

**Current (BROKEN)**:
```javascript
const hasExistingSession = !!providedSessionId;
```

**Fixed**:
```javascript
// "fresh-*" IDs indicate new sessions from chat widget
const hasExistingSession = !!providedSessionId && !providedSessionId.startsWith('fresh-');
```

### 2. Redis Cache Staleness (HIGH PRIORITY)
**Options**:
A. Clear cache manually: `redis-cli DEL "scenario-pool:68e3f77a9d623b8058c700c4"`
B. Add cache invalidation on config save
C. Reduce TTL from 300s to 60s

### 3. Booking Slots Question Field (MEDIUM PRIORITY)
**Check**: Does schema expect `question` or `prompt`?
**File**: `models/v2Company.js` - bookingSlots schema

## API Endpoints Reference

| Endpoint | Purpose | UI Location |
|----------|---------|-------------|
| `GET /api/company/:id` | Load company config | All tabs |
| `PATCH /api/admin/front-desk-behavior/:id` | Save Front Desk config | Personality, Discovery tabs |
| `GET /api/company/:id/runtime-truth` | Get runtime config | Data & Config → Runtime Truth |
| `GET /api/trade-knowledge/templates/:id/quality-report` | Scenario quality | Golden Autofill |

---

## Black Box Logging

Every turn is logged to `V22BlackBox` collection:

```javascript
{
  companyId, sessionId, turn, timestamp,
  mode: "DISCOVERY" | "BOOKING",
  consentDetected, consentPhrase, consentGiven,
  scenariosRetrieved: [...],
  scenarioCount,
  cheatSheetUsed,
  killSwitches: {...},
  latencyMs, tokensUsed,
  userInput, aiResponsePreview
}
```

---

## Summary: What's Wired vs What's Broken

| Component | Wired? | Status |
|-----------|--------|--------|
| Company Loading | ✅ | Working |
| Cheat Sheets | ✅ | Working |
| Template Reference | ✅ | In DB, but cached stale |
| Greeting Intercept | ❌ | **BUG: V34 skipping** |
| Scenario Retrieval | ⚠️ | **Redis cache returning 0** |
| Booking Slots | ⚠️ | **Missing question field** |
| Dynamic Flows | ⚠️ | **Templates exist but not copied to company** |
| Kill Switches | ✅ | Working |
| LLM Call | ✅ | Working (but no scenarios) |
| Black Box Logging | ✅ | Working |

---

## Recommended Action Plan

1. **IMMEDIATE**: Fix V34 greeting intercept bug
2. **IMMEDIATE**: Clear Redis cache
3. **TODAY**: Fix booking slots schema (question field)
4. **TODAY**: Copy dynamic flow templates to Penguin Air
5. **THIS WEEK**: Add cache invalidation on config save

