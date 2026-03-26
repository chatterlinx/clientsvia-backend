/**
 * ============================================================================
 * DISCOVERY PIPELINE — Page Controller
 * ============================================================================
 *
 * PURPOSE:
 *   Visual, enterprise-grade overview of every stage the agent runs on
 *   every caller turn. Shows what is wired, what has gaps, and what is
 *   not yet built — without requiring a code dive.
 *
 * ARCHITECTURE:
 *   PIPELINE_STAGES   — static data defining all pipeline stages
 *   DISCOVERY_NOTES_SCHEMA — static schema map for discoveryNotes fields
 *   API               — fetches dynamic per-company data from backend
 *   RENDERER          — renders pipeline cards, notes panel, trace output
 *   TRACE_ANALYZER    — parses call intelligence JSON → pipeline mapping
 *   MODAL             — manages the discoveryNotes detail modal
 *   INIT              — wires everything together on DOMContentLoaded
 *
 * EXTENSION GUIDE:
 *   To add a new pipeline stage: add an entry to PIPELINE_STAGES below.
 *   The renderer picks it up automatically. No other changes needed.
 *   To add a new discoveryNotes field: add to DISCOVERY_NOTES_SCHEMA.
 *
 * ============================================================================
 */

(function () {
  'use strict';

  /* =========================================================================
     MODULE: CONFIG
     ========================================================================= */

  const CONFIG = {
    API_BASE:    '/api/agent-console',
    VERSION:     'DISCOVERY_V1.0',
    PAGE_TITLE:  'Discovery Pipeline',
  };

  /* =========================================================================
     MODULE: PIPELINE STAGES
     ─────────────────────────────────────────────────────────────────────────
     Single source of truth for all pipeline stages.
     Each stage is a plain object — the renderer reads these and builds the UI.
     To add a new stage: add an entry here. Order field controls display order.

     STATUS VALUES:
       'wired'     — fully implemented and running on live calls
       'partial'   — implemented but has known gaps / missing fields
       'not_built' — architecture defined, code not written yet
       'planned'   — on roadmap, not yet designed

     ROUTING:
       always   → this stage always passes control to the named next stage
       yes      → when the stage's condition is TRUE, routes here
       no       → when the stage's condition is FALSE, routes here
     ========================================================================= */

  const PIPELINE_STAGES = [

    // ════════════════════════════════════════════════════════════════════════
    // GROUP A — CALL RECEIPT
    // ════════════════════════════════════════════════════════════════════════

    // ── [1] STT / Twilio Gather ──────────────────────────────────────────
    {
      id:       'stt_gather',
      order:    1,
      icon:     '🎙️',
      name:     'STT / Twilio Gather',
      subtitle: 'Twilio captures caller speech — config controls sensitivity, timeout, and barge-in',
      status:   'wired',
      group:    'Call Receipt',

      why: 'This is the entry point for every caller turn. Twilio fires a <Gather> verb with speech recognition settings. The quality of the transcript depends entirely on these settings — wrong timeout = agent cuts off callers; barge-in off = caller has to wait for agent to finish before speaking. Every downstream stage depends on clean STT input.',

      engine:   'Twilio <Gather verb> with speech recognition',
      provider: 'Twilio (Google Speech-to-Text under the hood)',
      model:    'Configurable via speechModel setting',
      fires:    'Every turn — opening gather after greeting, every gather after agent response.',
      writesTo: 'req.body.SpeechResult → downstream stages',
      wiredIn:  ['routes/v2twilio.js — /v2-agent (greeting gather)', 'routes/v2twilio.js — /v2-agent-sentence-continue (post-response gather)'],
      configIn:  'Speech Detection — Agent 2.0 Settings',
      configUrl: 'agent2.html',

      extracts: [],

      configFields: [
        { key: 'speechTimeout',       label: 'Speech Timeout',        unit: 's',   note: 'How long agent waits after caller stops speaking before processing' },
        { key: 'initialTimeout',      label: 'Initial Timeout',       unit: 's',   note: 'How long agent waits for caller to start speaking' },
        { key: 'bargeIn',             label: 'Barge-in',              unit: 'bool',note: 'Allow caller to interrupt agent mid-response' },
        { key: 'enhancedRecognition', label: 'Enhanced Recognition',  unit: 'bool',note: 'Higher-accuracy STT model (recommended for phone calls)' },
        { key: 'speechModel',         label: 'Speech Model',          unit: 'enum',note: 'phone_call = best for telephony; default = general purpose' },
      ],

      gaps: [],

      routing: { always: 'scrabengine' },
    },

    // ── [2] ScrabEngine — Transcript Cleaning ────────────────────────────
    {
      id:       'scrabengine',
      order:    2,
      icon:     '🔍',
      name:     'ScrabEngine — Transcript Cleaning',
      subtitle: 'Removes filler words, expands vocabulary, applies synonyms before LLM sees the text',
      status:   'wired',
      group:    'Call Receipt',

      why: 'Raw STT is noisy. Callers say "um", "uh", "like", "you know" — these dilute the signal and confuse keyword matching. ScrabEngine strips fillers, then expands vocabulary tokens ("AC" → "air conditioner") and applies synonym maps. The cleaned text gives the LLM and KC engine a much higher-quality signal to work with. Without this, KC matching degrades significantly.',

      engine:   'ScrabEngineService V125',
      provider: 'Synchronous (no AI) — pure string processing',
      model:    null,
      fires:    'Every turn, applied to SpeechResult before routing to LLM_INTAKE or KC engine.',
      writesTo: 'cleanedTranscript — read by all downstream stages',
      wiredIn:  ['services/scrabEngine/ScrabEngineService.js', 'routes/v2twilio.js — preprocessing step'],
      configIn:  'ScrabEngine',
      configUrl: 'scrabengine.html',

      extracts: [],
      gaps:     [],

      routing: { always: 'llm_intake' },
    },

    // ════════════════════════════════════════════════════════════════════════
    // GROUP B — TURN 1: LLM INTAKE
    // ════════════════════════════════════════════════════════════════════════

    // ── [3] LLM Intake (Turn 1) ──────────────────────────────────────────
    {
      id:       'llm_intake',
      order:    3,
      icon:     '🧠',
      name:     'LLM Intake — Entity Extraction',
      subtitle: 'Groq extracts who is calling and why — builds discoveryNotes profile for all downstream stages',
      status:   'partial',
      group:    'Turn 1 — LLM Intake',

      why: 'This is the brain of Turn 1. Groq (llama-3.1-70b-versatile) reads the caller\'s first utterance and extracts structured data: name, call reason, urgency, prior visit, same-day request, caller type. This profile is written to discoveryNotes (Redis, TTL=4h) and injected into every subsequent LLM prompt — it is why the agent remembers context across turns and does not ask the same question twice.',

      engine:   'HybridReceptionistLLM — LLM_INTAKE_TURN_1',
      provider: 'Groq',
      model:    'llama-3.1-70b-versatile',
      fires:    'Turn 1 only. KC engine updates callReason + objective on subsequent turns.',
      writesTo: 'discoveryNotes (Redis: discovery-notes:{companyId}:{callSid}, TTL=4h) → MongoDB Customer.discoveryNotes[] at call end',
      wiredIn:  ['services/HybridReceptionistLLM.js — _buildIntakePrompt()', 'services/discoveryNotes/DiscoveryNotesService.js'],
      configIn:  null,
      configUrl: null,

      extracts: [
        { field: 'entities.firstName',  label: 'First Name',        status: 'active'  },
        { field: 'entities.lastName',   label: 'Last Name',         status: 'partial' },
        { field: 'callReason',          label: 'Call Reason',       status: 'active'  },
        { field: 'urgency',             label: 'Urgency',           status: 'active'  },
        { field: 'priorVisit',          label: 'Prior Visit Flag',  status: 'active'  },
        { field: 'sameDayRequested',    label: 'Same-Day Request',  status: 'active'  },
        { field: 'callerType',          label: 'Caller Type',       status: 'active'  },
        { field: 'employeeMentioned',   label: 'Employee Mentioned',status: 'gap'     },
      ],

      gaps: [
        'employeeMentioned: Caller says "Hi John" (greeting an employee by name) — field stays null. Agent cannot acknowledge prior employee relationships. Fix: add employeeMentioned extraction to the intake prompt schema.',
        'No Turn 1 booking gate: If caller\'s first utterance is a pure booking signal ("just schedule me"), intake engine runs anyway — wasted Groq call. Fix: check for booking intent before running intake.',
      ],

      routing: { always: 'greeting_protocol' },
    },

    // ── [4] Greeting Protocol (Groq Protocol) ───────────────────────────
    {
      id:       'greeting_protocol',
      order:    4,
      icon:     '👋',
      name:     'Greeting Protocol — Groq Response Rules',
      subtitle: 'Groq protocol: mirror greeting → greet caller by name → acknowledge problem → offer solution',
      status:   'partial',
      group:    'Turn 1 — LLM Intake',

      why: 'A technically correct answer delivered coldly feels wrong on a phone call. The Groq Protocol is a set of system prompt rules that structure every Turn 1 response: Rule 1 = mirror the caller\'s greeting (if they say "Good morning", say it back); Rule 2 = greet caller by name if extracted; Rule 8 = always acknowledge the problem before offering a solution; Rule 14/V96j = offer a solution, not just a claim ("We can check availability right now" not "We handle that"). This is what makes the agent feel like a real person.',

      engine:   'HybridReceptionistLLM system prompt rules',
      provider: 'Groq (same call as LLM Intake — no extra round-trip)',
      model:    'llama-3.1-70b-versatile',
      fires:    'Turn 1 response generation. Same Groq call as entity extraction.',
      writesTo: 'agent response text → first-sentence streaming path',
      wiredIn:  ['services/HybridReceptionistLLM.js — Rule 1 (mirror greeting), Rule 2 (name), Rule 8 (ack), Rule 14/V96j (solution CTA)'],
      configIn:  null,
      configUrl: null,

      extracts: [],

      gaps: [
        'employeeMentioned not applied: If caller says "Hi John" and John is an employee, agent cannot say "I see you have worked with John before" — employeeMentioned is null.',
        'Not UI-configurable: The greeting/ack/CTA protocol is hardcoded in system prompt rules. Admins cannot adjust the format, tone, or CTA wording without a code change.',
        'KC path missing: The Groq Protocol rules only apply to HybridReceptionistLLM (Turn 1). If a returning customer asks a question on Turn 2+ via KC engine, their prior visit is not acknowledged.',
      ],

      routing: { always: 'first_sentence_streaming' },
    },

    // ── [5] First-Sentence Fast Path ─────────────────────────────────────
    {
      id:       'first_sentence_streaming',
      order:    5,
      icon:     '⚡',
      name:     'First-Sentence Fast Path',
      subtitle: 'First sentence streams to ElevenLabs immediately — caller hears audio in ~400ms, no bridge',
      status:   'wired',
      group:    'Turn 1 — LLM Intake',

      why: 'The single most impactful performance optimization in the platform. Instead of waiting for the full LLM response before sending anything to TTS, the runtime detects the first sentence boundary (period/comma/question mark) as Groq streams tokens, immediately sends that sentence to ElevenLabs, and plays it via <Play>. The caller hears audio in ~400ms. The remaining sentences continue in /v2-agent-sentence-continue. Without this, TTFB would be 1-2 seconds — the caller thinks the line is dead.',

      engine:   'v2twilio.js — first-sentence streaming to ElevenLabs',
      provider: 'ElevenLabs (TTS)',
      model:    'Configured per company (voiceSettings)',
      fires:    'Every LLM/Groq response turn. Applies to Turn 1 (HybridReceptionist) and KC/LLM fallback responses.',
      writesTo: 'MP3 stream → Twilio <Play> → caller hears audio',
      wiredIn:  ['routes/v2twilio.js — first-sentence detection + ElevenLabs stream', 'routes/v2twilio.js — /v2-agent-sentence-continue (remainder of response)'],
      configIn:  'Voice Settings (agent2.html)',
      configUrl: 'agent2.html',

      configFields: [
        { key: 'voiceId',           label: 'Voice ID',            unit: 'string', note: 'ElevenLabs voice to use for this company' },
        { key: 'stability',         label: 'Stability',           unit: '0-1',    note: 'Lower = more expressive, higher = more consistent' },
        { key: 'similarityBoost',   label: 'Similarity Boost',    unit: '0-1',    note: 'How closely to match the original voice' },
        { key: 'styleExaggeration', label: 'Style Exaggeration',  unit: '0-1',    note: 'Amplifies speaking style' },
        { key: 'streamingLatency',  label: 'Streaming Latency',   unit: 'enum',   note: '0=lowest latency, 4=highest quality' },
      ],

      extracts: [],
      gaps:     [],

      routing: { always: 'question_detector' },
    },

    // ════════════════════════════════════════════════════════════════════════
    // GROUP C — TURN 2+: KC ENGINE
    // ════════════════════════════════════════════════════════════════════════

    // ── [6] Question Detector ────────────────────────────────────────────
    {
      id:       'question_detector',
      order:    6,
      icon:     '❓',
      name:     'Question Detector',
      subtitle: 'Scans utterance for KC signals BEFORE booking intent fires — prevents questions being silently ignored',
      status:   'not_built',
      group:    'Turn 2+ — KC Engine',

      why: 'Callers do not follow a script. They say "my AC is broken — do you accept credit cards?" in a single utterance. Without this gate, the booking intent fires first and wins — the credit card question is completely ignored. The caller gets "Can I get someone to schedule that?" when they wanted an answer. This detector runs a fast KnowledgeContainerService signal scan on every utterance BEFORE the booking intent check. If a KC signal is found, route to KC Answer first, then append the booking CTA.',

      engine:   null,
      provider: 'NOT BUILT',
      model:    null,
      fires:    'Every turn, before Booking Intent Gate. Needs to fire on Turn 1 too.',
      writesTo: null,
      wiredIn:  [],
      configIn:  null,
      configUrl: null,

      extracts: [],

      gaps: [
        'NOT BUILT: Confirmed with real call — Caller said "Do you accept credit cards?" on Turn 1. Agent responded "Can I get someone to look into that for you?" — completely wrong answer, question ignored.',
        'Fix: Run KnowledgeContainerService.findMatches(cleanedTranscript) before booking intent check. If matches.length > 0, route YES to kc_answer.',
        'Impact: HIGH — every caller who asks a factual question (pricing, warranty, inclusions) on any turn gets the wrong routing if the utterance also contains a problem statement.',
      ],

      routing: { yes: 'kc_answer', no: 'booking_intent' },
    },

    // ── [7] Booking Intent Gate ──────────────────────────────────────────
    {
      id:       'booking_intent',
      order:    7,
      icon:     '🔒',
      name:     'Booking Intent Gate',
      subtitle: 'Pure booking signals skip straight to handoff — no KC or LLM needed',
      status:   'partial',
      group:    'Turn 2+ — KC Engine',

      why: 'When a caller says "yes schedule me" or "let\'s book it" with no question, running KC or LLM is wasteful. This gate detects pure booking intent and routes immediately to BookingLogicEngine. Saves ~300ms and avoids a Groq call. Currently only wired on Turn 2+ (KC engine path). If a caller\'s very first utterance is a booking signal, the intake engine still runs unnecessarily.',

      engine:   'KCBookingIntentDetector',
      provider: 'Synchronous (no AI) — phrase matching',
      model:    null,
      fires:    'Turn 2+ (KC engine path). NOT active on Turn 1.',
      writesTo: 'discoveryNotes.objective = BOOKING, state.lane = BOOKING',
      wiredIn:  ['services/engine/kc/KCDiscoveryRunner.js — Gate 1', 'services/engine/kc/KCBookingIntentDetector.js'],
      configIn:  'Consent & Escalation Phrases — Agent 2.0 Settings',
      configUrl: 'agent2.html',

      extracts: [],

      gaps: [
        'NOT wired on Turn 1: First-utterance booking signals ("I just want to book") still run the full LLM_INTAKE path. Should short-circuit to booking handoff immediately.',
      ],

      routing: { yes: 'BOOKING HANDOFF → BookingLogicEngine', no: 'kc_answer' },
    },

    // ── [8] KC Answer ────────────────────────────────────────────────────
    {
      id:       'kc_answer',
      order:    8,
      icon:     '📦',
      name:     'KC Answer — Knowledge Containers',
      subtitle: 'Groq answers from admin-authored facts only — no hallucination, bounded to your content',
      status:   'wired',
      group:    'Turn 2+ — KC Engine',

      why: 'When a caller asks "how much is a service call?" the answer must come from company-authored content, not LLM general knowledge. This stage scores every knowledge container against the utterance, picks the best match, passes its content to Groq, and gets a natural spoken answer bounded entirely to that container. Zero hallucination. Groq also handles multi-turn: if the same container matches again (SPFUQ), it continues that topic. If a new container matches, it topic-hops.',

      engine:   'KnowledgeContainerService + KCDiscoveryRunner',
      provider: 'Groq',
      model:    'llama-3.3-70b-versatile',
      fires:    'Turn 2+ when a KC signal is detected (or Turn 1 once Question Detector is built).',
      writesTo: 'discoveryNotes.callReason (updated to container title), discoveryNotes.qaLog (new entry), SPFUQ anchor (Redis)',
      wiredIn:  ['services/engine/kc/KCDiscoveryRunner.js — Gates 3-4', 'services/engine/agent2/KnowledgeContainerService.js'],
      configIn:  'Knowledge Containers',
      configUrl: 'services.html',

      extracts: [],
      gaps:     [],  // enriched dynamically — shows warning if 0 containers configured

      routing: { yes: 'groq_formatter', no: 'llm_fallback' },
    },

    // ── [9] Groq Response Formatter ──────────────────────────────────────
    {
      id:       'groq_formatter',
      order:    9,
      icon:     '🤖',
      name:     'Groq Response Formatter',
      subtitle: 'Applies Groq Protocol to KC answers: name + acknowledgement + answer + CTA',
      status:   'partial',
      group:    'Turn 2+ — KC Engine',

      why: 'A correct KC answer delivered without warmth sounds like a robot reading a FAQ. The formatter wraps KC output with the same Groq Protocol used on Turn 1: greet by name if known, acknowledge prior visit or employee relationship, deliver the answer, close with a natural CTA. This is the layer that makes KC answers sound like they come from a real agent, not a database lookup.',

      engine:   'KnowledgeContainerService._buildSystemPrompt()',
      provider: 'Groq (same call as KC matching — no extra round-trip)',
      model:    null,
      fires:    'Every KC Answer response. Same Groq call as container matching.',
      writesTo: 'agent response text → first-sentence streaming path',
      wiredIn:  ['services/engine/agent2/KnowledgeContainerService.js — _buildSystemPrompt()', 'services/HybridReceptionistLLM.js — Rules 1, 2, 8, 14'],
      configIn:  null,
      configUrl: null,

      extracts: [],

      gaps: [
        'priorVisit not acknowledged on KC path: HybridReceptionistLLM correctly says "I see we\'ve worked with you before" on Turn 1, but KC engine does not carry this forward on Turn 2+.',
        'employeeMentioned not applied: Cannot reference prior employee relationship in KC responses — field is null.',
        'Not UI-configurable: Greeting/ack/CTA protocol hardcoded in system prompts. Admins cannot adjust tone or format without a code change.',
      ],

      routing: { always: 'first_sentence_streaming' },
    },

    // ── [10] LLM Fallback ────────────────────────────────────────────────
    {
      id:       'llm_fallback',
      order:    10,
      icon:     '🔮',
      name:     'LLM Fallback — Claude',
      subtitle: 'Claude handles complex questions KC containers could not match',
      status:   'wired',
      group:    'Turn 2+ — KC Engine',

      why: 'No KC container library covers every possible caller question. When KC returns NO_DATA, rather than saying "I don\'t know", this stage calls Claude with the full discoveryNotes context (callReason, urgency, entities, qaLog, objective). Claude can reason across topics, handle ambiguity, and give intelligent answers even for edge cases. The discoveryNotes context prevents Claude from asking questions the caller already answered.',

      engine:   'callLLMAgentForFollowUp — Agent2DiscoveryRunner',
      provider: 'Claude (Anthropic)',
      model:    'Reads from company LLM config (llm.html)',
      fires:    'When KC Answer returns NO_DATA or ERROR.',
      writesTo: null,
      wiredIn:  ['services/engine/kc/KCDiscoveryRunner.js — _handleLLMFallback()', 'services/engine/agent2/Agent2DiscoveryRunner.js — callLLMAgentForFollowUp()'],
      configIn:  'LLM Settings',
      configUrl: 'llm.html',

      extracts: [],
      gaps:     [],

      routing: { yes: 'first_sentence_streaming', no: 'graceful_ack' },
    },

    // ── [11] Graceful ACK ────────────────────────────────────────────────
    {
      id:       'graceful_ack',
      order:    11,
      icon:     '🆗',
      name:     'Graceful ACK',
      subtitle: 'Final safety net — canned acknowledgement when all AI paths are unavailable',
      status:   'wired',
      group:    'Turn 2+ — KC Engine',

      why: 'If both KC and Claude fail (network timeout, API outage, rate limit), the caller must not hear silence or an error message. This stage returns a pre-written acknowledgement that acknowledges the problem and buys time. It is the floor that prevents total failure from being caller-visible.',

      engine:   'Static response (no AI)',
      provider: null,
      model:    null,
      fires:    'Only when KC Answer + LLM Fallback both fail.',
      writesTo: null,
      wiredIn:  ['services/engine/kc/KCDiscoveryRunner.js — _handleLLMFallback() graceful path'],
      configIn:  'Fallback Response — Knowledge settings',
      configUrl: 'services.html',

      extracts: [],
      gaps:     [],

      routing: { always: 'bridge_config' },
    },

    // ════════════════════════════════════════════════════════════════════════
    // GROUP D — RESPONSE DELIVERY
    // ════════════════════════════════════════════════════════════════════════

    // ── [12] Bridge / Post-Gather Config ────────────────────────────────
    {
      id:       'bridge_config',
      order:    12,
      icon:     '🌉',
      name:     'Bridge — Post-Gather Delay',
      subtitle: 'postGatherDelayMs controls silence window before next <Gather> fires — critical for response completion',
      status:   'wired',
      group:    'Response Delivery',

      why: 'After the agent\'s audio finishes playing, there is a silence window before Twilio opens the next <Gather>. Too short = Twilio cuts off the last word. Too long = caller hears dead air and hangs up. postGatherDelayMs controls this window. The first-sentence fast path means the bridge is mostly bypassed on Turn 1 — but it still controls the gather timing on every follow-up turn. maxCeilingMs is the hard ceiling: if the total response exceeds it, the gather fires anyway.',

      engine:   'Twilio <Play> + <Pause> + <Gather>',
      provider: 'Twilio (no AI)',
      model:    null,
      fires:    'After every agent response completes playing.',
      writesTo: null,
      wiredIn:  ['routes/v2twilio.js — bridge construction', 'routes/v2twilio.js — /v2-agent-sentence-continue'],
      configIn:  'Bridge Settings — Agent 2.0 Settings',
      configUrl: 'agent2.html',

      configFields: [
        { key: 'postGatherDelayMs', label: 'Post-Gather Delay', unit: 'ms',   note: 'Silence window after audio ends before next gather fires. Default: 500ms' },
        { key: 'maxCeilingMs',      label: 'Max Ceiling',       unit: 'ms',   note: 'Hard cap on total response window. Default: 15000ms' },
        { key: 'bridgeEnabled',     label: 'Bridge Enabled',    unit: 'bool', note: 'Master switch. Disabled = immediate gather (fastest, may cut responses)' },
      ],

      extracts: [],
      gaps:     [],

      routing: { always: 'stt_gather (next turn)' },
    },
  ];

  /* =========================================================================
     MODULE: DISCOVERY NOTES SCHEMA
     ─────────────────────────────────────────────────────────────────────────
     Maps every field discoveryNotes can hold.
     Status: active | partial | gap | booking
     This is merged with the API response (which may add gap annotations).
     ========================================================================= */

  const DISCOVERY_NOTES_SCHEMA = [
    { key: 'entities.firstName',  label: 'First Name',          status: 'active',  source: 'LLM_INTAKE — extracted from caller\'s first utterance' },
    { key: 'entities.lastName',   label: 'Last Name',           status: 'partial', source: 'LLM_INTAKE — only when caller states full name' },
    { key: 'entities.fullName',   label: 'Full Name',           status: 'partial', source: 'LLM_INTAKE — composed when both names extracted' },
    { key: 'entities.phone',      label: 'Phone Number',        status: 'booking', source: 'BookingLogicEngine — collected during booking flow' },
    { key: 'entities.address',    label: 'Service Address',     status: 'booking', source: 'BookingLogicEngine — collected during booking flow' },
    { key: 'callReason',          label: 'Call Reason',         status: 'active',  source: 'LLM_INTAKE + KC Engine updates on each container match' },
    { key: 'urgency',             label: 'Urgency Level',       status: 'active',  source: 'LLM_INTAKE (low / normal / high / emergency)' },
    { key: 'objective',           label: 'Objective',           status: 'active',  source: 'KC Engine (INTAKE / DISCOVERY / BOOKING / TRANSFER / CLOSING)' },
    { key: 'priorVisit',          label: 'Prior Visit Flag',    status: 'active',  source: 'LLM_INTAKE — true when caller mentions prior service' },
    { key: 'sameDayRequested',    label: 'Same-Day Request',    status: 'active',  source: 'LLM_INTAKE — true when caller implies urgency or today' },
    { key: 'employeeMentioned',   label: 'Employee Mentioned',  status: 'gap',     source: '⚠️ NOT EXTRACTED — caller says "Hi John", field stays null' },
    { key: 'doNotReask',          label: 'Do Not Re-ask List',  status: 'active',  source: 'Populated after each extraction — prevents repeated questions' },
    { key: 'qaLog',               label: 'Q&A Log (per turn)',  status: 'active',  source: 'KC Engine — appends { turn, question, answer } on each KC response' },
    { key: 'turnNumber',          label: 'Current Turn',        status: 'active',  source: 'Incremented at every gather completion' },
    { key: 'lastMeaningfulInput', label: 'Last Meaningful Input', status: 'active', source: 'KC Engine — the raw utterance that produced the last KC answer' },
  ];

  /* =========================================================================
     MODULE: DOM BINDINGS
     ─────────────────────────────────────────────────────────────────────────
     All DOM references in one place. Never query the DOM outside this object.
     ========================================================================= */

  const DOM = {
    headerBackLink:    document.getElementById('header-back-link'),
    headerCompanyName: document.getElementById('header-company-name'),
    headerCompanyId:   document.getElementById('header-company-id'),
    btnRefresh:        document.getElementById('btn-refresh'),
    liveBadge:         document.getElementById('dp-live-badge'),
    liveTimestamp:     document.getElementById('dp-live-timestamp'),
    statsBar:          document.getElementById('dp-stats-bar'),
    pipelineContainer: document.getElementById('dp-pipeline-container'),
    notesFields:       document.getElementById('dp-notes-fields'),
    btnNotesDetail:    document.getElementById('btn-notes-detail'),
    modalNotes:        document.getElementById('modal-discovery-notes'),
    btnNotesModalClose:document.getElementById('btn-notes-modal-close'),
    modalNotesFields:  document.getElementById('modal-notes-fields-table'),
    modalNotesGaps:    document.getElementById('modal-notes-gaps'),
    traceInput:        document.getElementById('dp-trace-input'),
    btnAnalyze:        document.getElementById('dp-btn-analyze'),
    btnDownloadJson:   document.getElementById('dp-btn-download-json'),
    btnDownloadPdf:    document.getElementById('dp-btn-download-pdf'),
    traceOutput:       document.getElementById('dp-trace-output'),
  };

  /* =========================================================================
     MODULE: STATE
     ========================================================================= */

  const state = {
    companyId:        null,
    companyName:      '',
    pipelineData:     null,   // raw API response
    stages:           [],     // enriched PIPELINE_STAGES after API merge
    lastRefreshed:    null,   // ms timestamp of last successful Phase 2
    autoRefreshTimer: null,   // setInterval handle
    tickTimer:        null,   // setInterval for live badge counter
    lastAnalysis:     null,   // last TRACE_ANALYZER result (for PDF)
  };

  /* =========================================================================
     MODULE: API
     ─────────────────────────────────────────────────────────────────────────
     All backend calls go through AgentConsoleAuth.apiFetch so auth is
     handled centrally. One function per endpoint.
     ========================================================================= */

  const API = {
    async getPipelineStatus(companyId) {
      return AgentConsoleAuth.apiFetch(
        `${CONFIG.API_BASE}/${companyId}/discovery/status`
      );
    },
  };

  /* =========================================================================
     MODULE: UTILS
     ========================================================================= */

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusLabel(status) {
    const map = {
      wired:     '✅ Wired',
      partial:   '⚠️ Partial',
      not_built: '❌ Not Built',
      planned:   '🔵 Planned',
    };
    return map[status] || status;
  }

  function getCompanyIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('companyId') || '';
  }

  /* =========================================================================
     MODULE: PIPELINE ENRICHMENT
     ─────────────────────────────────────────────────────────────────────────
     Merges static PIPELINE_STAGES with dynamic API data.
     Only this function knows about the API response shape.
     ========================================================================= */

  function enrichStages(apiData) {
    return PIPELINE_STAGES.map(stage => {
      const enriched = { ...stage, gaps: [...(stage.gaps || [])] };

      if (!apiData) return enriched;

      // STT Gather: overlay live speechDetection config
      if (stage.id === 'stt_gather') {
        const sd = apiData.pipeline?.speechDetection;
        if (sd) {
          enriched.dynamicBadge = `timeout:${sd.speechTimeout}s  initial:${sd.initialTimeout}s  model:${sd.speechModel}`;
        } else {
          enriched.gaps.push('speechDetection config not found — using Twilio defaults. Configure in Agent 2.0 → Speech Detection.');
        }
      }

      // KC Answer: warn if no containers configured
      if (stage.id === 'kc_answer') {
        const count = apiData.pipeline?.kcContainerCount ?? 0;
        if (count === 0) {
          enriched.status = 'partial';
          enriched.gaps.push(
            'No Knowledge Containers configured. KC Answer stage cannot match any question — every caller falls to LLM Fallback. Add containers in Services to activate this stage.'
          );
        } else {
          enriched.dynamicBadge = `${count} container${count !== 1 ? 's' : ''} active`;
        }
      }

      // Booking Intent: show consent phrase count
      if (stage.id === 'booking_intent') {
        const count = apiData.pipeline?.consentPhrasesCount ?? 0;
        enriched.dynamicBadge = count > 0 ? `${count} consent phrases` : null;
        if (count === 0) {
          enriched.gaps.push('No consent phrases configured — booking intent detection may be unreliable. Add phrases in Agent 2.0 Settings.');
        }
      }

      // Bridge: overlay live postGatherDelayMs and maxCeilingMs
      if (stage.id === 'bridge_config') {
        const p = apiData.pipeline;
        if (p) {
          const delay   = p.postGatherDelayMs ?? '?';
          const ceiling = p.maxCeilingMs ?? '?';
          const enabled = p.bridgeEnabled !== false;
          enriched.dynamicBadge = `delay:${delay}ms  ceil:${ceiling}ms  ${enabled ? 'enabled' : '⚠️ disabled'}`;
          if (!enabled) {
            enriched.gaps.push('Bridge is disabled — immediate gather fires after every response. Callers may be cut off on long responses.');
          }
        }
      }

      return enriched;
    });
  }

  /* =========================================================================
     MODULE: OPEN-CARD STATE HELPERS
     ─────────────────────────────────────────────────────────────────────────
     Used by auto-refresh to preserve expanded cards across re-renders.
     ========================================================================= */

  /** Return IDs of all currently-open pipeline cards. */
  function getOpenCards() {
    return Array.from(document.querySelectorAll('.dp-card-body.open'))
      .map(el => el.id.replace('dp-body-', ''));
  }

  /** Re-open cards by ID after a re-render. */
  function restoreOpenCards(openIds) {
    openIds.forEach(id => {
      const body = document.getElementById(`dp-body-${id}`);
      const btn  = document.getElementById(`dp-expand-${id}`);
      if (body) {
        body.classList.add('open');
        if (btn) btn.textContent = '▴';
      }
    });
  }

  /* =========================================================================
     MODULE: LIVE INDICATOR
     ========================================================================= */

  /** Update the "Updated Xs ago" text in the live badge. */
  function updateLiveIndicator() {
    if (!DOM.liveBadge || !DOM.liveTimestamp || !state.lastRefreshed) return;
    DOM.liveBadge.style.display = 'inline-flex';
    const secs = Math.round((Date.now() - state.lastRefreshed) / 1000);
    DOM.liveTimestamp.textContent = secs < 5 ? 'just now' : `${secs}s ago`;
  }

  /* =========================================================================
     MODULE: AUTO-REFRESH (PHASE 2 ONLY)
     ─────────────────────────────────────────────────────────────────────────
     Fetches live API data every AUTO_REFRESH_MS ms.
     Only re-renders pipeline if key values changed — preserves open cards.
     ========================================================================= */

  const AUTO_REFRESH_MS = 30_000;  // 30 seconds

  /** Fingerprint the fields that matter for change detection. */
  function pipelineFingerprint(data) {
    if (!data) return null;
    const p = data.pipeline || {};
    return JSON.stringify({
      kc:      p.kcContainerCount,
      trig:    p.triggerCount,
      delay:   p.postGatherDelayMs,
      ceil:    p.maxCeilingMs,
      bridge:  p.bridgeEnabled,
      sttTo:   p.speechDetection?.speechTimeout,
      sttInit: p.speechDetection?.initialTimeout,
    });
  }

  async function refreshPhase2Only() {
    if (!state.companyId) return;
    try {
      const data = await API.getPipelineStatus(state.companyId);
      const changed = pipelineFingerprint(data) !== pipelineFingerprint(state.pipelineData);

      state.pipelineData = data;
      state.lastRefreshed = Date.now();

      if (changed) {
        // Preserve which cards are open
        const openCards = getOpenCards();

        state.stages = enrichStages(data);
        renderStatsBar(state.stages, data);
        renderPipeline(state.stages);
        restoreOpenCards(openCards);

        // Update notes panel
        const apiFields = data.discoveryNotes?.fields || [];
        const schema = DISCOVERY_NOTES_SCHEMA.map(field => {
          const apiField = apiFields.find(f => f.key === field.key);
          return apiField ? { ...field, status: apiField.status, source: apiField.source } : field;
        });
        renderNotesPanel(schema);
        renderNotesModal(schema, data.discoveryNotes?.gaps || []);
      }

      updateLiveIndicator();
    } catch (err) {
      console.warn('[Discovery] Auto-refresh failed:', err);
    }
  }

  /* =========================================================================
     MODULE: DOWNLOADER
     ─────────────────────────────────────────────────────────────────────────
     JSON: downloads the raw pasted call intelligence JSON as a file.
     PDF:  opens a clean print-ready window with the trace analysis output.
     ========================================================================= */

  const DOWNLOADER = {

    /** Download the raw pasted JSON from the trace textarea. */
    json() {
      const raw = DOM.traceInput?.value?.trim();
      if (!raw) {
        DOWNLOADER._toast('Paste a call intelligence JSON first.');
        return;
      }
      // Pretty-print if valid JSON
      let content = raw;
      let callSid = 'call';
      try {
        const parsed = JSON.parse(raw);
        content  = JSON.stringify(parsed, null, 2);
        callSid  = parsed.callSid || parsed.intelligence?.callSid || parsed.callContext?.callSid || 'call';
      } catch (_e) { /* keep raw */ }

      const blob = new Blob([content], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `call-intelligence-${callSid}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    /** Export the trace analysis as a PDF via a clean print window. */
    pdf() {
      const output = DOM.traceOutput;
      if (!output || !output.innerHTML.trim()) {
        DOWNLOADER._toast('Run "Analyze Call" first to generate the report.');
        return;
      }

      // Try to extract callSid for the title
      let callSid = '';
      try {
        const raw = DOM.traceInput?.value?.trim();
        if (raw) {
          const parsed = JSON.parse(raw);
          callSid = parsed.callSid || parsed.intelligence?.callSid || '';
        }
      } catch (_e) { /* ignore */ }

      const title   = `Call Trace Analysis${callSid ? ' — ' + callSid : ''}`;
      const company = state.companyName || state.companyId || '';
      const ts      = new Date().toLocaleString();

      const printWin = window.open('', '_blank', 'width=940,height=720');
      if (!printWin) {
        DOWNLOADER._toast('Pop-up blocked. Allow pop-ups for this page, then try again.');
        return;
      }

      printWin.document.write(`<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <title>${escRaw(title)}</title>
  <style>
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding:28px 32px; color:#111827; font-size:13px; line-height:1.5; }
    h1   { font-size:18px; font-weight:700; margin:0 0 4px; }
    .meta{ font-size:11px; color:#6b7280; margin-bottom:20px; }
    .dp-trace-turn { border:1.5px solid #e5e7eb; border-radius:8px; overflow:hidden; margin-bottom:12px; page-break-inside:avoid; }
    .dp-trace-turn-header { background:#f8fafc; padding:9px 14px; font-size:12px; font-weight:700; color:#374151; display:flex; align-items:center; gap:8px; }
    .dp-trace-turn-body   { padding:12px 14px; }
    .dp-trace-stage { display:flex; gap:10px; align-items:flex-start; padding:6px 0; border-bottom:1px solid #f3f4f6; font-size:12px; }
    .dp-trace-stage:last-child { border-bottom:none; }
    .dp-trace-stage-icon   { flex-shrink:0; }
    .dp-trace-stage-name   { font-weight:600; color:#111827; }
    .dp-trace-stage-detail { color:#6b7280; font-size:11px; margin-top:2px; }
    .dp-trace-stage-status { margin-left:auto; flex-shrink:0; font-size:10px; font-weight:700; padding:2px 8px; border-radius:999px; }
    .dp-trace-stage-status.fired   { background:#dcfce7; color:#15803d; }
    .dp-trace-stage-status.skipped { background:#f3f4f6; color:#6b7280; }
    .dp-trace-stage-status.missed  { background:#fee2e2; color:#991b1b; }
    .dp-trace-stage-status.gap     { background:#fef9c3; color:#854d0e; }
    .dp-trace-response { background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:10px 12px; font-size:12px; color:#166534; line-height:1.6; margin-top:10px; }
    .dp-trace-score { margin-top:10px; padding:10px 12px; background:#f8fafc; border-radius:8px; }
    .dp-trace-score-title { font-size:11px; font-weight:700; color:#374151; margin-bottom:6px; }
    .dp-trace-score-item      { font-size:11px; padding:2px 0; }
    .dp-trace-score-item.pass { color:#15803d; }
    .dp-trace-score-item.fail { color:#991b1b; }
    @media print { body { padding:0; } }
  </style>
</head><body>
  <h1>${escRaw(title)}</h1>
  <div class="meta">${company ? 'Company: ' + escRaw(company) + ' · ' : ''}Generated: ${escRaw(ts)}</div>
  ${output.innerHTML}
  <script>window.onload = function(){ window.print(); }<\/script>
</body></html>`);
      printWin.document.close();
    },

    /** Show a small inline toast below the download bar. */
    _toast(msg) {
      const bar = DOM.btnDownloadJson?.parentElement;
      if (!bar) return;
      let t = bar.querySelector('.dp-dl-toast');
      if (!t) {
        t = document.createElement('div');
        t.className = 'dp-dl-toast';
        t.style.cssText = 'font-size:11px;color:#9a3412;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:6px 10px;margin-top:6px;';
        bar.insertAdjacentElement('afterend', t);
      }
      t.textContent = msg;
      t.style.display = 'block';
      clearTimeout(t._hideTimer);
      t._hideTimer = setTimeout(() => { t.style.display = 'none'; }, 3500);
    },
  };

  /* Helper used by DOWNLOADER — HTML-escapes without the full esc() chain */
  function escRaw(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* =========================================================================
     MODULE: RENDERER — STATS BAR
     ========================================================================= */

  function renderStatsBar(stages, apiData) {
    const wired    = stages.filter(s => s.status === 'wired').length;
    const partial  = stages.filter(s => s.status === 'partial').length;
    const notBuilt = stages.filter(s => s.status === 'not_built').length;
    const kcCount  = apiData?.pipeline?.kcContainerCount ?? '—';
    const triggers = apiData?.pipeline?.triggerCount ?? '—';

    DOM.statsBar.innerHTML = `
      <div class="dp-stat-pill wired">
        <div class="dp-stat-dot"></div>
        <span>${wired} / ${stages.length} Wired</span>
      </div>
      <div class="dp-stat-pill partial">
        <div class="dp-stat-dot"></div>
        <span>${partial} Partial</span>
      </div>
      <div class="dp-stat-pill not-built">
        <div class="dp-stat-dot"></div>
        <span>${notBuilt} Not Built</span>
      </div>
      <div class="dp-stat-pill info">
        <div class="dp-stat-dot"></div>
        <span>${kcCount} KC Containers</span>
      </div>
      <div class="dp-stat-pill info">
        <div class="dp-stat-dot"></div>
        <span>${triggers} Trigger Cards</span>
      </div>
    `;
  }

  /* =========================================================================
     MODULE: RENDERER — PIPELINE CARD
     ─────────────────────────────────────────────────────────────────────────
     Each stage becomes a collapsible card.
     Branching connectors are rendered between cards based on stage.routing.
     ========================================================================= */

  function renderPipelineCard(stage) {
    const statusClass = stage.status.replace('_', '-');
    const badgeClass  = stage.status.replace('_', '-');

    // ── Extracts section ───────────────────────────────────────────────
    const extractsHtml = stage.extracts?.length
      ? `<div class="dp-section">
           <div class="dp-section-label">Extracted Fields</div>
           <div class="dp-field-list">
             ${stage.extracts.map(f => `
               <span class="dp-field-tag ${f.status}" title="${esc(f.field)}">
                 ${f.status === 'gap' ? '⚠️' : f.status === 'active' ? '✅' : f.status === 'booking' ? '📋' : '⚡'}
                 ${esc(f.label)}
               </span>
             `).join('')}
           </div>
         </div>`
      : '';

    // ── Gaps section ───────────────────────────────────────────────────
    const gapsHtml = stage.gaps?.length
      ? `<div class="dp-section">
           <div class="dp-section-label">⚠️ Known Gaps</div>
           <div class="dp-gap-list">
             ${stage.gaps.map(g => `
               <div class="dp-gap-item">
                 <span class="dp-gap-icon">⚠️</span>
                 <span>${esc(g)}</span>
               </div>
             `).join('')}
           </div>
         </div>`
      : '';

    // ── Meta grid ──────────────────────────────────────────────────────
    const metaRows = [
      stage.engine   ? ['Engine',    stage.engine]   : null,
      stage.provider ? ['Provider',  stage.provider] : null,
      stage.model    ? ['Model',     stage.model]    : null,
      stage.fires    ? ['Fires on',  stage.fires]    : null,
      stage.writesTo ? ['Writes to', stage.writesTo] : null,
    ].filter(Boolean);

    const metaHtml = metaRows.length
      ? `<div class="dp-section">
           <div class="dp-section-label">Configuration</div>
           <div class="dp-meta-grid">
             ${metaRows.map(([k, v]) => `
               <span class="dp-meta-key">${esc(k)}</span>
               <span class="dp-meta-value">${esc(v)}</span>
             `).join('')}
           </div>
         </div>`
      : '';

    // ── Code files ─────────────────────────────────────────────────────
    const filesHtml = stage.wiredIn?.length
      ? `<div class="dp-section">
           <div class="dp-section-label">Code Files</div>
           <div style="display:flex;flex-wrap:wrap;gap:6px;">
             ${stage.wiredIn.map(f => `<span class="dp-code-pill">${esc(f)}</span>`).join('')}
           </div>
         </div>`
      : '';

    // ── Config fields table ────────────────────────────────────────────
    const configFieldsHtml = stage.configFields?.length
      ? `<div class="dp-section">
           <div class="dp-section-label">Config Settings</div>
           <table class="dp-config-table">
             <thead>
               <tr><th>Setting</th><th>Key</th><th>Unit</th><th>Note</th></tr>
             </thead>
             <tbody>
               ${stage.configFields.map(cf => `
                 <tr>
                   <td><strong>${esc(cf.label)}</strong></td>
                   <td><code>${esc(cf.key)}</code></td>
                   <td>${esc(cf.unit)}</td>
                   <td>${esc(cf.note)}</td>
                 </tr>
               `).join('')}
             </tbody>
           </table>
         </div>`
      : '';

    // ── Wire from here button ──────────────────────────────────────────
    const configLinkHtml = stage.configUrl
      ? `<div class="dp-section dp-wire-section">
           <a class="dp-wire-btn" href="/agent-console/${esc(stage.configUrl)}?companyId=${esc(state.companyId)}">
             ⚙️ Wire from here — ${esc(stage.configIn || stage.configUrl)}
             <span class="dp-wire-arrow">→</span>
           </a>
         </div>`
      : '';

    // ── Routing ────────────────────────────────────────────────────────
    const routingTags = [];
    if (stage.routing?.always) routingTags.push(`<span class="dp-route-tag always">→ Always: ${esc(stage.routing.always)}</span>`);
    if (stage.routing?.yes)    routingTags.push(`<span class="dp-route-tag yes">✓ Yes: ${esc(stage.routing.yes)}</span>`);
    if (stage.routing?.no)     routingTags.push(`<span class="dp-route-tag no">✗ No: ${esc(stage.routing.no)}</span>`);

    const routingHtml = routingTags.length
      ? `<div class="dp-section">
           <div class="dp-section-label">Routing</div>
           <div class="dp-routing">${routingTags.join('')}</div>
         </div>`
      : '';

    // ── Dynamic badge ──────────────────────────────────────────────────
    const dynBadge = stage.dynamicBadge
      ? `<span class="dp-badge-count">${esc(stage.dynamicBadge)}</span>`
      : '';

    return `
      <div class="dp-card status-${statusClass}" id="dp-card-${esc(stage.id)}" data-stage-id="${esc(stage.id)}">
        <!-- Card Header (click to expand) -->
        <div class="dp-card-header" onclick="DiscoveryPage.toggleCard('${esc(stage.id)}')">
          <div class="dp-card-order">${stage.order}</div>
          <div class="dp-card-icon">${stage.icon}</div>
          <div class="dp-card-title-group">
            <div class="dp-card-name">${esc(stage.name)}</div>
            <div class="dp-card-subtitle">${esc(stage.subtitle)}</div>
          </div>
          <div class="dp-card-right">
            ${dynBadge}
            <span class="dp-status-badge ${badgeClass}">${statusLabel(stage.status)}</span>
            <button class="dp-expand-btn" aria-label="Expand" id="dp-expand-${esc(stage.id)}">▾</button>
          </div>
        </div>

        <!-- Card Body (collapsible) -->
        <div class="dp-card-body" id="dp-body-${esc(stage.id)}">

          <!-- WHY THIS MATTERS -->
          ${stage.why ? `
            <div class="dp-section">
              <div class="dp-section-label">Why This Matters</div>
              <div class="dp-why-box">${esc(stage.why)}</div>
            </div>
          ` : ''}

          ${extractsHtml}
          ${gapsHtml}
          ${metaHtml}
          ${filesHtml}
          ${configLinkHtml}
          ${routingHtml}

        </div>
      </div>
    `;
  }

  /** Render a connector between two pipeline cards. */
  function renderConnector(fromStage, toStage) {
    const hasBranch = fromStage.routing?.yes && fromStage.routing?.no;

    if (hasBranch) {
      return `
        <div class="dp-connector">
          <div class="dp-connector-line"></div>
          <div class="dp-branch">
            <div class="dp-branch-arm yes">
              <div class="dp-branch-label">YES →</div>
              <div class="dp-branch-line"></div>
              <div class="dp-branch-target">${esc(fromStage.routing.yes)}</div>
            </div>
            <div class="dp-branch-arm no">
              <div class="dp-branch-label">NO →</div>
              <div class="dp-branch-line"></div>
              <div class="dp-branch-target">${esc(fromStage.routing.no)}</div>
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="dp-connector">
        <div class="dp-connector-line"></div>
      </div>
    `;
  }

  /** Render the full pipeline (all cards + connectors + group headers). */
  function renderPipeline(stages) {
    let html = '';
    let lastGroup = null;

    stages.forEach((stage, idx) => {
      // ── Group header when group changes ─────────────────────────────
      if (stage.group && stage.group !== lastGroup) {
        if (lastGroup !== null) {
          html += '<div class="dp-group-gap"></div>';
        }
        html += `<div class="dp-group-header">${esc(stage.group)}</div>`;
        lastGroup = stage.group;
      }

      html += renderPipelineCard(stage);

      if (idx < stages.length - 1) {
        html += renderConnector(stage, stages[idx + 1]);
      }
    });

    DOM.pipelineContainer.innerHTML = html;
  }

  /* =========================================================================
     MODULE: RENDERER — DISCOVERY NOTES PANEL
     ─────────────────────────────────────────────────────────────────────────
     Renders the compact sidebar panel AND the full modal.
     Uses DISCOVERY_NOTES_SCHEMA merged with API gap annotations.
     ========================================================================= */

  function renderNotesPanel(schemaFields) {
    // Compact view: show fields with status badges
    DOM.notesFields.innerHTML = schemaFields.map(f => `
      <div class="dp-notes-field">
        <span class="dp-notes-field-key">${esc(f.key)}</span>
        <span class="dp-notes-field-badge ${f.status}">${esc(f.status.toUpperCase())}</span>
        <span class="dp-notes-field-source">${esc(f.label)}</span>
      </div>
    `).join('');
  }

  function renderNotesModal(schemaFields, apiGaps) {
    // Full table with source info
    DOM.modalNotesFields.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead>
          <tr style="background:#f8fafc; text-align:left;">
            <th style="padding:8px 12px; border-bottom:1px solid #e2e8f0; font-weight:700; color:#374151;">Field</th>
            <th style="padding:8px 12px; border-bottom:1px solid #e2e8f0; font-weight:700; color:#374151;">Label</th>
            <th style="padding:8px 12px; border-bottom:1px solid #e2e8f0; font-weight:700; color:#374151;">Status</th>
            <th style="padding:8px 12px; border-bottom:1px solid #e2e8f0; font-weight:700; color:#374151;">Source</th>
          </tr>
        </thead>
        <tbody>
          ${schemaFields.map(f => `
            <tr style="border-bottom:1px solid #f3f4f6;">
              <td style="padding:8px 12px; font-family:'SF Mono',monospace;">${esc(f.key)}</td>
              <td style="padding:8px 12px;">${esc(f.label)}</td>
              <td style="padding:8px 12px;">
                <span class="dp-notes-field-badge ${f.status}">${esc(f.status.toUpperCase())}</span>
              </td>
              <td style="padding:8px 12px; color:#6b7280;">${esc(f.source)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Gaps
    const gaps = apiGaps?.length ? apiGaps : [];
    DOM.modalNotesGaps.innerHTML = gaps.length
      ? `<div class="dp-section-label">⚠️ Extraction Gaps</div>
         <div class="dp-gap-list">
           ${gaps.map(g => `<div class="dp-gap-item"><span class="dp-gap-icon">⚠️</span><span>${esc(g)}</span></div>`).join('')}
         </div>`
      : '';
  }

  /* =========================================================================
     MODULE: CALL TRACE ANALYZER
     ─────────────────────────────────────────────────────────────────────────
     Parses a pasted call intelligence JSON and maps it to the pipeline.
     Shows which stages fired, which were skipped, and what gaps were hit.
     No network call needed — fully client-side.
     ========================================================================= */

  const TRACE_ANALYZER = {

    /** Map a call intelligence JSON to the pipeline stages. */
    analyze(json) {
      let data;
      try {
        data = typeof json === 'string' ? JSON.parse(json) : json;
      } catch (_e) {
        return { error: 'Invalid JSON. Please paste a valid call intelligence JSON.' };
      }

      const intel   = data.intelligence || data;
      const turns   = intel.callContext?.turnByTurnFlow || [];
      const results = [];

      turns.forEach((turn, idx) => {
        if (turn.traceOnly) return;

        const turnResult = {
          turnNumber:  turn.turnNumber || idx + 1,
          callerInput: turn.callerInput?.raw || '(empty)',
          agentResponse: turn.agentResponse?.text || '',
          path:        turn.pathSelected?.path || turn.routingTier?.lastPath || '',
          stages:      [],
          score:       { pass: [], fail: [] },
        };

        const input         = turnResult.callerInput.toLowerCase();
        const intakeData    = turn.intakeExtraction || intel.callContext?.response?.intakeExtraction;
        const usedName      = turn.agentResponse?.usedCallerName || intel.callContext?.response?.usedCallerName;
        const extractedName = intakeData?.entities?.firstName;
        const callReason    = intakeData?.callReason;
        const priorVisit    = intakeData?.priorVisit;
        const employeeMentioned = intakeData?.employeeMentioned;

        // [1] Entity Extractor
        const entityStage = {
          stageId: 'entity_extractor',
          icon: '🧠', name: 'Entity Extractor',
          status: intakeData ? 'fired' : 'skipped',
          details: [],
        };
        if (intakeData) {
          if (extractedName) entityStage.details.push(`✅ firstName: "${extractedName}"`);
          if (callReason)    entityStage.details.push(`✅ callReason: "${callReason}"`);
          if (priorVisit)    entityStage.details.push(`✅ priorVisit: true`);
          if (intakeData.urgency) entityStage.details.push(`✅ urgency: ${intakeData.urgency}`);

          // Check for employee mention gap
          const inputText = turnResult.callerInput;
          const employeeHintPattern = /hi\s+([A-Z][a-z]+)|hello\s+([A-Z][a-z]+)/i;
          const match = inputText.match(employeeHintPattern);
          if (match && !employeeMentioned) {
            const name = match[1] || match[2];
            entityStage.details.push(`⚠️ GAP: caller said "Hi ${name}" — employeeMentioned not extracted (field is null)`);
            turnResult.score.fail.push(`employeeMentioned not extracted — caller said "Hi ${name}"`);
          }
        }
        turnResult.stages.push(entityStage);

        // [2] Question Detector
        const kcSignals = ['how much', 'do you accept', 'what is', 'do you offer', 'how long',
                           'what does', 'credit card', 'warranty', 'guarantee', 'price',
                           'cost', 'charge', 'fee', 'special', 'discount', 'include'];
        const hasQuestion = kcSignals.some(sig => input.includes(sig));
        const questionStage = {
          stageId: 'question_detector',
          icon: '❓', name: 'Question Detector',
          status: hasQuestion ? 'gap' : 'skipped',
          details: [],
        };
        if (hasQuestion) {
          const matched = kcSignals.filter(sig => input.includes(sig));
          questionStage.details.push(`⚠️ NOT BUILT — KC signal(s) detected: "${matched.join('", "')}" but not routed to KC Answer`);
          turnResult.score.fail.push(`Question not answered: "${matched.join(', ')}" detected but Question Detector not built`);
        } else {
          questionStage.details.push('No KC signals detected in this utterance');
        }
        turnResult.stages.push(questionStage);

        // [3] Booking Intent Gate
        const bookingPath = turnResult.path.includes('BOOKING') || turnResult.path.includes('INTAKE');
        const pfuqSet = !!turn.pfuqState?.question;
        const bookingStage = {
          stageId: 'booking_intent',
          icon: '🔒', name: 'Booking Intent Gate',
          status: pfuqSet ? 'fired' : 'skipped',
          details: pfuqSet ? [`PFUQ set: "${turn.pfuqState.question}"`] : ['No booking intent detected'],
        };
        turnResult.stages.push(bookingStage);

        // [4] KC Answer
        const kcPath = turnResult.path.includes('KC_DIRECT') || turnResult.path.includes('KC_SPFUQ') || turnResult.path.includes('KC_TOPIC');
        const kcStage = {
          stageId: 'kc_answer',
          icon: '📦', name: 'KC Answer',
          status: kcPath ? 'fired' : 'skipped',
          details: kcPath ? ['KC container matched, Groq answered'] : ['No KC match on this turn'],
        };
        turnResult.stages.push(kcStage);

        // [5] Groq Response Formatter
        const formatterStage = {
          stageId: 'groq_formatter',
          icon: '🤖', name: 'Groq Response Formatter',
          status: turnResult.agentResponse ? 'fired' : 'skipped',
          details: [],
        };
        if (usedName && extractedName) {
          formatterStage.details.push(`✅ Used caller name: "${extractedName}"`);
          turnResult.score.pass.push('Used caller name');
        } else if (extractedName && !usedName) {
          formatterStage.details.push(`⚠️ Name extracted but not used in response`);
        }
        if (callReason) {
          const responseText = turnResult.agentResponse.toLowerCase();
          const ackKeywords = ['sorry', 'understand', 'hear', 'see', 'note'];
          if (ackKeywords.some(w => responseText.includes(w))) {
            formatterStage.details.push(`✅ Problem acknowledged in response`);
            turnResult.score.pass.push('Acknowledged problem');
          }
        }
        if (priorVisit) {
          const responseText = turnResult.agentResponse.toLowerCase();
          if (responseText.includes('before') || responseText.includes('worked') || responseText.includes('again')) {
            formatterStage.details.push(`✅ Prior visit acknowledged`);
            turnResult.score.pass.push('Acknowledged prior visit');
          }
        }
        if (hasQuestion && !kcPath) {
          formatterStage.details.push(`❌ Question was not answered — Question Detector not built`);
          turnResult.score.fail.push('Question not answered (Question Detector not built)');
        }
        turnResult.stages.push(formatterStage);

        results.push(turnResult);
      });

      return { turns: results, meta: { callSid: intel.callSid, totalTurns: intel.callMetadata?.turns } };
    },

    /** Render the trace analysis output. */
    render(analysis) {
      if (analysis.error) {
        DOM.traceOutput.innerHTML = `
          <div class="dp-gap-item" style="margin-top:12px;">
            <span class="dp-gap-icon">⚠️</span>
            <span>${esc(analysis.error)}</span>
          </div>
        `;
        return;
      }

      if (!analysis.turns?.length) {
        DOM.traceOutput.innerHTML = `
          <div class="dp-empty" style="padding:20px 0;">
            <div>No turns found in this call intelligence JSON.</div>
          </div>
        `;
        return;
      }

      DOM.traceOutput.innerHTML = analysis.turns.map(turn => `
        <div class="dp-trace-turn">
          <div class="dp-trace-turn-header">
            <span>Turn ${turn.turnNumber}</span>
            <span style="color:#6b7280; font-weight:400; font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-left:8px;">
              "${esc(turn.callerInput?.slice(0, 80))}${turn.callerInput?.length > 80 ? '…' : ''}"
            </span>
          </div>
          <div class="dp-trace-turn-body">

            <!-- Stage-by-stage breakdown -->
            ${turn.stages.map(s => `
              <div class="dp-trace-stage">
                <span class="dp-trace-stage-icon">${s.icon}</span>
                <div style="flex:1; min-width:0;">
                  <div class="dp-trace-stage-name">${esc(s.name)}</div>
                  ${s.details.map(d => `<div class="dp-trace-stage-detail">${esc(d)}</div>`).join('')}
                </div>
                <span class="dp-trace-stage-status ${s.status}">
                  ${s.status === 'fired' ? 'FIRED' : s.status === 'gap' ? 'GAP' : s.status === 'missed' ? 'MISSED' : 'SKIPPED'}
                </span>
              </div>
            `).join('')}

            <!-- Agent response preview -->
            ${turn.agentResponse ? `
              <div class="dp-trace-response">
                <strong>Agent:</strong> "${esc(turn.agentResponse)}"
              </div>
            ` : ''}

            <!-- Score -->
            ${(turn.score.pass.length + turn.score.fail.length) > 0 ? `
              <div class="dp-trace-score">
                <div class="dp-trace-score-title">
                  Response Quality: ${turn.score.pass.length}/${turn.score.pass.length + turn.score.fail.length} checks passed
                </div>
                ${turn.score.pass.map(p => `<div class="dp-trace-score-item pass">✅ ${esc(p)}</div>`).join('')}
                ${turn.score.fail.map(f => `<div class="dp-trace-score-item fail">❌ ${esc(f)}</div>`).join('')}
              </div>
            ` : ''}

          </div>
        </div>
      `).join('');
    },
  };

  /* =========================================================================
     MODULE: MODAL MANAGER
     ========================================================================= */

  const MODAL = {
    open(modalEl) {
      if (!modalEl) return;
      modalEl.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    },
    close(modalEl) {
      if (!modalEl) return;
      modalEl.style.display = 'none';
      document.body.style.overflow = '';
    },
  };

  /* =========================================================================
     MODULE: LOAD + RENDER
     ─────────────────────────────────────────────────────────────────────────
     TWO-PHASE RENDER — same principle as the first-sentence fast path:

     PHASE 1 — instant (~0ms):
       Render full pipeline from static PIPELINE_STAGES data immediately.
       No API call needed. User sees the complete pipeline on first paint.
       Stats bar shows static wired/partial/not_built counts.
       discoveryNotes panel renders from static schema.

     PHASE 2 — after API (~200-400ms):
       Overlay dynamic per-company data:
         • KC container count (warns if 0)
         • Trigger count
         • Speech detection live config values
         • discoveryNotes field statuses from MongoDB
       Re-renders only what changed.
     ========================================================================= */

  async function loadAndRender() {
    // ── PHASE 1: instant static render ────────────────────────────────────
    state.stages = PIPELINE_STAGES.slice();
    renderStatsBar(state.stages, null);
    renderPipeline(state.stages);
    renderNotesPanel(DISCOVERY_NOTES_SCHEMA);

    // ── PHASE 2: overlay dynamic API data ─────────────────────────────────
    try {
      const data = await API.getPipelineStatus(state.companyId);
      state.pipelineData = data;

      // Update header with real company name
      state.companyName = data.companyName || state.companyId;
      DOM.headerCompanyName.textContent = state.companyName;

      // Mark last refresh time + show live badge
      state.lastRefreshed = Date.now();
      updateLiveIndicator();

      // Re-render with enriched stage data (KC count gaps, bridge config, etc.)
      state.stages = enrichStages(data);
      renderStatsBar(state.stages, data);
      renderPipeline(state.stages);

      // Merge schema with live API gap data
      const apiFields = data.discoveryNotes?.fields || [];
      const schema = DISCOVERY_NOTES_SCHEMA.map(field => {
        const apiField = apiFields.find(f => f.key === field.key);
        return apiField ? { ...field, status: apiField.status, source: apiField.source } : field;
      });
      renderNotesPanel(schema);
      renderNotesModal(schema, data.discoveryNotes?.gaps || []);

    } catch (err) {
      console.error('[Discovery] API overlay failed:', err);
      // Pipeline already visible from Phase 1 — show a soft inline warning only
      const warn = document.createElement('div');
      warn.className = 'dp-gap-item';
      warn.style.margin = '0 0 12px 0';
      warn.innerHTML = '<span class="dp-gap-icon">⚠️</span><span>Live config unavailable — showing static definitions. Check login or companyId.</span>';
      DOM.statsBar.insertAdjacentElement('afterend', warn);
    }
  }

  /* =========================================================================
     MODULE: PUBLIC API
     ─────────────────────────────────────────────────────────────────────────
     Methods exposed on window.DiscoveryPage for onclick handlers in HTML.
     Kept minimal — only what the HTML templates need.
     ========================================================================= */

  window.DiscoveryPage = {
    /** Toggle expand/collapse for a pipeline card. */
    toggleCard(stageId) {
      const body   = document.getElementById(`dp-body-${stageId}`);
      const btn    = document.getElementById(`dp-expand-${stageId}`);
      if (!body) return;
      const isOpen = body.classList.contains('open');
      body.classList.toggle('open', !isOpen);
      if (btn) btn.textContent = isOpen ? '▾' : '▴';
    },
  };

  /* =========================================================================
     MODULE: INIT
     ─────────────────────────────────────────────────────────────────────────
     Entry point. Reads companyId from URL, wires all events, loads data.
     ========================================================================= */

  function init() {
    state.companyId = getCompanyIdFromUrl();

    if (!state.companyId) {
      DOM.pipelineContainer.innerHTML = `
        <div class="dp-empty">
          <div class="dp-empty-icon">🔍</div>
          <div>No companyId in URL. Add <strong>?companyId=YOUR_ID</strong> to load a company's pipeline.</div>
        </div>
      `;
      DOM.statsBar.innerHTML = '';
      return;
    }

    // ── Header back link ──────────────────────────────────────────────
    DOM.headerBackLink.href = `/agent-console/agent2.html?companyId=${encodeURIComponent(state.companyId)}`;
    DOM.headerCompanyId.textContent = `${state.companyId.slice(0, 8)}…${state.companyId.slice(-4)}`;

    // ── Refresh button ────────────────────────────────────────────────
    DOM.btnRefresh?.addEventListener('click', () => loadAndRender());

    // ── discoveryNotes modal ──────────────────────────────────────────
    DOM.btnNotesDetail?.addEventListener('click', () => MODAL.open(DOM.modalNotes));
    DOM.btnNotesModalClose?.addEventListener('click', () => MODAL.close(DOM.modalNotes));
    DOM.modalNotes?.addEventListener('click', e => {
      if (e.target === DOM.modalNotes) MODAL.close(DOM.modalNotes);
    });

    // ── Call Trace Analyzer ───────────────────────────────────────────
    DOM.btnAnalyze?.addEventListener('click', () => {
      const raw = DOM.traceInput?.value?.trim();
      if (!raw) return;
      const analysis = TRACE_ANALYZER.analyze(raw);
      state.lastAnalysis = analysis;
      TRACE_ANALYZER.render(analysis);
    });

    // ── Download buttons ──────────────────────────────────────────────
    DOM.btnDownloadJson?.addEventListener('click', () => DOWNLOADER.json());
    DOM.btnDownloadPdf?.addEventListener('click',  () => DOWNLOADER.pdf());

    // ── ESC to close modals ───────────────────────────────────────────
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        MODAL.close(DOM.modalNotes);
      }
    });

    // ── Load pipeline data ────────────────────────────────────────────
    loadAndRender();

    // ── Auto-refresh every 30 s (Phase 2 only — preserves open cards) ─
    state.autoRefreshTimer = setInterval(refreshPhase2Only, AUTO_REFRESH_MS);

    // ── Tick the live badge ("Updated Xs ago") every 5 s ─────────────
    state.tickTimer = setInterval(updateLiveIndicator, 5_000);
  }

  document.addEventListener('DOMContentLoaded', init);

})();
