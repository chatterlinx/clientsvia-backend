/**
 * ============================================================================
 * BOOKING CONFIGURATION — Page Controller
 * ClientsVia Agent Console · booking.html
 *
 * Sections:
 *   1. Bridge
 *   2. Caller Recognition
 *   3. Built-in Fields (Name, Phone, Address)
 *   4. Custom Fields (dynamic table, drag-to-reorder)
 *   5. Alt Contact Collection
 *   6. Confirmation Step
 *   7. Calendar & Scheduling
 *   8. Digression & Slot Filling
 *   9. Booking Triggers (link + stats)
 *
 * API: GET/POST /api/admin/agent2/company/:companyId/booking-config
 * ============================================================================
 */

'use strict';

// ── STATE ────────────────────────────────────────────────────────────────────
let companyId     = null;
let bookingConfig = {};
let customFields  = [];
let isDirty       = false;

// ── FLOW VISUALIZER STEPS ─────────────────────────────────────────────────────
const FLOW_STEPS = [
  { key: 'bridge',       label: 'Bridge',        alwaysActive: false },
  { key: 'recognition',  label: 'Recognition',   optional: true },
  { key: 'name',         label: 'Name',           alwaysActive: true },
  { key: 'phone',        label: 'Phone',          alwaysActive: true },
  { key: 'address',      label: 'Address',        alwaysActive: true },
  { key: 'custom',       label: 'Custom Fields',  optional: true },
  { key: 'altcontact',   label: 'Alt Contact',    optional: true },
  { key: 'confirmation', label: 'Confirmation',   optional: true },
  { key: 'calendar',     label: 'Calendar',       alwaysActive: true },
  { key: 'complete',     label: 'Complete',       alwaysActive: true },
];

// ── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (typeof AgentConsoleAuth === 'undefined') {
    showError('Auth library not loaded');
    return;
  }

  const params = new URLSearchParams(window.location.search);
  companyId = params.get('companyId');
  if (!companyId) {
    showError('Missing companyId in URL');
    return;
  }

  // Wire up back link and triggers link
  const linkBack = document.getElementById('link-back');
  if (linkBack) linkBack.href = `agent2.html?companyId=${encodeURIComponent(companyId)}`;

  const btnGoTriggers = document.getElementById('btn-go-triggers');
  if (btnGoTriggers) btnGoTriggers.href = `booking-triggers.html?companyId=${encodeURIComponent(companyId)}`;

  setupSidebarNav();
  setupEventListeners();

  await loadConfig();
  await loadTriggerStats();
});

