# CLIENTVIA TRIAGE + LLM-A – FULL DESIGN (MULTI-TENANT, V22/V23)

> Canonical architecture spec for the Triage system. Any engineer can read this once and know exactly what to build.

---

## 0. Core Idea

You have **one global factory** that knows how to generate good triage cards (LLM-A, trade presets), and **many per-company brains** that actually answer calls.

- **Global** = templates + presets + LLM-A
- **Per-company** = cards + rules + stats
- **Runtime** = deterministic, uses only the per-company brain

No company leaks into another. Everything live is scoped by `companyId`.

---

## 1. Main Objects (Data Model)

### 1.1 Company (per tenant)

Existing `Company` (simplified):

```ts
Company {
  _id: ObjectId
  name: string
  companyID: string  // external id used in URLs
  tradeKey: string   // "HVAC" | "PLUMBING" | "DENTAL" | "GENERIC" | etc.

  aiAgentSettings: {
    cheatSheet: {
      manualTriageRules: ManualTriageRule[]
      // (existing CheatSheet stuff – edge cases, behavior, etc.)
    }
    // other aiAgentSettings...
  }

  // V22 memory/optimization stuff already exists:
  aiMaturityLevel: "LEARNING" | "MATURE" | "ULTRA_LEAN"
  optimizationStats: { ... }
}
```

### 1.2 ManualTriageRule (embedded in Company)

These power the "Quick Triage Rules" table and "Test THE BRAIN" section.

```ts
ManualTriageRule {
  keywords: string[]          // must ALL appear
  excludeKeywords: string[]   // if ANY appear → rule blocked
  action: "DIRECT_TO_3TIER" | "EXPLAIN_AND_PUSH" | "ESCALATE_TO_HUMAN" | "TAKE_MESSAGE" | "END_CALL_POLITE"
  intent: string              // e.g. "AC_REPAIR", "BILLING", "GENERIC_QUESTION"
  triageCategory: string      // e.g. "COOLING_NO_COOL", "THERMOSTAT", etc.
  serviceType: "REPAIR" | "MAINTENANCE" | "EMERGENCY" | "OTHER"
  priority: number            // lower < 100 = below cards, higher > 100 = above cards
  enabled: boolean
  notes?: string
}
```

### 1.3 TriageCard (per company)

Stored in `TriageCard` collection. Each card is one "block" in your UI (HVAC emergency, AC tune-up, etc.).

```ts
TriageCard {
  _id: ObjectId
  companyId: ObjectId
  tradeKey: string            // HVAC / PLUMBING / DENTAL / etc.
  triageLabel: string         // "AC_NOT_COOLING", "HVAC_EMERGENCY"
  displayName: string         // "AC not cooling", "HVAC emergency"
  active: boolean

  // Quick rule config – used by runtime matcher
  quickRuleConfig: {
    action: "DIRECT_TO_3TIER" | "EXPLAIN_AND_PUSH" | "ESCALATE_TO_HUMAN" | "TAKE_MESSAGE" | "END_CALL_POLITE"
    intent: string            // "AC_REPAIR", "EMERGENCY"
    triageCategory: string    // "COOLING_NO_COOL", "EMERGENCY"
    serviceType: "REPAIR" | "MAINTENANCE" | "EMERGENCY" | "OTHER"
    priority: number          // 100 default, 150+ for emergency
    keywordsMustHave: string[]
    keywordsExclude: string[]
  }

  // Frontline-Intel script for this scenario
  frontlinePlaybook: {
    goal: string              // short statement: "Book repair ASAP", "Transfer to emergency dispatch"
    steps: string[]           // lines shown in UI, used to guide LLM-C
  }

  // 3-Tier starter content (admin copy-paste, NOT runtime logic)
  threeTierPackageDraft: {
    categoryName: string      // e.g. "Cooling / No Cool"
    categoryDescription: string
    scenarioName: string      // e.g. "AC not cooling at all"
    scenarioObjective: string // "Diagnose cooling failure and book repair"
    // optional: sampleTriggers, sampleReplies[] (for Scenario Forms)
  }

  // Analytics for V22+ / future V23
  matchHistory: {
    totalMatches: number
    successfulOutcomes: number
    lastMatchedAt?: Date
    successRate?: number       // derived
  }

  createdAt: Date
  updatedAt: Date
}
```

### 1.4 Global Trade & Preset Models (factory, not runtime)

These are **global** and not used at runtime — only in the admin factory.

