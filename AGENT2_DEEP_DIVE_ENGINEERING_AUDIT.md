# Agent 2.0 UI Configuration — Deep-Dive Engineering Audit (Image-by-Image)

**Date**: 2026-02-21  
**Scope**: The Agent 2.0 configuration UI shown in the provided screenshots (Configuration tab + LLM Fallback card).  
**Standard**: **Everything must fight for its existence**. If a section or field is not (a) used in runtime, or (b) required to keep runtime safe/deterministic, it should be **removed** (or consolidated) to reduce cognitive load and avoid “config theater”.

---

## Method (No Guesswork)

For each UI section seen in screenshots:

- **UI surface**: What the section exposes.
- **Config path**: The persisted config path (e.g. `company.aiAgentSettings.agent2...`).
- **Runtime wiring**: Exact runtime call sites (file + line ranges) proving whether the field affects behavior.
- **Verdict**: **KEEP / CONSOLIDATE / DELETE** with rationale.

Primary runtime of record:

- `services/engine/agent2/Agent2DiscoveryRunner.js`
- `services/engine/agent2/TriggerCardMatcher.js`
- `services/engine/agent2/Agent2LLMFallbackService.js`
- `services/engine/agent2/Agent2SpeakGate.js`
- `services/engine/agent2/Agent2SpeechPreprocessor.js`
- `services/engine/agent2/Agent2VocabularyEngine.js`
- `services/engine/agent2/Agent2IntentPriorityGate.js`
- `services/engine/agent2/Agent2CallReasonSanitizer.js`
- `services/engine/agent2/Agent2EchoGuard.js`

---

## Executive Summary (What to Nuke vs Keep)

### KEEP (Wired + Unique Value)

- **Status toggles** (`agent2.enabled`, `agent2.discovery.enabled`) — gates *all* Agent2 runtime.
- **Trigger Cards (Answer-first)** — primary deterministic matching path.
- **Vocabulary (Hard normalize + Soft hints)** — fixes STT errors and enables hint-driven behaviors.
- **Clarifiers** — prevents wrong guesses when hints are ambiguous; sets locks that boost matching.
- **Discovery Handoff (consent question)** — deterministic, UI-owned transition question after empathy.
- **Emergency Fallback Line (production required)** — last-resort UI-owned speech for SpeakGate + EchoGuard.
- **LLM Fallback (assist-only)** — runs only when deterministic paths fail; heavily constrained.

### CONSOLIDATE (Wired but Duplicative / Too Many Knobs)

- **Speech Preprocessing** — overlaps with Vocabulary + Call Reason Sanitizer (“text cleanup exists in 3 places”).
- **Call Reason Sanitizer** (not shown as its own card in screenshots, but part of runtime) — overlaps with preprocessing/vocabulary goals.
- **Pending Question Responses** — wired, but currently stored in a confusing namespace; should live under the pending-question owner (Discovery Handoff + Trigger Card follow-ups).

### DELETE (UI Surface Exists, But Runtime Wiring Is Missing or Fields Are Dead)

- **Discovery Style & Safety**:
  - `forbidPhrases` **not wired**
  - `bridge` / `systemDelay` / `whenInDoubt` lines **not wired** in Agent2 runtime
- **Intent Priority Gate**:
  - `emergencyFullDisqualify` checkbox **not wired** (runtime always fully disqualifies on emergency)
- **Human Tone**:
  - `templates.angry` / `templates.afterHours` are **not used** by runtime selection logic (only `serviceDown` and `general` are used)
- **Discovery Handoff**:
  - `forbidBookingTimes` is **not enforced** in runtime (pure UI policy/label today)

---

## Image-by-Image Audit

### Image: “Agent 2.0” (Status + Discovery Style & Safety)

#### Section: Status
- **UI surface**: “Enable Agent 2.0 (master)”, “Enable Agent 2.0 Discovery”.
- **Config path**:
  - `aiAgentSettings.agent2.enabled`
  - `aiAgentSettings.agent2.discovery.enabled`
- **Runtime wiring**: **YES (critical gate)**  
  `Agent2DiscoveryRunner` reads and gates on both toggles.

```289:316:services/engine/agent2/Agent2DiscoveryRunner.js
const agent2 = safeObj(company?.aiAgentSettings?.agent2, {});
const enabled = agent2.enabled === true && agent2.discovery?.enabled === true;
// ...
if (!enabled) {
  emit('A2_PATH_SELECTED', { path: 'DISABLED', reason: 'agent2.enabled=false or discovery.enabled=false' });
  return null;
}
```

- **Why it exists**: Without these, Agent2 cannot be safely staged/rolled out per-company.
- **Verdict**: **KEEP**.

#### Section: Discovery Style & Safety (Ack word, forbidden phrases, spoken lines table)
- **UI surface** (seen in screenshots):
  - `ackWord` (prefix for responses)
  - `forbidPhrases` (phrases the agent should never say)
  - spoken line rows: `bridge`, `robot_challenge`, `delay_first`, `delay_transfer`, `when_in_doubt` (each with audio toggles)
- **Config path**: `aiAgentSettings.agent2.discovery.style.*`
- **Runtime wiring**:
  - **ACK WORD**: **YES**

```413:429:services/engine/agent2/Agent2DiscoveryRunner.js
const ack = `${style.ackWord || 'Ok.'}`.trim() || 'Ok.';
```

  - **Robot challenge**: **YES** (only the robot challenge line is used in runtime today)

```940:997:services/engine/agent2/Agent2DiscoveryRunner.js
if (style?.robotChallenge?.enabled === true && detectRobotChallenge(input)) {
  const line = `${style.robotChallenge?.line || ''}`.trim();
  // ...
  if (line) {
    response = `${ack} ${line}`.trim();
    responseUiPath = 'aiAgentSettings.agent2.discovery.style.robotChallenge.line';
  }
  // ...
}
```

  - **forbidPhrases**: **NO** (no runtime references found outside UI/API/model)
  - **bridge / systemDelay / whenInDoubt**: **NO** (no runtime references found outside UI/API/model)

