/**
 * Call Intelligence — Enterprise Frontend
 * Clean build. Production ready.
 *
 * Architecture: Single-page app with 3 views (dashboard → loading → report).
 * No framework dependencies. Pure ES6+ vanilla JS.
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE        = 20;
const AUTO_REFRESH_MS  = 30_000;   // poll dashboard every 30 s
let   _autoRefreshTimer = null;    // setInterval handle

const SECTION_ICONS = {
  pass: '✓', fail: '✗', warn: '!', info: 'i',
  bypassed: '↷', unknown: '?', not_triggered: '○'
};

const OUTCOME_CLASS = {
  completed: 'ob-completed',
  abandoned: 'ob-abandoned',
  transferred: 'ob-transferred',
  error: 'ob-error',
  in_progress: 'ob-in_progress',
  callback_requested: 'ob-callback_requested'
};

// ─── Utility functions ────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function fmt(date) {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}

function fmtTime(date) {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
}

function fmtDur(secs) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function healthClass(score) {
  if (score == null) return 'unknown';
  if (score >= 75) return 'ok';
  if (score >= 50) return 'warn';
  return 'fail';
}

function latencyClass(ms) {
  if (!ms) return 'unknown';
  if (ms < 500) return 'ok';
  if (ms < 1500) return 'warn';
  return 'fail';
}

function getCompanyId() {
  return new URLSearchParams(window.location.search).get('companyId') || '';
}

// ─── App state ────────────────────────────────────────────────────────────────

const state = {
  view: 'dashboard',        // 'dashboard' | 'loading' | 'report'
  companyId: getCompanyId(),
  page: 1,
  totalPages: 1,
  totalCalls: 0,
  filterStatus: '',
  filterTime: 'today',
  searchQuery: '',
  currentCallSid: null,
  reportData: null,
  analyzingCallSid: null
};

// ─── Auto-refresh ─────────────────────────────────────────────────────────────

function startAutoRefresh() {
  stopAutoRefresh();   // clear any existing timer first
  _autoRefreshTimer = setInterval(() => {
    if (state.view === 'dashboard') {
      _silentRefreshDashboard();
    }
  }, AUTO_REFRESH_MS);
}

function stopAutoRefresh() {
  if (_autoRefreshTimer) {
    clearInterval(_autoRefreshTimer);
    _autoRefreshTimer = null;
  }
}

// Silent refresh — updates data without showing the loading spinner or
// resetting the view. Only fires while on the dashboard.
async function _silentRefreshDashboard() {
  if (state.view !== 'dashboard') return;
  try {
    const params = new URLSearchParams({
      companyId: state.companyId,
      page: state.page,
      limit: PAGE_SIZE,
      timeRange: state.filterTime
    });
    if (state.filterStatus) params.set('status', state.filterStatus);
    if (state.searchQuery)  params.set('search', state.searchQuery);

    const [statsData, listData] = await Promise.all([
      apiFetch(`/api/call-intelligence/company/${state.companyId}/stats?timeRange=${state.filterTime}`).catch(() => null),
      apiFetch(`/api/call-intelligence/company/${state.companyId}/list?${params}`).catch(() => null)
    ]);

    if (statsData) renderStats(statsData);
    if (listData)  renderCallsList(listData);
    _stampLastUpdated();
  } catch (_e) { /* silent — don't interrupt the user */ }
}

function _stampLastUpdated() {
  const el = $('last-updated');
  if (el) {
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.textContent = `Updated ${t}`;
  }
}

function _setRefreshSpinning(on) {
  const btn = $('btn-refresh');
  if (!btn) return;
  if (on) btn.classList.add('spinning');
  else    btn.classList.remove('spinning');
}

// ─── View switching ───────────────────────────────────────────────────────────

