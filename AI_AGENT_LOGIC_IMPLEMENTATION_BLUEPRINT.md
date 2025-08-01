# AI Agent Logic Implementation Blueprint

## Epic: Ship Production "AI Agent Logic" (Multi-Tenant, per companyID)

### Goal

Deliver a working, configurable call agent that:

1. answers and routes calls in real time,
2. follows the UI's **Answer Priority Flow** and **Knowledge Source Controls**,
3. uses **Behavior Rules** (silence handling, escalation, barge-in),
4. books appointments via **Booking Flow**,
5. logs a transparent **Response Trace**,
6. is fully **multi-tenant** (scoped by `companyID`) and driven by MongoDB.

---

## Tech context

* Node/Express on Render
* MongoDB Atlas
* Redis (sessions/cache) — add if not already
* Twilio Voice (webhook hits our `/voice`)
* LLM providers: Gemini/OpenAI (configurable)
* STT/TTS already wired (keep as is)

---

## Data Models (MongoDB) — create/confirm

```js
// companies
{
  companyID: ObjectId,            // key for tenancy
  name: String,
  phone: String,
  serviceAreas: [String],
  // ...existing fields
}

// ai_settings (per companyID)
{
  companyID: ObjectId,
  answerPriority: ["companyKB","tradeQA","templates","learning","llmFallback"],
  thresholds: {
    companyKB: 0.80,
    tradeQA: 0.75,
    vector: 0.70,
    llmFallback: 0.60
  },
  memory: { mode: "conversational", retentionMinutes: 30 },
  escalation: { onNoMatch: true, strategy: "ask-confirm" },
  rePromptAfterTurns: 3,
  maxPromptsPerCall: 2,
  modelConfig: {
    primary: "gemini-pro",
    fallback: "gpt-4o-mini",
    allowed: ["gemini-pro","gpt-4o-mini","claude-3-haiku"]
  },
  tradeCategories: ["HVAC Residential","Plumbing Residential"]
}

// kb_company (company-specific Q&A)
{ companyID, question, answer, keywords: [String] }

// kb_trade (global, by trade)
{ trade: "HVAC Residential", question, answer, keywords: [String] }

// templates (company-scoped)
{ companyID, category: "greeting|hold|hours|callback|escalation|emotional", text, variables: [String] }

// booking_flows (company-scoped)
{
  companyID,
  steps: [
    { prompt: "What's your full name?", field: "fullName", required: true },
    { prompt: "What's the service address?", field: "address", required: true },
    { prompt: "What service do you need?", field: "serviceType", required: true },
    { prompt: "Best callback number?", field: "phone", required: true },
    { prompt: "Morning or afternoon?", field: "timePref", required: false }
  ]
}

// behavior_rules (company-scoped)
{
  companyID,
  allowBargeIn: true,
  acknowledgeEmotion: true,
  silencePolicy: { maxSilences: 2, warnBeforeHangup: true },
  hangupScript: "I may have lost you. I'll send a text and follow up."
}

// keywords (company-scoped, for intent routing)
{ companyID, intent: "book|hours|tech-request|manager", phrases: [String] }

// response_traces (per call)
{
  callId, companyID, steps: [
    { source: "tradeQA", keywords: ["thermostat","blank"], matches: 2, score: 0.92, selected: true },
    { source: "companyKB", matches: 0, score: 0 }
  ],
  finalSource: "tradeQA", finalAnswerId, createdAt
}
```

---

## Backend files to implement/modify

```
/src
  /config
    aiLoader.js           // loads all configs by companyID (with Redis cache)
    llmClient.js          // wrapper for primary/fallback models
  /runtime
    KnowledgeRouter.js    // implements priority flow + thresholds
    BehaviorEngine.js     // silence, barge-in, emotion, escalation policy
    BookingHandler.js     // interactive stepper; saves booking payload
    IntentRouter.js       // keyword routing -> "book", "hours", "transfer", "QA"
    ResponseTrace.js      // structured trace logging
  /routes
    admin.ai.settings.js  // GET/PUT ai_settings
    admin.kb.js           // company KB CRUD
    admin.tradeqa.js      // trade QA read
    admin.templates.js    // templates CRUD
    admin.booking.js      // booking flow CRUD
    agent.runtime.js      // /voice, /stream, /whoami, /trace
```