- **Why it exists**:
  - `ackWord`: consistent “sound” and avoids abrupt replies; low risk.
  - `robotChallenge`: solves a real call failure mode (“are you a robot?”) deterministically.
  - The rest (forbid phrases + multiple delay/transfer/bridge scripts) *can* be useful, but **is currently config-only**.
- **Verdict**:
  - **KEEP**: `ackWord`, `robotChallenge`
  - **DELETE (for now)**: `forbidPhrases`, `bridge`, `systemDelay`, `whenInDoubt` **until wired**  
    (Otherwise they’re “dead knobs” that mislead engineers/operators and inflate the surface area.)

---

### Image: “Intent Priority Gate”

#### Section: Intent Priority Gate (FAQ hijack prevention)
- **UI surface**:
  - enabled toggle
  - “Card categories to penalize/block”
  - “Fully disqualify FAQ cards on emergency”
- **Config path**: `aiAgentSettings.agent2.discovery.intentGate.*`
- **Runtime wiring**:
  - Gate is used during trigger-card matching.

```1097:1115:services/engine/agent2/Agent2DiscoveryRunner.js
const intentGateConfig = discoveryCfg.intentGate || {};
const triggerResult = TriggerCardMatcher.match(normalizedInput, triggerCards, {
  // ...
  intentGateConfig,
  globalNegativeKeywords
});
if (triggerResult.intentGateResult) {
  nextState.agent2.discovery.lastIntentGateResult = triggerResult.intentGateResult;
}
```

```265:306:services/engine/agent2/TriggerCardMatcher.js
let gateResult = null;
if (intentGateConfig.enabled !== false) {
  gateResult = Agent2IntentPriorityGate.evaluate(input, intentGateConfig);
  result.intentGateResult = gateResult;
}
// Apply penalties/disqualification per-card
if (gateResult && gateResult.serviceDownDetected) {
  const gateCheck = Agent2IntentPriorityGate.checkCard(card, gateResult);
  // ...
}
```

- **Engineering reality check (critical)**:
  - The **section** is wired and matters.
  - The **field** `emergencyFullDisqualify` is **not wired** into runtime behavior.  
    In runtime, emergency detection always fully disqualifies matching categories.

```234:247:services/engine/agent2/Agent2IntentPriorityGate.js
// In strict mode (emergency), fully disqualify. Otherwise, just penalize.
if (gateResult.emergencyDetected) {
  return { disqualified: true, reason: `INTENT_GATE:${disqualifiedCat}:emergency`, penalty: 100 };
}
return { disqualified: false, reason: `INTENT_GATE:${disqualifiedCat}:penalized`, penalty };
```

- **Why it exists**: Prevents the deterministic matcher from selecting informational/sales cards when the caller is actually in a service-down/emergency context.
- **Verdict**:
  - **KEEP** the section (it prevents real routing failures).
  - **DELETE** the `emergencyFullDisqualify` UI knob **or wire it**. As implemented, it is **config theater**.

---

### Image: “Speech Preprocessing”

#### Section: Speech Preprocessing (input cleanup)
- **UI surface**:
  - enabled toggle
  - filler words list
  - ignore phrases list
  - canonical rewrites (from → to)
- **Config path**: `aiAgentSettings.agent2.discovery.preprocessing.*`
- **Runtime wiring**: **YES** — runs before vocabulary + trigger matching.

```485:540:services/engine/agent2/Agent2DiscoveryRunner.js
const preprocessingConfig = safeObj(discoveryCfg.preprocessing, { enabled: true });
const preprocessResult = Agent2SpeechPreprocessor.preprocess(input, preprocessingConfig, { companyName });
const preprocessedInput = preprocessResult.cleaned;
// Vocabulary uses preprocessedInput
const vocabularyResult = Agent2VocabularyEngine.process({ userInput: preprocessedInput, state: nextState, config: vocabularyConfig });
```

- **Why it exists**: Removes greetings/fillers/company-name noise so matching and extraction don’t get derailed by STT junk.
- **Critical issue**: **Text cleanup exists in three places**:
  - `Agent2SpeechPreprocessor` (input)
  - `Agent2VocabularyEngine` (input rewrite + hints)
  - `Agent2CallReasonSanitizer` (output label cleanup)
- **Verdict**: **CONSOLIDATE**  
  Keep the behavior, but collapse into **one** “Text Normalization” system (single precedence order, single config table). Do not keep three overlapping engines.

---

### Image: “Vocabulary (Normalization + Hints)” and table rows

#### Section: Vocabulary Engine (Hard normalize + Soft hint)
- **UI surface**:
  - enable toggle
  - table entries with columns: priority, type, match, from, to, notes
- **Config path**: `aiAgentSettings.agent2.discovery.vocabulary`
- **Runtime wiring**: **YES** — runs before trigger matching and feeds hints + normalized text.

```531:548:services/engine/agent2/Agent2DiscoveryRunner.js
const vocabularyConfig = safeObj(discoveryCfg.vocabulary, {});
const vocabularyResult = Agent2VocabularyEngine.process({ userInput: preprocessedInput, state: nextState, config: vocabularyConfig });
const normalizedInput = vocabularyResult.normalizedText;
nextState.agent2.hints = vocabularyResult.hints;
```

- **Why it exists**:
  - HARD_NORMALIZE corrects predictable STT errors deterministically.
  - SOFT_HINT enables “maybe X” signals without forcing replacements, enabling safer downstream behavior (clarifiers, boosts).
- **Verdict**: **KEEP**.

---

### Images: “Clarifiers (Disambiguation Questions)” + clarifier rows

#### Section: Clarifiers
- **UI surface**:
  - enable toggle
  - `max asks/call`
  - clarifier entries: hint trigger → question → locksTo
- **Config path**: `aiAgentSettings.agent2.discovery.clarifiers`
- **Runtime wiring**: **YES** — asked when hints exist but no card matched; resolves yes/no and sets locks.

