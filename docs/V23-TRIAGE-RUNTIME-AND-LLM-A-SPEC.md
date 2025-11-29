# V23 TRIAGE RUNTIME AND LLM-A SPECIFICATION

> **Status:** AUTHORITATIVE - This is the canonical spec
> **Version:** 1.0 FINAL
> **Date:** 2025-11-29
> **Author:** Lead Architect

---

# 1. Goal (What We're Actually Doing)

We are **not** rebuilding 3-Tier.
We are making sure:

1. Triage is a **fast, dumb, safe router**.
2. 3-Tier remains the **only place** doing real conversation.
3. LLM-A is an **offline admin tool** that helps us **generate clean TriageCards** and avoid admin mistakes.

---

# 2. Runtime Architecture (V22) – Where Triage Lives

### 2.1 Call Flow (Runtime)

```text
INCOMING CALL
  ↓
Brain-0: SmartCallFilter
  - Spam, blocklist, reputation

  ↓
Greeting (TTS)
  - "Thanks for calling {Company}, how can I help?"

  ↓
Twilio → /v2-agent-respond/:companyId → v2AIAgentRuntime.processUserInput()

  1) Load company, cheatSheet, scenarios, callState
  2) Brain-4: MemoryEngine.hydrateMemoryContext(context)
  3) Brain-1/V22: TriageService.applyQuickTriageRules(context)
  4) Brain-2: 3-Tier Router (scenario selection)
  5) Brain-3: CheatSheet Engine (edge case, transfer, guardrails)
  6) Brain-5: Optimization Engine (decide LLM-R/LLM-C yes/no)
  7) LLM-C (if allowed) to shape the response in human voice
  8) TwiML → Twilio → caller hears answer
  9) PostCallLearningService.learnFromCall(context)
```

---

# 3. Roles – Who Does What

## 3.1 Triage (V22) – **Quick Router Only**

**Responsibilities:**

* Look at a single user utterance.
* Decide **"what lane is this?"**:
  * `AC_MAINTENANCE`, `AC_REPAIR`, `EMERGENCY`, `BILLING`, etc.
* Optionally decide action:
  * `DIRECT_TO_3TIER`
  * `ESCALATE_TO_HUMAN`
  * `TAKE_MESSAGE`
  * `END_CALL_POLITE`

**Triage DOES NOT:**

* Generate long, conversational answers.
* Try to "clarify" confused callers.
* Handle multiple turns.
* Use LLM at runtime.

When it's unsure or no rule matches:

```js
context.triageDecision = {
  matched: false,
  intent: "UNKNOWN",
  serviceType: "OTHER",
  action: "DIRECT_TO_3TIER"
};
```

In other words:
"If I'm not sure, I **stop guessing** and push to 3-Tier."

---

## 3.2 3-Tier Engine – **Conversation Brain**

3-Tier is your **real agent brain**:

* Has **categories** (Maintenance, Repair, New System, Billing, Confused, etc.).
* Has **scenarios** with Q&A, fillers, personality.
* Has **negative keywords, synonyms, etc.** already.
* Uses:
  * Tier-1: rules/keywords
  * Tier-2: embeddings
  * Tier-3: LLM-R fallback when needed

3-Tier is the **only place** where we:

* Ask follow-up questions.
* Clarify "What exactly do you need?"
* Sound flexible and human.
* Use LLM to improvise politely and naturally.

If triage passes `intent="UNKNOWN"`, 3-Tier routes to a generic **CONFUSED_CUSTOMER** scenario, which:

* Explains: "No problem, I can help…"
* Offers 2–3 simple options (repair / maintenance / new system).
* Maps the caller into the correct lane and scenario.

---

## 3.3 LLM-A – **Offline Triage Architect (Admin Only)**

LLM-A **never talks to callers**.
LLM-A's job:

* Help admins build TriageCards that route correctly.
* Reduce keyword mistakes.
* Enforce region/trade rules (no furnaces in South Florida, etc.).
* Suggest test phrases and validate coverage.

LLM-A outputs **draft TriageCards**, not replies.

---

# 4. TriageCard Model – Contract

TriageCard is **routing metadata**, not a script engine.

### 4.1 Core Fields

```js
TriageCard {
  _id: ObjectId,
  companyId: ObjectId,
  tradeKey: String,          // "HVAC", "PLUMBING", "DENTAL", etc.
  active: Boolean,
  priority: Number,          // 0-200 (higher = wins)
  displayName: String,       // "AC maintenance / tune-up"
  triageLabel: String,       // "HVAC_AC_MAINTENANCE_TUNEUP"
  
  quickRuleConfig: {
    intent: String,          // "AC_MAINTENANCE", "AC_REPAIR", "BILLING", "UNKNOWN"
    serviceType: String,     // "MAINTENANCE", "REPAIR", "EMERGENCY", "OTHER"
    action: String,          // "DIRECT_TO_3TIER", "ESCALATE_TO_HUMAN", ...
    
    mustHaveKeywords: [String],   // 1–3 short tokens
    excludeKeywords: [String],    // words that disqualify this card
  },

  // This is a HINT for admins → 3-Tier, NOT an automated push:
  threeTierLink: {
    categoryKey: String,     // "HVAC_MAINTENANCE"
    scenarioKey: String      // "AC_TUNEUP_STANDARD"
  },

  stats: {
    uses: Number,
    successRate: Number,     // optional, for future
    lastMatchedAt: Date
  },

  adminNotes: String,
}
```

