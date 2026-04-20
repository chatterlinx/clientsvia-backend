'use strict';

/**
 * ============================================================================
 * KC GAPS & TODO — Client-Side Logic
 * ============================================================================
 *
 * Fetches gap events from the kcGaps API, merges related entries (same call +
 * turn), renders stat cards / filters / table with expandable detail rows.
 *
 * RECOMMENDATION ENGINE:
 *   Analyzes merged gap data → generates prioritized, actionable "todo" items.
 *   Groups section gaps by container, clusters LLM fallbacks, flags patterns.
 *   Each recommendation tells you exactly what to do to fix the gap.
 *
 * Actions per row:
 *   - Copy phrase to clipboard (toast confirmation)
 *   - Open Phrase Finder on services.html with the phrase pre-loaded
 *   - Per-row action suggestion in detail panel (what to do for this gap)
 *
 * ============================================================================
 */

// ── State ────────────────────────────────────────────────────────────────────
const G = {
  companyId:  null,
  gaps:       [],      // raw from API
  merged:     [],      // after turn-merge
  summary:    {},      // { total, byType, range }
  range:             '7d',
  typeFilter:        'all',
  showTurn1:         false,   // Turn 1 Engine events hidden by default (not real gaps)
  recommendations:   [],      // generated action items
  containerGapCounts: {},     // containerId → occurrence count

  // ── Config Health tab state ──────────────────────────────────────────
  activeTab:    'gaps',   // 'gaps' | 'health'
  healthLoaded: false,
  health:       null,     // last /health response

  // ── Closed-loop verify / resolve state ───────────────────────────────
  // resolutions    — gapKey → resolution doc from /gaps/resolutions
  // byNormalized   — normalizedPhrase → resolution doc (row-join lookup)
  // verifyByIdx    — merged-row index → last GapReplayService trace (client-only)
  // verifyingIdx   — Set of merged-row indices currently mid-verify (for UI state)
  // advisorByIdx   — merged-row index → last FixAdvisor output (client-only)
  // advisingIdx    — Set of merged-row indices currently mid-advisor-call
  // hideResolved   — filter: hide rows that already have a RESOLVED doc
  resolutions:   {},
  byNormalized:  {},
  verifyByIdx:   {},
  verifyingIdx:  new Set(),
  advisorByIdx:  {},
  advisingIdx:   new Set(),
  hideResolved:  true,
};

// ── Init ─────────────────────────────────────────────────────────────────────
(function init() {
  const params = new URLSearchParams(location.search);
  G.companyId  = params.get('companyId');

  if (!G.companyId) {
    document.getElementById('pageLoading').innerHTML =
      '<span style="color:#dc2626;">Missing companyId in URL.</span>';
    return;
  }

  // Back button → services.html
  document.getElementById('btnBack').href =
    `/agent-console/services.html?companyId=${G.companyId}`;

  loadGaps();
})();

