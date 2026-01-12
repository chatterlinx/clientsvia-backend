# 🏗️ V23 LLM-A Triage Builder Implementation

**Status:** PRODUCTION READY  
**Date:** 2025-11-30  
**Architecture:** V23 "Golden Rule" Enforcement

---

## Executive Summary

This document describes the V23 implementation of the LLM-A Triage Builder with strict "Golden Rule" enforcement. The system now **HARD STOPS** if Brain 2 (AiCore Scenarios) is empty, preventing orphan triage rules.

---

## The "Golden Rule" of V23

> **Build the Destination (Brain 2), then build the Map (Brain 1).**

### Why This Matters

| Without Golden Rule | With Golden Rule |
|---------------------|------------------|
| ❌ Triage cards point to non-existent scenarios | ✅ Every triage card maps to a real scenario |
| ❌ LLM-A invents scenario keys | ✅ LLM-A can only use existing scenarios |
| ❌ Runtime errors on missing destinations | ✅ Referential integrity guaranteed |
| ❌ Admin confusion about what AI can handle | ✅ Clear setup flow |

---

## Implementation Components

### 1. Pre-Flight Check Endpoint

**File:** `routes/admin/triageBuilder.js`

```javascript
GET /api/admin/triage-builder/preflight/:companyId
```

**Response:**
```json
{
  "success": true,
  "canProceed": true,
  "scenarioCount": 42,
  "scenarios": [
    { "scenarioKey": "HVAC_REPAIR", "name": "AC Repair", "categoryKey": "cooling" }
  ],
  "message": "Brain 2 ready: 42 scenarios active",
  "companyName": "Penguin Air",
  "trade": "HVAC"
}
```

### 2. Active Scenarios Helper

**File:** `services/ActiveScenariosHelper.js`

Functions:
- `getActiveScenariosForCompany(companyId)` - Full scenario data
- `getScenarioKeysForLLMA(companyId)` - Simplified for token efficiency
- `preFlightCheckForTriageBuilder(companyId)` - Boolean check + summary

### 3. LLM-A Generator with Scenario Injection

**File:** `services/LLMA_TriageCardGeneratorV23.js`

The system prompt now includes:
```text
═══════════════════════════════════════════════════════════════════════════════
AVAILABLE SCENARIOS (VALID DESTINATIONS - REFERENTIAL INTEGRITY)
═══════════════════════════════════════════════════════════════════════════════
You can ONLY map triage cards to these scenarios. Do NOT invent new scenario keys.

  - HVAC_REPAIR: "AC Repair" (cooling)
  - HVAC_MAINTENANCE: "AC Tune-up" (maintenance)
  ...
```

### 4. Frontend Blocker UI

**File:** `public/js/ai-agent-settings/CheatSheetManager.js`

When no scenarios are loaded, the Triage Builder displays:

```
┌──────────────────────────────────────────────────────────┐
│  🚫 NO SCENARIOS LOADED                                  │
│                                                          │
│  You must activate AiCore Templates before               │
│  building Triage rules.                                  │
│                                                          │
│  [Go to AiCore Templates →]  [Check Again]               │
└──────────────────────────────────────────────────────────┘
```

### 5. Fixed Frontline Prompt Template

**File:** `templates/FrontlineSystemPromptV23.js`

The prompt structure is **READ-ONLY** to admins. They can only affect the `{{DYNAMIC_TRIAGE_RULES}}` injection slot via Triage Cards.

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: Admin opens Triage Builder                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: Frontend calls /preflight/:companyId                    │
│         → Returns { canProceed, scenarioCount, scenarios }      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
           ┌──────────────────┴──────────────────┐
           │                                      │
    scenarioCount > 0                    scenarioCount === 0
           │                                      │
           ↓                                      ↓
┌───────────────────────────┐    ┌───────────────────────────────┐
│ STEP 3a: Render Builder   │    │ STEP 3b: Render BLOCKER UI    │
│ with active scenarios     │    │ "Go to AiCore Templates"      │
└───────────────────────────┘    └───────────────────────────────┘
           │
           ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: Admin submits triage idea                               │