```ts
TradeDefinition {
  _id: ObjectId
  tradeKey: string           // "HVAC" | "PLUMBING" | "DENTAL" | ...
  label: string              // "HVAC (Heating & Cooling)"
  defaultServiceTypes: string[]  // ["REPAIR","MAINTENANCE","EMERGENCY","OTHER"]
  defaultCategories: string[]    // ["Cooling / No Cool", "Heating", "Thermostat", ...]
  // future: default intents, etc.
}

TriagePresetScenario {       // global starter templates
  _id: ObjectId
  tradeKey: string           // which trade this belongs to
  presetKey: string          // "HVAC_AC_NOT_COOLING"
  displayName: string        // "AC not cooling"
  description: string        // short description for admin
  quickRuleSkeleton: { ... } // same shape as quickRuleConfig but generic
  frontlineTemplate: { ... } // text with {{companyName}} tokens
  threeTierTemplate: { ... } // category + scenario + objective templates
}
```

When you "load HVAC starter pack" for a new company, you **clone** a set of `TriagePresetScenario` docs into `TriageCard` docs with that `companyId`.

---

## 2. Runtime Flow (V22 – Per Company)

This is what happens on a live call.

```
INCOMING CALL (Twilio → /v2-agent-respond/:companyID)
    ↓
Load company by companyID
    ↓
Brain-4: MemoryEngine.hydrateMemoryContext(context)
    ↓
Brain-1/2 entry: TriageService.applyQuickTriageRules(context)
    ↓
If quick triage match found:
    triageResult = {
      intent,
      triageCategory,
      serviceType,
      action,
      source: "TRIAGE_CARD" | "MANUAL_RULE",
      triageLabel,
      cardId?
    }
Else:
    triageResult = null (falls back to existing Frontline-Intel logic)
    ↓
Frontline-Intel + 3-Tier Router + CheatSheet Engine (existing V22)
    ↓
LLM-C (if Brain-5 says yes) + TTS
```

### 2.1 TriageService.applyQuickTriageRules(context)

**Input:**
- `companyId`
- raw user text
- company.aiAgentSettings.cheatSheet.manualTriageRules[]
- active TriageCard[] for that company

**Steps:**

1. Normalize user input (lowercase, strip punctuation).

2. Build rule list:
   - From **TriageCards** (active only)
   - From **ManualTriageRules** (enabled only)

3. Sort by `priority` desc, then maybe by `createdAt` for tie-break.

4. Evaluate each rule:
   - If all `keywordsMustHave` appear AND none of `keywordsExclude` appear → match.
   - First match wins.

5. If match from **card**:
   - Set `triageResult` from `card.quickRuleConfig`
   - Attach `context.triageCardId` for analytics
   - Increment `matchHistory` async (post-call learning)

6. If match from **manual rule**:
   - Same, but `source: "MANUAL_RULE"` and no cardId.

7. Attach to context and continue.

**No LLM in this step. Fully deterministic, microseconds.**

---

## 3. Admin Flows

### 3.1 For each CompanyID – Triage Page Layout

Same page you showed, but conceptually three sections:

1. **Triage Cards (V22)** – per-company brain
2. **Quick Triage Rules** – manual overrides inside cheatSheet
3. **AI Triage Builder (LLM-A)** – factory that proposes new cards

#### 3.1.1 Triage Cards

- List of `TriageCard` docs for that `companyId`
- Each card shows:
  - Toggle (active)
  - Display name
  - Trade badge (`HVAC`, `PLUMBING`, etc.)
  - Action badge (3-TIER / HUMAN / PUSH / MSG / END)
  - Uses + success %
- Clicking a card expands:
  - Quick Rule Config (view/edit)
  - Frontline Playbook (goal + steps)
  - 3-Tier Package Draft (category, scenario, objective)
  - "Test this card" input (hit `/triageBuilder/test-rules` with this card only)

#### 3.1.2 Quick Triage Rules

- Table linked to `company.aiAgentSettings.cheatSheet.manualTriageRules`
- Simple adds/edits:
  - keywords, excludeKeywords, serviceType, action, intent, triageCategory, priority
- "Test THE BRAIN" box runs **TriageService** with:
  - All manual rules + all active cards.

#### 3.1.3 AI Triage Builder (LLM-A)

This is your factory, and must be **multi-trade**:

**Inputs:**
- `companyId`
- **Trade** select = from `TradeDefinition.tradeKey`
- Scenario text (free text)
- Service types multi-select = from `TradeDefinition.defaultServiceTypes` for that trade
- Optional flags later: "create multiple cards", etc.

Call `LLMA_TriageCardGenerator.generateDraft({ companyId, tradeKey, scenarioText, serviceTypes })`.

**Output (not auto-live):**

