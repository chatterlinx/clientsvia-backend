# V22 Triage + LLM-A System – Design & Implementation Spec

Version: V22  
Owner: ClientsVia.ai  
Scope: Brain-1 (Frontline-Intel) + Triage Layer + LLM-A (Admin Generator)  
Status: DESIGN + IMPLEMENTATION READY

---

## 1. Purpose

This system turns **vague caller language** into **deterministic routing decisions** for the V22 call flow, while letting admins use LLMs **only offline** to generate triage content.

Goals:

1. Frontline-Intel + triage must run **100% deterministic** at runtime.
2. Admins get **LLM-A tools** to rapidly draft triage cards and scripts.
3. Each **TriageCard** is a single source of truth for:
   - Quick keyword rules
   - Frontline guidance
   - Action handling (explain, escalate, message, end)
   - 3-Tier scenario "package" (admin copy-paste into Scenario Builder)
4. The system must plug cleanly into existing **V22 brains**:
   - Brain-0: SmartCallFilter
   - Brain-1: Frontline-Intel + Triage
   - Brain-2: 3-Tier Router
   - Brain-3: CheatSheet
   - Brain-4/5: Memory + Optimization

---

## 2. High-Level Flow

### 2.1 Runtime Call Flow (V22, simplified)

```text
INCOMING CALL
  → Brain-0: SmartCallFilter
  → Greeting (TTS)
  → /v2-agent-respond/:companyId

v2AIAgentRuntime.processUserInput():

  1) Build executionContext
  2) Brain-4: MemoryEngine.hydrateMemoryContext(executionContext)
  3) 🆕 TriageService.applyQuickTriageRules(executionContext)
       - If hard triage decision → attach to context and proceed
  4) CallFlowExecutor.execute(executionContext)
       - Frontline-Intel
       - Brain-2: 3-Tier Router
       - Brain-3: CheatSheet/Behavior
  5) Brain-4/5: PostCallLearningService.learnFromCall(executionContext)
  6) TwiML → Twilio → next turn
```

### 2.2 Admin Flow (LLM-A)

```text
Admin opens Control Plane → Triage Builder

  1) Enters a triage scenario description:
       "Customer says AC is blowing warm air"
  2) Chooses trade + service types to include (REPAIR, EMERGENCY, etc.)
  3) Clicks "Generate Triage Package" (LLM-A)

LLM-A (offline) returns:

  - Triage label + display name
  - Quick rules (keywords / excludes / action)
  - Frontline script ("what to say / ask")
  - Action playbooks (EXPLAIN_AND_PUSH, TAKE_MESSAGE, etc.)
  - 3-Tier package draft:
      - categoryName
      - categoryDescription
      - scenarioName
      - scenarioObjective
      - example triggers

Admin reviews → edits → clicks "Save as Triage Card"

Result: a new TriageCard doc stored in Mongo and available to the runtime.
```

---

## 3. Data Model – `TriageCard`

**File:** `models/TriageCard.js`
**Collection:** `triagecards`

### 3.1 Top-Level Fields

```js
{
  companyId: ObjectId,     // Tenant
  trade: String,           // "HVAC", "PLUMBING", etc.

  triageLabel: String,     // "AC_BLOWING_WARM"
  displayName: String,     // "AC blowing warm air"

  triageCategory: String,  // Folder grouping (e.g. "Cooling / No Cool")
  intent: String,          // "AC_REPAIR", "MAINTENANCE", etc.
  serviceType: String,     // "REPAIR" | "MAINTENANCE" | "EMERGENCY" | "OTHER"

  priority: Number,        // Higher wins when multiple rules match
  isActive: Boolean,       // ON/OFF toggle in the UI

  quickRuleConfig: QuickRuleConfigSchema,
  frontlinePlaybook: FrontlinePlaybookSchema,
  actionPlaybooks: ActionPlaybooksSchema,
  threeTierPackageDraft: ThreeTierPackageDraftSchema,
  matchHistory: MatchHistorySchema,

  linkedScenario: {
    scenarioId: String,    // optional: ID of 3-Tier scenario
    scenarioName: String
  },

  createdAt: Date,
  updatedAt: Date
}
```

#### Indexes

* `{ companyId: 1, isActive: 1, priority: -1 }`
* `{ companyId: 1, triageLabel: 1 }`
* Text or keyword indexes can be added as needed.

---

### 3.2 QuickRuleConfigSchema

