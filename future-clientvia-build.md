# future-clientvia-build.md

Strategic build plan for ClientsVia AI receptionist platform
Phases A–E from "solid product" to "best-in-class inbound AI OS"

---

## 0. Vision

ClientsVia is not a toy "AI bot for dentists". It is a **scenario-driven, multi-tenant AI receptionist engine** that can be configured for any trade: HVAC, dental, construction, legal, etc.

Core thesis:

* Logic lives in **structured scenarios** (not in random prompts).
* LLMs are **assistants** and **wrappers**, not the source of truth.
* The system must be:

  * Explainable
  * Observable
  * Adaptable
  * Easy to configure without PhD-level AI knowledge.

This document defines how to build that in 5 phases:

* Phase A – Core Brain
* Phase B – Observability
* Phase C – Adaptation / Self-improvement
* Phase D – Knowledge / Retrieval
* Phase E – Actions / Tools

The goal: if this chat dies tomorrow, this .md is still a clean blueprint any competent engineer can execute against.

---

## 1. Current Baseline (What Exists Today)

This is the environment we're building on top of.

### 1.1 Technical baseline

* Node.js backend (assumed)
* MongoDB for persistence
* Redis for caching
* Twilio voice integration (webhook endpoint)
* ElevenLabs (or similar) TTS
* Multi-tenant via `companyId`
* 3-tier AI routing:

  * Tier 1 – Rule-based / BM25
  * Tier 2 – Semantic / fuzzy
  * Tier 3 – LLM fallback (OpenAI gpt-4o-mini)
* Scenario templates per trade:

  * HVAC template, etc.
  * Each template has categories and scenarios.
* Response engine (latest work):

  * ScenarioType, ReplyStrategy, channel-aware selection
  * Quick vs full replies
* Admin UI:

  * Template & scenario management
  * Behaviors (tone presets)
  * Scenario form (currently complex and overwhelming)

### 1.2 Conceptual baseline

* Call comes in via Twilio → `v2AIAgentRuntime` → `AIBrain3tierllm.query()`
* Scenario pool loaded for company → 3-tier router chooses best scenario
* ResponseEngine picks the final reply based on ScenarioType, ReplyStrategy, channel, and scenario content
* Voice: fullReplies prioritized for INFO_FAQ, etc.
* Everything else is logging, not full observability.

We are **not** yet doing:

* AI-assisted scenario authoring
* Multi-turn call state
* Knowledge base retrieval
* Auto evaluation / self-improvement
* Serious tooling integration (calendar, CRM, etc.)

That's what this plan covers.

---

## 2. Phase A – Core Brain (Lock the foundation)

Goal: make the core brain airtight. Scenarios become "mini-brains" with enough data and structure to drive naturalistic behavior.

### A.1 Scenario Model: turn each scenario into a small brain

Target:

* 12–18 trigger phrases
* 4–6 quick replies
* 6–10 full replies
* 2–3 follow-up prompts
* 3–6 negative triggers
* Domain synonyms at template level, not per scenario
* Filler phrases at template level

#### A.1.1 Schema (Mongo)

Extend current Scenario schema to something like:

```ts
type ScenarioType = 'INFO_FAQ' | 'ACTION_FLOW' | 'SYSTEM_ACK' | 'SMALL_TALK';
type ReplyStrategy = 'AUTO' | 'FULL_ONLY' | 'QUICK_ONLY' | 'QUICK_THEN_FULL' | 'LLM_WRAP' | 'LLM_CONTEXT';
type FollowUpMode = 'NONE' | 'ASK_IF_BOOK' | 'TRANSFER' | 'ASK_FOLLOWUP_QUESTION';

interface WeightedReply {
  text: string;
  weight?: number; // default 3
}

interface Scenario {
  _id: string;
  companyId: string;
  templateId: string;
  categoryId: string;

  scenarioName: string;
  enabled: boolean;

  exampleUserPhrases: string[];    // 12–18
  negativeUserPhrases: string[];   // 3–6
  regexTriggers?: string[];

  scenarioType?: ScenarioType;     // if null, derive from category
  replyStrategy: ReplyStrategy;    // default 'AUTO'
  behaviorId?: string;             // tone preset

  quickReplies: WeightedReply[];   // 4–6
  fullReplies: WeightedReply[];    // 6–10
  followUpPrompts: WeightedReply[];// 2–3

  followUpMode: FollowUpMode;
  followUpQuestionText?: string;
  transferTarget?: string;

  minConfidence?: number;          // default from company/template settings
  priority?: number;               // -10..+10 for tie breaking

  notes?: string;
}
```

