# ClientsVia V22-V23 Complete Build Documentation

> **Status:** AUTHORITATIVE BUILD REFERENCE  
> **Version:** V23  
> **Date:** 2025-11-29  
> **Author:** AI Architect + Marc

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [V22 Core System](#3-v22-core-system)
4. [V23 Enhancements](#4-v23-enhancements)
5. [File Structure](#5-file-structure)
6. [Database Models](#6-database-models)
7. [API Endpoints](#7-api-endpoints)
8. [Call Flow](#8-call-flow)
9. [Configuration](#9-configuration)
10. [Operations Guide](#10-operations-guide)
11. [Frontend Integration](#11-frontend-integration)
12. [Testing](#12-testing)

---

## 1. Executive Summary

### What We Built

**V22** established the core AI brain architecture:
- 6 AI Brains working together (Brain-0 through Brain-5)
- 3-Tier Intelligence routing (Rule-based → Semantic → LLM)
- Memory and optimization systems
- Triage-based call routing

**V23** added multi-trade scalability:
- Trade-agnostic behavior engine
- Dynamic preset system for any industry
- Standard intent vocabulary
- Full CRUD for trades/presets (no code changes needed)

### Design Philosophy

```
┌─────────────────────────────────────────────────────────────────┐
│                    CORE PRINCIPLES                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. MULTI-TENANT: Every setting scoped by companyId              │
│  2. TRADE-AGNOSTIC: Same code works for HVAC, Dental, Accounting │
│  3. NO EXTERNAL LLM AT RUNTIME: 99% handled by rules             │
│  4. LLM-A FOR ADMIN ONLY: Generates content, never talks to users│
│  5. DATA-DRIVEN: Add trades/presets via API, not code            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Architecture Overview

### The 6 AI Brains

```
┌─────────────────────────────────────────────────────────────────┐
│                      V22 AI BRAIN SYSTEM                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  BRAIN-0: SmartCallFilter                                        │
│  └── Spam detection, wrong number handling                       │
│                                                                  │
│  BRAIN-1: Frontline-Intel + Triage                               │
│  └── Clean input, detect intent, apply quick rules               │
│                                                                  │
│  BRAIN-2: 3-Tier Router                                          │
│  └── Tier 1 (Rules) → Tier 2 (Semantic) → Tier 3 (LLM)          │
│                                                                  │
│  BRAIN-3: CheatSheet Engine                                      │
│  └── Edge cases, guardrails, transfer rules                      │
│                                                                  │
│  BRAIN-4: Memory Engine                                          │
│  └── Caller history, resolution paths                            │
│                                                                  │
│  BRAIN-5: Optimization Engine                                    │
│  └── Decides if LLM needed, caches responses                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### LLM Roles (Separation of Concerns)

| LLM Role | Purpose | When Used |
|----------|---------|-----------|
| **LLM-A** | Admin helpers - generates triage cards, scenarios | Admin UI only |
| **LLM-C** | Conversational styling | Runtime (if BehaviorEngine enabled) |
| **LLM-R** | Router fallback | Runtime (Tier 3 only, <1% of calls) |

---

## 3. V22 Core System

### 3.1 Triage System

**Purpose:** Fast, deterministic routing based on keywords

**Files:**
- `models/TriageCard.js` - MongoDB schema for triage rules
- `services/TriageService.js` - Runtime matching engine
- `services/TriageValidatorHelper.js` - Validation helpers

**How It Works:**
```
User says: "My AC is not cooling"
    ↓
TriageService.applyQuickTriageRules()
    ↓
Matches TriageCard with mustHaveKeywords: ["not cooling"]
    ↓
Returns: { intent: "SERVICE_REPAIR", action: "DIRECT_TO_3TIER" }
    ↓
Routes to appropriate 3-Tier scenario
```

### 3.2 Memory System

**Purpose:** Learn from successful calls, reduce LLM usage over time

**Files:**
- `models/memory/CallerIntentHistory.js` - Per-caller intent tracking
- `models/memory/IntentResolutionPath.js` - Successful resolution patterns
- `models/memory/ResponseCache.js` - Cached responses by normalized input
- `services/MemoryEngine.js` - Hydrates memory context
- `services/MemoryOptimizationEngine.js` - Decides if LLM needed
- `services/PostCallLearningService.js` - Updates memory after calls

**AI Maturity Levels:**
```javascript
aiMaturityLevel: 'LEARNING' | 'MATURE' | 'ULTRA_LEAN'

// LEARNING: Always use LLM for learning (new companies)
// MATURE: Use cache when confident (>100 successful calls)
// ULTRA_LEAN: Maximum caching, minimal LLM (<1% LLM usage)
```

### 3.3 Call Flow Execution

**Purpose:** Dynamic, configurable call processing pipeline

**Files:**
- `services/CallFlowExecutor.js` - Executes call flow steps
- `services/v2AIAgentRuntime.js` - Main orchestrator
- `config/defaultCallFlowConfig.js` - Default step configuration

**Flow:**
```
CallFlowExecutor.execute()
    ├── Step 1: frontlineIntel (clean input, detect intent)
    ├── Step 2: scenarioMatching (3-Tier routing)
    ├── Step 3: cheatSheetEngine (edge cases)
    ├── Step 4: behaviorEngine (V23 - tone styling)
    └── Return: { finalResponse, finalAction, metadata }
```

---

## 4. V23 Enhancements

### 4.1 Behavior Engine

**Purpose:** Trade-agnostic personality system that decides HOW the agent talks

**Files:**
- `services/BehaviorEngine.js` - Core tone decision engine
- `config/behaviorProfileTemplates.js` - Pre-built profiles by trade
- `models/schemas/behaviorProfileSchema.js` - Mongoose schema
- `scripts/seed-behavior-profiles.js` - Apply profiles to companies

**Tone Types:**
| Tone | When Used | Characteristics |
|------|-----------|-----------------|
| `EMERGENCY_SERIOUS` | Smoke, fire, bleeding | No humor, calm, direct |
| `CONFLICT_SERIOUS` | Billing disputes | No humor, empathetic |
| `LIGHT_PLAYFUL` | User is joking | One playful line allowed |
| `FRIENDLY_DIRECT` | Service repairs | Warm but efficient |
| `FRIENDLY_CASUAL` | Maintenance | Relaxed, approachable |
| `CONSULTATIVE` | Sales/estimates | Advisory, not pushy |
| `NEUTRAL` | Fallback | Clear, professional |

**Integration Point:**
```javascript
// In CallFlowExecutor.js, after CheatSheetEngine:
const { tone, styleInstructions } = BehaviorEngine.applyHybridStyle(context, response);
```

### 4.2 Standard Intent Vocabulary

**Purpose:** Trade-agnostic intents that work across all industries

**File:** `docs/STANDARD-INTENT-VOCABULARY.md`

**Standard Intents:**
| Intent | Description |
|--------|-------------|
| `SERVICE_REPAIR` | Something broken, needs fixing |
| `MAINTENANCE` | Routine preventive service |
| `NEW_SALES_ESTIMATE` | Quote for new service/equipment |
| `INSTALLATION` | Install new equipment |
| `BILLING_ISSUE` | Invoice questions, disputes |
| `SCHEDULING` | Reschedule, cancel, confirm |
| `GENERAL_QUESTION` | Info requests |
| `EMERGENCY` | Safety concern, urgent |
| `FOLLOWUP` | Callback about previous service |
| `WRONG_NUMBER` | Reached wrong business |
| `SOLICITATION` | Sales call, spam |
| `MESSAGE_ONLY` | Just wants to leave message |
| `UNKNOWN` | Can't determine, needs clarification |

### 4.3 Dynamic Triage Presets

**Purpose:** Add new trades/presets without code changes

**Files:**
- `routes/admin/triagePresets.js` - CRUD API
- `models/TriagePresetScenario.js` - Preset schema
- `models/TradeDefinition.js` - Trade schema
- `scripts/seed-triage-presets.js` - Initial data seeding

**Pre-built Trades:**
- HVAC (10 presets)
- PLUMBING (9 presets)
- DENTAL (9 presets)
- ACCOUNTING (7 presets)
- ELECTRICAL (8 presets)
- GENERAL (6 presets)

### 4.4 LLM-A Triage Architect

**Purpose:** Generate triage cards with guardrails and validation

**Files:**
- `services/LLMA_TriageCardGeneratorV23.js` - Generation with validation
- `services/TriageValidatorHelper.js` - Local matching simulation
- `routes/admin/triageBuilder.js` - Admin endpoints

**Contract:**
```
Admin Input → LLM-A → triageCardDraft + testPlan + validationReport
                              ↓
                    Admin reviews & approves
                              ↓
                    POST /save-draft-v23 → TriageCard in DB
```

---

## 5. File Structure

```
clientsvia-backend/
├── config/
│   ├── behaviorProfileTemplates.js    # V23: Trade behavior profiles
│   └── defaultCallFlowConfig.js       # Call flow step configuration
│
├── docs/
│   ├── V22-V23_Build.md               # This document
│   ├── STANDARD-INTENT-VOCABULARY.md  # V23: Intent definitions
│   ├── V23-LLM-A-TRIAGE-ARCHITECT-SPEC.md
│   ├── V23-MULTI-TRADE-TRIAGE-SPEC.md
│   └── SCENARIO-BLUEPRINT-AC-REPAIR.md
│
├── models/
│   ├── TriageCard.js                  # V22: Runtime triage rules
│   ├── TriagePresetScenario.js        # V23: Preset templates
│   ├── TradeDefinition.js             # V23: Trade definitions
│   ├── v2Company.js                   # Company with aiAgentSettings
│   ├── memory/
│   │   ├── CallerIntentHistory.js     # V22: Caller tracking
│   │   ├── IntentResolutionPath.js    # V22: Resolution patterns
│   │   └── ResponseCache.js           # V22: Response caching
│   └── schemas/
│       └── behaviorProfileSchema.js   # V23: Behavior profile schema
│
├── routes/
│   └── admin/
│       ├── triageBuilder.js           # LLM-A card generation
│       └── triagePresets.js           # V23: CRUD for trades/presets
│
├── scripts/
│   ├── seed-behavior-profiles.js      # V23: Apply behavior profiles
│   ├── seed-triage-presets.js         # V23: Seed preset scenarios
│   └── hvacLLMATestPack.js            # Test data for validation
│
├── services/
│   ├── BehaviorEngine.js              # V23: Tone decision engine
│   ├── CallFlowExecutor.js            # Dynamic call flow execution
│   ├── CheatSheetEngine.js            # Edge cases, guardrails
│   ├── FrontlineIntel.js              # Input cleaning, intent detection
│   ├── LLMA_TriageCardGeneratorV23.js # V23: Card generation with guardrails
│   ├── MemoryEngine.js                # V22: Memory hydration
│   ├── MemoryOptimizationEngine.js    # V22: LLM usage optimization
│   ├── PostCallLearningService.js     # V22: Post-call learning
│   ├── TriageService.js               # V22: Runtime triage matching
│   ├── TriageValidatorHelper.js       # V23: Validation helpers
│   └── v2AIAgentRuntime.js            # Main orchestrator
│
└── seeds/
    └── hvacTriageStarterPack.js       # HVAC starter cards
```

---

## 6. Database Models

### 6.1 TriageCard (Runtime Rules)

```javascript
{
  companyId: ObjectId,           // Multi-tenant isolation
  tradeKey: 'HVAC',              // Trade identifier
  active: true,                  // ON/OFF switch
  priority: 100,                 // Higher = matched first
  displayName: 'AC not cooling',
  triageLabel: 'HVAC_AC_NOT_COOLING',
  
  quickRuleConfig: {
    intent: 'SERVICE_REPAIR',    // Standard intent
    serviceType: 'REPAIR',
    action: 'DIRECT_TO_3TIER',   // What to do
    mustHaveKeywords: ['not cooling'],
    excludeKeywords: ['emergency', 'smoke']
  },
  
  threeTierLink: {
    categoryKey: 'COOLING_NO_COOL',
    scenarioKey: 'AC_NOT_COOLING'
  },
  
  stats: {
    uses: 0,
    successRate: 0,
    lastMatchedAt: Date
  }
}
```

### 6.2 TriagePresetScenario (Templates)

```javascript
{
  tradeKey: 'ACCOUNTING',
  presetKey: 'ACCT_TAX_RETURN',
  displayName: 'File tax return',
  description: 'Individual or business tax return filing',
  category: 'Tax Services',
  
  quickRuleSkeleton: {
    action: 'DIRECT_TO_3TIER',
    intent: 'NEW_SALES_ESTIMATE',
    serviceType: 'OTHER',
    priority: 100,
    keywordsMustHave: ['tax return'],
    keywordsExclude: []
  },
  
  samplePhrases: [
    'I need to file my taxes',
    'Looking for help with tax return'
  ],
  
  isActive: true,
  sortOrder: 1
}
```

### 6.3 Company.aiAgentSettings.behaviorProfile

```javascript
{
  mode: 'HYBRID',              // 'OFF' | 'HYBRID'
  humorLevel: 0.6,             // 0-1
  empathyLevel: 0.8,           // 0-1
  directnessLevel: 0.7,        // 0-1
  maxHumorPerReply: 1,
  allowSmallTalkSeconds: 15,
  safetyStrictness: 1.0,       // Always 1.0
  
  globalEmergencyKeywords: ['burning smell', 'smoke', 'fire', ...],
  globalBillingConflictKeywords: ['you charged', 'refund', 'dispute', ...],
  globalJokePatterns: ['lol', 'haha', "i'm dying here", ...],
  
  tradeOverrides: {
    HVAC: {
      emergencyKeywords: ['ac is smoking', 'smoke from vent', ...],
      jokePatterns: ['house is an oven', "i'm melting", ...]
    }
  }
}
```

---

## 7. API Endpoints

### 7.1 Triage Presets (Dynamic Trade/Preset Management)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/triage-presets/trades` | List all trades |
| POST | `/api/admin/triage-presets/trade` | Create/update trade |
| DELETE | `/api/admin/triage-presets/trade/:tradeKey` | Delete trade + presets |
| GET | `/api/admin/triage-presets/:tradeKey` | Get presets for trade |
| GET | `/api/admin/triage-presets/:tradeKey/:presetKey` | Get preset details |
| POST | `/api/admin/triage-presets/preset` | Create/update preset |
| PUT | `/api/admin/triage-presets/preset/:id` | Update preset |
| DELETE | `/api/admin/triage-presets/preset/:id` | Delete preset |
| POST | `/api/admin/triage-presets/clone` | Clone preset to company |

### 7.2 Triage Builder (LLM-A)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/triage-builder/generate-card-v23` | Generate card draft |
| POST | `/api/admin/triage-builder/save-draft-v23` | Save approved draft |
| POST | `/api/admin/triage-builder/validate-utterances` | Test keywords |
| POST | `/api/admin/triage-builder/test-rules` | Test matching |

### 7.3 Company Configuration

| Method | Endpoint | Description |
|--------|----------|-------------|
| PATCH | `/api/company/:companyId` | Update aiAgentSettings |
| GET | `/api/company/:companyId` | Get company with settings |

---

## 8. Call Flow

### Complete V23 Call Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    V23 CALL PROCESSING FLOW                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. TWILIO WEBHOOK                                               │
│     POST /api/twilio/gather/:companyId                           │
│     └── Raw speech input from caller                             │
│                                                                  │
│  2. v2AIAgentRuntime.processUserInput()                          │
│     ├── Load company settings                                    │
│     ├── Initialize execution context                             │
│     └── Call CallFlowExecutor.execute()                          │
│                                                                  │
│  3. CallFlowExecutor (Dynamic Steps)                             │
│     │                                                            │
│     ├── STEP 1: FrontlineIntel                                   │
│     │   ├── Clean input (remove fillers)                         │
│     │   ├── Detect intent                                        │
│     │   └── Apply TriageService.applyQuickTriageRules()          │
│     │       └── Match against TriageCards by keywords            │
│     │                                                            │
│     ├── STEP 2: Scenario Matching (3-Tier)                       │
│     │   ├── Tier 1: Rule-based matching (FREE)                   │
│     │   ├── Tier 2: Semantic similarity (FREE)                   │
│     │   └── Tier 3: LLM fallback (<1% of calls, PAID)            │
│     │                                                            │
│     ├── STEP 3: CheatSheetEngine                                 │
│     │   ├── Apply edge case rules                                │
│     │   ├── Check transfer conditions                            │
│     │   └── Apply guardrails                                     │
│     │                                                            │
│     └── STEP 4: BehaviorEngine (V23)                             │
│         ├── detectSignals() - emergency? billing? joking?        │
│         ├── decideTone() - EMERGENCY_SERIOUS, FRIENDLY_DIRECT    │
│         └── buildStyleInstructions() - rules for LLM-C           │
│                                                                  │
│  4. Response Generation                                          │
│     ├── finalResponse from scenario template                     │
│     ├── (Optional) LLM-C styling with styleInstructions          │
│     └── TTS via ElevenLabs                                       │
│                                                                  │
│  5. PostCallLearningService                                      │
│     ├── Update CallerIntentHistory                               │
│     ├── Update IntentResolutionPath                              │
│     └── Update ResponseCache                                     │
│                                                                  │
│  6. Return TwiML to Twilio                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Action Flow

```
TriageDecision.action determines behavior:

DIRECT_TO_3TIER      → Route to scenario matching, continue conversation
EXPLAIN_AND_PUSH     → Explain then route to booking
ESCALATE_TO_HUMAN    → Immediate transfer to human
TAKE_MESSAGE         → Collect name/number for callback
END_CALL_POLITE      → Thank and hang up
```

---

## 9. Configuration

### 9.1 Company Setup

To enable V23 features for a company:

```javascript
// In company.aiAgentSettings:
{
  enabled: true,
  
  // Trade identification
  trade: 'HVAC',
  
  // Region profile (for LLM-A guardrails)
  regionProfile: {
    climate: 'HOT_ONLY',  // 'HOT_ONLY' | 'COLD_ONLY' | 'MIXED'
    supportsHeating: false,
    supportsCooling: true
  },
  
  // V23 Behavior Profile
  behaviorProfile: {
    mode: 'HYBRID',
    humorLevel: 0.6,
    empathyLevel: 0.8,
    directnessLevel: 0.7,
    // ... (see section 6.3)
  },
  
  // V22 Memory/Optimization
  aiMaturityLevel: 'LEARNING',  // 'LEARNING' | 'MATURE' | 'ULTRA_LEAN'
  optimizationStats: {
    last30Days: {
      llmUsageRate: 0.05,
      cacheHitRate: 0.85,
      successRate: 0.92
    }
  }
}
```

### 9.2 Environment Variables

```env
# Database
MONGODB_URI=mongodb+srv://...
REDIS_URL=redis://...

# Twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...

# ElevenLabs TTS
ELEVENLABS_API_KEY=...

# OpenAI (for LLM-R Tier 3 fallback)
OPENAI_API_KEY=...

# Server
NODE_ENV=production
PORT=10000
```

---

## 10. Operations Guide

### 10.1 Initial Setup (New Deployment)

```bash
# 1. Seed triage presets (runs once)
node scripts/seed-triage-presets.js

# 2. Apply behavior profiles to companies
node scripts/seed-behavior-profiles.js --company=COMPANY_ID --trade=HVAC
```

### 10.2 Adding a New Trade

**Option A: Via API (Recommended)**
```bash
# Create the trade
curl -X POST /api/admin/triage-presets/trade \
  -H "Content-Type: application/json" \
  -d '{
    "tradeKey": "VETERINARY",
    "displayName": "Veterinary / Animal Hospital",
    "icon": "🐕"
  }'

# Add presets
curl -X POST /api/admin/triage-presets/preset \
  -H "Content-Type: application/json" \
  -d '{
    "tradeKey": "VETERINARY",
    "presetKey": "VET_SICK_PET",
    "displayName": "Sick pet",
    "category": "Appointments",
    "quickRuleSkeleton": {
      "action": "DIRECT_TO_3TIER",
      "intent": "SERVICE_REPAIR",
      "keywordsMustHave": ["sick", "pet"]
    }
  }'
```

**Option B: Via Seed Script**
```javascript
// Add to scripts/seed-triage-presets.js:
const VETERINARY_PRESETS = [
  {
    tradeKey: 'VETERINARY',
    presetKey: 'VET_SICK_PET',
    // ...
  }
];

// Run: node scripts/seed-triage-presets.js --trade=VETERINARY
```

### 10.3 Applying Behavior Profile to Company

```bash
# List companies
node scripts/seed-behavior-profiles.js

# Apply HVAC profile
node scripts/seed-behavior-profiles.js --company=68e3f77a9d623b8058c700c4 --trade=HVAC

# Preview without saving
node scripts/seed-behavior-profiles.js --company=ID --trade=HVAC --dry-run
```

### 10.4 Testing Triage Rules

```bash
# Via API
curl -X POST /api/admin/triage-builder/test-rules \
  -H "Content-Type: application/json" \
  -d '{
    "companyId": "68e3f77a9d623b8058c700c4",
    "utterance": "My AC is not cooling"
  }'
```

### 10.5 Monitoring

**Key Logs to Watch:**
```
[TRIAGE]      - Triage matching results
[BEHAVIOR]    - Tone decisions
[3TIER]       - Tier routing
[CHEATSHEET]  - Edge case handling
[MEMORY]      - Cache hits/misses
```

---

## 11. Frontend Integration

### 11.1 Trade/Preset Dropdown (LLM-A Builder)

```javascript
// When page loads, fetch available trades
const trades = await fetch('/api/admin/triage-presets/trades').then(r => r.json());

// Populate Trade dropdown
trades.forEach(t => {
  addOption(tradeDropdown, t.tradeKey, t.displayName, t.icon);
});

// When trade changes, fetch presets
tradeDropdown.onChange = async (tradeKey) => {
  const data = await fetch(`/api/admin/triage-presets/${tradeKey}`).then(r => r.json());
  
  // Clear and populate Quick Preset dropdown
  presetDropdown.clear();
  data.categories.forEach(cat => {
    addOptGroup(presetDropdown, cat.category);
    cat.presets.forEach(p => {
      addOption(presetDropdown, p.presetKey, p.displayName);
    });
  });
};
```

### 11.2 Behavior Profile Editor

```javascript
// Fetch current profile
const company = await fetch(`/api/company/${companyId}`).then(r => r.json());
const profile = company.aiAgentSettings.behaviorProfile;

// Display in UI
modeDropdown.value = profile.mode;  // OFF | HYBRID
humorSlider.value = profile.humorLevel;
empathySlider.value = profile.empathyLevel;
// ...

// Save changes
saveButton.onClick = async () => {
  await fetch(`/api/company/${companyId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      aiAgentSettings: {
        behaviorProfile: {
          mode: modeDropdown.value,
          humorLevel: humorSlider.value,
          // ...
        }
      }
    })
  });
};
```

---

## 12. Testing

### 12.1 Unit Testing Triage

```javascript
// Test utterance matching
const { simulateTriageMatch } = require('./services/TriageValidatorHelper');

const must = ['not cooling'];
const exclude = ['emergency'];

expect(simulateTriageMatch('my ac is not cooling', must, exclude)).toBe(true);
expect(simulateTriageMatch('emergency my ac is not cooling', must, exclude)).toBe(false);
```

### 12.2 Behavior Engine Testing

```javascript
const { detectSignals, decideTone } = require('./services/BehaviorEngine');

// Test emergency detection
const signals = detectSignals('smoke coming from my vents', behaviorConfig);
expect(signals.hasEmergency).toBe(true);

// Test tone decision
const tone = decideTone(context, signals, behaviorConfig);
expect(tone).toBe('EMERGENCY_SERIOUS');
```

### 12.3 Live Call Testing

```bash
# Call the test number
# Say various phrases and watch logs:

# Test 1: Normal repair
"My AC is not cooling"
→ Expect: FRIENDLY_DIRECT tone, DIRECT_TO_3TIER action

# Test 2: Emergency
"Smoke coming from my vents"
→ Expect: EMERGENCY_SERIOUS tone, ESCALATE_TO_HUMAN action

# Test 3: Billing dispute
"You charged me twice"
→ Expect: CONFLICT_SERIOUS tone, ESCALATE_TO_HUMAN action

# Test 4: User joking
"My AC is dead lol"
→ Expect: LIGHT_PLAYFUL tone (if humorLevel > 0.3)
```

---

## Summary

**V22 Delivered:**
- Complete AI brain architecture
- 3-tier intelligence routing
- Memory and optimization systems
- Triage-based call routing

**V23 Added:**
- Trade-agnostic behavior engine
- Standard intent vocabulary
- Dynamic preset system (no code changes)
- Full CRUD for trades/presets
- Region-aware guardrails

**Result:**
A multi-tenant, multi-trade AI receptionist platform where:
- 99% of calls handled by free, deterministic rules
- <1% fall back to paid LLM
- New trades added via API, not code
- Same codebase works for HVAC, Dental, Accounting, anything

---

*Document maintained by AI Architect. Last updated: 2025-11-29*