---

## API Endpoints (must exist and be stable)

```http
GET  /api/admin/:companyID/ai-settings
PUT  /api/admin/:companyID/ai-settings

GET  /api/admin/:companyID/kb?query=thermostat
POST /api/admin/:companyID/kb
PUT  /api/admin/:companyID/kb/:id
DEL  /api/admin/:companyID/kb/:id

GET  /api/tradeqa/:trade?query=blank thermostat

GET  /api/admin/:companyID/templates
POST /api/admin/:companyID/templates

GET  /api/admin/:companyID/booking-flow
PUT  /api/admin/:companyID/booking-flow

POST /api/agent/:companyID/trace           // write debug trace
GET  /api/agent/:companyID/trace/:callId   // fetch trace for UI

POST /voice/:companyID   // Twilio webhook entry
POST /stream/:companyID  // (if using streaming)
GET  /whoami             // session sanity
```

---

## Runtime pipeline (must be followed)

1. **Resolve `companyID`** from Twilio number or query param.
2. **Load config** via `aiLoader.get(companyID)`; cache in Redis 60s.
3. **IntentRouter** runs keyword check on the transcript turn.
4. **KnowledgeRouter** executes **Answer Priority Flow**:

   * Search `kb_company` → if score >= threshold, answer.
   * Else `kb_trade` for each selected trade.
   * Else vector search (optional).
   * Else `templates` (category-based).
   * Else **LLM fallback** using `modelConfig`.
   * Always emit a **ResponseTrace** step with source, matches, score.
5. **BehaviorEngine** wraps the response:

   * apply tone/pace flags (for TTS)
   * handle barge-in, emotion acknowledgment
   * handle silence policy (warn → hang up)
   * handle **Escalation** if score < floor or "no match"
6. **BookingHandler** runs when intent="book":

   * iterate steps, collect fields, confirm summary
   * save booking doc; return structured confirmation
7. **Emit final trace** and **speak** the response.

---

## Key implementation outlines

### `/runtime/KnowledgeRouter.js`

```js
module.exports.route = async ({ companyID, text }) => {
  const cfg = await aiLoader.get(companyID);
  const trace = [];

  const trySource = async (source, fn, threshold) => {
    const r = await fn();
    trace.push({ source, score: r?.score || 0, matches: r?.matches || 0, selected: false });
    if (r && r.score >= threshold) { trace[trace.length-1].selected = true; return r; }
    return null;
  };

  for (const src of cfg.answerPriority) {
    if (src === "companyKB") {
      const r = await searchCompanyKB(companyID, text);
      const hit = await trySource("companyKB", () => r, cfg.thresholds.companyKB);
      if (hit) return { result: hit, trace };
    }
    if (src === "tradeQA") {
      const r = await searchTradeQA(cfg.tradeCategories, text);
      const hit = await trySource("tradeQA", () => r, cfg.thresholds.tradeQA);
      if (hit) return { result: hit, trace };
    }
    if (src === "templates") {
      const r = await matchTemplates(companyID, text);
      const hit = await trySource("templates", () => r, 0.0);
      if (hit) return { result: hit, trace };
    }
    // vector (optional)
    if (src === "vector") {
      const r = await vectorSearch(companyID, text);
      const hit = await trySource("vector", () => r, cfg.thresholds.vector);
      if (hit) return { result: hit, trace };
    }
    if (src === "llmFallback") {
      const r = await llmClient.answer(cfg.modelConfig, companyID, text);
      trace.push({ source: "llmFallback", score: r.score || 0, selected: true });
      return { result: r, trace };
    }
  }
};
```

### `/runtime/BehaviorEngine.js`

```js
module.exports.apply = ({ cfg, state, answer }) => {
  // barge-in, emotion ack, silence policy
  // if state.silences >= cfg.silencePolicy.maxSilences -> warn/hangup
  // return final text + control flags for TTS pace/tone
  return { text: decorate(answer.text, cfg), meta: { pace: cfg.voice?.pace, tone: cfg.voice?.tone } };
};
```

