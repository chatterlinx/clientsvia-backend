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
          issues, recommendations, hasGpt4Analysis, gpt4Meta,
          turnByTurnFlow } = r;

  // Build turnFlowMap — indexed by turnNumber for O(1) lookup in renderTurnBlock
  const turnFlowMap = {};
  for (const step of (turnByTurnFlow || [])) {
    if (step.turnNumber != null) turnFlowMap[step.turnNumber] = step;
  }
  state.turnFlowMap = turnFlowMap;

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

  // ── Render all 9 sections ──────────────────────────────────────────────
  $('report-content').innerHTML = [
    renderSectionStory(story, hasGpt4Analysis, header.callSid),
    renderSectionTurnCoverage(turns, header.companyId),
    renderSectionVitals(vitals, header.recordingUrl),
    renderSectionProtocol(protocolAudit),
    renderSectionTurns(turns, header.companyId, turnFlowMap),
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

// ── S2: Turn Coverage ─────────────────────────────────────────────────────────
//
// Per-turn routing breakdown: UAP/KC vs LLM fallback vs booking script.
// For non-Turn-1 LLM fallbacks, shows a fix hint + action button so the
// admin can close the coverage gap.
// NOTE: KC misroute detection (container matched wrong topic) is a future
// addition — requires a UAP_FALSE_POSITIVE qaLog event type. For now,
// any ✅ KC row may still be a misroute we can't yet see.

// Render a single most-specific kcId chip for any turn that has a kcCard.
// Section IDs already embed the container prefix (700c4-34-09 contains 700c4-34)
// so showing both is redundant noise. Prefer section; fall back to container.
function _renderKcIds(kc, editUrl) {
  if (!kc) return '';

  if (kc.sectionId) {
    const secUrl = editUrl ? `${editUrl}#section-${kc.sectionIdx ?? ''}` : null;
    const secLabel = kc.sectionIdx != null ? `§${kc.sectionIdx + 1} ${kc.sectionId}` : kc.sectionId;
    const chip = secUrl
      ? `<a href="${esc(secUrl)}" target="_blank" class="tc-kc-chip tc-kc-chip-section" title="Open section in editor">${esc(secLabel)}</a>`
      : `<span class="tc-kc-chip tc-kc-chip-section">${esc(secLabel)}</span>`;
    return `<div class="tc-kc-ids">${chip}</div>`;
  }

  if (kc.kcId) {
    const chip = editUrl
      ? `<a href="${esc(editUrl)}" target="_blank" class="tc-kc-chip tc-kc-chip-container" title="Open container in editor">${esc(kc.kcId)}</a>`
      : `<span class="tc-kc-chip tc-kc-chip-container">${esc(kc.kcId)}</span>`;
    return `<div class="tc-kc-ids">${chip}</div>`;
  }

  return '';
}

function _classifyTurn(t, companyId) {
  if (t.speaker !== 'agent') return null;

  const turnNum = t.turnNumber;
  const path    = t.provenancePath || '';
  const src     = t.sourceKey || '';
  const type    = t.provenanceType || '';
  const kc      = t.kcCard;
  const mode    = t.answerMode || null;    // 'uap' | 'uap-text' | 'uap-audio' | 'groq' | 'llm-agent' | null
  const hasLLMFlag = (t.flags || []).some(f => f.code === 'LLM_FALLBACK');

  const kcEditUrl = kc?._id
    ? `/agent-console/services-item.html?companyId=${encodeURIComponent(companyId)}&itemId=${encodeURIComponent(kc._id)}`
    : null;

  // ── Turn 1 intake: always expected LLM Agent, excluded from coverage % ──
  // BUT still counted in the LLM AGENT stat — Turn 1 IS a Claude call and has $ cost.
  if (turnNum === 1) {
    return {
      status: 'expected',
      icon: '🔵',
      srcLabel: 'LLM Agent (Turn 1 intake)',
      srcSub: 'Expected — Claude generates turn 1',
      fixHtml: '<span class="tc-fix-na">Intake</span>',
      counts: false,            // excluded from coverage % denominator
      covered: false,
      countsAsLLM: true,        // Phase B.5 — count in LLM AGENT stat (honest: Turn 1 = Claude)
    };
  }

  // ── LLM Agent fallback outside Turn 1: the target of this card ──
  if (mode === 'llm-agent' || hasLLMFlag || path === 'KC_LLM_FALLBACK') {
    const kcTitle = kc?.title || null;
    let fixHtml;
    let srcSub;
    if (kcTitle) {
      srcSub = `${_renderKcIds(kc, kcEditUrl)}<div class="tc-src-hint">Section gap · ${esc(kcTitle)}</div>`;
      fixHtml = kcEditUrl
        ? `<a href="${esc(kcEditUrl)}" target="_blank" class="tc-fix-btn">Open KC Card →</a>
           <div class="tc-fix-hint">Add a section for this caller question</div>`
        : `<div class="tc-fix-hint">Add a section to "${esc(kcTitle)}" covering this question</div>`;
    } else {
      srcSub = 'No KC match';
      fixHtml = `<span class="tc-fix-hint">Use Phrase Finder to match or create KC</span>`;
    }
    return {
      status: 'llm_fallback',
      icon: '❌',
      srcLabel: 'LLM Agent',
      srcSub,
      fixHtml,
      counts: true,
      covered: false,
      needsPhraseFinder: !kcTitle,
    };
  }

  // ── KC hit branches (UI_OWNED + kcCard present) ─────────────────────────
  // Split by answerMode: uap-audio / uap-text / uap / groq — so admins know whether
  // this turn ran through the Groq formatter (latency cost + variability) vs
  // served verbatim Fixed content vs served a pre-cached audio file.
  // 'uap' (generic) = we know KC answered but TWIML system turn wasn't logged
  // to disambiguate text vs audio (don't guess).
  if ((mode === 'uap' || mode === 'uap-text' || mode === 'uap-audio' || mode === 'groq') && kc) {
    const kcLink = kcEditUrl
      ? `<a href="${esc(kcEditUrl)}" target="_blank" class="tc-kc-link" title="Open KC card">${esc(kc.title || '—')}</a>`
      : esc(kc.title || '—');
    const titleLine = kc.sectionLabel
      ? `${kcLink} · ${esc(kc.sectionLabel)}`
      : kcLink;

    let srcLabel, icon, hintLine;
    if (mode === 'uap-audio') {
      srcLabel = 'UAP Audio';
      icon     = '🎵';
      hintLine = 'Pre-cached audio · no TTS, no Groq';
    } else if (mode === 'uap-text') {
      srcLabel = 'UAP (text)';
      icon     = '✅';
      hintLine = 'Fixed section · TTS · no Groq';
    } else if (mode === 'uap') {
      srcLabel = 'UAP';
      icon     = '✅';
      hintLine = 'KC direct hit · delivery mode unavailable for this turn';
    } else {
      srcLabel = 'Groq';
      icon     = '🟣';
      const ms = t.groqLatencyMs ? ` · ${t.groqLatencyMs}ms` : '';
      hintLine = `Groq formatter reshaped KC content${ms}`;
    }
    const srcSub = `${titleLine}${_renderKcIds(kc, kcEditUrl)}<div class="tc-src-hint tc-src-hint-faint">${hintLine}</div>`;
    return {
      status: 'kc_hit',
      icon,
      srcLabel,
      srcSub,
      fixHtml: '<span class="tc-fix-dash">—</span>',
      counts: true,
      covered: true,
      mode,
    };
  }

  // Legacy fallback — older transcripts without answerMode: keep prior "KC" label
  if (type === 'UI_OWNED' && kc) {
    const kcLink = kcEditUrl
      ? `<a href="${esc(kcEditUrl)}" target="_blank" class="tc-kc-link" title="Open KC card">${esc(kc.title || '—')}</a>`
      : esc(kc.title || '—');
    const isDigression = path === 'BK_KC_DIGRESSION';
    const titleLine = kc.sectionLabel ? `${kcLink} · ${esc(kc.sectionLabel)}` : kcLink;
    const srcSub = `${titleLine}${_renderKcIds(kc, kcEditUrl)}<div class="tc-src-hint tc-src-hint-faint">Legacy trace — exact mode unavailable</div>`;
    return {
      status: 'kc_hit',
      icon: '✅',
      srcLabel: isDigression ? 'KC Digression' : 'KC',
      srcSub,
      fixHtml: '<span class="tc-fix-dash">—</span>',
      counts: true,
      covered: true,
    };
  }

  // ── Hardcoded scripts (booking, transfer, intent) ──
  if (type === 'HARDCODED' || src === 'BOOKING_LOGIC_ENGINE' || path === 'KC_BOOKING_INTENT') {
    let label;
    if (path === 'KC_BOOKING_INTENT')         label = 'Booking Intent';
    else if (src === 'BOOKING_LOGIC_ENGINE')  label = 'Booking Flow';
    else if (src === 'TRANSFER_ENGINE')       label = 'Transfer Flow';
    else                                       label = 'Script';
    return {
      status: 'script',
      icon: '⚙️',
      srcLabel: label,
      srcSub: 'Hardcoded (deterministic)',
      fixHtml: '<span class="tc-fix-dash">—</span>',
      counts: true,
      covered: true,
    };
  }

  // ── Unknown / unclassified ──
  return {
    status: 'unknown',
    icon: '❓',
    srcLabel: 'Unclassified',
    srcSub: path || src || 'Unknown provenance',
    fixHtml: '<span class="tc-fix-dash">—</span>',
    counts: true,
    covered: true,   // charitable: don't count as a gap unless we know it is
  };
}

// Pair each agent turn with its preceding caller turn (same turnNumber)
function _pairCallerText(turns, agentTurn) {
  const paired = turns.find(t =>
    t.turnNumber === agentTurn.turnNumber && t.speaker === 'caller');
  return paired?.text || '';
}

// Collapse runs of 2+ consecutive script rows into one range row
function _collapseScriptRuns(items) {
  const out = [];
  let run = null;
  const flushRun = () => {
    if (!run) return;
    if (run.items.length >= 2) {
      out.push({ kind: 'range', start: run.items[0].turn.turnNumber,
                 end: run.items[run.items.length - 1].turn.turnNumber,
                 items: run.items });
    } else {
      out.push({ kind: 'single', ...run.items[0] });
    }
    run = null;
  };
  for (const it of items) {
    const isScript = it.cls?.status === 'script';
    if (isScript) {
      if (!run) run = { items: [it] };
      else run.items.push(it);
    } else {
      flushRun();
      out.push({ kind: 'single', ...it });
    }
  }
  flushRun();
  return out;
}

function renderSectionTurnCoverage(turns, companyId) {
  if (!turns?.length) {
    return sectionWrap('sec-coverage', '2', 'Turn Coverage', '0 turns',
      `<div class="empty-state"><p>No turn data for coverage analysis.</p></div>`);
  }

  // 1. Classify each agent turn
  const agentItems = turns
    .filter(t => t.speaker === 'agent')
    .map(t => ({ turn: t, cls: _classifyTurn(t, companyId) }))
    .filter(x => x.cls);

  // 2. Counts + coverage %
  const total      = agentItems.length;
  const counted    = agentItems.filter(x => x.cls.counts).length;          // excludes Turn 1
  const covered    = agentItems.filter(x => x.cls.covered).length;
  const kcHits     = agentItems.filter(x => x.cls.status === 'kc_hit').length;
  // UAP counters: split by mode. 'uap' = generic (audio signal unavailable),
  // folded into UAP (text) count since we can't prove audio was served.
  const uapText    = agentItems.filter(x => x.cls.mode === 'uap-text' || x.cls.mode === 'uap').length;
  const uapAudio   = agentItems.filter(x => x.cls.mode === 'uap-audio').length;
  const groqHits   = agentItems.filter(x => x.cls.mode === 'groq').length;
  // Phase B.5 — LLM AGENT count now honestly includes Turn 1 (it's a Claude call)
  // plus any mid-call fallback. Coverage % denominator unchanged (still excludes T1).
  const llmFallbacks = agentItems.filter(x => x.cls.status === 'llm_fallback').length;
  const llmTotal   = agentItems.filter(x => x.cls.countsAsLLM || x.cls.status === 'llm_fallback').length;
  const scripts    = agentItems.filter(x => x.cls.status === 'script').length;
  const coveragePct = counted > 0 ? Math.round((covered / counted) * 100) : 100;
  const coverageClass =
    coveragePct >= 90 ? 'tc-cov-good'  :
    coveragePct >= 75 ? 'tc-cov-mid'   : 'tc-cov-bad';

  // Phase B.5 — Per-call cost estimate
  // Sums what we actually know from qaLog (Phase A.4 Claude fallback $) and estimates
  // what we don't yet log (ElevenLabs TTS from spoken char count, Groq/STT flagged unknown).
  // Rate assumptions match COST_CONSTANTS in KCDiscoveryRunner.js (env-overridable server-side).
  const RATE_ELEVENLABS_PER_CHAR = 0.30 / 1000;   // $0.30 per 1k chars
  const RATE_GROQ_PER_TURN_EST   = 0.00025;        // rough: ~500 tok × $0.79/M = $0.0004 — until real logging
  let   costClaudeUsd   = 0;                       // Phase A.4 + Pass 2b — real $ from qaEntry.cost + qaCosts.claudeUsd
  let   costElevenUsd   = 0;                       // Pass 2c — real $ from qaCosts.elevenUsd (fallback: estimate)
  let   costGroqEstUsd  = 0;                       // Pass 2a — real $ from qaCosts.groqUsd (fallback: estimate)
  let   elevenCharCount = 0;
  let   costClaudeReal  = 0, costElevenReal = 0, costGroqReal = 0;  // track how much is measured vs estimated
  let   costElevenEst   = 0, costGroqEst    = 0;
  // Commit 1 — richer cost telemetry for the click-drawer
  let   claudeTokIn = 0, claudeTokOut = 0, claudeCalls = 0;
  let   groqTokIn   = 0, groqTokOut   = 0, groqCalls   = 0;
  let   elevenCalls = 0;
  let   preCachedCount = 0;       // number of turns that used pre-cached audio (free)
  let   preCachedChars = 0;       // chars that WOULD have cost money but were pre-cached
  const costRows     = [];        // per-turn breakdown: { turn, category, label, detail, usd, quality }
  const costUnknown = { stt: true, twilio: true }; // honestly flagged
  for (const { turn: t, cls } of agentItems) {
    // ── REAL data (Pass 2a/b/c) ─────────────────────────────────────────────
    const qc = t.qaCosts;
    if (qc) {
      if (qc.claudeUsd > 0) { costClaudeUsd += qc.claudeUsd; costClaudeReal += qc.claudeUsd; }
      if (qc.groqUsd   > 0) { costGroqEstUsd += qc.groqUsd;  costGroqReal   += qc.groqUsd; }
      if (qc.elevenUsd > 0) { costElevenUsd += qc.elevenUsd; costElevenReal += qc.elevenUsd; elevenCharCount += (qc.elevenChars || 0); }
      // Walk the breakdown[] for per-turn rows + token rollups
      if (Array.isArray(qc.breakdown)) {
        for (const b of qc.breakdown) {
          if (b.type === 'claude') {
            claudeCalls++;
            costRows.push({ turn: t.turnNumber, category: 'claude', label: 'Claude', detail: `${b.source || 'fallback'} · ${b.model || 'claude-sonnet-4-5'}`, usd: b.usd, quality: 'real' });
          } else if (b.type === 'groq') {
            groqCalls++;
            costRows.push({ turn: t.turnNumber, category: 'groq',   label: 'Groq',   detail: `${b.source || 'kc'} · ${b.model || 'llama-3.3-70b'}`, usd: b.usd, quality: 'real' });
          } else if (b.type === 'elevenlabs') {
            elevenCalls++;
            costRows.push({ turn: t.turnNumber, category: 'elevenlabs', label: 'ElevenLabs TTS', detail: `${b.source || 'tts'} · ${b.chars || '?'} chars`, usd: b.usd, quality: 'real' });
          }
        }
      }
    }
    // Backward compat: legacy qaEntry.cost (Phase A.4) when qaCosts not present
    if (!qc) {
      const usd = t.qaEntry?.cost?.usd;
      if (typeof usd === 'number' && usd > 0) {
        costClaudeUsd += usd; costClaudeReal += usd; claudeCalls++;
        costRows.push({ turn: t.turnNumber, category: 'claude', label: 'Claude', detail: 'legacy qaEntry.cost', usd, quality: 'real' });
      }
    }
    // ── ESTIMATE fallbacks (only when no real data for that category) ──────
    // Track pre-cached turns so the drawer can show "savings"
    const isPreCached = cls.mode === 'uap-audio' || t.audioServed === true;
    if (isPreCached && t.text) {
      preCachedCount++;
      preCachedChars += t.text.length;
    }
    // ElevenLabs estimate — only when no real char count was logged for this turn
    const turnHasRealEleven = qc && qc.elevenUsd > 0;
    if (!turnHasRealEleven && !isPreCached && t.text) {
      const est = t.text.length * RATE_ELEVENLABS_PER_CHAR;
      elevenCharCount += t.text.length;
      costElevenUsd   += est;
      costElevenEst   += est;
      costRows.push({ turn: t.turnNumber, category: 'elevenlabs', label: 'ElevenLabs TTS', detail: `~${t.text.length} chars (estimated from agent text)`, usd: est, quality: 'est' });
    }
    // Groq estimate — only when no real Groq cost was logged for this turn
    const turnHasRealGroq = qc && qc.groqUsd > 0;
    if (!turnHasRealGroq && (cls.mode === 'groq' || (cls.status === 'kc_hit' && !cls.mode))) {
      costGroqEstUsd += RATE_GROQ_PER_TURN_EST;
      costGroqEst    += RATE_GROQ_PER_TURN_EST;
      costRows.push({ turn: t.turnNumber, category: 'groq', label: 'Groq', detail: '~500 tokens (estimated)', usd: RATE_GROQ_PER_TURN_EST, quality: 'est' });
    }
  }
  const costEstTotal = costClaudeUsd + costElevenUsd + costGroqEstUsd;
  const fmtUsd = (n) => n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;
  // Track measurement quality for the tooltip so admins can tell real vs estimate.
  const _mark = (real, est) => (est > 0 && real === 0) ? 'est' : (real > 0 && est === 0) ? 'real' : (real > 0 && est > 0) ? 'mixed' : 'none';
  const qClaude = _mark(costClaudeReal, 0);
  const qEleven = _mark(costElevenReal, costElevenEst);
  const qGroq   = _mark(costGroqReal,   costGroqEst);
  // Pre-cached savings — calculated at the current ElevenLabs rate
  const preCachedSavings = preCachedChars * RATE_ELEVENLABS_PER_CHAR;

  // 3. Collapse consecutive script rows
  const collapsed = _collapseScriptRuns(agentItems);

  // 4. Build table rows
  const companyIdSafe = encodeURIComponent(companyId || '');
  const rowsHtml = collapsed.map((entry, entryIdx) => {
    if (entry.kind === 'range') {
      // Collapsed script range row
      const subRows = entry.items.map(it => {
        const t = it.turn;
        const preview = (t.text || '').substring(0, 100);
        return `<tr class="tc-row tc-row-script tc-sub-row">
          <td class="tc-col-num">${t.turnNumber}</td>
          <td class="tc-col-src">
            <span class="tc-icon">${it.cls.icon}</span>
            <div class="tc-src">
              <div class="tc-src-lbl">${esc(it.cls.srcLabel)}</div>
              <div class="tc-src-sub">${it.cls.srcSub}</div>
            </div>
          </td>
          <td class="tc-col-content"><span class="tc-content-muted">${esc(preview)}${t.text?.length > 100 ? '…' : ''}</span></td>
          <td class="tc-col-fix">${it.cls.fixHtml}</td>
        </tr>`;
      }).join('');
      const rangeId = `tc-range-${entryIdx}`;
      return `<tr class="tc-row tc-row-range" data-range="${rangeId}" onclick="toggleTcRange('${rangeId}', this)">
        <td class="tc-col-num">${entry.start}-${entry.end}</td>
        <td class="tc-col-src">
          <span class="tc-icon">⚙️</span>
          <div class="tc-src">
            <div class="tc-src-lbl">Booking flow · ${entry.items.length} turns</div>
            <div class="tc-src-sub tc-range-hint">Click to expand individual turns ▸</div>
          </div>
        </td>
        <td class="tc-col-content"><span class="tc-content-muted">Name / address / confirmation steps…</span></td>
        <td class="tc-col-fix"><span class="tc-fix-dash">—</span></td>
      </tr>
      <tr class="tc-range-expand" data-range-body="${rangeId}" style="display:none;"><td colspan="4" style="padding:0;">
        <table class="tc-subtable"><tbody>${subRows}</tbody></table>
      </td></tr>`;
    }

    // Single row (KC hit, LLM fallback, Turn 1, or one-off script)
    const t = entry.turn;
    const preview = (t.text || '').substring(0, 110);
    const rowCls = `tc-row tc-row-${entry.cls.status}`;

    // For LLM fallbacks with no container match, inject a Phrase Finder button
    // using the prior caller phrase
    let fixHtml = entry.cls.fixHtml;
    if (entry.cls.needsPhraseFinder) {
      const callerPhrase = _pairCallerText(turns, t).substring(0, 120).trim();
      if (callerPhrase) {
        const pfUrl = `/agent-console/services.html?companyId=${companyIdSafe}&openPf=${encodeURIComponent(callerPhrase)}`;
        fixHtml = `<a href="${esc(pfUrl)}" target="_blank" class="tc-fix-btn">Phrase Finder →</a>
                   <div class="tc-fix-hint">Match "${esc(callerPhrase.slice(0, 40))}…" to KC</div>`;
      }
    }

    return `<tr class="${rowCls}">
      <td class="tc-col-num">${t.turnNumber}</td>
      <td class="tc-col-src">
        <span class="tc-icon">${entry.cls.icon}</span>
        <div class="tc-src">
          <div class="tc-src-lbl">${esc(entry.cls.srcLabel)}</div>
          <div class="tc-src-sub">${entry.cls.srcSub}</div>
        </div>
      </td>
      <td class="tc-col-content">${esc(preview)}${t.text?.length > 110 ? '…' : ''}</td>
      <td class="tc-col-fix">${fixHtml}</td>
    </tr>`;
  }).join('');

  // 5. Summary bar + table
  //    KC-hit stat splits into UAP-text / UAP-audio / Groq so admins can see at
  //    a glance how much of each turn went through the expensive Groq formatter.
  // Build cost tooltip (shown on hover of Est. Cost card).
  // Pass 2d — mark each line with real ($) / est (~) / mixed (±) based on qaCosts data.
  const _tag = (q) => q === 'real' ? '$' : q === 'est' ? '~' : q === 'mixed' ? '±' : '—';
  const costTooltip = [
    `Click for breakdown`,
    `Claude ${_tag(qClaude)}: ${fmtUsd(costClaudeUsd)}`,
    `ElevenLabs ${_tag(qEleven)}: ${fmtUsd(costElevenUsd)}`,
    `Groq ${_tag(qGroq)}: ${fmtUsd(costGroqEstUsd)}`
  ].join(' • ');

  // Commit 1 — clickable cost drawer (full itemized breakdown, hidden by default)
  const _costRowsHtml = costRows.length === 0
    ? `<tr><td colspan="4" style="padding:10px;color:#64748b;font-style:italic;">No cost events logged for this call.</td></tr>`
    : costRows
        .sort((a, b) => a.turn - b.turn)
        .map(r => `
          <tr>
            <td style="padding:6px 8px;color:#475569;">T${r.turn}</td>
            <td style="padding:6px 8px;"><span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600;background:${r.category === 'claude' ? '#fee2e2' : r.category === 'groq' ? '#ede9fe' : r.category === 'elevenlabs' ? '#fef3c7' : '#f1f5f9'};color:${r.category === 'claude' ? '#991b1b' : r.category === 'groq' ? '#5b21b6' : r.category === 'elevenlabs' ? '#854d0e' : '#334155'};">${esc(r.label)}</span> ${r.quality === 'est' ? '<span style="font-size:10px;color:#94a3b8;">~est</span>' : ''}</td>
            <td style="padding:6px 8px;color:#475569;font-size:12px;">${esc(r.detail)}</td>
            <td style="padding:6px 8px;text-align:right;font-family:ui-monospace,monospace;">${fmtUsd(r.usd)}</td>
          </tr>`)
        .join('');

  const costDrawerHtml = `
    <div id="tc-cost-drawer" style="display:none;margin:12px 0;padding:14px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <strong style="color:#78350f;font-size:14px;">💰 Cost Breakdown</strong>
        <button onclick="toggleCostDrawer()" style="background:transparent;border:1px solid #d6a35a;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:11px;color:#78350f;">Close</button>
      </div>

      <!-- Per-category summary -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:12px;">
        <div style="background:#fff;padding:10px;border-left:3px solid #dc2626;border-radius:4px;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;">Claude (LLM Agent)</div>
          <div style="font-size:18px;font-weight:600;color:#991b1b;">${fmtUsd(costClaudeUsd)} <span style="font-size:10px;color:#94a3b8;">${_tag(qClaude)}</span></div>
          <div style="font-size:11px;color:#475569;margin-top:4px;">${claudeCalls} call${claudeCalls === 1 ? '' : 's'} · ${claudeCalls > 0 ? 'rate: $3.00/M in, $15/M out' : 'no calls'}</div>
        </div>
        <div style="background:#fff;padding:10px;border-left:3px solid #7c3aed;border-radius:4px;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;">Groq (KC answers)</div>
          <div style="font-size:18px;font-weight:600;color:#5b21b6;">${fmtUsd(costGroqEstUsd)} <span style="font-size:10px;color:#94a3b8;">${_tag(qGroq)}</span></div>
          <div style="font-size:11px;color:#475569;margin-top:4px;">${groqCalls} call${groqCalls === 1 ? '' : 's'} · ${groqCalls > 0 ? 'rate: $0.59/M in, $0.79/M out' : 'no calls'}</div>
        </div>
        <div style="background:#fff;padding:10px;border-left:3px solid #ca8a04;border-radius:4px;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;">ElevenLabs TTS</div>
          <div style="font-size:18px;font-weight:600;color:#854d0e;">${fmtUsd(costElevenUsd)} <span style="font-size:10px;color:#94a3b8;">${_tag(qEleven)}</span></div>
          <div style="font-size:11px;color:#475569;margin-top:4px;">${elevenCharCount} chars × $0.30/1k · ${elevenCalls || (costElevenEst > 0 ? 'est' : '0')} synth${preCachedCount > 0 ? ` <span style="color:#16a34a;">· saved ${fmtUsd(preCachedSavings)} (${preCachedCount} pre-cached)</span>` : ''}</div>
        </div>
        <div style="background:#fff;padding:10px;border-left:3px solid #94a3b8;border-radius:4px;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;">STT · Twilio</div>
          <div style="font-size:18px;font-weight:600;color:#64748b;">—</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px;">not yet logged — coming next</div>
        </div>
      </div>

      <!-- Per-turn itemization -->
      <details style="margin-top:8px;">
        <summary style="cursor:pointer;font-size:12px;color:#78350f;padding:6px 0;">Per-turn itemization (${costRows.length} event${costRows.length === 1 ? '' : 's'})</summary>
        <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;background:#fff;border-radius:4px;overflow:hidden;">
          <thead>
            <tr style="background:#fef3c7;color:#78350f;">
              <th style="padding:6px 8px;text-align:left;width:50px;">Turn</th>
              <th style="padding:6px 8px;text-align:left;width:160px;">Category</th>
              <th style="padding:6px 8px;text-align:left;">Detail</th>
              <th style="padding:6px 8px;text-align:right;width:100px;">Cost</th>
            </tr>
          </thead>
          <tbody>${_costRowsHtml}</tbody>
        </table>
      </details>

      <!-- Rates note -->
      <div style="margin-top:10px;padding:8px;background:#fef3c7;border-radius:4px;font-size:11px;color:#78350f;">
        <strong>Rates used:</strong> Claude Sonnet 4.5 $3/$15 per M · Groq Llama 3.3 70B $0.59/$0.79 per M · ElevenLabs Turbo v2.5 $0.30 per 1k chars.
        Configure per-company rates in <em>services.html → Cost &amp; Billing tab</em> (coming next).
        Today rates are env vars: <code>KC_COST_CLAUDE_IN_PER_M</code>, <code>KC_COST_GROQ_IN_PER_M</code>, <code>KC_COST_ELEVENLABS_PER_K_CHARS</code>.
      </div>
    </div>`;

  const bodyHtml = `
    <div class="tc-summary">
      <div class="tc-stat"><span class="tc-stat-val">${total}</span><span class="tc-stat-lbl">Agent turns</span></div>
      <div class="tc-stat tc-stat-kc"><span class="tc-stat-val">${uapText}</span><span class="tc-stat-lbl">UAP (text)</span></div>
      <div class="tc-stat tc-stat-kc"><span class="tc-stat-val">${uapAudio}</span><span class="tc-stat-lbl">UAP Audio</span></div>
      <div class="tc-stat tc-stat-groq"><span class="tc-stat-val">${groqHits}</span><span class="tc-stat-lbl">Groq</span></div>
      <div class="tc-stat tc-stat-fallback" title="${esc(llmFallbacks > 0 ? `Turn 1 intake + ${llmFallbacks} mid-call fallback${llmFallbacks > 1 ? 's' : ''}` : 'Turn 1 intake only')}">
        <span class="tc-stat-val">${llmTotal}</span><span class="tc-stat-lbl">LLM Agent</span>
      </div>
      <div class="tc-stat tc-stat-script"><span class="tc-stat-val">${scripts}</span><span class="tc-stat-lbl">Scripts</span></div>
      <div class="tc-stat ${coverageClass}"><span class="tc-stat-val">${coveragePct}%</span><span class="tc-stat-lbl">Coverage</span></div>
      <div class="tc-stat tc-stat-cost" onclick="toggleCostDrawer()" title="${esc(costTooltip)}" style="background:linear-gradient(180deg,#fefce8 0%,#fef3c7 100%);border-left:3px solid #ca8a04;cursor:pointer;" role="button" tabindex="0">
        <span class="tc-stat-val" style="color:#854d0e;">${fmtUsd(costEstTotal)}</span><span class="tc-stat-lbl">Est. Cost ▾</span>
      </div>
    </div>
    ${costDrawerHtml}
    <table class="tc-table">
      <thead>
        <tr><th style="width:60px;">#</th><th style="width:260px;">Source</th><th>Content</th><th style="width:240px;">Fix</th></tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="tc-footnote">
      <strong>🎵 UAP Audio</strong> — pre-cached audio file served directly (fastest, no TTS, no Groq).
      <strong>✅ UAP (text)</strong> — Fixed section content delivered verbatim via TTS (no Groq formatter).
      <strong>🟣 Groq</strong> — KC content reshaped by Groq formatter (latency cost + variability).
      <strong>❌ LLM Agent</strong> — Claude <code>answer-from-kb</code> fallback (Turn 1 intake + mid-call KC misses).
      Turn 1 counts in the LLM AGENT stat (it's a real Claude call) but is excluded from Coverage %.
      <strong>💰 Est. Cost</strong> — Measured per-turn from qaLog:
      Claude <code>$</code> (Phase A.4 + Pass 2b Turn 1 intake), Groq <code>$</code> (Pass 2a real token counts),
      ElevenLabs <code>$</code> (Pass 2c real char counts per TTS call). STT/Twilio not yet logged.
      Hover the cost card for per-category breakdown (<code>$</code> measured · <code>~</code> estimated · <code>±</code> partial).
      Estimates fall back automatically for turns that pre-date the new logging events.
    </div>`;

  return sectionWrap('sec-coverage', '2', 'Turn Coverage',
    `${coveragePct}% covered`, bodyHtml);
}

// Commit 1 — click handler for the Est. Cost drawer
window.toggleCostDrawer = function() {
  const drawer = document.getElementById('tc-cost-drawer');
  if (!drawer) return;
  drawer.style.display = drawer.style.display === 'none' ? 'block' : 'none';
};

// Click handler for collapsed script ranges
window.toggleTcRange = function(rangeId, rowEl) {
  const body = document.querySelector(`[data-range-body="${rangeId}"]`);
  if (!body) return;
  const showing = body.style.display !== 'none';
  body.style.display = showing ? 'none' : '';
  const hint = rowEl.querySelector('.tc-range-hint');
  if (hint) hint.textContent = showing
    ? 'Click to expand individual turns ▸'
    : 'Click to collapse ▾';
};

// ── S3: Vitals ────────────────────────────────────────────────────────────────

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

  return sectionWrap('sec-vitals', '3', 'Call Vitals', `${vitals.metrics.length} metrics`, `
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

  return sectionWrap('sec-protocol', '4', 'Protocol Audit',
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

function renderSectionTurns(turns, companyId, turnFlowMap = {}) {
  const dlActions = `
    <button class="btn-dl btn-dl-json" title="Download turn log as JSON"
      onclick="downloadTurnsJson()">⬇ JSON</button>
    <button class="btn-dl btn-dl-pdf" title="Download turn log as PDF"
      onclick="downloadTurnsPdf()">⬇ PDF</button>`;

  if (!turns?.length) {
    return sectionWrap('sec-turns', '5', 'Turn-by-Turn Log', '0 turns', `
      <div class="empty-state"><p>No transcript turns found for this call.</p></div>`,
      false, dlActions);
  }

  const turnBlocks = turns.map(t => renderTurnBlock(t, companyId, turnFlowMap)).join('');

  return sectionWrap('sec-turns', '5', 'Turn-by-Turn Log',
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

// ── Pipeline outcome → human-readable label ───────────────────────────────
function outcomeLabel(outcome) {
  const map = {
    'TURN1_SIMPLE_GREETING':    'Turn 1 · Greeting',
    'TURN1_RETURNING_CALLER':   'Turn 1 · Returning',
    'TURN1_CALLER_WITH_INTENT': 'Turn 1 · KC Answer',
    'TURN1_DIDNT_UNDERSTAND':   'Turn 1 · Unclear',
    'TURN1_ENGINE':             'Turn 1 Engine',
    'KC_ANSWERED':              'KC Direct',
    'KC_DIRECT_ANSWER':         'KC Direct',
    'KC_BOOKING_INTENT':        'KC → Booking',
    'KC_LLM_FALLBACK':          'LLM Fallback',
    'KC_GRACEFUL_ACK':          'No KC Match',
    'BOOKING_STEP':             'Booking Step',
    'BOOKING_COMPLETE':         'Booking Done',
    'BOOKING_HANDOFF':          'Booking Handoff',
    'BOOKING_KC_DIGRESSION':    'KC (Booking)',
    'TRIGGER_ANSWERED':         'Trigger',
    'INTAKE':                   'Intake',
    'LLM_ANSWERED':             'LLM Answer',
    'STT_EMPTY':                'Silence',
    'GHOST_SKIPPED':            'Ghost Turn',
  };
  return map[outcome] || outcome;
}

function outcomeClass(outcome) {
  if (!outcome) return '';
  if (outcome.startsWith('TURN1_'))   return 'outcome-turn1';
  if (outcome.startsWith('BOOKING_')) return 'outcome-booking';
  if (outcome === 'KC_LLM_FALLBACK' || outcome === 'KC_GRACEFUL_ACK') return 'outcome-fallback';
  if (outcome.startsWith('KC_'))      return 'outcome-kc';
  return 'outcome-other';
}

// ── Phase B: "Why?" panel + "Fix in Gap Page" deep-link ────────────────────────
// Renders per-turn UAP diagnostic detail when the caller turn has a rich qaEntry.
// Shows anchorGate/coreGate (Logic 1/2), semantic best-below-threshold, keyword-rescue
// pre-gate snapshot (uap25/semantic28), and an orange CTA that jumps to todo.html
// with filterContainer/filterSection/filterPhrase pre-applied.
function _renderWhyPanel(qa, companyId) {
  if (!qa || !qa.type) return '';

  const pct = (n, d = 0) => (n == null ? '—' : (n * 100).toFixed(d) + '%');
  const num = (n, d = 2) => (n == null ? '—' : (typeof n === 'number' ? n.toFixed(d) : n));
  const esc2 = esc; // alias for clarity

  // Determine context per event type — nothing to show for simple hits
  const showTypes = new Set([
    'UAP_LAYER1',            // only when hit=false or has anchorGate diagnostic
    'UAP_SEMANTIC_MISS',
    'UAP_MISS_KEYWORD_RESCUED',
    'KC_SECTION_GAP',
    'KC_LLM_FALLBACK'
  ]);
  if (!showTypes.has(qa.type)) return '';
  // UAP_LAYER1 hits with no diagnostic data → nothing interesting to show
  if (qa.type === 'UAP_LAYER1' && qa.hit && !qa.anchorGate && !qa.coreGate) return '';

  // ── Build diagnostic rows ──────────────────────────────────────────────────
  const rows = [];

  // GATE 2.5 — UAP Layer 1 anchor/core detail (from Phase A.1)
  const ag = qa.anchorGate || qa.uap25?.anchorGate;
  const cg = qa.coreGate   || qa.uap25?.coreGate;
  if (ag) {
    const verdict = ag.passed ? '<span style="color:#059669;font-weight:600;">PASS</span>' : '<span style="color:#dc2626;font-weight:600;">FAIL</span>';
    const missedChips = (ag.missed || []).slice(0, 6).map(w => `<span style="background:#fee2e2;color:#991b1b;padding:1px 6px;border-radius:3px;font-size:10px;margin-right:3px;">${esc2(w)}</span>`).join('');
    rows.push(`<div class="pipe-row"><span class="pr-stage">Anchor Gate (2.5 L1)</span><span class="pr-icon">→</span>
      <span class="pr-detail">${verdict} · ratio ${pct(ag.ratio, 0)} (${ag.hits || 0}/${(ag.required?.length || 0)}) threshold ${pct(ag.threshold, 0)}
      ${missedChips ? `<br><span style="font-size:11px;color:var(--tx-secondary);">Missed:</span> ${missedChips}` : ''}
      ${ag.reason ? `<br><span style="font-size:11px;color:#6b7280;font-style:italic;">${esc2(ag.reason)}</span>` : ''}</span></div>`);
  }
  if (cg && cg.ran) {
    const verdict = cg.passed ? '<span style="color:#059669;font-weight:600;">PASS</span>' : '<span style="color:#dc2626;font-weight:600;">FAIL</span>';
    rows.push(`<div class="pipe-row"><span class="pr-stage">Core Embedding (2.5 L2)</span><span class="pr-icon">→</span>
      <span class="pr-detail">${verdict} · score ${num(cg.score)} vs threshold ${num(cg.threshold)}
      ${cg.callerCore ? `<br><span style="font-size:11px;color:#6b7280;">callerCore: "${esc2((cg.callerCore || '').slice(0, 100))}"</span>` : ''}</span></div>`);
  }

  // GATE 2.8 — Semantic best-below-threshold (from Phase A.2)
  const sem = qa.semantic28 || (qa.type === 'UAP_SEMANTIC_MISS' ? qa : null);
  if (sem && (sem.similarity != null || sem.bestBelowThreshold)) {
    const sim = sem.similarity ?? sem.bestBelowThreshold?.similarity;
    const thr = sem.threshold ?? 0.50;
    const bb  = sem.bestBelowThreshold || sem;
    rows.push(`<div class="pipe-row"><span class="pr-stage">Semantic (2.8)</span><span class="pr-icon">→</span>
      <span class="pr-detail"><span style="color:#b45309;font-weight:600;">BELOW</span> · closest ${num(sim, 3)} (threshold ${num(thr, 2)})
      ${bb.containerTitle ? `<br><span style="font-size:11px;color:#6b7280;">closest container: <strong>${esc2(bb.containerTitle)}</strong>${bb.sectionLabel ? ` → ${esc2(bb.sectionLabel)}` : ''}</span>` : ''}
      ${bb.matchedPhrase ? `<br><span style="font-size:11px;color:#6b7280;font-style:italic;">"${esc2((bb.matchedPhrase || '').slice(0, 100))}"</span>` : ''}</span></div>`);
  }

  // GATE 3 — Keyword rescue (when UAP_MISS_KEYWORD_RESCUED)
  if (qa.type === 'UAP_MISS_KEYWORD_RESCUED') {
    rows.push(`<div class="pipe-row"><span class="pr-stage">Keyword Rescue (3)</span><span class="pr-icon">→</span>
      <span class="pr-detail"><span style="color:#059669;font-weight:600;">RESCUED</span> · score ${num(qa.rescuedScore)}
      ${qa.rescuedContainerTitle ? `<br><span style="font-size:11px;color:#6b7280;">→ <strong>${esc2(qa.rescuedContainerTitle)}</strong>${qa.rescuedSection ? ` · ${esc2(qa.rescuedSection)}` : ''}</span>` : ''}
      <br><span style="font-size:11px;color:#b45309;font-weight:500;">\u26a0 UAP should have caught this — add phrase to container to avoid keyword fallback.</span></span></div>`);
  }

  // GATE 4 — Claude LLM fallback (when KC_LLM_FALLBACK)
  if (qa.type === 'KC_LLM_FALLBACK') {
    const cost = qa.cost;
    rows.push(`<div class="pipe-row"><span class="pr-stage">Claude Fallback (4)</span><span class="pr-icon">→</span>
      <span class="pr-detail"><span style="color:#dc2626;font-weight:600;">FIRED</span>
      ${cost?.usd != null ? ` · $${cost.usd.toFixed(4)} (${cost.input || 0}in/${cost.output || 0}out tokens)` : ''}
      ${qa.latencyMs ? ` · ${qa.latencyMs}ms` : ''}
      <br><span style="font-size:11px;color:#b45309;font-weight:500;">\u26a0 No KC matched — create a new section or add callerPhrases to an existing one.</span></span></div>`);
  }

  // KC_SECTION_GAP (container matched, no section)
  if (qa.type === 'KC_SECTION_GAP') {
    rows.push(`<div class="pipe-row"><span class="pr-stage">Section Gap</span><span class="pr-icon">→</span>
      <span class="pr-detail"><span style="color:#ea580c;font-weight:600;">CONTAINER MATCHED, NO SECTION</span>
      ${qa.containerTitle ? `<br><span style="font-size:11px;color:#6b7280;">Container: <strong>${esc2(qa.containerTitle)}</strong></span>` : ''}
      <br><span style="font-size:11px;color:#b45309;font-weight:500;">\u26a0 Add a section to this container covering this symptom.</span></span></div>`);
  }

  if (!rows.length) return '';

  // ── Fix in Gap Page deep-link ──────────────────────────────────────────────
  // Priority: rescuedContainerId > containerId > nothing
  const filterContainer = qa.rescuedContainerId || qa.containerId || qa.rescuedKcId || qa.kcId || null;
  const filterSection   = qa.rescuedSection   || qa.sectionLabel || null;
  const filterPhrase    = qa.question || null;
  const gapParams = new URLSearchParams();
  if (companyId)        gapParams.set('companyId', companyId);
  if (filterContainer)  gapParams.set('filterContainer', filterContainer);
  if (filterSection)    gapParams.set('filterSection', filterSection);
  if (filterPhrase)     gapParams.set('filterPhrase', (filterPhrase || '').slice(0, 200));
  const gapUrl = `/agent-console/todo.html?${gapParams.toString()}`;

  return `
    <div class="td-section" style="background:linear-gradient(180deg,#fff7ed 0%,#fffbeb 100%);border-left:3px solid #f59e0b;border-radius:6px;padding:12px 14px;margin-top:10px;">
      <div class="td-sec-title" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <span style="color:#b45309;">\u2753 Why UAP Missed (Diagnostic)</span>
        <a href="${esc2(gapUrl)}" target="_blank"
           style="display:inline-flex;align-items:center;gap:6px;padding:5px 12px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:5px;font-size:12px;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,0.06);">
           \ud83d\udd27 Fix in Gap Page
        </a>
      </div>
      <div class="pipeline-rows" style="margin-top:8px;">${rows.join('')}</div>
    </div>`;
}

function renderTurnBlock(t, companyId, turnFlowMap = {}) {
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
    const flow = turnFlowMap[t.turnNumber] || null;
    const pathLabel = t.provenancePath || '—';
    // KC card link — shown inline in pipeline trace for instant click-through
    const kcEditUrl  = t.kcCard ? `/agent-console/services-item.html?companyId=${encodeURIComponent(companyId)}&itemId=${encodeURIComponent(t.kcCard._id)}` : null;
    const kcIdLabel  = t.kcCard ? (t.kcCard.sectionId || t.kcCard.kcId || t.kcCard._id) : null;
    const kcCardRow  = kcEditUrl
      ? `<div class="pipe-row">
           <span class="pr-stage">KC Section</span>
           <span class="pr-icon">→</span>
           <span class="pr-detail">
             <a href="${esc(kcEditUrl)}" target="_blank"
                style="font-family:monospace;font-size:11px;background:#eff6ff;color:#1d4ed8;padding:1px 7px;border-radius:4px;border:1px solid #bfdbfe;text-decoration:none;font-weight:600;"
                title="Open KC card: ${esc(t.kcCard.title || kcIdLabel)}">${esc(kcIdLabel)}</a>
             ${t.kcCard.title ? `<span style="margin-left:6px;color:var(--tx-secondary);font-size:11px;">${esc(t.kcCard.title)}</span>` : ''}
           </span>
         </div>`
      : '';

    // ── Build enhanced pipeline rows ─────────────────────────────────────
    let pipeRows = '';

    // Turn outcome badge (top of trace)
    if (flow?.turnOutcome) {
      pipeRows += `<div class="pipe-row"><span class="pr-stage" style="font-weight:700;">Outcome</span><span class="pr-icon">→</span>
        <span class="pr-detail"><span class="outcome-badge ${outcomeClass(flow.turnOutcome)}">${esc(outcomeLabel(flow.turnOutcome))}</span></span></div>`;
    }

    // Turn1Engine details (turn 1 only)
    if (flow?.turn1Engine) {
      const t1 = flow.turn1Engine;
      pipeRows += `<div class="pipe-row"><span class="pr-stage">T1 Lane</span><span class="pr-icon">→</span>
        <span class="pr-detail"><code>${esc(t1.lane || '—')}</code></span></div>`;
      if (t1.callerName) {
        pipeRows += `<div class="pipe-row"><span class="pr-stage">Caller Name</span><span class="pr-icon">→</span>
          <span class="pr-detail">${esc(t1.callerName)}</span></div>`;
      }
      if (t1.prefix) {
        pipeRows += `<div class="pipe-row"><span class="pr-stage">T1 Prefix</span><span class="pr-icon">→</span>
          <span class="pr-detail" style="font-style:italic;">"${esc(t1.prefix)}"</span></div>`;
      }
      if (t1.uapConfidence != null) {
        pipeRows += `<div class="pipe-row"><span class="pr-stage">UAP Confidence</span><span class="pr-icon">→</span>
          <span class="pr-detail">${(t1.uapConfidence * 100).toFixed(0)}%</span></div>`;
      }
      if (t1.isKnown) {
        pipeRows += `<div class="pipe-row"><span class="pr-stage">Known Caller</span><span class="pr-icon">→</span>
          <span class="pr-detail">✓ Yes</span></div>`;
      }
    }

    // Discovery Wire path
    if (flow?.discoveryWirePath) {
      pipeRows += `<div class="pipe-row"><span class="pr-stage">Wire Path</span><span class="pr-icon">→</span>
        <span class="pr-detail"><code>${esc(flow.discoveryWirePath)}</code></span></div>`;
    }

    // KC Engine details (container + section + path)
    if (flow?.kcEngine) {
      const kce = flow.kcEngine;
      if (kce.path) {
        pipeRows += `<div class="pipe-row"><span class="pr-stage">KC Path</span><span class="pr-icon">→</span>
          <span class="pr-detail"><code>${esc(kce.path)}</code></span></div>`;
      }
      if (kce.containerTitle) {
        pipeRows += `<div class="pipe-row"><span class="pr-stage">Container</span><span class="pr-icon">→</span>
          <span class="pr-detail">${kce.kcId ? `<code>${esc(kce.kcId)}</code> · ` : ''}${esc(kce.containerTitle)}</span></div>`;
      }
      if (kce.sectionIdx != null) {
        pipeRows += `<div class="pipe-row"><span class="pr-stage">Section</span><span class="pr-icon">→</span>
          <span class="pr-detail">#${kce.sectionIdx}${kce.sectionId ? ` · <code>${esc(kce.sectionId)}</code>` : ''}</span></div>`;
      }
      if (kce.matchScore != null) {
        pipeRows += `<div class="pipe-row"><span class="pr-stage">Match Score</span><span class="pr-icon">→</span>
          <span class="pr-detail">${typeof kce.matchScore === 'number' ? kce.matchScore.toFixed(2) : kce.matchScore}</span></div>`;
      }
      if (kce.groqIntent) {
        pipeRows += `<div class="pipe-row"><span class="pr-stage">Groq Intent</span><span class="pr-icon">→</span>
          <span class="pr-detail">${esc(kce.groqIntent)}</span></div>`;
      }
      if (kce.groqLatencyMs) {
        pipeRows += `<div class="pipe-row"><span class="pr-stage">Groq Latency</span><span class="pr-icon">→</span>
          <span class="pr-detail">${kce.groqLatencyMs}ms</span></div>`;
      }
      // LLM fallback diagnostics
      if (kce.llmFallback) {
        pipeRows += `<div class="pipe-row"><span class="pr-stage" style="color:#b45309;">Fallback Reason</span><span class="pr-icon">→</span>
          <span class="pr-detail" style="color:#b45309;">${esc(kce.llmFallbackReason || '—')}</span></div>`;
        if (kce.containerCount != null) {
          pipeRows += `<div class="pipe-row"><span class="pr-stage">Containers Searched</span><span class="pr-icon">→</span>
            <span class="pr-detail">${kce.containerCount}${kce.containerTitles?.length ? ' (' + kce.containerTitles.map(t2 => esc(t2)).join(', ') + ')' : ''}</span></div>`;
        }
      }
      // Graceful ACK flag
      if (kce.gracefulAck) {
        pipeRows += `<div class="pipe-row"><span class="pr-stage" style="color:#dc2626;">Graceful ACK</span><span class="pr-icon">→</span>
          <span class="pr-detail" style="color:#dc2626;">All AI paths exhausted — canned response</span></div>`;
      }
    }

    // Agent response (what the agent actually said)
    if (flow?.agentResponse?.text) {
      const respText = flow.agentResponse.text.length > 200
        ? flow.agentResponse.text.substring(0, 200) + '…'
        : flow.agentResponse.text;
      pipeRows += `<div class="pipe-row"><span class="pr-stage" style="font-weight:600;">Agent Said</span><span class="pr-icon">→</span>
        <span class="pr-detail" style="font-style:italic;color:#1e293b;">"${esc(respText)}"</span></div>`;
      if (flow.agentResponse.source) {
        pipeRows += `<div class="pipe-row"><span class="pr-stage">Response Source</span><span class="pr-icon">→</span>
          <span class="pr-detail">${esc(flow.agentResponse.source)}</span></div>`;
      }
    }

    // Section trail
    if (flow?.sectionTrail) {
      pipeRows += `<div class="pipe-row"><span class="pr-stage">Section Trail</span><span class="pr-icon">→</span>
        <span class="pr-detail">${esc(flow.sectionTrail)}</span></div>`;
    }

    // Fallback: legacy fields from convTurns (for old calls without rich trace)
    if (!flow) {
      pipeRows += `
        <div class="pipe-row"><span class="pr-stage">Provenance</span><span class="pr-icon">→</span><span class="pr-detail">${esc(provLabel)}</span></div>
        <div class="pipe-row"><span class="pr-stage">Path</span><span class="pr-icon">→</span><span class="pr-detail">${esc(pathLabel)}</span></div>
        ${kcCardRow}
        ${t.kind ? `<div class="pipe-row"><span class="pr-stage">Kind</span><span class="pr-icon">→</span><span class="pr-detail">${esc(t.kind)}</span></div>` : ''}
        ${t.intent ? `<div class="pipe-row"><span class="pr-stage">Detected intent</span><span class="pr-icon">→</span><span class="pr-detail">${esc(t.intent)}</span></div>` : ''}
        ${t.score  ? `<div class="pipe-row"><span class="pr-stage">KC match score</span><span class="pr-icon">→</span><span class="pr-detail">${t.score.toFixed(2)}</span></div>` : ''}
        ${t.latencyMs ? `<div class="pipe-row"><span class="pr-stage">Response latency</span><span class="pr-icon">→</span><span class="pr-detail">${t.latencyMs}ms</span></div>` : ''}
        ${t.sourceKey  ? `<div class="pipe-row"><span class="pr-stage">Source key</span><span class="pr-icon">→</span><span class="pr-detail">${esc(t.sourceKey)}</span></div>` : ''}
      `;
    }

    // Always show turn number
    pipeRows += `<div class="pipe-row"><span class="pr-stage">DB turn #</span><span class="pr-icon">→</span><span class="pr-detail">${t.turnNumber ?? '—'}</span></div>`;

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
          <div class="kb-id">${esc(t.kcCard.sectionId || t.kcCard.kcId || t.kcCard._id)}</div>
          <div class="kb-title">${esc(t.kcCard.title || 'Untitled')}</div>
          <div class="kb-meta">
            ${t.kcCard.sectionId ? `<span style="font-family:monospace;font-size:10px;background:#f3f4f6;color:#6b7280;padding:1px 5px;border-radius:3px;">Section ${(t.kcCard.sectionIdx ?? -1) + 1}</span>` : ''}
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
    const _qa = t.qaEntry;
    const _isGap = _qa.type === 'KC_SECTION_GAP';
    let _gapFilterLine = '';
    if (_isGap && _qa.gapFiltered && _qa.gapTopSections?.length) {
      const _secNames = _qa.gapTopSections.map(s => `${esc(s.label)} (${s.score})`).join(', ');
      _gapFilterLine = `
          <div class="delta-row">
            <span class="dr-key" style="color:#f59e0b;">FILTER</span>
            <span class="dr-val">${_qa.gapOriginalCount} sections &rarr; ${_qa.gapFilteredCount} sent to Groq: ${_secNames}</span>
          </div>`;
    } else if (_isGap && _qa.gapOriginalCount) {
      _gapFilterLine = `
          <div class="delta-row">
            <span class="dr-key" style="color:#f59e0b;">FILTER</span>
            <span class="dr-val">${_qa.gapOriginalCount} sections (no filter — all sent to Groq)</span>
          </div>`;
    }
    discoveryHtml = `
      <div class="td-section">
        <div class="td-sec-title">Discovery Delta</div>
        <div class="delta-rows">
          <div class="delta-row">
            <span class="dr-key ${_isGap ? '' : 'added'}" style="${_isGap ? 'color:#ef4444;' : ''}">${_isGap ? 'GAP' : '+ qaLog'}</span>
            <span class="dr-val">${_isGap && _qa.containerTitle
              ? `${esc(_qa.containerTitle)} (${esc(_qa.kcId || '')}) — no section matched`
              : `${esc(_qa.question || '')}: "${esc(_qa.answer || '')}"`}</span>
          </div>${_gapFilterLine}
        </div>
      </div>`;
  }

  // 5) Why UAP Missed panel (Phase B — caller turns with rich qaEntry only)
  const whyHtml = isCaller && t.qaEntry ? _renderWhyPanel(t.qaEntry, companyId) : '';

  // 6) Compliance flags
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
        ${whyHtml}
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
        <td><span class="kc-id-chip">${esc(m.sectionId || m.kcId || m.mongoId)}</span></td>
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

  return sectionWrap('sec-kc', '6', 'KC Performance', matchedBadge, `
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

  return sectionWrap('sec-latency', '7', 'Latency Profile', lat.avgFormatted, `
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
    return sectionWrap('sec-entities', '8', 'Entity Timeline', 'No data', `
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

  return sectionWrap('sec-entities', '8', 'Entity Timeline', badge, `
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

  return sectionWrap('sec-issues', '9', 'Issues & Actions', badge, `
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
