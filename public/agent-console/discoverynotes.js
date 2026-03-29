/**
 * discoverynotes.js — Discovery Notes Console Controller
 * ClientsVia Agent Console · Version 1.0
 *
 * IIFE — no global pollution. Exposes minimal surface via window.DNPage.
 * Vanilla JS only, no framework.
 *
 * API BASE: /api/admin/agent2/company/:companyId/discovery
 */
(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────
  const params    = new URLSearchParams(window.location.search);
  const companyId = params.get('companyId') || '';
  const baseUrl   = '';  // same origin
  const apiBase   = `${baseUrl}/api/admin/agent2/company/${companyId}/discovery`;

  // Standard booking fields seeded into the DB when owner clicks "Seed Standard Fields".
  // After seeding these live in MongoDB. This list is only used for the seed operation.
  const STANDARD_FIELDS = {
    service_call: [
      { key: 'firstName',    label: 'First Name',    required: true,  isStandard: true  },
      { key: 'lastName',     label: 'Last Name',     required: true,  isStandard: true  },
      { key: 'address',      label: 'Service Address', required: true,  isStandard: true  },
      { key: 'phone',        label: 'Callback Phone', required: false, isStandard: true  },
      { key: 'issue',        label: 'Issue Description', required: true, isStandard: true },
      { key: 'serviceType',  label: 'Service Type',  required: true,  isStandard: true  }
    ],
    maintenance: [
      { key: 'firstName',    label: 'First Name',    required: true,  isStandard: true  },
      { key: 'lastName',     label: 'Last Name',     required: true,  isStandard: true  },
      { key: 'address',      label: 'Service Address', required: true,  isStandard: true  },
      { key: 'phone',        label: 'Callback Phone', required: false, isStandard: true  },
      { key: 'preferredDate', label: 'Preferred Date', required: false, isStandard: true }
    ],
    installation: [
      { key: 'firstName',    label: 'First Name',    required: true,  isStandard: true  },
      { key: 'lastName',     label: 'Last Name',     required: true,  isStandard: true  },
      { key: 'address',      label: 'Service Address', required: true,  isStandard: true  },
      { key: 'phone',        label: 'Callback Phone', required: true,  isStandard: true  },
      { key: 'preferredDate', label: 'Preferred Date', required: false, isStandard: true },
      { key: 'preferredTime', label: 'Preferred Time', required: false, isStandard: true }
    ],
    custom: []
  };

  // ── State ────────────────────────────────────────────────────────────────
  let bookingFieldConfig = {};
  let activeServiceType  = 'service_call';

  // ── Init ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    _initHeader();
    _initTabs();
    _initServiceTabs();
    loadSettings();
    loadSnapshots();
    _bindSeedBtn();
  });

  function _initHeader() {
    const nameEl = document.getElementById('companyName');
    if (nameEl) nameEl.textContent = companyId ? `Company ${companyId.slice(-6)}` : 'No company';

    const backBtn = document.getElementById('btnBack');
    if (backBtn) {
      backBtn.href = companyId
        ? `/agent-console/index.html?companyId=${companyId}`
        : '/agent-console/index.html';
    }
  }

  function _initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const tabId = `tab-${btn.dataset.tab}`;
        const panel = document.getElementById(tabId);
        if (panel) panel.classList.add('active');
      });
    });
  }

  function _initServiceTabs() {
    document.querySelectorAll('.service-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.service-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeServiceType = btn.dataset.service;
        _renderFieldList();
      });
    });
  }

  function _bindSeedBtn() {
    const btn = document.getElementById('btnSeedFields');
    if (btn) btn.addEventListener('click', seedStandardFields);
  }

  // ── Auth + API helpers ────────────────────────────────────────────────────
  function _getToken() {
    return localStorage.getItem('adminToken')
        || localStorage.getItem('token')
        || sessionStorage.getItem('token')
        || '';
  }

  async function _api(method, path, body) {
    const opts = {
      method,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${_getToken()}`
      },
      credentials: 'same-origin'
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  async function loadSettings() {
    if (!companyId) return;
    try {
      const data = await _api('GET', `${apiBase}/settings`);
      bookingFieldConfig = data.bookingFieldConfig || {};
      _renderFieldList();
      // Load discriminator if one is saved
      if (data.discriminatorQuestion) {
        _loadDiscriminatorUI(data.discriminatorQuestion);
      }
    } catch (err) {
      _toast('error', `Failed to load settings: ${err.message}`);
    }
  }

  async function saveFields() {
    if (!companyId) return _toast('error', 'No company selected');
    try {
      await _api('PATCH', `${apiBase}/settings`, { bookingFieldConfig });
      _toast('success', 'Booking fields saved');
    } catch (err) {
      _toast('error', `Save failed: ${err.message}`);
    }
  }

  async function seedStandardFields() {
    if (!confirm('Seed standard booking fields for all service types? Existing custom fields will be preserved.')) return;
    const merged = { ...bookingFieldConfig };
    for (const [svc, fields] of Object.entries(STANDARD_FIELDS)) {
      if (!merged[svc]) merged[svc] = [];
      // Upsert standard fields — don't duplicate
      for (const f of fields) {
        if (!merged[svc].find(x => x.key === f.key)) {
          merged[svc].push(f);
        }
      }
    }
    bookingFieldConfig = merged;
    _renderFieldList();
    await saveFields();
    _toast('success', 'Standard fields seeded');
  }

  // ── Field rendering ──────────────────────────────────────────────────────
  function _renderFieldList() {
    const container = document.getElementById('fieldListContainer');
    if (!container) return;
    const fields = bookingFieldConfig[activeServiceType] || [];
    if (fields.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:24px;">
          <div class="empty-icon">📋</div>
          <div class="empty-title">No fields configured</div>
          <div class="empty-sub">Click "Seed Standard Fields" to add defaults, or "+ Add Custom Field" to start from scratch.</div>
        </div>`;
      return;
    }
    const rows = fields.map((f, idx) => _fieldRowHTML(f, idx)).join('');
    container.innerHTML = `<div class="field-list">${rows}</div>`;
  }

  function _fieldRowHTML(field, idx) {
    const stdIcon = field.isStandard ? '🔒' : '✏️';
    const stdBadge = field.isStandard
      ? `<span class="badge badge-standard">System Required</span>`
      : `<span class="badge" style="background:#fff0f0;color:#b91c1c;border:1px solid #fecaca;">Custom</span>`;
    const reqToggle = field.isStandard
      ? `<span style="font-size:.75rem;color:var(--text-muted);">${field.required ? 'Required' : 'Optional'}</span>`
      : `
        <div class="toggle-wrap">
          <label class="toggle">
            <input type="checkbox" ${field.required ? 'checked' : ''} onchange="window.DNPage.toggleRequired('${activeServiceType}',${idx},this.checked)" />
            <span class="toggle-slider"></span>
          </label>
          <span class="toggle-label">${field.required ? 'Required' : 'Optional'}</span>
        </div>`;
    const deleteBtn = field.isStandard
      ? ''
      : `<button class="btn-icon danger" title="Remove field" onclick="window.DNPage.removeField('${activeServiceType}',${idx})">🗑</button>`;

    return `
      <div class="field-row ${field.isStandard ? 'is-standard' : ''}">
        <span class="field-icon">${stdIcon}</span>
        <div class="field-info">
          <div class="field-label">${_esc(field.label)}</div>
          <div class="field-key">${_esc(field.key)}</div>
        </div>
        ${stdBadge}
        ${reqToggle}
        ${deleteBtn}
      </div>`;
  }

  // ── Field mutations ──────────────────────────────────────────────────────
  function openAddField() {
    document.getElementById('addFieldForm').classList.add('open');
    document.getElementById('btnAddField').style.display = 'none';
    document.getElementById('newFieldLabel').focus();
  }

  function closeAddField() {
    document.getElementById('addFieldForm').classList.remove('open');
    document.getElementById('btnAddField').style.display = '';
    document.getElementById('newFieldLabel').value = '';
    document.getElementById('newFieldKey').value = '';
    document.getElementById('newFieldRequired').checked = false;
  }

  function saveNewField() {
    const label    = document.getElementById('newFieldLabel').value.trim();
    const key      = document.getElementById('newFieldKey').value.trim() || _labelToKey(label);
    const required = document.getElementById('newFieldRequired').checked;

    if (!label) return _toast('error', 'Field label is required');
    if (!key)   return _toast('error', 'Field key is required');

    if (!bookingFieldConfig[activeServiceType]) bookingFieldConfig[activeServiceType] = [];
    if (bookingFieldConfig[activeServiceType].find(f => f.key === key)) {
      return _toast('error', `Field key "${key}" already exists`);
    }

    bookingFieldConfig[activeServiceType].push({ key, label, required, isStandard: false });
    _renderFieldList();
    closeAddField();
  }

  function toggleRequired(serviceType, idx, required) {
    if (bookingFieldConfig[serviceType]?.[idx]) {
      bookingFieldConfig[serviceType][idx].required = required;
    }
  }

  function removeField(serviceType, idx) {
    if (!bookingFieldConfig[serviceType]) return;
    bookingFieldConfig[serviceType].splice(idx, 1);
    _renderFieldList();
  }

  // ── Snapshots ────────────────────────────────────────────────────────────
  async function loadSnapshots() {
    if (!companyId) return;
    const container = document.getElementById('snapshotList');
    if (!container) return;
    try {
      const data = await _api('GET', `${apiBase}/snapshots`);
      if (!data.snapshots || data.snapshots.length === 0) {
        container.innerHTML = `
          <div class="empty-state" style="padding:40px;">
            <div class="empty-icon">📡</div>
            <div class="empty-title">No call data yet</div>
            <div class="empty-sub">Snapshots start populating as calls come in.</div>
          </div>`;
        return;
      }
      const rows = data.snapshots.map(s => _snapshotRowHTML(s)).join('');
      container.innerHTML = `<div class="monitor-grid" style="padding:16px;">${rows}</div>`;
    } catch (err) {
      container.innerHTML = `<div class="empty-state" style="padding:32px;"><div class="empty-title" style="color:var(--color-danger);">Error loading snapshots: ${_esc(err.message)}</div></div>`;
    }
  }

  function _snapshotRowHTML(s) {
    const dt         = s.capturedAt ? new Date(s.capturedAt).toLocaleString() : '—';
    const name       = s.callerName || s.callerPhone || 'Unknown caller';
    const obj        = s.objective || 'INTAKE';
    const tempCount  = Object.keys(s.temp || {}).filter(k => k !== 'confidence' && (s.temp || {})[k]).length;
    const confCount  = Object.keys(s.confirmed || {}).length;
    const ccUrl      = s.callSid
      ? `/agent-console/callconsole.html?companyId=${companyId}&callSid=${s.callSid}`
      : '#';
    return `
      <a class="snapshot-row" href="${ccUrl}">
        <span class="snapshot-dt">${_esc(dt)}</span>
        <span class="snapshot-caller">${_esc(name)}</span>
        <span class="badge snapshot-obj obj-${obj}">${obj}</span>
        <span class="snapshot-fields">${tempCount} temp field${tempCount !== 1 ? 's' : ''}</span>
        <span class="snapshot-confirmed">${confCount} confirmed</span>
      </a>`;
  }

  // ── Collapsible ──────────────────────────────────────────────────────────
  function toggleCollapsible(trigger) {
    trigger.classList.toggle('open');
    const body = trigger.closest('.card-header').nextElementSibling;
    if (body) body.classList.toggle('open');
  }

  // ── Toast ────────────────────────────────────────────────────────────────
  function _toast(type, message) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  // ── Utils ─────────────────────────────────────────────────────────────────
  function _esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _labelToKey(label) {
    return label
      .trim()
      .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
      .replace(/\s/g, '')
      .replace(/[^a-zA-Z0-9_]/g, '');
  }

  // ── Discriminator Question ────────────────────────────────────────────────
  // State for the in-memory discriminator being edited
  let discriminatorConfig = null; // { text, field, silentAboutPlan, options: [] }

  function toggleDiscriminator(enabled) {
    const body = document.getElementById('discriminatorBody');
    if (body) body.style.display = enabled ? '' : 'none';
    if (enabled && discriminatorConfig === null) {
      // First open — init with empty config
      discriminatorConfig = { text: '', field: 'planStatus', silentAboutPlan: true, options: [] };
      _renderDiscriminatorOptions();
    }
  }

  function _renderDiscriminatorOptions() {
    const list = document.getElementById('dqOptionsList');
    if (!list) return;
    const opts = discriminatorConfig?.options || [];
    if (opts.length === 0) {
      list.innerHTML = `<p style="font-size:.75rem;color:#94a3b8;margin:0;">No options yet — add at least 2.</p>`;
      return;
    }
    list.innerHTML = opts.map((opt, i) => `
      <div class="dq-option-row" data-idx="${i}" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:10px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
        <div>
          <label class="form-label" style="font-size:.7rem;">Label (shown in logs)</label>
          <input class="form-input" style="font-size:.8rem;" value="${_esc(opt.label || '')}" oninput="window.DNPage.updateDqOption(${i},'label',this.value)" placeholder="Plan Member" />
        </div>
        <div>
          <label class="form-label" style="font-size:.7rem;">Value (stored in temp)</label>
          <input class="form-input" style="font-size:.8rem;" value="${_esc(opt.value || '')}" oninput="window.DNPage.updateDqOption(${i},'value',this.value)" placeholder="member" />
        </div>
        <div>
          <label class="form-label" style="font-size:.7rem;">serviceType override</label>
          <input class="form-input" style="font-size:.8rem;" value="${_esc(opt.serviceTypeOverride || '')}" oninput="window.DNPage.updateDqOption(${i},'serviceTypeOverride',this.value)" placeholder="maintenance_plan_visit" />
        </div>
        <button onclick="window.DNPage.removeDqOption(${i})" title="Remove option" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:1rem;padding:4px;align-self:center;">✕</button>
        <div style="grid-column:1/-1;">
          <label class="form-label" style="font-size:.7rem;">Match keywords (comma separated — what the caller might say)</label>
          <input class="form-input" style="font-size:.8rem;" value="${_esc((opt.keywords || []).join(', '))}" oninput="window.DNPage.updateDqOption(${i},'keywords',this.value)" placeholder="plan, member, yes, I am, annual" />
        </div>
      </div>`).join('');
  }

  function _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function addDiscriminatorOption() {
    if (!discriminatorConfig) discriminatorConfig = { text: '', field: 'planStatus', silentAboutPlan: true, options: [] };
    discriminatorConfig.options.push({ label: '', value: '', serviceTypeOverride: '', keywords: [] });
    _renderDiscriminatorOptions();
  }

  function updateDqOption(idx, key, value) {
    if (!discriminatorConfig?.options[idx]) return;
    if (key === 'keywords') {
      discriminatorConfig.options[idx].keywords = value.split(',').map(s => s.trim()).filter(Boolean);
    } else {
      discriminatorConfig.options[idx][key] = value;
    }
  }

  function removeDqOption(idx) {
    if (!discriminatorConfig) return;
    discriminatorConfig.options.splice(idx, 1);
    _renderDiscriminatorOptions();
  }

  async function saveDiscriminator() {
    if (!companyId) return _toast('error', 'No company selected');
    // Read current UI values
    const text   = document.getElementById('dqText')?.value?.trim();
    const field  = document.getElementById('dqField')?.value?.trim() || 'planStatus';
    const silent = document.getElementById('dqSilent')?.checked || false;
    if (!text) return _toast('error', 'Question text is required');
    if (!discriminatorConfig?.options?.length || discriminatorConfig.options.length < 2) {
      return _toast('error', 'Add at least 2 answer options');
    }
    // Validate options
    for (const opt of discriminatorConfig.options) {
      if (!opt.label || !opt.value) return _toast('error', 'Each option needs a label and a value');
    }
    const dq = { text, field, silentAboutPlan: silent, options: discriminatorConfig.options };
    try {
      await _api('PATCH', `${apiBase}/settings`, { discriminatorQuestion: dq });
      discriminatorConfig = dq;
      _toast('success', 'Pre-collection question saved');
    } catch (err) {
      _toast('error', `Save failed: ${err.message}`);
    }
  }

  function _loadDiscriminatorUI(dq) {
    if (!dq) return;
    discriminatorConfig = dq;
    const enabledEl = document.getElementById('discriminatorEnabled');
    if (enabledEl) {
      enabledEl.checked = true;
      toggleDiscriminator(true);
    }
    const textEl   = document.getElementById('dqText');
    const fieldEl  = document.getElementById('dqField');
    const silentEl = document.getElementById('dqSilent');
    if (textEl)   textEl.value   = dq.text   || '';
    if (fieldEl)  fieldEl.value  = dq.field  || 'planStatus';
    if (silentEl) silentEl.checked = dq.silentAboutPlan !== false;
    _renderDiscriminatorOptions();
  }

  // ── Public surface ────────────────────────────────────────────────────────
  window.DNPage = {
    loadSettings,
    saveFields,
    loadSnapshots,
    seedStandardFields,
    toggleCollapsible,
    openAddField,
    closeAddField,
    saveNewField,
    toggleRequired,
    removeField,
    // Discriminator
    toggleDiscriminator,
    addDiscriminatorOption,
    updateDqOption,
    removeDqOption,
    saveDiscriminator,
  };

})();