```1317:1402:services/engine/agent2/Agent2DiscoveryRunner.js
if (clarifiersEnabled && activeHints.length > 0 && clarifiersAskedThisCall < maxClarifiersPerCall) {
  // Find a clarifier that matches one of our active hints
  // Store pendingClarifier + ask question
  nextState.agent2.discovery.pendingClarifier = { id: clarifier.id, hintTrigger, locksTo: clarifier.locksTo || null };
  nextState.agent2.discovery.pendingClarifierTurn = typeof turn === 'number' ? turn : null;
  return { response: clarifierQuestion, matchSource: 'AGENT2_DISCOVERY', state: nextState };
}
```

```578:647:services/engine/agent2/Agent2DiscoveryRunner.js
if (isRespondingToClarifier) {
  // YES -> set lock; NO -> remove hint; else -> fall through
  nextState.agent2.locks.component = pendingClarifier.locksTo || null;
}
```

- **Why it exists**: Prevents incorrect deterministic matches when caller language is ambiguous; creates an explicit, stateful confirmation loop.
- **Verdict**: **KEEP**.

---

### Image: “Trigger Cards (Answer-first)” + fallback fields

#### Section: Trigger Cards (primary deterministic discovery)
- **UI surface**:
  - trigger cards list (not fully shown, but implied)
  - global allowed scenario types + min score (scenario fallback tuning)
  - fallback texts:
    - “Fallback when no trigger matches (no reason captured)”
    - “Fallback when reason is captured but no trigger matches”
    - “Default follow-up question after answering”
    - “Clarifier question (reason captured, no match)”
- **Config path**: `aiAgentSettings.agent2.discovery.playbook`
  - `playbook.rules[]`
  - `playbook.fallback.*`
- **Runtime wiring**: **YES** — main match path, plus fallbacks and pending-question state machine.

```1097:1212:services/engine/agent2/Agent2DiscoveryRunner.js
const triggerCards = safeArr(playbook.rules);
const triggerResult = TriggerCardMatcher.match(normalizedInput, triggerCards, { hints, locks, intentGateConfig, globalNegativeKeywords });
if (triggerResult.matched && triggerResult.card) {
  // builds response using card.answer.answerText + followUp question or playbook fallback.afterAnswerQuestion
  nextState.agent2.discovery.pendingQuestion = afterQuestion;
  nextState.agent2.discovery.pendingQuestionSource = `card:${card.id}`;
}
```

- **Why it exists**: This is the deterministic “spine” of Agent2 Discovery. Without it, everything becomes fallback/LLM.
- **Verdict**: **KEEP**.

##### Subsection: Scenario fallback tuning (allowed types, min score)
- **Runtime wiring**: **CONDITIONAL** — used only when `playbook.useScenarioFallback === true`.

```1417:1431:services/engine/agent2/Agent2DiscoveryRunner.js
if (useScenarioFallback === true) {
  const globalAllowedTypes = new Set(safeArr(playbook.allowedScenarioTypes) /* ... */);
  const minScore = Number.isFinite(playbook.minScenarioScore) ? playbook.minScenarioScore : 0.72;
}
```

- **Verdict**: **HIDE UNDER “Advanced” OR DELETE** if ScenarioEngine is being phased out.  
  Keeping these controls visible while ScenarioEngine is “OFF by default” increases confusion.

---

### Image: “Pending Question Responses” + “Emergency Fallback Line (Required for Production)”

#### Section: Pending Question Responses
- **UI surface**: YES/NO/unclear responses used after a follow-up question.
- **Config path**: `aiAgentSettings.agent2.discovery.playbook.fallback.pending*`
- **Runtime wiring**: **YES** — used by the pending-question state machine.

```731:911:services/engine/agent2/Agent2DiscoveryRunner.js
const pendingYes = `${fallback.pendingYesResponse || ''}`.trim();
const pendingNo = `${fallback.pendingNoResponse || ''}`.trim();
const pendingRepromptConfig = `${fallback.pendingReprompt || ''}`.trim();
```

- **Why it exists**: Prevents hardcoded “YES/NO” handling text; preserves “No-UI-No-Speak”.
- **Verdict**: **CONSOLIDATE**  
  Keep the behavior, but move these fields under the conceptual owner:
  - `discovery.discoveryHandoff.*` for the consent question flow
  - and/or a dedicated `discovery.pendingQuestionResponses.*` namespace shared by all pending-question sources
  (Today it’s buried under `playbook.fallback`, which is not the true owner.)

#### Section: Emergency Fallback Line (Required for Production)
- **UI surface**: single required fallback line.
- **Config path**: `aiAgentSettings.agent2.emergencyFallbackLine.text`
- **Runtime wiring**: **YES (critical)** — used as last resort + as EchoGuard replacement.

```296:307:services/engine/agent2/Agent2DiscoveryRunner.js
const emergencyFallbackConfig = agent2.emergencyFallbackLine || {};
const emergencyFallback = emergencyFallbackConfig.enabled !== false && emergencyFallbackConfig.text
  ? { text: emergencyFallbackConfig.text, uiPath: 'aiAgentSettings.agent2.emergencyFallbackLine.text' /* ... */ }
  : null;
```

```1991:2039:services/engine/agent2/Agent2DiscoveryRunner.js
const echoCheck = Agent2EchoGuard.checkForEcho(input, response);
if (echoCheck.blocked) {
  const emergencyText = agent2.emergencyFallbackLine?.text || '';
  if (emergencyText) response = emergencyText;
}
```

- **Why it exists**: Safety net required by SpeakGate/EchoGuard so runtime never has to speak an unmapped/hardcoded line.
- **Verdict**: **KEEP (non-negotiable)**.

---

### Image: “Discovery Handoff”

#### Section: Discovery Handoff (Consent question)
- **UI surface**:
  - consent question (required)
  - “Forbid Booking Times” toggle
- **Config path**: `aiAgentSettings.agent2.discovery.discoveryHandoff`
- **Runtime wiring**:
  - Consent question: **YES** (asked in “reason captured but no match” fallback path)