// ── SIDEBAR NAV — IntersectionObserver active highlighting ───────────────────
function setupSidebarNav() {
  const sections = document.querySelectorAll('.config-section');
  const navItems = document.querySelectorAll('.nav-item');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id.replace('section-', '');
        navItems.forEach(item => {
          item.classList.toggle('active', item.dataset.section === id);
        });
      }
    });
  }, { rootMargin: '-20% 0px -70% 0px' });

  sections.forEach(s => observer.observe(s));

  // Smooth scroll on nav click
  navItems.forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const section = document.getElementById('section-' + item.dataset.section);
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// ── EVENT LISTENERS ───────────────────────────────────────────────────────────
function setupEventListeners() {
  // Save all button
  document.getElementById('btn-save-all').addEventListener('click', saveAll);

  // Add custom field
  document.getElementById('btn-add-custom-field').addEventListener('click', () => openFieldPanel(-1));

  // Toggle: Caller Recognition
  setupToggle('recognition-enabled', 'recognition-settings');

  // Toggle: Alt Contact
  setupToggle('altcontact-enabled', 'altcontact-settings');

  // Nested toggle: Allow Multiple Alt Contacts
  setupToggle('altcontact-allow-multiple', 'altcontact-multiple-settings');

  // Scheduling Preference Capture toggle
  setupToggle('preference-capture-enabled', 'preference-capture-settings');

  // Confirmation toggle controls its sub-settings visibility
  const confirmToggle = document.getElementById('confirmation-enabled');
  const confirmSettings = document.getElementById('confirmation-settings');
  if (confirmToggle && confirmSettings) {
    confirmToggle.addEventListener('change', () => {
      confirmSettings.classList.toggle('hidden', !confirmToggle.checked);
      markDirty();
    });
  }

  // Field panel type buttons
  document.querySelectorAll('#panel-type-selector .type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#panel-type-selector .type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const choicesGroup = document.getElementById('panel-choices-group');
      choicesGroup.classList.toggle('hidden', btn.dataset.type !== 'choice');
    });
  });

  // Field panel label → key auto-generation
  const labelInput = document.getElementById('panel-label');
  const keyInput   = document.getElementById('panel-key');
  if (labelInput && keyInput) {
    labelInput.addEventListener('input', () => {
      if (keyInput.dataset.manuallyEdited) return;
      keyInput.value = slugify(labelInput.value);
    });
    keyInput.addEventListener('input', () => {
      keyInput.dataset.manuallyEdited = keyInput.value ? 'true' : '';
    });
  }

  // Mark dirty on any form change
  document.querySelectorAll('textarea, input[type="text"], select').forEach(el => {
    el.addEventListener('input',  markDirty);
    el.addEventListener('change', markDirty);
  });
  document.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach(el => {
    el.addEventListener('change', markDirty);
  });
}

function setupToggle(toggleId, settingsId) {
  const toggle   = document.getElementById(toggleId);
  const settings = document.getElementById(settingsId);
  if (!toggle || !settings) return;
  toggle.addEventListener('change', () => {
    settings.classList.toggle('hidden', !toggle.checked);
    updateFlowVisualizer();
    markDirty();
  });
}

// ── DATA LOADING ──────────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const data = await AgentConsoleAuth.apiFetch(
      `/api/admin/agent2/company/${companyId}/booking-config`
    );

    if (!data.success) {
      showToast('error', 'Load failed', data.error || 'Could not load booking config');
      return;
    }

    bookingConfig = data.bookingConfig || {};
    customFields  = (bookingConfig.customFields || []).map((f, i) => ({ ...f, _order: f.order ?? i }));
    customFields.sort((a, b) => a._order - b._order);

    populateForm(bookingConfig);

    // Show company name if available from auth
    if (typeof AgentConsoleAuth.getCompanyName === 'function') {
      const name = await AgentConsoleAuth.getCompanyName(companyId);
      if (name) document.getElementById('company-name-display').textContent = name;
    }

    isDirty = false;
    updateFlowVisualizer();

  } catch (err) {
    console.error('[BookingConfig] Load failed:', err);
    showToast('error', 'Load failed', err.message || 'Network error');
    // Initialize empty so the page is usable
    bookingConfig = {};
    customFields  = [];
    populateForm({});
    updateFlowVisualizer();
  }
}

async function loadTriggerStats() {
  try {
    const data = await AgentConsoleAuth.apiFetch(
      `/api/admin/agent2/company/${companyId}/booking-triggers`
    );
    const triggers = data.triggers || data.data || [];

    const total    = triggers.length;
    const active   = triggers.filter(t => !t.disabled).length;
    const info     = triggers.filter(t => t.behavior === 'INFO').length;
    const block    = triggers.filter(t => t.behavior === 'BLOCK').length;
    const redirect = triggers.filter(t => t.behavior === 'REDIRECT').length;

    setText('triggers-total',    total);
    setText('triggers-active',   active);
    setText('triggers-info',     info);
    setText('triggers-block',    block);
    setText('triggers-redirect', redirect);

  } catch (_err) {
    // Non-fatal — stats are cosmetic
    setText('triggers-total',    '?');
    setText('triggers-active',   '?');
    setText('triggers-info',     '?');
    setText('triggers-block',    '?');
    setText('triggers-redirect', '?');
  }
}

