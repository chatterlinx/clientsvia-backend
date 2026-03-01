/**
 * ============================================================================
 * LLM SETTINGS UI — Company-Scoped AI Configuration
 * ============================================================================
 * 
 * PURPOSE:
 * - Configure LLM behavior per company (profiles, guardrails, prompts)
 * - Prevent settings bleed between different business types
 * - Export/Import JSON templates (HVAC → another HVAC company)
 * 
 * SCOPE:
 * - Settings are company-specific: /api/admin/llm-settings?scope=company:ID
 * - Each company has independent configuration
 * - No global defaults (start from scratch or import template)
 * 
 * ============================================================================
 */

// ════════════════════════════════════════════════════════════════════════════
// STATE MANAGEMENT
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
// INITIALIZATION
// ════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[LLM Settings] Initializing...');
  
  // Extract companyId from URL
  const urlParams = new URLSearchParams(window.location.search);
  state.companyId = urlParams.get('companyId');
  
  if (!state.companyId) {
    showToast('error', 'Missing companyId parameter');
    return;
  }
  
  console.log('[LLM Settings] Company ID:', state.companyId);
  
  // Initialize UI
  setupEventListeners();
  setupTabNavigation();
  
  // Load settings
  await loadSettings();
  
  console.log('[LLM Settings] Initialized successfully');
});

// ════════════════════════════════════════════════════════════════════════════
// API CALLS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Load LLM settings for the current company
 */
