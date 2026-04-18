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
    const qs  = `range=${G.range}&type=${G.typeFilter}${G.showTurn1 ? '&turn1=1' : ''}`;
    const res = await AgentConsoleAuth.apiFetch(
      `/api/admin/agent2/company/${G.companyId}/knowledge/gaps?${qs}`
    );

    if (!res.success) throw new Error(res.error || 'API error');

    G.gaps    = res.gaps || [];
    G.summary = res.summary || {};
    G.merged  = _mergeGapEntries(G.gaps);

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
  html += `${G.showTurn1 ? '✓ ' : ''}Turn 1`;
  html += '</button>';
  html += '</div>';

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

  let html = '<div class="table-wrap"><table class="gap-table"><thead><tr>';
  html += '<th>Time</th>';
  html += '<th>Caller Phrase</th>';
  html += '<th>Agent Response</th>';
  html += '<th>Container</th>';
  html += '<th>Type</th>';
  html += '<th>Actions</th>';
  html += '</tr></thead><tbody>';

  G.merged.forEach((row, idx) => {
    const time      = _fmtTime(row.timestamp);
    const phrase    = _clip(row.question, 80);
    const answer    = _clip(row.answer, 60);
    const container = row.containerTitle || '—';
    const badge     = _typeBadge(row.displayType);

    // Data row
    html += `<tr class="data-row" onclick="toggleDetail(${idx})">`;
    html += `<td style="white-space:nowrap;font-size:12px;color:var(--text-muted);">${_esc(time)}</td>`;
    html += `<td class="phrase-cell">${_esc(phrase)}</td>`;
    html += `<td class="response-cell">${answer ? _esc(answer) : '<span style="color:#cbd5e1;">—</span>'}</td>`;
    html += `<td style="font-size:12px;">${_esc(container)}</td>`;
    // Occurrence badge for containers with multiple section gaps
    const _occ = (row.containerId && row.displayType === 'KC_SECTION_GAP')
      ? (G.containerGapCounts[row.containerId] || 0)
      : 0;
    html += `<td>${badge}`;
    if (_occ > 1) html += ` <span class="occ-badge">${_occ}\u00d7</span>`;
    html += `</td>`;
    html += `<td class="actions-cell" onclick="event.stopPropagation();">`;
    html += `  <button class="btn-act" onclick="copyPhrase(${idx})" title="Copy caller phrase to clipboard">Copy</button>`;
    html += `  <button class="btn-act primary" onclick="openFinder(${idx})" title="Open in Phrase Finder">Finder &rarr;</button>`;
    html += `</td>`;
    html += `</tr>`;

    // Detail row (hidden by default)
    html += `<tr class="detail-row" id="detail-${idx}"><td colspan="6" class="detail-cell">`;
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