// ── FORM POPULATION ───────────────────────────────────────────────────────────
function populateForm(config) {
  // Section 1: Bridge
  setValue('bridge-phrase', config.bridgePhrase || '');

  // Section 2: Caller Recognition
  const cr = config.callerRecognition || {};
  setChecked('recognition-enabled', !!cr.enabled);
  setValue('recognition-confirm-prompt', cr.confirmAllPrompt || '');
  setRadio('recognition-on-yes', cr.onConfirmedYes || 'SKIP_TO_CUSTOM');
  document.getElementById('recognition-settings')?.classList.toggle('hidden', !cr.enabled);

  // Section 3: Built-in Prompts
  const bp = config.builtinPrompts || {};
  // NAME
  setValue('builtin-ask-name',                  bp.askName                     || '');
  setValue('builtin-name-reanchor',             bp.nameReAnchor                || '');
  setValue('builtin-confirm-full-name',         bp.confirmFullName             || '');
  setValue('builtin-confirm-first-ask-last',    bp.confirmFirstNameAskLast     || '');
  setValue('builtin-ask-last-name-only',        bp.askLastNameOnly             || '');
  setValue('builtin-confirm-name-ambiguous',    bp.confirmNameAmbiguous        || '');
  setValue('builtin-confirm-name-partial',      bp.confirmNamePartialCorrected || '');
  setValue('builtin-confirm-first-got-last',    bp.confirmFirstNameGotLastAsk  || '');
  // PHONE
  setValue('builtin-ask-phone',                 bp.askPhone                    || '');
  setValue('builtin-phone-reanchor',            bp.phoneReAnchor               || '');
  setValue('builtin-phone-invalid',             bp.phoneInvalid                || '');
  // ADDRESS
  setValue('builtin-ask-address',              bp.askAddress                  || '');
  setValue('builtin-address-reanchor',         bp.addressReAnchor             || '');
  // DIGRESSION
  setValue('builtin-t2-digression-ack',        bp.t2DigressionAck             || '');

  // Section 4: Custom Fields
  renderCustomFields();

  // Section 5: Alt Contact
  const ac = config.altContact || {};
  setChecked('altcontact-enabled',       !!ac.enabled);
  setValue('altcontact-offer-prompt',    ac.offerPrompt    || '');
  setValue('altcontact-ask-name',        ac.askNamePrompt  || '');
  setValue('altcontact-ask-phone',       ac.askPhonePrompt || '');
  setValue('altcontact-ask-notes',       ac.askNotesPrompt || '');
  setChecked('altcontact-allow-multiple', !!ac.allowMultiple);
  setValue('altcontact-multiple-prompt', ac.multiplePrompt || '');
  document.getElementById('altcontact-settings')?.classList.toggle('hidden', !ac.enabled);
  document.getElementById('altcontact-multiple-settings')?.classList.toggle('hidden', !ac.allowMultiple);

  // Section 6: Confirmation
  const conf = config.confirmation || {};
  const confirmEnabled = conf.enabled !== false; // default true
  setChecked('confirmation-enabled', confirmEnabled);
  setValue('confirmation-template',       conf.template            || '');
  setRadio('confirmation-on-no',          conf.onNo                || 'RECOLLECT_ALL');
  setValue('confirmation-time-confirm',   conf.timeConfirmPrompt   || '');
  setValue('confirmation-time-ambiguous', conf.timeAmbiguousPrompt || '');
  document.getElementById('confirmation-settings')?.classList.toggle('hidden', !confirmEnabled);

  // Section 7: Calendar
  const cal = config.calendar || {};
  setValue('calendar-hold-message',    cal.holdMessage         || '');
  setValue('calendar-offer-times',     cal.offerTimesPrompt    || '');
  setValue('calendar-no-times',        cal.noTimesPrompt       || '');
  setValue('calendar-confirmation-msg', cal.confirmationMessage || '');
  setSelectValue('calendar-duration', String(cal.appointmentDuration || 60));
  setSelectValue('calendar-buffer',   String(cal.bufferMinutes   || 0));
  setSelectValue('calendar-advance',  String(cal.advanceBookingDays || 14));

  // Section 3b: Required Fields Config
  const rfc = config.requiredFieldsConfig || {};
  setChecked('required-address', rfc.address !== false); // default true

  // Section 3c: Scheduling Preference Capture
  const pc = config.preferenceCapture || {};
  const pcEnabled = pc.enabled !== false; // default true
  setChecked('preference-capture-enabled', pcEnabled);
  setValue('preference-ask-day',   pc.askDayPrompt       || '');
  setValue('preference-ask-time',  pc.askTimePrompt      || '');
  setValue('preference-no-slots',  pc.noSlotsOnDayPrompt || '');
  document.getElementById('preference-capture-settings')?.classList.toggle('hidden', !pcEnabled);

  // Section 8: Slot Filling / Digression
  const sf = config.slotFilling || {};
  setSelectValue('slot-max-attempts',    String(sf.defaultMaxAttempts    || 3));
  setSelectValue('slot-fallback-action', sf.defaultFallbackAction        || 'RE_ASK_PLAIN');
  setValue('slot-reanchor-suffix',       sf.reAnchorSuffix               || '');
}