function showView(name) {
  state.view = name;
  ['dashboard', 'loading', 'report'].forEach(v => {
    const el = $(`view-${v}`);
    if (el) el.className = 'view' + (v === name ? ' active' : '');
  });

  const isDash = name === 'dashboard';
  const isRep  = name === 'report';

  $('header-dashboard').style.display     = isDash ? '' : 'none';
  $('header-report').style.display        = isRep  ? 'flex' : 'none';
  $('header-dashboard-actions').style.display = isDash ? 'flex' : 'none';
  $('header-report-actions').style.display    = isRep  ? 'flex' : 'none';
  $('cost-ribbon').style.display          = isRep  ? 'flex' : 'none';
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

async function loadDashboard() {
  showView('dashboard');
  startAutoRefresh();    // restart 30-s poll whenever dashboard loads

  _setRefreshSpinning(true);
  const params = new URLSearchParams({
    companyId: state.companyId,
    page: state.page,
    limit: PAGE_SIZE,
    timeRange: state.filterTime
  });
  if (state.filterStatus) params.set('status', state.filterStatus);
  if (state.searchQuery)  params.set('search', state.searchQuery);

  try {
    // Load stats and list in parallel
    const [statsData, listData] = await Promise.all([
      apiFetch(`/api/call-intelligence/company/${state.companyId}/stats?timeRange=${state.filterTime}`).catch(() => null),
      apiFetch(`/api/call-intelligence/company/${state.companyId}/list?${params}`).catch(() => ({ items: [], total: 0, pages: 1 }))
    ]);

    renderStats(statsData);
    renderCallsList(listData);
    _stampLastUpdated();
  } catch (err) {
    console.error('[dashboard]', err);
    renderCallsError(err.message);
  } finally {
    _setRefreshSpinning(false);
  }
}

function renderStats(data) {
  if (!data) return;
  $('sv-today').textContent    = data.todayCount  ?? '—';
  $('sv-week').textContent     = data.weekCount   ?? '—';
  $('sv-critical').textContent = data.critical    ?? '—';
  $('sv-needs').textContent    = data.needsImprovement ?? '—';
  $('sv-good').textContent     = data.performingWell   ?? '—';
  $('sv-total').textContent    = data.total        ?? '—';
  if (data.avgCost != null) {
    $('sv-avgcost').textContent = `$${Number(data.avgCost).toFixed(4)}`;
  }
}

// Normalize API list item to flat fields the row renderer needs.
// API wraps metadata in callMetadata + recording — flatten here.
function normalizeListItem(c) {
  const meta = c.callMetadata || {};
  const rec  = c.recording   || {};
  return {
    callSid:         c.callSid || '',
    startedAt:       meta.startTime   || c.startedAt  || c.analyzedAt || null,
    phone:           meta.fromPhone   || c.phone      || '',
    durationSeconds: meta.duration    ?? c.durationSeconds ?? null,
    turnCount:       meta.turns       ?? c.turnCount  ?? null,
    routingTier:     meta.routingTier || c.routingTier || null,
    outcome:         c.outcome        || c.status     || 'unknown',
    llmCost:         c.llmCost        ?? null,
    hasRecording:    rec.hasRecording ?? c.hasRecording ?? false,
    recordingUrl:    rec.url          || c.recordingUrl || null,
  };
}

function renderCallsList({ items = [], total = 0, pages = 1 }) {
  state.totalCalls = total;
  state.totalPages = pages;

  $('call-count').textContent = `${total} call${total !== 1 ? 's' : ''}`;

  const tbody = $('calls-tbody');

  if (!items.length) {
    tbody.innerHTML = `
      <tr><td colspan="10">
        <div class="empty-state">
          <div class="empty-state-icon">📞</div>
          <h3>No calls found</h3>
          <p>Try changing the time range or filters.</p>
        </div>
      </td></tr>`;
    $('pagination').style.display = 'none';
    return;
  }

  tbody.innerHTML = items.map(raw => {
    const c = normalizeListItem(raw);
    const tier = c.routingTier;
    const tierBadge = tier ? `<span class="badge tier-${tier}">T${tier}</span>` : '—';
    // Map API status values to display-friendly outcome labels
    const outcomeRaw = c.outcome === 'not_analyzed' ? 'not analyzed' : c.outcome;
    const outClass = OUTCOME_CLASS[c.outcome] || 'ob-in_progress';

    return `
      <tr>
        <td class="td-time">${fmtTime(c.startedAt)}</td>
        <td class="td-phone">${esc(c.phone || '—')}</td>
        <td class="td-dur">${fmtDur(c.durationSeconds)}</td>
        <td class="td-turns">${c.turnCount ?? '—'}</td>
        <td>${tierBadge}</td>
        <td><span class="outcome-badge ${outClass}">${esc(outcomeRaw.replace(/_/g, ' '))}</span></td>
        <td class="td-cost">${c.llmCost ? `$${Number(c.llmCost).toFixed(4)}` : '—'}</td>
        <td>${c.hasRecording ? `<a class="recording-link" href="${esc(c.recordingUrl || '#')}" target="_blank">▶ Play</a>` : '—'}</td>
        <td class="td-sid" title="${esc(c.callSid)}">
          ${esc(c.callSid.slice(0, 22))}…
        </td>
        <td class="td-actions">
          <button class="btn btn-kc btn-sm" onclick="openReport('${esc(c.callSid)}')">View Report</button>
        </td>
      </tr>`;
  }).join('');

  // Pagination
  const pg = $('pagination');
  if (pages > 1) {
    pg.style.display = 'flex';
    $('page-info').textContent = `Page ${state.page} of ${pages} · ${total} calls`;
    $('btn-prev').disabled = state.page <= 1;
    $('btn-next').disabled = state.page >= pages;
  } else {
    pg.style.display = 'none';
  }
}

function renderCallsError(msg) {
  $('calls-tbody').innerHTML = `
    <tr><td colspan="10" style="padding:32px; text-align:center; color:var(--c-fail);">
      Failed to load calls: ${esc(msg)}
    </td></tr>`;
}

// ─── REPORT ───────────────────────────────────────────────────────────────────

async function openReport(callSid) {
  if (!callSid) return;
  state.currentCallSid = callSid;
  stopAutoRefresh();     // pause poll while viewing a report
  _setRefreshSpinning(true);
  showView('loading');
  $('loading-text').textContent = 'Assembling call report…';

  try {
    const data = await apiFetch(
      `/api/call-intelligence/${callSid}/full-report?companyId=${state.companyId}`
    );
    state.reportData = data.report;
    renderReport(data.report);
    showView('report');
  } catch (err) {
    console.error('[openReport]', err);
    $('loading-text').textContent = `Error: ${err.message}`;
    showView('report');
    $('report-content').innerHTML = `
      <div style="padding:40px; text-align:center; color:var(--c-fail);">
        <p style="font-size:16px; font-weight:600;">Failed to load report</p>
        <p style="margin-top:8px; color:var(--tx-muted);">${esc(err.message)}</p>
      </div>`;
  } finally {
    _setRefreshSpinning(false);
  }
}

function renderReport(r) {
  const { header, story, vitals, protocolAudit, costBreakdown,
          turns, kcAudit, latencyProfile, entityTimeline,
          issues, recommendations, hasGpt4Analysis, gpt4Meta } = r;

  // ── Sticky header ──────────────────────────────────────────────────────
  $('h-caller-name').textContent = header.callerName || header.phone || 'Unknown Caller';
  $('h-call-sid').textContent = header.callSid;
  $('h-call-meta').textContent =
    `${fmt(header.startedAt)} · ${header.durationFormatted} · ${header.turnCount} turns` +
    (header.isReturning ? ' · Returning' : '');
  const hc = healthClass(header.healthScore);
  $('h-health-pill').innerHTML =
    `<span class="health-pill ${hc}">${header.healthScore ?? '—'}/100</span>`;

  // ── Cost ribbon ────────────────────────────────────────────────────────
  $('cr-total').innerHTML = `<span class="cr-label">Total cost</span><span class="cr-val">${costBreakdown.totalCostFormatted}</span>`;
  $('cr-model').innerHTML = `<span class="cr-label">Model</span><span class="cr-val">${esc(costBreakdown.model || '—')}</span>`;
  $('cr-per-turn').innerHTML = `<span class="cr-label">Per-turn avg</span><span class="cr-val">${costBreakdown.perTurnAvgFormatted}</span>`;
  if (gpt4Meta?.tokensUsed) {
    $('cr-tokens').innerHTML = `<span class="cr-label">GPT-4 tokens</span><span class="cr-val">${gpt4Meta.tokensUsed.toLocaleString()}</span>`;
  }

  // ── Render all 8 sections ──────────────────────────────────────────────
  $('report-content').innerHTML = [
    renderSectionStory(story, hasGpt4Analysis, header.callSid),
    renderSectionVitals(vitals, header.recordingUrl),
    renderSectionProtocol(protocolAudit),
    renderSectionTurns(turns, header.companyId),
    renderSectionKC(kcAudit, header.companyId),
    renderSectionLatency(latencyProfile),
    renderSectionEntities(entityTimeline),
    renderSectionIssues(issues, recommendations, header.companyId)
  ].join('');

  // Attach turn expand/collapse
  attachTurnToggles();

  // Attach scroll-spy for left nav
  attachScrollSpy();
}

// ─── Section renderers ────────────────────────────────────────────────────────

function sectionWrap(id, num, title, badge, bodyHtml, noPad = false, actionsHtml = '') {
  return `
    <section class="section" id="${id}">
      <div class="card">
        <div class="card-header">
          <span class="card-num">${num}</span>
          <span class="card-title">${title}</span>
          ${badge ? `<span class="card-badge">${badge}</span>` : ''}
          ${actionsHtml ? `<div class="card-header-actions">${actionsHtml}</div>` : ''}
        </div>
        <div class="card-body${noPad ? ' p0' : ''}">${bodyHtml}</div>
      </div>
    </section>`;
}

// ── S1: Story ─────────────────────────────────────────────────────────────────

function renderSectionStory(story, hasGpt4, callSid) {
  const srcBadge = story.source === 'gpt4'
    ? '<span class="badge badge-purple">AI Analysis</span>'
    : '<span class="badge badge-gray">Auto-generated</span>';

  let aiBanner = '';
  if (!hasGpt4) {
    aiBanner = `
      <div class="ai-banner" id="ai-banner">
        <div>
          <p>Deep AI analysis not yet run for this call.</p>
          <small>Runs GPT-4 to produce turn-by-turn verdicts, root cause analysis, and scored recommendations.</small>
        </div>
        <button class="btn btn-ai" id="btn-analyze" onclick="runAiAnalysis('${esc(callSid)}')">
          Analyze with AI →
        </button>
      </div>`;
  }

  return sectionWrap('sec-story', '1', 'The Story', null, `
    <p class="story-text">${esc(story.text)}</p>
    <div class="story-meta">${srcBadge}</div>
    ${aiBanner}
  `);
}

// ── S2: Vitals ────────────────────────────────────────────────────────────────

function renderSectionVitals(vitals, recordingUrl) {
  const items = vitals.metrics.map(m => `
    <div class="vital ${m.status}">
      <div class="vital-lbl">${esc(m.label)}</div>
      <div class="vital-val">${esc(m.value)}</div>
      ${m.sub ? `<div class="vital-sub" title="${esc(m.sub)}">${esc(m.sub)}</div>` : ''}
    </div>`).join('');

  // Inline recording player with 10-second skip buttons
  const playerHtml = recordingUrl ? `
    <div class="rec-player-wrap" id="rec-player-wrap">
      <button class="rec-skip-btn" onclick="recSkip(-10)" title="Back 10 seconds">« 10s</button>
      <audio id="rec-audio" src="${esc(recordingUrl)}" controls preload="none" style="flex:1;height:32px;min-width:0;"></audio>
      <button class="rec-skip-btn" onclick="recSkip(10)" title="Forward 10 seconds">10s »</button>
    </div>` : '';

  return sectionWrap('sec-vitals', '2', 'Call Vitals', `${vitals.metrics.length} metrics`, `
    <div class="vitals-grid">${items}</div>
    ${playerHtml}
  `);
}

function recSkip(seconds) {
  const audio = document.getElementById('rec-audio');
  if (audio) {
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + seconds));
  }
}
window.recSkip = recSkip;