Template-level dictionaries:

```ts
interface TemplateNLPConfig {
  templateId: string;
  synonyms: Record<string, string[]>; // normalized term -> [variants]
  fillerWords: string[];              // "um", "uh", "like", etc. for stripping in matching
  fillerPhrases: string[];            // "Alright", "Gotcha", "No problem", etc. for injecting in voice
}
```

Action: align existing schema to this structure, migrate where needed.

---

### A.2 ResponseEngine: single source of truth for reply selection

This is mostly done. Hard rules:

* ResponseEngine is the **only** place where quick vs full vs follow-up is chosen.
* Intelligent defaults:

  * INFO_FAQ + VOICE → fullReplies only (optionally with quick intro)
  * ACTION_FLOW + VOICE → quick intro + full + follow-up question
  * SYSTEM_ACK → quickReplies primarily
  * SMALL_TALK → shorter replies, optional filler

Action: keep ResponseEngine clean, stateless, and deterministic. It takes:

```ts
buildResponse({
  scenario,
  channel,
  context,        // will later include callState
})
```

And returns:

```ts
{
  text: string;                    // ready to send to TTS/SMS
  strategyUsed: ReplyStrategy;
  scenarioTypeResolved: ScenarioType;
  replyStrategyResolved: ReplyStrategy;
}
```

Do not reintroduce "random reply selection" outside of this engine.

---

### A.3 Weighted random selection and fillers

Implement:

* Weighted selection for replies:

  * Each quick/full/followUp has `weight` (default 3).
  * Use weighted random to pick a variant.

* Optional filler injection (voice only):

  * 20–30% chance to prepend or inject a phrase from `TemplateNLPConfig.fillerPhrases`.
  * Example:

    * Base: "We're open Monday through Friday from 9 AM to 5 PM, and Saturday 10 to 2. We're closed on Sundays."
    * Spoken: "Alright, we're open Monday through Friday from 9 AM to 5 PM, and Saturday 10 to 2. We're closed on Sundays."

Action:

* Extend ResponseEngine to:

  * Pick reply via weighted random.
  * If channel is voice, optionally inject filler phrase.

---

### A.4 AI Scenario Builder v1 (Admin-side LLM helper)

Goal: allow admin/dev to type a description → engine generates a full scenario object filled to targets (15 triggers, ~5 quick, ~8 full, etc.).

#### A.4.1 API

`POST /api/admin/ai/generate-scenario`

Input:

```json
{
  "companyId": "COMPANY_ID",
  "templateId": "TEMPLATE_ID",
  "categoryId": "CATEGORY_ID",
  "scenarioGoal": "Frustrated customer wants to cancel HVAC maintenance plan. We want to be empathetic, try to save, but always allow cancellation.",
  "businessFacts": "Month-to-month plan, can cancel anytime, offer manager call if unhappy.",
  "channel": "voice",
  "behaviorId": "EMPTH_REASSURING" // optional
}
```

Output (LLM-generated, validated):

```json
{
  "scenarioName": "Customer Wants to Cancel Service",
  "exampleUserPhrases": [ "... 15 items ..." ],
  "negativeUserPhrases": [ "... 5 items ..." ],
  "quickReplies": [
    { "text": "...", "weight": 3 },
    { "text": "...", "weight": 3 },
    { "text": "...", "weight": 2 },
    { "text": "...", "weight": 1 },
    { "text": "...", "weight": 1 }
  ],
  "fullReplies": [
    { "text": "...", "weight": 4 },
    { "text": "...", "weight": 3 },
    { "text": "...", "weight": 3 },
    { "text": "...", "weight": 2 },
    { "text": "...", "weight": 2 },
    { "text": "...", "weight": 1 },
    { "text": "...", "weight": 1 },
    { "text": "...", "weight": 1 }
  ],
  "followUpPrompts": [
    { "text": "...", "weight": 3 },
    { "text": "...", "weight": 2 },
    { "text": "...", "weight": 1 }
  ],
  "scenarioType": "ACTION_FLOW",
  "replyStrategy": "QUICK_THEN_FULL",
  "followUpMode": "TRANSFER",
  "followUpQuestionText": "What is the main reason you'd like to cancel?",
  "transferTarget": "RETENTION_QUEUE",
  "minConfidence": 0.78,
  "priority": 10,
  "notes": "Generated by AI, scenario tuned for cancellations and retention."
}
```

