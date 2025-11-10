# FUTURE CLIENTVIA BUILD – ARCHITECTURE & IMPLEMENTATION PLAYBOOK

**Product:** ClientsVia AI Receptionist Platform  
**Scope:** Multi-tenant, trade-agnostic, voice-first AI agent  
**Goal:** World-class, enterprise-grade receptionist agent you can drop into any business (HVAC, dental, law, construction, etc.) with predictable behavior and low operator error.

---

## 0. PRINCIPLES

1. **Scenario-First, Not Prompt-First**  
   - The "intelligence" lives in **scenarios, templates, and behavior configs**, not in random prompts.
   - LLM is *assistive* and *fallback*, not the primary brain.

2. **Deterministic Core, Probabilistic Flavor**  
   - Core routing (which scenario / what to do) must be deterministic and explainable.
   - Replies can be varied and weighted to sound human.

3. **Admin-Friendly, Dev-Safe**  
   - Admins can configure scenarios without understanding AI.
   - We protect them with **good defaults**, **guardrails**, and **LLM helpers**.

4. **Observability & Auditability**  
   - For every call we must be able to answer:  
     "What did the AI hear? What did it decide? Why that scenario? Why that reply?"

---

## 1. HIGH-LEVEL ARCHITECTURE

**Runtime Flow (Voice):**

```text
Twilio Call / Webhook
  ↓
v2Twilio Runtime
  ↓
AIBrain3tierllm.query(companyId, userText, context)
  ↓
  ├─ ScenarioPoolService.getScenarioPoolForCompany()
  │     ↓
  │  ScenarioPool[]  (normalized, weighted)
  │
  └─ IntelligentRouter.route()
        ↓
        Tier 1: Rule-based (keywords, synonyms, fillers stripped)
        Tier 2: Semantic (BM25 / embeddings)
        Tier 3: LLM fallback (GPT-4o-mini)
        ↓
     Matched Scenario + Confidence + TierUsed
        ↓
ResponseEngine.buildResponse({ scenario, channel, context })
        ↓
Final text reply (+ follow-ups / transfer decisions)
        ↓
Twilio → TTS (ElevenLabs) → Caller hears response
```

**Admin Flow (Templates & Scenarios):**

```text
Admin UI (Global Templates & Scenarios)
  ↓
Admin Form → /api/admin/global-instant-responses/...
  ↓
GlobalInstantResponseTemplate (Mongo)
  ↓
ScenarioPoolService loads + normalizes
  ↓
AIBrain & IntelligentRouter use ScenarioPool at runtime
```

---

## 2. PHASES OVERVIEW

We build in **phases**, each one self-contained and shippable:

* **Phase A – Scenario Intelligence & Replies**
  Make scenarios smart and consistent: scenarioType, replyStrategy, weights, thresholds, follow-ups.

* **Phase B – Behavior & Sentiment Layer**
  Silence handling, escalation behavior, "frustrated / wants to cancel" paths, transfer rules.

* **Phase C – Booking & Flows**
  Trade-agnostic booking flows: capture info, validate, write to DB, confirm to caller.

* **Phase D – Real-Time Voice Loop**
  Clean integration with Twilio, ElevenLabs, Deepgram (or equivalent), stable "listen → think → speak" loop.

* **Phase E – Observability & Onboarding**
  Call trace UI, monitoring dashboard, onboarding playbook so admins don't screw it up.

This document explains **what each phase should do, which files are involved, and how to know when it's "done".**

---

## 3. PHASE A – SCENARIO INTELLIGENCE & REPLIES

### 3.1. Current Key Files

* `models/GlobalInstantResponseTemplate.js`
* `services/ScenarioPoolService.js`
* `services/AIBrain3tierllm.js`
* `services/IntelligentRouter.js`
* `services/ResponseEngine.js`
* `public/admin-global-instant-responses.html`
* `routes/admin/globalInstantResponses.js`

### 3.2. Phase A Goals