// ── Fetch gaps from API ──────────────────────────────────────────────────────
async function loadGaps() {
  const btn = document.getElementById('btnRefresh');
  btn.disabled = true; btn.textContent = 'Loading…';

  document.getElementById('pageLoading').style.display = 'block';
  document.getElementById('pageContent').style.display = 'none';

  try {
    const qs = `range=${G.range}&type=${G.typeFilter}${G.showTurn1 ? '&turn1=1' : ''}`;

    // Gaps + resolutions in parallel — both are needed before first render
    const [gapsRes, resolutionsRes] = await Promise.all([
      AgentConsoleAuth.apiFetch(
        `/api/admin/agent2/company/${G.companyId}/knowledge/gaps?${qs}`
      ),
      _loadResolutions(),
    ]);

    if (!gapsRes.success) throw new Error(gapsRes.error || 'API error');

    G.gaps    = gapsRes.gaps || [];
    G.summary = gapsRes.summary || {};
    G.merged  = _mergeGapEntries(G.gaps);

    // resolutions loaded into G.resolutions + G.byNormalized by _loadResolutions
    // (void return — mutates state directly)
    void resolutionsRes;

    // Build prescriptive recommendations from gap data
    const recResult       = _buildRecommendations(G.merged);
    G.recommendations     = recResult.recommendations;
    G.containerGapCounts  = recResult.containerGapCounts;

    document.getElementById('pageLoading').style.display = 'none';
    document.getElementById('pageContent').style.display = 'block';

    _renderSummary();
    _renderRecommendations();
    _renderFilters();
    _renderTable();
  } catch (err) {
    document.getElementById('pageLoading').innerHTML =
      `<span style="color:#dc2626;">Error: ${_esc(err.message)}</span>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Refresh';
  }
}

// ── Fetch resolutions for this company ──────────────────────────────────────
// Populates G.resolutions (keyed by gapKey) and G.byNormalized (keyed by
// normalizedPhrase) for O(1) client-side join with gap rows.
async function _loadResolutions() {
  try {
    const res = await AgentConsoleAuth.apiFetch(
      `/api/admin/agent2/company/${G.companyId}/knowledge/gaps/resolutions?status=active`
    );
    if (!res.success) throw new Error(res.error || 'resolutions API error');

    G.resolutions  = res.map || {};
    G.byNormalized = {};
    for (const doc of (res.resolutions || [])) {
      if (doc.normalizedPhrase) G.byNormalized[doc.normalizedPhrase] = doc;
    }
  } catch (err) {
    // Don't fail the whole page if resolutions endpoint is cold — log + continue
    console.warn('[todo] Failed to load resolutions:', err.message);
    G.resolutions  = {};
    G.byNormalized = {};
  }
}

// ── Turn-merge ───────────────────────────────────────────────────────────────
// KC_SECTION_GAP + KC_LLM_FALLBACK from same callSid+turn → one row.
// GAP has container info, FALLBACK has the answer. Merge them.
function _mergeGapEntries(gaps) {
  const byKey = {};
  const order = [];

  for (const g of gaps) {
    const key = `${g.callSid || ''}:${g.turn ?? ''}`;

    if (!byKey[key]) {
      byKey[key] = {
        callSid:        g.callSid,
        callReason:     g.callReason,
        turn:           g.turn,
        question:       g.question,
        answer:         null,
        containerTitle: null,
        containerId:    null,
        kcId:           null,
        timestamp:      g.timestamp,
        types:          [],
      };
      order.push(key);
    }

    const row = byKey[key];
    row.types.push(g.type);

    // Take the earliest timestamp
    if (g.timestamp && (!row.timestamp || g.timestamp < row.timestamp)) {
      row.timestamp = g.timestamp;
    }

    // Question — prefer the one that exists
    if (g.question && !row.question) row.question = g.question;

    // Container + gap filter info comes from KC_SECTION_GAP
    if (g.type === 'KC_SECTION_GAP') {
      row.containerTitle   = g.containerTitle   || row.containerTitle;
      row.containerId      = g.containerId      || row.containerId;
      row.kcId             = g.kcId             || row.kcId;
      row.gapFiltered      = g.gapFiltered      || row.gapFiltered      || false;
      row.gapOriginalCount = g.gapOriginalCount || row.gapOriginalCount || null;
      row.gapFilteredCount = g.gapFilteredCount || row.gapFilteredCount || null;
      row.gapTopSections   = g.gapTopSections   || row.gapTopSections   || [];
    }

    // Answer comes from KC_LLM_FALLBACK (Claude's response)
    if (g.type === 'KC_LLM_FALLBACK' && g.answer) {
      row.answer = g.answer;
    }

    // Answer from KC_GRACEFUL_ACK (canned response)
    if (g.type === 'KC_GRACEFUL_ACK' && g.answer && !row.answer) {
      row.answer = g.answer;
    }

    // Call reason — take whatever is available
    if (g.callReason && !row.callReason) row.callReason = g.callReason;
  }

  // Determine display type for merged row
  const merged = order.map(k => {
    const row = byKey[k];
    // Priority: GAP > FALLBACK > ACK
    if (row.types.includes('KC_SECTION_GAP'))   row.displayType = 'KC_SECTION_GAP';
    else if (row.types.includes('KC_LLM_FALLBACK')) row.displayType = 'KC_LLM_FALLBACK';
    else row.displayType = 'KC_GRACEFUL_ACK';
    return row;
  });

  // Sort newest first
  merged.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return merged;
}

// ── Recommendation Engine ────────────────────────────────────────────────
// Analyzes merged gap data and generates prioritized, actionable
// recommendations. This is the "todo" in "Gaps & Todo" — it tells you
// exactly what to do to improve caller experience.
function _buildRecommendations(merged) {
  const recs = [];

  // ── Pre-compute: container gap occurrence counts ─────────────────────
  const containerGapCounts = {};
  for (const row of merged) {
    if (row.displayType === 'KC_SECTION_GAP' && row.containerId) {
      containerGapCounts[row.containerId] = (containerGapCounts[row.containerId] || 0) + 1;
    }
  }

  // ── 1. Group KC_SECTION_GAP by container ─────────────────────────────
  // Same container matching but no section → needs content added
  const containerGaps = {};
  for (const row of merged) {
    if (row.displayType !== 'KC_SECTION_GAP') continue;
    const cid = row.containerId || '_unknown';
    if (!containerGaps[cid]) {
      containerGaps[cid] = {
        containerTitle: row.containerTitle || 'Unknown Container',
        containerId:    row.containerId,
        kcId:           row.kcId,
        phrases:        [],
        count:          0,
        callSids:       new Set(),
      };
    }
    const cg = containerGaps[cid];
    cg.count++;
    if (row.callSid) cg.callSids.add(row.callSid);
    if (row.question && row.question.trim()) {
      cg.phrases.push(row.question.trim());
    }
  }

  for (const cg of Object.values(containerGaps)) {
    const uniquePhrases = [...new Set(cg.phrases)];
    const uniqueCalls   = cg.callSids.size;
    const priority      = cg.count >= 3 ? 'high' : cg.count >= 2 ? 'medium' : 'low';

    recs.push({
      priority,
      type:  'section_gap',
      title: `"${cg.containerTitle}" \u2014 ${cg.count} section gap${cg.count > 1 ? 's' : ''}`,
      description:
        `Container matched ${cg.count} time${cg.count > 1 ? 's' : ''} across ` +
        `${uniqueCalls} call${uniqueCalls > 1 ? 's' : ''} but no section could answer ` +
        `the caller\u2019s question. \u2192 Add callerPhrases to sections in this KC card, ` +
        `or create a new section that covers these topics.`,
      phrases:        uniquePhrases,
      containerTitle: cg.containerTitle,
      containerId:    cg.containerId,
      kcId:           cg.kcId,
      count:          cg.count,
    });
  }

  // ── 2. Group KC_LLM_FALLBACK (no container match) ───────────────────
  const fbPhrases  = [];
  let   fbCount    = 0;
  const fbCallSids = new Set();
  for (const row of merged) {
    if (row.displayType !== 'KC_LLM_FALLBACK') continue;
    fbCount++;
    if (row.callSid) fbCallSids.add(row.callSid);
    if (row.question && row.question.trim()) {
      fbPhrases.push(row.question.trim());
    }
  }

  if (fbCount > 0) {
    const uniquePhrases = [...new Set(fbPhrases)];
    recs.push({
      priority: fbCount >= 3 ? 'high' : 'medium',
      type:  'no_match',
      title: `${fbCount} question${fbCount > 1 ? 's' : ''} had no KC match`,
      description:
        `Agent used AI to improvise ${fbCount} response${fbCount > 1 ? 's' : ''} without ` +
        `trained KC content. Some may be conversational fragments. ` +
        `\u2192 Open Phrase Finder to match real questions to existing containers.`,
      phrases: uniquePhrases,
      count:   fbCount,
    });
  }

  // ── 3. Group KC_GRACEFUL_ACK ────────────────────────────────────────
  let   ackCount   = 0;
  const ackPhrases = [];
  for (const row of merged) {
    if (row.displayType !== 'KC_GRACEFUL_ACK') continue;
    ackCount++;
    if (row.question && row.question.trim().length > 5) {
      ackPhrases.push(row.question.trim());
    }
  }

  if (ackCount > 0) {
    const realPhrases = [...new Set(ackPhrases)];
    recs.push({
      priority: realPhrases.length >= 3 ? 'medium' : 'low',
      type:  'graceful_ack',
      title: `${ackCount} generic acknowledgment${ackCount > 1 ? 's' : ''}`,
      description:
        `Agent gave basic acknowledgment responses. Most are natural conversation ` +
        `flow (empty utterances). ` +
        (realPhrases.length > 0
          ? `\u2192 Review the ${realPhrases.length} with actual phrases \u2014 these may be missed content opportunities.`
          : `All were empty utterances \u2014 likely OK.`),
      phrases: realPhrases,
      count:   ackCount,
    });
  }

  // ── Sort: high → medium → low ──────────────────────────────────────
  const pOrder = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => (pOrder[a.priority] ?? 9) - (pOrder[b.priority] ?? 9));

  return { recommendations: recs, containerGapCounts };
}

// ── Render: Summary stat cards ───────────────────────────────────────────────
function _renderSummary() {
  const s   = G.summary;
  const bt  = s.byType || {};
  const tot = s.total || 0;
  const gap = bt.KC_SECTION_GAP   || 0;
  const fb  = bt.KC_LLM_FALLBACK  || 0;
  const ack = bt.KC_GRACEFUL_ACK  || 0;

  document.getElementById('statCards').innerHTML = `
    <div class="stat-row">
      <div class="stat-card">
        <div class="stat-label">Total Events</div>
        <div class="stat-value">${tot}</div>
      </div>
      <div class="stat-card gap">
        <div class="stat-label">Section Gaps</div>
        <div class="stat-value">${gap}</div>
      </div>
      <div class="stat-card fb">
        <div class="stat-label">LLM Fallback</div>
        <div class="stat-value">${fb}</div>
      </div>
      <div class="stat-card ack">
        <div class="stat-label">Graceful Ack</div>
        <div class="stat-value">${ack}</div>
      </div>
    </div>`;
}

// ── Render: Filter bar ───────────────────────────────────────────────────────
function _renderFilters() {
  const rangeOpts = [
    { key: '24h', label: '24h' },
    { key: '7d',  label: '7 days' },
    { key: '30d', label: '30 days' },
  ];
  const typeOpts = [
    { key: 'all',              label: 'All Types' },
    { key: 'KC_SECTION_GAP',   label: 'Section Gap' },
    { key: 'KC_LLM_FALLBACK',  label: 'LLM Fallback' },
    { key: 'KC_GRACEFUL_ACK',  label: 'Graceful Ack' },
  ];

  let html = '<div class="filter-bar">';

  // Range group
  html += '<div class="filter-group"><span class="filter-label">Range</span>';
  for (const r of rangeOpts) {
    const cls = r.key === G.range ? ' active' : '';
    html += `<button class="filter-btn${cls}" onclick="setRange('${r.key}')">${r.label}</button>`;
  }
  html += '</div>';

  html += '<div class="filter-divider"></div>';

  // Type group
  html += '<div class="filter-group"><span class="filter-label">Type</span>';
  for (const t of typeOpts) {
    const cls = t.key === G.typeFilter ? ' active' : '';
    html += `<button class="filter-btn${cls}" onclick="setType('${t.key}')">${t.label}</button>`;
  }
  html += '</div>';

  html += '</div>';

  html += '<div class="filter-divider"></div>';

  // Turn 1 toggle — hidden by default because Turn 1 Engine handles those
  html += '<div class="filter-group">';
  html += `<button class="filter-btn${G.showTurn1 ? ' active' : ''}" onclick="toggleTurn1()">`;
  html += `${G.showTurn1 ? '\u2713 ' : ''}Turn 1`;
  html += '</button>';
  html += '</div>';

  html += '<div class="filter-divider"></div>';

  // Hide resolved toggle — default ON (resolved rows hidden from active list)
  const resolvedCount = Object.keys(G.resolutions || {}).length;
  html += '<div class="filter-group">';
  html += `<button class="filter-btn${G.hideResolved ? ' active' : ''}" onclick="toggleHideResolved()" title="Hide gap rows that are already marked resolved">`;
  html += `${G.hideResolved ? '\u2713 ' : ''}Hide Resolved`;
  if (resolvedCount > 0) html += ` <span style="opacity:.7;">(${resolvedCount})</span>`;
  html += '</button>';
  html += '</div>';

  // Verify All — runs verify on every unresolved row in the current view
  const _verifyableCount = G.merged.filter(r => r.question && !_getResolution(r)).length;
  if (_verifyableCount > 0) {
    html += '<div class="filter-group">';
    html += `<button class="filter-btn" onclick="verifyAll()" title="Run UAP verify on every unresolved row below" style="background:#eef2ff;border-color:#c7d2fe;color:#4338ca;">`;
    html += `\ud83e\uddea Verify All (${_verifyableCount})`;
    html += '</button>';
    html += '</div>';
  }

  html += '</div>';
  document.getElementById('filterBar').innerHTML = html;
}

// ── Render: Recommendations panel ────────────────────────────────────────
function _renderRecommendations() {
  const recs = G.recommendations;
  const el   = document.getElementById('recommendations');

  if (!recs || !recs.length) { el.innerHTML = ''; return; }

  const priorityLabels = {
    high:   '\ud83d\udd34 HIGH',   // 🔴
    medium: '\ud83d\udfe1 MED',    // 🟡
    low:    '\u26aa LOW',          // ⚪
  };

  let html = '<div class="rec-panel">';

  // ── Header ──
  html += '<div class="rec-header" onclick="toggleRecPanel()">';
  html += '<div class="rec-header-left">';
  html += '<span class="rec-icon">\ud83d\udccb</span>';   // 📋
  html += '<span class="rec-title">Recommended Actions</span>';
  html += `<span class="rec-count">${recs.length}</span>`;
  html += '</div>';
  html += '<span class="rec-toggle" id="recToggle">\u25bc</span>';
  html += '</div>';

  // ── Body ──
  html += '<div class="rec-body" id="recBody">';

  recs.forEach((rec, ri) => {
    const pLabel = priorityLabels[rec.priority] || rec.priority;

    html += `<div class="rec-card ${rec.priority}">`;

    // Card header: priority + title
    html += '<div class="rec-card-header">';
    html += `<span class="rec-priority ${rec.priority}">${pLabel}</span>`;
    html += `<span class="rec-card-title">${_esc(rec.title)}</span>`;
    html += '</div>';

    // Description
    html += `<div class="rec-card-desc">${_esc(rec.description)}</div>`;

    // Phrase pills
    if (rec.phrases && rec.phrases.length > 0) {
      html += '<div class="rec-phrases">';
      const show = rec.phrases.slice(0, 4);
      for (const p of show) {
        html += `<span class="rec-phrase">\u201c${_esc(_clip(p, 50))}\u201d</span>`;
      }
      if (rec.phrases.length > 4) {
        html += `<span class="rec-phrase-more">+${rec.phrases.length - 4} more</span>`;
      }
      html += '</div>';
    }

    // Action buttons
    html += '<div class="rec-actions">';

    if (rec.type === 'section_gap' && rec.kcId) {
      const kcLink = `/agent-console/services.html?companyId=${G.companyId}#kc-${rec.kcId}`;
      html += `<a class="btn-act primary" href="${kcLink}" target="_blank">Open KC Card \u2192</a>`;
    }
    if (rec.type === 'section_gap' && rec.phrases.length > 0) {
      const fp = encodeURIComponent(rec.phrases[0]);
      html += `<a class="btn-act" href="/agent-console/services.html?companyId=${G.companyId}&openPf=${fp}" target="_blank">Phrase Finder</a>`;
    }
    if (rec.type === 'no_match' && rec.phrases.length > 0) {
      const fp = encodeURIComponent(rec.phrases[0]);
      html += `<a class="btn-act primary" href="/agent-console/services.html?companyId=${G.companyId}&openPf=${fp}" target="_blank">Phrase Finder \u2192</a>`;
    }
    if (rec.phrases && rec.phrases.length > 0) {
      html += `<button class="btn-act" onclick="copyRecPhrases(${ri})">Copy Phrases</button>`;
    }

    html += '</div>'; // rec-actions
    html += '</div>'; // rec-card
  });

  html += '</div>'; // rec-body
  html += '</div>'; // rec-panel

  el.innerHTML = html;
}