// ── FORM COLLECTION ───────────────────────────────────────────────────────────
function collectForm() {
  return {
    bridgePhrase: getValue('bridge-phrase'),

    callerRecognition: {
      enabled:          getChecked('recognition-enabled'),
      confirmAllPrompt: getValue('recognition-confirm-prompt'),
      onConfirmedYes:   getRadio('recognition-on-yes') || 'SKIP_TO_CUSTOM'
    },

    builtinPrompts: {
      // NAME
      askName:                     getValue('builtin-ask-name'),
      nameReAnchor:                getValue('builtin-name-reanchor'),
      confirmFullName:             getValue('builtin-confirm-full-name'),
      confirmFirstNameAskLast:     getValue('builtin-confirm-first-ask-last'),
      askLastNameOnly:             getValue('builtin-ask-last-name-only'),
      confirmNameAmbiguous:        getValue('builtin-confirm-name-ambiguous'),
      confirmNamePartialCorrected: getValue('builtin-confirm-name-partial'),
      confirmFirstNameGotLastAsk:  getValue('builtin-confirm-first-got-last'),
      // PHONE
      askPhone:                    getValue('builtin-ask-phone'),
      phoneReAnchor:               getValue('builtin-phone-reanchor'),
      phoneInvalid:                getValue('builtin-phone-invalid'),
      // ADDRESS
      askAddress:                  getValue('builtin-ask-address'),
      addressReAnchor:             getValue('builtin-address-reanchor'),
      // DIGRESSION
      t2DigressionAck:             getValue('builtin-t2-digression-ack')
    },

    customFields: customFields.map((f, i) => ({ ...f, order: i, _order: undefined })),

    altContact: {
      enabled:        getChecked('altcontact-enabled'),
      offerPrompt:    getValue('altcontact-offer-prompt'),
      askNamePrompt:  getValue('altcontact-ask-name'),
      askPhonePrompt: getValue('altcontact-ask-phone'),
      askNotesPrompt: getValue('altcontact-ask-notes'),
      allowMultiple:  getChecked('altcontact-allow-multiple'),
      multiplePrompt: getValue('altcontact-multiple-prompt')
    },

    confirmation: {
      enabled:             getChecked('confirmation-enabled'),
      template:            getValue('confirmation-template'),
      onNo:                getRadio('confirmation-on-no')       || 'RECOLLECT_ALL',
      timeConfirmPrompt:   getValue('confirmation-time-confirm'),
      timeAmbiguousPrompt: getValue('confirmation-time-ambiguous')
    },

    calendar: {
      holdMessage:         getValue('calendar-hold-message'),
      offerTimesPrompt:    getValue('calendar-offer-times'),
      noTimesPrompt:       getValue('calendar-no-times'),
      confirmationMessage: getValue('calendar-confirmation-msg'),
      appointmentDuration: parseInt(getSelectValue('calendar-duration'), 10) || 60,
      bufferMinutes:       parseInt(getSelectValue('calendar-buffer'),   10) || 0,
      advanceBookingDays:  parseInt(getSelectValue('calendar-advance'),  10) || 14
    },

    requiredFieldsConfig: {
      address: getChecked('required-address')
    },

    preferenceCapture: {
      enabled:            getChecked('preference-capture-enabled'),
      askDayPrompt:       getValue('preference-ask-day'),
      askTimePrompt:      getValue('preference-ask-time'),
      noSlotsOnDayPrompt: getValue('preference-no-slots')
    },

    slotFilling: {
      defaultMaxAttempts:    parseInt(getSelectValue('slot-max-attempts'), 10) || 3,
      defaultFallbackAction: getSelectValue('slot-fallback-action') || 'RE_ASK_PLAIN',
      reAnchorSuffix:        getValue('slot-reanchor-suffix')
    }
  };
}

