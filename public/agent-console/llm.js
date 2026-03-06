/**
 * ============================================================================
 * LLM SETTINGS UI — Company-Scoped AI Configuration
 * ============================================================================
 *
 * 4 tabs: Overview | AI Model | Prompts & Safety | Call Handling
 *
 * Settings are company-specific: /api/admin/llm-settings?scope=company:ID
 * Each company has independent configuration stored in the LLMSettings collection.
 * ============================================================================
 */

console.log('[LLM] ── llm.js loaded ──');

// ════════════════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════════════════

const state = {
  companyId: null,
  companyName: '',
  settings: null,
  profiles: null,
  promptParts: null,
  unsavedChanges: false,
  activeTab: 'overview'
};

// ════════════════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[LLM] ── DOMContentLoaded fired ──');

  const urlParams = new URLSearchParams(window.location.search);
  state.companyId = urlParams.get('companyId');
  console.log('[LLM] companyId:', state.companyId);

  if (!state.companyId) {
    showToast('error', 'Missing companyId parameter');
    return;
  }

  try {
    console.log('[LLM] setupTabNavigation…');
    setupTabNavigation();
    console.log('[LLM] setupTabNavigation ✓');
  } catch (err) {
    console.error('[LLM] setupTabNavigation FAILED:', err);
  }

  try {
    console.log('[LLM] setupEventListeners…');
    setupEventListeners();
    console.log('[LLM] setupEventListeners ✓');
  } catch (err) {
    console.error('[LLM] setupEventListeners FAILED:', err);
  }

  try {
    console.log('[LLM] loadSettings…');
    await loadSettings();
    console.log('[LLM] loadSettings ✓');
  } catch (err) {
    console.error('[LLM] loadSettings FAILED:', err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// API
// ════════════════════════════════════════════════════════════════════════════

async function loadSettings() {
  try {
    showLoadingState();
    const scope = `company:${state.companyId}`;
    console.log('[LLM] Fetching settings for scope:', scope);

    const data = await AgentConsoleAuth.apiFetch(`/api/admin/llm-settings?scope=${encodeURIComponent(scope)}`);
    console.log('[LLM] Settings API response received:', { hasSettings: !!data?.settings, hasProfiles: !!data?.profiles, hasPromptParts: !!data?.promptParts });

    state.settings = data.settings;
    state.profiles = data.profiles;
    state.promptParts = data.promptParts;

    // Fetch company name
    try {
      console.log('[LLM] Fetching truth data…');
      const truthData = await AgentConsoleAuth.apiFetch(`/api/agent-console/${state.companyId}/truth`);
      state.companyName = truthData?.companyProfile?.businessName ||
                          truthData?.companyProfile?.companyName || '';
      console.log('[LLM] Company name:', state.companyName || '(empty)');
    } catch (err) {
      console.warn('[LLM] Truth fetch failed (non-critical):', err.message);
    }

    console.log('[LLM] renderAllSections…');
    renderAllSections();
    console.log('[LLM] renderAllSections ✓');

    console.log('[LLM] updatePreview…');
    updatePreview();
    console.log('[LLM] updatePreview ✓');

    hideLoadingState();
    console.log('[LLM] ── Page fully loaded ──');
  } catch (error) {
    console.error('[LLM] Load error:', error);
    showToast('error', `Failed to load settings: ${error.message}`);
    hideLoadingState();
  }
}

async function saveSettings() {
  try {
    const scope = `company:${state.companyId}`;
    const data = await AgentConsoleAuth.apiFetch('/api/admin/llm-settings', {
      method: 'PUT',
      body: JSON.stringify({ scope, settings: state.settings })
    });

    state.settings = data.settings;
    state.promptParts = data.promptParts;
    state.unsavedChanges = false;

    updateSaveButtonState();
    updateFooter();
    updatePreview();

    // Update last-saved timestamp
    const ts = document.getElementById('footer-last-saved');
    if (ts) ts.textContent = `Last saved: ${new Date().toLocaleTimeString()}`;

    showToast('success', 'Settings saved successfully');
  } catch (error) {
    console.error('[LLM Settings] Save error:', error);
    showToast('error', `Failed to save: ${error.message}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// RENDERING
// ════════════════════════════════════════════════════════════════════════════

function renderAllSections() {
  try { console.log('[LLM]   updateCompanyHeader…'); updateCompanyHeader(); console.log('[LLM]   updateCompanyHeader ✓'); }
  catch (e) { console.error('[LLM]   updateCompanyHeader FAILED:', e); }

  try { console.log('[LLM]   renderOverviewTab…'); renderOverviewTab(); console.log('[LLM]   renderOverviewTab ✓'); }
  catch (e) { console.error('[LLM]   renderOverviewTab FAILED:', e); }

  try { console.log('[LLM]   renderModelTab…'); renderModelTab(); console.log('[LLM]   renderModelTab ✓'); }
  catch (e) { console.error('[LLM]   renderModelTab FAILED:', e); }

  try { console.log('[LLM]   renderPromptsSafetyTab…'); renderPromptsSafetyTab(); console.log('[LLM]   renderPromptsSafetyTab ✓'); }
  catch (e) { console.error('[LLM]   renderPromptsSafetyTab FAILED:', e); }

  try { console.log('[LLM]   renderCallHandlingTab…'); renderCallHandlingTab(); console.log('[LLM]   renderCallHandlingTab ✓'); }
  catch (e) { console.error('[LLM]   renderCallHandlingTab FAILED:', e); }
}

function updateCompanyHeader() {
  const name = state.companyName || `Company ${state.companyId}`;
  document.getElementById('header-company-name').textContent = name;
  document.getElementById('header-company-id').textContent = state.companyId;
  document.getElementById('overview-company-name').textContent = name;
}

// ── Overview Tab ──────────────────────────────────────────────────────────

function renderOverviewTab() {
  if (!state.settings) return;

  // Company context
  setVal('company-context', state.settings.companyContext);

  const activeProfile = state.settings.defaults?.activeProfile || 'compliance_safe';
  const profileInfo = state.profiles?.[activeProfile];
  if (!profileInfo) return;

  // Active profile card
  document.getElementById('overview-active-profile').innerHTML = `
    <div class="overview-profile-top">
      <div>
        <div class="overview-profile-name">${profileInfo.label}</div>
        <div class="overview-profile-desc">${profileInfo.description}</div>
        <div class="overview-profile-meta">
          Model: <strong>${profileInfo.model}</strong> &bull;
          Temp: <strong>${profileInfo.temperature}</strong> &bull;
          Max Tokens: <strong>${profileInfo.maxTokens}</strong>
        </div>
      </div>
      <button class="btn btn-sm btn-primary" onclick="switchToTab('model')">Change Profile</button>
    </div>
  `;

  // Domain mode badges
  const modes = [];
  if (state.settings.compliance?.medicalOfficeMode) modes.push('Medical');
  if (state.settings.compliance?.financialMode) modes.push('Financial');
  if (state.settings.compliance?.emergencyServicesMode) modes.push('Emergency');

  const domainEl = document.getElementById('overview-domain-modes');
  domainEl.innerHTML = modes.length
    ? modes.map(m => `<span class="badge badge-warning">${m} Mode</span>`).join('')
    : '<span class="badge">None Active</span>';

  // Stats
  document.getElementById('overview-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-card-label">Active Profile</div>
      <div class="stat-card-value">${profileInfo.label}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Domain Modes</div>
      <div class="stat-card-value">${modes.length} Active</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Generation Mode</div>
      <div class="stat-card-value">${state.settings.defaults?.generationMode === 'multi' ? 'Multi-Variant' : 'Single'}</div>
    </div>
  `;
}

// ── AI Model Tab ──────────────────────────────────────────────────────────

function renderModelTab() {
  if (!state.profiles) return;

  const activeProfile = state.settings.defaults?.activeProfile || 'compliance_safe';

  // Profile cards
  const profileGrid = document.getElementById('profile-grid');
  profileGrid.innerHTML = Object.values(state.profiles).map(p => `
    <div class="profile-card ${p.key === activeProfile ? 'active' : ''}" onclick="selectProfile('${p.key}')">
      <div class="profile-card-header">
        <h3 class="profile-card-title">${p.label}</h3>
        ${p.key === activeProfile ? '<span class="profile-card-badge">Active</span>' : ''}
      </div>
      <p class="profile-card-description">${p.description}</p>
      <div class="profile-card-meta">
        <div class="profile-card-meta-item"><span class="profile-card-meta-label">Model:</span><span>${p.model}</span></div>
        <div class="profile-card-meta-item"><span class="profile-card-meta-label">Temperature:</span><span>${p.temperature}</span></div>
        <div class="profile-card-meta-item"><span class="profile-card-meta-label">Max Tokens:</span><span>${p.maxTokens}</span></div>
        <div class="profile-card-meta-item"><span class="profile-card-meta-label">Safety:</span><span>${p.safetyMode}</span></div>
      </div>
    </div>
  `).join('');

  // Model override
  const currentProfile = state.profiles[activeProfile];
  setVal('model-override', state.settings.defaults?.modelOverride || '');

  // Temperature
  const temp = state.settings.overrides?.[activeProfile]?.temperature ?? currentProfile.temperature;
  setVal('temperature-override', temp);
  setText('temperature-value', temp);

  // Top P
  const topP = state.settings.overrides?.[activeProfile]?.topP ?? currentProfile.topP;
  setVal('topp-override', topP);
  setText('topp-value', topP);

  // Max Tokens
  const maxTokens = state.settings.overrides?.[activeProfile]?.maxTokens ?? currentProfile.maxTokens;
  setVal('max-tokens-override', maxTokens);
  setText('max-tokens-value', maxTokens);

  // Generation mode
  const mode = state.settings.defaults?.generationMode || 'single';
  const radio = document.querySelector(`input[name="generation-mode"][value="${mode}"]`);
  if (radio) radio.checked = true;

  const variantCount = state.settings.defaults?.defaultVariantCount || 3;
  setVal('variant-count', variantCount);
  setText('variant-count-value', variantCount);

  const vcGroup = document.getElementById('variant-count-group');
  if (vcGroup) vcGroup.hidden = mode !== 'multi';
}

// ── Prompts & Safety Tab ──────────────────────────────────────────────────

function renderPromptsSafetyTab() {
  if (!state.settings?.promptText) return;

  // Base prompt
  setVal('prompt-base', state.settings.promptText.base || '');

  // Profile prompt
  const activeProfile = state.settings.defaults?.activeProfile || 'compliance_safe';
  setVal('prompt-profile', state.settings.promptText.profiles?.[activeProfile] || '');

  // Domain safety (toggle + prompt together)
  renderDomainSafetySection();

  // Strict compliance
  const strictEnabled = state.settings.compliance?.strictComplianceMode !== false;
  setChecked('strict-compliance-toggle', strictEnabled);
  setVal('prompt-strict-compliance', state.settings.promptText.strictCompliance || '');
  toggleFieldset('strict-compliance-fields', strictEnabled);
}

function renderDomainSafetySection() {
  const container = document.getElementById('domain-safety-container');
  const domains = [
    { id: 'medicalOfficeMode', promptId: 'medicalOffice', title: 'Medical Office Mode',
      description: 'Enable for medical, dental, or healthcare businesses. Enforces HIPAA compliance.',
      promptLabel: 'Medical Office Safety Prompt' },
    { id: 'financialMode', promptId: 'financial', title: 'Financial & Billing Mode',
      description: 'Enable for billing, payment, or financial services. Prohibits investment/tax advice.',
      promptLabel: 'Financial Safety Prompt' },
    { id: 'emergencyServicesMode', promptId: 'emergency', title: 'Emergency Services Mode',
      description: 'Enable for contexts where callers may be in danger. Enforces immediate escalation.',
      promptLabel: 'Emergency Services Prompt' }
  ];

  container.innerHTML = domains.map(d => {
    const enabled = state.settings.compliance?.[d.id] || false;
    const promptValue = state.settings.promptText?.domainSafety?.[d.promptId] || '';
    return `
      <div class="domain-safety-group">
        <div class="domain-safety-header">
          <div>
            <div class="domain-safety-title">${d.title}</div>
            <div class="domain-safety-description">${d.description}</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleDomainMode('${d.id}', this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        ${enabled ? `
          <div class="domain-safety-prompt">
            <div class="prompt-section-header">
              <label class="prompt-section-label">${d.promptLabel}</label>
              <button class="btn btn-sm btn-ghost" onclick="resetDomainPrompt('${d.promptId}')">Reset to Default</button>
            </div>
            <textarea id="prompt-domain-${d.promptId}" class="prompt-editor" style="min-height: 120px;"
                      onchange="updateDomainPrompt('${d.promptId}', this.value)">${escapeHtml(promptValue)}</textarea>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

// ── Call Handling Tab ──────────────────────────────────────────────────────

function renderCallHandlingTab() {
  const ch = state.settings?.callHandling;
  if (!ch) return;

  // Recovery Messages
  const rm = ch.recoveryMessages || {};
  setVal('ch-recovery-audio-unclear', rm.audioUnclear);
  setVal('ch-recovery-silence', rm.silenceRecovery);
  setVal('ch-recovery-connection-cutout', rm.connectionCutOut);
  setVal('ch-recovery-general-error', rm.generalError);
  setVal('ch-recovery-technical-transfer', rm.technicalTransfer);

  // Silence Handling
  const sh = ch.silenceHandling || {};
  setChecked('ch-silence-enabled', sh.enabled !== false);
  setVal('ch-silence-threshold', sh.thresholdSeconds);
  setVal('ch-silence-max-prompts', sh.maxPrompts);
  setVal('ch-silence-first', sh.firstPrompt);
  setVal('ch-silence-second', sh.secondPrompt);
  setVal('ch-silence-third', sh.thirdPrompt);
  setChecked('ch-silence-offer-callback', sh.offerCallback !== false);
  setVal('ch-silence-callback-msg', sh.callbackMessage);
  toggleFieldset('silence-handling-fields', sh.enabled !== false);

  // Customer Patience
  const cp = ch.customerPatience || {};
  setChecked('ch-patience-enabled', cp.enabled !== false);
  setChecked('ch-patience-never-hangup', cp.neverAutoHangup !== false);
  setVal('ch-patience-max-prompts', cp.maxPatiencePrompts);
  setChecked('ch-patience-always-callback', cp.alwaysOfferCallback !== false);
  setVal('ch-patience-message', cp.patienceMessage);
  toggleFieldset('patience-fields', cp.enabled !== false);

  // Low Confidence
  const lc = ch.lowConfidenceHandling || {};
  setChecked('ch-lowconf-enabled', lc.enabled !== false);
  setVal('ch-lowconf-threshold', lc.threshold);
  setText('ch-lowconf-threshold-value', (lc.threshold || 60) + '%');
  setVal('ch-lowconf-action', lc.action);
  setVal('ch-lowconf-repeat-phrase', lc.repeatPhrase);
  setVal('ch-lowconf-max-repeats', lc.maxRepeatsBeforeEscalation);
  setChecked('ch-lowconf-preserve-booking', lc.preserveBookingOnLowConfidence !== false);
  setVal('ch-lowconf-escalate-phrase', lc.escalatePhrase);
  setVal('ch-lowconf-booking-phrase', lc.bookingRepeatPhrase);
  setChecked('ch-lowconf-deepgram', lc.useDeepgramFallback !== false);
  setVal('ch-lowconf-dg-fallback-threshold', lc.deepgramFallbackThreshold);
  setVal('ch-lowconf-dg-accept-threshold', lc.deepgramAcceptThreshold);
  toggleFieldset('lowconf-fields', lc.enabled !== false);
}

// ════════════════════════════════════════════════════════════════════════════
// PREVIEW
// ════════════════════════════════════════════════════════════════════════════

function updatePreview() {
  if (!state.settings?.promptText) return;

  const activeProfile = state.settings.defaults?.activeProfile || 'compliance_safe';
  const previewContainer = document.getElementById('preview-content');
  let html = '';

  // Base prompt
  const baseText = state.settings.promptText.base || '';
  html += `<div class="preview-section">
    <div class="preview-section-label base">Base Prompt</div>
    <div class="preview-text">${escapeHtml(baseText)}</div>
  </div>`;

  // Company context
  const ctxText = state.settings.companyContext || '';
  if (ctxText) {
    html += `<div class="preview-section">
      <div class="preview-section-label context">Company Context</div>
      <div class="preview-text">${escapeHtml(ctxText)}</div>
    </div>`;
  }

  // Profile prompt
  const profileText = state.settings.promptText.profiles?.[activeProfile] || '';
  if (profileText) {
    html += `<div class="preview-section">
      <div class="preview-section-label profile">Profile: ${activeProfile}</div>
      <div class="preview-text">${escapeHtml(profileText)}</div>
    </div>`;
  }

  // Domain prompts
  const ds = state.settings.promptText.domainSafety || {};
  const comp = state.settings.compliance || {};
  if (comp.medicalOfficeMode && ds.medicalOffice) {
    html += `<div class="preview-section"><div class="preview-section-label domain">Medical Mode</div><div class="preview-text">${escapeHtml(ds.medicalOffice)}</div></div>`;
  }
  if (comp.financialMode && ds.financial) {
    html += `<div class="preview-section"><div class="preview-section-label domain">Financial Mode</div><div class="preview-text">${escapeHtml(ds.financial)}</div></div>`;
  }
  if (comp.emergencyServicesMode && ds.emergency) {
    html += `<div class="preview-section"><div class="preview-section-label domain">Emergency Mode</div><div class="preview-text">${escapeHtml(ds.emergency)}</div></div>`;
  }

  // Strict compliance
  const strictText = state.settings.promptText.strictCompliance || '';
  if (comp.strictComplianceMode && activeProfile !== 'compliance_safe' && strictText) {
    html += `<div class="preview-section"><div class="preview-section-label strict">Strict Compliance</div><div class="preview-text">${escapeHtml(strictText)}</div></div>`;
  }

  previewContainer.innerHTML = html;

  // Token count — include all active parts
  const parts = [
    baseText, ctxText, profileText,
    comp.medicalOfficeMode ? (ds.medicalOffice || '') : '',
    comp.financialMode ? (ds.financial || '') : '',
    comp.emergencyServicesMode ? (ds.emergency || '') : '',
    (comp.strictComplianceMode && activeProfile !== 'compliance_safe') ? strictText : ''
  ].filter(Boolean);

  const fullPrompt = parts.join('\n\n');
  const charCount = fullPrompt.length;
  const tokenCount = Math.ceil(charCount / 4);
  setText('preview-char-count', `${charCount.toLocaleString()} chars`);
  setText('preview-token-count', `~${tokenCount.toLocaleString()} tokens`);
}

// ════════════════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ════════════════════════════════════════════════════════════════════════════

function setupEventListeners() {
  console.log('[LLM] Wiring event listeners…');

  // Navigation
  document.getElementById('btn-back')?.addEventListener('click', navigateBack);
  document.getElementById('header-logo-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigateBack();
  });

  // Save / Export / Import
  document.getElementById('btn-save-settings')?.addEventListener('click', saveSettings);
  document.getElementById('btn-export-settings')?.addEventListener('click', exportSettings);
  document.getElementById('btn-import-settings')?.addEventListener('click', () => {
    document.getElementById('import-file-input')?.click();
  });
  document.getElementById('import-file-input')?.addEventListener('change', handleImportFile);
  document.getElementById('btn-copy-preview')?.addEventListener('click', copyPreviewToClipboard);

  // ── AI Model tab ──
  document.getElementById('model-override')?.addEventListener('change', (e) => {
    updateSetting('defaults.modelOverride', e.target.value || null);
  });

  // Temperature
  document.getElementById('temperature-override')?.addEventListener('input', (e) => {
    setText('temperature-value', e.target.value);
  });
  document.getElementById('temperature-override')?.addEventListener('change', (e) => {
    const ap = state.settings.defaults?.activeProfile || 'compliance_safe';
    updateSetting(`overrides.${ap}.temperature`, parseFloat(e.target.value));
  });

  // Top P
  document.getElementById('topp-override')?.addEventListener('input', (e) => {
    setText('topp-value', e.target.value);
  });
  document.getElementById('topp-override')?.addEventListener('change', (e) => {
    const ap = state.settings.defaults?.activeProfile || 'compliance_safe';
    updateSetting(`overrides.${ap}.topP`, parseFloat(e.target.value));
  });

  // Max Tokens
  document.getElementById('max-tokens-override')?.addEventListener('input', (e) => {
    setText('max-tokens-value', e.target.value);
  });
  document.getElementById('max-tokens-override')?.addEventListener('change', (e) => {
    const ap = state.settings.defaults?.activeProfile || 'compliance_safe';
    updateSetting(`overrides.${ap}.maxTokens`, parseInt(e.target.value));
  });

  // Generation mode
  document.querySelectorAll('input[name="generation-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      updateSetting('defaults.generationMode', e.target.value);
      const vcGroup = document.getElementById('variant-count-group');
      if (vcGroup) vcGroup.hidden = e.target.value !== 'multi';
    });
  });
  document.getElementById('variant-count')?.addEventListener('input', (e) => {
    setText('variant-count-value', e.target.value);
  });
  document.getElementById('variant-count')?.addEventListener('change', (e) => {
    updateSetting('defaults.defaultVariantCount', parseInt(e.target.value));
  });

  // ── Prompts & Safety tab ──
  document.getElementById('company-context')?.addEventListener('change', (e) => {
    updateSetting('companyContext', e.target.value);
    updatePreview();
  });

  document.getElementById('prompt-base')?.addEventListener('change', (e) => {
    updateSetting('promptText.base', e.target.value);
    updatePreview();
  });

  document.getElementById('prompt-profile')?.addEventListener('change', (e) => {
    const ap = state.settings.defaults?.activeProfile || 'compliance_safe';
    updateSetting(`promptText.profiles.${ap}`, e.target.value);
    updatePreview();
  });

  // Strict compliance toggle
  document.getElementById('strict-compliance-toggle')?.addEventListener('change', (e) => {
    updateSetting('compliance.strictComplianceMode', e.target.checked);
    toggleFieldset('strict-compliance-fields', e.target.checked);
    updatePreview();
  });

  document.getElementById('prompt-strict-compliance')?.addEventListener('change', (e) => {
    updateSetting('promptText.strictCompliance', e.target.value);
    updatePreview();
  });

  // Reset buttons (prompts)
  document.getElementById('btn-reset-base-prompt')?.addEventListener('click', () => resetPromptSection('base prompt'));
  document.getElementById('btn-reset-profile-prompt')?.addEventListener('click', () => resetPromptSection('profile prompt'));
  document.getElementById('btn-reset-strict-compliance')?.addEventListener('click', () => resetPromptSection('strict compliance prompt'));

  // ── Call Handling tab ──
  setupCallHandlingListeners();
  console.log('[LLM] All event listeners wired ✓');
}

function setupCallHandlingListeners() {
  function bindInput(id, path, parse) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', (e) => {
      updateSetting(`callHandling.${path}`, parse ? parse(e.target.value) : e.target.value);
    });
  }
  function bindCheck(id, path) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', (e) => {
      updateSetting(`callHandling.${path}`, e.target.checked);
    });
  }

  // Recovery Messages
  bindInput('ch-recovery-audio-unclear', 'recoveryMessages.audioUnclear');
  bindInput('ch-recovery-silence', 'recoveryMessages.silenceRecovery');
  bindInput('ch-recovery-connection-cutout', 'recoveryMessages.connectionCutOut');
  bindInput('ch-recovery-general-error', 'recoveryMessages.generalError');
  bindInput('ch-recovery-technical-transfer', 'recoveryMessages.technicalTransfer');

  // Silence Handling
  bindCheck('ch-silence-enabled', 'silenceHandling.enabled');
  document.getElementById('ch-silence-enabled')?.addEventListener('change', (e) => {
    toggleFieldset('silence-handling-fields', e.target.checked);
  });
  bindInput('ch-silence-threshold', 'silenceHandling.thresholdSeconds', v => parseInt(v, 10));
  bindInput('ch-silence-max-prompts', 'silenceHandling.maxPrompts', v => parseInt(v, 10));
  bindInput('ch-silence-first', 'silenceHandling.firstPrompt');
  bindInput('ch-silence-second', 'silenceHandling.secondPrompt');
  bindInput('ch-silence-third', 'silenceHandling.thirdPrompt');
  bindCheck('ch-silence-offer-callback', 'silenceHandling.offerCallback');
  bindInput('ch-silence-callback-msg', 'silenceHandling.callbackMessage');

  // Customer Patience
  bindCheck('ch-patience-enabled', 'customerPatience.enabled');
  document.getElementById('ch-patience-enabled')?.addEventListener('change', (e) => {
    toggleFieldset('patience-fields', e.target.checked);
  });
  bindCheck('ch-patience-never-hangup', 'customerPatience.neverAutoHangup');
  bindInput('ch-patience-max-prompts', 'customerPatience.maxPatiencePrompts', v => parseInt(v, 10));
  bindCheck('ch-patience-always-callback', 'customerPatience.alwaysOfferCallback');
  bindInput('ch-patience-message', 'customerPatience.patienceMessage');

  // Low Confidence
  bindCheck('ch-lowconf-enabled', 'lowConfidenceHandling.enabled');
  document.getElementById('ch-lowconf-enabled')?.addEventListener('change', (e) => {
    toggleFieldset('lowconf-fields', e.target.checked);
  });
  const thresholdSlider = document.getElementById('ch-lowconf-threshold');
  if (thresholdSlider) {
    thresholdSlider.addEventListener('input', (e) => {
      setText('ch-lowconf-threshold-value', e.target.value + '%');
    });
    thresholdSlider.addEventListener('change', (e) => {
      updateSetting('callHandling.lowConfidenceHandling.threshold', parseInt(e.target.value, 10));
    });
  }
  bindInput('ch-lowconf-action', 'lowConfidenceHandling.action');
  bindInput('ch-lowconf-repeat-phrase', 'lowConfidenceHandling.repeatPhrase');
  bindInput('ch-lowconf-max-repeats', 'lowConfidenceHandling.maxRepeatsBeforeEscalation', v => parseInt(v, 10));
  bindCheck('ch-lowconf-preserve-booking', 'lowConfidenceHandling.preserveBookingOnLowConfidence');
  bindInput('ch-lowconf-escalate-phrase', 'lowConfidenceHandling.escalatePhrase');
  bindInput('ch-lowconf-booking-phrase', 'lowConfidenceHandling.bookingRepeatPhrase');
  bindCheck('ch-lowconf-deepgram', 'lowConfidenceHandling.useDeepgramFallback');
  bindInput('ch-lowconf-dg-fallback-threshold', 'lowConfidenceHandling.deepgramFallbackThreshold', v => parseInt(v, 10));
  bindInput('ch-lowconf-dg-accept-threshold', 'lowConfidenceHandling.deepgramAcceptThreshold', v => parseInt(v, 10));

  // Reset Call Handling
  document.getElementById('btn-reset-callhandling')?.addEventListener('click', async () => {
    if (!confirm('Reset all Call Handling settings to defaults?')) return;
    try {
      const data = await AgentConsoleAuth.apiFetch('/api/admin/llm-settings/reset', {
        method: 'POST',
        body: JSON.stringify({ scope: `company:${state.companyId}`, section: 'callHandling' })
      });
      if (data.settings) {
        state.settings = data.settings;
        renderCallHandlingTab();
        showToast('success', 'Call Handling reset to defaults');
      }
    } catch (err) {
      showToast('error', 'Failed to reset: ' + err.message);
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
// TAB NAVIGATION
// ════════════════════════════════════════════════════════════════════════════

function setupTabNavigation() {
  const tabs = document.querySelectorAll('.llm-tab');
  console.log('[LLM] Found', tabs.length, 'tab buttons');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchToTab(tab.dataset.tab));
  });
}

function switchToTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.llm-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.llm-tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tabName}`));
}

// ════════════════════════════════════════════════════════════════════════════
// ACTIONS
// ════════════════════════════════════════════════════════════════════════════

function selectProfile(profileKey) {
  updateSetting('defaults.activeProfile', profileKey);
  renderModelTab();
  renderPromptsSafetyTab();
  updatePreview();
}

function toggleDomainMode(domainId, enabled) {
  updateSetting(`compliance.${domainId}`, enabled);
  renderPromptsSafetyTab();
  updatePreview();
}

function updateDomainPrompt(domainId, value) {
  updateSetting(`promptText.domainSafety.${domainId}`, value);
  updatePreview();
}

function resetDomainPrompt(domainId) {
  resetPromptSection(`${domainId} domain prompt`);
}

async function resetPromptSection(label) {
  if (!confirm(`Reset all prompts to their defaults? (This resets the entire prompt section.)`)) return;
  try {
    const data = await AgentConsoleAuth.apiFetch('/api/admin/llm-settings/reset', {
      method: 'POST',
      body: JSON.stringify({ scope: `company:${state.companyId}`, section: 'promptText' })
    });
    if (data.settings) {
      state.settings = data.settings;
      state.promptParts = data.promptParts;
      renderPromptsSafetyTab();
      updatePreview();
      showToast('success', 'Prompts reset to defaults');
    }
  } catch (err) {
    showToast('error', 'Failed to reset: ' + err.message);
  }
}

function navigateBack() {
  const backUrl = `/agent-console/?companyId=${encodeURIComponent(state.companyId)}`;
  if (state.unsavedChanges) {
    if (!confirm('You have unsaved changes. Are you sure you want to leave?')) return;
  }
  window.location.href = backUrl;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORT / IMPORT
// ════════════════════════════════════════════════════════════════════════════

function exportSettings() {
  const exportData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    companyId: state.companyId,
    companyName: state.companyName,
    settings: state.settings
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `llm-settings-${state.companyId}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('success', 'Settings exported');
}