async function loadSettings() {
  try {
    showLoadingState();
    
    const token = localStorage.getItem('token');
    const scope = `company:${state.companyId}`;
    
    const response = await fetch(`/api/admin/llm-settings?scope=${encodeURIComponent(scope)}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    state.settings = data.settings;
    state.profiles = data.profiles;
    state.promptParts = data.promptParts;
    
    console.log('[LLM Settings] Loaded settings:', state.settings);
    
    // Update UI
    renderAllSections();
    updatePreview();
    
    hideLoadingState();
    
  } catch (error) {
    console.error('[LLM Settings] Load error:', error);
    showToast('error', `Failed to load settings: ${error.message}`);
    hideLoadingState();
  }
}

/**
 * Save current settings to backend
 */
async function saveSettings() {
  try {
    const token = localStorage.getItem('token');
    const scope = `company:${state.companyId}`;
    
    const response = await fetch('/api/admin/llm-settings', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        scope,
        settings: state.settings
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    state.settings = data.settings;
    state.promptParts = data.promptParts;
    state.unsavedChanges = false;
    
    updateSaveButtonState();
    updateFooter();
    updatePreview();
    
    showToast('success', 'Settings saved successfully');
    
  } catch (error) {
    console.error('[LLM Settings] Save error:', error);
    showToast('error', `Failed to save settings: ${error.message}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// UI RENDERING
// ════════════════════════════════════════════════════════════════════════════

/**
 * Render all sections after loading settings
 */
function renderAllSections() {
  renderOverviewTab();
  renderProfilesTab();
  renderGuardrailsTab();
  renderDomainsTab();
  renderPromptsTab();
  renderGenerationTab();
  updateCompanyHeader();
}

/**
 * Update company name in header
 */
function updateCompanyHeader() {
  // TODO: Fetch company name from API or pass via URL
  document.getElementById('header-company-name').textContent = state.companyName || `Company ${state.companyId}`;
  document.getElementById('header-company-id').textContent = state.companyId;
  document.getElementById('overview-company-name').textContent = state.companyName || `Company ${state.companyId}`;
}

/**
 * Render Overview Tab
 */
function renderOverviewTab() {
  if (!state.settings) return;
  
  const activeProfile = state.settings.defaults?.activeProfile || 'compliance_safe';
  const profileInfo = state.profiles[activeProfile];
  
  // Active Profile Card
  const profileCard = document.getElementById('overview-active-profile');
  profileCard.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div style="font-weight: 600; font-size: 1rem; margin-bottom: 4px;">
          ${profileInfo.label}
        </div>
        <div style="font-size: 0.875rem; color: var(--color-gray-600);">
          ${profileInfo.description}
        </div>
        <div style="margin-top: 8px; font-size: 0.875rem; color: var(--color-gray-500);">
          Model: <strong>${profileInfo.model}</strong> • 
          Temp: <strong>${profileInfo.temperature}</strong> • 
          Max Tokens: <strong>${profileInfo.maxTokens}</strong>
        </div>
      </div>
      <button class="btn btn-sm btn-primary" onclick="switchToTab('profiles')">
        Change Profile
      </button>
    </div>
  `;
  
  // Domain Modes
  const domainModes = [];
  if (state.settings.compliance?.medicalOfficeMode) domainModes.push('Medical');
  if (state.settings.compliance?.financialMode) domainModes.push('Financial');
  if (state.settings.compliance?.emergencyServicesMode) domainModes.push('Emergency');
  
  const domainContainer = document.getElementById('overview-domain-modes');
  if (domainModes.length === 0) {
    domainContainer.innerHTML = '<span class="badge badge-secondary">None Active</span>';
  } else {
    domainContainer.innerHTML = domainModes.map(mode => 
      `<span class="badge badge-warning">${mode} Mode</span>`
    ).join('');
  }
  
  // Stats
  const statsContainer = document.getElementById('overview-stats');
  statsContainer.innerHTML = `
    <div style="padding: 16px; background: var(--color-gray-50); border-radius: 8px;">
      <div style="font-size: 0.75rem; color: var(--color-gray-600); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">
        Active Profile
      </div>
      <div style="font-size: 1.25rem; font-weight: 600; color: var(--color-gray-900);">
        ${profileInfo.label}
      </div>
    </div>
    <div style="padding: 16px; background: var(--color-gray-50); border-radius: 8px;">
      <div style="font-size: 0.75rem; color: var(--color-gray-600); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">
        Domain Modes
      </div>
      <div style="font-size: 1.25rem; font-weight: 600; color: var(--color-gray-900);">
        ${domainModes.length} Active
      </div>
    </div>
    <div style="padding: 16px; background: var(--color-gray-50); border-radius: 8px;">
      <div style="font-size: 0.75rem; color: var(--color-gray-600); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">
        Generation Mode
      </div>
      <div style="font-size: 1.25rem; font-weight: 600; color: var(--color-gray-900);">
        ${state.settings.defaults?.generationMode === 'multi' ? 'Multi-Variant' : 'Single'}
      </div>
    </div>
  `;
}

/**
 * Render Profiles Tab
 */
function renderProfilesTab() {
  if (!state.profiles) return;
  
  const activeProfile = state.settings.defaults?.activeProfile || 'compliance_safe';
  const profileGrid = document.getElementById('profile-grid');
  
  const profileCards = Object.values(state.profiles).map(profile => {
    const isActive = profile.key === activeProfile;
    return `
      <div class="profile-card ${isActive ? 'active' : ''}" onclick="selectProfile('${profile.key}')">
        <div class="profile-card-header">
          <h3 class="profile-card-title">${profile.label}</h3>
          ${isActive ? '<span class="profile-card-badge">Active</span>' : ''}
        </div>
        <p class="profile-card-description">${profile.description}</p>
        <div class="profile-card-meta">
          <div class="profile-card-meta-item">
            <span class="profile-card-meta-label">Model:</span>
            <span>${profile.model}</span>
          </div>
          <div class="profile-card-meta-item">
            <span class="profile-card-meta-label">Temperature:</span>
            <span>${profile.temperature}</span>
          </div>
          <div class="profile-card-meta-item">
            <span class="profile-card-meta-label">Max Tokens:</span>
            <span>${profile.maxTokens}</span>
          </div>
          <div class="profile-card-meta-item">
            <span class="profile-card-meta-label">Safety:</span>
            <span>${profile.safetyMode}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  profileGrid.innerHTML = profileCards;
  
  // Update model override dropdown
  const modelOverride = state.settings.defaults?.modelOverride || '';
  document.getElementById('model-override').value = modelOverride;
  
  // Update temperature slider (TODO: implement overrides)
  const currentProfile = state.profiles[activeProfile];
  const temperature = state.settings.overrides?.[activeProfile]?.temperature || currentProfile.temperature;
  document.getElementById('temperature-override').value = temperature;
  document.getElementById('temperature-value').textContent = temperature;
  
  // Update max tokens slider
  const maxTokens = state.settings.overrides?.[activeProfile]?.maxTokens || currentProfile.maxTokens;
  document.getElementById('max-tokens-override').value = maxTokens;
  document.getElementById('max-tokens-value').textContent = maxTokens;
}

/**
 * Render Guardrails Tab
 */
function renderGuardrailsTab() {
  const guardrailList = document.getElementById('guardrail-list');
  
  // Hardcoded guardrails for V1 (will be dynamic later)
  const guardrails = [
    {
      id: 'booking-restriction',
      title: 'Booking Appointments',
      description: 'LLM cannot book, modify, or cancel appointments. It can only answer questions and route to booking flow.',
      enabled: true,
      locked: true // Cannot be disabled
    },
    {
      id: 'pricing-restriction',
      title: 'Pricing & Fees',
      description: 'LLM cannot quote exact prices or make guarantees. Use generic language and route to sales team.',
      enabled: true,
      locked: true
    },
    {
      id: 'emergency-escalation',
      title: 'Emergency Handling',
      description: 'LLM must immediately escalate emergencies to 911 or human. No triage or severity assessment.',
      enabled: true,
      locked: true
    },
    {
      id: 'sensitive-data',
      title: 'Sensitive Data Collection',
      description: 'LLM cannot collect SSN, credit cards, or medical info unless domain mode explicitly allows.',
      enabled: true,
      locked: false
    }
  ];
  
  guardrailList.innerHTML = guardrails.map(g => `
    <div class="guardrail-item">
      <div class="guardrail-header">
        <h4 class="guardrail-title">${g.title}</h4>
        <label class="toggle-switch">
          <input type="checkbox" ${g.enabled ? 'checked' : ''} ${g.locked ? 'disabled' : ''} 
                 onchange="toggleGuardrail('${g.id}', this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <p class="guardrail-description">
        ${g.description}
        ${g.locked ? ' <strong>(Required - Cannot be disabled)</strong>' : ''}
      </p>
    </div>
  `).join('');
}

/**
 * Render Domain Safety Tab
 */
function renderDomainsTab() {
  const domainList = document.getElementById('domain-list');
  
  const domains = [
    {
      id: 'medicalOfficeMode',
      title: 'Medical Office Mode',
      description: 'Enable for medical, dental, or healthcare businesses. Enforces HIPAA compliance and prohibits diagnosis/treatment advice.',
      enabled: state.settings.compliance?.medicalOfficeMode || false
    },
    {
      id: 'financialMode',
      title: 'Financial & Billing Mode',
      description: 'Enable for billing, payment, or financial services. Prohibits investment/tax advice and exact price quotes.',
      enabled: state.settings.compliance?.financialMode || false
    },
    {
      id: 'emergencyServicesMode',
      title: 'Emergency Services Mode',
      description: 'Enable for contexts where callers may be in danger. Enforces immediate escalation without triage.',
      enabled: state.settings.compliance?.emergencyServicesMode || false
    }
  ];
  
  domainList.innerHTML = domains.map(d => `
    <div class="guardrail-item">
      <div class="guardrail-header">
        <h4 class="guardrail-title">${d.title}</h4>
        <label class="toggle-switch">
          <input type="checkbox" ${d.enabled ? 'checked' : ''} 
                 onchange="toggleDomainMode('${d.id}', this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <p class="guardrail-description">${d.description}</p>
    </div>
  `).join('');
}

/**
 * Render Prompts Tab
 */
function renderPromptsTab() {
  if (!state.settings.promptText) return;
  
  // Base prompt
  document.getElementById('prompt-base').value = state.settings.promptText.base || '';
  
  // Profile prompt
  const activeProfile = state.settings.defaults?.activeProfile || 'compliance_safe';
  const profilePrompt = state.settings.promptText.profiles?.[activeProfile] || '';
  document.getElementById('prompt-profile').value = profilePrompt;
  
  // Domain prompts (show only if enabled)
  renderDomainPrompts();
}

/**
 * Render domain prompt editors based on enabled modes
 */
function renderDomainPrompts() {
  const container = document.getElementById('domain-prompts-container');
  const domainPrompts = [];
  
  if (state.settings.compliance?.medicalOfficeMode) {
    domainPrompts.push({
      id: 'medicalOffice',
      label: 'Medical Office Safety Prompt',
      value: state.settings.promptText.domainSafety?.medicalOffice || ''
    });
  }
  
  if (state.settings.compliance?.financialMode) {
    domainPrompts.push({
      id: 'financial',
      label: 'Financial Safety Prompt',
      value: state.settings.promptText.domainSafety?.financial || ''
    });
  }
  
  if (state.settings.compliance?.emergencyServicesMode) {
    domainPrompts.push({
      id: 'emergency',
      label: 'Emergency Services Prompt',
      value: state.settings.promptText.domainSafety?.emergency || ''
    });
  }
  
  container.innerHTML = domainPrompts.map(p => `
    <div style="margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <label style="font-weight: 600;">${p.label}</label>
        <button class="btn btn-sm btn-ghost" onclick="resetDomainPrompt('${p.id}')">Reset to Default</button>
      </div>
      <textarea id="prompt-domain-${p.id}" class="prompt-editor" 
                onchange="updateDomainPrompt('${p.id}', this.value)">${p.value}</textarea>
    </div>
  `).join('');
}

/**
 * Render Generation Tab
 */
function renderGenerationTab() {
  const mode = state.settings.defaults?.generationMode || 'single';
  document.querySelector(`input[name="generation-mode"][value="${mode}"]`).checked = true;
  
  const variantCount = state.settings.defaults?.defaultVariantCount || 3;
  document.getElementById('variant-count').value = variantCount;
  document.getElementById('variant-count-value').textContent = variantCount;
  
  // Show/hide variant count based on mode
  document.getElementById('variant-count-group').style.display = mode === 'multi' ? 'block' : 'none';
}

// ════════════════════════════════════════════════════════════════════════════
// PREVIEW PANEL
// ════════════════════════════════════════════════════════════════════════════

/**
 * Update live preview sidebar
 */
function updatePreview() {
  if (!state.promptParts) return;
  
  const previewContainer = document.getElementById('preview-content');
  let html = '';
  
  // Base prompt
  html += `
    <div class="preview-section">
      <div class="preview-section-label base">Base Prompt</div>
      <div class="preview-text">${escapeHtml(state.promptParts.base)}</div>
    </div>
  `;
  
  // Profile prompt
  if (state.promptParts.profile) {
    html += `
      <div class="preview-section">
        <div class="preview-section-label profile">Profile: ${state.promptParts.profileKey}</div>
        <div class="preview-text">${escapeHtml(state.promptParts.profile)}</div>
      </div>
    `;
  }
  
  // Domain prompts
  if (state.promptParts.domains) {
    if (state.promptParts.domains.medicalOfficeMode) {
      html += `
        <div class="preview-section">
          <div class="preview-section-label domain">Medical Mode</div>
          <div class="preview-text">${escapeHtml(state.promptParts.domains.medicalOfficeMode)}</div>
        </div>
      `;
    }
    if (state.promptParts.domains.financialMode) {
      html += `
        <div class="preview-section">
          <div class="preview-section-label domain">Financial Mode</div>
          <div class="preview-text">${escapeHtml(state.promptParts.domains.financialMode)}</div>
        </div>
      `;
    }
    if (state.promptParts.domains.emergencyServicesMode) {
      html += `
        <div class="preview-section">
          <div class="preview-section-label domain">Emergency Mode</div>
          <div class="preview-text">${escapeHtml(state.promptParts.domains.emergencyServicesMode)}</div>
        </div>
      `;
    }
  }
  
  // Strict compliance
  if (state.promptParts.strictCompliance) {
    html += `
      <div class="preview-section">
        <div class="preview-section-label guardrail">Strict Compliance</div>
        <div class="preview-text">${escapeHtml(state.promptParts.strictCompliance)}</div>
      </div>
    `;
  }
  
  previewContainer.innerHTML = html;
  
  // Update character and token counts
  const fullPrompt = Object.values(state.promptParts)
    .filter(v => typeof v === 'string')
    .join('\n\n');
  
  const charCount = fullPrompt.length;
  const tokenCount = Math.ceil(charCount / 4); // Rough estimate: 1 token ≈ 4 chars
  
  document.getElementById('preview-char-count').textContent = `${charCount.toLocaleString()} chars`;
  document.getElementById('preview-token-count').textContent = `~${tokenCount.toLocaleString()} tokens`;
}

// ════════════════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Setup all event listeners
 */
function setupEventListeners() {
  // Back button
  document.getElementById('btn-back').addEventListener('click', () => {
    if (state.unsavedChanges) {
      if (confirm('You have unsaved changes. Are you sure you want to leave?')) {
        window.location.href = '/agent-console/';
      }
    } else {
      window.location.href = '/agent-console/';
    }
  });
  
  // Save button
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  
  // Export button
  document.getElementById('btn-export-settings').addEventListener('click', exportSettings);
  
  // Import button
  document.getElementById('btn-import-settings').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  
  // Import file input
  document.getElementById('import-file-input').addEventListener('change', handleImportFile);
  
  // Copy preview button
  document.getElementById('btn-copy-preview').addEventListener('click', copyPreviewToClipboard);
  
  // Model override
  document.getElementById('model-override').addEventListener('change', (e) => {
    updateSetting('defaults.modelOverride', e.target.value || null);
  });
  
  // Temperature slider
  document.getElementById('temperature-override').addEventListener('input', (e) => {
    document.getElementById('temperature-value').textContent = e.target.value;
  });
  document.getElementById('temperature-override').addEventListener('change', (e) => {
    const activeProfile = state.settings.defaults?.activeProfile || 'compliance_safe';
    updateSetting(`overrides.${activeProfile}.temperature`, parseFloat(e.target.value));
  });
  
  // Max tokens slider
  document.getElementById('max-tokens-override').addEventListener('input', (e) => {
    document.getElementById('max-tokens-value').textContent = e.target.value;
  });
  document.getElementById('max-tokens-override').addEventListener('change', (e) => {
    const activeProfile = state.settings.defaults?.activeProfile || 'compliance_safe';
    updateSetting(`overrides.${activeProfile}.maxTokens`, parseInt(e.target.value));
  });
  
  // Generation mode
  document.querySelectorAll('input[name="generation-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      updateSetting('defaults.generationMode', e.target.value);
      document.getElementById('variant-count-group').style.display = e.target.value === 'multi' ? 'block' : 'none';
    });
  });
  
  // Variant count slider
  document.getElementById('variant-count').addEventListener('input', (e) => {
    document.getElementById('variant-count-value').textContent = e.target.value;
  });
  document.getElementById('variant-count').addEventListener('change', (e) => {
    updateSetting('defaults.defaultVariantCount', parseInt(e.target.value));
  });
  
  // Prompt editors
  document.getElementById('prompt-base').addEventListener('change', (e) => {
    updateSetting('promptText.base', e.target.value);
  });
  
  document.getElementById('prompt-profile').addEventListener('change', (e) => {
    const activeProfile = state.settings.defaults?.activeProfile || 'compliance_safe';
    updateSetting(`promptText.profiles.${activeProfile}`, e.target.value);
  });
}

