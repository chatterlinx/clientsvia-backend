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
       'bypassed'  — code exists but intentionally skipped at runtime (superseded by LLM)
       'not_built' — architecture defined, code not written yet
       'planned'   — on roadmap, not yet designed

     ROUTING:
       always   → this stage always passes control to the named next stage
       yes      → when the stage's condition is TRUE, routes here
       no       → when the stage's condition is FALSE, routes here
     ========================================================================= */

  const PIPELINE_STAGES = [

    // ════════════════════════════════════════════════════════════════════════
    // GROUP A — CALL ENTRY
    // ════════════════════════════════════════════════════════════════════════

    // ── [1] Twilio — Inbound Call ────────────────────────────────────────
    {
      id:       'twilio_inbound',
      order:    1,
      icon:     '📞',
      name:     'Twilio — Inbound Call',
      subtitle: 'PSTN call arrives at Twilio — CallSid, From, To captured — webhook fires to v2twilio.js',
      status:   'wired',
      group:    'Call Entry',

      why: 'Every call starts here. Twilio receives the PSTN call and fires an HTTP POST to the platform\'s webhook endpoint (/v2-agent). The CallSid, caller\'s number (From), and destination number (To) are all captured here and flow as context through every downstream stage. This is the network entry point — nothing runs before this.',

      engine:   'Twilio PSTN → webhook POST',
      provider: 'Twilio',
      model:    null,
      fires:    'Every inbound call.',
      writesTo: 'req.body.CallSid, req.body.From, req.body.To → all downstream stages',
      wiredIn:  ['routes/v2twilio.js — /v2-agent (inbound webhook handler)'],
      configIn:  'Twilio Console — webhook URL',
      configUrl: null,

      extracts: [],
      gaps:     [],

      routing: { always: 'config_gate' },
    },

    // ── [2] Configuration Gate — Account Gatekeeper ─────────────────────
    {
      id:       'config_gate',
      order:    2,
      icon:     '🔑',
      name:     'Configuration Gate — Account Gatekeeper',
      subtitle: 'Blocks calls if account is closed or suspended — no audio, no AI costs, call ends immediately',
      status:   'wired',
      group:    'Call Entry',

      why: 'Before playing any audio or running any AI, the platform confirms the company account is active and has a valid Agent 2.0 configuration. If the account is closed, suspended, or missing config, the call is rejected here — zero ElevenLabs cost, zero Groq cost, zero Twilio TTS charge. This is the financial and operational safety gate that prevents runaway charges on inactive or misconfigured accounts.',

      engine:   'Company config load — account status check',
      provider: 'MongoDB (no AI)',
      model:    null,
      fires:    'Every inbound call, before any audio plays.',
      writesTo: 'agent2Config → loaded into memory for all downstream stages',
      wiredIn:  ['routes/v2twilio.js — company config load + active status check'],
      configIn:  'Account Status — Admin Panel',
      configUrl: null,

      extracts: [],
      gaps:     [],

      routing: { yes: 'spam_filter', no: 'REJECT — call ends, no audio' },
    },

    // ── [3] Spam / Caller ID Filter ──────────────────────────────────────
    {
      id:       'spam_filter',
      order:    3,
      icon:     '🚫',
      name:     'Spam / Caller ID Filter',
      subtitle: 'Blocked number list checked before greeting plays — per-company, per-tenant',
      status:   'wired',
      group:    'Call Entry',

      why: 'Known spam callers, robocallers, and manually blocked numbers are checked before any greeting plays. If the caller\'s phone number matches the block list, the call is silently rejected. This prevents AI costs on unwanted calls and protects against toll fraud. The block list is per-company — each tenant manages their own blocked numbers independently without affecting other tenants.',

      engine:   'Blocked number lookup',
      provider: 'MongoDB (no AI)',
      model:    null,
      fires:    'Every inbound call that passes the Config Gate.',
      writesTo: null,
      wiredIn:  ['routes/v2twilio.js — blocked caller ID check'],
      configIn:  'Blocked Numbers — Agent 2.0 Settings',
      configUrl: 'agent2.html',

      extracts: [],
      gaps:     [],

      routing: { yes: 'greeting', no: 'BLOCK — call rejected' },
    },

    // ── [4] Greeting — Opening Message ──────────────────────────────────
    {
      id:       'greeting',
      order:    4,
      icon:     '👋',
      name:     'Greeting — Opening Message',
      subtitle: 'Pre-cached greeting MP3 plays instantly via InstantAudioService — no TTS round-trip',
      status:   'wired',
      group:    'Call Entry',

      why: 'The greeting is the caller\'s first impression. It plays as a pre-cached MP3 built by InstantAudioService at config-save time — near-instant playback, no ElevenLabs round-trip on first audio. After the greeting plays, Twilio opens the first <Gather> to capture the caller\'s response. The greeting text, voice, and style are fully configured in Agent 2.0 Settings and apply per-company.',

      engine:   'InstantAudioService — pre-cached MP3 → Twilio <Play>',
      provider: 'ElevenLabs (pre-generated at config save time, not at call time)',
      model:    'Configured per company (voiceSettings)',
      fires:    'Once per call, immediately after spam filter passes.',
      writesTo: 'Twilio <Play> → caller hears greeting → <Gather> opens for Turn 1',
      wiredIn:  ['routes/v2twilio.js — /v2-agent greeting handler', 'services/instantAudio/InstantAudioService.js'],
      configIn:  'Greeting — Agent 2.0 Settings',
      configUrl: 'agent2.html',

      configFields: [
        { key: 'greetingText', label: 'Greeting Text', unit: 'string', note: 'What the agent says when a call connects. Pre-cached as MP3 at save time — change it and save to regenerate.' },
      ],

      extracts: [],
      gaps:     [],

      routing: { always: 'stt_gather' },
    },

    // ════════════════════════════════════════════════════════════════════════
    // GROUP B — CALL RECEIPT (STT + TRANSCRIPT)
    // ════════════════════════════════════════════════════════════════════════

    // ── [5] STT — Deepgram via Twilio Gather ─────────────────────────────
    {
      id:       'stt_gather',
      order:    5,
      icon:     '🎙️',
      name:     'STT — Deepgram via Twilio Gather',
      subtitle: 'speechTimeout (default 1.5s) is the #1 latency driver — dominates every other stage combined. Twilio waits this long after caller stops talking before anything starts.',
      status:   'wired',
      group:    'Call Receipt',

      why: 'After each agent response, Twilio opens a <Gather> with Deepgram speech recognition. ' +
           'CRITICAL LATENCY FACT: speechTimeout = 1.5s (default) is the DOMINANT contributor to caller-perceived delay. ' +
           'The full path after the caller stops talking: 1,500ms silence wait → webhook fires → 30ms extraction → 150ms Groq TTFT → 150ms ElevenLabs → caller hears audio. ' +
           'That 1,500ms is 4× bigger than all AI processing combined. Lowering it to 1.0s saves 500ms instantly — no code changes needed, just a slider. ' +
           'The trade-off: too low (< 0.8s) cuts off callers who pause mid-sentence ("My AC is… broken"). ' +
           'Additional settings that affect latency: barge-in off = caller must wait for all agent audio to finish before speaking (adds full response duration to perceived wait). ' +
           'Deepgram phone_call model is optimized for PSTN telephony and outperforms generic STT on accents and background noise.',

      engine:   'Twilio <Gather> with Deepgram speech recognition',
      provider: 'Deepgram (via Twilio speech recognition integration)',
      model:    'Configurable via speechModel setting (phone_call recommended)',
      fires:    'Every turn — after greeting, after every agent response.',
      writesTo: 'req.body.SpeechResult → Turn 1 entity extraction (Stage 7) → downstream stages',
      wiredIn:  ['routes/v2twilio.js — /v2-agent (greeting gather)', 'routes/v2twilio.js — /v2-agent-sentence-continue (post-response gather)'],
      configIn:  'Speech Detection — Agent 2.0 Settings',
      configUrl: 'agent2.html',

      extracts: [],

      configFields: [
        { key: 'speechTimeout',       label: '⚡ Speech Timeout (END-OF-SPEECH WAIT)', unit: 's',   note: '⚠️ DOMINANT LATENCY FACTOR. Time Twilio waits after caller stops talking before firing transcript. Default: 1.5s. Lowering to 1.0s saves 500ms on every single turn. Schema range: 1s–10s minimum. Too low risks cutting mid-sentence pauses.' },
        { key: 'initialTimeout',      label: 'Initial Timeout',       unit: 's',   note: 'How long Twilio waits for the caller to START speaking before giving up. Default: 7s. Unrelated to response latency.' },
        { key: 'bargeIn',             label: 'Barge-in',              unit: 'bool',note: 'Allow caller to interrupt agent mid-response. When false, caller must wait for all agent audio to finish — adds full response duration to wait time.' },
        { key: 'enhancedRecognition', label: 'Enhanced Recognition',  unit: 'bool',note: 'Twilio\'s enhanced speech model (Google under the hood — NOT Deepgram). Adds ~100ms latency per turn. Deepgram is a separate low-confidence FALLBACK (fires post-hoc on ~10% of calls). Test with enhanced OFF — if transcripts stay clean, save 100ms.' },
        { key: 'speechModel',         label: 'Speech Model',          unit: 'enum',note: 'phone_call = best for telephony via Deepgram; default = general purpose. phone_call recommended for all live calls.' },
      ],

      // ── Twilio <Gather> wire map — every attribute sent at call time ────
      // source: 'wired' = per-company, UI-configurable
      //         'stt_builder' = computed by STTHintsBuilder from company keywords
      //         'runtime' = computed per-request (URL, companyId etc)
      //         'hardcoded' = fixed in v2twilio.js, never changes
      gatherParams: [
        { param: 'speechTimeout',               source: 'wired',       liveKey: 'speechTimeout',       unit: 's',    note: '⚡ END-OF-SPEECH SILENCE WAIT — dominant latency factor. Counts silence after caller stops talking. Nothing starts until this fires.' },
        { param: 'timeout (initial)',            source: 'wired',       liveKey: 'initialTimeout',       unit: 's',    note: 'Max wait for caller to BEGIN speaking. No latency impact once caller starts.' },
        { param: 'bargeIn',                      source: 'wired',       liveKey: 'bargeIn',              unit: 'bool', note: 'Caller can interrupt agent mid-response. OFF = caller must wait for full audio playback before speaking.' },
        { param: 'speechModel',                  source: 'wired',       liveKey: 'speechModel',          unit: 'enum', note: 'STT provider & model. nova-2-phonecall / auto = Deepgram. phone_call / default = Google.' },
        { param: 'enhanced',                     source: 'wired',       liveKey: 'enhancedRecognition',  unit: 'bool', note: 'Twilio Google enhanced model (~100ms cost). Auto-disabled when Deepgram (nova-2-phonecall/auto) is active — the two providers conflict.' },
        { param: 'hints',                        source: 'stt_builder', liveKey: 'keywords',             unit: 'str',  note: 'STT vocabulary hints sent to Twilio. Built by STTHintsBuilder from company keywords. Deepgram: "phrase:boost" weighted format. Google: flat CSV.' },
        { param: 'action',                       source: 'runtime',     value: '/api/twilio/v2-agent-respond/:companyId', note: 'Webhook URL Twilio POSTs the transcript to. Computed per request.' },
        { param: 'partialResultCallback',        source: 'runtime',     value: '/api/twilio/v2-agent-partial/:companyId', note: 'URL for partial (streaming) transcript tokens — powers real-time partial display in Call Review.' },
        { param: 'input',                        source: 'hardcoded',   value: 'speech',    note: 'Always speech for voice calls.' },
        { param: 'method',                       source: 'hardcoded',   value: 'POST',      note: '' },
        { param: 'partialResultCallbackMethod',  source: 'hardcoded',   value: 'POST',      note: '' },
        { param: 'actionOnEmptyResult',          source: 'hardcoded',   value: 'true',      note: 'CRITICAL — fires webhook even if no speech detected. Without this, silence = no POST = Twilio hangs the call.' },
      ],

      gaps: [
        '⚡ MS-CRITICAL — speechTimeout 1.5s adds 1,500ms to EVERY turn. This single number dominates all other pipeline latency combined. Evaluate lowering to 1.0s for 500ms improvement per turn.',
        'barge-in is off by default — caller cannot interrupt agent audio. When response is long (3+ sentences), caller waits the full playback duration before speaking. Consider enabling barge-in for Turn 2+ conversational turns.',
        'No per-turn dynamic timeout: pending follow-up questions extend to 2s automatically, but there is no mechanism to shorten timeout for simple yes/no follow-ups where 0.8s would be safe.',
      ],

      routing: { always: 'llm_intake', note: 'ScrabEngine (6) is bypassed — STT routes direct to LLM' },
    },

    // ── [6] End-of-Speech Detection ──────────────────────────────────────
    {
      id:       'stt_eosdetection',
      order:    6,
      icon:     '⏳',
      name:     'End-of-Speech Detection',
      subtitle: '⚡ DOMINANT LATENCY DRIVER — Twilio waits speechTimeout seconds of silence after caller stops talking. Nothing runs until this countdown completes.',
      status:   'wired',
      group:    'Call Receipt',

      why: 'This is the single highest-impact latency lever in the pipeline. After the caller stops talking, Twilio counts silence. Only after speechTimeout seconds of unbroken silence does it fire the webhook — and only then does STT, entity extraction, Groq, and ElevenLabs start. ' +
           'At the default 1.5s, this adds 1,500ms to EVERY turn. That is 4× larger than all AI processing combined. ' +
           'Lowering speechTimeout to 1.0s is a zero-code, zero-risk 500ms improvement per turn — just a slider. ' +
           'The floor is 1.0s (schema minimum). Below that, callers who pause mid-sentence ("My AC is… not working") get cut off. ' +
           'barge-in OFF compounds this: caller must also wait for all agent audio to finish before the gather even opens — adding the full response playback duration on top.',

      engine:   'Twilio <Gather> — built-in VAD (Voice Activity Detection)',
      provider: 'Twilio (no AI — pure silence measurement)',
      model:    null,
      fires:    'Every turn. Countdown starts the instant caller stops speaking.',
      writesTo: null,
      wiredIn:  ['routes/v2twilio.js — Gather construction (speechTimeout attribute)', 'models/v2Company.js — agent2.speechDetection schema'],
      configIn:  'Speech Detection — Agent 2.0 Settings',
      configUrl: 'agent2.html',

      liveValues: [],   // ← populated dynamically by enrichStages() from API data

      extracts: [],
      gaps:     [],

      routing: { always: 'llm_intake', note: 'Countdown ends → Twilio POSTs transcript to server → agent processing begins' },
    },

    // ── [7] ScrabEngine — Transcript Cleaning (BYPASSED) ─────────────────
    {
      id:       'scrabengine',
      order:    7,
      icon:     '⏭️',
      name:     'ScrabEngine — Transcript Cleaning',
      subtitle: 'Bypassed — Groq handles filler removal and vocabulary expansion natively as part of LLM processing',
      status:   'bypassed',
      group:    'Call Receipt',

      why: 'ScrabEngine was originally built to strip filler words ("um", "uh", "like"), expand vocabulary tokens ("AC" → "air conditioner"), and apply synonym maps before the LLM saw the transcript. This preprocessing improved KC keyword matching. However, Groq handles all of this natively — it ignores filler words and understands vocabulary variants without any preprocessing. The synchronous string-pass step adds latency with no meaningful improvement over what Groq does out-of-the-box, so it is skipped at runtime. Code is preserved in case re-evaluation is needed.',

      engine:   'ScrabEngineService V125',
      provider: 'Synchronous (no AI) — pure string processing',
      model:    null,
      fires:    '⚠️ NOT CALLED — STT routes directly to LLM_INTAKE, bypassing this stage.',
      writesTo: 'n/a — bypassed, no cleanedTranscript produced',
      wiredIn:  ['services/scrabEngine/ScrabEngineService.js'],
      configIn:  'ScrabEngine',
      configUrl: 'scrabengine.html',

      extracts: [],
      gaps: [
        'Evaluate whether ScrabEngine KC synonym maps still provide value that Groq misses. If synonym matching improves KC container scoring beyond what Groq intent-parsing does natively, a selective re-wire may be worthwhile.',
        'Consider removing ScrabEngineService.js and scrabengine.html if the bypass is confirmed permanent — see Dead Code Cleanup plan.',
      ],

      routing: { always: 'llm_intake' },
    },

    // ════════════════════════════════════════════════════════════════════════
    // GROUP C — TURN 1: LLM INTAKE
    // ════════════════════════════════════════════════════════════════════════

    // ── [7] Turn 1 — Entity Extraction (Groq 8b) ─────────────────────────
    {
      id:       'llm_intake',
      order:    8,
      icon:     '🔬',
      name:     'Turn 1 — Entity Extraction',
      subtitle: 'llama-3.1-8b-instant extracts caller entities as JSON in ~30ms: name, call reason, urgency, prior visit',
      status:   'wired',
      group:    'Turn 1 — LLM Intake',

      why: 'Split-Call Phase 1. The 8b model is given a single task: extract structured data from the caller\'s first utterance. It returns pure JSON — no response text. By separating extraction from response generation, each model does exactly what it\'s optimised for. The 8b model is ~10× faster than 70b for this structured task (~30ms), and JSON mode is reliable at this model size. Extracted entities flow directly into Phase 2\'s system prompt so the 70b model can greet the caller by name and acknowledge their specific problem.',

      engine:   'Agent2DiscoveryRunner — _extractIntakeEntities() → callLLMAgentForIntake() Split Phase 1',
      provider: 'Groq',
      model:    'llama-3.1-8b-instant',
      fires:    'Turn 1 only. Blocking (~30ms). Runs BEFORE response generation. Falls through to single-call path on error.',
      writesTo: 'entityResult → injected into Phase 2 system prompt + early discoveryNotes.update() fire-and-forget',
      wiredIn:  [
        'services/engine/agent2/Agent2DiscoveryRunner.js — _extractIntakeEntities()',
        'config/llmAgentDefaults.js — composeIntakeExtractionPrompt()',
        'services/streaming/adapters/GroqStreamAdapter.js — streamFull()',
      ],
      configIn:  'LLM Agent Settings — Intake > Split Calls',
      configUrl: 'llmagent.html',

      extracts: [
        { field: 'entities.firstName',  label: 'First Name',        status: 'active'  },
        { field: 'entities.lastName',   label: 'Last Name',         status: 'partial' },
        { field: 'callReason',          label: 'Call Reason',       status: 'active'  },
        { field: 'urgency',             label: 'Urgency',           status: 'active'  },
        { field: 'priorVisit',          label: 'Prior Visit Flag',  status: 'active'  },
        { field: 'sameDayRequested',    label: 'Same-Day Request',  status: 'active'  },
        { field: 'callerType',          label: 'Caller Type',       status: 'active'  },
        { field: 'employeeMentioned',   label: 'Employee Mentioned',status: 'active'  },
      ],

      gaps: [
        'No Turn 1 booking gate: If caller\'s first utterance is a pure booking signal ("just schedule me"), intake still runs — wasted 30ms extraction call. Future: add booking intent check before running intake.',
      ],

      routing: { always: 'response_gen' },
    },

    // ── [8] Turn 1 — Response Generation (Groq 70b, streaming) ──────────
    {
      id:       'response_gen',
      order:    9,
      icon:     '💬',
      name:     'Turn 1 — Response Generation',
      subtitle: 'llama-3.3-70b-versatile generates warm spoken response with entities already known — streams plain text',
      status:   'wired',
      group:    'Turn 1 — LLM Intake',

      why: 'Split-Call Phase 2. The 70b model receives the extracted entities from Phase 1 in its system prompt — it already knows the caller\'s name, call reason, urgency, and prior visit. This lets it generate a natural, highly contextualised response without any JSON constraints. Crucially, it streams plain text instead of JSON, so the first sentence fires onSentence immediately from the first token — there is no {"responseText": "..."} JSON prefix overhead. The 3-step protocol (greet by name → acknowledge problem → offer forward move) produces responses that callers perceive as coming from a real person.',

      engine:   'Agent2DiscoveryRunner — callLLMAgentForIntake() Split Phase 2 → streamWithSentences()',
      provider: 'Groq',
      model:    'llama-3.3-70b-versatile',
      fires:    'Turn 1. Starts streaming ~30ms after Phase 1 completes. onSentence fires on first token boundary.',
      writesTo: 'responseResult.response → Redis bridge result key (plain text, no JSON parse needed)',
      wiredIn:  [
        'services/engine/agent2/Agent2DiscoveryRunner.js — callLLMAgentForIntake() split block',
        'config/llmAgentDefaults.js — composeIntakeResponsePrompt()',
        'services/streaming/SentenceStreamingService.js — streamWithSentences()',
      ],
      configIn:  'LLM Agent Settings — Intake > Split Calls',
      configUrl: 'llmagent.html',

      extracts: [],

      gaps: [
        'KC path missing: Response protocol (greet by name, acknowledge, CTA) only applies on Turn 1. KC responses on Turn 2+ do not carry forward priorVisit acknowledgement.',
        'consentQuestion detection: askedConsent is hardcoded false in split path — not yet detected from plain-text response. Low priority.',
      ],

      routing: { always: 'first_sentence_tts' },
    },

    // ── [9] First Sentence → ElevenLabs TTS ── ⚡ MS-CRITICAL PATH ────────
    {
      id:       'first_sentence_tts',
      order:    10,
      icon:     '⚡',
      name:     'First Sentence → ElevenLabs TTS',
      subtitle: '⚡ MS-CRITICAL: First sentence boundary in Groq stream → ElevenLabs synthesis → caller hears audio in ~400ms',
      status:   'wired',
      group:    'Turn 1 — LLM Intake',

      why: 'This is the single most important latency gate in the entire platform. As the Groq 70b model streams tokens, SentenceStreamingService detects the first sentence boundary (period/exclamation/question mark). The instant that boundary is found, onSentence(sentence, 0) fires — the sentence is immediately sent to ElevenLabs for TTS synthesis, written to disk as an MP3, and its URL is resolved in the bridge race. The caller hears audio within ~400ms of their last word. Without this path, the system would wait for the FULL LLM response before any TTS could start — TTFB would be 1.5–2 seconds and callers would think the line went dead. Every regression here directly adds to caller-perceived dead air. NEVER remove or slow this path.',

      engine:   'SentenceStreamingService.streamWithSentences() → onSentence(sentence, 0) callback → ElevenLabs synthesizeSpeech()',
      provider: 'ElevenLabs (TTS)',
      model:    'Configured per company (voiceSettings.voiceId)',
      fires:    'On the first sentence boundary detected in EVERY Groq streaming response — Turn 1 and Turn 2+.',
      writesTo: 'MP3 file → disk (public/audio/sentences/) → Redis URL → Twilio <Play> → caller hears audio',
      wiredIn:  [
        'services/streaming/SentenceStreamingService.js — SentenceSplitter + onSentence callback',
        'routes/v2twilio.js — onSentence handler → ElevenLabs synthesizeSpeech() → firstSentenceAudioPromise.resolve()',
        'routes/v2twilio.js — /v2-agent-sentence-continue (remainder of response)',
      ],
      configIn:  'Voice Settings',
      configUrl: 'agent2.html',

      configFields: [
        { key: 'voiceId',           label: 'Voice ID',            unit: 'string', note: 'ElevenLabs voice to use for this company' },
        { key: 'stability',         label: 'Stability',           unit: '0-1',    note: 'Lower = more expressive, higher = more consistent' },
        { key: 'similarityBoost',   label: 'Similarity Boost',    unit: '0-1',    note: 'How closely to match the original voice' },
        { key: 'styleExaggeration', label: 'Style Exaggeration',  unit: '0-1',    note: 'Amplifies speaking style' },
        { key: 'streamingLatency',  label: 'Streaming Latency',   unit: 'enum',   note: '0=lowest latency, 4=highest quality — keep at 0 or 1 for phone calls' },
      ],

      extracts: [],
      gaps: [
        '⚠️ REGRESSION RISK: Any change to SentenceStreamingService, the onSentence callback, or ElevenLabs synthesis path directly impacts caller-perceived latency. Always measure TTFA (time to first audio) after changes.',
      ],

      routing: { always: 'question_detector' },
    },

    // ════════════════════════════════════════════════════════════════════════
    // GROUP D — TURN 2+: KC ENGINE
    // ════════════════════════════════════════════════════════════════════════

    // ── [6] Question Detector ────────────────────────────────────────────
    {
      id:       'question_detector',
      order:    11,
      icon:     '❓',
      name:     'Question Detector',
      subtitle: 'Two-tier signal scan — TIER 1 high-confidence questions bypass T1.5 and go straight to KC',
      status:   'wired',
      group:    'Turn 2+ — KC Engine',

      why: 'Callers do not follow a script. They say "my AC is broken — do you accept credit cards?" in a single utterance. Without this gate, T1.5 (trigger fast lane) handles it, but T1.5 is not designed for knowledge-container Q&A — it would miss or produce a generic answer. The two-tier system separates definite questions (TIER 1: multi-word phrases like "how much does", "do you accept", "diagnostic fee") from ambiguous signals (TIER 2: single words like "schedule", "credit"). TIER 1 routes DIRECTLY to KC, skipping T1.5 and Pricing entirely. TIER 2 falls through to the normal T1.5 → Pricing → KC path where they are still caught.',

      engine:   'KnowledgeContainerService.detectTier()',
      provider: 'Synchronous (no AI) — two-tier phrase matching, <1ms',
      model:    null,
      fires:    'Turn 2+ (no-match path), inside callLLMAgentForNoMatch, BEFORE T1.5 Groq fast lane',
      writesTo: 'Early return with KC answer on TIER 1 hit. Emits A2_STAGE11_DETECT + A2_STAGE11_KC_HIT.',
      wiredIn:  [
        'services/engine/agent2/Agent2DiscoveryRunner.js — callLLMAgentForNoMatch, before T1.5',
        'services/engine/agent2/KnowledgeContainerService.js — detectTier(), TIER1_SIGNALS, TIER2_SIGNALS',
      ],
      configIn:  'Knowledge Containers — Knowledge Base tab',
      configUrl: 'agent2.html',

      extracts: [],

      gaps: [
        'Stage 11 only fires on the no-match path (Turn 2+). If a trigger card matches on Turn 1 and the caller also asked a question, KC still does not run for that turn.',
        'Next step: Wire a lightweight TIER 1 check in the main pipeline before ScrabEngine for full Turn 1 coverage.',
      ],

      routing: { 'tier1 + KC hit': 'KC Answer (direct, skips T1.5)', 'tier1 miss / tier2 / no signal': 'T1.5 → Pricing → KC → Claude' },
    },

    // ── [7] Booking Intent Gate ──────────────────────────────────────────
    {
      id:       'booking_intent',
      order:    12,
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
      order:    13,
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
      order:    14,
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
      order:    15,
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
      order:    16,
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
    // GROUP E — RESPONSE DELIVERY
    // ════════════════════════════════════════════════════════════════════════

    // ── [12] Bridge / Post-Gather Config ────────────────────────────────
    {
      id:       'bridge_config',
      order:    17,
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
      bypassed:  '⏭️ Bypassed',
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

      // STT Gather: populate gatherParams live values from speechDetection config
      if (stage.id === 'stt_gather') {
        const sd = apiData.pipeline?.speechDetection;
        if (sd && enriched.gatherParams?.length) {
          enriched.gatherParams = enriched.gatherParams.map(gp => {
            if (gp.source !== 'wired' && gp.source !== 'stt_builder') return gp;
            const updated = { ...gp };
            if (gp.liveKey === 'keywords') {
              // hints: show keyword count + format
              const kws = (sd.keywords || []).filter(k => k.enabled !== false);
              const model = sd.speechModel || 'phone_call';
              const isDeepgram = (model === 'nova-2-phonecall' || model === 'auto');
              updated.liveValue = kws.length > 0
                ? `${kws.length} keyword${kws.length !== 1 ? 's' : ''} (${isDeepgram ? 'phrase:boost' : 'flat CSV'})`
                : 'none — using trade/service fallback';
            } else if (gp.liveKey === 'enhancedRecognition') {
              const model = sd.speechModel || 'phone_call';
              const isDeepgram = (model === 'nova-2-phonecall' || model === 'auto');
              const raw = sd.enhancedRecognition !== false;
              updated.liveValue = isDeepgram ? 'false (auto-disabled — Deepgram active)' : String(raw);
            } else if (gp.liveKey !== undefined && sd[gp.liveKey] !== undefined) {
              updated.liveValue = String(sd[gp.liveKey]);
            }
            return updated;
          });
        }
      }

      // End-of-Speech Detection: populate live values from speechDetection config
      if (stage.id === 'stt_eosdetection') {
        const sd = apiData.pipeline?.speechDetection;
        if (sd) {
          const stMs = Math.round((sd.speechTimeout ?? 1.5) * 1000);
          enriched.liveValues = [
            {
              label:  '⚡ End-of-Speech Silence Wait',
              value:  `${sd.speechTimeout ?? 1.5}s`,
              ms:     stMs,
              impact: 'high',
              note:   `${stMs.toLocaleString()}ms of silence after caller stops talking before ANYTHING starts. Dominant latency factor — 4× larger than all AI processing combined.`,
            },
            {
              label:  'Initial Wait (caller start)',
              value:  `${sd.initialTimeout ?? 7}s`,
              ms:     0,
              impact: 'none',
              note:   'How long Twilio waits for caller to begin speaking. Does not affect response speed.',
            },
            {
              label:  'Barge-in',
              value:  sd.bargeIn ? 'ON' : 'OFF',
              ms:     sd.bargeIn ? 0 : -1,
              impact: sd.bargeIn ? 'none' : 'medium',
              note:   sd.bargeIn
                ? 'Caller can interrupt agent mid-response — fastest interaction model.'
                : 'Caller must wait for all agent audio to finish before speaking. Adds full response playback duration to perceived wait.',
            },
            {
              label:  'Enhanced STT (Twilio model)',
              value:  sd.enhancedRecognition !== false ? 'ON' : 'OFF',
              ms:     sd.enhancedRecognition !== false ? 100 : 0,
              impact: sd.enhancedRecognition !== false ? 'medium' : 'none',
              note:   sd.enhancedRecognition !== false
                ? 'Twilio\'s enhanced Google model active (~100ms latency cost per turn). NOT Deepgram — Deepgram is a separate post-hoc fallback. Test with OFF — if transcripts stay clean, save 100ms.'
                : 'Standard Twilio model. Faster (~100ms saved). Monitor transcript quality on technical terms (model names, HVAC parts etc).',
            },
            {
              label:  'Speech Model / STT Provider',
              value:  sd.speechModel || 'phone_call',
              ms:     0,
              impact: 'none',
              note:   (sd.speechModel === 'nova-2-phonecall' || sd.speechModel === 'auto')
                ? `Deepgram provider active — weighted hint format (phrase:boost) in use. Enhanced STT auto-disabled. Consider adding keywords in agent2.html → Manage Keywords.`
                : 'Google STT provider. phone_call is optimized for PSTN. Switch to "auto" to enable Deepgram with automatic failover.',
            },
            (() => {
              const kws = (sd.keywords || []).filter(k => k.enabled !== false);
              const isDeepgram = (sd.speechModel === 'nova-2-phonecall' || sd.speechModel === 'auto');
              return {
                label:  'STT Keywords',
                value:  kws.length > 0 ? `${kws.length} active` : 'none',
                ms:     0,
                impact: kws.length > 0 ? 'low' : 'medium',
                note:   kws.length === 0
                  ? 'No custom keywords — generic hints only (trade name + service types). Add keywords in agent2.html → Manage Keywords to improve brand/symptom recognition.'
                  : `${kws.length} custom keyword${kws.length !== 1 ? 's' : ''} sent as STT hints. Format: ${isDeepgram ? 'Deepgram weighted (phrase:boost)' : 'Google flat CSV'}.`,
              };
            })(),
          ];
          enriched.dynamicBadge = `⏳ ${sd.speechTimeout ?? 1.5}s → ${stMs.toLocaleString()}ms`;
          // Surface a gap if speechTimeout is above optimal
          if ((sd.speechTimeout ?? 1.5) > 1.0) {
            const saving = Math.round(((sd.speechTimeout ?? 1.5) - 1.0) * 1000);
            enriched.gaps.push(
              `speechTimeout is ${sd.speechTimeout ?? 1.5}s (${stMs}ms). Lowering to 1.0s saves ${saving}ms per turn — zero code change, just adjust the slider in Agent 2.0 → Speech Detection.`
            );
          }
        } else {
          enriched.gaps.push('speechDetection config not found — using Twilio defaults (1.5s). Configure in Agent 2.0 → Speech Detection.');
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
      // silent — auto-refresh failure is non-blocking
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

    // ── Gather parameters map ──────────────────────────────────────────
    // Shows every attribute sent to Twilio <Gather>, colour-coded by source.
    const gatherParamsHtml = stage.gatherParams?.length
      ? (() => {
          const sourceLabel = { wired: '✅ WIRED', stt_builder: '✅ WIRED', runtime: '🔧 RUNTIME', hardcoded: '— FIXED' };
          const sourceCls   = { wired: 'gp-wired', stt_builder: 'gp-builder', runtime: 'gp-runtime', hardcoded: 'gp-fixed' };
          const rows = stage.gatherParams.map(gp => {
            const display = gp.liveValue !== undefined
              ? `<span class="gp-live-value">${esc(gp.liveValue)}</span>`
              : gp.value !== undefined
                ? `<span class="gp-static-value">${esc(gp.value)}</span>`
                : `<span class="gp-no-value">—</span>`;
            const badge = `<span class="gp-source-badge ${sourceCls[gp.source] || ''}">${sourceLabel[gp.source] || gp.source}</span>`;
            const note = gp.note ? `<span class="gp-note">${esc(gp.note)}</span>` : '';
            return `<tr class="gp-row gp-row-${gp.source}">
              <td class="gp-param"><code>${esc(gp.param)}</code></td>
              <td class="gp-val">${display}</td>
              <td class="gp-badge-cell">${badge}</td>
              <td class="gp-note-cell">${note}</td>
            </tr>`;
          }).join('');
          return `<div class="dp-section">
            <div class="dp-section-label">🔌 Twilio &lt;Gather&gt; — All Parameters</div>
            <p style="font-size:0.78rem;color:var(--text-muted);margin:0 0 10px 0;">Every attribute sent to Twilio at call time. <strong>WIRED</strong> = per-company, UI-configurable. <strong>RUNTIME</strong> = computed per request. <strong>FIXED</strong> = hardcoded in v2twilio.js.</p>
            <table class="gp-table">
              <thead><tr><th>Parameter</th><th>Current Value</th><th>Source</th><th>Notes</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
        })()
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

    // ── Live values (dynamic — populated from API per company) ─────────
    const liveTotal = (stage.liveValues || []).reduce((sum, lv) => sum + (lv.ms > 0 ? lv.ms : 0), 0);
    const liveValuesHtml = stage.liveValues?.length
      ? `<div class="dp-section">
           <div class="dp-section-label">⚡ Live Configuration — current values for this company</div>
           <div class="dp-lv-grid">
             ${stage.liveValues.map(lv => `
               <div class="dp-lv-row dp-lv-impact-${esc(lv.impact)}">
                 <div class="dp-lv-label">${esc(lv.label)}</div>
                 <div class="dp-lv-value">${esc(lv.value)}</div>
                 <div class="dp-lv-ms">${lv.ms > 0 ? `~${lv.ms.toLocaleString()}ms` : lv.ms === -1 ? 'varies' : '—'}</div>
                 <div class="dp-lv-badge">${lv.impact !== 'none' ? lv.impact.toUpperCase() : ''}</div>
                 <div class="dp-lv-note-text">${esc(lv.note)}</div>
               </div>
             `).join('')}
           </div>
           ${liveTotal > 0 ? `
             <div class="dp-lv-total">
               ⏱ Estimated latency contribution from this stage:
               <strong>~${liveTotal.toLocaleString()}ms</strong>
             </div>
           ` : ''}
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

          ${liveValuesHtml}
          ${gatherParamsHtml}
          ${extractsHtml}
          ${gapsHtml}
          ${metaHtml}
          ${filesHtml}
          ${configFieldsHtml}
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

        // [2] Question Detector — two-tier (wired as Stage 11)
        const _t1Sigs = [
          'how much does', 'how much is', 'how much for', 'how much will', 'how much do you',
          'what does it cost', 'what will it cost', 'what is the cost', 'what is the fee',
          'what is the price', 'what are your rates', 'what are your prices', 'what do you charge',
          'what does it include', 'what is included', "what's included", 'whats included', 'what comes with',
          'what is covered', 'diagnostic fee', 'service call fee', 'service fee', 'trip charge',
          'emergency fee', 'after hours fee', 'maintenance plan', 'annual plan',
          'diagnostic credit', 'service call credit', 'do you accept', 'do you take credit',
          'do you finance', 'do you offer financing', 'payment options', 'financing options',
          'payment plan', 'any specials', 'any deals', 'any discounts', 'do you have any specials',
          'running any specials', 'is there a warranty', 'what is the warranty', 'how long is the warranty',
          'how soon can you', 'when can you come', 'how long does it take', 'what are your hours',
          'tell me about', 'can you tell me', 'can you explain', 'do you offer', 'do you provide',
          'is there a', 'are there any', 'do you have a',
        ];
        const _t2Sigs = ['cost', 'price', 'fee', 'rates', 'warranty', 'schedule',
                         'available', 'credit', 'discount', 'special', 'guarantee', 'covered'];

        const _t1Match = _t1Sigs.find(sig => input.includes(sig));
        const _t2Match = !_t1Match && _t2Sigs.some(sig => input.split(/\s+/).includes(sig));
        const _t2Matched = _t2Match ? _t2Sigs.filter(sig => input.split(/\s+/).includes(sig)) : [];

        const questionStage = {
          stageId: 'question_detector',
          icon: '❓', name: 'Question Detector',
          status: (_t1Match || _t2Match) ? 'fired' : 'skipped',
          details: [],
        };
        if (_t1Match) {
          questionStage.details.push(`✅ TIER 1 detected: "${_t1Match}" — routed directly to KC (skipped T1.5 + Pricing)`);
          turnResult.score.pass.push(`TIER 1 question detected: "${_t1Match}" — KC fast-path`);
        } else if (_t2Match) {
          questionStage.details.push(`ℹ️ TIER 2 signal(s): "${_t2Matched.join('", "')}" — falls through to T1.5 → Pricing → KC`);
        } else {
          questionStage.details.push('No question signals — normal booking/no-match path');
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