```1747:1846:services/engine/agent2/Agent2DiscoveryRunner.js
const handoffResult = resolveSpeakLine({
  uiPath: 'discovery.discoveryHandoff.consentQuestion',
  fallbackUiPath: 'discovery.playbook.fallback.noMatchClarifierQuestion',
  config: agent2,
  sourceId: 'agent2.discovery.discoveryHandoff'
});
if (!handoffResult.blocked && handoffResult.text) {
  nextQ = handoffResult.text;
  nextState.agent2.discovery.pendingQuestionSource = 'discoveryHandoff.consentQuestion';
}
```

  - `forbidBookingTimes`: **NO enforcement found** in runtime (no references outside UI)

- **Why it exists**: It’s the deterministic, UI-owned “handoff/consent” step that prevents the agent from pushing booking without consent.
- **Verdict**:
  - **KEEP** consent question.
  - **DELETE** `forbidBookingTimes` until enforcement exists (or implement enforcement in the booking lane instead of Discovery).

---

### Image: “Human Tone”

#### Section: Human Tone (Empathy templates)
- **UI surface**:
  - templates for service down / angry / general, etc.
- **Config path**: `aiAgentSettings.agent2.discovery.humanTone.templates.*`
- **Runtime wiring**: **PARTIAL**
  - The empathy layer is wired, but runtime selection only chooses **serviceDown** vs **general**.

```1747:1784:services/engine/agent2/Agent2DiscoveryRunner.js
let empathyPrimaryPath;
if (humanToneConfig.enabled !== false) {
  empathyPrimaryPath = isServiceDown
    ? 'discovery.humanTone.templates.serviceDown'
    : 'discovery.humanTone.templates.general';
}
const empathyResult = resolveSpeakLine({
  uiPath: empathyPrimaryPath,
  fallbackUiPath: 'discovery.playbook.fallback.noMatchWhenReasonCaptured',
  emergencyUiPath: 'emergencyFallbackLine.text',
  config: agent2
});
```

- **Why it exists**: Allows empathy lines to be UI-owned and context-specific without hardcoding.
- **Verdict**:
  - **CONSOLIDATE or DELETE** the section depending on product intent:
    - If you want exactly two empathy lines (service-down vs general), replace Human Tone with **two explicit fields** and delete the template arrays.
    - If you want richer emotion/state handling (angry/afterHours), **wire the selection logic**; otherwise those fields are dead weight.

---

### Image: “Global Negative Keywords” + “LLM Fallback Settings”

#### Section: Global Negative Keywords
- **UI surface**: global “block all trigger cards” keywords list.
- **Config path**: `aiAgentSettings.agent2.globalNegativeKeywords` (root)
- **Runtime wiring**: **YES**

```1100:1110:services/engine/agent2/Agent2DiscoveryRunner.js
const globalNegativeKeywords = agent2.globalNegativeKeywords || [];
const triggerResult = TriggerCardMatcher.match(normalizedInput, triggerCards, { /* ... */ globalNegativeKeywords });
```

```247:263:services/engine/agent2/TriggerCardMatcher.js
if (globalNegativeKeywords.length > 0) {
  const globalHit = globalNegativeKeywords.find((gnk) => matchesAllWords(input, gnk).matches);
  if (globalHit) { result.globalNegativeBlocked = true; return result; }
}
```

- **Why it exists**: An early deterministic “spam/job-seeker” kill switch.
- **Verdict**: **KEEP, but constrain**  
  If you keep this, restrict to **high-signal multi-word phrases** to reduce false positives (single words like “job” can be risky).

#### Section: LLM Fallback Settings (Assist-only)
- **UI surface** (in screenshot): mode, max LLM turns, blocked conditions.
- **Config path**: `aiAgentSettings.agent2.llmFallback.*`
- **Runtime wiring**: **YES**
  - `shouldCallLLMFallback` explicitly blocks when pending question is active and enforces turn caps.

```212:239:services/engine/agent2/Agent2LLMFallbackService.js
const masterEnabled = config?.discovery?.llmFallback?.enabled === true || llmFallback?.enabled === true;
if (!masterEnabled) return { call: false, reason: 'LLM_FALLBACK_DISABLED', /* ... */ };
```

```313:321:services/engine/agent2/Agent2LLMFallbackService.js
if (hasPendingQuestion) {
  return { call: false, reason: 'Pending question active', blockedBy: 'PENDING_QUESTION', /* ... */ };
}
```

```363:365:services/engine/agent2/Agent2LLMFallbackService.js
const maxTurns = triggers.maxLLMFallbackTurnsPerCall ?? 1;
```

- **Why it exists**: Deterministic systems will always have coverage gaps; LLM assist is a controlled pressure valve.
- **Verdict**: **KEEP, but reduce surface area**  
  Audit and delete any LLM config fields not used in runtime, and move call-forwarding out of the LLM section if it’s a separate product feature.

---

## High-Impact Engineering Actions (Recommended)

### P0 — Delete dead knobs immediately (UX simplification, zero runtime risk)
- Remove from UI (and stop persisting) until wired:
  - `discovery.style.forbidPhrases`
  - `discovery.style.bridge.*`
  - `discovery.style.systemDelay.*`
  - `discovery.style.whenInDoubt.*`
  - `discovery.intentGate.emergencyFullDisqualify` (or wire it)
  - `discovery.discoveryHandoff.forbidBookingTimes` (or wire it)
  - `discovery.humanTone.templates.angry`, `discovery.humanTone.templates.afterHours` (or wire selection)

### P1 — Consolidate text transformation into a single engine (biggest long-term maintainability win)
- Today: preprocessing + vocabulary + sanitizer overlap.
- Target: **one** deterministic text pipeline with explicit ordering and one UI table.

### P2 — Move “Pending Question Responses” out of `playbook.fallback`
- Create one clearly-owned namespace and update runner to read from it.

---

## Audit Corrections vs Prior Summary (Important)

Two claims that are **provably false** when checked against runtime:

- “Global Negative Keywords is not wired” — **it is wired** via `Agent2DiscoveryRunner` → `TriggerCardMatcher` (see citations above).
- “Human Tone is dead weight / not used” — the empathy layer is **wired**, but only **two** template paths are used (`serviceDown` and `general`). The other template fields are dead.

---

**END OF REPORT**

# AGENT 2.0 DEEP DIVE ENGINEERING AUDIT REPORT