// ── SAVE ──────────────────────────────────────────────────────────────────────
async function saveAll() {
  const payload = collectForm();

  showSaveStatus('saving', 'Saving...');
  document.getElementById('btn-save-all').disabled = true;

  try {
    const result = await AgentConsoleAuth.apiFetch(
      `/api/admin/agent2/company/${companyId}/booking-config`,
      { method: 'POST', body: payload }
    );

    if (!result.success) {
      throw new Error(result.error || 'Save failed');
    }

    showSaveStatus('saved', 'Saved');
    showToast('success', 'Saved', 'Booking configuration saved successfully.');
    isDirty = false;

    // Auto-clear saved status
    setTimeout(() => showSaveStatus('', ''), 3000);

  } catch (err) {
    console.error('[BookingConfig] Save failed:', err);
    showSaveStatus('error', 'Error');
    showToast('error', 'Save failed', err.message || 'Could not save configuration.');
    setTimeout(() => showSaveStatus('', ''), 5000);

  } finally {
    document.getElementById('btn-save-all').disabled = false;
  }
}

// ── FLOW VISUALIZER ───────────────────────────────────────────────────────────
function setupFlowVisualizer() {
  updateFlowVisualizer();
}

function updateFlowVisualizer() {
  const vis = document.getElementById('flow-visualizer');
  if (!vis) return;

  const recognitionOn  = getChecked('recognition-enabled');
  const hasCustom      = customFields.length > 0;
  const altContactOn   = getChecked('altcontact-enabled');
  const confirmationOn = getChecked('confirmation-enabled');
  const bridgeText     = getValue('bridge-phrase').trim();

  const steps = [
    { label: 'Bridge',        active: !!bridgeText,    optional: true  },
    { label: 'Recognition',   active: recognitionOn,   optional: true  },
    { label: 'Name',          active: true,            optional: false },
    { label: 'Phone',         active: true,            optional: false },
    { label: 'Address',       active: true,            optional: false },
    { label: 'Custom Fields', active: hasCustom,       optional: true  },
    { label: 'Alt Contact',   active: altContactOn,    optional: true  },
    { label: 'Confirmation',  active: confirmationOn,  optional: true  },
    { label: 'Calendar',      active: true,            optional: false },
    { label: 'Complete',      active: true,            optional: false },
  ];

  vis.innerHTML = steps.map((step, i) => {
    const cls = step.active
      ? 'flow-step active'
      : step.optional
        ? 'flow-step optional'
        : 'flow-step disabled';

    const arrow = i < steps.length - 1 ? '<span class="flow-arrow">›</span>' : '';

    return `<div class="${cls}">
      <div class="flow-step-dot"></div>
      ${escHtml(step.label)}
    </div>${arrow}`;
  }).join('');
}

