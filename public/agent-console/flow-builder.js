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
      {
        id: 'step_twilio_entry',
        sequence: 1,
        title: '📞 Twilio Entry',
        body: 'Incoming call received by Twilio\n\n**File:** routes/v2twilio.js:1004\n**Endpoint:** POST /api/twilio/voice\n\n**What Happens:**\n- Customer dials Twilio phone number\n- Twilio looks up companyId by phone number\n- Webhook fires to backend\n\n**Data:**\n- From: Caller phone number\n- To: Company Twilio number\n- CallSid: Unique call ID\n\n**Next:** Gatekeeper check'
      },
      {
        id: 'step_gatekeeper',
        sequence: 2,
        title: '🛡️ Gatekeeper Check',
        body: 'Account status verification\n\n**File:** routes/v2twilio.js:1328\n**Config:** company.accountStatus.status\n\n**Options:**\n- **Active:** Continue to spam filter ✅\n- **Suspended:** Play message, hangup 🚫\n- **Call Forward:** Transfer to alternate number 📞\n\n**Decision Point:** Only active accounts proceed\n\n**Next:** Spam filter'
      },
      {
        id: 'step_spam_filter',
        sequence: 3,
        title: '🚫 Spam Filter',
        body: 'Block spam/robocalls before processing\n\n**File:** routes/v2twilio.js:1050\n**Service:** SmartCallFilter.checkCall()\n\n**Checks:**\n- Global blocklist (platform-wide)\n- Company blocklist (local)\n- Spam score patterns\n- Repeat caller patterns\n\n**If Blocked:**\n- Play rejection message\n- Hangup immediately\n- Log as SPAM_BLOCKED\n\n**If Passed:**\n- Log as SPAM_ALLOWED\n- Continue to greeting\n\n**Next:** Call start greeting'
      },
      {
        id: 'step_call_greeting',
        sequence: 4,
        title: '👋 Call Start Greeting (Twilio → Deepgram → TTS)',
        body: 'Initial greeting when call connects\n\n**File:** routes/v2twilio.js:1578-1947\n**UI Config:** agent2.html → Greetings tab\n\n**Modes:**\n- **Prerecorded Audio:** Play ElevenLabs MP3 (fast!)\n- **TTS:** Generate speech from text\n- **Disabled:** Skip greeting, go straight to listening\n\n**Greeting Sources:**\n1. Agent 2.0 Call Start (agent2.greetings.callStart)\n2. Legacy greeting (connectionMessages.greeting)\n\n**Audio Generation:**\n- Text → ElevenLabs API\n- Cached as MP3\n- Served via /audio-safe/greetings/\n\n**Next:** Gather setup'
      },
      {
        id: 'step_gather',
        sequence: 5,
        title: '🎧 Gather Setup (Deepgram STT)',
        body: 'Configure Twilio to listen for customer speech\n\n**File:** routes/v2twilio.js:1644-1682\n\n**Twilio <Gather> Config:**\n- input: "speech"\n- action: /api/twilio/v2-agent-respond/:companyId\n- enhanced: true (uses Deepgram, not Twilio STT)\n- speechModel: "phone_call"\n- timeout: 7s (initial)\n- speechTimeout: "auto" (end of speech detection)\n\n**STT Provider:** Deepgram (via Twilio Enhanced)\n\n**Next:** Customer speaks → Deepgram transcribes'
      },
      {
        id: 'step_customer_speaks',
        sequence: 6,
        title: '🗣️ Customer Speaks (Deepgram Transcribes)',
        body: 'Customer provides their request\n\n**STT Flow:**\n1. Customer speaks into phone\n2. Twilio captures audio stream\n3. Deepgram transcribes in real-time\n4. Twilio receives transcript\n5. Twilio posts to action URL\n\n**Example:**\nCustomer says: "Hi I need emergency AC service"\nDeepgram transcribes: "Hi I need emergency AC service"\nConfidence: 0.95\n\n**Next:** POST to /v2-agent-respond'
      },
      {
        id: 'step_speechresult_post',
        sequence: 7,
        title: '📨 SpeechResult Posted to Backend',
        body: 'Twilio posts Deepgram transcript to backend\n\n**File:** routes/v2twilio.js:3523\n**Endpoint:** POST /api/twilio/v2-agent-respond/:companyId\n\n**Request Body:**\n```json\n{\n  "SpeechResult": "Hi I need emergency AC service",\n  "CallSid": "CAxxxx...",\n  "Confidence": 0.95,\n  "From": "+1234567890",\n  "To": "+1987654321"\n}\n```\n\n**Next:** ScrabEngine processes RAW text'
      },
      {
        id: 'step_scrabengine',
        sequence: 8,
        title: '🔍 ScrabEngine - Unified Text Processor',
        body: '**V125 CRITICAL:** Runs FIRST before any decision logic!\n\n**File:** services/ScrabEngine.js\n**Called from:** Agent2DiscoveryRunner.js:605\n\n**Input:** RAW SpeechResult text\n**Output:** Cleaned text + entities\n**Performance:** <30ms target\n\n**Contains 4 sub-steps (see next items)**\n\n**Events Emitted:**\n- SCRABENGINE_PROCESSED\n- SCRABENGINE_STAGE1_FILLERS\n- SCRABENGINE_STAGE2_VOCABULARY\n- SCRABENGINE_STAGE3_SYNONYMS\n- SCRABENGINE_STAGE4_EXTRACTION'
      },
      {
        id: 'step_se_fillers',
        sequence: 9,
        title: '🔍 SE Step 1: Filler Removal',
        body: '**ScrabEngine Stage 1**\n\n**Removes:**\n- Speech fillers: "um", "uh", "like", "you know", "I mean"\n- Greeting words: "hi", "hello", "hey", "good morning"\n- Mishear corrections\n\n**Example:**\n```\nInput:  "Hi um I need uh emergency service"\nOutput: "need emergency service"\n```\n\n**Why Important:**\n- Greeting words removed here (not later!)\n- Cleaner text for trigger matching\n- Fewer false positive greetings\n\n**Performance:** ~5-8ms'
      },
      {
        id: 'step_se_vocabulary',
        sequence: 10,
        title: '🔍 SE Step 2: Vocabulary Expansion',
        body: '**ScrabEngine Stage 2**\n\n**Industry-Specific Normalization:**\n- "acee" → "ac" → "air conditioning"\n- "tstat" → "thermostat"\n- "furnace" → "heating system"\n- "hvac" → "heating ventilation air conditioning"\n\n**Example:**\n```\nInput:  "my acee is broken"\nOutput: "my air conditioning broken"\n```\n\n**Configuration:**\n- Loaded from STTProfile per template\n- Company-specific vocabulary\n- Trade-specific terms\n\n**Performance:** ~3-5ms'
      },
      {
        id: 'step_se_synonyms',
        sequence: 11,
        title: '🔍 SE Step 3: Synonym Mapping',
        body: '**ScrabEngine Stage 3**\n\n**Maps Common Phrases:**\n- "broken" → "not working", "malfunctioning"\n- "asap" → "urgent", "emergency"\n- "won\'t start" → "not working"\n- Regional variations\n\n**Example:**\n```\nInput:  "ac is broken asap"\nOutput: "air conditioning not working urgent"\n```\n\n**Why Important:**\n- Standardizes language for trigger matching\n- Handles regional dialects\n- Improves match accuracy\n\n**Performance:** ~2-4ms'
      },
      {
        id: 'step_se_extraction',
        sequence: 12,
        title: '🔍 SE Step 4: Entity Extraction + Quality Gate',
        body: '**ScrabEngine Stage 4**\n\n**Extracts Entities:**\n- **firstName:** "Mark", "John", "Sarah"\n- **lastName:** "Smith", "Johnson"\n- **phone:** "(239) 555-1234"\n- **email:** "mark@example.com"\n- **address:** Street addresses\n- **serviceType:** "AC", "furnace", "thermostat"\n- **urgency:** "emergency", "today", "asap"\n\n**Quality Gate:**\n- Filters garbage input\n- Validates entity confidence\n- Checks minimum quality threshold\n- Blocks nonsense/spam\n\n**Example Output:**\n```json\n{\n  "normalizedText": "need emergency air conditioning service",\n  "entities": {\n    "firstName": "Mark",\n    "urgency": "emergency",\n    "serviceType": "air_conditioning"\n  }\n}\n```\n\n**Performance:** ~10-15ms\n**Events:** CALLER_NAME_EXTRACTED (if name found)'
      },
      {
        id: 'step_loadstate',
        sequence: 13,
        title: '💾 Load Call State',
        body: 'Load conversation history from Redis\n\n**File:** services/engine/StateStore.js\n**Key:** `call:{CallSid}`\n\n**Loads:**\n- Turn count\n- Session mode (DISCOVERY/BOOKING)\n- Extracted slots (name, phone, address)\n- Conversation history\n- Pending questions\n- Booking context\n\n**First Turn:** Creates new state\n**Later Turns:** Loads existing state\n\n**Performance:** <5ms (Redis lookup)'
      },
      {
        id: 'step_callruntime',
        sequence: 14,
        title: '🚦 CallRuntime.processTurn()',
        body: 'Main orchestrator - routes to correct engine\n\n**File:** services/engine/CallRuntime.js:293\n\n**Decision Logic:**\n```javascript\nIF state.sessionMode === BOOKING:\n  → Route to BookingLogicEngine\nELSE:\n  → Route to Agent2DiscoveryRunner\n```\n\n**Think of it as:** Traffic cop that directs to the right handler\n\n**Also Handles:**\n- Error recovery\n- State persistence\n- Event buffering\n- Opener engine (micro-acknowledgments)\n\n**Performance:** <2ms (routing only)'
      },
      {
        id: 'step_agent2discovery',
        sequence: 15,
        title: '🤖 Agent2DiscoveryRunner.run()',
        body: 'Discovery mode handler\n\n**File:** services/engine/agent2/Agent2DiscoveryRunner.js:396\n\n**Receives:**\n- CLEANED text from ScrabEngine (normalizedText)\n- Extracted entities (firstName, urgency, etc.)\n- Call state\n\n**Orchestrates:**\n1. Greeting detection (on cleaned text)\n2. Clarifier questions (if ambiguous)\n3. Trigger card matching\n4. LLM fallback (if no match)\n5. Response generation\n\n**Output:**\n- Response text\n- Audio URL (if pre-recorded)\n- Next state\n- Match source'
      },
      {
        id: 'step_greeting_check',
        sequence: 16,
        title: '🎭 Greeting Interceptor Check',
        body: '**V125 FIX:** Now receives CLEANED text!\n\n**File:** Agent2DiscoveryRunner.js:516-583\n**Function:** Agent2GreetingInterceptor.evaluate()\n\n**Input:** normalizedText (cleaned by ScrabEngine)\n\n**Checks:**\n- Is it a pure greeting? ("hi", "hello", "good morning")\n- Short-only gate (≤3-5 words max)\n- No intent words present (no "emergency", "appointment", etc.)\n- One-shot guard (only greet once per call)\n\n**V125 Change:**\n- NO MORE EARLY EXIT!\n- Stores detection result\n- Continues to trigger matching\n\n**Example:**\n```\nRaw input: "Hi I need emergency service"\nScrabEngine cleaned: "need emergency service"\nGreeting check: NO MATCH (has intent words) ✅\n→ Continues to triggers\n```\n\n**Performance:** <2ms'
      },
      {
        id: 'step_trigger_eval',
        sequence: 17,
        title: '🎯 Trigger Card Evaluation',
        body: 'Match against trigger card database\n\n**File:** services/engine/agent2/TriggerCardMatcher.js\n**Called:** Agent2DiscoveryRunner.js:1473-1474\n\n**Input:** CLEANED text from ScrabEngine\n\n**Process:**\n1. Load compiled triggers (global + company)\n2. Check keywords in cleaned text\n3. Apply negative keywords (disqualifiers)\n4. Apply hint boosts (if component locked)\n5. Rank by priority\n6. Select best match\n\n**Example:**\n```\nInput: "need emergency air conditioning service"\nCards evaluated: 23\nTop candidate: "Emergency AC" (priority 100)\nKeywords matched: "emergency", "air conditioning"\nNegative keywords: none\nResult: ✅ MATCHED\n```\n\n**Events:** A2_TRIGGER_EVAL, TRIGGER_CARDS_EVALUATED\n**Performance:** ~10-20ms'
      },
      {
        id: 'step_name_greeting',
        sequence: 18,
        title: '👤 Name Greeting (Turn 1 Only)',
        body: '**Optional personalized greeting**\n\n**File:** Agent2DiscoveryRunner.js:335-355\n**Config:** agent2.discovery.nameGreeting\n\n**When Fires:**\n- Turn 1 only\n- Name was extracted by ScrabEngine\n- Name greeting enabled in config\n\n**Template:**\n```\n"Got it{name}." → "Got it, Mark."\n"Okay{name}." → "Okay, Sarah."\n```\n\n**If No Name:**\n- {name} resolves to empty string\n- "Got it{name}." → "Got it."\n\n**Substitution:**\n- {name} → ", FirstName" or ""\n- Natural language flow\n\n**Event:** NAME_GREETING_FIRED'
      },
      {
        id: 'step_hold_modal',
        sequence: 19,
        title: '⏸️ Hold Modal (Patience Mode)',
        body: '**Triggered by hold request keywords**\n\n**File:** Agent2DiscoveryRunner.js (patience logic)\n**Config:** agent2.discovery.patienceSettings\n\n**Trigger Keywords:**\n- "please hold"\n- "one moment"\n- "give me a second"\n- "let me check"\n- "hang on"\n\n**When Activated:**\n- Enter patience mode\n- Set timeout (default: 45 seconds)\n- If timeout expires with no speech:\n  - Check-in: "Are you still there?"\n  - Max 2 check-ins\n  - Final: "I\'m here when ready"\n\n**Response:**\n"No problem — take your time."\n\n**State:** patienceMode = true\n**Event:** PATIENCE_MODE_ACTIVATED'
      },
      {
        id: 'step_trigger_response',
        sequence: 20,
        title: '💬 Trigger Response (If Matched)',
        body: '**Fast path - Pre-configured response**\n\n**File:** Agent2DiscoveryRunner.js:1549-1799\n\n**If Trigger Matched:**\n\n**1. Use Trigger answerText:**\n- Get answerText from trigger card\n- Substitute variables: {name}, {company}, {diagnosticfee}\n- Build final response\n\n**2. Audio Handling:**\n- **If audioUrl exists:** Use pre-recorded MP3 (FAST! ~200ms)\n- **Else:** Generate via ElevenLabs TTS (~2s)\n\n**3. ElevenLabs TTS (if needed):**\n- Text → ElevenLabs API\n- Voice ID from company config\n- Stability, similarity_boost, style settings\n- Cache MP3 for future use\n- Serve via /audio/\n\n**Performance:**\n- Pre-recorded: ~200ms ⚡\n- Fresh TTS: ~2-3s\n\n**Events:**\n- SPEECH_SOURCE_SELECTED\n- A2_RESPONSE_READY\n\n**Next:** Check for follow-up'
      },
      {
        id: 'step_followup_consent',
        sequence: 21,
        title: '🔄 Trigger Follow-Up & Consent Cards',
        body: '**Conditional - only if trigger has follow-up**\n\n**File:** Agent2DiscoveryRunner.js:1586-1597\n**Config:** trigger.followUp\n\n**When Activated:**\n- Trigger card has followUp.question configured\n- Trigger card has followUp.nextAction\n\n**Follow-Up Question:**\n```\nTrigger Response: "I can help with your AC emergency."\nFollow-Up: "Would you like to schedule a technician?"\n```\n\n**Next Actions:**\n- **BOOKING:** Start booking flow\n- **TRANSFER:** Transfer to live person\n- **CONTINUE:** Stay in discovery\n- **END:** End call\n\n**Consent Handling:**\nIf nextAction = BOOKING:\n- Ask consent: "May I book that for you?"\n- Wait for YES/NO\n- YES → Switch to BOOKING mode\n- NO → Stay in DISCOVERY\n\n**5-Bucket Follow-Up System:**\n1. YES (affirmative)\n2. NO (negative)\n3. REPROMPT (didn\'t understand)\n4. HESITANT (maybe, unsure)\n5. CLARIFY (asking question)\n\n**State:**\n- pendingFollowUpQuestion\n- pendingFollowUpQuestionNextAction\n- bookingConsentPending (if BOOKING)\n\n**Events:**\n- FOLLOWUP_QUESTION_ASKED\n- BOOKING_CONSENT_REQUESTED'
      },
      {
        id: 'step_booking_handoff',
        sequence: 22,
        title: '📅 Booking Handoff (If Consent YES)',
        body: '**Switch from DISCOVERY → BOOKING mode**\n\n**File:** services/engine/booking/BookingLogicEngine.js\n\n**Triggered When:**\n- Follow-up consent = YES\n- nextAction = BOOKING\n- OR trigger directly starts booking\n\n**Entities Passed to Booking:**\n```javascript\n{\n  assumptions: {\n    firstName: "Mark",        // From ScrabEngine\n    lastName: null,\n    phone: "+1234567890",\n    email: null,\n    address: null,\n    callerPhone: "+1234567890",\n    callReason: "emergency AC service",\n    serviceType: "air_conditioning",\n    urgency: "emergency"\n  },\n  discoveryContext: {\n    companyId,\n    callSid,\n    turn,\n    consentGrantedAt\n  }\n}\n```\n\n**Booking Steps:**\n1. **NAME:** Collect/confirm name (skip if extracted)\n2. **PHONE:** Verify callback number\n3. **ADDRESS:** Collect service address\n4. **SERVICE:** Confirm service details\n5. **TIME:** Select appointment slot\n6. **CONFIRM:** Read back and confirm\n\n**State Change:**\n- sessionMode: DISCOVERY → BOOKING\n- bookingCtx.step: NAME\n\n**Next Turn:** BookingLogicEngine owns the mic'
      },
      {
        id: 'step_llm_fallback',
        sequence: 23,
        title: '🧠 LLM Fallback (If No Trigger Matched)',
        body: '**GPT-4 Assist - Last Resort**\n\n**File:** Agent2DiscoveryRunner.js:2124\n**Service:** services/Agent2LLMFallbackService.js\n\n**When Used:**\n- No trigger matched\n- No greeting detected (or greeting with complex intent)\n- LLM not blocked\n- Under max LLM turns per call (default: 1-2)\n\n**Blocking Conditions:**\n- In booking flow (blocked during critical steps)\n- Pending consent question (blocked)\n- Max LLM turns reached (blocked)\n- After-hours flow active (blocked)\n\n**LLM Call:**\n- Model: GPT-4 or GPT-4o\n- Prompt: HybridReceptionistLLM\n- Context: Call history, company info\n- Max tokens: ~400\n\n**Performance:** ~2-3 seconds\n\n**Events:**\n- A2_LLM_FALLBACK_DECISION\n- LLM_CALL_STARTED\n- LLM_CALL_COMPLETED\n\n**Next:** Generate TTS for LLM response (ElevenLabs)'
      },
      {
        id: 'step_elevenlabs_tts',
        sequence: 24,
        title: '🎙️ ElevenLabs TTS (For Dynamic Responses)',
        body: '**When ElevenLabs TTS Is Used:**\n\n**File:** services/v2elevenLabsService.js\n\n**Scenarios:**\n1. Trigger response has NO pre-recorded audio\n2. LLM generated dynamic response\n3. Greeting text (if no audio configured)\n4. Follow-up questions\n\n**Process:**\n```\nText → ElevenLabs API\n  ↓\nMP3 audio buffer\n  ↓\nSave to /public/audio/\n  ↓\nServe via <Play> in TwiML\n```\n\n**Voice Settings:**\n- voiceId: From company config\n- stability: 0.5-1.0\n- similarity_boost: 0.5-1.0\n- style: 0.0-1.0\n- model_id: "eleven_turbo_v2" or "eleven_multilingual_v2"\n\n**Caching:**\n- Hash: text + voiceId + settings\n- Cache hit: <50ms (serve existing MP3)\n- Cache miss: ~2-3s (generate new)\n\n**Performance:**\n- Cached: 50-100ms ⚡\n- Fresh: 2000-3000ms\n\n**Cost:** ~$0.30 per 1000 characters'
      },
      {
        id: 'step_greeting_fallback',
        sequence: 25,
        title: '👋 Greeting Fallback (If No Trigger + Greeting Detected)',
        body: '**V125 NEW PATH:** Greeting response when no trigger matched\n\n**File:** Agent2DiscoveryRunner.js:2075 (V125 addition)\n\n**When Used:**\n- Greeting was detected in step 16\n- BUT no trigger matched in step 17\n- This handles pure greetings: "hi", "hello" alone\n\n**Example:**\n```\nInput: "Hi"\nScrabEngine: "" (removed "Hi")\nGreeting: DETECTED (was greeting word)\nTriggers: NO MATCH (empty text)\nPath: GREETING_FALLBACK\nResponse: "Hello! How can I help you?"\n```\n\n**Priority:**\nTriggers > Greeting > LLM > Generic\n\n**Event:** A2_PATH_SELECTED (path: GREETING_ONLY)'
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

  function renderFlowPreview() {
    const sorted = [...state.steps].sort((a, b) => a.sequence - b.sequence);
    
    DOM.flowPreview.innerHTML = sorted.map((step, idx) => {
      return `
        <div class="flow-step">
          <div class="flow-step-num">${step.sequence}</div>
          <div class="flow-step-content">
            <div class="flow-step-title">${escapeHtml(step.title)}</div>
            <div class="flow-step-desc">${getFirstLine(step.body)}</div>
            <div class="flow-step-file">${extractFile(step.body)}</div>
          </div>
        </div>
        ${idx < sorted.length - 1 ? '<div class="flow-arrow">↓</div>' : ''}
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
      version: 'V125',
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
