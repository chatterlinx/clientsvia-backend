(function() {
  'use strict';

  console.log('[GlobalShare] ✓ Script loaded');

  const state = {
    firstNames: [],
    lastNames: [],
    hasChanges: false,
    // Conversation Signals — keyed by group name
    signals: {
      affirmatives:    [],
      negatives:       [],
      bookingPhrases:  [],
      exitPhrases:     [],
      transferPhrases: []
    },
    signalsChanged: {} // track which groups have unsaved changes
  };

  // ── Signal group metadata — controls how each group is presented in the UI ─
  const SIGNAL_GROUPS = [
    {
      key:   'affirmatives',
      icon:  '✅',
      title: 'YES — Affirmatives',
      desc:  'Used when: the AI is waiting for a YES to confirm a booking summary, accept an upsell, or verify a detail. Words like "yep", "uh-huh", "sounds great".'
    },
    {
      key:   'negatives',
      icon:  '❌',
      title: 'NO — Negatives',
      desc:  'Used when: the AI is waiting for a NO to decline an upsell or skip a step. Words like "nah", "not interested", "maybe later".'
    },
    {
      key:   'bookingPhrases',
      icon:  '📅',
      title: 'Booking Intent',
      desc:  'Used when: the AI decides the caller is ready to schedule. Phrases like "book it", "schedule a visit", "when can you come". Single-word affirmatives above are also checked here.'
    },
    {
      key:   'exitPhrases',
      icon:  '👋',
      title: 'Exit Intent',
      desc:  'Used when: the AI detects the caller wants to end the topic or hang up. Phrases like "never mind", "I\'ll call back", "goodbye".'
    },
    {
      key:   'transferPhrases',
      icon:  '📞',
      title: 'Transfer Intent',
      desc:  'Used when: the AI detects the caller wants to speak to a human. Phrases like "transfer me", "get me a manager", "speak to someone".'
    }
  ];

  let DOM = {};

  // ── Auto-save: debounced save per section ──────────────────────────────
  // Each section gets its own debounce timer so rapid edits batch into one
  // API call.  800ms after the last change, the section saves silently.
  const _autoSaveTimers = {};
  let _autoSaveFlashTimer = null;
  function _autoSave(sectionType, sectionKey) {
    const timerKey = `${sectionType}:${sectionKey}`;
    clearTimeout(_autoSaveTimers[timerKey]);
    _autoSaveTimers[timerKey] = setTimeout(async () => {
      try {
        if (sectionType === 'pi')     await piSaveSection(sectionKey);
        if (sectionType === 'signal') await _saveSignalGroup(sectionKey);
        if (sectionType === 'lap')    await _saveLapGroup(sectionKey);
        _flashAutoSaveStatus('✓ Saved');
      } catch (e) {
        console.warn('[GlobalShare] Auto-save failed:', timerKey, e.message);
        _flashAutoSaveStatus('✗ Save failed', true);
      }
    }, 800);
  }
  function _flashAutoSaveStatus(text, isError) {
    const el = document.getElementById('autosave-status');
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? '#ef4444' : '#10b981';
    el.style.opacity = '1';
    clearTimeout(_autoSaveFlashTimer);
    _autoSaveFlashTimer = setTimeout(() => { el.style.opacity = '0'; }, 2000);
  }

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
      
      // Conversation Signals
      signalsGrid:      document.getElementById('signals-grid'),
      signalsTestInput: document.getElementById('signals-test-input'),
      signalsTestResults: document.getElementById('signals-test-results'),
      statSignals:      document.getElementById('stat-signals'),

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
      loadSignals();
      loadLapGroups();
      loadPhraseIntelligence();
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
    
    // Signals test — Enter key
    if (DOM.signalsTestInput) {
      DOM.signalsTestInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') testSignalPhrase();
      });
    }

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

    // ── Save All Changes — manual fallback ──────────────────────────────
    if (DOM.btnSaveAll) {
      DOM.btnSaveAll.addEventListener('click', async () => {
        DOM.btnSaveAll.disabled = true;
        DOM.btnSaveAll.textContent = 'Saving…';
        try {
          // PI sections
          await Promise.allSettled([
            piSaveSection('intentNormalizers'),
            piSaveSection('synonymGroups'),
            piSaveSection('stopWords'),
            piSaveSection('dangerWords'),
            piSaveSection('cuePhrases'),
          ]);
          // Signal groups
          const signalKeys = Object.keys(state.signals);
          await Promise.allSettled(signalKeys.map(k => _saveSignalGroup(k)));
          // LAP groups
          const lapIds = Object.keys(_lapState);
          await Promise.allSettled(lapIds.map(id => _saveLapGroup(id)));

          DOM.btnSaveAll.textContent = '✓ All Saved';
          _flashAutoSaveStatus('✓ All saved');
          setTimeout(() => { DOM.btnSaveAll.textContent = '💾 Save All Changes'; DOM.btnSaveAll.disabled = false; }, 2000);
        } catch (e) {
          DOM.btnSaveAll.textContent = '✗ Failed';
          setTimeout(() => { DOM.btnSaveAll.textContent = '💾 Save All Changes'; DOM.btnSaveAll.disabled = false; }, 2000);
        }
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
  // CONVERSATION SIGNALS
  // ══════════════════════════════════════════════════════════════════════════

  async function loadSignals() {
    try {
      console.log('[GlobalShare] Loading signals...');
      const data = await AgentConsoleAuth.apiFetch('/api/admin/globalshare/signals');
      if (data) {
        for (const group of SIGNAL_GROUPS) {
          if (Array.isArray(data[group.key])) {
            state.signals[group.key] = [...data[group.key]];
          }
        }
        _renderSignalsGrid();
        _updateSignalsStat();
      }
    } catch (err) {
      console.error('[GlobalShare] Failed to load signals:', err);
    }
  }

  function _renderSignalsGrid() {
    if (!DOM.signalsGrid) return;
    DOM.signalsGrid.innerHTML = SIGNAL_GROUPS.map(g => _renderSignalGroup(g)).join('');
  }

  function _renderSignalGroup(g) {
    const phrases = state.signals[g.key] || [];
    const changed = state.signalsChanged[g.key] ? ' (unsaved)' : '';
    const tags = phrases.map((p, i) => `
      <span class="signal-tag">
        ${escapeHtml(p)}
        <span class="signal-tag-remove" onclick="_removeSignalTag('${g.key}', ${i})" title="Remove">×</span>
      </span>
    `).join('');

    return `
      <div class="signal-group" id="signal-group-${g.key}">
        <div class="signal-group-header">
          <span class="signal-group-icon">${g.icon}</span>
          <span class="signal-group-title">${g.title}</span>
          <span class="signal-group-count" id="signal-count-${g.key}">${phrases.length} phrases${changed}</span>
        </div>
        <div class="signal-group-body">
          <p class="signal-group-desc">${escapeHtml(g.desc)}</p>
          <div class="signal-tags" id="signal-tags-${g.key}">
            ${tags || '<span style="color:#94a3b8;font-size:12px;">No phrases yet — add some below</span>'}
          </div>
          <div class="signal-add-row">
            <input type="text" class="signal-add-input" id="signal-input-${g.key}"
              placeholder='Type a word or phrase, then click Add'
              onkeypress="if(event.key==='Enter') _addSignalTag('${g.key}')">
            <button class="signal-add-btn" onclick="_addSignalTag('${g.key}')">+ Add</button>
          </div>
          <button class="signal-save-btn" id="signal-save-${g.key}"
            onclick="_saveSignalGroup('${g.key}')"
            ${state.signalsChanged[g.key] ? '' : 'disabled'}>
            💾 Save Changes
          </button>
        </div>
      </div>
    `;
  }

  function _addSignalTag(groupKey) {
    const input = document.getElementById(`signal-input-${groupKey}`);
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) return;
    // Comma-separated bulk: "yes, yep, sure thing, absolutely"
    const parts = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    let added = 0;
    for (const val of parts) {
      if (val && !state.signals[groupKey].includes(val)) {
        state.signals[groupKey].push(val);
        added++;
      }
    }
    if (added) {
      state.signalsChanged[groupKey] = true;
      _refreshSignalGroup(groupKey);
      _updateSignalsStat();
      _autoSave('signal', groupKey);
    }
    input.value = '';
  }

  function _removeSignalTag(groupKey, index) {
    state.signals[groupKey].splice(index, 1);
    state.signalsChanged[groupKey] = true;
    _refreshSignalGroup(groupKey);
    _updateSignalsStat();
    _autoSave('signal', groupKey);
  }

  function _refreshSignalGroup(groupKey) {
    const g = SIGNAL_GROUPS.find(x => x.key === groupKey);
    if (!g) return;
    const el = document.getElementById(`signal-group-${groupKey}`);
    if (!el) return;
    el.outerHTML = _renderSignalGroup(g);
  }

  async function _saveSignalGroup(groupKey) {
    const btn = document.getElementById(`signal-save-${groupKey}`);
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    try {
      await AgentConsoleAuth.apiFetch(
        `/api/admin/globalshare/signals/${groupKey}`,
        { method: 'PATCH', body: { phrases: state.signals[groupKey] } }
      );
      state.signalsChanged[groupKey] = false;
      _refreshSignalGroup(groupKey);
      console.log(`[GlobalShare] Signals saved: ${groupKey}`);
    } catch (err) {
      console.error('[GlobalShare] Failed to save signals:', err);
      alert('Failed to save: ' + err.message);
      if (btn) { btn.disabled = false; btn.textContent = '💾 Save Changes'; }
    }
  }

  function _updateSignalsStat() {
    if (!DOM.statSignals) return;
    const total = Object.values(state.signals).reduce((sum, arr) => sum + arr.length, 0);
    DOM.statSignals.textContent = total.toLocaleString();
  }

  // Exposed globally for onclick handlers
  window._addSignalTag    = _addSignalTag;
  window._removeSignalTag = _removeSignalTag;
  window._saveSignalGroup = _saveSignalGroup;

  async function testSignalPhrase() {
    const input = DOM.signalsTestInput;
    const results = DOM.signalsTestResults;
    if (!input || !results) return;
    const phrase = input.value.trim();
    if (!phrase) { results.innerHTML = '<p style="color:#94a3b8;font-size:13px;">Enter a phrase above to test</p>'; return; }

    results.innerHTML = '<p style="color:#94a3b8;font-size:13px;">Testing...</p>';
    try {
      const data = await AgentConsoleAuth.apiFetch(
        '/api/admin/globalshare/signals/test',
        { method: 'POST', body: { phrase } }
      );
      const groupLabels = {
        affirmatives:   '✅ YES (Affirmatives)',
        negatives:      '❌ NO (Negatives)',
        bookingPhrases: '📅 Booking Intent',
        exitPhrases:    '👋 Exit Intent',
        transferPhrases:'📞 Transfer Intent'
      };
      const rows = Object.entries(data.matches).map(([group, hit]) => {
        const matched = data.matchedPhrases?.[group]?.join(', ') || '';
        return `
          <div class="signals-test-result-row ${hit ? 'hit' : 'miss'}">
            <div class="signals-test-dot ${hit ? 'hit' : 'miss'}"></div>
            <span style="flex:1">${groupLabels[group] || group}</span>
            ${hit && matched ? `<span style="font-size:11px;color:#15803d;font-style:italic;">matched: "${escapeHtml(matched)}"</span>` : ''}
            ${hit && !matched ? `<span style="font-size:11px;color:#15803d;">✓ match</span>` : ''}
            ${!hit ? `<span style="font-size:11px;color:#94a3b8;">no match</span>` : ''}
          </div>
        `;
      }).join('');
      const anyHit = Object.values(data.matches).some(Boolean);
      results.innerHTML = `
        <p style="font-size:11px;color:#64748b;margin:0 0 8px 0;">Testing: <em>"${escapeHtml(data.normalized)}"</em></p>
        ${rows}
        ${!anyHit ? '<p style="font-size:12px;color:#94a3b8;margin-top:8px;">No signal groups matched this phrase.</p>' : ''}
      `;
    } catch (err) {
      results.innerHTML = `<p style="color:#dc2626;font-size:13px;">Test failed: ${escapeHtml(err.message)}</p>`;
    }
  }

  // Expose for HTML onclick
  window.testSignalPhrase = testSignalPhrase;

  // ══════════════════════════════════════════════════════════════════════════
  // LAP KEYWORD GROUPS
  // ══════════════════════════════════════════════════════════════════════════

  // In-memory: { groupId → keywords[] }
  const _lapState = {};

  const LAP_ACTION_LABELS = {
    respond:     'RESPOND',
    hold:        'HOLD',
    repeat_last: 'REPEAT',
  };

  async function loadLapGroups() {
    const grid = document.getElementById('lap-groups-grid');
    if (!grid) return;
    try {
      const data = await AgentConsoleAuth.apiFetch('/api/admin/globalshare/lap-groups');
      const groups = data?.groups || [];
      groups.forEach(g => { _lapState[g.id] = [...(g.systemKeywords || [])]; });
      _renderLapGrid(groups);
    } catch (err) {
      console.error('[GlobalShare] Failed to load LAP groups:', err);
      if (grid) grid.innerHTML = '<p style="color:#dc2626;font-size:13px;">Failed to load LAP groups.</p>';
    }
  }

  function _renderLapGrid(groups) {
    const grid = document.getElementById('lap-groups-grid');
    if (!grid) return;
    if (!groups.length) {
      grid.innerHTML = '<p style="color:#94a3b8;font-size:13px;">No LAP groups found. Run the seed script to initialise the 3 default groups.</p>';
      return;
    }
    grid.innerHTML = groups.map(g => _renderLapGroup(g)).join('');
  }

  function _renderLapGroup(g) {
    const keywords = _lapState[g.id] || [];
    const actionClass = g.action || 'respond';
    const actionLabel = LAP_ACTION_LABELS[g.action] || g.action.toUpperCase();

    const tags = keywords.map((kw, i) => `
      <span class="lap-tag">
        ${escapeHtml(kw)}
        <span class="lap-tag-remove" onclick="_removeLapKeyword('${g.id}', ${i})" title="Remove">×</span>
      </span>
    `).join('');

    return `
      <div class="lap-group" id="lap-group-${g.id}">
        <div class="lap-group-header">
          <span class="lap-group-title">${escapeHtml(g.name)}</span>
          <span class="lap-action-badge ${actionClass}">${actionLabel}</span>
          <span class="lap-group-count" id="lap-count-${g.id}">${keywords.length} keywords</span>
        </div>
        <div class="lap-group-body">
          <div class="lap-keywords-label">System Keywords (global — all companies inherit)</div>
          <div class="lap-tags" id="lap-tags-${g.id}">
            ${tags || '<span style="color:#94a3b8;font-size:12px;">No keywords yet</span>'}
          </div>
          <div class="lap-add-row">
            <input type="text" class="lap-add-input" id="lap-input-${g.id}"
              placeholder='Add a keyword or phrase…'
              onkeypress="if(event.key==='Enter') _addLapKeyword('${g.id}')">
            <button class="lap-add-btn" onclick="_addLapKeyword('${g.id}')">+ Add</button>
          </div>
          <button class="lap-save-btn" id="lap-save-${g.id}"
            onclick="_saveLapGroup('${g.id}')">
            💾 Save Keywords
          </button>
          <p class="lap-inherited-note">Companies extend these with their own words in UAP → LAP tab. System keywords here apply to everyone.</p>
        </div>
      </div>
    `;
  }

  function _addLapKeyword(groupId) {
    const input = document.getElementById(`lap-input-${groupId}`);
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) return;
    if (!_lapState[groupId]) _lapState[groupId] = [];
    // Comma-separated bulk: "hold on, one moment, just a second"
    const parts = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    let added = 0;
    for (const val of parts) {
      if (val && !_lapState[groupId].includes(val)) { _lapState[groupId].push(val); added++; }
    }
    input.value = '';
    if (added) { _refreshLapGroup(groupId); _autoSave('lap', groupId); }
  }

  function _removeLapKeyword(groupId, index) {
    if (!_lapState[groupId]) return;
    _lapState[groupId].splice(index, 1);
    _refreshLapGroup(groupId);
    _autoSave('lap', groupId);
  }

  function _refreshLapGroup(groupId) {
    const el = document.getElementById(`lap-group-${groupId}`);
    if (!el) return;
    const keywords = _lapState[groupId] || [];
    // Re-render tags + count only (avoid full replace to keep input focus)
    const tagsEl  = document.getElementById(`lap-tags-${groupId}`);
    const countEl = document.getElementById(`lap-count-${groupId}`);
    if (tagsEl) {
      tagsEl.innerHTML = keywords.map((kw, i) => `
        <span class="lap-tag">
          ${escapeHtml(kw)}
          <span class="lap-tag-remove" onclick="_removeLapKeyword('${groupId}', ${i})" title="Remove">×</span>
        </span>
      `).join('') || '<span style="color:#94a3b8;font-size:12px;">No keywords yet</span>';
    }
    if (countEl) countEl.textContent = `${keywords.length} keywords`;
  }

  async function _saveLapGroup(groupId) {
    const btn = document.getElementById(`lap-save-${groupId}`);
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      await AgentConsoleAuth.apiFetch(
        `/api/admin/globalshare/lap-groups/${groupId}/keywords`,
        { method: 'PATCH', body: { keywords: _lapState[groupId] || [] } }
      );
      console.log(`[GlobalShare] LAP group saved: ${groupId}`);
      if (btn) { btn.disabled = false; btn.textContent = '✅ Saved'; setTimeout(() => { if (btn) btn.textContent = '💾 Save Keywords'; }, 2000); }
    } catch (err) {
      console.error('[GlobalShare] Failed to save LAP group:', err);
      alert('Save failed: ' + err.message);
      if (btn) { btn.disabled = false; btn.textContent = '💾 Save Keywords'; }
    }
  }

  // Expose for HTML onclick handlers
  window._addLapKeyword    = _addLapKeyword;
  window._removeLapKeyword = _removeLapKeyword;
  window._saveLapGroup     = _saveLapGroup;

  // ══════════════════════════════════════════════════════════════════════════
  // PHRASE INTELLIGENCE
  // ══════════════════════════════════════════════════════════════════════════

  // In-memory state for the PI card
  const piState = {
    intentNormalizers: [],
    synonymGroups:     [],
    stopWords:         [],
    dangerWords:       [],
    cuePhrases:        [],
  };

  async function loadPhraseIntelligence() {
    try {
      console.log('[GlobalShare] Loading phrase intelligence config…');
      const data = await AgentConsoleAuth.apiFetch('/api/admin/globalshare/phrase-intelligence');
      piState.intentNormalizers = data.intentNormalizers || [];
      piState.synonymGroups    = data.synonymGroups    || [];
      piState.stopWords        = data.stopWords        || [];
      piState.dangerWords      = data.dangerWords      || [];
      piState.cuePhrases       = data.cuePhrases       || [];

      _renderPiNormalizers();
      _renderPiSynonyms();
      _renderPiStopWords();
      _renderPiDangerWords();
      _renderPiCuePhrases();
      _updatePiStat();
      _updatePiTabCounts();
      _bindPiTabs();
    } catch (err) {
      console.error('[GlobalShare] Failed to load phrase intelligence:', err);
    }
  }

  function _bindPiTabs() {
    const tabs = document.querySelectorAll('#pi-tabs .pi-tab');
    tabs.forEach(tab => {
      tab.onclick = () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.pi-panel').forEach(p => p.classList.remove('visible'));
        const panel = document.getElementById(`pi-panel-${tab.dataset.piTab}`);
        if (panel) panel.classList.add('visible');
      };
    });
  }

  function _updatePiStat() {
    const el = document.getElementById('stat-pi');
    if (el) el.textContent = String(piState.intentNormalizers.length + piState.synonymGroups.length);
  }

  /** Update count badges on each Phrase Intelligence tab button. */
  function _updatePiTabCounts() {
    const counts = {
      normalizers: piState.intentNormalizers.length,
      synonyms:    piState.synonymGroups.length,
      stopwords:   piState.stopWords.length,
      dangerwords: piState.dangerWords.length,
      cuephrases:  piState.cuePhrases.length,
    };
    document.querySelectorAll('#pi-tabs .pi-tab').forEach(tab => {
      const key = tab.dataset.piTab;
      const n   = counts[key];
      if (n == null) return;
      let badge = tab.querySelector('.pi-tab-count');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'pi-tab-count';
        tab.appendChild(badge);
      }
      badge.textContent = String(n);
    });
  }

  // ── Intent Normalizers ─────────────────────────────────────────────────

  function _renderPiNormalizers() {
    const body = document.getElementById('pi-normalizers-body');
    if (!body) return;
    body.innerHTML = piState.intentNormalizers.map((n, i) => `
      <tr>
        <td>${escapeHtml(n.pattern)}</td>
        <td>${n.token ? '<code>' + escapeHtml(n.token) + '</code>' : '<span style="color:#94a3b8;font-style:italic;">(strip)</span>'}</td>
        <td style="text-align:center"><span class="pi-row-remove" onclick="piRemoveNormalizer(${i})">×</span></td>
      </tr>
    `).join('');
  }

  function piAddNormalizer() {
    const patEl = document.getElementById('pi-norm-pattern');
    const tokEl = document.getElementById('pi-norm-token');
    const pattern = (patEl?.value || '').trim().toLowerCase();
    if (!pattern) return;
    const token = (tokEl?.value || '').trim().toLowerCase();
    piState.intentNormalizers.push({ pattern, token });
    _renderPiNormalizers(); _updatePiTabCounts();
    _autoSave('pi', 'intentNormalizers');
    if (patEl) patEl.value = '';
    if (tokEl) tokEl.value = '';
    patEl?.focus();
  }

  function piRemoveNormalizer(idx) {
    piState.intentNormalizers.splice(idx, 1);
    _renderPiNormalizers(); _updatePiTabCounts();
    _autoSave('pi', 'intentNormalizers');
  }

  // ── Synonym Groups ────────────────────────────────────────────────────

  function _renderPiSynonyms() {
    const body = document.getElementById('pi-synonyms-body');
    if (!body) return;
    body.innerHTML = piState.synonymGroups.map((g, i) => `
      <tr>
        <td><code>${escapeHtml(g.token)}</code></td>
        <td>${(g.synonyms || []).map(s => escapeHtml(s)).join(', ')}</td>
        <td style="text-align:center"><span class="pi-row-remove" onclick="piRemoveSynonym(${i})">×</span></td>
      </tr>
    `).join('');
  }

  function piAddSynonym() {
    const tokEl = document.getElementById('pi-syn-token');
    const synEl = document.getElementById('pi-syn-synonyms');
    const token = (tokEl?.value || '').trim().toLowerCase();
    const synonyms = (synEl?.value || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!token || !synonyms.length) return;
    piState.synonymGroups.push({ token, synonyms });
    _renderPiSynonyms(); _updatePiTabCounts();
    _autoSave('pi', 'synonymGroups');
    if (tokEl) tokEl.value = '';
    if (synEl) synEl.value = '';
    tokEl?.focus();
  }

  function piRemoveSynonym(idx) {
    piState.synonymGroups.splice(idx, 1);
    _renderPiSynonyms(); _updatePiTabCounts();
    _autoSave('pi', 'synonymGroups');
  }

  // ── Stop Words ────────────────────────────────────────────────────────

  function _renderPiStopWords() {
    const wrap = document.getElementById('pi-stopwords-tags');
    if (!wrap) return;
    wrap.innerHTML = piState.stopWords.map((w, i) =>
      `<span class="pi-tag">${escapeHtml(w)}<span class="pi-tag-remove" onclick="piRemoveStopWord(${i})">×</span></span>`
    ).join('');
  }

  function piAddStopWord() {
    const el = document.getElementById('pi-stop-input');
    const raw = (el?.value || '').trim();
    if (!raw) return;
    // Comma-separated bulk: "word1, word2, word3"
    const parts = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    let added = 0;
    for (const w of parts) {
      if (w && !piState.stopWords.includes(w)) { piState.stopWords.push(w); added++; }
    }
    if (added) { _renderPiStopWords(); _updatePiTabCounts(); _autoSave('pi', 'stopWords'); }
    if (el) el.value = '';
    el?.focus();
  }

  function piRemoveStopWord(idx) {
    piState.stopWords.splice(idx, 1);
    _renderPiStopWords(); _updatePiTabCounts();
    _autoSave('pi', 'stopWords');
  }

  // ── Danger Words ──────────────────────────────────────────────────────

  function _renderPiDangerWords() {
    const wrap = document.getElementById('pi-dangerwords-tags');
    if (!wrap) return;
    wrap.innerHTML = piState.dangerWords.map((w, i) =>
      `<span class="pi-tag" style="background:#fef2f2;border-color:#fecaca;color:#991b1b;">${escapeHtml(w)}<span class="pi-tag-remove" onclick="piRemoveDangerWord(${i})">×</span></span>`
    ).join('');
  }

  function piAddDangerWord() {
    const el = document.getElementById('pi-danger-input');
    const raw = (el?.value || '').trim();
    if (!raw) return;
    // Comma-separated bulk: "word1, word2, word3"
    const parts = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    let added = 0;
    for (const w of parts) {
      if (w && !piState.dangerWords.includes(w)) { piState.dangerWords.push(w); added++; }
    }
    if (added) { _renderPiDangerWords(); _updatePiTabCounts(); _autoSave('pi', 'dangerWords'); }
    if (el) el.value = '';
    el?.focus();
  }

  function piRemoveDangerWord(idx) {
    piState.dangerWords.splice(idx, 1);
    _renderPiDangerWords(); _updatePiTabCounts();
    _autoSave('pi', 'dangerWords');
  }

  // ── Cue Phrases ─────────────────────────────────────────────────────

  function _renderPiCuePhrases() {
    const tbody = document.getElementById('pi-cuephrases-body');
    if (!tbody) return;
    tbody.innerHTML = piState.cuePhrases.map((c, i) =>
      `<tr>
        <td>${escapeHtml(c.pattern)}</td>
        <td><span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;${_cueTypeStyle(c.token)}">${escapeHtml(c.token)}</span></td>
        <td><span class="pi-tag-remove" onclick="piRemoveCuePhrase(${i})">×</span></td>
      </tr>`
    ).join('');
    _refreshCueTypeDropdown();
  }

  /** Rebuild the cue type <select> from distinct tokens already in piState. */
  function _refreshCueTypeDropdown() {
    const sel = document.getElementById('pi-cue-token');
    if (!sel) return;
    const prev = sel.value; // preserve selection
    const types = [...new Set(piState.cuePhrases.map(c => c.token).filter(Boolean))];
    sel.innerHTML = '<option value="" disabled>Select cue type…</option>'
      + types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')
      + '<option value="__new__">＋ Add new type…</option>';
    // Restore previous selection if still valid
    if (prev && types.includes(prev)) sel.value = prev;
  }

  /** Color-code cue type badges (case-insensitive). */
  function _cueTypeStyle(token) {
    switch ((token || '').toLowerCase()) {
      case 'requestcue':    return 'background:#dbeafe;color:#1e40af;';
      case 'permissioncue': return 'background:#fef9c3;color:#854d0e;';
      case 'infocue':       return 'background:#d1fae5;color:#065f46;';
      case 'directivecue':  return 'background:#fee2e2;color:#991b1b;';
      default:              return 'background:#f1f5f9;color:#475569;';
    }
  }

  function piAddCuePhrase() {
    const pEl = document.getElementById('pi-cue-patterns');
    const sel = document.getElementById('pi-cue-token');
    const rawPatterns = (pEl?.value || '').trim();
    let token = (sel?.value || '').trim();

    // "Add new type" — prompt for custom name
    if (token === '__new__') {
      token = (prompt('Enter new cue type name (e.g. urgencyCue):') || '').trim();
      if (!token) return;
    }

    if (!rawPatterns || !token) return;
    // Comma-separated patterns all share the same cue type
    const patterns = rawPatterns.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 1);
    let added = 0;
    for (const p of patterns) {
      if (!piState.cuePhrases.some(c => c.pattern === p)) {
        piState.cuePhrases.push({ pattern: p, token });
        added++;
      }
    }
    if (added) { _renderPiCuePhrases(); _updatePiTabCounts(); _autoSave('pi', 'cuePhrases'); }
    if (pEl) pEl.value = '';
    // Keep the dropdown on the same type for quick bulk entry
    if (sel && token !== '__new__') sel.value = token;
    pEl?.focus();
  }

  function piRemoveCuePhrase(idx) {
    piState.cuePhrases.splice(idx, 1);
    _renderPiCuePhrases(); _updatePiTabCounts();
    _autoSave('pi', 'cuePhrases');
  }

  // ── Save Section ──────────────────────────────────────────────────────

  async function piSaveSection(section) {
    const dataMap = {
      intentNormalizers: piState.intentNormalizers,
      synonymGroups:     piState.synonymGroups,
      stopWords:         piState.stopWords,
      dangerWords:       piState.dangerWords,
      cuePhrases:        piState.cuePhrases,
    };
    // Find the save button that triggered this call for visual feedback
    const panel = document.querySelector(`.pi-panel:not([style*="display: none"]):not([style*="display:none"])`);
    const btn   = panel?.querySelector('.pi-save-btn');
    const originalText = btn?.textContent || '';
    try {
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      await AgentConsoleAuth.apiFetch(`/api/admin/globalshare/phrase-intelligence/${section}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: dataMap[section] }),
      });
      _updatePiStat();
      if (btn) { btn.textContent = '✓ Saved'; setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1500); }
    } catch (err) {
      console.error('[GlobalShare] Failed to save PI section:', err);
      if (btn) { btn.textContent = '✗ Failed'; btn.style.color = '#ef4444'; setTimeout(() => { btn.textContent = originalText; btn.style.color = ''; btn.disabled = false; }, 2000); }
    }
  }

  // ── Test Phrase ───────────────────────────────────────────────────────

  async function piTestPhrase() {
    const phrase = document.getElementById('pi-test-phrase')?.value?.trim();
    if (!phrase) return;
    const sectionContent = document.getElementById('pi-test-content')?.value?.trim() || '';

    try {
      const result = await AgentConsoleAuth.apiFetch('/api/admin/globalshare/phrase-intelligence/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrase, sectionContent }),
      });

      const resWrap = document.getElementById('pi-test-results');
      if (resWrap) resWrap.style.display = 'block';

      const rawEl       = document.getElementById('pi-res-raw');
      const coreEl      = document.getElementById('pi-res-core');
      const protEl      = document.getElementById('pi-res-protected');
      const patternsEl  = document.getElementById('pi-res-patterns');

      if (rawEl)  rawEl.textContent  = result.raw || '';
      if (coreEl) coreEl.textContent = result.core || '(empty)';
      if (protEl) protEl.textContent = (result.protectedEntities || []).length
        ? result.protectedEntities.join(', ')
        : '(none)';
      if (patternsEl) patternsEl.innerHTML = (result.normalizedPatterns || []).length
        ? result.normalizedPatterns.map(p =>
            `<span style="margin-right:8px;">"${escapeHtml(p.pattern)}" &rarr; <strong>${escapeHtml(p.token)}</strong></span>`
          ).join('')
        : '(none)';
    } catch (err) {
      console.error('[GlobalShare] Phrase test error:', err);
      alert('Test failed: ' + err.message);
    }
  }

  // Expose PI functions for inline onclick handlers
  window.piAddNormalizer     = piAddNormalizer;
  window.piRemoveNormalizer  = piRemoveNormalizer;
  window.piAddSynonym        = piAddSynonym;
  window.piRemoveSynonym     = piRemoveSynonym;
  window.piAddStopWord       = piAddStopWord;
  window.piRemoveStopWord    = piRemoveStopWord;
  window.piAddDangerWord     = piAddDangerWord;
  window.piRemoveDangerWord  = piRemoveDangerWord;
  window.piAddCuePhrase      = piAddCuePhrase;
  window.piRemoveCuePhrase   = piRemoveCuePhrase;
  window.piSaveSection       = piSaveSection;
  window.piTestPhrase        = piTestPhrase;

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
