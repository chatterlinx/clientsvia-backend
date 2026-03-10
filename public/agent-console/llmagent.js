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
  scrapedContent: null,    // temp storage for website scrape result
  activeBrFilter: 'all',   // behavior rules category filter
  editingBrId: null         // null = add, string = edit behavior rule
};

// ════════════════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[LLMAgent] ✅ DOMContentLoaded fired');

  const urlParams = new URLSearchParams(window.location.search);
  state.companyId = urlParams.get('companyId');
  console.log('[LLMAgent] companyId:', state.companyId);

  if (!state.companyId) {
    showToast('error', 'Missing companyId parameter');
    console.error('[LLMAgent] ❌ No companyId — aborting init');
    return;
  }

  try {
    console.log('[LLMAgent] Setting up tabs...');
    setupConfigTabs();
    setupFilterChips();
    setupBrFilterChips();
    setupChannelTabs();
    console.log('[LLMAgent] Setting up event listeners...');
    setupEventListeners();
    console.log('[LLMAgent] ✅ Event listeners wired');
    console.log('[LLMAgent] Loading settings...');
    await loadSettings();
    console.log('[LLMAgent] ✅ Settings loaded, config:', state.config ? 'EXISTS' : 'NULL');

    // Auto-sync triggers as knowledge cards after settings load
    console.log('[LLMAgent] Starting trigger auto-sync...');
    await autoSyncTriggers();
    console.log('[LLMAgent] ✅ Init complete');
  } catch (error) {
    console.error('[LLMAgent] ❌ Init failed:', error);
  }
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

