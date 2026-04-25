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

// ─── CUE GAP ANALYSIS ─────────────────────────────────────────────────────────
// One ACTUAL card (green, rendered at paint time) + one GROQ card (amber,
// on-demand). GROQ card merges all signals into a single 8-field grid where
// each cell shows ALL unique values across signals, comma-separated.
// Phrase match tests every unique extracted value in parallel.
const _cueGapUtterances = new Map(); // turnNum → caller utterance
const _cueGapMerged     = new Map(); // turnNum → merged {field→[values]}

const _CUE_FIELDS = [
  ['REQUEST',    'requestCue'],
  ['PERMISSION', 'permissionCue'],
  ['INFO',       'infoCue'],
  ['DIRECTIVE',  'directiveCue'],
  ['ACTION',     'actionCore'],
  ['URGENCY',    'urgencyCore'],
  ['MODIFIER',   'modifierCore'],
  ['TRADE',      'tradeMatches']
];

// Merge N signal cueFrames into one {field → unique-values[]}
function _mergeCueFrames(candidates) {
  const merged = {};
  for (const [, key] of _CUE_FIELDS) merged[key] = [];
  for (const c of candidates) {
    const cf = c.cueFrame || {};
    for (const [, key] of _CUE_FIELDS) {
      if (key === 'tradeMatches') {
        const terms = (Array.isArray(cf.tradeMatches) ? cf.tradeMatches : [])
          .map(t => t?.term).filter(Boolean);
        for (const t of terms) {
          if (!merged[key].includes(t)) merged[key].push(t);
        }
      } else if (cf[key] && String(cf[key]).trim()) {
        const v = String(cf[key]).trim();
        if (!merged[key].includes(v)) merged[key].push(v);
      }
    }
  }
  return merged;
}

// Collect every unique text value across all fields for phrase matching
function _allPhraseValues(merged) {
  const vals = new Set();
  for (const [, key] of _CUE_FIELDS) {
    for (const v of (merged[key] || [])) vals.add(v.toLowerCase().trim());
  }
  return [...vals].filter(v => v.length >= 3);
}

async function runCueGapAnalysis(btn, turnNum) {
  const utterance = _cueGapUtterances.get(turnNum);
  if (!utterance) return;

  const companyId = state.companyId;
  const callSid   = state.currentCallSid;
  const container = document.getElementById(`cue-gap-${turnNum}`);
  if (!container) return;

  btn.disabled = true;
  btn.textContent = 'Analyzing…';
  container.innerHTML = `<div style="font-size:11px;color:#6b7280;padding:4px 0;font-style:italic;">Asking Groq…</div>`;

  try {
    const data = await apiFetch(
      `/api/call-intelligence/company/${companyId}/cue-gap`,
      { method: 'POST', body: JSON.stringify({ utterance, callSid, turnNumber: turnNum }) }
    );

    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    if (!candidates.length) {
      container.innerHTML = `<div style="font-size:11px;color:#991b1b;padding:4px 0;">No signals returned.</div>`;
      btn.disabled = false; btn.textContent = 'Retry →';
      return;
    }

    const merged = _mergeCueFrames(candidates);
    _cueGapMerged.set(turnNum, merged);

    // Build the merged GROQ 8-field grid
    const cellBase = 'padding:4px 6px;border-radius:3px;font-size:11px;line-height:1.3;min-height:36px;display:flex;flex-direction:column;justify-content:center;';
    const cells = _CUE_FIELDS.map(([label, key]) => {
      const vals = merged[key] || [];
      if (vals.length) {
        const display = vals.join(', ');
        return `<div style="${cellBase}background:#fef3c7;border:1px solid #fbbf24;">
          <div style="font-weight:700;color:#92400e;font-size:10px;letter-spacing:0.4px;">${label}</div>
          <div style="color:#78350f;font-weight:600;margin-top:1px;font-size:11px;">${esc(display.slice(0, 60))}${display.length > 60 ? '…' : ''}</div>
        </div>`;
      }
      return `<div style="${cellBase}background:#fafafa;border:1px dashed #e5e7eb;">
        <div style="font-weight:700;color:#d1d5db;font-size:10px;letter-spacing:0.4px;">${label}</div>
        <div style="color:#e5e7eb;font-style:italic;margin-top:1px;">—</div>
      </div>`;
    }).join('');

    // Simulated GATE 2.4 from merged Groq values
    const _mTrade  = (merged.tradeMatches || []).length;
    const _mNonTrade = _CUE_FIELDS
      .filter(([,k]) => k !== 'tradeMatches')
      .filter(([,k]) => (merged[k] || []).length > 0).length;
    const _mFc     = _mNonTrade + (_mTrade > 0 ? 1 : 0);  // fieldCount sim
    const _mHasTrade = _mTrade > 0;
    const _mBypass = _mFc === 2 && _mHasTrade &&
                     !!(merged.modifierCore?.length || merged.actionCore?.length || merged.urgencyCore?.length);
    const _mPass   = (_mFc >= 3 && _mHasTrade) || _mBypass;
    let simGate24Html;
    if (_mPass) {
      const bNote = _mBypass ? ' <span style="color:#059669;">(narrative bypass)</span>' : '';
      simGate24Html = `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700;background:#dcfce7;color:#166534;border:1px solid #86efac;">GATE 2.4 PASS</span>
        <span style="font-size:11px;color:#374151;margin-left:4px;">${_mFc}/8 fields · trade hit → would route via CueExtractor${bNote}</span>`;
    } else if (_mFc > 0) {
      const missing = 3 - _mFc;
      const bNote = _mHasTrade && _mFc === 2
        ? ' · has trade but needs modifier/action/urgency for bypass'
        : !_mHasTrade ? ' · no trade hit' : '';
      simGate24Html = `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;">GATE 2.4 FAIL</span>
        <span style="font-size:11px;color:#374151;margin-left:4px;">${_mFc}/8 fields · needs ${missing} more${bNote} → would fall to UAP phrase index</span>`;
    } else {
      simGate24Html = `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700;background:#f3f4f6;color:#6b7280;border:1px solid #e5e7eb;">GATE 2.4 SKIP</span>
        <span style="font-size:11px;color:#9ca3af;margin-left:4px;">0 fields extracted</span>`;
    }
    const simGateLine = `<div style="margin-bottom:6px;line-height:1.5;">${simGate24Html}</div>`;

    const matchResultId  = `cue-match-result-${turnNum}`;
    const patternPanelId = `cue-pattern-panel-${turnNum}`;

    container.innerHTML = `<div style="margin-top:6px;padding-top:5px;border-top:1px dashed #e5e7eb;">
      <div style="font-size:10px;color:#92400e;font-weight:700;margin-bottom:4px;">🤖 GROQ — all signals merged</div>
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:3px;margin-bottom:4px;">${cells}</div>
      ${simGateLine}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
        <button onclick="runAllPhraseMatches(${turnNum})"
          style="font-size:12px;padding:3px 12px;border-radius:4px;background:#1e40af;color:#fff;border:none;cursor:pointer;font-weight:600;">
          ⚡ Match all values →
        </button>
        <button onclick="toggleMergedPatternPanel(${turnNum})"
          style="font-size:12px;padding:3px 12px;border-radius:4px;background:#059669;color:#fff;border:none;cursor:pointer;font-weight:600;">
          ＋ Add patterns
        </button>
      </div>
      <div id="${matchResultId}"></div>
      <div id="${patternPanelId}" style="display:none;"></div>
    </div>`;

    btn.style.display = 'none';
  } catch (err) {
    container.innerHTML = `<div style="font-size:11px;color:#991b1b;padding:4px 0;">Gap analysis failed: ${err.message}</div>`;
    btn.disabled = false;
    btn.textContent = 'Retry →';
  }
}

