(function() {
  'use strict';

  console.log('[FlowBuilder] Loading...');

  const state = {
    companyId: null,
    steps: [],
    selectedId: null,
    editingId: null,
    panelExpanded: false,
    unsavedChanges: false
  };

  let DOM = {};

  function initDOM() {
    DOM = {
      btnBack: document.getElementById('btn-back'),
      btnExpandPanel: document.getElementById('btn-expand-panel'),
      expandIcon: document.getElementById('expand-icon'),
      expandLabel: document.getElementById('expand-label'),
      flowLayout: document.getElementById('flow-layout'),
      btnAddStep: document.getElementById('btn-add-step'),
      btnSave: document.getElementById('btn-save'),
      btnExport: document.getElementById('btn-export'),
      btnImport: document.getElementById('btn-import'),
      inputImport: document.getElementById('input-import'),
      btnReset: document.getElementById('btn-reset'),
      sequenceList: document.getElementById('sequence-list'),
      flowPreview: document.getElementById('flow-preview'),
      editModal: document.getElementById('edit-modal'),
      modalTitle: document.getElementById('modal-title'),
      inputStepTitle: document.getElementById('input-step-title'),
      inputStepBody: document.getElementById('input-step-body'),
      inputStepSequence: document.getElementById('input-step-sequence'),
      btnCloseModal: document.getElementById('btn-close-modal'),
      btnCancelEdit: document.getElementById('btn-cancel-edit'),
      btnDeleteStep: document.getElementById('btn-delete-step'),
      btnSaveStep: document.getElementById('btn-save-step')
    };
  }

  function init() {
    console.log('[FlowBuilder] Initializing...');
    initDOM();

    const params = new URLSearchParams(window.location.search);
    state.companyId = params.get('companyId');

    if (!state.companyId) {
      window.location.href = '/agent-console/index.html';
      return;
    }

    bindEvents();
    loadSteps();
    render();
  }

  function bindEvents() {
    if (DOM.btnBack) DOM.btnBack.addEventListener('click', () => {
      window.location.href = `/agent-console/callconsole.html?companyId=${state.companyId}`;
    });

    if (DOM.btnExpandPanel) DOM.btnExpandPanel.addEventListener('click', togglePanelWidth);
    if (DOM.btnAddStep) DOM.btnAddStep.addEventListener('click', () => openEditModal(null));
    if (DOM.btnSave) DOM.btnSave.addEventListener('click', saveSteps);
    if (DOM.btnExport) DOM.btnExport.addEventListener('click', exportJSON);
    if (DOM.btnImport) DOM.btnImport.addEventListener('click', () => DOM.inputImport.click());
    if (DOM.inputImport) DOM.inputImport.addEventListener('change', importJSON);
    if (DOM.btnReset) DOM.btnReset.addEventListener('click', resetToDefault);
    
    if (DOM.btnCloseModal) DOM.btnCloseModal.addEventListener('click', closeModal);
    if (DOM.btnCancelEdit) DOM.btnCancelEdit.addEventListener('click', closeModal);
    if (DOM.btnSaveStep) DOM.btnSaveStep.addEventListener('click', saveStep);
    if (DOM.btnDeleteStep) DOM.btnDeleteStep.addEventListener('click', deleteStep);
    
    if (DOM.editModal) {
      DOM.editModal.addEventListener('click', (e) => {
        if (e.target === DOM.editModal) closeModal();
      });
    }
  }

  function togglePanelWidth() {
    state.panelExpanded = !state.panelExpanded;
    
    if (DOM.flowLayout) {
      DOM.flowLayout.classList.toggle('expanded-panel', state.panelExpanded);
    }
    
    if (DOM.expandIcon) {
      DOM.expandIcon.textContent = state.panelExpanded ? '▶▶' : '◀◀';
    }
    if (DOM.expandLabel) {
      DOM.expandLabel.textContent = state.panelExpanded ? 'Collapse' : 'Expand';
    }
  }

  function loadSteps() {
    const storageKey = `flowBuilder.steps:${state.companyId}`;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        state.steps = Array.isArray(parsed) ? parsed : getDefaultSteps();
      } else {
        state.steps = getDefaultSteps();
      }
    } catch (err) {
      console.error('[FlowBuilder] Load error:', err);
      state.steps = getDefaultSteps();
    }
  }

  function saveSteps() {
    const storageKey = `flowBuilder.steps:${state.companyId}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state.steps));
      state.unsavedChanges = false;
      showToast('success', 'Saved!', 'Flow sequence saved to browser storage');
    } catch (err) {
      console.error('[FlowBuilder] Save error:', err);
      showToast('error', 'Save Failed', err.message);
    }
  }

  function getDefaultSteps() {
    return [
      {
        id: 'step_speechresult',
        sequence: 1,
        title: 'SpeechResult Received',
        body: 'Twilio posts Deepgram transcript to /v2-agent-respond\n\n**File:** routes/v2twilio.js:3523\n\n**Data Received:**\n- SpeechResult: Raw transcript\n- CallSid: Unique call identifier\n- Confidence: STT confidence score\n\n**Next:** Pass to ScrabEngine for cleaning'
      },
      {
        id: 'step_scrabengine',
        sequence: 2,
        title: '🔍 ScrabEngine (4-Step Pipeline)',
        body: '**CRITICAL:** Runs FIRST before any decision logic\n\n**File:** services/ScrabEngine.js\n**Called from:** Agent2DiscoveryRunner.js:605\n\n**4-STEP PIPELINE:**\n\n**Step 1:** Filler Removal\n- Remove: "um", "uh", "like", "hi", "hello"\n\n**Step 2:** Vocabulary Expansion\n- "acee" → "air conditioning"\n- "tstat" → "thermostat"\n\n**Step 3:** Synonym Mapping\n- "broken" → "not working"\n\n**Step 4:** Entity Extraction\n- firstName, lastName\n- phone, email, address\n- serviceType, urgency\n\n**Output:** Cleaned text + entities\n**Performance:** <30ms target'
      },
      {
        id: 'step_loadstate',
        sequence: 3,
        title: 'Load Call State',
        body: 'Load conversation history from Redis\n\n**File:** services/engine/StateStore.js\n\n**Loads:**\n- Turn count\n- Session mode (DISCOVERY/BOOKING)\n- Extracted slots (name, phone, etc.)\n- Conversation history\n\n**Key:** `call:{CallSid}`'
      },
      {
        id: 'step_callruntime',
        sequence: 4,
        title: 'CallRuntime.processTurn()',
        body: 'Main orchestrator - routes to correct engine\n\n**File:** services/engine/CallRuntime.js:293\n\n**Decision:**\n```\nIF sessionMode === BOOKING:\n  → Route to BookingLogicEngine\nELSE:\n  → Route to Agent2DiscoveryRunner\n```\n\n**Think of it as:** Traffic cop that directs to the right handler'
      },
      {
        id: 'step_agent2discovery',
        sequence: 5,
        title: 'Agent2DiscoveryRunner.run()',
        body: 'Discovery mode handler (receives CLEANED text from ScrabEngine)\n\n**File:** services/engine/agent2/Agent2DiscoveryRunner.js:396\n\n**Responsibilities:**\n- Greeting detection (on cleaned text)\n- Trigger card matching\n- LLM fallback decisions\n- Response generation\n\n**Input:** normalizedText from ScrabEngine\n**Output:** Response + next state'
      },
      {
        id: 'step_greeting',
        sequence: 6,
        title: '🎭 Greeting Interceptor',
        body: '**V125 FIX:** Now checks CLEANED text (not raw)\n\n**File:** Agent2DiscoveryRunner.js:516-583\n**Function:** Agent2GreetingInterceptor.evaluate()\n\n**What It Does:**\n- Checks if input is pure greeting ("hi", "hello")\n- Short-only gate (≤3-5 words)\n- Checks for intent words to avoid false positives\n\n**V125 Change:**\n- Input: normalizedText (cleaned by ScrabEngine)\n- No longer exits early\n- Stores result, continues to triggers\n\n**Example:**\nRaw: "Hi I need emergency"\nCleaned: "need emergency" (ScrabEngine removed "Hi")\nGreeting Check: NO MATCH (has intent) ✅\nContinues to triggers ✅'
      },
      {
        id: 'step_triggers',
        sequence: 7,
        title: '🎯 Trigger Evaluation',
        body: 'Match cleaned text against trigger card database\n\n**File:** services/engine/agent2/TriggerCardMatcher.js\n**Called from:** Agent2DiscoveryRunner.js:1473-1474\n\n**Process:**\n1. Load compiled triggers (global + company)\n2. Check keywords in cleaned text\n3. Check negative keywords (disqualifiers)\n4. Rank by priority\n5. Return best match\n\n**Example:**\nInput: "need emergency air conditioning service"\nMatched: "Emergency AC Service" (Priority 100)\nKeywords: "emergency", "air conditioning"\nSource: Global Trigger #emerg-ac-001\n\n**Events:** A2_TRIGGER_EVAL, TRIGGER_CARDS_EVALUATED'
      },
      {
        id: 'step_response',
        sequence: 8,
        title: '💬 Response Generation',
        body: '**Priority Order:**\n1. Trigger Card (if matched) ← FASTEST\n2. Greeting Response (if detected, no trigger)\n3. LLM Fallback (GPT-4, max 1-2 per call)\n4. Generic Fallback (last resort)\n\n**If Trigger Matched:**\n- Use answerText from trigger card\n- Use pre-recorded audio (if exists)\n- Skip LLM/TTS (200ms fast path!)\n\n**If No Match:**\n- Check if greeting detected → use greeting\n- Check if LLM allowed → call GPT-4\n- Else: Generic fallback\n\n**Variables Substituted:**\n- {name} → caller name\n- {company} → business name\n- {diagnosticfee} → price from config'
      },
      {
        id: 'step_booking',
        sequence: 9,
        title: '📅 Booking Handoff (Conditional)',
        body: '**ONLY if trigger indicates booking intent**\n\n**File:** services/engine/booking/BookingLogicEngine.js\n\n**When Triggered:**\n- Trigger card has nextAction="BOOKING"\n- OR trigger label contains "schedule", "book", "appointment"\n\n**Entities Passed:**\n- firstName, lastName (from ScrabEngine)\n- phone, email, address\n- serviceType, urgency\n- callReason\n\n**Booking Steps:**\n1. Name collection (skip if already extracted)\n2. Phone verification\n3. Address capture\n4. Service details\n5. Time slot selection\n6. Confirmation\n\n**State Change:** sessionMode → BOOKING'
      }
    ];
  }

  function render() {
    renderSequenceList();
    renderFlowPreview();
  }

  function renderSequenceList() {
    const sorted = [...state.steps].sort((a, b) => a.sequence - b.sequence);
    
    DOM.sequenceList.innerHTML = sorted.map(step => {
      const isExpanded = state.selectedId === step.id;
      const hasBody = step.body && step.body.trim();
      
      return `
        <div class="sequence-item ${isExpanded ? 'expanded' : ''}" data-step-id="${step.id}">
          <div class="sequence-item-header">
            <div class="sequence-item-title">
              <span class="sequence-number">${step.sequence}</span>
              ${hasBody ? `<span class="expand-icon">${isExpanded ? '▼' : '▶'}</span>` : ''}
              <span>${escapeHtml(step.title)}</span>
            </div>
            <div class="sequence-controls">
              <button class="sequence-btn" data-action="edit" data-id="${step.id}" title="Edit">✏️</button>
              <button class="sequence-btn" data-action="up" data-id="${step.id}" title="Move Up">↑</button>
              <button class="sequence-btn" data-action="down" data-id="${step.id}" title="Move Down">↓</button>
            </div>
          </div>
          <div class="sequence-meta">
            <span>Step ${step.sequence}</span>
            <span>•</span>
            <span>${step.id}</span>
          </div>
          ${isExpanded && hasBody ? `
            <div class="sequence-body">${renderMarkdown(step.body)}</div>
          ` : ''}
        </div>
      `;
    }).join('');

    // Attach event listeners
    DOM.sequenceList.querySelectorAll('.sequence-item-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const item = e.target.closest('.sequence-item');
        const id = item.dataset.stepId;
        state.selectedId = state.selectedId === id ? null : id;
        render();
      });
    });

    DOM.sequenceList.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        
        if (action === 'edit') openEditModal(id);
        else if (action === 'up') moveStep(id, -1);
        else if (action === 'down') moveStep(id, 1);
      });
    });
  }

  function renderFlowPreview() {
    const sorted = [...state.steps].sort((a, b) => a.sequence - b.sequence);
    
    DOM.flowPreview.innerHTML = sorted.map((step, idx) => {
      return `
        <div class="flow-step">
          <div class="flow-step-num">${step.sequence}</div>
          <div class="flow-step-content">
            <div class="flow-step-title">${escapeHtml(step.title)}</div>
            <div class="flow-step-desc">${getFirstLine(step.body)}</div>
            <div class="flow-step-file">${extractFile(step.body)}</div>
          </div>
        </div>
        ${idx < sorted.length - 1 ? '<div class="flow-arrow">↓</div>' : ''}
      `;
    }).join('');
  }

  function getFirstLine(text) {
    if (!text) return '';
    const lines = text.split('\n').filter(l => l.trim() && !l.trim().startsWith('**'));
    return escapeHtml(lines[0] || '').substring(0, 150);
  }

  function extractFile(text) {
    if (!text) return '';
    const match = text.match(/\*\*File:\*\*\s*([^\n]+)/);
    return match ? escapeHtml(match[1].trim()) : '';
  }

  function renderMarkdown(text) {
    if (!text) return '';
    
    // Simple markdown rendering
    let html = escapeHtml(text);
    
    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // Code blocks
    html = html.replace(/```([^`]+)```/g, '<code>$1</code>');
    
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    
    return html;
  }

  function moveStep(stepId, direction) {
    const sorted = [...state.steps].sort((a, b) => a.sequence - b.sequence);
    const index = sorted.findIndex(s => s.id === stepId);
    
    if (index < 0) return;
    
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sorted.length) return;
    
    // Swap sequences
    const temp = sorted[index].sequence;
    sorted[index].sequence = sorted[targetIndex].sequence;
    sorted[targetIndex].sequence = temp;
    
    state.unsavedChanges = true;
    saveSteps();
    render();
  }

  function openEditModal(stepId) {
    state.editingId = stepId;
    
    if (stepId) {
      const step = state.steps.find(s => s.id === stepId);
      if (step) {
        DOM.modalTitle.textContent = 'Edit Step';
        DOM.inputStepTitle.value = step.title || '';
        DOM.inputStepBody.value = step.body || '';
        DOM.inputStepSequence.value = step.sequence || '';
        DOM.btnDeleteStep.style.display = 'block';
      }
    } else {
      DOM.modalTitle.textContent = 'Add New Step';
      DOM.inputStepTitle.value = '';
      DOM.inputStepBody.value = '';
      const maxSeq = Math.max(0, ...state.steps.map(s => s.sequence));
      DOM.inputStepSequence.value = maxSeq + 1;
      DOM.btnDeleteStep.style.display = 'none';
    }
    
    DOM.editModal.classList.add('open');
    DOM.inputStepTitle.focus();
  }

  function closeModal() {
    state.editingId = null;
    DOM.editModal.classList.remove('open');
  }

  function saveStep() {
    const title = DOM.inputStepTitle.value.trim();
    const body = DOM.inputStepBody.value.trim();
    const sequence = parseInt(DOM.inputStepSequence.value) || 1;
    
    if (!title) {
      showToast('error', 'Validation Error', 'Step title is required');
      return;
    }
    
    if (state.editingId) {
      // Update existing
      const step = state.steps.find(s => s.id === state.editingId);
      if (step) {
        step.title = title;
        step.body = body;
        step.sequence = sequence;
      }
    } else {
      // Create new
      const newStep = {
        id: `step_${Date.now()}`,
        sequence,
        title,
        body
      };
      state.steps.push(newStep);
    }
    
    state.unsavedChanges = true;
    saveSteps();
    closeModal();
    render();
  }

  function deleteStep() {
    if (!state.editingId) return;
    
    if (!confirm('Delete this step? This cannot be undone.')) return;
    
    state.steps = state.steps.filter(s => s.id !== state.editingId);
    state.unsavedChanges = true;
    saveSteps();
    closeModal();
    render();
  }

  function exportJSON() {
    const data = {
      companyId: state.companyId,
      exportedAt: new Date().toISOString(),
      version: 'V125',
      steps: state.steps
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flow-sequence-${state.companyId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('success', 'Exported!', 'Flow sequence downloaded as JSON');
  }

  function importJSON(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.steps && Array.isArray(data.steps)) {
          state.steps = data.steps;
          state.unsavedChanges = true;
          saveSteps();
          render();
          showToast('success', 'Imported!', `Loaded ${data.steps.length} steps`);
        } else {
          showToast('error', 'Import Failed', 'Invalid JSON format');
        }
      } catch (err) {
        showToast('error', 'Import Failed', err.message);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function resetToDefault() {
    if (!confirm('Reset to default sequence? This will lose your current changes.')) return;
    
    state.steps = getDefaultSteps();
    state.unsavedChanges = false;
    saveSteps();
    render();
    showToast('success', 'Reset Complete', 'Flow sequence reset to default');
  }

  function showToast(type, title, message) {
    console.log(`[FlowBuilder] ${type.toUpperCase()}: ${title} - ${message}`);
    // TODO: Add visual toast notifications
    alert(`${title}\n\n${message}`);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
