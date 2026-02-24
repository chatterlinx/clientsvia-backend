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
    
    editingTrigger: null,
    pendingApproval: null,
    
    searchQuery: '',
    scopeFilter: 'all',
    
    // Company Variables
    companyVariables: new Map(),
    detectedVariables: new Set(),
    
    // GPT Settings
    gptSettings: {
      businessType: 'hvac',
      defaultPriority: 50,
      tone: 'friendly',
      instructions: '',
      includeFollowup: true
    }
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
    btnCheckDuplicates: document.getElementById('btn-check-duplicates'),
    btnCreateGroup: document.getElementById('btn-create-group'),
    
    groupSelector: document.getElementById('group-selector'),
    groupIcon: document.getElementById('group-icon'),
    groupTriggerCount: document.getElementById('group-trigger-count'),
    groupInfo: document.getElementById('group-info'),
    
    statGlobal: document.getElementById('stat-global'),
    statLocal: document.getElementById('stat-local'),
    statOverrides: document.getElementById('stat-overrides'),
    statTotal: document.getElementById('stat-total'),
    statDisabled: document.getElementById('stat-disabled'),
    
    triggerList: document.getElementById('trigger-list'),
    triggerTableHeader: document.getElementById('trigger-table-header'),
    emptyState: document.getElementById('empty-state'),
    triggerSearch: document.getElementById('trigger-search'),
    duplicateWarning: document.getElementById('duplicate-warning'),
    duplicateWarningText: document.getElementById('duplicate-warning-text'),
    
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
    gptBusinessType: document.getElementById('gpt-business-type'),
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
    loadTriggers();
  }

  function extractCompanyId() {
    const params = new URLSearchParams(window.location.search);
    state.companyId = params.get('companyId');
    
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
    DOM.btnCheckDuplicates.addEventListener('click', checkDuplicates);
    
    DOM.triggerSearch.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.toLowerCase();
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
      
      DOM.headerCompanyName.textContent = state.companyName;
      
      renderGroupSelector();
      renderStats();
      renderTriggers();
      
    } catch (error) {
      console.error('[Triggers] Failed to load:', error);
      showToast('error', 'Load Failed', 'Could not load trigger data.');
    }
  }

  /* --------------------------------------------------------------------------
     RENDERING
     -------------------------------------------------------------------------- */
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
    DOM.statOverrides.textContent = state.stats.overrideCount || 0;
    DOM.statTotal.textContent = state.stats.totalActiveCount || 0;
    
    if (DOM.statDisabled) {
      DOM.statDisabled.textContent = state.stats.totalDisabledCount || 0;
    }
    
    console.log('[Triggers] Stats updated:', state.stats);
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
      
      // Apply search filter
      if (!state.searchQuery) {
        return true;
      }
      const label = (t.label || '').toLowerCase();
      const ruleId = (t.ruleId || '').toLowerCase();
      const keywords = (t.match?.keywords || []).join(' ').toLowerCase();
      return label.includes(state.searchQuery) || 
             ruleId.includes(state.searchQuery) || 
             keywords.includes(state.searchQuery);
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
  
  function extractAndRenderVariables() {
    state.detectedVariables.clear();
    
    for (const trigger of state.triggers) {
      const answerText = trigger.answer?.answerText || '';
      const followUpQuestion = trigger.followUp?.question || '';
      
      const answerVars = extractVariablesFromText(answerText);
      const followUpVars = extractVariablesFromText(followUpQuestion);
      
      [...answerVars, ...followUpVars].forEach(v => state.detectedVariables.add(v));
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
      const value = state.companyVariables.get(varName) || '';
      const hasValue = value.trim().length > 0;
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
    const hasText = trigger.answer?.answerText ? true : false;
    const hasAudio = trigger.answer?.hasAudio || trigger.answer?.audioUrl;
    const audioNeedsRegeneration = trigger.answer?.audioNeedsRegeneration;
    const isEnabled = trigger.isEnabled !== false;
    const isGlobalScope = trigger.scope === 'GLOBAL';
    
    const priority = trigger.priority || 50;
    const priorityLabel = getPriorityLabel(priority);
    const priorityClass = getPriorityClass(priority);
    
    const ruleId = trigger.ruleId || '—';
    
    const followUpAction = trigger.followUp?.nextAction || trigger.followUp?.question;
    const followUpDisplay = followUpAction ? formatFollowUpAction(followUpAction) : 'None';
    const followUpClass = followUpAction ? '' : 'none';
    
    return `
      <div class="trigger-row ${isEnabled ? '' : 'disabled'}">
        <div>
          <span class="trigger-priority ${priorityClass}">${priorityLabel}</span>
        </div>
        <div class="trigger-rule-id" title="${escapeHtml(ruleId)}">${escapeHtml(ruleId)}</div>
        <div class="trigger-label" title="${escapeHtml(trigger.label || 'Untitled')}">${escapeHtml(trigger.label || 'Untitled')}</div>
        <div class="trigger-keywords" title="${escapeHtml((trigger.match?.keywords || []).join(', '))}">${escapeHtml(keywords) || '—'}</div>
        <div class="answer-format">
          ${hasText ? '<span class="answer-badge text">TEXT</span>' : ''}
          ${hasAudio ? '<span class="answer-badge audio">AUDIO</span>' : ''}
          ${audioNeedsRegeneration ? '<span class="answer-badge stale" title="Variable value changed - regenerate audio">⚠️ STALE</span>' : ''}
          ${!hasText && !hasAudio && !audioNeedsRegeneration ? '<span style="color: var(--text-muted);">—</span>' : ''}
        </div>
        <div class="trigger-followup ${followUpClass}" title="${escapeHtml(followUpDisplay)}">${escapeHtml(followUpDisplay)}</div>
        <div>
          ${isGlobalScope ? 
            '<span class="scope-badge global" title="Global triggers cannot be converted back to LOCAL">GLOBAL</span>' :
            `<label class="toggle-switch" title="Local (click to convert to Global - cannot be reversed)">
              <input type="checkbox" class="toggle-scope" 
                     data-trigger-id="${trigger.triggerId}">
              <span class="toggle-slider"></span>
            </label>`
          }
        </div>
        <div>
          <label class="toggle-switch">
            <input type="checkbox" class="toggle-enabled" 
                   data-trigger-id="${trigger.triggerId}" 
                   data-scope="${trigger.scope}"
                   ${isEnabled ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
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
      DOM.scopeSection.style.display = 'none';
      
      // Show audio status based on whether audio needs regeneration
      if (DOM.audioStatusHint) {
        if (trigger.answer?.audioNeedsRegeneration) {
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
      DOM.inputTriggerLocal.checked = true;
      DOM.scopeSection.style.display = 'block';
      
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
    const answerText = DOM.inputTriggerAnswer.value.trim();
    const audioUrl = DOM.inputTriggerAudio.value.trim();
    const followUpQuestion = DOM.inputTriggerFollowup.value.trim();
    
    if (!label || !ruleId || !answerText) {
      showToast('error', 'Validation Error', 'Label, Rule ID, and Answer Text are required.');
      return;
    }
    
    if (!/^[a-z0-9_.]+$/.test(ruleId)) {
      showToast('error', 'Invalid Rule ID', 'Use lowercase letters, numbers, dots, underscores only.');
      return;
    }
    
    const payload = {
      ruleId,
      label,
      priority,
      keywords,
      phrases,
      negativeKeywords,
      answerText,
      audioUrl,
      followUpQuestion
    };
    
    try {
      if (state.editingTrigger) {
        const scope = state.editingTrigger.scope;
        
        if (scope === 'GLOBAL') {
          if (!state.permissions?.canEditGlobalTriggers) {
            showToast('error', 'Permission Denied', 'You cannot edit global triggers.');
            return;
          }
          
          const groupId = state.editingTrigger.originGroupId;
          const result = await apiFetch(`${CONFIG.API_BASE_GLOBAL}/trigger-groups/${groupId}/triggers/${ruleId}`, {
            method: 'PATCH',
            body: payload
          });
          
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
    
    currentAudio.play();
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
    if (DOM.gptBusinessType) {
      DOM.gptBusinessType.value = state.gptSettings.businessType;
    }
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

  function saveGptSettings() {
    state.gptSettings.businessType = DOM.gptBusinessType?.value || 'hvac';
    state.gptSettings.defaultPriority = parseInt(DOM.gptDefaultPriority?.value, 10) || 50;
    state.gptSettings.tone = DOM.gptTone?.value || 'friendly';
    state.gptSettings.instructions = DOM.gptInstructions?.value || '';
    state.gptSettings.includeFollowup = DOM.gptIncludeFollowup?.checked !== false;
    
    closeGptSettingsModal();
    showToast('success', 'Settings Saved', 'GPT prefill settings updated.');
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
      if (response.phrases && Array.isArray(response.phrases) && DOM.inputTriggerPhrases) {
        DOM.inputTriggerPhrases.value = response.phrases.join(', ');
      }
      if (response.negativeKeywords && Array.isArray(response.negativeKeywords) && DOM.inputTriggerNegative) {
        DOM.inputTriggerNegative.value = response.negativeKeywords.join(', ');
      }
      if (response.answerText && DOM.inputTriggerAnswer) {
        DOM.inputTriggerAnswer.value = response.answerText;
      }
      if (response.followUpQuestion && DOM.inputTriggerFollowup && state.gptSettings.includeFollowup) {
        DOM.inputTriggerFollowup.value = response.followUpQuestion;
      }
      if (response.ruleId && DOM.inputTriggerRuleId) {
        const existingRuleId = DOM.inputTriggerRuleId.value.trim();
        if (!existingRuleId) {
          DOM.inputTriggerRuleId.value = response.ruleId;
        }
      }
      if (DOM.inputTriggerPriority && !state.editingTrigger) {
        DOM.inputTriggerPriority.value = state.gptSettings.defaultPriority;
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
    
    const businessTypeLabels = {
      hvac: 'HVAC / Air Conditioning',
      plumbing: 'Plumbing',
      electrical: 'Electrical',
      roofing: 'Roofing',
      dental: 'Dental Office',
      medical: 'Medical Practice',
      legal: 'Law Firm',
      automotive: 'Automotive / Mechanic',
      landscaping: 'Landscaping',
      cleaning: 'Cleaning Services',
      general: 'General Service Business'
    };
    
    const toneDescriptions = {
      friendly: 'friendly and conversational',
      professional: 'professional and formal',
      casual: 'casual and relaxed',
      empathetic: 'empathetic and supportive'
    };
    
    const businessLabel = businessTypeLabels[state.gptSettings.businessType] || 'Service Business';
    const toneDesc = toneDescriptions[state.gptSettings.tone] || 'friendly and conversational';
    
    const response = await fetch(`/api/admin/agent2/${state.companyId}/gpt-prefill-advanced`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        keywords: keywords,
        businessType: state.gptSettings.businessType,
        businessLabel: businessLabel,
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
        DOM.duplicateWarning.style.display = 'none';
        showToast('success', 'All Clear', 'No duplicate triggers found.');
      } else {
        const count = (data.localDuplicates?.length || 0) + (data.mergedDuplicates?.length || 0);
        DOM.duplicateWarningText.textContent = `${count} duplicate rule ID(s) detected. This may cause unexpected behavior.`;
        DOM.duplicateWarning.style.display = 'flex';
        showToast('warning', 'Duplicates Found', `${count} duplicate(s) detected.`);
      }
      
    } catch (error) {
      console.error('[Triggers] Health check failed:', error);
      showToast('error', 'Check Failed', 'Could not check for duplicates.');
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
    
    return data.data || data;
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
     BOOTSTRAP
     -------------------------------------------------------------------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
