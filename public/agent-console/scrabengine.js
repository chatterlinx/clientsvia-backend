/**
 * ════════════════════════════════════════════════════════════════════════════════
 * SCRABENGINE — TEXT PROCESSING PIPELINE CONTROLLER
 * ClientVia Platform · Agent Console · Enterprise Grade
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * ARCHITECTURE:
 *   IIFE + strict mode for scope isolation. Zero global leakage.
 *   Config-driven modals eliminate if/else branching.
 *   Generic list renderer eliminates rendering duplication.
 *
 * PIPELINE STAGES (sequential, each feeds the next):
 *   Stage 1 — Filler Removal      : Strip "um", "uh", greetings, company name
 *   Stage 2 — Vocabulary Normalization : Fix STT mishears ("acee" → "ac")
 *   Stage 3 — Smart Synonyms      : Expand tokens for flexible trigger matching
 *   Stage 4 — Entity Extraction    : Extract names, phone, email → handoff
 *   Stage 5 — Quality Gate         : Confidence check before delivery
 *
 * WIRING POINTS (search "WIRING:" to find all connection sites):
 *   A — Navigation & page-level actions (back, save, test, logs)
 *   B — Pipeline stage toggles (enable/disable each stage)
 *   C — Stage-specific options (strip greetings, strip company name)
 *   D — Create/Edit actions (add buttons → openModal)
 *   E — Modal lifecycle (cancel, save, backdrop-close, escape)
 *   F — Entry-level actions (toggle enabled, edit, delete per item)
 *
 * DATA FLOW:
 *   loadConfig() → API GET → normalizeConfig() → state.config → render()
 *   User edits → markDirty() → Save button turns red
 *   saveConfig() → API POST → state.config persisted to MongoDB
 *
 * BACKEND API:
 *   GET  /api/agent-console/:companyId/scrabengine       — Load config
 *   POST /api/agent-console/:companyId/scrabengine       — Save config
 *   POST /api/agent-console/:companyId/scrabengine/test  — Test pipeline
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

(function() {
  'use strict';

  const DEBUG = true;
  function log(...args) { console.log('[ScrabEngine]', ...args); }

  // ════════════════════════════════════════════════════════════════════════════
  // STATE
  // ════════════════════════════════════════════════════════════════════════════

  const state = {
    companyId: null,
    config: {
      enabled: true,
      fillers: { enabled: true, stripGreetings: true, stripCompanyName: true, customFillers: [] },
      vocabulary: { enabled: true, entries: [] },
      synonyms: { enabled: true, wordSynonyms: [], contextPatterns: [] },
      extraction: { enabled: true, customPatterns: [] }
    },
    editingIndex: -1,
    editingType: null,
    hasChanges: false
  };

  // ════════════════════════════════════════════════════════════════════════════
  // MODAL REGISTRY — Config-driven modal wiring (eliminates if/else chains)
  // ════════════════════════════════════════════════════════════════════════════

  const MODAL_REGISTRY = {
    filler:         { key: 'modalFiller',         cancel: 'btn-cancel-filler',     save: 'btn-save-filler' },
    vocabulary:     { key: 'modalVocabulary',      cancel: 'btn-cancel-vocab',      save: 'btn-save-vocab' },
    wordSynonym:    { key: 'modalWordSynonym',     cancel: 'btn-cancel-word-syn',   save: 'btn-save-word-syn' },
    contextPattern: { key: 'modalContextPattern',  cancel: 'btn-cancel-pattern',    save: 'btn-save-pattern' },
    extraction:     { key: 'modalExtraction',      cancel: 'btn-cancel-extraction', save: 'btn-save-extraction' }
  };

  const STAGE_STATUS_IDS = ['stage1Status', 'stage2Status', 'stage3Status', 'stage4Status'];

  // ════════════════════════════════════════════════════════════════════════════
  // MODAL FIELD DEFINITIONS — Drives clearModal / populateModal / readModal
  // Each field: { id, prop, type, default }
  // ════════════════════════════════════════════════════════════════════════════

  const MODAL_FIELDS = {
    filler: [
      { id: 'filler-phrase',    prop: 'phrase',   type: 'text',   defaultVal: '' },
      { id: 'filler-priority',  prop: 'priority', type: 'number', defaultVal: '100' }
    ],
    vocabulary: [
      { id: 'vocab-from',     prop: 'from',      type: 'text',   defaultVal: '' },
      { id: 'vocab-to',       prop: 'to',        type: 'text',   defaultVal: '' },
      { id: 'vocab-mode',     prop: 'matchMode', type: 'select', defaultVal: 'EXACT' },
      { id: 'vocab-priority', prop: 'priority',  type: 'number', defaultVal: '100' }
    ],
    wordSynonym: [
      { id: 'word-syn-word',     prop: 'word',     type: 'text',   defaultVal: '' },
      { id: 'word-syn-synonyms', prop: 'synonyms', type: 'csv',    defaultVal: '' },
      { id: 'word-syn-priority', prop: 'priority', type: 'number', defaultVal: '50' }
    ],
    contextPattern: [
      { id: 'pattern-words',      prop: 'pattern',       type: 'csv',    defaultVal: '' },
      { id: 'pattern-component',  prop: 'component',     type: 'text',   defaultVal: '' },
      { id: 'pattern-tokens',     prop: 'contextTokens', type: 'csv',    defaultVal: '' },
      { id: 'pattern-confidence', prop: 'confidence',    type: 'float',  defaultVal: '0.9' },
      { id: 'pattern-priority',   prop: 'priority',      type: 'number', defaultVal: '100' }
    ],
    extraction: [
      { id: 'extraction-entity-name',  prop: 'entityName',         type: 'text',     defaultVal: '' },
      { id: 'extraction-label',        prop: 'label',              type: 'text',     defaultVal: '' },
      { id: 'extraction-pattern',      prop: 'pattern',            type: 'text',     defaultVal: '' },
      { id: 'extraction-examples',     prop: 'examples',           type: 'lines',    defaultVal: '' },
      { id: 'extraction-confidence',   prop: 'confidence',         type: 'float',    defaultVal: '0.85' },
      { id: 'extraction-handoff',      prop: 'autoHandoff',        type: 'checkbox', defaultVal: true },
      { id: 'extraction-globalshare',  prop: 'validateGlobalShare', type: 'checkbox', defaultVal: false }
    ]
  };

  // Maps modal type → { arrayPath, buildItem(fields), validate(fields) }
  const MODAL_SAVE_CONFIG = {
    filler: {
      getArray: () => state.config.fillers.customFillers,
      validate(f) {
        if (!f.phrase) return 'Please enter a filler phrase';
        if (this.getArray().some((x, i) => i !== state.editingIndex && norm(x.phrase) === norm(f.phrase)))
          return 'This filler phrase already exists';
        return null;
      },
      buildItem: (f) => ({ id: makeId(), phrase: f.phrase, enabled: true, priority: clampPriority(f.priority, 100) })
    },
    vocabulary: {
      getArray: () => state.config.vocabulary.entries,
      validate(f) {
        if (!f.from || !f.to) return 'Please fill in both From and To fields';
        if (this.getArray().some((x, i) => i !== state.editingIndex && norm(x.from) === norm(f.from) && norm(x.to) === norm(f.to)))
          return 'This vocabulary normalization already exists';
        return null;
      },
      buildItem: (f) => ({ id: makeId(), from: f.from, to: f.to, matchMode: f.matchMode || 'EXACT', enabled: true, priority: clampPriority(f.priority, 100) })
    },
    wordSynonym: {
      getArray: () => state.config.synonyms.wordSynonyms,
      validate(f) {
        if (!f.word || !f.synonyms || f.synonyms.length === 0) return 'Please fill in both Word and Synonyms fields';
        return null;
      },
      buildItem: (f) => ({ id: makeId(), word: f.word, synonyms: f.synonyms, enabled: true, priority: clampPriority(f.priority, 50) })
    },
    contextPattern: {
      getArray: () => state.config.synonyms.contextPatterns,
      validate(f) {
        if (!f.pattern || f.pattern.length === 0 || !f.component) return 'Please fill in Pattern Words and Component fields';
        return null;
      },
      buildItem: (f) => ({ id: makeId(), pattern: f.pattern, component: f.component, contextTokens: f.contextTokens || [], confidence: clampConfidence(f.confidence, 0.9), enabled: true, priority: clampPriority(f.priority, 100) })
    },
    extraction: {
      getArray() {
        if (!state.config.extraction) state.config.extraction = { enabled: true, customPatterns: [] };
        if (!state.config.extraction.customPatterns) state.config.extraction.customPatterns = [];
        return state.config.extraction.customPatterns;
      },
      validate(f) {
        if (!f.entityName || !f.label || !f.pattern) return 'Please fill in Entity Name, Label, and Pattern fields';
        if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(f.entityName)) return 'Entity Name must be camelCase with no spaces (e.g., companyName)';
        if (this.getArray().some((x, i) => i !== state.editingIndex && norm(x.entityName) === norm(f.entityName)))
          return 'An extraction with this Entity Name already exists';
        try { new RegExp(f.pattern, 'i'); } catch (err) { return `Invalid regex pattern: ${err.message}`; }
        return null;
      },
      buildItem: (f) => ({
        id: makeId(), entityName: f.entityName, label: f.label, pattern: f.pattern,
        examples: f.examples || [], confidence: clampConfidence(f.confidence, 0.85),
        autoHandoff: f.autoHandoff, validateGlobalShare: f.validateGlobalShare, enabled: true
      })
    }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // DOM CACHE
  // ════════════════════════════════════════════════════════════════════════════

  let DOM = {};

  function initDOM() {
    log('initDOM()');
    DOM = {
      headerCompanyName: document.getElementById('header-company-name'),
      headerCompanyId:   document.getElementById('header-company-id'),
      btnBack:           document.getElementById('btn-back'),
      btnSaveAll:        document.getElementById('btn-save-all'),
      btnTestPanel:      document.getElementById('btn-test-panel'),
      btnViewLogs:       document.getElementById('btn-view-logs'),

      toggleFillers:    document.getElementById('toggle-fillers'),
      toggleVocabulary: document.getElementById('toggle-vocabulary'),
      toggleSynonyms:   document.getElementById('toggle-synonyms'),
      toggleExtraction: document.getElementById('toggle-extraction'),

      stripGreetings:   document.getElementById('strip-greetings'),
      stripCompanyName: document.getElementById('strip-company-name'),

      customFillersList:     document.getElementById('custom-fillers-list'),
      vocabularyList:        document.getElementById('vocabulary-list'),
      wordSynonymsList:      document.getElementById('word-synonyms-list'),
      contextPatternsList:   document.getElementById('context-patterns-list'),
      extractionPatternsList: document.getElementById('extraction-patterns-list'),

      btnAddFiller:         document.getElementById('btn-add-filler'),
      btnAddVocab:          document.getElementById('btn-add-vocab'),
      btnAddWordSynonym:    document.getElementById('btn-add-word-synonym'),
      btnAddContextPattern: document.getElementById('btn-add-context-pattern'),
      btnAddExtraction:     document.getElementById('btn-add-extraction'),

      btnBulkVocab:        document.getElementById('btn-bulk-vocab'),
      modalBulkVocab:      document.getElementById('modal-bulk-vocab'),
      bulkVocabInput:      document.getElementById('bulk-vocab-input'),
      bulkVocabMode:       document.getElementById('bulk-vocab-mode'),
      bulkVocabPreview:    document.getElementById('bulk-vocab-preview'),
      bulkVocabPreviewText: document.getElementById('bulk-vocab-preview-text'),
      btnCancelBulkVocab:  document.getElementById('btn-cancel-bulk-vocab'),
      btnParseBulkVocab:   document.getElementById('btn-parse-bulk-vocab'),

      modalFiller:         document.getElementById('modal-filler'),
      modalVocabulary:     document.getElementById('modal-vocabulary'),
      modalWordSynonym:    document.getElementById('modal-word-synonym'),
      modalContextPattern: document.getElementById('modal-context-pattern'),
      modalExtraction:     document.getElementById('modal-extraction'),

      testPanel:   document.getElementById('test-panel'),
      testInput:   document.getElementById('test-input'),
      btnRunTest:  document.getElementById('btn-run-test'),
      testResults: document.getElementById('test-results'),

      totalRules: document.getElementById('total-rules'),

      stage1Status: document.getElementById('stage1-status'),
      stage2Status: document.getElementById('stage2-status'),
      stage3Status: document.getElementById('stage3-status'),
      stage4Status: document.getElementById('stage4-status'),
      pipelineSteps: Array.from(document.querySelectorAll('.pipeline-step'))
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ════════════════════════════════════════════════════════════════════════════

  function init() {
    log('CHECKPOINT 1: init() START');
    try {
      initDOM();
      log('CHECKPOINT 2: initDOM() done');

      // Verify critical DOM elements exist
      const domReport = {};
      for (const [key, val] of Object.entries(DOM)) {
        domReport[key] = val ? 'OK' : 'MISSING';
      }
      log('CHECKPOINT 3: DOM audit', domReport);

      const params = new URLSearchParams(window.location.search);
      state.companyId = params.get('companyId');
      log('CHECKPOINT 4: companyId =', state.companyId);

      if (!state.companyId) {
        log('CHECKPOINT 4b: No companyId, redirecting');
        window.location.href = '/agent-console/index.html';
        return;
      }

      if (DOM.headerCompanyId) {
        DOM.headerCompanyId.textContent = truncateId(state.companyId);
        DOM.headerCompanyId.title = state.companyId;
      }

      log('CHECKPOINT 5: About to call bindEvents()');
      bindEvents();
      log('CHECKPOINT 6: bindEvents() done');

      loadConfig();
      log('CHECKPOINT 7: loadConfig() called');

      loadCompanyName();
      log('CHECKPOINT 8: init() COMPLETE — all wiring done');
    } catch (err) {
      console.error('[ScrabEngine] FATAL: Initialization error:', err);
      console.error('[ScrabEngine] Stack:', err.stack);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // EVENT BINDING
  // ════════════════════════════════════════════════════════════════════════════

  function bindEvents() {
    log('BIND-A: Navigation & page-level actions');
    safeListen(DOM.btnBack, 'click', () => {
      log('CLICK: btnBack');
      if (state.hasChanges && !confirm('You have unsaved changes. Leave anyway?')) return;
      window.location.href = `/agent-console/index.html?companyId=${state.companyId}`;
    });
    safeListen(DOM.btnSaveAll, 'click', () => { log('CLICK: btnSaveAll'); saveConfig(); });
    safeListen(DOM.btnTestPanel, 'click', () => {
      log('CLICK: btnTestPanel');
      DOM.testPanel.style.display = DOM.testPanel.style.display === 'none' ? 'block' : 'none';
    });
    safeListen(DOM.btnViewLogs, 'click', () => {
      log('CLICK: btnViewLogs');
      window.location.href = `/agent-console/callconsole.html?companyId=${state.companyId}`;
    });
    safeListen(DOM.btnRunTest, 'click', () => { log('CLICK: btnRunTest'); runTest(); });

    log('BIND-B: Pipeline stage toggles');
    bindToggle(DOM.toggleFillers,    (v) => { state.config.fillers.enabled = v; });
    bindToggle(DOM.toggleVocabulary, (v) => { state.config.vocabulary.enabled = v; });
    bindToggle(DOM.toggleSynonyms,   (v) => { state.config.synonyms.enabled = v; });
    bindToggle(DOM.toggleExtraction, (v) => {
      if (!state.config.extraction) state.config.extraction = {};
      state.config.extraction.enabled = v;
    });

    log('BIND-C: Stage-specific options');
    bindToggle(DOM.stripGreetings,   (v) => { state.config.fillers.stripGreetings = v; }, false);
    bindToggle(DOM.stripCompanyName, (v) => { state.config.fillers.stripCompanyName = v; }, false);

    log('BIND-D: Add buttons → openModal');
    safeListen(DOM.btnAddFiller,         'click', () => { log('CLICK: btnAddFiller'); openModal('filler'); });
    safeListen(DOM.btnAddVocab,          'click', () => { log('CLICK: btnAddVocab'); openModal('vocabulary'); });
    safeListen(DOM.btnAddWordSynonym,    'click', () => { log('CLICK: btnAddWordSynonym'); openModal('wordSynonym'); });
    safeListen(DOM.btnAddContextPattern, 'click', () => { log('CLICK: btnAddContextPattern'); openModal('contextPattern'); });
    safeListen(DOM.btnAddExtraction,     'click', () => { log('CLICK: btnAddExtraction'); openModal('extraction'); });

    log('BIND-D2: Bulk import');
    safeListen(DOM.btnBulkVocab, 'click', () => { log('CLICK: btnBulkVocab'); openBulkVocabModal(); });
    safeListen(DOM.btnCancelBulkVocab, 'click', () => { closeBulkVocabModal(); });
    safeListen(DOM.btnParseBulkVocab, 'click', () => { log('CLICK: btnParseBulkVocab'); parseBulkVocab(); });
    if (DOM.modalBulkVocab) {
      DOM.modalBulkVocab.addEventListener('click', (e) => { if (e.target === DOM.modalBulkVocab) closeBulkVocabModal(); });
    }

    log('BIND-E: Modal lifecycle (cancel, save, backdrop, escape)');
    Object.keys(MODAL_REGISTRY).forEach((type) => {
      log(`  BIND-E: Setting up modal handlers for "${type}"`);
      setupModalHandlers(type);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const openType = Object.keys(MODAL_REGISTRY).find((type) => {
        const modal = getModal(type);
        return modal && modal.classList.contains('active');
      });
      if (openType) closeModal(openType);
    });

    log('BIND COMPLETE: All event listeners attached');
  }

  function safeListen(el, event, handler) {
    if (el) {
      el.addEventListener(event, handler);
    } else {
      console.warn('[ScrabEngine] safeListen SKIPPED: element is null for event', event);
    }
  }

  function bindToggle(el, setter, updateIndicators = true) {
    if (!el) return;
    el.addEventListener('change', (e) => {
      setter(e.target.checked);
      markDirty();
      if (updateIndicators) updateStageIndicators();
    });
  }

  function setupModalHandlers(type) {
    const config = MODAL_REGISTRY[type];
    if (!config) return;
    const modal = getModal(type);
    const cancelBtn = document.getElementById(config.cancel);
    const saveBtn = document.getElementById(config.save);
    safeListen(cancelBtn, 'click', () => closeModal(type));
    safeListen(saveBtn, 'click', () => saveModalItem(type));
    if (modal) {
      modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(type); });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // DATA LOADING
  // ════════════════════════════════════════════════════════════════════════════

  async function loadConfig() {
    try {
      log('Loading configuration...');
      const data = await AgentConsoleAuth.apiFetch(
        `/api/agent-console/${state.companyId}/scrabengine`
      );
      if (data && data.config) {
        state.config = normalizeConfig(data.config);
        render();
        log('Configuration loaded');
      }
    } catch (err) {
      console.error('[ScrabEngine] Failed to load config:', err);
      render();
    }
  }

  async function saveConfig() {
    try {
      DOM.btnSaveAll.disabled = true;
      DOM.btnSaveAll.textContent = 'Saving...';

      await AgentConsoleAuth.apiFetch(
        `/api/agent-console/${state.companyId}/scrabengine`,
        { method: 'POST', body: { config: state.config } }
      );

      state.hasChanges = false;
      updateSaveButton();
      DOM.btnSaveAll.textContent = '\u2713 Saved!';
      setTimeout(() => {
        DOM.btnSaveAll.textContent = 'Save All Changes';
        DOM.btnSaveAll.disabled = false;
      }, 2000);
    } catch (err) {
      console.error('[ScrabEngine] Save failed:', err);
      alert('Failed to save configuration: ' + err.message);
      DOM.btnSaveAll.textContent = 'Save All Changes';
      DOM.btnSaveAll.disabled = false;
    }
  }

  async function loadCompanyName() {
    try {
      if (!window.AgentConsoleAuth || typeof AgentConsoleAuth.apiFetch !== 'function') {
        DOM.headerCompanyName.textContent = 'Company';
        return;
      }
      const data = await AgentConsoleAuth.apiFetch(`/api/agent-console/${state.companyId}/truth`);
      DOM.headerCompanyName.textContent = data?.companyProfile?.businessName || data?.companyProfile?.companyName || 'Company';
    } catch (_) {
      DOM.headerCompanyName.textContent = 'Company';
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // RENDERING — Master render + generic list renderer
  // ════════════════════════════════════════════════════════════════════════════

  function render() {
    log('RENDER: Starting full render cycle');

    if (DOM.toggleFillers)    DOM.toggleFillers.checked    = state.config.fillers.enabled !== false;
    if (DOM.toggleVocabulary) DOM.toggleVocabulary.checked = state.config.vocabulary.enabled !== false;
    if (DOM.toggleSynonyms)   DOM.toggleSynonyms.checked   = state.config.synonyms.enabled !== false;
    if (DOM.toggleExtraction) DOM.toggleExtraction.checked = (state.config.extraction || {}).enabled !== false;

    if (DOM.stripGreetings)   DOM.stripGreetings.checked   = state.config.fillers.stripGreetings !== false;
    if (DOM.stripCompanyName) DOM.stripCompanyName.checked = state.config.fillers.stripCompanyName !== false;

    renderFillerList();
    renderVocabList();
    renderWordSynonymList();
    renderContextPatternList();
    renderExtractionList();

    updateStats();
    updateStageIndicators();
  }

  /**
   * Generic entry list renderer.
   * Renders items into a container with toggle, content columns, edit, and delete.
   * WIRING: F — Entry-level actions (toggle enabled, edit, delete per item)
   *
   * @param {HTMLElement} container - DOM list container
   * @param {Array} items - Data array for this list
   * @param {string} type - Modal type key (for edit/delete routing)
   * @param {Function} renderContent - (item, idx) → inner HTML for .entry-content
   * @param {string} emptyIcon - Emoji for empty state
   * @param {string} emptyText - Text for empty state
   */
  function renderEntryList(container, items, type, renderContent, emptyIcon, emptyText) {
    if (!container) return;
    if (!items || items.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${emptyIcon}</div><div class="empty-state-text">${escapeHtml(emptyText)}</div></div>`;
      return;
    }

    container.innerHTML = items.map((item, idx) => `
      <div class="entry-item ${item.enabled === false ? 'disabled' : ''}" data-type="${type}" data-idx="${idx}">
        <input type="checkbox" class="entry-checkbox" data-idx="${idx}" ${item.enabled !== false ? 'checked' : ''}>
        <div class="entry-content entry-clickable" data-idx="${idx}">${renderContent(item, idx)}</div>
        <div class="entry-actions">
          <button class="entry-btn entry-edit-btn" data-idx="${idx}">Edit</button>
          <button class="entry-btn entry-delete-btn" data-idx="${idx}">Delete</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.entry-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const idx = parseInt(cb.dataset.idx);
        items[idx].enabled = cb.checked;
        markDirty();
        render();
      });
    });

    container.querySelectorAll('.entry-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openModal(type, parseInt(btn.dataset.idx));
      });
    });

    container.querySelectorAll('.entry-clickable').forEach(el => {
      el.addEventListener('click', () => {
        openModal(type, parseInt(el.dataset.idx));
      });
    });

    container.querySelectorAll('.entry-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        if (confirm('Delete this item?')) {
          items.splice(idx, 1);
          markDirty();
          render();
        }
      });
    });
  }

  // ── Per-stage renderers (thin wrappers calling generic renderEntryList) ──

  function renderFillerList() {
    renderEntryList(
      DOM.customFillersList,
      state.config.fillers.customFillers || [],
      'filler',
      (f) => `<span class="entry-from">"${escapeHtml(f.phrase)}"</span><span class="entry-badge">P${f.priority || 100}</span>`,
      '\uD83D\uDD0D', 'No custom fillers yet. Click "+ Add Filler" to create one.'
    );
  }

  function renderVocabList() {
    renderEntryList(
      DOM.vocabularyList,
      state.config.vocabulary.entries || [],
      'vocabulary',
      (e) => `<span class="entry-from">"${escapeHtml(e.from)}"</span><span class="entry-arrow">\u2192</span><span class="entry-to">"${escapeHtml(e.to)}"</span><span class="entry-badge">${e.matchMode || 'EXACT'}</span><span class="entry-badge">P${e.priority || 100}</span>`,
      '\uD83D\uDCD6', 'No vocabulary rules yet. Click "+ Add Normalization" to create one.'
    );
  }

  function renderWordSynonymList() {
    renderEntryList(
      DOM.wordSynonymsList,
      state.config.synonyms.wordSynonyms || [],
      'wordSynonym',
      (s) => `<span class="entry-from">"${escapeHtml(s.word)}"</span><span class="entry-arrow">\u2192</span><span class="entry-to">[${s.synonyms?.length || 0} synonyms]</span><span class="entry-badge">P${s.priority || 50}</span>`,
      '\uD83D\uDCAC', 'No word synonyms yet. Click "+ Word Synonym" to create one.'
    );
  }

  function renderContextPatternList() {
    renderEntryList(
      DOM.contextPatternsList,
      state.config.synonyms.contextPatterns || [],
      'contextPattern',
      (p) => `<span class="entry-from">[${(p.pattern || []).join(', ')}]</span><span class="entry-arrow">\u2192</span><span class="entry-to">"${escapeHtml(p.component)}"</span><span class="entry-badge">${Math.round((p.confidence || 0.9) * 100)}%</span><span class="entry-badge">P${p.priority || 100}</span>`,
      '\uD83E\uDDE0', 'No context patterns yet. Click "+ Context Pattern" to create one.'
    );
  }

  function renderExtractionList() {
    renderEntryList(
      DOM.extractionPatternsList,
      (state.config.extraction || {}).customPatterns || [],
      'extraction',
      (p) => {
        const handoffBadge = p.autoHandoff !== false ? '<span class="entry-badge" style="background:#dcfce7;color:#166534;">Auto-handoff</span>' : '';
        const globalBadge = p.validateGlobalShare ? '<span class="entry-badge" style="background:#dbeafe;color:#1e40af;">GlobalShare \u2713</span>' : '';
        return `<span class="entry-from"><strong>${escapeHtml(p.label || p.entityName)}</strong></span><span class="entry-arrow">\u2192</span><span class="entry-to">${escapeHtml(p.pattern)}</span>${handoffBadge}${globalBadge}<span class="entry-badge">${Math.round((p.confidence || 0.85) * 100)}%</span>`;
      },
      '\uD83C\uDFF7\uFE0F', 'No custom patterns yet. Click "+ Add Extraction Pattern" to create one.'
    );
  }

  // ── Stats & Indicators ──

  function updateStats() {
    const total =
      (state.config.fillers.customFillers || []).filter(f => f.enabled !== false).length +
      (state.config.vocabulary.entries || []).filter(e => e.enabled !== false).length +
      (state.config.synonyms.wordSynonyms || []).filter(s => s.enabled !== false).length +
      (state.config.synonyms.contextPatterns || []).filter(p => p.enabled !== false).length +
      ((state.config.extraction || {}).customPatterns || []).filter(p => p.enabled !== false).length;
    if (DOM.totalRules) DOM.totalRules.textContent = total;
  }

  function updateSaveButton() {
    if (!DOM.btnSaveAll) return;
    DOM.btnSaveAll.textContent = state.hasChanges ? 'Save All Changes *' : 'Save All Changes';
    DOM.btnSaveAll.style.background = state.hasChanges ? '#dc2626' : '';
    DOM.btnSaveAll.style.color = state.hasChanges ? '#fff' : '';
  }

  function updateStageIndicators() {
    const stages = [
      state.config.fillers.enabled !== false,
      state.config.vocabulary.enabled !== false,
      state.config.synonyms.enabled !== false,
      (state.config.extraction || {}).enabled !== false
    ];

    STAGE_STATUS_IDS.forEach((id, idx) => {
      const el = DOM[id];
      if (!el) return;
      el.textContent = stages[idx] ? 'Active' : 'Disabled';
      el.classList.toggle('active', stages[idx]);
      el.classList.toggle('disabled', !stages[idx]);
    });

    if (Array.isArray(DOM.pipelineSteps)) {
      DOM.pipelineSteps.forEach((stepEl) => {
        const stageNum = parseInt(stepEl.dataset.stage, 10);
        if (!Number.isFinite(stageNum) || stageNum > 4) return;
        stepEl.classList.toggle('active', stages[stageNum - 1]);
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MODALS — Open / Close / Populate / Read / Save
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Open a modal for add (editIdx omitted) or edit (editIdx = array index).
   */
  function openModal(type, editIdx) {
    log(`MODAL OPEN: type="${type}", editIdx=${editIdx}`);
    const modal = getModal(type);
    if (!modal) {
      console.error(`[ScrabEngine] MODAL OPEN FAILED: getModal("${type}") returned null. DOM key: "${MODAL_REGISTRY[type]?.key}", DOM value:`, DOM[MODAL_REGISTRY[type]?.key]);
      return;
    }

    state.editingType = type;
    state.editingIndex = typeof editIdx === 'number' ? editIdx : -1;

    const isEdit = state.editingIndex >= 0;
    const fields = MODAL_FIELDS[type];
    if (!fields) {
      console.error(`[ScrabEngine] MODAL OPEN FAILED: No MODAL_FIELDS for type "${type}"`);
      return;
    }

    if (isEdit) {
      const saveConfig = MODAL_SAVE_CONFIG[type];
      const item = saveConfig.getArray()[state.editingIndex];
      populateModalFields(type, item);
    } else {
      clearModalFields(type);
    }

    const titleEl = modal.querySelector('.modal-title');
    if (titleEl) {
      const base = titleEl.textContent.replace(/^(Add|Edit)\s+/, '');
      titleEl.textContent = `${isEdit ? 'Edit' : 'Add'} ${base}`;
    }

    const saveBtn = document.getElementById(MODAL_REGISTRY[type].save);
    if (saveBtn) {
      const label = saveBtn.textContent.replace(/^(Add|Update)\s+/, '');
      saveBtn.textContent = `${isEdit ? 'Update' : 'Add'} ${label}`;
    }

    modal.classList.add('active');
    log(`MODAL OPEN SUCCESS: "${type}" is now visible, classList:`, modal.className);
  }

  function closeModal(type) {
    log(`MODAL CLOSE: type="${type}"`);

    const modal = getModal(type);
    if (modal) modal.classList.remove('active');
    state.editingType = null;
    state.editingIndex = -1;
  }

  function clearModalFields(type) {
    const fields = MODAL_FIELDS[type] || [];
    fields.forEach(f => {
      const el = document.getElementById(f.id);
      if (!el) return;
      if (f.type === 'checkbox') { el.checked = f.defaultVal; }
      else { el.value = f.defaultVal; }
    });
  }

  function populateModalFields(type, item) {
    const fields = MODAL_FIELDS[type] || [];
    fields.forEach(f => {
      const el = document.getElementById(f.id);
      if (!el) return;
      const val = item[f.prop];
      if (f.type === 'checkbox') {
        el.checked = val !== false && val !== undefined ? val : f.defaultVal;
      } else if (f.type === 'csv') {
        el.value = Array.isArray(val) ? val.join(', ') : (val || '');
      } else if (f.type === 'lines') {
        el.value = Array.isArray(val) ? val.join('\n') : (val || '');
      } else {
        el.value = val !== undefined && val !== null ? val : f.defaultVal;
      }
    });
  }

  function readModalFields(type) {
    const fields = MODAL_FIELDS[type] || [];
    const result = {};
    fields.forEach(f => {
      const el = document.getElementById(f.id);
      if (!el) return;
      if (f.type === 'checkbox') {
        result[f.prop] = el.checked;
      } else if (f.type === 'csv') {
        result[f.prop] = el.value.split(',').map(s => s.trim()).filter(Boolean);
      } else if (f.type === 'lines') {
        result[f.prop] = el.value.split('\n').map(s => s.trim()).filter(Boolean);
      } else if (f.type === 'number') {
        result[f.prop] = el.value;
      } else if (f.type === 'float') {
        result[f.prop] = el.value;
      } else {
        result[f.prop] = el.value.trim();
      }
    });
    return result;
  }

  /**
   * Universal save handler — config-driven, no if/else branching.
   */
  function saveModalItem(type) {
    log(`SAVE MODAL: type="${type}"`);
    const saveConf = MODAL_SAVE_CONFIG[type];
    if (!saveConf) { console.error(`[ScrabEngine] SAVE FAILED: No MODAL_SAVE_CONFIG for "${type}"`); return; }

    const fieldValues = readModalFields(type);
    const error = saveConf.validate(fieldValues);
    if (error) { alert(error); return; }

    const arr = saveConf.getArray();
    const isEdit = state.editingIndex >= 0;

    if (isEdit) {
      const existing = arr[state.editingIndex];
      const updated = saveConf.buildItem(fieldValues);
      updated.id = existing.id;
      updated.enabled = existing.enabled;
      arr[state.editingIndex] = updated;
    } else {
      arr.push(saveConf.buildItem(fieldValues));
    }

    markDirty();
    closeModal(type);
    render();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LIVE TESTING
  // ════════════════════════════════════════════════════════════════════════════

  async function runTest() {
    const testText = (DOM.testInput.value || '').trim();
    if (!testText) { alert('Please enter test text'); return; }

    try {
      DOM.btnRunTest.disabled = true;
      DOM.btnRunTest.textContent = 'Processing...';

      const result = await AgentConsoleAuth.apiFetch(
        `/api/agent-console/${state.companyId}/scrabengine/test`,
        { method: 'POST', body: { text: testText, config: state.config } }
      );
      displayTestResults(result);
    } catch (err) {
      console.error('[ScrabEngine] Test failed:', err);
      alert('Test failed: ' + err.message);
    } finally {
      DOM.btnRunTest.disabled = false;
      DOM.btnRunTest.textContent = '\u25B6 Process Text';
    }
  }

  function displayTestResults(result) {
    DOM.testResults.style.display = 'block';

    setTestText('test-raw', result.rawText);
    setTestText('test-stage1', result.stage1_fillers?.cleaned || '');
    setTestText('test-stage2', result.stage2_vocabulary?.normalized || '');
    setTestText('test-stage3', result.stage3_expansion?.expandedTokens?.join(', ') || '');
    setTestText('test-final', result.normalizedText);
    setTestText('test-time', result.performance?.totalTimeMs || 0);

    const removed = result.stage1_fillers?.removed || [];
    setTestBadges('test-stage1-removed', removed.map(r => `Removed: ${escapeHtml(r.value)}`));

    const applied = result.stage2_vocabulary?.applied || [];
    setTestBadges('test-stage2-applied', applied.map(a => `${escapeHtml(a.from)} \u2192 ${escapeHtml(a.to)}`));

    const expansionMap = result.stage3_expansion?.expansionMap || {};
    setTestBadges('test-stage3-expanded', Object.keys(expansionMap).map(key =>
      `${escapeHtml(key)}: +${expansionMap[key].length}`
    ));

    const entities = result.entities || {};
    const extractions = result.stage4_extraction?.extractions || [];
    const entitiesFound = [];
    if (entities.firstName) entitiesFound.push(`First: "${escapeHtml(entities.firstName)}"`);
    if (entities.lastName)  entitiesFound.push(`Last: "${escapeHtml(entities.lastName)}"`);
    if (entities.phone)     entitiesFound.push(`Phone: ${escapeHtml(entities.phone)}`);
    if (entities.address)   entitiesFound.push(`Address: ${escapeHtml(entities.address)}`);
    if (entities.email)     entitiesFound.push(`Email: ${escapeHtml(entities.email)}`);

    Object.entries(entities).forEach(([key, val]) => {
      if (val && !['firstName', 'lastName', 'phone', 'address', 'email', 'fullName'].includes(key)) {
        entitiesFound.push(`${escapeHtml(key)}: "${escapeHtml(val)}"`);
      }
    });

    setTestText('test-stage4', entitiesFound.length > 0 ? entitiesFound.join(' | ') : 'No entities extracted');
    setTestBadges('test-stage4-entities', extractions.map(e =>
      `${escapeHtml(e.type)}="${escapeHtml(e.value)}" (${escapeHtml(e.pattern)}, ${Math.round(e.confidence * 100)}%${e.validated ? ' \u2705' : ''})`
    ));
  }

  function setTestText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setTestBadges(id, badgeTexts) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = badgeTexts.length > 0
      ? badgeTexts.map(t => `<span class="test-badge">${t}</span>`).join('')
      : '';
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BULK IMPORT — Vocabulary
  // Format: canonical=variant1, variant2, variant3  (one line per term)
  // Each variant becomes: from=variant → to=canonical
  // ════════════════════════════════════════════════════════════════════════════

  function openBulkVocabModal() {
    if (DOM.bulkVocabInput) DOM.bulkVocabInput.value = '';
    if (DOM.bulkVocabPreview) DOM.bulkVocabPreview.style.display = 'none';
    if (DOM.modalBulkVocab) DOM.modalBulkVocab.classList.add('active');
  }

  function closeBulkVocabModal() {
    if (DOM.modalBulkVocab) DOM.modalBulkVocab.classList.remove('active');
  }

  function parseBulkVocabText(raw) {
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const entries = [];
    const errors = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) {
        errors.push(`Line ${i + 1}: Missing "=" separator — "${line.substring(0, 40)}"`);
        continue;
      }

      const canonical = line.substring(0, eqIdx).trim().toLowerCase();
      const variantsRaw = line.substring(eqIdx + 1);

      if (!canonical) {
        errors.push(`Line ${i + 1}: Empty canonical term`);
        continue;
      }

      const variants = variantsRaw.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
      if (variants.length === 0) {
        errors.push(`Line ${i + 1}: No variants for "${canonical}"`);
        continue;
      }

      for (const variant of variants) {
        if (variant === canonical) continue;
        entries.push({ from: variant, to: canonical });
      }
    }

    return { entries, errors, lineCount: lines.length };
  }

  function parseBulkVocab() {
    const raw = (DOM.bulkVocabInput?.value || '').trim();
    if (!raw) { alert('Please paste your vocabulary map'); return; }

    const mode = DOM.bulkVocabMode?.value || 'EXACT';
    const { entries, errors, lineCount } = parseBulkVocabText(raw);

    if (errors.length > 0 && entries.length === 0) {
      alert('Parse errors:\n\n' + errors.join('\n'));
      return;
    }

    const existing = new Set(
      (state.config.vocabulary.entries || []).map(e => `${norm(e.from)}→${norm(e.to)}`)
    );
    const fresh = entries.filter(e => !existing.has(`${norm(e.from)}→${norm(e.to)}`));
    const dupeCount = entries.length - fresh.length;

    if (fresh.length === 0) {
      alert(`All ${entries.length} entries already exist. Nothing to import.`);
      return;
    }

    const confirmMsg = [
      `Parsed ${lineCount} lines → ${entries.length} normalization rules`,
      dupeCount > 0 ? `${dupeCount} duplicates skipped` : null,
      `${fresh.length} new rules to import`,
      errors.length > 0 ? `\n${errors.length} parse warning(s):\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? '\n...' : ''}` : null,
      `\nMatch mode: ${mode}`,
      `\nImport ${fresh.length} rules?`
    ].filter(Boolean).join('\n');

    if (!confirm(confirmMsg)) return;

    for (const entry of fresh) {
      state.config.vocabulary.entries.push({
        id: makeId(),
        from: entry.from,
        to: entry.to,
        matchMode: mode,
        enabled: true,
        priority: 100
      });
    }

    markDirty();
    closeBulkVocabModal();
    render();
    log(`BULK IMPORT: Added ${fresh.length} vocabulary entries`);
    alert(`Imported ${fresh.length} vocabulary rules.\n\nDon't forget to click "Save All Changes" to persist!`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════════════════════════════════════════

  function makeId() {
    return `scrab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function truncateId(id) {
    if (!id || id.length <= 12) return id || '\u2014';
    return `${id.slice(0, 6)}...${id.slice(-4)}`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getModal(type) {
    const config = MODAL_REGISTRY[type];
    return config ? DOM[config.key] : null;
  }

  function markDirty() {
    state.hasChanges = true;
    updateSaveButton();
  }

  function norm(value) { return String(value || '').trim().toLowerCase(); }

  function clampPriority(raw, fallback) {
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(999, parsed)) : fallback;
  }

  function clampConfidence(raw, fallback) {
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
  }

  function normalizeConfig(inputConfig) {
    const c = inputConfig && typeof inputConfig === 'object' ? inputConfig : {};
    return {
      ...c,
      enabled: c.enabled !== false,
      fillers: {
        enabled: c.fillers?.enabled !== false,
        stripGreetings: c.fillers?.stripGreetings !== false,
        stripCompanyName: c.fillers?.stripCompanyName !== false,
        customFillers: Array.isArray(c.fillers?.customFillers) ? c.fillers.customFillers : []
      },
      vocabulary: {
        enabled: c.vocabulary?.enabled !== false,
        entries: Array.isArray(c.vocabulary?.entries) ? c.vocabulary.entries : []
      },
      synonyms: {
        enabled: c.synonyms?.enabled !== false,
        wordSynonyms: Array.isArray(c.synonyms?.wordSynonyms) ? c.synonyms.wordSynonyms : [],
        contextPatterns: Array.isArray(c.synonyms?.contextPatterns) ? c.synonyms.contextPatterns : []
      },
      extraction: {
        enabled: c.extraction?.enabled !== false,
        customPatterns: Array.isArray(c.extraction?.customPatterns) ? c.extraction.customPatterns : []
      }
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BOOT
  // ════════════════════════════════════════════════════════════════════════════

  log('BOOT: readyState =', document.readyState);
  if (document.readyState === 'loading') {
    log('BOOT: Waiting for DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', init);
  } else {
    log('BOOT: DOM ready, calling init() immediately');
    init();
  }

  log('BOOT: IIFE complete');
})();