Defines the **minimal runtime rule** used before any LLM in Brain-1:

```js
{
  keywordsMustHave: [String],   // e.g. ["ac blowing warm", "warm air"]
  keywordsExclude: [String],    // e.g. ["maintenance", "tune up"]

  action: String,               // One of:
                                // "DIRECT_TO_3TIER"
                                // "EXPLAIN_AND_PUSH"
                                // "ESCALATE_TO_HUMAN"
                                // "TAKE_MESSAGE"
                                // "END_CALL_POLITE"

  explanation: String,          // Admin note: why this rule exists
  qnaCardRef: String            // Optional pointer to FAQ / KB card
}
```

**Runtime behavior:**

* Case-insensitive match against normalized user text.
* All `keywordsMustHave` must be found (simple AND).
* None of `keywordsExclude` may be present.
* Highest `priority` wins if multiple cards match.

---

### 3.3 FrontlinePlaybookSchema

Controls **Frontline-Intel** language when this card is triggered.

```js
{
  frontlineGoal: String,        // What frontline should achieve
  openingLines: [String],       // First reply to caller
  explainAndPushLines: [String],// Lines for explain-and-push flow
  objectionHandling: [          // Customer objection → agent response pairs
    {
      customer: String,
      agent: String
    }
  ]
}
```

This is where we guarantee tone and steps match company policy. Frontline-Intel pulls from here instead of improvising.

---

### 3.4 ActionPlaybooksSchema

Defines what to do per **Action** (dropdown in quick rules):

```js
{
  explainAndPush: {
    explanationLines: [String], // educate, then push to booking
    pushLines: [String],        // "We really recommend a technician visit..."
    objectionPairs: [{ customer, agent }]
  },
  escalateToHuman: {
    reasonLabel: String,
    preTransferLines: [String]
  },
  takeMessage: {
    introLines: [String],
    fieldsToCollect: [String],  // ["name", "phone", "address", "issueSummary"]
    closingLines: [String]
  },
  endCallPolite: {
    reasonLabel: String,
    closingLines: [String]
  }
}
```

Runtime uses these blocks when `quickRuleConfig.action` is **not** `DIRECT_TO_3TIER`.

---

### 3.5 ThreeTierPackageDraftSchema

This is the **3-Tier package** that lives inside the card.
It is **not** pushed automatically; admins copy-paste into Scenario Builder.

```js
{
  categoryName: String,         // e.g. "Cooling / No Cool"
  categoryDescription: String,  // high-level description for admin
  scenarioName: String,         // "AC blowing warm air"
  scenarioObjective: String,    // "Help caller verify thermostat/filter, then book tech"
  scenarioExamples: [String],   // sample phrases for 3-Tier
  suggestedStepsOutline: [String],
  notesForAdmin: String
}
```

This text is what LLM-A generates to make filling out the 3-Tier scenario form trivial.

---

### 3.6 MatchHistorySchema

For analytics + V22 optimization visibility:

```js
{
  totalMatches: Number,         // how many times this card triggered
  totalSuccesses: Number,       // how many ended in success
  lastMatchedAt: Date,
  lastSuccessAt: Date,
  successRate: Number,          // 0–1, derived = successful / total
  recentSamplePhrases: [        // Last 25 matched phrases
    {
      text: String,
      matchedAt: Date,
      outcome: {
        finalAction: String,
        successFlag: Boolean
      }
    }
  ]
}
```

Used only for reporting/observability, not for routing logic.

---

## 4. Runtime Service – `TriageService`

**File:** `services/TriageService.js`

### 4.1 Responsibilities

1. Load active TriageCards for a company (with caching).
2. Normalize caller text.
3. Apply quick triage rules:
   * Simple AND/NOT keyword matching.
4. Return a `TriageDecision` object into `executionContext`.

### 4.2 Public API

```js
// Called in v2AIAgentRuntime after MemoryEngine
async function applyQuickTriageRules(userText, companyId, trade) -> TriageResult
```

**Input:**
- `userText`: Raw text from STT
- `companyId`: Company ObjectId
- `trade`: Optional trade filter (e.g., "HVAC")

**Output (on match):**

```js
{
  matched: true,
  source: "QUICK_RULE",
  triageCardId: "507f1f77bcf86cd799439011",
  triageLabel: "AC_BLOWING_WARM",
  displayName: "AC blowing warm air",
  intent: "AC_REPAIR",
  triageCategory: "COOLING_ISSUES",
  serviceType: "REPAIR",
  action: "DIRECT_TO_3TIER",
  linkedScenarioId: null,
  linkedScenarioName: null,
  confidence: 1.0
}
```