/**
 * Setup tab navigation
 */
function setupTabNavigation() {
  document.querySelectorAll('.llm-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      switchToTab(tabName);
    });
  });
}

/**
 * Switch to a specific tab
 */
function switchToTab(tabName) {
  state.activeTab = tabName;
  
  // Update tab buttons
  document.querySelectorAll('.llm-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  
  // Update tab panels
  document.querySelectorAll('.llm-tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `panel-${tabName}`);
  });
}

/**
 * Select a profile
 */
function selectProfile(profileKey) {
  updateSetting('defaults.activeProfile', profileKey);
  renderProfilesTab();
  renderPromptsTab();
  updatePreview();
}

/**
 * Toggle guardrail
 */
function toggleGuardrail(guardrailId, enabled) {
  console.log('[LLM Settings] Toggle guardrail:', guardrailId, enabled);
  // TODO: Implement guardrail state management
  markUnsavedChanges();
}

/**
 * Toggle domain mode
 */
function toggleDomainMode(domainId, enabled) {
  updateSetting(`compliance.${domainId}`, enabled);
  renderPromptsTab(); // Re-render to show/hide domain prompt editors
  updatePreview();
}

/**
 * Update domain prompt
 */
function updateDomainPrompt(domainId, value) {
  updateSetting(`promptText.domainSafety.${domainId}`, value);
}

