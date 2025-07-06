FILE: docs/ai_agent_spec.md
───────────────────────────────────────────────────────────────
TITLE
  Penguin Air AI Receptionist – Human‐Like Persona, Patience,
  and Continuous‐Learning Framework  (v2, adds seeding + sentiment rules)

GOALS
  1. Friendly + empathetic voice (warm, light humor, zero robo‐tone)
  2. Patience when callers need time (calendar lookup, etc.)
  3. **Seed knowledge base with 20 curated Q→A examples** so the agent
     never starts empty
  4. Continuous learning loop that proposes new courteous responses
     based on real transcripts – gated by developer approval
     • Positive caller sentiment  →  add to *best‐practice* pool
     • Negative caller sentiment  →  add to *anti‐pattern* pool
  5. All knowledge stored in a version‐controlled KB that merges
     only after approval
  6. Seed FAQ entries appear in the Knowledge Base tab so developers can
     approve, reject, or edit them before they go live

STACK
  • Node 20 + TypeScript
  • Express (voice webhook router)
  • Twilio Programmable Voice (call handling & silence events)
  • OpenAI (LLM & embeddings)
  • Vector DB → Pinecone    (KB chunks)
  • MongoDB  → Mongoose    (learning suggestions + approvals)

FOLDER LAYOUT (unchanged aside from *seedExamples.ts*)
  /src
    agent.ts
    persona.ts
    seedExamples.ts      // ★ NEW – 20 starter FAQ chunks
    middlewares/
      sentiment.ts
      patience.ts
    learning/
      feedbackLoop.ts
      suggestLines.ts
      reviewer.ts
    kb/
      ingest.js
      search.ts
  /docs
    ai_agent_spec.md
  .env
    OPENAI_API_KEY=
    PINECONE_API_KEY=
    MONGODB_URI=
    TWILIO_AUTH_TOKEN=

PERSONA  (src/persona.ts)  – same as v1

SEED EXAMPLES  (src/seedExamples.ts)
```ts
// 20 high‐value FAQ pairs to prime the KB
export const SEED_EXAMPLES: {q: string; a: string}[] = [
  {q: "Do you service heat pumps?", a: "Yes, Penguin Air services all major heat‐pump brands for installation, maintenance, and repair."},
  {q: "What areas do you cover?", a: "We serve the entire Phoenix metro including Mesa, Chandler, Gilbert, Tempe, and Scottsdale."},
  {q: "Are you open on weekends?", a: "Technicians are available 8 am – 4 pm on Saturdays. Sunday service is reserved for emergencies."},
  {q: "How much is a standard A/C tune‐up?", a: "Our 21‐point precision tune‐up is $89 and includes filter replacement, refrigerant check, and full system inspection."},
  {q: "Do you offer duct cleaning?", a: "Absolutely. Duct cleaning is scheduled like a new‐system estimate; we’ll send a comfort advisor to assess and quote."},
  {q: "What financing options are available?", a: "0 % APR for 18 months on qualifying systems, plus low‐interest terms up to 10 years."},
  {q: "Can I request technician Dustin?", a: "Yes. Just mention Dustin when booking and we’ll set the appointment on his next available slot."},
  {q: "Do you install smart thermostats?", a: "Yes, including Nest, Ecobee, and Honeywell. Installation starts at $149."},
  {q: "Is there a warranty on repairs?", a: "All repairs carry a 1‐year parts and labor warranty."},
  {q: "Do you replace refrigerant R‐22 systems?", a: "Yes, we specialize in converting legacy R‐22 units to new R‐410a or R‐454b compliant systems."},
  {q: "What’s the price for an HVAC inspection when buying a house?", a: "A pre‐purchase inspection is $129 and includes a written report with photos."},
  {q: "Do you sell maintenance plans?", a: "Our Comfort Club is $14.95/month and includes two tune‐ups, priority service, and 10 % off repairs."},
  {q: "Can the tech text me when they’re on the way?", a: "Definitely. We prefer a mobile number so we can send real‐time arrival alerts."},
  {q: "Do you handle commercial HVAC?", a: "Yes, light commercial up to 20‐ton packaged units."},
  {q: "What filters do you recommend?", a: "MERV‐8 pleated filters changed every 60 days for most homes."},
  {q: "Do you offer rebates?", a: "SRP and APS rebates are handled in‐house; we file the paperwork for you."},
  {q: "How long does a duct cleaning appointment take?", a: "Usually 3–4 hours depending on home size."},
  {q: "Is there a trip fee?", a: "No trip fee inside our standard service area."},
  {q: "Do you install mini‐split systems?", a: "Yes, single and multi‐zone Daikin and Mitsubishi systems."},
  {q: "How soon can I schedule?", a: "In most cases we have next‐day openings; peak season may extend to 48 hours."}
];
```

KB INGEST  (src/kb/ingest.js) – **add**:

```ts
import { SEED_EXAMPLES } from "../seedExamples";
// run once at startup if KB empty
export async function seedKBIfNeeded() {
  const count = await pineconeIndex.count({});
  if (count === 0) {
    await Promise.all(
      SEED_EXAMPLES.map(({q, a}) =>
        pineconeIndex.upsert([{id: uuid(), values: embedText(`${q}\n${a}`), metadata:{q,a,type:"seed"}}])
      )
    );
    console.log("KB seeded with 20 starter examples.");
  }
}
```

Call `seedKBIfNeeded()` from application entrypoint.

SENTIMENT MIDDLEWARE  (src/middlewares/sentiment.ts) – unchanged.

LEARNING LOOP  (src/learning/feedbackLoop.ts) – **update**:

```ts
// inside nightlyJob()
for (const call of yesterdayCalls) {
  const {sentimentScore, politenessTurn, line} = analyzeCall(call);
  const doc = {
    line,
    evidence: call.id,
    status: "pending",
    tag: sentimentScore > 0 ? "best-practice" : "anti-pattern"
  };
  await Suggestion.create(doc);
}
```

REVIEWER ENDPOINTS  (src/learning/reviewer.ts) – **merge rules**:

```ts
// on approve
if (suggestion.tag === "best-practice") {
  await pineconeIndex.upsert([{…}]);        // add to KB
} else {
  await pineconeIndex.upsert([{…metadata:{type:"anti-pattern"}}]);
}
```

CRON JOBS
• 00:03 boot  →  `seedKBIfNeeded()`
• 00:05 daily →  `feedbackLoop.nightlyJob()`
• 00:15 daily →  `kb.ingestWebsite('https://penguinair.com/faq')`

TEST PLAN (add step 5)
5. Verify KB has 20 documents on cold start; approve one best‑practice
suggestion and ensure KB count increments by 1.