// ── Render: Gap table ────────────────────────────────────────────────────────
function _renderTable() {
  if (!G.merged.length) {
    document.getElementById('gapTable').innerHTML = `
      <div class="state-empty">
        <span class="icon">&#10003;</span>
        <h2>No gaps found</h2>
        <p>No KC pipeline failures in the selected time range.<br>Your knowledge base is handling calls well.</p>
      </div>`;
    return;
  }

  // Filter: optionally hide rows with an active resolution
  const visibleRows = G.merged
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => {
      if (!G.hideResolved) return true;
      const res = _getResolution(row);
      return !res;   // hide resolved / weak / regressed when toggle is ON
    });

  if (!visibleRows.length) {
    const hiddenCount = G.merged.length;
    document.getElementById('gapTable').innerHTML = `
      <div class="state-empty">
        <span class="icon">\u2728</span>
        <h2>All clear!</h2>
        <p>${hiddenCount} gap event${hiddenCount > 1 ? 's are' : ' is'} marked resolved.<br>
        <button class="btn-act" onclick="toggleHideResolved()">Show resolved rows</button></p>
      </div>`;
    return;
  }

  let html = '<div class="table-wrap"><table class="gap-table"><thead><tr>';
  html += '<th>Time</th>';
  html += '<th>Caller Phrase</th>';
  html += '<th>Agent Response</th>';
  html += '<th>Container</th>';
  html += '<th>Type</th>';
  html += '<th>Verify</th>';
  html += '<th>Actions</th>';
  html += '</tr></thead><tbody>';

  visibleRows.forEach(({ row, idx }) => {
    const time      = _fmtTime(row.timestamp);
    const phrase    = _clip(row.question, 80);
    const answer    = _clip(row.answer, 60);
    const container = row.containerTitle || '—';
    const badge     = _typeBadge(row.displayType);
    const resolution = _getResolution(row);
    const resolvedCls = resolution ? ' is-resolved' : '';

    // Data row
    html += `<tr class="data-row${resolvedCls}" onclick="toggleDetail(${idx})">`;
    html += `<td style="white-space:nowrap;font-size:12px;color:var(--text-muted);">${_esc(time)}</td>`;
    html += `<td class="phrase-cell">${_esc(phrase)}</td>`;
    html += `<td class="response-cell">${answer ? _esc(answer) : '<span style="color:#cbd5e1;">\u2014</span>'}</td>`;
    html += `<td style="font-size:12px;">${_esc(container)}</td>`;
    // Occurrence badge for containers with multiple section gaps
    const _occ = (row.containerId && row.displayType === 'KC_SECTION_GAP')
      ? (G.containerGapCounts[row.containerId] || 0)
      : 0;
    html += `<td>${badge}`;
    if (_occ > 1) html += ` <span class="occ-badge">${_occ}\u00d7</span>`;
    html += `</td>`;

    // ── Verify column (closed-loop status) ─────────────────────────────
    html += `<td onclick="event.stopPropagation();">${_renderVerifyCell(row, idx)}</td>`;

    // ── Actions column ────────────────────────────────────────────────
    html += `<td class="actions-cell" onclick="event.stopPropagation();">`;
    html += `  <button class="btn-act" onclick="copyPhrase(${idx})" title="Copy caller phrase to clipboard">Copy</button>`;
    html += `  <button class="btn-act primary" onclick="openFinder(${idx})" title="Open in Phrase Finder">Finder &rarr;</button>`;
    html += `</td>`;
    html += `</tr>`;

    // Detail row (hidden by default) — colspan matches 7-column header
    html += `<tr class="detail-row" id="detail-${idx}"><td colspan="7" class="detail-cell">`;
    html += `<div class="detail-grid">`;
    html += _detailField('Call SID', row.callSid || '—');
    html += _detailField('Turn', row.turn != null ? String(row.turn) : '—');
    html += _detailField('Call Reason', row.callReason || '—');
    html += _detailField('Event Types', row.types.join(', '));

    if (row.containerId) {
      html += _detailField('Container ID', row.containerId);
    }
    if (row.kcId) {
      const kcLink = `/agent-console/services.html?companyId=${G.companyId}#kc-${row.kcId}`;
      html += `<div><div class="detail-label">KC Card</div><div class="detail-value"><a href="${kcLink}" target="_blank">${_esc(row.kcId)}</a></div></div>`;
    }
    html += _detailField('Timestamp', row.timestamp || '—');

    // Merged types indicator
    if (row.types.length > 1) {
      html += _detailField('Merged', `${row.types.length} events from same call turn`);
    }
    html += '</div>';

    // Section pre-filter info (when gap had filter applied)
    if (row.gapFiltered && row.gapTopSections && row.gapTopSections.length > 0) {
      html += `<div class="detail-answer" style="margin-top:8px;">`;
      html += `<div class="detail-answer-label" style="color:var(--warning);">Section Pre-Filter</div>`;
      html += `<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">`;
      html += `${row.gapOriginalCount} total sections &rarr; ${row.gapFilteredCount} sent to Groq</div>`;
      html += `<div style="display:flex;flex-direction:column;gap:3px;">`;
      for (const s of row.gapTopSections) {
        const barW = Math.min(100, Math.max(8, Math.round((s.score / (row.gapTopSections[0]?.score || 1)) * 100)));
        html += `<div style="display:flex;align-items:center;gap:8px;font-size:12px;">`;
        html += `<div style="width:24px;text-align:right;color:var(--text-muted);">#${s.idx}</div>`;
        html += `<div style="flex:0 0 ${barW}px;height:6px;background:var(--warning);border-radius:3px;"></div>`;
        html += `<span>${_esc(s.label)}</span>`;
        html += `<span style="color:var(--text-muted);">(${s.score})</span>`;
        html += `</div>`;
      }
      html += `</div></div>`;
    }

    // ── Per-row action suggestion ──
    html += '<div class="detail-suggestion">';
    html += '<div class="suggestion-icon">\ud83d\udca1</div>';  // 💡
    html += '<div class="suggestion-text">';
    if (row.displayType === 'KC_SECTION_GAP') {
      const _gapOcc = row.containerId ? (G.containerGapCounts[row.containerId] || 1) : 1;
      html += `<strong>Add a callerPhrase</strong> to a section in \u201c${_esc(row.containerTitle)}\u201d `;
      html += `that covers this caller\u2019s intent.`;
      if (_gapOcc > 1) {
        html += ` <span class="suggestion-repeat">This container had ${_gapOcc} section gaps this period.</span>`;
      }
    } else if (row.displayType === 'KC_LLM_FALLBACK') {
      html += `<strong>Use Phrase Finder</strong> to match this phrase to an existing container, `;
      html += `or create a new KC card if this is a new topic.`;
    } else {
      if (row.question && row.question.trim().length > 5) {
        html += `<strong>Review:</strong> Agent had no trained answer. Check if this is a real gap `;
        html += `or natural conversation flow.`;
      } else {
        html += `<strong>Likely OK:</strong> Empty or very short utterance \u2014 probably a natural `;
        html += `pause or acknowledgment from the caller.`;
      }
    }
    html += '</div></div>';

    // Full question
    if (row.question) {
      html += `<div class="detail-answer">`;
      html += `<div class="detail-answer-label">Full Caller Phrase</div>`;
      html += `<div class="detail-answer-text">${_esc(row.question)}</div>`;
      html += `</div>`;
    }

    // Full answer
    if (row.answer) {
      html += `<div class="detail-answer">`;
      html += `<div class="detail-answer-label">Full Agent Response</div>`;
      html += `<div class="detail-answer-text">${_esc(row.answer)}</div>`;
      html += `</div>`;
    }

    // ── Verify detail (if verify has run on this row) ────────────────
    html += `<div id="verify-detail-${idx}">${_renderVerifyDetail(row, idx)}</div>`;

    html += '</td></tr>';
  });

  html += '</tbody></table></div>';
  document.getElementById('gapTable').innerHTML = html;
}

