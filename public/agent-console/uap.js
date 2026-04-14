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
  let bookingFieldConfig = {};
  let uapbActiveService  = 'service_call';

  // ── Init ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    _initHeader();
    _initTabs();
    _initUAPBServiceTabs();
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

      // Initialize prompt audio controls for UAPB textareas
      if (typeof PromptAudioControls !== 'undefined') {
        PromptAudioControls.init({
          companyId,
          apiFetch: (url, opts) => _api(opts?.method || 'GET', url, opts?.body),
        });
        PromptAudioControls.injectAll();
        PromptAudioControls.loadState(data.promptAudio || {});
      }
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
        uapbTemplates: { gracefulPivot, resumePrompt },
        promptAudio: typeof PromptAudioControls !== 'undefined'
          ? PromptAudioControls.collectAll()
          : {}
      });
      _toast('success', 'UAPB settings saved');
    } catch (err) {
      _toast('error', `Save failed: ${err.message}`);
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
    saveUAPBSettings,
  };

  // ════════════════════════════════════════════════════════════════════════════
  // ⏱ TIMINGS TAB — Speech Detection Settings
  // ════════════════════════════════════════════════════════════════════════════
  // Loads: GET /api/agent-console/:companyId/agent2/config  → pipeline.speechDetection
  // Saves: PATCH /api/agent-console/:companyId/agent2/config { speechDetection: {...} }
  // ════════════════════════════════════════════════════════════════════════════

  async function _loadTimings() {
    if (!companyId) return;
    try {
      const res = await fetch(`/api/agent-console/${companyId}/agent2/config`, {
        headers: { 'Authorization': `Bearer ${_getToken()}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const sd   = data?.pipeline?.speechDetection || {};

      const speechTimeout = sd.speechTimeout ?? 3;
      const initialTimeout = sd.initialTimeout ?? 7;
      const bargeIn        = sd.bargeIn ?? false;
      const speechModel    = sd.speechModel || 'phone_call';

      const stEl  = document.getElementById('tdSpeechTimeout');
      const stVal = document.getElementById('tdSpeechTimeoutVal');
      const itEl  = document.getElementById('tdInitialTimeout');
      const itVal = document.getElementById('tdInitialTimeoutVal');
      const biEl  = document.getElementById('tdBargeIn');
      const biLbl = document.getElementById('tdBargeInLabel');
      const smEl  = document.getElementById('tdSpeechModel');

      if (stEl)  { stEl.value  = speechTimeout;  }
      if (stVal) { stVal.textContent = speechTimeout + 's'; }
      if (itEl)  { itEl.value  = initialTimeout;  }
      if (itVal) { itVal.textContent = initialTimeout + 's'; }
      if (biEl)  { biEl.checked = bargeIn; }
      if (biLbl) { biLbl.textContent = bargeIn ? 'On' : 'Off'; }
      if (smEl)  { smEl.value = speechModel; }

    } catch (err) {
      console.warn('[Timings] load failed', err);
    }
  }

  async function timingsSave() {
    if (!companyId) return;
    const stEl = document.getElementById('tdSpeechTimeout');
    const itEl = document.getElementById('tdInitialTimeout');
    const biEl = document.getElementById('tdBargeIn');
    const smEl = document.getElementById('tdSpeechModel');
    const biLbl = document.getElementById('tdBargeInLabel');

    const speechDetection = {
      speechTimeout:  parseFloat(stEl?.value ?? 3),
      initialTimeout: parseInt(itEl?.value ?? 7, 10),
      bargeIn:        biEl?.checked ?? false,
      speechModel:    smEl?.value || 'phone_call',
    };

    // Update barge-in label immediately
    if (biLbl) biLbl.textContent = speechDetection.bargeIn ? 'On' : 'Off';

    try {
      const res = await fetch(`/api/agent-console/${companyId}/agent2/config`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_getToken()}` },
        body:    JSON.stringify({ speechDetection }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      _toast('success', 'Timings saved');
    } catch (err) {
      console.error('[Timings] save failed', err);
      _toast('error', 'Failed to save timings');
    }
  }

  // Load timings when tab becomes active (lazy load)
  const _timingsOrigInitTabs = typeof window._timingsTabHooked !== 'undefined';
  if (!_timingsOrigInitTabs) {
    window._timingsTabHooked = true;
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn[data-tab="timings"]');
      if (btn) _loadTimings();
    });
  }

  // Expose for inline onclick
  window.timingsSave = timingsSave;

  // ══════════════════════════════════════════════════════════════════════════
  // CALIBRATION TAB — Layer 1/2/Unknown hit rate dashboard
  // ══════════════════════════════════════════════════════════════════════════

  async function _loadCalibration() {
    if (!companyId) return;
    const l1El      = document.getElementById('calLayer1Pct');
    const l2El      = document.getElementById('calLayer2Pct');
    const unkEl     = document.getElementById('calUnknownPct');
    const fuzzyEl   = document.getElementById('calFuzzyPct');
    const bodyEl    = document.getElementById('calBody');
    if (!bodyEl) return;

    // Show loading state
    if (l1El)    l1El.textContent    = '…';
    if (l2El)    l2El.textContent    = '…';
    if (unkEl)   unkEl.textContent   = '…';
    if (fuzzyEl) fuzzyEl.textContent = '…';
    bodyEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:.813rem;">Loading calibration data…</div>';

    try {
      const res = await fetch(`/api/admin/calibration/company/${companyId}/stats`, {
        headers: { 'Authorization': `Bearer ${_getToken()}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Unknown error');

      const s = data.stats;

      // ── Populate stat cards ────────────────────────────────────────────
      if (l1El)    l1El.textContent    = s.totalEntries > 0 ? `${s.layer1.pct}%`  : '—';
      if (l2El)    l2El.textContent    = s.totalEntries > 0 ? `${s.layer2.pct}%`  : '—';
      if (unkEl)   unkEl.textContent   = s.totalEntries > 0 ? `${s.unknown.pct}%` : '—';
      if (fuzzyEl) fuzzyEl.textContent = s.totalEntries > 0 ? `${s.fuzzyRecovery?.pct || 0}%` : '—';

      // ── No data yet ────────────────────────────────────────────────────
      if (s.totalEntries === 0) {
        bodyEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📊</div>
            <div class="empty-title">Collecting first call data...</div>
            <div class="empty-sub">
              Calibration data populates automatically as calls come in via qaLog[] entries.
              Target: 500 calls for meaningful baseline accuracy.
              No action required — this updates automatically.
            </div>
          </div>`;
        return;
      }

      // ── Progress bar + recent calls ────────────────────────────────────
      const progress    = Math.min(100, Math.round((s.totalEntries / s.targetCalls) * 100));
      const isBaseline  = s.totalEntries >= s.targetCalls;
      const statusBadge = isBaseline
        ? `<div style="display:inline-block;padding:4px 12px;background:#dcfce7;color:#166534;border-radius:6px;font-size:.75rem;font-weight:600;margin-bottom:12px;">✅ Calibration baseline established (${s.totalEntries} turns)</div>`
        : `<div style="margin-bottom:12px;font-size:.8rem;color:#64748b;">${s.totalEntries} / ${s.targetCalls} turns collected</div>`;

      const progressBar = isBaseline ? '' : `
        <div style="width:100%;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;margin-bottom:16px;">
          <div style="width:${progress}%;height:100%;background:linear-gradient(90deg,#10b981,#059669);border-radius:4px;transition:width .3s;"></div>
        </div>`;

      // ── Recent calls table ─────────────────────────────────────────────
      let callRows = '';
      if (s.recentCalls && s.recentCalls.length > 0) {
        callRows = s.recentCalls.map(c => {
          const total = c.layer1 + c.layer2 + c.unknown + (c.fuzzy || 0);
          const d     = c.capturedAt ? new Date(c.capturedAt) : null;
          const when  = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
          return `<tr>
            <td style="padding:6px 10px;font-size:.75rem;color:#334155;">${_esc(c.callSid?.slice(-8) || '—')}</td>
            <td style="padding:6px 10px;font-size:.75rem;color:#64748b;">${_esc(when)}</td>
            <td style="padding:6px 10px;font-size:.75rem;text-align:center;">${c.turnCount || '—'}</td>
            <td style="padding:6px 10px;font-size:.75rem;text-align:center;color:#059669;font-weight:600;">${c.layer1}</td>
            <td style="padding:6px 10px;font-size:.75rem;text-align:center;color:#d97706;font-weight:600;">${c.layer2}</td>
            <td style="padding:6px 10px;font-size:.75rem;text-align:center;color:#dc2626;font-weight:600;">${c.unknown}</td>
            <td style="padding:6px 10px;font-size:.75rem;text-align:center;color:#8b5cf6;font-weight:600;">${c.fuzzy || 0}</td>
            <td style="padding:6px 10px;font-size:.75rem;text-align:center;">${total}</td>
          </tr>`;
        }).join('');
      }

      const table = callRows ? `
        <table style="width:100%;border-collapse:collapse;margin-top:8px;">
          <thead>
            <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">
              <th style="padding:6px 10px;font-size:.7rem;color:#94a3b8;text-align:left;font-weight:500;">Call</th>
              <th style="padding:6px 10px;font-size:.7rem;color:#94a3b8;text-align:left;font-weight:500;">When</th>
              <th style="padding:6px 10px;font-size:.7rem;color:#94a3b8;text-align:center;font-weight:500;">Turns</th>
              <th style="padding:6px 10px;font-size:.7rem;color:#059669;text-align:center;font-weight:500;">L1</th>
              <th style="padding:6px 10px;font-size:.7rem;color:#d97706;text-align:center;font-weight:500;">L2</th>
              <th style="padding:6px 10px;font-size:.7rem;color:#dc2626;text-align:center;font-weight:500;">Unk</th>
              <th style="padding:6px 10px;font-size:.7rem;color:#8b5cf6;text-align:center;font-weight:500;">Fuzzy</th>
              <th style="padding:6px 10px;font-size:.7rem;color:#94a3b8;text-align:center;font-weight:500;">Total</th>
            </tr>
          </thead>
          <tbody>${callRows}</tbody>
        </table>` : '';

      // ── Assemble summary block ─────────────────────────────────────────
      const summaryLine = `
        <div style="display:flex;gap:16px;margin-bottom:12px;font-size:.8rem;flex-wrap:wrap;">
          <span style="color:#059669;font-weight:600;">Layer 1: ${s.layer1.count}</span>
          <span style="color:#d97706;font-weight:600;">LLM Agent: ${s.layer2.count}</span>
          <span style="color:#dc2626;font-weight:600;">Unknown: ${s.unknown.count}</span>
          <span style="color:#8b5cf6;font-weight:600;">Fuzzy: ${s.fuzzyRecovery?.count || 0}</span>
        </div>`;

      // ── Match type distribution ───────────────────────────────────────
      const _mtColors = { EXACT: '#059669', PARTIAL: '#0d9488', WORD_OVERLAP: '#d97706', SYNONYM: '#8b5cf6', FUZZY_PHONETIC: '#a855f7' };
      let matchTypeHTML = '';
      if (s.matchTypeBreakdown && s.matchTypeBreakdown.length > 0) {
        const sorted = [...s.matchTypeBreakdown].sort((a, b) => b.count - a.count);
        const mtTotal = sorted.reduce((sum, r) => sum + r.count, 0);
        const mtRows = sorted.map(mt => {
          const pctVal = mtTotal > 0 ? Math.round((mt.count / mtTotal) * 100) : 0;
          const color  = _mtColors[mt.matchType] || '#64748b';
          return `<tr>
            <td style="padding:6px 10px;font-size:.75rem;font-weight:600;color:${color};">${_esc(mt.matchType)}</td>
            <td style="padding:6px 10px;font-size:.75rem;text-align:center;font-weight:600;">${mt.count}</td>
            <td style="padding:6px 10px;font-size:.75rem;text-align:center;color:#64748b;">${pctVal}%</td>
            <td style="padding:6px 10px;">
              <div style="width:100%;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;">
                <div style="width:${pctVal}%;height:100%;background:${color};border-radius:3px;"></div>
              </div>
            </td>
          </tr>`;
        }).join('');

        matchTypeHTML = `
          <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;">
            <div style="font-size:.75rem;color:#64748b;margin-bottom:8px;font-weight:500;">Match Type Distribution</div>
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">
                  <th style="padding:6px 10px;font-size:.7rem;color:#94a3b8;text-align:left;font-weight:500;">Type</th>
                  <th style="padding:6px 10px;font-size:.7rem;color:#94a3b8;text-align:center;font-weight:500;">Count</th>
                  <th style="padding:6px 10px;font-size:.7rem;color:#94a3b8;text-align:center;font-weight:500;">%</th>
                  <th style="padding:6px 10px;font-size:.7rem;color:#94a3b8;text-align:left;font-weight:500;"></th>
                </tr>
              </thead>
              <tbody>${mtRows}</tbody>
            </table>
          </div>`;
      }

      bodyEl.innerHTML = `
        ${statusBadge}
        ${progressBar}
        ${summaryLine}
        <div style="font-size:.75rem;color:#64748b;margin-bottom:8px;font-weight:500;">Recent Calls (${s.recentCalls.length})</div>
        ${table}
        ${matchTypeHTML}
      `;

    } catch (err) {
      console.warn('[Calibration] load failed', err);
      if (bodyEl) {
        bodyEl.innerHTML = `<div style="padding:16px;color:#dc2626;font-size:.8rem;">Failed to load calibration data: ${_esc(err.message)}</div>`;
      }
    }
  }

  // Load calibration when tab becomes active (lazy load)
  if (!window._calibrationTabHooked) {
    window._calibrationTabHooked = true;
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn[data-tab="calibration"]');
      if (btn) _loadCalibration();
    });
  }

})();