// ── CUSTOM FIELDS TABLE ───────────────────────────────────────────────────────
function renderCustomFields() {
  const body  = document.getElementById('custom-fields-body');
  const empty = document.getElementById('custom-fields-empty');
  const table = document.getElementById('custom-fields-table');

  if (!customFields.length) {
    if (empty) empty.classList.remove('hidden');
    if (table) table.classList.add('hidden');
    return;
  }

  if (empty) empty.classList.add('hidden');
  if (table) table.classList.remove('hidden');

  body.innerHTML = customFields.map((field, i) => `
    <div class="custom-field-row" data-index="${i}" draggable="true">
      <div class="drag-handle" title="Drag to reorder">⠿</div>
      <div class="field-label-cell" title="${escHtml(field.key || '')}">
        ${escHtml(field.label || '—')}
      </div>
      <div>
        <span class="field-type-pill">${escHtml(field.fieldType || 'text')}</span>
      </div>
      <div>
        <span class="field-required-pill ${field.required ? 'is-required' : ''}">
          ${field.required ? '● Required' : '○ Optional'}
        </span>
      </div>
      <div style="color:var(--color-gray-600);font-size:var(--font-size-xs)">${field.maxAttempts || 3}×</div>
      <div style="color:var(--color-gray-500);font-size:var(--font-size-xs)">${escHtml(fallbackLabel(field.fallbackAction))}</div>
      <div class="row-actions">
        <button class="btn-icon" title="Edit" onclick="openFieldPanel(${i})">✎</button>
        <button class="btn-icon danger" title="Delete" onclick="deleteCustomField(${i})">✕</button>
      </div>
    </div>
  `).join('');

  initDragSort();
  updateFlowVisualizer();
}

function fallbackLabel(action) {
  const map = {
    RE_ASK_PLAIN:   'Re-ask',
    SKIP:           'Skip',
    TRANSFER:       'Transfer',
    COLLECT_ASYNC:  'Async'
  };
  return map[action] || action || 'Re-ask';
}

// ── DRAG-TO-REORDER ───────────────────────────────────────────────────────────
function initDragSort() {
  const rows = document.querySelectorAll('.custom-field-row');
  let dragIndex = null;

  rows.forEach(row => {
    row.addEventListener('dragstart', e => {
      dragIndex = parseInt(row.dataset.index, 10);
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      document.querySelectorAll('.custom-field-row').forEach(r => r.classList.remove('drag-over'));
    });

    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.custom-field-row').forEach(r => r.classList.remove('drag-over'));
      row.classList.add('drag-over');
    });

    row.addEventListener('drop', e => {
      e.preventDefault();
      const dropIndex = parseInt(row.dataset.index, 10);
      if (dragIndex !== null && dragIndex !== dropIndex) {
        const moved = customFields.splice(dragIndex, 1)[0];
        customFields.splice(dropIndex, 0, moved);
        dragIndex = null;
        renderCustomFields();
        markDirty();
      }
    });
  });
}