function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const importData = JSON.parse(e.target.result);
      if (!importData.settings) throw new Error('Invalid settings file');
      if (!confirm(`Import settings from ${importData.companyName || 'Unknown Company'}?\n\nThis will replace all current settings.`)) return;
      state.settings = importData.settings;
      renderAllSections();
      updatePreview();
      markUnsavedChanges();
      showToast('success', 'Settings imported. Click Save to persist.');
    } catch (error) {
      showToast('error', `Failed to import: ${error.message}`);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function copyPreviewToClipboard() {
  const parts = [];
  if (state.settings?.promptText?.base) parts.push(state.settings.promptText.base);
  if (state.settings?.companyContext) parts.push(state.settings.companyContext);
  const ap = state.settings?.defaults?.activeProfile || 'compliance_safe';
  if (state.settings?.promptText?.profiles?.[ap]) parts.push(state.settings.promptText.profiles[ap]);
  const ds = state.settings?.promptText?.domainSafety || {};
  const comp = state.settings?.compliance || {};
  if (comp.medicalOfficeMode && ds.medicalOffice) parts.push(ds.medicalOffice);
  if (comp.financialMode && ds.financial) parts.push(ds.financial);
  if (comp.emergencyServicesMode && ds.emergency) parts.push(ds.emergency);
  if (comp.strictComplianceMode && ap !== 'compliance_safe' && state.settings?.promptText?.strictCompliance) {
    parts.push(state.settings.promptText.strictCompliance);
  }
  navigator.clipboard.writeText(parts.join('\n\n'))
    .then(() => showToast('success', 'Copied to clipboard'))
    .catch(() => showToast('error', 'Failed to copy'));
}

// ════════════════════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════

function updateSetting(path, value) {
  const keys = path.split('.');
  let obj = state.settings;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!obj[keys[i]]) obj[keys[i]] = {};
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;
  markUnsavedChanges();
}

