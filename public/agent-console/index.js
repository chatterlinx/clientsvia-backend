/**
 * ============================================================================
 * AGENT CONSOLE — DASHBOARD CONTROLLER
 * ClientVia Platform · Clean Architecture · Production Grade
 * 
 * Responsibilities:
 * - Initialize dashboard with company context
 * - Handle navigation to sub-pages
 * - Manage Runtime Truth panel
 * - Master Download Truth JSON functionality
 * ============================================================================
 */

(function() {
  'use strict';

  /* --------------------------------------------------------------------------
     CONFIGURATION
     -------------------------------------------------------------------------- */
  const CONFIG = {
    API_BASE: '/api/agent-console',
    BUILD_VERSION: '1.0.0',
    BUILD_DATE: new Date().toISOString().split('T')[0]
  };

  /* --------------------------------------------------------------------------
     STATE
     -------------------------------------------------------------------------- */
  const state = {
    companyId: null,
    companyName: null,
    truthData: null,
    isLoading: false
  };

  /* --------------------------------------------------------------------------
     DOM REFERENCES
     -------------------------------------------------------------------------- */
  const DOM = {
    // Header - Note: btnDownloadTruth in header handled by shared/truthButton.js
    headerCompanyName: document.getElementById('header-company-name'),
    headerCompanyId: document.getElementById('header-company-id'),
    btnLogout: document.getElementById('btn-logout'),
    btnBackToProfile: document.getElementById('btn-back-to-profile'),
    
    // Truth Panel
    btnRefreshTruth: document.getElementById('btn-refresh-truth'),
    btnCopyTruth: document.getElementById('btn-copy-truth'),
    btnDownloadTruthInline: document.getElementById('btn-download-truth-inline'),
    truthJsonDisplay: document.getElementById('truth-json-display'),
    
    // Navigation Cards
    navCards: document.querySelectorAll('.nav-card[data-navigate]'),
    
    // Footer
    footerEnvironment: document.getElementById('footer-environment'),
    footerBuild: document.getElementById('footer-build'),
    
    // Toast
    toastContainer: document.getElementById('toast-container')
  };

  /* --------------------------------------------------------------------------
     INITIALIZATION
     -------------------------------------------------------------------------- */
  function init() {
    // Require auth before anything else
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
    loadInitialData();
  }

  function extractCompanyId() {
    const params = new URLSearchParams(window.location.search);
    state.companyId = params.get('companyId');
    
    if (state.companyId) {
      DOM.headerCompanyId.textContent = truncateId(state.companyId);
      DOM.headerCompanyId.title = state.companyId;
      
      // Update header logo link with companyId
      const logoLink = document.getElementById('header-logo-link');
      if (logoLink) {
        logoLink.href = `/company-profile.html?companyId=${encodeURIComponent(state.companyId)}`;
      }
    }
  }

  function truncateId(id) {
    if (id.length <= 12) return id;
    return `${id.slice(0, 6)}...${id.slice(-4)}`;
  }

  function setupEventListeners() {
    // Note: Header Download Truth Button handled by shared/truthButton.js
    
    // Back to Company Profile (both buttons)
    const navigateToCompanyProfile = () => {
      window.location.href = `/company-profile.html?companyId=${encodeURIComponent(state.companyId)}`;
    };
    DOM.btnLogout.addEventListener('click', navigateToCompanyProfile);
    DOM.btnBackToProfile.addEventListener('click', navigateToCompanyProfile);
    
    // Truth Panel Actions
    DOM.btnRefreshTruth.addEventListener('click', refreshTruthData);
    DOM.btnCopyTruth.addEventListener('click', copyTruthToClipboard);
    DOM.btnDownloadTruthInline.addEventListener('click', downloadTruthJson);
    
    // Navigation Cards
    DOM.navCards.forEach(card => {
      card.addEventListener('click', () => {
        const target = card.dataset.navigate;
        navigateTo(target);
      });
    });
  }

  function updateFooter() {
    DOM.footerBuild.textContent = CONFIG.BUILD_DATE;
    
    // Detect environment from hostname
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      DOM.footerEnvironment.textContent = 'Development';
    } else if (hostname.includes('staging') || hostname.includes('test')) {
      DOM.footerEnvironment.textContent = 'Staging';
    } else {
      DOM.footerEnvironment.textContent = 'Production';
    }
  }

  /* --------------------------------------------------------------------------
     DATA LOADING
     -------------------------------------------------------------------------- */
  async function loadInitialData() {
    setLoading(true);
    
    try {
      // Truth endpoint includes company info, no separate call needed
      await loadTruthData();
    } catch (error) {
      console.error('[AgentConsole] Failed to load initial data:', error);
      showToast('error', 'Load Failed', 'Could not load company data. Please refresh.');
    } finally {
      setLoading(false);
    }
  }

  async function loadTruthData() {
    return refreshTruthData();
  }

  async function refreshTruthData() {
    try {
      DOM.truthJsonDisplay.textContent = 'Loading...';
      
      state.truthData = await AgentConsoleAuth.apiFetch(`${CONFIG.API_BASE}/${state.companyId}/truth`);
      
      // Extract company name from truth data
      state.companyName = state.truthData?.companyProfile?.businessName || 
                          state.truthData?.companyProfile?.companyName || 
                          'Unknown Company';
      DOM.headerCompanyName.textContent = state.companyName;
      
      renderTruthJson(state.truthData);
      showToast('success', 'Truth Refreshed', 'Runtime truth data updated successfully.');
    } catch (error) {
      console.error('[AgentConsole] Failed to load truth data:', error);
      DOM.truthJsonDisplay.textContent = JSON.stringify({ error: 'Failed to load truth data' }, null, 2);
      DOM.headerCompanyName.textContent = 'Company';
      showToast('error', 'Refresh Failed', 'Could not load runtime truth data.');
    }
  }

  /* --------------------------------------------------------------------------
     TRUTH JSON RENDERING
     -------------------------------------------------------------------------- */
  function renderTruthJson(data) {
    const formatted = JSON.stringify(data, null, 2);
    const highlighted = syntaxHighlight(formatted);
    DOM.truthJsonDisplay.innerHTML = highlighted;
  }

  function syntaxHighlight(json) {
    // Escape HTML entities first
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // Apply syntax highlighting
    return json.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      function(match) {
        let cls = 'json-number';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'json-key';
          } else {
            cls = 'json-string';
          }
        } else if (/true|false/.test(match)) {
          cls = 'json-boolean';
        } else if (/null/.test(match)) {
          cls = 'json-null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
      }
    );
  }

  /* --------------------------------------------------------------------------
     TRUTH ACTIONS
     -------------------------------------------------------------------------- */
  async function downloadTruthJson() {
    if (!state.truthData) {
      showToast('warning', 'No Data', 'Please wait for truth data to load.');
      return;
    }
    
    try {
      // Fetch fresh data for download
      const data = await AgentConsoleAuth.apiFetch(`${CONFIG.API_BASE}/${state.companyId}/truth`);
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      // Generate filename with timestamp
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 16);
      const filename = `truth_${state.companyId}_${timestamp}.json`;
      
      // Trigger download
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showToast('success', 'Downloaded', `Truth file saved as ${filename}`);
    } catch (error) {
      console.error('[AgentConsole] Download failed:', error);
      showToast('error', 'Download Failed', 'Could not download truth data.');
    }
  }

  async function copyTruthToClipboard() {
    if (!state.truthData) {
      showToast('warning', 'No Data', 'Please wait for truth data to load.');
      return;
    }
    
    try {
      const jsonString = JSON.stringify(state.truthData, null, 2);
      await navigator.clipboard.writeText(jsonString);
      showToast('success', 'Copied', 'Truth JSON copied to clipboard.');
    } catch (error) {
      console.error('[AgentConsole] Copy failed:', error);
      showToast('error', 'Copy Failed', 'Could not copy to clipboard.');
    }
  }

  /* --------------------------------------------------------------------------
     NAVIGATION
     -------------------------------------------------------------------------- */
  function navigateTo(page) {
    const baseUrl = '/agent-console';
    const companyParam = `?companyId=${encodeURIComponent(state.companyId)}`;
    
    switch (page) {
      case 'callconsole':
        window.location.href = `${baseUrl}/callconsole.html${companyParam}`;
        break;
      case 'callcenter':
        window.location.href = `/call-center.html${companyParam}`;
        break;
      case 'scrabengine':
        window.location.href = `${baseUrl}/scrabengine.html${companyParam}`;
        break;
      case 'agent2':
        window.location.href = `${baseUrl}/agent2.html${companyParam}`;
        break;
      case 'globalshare':
        window.location.href = `${baseUrl}/globalshare.html${companyParam}`;
        break;
      case 'llm':
        window.location.href = `${baseUrl}/llm.html${companyParam}`;
        break;
      case 'booking':
        window.location.href = `${baseUrl}/booking.html${companyParam}`;
        break;
      case 'calendar':
        window.location.href = `${baseUrl}/calendar.html${companyParam}`;
        break;
      case 'flow-map':
        window.location.href = `${baseUrl}/flow-map.html${companyParam}`;
        break;
      default:
        console.warn('[AgentConsole] Unknown navigation target:', page);
    }
  }

  /* --------------------------------------------------------------------------
     UI HELPERS
     -------------------------------------------------------------------------- */
  function setLoading(isLoading) {
    state.isLoading = isLoading;
    DOM.btnRefreshTruth.disabled = isLoading;
    if (DOM.btnDownloadTruthInline) DOM.btnDownloadTruthInline.disabled = isLoading;
  }

  /* --------------------------------------------------------------------------
     TOAST NOTIFICATIONS
     -------------------------------------------------------------------------- */
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
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (toast.parentElement) {
        toast.remove();
      }
    }, 5000);
  }

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

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /* --------------------------------------------------------------------------
     BOOTSTRAP
     -------------------------------------------------------------------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
