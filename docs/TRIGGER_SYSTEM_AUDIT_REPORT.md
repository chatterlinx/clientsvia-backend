# TRIGGER SYSTEM AUDIT REPORT

**Date:** March 1, 2026  
**Auditor:** AI Engineering Assistant  
**Scope:** Complete triggers system — models, services, routes, UI  
**Status:** ✅ REMEDIATED (V131 Clean Sweep)

---

## V131 CLEAN SWEEP STATUS

All critical issues have been addressed in the V131 "Strict Trigger System" retrofit:

| Phase | Description | Status |
|-------|-------------|--------|
| A1 | Schema completeness - Add missing fields | ✅ COMPLETE |
| A2 | API routes - Accept/save all fields | ✅ COMPLETE |
| A3 | Export/Import - Include all fields | ✅ COMPLETE |
| A4 | UI inputs - Add form fields | ✅ COMPLETE |
| B1 | Add STRICT_TRIGGERS mode to schema | ✅ COMPLETE |
| B2 | Enforce strict mode in TriggerService | ✅ COMPLETE |
| B3 | Add LEGACY_FALLBACK_USED event | ✅ COMPLETE |
| C1 | Runtime health check | ✅ COMPLETE |
| C2 | Health banner in Agent Console | ✅ COMPLETE |

---

## ORIGINAL FINDINGS (Pre-V131)

---

## EXECUTIVE SUMMARY

This audit identified **critical inconsistencies** across the trigger system that cause:

1. **Data Loss on Save** — Three trigger fields are silently dropped when saving local triggers
2. **Schema Mismatch** — `CompanyLocalTrigger` model is missing fields that exist in `GlobalTrigger`
3. **Export/Import Corruption** — Bulk operations omit critical matching fields
4. **Multiple Trigger Sources** — Three potential sources can conflict, causing confusion about which triggers are active

---

## TABLE OF CONTENTS