async function runAllPhraseMatches(turnNum) {
  const merged  = _cueGapMerged.get(turnNum);
  const resultEl = document.getElementById(`cue-match-result-${turnNum}`);
  if (!merged || !resultEl) return;

  const values = _allPhraseValues(merged);
  if (!values.length) {
    resultEl.innerHTML = `<div style="font-size:11px;color:#6b7280;">No values to match.</div>`;
    return;
  }

  resultEl.innerHTML = `<div style="font-size:11px;color:#6b7280;font-style:italic;">Embedding &amp; matching ${values.length} values against KC phrase index… (5-10s)</div>`;

  const results = await Promise.all(
    values.map(phrase =>
      apiFetch(`/api/call-intelligence/company/${state.companyId}/cue-phrase-match`,
        { method: 'POST', body: JSON.stringify({ phrase }) })
        .then(d => ({ phrase, ...d }))
        .catch(e => ({ phrase, matched: false, topMatches: [], error: e.message }))
    )
  );

  const companyId = state.companyId;

  const TIER_STYLE = {
    '90%+': 'background:#dcfce7;color:#166534;border:1px solid #86efac;',
    '80%+': 'background:#fef9c3;color:#713f12;border:1px solid #fde047;',
    '70%+': 'background:#ffedd5;color:#9a3412;border:1px solid #fdba74;',
  };

  const cards = results.map(r => {
    const topMatches = Array.isArray(r.topMatches) ? r.topMatches : [];
    const pfUrl = `/agent-console/services.html?companyId=${encodeURIComponent(companyId)}&openPf=${encodeURIComponent(r.phrase)}`;

    // Header row — phrase + UAP match badge
    const uapBadge = r.matched
      ? `<span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;background:#1e3a8a;color:#fff;margin-left:6px;">UAP HIT · ${r.containerTitle || ''} · ${r.matchType || ''}</span>`
      : `<span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;margin-left:6px;">NOT IN DICTIONARY</span>`;

    // Top-3 tier rows
    const tierRows = topMatches.slice(0, 3).map(m => {
      const tierStyle = TIER_STYLE[m.tier] || TIER_STYLE['70%+'];
      const pct = Math.round(m.score * 100);
      const kcUrl = `/agent-console/services.html?companyId=${encodeURIComponent(companyId)}&section=${encodeURIComponent(m.sectionKcId || '')}`;
      return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #f3f4f6;">
        <span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;white-space:nowrap;${tierStyle}">${pct}%</span>
        <span style="font-size:11px;color:#374151;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          <strong>${esc(m.containerName)}</strong>
          <span style="color:#6b7280;"> · ${esc(m.sectionLabel)}</span>
          ${m.sectionKcId ? `<span style="color:#9ca3af;font-size:10px;margin-left:4px;">[${esc(m.sectionKcId)}]</span>` : ''}
        </span>
        <span style="font-size:10px;color:#9ca3af;white-space:nowrap;flex-shrink:0;">
          "${esc((m.phraseText || '').slice(0, 30))}${(m.phraseText || '').length > 30 ? '…' : ''}"
        </span>
        <a href="${kcUrl}" target="_blank" style="font-size:10px;color:#6b7280;text-decoration:underline;white-space:nowrap;flex-shrink:0;">Edit ↗</a>
      </div>`;
    }).join('');

    const noHitsNote = !topMatches.length
      ? `<div style="font-size:11px;color:#9ca3af;padding:3px 0;font-style:italic;">No phrase matches ≥70% — <a href="${pfUrl}" target="_blank" style="color:#991b1b;">Add to dictionary ↗</a></div>`
      : '';

    return `<div style="border:1px solid #e5e7eb;border-radius:5px;padding:6px 8px;margin-bottom:6px;">
      <div style="font-size:12px;font-weight:700;color:#111827;margin-bottom:4px;">
        "${esc(r.phrase)}"${uapBadge}
      </div>
      ${tierRows}${noHitsNote}
    </div>`;
  }).join('');

  // Combined phrase match — join all unique values into one phrase → simulate routing
  const combinedPhrase = values.join(' ');
  const combinedEl = `<div id="cue-combined-${turnNum}" style="margin-top:6px;padding:6px 8px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:5px;">
    <div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:4px;">
      🔗 Combined phrase match — all values as one utterance
    </div>
    <div style="font-size:11px;font-family:monospace;color:#6b7280;margin-bottom:6px;">"${esc(combinedPhrase)}"</div>
    <div id="cue-combined-result-${turnNum}" style="font-size:11px;color:#6b7280;font-style:italic;">Running…</div>
  </div>`;

  resultEl.innerHTML = `
    <div style="margin-top:4px;">
      <div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:6px;">
        ⚡ Phrase matches — top 3 per value (edit section to modify phrases or add negative keywords)
      </div>
      ${cards}
      <div style="font-size:10px;color:#9ca3af;margin-top:2px;margin-bottom:6px;font-style:italic;">
        Score = cosine similarity between input and existing KC caller phrases · UAP HIT = live route taken
      </div>
      ${combinedEl}
    </div>`;

  // Auto-expand the Add patterns panel
  _renderAddPatternsContent(turnNum);
  const panelEl = document.getElementById(`cue-pattern-panel-${turnNum}`);
  if (panelEl) panelEl.style.display = 'block';

  // Run combined phrase match async
  apiFetch(`/api/call-intelligence/company/${state.companyId}/cue-phrase-match`,
    { method: 'POST', body: JSON.stringify({ phrase: combinedPhrase }) })
    .then(d => {
      const el = document.getElementById(`cue-combined-result-${turnNum}`);
      if (!el) return;
      if (d.matched) {
        const conf = d.confidence != null ? ` · ${(d.confidence * 100).toFixed(0)}%` : '';
        el.innerHTML = `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;background:#1e3a8a;color:#fff;">UAP HIT</span>
          <span style="margin-left:6px;color:#111827;font-weight:600;">${esc(d.containerTitle || '')}</span>
          <span style="color:#6b7280;margin-left:4px;">${esc(d.matchType || '')}${conf}</span>
          <span style="color:#9ca3af;font-size:10px;margin-left:6px;">— combined phrase would route correctly</span>`;
      } else {
        el.innerHTML = `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;">NO ROUTE</span>
          <span style="color:#6b7280;margin-left:6px;font-size:11px;">combined phrase not found in KC — phrases need to be added to dictionary</span>`;
      }
    })
    .catch(() => {
      const el = document.getElementById(`cue-combined-result-${turnNum}`);
      if (el) el.textContent = 'Combined match failed.';
    });
}

function _renderAddPatternsContent(turnNum) {
  const panelEl = document.getElementById(`cue-pattern-panel-${turnNum}`);
  if (!panelEl) return;
  const merged = _cueGapMerged.get(turnNum);
  if (!merged) return;

  const tokenLabels = {
    requestCue: 'REQUEST', permissionCue: 'PERMISSION', infoCue: 'INFO',
    directiveCue: 'DIRECTIVE', actionCore: 'ACTION', urgencyCore: 'URGENCY', modifierCore: 'MODIFIER'
  };

  const rows = Object.entries(tokenLabels).map(([token, label]) => {
    const vals = merged[token] || [];
    if (!vals.length) return '';
    return vals.map((v, vi) => {
      const inputId  = `cue-pi-${turnNum}-${token}-${vi}`;
      const statusId = `cue-ps-${turnNum}-${token}-${vi}`;
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap;">
        <span style="font-size:11px;font-weight:700;color:#374151;width:80px;flex-shrink:0;">${label}</span>
        <input id="${inputId}" type="text" value="${v.replace(/"/g, '&quot;')}"
          style="flex:1;min-width:140px;font-size:12px;padding:3px 7px;border:1px solid #d1d5db;border-radius:4px;font-family:monospace;" />
        <button onclick="saveCuePattern('${inputId}','${token}','${statusId}')"
          style="font-size:11px;padding:2px 10px;border-radius:4px;background:#059669;color:#fff;border:none;cursor:pointer;font-weight:600;">
          Save
        </button>
        <span id="${statusId}" style="font-size:11px;"></span>
      </div>`;
    }).join('');
  }).filter(Boolean).join('');

  panelEl.innerHTML = `<div style="margin-top:6px;padding:8px 10px;background:#f0fdf4;border:1px solid #86efac;border-radius:5px;">
    <div style="font-size:12px;font-weight:700;color:#166534;margin-bottom:6px;">＋ Add to GlobalShare cuePhrases</div>
    ${rows || '<div style="font-size:11px;color:#6b7280;">No text values to add.</div>'}
  </div>`;
}

