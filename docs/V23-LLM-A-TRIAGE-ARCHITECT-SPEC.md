# V23: LLM-A Triage Architect Specification

> **Status:** APPROVED - Ready for Implementation
> **Version:** 1.0
> **Date:** 2025-11-29

## Overview

LLM-A evolves from "text writer" to **"triage architect with guardrails"**.

### Core Principle
Admin types ONE sentence → LLM-A designs a safe, minimal triage card + rich 3-Tier triggers + self-tests the card.

---

## 1. LLM-A's Three Jobs

| Job | Description |
|-----|-------------|
| **Design the Lane** | Minimal must-have keywords, clear action |
| **Separate Keywords** | Small set for triage, bigger set for 3-Tier |
| **Self-Check** | Generate test utterances, flag region conflicts |

---

## 2. Input Contract

LLM-A receives structured context (NOT just free text):

```json
{
  "company": {
    "name": "Penguin Air Cooling & Heating",
    "tradeKey": "HVAC",
    "regionProfile": {
      "climate": "HOT_ONLY",          // HOT_ONLY | COLD_ONLY | MIXED
      "supportsHeating": false,
      "supportsCooling": true
    }
  },
  "triageIdea": {
    "highLevelGoal": "Book maintenance",
    "laneHint": "MAINTENANCE",        // REPAIR | MAINTENANCE | EMERGENCY | OTHER
    "adminScenarioText": "customer wants yearly AC tune-up or check up",
    "actionHint": "DIRECT_TO_3TIER"   // admin can override
  }
}
```

### Input Fields

| Field | Required | Description |
|-------|----------|-------------|
| `company.name` | Yes | Company display name |
| `company.tradeKey` | Yes | HVAC, PLUMBING, DENTAL, REAL_ESTATE, etc. |
| `regionProfile.climate` | Yes | HOT_ONLY, COLD_ONLY, or MIXED |
| `regionProfile.supportsHeating` | Yes | Does company offer heating services? |
| `regionProfile.supportsCooling` | Yes | Does company offer cooling services? |
| `triageIdea.highLevelGoal` | Yes | What admin wants to accomplish |
| `triageIdea.laneHint` | Yes | Target service lane |
| `triageIdea.adminScenarioText` | Yes | Free-text scenario description |
| `triageIdea.actionHint` | No | Default action (defaults to DIRECT_TO_3TIER) |

---

## 3. Output Contract

LLM-A returns **strict JSON** with two sections:

```json
{
  "triageCardDraft": {
    "displayName": "AC tune-up / maintenance",
    "serviceType": "MAINTENANCE",
    "intent": "MAINTENANCE",
    "action": "DIRECT_TO_3TIER",

    "keywords": {
      "mustHave": ["tuneup"],
      "optionalSynonyms": [
        "check up", "annual service", "yearly check", "cleaning"
      ],
      "exclude": [
        "not cooling", "no cool", "leaking", "smell", "emergency"
      ],
      "regionConflicts": [
        "furnace", "boiler", "heater"
      ]
    },

    "frontlineGoal": "Book AC maintenance",
    "frontlineLines": [
      "Great idea to get your AC tuned up. I can help you schedule that.",
      "Annual maintenance helps prevent breakdowns. Let me grab a day and time for you."
    ],

    "triageTestUtterances": [
      "I want to schedule my AC tuneup",
      "Can I get an annual AC service?",
      "I need maintenance on my air conditioner"
    ]
  },

  "threeTierScenarioDraft": {
    "categoryName": "Maintenance",
    "scenarioName": "AC general maintenance",
    "objective": "Book a non-emergency AC maintenance appointment",
    "triggers": [
      "ac tuneup", "ac tune up", "ac maintenance",
      "yearly ac service", "annual ac check up", "ac cleaning"
    ],
    "negativeKeywords": [
      "not cooling", "no cool", "water leaking", "smell burning", "system dead"
    ],
    "notes": "Cooling-only market; avoid furnace/heating language."
  }
}
```

### Output Rules

| Section | Content | Goes Where |
|---------|---------|------------|
| `keywords.mustHave` | 1-3 decisive keywords | Triage Card Quick Rule |
| `keywords.optionalSynonyms` | Rich variations | 3-Tier triggers (NOT triage) |
| `keywords.exclude` | Blockers | Triage Card excludeKeywords |
| `keywords.regionConflicts` | Climate/service mismatches | WARNING ONLY (not auto-added) |
| `triageTestUtterances` | 3-5 test phrases | Auto-test before save |
| `threeTierScenarioDraft` | Full scenario skeleton | Admin copies to Scenario Builder |

