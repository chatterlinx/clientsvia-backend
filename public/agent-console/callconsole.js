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
      'PATIENCE_FINAL_CHECKIN': 'Patience Final Check-in'
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
      'globalHub.vocabulary': { page: 'global-hub.html', tab: 'vocabulary', section: 'Vocabulary' }
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
    isModalOpen: false
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

    const interesting = normalizedEvents.filter(ev => {
      if (!ev.type) return false;
      return ev.type === 'INPUT_TEXT_FINALIZED'
        || ev.type === 'CALLER_NAME_EXTRACTED'
        || ev.type === 'NAME_GREETING_FIRED'
        || ev.type === 'PATIENCE_MODE_ACTIVE'
        || ev.type === 'PATIENCE_TIMEOUT_CHECK_IN'
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
      INPUT_TEXT_FINALIZED: 'Raw Input',
      SCRABENGINE_ENTRY: 'ScrabEngine Entry',
      SCRABENGINE_STAGE1: 'Stage 1 Fillers',
      SCRABENGINE_STAGE2: 'Stage 2 Vocabulary',
      SCRABENGINE_STAGE3: 'Stage 3 Expansion',
      SCRABENGINE_STAGE4: 'Stage 4 Extraction',
      SCRABENGINE_STAGE5: 'Stage 5 Quality',
      SCRABENGINE_DELIVERY: 'Final Delivery',
      SCRABENGINE_PROCESSED: 'Processing Summary',
      SCRABENGINE_QUALITY_FAILED: 'Quality Failure',
      CALLER_NAME_EXTRACTED: 'Caller Name Extracted',
      NAME_GREETING_FIRED: 'Name Greeting',
      PATIENCE_MODE_ACTIVE: 'Patience Mode',
      PATIENCE_TIMEOUT_CHECK_IN: 'Patience Check-in'
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
      const status = s.status || (s.changes?.length > 0 ? 'modified' : 'unchanged');
      stages.push(renderScrabStageChip('2', 'Vocab', s.summary || s.text, status));
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
      const focusId =
        provenance.uiAnchor ||
        (provenance.triggerId ? `trigger-${provenance.triggerId}` : null);

      const uiLink = buildUILink(provenance.uiPath, focusId);
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
  function renderDiagnosticRoadmap(call) {
    const turns = call.turns || [];
    const events = call.events || [];
    const trace = call.trace || [];
    
    // Build sequence from actual call data
    const callerTurns = turns.filter(t => t.speaker === 'caller');
    const agentTurns = turns.filter(t => t.speaker === 'agent');
    
    if (callerTurns.length === 0) {
      return `
        <div class="diagnostic-roadmap" style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 12px; padding: 20px; margin: 16px 0;">
          <h4 style="color: #b45309; margin: 0 0 12px 0;">⚠️ No Caller Input Detected</h4>
          <p style="font-size: 13px; color: #92400e;">
            This call has no caller turns. Cannot analyze decision path.
          </p>
        </div>
      `;
    }
    
    // Analyze first turn to show decision path
    const firstCallerTurn = callerTurns[0];
    const firstAgentTurn = agentTurns[0];
    const callerText = firstCallerTurn?.text || '';
    const agentResponse = firstAgentTurn?.text || '';
    const agentSource = firstAgentTurn?.source || 'UNKNOWN';
    const hasEvents = events.length > 0 || trace.length > 0;
    
    // Check for specific event types to determine what happened
    const scrabEvent = [...events, ...trace].find(e => 
      e.type === 'SCRABENGINE_PROCESSED' || e.kind === 'SCRABENGINE_PROCESSED'
    );
    const greetingEvent = [...events, ...trace].find(e => 
      e.type === 'A2_GREETING_EVALUATED' || e.kind === 'A2_GREETING_EVALUATED'
    );
    const triggerEvent = [...events, ...trace].find(e => 
      e.type === 'A2_TRIGGER_EVAL' || e.kind === 'A2_TRIGGER_EVAL'
    );
    const pathEvent = [...events, ...trace].find(e => 
      e.type === 'A2_PATH_SELECTED' || e.kind === 'A2_PATH_SELECTED'
    );
    
    // Determine what happened based on response
    const isFallback = agentResponse.toLowerCase().includes('cut out') || 
                      agentResponse.toLowerCase().includes('how can i help');
    const isGreeting = agentResponse.toLowerCase().includes('hello') && agentResponse.length < 50;
    
    return `
      <div class="diagnostic-roadmap" style="background: #ffffff; border: 2px solid #3b82f6; border-radius: 12px; padding: 20px; margin: 16px 0;">
        <h3 style="color: #1e40af; margin: 0 0 16px 0; font-size: 16px; display: flex; align-items: center; gap: 8px;">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2V18M10 2L6 6M10 2L14 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          🗺️ DIAGNOSTIC ROADMAP - Turn 1
        </h3>
        
        ${!hasEvents ? `
          <div style="background: #fee2e2; border: 1px solid #ef4444; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
            <strong style="color: #991b1b;">⚠️ NO EVENTS CAPTURED</strong>
            <p style="font-size: 13px; color: #7f1d1d; margin: 8px 0 0 0;">
              This call has no event data. Cannot show detailed decision path.
              <br><br>
              <strong>Likely Reason:</strong> Call was made before V125 event logging was deployed.
              <br>
              <strong>Solution:</strong> Make a new test call to see full diagnostic data.
            </p>
          </div>
        ` : ''}
        
        <div style="display: grid; gap: 12px;">
          <!-- Step 1: Caller Input -->
          <div style="display: flex; gap: 12px; align-items: flex-start;">
            <div style="min-width: 40px; height: 40px; border-radius: 50%; background: #10b981; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; flex-shrink: 0;">1</div>
            <div style="flex: 1; background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 12px;">
              <div style="font-weight: 600; color: #166534; margin-bottom: 6px;">📝 Caller Input (RAW)</div>
              <div style="font-size: 14px; color: #15803d;">"${escapeHtml(callerText.substring(0, 200))}"</div>
              <div style="font-size: 12px; color: #16a34a; margin-top: 6px;">✅ Received from Deepgram STT</div>
            </div>
          </div>
          
          <!-- Arrow -->
          <div style="text-align: center; color: #cbd5e1; font-size: 24px; font-weight: 700; margin: -8px 0;">↓</div>
          
          <!-- Step 2: ScrabEngine -->
          <div style="display: flex; gap: 12px; align-items: flex-start;">
            <div style="min-width: 40px; height: 40px; border-radius: 50%; background: ${scrabEvent ? '#10b981' : '#ef4444'}; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; flex-shrink: 0;">${scrabEvent ? '2' : '🚫'}</div>
            <div style="flex: 1; background: ${scrabEvent ? '#f0fdf4' : '#fef2f2'}; border: 1px solid ${scrabEvent ? '#86efac' : '#fca5a5'}; border-radius: 8px; padding: 12px;">
              <div style="font-weight: 600; color: ${scrabEvent ? '#166534' : '#991b1b'}; margin-bottom: 6px;">
                🔍 ScrabEngine Processing
              </div>
              ${scrabEvent ? `
                <div style="font-size: 13px; color: #15803d;">
                  ✅ Text processed (4-step pipeline)
                  <br>Cleaned text ready for trigger matching
                </div>
              ` : `
                <div style="font-size: 13px; color: #991b1b;">
                  ❌ NO SCRABENGINE EVENT FOUND
                  <br><strong>This is the problem!</strong> Text was not cleaned before trigger matching.
                  <br><br>
                  <strong>Root Cause:</strong> Old code (pre-V125) or ScrabEngine failed
                  <br><strong>Fix:</strong> V125 deployed - make new test call
                </div>
              `}
            </div>
          </div>
          
          <!-- Arrow -->
          <div style="text-align: center; color: #cbd5e1; font-size: 24px; font-weight: 700; margin: -8px 0;">↓</div>
          
          <!-- Step 3: Greeting Check -->
          <div style="display: flex; gap: 12px; align-items: flex-start;">
            <div style="min-width: 40px; height: 40px; border-radius: 50%; background: ${greetingEvent ? '#10b981' : '#f59e0b'}; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; flex-shrink: 0;">${greetingEvent ? '3' : '⚠️'}</div>
            <div style="flex: 1; background: ${greetingEvent ? '#f0fdf4' : '#fffbeb'}; border: 1px solid ${greetingEvent ? '#86efac' : '#fcd34d'}; border-radius: 8px; padding: 12px;">
              <div style="font-weight: 600; color: ${greetingEvent ? '#166534' : '#b45309'}; margin-bottom: 6px;">
                🎭 Greeting Interceptor
              </div>
              ${greetingEvent ? `
                <div style="font-size: 13px; color: #15803d;">
                  Checked for greeting on cleaned text
                </div>
              ` : `
                <div style="font-size: 13px; color: #92400e;">
                  ⚠️ No greeting event - old code or events not captured
                </div>
              `}
            </div>
          </div>
          
          <!-- Arrow -->
          <div style="text-align: center; color: #cbd5e1; font-size: 24px; font-weight: 700; margin: -8px 0;">↓</div>
          
          <!-- Step 4: Trigger Evaluation -->
          <div style="display: flex; gap: 12px; align-items: flex-start;">
            <div style="min-width: 40px; height: 40px; border-radius: 50%; background: ${triggerEvent ? '#10b981' : '#ef4444'}; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; flex-shrink: 0;">${triggerEvent ? '4' : '🚫'}</div>
            <div style="flex: 1; background: ${triggerEvent ? '#f0fdf4' : '#fef2f2'}; border: 1px solid ${triggerEvent ? '#86efac' : '#fca5a5'}; border-radius: 8px; padding: 12px;">
              <div style="font-weight: 600; color: ${triggerEvent ? '#166534' : '#991b1b'}; margin-bottom: 6px;">
                🎯 Trigger Evaluation
              </div>
              ${triggerEvent ? `
                <div style="font-size: 13px; color: #15803d;">
                  ${triggerEvent.payload?.matched ? '✅ TRIGGER MATCHED' : '❌ NO TRIGGER MATCHED'}
                  ${triggerEvent.payload?.cardLabel ? '<br>Card: ' + escapeHtml(triggerEvent.payload.cardLabel) : ''}
                  ${triggerEvent.payload?.totalCards ? '<br>Evaluated: ' + triggerEvent.payload.totalCards + ' cards' : ''}
                </div>
              ` : `
                <div style="font-size: 13px; color: #991b1b;">
                  🚫 STEP SKIPPED - Triggers never evaluated!
                  <br><br>
                  <strong>This is why agent gave wrong response!</strong>
                  <br><br>
                  <strong>Root Cause:</strong> Greeting exited early (pre-V125 bug)
                  <br><strong>Fix:</strong> V125 deployed - ScrabEngine now runs first
                </div>
              `}
            </div>
          </div>
          
          <!-- Arrow -->
          <div style="text-align: center; color: #cbd5e1; font-size: 24px; font-weight: 700; margin: -8px 0;">↓</div>
          
          <!-- Step 5: Response Generated -->
          <div style="display: flex; gap: 12px; align-items: flex-start;">
            <div style="min-width: 40px; height: 40px; border-radius: 50%; background: ${isFallback ? '#ef4444' : '#10b981'}; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; flex-shrink: 0;">5</div>
            <div style="flex: 1; background: ${isFallback ? '#fef2f2' : '#f0fdf4'}; border: 1px solid ${isFallback ? '#fca5a5' : '#86efac'}; border-radius: 8px; padding: 12px;">
              <div style="font-weight: 600; color: ${isFallback ? '#991b1b' : '#166534'}; margin-bottom: 6px;">
                💬 Agent Response
              </div>
              <div style="font-size: 13px; color: ${isFallback ? '#991b1b' : '#15803d'}; margin-bottom: 8px;">
                "${escapeHtml(agentResponse.substring(0, 150))}"
              </div>
              <div style="font-size: 12px; color: ${isFallback ? '#7f1d1d' : '#16a34a'};">
                ${isFallback ? '❌ FALLBACK RESPONSE (Generic/Wrong)' : '✅ Contextual Response'}
                <br>Source: ${escapeHtml(agentSource)}
                ${firstAgentTurn?.provenance?.uiPath ? '<br>UI Path: ' + escapeHtml(firstAgentTurn.provenance.uiPath) : ''}
              </div>
            </div>
          </div>
          
          <!-- Summary -->
          <div style="background: ${isFallback || !triggerEvent ? '#fef2f2' : '#f0fdf4'}; border: 2px solid ${isFallback || !triggerEvent ? '#ef4444' : '#10b981'}; border-radius: 10px; padding: 16px; margin-top: 12px;">
            <div style="font-weight: 700; font-size: 14px; color: ${isFallback || !triggerEvent ? '#991b1b' : '#166534'}; margin-bottom: 8px;">
              ${isFallback || !triggerEvent ? '🚨 SEQUENCE DEVIATION DETECTED' : '✅ SEQUENCE FOLLOWED CORRECTLY'}
            </div>
            <div style="font-size: 13px; color: ${isFallback || !triggerEvent ? '#7f1d1d' : '#15803d'};">
              <strong>Path Taken:</strong> 1 → ${scrabEvent ? '2' : '🚫'} → ${greetingEvent ? '3' : '🚫'} → ${triggerEvent ? '4' : '🚫'} → 5
              <br><br>
              ${!scrabEvent ? '❌ <strong>Step 2 MISSING:</strong> ScrabEngine didn\'t process text<br>' : ''}
              ${!triggerEvent ? '❌ <strong>Step 4 SKIPPED:</strong> Triggers never evaluated<br>' : ''}
              ${isFallback ? '❌ <strong>Step 5 WRONG:</strong> Generic fallback instead of trigger response<br>' : ''}
              <br>
              ${!hasEvents ? `
                <strong>ROOT CAUSE:</strong> No events captured - call was before V125 deployment
                <br><strong>ACTION:</strong> Make a new test call to verify V125 fix
              ` : triggerEvent?.payload?.matched ? `
                <strong>SUCCESS:</strong> Trigger matched and fired correctly!
              ` : `
                <strong>ISSUE:</strong> Triggers evaluated but none matched
                <br><strong>ACTION:</strong> Check trigger configuration for this company
              `}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderEventsSection(events) {
    if (events.length === 0) {
      return '';
    }

    const eventItems = events.map(event => `
      <div class="event-item">
        <span class="event-time">${formatTimestamp(event.timestamp)}</span>
        <span class="event-type">${escapeHtml(event.type)}</span>
        <span class="event-data">${escapeHtml(JSON.stringify(event.data || {}))}</span>
      </div>
    `).join('');

    return `
      <div class="events-section">
        <button class="events-toggle">
          <span>Call Events (${events.length})</span>
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="events-list">
          ${eventItems}
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
  }

  function closeModal() {
    state.isModalOpen = false;
    DOM.callDetailModal.classList.remove('open');
    document.body.style.overflow = '';
    state.selectedCall = null;
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
          events: call.events
        },
        provenanceSummary: buildProvenanceSummary(call.turns || [])
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
  function buildUILink(uiPath, focusId = null) {
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
