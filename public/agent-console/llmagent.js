/**
 * ============================================================================
 * LLM AGENT — Discovery Configuration Controller
 * ============================================================================
 *
 * 3-column layout: Config (tabbed) | Knowledge Cards | Live Preview + Test
 *
 * Settings: /api/agent-console/:companyId/llm-agent/config
 * All settings are UI-configurable. No hardcoded values in runtime.
 * ============================================================================
 */

// ════════════════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════════════════

const state = {
  companyId: null,
  companyName: '',
  config: null,           // merged defaults + saved config
  availableModels: [],
  dirty: false,
  activeConfigTab: 'model',
  activeFilter: 'all',
  testChannel: 'call',
  testMessages: [],       // [{role: 'user'|'assistant', content}]
  modalCardType: null,
  editingCardId: null,     // null = add, string = edit
  scrapedContent: null     // temp storage for website scrape result
};

// ════════════════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  state.companyId = urlParams.get('companyId');

  if (!state.companyId) {
    showToast('error', 'Missing companyId parameter');
    return;
  }

  setupConfigTabs();
  setupFilterChips();
  setupChannelTabs();
  setupEventListeners();
  await loadSettings();
});

// ════════════════════════════════════════════════════════════════════════════
// API
// ════════════════════════════════════════════════════════════════════════════

async function loadSettings() {
  try {
    showLoadingState();
    const data = await AgentConsoleAuth.apiFetch(
      `/api/agent-console/${state.companyId}/llm-agent/config`
    );

    state.config = data.config;
    state.availableModels = data.availableModels || [];
    state.companyName = data.companyName || '';

    renderAll();
    hideLoadingState();
  } catch (error) {
    console.error('[LLMAgent] Load error:', error);
    showToast('error', `Failed to load settings: ${error.message}`);
    hideLoadingState();
  }
}

async function saveSettings() {
  try {
    showLoadingState();
    const data = await AgentConsoleAuth.apiFetch(
      `/api/agent-console/${state.companyId}/llm-agent/config`, {
        method: 'PATCH',
        body: JSON.stringify(state.config)
      }
    );

    state.config = data.config;
    state.dirty = false;
    updateSaveButton();

    const ts = document.getElementById('footer-last-saved');
    if (ts) ts.textContent = `Last saved: ${new Date().toLocaleTimeString()}`;

    const statusEl = document.getElementById('footer-save-status');
    if (statusEl) statusEl.textContent = 'All changes saved';

    showToast('success', 'Settings saved successfully');
    hideLoadingState();
  } catch (error) {
    console.error('[LLMAgent] Save error:', error);
    showToast('error', `Failed to save: ${error.message}`);
    hideLoadingState();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// RENDERING
// ════════════════════════════════════════════════════════════════════════════

function renderAll() {
  updateCompanyHeader();
  renderModelPanel();
  renderActivationPanel();
  renderGuardrailsPanel();
  renderKnowledgeCards();
  renderPromptPreview();
}

function updateCompanyHeader() {
  const name = state.companyName || `Company ${state.companyId}`;
  const nameEl = document.getElementById('header-company-name');
  const idEl = document.getElementById('header-company-id');
  if (nameEl) nameEl.textContent = name;
  if (idEl) idEl.textContent = state.companyId;
}

// ── Model & Persona Panel ────────────────────────────────────────────────

function renderModelPanel() {
  const c = state.config;
  if (!c) return;

  // Master toggle
  setChecked('agent-enabled', c.enabled);
  const wrapper = document.getElementById('master-toggle-wrapper');
  if (wrapper) wrapper.classList.toggle('enabled', !!c.enabled);

  // Model selector
  const modelSelect = document.getElementById('model-select');
  if (modelSelect) {
    modelSelect.innerHTML = state.availableModels.map(m =>
      `<option value="${m.id}" ${m.id === c.model?.modelId ? 'selected' : ''}>${m.label}</option>`
    ).join('');
    updateModelDescription();
  }

  // Sliders
  setSlider('temperature-slider', 'temperature-value', c.model?.temperature ?? 0.7);
  setSlider('max-tokens-slider', 'max-tokens-value', c.model?.maxTokens ?? 300);
  setSlider('chattiness-slider', 'chattiness-value', c.persona?.chattiness ?? 3);

  // Persona fields
  setValue('persona-name', c.persona?.name || '');
  setValue('persona-role', c.persona?.role || 'receptionist');
  setValue('persona-tone', c.persona?.tone || 'friendly-professional');
  setValue('persona-language', c.persona?.language || 'en');
}

function updateModelDescription() {
  const select = document.getElementById('model-select');
  const descEl = document.getElementById('model-description');
  if (!select || !descEl) return;
  const model = state.availableModels.find(m => m.id === select.value);
  descEl.textContent = model?.description || '';
}

// ── Activation Panel ─────────────────────────────────────────────────────

function renderActivationPanel() {
  const c = state.config;
  if (!c) return;

  setChecked('channel-call', c.activation?.channels?.call ?? true);
  setChecked('channel-sms', c.activation?.channels?.sms ?? true);
  setChecked('channel-webchat', c.activation?.channels?.webchat ?? true);
  setChecked('activation-trigger-fallback', c.activation?.triggerFallback ?? true);
  setChecked('activation-followup-rescue', c.activation?.followUpRescue ?? true);

  setSlider('low-confidence-slider', 'low-confidence-value', c.activation?.lowConfidenceThreshold ?? 0.4);
  setSlider('max-turns-slider', 'max-turns-value', c.activation?.maxTurnsPerSession ?? 10);

  const silenceMs = c.activation?.silenceTimeoutMs ?? 8000;
  setSlider('silence-timeout-slider', 'silence-timeout-value', silenceMs, v => `${v / 1000}s`);
}

// ── Guardrails & Handoff Panel ───────────────────────────────────────────

function renderGuardrailsPanel() {
  const c = state.config;
  if (!c) return;

  setChecked('guard-no-pii', c.guardrails?.noPiiCollection ?? true);
  setChecked('guard-no-scheduling', c.guardrails?.noScheduling ?? true);
  setChecked('guard-no-pricing', c.guardrails?.noPricing ?? true);
  setChecked('guard-no-medical', c.guardrails?.noMedicalAdvice ?? true);
  setChecked('guard-no-legal', c.guardrails?.noLegalAdvice ?? true);

  // Custom rules
  renderCustomRules();

  // Handoff
  setValue('handoff-mode', c.handoff?.mode || 'auto');
  setChecked('handoff-intent', c.handoff?.passIntent ?? true);
  setChecked('handoff-context', c.handoff?.passContext ?? true);
  setChecked('handoff-sentiment', c.handoff?.passSentiment ?? true);
  setChecked('handoff-history', c.handoff?.passConversationHistory ?? true);
  setValue('escalation-message', c.handoff?.escalationMessage || '');
}

function renderCustomRules() {
  const list = document.getElementById('custom-rules-list');
  if (!list) return;

  const rules = state.config?.guardrails?.customRules || [];
  if (rules.length === 0) {
    list.innerHTML = '<p style="font-size: var(--font-size-xs); color: var(--color-gray-400); padding: var(--space-2) 0;">No custom rules yet</p>';
    return;
  }

  list.innerHTML = rules.map((r, i) => `
    <div class="custom-rule-item">
      <span>${escapeHtml(r.rule)}</span>
      <button class="btn-remove" data-rule-index="${i}" title="Remove">&times;</button>
    </div>
  `).join('');

  // Wire remove buttons
  list.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.ruleIndex);
      state.config.guardrails.customRules.splice(idx, 1);
      renderCustomRules();
      markDirty();
    });
  });
}