function toggleMergedPatternPanel(turnNum) {
  const panelEl = document.getElementById(`cue-pattern-panel-${turnNum}`);
  if (!panelEl) return;
  if (panelEl.style.display !== 'none') { panelEl.style.display = 'none'; return; }
  _renderAddPatternsContent(turnNum);
  panelEl.style.display = 'block';
}

async function saveCuePattern(inputId, token, statusId) {
  const inputEl  = document.getElementById(inputId);
  const statusEl = document.getElementById(statusId);
  if (!inputEl || !statusEl) return;

  const pattern = inputEl.value.trim().toLowerCase();
  if (!pattern) { statusEl.textContent = '⚠ empty'; statusEl.style.color = '#d97706'; return; }

  statusEl.textContent = 'Saving…';
  statusEl.style.color = '#6b7280';

  try {
    const _tok = localStorage.getItem('adminToken') || localStorage.getItem('token') || sessionStorage.getItem('token') || '';
    const _authHdr = _tok ? { 'Authorization': `Bearer ${_tok}` } : {};

    // 1. Load current cuePhrases
    const piData = await fetch('/api/admin/globalshare/phrase-intelligence', { headers: _authHdr })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
    const cuePhrases = Array.isArray(piData.cuePhrases) ? piData.cuePhrases : [];

    // 2. Duplicate check
    const exists = cuePhrases.some(c =>
      (c.pattern || '').toLowerCase() === pattern && c.token === token
    );
    if (exists) {
      statusEl.textContent = '✓ already exists';
      statusEl.style.color = '#6b7280';
      return;
    }

    // 3. Append and save
    cuePhrases.push({ pattern, token });
    const saveRes = await fetch('/api/admin/globalshare/phrase-intelligence/cuePhrases', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ..._authHdr },
      body: JSON.stringify({ data: cuePhrases })
    });
    if (!saveRes.ok) throw new Error(`HTTP ${saveRes.status}`);

    statusEl.textContent = '✓ saved';
    statusEl.style.color = '#059669';
    inputEl.style.background = '#f0fdf4';
  } catch (err) {
    statusEl.textContent = `✗ ${err.message}`;
    statusEl.style.color = '#991b1b';
  }
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

  // Apr 22, 2026 — Sentinels for "request failed" vs "request returned nothing".
  // Previously we swallowed fetch errors with a default empty payload, which
  // caused the dashboard to briefly wipe the list every time a background poll
  // encountered a transient network blip. Now the `.catch` returns a distinct
  // failure object and we preserve prior render state until the next good poll.
  try {
    const [statsData, listData] = await Promise.all([
      apiFetch(`/api/call-intelligence/company/${state.companyId}/stats?timeRange=${state.filterTime}`).catch(err => ({ __failed: true, error: err.message })),
      apiFetch(`/api/call-intelligence/company/${state.companyId}/list?${params}`).catch(err => ({ __failed: true, error: err.message }))
    ]);

    if (statsData && !statsData.__failed) {
      renderStats(statsData);
    }
    if (listData && !listData.__failed) {
      renderCallsList(listData);
    } else {
      console.warn('[dashboard] list fetch failed, preserving last-good render:', listData?.error);
      _showTransientRefreshError(listData?.error || 'refresh failed');
    }

    _stampLastUpdated();
  } catch (err) {
    console.error('[dashboard]', err);
    renderCallsError(err.message);
  } finally {
    _setRefreshSpinning(false);
  }
}

// Non-destructive: flash a small warning chip next to the "last updated"
// stamp without touching the rendered list/stats. Auto-clears on next success.
function _showTransientRefreshError(msg) {
  const el = document.getElementById('last-updated');
  if (!el) return;
  const prev = el.textContent;
  el.textContent = `\u26a0 ${msg} (showing last-good data)`;
  el.style.color = '#b45309';
  setTimeout(() => {
    if (el.textContent.startsWith('\u26a0')) {
      el.textContent = prev;
      el.style.color = '';
    }
  }, 4000);
}

function renderStats(data) {
  if (!data) return;
  $('sv-today').textContent    = data.todayCount  ?? '—';
  $('sv-week').textContent     = data.weekCount   ?? '—';
  $('sv-critical').textContent = data.critical    ?? '—';
  $('sv-needs').textContent    = data.needsImprovement ?? '—';
  $('sv-good').textContent     = data.performingWell   ?? '—';
  // Apr 22, 2026 — prefer `analyzedCount` (in-range CallIntelligence count).
  // Falls back to `total` for legacy servers that haven't been redeployed yet.
  $('sv-total').textContent    = data.analyzedCount ?? data.total ?? '—';
  if (data.avgCost != null) {
    $('sv-avgcost').textContent = `$${Number(data.avgCost).toFixed(4)}`;
  } else {
    $('sv-avgcost').textContent = '—';
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
    // C6 — which STT pipeline handled this call. Null = legacy / gather.
    sttProvider:     meta.sttProvider || c.sttProvider || null,
  };
}

// C6 — render the STT pipeline pill for the calls table.
// null/unknown → gather (the default historical path).
function renderSttPill(sttProvider) {
  const provider = sttProvider || 'gather';
  const labels = {
    'gather':        { text: 'Gather',  title: 'Twilio <Gather> STT (default)' },
    'media-streams': { text: 'DG N-3',  title: 'Deepgram Nova-3 live (Media Streams)' },
    'mixed':         { text: 'Mixed',   title: 'Started on Media Streams, fell back to Gather mid-call' }
  };
  const cfg = labels[provider] || labels.gather;
  return `<span class="stt-pill stt-${provider}" title="${esc(cfg.title)}">${esc(cfg.text)}</span>`;
}