### 4.2 Matching Logic (Simplified)

Inside `TriageService.applyQuickTriageRules(context)`:

```js
normalize(text); // lowercase, strip punctuation, etc.

for each active card sorted by priority desc:
  if ALL mustHaveKeywords appear in normalized text
    AND NO excludeKeywords appear
      → matched card
      → triageDecision = {
           matched: true,
           intent: card.quickRuleConfig.intent,
           serviceType: card.quickRuleConfig.serviceType,
           action: card.quickRuleConfig.action,
           triageLabel: card.triageLabel
         }
      → attach threeTierLink hints into context
      → stop

if none matched:
  triageDecision = {
    matched: false,
    intent: "UNKNOWN",
    serviceType: "OTHER",
    action: "DIRECT_TO_3TIER"
  }
```

No LLM, no conversation, no heroics. Just keyword routing.

---

# 5. LLM-A Input/Output + Guardrails (V23)

## 5.1 LLM-A Input (what backend sends)

```json
{
  "company": {
    "id": "COMPANY_ID",
    "name": "Penguin Air Cooling & Heating",
    "tradeKey": "HVAC",
    "regionProfile": {
      "climate": "HOT_ONLY",
      "supportsHeating": false,
      "supportsCooling": true
    }
  },
  "triageIdea": {
    "adminTitle": "AC maintenance / tuneup",
    "desiredAction": "DIRECT_TO_3TIER",
    "intentHint": "AC_MAINTENANCE",
    "serviceTypeHint": "MAINTENANCE",
    "threeTierHint": {
      "categoryKey": "HVAC_MAINTENANCE",
      "scenarioKey": "AC_TUNEUP_STANDARD"
    },
    "exampleUtterances": [
      "I want to schedule my AC tuneup",
      "yearly AC maintenance",
      "can you come clean out my AC",
      "I need my AC checked for maintenance"
    ]
  }
}
```

## 5.2 LLM-A Output (what we expect back)

```json
{
  "triageCardDraft": {
    "displayName": "AC maintenance / tune-up",
    "triageLabel": "HVAC_AC_MAINTENANCE_TUNEUP",
    "quickRuleConfig": {
      "intent": "AC_MAINTENANCE",
      "serviceType": "MAINTENANCE",
      "action": "DIRECT_TO_3TIER",

      "mustHaveKeywords": ["ac", "tuneup"],
      "excludeKeywords": ["new unit", "estimate", "quote"]
    },
    "threeTierLink": {
      "categoryKey": "HVAC_MAINTENANCE",
      "scenarioKey": "AC_TUNEUP_STANDARD"
    },
    "adminNotes": "This card is for AC maintenance, not new system estimates."
  },

  "testPlan": {
    "positiveUtterances": [
      "I need to schedule an AC tune-up",
      "I want yearly AC maintenance",
      "I need an AC maintenance visit"
    ],
    "negativeUtterances": [
      "I want a quote for a new AC unit",
      "my bill is too high",
      "I need an electrical panel upgrade"
    ]
  },

  "guardrailFlags": [
    // e.g. "REGION_HEATING_MENTIONED_IN_HOT_ONLY"
  ],

  "validationReport": {
    "status": "PASSED",       // or "NEEDS_REVIEW", "FAILED"
    "coverage": {
      "positiveMatchedCount": 3,
      "positiveTotal": 3,
      "negativeMatchedCount": 0,
      "negativeTotal": 3
    },
    "failures": []
  }
}
```

**Key point:**
LLM-A **never** returns full response scripts. Only routing + hints.

---

## 5.3 Guardrails for LLM-A (Critical)

The prompt / server-side logic must enforce:

1. **No conversation scripts.**
   * You are generating routing metadata, not phone answers.
   * Do not write long conversational replies or dialogues.

2. **Must-have keywords are short and few.**
   * 1–3 tokens max.
   * No full sentences.
   * No overlapping noise (e.g., not "I need AC service for tuneup").

3. **Region/Trade awareness.**
   * For `climate=HOT_ONLY` and `supportsHeating=false`:
     * Do not mention "furnace", "heater", "boiler".
     * If admin utterances contain them, raise a guardrail flag:
       * `REGION_HEATING_MENTIONED_IN_HOT_ONLY`.

4. **Separation of synonyms.**
   * Synonyms must **not** be jammed into `mustHaveKeywords`.
   * LLM-A uses them to design the rule, but the rule stays **minimal**.

5. **Auto-validation.**
   * For each positive utterance:
     * We should be able to confirm they **would** match the generated rule.
   * For each negative:
     * They must **not** match.
   * If not, `validationReport.status = "NEEDS_REVIEW"` or `"FAILED"` with a clear reason.

