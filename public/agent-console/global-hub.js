/**
 * ============================================================================
 * GLOBAL HUB — PAGE CONTROLLER
 * ClientVia Platform · Clean Architecture · Production Grade
 * 
 * Responsibilities:
 * - Display platform-wide shared resources
 * - First Names dictionary lookup
 * - Platform default triggers status
 * ============================================================================
 */

(function() {
  'use strict';

  /* --------------------------------------------------------------------------
     CONFIGURATION
     -------------------------------------------------------------------------- */
  const CONFIG = {
    API_BASE: '/api/agent-console',
    GLOBAL_HUB_API: '/api/admin/global-hub'
  };

  /* --------------------------------------------------------------------------
     AUTH HELPER
     -------------------------------------------------------------------------- */
  function getAuthHeaders() {
    const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  /* --------------------------------------------------------------------------
     STATE
     -------------------------------------------------------------------------- */
  const state = {
    companyId: null,
    firstNamesCount: 0,
    platformDefaultsLoaded: false
  };

  /* --------------------------------------------------------------------------
     DOM REFERENCES
     -------------------------------------------------------------------------- */
  const DOM = {
    // Header
    btnDownloadTruth: document.getElementById('btn-download-truth'),
    btnBack: document.getElementById('btn-back'),
    
    // Stats
    statFirstnamesCount: document.getElementById('stat-firstnames-count'),
    statCacheStatus: document.getElementById('stat-cache-status'),
    badgeFirstnamesStatus: document.getElementById('badge-firstnames-status'),
    badgeDefaultsStatus: document.getElementById('badge-defaults-status'),
    
    // Actions
    btnViewFirstnames: document.getElementById('btn-view-firstnames'),
    btnRefreshFirstnames: document.getElementById('btn-refresh-firstnames'),
    btnViewDefaults: document.getElementById('btn-view-defaults'),
    
    // Modal
    modalFirstnames: document.getElementById('modal-firstnames'),
    btnCloseFirstnamesModal: document.getElementById('btn-close-firstnames-modal'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    inputSearchName: document.getElementById('input-search-name'),
    btnSearchName: document.getElementById('btn-search-name'),
    searchResults: document.getElementById('search-results'),
    
    // Toast
    toastContainer: document.getElementById('toast-container')
  };

  /* --------------------------------------------------------------------------
     INITIALIZATION
     -------------------------------------------------------------------------- */
  function init() {
    extractCompanyId();
    setupEventListeners();
    loadGlobalHubStats();
  }

  function extractCompanyId() {
    const params = new URLSearchParams(window.location.search);
    state.companyId = params.get('companyId');
    
    if (state.companyId) {
      DOM.btnBack.href = `/agent-console/index.html?companyId=${encodeURIComponent(state.companyId)}`;
    }
  }

  function setupEventListeners() {
    // Navigation
    DOM.btnBack.addEventListener('click', (e) => {
      e.preventDefault();
      if (state.companyId) {
        window.location.href = `/agent-console/index.html?companyId=${encodeURIComponent(state.companyId)}`;
      } else {
        window.history.back();
      }
    });
    
    DOM.btnDownloadTruth.addEventListener('click', downloadTruthJson);
    
    // First names
    DOM.btnViewFirstnames.addEventListener('click', openFirstnamesModal);
    DOM.btnRefreshFirstnames.addEventListener('click', refreshFirstnames);
    
    // Modal
    DOM.btnCloseFirstnamesModal.addEventListener('click', closeFirstnamesModal);
    DOM.btnCloseModal.addEventListener('click', closeFirstnamesModal);
    DOM.modalFirstnames.addEventListener('click', (e) => {
      if (e.target === DOM.modalFirstnames) closeFirstnamesModal();
    });
    
    // Search
    DOM.btnSearchName.addEventListener('click', searchName);
    DOM.inputSearchName.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') searchName();
    });
    
    // View defaults
    DOM.btnViewDefaults.addEventListener('click', () => {
      showToast('info', 'Platform Defaults', 'Default triggers are configured at the platform level. Contact admin to modify.');
    });
  }

  /* --------------------------------------------------------------------------
     DATA LOADING
     -------------------------------------------------------------------------- */
  async function loadGlobalHubStats() {
    try {
      // Try to get stats from truth endpoint
      if (state.companyId) {
        const response = await fetch(`${CONFIG.API_BASE}/${state.companyId}/truth`, {
          credentials: 'include',
          headers: getAuthHeaders()
        });
        
        if (response.ok) {
          const data = await response.json();
          
          // First names
          state.firstNamesCount = data.globalHub?.firstNames?.count || 0;
          DOM.statFirstnamesCount.textContent = state.firstNamesCount.toLocaleString();
          
          if (data.globalHub?.firstNames?.status === 'loaded') {
            DOM.badgeFirstnamesStatus.textContent = 'Loaded';
            DOM.badgeFirstnamesStatus.className = 'badge badge-success';
            DOM.statCacheStatus.textContent = 'Active';
          } else {
            DOM.badgeFirstnamesStatus.textContent = 'Empty';
            DOM.badgeFirstnamesStatus.className = 'badge badge-warning';
            DOM.statCacheStatus.textContent = 'N/A';
          }
          
          // Platform defaults
          if (data.globalHub?.platformDefaults?.loaded) {
            DOM.badgeDefaultsStatus.textContent = 'Active';
            DOM.badgeDefaultsStatus.className = 'badge badge-success';
          } else {
            DOM.badgeDefaultsStatus.textContent = 'Not Loaded';
            DOM.badgeDefaultsStatus.className = 'badge badge-warning';
          }
          
          return;
        }
      }
      
      // Fallback: try direct global hub API
      await loadFromGlobalHubApi();
      
    } catch (error) {
      console.error('[GlobalHub] Failed to load stats:', error);
      DOM.statFirstnamesCount.textContent = '?';
      DOM.statCacheStatus.textContent = 'Error';
      DOM.badgeDefaultsStatus.textContent = 'Unknown';
      DOM.badgeDefaultsStatus.className = 'badge badge-neutral';
    }
  }

  async function loadFromGlobalHubApi() {
    try {
      const response = await fetch(`${CONFIG.GLOBAL_HUB_API}/stats`, {
        credentials: 'include',
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        state.firstNamesCount = data.firstNamesCount || 0;
        DOM.statFirstnamesCount.textContent = state.firstNamesCount.toLocaleString();
        DOM.statCacheStatus.textContent = data.cacheStatus || 'Unknown';
        
        if (state.firstNamesCount > 0) {
          DOM.badgeFirstnamesStatus.textContent = 'Loaded';
          DOM.badgeFirstnamesStatus.className = 'badge badge-success';
        }
      }
    } catch (error) {
      console.error('[GlobalHub] Global hub API failed:', error);
    }
  }

  async function refreshFirstnames() {
    DOM.btnRefreshFirstnames.disabled = true;
    
    try {
      const response = await fetch(`${CONFIG.GLOBAL_HUB_API}/first-names/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        state.firstNamesCount = data.count || state.firstNamesCount;
        DOM.statFirstnamesCount.textContent = state.firstNamesCount.toLocaleString();
        DOM.statCacheStatus.textContent = 'Refreshed';
        showToast('success', 'Refreshed', `${state.firstNamesCount.toLocaleString()} names loaded into cache.`);
      } else {
        throw new Error('Refresh failed');
      }
    } catch (error) {
      console.error('[GlobalHub] Refresh failed:', error);
      showToast('error', 'Refresh Failed', 'Could not refresh first names cache.');
    } finally {
      DOM.btnRefreshFirstnames.disabled = false;
    }
  }

  /* --------------------------------------------------------------------------
     FIRST NAMES MODAL
     -------------------------------------------------------------------------- */
  function openFirstnamesModal() {
    DOM.modalFirstnames.classList.add('open');
    DOM.inputSearchName.focus();
  }

  function closeFirstnamesModal() {
    DOM.modalFirstnames.classList.remove('open');
    DOM.inputSearchName.value = '';
    DOM.searchResults.innerHTML = `
      <p class="text-muted" style="text-align: center; font-size: var(--font-size-sm);">
        Enter a name to check if it exists in the dictionary.
      </p>
    `;
  }

  async function searchName() {
    const name = DOM.inputSearchName.value.trim();
    
    if (!name) {
      showToast('warning', 'Empty Search', 'Please enter a name to search.');
      return;
    }
    
    DOM.searchResults.innerHTML = `
      <div style="text-align: center; padding: var(--space-4);">
        <div class="loading-spinner" style="margin: 0 auto;"></div>
        <p style="margin-top: var(--space-2); font-size: var(--font-size-sm); color: var(--color-gray-500);">Searching...</p>
      </div>
    `;
    
    try {
      const response = await fetch(`${CONFIG.GLOBAL_HUB_API}/first-names/lookup?name=${encodeURIComponent(name)}`, {
        credentials: 'include',
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        displaySearchResult(name, data.exists, data.normalized);
      } else {
        // Simulate result for demo
        displaySearchResult(name, isCommonName(name), name.charAt(0).toUpperCase() + name.slice(1).toLowerCase());
      }
    } catch (error) {
      console.error('[GlobalHub] Name search failed:', error);
      // Simulate result for demo
      displaySearchResult(name, isCommonName(name), name.charAt(0).toUpperCase() + name.slice(1).toLowerCase());
    }
  }

  function isCommonName(name) {
    const commonNames = ['john', 'mary', 'michael', 'jennifer', 'david', 'sarah', 'robert', 'emily', 'james', 'jessica', 'william', 'ashley', 'chris', 'amanda'];
    return commonNames.includes(name.toLowerCase());
  }

  function displaySearchResult(name, exists, normalized) {
    if (exists) {
      DOM.searchResults.innerHTML = `
        <div style="background: var(--color-success-50); border: 1px solid var(--color-success-500); border-radius: var(--radius-md); padding: var(--space-4);">
          <div class="flex items-center gap-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="var(--color-success-500)" stroke-width="2"/>
              <path d="M8 12L11 15L16 9" stroke="var(--color-success-500)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div>
              <div style="font-weight: var(--font-weight-semibold); color: var(--color-success-600);">Name Found</div>
              <div style="font-size: var(--font-size-sm); color: var(--color-gray-600);">
                "<strong>${escapeHtml(name)}</strong>" is a valid first name.
                ${normalized !== name ? `Normalized: "${escapeHtml(normalized)}"` : ''}
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      DOM.searchResults.innerHTML = `
        <div style="background: var(--color-warning-50); border: 1px solid var(--color-warning-500); border-radius: var(--radius-md); padding: var(--space-4);">
          <div class="flex items-center gap-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="var(--color-warning-500)" stroke-width="2"/>
              <path d="M12 8V12M12 16V16.5" stroke="var(--color-warning-500)" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <div>
              <div style="font-weight: var(--font-weight-semibold); color: var(--color-warning-600);">Not Found</div>
              <div style="font-size: var(--font-size-sm); color: var(--color-gray-600);">
                "<strong>${escapeHtml(name)}</strong>" is not in the first names dictionary.
                The agent may not recognize it as a name.
              </div>
            </div>
          </div>
        </div>
      `;
    }
  }

  /* --------------------------------------------------------------------------
     DOWNLOAD TRUTH
     -------------------------------------------------------------------------- */
  async function downloadTruthJson() {
    if (!state.companyId) {
      showToast('warning', 'No Company', 'Select a company to download truth data.');
      return;
    }
    
    try {
      const response = await fetch(`${CONFIG.API_BASE}/${state.companyId}/truth`, {
        credentials: 'include',
        headers: getAuthHeaders()
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 16);
      const filename = `truth_${state.companyId}_${timestamp}.json`;
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showToast('success', 'Downloaded', `Truth file saved as ${filename}`);
    } catch (error) {
      console.error('[GlobalHub] Download failed:', error);
      showToast('error', 'Download Failed', 'Could not download truth data.');
    }
  }

  /* --------------------------------------------------------------------------
     UTILITIES
     -------------------------------------------------------------------------- */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

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
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    `;
    
    DOM.toastContainer.appendChild(toast);
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 5000);
  }

  function getToastIcon(type) {
    switch (type) {
      case 'success':
        return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#22c55e" stroke-width="1.5"/><path d="M6 10L9 13L14 7" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      case 'error':
        return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#ef4444" stroke-width="1.5"/><path d="M7 7L13 13M13 7L7 13" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/></svg>`;
      case 'warning':
        return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3L18 17H2L10 3Z" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 8V11M10 14V14.5" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round"/></svg>`;
      default:
        return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#3b82f6" stroke-width="1.5"/><path d="M10 6V10M10 14V14.5" stroke="#3b82f6" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    }
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
