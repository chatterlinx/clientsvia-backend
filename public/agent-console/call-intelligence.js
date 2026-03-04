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
      showLoading();

      const params = new URLSearchParams({
        page: state.currentPage,
        limit: 50,
        ...(state.filters.status && { status: state.filters.status })
      });

      const data = await apiCall(
        `/api/call-intelligence/company/${state.companyId}/list?${params}`
      );

      state.calls = data.items;
      state.totalPages = data.pages;

      renderCalls();
      updatePagination();
    } catch (error) {
      console.error('Failed to load calls:', error);
      showError();
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
      const data = await apiCall('/api/call-intelligence/status');
      state.gpt4Enabled = data.status.enabled;
      
      updateGPT4StatusUI(data.status);
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
          <td colspan="8" class="empty-cell">
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
      DOM.modalBody.innerHTML = `
        <div class="error-container">
          <p>⚠️ No analysis available for this call.</p>
          <button class="btn btn-primary" onclick="analyzeCallNow('${callSid}')">
            Analyze Now
          </button>
        </div>
      `;
      return;
    }

    renderAnalysisModal(intelligence);
  }

  function renderAnalysisModal(intelligence) {
    const statusInfo = getStatusInfo(intelligence.status);
    
    DOM.modalBody.innerHTML = `
      ${renderCallOverview(intelligence)}
      ${renderExecutiveSummary(intelligence)}
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
                <strong>Affected:</strong> <code>${issue.affectedComponent}</code>
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
                <strong>Target Trigger:</strong> <code>${rec.targetTrigger}</code>
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
      btn.addEventListener('click', () => {
        const content = btn.dataset.content;
        copyToClipboard(content);
        showNotification('Copied to clipboard!', 'success');
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
    state.analysisMode = DOM.analysisMode.value;

    if (gpt4Enabled !== state.gpt4Enabled) {
      await toggleGPT4(gpt4Enabled);
    }

    showNotification('Settings saved!', 'success');
    closeSettingsModal();
  }

  // =============================================================================
  // UTILITY FUNCTIONS
  // =============================================================================

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

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch(err => {
      console.error('Failed to copy:', err);
    });
  }

  function copyAnalysisToClipboard() {
    const text = DOM.modalBody.innerText;
    copyToClipboard(text);
    showNotification('Analysis copied to clipboard!', 'success');
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
        <td colspan="8" class="loading-cell">
          <div class="loading-spinner"></div>
          <p>Loading call intelligence...</p>
        </td>
      </tr>
    `;
  }

  function showError() {
    DOM.callsTbody.innerHTML = `
      <tr class="error-row">
        <td colspan="8" class="error-cell">
          <p>⚠️ Failed to load calls. Please try again.</p>
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