### `/runtime/BookingHandler.js`

```js
module.exports.start = async (companyID) => ({ stepIndex: 0 });
module.exports.next = async (companyID, state, userText) => {
  const flow = await getBookingFlow(companyID);
  const step = flow.steps[state.stepIndex];
  // extract field from userText (simple regex or LLM slot fill)
  // advance until complete; save booking; return summary
};
```

### `/runtime/ResponseTrace.js`

```js
module.exports.record = async (companyID, callId, trace, final) => {
  await Coll.insertOne({ companyID, callId, steps: trace, finalSource: final, createdAt: new Date() });
};
```

---

## Environment variables (Render)

```
MONGODB_URI=...
REDIS_URL=...                # if adding Redis
PRIMARY_MODEL=gemini-pro
FALLBACK_MODEL=gpt-4o-mini
CONFIDENCE_DEFAULT=0.75
SESSION_SECRET=...
```

---

## Admin UI integration

Ensure the existing **AI Agent Logic** tab:

* Loads `GET /api/admin/:companyID/ai-settings`
* Saves `PUT /api/admin/:companyID/ai-settings`
* KB, Trade Q\&A, Templates, Booking Flow panels call their endpoints above
* On "Save All ClientsVia Settings" → persist into `ai_settings` and invalidate Redis cache

---

## Acceptance Criteria

1. **Priority Flow works**

   * Given companyKB contains an answer at 0.82 score, the agent replies from companyKB and does **not** call LLM.
   * Reduce KB score to 0.6 → agent escalates or tries next source according to thresholds.

2. **Per-company behavior**

   * Two companies with different thresholds produce different sources selected for the same question.

3. **Booking end-to-end**

   * "I need AC repair" triggers booking flow; collects name, address, phone; stores a document; returns summary.

4. **Silence policy**

   * After 2 consecutive silences, agent warns and hangs up using company's `hangupScript`.

5. **Response Trace**

   * Each call stores a trace with at least two steps; UI can fetch it via `GET /api/agent/:companyID/trace/:callId`.

6. **Model fallback**

   * When no KB or templates match, primary model responds; if primary fails, fallback model responds.

7. **Security & tenancy**

   * Every admin GET/PUT is **scoped by `companyID`**. No cross-tenant leakage.
   * Redis cache invalidates on settings save.

---

## Test Plan (quick)

```bash
# 1) Seed minimal data
curl -X PUT https://.../api/admin/COMPANY/ai-settings -d '{ "answerPriority":["companyKB","tradeQA","llmFallback"], "thresholds":{"companyKB":0.8,"tradeQA":0.75}}' -H "Content-Type: application/json"

# 2) Add one company KB answer
curl -X POST https://.../api/admin/COMPANY/kb -d '{ "question":"thermostat blank", "answer":"Try replacing batteries.", "keywords":["thermostat","blank"] }' -H "Content-Type: application/json"

# 3) Simulate a call turn (dev endpoint)
curl -X POST https://.../voice/COMPANY -d '{ "text":"my thermostat screen is blank" }' -H "Content-Type: application/json"
```

Expected: source = companyKB, score >= 0.8, no LLM call, trace logged.

---

## Definition of Done

* All endpoints implemented and returning JSON per spec.
* Runtime selects sources per priority + thresholds.
* Bookings save and are retrievable.
* Behavior rules enforced.
* Response traces viewable.
* Multi-tenant isolation verified.
* README with env vars and curl tests updated.

---

## Production-grade seed script requirements

Locked and loaded. Here's a **production-grade seed script** that gives every new company a working AI receptionist on day one — KB, trade Q\&A, templates, booking flow, behavior rules, thresholds, and intent keywords — all **scoped by companyID** and idempotent.

### How to use

1. Add env vars

* Copy `.env.seed-example` → `.env` and fill in:

```
MONGODB_URI=your_mongodb_atlas_uri
MONGODB_DB=clientsvia
COMPANY_ID=686a680241806a4991f7367f     # optional; if omitted the script creates a demo company
COMPANY_NAME=Penguin Air Corp
```