/**
 * Reset domain prompt to default
 */
function resetDomainPrompt(domainId) {
  if (confirm('Reset this prompt to default?')) {
    // TODO: Fetch default from backend
    showToast('info', 'Reset to default (not implemented yet)');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORT / IMPORT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Export settings as JSON file
 */
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
  
  showToast('success', 'Settings exported successfully');
}

/**
 * Handle import file selection
 */
function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const importData = JSON.parse(e.target.result);
      
      if (!importData.settings) {
        throw new Error('Invalid settings file');
      }
      
      if (confirm(`Import settings from ${importData.companyName || 'Unknown Company'}?\n\nThis will replace all current settings.`)) {
        state.settings = importData.settings;
        renderAllSections();
        updatePreview();
        markUnsavedChanges();
        showToast('success', 'Settings imported successfully. Click Save to persist.');
      }
    } catch (error) {
      console.error('[LLM Settings] Import error:', error);
      showToast('error', `Failed to import: ${error.message}`);
    }
  };
  
  reader.readAsText(file);
  
  // Reset file input
  event.target.value = '';
}

/**
 * Copy preview to clipboard
 */
function copyPreviewToClipboard() {
  const fullPrompt = Object.values(state.promptParts)
    .filter(v => typeof v === 'string')
    .join('\n\n');
  
  navigator.clipboard.writeText(fullPrompt)
    .then(() => showToast('success', 'Copied to clipboard'))
    .catch(() => showToast('error', 'Failed to copy'));
}