---

## 4. UI Guardrails

### 4a. Region Conflict Warning

If `regionConflicts` has entries:

```
🔴 REGION CONFLICT WARNING
These terms don't match this company's services:
  • furnace
  • boiler  
  • heater

They will NOT be added to the card unless you explicitly check them.
```

**Default behavior:** Do NOT include region conflicts in saved card.

### 4b. Must-Have vs Synonyms Separation

| Keywords | Display | Location |
|----------|---------|----------|
| `mustHave` | Green pills | Quick Rule Config |
| `optionalSynonyms` | Gray/blue pills | "3-Tier Triggers" section |
| `exclude` | Red pills | Quick Rule Config |

**Button:** "Copy Synonyms to 3-Tier Package" → dumps to 3-Tier draft panel

### 4c. Auto-Test Before Save

When admin clicks **"Create Triage Card"**:

1. Backend calls `/test-rules` with each `triageTestUtterances[]`
2. Show mini test matrix:
   ```
   ✅ "I want to schedule my AC tuneup"
   ✅ "Can I get an annual AC service?"
   ❌ "I need maintenance on my air conditioner"
   ```
3. If any fail:
   ```
   ⚠️ 1 of 3 test phrases did not match this card.
   Fix keywords or adjust test phrases before going live.
   ```

Admin can still save, but they **know the risk**.

---

## 5. Multi-Trade Compatibility

| Trade | regionConflicts Example |
|-------|------------------------|
| HVAC (Florida) | furnace, boiler, heater |
| HVAC (Minnesota) | (none - all services apply) |
| Plumbing (City) | septic, well |
| Dental | extraction (for cleaning card) |
| Real Estate | (TBD) |

**Same JSON contract for all trades.** UI and runtime don't care about trade.

---

## 6. Implementation Checklist

### Backend (`services/LLMA_TriageCardGenerator.js`)

- [ ] Accept structured input (company + triageIdea)
- [ ] Return strict JSON contract
- [ ] Generate `regionConflicts` based on company.regionProfile
- [ ] Generate `triageTestUtterances` for self-checking

### API (`routes/admin/triageBuilder.js`)

- [ ] `POST /generate-card` accepts full input contract
- [ ] `POST /validate-draft` runs test utterances and returns matrix
- [ ] `POST /create-from-draft` saves card after validation

### Frontend (`CheatSheetManager.js` - AI Triage Builder)

- [ ] Input form: tradeKey, regionProfile (from company), laneHint, scenario text
- [ ] Display: mustHave (green), optionalSynonyms (gray), exclude (red)
- [ ] Region conflict warning banner
- [ ] Auto-test matrix before save
- [ ] "Copy to 3-Tier" button

---

## 7. Files Affected

| File | Change |
|------|--------|
| `services/LLMA_TriageCardGenerator.js` | New input/output contract |
| `routes/admin/triageBuilder.js` | New `/validate-draft` endpoint |
| `models/v2Company.js` | Add `regionProfile` to schema |
| `public/js/ai-agent-settings/CheatSheetManager.js` | New UI for triage builder |
| `docs/V23-LLM-A-TRIAGE-ARCHITECT-SPEC.md` | This document |

---

## 8. Success Criteria

- [ ] Admin types ONE sentence, gets complete draft
- [ ] Region conflicts are flagged, not auto-added
- [ ] 3-Tier triggers are separated from triage keywords
- [ ] Auto-test catches keyword mismatches before save
- [ ] Same UI works for HVAC, Plumbing, Dental, Real Estate

---

## 9. Example Flow

1. Admin opens AI Triage Builder for Penguin Air (Florida HVAC, cooling-only)
2. Selects: **Lane = MAINTENANCE**
3. Types: "customer wants yearly AC tune-up"
4. Clicks **Generate Triage Package**
5. LLM-A returns:
   - Card: `HVAC_MAINTENANCE` with `mustHave: ["tuneup"]`
   - 3-Tier: triggers for AC variations
   - Warning: "furnace, heater" flagged as region conflicts
   - Test phrases: 3 utterances pre-generated
6. Admin clicks **Create Card**
7. System auto-tests all 3 phrases
8. Shows: ✅ ✅ ✅ — all pass
9. Card saved, immediately active

**Total time: ~30 seconds. Zero keyword mistakes.**

---

*This is the V23 North Star. Implement this and ClientsVia becomes a platform that prevents human error by design.*

