/**
 * Call Intelligence Console - Frontend Logic
 * 
 * Handles UI interactions, API calls, and data rendering
 * for the Call Intelligence system.
 * 
 * @module public/agent-console/call-intelligence
 */

(function() {
  'use strict';

  // =============================================================================
  // STATE MANAGEMENT
  // =============================================================================

  const state = {
    companyId: null,
    calls: [],
    currentPage: 1,
    totalPages: 1,
    filters: {
      status: '',
      timeRange: 'today',
      search: ''
    },
    gpt4Enabled: false,
    analysisMode: 'full',
    selectedCallSid: null
  };

  // =============================================================================
  // DOM REFERENCES
  // =============================================================================

  const DOM = {
    // Stats
    statToday: document.getElementById('stat-today'),
    statWeek: document.getElementById('stat-week'),
    statCritical: document.getElementById('stat-critical'),
    statNeedsWork: document.getElementById('stat-needs-work'),
    statGood: document.getElementById('stat-good'),
    statMatchRate: document.getElementById('stat-match-rate'),
    statTier1: document.getElementById('stat-tier1'),
    statTier2: document.getElementById('stat-tier2'),
    statTier3: document.getElementById('stat-tier3'),

    // Filters
    searchInput: document.getElementById('search-input'),
    filterStatus: document.getElementById('filter-status'),
    filterTime: document.getElementById('filter-time'),
    clearFiltersBtn: document.getElementById('clear-filters-btn'),

    // Table
    callsTbody: document.getElementById('calls-tbody'),
    callCount: document.getElementById('call-count'),
    selectAll: document.getElementById('select-all'),

    // Pagination
    prevPage: document.getElementById('prev-page'),
    nextPage: document.getElementById('next-page'),
    pageInfo: document.getElementById('page-info'),

    // Buttons
    refreshBtn: document.getElementById('refresh-btn'),
    settingsBtn: document.getElementById('settings-btn'),

    // Modals
    analysisModal: document.getElementById('analysis-modal'),
    modalBody: document.getElementById('modal-body'),
    closeModal: document.getElementById('close-modal'),
    copyAllBtn: document.getElementById('copy-all-btn'),
    exportPdfBtn: document.getElementById('export-pdf-btn'),

    settingsModal: document.getElementById('settings-modal'),
    closeSettings: document.getElementById('close-settings'),
    gpt4Toggle: document.getElementById('gpt4-toggle'),
    analysisMode: document.getElementById('analysis-mode'),
    gpt4Status: document.getElementById('gpt4-status'),
    statusText: document.getElementById('status-text'),
    saveSettingsBtn: document.getElementById('save-settings-btn'),
    autoAnalyzeToggle: document.getElementById('auto-analyze-toggle')
  };

  // =============================================================================
  // INITIALIZATION
  // =============================================================================

  function init() {
    state.companyId = getCompanyIdFromUrl();
    
    if (!state.companyId) {
      console.error('Company ID not found in URL');
      return;
    }

    const backLink = document.getElementById('back-link');
    if (backLink) {
      backLink.href = `/agent-console/?companyId=${state.companyId}`;
    }

    attachEventListeners();
    loadGPT4Status();
    loadSummary();
    loadCalls();
  }

  function getCompanyIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('companyId');
  }

  // =============================================================================
  // EVENT LISTENERS
  // =============================================================================

  function attachEventListeners() {
    // Filters
    DOM.searchInput.addEventListener('input', debounce(handleSearch, 300));
    DOM.filterStatus.addEventListener('change', handleFilterChange);
    DOM.filterTime.addEventListener('change', handleFilterChange);
    DOM.clearFiltersBtn.addEventListener('click', clearFilters);

    // Pagination
    DOM.prevPage.addEventListener('click', () => changePage(state.currentPage - 1));
    DOM.nextPage.addEventListener('click', () => changePage(state.currentPage + 1));

    // Buttons
    DOM.refreshBtn.addEventListener('click', handleRefresh);
    DOM.settingsBtn.addEventListener('click', openSettings);

    // Modals
    DOM.closeModal.addEventListener('click', closeAnalysisModal);
    DOM.closeSettings.addEventListener('click', closeSettingsModal);
    DOM.copyAllBtn.addEventListener('click', copyAnalysisToClipboard);
    DOM.saveSettingsBtn.addEventListener('click', saveSettings);

    // Close modal on outside click
    DOM.analysisModal.addEventListener('click', (e) => {
      if (e.target === DOM.analysisModal) closeAnalysisModal();
    });
    DOM.settingsModal.addEventListener('click', (e) => {
      if (e.target === DOM.settingsModal) closeSettingsModal();
    });
  }

  // =============================================================================
  // API CALLS
  // =============================================================================

  async function apiCall(endpoint, options = {}) {
    try {
      const response = await fetch(endpoint, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'API request failed');
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      showNotification(error.message, 'error');
      throw error;
    }
  }

  async function loadSummary() {
    try {
      const data = await apiCall(
        `/api/call-intelligence/company/${state.companyId}/summary?timeRange=${state.filters.timeRange}`
      );

      updateStats(data.summary);
    } catch (error) {
      console.error('Failed to load summary:', error);
    }
  }

  async function loadCalls() {
    try {
      console.log('[CallIntelligence UI] Loading calls for company:', state.companyId);
      showLoading();

      const params = new URLSearchParams({
        page: state.currentPage,
        limit: 50,
        ...(state.filters.status && { status: state.filters.status }),
        ...(state.filters.timeRange && { timeRange: state.filters.timeRange })
      });

      console.log('[CallIntelligence UI] Calling API:', `/api/call-intelligence/company/${state.companyId}/list?${params}`);

      const data = await apiCall(
        `/api/call-intelligence/company/${state.companyId}/list?${params}`
      );

      console.log('[CallIntelligence UI] Received', data.items?.length || 0, 'calls');

      state.calls = data.items || [];
      state.totalPages = data.pages || 1;

      renderCalls();
      updatePagination();
      updateTierStats(state.calls);
    } catch (error) {
      console.error('[CallIntelligence UI] Failed to load calls:', error);
      showError(error.message);
    }
  }

  async function loadCallAnalysis(callSid) {
    try {
      const data = await apiCall(`/api/call-intelligence/${callSid}`);
      return data.intelligence;
    } catch (error) {
      console.error('Failed to load analysis:', error);
      return null;
    }
  }

  async function analyzeCall(callSid) {
    try {
      showNotification('Analyzing call...', 'info');

      const data = await apiCall(`/api/call-intelligence/analyze/${callSid}`, {
        method: 'POST',
        body: JSON.stringify({
          useGPT4: state.gpt4Enabled,
          mode: state.analysisMode
        })
      });

      showNotification('Analysis complete!', 'success');
      return data.intelligence;
    } catch (error) {
      showNotification('Analysis failed', 'error');
      throw error;
    }
  }

  async function loadGPT4Status() {
    try {
      const [statusData, settingsData] = await Promise.all([
        apiCall('/api/call-intelligence/status'),
        apiCall(`/api/call-intelligence/settings/${state.companyId}`)
      ]);
      
      state.gpt4Enabled = statusData.status.enabled;
      
      if (settingsData.settings) {
        state.analysisMode = settingsData.settings.analysisMode || 'full';
        DOM.autoAnalyzeToggle.checked = settingsData.settings.autoAnalyzeEnabled || false;
      }
      
      updateGPT4StatusUI(statusData.status);
    } catch (error) {
      console.error('Failed to load GPT-4 status:', error);
    }
  }

  async function toggleGPT4(enabled) {
    try {
      const data = await apiCall('/api/call-intelligence/toggle', {
        method: 'POST',
        body: JSON.stringify({ enabled })
      });

      state.gpt4Enabled = data.status.enabled;
      updateGPT4StatusUI(data.status);
      showNotification(data.message, 'success');
    } catch (error) {
      DOM.gpt4Toggle.checked = !enabled;
      showNotification('Failed to toggle GPT-4', 'error');
    }
  }

  // =============================================================================
  // RENDERING
  // =============================================================================

  function renderCalls() {
    if (state.calls.length === 0) {
      DOM.callsTbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="9" class="empty-cell">
            <p>No calls found</p>
          </td>
        </tr>
      `;
      DOM.callCount.textContent = '0 calls';
      return;
    }

    DOM.callCount.textContent = `${state.calls.length} calls`;

    DOM.callsTbody.innerHTML = state.calls.map(call => {
      const statusInfo = getStatusInfo(call.status);
      const timeAgo = formatTimeAgo(call.analyzedAt);
      
      return `
        <tr class="call-row" data-callsid="${call.callSid}">
          <td><input type="checkbox" class="row-checkbox"></td>
          <td class="col-time">${timeAgo}</td>
          <td class="col-from">${call.callMetadata.fromPhone || 'Unknown'}</td>
          <td class="col-duration">${formatDuration(call.callMetadata.duration)}</td>
          <td class="col-turns">${call.callMetadata.turns || 0}</td>
          <td class="col-tier">
            ${getTierBadge(call.callMetadata?.routingTier)}
          </td>
          <td class="col-provenance">
            <span class="provenance-badge">✓ UI-Owned</span>
          </td>
          <td class="col-intelligence">
            <div class="intelligence-cell ${statusInfo.className}">
              <div class="intelligence-status">
                <span class="status-icon">${statusInfo.icon}</span>
                <span class="status-text">${statusInfo.label}</span>
              </div>
              <div class="intelligence-summary">${call.topIssue || 'No issues'}</div>
              <button class="btn btn-small view-analysis-btn" data-callsid="${call.callSid}">
                VIEW ANALYSIS
              </button>
            </div>
          </td>
          <td class="col-callsid">
            <code class="callsid-text">${call.callSid.substring(0, 10)}...</code>
          </td>
        </tr>
      `;
    }).join('');

    attachCallRowListeners();
  }

  function attachCallRowListeners() {
    document.querySelectorAll('.view-analysis-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const callSid = btn.dataset.callsid;
        openAnalysisModal(callSid);
      });
    });
  }

  function updateStats(summary) {
    DOM.statToday.textContent = summary.total || 0;
    DOM.statWeek.textContent = summary.total || 0;
    DOM.statCritical.textContent = summary.critical || 0;
    DOM.statNeedsWork.textContent = summary.needsImprovement || 0;
    DOM.statGood.textContent = summary.performingWell || 0;
    DOM.statMatchRate.textContent = `${summary.matchRate || 0}%`;
  }

  function updatePagination() {
    DOM.prevPage.disabled = state.currentPage === 1;
    DOM.nextPage.disabled = state.currentPage === state.totalPages;
    DOM.pageInfo.textContent = `Page ${state.currentPage} of ${state.totalPages}`;
  }

  function updateGPT4StatusUI(status) {
    DOM.gpt4Toggle.checked = status.enabled;
    
    const statusIndicator = DOM.gpt4Status.querySelector('.status-indicator');
    
    if (status.enabled) {
      statusIndicator.style.color = '#10B981';
      DOM.statusText.textContent = `GPT-4 Enabled (${status.modelVersion || 'gpt-4-turbo-preview'})`;
      DOM.autoAnalyzeToggle.disabled = false;
    } else if (status.hasApiKey) {
      statusIndicator.style.color = '#F59E0B';
      DOM.statusText.textContent = 'GPT-4 Available but Disabled';
      DOM.autoAnalyzeToggle.disabled = true;
    } else {
      statusIndicator.style.color = '#DC2626';
      DOM.statusText.textContent = 'GPT-4 Not Configured (Missing API Key)';
      DOM.gpt4Toggle.disabled = true;
      DOM.autoAnalyzeToggle.disabled = true;
    }
  }

  // =============================================================================
  // MODAL HANDLING
  // =============================================================================

  async function openAnalysisModal(callSid) {
    state.selectedCallSid = callSid;
    
    DOM.modalBody.innerHTML = `
      <div class="loading-container">
        <div class="loading-spinner"></div>
        <p>Loading analysis...</p>
      </div>
    `;
    
    DOM.analysisModal.classList.add('active');
    document.body.style.overflow = 'hidden';

    let intelligence = await loadCallAnalysis(callSid);
    
    if (!intelligence) {
      console.log('[INFO] No existing analysis found, triggering analysis...');
      DOM.modalBody.innerHTML = `
        <div class="loading-container">
          <div class="loading-spinner"></div>
          <p>No analysis found. Analyzing call now...</p>
        </div>
      `;
      
      intelligence = await analyzeCall(callSid);
      
      if (!intelligence) {
        DOM.modalBody.innerHTML = `
          <div class="error-container">
            <p>⚠️ Failed to analyze this call.</p>
            <button class="btn btn-primary" onclick="window.analyzeCallNow('${callSid}')">
              Try Again
            </button>
            <button class="btn btn-secondary" onclick="document.getElementById('analysisModal').classList.remove('active'); document.body.style.overflow = '';">
              Close
            </button>
          </div>
        `;
        return;
      }
    }

    renderAnalysisModal(intelligence);
  }

  function renderAnalysisModal(intelligence) {
    const statusInfo = getStatusInfo(intelligence.status);
    
    DOM.modalBody.innerHTML = `
      ${renderCallOverview(intelligence)}
      ${renderExecutiveSummary(intelligence)}
      ${renderTurnByTurnFlow(intelligence)}
      ${renderResponseContext(intelligence)}
      ${renderTranscriptSection(intelligence)}
      ${renderScrabEngineHandoff(intelligence)}
      ${renderTriggerAnalysis(intelligence)}
      ${renderIssues(intelligence)}
      ${renderScrabEnginePerformance(intelligence)}
      ${renderRecommendations(intelligence)}
      ${renderPerformanceMetrics(intelligence)}
      ${renderRawDataAccess(intelligence)}
      ${renderAnalysisFooter(intelligence)}
    `;

    attachModalEventListeners();
  }

  function renderCallOverview(intel) {
    const statusInfo = getStatusInfo(intel.status);
    
    return `
      <section class="analysis-section">
        <h2 class="section-title">📞 CALL OVERVIEW</h2>
        <div class="overview-grid">
          <div class="overview-item">
            <span class="overview-label">Call SID:</span>
            <span class="overview-value"><code>${intel.callSid}</code></span>
          </div>
          <div class="overview-item">
            <span class="overview-label">Time:</span>
            <span class="overview-value">${formatDate(intel.callMetadata.startTime)}</span>
          </div>
          <div class="overview-item">
            <span class="overview-label">Duration:</span>
            <span class="overview-value">${formatDuration(intel.callMetadata.duration)}</span>
          </div>
          <div class="overview-item">
            <span class="overview-label">From:</span>
            <span class="overview-value">${intel.callMetadata.fromPhone || 'Unknown'}</span>
          </div>
          <div class="overview-item overview-status">
            <span class="overview-label">Status:</span>
            <span class="overview-value ${statusInfo.className}">
              ${statusInfo.icon} ${statusInfo.fullLabel}
            </span>
          </div>
          ${intel.callContext?.response?.routingTier ? `
            <div class="overview-item">
              <span class="overview-label">Routing Tier (123RP):</span>
              <span class="overview-value">
                ${getTierBadge(intel.callContext.response.routingTier.tier)}
              </span>
            </div>
          ` : (intel.callMetadata?.routingTier ? `
            <div class="overview-item">
              <span class="overview-label">Routing Tier (123RP):</span>
              <span class="overview-value">
                ${getTierBadge(intel.callMetadata.routingTier)}
              </span>
            </div>
          ` : '')}
        </div>
      </section>
    `;
  }

  function renderExecutiveSummary(intel) {
    return `
      <section class="analysis-section summary-section">
        <h2 class="section-title">🎯 EXECUTIVE SUMMARY</h2>
        <p class="summary-text">${intel.executiveSummary}</p>
        ${intel.topIssue ? `
          <div class="top-issue">
            <strong>Top Issue:</strong> ${intel.topIssue}
          </div>
        ` : ''}
      </section>
    `;
  }

  function renderResponseContext(intel) {
    const response = intel.callContext?.response;
    if (!response) return '';

    const usedName = response.usedCallerName === true ? 'Yes' : (response.usedCallerName === false ? 'No' : 'Unknown');
    const callerName = response.callerNameExtracted || 'Not detected';
    const callerConfidence = response.callerNameConfidence !== null && response.callerNameConfidence !== undefined
      ? `${Math.round(response.callerNameConfidence * 100)}%`
      : 'Unknown';

    const extractedRuleId = response.matchedTriggerRuleId || (response.responseSource && response.responseSource.includes('::') 
      ? response.responseSource.split('::')[1] 
      : null);

    return `
      <section class="analysis-section">
        <h2 class="section-title">🧭 RESPONSE SOURCE & OWNERSHIP</h2>
        <div class="overview-grid">
          <div class="overview-item">
            <span class="overview-label">Response Type:</span>
            <span class="overview-value">${response.responseType || 'Unknown'}</span>
          </div>
          <div class="overview-item">
            <span class="overview-label">Response Path:</span>
            <span class="overview-value">${response.responsePath || 'Unknown'}</span>
          </div>
          ${extractedRuleId ? `
            <div class="overview-item">
              <span class="overview-label">✨ Trigger ID:</span>
              <span class="overview-value"><code class="trigger-id-display">${extractedRuleId}</code></span>
            </div>
          ` : ''}
          ${response.matchedTriggerLabel ? `
            <div class="overview-item">
              <span class="overview-label">Trigger Name:</span>
              <span class="overview-value trigger-name">${response.matchedTriggerLabel}</span>
            </div>
          ` : ''}
          <div class="overview-item">
            <span class="overview-label">Response Source:</span>
            <span class="overview-value"><code style="font-size: 0.75rem;">${response.responseSource || 'Unknown'}</code></span>
          </div>
          <div class="overview-item">
            <span class="overview-label">Owner:</span>
            <span class="overview-value">${response.responseOwner || 'Unknown'}</span>
          </div>
          <div class="overview-item">
            <span class="overview-label">Used Caller Name:</span>
            <span class="overview-value">${usedName}</span>
          </div>
          <div class="overview-item">
            <span class="overview-label">Caller Name Detected:</span>
            <span class="overview-value">${callerName} (${callerConfidence})</span>
          </div>
        </div>
        ${response.responsePreview ? `
          <div class="subsection">
            <h3>Response Preview:</h3>
            <pre class="code-block">${response.responsePreview}</pre>
          </div>
        ` : ''}
      </section>
    `;
  }

  function renderTranscriptSection(intel) {
    const transcript = intel.callContext?.transcript || [];
    if (transcript.length === 0) return '';

    return `
      <section class="analysis-section">
        <h2 class="section-title">📝 TRANSCRIPT (LAST ${transcript.length} TURNS)</h2>
        <div class="transcript-list">
          ${transcript.map(turn => `
            <div class="transcript-row transcript-${turn.speaker}">
              <div class="transcript-meta">
                <span class="transcript-speaker">${turn.speaker}</span>
                ${turn.kind ? `<span class="transcript-kind">${turn.kind}</span>` : ''}
                ${turn.source ? `<span class="transcript-source">${turn.source}</span>` : ''}
              </div>
              <div class="transcript-text">${turn.text}</div>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function renderTurnByTurnFlow(intel) {
    const flow = intel.callContext?.turnByTurnFlow || [];
    if (flow.length === 0) return '';

    return `
      <section class="analysis-section flow-section">
        <h2 class="section-title">📋 TURN-BY-TURN DECISION FLOW</h2>
        <p class="section-description">Step-by-step breakdown of every caller input and system decision.</p>
        
        ${flow.map(turn => `
          <div class="turn-flow-card">
            <div class="turn-flow-header">
              <h3>Turn ${turn.turnNumber} ${turn.routingTier ? getTierBadgeCompact(turn.routingTier) : ''}</h3>
            </div>

            ${turn.callerInput ? `
              <div class="flow-step caller-step">
                <div class="step-label">
                  <span class="step-icon">🎤</span>
                  <strong>1. CALLER SPOKE</strong>
                </div>
                <div class="step-content">
                  <pre class="code-block">${turn.callerInput.raw}</pre>
                </div>
              </div>
            ` : ''}

            ${turn.scrabEngineOutput ? `
              <div class="flow-step scrabengine-step">
                <div class="step-label">
                  <span class="step-icon">🧹</span>
                  <strong>2. SCRABENGINE PROCESSED</strong>
                </div>
                <div class="step-content">
                  <div class="step-detail">
                    <span class="detail-label">Raw Input:</span>
                    <span class="detail-value">${turn.scrabEngineOutput.raw || 'N/A'}</span>
                  </div>
                  <div class="step-detail">
                    <span class="detail-label">Normalized:</span>
                    <span class="detail-value">${turn.scrabEngineOutput.normalized || 'N/A'}</span>
                  </div>
                  <div class="step-detail">
                    <span class="detail-label">Tokens:</span>
                    <span class="detail-value">${turn.scrabEngineOutput.tokensOriginal} → ${turn.scrabEngineOutput.tokensExpanded}</span>
                  </div>
                  <div class="step-detail">
                    <span class="detail-label">Quality:</span>
                    <span class="detail-value ${turn.scrabEngineOutput.qualityPassed ? 'quality-pass' : 'quality-fail'}">
                      ${turn.scrabEngineOutput.qualityPassed ? '✅ Passed' : '❌ Failed'} 
                      (${turn.scrabEngineOutput.qualityReason})
                    </span>
                  </div>
                  ${turn.scrabEngineOutput.transformations && turn.scrabEngineOutput.transformations.length > 0 ? `
                    <div class="step-detail">
                      <span class="detail-label">Transformations:</span>
                      <span class="detail-value">${turn.scrabEngineOutput.transformations.length} applied</span>
                    </div>
                  ` : ''}
                </div>
              </div>
            ` : ''}

            ${turn.scrabHandoff ? `
              <div class="flow-step handoff-step">
                <div class="step-label">
                  <span class="step-icon">🚀</span>
                  <strong>3. DELIVERED TO TRIGGERS</strong>
                </div>
                <div class="step-content">
                  <div class="step-detail">
                    <span class="detail-label">Normalized Input:</span>
                    <pre class="code-block-inline">${turn.scrabHandoff.normalizedInput || 'N/A'}</pre>
                  </div>
                  <div class="step-detail">
                    <span class="detail-label">Expanded Tokens:</span>
                    <div class="token-list-small">
                      ${(turn.scrabHandoff.expandedTokens || []).map(t => `<span class="token-small">${t}</span>`).join('')}
                    </div>
                  </div>
                </div>
              </div>
            ` : ''}

            ${turn.triggerEvaluation ? `
              <div class="flow-step trigger-step">
                <div class="step-label">
                  <span class="step-icon">🎯</span>
                  <strong>4. TRIGGER MATCHING</strong>
                </div>
                <div class="step-content">
                  <div class="step-detail">
                    <span class="detail-label">Triggers Evaluated:</span>
                    <span class="detail-value">${turn.triggerEvaluation.enabledCards} / ${turn.triggerEvaluation.totalCards}</span>
                  </div>
                  <div class="step-detail">
                    <span class="detail-label">Match Result:</span>
                    <span class="detail-value ${turn.triggerEvaluation.matched ? 'match-success' : 'match-fail'}">
                      ${turn.triggerEvaluation.matched ? '✅ MATCHED' : '❌ NO MATCH'}
                    </span>
                  </div>
                  ${turn.triggerEvaluation.matched ? `
                    <div class="step-detail">
                      <span class="detail-label">Matched Trigger ID:</span>
                      <span class="detail-value"><code class="trigger-id-display">${turn.triggerEvaluation.ruleId || turn.triggerEvaluation.cardId || 'Unknown'}</code></span>
                    </div>
                    ${turn.triggerEvaluation.cardLabel ? `
                      <div class="step-detail">
                        <span class="detail-label">Matched Trigger Name:</span>
                        <span class="detail-value trigger-name">${turn.triggerEvaluation.cardLabel}</span>
                      </div>
                    ` : ''}
                    <div class="step-detail">
                      <span class="detail-label">Matched On:</span>
                      <span class="detail-value">${turn.triggerEvaluation.matchedOn || 'keyword'}</span>
                    </div>
                  ` : ''}
                </div>
              </div>
            ` : ''}

            ${turn.pathSelected ? `
              <div class="flow-step path-step">
                <div class="step-label">
                  <span class="step-icon">🔀</span>
                  <strong>5. PATH DECISION</strong>
                </div>
                <div class="step-content">
                  <div class="step-detail">
                    <span class="detail-label">Path:</span>
                    <span class="detail-value path-${turn.pathSelected.path?.toLowerCase().includes('fallback') ? 'fallback' : 'normal'}">
                      ${turn.pathSelected.path || 'Unknown'}
                    </span>
                  </div>
                  <div class="step-detail">
                    <span class="detail-label">Reason:</span>
                    <span class="detail-value">${turn.pathSelected.reason || 'N/A'}</span>
                  </div>
                </div>
              </div>
            ` : ''}

            ${turn.agentResponse ? `
              <div class="flow-step response-step">
                <div class="step-label">
                  <span class="step-icon">💬</span>
                  <strong>6. AGENT RESPONSE</strong>
                </div>
                <div class="step-content">
                  <div class="step-detail">
                    <span class="detail-label">Response Source:</span>
                    <span class="detail-value source-${turn.agentResponse.source?.toLowerCase().includes('fallback') ? 'fallback' : 'trigger'}">
                      ${turn.agentResponse.source || 'Unknown'}
                    </span>
                  </div>
                  <div class="step-detail">
                    <span class="detail-label">Used Caller Name:</span>
                    <span class="detail-value">${turn.agentResponse.usedCallerName === true ? '✅ Yes' : (turn.agentResponse.usedCallerName === false ? '❌ No' : 'Unknown')}</span>
                  </div>
                  <div class="step-detail full-width">
                    <span class="detail-label">Response Text:</span>
                    <pre class="code-block">${turn.agentResponse.text || 'N/A'}</pre>
                  </div>
                </div>
              </div>
            ` : ''}

            ${turn.routingTier ? `
              <div class="flow-step tier-step">
                <div class="step-label">
                  <span class="step-icon">🏷️</span>
                  <strong>7. ROUTING TIER (123RP)</strong>
                </div>
                <div class="step-content">
                  <div class="step-detail">
                    <span class="detail-label">Tier:</span>
                    <span class="detail-value">
                      ${getTierBadge(turn.routingTier.tier)}
                    </span>
                  </div>
                  <div class="step-detail">
                    <span class="detail-label">Classification:</span>
                    <span class="detail-value">${turn.routingTier.tierLabel || 'Unknown'}</span>
                  </div>
                  <div class="step-detail">
                    <span class="detail-label">Last Path:</span>
                    <span class="detail-value"><code>${turn.routingTier.lastPath || 'Unknown'}</code></span>
                  </div>
                </div>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </section>
    `;
  }

  function renderScrabEngineHandoff(intel) {
    const scrabHandoff = intel.callContext?.scrabEngineHandoff;
    if (!scrabHandoff) return '';

    return `
      <section class="analysis-section scrabengine-handoff-section">
        <h2 class="section-title">🚀 SCRABENGINE → TRIGGER HANDOFF</h2>
        <p class="section-description">This is exactly what ScrabEngine delivered to the trigger matching system.</p>
        
        <div class="handoff-grid">
          <div class="handoff-item">
            <span class="handoff-label">Original Tokens:</span>
            <span class="handoff-value">${scrabHandoff.originalTokenCount || 0}</span>
          </div>
          <div class="handoff-item">
            <span class="handoff-label">Expanded Tokens:</span>
            <span class="handoff-value">${scrabHandoff.expandedTokenCount || 0}</span>
          </div>
          <div class="handoff-item">
            <span class="handoff-label">Tokens Added:</span>
            <span class="handoff-value">+${scrabHandoff.tokensAdded || 0}</span>
          </div>
          <div class="handoff-item">
            <span class="handoff-label">Quality Passed:</span>
            <span class="handoff-value">${scrabHandoff.qualityPassed ? '✅ Yes' : '❌ No'}</span>
          </div>
          <div class="handoff-item">
            <span class="handoff-label">Quality Reason:</span>
            <span class="handoff-value">${scrabHandoff.qualityReason || 'N/A'}</span>
          </div>
          <div class="handoff-item">
            <span class="handoff-label">Confidence:</span>
            <span class="handoff-value">${scrabHandoff.qualityConfidence ? Math.round(scrabHandoff.qualityConfidence * 100) + '%' : 'N/A'}</span>
          </div>
        </div>

        ${scrabHandoff.normalizedInput ? `
          <div class="subsection">
            <h3>Normalized Input (What Triggers See):</h3>
            <pre class="code-block">${scrabHandoff.normalizedInput}</pre>
          </div>
        ` : ''}

        ${scrabHandoff.expandedTokens && scrabHandoff.expandedTokens.length > 0 ? `
          <div class="subsection">
            <h3>Expanded Tokens (${scrabHandoff.expandedTokens.length} tokens):</h3>
            <div class="token-list">
              ${scrabHandoff.expandedTokens.map(t => `<span class="token">${t}</span>`).join('')}
            </div>
          </div>
        ` : ''}

        ${scrabHandoff.transformationSummary && scrabHandoff.transformationSummary.length > 0 ? `
          <div class="subsection">
            <h3>Transformations Applied (${scrabHandoff.transformationSummary.length}):</h3>
            <ul class="transformation-list">
              ${scrabHandoff.transformationSummary.map(t => `
                <li>
                  <strong>${t.stage}:</strong> ${t.type} 
                  ${t.detail ? `(${t.detail})` : ''}
                </li>
              `).join('')}
            </ul>
          </div>
        ` : ''}

        ${scrabHandoff.entitiesFound && scrabHandoff.entitiesFound > 0 && scrabHandoff.entities ? `
          <div class="subsection">
            <h3>Entities Extracted:</h3>
            <div class="entities-grid">
              ${Object.entries(scrabHandoff.entities).filter(([k, v]) => v).map(([key, value]) => `
                <div class="entity-item">
                  <span class="entity-label">${key}:</span>
                  <span class="entity-value">${value}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </section>
    `;
  }

  function renderTriggerAnalysis(intel) {
    const analysis = intel.analysis?.triggerAnalysis;
    if (!analysis) return '';

    return `
      <section class="analysis-section">
        <h2 class="section-title">📊 TRIGGER MATCHING ANALYSIS</h2>
        <div class="trigger-stats">
          <div class="stat-item">
            <span class="stat-number">${analysis.totalTriggersEvaluated}</span>
            <span class="stat-label">Triggers Evaluated</span>
          </div>
          <div class="stat-item">
            <span class="stat-number">${analysis.triggersMatched}</span>
            <span class="stat-label">Triggers Matched</span>
          </div>
          <div class="stat-item">
            <span class="stat-number">${analysis.matchRate}%</span>
            <span class="stat-label">Match Rate</span>
          </div>
        </div>
        ${analysis.normalizedInput ? `
          <div class="subsection">
            <h3>Normalized Input:</h3>
            <pre class="code-block">${analysis.normalizedInput}</pre>
          </div>
        ` : ''}
        ${analysis.tokensDelivered && analysis.tokensDelivered.length > 0 ? `
          <div class="subsection">
            <h3>Tokens Delivered:</h3>
            <div class="token-list">
              ${analysis.tokensDelivered.slice(0, 20).map(t => `<span class="token">${t}</span>`).join('')}
            </div>
          </div>
        ` : ''}
      </section>
    `;
  }

  function renderIssues(intel) {
    if (!intel.issues || intel.issues.length === 0) {
      return `
        <section class="analysis-section">
          <h2 class="section-title">✅ NO ISSUES FOUND</h2>
          <p>This call was handled correctly with no detected issues.</p>
        </section>
      `;
    }

    return `
      <section class="analysis-section">
        <h2 class="section-title">🔴 ISSUES DETECTED (${intel.issues.length})</h2>
        ${intel.issues.map((issue, idx) => `
          <div class="issue-card severity-${issue.severity}">
            <div class="issue-header">
              <span class="issue-number">#${idx + 1}</span>
              <span class="issue-severity">${getSeverityIcon(issue.severity)} ${issue.severity.toUpperCase()}</span>
            </div>
            <h3 class="issue-title">${issue.title}</h3>
            <p class="issue-description">${issue.description}</p>
            ${issue.affectedComponent ? `
              <div class="issue-meta">
                <strong>Affected Component:</strong> <code class="component-id">${issue.affectedComponent}</code>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </section>
    `;
  }

  function renderScrabEnginePerformance(intel) {
    const scrab = intel.analysis?.scrabEnginePerformance;
    if (!scrab) return '';

    return `
      <section class="analysis-section">
        <h2 class="section-title">✅ SCRABENGINE PERFORMANCE</h2>
        <div class="performance-status ${scrab.overallStatus}">
          <strong>Overall:</strong> ${scrab.overallStatus?.toUpperCase() || 'UNKNOWN'}
        </div>
        <div class="performance-time">
          <strong>Processing Time:</strong> ${scrab.totalProcessingTime}ms
        </div>
      </section>
    `;
  }

  function renderRecommendations(intel) {
    if (!intel.recommendations || intel.recommendations.length === 0) {
      return '';
    }

    return `
      <section class="analysis-section recommendations-section">
        <h2 class="section-title">🎯 ACTIONABLE RECOMMENDATIONS (${intel.recommendations.length})</h2>
        ${intel.recommendations.map((rec, idx) => `
          <div class="recommendation-card priority-${rec.priority}">
            <div class="rec-header">
              <span class="rec-number">${idx + 1}.</span>
              <span class="rec-priority">${getPriorityBadge(rec.priority)}</span>
            </div>
            <h3 class="rec-title">${rec.title}</h3>
            <p class="rec-description">${rec.description}</p>
            ${rec.copyableContent ? `
              <div class="copyable-content">
                <pre class="code-block">${rec.copyableContent}</pre>
                <button class="btn btn-small copy-btn" data-content="${escapeHtml(rec.copyableContent)}">
                  📋 COPY
                </button>
              </div>
            ` : ''}
            ${rec.targetTrigger ? `
              <div class="rec-meta">
                <strong>Target Trigger ID:</strong> <code class="trigger-id-display">${rec.targetTrigger}</code>
              </div>
            ` : ''}
            ${rec.targetBucket ? `
              <div class="rec-meta">
                <strong>Target Bucket:</strong> <code>${rec.targetBucket}</code>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </section>
    `;
  }

  function renderPerformanceMetrics(intel) {
    const metrics = intel.analysis?.performanceMetrics;
    if (!metrics) return '';

    return `
      <section class="analysis-section">
        <h2 class="section-title">📈 PERFORMANCE METRICS</h2>
        <div class="metrics-grid">
          <div class="metric-item">
            <span class="metric-label">Trigger Evaluation:</span>
            <span class="metric-value">${metrics.triggerEvaluationTime}ms</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">ScrabEngine:</span>
            <span class="metric-value">${metrics.scrabEngineTime}ms</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">Total Response:</span>
            <span class="metric-value">${metrics.totalResponseTime}ms</span>
          </div>
        </div>
      </section>
    `;
  }

  function renderRawDataAccess(intel) {
    return `
      <section class="analysis-section">
        <h2 class="section-title">📎 RAW DATA ACCESS</h2>
        <div class="raw-data-actions">
          <button class="btn btn-secondary" onclick="downloadJSON('${intel.callSid}')">
            📥 Download Full Analysis JSON
          </button>
          <a href="/agent-console/call-report?callSid=${intel.callSid}" 
             class="btn btn-secondary" 
             target="_blank">
            🔗 Open in Call Console
          </a>
        </div>
      </section>
    `;
  }

  function renderAnalysisFooter(intel) {
    const gpt4 = intel.gpt4Analysis;
    
    return `
      <footer class="analysis-footer">
        <p>
          Analysis generated ${gpt4.enabled ? 'by GPT-4' : 'by rule-based engine'} 
          on ${formatDate(intel.analyzedAt)}
        </p>
        ${gpt4.enabled ? `
          <p class="analysis-meta">
            Model: ${gpt4.modelVersion} • 
            Processing: ${gpt4.processingTime}ms • 
            Tokens: ${gpt4.tokensUsed}
          </p>
        ` : ''}
      </footer>
    `;
  }

  function attachModalEventListeners() {
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const content = btn.dataset.content;
        const success = await copyToClipboard(content);
        if (success) {
          showNotification('Copied to clipboard!', 'success');
        }
      });
    });
  }

  function closeAnalysisModal() {
    DOM.analysisModal.classList.remove('active');
    document.body.style.overflow = '';
    state.selectedCallSid = null;
  }

  function openSettings() {
    DOM.settingsModal.classList.add('active');
    DOM.analysisMode.value = state.analysisMode;
  }

  function closeSettingsModal() {
    DOM.settingsModal.classList.remove('active');
  }

  async function saveSettings() {
    const gpt4Enabled = DOM.gpt4Toggle.checked;
    const analysisMode = DOM.analysisMode.value;
    const autoAnalyzeEnabled = DOM.autoAnalyzeToggle.checked;

    try {
      if (gpt4Enabled !== state.gpt4Enabled) {
        await toggleGPT4(gpt4Enabled);
      }

      await apiCall(`/api/call-intelligence/settings/${state.companyId}`, {
        method: 'POST',
        body: JSON.stringify({
          gpt4Enabled,
          analysisMode,
          autoAnalyzeEnabled
        })
      });

      state.analysisMode = analysisMode;
      
      showNotification('Settings saved successfully!', 'success');
      closeSettingsModal();
    } catch (error) {
      showNotification('Failed to save settings', 'error');
      console.error('Save settings error:', error);
    }
  }

  // =============================================================================
  // UTILITY FUNCTIONS
  // =============================================================================

  function getTierBadge(tier) {
    switch (tier) {
      case 1: return '<span class="tier-badge tier-1">T1 DETERMINISTIC</span>';
      case 2: return '<span class="tier-badge tier-2">T2 LLM AGENT</span>';
      case 3: return '<span class="tier-badge tier-3">T3 FALLBACK</span>';
      default: return '<span class="tier-badge tier-unknown">--</span>';
    }
  }

  function getTierBadgeCompact(tierObj) {
    if (!tierObj) return '';
    switch (tierObj.tier) {
      case 1: return '<span class="tier-badge tier-1">T1</span>';
      case 2: return '<span class="tier-badge tier-2">T2</span>';
      case 3: return '<span class="tier-badge tier-3">T3</span>';
      default: return '';
    }
  }

  function updateTierStats(calls) {
    let t1 = 0, t2 = 0, t3 = 0;
    for (const call of calls) {
      const tier = call.callMetadata?.routingTier;
      if (tier === 1) t1++;
      else if (tier === 2) t2++;
      else if (tier === 3) t3++;
    }
    if (DOM.statTier1) DOM.statTier1.textContent = t1;
    if (DOM.statTier2) DOM.statTier2.textContent = t2;
    if (DOM.statTier3) DOM.statTier3.textContent = t3;
  }

  function getStatusInfo(status) {
    switch (status) {
      case 'critical':
        return {
          icon: '🔴',
          label: 'CRITICAL',
          fullLabel: 'CRITICAL ISSUES',
          className: 'status-critical'
        };
      case 'needs_improvement':
        return {
          icon: '🟡',
          label: 'IMPROVEMENTS',
          fullLabel: 'NEEDS IMPROVEMENT',
          className: 'status-warning'
        };
      case 'performing_well':
        return {
          icon: '✅',
          label: 'GOOD',
          fullLabel: 'PERFORMING WELL',
          className: 'status-success'
        };
      case 'not_analyzed':
        return {
          icon: '⚪',
          label: 'NOT ANALYZED',
          fullLabel: 'NOT ANALYZED',
          className: 'status-unknown'
        };
      default:
        return {
          icon: '⚪',
          label: 'UNKNOWN',
          fullLabel: 'UNKNOWN',
          className: 'status-unknown'
        };
    }
  }

  function getSeverityIcon(severity) {
    switch (severity) {
      case 'critical': return '🔴';
      case 'high': return '🟠';
      case 'medium': return '🟡';
      case 'low': return '🔵';
      default: return '⚪';
    }
  }

  function getPriorityBadge(priority) {
    switch (priority) {
      case 'immediate': return '🔴 IMMEDIATE';
      case 'high': return '🟠 HIGH';
      case 'medium': return '🟡 MEDIUM';
      case 'low': return '🔵 LOW';
      default: return '⚪ UNKNOWN';
    }
  }

  function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }

  function formatDate(dateString) {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    return date.toLocaleString();
  }

  function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error('Failed to copy:', err);
      showNotification('Failed to copy to clipboard', 'error');
      return false;
    }
  }

  async function copyAnalysisToClipboard() {
    const text = DOM.modalBody.innerText;
    const success = await copyToClipboard(text);
    if (success) {
      showNotification('Analysis copied to clipboard!', 'success');
    }
  }

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

  function showNotification(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }

  function showLoading() {
    DOM.callsTbody.innerHTML = `
      <tr class="loading-row">
        <td colspan="9" class="loading-cell">
          <div class="loading-spinner"></div>
          <p>Loading call intelligence...</p>
        </td>
      </tr>
    `;
  }

  function showError(message = 'Failed to load calls. Please try again.') {
    DOM.callsTbody.innerHTML = `
      <tr class="error-row">
        <td colspan="9" class="error-cell">
          <p>⚠️ ${message}</p>
          <button class="btn btn-primary" onclick="location.reload()">Retry</button>
        </td>
      </tr>
    `;
  }

  // =============================================================================
  // EVENT HANDLERS
  // =============================================================================

  function handleSearch(e) {
    state.filters.search = e.target.value;
    state.currentPage = 1;
    loadCalls();
  }

  function handleFilterChange() {
    state.filters.status = DOM.filterStatus.value;
    state.filters.timeRange = DOM.filterTime.value;
    state.currentPage = 1;
    loadCalls();
    loadSummary();
  }

  function clearFilters() {
    state.filters = {
      status: '',
      timeRange: 'today',
      search: ''
    };
    state.currentPage = 1;
    
    DOM.searchInput.value = '';
    DOM.filterStatus.value = '';
    DOM.filterTime.value = 'today';
    
    loadCalls();
    loadSummary();
  }

  function changePage(page) {
    if (page < 1 || page > state.totalPages) return;
    state.currentPage = page;
    loadCalls();
  }

  function handleRefresh() {
    loadSummary();
    loadCalls();
    showNotification('Refreshed!', 'success');
  }

  

  // =============================================================================
  // GLOBAL FUNCTIONS (called from HTML)
  // =============================================================================

  window.analyzeCallNow = async function(callSid) {
    const intelligence = await analyzeCall(callSid);
    if (intelligence) {
      renderAnalysisModal(intelligence);
    }
  };

  window.downloadJSON = function(callSid) {
    window.open(`/api/call-intelligence/${callSid}`, '_blank');
  };

  // =============================================================================
  // START
  // =============================================================================

  document.addEventListener('DOMContentLoaded', init);

})();