// ── CUSTOM FIELD PANEL ────────────────────────────────────────────────────────
function openFieldPanel(index) {
  const panel   = document.getElementById('field-panel');
  const overlay = document.getElementById('field-panel-overlay');
  const title   = document.getElementById('panel-title');

  document.getElementById('panel-field-index').value = index;

  // Reset type buttons
  document.querySelectorAll('#panel-type-selector .type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('#panel-type-selector .type-btn[data-type="text"]').classList.add('active');
  document.getElementById('panel-choices-group').classList.add('hidden');
  document.getElementById('panel-choices-list').innerHTML = '';

  // Clear manual-edit flag on key
  const keyInput = document.getElementById('panel-key');
  delete keyInput.dataset.manuallyEdited;

  if (index === -1) {
    title.textContent = 'Add Custom Field';
    // Clear all fields
    setValue('panel-label',              '');
    setValue('panel-key',                '');
    setValue('panel-prompt',             '');
    setValue('panel-reanchor',           '');
    setValue('panel-confirmation-label', '');
    setChecked('panel-required', false);
    setSelectValue('panel-max-attempts', '3');
    setSelectValue('panel-fallback',     'RE_ASK_PLAIN');
  } else {
    title.textContent = 'Edit Custom Field';
    const field = customFields[index] || {};

    setValue('panel-label',              field.label             || '');
    setValue('panel-key',                field.key               || '');
    setValue('panel-prompt',             field.prompt            || '');
    setValue('panel-reanchor',           field.reAnchorPhrase    || '');
    setValue('panel-confirmation-label', field.confirmationLabel || '');
    setChecked('panel-required', !!field.required);
    setSelectValue('panel-max-attempts', String(field.maxAttempts    || 3));
    setSelectValue('panel-fallback',     field.fallbackAction        || 'RE_ASK_PLAIN');

    // Set type
    const fieldType = field.fieldType || 'text';
    document.querySelectorAll('#panel-type-selector .type-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.type === fieldType);
    });
    if (fieldType === 'choice') {
      document.getElementById('panel-choices-group').classList.remove('hidden');
      renderChoices(field.choices || []);
    }

    keyInput.dataset.manuallyEdited = 'true';
  }

  panel.classList.remove('hidden');
  overlay.classList.remove('hidden');
  document.getElementById('panel-label').focus();
}

function closeFieldPanel() {
  document.getElementById('field-panel').classList.add('hidden');
  document.getElementById('field-panel-overlay').classList.add('hidden');
}

function saveFieldPanel() {
  const index  = parseInt(document.getElementById('panel-field-index').value, 10);
  const label  = getValue('panel-label').trim();
  const key    = getValue('panel-key').trim();
  const prompt = getValue('panel-prompt').trim();

  if (!label) { showToast('error', 'Validation', 'Label is required.'); return; }
  if (!key)   { showToast('error', 'Validation', 'Field key is required.'); return; }
  if (!prompt) { showToast('error', 'Validation', 'Ask prompt is required.'); return; }

  const activeType = document.querySelector('#panel-type-selector .type-btn.active');
  const fieldType  = activeType ? activeType.dataset.type : 'text';

  const choices = [];
  document.querySelectorAll('.choice-input').forEach(inp => {
    const v = inp.value.trim();
    if (v) choices.push(v);
  });

  const field = {
    label,
    key,
    fieldType,
    required:          getChecked('panel-required'),
    prompt,
    reAnchorPhrase:    getValue('panel-reanchor').trim(),
    maxAttempts:       parseInt(getSelectValue('panel-max-attempts'), 10) || 3,
    fallbackAction:    getSelectValue('panel-fallback') || 'RE_ASK_PLAIN',
    choices:           fieldType === 'choice' ? choices : [],
    confirmationLabel: getValue('panel-confirmation-label').trim() || label,
    order:             index === -1 ? customFields.length : (customFields[index]?.order ?? customFields.length)
  };

  if (index === -1) {
    customFields.push(field);
  } else {
    customFields[index] = field;
  }

  closeFieldPanel();
  renderCustomFields();
  markDirty();
  showToast('success', 'Field saved', `"${label}" has been ${index === -1 ? 'added' : 'updated'}.`);
}

function deleteCustomField(index) {
  const field = customFields[index];
  if (!field) return;
  if (!confirm(`Delete the field "${field.label}"? This cannot be undone.`)) return;

  customFields.splice(index, 1);
  renderCustomFields();
  markDirty();
  showToast('info', 'Field removed', `"${field.label}" was removed.`);
}

// ── CHOICE MANAGEMENT ─────────────────────────────────────────────────────────
function renderChoices(choices) {
  const list = document.getElementById('panel-choices-list');
  list.innerHTML = '';
  choices.forEach(c => addChoiceRow(c));
}

