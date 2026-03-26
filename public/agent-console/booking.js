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
  // Save all
  document.getElementById('btn-save-all').addEventListener('click', saveAll);

  // Add custom field
  document.getElementById('btn-add-custom-field').addEventListener('click', () => openFieldPanel(-1));

  // ── Team & Calendars ──────────────────────────────────────────────────────
  document.getElementById('btn-add-service-type').addEventListener('click', () => openServiceTypeModal(-1));
  document.getElementById('btn-add-technician').addEventListener('click',   () => openTechnicianModal(-1));

  // ── Emergency schedule ────────────────────────────────────────────────────
  setupEmergencyListeners();

  // Re-render holiday emergency column whenever the emergency-enabled toggle changes
  const emergencyToggle = document.getElementById('emergency-enabled');
  if (emergencyToggle) {
    emergencyToggle.addEventListener('change', () => {
      const currentHols = collectHolidays();
      const merged = currentHols.map(h => ({
        ...h,
        group:       (window._holidayCatalogGroups || {})[h.key] || 'federal',
        dateDisplay: (window._holidayDates        || {})[h.key] || '—',
        name:        (window._holidayNames        || {})[h.key] || h.key
      }));
      renderHolidayTable(merged);
    });
  }

  // ── Section toggles ───────────────────────────────────────────────────────
  setupToggle('recognition-enabled',       'recognition-settings');
  setupToggle('altcontact-enabled',        'altcontact-settings');
  setupToggle('altcontact-allow-multiple', 'altcontact-multiple-settings');
  setupToggle('preference-capture-enabled','preference-capture-settings');

  // Address sub-field toggles
  const addrStateToggle = document.getElementById('addr-require-state');
  if (addrStateToggle) {
    addrStateToggle.addEventListener('change', () => {
      const row = document.getElementById('addr-state-prompts');
      if (row) row.style.display = addrStateToggle.checked ? '' : 'none';
      markDirty();
    });
  }
  const addrZipToggle = document.getElementById('addr-require-zip');
  if (addrZipToggle) {
    addrZipToggle.addEventListener('change', () => {
      const row = document.getElementById('addr-zip-prompts');
      if (row) row.style.display = addrZipToggle.checked ? '' : 'none';
      markDirty();
    });
  }

  // Confirmation toggle
  const confirmToggle   = document.getElementById('confirmation-enabled');
  const confirmSettings = document.getElementById('confirmation-settings');
  if (confirmToggle && confirmSettings) {
    confirmToggle.addEventListener('change', () => {
      confirmSettings.classList.toggle('hidden', !confirmToggle.checked);
      markDirty();
    });
  }

  // Field panel type selector
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

  // Global dirty-state tracking for all plain form inputs
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

  // Section 3b-2: Address Collection Config (multi-step toggles)
  const addrCfg = config.addressConfig || {};
  setChecked('addr-require-city',  addrCfg.requireCity  !== false); // default true
  setChecked('addr-require-state', !!addrCfg.requireState);         // default false
  setChecked('addr-require-zip',   !!addrCfg.requireZip);           // default false
  setValue('addr-ask-city',  addrCfg.askCityPrompt  || '');
  setValue('addr-ask-state', addrCfg.askStatePrompt || '');
  setValue('addr-ask-zip',   addrCfg.askZipPrompt   || '');
  // Show/hide sub-prompt rows based on saved toggle state
  const stateRow = document.getElementById('addr-state-prompts');
  if (stateRow) stateRow.style.display = addrCfg.requireState ? '' : 'none';
  const zipRow   = document.getElementById('addr-zip-prompts');
  if (zipRow)   zipRow.style.display   = addrCfg.requireZip   ? '' : 'none';

  // Section 3c: Scheduling Preference Capture
  const pc = config.preferenceCapture || {};
  const pcEnabled = pc.enabled !== false; // default true
  setChecked('preference-capture-enabled', pcEnabled);
  setValue('preference-ask-day',   pc.askDayPrompt       || '');
  setValue('preference-urgent',    pc.urgentPrompt       || '');
  setValue('preference-ask-time',  pc.askTimePrompt      || '');
  setValue('preference-no-slots',  pc.noSlotsOnDayPrompt || '');
  document.getElementById('preference-capture-settings')?.classList.toggle('hidden', !pcEnabled);

  // Section 8: Slot Filling / Digression
  const sf = config.slotFilling || {};
  setSelectValue('slot-max-attempts',    String(sf.defaultMaxAttempts    || 3));
  setSelectValue('slot-fallback-action', sf.defaultFallbackAction        || 'RE_ASK_PLAIN');
  setValue('slot-reanchor-suffix',       sf.reAnchorSuffix               || '');

  // Sections: Team & Calendars, Emergency Schedule, Holiday Schedule
  populateTeamAndSchedule(config);
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

    // Address collection config — multi-step sub-flow
    addressConfig: {
      requireCity:    getChecked('addr-require-city'),
      requireState:   getChecked('addr-require-state'),
      requireZip:     getChecked('addr-require-zip'),
      askCityPrompt:  getValue('addr-ask-city')  || '',
      askStatePrompt: getValue('addr-ask-state') || '',
      askZipPrompt:   getValue('addr-ask-zip')   || ''
    },

    preferenceCapture: {
      enabled:            getChecked('preference-capture-enabled'),
      askDayPrompt:       getValue('preference-ask-day'),
      urgentPrompt:       getValue('preference-urgent'),
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

// =============================================================================
// TEAM & CALENDARS — in-memory state
// =============================================================================
let serviceTypes = [];  // [{id, label, color, isDefault, isEmergency, order}]
let technicians  = [];  // [{id, name, active, calendarId, color, serviceTypeIds, priority}]

const SWATCH_COLORS = [
  '#3B82F6','#10B981','#EF4444','#F59E0B','#8B5CF6',
  '#EC4899','#06B6D4','#84CC16','#F97316','#6B7280'
];

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

// ── SERVICE TYPES ─────────────────────────────────────────────────────────────
function renderServiceTypes() {
  const list  = document.getElementById('service-types-list');
  const empty = document.getElementById('service-types-empty');
  if (!list) return;
  // Clear non-empty-hint children
  [...list.children].forEach(c => { if (c !== empty) c.remove(); });
  if (!serviceTypes.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';

  serviceTypes.forEach((st, idx) => {
    const pill = document.createElement('div');
    pill.className = 'service-type-pill';
    pill.style.cssText = `background:${st.color}22;border-color:${st.color};color:${st.color}`;
    pill.dataset.idx = idx;
    const badges = [
      st.isDefault   ? '<span class="pill-badge badge-default">Default</span>'   : '',
      st.isEmergency ? '<span class="pill-badge badge-emergency">Emergency</span>' : ''
    ].join('');
    pill.innerHTML = `
      <span style="width:10px;height:10px;border-radius:50%;background:${st.color};flex-shrink:0"></span>
      <span>${escHtml(st.label)}</span>
      ${badges}
      <div class="pill-actions">
        <button class="pill-btn" title="Edit" onclick="editServiceType(${idx})">✎</button>
        <button class="pill-btn" title="Delete" onclick="deleteServiceType(${idx})" style="color:#ef4444">✕</button>
      </div>`;
    list.appendChild(pill);
  });

  // Rebuild emergency service type selector
  refreshEmergencyServiceTypeSelect();
}

function refreshEmergencyServiceTypeSelect() {
  const sel = document.getElementById('emergency-service-type-id');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— use default service type —</option>';
  serviceTypes.forEach(st => {
    const opt = document.createElement('option');
    opt.value = st.id;
    opt.textContent = st.label;
    if (st.id === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

function openServiceTypeModal(idx = -1) {
  const st   = idx >= 0 ? serviceTypes[idx] : null;
  const color = st?.color || SWATCH_COLORS[serviceTypes.length % SWATCH_COLORS.length];
  const html = `
    <div class="modal-overlay" id="st-modal">
      <div class="modal-box">
        <div class="modal-title">${st ? 'Edit' : 'Add'} Service Type</div>
        <div class="form-group" style="margin-bottom:14px">
          <label>Label <span style="color:#ef4444">*</span></label>
          <input id="st-label" class="form-control" value="${escHtml(st?.label || '')}" placeholder="e.g. Maintenance">
        </div>
        <div class="form-group" style="margin-bottom:14px">
          <label>Color</label>
          <div class="color-picker-row" id="st-color-row">
            ${SWATCH_COLORS.map(c => `<span class="color-swatch${c===color?' selected':''}" style="background:${c}" data-color="${c}" onclick="selectSwatch('st',this)"></span>`).join('')}
          </div>
          <input type="hidden" id="st-color" value="${color}">
        </div>
        <div style="display:flex;gap:16px;margin-bottom:4px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
            <input type="checkbox" id="st-is-default" ${st?.isDefault?'checked':''}> Set as Default (used when service type is unknown)
          </label>
        </div>
        <div style="display:flex;gap:16px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
            <input type="checkbox" id="st-is-emergency" ${st?.isEmergency?'checked':''}> Mark as Emergency Service Type
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="closeModal('st-modal')">Cancel</button>
          <button class="btn btn-primary" onclick="saveServiceType(${idx})">Save</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('st-label').focus();
}

function saveServiceType(idx) {
  const label = (document.getElementById('st-label')?.value || '').trim();
  if (!label) { alert('Please enter a label.'); return; }
  const entry = {
    id:          idx >= 0 ? serviceTypes[idx].id : slugify(label) || genId(),
    label,
    color:       document.getElementById('st-color')?.value || SWATCH_COLORS[0],
    active:      true,
    isDefault:   document.getElementById('st-is-default')?.checked || false,
    isEmergency: document.getElementById('st-is-emergency')?.checked || false,
    order:       idx >= 0 ? serviceTypes[idx].order : serviceTypes.length
  };
  // Enforce single default / single emergency
  if (entry.isDefault)   serviceTypes.forEach(s => { s.isDefault   = false; });
  if (entry.isEmergency) serviceTypes.forEach(s => { s.isEmergency = false; });
  if (idx >= 0) serviceTypes[idx] = entry;
  else          serviceTypes.push(entry);
  closeModal('st-modal');
  renderServiceTypes();
  renderTechnicians();
  markDirty();
}

function editServiceType(idx)   { openServiceTypeModal(idx); }
function deleteServiceType(idx) {
  if (!confirm(`Delete "${serviceTypes[idx]?.label}"?`)) return;
  const deletedId = serviceTypes[idx].id;
  serviceTypes.splice(idx, 1);
  // Remove from any tech assignments
  technicians.forEach(t => {
    t.serviceTypeIds = (t.serviceTypeIds || []).filter(id => id !== deletedId);
  });
  renderServiceTypes();
  renderTechnicians();
  markDirty();
}

// ── TECHNICIANS ───────────────────────────────────────────────────────────────
function renderTechnicians() {
  const list  = document.getElementById('technicians-list');
  const empty = document.getElementById('technicians-empty');
  if (!list) return;
  [...list.children].forEach(c => { if (c !== empty) c.remove(); });
  if (!technicians.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';

  technicians.forEach((t, idx) => {
    const initials = (t.name || '?').split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
    const typeTags = (t.serviceTypeIds || []).map(id => {
      const st = serviceTypes.find(s => s.id === id);
      return st ? `<span class="tech-type-tag" style="background:${st.color}22;color:${st.color}">${escHtml(st.label)}</span>` : '';
    }).join('');
    const card = document.createElement('div');
    card.className = `tech-card${t.active === false ? ' tech-inactive' : ''}`;
    card.innerHTML = `
      <div class="tech-dot" style="background:${t.color || '#3B82F6'}">${initials}</div>
      <div class="tech-info">
        <div class="tech-name">${escHtml(t.name)}</div>
        <div class="tech-cal">${escHtml(t.calendarId || 'No calendar set')}</div>
        <div class="tech-types">${typeTags || '<span class="tech-type-tag">No service types</span>'}</div>
      </div>
      <div class="tech-actions">
        <button class="btn btn-sm btn-secondary" onclick="editTechnician(${idx})">Edit</button>
        <label class="toggle-switch" title="${t.active!==false?'Active':'Inactive'}">
          <input type="checkbox" ${t.active!==false?'checked':''} onchange="toggleTechActive(${idx},this.checked)">
          <span class="slider"></span>
        </label>
      </div>`;
    list.appendChild(card);
  });
}

function openTechnicianModal(idx = -1) {
  const t = idx >= 0 ? technicians[idx] : null;
  const color = t?.color || SWATCH_COLORS[technicians.length % SWATCH_COLORS.length];
  const stCheckboxes = serviceTypes.map(st => `
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;margin-bottom:6px">
      <input type="checkbox" name="tech-st" value="${escHtml(st.id)}"
        ${(t?.serviceTypeIds||[]).includes(st.id)?'checked':''}>
      <span style="width:10px;height:10px;border-radius:50%;background:${st.color};display:inline-block"></span>
      ${escHtml(st.label)}
    </label>`).join('') || '<div class="empty-hint">Add service types first.</div>';

  const html = `
    <div class="modal-overlay" id="tech-modal">
      <div class="modal-box">
        <div class="modal-title">${t ? 'Edit' : 'Add'} Technician</div>
        <div class="form-row" style="margin-bottom:14px">
          <div class="form-group">
            <label>Name <span style="color:#ef4444">*</span></label>
            <input id="tech-name" class="form-control" value="${escHtml(t?.name||'')}" placeholder="John Smith">
          </div>
          <div class="form-group">
            <label>Color</label>
            <div class="color-picker-row" id="tech-color-row">
              ${SWATCH_COLORS.map(c => `<span class="color-swatch${c===color?' selected':''}" style="background:${c}" data-color="${c}" onclick="selectSwatch('tech',this)"></span>`).join('')}
            </div>
            <input type="hidden" id="tech-color" value="${color}">
          </div>
        </div>
        <div class="form-group" style="margin-bottom:14px">
          <label>Google Calendar ID (email) <span style="color:#ef4444">*</span></label>
          <input id="tech-cal" class="form-control" value="${escHtml(t?.calendarId||'')}" placeholder="john@yourcompany.com">
          <div class="field-hint">The Google account email that owns the technician's calendar.</div>
        </div>
        <div class="form-group" style="margin-bottom:4px">
          <label>Service Types Handled</label>
          <div style="margin-top:8px">${stCheckboxes}</div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="closeModal('tech-modal')">Cancel</button>
          ${idx>=0?`<button class="btn" style="color:#ef4444;border:1.5px solid #fca5a5;margin-right:auto" onclick="deleteTechnician(${idx})">Delete</button>`:''}
          <button class="btn btn-primary" onclick="saveTechnician(${idx})">Save</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('tech-name').focus();
}

function saveTechnician(idx) {
  const name      = (document.getElementById('tech-name')?.value  || '').trim();
  const calendarId = (document.getElementById('tech-cal')?.value  || '').trim();
  if (!name)       { alert('Please enter a name.'); return; }
  if (!calendarId) { alert('Please enter a Google Calendar ID.'); return; }
  const serviceTypeIds = [...document.querySelectorAll('input[name="tech-st"]:checked')].map(el => el.value);
  const entry = {
    id:             idx >= 0 ? technicians[idx].id : genId(),
    name,
    calendarId,
    color:          document.getElementById('tech-color')?.value || SWATCH_COLORS[0],
    active:         idx >= 0 ? (technicians[idx].active !== false) : true,
    serviceTypeIds,
    priority:       idx >= 0 ? technicians[idx].priority : technicians.length
  };
  if (idx >= 0) technicians[idx] = entry;
  else          technicians.push(entry);
  closeModal('tech-modal');
  renderTechnicians();
  markDirty();
}

function editTechnician(idx)          { openTechnicianModal(idx); }
function deleteTechnician(idx) {
  if (!confirm(`Remove "${technicians[idx]?.name}"?`)) return;
  technicians.splice(idx, 1);
  closeModal('tech-modal');
  renderTechnicians();
  markDirty();
}
function toggleTechActive(idx, active) {
  technicians[idx].active = active;
  renderTechnicians();
  markDirty();
}

// ── SHARED MODAL HELPERS ──────────────────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id)?.remove();
}
function selectSwatch(prefix, el) {
  document.querySelectorAll(`#${prefix}-color-row .color-swatch`).forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById(`${prefix}-color`).value = el.dataset.color;
}

// ── EMERGENCY SCHEDULE ────────────────────────────────────────────────────────
function setupEmergencyListeners() {
  // Master toggle
  setupToggle('emergency-enabled', 'emergency-settings');

  // Mode radio → show/hide custom fields
  document.querySelectorAll('input[name="emergency-mode"]').forEach(r => {
    r.addEventListener('change', () => {
      const custom = document.getElementById('emergency-custom-settings');
      if (custom) custom.style.display = r.value === 'custom' ? '' : 'none';
      markDirty();
    });
  });
}

function populateEmergency(es) {
  setChecked('emergency-enabled', es.enabled !== false);
  document.getElementById('emergency-settings')?.classList.toggle('hidden', !es.enabled);
  setRadio('emergency-mode', es.mode || 'custom');

  const custom = document.getElementById('emergency-custom-settings');
  if (custom) custom.style.display = (es.mode === 'custom' || !es.mode) ? '' : 'none';

  // Days of week
  const daySet = new Set((es.daysOfWeek || [1,2,3,4,5,6]).map(Number));
  document.querySelectorAll('#emergency-days input[type=checkbox]').forEach(cb => {
    cb.checked = daySet.has(parseInt(cb.value));
  });

  // Window
  const wsEl = document.getElementById('emergency-window-start');
  const weEl = document.getElementById('emergency-window-end');
  if (wsEl) wsEl.value = es.windowStart || '07:00';
  if (weEl) weEl.value = es.windowEnd   || '22:00';

  // Buffer
  const bufEl = document.getElementById('emergency-buffer');
  if (bufEl) bufEl.value = es.bufferMinutes ?? 60;

  // Holiday override
  setChecked('emergency-override-holidays', !es.respectHolidays);

  // Service type selector
  const stSel = document.getElementById('emergency-service-type-id');
  if (stSel) stSel.value = es.serviceTypeId || '';
}

function collectEmergency() {
  const mode     = getRadio('emergency-mode') || 'custom';
  const daysOfWeek = [...document.querySelectorAll('#emergency-days input:checked')].map(c => parseInt(c.value));
  return {
    enabled:         getChecked('emergency-enabled'),
    serviceTypeId:   getSelectValue('emergency-service-type-id') || '',
    mode,
    windowStart:     document.getElementById('emergency-window-start')?.value || '07:00',
    windowEnd:       document.getElementById('emergency-window-end')?.value   || '22:00',
    bufferMinutes:   parseInt(document.getElementById('emergency-buffer')?.value || '60', 10),
    daysOfWeek,
    respectHolidays: !getChecked('emergency-override-holidays')
  };
}

// ── HOLIDAY SCHEDULE ──────────────────────────────────────────────────────────
function renderHolidayTable(holidays) {
  const tbody = document.getElementById('holidays-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  // Show / hide emergency column based on toggle
  const emergencyEnabled = getChecked('emergency-enabled');
  const eHeader = document.getElementById('holiday-emergency-header');
  if (eHeader) eHeader.style.opacity = emergencyEnabled ? '1' : '.35';

  const groups = [
    { key: 'federal',    label: 'Federal Holidays' },
    { key: 'religious',  label: 'Religious / Cultural' },
    { key: 'observance', label: 'Common Observances' }
  ];

  groups.forEach(g => {
    const groupItems = holidays.filter(h => h.group === g.key);
    if (!groupItems.length) return;

    const hdrRow = document.createElement('tr');
    hdrRow.className = 'holiday-group-header';
    hdrRow.innerHTML = `<td colspan="4">${g.label}</td>`;
    tbody.appendChild(hdrRow);

    groupItems.forEach(h => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td style="padding:12px 20px;font-weight:500;color:var(--color-gray-800)">${escHtml(h.name)}</td>
        <td style="padding:12px 16px;text-align:center;color:var(--color-gray-500);font-size:13px">${escHtml(h.dateDisplay)}</td>
        <td class="holiday-toggle-cell" style="padding:8px 16px">
          <label class="h-toggle">
            <input type="checkbox" data-holiday="${escHtml(h.key)}" data-field="closeRegular" ${h.closeRegular?'checked':''} onchange="markDirty()">
            <span class="h-toggle-dot"></span>
            <span class="h-toggle-lbl">${h.closeRegular?'Closed':'Open'}</span>
          </label>
        </td>
        <td class="holiday-toggle-cell" style="padding:8px 16px;opacity:${emergencyEnabled?1:.3}">
          <label class="h-toggle" style="${!emergencyEnabled?'pointer-events:none':''}">
            <input type="checkbox" data-holiday="${escHtml(h.key)}" data-field="closeEmergency" ${h.closeEmergency?'checked':''} onchange="markDirty()">
            <span class="h-toggle-dot"></span>
            <span class="h-toggle-lbl">${h.closeEmergency?'Closed':'Open'}</span>
          </label>
        </td>`;
      tbody.appendChild(row);
    });
  });

  // Live label update on toggle
  tbody.querySelectorAll('.h-toggle input').forEach(cb => {
    cb.addEventListener('change', () => {
      const lbl = cb.closest('.h-toggle')?.querySelector('.h-toggle-lbl');
      if (lbl) lbl.textContent = cb.checked ? 'Closed' : 'Open';
    });
  });
}

function collectHolidays() {
  const rows = document.querySelectorAll('#holidays-body input[data-holiday]');
  const map  = {};
  rows.forEach(cb => {
    const key   = cb.dataset.holiday;
    const field = cb.dataset.field;
    if (!map[key]) map[key] = { key, closeRegular: false, closeEmergency: false };
    map[key][field] = cb.checked;
  });
  return Object.values(map);
}

function populateTeamAndSchedule(config) {
  // Service types
  serviceTypes = (config.serviceTypes || []).sort((a,b) => (a.order||0)-(b.order||0));
  renderServiceTypes();

  // Technicians
  technicians = config.technicians || [];
  renderTechnicians();

  // Emergency schedule
  populateEmergency(config.emergencySchedule || {});

  // Holidays — cache meta for re-renders
  const holidays = config.holidays || [];
  window._holidayCatalogGroups = {};
  window._holidayDates         = {};
  window._holidayNames         = {};
  holidays.forEach(h => {
    window._holidayCatalogGroups[h.key] = h.group;
    window._holidayDates[h.key]         = h.dateDisplay;
    window._holidayNames[h.key]         = h.name;
  });
  renderHolidayTable(holidays);
}

// ── SAVE ──────────────────────────────────────────────────────────────────────
async function saveAll() {
  const payload = collectForm();

  // Append team + schedule data
  payload.serviceTypes      = serviceTypes;
  payload.technicians       = technicians;
  payload.emergencySchedule = collectEmergency();
  payload.holidays          = collectHolidays();

  showSaveStatus('saving', 'Saving...');
  document.getElementById('btn-save-all').disabled = true;

  try {
    const result = await AgentConsoleAuth.apiFetch(
      `/api/admin/agent2/company/${companyId}/booking-config`,
      { method: 'POST', body: payload }
    );
    if (!result.success) throw new Error(result.error || 'Save failed');
    showSaveStatus('saved', 'Saved');
    showToast('success', 'Saved', 'Booking configuration saved successfully.');
    isDirty = false;
    setTimeout(() => showSaveStatus('', ''), 3000);
  } catch (err) {
    showSaveStatus('error', 'Error');
    showToast('error', 'Save failed', err.message || 'Please try again.');
  } finally {
    document.getElementById('btn-save-all').disabled = false;
  }
}

// Expose for inline onclick usage
window.editServiceType   = editServiceType;
window.deleteServiceType = deleteServiceType;
window.editTechnician    = editTechnician;
window.deleteTechnician  = deleteTechnician;
window.toggleTechActive  = toggleTechActive;
window.selectSwatch      = selectSwatch;
window.closeModal        = closeModal;
window.saveServiceType   = saveServiceType;
window.saveTechnician    = saveTechnician;
