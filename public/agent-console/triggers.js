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
    statHidden: document.getElementById('stat-hidden'),
    statTotal: document.getElementById('stat-total'),
    
    triggerList: document.getElementById('trigger-list'),
    triggerTableHeader: document.getElementById('trigger-table-header'),
    emptyState: document.getElementById('empty-state'),
    triggerSearch: document.getElementById('trigger-search'),
    duplicateWarning: document.getElementById('duplicate-warning'),
    duplicateWarningText: document.getElementById('duplicate-warning-text'),
    
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
      
      state.companyName = companyName;
      state.activeGroupId = activeGroupId;
      state.activeGroupName = activeGroupName;
      state.triggers = triggers;
      state.stats = stats;
      state.permissions = permissions;
      state.availableGroups = availableGroups;
      
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
    DOM.statLocal.textContent = state.stats.localCount || 0;
    DOM.statOverrides.textContent = state.stats.overrideCount || 0;
    DOM.statHidden.textContent = state.stats.globalHiddenCount || 0;
    DOM.statTotal.textContent = state.stats.totalActiveCount || 0;
  }

  function renderTriggers() {
    const filtered = state.triggers.filter(t => {
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
        
        if (scope === 'GLOBAL') {
          await toggleGlobalTriggerVisibility(triggerId, enabled);
        } else {
          await toggleLocalTriggerEnabled(triggerId, enabled);
        }
      });
    });
  }

  function renderTriggerRow(trigger) {
    let scopeClass = 'local';
    let scopeLabel = 'Local';
    if (trigger.scope === 'GLOBAL') {
      scopeClass = 'global';
      scopeLabel = 'Global';
    } else if (trigger.isOverridden) {
      scopeClass = 'override';
      scopeLabel = 'Override';
    }
    
    const keywords = (trigger.match?.keywords || []).slice(0, 4).join(', ');
    const hasText = trigger.answer?.answerText ? true : false;
    const hasAudio = trigger.answer?.hasAudio || trigger.answer?.audioUrl;
    const isEnabled = trigger.isEnabled !== false;
    
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
          ${!hasText && !hasAudio ? '<span style="color: var(--text-muted);">—</span>' : ''}
        </div>
        <div class="trigger-followup ${followUpClass}" title="${escapeHtml(followUpDisplay)}">${escapeHtml(followUpDisplay)}</div>
        <div>
          <span class="scope-badge ${scopeClass}">${scopeLabel}</span>
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
    
    try {
      await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/active-group`, {
        method: 'PUT',
        body: { groupId: newGroupId }
      });
      
      showToast('success', 'Group Changed', newGroupId ? `Now using "${newGroupId}" triggers` : 'No group selected');
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
          await apiFetch(`${CONFIG.API_BASE_GLOBAL}/trigger-groups/${groupId}/triggers/${ruleId}`, {
            method: 'PATCH',
            body: payload
          });
        } else {
          await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/local-triggers/${ruleId}`, {
            method: 'PATCH',
            body: payload
          });
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
    DOM.inputApproval.value = '';
    DOM.modalApproval.classList.add('active');
    DOM.inputApproval.focus();
  }

  function closeApprovalModal() {
    DOM.modalApproval.classList.remove('active');
    state.pendingApproval = null;
  }

  async function confirmApproval() {
    const approvalText = DOM.inputApproval.value.trim().toLowerCase();
    
    if (approvalText !== 'approved') {
      showToast('error', 'Approval Required', 'Please type "approved" to confirm.');
      return;
    }
    
    if (!state.pendingApproval) {
      return;
    }
    
    const { action, trigger } = state.pendingApproval;
    
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
      }
      
      closeApprovalModal();
      await loadTriggers();
      
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
      
      showToast('success', visible ? 'Enabled' : 'Disabled', `Trigger ${visible ? 'enabled' : 'hidden'} for this company.`);
      await loadTriggers();
      
    } catch (error) {
      console.error('[Triggers] Visibility toggle failed:', error);
      showToast('error', 'Failed', 'Could not change trigger visibility.');
      await loadTriggers();
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
      
      showToast('success', enabled ? 'Enabled' : 'Disabled', `Trigger ${enabled ? 'enabled' : 'disabled'}.`);
      await loadTriggers();
      
    } catch (error) {
      console.error('[Triggers] Enable toggle failed:', error);
      showToast('error', 'Failed', 'Could not change trigger status.');
      await loadTriggers();
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
