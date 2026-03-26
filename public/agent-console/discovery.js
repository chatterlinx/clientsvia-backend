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
    // ── [1] Entity Extractor ─────────────────────────────────────────────
    {
      id:       'entity_extractor',
      order:    1,
      icon:     '🧠',
      name:     'Entity Extractor',
      subtitle: 'Fires on Turn 1 — extracts who the caller is and why they called',
      status:   'partial',

      why: 'Before the agent can respond intelligently, it needs to know who is calling and what they want. This stage builds the caller profile that every subsequent stage reads from. Without it, the agent treats every turn as if it knows nothing — leading to repeated questions and wrong responses.',

      engine:   'LLM_INTAKE_TURN_1',
      provider: 'Groq',
      model:    'llama-3.1-70b-versatile',
      fires:    'Turn 1 (primary extraction). Also updates on KC matches (callReason + objective).',
      writesTo: 'discoveryNotes (Redis key: discovery-notes:{companyId}:{callSid}, TTL=4h)',
      wiredIn:  ['services/HybridReceptionistLLM.js', 'services/discoveryNotes/DiscoveryNotesService.js'],
      configIn:  null,
      configUrl: null,

      extracts: [
        { field: 'entities.firstName',  label: 'First Name',         status: 'active'  },
        { field: 'callReason',          label: 'Call Reason',         status: 'active'  },
        { field: 'urgency',             label: 'Urgency',             status: 'active'  },
        { field: 'priorVisit',          label: 'Prior Visit Flag',    status: 'active'  },
        { field: 'sameDayRequested',    label: 'Same Day Request',    status: 'active'  },
        { field: 'callerType',          label: 'Caller Type',         status: 'active'  },
        { field: 'employeeMentioned',   label: 'Employee Mentioned',  status: 'gap'     },
      ],

      gaps: [
        'employeeMentioned: Caller says "Hi John" (greeting an employee by name) but the field is always null. The agent cannot acknowledge prior employee relationships — a missed trust-building opportunity for returning customers.',
      ],

      routing: { always: 'question_detector' },
    },

    // ── [2] Question Detector ────────────────────────────────────────────
    {
      id:       'question_detector',
      order:    2,
      icon:     '❓',
      name:     'Question Detector',
      subtitle: 'Detects if caller asked an answerable question — routes to KC before booking',
      status:   'not_built',

      why: 'Callers do not follow a linear script. They often give a booking signal AND ask a question in the same utterance ("my AC is broken — do you accept credit cards?"). Without this detector, the booking intent wins and the question is silently ignored. The caller gets a booking CTA when they wanted an answer first. This stage fixes that by scanning for KC signals BEFORE the booking intent gate fires.',

      engine:   null,
      provider: null,
      model:    null,
      fires:    'Every turn, before Booking Intent Gate.',
      writesTo: null,
      wiredIn:  [],
      configIn:  null,
      configUrl: null,

      extracts: [],

      gaps: [
        'NOT BUILT: Turn 1 questions embedded in intake utterances are completely ignored. Example from real call: Caller said "Do you accept credit cards?" — agent responded "Can I get someone to look into that for you?" — completely wrong.',
        'Fix needed: Run KNOWLEDGE_SIGNALS scan (from KnowledgeContainerService) on every utterance before the booking intent check. If a KC signal is found, route to KC Answer first, then append booking CTA.',
        'Impact: HIGH — every caller who asks a question on Turn 1 gets the wrong response.',
      ],

      routing: { yes: 'kc_answer', no: 'booking_intent' },
    },

    // ── [3] Booking Intent Gate ──────────────────────────────────────────
    {
      id:       'booking_intent',
      order:    3,
      icon:     '🔒',
      name:     'Booking Intent Gate',
      subtitle: 'Detects pure booking signals — routes straight to booking handoff',
      status:   'partial',

      why: 'When a caller says "yes, let\'s do it" or "I want to schedule" without any question, there is no reason to run KC or LLM — just hand them off to booking immediately. This gate prevents unnecessary Groq calls on clear booking turns. Currently wired on Turn 2+ only (KC engine). NOT wired on Turn 1.',

      engine:   'KCBookingIntentDetector',
      provider: 'Synchronous (no AI)',
      model:    null,
      fires:    'Turn 2+ (KC engine path). NOT active on Turn 1 intake.',
      writesTo: 'discoveryNotes (objective: BOOKING), state.lane = BOOKING',
      wiredIn:  ['services/engine/kc/KCDiscoveryRunner.js — Gate 1', 'services/engine/kc/KCBookingIntentDetector.js'],
      configIn:  'Consent phrases (agent2.html)',
      configUrl: 'agent2.html',

      extracts: [],

      gaps: [
        'NOT wired on Turn 1: If a caller\'s first utterance is a pure booking signal ("just schedule me"), the intake engine runs anyway. Should detect booking intent on Turn 1 and skip straight to handoff.',
      ],

      routing: { yes: 'BOOKING HANDOFF (BookingLogicEngine)', no: 'kc_answer' },
    },

    // ── [4] KC Answer ────────────────────────────────────────────────────
    {
      id:       'kc_answer',
      order:    4,
      icon:     '📦',
      name:     'KC Answer (Knowledge Containers)',
      subtitle: 'Matches caller question to a knowledge container — Groq answers from admin-authored facts',
      status:   'wired',  // enriched dynamically based on container count

      why: 'When a caller asks "how much is a service call?" or "do you offer maintenance plans?", the answer should come from the company\'s own admin-authored content — not from the LLM\'s general knowledge (which could be wrong). This stage matches the caller\'s words to the right container, then Groq answers from that container only. No hallucination. Bounded to facts.',

      engine:   'KnowledgeContainerService + KCDiscoveryRunner',
      provider: 'Groq',
      model:    'llama-3.3-70b-versatile',
      fires:    'Turn 2+ when a KC signal is detected. Turn 1 only once Question Detector is built.',
      writesTo: 'discoveryNotes (callReason updated to container title, qaLog entry added), SPFUQ anchor (Redis)',
      wiredIn:  ['services/engine/kc/KCDiscoveryRunner.js — Gates 3-4', 'services/engine/agent2/KnowledgeContainerService.js'],
      configIn:  'Knowledge Containers (services.html)',
      configUrl: 'services.html',

      extracts: [],

      gaps: [],  // enriched dynamically — shows warning if 0 containers configured

      routing: { yes: 'groq_formatter', no: 'llm_fallback' },
    },

    // ── [5] Groq Response Formatter ──────────────────────────────────────
    {
      id:       'groq_formatter',
      order:    5,
      icon:     '🤖',
      name:     'Groq Response Formatter',
      subtitle: 'Structures the final response: name greeting + problem ack + answer + CTA',
      status:   'partial',

      why: 'A technically correct answer delivered robotically feels wrong on a phone call. This formatter wraps whatever KC answered with a consistent protocol: greet by name if known, acknowledge what the caller mentioned (problem, prior visit, employee), deliver the answer, then close with a natural CTA. It is what makes the agent sound like a person.',

      engine:   'KnowledgeContainerService._buildSystemPrompt() + HybridReceptionistLLM system prompt',
      provider: 'Groq (instruction layer, not a separate LLM call)',
      model:    null,
      fires:    'Applied to every KC answer and LLM intake response.',
      writesTo: null,
      wiredIn:  ['services/engine/agent2/KnowledgeContainerService.js — _buildSystemPrompt()', 'services/HybridReceptionistLLM.js — Rules 1, 2, 8, 14'],
      configIn:  null,
      configUrl: null,

      extracts: [],

      gaps: [
        'employeeMentioned acknowledgement missing: Caller says "Hi John" — agent cannot say "I\'ll note you\'ve worked with John before." Field is null (see Entity Extractor gap).',
        'priorVisit acknowledgement in KC path: HybridReceptionistLLM correctly says "I see we\'ve worked with you before" but KC engine does not — if a returning customer asks a question on Turn 2+, their prior visit is not acknowledged.',
        'Not UI-configurable: The greeting/ack/CTA protocol is hardcoded in system prompts. No admin can adjust the format without a code change.',
      ],

      routing: { always: 'response_delivered' },
    },

    // ── [6] LLM Fallback ─────────────────────────────────────────────────
    {
      id:       'llm_fallback',
      order:    6,
      icon:     '🔮',
      name:     'LLM Fallback',
      subtitle: 'Claude handles complex questions KC could not answer',
      status:   'wired',

      why: 'No matter how good the KC containers are, some questions will not match any container. Rather than returning a canned "I don\'t know", this stage calls Claude (bucket=COMPLEX) with the full discoveryNotes context. Claude can reason across multiple topics and handle edge cases. It is the safety net that keeps the agent from being silent.',

      engine:   'callLLMAgentForFollowUp (Agent2DiscoveryRunner)',
      provider: 'Claude (Anthropic)',
      model:    'Reads from company LLM config',
      fires:    'When KC Answer returns NO_DATA or ERROR.',
      writesTo: null,
      wiredIn:  ['services/engine/kc/KCDiscoveryRunner.js — _handleLLMFallback()', 'services/engine/agent2/Agent2DiscoveryRunner.js — callLLMAgentForFollowUp()'],
      configIn:  null,
      configUrl: null,

      extracts: [],
      gaps:     [],

      routing: { yes: 'response_delivered', no: 'graceful_ack' },
    },

    // ── [7] Graceful ACK ─────────────────────────────────────────────────
    {
      id:       'graceful_ack',
      order:    7,
      icon:     '🆗',
      name:     'Graceful ACK',
      subtitle: 'Last resort — canned acknowledgement when all AI paths are unavailable',
      status:   'wired',

      why: 'If both KC and Claude are unavailable (network timeout, API key missing, etc.), the caller should not hear silence or an error. This stage returns a pre-written acknowledgement that buys time for a follow-up. It is the final safety net.',

      engine:   'Static response (no AI)',
      provider: null,
      model:    null,
      fires:    'Only when KC Answer + LLM Fallback both fail.',
      writesTo: null,
      wiredIn:  ['services/engine/kc/KCDiscoveryRunner.js — _handleLLMFallback() graceful path'],
      configIn:  'Fallback Response (services.html knowledge settings)',
      configUrl: 'services.html',

      extracts: [],
      gaps:     [],

      routing: { always: 'response_delivered' },
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
    traceOutput:       document.getElementById('dp-trace-output'),
  };

  /* =========================================================================
     MODULE: STATE
     ========================================================================= */

  const state = {
    companyId:    null,
    companyName:  '',
    pipelineData: null,   // raw API response
    stages:       [],     // enriched PIPELINE_STAGES after API merge
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

      // KC Answer: warn if no containers configured
      if (stage.id === 'kc_answer') {
        const count = apiData.pipeline?.kcContainerCount ?? 0;
        if (count === 0) {
          enriched.status = 'partial';
          enriched.gaps.push(
            `No Knowledge Containers configured. KC Answer cannot match any question — every caller question falls to LLM Fallback. Add containers in Services to enable KC answers.`
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
          enriched.gaps.push('No consent phrases configured — booking intent detection may be unreliable.');
        }
      }

      return enriched;
    });
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

    // ── Config link ────────────────────────────────────────────────────
    const configLinkHtml = stage.configUrl
      ? `<div class="dp-section">
           <a class="dp-config-link" href="${esc(stage.configUrl)}?companyId=${esc(state.companyId)}">
             ⚙️ Configure in ${esc(stage.configIn || stage.configUrl)}
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

  /** Render the full pipeline (all cards + connectors). */
  function renderPipeline(stages) {
    let html = '';

    stages.forEach((stage, idx) => {
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
     Main data flow:
       1. API.getPipelineStatus() → raw data
       2. enrichStages(data)      → PIPELINE_STAGES + dynamic info
       3. renderPipeline()        → cards in DOM
       4. renderStatsBar()        → pill counts
       5. renderNotesPanel()      → sidebar discoveryNotes
       6. renderNotesModal()      → modal (populated but not shown yet)
     ========================================================================= */

  async function loadAndRender() {
    try {
      const data = await API.getPipelineStatus(state.companyId);
      state.pipelineData = data;

      // Update header
      state.companyName = data.companyName || state.companyId;
      DOM.headerCompanyName.textContent = state.companyName;

      // Merge static stage definitions with dynamic API data
      state.stages = enrichStages(data);

      // Render everything
      renderStatsBar(state.stages, data);
      renderPipeline(state.stages);

      // Merge schema with API gap data
      const apiFields = data.discoveryNotes?.fields || [];
      const schema = DISCOVERY_NOTES_SCHEMA.map(field => {
        const apiField = apiFields.find(f => f.key === field.key);
        return apiField ? { ...field, status: apiField.status, source: apiField.source } : field;
      });
      renderNotesPanel(schema);
      renderNotesModal(schema, data.discoveryNotes?.gaps || []);

    } catch (err) {
      console.error('[Discovery] Load failed:', err);
      DOM.pipelineContainer.innerHTML = `
        <div class="dp-gap-item">
          <span class="dp-gap-icon">⚠️</span>
          <span>Failed to load pipeline status. Check that you are logged in and the companyId is valid.</span>
        </div>
      `;
      DOM.statsBar.innerHTML = '';
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
      TRACE_ANALYZER.render(analysis);
    });

    // ── ESC to close modals ───────────────────────────────────────────
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        MODAL.close(DOM.modalNotes);
      }
    });

    // ── Load pipeline data ────────────────────────────────────────────
    loadAndRender();
  }

  document.addEventListener('DOMContentLoaded', init);

})();