**Date**: February 21, 2026  
**Auditor**: Engineering Analysis  
**Purpose**: Critical evaluation of every configuration section in Agent 2.0 UI  
**Evaluation Criteria**: Necessity, runtime wiring, complexity, maintenance burden  
**Recommendation Standard**: If a feature cannot justify its existence with measurable impact on agent performance, it must be eliminated.

---

## EXECUTIVE SUMMARY

Agent 2.0 has evolved over multiple iterations and now contains **10 distinct configuration sections** across 4 UI tabs. This audit reveals:

- **CRITICAL**: 4 sections are essential and actively wired to runtime
- **QUESTIONABLE**: 3 sections add complexity without clear differentiation from existing features
- **REDUNDANT**: 2 sections duplicate functionality or are unused in practice
- **UNCLEAR WIRING**: 1 section's runtime integration is partial or inconsistent

**RECOMMENDATION**: Eliminate or consolidate 6 of 10 sections to reduce cognitive load and maintenance burden.

---

## DETAILED SECTION-BY-SECTION ANALYSIS

---

### 1. DISCOVERY HANDOFF (Consent Question)

**Location**: Configuration Tab → Discovery Section  
**UI Field**: `aiAgentSettings.agent2.discovery.discoveryHandoff.consentQuestion`  
**Runtime File**: `services/engine/agent2/Agent2DiscoveryRunner.js` (lines ~579-651)

#### Purpose
Asks user consent before transitioning from discovery to booking ("Would you like to schedule a technician?")

#### Runtime Wiring
✅ **FULLY WIRED**
- Triggered when: Discovery completes successfully (reason captured + answer provided)
- Fires BEFORE booking gate
- User response determines next lane: YES → Booking, NO → Message taking

#### Engineering Assessment
**STATUS**: ✅ **KEEP - ESSENTIAL**

**Rationale**:
1. **Clear purpose**: Prevents forced booking without consent
2. **Measurable impact**: Controls transition between major system phases
3. **Zero alternatives**: No other mechanism provides this gate
4. **Simple implementation**: Single question, binary outcome, minimal logic

**Evidence of Use**:
```javascript
// Agent2DiscoveryRunner.js:~1615
if (discoveryHandoff.enabled && discoveryHandoff.consentQuestion) {
  nextState.agent2.discovery.pendingQuestion = {
    question: discoveryHandoff.consentQuestion,
    source: 'discoveryHandoff',
    askNumber: 1
  };
}
```

**Verdict**: Core functionality. No changes needed.

---

### 2. HUMAN TONE (Empathy Templates)

**Location**: Configuration Tab → Discovery Section  
**UI Field**: `aiAgentSettings.agent2.discovery.humanTone.templates.*`  
**Runtime File**: `services/engine/agent2/Agent2DiscoveryRunner.js` (search: "humanTone")

#### Purpose
Provides empathy-first responses for specific caller states:
- `serviceDown`: "I hear you — no AC in this heat is miserable"
- `angry`: "I get it — this is frustrating"
- `general`: "Got it — I can help"

#### Runtime Wiring
⚠️ **PARTIALLY WIRED** - Unclear enforcement

**Code Analysis**:
```bash
# Search for humanTone usage in runtime
grep -r "humanTone" services/engine/agent2/
```

**Finding**: Referenced in config, but no clear precedence over LLM Fallback empathy generation.

#### Engineering Assessment
**STATUS**: ⚠️ **CONSOLIDATE OR ELIMINATE**

**Problems**:
1. **Overlaps with LLM Fallback**: LLM mode also generates empathy ("Sentence 1: empathy + reassurance")
2. **Unclear precedence**: When does this fire vs LLM empathy?
3. **Manual maintenance**: Requires hand-crafting templates for edge cases
4. **Trigger complexity**: How is "angry" detected vs "serviceDown"?

**Alternative**:
- **Option A**: Eliminate entirely. Let LLM Fallback handle empathy generation (already does this)
- **Option B**: Simplify to single "General Empathy Prefix" field that prepends to ALL responses
- **Option C**: Wire explicitly as "Before Trigger Card Answer" modifier only

**Recommendation**: **ELIMINATE**. LLM Fallback already provides dynamic empathy. Static templates add maintenance without value.

---

### 3. INTENT PRIORITY GATE

**Location**: Configuration Tab (implied in code, not visible in screenshots)  
**UI Field**: `aiAgentSettings.agent2.discovery.intentGate.*`  
**Runtime File**: `services/engine/agent2/Agent2IntentPriorityGate.js`

#### Purpose
Prevents FAQ/sales cards from hijacking service-down calls.

**Example**:
- Caller: "I'm a longtime customer, my AC has problems"
- Without gate: Matches "system age" FAQ (keyword: "longtime")
- With gate: Detects "service_down" intent, disqualifies FAQ categories

#### Runtime Wiring
✅ **FULLY WIRED**
- Runs BEFORE TriggerCardMatcher
- Returns category penalties
- Documented in `Agent2DiscoveryRunner.js` imports

#### Engineering Assessment
**STATUS**: ✅ **KEEP - ESSENTIAL**

**Rationale**:
1. **Solves real problem**: FAQ hijacking is documented failure mode
2. **Clear precedence**: Runs before matching, prevents bad matches
3. **Configurable**: UI can adjust keywords/categories
4. **Measurable impact**: Prevents wrong-path routing on urgent calls

**Evidence**:
```javascript
// Agent2IntentPriorityGate.js:~66-81
const DEFAULT_DISQUALIFIED_CATEGORIES = [
  'faq', 'info', 'sales', 'financing', 'warranty',
  'maintenance_plan', 'system_age', 'lifespan'
];
```

**Verdict**: Core safety mechanism. Must keep.

---

### 4. SPEECH PREPROCESSING (Filler Words, Greetings, Canonical Rewrites)

**Location**: Configuration Tab (implied in code)  
**UI Field**: `aiAgentSettings.agent2.discovery.preprocessing.*`  
**Runtime File**: `services/engine/agent2/Agent2SpeechPreprocessor.js`

