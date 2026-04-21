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

  // ── Phase C — deep-link filters (URL-driven, Call Intelligence entry-point)
  // When set via ?filterContainer / ?filterSection / ?filterPhrase, only rows
  // matching these stay visible. Banner shows active filter + "Clear" button.
  deepLinkContainer: null,   // containerId string
  deepLinkSection:   null,   // section label or index string
  deepLinkPhrase:    null,   // raw phrase string (normalized compare)
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

  // Phase C — hydrate deep-link filters from URL (Call Intelligence entry-point)
  G.deepLinkContainer = params.get('filterContainer') || null;
  G.deepLinkSection   = params.get('filterSection')   || null;
  G.deepLinkPhrase    = params.get('filterPhrase')    || null;

  // Back button → services.html
  document.getElementById('btnBack').href =
    `/agent-console/services.html?companyId=${G.companyId}`;

  loadGaps();
})();

// Phase C — "Clear deep-link" button handler. Strips filter* params from
// URL without reloading, then re-renders the table with full gap list.
// Exposed globally so the banner's onclick= can call it.
window.clearDeepLink = function() {
  G.deepLinkContainer = null;
  G.deepLinkSection   = null;
  G.deepLinkPhrase    = null;
  const url = new URL(location.href);
  url.searchParams.delete('filterContainer');
  url.searchParams.delete('filterSection');
  url.searchParams.delete('filterPhrase');
  history.replaceState({}, '', url.toString());
  _renderTable();
};