// ── S3: Protocol Audit ────────────────────────────────────────────────────────

function renderSectionProtocol(audit) {
  const groups = { A: 'A — Call Entry', B: 'B — Call Receipt', C: 'C — Turn 1 Intake', D: 'D — Turn 2+ KC Engine' };
  let stagesHtml = '';

  for (const [gKey, gLabel] of Object.entries(groups)) {
    const groupStages = audit.stages.filter(s => s.group === gKey);
    if (!groupStages.length) continue;
    stagesHtml += `<div class="audit-group">
      <div class="audit-grp-title">${gLabel}</div>
      <div class="audit-stages">
        ${groupStages.map(s => `
          <div class="audit-stage ${s.status}">
            <span class="stage-icon">${SECTION_ICONS[s.status] || '?'}</span>
            <span class="stage-name">${esc(s.name)}</span>
            ${s.detail ? `<span class="stage-detail">${esc(s.detail)}</span>` : ''}
          </div>`).join('')}
      </div>
    </div>`;
  }

  const compRows = audit.compliance.map(c => `
    <tr>
      <td><span class="stage-pill ${esc(c.stage)}">${esc(c.stage)}</span></td>
      <td>${esc(c.check)}</td>
      <td class="text-muted text-sm">${esc(c.expected)}</td>
      <td>${c.actual ? esc(c.actual) : '<span class="text-muted">—</span>'}</td>
      <td>
        <span class="${c.compliant ? 'c-pass' : 'c-fail'}">${c.compliant ? '✓ Pass' : '✗ Fail'}</span>
        ${c.gap ? `<div class="gap-text">${esc(c.gap)}</div>` : ''}
      </td>
    </tr>`).join('');

  return sectionWrap('sec-protocol', '3', 'Protocol Audit',
    `${audit.stages.filter(s => s.status === 'pass').length}/${audit.stages.length} stages pass`, `
    ${stagesHtml}
    <div class="divider"></div>
    <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--tx-muted);margin-bottom:8px;">Discovery Compliance</p>
    <table class="compliance-table">
      <thead><tr>
        <th>Stage</th><th>Check</th><th>Expected</th><th>Actual</th><th>Result</th>
      </tr></thead>
      <tbody>${compRows}</tbody>
    </table>
  `);
}