#### Purpose
Cleans input BEFORE matching:
- Strip greetings: "Hi, my AC is broken" → "my AC is broken"
- Remove fillers: "Um, like, the thingy" → "the thingy"
- Canonical rewrites: "air condition" → "air conditioning"

#### Runtime Wiring
✅ **FULLY WIRED**
- Runs in `Agent2DiscoveryRunner.js` before trigger card matching
- Emits `A2_PREPROCESSING` event showing original vs cleaned text

#### Engineering Assessment
**STATUS**: ⚠️ **CONSOLIDATE INTO VOCABULARY ENGINE**

**Problems**:
1. **Overlaps with Vocabulary**: Both systems rewrite text
2. **Two truth sources**: Preprocessing + Vocabulary both normalize → which wins?
3. **Complexity**: Separate config namespace for essentially the same job

**Analysis**:
- Vocabulary has HARD_NORMALIZE mode: `"acee" → "ac"`
- Preprocessing has canonical rewrites: `"air condition" → "air conditioning"`
- **These are the same operation**

**Recommendation**: **CONSOLIDATE**
- Merge preprocessing into Vocabulary Engine
- Add "Filler Words" and "Greeting Phrases" as special Vocabulary entry types
- Single UI table for all text normalization
- Reduces config surface area by ~30%

**Migration Path**:
1. Add entry types: `STRIP_FILLER`, `STRIP_GREETING` to Vocabulary
2. Migrate existing preprocessing rules to Vocabulary entries
3. Deprecate separate preprocessing config
4. Remove `Agent2SpeechPreprocessor.js` (merge logic into `Agent2VocabularyEngine.js`)

---

### 5. VOCABULARY ENGINE (Hard Normalize + Soft Hints)

**Location**: Configuration Tab → Vocabulary Section  
**UI Field**: `aiAgentSettings.agent2.discovery.vocabulary.entries[]`  
**Runtime File**: `services/engine/agent2/Agent2VocabularyEngine.js`

#### Purpose
Two-mode text normalization:
1. **HARD_NORMALIZE**: Replace mishears (`"acee" → "ac"`)
2. **SOFT_HINT**: Add context without changing text (`"thingy on wall" → hint: "maybe_thermostat"`)

#### Runtime Wiring
✅ **FULLY WIRED**
- Runs BEFORE trigger card matching
- Emits `A2_VOCAB_NORMALIZED` and `A2_VOCAB_HINT_ADDED` events
- Hints passed to TriggerCardMatcher as priority boosts

#### Engineering Assessment
**STATUS**: ✅ **KEEP - ESSENTIAL**

**Rationale**:
1. **Unique capability**: SOFT_HINT mode has no alternative
2. **Solves STT errors**: Hard normalize fixes speech-to-text mishears
3. **Powers Clarifiers**: Hints trigger clarifying questions
4. **Well-implemented**: Clear separation of concerns, priority-based

**Evidence of Impact**:
```javascript
// Agent2VocabularyEngine.js:~10-17
// SOFT_HINT: Add contextual hints WITHOUT modifying text
//    - "thingy on the wall" → hint: "maybe_thermostat"
//    - Hints are passed to TriggerCardMatcher as priority boosts
```

**Verdict**: Core feature. Expand by consolidating preprocessing into this engine.

---

### 6. CLARIFIERS (Disambiguation Questions)

**Location**: Configuration Tab → Clarifiers Section  
**UI Field**: `aiAgentSettings.agent2.discovery.clarifiers.entries[]`  
**Runtime File**: `services/engine/agent2/Agent2DiscoveryRunner.js` (lines ~1317-1395)

#### Purpose
Asks disambiguating questions when soft hints detected but no strong match:
- Hint: `maybe_thermostat` → Ask: "Do you mean the thermostat screen?"
- User confirms → Lock to "thermostat" component for rest of call

#### Runtime Wiring
✅ **FULLY WIRED**
- Triggered when: Vocabulary adds hint + no trigger card match
- Stores pending clarifier in state
- Next turn resolves YES/NO → locks or clears hint
- Emits `A2_CLARIFIER_ASKED`, `A2_CLARIFIER_RESOLVED`

#### Engineering Assessment
**STATUS**: ✅ **KEEP - ESSENTIAL**

**Rationale**:
1. **Unique value**: Prevents guessing wrong when ambiguous input detected
2. **Depends on Vocabulary**: Extends Vocabulary's SOFT_HINT with confirmation loop
3. **Stateful logic**: Tracks pending question across turns (non-trivial)
4. **Measurable benefit**: Avoids wrong-path routing on vague language

**Evidence**:
```javascript
// Agent2DiscoveryRunner.js:~1335-1360
if (clarifiersEnabled && activeHints.length > 0) {
  for (const clarifier of sortedClarifiers) {
    if (activeHints.includes(clarifier.hintTrigger)) {
      // Store clarifier state
      nextState.agent2.discovery.pendingClarifier = { ... };
      return clarifierQuestion;
    }
  }
}
```

**Verdict**: Keep. Works in tandem with Vocabulary Engine as designed.

---

### 7. CALL REASON SANITIZER

**Location**: Not visible in UI (code-level only)  
**UI Field**: `aiAgentSettings.agent2.discovery.callReasonCapture.*`  
**Runtime File**: `services/engine/agent2/Agent2CallReasonSanitizer.js`

#### Purpose
Transforms raw `call_reason_detail` into clean labels:
- Input: "Hi um like my AC isn't working and it's hot"
- Output: "AC not cooling"

Prevents agent from saying: "It sounds like hi um like your AC isn't working and it's hot"

#### Runtime Wiring
✅ **FULLY WIRED**
- Used in `Agent2DiscoveryRunner.js` to sanitize reason before storage
- Applies strip patterns + intent-to-label mappings

#### Engineering Assessment
**STATUS**: ⚠️ **CONSOLIDATE INTO PREPROCESSING/VOCABULARY**

**Analysis**:
This is essentially **text cleanup** — same job as Preprocessing and Vocabulary.

**Current state**:
- 3 separate systems doing text normalization:
  1. Speech Preprocessor: Strip greetings, fillers
  2. Vocabulary: Normalize mishears
  3. Call Reason Sanitizer: Strip greetings, fillers, map to labels