```ts
LLMAOutput {
  quickRuleConfigDraft: {...}      // keywords, action, intent, serviceType, priority
  frontlinePlaybookDraft: {...}    // goal + 3–5 suggested steps
  threeTierPackageDraft: {...}     // category, description, scenario name, objective
  samplePhrases: string[]          // 5–10 example caller utterances
}
```

UI shows this as a **draft card**:
- Admin can:
  - Edit all text
  - Press "Save as Triage Card" → creates a new `TriageCard` for this company
  - Or discard

**LLM-A never runs in production calls. Only here.**

---

## 4. Multi-Trade / Future-Proofing

Everything is keyed by:
- `companyId` (tenant)
- `tradeKey` (domain)

### 4.1 New trade onboarding (e.g., PLUMBING)

1. Create a new `TradeDefinition`:

```ts
tradeKey: "PLUMBING",
label: "Plumbing (Residential)",
defaultServiceTypes: ["REPAIR","MAINTENANCE","EMERGENCY","OTHER"],
defaultCategories: ["Leaks", "Clogs", "Water Heater", "Gas Lines"]
```

2. Create preset scenarios (`TriagePresetScenario`) for plumbing:
   - "Toilet clogged"
   - "Water heater leaking"
   - "Main line backup"
   - etc.

3. For the new plumbing company:
   - Set `company.tradeKey = "PLUMBING"`
   - On triage page, show "Load Plumbing Starter Pack"
   - Cloning process:
     - For each relevant `TriagePresetScenario`:
       - Instantiate a `TriageCard` with:
         - `companyId`
         - `tradeKey`
         - quickRuleConfig
         - frontlinePlaybook
         - threeTierPackageDraft
     - Activate them by default.

4. From then on, runtime doesn't care it's plumbing. It just sees:
   - A bunch of rules and cards for that `companyId`.
   - It matches exactly the same way as HVAC.

If tomorrow you onboard a dentist office or real-estate broker, you just:
- Define a `TradeDefinition` for that niche
- Define some `TriagePresetScenario` templates
- The same UI + backend work as-is.

---

## 5. File / Responsibility Map

| File | Responsibility |
|------|----------------|
| `models/v2Company.js` | Owns `tradeKey`, `aiAgentSettings.cheatSheet.manualTriageRules[]` |
| `models/TriageCard.js` | Per-company cards |
| `models/TradeDefinition.js` | Global trade registry + default service types/categories |
| `models/TriagePresetScenario.js` | Global starter templates per trade |
| `services/TriageService.js` | Runtime matcher - reads cards + manual rules, returns `triageResult` |
| `services/LLMA_TriageCardGenerator.js` | Admin-only LLM that turns scenario text into draft card |
| `routes/admin/triageBuilder.js` | CRUD for TriageCard, `/generate-card`, `/cards/:companyId`, `/test-rules` |
| `services/v2AIAgentRuntime.js` | Main call pipeline - calls TriageService.applyQuickTriageRules |

---

## 6. How an Engineer Should Judge This Design

| Criterion | Status |
|-----------|--------|
| **Multi-tenant** | ✅ Everything runtime is filtered by `companyId`. Global objects only used at admin time. |
| **Multi-trade** | ✅ `tradeKey` is just a dimension on templates/cards; logic doesn't change per trade. |
| **Deterministic runtime** | ✅ No LLM at call time for triage; all LLM is in the factory (LLM-A, admin only). |
| **Extensible** | ✅ Add new trades by adding `TradeDefinition` + preset scenarios; no core code changes. |
| **Debuggable** | ✅ Every match traceable: source, triageLabel, cardId. |
| **Safe** | ✅ If triage fails or no cards, system falls back to existing Frontline-Intel/3-Tier. |

---

## 7. Current Implementation Status

### ✅ DONE
- `models/TriageCard.js` - Full schema
- `services/TriageService.js` - Runtime matcher (cards + manual rules)
- `routes/admin/triageBuilder.js` - CRUD + generate + test
- `services/LLMA_TriageCardGenerator.js` - Draft generator
- HVAC Starter Pack (12 cards) - Seeded to Royal HVAC
- Frontend UI - Cards list with action badges + heatmaps
- AI Triage Builder - V22 upgrade with presets, categories, actions

### 🔲 TODO (V23)
- `models/TradeDefinition.js` - Global trade registry
- `models/TriagePresetScenario.js` - Global starter templates
- Multi-trade preset loading UI
- Self-optimizing suggestions based on matchHistory
- Auto-card-split for high-traffic scenarios

---

*Last updated: 2025-11-29*

