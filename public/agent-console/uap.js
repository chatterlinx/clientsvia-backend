/**
 * uap.js — UAP Intelligence Console Controller
 * ClientsVia Agent Console · Version 1.0
 *
 * IIFE — no global pollution. Exposes minimal surface via window.UAPPage.
 * Vanilla JS only, no framework.
 *
 * API BASE: /api/admin/agent2/company/:companyId/uap
 */
(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────
  const params    = new URLSearchParams(window.location.search);
  const companyId = params.get('companyId') || '';
  const apiBase   = `/api/admin/agent2/company/${companyId}/uap`;
  const dnApi     = `/api/admin/agent2/company/${companyId}/discovery`;

  // ── State ────────────────────────────────────────────────────────────────
  let arrays             = [];
  let bookingFieldConfig = {};
  let uapbActiveService  = 'service_call';

  // ── Init ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    _initHeader();
    _initTabs();
    _initUAPBServiceTabs();
    loadArrays();
    loadPending();
    _loadBookingFields();
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

    const dnLink = document.getElementById('linkDNBookingFields');
    if (dnLink && companyId) {
      dnLink.href = `/agent-console/discoverynotes.html?companyId=${companyId}`;
    }
  }

  function _initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const panel = document.getElementById(`tab-${btn.dataset.tab}`);
        if (panel) panel.classList.add('active');
      });
    });
  }

  function _initUAPBServiceTabs() {
    document.querySelectorAll('#uapbServiceTabs .service-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#uapbServiceTabs .service-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        uapbActiveService = btn.dataset.service;
        _renderUAPBFields();
      });
    });
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
    const res  = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // ── Arrays tab ────────────────────────────────────────────────────────────
  async function loadArrays() {
    if (!companyId) return;
    const container = document.getElementById('arraysContainer');
    if (!container) return;
    try {
      const data = await _api('GET', `${apiBase}/arrays`);
      arrays = data.arrays || [];
      _renderArrays();
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-title" style="color:var(--color-danger);">Error: ${_esc(err.message)}</div></div>`;
    }
  }

  function _renderArrays() {
    const container = document.getElementById('arraysContainer');
    if (!container) return;

    const countBadge = document.getElementById('arrayCountBadge');
    if (countBadge) {
      countBadge.textContent = `${arrays.length} arrays`;
      countBadge.style.display = arrays.length ? '' : 'none';
    }

    const seedBtn = document.getElementById('btnSeedArrays');

    if (arrays.length === 0) {
      if (seedBtn) seedBtn.classList.remove('seeded');
      container.innerHTML = `
        <div class="seed-prompt">
          <div class="seed-prompt-icon">🧩</div>
          <div class="seed-prompt-title">No arrays yet</div>
          <div class="seed-prompt-sub">
            Seed the 10 standard daType arrays to get started.
            Standard arrays cover Pricing, Availability, Services, Complaints, Emergencies, and more.
            You can add trigger phrases and customize everything after seeding.
          </div>
          <button class="btn-seed" onclick="window.UAPPage.seedArrays()">
            🌱 Seed Standard Arrays
          </button>
        </div>`;
      return;
    }

    if (seedBtn) seedBtn.classList.add('seeded');

    const cards = arrays.map(arr => _arrayCardHTML(arr)).join('');
    container.innerHTML = `<div class="uap-array-grid">${cards}</div>`;
  }

  function _arrayCardHTML(arr) {
    const stdBadge   = arr.isStandard
      ? `<span class="badge badge-standard">Standard</span>`
      : `<span class="badge badge-custom">Custom</span>`;
    const activeBadge = arr.isActive
      ? `<span class="badge badge-active">Active</span>`
      : `<span class="badge badge-inactive">Inactive</span>`;

    const subTypes = (arr.daSubTypes || []).map(st => _subTypeHTML(arr._id, st)).join('');

    return `
      <div class="uap-array-card ${arr.isActive ? '' : 'inactive'}" id="array-${arr._id}">
        <div class="uap-array-header">
          <div class="uap-array-title">${_esc(arr.label)}</div>
          ${stdBadge}
          ${activeBadge}
          <button class="btn btn-ghost" style="padding:3px 8px;font-size:.688rem;"
            onclick="window.UAPPage.toggleArrayActive('${arr._id}', ${!arr.isActive})">
            ${arr.isActive ? 'Disable' : 'Enable'}
          </button>
        </div>
        <div class="uap-array-body">
          <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:10px;font-family:var(--font-mono);">${_esc(arr.daType)}</div>
          ${subTypes}
        </div>
      </div>`;
  }

  function _subTypeHTML(arrayId, st) {
    const phrases = (st.triggerPhrases || []).map(p => `
      <span class="phrase-pill">
        ${_esc(p)}
        <button class="remove-phrase" onclick="window.UAPPage.removePhrase('${arrayId}','${_esc(st.key)}','${_esc(p)}')" title="Remove phrase">×</button>
      </span>`).join('');

    // KC link indicator — teal badge links to the KC card; amber badge = orphan
    // Use kcId (stable human-readable key) in the URL when available; fall back to MongoDB _id
    let kcIndicator;
    if (st.kcLink) {
      const linkId   = st.kcLink.kcId || st.kcLink.containerId;
      const url      = `/agent-console/services-item.html?companyId=${encodeURIComponent(companyId)}&itemId=${encodeURIComponent(linkId)}`;
      const linkText = st.kcLink.sectionLabel
        ? `${_esc(st.kcLink.containerTitle)} › ${_esc(st.kcLink.sectionLabel)}`
        : _esc(st.kcLink.containerTitle);
      kcIndicator = `<a class="kc-link-badge" href="${url}" title="Open KC card: ${_esc(st.kcLink.containerTitle)}">🔗 ${linkText}</a>`;
    } else {
      kcIndicator = `<span class="kc-orphan-badge" title="No KC section is linked to this sub-type">⚠ No KC section</span>`;
    }

    return `
      <div class="uap-subtype">
        <div class="uap-subtype-label">
          ${_esc(st.label)}
          ${st.classificationStatus === 'PENDING' ? '<span class="badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;">PENDING</span>' : ''}
        </div>
        ${kcIndicator}
        <div class="phrase-list">${phrases || '<span style="font-size:.688rem;color:var(--text-muted);">No trigger phrases yet</span>'}</div>
        <div class="add-phrase-form">
          <input type="text" class="add-phrase-input" placeholder="+ add phrase"
            id="phrase-input-${arrayId}-${st.key}"
            onkeydown="if(event.key==='Enter')window.UAPPage.addPhrase('${arrayId}','${_esc(st.key)}',this)" />
          <button class="add-phrase-btn"
            onclick="window.UAPPage.addPhrase('${arrayId}','${_esc(st.key)}',document.getElementById('phrase-input-${arrayId}-${st.key}'))">
            Add
          </button>
        </div>
      </div>`;
  }

  async function seedArrays() {
    if (!companyId) return;
    try {
      const data = await _api('POST', `${apiBase}/arrays/seed`);
      _toast('success', `Seeded ${data.seeded} arrays${data.skipped ? `, ${data.skipped} already existed` : ''}`);
      await loadArrays();
    } catch (err) {
      _toast('error', `Seed failed: ${err.message}`);
    }
  }

  async function toggleArrayActive(arrayId, isActive) {
    try {
      await _api('PATCH', `${apiBase}/arrays/${arrayId}`, { isActive });
      _toast('success', `Array ${isActive ? 'enabled' : 'disabled'}`);
      await loadArrays();
    } catch (err) {
      _toast('error', `Update failed: ${err.message}`);
    }
  }

  async function addPhrase(arrayId, subTypeKey, inputEl) {
    const phrase = inputEl.value.trim();
    if (!phrase) return;
    try {
      await _api('PATCH', `${apiBase}/arrays/${arrayId}`, { subTypeKey, addPhrase: phrase });
      inputEl.value = '';
      _toast('success', 'Phrase added');
      await loadArrays();
    } catch (err) {
      _toast('error', `Failed: ${err.message}`);
    }
  }

  async function removePhrase(arrayId, subTypeKey, phrase) {
    try {
      await _api('PATCH', `${apiBase}/arrays/${arrayId}`, { subTypeKey, removePhrase: phrase });
      _toast('success', 'Phrase removed');
      await loadArrays();
    } catch (err) {
      _toast('error', `Failed: ${err.message}`);
    }
  }

  // ── UAPB tab ──────────────────────────────────────────────────────────────
  async function _loadBookingFields() {
    if (!companyId) return;
    try {
      // Load booking fields + UAPB templates from the same discovery settings endpoint
      const data = await _api('GET', `${dnApi}/settings`);
      bookingFieldConfig = data.bookingFieldConfig || {};
      _renderUAPBFields();
      // Populate UAPB template fields
      const tpl = data.uapbTemplates || {};
      const gpEl = document.getElementById('gracefulPivotTpl');
      const rpEl = document.getElementById('resumePromptTpl');
      if (gpEl) gpEl.value = tpl.gracefulPivot || '';
      if (rpEl) rpEl.value = tpl.resumePrompt  || '';
    } catch (err) {
      _toast('error', `Failed to load booking fields: ${err.message}`);
    }
  }

  function _renderUAPBFields() {
    const container = document.getElementById('uapbFieldList');
    if (!container) return;
    const fields = bookingFieldConfig[uapbActiveService] || [];
    if (fields.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:24px;">
          <div class="empty-title">No fields for this service type</div>
          <div class="empty-sub">Configure in Discovery Notes → Booking Fields</div>
        </div>`;
      return;
    }
    const rows = fields.map(f => `
      <div class="field-row ${f.isStandard ? 'is-standard' : ''}">
        <span style="font-size:1rem;">${f.isStandard ? '🔒' : '✏️'}</span>
        <div class="field-info">
          <div class="field-label-txt">${_esc(f.label)}</div>
          <div class="field-key-txt">${_esc(f.key)}</div>
        </div>
        <span class="badge ${f.isStandard ? 'badge-standard' : ''}" style="${!f.isStandard ? 'background:#fff0f0;color:#b91c1c;border:1px solid #fecaca;' : ''}">
          ${f.isStandard ? 'System Required' : 'Custom'}
        </span>
        <span style="font-size:.75rem;color:var(--text-muted);">${f.required ? 'Required' : 'Optional'}</span>
      </div>`).join('');
    container.innerHTML = rows;
  }

  async function saveUAPBSettings() {
    if (!companyId) return _toast('error', 'No company selected');
    const gracefulPivot = document.getElementById('gracefulPivotTpl')?.value.trim() || null;
    const resumePrompt  = document.getElementById('resumePromptTpl')?.value.trim()  || null;
    try {
      // UAPB template settings stored in Company discoverySettings — extend same endpoint
      await _api('PATCH', `${dnApi}/settings`, {
        bookingFieldConfig,
        uapbTemplates: { gracefulPivot, resumePrompt }
      });
      _toast('success', 'UAPB settings saved');
    } catch (err) {
      _toast('error', `Save failed: ${err.message}`);
    }
  }

  // ── Pending tab ───────────────────────────────────────────────────────────
  async function loadPending() {
    if (!companyId) return;
    const container = document.getElementById('pendingContainer');
    if (!container) return;
    try {
      const data = await _api('GET', `${apiBase}/pending`);
      const pending = data.pending || [];

      // Update badge
      const badge     = document.getElementById('pendingBadge');
      const countBadge = document.getElementById('pendingCountBadge');
      if (badge) {
        badge.textContent  = pending.length;
        badge.style.display = pending.length ? '' : 'none';
      }
      if (countBadge) {
        countBadge.textContent  = `${pending.length} pending`;
        countBadge.style.display = pending.length ? '' : 'none';
      }

      if (pending.length === 0) {
        container.innerHTML = `
          <div class="empty-state" style="padding:40px;">
            <div class="empty-icon">✅</div>
            <div class="empty-title">All classifications confirmed</div>
            <div class="empty-sub">No pending items. New sub-types will appear here for review.</div>
          </div>`;
        return;
      }

      const rows = pending.map(p => `
        <tr>
          <td>
            <div style="font-weight:600;">${_esc(p.subTypeLabel)}</div>
            <div style="font-size:.75rem;color:var(--text-muted);">${_esc(p.subTypeKey)}</div>
          </td>
          <td>${_esc(p.daTypeLabel)}</td>
          <td>
            ${p.classificationScore != null
              ? `<div class="score-bar"><div class="score-fill" style="width:${Math.round((p.classificationScore || 0)*100)}%"></div></div>
                 <span style="font-size:.688rem;color:var(--text-muted);">${Math.round((p.classificationScore || 0)*100)}%</span>`
              : '<span style="font-size:.75rem;color:var(--text-muted);">—</span>'}
          </td>
          <td>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="btn btn-ghost" style="font-size:.688rem;padding:3px 8px;color:var(--color-success-dk);border-color:var(--color-success);"
                onclick="window.UAPPage.overridePending('${p.arrayId}','${p.subTypeKey}','AUTO_CONFIRMED')">
                ✓ Approve
              </button>
              <button class="btn btn-ghost" style="font-size:.688rem;padding:3px 8px;color:var(--color-primary);border-color:var(--color-primary);"
                onclick="window.UAPPage.overridePending('${p.arrayId}','${p.subTypeKey}','MANUAL')">
                ✎ Mark Manual
              </button>
            </div>
          </td>
        </tr>`).join('');

      container.innerHTML = `
        <table class="pending-table">
          <thead>
            <tr>
              <th>Sub-Type</th>
              <th>Array</th>
              <th>Confidence</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-title" style="color:var(--color-danger);">Error: ${_esc(err.message)}</div></div>`;
    }
  }

  async function overridePending(arrayId, subTypeKey, status) {
    try {
      await _api('PATCH', `${apiBase}/pending/${arrayId}/${subTypeKey}`, { status });
      _toast('success', `${subTypeKey} → ${status}`);
      await loadPending();
    } catch (err) {
      _toast('error', `Update failed: ${err.message}`);
    }
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
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Public surface ────────────────────────────────────────────────────────
  window.UAPPage = {
    loadArrays,
    seedArrays,
    toggleArrayActive,
    addPhrase,
    removePhrase,
    saveUAPBSettings,
    loadPending,
    overridePending
  };

})();