// ── API Health Ping ──────────────────────────────────────────────────────────
async function pingAnthropicAPI() {
  const btn   = document.getElementById('btn-api-ping');
  const label = document.getElementById('api-health-label');
  if (!btn || !label) return;

  // Checking state
  btn.className = 'api-health-btn checking';
  btn.disabled  = true;
  label.textContent = 'Checking…';

  try {
    const data = await AgentConsoleAuth.apiFetch(
      `/api/agent-console/${state.companyId}/llm-agent/ping`,
      { method: 'POST' }
    );

    if (data.ok) {
      btn.className     = 'api-health-btn ok';
      label.textContent = `Connected · ${data.latencyMs}ms`;
    } else {
      btn.className     = 'api-health-btn error';
      label.textContent = `Error: ${data.error || 'Unknown'}`;
    }
  } catch (err) {
    btn.className     = 'api-health-btn error';
    label.textContent = `Error: ${err.message || 'Request failed'}`;
  } finally {
    btn.disabled = false;
    // Reset label back to "Test API" after 8 seconds
    setTimeout(() => {
      if (btn.classList.contains('ok') || btn.classList.contains('error')) {
        btn.className     = 'api-health-btn';
        label.textContent = 'Test API';
      }
    }, 8000);
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

/**
 * Auto-sync active triggers as knowledge cards.
 * Runs on page load — pulls all active triggers from the trigger system
 * and adds/updates them as knowledge cards automatically.
 * Existing trigger cards are updated, new triggers are added, removed triggers are cleaned up.
 */
async function autoSyncTriggers() {
  if (!state.config) return;

  try {
    const data = await AgentConsoleAuth.apiFetch(
      `/api/agent-console/${state.companyId}/llm-agent/sync-triggers`
    );

    const triggers = data.triggers || [];
    if (!state.config.knowledgeCards) state.config.knowledgeCards = [];

    // Get existing trigger cards
    const existingTriggerCards = state.config.knowledgeCards.filter(c => c.type === 'trigger');
    const existingTriggerIds = new Set(existingTriggerCards.map(c => c.triggerId));
    const remoteTriggerIds = new Set(triggers.map(t => t.triggerId));

    let added = 0;
    let updated = 0;
    let removed = 0;

    // Add new triggers that don't exist yet
    for (const t of triggers) {
      if (!existingTriggerIds.has(t.triggerId)) {
        state.config.knowledgeCards.push({
          id: generateId(),
          type: 'trigger',
          title: t.title || t.triggerName,
          content: t.content || `Trigger: ${t.triggerName}`,
          enabled: true,
          priority: state.config.knowledgeCards.length,
          triggerId: t.triggerId,
          triggerName: t.triggerName,
          source: t.source,
          autoSynced: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        added++;
      } else {
        // Update existing trigger card content (trigger may have changed)
        const existing = existingTriggerCards.find(c => c.triggerId === t.triggerId);
        if (existing && t.content && existing.content !== t.content) {
          existing.title = t.title || t.triggerName;
          existing.content = t.content;
          existing.triggerName = t.triggerName;
          existing.updatedAt = new Date().toISOString();
          updated++;
        }
      }
    }

    // Remove trigger cards whose triggers no longer exist (were deleted/deactivated)
    const before = state.config.knowledgeCards.length;
    state.config.knowledgeCards = state.config.knowledgeCards.filter(c => {
      if (c.type !== 'trigger') return true; // keep non-trigger cards
      return remoteTriggerIds.has(c.triggerId); // only keep triggers that still exist
    });
    removed = before - state.config.knowledgeCards.length;

    // If anything changed, save and re-render
    if (added > 0 || updated > 0 || removed > 0) {
      console.log(`[LLMAgent] Trigger sync: +${added} added, ~${updated} updated, -${removed} removed`);
      markDirty();
      renderKnowledgeCards();
      renderPromptPreview();
      // Auto-save the synced triggers
      await saveSettings();
    } else {
      console.log('[LLMAgent] Trigger sync: already up to date');
    }
  } catch (error) {
    console.warn('[LLMAgent] Trigger auto-sync failed (non-critical):', error.message);
    // Non-critical — page works fine without trigger sync
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
  renderIntakePanel();
  renderKnowledgeCards();
  seedDefaultBehaviorRules();
  renderBehaviorRules();
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

// ── First Turn Intake Panel ──────────────────────────────────────────────

function renderIntakePanel() {
  const c = state.config;
  if (!c) return;

  const intake = c.intake || {};

  setChecked('intake-enabled', intake.enabled ?? false);

  // Extraction targets
  const extract = intake.extract || {};
  setChecked('intake-extract-name', extract.firstName ?? true);
  setChecked('intake-extract-phone', extract.phone ?? true);
  setChecked('intake-extract-address', extract.address ?? true);
  setChecked('intake-extract-reason', extract.callReason ?? true);
  setChecked('intake-extract-urgency', extract.urgency ?? true);
  setChecked('intake-extract-technician', extract.technicianMentioned ?? true);
  setChecked('intake-extract-priorvisit', extract.priorVisit ?? true);

  // Confidence thresholds
  const conf = intake.confidence || {};
  setSlider('intake-conf-name', 'intake-conf-name-value', conf.nameThreshold ?? 0.70);
  setSlider('intake-conf-phone', 'intake-conf-phone-value', conf.phoneThreshold ?? 0.80);
  setSlider('intake-conf-address', 'intake-conf-address-value', conf.addressThreshold ?? 0.60);
  setSlider('intake-conf-reason', 'intake-conf-reason-value', conf.reasonThreshold ?? 0.50);

  // Model override
  const modelSelect = document.getElementById('intake-model-select');
  if (modelSelect) {
    const models = state.availableModels || [];
    while (modelSelect.options.length > 1) modelSelect.remove(1);
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.label} — ${m.description}`;
      modelSelect.appendChild(opt);
    }
    modelSelect.value = intake.model?.modelId || '';
  }

  setSlider('intake-temperature', 'intake-temperature-value', intake.model?.temperature ?? 0.3);
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
        <svg class="cards-empty-svg" width="64" height="64" viewBox="0 0 64 64" fill="none">
          <rect x="8" y="12" width="48" height="40" rx="4" stroke="#d1d5db" stroke-width="2"/>
          <path d="M20 26h24M20 34h16" stroke="#d1d5db" stroke-width="2" stroke-linecap="round"/>
          <circle cx="48" cy="48" r="10" fill="#f9fafb" stroke="#d1d5db" stroke-width="2"/>
          <path d="M44 48h8M48 44v8" stroke="#9ca3af" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <div class="cards-empty-title">${cards.length === 0 ? 'No knowledge cards yet' : 'No cards match this filter'}</div>
        <div class="cards-empty-text">${cards.length === 0 ? 'Add knowledge cards to give your agent context about the business.' : 'Try selecting a different filter above.'}</div>
        ${cards.length === 0 ? '<button class="btn-add-card" data-action="add-card" type="button" style="margin:0 auto;"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Add First Card</button>' : ''}
      </div>
    `;
    return;
  }

  const TYPE_ICONS = {
    trigger: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M9 2L3 9h5l-1 6 6-8H8l1-5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
    company: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="7" width="12" height="8" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M5 7V4.5A1 1 0 016 3.5h4a1 1 0 011 1V7" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 11v1.5M9.5 11v1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
    website: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M2 8h12M8 2c-1.5 2-1.5 8 0 12M8 2c1.5 2 1.5 8 0 12" stroke="currentColor" stroke-width="1.4"/></svg>`,
    custom:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M6 6h4M6 9h4M6 12h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`
  };
  const BADGE_COLORS = { trigger: 'badge-info', company: 'badge-warning', website: 'badge-success', custom: 'badge-neutral' };

  container.innerHTML = filtered.map(card => {
    const icon = TYPE_ICONS[card.type] || TYPE_ICONS.custom;
    const badgeColor = BADGE_COLORS[card.type] || 'badge-neutral';
    const disabledClass = card.enabled === false ? 'disabled' : '';

    return `
      <div class="knowledge-card ${disabledClass}" data-card-id="${card.id}">
        <div class="kc-accent ${card.type}"></div>
        <div class="kc-inner">
          <div class="kc-type-icon ${card.type}">${icon}</div>
          <div class="kc-body">
            <div class="kc-header">
              <h4 class="kc-title">${escapeHtml(card.title || 'Untitled')}</h4>
              <span class="badge ${badgeColor}">${card.type}</span>
              <div class="kc-toggle-wrap">
                <label class="toggle-switch">
                  <input type="checkbox" data-action="toggle-card" data-card-id="${card.id}" ${card.enabled !== false ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
            <p class="kc-content">${escapeHtml((card.content || '').substring(0, 180))}</p>
          </div>
        </div>
        <div class="kc-actions">
          <button class="kc-action-btn" type="button" data-action="edit-card" data-card-id="${card.id}" title="Edit">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M9 2l2 2-7 7H2V9l7-7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
          </button>
          <button class="kc-action-btn delete" type="button" data-action="delete-card" data-card-id="${card.id}" title="Delete">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 3.5h9M5 3.5V2.5h3v1M5.5 5.5v4M7.5 5.5v4M3 3.5l.5 7h6l.5-7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ── Behavior Rules ──────────────────────────────────────────────────────

const DEFAULT_BEHAVIOR_RULES = [
  { id: 'br_frustrated_caller', title: 'Frustrated Caller', rule: 'When the caller sounds frustrated or upset, acknowledge their concern before offering solutions. Say something like "I understand this is frustrating" before proceeding.', category: 'emotional', enabled: true, isDefault: true, priority: 0 },
  { id: 'br_angry_demanding', title: 'Angry / Demanding', rule: 'If the caller is angry or demanding immediate action, stay calm, validate their urgency, and guide them toward the next step without making promises you cannot keep.', category: 'emotional', enabled: true, isDefault: true, priority: 1 },
  { id: 'br_language_switching', title: 'Language Switching', rule: 'If the caller switches to a language other than English, respond in their language to the best of your ability.', category: 'language', enabled: true, isDefault: true, priority: 2 },
  { id: 'br_multiple_intents', title: 'Multiple Intents', rule: 'When the caller mentions two or more issues in one sentence, address the most urgent issue first, then acknowledge the second issue.', category: 'intent', enabled: true, isDefault: true, priority: 3 },
  { id: 'br_topic_change', title: 'Topic Change', rule: 'If the caller changes the subject mid-conversation, acknowledge the shift and address the new topic without forcing them back to the previous one.', category: 'intent', enabled: true, isDefault: true, priority: 4 },
  { id: 'br_wants_more_info', title: 'Wants More Info First', rule: 'If the caller says yes but immediately asks for more details (pricing, timing, etc.), provide what you know from the knowledge base before proceeding with booking.', category: 'flow', enabled: true, isDefault: true, priority: 5 },
  { id: 'br_specific_person', title: 'Asks for Specific Person', rule: 'If the caller asks for a specific technician or employee by name, explain that assignments are based on availability and service area.', category: 'flow', enabled: true, isDefault: true, priority: 6 },
  { id: 'br_unclear_response', title: 'Partial or Unclear Response', rule: 'If the caller gives an unclear or partial answer, ask one clarifying question rather than repeating the original question.', category: 'flow', enabled: true, isDefault: true, priority: 7 },
];

function seedDefaultBehaviorRules() {
  if (!state.config) return;
  if (state.config.behaviorRules && state.config.behaviorRules.length > 0) return;
  state.config.behaviorRules = DEFAULT_BEHAVIOR_RULES.map(r => ({
    ...r,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
}

function renderBehaviorRules() {
  const container = document.getElementById('behavior-rules-list');
  if (!container) return;

  const rules = state.config?.behaviorRules || [];
  const filter = state.activeBrFilter;
  const filtered = filter === 'all' ? rules : rules.filter(r => r.category === filter);

  // Update count badges
  const counts = { all: rules.length, emotional: 0, language: 0, intent: 0, flow: 0, custom: 0 };
  rules.forEach(r => { if (counts[r.category] !== undefined) counts[r.category]++; });
  for (const [cat, count] of Object.entries(counts)) {
    const el = document.getElementById('br-count-' + cat);
    if (el) el.textContent = count;
  }
  const badge = document.getElementById('br-count-badge');
  if (badge) badge.textContent = rules.length + (rules.length === 1 ? ' rule' : ' rules');

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="cards-empty">
        <svg class="cards-empty-svg" width="64" height="64" viewBox="0 0 64 64" fill="none">
          <rect x="8" y="12" width="48" height="40" rx="4" stroke="#d1d5db" stroke-width="2"/>
          <path d="M20 26h24M20 34h16" stroke="#d1d5db" stroke-width="2" stroke-linecap="round"/>
          <circle cx="48" cy="48" r="10" fill="#f9fafb" stroke="#d1d5db" stroke-width="2"/>
          <path d="M44 48h8M48 44v8" stroke="#9ca3af" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <div class="cards-empty-title">${rules.length === 0 ? 'No behavior rules yet' : 'No rules match this filter'}</div>
        <div class="cards-empty-text">${rules.length === 0 ? 'Add behavior rules to control how the AI agent handles edge cases.' : 'Try selecting a different filter above.'}</div>
      </div>
    `;
    return;
  }

  const CATEGORY_ICONS = {
    emotional: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 9.5c.5 1 1.5 1.5 2.5 1.5s2-.5 2.5-1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="6" cy="6.5" r="0.8" fill="currentColor"/><circle cx="10" cy="6.5" r="0.8" fill="currentColor"/></svg>`,
    language:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M2 8h12M8 2c-1.5 2-1.5 8 0 12M8 2c1.5 2 1.5 8 0 12" stroke="currentColor" stroke-width="1.4"/></svg>`,
    intent:    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v4M8 10v4M2 8h4M10 8h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.4"/></svg>`,
    flow:      `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4v3a2 2 0 002 2h4a2 2 0 012 2v1M4 4h2M4 4H2M12 12h2M12 12h-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    custom:    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M6 6h4M6 9h4M6 12h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`
  };
  const BR_BADGE_COLORS = { emotional: 'badge-danger', language: 'badge-success', intent: 'badge-info', flow: 'badge-purple', custom: 'badge-neutral' };

  container.innerHTML = filtered.map(rule => {
    const icon = CATEGORY_ICONS[rule.category] || CATEGORY_ICONS.custom;
    const badgeColor = BR_BADGE_COLORS[rule.category] || 'badge-neutral';
    const disabledClass = rule.enabled === false ? 'disabled' : '';

    return `
      <div class="knowledge-card ${disabledClass}" data-br-id="${rule.id}">
        <div class="kc-accent ${rule.category}"></div>
        <div class="kc-inner">
          <div class="kc-type-icon ${rule.category}">${icon}</div>
          <div class="kc-body">
            <div class="kc-header">
              <h4 class="kc-title">${escapeHtml(rule.title || 'Untitled')}</h4>
              <span class="badge ${badgeColor}">${rule.category}</span>
              ${rule.isDefault ? '<span class="badge badge-neutral" style="font-size:10px;">default</span>' : ''}
              <div class="kc-toggle-wrap">
                <label class="toggle-switch">
                  <input type="checkbox" data-action="toggle-br" data-br-id="${rule.id}" ${rule.enabled !== false ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
            <p class="kc-content">${escapeHtml((rule.rule || '').substring(0, 200))}</p>
          </div>
        </div>
        <div class="kc-actions">
          <button class="kc-action-btn" type="button" data-action="edit-br" data-br-id="${rule.id}" title="Edit">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M9 2l2 2-7 7H2V9l7-7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
          </button>
          <button class="kc-action-btn delete" type="button" data-action="delete-br" data-br-id="${rule.id}" title="Delete">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 3.5h9M5 3.5V2.5h3v1M5.5 5.5v4M7.5 5.5v4M3 3.5l.5 7h6l.5-7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function toggleBehaviorRule(ruleId, enabled) {
  const rules = state.config?.behaviorRules || [];
  const rule = rules.find(r => r.id === ruleId);
  if (rule) {
    rule.enabled = enabled;
    rule.updatedAt = new Date().toISOString();
    markDirty();
    renderBehaviorRules();
    renderPromptPreview();
  }
}

function deleteBehaviorRule(ruleId) {
  if (!confirm('Delete this behavior rule?')) return;
  const rules = state.config?.behaviorRules || [];
  state.config.behaviorRules = rules.filter(r => r.id !== ruleId);
  markDirty();
  renderBehaviorRules();
  renderPromptPreview();
}

function editBehaviorRule(ruleId) {
  const rules = state.config?.behaviorRules || [];
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return;

  state.editingBrId = ruleId;
  const modal = document.getElementById('modal-behavior-rule');
  const titleEl = document.getElementById('br-modal-title');
  if (titleEl) titleEl.textContent = 'Edit Behavior Rule';
  if (modal) { modal.removeAttribute('hidden'); modal.classList.add('open'); }

  setValue('br-title', rule.title || '');
  setValue('br-category', rule.category || 'custom');
  setValue('br-rule', rule.rule || '');
}

function openAddBrModal() {
  state.editingBrId = null;
  const modal = document.getElementById('modal-behavior-rule');
  const titleEl = document.getElementById('br-modal-title');
  if (titleEl) titleEl.textContent = 'Add Behavior Rule';
  if (modal) { modal.removeAttribute('hidden'); modal.classList.add('open'); }

  setValue('br-title', '');
  setValue('br-category', 'custom');
  setValue('br-rule', '');
}

function closeBrModal() {
  const modal = document.getElementById('modal-behavior-rule');
  if (modal) { modal.classList.remove('open'); modal.setAttribute('hidden', ''); }
  state.editingBrId = null;
}

function saveBehaviorRule() {
  const title = document.getElementById('br-title')?.value?.trim();
  const category = document.getElementById('br-category')?.value || 'custom';
  const rule = document.getElementById('br-rule')?.value?.trim();

  if (!title) { showToast('error', 'Title is required'); return; }
  if (!rule) { showToast('error', 'Rule instruction is required'); return; }

  if (!state.config.behaviorRules) state.config.behaviorRules = [];

  if (state.editingBrId) {
    const existing = state.config.behaviorRules.find(r => r.id === state.editingBrId);
    if (existing) {
      existing.title = title;
      existing.category = category;
      existing.rule = rule;
      existing.updatedAt = new Date().toISOString();
    }
  } else {
    state.config.behaviorRules.push({
      id: 'br_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6),
      title,
      rule,
      category,
      enabled: true,
      isDefault: false,
      priority: state.config.behaviorRules.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  markDirty();
  renderBehaviorRules();
  renderPromptPreview();
  closeBrModal();
  showToast('success', state.editingBrId ? 'Rule updated' : 'Rule added');
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

  // Behavior rules
  const behaviorRules = (config.behaviorRules || []).filter(r => r.enabled !== false && r.rule?.trim());
  if (behaviorRules.length > 0) {
    parts.push('\n=== BEHAVIOR RULES ===');
    parts.push('Follow these rules when handling edge cases and difficult situations:');
    for (const br of behaviorRules) {
      parts.push(`\u2022 ${br.rule.trim()}`);
    }
    parts.push('=== END BEHAVIOR RULES ===');
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

      // Swap center column: Knowledge Cards vs Behavior Rules
      const knowledgeCol = document.getElementById('knowledge-cards-column');
      const behaviorCol = document.getElementById('behavior-rules-column');
      if (knowledgeCol && behaviorCol) {
        if (target === 'behavior') {
          knowledgeCol.style.display = 'none';
          behaviorCol.style.display = '';
          renderBehaviorRules();
        } else {
          knowledgeCol.style.display = '';
          behaviorCol.style.display = 'none';
        }
      }
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

function setupBrFilterChips() {
  document.querySelectorAll('[data-br-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      state.activeBrFilter = chip.dataset.brFilter;
      document.querySelectorAll('[data-br-filter]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderBehaviorRules();
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
  // API health ping
  document.getElementById('btn-api-ping')?.addEventListener('click', pingAnthropicAPI);

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

  // ── First Turn Intake listeners ──
  listenToggle('intake-enabled', (v) => {
    if (!state.config.intake) state.config.intake = {};
    state.config.intake.enabled = v;
  });
  listenToggle('intake-extract-name', (v) => {
    if (!state.config.intake) state.config.intake = {};
    if (!state.config.intake.extract) state.config.intake.extract = {};
    state.config.intake.extract.firstName = v;
    state.config.intake.extract.lastName = v;
  });
  listenToggle('intake-extract-phone', (v) => {
    if (!state.config.intake) state.config.intake = {};
    if (!state.config.intake.extract) state.config.intake.extract = {};
    state.config.intake.extract.phone = v;
  });
  listenToggle('intake-extract-address', (v) => {
    if (!state.config.intake) state.config.intake = {};
    if (!state.config.intake.extract) state.config.intake.extract = {};
    state.config.intake.extract.address = v;
  });
  listenToggle('intake-extract-reason', (v) => {
    if (!state.config.intake) state.config.intake = {};
    if (!state.config.intake.extract) state.config.intake.extract = {};
    state.config.intake.extract.callReason = v;
  });
  listenToggle('intake-extract-urgency', (v) => {
    if (!state.config.intake) state.config.intake = {};
    if (!state.config.intake.extract) state.config.intake.extract = {};
    state.config.intake.extract.urgency = v;
    state.config.intake.extract.sameDayRequested = v;
  });
  listenToggle('intake-extract-technician', (v) => {
    if (!state.config.intake) state.config.intake = {};
    if (!state.config.intake.extract) state.config.intake.extract = {};
    state.config.intake.extract.technicianMentioned = v;
  });
  listenToggle('intake-extract-priorvisit', (v) => {
    if (!state.config.intake) state.config.intake = {};
    if (!state.config.intake.extract) state.config.intake.extract = {};
    state.config.intake.extract.priorVisit = v;
  });
  listenSlider('intake-conf-name', 'intake-conf-name-value', (v) => {
    if (!state.config.intake) state.config.intake = {};
    if (!state.config.intake.confidence) state.config.intake.confidence = {};
    state.config.intake.confidence.nameThreshold = parseFloat(v);
  });
  listenSlider('intake-conf-phone', 'intake-conf-phone-value', (v) => {
    if (!state.config.intake) state.config.intake = {};
    if (!state.config.intake.confidence) state.config.intake.confidence = {};
    state.config.intake.confidence.phoneThreshold = parseFloat(v);
  });
  listenSlider('intake-conf-address', 'intake-conf-address-value', (v) => {
    if (!state.config.intake) state.config.intake = {};
    if (!state.config.intake.confidence) state.config.intake.confidence = {};
    state.config.intake.confidence.addressThreshold = parseFloat(v);
  });
  listenSlider('intake-conf-reason', 'intake-conf-reason-value', (v) => {
    if (!state.config.intake) state.config.intake = {};
    if (!state.config.intake.confidence) state.config.intake.confidence = {};
    state.config.intake.confidence.reasonThreshold = parseFloat(v);
  });
  listen('intake-model-select', 'change', (e) => {
    if (!state.config.intake) state.config.intake = {};
    if (!state.config.intake.model) state.config.intake.model = {};
    state.config.intake.model.modelId = e.target.value || undefined;
    markDirty();
  });
  listenSlider('intake-temperature', 'intake-temperature-value', (v) => {
    if (!state.config.intake) state.config.intake = {};
    if (!state.config.intake.model) state.config.intake.model = {};
    state.config.intake.model.temperature = parseFloat(v);
  });

  // ── Knowledge card buttons ──
  const addCardBtn = document.getElementById('btn-add-card');
  console.log('[LLMAgent] btn-add-card element:', addCardBtn ? 'FOUND' : 'NOT FOUND');
  if (addCardBtn) {
    addCardBtn.addEventListener('click', () => {
      console.log('[LLMAgent] 🔘 btn-add-card CLICKED');
      openAddCardModal();
    });
  }

  // Event delegation for ALL dynamically-rendered card buttons
  const cardsList = document.getElementById('cards-list');
  console.log('[LLMAgent] cards-list element:', cardsList ? 'FOUND' : 'NOT FOUND');
  if (cardsList) {
    cardsList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      console.log('[LLMAgent] 🔘 cards-list delegation:', action, btn.dataset.cardId || '');
      if (action === 'add-card') openAddCardModal();
      if (action === 'edit-card') editCard(btn.dataset.cardId);
      if (action === 'delete-card') deleteCard(btn.dataset.cardId);
    });
    cardsList.addEventListener('change', (e) => {
      const el = e.target.closest('[data-action="toggle-card"]');
      if (!el) return;
      console.log('[LLMAgent] 🔘 toggle card:', el.dataset.cardId, el.checked);
      toggleCard(el.dataset.cardId, el.checked);
    });
  }

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

  // ── Behavior Rules ──
  document.getElementById('btn-add-behavior-rule')?.addEventListener('click', openAddBrModal);

  // Event delegation for behavior rule cards
  const brList = document.getElementById('behavior-rules-list');
  if (brList) {
    brList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'edit-br') editBehaviorRule(btn.dataset.brId);
      if (action === 'delete-br') deleteBehaviorRule(btn.dataset.brId);
    });
    brList.addEventListener('change', (e) => {
      const el = e.target.closest('[data-action="toggle-br"]');
      if (!el) return;
      toggleBehaviorRule(el.dataset.brId, el.checked);
    });
  }

  // Behavior rule modal
  document.getElementById('br-modal-close')?.addEventListener('click', closeBrModal);
  document.getElementById('br-modal-cancel')?.addEventListener('click', closeBrModal);
  document.getElementById('br-modal-save')?.addEventListener('click', saveBehaviorRule);
  document.getElementById('modal-behavior-rule')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-behavior-rule') closeBrModal();
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
  if (modal) {
    modal.removeAttribute('hidden');
    modal.classList.add('open');
  }

  // Go directly to form step
  hideEl('modal-step-type');
  showEl('modal-step-form');

  showModalForm(card.type);

  // Pre-fill values
  if (card.type === 'company' || card.type === 'custom') {
    setValue('card-title', card.title || '');
    setValue('card-content', card.content || '');
  }

  showEl('modal-btn-save');
  const saveBtn = document.getElementById('modal-btn-save');
  if (saveBtn) saveBtn.textContent = 'Save Changes';
  showEl('modal-btn-back');
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
  console.log('[LLMAgent] 📦 openAddCardModal() called');
  state.editingCardId = null;
  state.modalCardType = null;
  state.scrapedContent = null;

  const modal = document.getElementById('modal-add-card');
  const titleEl = document.getElementById('modal-title');
  if (titleEl) titleEl.textContent = 'Add Knowledge Card';
  if (modal) {
    modal.removeAttribute('hidden');
    modal.classList.add('open');
  }

  // Show type selection step, hide form step
  showEl('modal-step-type');
  hideEl('modal-step-form');
  hideEl('modal-btn-save');
  hideEl('modal-btn-back');

  // Clear selections
  document.querySelectorAll('.card-type-option').forEach(o => o.classList.remove('selected'));

  // Clear form fields
  setValue('card-title', '');
  setValue('card-content', '');
  setValue('scrape-url', '');
  hideEl('scrape-result');
}

function closeModal() {
  const modal = document.getElementById('modal-add-card');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('hidden', '');
  }
  state.editingCardId = null;
  state.modalCardType = null;
  state.scrapedContent = null;
}

function modalGoBack() {
  state.modalCardType = null;
  showEl('modal-step-type');
  hideEl('modal-step-form');
  hideEl('modal-btn-save');
  hideEl('modal-btn-back');
}

function selectCardType(type) {
  state.modalCardType = type;

  // Highlight selection
  document.querySelectorAll('.card-type-option').forEach(o => o.classList.remove('selected'));
  document.querySelector(`[data-card-type="${type}"]`)?.classList.add('selected');

  hideEl('modal-step-type');
  showEl('modal-step-form');
  showModalForm(type);
  showEl('modal-btn-save');
  showEl('modal-btn-back');

  const saveBtn = document.getElementById('modal-btn-save');
  if (type === 'trigger') {
    if (saveBtn) saveBtn.textContent = 'Import Selected';
    loadTriggerSync();
  } else {
    if (saveBtn) saveBtn.textContent = 'Add Card';
  }
}

function showModalForm(type) {
  hideEl('modal-form-content');
  hideEl('modal-form-website');
  hideEl('modal-form-trigger');

  if (type === 'company' || type === 'custom') {
    showEl('modal-form-content');
  } else if (type === 'website') {
    showEl('modal-form-website');
  } else if (type === 'trigger') {
    showEl('modal-form-trigger');
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
    showEl('scrape-result');
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

function showEl(id) {
  const el = document.getElementById(id);
  if (el) el.removeAttribute('hidden');
}

function hideEl(id) {
  const el = document.getElementById(id);
  if (el) el.setAttribute('hidden', '');
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