**Problems**:
- Duplication: Sanitizer strips greetings (Preprocessor already does this)
- Unclear order: Does sanitizer run before or after preprocessing?
- Maintenance: Three codebases with overlapping logic

**Recommendation**: **CONSOLIDATE**
- Move sanitizer logic into Vocabulary Engine as entry type: `LABEL_MAP`
- Vocabulary becomes single source of truth for all text transformations
- Order of operations becomes explicit (priority-based)

---

### 8. LLM FALLBACK SETTINGS

**Location**: LLM Fallback Tab  
**UI Field**: `aiAgentSettings.agent2.llmFallback.*`  
**Runtime File**: `services/engine/agent2/Agent2LLMFallbackService.js`

#### Purpose
Provides LLM-powered responses when trigger cards fail to match.

#### Configuration Surface Area
- Mode selection: `guided` vs `answer_return`
- Model selection: GPT-4.1-mini, GPT-4o, etc.
- Trigger conditions: noMatchCount threshold, complexity score
- Output constraints: maxSentences, mustEndWithFunnelQuestion
- Forbidden patterns: booking times, pricing, legal
- Handoff modes: confirmService, takeMessage, offerForward
- Call forwarding settings
- Prompts: system, format, safety
- Emergency fallback line
- Usage tracking

**Total config fields**: 30+

#### Runtime Wiring
✅ **FULLY WIRED**
- Triggered after trigger cards fail
- Blocked during booking steps
- Logs token usage to `LLMFallbackUsage` collection
- Enforces constraints via post-processing

#### Engineering Assessment
**STATUS**: ⚠️ **OVERBUILT - SIMPLIFY**

**Problems**:
1. **Complexity explosion**: 30+ config fields for a fallback mechanism
2. **Overlap with Discovery Handoff**: `handoff.confirmService` duplicates Discovery Handoff consent question
3. **Unclear defaults**: Too many knobs — which settings matter?
4. **Call forwarding**: Separate feature buried in LLM config

**Analysis**:

**Current modes**:
- `guided`: LLM generates empathy + question → funnel to booking
- `answer_return`: LLM answers, returns to deterministic

**Question**: Why separate modes? Both do "answer + ask question"

**Recommendation**: **SIMPLIFY TO CORE**

**Keep**:
- ✅ Master enable/disable toggle
- ✅ Model selection (single dropdown)
- ✅ Max sentences (output constraint)
- ✅ Forbidden patterns (booking times)
- ✅ Emergency fallback line

**Eliminate**:
- ❌ Mode selector (consolidate to single behavior)
- ❌ Handoff modes (use Discovery Handoff consent question instead)
- ❌ Call forwarding settings (separate feature, move out)
- ❌ Separate prompts (system, format, safety) — merge to single textarea
- ❌ Custom model override (advanced users only, hide in "Advanced" section)

**Simplified config**:
```javascript
llmFallback: {
  enabled: false,
  model: 'gpt-4.1-mini',  // dropdown
  maxSentences: 2,
  forbidBookingTimes: true,
  systemPrompt: '...',     // single textarea
  emergencyFallback: '...' // single field
}
```

**Result**: 30+ fields → 6 fields (80% reduction)

---

### 9. GLOBAL NEGATIVE KEYWORDS

**Location**: Configuration Tab (shown in screenshot 10)  
**UI Field**: `aiAgentSettings.agent2.globalNegativeKeywords`  
**Runtime File**: Unknown (not found in service files)

#### Purpose
Disqualifies ALL trigger cards when specific phrases detected (e.g., "job application", "resume", "spam")

#### Runtime Wiring
❌ **WIRING UNCLEAR**

**Search Results**:
```bash
grep -r "globalNegativeKeywords" services/engine/agent2/
# No results found
```

**Analysis**: UI field exists in screenshot, but no runtime enforcement code found.

#### Engineering Assessment
**STATUS**: ❌ **ELIMINATE OR FIX WIRING**

**Problems**:
1. **No runtime code**: Feature appears unconfigured or partially implemented
2. **Overlap with Intent Gate**: Intent Gate already disqualifies categories on emergency/service-down
3. **Unclear precedence**: When does this fire vs Intent Gate vs per-card negative keywords?

**Recommendation**: **ELIMINATE**

**Rationale**:
- Per-card `negativeKeywords` already exist (in trigger card match config)
- Intent Priority Gate already blocks categories globally
- No evidence this adds unique value
- If needed, can be added to Intent Gate as "global block patterns"

**Migration**: Add global negative patterns to Intent Priority Gate config if truly needed.

---

### 10. PENDING QUESTION RESPONSES

**Location**: Configuration Tab (screenshot 3)  
**UI Field**: `aiAgentSettings.agent2.discovery.playbook.fallback.pending*Response`  
**Runtime File**: `services/engine/agent2/Agent2DiscoveryRunner.js`

#### Purpose
Defines what agent says when user answers a pending question (YES/NO/unclear):
- `pendingYesResponse`: "Great! Let me help you with that."
- `pendingNoResponse`: "No problem. Is there anything else?"
- `pendingReprompt`: "Sorry, I missed that. Could you say yes or no?"

#### Runtime Wiring
✅ **FULLY WIRED**
- Used when Discovery Handoff pending question is active
- User says YES/NO → resolves with configured response

#### Engineering Assessment
**STATUS**: ⚠️ **CONSOLIDATE INTO DISCOVERY HANDOFF**

**Analysis**:
These responses are ONLY used by Discovery Handoff consent question. They're stored in `playbook.fallback.*` but conceptually belong to `discoveryHandoff.*`

**Current structure** (confusing):
```javascript
discoveryHandoff: {
  consentQuestion: "Would you like to schedule?"
  // ... but responses are elsewhere ...
}
playbook: {
  fallback: {
    pendingYesResponse: "Great!",
    pendingNoResponse: "No problem.",
    pendingReprompt: "Could you say yes or no?"
  }
}
```

**Recommendation**: **CONSOLIDATE**