// ════════════════════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Update a setting value (supports nested paths with dot notation)
 */
function updateSetting(path, value) {
  const keys = path.split('.');
  let obj = state.settings;
  
  for (let i = 0; i < keys.length - 1; i++) {
    if (!obj[keys[i]]) {
      obj[keys[i]] = {};
    }
    obj = obj[keys[i]];
  }
  
  obj[keys[keys.length - 1]] = value;
  
  markUnsavedChanges();
}

/**
 * Mark that there are unsaved changes
 */
function markUnsavedChanges() {
  state.unsavedChanges = true;
  updateSaveButtonState();
  updateFooter();
  
  // Show alert
  document.getElementById('unsaved-changes-alert').style.display = 'block';
}

/**
 * Update save button state
 */
function updateSaveButtonState() {
  const saveButton = document.getElementById('btn-save-settings');
  saveButton.disabled = !state.unsavedChanges;
}

/**
 * Update footer status
 */
function updateFooter() {
  const statusEl = document.getElementById('footer-save-status');
  statusEl.textContent = state.unsavedChanges ? 'Unsaved changes' : 'All changes saved';
  statusEl.style.color = state.unsavedChanges ? 'var(--color-warning-600)' : 'var(--color-success-600)';
}

// ════════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ════════════════════════════════════════════════════════════════════════════

function showLoadingState() {
  // TODO: Implement loading spinner
  console.log('[LLM Settings] Loading...');
}

function hideLoadingState() {
  console.log('[LLM Settings] Load complete');
}

function showToast(type, message) {
  console.log(`[Toast] ${type}:`, message);
  // TODO: Implement toast notifications
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