// ── S4: Turn-by-Turn Log ──────────────────────────────────────────────────────

function renderSectionTurns(turns, companyId) {
  const dlActions = `
    <button class="btn-dl btn-dl-json" title="Download turn log as JSON"
      onclick="downloadTurnsJson()">⬇ JSON</button>
    <button class="btn-dl btn-dl-pdf" title="Download turn log as PDF"
      onclick="downloadTurnsPdf()">⬇ PDF</button>`;

  if (!turns?.length) {
    return sectionWrap('sec-turns', '4', 'Turn-by-Turn Log', '0 turns', `
      <div class="empty-state"><p>No transcript turns found for this call.</p></div>`,
      false, dlActions);
  }

  const turnBlocks = turns.map(t => renderTurnBlock(t, companyId)).join('');

  return sectionWrap('sec-turns', '4', 'Turn-by-Turn Log',
    `${turns.length} turns`, `<div class="turns-list">${turnBlocks}</div>`,
    true, dlActions);
}

// ── Turn log downloads ────────────────────────────────────────────────────────

function downloadTurnsJson() {
  const turns = state.reportData?.turns;
  if (!turns?.length) return;
  const sid   = state.currentCallSid || 'unknown';
  const blob  = new Blob([JSON.stringify(turns, null, 2)], { type: 'application/json' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href      = url;
  a.download  = `turn-log-${sid}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadTurnsPdf() {
  const turns = state.reportData?.turns;
  const hdr   = state.reportData?.header;
  if (!turns?.length) return;

  const sid      = hdr?.callSid  || state.currentCallSid || '';
  const phone    = hdr?.phone    || '';
  const duration = hdr?.durationFormatted || '';
  const started  = hdr?.startedAt ? new Date(hdr.startedAt).toLocaleString() : '';

  // Build print-ready HTML — one speaker per row, no external deps
  const rows = turns.map(t => {
    const isCaller = t.speaker === 'caller';
    const label    = isCaller ? 'Caller' : 'Agent';
    const bg       = isCaller ? '#f0f4ff' : '#f6fff0';
    const badge    = t.provenanceLabel && !isCaller
      ? `<span style="font-size:10px;background:#e2e8f0;border-radius:4px;padding:1px 6px;margin-left:8px;color:#475569">${esc(t.provenanceLabel)}</span>`
      : '';
    const flags    = (t.flags || []).map(f =>
      `<span style="font-size:10px;background:#fef3c7;border-radius:4px;padding:1px 6px;margin-left:4px;color:#92400e">⚑ ${esc(f.label)}</span>`
    ).join('');
    return `
      <tr style="background:${bg}">
        <td style="padding:6px 10px;font-size:11px;color:#64748b;white-space:nowrap;vertical-align:top">${esc(t.elapsed || '')}</td>
        <td style="padding:6px 10px;font-size:11px;font-weight:600;white-space:nowrap;vertical-align:top">${label} ${badge}${flags}</td>
        <td style="padding:6px 10px;font-size:12px;line-height:1.5">${esc(t.text || '')}</td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Turn Log — ${esc(sid)}</title>
    <style>
      body { font-family: -apple-system, sans-serif; margin: 0; padding: 24px; color: #1e293b; }
      h1   { font-size: 16px; margin: 0 0 4px; }
      p    { font-size: 12px; color: #64748b; margin: 0 0 16px; }
      table{ border-collapse: collapse; width: 100%; }
      tr   { border-bottom: 1px solid #e2e8f0; }
      @media print { body { padding: 12px; } }
    </style>
  </head><body>
    <h1>Turn-by-Turn Log</h1>
    <p>${esc(phone)} · ${esc(started)} · ${esc(duration)} · ${esc(sid)}</p>
    <table><tbody>${rows}</tbody></table>
    <script>window.onload=()=>{window.print();}<\/script>
  </body></html>`;

  const win = window.open('', '_blank', 'width=860,height=700');
  if (!win) { alert('Please allow pop-ups to download the PDF.'); return; }
  win.document.write(html);
  win.document.close();
}

function renderTurnBlock(t, companyId) {
  const isCaller = t.speaker === 'caller';
  const isAgent  = t.speaker === 'agent';
  const hasFlags  = t.flags?.length > 0;
  const hasCritical = t.flags?.some(f => f.severity === 'critical');
  const latCls   = isAgent ? latencyClass(t.latencyMs) : '';
  const latLabel  = isAgent && t.latencyMs ? `${t.latencyMs}ms` : null;

  const flagsHtml = (t.flags || []).map(f =>
    `<span class="flag-chip ${f.severity}">${esc(f.label)}</span>`).join('');

  // Collapsed summary line: speaker chip + truncated text
  const speakerChip = isCaller
    ? `<span class="spk-chip spk-caller">C</span>`
    : `<span class="spk-chip spk-agent">A</span>`;
  const textPreview = t.text?.substring(0, 110) || '';
  const isLong = (t.text?.length || 0) > 110;
  const speakerPrefix = isCaller ? 'C:' : 'A:';
  const dialLine = `<div class="dial-line ${isCaller ? 'dial-caller' : 'dial-agent'}">
    <span>${speakerPrefix}</span> ${esc(textPreview)}${isLong ? '…' : ''}
  </div>`;

  const provClass = t.provenanceType || 'UNKNOWN';
  const provLabel = t.provenanceLabel || provClass;

  // ── Detail panel ────────────────────────────────────────────────────────
  // 1) Verbatim
  const verbatimHtml = `
    <div class="td-section">
      <div class="td-sec-title">Verbatim</div>
      <div class="${isCaller ? 'vb-caller' : 'vb-agent'}">
        <span class="vb-label">${isCaller ? 'Caller' : 'Agent'}</span>
        <span class="vb-text">${esc(t.text || '')}</span>
      </div>
    </div>`;

  // 2) Pipeline trace (agent turns only — caller turns have no pipeline)
  let pipelineHtml = '';
  if (isAgent) {
    const pathLabel = t.provenancePath || '—';
    // KC card link — shown inline in pipeline trace for instant click-through
    const kcEditUrl  = t.kcCard ? `/agent-console/services-item.html?companyId=${encodeURIComponent(companyId)}&itemId=${encodeURIComponent(t.kcCard._id)}` : null;
    const kcIdLabel  = t.kcCard ? (t.kcCard.kcId || t.kcCard._id) : null;
    const kcCardRow  = kcEditUrl
      ? `<div class="pipe-row">
           <span class="pr-stage">KC Card</span>
           <span class="pr-icon">→</span>
           <span class="pr-detail">
             <a href="${esc(kcEditUrl)}" target="_blank"
                style="font-family:monospace;font-size:11px;background:#eff6ff;color:#1d4ed8;padding:1px 7px;border-radius:4px;border:1px solid #bfdbfe;text-decoration:none;font-weight:600;"
                title="Open KC card: ${esc(t.kcCard.title || kcIdLabel)}">${esc(kcIdLabel)}</a>
             ${t.kcCard.title ? `<span style="margin-left:6px;color:var(--tx-secondary);font-size:11px;">${esc(t.kcCard.title)}</span>` : ''}
           </span>
         </div>`
      : '';
    const pipeRows = `
      <div class="pipe-row"><span class="pr-stage">Provenance type</span><span class="pr-icon">→</span><span class="pr-detail">${esc(provLabel)}</span></div>
      <div class="pipe-row"><span class="pr-stage">Path / handler</span><span class="pr-icon">→</span><span class="pr-detail">${esc(pathLabel)}</span></div>
      ${kcCardRow}
      ${t.kind ? `<div class="pipe-row"><span class="pr-stage">Kind</span><span class="pr-icon">→</span><span class="pr-detail">${esc(t.kind)}</span></div>` : ''}
      ${t.intent ? `<div class="pipe-row"><span class="pr-stage">Detected intent</span><span class="pr-icon">→</span><span class="pr-detail">${esc(t.intent)}</span></div>` : ''}
      ${t.score  ? `<div class="pipe-row"><span class="pr-stage">KC match score</span><span class="pr-icon">→</span><span class="pr-detail">${t.score.toFixed(2)}</span></div>` : ''}
      ${t.latencyMs ? `<div class="pipe-row"><span class="pr-stage">Response latency</span><span class="pr-icon">→</span><span class="pr-detail">${t.latencyMs}ms</span></div>` : ''}
      ${t.sourceKey  ? `<div class="pipe-row"><span class="pr-stage">Source key</span><span class="pr-icon">→</span><span class="pr-detail">${esc(t.sourceKey)}</span></div>` : ''}
      <div class="pipe-row"><span class="pr-stage">DB turn #</span><span class="pr-icon">→</span><span class="pr-detail">${t.turnNumber ?? '—'}</span></div>
    `;
    pipelineHtml = `
      <div class="td-section">
        <div class="td-sec-title">Pipeline Trace</div>
        <div class="pipeline-rows">${pipeRows}</div>
      </div>`;
  }

  // 3) KC card (agent turns only)
  let kcHtml = '';
  if (isAgent && t.kcCard) {
    const editUrl = `/agent-console/services-item.html?companyId=${encodeURIComponent(companyId)}&itemId=${encodeURIComponent(t.kcCard._id)}`;
    kcHtml = `
      <div class="td-section">
        <div class="td-sec-title">KC Card Matched</div>
        <div class="kc-block">
          <div class="kb-id">${esc(t.kcCard.kcId || t.kcCard._id)}</div>
          <div class="kb-title">${esc(t.kcCard.title || 'Untitled')}</div>
          <div class="kb-meta">
            ${t.kcCard.category ? `<span>Category: ${esc(t.kcCard.category)}</span>` : ''}
            ${t.kcCard.bookingAction ? `<span>bookingAction: <strong>${esc(t.kcCard.bookingAction)}</strong></span>` : ''}
            ${t.score ? `<span>Score: ${t.score.toFixed(2)}</span>` : ''}
          </div>
          ${t.kcCard.closingPrompt ? `<div style="font-size:12px;color:var(--tx-secondary);margin-bottom:8px;">closingPrompt: "${esc(t.kcCard.closingPrompt)}"</div>` : ''}
          <div class="kb-actions">
            <a class="btn btn-kc" href="${esc(editUrl)}" target="_blank">✎ Edit KC Card</a>
          </div>
        </div>
      </div>`;
  }

  // 4) Discovery delta (caller turns — entities captured here)
  let discoveryHtml = '';
  if (isCaller && t.qaEntry) {
    discoveryHtml = `
      <div class="td-section">
        <div class="td-sec-title">Discovery Delta</div>
        <div class="delta-rows">
          <div class="delta-row">
            <span class="dr-key added">+ qaLog</span>
            <span class="dr-val">${esc(t.qaEntry.question)}: "${esc(t.qaEntry.answer)}"</span>
          </div>
        </div>
      </div>`;
  }

  // 5) Compliance flags
  let complianceHtml = '';
  if (t.flags?.length) {
    const verdicts = t.flags.map(f => `
      <div class="cv-block fail mt-2">
        <div class="cv-label">${esc(f.label)}</div>
        ${f.code === 'MISSED_BOOKING_CTA' && t.kcCard
          ? `<div class="cv-gap">KC card has bookingAction=offer_to_book but no booking CTA was delivered.</div>` : ''}
        ${f.code === 'LLM_FALLBACK'
          ? `<div class="cv-gap">No KC card matched. LLM generated this response — may not reflect authored policy.</div>` : ''}
      </div>`).join('');
    complianceHtml = `
      <div class="td-section">
        <div class="td-sec-title">Compliance Flags</div>
        ${verdicts}
      </div>`;
  }

  return `
    <div class="turn-block${isCaller ? ' tb-caller' : ' tb-agent'}${hasFlags ? ' has-flags' : ''}${hasCritical ? ' has-critical' : ''}" data-turn="${t.turnNumber}">
      <div class="turn-summary">
        ${speakerChip}
        <span class="turn-num-badge">${t.displayIndex ?? t.turnNumber}</span>
        <span class="turn-ts">${t.elapsed || '—'}</span>
        ${latLabel ? `<span class="latency-pill ${latCls}">${latLabel}</span>` : ''}
        <div class="turn-dialogue">${dialLine}</div>
        ${isAgent ? `<span class="prov-badge ${provClass}">${esc(provLabel)}</span>` : ''}
        ${hasFlags ? `<div class="turn-flags-row">${flagsHtml}</div>` : ''}
        <svg class="turn-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="turn-detail">
        ${verbatimHtml}
        ${pipelineHtml}
        ${kcHtml}
        ${discoveryHtml}
        ${complianceHtml}
      </div>
    </div>`;
}

// ── S5: KC Performance ────────────────────────────────────────────────────────

function renderSectionKC(kcAudit, companyId) {
  const matchedRows = kcAudit.matched.map(m => {
    const score = m.score ?? 0;
    const editUrl = `/agent-console/services-item.html?companyId=${encodeURIComponent(companyId)}&itemId=${encodeURIComponent(m.mongoId)}`;
    return `
      <tr>
        <td><span class="kc-id-chip">${esc(m.kcId || m.mongoId)}</span></td>
        <td>${esc(m.title || '—')}</td>
        <td>Turn ${m.turnNumber}${m.elapsed ? ` <span class="text-muted text-xs">${m.elapsed}</span>` : ''}</td>
        <td>
          <div class="score-track">
            <div class="score-bar-bg"><div class="score-bar-fg" style="width:${Math.round(score*100)}%"></div></div>
            <span class="score-num">${score.toFixed(2)}</span>
          </div>
        </td>
        <td>${m.missedBookingCta ? '<span class="badge badge-amber">⚠ CTA not sent</span>' : '<span class="badge badge-green">✓</span>'}</td>
        <td><a class="btn btn-kc" href="${esc(editUrl)}" target="_blank">✎ Edit</a></td>
      </tr>`;
  }).join('');

  const gapRows = kcAudit.gaps.map(g => {
    const newUrl = `/agent-console/services-item.html?companyId=${encodeURIComponent(companyId)}&new=1`;
    return `
      <tr>
        <td>Turn ${g.turnNumber}${g.elapsed ? ` <span class="text-muted text-xs">${g.elapsed}</span>` : ''}</td>
        <td class="gap-text-cell">"${esc(g.callerText?.substring(0, 80) || '—')}"</td>
        <td>${esc(g.path || 'LLM_FALLBACK')}</td>
        <td><a class="btn btn-create-kc" href="${esc(newUrl)}" target="_blank">+ Create KC Card</a></td>
      </tr>`;
  }).join('');

  const matchedBadge = `${kcAudit.matched.length} matched · ${kcAudit.gaps.length} gap${kcAudit.gaps.length !== 1 ? 's' : ''}`;

  return sectionWrap('sec-kc', '5', 'KC Performance', matchedBadge, `
    <p class="kc-section-title">KC Cards Used This Call</p>
    ${kcAudit.matched.length ? `
      <table class="kc-table">
        <thead><tr><th>KC ID</th><th>Title</th><th>Turn</th><th>Score</th><th>CTA Status</th><th>Action</th></tr></thead>
        <tbody>${matchedRows}</tbody>
      </table>` : '<p class="text-muted text-sm">No KC cards matched in this call.</p>'}

    ${kcAudit.gaps.length ? `
      <div class="divider"></div>
      <p class="kc-section-title">Knowledge Gaps (LLM answered, no KC existed)</p>
      <table class="kc-table">
        <thead><tr><th>Turn</th><th>Caller Asked</th><th>Path</th><th>Action</th></tr></thead>
        <tbody>${gapRows}</tbody>
      </table>` : ''}
  `);
}

// ── S6: Latency Profile ───────────────────────────────────────────────────────

function renderSectionLatency(lat) {
  const maxMs = Math.max(...lat.turns.filter(t => t.latencyMs).map(t => t.latencyMs), 500);

  const bars = lat.turns.map(t => {
    const pct = t.latencyMs ? Math.min(100, Math.round((t.latencyMs / maxMs) * 100)) : 0;
    const label = t.latencyMs ? `${t.latencyMs}ms` : '—';
    return `
      <div class="lat-row ${t.color}">
        <span class="lr-turn">Turn ${t.turnNumber}</span>
        <div class="lr-track">
          <div class="lr-fill" style="width:${pct}%">${pct > 15 ? label : ''}</div>
        </div>
        <span class="lr-path">${esc(t.path || '—')}</span>
      </div>`;
  }).join('');

  const worst = lat.worstTurn;

  return sectionWrap('sec-latency', '6', 'Latency Profile', lat.avgFormatted, `
    <div class="lat-summary">
      <div class="ls-item"><div class="ls-lbl">Avg latency</div><div class="ls-val">${lat.avgFormatted}</div></div>
      ${worst ? `<div class="ls-item"><div class="ls-lbl">Slowest turn</div><div class="ls-val">${worst.latencyMs}ms</div></div>` : ''}
      <div class="ls-item"><div class="ls-lbl">VAD overhead</div><div class="ls-val">~${lat.speechTimeoutOverheadSecs.toFixed(1)}s</div></div>
    </div>
    <div class="lat-bars">${bars}</div>
    <div class="vad-note">
      ℹ Every turn includes an additional ~1.5s speechTimeout (VAD wait) before the above response time.
      Total VAD overhead this call: <strong>~${lat.speechTimeoutOverheadSecs.toFixed(1)}s</strong>.
      ${lat.note ? `<br><span style="color:var(--c-warn)">${esc(lat.note)}</span>` : ''}
    </div>
  `);
}

// ── S7: Entity Timeline ───────────────────────────────────────────────────────

function renderSectionEntities(et) {
  if (et.note && !et.entries?.length) {
    return sectionWrap('sec-entities', '7', 'Entity Timeline', 'No data', `
      <p class="text-muted text-sm">${esc(et.note)}</p>`);
  }

  const events = (et.entries || []).map(e => `
    <div class="etl-event ${e.type}">
      <div class="ev-turn">Turn ${e.turn ?? '?'}</div>
      <div class="ev-body">
        <span class="ev-field">${esc(e.field)}</span>
        ${e.value ? ` → <span class="ev-val">"${esc(e.value)}"</span>` : ''}
      </div>
    </div>`).join('');

  const missingHtml = et.missing?.length ? `
    <div class="divider"></div>
    <p class="text-muted text-xs" style="margin-bottom:6px;">Never captured this call:</p>
    <div class="missing-pills">
      ${et.missing.map(m => `<span class="missing-pill">✗ ${esc(m)}</span>`).join('')}
    </div>` : '';

  const dnarHtml = et.doNotReask?.length ? `
    <div class="mt-3">
      <p class="text-muted text-xs" style="margin-bottom:6px;">doNotReask — will not ask again:</p>
      <div class="dnar-pills">
        ${et.doNotReask.map(d => `<span class="dnar-pill">✓ ${esc(d)}</span>`).join('')}
      </div>
    </div>` : '';

  const badge = et.objective ? `Final stage: ${et.objective}` : null;

  return sectionWrap('sec-entities', '7', 'Entity Timeline', badge, `
    <div class="entity-tl">${events || '<p class="text-muted text-sm">No entity events recorded.</p>'}</div>
    ${missingHtml}
    ${dnarHtml}
  `);
}

// ── S8: Issues & Actions ──────────────────────────────────────────────────────

function renderSectionIssues(issues, recommendations, companyId) {
  const order = ['critical', 'high', 'medium', 'low'];
  const sorted = [...(issues || [])].sort((a, b) =>
    order.indexOf(a.severity) - order.indexOf(b.severity)
  );

  const newKcUrl = `/agent-console/services-item.html?companyId=${encodeURIComponent(companyId)}&new=1`;

  const issueCards = sorted.map(issue => {
    const editLinks = (issue.kcIds || []).map(id => {
      const url = `/agent-console/services-item.html?companyId=${encodeURIComponent(companyId)}&itemId=${encodeURIComponent(id)}`;
      return `<a class="btn btn-kc" href="${esc(url)}" target="_blank">✎ Edit KC Card</a>`;
    }).join('');

    const turnsHtml = issue.affectedTurns?.length
      ? `<div class="ic-turns">
          <span class="text-xs text-muted" style="margin-right:4px;">Turns:</span>
          ${issue.affectedTurns.map(n => `<span class="tc-chip">${n}</span>`).join('')}
         </div>`
      : '';

    const actionBtns = [];
    if (issue.action === 'create_kc' || issue.action === 'edit_kc') {
      if (editLinks) actionBtns.push(editLinks);
      else actionBtns.push(`<a class="btn btn-create-kc" href="${esc(newKcUrl)}" target="_blank">+ Create KC Card</a>`);
    }

    return `
      <div class="issue-card ${esc(issue.severity || 'medium')}">
        <div class="ic-header">
          <span class="sev-badge ${esc(issue.severity || 'medium')}">${esc(issue.severity || 'medium')}</span>
          <span class="ic-title">${esc(issue.title)}</span>
        </div>
        <div class="ic-body">
          <p class="ic-desc">${esc(issue.description)}</p>
          ${turnsHtml}
          ${actionBtns.length ? `<div class="ic-actions">${actionBtns.join('')}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  // Recommendations (from GPT-4 analysis, if any)
  let recsHtml = '';
  if (recommendations?.length) {
    const recs = recommendations.map(rec => `
      <div class="issue-card ${rec.priority === 'immediate' ? 'critical' : rec.priority || 'medium'}">
        <div class="ic-header">
          <span class="sev-badge ${rec.priority === 'immediate' ? 'critical' : rec.priority || 'medium'}">${esc(rec.priority || 'medium')}</span>
          <span class="ic-title">${esc(rec.title)}</span>
        </div>
        <div class="ic-body">
          <p class="ic-desc">${esc(rec.description)}</p>
          ${rec.copyableContent ? `
            <div style="margin-top:8px; padding:8px 12px; background:var(--surface-2); border:1px solid var(--border); border-radius:var(--r-md); font-family:monospace; font-size:12px; color:var(--tx-secondary);">
              ${esc(rec.copyableContent)}
            </div>` : ''}
          <div class="ic-actions">
            ${rec.type === 'create_trigger' || rec.type === 'add_keyword'
              ? `<a class="btn btn-create-kc" href="${esc(newKcUrl)}" target="_blank">+ Create KC Card</a>`
              : ''}
          </div>
        </div>
      </div>`).join('');

    recsHtml = `
      <div class="divider"></div>
      <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--tx-muted);margin-bottom:10px;">AI Recommendations</p>
      <div class="issues-stack">${recs}</div>`;
  }

  const badge = sorted.length > 0
    ? `${sorted.filter(i => i.severity === 'critical' || i.severity === 'high').length} high priority`
    : 'No issues';

  return sectionWrap('sec-issues', '8', 'Issues & Actions', badge, `
    <div class="issues-stack">
      ${issueCards || '<p class="text-muted text-sm">No issues detected.</p>'}
    </div>
    ${recsHtml}
  `);
}

// ─── Turn expand/collapse ─────────────────────────────────────────────────────

function attachTurnToggles() {
  const content = $('report-content');
  content.querySelectorAll('.turn-block').forEach(block => {
    const summary = block.querySelector('.turn-summary');
    if (!summary) return;
    summary.addEventListener('click', () => {
      block.classList.toggle('expanded');
    });
  });
}

// ─── Scroll spy for left nav ──────────────────────────────────────────────────

function attachScrollSpy() {
  const content = $('report-content');
  if (!content) return;

  const sections = content.querySelectorAll('.section');
  const navItems = document.querySelectorAll('.nav-item[data-section]');

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        navItems.forEach(item => {
          item.classList.toggle('active', item.dataset.section === id);
        });
      }
    });
  }, { root: content, threshold: 0.3 });

  sections.forEach(s => obs.observe(s));

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = $(`${item.dataset.section}`);
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
  });
}

// ─── AI Analysis trigger ──────────────────────────────────────────────────────

async function runAiAnalysis(callSid) {
  if (state.analyzingCallSid === callSid) return;
  state.analyzingCallSid = callSid;

  const btn = $('btn-analyze');
  const banner = $('ai-banner');
  if (btn) {
    btn.classList.add('loading');
    btn.textContent = 'Analyzing…';
  }
  if (banner) {
    banner.innerHTML = `
      <div class="ai-analyzing">
        <div class="spinner"></div>
        Running GPT-4 analysis — this takes 20–40 seconds…
      </div>`;
  }

  try {
    await apiFetch(`/api/call-intelligence/analyze/${callSid}`, {
      method: 'POST',
      body: JSON.stringify({ companyId: state.companyId })
    });
    // Reload the report
    await openReport(callSid);
  } catch (err) {
    state.analyzingCallSid = null;
    if (banner) {
      banner.innerHTML = `
        <div class="ai-banner" id="ai-banner">
          <div>
            <p style="color:var(--c-fail);">Analysis failed: ${esc(err.message)}</p>
          </div>
          <button class="btn btn-ai" onclick="runAiAnalysis('${esc(callSid)}')">Retry →</button>
        </div>`;
    }
  }
}

// Expose globally for onclick handlers
window.openReport = openReport;
window.runAiAnalysis = runAiAnalysis;

// ─── Settings panel ───────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const data = await apiFetch(`/api/call-intelligence/settings/${state.companyId}`);
    const gpt4 = $('gpt4-toggle');
    const auto  = $('auto-analyze-toggle');
    const model = $('analysis-model');
    const mode  = $('analysis-mode');
    const slider = $('gpt4-slider');
    const autoSlider = $('auto-analyze-slider');

    if (gpt4)  gpt4.checked  = data.gpt4Enabled || false;
    if (auto)  auto.checked  = data.autoAnalyze || false;
    if (model) model.value   = data.analysisModel || 'gpt-4o-mini';
    if (mode)  mode.value    = data.analysisMode  || 'quick';
    if (slider) slider.style.background = (data.gpt4Enabled) ? '#2563eb' : '#cbd5e1';
    if (autoSlider) autoSlider.style.opacity = (data.gpt4Enabled) ? '1' : '0.5';
    if (auto) auto.disabled = !data.gpt4Enabled;

    $('gpt4-status').textContent = data.gpt4Enabled ? '● GPT-4 active' : '○ GPT-4 disabled';
    $('gpt4-status').style.color = data.gpt4Enabled ? 'var(--c-ok)' : 'var(--tx-muted)';
  } catch {
    $('gpt4-status').textContent = 'Could not load settings';
  }
}

async function saveSettings() {
  const body = {
    companyId: state.companyId,
    gpt4Enabled: $('gpt4-toggle')?.checked || false,
    autoAnalyze: $('auto-analyze-toggle')?.checked || false,
    analysisModel: $('analysis-model')?.value || 'gpt-4o-mini',
    analysisMode: $('analysis-mode')?.value || 'quick'
  };
  try {
    await apiFetch(`/api/call-intelligence/settings/${state.companyId}`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    $('settings-panel').style.display = 'none';
    loadDashboard();
  } catch (err) {
    alert(`Failed to save: ${err.message}`);
  }
}

// ─── Download JSON ────────────────────────────────────────────────────────────

function downloadReportJson() {
  if (!state.reportData) return;
  const blob = new Blob([JSON.stringify(state.reportData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `call-report-${state.currentCallSid || 'unknown'}.json`;
  a.click();
}

// ─── Event wiring ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (!state.companyId) {
    showView('dashboard');
    $('calls-tbody').innerHTML = `
      <tr><td colspan="10" style="padding:40px;text-align:center;color:var(--c-fail);">
        Missing companyId in URL. Use ?companyId=YOUR_COMPANY_ID
      </td></tr>`;
    return;
  }

  // Initial load
  showView('dashboard');
  loadDashboard();

  // Back to list
  $('btn-back-to-list').addEventListener('click', () => {
    state.currentCallSid = null;
    state.reportData = null;
    showView('dashboard');
    loadDashboard();
  });

  // Refresh — re-load whichever view is currently active
  $('btn-refresh').addEventListener('click', () => {
    if (state.view === 'report' && state.currentCallSid) {
      openReport(state.currentCallSid);   // re-fetch the current report
    } else {
      loadDashboard();                    // refresh the call list
    }
  });

  // Settings
  $('btn-settings').addEventListener('click', () => {
    const panel = $('settings-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    if (panel.style.display === 'block') loadSettings();
  });
  $('btn-close-settings').addEventListener('click', () => {
    $('settings-panel').style.display = 'none';
  });
  $('btn-save-settings').addEventListener('click', saveSettings);

  // GPT-4 toggle visual
  $('gpt4-toggle').addEventListener('change', function() {
    $('gpt4-slider').style.background = this.checked ? '#2563eb' : '#cbd5e1';
    $('auto-analyze-toggle').disabled = !this.checked;
    $('auto-analyze-slider').style.opacity = this.checked ? '1' : '0.5';
  });

  // Download JSON
  $('btn-download-json').addEventListener('click', downloadReportJson);

  // Filters
  $('filter-time').addEventListener('change', e => {
    state.filterTime = e.target.value;
    state.page = 1;
    loadDashboard();
  });
  $('filter-status').addEventListener('change', e => {
    state.filterStatus = e.target.value;
    state.page = 1;
    loadDashboard();
  });

  let searchTimer;
  $('search-input').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchQuery = e.target.value.trim();
      state.page = 1;
      loadDashboard();
    }, 400);
  });

  // Pagination
  $('btn-prev').addEventListener('click', () => {
    if (state.page > 1) { state.page--; loadDashboard(); }
  });
  $('btn-next').addEventListener('click', () => {
    if (state.page < state.totalPages) { state.page++; loadDashboard(); }
  });

  // Close settings on outside click
  document.addEventListener('click', e => {
    const panel = $('settings-panel');
    if (panel.style.display !== 'none' &&
        !panel.contains(e.target) &&
        e.target !== $('btn-settings') &&
        !$('btn-settings').contains(e.target)) {
      panel.style.display = 'none';
    }
  });
});