// ── Filter handlers ──────────────────────────────────────────────────────────
function setRange(range) {
  G.range = range;
  loadGaps();
}

function setType(type) {
  G.typeFilter = type;
  loadGaps();
}

function toggleTurn1() {
  G.showTurn1 = !G.showTurn1;
  loadGaps();
}

// ── Row actions ──────────────────────────────────────────────────────────────
function toggleDetail(idx) {
  const el = document.getElementById(`detail-${idx}`);
  if (el) el.classList.toggle('open');
}

function copyPhrase(idx) {
  const row = G.merged[idx];
  if (!row || !row.question) return;

  navigator.clipboard.writeText(row.question).then(() => {
    _toast('Phrase copied to clipboard');
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = row.question;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    _toast('Phrase copied to clipboard');
  });
}

function openFinder(idx) {
  const row = G.merged[idx];
  if (!row || !row.question) return;

  // Navigate to services.html with openPf param
  const phrase = encodeURIComponent(row.question);
  window.location.href =
    `/agent-console/services.html?companyId=${G.companyId}&openPf=${phrase}`;
}

// ── Recommendation actions ──────────────────────────────────────────────
function toggleRecPanel() {
  const body   = document.getElementById('recBody');
  const toggle = document.getElementById('recToggle');
  if (!body || !toggle) return;
  if (body.classList.contains('collapsed')) {
    body.classList.remove('collapsed');
    toggle.textContent = '\u25bc';   // ▼
  } else {
    body.classList.add('collapsed');
    toggle.textContent = '\u25b6';   // ▶
  }
}