// Phase C — case-insensitive phrase normalizer matching KCGapResolution
// normalization (trim + lowercase + collapse whitespace). Used to compare
// deepLinkPhrase against row.question without a network round-trip.
function _normalizeForMatch(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Phase C — apply deep-link filters to a merged row. Returns true if the row
// should remain visible. ANY of the three filters matching is sufficient —
// Call Intelligence typically sets two (container + phrase) to pinpoint the
// exact event, but we OR-match so partial data still produces useful results.
function _matchesDeepLink(row) {
  if (!G.deepLinkContainer && !G.deepLinkSection && !G.deepLinkPhrase) return true;

  if (G.deepLinkContainer) {
    const candidates = [
      row.containerId,
      row.rescuedContainerId,
      row.suppressedContainerId,
      ...(row.occurrences || []).map(o => o.containerId),
    ].filter(Boolean).map(String);
    if (candidates.includes(String(G.deepLinkContainer))) return true;
  }

  if (G.deepLinkSection) {
    const target    = String(G.deepLinkSection);
    const candidates = [
      row.sectionId,
      row.rescuedSectionId,
      row.sectionLabel,
      row.rescuedSection,
    ].filter(Boolean).map(String);
    if (candidates.includes(target)) return true;
    // Allow partial match on numeric section index (e.g. "3" matches "abc-3-07")
    if (candidates.some(c => c.endsWith(`-${target}`))) return true;
  }

  if (G.deepLinkPhrase) {
    const norm = _normalizeForMatch(G.deepLinkPhrase);
    if (_normalizeForMatch(row.question).includes(norm)) return true;
    if ((row.occurrences || []).some(o => _normalizeForMatch(o.question).includes(norm))) return true;
  }

  return false;
}

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

    G.gaps      = gapsRes.gaps || [];
    G.summary   = gapsRes.summary || {};
    // Two-level merge:
    //   1. Turn-merge — collapses GAP + FALLBACK from the same call-turn
    //   2. Phrase-dedup — collapses same phrase across multiple calls (gapKey)
    // G.merged is the DISPLAY array (one row per unique phrase). All existing
    // idx-based callbacks (verify, markDone, copyPhrase, etc.) index into it.
    // Each row carries `occurrences[]` for expand-into-per-call breakdown.
    G.rawMerged = _mergeGapEntries(G.gaps);
    G.merged    = _groupByGapKey(G.rawMerged);

    // resolutions loaded into G.resolutions + G.byNormalized by _loadResolutions
    // (void return — mutates state directly)
    void resolutionsRes;

    // Build prescriptive recommendations from the RAW call-turn stream
    // (not the deduped display rows) so counts reflect real call volume.
    const recResult       = _buildRecommendations(G.rawMerged);
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
// Collapses multiple qaLog events from same callSid+turn into one row.
// Different events carry different info: GAP has container, FALLBACK has the
// answer, UAP_MISS_KEYWORD_RESCUED has the rescued container + cueFrame, etc.
//
// Pre-filter: UAP_LAYER1 events with hit=false are telemetry noise for this
// page (represented in Call Review instead). We only surface hit=true for
// UAP Health aggregates; individual row rendering skips them entirely.
function _mergeGapEntries(gaps) {
  const byKey = {};
  const order = [];

  for (const g of gaps) {
    // Skip non-hit UAP_LAYER1 telemetry entries (noise for the gap table)
    if (g.type === 'UAP_LAYER1' && !g.hit) continue;

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
        gapKey:         g.gapKey || null,
        normalizedPhrase: g.normalizedPhrase || null,
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

    // Preserve gapKey / normalizedPhrase stamped by server
    if (g.gapKey && !row.gapKey) row.gapKey = g.gapKey;
    if (g.normalizedPhrase && !row.normalizedPhrase) row.normalizedPhrase = g.normalizedPhrase;

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

    // UAP_MISS_KEYWORD_RESCUED — "add this phrase to UAP" signal
    if (g.type === 'UAP_MISS_KEYWORD_RESCUED') {
      row.rescuedContainerId     = g.rescuedContainerId     || row.rescuedContainerId;
      row.rescuedContainerTitle  = g.rescuedContainerTitle  || row.rescuedContainerTitle;
      row.rescuedKcId            = g.rescuedKcId            || row.rescuedKcId;
      row.rescuedSection         = g.rescuedSection         || row.rescuedSection;
      row.rescuedSectionIdx      = (g.rescuedSectionIdx ?? row.rescuedSectionIdx) ?? null;
      row.rescuedScore           = g.rescuedScore           || row.rescuedScore;
      row.cueFrame               = g.cueFrame               || row.cueFrame;
      // Treat rescued container as the "container of interest" for this row
      // (ensures Verify / Fix Advisor can find it, even without KC_SECTION_GAP).
      row.containerTitle = row.containerTitle || g.rescuedContainerTitle;
      row.containerId    = row.containerId    || g.rescuedContainerId;
      row.kcId           = row.kcId           || g.rescuedKcId;
    }

    // KC_SECTION_GAP_RESCUED — cross-container rescue (near-miss signal)
    if (g.type === 'KC_SECTION_GAP_RESCUED') {
      row.rescuedFromContainer = g.originalContainer || row.rescuedFromContainer;
      row.rescuedToContainer   = g.rescuedContainer   || row.rescuedToContainer;
      row.rescuedFromScore     = g.originalScore      || row.rescuedFromScore;
    }

    // NEGATIVE_KEYWORD_BLOCK — suppression visibility
    if (g.type === 'NEGATIVE_KEYWORD_BLOCK') {
      row.suppressedContainerTitle = g.suppressedContainerTitle || row.suppressedContainerTitle;
      row.suppressedContainerId    = g.suppressedContainerId    || row.suppressedContainerId;
      row.blockedBy                = g.blockedBy                || row.blockedBy;
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

  // Determine display type for merged row using verdict priority.
  // Priority reflects user impact: SECTION_GAP > FULL_MISS_GROQ > UAP_MISS_KEYWORD_SAVE
  //                               > GRACEFUL_ACK > SECTION_GAP_RESCUED > NEG_BLOCK
  const merged = order.map(k => {
    const row = byKey[k];
    if      (row.types.includes('KC_SECTION_GAP'))           row.displayType = 'KC_SECTION_GAP';
    else if (row.types.includes('KC_LLM_FALLBACK'))          row.displayType = 'KC_LLM_FALLBACK';
    else if (row.types.includes('UAP_MISS_KEYWORD_RESCUED')) row.displayType = 'UAP_MISS_KEYWORD_RESCUED';
    else if (row.types.includes('KC_GRACEFUL_ACK'))          row.displayType = 'KC_GRACEFUL_ACK';
    else if (row.types.includes('KC_SECTION_GAP_RESCUED'))   row.displayType = 'KC_SECTION_GAP_RESCUED';
    else if (row.types.includes('NEGATIVE_KEYWORD_BLOCK'))   row.displayType = 'NEGATIVE_KEYWORD_BLOCK';
    else                                                     row.displayType = row.types[0] || 'UNKNOWN';
    return row;
  });

  // Sort newest first
  merged.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return merged;
}

// ── Phrase-level dedup ───────────────────────────────────────────────────────
// Collapses call-turn rows that share the same normalized caller phrase.
// Same phrase × 7 callers → 1 row with occurrences.length === 7.
// gapKey is stamped by the server (sha1(companyId + ':' + normalizedPhrase))
// using the exact same hash the resolution system uses, so grouped rows
// join 1:1 with /gaps/resolutions docs.
//
// Ungrouped fallbacks:
//   - rows with no question text → key by callSid:turn (can't dedup safely)
//   - rows without a server-issued gapKey → same fallback
function _groupByGapKey(rawMerged) {
  const byKey = {};
  const order = [];

  for (const row of rawMerged) {
    // Group key: prefer server gapKey; fall back to call-turn identity so
    // rows missing a question text still render (one row each, un-deduped).
    const key = row.gapKey || `__callturn__:${row.callSid || ''}:${row.turn ?? ''}`;

    if (!byKey[key]) {
      // First occurrence — clone shallow, add group accumulators.
      byKey[key] = {
        ...row,
        occurrences:     [],
        occurrenceCount: 0,
        callSids:        new Set(),
        firstSeen:       row.timestamp || null,
        latestSeen:      row.timestamp || null,
      };
      order.push(key);
    }

    const group = byKey[key];
    group.occurrences.push({
      callSid:    row.callSid || null,
      turn:       row.turn ?? null,
      timestamp:  row.timestamp || null,
      callReason: row.callReason || null,
      answer:     row.answer || null,
      types:      row.types || [],
    });
    group.occurrenceCount++;
    if (row.callSid) group.callSids.add(row.callSid);

    // Keep the newest event's container / answer (more relevant than stale).
    // Representative row already points to the newest event because
    // _mergeGapEntries sorted desc, so only update if strictly newer.
    if (row.timestamp && group.latestSeen && row.timestamp > group.latestSeen) {
      group.latestSeen     = row.timestamp;
      group.timestamp      = row.timestamp;
      group.callSid        = row.callSid        || group.callSid;
      group.turn           = row.turn ?? group.turn;
      group.callReason     = row.callReason     || group.callReason;
      group.answer         = row.answer         || group.answer;
      group.containerTitle = row.containerTitle || group.containerTitle;
      group.containerId    = row.containerId    || group.containerId;
      group.kcId           = row.kcId           || group.kcId;
      group.displayType    = row.displayType    || group.displayType;
    }
    if (row.timestamp && (!group.firstSeen || row.timestamp < group.firstSeen)) {
      group.firstSeen = row.timestamp;
    }
  }

  // Convert callSids Set → count for JSON-friendly display
  const grouped = order.map(k => {
    const g = byKey[k];
    g.uniqueCallers = g.callSids.size;
    delete g.callSids;       // drop the Set (not serializable, not needed)
    // Sort occurrences newest-first for expand display
    g.occurrences.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    return g;
  });

  // Sort: highest occurrence count first, then newest. This puts
  // "× 7 callers" rows at the top so the admin fixes high-volume gaps first.
  grouped.sort((a, b) => {
    if (b.occurrenceCount !== a.occurrenceCount) {
      return b.occurrenceCount - a.occurrenceCount;
    }
    return (b.timestamp || '').localeCompare(a.timestamp || '');
  });
  return grouped;
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
// 4 cards summarize the ACTIONABLE miss backlog. Colors encode severity:
//   UAP Miss (KeySv) — amber (the "add phrase" backlog)
//   Section Gaps     — red (container matched but no section answered)
//   UAP Miss → Groq  — red (full miss, most expensive outcome)
//   Graceful Ack     — gray (worst case, all paths exhausted)
//
// UAP Hit Rate, UAP Hits, Top 10 UAP Hits/Misses, and the winning-gate
// breakdown now live on /agent-console/uap.html Calibration tab. This page
// stays focused on actionable rows with per-row Verify + Fix Advisor.
function _renderSummary() {
  const s   = G.summary || {};
  const bt  = s.byType || {};
  const uapKeyResc = s.uapKeyResc ?? 0;
  const gap = bt.KC_SECTION_GAP   || 0;
  const fb  = bt.KC_LLM_FALLBACK  || 0;
  const ack = bt.KC_GRACEFUL_ACK  || 0;

  document.getElementById('statCards').innerHTML = `
    <div class="stat-row">
      <div class="stat-card uap-miss-key" title="UAP missed, GATE 3 keyword rescued — each row is a phrase to add to UAP">
        <div class="stat-label">UAP Miss → Key Save</div>
        <div class="stat-value">${uapKeyResc}</div>
      </div>
      <div class="stat-card gap" title="Container matched but no section covered the utterance">
        <div class="stat-label">Section Gaps</div>
        <div class="stat-value">${gap}</div>
      </div>
      <div class="stat-card fb" title="Full UAP miss — Groq had to answer from KB context">
        <div class="stat-label">UAP Miss → Groq</div>
        <div class="stat-value">${fb}</div>
      </div>
      <div class="stat-card ack" title="All paths exhausted — canned safety response">
        <div class="stat-label">Graceful Ack</div>
        <div class="stat-value">${ack}</div>
      </div>
    </div>`;

  _renderUapHealthPointer();
}

// ── Render: small banner pointing to the UAP Intelligence Calibration tab ─
// Keeps the gap page focused on actionable triage while giving admins an
// obvious path to the read-only UAP pipeline health dashboard.
function _renderUapHealthPointer() {
  const el = document.getElementById('uapHealthPointer');
  if (!el) return;
  const cid  = G.companyId || '';
  const href = `uap.html${cid ? `?companyId=${encodeURIComponent(cid)}` : ''}`;
  el.innerHTML = `UAP Hit Rate, Top UAP Hits, and Top UAP Misses now live on
    <a href="${href}">UAP Intelligence → Calibration</a>. This page stays
    focused on the actionable miss backlog below.`;
}

// ── UAP Health card REMOVED (moved to /agent-console/uap.html Calibration) ──
// _renderUapHealth(), toggleUapHealth(), and filterByContainer() are intentionally
// deleted. The gap page no longer duplicates the read-only UAP pipeline
// dashboard — see _renderUapHealthPointer() above for the link.

// ── Render: Filter bar ───────────────────────────────────────────────────────
function _renderFilters() {
  const rangeOpts = [
    { key: '24h', label: '24h' },
    { key: '7d',  label: '7 days' },
    { key: '30d', label: '30 days' },
  ];
  const typeOpts = [
    { key: 'all',                      label: 'All Types' },
    { key: 'UAP_MISS_KEYWORD_RESCUED', label: 'UAP Miss → Key Save' },
    { key: 'KC_SECTION_GAP',           label: 'Section Gap' },
    { key: 'KC_LLM_FALLBACK',          label: 'UAP Miss → Groq' },
    { key: 'KC_GRACEFUL_ACK',          label: 'Graceful Ack' },
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

  // Filter pipeline:
  //   1. Phase C deep-link — container/section/phrase from URL
  //   2. Resolved filter — optional hide rows with active resolution
  const visibleRows = G.merged
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => _matchesDeepLink(row))
    .filter(({ row }) => {
      if (!G.hideResolved) return true;
      const res = _getResolution(row);
      return !res;
    });

  // Phase C — deep-link active banner (shown above table when URL filters on)
  const deepLinkActive = !!(G.deepLinkContainer || G.deepLinkSection || G.deepLinkPhrase);
  const bannerHtml = deepLinkActive ? (() => {
    const parts = [];
    if (G.deepLinkPhrase)    parts.push(`phrase <code>${_esc(G.deepLinkPhrase.slice(0, 60))}</code>`);
    if (G.deepLinkContainer) parts.push(`container <code>${_esc(G.deepLinkContainer)}</code>`);
    if (G.deepLinkSection)   parts.push(`section <code>${_esc(G.deepLinkSection)}</code>`);
    return `
      <div style="padding:10px 14px; margin-bottom:12px; background:#fef3c7; border-left:4px solid #d97706; border-radius:6px; display:flex; align-items:center; justify-content:space-between; font-size:13px;">
        <span style="color:#78350f;"><strong>Deep-link filter active:</strong> ${parts.join(' &bull; ')} \u2014 showing ${visibleRows.length} of ${G.merged.length} rows</span>
        <button onclick="clearDeepLink()" style="padding:6px 12px; background:#fff; border:1px solid #d97706; color:#78350f; border-radius:4px; cursor:pointer; font-size:12px;">Clear filter</button>
      </div>`;
  })() : '';

  if (!visibleRows.length) {
    const hiddenCount = G.merged.length;
    const emptyMsg = deepLinkActive
      ? `<h2>No matches</h2><p>No rows match the active deep-link filter.<br><button class="btn-act" onclick="clearDeepLink()">Clear filter</button></p>`
      : `<h2>All clear!</h2><p>${hiddenCount} gap event${hiddenCount > 1 ? 's are' : ' is'} marked resolved.<br><button class="btn-act" onclick="toggleHideResolved()">Show resolved rows</button></p>`;
    document.getElementById('gapTable').innerHTML = bannerHtml + `
      <div class="state-empty">
        <span class="icon">\u2728</span>
        ${emptyMsg}
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
    const occCount   = row.occurrenceCount || 1;
    const callerCt   = row.uniqueCallers   || 0;
    // "× N callers" chip — only shown when the same phrase came in from
    // multiple distinct calls. Clicking still expands the row; detail
    // panel lists every call-turn occurrence.
    const phraseChip = (occCount > 1)
      ? ` <span class="repeat-chip" title="${occCount} events from ${callerCt} unique calls"> \u00d7 ${occCount}${callerCt && callerCt !== occCount ? ` / ${callerCt} calls` : callerCt ? ' calls' : ''}</span>`
      : '';
    html += `<tr class="data-row${resolvedCls}" onclick="toggleDetail(${idx})">`;
    html += `<td style="white-space:nowrap;font-size:12px;color:var(--text-muted);">${_esc(time)}</td>`;
    html += `<td class="phrase-cell">${_esc(phrase)}${phraseChip}</td>`;
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
    // Representative-call metadata (newest occurrence)
    html += _detailField('Latest Call SID', row.callSid || '—');
    html += _detailField('Latest Turn', row.turn != null ? String(row.turn) : '—');
    html += _detailField('Call Reason', row.callReason || '—');
    html += _detailField('Event Types', row.types.join(', '));

    if (row.containerId) {
      html += _detailField('Container ID', row.containerId);
    }
    if (row.kcId) {
      const kcLink = `/agent-console/services.html?companyId=${G.companyId}#kc-${row.kcId}`;
      html += `<div><div class="detail-label">KC Card</div><div class="detail-value"><a href="${kcLink}" target="_blank">${_esc(row.kcId)}</a></div></div>`;
    }
    html += _detailField('Latest Seen', row.latestSeen || row.timestamp || '—');
    if (row.firstSeen && row.firstSeen !== (row.latestSeen || row.timestamp)) {
      html += _detailField('First Seen', row.firstSeen);
    }
    if ((row.occurrenceCount || 1) > 1) {
      html += _detailField('Total Occurrences',
        `${row.occurrenceCount} events across ${row.uniqueCallers || 0} unique call${(row.uniqueCallers || 0) !== 1 ? 's' : ''}`);
    }

    // Merged types indicator (representative call-turn)
    if (row.types.length > 1) {
      html += _detailField('Merged', `${row.types.length} events from same call turn`);
    }

    // UAP_MISS_KEYWORD_RESCUED — show rescue target explicitly
    if (row.displayType === 'UAP_MISS_KEYWORD_RESCUED') {
      const rtitle = row.rescuedContainerTitle || row.containerTitle || '—';
      const rsect  = row.rescuedSection ? ` \u2192 "${row.rescuedSection}"` : '';
      const rscore = row.rescuedScore != null ? ` (score: ${row.rescuedScore})` : '';
      html += _detailField('Rescued By', `${rtitle}${rsect}${rscore}`);
      if (row.cueFrame && row.cueFrame.fieldCount != null) {
        const fc = row.cueFrame.fieldCount;
        const cueHint = fc < 3 ? ' \u2014 sparse cues (dictionary thin for this topic)' : '';
        html += _detailField('Cue Fields', `${fc} of 8 populated${cueHint}`);
      }
    }

    // KC_SECTION_GAP_RESCUED — show cross-container swap
    if (row.displayType === 'KC_SECTION_GAP_RESCUED' && row.rescuedFromContainer) {
      html += _detailField('Cross-Container Rescue',
        `${row.rescuedFromContainer} \u2192 ${row.rescuedToContainer || '?'}`);
    }

    // NEGATIVE_KEYWORD_BLOCK — show what was suppressed
    if (row.displayType === 'NEGATIVE_KEYWORD_BLOCK' && row.suppressedContainerTitle) {
      const by = row.blockedBy ? ` (by "${row.blockedBy}")` : '';
      html += _detailField('Suppressed', `${row.suppressedContainerTitle}${by}`);
    }

    html += '</div>';

    // Per-call occurrence breakdown — only meaningful when grouped
    if ((row.occurrenceCount || 1) > 1 && Array.isArray(row.occurrences)) {
      html += `<div class="detail-answer" style="margin-top:10px;">`;
      html += `<div class="detail-answer-label">Occurrences \u2014 ${row.occurrenceCount} events</div>`;
      html += `<div style="display:flex;flex-direction:column;gap:4px;font-size:12px;">`;
      const maxRows = 20;    // cap UI; show summary if over
      const occs    = row.occurrences.slice(0, maxRows);
      for (const occ of occs) {
        const t = _fmtTime(occ.timestamp);
        const sid = occ.callSid ? occ.callSid.slice(-8) : '—';
        const reason = occ.callReason ? ` \u00b7 ${_esc(occ.callReason)}` : '';
        html += `<div style="display:flex;gap:10px;align-items:center;color:var(--text-muted);">`;
        html += `<span style="min-width:120px;">${_esc(t)}</span>`;
        html += `<span style="font-family:monospace;min-width:80px;">${_esc(sid)}</span>`;
        html += `<span>turn ${occ.turn ?? '—'}${reason}</span>`;
        html += `</div>`;
      }
      if (row.occurrences.length > maxRows) {
        html += `<div style="color:var(--text-muted);font-style:italic;">\u2026 and ${row.occurrences.length - maxRows} more</div>`;
      }
      html += `</div></div>`;
    }

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
    // Context-aware: directs the admin to the Verify → Fix Advisor pipeline
    // rather than the old "manually paste the raw ASR transcript" instruction.
    // Raw caller utterances are never safe KC phrases — Fix Advisor cleans
    // them, extracts anchorWords, and picks the right target section.
    html += '<div class="detail-suggestion">';
    html += '<div class="suggestion-icon">\ud83d\udca1</div>';  // 💡
    html += '<div class="suggestion-text">';

    const _verify  = G.verifyByIdx[idx];
    const _advisor = G.advisorByIdx[idx] || (_getResolution(row)?.fixAdvisor);
    const _isShortAck = row.displayType === 'KC_GRACEFUL_ACK'
      && (!row.question || row.question.trim().length <= 5);

    if (_isShortAck) {
      html += `<strong>Likely OK:</strong> Empty or very short utterance \u2014 probably a natural `;
      html += `pause or acknowledgment from the caller. No action needed.`;
    } else if (_advisor) {
      // Fix Advisor already ran — show its target + action summary inline.
      const _t  = _advisor.target || {};
      const _np = Array.isArray(_advisor.proposal?.newPhrases)
        ? _advisor.proposal.newPhrases.length
        : 0;
      const _typeLabel = {
        ADD_PHRASES:     'Add phrases',
        AUGMENT_SECTION: 'Augment section',
        NEW_SECTION:     'Build new section',
        ROUTING_PROBLEM: 'Fix routing (not a content gap)',
      }[_advisor.type] || _advisor.type || 'Review';
      html += `<strong>Fix Advisor:</strong> ${_esc(_typeLabel)}`;
      if (_t.containerTitle) {
        html += ` \u2014 target: <strong>${_esc(_t.containerTitle)}</strong>`;
        if (_t.sectionLabel) html += ` \u203a <strong>${_esc(_t.sectionLabel)}</strong>`;
      }
      if (_np > 0) {
        html += `. ${_np} cleaned phrase${_np > 1 ? 's' : ''} with anchorWords proposed below.`;
      } else {
        html += `.`;
      }
      if (_advisor.vetoed) {
        html += ` <span class="suggestion-repeat">Server vetoed NEW_SECTION (${_esc(_advisor.vetoReason || 'similarity')}) \u2014 see proposal for the safer alternative.</span>`;
      }
    } else if (_verify) {
      // Verify ran, advisor didn't — point at Ask Fix Advisor.
      html += `Gate trace is ready above. Click <strong>\u2728 Ask Fix Advisor</strong> `;
      html += `to get a cleaned phrase (with anchorWords) and the right target section. `;
      html += `<em>Never paste the raw caller transcript into a KC as-is.</em>`;
    } else if (row.displayType === 'KC_SECTION_GAP') {
      // No verify yet — direct to the enterprise repair path.
      const _gapOcc = row.containerId ? (G.containerGapCounts[row.containerId] || 1) : 1;
      html += `Click <strong>\ud83e\uddea Verify</strong> to replay the 6-gate pipeline against `;
      html += `\u201c${_esc(row.containerTitle || 'this container')}\u201d, then <strong>\u2728 Ask Fix Advisor</strong> `;
      html += `for a structured proposal (phrase text + anchorWords + target section + similarity veto check). `;
      html += `<em>Do not paste the raw transcript verbatim \u2014 it needs cleaning and anchor extraction first.</em>`;
      if (_gapOcc > 1) {
        html += ` <span class="suggestion-repeat">This container had ${_gapOcc} section gaps this period \u2014 high-impact fix.</span>`;
      }
    } else if (row.displayType === 'KC_LLM_FALLBACK') {
      html += `No container matched. Click <strong>\ud83e\uddea Verify</strong> to see which gate failed, `;
      html += `then <strong>\u2728 Ask Fix Advisor</strong> \u2014 it may propose routing to an existing KC `;
      html += `(ADD_PHRASES) or, if truly new, a NEW_SECTION with a similarity-sweep veto guard.`;
    } else {
      html += `<strong>Review:</strong> Agent had no trained answer. Click <strong>\ud83e\uddea Verify</strong> `;
      html += `to see the pipeline trace, then <strong>\u2728 Ask Fix Advisor</strong> for a structured repair plan.`;
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
  document.getElementById('gapTable').innerHTML = bannerHtml + html;
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
  // Verdict enum — user-facing labels match the mental model (UAP miss → Groq),
  // not the raw qaLog event name.
  const map = {
    'KC_SECTION_GAP':           { cls: 'gap',     label: 'Section Gap' },
    'KC_LLM_FALLBACK':          { cls: 'fb',      label: 'UAP Miss → Groq' },
    'KC_GRACEFUL_ACK':          { cls: 'ack',     label: 'Graceful Ack' },
    'UAP_MISS_KEYWORD_RESCUED': { cls: 'keysave', label: 'UAP Miss → Keyword Save' },
    'UAP_LAYER1':               { cls: 'uaphit',  label: 'UAP Hit' },
    'KC_SECTION_GAP_RESCUED':   { cls: 'rescued', label: 'Section Gap Rescued' },
    'NEGATIVE_KEYWORD_BLOCK':   { cls: 'nkblock', label: 'NegKw Block' },
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

  // ── Phrase Anatomy — WORD-LEVEL breakdown ────────────────────────────
  // Purpose: one glance shows which words are acting as anchors, which
  // of the 8 cue fields fired, and which sections came closest but lost.
  // "A word changes the meaning" — make those words visible.
  html += _renderPhraseAnatomy(row, vr, { ce, uap, wg, sem, kw });

  // ── Final match summary ────────────────────────────────────────────────
  // Prefer vr.finalMatch (v2). Legacy fallback: old gates{}.keywordScoring shape.
  const fm = vr.finalMatch || (kw.matched ? {
    containerId:    kw.matchedContainerId    || kw.containerId,
    containerTitle: kw.matchedContainerTitle || kw.containerTitle,
    sectionIdx:     kw.matchedSectionIdx     ?? kw.sectionIdx,
    sectionLabel:   kw.matchedSectionLabel   || kw.sectionLabel,
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
  // Trace fields (from GapReplayService._runWordGate):
  //   required, matched, coverage, threshold, hits[], missing[], pass, reason, skipped?
  if (wg) {
    const wgRequired = wg.required != null ? wg.required : 0;
    const wgMatched  = wg.matched  != null ? wg.matched  : 0;
    html += _renderGateCard({
      title: 'Word Gate (\u226590% anchor)',
      pass:  wg.pass === true,
      rows: [
        ['Anchor words', String(wgRequired)],
        ['Present',      wgRequired > 0 ? `${wgMatched} / ${wgRequired}` : '\u2014'],
        ['Coverage',     wg.coverage != null ? `${Math.round(wg.coverage * 100)}%` : '\u2014'],
      ],
      footer: wg.skipped
        ? `<span style="color:#64748b;">${_esc(wg.reason || 'Skipped')}</span>`
        : ((wg.missing || []).length
            ? `<span style="color:#991b1b;">Missing: ${(wg.missing || []).map(w => `<code>${_esc(w)}</code>`).join(' ')}</span>`
            : ''),
    });
  }

  // Core Confirm (only present if Word Gate passed)
  // Trace fields (from GapReplayService._runCoreConfirm):
  //   pass, skipped, cosine, threshold, callerCore?, phraseCore?, reason
  if (cc) {
    html += _renderGateCard({
      title: 'Core Confirm (cosine \u22650.80)',
      pass:  cc.pass === true,
      rows: [
        ['Cosine',    cc.cosine != null ? Number(cc.cosine).toFixed(3) : '\u2014'],
        ['Threshold', cc.threshold != null ? Number(cc.threshold).toFixed(2) : '0.80'],
        ['Status',    cc.skipped ? 'SKIPPED' : (cc.pass ? 'confirmed' : 'mismatch')],
      ],
      footer: cc.skipped
        ? `<span style="color:#64748b;">${_esc(cc.reason || 'Skipped')}</span>`
        : (cc.callerCore
            ? `<span style="color:#475569;">caller core: <code>${_esc(String(cc.callerCore).slice(0, 80))}</code></span>`
            : ''),
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
  // Fresh v2 trace fields: containerTitle, sectionLabel, score, threshold,
  //                        anchorBoosted, anchorFloor, anchorFloorApplied, ctxAnchor
  // Legacy fallback fields: matchedContainerTitle, matchedSectionLabel, matched
  const kwContainer = kw.containerTitle || kw.matchedContainerTitle;
  const kwSection   = kw.sectionLabel   || kw.matchedSectionLabel;
  html += _renderGateCard({
    title: 'GATE 3 \u2014 Keyword scoring',
    pass:  kw.pass === true || kw.matched === true,
    rows: [
      ['Container',      _esc(kwContainer || '\u2014 none')],
      ['Section',        _esc(kwSection   || '\u2014 none')],
      ['Score',          `${kw.score != null ? kw.score : 0} (threshold ${kw.threshold || 8})`],
      ['Anchor boosted', kw.anchorBoosted ? `yes (floor ${kw.anchorFloor || 24})` : 'no'],
    ],
  });

  html += '</div>'; // per-gate grid

  // ── Fix Advisor card / button ──────────────────────────────────────────
  html += _renderFixAdvisorCard(row, idx);

  html += '</div>'; // verify-detail
  return html;
}

// ──────────────────────────────────────────────────────────────────────────
// PHRASE ANATOMY — word-level diagnostic card
// ──────────────────────────────────────────────────────────────────────────
// Renders three things, in this order:
//   1. The caller phrase on one line with anchor-matched tokens bolded red.
//      "A word changes the meaning" — this surfaces exactly which words
//      the pipeline is treating as load-bearing.
//   2. 2×4 grid of the 8 CueExtractor fields (7 cue types + tradeCore).
//      Filled = the cue fired with a value. Empty = the slot is looking
//      for content but the utterance didn't contain a matching pattern.
//   3. Close-but-no-cigar competitors: top semantic candidate + any
//      section pre-filter candidates captured from the live runtime.
//
// Input: `gates` is the already-unpacked { ce, uap, wg, sem, kw } bundle
// from _renderVerifyDetail so we don't re-parse the trace.
// ──────────────────────────────────────────────────────────────────────────

// 8 CueExtractor fields in pipeline order (matches CueExtractorService.js).
// Slot labels kept short — this UI is a diagnostic chip grid, not prose.
const _CUE_FIELDS = [
  { key: 'requestCue',    label: 'request',    hint: 'can you, could you, would you' },
  { key: 'permissionCue', label: 'permission', hint: 'do i have to, am i allowed, can i' },
  { key: 'infoCue',       label: 'info',       hint: 'what is, how much, when does' },
  { key: 'directiveCue',  label: 'directive',  hint: 'please, i need, let me' },
  { key: 'actionCore',    label: 'action',     hint: 'pay, schedule, transfer, book' },
  { key: 'urgencyCore',   label: 'urgency',    hint: 'today, now, asap, emergency' },
  { key: 'modifierCore',  label: 'modifier',   hint: 'for a service call, with plan' },
  { key: 'tradeCore',     label: 'trade',      hint: 'HVAC / plumbing / trade vocab' },
];

// Lightweight stemmer matching GapReplayService._stem rules so anchor-word
// matches highlight "calling" when the anchor is "call", etc. Must stay in
// sync with services/kcVerify/GapReplayService.js::_stem.
function _stemLite(word) {
  return String(word || '')
    .replace(/ings?$/,   '')
    .replace(/ing$/,     '')
    .replace(/ations?$/, '')
    .replace(/ers?$/,    '')
    .replace(/ed$/,      '')
    .replace(/ly$/,      '')
    .replace(/ies$/,     'y')
    .replace(/ves$/,     'f')
    .replace(/s$/,       '');
}

// Render the phrase with anchor tokens wrapped in .anchor-hl.
// anchorHits[] is lower-case, stem-normalized by the server.
function _highlightAnchors(phrase, anchorHits) {
  if (!phrase) return '';
  const hitSet     = new Set((anchorHits || []).map(w => String(w).toLowerCase()));
  const hitStems   = new Set([...hitSet].map(_stemLite));
  if (!hitSet.size) return _esc(phrase);

  // Tokenize preserving whitespace + punctuation so we can render back faithfully.
  const tokens = phrase.split(/(\s+|[.,?!;:])/);
  let html = '';
  for (const t of tokens) {
    if (!t) continue;
    // Only evaluate pure word tokens; pass-through whitespace & punctuation.
    if (/^\s+$/.test(t) || /^[.,?!;:]$/.test(t)) {
      html += _esc(t);
      continue;
    }
    const raw   = t.toLowerCase().replace(/[^a-z0-9]/g, '');
    const stem  = _stemLite(raw);
    const match = raw && (hitSet.has(raw) || hitStems.has(stem));
    html += match
      ? `<span class="anchor-hl">${_esc(t)}</span>`
      : _esc(t);
  }
  return html;
}

function _renderPhraseAnatomy(row, vr, gates) {
  const { ce = {}, uap = {}, wg = {}, sem = {}, kw = {} } = gates || {};
  const phrase   = row.question || '';
  const anchors  = Array.isArray(wg.hits) ? wg.hits : [];
  const missing  = Array.isArray(wg.missing) ? wg.missing : [];
  const fields   = ce.fields || {};
  const trades   = Array.isArray(ce.tradeMatches) ? ce.tradeMatches : [];

  let h = `<div class="phrase-anatomy">`;

  // ── 1. Phrase line with anchors bolded ───────────────────────────────
  h += `<div class="anatomy-phrase-line">`;
  h += `<span class="anatomy-tag">Phrase</span>`;
  h += `<span class="anatomy-phrase-text">${_highlightAnchors(phrase, anchors)}</span>`;
  h += `</div>`;
  if (anchors.length || missing.length) {
    h += `<div class="anatomy-anchor-legend">`;
    if (anchors.length) {
      h += `<span><span class="anchor-hl">\u2588\u2588</span> anchors present: `
        + anchors.map(w => `<code>${_esc(w)}</code>`).join(' ')
        + `</span>`;
    }
    if (missing.length) {
      h += `<span style="margin-left:14px;color:#92400e;">missing: `
        + missing.map(w => `<code>${_esc(w)}</code>`).join(' ')
        + `</span>`;
    }
    h += `</div>`;
  }

  // ── 2. 8-slot cue field grid ─────────────────────────────────────────
  h += `<div class="anatomy-cue-grid">`;
  for (const f of _CUE_FIELDS) {
    let val = '';
    let filled = false;
    if (f.key === 'tradeCore') {
      filled = trades.length > 0;
      val    = filled
        ? `${trades.length} match${trades.length > 1 ? 'es' : ''}`
        : '';
    } else {
      const v = fields[f.key];
      filled  = !!v;
      val     = filled ? String(v) : '';
    }
    h += `<div class="cue-slot ${filled ? 'filled' : 'empty'}" title="${filled ? _esc(val) : _esc('Looking for: ' + f.hint)}">`;
    h += `<div class="cue-slot-label">${_esc(f.label)}</div>`;
    h += filled
      ? `<div class="cue-slot-value">${_esc(val)}</div>`
      : `<div class="cue-slot-value cue-empty">\u2014 ${_esc(f.hint)}</div>`;
    h += `</div>`;
  }
  h += `</div>`;

  // ── 3. Close but no cigar ────────────────────────────────────────────
  // Sources (any of these mean "almost"): UAP matched phrase, semantic
  // best candidate below threshold, and runtime section pre-filter top-K.
  const competitors = [];
  if (uap.matchedPhrase) {
    competitors.push({
      label:  'UAP phrase match',
      detail: `\u201c${uap.matchedPhrase}\u201d`,
      score:  uap.confidence != null ? Number(uap.confidence).toFixed(2) : null,
      note:   uap.matchType || null,
    });
  }
  if (sem.bestContainerTitle || sem.bestSectionLabel) {
    competitors.push({
      label:  'Semantic best',
      detail: `${sem.bestContainerTitle || '\u2014'} \u203a ${sem.bestSectionLabel || '\u2014'}`,
      score:  sem.bestSimilarity != null ? Number(sem.bestSimilarity).toFixed(3) : null,
      note:   sem.pass ? 'passed' : `below ${sem.threshold || 0.70}`,
    });
  }
  // Runtime pre-filter candidates (from the live call's gapTopSections)
  const rtTop = Array.isArray(row.gapTopSections) ? row.gapTopSections.slice(0, 5) : [];
  for (const s of rtTop) {
    competitors.push({
      label:  'Runtime top-K',
      detail: s.label || '\u2014',
      score:  s.score != null ? String(s.score) : null,
      note:   `#${s.idx}`,
    });
  }

  if (competitors.length) {
    h += `<div class="anatomy-competitors">`;
    h += `<div class="anatomy-competitors-title">Close but no cigar \u2014 competitors that almost won</div>`;
    h += `<div class="anatomy-competitors-list">`;
    for (const c of competitors) {
      h += `<div class="competitor-row">`;
      h += `<span class="competitor-label">${_esc(c.label)}</span>`;
      h += `<span class="competitor-detail">${_esc(c.detail)}</span>`;
      if (c.score != null) {
        h += `<span class="competitor-score">${_esc(c.score)}</span>`;
      }
      if (c.note) {
        h += `<span class="competitor-note">${_esc(c.note)}</span>`;
      }
      h += `</div>`;
    }
    h += `</div></div>`;
  }

  h += `</div>`; // phrase-anatomy
  return h;
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

  // Proposal body — field names per FixAdvisorService docstring:
  //   newPhrases[{text, anchorWords}], augmentedContent, augmentedGroqContent,
  //   sectionLabel, contentSkeleton, groqContentSkeleton,
  //   misfiringGate, recommendation, _overrideNotice
  const prop = advisor.proposal || {};

  // Server veto notice (rendered first so admin sees it prominently)
  if (prop._overrideNotice) {
    h += `<div style="font-size:12px;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:8px;margin-bottom:8px;color:#92400e;"><strong>\u26a0\ufe0f Server veto:</strong> ${_esc(prop._overrideNotice)}</div>`;
  }

  if (Array.isArray(prop.newPhrases) && prop.newPhrases.length) {
    h += `<div style="font-size:12px;margin-bottom:6px;"><span style="color:#64748b;">Phrases to add:</span></div>`;
    h += `<ul style="margin:0 0 8px 18px;padding:0;font-size:12px;color:#0f172a;">`;
    for (const p of prop.newPhrases.slice(0, 15)) {
      // newPhrases may be strings (lenient) or {text, anchorWords} objects
      const text   = typeof p === 'string' ? p : (p?.text || '');
      const anchor = typeof p === 'object' && Array.isArray(p?.anchorWords) ? p.anchorWords : null;
      if (!text) continue;
      h += `<li>\u201c${_esc(text)}\u201d`;
      if (anchor && anchor.length) {
        h += ` <span style="color:#64748b;font-size:11px;">anchors: ${anchor.map(a => `<code>${_esc(a)}</code>`).join(' ')}</span>`;
      }
      h += `</li>`;
    }
    h += `</ul>`;
  }

  // NEW_SECTION / AUGMENT content blocks
  const label         = prop.sectionLabel;
  const contentFixed  = prop.contentSkeleton  || prop.augmentedContent      || null;
  const contentGroq   = prop.groqContentSkeleton || prop.augmentedGroqContent || null;
  if (label || contentFixed || contentGroq) {
    h += `<div style="font-size:12px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:8px;margin-bottom:8px;">`;
    if (label)         h += `<div><strong>${_esc(label)}</strong></div>`;
    if (contentFixed)  h += `<div style="margin-top:4px;color:#334155;"><span style="color:#64748b;font-size:11px;">Fixed:</span> ${_esc(contentFixed)}</div>`;
    if (contentGroq)   h += `<div style="margin-top:4px;color:#334155;"><span style="color:#64748b;font-size:11px;">Groq seed:</span> ${_esc(contentGroq)}</div>`;
    if (prop.suggestedContainerTitle) {
      h += `<div style="margin-top:4px;color:#64748b;font-size:11px;">Attach to: <strong>${_esc(prop.suggestedContainerTitle)}</strong></div>`;
    }
    h += `</div>`;
  }

  // ROUTING_PROBLEM block
  if (prop.misfiringGate || prop.recommendation) {
    h += `<div style="font-size:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:8px;margin-bottom:8px;color:#991b1b;">`;
    if (prop.misfiringGate) h += `<strong>Misfiring gate:</strong> ${_esc(prop.misfiringGate)}`;
    if (prop.recommendation) h += `<div style="margin-top:4px;">${_esc(prop.recommendation)}</div>`;
    h += `</div>`;
  }

  // Near-misses
  if (Array.isArray(advisor.nearMisses) && advisor.nearMisses.length) {
    h += `<details style="margin-bottom:8px;"><summary style="font-size:11px;color:#475569;cursor:pointer;">Near-misses (${advisor.nearMisses.length}) \u2014 existing content ranked by cosine</summary>`;
    h += `<table style="width:100%;margin-top:6px;font-size:11px;border-collapse:collapse;">`;
    for (const nm of advisor.nearMisses.slice(0, 5)) {
      h += `<tr style="border-bottom:1px solid #e2e8f0;">`;
      h += `<td style="padding:3px 6px;font-weight:600;">${nm.similarity != null ? Number(nm.similarity).toFixed(3) : '\u2014'}</td>`;
      h += `<td style="padding:3px 6px;color:#334155;">${_esc(nm.containerTitle || '\u2014')}</td>`;
      h += `<td style="padding:3px 6px;color:#64748b;">${_esc(nm.sectionLabel || '\u2014')}</td>`;
      h += `<td style="padding:3px 6px;color:#94a3b8;font-size:10px;">${_esc(nm.matchSource || nm.source || '\u2014')}</td>`;
      h += `</tr>`;
    }
    h += `</table></details>`;
  }

  // Deep-link to editor
  // ⚠️ services-item.html reads `itemId` (NOT `containerId` / `kcId`) — see
  // services-item.html L1953-1956. Missing `itemId` → S.isEdit=false →
  // opens blank "Add Knowledge Container" form.
  if (advisor.target?.containerId) {
    const url = `/agent-console/services-item.html?companyId=${G.companyId}&itemId=${advisor.target.containerId}${advisor.target.sectionIdx != null ? `&sectionIdx=${advisor.target.sectionIdx}` : ''}`;
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