// ── Knowledge Cards ──────────────────────────────────────────────────────

function renderKnowledgeCards() {
  const container = document.getElementById('cards-list');
  if (!container) return;

  const cards = state.config?.knowledgeCards || [];
  const filter = state.activeFilter;
  const filtered = filter === 'all' ? cards : cards.filter(c => c.type === filter);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="cards-empty">
        <div class="cards-empty-icon">📚</div>
        <div class="cards-empty-text">${cards.length === 0 ? 'No knowledge cards yet. Add some to make your agent smarter!' : 'No cards match this filter.'}</div>
        ${cards.length === 0 ? '<button class="btn btn-primary btn-sm" onclick="openAddCardModal()">+ Add Your First Card</button>' : ''}
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(card => {
    const typeIcons = { trigger: '🎯', company: '🏢', website: '🌐', custom: '📝' };
    const icon = typeIcons[card.type] || '📄';
    const badgeColors = { trigger: 'badge-info', company: 'badge-warning', website: 'badge-success', custom: 'badge-neutral' };
    const disabledClass = card.enabled === false ? 'disabled' : '';

    return `
      <div class="knowledge-card ${disabledClass}" data-card-id="${card.id}">
        <div class="kc-icon ${card.type}">${icon}</div>
        <div class="kc-body">
          <div class="kc-header">
            <h4 class="kc-title">${escapeHtml(card.title || 'Untitled')}</h4>
            <span class="badge ${badgeColors[card.type] || 'badge-neutral'}">${card.type}</span>
            <label class="toggle-switch" style="margin-left: auto;">
              <input type="checkbox" ${card.enabled !== false ? 'checked' : ''} onchange="toggleCard('${card.id}', this.checked)">
              <span class="toggle-slider"></span>
            </label>
          </div>
          <p class="kc-content">${escapeHtml((card.content || '').substring(0, 200))}</p>
        </div>
        <div class="kc-actions">
          <button class="btn-icon-sm" onclick="editCard('${card.id}')" title="Edit">&#9998;</button>
          <button class="btn-icon-sm" onclick="deleteCard('${card.id}')" title="Delete">&#128465;</button>
        </div>
      </div>
    `;
  }).join('');
}