function copyRecPhrases(recIdx) {
  const rec = G.recommendations[recIdx];
  if (!rec || !rec.phrases || !rec.phrases.length) {
    _toast('No phrases to copy');
    return;
  }
  const unique = [...new Set(rec.phrases)];
  navigator.clipboard.writeText(unique.join('\n')).then(() => {
    _toast(`${unique.length} phrase${unique.length > 1 ? 's' : ''} copied`);
  }).catch(() => {
    _toast('Copy failed');
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function _esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function _clip(s, max) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function _fmtTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;

    // Less than 24h ago → relative
    if (diff < 86400000) {
      const hrs = Math.floor(diff / 3600000);
      if (hrs < 1) {
        const mins = Math.floor(diff / 60000);
        return mins < 1 ? 'just now' : `${mins}m ago`;
      }
      return `${hrs}h ago`;
    }

    // Otherwise → date + time
    const month = d.toLocaleString('en-US', { month: 'short' });
    const day   = d.getDate();
    const time  = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${month} ${day}, ${time}`;
  } catch (_) {
    return iso;
  }
}

function _typeBadge(type) {
  const map = {
    'KC_SECTION_GAP':   { cls: 'gap', label: 'Section Gap' },
    'KC_LLM_FALLBACK':  { cls: 'fb',  label: 'LLM Fallback' },
    'KC_GRACEFUL_ACK':  { cls: 'ack', label: 'Graceful Ack' },
  };
  const info = map[type] || { cls: 'ack', label: type || 'Unknown' };
  return `<span class="type-badge ${info.cls}">${info.label}</span>`;
}

function _detailField(label, value) {
  return `<div><div class="detail-label">${_esc(label)}</div><div class="detail-value">${_esc(value)}</div></div>`;
}

// ── Download: JSON ──────────────────────────────────────────────────────────
function downloadJSON() {
  if (!G.merged.length) { _toast('No gap data to download'); return; }

  const payload = {
    exported:   new Date().toISOString(),
    companyId:  G.companyId,
    range:      G.range,
    typeFilter: G.typeFilter,
    summary:    G.summary,
    gaps:       G.merged,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `kc-gaps-${G.companyId}-${G.range}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  _toast('JSON downloaded');
}

// ── Download: PDF (via browser print) ───────────────────────────────────────
function downloadPDF() {
  if (!G.merged.length) { _toast('No gap data to download'); return; }
  window.print();
}

function _toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

// ════════════════════════════════════════════════════════════════════════════
// CONFIG HEALTH TAB (Structural Audit)
// ════════════════════════════════════════════════════════════════════════════

// ── Tab switching ────────────────────────────────────────────────────────────
function switchTab(tabId) {
  G.activeTab = tabId;

  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Update panels
  document.getElementById('panelGaps').classList.toggle('active',   tabId === 'gaps');
  document.getElementById('panelHealth').classList.toggle('active', tabId === 'health');

  // Lazy-load health on first switch
  if (tabId === 'health' && !G.healthLoaded) {
    loadHealth();
  }
}

function refreshActiveTab() {
  if (G.activeTab === 'health') rescanHealth();
  else loadGaps();
}

// ── Fetch health from API ────────────────────────────────────────────────────
async function loadHealth() {
  const btn = document.getElementById('btnRefresh');
  btn.disabled = true; btn.textContent = 'Loading…';

  document.getElementById('healthLoading').style.display = 'block';
  document.getElementById('healthContent').style.display = 'none';

  try {
    const res = await AgentConsoleAuth.apiFetch(
      `/api/admin/agent2/company/${G.companyId}/knowledge/health`
    );

    if (!res.success) throw new Error(res.error || 'API error');

    G.health       = res;
    G.healthLoaded = true;

    document.getElementById('healthLoading').style.display = 'none';
    document.getElementById('healthContent').style.display = 'block';

    _renderHealthSeverity();
    _renderHealthCoverage();
    _renderHealthPlatform();
    _renderHealthContainers();
    _updateHealthTabCount();
  } catch (err) {
    document.getElementById('healthLoading').innerHTML =
      `<span style="color:#dc2626;">Error: ${_esc(err.message)}</span>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Refresh';
  }
}

// ── Force re-run (bust cache) ────────────────────────────────────────────────
async function rescanHealth() {
  const btn = document.getElementById('btnRefresh');
  btn.disabled = true; btn.textContent = 'Rescanning…';

  document.getElementById('healthLoading').style.display = 'block';
  document.getElementById('healthContent').style.display = 'none';

  try {
    const res = await AgentConsoleAuth.apiFetch(
      `/api/admin/agent2/company/${G.companyId}/knowledge/health/rescan`,
      { method: 'POST' }
    );

    if (!res.success) throw new Error(res.error || 'API error');

    G.health       = res;
    G.healthLoaded = true;

    document.getElementById('healthLoading').style.display = 'none';
    document.getElementById('healthContent').style.display = 'block';

    _renderHealthSeverity();
    _renderHealthCoverage();
    _renderHealthPlatform();
    _renderHealthContainers();
    _updateHealthTabCount();
    _toast('Health rescan complete');
  } catch (err) {
    document.getElementById('healthLoading').innerHTML =
      `<span style="color:#dc2626;">Error: ${_esc(err.message)}</span>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Refresh';
  }
}

// ── Update tab count badge (shows total issue count) ─────────────────────────
function _updateHealthTabCount() {
  if (!G.health || !G.health.summary) return;
  const c = G.health.summary.severityCounts || {};
  const total = (c.CRITICAL || 0) + (c.HIGH || 0) + (c.MED || 0);
  const el = document.getElementById('tabCountHealth');
  if (el) el.textContent = String(total);
}

// Also keep the Runtime Gaps tab count in sync (patched into loadGaps via summary)
// NOTE: This hooks on every gaps load via the existing _renderSummary wrapper.
(function patchGapsCount() {
  const orig = _renderSummary;
  window._renderSummary = function() {
    orig();
    const el = document.getElementById('tabCountGaps');
    if (el && G.summary) el.textContent = String(G.summary.total || 0);
  };
})();

// ── Severity pills ───────────────────────────────────────────────────────────
function _renderHealthSeverity() {
  const c = (G.health.summary && G.health.summary.severityCounts) || {};
  const html = `
    <div class="sev-row">
      <div class="sev-card critical">
        <div class="stat-label">Critical</div>
        <div class="stat-value">${c.CRITICAL || 0}</div>
      </div>
      <div class="sev-card high">
        <div class="stat-label">High</div>
        <div class="stat-value">${c.HIGH || 0}</div>
      </div>
      <div class="sev-card med">
        <div class="stat-label">Medium</div>
        <div class="stat-value">${c.MED || 0}</div>
      </div>
      <div class="sev-card low">
        <div class="stat-label">Low</div>
        <div class="stat-value">${c.LOW || 0}</div>
      </div>
      <div class="sev-card info">
        <div class="stat-label">Info</div>
        <div class="stat-value">${c.INFO || 0}</div>
      </div>
    </div>`;
  document.getElementById('healthSeverityRow').innerHTML = html;
}

// ── Coverage bars ────────────────────────────────────────────────────────────
function _covClass(pct) {
  if (pct >= 80) return 'good';
  if (pct >= 40) return 'ok';
  return 'bad';
}

function _covBar(label, pct, rawLabel) {
  const cls = _covClass(pct);
  const width = Math.max(0, Math.min(100, pct));
  return `
    <div class="cov-row">
      <div class="cov-label">${_esc(label)}</div>
      <div class="cov-bar-track">
        <div class="cov-bar-fill ${cls}" style="width:${width}%"></div>
      </div>
      <div class="cov-value ${cls}">${rawLabel || (pct + '%')}</div>
    </div>`;
}

function _renderHealthCoverage() {
  const s  = G.health.summary || {};
  const cv = s.coverage || {};

  // noAnchorCorrectness is "N/M" — parse into pct
  let noAnchorPct = 100;
  let noAnchorRaw = cv.noAnchorCorrectness || '0/0';
  const m = /^(\d+)\/(\d+)$/.exec(noAnchorRaw);
  if (m) {
    const num = +m[1], den = +m[2];
    noAnchorPct = den === 0 ? 100 : Math.round((num / den) * 100);
  }

  const html = `
    <div class="coverage-panel">
      <div class="coverage-title">
        <span>\ud83d\udcca</span>
        <span>UAP Foundation Coverage</span>
        <span style="flex:1;"></span>
        <span style="font-size:11px;color:var(--text-muted);font-weight:500;">
          ${s.totalContainers || 0} containers &middot;
          ${s.totalSections || 0} sections &middot;
          ${s.totalPhrases || 0} phrases
        </span>
      </div>
      ${_covBar('tradeTerms filled',        cv.tradeTermsFilledPct  || 0)}
      ${_covBar('phraseCore filled',        cv.phraseCoreFilledPct  || 0)}
      ${_covBar('phraseCore embedded',      cv.phraseCoreEmbeddedPct|| 0)}
      ${_covBar('anchorWords on phrases',   cv.anchorWordsFilledPct || 0)}
      ${_covBar('noAnchor on meta-containers', noAnchorPct, noAnchorRaw)}
    </div>`;
  document.getElementById('healthCoverage').innerHTML = html;
}

// ── Platform checks ──────────────────────────────────────────────────────────
function _renderHealthPlatform() {
  const p      = G.health.platform || {};
  const checks = p.checks || [];

  if (checks.length === 0) {
    document.getElementById('healthPlatform').innerHTML = `
      <div class="platform-panel clean">
        <div class="platform-title" style="color:#065f46;">
          \u2713 Platform (GlobalShare) &mdash; clean
        </div>
        <div style="font-size:12px;color:#047857;">
          ${p.cuePatternCount || 0} cue patterns &middot;
          ${(p.tradeVocabKeys || []).length} trade vocabulary key${(p.tradeVocabKeys || []).length === 1 ? '' : 's'}
          (${(p.tradeVocabKeys || []).join(', ') || '—'})
        </div>
      </div>`;
    return;
  }

  let html = '<div class="platform-panel">';
  html += `<div class="platform-title" style="color:#991b1b;">Platform (GlobalShare) &mdash; ${checks.length} issue${checks.length === 1 ? '' : 's'}</div>`;
  for (const chk of checks) {
    html += `<div class="chk-row">`;
    html += `<span class="chk-sev ${chk.severity}">${chk.severity}</span>`;
    html += `<div class="chk-msg"><span class="chk-id">${_esc(chk.id)}</span>${_esc(chk.message)}</div>`;
    html += `</div>`;
  }
  html += `<div style="margin-top:10px;font-size:11.5px;color:var(--text-muted);">`;
  html += `${p.cuePatternCount || 0} cue patterns &middot; vocab keys: ${(p.tradeVocabKeys || []).join(', ') || '—'}`;
  html += `</div>`;
  html += '</div>';
  document.getElementById('healthPlatform').innerHTML = html;
}

// ── Container cards ──────────────────────────────────────────────────────────
function _renderHealthContainers() {
  const containers = G.health.containers || [];
  const el = document.getElementById('healthContainers');

  if (containers.length === 0) {
    el.innerHTML = `
      <div class="state-empty">
        <span class="icon">&#10003;</span>
        <h2>No containers configured</h2>
      </div>`;
    return;
  }

  let html = '';
  containers.forEach((c, idx) => {
    const counts = { CRITICAL: 0, HIGH: 0, MED: 0, LOW: 0, INFO: 0 };
    for (const chk of (c.checks || [])) counts[chk.severity] = (counts[chk.severity] || 0) + 1;

    let topSev = 'clean';
    if (counts.CRITICAL) topSev = 'critical';
    else if (counts.HIGH) topSev = 'high';
    else if (counts.MED)  topSev = 'med';
    else if (counts.LOW)  topSev = 'low';
    else if (counts.INFO) topSev = 'info';

    html += `<div class="kc-card sev-${topSev}">`;

    // Head
    html += `<div class="kc-card-head" onclick="toggleKcCard(${idx})">`;
    html += `<div style="flex:1;">`;
    html += `<div class="kc-card-title">${_esc(c.title || '(untitled)')}</div>`;
    html += `<div class="kc-card-meta">`;
    html += `${c.sectionCount || 0} sections &middot; ${c.activeSectionCount || 0} active`;
    if (c.kcId) html += ` &middot; <code style="font-size:10.5px;">${_esc(c.kcId)}</code>`;
    html += `</div>`;
    html += `</div>`;

    html += `<div class="kc-badges">`;
    if (c.isMeta)              html += `<span class="kc-badge meta">Meta</span>`;
    if (c.noAnchor)            html += `<span class="kc-badge noanchor">noAnchor</span>`;
    if (c.tradeVocabularyKey)  html += `<span class="kc-badge vocab">${_esc(c.tradeVocabularyKey)}</span>`;
    if (!c.isActive)           html += `<span class="kc-badge inactive">Inactive</span>`;
    if (counts.CRITICAL) html += `<span class="kc-badge count-crit">${counts.CRITICAL} crit</span>`;
    if (counts.HIGH)     html += `<span class="kc-badge count-high">${counts.HIGH} high</span>`;
    if (counts.MED)      html += `<span class="kc-badge count-med">${counts.MED} med</span>`;
    if (counts.LOW)      html += `<span class="kc-badge count-low">${counts.LOW} low</span>`;
    html += `</div>`;
    html += `</div>`; // kc-card-head

    // Body — open by default if CRITICAL/HIGH
    const openCls = (counts.CRITICAL || counts.HIGH) ? ' open' : '';
    html += `<div class="kc-card-body${openCls}" id="kcBody-${idx}">`;

    if (!c.checks || c.checks.length === 0) {
      html += `<div class="kc-clean">\u2713 All checks passed</div>`;
    } else {
      // Sort checks by severity rank
      const SEV_RANK = { CRITICAL: 4, HIGH: 3, MED: 2, LOW: 1, INFO: 0 };
      const sorted = [...c.checks].sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0));
      for (const chk of sorted) {
        html += `<div class="chk-row">`;
        html += `<span class="chk-sev ${chk.severity}">${chk.severity}</span>`;
        html += `<div class="chk-msg"><span class="chk-id">${_esc(chk.id)}</span>${_esc(chk.message)}</div>`;
        html += `</div>`;
      }
    }

    html += `</div>`; // kc-card-body
    html += `</div>`; // kc-card
  });

  el.innerHTML = html;
}

function toggleKcCard(idx) {
  const body = document.getElementById(`kcBody-${idx}`);
  if (body) body.classList.toggle('open');
}

// ============================================================================
// CLOSED-LOOP VERIFY / RESOLVE WORKFLOW
// ============================================================================
// The 🧪 Verify button runs the row's caller phrase through the SAME KC gates
// the production runtime uses (CueExtractor + KCS.findContainer) with zero
// side effects. On success, admin clicks Mark Done to persist a KCGapResolution
// record — that row is then hidden from the active list on next page refresh.
// ============================================================================