function renderCallsList({ items = [], total = 0, pages = 1 }) {
  state.totalCalls = total;
  state.totalPages = pages;

  $('call-count').textContent = `${total} call${total !== 1 ? 's' : ''}`;

  const tbody = $('calls-tbody');

  if (!items.length) {
    tbody.innerHTML = `
      <tr><td colspan="11">
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
        <td class="td-stt">${renderSttPill(c.sttProvider)}</td>
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
    <tr><td colspan="11" style="padding:32px; text-align:center; color:var(--c-fail);">
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

// Pair qaLog entries for the same turnNumber. The backend sends qaEntries on
// both the caller and agent row for a given turn (filtered by q.turn), but on
// older call docs the agent row may be empty — fall back to the caller row.
function _pairQaEntries(turns, agentTurn) {
  if (Array.isArray(agentTurn.qaEntries) && agentTurn.qaEntries.length) {
    return agentTurn.qaEntries;
  }
  const paired = turns.find(t =>
    t.turnNumber === agentTurn.turnNumber && t.speaker === 'caller');
  return paired?.qaEntries || [];
}

// Rich 5-line inline UAP summary — rendered directly under every Scripts row.
// Marc's explicit layout (Apr 22, 2026):
//   1) STT       — verbatim caller turn
//   2) UAP grid  — the 8-field cueFrame as a 4x2 visual (matched vs hint)
//   3) Anchors   — required anchor words, match ratio, pass/fail
//   4) Phrase    — winning or closest phrase + confidence + why
//   5) Response  — the agent reply
//
// The full deep-forensics UAP Decision panel still lives in the turn expand.
// Returns HTML (may be empty when there's nothing to show).
function _renderInlineUapSummary(agentTurn, turns) {
  const callerText = _pairCallerText(turns, agentTurn);
  const qaEntries  = _pairQaEntries(turns, agentTurn);
  const responseText = agentTurn.text || '';
  if (!callerText && !qaEntries.length && !responseText) return '';

  // Store utterance for gap analysis button (keyed by agent turn number)
  const turnNum = agentTurn.turnNumber;
  if (callerText && turnNum != null) _cueGapUtterances.set(turnNum, callerText);

  // Decision-carrying entries
  const cueEntry  = qaEntries.find(q => q && q.cueFrame);
  const cf        = cueEntry?.cueFrame || null;
  const layer1    = qaEntries.find(q => q && q.type === 'UAP_LAYER1');
  const semantic  = qaEntries.find(q => q && q.type === 'UAP_SEMANTIC_MISS');
  const gap       = qaEntries.find(q => q && q.type === 'KC_SECTION_GAP');
  const direct    = qaEntries.find(q => q && q.type === 'KC_DIRECT_ANSWER');
  const groq      = qaEntries.find(q => q && q.type === 'KC_GROQ_ANSWERED');
  const llm       = qaEntries.find(q => q && q.type === 'KC_LLM_FALLBACK');
  const gapAns    = qaEntries.find(q => q && q.type === 'KC_SECTION_GAP_ANSWERED');

  // ── LINE 1 — STT (verbatim caller) ─────────────────────────────────────
  const sttLine = callerText
    ? `<div style="margin-top:2px;font-size:11px;color:#374151;line-height:1.45;">
         <span style="color:#9ca3af;font-weight:600;">\ud83d\udc64 STT:</span>
         <em style="color:#1f2937;">"${esc(callerText.slice(0, 260))}${callerText.length > 260 ? '\u2026' : ''}"</em>
       </div>`
    : '';

  // ── LINE 2 — UAP 8-container cueFrame grid ─────────────────────────────
  // 4-column × 2-row visual. Matched cells highlight green with value.
  // Empty cells show dimmed example hints so the pattern is self-teaching.
  const CUE_FIELDS = [
    ['REQUEST',    'requestCue',    'can you, could you, would you'],
    ['PERMISSION', 'permissionCue', 'do i have to, am i allowed, can i'],
    ['INFO',       'infoCue',       'what is, how much, when does'],
    ['DIRECTIVE',  'directiveCue',  'just, please, i need to'],
    ['ACTION',     'actionCore',    'pay, schedule, transfer, book'],
    ['URGENCY',    'urgencyCore',   'today, now, asap, emergency'],
    ['MODIFIER',   'modifierCore',  'for a service call, with plan'],
    ['TRADE',      'tradeMatches',  'HVAC / plumbing / trade vocab']
  ];

  let gridLine = '';
  let driftChip = '';
  if (cf) {
    const cellBase = 'padding:4px 6px;border-radius:4px;font-size:10px;line-height:1.3;min-height:38px;display:flex;flex-direction:column;justify-content:center;';
    const cells = CUE_FIELDS.map(([label, key, hint]) => {
      let val = '';
      if (key === 'tradeMatches') {
        const tm = Array.isArray(cf.tradeMatches) ? cf.tradeMatches : [];
        if (tm.length) {
          const terms = [...new Set(tm.map(t => t && t.term).filter(Boolean))];
          val = terms.slice(0, 3).join(', ') + (tm.length > 3 ? ` +${tm.length - 3}` : '');
        }
      } else {
        val = cf[key] || '';
      }
      const matched = !!val && String(val).trim();
      if (matched) {
        return `<div style="${cellBase}background:#dcfce7;border:1px solid #86efac;">
          <div style="font-weight:700;color:#15803d;font-size:9px;letter-spacing:0.4px;">${label}</div>
          <div style="color:#166534;font-weight:600;margin-top:2px;">${esc(String(val).slice(0, 48))}</div>
        </div>`;
      }
      return `<div style="${cellBase}background:#fafafa;border:1px dashed #e5e7eb;">
        <div style="font-weight:700;color:#9ca3af;font-size:9px;letter-spacing:0.4px;">${label}</div>
        <div style="color:#cbd5e1;font-style:italic;margin-top:2px;">${esc(hint)}</div>
      </div>`;
    }).join('');

    // Topic-drift chip — surfaced in grid header
    const topicCount = Array.isArray(cf.topicWords) ? cf.topicWords.length : 0;
    const tradeCount = Array.isArray(cf.tradeMatches) ? cf.tradeMatches.length : 0;
    if (topicCount === 0 && tradeCount > 5) {
      driftChip = ` <span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;">\u26a0 TOPIC DRIFT</span>`;
    }

    // GATE 2.4 status — computed from actual cueFrame values
    const _fc        = cf.fieldCount ?? 0;
    const _hasTrade  = tradeCount > 0;
    const _bypass    = _fc === 2 && _hasTrade &&
                       !!(cf.modifierCore || cf.actionCore || cf.urgencyCore);
    const _gate24Pass = (_fc >= 3 && _hasTrade) || _bypass;
    let gate24Html;
    if (_gate24Pass) {
      const bypassNote = _bypass ? ' <span style="color:#059669;">(narrative bypass)</span>' : '';
      gate24Html = `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700;background:#dcfce7;color:#166534;border:1px solid #86efac;">GATE 2.4 PASS</span>
        <span style="font-size:11px;color:#374151;margin-left:4px;">${_fc}/8 fields · trade hit → routes to CueExtractor${bypassNote}</span>`;
    } else if (_fc > 0) {
      const missing = 3 - _fc;
      const bypassNote = _hasTrade && _fc === 2
        ? ' · has trade but needs modifier/action/urgency for bypass'
        : !_hasTrade ? ' · no trade hit' : '';
      gate24Html = `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;">GATE 2.4 FAIL</span>
        <span style="font-size:11px;color:#374151;margin-left:4px;">${_fc}/8 fields · needs ${missing} more${bypassNote} → falls to UAP phrase index</span>`;
    } else {
      gate24Html = `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700;background:#f3f4f6;color:#6b7280;border:1px solid #e5e7eb;">GATE 2.4 SKIP</span>
        <span style="font-size:11px;color:#9ca3af;margin-left:4px;">0 fields extracted</span>`;
    }
    const gateLine = `<div style="margin-top:5px;line-height:1.5;">${gate24Html}</div>`;

    // Gap analysis button + Card 2 placeholder
    const gapBtn = callerText && turnNum != null
      ? `<div style="margin-top:6px;">
           <button onclick="runCueGapAnalysis(this, ${turnNum})" style="font-size:11px;padding:2px 10px;border-radius:3px;background:#fef3c7;color:#92400e;border:1px solid #fbbf24;cursor:pointer;font-weight:600;">🔍 Analyze gap →</button>
         </div>
         <div id="cue-gap-${turnNum}"></div>`
      : '';

    gridLine = `<div style="margin-top:5px;">
      <div style="font-size:10px;color:#9ca3af;font-weight:600;margin-bottom:3px;">\ud83e\udded UAP 8-FIELD cueFrame — ACTUAL${driftChip}</div>
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;">${cells}</div>
      ${gateLine}
      ${gapBtn}
    </div>`;
  }

  // ── LINE 3 — Anchors (required match words + ratio) ────────────────────
  let anchorsLine = '';
  if (layer1 && layer1.anchorGate) {
    const ag = layer1.anchorGate;
    const req = Array.isArray(ag.required) ? ag.required : [];
    const hits = ag.hits || 0;
    const total = req.length;
    const ratioS = typeof ag.ratio === 'number' ? `${(ag.ratio * 100).toFixed(0)}%` : '';
    const badge = ag.passed
      ? '<span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;background:#dcfce7;color:#166534;">PASS</span>'
      : '<span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;background:#fee2e2;color:#991b1b;">FAIL</span>';
    const reqList = req.length
      ? req.slice(0, 10).map(w => `<span style="font-family:monospace;color:#374151;">${esc(w)}</span>`).join(', ') + (req.length > 10 ? ` +${req.length - 10}` : '')
      : '<em style="color:#9ca3af;">none</em>';
    anchorsLine = `<div style="margin-top:5px;font-size:11px;color:#374151;line-height:1.45;">
      <span style="color:#9ca3af;font-weight:600;">\u2693 anchors:</span>
      ${badge} <strong>${hits}/${total}</strong>${ratioS ? ` <span style="color:#6b7280;">(${ratioS})</span>` : ''} &mdash; ${reqList}
    </div>`;
  } else if (layer1?.noCandidate) {
    anchorsLine = `<div style="margin-top:5px;font-size:11px;color:#6b7280;line-height:1.45;">
      <span style="color:#9ca3af;font-weight:600;">\u2693 anchors:</span>
      <em>no candidate phrase reached anchor check (${esc(layer1.reason || 'NO_CANDIDATE')})</em>
    </div>`;
  }

  // ── LINE 4 — Phrase match (winning or closest + why) ───────────────────
  const bS = 'display:inline-block;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;margin-right:4px;vertical-align:middle;';
  let phraseLine = '';
  if (layer1?.hit) {
    const conf = layer1.confidence != null ? ` @ ${(layer1.confidence * 100).toFixed(0)}%` : '';
    const mt = esc(layer1.matchType || 'match');
    phraseLine = `<div style="margin-top:4px;font-size:11px;color:#374151;line-height:1.45;">
      <span style="color:#9ca3af;font-weight:600;">\ud83c\udfaf phrase:</span>
      <span style="${bS}background:#dcfce7;color:#166534;">HIT</span>
      <strong>${mt}</strong>${conf}
      ${layer1.phrase ? ` &mdash; <em style="color:#6b7280;">"${esc((layer1.phrase || '').slice(0, 140))}"</em>` : ''}
    </div>`;
  } else if (direct || groq) {
    const w = direct || groq;
    const label = direct ? 'KC DIRECT' : 'KC + GROQ';
    const bg = direct ? '#dcfce7' : '#ede9fe';
    const fg = direct ? '#166534' : '#5b21b6';
    phraseLine = `<div style="margin-top:4px;font-size:11px;color:#374151;line-height:1.45;">
      <span style="color:#9ca3af;font-weight:600;">\ud83c\udfaf phrase:</span>
      <span style="${bS}background:${bg};color:${fg};">${label}</span>
      <strong>${esc(w.containerTitle || '')}</strong>${w.sectionLabel ? ` <span style="color:#6b7280;">· ${esc(w.sectionLabel)}</span>` : ''}
    </div>`;
  } else if (gap || gapAns) {
    const g = gap || gapAns;
    const top = Array.isArray(g?.gapTopSections) ? g.gapTopSections.slice(0, 3) : [];
    const topStr = top.length
      ? top.map(s => `<strong>${esc(s.label || '')}</strong> <span style="color:#9ca3af;">(${(s.score || 0).toFixed(0)})</span>`).join(' · ')
      : '<em style="color:#9ca3af;">no alternates</em>';
    phraseLine = `<div style="margin-top:4px;font-size:11px;color:#374151;line-height:1.45;">
      <span style="color:#9ca3af;font-weight:600;">\ud83c\udfaf phrase:</span>
      <span style="${bS}background:#fed7aa;color:#9a3412;">SECTION GAP</span>
      ${g?.containerTitle ? `container <strong>${esc(g.containerTitle)}</strong> matched, but no section crossed threshold` : 'no section match'}
      <div style="margin-top:2px;color:#6b7280;padding-left:14px;">top sections: ${topStr}</div>
    </div>`;
  } else if (layer1?.belowThreshold) {
    const conf = layer1.confidence != null ? ` ${(layer1.confidence * 100).toFixed(0)}%` : '';
    const thr = layer1.threshold != null ? ` (threshold ${(layer1.threshold * 100).toFixed(0)}%)` : '';
    phraseLine = `<div style="margin-top:4px;font-size:11px;color:#374151;line-height:1.45;">
      <span style="color:#9ca3af;font-weight:600;">\ud83c\udfaf phrase:</span>
      <span style="${bS}background:#fef3c7;color:#92400e;">BELOW THRESHOLD</span>
      closest${conf}${thr}
      ${layer1.phrase ? ` &mdash; <em style="color:#6b7280;">"${esc((layer1.phrase || '').slice(0, 120))}"</em>` : ''}
      ${layer1.fuzzyRecovery ? ` · <span style="color:#b45309;font-weight:600;">fuzzy</span>` : ''}
    </div>`;
  } else if (semantic) {
    const sim = semantic.similarity ?? semantic.bestBelowThreshold?.similarity;
    const bb = semantic.bestBelowThreshold || {};
    phraseLine = `<div style="margin-top:4px;font-size:11px;color:#374151;line-height:1.45;">
      <span style="color:#9ca3af;font-weight:600;">\ud83c\udfaf phrase:</span>
      <span style="${bS}background:#fef3c7;color:#92400e;">SEMANTIC MISS</span>
      closest ${(sim || 0).toFixed(2)}
      ${bb.containerTitle ? ` &mdash; <strong>${esc(bb.containerTitle)}</strong>${bb.sectionLabel ? ` · ${esc(bb.sectionLabel)}` : ''}` : ''}
    </div>`;
  } else if (llm) {
    phraseLine = `<div style="margin-top:4px;font-size:11px;color:#374151;line-height:1.45;">
      <span style="color:#9ca3af;font-weight:600;">\ud83c\udfaf phrase:</span>
      <span style="${bS}background:#fee2e2;color:#991b1b;">LLM FALLBACK</span>
      no KC match &mdash; Claude answered from caller context
    </div>`;
  }

  // ── LINE 5 — Response (agent reply) ────────────────────────────────────
  const responseLine = responseText
    ? `<div style="margin-top:4px;font-size:11px;color:#374151;line-height:1.45;">
         <span style="color:#9ca3af;font-weight:600;">\ud83d\udde3 response:</span>
         <span style="color:#1f2937;">${esc(responseText.slice(0, 260))}${responseText.length > 260 ? '\u2026' : ''}</span>
       </div>`
    : '';

  if (!sttLine && !gridLine && !anchorsLine && !phraseLine && !responseLine) return '';

  return `<div style="margin-top:6px;padding:8px 10px;background:#f9fafb;border-left:2px solid #6366f1;border-radius:3px;">
    ${sttLine}${gridLine}${anchorsLine}${phraseLine}${responseLine}
  </div>`;
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
      // Walk the breakdown[] for per-turn rows + token rollups.
      // `b.rate` (added April 21, 2026) is the per-event rate provenance stamp:
      //   LLM:  { tier, inPerM, outPerM, source: 'company'|'env'|'default' }
      //   TTS:  { tier, perKChars, source }
      // When present, we append it to the row detail so the drawer shows the
      // exact plan/rate that produced this $ — makes per-company overrides
      // visually verifiable at a glance.
      const _rateNote = (r) => {
        if (!r || !r.tier) return '';
        const srcBadge = r.source === 'company' ? ' (company)' : (r.source === 'env' ? ' (env)' : '');
        if (typeof r.inPerM === 'number') return ` · ${r.tier} @ $${r.inPerM}/M in · $${r.outPerM}/M out${srcBadge}`;
        if (typeof r.perKChars === 'number') return ` · ${r.tier} @ $${r.perKChars}/1k${srcBadge}`;
        return ` · ${r.tier}${srcBadge}`;
      };
      if (Array.isArray(qc.breakdown)) {
        for (const b of qc.breakdown) {
          if (b.type === 'claude') {
            claudeCalls++;
            costRows.push({ turn: t.turnNumber, category: 'claude', label: 'Claude', detail: `${b.source || 'fallback'} · ${b.model || 'claude-sonnet-4-5'}${_rateNote(b.rate)}`, usd: b.usd, quality: 'real' });
          } else if (b.type === 'groq') {
            groqCalls++;
            costRows.push({ turn: t.turnNumber, category: 'groq',   label: 'Groq',   detail: `${b.source || 'kc'} · ${b.model || 'llama-3.3-70b'}${_rateNote(b.rate)}`, usd: b.usd, quality: 'real' });
          } else if (b.type === 'elevenlabs') {
            elevenCalls++;
            costRows.push({ turn: t.turnNumber, category: 'elevenlabs', label: 'ElevenLabs TTS', detail: `${b.source || 'tts'} · ${b.chars || '?'} chars${_rateNote(b.rate)}`, usd: b.usd, quality: 'real' });
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
    // Groq estimate — ONLY when classifier says this turn truly routed through Groq
    // AND we have no real Pass 2a qaLog data. The old `kc_hit && !cls.mode` branch
    // was poisoning UAP Audio pre-cached turns (which cost $0 Groq) with phantom $.
    // Also increment groqCalls so the drawer count stays consistent with the money.
    const turnHasRealGroq = qc && qc.groqUsd > 0;
    if (!turnHasRealGroq && cls.mode === 'groq') {
      costGroqEstUsd += RATE_GROQ_PER_TURN_EST;
      costGroqEst    += RATE_GROQ_PER_TURN_EST;
      groqCalls++;
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
        const uapSummary = _renderInlineUapSummary(t, turns);
        return `<tr class="tc-row tc-row-script tc-sub-row">
          <td class="tc-col-num">${t.turnNumber}</td>
          <td class="tc-col-body">
            <div class="tc-body-source" style="display:flex;align-items:flex-start;gap:8px;padding-bottom:6px;border-bottom:1px dashed #e5e7eb;margin-bottom:8px;">
              <span class="tc-icon">${it.cls.icon}</span>
              <div class="tc-src" style="flex:1;">
                <div class="tc-src-lbl" style="font-weight:600;">${esc(it.cls.srcLabel)}</div>
                <div class="tc-src-sub" style="font-size:11px;color:#64748b;">${it.cls.srcSub}</div>
              </div>
            </div>
            <div class="tc-body-content" style="margin-bottom:8px;">
              <div><span class="tc-content-muted">${esc(preview)}${t.text?.length > 100 ? '…' : ''}</span></div>
              ${uapSummary}
            </div>
            <div class="tc-body-fix" style="padding-top:6px;border-top:1px dashed #e5e7eb;font-size:12px;">
              <span style="font-size:10px;color:#9ca3af;font-weight:600;margin-right:6px;">FIX</span>${it.cls.fixHtml}
            </div>
          </td>
        </tr>`;
      }).join('');
      const rangeId = `tc-range-${entryIdx}`;
      return `<tr class="tc-row tc-row-range" data-range="${rangeId}" onclick="toggleTcRange('${rangeId}', this)">
        <td class="tc-col-num">${entry.start}-${entry.end}</td>
        <td class="tc-col-body">
          <div class="tc-body-source" style="display:flex;align-items:flex-start;gap:8px;padding-bottom:6px;border-bottom:1px dashed #e5e7eb;margin-bottom:8px;">
            <span class="tc-icon">⚙️</span>
            <div class="tc-src" style="flex:1;">
              <div class="tc-src-lbl" style="font-weight:600;">Booking flow · ${entry.items.length} turns</div>
              <div class="tc-src-sub tc-range-hint" style="font-size:11px;color:#64748b;">Click to expand individual turns ▸</div>
            </div>
          </div>
          <div class="tc-body-content" style="margin-bottom:8px;"><span class="tc-content-muted">Name / address / confirmation steps…</span></div>
          <div class="tc-body-fix" style="padding-top:6px;border-top:1px dashed #e5e7eb;font-size:12px;">
            <span style="font-size:10px;color:#9ca3af;font-weight:600;margin-right:6px;">FIX</span><span class="tc-fix-dash">—</span>
          </div>
        </td>
      </tr>
      <tr class="tc-range-expand" data-range-body="${rangeId}" style="display:none;"><td colspan="2" style="padding:0;">
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

    // Apr 22, 2026 — inline UAP summary rendered directly under the row so
    // Marc can see caller text + gate verdict + cueFrame at a glance without
    // digging into the turn expand.
    const uapSummary = _renderInlineUapSummary(t, turns);

    return `<tr class="${rowCls}">
      <td class="tc-col-num">${t.turnNumber}</td>
      <td class="tc-col-body">
        <div class="tc-body-source" style="display:flex;align-items:flex-start;gap:8px;padding-bottom:6px;border-bottom:1px dashed #e5e7eb;margin-bottom:8px;">
          <span class="tc-icon">${entry.cls.icon}</span>
          <div class="tc-src" style="flex:1;">
            <div class="tc-src-lbl" style="font-weight:600;">${esc(entry.cls.srcLabel)}</div>
            <div class="tc-src-sub" style="font-size:11px;color:#64748b;">${entry.cls.srcSub}</div>
          </div>
        </div>
        <div class="tc-body-content" style="margin-bottom:8px;">
          <div>${esc(preview)}${t.text?.length > 110 ? '…' : ''}</div>
          ${uapSummary}
        </div>
        <div class="tc-body-fix" style="padding-top:6px;border-top:1px dashed #e5e7eb;font-size:12px;">
          <span style="font-size:10px;color:#9ca3af;font-weight:600;margin-right:6px;">FIX</span>${fixHtml}
        </div>
      </td>
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
        <strong>Default rates:</strong> Claude Sonnet 4.5 $3/$15 per M · Groq Llama 3.3 70B $0.59/$0.79 per M · ElevenLabs Turbo v2.5 $0.30 per 1k chars.
        Override per-company in <strong>Agent Studio → 💰 Cost &amp; Billing</strong> tab.
        Resolution order: company override → env var → list-price default.
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
        <tr><th style="width:60px;">#</th><th>Turn</th></tr>
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

// ── PR 2c (Apr 22, 2026) — UAP Decision panel ───────────────────────────────
// Upgraded from "Why UAP Missed" → full decision forensics for every caller
// turn. Shows (a) caller utterance, (b) 8-field cueFrame extracted from it,
// (c) gate timeline (one row per qaLog gate event), (d) for hits: winning
// phrase + matchType + confidence + anchor ratio + core embedding score,
// (e) for section gaps: top 3 alternate sections with scores, (f) for LLM
// fallback: model + cost + tokens.
//
// Backward-compat: still accepts `(qa, companyId)` signature. When called
// as `(qa, companyId, allQaEntries, turn)` renders the full timeline.
function _renderWhyPanel(qa, companyId, allQaEntries, turn) {
  const entries = Array.isArray(allQaEntries) && allQaEntries.length
    ? allQaEntries
    : (qa ? [qa] : []);
  if (!entries.length) return '';

  const pct = (n, d = 0) => (n == null ? '—' : (n * 100).toFixed(d) + '%');
  const num = (n, d = 2) => (n == null ? '—' : (typeof n === 'number' ? n.toFixed(d) : n));
  const esc2 = esc;

  // Event types that carry decision info worth rendering in the timeline
  const GATE_TYPES = new Set([
    'UAP_LAYER1',
    'UAP_SEMANTIC_MISS',
    'UAP_MISS_KEYWORD_RESCUED',
    'NEGATIVE_KEYWORD_BLOCK',
    'KC_SECTION_GAP',
    'KC_SECTION_GAP_ANSWERED',
    'KC_LLM_FALLBACK',
    'KC_GROQ_ANSWERED',
    'KC_DIRECT_ANSWER',
    'A2_LLM_FOLLOWUP',
  ]);
  const timeline = entries.filter(q => q && GATE_TYPES.has(q.type));
  if (!timeline.length) return '';

  // Pick the cueFrame — any entry that has one (all UAP sites write it now)
  const withCue = timeline.find(q => q.cueFrame) || qa || timeline[0];
  const cf = withCue?.cueFrame || null;

  // Caller utterance (prefer turn.text > first qa.question)
  const callerText = (turn?.text || turn?.callerText || qa?.question || timeline[0]?.question || '').trim();

  // ── Topic-drift warning (Apr 22, 2026) ─────────────────────────────────────
  // When topicWords is empty but tradeMatches has >5 hits, the caller clearly
  // named a topic but the noun extractor didn't catch it — the root cause of
  // most section-gap fallbacks on narrative/colloquial utterances. Show this
  // at the top of the panel so it's the first thing surfaced.
  const _topicCount = Array.isArray(cf?.topicWords) ? cf.topicWords.length : 0;
  const _tradeCount = Array.isArray(cf?.tradeMatches) ? cf.tradeMatches.length : 0;
  const topicDriftHtml = (cf && _topicCount === 0 && _tradeCount > 5)
    ? `<div style="margin-top:8px;padding:8px 10px;background:#fef2f2;border-left:3px solid #dc2626;border-radius:4px;font-size:12px;color:#991b1b;">
         <strong>\u26a0 TOPIC DRIFT</strong> &mdash; trade signal present (<strong>${_tradeCount}</strong> matches) but topic nouns not extracted. Anchor gate cannot fire &rarr; likely dropped to LLM fallback. Add the caller's phrasing to <code>callerPhrases</code> or enrich the noun extractor.
       </div>`
    : '';

  // ── Header: 8-field cueFrame chips ─────────────────────────────────────────
  const chipS = 'display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500;margin:1px 3px 1px 0;';
  const cueChipsHtml = cf ? (() => {
    const parts = [];
    const add = (label, val, bg, fg) => {
      if (val == null || val === '') return;
      const v = typeof val === 'string' ? val : JSON.stringify(val);
      parts.push(`<span style="${chipS}background:${bg};color:${fg};"><strong>${esc2(label)}:</strong> ${esc2(v)}</span>`);
    };
    add('permission', cf.permissionCue, '#fef3c7', '#92400e');
    add('info',        cf.infoCue,       '#dbeafe', '#1e40af');
    add('action',      cf.actionCore,    '#dcfce7', '#166534');
    add('modifier',    cf.modifierCore,  '#ede9fe', '#5b21b6');
    add('urgency',     cf.urgencyCore,   '#fee2e2', '#991b1b');
    add('request',     cf.requestCue,    '#cffafe', '#155e75');
    add('directive',   cf.directiveCue,  '#fce7f3', '#9d174d');
    if (Array.isArray(cf.tradeMatches) && cf.tradeMatches.length) {
      // tradeMatches entries are objects { term, containerId, sectionIdx, sectionLabel }
      // — unique-by-term, capped at 10 for display. Previously rendered "[object Object]".
      const _seenTerms = new Set();
      const _tradeTerms = [];
      for (const tm of cf.tradeMatches) {
        const term = tm && typeof tm === 'object' ? (tm.term || '') : String(tm || '');
        if (!term || _seenTerms.has(term)) continue;
        _seenTerms.add(term);
        _tradeTerms.push(term);
        if (_tradeTerms.length >= 10) break;
      }
      const _overflow = cf.tradeMatches.length > _tradeTerms.length ? ` +${cf.tradeMatches.length - _tradeTerms.length} more` : '';
      parts.push(`<span style="${chipS}background:#ecfccb;color:#3f6212;"><strong>trade:</strong> ${_tradeTerms.map(esc2).join(', ')}${_overflow}</span>`);
    }
    const topic = Array.isArray(cf.topicWords) && cf.topicWords.length
      ? `<div style="margin-top:4px;font-size:11px;color:#6b7280;">topicWords: <span style="font-family:monospace;color:#374151;">${cf.topicWords.slice(0, 12).map(esc2).join(' · ')}</span></div>`
      : '';
    return `
      <div style="margin-top:6px;">
        <div style="font-size:11px;color:#6b7280;margin-bottom:3px;">8-field cueFrame (${cf.fieldCount || 0} filled)</div>
        <div>${parts.join('') || '<span style="font-size:11px;color:#9ca3af;font-style:italic;">no cues fired</span>'}</div>
        ${topic}
      </div>`;
  })() : '<div style="margin-top:6px;font-size:11px;color:#9ca3af;font-style:italic;">no cueFrame captured</div>';

  // ── Timeline rows (one per gate event) ─────────────────────────────────────
  const rowS    = 'display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px dashed #e5e7eb;';
  const stageS  = 'min-width:150px;font-size:11px;font-weight:600;color:#374151;';
  const detailS = 'flex:1;font-size:12px;color:#1f2937;';
  const vBase   = 'display:inline-block;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:700;margin-right:6px;';

  const rows = timeline.map(q => {
    const tt = q.type;

    // ── UAP Layer 1 — hit / below-threshold / no-candidate ──
    if (tt === 'UAP_LAYER1') {
      const stage = 'UAP Layer 1 (2.5)';
      if (q.hit) {
        const ag = q.anchorGate;
        const cg = q.coreGate;
        const agRow = ag ? `<br><span style="font-size:11px;color:#6b7280;">Anchor Gate: <strong>${ag.passed ? 'PASS' : 'FAIL'}</strong> · ${pct(ag.ratio, 0)} (${ag.hits || 0}/${(ag.required?.length || 0)})</span>` : '';
        const cgRow = (cg && cg.ran) ? `<br><span style="font-size:11px;color:#6b7280;">Core Embedding: <strong>${cg.passed ? 'PASS' : 'FAIL'}</strong> · ${num(cg.score)} vs ${num(cg.threshold)}</span>` : '';
        return `<div style="${rowS}"><span style="${stageS}">${stage}</span><span style="${detailS}">
          <span style="${vBase}background:#dcfce7;color:#166534;">WON</span>
          <strong>${esc2(q.matchType || 'match')}</strong> @ ${pct(q.confidence, 0)}
          ${q.phrase ? `<br><span style="font-size:11px;color:#6b7280;">phrase: <em>"${esc2((q.phrase || '').slice(0, 140))}"</em></span>` : ''}
          ${agRow}${cgRow}
        </span></div>`;
      }
      if (q.noCandidate) {
        return `<div style="${rowS}"><span style="${stageS}">${stage}</span><span style="${detailS}">
          <span style="${vBase}background:#f3f4f6;color:#6b7280;">NO CANDIDATE</span>
          <span style="font-size:11px;color:#6b7280;">${esc2(q.reason || 'NO_PHRASE_CANDIDATE')}</span>
        </span></div>`;
      }
      if (q.belowThreshold) {
        return `<div style="${rowS}"><span style="${stageS}">${stage}</span><span style="${detailS}">
          <span style="${vBase}background:#fef3c7;color:#92400e;">BELOW</span>
          <strong>${esc2(q.matchType || 'match')}</strong> @ ${pct(q.confidence, 0)} (threshold ${pct(q.threshold, 0)})
          ${q.fuzzyRecovery ? ` · <span style="color:#b45309;font-weight:600;">fuzzy</span>` : ''}
          ${q.phrase ? `<br><span style="font-size:11px;color:#6b7280;">closest phrase: <em>"${esc2((q.phrase || '').slice(0, 140))}"</em></span>` : ''}
        </span></div>`;
      }
      return `<div style="${rowS}"><span style="${stageS}">${stage}</span><span style="${detailS}">
        <span style="${vBase}background:#fee2e2;color:#991b1b;">MISS</span>
        ${q.anchorGate ? `Anchor gate ${q.anchorGate.passed ? 'passed' : 'failed'}` : 'no details'}
      </span></div>`;
    }

    // ── Semantic (2.8) ──
    if (tt === 'UAP_SEMANTIC_MISS') {
      const sim = q.similarity ?? q.bestBelowThreshold?.similarity;
      const thr = q.threshold ?? 0.50;
      const bb  = q.bestBelowThreshold || {};
      return `<div style="${rowS}"><span style="${stageS}">Semantic (2.8)</span><span style="${detailS}">
        <span style="${vBase}background:#fef3c7;color:#92400e;">BELOW</span>
        closest ${num(sim, 3)} (threshold ${num(thr, 2)})
        ${bb.containerTitle ? `<br><span style="font-size:11px;color:#6b7280;">→ <strong>${esc2(bb.containerTitle)}</strong>${bb.sectionLabel ? ` · ${esc2(bb.sectionLabel)}` : ''}</span>` : ''}
      </span></div>`;
    }

    // ── Negative Keyword Checkpoint (2.9) ──
    if (tt === 'NEGATIVE_KEYWORD_BLOCK') {
      return `<div style="${rowS}"><span style="${stageS}">Negative KW (2.9)</span><span style="${detailS}">
        <span style="${vBase}background:#fee2e2;color:#991b1b;">BLOCKED</span>
        ${q.blockedContainerTitle ? `<strong>${esc2(q.blockedContainerTitle)}</strong>` : ''}
        ${q.negKeyword ? ` · "${esc2(q.negKeyword)}"` : ''}
      </span></div>`;
    }

    // ── Keyword rescue (3) ──
    if (tt === 'UAP_MISS_KEYWORD_RESCUED') {
      return `<div style="${rowS}"><span style="${stageS}">Keyword Rescue (3)</span><span style="${detailS}">
        <span style="${vBase}background:#fed7aa;color:#9a3412;">RESCUED</span>
        score ${num(q.rescuedScore, 0)}
        ${q.rescuedContainerTitle ? `<br><span style="font-size:11px;color:#6b7280;">→ <strong>${esc2(q.rescuedContainerTitle)}</strong>${q.rescuedSection ? ` · ${esc2(q.rescuedSection)}` : ''}</span>` : ''}
        <br><span style="font-size:11px;color:#b45309;">\u26a0 UAP should have caught this — add phrase to callerPhrases.</span>
      </span></div>`;
    }

    // ── Section gap ──
    if (tt === 'KC_SECTION_GAP') {
      const top = Array.isArray(q.gapTopSections) ? q.gapTopSections.slice(0, 3) : [];
      const topRows = top.length ? `<br><span style="font-size:11px;color:#6b7280;">top alternates:</span><ol style="margin:3px 0 0 18px;padding:0;font-size:11px;color:#374151;">${top.map(s => `<li><strong>${esc2(s.label || '(no label)')}</strong> — score ${num(s.score, 0)}</li>`).join('')}</ol>` : '';
      return `<div style="${rowS}"><span style="${stageS}">Section Gap</span><span style="${detailS}">
        <span style="${vBase}background:#fed7aa;color:#9a3412;">CONTAINER ✓ / SECTION ✗</span>
        ${q.containerTitle ? `Container: <strong>${esc2(q.containerTitle)}</strong>` : ''}
        ${q.gapFiltered ? `<br><span style="font-size:11px;color:#6b7280;">pre-filtered ${q.gapOriginalCount} → ${q.gapFilteredCount} sections</span>` : ''}
        ${topRows}
      </span></div>`;
    }

    // ── LLM fire events (Claude fallback / section-gap answer / follow-up) ──
    if (tt === 'KC_SECTION_GAP_ANSWERED' || tt === 'KC_LLM_FALLBACK' || tt === 'A2_LLM_FOLLOWUP') {
      const cost  = q.cost;
      const label = tt === 'KC_SECTION_GAP_ANSWERED' ? 'Section Gap → Claude'
                  : tt === 'A2_LLM_FOLLOWUP'         ? 'LLM Follow-up'
                  : 'Claude Fallback (4)';
      const vBg   = tt === 'KC_LLM_FALLBACK' ? 'background:#fee2e2;color:#991b1b;' : 'background:#e0e7ff;color:#3730a3;';
      return `<div style="${rowS}"><span style="${stageS}">${label}</span><span style="${detailS}">
        <span style="${vBase}${vBg}">FIRED</span>
        ${cost?.usd != null ? `$${cost.usd.toFixed(4)} · ${cost.input || 0}in/${cost.output || 0}out tokens` : ''}
        ${cost?.model ? ` · <span style="font-size:11px;color:#6b7280;">${esc2(cost.model)}</span>` : ''}
        ${q.latencyMs ? ` · ${q.latencyMs}ms` : ''}
      </span></div>`;
    }

    // ── Successful KC answer (Groq or direct) ──
    if (tt === 'KC_GROQ_ANSWERED' || tt === 'KC_DIRECT_ANSWER') {
      const cost = q.cost;
      return `<div style="${rowS}"><span style="${stageS}">${tt === 'KC_GROQ_ANSWERED' ? 'Groq Answer' : 'Direct KC Answer'}</span><span style="${detailS}">
        <span style="${vBase}background:#dcfce7;color:#166534;">ANSWERED</span>
        ${q.containerTitle ? `<strong>${esc2(q.containerTitle)}</strong>` : ''}${q.sectionLabel ? ` · ${esc2(q.sectionLabel)}` : ''}
        ${cost?.usd != null ? `<br><span style="font-size:11px;color:#6b7280;">cost: $${cost.usd.toFixed(4)}${cost.model ? ` · ${esc2(cost.model)}` : ''}</span>` : ''}
      </span></div>`;
    }

    return '';
  }).filter(Boolean);

  if (!rows.length) return '';

  // ── Fix in Gap Page deep-link ──────────────────────────────────────────────
  const anchor = timeline.find(q => q.rescuedContainerId) || timeline.find(q => q.containerId) || qa || timeline[0];
  const filterContainer = anchor?.rescuedContainerId || anchor?.containerId || anchor?.rescuedKcId || anchor?.kcId || null;
  const filterSection   = anchor?.rescuedSection   || anchor?.sectionLabel || null;
  const filterPhrase    = callerText || anchor?.question || null;
  const gapParams = new URLSearchParams();
  if (companyId)        gapParams.set('companyId', companyId);
  if (filterContainer)  gapParams.set('filterContainer', filterContainer);
  if (filterSection)    gapParams.set('filterSection', filterSection);
  if (filterPhrase)     gapParams.set('filterPhrase', (filterPhrase || '').slice(0, 200));
  const gapUrl = `/agent-console/todo.html?${gapParams.toString()}`;

  return `
    <div class="td-section" style="background:linear-gradient(180deg,#fff7ed 0%,#fffbeb 100%);border-left:3px solid #f59e0b;border-radius:6px;padding:12px 14px;margin-top:10px;">
      <div class="td-sec-title" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <span style="color:#b45309;">\ud83e\udded UAP Decision</span>
        <a href="${esc2(gapUrl)}" target="_blank"
           style="display:inline-flex;align-items:center;gap:6px;padding:5px 12px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:5px;font-size:12px;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,0.06);">
           \ud83d\udd27 Fix in Gap Page
        </a>
      </div>
      ${callerText ? `<div style="margin-top:8px;font-size:12px;color:#374151;"><span style="font-size:11px;color:#6b7280;">caller:</span> <em>"${esc2(callerText.slice(0, 200))}"</em></div>` : ''}
      ${topicDriftHtml}
      ${cueChipsHtml}
      <div style="margin-top:10px;">${rows.join('')}</div>
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

  // Per-turn STT provider badge — green DEEPGRAM pill when Deepgram
  // transcribed this caller utterance (Nova-3 live WS or fallback rescue).
  // Omitted for Twilio Gather (the neutral default) and all agent turns.
  let sttBadge = '';
  if (isCaller && t.sttProvider && t.sttProvider !== 'gather') {
    const isFallback = t.sttProvider === 'deepgram-fallback';
    const title = isFallback
      ? 'Transcribed by Deepgram (low-confidence Gather rescue)'
      : 'Transcribed by Deepgram Nova-3 (live stream)';
    const label = isFallback ? 'DEEPGRAM · RESCUE' : 'DEEPGRAM';
    sttBadge = `<span class="stt-pill-turn stt-${t.sttProvider}" title="${title}">${label}</span>`;
  }

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

  // 5) UAP Decision panel (PR 2c — caller turns render full gate timeline)
  //    Pass the full qaEntries[] so the panel can show every gate event
  //    (Layer 1 + SECTION_GAP + LLM fallback often co-occur on one turn).
  //    Falls back to the single qaEntry when the backend hasn't sent the
  //    array yet (stale API response safety).
  const whyHtml = isCaller
    ? _renderWhyPanel(t.qaEntry, companyId, t.qaEntries, t)
    : '';

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
        ${sttBadge}
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

// ─── Scroll spy for top nav pills ────────────────────────────────────────────

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