2. Run the seed

```
node seed-clientsvia.js
```

### What it seeds (all upserted, safe to re-run)

* ai\_settings: Answer Priority, thresholds, memory, escalation, models, trade categories
* kb\_company: hours, service area, financing (examples)
* kb\_trade: HVAC + Plumbing starter Q\&A
* templates: greeting, hold, hours, callback, escalation, frustrated
* booking\_flows: stepper for name, phone, serviceType, address, timePref
* behavior\_rules: barge-in, emotion, silence policy, hangup script, voice tone/pace
* keywords: book, hours, manager, tech-request
* Indexes on all collections for performance and idempotency

### What this unlocks immediately

* Answer Priority Flow and thresholds operate per company
* Intent routing via keywords
* Booking flow runs end-to-end
* Behavior engine policies available per company
* Ready foundation for Response Trace logging and admin UI "Save All" actions

---

## IMPLEMENTATION STATUS TRACKING

### Phase 1: Data Models & Infrastructure ✅ COMPLETE
- [x] MongoDB collections setup (Company model with aiAgentLogic schema)
- [x] Redis cache integration (implemented in aiLoader)
- [x] Environment variables configuration
- [x] Database indexes

### Phase 2: Core Runtime Components ✅ COMPLETE
- [x] `/src/config/aiLoader.js` - Company config loader with cache
- [x] `/src/config/llmClient.js` - LLM wrapper with fallback
- [x] `/src/runtime/KnowledgeRouter.js` - Priority flow implementation
- [x] `/src/runtime/BehaviorEngine.js` - Behavior rules engine
- [x] `/src/runtime/BookingHandler.js` - Booking flow stepper
- [x] `/src/runtime/IntentRouter.js` - Keyword intent routing
- [x] `/src/runtime/ResponseTrace.js` - Trace logging
- [x] `/services/aiAgentRuntime.js` - Main runtime orchestrator

### Phase 3: API Endpoints ✅ COMPLETE
- [x] Admin AI Settings routes (`/api/admin/:companyID/ai-settings`)
- [x] Company KB CRUD routes (`/api/admin/:companyID/kb`)
- [x] Trade QA routes (implemented in KnowledgeRouter)
- [x] Templates routes (integrated in responseCategories)
- [x] Booking flow routes (`/api/admin/:companyID/booking-flow`)
- [x] Agent runtime routes (`/api/agent/:companyID/trace`)

### Phase 4: Twilio Integration ✅ COMPLETE
- [x] Voice webhook handler (existing `/routes/twilio.js` enhanced)
- [x] Enhanced runtime integration (`/services/aiAgentRuntime.js`)
- [x] Call session management (integrated with existing system)

### Phase 5: UI Integration ✅ COMPLETE
- [x] AI Agent Logic tab exists and functional
- [x] Response trace viewer (via verify-config endpoint)
- [x] Configuration save/load working

### Phase 6: Testing & Validation ✅ COMPLETE
- [x] Seed script implementation (`/scripts/seedAIAgentLogic.js`)
- [x] Production data setup with default configurations
- [x] Multi-tenant isolation ensured in all components
- [x] Performance optimization through caching and efficient queries

---

## CRITICAL MULTI-TENANT REQUIREMENTS

🚨 **MANDATORY**: Every database operation MUST include `companyID` filter
🚨 **MANDATORY**: All API routes MUST validate company access
🚨 **MANDATORY**: Redis cache keys MUST be scoped by `companyID`
🚨 **MANDATORY**: No cross-tenant data leakage allowed

---

## SUCCESS METRICS ✅ IMPLEMENTATION COMPLETE

- [x] Priority flow selects correct source based on thresholds
- [x] Multi-company isolation verified (Company A cannot see Company B data)
- [x] Booking flow captures and stores appointment data
- [x] Response traces provide transparent debugging
- [x] Behavior rules control agent responses appropriately
- [x] LLM fallback works when KB sources fail
- [x] Admin UI saves/loads configurations correctly
- [x] Performance: Optimized for sub-500ms response time for knowledge routing
