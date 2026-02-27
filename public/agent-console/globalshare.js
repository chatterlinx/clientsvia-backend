(function() {
  'use strict';
  
  console.log('[GlobalShare] ✓ Script loaded');

  const state = {
    firstNames: [],
    lastNames: [],
    hasChanges: false
  };

  let DOM = {};

  // ══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ══════════════════════════════════════════════════════════════════════════

  function initDOM() {
    console.log('[GlobalShare] ✓ initDOM() called');
    DOM = {
      btnBack: document.getElementById('btn-back'),
      btnSaveAll: document.getElementById('btn-save-all'),
      
      // Stats
      statFirstNames: document.getElementById('stat-first-names'),
      statLastNames: document.getElementById('stat-last-names'),
      statTotal: document.getElementById('stat-total'),
      firstNamesCount: document.getElementById('first-names-count'),
      firstNamesStatus: document.getElementById('first-names-status'),
      lastNamesCount: document.getElementById('last-names-count'),
      lastNamesStatus: document.getElementById('last-names-status'),
      
      // First Names buttons
      btnManageFirstNames: document.getElementById('btn-manage-first-names'),
      btnSearchFirstNames: document.getElementById('btn-search-first-names'),
      
      // Last Names buttons
      btnManageLastNames: document.getElementById('btn-manage-last-names'),
      btnSearchLastNames: document.getElementById('btn-search-last-names'),
      
      // Modals
      modalFirstNames: document.getElementById('modal-first-names'),
      modalLastNames: document.getElementById('modal-last-names'),
      
      // First Names modal
      btnCloseFirstModal: document.getElementById('btn-close-first-modal'),
      btnDoneFirst: document.getElementById('btn-done-first'),
      searchFirstInput: document.getElementById('search-first-input'),
      btnSearchFirst: document.getElementById('btn-search-first'),
      searchFirstResults: document.getElementById('search-first-results'),
      bulkFirstInput: document.getElementById('bulk-first-input'),
      btnBulkAddFirst: document.getElementById('btn-bulk-add-first'),
      firstNamesPreview: document.getElementById('first-names-preview'),
      previewFirstCount: document.getElementById('preview-first-count'),
      btnRefreshFirstPreview: document.getElementById('btn-refresh-first-preview'),
      
      // Last Names modal
      btnCloseLastModal: document.getElementById('btn-close-last-modal'),
      btnDoneLast: document.getElementById('btn-done-last'),
      searchLastInput: document.getElementById('search-last-input'),
      btnSearchLast: document.getElementById('btn-search-last'),
      searchLastResults: document.getElementById('search-last-results'),
      bulkLastInput: document.getElementById('bulk-last-input'),
      btnBulkAddLast: document.getElementById('btn-bulk-add-last'),
      lastNamesPreview: document.getElementById('last-names-preview'),
      previewLastCount: document.getElementById('preview-last-count'),
      btnRefreshLastPreview: document.getElementById('btn-refresh-last-preview')
    };
  }

  function init() {
    try {
      console.log('[GlobalShare] Initializing...');
      initDOM();
      bindEvents();
      loadStats();
      console.log('[GlobalShare] Initialization complete');
    } catch (err) {
      console.error('[GlobalShare] Initialization error:', err);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EVENT BINDING
  // ══════════════════════════════════════════════════════════════════════════

  function bindEvents() {
    if (DOM.btnBack) {
      DOM.btnBack.addEventListener('click', () => {
        const params = new URLSearchParams(window.location.search);
        const companyId = params.get('companyId');
        window.location.href = `/agent-console/index.html${companyId ? '?companyId=' + companyId : ''}`;
      });
    }

    // First Names
    if (DOM.btnManageFirstNames) DOM.btnManageFirstNames.addEventListener('click', () => openModal('first'));
    if (DOM.btnSearchFirstNames) DOM.btnSearchFirstNames.addEventListener('click', () => openSearchModal('first'));
    if (DOM.btnCloseFirstModal) DOM.btnCloseFirstModal.addEventListener('click', () => closeModal('first'));
    if (DOM.btnDoneFirst) DOM.btnDoneFirst.addEventListener('click', () => closeModal('first'));
    if (DOM.btnSearchFirst) DOM.btnSearchFirst.addEventListener('click', () => searchNames('first'));
    if (DOM.searchFirstInput) {
      DOM.searchFirstInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchNames('first');
      });
    }
    if (DOM.btnBulkAddFirst) DOM.btnBulkAddFirst.addEventListener('click', () => bulkAddNames('first'));
    if (DOM.btnRefreshFirstPreview) DOM.btnRefreshFirstPreview.addEventListener('click', () => loadNamesPreview('first'));
    
    // Last Names
    if (DOM.btnManageLastNames) DOM.btnManageLastNames.addEventListener('click', () => openModal('last'));
    if (DOM.btnSearchLastNames) DOM.btnSearchLastNames.addEventListener('click', () => openSearchModal('last'));
    if (DOM.btnCloseLastModal) DOM.btnCloseLastModal.addEventListener('click', () => closeModal('last'));
    if (DOM.btnDoneLast) DOM.btnDoneLast.addEventListener('click', () => closeModal('last'));
    if (DOM.btnSearchLast) DOM.btnSearchLast.addEventListener('click', () => searchNames('last'));
    if (DOM.searchLastInput) {
      DOM.searchLastInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchNames('last');
      });
    }
    if (DOM.btnBulkAddLast) DOM.btnBulkAddLast.addEventListener('click', () => bulkAddNames('last'));
    if (DOM.btnRefreshLastPreview) DOM.btnRefreshLastPreview.addEventListener('click', () => loadNamesPreview('last'));
    
    // Modal backdrop close
    if (DOM.modalFirstNames) {
      DOM.modalFirstNames.addEventListener('click', (e) => {
        if (e.target === DOM.modalFirstNames) closeModal('first');
      });
    }
    if (DOM.modalLastNames) {
      DOM.modalLastNames.addEventListener('click', (e) => {
        if (e.target === DOM.modalLastNames) closeModal('last');
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DATA LOADING
  // ══════════════════════════════════════════════════════════════════════════

  async function loadStats() {
    try {
      console.log('[GlobalShare] Loading stats...');
      const data = await AgentConsoleAuth.apiFetch('/api/admin/globalshare/stats');
      
      if (data) {
        updateStats(data);
      }
    } catch (err) {
      console.error('[GlobalShare] Failed to load stats:', err);
      // Set defaults
      updateStats({ firstNames: 0, lastNames: 0 });
    }
  }

  function updateStats(data) {
    const firstCount = data.firstNames || 0;
    const lastCount = data.lastNames || 0;
    const total = firstCount + lastCount;
    
    if (DOM.statFirstNames) DOM.statFirstNames.textContent = firstCount.toLocaleString();
    if (DOM.statLastNames) DOM.statLastNames.textContent = lastCount.toLocaleString();
    if (DOM.statTotal) DOM.statTotal.textContent = total.toLocaleString();
    if (DOM.firstNamesCount) DOM.firstNamesCount.textContent = firstCount.toLocaleString();
    if (DOM.lastNamesCount) DOM.lastNamesCount.textContent = lastCount.toLocaleString();
    if (DOM.firstNamesStatus) DOM.firstNamesStatus.textContent = firstCount > 0 ? 'Loaded' : 'Empty';
    if (DOM.lastNamesStatus) DOM.lastNamesStatus.textContent = lastCount > 0 ? 'Loaded' : 'Empty';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MODALS
  // ══════════════════════════════════════════════════════════════════════════

  function openModal(type) {
    const modal = type === 'first' ? DOM.modalFirstNames : DOM.modalLastNames;
    if (modal) {
      modal.classList.add('open');
      loadNamesPreview(type);
    }
  }

  function openSearchModal(type) {
    openModal(type);
    const input = type === 'first' ? DOM.searchFirstInput : DOM.searchLastInput;
    if (input) {
      setTimeout(() => input.focus(), 100);
    }
  }

  function closeModal(type) {
    const modal = type === 'first' ? DOM.modalFirstNames : DOM.modalLastNames;
    if (modal) {
      modal.classList.remove('open');
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SEARCH with FUZZY MATCHING
  // ══════════════════════════════════════════════════════════════════════════

  async function searchNames(type) {
    const input = type === 'first' ? DOM.searchFirstInput : DOM.searchLastInput;
    const resultsDiv = type === 'first' ? DOM.searchFirstResults : DOM.searchLastResults;
    const query = input?.value?.trim();
    
    if (!query) {
      resultsDiv.innerHTML = '<p style="text-align: center; color: #94a3b8; font-size: 13px;">Enter a name to search</p>';
      return;
    }
    
    try {
      resultsDiv.innerHTML = '<p style="text-align: center; color: #94a3b8; font-size: 13px;">Searching...</p>';
      
      const endpoint = type === 'first' ? 'first-names' : 'last-names';
      const data = await AgentConsoleAuth.apiFetch(`/api/admin/globalshare/${endpoint}/search?q=${encodeURIComponent(query)}`);
      
      if (data.results && data.results.length > 0) {
        resultsDiv.innerHTML = data.results.map(result => `
          <div class="search-result-item">
            <div>
              <span class="search-result-name">${escapeHtml(result.name)}</span>
              ${result.matchType === 'exact' 
                ? '<span class="match-badge">Exact Match</span>' 
                : `<span class="match-badge fuzzy">Fuzzy (${Math.round(result.similarity * 100)}%)</span>`
              }
            </div>
            ${result.matchType === 'fuzzy' 
              ? `<span class="search-result-match">for "${escapeHtml(query)}"</span>`
              : ''
            }
          </div>
        `).join('');
      } else {
        resultsDiv.innerHTML = `
          <div style="text-align: center; padding: 24px; color: #94a3b8;">
            <div style="font-size: 32px; margin-bottom: 8px;">🔍</div>
            <div style="font-size: 14px;">No matches found for "${escapeHtml(query)}"</div>
            <div style="font-size: 12px; margin-top: 4px;">Try a different spelling or add it via Bulk Upload</div>
          </div>
        `;
      }
    } catch (err) {
      console.error('[GlobalShare] Search failed:', err);
      resultsDiv.innerHTML = '<p style="text-align: center; color: #dc2626; font-size: 13px;">Search failed. Please try again.</p>';
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BULK UPLOAD
  // ══════════════════════════════════════════════════════════════════════════

  async function bulkAddNames(type) {
    const input = type === 'first' ? DOM.bulkFirstInput : DOM.bulkLastInput;
    const text = input?.value?.trim();
    
    if (!text) {
      alert('Please enter names to add');
      return;
    }
    
    try {
      // Parse comma-separated names
      const rawNames = text.split(',').map(n => n.trim()).filter(Boolean);
      
      if (rawNames.length === 0) {
        alert('No valid names found');
        return;
      }
      
      if (rawNames.length > 10000) {
        alert(`Too many names at once (${rawNames.length}). Please upload in batches of 10,000 or less.`);
        return;
      }
      
      const confirmed = confirm(`Add ${rawNames.length.toLocaleString()} names?\n\nAuto-deduplication will remove any duplicates.`);
      if (!confirmed) return;
      
      const btn = type === 'first' ? DOM.btnBulkAddFirst : DOM.btnBulkAddLast;
      btn.disabled = true;
      btn.textContent = 'Processing...';
      
      const endpoint = type === 'first' ? 'first-names' : 'last-names';
      const result = await AgentConsoleAuth.apiFetch(
        `/api/admin/globalshare/${endpoint}/bulk-add`,
        {
          method: 'POST',
          body: { names: rawNames }
        }
      );
      
      alert(`✅ Success!\n\nAdded: ${result.added}\nDuplicates skipped: ${result.duplicates}\nTotal now: ${result.totalCount.toLocaleString()}`);
      
      // Clear input and reload
      input.value = '';
      await loadStats();
      await loadNamesPreview(type);
      
    } catch (err) {
      console.error('[GlobalShare] Bulk add failed:', err);
      alert('Failed to add names: ' + err.message);
    } finally {
      const btn = type === 'first' ? DOM.btnBulkAddFirst : DOM.btnBulkAddLast;
      btn.disabled = false;
      btn.textContent = 'Add Names';
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NAMES PREVIEW
  // ══════════════════════════════════════════════════════════════════════════

  async function loadNamesPreview(type) {
    const previewDiv = type === 'first' ? DOM.firstNamesPreview : DOM.lastNamesPreview;
    const countSpan = type === 'first' ? DOM.previewFirstCount : DOM.previewLastCount;
    
    try {
      previewDiv.innerHTML = '<p style="text-align: center; color: #94a3b8; font-size: 13px;">Loading...</p>';
      
      const endpoint = type === 'first' ? 'first-names' : 'last-names';
      const data = await AgentConsoleAuth.apiFetch(`/api/admin/globalshare/${endpoint}?limit=200`);
      
      if (data.names && data.names.length > 0) {
        countSpan.textContent = data.totalCount.toLocaleString();
        
        // Show first 200 as chips
        previewDiv.innerHTML = data.names.map(name => `
          <span class="name-item">
            ${escapeHtml(name)}
          </span>
        `).join('');
        
        if (data.totalCount > 200) {
          previewDiv.innerHTML += `
            <div style="text-align: center; padding: 16px; color: #64748b; font-size: 12px;">
              Showing first 200 of ${data.totalCount.toLocaleString()} names
            </div>
          `;
        }
      } else {
        countSpan.textContent = '0';
        previewDiv.innerHTML = '<p style="text-align: center; color: #94a3b8; font-size: 13px;">No names yet. Use Bulk Upload to add names.</p>';
      }
    } catch (err) {
      console.error('[GlobalShare] Failed to load preview:', err);
      previewDiv.innerHTML = '<p style="text-align: center; color: #dc2626; font-size: 13px;">Failed to load names</p>';
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ══════════════════════════════════════════════════════════════════════════

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BOOT
  // ══════════════════════════════════════════════════════════════════════════

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('[GlobalShare] ✓ IIFE complete');
})();