1. **Scenario semantics are first-class:**

   * `scenarioType` (INFO_FAQ, ACTION_FLOW, SYSTEM_ACK, SMALL_TALK)
   * `replyStrategy` (AUTO, FULL_ONLY, QUICK_ONLY, QUICK_THEN_FULL, LLM_WRAP, LLM_CONTEXT)

2. **Replies are powerful and varied:**

   * 10–15 replies per scenario encouraged.
   * Weighted selection so some replies are more common.

3. **Safety & Confidence:**

   * `minConfidence` enforced per scenario.
   * Scenario priority supports tie-breaking.

4. **Follow-up behaviors exist:**

   * `followUpMode`, `followUpQuestionText`, `transferTarget` stored **and respected at runtime**.

---

### 3.3. Phase A – What's Already Done

**(These should already exist in the codebase – IF THEY DON'T, REIMPLEMENT.)**

1. **Schema Fields – Scenario Semantics & Replies**

File: `models/GlobalInstantResponseTemplate.js`

* `scenarioType: 'INFO_FAQ' | 'ACTION_FLOW' | 'SYSTEM_ACK' | 'SMALL_TALK'`
* `replyStrategy: 'AUTO' | 'FULL_ONLY' | 'QUICK_ONLY' | 'QUICK_THEN_FULL' | 'LLM_WRAP' | 'LLM_CONTEXT'`
* `quickReplies`, `fullReplies`, `followUpPrompts` as **Mixed**:

  * Accepts `["string", ...]` (legacy) or `[{text, weight}, ...]` (new).
* `followUpMode`, `followUpQuestionText`, `transferTarget`
* `minConfidence` (0–1)
* `notes` (admin notes)

2. **Scenario Normalization**

File: `services/ScenarioPoolService.js`

* `_normalizeReplies(rawReplies)`:

  * Converts legacy `[String]` to `[{text, weight}]` with default weight.
  * Ensures arrays are clean and trimmed.

* `_ensurePhaseA1Fields(scenario)`:

  * Ensures new fields exist with defaults.
  * Normalizes replies for `quickReplies`, `fullReplies`, `followUpPrompts`.

3. **ResponseEngine – ScenarioType & ReplyStrategy**

File: `services/ResponseEngine.js`

* `buildResponse({ scenario, channel, context })`:

  * Resolves `scenarioTypeResolved` and `replyStrategyResolved`.
  * Has **decision matrix** based on:

    * `scenarioTypeResolved` (INFO_FAQ, ACTION_FLOW, SYSTEM_ACK, SMALL_TALK)
    * `replyStrategyResolved` (AUTO, FULL_ONLY, QUICK_ONLY, QUICK_THEN_FULL, LLM_WRAP, LLM_CONTEXT)
    * `channel` ('voice', 'sms', 'chat').

4. **Weighted Reply Selection**

File: `services/ResponseEngine.js`

* `_selectRandom(arr)`:

  * Accepts `["string"]` and `[{text, weight}]`.
  * Uses **weighted random** selection:

    * Higher `weight` ⇒ higher chance to be picked.
    * Legacy strings → treated with default weight.

5. **Admin UI Fields**

File: `public/admin-global-instant-responses.html`

* Scenario form includes:

  * `scenario-type` dropdown.
  * `scenario-reply-strategy` dropdown.
* `saveScenario()` includes `scenarioType` and `replyStrategy` in payload.

---

### 3.4. Phase A – TODO (to be built)

#### A.2 – `minConfidence` Enforcement

**Status: ✅ COMPLETE**

- Implemented: minConfidence is now checked per scenario in IntelligentRouter for Tiers 1–3. Scenarios below their minConfidence are treated as non-matches at that tier and logged.
- When a scenario's match confidence falls below its `minConfidence`, it is rejected and the router escalates to the next tier (or fails entirely after Tier 3).
- All three tiers (Tier 1, Tier 2, Tier 3) apply this check before accepting a scenario match.
- Clear info-level logging shows when scenarios are rejected due to minConfidence.
- Backwards compatible: scenarios without minConfidence set are unaffected (treated as null).

#### A.3 – FollowUpMode & Transfers

**Goal:** `followUpMode`, `followUpQuestionText`, `transferTarget` become **real behavior**, not dead fields.

**Modes:**

* `NONE`: Just respond once, no extra logic.
* `ASK_FOLLOWUP_QUESTION`:

  * After main reply, agent asks `followUpQuestionText`.
  * Example: "Is there anything else I can help with?"
* `ASK_IF_BOOK`:

  * After answering info (like hours/pricing), agent asks:

    * "Would you like to book an appointment now?"
  * If caller says yes → start booking flow (Phase C).
* `TRANSFER`:

  * After main reply, agent immediately triggers transfer to `transferTarget`.

**Files:**

* `services/ResponseEngine.js`
* `services/v2Twilio...` (Twilio call runtime / gather logic)
* Possibly a `TransferHandler.js` (Phase B/C) for consistent transfers.

**Acceptance Test:**

* Scenario: "Hours of Operation"

  * `followUpMode = ASK_IF_BOOK`
  * `followUpQuestionText = "Would you like to schedule a service now?"`
  * Call flow:

    1. Caller: "What are your hours?"
    2. AI: "We're open Mon–Fri 9–5. Would you like to schedule a service now?"
    3. Caller: "Yes" → AI enters booking flow (Phase C).

---

## 4. PHASE B – BEHAVIOR & SENTIMENT LAYER

### 4.1. Goal

Teach the agent **how to behave**, not just **what to say**.

* Silence rules (how many "hello? are you there?" before ending).
* Frustration / cancellation detection.
* Escalation rules for angry / urgent callers.
* Behaviors per company or per template.

### 4.2. Planned Components

**(Names are suggestive – adjust to match actual codebase conventions.)**

* `services/BehaviorEngine.js`

  * Input: context (silence count, previous messages, sentiment).
  * Output: behavior decision (continue, re-prompt, escalate, transfer, end).

* `services/SentimentDetector.js`

  * Simple heuristics or LLM-assisted:

    * Detect "I want to cancel", "I'm pissed off", "this is ridiculous", etc.
  * Triggers specific scenarios or escalation.

* `models/GlobalAIBehaviorTemplate.js`

  * Defines named behaviors:

    * "FriendlyConcise"
    * "EmpatheticSupport"
    * "CollectionsFirmButPolite"

* `public/admin-ai-behavior.html`

  * UI to configure which behavior template applies per company / trade.

### 4.3. Behavioral Rules Examples

* If user says something like "cancel my service":

  * Route to a CANCELLATION scenario category.
  * Optionally escalate quickly to human if configured.

* If user interrupts or talks over agent:

  * Behavior engine decides to shorten responses.

* If silence detected N times in a row:

  * "I'm not hearing anything, I'm going to end the call now. You can always call back."

---

## 5. PHASE C – BOOKING & FLOWS

### 5.1. Goal

Make the agent **actually do work**: bookings, quote requests, lead capture, etc.

### 5.2. Planned Components

* `services/BookingHandler.js`

  * Orchestrates multi-step flows:

    * Ask for date/time.
    * Ask for address.
    * Confirm details.
    * Save to DB or external system.

* `models/Booking` (or use existing CRM models)

  * Stores booked jobs / appointments.

* `services/FlowEngine.js` (optional)

  * Generic step engine to define flows like:

    * Step 1: ask X, validate.
    * Step 2: ask Y, validate.
    * Step 3: confirm & write.

### 5.3. Example Flow: HVAC Emergency Booking

1. Caller: "My AC is leaking water all over."
2. AI (Scenario: Emergency HVAC Issue):

   * Captures problem description.
   * Asks "Is water currently leaking right now?"
3. If yes → mark as high priority.
4. Ask for address, callbacks, time window.
5. Save booking + maybe trigger SMS/email confirmation.

---

## 6. PHASE D – REAL-TIME VOICE LOOP

### 6.1. Goal

Make the voice experience **feel like a real receptionist**, not a clunky IVR.

* Low latency.
* Interruptible responses.
* Streaming recognition and streaming TTS.

### 6.2. Integration Points

* Twilio / Telnyx / similar provider.
* ElevenLabs or other TTS.
* Deepgram / Whisper / similar STT.

### 6.3. Loop

```text
Caller speaks
  ↓
Twilio → STT (streaming)
  ↓
Partial + final transcripts
  ↓
AIBrain3tierllm.query()
  ↓
ResponseEngine.buildResponse()
  ↓
TTS (ElevenLabs) streaming
  ↓
Caller can interrupt → new STT segment → new query
```

Always keep `context` updated in `AIBrain3tierllm` so scenarios can use convo history.

---

## 7. PHASE E – OBSERVABILITY & ONBOARDING

### 7.1. Call Trace

* Model: `CallTrace`

* Logged per call:

  * Raw transcript (turn by turn).
  * Scenario matches and confidence.
  * Tier used (1/2/3).
  * Final response text.
  * Follow-up and transfer decisions.

* UI:

  * Timeline showing conversation with:

    * "Heard"
    * "Matched Scenario"
    * "Response"

### 7.2. Monitoring Dashboard

* Per company and platform-wide:

  * Calls, Tier 3 usage, escalation rate, null response rate.

### 7.3. Onboarding Playbook

* HVAC template, dental template, law firm template, etc.
* Pre-built categories:

  * Hours, Booking, Pricing, Services, Small Talk, Cancellations, Emergencies
* For each:

  * Scenario names.
  * Example user phrases.
  * 10–15 reply variants.

---

## 8. IMPLEMENTATION STATUS CHECKLIST

Keep this section updated as work progresses.

### Phase A – Scenario Intelligence

* [x] Schema: scenarioType, replyStrategy, followUp fields, minConfidence
* [x] ScenarioPool normalization for replies & Phase A fields
* [x] ResponseEngine decision matrix (scenarioType + replyStrategy + channel)
* [x] Weighted reply selection in `_selectRandom`
* [x] minConfidence enforced in IntelligentRouter
* [ ] followUpMode behavior implemented (ASK_FOLLOWUP_QUESTION, ASK_IF_BOOK, TRANSFER)
* [ ] Admin UI support for followUp text/target
* [ ] Logging of scenarioTypeResolved, replyStrategyResolved, responseStrategyUsed, followUpMode

### Phase B – Behavior & Sentiment

* [ ] BehaviorEngine created
* [ ] Sentiment detection + routing
* [ ] Escalation paths for cancellations / angry callers
* [ ] Admin UI for behavior selection per company

### Phase C – Booking & Flows

* [ ] BookingHandler implemented
* [ ] Basic HVAC booking flow
* [ ] Generic flow engine (optional)
* [ ] Write-through to booking DB/CRM

### Phase D – Voice Loop

* [ ] Streaming STT/TTS integrated
* [ ] Interruptible speech
* [ ] Context across turns

### Phase E – Observability & Onboarding

* [ ] CallTrace model + logging pipeline
* [ ] Call trace UI
* [ ] Monitoring dashboard
* [ ] Onboarding templates for top trades

---

## 9. WORKING AGREEMENT FOR AI CODER

1. **Never "invent" behavior silently.**

   * If something is ambiguous, leave a `TODO` with a clear comment.
2. **Always show exact file + line numbers when you change logic.**
3. **Always keep this file updated**:

   * When you finish a task, update the checklist above in this file.
4. **No schema changes without documenting MANIFEST changes here.**
5. **Every new module must be referenced here**:

   * What it does, where it lives, who calls it.

---

*End of FUTURE CLIENTVIA BUILD.md*