If no match: `{ matched: false }`.
Frontline-Intel and 3-Tier fall back to existing behavior.

---

## 5. LLM-A – `LLMA_TriageCardGenerator`

**File:** `services/LLMA_TriageCardGenerator.js`
**Use:** Admin-only, never at runtime with callers.

### 5.1 Input

```json
{
  "companyId": "507f1f77bcf86cd799439011",
  "trade": "HVAC",
  "scenarioTitle": "AC blowing warm air",
  "scenarioDescription": "Customer says their AC is blowing warm air instead of cold.",
  "targetServiceTypes": ["REPAIR", "EMERGENCY"],
  "preferredAction": "DIRECT_TO_3TIER",
  "adminNotes": "We prefer to book repair visits quickly; mention maintenance only as add-on.",
  "language": "en-US"
}
```

### 5.2 Output

```json
{
  "triageLabel": "AC_BLOWING_WARM",
  "displayName": "AC blowing warm air",
  "description": "AC system runs but produces warm air instead of cold.",
  "triageCategory": "COOLING_ISSUES",
  "intent": "AC_REPAIR",
  "serviceType": "REPAIR",
  "priority": 100,

  "quickRuleConfig": {
    "keywordsMustHave": ["blowing warm", "warm air"],
    "keywordsExclude": ["maintenance", "tune up"],
    "action": "DIRECT_TO_3TIER",
    "explanation": "Route true no-cool situations to AC repair scenario."
  },

  "frontlinePlaybook": {
    "frontlineGoal": "Confirm warm air issue and schedule repair",
    "openingLines": [
      "If your AC is blowing warm air, make sure the thermostat is on cool and the filter is clean. If it's still warm, I can send a technician."
    ],
    "objectionHandling": [
      {
        "customer": "Can you just tell me what's wrong?",
        "agent": "There are several possible causes. A technician can diagnose it onsite."
      }
    ]
  },

  "actionPlaybooks": {
    "explainAndPush": { ... },
    "escalateToHuman": { ... },
    "takeMessage": { ... },
    "endCallPolite": { ... }
  },

  "threeTierPackageDraft": {
    "categoryName": "Cooling / No Cool",
    "categoryDescription": "Situations where the system is on but not providing cold air.",
    "scenarioName": "AC blowing warm air",
    "scenarioObjective": "Coach basic thermostat/filter checks, then book a repair visit.",
    "scenarioExamples": [
      "my ac is blowing warm air",
      "ac running but not cooling"
    ],
    "suggestedStepsOutline": [
      "Verify thermostat set to cool",
      "Check filter status",
      "Offer repair visit booking"
    ],
    "notesForAdmin": "Copy into Scenario Builder for full 20-30 step script."
  }
}
```

Admin can either:

* Save directly as a new `TriageCard`, or
* Edit fields in the UI then save.

---

## 6. Admin API – Triage Builder

**Base path:** `/api/admin/triage-builder/`
(Protected: admin / internal only)

### 6.1 Generate draft card (LLM-A)

`POST /api/admin/triage-builder/generate-card`

* Body = input JSON above.
* Returns `draftCard` object ready for review.

