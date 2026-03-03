(function() {
  'use strict';

  console.log('[FlowBuilder] Loading...');

  const state = {
    companyId: null,
    steps: [],
    selectedId: null,
    editingId: null,
    panelExpanded: false,
    unsavedChanges: false
  };

  let DOM = {};

  function initDOM() {
    DOM = {
      btnBack: document.getElementById('btn-back'),
      btnCallViewer: document.getElementById('btn-call-viewer'),
      btnExpandPanel: document.getElementById('btn-expand-panel'),
      expandIcon: document.getElementById('expand-icon'),
      expandLabel: document.getElementById('expand-label'),
      flowLayout: document.getElementById('flow-layout'),
      btnAddStep: document.getElementById('btn-add-step'),
      btnSave: document.getElementById('btn-save'),
      btnExport: document.getElementById('btn-export'),
      btnImport: document.getElementById('btn-import'),
      inputImport: document.getElementById('input-import'),
      btnReset: document.getElementById('btn-reset'),
      sequenceList: document.getElementById('sequence-list'),
      flowPreview: document.getElementById('flow-preview'),
      editModal: document.getElementById('edit-modal'),
      modalTitle: document.getElementById('modal-title'),
      inputStepTitle: document.getElementById('input-step-title'),
      inputStepBody: document.getElementById('input-step-body'),
      inputStepSequence: document.getElementById('input-step-sequence'),
      btnCloseModal: document.getElementById('btn-close-modal'),
      btnCancelEdit: document.getElementById('btn-cancel-edit'),
      btnDeleteStep: document.getElementById('btn-delete-step'),
      btnSaveStep: document.getElementById('btn-save-step')
    };
  }

  function init() {
    console.log('[FlowBuilder] Initializing...');
    initDOM();

    const params = new URLSearchParams(window.location.search);
    state.companyId = params.get('companyId');

    if (!state.companyId) {
      window.location.href = '/agent-console/index.html';
      return;
    }

    bindEvents();
    loadSteps();
    render();
  }

  function bindEvents() {
    if (DOM.btnBack) DOM.btnBack.addEventListener('click', () => {
      window.location.href = `/agent-console/callconsole.html?companyId=${state.companyId}`;
    });

    if (DOM.btnCallViewer) DOM.btnCallViewer.addEventListener('click', () => {
      window.open('/call-report-viewer.html', 'CallReportViewer', 'width=1400,height=900,menubar=no,toolbar=no,location=no');
    });

    if (DOM.btnExpandPanel) DOM.btnExpandPanel.addEventListener('click', togglePanelWidth);
    if (DOM.btnAddStep) DOM.btnAddStep.addEventListener('click', () => openEditModal(null));
    if (DOM.btnSave) DOM.btnSave.addEventListener('click', saveSteps);
    if (DOM.btnExport) DOM.btnExport.addEventListener('click', exportJSON);
    if (DOM.btnImport) DOM.btnImport.addEventListener('click', () => DOM.inputImport.click());
    if (DOM.inputImport) DOM.inputImport.addEventListener('change', importJSON);
    if (DOM.btnReset) DOM.btnReset.addEventListener('click', resetToDefault);
    
    if (DOM.btnCloseModal) DOM.btnCloseModal.addEventListener('click', closeModal);
    if (DOM.btnCancelEdit) DOM.btnCancelEdit.addEventListener('click', closeModal);
    if (DOM.btnSaveStep) DOM.btnSaveStep.addEventListener('click', saveStep);
    if (DOM.btnDeleteStep) DOM.btnDeleteStep.addEventListener('click', deleteStep);
    
    if (DOM.editModal) {
      DOM.editModal.addEventListener('click', (e) => {
        if (e.target === DOM.editModal) closeModal();
      });
    }
  }

  function togglePanelWidth() {
    state.panelExpanded = !state.panelExpanded;
    
    if (DOM.flowLayout) {
      DOM.flowLayout.classList.toggle('expanded-panel', state.panelExpanded);
    }
    
    if (DOM.expandIcon) {
      DOM.expandIcon.textContent = state.panelExpanded ? '▶▶' : '◀◀';
    }
    if (DOM.expandLabel) {
      DOM.expandLabel.textContent = state.panelExpanded ? 'Collapse' : 'Expand';
    }
  }

  function loadSteps() {
    const storageKey = `flowBuilder.steps:${state.companyId}`;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        state.steps = Array.isArray(parsed) ? parsed : getDefaultSteps();
      } else {
        state.steps = getDefaultSteps();
      }
    } catch (err) {
      console.error('[FlowBuilder] Load error:', err);
      state.steps = getDefaultSteps();
    }
  }

  function saveSteps() {
    const storageKey = `flowBuilder.steps:${state.companyId}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state.steps));
      state.unsavedChanges = false;
      showToast('success', 'Saved!', 'Flow sequence saved to browser storage');
    } catch (err) {
      console.error('[FlowBuilder] Save error:', err);
      showToast('error', 'Save Failed', err.message);
    }
  }

  function getDefaultSteps() {
    return [

      // ═══════════════════════════════════════════════════════════
      // TIER 1 — CALL ENTRY  (Steps 1–5)
      // ═══════════════════════════════════════════════════════════
      {
        id: 'step_twilio_entry',
        sequence: 1,
        title: '📞 TIER 1 · Twilio Entry',
        body: '**Platform entry point. Every call starts here.**\n\n**TIER 1 LATENCY BUDGET: ~0ms (telecom/STT reality — outside our control)**\n\nThe call stack through Tiers 1-2 is dominated by:\n- Twilio round-trip: ~100-200ms webhook delivery\n- Deepgram STT endpointing: 500-2000ms (waits for caller to stop speaking)\n- Barge-in handling: customer may interrupt audio mid-play\nThese are NOT fixable by code optimization. Design around them with bridge audio.\n\n**File:** routes/v2twilio.js\n**Endpoint:** POST /api/twilio/voice\n\n**What Happens:**\n- Customer dials a Twilio number assigned to a company\n- Twilio looks up companyId by the "To" phone number\n- Twilio webhook POSTs call metadata to backend\n- Company record loaded from MongoDB\n\n**Key Principle:** One Twilio number = one company. The entire platform is multi-tenant from this point forward.\n\n**Next:** Gatekeeper Check'
      },
      {
        id: 'step_gatekeeper',
        sequence: 2,
        title: '🛡️ TIER 1 · Gatekeeper Check',
        body: '**First business logic gate. Prevents processing for suspended or forwarded accounts.**\n\n**File:** routes/v2twilio.js\n**UI Config:** Admin → Account Status\n**Reads:** company.accountStatus.status\n\n**Decision Matrix:**\n- **active** → Continue to spam filter ✅\n- **suspended** → Play configured suspension message, hangup 🚫\n- **call_forward** → Transfer to alternate number, log as FORWARDED 📞\n- **after_hours** → Check schedule, possibly forward or respond with hours\n\n**Why This Matters:**\nNo wasted processing cycles, no ElevenLabs costs, no LLM calls for suspended accounts. The gate is fast and absolute.\n\n**Self-Healing Audio:**\nSuspension message MP3 is stored in MongoDB binary — survives Render.com filesystem resets.\n\n**Next:** Spam Filter'
      },
      {
        id: 'step_spam_filter',
        sequence: 3,
        title: '🚫 TIER 1 · Spam Filter',
        body: '**Blocks robocalls and known spam before ANY processing.**\n\n**File:** routes/v2twilio.js\n**Service:** SmartCallFilter.checkCall()\n\n**Filter Layers:**\n1. Platform global blocklist (Twilio SPAM, known robocallers)\n2. Company-specific blocklist (phone numbers)\n3. Pattern detection (repeated short calls, silent calls)\n4. Carrier spam flags\n\n**If Blocked:**\n- Log SPAM_BLOCKED event\n- Play short rejection message (or silence)\n- Hangup — no further processing\n\n**If Clear:**\n- Log SPAM_ALLOWED event\n- Proceed to greeting\n\n**Cost Impact:**\nBlocking spam here prevents ElevenLabs TTS costs, LLM API calls, and Redis state creation for fraudulent/robocalls.\n\n**Next:** Greeting'
      },
      {
        id: 'step_call_greeting',
        sequence: 4,
        title: '👋 TIER 1 · Call Start Greeting',
        body: '**What the customer hears first. First impression of the AI receptionist.**\n\n**File:** routes/v2twilio.js\n**UI Config:** Agent Console → Greetings tab\n**Config Path:** company.aiAgentSettings.agent2.greetings.callStart\n\n**Greeting Sources (priority order):**\n1. Pre-recorded audio URL (MP3, instant playback)\n2. ElevenLabs TTS from text (generated, ~2-3s)\n3. Twilio <Say> fallback (last resort)\n\n**Returning Caller Detection:**\nIf caller phone matches a previous booking, AI greets by name:\n"Hi John! Welcome back to ABC Plumbing."\n\n**Self-Healing Audio:**\nGreeting MP3s stored in MongoDB as binary blobs. If server filesystem is wiped (Render.com ephemeral), files auto-restore from DB.\n\n**Performance Target:** < 500ms from answer to audio playing.\n\n**Next:** Gather Setup (start listening for speech)'
      },
      {
        id: 'step_gather',
        sequence: 5,
        title: '🎧 TIER 1 · Gather Setup (Deepgram STT)',
        body: '**Configures Twilio to listen for customer speech and transcribe it.**\n\n**File:** routes/v2twilio.js\n**STT Provider:** Deepgram Enhanced (not native Twilio STT)\n\n**TwiML <Gather> Config:**\n```xml\n<Gather\n  input="speech"\n  action="/api/twilio/v2-agent-respond/:companyId"\n  enhanced="true"\n  speechModel="phone_call"\n  language="en-US"\n  timeout="7"\n  speechTimeout="auto"\n/>\n```\n\n**Why Deepgram:**\n- Significantly better accuracy than Twilio STT\n- Better with HVAC terminology\n- Handles accents better\n- Confidence scores available\n\n**Audio plays INSIDE the Gather:**\nGreeting plays while Gather listens — customer can interrupt greeting and start speaking.\n\n**After Gather completes:**\nTwilio POSTs SpeechResult + Confidence to action URL.\n\n**Next:** Customer Speaks'
      },
      // ═══════════════════════════════════════════════════════════
      // TIER 2 — SPEECH CAPTURE  (Steps 6–7)
      // ═══════════════════════════════════════════════════════════
      {
        id: 'step_customer_speaks',
        sequence: 6,
        title: '🗣️ TIER 2 · Customer Speaks',
        body: '**The raw human input. Everything downstream serves this moment.**\n\n**What Happens:**\n1. Customer speaks into their phone\n2. Twilio streams audio to Deepgram in real-time\n3. Deepgram returns transcript with confidence score\n4. Twilio fires webhook with SpeechResult\n\n**Real Examples — What Deepgram Returns:**\n```\n"Hi um my air conditioning isn\'t cooling my house"\n"the AC quit working last night"\n"I need to reschedule my appointment for tomorrow"\n"good morning I\'m calling about my invoice"\n```\n\n**What We Receive (RAW, unfiltered):**\n- Contractions intact: "isn\'t", "won\'t", "doesn\'t"\n- Filler words present: "um", "uh", "you know"\n- Greetings present: "hi", "good morning"\n- Layman terms: "quit", "on the fritz", "dead"\n\n**This is why ScrabEngine exists** — all of the above must be normalized before trigger matching.\n\n**Confidence Score:**\n0.0–1.0. Quality gate checks this in ScrabEngine Stage 5.\n\n**Next:** SpeechResult POSTed to backend'
      },
      {
        id: 'step_speechresult_post',
        sequence: 7,
        title: '📨 TIER 2 · SpeechResult Posted to Backend',
        body: '**Twilio delivers the transcript to our processing pipeline.**\n\n**File:** routes/v2twilio.js\n**Endpoint:** POST /api/twilio/v2-agent-respond/:companyId\n\n**Request Body:**\n```json\n{\n  "SpeechResult": "Hi um my ac isn\'t cooling",\n  "CallSid": "CAxxxx...",\n  "Confidence": "0.93",\n  "From": "+12395551234",\n  "To":   "+19545559999"\n}\n```\n\n**Backend Validates:**\n- CompanyId valid and active\n- CallSid present\n- SpeechResult not empty\n\n**This begins the AI processing pipeline.**\nEverything from here is deterministic, measured, and logged.\n\n**Next:** ScrabEngine text processing pipeline (RUNS FIRST)'
      },
      // ═══════════════════════════════════════════════════════════
      // TIER 3 — SCRABENGINE TEXT PROCESSING PIPELINE  (Steps 8–13)
      // ═══════════════════════════════════════════════════════════
      {
        id: 'step_scrabengine',
        sequence: 8,
        title: '🔍 TIER 3 · ScrabEngine — Pipeline Entry',
        body: '**V125+: Runs ABSOLUTELY FIRST before any decision logic. Text normalization is mandatory.**\n\n**File:** services/ScrabEngine.js\n**Called from:** Agent2DiscoveryRunner.js (immediately after SpeechResult received)\n**UI Config:** Admin Console → ScrabEngine (5-tab admin page)\n\n**CRITICAL ARCHITECTURAL RULE:**\nNo trigger matching, no intent detection, no greeting check runs against RAW text.\nEvery downstream system receives ScrabEngine-normalized text.\n\n**Why V125 moved this first:**\nPreviously: Greeting interceptor ran first → saw "Hi" → early return → triggers never fired.\nNow: ScrabEngine removes "Hi" first → greeting sees clean text → triggers evaluate correctly.\n\n**Pipeline Output:**\n```json\n{\n  "rawText":         "Hi um my ac isn\'t cooling",\n  "normalizedText":  "my ac is not cooling",\n  "expandedTokens":  ["my","ac","is","not","cooling","air","conditioner"],\n  "entities":        { "firstName": null, "phone": null },\n  "quality":         { "passed": true, "confidence": 0.95 },\n  "performance":     { "totalTimeMs": 12 }\n}\n```\n\n**Events:** SCRABENGINE_ENTRY → SCRABENGINE_STAGE1..5 → SCRABENGINE_DELIVERY\n**Performance Target:** < 30ms total (warn at 50ms)\n**Guarantee:** rawText is NEVER mutated. All transforms are logged. Idempotent.'
      },
      {
        id: 'step_se_stage1',
        sequence: 9,
        title: '🧹 TIER 3 · SE Stage 1: Filler Removal',
        body: '**Strips conversational noise that adds zero semantic value.**\n\n**File:** services/ScrabEngine.js → FillerRemovalEngine\n**UI Config:** ScrabEngine Admin → Stage 1 (Fillers tab)\n\n**Built-in Fillers (always active, visible in UI):**\n"um", "uh", "er", "ah", "eh", "hmm", "hm", "like", "basically", "actually", "literally", "you know", "i mean", "you see", "kind of", "sort of"\n\n**Built-in Greeting Stripping (start of input only):**\n"hi", "hello", "hey", "hi there", "good morning", "good afternoon"\n\n**Company-Configurable:**\n- Custom filler phrases (admin-added)\n- Toggle strip greetings on/off\n- Toggle strip company name on/off\n\n**Protected Words (NEVER removed):**\n"no", "yes", "ok", "sure", "right", "wrong", "maybe"\n— These have semantic value in context.\n\n**Example:**\n```\nInput:  "Hi um good morning I need uh emergency service"\nOutput: "need emergency service"\n```\n\n**Performance:** ~1-3ms'
      },
      {
        id: 'step_se_stage2',
        sequence: 10,
        title: '📝 TIER 3 · SE Stage 2: Vocabulary Normalization',
        body: '**Three-layer normalization. Runs in this order: System Defaults → Company Rules.**\n\n**File:** services/ScrabEngine.js → VocabularyNormalizationEngine\n**UI Config:** ScrabEngine Admin → Stage 2 (Vocabulary tab)\n\n**LAYER A — System Language Defaults (Phase 1 fix, UI-toggleable):**\n\nContraction Expansion (19 rules) — CRITICAL for trigger matching:\n```\nisn\'t    → is not     won\'t   → will not\ndoesn\'t  → does not   can\'t   → cannot\nhasn\'t   → has not    wasn\'t  → was not\ndidn\'t   → did not    wouldn\'t → would not\naren\'t   → are not    haven\'t  → have not\n```\nWhy: Keyword "not cooling" won\'t match "isn\'t cooling" without this.\n\nLayman Service Vocabulary (10 rules):\n```\n"quit working"  → "stopped working"\n"quit on me"    → "stopped working"\n"on the fritz"  → "not working"\n"acting up"     → "not working"\n"went out"      → "stopped working"\n"broke down"    → "stopped working"\n```\n\n**LAYER B — Company Vocabulary Rules (custom, admin-configured):**\n```\n"acee" → "ac"          "tstat" → "thermostat"\n"pulling" → "cooling"  "hvac"  → "heating cooling"\n```\nMatchModes: EXACT (word boundary) or CONTAINS (substring)\n\n**Both layers visible + toggleable in ScrabEngine UI. No hidden processing.**\n\n**Performance:** ~2-8ms'
      },
      {
        id: 'step_se_stage3',
        sequence: 11,
        title: '🎯 TIER 3 · SE Stage 3: Token Expansion',
        body: '**Expands the token set so triggers match even when caller used synonyms.**\n\n**File:** services/ScrabEngine.js → TokenExpansionEngine\n**UI Config:** ScrabEngine Admin → Stage 3 (Synonyms tab)\n\n**How It Works:**\n- ADDS tokens to the match space — never replaces original text\n- rawText is preserved\n- Both original AND expanded tokens available to TriggerCardMatcher\n\n**Word Synonyms (admin-configured):**\n```\n"ac" → adds ["air conditioning", "air conditioner", "cooling system"]\n"unit" → adds ["system", "equipment", "air handler", "condenser"]\n```\n\n**Context Patterns (admin-configured):**\nDetects multi-word contexts and infers component:\n```\n"thing" + "garage" → infer "air handler" → adds [air, handler, ahu, indoor, unit]\n"box outside" + "hot" → infer "condenser" → adds [condenser, outdoor, compressor]\n```\n\n**Enhanced Input for Matching:**\n```\nnormalizedText: "my ac is not cooling"\nexpandedTokens: ["my","ac","is","not","cooling","air","conditioner","cooling","system"]\nenhancedInput:  "my ac is not cooling air conditioner cooling system"\n```\nTriggerCardMatcher checks BOTH normalizedText AND enhancedInput.\n\n**Performance:** ~5-15ms'
      },
      {
        id: 'step_se_stage4',
        sequence: 12,
        title: '🏷️ TIER 3 · SE Stage 4: Entity Extraction',
        body: '**Extracts business-critical data from caller speech for booking handoff.**\n\n**File:** services/ScrabEngine.js → EntityExtractionEngine\n**UI Config:** ScrabEngine Admin → Stage 4 (Extraction tab)\n\n**Built-in Extractors (always active, visible in UI):**\n- **firstName:** "my name is Mark" / "I\'m Mark" / "call me Mark"\n  Validated against 9,530 first names via GlobalHubService\n- **lastName:** "last name is Smith" / "I\'m Mr. Johnson"\n  Validated against 161,427 surnames\n- **phone:** "(239) 555-1234" / "239-555-1234" / "2395551234"\n- **email:** "mark@example.com"\n- **address:** Street addresses (regex + pattern matching)\n\n**Custom Patterns (company-configurable):**\nAdd any entity your booking flow needs — membershipId, serviceAddress, etc.\n\n**Auto-Handoff:**\nExtracted entities automatically passed to BookingLogicEngine when booking starts.\nZero re-asking for information already captured.\n\n**Example:**\n```\nInput: "Hi this is Mark Smith at 239-555-1234"\nOutput: firstName="Mark", lastName="Smith", phone="239-555-1234"\n→ Auto-populates booking slots\n```\n\n**Event:** CALLER_NAME_EXTRACTED (if name found → turn 1 name greeting fires)\n**Performance:** ~10-15ms'
      },
      {
        id: 'step_se_stage5',
        sequence: 13,
        title: '✅ TIER 3 · SE Stage 5: Quality Gate',
        body: '**Final quality check before delivering normalized text to triggers.**\n\n**File:** services/ScrabEngine.js → QualityGate\n**UI Config:** ScrabEngine Admin → Quality Gates section\n\n**Quality Checks:**\n- Minimum word count (configurable, default: 2 words)\n- Minimum confidence score from Deepgram (configurable, default: 0.5)\n- Text not empty after normalization\n- Not all-noise (fillers stripped to nothing)\n\n**If Quality FAILS:**\n- Emit SCRABENGINE_QUALITY_FAILED event (visible in Call Console)\n- shouldReprompt: true → system can re-ask caller\n- Does NOT crash the pipeline — graceful degradation\n\n**If Quality PASSES:**\n- normalizedText delivered downstream\n- All 5 stage results bundled into ScrabResult\n- Visual trace events emitted for Call Console (each stage visible in transcript)\n\n**ScrabResult Bundle:**\n```\nnormalizedText, expandedTokens, entities,\ntransformations[], quality{}, performance{}\n```\nThis bundle is the SINGLE authoritative input for all downstream systems.\n\n**Performance:** ~1-2ms\n**Total Pipeline:** < 30ms target'
      },
      // ═══════════════════════════════════════════════════════════
      // TIER 4 — CALL ROUTING  (Steps 14–17)
      // ═══════════════════════════════════════════════════════════
      {
        id: 'step_loadstate',
        sequence: 14,
        title: '💾 TIER 4 · Load Call State',
        body: '**Restores the full conversation context from Redis — makes multi-turn calls intelligent.**\n\n**File:** services/engine/StateStore.js\n**Storage:** Redis (key: call:{CallSid})\n**TTL:** Expires when call ends + buffer\n\n**State Contains:**\n- Turn number (which turn are we on?)\n- Session mode: DISCOVERY or BOOKING\n- Pending questions (follow-up awaiting answer)\n- Booking context (slots filled so far)\n- Call Router prior bucket (what bucket did Turn 1 classify as?)\n- Caller name (if extracted Turn 1)\n- Greeting-fired flag (one-shot guard)\n- LLM turn count (max 1-2 per call)\n- Entity extractions (name, phone, address)\n\n**Turn 1:** Creates fresh state\n**Turn 2+:** Loads and extends state\n\n**Multi-Turn Awareness:**\nState is what allows the AI to say "As I mentioned..." or continue booking where it left off.\nWithout state, every turn is a fresh conversation — the AI would be amnesiac.\n\n**Performance:** < 5ms (Redis in-memory lookup)'
      },
      {
        id: 'step_callruntime',
        sequence: 15,
        title: '🚦 TIER 4 · CallRuntime — Session Mode Router',
        body: '**Traffic cop. Routes to the correct engine based on current session mode.**\n\n**File:** services/engine/CallRuntime.js\n\n**Decision:**\n```\nIF state.sessionMode === "BOOKING":\n  → BookingLogicEngine (slot filling)\nELSE (default: "DISCOVERY"):\n  → Agent2DiscoveryRunner (intent + triggers)\n```\n\n**Session Modes:**\n- **DISCOVERY:** Customer hasn\'t agreed to book yet. AI qualifies intent.\n- **BOOKING:** Customer said yes. AI collects name/phone/address/time.\n\n**The Switch Happens When:**\n1. Trigger follow-up consent = YES + nextAction = HANDOFF_BOOKING\n2. Trigger directly starts booking\n3. Consent gate fires (CallRouter classified booking_service + caller confirmed)\n\n**Also Handles:**\n- After-hours detection\n- Emergency transfer bypass\n- Error recovery and graceful degradation\n\n**Performance:** < 2ms (routing only, no I/O)'
      },
      {
        id: 'step_agent2callrouter',
        sequence: 16,
        title: '🧭 TIER 4 · Agent2CallRouter — 5-Bucket Intent Gate',
        body: '**Phase 4: Pre-classifies call intent BEFORE trigger scan. Advisory by default — filtering requires explicit opt-in.**\n\n**File:** services/engine/agent2/Agent2CallRouter.js\n**Called from:** Agent2DiscoveryRunner.js (after ScrabEngine, before TriggerCardMatcher)\n**UI Config:** company.aiAgentSettings.agent2.discovery.callRouter\n**All defaults visible via:** GET /api/agent-console/:companyId/triggers/router-config\n**Latency budget:** < 5ms (zero API calls, deterministic token scoring)\n\n**5 Business Buckets:**\n- **booking_service:** Repair, maintenance, install, emergency dispatch (31 of 42 triggers)\n- **billing_payment:** Invoice, payment, charge questions\n- **membership_plan:** Service agreements, contract inquiries\n- **existing_appointment:** Reschedule, cancel, confirm status\n- **other_operator:** Human transfer, complaint, hours, robot challenge\n\n**Scoring Algorithm:**\n1. Anchor phrase check → instant HIGH confidence (0.95) if matched\n2. Primary token score × 3 each\n3. Secondary token score × 1 each\n4. Negative token penalty × 2 each\n5. Confidence = winner_score / calibration_max\n\n**Confidence Tiers:**\n- HIGH (≥ 0.85): Strong signal\n- MEDIUM (0.60-0.84): Reasonable signal\n- LOW (< 0.60): Ambiguous — do not filter\n\n**THREE SAFETY RULES — ALL ENFORCED IN CODE (Agent2DiscoveryRunner.js):**\n\n1. ADVISORY BY DEFAULT\n   callRouter.filteringEnabled must be explicitly set to true to activate pool filtering.\n   Without it, the bucket classification is logged as events only — no trigger pool changes.\n   Default behavior: observe the bucket, pass ALL triggers to TriggerCardMatcher.\n\n2. UNTAGGED CARDS ALWAYS ELIGIBLE\n   Trigger cards with bucket:null are ALWAYS included in the evaluated pool,\n   regardless of the classified bucket or confidence level.\n   New or untagged cards are never silently excluded.\n\n3. ZERO-MATCH RETRY WITH FULL POOL\n   If filtering IS enabled and the bucket-filtered pool produces ZERO matches,\n   the system automatically retries with the COMPLETE unfiltered pool.\n   This is the safety net for mixed-intent calls:\n   "I got charged AND my AC isn\'t cooling"\n   → Bucket: billing_payment (service words present too)\n   → Filtered pool: 1 billing card → no AC trigger → ZERO MATCH\n   → RETRY: full 42-card pool → "not cooling" keyword → hvac.cooling.not_cooling fires ✅\n   This means enabling filtering CANNOT silently cause trigger regressions.\n\n**Multi-Turn Prior:**\nTurn 1 bucket stored in state. Turn 2+ uses prior to prevent flip-flopping when caller elaborates.\n\n**Event:** A2_CALL_ROUTER_CLASSIFIED (visible in Call Console)\n**Event:** A2_CALL_ROUTER_POOL_FILTERED (if filtering active)\n**Event:** A2_CALL_ROUTER_RETRY_FULL_POOL (if zero-match retry triggered)'
      },
      {
        id: 'step_agent2discovery',
        sequence: 17,
        title: '🤖 TIER 4 · Agent2DiscoveryRunner — Orchestrator',
        body: '**The brain of DISCOVERY mode. Owns the mic. Determines the response.**\n\n**File:** services/engine/agent2/Agent2DiscoveryRunner.js\n**Activated when:** sessionMode === "DISCOVERY"\n\n**Orchestration Sequence (deterministic-first, V125+):**\n1. ScrabEngine processes raw text (Stage 1-5)\n2. Entity extraction from ScrabEngine (name → greeting)\n3. Agent2CallRouter intent classification (bucket)\n4. Greeting Interceptor (on cleaned text)\n5. Patience Mode check ("hold on", "wait")\n6. Pending Follow-Up Question state machine (7-bucket)\n7. Pending Question state machine (legacy YES/NO)\n8. **TriggerCardMatcher (PRIMARY PATH)**\n9. Greeting Fallback (if greeting detected, no trigger)\n10. LLM Fallback (last resort, max 1-2 per call)\n11. Generic Fallback (absolute last resort)\n\n**Hard Rules:**\n- No hardcoded response text — all comes from UI config or trigger cards\n- ScrabEngine ALWAYS runs first\n- Every decision emits a proof event\n- LLM is assist-only, not primary responder\n\n**Output:** { response, audioUrl, matchSource, state }\n\n**Event Chain per Turn:**\nA2_GATE → SCRABENGINE_PROCESSED → A2_CALL_ROUTER_CLASSIFIED → A2_GREETING_EVALUATED → A2_TRIGGER_EVAL → A2_RESPONSE_READY'
      },
      // ═══════════════════════════════════════════════════════════════════════
      // TIER 5 — DISCOVERY ENGINE  (Steps 18–25)
      //
      // ⚠️ SEQUENCING IS CRITICAL — EACH STEP IS AN EARLY-EXIT GATE
      //
      // Actual runtime execution order (verified against Agent2DiscoveryRunner.js):
      //
      //  18. Name Greeting      ← turn 1 personalization (informational, no exit)
      //  19. Greeting Interceptor← stores detection, NEVER exits early (V125 fix)
      //  20. Follow-Up Consent  ← EARLY EXIT if caller is answering last turn's question
      //  21. Clarifier / Pending ← EARLY EXIT if clarifier / LLM handoff pending
      //  22. Patience Mode       ← EARLY EXIT if caller says "hold on"
      //  23. Trigger Pool Load   ← compile card pool (may emit TRIGGER_POOL_EMPTY)
      //  24. TriggerCardMatcher  ← PRIMARY PATH (returns on first match)
      //  25. Trigger Response    ← deliver answer, store follow-up for NEXT turn's step 20
      //
      // Steps 26-28 are fallback paths when step 24 finds no match.
      // ═══════════════════════════════════════════════════════════════════════
      {
        id: 'step_name_greeting',
        sequence: 18,
        title: '👤 TIER 5 · Name Greeting (Turn 1 Only)',
        body: '**If caller gave their name, personalize the acknowledgment immediately.**\n\n**File:** Agent2DiscoveryRunner.js\n**Config:** agent2.discovery.nameGreeting\n**Condition:** Turn 1 only + firstName extracted by ScrabEngine Stage 4\n**Latency budget:** < 1ms (template substitution)\n\n**Template:**\n```\n"Got it{name}."  → "Got it, Mark."\n"Okay{name}."    → "Okay, Sarah."\n"Perfect{name}." → "Perfect, Jennifer."\n```\n\n**If No Name Extracted:**\n{name} resolves to empty → "Got it." (still natural, no blank)\n\n**One-Shot Guard:**\nNameGreeting fires maximum ONCE per call. State tracks "usedNameGreetingThisCall".\n\n**NOT an early-exit step.** Processing always continues to Step 19.\n\n**Event:** NAME_GREETING_FIRED'
      },
      {
        id: 'step_greeting_check',
        sequence: 19,
        title: '🎭 TIER 5 · Greeting Interceptor',
        body: '**Detects pure greeting-only inputs and handles them gracefully.**\n\n**File:** Agent2DiscoveryRunner.js → Agent2GreetingInterceptor.evaluate()\n**Input:** normalizedText from ScrabEngine (already cleaned!)\n**Latency budget:** < 2ms\n\n**V125 Fix:** NO MORE EARLY EXIT.\nPreviously a greeting caused immediate return → triggers never fired.\nNow: Greeting is detected and STORED, processing ALWAYS CONTINUES to Step 20.\n\n**Detection Rules:**\n- Short-only gate (≤ configured max words)\n- No intent words present\n- One-shot guard: greets once per call maximum\n\n**Example:**\n```\nRaw: "Hi good morning I need my AC fixed"\nScrabEngine: "need my AC fixed"  (greeting stripped)\nGreeting check: NO MATCH (has intent words) ✅\nResult: Continue to triggers normally\n```\n\n**NOT an early-exit step.** Result stored, triggers ALWAYS evaluated next.\nOnly fires as response (Step 26 Greeting Fallback) if triggers find no match.\n\n**Event:** A2_GREETING_EVALUATED'
      },
      {
        id: 'step_followup_consent',
        sequence: 20,
        title: '🔄 TIER 5 · Follow-Up Consent Gate (EARLY EXIT — Turn 2+)',
        body: '**⚠️ EARLY EXIT step: if caller is answering last turn\'s follow-up question, this fires and returns immediately — triggers are NOT evaluated this turn.**\n\n**File:** Agent2DiscoveryRunner.js → pendingFollowUpQuestion state machine\n**Config:** company.aiAgentSettings.agent2.discovery.followUpConsent\n**Latency budget:** < 2ms\n\n**When Active:**\nStep 25 (Trigger Response) set pendingFollowUpQuestion last turn.\nThis turn, the caller\'s answer is classified here before anything else.\n\n**⚠️ SEQUENCING NOTE (why this is step 20, not step 24):**\nIf this came AFTER TriggerCardMatcher, the caller\'s "yes please schedule it" answer\nwould try to match triggers first — wrong result. It must intercept first.\n\n**7 Buckets:**\n1. **YES** — "yes", "sure", "absolutely", "go ahead", "do it"\n2. **NO** — "no", "not right now", "maybe later", "just asking"\n3. **MAINTENANCE** — "tune-up", "annual", "maintenance visit"\n4. **SERVICE_CALL** — "repair", "diagnostic", "technician", "come out"\n5. **HESITANT** — "maybe", "not sure", "let me think"\n6. **REPROMPT** — unclear/too short → re-ask the question\n7. **COMPLEX** — substantive new question → fall through to trigger scan (no early exit)\n\n**Outcome:**\n- YES/MAINTENANCE/SERVICE_CALL → HANDOFF_BOOKING → return (triggers skipped)\n- NO/HESITANT/REPROMPT → respond and return (triggers skipped)\n- COMPLEX → fall through → triggers evaluate normally\n\n**Event:** A2_FOLLOWUP_CONSENT_CLASSIFIED'
      },
      {
        id: 'step_patience_exit',
        sequence: 21,
        title: '🔗 TIER 5 · Clarifier + Pending Question + LLM Handoff (EARLY EXIT)',
        body: '**⚠️ Three more EARLY EXIT state machines, all running BEFORE TriggerCardMatcher.**\n\n**File:** Agent2DiscoveryRunner.js\n**Latency budget:** < 2ms each\n\n**STATE MACHINE A: Clarifier Resolution (pendingClarifier)**\nWhen a clarifier question was asked (e.g., "Is it the indoor unit or outdoor unit?"):\n- YES → locks component context, boosts matching for that component → fall through to triggers\n- NO → clears hints → fall through to triggers\n- UNCLEAR → clear clarifier, fall through\n\n**STATE MACHINE B: Pending Question (pendingQuestion — legacy)**\nWhen a generic follow-up was asked by LLM or discovery:\n- YES → execute configured yes path (often HANDOFF_BOOKING) → return\n- NO → acknowledge → return\n- REPROMPT → re-ask → return\n- Complex input → fall through to triggers\n\n**STATE MACHINE C: LLM Handoff Pending (llmHandoffPending)**\nWhen LLM Fallback asked "Can I schedule a technician for you?" last turn:\n- YES → HANDOFF_BOOKING → return\n- NO → acknowledge decline, offer alternatives → return\n- NEITHER → clear pending, fall through to triggers\n\n**Why all three run here (before TriggerCardMatcher):**\nThis is what makes multi-turn conversation coherent. Turn N ends with a question.\nTurn N+1 FIRST checks if the caller is answering that question.\nOnly if they\'re not answering (COMPLEX response) do triggers evaluate.\n\n**Event:** A2_CLARIFIER_RESOLVED / A2_PENDING_QUESTION_RESOLVED'
      },
      {
        id: 'step_patience_mode',
        sequence: 22,
        title: '⏸️ TIER 5 · Patience Mode (EARLY EXIT)',
        body: '**⚠️ EARLY EXIT step: if caller asks to hold, respond and return without evaluating triggers.**\n\n**File:** Agent2DiscoveryRunner.js → patienceSettings\n**Config:** company.aiAgentSettings.agent2.discovery.patienceSettings (UI-controlled)\n**Latency budget:** < 1ms to detect, < 2ms to respond\n\n**Trigger Phrases (configurable in admin):**\n"please hold", "one moment", "hold on", "give me a second", "let me check", "hang on", "just a minute"\n\n**Why checked here (after consent gates, before trigger pool):**\nPatience mode must not evaluate triggers because a trigger for "hold" or "wait"\nmight exist in the company\'s library and fire incorrectly. Checking patience first prevents that.\n\n**When Activated:**\n- Respond: "No problem — take your time, I\'m right here." → return\n- Enter patience mode state\n- If caller doesn\'t speak after timeout:\n  → "Are you still there?" (check-in, max 2)\n  → Final: "I\'ll be here whenever you\'re ready."\n\n**State:** patienceMode: true, patienceCheckinCount: 0\n**Event:** A2_PATH_SELECTED (path: PATIENCE_MODE)'
      },
      {
        id: 'step_trigger_pool_load',
        sequence: 23,
        title: '🗂️ TIER 5 · Trigger Pool Loading',
        body: '**Compiles the complete, deduplicated, priority-sorted trigger card pool for this company.**\n\n**File:** services/engine/agent2/TriggerService.js\n**Cache:** In-memory Map, 60-second TTL per company\n**Latency budget:** < 5ms (cache hit) / ~50ms (cache miss, DB reads)\n\n**Merge Hierarchy (5 layers):**\n1. Load PUBLISHED GlobalTrigger docs from company\'s active group\n2. Remove hidden triggers (company-specific hide list)\n3. Apply partial text overrides (company custom answer text)\n4. Replace globals with full local overrides (company-specific cards)\n5. Add pure local triggers (company-exclusive cards)\n6. Deduplicate by ruleId (Map, no duplicates possible)\n7. Sort by priority (ascending, lower = fires first)\n\n**Legacy Fallback (Phase 1 fix):**\nIf no activeGroupId → load playbook.rules → transform to card.match.* format.\nCritical: WITHOUT this transform, card.match.keywords = undefined → zero triggers ever fire.\n\n**Safety Visibility (Phase 1 fix):**\n- WARN logged when group is assigned but not published\n- WARN logged when compiled pool is empty\n- TRIGGER_POOL_EMPTY event emitted (visible in Call Console)\n\n**Admin Action:**\nRefresh Cache button in Triggers admin → clears 60-second cache immediately.\n\n**New Trigger Library:**\nRun: node scripts/seedTriggerGroupV1.js → imports 42-trigger HVAC Master V1 library'
      },
      {
        id: 'step_trigger_eval',
        sequence: 24,
        title: '🎯 TIER 5 · TriggerCardMatcher — Keyword/Phrase Matching',
        body: '**PRIMARY RESPONSE PATH. Deterministic, auditable, zero LLM.**\n\n**File:** services/engine/agent2/TriggerCardMatcher.js\n**Input:** normalizedText + expandedTokens (from ScrabEngine)\n**Latency budget:** ~2-15ms\n\n**Evaluation Pipeline (per card, priority order):**\n1. Skip DISABLED cards\n2. **maxInputWords guard (Phase 2):** If card.maxInputWords set and input exceeds it → skip\n3. Intent Gate disqualification (emergency = blocks FAQ cards)\n4. **negativeKeywords (word-based):** ALL words must appear → block card\n5. **negativePhrases (substring, Phase 2):** Exact phrase match → block card\n6. keywords: ALL words in keyword appear (order-independent) → MATCH\n7. phrases: Exact substring in input → MATCH\n8. First match by priority wins → RETURN immediately\n\n**Agent2CallRouter Pool Filtering (Phase 4 — when filteringEnabled=true):**\nBefore matching, pool may be pre-filtered by bucket (Step 16 CallRouter output).\nThree safety rules ENFORCED in code:\n1. confidence < filterThreshold → NO filtering, full pool evaluated\n2. Untagged cards (bucket:null) ALWAYS included regardless of bucket\n3. If filtered pool produces ZERO matches → retry with FULL unfiltered pool\nRule 3 prevents the mixed-intent problem: "I got charged AND my AC isn\'t cooling"\n→ CallRouter picks billing_payment, filters out AC triggers\n→ NO MATCH on filtered pool → RETRY with all 42 triggers\n→ "not cooling" keyword fires on hvac.cooling.not_cooling ✅\n\n**Events:** A2_TRIGGER_EVAL, TRIGGER_CARDS_EVALUATED\n**Admin Tool:** 🧪 Trigger Test Panel → type any utterance → see full evaluation trace'
      },
      {
        id: 'step_trigger_response',
        sequence: 25,
        title: '💬 TIER 5 · Trigger Response Delivery',
        body: '**When a trigger matches, this delivers the pre-configured response.**\n\n**File:** Agent2DiscoveryRunner.js → trigger match path\n**Latency budget:** ~200ms (pre-recorded) / ~2000-3000ms (fresh TTS) / ~50ms (cached TTS)\n\n**Response Sources (priority):**\n1. Pre-recorded audio (MP3 URL on trigger card) → instant playback ~200ms ⚡\n2. ElevenLabs TTS from answerText → generated ~2-3s\n3. LLM Trigger Mode (responseMode=\'llm\') → GPT generates from fact pack\n\n**Variable Substitution:**\n{name} → caller first name\n{company} → company name\n{diagnosticfee} → diagnostic fee from company settings\n\n**Follow-Up Question — Sets Up Step 20 on NEXT Turn:**\nIf trigger card has followUpQuestion → appended after answerText.\nStored as pendingFollowUpQuestion → next turn Step 20 (Follow-Up Consent Gate) fires first.\nThis is how the multi-turn consent flow works: trigger fires Turn N → consent handled Turn N+1.\n\n**Events:** SPEECH_SOURCE_SELECTED, A2_RESPONSE_READY'
      },
      // ═══════════════════════════════════════════════════════════
      // TIER 6 — FALLBACK PATHS  (Steps 26–28)
      // ═══════════════════════════════════════════════════════════
      {
        id: 'step_greeting_fallback',
        sequence: 26,
        title: '👋 TIER 6 · Greeting Fallback Path',
        body: '**Handles the case where caller said only "hi" and nothing else fired.**\n\n**File:** Agent2DiscoveryRunner.js\n**Condition:** Greeting was detected (Step 19) + no trigger matched + no pending questions\n\n**Priority Chain:**\n```\nTriggers (Step 22) → [if no match] →\nGreeting Fallback (Step 26) → [if no greeting either] →\nLLM Fallback (Step 27) → [if LLM blocked] →\nGeneric Fallback (Step 28)\n```\n\n**Example:**\n```\nInput: "Hi"\nScrabEngine: ""  (greeting stripped)\nCallRouter: unknown (no tokens to score)\nTriggers: NO MATCH (empty normalized text)\nGreeting detected: YES\nPath: GREETING_FALLBACK\nResponse: "Hello! What can I help you with today?"\n```\n\n**Config:** agent2.greetings (UI-controlled text)\n**Event:** A2_PATH_SELECTED (path: GREETING_ONLY)'
      },
      {
        id: 'step_llm_fallback',
        sequence: 27,
        title: '🧠 TIER 6 · LLM Fallback',
        body: '**GPT-4 assist — intelligent last resort. NEVER primary responder.**\n\n**File:** services/engine/agent2/Agent2LLMFallbackService.js\n**Model:** GPT-4o (hardcoded — Phase 4 TODO: surface to UI)\n\n**When LLM Fires:**\n- No trigger matched\n- No greeting fallback\n- LLM not blocked\n- Under max LLM turns for this call (default: 1-2)\n\n**Blocking Conditions (LLM does NOT fire if):**\n- In BOOKING mode (booking handles its own flow)\n- Pending consent question active\n- Max LLM turns already used\n- After-hours flow active\n- Transfer flow active\n\n**LLM Role:**\nLLM is a HELPER, not a responder. It:\n- Empathizes with caller\n- Extracts the core service intent\n- Asks a clarifying question OR offers to schedule\n- NEVER quotes prices, times, or slots\n- NEVER books directly — triggers booking handoff\n\n**After LLM responds:**\nIf LLM determines caller needs service → asks "Can I schedule a technician for you?"\nNext turn: llmHandoffPending state machine handles YES/NO\n\n**Performance:** ~2-3 seconds (GPT API)\n**Cost:** ~$0.003 per call (GPT-4o mini)\n**Event:** A2_LLM_FALLBACK_DECISION\n\n⚠️ If LLM is firing frequently, it means triggers aren\'t matching.\nCheck: Trigger Test Panel → see which cards are evaluating and why.'
      },
      {
        id: 'step_generic_fallback',
        sequence: 28,
        title: '🆘 TIER 6 · Generic Fallback',
        body: '**Absolute last resort. Never should fire in a properly configured system.**\n\n**File:** Agent2DiscoveryRunner.js → generic fallback\n**Config:** agent2.discovery.playbook.fallback (UI-controlled text)\n\n**When It Fires:**\n- No trigger matched\n- No greeting\n- LLM was blocked (max turns reached, booking mode, etc.)\n- Nothing else caught it\n\n**Two Generic Variants:**\n- **With captured reason:** "I understand you need help with [reason]. Let me transfer you to our team."\n- **Without reason:** "I apologize, I\'m having trouble understanding. Would you like me to connect you with our team?"\n\n**Config Paths:**\n- `agent2.discovery.playbook.fallback.noCapturedReason`\n- `agent2.discovery.playbook.fallback.capturedReason`\n\n**If Generic Fires Regularly → Action Required:**\n1. Check trigger vocabulary coverage\n2. Run Trigger Test Panel with common call phrases\n3. Add missing triggers or expand keyword coverage\n4. Check LLM turn limit setting\n\n**Event:** A2_PATH_SELECTED (path: GENERIC_FALLBACK)'
      },

      // ═══════════════════════════════════════════════════════════
      // TIER 7 — BOOKING FLOW  (Steps 29–31)
      // ═══════════════════════════════════════════════════════════
      {
        id: 'step_booking_handoff',
        sequence: 29,
        title: '📅 TIER 7 · Booking Handoff — DISCOVERY → BOOKING',
        body: '**The moment the AI transitions from understanding the problem to solving it.**\n\n**File:** Agent2DiscoveryRunner.js → HANDOFF_BOOKING path\n**Activated by:**\n1. Follow-up consent YES + nextAction=HANDOFF_BOOKING\n2. 7-bucket MAINTENANCE or SERVICE_CALL classification\n3. LLM handoff confirmation\n4. Trigger directly sets sessionMode=BOOKING\n\n**State Switch:**\n```\nsessionMode: "DISCOVERY" → "BOOKING"\nbookingCtx.step: "NAME"\nconsent: { given: true, source: "followup_consent_gate", grantedAt: ... }\n```\n\n**Entities Pre-Loaded from ScrabEngine:**\n```\nfirstName: "Mark"           (extracted Turn 1)\nphone: "+12395551234"        (extracted if stated)\ncallReason: "AC not cooling" (from normalizedText)\nbookingMode: "service_call"  (or "maintenance")\n```\n\nEntities extracted by ScrabEngine auto-populate booking slots.\nBookingLogicEngine skips asking for pre-known data.\n\n**Event:** A2_CONSENT_GATE_BOOKING\n\n**Next Turn:** BookingLogicEngine owns the conversation completely.'
      },
      {
        id: 'step_booking_engine',
        sequence: 30,
        title: '📋 TIER 7 · BookingLogicEngine — Slot Filling',
        body: '**Slot-filling state machine. Collects everything needed to book an appointment.**\n\n**File:** services/engine/booking/BookingLogicEngine.js\n**Activated when:** state.sessionMode === "BOOKING"\n\n**Booking Steps (each turn = one step):**\n1. **NAME** — "Can I get your name?" (skip if extracted)\n2. **PHONE** — "What\'s the best number to reach you?" (skip if extracted)\n3. **ADDRESS** — "What\'s the service address?"\n4. **SERVICE_TYPE** — "And this is for [AC/heating/other]?" (skip if known)\n5. **TIME_PREF** — "When works best for you?"\n6. **SLOT_SELECT** — Present available slots from Google Calendar\n7. **CONFIRM** — Read back full booking: name, address, time, service\n8. **DONE** — Book confirmed, SMS confirmation queued\n\n**Smart Skipping:**\nSlots already populated by ScrabEngine entity extraction are skipped.\n"Hi this is Mark at 239-555-1234" → NAME and PHONE already filled → skip to ADDRESS.\n\n**Google Calendar Integration:**\nChecks real availability. Returns open slots in conversational format.\n"I have tomorrow at 9am or Thursday at 2pm — which works better?"\n\n**SMS Confirmation:**\nAfter booking → SMS reminder fired via Twilio SMS within 60 seconds.\n\n**State per turn:** bookingCtx.step → next question → answer → advance step'
      },
      {
        id: 'step_booking_confirm',
        sequence: 31,
        title: '✅ TIER 7 · Booking Confirmation + Calendar + SMS',
        body: '**Final step: write to calendar, confirm to caller, send SMS.**\n\n**File:** services/engine/booking/ + Google Calendar API\n**Triggers when:** bookingCtx.step === "CONFIRM" + caller says YES\n\n**What Happens:**\n1. Google Calendar event created (company calendar)\n2. SMS confirmation sent to caller phone\n3. Call state marked: booking_completed = true\n4. sessionMode: BOOKING → DONE\n5. AI delivers confirmation response\n\n**Confirmation SMS:**\n"Confirmed! [Name] at [Address] on [Date/Time] for [Service].\nCompany: ABC HVAC — 239-555-1234"\n\n**Confirmation Response:**\n"Perfect. You\'re all set for [Date] at [Time]. You\'ll get a text confirmation shortly. Is there anything else I can help you with?"\n\n**If Calendar API Fails:**\n- Graceful fallback: "I\'ve noted your request and our team will call to confirm."\n- Log BOOKING_CALENDAR_ERROR\n- Still send SMS if possible\n\n**Events:** BOOKING_COMPLETED, SMS_CONFIRMATION_QUEUED'
      },

      // ═══════════════════════════════════════════════════════════
      // TIER 8 — RESPONSE DELIVERY  (Steps 32–34)
      // ═══════════════════════════════════════════════════════════
      {
        id: 'step_elevenlabs_tts',
        sequence: 32,
        title: '🎙️ TIER 8 · ElevenLabs TTS',
        body: '**Converts text responses to audio. Runs for any response without pre-recorded audio.**\n\n**TIER 8 LATENCY BUDGET — THE REAL BOTTLENECKS:**\nScrabEngine is NEVER the latency problem (~12ms total).\nThe actual latency killers are:\n1. STT endpointing (500-2000ms — Deepgram deciding caller finished speaking)\n2. DB/cache reads (trigger pool load: 5-50ms)\n3. LLM fallback (2000-3000ms — GPT API) — avoid by keeping triggers matched\n4. TTS generation (2000-3000ms fresh / 50ms cached) — avoid by pre-recording triggers\nOptimization strategy: maximize trigger hit rate + maximize pre-recorded audio coverage.\nEvery trigger miss = ~2-3s penalty (LLM) + ~2-3s penalty (fresh TTS) = 4-6s slower response.\n\n**File:** services/v2elevenLabsService.js\n\n**When TTS Runs:**\n- Trigger card has no pre-recorded audioUrl\n- LLM-generated response (always TTS — dynamic text, no pre-recording)\n- Greeting text (if no audio configured)\n- Follow-up questions\n- Booking responses\n\n**Pre-Recorded Audio Fast Path:**\nIf trigger card has audioUrl → SKIP TTS completely → serve MP3 directly → ~200ms ⚡\nAlways record common trigger responses for production performance.\n\n**TTS Process:**\n```\nResponse text\n  ↓\nText formatting (phone numbers read digit-by-digit, etc.)\n  ↓\nElevenLabs API → voice synthesis\n  ↓\nMP3 audio buffer (~2-3 seconds)\n  ↓\nSave to disk + MongoDB (binary backup)\n  ↓\nServe via <Play> URL in TwiML\n```\n\n**Voice Config (company-level, UI-controlled):**\n- voiceId (ElevenLabs voice)\n- stability: 0.0-1.0\n- similarity_boost: 0.0-1.0\n- style: 0.0-1.0\n- model_id: "eleven_turbo_v2" (fast) or "eleven_multilingual_v2" (quality)\n\n**Caching:**\n- Hash: SHA256(text + voiceId + settings)\n- Cache hit: < 50ms ⚡\n- Cache miss: 2000-3000ms\n\n**Self-Healing:**\nAudio files stored in MongoDB as binary. If server filesystem wiped → auto-restore from DB.\n\n**Cost:** ~$0.30 per 1000 characters generated'
      },
      {
        id: 'step_twiml_response',
        sequence: 33,
        title: '📢 TIER 8 · Twilio TwiML Response',
        body: '**Sends TwiML back to Twilio with the audio and next-listen setup.**\n\n**File:** routes/v2twilio.js\n\n**TwiML Structure:**\n```xml\n<Response>\n  <Gather\n    input="speech"\n    action="/api/twilio/v2-agent-respond/:companyId"\n    enhanced="true"\n    speechModel="phone_call"\n    timeout="7"\n    speechTimeout="auto"\n  >\n    <!-- Audio plays INSIDE Gather so customer can interrupt -->\n    <Play>https://server.com/audio/response-hash.mp3</Play>\n  </Gather>\n  <!-- Fallback if no speech detected -->\n  <Redirect>/api/twilio/v2-agent-respond/:companyId?timeout=true</Redirect>\n</Response>\n```\n\n**Why Audio Inside Gather:**\nCustomer can start speaking BEFORE audio finishes.\nIf customer interrupts → Deepgram captures partial speech → still processes correctly.\n\n**End of Call:**\nIf response is goodbye/confirmation → TwiML omits <Gather>:\n```xml\n<Response>\n  <Play>goodbye.mp3</Play>\n  <Hangup/>\n</Response>\n```\n\n**Performance:** < 5ms to generate TwiML XML (just string building)'
      },
      {
        id: 'step_next_turn',
        sequence: 34,
        title: '🔁 TIER 8 · Next Turn Setup',
        body: '**Persists state, awaits customer speech. The loop continues.**\n\n**File:** services/engine/StateStore.js + routes/v2twilio.js\n\n**After Response Delivered:**\n1. Save updated call state to Redis (turn++)\n2. Twilio plays audio + opens Gather listener\n3. Customer speaks\n4. Loop back to Step 6 (Customer Speaks)\n\n**State Saved Per Turn:**\n```json\n{\n  "turn": 2,\n  "sessionMode": "DISCOVERY",\n  "agent2": {\n    "discovery": {\n      "lastCallBucket": "booking_service",\n      "lastCallConfidence": 0.95,\n      "lastPath": "TRIGGER_CARD_ANSWER",\n      "lastTriggerId": "hvac.cooling.not_cooling",\n      "pendingFollowUpQuestion": "Do you want me to get that scheduled?"\n    }\n  },\n  "callerName": "Mark"\n}\n```\n\n**Call Console Live View:**\nEvery event emitted during this turn is saved and visible in Call Console:\n- ScrabEngine transformation trace\n- Agent2CallRouter bucket classification\n- Trigger evaluation (all cards, skip reasons, winner)\n- Response source\n- Performance timings\n\n**Turn Lifecycle:**\nTurn N → State saved → Twilio listens → Customer speaks → Turn N+1\nIf customer hangs up → Redis state expires (TTL) → Call complete\n\n**Typical Full Call:**\nTurn 1: "My AC isn\'t cooling" → Trigger fires → Follow-up question\nTurn 2: "Yes please schedule it" → Consent → BOOKING mode\nTurn 3-6: Slot filling (name, phone, address, time)\nTurn 7: "Confirmed for Thursday at 2pm" → SMS → Goodbye'
      }
    ];
  }

  function render() {
    renderSequenceList();
    renderFlowPreview();
  }

  function renderSequenceList() {
    const sorted = [...state.steps].sort((a, b) => a.sequence - b.sequence);
    
    DOM.sequenceList.innerHTML = sorted.map(step => {
      const isExpanded = state.selectedId === step.id;
      const hasBody = step.body && step.body.trim();
      
      return `
        <div class="sequence-item ${isExpanded ? 'expanded' : ''}" data-step-id="${step.id}">
          <div class="sequence-item-header">
            <div class="sequence-item-title">
              <span class="sequence-number">${step.sequence}</span>
              ${hasBody ? `<span class="expand-icon">${isExpanded ? '▼' : '▶'}</span>` : ''}
              <span>${escapeHtml(step.title)}</span>
            </div>
            <div class="sequence-controls">
              <button class="sequence-btn" data-action="edit" data-id="${step.id}" title="Edit">✏️</button>
              <button class="sequence-btn" data-action="up" data-id="${step.id}" title="Move Up">↑</button>
              <button class="sequence-btn" data-action="down" data-id="${step.id}" title="Move Down">↓</button>
            </div>
          </div>
          <div class="sequence-meta">
            <span>Step ${step.sequence}</span>
            <span>•</span>
            <span>${step.id}</span>
          </div>
          ${isExpanded && hasBody ? `
            <div class="sequence-body">${renderMarkdown(step.body)}</div>
          ` : ''}
        </div>
      `;
    }).join('');

    // Attach event listeners
    DOM.sequenceList.querySelectorAll('.sequence-item-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const item = e.target.closest('.sequence-item');
        const id = item.dataset.stepId;
        state.selectedId = state.selectedId === id ? null : id;
        render();
      });
    });

    DOM.sequenceList.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        
        if (action === 'edit') openEditModal(id);
        else if (action === 'up') moveStep(id, -1);
        else if (action === 'down') moveStep(id, 1);
      });
    });
  }

  // Tier color coding for the live preview panel
  const TIER_COLORS = {
    1: { bg: '#fef3c7', border: '#f59e0b', label: 'TIER 1 — CALL ENTRY',       num: '#92400e' },
    2: { bg: '#fce7f3', border: '#ec4899', label: 'TIER 2 — SPEECH CAPTURE',    num: '#9d174d' },
    3: { bg: '#ede9fe', border: '#8b5cf6', label: 'TIER 3 — SCRABENGINE',       num: '#5b21b6' },
    4: { bg: '#dcfce7', border: '#22c55e', label: 'TIER 4 — CALL ROUTING',      num: '#14532d' },
    5: { bg: '#dbeafe', border: '#3b82f6', label: 'TIER 5 — DISCOVERY ENGINE',  num: '#1e40af' },
    6: { bg: '#fee2e2', border: '#ef4444', label: 'TIER 6 — FALLBACK PATHS',    num: '#7f1d1d' },
    7: { bg: '#d1fae5', border: '#10b981', label: 'TIER 7 — BOOKING FLOW',      num: '#064e3b' },
    8: { bg: '#f1f5f9', border: '#64748b', label: 'TIER 8 — RESPONSE DELIVERY', num: '#334155' }
  };

  function getTierForStep(seq) {
    if (seq <= 5)  return 1;
    if (seq <= 7)  return 2;
    if (seq <= 13) return 3;
    if (seq <= 17) return 4;
    if (seq <= 25) return 5;
    if (seq <= 28) return 6;
    if (seq <= 31) return 7;
    return 8;
  }

  function renderFlowPreview() {
    const sorted = [...state.steps].sort((a, b) => a.sequence - b.sequence);
    let lastTier = 0;
    
    DOM.flowPreview.innerHTML = sorted.map((step, idx) => {
      const tier = getTierForStep(step.sequence);
      const tc = TIER_COLORS[tier] || TIER_COLORS[8];
      let tierHeader = '';
      if (tier !== lastTier) {
        lastTier = tier;
        tierHeader = `
          <div style="margin:${idx > 0 ? '16px' : '0'} 0 8px 0;padding:6px 12px;background:${tc.bg};border-left:4px solid ${tc.border};border-radius:6px;font-size:11px;font-weight:700;color:${tc.num};text-transform:uppercase;letter-spacing:0.5px;">
            ${tc.label}
          </div>`;
      }
      return `
        ${tierHeader}
        <div class="flow-step" style="border-left-color:${tc.border};background:${tc.bg}10;">
          <div class="flow-step-num" style="background:${tc.border};font-size:13px;">${step.sequence}</div>
          <div class="flow-step-content">
            <div class="flow-step-title">${escapeHtml(step.title.replace(/TIER \d+ · /,''))}</div>
            <div class="flow-step-desc">${getFirstLine(step.body)}</div>
            <div class="flow-step-file">${extractFile(step.body)}</div>
          </div>
        </div>
        ${idx < sorted.length - 1 ? `<div class="flow-arrow" style="color:${tc.border};">↓</div>` : ''}
      `;
    }).join('');
  }

  function getFirstLine(text) {
    if (!text) return '';
    const lines = text.split('\n').filter(l => l.trim() && !l.trim().startsWith('**'));
    return escapeHtml(lines[0] || '').substring(0, 150);
  }

  function extractFile(text) {
    if (!text) return '';
    const match = text.match(/\*\*File:\*\*\s*([^\n]+)/);
    return match ? escapeHtml(match[1].trim()) : '';
  }

  function renderMarkdown(text) {
    if (!text) return '';
    
    // Simple markdown rendering
    let html = escapeHtml(text);
    
    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // Code blocks
    html = html.replace(/```([^`]+)```/g, '<code>$1</code>');
    
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    
    return html;
  }

  function moveStep(stepId, direction) {
    const sorted = [...state.steps].sort((a, b) => a.sequence - b.sequence);
    const index = sorted.findIndex(s => s.id === stepId);
    
    if (index < 0) return;
    
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sorted.length) return;
    
    // Swap sequences
    const temp = sorted[index].sequence;
    sorted[index].sequence = sorted[targetIndex].sequence;
    sorted[targetIndex].sequence = temp;
    
    state.unsavedChanges = true;
    saveSteps();
    render();
  }

  function openEditModal(stepId) {
    state.editingId = stepId;
    
    if (stepId) {
      const step = state.steps.find(s => s.id === stepId);
      if (step) {
        DOM.modalTitle.textContent = 'Edit Step';
        DOM.inputStepTitle.value = step.title || '';
        DOM.inputStepBody.value = step.body || '';
        DOM.inputStepSequence.value = step.sequence || '';
        DOM.btnDeleteStep.style.display = 'block';
      }
    } else {
      DOM.modalTitle.textContent = 'Add New Step';
      DOM.inputStepTitle.value = '';
      DOM.inputStepBody.value = '';
      const maxSeq = Math.max(0, ...state.steps.map(s => s.sequence));
      DOM.inputStepSequence.value = maxSeq + 1;
      DOM.btnDeleteStep.style.display = 'none';
    }
    
    DOM.editModal.classList.add('open');
    DOM.inputStepTitle.focus();
  }

  function closeModal() {
    state.editingId = null;
    DOM.editModal.classList.remove('open');
  }

  function saveStep() {
    const title = DOM.inputStepTitle.value.trim();
    const body = DOM.inputStepBody.value.trim();
    const sequence = parseInt(DOM.inputStepSequence.value) || 1;
    
    if (!title) {
      showToast('error', 'Validation Error', 'Step title is required');
      return;
    }
    
    if (state.editingId) {
      // Update existing
      const step = state.steps.find(s => s.id === state.editingId);
      if (step) {
        step.title = title;
        step.body = body;
        step.sequence = sequence;
      }
    } else {
      // Create new
      const newStep = {
        id: `step_${Date.now()}`,
        sequence,
        title,
        body
      };
      state.steps.push(newStep);
    }
    
    state.unsavedChanges = true;
    saveSteps();
    closeModal();
    render();
  }

  function deleteStep() {
    if (!state.editingId) return;
    
    if (!confirm('Delete this step? This cannot be undone.')) return;
    
    state.steps = state.steps.filter(s => s.id !== state.editingId);
    state.unsavedChanges = true;
    saveSteps();
    closeModal();
    render();
  }

  function exportJSON() {
    const data = {
      companyId: state.companyId,
      exportedAt: new Date().toISOString(),
      version: 'V130',
      totalSteps: state.steps.length,
      tiers: 8,
      steps: state.steps
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flow-sequence-${state.companyId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('success', 'Exported!', 'Flow sequence downloaded as JSON');
  }

  function importJSON(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.steps && Array.isArray(data.steps)) {
          state.steps = data.steps;
          state.unsavedChanges = true;
          saveSteps();
          render();
          showToast('success', 'Imported!', `Loaded ${data.steps.length} steps`);
        } else {
          showToast('error', 'Import Failed', 'Invalid JSON format');
        }
      } catch (err) {
        showToast('error', 'Import Failed', err.message);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function resetToDefault() {
    if (!confirm('Reset to default sequence? This will lose your current changes.')) return;
    
    state.steps = getDefaultSteps();
    state.unsavedChanges = false;
    saveSteps();
    render();
    showToast('success', 'Reset Complete', 'Flow sequence reset to default');
  }

  function showToast(type, title, message) {
    console.log(`[FlowBuilder] ${type.toUpperCase()}: ${title} - ${message}`);
    // TODO: Add visual toast notifications
    alert(`${title}\n\n${message}`);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