// ── Prompt Preview ───────────────────────────────────────────────────────

function renderPromptPreview() {
  const previewEl = document.getElementById('prompt-preview');
  const tokenEl = document.getElementById('token-count');
  if (!previewEl || !state.config) return;

  const prompt = composeSystemPromptLocal(state.config, state.testChannel);
  previewEl.textContent = prompt;

  // Estimate tokens (~4 chars/token)
  const tokenEstimate = Math.ceil(prompt.length / 4);
  if (tokenEl) tokenEl.textContent = tokenEstimate.toLocaleString();
}

/**
 * Client-side system prompt composition (mirrors server-side logic).
 */
function composeSystemPromptLocal(config, channel) {
  if (config.systemPrompt && config.systemPrompt.trim()) {
    return config.systemPrompt.trim();
  }

  const ROLE_DESC = {
    receptionist: 'You are a receptionist answering incoming calls/messages for the business.',
    assistant: 'You are a virtual assistant helping customers with their inquiries.',
    concierge: 'You are a concierge providing personalized guidance and recommendations.'
  };
  const TONE_DESC = {
    'friendly-professional': 'Warm but businesslike. Smile in your voice but stay on task.',
    formal: 'Professional and courteous. Use proper titles. No slang or contractions.',
    casual: 'Relaxed and approachable. Use contractions. Like talking to a friend.',
    warm: 'Empathetic and caring. Show understanding. Patient and supportive.'
  };
  const CHAT_DESC = {
    1: 'Extremely brief. One sentence max. No filler words.',
    2: 'Brief and direct. Short sentences. Minimal pleasantries.',
    3: 'Balanced and natural. Polite but efficient. Like a professional receptionist.',
    4: 'Conversational and warm. Use natural transitions. Show genuine interest.',
    5: 'Chatty and engaging. Build rapport. Use colloquial language.'
  };
  const CHANNEL_DESC = {
    call: 'This is a PHONE CALL. Keep responses SHORT (1-2 sentences). Speak naturally. Avoid lists or URLs.',
    sms: 'This is an SMS conversation. Keep messages concise but complete.',
    webchat: 'This is a WEBCHAT conversation. You can be slightly more detailed.'
  };

  const parts = [];

  parts.push(ROLE_DESC[config.persona?.role] || ROLE_DESC.receptionist);
  if (config.persona?.name) parts.push(`Your name is ${config.persona.name}.`);
  parts.push(TONE_DESC[config.persona?.tone] || TONE_DESC['friendly-professional']);
  parts.push(CHAT_DESC[config.persona?.chattiness || 3] || CHAT_DESC[3]);
  parts.push(CHANNEL_DESC[channel] || CHANNEL_DESC.call);

  parts.push(
    'Your PRIMARY PURPOSE is DISCOVERY — find out why the customer is calling and route them to the right help.',
    'You do NOT book appointments. You do NOT collect personal information. You do NOT quote prices.',
    'Once you understand the caller\'s intent, hand off to the appropriate department or booking system.'
  );

  // Guardrails
  const g = config.guardrails || {};
  const rules = [];
  if (g.noPiiCollection)  rules.push('NEVER collect personal identifying information.');
  if (g.noScheduling)     rules.push('NEVER schedule, book, or confirm appointments.');
  if (g.noPricing)        rules.push('NEVER quote prices, fees, or estimates.');
  if (g.noMedicalAdvice)  rules.push('NEVER provide medical advice or diagnoses.');
  if (g.noLegalAdvice)    rules.push('NEVER provide legal advice or interpretations.');
  if (g.customRules) {
    for (const cr of g.customRules) {
      if (cr.rule && cr.rule.trim()) rules.push(cr.rule.trim());
    }
  }
  if (rules.length > 0) {
    parts.push('\nRULES YOU MUST FOLLOW:');
    rules.forEach((r, i) => parts.push(`${i + 1}. ${r}`));
  }

  // Handoff
  const h = config.handoff || {};
  if (h.mode === 'auto') {
    parts.push('\nWhen you\'ve identified intent, smoothly transition to handoff.');
  } else if (h.mode === 'manual') {
    parts.push('\nAfter discovering intent, ask if they\'d like to be connected.');
  }
  if (h.escalationMessage) {
    parts.push(`Default escalation phrase: "${h.escalationMessage}"`);
  }

  // Knowledge cards
  const cards = (config.knowledgeCards || []).filter(c => c.enabled !== false);
  if (cards.length > 0) {
    parts.push('\n=== KNOWLEDGE BASE ===');
    for (const card of cards) {
      parts.push(`\n--- ${card.title || 'Untitled'} ---`);
      parts.push(card.content || '');
    }
    parts.push('\n=== END KNOWLEDGE BASE ===');
  }

  const maxTurns = config.activation?.maxTurnsPerSession || 10;
  parts.push(`\nYou have a maximum of ${maxTurns} turns. If unresolved, escalate to a human agent.`);

  return parts.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// EVENT SETUP
// ════════════════════════════════════════════════════════════════════════════

function setupConfigTabs() {
  document.querySelectorAll('.config-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.configTab;
      state.activeConfigTab = target;

      document.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.config-section').forEach(s => s.classList.remove('active'));
      const section = document.getElementById(`config-${target}`);
      if (section) section.classList.add('active');
    });
  });
}