6. **No direct mutation of 3-Tier.**
   * `threeTierLink` is **a hint** for human/admin:
     * We're not auto-creating scenarios.
     * Admin still maps it manually inside 3-Tier tools.

---

# 6. Admin Workflow – How Cards Get Built

## 6.1 Admin Steps in UI

1. Select **company** (companyId).
2. Select **trade** (HVAC / Plumbing / Dental / etc.).
3. Confirm **region profile** (hot-only / mixed / etc.).
4. Fill triage idea:
   * Title: "AC maintenance / tuneup"
   * Desired action: "DIRECT_TO_3TIER"
   * Intent: `AC_MAINTENANCE` (if they know it)
   * ServiceType: `MAINTENANCE`
   * 3-Tier target (category/scenario) if known.
   * 3–6 example utterances (how callers actually say it).
5. Click **"Generate Triage Card (LLM-A)"**.

Backend:

* Calls `LLMA_TriageCardGeneratorV23.generateTriageCardV23`.
* Runs auto-validation.
* Returns: `triageCardDraft`, `validationReport`, `guardrailFlags`, `testPlan`.

Admin sees:

* Draft card fields.
* PASS / NEEDS_REVIEW / FAILED.
* Flags (e.g. region conflicts).
* Button: "Run Test Against Sample Utterances" (calls `/validate-utterances`).

If satisfied:

* Admin clicks **"Save Card"**.
* Server converts draft to real `TriageCard` document and stores it.

Result:
Next live call hitting those phrases → TriageService routes automatically.

---

# 7. Implementation Checklist for the Engineer

You hand this section directly to the coder.

### 7.1 Runtime (V22) – Triage as Router

- [ ] Confirm `TriageService.applyQuickTriageRules()`:
  - [ ] Reads active TriageCards for company.
  - [ ] Applies normalized keyword matching.
  - [ ] Sets `context.triageDecision` with:
    * `matched`, `intent`, `serviceType`, `action`, `triageLabel`.
  - [ ] On no match, sets:
    ```js
    { matched: false, intent: "UNKNOWN", serviceType: "OTHER", action: "DIRECT_TO_3TIER" }
    ```

- [ ] Confirm 3-Tier Router:
  - [ ] Uses `triageDecision.intent/serviceType` + `threeTierLink` hints when mapping to category/scenario.
  - [ ] Has a generic `CONFUSED_CUSTOMER` scenario for `intent="UNKNOWN"`.

### 7.2 LLM-A Service (V23)

- [ ] Implement `services/LLMA_TriageCardGeneratorV23.js` with:
  - [ ] `generateTriageCardV23(input)`.
  - [ ] Prompt enforces: routing only, no scripts, region guardrails, keyword limits.
  - [ ] Implement local `validateDraftAgainstTestPlan(draft, testPlan)` to simulate matching and set `validationReport`.

- [ ] Add routes:
  - [ ] `POST /api/admin/triage-builder/generate-card-v23`
  - [ ] `POST /api/admin/triage-builder/save-draft-v23`
  - [ ] `POST /api/admin/triage-builder/validate-utterances`

### 7.3 TriageCard Model & Storage

- [ ] Confirm `models/TriageCard.js` matches the contract above.
- [ ] Ensure no large "responseText" fields are used at runtime.
  * If they exist from old builds, mark them clearly as **admin-only notes** or remove them from runtime.

### 7.4 UI Changes

- [ ] In CheatSheet / Triage Builder UI:
  - [ ] Split clearly: "LLM-A Triage Builder (offline)" and "Live Triage Cards (runtime)".
  - [ ] LLM-A section uses `generate-card-v23`.
  - [ ] Card editor only shows routing fields + 3-Tier link hints.
  - [ ] Test button calls backend `/validate-utterances` which uses **same matching logic** as runtime.
  - [ ] No UI element suggests triage will answer questions; all wording is about routing.

---

# 8. Summary – Division of Labor

| Component | Role | Does | Does NOT |
|-----------|------|------|----------|
| **Triage (V22)** | Router | Fast lane decision (1-3 keywords) | Conversation, clarification, LLM |
| **3-Tier** | Agent Brain | Conversation, Q&A, personality | Lane decision |
| **LLM-A** | Card Architect | Generate routing cards offline | Talk to callers |

**Short version for your coder:**

* Triage = **router**, not agent.
* 3-Tier = **agent**, not router.
* LLM-A = **card architect**, not agent.

We didn't break V22/V23. We just made the division of labor bullet-proof and documented how to build the cards correctly with LLM-A and guardrails.

---

# 9. Files Reference

| File | Purpose |
|------|---------|
| `services/TriageService.js` | Runtime quick rule matching |
| `services/LLMA_TriageCardGeneratorV23.js` | Offline card generation |
| `models/TriageCard.js` | Card schema |
| `routes/admin/triageBuilder.js` | Admin API endpoints |
| `docs/V23-TRIAGE-RUNTIME-AND-LLM-A-SPEC.md` | This document |

---

*This is the authoritative specification. All implementation must follow this contract.*