### 6.2 CRUD

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/cards/:companyId` | List all cards (supports `?format=grouped\|view\|raw`) |
| GET | `/card/:cardId` | Get single card + viewModel |
| POST | `/card` | Create card manually |
| PUT | `/card/:cardId` | Update card |
| DELETE | `/card/:cardId` | Delete card |
| POST | `/card/:cardId/activate` | Turn card ON |
| POST | `/card/:cardId/deactivate` | Turn card OFF |

### 6.3 Test rules

`POST /api/admin/triage-builder/test-rules`

* Body: `{ companyId, trade, testInput }`
* Returns: which TriageCard would match and why.

### 6.4 Stats

`GET /api/admin/triage-builder/stats/:companyId`

* Aggregates `matchHistory` across all cards.

---

## 7. UI Contract – Card View Model

**File:** `services/triageViewModel.js`

Frontend should **never** use raw Mongo docs directly.
It uses the **view model** transformer.

### 7.1 View Model Shape

```js
{
  id: String,
  triageLabel: String,
  
  active: Boolean,
  title: String,           // displayName
  triggerLabel: String,    // First keyword
  previewReply: String,    // First opening line or description
  
  templateName: String,    // "HVAC Trade Knowledge Template"
  templateVersion: String, // "V22"
  trade: String,
  
  uses: Number,            // matchHistory.totalMatches
  successPercent: Number,  // null if no data yet
  
  categoryLabel: String,
  serviceType: String,
  intent: String,
  priority: Number,
  action: String,
  
  keywordsMustHave: [String],
  keywordsExclude: [String],
  
  linkedScenarioId: String,
  linkedScenarioName: String,
  
  createdAt: Date,
  updatedAt: Date
}
```

### 7.2 Grouped Response

`GET /api/admin/triage-builder/cards/:companyId?format=grouped`

```json
{
  "ok": true,
  "format": "grouped",
  "summary": {
    "totalCards": 21,
    "activeCards": 18,
    "disabledCards": 3,
    "totalTriggers": 139,
    "trades": ["HVAC"],
    "categories": ["Cooling / No Cool", "Heating Issues", "Thermostat"]
  },
  "categories": [
    {
      "name": "Cooling / No Cool",
      "count": 8,
      "activeCount": 7,
      "cards": [ /* viewModel objects */ ]
    }
  ]
}
```

---

## 8. HVAC Starter Pack

**File:** `seeds/hvacTriageStarterPack.js`

Creates ~12 `TriageCard` docs for a given `companyId`:

| Category | Cards |
|----------|-------|
| **Cooling / No Cool** | AC not cooling, AC blowing warm, AC not turning on, General AC service |
| **Heating Issues** | Heat not working, Furnace not igniting, Heat pump issues |
| **Thermostat** | Thermostat blank, Thermostat not responding |
| **Maintenance** | AC tune-up, Furnace tune-up |
| **Emergency** | HVAC emergency (escalate to human) |

**Usage:**

```bash
node seeds/hvacTriageStarterPack.js <companyId> --activate
```

All seed cards are created with:

* `isActive = true` (if `--activate` flag)
* Reasonable `priority` and `quickRuleConfig`
* Draft 3-Tier packages for admin to plug into Scenario Builder.

---

## 9. Verification Checklist (Engineer)

### 9.1 Data

- [ ] `triagecards` collection exists in MongoDB
- [ ] Docs have all required fields:
  - [ ] `quickRuleConfig` with `keywordsMustHave`, `keywordsExclude`, `action`
  - [ ] `frontlinePlaybook` with `openingLines`
  - [ ] `actionPlaybooks` with all four action types
  - [ ] `threeTierPackageDraft` with category and scenario info

### 9.2 Runtime Wiring

- [ ] `v2AIAgentRuntime.processUserInput()` calls in order:
  - [ ] `MemoryEngine.hydrateMemoryContext()`
  - [ ] `TriageService.applyQuickTriageRules()`
  - [ ] `CallFlowExecutor.execute()`
- [ ] Logs show `[TRIAGE] ✅ Quick rule matched` when keywords match

### 9.3 Admin UI

- [ ] Triage cards display grouped by category
- [ ] Card visual matches screenshot design:
  - [ ] Toggle ON/OFF
  - [ ] Title + trigger label
  - [ ] Preview reply
  - [ ] Template name + version
  - [ ] Uses + success % pills
- [ ] Toggling a card OFF prevents it from matching new calls

### 9.4 Behavior

- [ ] Call test number with "my AC is blowing warm air"
- [ ] Logs show TriageCard match for AC_BLOWING_WARM
- [ ] If action = `DIRECT_TO_3TIER`, Router receives correct `intent/serviceType`
- [ ] If action = `ESCALATE_TO_HUMAN`, call transfers immediately

---

## 10. File Reference

| File | Purpose |
|------|---------|
| `models/TriageCard.js` | Mongoose schema |
| `services/TriageService.js` | Runtime matcher + cache |
| `services/LLMA_TriageCardGenerator.js` | Admin-only LLM generator |
| `services/triageViewModel.js` | UI contract transformer |
| `routes/admin/triageBuilder.js` | Admin API endpoints |
| `seeds/hvacTriageStarterPack.js` | HVAC starter cards |

---

## 11. Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2025-11-29 | V22.0 | Initial implementation |

---

**If all verification boxes are checked, V22 Triage + LLM-A is correctly designed and wired.**