// Normalize a phrase the same way the server does (for gapKey / byNormalized
// lookup). MUST stay in sync with KCGapResolution.normalizePhrase on the server.
function _normalizePhrase(p) {
  if (!p || typeof p !== 'string') return '';
  return p.trim().toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Return the KCGapResolution doc matching this row's caller phrase, or null.
// Lookup is O(1) via G.byNormalized (keyed by normalizedPhrase).
function _getResolution(row) {
  if (!row || !row.question) return null;
  const norm = _normalizePhrase(row.question);
  return G.byNormalized[norm] || null;
}

// ── Filter toggle: hide resolved rows ────────────────────────────────────
function toggleHideResolved() {
  G.hideResolved = !G.hideResolved;
  _renderFilters();
  _renderTable();
}

// ── Render: per-row Verify cell ──────────────────────────────────────────
// Three visual states:
//   (1) Already resolved  → ✅ RESOLVED pill + Undo button
//   (2) Just verified now → verdict badge (green/amber/red) + Mark Done btn
//   (3) Not yet verified  → 🧪 Verify button
function _renderVerifyCell(row, idx) {
  if (!row.question) {
    return '<span style="color:#cbd5e1;font-size:11.5px;">no phrase</span>';
  }

  // State 1 — persisted resolution exists
  const resolution = _getResolution(row);
  if (resolution) {
    const status = resolution.status || 'RESOLVED';
    const icon   = status === 'RESOLVED'  ? '\u2705'   // ✅
                 : status === 'WEAK'      ? '\u26a0\ufe0f'  // ⚠️
                 : status === 'REGRESSED' ? '\ud83d\udea8'   // 🚨
                 : '\u2796';                                   // ➖ dismissed
    let html  = `<span class="resolution-pill ${status}">${icon} ${status}</span>`;
    html += ` <button class="btn-act" onclick="undoResolve(${idx})" title="Re-open this gap" style="margin-left:4px;">Undo</button>`;
    return html;
  }

  // State 2 — client-side verify result exists (fresh, not yet persisted)
  if (G.verifyByIdx[idx]) {
    return _renderVerifyBadge(G.verifyByIdx[idx], idx);
  }

  // State 3 — currently verifying
  if (G.verifyingIdx.has(idx)) {
    return '<span class="verify-badge verifying"><span class="vb-icon">\u23f3</span> Verifying\u2026</span>';
  }

  // State 4 — not verified yet
  return `<button class="btn-act" onclick="verifyRow(${idx})" title="Run this phrase through KC routing to see if it resolves now">\ud83e\uddea Verify</button>`;
}

// Render the 3-state verdict badge + Mark Done button after verify
function _renderVerifyBadge(vr, idx) {
  const verdict = vr?.verdict || 'failing';
  const icon    = verdict === 'resolved' ? '\u2713'
                : verdict === 'weak'     ? '\u26a0\ufe0f'
                : '\u2717';
  const label   = verdict.toUpperCase();

  let html = `<span class="verify-badge ${verdict}"><span class="vb-icon">${icon}</span> ${label}</span>`;

  if (verdict === 'resolved') {
    html += ` <button class="btn-act success" onclick="resolveRow(${idx})" title="Persist this as RESOLVED — row will hide on next refresh" style="margin-left:4px;">Mark Done</button>`;
  } else if (verdict === 'weak') {
    html += ` <button class="btn-act warn" onclick="resolveRow(${idx})" title="Persist as WEAK — admin flagged for follow-up" style="margin-left:4px;">Mark Weak</button>`;
  } else {
    html += ` <button class="btn-act" onclick="verifyRow(${idx})" title="Re-run verify after adding content" style="margin-left:4px;">Re-verify</button>`;
  }
  return html;
}

// Render the expanded replay detail (6 gates, matched container, failure mode,
// latency) inside the row's detail pane. Returns '' if no verify yet.
//
// GapReplayService shape:
//   { verdict, failureMode, phrase, normalizedPhrase, gapKey,
//     trace: { gate_2_4_cueExtractor, gate_2_5_uap, wordGate, coreConfirm,
//              gate_2_8_semantic, gate_3_keyword },
//     finalMatch, wouldFallThroughToLLM, latencyMs, runnerVersion }
function _renderVerifyDetail(row, idx) {
  const vr = G.verifyByIdx[idx]
          || _getResolution(row)?.replayTrace
          || _getResolution(row)?.lastVerifyResult;
  if (!vr) return '';

  const verdict     = vr.verdict || 'failing';
  const headerColor = verdict === 'resolved' ? '#166534'
                    : verdict === 'weak'     ? '#92400e'
                    : '#991b1b';
  const failureMode = vr.failureMode || (verdict === 'resolved' ? 'OK' : 'UNKNOWN');
  const trace       = vr.trace || {};

  // Legacy shape (pre-v2) fallback — old resolutions stored under gates{}.
  const legacyCe = vr.gates?.cueExtractor;
  const legacyKw = vr.gates?.keywordScoring;

  const ce = trace.gate_2_4_cueExtractor || (legacyCe ? {
    fieldCount:   legacyCe.fieldCount,
    fields:       legacyCe.fields,
    tradeMatches: legacyCe.tradeMatches,
    pass:         (legacyCe.fieldCount || 0) > 0,
  } : {});
  const uap = trace.gate_2_5_uap     || {};
  const wg  = trace.wordGate         || null;
  const cc  = trace.coreConfirm      || null;
  const sem = trace.gate_2_8_semantic|| {};
  const kw  = trace.gate_3_keyword   || (legacyKw ? {
    matched:               legacyKw.matched,
    score:                 legacyKw.score,
    threshold:             legacyKw.threshold,
    anchorFloor:           legacyKw.anchorFloor,
    matchedContainerId:    legacyKw.matchedContainerId,
    matchedContainerTitle: legacyKw.matchedContainerTitle,
    matchedSectionIdx:     legacyKw.matchedSectionIdx,
    matchedSectionLabel:   legacyKw.matchedSectionLabel,
    pass:                  legacyKw.matched,
  } : {});

  let html = `<div class="verify-detail ${verdict}">`;
  html += `<div class="verify-detail-title" style="color:${headerColor};display:flex;align-items:center;gap:8px;flex-wrap:wrap;">`;
  html += `Replay \u2014 ${verdict.toUpperCase()}`;
  html += `<span style="font-weight:500;font-size:11px;background:#f1f5f9;color:#334155;padding:2px 8px;border-radius:10px;">${_esc(failureMode)}</span>`;
  html += `<span style="font-weight:500;font-size:11px;color:#64748b;">${vr.latencyMs || 0}ms</span>`;
  if (vr.runnerVersion) {
    html += `<span style="font-weight:500;font-size:11px;color:#94a3b8;">${_esc(vr.runnerVersion)}</span>`;
  }
  html += `</div>`;

  // ── Final match summary ────────────────────────────────────────────────
  const fm = vr.finalMatch || (kw.matched ? {
    containerId:    kw.matchedContainerId,
    containerTitle: kw.matchedContainerTitle,
    sectionIdx:     kw.matchedSectionIdx,
    sectionLabel:   kw.matchedSectionLabel,
    score:          kw.score,
  } : null);

  html += '<div class="verify-gate-grid">';
  html += `<div><span class="verify-gate-label">Final container:</span> `;
  html += `<span class="verify-gate-value">${_esc(fm?.containerTitle || '\u2014 none')}</span></div>`;
  html += `<div><span class="verify-gate-label">Final section:</span> `;
  html += `<span class="verify-gate-value">${_esc(fm?.sectionLabel || '\u2014 none')}</span></div>`;
  html += `<div><span class="verify-gate-label">Would fall to LLM:</span> `;
  html += `<span class="verify-gate-value">${vr.wouldFallThroughToLLM ? 'YES \u2014 failing' : 'no'}</span></div>`;
  html += '</div>';

  // ── Per-gate grid ──────────────────────────────────────────────────────
  html += `<div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;">`;

  // GATE 2.4 — CueExtractor
  html += _renderGateCard({
    title: 'GATE 2.4 \u2014 CueExtractor',
    pass:  ce.pass === true || (ce.fieldCount || 0) > 0,
    rows: [
      ['Fields fired', `${ce.fieldCount || 0} / 8`],
      ['Trade matches', String((ce.tradeMatches || []).length)],
    ],
    footer: (() => {
      const fired = Object.entries(ce.fields || {})
        .filter(([, v]) => !!v)
        .map(([k, v]) => `<code style="font-size:10px;">${k}=\u201c${_esc(String(v))}\u201d</code>`);
      return fired.length ? fired.join(' ') : '';
    })(),
  });

  // GATE 2.5 — UAP
  html += _renderGateCard({
    title: 'GATE 2.5 \u2014 UAP (phrase index)',
    pass:  uap.pass === true,
    rows: [
      ['Match type', _esc(uap.matchType || 'NONE')],
      ['Confidence', uap.confidence != null ? Number(uap.confidence).toFixed(2) : '\u2014'],
      ['Matched phrase', uap.matchedPhrase ? `\u201c${_esc(uap.matchedPhrase)}\u201d` : '\u2014'],
    ],
  });

  // Word Gate (only present if UAP matched)
  if (wg) {
    html += _renderGateCard({
      title: 'Word Gate (\u226590% anchor)',
      pass:  wg.pass === true,
      rows: [
        ['Anchor words', `${(wg.anchorWords || []).length}`],
        ['Present', wg.presentCount != null ? `${wg.presentCount} / ${(wg.anchorWords || []).length}` : '\u2014'],
        ['Coverage', wg.coverage != null ? `${(wg.coverage * 100).toFixed(0)}%` : '\u2014'],
      ],
      footer: (wg.missingWords || []).length
        ? `<span style="color:#991b1b;">Missing: ${(wg.missingWords || []).map(w => `<code>${_esc(w)}</code>`).join(' ')}</span>`
        : '',
    });
  }

  // Core Confirm (only present if Word Gate passed)
  if (cc) {
    html += _renderGateCard({
      title: 'Core Confirm (cosine \u22650.80)',
      pass:  cc.pass === true,
      rows: [
        ['Cosine', cc.cosine != null ? cc.cosine.toFixed(3) : '\u2014'],
        ['Threshold', cc.threshold != null ? cc.threshold.toFixed(2) : '0.80'],
        ['Bypass', cc.exactBypass ? 'EXACT \u2014 skipped' : 'no'],
      ],
    });
  }

  // GATE 2.8 — Semantic
  html += _renderGateCard({
    title: 'GATE 2.8 \u2014 Semantic',
    pass:  sem.pass === true,
    rows: [
      ['Best similarity', sem.bestSimilarity != null ? sem.bestSimilarity.toFixed(3) : '\u2014'],
      ['Threshold', sem.threshold != null ? sem.threshold.toFixed(2) : '0.70'],
      ['Best container', _esc(sem.bestContainerTitle || '\u2014')],
      ['Best section', _esc(sem.bestSectionLabel || '\u2014')],
    ],
  });

  // GATE 3 — Keyword scoring
  html += _renderGateCard({
    title: 'GATE 3 \u2014 Keyword scoring',
    pass:  kw.pass === true || kw.matched === true,
    rows: [
      ['Container', _esc(kw.matchedContainerTitle || '\u2014 none')],
      ['Section', _esc(kw.matchedSectionLabel || '\u2014 none')],
      ['Score', `${kw.score != null ? kw.score : 0} (threshold ${kw.threshold || 8})`],
      ['Anchor boosted', kw.anchorBoosted ? `yes (floor ${kw.anchorFloor || 24})` : 'no'],
    ],
  });

  html += '</div>'; // per-gate grid

  // ── Fix Advisor card / button ──────────────────────────────────────────
  html += _renderFixAdvisorCard(row, idx);

  html += '</div>'; // verify-detail
  return html;
}

// Render a single gate card with pass/fail pill + key/value rows.
function _renderGateCard({ title, pass, rows, footer }) {
  const pillColor = pass ? { bg: '#dcfce7', fg: '#166534', label: 'PASS' }
                         : { bg: '#fee2e2', fg: '#991b1b', label: 'FAIL' };
  let h = `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;">`;
  h += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">`;
  h += `<span style="font-size:11px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:0.4px;">${_esc(title)}</span>`;
  h += `<span style="background:${pillColor.bg};color:${pillColor.fg};font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;">${pillColor.label}</span>`;
  h += `</div>`;
  h += `<div style="font-size:12px;color:#334155;display:flex;flex-direction:column;gap:3px;">`;
  for (const [k, v] of rows) {
    h += `<div><span style="color:#64748b;">${_esc(k)}:</span> <span style="font-weight:600;">${v}</span></div>`;
  }
  h += `</div>`;
  if (footer) h += `<div style="margin-top:6px;font-size:11px;color:#475569;">${footer}</div>`;
  h += `</div>`;
  return h;
}

// Render the Fix Advisor card: button, loading state, or rendered proposal.
function _renderFixAdvisorCard(row, idx) {
  const advisor = G.advisorByIdx[idx] || _getResolution(row)?.fixAdvisor;

  let h = `<div style="margin-top:14px;padding:12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;">`;
  h += `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">`;
  h += `<span style="font-weight:700;font-size:12px;color:#0f172a;">\ud83e\udde0 Fix Advisor</span>`;

  if (G.advisingIdx.has(idx)) {
    h += `<span style="font-size:11px;color:#64748b;">\u23f3 Asking Claude\u2026</span>`;
  } else if (advisor) {
    h += `<button class="btn-act" style="font-size:11px;" onclick="askFixAdvisor(${idx})">Re-run</button>`;
  } else {
    h += `<button class="btn-act" style="font-size:11px;background:#ede9fe;border-color:#c4b5fd;color:#5b21b6;" onclick="askFixAdvisor(${idx})">\u2728 Ask Fix Advisor</button>`;
  }
  h += `</div>`;

  if (!advisor) {
    h += `<div style="font-size:12px;color:#64748b;">Claude reads the 6-gate trace and classifies the fix as ADD_PHRASES / AUGMENT_SECTION / NEW_SECTION / ROUTING_PROBLEM. A similarity sweep vetoes NEW_SECTION if existing content already covers the phrase \u22650.80 cosine, preventing duplicate sections.</div>`;
    h += `</div>`;
    return h;
  }

  // ── Render the advisor proposal ──────────────────────────────────────
  const typeColors = {
    ADD_PHRASES:     { bg: '#dbeafe', fg: '#1e40af' },
    AUGMENT_SECTION: { bg: '#fef3c7', fg: '#92400e' },
    NEW_SECTION:     { bg: '#ede9fe', fg: '#5b21b6' },
    ROUTING_PROBLEM: { bg: '#fee2e2', fg: '#991b1b' },
  };
  const tc = typeColors[advisor.type] || { bg: '#e2e8f0', fg: '#334155' };
  const confColors = {
    HIGH:   { bg: '#dcfce7', fg: '#166534' },
    MED:    { bg: '#fef3c7', fg: '#92400e' },
    LOW:    { bg: '#fee2e2', fg: '#991b1b' },
  };
  const cc = confColors[advisor.confidence] || { bg: '#e2e8f0', fg: '#334155' };

  h += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">`;
  h += `<span style="background:${tc.bg};color:${tc.fg};font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;">${_esc(advisor.type || '\u2014')}</span>`;
  if (advisor.confidence) {
    h += `<span style="background:${cc.bg};color:${cc.fg};font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;">${_esc(advisor.confidence)} conf</span>`;
  }
  if (advisor.vetoed) {
    h += `<span style="background:#fee2e2;color:#991b1b;font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;">\ud83d\udea7 veto: ${_esc(advisor.vetoReason || 'similarity sweep')}</span>`;
  }
  if (advisor.advisorModel) {
    h += `<span style="color:#94a3b8;font-size:10px;align-self:center;">${_esc(advisor.advisorModel)} \u00b7 ${advisor.latencyMs || 0}ms</span>`;
  }
  h += `</div>`;

  // Target container/section
  if (advisor.target) {
    h += `<div style="font-size:12px;color:#334155;margin-bottom:8px;">`;
    h += `<span style="color:#64748b;">Target:</span> <strong>${_esc(advisor.target.containerTitle || '\u2014')}</strong>`;
    if (advisor.target.sectionLabel) {
      h += ` \u203a <strong>${_esc(advisor.target.sectionLabel)}</strong>`;
    }
    h += `</div>`;
  }

  // Reasoning
  if (advisor.reasoning) {
    h += `<div style="font-size:12px;color:#334155;margin-bottom:8px;line-height:1.5;"><span style="color:#64748b;">Why:</span> ${_esc(advisor.reasoning)}</div>`;
  }

  // Proposal body
  const prop = advisor.proposal || {};
  if (Array.isArray(prop.phrasesToAdd) && prop.phrasesToAdd.length) {
    h += `<div style="font-size:12px;margin-bottom:6px;"><span style="color:#64748b;">Phrases to add:</span></div>`;
    h += `<ul style="margin:0 0 8px 18px;padding:0;font-size:12px;color:#0f172a;">`;
    for (const p of prop.phrasesToAdd.slice(0, 12)) {
      h += `<li>\u201c${_esc(p)}\u201d</li>`;
    }
    h += `</ul>`;
  }
  if (prop.sectionLabel || prop.sectionContent) {
    h += `<div style="font-size:12px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:8px;margin-bottom:8px;">`;
    if (prop.sectionLabel)   h += `<div><strong>${_esc(prop.sectionLabel)}</strong></div>`;
    if (prop.sectionContent) h += `<div style="margin-top:4px;color:#334155;">${_esc(prop.sectionContent)}</div>`;
    h += `</div>`;
  }
  if (prop.routingIssue) {
    h += `<div style="font-size:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:8px;margin-bottom:8px;color:#991b1b;"><strong>Routing issue:</strong> ${_esc(prop.routingIssue)}</div>`;
  }

  // Near-misses
  if (Array.isArray(advisor.nearMisses) && advisor.nearMisses.length) {
    h += `<details style="margin-bottom:8px;"><summary style="font-size:11px;color:#475569;cursor:pointer;">Near-misses (${advisor.nearMisses.length}) \u2014 existing content ranked by cosine</summary>`;
    h += `<table style="width:100%;margin-top:6px;font-size:11px;border-collapse:collapse;">`;
    for (const nm of advisor.nearMisses.slice(0, 5)) {
      h += `<tr style="border-bottom:1px solid #e2e8f0;">`;
      h += `<td style="padding:3px 6px;font-weight:600;">${nm.similarity != null ? nm.similarity.toFixed(3) : '\u2014'}</td>`;
      h += `<td style="padding:3px 6px;color:#334155;">${_esc(nm.containerTitle || '\u2014')}</td>`;
      h += `<td style="padding:3px 6px;color:#64748b;">${_esc(nm.sectionLabel || '\u2014')}</td>`;
      h += `<td style="padding:3px 6px;color:#94a3b8;font-size:10px;">${_esc(nm.source || '\u2014')}</td>`;
      h += `</tr>`;
    }
    h += `</table></details>`;
  }

  // Deep-link to editor
  if (advisor.target?.containerId) {
    const url = `/agent-console/services-item.html?companyId=${G.companyId}&kcId=${advisor.target.kcId || ''}&containerId=${advisor.target.containerId}${advisor.target.sectionIdx != null ? `&sectionIdx=${advisor.target.sectionIdx}` : ''}`;
    h += `<a href="${url}" class="btn-act success" style="font-size:11px;text-decoration:none;display:inline-block;">\u270f\ufe0f Open in editor</a>`;
  }

  h += `</div>`;
  return h;
}

// ── Action: verify a single row ──────────────────────────────────────────
async function verifyRow(idx) {
  const row = G.merged[idx];
  if (!row || !row.question) { _toast('No phrase to verify'); return; }

  G.verifyingIdx.add(idx);
  _rerenderRow(idx);

  try {
    const res = await AgentConsoleAuth.apiFetch(
      `/api/admin/agent2/company/${G.companyId}/knowledge/gaps/verify`,
      {
        method: 'POST',
        body: JSON.stringify({
          phrase:              row.question,
          expectedContainerId: row.containerId || null,
        }),
      }
    );
    if (!res.success) throw new Error(res.error || 'verify failed');

    G.verifyByIdx[idx] = res.verify;
    // New verify invalidates any previous advisor output for this row
    delete G.advisorByIdx[idx];
    const verdict = res.verify?.verdict || 'failing';
    const fm      = res.verify?.failureMode || '';
    _toast(
      verdict === 'resolved' ? '\u2713 Routes cleanly \u2014 ready to mark done' :
      verdict === 'weak'     ? `\u26a0\ufe0f  Matches but weakly (${fm}) \u2014 review details` :
                               `\u2717 Still failing (${fm}) \u2014 run Fix Advisor`
    );
  } catch (err) {
    _toast('Verify error: ' + err.message);
    console.error('[verifyRow]', err);
  } finally {
    G.verifyingIdx.delete(idx);
    _rerenderRow(idx);
  }
}

// ── Action: persist verify result as a KCGapResolution ───────────────────
async function resolveRow(idx) {
  const row = G.merged[idx];
  const vr  = G.verifyByIdx[idx];
  if (!row || !row.question || !vr) { _toast('Run Verify first'); return; }

  try {
    const res = await AgentConsoleAuth.apiFetch(
      `/api/admin/agent2/company/${G.companyId}/knowledge/gaps/resolve`,
      {
        method: 'POST',
        body: JSON.stringify({
          phrase:                 row.question,
          verifyResult:           vr,
          fixAdvisor:             G.advisorByIdx[idx] || undefined,
          originalType:           row.displayType,
          originalContainerId:    row.containerId   || null,
          originalContainerTitle: row.containerTitle || null,
        }),
      }
    );
    if (!res.success) throw new Error(res.error || 'resolve failed');

    // Merge into local state so row flips immediately
    const doc = res.resolution;
    G.resolutions[doc.gapKey]          = doc;
    G.byNormalized[doc.normalizedPhrase] = doc;
    delete G.verifyByIdx[idx];
    delete G.advisorByIdx[idx];

    _toast(`\u2705 Marked resolved \u2014 ${doc.status}`);
    _renderFilters();    // resolvedCount badge updates
    _renderTable();      // may hide this row immediately if hideResolved=true
  } catch (err) {
    _toast('Resolve error: ' + err.message);
    console.error('[resolveRow]', err);
  }
}

// ── Action: ask the Fix Advisor to classify + draft a fix ─────────────────
// Calls POST /gaps/fix-advisor with the current verify trace so Claude has
// authoritative gate outcomes. Stores result on G.advisorByIdx[idx] so the
// Fix Advisor card renders inline. Safe to call repeatedly.
async function askFixAdvisor(idx) {
  const row = G.merged[idx];
  if (!row || !row.question) { _toast('No phrase to advise on'); return; }

  G.advisingIdx.add(idx);
  _rerenderRow(idx);

  try {
    const res = await AgentConsoleAuth.apiFetch(
      `/api/admin/agent2/company/${G.companyId}/knowledge/gaps/fix-advisor`,
      {
        method: 'POST',
        body: JSON.stringify({
          phrase:                 row.question,
          replayTrace:            G.verifyByIdx[idx] || null,
          originalContainerId:    row.containerId    || null,
          originalContainerTitle: row.containerTitle || null,
        }),
      }
    );
    if (!res.success) throw new Error(res.error || 'advisor failed');

    G.advisorByIdx[idx] = res.advisor;
    // Backfill verify cache if the server replayed for us
    if (res.replayTrace && !G.verifyByIdx[idx]) G.verifyByIdx[idx] = res.replayTrace;

    const a = res.advisor || {};
    _toast(
      a.vetoed
        ? `\u2728 Advisor: ${a.type} (veto downgrade applied)`
        : `\u2728 Advisor: ${a.type || 'unknown'} \u00b7 ${a.confidence || '\u2014'} confidence`
    );
  } catch (err) {
    _toast('Advisor error: ' + err.message);
    console.error('[askFixAdvisor]', err);
  } finally {
    G.advisingIdx.delete(idx);
    _rerenderRow(idx);
  }
}

// ── Action: undo a previously persisted resolution ───────────────────────
async function undoResolve(idx) {
  const row = G.merged[idx];
  if (!row || !row.question) return;
  const res = _getResolution(row);
  if (!res) return;

  if (!confirm(`Re-open this gap?\n\n"${row.question}"\n\nThis removes the resolution record so the row reappears on the active list.`)) return;

  try {
    const apiRes = await AgentConsoleAuth.apiFetch(
      `/api/admin/agent2/company/${G.companyId}/knowledge/gaps/resolutions/${res.gapKey}`,
      { method: 'DELETE' }
    );
    if (!apiRes.success) throw new Error(apiRes.error || 'undo failed');

    delete G.resolutions[res.gapKey];
    delete G.byNormalized[res.normalizedPhrase];
    _toast('Resolution re-opened');
    _renderFilters();
    _renderTable();
  } catch (err) {
    _toast('Undo error: ' + err.message);
    console.error('[undoResolve]', err);
  }
}

// ── Action: bulk verify every unresolved row in the current view ─────────
// Runs in sequence (not parallel) to avoid hammering the server on 100+ rows.
async function verifyAll() {
  const targets = G.merged
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => row.question && !_getResolution(row) && !G.verifyByIdx[row?._k]);

  if (!targets.length) { _toast('Nothing to verify'); return; }

  if (!confirm(`Run UAP verify on ${targets.length} rows?\n\nThis tests each caller phrase against live KC routing. Takes ~${Math.ceil(targets.length * 0.3)}s.`)) return;

  _toast(`Verifying ${targets.length} rows\u2026`);

  let done = 0;
  for (const t of targets) {
    try {
      // Inlined — avoids toast spam per-row; share state with verifyRow
      G.verifyingIdx.add(t.idx);
      _rerenderRow(t.idx);

      const res = await AgentConsoleAuth.apiFetch(
        `/api/admin/agent2/company/${G.companyId}/knowledge/gaps/verify`,
        {
          method: 'POST',
          body: JSON.stringify({
            phrase:              t.row.question,
            expectedContainerId: t.row.containerId || null,
          }),
        }
      );
      if (res.success) G.verifyByIdx[t.idx] = res.verify;
    } catch (err) {
      console.warn('[verifyAll] row failed', t.idx, err.message);
    } finally {
      G.verifyingIdx.delete(t.idx);
      _rerenderRow(t.idx);
      done++;
    }
  }

  // Tally results
  const tally = { resolved: 0, weak: 0, failing: 0 };
  for (const t of targets) {
    const v = G.verifyByIdx[t.idx];
    if (v) tally[v.verdict] = (tally[v.verdict] || 0) + 1;
  }
  _toast(`Done: ${tally.resolved} resolved \u00b7 ${tally.weak} weak \u00b7 ${tally.failing} failing`);
}

// Re-render a single row's verify cell + detail without full table repaint
function _rerenderRow(idx) {
  const row = G.merged[idx];
  if (!row) return;

  // Find the verify-cell td via the detail-row id reference — rebuild via full
  // render since each row's verify cell needs both row & idx. Keeps code simple.
  // For 500 rows at most this is still sub-10ms.
  _renderTable();

  // Reopen the detail row if it was open (re-render collapses it by default)
  const detail = document.getElementById(`detail-${idx}`);
  if (detail) detail.classList.add('open');
}

// ── Toast ────────────────────────────────────────────────────────────────
// Reuse existing _toast if defined; otherwise minimal inline fallback.
if (typeof window._toast === 'undefined' && typeof _toast === 'undefined') {
  // eslint-disable-next-line no-unused-vars
  window._toast = function(msg) {
    const el = document.getElementById('toast');
    if (!el) { console.log('[toast]', msg); return; }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(window.__toastT);
    window.__toastT = setTimeout(() => el.classList.remove('show'), 2400);
  };
}