Backend responsibilities:

* Prompt engineering to force exact counts (15 triggers, 5 quick, 8 full, 3 follow-ups, 5 negatives).
* Validate JSON shape.
* Clamp insane values (e.g., minConfidence outside [0.5, 0.9]).
* Save as draft Scenario.

Frontend:

* Add "Generate with AI" section at top of Scenario form.
* Let admin review/edit results and save.

This is Phase A's main LLM feature.

---

### A.5 Template-level NLP config

Implement `TemplateNLPConfig` as described.

Use it in Tier 1/Tier 2 matching to:

* Normalize synonyms (map "AC", "air", "air conditioner" to `AIR_CONDITIONER`).
* Strip filler words.
* Feed normalized text to BM25 / scoring.

Goal: more robust and less brittle scenario matching.

---

### Phase A Acceptance Criteria

* All scenarios use the new model.
* ResponseEngine is the sole reply selector.
* Weighted random + optional filler injection is live on voice.
* AI Scenario Builder can generate a reasonably strong scenario from a description.
* Template-level synonyms and fillers used in matching.

Once A is done, you have a serious "brain core".

---

## 3. Phase B – Observability (See everything)

Goal: If a client asks "Why did the AI say that?" you can answer in one screen.

### B.1 CallTrace model

New collection `CallTrace`:

```ts
interface CallTurn {
  turnIndex: number;
  timestamp: Date;
  userText: string;
  normalizedUserText: string;
  scenarioId?: string;
  scenarioName?: string;
  tierUsed?: 1 | 2 | 3;
  tier1Score?: number;
  tier2Score?: number;
  tier3Score?: number;
  responseText?: string;
  responseStrategyUsed?: ReplyStrategy;
  scenarioTypeResolved?: ScenarioType;
  replyStrategyResolved?: ReplyStrategy;
  channel: 'voice' | 'sms' | 'chat';
}

interface CallTrace {
  _id: string;
  companyId: string;
  templateId?: string;
  callId: string;         // Twilio CallSid
  fromNumber: string;
  toNumber: string;
  startedAt: Date;
  endedAt?: Date;
  durationSec?: number;
  resolvedBy: 'AI' | 'HUMAN' | 'ABANDONED';

  turns: CallTurn[];

  escalationReason?: string;
  notes?: string;

  qualityScore?: number;  // Phase C
}
```

Hook into:

* `v2AIAgentRuntime` to create CallTrace on first turn.
* `AIBrain3tierllm.query()` to append a `CallTurn` on each input-response cycle.

### B.2 Call Trace UI

Admin panel: "Call Trace" page.

* Left: filter/search (date, company, number, resolvedBy, quality).
* Middle: list of calls.
* Right: detailed call view:

  * Timeline of turns:

    * user utterance
    * matched scenario
    * tier
    * response text
    * strategyUsed
  * Summary at top:

    * resolvedBy
    * total turns
    * top scenario used
    * escalation or not

Goal: the business owner can see exactly what happened without reading raw logs.

---

### B.3 Monitoring dashboard

System-level view:

Metrics (per day, per company):

* totalCalls
* tier1Hits, tier2Hits, tier3Hits
* avgResponseTime
* escalationRate
* nullResponseRate
* scenarioType counts (INFO_FAQ, ACTION_FLOW, etc.)
* responseStrategyUsed distribution

Implementation:

* Aggregation job (cron or timed worker):

  * Reads CallTrace for last N hours
  * Writes daily metrics into a `MetricsDaily` collection.

Admin UI:

* Global overview:

  * Graphs for calls, tiers, escalations
* Per-company deep dive:

  * Scenario usage
  * Top failing scenarios
  * Tier 3 dependency

---

### Phase B Acceptance Criteria