function setupFilterChips() {
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.activeFilter = chip.dataset.filter;
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderKnowledgeCards();
    });
  });
}

function setupChannelTabs() {
  document.querySelectorAll('.channel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.testChannel = tab.dataset.channel;
      document.querySelectorAll('.channel-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderPromptPreview();
    });
  });
}

function setupEventListeners() {
  // Back button
  document.getElementById('btn-back')?.addEventListener('click', () => {
    if (state.dirty && !confirm('You have unsaved changes. Leave without saving?')) return;
    window.location.href = `/agent-console/?companyId=${encodeURIComponent(state.companyId)}`;
  });

  // Save button
  document.getElementById('btn-save')?.addEventListener('click', saveSettings);

  // ── Model & Persona listeners ──
  listen('agent-enabled', 'change', (e) => {
    state.config.enabled = e.target.checked;
    const wrapper = document.getElementById('master-toggle-wrapper');
    if (wrapper) wrapper.classList.toggle('enabled', e.target.checked);
    markDirty();
  });

  listen('model-select', 'change', (e) => {
    if (!state.config.model) state.config.model = {};
    state.config.model.modelId = e.target.value;
    updateModelDescription();
    markDirty();
    renderPromptPreview();
  });

  listenSlider('temperature-slider', 'temperature-value', (v) => {
    if (!state.config.model) state.config.model = {};
    state.config.model.temperature = parseFloat(v);
  });

  listenSlider('max-tokens-slider', 'max-tokens-value', (v) => {
    if (!state.config.model) state.config.model = {};
    state.config.model.maxTokens = parseInt(v);
  });

  listenSlider('chattiness-slider', 'chattiness-value', (v) => {
    if (!state.config.persona) state.config.persona = {};
    state.config.persona.chattiness = parseInt(v);
    renderPromptPreview();
  });

  listen('persona-name', 'input', (e) => {
    if (!state.config.persona) state.config.persona = {};
    state.config.persona.name = e.target.value;
    markDirty();
    renderPromptPreview();
  });

  listen('persona-role', 'change', (e) => {
    if (!state.config.persona) state.config.persona = {};
    state.config.persona.role = e.target.value;
    markDirty();
    renderPromptPreview();
  });

  listen('persona-tone', 'change', (e) => {
    if (!state.config.persona) state.config.persona = {};
    state.config.persona.tone = e.target.value;
    markDirty();
    renderPromptPreview();
  });

  listen('persona-language', 'change', (e) => {
    if (!state.config.persona) state.config.persona = {};
    state.config.persona.language = e.target.value;
    markDirty();
  });

  // ── Activation listeners ──
  listenToggle('channel-call', (v) => {
    if (!state.config.activation) state.config.activation = {};
    if (!state.config.activation.channels) state.config.activation.channels = {};
    state.config.activation.channels.call = v;
  });
  listenToggle('channel-sms', (v) => {
    if (!state.config.activation) state.config.activation = {};
    if (!state.config.activation.channels) state.config.activation.channels = {};
    state.config.activation.channels.sms = v;
  });
  listenToggle('channel-webchat', (v) => {
    if (!state.config.activation) state.config.activation = {};
    if (!state.config.activation.channels) state.config.activation.channels = {};
    state.config.activation.channels.webchat = v;
  });
  listenToggle('activation-trigger-fallback', (v) => {
    if (!state.config.activation) state.config.activation = {};
    state.config.activation.triggerFallback = v;
  });
  listenToggle('activation-followup-rescue', (v) => {
    if (!state.config.activation) state.config.activation = {};
    state.config.activation.followUpRescue = v;
  });

  listenSlider('low-confidence-slider', 'low-confidence-value', (v) => {
    if (!state.config.activation) state.config.activation = {};
    state.config.activation.lowConfidenceThreshold = parseFloat(v);
  });
  listenSlider('max-turns-slider', 'max-turns-value', (v) => {
    if (!state.config.activation) state.config.activation = {};
    state.config.activation.maxTurnsPerSession = parseInt(v);
    renderPromptPreview();
  });
  listenSlider('silence-timeout-slider', 'silence-timeout-value', (v) => {
    if (!state.config.activation) state.config.activation = {};
    state.config.activation.silenceTimeoutMs = parseInt(v);
  }, v => `${v / 1000}s`);

  // ── Guardrail listeners ──
  listenToggle('guard-no-pii', (v) => {
    if (!state.config.guardrails) state.config.guardrails = {};
    state.config.guardrails.noPiiCollection = v;
    renderPromptPreview();
  });
  listenToggle('guard-no-scheduling', (v) => {
    if (!state.config.guardrails) state.config.guardrails = {};
    state.config.guardrails.noScheduling = v;
    renderPromptPreview();
  });
  listenToggle('guard-no-pricing', (v) => {
    if (!state.config.guardrails) state.config.guardrails = {};
    state.config.guardrails.noPricing = v;
    renderPromptPreview();
  });
  listenToggle('guard-no-medical', (v) => {
    if (!state.config.guardrails) state.config.guardrails = {};
    state.config.guardrails.noMedicalAdvice = v;
    renderPromptPreview();
  });
  listenToggle('guard-no-legal', (v) => {
    if (!state.config.guardrails) state.config.guardrails = {};
    state.config.guardrails.noLegalAdvice = v;
    renderPromptPreview();
  });

  // Custom rule add
  document.getElementById('btn-add-rule')?.addEventListener('click', addCustomRule);
  document.getElementById('new-rule-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addCustomRule();
  });

  // Handoff listeners
  listen('handoff-mode', 'change', (e) => {
    if (!state.config.handoff) state.config.handoff = {};
    state.config.handoff.mode = e.target.value;
    markDirty();
    renderPromptPreview();
  });
  listenToggle('handoff-intent', (v) => {
    if (!state.config.handoff) state.config.handoff = {};
    state.config.handoff.passIntent = v;
  });
  listenToggle('handoff-context', (v) => {
    if (!state.config.handoff) state.config.handoff = {};
    state.config.handoff.passContext = v;
  });
  listenToggle('handoff-sentiment', (v) => {
    if (!state.config.handoff) state.config.handoff = {};
    state.config.handoff.passSentiment = v;
  });
  listenToggle('handoff-history', (v) => {
    if (!state.config.handoff) state.config.handoff = {};
    state.config.handoff.passConversationHistory = v;
  });
  listen('escalation-message', 'input', (e) => {
    if (!state.config.handoff) state.config.handoff = {};
    state.config.handoff.escalationMessage = e.target.value;
    markDirty();
    renderPromptPreview();
  });

  // ── Knowledge card buttons ──
  document.getElementById('btn-add-card')?.addEventListener('click', openAddCardModal);

  // ── Modal ──
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('modal-btn-back')?.addEventListener('click', modalGoBack);
  document.getElementById('modal-btn-save')?.addEventListener('click', modalSaveCard);
  document.getElementById('btn-scrape')?.addEventListener('click', handleScrape);

  // Modal card type selection
  document.querySelectorAll('.card-type-option').forEach(opt => {
    opt.addEventListener('click', () => {
      selectCardType(opt.dataset.cardType);
    });
  });

  // Modal overlay click to close
  document.getElementById('modal-add-card')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-add-card') closeModal();
  });

  // ── Preview ──
  document.getElementById('btn-copy-prompt')?.addEventListener('click', copyPrompt);
  document.getElementById('btn-clear-test')?.addEventListener('click', clearTestConversation);
  document.getElementById('btn-send-test')?.addEventListener('click', sendTestMessage);
  document.getElementById('test-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendTestMessage();
  });
}

