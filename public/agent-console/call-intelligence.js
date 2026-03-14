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

  let _playerCounter = 0;

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
    analysisModel: 'gpt-4o-mini',
    selectedCallSid: null,
    selectedCallSids: new Set()
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
    deleteSelectedBtn: document.getElementById('delete-selected-btn'),
    selectedCount: document.getElementById('selected-count'),

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
    analysisModel: document.getElementById('analysis-model'),
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

    // Checkboxes / bulk delete
    DOM.selectAll.addEventListener('change', handleSelectAll);
    DOM.deleteSelectedBtn.addEventListener('click', handleDeleteSelected);

    // Buttons
    DOM.refreshBtn.addEventListener('click', handleRefresh);
    DOM.settingsBtn.addEventListener('click', openSettings);

    // Modals
    DOM.closeModal.addEventListener('click', closeAnalysisModal);
    DOM.closeSettings.addEventListener('click', closeSettingsModal);
    DOM.copyAllBtn.addEventListener('click', copyAnalysisToClipboard);
    DOM.exportPdfBtn.addEventListener('click', saveAsPdf);
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

      // ── CHECKPOINT: Log per-call data health for debugging ──────────────
      if (data.items?.length > 0) {
        const sample = data.items.slice(0, 5);
        console.group('[CallIntelligence UI] 📊 Call Data Health (first 5 calls)');
        sample.forEach((call, i) => {
          const dur = call.callMetadata?.duration;
          const rec = call.recording || {};
          console.log(
            `  Call ${i + 1}: ${call.callSid?.substring(0, 12)}...`,
            `| duration: ${dur === null ? 'NULL (callback missing)' : dur === undefined ? 'UNDEFINED' : dur + 's'}`,
            `| turns: ${call.callMetadata?.turns || 0}`,
            `| recording.hasRecording: ${rec.hasRecording}`,
            `| recording.sid: ${rec.sid || 'NONE'}`,
            `| recording.url: ${rec.url ? 'YES' : 'NONE'}`,
            `| status: ${call.status}`
          );
        });
        console.groupEnd();
      }

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
    console.log('[loadCallAnalysis] ▶ Fetching GET /api/call-intelligence/' + callSid);
    try {
      const data = await apiCall(`/api/call-intelligence/${callSid}`);
      console.log('[loadCallAnalysis] ✅ Received — status:', data?.intelligence?.status, 'gpt4Enabled:', data?.intelligence?.gpt4Analysis?.enabled);
      return data.intelligence;
    } catch (error) {
      console.error('[loadCallAnalysis] ❌ Failed:', error.message);
      return null;
    }
  }

  async function analyzeCall(callSid) {
    console.log('[analyzeCall] ▶ Starting analysis for:', callSid);
    console.log('[analyzeCall] Params — useGPT4:', state.gpt4Enabled, 'mode:', state.analysisMode, 'model:', state.analysisModel);
    try {
      showNotification(`Analyzing call with ${state.analysisModel}...`, 'info');

      const data = await apiCall(`/api/call-intelligence/analyze/${callSid}`, {
        method: 'POST',
        body: JSON.stringify({
          useGPT4: state.gpt4Enabled,
          mode: state.analysisMode,
          model: state.analysisModel
        })
      });

      console.log('[analyzeCall] ✅ API responded — success:', data?.success, 'has intelligence:', !!data?.intelligence);
      showNotification('Analysis complete!', 'success');
      return data.intelligence;
    } catch (error) {
      console.error('[analyzeCall] ❌ Failed:', error.message);
      showNotification('Analysis failed: ' + error.message, 'error');
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
        state.analysisModel = settingsData.settings.analysisModel || 'gpt-4o-mini';
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
          <td colspan="10" class="empty-cell">
            <p>No calls found</p>
          </td>
        </tr>
      `;
      DOM.callCount.textContent = '0 calls';
      return;
    }

    DOM.callCount.textContent = `${state.calls.length} calls`;

    // Reset selection on re-render
    state.selectedCallSids.clear();
    DOM.selectAll.checked = false;
    DOM.selectAll.indeterminate = false;
    DOM.deleteSelectedBtn.style.display = 'none';

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
          <td class="col-recording">
            ${(() => {
              const rec = call.recording || {};
              const hasSid = !!rec.sid;
              const hasUrl = !!rec.url;
              const hasAny = hasSid || hasUrl;
              if (!hasAny) return '<span class="text-muted">--</span>';
              return `
                <div class="recording-actions">
                  ${hasSid ? `
                    <button class="btn-play-recording"
                      data-recording-url="/api/call-intelligence/recording/${rec.sid}/audio"
                      title="Quick listen${rec.duration ? ' (' + formatDuration(rec.duration) + ')' : ''}">
                      <span class="play-icon">&#9654;</span>
                    </button>
                  ` : ''}
                  ${hasSid ? `
                    <a href="https://www.twilio.com/console/voice/recordings/${rec.sid}"
                       target="_blank"
                       class="btn-recording-twilio"
                       title="Open in Twilio Console">&#8599;</a>
                  ` : hasUrl ? `
                    <a href="${rec.url}" target="_blank"
                       class="btn-recording-twilio"
                       title="Open recording">&#8599;</a>
                  ` : ''}
                </div>
              `;
            })()}
          </td>
          <td class="col-intelligence">
            <div class="intelligence-cell ${statusInfo.className}">
              <div class="intelligence-status">
                <span class="status-icon">${statusInfo.icon}</span>
                <span class="status-text">${statusInfo.label}</span>
              </div>
              <div class="intelligence-summary">${call.topIssue || 'No issues'}</div>
              <button class="btn btn-small view-analysis-btn" data-callsid="${call.callSid}">
                VIEW REPORT
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

  function handleSelectAll(e) {
    const checked = e.target.checked;
    document.querySelectorAll('.row-checkbox').forEach(cb => {
      cb.checked = checked;
      const row = cb.closest('tr');
      const callSid = row.dataset.callsid;
      if (checked) {
        state.selectedCallSids.add(callSid);
        row.classList.add('row-selected');
      } else {
        state.selectedCallSids.delete(callSid);
        row.classList.remove('row-selected');
      }
    });
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const count = state.selectedCallSids.size;
    const total = document.querySelectorAll('.row-checkbox').length;

    DOM.selectedCount.textContent = count;
    DOM.deleteSelectedBtn.style.display = count > 0 ? 'inline-flex' : 'none';

    // Sync select-all indeterminate state
    DOM.selectAll.checked = count > 0 && count === total;
    DOM.selectAll.indeterminate = count > 0 && count < total;
  }

  async function handleDeleteSelected() {
    const callSids = Array.from(state.selectedCallSids);
    if (callSids.length === 0) return;

    if (!confirm(`Delete ${callSids.length} call record(s)? This cannot be undone.`)) return;

    try {
      await apiCall(`/api/call-intelligence/company/${state.companyId}/bulk-delete`, {
        method: 'DELETE',
        body: JSON.stringify({ callSids })
      });

      showNotification(`Deleted ${callSids.length} call(s)`, 'success');
      state.selectedCallSids.clear();
      DOM.selectAll.checked = false;
      DOM.selectAll.indeterminate = false;
      loadCalls();
    } catch (error) {
      showNotification('Delete failed: ' + error.message, 'error');
    }
  }

  function attachCallRowListeners() {
    // Row checkboxes
    document.querySelectorAll('.row-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const row = e.target.closest('tr');
        const callSid = row.dataset.callsid;
        if (e.target.checked) {
          state.selectedCallSids.add(callSid);
          row.classList.add('row-selected');
        } else {
          state.selectedCallSids.delete(callSid);
          row.classList.remove('row-selected');
        }
        updateSelectionUI();
      });
    });

    document.querySelectorAll('.view-analysis-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const callSid = btn.dataset.callsid;
        openAnalysisModal(callSid);
      });
    });

    // Recording play buttons — toggle inline audio player
    document.querySelectorAll('.btn-play-recording').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = btn.dataset.recordingUrl;
        const row = btn.closest('tr');
        const existingPlayer = row.nextElementSibling;

        // If player row already exists for this row, toggle it
        if (existingPlayer && existingPlayer.classList.contains('recording-player-row')) {
          existingPlayer.remove();
          btn.classList.remove('active');
          return;
        }

        // Remove any other open player rows
        document.querySelectorAll('.recording-player-row').forEach(r => r.remove());
        document.querySelectorAll('.btn-play-recording.active').forEach(b => b.classList.remove('active'));

        // Insert player row below this row
        const playerRow = document.createElement('tr');
        playerRow.className = 'recording-player-row';
        playerRow.innerHTML = `
          <td colspan="10" class="recording-player-cell">
            <div class="recording-player-wrapper">
              ${buildCustomPlayer(url)}
              <a href="${url}" target="_blank" class="recording-external-link" title="Open in new tab">&#8599;</a>
            </div>
          </td>
        `;
        row.after(playerRow);
        initAllCustomPlayers(playerRow);
        // Auto-play after init
        const audio = playerRow.querySelector('.cv-audio');
        if (audio) audio.play().catch(() => {});
        btn.classList.add('active');
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
    console.log('[openAnalysisModal] ▶ Opening report for callSid:', callSid);
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
    console.log('[openAnalysisModal] loadCallAnalysis result:', intelligence ? 'has data (status: ' + intelligence.status + ')' : 'null');

    if (!intelligence) {
      console.log('[openAnalysisModal] ⚠️ No existing analysis — showing on-demand button');
      DOM.modalBody.innerHTML = `
        <div class="loading-container" style="padding: 4rem 2rem;">
          <p style="font-size: 1.125rem; color: #374151; margin-bottom: 0.5rem;">No analysis yet for this call.</p>
          <p style="font-size: 0.875rem; color: #6B7280; margin-bottom: 1.5rem;">Click below to run GPT-4 analysis on demand.</p>
          <button class="btn btn-primary" onclick="window.analyzeCallNow('${callSid}')" style="font-size: 1rem; padding: 0.75rem 1.5rem;">
            Analyze This Call
          </button>
          <button class="btn btn-secondary" onclick="document.getElementById('analysis-modal').classList.remove('active'); document.body.style.overflow = '';" style="margin-left: 0.75rem;">
            Close
          </button>
        </div>
      `;
      return;
    }

    renderAnalysisModal(intelligence);
  }

  function renderAnalysisModal(intelligence) {
    console.log('[renderAnalysisModal] ▶ Rendering report — callSid:', intelligence.callSid, 'status:', intelligence.status);
    console.log('[renderAnalysisModal] gpt4Analysis:', JSON.stringify(intelligence.gpt4Analysis || {}));
    console.log('[renderAnalysisModal] tokenUsage:', JSON.stringify(intelligence.tokenUsage || {}));
    const statusInfo = getStatusInfo(intelligence.status);
    const needsGpt4 = !intelligence.gpt4Analysis?.enabled;

    DOM.modalBody.innerHTML = `
      ${needsGpt4 ? `
        <div class="gpt4-analyze-banner" style="background: #EFF6FF; border: 2px solid #3B82F6; border-radius: 0.5rem; padding: 1.25rem 1.5rem; margin-bottom: 2rem; display: flex; align-items: center; justify-content: space-between;">
          <div>
            <strong style="color: #1E40AF; font-size: 0.95rem;">GPT-4 analysis has not been run on this call.</strong>
            <p style="color: #6B7280; font-size: 0.8rem; margin-top: 0.25rem;">Click to run a full AI-powered analysis for deeper insights.</p>
          </div>
          <button class="btn btn-primary" onclick="window.analyzeCallNow('${intelligence.callSid}')" style="white-space: nowrap;">
            Analyze with GPT-4
          </button>
        </div>
      ` : ''}
      ${renderCallOverview(intelligence)}
      ${renderEngineeringScore(intelligence)}
      ${renderExecutiveSummary(intelligence)}
      ${renderCallerJourney(intelligence)}
      ${renderTurnByTurnAnalysis(intelligence)}
      ${renderRootCause(intelligence)}
      ${renderTurnByTurnFlow(intelligence)}
      ${renderResponseContext(intelligence)}
      ${renderVoiceDeliverySummary(intelligence)}
      ${renderTranscriptSection(intelligence)}
      ${renderScrabEngineHandoff(intelligence)}
      ${renderTriggerAnalysis(intelligence)}
      ${renderIssues(intelligence)}
      ${renderScrabEnginePerformance(intelligence)}
      ${renderRecommendations(intelligence)}
      ${renderTokenUsage(intelligence)}
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
        ${(() => {
          const rec = intel.recording || {};
          const audioSrc = rec.sid
            ? '/api/call-intelligence/recording/' + rec.sid + '/audio'
            : rec.url || null;
          if (!audioSrc) return '';
          return `
            <div class="overview-recording">
              <span class="overview-recording-label">CALL RECORDING</span>
              <div class="overview-recording-player">
                ${buildCustomPlayer(audioSrc)}
                <div class="recording-links">
                  ${rec.sid ? '<a href="https://www.twilio.com/console/voice/recordings/' + rec.sid + '" target="_blank" class="recording-external-link" title="Open in Twilio Console">Twilio Console &#8599;</a>' : ''}
                  ${rec.url ? '<a href="' + rec.url + '" target="_blank" class="recording-external-link" title="Open recording in new tab">Open in new tab &#8599;</a>' : ''}
                </div>
              </div>
            </div>
          `;
        })()}
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

  // =============================================================================
  // V2 ENGINEERING-GRADE RENDER FUNCTIONS
  // =============================================================================

  function renderEngineeringScore(intel) {
    const score = intel.engineeringScore;
    if (!score || !score.overall) return '';

    const dimensions = [
      { key: 'overall', label: 'Overall', icon: '📊' },
      { key: 'triggerAccuracy', label: 'Trigger Accuracy', icon: '🎯' },
      { key: 'responseRelevance', label: 'Response Relevance', icon: '💬' },
      { key: 'callerExperience', label: 'Caller Experience', icon: '😊' },
      { key: 'conversationFlow', label: 'Conversation Flow', icon: '🔄' },
      { key: 'nameHandling', label: 'Name Handling', icon: '👤' }
    ];

    function getScoreColor(val) {
      if (val <= 3) return 'score-red';
      if (val <= 6) return 'score-yellow';
      return 'score-green';
    }

    return `
      <section class="analysis-section engineering-score-section">
        <h2 class="section-title">📊 ENGINEERING SCORE</h2>
        <div class="engineering-score-grid">
          ${dimensions.map(d => {
            const val = score[d.key];
            if (val === undefined || val === null) return '';
            return `
              <div class="score-row">
                <span class="score-label">${d.icon} ${d.label}</span>
                <div class="score-bar-track">
                  <div class="score-bar ${getScoreColor(val)}" style="width: ${val * 10}%"></div>
                </div>
                <span class="score-value ${getScoreColor(val)}">${val}/10</span>
              </div>
            `;
          }).join('')}
        </div>
      </section>
    `;
  }

  function renderCallerJourney(intel) {
    const journey = intel.callerJourney;
    if (!journey) return '';

    const outcomeLabels = {
      'wrong_response': '❌ Wrong Response',
      'correct_booking': '✅ Correct Booking',
      'correct_info': '✅ Correct Info',
      'caller_abandoned': '⚠️ Caller Abandoned',
      'partial_help': '🟡 Partial Help'
    };

    return `
      <section class="analysis-section caller-journey-section">
        <h2 class="section-title">🧭 CALLER JOURNEY</h2>

        ${journey.callerName ? `
          <div class="journey-name-row">
            <span class="journey-name-label">Caller:</span>
            <strong>${journey.callerName}</strong>
            ${journey.nameDetected !== undefined ? `
              <span class="journey-name-tag ${journey.nameUsedInResponse ? 'name-used' : 'name-not-used'}">
                ${journey.nameDetected ? (journey.nameUsedInResponse ? '✅ Name detected & used' : '⚠️ Name detected but NOT used in response') : '❌ Name not detected'}
              </span>
            ` : ''}
          </div>
        ` : ''}

        ${journey.intentEvolution && journey.intentEvolution.length > 0 ? `
          <div class="journey-intent-flow">
            <h3 class="journey-subtitle">Intent Evolution</h3>
            <div class="intent-timeline">
              ${journey.intentEvolution.map((intent, idx) => `
                <div class="intent-step">
                  <span class="intent-number">${idx + 1}</span>
                  <span class="intent-text">${intent}</span>
                </div>
                ${idx < journey.intentEvolution.length - 1 ? '<span class="intent-arrow">→</span>' : ''}
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="journey-outcome-row">
          <div class="journey-outcome-item">
            <span class="journey-meta-label">Final Outcome:</span>
            <span class="journey-outcome-badge ${journey.wasCallerHelped ? 'outcome-good' : 'outcome-bad'}">
              ${outcomeLabels[journey.finalOutcome] || journey.finalOutcome || 'Unknown'}
            </span>
          </div>
          <div class="journey-outcome-item">
            <span class="journey-meta-label">Was Caller Helped?</span>
            <span class="${journey.wasCallerHelped ? 'verdict-good' : 'verdict-bad'}">
              ${journey.wasCallerHelped ? '✅ Yes' : '❌ No'}
            </span>
          </div>
        </div>

        ${journey.unaddressedIssues && journey.unaddressedIssues.length > 0 ? `
          <div class="journey-unaddressed">
            <h3 class="journey-subtitle">⚠️ Unaddressed Issues</h3>
            <ul class="unaddressed-list">
              ${journey.unaddressedIssues.map(issue => `<li>${issue}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        ${journey.sentimentArc && journey.sentimentArc.length > 0 ? `
          <div class="journey-sentiment">
            <h3 class="journey-subtitle">Sentiment Arc</h3>
            <div class="sentiment-flow">
              ${journey.sentimentArc.map((s, idx) => `
                <span class="sentiment-chip sentiment-${s}">${s}</span>
                ${idx < journey.sentimentArc.length - 1 ? '<span class="intent-arrow">→</span>' : ''}
              `).join('')}
            </div>
          </div>
        ` : ''}
      </section>
    `;
  }

  function renderTurnByTurnAnalysis(intel) {
    const turns = intel.turnByTurnAnalysis;
    if (!turns || turns.length === 0) return '';

    function getVerdictBadge(verdict) {
      const badges = {
        'correct': '<span class="verdict-badge verdict-correct">✅ Correct</span>',
        'wrong_trigger': '<span class="verdict-badge verdict-wrong">❌ Wrong Trigger</span>',
        'missed_trigger': '<span class="verdict-badge verdict-wrong">❌ Missed Trigger</span>',
        'good_llm': '<span class="verdict-badge verdict-good-llm">✅ Good LLM</span>',
        'good_llm_response': '<span class="verdict-badge verdict-good-llm">✅ Good LLM</span>',
        'bad_llm': '<span class="verdict-badge verdict-bad-llm">❌ Bad LLM</span>',
        'bad_llm_response': '<span class="verdict-badge verdict-bad-llm">❌ Bad LLM</span>',
        'acceptable': '<span class="verdict-badge verdict-acceptable">🟡 Acceptable</span>'
      };
      return badges[verdict] || `<span class="verdict-badge verdict-unknown">${verdict || 'Unknown'}</span>`;
    }

    function getTierBadgeSmall(tier) {
      if (!tier) return '';
      switch (tier) {
        case 'T1': return '<span class="tier-badge-sm tier-1-sm">T1</span>';
        case 'T2': return '<span class="tier-badge-sm tier-2-sm">T2</span>';
        case 'T3': return '<span class="tier-badge-sm tier-3-sm">T3</span>';
        default: return `<span class="tier-badge-sm">${tier}</span>`;
      }
    }

    return `
      <section class="analysis-section turn-analysis-section">
        <h2 class="section-title">🔬 TURN-BY-TURN ENGINEERING ANALYSIS</h2>
        <p class="section-description">Per-turn verdict: what the caller wanted vs what the system did vs what SHOULD have happened.</p>

        ${turns.map(turn => `
          <div class="turn-analysis-card ${turn.falsePositive ? 'false-positive-card' : ''} ${turn.falseNegative ? 'false-negative-card' : ''}">
            <div class="turn-analysis-header">
              <div class="turn-header-left">
                <span class="turn-num">Turn ${turn.turnNumber}</span>
                ${getTierBadgeSmall(turn.tier)}
                ${getVerdictBadge(turn.verdict)}
                ${turn.falsePositive ? '<span class="fp-flag">🚨 FALSE POSITIVE</span>' : ''}
                ${turn.falseNegative ? '<span class="fn-flag">⚠️ FALSE NEGATIVE</span>' : ''}
              </div>
              <div class="turn-header-right">
                ${turn.responseQuality !== undefined ? `
                  <span class="quality-badge quality-${turn.responseQuality <= 3 ? 'low' : (turn.responseQuality <= 6 ? 'mid' : 'high')}">${turn.responseQuality}/10</span>
                ` : ''}
                ${turn.callerSentiment ? `
                  <span class="sentiment-chip sentiment-${turn.callerSentiment}">${turn.callerSentiment}</span>
                ` : ''}
              </div>
            </div>

            <div class="turn-analysis-body">
              ${turn.callerSaid ? `
                <div class="turn-row caller-row">
                  <span class="turn-row-label">🎤 Caller Said:</span>
                  <span class="turn-row-value">"${turn.callerSaid}"</span>
                </div>
              ` : ''}
              ${turn.callerIntent ? `
                <div class="turn-row intent-row">
                  <span class="turn-row-label">🧠 Caller Intent:</span>
                  <span class="turn-row-value">${turn.callerIntent}</span>
                </div>
              ` : ''}
              ${turn.systemAction ? `
                <div class="turn-row system-row">
                  <span class="turn-row-label">⚙️ System Did:</span>
                  <span class="turn-row-value">${turn.systemAction}</span>
                </div>
              ` : ''}
              ${turn.correctAction && turn.correctAction !== 'correct' ? `
                <div class="turn-row correct-row">
                  <span class="turn-row-label">✅ Should Have:</span>
                  <span class="turn-row-value">${turn.correctAction}</span>
                </div>
              ` : ''}
              ${turn.verdictReason ? `
                <div class="turn-row reason-row">
                  <span class="turn-row-label">📝 Why:</span>
                  <span class="turn-row-value">${turn.verdictReason}</span>
                </div>
              ` : ''}
              ${turn.triggerMatched ? `
                <div class="turn-row trigger-row">
                  <span class="turn-row-label">🎯 Trigger Matched:</span>
                  <span class="turn-row-value"><code>${turn.triggerMatched}</code></span>
                </div>
              ` : ''}
              ${turn.triggerShouldHaveMatched ? `
                <div class="turn-row trigger-row should-match">
                  <span class="turn-row-label">🎯 Should Have Matched:</span>
                  <span class="turn-row-value"><code>${turn.triggerShouldHaveMatched}</code></span>
                </div>
              ` : ''}
              ${turn.responseIssues && turn.responseIssues.length > 0 ? `
                <div class="turn-row issues-row">
                  <span class="turn-row-label">⚠️ Response Issues:</span>
                  <span class="turn-row-value">${turn.responseIssues.join(', ')}</span>
                </div>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </section>
    `;
  }

  function renderRootCause(intel) {
    const rc = intel.rootCauseAnalysis;
    if (!rc) return '';

    return `
      <section class="analysis-section root-cause-section">
        <h2 class="section-title">🔍 ROOT CAUSE ANALYSIS</h2>

        ${rc.primaryRootCause ? `
          <div class="root-cause-box">
            <div class="root-cause-label">Primary Root Cause</div>
            <p class="root-cause-text">${rc.primaryRootCause}</p>
          </div>
        ` : ''}

        ${rc.triggerGaps && rc.triggerGaps.length > 0 ? `
          <div class="root-cause-subsection">
            <h3>⚠️ Trigger Gaps (${rc.triggerGaps.length})</h3>
            ${rc.triggerGaps.map(gap => `
              <div class="trigger-gap-card priority-${gap.priority || 'medium'}">
                <div class="gap-header">
                  <strong>${gap.triggerLabel || gap.missingTrigger || 'Unknown trigger'}</strong>
                  <span class="gap-priority">${getPriorityBadge(gap.priority || 'medium')}</span>
                </div>
                ${gap.evidence ? `<p class="gap-evidence">Evidence: "${gap.evidence}"</p>` : ''}
                ${gap.suggestedKeywords && gap.suggestedKeywords.length > 0 ? `
                  <div class="gap-keywords">
                    <span class="gap-kw-label">Suggested Keywords:</span>
                    ${gap.suggestedKeywords.map(kw => `<code class="keyword-chip">${kw}</code>`).join(' ')}
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${rc.falsePositives && rc.falsePositives.length > 0 ? `
          <div class="root-cause-subsection">
            <h3>🚨 False Positives (${rc.falsePositives.length})</h3>
            ${rc.falsePositives.map(fp => `
              <div class="false-positive-alert">
                <div class="fp-header">
                  <strong>${fp.triggerLabel || fp.triggerId}</strong>
                  <span class="fp-badge">FALSE POSITIVE</span>
                </div>
                ${fp.matchedOn ? `<p class="fp-detail"><strong>Matched On:</strong> "${fp.matchedOn}"</p>` : ''}
                ${fp.actualCallerIntent ? `<p class="fp-detail"><strong>Actual Intent:</strong> ${fp.actualCallerIntent}</p>` : ''}
                ${fp.fix ? `<p class="fp-fix"><strong>Fix:</strong> ${fp.fix}</p>` : ''}
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${rc.systemDesignIssues && rc.systemDesignIssues.length > 0 ? `
          <div class="root-cause-subsection">
            <h3>🏗️ System Design Issues</h3>
            <ul class="system-issues-list">
              ${rc.systemDesignIssues.map(issue => `<li>${issue}</li>`).join('')}
            </ul>
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

  function renderVoiceDeliverySummary(intel) {
    const vd = intel.callContext?.voiceDelivery;
    if (!vd || !vd.spokenLines || vd.spokenLines.length === 0) return '';

    const hasTwilioFallback = vd.hadTwilioFallback;
    const alertClass = hasTwilioFallback ? 'voice-alert' : '';

    return `
      <section class="analysis-section ${alertClass}">
        <h2 class="section-title">🔊 VOICE DELIVERY AUDIT</h2>
        <p class="section-description">Everything spoken to the caller — voice provider, bridge lines, and actual text delivered.</p>
        ${hasTwilioFallback ? `
          <div class="voice-alert-banner">
            ⚠️ <strong>Twilio Voice Detected:</strong> ${vd.twilioSayCount} line(s) fell back to Twilio &lt;Say&gt; (default female voice) instead of ElevenLabs.
          </div>
        ` : ''}
        <div class="overview-grid">
          <div class="overview-item">
            <span class="overview-label">Total Lines Spoken:</span>
            <span class="overview-value">${vd.totalSpokenLines}</span>
          </div>
          <div class="overview-item">
            <span class="overview-label">Voice Providers:</span>
            <span class="overview-value">${vd.providers.map(p => `<code class="${p === 'twilio_say' ? 'voice-twilio' : 'voice-elevenlabs'}">${p}</code>`).join(', ')}</span>
          </div>
          <div class="overview-item">
            <span class="overview-label">ElevenLabs (Play):</span>
            <span class="overview-value">${vd.elevenLabsPlayCount}</span>
          </div>
          <div class="overview-item">
            <span class="overview-label">Twilio Say (Fallback):</span>
            <span class="overview-value ${vd.twilioSayCount > 0 ? 'voice-twilio' : ''}">${vd.twilioSayCount}</span>
          </div>
        </div>
        <div class="subsection">
          <h3>All Spoken Lines:</h3>
          <div class="spoken-lines-list">
            ${vd.spokenLines.map((line, i) => `
              <div class="spoken-line ${line.isBridge ? 'spoken-bridge' : ''} ${line.voiceProvider === 'twilio_say' ? 'spoken-twilio-fallback' : ''}">
                <div class="spoken-line-meta">
                  <span class="spoken-line-turn">Turn ${line.turn || '?'}</span>
                  <span class="spoken-line-provider ${line.voiceProvider === 'twilio_say' ? 'voice-twilio' : 'voice-elevenlabs'}">${line.voiceProvider || 'unknown'}</span>
                  <code class="spoken-line-verb">${line.verb || 'N/A'}</code>
                  ${line.isBridge ? '<span class="spoken-line-badge bridge-badge">BRIDGE</span>' : ''}
                  ${line.source ? `<span class="spoken-line-source">${line.source}</span>` : ''}
                </div>
                <div class="spoken-line-text">"${line.text}"</div>
              </div>
            `).join('')}
          </div>
        </div>
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
          <div class="turn-flow-card ${turn.traceOnly ? 'trace-only-turn' : ''}">
            <div class="turn-flow-header">
              <h3>Turn ${turn.turnNumber} ${turn.routingTier ? getTierBadgeCompact(turn.routingTier) : ''} ${turn.traceOnly ? '<span class="trace-only-label">TRACE ONLY</span>' : ''}</h3>
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

            ${turn.voiceDelivery ? `
              <div class="flow-step voice-delivery-step ${turn.voiceDelivery.textMismatch ? 'voice-mismatch' : ''} ${turn.voiceDelivery.voiceMismatch ? 'voice-fallback' : ''}">
                <div class="step-label">
                  <span class="step-icon">🔊</span>
                  <strong>VOICE DELIVERY</strong>
                  ${turn.voiceDelivery.textMismatch ? '<span class="mismatch-badge">⚠️ TEXT MISMATCH</span>' : ''}
                  ${turn.voiceDelivery.voiceMismatch ? '<span class="mismatch-badge voice-badge">📢 TWILIO VOICE</span>' : ''}
                </div>
                <div class="step-content">
                  ${turn.voiceDelivery.hadBridge ? `
                    <div class="step-detail full-width">
                      <span class="detail-label">Bridge Lines (${turn.voiceDelivery.bridgeCount}):</span>
                      <span class="detail-value">${(turn.voiceDelivery.entries || []).filter(e => e.isBridge).map(e => `"${e.text}" <code>${e.voiceProvider}</code>`).join(', ') || 'N/A'}</span>
                    </div>
                  ` : ''}
                  <div class="step-detail">
                    <span class="detail-label">Voice Provider:</span>
                    <span class="detail-value ${turn.voiceDelivery.voiceProvider === 'twilio_say' ? 'voice-twilio' : 'voice-elevenlabs'}">${turn.voiceDelivery.voiceProvider || 'Unknown'}</span>
                  </div>
                  <div class="step-detail">
                    <span class="detail-label">TwiML Verb:</span>
                    <span class="detail-value"><code>${turn.voiceDelivery.twimlVerb || 'N/A'}</code></span>
                  </div>
                  <div class="step-detail full-width">
                    <span class="detail-label">Caller Heard:</span>
                    <pre class="code-block ${turn.voiceDelivery.textMismatch ? 'mismatch-text' : ''}">${turn.voiceDelivery.deliveredText || 'N/A'}</pre>
                  </div>
                  ${turn.voiceDelivery.textMismatch ? `
                    <div class="step-detail full-width">
                      <span class="detail-label">System Intended:</span>
                      <pre class="code-block intended-text">${turn.voiceDelivery.intendedText || 'N/A'}</pre>
                    </div>
                    ${turn.voiceDelivery.sanitizerReason ? `
                      <div class="step-detail">
                        <span class="detail-label">Blocked By:</span>
                        <span class="detail-value voice-twilio">Sanitizer: ${turn.voiceDelivery.sanitizerReason}</span>
                      </div>
                    ` : ''}
                    ${turn.voiceDelivery.bridgePath ? `
                      <div class="step-detail">
                        <span class="detail-label">Bridge Path:</span>
                        <span class="detail-value"><code>${turn.voiceDelivery.bridgePath}</code></span>
                      </div>
                    ` : ''}
                  ` : ''}
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

  function renderTokenUsage(intel) {
    const t = intel.tokenUsage;
    if (!t) return '';

    const claudeTokens = t.claude?.totalTokens || 0;
    const claudeTurns = t.claude?.llmTurns || 0;
    const openaiTokens = t.openai?.totalTokens || 0;
    const openaiPrompt = t.openai?.promptTokens || 0;
    const openaiCompletion = t.openai?.completionTokens || 0;
    const openaiCostActual = t.openai?.totalCost || 0;
    const openaiCalls = t.openai?.callCount || 0;
    const openaiModel = t.openai?.model || null;
    const gpt4Tokens = t.gpt4Analysis?.totalTokens || 0;
    const gpt4Ran = t.gpt4Analysis?.enabled;
    const gpt4Model = t.gpt4Analysis?.model || 'gpt-4o';

    const totalAll = claudeTokens + openaiTokens + gpt4Tokens;

    // ── Accurate cost estimation (per 1M tokens, blended input/output) ──
    // Claude 3.5 Haiku: $0.25/1M input + $1.25/1M output → blended ~$0.80/1M
    // OpenAI T3 Fallback: use actual logged cost when available
    // gpt-4o-mini: $0.15/1M input + $0.60/1M output → blended ~$0.40/1M
    // gpt-4o: $2.50/1M input + $10/1M output → blended ~$5/1M
    // gpt-4-turbo: $10/1M input + $30/1M output → blended ~$15/1M (legacy)
    const claudeCostPer1M = 0.80;
    const modelCostMap = { 'gpt-4o-mini': 0.40, 'gpt-4o': 5.0, 'gpt-4-turbo': 15.0, 'gpt-4-turbo-preview': 15.0 };
    const gpt4AnalysisCostPer1M = modelCostMap[gpt4Model] || 5.0;

    const claudeCost = (claudeTokens / 1_000_000) * claudeCostPer1M;
    const openaiCost = openaiCostActual > 0 ? openaiCostActual : (openaiTokens / 1_000_000) * 3.0;
    const gpt4Cost = (gpt4Tokens / 1_000_000) * gpt4AnalysisCostPer1M;
    const totalCost = claudeCost + openaiCost + gpt4Cost;

    function fmtCost(val) {
      if (val === 0) return '$0.00';
      if (val < 0.01) return '<$0.01';
      return '$' + val.toFixed(4);
    }

    if (totalAll === 0 && !gpt4Ran) {
      return `
        <section class="analysis-section">
          <h2 class="section-title">🔢 TOKEN USAGE & COST</h2>
          <p style="color: #6B7280; font-size: 0.875rem;">No token usage data recorded for this call.</p>
        </section>
      `;
    }

    return `
      <section class="analysis-section">
        <h2 class="section-title">🔢 TOKEN USAGE & COST</h2>
        <div class="token-table-wrapper">
          <table class="token-table">
            <thead>
              <tr>
                <th>AI System</th>
                <th>Tokens</th>
                <th>Details</th>
                <th>Est. Cost (This Call)</th>
                <th>Est. Cost (1,000 Calls)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span class="token-system-badge claude-badge">🟣 Claude</span>
                  <span class="token-system-label">T2 LLM Agent</span>
                </td>
                <td class="token-number">${claudeTokens.toLocaleString()}</td>
                <td class="token-detail">${claudeTurns} LLM turn${claudeTurns !== 1 ? 's' : ''}</td>
                <td class="token-cost">${fmtCost(claudeCost)}</td>
                <td class="token-cost">${fmtCost(claudeCost * 1000)}</td>
              </tr>
              <tr>
                <td>
                  <span class="token-system-badge openai-badge">🟢 OpenAI</span>
                  <span class="token-system-label">T3 Fallback</span>
                </td>
                <td class="token-number">${openaiTokens.toLocaleString()}</td>
                <td class="token-detail">
                  ${openaiCalls} call${openaiCalls !== 1 ? 's' : ''}${openaiModel ? ' · ' + openaiModel : ''}
                  ${openaiTokens > 0 ? '<br><small>P: ' + openaiPrompt.toLocaleString() + ' · C: ' + openaiCompletion.toLocaleString() + '</small>' : ''}
                </td>
                <td class="token-cost">${fmtCost(openaiCost)}</td>
                <td class="token-cost">${fmtCost(openaiCost * 1000)}</td>
              </tr>
              <tr>
                <td>
                  <span class="token-system-badge gpt4-badge">🔵 GPT-4</span>
                  <span class="token-system-label">Analysis</span>
                </td>
                <td class="token-number">${gpt4Ran ? gpt4Tokens.toLocaleString() : '—'}</td>
                <td class="token-detail">${gpt4Ran ? gpt4Model + ' · Analysis complete' : 'Not yet analyzed'}</td>
                <td class="token-cost">${gpt4Ran ? fmtCost(gpt4Cost) : '—'}</td>
                <td class="token-cost">${gpt4Ran ? fmtCost(gpt4Cost * 1000) : '—'}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="token-total-row">
                <td><strong>📊 Total</strong></td>
                <td class="token-number"><strong>${totalAll.toLocaleString()}</strong></td>
                <td class="token-detail">All AI systems</td>
                <td class="token-cost"><strong>${fmtCost(totalCost)}</strong></td>
                <td class="token-cost"><strong>${fmtCost(totalCost * 1000)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p class="token-disclaimer">Cost estimates are approximate based on current API pricing. Actual costs may vary.</p>
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
    const gpt4 = intel.gpt4Analysis || {};

    return `
      <footer class="analysis-footer">
        <p>
          Analysis generated ${gpt4.enabled ? 'by GPT-4' : (intel.status === 'trace_only' ? 'from trace data' : 'by rule-based engine')}
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

  // =============================================================================
  // CUSTOM AUDIO PLAYER
  // =============================================================================

  function buildCustomPlayer(url) {
    const id = 'cvp-' + (++_playerCounter);
    return `
      <div class="cv-player" id="${id}">
        <audio class="cv-audio" src="${url}" preload="metadata"></audio>
        <button class="cv-btn cv-btn-play" title="Play / Pause">&#9654;</button>
        <button class="cv-btn cv-btn-skip" data-skip="-10" title="Back 10s">&#8722;10s</button>
        <div class="cv-seek-block">
          <span class="cv-time cv-time-cur">0:00</span>
          <input type="range" class="cv-seek" min="0" max="100" value="0" step="0.1">
          <span class="cv-time cv-time-dur">&#8210;</span>
        </div>
        <button class="cv-btn cv-btn-skip" data-skip="10" title="Forward 10s">+10s</button>
        <select class="cv-speed" title="Playback speed">
          <option value="0.75">0.75&#215;</option>
          <option value="1" selected>1&#215;</option>
          <option value="1.25">1.25&#215;</option>
          <option value="1.5">1.5&#215;</option>
          <option value="2">2&#215;</option>
        </select>
      </div>
    `;
  }

  function initCustomPlayer(wrapper) {
    const audio   = wrapper.querySelector('.cv-audio');
    const btnPlay = wrapper.querySelector('.cv-btn-play');
    const seek    = wrapper.querySelector('.cv-seek');
    const timeCur = wrapper.querySelector('.cv-time-cur');
    const timeDur = wrapper.querySelector('.cv-time-dur');
    const skipBtns = wrapper.querySelectorAll('.cv-btn-skip');
    const speedSel = wrapper.querySelector('.cv-speed');

    function fmt(s) {
      if (!s || isNaN(s)) return '0:00';
      const m = Math.floor(s / 60);
      return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    }

    audio.addEventListener('loadedmetadata', () => {
      seek.max = audio.duration;
      timeDur.textContent = fmt(audio.duration);
    });

    audio.addEventListener('timeupdate', () => {
      seek.value = audio.currentTime;
      timeCur.textContent = fmt(audio.currentTime);
    });

    audio.addEventListener('play', () => { btnPlay.innerHTML = '&#9646;&#9646;'; });
    audio.addEventListener('pause', () => { btnPlay.innerHTML = '&#9654;'; });
    audio.addEventListener('ended', () => { btnPlay.innerHTML = '&#9654;'; });

    btnPlay.addEventListener('click', () => {
      if (audio.paused) {
        document.querySelectorAll('.cv-audio').forEach(a => { if (a !== audio) { a.pause(); } });
        audio.play();
      } else {
        audio.pause();
      }
    });

    seek.addEventListener('input', () => { audio.currentTime = seek.value; });

    skipBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + Number(btn.dataset.skip)));
      });
    });

    speedSel.addEventListener('change', () => { audio.playbackRate = Number(speedSel.value); });
  }

  function initAllCustomPlayers(scope) {
    const root = scope || document;
    root.querySelectorAll('.cv-player:not([data-initialized])').forEach(wrapper => {
      wrapper.dataset.initialized = '1';
      initCustomPlayer(wrapper);
    });
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
    initAllCustomPlayers(DOM.modalBody);
  }

  function closeAnalysisModal() {
    DOM.analysisModal.classList.remove('active');
    document.body.style.overflow = '';
    state.selectedCallSid = null;
  }

  function openSettings() {
    DOM.settingsModal.classList.add('active');
    DOM.analysisMode.value = state.analysisMode;
    DOM.analysisModel.value = state.analysisModel;
  }

  function closeSettingsModal() {
    DOM.settingsModal.classList.remove('active');
  }

  async function saveSettings() {
    const gpt4Enabled = DOM.gpt4Toggle.checked;
    const analysisMode = DOM.analysisMode.value;
    const analysisModel = DOM.analysisModel.value;
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
          analysisModel,
          autoAnalyzeEnabled
        })
      });

      state.analysisMode = analysisMode;
      state.analysisModel = analysisModel;
      
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
      case 'trace_only':
        return {
          icon: '🔍',
          label: 'TRACE ONLY',
          fullLabel: 'TRACE DATA (GPT-4 NOT RUN)',
          className: 'status-trace'
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

  /**
   * Format seconds into M:SS display.
   * null/undefined = duration unknown (callback hasn't arrived) → shows "--"
   * 0              = legitimate zero-second call from Twilio    → shows "0:00"
   */
  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return '--';
    if (seconds === 0) return '0:00';
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
      showNotification('Copied!', 'success');
    } else {
      showNotification('Copy failed', 'error');
    }
  }

  function saveAsPdf() {
    showNotification('Preparing PDF...', 'info');
    setTimeout(() => window.print(), 100);
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
    // Micro-toast — small text that fades in/out near top-center
    const existing = document.querySelector('.micro-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `micro-toast micro-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 1800);
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
    console.log('[GPT4-ANALYZE] ▶ Button clicked — callSid:', callSid);
    try {
      console.log('[GPT4-ANALYZE] 📡 Calling POST /api/call-intelligence/analyze/' + callSid);
      console.log('[GPT4-ANALYZE] State — gpt4Enabled:', state.gpt4Enabled, 'analysisMode:', state.analysisMode, 'analysisModel:', state.analysisModel);
      const intelligence = await analyzeCall(callSid);
      console.log('[GPT4-ANALYZE] ✅ analyzeCall returned:', intelligence ? 'success' : 'null');
      if (intelligence) {
        console.log('[GPT4-ANALYZE] 🎨 Rendering analysis modal...');
        renderAnalysisModal(intelligence);
        console.log('[GPT4-ANALYZE] ✅ Modal rendered successfully');
      } else {
        console.warn('[GPT4-ANALYZE] ⚠️ analyzeCall returned null/undefined — nothing to render');
        showNotification('Analysis returned no data', 'error');
      }
    } catch (err) {
      console.error('[GPT4-ANALYZE] ❌ Error during analysis:', err);
      showNotification('Analysis failed: ' + err.message, 'error');
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
