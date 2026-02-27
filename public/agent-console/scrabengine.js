(function() {
  'use strict';
  
  console.log('[ScrabEngine] ✓ Script loaded');

  const state = {
    companyId: null,
    config: {
      enabled: true,
      fillers: {
        enabled: true,
        stripGreetings: true,
        stripCompanyName: true,
        customFillers: []
      },
      vocabulary: {
        enabled: true,
        entries: []
      },
      synonyms: {
        enabled: true,
        wordSynonyms: [],
        contextPatterns: []
      },
      extraction: {
        enabled: true,
        customPatterns: []
      }
    },
    editingItem: null,
    editingType: null,
    hasChanges: false
  };

  let DOM = {};
  const MODAL_REGISTRY = {
    filler: { key: 'modalFiller', cancel: 'btn-cancel-filler', save: 'btn-save-filler' },
    vocabulary: { key: 'modalVocabulary', cancel: 'btn-cancel-vocab', save: 'btn-save-vocab' },
    wordSynonym: { key: 'modalWordSynonym', cancel: 'btn-cancel-word-syn', save: 'btn-save-word-syn' },
    contextPattern: { key: 'modalContextPattern', cancel: 'btn-cancel-pattern', save: 'btn-save-pattern' },
    extraction: { key: 'modalExtraction', cancel: 'btn-cancel-extraction', save: 'btn-save-extraction' }
  };
  const STAGE_STATUS_IDS = ['stage1Status', 'stage2Status', 'stage3Status', 'stage4Status'];

  // ══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ══════════════════════════════════════════════════════════════════════════

  function initDOM() {
    console.log('[ScrabEngine] ✓ initDOM() called');
    DOM = {
      headerCompanyName: document.getElementById('header-company-name'),
      headerCompanyId: document.getElementById('header-company-id'),
      btnBack: document.getElementById('btn-back'),
      btnSaveAll: document.getElementById('btn-save-all'),
      btnTestPanel: document.getElementById('btn-test-panel'),
      btnViewLogs: document.getElementById('btn-view-logs'),
      
      // Stage toggles
      toggleFillers: document.getElementById('toggle-fillers'),
      toggleVocabulary: document.getElementById('toggle-vocabulary'),
      toggleSynonyms: document.getElementById('toggle-synonyms'),
      
      // Filler options
      stripGreetings: document.getElementById('strip-greetings'),
      stripCompanyName: document.getElementById('strip-company-name'),
      
      // Lists
      customFillersList: document.getElementById('custom-fillers-list'),
      vocabularyList: document.getElementById('vocabulary-list'),
      wordSynonymsList: document.getElementById('word-synonyms-list'),
      contextPatternsList: document.getElementById('context-patterns-list'),
      
      // Add buttons
      btnAddFiller: document.getElementById('btn-add-filler'),
      btnAddVocab: document.getElementById('btn-add-vocab'),
      btnAddWordSynonym: document.getElementById('btn-add-word-synonym'),
      btnAddContextPattern: document.getElementById('btn-add-context-pattern'),
      btnAddExtraction: document.getElementById('btn-add-extraction'),
      
      // Extraction
      toggleExtraction: document.getElementById('toggle-extraction'),
      extractionPatternsList: document.getElementById('extraction-patterns-list'),
      
      // Modals
      modalFiller: document.getElementById('modal-filler'),
      modalVocabulary: document.getElementById('modal-vocabulary'),
      modalWordSynonym: document.getElementById('modal-word-synonym'),
      modalContextPattern: document.getElementById('modal-context-pattern'),
      modalExtraction: document.getElementById('modal-extraction'),
      
      // Test panel
      testPanel: document.getElementById('test-panel'),
      testInput: document.getElementById('test-input'),
      btnRunTest: document.getElementById('btn-run-test'),
      testResults: document.getElementById('test-results'),
      
      // Stats
      totalRules: document.getElementById('total-rules'),

      // Stage status pills + pipeline steps
      stage1Status: document.getElementById('stage1-status'),
      stage2Status: document.getElementById('stage2-status'),
      stage3Status: document.getElementById('stage3-status'),
      stage4Status: document.getElementById('stage4-status'),
      pipelineSteps: Array.from(document.querySelectorAll('.pipeline-step'))
    };
  }

  function init() {
    try {
      console.log('[ScrabEngine] Initializing...');
      initDOM();

      const params = new URLSearchParams(window.location.search);
      state.companyId = params.get('companyId');

      if (!state.companyId) {
        window.location.href = '/agent-console/index.html';
        return;
      }

      DOM.headerCompanyId.textContent = truncateId(state.companyId);
      DOM.headerCompanyId.title = state.companyId;
      
      bindEvents();
      loadConfig();
      loadCompanyName();
      
      console.log('[ScrabEngine] Initialization complete');
    } catch (err) {
      console.error('[ScrabEngine] Initialization error:', err);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EVENT BINDING
  // ══════════════════════════════════════════════════════════════════════════

  function bindEvents() {
    // WIRING POINT A: Navigation and page actions
    if (DOM.btnBack) {
      DOM.btnBack.addEventListener('click', () => {
        if (state.hasChanges && !confirm('You have unsaved changes. Leave anyway?')) {
          return;
        }
        window.location.href = `/agent-console/index.html?companyId=${state.companyId}`;
      });
    }

    if (DOM.btnSaveAll) {
      DOM.btnSaveAll.addEventListener('click', saveConfig);
    }

    if (DOM.btnTestPanel) {
      DOM.btnTestPanel.addEventListener('click', () => {
        DOM.testPanel.style.display = DOM.testPanel.style.display === 'none' ? 'block' : 'none';
      });
    }

    if (DOM.btnViewLogs) {
      DOM.btnViewLogs.addEventListener('click', () => {
        window.location.href = `/agent-console/callconsole.html?companyId=${state.companyId}`;
      });
    }

    if (DOM.btnRunTest) {
      DOM.btnRunTest.addEventListener('click', runTest);
    }

    // WIRING POINT B: Pipeline stage toggles
    // Toggle handlers
    if (DOM.toggleFillers) {
      DOM.toggleFillers.addEventListener('change', (e) => {
        state.config.fillers.enabled = e.target.checked;
        markDirty();
        updateStageIndicators();
      });
    }

    if (DOM.toggleVocabulary) {
      DOM.toggleVocabulary.addEventListener('change', (e) => {
        state.config.vocabulary.enabled = e.target.checked;
        markDirty();
        updateStageIndicators();
      });
    }

    if (DOM.toggleSynonyms) {
      DOM.toggleSynonyms.addEventListener('change', (e) => {
        state.config.synonyms.enabled = e.target.checked;
        markDirty();
        updateStageIndicators();
      });
    }

    // WIRING POINT C: Stage options
    // Option toggles
    if (DOM.stripGreetings) {
      DOM.stripGreetings.addEventListener('change', (e) => {
        state.config.fillers.stripGreetings = e.target.checked;
        markDirty();
      });
    }

    if (DOM.stripCompanyName) {
      DOM.stripCompanyName.addEventListener('change', (e) => {
        state.config.fillers.stripCompanyName = e.target.checked;
        markDirty();
      });
    }

    // WIRING POINT D: Create-rule actions
    // Add buttons
    if (DOM.btnAddFiller) DOM.btnAddFiller.addEventListener('click', () => openModal('filler'));
    if (DOM.btnAddVocab) DOM.btnAddVocab.addEventListener('click', () => openModal('vocabulary'));
    if (DOM.btnAddWordSynonym) DOM.btnAddWordSynonym.addEventListener('click', () => openModal('wordSynonym'));
    if (DOM.btnAddContextPattern) DOM.btnAddContextPattern.addEventListener('click', () => openModal('contextPattern'));
    if (DOM.btnAddExtraction) DOM.btnAddExtraction.addEventListener('click', () => openModal('extraction'));

    // Extraction toggle
    if (DOM.toggleExtraction) {
      DOM.toggleExtraction.addEventListener('change', (e) => {
        if (!state.config.extraction) state.config.extraction = {};
        state.config.extraction.enabled = e.target.checked;
        markDirty();
        updateStageIndicators();
      });
    }

    // WIRING POINT E: Modal close/save handlers
    Object.keys(MODAL_REGISTRY).forEach(setupModal);

    // Keyboard escape should close whichever modal is open
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const openType = Object.keys(MODAL_REGISTRY).find((type) => {
        const modal = getModal(type);
        return modal && modal.classList.contains('open');
      });
      if (openType) closeModal(openType);
    });
  }

  function setupModal(type) {
    const config = MODAL_REGISTRY[type];
    if (!config) return;

    const modal = getModal(type);
    const cancelBtn = document.getElementById(config.cancel);
    const saveBtn = document.getElementById(config.save);

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => closeModal(type));
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => saveModalItem(type));
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal(type);
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DATA LOADING
  // ══════════════════════════════════════════════════════════════════════════

  async function loadConfig() {
    try {
      console.log('[ScrabEngine] Loading configuration...');
      const data = await AgentConsoleAuth.apiFetch(
        `/api/agent-console/${state.companyId}/scrabengine`
      );
      
      if (data && data.config) {
        state.config = normalizeConfig(data.config);
        render();
        console.log('[ScrabEngine] Configuration loaded');
      }
    } catch (err) {
      console.error('[ScrabEngine] Failed to load config:', err);
      // Use default config
      render();
    }
  }

  async function saveConfig() {
    try {
      console.log('[ScrabEngine] Saving configuration...');
      DOM.btnSaveAll.disabled = true;
      DOM.btnSaveAll.textContent = 'Saving...';
      
      await AgentConsoleAuth.apiFetch(
        `/api/agent-console/${state.companyId}/scrabengine`,
        {
          method: 'POST',
          body: { config: state.config }
        }
      );
      
      state.hasChanges = false;
      updateSaveButton();
      
      DOM.btnSaveAll.textContent = '✓ Saved!';
      setTimeout(() => {
        DOM.btnSaveAll.textContent = '💾 Save All Changes';
        DOM.btnSaveAll.disabled = false;
      }, 2000);
      
      console.log('[ScrabEngine] Configuration saved successfully');
    } catch (err) {
      console.error('[ScrabEngine] Save failed:', err);
      alert('Failed to save configuration: ' + err.message);
      DOM.btnSaveAll.textContent = '💾 Save All Changes';
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
    } catch (err) {
      DOM.headerCompanyName.textContent = 'Company';
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDERING
  // ══════════════════════════════════════════════════════════════════════════

  function render() {
    console.log('[ScrabEngine] Rendering...');
    
    // Update toggles
    if (DOM.toggleFillers) DOM.toggleFillers.checked = state.config.fillers.enabled !== false;
    if (DOM.toggleVocabulary) DOM.toggleVocabulary.checked = state.config.vocabulary.enabled !== false;
    if (DOM.toggleSynonyms) DOM.toggleSynonyms.checked = state.config.synonyms.enabled !== false;
    if (DOM.toggleExtraction) DOM.toggleExtraction.checked = state.config.extraction.enabled !== false;
    
    // Update options
    if (DOM.stripGreetings) DOM.stripGreetings.checked = state.config.fillers.stripGreetings !== false;
    if (DOM.stripCompanyName) DOM.stripCompanyName.checked = state.config.fillers.stripCompanyName !== false;
    
    // Render lists
    renderCustomFillers();
    renderVocabulary();
    renderWordSynonyms();
    renderContextPatterns();
    renderExtractionPatterns();
    
    updateStats();
    updateStageIndicators();
  }
  
  function renderExtractionPatterns() {
    const patterns = (state.config.extraction && state.config.extraction.customPatterns) || [];
    
    if (patterns.length === 0) {
      if (DOM.extractionPatternsList) {
        DOM.extractionPatternsList.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">🏷️</div>
            <div class="empty-state-text">No custom patterns yet. Click "+ Add Extraction Pattern" to create one.</div>
          </div>
        `;
      }
      return;
    }
    
    if (DOM.extractionPatternsList) {
      DOM.extractionPatternsList.innerHTML = patterns.map((pattern, idx) => `
        <div class="entry-item ${pattern.enabled === false ? 'disabled' : ''}">
          <input type="checkbox" class="entry-checkbox" data-type="extraction" data-idx="${idx}" ${pattern.enabled !== false ? 'checked' : ''}>
          <div class="entry-content">
            <span class="entry-from"><strong>${escapeHtml(pattern.label || pattern.entityName)}</strong></span>
            <span class="entry-arrow">→</span>
            <span class="entry-to">${escapeHtml(pattern.pattern)}</span>
            ${pattern.autoHandoff ? '<span class="entry-badge">Auto-handoff</span>' : ''}
            ${pattern.validateGlobalShare ? '<span class="entry-badge">GlobalShare ✓</span>' : ''}
            <span class="entry-badge">${Math.round((pattern.confidence || 0.85) * 100)}%</span>
          </div>
          <div class="entry-actions">
            <button class="entry-btn" data-action="delete" data-type="extraction" data-idx="${idx}">Delete</button>
          </div>
        </div>
      `).join('');
      
      // Bind events
      DOM.extractionPatternsList.querySelectorAll('.entry-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
          const idx = parseInt(e.target.dataset.idx);
          state.config.extraction.customPatterns[idx].enabled = e.target.checked;
          markDirty();
          render();
        });
      });
      
      DOM.extractionPatternsList.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt(e.target.dataset.idx);
          if (confirm('Delete this extraction pattern?')) {
            state.config.extraction.customPatterns.splice(idx, 1);
            markDirty();
            render();
          }
        });
      });
    }
  }

  function renderCustomFillers() {
    const fillers = state.config.fillers.customFillers || [];
    
    if (fillers.length === 0) {
      DOM.customFillersList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <div class="empty-state-text">No custom fillers yet. Click "+ Add Filler" to create one.</div>
        </div>
      `;
      return;
    }
    
    DOM.customFillersList.innerHTML = fillers.map((filler, idx) => `
      <div class="entry-item ${filler.enabled === false ? 'disabled' : ''}">
        <input type="checkbox" class="entry-checkbox" data-type="filler" data-idx="${idx}" ${filler.enabled !== false ? 'checked' : ''}>
        <div class="entry-content">
          <span class="entry-from">"${escapeHtml(filler.phrase)}"</span>
          <span class="entry-badge">P${filler.priority || 100}</span>
        </div>
        <div class="entry-actions">
          <button class="entry-btn" data-action="delete" data-type="filler" data-idx="${idx}">Delete</button>
        </div>
      </div>
    `).join('');
    
    // Bind events
    DOM.customFillersList.querySelectorAll('.entry-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        state.config.fillers.customFillers[idx].enabled = e.target.checked;
        markDirty();
        render();
      });
    });
    
    DOM.customFillersList.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        if (confirm('Delete this filler?')) {
          state.config.fillers.customFillers.splice(idx, 1);
          markDirty();
          render();
        }
      });
    });
  }

  function renderVocabulary() {
    const entries = state.config.vocabulary.entries || [];
    
    if (entries.length === 0) {
      DOM.vocabularyList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📖</div>
          <div class="empty-state-text">No vocabulary rules yet. Click "+ Add Normalization" to create one.</div>
        </div>
      `;
      return;
    }
    
    DOM.vocabularyList.innerHTML = entries.map((entry, idx) => `
      <div class="entry-item ${entry.enabled === false ? 'disabled' : ''}">
        <input type="checkbox" class="entry-checkbox" data-type="vocab" data-idx="${idx}" ${entry.enabled !== false ? 'checked' : ''}>
        <div class="entry-content">
          <span class="entry-from">"${escapeHtml(entry.from)}"</span>
          <span class="entry-arrow">→</span>
          <span class="entry-to">"${escapeHtml(entry.to)}"</span>
          <span class="entry-badge">${entry.matchMode || 'EXACT'}</span>
          <span class="entry-badge">P${entry.priority || 100}</span>
        </div>
        <div class="entry-actions">
          <button class="entry-btn" data-action="delete" data-type="vocab" data-idx="${idx}">Delete</button>
        </div>
      </div>
    `).join('');
    
    // Bind events
    DOM.vocabularyList.querySelectorAll('.entry-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        state.config.vocabulary.entries[idx].enabled = e.target.checked;
        markDirty();
        render();
      });
    });
    
    DOM.vocabularyList.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        if (confirm('Delete this vocabulary rule?')) {
          state.config.vocabulary.entries.splice(idx, 1);
          markDirty();
          render();
        }
      });
    });
  }

  function renderWordSynonyms() {
    const syns = state.config.synonyms.wordSynonyms || [];
    
    if (syns.length === 0) {
      DOM.wordSynonymsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">💬</div>
          <div class="empty-state-text">No word synonyms yet. Click "+ Word Synonym" to create one.</div>
        </div>
      `;
      return;
    }
    
    DOM.wordSynonymsList.innerHTML = syns.map((syn, idx) => `
      <div class="entry-item ${syn.enabled === false ? 'disabled' : ''}">
        <input type="checkbox" class="entry-checkbox" data-type="wordsyn" data-idx="${idx}" ${syn.enabled !== false ? 'checked' : ''}>
        <div class="entry-content">
          <span class="entry-from">"${escapeHtml(syn.word)}"</span>
          <span class="entry-arrow">→</span>
          <span class="entry-to">[${syn.synonyms?.length || 0} synonyms]</span>
          <span class="entry-badge">P${syn.priority || 50}</span>
        </div>
        <div class="entry-actions">
          <button class="entry-btn" data-action="delete" data-type="wordsyn" data-idx="${idx}">Delete</button>
        </div>
      </div>
    `).join('');
    
    // Bind events
    DOM.wordSynonymsList.querySelectorAll('.entry-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        state.config.synonyms.wordSynonyms[idx].enabled = e.target.checked;
        markDirty();
        render();
      });
    });
    
    DOM.wordSynonymsList.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        if (confirm('Delete this word synonym?')) {
          state.config.synonyms.wordSynonyms.splice(idx, 1);
          markDirty();
          render();
        }
      });
    });
  }

  function renderContextPatterns() {
    const patterns = state.config.synonyms.contextPatterns || [];
    
    if (patterns.length === 0) {
      DOM.contextPatternsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🧠</div>
          <div class="empty-state-text">No context patterns yet. Click "+ Context Pattern" to create one.</div>
        </div>
      `;
      return;
    }
    
    DOM.contextPatternsList.innerHTML = patterns.map((pattern, idx) => `
      <div class="entry-item ${pattern.enabled === false ? 'disabled' : ''}">
        <input type="checkbox" class="entry-checkbox" data-type="pattern" data-idx="${idx}" ${pattern.enabled !== false ? 'checked' : ''}>
        <div class="entry-content">
          <span class="entry-from">[${pattern.pattern?.join(', ') || ''}]</span>
          <span class="entry-arrow">→</span>
          <span class="entry-to">"${escapeHtml(pattern.component)}"</span>
          <span class="entry-badge">${Math.round((pattern.confidence || 0.9) * 100)}%</span>
          <span class="entry-badge">P${pattern.priority || 100}</span>
        </div>
        <div class="entry-actions">
          <button class="entry-btn" data-action="delete" data-type="pattern" data-idx="${idx}">Delete</button>
        </div>
      </div>
    `).join('');
    
    // Bind events
    DOM.contextPatternsList.querySelectorAll('.entry-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        state.config.synonyms.contextPatterns[idx].enabled = e.target.checked;
        markDirty();
        render();
      });
    });
    
    DOM.contextPatternsList.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        if (confirm('Delete this context pattern?')) {
          state.config.synonyms.contextPatterns.splice(idx, 1);
          markDirty();
          render();
        }
      });
    });
  }

  function updateStats() {
    const totalRules = 
      (state.config.fillers.customFillers || []).filter(f => f.enabled !== false).length +
      (state.config.vocabulary.entries || []).filter(e => e.enabled !== false).length +
      (state.config.synonyms.wordSynonyms || []).filter(s => s.enabled !== false).length +
      (state.config.synonyms.contextPatterns || []).filter(p => p.enabled !== false).length +
      (state.config.extraction?.customPatterns || []).filter(p => p.enabled !== false).length;
    
    if (DOM.totalRules) {
      DOM.totalRules.textContent = totalRules;
    }
  }

  function updateSaveButton() {
    if (DOM.btnSaveAll) {
      DOM.btnSaveAll.textContent = state.hasChanges ? '💾 Save All Changes *' : '💾 Save All Changes';
      DOM.btnSaveAll.style.background = state.hasChanges ? '#dc2626' : '';
      DOM.btnSaveAll.style.color = state.hasChanges ? '#fff' : '';
    }
  }

  function updateStageIndicators() {
    const stages = [
      state.config.fillers.enabled !== false,
      state.config.vocabulary.enabled !== false,
      state.config.synonyms.enabled !== false,
      state.config.extraction.enabled !== false
    ];

    STAGE_STATUS_IDS.forEach((id, idx) => {
      const el = DOM[id];
      if (!el) return;
      const isActive = stages[idx];
      el.textContent = isActive ? 'Active' : 'Disabled';
      el.classList.toggle('active', isActive);
      el.classList.toggle('disabled', !isActive);
    });

    if (Array.isArray(DOM.pipelineSteps)) {
      DOM.pipelineSteps.forEach((stepEl) => {
        const stageNum = parseInt(stepEl.dataset.stage, 10);
        if (!Number.isFinite(stageNum) || stageNum > 4) return;
        stepEl.classList.toggle('active', stages[stageNum - 1]);
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MODALS
  // ══════════════════════════════════════════════════════════════════════════

  function openModal(type) {
    const modal = getModal(type);
    if (modal) {
      state.editingType = type;
      clearModalInputs(type);
      modal.classList.add('open');
    }
  }

  function closeModal(type) {
    const modal = getModal(type);
    if (modal) {
      modal.classList.remove('open');
      state.editingType = null;
      state.editingItem = null;
    }
  }

  function clearModalInputs(type) {
    if (type === 'filler') {
      document.getElementById('filler-phrase').value = '';
      document.getElementById('filler-priority').value = '100';
    } else if (type === 'vocabulary') {
      document.getElementById('vocab-from').value = '';
      document.getElementById('vocab-to').value = '';
      document.getElementById('vocab-mode').value = 'EXACT';
      document.getElementById('vocab-priority').value = '100';
    } else if (type === 'wordSynonym') {
      document.getElementById('word-syn-word').value = '';
      document.getElementById('word-syn-synonyms').value = '';
      document.getElementById('word-syn-priority').value = '50';
    } else if (type === 'contextPattern') {
      document.getElementById('pattern-words').value = '';
      document.getElementById('pattern-component').value = '';
      document.getElementById('pattern-tokens').value = '';
      document.getElementById('pattern-confidence').value = '0.9';
      document.getElementById('pattern-priority').value = '100';
    } else if (type === 'extraction') {
      document.getElementById('extraction-entity-name').value = '';
      document.getElementById('extraction-label').value = '';
      document.getElementById('extraction-pattern').value = '';
      document.getElementById('extraction-examples').value = '';
      document.getElementById('extraction-confidence').value = '0.85';
      document.getElementById('extraction-handoff').checked = true;
      document.getElementById('extraction-globalshare').checked = false;
    }
  }

  function saveModalItem(type) {
    if (type === 'filler') {
      const phrase = document.getElementById('filler-phrase').value.trim();
      const priority = clampPriority(document.getElementById('filler-priority').value, 100);
      
      if (!phrase) {
        alert('Please enter a filler phrase');
        return;
      }
      if ((state.config.fillers.customFillers || []).some(f => normalizeSimple(f.phrase) === normalizeSimple(phrase))) {
        alert('This filler phrase already exists');
        return;
      }
      
      state.config.fillers.customFillers.push({
        id: makeId(),
        phrase,
        enabled: true,
        priority
      });
      
      markDirty();
      closeModal(type);
      render();
      
    } else if (type === 'vocabulary') {
      const from = document.getElementById('vocab-from').value.trim();
      const to = document.getElementById('vocab-to').value.trim();
      const mode = document.getElementById('vocab-mode').value;
      const priority = clampPriority(document.getElementById('vocab-priority').value, 100);
      
      if (!from || !to) {
        alert('Please fill in both From and To fields');
        return;
      }
      if ((state.config.vocabulary.entries || []).some(e => normalizeSimple(e.from) === normalizeSimple(from) && normalizeSimple(e.to) === normalizeSimple(to))) {
        alert('This vocabulary normalization already exists');
        return;
      }
      
      state.config.vocabulary.entries.push({
        id: makeId(),
        from,
        to,
        matchMode: mode,
        enabled: true,
        priority
      });
      
      markDirty();
      closeModal(type);
      render();
      
    } else if (type === 'wordSynonym') {
      const word = document.getElementById('word-syn-word').value.trim();
      const synonymsStr = document.getElementById('word-syn-synonyms').value.trim();
      const priority = clampPriority(document.getElementById('word-syn-priority').value, 50);
      
      if (!word || !synonymsStr) {
        alert('Please fill in both Word and Synonyms fields');
        return;
      }
      
      const synonyms = synonymsStr.split(',').map(s => s.trim()).filter(Boolean);
      
      state.config.synonyms.wordSynonyms.push({
        id: makeId(),
        word,
        synonyms,
        enabled: true,
        priority
      });
      
      markDirty();
      closeModal(type);
      render();
      
    } else if (type === 'contextPattern') {
      const wordsStr = document.getElementById('pattern-words').value.trim();
      const component = document.getElementById('pattern-component').value.trim();
      const tokensStr = document.getElementById('pattern-tokens').value.trim();
      const confidence = clampConfidence(document.getElementById('pattern-confidence').value, 0.9);
      const priority = clampPriority(document.getElementById('pattern-priority').value, 100);
      
      if (!wordsStr || !component) {
        alert('Please fill in Pattern Words and Component fields');
        return;
      }
      
      const pattern = wordsStr.split(',').map(w => w.trim()).filter(Boolean);
      const contextTokens = tokensStr.split(',').map(t => t.trim()).filter(Boolean);
      
      state.config.synonyms.contextPatterns.push({
        id: makeId(),
        pattern,
        component,
        contextTokens,
        confidence,
        enabled: true,
        priority
      });
      
      markDirty();
      closeModal(type);
      render();
      
    } else if (type === 'extraction') {
      const entityName = document.getElementById('extraction-entity-name').value.trim();
      const label = document.getElementById('extraction-label').value.trim();
      const pattern = document.getElementById('extraction-pattern').value.trim();
      const examples = document.getElementById('extraction-examples').value.trim();
      const confidence = clampConfidence(document.getElementById('extraction-confidence').value, 0.85);
      const autoHandoff = document.getElementById('extraction-handoff').checked;
      const validateGlobalShare = document.getElementById('extraction-globalshare').checked;
      
      if (!entityName || !label || !pattern) {
        alert('Please fill in Entity Name, Label, and Pattern fields');
        return;
      }
      
      // Validate entity name format (camelCase, no spaces)
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(entityName)) {
        alert('Entity Name must be camelCase with no spaces (e.g., companyName, urgencyLevel)');
        return;
      }
      if ((state.config.extraction?.customPatterns || []).some(p => normalizeSimple(p.entityName) === normalizeSimple(entityName))) {
        alert('An extraction with this Entity Name already exists');
        return;
      }
      try {
        // Validate regex syntax early to prevent runtime extractor failures.
        new RegExp(pattern, 'i');
      } catch (err) {
        alert(`Invalid regex pattern: ${err.message}`);
        return;
      }
      
      if (!state.config.extraction) {
        state.config.extraction = { enabled: true, customPatterns: [] };
      }
      if (!state.config.extraction.customPatterns) {
        state.config.extraction.customPatterns = [];
      }
      
      const exampleLines = examples.split('\n').map(e => e.trim()).filter(Boolean);
      
      state.config.extraction.customPatterns.push({
        id: makeId(),
        entityName,
        label,
        pattern,
        examples: exampleLines,
        confidence,
        autoHandoff,
        validateGlobalShare,
        enabled: true
      });
      
      markDirty();
      closeModal(type);
      render();
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LIVE TESTING
  // ══════════════════════════════════════════════════════════════════════════

  async function runTest() {
    const testText = DOM.testInput.value;
    if (!testText || !testText.trim()) {
      alert('Please enter test text');
      return;
    }
    
    try {
      DOM.btnRunTest.disabled = true;
      DOM.btnRunTest.textContent = 'Processing...';
      
      const result = await AgentConsoleAuth.apiFetch(
        `/api/agent-console/${state.companyId}/scrabengine/test`,
        {
          method: 'POST',
          body: { 
            text: testText,
            config: state.config
          }
        }
      );
      
      displayTestResults(result);
      
    } catch (err) {
      console.error('[ScrabEngine] Test failed:', err);
      alert('Test failed: ' + err.message);
    } finally {
      DOM.btnRunTest.disabled = false;
      DOM.btnRunTest.textContent = '▶ Process Text';
    }
  }

  function displayTestResults(result) {
    DOM.testResults.style.display = 'block';
    
    document.getElementById('test-raw').textContent = result.rawText;
    document.getElementById('test-stage1').textContent = result.stage1_fillers?.cleaned || '';
    document.getElementById('test-stage2').textContent = result.stage2_vocabulary?.normalized || '';
    document.getElementById('test-stage3').textContent = result.stage3_expansion?.expandedTokens?.join(', ') || '';
    document.getElementById('test-final').textContent = result.normalizedText;
    document.getElementById('test-time').textContent = result.performance?.totalTimeMs || 0;
    
    // Show removed fillers
    const removed = result.stage1_fillers?.removed || [];
    if (removed.length > 0) {
      document.getElementById('test-stage1-removed').innerHTML = 
        removed.map(r => `<span class="test-badge">Removed: ${r.value}</span>`).join('');
    } else {
      document.getElementById('test-stage1-removed').innerHTML = '';
    }
    
    // Show vocabulary normalizations
    const applied = result.stage2_vocabulary?.applied || [];
    if (applied.length > 0) {
      document.getElementById('test-stage2-applied').innerHTML = 
        applied.map(a => `<span class="test-badge">${a.from} → ${a.to}</span>`).join('');
    } else {
      document.getElementById('test-stage2-applied').innerHTML = '';
    }
    
    // Show token expansion
    const expansions = Object.keys(result.stage3_expansion?.expansionMap || {});
    if (expansions.length > 0) {
      document.getElementById('test-stage3-expanded').innerHTML = 
        expansions.map(key => `<span class="test-badge">${key}: +${result.stage3_expansion.expansionMap[key].length}</span>`).join('');
    } else {
      document.getElementById('test-stage3-expanded').innerHTML = '';
    }
    
    // Show entity extraction
    const entities = result.entities || {};
    const stage4Div = document.getElementById('test-stage4');
    const entitiesDiv = document.getElementById('test-stage4-entities');
    
    const entitiesFound = [];
    if (entities.firstName) entitiesFound.push(`First: "${entities.firstName}"`);
    if (entities.lastName) entitiesFound.push(`Last: "${entities.lastName}"`);
    if (entities.phone) entitiesFound.push(`Phone: ${entities.phone}`);
    if (entities.address) entitiesFound.push(`Address: ${entities.address}`);
    if (entities.email) entitiesFound.push(`Email: ${entities.email}`);
    
    stage4Div.textContent = entitiesFound.length > 0 ? entitiesFound.join(' | ') : 'No entities extracted';
    
    // Show extraction details
    const extractions = result.stage4_extraction?.extractions || [];
    if (extractions.length > 0) {
      entitiesDiv.innerHTML = extractions.map(e => 
        `<span class="test-badge">${e.type}="${e.value}" (${e.pattern}, ${Math.round(e.confidence * 100)}%${e.validated ? ' ✅' : ''})</span>`
      ).join('');
    } else {
      entitiesDiv.innerHTML = '';
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ══════════════════════════════════════════════════════════════════════════

  function makeId() {
    return `scrab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function truncateId(id) {
    if (!id || id.length <= 12) return id || '—';
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

  function clampPriority(raw, fallback) {
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(999, parsed));
  }

  function clampConfidence(raw, fallback) {
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(1, parsed));
  }

  function normalizeSimple(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeConfig(inputConfig) {
    const config = inputConfig && typeof inputConfig === 'object' ? inputConfig : {};

    return {
      ...config,
      enabled: config.enabled !== false,
      fillers: {
        enabled: config.fillers?.enabled !== false,
        stripGreetings: config.fillers?.stripGreetings !== false,
        stripCompanyName: config.fillers?.stripCompanyName !== false,
        customFillers: Array.isArray(config.fillers?.customFillers) ? config.fillers.customFillers : []
      },
      vocabulary: {
        enabled: config.vocabulary?.enabled !== false,
        entries: Array.isArray(config.vocabulary?.entries) ? config.vocabulary.entries : []
      },
      synonyms: {
        enabled: config.synonyms?.enabled !== false,
        wordSynonyms: Array.isArray(config.synonyms?.wordSynonyms) ? config.synonyms.wordSynonyms : [],
        contextPatterns: Array.isArray(config.synonyms?.contextPatterns) ? config.synonyms.contextPatterns : []
      },
      extraction: {
        enabled: config.extraction?.enabled !== false,
        customPatterns: Array.isArray(config.extraction?.customPatterns) ? config.extraction.customPatterns : []
      }
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BOOT
  // ══════════════════════════════════════════════════════════════════════════

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('[ScrabEngine] ✓ IIFE complete');
})();