1. [Trigger System Architecture](#1-trigger-system-architecture)
2. [Critical Issue #1: Missing Schema Fields](#2-critical-issue-1-missing-schema-fields)
3. [Critical Issue #2: API Route Gaps](#3-critical-issue-2-api-route-gaps)
4. [Critical Issue #3: UI Missing Inputs](#4-critical-issue-3-ui-missing-inputs)
5. [Critical Issue #4: Export/Import Data Loss](#5-critical-issue-4-exportimport-data-loss)
6. [Trigger Source Hierarchy](#6-trigger-source-hierarchy)
7. [Runtime Loading Logic](#7-runtime-loading-logic)
8. [Recommended Fixes](#8-recommended-fixes)
9. [Testing Checklist](#9-testing-checklist)
10. [File Reference](#10-file-reference)

---

## 1. TRIGGER SYSTEM ARCHITECTURE

### 1.1 Technology Stack
- **Backend:** Node.js, Express 4.18
- **Database:** MongoDB (Mongoose 8.16)
- **Cache:** Redis (ioredis 5.4) + In-memory Map (60s TTL)

### 1.2 Core Models

| Model | Collection | Purpose |
|-------|------------|---------|
| `GlobalTrigger` | `globalTriggers` | Platform-wide trigger cards (managed by admins) |
| `GlobalTriggerGroup` | `globalTriggerGroups` | Groups of global triggers (draft/published states) |
| `CompanyLocalTrigger` | `companyLocalTriggers` | Company-specific triggers (pure local or overrides) |
| `CompanyTriggerSettings` | `companyTriggerSettings` | Per-company config (active group, disabled triggers, variables) |

### 1.3 Runtime Components

| Component | File | Purpose |
|-----------|------|---------|
| `TriggerService` | `services/engine/agent2/TriggerService.js` | Loads & merges triggers, manages cache |
| `TriggerCardMatcher` | `services/engine/agent2/TriggerCardMatcher.js` | Word-based matching engine (v3) |
| `Agent2DiscoveryRunner` | `services/engine/agent2/Agent2DiscoveryRunner.js` | Orchestrates trigger matching at runtime |

### 1.4 Trigger Card Structure (Canonical)

The **complete** trigger card structure as defined in `GlobalTrigger.js` and used by `TriggerCardMatcher`:

```javascript
{
  // Identity
  ruleId: String,           // Unique identifier (e.g., "pricing.service_call")
  triggerId: String,        // System-generated unique ID
  label: String,            // Human-readable name
  
  // Matching
  priority: Number,         // Lower = fires first (default: 50)
  enabled: Boolean,         // Whether trigger is active
  keywords: [String],       // Word-based matching (ALL words must appear)
  phrases: [String],        // Substring matching (exact phrase)
  negativeKeywords: [String], // Block if ANY word matches
  negativePhrases: [String],  // ⚠️ MISSING IN CompanyLocalTrigger
  bucket: String,             // ⚠️ MISSING IN CompanyLocalTrigger
  maxInputWords: Number,      // ⚠️ MISSING IN CompanyLocalTrigger
  
  // Response
  responseMode: String,     // 'standard' | 'llm'
  answerText: String,       // Response text
  audioUrl: String,         // Pre-generated audio URL
  
  // LLM Mode
  llmFactPack: {
    includedFacts: String,
    excludedFacts: String,
    backupAnswer: String
  },
  
  // Follow-up
  followUpQuestion: String,
  followUpNextAction: String  // 'CONTINUE' | 'HANDOFF_BOOKING' | etc.
}
```

---

## 2. CRITICAL ISSUE #1: MISSING SCHEMA FIELDS

### 2.1 Problem Statement

The `CompanyLocalTrigger` Mongoose schema is **missing three critical fields** that exist in `GlobalTrigger` and are actively used by `TriggerCardMatcher`:

| Field | Purpose | Present in GlobalTrigger | Present in CompanyLocalTrigger |
|-------|---------|--------------------------|-------------------------------|
| `negativePhrases` | Substring-match negatives for context-aware blocking | ✅ YES | ❌ **NO** |
| `bucket` | Call router intent classification (5 buckets) | ✅ YES | ❌ **NO** |
| `maxInputWords` | Greeting protection — only match short utterances | ✅ YES | ❌ **NO** |

### 2.2 Impact

1. **negativePhrases**: When a company creates a local trigger with negative phrase conditions, they are silently ignored. The trigger fires when it shouldn't.

2. **bucket**: Triggers cannot participate in Call Router pool filtering. Mixed-intent calls may route incorrectly.

3. **maxInputWords**: Greeting triggers (e.g., "hi", "hello") match long service requests like "Hi, my AC isn't cooling" — stealing legitimate service calls.

### 2.3 Evidence

**GlobalTrigger.js (lines 58-72):**
```javascript
negativePhrases: {
  type: [String],
  default: []
},
bucket: {
  type: String,
  enum: ['booking_service', 'billing_payment', 'membership_plan', 
         'existing_appointment', 'other_operator', null],
  default: null
},
maxInputWords: {
  type: Number,
  default: null,
  min: 1,
  max: 100
}
```

**CompanyLocalTrigger.js:** These fields are **completely absent** from the schema definition.

### 2.4 Verification Command

```bash
grep -n "negativePhrases\|bucket\|maxInputWords" models/CompanyLocalTrigger.js
# Returns: NO MATCHES (confirming absence)
```

---

## 3. CRITICAL ISSUE #2: API ROUTE GAPS

### 3.1 Problem Statement

The API routes in `routes/admin/companyTriggers.js` do not handle the missing fields when creating or updating local triggers.

### 3.2 POST /:companyId/local-triggers (Create)

**File:** `routes/admin/companyTriggers.js` (lines 565-850)

**Current destructuring:**
```javascript
const {
  ruleId: rawRuleId,
  label,
  description,
  enabled,
  priority,
  keywords,
  phrases,
  negativeKeywords,      // ✅ Present
  // negativePhrases,    // ❌ MISSING
  // bucket,             // ❌ MISSING
  // maxInputWords,      // ❌ MISSING
  responseMode,
  answerText,
  audioUrl,
  llmFactPack,
  followUpQuestion,
  followUpNextAction,
  isOverride,
  overrideOfTriggerId,
  tags
} = req.body;
```

**Result:** Even if the UI sends these fields, they are not extracted from the request body and not saved to the database.

### 3.3 PATCH /:companyId/local-triggers/:ruleId (Update)

**File:** `routes/admin/companyTriggers.js` (lines 885-979)

**Current allowedFields:**
```javascript
const allowedFields = [
  'label', 'description', 'enabled', 'priority',
  'keywords', 'phrases', 'negativeKeywords',
  // 'negativePhrases',  // ❌ MISSING
  // 'bucket',           // ❌ MISSING
  // 'maxInputWords',    // ❌ MISSING
  'responseMode', 'answerText', 'llmFactPack',
  'followUpQuestion', 'followUpNextAction',
  'tags'
];
```

**Result:** Updates to these fields are silently ignored.

### 3.4 buildMergedTriggerList Helper

**File:** `routes/admin/companyTriggers.js` (function `buildMergedTriggerList`)

This function builds the trigger list for the UI. The `triggerData` object it creates also omits these fields, meaning the UI never receives them even if they existed in the database.

---

## 4. CRITICAL ISSUE #3: UI MISSING INPUTS

### 4.1 Problem Statement

The Agent Console trigger editor UI (`public/agent-console/triggers.js`) has no input fields for:
- `negativePhrases`
- `bucket`
- `maxInputWords`

### 4.2 Evidence

**DOM References (triggers.js lines 44-120):**
```javascript
inputTriggerNegative: document.getElementById('input-trigger-negative'),
// No reference to: input-trigger-negative-phrases
// No reference to: input-trigger-bucket
// No reference to: input-trigger-max-input-words
```

**openTriggerModal function:** Does not populate these fields when editing a trigger.

**saveTrigger function:** Does not extract these fields when saving.

### 4.3 Paradox

The `runTriggerTest` function (lines 650-733) **does display** the `Bucket` field in test results:
```javascript
// Line 718-720 (approximate)
Bucket: ${result.card?.bucket || 'none'}
```

This proves the field's importance to the system, yet users cannot set it.

---

## 5. CRITICAL ISSUE #4: EXPORT/IMPORT DATA LOSS

### 5.1 Problem Statement

The bulk export function explicitly excludes critical fields, causing data loss during export/import workflows.

### 5.2 Evidence

**exportAllTriggers function (triggers.js lines 2528-2537):**
```javascript
// Fields explicitly EXCLUDED from export:
// - negativePhrases
// - bucket  
// - maxInputWords
// - followUpNextAction
// - responseMode
// - llmFactPack
```

### 5.3 Impact

1. User exports 42 triggers with carefully configured `maxInputWords` values
2. Export file contains triggers WITHOUT these values
3. User imports to another company or re-imports after changes
4. All `maxInputWords` settings are lost
5. Greeting triggers now steal service calls

---

## 6. TRIGGER SOURCE HIERARCHY

### 6.1 Three Potential Sources

The system can load triggers from **three different locations**, which can cause confusion:

| Source | Location | Priority |
|--------|----------|----------|
| **GlobalTrigger** | `globalTriggers` collection | Used when `activeGroupId` is set |
| **CompanyLocalTrigger** | `companyLocalTriggers` collection | Always loaded (merged with global or standalone) |
| **Legacy playbook.rules** | `company.aiAgentSettings.agent2.discovery.playbook.rules[]` | FALLBACK ONLY (deprecated) |

### 6.2 Legacy Trigger IDs (Hardcoded)

These trigger IDs were hardcoded in the platform before the global trigger system existed:

```javascript
const LEGACY_IDS = [
  'pricing.service_call',
  'problem.water_leak', 
  'problem.not_cooling',
  'problem.system_not_running',
  'problem.thermostat'
];
```

**Location:** Embedded in `company.aiAgentSettings.agent2.discovery.playbook.rules[]`

**Cleanup:** Admin → Triggers → "Clear Legacy" button removes these.

---

## 7. RUNTIME LOADING LOGIC

### 7.1 TriggerService.loadTriggersWithLegacyFallback()

**File:** `services/engine/agent2/TriggerService.js` (lines 474-567)

```
┌─────────────────────────────────────────────────────────────────┐
│                    loadTriggersWithLegacyFallback               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │ Check CompanyTriggerSettings  │
              │      activeGroupId            │
              └───────────────────────────────┘
                              │
            ┌─────────────────┴─────────────────┐
            │                                   │
            ▼                                   ▼
    ┌───────────────┐                 ┌───────────────────┐
    │ activeGroupId │                 │ activeGroupId NOT │
    │    IS SET     │                 │       SET         │
    └───────────────┘                 └───────────────────┘
            │                                   │
            ▼                                   ▼
    ┌───────────────┐               ┌─────────────────────┐
    │ loadTriggers  │               │ Try: CompanyLocal   │
    │ ForCompany()  │               │ Trigger.findActive  │
    │               │               │ ByCompanyId()       │
    │ Returns:      │               └─────────────────────┘
    │ • Global      │                         │
    │ • + Local     │           ┌─────────────┴─────────────┐
    │ • (merged)    │           │                           │
    └───────────────┘           ▼                           ▼
                        ┌─────────────┐           ┌─────────────────┐
                        │ count > 0   │           │ count == 0      │
                        │ Return      │           │ FALLBACK:       │
                        │ local       │           │ playbook.rules  │
                        │ triggers    │           └─────────────────┘
                        └─────────────┘
```

### 7.2 Runtime Events

The system emits diagnostic events visible in Call Console:

| Event | Meaning |
|-------|---------|
| `TRIGGER_POOL_SOURCE` | Shows where triggers came from: `{ scopes: { LOCAL: X, GLOBAL: Y, LEGACY: Z } }` |
| `TRIGGER_POOL_EMPTY` | No triggers loaded — all turns fall to LLM fallback |
| `A2_CALL_ROUTER_POOL_FILTERED` | Call Router filtered the pool by intent bucket |

### 7.3 Manual Transformation (V130 Fix)

**File:** `TriggerService.js` (lines 500-530)

When loading `CompanyLocalTrigger` documents via `lean()`, the service manually transforms them to include ALL expected fields:

```javascript
return {
  // ... other fields ...
  bucket: lt.bucket || null,              // Included in transform
  maxInputWords: lt.maxInputWords || null, // Included in transform
  match: {
    // ...
    negativePhrases: lt.negativePhrases || [], // Included in transform
  }
};
```

**However:** Since the schema doesn't define these fields, `lt.bucket`, `lt.maxInputWords`, and `lt.negativePhrases` are **always undefined**, so they always default to `null` or `[]`.

---

## 8. RECOMMENDED FIXES

### 8.1 Fix CompanyLocalTrigger Schema

**File:** `models/CompanyLocalTrigger.js`

Add the missing fields to the schema:

```javascript
// After negativeKeywords field (approximately line 85):

negativePhrases: {
  type: [String],
  default: [],
  validate: {
    validator: function(v) {
      return v.every(phrase => typeof phrase === 'string' && phrase.length <= 200);
    },
    message: 'Each negative phrase must be a string under 200 characters'
  }
},

bucket: {
  type: String,
  enum: ['booking_service', 'billing_payment', 'membership_plan', 
         'existing_appointment', 'other_operator', null],
  default: null
},

maxInputWords: {
  type: Number,
  default: null,
  min: 1,
  max: 100
},
```

### 8.2 Fix toMatcherFormat Method

**File:** `models/CompanyLocalTrigger.js` (method `toMatcherFormat`)

Add the missing fields to the output:

```javascript
// In the match object:
match: {
  keywords: this.keywords || [],
  phrases: this.phrases || [],
  negativeKeywords: this.negativeKeywords || [],
  negativePhrases: this.negativePhrases || [],  // ADD THIS
  scenarioTypeAllowlist: this.scenarioTypeAllowlist || []
},

// At the top level:
bucket: this.bucket || null,        // ADD THIS
maxInputWords: this.maxInputWords,  // ADD THIS (preserve null vs undefined)
```

### 8.3 Fix API Routes

**File:** `routes/admin/companyTriggers.js`

#### POST /:companyId/local-triggers

Add to destructuring:
```javascript
const {
  // ... existing fields ...
  negativePhrases,
  bucket,
  maxInputWords,
  // ... rest ...
} = req.body;
```

Add to create payload:
```javascript
const trigger = await CompanyLocalTrigger.create({
  // ... existing fields ...
  negativePhrases: negativePhrases || [],
  bucket: bucket || null,
  maxInputWords: typeof maxInputWords === 'number' ? maxInputWords : null,
  // ... rest ...
});
```

#### PATCH /:companyId/local-triggers/:ruleId

Update allowedFields:
```javascript
const allowedFields = [
  'label', 'description', 'enabled', 'priority',
  'keywords', 'phrases', 'negativeKeywords',
  'negativePhrases',  // ADD
  'bucket',           // ADD
  'maxInputWords',    // ADD
  'responseMode', 'answerText', 'llmFactPack',
  'followUpQuestion', 'followUpNextAction',
  'tags'
];
```

### 8.4 Fix buildMergedTriggerList

**File:** `routes/admin/companyTriggers.js`

Update the `triggerData` object construction to include:
```javascript
negativePhrases: source.negativePhrases || [],
bucket: source.bucket || null,
maxInputWords: source.maxInputWords ?? null,
```

### 8.5 Fix UI (triggers.js)

**File:** `public/agent-console/triggers.js`

1. **Add DOM references** for new input fields
2. **Update openTriggerModal** to populate the fields
3. **Update saveTrigger** to extract and send the fields
4. **Update exportAllTriggers** to include the fields
5. **Update import logic** to handle the fields

### 8.6 Fix UI HTML (triggers.html)

**File:** `public/agent-console/triggers.html`

Add input fields in the trigger modal:

```html
<!-- After Negative Keywords field -->
<div class="form-group">
  <label for="input-trigger-negative-phrases">Negative Phrases</label>
  <input type="text" class="form-input" id="input-trigger-negative-phrases" 
         placeholder="e.g., just checking, not interested">
  <p class="form-hint">Comma-separated. Trigger won't fire if ANY phrase appears (substring match).</p>
</div>

<div class="form-group">
  <label for="input-trigger-bucket">Intent Bucket</label>
  <select class="form-select" id="input-trigger-bucket">
    <option value="">None (matches all intents)</option>
    <option value="booking_service">Booking/Service</option>
    <option value="billing_payment">Billing/Payment</option>
    <option value="membership_plan">Membership/Plan</option>
    <option value="existing_appointment">Existing Appointment</option>
    <option value="other_operator">Other/Operator</option>
  </select>
  <p class="form-hint">Optional. Limits trigger to specific call router classifications.</p>
</div>

<div class="form-group">
  <label for="input-trigger-max-input-words">Max Input Words</label>
  <input type="number" class="form-input" id="input-trigger-max-input-words" 
         min="1" max="100" placeholder="e.g., 4">
  <p class="form-hint">Optional. Trigger only fires if caller input has ≤ this many words. Use for greetings.</p>
</div>
```

---

## 9. TESTING CHECKLIST

### 9.1 Schema Fix Verification

- [ ] Create a local trigger with `negativePhrases: ["just checking"]`
- [ ] Verify the value persists in MongoDB
- [ ] Verify `toMatcherFormat()` includes the field

### 9.2 API Verification

- [ ] POST new trigger with all three fields — verify saved correctly
- [ ] PATCH existing trigger to update these fields — verify changes persist
- [ ] GET trigger list — verify fields appear in response

### 9.3 UI Verification

- [ ] New input fields appear in trigger modal
- [ ] Editing a trigger shows existing values
- [ ] Saving a trigger includes the new fields in the API request
- [ ] Export includes the new fields
- [ ] Import handles the new fields

### 9.4 Runtime Verification

- [ ] TriggerCardMatcher correctly uses `negativePhrases` for blocking
- [ ] TriggerCardMatcher correctly uses `maxInputWords` for greeting protection
- [ ] Agent2CallRouter correctly uses `bucket` for pool filtering

### 9.5 Regression Testing

- [ ] Existing triggers without these fields still work (default values)
- [ ] Legacy playbook.rules still load correctly
- [ ] Global triggers still merge correctly with local triggers

---

## 10. FILE REFERENCE

### 10.1 Models

| File | Line Numbers | What to Change |
|------|--------------|----------------|
| `models/CompanyLocalTrigger.js` | ~85 (schema) | Add 3 missing fields |
| `models/CompanyLocalTrigger.js` | ~413-453 (toMatcherFormat) | Add fields to output |

### 10.2 Routes

| File | Line Numbers | What to Change |
|------|--------------|----------------|
| `routes/admin/companyTriggers.js` | ~565-600 (POST destructure) | Add 3 fields |
| `routes/admin/companyTriggers.js` | ~650-700 (POST create) | Add 3 fields to payload |
| `routes/admin/companyTriggers.js` | ~885-900 (PATCH allowedFields) | Add 3 fields |
| `routes/admin/companyTriggers.js` | ~1190-1308 (buildMergedTriggerList) | Add 3 fields |

### 10.3 UI

| File | Line Numbers | What to Change |
|------|--------------|----------------|
| `public/agent-console/triggers.html` | ~1400-1500 (modal) | Add 3 input fields |
| `public/agent-console/triggers.js` | ~44-120 (DOM refs) | Add 3 references |
| `public/agent-console/triggers.js` | ~1200-1400 (openTriggerModal) | Populate fields |
| `public/agent-console/triggers.js` | ~1600-1800 (saveTrigger) | Extract fields |
| `public/agent-console/triggers.js` | ~2528-2537 (export) | Include fields |

### 10.4 Services (Reference Only)

| File | Purpose |
|------|---------|
| `services/engine/agent2/TriggerService.js` | Already handles fields in manual transform |
| `services/engine/agent2/TriggerCardMatcher.js` | Already uses all three fields |

### 10.5 Documentation

| File | Purpose |
|------|---------|
| `docs/triggers-master-v1.json` | Master library showing correct trigger structure |

---

## APPENDIX A: TRIGGER MATCHING LOGIC

From `TriggerCardMatcher.js`:

```
MATCHING ORDER:
1. Check if card is enabled
2. Check negative keywords — if ANY word matches, SKIP card
3. Check negative phrases — if ANY substring matches, SKIP card
4. Check maxInputWords — if input has more words, SKIP card
5. Check keywords (WORD-BASED) — ALL words must appear
6. Check phrases (SUBSTRING) — exact phrase must appear
7. First matching card (by priority) wins

GREETING PROTECTION (V3):
Single-word greeting keywords ("hi", "hello", "hey") will ONLY match
if the entire utterance is short (≤ maxInputWords, default 4).
This prevents "hi" from matching "Hi, my AC isn't cooling".
```

---

## APPENDIX B: LEGACY TRIGGER CLEANUP

To remove legacy hardcoded triggers from a company:

**Via API:**
```bash
POST /api/agent-console/:companyId/triggers/clear-legacy
```

**Via UI:**
Admin → Triggers → "Clear Legacy" button

**Legacy IDs removed:**
- `pricing.service_call`
- `problem.water_leak`
- `problem.not_cooling`
- `problem.system_not_running`
- `problem.thermostat`

---

## APPENDIX C: DIAGNOSTIC QUERIES

### Count triggers by source for a company

```javascript
// In mongo shell or script:

// 1. Check CompanyTriggerSettings
db.companyTriggerSettings.findOne({ companyId: "YOUR_COMPANY_ID" });
// Look at: activeGroupId, disabledGlobalTriggerIds

// 2. Count CompanyLocalTriggers
db.companyLocalTriggers.countDocuments({ 
  companyId: "YOUR_COMPANY_ID", 
  isDeleted: { $ne: true } 
});

// 3. Check for legacy playbook.rules
db.companiesCollection.findOne(
  { _id: ObjectId("YOUR_COMPANY_ID") },
  { "aiAgentSettings.agent2.discovery.playbook.rules": 1 }
);

// 4. Count GlobalTriggers in active group
const settings = db.companyTriggerSettings.findOne({ companyId: "YOUR_COMPANY_ID" });
if (settings?.activeGroupId) {
  db.globalTriggers.countDocuments({ 
    groupId: settings.activeGroupId,
    status: 'published',
    isDeleted: { $ne: true }
  });
}
```

---

## APPENDIX D: V131 IMPLEMENTATION SUMMARY

### Files Modified

| File | Changes |
|------|---------|
| `models/CompanyLocalTrigger.js` | Added `negativePhrases`, `bucket`, `maxInputWords` to schema and `toMatcherFormat()` |
| `models/CompanyTriggerSettings.js` | Added `strictMode`, `strictModeSetAt/By`, `lastLegacyFallbackAt`, `legacyFallbackCount` |
| `routes/admin/companyTriggers.js` | Updated POST/PATCH to handle new fields, added `/system-health` and `/strict-mode` endpoints |
| `services/engine/agent2/TriggerService.js` | Rewritten `loadTriggersWithLegacyFallback()` to enforce strict mode, added `checkTriggerSystemHealth()` |
| `services/engine/agent2/Agent2DiscoveryRunner.js` | Added `LEGACY_FALLBACK_USED` event emission |
| `public/agent-console/triggers.js` | Updated export/import, added health banner and strict mode toggle |
| `public/agent-console/callconsole.js` | Added rendering for `LEGACY_FALLBACK_USED` event |

### New API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/:companyId/system-health` | GET | Full health report for trigger system |
| `/:companyId/strict-mode` | POST | Toggle strict mode (body: `{ enabled: boolean }`) |

### New Runtime Events

| Event | When Emitted |
|-------|--------------|
| `LEGACY_FALLBACK_USED` | When legacy `playbook.rules` is loaded (only possible in legacy mode) |

### Behavior Changes

1. **Default Mode**: All companies now default to STRICT mode
2. **Legacy Blocked**: In strict mode, `playbook.rules` is never loaded, even if no other triggers exist
3. **Loud Failures**: Empty trigger pool emits visible `TRIGGER_POOL_EMPTY` event with remediation hints
4. **Health Banner**: Agent Console shows warning banner when issues detected

---

**END OF REPORT**

*V131 Clean Sweep completed. All issues from original audit have been remediated.*