* Every call generates a CallTrace.
* CallTrace UI exists and works.
* Metrics dashboard exists with core metrics per company.
* You can answer "Why did AI say that?" from the UI, not logs.

---

## 4. Phase C – Adaptation / Self-improvement

Goal: AI brain doesn't stay static; it learns what works and what doesn't.

### C.1 Call State (multi-turn memory)

Right now context is loosely passed around. We need a consistent `callState` structure.

```ts
interface CallState {
  callerName?: string;
  callerPhone?: string;
  address?: string;
  preferredTime?: string;
  issueDescription?: string;
  urgency?: 'LOW' | 'MEDIUM' | 'HIGH';
  lastScenarioId?: string;
  collectedEntities: Record<string, any>; // generic bucket
}
```

Features:

* `callState` lives in memory per call (or Redis).
* Each scenario can **read + write** parts of callState:

  * "We already collected name and address, don't ask again."
* ResponseEngine can modify behavior based on state:

  * If we already answered hours, next time user asks something else, we don't repeat full hours, etc.

Implementation:

* Extend context object passed into AIBrain and ResponseEngine to include callState.
* Provide helper utilities (e.g., `updateCallState`) inside runtime.

---

### C.2 Auto-evaluation via LLM

After each call ends, run a background LLM evaluation job:

Input:

* CallTrace (transcript of all turns, plus metadata)

Ask LLM:

* Was caller's main request resolved? (yes/no/partial)
* Was there frustration or anger? (none/low/medium/high)
* Did AI escalate appropriately if needed? (yes/no)
* Were there obvious mismatched scenarios? (list)
* any scenario that fired incorrectly?

Output stored in CallTrace:

```ts
interface CallEvaluation {
  resolved: 'YES' | 'NO' | 'PARTIAL';
  sentiment: 'CALM' | 'MILDLY_FRUSTRATED' | 'ANGRY';
  escalationAppropriate: boolean;
  problematicScenarios: { scenarioId: string; reason: string }[];
  comments: string;
  qualityScore: number; // 0–100
}
```

Use `qualityScore` and `problematicScenarios` for:

* dashboard
* future optimization

---

### C.3 Scenario optimization suggestions

Periodic job:

* Looks at CallTraces and evaluations.
* For each scenario:

  * High false-positive rate? Lower priority or adjust triggers.
  * Frequently unresolved calls? Suggest rework.
  * Underused scenario? Maybe too specific.

We don't auto-edit at first. We **generate suggestions**:

* "Scenario X: high mismatch, consider adding these negative triggers: [...]"
* "Scenario Y: unresolved 40% of time, consider splitting into two scenarios."

Later (Phase C+, if desired) we can allow one-click acceptance of such suggestions, but start with read-only recommendations.

---

### Phase C Acceptance Criteria

* `callState` is live and scenarios use it.
* Auto-evaluation runs on CallTraces.
* QualityScore present and visible.
* There is a basic "Scenario Health" admin view highlighting problem scenarios.

---

## 5. Phase D – Knowledge / Retrieval (RAG)

Goal: AI can answer from real company data (FAQs, policies, services) without bloating scenarios or hallucinating.

### D.1 Company Knowledge Base

New collection `CompanyKnowledgeDoc`:

```ts
interface CompanyKnowledgeDoc {
  _id: string;
  companyId: string;
  title: string;
  content: string;        // text/markdown
  type: 'FAQ' | 'POLICY' | 'SERVICE' | 'LOCATION' | 'OTHER';
  tags: string[];
}
```

Plus an embedded vector index (using external vector DB or plugin).
We don't go crazy; keep the schema simple.

### D.2 Retrieval layer

Service: `KnowledgeService.search(companyId, query, topK)`

* Normalizes query with template synonyms.
* Calls vector DB or semantic search.
* Returns top-k candidate snippets with scores.

### D.3 Scenario integration

For certain scenarios (e.g., INFO_FAQ: policy, services), we don't hard-code all content into fullReplies.

Instead:

* Scenario contains a `kbQueryTemplate` like:

  * "warranty for air conditioner"
  * "financing options"
* At runtime:

  * ResponseEngine detects scenarioType + scenario settings.
  * Calls `KnowledgeService.search(companyId, kbQueryTemplate or userText, 3)`.
  * If good hit:

    * Build reply: wrap snippet into your behavioral style.
    * Optionally LLM_WRAP: use a cheap LLM to rephrase snippet in chosen tone.