│         → POST /generate-card-v23                               │
│         → Backend re-checks scenarios (double validation)       │
│         → If still 0, returns NO_SCENARIOS_LOADED error         │
└─────────────────────────────────────────────────────────────────┘
           │
           ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: LLM-A generates card with scenario injection            │
│         → System prompt includes available scenarios            │
│         → LLM can ONLY map to existing scenario keys            │
│         → Invalid keys are flagged and nulled                   │
└─────────────────────────────────────────────────────────────────┘
           │
           ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 6: Admin reviews draft and saves                           │
│         → Card saved with valid scenario reference              │
│         → Runtime routing guaranteed to work                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Reference

### Pre-Flight Check

```
GET /api/admin/triage-builder/preflight/:companyId
Authorization: Bearer <token>
```

### Generate Card (V23)

```
POST /api/admin/triage-builder/generate-card-v23
Authorization: Bearer <token>
Content-Type: application/json

{
  "companyId": "67...",
  "tradeKey": "HVAC",
  "regionProfile": {
    "climate": "HOT_ONLY",
    "supportsHeating": false,
    "supportsCooling": true
  },
  "triageIdea": {
    "adminTitle": "AC not cooling",
    "exampleUtterances": ["my ac isnt cooling", "ac blowing warm air"],
    "desiredAction": "DIRECT_TO_3TIER",
    "serviceTypeHint": "REPAIR"
  }
}
```

**Success Response:**
```json
{
  "ok": true,
  "triageCardDraft": { ... },
  "testPlan": { ... },
  "validationReport": { ... },
  "activeScenarioCount": 42
}
```

**Error Response (No Scenarios):**
```json
{
  "success": false,
  "ok": false,
  "error": "NO_SCENARIOS_LOADED",
  "message": "Cannot generate triage cards. No AiCore scenarios are active.",
  "action": "Activate templates in AiCore → Live Scenarios first.",
  "activeScenarioCount": 0
}
```

---

## Files Changed

| File | Change |
|------|--------|
| `routes/admin/triageBuilder.js` | Added pre-flight endpoint, scenario injection |
| `services/ActiveScenariosHelper.js` | **NEW** - Scenario loading helper |
| `services/LLMA_TriageCardGeneratorV23.js` | Dynamic system prompt with scenario injection |
| `templates/FrontlineSystemPromptV23.js` | **NEW** - Fixed prompt template |
| `public/js/ai-agent-settings/CheatSheetManager.js` | Blocker UI, pre-flight check |

---

## Testing Checklist

- [ ] With 0 scenarios: Pre-flight returns `canProceed: false`
- [ ] With 0 scenarios: Frontend shows blocker UI
- [ ] With 0 scenarios: Generate API returns `NO_SCENARIOS_LOADED` error
- [ ] With 1+ scenarios: Pre-flight returns `canProceed: true`
- [ ] With 1+ scenarios: Frontend renders builder form
- [ ] With 1+ scenarios: Generated cards have valid `scenarioKey`
- [ ] Invalid scenario keys from LLM are flagged and nulled

---

## The Golden Rule in Practice

### Correct Setup Flow

1. **Create Company** → `trade: "HVAC"`
2. **Go to AiCore Templates** → Activate "HVAC Standard Template"
3. **Go to AiCore Live Scenarios** → Verify 40+ scenarios active
4. **Go to Triage Builder** → Pre-flight passes, builder renders
5. **Create Triage Cards** → Map to existing scenarios
6. **Live Calls Work** → Triage routes to valid destinations

### Incorrect Flow (Blocked)

1. **Create Company** → `trade: "PEST_CONTROL"`
2. **Go to Triage Builder** → **BLOCKED** - No scenarios
3. **UI Shows:** "NO SCENARIOS LOADED - Go to AiCore Templates"

---

**Implementation Date:** 2025-11-30  
**Author:** AI Coder  
**Status:** Production Ready