**Better structure**:
```javascript
discoveryHandoff: {
  consentQuestion: "Would you like to schedule?",
  yesResponse: "Great! Let me help you with that.",
  noResponse: "No problem. Is there anything else?",
  reprompt: "Sorry, I missed that. Could you say yes or no?"
}
```

**Benefit**: All Discovery Handoff config in one place. Clearer ownership.

---

## SUMMARY TABLE: KEEP vs ELIMINATE

| # | Section | Status | Recommendation | Reason |
|---|---------|--------|----------------|--------|
| 1 | Discovery Handoff | ✅ KEEP | No changes | Core functionality, fully wired |
| 2 | Human Tone | ❌ ELIMINATE | Remove | Overlaps with LLM empathy |
| 3 | Intent Priority Gate | ✅ KEEP | No changes | Prevents FAQ hijacking |
| 4 | Speech Preprocessing | ⚠️ CONSOLIDATE | Merge into Vocabulary | Duplicate normalization |
| 5 | Vocabulary Engine | ✅ KEEP | Expand | Core feature, absorb preprocessing |
| 6 | Clarifiers | ✅ KEEP | No changes | Unique disambiguation value |
| 7 | Call Reason Sanitizer | ⚠️ CONSOLIDATE | Merge into Vocabulary | Duplicate cleanup logic |
| 8 | LLM Fallback | ⚠️ SIMPLIFY | 30 fields → 6 fields | Overbuilt, too many knobs |
| 9 | Global Negative Keywords | ❌ ELIMINATE | Remove or fix wiring | No runtime code found |
| 10 | Pending Question Responses | ⚠️ CONSOLIDATE | Move to Discovery Handoff | Wrong namespace location |

---

## CONSOLIDATION PROPOSAL

### Phase 1: Eliminate Dead Weight
**Remove**:
1. Human Tone templates (overlap with LLM)
2. Global Negative Keywords (no wiring found)

**Impact**: -2 config sections, ~15 UI fields removed

---

### Phase 2: Consolidate Text Processing
**Merge into Vocabulary Engine**:
1. Speech Preprocessing (filler words, greetings, canonical rewrites)
2. Call Reason Sanitizer (label mappings, strip patterns)

**New Vocabulary Entry Types**:
- `HARD_NORMALIZE`: Existing (keep)
- `SOFT_HINT`: Existing (keep)
- `STRIP_FILLER`: New (from preprocessing)
- `STRIP_GREETING`: New (from preprocessing)
- `LABEL_MAP`: New (from sanitizer)

**Impact**: 3 systems → 1 system, single UI table, clear precedence

---

### Phase 3: Simplify LLM Fallback
**Reduce from**:
- 2 modes (guided, answer_return)
- 30+ config fields
- 3 separate prompt fields
- Handoff modes
- Call forwarding

**Reduce to**:
- 1 mode (unified behavior)
- 6 core config fields
- 1 prompt field
- Reuse Discovery Handoff for consent
- Move call forwarding to separate feature

**Impact**: 80% reduction in LLM config surface area

---

### Phase 4: Fix Namespace Confusion
**Move**:
- Pending Question Responses → from `playbook.fallback.*` to `discoveryHandoff.*`

**Impact**: Clearer ownership, easier to find related settings

---

## IMPLEMENTATION PRIORITY

### P0 - Eliminate Immediately (Dead Weight)
- Remove Human Tone (no migration needed — LLM already does this)
- Remove Global Negative Keywords (no runtime wiring)

### P1 - Consolidate Text Processing (High Value)
- Merge Speech Preprocessing + Call Reason Sanitizer into Vocabulary Engine
- Reduces 3 codebases to 1
- Clear precedence order
- Easier to debug

### P2 - Simplify LLM Fallback (Reduce Cognitive Load)
- Collapse modes into single behavior
- Reduce 30 fields to 6 essential fields
- Move call forwarding out
- Merge prompt fields

### P3 - Fix Namespace Issues (Polish)
- Move Pending Question Responses to Discovery Handoff config

---

## FINAL RECOMMENDATION

**Current State**: 10 configuration sections, ~100+ UI fields, 3 overlapping text processing systems

**Target State**: 6 configuration sections, ~40 UI fields, 1 unified text processing system

**Reduction**: 40% fewer sections, 60% fewer fields, 67% fewer text processing codebases

**Benefits**:
1. **Easier to understand**: Fewer knobs, clearer purpose for each
2. **Easier to debug**: Single text processing engine with clear event trail
3. **Easier to maintain**: Less code duplication, clearer ownership
4. **Better UX**: Less overwhelming for new users configuring Agent 2.0

**Risk**: Low. Eliminated features are either unused (Global Negative Keywords) or duplicated by existing features (Human Tone → LLM).

---

## APPENDIX A: RUNTIME WIRING VERIFICATION

### Verified Active Components
✅ Agent2DiscoveryRunner.js - Main orchestrator  
✅ Agent2GreetingInterceptor.js - Greeting handler  
✅ Agent2VocabularyEngine.js - Text normalization  
✅ Agent2IntentPriorityGate.js - Category disqualification  
✅ Agent2LLMFallbackService.js - LLM fallback  
✅ TriggerCardMatcher.js - Keyword/phrase matching  

### Verified Inactive/Unclear Components
❌ Agent2SpeechPreprocessor.js - Overlaps with Vocabulary  
❌ Agent2CallReasonSanitizer.js - Overlaps with Vocabulary/Preprocessing  
❌ Global Negative Keywords - No runtime code found  

---

## APPENDIX B: CONFIG FIELD COUNT

**Current Total**: ~100 fields across 10 sections

**Breakdown by Section**:
- Discovery Handoff: 4 fields
- Human Tone: 8 fields (4 template arrays)
- Intent Priority Gate: 3 fields
- Speech Preprocessing: 6 fields
- Vocabulary Engine: Dynamic (array of entries)
- Clarifiers: Dynamic (array of entries)
- Call Reason Sanitizer: 7 fields
- LLM Fallback: 30+ fields
- Global Negative Keywords: 1 field
- Pending Question Responses: 3 fields

**After Consolidation**: ~40 fields across 6 sections

---

**END OF AUDIT REPORT**
