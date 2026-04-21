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
  // CALIBRATION TAB — UAP Pipeline Health dashboard
  // ──────────────────────────────────────────────────────────────────────────
  // Reads from /api/admin/agent2/company/:companyId/knowledge/gaps (the same
  // API the Gaps & Todo page uses). Surfaces UAP-specific metrics:
  //   - UAP Hit Rate           (GATE 2.5 wins / all KC pipeline outcomes)
  //   - UAP Hits                (phrase-index fast path)
  //   - UAP Miss → Key Save     (rescued by GATE 3 keyword — "add a phrase" signal)
  //   - Section Gaps            (container matched, no section covered)
  //   - UAP Miss → Groq         (full miss, most expensive outcome)
  //   - Graceful Ack            (all paths exhausted)
  //   - Winning Gate breakdown bar
  //   - Top 10 UAP Hits (working) + Top 10 UAP Misses (add phrases)
  // ══════════════════════════════════════════════════════════════════════════

  async function _loadCalibration() {
    if (!companyId) return;
    const statsEl = document.getElementById('calStats');
    const bodyEl  = document.getElementById('calBody');
    const rangeEl = document.getElementById('calRange');
    const chipEl  = document.getElementById('calRangeChip');
    if (!statsEl || !bodyEl) return;

    const range = rangeEl ? rangeEl.value : '7d';
    if (chipEl) chipEl.textContent = `Last ${range === '24h' ? '24 hours' : range === '30d' ? '30 days' : '7 days'}`;

    // Loading state
    bodyEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:.813rem;">Loading UAP health data…</div>';

    try {
      const res = await fetch(`/api/admin/agent2/company/${companyId}/knowledge/gaps?range=${encodeURIComponent(range)}`, {
        headers: { 'Authorization': `Bearer ${_getToken()}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Unknown error');

      const s   = data.summary || {};
      const bt  = s.byType     || {};
      const uapHits     = s.uapHitsN   || 0;
      const uapKeyResc  = s.uapKeyResc || 0;
      const llmFb       = s.llmFbN     || 0;
      const sectionGap  = bt.KC_SECTION_GAP  || 0;
      const gracefulAck = bt.KC_GRACEFUL_ACK || 0;
      const totalKC     = uapHits + uapKeyResc + llmFb + sectionGap + gracefulAck;
      const hitRate     = s.uapHitRate; // null if no data

      // ── Render 6-card stat row ─────────────────────────────────────────
      let hrClass = 'hr-neutral', hrText = '—';
      if (hitRate != null) {
        const pct = Math.round(hitRate * 100);
        hrText = `${pct}%`;
        if      (pct >= 70) hrClass = 'hr-green';
        else if (pct >= 40) hrClass = 'hr-amber';
        else                hrClass = 'hr-red';
      }

      statsEl.innerHTML = `
        <div class="cal-stat ${hrClass}" title="UAP phrase-index hits / (hits + keyword rescues + full misses)">
          <div class="cal-stat-value">${hrText}</div>
          <div class="cal-stat-label">UAP Hit Rate</div>
          <div class="cal-stat-sub">${s.uapConsidered || 0} turns considered</div>
        </div>
        <div class="cal-stat uap-hit" title="GATE 2.5 phrase-index hits (fast path winners)">
          <div class="cal-stat-value">${uapHits}</div>
          <div class="cal-stat-label">UAP Hits</div>
        </div>
        <div class="cal-stat uap-miss-key" title="UAP missed, GATE 3 keyword rescued — each row is a phrase to add to UAP">
          <div class="cal-stat-value">${uapKeyResc}</div>
          <div class="cal-stat-label">UAP Miss → Key Save</div>
        </div>
        <div class="cal-stat gap" title="Container matched but no section covered the utterance">
          <div class="cal-stat-value">${sectionGap}</div>
          <div class="cal-stat-label">Section Gaps</div>
        </div>
        <div class="cal-stat fb" title="Full UAP miss — Groq had to answer from KB context">
          <div class="cal-stat-value">${llmFb}</div>
          <div class="cal-stat-label">UAP Miss → Groq</div>
        </div>
        <div class="cal-stat ack" title="All paths exhausted — canned safety response">
          <div class="cal-stat-value">${gracefulAck}</div>
          <div class="cal-stat-label">Graceful Ack</div>
        </div>`;

      // ── No data yet ────────────────────────────────────────────────────
      if (totalKC === 0) {
        bodyEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📊</div>
            <div class="empty-title">No KC pipeline data in the selected range.</div>
            <div class="empty-sub">
              UAP events populate automatically as calls come in via qaLog[] entries.
              Try widening the range or running a live call.
            </div>
          </div>`;
        return;
      }

      // ── Winning Gate breakdown bars ────────────────────────────────────
      const pct = n => totalKC > 0 ? Math.round((n / totalKC) * 100) : 0;
      const breakdownRow = (label, n, barClass) => `
        <div class="gate-breakdown-row">
          <div class="gate-label">${_esc(label)}</div>
          <div class="gate-bar-wrap"><div class="gate-bar ${barClass}" style="width:${pct(n)}%"></div></div>
          <div class="gate-num">${n} · ${pct(n)}%</div>
        </div>`;

      // ── Top 10 tables ─────────────────────────────────────────────────
      const topHits   = Array.isArray(s.topUapHits)   ? s.topUapHits   : [];
      const topMisses = Array.isArray(s.topUapMisses) ? s.topUapMisses : [];
      const topListHtml = (title, rows) => {
        const body = rows.length
          ? rows.map(r => `<tr>
              <td>${_esc(r.title || 'Unknown')}</td>
              <td>${r.count || 0}</td>
            </tr>`).join('')
          : '<tr><td class="empty" colspan="2">No data yet</td></tr>';
        return `<div class="top-list">
          <h4>${_esc(title)}</h4>
          <table><tbody>${body}</tbody></table>
        </div>`;
      };

      bodyEl.innerHTML = `
        <div class="uap-breakdown">
          ${breakdownRow('UAP Hit (GATE 2.5)',      uapHits,      'green')}
          ${breakdownRow('Keyword Save (GATE 3)',   uapKeyResc,   'amber')}
          ${breakdownRow('Section Gap',             sectionGap,   'orange')}
          ${breakdownRow('UAP Miss → Groq',         llmFb,        'red')}
          ${breakdownRow('Graceful Ack',            gracefulAck,  'gray')}
        </div>
        <div class="top-list-grid">
          ${topListHtml('Top UAP Hits (working)',        topHits)}
          ${topListHtml('Top UAP Misses (add phrases)',  topMisses)}
        </div>`;

    } catch (err) {
      console.warn('[UAP Calibration] load failed', err);
      statsEl.innerHTML = '';
      bodyEl.innerHTML = `<div style="padding:16px;color:#dc2626;font-size:.8rem;">Failed to load UAP health data: ${_esc(err.message)}</div>`;
    }
  }

  // Load calibration when tab becomes active (lazy load) + wire range/refresh
  if (!window._calibrationTabHooked) {
    window._calibrationTabHooked = true;
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn[data-tab="calibration"]');
      if (btn) _loadCalibration();
      const refresh = e.target.closest('#calRefresh');
      if (refresh) _loadCalibration();
    });
    document.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'calRange') _loadCalibration();
    });
  }

})();