function addChoice() {
  addChoiceRow('');
}

function addChoiceRow(value) {
  const list = document.getElementById('panel-choices-list');
  const row  = document.createElement('div');
  row.className = 'choice-row';
  row.innerHTML = `
    <input type="text" class="choice-input" value="${escHtml(value)}" placeholder="Choice option">
    <button class="btn-icon danger" onclick="this.parentElement.remove()">✕</button>
  `;
  list.appendChild(row);
  row.querySelector('input').focus();
}

// ── FIELD CARD TOGGLE (built-in fields) ───────────────────────────────────────
function toggleFieldCard(name) {
  const wrap = document.getElementById(`field-card-${name}-wrap`);
  const body = document.getElementById(`field-card-${name}`);
  if (!wrap || !body) return;

  const isExpanded = wrap.classList.contains('expanded');
  wrap.classList.toggle('expanded', !isExpanded);
  body.classList.toggle('visible', !isExpanded);
}

// ── DIRTY STATE ──────────────────────────────────────────────────────────────
function markDirty() {
  if (!isDirty) {
    isDirty = true;
    document.getElementById('btn-save-all').style.background = 'var(--color-primary-700)';
  }
  updateFlowVisualizer();
}

function clearDirty() {
  isDirty = false;
  document.getElementById('btn-save-all').style.background = '';
}

// ── SAVE STATUS ──────────────────────────────────────────────────────────────
function showSaveStatus(type, msg) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = msg;
  el.className = type ? `visible ${type}` : '';
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function showToast(type, title, message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const colors = {
    success: { bg: '#f0fdf4', border: '#22c55e', color: '#16a34a' },
    error:   { bg: '#fef2f2', border: '#ef4444', color: '#dc2626' },
    warning: { bg: '#fffbeb', border: '#f59e0b', color: '#d97706' },
    info:    { bg: '#eff6ff', border: '#3b82f6', color: '#2563eb' }
  };
  const c = colors[type] || colors.info;

  toast.style.cssText = `
    background:${c.bg};border:1px solid ${c.border};border-radius:8px;
    padding:12px 16px;min-width:260px;max-width:340px;box-shadow:0 4px 12px rgba(0,0,0,0.1);
    display:flex;flex-direction:column;gap:2px;animation:slideIn 0.2s ease;
  `;
  toast.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:${c.color}">${escHtml(title)}</div>
    ${message ? `<div style="font-size:12px;color:#374151">${escHtml(message)}</div>` : ''}
  `;

  container.appendChild(toast);
  setTimeout(() => { if (toast.parentElement) toast.remove(); }, 4000);
}

function showError(msg) {
  document.body.innerHTML = `<div style="padding:40px;text-align:center;color:#dc2626;font-family:sans-serif">Error: ${escHtml(msg)}</div>`;
}

// ── DOM HELPERS ───────────────────────────────────────────────────────────────
function getValue(id)       { return (document.getElementById(id)?.value || ''); }
function setValue(id, val)  { const el = document.getElementById(id); if (el) el.value = val ?? ''; }
function getChecked(id)     { return !!(document.getElementById(id)?.checked); }
function setChecked(id, v)  { const el = document.getElementById(id); if (el) el.checked = !!v; }
function getSelectValue(id) { return document.getElementById(id)?.value || ''; }
function setText(id, val)   { const el = document.getElementById(id); if (el) el.textContent = val; }

function setSelectValue(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  for (const opt of el.options) {
    if (opt.value === val) { opt.selected = true; return; }
  }
}

function getRadio(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : null;
}

function setRadio(name, value) {
  const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (radio) radio.checked = true;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// Expose functions that booking.html calls inline
window.toggleFieldCard = toggleFieldCard;
window.openFieldPanel  = openFieldPanel;
window.closeFieldPanel = closeFieldPanel;
window.saveFieldPanel  = saveFieldPanel;
window.deleteCustomField = deleteCustomField;
window.addChoice       = addChoice;
