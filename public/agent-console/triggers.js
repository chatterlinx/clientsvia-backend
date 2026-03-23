/**
 * ============================================================================
 * TRIGGER CONSOLE — Page Controller
 * ClientVia Platform · Agent 2.0 · Global/Local Trigger Management
 * 
 * ISOLATION: This module uses IIFE + strict mode to prevent global leakage.
 * NO window.* assignments. All state is module-scoped.
 * 
 * ============================================================================
 */

(function() {
  'use strict';

  /* --------------------------------------------------------------------------
     CONFIGURATION
     -------------------------------------------------------------------------- */
  const CONFIG = {
    API_BASE_AGENT2: '/api/agent-console',
    API_BASE_ADMIN_AGENT2: '/api/admin/agent2',
    API_BASE_COMPANY: '/api/admin/agent2/company',
    API_BASE_GLOBAL: '/api/admin/agent2/global'
  };

  /* --------------------------------------------------------------------------
     STATE (Module-scoped, NOT global)
     -------------------------------------------------------------------------- */
  const state = {
    companyId: null,
    companyName: null,
    
    activeGroupId: null,
    activeGroupName: null,
    availableGroups: [],
    
    triggers: [],
    stats: null,
    permissions: null,
    buckets: [],
    bucketIndex: new Map(),
    bucketCacheInfo: null,
    
    editingTrigger: null,
    pendingApproval: null,
    
    searchQuery: '',
    scopeFilter: 'all',
    
    // Bulk selection
    selectedTriggerIds: new Set(),
    bulkSelectMode: false,
    
    // Company Variables
    companyVariables: new Map(),
    detectedVariables: new Set(),
    
    // GPT Settings
    gptSettings: {
      defaultPriority: 50,
      tone: 'friendly',
      instructions: '',
      includeFollowup: true
    },
    
    // Current response mode in modal (standard or llm)
    currentResponseMode: 'standard',

    // Deep-link focus (e.g., from Call Console provenance links)
    focusId: null,
    editTriggerId: null,
    editField: null,

    // Search index for fast, reliable filtering
    searchIndex: new Map()
  };

  /* --------------------------------------------------------------------------
     DOM REFERENCES
     -------------------------------------------------------------------------- */
  const DOM = {
    headerCompanyName: document.getElementById('header-company-name'),
    headerCompanyId: document.getElementById('header-company-id'),
    btnBack: document.getElementById('btn-back'),
    btnBackToAgent2: document.getElementById('btn-back-to-agent2'),
    btnAddTrigger: document.getElementById('btn-add-trigger'),
    btnClearAllAudio: document.getElementById('btn-clear-all-audio'),
    btnBulkGenerateAudio: document.getElementById('btn-bulk-generate-audio'),
    btnBulkImportTriggers: document.getElementById('btn-bulk-import-triggers'),
    btnCheckDuplicates: document.getElementById('btn-check-duplicates'),
    btnClearLegacy:  document.getElementById('btn-clear-legacy'),
    btnRefreshCache: document.getElementById('btn-refresh-cache'),
    btnOpenTestPanel: document.getElementById('btn-open-test-panel'),
    btnCloseTestPanel: document.getElementById('btn-close-test-panel'),
    btnRunTriggerTest: document.getElementById('btn-run-trigger-test'),
    triggerTestPanel: document.getElementById('trigger-test-panel'),
    triggerTestInput: document.getElementById('trigger-test-input'),
    triggerTestResults: document.getElementById('trigger-test-results'),
    testRawInput: document.getElementById('test-raw-input'),
    testNormalizedInput: document.getElementById('test-normalized-input'),
    testTransformCount: document.getElementById('test-transform-count'),
    testScrabTime: document.getElementById('test-scrab-time'),
    testMatchBox: document.getElementById('trigger-test-match-box'),
    testMatchTitle: document.getElementById('trigger-test-match-title'),
    testMatchDetail: document.getElementById('trigger-test-match-detail'),
    testAnswerText: document.getElementById('trigger-test-answer-text'),
    testPoolStats: document.getElementById('test-pool-stats'),
    testTrace: document.getElementById('trigger-test-trace'),
    testEvalCount: document.getElementById('test-eval-count'),
    btnCreateGroup: document.getElementById('btn-create-group'),
    btnSettingsMenu: document.getElementById('btn-settings-menu'),
    settingsDropdown: document.getElementById('settings-dropdown'),
    
    btnNameGreeting: document.getElementById('btn-name-greeting'),
    modalNameGreeting: document.getElementById('modal-name-greeting'),
    modalNameGreetingClose: document.getElementById('modal-name-greeting-close'),
    btnNameGreetingCancel: document.getElementById('btn-name-greeting-cancel'),
    btnNameGreetingSave: document.getElementById('btn-name-greeting-save'),
    nameGreetingAlways: document.getElementById('name-greeting-always'),
    nameGreetingText: document.getElementById('name-greeting-text'),
    greetingRulesEmbed: document.getElementById('greeting-rules-embed'),
    btnOpenAgent2Greetings: document.getElementById('btn-open-agent2-greetings'),
    
    btnPatienceSettings: document.getElementById('btn-patience-settings'),
    modalPatience: document.getElementById('modal-patience'),
    modalPatienceClose: document.getElementById('modal-patience-close'),
    btnPatienceCancel: document.getElementById('btn-patience-cancel'),
    btnPatienceSave: document.getElementById('btn-patience-save'),
    patienceEnabled: document.getElementById('patience-enabled'),
    patiencePhrases: document.getElementById('patience-phrases'),
    patienceInitialResponse: document.getElementById('patience-initial-response'),
    patienceTimeoutEnabled: document.getElementById('patience-timeout-enabled'),
    patienceTimeoutSeconds: document.getElementById('patience-timeout-seconds'),
    patienceCheckinResponse: document.getElementById('patience-checkin-response'),
    patienceMaxCheckins: document.getElementById('patience-max-checkins'),
    patienceFinalResponse: document.getElementById('patience-final-response'),
    
    modalBulkImport: document.getElementById('modal-bulk-import'),
    modalBulkImportClose: document.getElementById('modal-bulk-import-close'),
    bulkImportJson: document.getElementById('bulk-import-json'),
    bulkImportStatus: document.getElementById('bulk-import-status'),
    btnCancelBulkImport: document.getElementById('btn-cancel-bulk-import'),
    btnExecuteBulkImport: document.getElementById('btn-execute-bulk-import'),
    chkLocalImportConfirm: document.getElementById('chk-local-import-confirm'),
    
    groupSelector: document.getElementById('group-selector'),
    groupIcon: document.getElementById('group-icon'),
    groupTriggerCount: document.getElementById('group-trigger-count'),
    groupInfo: document.getElementById('group-info'),
    
    statGlobal: document.getElementById('stat-global'),
    statLocal: document.getElementById('stat-local'),
    statPublished: document.getElementById('stat-published'),
    statOverrides: document.getElementById('stat-overrides'),
    statTotal: document.getElementById('stat-total'),
    statDisabled: document.getElementById('stat-disabled'),

    bucketNameInput: document.getElementById('bucket-name-input'),
    bucketKeywordsInput: document.getElementById('bucket-keywords-input'),
    btnAddBucket: document.getElementById('btn-add-bucket'),
    bucketList: document.getElementById('bucket-list'),
    bucketEmpty: document.getElementById('bucket-empty'),
    bucketHealthBuckets: document.getElementById('bucket-health-buckets'),
    bucketHealthKeywords: document.getElementById('bucket-health-keywords'),
    bucketHealthCoverage: document.getElementById('bucket-health-coverage'),
    bucketHealthRuntime: document.getElementById('bucket-health-runtime'),
    
    triggerList: document.getElementById('trigger-list'),
    triggerTableHeader: document.getElementById('trigger-table-header'),
    emptyState: document.getElementById('empty-state'),
    triggerSearch: document.getElementById('trigger-search'),
    
    selectAllTriggers: document.getElementById('select-all-triggers'),
    bulkActionsBar: document.getElementById('bulk-actions-bar'),
    bulkSelectedCount: document.getElementById('bulk-selected-count'),
    btnClearSelection: document.getElementById('btn-clear-selection'),
    btnBulkDelete: document.getElementById('btn-bulk-delete'),
    duplicateWarning: document.getElementById('duplicate-warning'),
    duplicateWarningText: document.getElementById('duplicate-warning-text'),
    btnFixDuplicates: document.getElementById('btn-fix-duplicates'),
    
    filterAll: document.getElementById('filter-all'),
    filterGlobal: document.getElementById('filter-global'),
    filterLocal: document.getElementById('filter-local'),
    
    variablesCard: document.getElementById('variables-card'),
    variablesTableBody: document.getElementById('variables-table-body'),
    variablesEmpty: document.getElementById('variables-empty'),
    
    modalTriggerEdit: document.getElementById('modal-trigger-edit'),
    modalTriggerTitle: document.getElementById('modal-trigger-title'),
    modalTriggerClose: document.getElementById('modal-trigger-close'),
    btnTriggerCancel: document.getElementById('btn-trigger-cancel'),
    btnTriggerSave: document.getElementById('btn-trigger-save'),
    
    inputTriggerLabel: document.getElementById('input-trigger-label'),
    inputTriggerRuleId: document.getElementById('input-trigger-ruleid'),
    inputTriggerPriority: document.getElementById('input-trigger-priority'),
    inputTriggerKeywords: document.getElementById('input-trigger-keywords'),
    inputTriggerPhrases: document.getElementById('input-trigger-phrases'),
    inputTriggerNegative: document.getElementById('input-trigger-negative'),
    inputTriggerAnswer: document.getElementById('input-trigger-answer'),
    inputTriggerAudio: document.getElementById('input-trigger-audio'),
    inputTriggerFollowup: document.getElementById('input-trigger-followup'),
    inputTriggerLocal: document.getElementById('input-trigger-local'),
    scopeSection: document.getElementById('scope-section'),
    
    btnGenerateAudio: document.getElementById('btn-generate-audio'),
    btnPlayAudio: document.getElementById('btn-play-audio'),
    audioStatusHint: document.getElementById('audio-status-hint'),
    
    // Response Mode Toggle (Standard vs LLM)
    responseModeToggle: document.getElementById('response-mode-toggle'),
    responseModeHint: document.getElementById('response-mode-hint'),
    responseFieldsStandard: document.getElementById('response-fields-standard'),
    responseFieldsLlm: document.getElementById('response-fields-llm'),
    inputLlmIncluded: document.getElementById('input-llm-included'),
    inputLlmExcluded: document.getElementById('input-llm-excluded'),
    inputLlmBackup: document.getElementById('input-llm-backup'),
    
    modalApproval: document.getElementById('modal-approval'),
    approvalTitle: document.getElementById('approval-title'),
    approvalText: document.getElementById('approval-text'),
    inputApproval: document.getElementById('input-approval'),
    btnApprovalCancel: document.getElementById('btn-approval-cancel'),
    btnApprovalConfirm: document.getElementById('btn-approval-confirm'),
    modalApprovalClose: document.getElementById('modal-approval-close'),
    
    modalCreateGroup: document.getElementById('modal-create-group'),
    modalGroupClose: document.getElementById('modal-group-close'),
    btnGroupCancel: document.getElementById('btn-group-cancel'),
    btnGroupCreate: document.getElementById('btn-group-create'),
    inputGroupId: document.getElementById('input-group-id'),
    inputGroupName: document.getElementById('input-group-name'),
    inputGroupIcon: document.getElementById('input-group-icon'),
    inputGroupDescription: document.getElementById('input-group-description'),
    
    // GPT Settings Modal
    modalGptSettings: document.getElementById('modal-gpt-settings'),
    modalGptClose: document.getElementById('modal-gpt-close'),
    btnGptSettings: document.getElementById('btn-gpt-settings'),
    btnGptPrefill: document.getElementById('btn-gpt-prefill'),
    btnGptSettingsCancel: document.getElementById('btn-gpt-settings-cancel'),
    btnGptSettingsSave: document.getElementById('btn-gpt-settings-save'),
    gptDefaultPriority: document.getElementById('gpt-default-priority'),
    gptTone: document.getElementById('gpt-tone'),
    gptInstructions: document.getElementById('gpt-instructions'),
    gptIncludeFollowup: document.getElementById('gpt-include-followup'),
    
    toastContainer: document.getElementById('toast-container')
  };

  /* --------------------------------------------------------------------------
     INITIALIZATION
     -------------------------------------------------------------------------- */
  function init() {
    if (!AgentConsoleAuth.requireAuth()) {
      return;
    }

    extractCompanyId();
    
    if (!state.companyId) {
      showToast('error', 'Missing Company ID', 'No companyId found in URL.');
      return;
    }
    
    setupEventListeners();
    if (window.BucketManager && typeof window.BucketManager.init === 'function') {
      window.BucketManager.init({
        companyId: state.companyId,
        onBucketsUpdated: updateBuckets,
        showToast,
        apiFetch
      });
    } else {
      console.warn('[BucketManager] Not available — bucket UI disabled');
    }
    loadTriggers();
  }

  function extractCompanyId() {
    const params = new URLSearchParams(window.location.search);
    state.companyId = params.get('companyId');
    const focus = params.get('focus');
    const edit = params.get('edit');
    const field = params.get('field');
    if (focus) {
      // Accept either "trigger-<id>" or "<id>"
      state.focusId = focus.startsWith('trigger-') ? focus : `trigger-${focus}`;
      // Ensure focus is not accidentally filtered out
      state.searchQuery = '';
      state.scopeFilter = 'all';
      if (DOM.triggerSearch) DOM.triggerSearch.value = '';
    }
    if (edit) {
      const normalizedEdit = edit.startsWith('trigger-') ? edit : `trigger-${edit}`;
      state.editTriggerId = normalizedEdit.replace(/^trigger-/, '');
      state.editField = field || 'answerText';
      state.searchQuery = '';
      state.scopeFilter = 'all';
      if (DOM.triggerSearch) DOM.triggerSearch.value = '';
      if (!state.focusId) state.focusId = `trigger-${state.editTriggerId}`;
    }
    
    if (state.companyId) {
      DOM.headerCompanyId.textContent = truncateId(state.companyId);
      DOM.headerCompanyId.title = state.companyId;
      DOM.btnBack.href = `/agent-console/agent2.html?companyId=${encodeURIComponent(state.companyId)}`;
      
      const logoLink = document.getElementById('header-logo-link');
      if (logoLink) {
        logoLink.href = `/company-profile.html?companyId=${encodeURIComponent(state.companyId)}`;
      }
    }
  }

  function truncateId(id) {
    if (id.length <= 12) {
      return id;
    }
    return `${id.slice(0, 6)}...${id.slice(-4)}`;
  }

  function setupEventListeners() {
    DOM.btnBack.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = `/agent-console/agent2.html?companyId=${encodeURIComponent(state.companyId)}`;
    });
    
    DOM.btnBackToAgent2.addEventListener('click', () => {
      window.location.href = `/agent-console/agent2.html?companyId=${encodeURIComponent(state.companyId)}`;
    });
    
    DOM.groupSelector.addEventListener('change', handleGroupChange);
    DOM.btnCreateGroup.addEventListener('click', openCreateGroupModal);
    DOM.btnAddTrigger.addEventListener('click', () => openTriggerModal(null));

    // Architecture help toggle
    const btnShowArchHelp = document.getElementById('btn-show-architecture-help');
    const archHelpContent = document.getElementById('architecture-help-content');
    if (btnShowArchHelp && archHelpContent) {
      btnShowArchHelp.addEventListener('click', () => {
        const isVisible = archHelpContent.style.display !== 'none';
        archHelpContent.style.display = isVisible ? 'none' : 'block';
        btnShowArchHelp.textContent = isVisible 
          ? 'ℹ️  How LOCAL vs GLOBAL Triggers Work' 
          : '✕  Close';
      });
    }

    // Test Panel open/close
    if (DOM.btnOpenTestPanel) {
      DOM.btnOpenTestPanel.addEventListener('click', () => {
        if (DOM.triggerTestPanel) {
          DOM.triggerTestPanel.style.display = DOM.triggerTestPanel.style.display === 'none' ? 'block' : 'none';
          if (DOM.triggerTestPanel.style.display === 'block' && DOM.triggerTestInput) {
            DOM.triggerTestInput.focus();
          }
        }
      });
    }
    if (DOM.btnCloseTestPanel) {
      DOM.btnCloseTestPanel.addEventListener('click', () => {
        if (DOM.triggerTestPanel) DOM.triggerTestPanel.style.display = 'none';
      });
    }

    // Run trigger test
    if (DOM.btnRunTriggerTest) {
      DOM.btnRunTriggerTest.addEventListener('click', runTriggerTest);
    }
    if (DOM.triggerTestInput) {
      DOM.triggerTestInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runTriggerTest();
      });
    }

    // Refresh Cache button — flushes the 60-second runtime trigger cache immediately
    if (DOM.btnRefreshCache) {
      DOM.btnRefreshCache.addEventListener('click', async () => {
        const btn = DOM.btnRefreshCache;
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.textContent = 'Refreshing...';
        try {
          const result = await apiFetch(
            `${CONFIG.API_BASE_AGENT2}/${state.companyId}/triggers/refresh`,
            { method: 'POST' }
          );
          btn.textContent = '✓ Cache Cleared';
          btn.style.background = '#dcfce7';
          btn.style.color = '#166534';
          btn.style.borderColor = '#86efac';
          setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.background = '';
            btn.style.color = '';
            btn.style.borderColor = '';
            btn.disabled = false;
          }, 2500);
        } catch (err) {
          btn.textContent = '✗ Failed';
          btn.style.background = '#fee2e2';
          btn.style.color = '#991b1b';
          setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.background = '';
            btn.style.color = '';
            btn.disabled = false;
          }, 2500);
        }
      });
    }
    
    // Health Warning: Fix Unpublished Triggers
    const btnFixUnpublished = document.getElementById('btn-fix-unpublished');
    if (btnFixUnpublished) {
      btnFixUnpublished.addEventListener('click', async () => {
        console.log('');
        console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #3b82f6; font-weight: bold');
        console.log('%c🚀 AUTO-PUBLISH TRIGGERS - CHECKPOINT LOG', 'color: #3b82f6; font-weight: bold; font-size: 14px');
        console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #3b82f6; font-weight: bold');
        console.log('');
        
        console.log('%c✓ [CHECKPOINT 1/6] Button clicked', 'color: #10b981; font-weight: bold');
        console.log('  Timestamp:', new Date().toISOString());
        console.log('  Company ID:', state.companyId);
        
        if (!confirm('This will set state="published" for all local triggers with state=null. Continue?')) {
          console.log('%c❌ Operation cancelled by user', 'color: #94a3b8');
          return;
        }
        
        const btn = btnFixUnpublished;
        const originalText = btn.innerHTML;
        btn.disabled = true;
        
        try {
          // CHECKPOINT 2
          console.log('%c✓ [CHECKPOINT 2/6] User confirmed action', 'color: #10b981; font-weight: bold');
          console.log('  API Base:', CONFIG.API_BASE_COMPANY);
          console.log('  Full URL:', `${CONFIG.API_BASE_COMPANY}/${state.companyId}/triggers/fix-unpublished`);
          
          btn.innerHTML = '📡 Calling API...';
          
          // CHECKPOINT 3
          console.log('%c🌐 [CHECKPOINT 3/6] Sending POST request...', 'color: #3b82f6; font-weight: bold');
          const startTime = performance.now();
          
          const res = await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/triggers/fix-unpublished`, {
            method: 'POST'
          });
          
          const apiDuration = Math.round(performance.now() - startTime);
          
          // CHECKPOINT 4
          console.log('%c✓ [CHECKPOINT 4/6] API Response received', 'color: #10b981; font-weight: bold');
          console.log('  Duration:', apiDuration + 'ms');
          console.log('  Success:', res.success);
          console.log('  Published Count:', res.publishedCount);
          console.log('  Full Response:', res);
          
          if (res.success) {
            btn.innerHTML = `✓ ${res.publishedCount} published`;
            showToast('success', 'Published', `${res.publishedCount} trigger(s) published`);
            
            // CHECKPOINT 5
            btn.innerHTML = '🔄 Refreshing cache...';
            console.log('%c🔄 [CHECKPOINT 5/6] Refreshing runtime cache...', 'color: #f59e0b; font-weight: bold');
            
            try {
              const cacheStart = performance.now();
              const cacheRes = await apiFetch(`${CONFIG.API_BASE_AGENT2}/${state.companyId}/triggers/refresh`, { method: 'POST' });
              const cacheDuration = Math.round(performance.now() - cacheStart);
              console.log('  ✓ Cache refreshed (' + cacheDuration + 'ms)');
              console.log('  Response:', cacheRes);
            } catch (cacheErr) {
              console.warn('%c⚠️  Cache refresh failed (non-critical)', 'color: #f59e0b');
              console.warn('  Error:', cacheErr.message);
            }
            
            // CHECKPOINT 6
            btn.innerHTML = '📥 Reloading data...';
            console.log('%c📥 [CHECKPOINT 6/6] Reloading trigger list from server...', 'color: #8b5cf6; font-weight: bold');
            
            const reloadStart = performance.now();
            await loadTriggers();
            const reloadDuration = Math.round(performance.now() - reloadStart);
            
            console.log('  ✓ Data reloaded (' + reloadDuration + 'ms)');
            console.log('');
            console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #10b981; font-weight: bold');
            console.log('%c🎉 SUCCESS! Auto-Publish Complete', 'color: #10b981; font-weight: bold; font-size: 14px');
            console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #10b981; font-weight: bold');
            console.log('  Total Duration:', Math.round(performance.now() - startTime) + 'ms');
            console.log('  Triggers Published:', res.publishedCount);
            console.log('  Status: All triggers now visible to agent runtime ✅');
            console.log('');
            
            btn.innerHTML = '✅ Complete!';
            showToast('success', 'Complete', 'All done! Check console for details.');
            
            setTimeout(() => {
              btn.innerHTML = originalText;
              btn.disabled = false;
            }, 3000);
          } else {
            console.error('%c❌ API Error', 'color: #ef4444; font-weight: bold');
            console.error('  Error:', res.error);
            console.error('  Full Response:', res);
            showToast('error', 'Failed', res.error || 'API returned error');
            btn.innerHTML = '❌ Failed';
            setTimeout(() => {
              btn.innerHTML = originalText;
              btn.disabled = false;
            }, 3000);
          }
        } catch (err) {
          console.log('');
          console.error('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #ef4444; font-weight: bold');
          console.error('%c💥 CRITICAL ERROR - Auto-Publish Failed', 'color: #ef4444; font-weight: bold; font-size: 14px');
          console.error('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #ef4444; font-weight: bold');
          console.error('');
          console.error('Error Type:', err.constructor.name);
          console.error('Error Message:', err.message);
          console.error('');
          console.error('Full Error Object:', err);
          console.error('Stack Trace:', err.stack);
          console.error('');
          console.error('Attempted URL:', `${CONFIG.API_BASE_COMPANY}/${state.companyId}/triggers/fix-unpublished`);
          console.error('');
          
          showToast('error', 'Error', `Failed: ${err.message || 'Check console for details'}`);
          btn.innerHTML = '❌ Error - Check Console';
          setTimeout(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
          }, 5000);
        }
      });
    }
    
    // Health Warning: Refresh Cache (from warning banner)
    const btnRefreshCacheWarning = document.getElementById('btn-refresh-cache-warning');
    if (btnRefreshCacheWarning) {
      btnRefreshCacheWarning.addEventListener('click', () => {
        if (DOM.btnRefreshCache) DOM.btnRefreshCache.click();
      });
    }
    
    if (DOM.btnNameGreeting) DOM.btnNameGreeting.addEventListener('click', openNameGreetingModal);
    
    // Bulk selection
    if (DOM.selectAllTriggers) {
      DOM.selectAllTriggers.addEventListener('change', handleSelectAll);
    }
    if (DOM.btnClearSelection) {
      DOM.btnClearSelection.addEventListener('click', clearSelection);
    }
    if (DOM.btnBulkDelete) {
      DOM.btnBulkDelete.addEventListener('click', handleBulkDelete);
    }
    if (DOM.modalNameGreetingClose) DOM.modalNameGreetingClose.addEventListener('click', closeNameGreetingModal);
    if (DOM.btnNameGreetingCancel) DOM.btnNameGreetingCancel.addEventListener('click', closeNameGreetingModal);
    if (DOM.btnNameGreetingSave) DOM.btnNameGreetingSave.addEventListener('click', saveNameGreeting);
    if (DOM.modalNameGreeting) {
      DOM.modalNameGreeting.addEventListener('click', (e) => { if (e.target === DOM.modalNameGreeting) closeNameGreetingModal(); });
    }
    if (DOM.btnPatienceSettings) {
      DOM.btnPatienceSettings.addEventListener('click', openPatienceModal);
    }
    if (DOM.modalPatienceClose) DOM.modalPatienceClose.addEventListener('click', closePatienceModal);
    if (DOM.btnPatienceCancel) DOM.btnPatienceCancel.addEventListener('click', closePatienceModal);
    if (DOM.btnPatienceSave) DOM.btnPatienceSave.addEventListener('click', savePatienceSettings);
    if (DOM.modalPatience) {
      DOM.modalPatience.addEventListener('click', (e) => { if (e.target === DOM.modalPatience) closePatienceModal(); });
    }
    // Settings dropdown toggle
    if (DOM.btnSettingsMenu) {
      DOM.btnSettingsMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = DOM.settingsDropdown.style.display === 'block';
        DOM.settingsDropdown.style.display = isOpen ? 'none' : 'block';
      });
    }
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (DOM.settingsDropdown && !e.target.closest('.dropdown')) {
        DOM.settingsDropdown.style.display = 'none';
      }
    });
    
    if (DOM.btnClearAllAudio) {
      DOM.btnClearAllAudio.addEventListener('click', clearAllAudio);
    }
    if (DOM.btnBulkGenerateAudio) {
      DOM.btnBulkGenerateAudio.addEventListener('click', bulkGenerateAudio);
    }
    // Import/Export dropdown menu
    const btnImportExportMenu = document.getElementById('btn-import-export-menu');
    const importExportDropdown = document.getElementById('import-export-dropdown');
    
    if (btnImportExportMenu && importExportDropdown) {
      btnImportExportMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        importExportDropdown.style.display = importExportDropdown.style.display === 'none' ? 'block' : 'none';
      });
      
      // Close dropdown when clicking outside
      document.addEventListener('click', () => {
        importExportDropdown.style.display = 'none';
      });
    }
    
    if (DOM.btnBulkImportTriggers) {
      DOM.btnBulkImportTriggers.addEventListener('click', () => {
        document.getElementById('import-export-dropdown').style.display = 'none';
        openBulkImportModal();
      });
    }
    
    const btnBulkExport = document.getElementById('btn-bulk-export-triggers');
    if (btnBulkExport) {
      btnBulkExport.addEventListener('click', () => {
        document.getElementById('import-export-dropdown').style.display = 'none';
        exportAllTriggers();
      });
    }
    DOM.btnCheckDuplicates.addEventListener('click', checkDuplicates);
    if (DOM.btnFixDuplicates) {
      DOM.btnFixDuplicates.addEventListener('click', checkDuplicates);
    }
    
    DOM.triggerSearch.addEventListener('input', (e) => {
      state.searchQuery = normalizeSearchQuery(e.target.value);
      renderTriggers();
    });
    
    // Scope filter buttons
    [DOM.filterAll, DOM.filterGlobal, DOM.filterLocal].forEach(btn => {
      if (btn) {
        btn.addEventListener('click', (e) => {
          const scope = e.target.dataset.scope;
          state.scopeFilter = scope;
          
          // Update active state
          document.querySelectorAll('.scope-filter-btn').forEach(b => b.classList.remove('active'));
          e.target.classList.add('active');
          
          renderTriggers();
        });
      }
    });
    
    DOM.modalTriggerClose.addEventListener('click', closeTriggerModal);
    DOM.btnTriggerCancel.addEventListener('click', closeTriggerModal);
    DOM.btnTriggerSave.addEventListener('click', saveTrigger);
    
    DOM.modalApprovalClose.addEventListener('click', closeApprovalModal);
    DOM.btnApprovalCancel.addEventListener('click', closeApprovalModal);
    DOM.btnApprovalConfirm.addEventListener('click', confirmApproval);
    
    DOM.modalGroupClose.addEventListener('click', closeCreateGroupModal);
    DOM.btnGroupCancel.addEventListener('click', closeCreateGroupModal);
    DOM.btnGroupCreate.addEventListener('click', createGroup);
    
    if (DOM.modalBulkImportClose) DOM.modalBulkImportClose.addEventListener('click', closeBulkImportModal);
    if (DOM.btnCancelBulkImport) DOM.btnCancelBulkImport.addEventListener('click', closeBulkImportModal);
    if (DOM.btnExecuteBulkImport) DOM.btnExecuteBulkImport.addEventListener('click', executeBulkImport);
    if (DOM.modalBulkImport) {
      DOM.modalBulkImport.addEventListener('click', (e) => { if (e.target === DOM.modalBulkImport) closeBulkImportModal(); });
    }
    // Enable the import button only when the LOCAL-only checkbox is checked
    if (DOM.chkLocalImportConfirm && DOM.btnExecuteBulkImport) {
      DOM.chkLocalImportConfirm.addEventListener('change', () => {
        const confirmed = DOM.chkLocalImportConfirm.checked;
        DOM.btnExecuteBulkImport.disabled = !confirmed;
        DOM.btnExecuteBulkImport.style.opacity = confirmed ? '1' : '0.5';
        DOM.btnExecuteBulkImport.style.cursor  = confirmed ? 'pointer' : 'not-allowed';
      });
    }
    
    // GPT Settings & Prefill
    if (DOM.btnGptSettings) {
      DOM.btnGptSettings.addEventListener('click', openGptSettingsModal);
    }
    if (DOM.btnGptPrefill) {
      DOM.btnGptPrefill.addEventListener('click', gptPrefill);
    }
    if (DOM.modalGptClose) {
      DOM.modalGptClose.addEventListener('click', closeGptSettingsModal);
    }
    if (DOM.btnGptSettingsCancel) {
      DOM.btnGptSettingsCancel.addEventListener('click', closeGptSettingsModal);
    }
    if (DOM.btnGptSettingsSave) {
      DOM.btnGptSettingsSave.addEventListener('click', saveGptSettings);
    }
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeTriggerModal();
        closeApprovalModal();
        closeCreateGroupModal();
        closeGptSettingsModal();
        closeBulkImportModal();
        closePatienceModal();
        closeNameGreetingModal();
      }
    });
    
    // Audio generation and playback
    if (DOM.btnGenerateAudio) {
      DOM.btnGenerateAudio.addEventListener('click', generateTriggerAudio);
    }
    if (DOM.btnPlayAudio) {
      DOM.btnPlayAudio.addEventListener('click', playTriggerAudio);
    }
    
    // Detect text changes to show regeneration warning
    if (DOM.inputTriggerAnswer) {
      DOM.inputTriggerAnswer.addEventListener('input', checkAudioStatus);
    }
    
    // ElevenLabs setup link
    document.addEventListener('click', (e) => {
      if (e.target.id === 'link-elevenlabs-setup' || e.target.closest('#link-elevenlabs-setup')) {
        e.preventDefault();
        window.open(`/company-profile.html?companyId=${encodeURIComponent(state.companyId)}#elevenlabs`, '_blank');
      }
      if (e.target.id === 'link-audio-help' || e.target.closest('#link-audio-help')) {
        e.preventDefault();
        window.open(`/company-profile.html?companyId=${encodeURIComponent(state.companyId)}#elevenlabs`, '_blank');
      }
    });
    
    // Response Mode Toggle (Standard vs LLM Fact Pack)
    if (DOM.responseModeToggle) {
      DOM.responseModeToggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.mode-btn');
        if (!btn) return;
        
        const mode = btn.dataset.mode;
        if (mode === state.currentResponseMode) return;
        
        setResponseMode(mode);
      });
    }
  }
  
  /* --------------------------------------------------------------------------
     FOLLOW-UP ACTION VISIBILITY
     -------------------------------------------------------------------------- */
  function updateFollowupActionVisibility() {
    const hasFollowup = (DOM.inputTriggerFollowup?.value || '').trim().length > 0;
    const consentHint = document.getElementById('followup-consent-hint');
    if (consentHint) {
      consentHint.style.display = hasFollowup ? 'block' : 'none';
    }
  }

  if (DOM.inputTriggerFollowup) {
    DOM.inputTriggerFollowup.addEventListener('input', updateFollowupActionVisibility);
  }

  /* --------------------------------------------------------------------------
     RESPONSE MODE MANAGEMENT
     -------------------------------------------------------------------------- */
  function setResponseMode(mode) {
    state.currentResponseMode = mode;
    
    // Update toggle button states
    const buttons = DOM.responseModeToggle?.querySelectorAll('.mode-btn');
    buttons?.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    // Show/hide appropriate fields
    if (mode === 'standard') {
      if (DOM.responseFieldsStandard) DOM.responseFieldsStandard.style.display = 'block';
      if (DOM.responseFieldsLlm) DOM.responseFieldsLlm.style.display = 'none';
      if (DOM.responseModeHint) {
        DOM.responseModeHint.textContent = 'Standard: Pre-recorded audio or TTS. Uses Answer Text directly.';
      }
    } else {
      if (DOM.responseFieldsStandard) DOM.responseFieldsStandard.style.display = 'none';
      if (DOM.responseFieldsLlm) DOM.responseFieldsLlm.style.display = 'block';
      if (DOM.responseModeHint) {
        DOM.responseModeHint.innerHTML = '<span style="color: #8b5cf6;">LLM Fact Pack: AI generates response from your facts. Always uses live TTS via ElevenLabs.</span>';
      }
    }
  }

  /* --------------------------------------------------------------------------
     TRIGGER TEST PANEL
     -------------------------------------------------------------------------- */
  async function runTriggerTest() {
    const text = DOM.triggerTestInput?.value?.trim();
    if (!text) return;

    const btn = DOM.btnRunTriggerTest;
    if (btn) { btn.disabled = true; btn.textContent = 'Testing...'; }

    try {
      const result = await apiFetch(
        `${CONFIG.API_BASE_AGENT2}/${state.companyId}/triggers/test`,
        { method: 'POST', body: { text } }
      );

      if (DOM.triggerTestResults) DOM.triggerTestResults.style.display = 'block';

      // ScrabEngine output
      if (DOM.testRawInput)        DOM.testRawInput.textContent        = result.input.raw;
      if (DOM.testNormalizedInput) DOM.testNormalizedInput.textContent = result.input.normalized;
      if (DOM.testTransformCount)  DOM.testTransformCount.textContent  = `${result.input.transformations?.length || 0} applied`;
      if (DOM.testScrabTime)       DOM.testScrabTime.textContent       = `${result.input.performance?.totalTimeMs || 0}ms`;

      // Match result
      const matched = result.match.matched;
      if (DOM.testMatchBox) {
        DOM.testMatchBox.style.background = matched ? 'rgba(22,163,74,0.25)' : 'rgba(220,38,38,0.2)';
        DOM.testMatchBox.style.border     = matched ? '1px solid rgba(134,239,172,0.4)' : '1px solid rgba(252,165,165,0.4)';
      }
      if (DOM.testMatchTitle) {
        DOM.testMatchTitle.textContent = matched
          ? `✅ MATCHED: ${result.match.cardLabel || result.match.cardId}`
          : '❌ NO MATCH — fell through to LLM fallback';
      }
      if (DOM.testMatchDetail && matched) {
        const card = result.match.card;
        DOM.testMatchDetail.innerHTML = [
          `<span style="opacity:0.7;">Rule ID:</span> <code style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:3px;">${result.match.cardId}</code>`,
          `<span style="opacity:0.7;">Priority:</span> ${card?.priority ?? '—'}`,
          `<span style="opacity:0.7;">Bucket:</span> <span style="color:#fde68a;">${card?.bucket || 'untagged'}</span>`,
          `<span style="opacity:0.7;">Matched via:</span> <span style="color:#86efac;">${result.match.matchType}</span>`,
          `<span style="opacity:0.7;">Matched on:</span> <code style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:3px;">"${result.match.matchedOn}"</code>`
        ].join(' &nbsp;|&nbsp; ');
      } else if (DOM.testMatchDetail) {
        DOM.testMatchDetail.innerHTML = `<span style="opacity:0.7;">Total pool: ${result.pool.total} triggers</span>`;
      }
      if (DOM.testAnswerText && matched && result.match.card?.answerText) {
        DOM.testAnswerText.style.display = 'block';
        DOM.testAnswerText.textContent = `"${result.match.card.answerText}"`;
      } else if (DOM.testAnswerText) {
        DOM.testAnswerText.style.display = 'none';
      }

      // Pool stats
      if (DOM.testPoolStats) {
        const p = result.pool;
        DOM.testPoolStats.innerHTML = [
          `<strong>${p.total}</strong> total`,
          `<strong>${p.enabled}</strong> enabled`,
          `<strong>${p.negativeBlocked + (p.negativePhraseBlocked||0)}</strong> negative-blocked`,
          p.maxWordsBlocked ? `<strong>${p.maxWordsBlocked}</strong> maxWords-blocked` : null
        ].filter(Boolean).join(' · ');
      }

      // Evaluation trace
      if (DOM.testEvalCount) DOM.testEvalCount.textContent = result.evaluated.length;
      if (DOM.testTrace) {
        DOM.testTrace.innerHTML = result.evaluated.map(e => {
          const icon = e.matched ? '✅' : e.skipped ? '⊘' : '○';
          const color = e.matched ? '#86efac' : e.skipped ? '#94a3b8' : '#cbd5e1';
          const reason = e.skipReason ? ` <span style="color:#fca5a5;">[${e.skipReason}]</span>` : '';
          const hit = e.keywordHit ? ` <span style="color:#fde68a;">kw:"${e.keywordHit}"</span>` : e.phraseHit ? ` <span style="color:#a5f3fc;">ph:"${e.phraseHit}"</span>` : '';
          return `<div style="color:${color};">${icon} P${e.priority} ${e.cardLabel || e.cardId}${reason}${hit}</div>`;
        }).join('');
      }

    } catch (err) {
      if (DOM.triggerTestResults) DOM.triggerTestResults.style.display = 'block';
      if (DOM.testMatchTitle) {
        DOM.testMatchTitle.textContent = '⚠️ Test failed: ' + err.message;
        if (DOM.testMatchBox) DOM.testMatchBox.style.background = 'rgba(234,179,8,0.2)';
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '▶ Test'; }
    }
  }

  /* --------------------------------------------------------------------------
     DATA LOADING
     -------------------------------------------------------------------------- */
  async function loadTriggers() {
    try {
      const data = await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/triggers`);
      
      const companyName = data.companyName;
      const activeGroupId = data.activeGroupId;
      const activeGroupName = data.activeGroupName;
      const triggers = data.triggers || [];
      const stats = data.stats;
      const permissions = data.permissions;
      const availableGroups = data.availableGroups || [];
      const companyVariables = data.companyVariables || {};
      
      state.companyName = companyName;
      state.activeGroupId = activeGroupId;
      state.activeGroupName = activeGroupName;
      state.triggers = triggers;
      state.stats = stats;
      state.permissions = permissions;
      state.availableGroups = availableGroups;
      state.companyVariables = new Map(Object.entries(companyVariables));
      // V131: Strict Trigger System health info
      state.strictTriggerSystem = data.strictTriggerSystem || null;
      buildSearchIndex(state.triggers);
      
      DOM.headerCompanyName.textContent = state.companyName;
      
      // V131: Render health banner if needed
      renderHealthBanner();
      
      // Check for unpublished triggers
      checkTriggerHealth();
      
      renderGroupSelector();
      renderStats();
      renderBucketHealth();
      if (window.BucketManager && typeof BucketManager.setTriggers === 'function') {
        BucketManager.setTriggers(state.triggers);
      }
      renderTriggers();

      // Load agent2 config for Follow-up Consent Cards
      try {
        const configData = await AgentConsoleAuth.apiFetch(`${CONFIG.API_BASE_AGENT2}/${state.companyId}/agent2/config`);
        console.log('[Consent Cards] CONFIG_LOAD — raw response keys:', Object.keys(configData || {}));
        console.log('[Consent Cards] CONFIG_LOAD — has agent2:', !!configData?.agent2);
        console.log('[Consent Cards] CONFIG_LOAD — has discovery:', !!configData?.agent2?.discovery);
        console.log('[Consent Cards] CONFIG_LOAD — has followUpConsent:', !!configData?.agent2?.discovery?.followUpConsent);

        if (configData?.agent2) {
          state.config = configData.agent2;
          loadFollowUpConsent(state.config);

          // Load persisted GPT Prefill settings
          const savedGpt = configData.agent2?.discovery?.gptPrefillSettings;
          if (savedGpt) {
            if (typeof savedGpt.defaultPriority === 'number') state.gptSettings.defaultPriority = savedGpt.defaultPriority;
            if (savedGpt.tone) state.gptSettings.tone = savedGpt.tone;
            if (savedGpt.instructions) state.gptSettings.instructions = savedGpt.instructions;
            if (typeof savedGpt.includeFollowup === 'boolean') state.gptSettings.includeFollowup = savedGpt.includeFollowup;
          }
        } else {
          console.warn('[Consent Cards] CONFIG_LOAD — No agent2 object in response, consent cards will be empty');
        }
      } catch (cfgErr) {
        console.warn('[Triggers] Failed to load agent2 config for consent cards:', cfgErr.message);
      }
      
    } catch (error) {
      console.error('[Triggers] Failed to load:', error);
      showToast('error', 'Load Failed', 'Could not load trigger data.');
    }
  }

  /* --------------------------------------------------------------------------
     RENDERING
     -------------------------------------------------------------------------- */
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TRIGGER HEALTH CHECK - Detects unpublished triggers and empty runtime pool
  // ═══════════════════════════════════════════════════════════════════════════
  async function checkTriggerHealth() {
    const unpublishedBanner = document.getElementById('health-warning-unpublished');
    const emptyPoolBanner = document.getElementById('health-warning-empty-pool');
    
    try {
      // Check for unpublished local triggers
      const healthData = await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/triggers/health`);
      
      // Show unpublished warning if any local triggers have state: null
      if (healthData.unpublishedCount > 0) {
        document.getElementById('unpublished-count').textContent = healthData.unpublishedCount;
        unpublishedBanner.style.display = 'block';
      } else {
        unpublishedBanner.style.display = 'none';
      }
      
      // Show empty pool warning if runtime has 0 triggers
      if (healthData.runtimePoolSize === 0 && state.stats?.local > 0) {
        emptyPoolBanner.style.display = 'block';
      } else {
        emptyPoolBanner.style.display = 'none';
      }
    } catch (error) {
      console.warn('[TriggerHealth] Health check failed:', error);
      // Hide banners if health check fails
      unpublishedBanner.style.display = 'none';
      emptyPoolBanner.style.display = 'none';
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // V131: STRICT TRIGGER SYSTEM - HEALTH BANNER
  // Shows warnings when trigger system has issues or is in legacy mode
  // ═══════════════════════════════════════════════════════════════════════════
  function renderHealthBanner() {
    // Legacy mode removed - new platform only shows critical configuration errors
    const existingBanner = document.getElementById('trigger-health-banner');
    if (existingBanner) existingBanner.remove();
    
    const stsInfo = state.strictTriggerSystem;
    if (!stsInfo || !stsInfo.showHealthBanner) return;
    
    const issues = stsInfo.criticalIssues || [];
    if (issues.length === 0) return;  // No banner if no issues
    
    // Critical errors only (no legacy mode warnings)
    const bannerHtml = `
      <div id="trigger-health-banner" style="
        padding: 12px 16px;
        margin-bottom: 16px;
        border-radius: 8px;
        background: #fef2f2;
        border: 1px solid #fca5a5;
        color: #991b1b;
      ">
        <div style="font-weight: 600; margin-bottom: 4px;">
          🚨 Trigger Configuration Required
        </div>
        <div style="font-size: 13px; line-height: 1.5;">
          ${issues.map(i => `<div>• ${escapeHtml(i.message)}</div>`).join('')}
        </div>
      </div>
    `;
    
    const mainContent = document.querySelector('.triggers-main') || document.querySelector('main');
    if (mainContent) {
      mainContent.insertAdjacentHTML('afterbegin', bannerHtml);
    }
  }
  
  // Legacy mode removed - new platform has no legacy options

  function renderGroupSelector() {
    DOM.groupSelector.innerHTML = '<option value="">— No group selected —</option>';
    
    for (const group of state.availableGroups) {
      const option = document.createElement('option');
      option.value = group.groupId;
      option.textContent = `${group.icon || '📋'} ${group.name}`;
      if (group.groupId === state.activeGroupId) {
        option.selected = true;
      }
      DOM.groupSelector.appendChild(option);
    }
    
    if (state.activeGroupId) {
      const activeGroup = state.availableGroups.find(g => g.groupId === state.activeGroupId);
      if (activeGroup) {
        DOM.groupIcon.textContent = activeGroup.icon || '📋';
        DOM.groupTriggerCount.textContent = `${activeGroup.triggerCount || 0} triggers`;
        DOM.groupInfo.style.display = 'flex';
      }
    } else {
      DOM.groupInfo.style.display = 'none';
    }
  }

  function renderStats() {
    if (!state.stats) {
      return;
    }
    
    DOM.statGlobal.textContent = state.stats.globalEnabledCount || 0;
    DOM.statLocal.textContent = state.stats.localEnabledCount || 0;
    
    // PUBLISHED COUNT: Show how many local triggers are published
    if (DOM.statPublished) {
      const publishedCount = state.stats.localPublishedCount || 0;
      const totalLocal = state.stats.localCount || 0;
      DOM.statPublished.textContent = publishedCount;
      
      // Color code based on health
      if (publishedCount === totalLocal && totalLocal > 0) {
        // All published - green
        DOM.statPublished.style.color = '#10b981';
      } else if (publishedCount === 0 && totalLocal > 0) {
        // None published - red
        DOM.statPublished.style.color = '#ef4444';
      } else if (publishedCount < totalLocal) {
        // Some unpublished - orange
        DOM.statPublished.style.color = '#f59e0b';
      } else {
        // Default
        DOM.statPublished.style.color = '';
      }
    }
    
    DOM.statOverrides.textContent = state.stats.overrideCount || 0;
    DOM.statTotal.textContent = state.stats.totalActiveCount || 0;
    
    if (DOM.statDisabled) {
      DOM.statDisabled.textContent = state.stats.totalDisabledCount || 0;
    }
    
    console.log('[Triggers] Stats updated:', state.stats);
  }

  function updateBuckets(buckets, cacheInfo) {
    state.buckets = Array.isArray(buckets) ? buckets : [];
    state.bucketCacheInfo = cacheInfo || null;
    state.bucketIndex = new Map();
    state.buckets.forEach(b => {
      if (b && b.key) {
        state.bucketIndex.set(b.key, b.name || b.key);
      }
    });
    buildSearchIndex(state.triggers || []);
    renderBucketHealth();
    if (window.BucketManager && typeof BucketManager.setTriggers === 'function') {
      BucketManager.setTriggers(state.triggers);
    }
    if (DOM.modalTriggerEdit?.classList.contains('active')) {
      populateBucketDropdown(state.editingTrigger?.bucket || '');
    }
    renderTriggers();
  }

  function renderBucketHealth() {
    if (!DOM.bucketHealthBuckets) return;

    const totalBuckets = state.buckets.length;
    const bucketsWithKeywords = state.buckets.filter(b => (b.keywords || []).length > 0).length;
    const totalTriggers = (state.triggers || []).length;
    const taggedTriggers = (state.triggers || []).filter(t => {
      const key = `${t.bucket || ''}`.trim();
      return key && state.bucketIndex.has(key);
    }).length;
    const untaggedTriggers = totalTriggers - taggedTriggers;

    const keywordPct = totalBuckets ? Math.round((bucketsWithKeywords / totalBuckets) * 100) : 0;
    const coveragePct = totalTriggers ? Math.round((taggedTriggers / totalTriggers) * 100) : 0;

    DOM.bucketHealthBuckets.textContent = `Buckets: ${totalBuckets}`;
    DOM.bucketHealthKeywords.textContent = `Keywords: ${keywordPct}%`;
    DOM.bucketHealthCoverage.textContent = `Tagged: ${coveragePct}%`;

    if (DOM.bucketHealthRuntime) {
      DOM.bucketHealthRuntime.textContent = `${untaggedTriggers} untagged / ${totalBuckets} buckets`;
    }
  }

  function getBucketLabel(bucketKey) {
    if (!bucketKey) return '';
    return state.bucketIndex.get(bucketKey) || bucketKey;
  }

  function populateBucketDropdown(selectedKey) {
    const bucketEl = document.getElementById('input-trigger-bucket');
    if (!bucketEl) return;

    const buckets = state.buckets || [];
    bucketEl.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = buckets.length > 0 ? '— Unassigned —' : '— No buckets yet —';
    bucketEl.appendChild(placeholder);

    buckets.forEach(b => {
      const option = document.createElement('option');
      option.value = b.key;
      option.textContent = b.name || b.key;
      bucketEl.appendChild(option);
    });

    const effectiveKey = selectedKey && state.bucketIndex.has(selectedKey) ? selectedKey : '';
    bucketEl.value = effectiveKey;
  }

  function renderTriggers() {
    const filtered = state.triggers.filter(t => {
      // Apply scope filter
      if (state.scopeFilter === 'global' && t.scope !== 'GLOBAL') {
        return false;
      }
      if (state.scopeFilter === 'local' && t.scope !== 'LOCAL') {
        return false;
      }
      
      // Apply search filter — full-text index across trigger payload
      return matchesSearchQuery(t, state.searchQuery);
    });
    
    if (filtered.length === 0) {
      DOM.triggerList.innerHTML = '';
      DOM.emptyState.style.display = 'flex';
      if (DOM.triggerTableHeader) {
        DOM.triggerTableHeader.style.display = 'none';
      }
      return;
    }
    
    DOM.emptyState.style.display = 'none';
    if (DOM.triggerTableHeader) {
      DOM.triggerTableHeader.style.display = 'grid';
    }
    DOM.triggerList.innerHTML = filtered.map(renderTriggerRow).join('');
    
    DOM.triggerList.querySelectorAll('.btn-edit-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        const triggerId = btn.dataset.triggerId;
        const trigger = state.triggers.find(t => t.triggerId === triggerId);
        if (trigger) {
          openTriggerModal(trigger);
        }
      });
    });
    
    DOM.triggerList.querySelectorAll('.btn-delete-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        const triggerId = btn.dataset.triggerId;
        const trigger = state.triggers.find(t => t.triggerId === triggerId);
        if (trigger) {
          confirmDeleteTrigger(trigger);
        }
      });
    });
    
    // Checkbox selection handlers
    DOM.triggerList.querySelectorAll('.trigger-select-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const triggerId = e.target.dataset.triggerId;
        
        if (e.target.checked) {
          state.selectedTriggerIds.add(triggerId);
        } else {
          state.selectedTriggerIds.delete(triggerId);
        }
        
        updateBulkActionsBar();
        renderTriggers();
      });
    });
    
    DOM.triggerList.querySelectorAll('.toggle-enabled').forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        const triggerId = e.target.dataset.triggerId;
        const scope = e.target.dataset.scope;
        const enabled = e.target.checked;
        const checkbox = e.target;
        
        checkbox.checked = !enabled;
        
        const trigger = state.triggers.find(t => t.triggerId === triggerId);
        confirmToggleTrigger(trigger, enabled, checkbox);
      });
    });
    
    DOM.triggerList.querySelectorAll('.toggle-scope').forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        const triggerId = e.target.dataset.triggerId;
        const newIsGlobal = e.target.checked;
        const checkbox = e.target;
        
        checkbox.checked = !newIsGlobal;
        
        const trigger = state.triggers.find(t => t.triggerId === triggerId);
        confirmToggleScope(trigger, newIsGlobal, checkbox);
      });
    });
    
    extractAndRenderVariables();

    // Deep-link focus (scroll + highlight) after render
    applyFocusIfNeeded();
    applyEditIfNeeded();
  }

  function applyFocusIfNeeded() {
    if (!state.focusId) return;
    const el = document.getElementById(state.focusId);
    if (!el) {
      showToast('warning', 'Focus Not Found', `Could not find ${state.focusId} on this page (it may be filtered or deleted).`);
      state.focusId = null;
      return;
    }

    // Scroll and highlight
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      el.scrollIntoView();
    }
    el.classList.add('focused-trigger');
    setTimeout(() => el.classList.remove('focused-trigger'), 4500);

    // One-shot
    state.focusId = null;
  }

  function applyEditIfNeeded() {
    if (!state.editTriggerId) return;
    const trigger = state.triggers.find(t =>
      t.triggerId === state.editTriggerId ||
      t.ruleId === state.editTriggerId
    );
    if (!trigger) {
      showToast('warning', 'Edit Target Not Found', `Could not find trigger ${state.editTriggerId}.`);
      state.editTriggerId = null;
      state.editField = null;
      return;
    }

    openTriggerModal(trigger);
    const field = state.editField || 'answerText';
    setTimeout(() => {
      const fieldMap = {
        answerText: DOM.inputTriggerAnswer,
        followUpQuestion: DOM.inputTriggerFollowup,
        keywords: DOM.inputTriggerKeywords,
        phrases: DOM.inputTriggerPhrases,
        negativeKeywords: DOM.inputTriggerNegative,
        label: DOM.inputTriggerLabel
      };
      const el = fieldMap[field];
      if (el && typeof el.focus === 'function') el.focus();
    }, 0);

    state.editTriggerId = null;
    state.editField = null;
  }
  
  function extractVariablesFromText(text) {
    if (!text) return [];
    const regex = /\{(\w+)\}/g;
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push(match[1]);
    }
    return matches;
  }
  
  const RUNTIME_VARIABLES = new Set(['name']);
  const RUNTIME_VARIABLE_INFO = {
    name: 'Auto-filled from ScrabEngine caller name extraction. Leave empty for auto, or type a static override.'
  };
  
  function extractAndRenderVariables() {
    state.detectedVariables.clear();
    
    for (const trigger of state.triggers) {
      const answerText = trigger.answer?.answerText || '';
      const followUpQuestion = trigger.followUp?.question || '';
      
      // LLM trigger fields (fact packs and backup answer)
      const includedFacts = trigger.llmFactPack?.includedFacts || '';
      const excludedFacts = trigger.llmFactPack?.excludedFacts || '';
      const backupAnswer = trigger.llmFactPack?.backupAnswer || '';
      
      const answerVars = extractVariablesFromText(answerText);
      const followUpVars = extractVariablesFromText(followUpQuestion);
      const includedVars = extractVariablesFromText(includedFacts);
      const excludedVars = extractVariablesFromText(excludedFacts);
      const backupVars = extractVariablesFromText(backupAnswer);
      
      [...answerVars, ...followUpVars, ...includedVars, ...excludedVars, ...backupVars]
        .forEach(v => state.detectedVariables.add(v));
    }
    
    renderVariables();
  }
  
  function renderVariables() {
    if (state.detectedVariables.size === 0) {
      DOM.variablesCard.style.display = 'none';
      return;
    }
    
    DOM.variablesCard.style.display = 'block';
    DOM.variablesEmpty.style.display = 'none';
    
    const sortedVars = Array.from(state.detectedVariables).sort();
    
    DOM.variablesTableBody.innerHTML = sortedVars.map(varName => {
      const isRuntime = RUNTIME_VARIABLES.has(varName);
      const value = state.companyVariables.get(varName) || '';
      const hasValue = value.trim().length > 0;
      
      if (isRuntime) {
        const runtimeSource = RUNTIME_VARIABLE_INFO[varName] || 'Resolved at call time';
        return `
          <tr style="border-bottom: 1px solid #e5e7eb; background: #f0fdf4;">
            <td style="padding: 12px 16px;">
              <code style="background: #dcfce7; padding: 4px 8px; border-radius: 4px; color: #166534; font-weight: 600; font-size: 0.875rem;">{${escapeHtml(varName)}}</code>
            </td>
            <td style="padding: 12px 16px;">
              <input 
                type="text" 
                class="form-input variable-input" 
                data-variable="${escapeHtml(varName)}"
                value="${escapeHtml(value)}"
                placeholder="Leave empty for auto, or type override..."
                style="margin: 0; border-color: #86efac; background: #f0fdf4;"
              />
              <div style="font-size: 11px; color: #15803d; margin-top: 4px;">${escapeHtml(runtimeSource)}</div>
            </td>
            <td style="padding: 12px 16px;">
              <span style="color: #166534; font-weight: 600; font-size: 0.875rem;">${hasValue ? '✅ Override' : '⚡ Auto'}</span>
            </td>
          </tr>
        `;
      }
      
      const statusColor = hasValue ? '#16a34a' : '#dc2626';
      const statusText = hasValue ? '✅ Set' : '🔴 Required';
      const varColor = hasValue ? '#111827' : '#dc2626';
      
      return `
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 12px 16px;">
            <code style="background: #f3f4f6; padding: 4px 8px; border-radius: 4px; color: ${varColor}; font-weight: 600; font-size: 0.875rem;">{${escapeHtml(varName)}}</code>
          </td>
          <td style="padding: 12px 16px;">
            <input 
              type="text" 
              class="form-input variable-input" 
              data-variable="${escapeHtml(varName)}"
              value="${escapeHtml(value)}"
              placeholder="Enter value..."
              style="margin: 0; ${!hasValue ? 'border-color: #dc2626; background: #fef2f2;' : ''}"
            />
          </td>
          <td style="padding: 12px 16px;">
            <span style="color: ${statusColor}; font-weight: 600; font-size: 0.875rem;">${statusText}</span>
          </td>
        </tr>
      `;
    }).join('');
    
    // Use event delegation to handle dynamically rendered inputs
    DOM.variablesTableBody.removeEventListener('change', handleVariableChange);
    DOM.variablesTableBody.removeEventListener('blur', handleVariableBlur);
    DOM.variablesTableBody.addEventListener('change', handleVariableChange);
    DOM.variablesTableBody.addEventListener('blur', handleVariableBlur, true);
  }
  
  function handleVariableChange(e) {
    if (e.target.classList.contains('variable-input')) {
      const varName = e.target.dataset.variable;
      const value = e.target.value.trim();
      console.log('[Variables] Change event:', varName, '=', value);
      saveVariable(varName, value);
    }
  }
  
  function handleVariableBlur(e) {
    if (e.target.classList.contains('variable-input')) {
      const varName = e.target.dataset.variable;
      const value = e.target.value.trim();
      console.log('[Variables] Blur event:', varName, '=', value);
      saveVariable(varName, value);
    }
  }
  
  async function saveVariable(varName, value) {
    console.log('[Variables] Saving:', varName, '=', value);
    
    try {
      state.companyVariables.set(varName, value);
      
      const varsToSave = Object.fromEntries(state.companyVariables);
      console.log('[Variables] Sending to API:', varsToSave);
      
      const result = await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/variables`, {
        method: 'PUT',
        body: { 
          variables: varsToSave
        }
      });
      
      console.log('[Variables] Save result:', result);
      
      renderVariables();
      
      // Check if audio was invalidated due to variable change
      if (result.audioInvalidated && result.invalidatedRuleIds?.length > 0) {
        showToast('warning', 'Audio Needs Regeneration', 
          `${result.invalidatedRuleIds.length} trigger(s) use {${varName}} and need audio regenerated`);
        
        // Refresh triggers list to update audio status indicators
        await loadTriggers();
      } else {
        showToast('success', 'Variable Saved', `{${varName}} = ${value}`);
      }
      
    } catch (error) {
      console.error('[Variables] Save failed:', error);
      showToast('error', 'Save Failed', 'Could not save variable.');
    }
  }

  function renderTriggerRow(trigger) {
    const keywords = (trigger.match?.keywords || []).slice(0, 4).join(', ');
    const isLlmMode = trigger.responseMode === 'llm';
    const hasText = !isLlmMode && trigger.answer?.answerText ? true : false;
    const hasAudio = !isLlmMode && (trigger.answer?.hasAudio || trigger.answer?.audioUrl);
    const audioNeedsRegeneration = !isLlmMode && trigger.answer?.audioNeedsRegeneration;
    const isEnabled = trigger.isEnabled !== false;
    const isGlobalScope = trigger.scope === 'GLOBAL';
    
    const priority = trigger.priority || 50;
    const priorityLabel = getPriorityLabel(priority);
    const priorityClass = getPriorityClass(priority);
    
    const displayId = trigger.displayId ? `#${String(trigger.displayId).padStart(2, '0')}` : '—';
    
    const followUpAction = trigger.followUp?.nextAction || trigger.followUp?.question;
    const followUpDisplay = followUpAction ? formatFollowUpAction(followUpAction) : 'None';
    const followUpClass = followUpAction ? '' : 'none';
    
    // Build answer format badges
    const hasFollowUp = !!(trigger.followUp?.question || '').trim();
    
    // PUBLISH STATUS: Check if trigger is published (for LOCAL triggers only)
    const isLocalTrigger = trigger.scope === 'LOCAL';
    const isPublished = trigger.state === 'published';
    const isDraft = trigger.state === 'draft';
    const isUnpublished = !trigger.state || trigger.state === null;
    const bucketKey = `${trigger.bucket || ''}`.trim();
    const hasBucket = !!(bucketKey && state.bucketIndex.has(bucketKey));
    const bucketLabel = hasBucket ? getBucketLabel(bucketKey) : (bucketKey || 'Unassigned');
    
    let publishStatusHtml = '';
    if (isLocalTrigger) {
      if (isPublished) {
        publishStatusHtml = `
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="margin-right: 4px; flex-shrink: 0;" title="Published - Visible to agent runtime">
            <circle cx="7" cy="7" r="6.5" fill="#10b981" stroke="#059669" stroke-width="1"/>
            <path d="M4 7l2 2 4-4" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        `;
      } else if (isDraft) {
        publishStatusHtml = `
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="margin-right: 4px; flex-shrink: 0;" title="Draft - Not visible to agent">
            <circle cx="7" cy="7" r="6.5" fill="#f59e0b" stroke="#d97706" stroke-width="1"/>
            <path d="M7 4v3M7 10h.01" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        `;
      } else {
        publishStatusHtml = `
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="margin-right: 4px; flex-shrink: 0;" title="⚠️ UNPUBLISHED - Agent CANNOT see this trigger!">
            <circle cx="7" cy="7" r="6.5" fill="#ef4444" stroke="#dc2626" stroke-width="1"/>
            <path d="M7 4v3M7 10h.01" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        `;
      }
    }
    const bucketTitle = hasBucket
      ? `Bucketed: ${bucketLabel}`
      : (bucketKey ? `Missing bucket: ${bucketLabel}` : 'Unassigned bucket');
    const bucketStatusHtml = hasBucket
      ? `
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="margin-right: 4px; flex-shrink: 0;" title="${escapeHtml(bucketTitle)}">
            <circle cx="7" cy="7" r="6.5" fill="#10b981" stroke="#059669" stroke-width="1"/>
            <path d="M4 7l2 2 4-4" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        `
      : `
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="margin-right: 4px; flex-shrink: 0;" title="${escapeHtml(bucketTitle)}">
            <circle cx="7" cy="7" r="6.5" fill="#ef4444" stroke="#dc2626" stroke-width="1"/>
            <path d="M4.5 4.5l5 5M9.5 4.5l-5 5" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        `;
    let answerBadges = '';
    if (isLlmMode) {
      answerBadges = '<span class="answer-badge llm" title="LLM Fact Pack - AI-generated responses">LLM</span>';
    } else {
      if (hasText) answerBadges += '<span class="answer-badge text">TEXT</span>';
      if (hasAudio) answerBadges += '<span class="answer-badge audio">AUDIO</span>';
      if (audioNeedsRegeneration) answerBadges += '<span class="answer-badge stale" title="Variable value changed - regenerate audio">⚠️ STALE</span>';
      if (!hasText && !hasAudio && !audioNeedsRegeneration) answerBadges = '<span style="color: var(--text-muted);">—</span>';
    }
    if (hasFollowUp) answerBadges += '<span class="answer-badge follow" title="Has follow-up question (consent gate active)">FOLLOW</span>';
    
    const isSelected = state.selectedTriggerIds.has(trigger.triggerId);
    
    return `
      <div class="trigger-row ${isEnabled ? '' : 'disabled'} ${isSelected ? 'selected' : ''}" id="trigger-${escapeHtml(trigger.triggerId)}" data-trigger-id="${escapeHtml(trigger.triggerId)}">
        <div style="display: flex; align-items: center; justify-content: center;">
          <input type="checkbox" 
                 class="trigger-select-checkbox" 
                 data-trigger-id="${trigger.triggerId}"
                 ${isSelected ? 'checked' : ''}
                 title="Select for bulk action">
        </div>
        <div style="display: flex; align-items: center; justify-content: center;">
          ${publishStatusHtml}
        </div>
        <div style="display: flex; align-items: center; justify-content: center;">
          ${bucketStatusHtml}
        </div>
        <div>
          <span class="trigger-priority ${priorityClass}">${priorityLabel}</span>
        </div>
        <div class="trigger-displayid" title="Trigger ${displayId} (${escapeHtml(trigger.ruleId || '')})" style="font-family: monospace; font-size: 12px; font-weight: 600; color: #6b21a8;">${displayId}</div>
        <div class="trigger-label" title="${escapeHtml(trigger.label || 'Untitled')}">${escapeHtml(trigger.label || 'Untitled')}</div>
        <div class="trigger-keywords" title="${escapeHtml((trigger.match?.keywords || []).join(', '))}">${escapeHtml(keywords) || '—'}</div>
        <div class="answer-format">${answerBadges}</div>
        <div class="trigger-followup ${followUpClass}" title="${escapeHtml(followUpDisplay)}">${escapeHtml(followUpDisplay)}</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <label class="toggle-switch" title="${isGlobalScope ? 'Global - Click to make local' : 'Local - Click to make global'}">
            <input type="checkbox" class="toggle-scope" 
                   data-trigger-id="${trigger.triggerId}"
                   ${isGlobalScope ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
          <span style="font-size: 10px; font-weight: 600; color: ${isGlobalScope ? '#1d4ed8' : '#16a34a'}; min-width: 45px;">
            ${isGlobalScope ? 'GLOBAL' : 'LOCAL'}
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <label class="toggle-switch" title="${isEnabled ? 'Enabled - Click to disable' : 'Disabled - Click to enable'}">
            <input type="checkbox" class="toggle-enabled" 
                   data-trigger-id="${trigger.triggerId}" 
                   data-scope="${trigger.scope}"
                   ${isEnabled ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
          <span style="font-size: 11px; font-weight: 600; color: ${isEnabled ? '#10b981' : '#94a3b8'}; min-width: 28px;">
            ${isEnabled ? 'ON' : 'OFF'}
          </span>
        </div>
        <div class="trigger-actions">
          <button class="btn btn-ghost btn-icon btn-edit-trigger" data-trigger-id="${trigger.triggerId}" title="Edit">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M11.333 2A1.886 1.886 0 0 1 14 4.667l-9 9-3.667 1 1-3.667 9-9Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="btn btn-ghost btn-icon btn-delete-trigger" data-trigger-id="${trigger.triggerId}" title="Delete">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 0 1 1.334-1.334h2.666a1.333 1.333 0 0 1 1.334 1.334V4m2 0v9.333a1.333 1.333 0 0 1-1.334 1.334H4.667a1.333 1.333 0 0 1-1.334-1.334V4h9.334Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  function getPriorityLabel(priority) {
    if (priority <= 20) return 'P1';
    if (priority <= 40) return 'P2';
    if (priority <= 60) return 'P3';
    if (priority <= 80) return 'P4';
    return 'P5';
  }

  function getPriorityClass(priority) {
    if (priority <= 20) return 'p1';
    if (priority <= 40) return 'p2';
    return 'p3';
  }

  function formatFollowUpAction(action) {
    if (!action) return 'None';
    
    const actionMap = {
      'ask_location': 'Ask Location',
      'check_schedule': 'Check Schedule',
      'ask_model': 'Ask Model',
      'book_appointment': 'Book Appt',
      'transfer_agent': 'Transfer',
      'end_call': 'End Call',
      'none': 'None'
    };
    
    const lowerAction = action.toLowerCase().replace(/\s+/g, '_');
    if (actionMap[lowerAction]) {
      return actionMap[lowerAction];
    }
    
    if (action.length > 20) {
      return action.substring(0, 18) + '...';
    }
    
    return action;
  }

  /* --------------------------------------------------------------------------
     GROUP MANAGEMENT
     -------------------------------------------------------------------------- */
  async function handleGroupChange(e) {
    const newGroupId = e.target.value || null;
    const previousGroupId = state.activeGroupId;
    
    // If there was a previous group, require confirmation
    if (previousGroupId && previousGroupId !== newGroupId) {
      const previousGroupName = state.availableGroups.find(g => g.groupId === previousGroupId)?.name || previousGroupId;
      const newGroupName = newGroupId ? (state.availableGroups.find(g => g.groupId === newGroupId)?.name || newGroupId) : 'None';
      
      state.pendingApproval = {
        action: 'changeGroup',
        newGroupId,
        previousGroupId,
        newGroupName,
        previousGroupName
      };
      
      DOM.approvalTitle.textContent = 'Change Trigger Group';
      DOM.approvalText.innerHTML = `
        <strong>Warning: Changing trigger groups affects live calls!</strong><br><br>
        Current group: <strong>${escapeHtml(previousGroupName)}</strong><br>
        New group: <strong>${newGroupId ? escapeHtml(newGroupName) : 'None (no triggers)'}</strong><br><br>
        This will immediately change which triggers are available to callers. All disabled triggers will be reset.
        <br><br>
        <span style="color: var(--text-muted); font-size: 0.875rem;">Note: This setting is locked once set. Contact admin to change.</span>
      `;
      updateApprovalHint('Yes');
      DOM.inputApproval.value = '';
      DOM.modalApproval.classList.add('active');
      DOM.inputApproval.focus();
      
      // Reset dropdown to previous value until confirmed
      DOM.groupSelector.value = previousGroupId;
      return;
    }
    
    // No previous group, allow change without confirmation
    try {
      await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/active-group`, {
        method: 'PUT',
        body: { groupId: newGroupId }
      });
      
      showToast('success', 'Group Selected', newGroupId ? `Now using "${newGroupId}" triggers` : 'No group selected');
      await loadTriggers();
      
    } catch (error) {
      console.error('[Triggers] Failed to change group:', error);
      showToast('error', 'Failed', 'Could not change trigger group.');
      DOM.groupSelector.value = state.activeGroupId || '';
    }
  }

  function openCreateGroupModal() {
    if (!state.permissions?.canCreateGroup) {
      showToast('error', 'Permission Denied', 'You do not have permission to create global groups.');
      return;
    }
    
    DOM.inputGroupId.value = '';
    DOM.inputGroupName.value = '';
    DOM.inputGroupIcon.value = '📋';
    DOM.inputGroupDescription.value = '';
    DOM.modalCreateGroup.classList.add('active');
  }

  function closeCreateGroupModal() {
    DOM.modalCreateGroup.classList.remove('active');
  }

  async function createGroup() {
    const groupId = DOM.inputGroupId.value.trim().toLowerCase();
    const name = DOM.inputGroupName.value.trim();
    const icon = DOM.inputGroupIcon.value.trim() || '📋';
    const description = DOM.inputGroupDescription.value.trim();
    
    if (!groupId || !name) {
      showToast('error', 'Validation Error', 'Group ID and Name are required.');
      return;
    }
    
    if (!/^[a-z0-9_-]+$/.test(groupId)) {
      showToast('error', 'Invalid Group ID', 'Use lowercase letters, numbers, hyphens, underscores only.');
      return;
    }
    
    // Require confirmation
    const confirmation = prompt('⚠️ WARNING: You are creating a GLOBAL TRIGGER GROUP (not a trigger).\n\nType "yes global" to confirm:');
    if (!confirmation || confirmation.toLowerCase().trim() !== 'yes global') {
      showToast('warning', 'Cancelled', 'Group creation cancelled.');
      return;
    }
    
    try {
      await apiFetch(`${CONFIG.API_BASE_GLOBAL}/trigger-groups`, {
        method: 'POST',
        body: { groupId, name, icon, description }
      });
      
      showToast('success', 'Group Created', `"${name}" is now available.`);
      closeCreateGroupModal();
      await loadTriggers();
      
    } catch (error) {
      console.error('[Triggers] Failed to create group:', error);
      showToast('error', 'Failed', error.message || 'Could not create group.');
    }
  }

  /* --------------------------------------------------------------------------
     TRIGGER MANAGEMENT
     -------------------------------------------------------------------------- */
  function openTriggerModal(trigger) {
    state.editingTrigger = trigger;
    
    if (trigger) {
      DOM.modalTriggerTitle.textContent = 'Edit Trigger';
      DOM.inputTriggerLabel.value = trigger.label || '';
      DOM.inputTriggerRuleId.value = trigger.ruleId || '';
      DOM.inputTriggerRuleId.disabled = true;
      DOM.inputTriggerPriority.value = trigger.priority || 50;
      DOM.inputTriggerKeywords.value = (trigger.match?.keywords || []).join(', ');
      DOM.inputTriggerPhrases.value = (trigger.match?.phrases || []).join(', ');
      DOM.inputTriggerNegative.value = (trigger.match?.negativeKeywords || []).join(', ');
      DOM.inputTriggerAnswer.value = trigger.answer?.answerText || '';
      DOM.inputTriggerAudio.value = trigger.answer?.audioUrl || '';
      DOM.inputTriggerFollowup.value = trigger.followUp?.question || '';
      // Populate bucket
      populateBucketDropdown(trigger.bucket || '');
      // Populate maxInputWords
      const maxWordsEl = document.getElementById('input-trigger-max-words');
      if (maxWordsEl) maxWordsEl.value = trigger.maxInputWords || '';
      // Populate negativePhrases
      const negPhrasesEl = document.getElementById('input-trigger-negative-phrases');
      if (negPhrasesEl) negPhrasesEl.value = (trigger.match?.negativePhrases || trigger.negativePhrases || []).join(', ');
      updateFollowupActionVisibility();
      DOM.scopeSection.style.display = 'none';
      
      // Set response mode (standard or llm)
      const responseMode = trigger.responseMode || 'standard';
      setResponseMode(responseMode);
      
      // Populate LLM fields if in LLM mode
      if (DOM.inputLlmIncluded) {
        DOM.inputLlmIncluded.value = trigger.llmFactPack?.includedFacts || '';
      }
      if (DOM.inputLlmExcluded) {
        DOM.inputLlmExcluded.value = trigger.llmFactPack?.excludedFacts || '';
      }
      if (DOM.inputLlmBackup) {
        DOM.inputLlmBackup.value = trigger.llmFactPack?.backupAnswer || '';
      }
      
      // Show audio status based on whether audio needs regeneration (only for standard mode)
      if (DOM.audioStatusHint) {
        if (responseMode === 'llm') {
          DOM.audioStatusHint.innerHTML = '<span style="color: #8b5cf6;">LLM mode — no pre-recorded audio. Responses are always live TTS.</span>';
        } else if (trigger.answer?.audioNeedsRegeneration) {
          DOM.audioStatusHint.innerHTML = '<span style="color: #dc2626;">⚠️ <strong>Variable value changed</strong> — audio is outdated, please regenerate!</span>';
        } else if (trigger.answer?.audioUrl) {
          DOM.audioStatusHint.innerHTML = '<span style="color: #16a34a;">✅ Audio generated! Click Save to keep it.</span>';
        } else {
          DOM.audioStatusHint.innerHTML = '';
        }
      }
      
      // Update generate button text
      if (DOM.btnGenerateAudio) {
        DOM.btnGenerateAudio.textContent = trigger.answer?.audioUrl || trigger.answer?.audioNeedsRegeneration ? 'Regenerate' : 'Generate MP3';
      }
      
      // Show/hide play button based on audio availability
      if (DOM.btnPlayAudio) {
        DOM.btnPlayAudio.style.display = trigger.answer?.audioUrl ? 'block' : 'none';
      }
    } else {
      DOM.modalTriggerTitle.textContent = 'Add Trigger';
      DOM.inputTriggerLabel.value = '';
      DOM.inputTriggerRuleId.value = '';
      DOM.inputTriggerRuleId.disabled = false;
      DOM.inputTriggerPriority.value = 50;
      DOM.inputTriggerKeywords.value = '';
      DOM.inputTriggerPhrases.value = '';
      DOM.inputTriggerNegative.value = '';
      DOM.inputTriggerAnswer.value = '';
      DOM.inputTriggerAudio.value = '';
      DOM.inputTriggerFollowup.value = '';
      updateFollowupActionVisibility();
      DOM.inputTriggerLocal.checked = true;
      DOM.scopeSection.style.display = 'block';
      
      // ═══════════════════════════════════════════════════════════════════════
      // STRICT TRIGGER SYSTEM - ISOMORPHIC FIELD CLEARING
      // All fields that exist in schema MUST be cleared for new triggers.
      // ═══════════════════════════════════════════════════════════════════════
      // Clear bucket, maxInputWords, negativePhrases (Added V131)
      populateBucketDropdown('');
      const maxWordsElNew = document.getElementById('input-trigger-max-words');
      if (maxWordsElNew) maxWordsElNew.value = '';
      const negPhrasesElNew = document.getElementById('input-trigger-negative-phrases');
      if (negPhrasesElNew) negPhrasesElNew.value = '';
      // Default to standard mode for new triggers
      setResponseMode('standard');
      
      // Clear LLM fields
      if (DOM.inputLlmIncluded) DOM.inputLlmIncluded.value = '';
      if (DOM.inputLlmExcluded) DOM.inputLlmExcluded.value = '';
      if (DOM.inputLlmBackup) DOM.inputLlmBackup.value = '';
      
      // Reset audio status for new triggers
      if (DOM.audioStatusHint) {
        DOM.audioStatusHint.innerHTML = '';
      }
      if (DOM.btnGenerateAudio) {
        DOM.btnGenerateAudio.textContent = 'Generate MP3';
      }
      if (DOM.btnPlayAudio) {
        DOM.btnPlayAudio.style.display = 'none';
      }
    }
    
    DOM.modalTriggerEdit.classList.add('active');
    DOM.inputTriggerLabel.focus();
  }

  function closeTriggerModal() {
    DOM.modalTriggerEdit.classList.remove('active');
    state.editingTrigger = null;
  }

  async function saveTrigger() {
    const label = DOM.inputTriggerLabel.value.trim();
    const ruleId = DOM.inputTriggerRuleId.value.trim().toLowerCase();
    const priority = parseInt(DOM.inputTriggerPriority.value, 10) || 50;
    const keywords = parseCommaSeparated(DOM.inputTriggerKeywords.value);
    const phrases = parseCommaSeparated(DOM.inputTriggerPhrases.value);
    const negativeKeywords = parseCommaSeparated(DOM.inputTriggerNegative.value);
    const followUpQuestion = DOM.inputTriggerFollowup.value.trim();
    
    // Get response mode and mode-specific fields
    const responseMode = state.currentResponseMode || 'standard';
    
    let answerText = '';
    let audioUrl = '';
    let llmFactPack = null;
    
    if (responseMode === 'standard') {
      answerText = DOM.inputTriggerAnswer?.value?.trim() || '';
      audioUrl = DOM.inputTriggerAudio?.value?.trim() || '';
      
      if (!answerText) {
        showToast('error', 'Validation Error', 'Answer Text is required for Standard mode.');
        return;
      }
    } else {
      // LLM mode
      const includedFacts = DOM.inputLlmIncluded?.value?.trim() || '';
      const excludedFacts = DOM.inputLlmExcluded?.value?.trim() || '';
      const backupAnswer = DOM.inputLlmBackup?.value?.trim() || '';
      
      if (!includedFacts && !excludedFacts) {
        showToast('error', 'Validation Error', 'LLM mode requires at least one fact pack (Included or Excluded).');
        return;
      }
      
      // Validate backup answer is provided
      if (!backupAnswer) {
        showToast('error', 'Validation Error', 'Backup Answer is required for LLM mode (used when OpenAI fails).');
        return;
      }
      
      llmFactPack = {
        includedFacts,
        excludedFacts,
        backupAnswer
      };
      
      // Set a placeholder answerText for LLM triggers (used for display purposes)
      answerText = '[LLM-generated response based on fact pack]';
    }
    
    if (!label || !ruleId) {
      showToast('error', 'Validation Error', 'Label and Rule ID are required.');
      return;
    }
    
    // Regex matches backend: /^[a-z0-9]+(\.[a-z0-9_-]+)*$/
    // Valid: "hvac.cooling.not_cooling", "pricing.freon-r22"
    // Invalid: leading underscore, double dots, trailing dot
    if (!/^[a-z0-9]+(\.[a-z0-9_-]+)*$/.test(ruleId)) {
      showToast('error', 'Invalid Rule ID', 'Use lowercase letters/numbers, dots as separators (e.g. hvac.cooling.not_cooling). Hyphens allowed within segments.');
      return;
    }
    
    let bucketKey = document.getElementById('input-trigger-bucket')?.value || null;
    if (bucketKey && !state.bucketIndex.has(bucketKey)) {
      bucketKey = null;
    }

    const payload = {
      ruleId,
      label,
      priority,
      keywords,
      phrases,
      negativeKeywords,
      negativePhrases: (document.getElementById('input-trigger-negative-phrases')?.value || '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
      maxInputWords: parseInt(document.getElementById('input-trigger-max-words')?.value || '0') || null,
      bucket: bucketKey || null,
      responseMode,
      answerText,
      audioUrl,
      followUpQuestion
    };
    
    // Include LLM fact pack if in LLM mode
    if (responseMode === 'llm' && llmFactPack) {
      payload.llmFactPack = llmFactPack;
    }
    
    try {
      if (state.editingTrigger) {
        const scope = state.editingTrigger.scope;
        
        if (scope === 'GLOBAL') {
          if (!state.permissions?.canEditGlobalTriggers) {
            showToast('error', 'Permission Denied', 'You cannot edit global triggers.');
            return;
          }
          
          const groupId = state.editingTrigger.originGroupId;
          const bucketChanged = (state.editingTrigger.bucket || null) !== (bucketKey || null);
          const { bucket, ...globalPayload } = payload;
          const result = await apiFetch(`${CONFIG.API_BASE_GLOBAL}/trigger-groups/${groupId}/triggers/${ruleId}`, {
            method: 'PATCH',
            body: globalPayload
          });

          if (bucketChanged) {
            await saveGlobalBucketOverride(state.editingTrigger.triggerId, bucketKey);
          }
          
          // Check if audio was invalidated due to text change (affects all companies)
          if (result.audioInvalidated) {
            const count = result.audioInvalidatedCount || 0;
            showToast('warning', 'Audio Invalidated', 
              count > 1 
                ? `Text changed — audio invalidated for ${count} companies. Each needs regeneration.`
                : 'Text changed — please regenerate audio to match new content.');
          }
        } else {
          const result = await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/local-triggers/${ruleId}`, {
            method: 'PATCH',
            body: payload
          });
          
          // Check if audio was invalidated due to text change
          if (result.audioInvalidated) {
            showToast('warning', 'Audio Invalidated', 'Text changed — please regenerate audio to match new content.');
          }
        }
        
        showToast('success', 'Saved', 'Trigger updated successfully.');
      } else {
        await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/local-triggers`, {
          method: 'POST',
          body: payload
        });
        
        showToast('success', 'Created', 'Trigger created successfully.');
      }
      
      closeTriggerModal();
      await loadTriggers();
      
    } catch (error) {
      console.error('[Triggers] Save failed:', error);
      showToast('error', 'Save Failed', error.message || 'Could not save trigger.');
    }
  }

  async function saveGlobalBucketOverride(globalTriggerId, bucketKey) {
    if (!globalTriggerId) return null;
    return apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/trigger-override`, {
      method: 'PUT',
      body: {
        globalTriggerId,
        bucket: bucketKey || null
      }
    });
  }

  function confirmDeleteTrigger(trigger) {
    state.pendingApproval = {
      action: 'delete',
      trigger
    };
    
    DOM.approvalTitle.textContent = 'Delete Trigger';
    DOM.approvalText.textContent = `Are you sure you want to delete "${trigger.label}"?`;
    updateApprovalHint('approved');
    DOM.inputApproval.value = '';
    DOM.modalApproval.classList.add('active');
    DOM.inputApproval.focus();
  }

  function confirmToggleTrigger(trigger, newEnabledState, checkbox) {
    const action = newEnabledState ? 'enable' : 'disable';
    const actionLabel = newEnabledState ? 'Enable' : 'Disable';
    
    let impactText = '';
    if (trigger.scope === 'GLOBAL') {
      impactText = newEnabledState 
        ? 'This will ENABLE this global trigger for this company. Callers will receive this response when matched.'
        : 'This will DISABLE this global trigger for this company. The trigger will remain visible but will NOT fire. Callers will NOT receive this response.';
    } else {
      impactText = newEnabledState
        ? 'This will ENABLE this local trigger. Callers will receive this response when matched.'
        : 'This will DISABLE this local trigger. The trigger will remain visible but will NOT fire. Callers will NOT receive this response.';
    }
    
    state.pendingApproval = {
      action: 'toggle',
      trigger,
      newEnabledState,
      checkbox
    };
    
    DOM.approvalTitle.textContent = `${actionLabel} Trigger`;
    DOM.approvalText.innerHTML = `
      <strong>${escapeHtml(trigger.label)}</strong><br><br>
      ${impactText}<br><br>
      <span style="color: var(--text-muted); font-size: 0.875rem;">Scope: ${trigger.scope} · Rule ID: ${trigger.ruleId}</span>
    `;
    updateApprovalHint('Yes');
    DOM.inputApproval.value = '';
    DOM.modalApproval.classList.add('active');
    DOM.inputApproval.focus();
  }

  function confirmToggleScope(trigger, newIsGlobal, checkbox) {
    const newScope = newIsGlobal ? 'GLOBAL' : 'LOCAL';
    const actionLabel = newIsGlobal ? 'Change to Global' : 'Change to Local';
    
    let impactText = '';
    let warningBox = '';
    
    if (newIsGlobal) {
      impactText = 'This will change the trigger from LOCAL to GLOBAL scope. Global triggers are shared across multiple companies in the same group.';
      warningBox = `
        <div style="background: #fee2e2; border: 2px solid #dc2626; border-radius: 8px; padding: 12px; margin: 16px 0;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <span style="font-size: 1.25rem;">⚠️</span>
            <strong style="color: #dc2626;">WARNING: This action cannot be reversed!</strong>
          </div>
          <p style="margin: 0; color: #991b1b; font-size: 0.875rem; line-height: 1.5;">
            Once you convert this trigger to GLOBAL scope, you will <strong>NOT</strong> be able to change it back to LOCAL. 
            The toggle will be replaced with a permanent GLOBAL badge.
          </p>
        </div>
      `;
    } else {
      impactText = 'Converting GLOBAL triggers to LOCAL is not supported. This action is blocked for data integrity.';
      showToast('error', 'Action Not Allowed', 'GLOBAL triggers cannot be converted back to LOCAL scope.');
      checkbox.checked = true;
      return;
    }
    
    state.pendingApproval = {
      action: 'toggleScope',
      trigger,
      newScope,
      checkbox
    };
    
    DOM.approvalTitle.textContent = actionLabel;
    DOM.approvalText.innerHTML = `
      <strong>${escapeHtml(trigger.label)}</strong><br><br>
      ${impactText}
      ${warningBox}
      <span style="color: var(--text-muted); font-size: 0.875rem;">Current Scope: ${trigger.scope} · Rule ID: ${trigger.ruleId}</span>
    `;
    updateApprovalHint('Yes');
    DOM.inputApproval.value = '';
    DOM.modalApproval.classList.add('active');
    DOM.inputApproval.focus();
  }

  function updateApprovalHint(requiredText) {
    const label = DOM.modalApproval.querySelector('.form-label');
    if (label) {
      label.textContent = `Type "${requiredText}" to confirm:`;
    }
    DOM.inputApproval.placeholder = requiredText;
    DOM.inputApproval.dataset.requiredText = requiredText.toLowerCase();
  }

  function closeApprovalModal() {
    DOM.modalApproval.classList.remove('active');
    state.pendingApproval = null;
  }

  async function confirmApproval() {
    const approvalText = DOM.inputApproval.value.trim().toLowerCase();
    const requiredText = DOM.inputApproval.dataset.requiredText || 'approved';
    
    if (approvalText !== requiredText) {
      showToast('error', 'Confirmation Required', `Please type "${requiredText === 'yes' ? 'Yes' : 'approved'}" to confirm.`);
      return;
    }
    
    if (!state.pendingApproval) {
      return;
    }
    
    const { action, trigger, newEnabledState, newScope, checkbox, newGroupId } = state.pendingApproval;
    
    try {
      if (action === 'delete') {
        if (trigger.scope === 'GLOBAL') {
          const groupId = trigger.originGroupId;
          await apiFetch(`${CONFIG.API_BASE_GLOBAL}/trigger-groups/${groupId}/triggers/${trigger.ruleId}`, {
            method: 'DELETE',
            body: { approvalText: 'approved' }
          });
        } else {
          await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/local-triggers/${trigger.ruleId}`, {
            method: 'DELETE'
          });
        }
        
        showToast('success', 'Deleted', `Trigger "${trigger.label}" deleted.`);
      } else if (action === 'toggle') {
        if (trigger.scope === 'GLOBAL') {
          await toggleGlobalTriggerVisibility(trigger.triggerId, newEnabledState);
        } else {
          await toggleLocalTriggerEnabled(trigger.triggerId, newEnabledState);
        }
      } else if (action === 'toggleScope') {
        await toggleTriggerScope(trigger.triggerId, newScope);
      } else if (action === 'changeGroup') {
        await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/active-group`, {
          method: 'PUT',
          body: { groupId: newGroupId }
        });
        
        showToast('success', 'Group Changed', newGroupId ? `Now using "${newGroupId}" triggers` : 'No group selected');
        DOM.groupSelector.value = newGroupId || '';
        await loadTriggers();
      }
      
      closeApprovalModal();
      
      if (action === 'delete' || action === 'toggleScope') {
        await loadTriggers();
      }
      
    } catch (error) {
      console.error('[Triggers] Action failed:', error);
      showToast('error', 'Failed', error.message || 'Action could not be completed.');
    }
  }

  async function toggleGlobalTriggerVisibility(triggerId, visible) {
    try {
      await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/trigger-visibility`, {
        method: 'PUT',
        body: { triggerId, visible }
      });
      
      showToast('success', visible ? 'Enabled' : 'Disabled', `Global trigger ${visible ? 'enabled' : 'disabled'} for this company.`);
      await loadTriggers();
      
    } catch (error) {
      console.error('[Triggers] Enable/disable toggle failed:', error);
      showToast('error', 'Failed', 'Could not change trigger status.');
      await loadTriggers();
      throw error;
    }
  }

  async function toggleLocalTriggerEnabled(triggerId, enabled) {
    const trigger = state.triggers.find(t => t.triggerId === triggerId);
    if (!trigger) {
      return;
    }
    
    try {
      await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/local-triggers/${trigger.ruleId}`, {
        method: 'PATCH',
        body: { enabled }
      });
      
      showToast('success', enabled ? 'Enabled' : 'Disabled', `Local trigger ${enabled ? 'activated' : 'deactivated'}.`);
      await loadTriggers();
      
    } catch (error) {
      console.error('[Triggers] Enable toggle failed:', error);
      showToast('error', 'Failed', 'Could not change trigger status.');
      await loadTriggers();
      throw error;
    }
  }

  async function toggleTriggerScope(triggerId, newScope) {
    const trigger = state.triggers.find(t => t.triggerId === triggerId);
    if (!trigger) {
      return;
    }
    
    try {
      await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/trigger-scope`, {
        method: 'PUT',
        body: { triggerId, scope: newScope }
      });
      
      const scopeLabel = newScope === 'GLOBAL' ? 'global' : 'local';
      showToast('success', 'Scope Changed', `Trigger is now ${scopeLabel}.`);
      await loadTriggers();
      
    } catch (error) {
      console.error('[Triggers] Scope toggle failed:', error);
      showToast('error', 'Failed', 'Could not change trigger scope.');
      await loadTriggers();
      throw error;
    }
  }

  /* --------------------------------------------------------------------------
     AUDIO GENERATION & PLAYBACK
     -------------------------------------------------------------------------- */
  let currentAudio = null;
  
  async function generateTriggerAudio() {
    const text = DOM.inputTriggerAnswer?.value?.trim();
    const ruleId = DOM.inputTriggerRuleId?.value?.trim();
    
    if (!text) {
      showToast('error', 'Text Required', 'Enter answer text first');
      return;
    }
    
    if (!ruleId) {
      showToast('error', 'Save First', 'Save the trigger before generating audio');
      return;
    }
    
    const btn = DOM.btnGenerateAudio;
    const originalText = btn?.textContent || 'Generate';
    
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Generating...';
    }
    
    if (DOM.audioStatusHint) {
      DOM.audioStatusHint.innerHTML = '<span style="color: #3b82f6;">Generating audio with your ElevenLabs voice...</span>';
    }
    
    try {
      const response = await apiFetch(`/api/admin/agent2/${state.companyId}/generate-trigger-audio`, {
        method: 'POST',
        body: { ruleId, text }
      });
      
      if (response.audioUrl && DOM.inputTriggerAudio) {
        DOM.inputTriggerAudio.value = response.audioUrl;
      }
      
      if (DOM.btnPlayAudio) {
        DOM.btnPlayAudio.style.display = 'block';
      }
      
      if (btn) {
        btn.textContent = 'Regenerate';
        btn.disabled = false;
      }
      
      if (DOM.audioStatusHint) {
        DOM.audioStatusHint.innerHTML = '<span style="color: #16a34a;">✅ Audio generated! Click Save to keep it.</span>';
      }
      
      showToast('success', 'Audio Generated', 'Audio created with your ElevenLabs voice');
      
    } catch (error) {
      console.error('[Audio] Generation failed:', error);
      
      if (btn) {
        btn.textContent = originalText;
        btn.disabled = false;
      }
      
      if (DOM.audioStatusHint) {
        const errorMsg = error.message || 'Generation failed';
        const hint = errorMsg.includes('voice') 
          ? 'Configure your ElevenLabs voice in Company Profile first.'
          : 'Could not generate audio.';
        DOM.audioStatusHint.innerHTML = `<span style="color: #dc2626;">❌ ${errorMsg}</span> ${hint}`;
      }
      
      showToast('error', 'Generation Failed', error.message || 'Could not generate audio');
    }
  }

  async function clearAllAudio() {
    const triggers = state.triggers || [];
    const triggersWithAudio = triggers.filter(t => t.answer?.audioUrl);
    
    if (triggersWithAudio.length === 0) {
      alert('No audio to clear. All triggers already use TTS.');
      return;
    }
    
    const confirmMsg = 
      `⚠️ CLEAR ALL AUDIO CACHE\n\n` +
      `This will invalidate audio for ${triggersWithAudio.length} trigger(s).\n\n` +
      `After clearing, you can:\n` +
      `1. Click "🎙️ Bulk Audio" to regenerate all\n` +
      `2. Or triggers will use live TTS until regenerated\n\n` +
      `Audio files are in MongoDB (permanent) but will be marked for regeneration.\n\n` +
      `Type "CLEAR" to confirm:`;
    
    const userInput = prompt(confirmMsg);
    
    if (userInput !== 'CLEAR') {
      console.log('[Triggers] Clear audio cancelled');
      return;
    }
    
    try {
      const btn = DOM.btnClearAllAudio;
      btn.disabled = true;
      btn.textContent = 'Clearing...';
      
      const response = await apiFetch(
        `/api/admin/agent2/${state.companyId}/clear-all-audio`,
        { method: 'POST' }
      );
      
      alert(`✅ Audio cache cleared!\n\n${response.cleared} trigger(s) marked for regeneration.\n\nClick "🎙️ Bulk Audio" to regenerate all at once.`);
      
      await loadTriggers();
      showToast('success', 'Audio Cleared', `${response.cleared} audio files marked for regeneration`);
      
    } catch (err) {
      console.error('[Triggers] Clear audio failed:', err);
      alert('Failed to clear audio: ' + err.message);
    } finally {
      const btn = DOM.btnClearAllAudio;
      btn.disabled = false;
      btn.textContent = '🗑️ Clear Audio';
    }
  }

  async function bulkGenerateAudio() {
    const triggers = state.triggers || [];
    
    const eligible = [];
    const skipped = { hasAudio: 0, runtimeVar: 0, noText: 0, llm: 0, disabled: 0 };
    
    for (const t of triggers) {
      const text = t.answer?.answerText || '';
      const hasAudio = t.answer?.audioUrl && !t.answer?.audioNeedsRegeneration;
      const isLlm = t.responseMode === 'llm';
      const isDisabled = t.isEnabled === false;
      const hasRuntimeVar = /\{name\}/i.test(text);
      const ruleId = t.ruleId || '';
      
      if (isDisabled) { skipped.disabled++; continue; }
      if (isLlm) { skipped.llm++; continue; }
      if (!text.trim()) { skipped.noText++; continue; }
      if (hasRuntimeVar) { skipped.runtimeVar++; continue; }
      if (hasAudio) { skipped.hasAudio++; continue; }
      
      eligible.push({ ruleId, label: t.label || ruleId, text });
    }
    
    const skipDetails = [];
    if (skipped.hasAudio > 0) skipDetails.push(`${skipped.hasAudio} already have audio`);
    if (skipped.runtimeVar > 0) skipDetails.push(`${skipped.runtimeVar} use {name} (runtime variable)`);
    if (skipped.noText > 0) skipDetails.push(`${skipped.noText} have no answer text`);
    if (skipped.llm > 0) skipDetails.push(`${skipped.llm} are LLM mode`);
    if (skipped.disabled > 0) skipDetails.push(`${skipped.disabled} are disabled`);
    
    if (eligible.length === 0) {
      alert(
        `No triggers eligible for audio generation.\n\n` +
        `Total triggers: ${triggers.length}\n` +
        `Skipped:\n  ${skipDetails.join('\n  ') || 'None'}\n\n` +
        `Triggers with {name} always use live TTS so the caller's name is spoken naturally.`
      );
      return;
    }
    
    const confirmMsg =
      `Generate audio for ${eligible.length} trigger(s)?\n\n` +
      `Skipped:\n  ${skipDetails.join('\n  ')}\n\n` +
      `This will use your ElevenLabs voice settings.`;
    
    if (!confirm(confirmMsg)) return;
    
    const btn = DOM.btnBulkGenerateAudio;
    const originalText = btn.textContent;
    btn.disabled = true;
    
    let generated = 0;
    let failed = 0;
    const failures = [];
    
    for (let i = 0; i < eligible.length; i++) {
      const t = eligible[i];
      btn.textContent = `Generating ${i + 1}/${eligible.length}...`;
      
      try {
        await apiFetch(`/api/admin/agent2/${state.companyId}/generate-trigger-audio`, {
          method: 'POST',
          body: { ruleId: t.ruleId, text: t.text }
        });
        generated++;
      } catch (err) {
        failed++;
        failures.push(`${t.label}: ${err.message}`);
      }
    }
    
    btn.textContent = originalText;
    btn.disabled = false;
    
    const summary =
      `Bulk audio generation complete!\n\n` +
      `Generated: ${generated}\n` +
      `Failed: ${failed}` +
      (failures.length > 0 ? `\n\nFailures:\n${failures.slice(0, 10).join('\n')}` : '');
    
    alert(summary);
    
    if (generated > 0) {
      await loadTriggers();
      showToast('success', 'Bulk Audio', `${generated} audio file(s) generated.`);
    }
  }
  
  function playTriggerAudio() {
    let audioUrl = DOM.inputTriggerAudio?.value?.trim();
    
    if (!audioUrl) {
      showToast('error', 'No Audio', 'Generate audio first');
      return;
    }
    
    // Add cache-busting parameter to avoid browser serving stale audio
    const cacheBuster = `_cb=${Date.now()}`;
    audioUrl = audioUrl.includes('?') ? `${audioUrl}&${cacheBuster}` : `${audioUrl}?${cacheBuster}`;
    
    const btn = DOM.btnPlayAudio;
    
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
      if (btn) {
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;"><path d="M4 3L12 8L4 13V3Z" fill="currentColor"/></svg>Play`;
      }
      return;
    }
    
    currentAudio = new Audio(audioUrl);
    
    if (btn) {
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;"><rect x="4" y="3" width="3" height="10" fill="currentColor"/><rect x="9" y="3" width="3" height="10" fill="currentColor"/></svg>Stop`;
    }
    
    currentAudio.onended = () => {
      currentAudio = null;
      if (btn) {
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;"><path d="M4 3L12 8L4 13V3Z" fill="currentColor"/></svg>Play`;
      }
    };
    
    currentAudio.onerror = () => {
      currentAudio = null;
      if (btn) {
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;"><path d="M4 3L12 8L4 13V3Z" fill="currentColor"/></svg>Play`;
      }
      showToast('error', 'Playback Failed', 'Could not play audio file');
    };
    
    currentAudio.play().catch(() => {
      currentAudio = null;
      if (btn) {
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;"><path d="M4 3L12 8L4 13V3Z" fill="currentColor"/></svg>Play`;
      }
      showToast('error', 'Audio Not Found', 'Audio file is missing — please regenerate.');
    });
  }
  
  function checkAudioStatus() {
    const currentText = DOM.inputTriggerAnswer?.value?.trim();
    const originalText = state.editingTrigger?.answer?.answerText?.trim() || '';
    const hasAudio = state.editingTrigger?.answer?.audioUrl || state.editingTrigger?.answer?.audioNeedsRegeneration;
    
    // Only show warning if there's existing audio and text was changed
    if (!hasAudio || !currentText) {
      return;
    }
    
    const textChanged = currentText !== originalText;
    
    if (textChanged) {
      if (DOM.audioStatusHint) {
        DOM.audioStatusHint.innerHTML = '<span style="color: #f59e0b;">⚠️ Text changed — audio will be invalidated when you save. Regenerate after saving.</span>';
      }
      
      if (DOM.btnGenerateAudio) {
        DOM.btnGenerateAudio.textContent = 'Regenerate';
      }
    } else if (state.editingTrigger?.answer?.audioNeedsRegeneration) {
      // Text matches but audio is already marked stale (variable changed)
      if (DOM.audioStatusHint) {
        DOM.audioStatusHint.innerHTML = '<span style="color: #dc2626;">⚠️ <strong>Variable value changed</strong> — audio is outdated, please regenerate!</span>';
      }
    } else if (state.editingTrigger?.answer?.audioUrl) {
      // Text matches and audio is valid
      if (DOM.audioStatusHint) {
        DOM.audioStatusHint.innerHTML = '<span style="color: #16a34a;">✅ Audio generated! Click Save to keep it.</span>';
      }
    }
  }

  /* --------------------------------------------------------------------------
     GPT-4 PREFILL
     -------------------------------------------------------------------------- */
  function openGptSettingsModal() {
    if (DOM.gptDefaultPriority) {
      DOM.gptDefaultPriority.value = state.gptSettings.defaultPriority;
    }
    if (DOM.gptTone) {
      DOM.gptTone.value = state.gptSettings.tone;
    }
    if (DOM.gptInstructions) {
      DOM.gptInstructions.value = state.gptSettings.instructions;
    }
    if (DOM.gptIncludeFollowup) {
      DOM.gptIncludeFollowup.checked = state.gptSettings.includeFollowup;
    }
    
    if (DOM.modalGptSettings) {
      DOM.modalGptSettings.classList.add('active');
    }
  }

  function closeGptSettingsModal() {
    if (DOM.modalGptSettings) {
      DOM.modalGptSettings.classList.remove('active');
    }
  }

  async function saveGptSettings() {
    state.gptSettings.defaultPriority = parseInt(DOM.gptDefaultPriority?.value, 10) || 50;
    state.gptSettings.tone = DOM.gptTone?.value || 'friendly';
    state.gptSettings.instructions = DOM.gptInstructions?.value || '';
    state.gptSettings.includeFollowup = DOM.gptIncludeFollowup?.checked !== false;

    closeGptSettingsModal();

    // Persist to company config so settings survive page reloads
    try {
      const saveUrl = `${CONFIG.API_BASE_AGENT2}/${state.companyId}/agent2/config`;
      await AgentConsoleAuth.apiFetch(saveUrl, {
        method: 'PATCH',
        body: { discovery: { gptPrefillSettings: state.gptSettings } }
      });
      showToast('success', 'Settings Saved', 'GPT prefill settings saved to company config.');
    } catch (err) {
      console.warn('[GPT Settings] Failed to persist settings:', err.message);
      showToast('warning', 'Settings Saved Locally', 'Settings applied but could not save to server.');
    }
  }

  async function gptPrefill() {
    const keywordsInput = DOM.inputTriggerKeywords;
    const keywords = (keywordsInput?.value || '').trim();
    
    if (!keywords) {
      showToast('warning', 'Keywords Required', 'Enter keywords first, then click GPT-4 Prefill.');
      keywordsInput?.focus();
      return;
    }
    
    const btn = DOM.btnGptPrefill;
    const originalText = btn?.innerHTML || 'GPT-4 Prefill';
    
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>Generating...</span>';
    }
    
    try {
      const response = await gptPrefillRequest(keywords);
      
      if (response.label && DOM.inputTriggerLabel) {
        DOM.inputTriggerLabel.value = response.label;
      }
      if (response.ruleId && DOM.inputTriggerRuleId) {
        const existingRuleId = DOM.inputTriggerRuleId.value.trim();
        if (!existingRuleId) {
          DOM.inputTriggerRuleId.value = response.ruleId;
        }
      }
      if (DOM.inputTriggerPriority && !state.editingTrigger) {
        DOM.inputTriggerPriority.value = response.priority || state.gptSettings.defaultPriority;
      }
      if (response.phrases && Array.isArray(response.phrases) && DOM.inputTriggerPhrases) {
        DOM.inputTriggerPhrases.value = response.phrases.join(', ');
      }
      if (response.negativeKeywords && Array.isArray(response.negativeKeywords) && DOM.inputTriggerNegative) {
        DOM.inputTriggerNegative.value = response.negativeKeywords.join(', ');
      }
      const negPhrasesEl = document.getElementById('input-trigger-negative-phrases');
      if (response.negativePhrases && Array.isArray(response.negativePhrases) && negPhrasesEl) {
        negPhrasesEl.value = response.negativePhrases.join(', ');
      }
      const maxWordsEl = document.getElementById('input-trigger-max-words');
      if (maxWordsEl && response.maxInputWords != null) {
        maxWordsEl.value = response.maxInputWords;
      }
      if (response.answerText && DOM.inputTriggerAnswer) {
        DOM.inputTriggerAnswer.value = response.answerText;
      }
      if (response.followUpQuestion && DOM.inputTriggerFollowup && state.gptSettings.includeFollowup) {
        DOM.inputTriggerFollowup.value = response.followUpQuestion;
        updateFollowupActionVisibility();
      }
      
      if (btn) {
        btn.innerHTML = '<span style="color: #22c55e;">Done!</span>';
        setTimeout(() => {
          btn.innerHTML = originalText;
          btn.disabled = false;
        }, 1500);
      }
      
      showToast('success', 'Prefill Complete', 'Review and edit the generated content as needed.');
      
    } catch (error) {
      console.error('[Triggers] GPT prefill failed:', error);
      showToast('error', 'Prefill Failed', error.message || 'Could not generate content.');
      
      if (btn) {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    }
  }

  async function gptPrefillRequest(keywords) {
    const token = localStorage.getItem('adminToken') ||
                  localStorage.getItem('token') ||
                  sessionStorage.getItem('token');
    
    const toneDescriptions = {
      friendly: 'friendly and conversational',
      professional: 'professional and formal',
      casual: 'casual and relaxed',
      empathetic: 'empathetic and supportive'
    };

    const toneDesc = toneDescriptions[state.gptSettings.tone] || 'friendly and conversational';

    const response = await fetch(`/api/admin/agent2/${state.companyId}/gpt-prefill-advanced`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        keywords: keywords,
        tone: toneDesc,
        additionalInstructions: state.gptSettings.instructions,
        includeFollowup: state.gptSettings.includeFollowup
      })
    });
    
    const data = await response.json();
    
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'GPT prefill request failed');
    }
    
    return data.data;
  }

  /* --------------------------------------------------------------------------
     HEALTH CHECK
     -------------------------------------------------------------------------- */
  async function checkDuplicates() {
    try {
      const data = await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/duplicates`);
      
      if (data.healthy) {
        if (DOM.duplicateWarning) DOM.duplicateWarning.style.display = 'none';
        showToast('success', 'All Clear', 'No duplicate triggers found.');
      } else {
        // API returns data.issues[] array — count critical + warning severity items
        const issues = data.issues || [];
        const critCount = issues.filter(i => i.severity === 'critical').length;
        const warnCount = issues.filter(i => i.severity === 'warning').length;
        const totalItems = issues.reduce((sum, i) => sum + (i.items?.length || 1), 0);

        const parts = [];
        if (critCount > 0) parts.push(`${critCount} critical`);
        if (warnCount > 0) parts.push(`${warnCount} warning`);
        const summary = parts.length > 0 ? parts.join(', ') : `${issues.length} issue(s)`;

        if (DOM.duplicateWarningText) {
          DOM.duplicateWarningText.textContent = `${summary} detected (${totalItems} affected item(s)). Check console for details.`;
        }
        if (DOM.duplicateWarning) DOM.duplicateWarning.style.display = 'flex';
        showToast('warning', 'Issues Found', `${summary} detected.`);
        console.warn('[Triggers] Health issues:', issues);
      }
      
    } catch (error) {
      console.error('[Triggers] Health check failed:', error);
      showToast('error', 'Check Failed', 'Could not check for duplicates.');
    }
  }

  /* --------------------------------------------------------------------------
     NAME GREETING — One-time opening line when caller name is captured
     Stored at: aiAgentSettings.agent2.discovery.nameGreeting
     -------------------------------------------------------------------------- */

  function openNameGreetingModal() {
    loadNameGreeting();
    if (DOM.modalNameGreeting) DOM.modalNameGreeting.classList.add('active');
    
    // Setup link to agent2 greetings
    if (DOM.btnOpenAgent2Greetings) {
      DOM.btnOpenAgent2Greetings.onclick = () => {
        window.open(`/agent-console/agent2.html?companyId=${encodeURIComponent(state.companyId)}&embed=greetings`, '_blank');
      };
    }

    if (DOM.greetingRulesEmbed) {
      const embedUrl = `/agent-console/agent2.html?companyId=${encodeURIComponent(state.companyId)}&embed=greetings`;
      if (DOM.greetingRulesEmbed.getAttribute('src') !== embedUrl) {
        DOM.greetingRulesEmbed.setAttribute('src', embedUrl);
      }
    }
  }

  function closeNameGreetingModal() {
    if (DOM.modalNameGreeting) DOM.modalNameGreeting.classList.remove('active');
  }

  async function loadNameGreeting() {
    try {
      console.log('[NameGreeting] LOAD — fetching settings...');
      const data = await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/name-greeting`);
      console.log('[NameGreeting] LOAD — API response:', data);
      const s = data.settings || {};
      console.log('[NameGreeting] LOAD — extracted settings:', s);
      console.log('[NameGreeting] LOAD — alwaysGreet value:', s.alwaysGreet, 'type:', typeof s.alwaysGreet);
      
      if (DOM.nameGreetingAlways) {
        DOM.nameGreetingAlways.checked = s.alwaysGreet === true;
        console.log('[NameGreeting] LOAD — set checkbox to:', DOM.nameGreetingAlways.checked);
      } else {
        console.error('[NameGreeting] LOAD — DOM.nameGreetingAlways is null!');
      }
      if (DOM.nameGreetingText) DOM.nameGreetingText.value = s.greetingLine || '';
    } catch (err) {
      console.warn('[NameGreeting] Failed to load, using defaults:', err.message);
    }
  }

  async function saveNameGreeting() {
    const btn = DOM.btnNameGreetingSave;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const settings = {
        alwaysGreet: DOM.nameGreetingAlways?.checked === true,
        greetingLine: (DOM.nameGreetingText?.value || '').trim()
          || 'Hello {name}, thank you for calling.'
      };

      console.log('[NameGreeting] SAVE — checkbox element:', DOM.nameGreetingAlways);
      console.log('[NameGreeting] SAVE — checkbox checked:', DOM.nameGreetingAlways?.checked);
      console.log('[NameGreeting] SAVE — settings being sent:', settings);

      const response = await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/name-greeting`, {
        method: 'PUT',
        body: { settings }
      });

      console.log('[NameGreeting] SAVE — API response:', response);

      showToast('success', 'Name Greeting Saved', settings.alwaysGreet ? 'Always greet (with or without name)' : 'Greet only when name captured');
      closeNameGreetingModal();
    } catch (err) {
      console.error('[NameGreeting] Save failed:', err);
      showToast('error', 'Save Failed', err.message || 'Could not save greeting');
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }

  /* --------------------------------------------------------------------------
     PATIENCE SETTINGS — System behavior for "hold on" / "wait" requests
     Stored at: aiAgentSettings.agent2.discovery.patienceSettings
     -------------------------------------------------------------------------- */

  function openPatienceModal() {
    loadPatienceSettings();
    if (DOM.modalPatience) DOM.modalPatience.classList.add('active');
  }

  function closePatienceModal() {
    if (DOM.modalPatience) DOM.modalPatience.classList.remove('active');
  }

  async function loadPatienceSettings() {
    try {
      const data = await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/patience-settings`);
      const s = data.settings || {};

      if (DOM.patienceEnabled) DOM.patienceEnabled.checked = s.enabled !== false;
      if (DOM.patiencePhrases) DOM.patiencePhrases.value = (s.phrases || []).join(', ');
      if (DOM.patienceInitialResponse) DOM.patienceInitialResponse.value = s.initialResponse || '';
      if (DOM.patienceTimeoutEnabled) DOM.patienceTimeoutEnabled.checked = s.timeoutEnabled !== false;
      if (DOM.patienceTimeoutSeconds) {
        DOM.patienceTimeoutSeconds.value = s.timeoutSeconds || 45;
        const display = document.getElementById('patience-timeout-display');
        if (display) display.textContent = (s.timeoutSeconds || 45) + 's';
      }
      if (DOM.patienceCheckinResponse) DOM.patienceCheckinResponse.value = s.checkinResponse || '';
      if (DOM.patienceMaxCheckins) DOM.patienceMaxCheckins.value = s.maxCheckins || 2;
      if (DOM.patienceFinalResponse) DOM.patienceFinalResponse.value = s.finalResponse || '';
    } catch (err) {
      console.warn('[Patience] Failed to load settings, using defaults:', err.message);
    }
  }

  async function savePatienceSettings() {
    const btn = DOM.btnPatienceSave;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const phrases = (DOM.patiencePhrases?.value || '')
        .split(',').map(p => p.trim().toLowerCase()).filter(Boolean);

      const settings = {
        enabled: DOM.patienceEnabled?.checked !== false,
        phrases,
        initialResponse: (DOM.patienceInitialResponse?.value || '').trim()
          || 'Take your time — I\'m right here whenever you\'re ready.',
        timeoutEnabled: DOM.patienceTimeoutEnabled?.checked !== false,
        timeoutSeconds: parseInt(DOM.patienceTimeoutSeconds?.value) || 45,
        checkinResponse: (DOM.patienceCheckinResponse?.value || '').trim()
          || 'Are you still there? No rush — take your time.',
        maxCheckins: parseInt(DOM.patienceMaxCheckins?.value) || 2,
        finalResponse: (DOM.patienceFinalResponse?.value || '').trim()
          || 'I\'m still here whenever you\'re ready. Just let me know how I can help.'
      };

      await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/patience-settings`, {
        method: 'PUT',
        body: { settings }
      });

      showToast('success', 'Patience Settings Saved', `${phrases.length} trigger phrases, ${settings.timeoutSeconds}s timeout`);
      closePatienceModal();
    } catch (err) {
      console.error('[Patience] Save failed:', err);
      showToast('error', 'Save Failed', err.message || 'Could not save patience settings');
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }

  /* --------------------------------------------------------------------------
     BULK IMPORT/EXPORT TRIGGERS
     -------------------------------------------------------------------------- */
  function exportAllTriggers() {
    if (!state.triggers || state.triggers.length === 0) {
      alert('No triggers to export');
      return;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STRICT TRIGGER SYSTEM - ISOMORPHIC EXPORT
    // All fields that exist in schema MUST be exported. No silent data loss.
    // ═══════════════════════════════════════════════════════════════════════
    const exportData = state.triggers.map(t => ({
      ruleId: t.ruleId,
      label: t.label,
      priority: t.priority || 50,
      // ISOMORPHIC: bucket + maxInputWords (Added V131)
      bucket: t.bucket || null,
      maxInputWords: typeof t.maxInputWords === 'number' ? t.maxInputWords : null,
      keywords: t.match?.keywords || [],
      phrases: t.match?.phrases || [],
      negativeKeywords: t.match?.negativeKeywords || [],
      negativePhrases: t.match?.negativePhrases || [],  // ISOMORPHIC: Added V131
      responseMode: t.responseMode || 'standard',
      answerText: t.answer?.answerText || '',
      followUpQuestion: t.followUp?.question || '',
      followUpNextAction: t.followUp?.nextAction || '',  // DEPRECATED: kept for backward-compat export
      // Include LLM fact pack if present
      ...(t.llmFactPack ? { llmFactPack: t.llmFactPack } : {})
    }));
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `triggers-export-${state.companyId}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('success', 'Export Complete', `Exported ${exportData.length} triggers`);
  }
  
  function openBulkImportModal() {
    if (DOM.bulkImportJson) DOM.bulkImportJson.value = '';
    if (DOM.bulkImportStatus) DOM.bulkImportStatus.style.display = 'none';
    // Always reset checkbox + button state on open — force conscious opt-in every time
    if (DOM.chkLocalImportConfirm) DOM.chkLocalImportConfirm.checked = false;
    if (DOM.btnExecuteBulkImport) {
      DOM.btnExecuteBulkImport.disabled = true;
      DOM.btnExecuteBulkImport.style.opacity = '0.5';
      DOM.btnExecuteBulkImport.style.cursor  = 'not-allowed';
    }
    if (DOM.modalBulkImport) DOM.modalBulkImport.classList.add('active');
  }

  function closeBulkImportModal() {
    if (DOM.modalBulkImport) DOM.modalBulkImport.classList.remove('active');
  }

  async function executeBulkImport() {
    const raw = (DOM.bulkImportJson?.value || '').trim();
    if (!raw) { alert('Please paste a JSON array of triggers'); return; }

    let triggers;
    try {
      triggers = JSON.parse(raw);
    } catch (err) {
      alert('Invalid JSON: ' + err.message);
      return;
    }

    if (!Array.isArray(triggers) || triggers.length === 0) {
      alert('JSON must be a non-empty array of trigger objects');
      return;
    }

    const errors = [];
    const valid = [];
    // ═══════════════════════════════════════════════════════════════════════
    // STRICT TRIGGER SYSTEM - ISOMORPHIC IMPORT
    // All fields that exist in schema MUST be imported. No silent data loss.
    // 
    // CRITICAL: This import creates LOCAL triggers ONLY.
    // - The filename is NEVER read or used
    // - No groups are created or referenced
    // - All triggers are scoped to the current company only
    // - Groups can ONLY be created via Admin UI or seed scripts
    // ═══════════════════════════════════════════════════════════════════════
    triggers.forEach((t, i) => {
      // LLM mode doesn't require answerText
      const isLlmMode = t.responseMode === 'llm';
      if (!t.ruleId || !t.label || (!isLlmMode && !t.answerText)) {
        errors.push(`[${i}] Missing ruleId, label, or answerText`);
        return;
      }
      if (!/^[a-z0-9_.]+$/.test(t.ruleId)) {
        errors.push(`[${i}] Invalid ruleId "${t.ruleId}" — use lowercase, dots, underscores`);
        return;
      }
      const normalizedBucket = typeof t.bucket === 'string' ? t.bucket.trim().toLowerCase() : null;
      if (normalizedBucket && !state.bucketIndex.has(normalizedBucket)) {
        errors.push(`[${i}] Invalid bucket "${normalizedBucket}"`);
        return;
      }
      valid.push({
        ruleId: t.ruleId,
        label: t.label,
        priority: t.priority || 50,
        // ISOMORPHIC: bucket + maxInputWords (Added V131)
        bucket: normalizedBucket || null,
        maxInputWords: typeof t.maxInputWords === 'number' ? t.maxInputWords : null,
        keywords: Array.isArray(t.keywords) ? t.keywords : [],
        phrases: Array.isArray(t.phrases) ? t.phrases : [],
        negativeKeywords: Array.isArray(t.negativeKeywords) ? t.negativeKeywords : [],
        negativePhrases: Array.isArray(t.negativePhrases) ? t.negativePhrases : [],  // ISOMORPHIC: Added V131
        responseMode: t.responseMode || 'standard',
        answerText: t.answerText || '',
        audioUrl: '',
        followUpQuestion: t.followUpQuestion || '',
        followUpNextAction: t.followUpNextAction || '',  // DEPRECATED: kept for backward-compat import
        // Include LLM fact pack if present
        ...(t.llmFactPack ? { llmFactPack: t.llmFactPack } : {})
      });
    });

    if (errors.length > 0 && valid.length === 0) {
      alert('All triggers failed validation:\n\n' + errors.slice(0, 10).join('\n'));
      return;
    }

    if (errors.length > 0 && valid.length > 0) {
      // Non-blocking notice about skipped triggers — checkbox already confirmed intent
      showToast('warning', 'Import Validation', `${errors.length} trigger(s) skipped due to validation errors. Importing ${valid.length} valid.`);
    }

    const statusEl = DOM.bulkImportStatus;
    statusEl.style.display = 'block';
    statusEl.innerHTML = `<strong>Importing... 0/${valid.length}</strong>`;
    DOM.btnExecuteBulkImport.disabled = true;

    let created = 0;
    let failed = 0;
    const failDetails = [];

    for (let i = 0; i < valid.length; i++) {
      try {
        await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/local-triggers`, {
          method: 'POST',
          body: valid[i]
        });
        created++;
      } catch (err) {
        failed++;
        failDetails.push(`${valid[i].ruleId}: ${err.message}`);
      }
      statusEl.innerHTML = `<strong>Importing... ${i + 1}/${valid.length}</strong> (${created} created, ${failed} failed)`;
    }

    DOM.btnExecuteBulkImport.disabled = false;

    const summary = `Import complete!\n\n` +
      `Created: ${created}\nFailed: ${failed}` +
      (failDetails.length > 0 ? `\n\nFailures:\n${failDetails.slice(0, 10).join('\n')}` : '');

    alert(summary);

    if (created > 0) {
      closeBulkImportModal();
      await loadTriggers();
      showToast('success', 'LOCAL Import Complete', `${created} LOCAL trigger(s) imported for this company. Global groups unchanged.`);
    }
  }

  /* --------------------------------------------------------------------------
     UTILITIES
     -------------------------------------------------------------------------- */
  function parseCommaSeparated(str) {
    return (str || '').split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
  }

  function normalizeSearchQuery(value) {
    return (value || '').toString().toLowerCase().trim();
  }

  function buildTriggerSearchText(trigger) {
    if (!trigger || typeof trigger !== 'object') {
      return '';
    }

    const parts = [];
    const pushText = (value) => {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach(v => pushText(v));
        return;
      }
      if (typeof value === 'object') {
        try {
          parts.push(JSON.stringify(value));
        } catch (err) {
          // Ignore unstringifiable objects
        }
        return;
      }
      parts.push(String(value));
    };

    pushText(trigger.triggerId);
    pushText(trigger.ruleId);
    pushText(trigger.label);
    pushText(trigger.priority);
    pushText(trigger.scope);
    pushText(trigger.responseMode);
    pushText(trigger.originGroupId);
    pushText(trigger.originGroupName);
    pushText(trigger.overrideType);
    pushText(trigger.overrideOfRuleId);
    pushText(trigger.overrideOfTriggerId);
    pushText(trigger.overrideOfGroupId);
    // ═══════════════════════════════════════════════════════════════════════
    // STRICT TRIGGER SYSTEM - ISOMORPHIC SEARCH INDEX (Added V132)
    // All fields must be searchable. Missing = users can't find triggers.
    // ═══════════════════════════════════════════════════════════════════════
    pushText(trigger.bucket);
    pushText(getBucketLabel(trigger.bucket));
    pushText(trigger.maxInputWords);
    pushText(trigger.match?.keywords);
    pushText(trigger.match?.phrases);
    pushText(trigger.match?.negativeKeywords);
    pushText(trigger.match?.negativePhrases);
    pushText(trigger.answer?.answerText || trigger.answerText);
    pushText(trigger.answer?.audioUrl);
    pushText(trigger.answer?.quickReplies);
    pushText(trigger.answer?.fullReplies);
    pushText(trigger.followUp?.question);
    pushText(trigger.followUp?.nextAction);
    pushText(trigger.llmFactPack?.includedFacts);
    pushText(trigger.llmFactPack?.excludedFacts);
    pushText(trigger.llmFactPack?.backupAnswer);
    pushText(trigger.entities);

    return normalizeSearchQuery(parts.join(' '));
  }

  function buildSearchIndex(triggers) {
    state.searchIndex = new Map();
    (triggers || []).forEach(t => {
      if (!t || !t.triggerId) return;
      state.searchIndex.set(t.triggerId, buildTriggerSearchText(t));
    });
  }

  function matchesSearchQuery(trigger, query) {
    const q = normalizeSearchQuery(query);
    if (!q) return true;
    const searchText = state.searchIndex.get(trigger.triggerId) || buildTriggerSearchText(trigger);
    return searchText.includes(q);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async function apiFetch(url, options = {}) {
    const token = localStorage.getItem('adminToken') ||
                  localStorage.getItem('token') ||
                  sessionStorage.getItem('token');
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || data.message || 'Request failed');
    }
    
    // If response has a 'data' wrapper, unwrap it but preserve top-level metadata fields
    // (audioInvalidated, audioInvalidatedCount, etc.) that backends place at root level.
    if (data.data !== undefined) {
      const unwrapped = data.data;
      // Attach top-level metadata to the unwrapped result so callers can read it
      if (typeof unwrapped === 'object' && unwrapped !== null && !Array.isArray(unwrapped)) {
        const meta = {};
        for (const [k, v] of Object.entries(data)) {
          if (k !== 'data' && k !== 'success') meta[k] = v;
        }
        return Object.assign(unwrapped, meta);
      }
      return unwrapped;
    }
    return data;
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
    setTimeout(() => { 
      if (toast.parentElement) {
        toast.remove();
      }
    }, 5000);
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
     FOLLOW-UP CONSENT CARDS
     -------------------------------------------------------------------------- */
  // ── DEFAULT_FUC_CLIENT — Starter template (UI-visible, per-company) ────────
  // Shown in the Consent Cards UI when a company has not yet saved their FUC
  // config.  Admin reviews, trims/adds phrases for their specific industry,
  // then clicks Save → writes to MongoDB → DB value used at runtime from then on.
  //
  // MULTI-TENANT RULE: This is a SUGGESTION template, not hardcoded behavior.
  // Runtime ALWAYS reads from MongoDB (per companyId).  Nothing here is silently
  // active without the admin seeing and saving it first.
  //
  // Industry customization examples:
  //   Plumbing: add "pipe still leaking", "same problem again", "drain still clogged"
  //   HVAC:     add "still not cooling", "unit keeps shutting off", "same error code"
  //   Roofing:  add "still getting water in", "patch didnt hold", "leak came back"
  const DEFAULT_FUC_CLIENT = {
    yes: {
      phrases: [
        'yes','yeah','yep','yea','sure','ok','okay','please',
        'absolutely','definitely','certainly','correct','thats right',
        'right','go ahead','do it','lets do it','sounds good',
        'that works','works for me','schedule','book','book it',
        'set it up','im ready','perfect','great','yes please',
        'ya','yup','uh huh','mm hmm'
      ],
      questionSignals: [
        // "Before we book / schedule" preambles
        'before we book','before we schedule','before i book','before i schedule',
        'before we set that','before we do that','before we go ahead',
        // "First I want / understand" preambles
        'first i want','first i like','first like to understand','i first want',
        'i first need','want to first','i need to understand','i want to know',
        'understand why','want to understand',
        // Why questions — diagnostic / continuous-problem signals
        'why is','why are','why were','why was','why does','why did','why would',
        'why cant','why dont','why wont','why hasnt','why havent',
        'why keep','why this','why that','why do',
        // What / how diagnostic questions
        'what causes','what is causing','whats causing','what happened',
        'whats happening','what is wrong','whats wrong','not sure what',
        'not sure why','wondering why',
        // Continuous / recurring problem signals
        'continuous problem','keep having','keeps happening','this keeps',
        'always happens','never fixed','still happening'
      ]
    },
    no: {
      phrases: [
        'no','nope','nah','negative','not yet','not now',
        'not today','maybe later','ill call back','just asking',
        'just a question','dont schedule','not right now',
        'another time','later'
      ]
    },
    reprompt: {
      phrases: [
        'huh','what','sorry','come again','say that again',
        'repeat that','i didnt hear','pardon'
      ]
    },
    hesitant: {
      phrases: [
        // Core uncertainty (language constants — keep for any industry)
        'i dont know','im not sure','maybe','i think so',
        'do i have to','not certain','possibly','kind of',
        'sort of','i guess','hard to say','let me think',
        // Trust / confidence breakdown (customize per industry)
        'not sure i can trust','cant trust','dont trust','losing trust',
        'not confident','not convinced','not comfortable',
        'having second thoughts',
        // "Should I leave / go elsewhere?" signals
        'should i go with another','go with another company',
        'go somewhere else','find someone else','use another company',
        // Quality / competence doubt (replace with industry-specific phrasing)
        'you dont know how','you guys cant','you cant fix',
        'never fixed','cant seem to fix','still not fixed',
        'still the same problem'
      ]
    },
    complex: { phrases: [] },

    // ── ASKING SPECIALS ────────────────────────────────────────────────────
    // Checked FIRST before YES/NO in classification.
    // Response is built from live MongoDB promotions data — not this field.
    // Admin adds industry-specific terms (e.g. "summer package", "warranty deal").
    askingSpecials: {
      phrases: [
        'specials','special','deals','deal','promotions','promotion',
        'promo','coupons','coupon','discount','discounts','offer','offers',
        'sale','savings','running any','any deals','any specials',
        'any promotions','any coupons','what about deals','current deals',
        'current specials','do you have deals','do you have specials',
        'do you have any specials','do you have any deals'
      ]
    }
  };

  // Six consent buckets — askingSpecials added as the promo intercept bucket.
  // ORDER MATTERS in the UI load/collect loop — askingSpecials last so the
  // card renders after NO in the Primary Decision grid.
  const FUC_BUCKETS = ['yes', 'no', 'askingSpecials', 'reprompt', 'hesitant', 'complex'];

  function loadFollowUpConsent(config) {
    const fuc = config?.discovery?.followUpConsent || {};
    console.log('[Consent Cards] LOAD — raw followUpConsent from config:', JSON.stringify(fuc, null, 2));
    const missingActionEl = document.getElementById('fuc-missing-response-action');
    if (missingActionEl) missingActionEl.value = fuc.missingResponseAction || 'REASK_FOLLOWUP';
    for (const bucket of FUC_BUCKETS) {
      const data = fuc[bucket] || {};
      // Show starter template when company has not yet saved phrases for this bucket.
      // Once saved → DB value always wins.  This is the "first open" bootstrap.
      const phrasesToRender = (data.phrases?.length > 0)
        ? data.phrases
        : (DEFAULT_FUC_CLIENT[bucket]?.phrases || []);
      console.log(`[Consent Cards] LOAD.${bucket} — phrases: ${phrasesToRender.length} (${data.phrases?.length > 0 ? 'from DB' : 'starter template'}), response: "${data.response || ''}", direction: "${data.direction || ''}"`);
      renderFucPhrases(bucket, phrasesToRender);
      const respEl = document.getElementById(`fuc-${bucket}-response`);
      if (respEl) respEl.value = data.response || '';
      else console.warn(`[Consent Cards] LOAD — fuc-${bucket}-response element NOT found`);
      const dirEl = document.getElementById(`fuc-${bucket}-direction`);
      if (dirEl) dirEl.value = data.direction || '';
      else console.log(`[Consent Cards] LOAD — fuc-${bucket}-direction element not found (may be expected)`);
      const modeEl = document.getElementById(`fuc-${bucket}-booking-mode`);
      if (modeEl) modeEl.value = data.bookingMode || '';
    }
    // Load Question Signals — starter template when company has not yet saved
    const signalsToRender = (fuc.yes?.questionSignals?.length > 0)
      ? fuc.yes.questionSignals
      : DEFAULT_FUC_CLIENT.yes.questionSignals;
    renderFucSignals(signalsToRender);
    console.log('[Consent Cards] LOAD — complete');
  }

  function renderFucPhrases(bucket, phrases) {
    const container = document.getElementById(`fuc-${bucket}-phrases`);
    if (!container) return;
    container.innerHTML = '';
    (phrases || []).forEach((phrase, idx) => {
      const tag = document.createElement('span');
      tag.className = 'phrase-tag';
      tag.innerHTML = `${escapeHtml(phrase)} <button type="button" class="phrase-remove" data-bucket="${bucket}" data-index="${idx}">×</button>`;
      container.appendChild(tag);
    });
    container.querySelectorAll('.phrase-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const b = e.target.dataset.bucket;
        const i = parseInt(e.target.dataset.index);
        const arr = getFucPhrases(b);
        arr.splice(i, 1);
        renderFucPhrases(b, arr);
        state.isDirty = true;
      });
    });
  }

  function getFucPhrases(bucket) {
    const container = document.getElementById(`fuc-${bucket}-phrases`);
    if (!container) {
      console.warn(`[Consent Cards] getFucPhrases — container fuc-${bucket}-phrases NOT found`);
      return [];
    }
    const tags = container.querySelectorAll('.phrase-tag');
    console.log(`[Consent Cards] getFucPhrases(${bucket}) — found ${tags.length} phrase-tag elements`);
    return Array.from(tags).map(tag => {
      const clone = tag.cloneNode(true);
      const btn = clone.querySelector('button');
      if (btn) btn.remove();
      return clone.textContent.trim();
    });
  }

  function collectFollowUpConsent() {
    const result = {};
    result.missingResponseAction = (document.getElementById('fuc-missing-response-action')?.value || '').trim();
    for (const bucket of FUC_BUCKETS) {
      result[bucket] = {
        phrases:  getFucPhrases(bucket),
        response: (document.getElementById(`fuc-${bucket}-response`)?.value || '').trim(),
        direction:(document.getElementById(`fuc-${bucket}-direction`)?.value || '').trim(),
        bookingMode:(document.getElementById(`fuc-${bucket}-booking-mode`)?.value || '').trim()
      };
    }
    // Attach question signals into the yes bucket
    result.yes.questionSignals = getFucSignals();
    return result;
  }

  // ── Question Signals helpers (yes bucket only) ──────────────────────────────
  // Renders, reads, and adds phrase chips for the questionSignals field.
  // Follows the same chip-list pattern as renderFucPhrases / getFucPhrases.
  function renderFucSignals(signals) {
    const container = document.getElementById('fuc-yes-question-signals-phrases');
    if (!container) return;
    container.innerHTML = '';
    (signals || []).forEach((signal, idx) => {
      const tag = document.createElement('span');
      tag.className = 'phrase-tag';
      tag.innerHTML = `${escapeHtml(signal)} <button type="button" class="phrase-remove" data-index="${idx}">×</button>`;
      container.appendChild(tag);
    });
    container.querySelectorAll('.phrase-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const i = parseInt(e.target.dataset.index);
        const arr = getFucSignals();
        arr.splice(i, 1);
        renderFucSignals(arr);
        state.isDirty = true;
      });
    });
  }

  function getFucSignals() {
    const container = document.getElementById('fuc-yes-question-signals-phrases');
    if (!container) return [];
    return Array.from(container.querySelectorAll('.phrase-tag')).map(tag => {
      const clone = tag.cloneNode(true);
      clone.querySelector('button')?.remove();
      return clone.textContent.trim();
    });
  }

  window._fucAddSignals = function() {
    const input = document.getElementById('fuc-yes-question-signals-input');
    if (!input) return;
    const newSignals = input.value.split(/[,;\n]+/g).map(p => p.trim().toLowerCase()).filter(Boolean);
    if (newSignals.length === 0) return;
    const existing = new Set(getFucSignals());
    let added = 0;
    for (const s of new Set(newSignals)) {
      if (!existing.has(s)) { existing.add(s); added++; }
    }
    renderFucSignals(Array.from(existing));
    input.value = '';
    state.isDirty = true;
    if (added > 0) showToast('success', 'Added', `Added ${added} signal${added !== 1 ? 's' : ''}.`);
  };

  window._fucAddPhrases = function(bucket) {
    const input = document.getElementById(`fuc-${bucket}-input`);
    if (!input) return;
    const raw = input.value;
    const newPhrases = raw.split(/[,;\n]+/g).map(p => p.trim().toLowerCase()).filter(Boolean);
    if (newPhrases.length === 0) return;
    const existing = new Set(getFucPhrases(bucket));
    let added = 0;
    for (const p of new Set(newPhrases)) {
      if (!existing.has(p)) { existing.add(p); added++; }
    }
    renderFucPhrases(bucket, Array.from(existing));
    input.value = '';
    state.isDirty = true;
    if (added > 0) showToast('success', 'Added', `Added ${added} phrase${added !== 1 ? 's' : ''}.`);
  };

  const btnSaveFuc = document.getElementById('btn-save-followup-consent');
  console.log('[Consent Cards] INIT — btn-save-followup-consent found:', !!btnSaveFuc);

  if (btnSaveFuc) {
    btnSaveFuc.addEventListener('click', async () => {
      console.log('[Consent Cards] ── SAVE CLICKED ──');
      console.log('[Consent Cards] CP1 — companyId:', state.companyId);

      if (!state.companyId) {
        console.error('[Consent Cards] CP1-FAIL — No companyId in state, aborting save');
        showToast('error', 'Save Failed', 'No company ID available');
        return;
      }

      try {
        const followUpConsent = collectFollowUpConsent();
        console.log('[Consent Cards] CP2 — collectFollowUpConsent() result:', JSON.stringify(followUpConsent, null, 2));

        const requiredBuckets = ['yes', 'no', 'reprompt', 'hesitant'];
        const missingResponses = requiredBuckets.filter(bucket => {
          const resp = `${followUpConsent[bucket]?.response || ''}`.trim();
          return !resp;
        });
        if (missingResponses.length > 0) {
          showToast('error', 'Save Failed', `Missing response text for: ${missingResponses.join(', ')}`);
          return;
        }

        for (const bucket of FUC_BUCKETS) {
          const data = followUpConsent[bucket] || {};
          console.log(`[Consent Cards] CP2.${bucket} — phrases: [${(data.phrases || []).join(', ')}] | response: "${data.response || ''}" | direction: "${data.direction || ''}"`);
        }

        const saveUrl = `${CONFIG.API_BASE_AGENT2}/${state.companyId}/agent2/config`;
        const payload = { discovery: { followUpConsent } };
        console.log('[Consent Cards] CP3 — API URL:', saveUrl);
        console.log('[Consent Cards] CP3 — method: PATCH');
        console.log('[Consent Cards] CP3 — payload:', JSON.stringify(payload, null, 2));

        const resp = await AgentConsoleAuth.apiFetch(saveUrl, {
          method: 'PATCH',
          body: payload
        });

        console.log('[Consent Cards] CP4 — Raw API response:', JSON.stringify(resp, null, 2));

        if (resp.success) {
          console.log('[Consent Cards] CP5 — SUCCESS — updating local state');
          if (!state.config) state.config = {};
          if (!state.config.discovery) state.config.discovery = {};
          state.config.discovery.followUpConsent = followUpConsent;
          showToast('success', 'Saved', 'Follow-up consent cards saved.');
          state.isDirty = false;
        } else {
          console.error('[Consent Cards] CP5-FAIL — Server returned success:false', resp);
          showToast('error', 'Save Failed', resp.message || resp.error || 'Server returned failure');
        }
      } catch (err) {
        console.error('[Consent Cards] CP-ERROR — Exception during save:', err);
        console.error('[Consent Cards] CP-ERROR — err.message:', err.message);
        console.error('[Consent Cards] CP-ERROR — err.data:', err.data);
        showToast('error', 'Save Failed', err.message);
      }
    });
  } else {
    console.error('[Consent Cards] INIT-FAIL — btn-save-followup-consent NOT found in DOM');
  }

  /* --------------------------------------------------------------------------
     BULK SELECTION & DELETE
     -------------------------------------------------------------------------- */
  
  function handleSelectAll(e) {
    const isChecked = e.target.checked;
    
    if (isChecked) {
      // Select all visible triggers
      const filtered = state.triggers.filter(t => {
        if (state.scopeFilter === 'global' && t.scope !== 'GLOBAL') return false;
        if (state.scopeFilter === 'local' && t.scope === 'GLOBAL') return false;
        if (!matchesSearchQuery(t, state.searchQuery)) return false;
        return true;
      });
      
      filtered.forEach(t => state.selectedTriggerIds.add(t.triggerId));
    } else {
      state.selectedTriggerIds.clear();
    }
    
    updateBulkActionsBar();
    renderTriggers();
  }
  
  function clearSelection() {
    state.selectedTriggerIds.clear();
    if (DOM.selectAllTriggers) DOM.selectAllTriggers.checked = false;
    updateBulkActionsBar();
    renderTriggers();
  }
  
  function updateBulkActionsBar() {
    const count = state.selectedTriggerIds.size;
    
    if (DOM.bulkActionsBar) {
      DOM.bulkActionsBar.style.display = count > 0 ? 'flex' : 'none';
    }
    if (DOM.bulkSelectedCount) {
      DOM.bulkSelectedCount.textContent = `${count} selected`;
    }
  }
  
  async function handleBulkDelete() {
    const count = state.selectedTriggerIds.size;
    
    if (count === 0) {
      showToast('warning', 'No Selection', 'Please select triggers to delete');
      return;
    }
    
    // Confirmation popup with typed approval
    const confirmText = `DELETE ${count} TRIGGERS`;
    const userInput = prompt(
      `⚠️ DELETE ${count} TRIGGER${count > 1 ? 'S' : ''}?\n\n` +
      `This will permanently delete the selected triggers.\n\n` +
      `To confirm, type exactly: ${confirmText}`
    );
    
    if (userInput !== confirmText) {
      if (userInput !== null) {
        showToast('warning', 'Cancelled', 'Deletion cancelled - confirmation text did not match');
      }
      return;
    }
    
    // Proceed with deletion
    try {
      const selectedIds = Array.from(state.selectedTriggerIds);
      const localTriggers = selectedIds.filter(id => {
        const trigger = state.triggers.find(t => t.triggerId === id);
        return trigger && trigger.scope !== 'GLOBAL';
      });
      
      const globalTriggers = selectedIds.filter(id => {
        const trigger = state.triggers.find(t => t.triggerId === id);
        return trigger && trigger.scope === 'GLOBAL';
      });
      
      let deleted = 0;
      
      // Delete local triggers
      for (const triggerId of localTriggers) {
        // Extract the ruleId - need to find the trigger to get its ruleId
        const trigger = state.triggers.find(t => t.triggerId === triggerId);
        if (!trigger || !trigger.ruleId) {
          console.warn('[Bulk Delete] Could not find ruleId for triggerId:', triggerId);
          continue;
        }
        const url = `${CONFIG.API_BASE_COMPANY}/${state.companyId}/local-triggers/${encodeURIComponent(trigger.ruleId)}`;
        console.log('[Bulk Delete] Deleting local trigger:', trigger.ruleId, 'URL:', url);
        await AgentConsoleAuth.apiFetch(url, { method: 'DELETE' });
        deleted++;
      }
      
      // Delete global triggers (if admin)
      // NOTE: global triggers use originGroupId (not groupId) from buildMergedTriggerList()
      for (const triggerId of globalTriggers) {
        const trigger = state.triggers.find(t => t.triggerId === triggerId);
        const groupId = trigger?.originGroupId || trigger?.groupId;
        if (!trigger || !trigger.ruleId || !groupId) {
          console.warn('[Bulk Delete] Could not find ruleId/originGroupId for global triggerId:', triggerId, 'trigger:', trigger);
          continue;
        }
        const url = `${CONFIG.API_BASE_GLOBAL}/trigger-groups/${encodeURIComponent(groupId)}/triggers/${encodeURIComponent(trigger.ruleId)}`;
        console.log('[Bulk Delete] Deleting global trigger:', trigger.ruleId, 'from group:', groupId, 'URL:', url);
        await AgentConsoleAuth.apiFetch(url, { method: 'DELETE' });
        deleted++;
      }
      
      showToast('success', 'Deleted', `Successfully deleted ${deleted} trigger${deleted > 1 ? 's' : ''}`);
      
      // Clear selection and reload
      state.selectedTriggerIds.clear();
      if (DOM.selectAllTriggers) DOM.selectAllTriggers.checked = false;
      updateBulkActionsBar();
      await loadTriggers();
      
    } catch (err) {
      console.error('[Triggers] Bulk delete failed:', err);
      showToast('error', 'Delete Failed', err.message);
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