Important: Logic stays in scenario; KB provides content.

### D.4 Guardrails

* Always prefer KB over hallucinating for policies, legal, pricing, etc.
* If KB returns nothing → fallback to safe generic answer + escalate/offer callback.

---

### Phase D Acceptance Criteria

* Admin can upload text/FAQ/policy into company knowledge.
* Scenarios can be marked as "use KB" with kbQueryTemplate.
* AI answers certain questions dynamically from KB, not from static text.
* No hallucinated policies.

---

## 6. Phase E – Actions / Tools

Goal: AI doesn't just talk, it does work.

### E.1 Tool abstraction

Define a simple tool schema:

```ts
interface ToolDefinition {
  name: string;           // 'createAppointment'
  description: string;
  inputSchema: any;       // JSON schema for validation
}
```

Implement a ToolRunner:

* Functions like:

  * `createAppointment`
  * `lookupCustomerByPhone`
  * `createSupportTicket`

These live in a `ToolsService`.

### E.2 Scenario → tool link

Scenarios can declare:

```ts
interface Scenario {
  ...
  toolsToUse?: string[]; // e.g. ['createAppointment']
}
```

Runtime:

* Once a scenario is active and we've collected necessary entities via callState, we call the tool automatically.

Example:

* Appointment booking scenario:

  * Collect name, address, date, time.
  * When ready, call `createAppointment(callState)`.
  * Then respond with confirmation text.

LLM does not decide which tool to call. Scenario configuration does.

Later, if you want, you can let LLM choose from a constrained list of tools based on context, but start with scenario-driven tool invocation.

---

### Phase E Acceptance Criteria

* Basic tool framework in place.
* At least one real tool (e.g., createAppointment) integrated with a 3rd-party system.
* Scenarios can be wired to use these tools as part of flows.

---

## 7. Implementation Principles

* Logic is always **explicit** and structured; LLMs are assistants and style engines.
* Any time logic and content fight, logic wins.
* We avoid black-box LLM agents in production flows; we use controlled inputs/outputs.

Key patterns:

* Scenario = small structured brain.
* ResponseEngine = single point where "what to say" is decided.
* LLMs:

  * Build scenarios (admin side).
  * Wrap text (LLM_WRAP).
  * Evaluate calls (auto-eval).
  * Retrieve knowledge (controlled RAG).

---

## 8. Suggested Execution Order

This is the sequence to follow so we don't build on sand.

1. Phase A

   * Finalize scenario model and ResponseEngine.
   * Implement weighted replies and filler injection.
   * Deliver AI Scenario Builder v1.
   * Harden template synonyms and fillers.

2. Phase B

   * Implement CallTrace and Call Trace UI.
   * Implement metrics aggregation and dashboard.

3. Phase C

   * Implement callState and wire into routing + ResponseEngine.
   * Implement LLM auto-evaluation and scenario health views.

4. Phase D

   * Implement company knowledge base and retrieval.
   * Allow scenarios to hook into KB.

5. Phase E

   * Implement tool framework and 1–2 concrete integrations.
   * Expand tool options based on customer demand.

At each phase, the system must remain:

* Backwards compatible for existing templates.
* Observable (logs, dashboards).
* Stable (no wild experimental code directly on hot paths).

---

## 9. What "Done" Looks Like

When all phases A–E are implemented and tuned:

* Any trade (HVAC, dental, construction, etc.) can be onboarded with:

  * A template
  * 20–40 scenarios
  * AI-assisted scenario generation
  * Minimal manual tweaking

* Calls feel human:

  * Non-repetitive
  * Context-aware
  * Trade-aware
  * Emotionally tuned (Empathetic vs Professional)

* Platform is not a black box:

  * Every decision is traceable via CallTrace.
  * Scenario performance is visible via dashboard.
  * Quality is measured, not assumed.

* You have a clear path to:

  * Charge real money
  * Defend the product technically
  * Scale to many customers and trades without drowning in manual work.

---

End of `future clientvia build.md`

This is the blueprint. From here, each phase can be executed by feeding sections of this doc to the AI coder, just like we did earlier, piece by piece.