// ════════════════════════════════════════════════════════════════════════════
// CARD ACTIONS
// ════════════════════════════════════════════════════════════════════════════

function toggleCard(cardId, enabled) {
  const cards = state.config?.knowledgeCards || [];
  const card = cards.find(c => c.id === cardId);
  if (card) {
    card.enabled = enabled;
    markDirty();
    renderKnowledgeCards();
    renderPromptPreview();
  }
}

function deleteCard(cardId) {
  if (!confirm('Delete this knowledge card?')) return;
  const cards = state.config?.knowledgeCards || [];
  state.config.knowledgeCards = cards.filter(c => c.id !== cardId);
  markDirty();
  renderKnowledgeCards();
  renderPromptPreview();
}

function editCard(cardId) {
  const cards = state.config?.knowledgeCards || [];
  const card = cards.find(c => c.id === cardId);
  if (!card) return;

  state.editingCardId = cardId;
  state.modalCardType = card.type;

  const modal = document.getElementById('modal-add-card');
  const titleEl = document.getElementById('modal-title');
  if (titleEl) titleEl.textContent = 'Edit Knowledge Card';
  if (modal) modal.removeAttribute('hidden');

  // Go directly to form step
  document.getElementById('modal-step-type')?.setAttribute('hidden', '');
  const formStep = document.getElementById('modal-step-form');
  if (formStep) formStep.removeAttribute('hidden');

  showModalForm(card.type);

  // Pre-fill values
  if (card.type === 'company' || card.type === 'custom') {
    setValue('card-title', card.title || '');
    setValue('card-content', card.content || '');
  }

  document.getElementById('modal-btn-save')?.removeAttribute('hidden');
  const saveBtn = document.getElementById('modal-btn-save');
  if (saveBtn) saveBtn.textContent = 'Save Changes';
  document.getElementById('modal-btn-back')?.removeAttribute('hidden');
}