function markUnsavedChanges() {
  state.unsavedChanges = true;
  updateSaveButtonState();
  updateFooter();
  const alert = document.getElementById('unsaved-changes-alert');
  if (alert) alert.hidden = false;
}

function updateSaveButtonState() {
  document.getElementById('btn-save-settings').disabled = !state.unsavedChanges;
}

function updateFooter() {
  const el = document.getElementById('footer-save-status');
  el.textContent = state.unsavedChanges ? 'Unsaved changes' : 'All changes saved';
  el.style.color = state.unsavedChanges ? 'var(--color-warning-600)' : 'var(--color-success-600)';
}

// ════════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ════════════════════════════════════════════════════════════════════════════

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el && value != null) el.value = value;
}

function setChecked(id, checked) {
  const el = document.getElementById(id);
  if (el) el.checked = checked;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function toggleFieldset(id, show) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.opacity = show ? '1' : '0.4';
  el.style.pointerEvents = show ? 'auto' : 'none';
  el.querySelectorAll('input, textarea, select, button').forEach(input => {
    input.disabled = !show;
  });
}

function showLoadingState() {
  const el = document.getElementById('loading-overlay');
  if (el) el.hidden = false;
}

function hideLoadingState() {
  const el = document.getElementById('loading-overlay');
  if (el) el.hidden = true;
}

function showToast(type, message) {
  console.log(`[LLM] Toast [${type}]:`, message);
  const container = document.getElementById('toast-container');
  if (!container) { console.warn('[LLM] toast-container element not found!'); return; }
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
  setTimeout(() => { if (toast.parentElement) toast.remove(); }, 5000);
}

function getToastIcon(type) {
  const icons = {
    success: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#22c55e" stroke-width="1.5"/><path d="M6 10L9 13L14 7" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    error: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#ef4444" stroke-width="1.5"/><path d="M7 7L13 13M13 7L7 13" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/></svg>',
    warning: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3L18 17H2L10 3Z" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 8V11M10 14V14.5" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round"/></svg>',
    info: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#3b82f6" stroke-width="1.5"/><path d="M10 6V6.5M10 9V14" stroke="#3b82f6" stroke-width="1.5" stroke-linecap="round"/></svg>'
  };
  return icons[type] || icons.info;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
