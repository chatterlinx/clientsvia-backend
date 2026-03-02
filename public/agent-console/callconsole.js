/**
 * ============================================================================
 * CALL CONSOLE — ENTERPRISE CALL REVIEW CONTROLLER
 * ClientVia Platform · Clean Architecture · Production Grade
 * 
 * ============================================================================
 * PURPOSE:
 * Diagnose calls, review transcripts, and trace provenance of agent speech.
 * Critical for multi-tenant compliance: ALL agent responses MUST be UI-driven.
 * 
 * ============================================================================
 * ARCHITECTURE:
 * - IIFE pattern for scope isolation
 * - Modular state management
 * - Clear separation of concerns (Data, UI, Events)
 * - Comprehensive error handling
 * 
 * ============================================================================
 * PROVENANCE SYSTEM:
 * Every agent turn is classified:
 * - UI-OWNED:   Response text comes from a UI-configured field
 * - FALLBACK:   Emergency fallback with proper logging (allowed)
 * - HARDCODED:  VIOLATION — Text not traced to UI (forbidden)
 * - CALLER:     Caller speech (no provenance needed)
 * 
 * ============================================================================
 * @module callconsole
 * @version 1.0.0
 * @date February 2026
 * ============================================================================
 */

(function() {
  'use strict';

  /* ==========================================================================
     SECTION 1: CONFIGURATION
     ========================================================================== */
  
  const CONFIG = {
    API_BASE: '/api/agent-console',
    PAGE_SIZE: 25,
    BUILD_VERSION: '1.0.0',
    
    /** Provenance type definitions for display and styling */
    PROVENANCE_TYPES: {
      UI_OWNED: {
        label: 'UI-Owned',
        badgeClass: 'provenance-badge-clean',
        icon: '✓',
        description: 'Response from UI configuration'
      },
      FALLBACK: {
        label: 'Fallback',
        badgeClass: 'provenance-badge-warning',
        icon: '⚠',
        description: 'Emergency fallback (logged)'
      },
      HARDCODED: {
        label: 'HARDCODED',
        badgeClass: 'provenance-badge-violation',
        icon: '🚨',
        description: 'VIOLATION: Not UI-driven'
      },
      UNKNOWN: {
        label: 'Unknown',
        badgeClass: 'provenance-badge-warning',
        icon: '?',
        description: 'Source could not be determined'
      }
    },

    /** Human-readable labels for internal turn.kind codes */
    KIND_LABELS: {
      'GREETING': 'Greeting',
      'CONVERSATION_AGENT': 'Response',
      'TRIGGER_CARD': 'Trigger Card',
      'TRIGGER_FOLLOWUP': 'Follow-up Question',
      'CONSENT_GATE': 'Consent Gate',
      'BRIDGE_FILLER': 'Bridge (Filler)',
      'RECOVERY': 'Recovery',
      'LLM_FALLBACK': 'LLM Fallback',
      'BOOKING_PROMPT': 'Booking',
      'TRANSFER': 'Transfer',
      'TWIML_PLAY': 'Audio Played',
      'TWIML_SAY': 'TTS Spoken',
      'STT_EMPTY': 'No Speech Detected',
      'ESCALATION': 'Escalation',
      'PATIENCE_WAIT': 'Patience (Waiting)',
      'PATIENCE_CHECKIN': 'Patience Check-in',
      'PATIENCE_FINAL_CHECKIN': 'Patience Final Check-in',
      // Phase 4 — Agent2CallRouter
      'A2_CALL_ROUTER_CLASSIFIED': 'Call Router: Intent Classified',
      'A2_CALL_ROUTER_POOL_FILTERED': 'Call Router: Trigger Pool Filtered',
      'A2_CALL_ROUTER_RETRY_FULL_POOL': 'Call Router: Retry Full Pool',
      // Phase 1–2 — Trigger system visibility
      'TRIGGER_POOL_EMPTY': 'Trigger Pool EMPTY',
      'TRIGGER_POOL_SOURCE': 'Trigger Pool Source',
      'TRIGGER_CARDS_EVALUATED': 'Trigger Cards Evaluated',
      'A2_TRIGGER_EVAL': 'Trigger Evaluation',
      'A2_RESPONSE_READY': 'Response Ready',
      'A2_PATH_SELECTED': 'Path Selected',
      'A2_FOLLOWUP_CONSENT_CLASSIFIED': 'Follow-Up Consent Classified',
      'A2_PENDING_QUESTION_RESOLVED': 'Pending Question Resolved'
    },

    /** UI Tab mapping for provenance links */
    UI_TAB_MAP: {
      'aiAgentSettings.agent2.greetings.callStart': { page: 'agent2.html', tab: 'greetings', section: 'Call Start' },
      'aiAgentSettings.agent2.greetings.callStart.emergencyFallback': { page: 'agent2.html', tab: 'greetings', section: 'Call Start (Emergency Fallback)' },
      'agent2.greetings.callStart': { page: 'agent2.html', tab: 'greetings', section: 'Call Start' },
      'agent2.greetings.callStart.emergencyFallback': { page: 'agent2.html', tab: 'greetings', section: 'Call Start (Emergency Fallback)' },
      'greetings.callStart': { page: 'agent2.html', tab: 'greetings', section: 'Call Start' },
      'greetings.interceptor': { page: 'agent2.html', tab: 'greetings', section: 'Interceptor' },
      'discovery.recoveryMessages': { page: 'agent2.html', tab: 'recovery', section: 'Recovery Messages' },
      'discovery.fallbackMessages': { page: 'agent2.html', tab: 'fallback', section: 'Fallback Messages' },
      'aiAgentSettings.agent2.bridge': { page: 'agent2.html', tab: 'bridge', section: 'Bridge (Latency Filler)' },
      'aiAgentSettings.agent2.discovery': { page: 'agent2.html', tab: 'discovery', section: 'Discovery' },
      'agent2.bridge': { page: 'agent2.html', tab: 'bridge', section: 'Bridge (Latency Filler)' },
      'agent2.discovery': { page: 'agent2.html', tab: 'discovery', section: 'Discovery' },
      'aiAgentSettings.connectionMessages': { page: 'agent2.html', tab: 'greetings', section: 'Connection Messages' },
      'triggers': { page: 'triggers.html', tab: 'triggers', section: 'Trigger Cards' },
      'bookingPrompts': { page: 'booking.html', tab: 'prompts', section: 'Booking Prompts' },
      'bookingLogic': { page: 'booking.html', tab: 'logic', section: 'Booking Logic' },
      'globalHub.vocabulary': { page: 'global-hub.html', tab: 'vocabulary', section: 'Vocabulary' },
      'scrabengine': { page: 'scrabengine.html', tab: 'vocabulary', section: 'ScrabEngine Config' },
      'aiAgentSettings.scrabEngine': { page: 'scrabengine.html', tab: 'vocabulary', section: 'ScrabEngine Config' },
      'triggers': { page: 'triggers.html', tab: 'triggers', section: 'Trigger Cards' },
      'callRouter': { page: 'triggers.html', tab: 'router', section: 'Call Router Config' }
    }
  };

  /* ==========================================================================
     SECTION 2: STATE MANAGEMENT
     ========================================================================== */
  
  const state = {
    /** Company context */
    companyId: null,
    companyName: null,

    /** Call list data */
    calls: [],
    totalCalls: 0,
    currentPage: 1,
    totalPages: 1,

    /** Filters */
    filters: {
      search: '',
      status: '',
      dateRange: 'week'
    },

    /** Selected call for detail view */
    selectedCall: null,

    /** Selected calls for bulk operations */
    selectedCallSids: new Set(),

    /** UI state */
    isLoading: false,
    isModalOpen: false,
    isModalFullscreen: false
  };

  const pathNamespace = (typeof window !== 'undefined' && window.Agent2PathNamespace)
    ? window.Agent2PathNamespace
    : null;

  /* ==========================================================================
     SECTION 3: DOM REFERENCES
     ========================================================================== */
  
  const DOM = {
    // Header
    headerCompanyName: document.getElementById('header-company-name'),
    headerCompanyId: document.getElementById('header-company-id'),
    headerLogoLink: document.getElementById('header-logo-link'),
    btnBackToDashboard: document.getElementById('btn-back-to-dashboard'),
    btnLogout: document.getElementById('btn-logout'),
    btnExportCalls: document.getElementById('btn-export-calls'),

    // Page controls
    btnBack: document.getElementById('btn-back'),
    btnRefreshCalls: document.getElementById('btn-refresh-calls'),
    btnFlowBuilder: document.getElementById('btn-flow-builder'),

    // Filters
    filterSearch: document.getElementById('filter-search'),
    filterStatus: document.getElementById('filter-status'),
    filterDate: document.getElementById('filter-date'),
    btnClearFilters: document.getElementById('btn-clear-filters'),

    // Call list
    callListBody: document.getElementById('call-list-body'),
    callCount: document.getElementById('call-count'),

    // Bulk selection
    selectAllCheckbox: document.getElementById('select-all-checkbox'),
    bulkActionsBar: document.getElementById('bulk-actions-bar'),
    bulkActionsCount: document.getElementById('bulk-actions-count'),
    btnClearSelection: document.getElementById('btn-clear-selection'),
    btnDeleteSelected: document.getElementById('btn-delete-selected'),

    // Pagination
    paginationContainer: document.getElementById('pagination-container'),
    paginationInfo: document.getElementById('pagination-info'),
    btnPrevPage: document.getElementById('btn-prev-page'),
    btnNextPage: document.getElementById('btn-next-page'),

    // Modal
    callDetailModal: document.getElementById('call-detail-modal'),
    modalBody: document.getElementById('modal-body'),
    modalClose: document.getElementById('modal-close'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    btnDownloadCall: document.getElementById('btn-download-call'),
    btnToggleFullscreen: document.getElementById('btn-toggle-fullscreen'),

    // Toast
    toastContainer: document.getElementById('toast-container'),

    // Footer
    footerEnvironment: document.getElementById('footer-environment')
  };

  /* ==========================================================================
     SECTION 4: INITIALIZATION
     ========================================================================== */
  
  /**
   * Initialize the Call Console
   * Validates auth, extracts company context, sets up event listeners, loads data
   */
  function init() {
    if (!AgentConsoleAuth.requireAuth()) {
      return;
    }

    extractCompanyId();

    if (!state.companyId) {
      showToast('error', 'Missing Company ID', 'No companyId found in URL. Redirecting...');
      setTimeout(() => {
        window.location.href = '/directory.html';
      }, 2000);
      return;
    }

    setupEventListeners();
    updateFooter();
    loadCompanyInfo();
    loadCalls();
  }

  /**
   * Extract companyId from URL query parameters
   */
  function extractCompanyId() {
    const params = new URLSearchParams(window.location.search);
    state.companyId = params.get('companyId');

    if (state.companyId) {
      DOM.headerCompanyId.textContent = truncateId(state.companyId);
      DOM.headerCompanyId.title = state.companyId;

      if (DOM.headerLogoLink) {
        DOM.headerLogoLink.href = `/agent-console/index.html?companyId=${encodeURIComponent(state.companyId)}`;
      }
    }
  }

  /**
   * Truncate long IDs for display
   * @param {string} id - The ID to truncate
   * @returns {string} Truncated ID
   */
  function truncateId(id) {
    if (!id || id.length <= 12) return id;
    return `${id.slice(0, 6)}...${id.slice(-4)}`;
  }

  /* ==========================================================================
     SECTION 5: EVENT LISTENERS
     ========================================================================== */
  
  function setupEventListeners() {
    // Navigation
    const navigateToDashboard = () => navigateTo('dashboard');
    const navigateToCompanyProfile = () => {
      window.location.href = `/company-profile.html?companyId=${encodeURIComponent(state.companyId)}`;
    };

    DOM.btnBack.addEventListener('click', navigateToDashboard);
    DOM.btnBackToDashboard.addEventListener('click', navigateToDashboard);
    DOM.btnLogout.addEventListener('click', navigateToCompanyProfile);

    // Refresh
    DOM.btnRefreshCalls.addEventListener('click', () => loadCalls());
    
    if (DOM.btnFlowBuilder) {
      DOM.btnFlowBuilder.addEventListener('click', () => {
        window.location.href = `/agent-console/flow-builder.html?companyId=${state.companyId}`;
      });
    }

    // Filters
    DOM.filterSearch.addEventListener('input', debounce(handleFilterChange, 300));
    DOM.filterStatus.addEventListener('change', handleFilterChange);
    DOM.filterDate.addEventListener('change', handleFilterChange);
    DOM.btnClearFilters.addEventListener('click', clearFilters);

    // Pagination
    DOM.btnPrevPage.addEventListener('click', () => goToPage(state.currentPage - 1));
    DOM.btnNextPage.addEventListener('click', () => goToPage(state.currentPage + 1));

    // Bulk selection
    DOM.selectAllCheckbox.addEventListener('change', handleSelectAll);
    DOM.btnClearSelection.addEventListener('click', clearSelection);
    // Avoid long "click handler took Xms" violations by not awaiting network work
    // inside the event callback. (The async function still runs; the UI thread is freed.)
    DOM.btnDeleteSelected.addEventListener('click', () => {
      setTimeout(() => {
        deleteSelectedCalls().catch(err => {
          console.error('[CallConsole] Failed to delete calls:', err);
          showToast('error', 'Delete Failed', err.message || 'Could not delete selected calls.');
        });
      }, 0);
    });

    // Modal
    DOM.modalClose.addEventListener('click', closeModal);
    DOM.btnCloseModal.addEventListener('click', closeModal);
    DOM.btnDownloadCall.addEventListener('click', downloadCallReport);
    if (DOM.btnToggleFullscreen) {
      DOM.btnToggleFullscreen.addEventListener('click', toggleModalFullscreen);
    }
    DOM.callDetailModal.addEventListener('click', (e) => {
      if (e.target === DOM.callDetailModal) closeModal();
    });

    // Export
    DOM.btnExportCalls.addEventListener('click', exportCalls);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.isModalOpen) {
        closeModal();
      }
    });
  }

  /* ==========================================================================
     SECTION 6: DATA LOADING
     ========================================================================== */
  
  /**
   * Load company info from the truth endpoint
   */
  async function loadCompanyInfo() {
    try {
      const truth = await AgentConsoleAuth.apiFetch(`${CONFIG.API_BASE}/${state.companyId}/truth`);
      state.companyName = truth?.companyProfile?.companyName || 
                          truth?.companyProfile?.businessName || 
                          'Unknown Company';
      DOM.headerCompanyName.textContent = state.companyName;
    } catch (error) {
      console.error('[CallConsole] Failed to load company info:', error);
      DOM.headerCompanyName.textContent = 'Company';
    }
  }

  /**
   * Load calls with current filters and pagination
   */
  async function loadCalls() {
    setLoading(true);

    try {
      const params = new URLSearchParams({
        page: state.currentPage.toString(),
        limit: CONFIG.PAGE_SIZE.toString(),
        dateRange: state.filters.dateRange
      });

      if (state.filters.search) {
        params.set('search', state.filters.search);
      }
      if (state.filters.status) {
        params.set('status', state.filters.status);
      }

      const response = await AgentConsoleAuth.apiFetch(
        `${CONFIG.API_BASE}/${state.companyId}/calls?${params.toString()}`
      );

      state.calls = response.calls || [];
      state.totalCalls = response.total || 0;
      state.totalPages = Math.ceil(state.totalCalls / CONFIG.PAGE_SIZE) || 1;

      renderCallList();
      updatePagination();
    } catch (error) {
      console.error('[CallConsole] Failed to load calls:', error);
      showToast('error', 'Load Failed', 'Could not load call list. Please try again.');
      renderEmptyState('Error loading calls');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Load detailed call data for the modal
   * @param {string} callSid - The CallSid to load
   */
  async function loadCallDetails(callSid) {
    try {
      const response = await AgentConsoleAuth.apiFetch(
        `${CONFIG.API_BASE}/${state.companyId}/calls/${callSid}`
      );

      // Canonical shape:
      // - { callMeta, turns[], trace[], flags[] }
      // Back-compat:
      // - flat { callSid, fromPhone, ..., turns: [] }
      // - nested { call: { ... }, turns: [] }
      const callMeta = response?.callMeta && typeof response.callMeta === 'object' ? response.callMeta : null;
      const legacyCall = response?.call && typeof response.call === 'object' ? response.call : response;

      const turns = response?.turns || legacyCall?.turns || [];
      const trace = response?.trace || legacyCall?.trace || [];
      const flags = response?.flags || legacyCall?.flags || [];
      const events = response?.events || legacyCall?.events || [];
      const problems = response?.problems || legacyCall?.problems || [];

      state.selectedCall = {
        ...(legacyCall || {}),
        ...(callMeta || {}),
        turns,
        trace,
        flags,
        events,
        problems
      };
      renderCallDetail();
      openModal();
    } catch (error) {
      console.error('[CallConsole] Failed to load call details:', error);
      showToast('error', 'Load Failed', 'Could not load call details.');
    }
  }

  /* ==========================================================================
     SECTION 7: RENDERING — CALL LIST
     ========================================================================== */
  
  /**
   * Render the call list table
   */
  function renderCallList() {
    // Clear selection when re-rendering
    clearSelection();

    if (state.calls.length === 0) {
      renderEmptyState('No calls found');
      DOM.callCount.textContent = '0 calls';
      return;
    }

    DOM.callCount.textContent = `${state.totalCalls} call${state.totalCalls !== 1 ? 's' : ''}`;

    const rows = state.calls.map(call => renderCallRow(call)).join('');
    DOM.callListBody.innerHTML = rows;

    // Attach click handlers for row (but not checkbox)
    DOM.callListBody.querySelectorAll('tr[data-callsid]').forEach(row => {
      // Click on row (except checkbox) opens detail
      row.addEventListener('click', (e) => {
        if (e.target.type === 'checkbox') return;
        const callSid = row.dataset.callsid;
        loadCallDetails(callSid);
      });

      // Checkbox change handler
      const checkbox = row.querySelector('.call-checkbox');
      if (checkbox) {
        checkbox.addEventListener('change', (e) => {
          e.stopPropagation();
          handleRowCheckboxChange(row, checkbox.checked);
        });
      }
    });
  }

  /**
   * Render a single call row
   * @param {Object} call - Call data object
   * @returns {string} HTML string for the row
   */
  function renderCallRow(call) {
    const time = formatTime(call.startTime);
    const duration = formatDuration(call.durationSeconds);
    const turns = call.turnCount || 0;
    const problems = call.problemCount || 0;
    const hasViolations = call.hasHardcodedViolation || false;
    const isSelected = state.selectedCallSids.has(call.callSid);

    // Determine provenance badge
    let provenanceBadge;
    if (hasViolations) {
      provenanceBadge = `<span class="provenance-badge provenance-badge-violation">🚨 HARDCODED</span>`;
    } else if (call.hasFallback) {
      provenanceBadge = `<span class="provenance-badge provenance-badge-warning">⚠ Fallback Used</span>`;
    } else {
      provenanceBadge = `<span class="provenance-badge provenance-badge-clean">✓ UI-Owned</span>`;
    }

    // Problems badge
    const problemsBadge = problems > 0
      ? `<span class="problems-count problems-some">${problems}</span>`
      : `<span class="problems-count problems-none">0</span>`;

    return `
      <tr data-callsid="${escapeHtml(call.callSid)}" class="${isSelected ? 'selected' : ''}">
        <td>
          <input type="checkbox" class="call-checkbox" ${isSelected ? 'checked' : ''} title="Select this call">
        </td>
        <td class="call-time">${escapeHtml(time)}</td>
        <td class="call-phone">${escapeHtml(formatPhone(call.fromPhone))}</td>
        <td class="call-duration">${escapeHtml(duration)}</td>
        <td>${turns}</td>
        <td>${provenanceBadge}</td>
        <td>${problemsBadge}</td>
        <td class="call-sid">${escapeHtml(truncateId(call.callSid))}</td>
      </tr>
    `;
  }

  /**
   * Render empty state for the call list
   * @param {string} message - Message to display
   */
  function renderEmptyState(message) {
    DOM.callListBody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty-state">
            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22 16.92V19.92C22 20.47 21.55 20.92 21 20.92H3C2.45 20.92 2 20.47 2 19.92V16.92" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M12 3V15M12 15L8 11M12 15L16 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <h3 class="empty-state-title">${escapeHtml(message)}</h3>
            <p class="empty-state-description">Calls will appear here once they are processed. Try adjusting your filters or check back later.</p>
          </div>
        </td>
      </tr>
    `;
  }

  /* ==========================================================================
     SECTION 8: RENDERING — CALL DETAIL MODAL
     ========================================================================== */
  
  /**
   * Render the call detail view in the modal
   */
  function renderCallDetail() {
    if (!state.selectedCall) return;

    const call = state.selectedCall;
    const violations = countViolations(call.turns || []);
    const fallbacks = countFallbacks(call.turns || []);

    DOM.modalBody.innerHTML = `
      <!-- Call Info Header -->
      <div class="call-detail-header">
        <div class="call-info-card">
          <h4>Call Information</h4>
          <div class="call-info-grid">
            <span class="call-info-label">From:</span>
            <span class="call-info-value">${escapeHtml(formatPhone(call.fromPhone))}</span>
            
            <span class="call-info-label">To:</span>
            <span class="call-info-value">${escapeHtml(formatPhone(call.toPhone))}</span>
            
            <span class="call-info-label">Time:</span>
            <span class="call-info-value">${escapeHtml(formatDateTime(call.startTime))}</span>
            
            <span class="call-info-label">Duration:</span>
            <span class="call-info-value">${escapeHtml(formatDuration(call.durationSeconds))}</span>
            
            <span class="call-info-label">CallSid:</span>
            <span class="call-info-value mono">${escapeHtml(call.callSid)}</span>
          </div>
        </div>
        
        <div class="call-info-card">
          <h4>LLM Token Usage</h4>
          <div class="llm-stats">
            <div class="llm-stat">
              <div class="llm-stat-value">${call.llmUsage?.promptTokens || 0}</div>
              <div class="llm-stat-label">Prompt</div>
            </div>
            <div class="llm-stat">
              <div class="llm-stat-value">${call.llmUsage?.completionTokens || 0}</div>
              <div class="llm-stat-label">Completion</div>
            </div>
            <div class="llm-stat">
              <div class="llm-stat-value">${call.llmUsage?.totalTokens || 0}</div>
              <div class="llm-stat-label">Total</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Problems Section -->
      ${renderProblemsSection(call, violations, fallbacks)}

      <!-- DIAGNOSTIC ROADMAP - Complete sequence path visualization -->
      ${renderDiagnosticRoadmap(call)}

      <!-- ScrabEngine Timeline -->
      ${renderScrabEngineSection(call)}

      <!-- Transcript -->
      <div class="transcript-container">
        <div class="transcript-header">
          <span class="transcript-title">Turn-by-Turn Transcript (${call.turns?.length || 0} turns)</span>
          <div class="transcript-legend">
            <div class="legend-item">
              <span class="legend-dot ui-owned"></span>
              UI-Owned
            </div>
            <div class="legend-item">
              <span class="legend-dot fallback"></span>
              Fallback
            </div>
            <div class="legend-item">
              <span class="legend-dot hardcoded"></span>
              Hardcoded
            </div>
            <div class="legend-item">
              <span class="legend-dot caller"></span>
              Caller
            </div>
          </div>
        </div>
        <div class="transcript-body">
          ${renderTranscript(call.turns || [], buildScrabByTurnMap(call))}
        </div>
      </div>

      <!-- Events Log -->
      ${renderEventsSection(call.events || [])}
    `;

    // Attach event listeners for collapsible sections
    const eventsToggle = DOM.modalBody.querySelector('.events-toggle');
    const eventsList = DOM.modalBody.querySelector('.events-list');
    if (eventsToggle && eventsList) {
      eventsToggle.addEventListener('click', () => {
        eventsToggle.classList.toggle('open');
        eventsList.classList.toggle('open');
      });
    }
  }

  /**
   * Render the problems section
   * @param {Object} call - Call data
   * @param {number} violations - Count of hardcoded violations
   * @param {number} fallbacks - Count of fallback usages
   * @returns {string} HTML string
   */
  function renderProblemsSection(call, violations, fallbacks) {
    const problems = call.problems || [];
    const turns = call.turns || [];
    const agentTurns = turns.filter(t => t.speaker === 'agent').length;
    const callerTurns = turns.filter(t => t.speaker === 'caller').length;
    const hasIssues = violations > 0 || problems.length > 0;
    const flags = Array.isArray(call.flags) ? call.flags : [];

    // ═══════════════════════════════════════════════════════════════════════════
    // INCOMPLETE CALL DETECTION
    // ═══════════════════════════════════════════════════════════════════════════
    // If there are 0 turns total, the call recording is incomplete.
    // This happens when the call ended before any conversational data was captured
    // (e.g., immediate hangup, webhook failure, STT never fired).
    // NEVER show "All Clear" when there's nothing to verify.
    // ═══════════════════════════════════════════════════════════════════════════
    if (turns.length === 0) {
      return `
        <div class="problems-section" style="background: #fef3c7; border-color: #f59e0b;">
          <h4 style="color: #b45309;">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 2L14 13H2L8 2Z" stroke="#b45309" stroke-width="1.5" stroke-linejoin="round"/>
              <path d="M8 6V9M8 11.5V12" stroke="#b45309" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            INCOMPLETE CALL — No Conversational Data Captured
          </h4>
          <p style="font-size: 13px; color: #92400e;">
            This call has no transcript data. The call may have ended immediately, 
            or the speech recognition/agent pipeline did not produce any turns.
          </p>
          <div style="margin-top: 8px; font-size: 12px; color: #92400e;">
            <div><strong>Duration:</strong> ${formatDuration(call.durationSeconds)}</div>
            <div><strong>STT segments received:</strong> 0</div>
            <div><strong>Agent turns generated:</strong> 0</div>
            <div><strong>Provenance verification:</strong> Not possible (no data)</div>
          </div>
        </div>
      `;
    }

    // Incomplete: no agent responses at all (telephony actions may exist)
    if (flags.includes('INCOMPLETE_NO_AGENT_TURNS')) {
      return `
        <div class="problems-section" style="background: #fef3c7; border-color: #f59e0b;">
          <h4 style="color: #b45309;">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 2L14 13H2L8 2Z" stroke="#b45309" stroke-width="1.5" stroke-linejoin="round"/>
              <path d="M8 6V9M8 11.5V12" stroke="#b45309" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            INCOMPLETE — No Agent Responses Captured
          </h4>
          <p style="font-size: 13px; color: #92400e;">
            This call contains telephony/system actions, but no agent conversation turns were recorded.
          </p>
        </div>
      `;
    }

    // Diagnostics: STT empty (explains missing caller lines)
    if (flags.includes('DIAG_STT_EMPTY')) {
      return `
        <div class="problems-section" style="background: #fef3c7; border-color: #f59e0b;">
          <h4 style="color: #b45309;">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 2L14 13H2L8 2Z" stroke="#b45309" stroke-width="1.5" stroke-linejoin="round"/>
              <path d="M8 6V9M8 11.5V12" stroke="#b45309" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            DIAGNOSTIC — STT Returned Empty (No Caller Transcript)
          </h4>
          <p style="font-size: 13px; color: #92400e;">
            Speech-to-text returned an empty SpeechResult for at least one turn. This explains missing caller lines.
          </p>
        </div>
      `;
    }

    // UNVERIFIED CALL DETECTION (provenance missing anywhere)
    // Enterprise rule: if any agent turn lacks provenance, we cannot certify compliance.
    if (flags.includes('UNVERIFIED_MISSING_PROVENANCE')) {
      return `
        <div class="problems-section" style="background: #fef3c7; border-color: #f59e0b;">
          <h4 style="color: #b45309;">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 2L14 13H2L8 2Z" stroke="#b45309" stroke-width="1.5" stroke-linejoin="round"/>
              <path d="M8 6V9M8 11.5V12" stroke="#b45309" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            UNVERIFIED — Missing Provenance Evidence
          </h4>
          <p style="font-size: 13px; color: #92400e;">
            One or more agent turns are missing a provenance/decision trace pack. This call cannot be certified as UI-owned.
          </p>
        </div>
      `;
    }

    // PARTIAL CALL DETECTION (transcript exists, trace missing)
    // If the backend flags trace gaps, NEVER show "All Clear".
    if (flags.includes('PARTIAL_MISSING_TRACE')) {
      return `
        <div class="problems-section" style="background: #fef3c7; border-color: #f59e0b;">
          <h4 style="color: #b45309;">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 2L14 13H2L8 2Z" stroke="#b45309" stroke-width="1.5" stroke-linejoin="round"/>
              <path d="M8 6V9M8 11.5V12" stroke="#b45309" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            PARTIAL — Transcript Captured, Trace Missing
          </h4>
          <p style="font-size: 13px; color: #92400e;">
            This call has conversational turns, but one or more agent turns are missing provenance/trace data.
            Provenance verification is incomplete — do not treat this as compliant.
          </p>
        </div>
      `;
    }

    // If there are caller turns but no agent turns, the agent never responded
    if (callerTurns > 0 && agentTurns === 0) {
      return `
        <div class="problems-section" style="background: #fef3c7; border-color: #f59e0b;">
          <h4 style="color: #b45309;">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 2L14 13H2L8 2Z" stroke="#b45309" stroke-width="1.5" stroke-linejoin="round"/>
              <path d="M8 6V9M8 11.5V12" stroke="#b45309" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            NO RESPONSE GENERATED — Agent Pipeline Failed
          </h4>
          <p style="font-size: 13px; color: #92400e;">
            The caller spoke (${callerTurns} turn${callerTurns !== 1 ? 's' : ''}) but no agent responses were generated.
            The agent runtime may have failed or the call ended before a response was sent.
          </p>
        </div>
      `;
    }

    if (!hasIssues) {
      return `
        <div class="problems-section clean">
          <h4>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="8" cy="8" r="6" stroke="#16a34a" stroke-width="1.5"/>
              <path d="M5.5 8L7 9.5L10.5 6" stroke="#16a34a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            All Clear — No Violations Detected
          </h4>
          <p style="font-size: 13px; color: var(--color-success-600);">
            All ${agentTurns} agent response${agentTurns !== 1 ? 's' : ''} properly traced to UI configurations.
            ${fallbacks > 0 ? `(${fallbacks} fallback${fallbacks !== 1 ? 's' : ''} used, but logged correctly)` : ''}
          </p>
        </div>
      `;
    }

    let problemItems = '';

    // Add violation alerts
    if (violations > 0) {
      const violationTurns = (call.turns || [])
        .filter(t => t.provenance?.type === 'HARDCODED')
        .map(t => t.turnNumber);
      
      problemItems += `
        <div class="problem-item">
          <span class="problem-text">🚨 ${violations} HARDCODED violation${violations !== 1 ? 's' : ''} in turn${violations !== 1 ? 's' : ''} ${violationTurns.join(', ')}</span>
          <a href="#" class="problem-fix-link" data-action="scroll-to-violation">View in transcript</a>
        </div>
      `;
    }

    // Add other problems
    problems.forEach(problem => {
      const fixLink = problem.uiPath ? buildUILink(problem.uiPath) : null;
      problemItems += `
        <div class="problem-item">
          <span class="problem-text">${escapeHtml(problem.message)}</span>
          ${fixLink ? `<a href="${fixLink.href}" class="problem-fix-link" target="_blank">Fix in ${fixLink.label}</a>` : ''}
        </div>
      `;
    });

    return `
      <div class="problems-section">
        <h4>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 2L14 13H2L8 2Z" stroke="#dc2626" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M8 6V9M8 11.5V12" stroke="#dc2626" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          ${violations + problems.length} Problem${violations + problems.length !== 1 ? 's' : ''} Detected
        </h4>
        ${problemItems}
      </div>
    `;
  }

  /**
   * Build a map of ScrabEngine events grouped by turn number.
   * @param {Object} call - Full call payload
   * @returns {Map<number, Object[]>} turnNumber → sorted ScrabEngine events
   */
  function buildScrabByTurnMap(call) {
    const timeline = buildScrabTimeline(call);
    const byTurn = new Map();
    for (const entry of timeline) {
      const t = entry.turnNumber;
      if (!byTurn.has(t)) byTurn.set(t, []);
      byTurn.get(t).push(entry);
    }
    return byTurn;
  }

  /**
   * Render the transcript with provenance tracking and inline ScrabEngine data.
   * @param {Array} turns - Array of turn objects
   * @param {Map<number, Object[]>} scrabByTurn - ScrabEngine events grouped by turn
   * @returns {string} HTML string
   */
  function renderTranscript(turns, scrabByTurn) {
    if (turns.length === 0) {
      return `
        <div style="padding: 20px; background: #f1f5f9; border-radius: 8px; text-align: center;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-bottom: 12px; opacity: 0.5;">
            <path d="M8 12H8.01M12 12H12.01M16 12H16.01M21 12C21 16.9706 16.9706 21 12 21C10.2289 21 8.57736 20.4884 7.17677 19.6067L3 21L4.39334 16.8232C3.51156 15.4226 3 13.7711 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="#64748b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <p style="color: #64748b; font-weight: 500; margin: 0 0 8px 0;">No transcript available</p>
          <p style="color: #94a3b8; font-size: 13px; margin: 0;">
            This call has no conversational data recorded.<br>
            Possible causes: immediate hangup, webhook failure, or STT pipeline issue.
          </p>
        </div>
      `;
    }

    return turns.map(turn => renderTurn(turn, scrabByTurn)).join('');
  }

  /**
   * Render ScrabEngine processing timeline.
   * Merges truth events + transcript context per turn.
   * @param {Object} call - Selected call payload
   * @returns {string}
   */
  function renderScrabEngineSection(call) {
    const timeline = buildScrabTimeline(call);
    if (timeline.length === 0) {
      return `
        <div class="scrab-timeline-container">
          <div class="scrab-timeline-header">
            <span class="scrab-timeline-title">ScrabEngine Processing Timeline</span>
            <span class="scrab-timeline-subtitle">No ScrabEngine trace events captured for this call</span>
          </div>
        </div>
      `;
    }

    const rows = timeline.map((entry) => {
      const rawText = entry.payload?.raw || entry.payload?.rawText || null;
      const summary = entry.payload?.summary || entry.payload?.text || null;
      const entities = entry.payload?.entities || null;
      const quality = entry.payload?.quality || null;
      const normalizedPreview = entry.payload?.normalizedPreview || null;

      const rawBlock = rawText
        ? `<div class="scrab-line"><span class="scrab-label">Deepgram Raw:</span> ${escapeHtml(rawText)}</div>`
        : '';
      const summaryBlock = summary
        ? `<div class="scrab-line"><span class="scrab-label">${escapeHtml(entry.label)}:</span> ${escapeHtml(summary)}</div>`
        : '';
      const normalizedBlock = normalizedPreview
        ? `<div class="scrab-line"><span class="scrab-label">Understood:</span> ${escapeHtml(normalizedPreview)}</div>`
        : '';
      const entitiesBlock = entities && Object.keys(entities).length > 0
        ? `<div class="scrab-line"><span class="scrab-label">Extractions:</span> ${escapeHtml(JSON.stringify(entities))}</div>`
        : '';
      const qualityBlock = quality
        ? `<div class="scrab-line"><span class="scrab-label">Quality:</span> ${escapeHtml(JSON.stringify(quality))}</div>`
        : '';

      return `
        <div class="scrab-event-row">
          <div class="scrab-event-meta">
            <span class="scrab-event-turn">Turn ${entry.turnNumber}</span>
            <span class="scrab-event-time">${formatTimestamp(entry.timestamp)}</span>
            <span class="scrab-event-type">${escapeHtml(entry.type)}</span>
          </div>
          <div class="scrab-event-content">
            ${rawBlock}
            ${summaryBlock}
            ${normalizedBlock}
            ${entitiesBlock}
            ${qualityBlock}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="scrab-timeline-container">
        <div class="scrab-timeline-header">
          <span class="scrab-timeline-title">ScrabEngine Processing Timeline</span>
          <span class="scrab-timeline-subtitle">Deepgram input → ScrabEngine stages → extracted entities</span>
        </div>
        <div class="scrab-timeline-body">
          ${rows}
        </div>
      </div>
    `;
  }

  function buildScrabTimeline(call) {
    const rawEvents = Array.isArray(call?.events) ? call.events : [];
    const rawTrace = Array.isArray(call?.trace) ? call.trace : [];

    const normalizedEvents = [
      ...rawEvents.map(ev => ({
        type: `${ev?.type || ''}`,
        turnNumber: Number.isFinite(ev?.turn) ? ev.turn : (Number.isFinite(ev?.data?.turn) ? ev.data.turn : null),
        timestamp: ev?.timestamp || ev?.ts || null,
        payload: ev?.data || {}
      })),
      ...rawTrace.map(ev => ({
        type: `${ev?.kind || ''}`,
        turnNumber: Number.isFinite(ev?.turnNumber) ? ev.turnNumber : null,
        timestamp: ev?.timestamp || ev?.ts || null,
        payload: ev?.payload || {}
      }))
    ];

    const deduped = [];
    const seen = new Set();
    for (const ev of normalizedEvents) {
      const payloadKey = (() => {
        try { return JSON.stringify(ev.payload || {}); } catch { return ''; }
      })();
      const key = `${ev.type}|${ev.turnNumber ?? 'na'}|${ev.timestamp || ''}|${payloadKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(ev);
    }

    const interesting = deduped.filter(ev => {
      if (!ev.type) return false;
      return ev.type === 'INPUT_TEXT_FINALIZED'
        || ev.type === 'CALLER_NAME_EXTRACTED'
        || ev.type === 'NAME_GREETING_FIRED'
        || ev.type === 'PATIENCE_MODE_ACTIVE'
        || ev.type === 'PATIENCE_TIMEOUT_CHECK_IN'
        || ev.type === 'A2_CALL_ROUTER_CLASSIFIED'
        || ev.type === 'A2_CALL_ROUTER_POOL_FILTERED'
        || ev.type === 'A2_CALL_ROUTER_RETRY_FULL_POOL'
        || ev.type === 'TRIGGER_POOL_EMPTY'
        || ev.type === 'TRIGGER_POOL_SOURCE'
        || ev.type === 'A2_TRIGGER_EVAL'
        || ev.type === 'TRIGGER_CARDS_EVALUATED'
        || ev.type === 'A2_RESPONSE_READY'
        || ev.type === 'A2_PATH_SELECTED'
        || ev.type === 'A2_GREETING_EVALUATED'
        || ev.type.startsWith('SCRABENGINE_');
    });

    interesting.sort((a, b) => {
      const aTs = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTs = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      if (a.turnNumber !== b.turnNumber) {
        const aTurn = Number.isFinite(a.turnNumber) ? a.turnNumber : Number.MAX_SAFE_INTEGER;
        const bTurn = Number.isFinite(b.turnNumber) ? b.turnNumber : Number.MAX_SAFE_INTEGER;
        if (aTurn !== bTurn) return aTurn - bTurn;
      }
      return aTs - bTs;
    });

    return interesting.map((ev) => ({
      ...ev,
      turnNumber: Number.isFinite(ev.turnNumber) ? ev.turnNumber : 0,
      label: toScrabLabel(ev.type)
    }));
  }

  function toScrabLabel(type) {
    const map = {
      INPUT_TEXT_FINALIZED:          'Raw Input from Deepgram',
      SCRABENGINE_ENTRY:             'ScrabEngine — Entry',
      SCRABENGINE_STAGE1:            'Stage 1 — Filler Removal',
      SCRABENGINE_STAGE2:            'Stage 2 — Vocabulary Normalization',
      SCRABENGINE_STAGE3:            'Stage 3 — Token Expansion',
      SCRABENGINE_STAGE4:            'Stage 4 — Entity Extraction',
      SCRABENGINE_STAGE5:            'Stage 5 — Quality Gate',
      SCRABENGINE_DELIVERY:          'ScrabEngine — Delivery to Triggers',
      SCRABENGINE_PROCESSED:         'ScrabEngine — Pipeline Summary',
      SCRABENGINE_QUALITY_FAILED:    'ScrabEngine — Quality Gate FAILED',
      CALLER_NAME_EXTRACTED:         'Caller Name Extracted',
      NAME_GREETING_FIRED:           'Name Greeting Fired',
      PATIENCE_MODE_ACTIVE:          'Patience Mode Active',
      PATIENCE_TIMEOUT_CHECK_IN:     'Patience Check-in',
      A2_CALL_ROUTER_CLASSIFIED:     'Call Router — Intent Classified',
      A2_CALL_ROUTER_POOL_FILTERED:  'Call Router — Trigger Pool Filtered',
      A2_CALL_ROUTER_RETRY_FULL_POOL: '🔄 Call Router — Retry Full Pool',
      TRIGGER_POOL_EMPTY:            '⚠️ Trigger Pool EMPTY',
      TRIGGER_POOL_SOURCE:           'Trigger Pool Source',
      LEGACY_FALLBACK_USED:          '🚨 LEGACY FALLBACK ACTIVE',
      A2_TRIGGER_EVAL:               'Trigger Evaluation Result',
      TRIGGER_CARDS_EVALUATED:       'Trigger Cards Evaluated',
      A2_RESPONSE_READY:             'Response Ready',
      A2_PATH_SELECTED:              'Path Selected',
      A2_GREETING_EVALUATED:         'Greeting Interceptor Result'
    };
    return map[type] || type;
  }

  /**
   * Render a single turn in the transcript.
   * For caller turns, injects inline ScrabEngine pipeline visualization.
   * @param {Object} turn - Turn data
   * @param {Map<number, Object[]>} scrabByTurn - ScrabEngine events by turn
   * @returns {string} HTML string
   */
  function renderTurn(turn, scrabByTurn) {
    const isCaller = turn.speaker === 'caller';
    const isAgent = turn.speaker === 'agent';
    const isSystem = turn.speaker === 'system';
    const hasViolation = turn.provenance?.type === 'HARDCODED';
    
    const turnClass = hasViolation ? 'turn has-violation' : 'turn';
    const speakerClass = isCaller
      ? 'turn-speaker caller'
      : (isSystem ? 'turn-speaker system' : 'turn-speaker agent');
    const speakerLabel = isCaller ? 'CALLER' : (isSystem ? 'SYSTEM' : 'AGENT');

    let provenanceHtml = '';
    if ((isAgent || isSystem) && turn.provenance) {
      provenanceHtml = renderTurnProvenance(turn.provenance);
    }

    let violationAlert = '';
    if (hasViolation) {
      violationAlert = `
        <div class="violation-alert">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M7 1L13 12H1L7 1Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M7 5V7.5M7 9.5V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          VIOLATION: This response is hardcoded, not UI-driven. Must be fixed for compliance.
        </div>
      `;
    }

    let scrabInlineHtml = '';
    if (isCaller && scrabByTurn) {
      scrabInlineHtml = renderInlineScrabPipeline(turn.turnNumber, scrabByTurn);
    }

    return `
      <div class="${turnClass}">
        <div class="turn-header">
          <span class="turn-number">Turn ${turn.turnNumber}</span>
          <span class="${speakerClass}">${speakerLabel}</span>
          ${turn.kind ? `<span class="turn-timestamp" style="margin-left: 8px; opacity: 0.75;">${escapeHtml(CONFIG.KIND_LABELS[turn.kind] || turn.kind)}</span>` : ''}
          <span class="turn-timestamp">${formatTimestamp(turn.timestamp)}</span>
        </div>
        <div class="turn-text">${escapeHtml(turn.text)}</div>
        ${scrabInlineHtml}
        ${provenanceHtml}
        ${violationAlert}
      </div>
    `;
  }

  /**
   * Render inline ScrabEngine processing pipeline for a caller turn.
   * Shows: Deepgram raw -> each processing stage -> final understood text -> extractions
   * @param {number} turnNumber
   * @param {Map<number, Object[]>} scrabByTurn
   * @returns {string} HTML or empty string
   */
  function renderInlineScrabPipeline(turnNumber, scrabByTurn) {
    const events = scrabByTurn.get(turnNumber);
    if (!events || events.length === 0) return '';

    const entryEv = events.find(e => e.type === 'INPUT_TEXT_FINALIZED' || e.type === 'SCRABENGINE_ENTRY');
    const stage1 = events.find(e => e.type === 'SCRABENGINE_STAGE1');
    const stage2 = events.find(e => e.type === 'SCRABENGINE_STAGE2');
    const stage3 = events.find(e => e.type === 'SCRABENGINE_STAGE3');
    const stage4 = events.find(e => e.type === 'SCRABENGINE_STAGE4');
    const stage5 = events.find(e => e.type === 'SCRABENGINE_STAGE5');
    const delivery = events.find(e => e.type === 'SCRABENGINE_DELIVERY');
    const summaryEv = events.find(e => e.type === 'SCRABENGINE_PROCESSED');

    const rawText = entryEv?.payload?.raw || entryEv?.payload?.rawText || null;
    const normalizedText = summaryEv?.payload?.normalizedPreview || delivery?.payload?.text || null;
    const wasChanged = summaryEv?.payload?.wasChanged || (rawText && normalizedText && rawText !== normalizedText);
    const totalMs = summaryEv?.payload?.performance?.totalTimeMs || delivery?.payload?.metadata?.totalProcessingTimeMs || null;
    const entities = stage4?.payload?.entities || summaryEv?.payload?.entities || null;
    const handoffEntities = stage4?.payload?.handoffEntities || null;

    const hasData = rawText || normalizedText || entities;
    if (!hasData) return '';

    const stages = [];

    if (stage1?.payload?.summary || stage1?.payload?.text) {
      const s = stage1.payload;
      const status = s.status || (s.changes?.length > 0 ? 'modified' : 'unchanged');
      stages.push(renderScrabStageChip('1', 'Fillers', s.summary || s.text, status));
    }
    if (stage2?.payload?.summary || stage2?.payload?.text) {
      const s = stage2.payload;
      const changes = s.changes || [];
      const contractionFires = changes.some(c => c.type === 'system_contraction' || (c.from && c.from.includes("'")));
      const laymanFires      = changes.some(c => c.type === 'system_layman');
      const status = s.status || (changes.length > 0 ? 'modified' : 'unchanged');
      // Enrich summary with system default badges
      let summary = s.summary || s.text || '';
      const badges = [];
      if (contractionFires) badges.push('contractions');
      if (laymanFires)      badges.push('layman vocab');
      if (badges.length) summary = (summary ? summary + ' · ' : '') + badges.join(' · ');
      stages.push(renderScrabStageChip('2', 'Vocab', summary, status));
    }
    if (stage3?.payload?.summary || stage3?.payload?.text) {
      const s = stage3.payload;
      const status = s.status || 'unchanged';
      stages.push(renderScrabStageChip('3', 'Expand', s.summary || s.text, status));
    }
    if (stage4?.payload?.summary || stage4?.payload?.text) {
      const s = stage4.payload;
      const status = s.status || (s.extractions?.length > 0 ? 'extracted' : 'none');
      stages.push(renderScrabStageChip('4', 'Extract', s.summary || s.text, status));
    }
    if (stage5?.payload) {
      const s = stage5.payload;
      const status = s.status || (s.passed ? 'passed' : 'failed');
      stages.push(renderScrabStageChip('5', 'Quality', s.summary || `${s.reason || ''} ${s.confidence ? Math.round(s.confidence * 100) + '%' : ''}`, status));
    }

    const stagesHtml = stages.length > 0 ? stages.join('') : '';

    let entitiesHtml = '';
    if (entities && typeof entities === 'object') {
      const filled = Object.entries(entities).filter(([, v]) => v);
      if (filled.length > 0) {
        const handoff = handoffEntities || {};
        entitiesHtml = `
          <div class="scrab-inline-entities">
            <span class="scrab-inline-entities-label">Extracted:</span>
            ${filled.map(([k, v]) => {
              const isHandoff = handoff[k] !== undefined;
              return `<span class="scrab-entity-chip ${isHandoff ? 'handoff' : ''}">${escapeHtml(k)}="${escapeHtml(v)}"${isHandoff ? ' <span class="scrab-handoff-badge">handoff</span>' : ''}</span>`;
            }).join(' ')}
          </div>
        `;
      }
    }

    const understoodHtml = (wasChanged && normalizedText)
      ? `<div class="scrab-inline-understood"><span class="scrab-inline-label">Understood:</span> ${escapeHtml(normalizedText)}</div>`
      : '';

    const perfHtml = totalMs != null
      ? `<span class="scrab-inline-perf">${totalMs}ms</span>`
      : '';

    return `
      <div class="scrab-inline-card">
        <div class="scrab-inline-header">
          <span class="scrab-inline-title">ScrabEngine</span>
          ${perfHtml}
        </div>
        ${rawText ? `<div class="scrab-inline-raw"><span class="scrab-inline-label">Deepgram STT:</span> ${escapeHtml(rawText)}</div>` : ''}
        ${stagesHtml ? `<div class="scrab-inline-stages">${stagesHtml}</div>` : ''}
        ${understoodHtml}
        ${entitiesHtml}
      </div>
    `;
  }

  function renderScrabStageChip(num, label, detail, status) {
    const statusClass = status === 'modified' || status === 'expanded' || status === 'extracted'
      ? 'scrab-stage-active'
      : status === 'failed' ? 'scrab-stage-failed' : 'scrab-stage-noop';
    return `
      <div class="scrab-stage-chip ${statusClass}">
        <span class="scrab-stage-num">${num}</span>
        <span class="scrab-stage-label">${escapeHtml(label)}</span>
        ${detail ? `<span class="scrab-stage-detail">${escapeHtml(detail)}</span>` : ''}
      </div>
    `;
  }

  /**
   * Render provenance details for an agent turn
   * @param {Object} provenance - Provenance data
   * @returns {string} HTML string
   */
  function renderTurnProvenance(provenance) {
    const typeConfig = CONFIG.PROVENANCE_TYPES[provenance.type] || CONFIG.PROVENANCE_TYPES.UNKNOWN;
    const provenanceClass = provenance.type === 'HARDCODED' ? 'hardcoded' : 
                            provenance.type === 'FALLBACK' ? 'fallback' : 'ui-owned';
    const displayUiPath = normalizeUiPathForDisplay(provenance.uiPath);

    let sourceInfo = '';
    if (provenance.uiPath) {
      const anchorId = provenance.uiAnchor || null;
      const derivedTriggerId =
        provenance.triggerId ||
        provenance.triggerCardId ||
        (anchorId ? anchorId.replace(/^trigger-/, '') : null) ||
        extractTriggerIdFromUiPath(provenance.uiPath);
      const focusId = anchorId || (derivedTriggerId ? `trigger-${derivedTriggerId}` : null);

      const uiLink = buildUILink(provenance.uiPath, focusId, derivedTriggerId, 'answerText');
      sourceInfo = `
        <span class="provenance-label">UI Path:</span>
        <span class="provenance-value mono">${escapeHtml(displayUiPath)}</span>
        
        <span class="provenance-label">UI Tab:</span>
        <span class="provenance-value">
          ${uiLink ? `<a href="${uiLink.href}" class="provenance-link" target="_blank">${escapeHtml(uiLink.label)} ↗</a>` : 'N/A'}
        </span>
      `;
    }

    if (provenance.triggerId) {
      sourceInfo += `
        <span class="provenance-label">Trigger:</span>
        <span class="provenance-value mono">${escapeHtml(provenance.triggerId)}</span>
      `;
    }

    if (provenance.greeting?.deliveredVia) {
      const deliveryLabels = {
        'prerecorded_audio': '🎵 Pre-recorded Audio',
        'elevenlabs_tts': '🎙️ ElevenLabs TTS',
        'twilio_tts': '📢 Twilio TTS'
      };
      sourceInfo += `
        <span class="provenance-label">Delivered Via:</span>
        <span class="provenance-value">${escapeHtml(deliveryLabels[provenance.greeting.deliveredVia] || provenance.greeting.deliveredVia)}</span>
      `;
    }

    if (provenance.reason) {
      sourceInfo += `
        <span class="provenance-label">Reason:</span>
        <span class="provenance-value">${escapeHtml(provenance.reason)}</span>
      `;
    }

    return `
      <div class="turn-provenance">
        <div class="provenance-details ${provenanceClass}">
          <span class="provenance-label">Source:</span>
          <span class="provenance-value">${typeConfig.icon} ${escapeHtml(typeConfig.label)}</span>
          ${sourceInfo}
        </div>
      </div>
    `;
  }

  /**
   * Render the events log section
   * @param {Array} events - Array of event objects
   * @returns {string} HTML string
   */
  // ── Diagnostic Roadmap helpers ─────────────────────────────────────────────

  function roadmapStep(num, icon, title, ok, detail, extra) {
    const bg     = ok === true  ? '#f0fdf4' : ok === false ? '#fef2f2' : '#fffbeb';
    const border = ok === true  ? '#86efac' : ok === false ? '#fca5a5' : '#fcd34d';
    const numBg  = ok === true  ? '#10b981' : ok === false ? '#ef4444' : '#f59e0b';
    const tc     = ok === true  ? '#166534' : ok === false ? '#991b1b' : '#b45309';
    return `
      <div style="display:flex;gap:12px;align-items:flex-start;">
        <div style="min-width:40px;height:40px;border-radius:50%;background:${numBg};color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0;">${ok === false ? '🚫' : num}</div>
        <div style="flex:1;background:${bg};border:1px solid ${border};border-radius:8px;padding:12px;">
          <div style="font-weight:600;color:${tc};margin-bottom:4px;">${icon} ${escapeHtml(title)}</div>
          <div style="font-size:12px;color:${tc};line-height:1.6;">${detail}</div>
          ${extra ? `<div style="font-size:11px;color:#64748b;margin-top:6px;padding-top:6px;border-top:1px solid ${border};">${extra}</div>` : ''}
        </div>
      </div>
      <div style="text-align:center;color:#cbd5e1;font-size:20px;margin:-4px 0;">↓</div>
    `;
  }

  function renderDiagnosticRoadmap(call) {
    const allEvts = [...(call.events || []), ...(call.trace || [])];
    const findEv  = (t) => allEvts.find(e => (e.type || e.kind) === t);
    const hasEvts = allEvts.length > 0;

    const turns      = call.turns || [];
    const callerTurns = turns.filter(t => t.speaker === 'caller');
    const agentTurns  = turns.filter(t => t.speaker === 'agent');

    if (callerTurns.length === 0) {
      return `
        <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:12px;padding:20px;margin:16px 0;">
          <h4 style="color:#b45309;margin:0 0 8px 0;">⚠️ No Caller Input — Cannot Analyze Decision Path</h4>
          <p style="font-size:13px;color:#92400e;margin:0;">Call ended before any speech was captured, or STT failed.</p>
        </div>`;
    }

    const firstCaller = callerTurns[0];
    const firstAgent  = agentTurns[0];

    // Collect key events
    const scrabEv        = findEv('SCRABENGINE_PROCESSED') || findEv('SCRABENGINE_DELIVERY');
    const routerEv       = findEv('A2_CALL_ROUTER_CLASSIFIED');
    const greetingEv     = findEv('A2_GREETING_EVALUATED');
    const poolEmptyEv    = findEv('TRIGGER_POOL_EMPTY');
    const poolSourceEv   = findEv('TRIGGER_POOL_SOURCE');
    const poolFilteredEv = findEv('A2_CALL_ROUTER_POOL_FILTERED');
    const triggerEv      = findEv('TRIGGER_CARDS_EVALUATED') || findEv('A2_TRIGGER_EVAL');
    const responseEv     = findEv('A2_RESPONSE_READY');
    const pathEv         = findEv('A2_PATH_SELECTED');

    // ScrabEngine details
    const scrabPayload     = scrabEv?.payload || {};
    const normalized       = scrabPayload.normalizedPreview || scrabPayload.normalizedText || null;
    const scrabMs          = scrabPayload.performance?.totalTimeMs ?? scrabPayload.processingTimeMs ?? null;
    const transformCount   = scrabPayload.transformations?.length ?? 0;
    const hadContractions  = (scrabPayload.transformations || []).some(t => t.type === 'system_contraction');
    const hadLayman        = (scrabPayload.transformations || []).some(t => t.type === 'system_layman');

    // CallRouter details
    const routerPayload  = routerEv?.payload || {};
    const bucket         = routerPayload.bucket;
    const confidence     = routerPayload.confidence;
    const tier           = routerPayload.tier;
    const anchor         = routerPayload.matchedAnchor;
    const BUCKET_COLORS  = {
      booking_service: '#3b82f6', billing_payment: '#f59e0b',
      membership_plan: '#8b5cf6', existing_appointment: '#10b981', other_operator: '#6b7280'
    };
    const bucketColor = bucket ? (BUCKET_COLORS[bucket] || '#64748b') : '#64748b';

    // Pool details
    const poolFilterPayload = poolFilteredEv?.payload || {};
    const poolFiltered       = poolFilteredEv != null;
    const beforeFilter       = poolFilterPayload.beforeFilter ?? null;
    const afterFilter        = poolFilterPayload.afterFilter ?? null;

    // Trigger details
    const trigPayload       = triggerEv?.payload || {};
    const trigMatched       = trigPayload.matched ?? trigPayload.winnersSelected > 0;
    const trigCard          = trigPayload.winner || (trigPayload.matched ? { cardId: trigPayload.cardId, cardLabel: trigPayload.cardLabel, matchType: trigPayload.matchType, matchedOn: trigPayload.matchedOn } : null);
    const totalCards        = trigPayload.totalCardsInPool ?? trigPayload.totalCards ?? 0;
    const negativeBlocked   = (trigPayload.blocked?.byNegativeKeywords ?? trigPayload.negativeBlocked ?? 0) + (trigPayload.negativePhraseBlocked ?? 0);
    const maxWordsBlocked   = trigPayload.maxWordsBlocked ?? 0;
    const gateBlocked       = trigPayload.blocked?.byIntentGate ?? trigPayload.intentGateBlocked ?? 0;
    const candidatesFound   = trigPayload.candidatesFound ?? 0;

    // Response details
    const responsePayload   = responseEv?.payload || {};
    const responsePath      = responsePayload.path || pathEv?.payload?.path || firstAgent?.source || 'UNKNOWN';
    const responsePreview   = responsePayload.responsePreview || (firstAgent?.text || '').substring(0, 120);
    const hasAudio          = responsePayload.hasAudio;

    const isLLMPath         = responsePath.includes('LLM') || responsePath.includes('FALLBACK');
    const isTriggerPath     = responsePath.includes('TRIGGER') || trigMatched;
    const isGreetingPath    = responsePath.includes('GREETING');

    const pathColor  = isTriggerPath ? '#10b981' : isLLMPath ? '#f59e0b' : '#64748b';
    const pathIcon   = isTriggerPath ? '✅' : isLLMPath ? '⚠️' : '➡️';

    const steps = [];

    // ── Step 1: Caller Input ────────────────────────────────────────────────
    steps.push(roadmapStep(1, '📞', 'Caller Input — Raw from Deepgram STT', true,
      `"${escapeHtml((firstCaller?.text || '').substring(0, 200))}"`,
      'Raw, unprocessed speech. Contractions intact. Fillers present. ScrabEngine processes this next.'
    ));

    // ── Step 2: ScrabEngine ─────────────────────────────────────────────────
    if (!hasEvts) {
      steps.push(roadmapStep(2, '🔍', 'ScrabEngine — No Events Captured', false,
        'No event data available. Call was made before event logging was deployed.',
        'Action: Make a new test call. All V130 events are captured automatically.'
      ));
    } else if (!scrabEv) {
      steps.push(roadmapStep(2, '🔍', 'ScrabEngine — Event Missing', false,
        'SCRABENGINE_PROCESSED event not found in trace. Pipeline may have failed.',
        'Check: services/ScrabEngine.js · Check server logs for errors on this CallSid'
      ));
    } else {
      const badges = [];
      if (transformCount > 0) badges.push(`${transformCount} transformation${transformCount !== 1 ? 's' : ''}`);
      if (hadContractions) badges.push('✓ Contractions expanded');
      if (hadLayman) badges.push('✓ Layman vocab normalized');
      if (scrabMs != null) badges.push(`${scrabMs}ms`);
      steps.push(roadmapStep(2, '🔍', 'ScrabEngine — 5-Stage Pipeline Completed', true,
        normalized ? `"${escapeHtml(normalized)}"<br><span style="font-size:11px;opacity:0.75;">↑ Normalized text delivered to triggers</span>` : '✅ Pipeline completed',
        badges.join(' · ')
      ));
    }

    // ── Step 3: Agent2CallRouter ────────────────────────────────────────────
    if (!routerEv) {
      steps.push(roadmapStep(3, '🧭', 'Agent2CallRouter — No Classification Event', null,
        'Router event not captured. CallRouter may be disabled or call was before Phase 4 deployment.',
        'Config: company.aiAgentSettings.agent2.discovery.callRouter.enabled = true'
      ));
    } else {
      const confPct = confidence != null ? Math.round(confidence * 100) : '?';
      const bucketLabel = bucket ? bucket.replace(/_/g, ' ').toUpperCase() : 'UNKNOWN';
      steps.push(roadmapStep(3, '🧭', 'Agent2CallRouter — 5-Bucket Intent Gate', true,
        `<span style="display:inline-block;background:${bucketColor};color:white;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700;margin-bottom:4px;">${escapeHtml(bucketLabel)}</span>
         <br>Confidence: ${confPct}% (${escapeHtml(tier || '?')})
         ${anchor ? `<br>Anchor match: "${escapeHtml(anchor)}"` : ''}`,
        poolFiltered
          ? `Pool filtered: ${beforeFilter} → ${afterFilter} cards (bucket: ${escapeHtml(bucket || '')})`
          : 'Pool filtering: OFF (filteringEnabled=false — observing only)'
      ));
    }

    // ── Step 4: Greeting Interceptor ────────────────────────────────────────
    if (!greetingEv) {
      steps.push(roadmapStep(4, '🎭', 'Greeting Interceptor — No Event', null,
        'A2_GREETING_EVALUATED not captured.',
        'Non-critical if triggers fired correctly. Check for older calls pre-V125.'
      ));
    } else {
      const gPayload = greetingEv?.payload || {};
      const intercepted = gPayload.intercepted;
      steps.push(roadmapStep(4, '🎭', 'Greeting Interceptor', true,
        intercepted
          ? `Greeting detected: "${escapeHtml(gPayload.matchedTrigger || 'unknown')}" — stored, processing continued to triggers.`
          : 'No greeting detected on cleaned text. Proceeded directly to trigger evaluation.',
        'V125 fix: No early exit — greeting detection is informational only. Triggers always evaluate.'
      ));
    }

    // ── Step 5: Trigger Pool ────────────────────────────────────────────────
    if (poolEmptyEv) {
      steps.push(roadmapStep(5, '🗂️', 'Trigger Pool — EMPTY ⚠️', false,
        `<strong>CRITICAL: Zero trigger cards loaded for this company.</strong>
         <br>Every call turn falls through to LLM fallback when pool is empty.
         <br><br>Message: ${escapeHtml(poolEmptyEv.payload?.message || 'No triggers loaded')}`,
        'Action: Admin → Triggers → Assign a published group → Refresh Cache. Run: node scripts/seedTriggerGroupV1.js'
      ));
    } else if (triggerEv) {
      const poolDetail = totalCards > 0
        ? `Pool: ${totalCards} cards loaded${poolFiltered ? ` (pre-filtered from ${beforeFilter} by CallRouter bucket)` : ''}`
        : 'Pool size unknown';
      const poolSrc     = poolSourceEv?.payload;
      const hasLegacy   = poolSrc?.hasLegacyCards;
      const scopeDetail = poolSrc ? Object.entries(poolSrc.scopes || {}).map(([s,n])=>`${n} ${s}`).join(', ') : null;
      steps.push(roadmapStep(5, '🗂️', hasLegacy ? 'Trigger Pool — LEGACY CARDS ACTIVE ⚠️' : 'Trigger Pool — Loaded',
        hasLegacy ? null : true,
        hasLegacy
          ? `${totalCards} cards loaded — but includes old hardcoded legacy cards (pricing.service_call, problem.not_cooling, etc.).<br><strong>These bypass your 42 local triggers.</strong> Click "Clear Legacy" in the Triggers admin to remove them.`
          : poolDetail,
        scopeDetail ? `Sources: ${escapeHtml(scopeDetail)}` : 'Source: TriggerService (GlobalTrigger + LocalTrigger + legacy fallback)'
      ));
    } else {
      steps.push(roadmapStep(5, '🗂️', 'Trigger Pool — No Pool Event', null,
        'TRIGGER_POOL_EMPTY not found, but no trigger eval event either.',
        'Check: TriggerService logs for this CallSid. Pool may have loaded but eval was skipped.'
      ));
    }

    // ── Step 6: TriggerCardMatcher ──────────────────────────────────────────
    if (!triggerEv) {
      steps.push(roadmapStep(6, '🎯', 'TriggerCardMatcher — Not Evaluated', false,
        'A2_TRIGGER_EVAL / TRIGGER_CARDS_EVALUATED event not found.',
        'Possible causes: (1) Pool was empty, (2) Greeting exited early (pre-V125), (3) Pending question consumed this turn.'
      ));
    } else if (!trigMatched) {
      const blockedSummary = [
        negativeBlocked > 0 ? `${negativeBlocked} negative-blocked` : '',
        maxWordsBlocked > 0 ? `${maxWordsBlocked} maxWords-blocked` : '',
        gateBlocked > 0 ? `${gateBlocked} intent-gate-blocked` : ''
      ].filter(Boolean).join(' · ');
      steps.push(roadmapStep(6, '🎯', 'TriggerCardMatcher — No Match', false,
        `Evaluated ${totalCards} card${totalCards !== 1 ? 's' : ''}. Candidates found: ${candidatesFound}. NONE matched.
         ${blockedSummary ? `<br>Blocked: ${escapeHtml(blockedSummary)}` : ''}`,
        'Debug: Open Trigger Test Panel (Triggers page) → type this exact input → see which cards evaluated and why each missed.'
      ));
    } else {
      const c = trigCard;
      const matchBadge = c?.matchType === 'KEYWORD' ? '🔑 Keyword' : c?.matchType === 'PHRASE' ? '💬 Phrase' : '✓';
      steps.push(roadmapStep(6, '🎯', 'TriggerCardMatcher — MATCHED', true,
        `<strong>${escapeHtml(c?.cardLabel || c?.cardId || 'Unknown card')}</strong>
         <br>${matchBadge}: "${escapeHtml(c?.matchedOn || '')}"
         ${blockedSummary(negativeBlocked, maxWordsBlocked, gateBlocked)}`,
        `Evaluated ${totalCards} cards · Candidates: ${candidatesFound}`
      ));
    }

    // ── Step 7: Response ────────────────────────────────────────────────────
    const respOk = isTriggerPath || (!isLLMPath && !isGreetingPath);
    steps.push(roadmapStep(7, '💬', `Response — ${escapeHtml(responsePath)}`, respOk,
      `"${escapeHtml(responsePreview)}"
       ${hasAudio != null ? `<br>${hasAudio ? '🎵 Pre-recorded audio served' : '🎙️ ElevenLabs TTS generated'}` : ''}`,
      isLLMPath
        ? '⚠️ LLM responded. If this was a service call it means triggers didn\'t match. Check Step 6.'
        : isTriggerPath
          ? '✅ Trigger response delivered correctly.'
          : `Path: ${escapeHtml(responsePath)}`
    ));

    // ── Summary bar ─────────────────────────────────────────────────────────
    const allGood = !!scrabEv && !!routerEv && !poolEmptyEv && trigMatched;
    const summaryBg     = allGood ? '#f0fdf4' : '#fef2f2';
    const summaryBorder = allGood ? '#10b981' : '#ef4444';
    const summaryColor  = allGood ? '#166534' : '#991b1b';
    const pathStr = [
      scrabEv ? '2✓' : '2✗',
      routerEv ? `3✓(${bucket || '?'})` : '3?',
      greetingEv ? '4✓' : '4?',
      poolEmptyEv ? '5✗EMPTY' : triggerEv ? '5✓' : '5?',
      triggerEv ? (trigMatched ? '6✓MATCH' : '6✗MISS') : '6✗SKIP',
      '7'
    ].join(' → ');

    const summary = `
      <div style="background:${summaryBg};border:2px solid ${summaryBorder};border-radius:10px;padding:14px;margin-top:4px;">
        <div style="font-weight:700;font-size:13px;color:${summaryColor};margin-bottom:6px;">
          ${allGood ? '✅ CALL PROCESSED CORRECTLY' : '🔎 REVIEW REQUIRED — See highlighted steps above'}
        </div>
        <div style="font-size:11px;color:${summaryColor};font-family:monospace;">
          Path: 1 → ${escapeHtml(pathStr)}
        </div>
        ${!allGood ? `
          <div style="margin-top:8px;font-size:12px;color:${summaryColor};">
            ${!scrabEv && hasEvts ? '<strong>Missing:</strong> ScrabEngine events — pipeline may have failed<br>' : ''}
            ${poolEmptyEv ? '<strong>Critical:</strong> Trigger pool empty — assign + publish a trigger group<br>' : ''}
            ${!trigMatched && triggerEv ? '<strong>Debug:</strong> Use Trigger Test Panel → paste caller utterance → see evaluation<br>' : ''}
            ${isLLMPath && !isTriggerPath ? '<strong>Warning:</strong> LLM responded instead of a trigger — check trigger coverage<br>' : ''}
          </div>
        ` : ''}
      </div>
    `;

    return `
      <div style="background:#fff;border:2px solid #3b82f6;border-radius:12px;padding:20px;margin:16px 0;">
        <h3 style="color:#1e40af;margin:0 0 16px 0;font-size:15px;display:flex;align-items:center;gap:8px;">
          🗺️ V130 Diagnostic Roadmap — Turn 1 Decision Path
          <span style="font-size:11px;font-weight:400;color:#64748b;margin-left:auto;">
            ${callerTurns.length} caller turn${callerTurns.length !== 1 ? 's' : ''} · ${agentTurns.length} agent response${agentTurns.length !== 1 ? 's' : ''}
          </span>
        </h3>
        ${!hasEvts ? `
          <div style="background:#fee2e2;border:1px solid #ef4444;border-radius:8px;padding:10px;margin-bottom:14px;font-size:12px;color:#991b1b;">
            <strong>⚠️ NO EVENTS CAPTURED</strong> — Call predates V130 event logging. Make a new test call to see full trace.
          </div>
        ` : ''}
        <div style="display:grid;gap:8px;">
          ${steps.join('')}
          ${summary}
        </div>
      </div>
    `;
  }

  // Helper to build a blocked summary string
  function blockedSummary(negBlocked, maxBlocked, gateBlocked) {
    const parts = [];
    if (negBlocked > 0)  parts.push(`${negBlocked} negative-blocked`);
    if (maxBlocked > 0)  parts.push(`${maxBlocked} maxWords-blocked`);
    if (gateBlocked > 0) parts.push(`${gateBlocked} intent-gate-blocked`);
    return parts.length > 0 ? `<br><span style="font-size:11px;opacity:0.75;">Blocked: ${escapeHtml(parts.join(' · '))}</span>` : '';
  }

  // Event type categories for color coding in the events log
  const EVENT_CATEGORIES = {
    critical: {
      color: '#ef4444', bg: '#fef2f2', border: '#fca5a5',
      types: ['TRIGGER_POOL_EMPTY', 'SCRABENGINE_QUALITY_FAILED', 'LEGACY_FALLBACK_USED']
    },
    success: {
      color: '#16a34a', bg: '#f0fdf4', border: '#86efac',
      types: ['TRIGGER_CARDS_EVALUATED', 'A2_RESPONSE_READY', 'BOOKING_COMPLETED', 'CALLER_NAME_EXTRACTED']
    },
    info: {
      color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe',
      types: ['A2_CALL_ROUTER_CLASSIFIED', 'A2_CALL_ROUTER_POOL_FILTERED', 'A2_CALL_ROUTER_RETRY_FULL_POOL',
              'A2_PATH_SELECTED', 'SCRABENGINE_PROCESSED', 'SCRABENGINE_DELIVERY', 'INPUT_TEXT_FINALIZED',
              'A2_GATE', 'A2_TRIGGER_EVAL']
    },
    stage: {
      color: '#7c3aed', bg: '#faf5ff', border: '#ddd6fe',
      types: ['SCRABENGINE_ENTRY', 'SCRABENGINE_STAGE1', 'SCRABENGINE_STAGE2',
              'SCRABENGINE_STAGE3', 'SCRABENGINE_STAGE4', 'SCRABENGINE_STAGE5']
    },
    warning: {
      color: '#b45309', bg: '#fffbeb', border: '#fde68a',
      types: ['A2_FOLLOWUP_CONSENT_CLASSIFIED', 'A2_PENDING_QUESTION_RESOLVED',
              'A2_CLARIFIER_RESOLVED', 'A2_GREETING_EVALUATED', 'NAME_GREETING_FIRED',
              'A2_CONSENT_GATE_BOOKING', 'A2_COMPLEXITY_SCORE']
    }
  };

  function getEventCategory(type) {
    for (const [cat, def] of Object.entries(EVENT_CATEGORIES)) {
      if (def.types.includes(type)) return def;
    }
    return { color: '#475569', bg: '#f8fafc', border: '#e2e8f0' };
  }

  function renderEventPayloadSummary(type, payload) {
    if (!payload || Object.keys(payload).length === 0) return '';

    // Human-readable summaries for key event types
    if (type === 'A2_CALL_ROUTER_CLASSIFIED') {
      const b = payload.bucket ? payload.bucket.replace(/_/g, ' ').toUpperCase() : '?';
      const c = payload.confidence != null ? Math.round(payload.confidence * 100) + '%' : '?';
      return `bucket: <strong>${escapeHtml(b)}</strong> · confidence: <strong>${c}</strong> · tier: ${escapeHtml(payload.tier || '?')}${payload.matchedAnchor ? ` · anchor: "${escapeHtml(payload.matchedAnchor)}"` : ''}`;
    }
    if (type === 'TRIGGER_CARDS_EVALUATED' || type === 'A2_TRIGGER_EVAL') {
      const matched = payload.matched ?? payload.winnersSelected > 0;
      const card    = payload.winner;
      return matched
        ? `✅ <strong>MATCHED</strong>: ${escapeHtml(card?.cardLabel || payload.cardLabel || '?')} via ${escapeHtml(card?.matchType || payload.matchType || '?')}: "${escapeHtml(card?.matchedOn || payload.matchedOn || '')}"`
        : `❌ <strong>NO MATCH</strong> — ${payload.totalCardsInPool ?? payload.totalCards ?? 0} cards evaluated`;
    }
    if (type === 'SCRABENGINE_PROCESSED') {
      const t = payload.transformations?.length ?? 0;
      const ms = payload.performance?.totalTimeMs ?? '?';
      return `${t} transformation${t !== 1 ? 's' : ''} · ${ms}ms · normalized: "${escapeHtml((payload.normalizedPreview || '').substring(0, 80))}"`;
    }
    if (type === 'A2_RESPONSE_READY') {
      const src = escapeHtml(payload.path || payload.source || '?');
      const prev = escapeHtml((payload.responsePreview || '').substring(0, 100));
      return `path: <strong>${src}</strong>${prev ? ` · "${prev}"` : ''}`;
    }
    if (type === 'A2_PATH_SELECTED') {
      return `path: <strong>${escapeHtml(payload.path || '?')}</strong>${payload.reason ? ` · ${escapeHtml(payload.reason.substring(0, 80))}` : ''}`;
    }
    if (type === 'TRIGGER_POOL_EMPTY') {
      const strictInfo = payload.strictMode ? ' <span style="color:#7c3aed;">[STRICT MODE]</span>' : '';
      return `⚠️ <strong>${escapeHtml(payload.message || 'No triggers loaded')}</strong>${strictInfo}`;
    }
    // STRICT TRIGGER SYSTEM: LEGACY_FALLBACK_USED event (V131)
    if (type === 'LEGACY_FALLBACK_USED') {
      return `🚨 <strong>LEGACY FALLBACK ACTIVE</strong> — ${payload.legacyCardCount || 0} cards from playbook.rules. ` +
        `<span style="color:#dc2626;">Modern trigger system bypassed!</span> ` +
        `<em>${escapeHtml(payload.remediation || 'Enable strict mode to disable legacy.')}</em>`;
    }
    if (type === 'TRIGGER_POOL_SOURCE') {
      const scopeStr = Object.entries(payload.scopes || {}).map(([s, n]) => `${n} ${s}`).join(', ');
      const legacyWarn = payload.hasLegacyCards
        ? ` <span style="color:#dc2626;font-weight:700;">⚠️ LEGACY CARDS ACTIVE — click "Clear Legacy" in Triggers admin</span>`
        : ' ✅ clean pool';
      return `${payload.total} cards loaded (${escapeHtml(scopeStr)})${legacyWarn}`;
    }
    if (type === 'CALLER_NAME_EXTRACTED') {
      return `name: <strong>${escapeHtml(payload.firstName || '?')}</strong>${payload.lastName ? ' ' + escapeHtml(payload.lastName) : ''} · source: ${escapeHtml(payload.source || '?')}`;
    }
    if (type === 'INPUT_TEXT_FINALIZED') {
      return `"${escapeHtml((payload.raw || '').substring(0, 100))}"`;
    }
    if (type === 'A2_CALL_ROUTER_POOL_FILTERED') {
      return `${payload.beforeFilter ?? '?'} → ${payload.afterFilter ?? '?'} cards (bucket: ${escapeHtml(payload.bucket || '?')}, confidence: ${payload.confidence != null ? Math.round(payload.confidence * 100) + '%' : '?'})`;
    }
    // V131: Bucket filter retry event
    if (type === 'A2_CALL_ROUTER_RETRY_FULL_POOL') {
      const matched = payload.retryMatched ? `✅ matched: ${escapeHtml(payload.retryCardLabel || payload.retryCardId || '?')}` : '❌ still no match';
      return `Filtered pool had no match → retried with full pool (${payload.filteredPoolSize} → ${payload.fullPoolSize} cards). ${matched}`;
    }
    if (type === 'A2_FOLLOWUP_CONSENT_CLASSIFIED') {
      return `bucket: <strong>${escapeHtml(payload.bucket || '?')}</strong> · direction: ${escapeHtml(payload.direction || '?')}`;
    }
    if (type === 'A2_GREETING_EVALUATED') {
      const hit = payload.intercepted ? `✅ intercepted: "${escapeHtml(payload.matchedTrigger || '?')}"` : '⬜ no greeting detected';
      return hit;
    }

    // Generic: show first 3 key→value pairs
    const entries = Object.entries(payload).filter(([, v]) => v != null && v !== '').slice(0, 4);
    return entries.map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v).substring(0, 40))}`).join(' · ');
  }

  function renderEventsSection(events) {
    if (!events || events.length === 0) return '';

    // Sort events by turn then timestamp
    const sorted = [...events].sort((a, b) => {
      const ta = (a.turnNumber ?? a.turn ?? 0);
      const tb = (b.turnNumber ?? b.turn ?? 0);
      if (ta !== tb) return ta - tb;
      const aTs = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTs = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return aTs - bTs;
    });

    // Group by turn
    const byTurn = new Map();
    sorted.forEach(ev => {
      const t = ev.turnNumber ?? ev.turn ?? 0;
      if (!byTurn.has(t)) byTurn.set(t, []);
      byTurn.get(t).push(ev);
    });

    let html = '';
    for (const [turnNum, turnEvents] of byTurn) {
      const evRows = turnEvents.map(ev => {
        const type    = ev.type || ev.kind || '?';
        const payload = ev.payload || ev.data || {};
        const cat     = getEventCategory(type);
        const label   = toScrabLabel(type);
        const summary = renderEventPayloadSummary(type, payload);
        const ts      = ev.timestamp ? formatTimestamp(ev.timestamp) : '';

        return `
          <div style="display:flex;gap:10px;align-items:flex-start;padding:6px 10px;border-radius:6px;background:${cat.bg};border:1px solid ${cat.border};margin-bottom:4px;">
            <div style="font-size:10px;color:${cat.color};font-weight:700;min-width:180px;padding-top:1px;">${escapeHtml(label)}</div>
            <div style="flex:1;font-size:12px;color:#334155;line-height:1.5;">${summary || '<span style="opacity:0.5;">—</span>'}</div>
            ${ts ? `<div style="font-size:10px;color:#94a3b8;white-space:nowrap;">${escapeHtml(ts)}</div>` : ''}
          </div>`;
      }).join('');

      html += `
        <div style="margin-bottom:10px;">
          <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;padding:4px 0;">
            Turn ${turnNum} — ${turnEvents.length} event${turnEvents.length !== 1 ? 's' : ''}
          </div>
          ${evRows}
        </div>`;
    }

    return `
      <div class="events-section">
        <button class="events-toggle">
          <span>Full Event Trace (${events.length} events across ${byTurn.size} turn${byTurn.size !== 1 ? 's' : ''})</span>
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="events-list" style="max-height:500px;overflow-y:auto;padding:12px;">
          ${html}
        </div>
      </div>
    `;
  }

  /* ==========================================================================
     SECTION 9: FILTERS & PAGINATION
     ========================================================================== */
  
  /**
   * Handle filter changes
   */
  function handleFilterChange() {
    state.filters.search = DOM.filterSearch.value.trim();
    state.filters.status = DOM.filterStatus.value;
    state.filters.dateRange = DOM.filterDate.value;
    state.currentPage = 1;
    loadCalls();
  }

  /**
   * Clear all filters
   */
  function clearFilters() {
    DOM.filterSearch.value = '';
    DOM.filterStatus.value = '';
    DOM.filterDate.value = 'week';
    state.filters = { search: '', status: '', dateRange: 'week' };
    state.currentPage = 1;
    loadCalls();
  }

  /**
   * Navigate to a specific page
   * @param {number} page - Page number
   */
  function goToPage(page) {
    if (page < 1 || page > state.totalPages) return;
    state.currentPage = page;
    loadCalls();
  }

  /**
   * Update pagination UI
   */
  function updatePagination() {
    DOM.paginationInfo.textContent = `Page ${state.currentPage} of ${state.totalPages}`;
    DOM.btnPrevPage.disabled = state.currentPage <= 1;
    DOM.btnNextPage.disabled = state.currentPage >= state.totalPages;
  }

  /* ==========================================================================
     SECTION 9B: BULK SELECTION & DELETE
     ========================================================================== */

  /**
   * Handle "Select All" checkbox change
   */
  function handleSelectAll() {
    const isChecked = DOM.selectAllCheckbox.checked;
    
    if (isChecked) {
      state.calls.forEach(call => state.selectedCallSids.add(call.callSid));
    } else {
      state.selectedCallSids.clear();
    }

    updateRowSelectionUI();
    updateBulkActionsBar();
  }

  /**
   * Handle individual row checkbox change
   * @param {HTMLElement} row - The table row element
   * @param {boolean} isChecked - Whether checkbox is checked
   */
  function handleRowCheckboxChange(row, isChecked) {
    const callSid = row.dataset.callsid;
    
    if (isChecked) {
      state.selectedCallSids.add(callSid);
      row.classList.add('selected');
    } else {
      state.selectedCallSids.delete(callSid);
      row.classList.remove('selected');
    }

    updateSelectAllCheckbox();
    updateBulkActionsBar();
  }

  /**
   * Update the "Select All" checkbox state based on individual selections
   */
  function updateSelectAllCheckbox() {
    const totalCalls = state.calls.length;
    const selectedCount = state.selectedCallSids.size;
    
    if (selectedCount === 0) {
      DOM.selectAllCheckbox.checked = false;
      DOM.selectAllCheckbox.indeterminate = false;
    } else if (selectedCount === totalCalls) {
      DOM.selectAllCheckbox.checked = true;
      DOM.selectAllCheckbox.indeterminate = false;
    } else {
      DOM.selectAllCheckbox.checked = false;
      DOM.selectAllCheckbox.indeterminate = true;
    }
  }

  /**
   * Update all row checkboxes to match selection state
   */
  function updateRowSelectionUI() {
    DOM.callListBody.querySelectorAll('tr[data-callsid]').forEach(row => {
      const callSid = row.dataset.callsid;
      const checkbox = row.querySelector('.call-checkbox');
      const isSelected = state.selectedCallSids.has(callSid);

      if (checkbox) {
        checkbox.checked = isSelected;
      }
      row.classList.toggle('selected', isSelected);
    });
  }

  /**
   * Update the bulk actions bar visibility and count
   */
  function updateBulkActionsBar() {
    const count = state.selectedCallSids.size;
    
    if (count > 0) {
      DOM.bulkActionsBar.classList.add('visible');
      DOM.bulkActionsCount.textContent = `${count} selected`;
    } else {
      DOM.bulkActionsBar.classList.remove('visible');
    }
  }

  /**
   * Clear all selections
   */
  function clearSelection() {
    state.selectedCallSids.clear();
    DOM.selectAllCheckbox.checked = false;
    DOM.selectAllCheckbox.indeterminate = false;
    updateRowSelectionUI();
    updateBulkActionsBar();
  }

  /**
   * Delete all selected calls
   */
  async function deleteSelectedCalls() {
    const count = state.selectedCallSids.size;
    
    if (count === 0) {
      showToast('warning', 'No Selection', 'Please select calls to delete.');
      return;
    }

    const confirmMsg = `Are you sure you want to delete ${count} call${count !== 1 ? 's' : ''}? This action cannot be undone.`;
    
    if (!confirm(confirmMsg)) {
      return;
    }

    const callSidsToDelete = Array.from(state.selectedCallSids);

    try {
      showToast('info', 'Deleting...', `Deleting ${count} call${count !== 1 ? 's' : ''}...`);
      
      const response = await AgentConsoleAuth.apiFetch(
        `${CONFIG.API_BASE}/${state.companyId}/calls/bulk-delete`,
        {
          method: 'DELETE',
          // AgentConsoleAuth.apiFetch JSON-stringifies objects automatically.
          body: { callSids: callSidsToDelete }
        }
      );

      const deletedCount = response.deletedCount || count;
      showToast('success', 'Deleted', `Successfully deleted ${deletedCount} call${deletedCount !== 1 ? 's' : ''}.`);
      
      clearSelection();
      loadCalls();

    } catch (error) {
      console.error('[CallConsole] Failed to delete calls:', error);
      showToast('error', 'Delete Failed', error.message || 'Could not delete selected calls.');
    }
  }

  /* ==========================================================================
     SECTION 10: MODAL MANAGEMENT
     ========================================================================== */
  
  function openModal() {
    state.isModalOpen = true;
    DOM.callDetailModal.classList.add('open');
    document.body.style.overflow = 'hidden';
    state.isModalFullscreen = true;
    DOM.callDetailModal.classList.add('fullscreen');
    if (DOM.btnToggleFullscreen) DOM.btnToggleFullscreen.textContent = 'Collapse';
  }

  function closeModal() {
    state.isModalOpen = false;
    state.isModalFullscreen = false;
    DOM.callDetailModal.classList.remove('fullscreen');
    if (DOM.btnToggleFullscreen) DOM.btnToggleFullscreen.textContent = 'Expand';
    DOM.callDetailModal.classList.remove('open');
    document.body.style.overflow = '';
    state.selectedCall = null;
  }

  function toggleModalFullscreen() {
    state.isModalFullscreen = !state.isModalFullscreen;
    DOM.callDetailModal.classList.toggle('fullscreen', state.isModalFullscreen);
    if (DOM.btnToggleFullscreen) {
      DOM.btnToggleFullscreen.textContent = state.isModalFullscreen ? 'Collapse' : 'Expand';
    }
  }

  /* ==========================================================================
     SECTION 11: EXPORT & DOWNLOAD
     ========================================================================== */
  
  /**
   * Export all calls matching current filters
   */
  async function exportCalls() {
    try {
      showToast('info', 'Exporting...', 'Preparing call export...');

      const params = new URLSearchParams({
        dateRange: state.filters.dateRange,
        format: 'json'
      });

      if (state.filters.search) params.set('search', state.filters.search);
      if (state.filters.status) params.set('status', state.filters.status);

      const response = await AgentConsoleAuth.apiFetch(
        `${CONFIG.API_BASE}/${state.companyId}/calls/export?${params.toString()}`
      );

      const jsonString = JSON.stringify(response, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
      const filename = `calls_${state.companyId}_${timestamp}.json`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast('success', 'Exported', `Downloaded ${filename}`);
    } catch (error) {
      console.error('[CallConsole] Export failed:', error);
      showToast('error', 'Export Failed', 'Could not export calls.');
    }
  }

  /**
   * Download a detailed report for the selected call
   */
  async function downloadCallReport() {
    if (!state.selectedCall) return;

    try {
      const call = state.selectedCall;
      const report = {
        exportedAt: new Date().toISOString(),
        companyId: state.companyId,
        companyName: state.companyName,
        call: {
          callSid: call.callSid,
          fromPhone: call.fromPhone,
          toPhone: call.toPhone,
          startTime: call.startTime,
          durationSeconds: call.durationSeconds,
          llmUsage: call.llmUsage,
          problems: call.problems,
          turns: call.turns,
          events: call.events,
          trace: call.trace
        },
        provenanceSummary: buildProvenanceSummary(call.turns || []),
        scrabTimeline: buildScrabTimeline(call)
      };

      const jsonString = JSON.stringify(report, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const filename = `call_report_${call.callSid}.json`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast('success', 'Downloaded', `Report saved as ${filename}`);
    } catch (error) {
      console.error('[CallConsole] Download report failed:', error);
      showToast('error', 'Download Failed', 'Could not generate report.');
    }
  }

  /* ==========================================================================
     SECTION 12: NAVIGATION
     ========================================================================== */
  
  /**
   * Navigate to a page within Agent Console
   * @param {string} target - Target page identifier
   */
  function navigateTo(target) {
    const companyParam = `?companyId=${encodeURIComponent(state.companyId)}`;
    const baseUrl = '/agent-console';

    switch (target) {
      case 'dashboard':
        window.location.href = `${baseUrl}/index.html${companyParam}`;
        break;
      case 'agent2':
        window.location.href = `${baseUrl}/agent2.html${companyParam}`;
        break;
      case 'booking':
        window.location.href = `${baseUrl}/booking.html${companyParam}`;
        break;
      case 'triggers':
        window.location.href = `${baseUrl}/triggers.html${companyParam}`;
        break;
      default:
        console.warn('[CallConsole] Unknown navigation target:', target);
    }
  }

  /**
   * Build a link to the relevant UI page for a provenance path
   * @param {string} uiPath - The UI path (e.g., "greetings.callStart")
   * @returns {Object|null} Link object with href and label, or null
   */
  function buildUILink(uiPath, focusId = null, editId = null, editField = null) {
    if (!uiPath) return null;

    // Find matching tab config from canonical and normalized path candidates.
    const pathCandidates = normalizeUiPathForLookup(uiPath);
    const pathPrefix = pathCandidates
      .map(candidate => Object.keys(CONFIG.UI_TAB_MAP).find(key => candidate.startsWith(key)))
      .find(Boolean);
    if (!pathPrefix) return null;

    const tabConfig = CONFIG.UI_TAB_MAP[pathPrefix];
    const params = new URLSearchParams();
    params.set('companyId', state.companyId);
    if (focusId) params.set('focus', focusId);
    if (tabConfig.page === 'triggers.html' && editId) {
      const normalizedEdit = `${editId}`.startsWith('trigger-') ? `${editId}` : `trigger-${editId}`;
      params.set('edit', normalizedEdit);
      if (editField) params.set('field', editField);
    }
    const companyParam = `?${params.toString()}`;
    
    return {
      href: `/agent-console/${tabConfig.page}${companyParam}#${tabConfig.tab}`,
      label: `${tabConfig.section} (${tabConfig.page.replace('.html', '')})`
    };
  }

  function normalizeUiPathForDisplay(uiPath) {
    if (!uiPath) return uiPath;
    if (pathNamespace && typeof pathNamespace.toDisplayConfigPath === 'function') {
      return pathNamespace.toDisplayConfigPath(uiPath);
    }
    return uiPath;
  }

  function normalizeUiPathForLookup(uiPath) {
    if (!uiPath) return [];
    if (pathNamespace && typeof pathNamespace.toLookupCandidates === 'function') {
      const candidates = pathNamespace.toLookupCandidates(uiPath);
      return Array.isArray(candidates) && candidates.length > 0 ? candidates : [uiPath];
    }
    return [uiPath];
  }

  function extractTriggerIdFromUiPath(uiPath) {
    if (!uiPath || typeof uiPath !== 'string') return null;
    const match = uiPath.match(/rules\[id=([^\]]+)\]/i);
    if (match && match[1]) return match[1];
    return null;
  }

  /* ==========================================================================
     SECTION 13: UTILITY FUNCTIONS
     ========================================================================== */
  
  /**
   * Set loading state
   * @param {boolean} isLoading - Loading state
   */
  function setLoading(isLoading) {
    state.isLoading = isLoading;
    DOM.btnRefreshCalls.disabled = isLoading;
    DOM.btnExportCalls.disabled = isLoading;

    if (isLoading) {
      DOM.callListBody.innerHTML = `
        <tr class="loading-row">
          <td colspan="8">
            <div class="loading-spinner"></div>
          </td>
        </tr>
      `;
    }
  }

  /**
   * Update footer environment indicator
   */
  function updateFooter() {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      DOM.footerEnvironment.textContent = 'Development';
    } else if (hostname.includes('staging') || hostname.includes('test')) {
      DOM.footerEnvironment.textContent = 'Staging';
    } else {
      DOM.footerEnvironment.textContent = 'Production';
    }
  }

  /**
   * Count hardcoded violations in turns
   * @param {Array} turns - Array of turns
   * @returns {number} Count
   */
  function countViolations(turns) {
    return turns.filter(t => t.provenance?.type === 'HARDCODED').length;
  }

  /**
   * Count fallback usages in turns
   * @param {Array} turns - Array of turns
   * @returns {number} Count
   */
  function countFallbacks(turns) {
    return turns.filter(t => t.provenance?.type === 'FALLBACK').length;
  }

  /**
   * Build provenance summary with bridge/real agent separation.
   * Bridge filler turns must never inflate "agent response compliance".
   * @param {Array} turns
   * @returns {Object}
   */
  function buildProvenanceSummary(turns) {
    const isBridge = (t) => t.provenance?.isBridge === true || t.source === 'AGENT2_BRIDGE';
    const agentTurns = turns.filter(t => t.speaker === 'agent');
    const realAgentTurns = agentTurns.filter(t => !isBridge(t));
    const bridgeTurns = turns.filter(t => isBridge(t));

    return {
      totalAgentTurns: agentTurns.length,
      agentTurnsReal: realAgentTurns.length,
      bridgeTurns: bridgeTurns.length,
      agentTurnsTraced: realAgentTurns.filter(t => t.provenance?.type === 'UI_OWNED').length,
      uiOwned: turns.filter(t => t.provenance?.type === 'UI_OWNED' && !isBridge(t)).length,
      fallbacks: countFallbacks(turns),
      violations: countViolations(turns)
    };
  }

  /* ==========================================================================
     SECTION 14: FORMATTING HELPERS
     ========================================================================== */
  
  /**
   * Format phone number for display
   * @param {string} phone - Raw phone number
   * @returns {string} Formatted phone
   */
  function formatPhone(phone) {
    if (!phone) return 'Unknown';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return phone;
  }

  /**
   * Format time for display (relative or absolute)
   * @param {string|Date} timestamp - Timestamp
   * @returns {string} Formatted time
   */
  function formatTime(timestamp) {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  /**
   * Format full date and time
   * @param {string|Date} timestamp - Timestamp
   * @returns {string} Formatted datetime
   */
  function formatDateTime(timestamp) {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
   * Format duration in seconds to mm:ss
   * @param {number} seconds - Duration in seconds
   * @returns {string} Formatted duration
   */
  function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Format timestamp for transcript display
   * @param {string|Date} timestamp - Timestamp
   * @returns {string} Formatted timestamp
   */
  function formatTimestamp(timestamp) {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
   * Escape HTML entities
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Debounce function for rate-limiting
   * @param {Function} func - Function to debounce
   * @param {number} wait - Wait time in ms
   * @returns {Function} Debounced function
   */
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /* ==========================================================================
     SECTION 15: TOAST NOTIFICATIONS
     ========================================================================== */
  
  /**
   * Show a toast notification
   * @param {string} type - Toast type (success, error, warning, info)
   * @param {string} title - Toast title
   * @param {string} message - Toast message
   */
  function showToast(type, title, message) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const iconSvg = getToastIcon(type);

    toast.innerHTML = `
      <div class="toast-icon">${iconSvg}</div>
      <div class="toast-content">
        <div class="toast-title">${escapeHtml(title)}</div>
        ${message ? `<div class="toast-message">${escapeHtml(message)}</div>` : ''}
      </div>
      <button class="toast-close" onclick="this.parentElement.remove()">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    `;

    DOM.toastContainer.appendChild(toast);

    setTimeout(() => {
      if (toast.parentElement) {
        toast.remove();
      }
    }, 5000);
  }

  /**
   * Get SVG icon for toast type
   * @param {string} type - Toast type
   * @returns {string} SVG HTML
   */
  function getToastIcon(type) {
    switch (type) {
      case 'success':
        return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="10" cy="10" r="8" stroke="#22c55e" stroke-width="1.5"/>
          <path d="M6 10L9 13L14 7" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
      case 'error':
        return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="10" cy="10" r="8" stroke="#ef4444" stroke-width="1.5"/>
          <path d="M7 7L13 13M13 7L7 13" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`;
      case 'warning':
        return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 3L18 17H2L10 3Z" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M10 8V11M10 14V14.5" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`;
      default:
        return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="10" cy="10" r="8" stroke="#3b82f6" stroke-width="1.5"/>
          <path d="M10 6V10M10 14V14.5" stroke="#3b82f6" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`;
    }
  }

  /* ==========================================================================
     SECTION 16: BOOTSTRAP
     ========================================================================== */
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