function addCustomRule() {
  const input = document.getElementById('new-rule-input');
  if (!input || !input.value.trim()) return;

  if (!state.config.guardrails) state.config.guardrails = {};
  if (!state.config.guardrails.customRules) state.config.guardrails.customRules = [];

  state.config.guardrails.customRules.push({ rule: input.value.trim() });
  input.value = '';
  renderCustomRules();
  markDirty();
  renderPromptPreview();
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL
// ════════════════════════════════════════════════════════════════════════════

function openAddCardModal() {
  state.editingCardId = null;
  state.modalCardType = null;
  state.scrapedContent = null;

  const modal = document.getElementById('modal-add-card');
  const titleEl = document.getElementById('modal-title');
  if (titleEl) titleEl.textContent = 'Add Knowledge Card';
  if (modal) modal.removeAttribute('hidden');

  // Show type selection step
  document.getElementById('modal-step-type')?.removeAttribute('hidden');
  document.getElementById('modal-step-form')?.setAttribute('hidden', '');
  document.getElementById('modal-btn-save')?.setAttribute('hidden', '');
  document.getElementById('modal-btn-back')?.setAttribute('hidden', '');

  // Clear selections
  document.querySelectorAll('.card-type-option').forEach(o => o.classList.remove('selected'));

  // Clear form fields
  setValue('card-title', '');
  setValue('card-content', '');
  setValue('scrape-url', '');
  document.getElementById('scrape-result')?.setAttribute('hidden', '');
}

function closeModal() {
  document.getElementById('modal-add-card')?.setAttribute('hidden', '');
  state.editingCardId = null;
  state.modalCardType = null;
  state.scrapedContent = null;
}

function modalGoBack() {
  state.modalCardType = null;
  document.getElementById('modal-step-type')?.removeAttribute('hidden');
  document.getElementById('modal-step-form')?.setAttribute('hidden', '');
  document.getElementById('modal-btn-save')?.setAttribute('hidden', '');
  document.getElementById('modal-btn-back')?.setAttribute('hidden', '');
}

function selectCardType(type) {
  state.modalCardType = type;

  // Highlight selection
  document.querySelectorAll('.card-type-option').forEach(o => o.classList.remove('selected'));
  document.querySelector(`[data-card-type="${type}"]`)?.classList.add('selected');

  if (type === 'trigger') {
    // Load triggers and show sync UI
    document.getElementById('modal-step-type')?.setAttribute('hidden', '');
    document.getElementById('modal-step-form')?.removeAttribute('hidden');
    showModalForm('trigger');
    document.getElementById('modal-btn-save')?.removeAttribute('hidden');
    document.getElementById('modal-btn-back')?.removeAttribute('hidden');
    const saveBtn = document.getElementById('modal-btn-save');
    if (saveBtn) saveBtn.textContent = 'Import Selected';
    loadTriggerSync();
  } else {
    document.getElementById('modal-step-type')?.setAttribute('hidden', '');
    document.getElementById('modal-step-form')?.removeAttribute('hidden');
    showModalForm(type);
    document.getElementById('modal-btn-save')?.removeAttribute('hidden');
    document.getElementById('modal-btn-back')?.removeAttribute('hidden');
    const saveBtn = document.getElementById('modal-btn-save');
    if (saveBtn) saveBtn.textContent = 'Add Card';
  }
}

function showModalForm(type) {
  document.getElementById('modal-form-content')?.setAttribute('hidden', '');
  document.getElementById('modal-form-website')?.setAttribute('hidden', '');
  document.getElementById('modal-form-trigger')?.setAttribute('hidden', '');

  if (type === 'company' || type === 'custom') {
    document.getElementById('modal-form-content')?.removeAttribute('hidden');
  } else if (type === 'website') {
    document.getElementById('modal-form-website')?.removeAttribute('hidden');
  } else if (type === 'trigger') {
    document.getElementById('modal-form-trigger')?.removeAttribute('hidden');
  }
}

async function handleScrape() {
  const urlInput = document.getElementById('scrape-url');
  if (!urlInput || !urlInput.value.trim()) {
    showToast('error', 'Please enter a URL');
    return;
  }

  const btn = document.getElementById('btn-scrape');
  if (btn) { btn.disabled = true; btn.textContent = 'Scraping...'; }

  try {
    const data = await AgentConsoleAuth.apiFetch(
      `/api/agent-console/${state.companyId}/llm-agent/scrape-url`, {
        method: 'POST',
        body: JSON.stringify({ url: urlInput.value.trim() })
      }
    );

    state.scrapedContent = data;

    // Show result
    document.getElementById('scrape-result')?.removeAttribute('hidden');
    setValue('scrape-title', data.title || '');
    const previewEl = document.getElementById('scrape-preview');
    if (previewEl) previewEl.textContent = data.content?.substring(0, 2000) || '';
    const countEl = document.getElementById('scrape-word-count');
    if (countEl) countEl.textContent = `${data.wordCount || 0} words extracted`;

    showToast('success', 'Page scraped successfully');
  } catch (error) {
    showToast('error', `Scrape failed: ${error.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Scrape'; }
  }
}

async function loadTriggerSync() {
  const listEl = document.getElementById('trigger-sync-list');
  if (!listEl) return;

  listEl.innerHTML = '<div style="text-align: center; padding: var(--space-4); color: var(--color-gray-400);">Loading triggers...</div>';

  try {
    const data = await AgentConsoleAuth.apiFetch(
      `/api/agent-console/${state.companyId}/llm-agent/sync-triggers`
    );

    const triggers = data.triggers || [];
    if (triggers.length === 0) {
      listEl.innerHTML = '<div style="text-align: center; padding: var(--space-4); color: var(--color-gray-400);">No active triggers found</div>';
      return;
    }

    // Filter out triggers already added as cards
    const existingIds = (state.config?.knowledgeCards || [])
      .filter(c => c.type === 'trigger')
      .map(c => c.triggerId);

    listEl.innerHTML = triggers.map(t => {
      const alreadyAdded = existingIds.includes(t.triggerId);
      return `
        <label class="trigger-sync-item">
          <input type="checkbox" value="${t.triggerId}" ${alreadyAdded ? 'disabled' : ''}>
          <div>
            <div style="font-weight: 500;">${escapeHtml(t.triggerName)}</div>
            <div style="font-size: var(--font-size-xs); color: var(--color-gray-500);">${t.source} ${alreadyAdded ? '(already added)' : ''}</div>
          </div>
        </label>
      `;
    }).join('');
  } catch (error) {
    listEl.innerHTML = `<div style="text-align: center; padding: var(--space-4); color: var(--color-gray-500);">Failed to load: ${error.message}</div>`;
  }
}

function modalSaveCard() {
  if (!state.config.knowledgeCards) state.config.knowledgeCards = [];

  if (state.modalCardType === 'trigger') {
    // Import selected triggers
    const checkboxes = document.querySelectorAll('#trigger-sync-list input[type="checkbox"]:checked');
    if (checkboxes.length === 0) {
      showToast('error', 'Select at least one trigger to import');
      return;
    }

    // We need to re-fetch the trigger data — for now, use stored data
    // Actually, we'll get the data from the sync list items
    checkboxes.forEach(cb => {
      const triggerId = cb.value;
      const label = cb.closest('.trigger-sync-item');
      const nameEl = label?.querySelector('div > div:first-child');
      const triggerName = nameEl?.textContent || 'Trigger';

      state.config.knowledgeCards.push({
        id: generateId(),
        type: 'trigger',
        title: triggerName,
        content: `Trigger: ${triggerName}`,
        enabled: true,
        priority: state.config.knowledgeCards.length,
        triggerId: triggerId,
        triggerName: triggerName,
        autoSynced: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    });

    showToast('success', `${checkboxes.length} trigger(s) imported`);

  } else if (state.modalCardType === 'website') {
    if (!state.scrapedContent) {
      showToast('error', 'Scrape a URL first');
      return;
    }

    const title = document.getElementById('scrape-title')?.value || state.scrapedContent.title;
    const card = {
      id: state.editingCardId || generateId(),
      type: 'website',
      title: title,
      content: state.scrapedContent.content,
      enabled: true,
      priority: state.config.knowledgeCards.length,
      sourceUrl: state.scrapedContent.sourceUrl,
      scrapedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (state.editingCardId) {
      const idx = state.config.knowledgeCards.findIndex(c => c.id === state.editingCardId);
      if (idx >= 0) state.config.knowledgeCards[idx] = { ...state.config.knowledgeCards[idx], ...card };
    } else {
      state.config.knowledgeCards.push(card);
    }

  } else {
    // company or custom
    const title = document.getElementById('card-title')?.value?.trim();
    const content = document.getElementById('card-content')?.value?.trim();
    if (!title) { showToast('error', 'Title is required'); return; }
    if (!content) { showToast('error', 'Content is required'); return; }

    const card = {
      id: state.editingCardId || generateId(),
      type: state.modalCardType,
      title,
      content,
      enabled: true,
      priority: state.config.knowledgeCards.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (state.editingCardId) {
      const idx = state.config.knowledgeCards.findIndex(c => c.id === state.editingCardId);
      if (idx >= 0) state.config.knowledgeCards[idx] = { ...state.config.knowledgeCards[idx], ...card, updatedAt: new Date().toISOString() };
    } else {
      state.config.knowledgeCards.push(card);
    }
  }

  markDirty();
  renderKnowledgeCards();
  renderPromptPreview();
  closeModal();
}

// ════════════════════════════════════════════════════════════════════════════
// TEST CONVERSATION
// ════════════════════════════════════════════════════════════════════════════

async function sendTestMessage() {
  const input = document.getElementById('test-input');
  if (!input || !input.value.trim()) return;

  const userMessage = input.value.trim();
  input.value = '';

  // Add user message
  state.testMessages.push({ role: 'user', content: userMessage });
  renderTestMessages();

  // Show loading
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'test-msg assistant loading';
  loadingDiv.textContent = 'Thinking...';
  document.getElementById('test-messages')?.appendChild(loadingDiv);
  scrollTestToBottom();

  try {
    const data = await AgentConsoleAuth.apiFetch(
      `/api/agent-console/${state.companyId}/llm-agent/test-conversation`, {
        method: 'POST',
        body: JSON.stringify({
          messages: state.testMessages,
          channel: state.testChannel
        })
      }
    );

    // Remove loading
    loadingDiv.remove();

    // Add assistant response
    state.testMessages.push({ role: 'assistant', content: data.response });
    renderTestMessages();

    // Update meta
    const metaEl = document.getElementById('test-meta');
    if (metaEl) metaEl.removeAttribute('hidden');
    const modelEl = document.getElementById('test-model');
    if (modelEl) modelEl.textContent = data.model || '';
    const latencyEl = document.getElementById('test-latency');
    if (latencyEl) latencyEl.textContent = `${data.latencyMs}ms | ${data.tokensUsed?.input || 0}+${data.tokensUsed?.output || 0} tokens`;

  } catch (error) {
    loadingDiv.remove();
    showToast('error', `Test failed: ${error.message}`);
  }
}

function renderTestMessages() {
  const container = document.getElementById('test-messages');
  if (!container) return;

  if (state.testMessages.length === 0) {
    container.innerHTML = '<div class="test-messages-empty">Send a message to test the agent</div>';
    return;
  }

  container.innerHTML = state.testMessages.map(m =>
    `<div class="test-msg ${m.role}">${escapeHtml(m.content)}</div>`
  ).join('');

  scrollTestToBottom();
}

function scrollTestToBottom() {
  const container = document.getElementById('test-messages');
  if (container) container.scrollTop = container.scrollHeight;
}

function clearTestConversation() {
  state.testMessages = [];
  renderTestMessages();
  const metaEl = document.getElementById('test-meta');
  if (metaEl) metaEl.setAttribute('hidden', '');
}

function copyPrompt() {
  const text = document.getElementById('prompt-preview')?.textContent || '';
  navigator.clipboard.writeText(text).then(() => {
    showToast('success', 'Prompt copied to clipboard');
  }).catch(() => {
    showToast('error', 'Failed to copy');
  });
}

// ════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════════════════════════════

function markDirty() {
  state.dirty = true;
  updateSaveButton();
  const statusEl = document.getElementById('footer-save-status');
  if (statusEl) statusEl.textContent = 'Unsaved changes';
}

function updateSaveButton() {
  const btn = document.getElementById('btn-save');
  if (btn) btn.disabled = !state.dirty;
}

function listen(id, event, handler) {
  document.getElementById(id)?.addEventListener(event, handler);
}

function listenToggle(id, handler) {
  listen(id, 'change', (e) => {
    handler(e.target.checked);
    markDirty();
  });
}

function listenSlider(sliderId, valueId, handler, formatter) {
  listen(sliderId, 'input', (e) => {
    const v = e.target.value;
    const display = formatter ? formatter(v) : v;
    const valEl = document.getElementById(valueId);
    if (valEl) valEl.textContent = display;
    handler(v);
    markDirty();
  });
}

function setChecked(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = !!value;
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function setSlider(sliderId, valueId, value, formatter) {
  const slider = document.getElementById(sliderId);
  const valEl = document.getElementById(valueId);
  if (slider) slider.value = value;
  if (valEl) valEl.textContent = formatter ? formatter(value) : value;
}

function generateId() {
  return 'kc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ════════════════════════════════════════════════════════════════════════════
// TOAST & LOADING
// ════════════════════════════════════════════════════════════════════════════

function showLoadingState() {
  const el = document.getElementById('loading-overlay');
  if (el) { el.removeAttribute('hidden'); el.classList.add('active'); }
}

function hideLoadingState() {
  const el = document.getElementById('loading-overlay');
  if (el) { el.setAttribute('hidden', ''); el.classList.remove('active'); }
}

function showToast(type, message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${getToastIcon(type)}</div>
    <div class="toast-content">
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function getToastIcon(type) {
  switch (type) {
    case 'success': return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.3 4.3L6 11.6L2.7 8.3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    case 'error': return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2"/><path d="M8 5V8.5M8 10.5V11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    case 'warning': return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14.9 14H1.1L8 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6V9M8 11V11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    default: return '';
  }
}
