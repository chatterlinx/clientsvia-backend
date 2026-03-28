'use strict';

/**
 * =============================================================================
 * PATCH — Penguin Air KC Keyword Quality Fix
 * =============================================================================
 *
 * PROBLEM SOLVED:
 *   Call transcript analysis showed the agent answering "System Replacement"
 *   info when a caller asked "how much do you charge for a maintenance". Root
 *   cause: containers with generic positive keywords like "how much" scored
 *   higher (8×2=16) than the tune-up container's word-overlap on "maintenance"
 *   (11 pts).
 *
 * THIS SCRIPT DOES THREE THINGS:
 *
 *   1. TUNE-UP / MAINTENANCE CONTAINERS (kcId: *-03, *-04)
 *      Add rich pricing + cost question keywords so the exact-match score
 *      (length × 2) far outscores any generic "how much" phrase.
 *      "how much for maintenance"  → 24×2 = 48  ← wins easily
 *      "maintenance cost"          → 15×2 = 30  ← wins easily
 *
 *   2. INSTALLATION CONTAINERS (kcId: *-05, *-06)
 *      Add negativeKeywords: ["maintenance", "tune-up", "tune up", "annual service"]
 *      Any caller saying "maintenance" will EXCLUDE these containers from
 *      scoring for that turn — regardless of how well their positive keywords match.
 *
 *   3. AC/HEATING REPAIR CONTAINERS (kcId: *-01, *-02)
 *      Add negativeKeywords: ["maintenance", "tune-up", "tune up", "annual service",
 *      "maintenance plan", "service plan"]
 *      Repair containers should never win on maintenance price questions.
 *
 * VERIFICATION:
 *   After running, use the 🔬 Test Utterance panel in the KC admin UI:
 *   Test: "how much do you charge for a maintenance"
 *   Expected winner: Annual HVAC Tune-Up (or Comfort Club Maintenance Plan)
 *   Expected excluded: New AC System Installation, New Heating System Installation
 *
 * RUN IN RENDER SHELL:
 *   node scripts/patch-penguin-air-kc-keywords.js
 *   node scripts/patch-penguin-air-kc-keywords.js <customCompanyId>
 *
 * SAFE TO RE-RUN — uses $addToSet for negativeKeywords (no duplicates created).
 * =============================================================================
 */

const { MongoClient } = require('mongodb');

const COMPANY_ID  = process.argv[2] || '68e3f77a9d623b8058c700c4';
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME     = 'clientsvia';
const KC_PREFIX   = COMPANY_ID.slice(-5);   // '700c4' for default Penguin Air

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const RESET = '\x1b[0m', BOLD = '\x1b[1m', GREEN = '\x1b[32m',
      CYAN  = '\x1b[36m', YELLOW = '\x1b[33m', RED = '\x1b[31m', DIM = '\x1b[2m';

function banner(text) {
  console.log(`\n${BOLD}${CYAN}── ${text} ${'─'.repeat(Math.max(0, 54 - text.length))}${RESET}`);
}
function ok(label, msg)   { console.log(`  ${GREEN}✅${RESET} [${label}] ${msg}`); }
function note(label, msg) { console.log(`  ${YELLOW}ℹ️ ${RESET} [${label}] ${DIM}${msg}${RESET}`); }
function fail(label, msg) { console.log(`  ${RED}❌${RESET} [${label}] ${msg}`); }

/** Build KC ID string: {last5ofCompanyId}-{seq padded to 2 digits} */
const kid = (seq) => `${KC_PREFIX}-${String(seq).padStart(2, '0')}`;

// ─────────────────────────────────────────────────────────────────────────────
// PATCH DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Keyword additions — added to existing keywords array (no duplicates via $addToSet each).
 * These are specifically crafted multi-word phrases that:
 *   - EXACT-MATCH the most common utterance forms callers use
 *   - Score LENGTH × 2 → all will beat a generic "how much" (8×2=16)
 */
const TUNE_UP_KEYWORDS_ADD = [
  // Direct price questions — exact match scores crush generic "how much"
  'how much is a tune up',            // 21×2=42
  'how much does a tune up cost',     // 28×2=56
  'how much for a tune up',           // 22×2=44
  'tune up cost',                     // 12×2=24
  'tune up price',                    // 13×2=26
  'tune up fee',                      // 11×2=22
  'how much for maintenance',         // 22×2=44
  'how much is maintenance',          // 21×2=42
  'how much does maintenance cost',   // 30×2=60
  'how much is a maintenance',        // 23×2=46
  'how much do you charge for maintenance',  // 40×2=80
  'maintenance cost',                 // 15×2=30
  'maintenance price',                // 16×2=32
  'maintenance fee',                  // 15×2=30
  'maintenance charge',               // 18×2=36
  'annual service cost',              // 19×2=38
  'annual service price',             // 20×2=40
  'annual service fee',               // 19×2=38
  'how much annual service',          // 24×2=48
  'seasonal service cost',            // 20×2=40
  'preventive maintenance cost',      // 25×2=50
  'maintenance appointment cost',     // 27×2=54
  'service visit cost',               // 17×2=34
  'service visit price',              // 18×2=36
];

const COMFORT_CLUB_KEYWORDS_ADD = [
  // Plan-specific pricing queries
  'how much is the maintenance plan',    // 32×2=64
  'how much does the maintenance plan cost', // 40×2=80
  'maintenance plan cost',              // 20×2=40
  'maintenance plan price',             // 21×2=42
  'maintenance plan fee',               // 20×2=40
  'how much is the service plan',       // 29×2=58
  'service plan cost',                  // 16×2=32
  'service plan price',                 // 17×2=34
  'service agreement cost',             // 21×2=42
  'comfort club cost',                  // 16×2=32
  'comfort club price',                 // 17×2=34
  'how much is comfort club',           // 24×2=48
  'comfort club fee',                   // 15×2=30
  'monthly hvac plan cost',             // 22×2=44
  'annual plan cost',                   // 15×2=30
  'annual plan price',                  // 16×2=32
];

/**
 * Negative keywords — any of these in a caller utterance EXCLUDES the container.
 * Applied to containers that should NEVER win on maintenance/tune-up queries.
 */
const INSTALLATION_NEGATIVE_KEYWORDS = [
  'maintenance',
  'tune-up',
  'tune up',
  'tuneup',
  'annual service',
  'seasonal service',
  'preventive',
  'maintenance plan',
  'service plan',
  'service agreement',
  'comfort club',
];

const REPAIR_NEGATIVE_KEYWORDS = [
  'maintenance',
  'tune-up',
  'tune up',
  'tuneup',
  'annual service',
  'seasonal service',
  'maintenance plan',
  'service plan',
  'service agreement',
  'comfort club',
  'maintenance visit',
  'annual maintenance',
];

// ─────────────────────────────────────────────────────────────────────────────
// PATCH TABLE — map kcId to operations
// ─────────────────────────────────────────────────────────────────────────────

const PATCHES = [
  {
    kcId:        kid(1),
    title:       'AC & Cooling Repair',
    description: 'Add negative keywords so repair container never wins on maintenance queries',
    addNegativeKeywords: REPAIR_NEGATIVE_KEYWORDS,
  },
  {
    kcId:        kid(2),
    title:       'Heating & Furnace Repair',
    description: 'Add negative keywords so repair container never wins on maintenance queries',
    addNegativeKeywords: REPAIR_NEGATIVE_KEYWORDS,
  },
  {
    kcId:        kid(3),
    title:       'Annual HVAC Tune-Up',
    description: 'Add rich maintenance price keywords for strong exact-match scoring',
    addKeywords:         TUNE_UP_KEYWORDS_ADD,
  },
  {
    kcId:        kid(4),
    title:       'Comfort Club Maintenance Plan',
    description: 'Add plan pricing keywords for strong exact-match scoring',
    addKeywords:         COMFORT_CLUB_KEYWORDS_ADD,
  },
  {
    kcId:        kid(5),
    title:       'New AC System Installation',
    description: 'Add negative keywords — installation should NEVER win on maintenance queries',
    addNegativeKeywords: INSTALLATION_NEGATIVE_KEYWORDS,
  },
  {
    kcId:        kid(6),
    title:       'New Heating System Installation',
    description: 'Add negative keywords — installation should NEVER win on maintenance queries',
    addNegativeKeywords: INSTALLATION_NEGATIVE_KEYWORDS,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  if (!MONGODB_URI) {
    console.error('❌  MONGODB_URI not set. Run in Render Shell where env is available.');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db  = client.db(DB_NAME);
  const col = db.collection('companyKnowledgeContainers');

  console.log(`\n${BOLD}${CYAN}Penguin Air KC Keyword Quality Patch${RESET}`);
  console.log(`${DIM}  companyId: ${COMPANY_ID}  kcPrefix: ${KC_PREFIX}${RESET}`);

  // ── Verify containers exist ──────────────────────────────────────────────
  banner('Pre-flight: container check');

  const existingIds = new Set(
    (await col.find({ companyId: COMPANY_ID }).project({ kcId: 1 }).toArray())
      .map(d => d.kcId)
  );

  let missingCount = 0;
  for (const p of PATCHES) {
    if (existingIds.has(p.kcId)) {
      ok(p.kcId, `Found: "${p.title}"`);
    } else {
      fail(p.kcId, `NOT FOUND — run seed-hvac-world-class-penguin-air.js first`);
      missingCount++;
    }
  }

  if (missingCount > 0) {
    console.log(`\n${RED}${BOLD}  ${missingCount} container(s) missing. Run seed script first.${RESET}\n`);
    await client.close();
    process.exit(1);
  }

  // ── Apply patches ────────────────────────────────────────────────────────
  banner('Applying patches');

  let totalPatched = 0;

  for (const p of PATCHES) {
    const $addToSet = {};

    if (p.addKeywords?.length) {
      // $addToSet with $each adds each keyword only if not already present
      $addToSet.keywords = { $each: p.addKeywords };
    }

    if (p.addNegativeKeywords?.length) {
      $addToSet.negativeKeywords = { $each: p.addNegativeKeywords };
    }

    if (!Object.keys($addToSet).length) {
      note(p.kcId, 'Nothing to patch — skipped');
      continue;
    }

    const result = await col.updateOne(
      { companyId: COMPANY_ID, kcId: p.kcId },
      {
        $addToSet,
        $currentDate: { updatedAt: true },
      }
    );

    if (result.matchedCount === 1) {
      const parts = [];
      if (p.addKeywords?.length)         parts.push(`+${p.addKeywords.length} keywords`);
      if (p.addNegativeKeywords?.length) parts.push(`+${p.addNegativeKeywords.length} negativeKeywords`);
      ok(p.kcId, `"${p.title}" — ${parts.join(', ')}`);
      console.log(`          ${DIM}${p.description}${RESET}`);
      totalPatched++;
    } else {
      fail(p.kcId, 'Update matched 0 documents — check companyId/kcId');
    }
  }

  // ── Post-patch verification ──────────────────────────────────────────────
  banner('Verification — keyword counts after patch');

  const patched = await col
    .find({ companyId: COMPANY_ID, kcId: { $in: PATCHES.map(p => p.kcId) } })
    .project({ kcId: 1, title: 1, keywords: 1, negativeKeywords: 1 })
    .toArray();

  for (const doc of patched.sort((a, b) => (a.kcId > b.kcId ? 1 : -1))) {
    const kwCount  = doc.keywords?.length || 0;
    const negCount = doc.negativeKeywords?.length || 0;
    console.log(`  ${CYAN}${doc.kcId}${RESET} ${doc.title}`);
    console.log(`    ${DIM}${kwCount} keywords, ${negCount} negativeKeywords${RESET}`);
  }

  // ── Scoring simulation ───────────────────────────────────────────────────
  banner('Scoring simulation: "how much do you charge for a maintenance"');

  const testUtterance = 'how much do you charge for a maintenance';
  const norm          = testUtterance.toLowerCase().replace(/[^a-z\s]/g, ' ');
  const inputWords    = new Set(norm.split(/\s+/));

  console.log(`\n  ${DIM}Utterance: "${testUtterance}"${RESET}\n`);

  const containers = await col
    .find({ companyId: COMPANY_ID, isActive: true })
    .sort({ priority: 1 })
    .toArray();

  const scores = [];

  for (const c of containers) {
    const negKws = c.negativeKeywords || [];
    let excluded = false;
    let excludeTrigger = null;

    for (const nk of negKws) {
      const nkNorm = nk.toLowerCase().trim();
      if (!nkNorm) continue;
      if (nkNorm.includes(' ')) {
        if (norm.includes(nkNorm)) { excluded = true; excludeTrigger = nk; break; }
      } else {
        if (inputWords.has(nkNorm)) { excluded = true; excludeTrigger = nk; break; }
      }
    }

    if (excluded) {
      scores.push({ title: c.title, score: 0, excluded: true, excludeTrigger });
      continue;
    }

    let best = 0;
    let bestKw = null;
    for (const kw of (c.keywords || [])) {
      const kwNorm = kw.toLowerCase().trim();
      if (!kwNorm) continue;
      let score = 0;
      if (kwNorm.includes(' ')) {
        if (norm.includes(kwNorm)) {
          score = kwNorm.length * 2;
        } else {
          const cWords = kwNorm.split(/\s+/).filter(w => w.length >= 5);
          const hits   = cWords.filter(w => inputWords.has(w));
          if (hits.length) score = hits.reduce((s, w) => s + (w.length >= 8 ? Math.round(w.length * 1.5) : w.length), 0);
        }
      } else {
        score = norm.split(/\s+/).includes(kwNorm) ? kwNorm.length : 0;
      }
      if (score > best) { best = score; bestKw = kw; }
    }
    scores.push({ title: c.title, score: best, keyword: bestKw });
  }

  scores.sort((a, b) => b.score - a.score);

  for (const s of scores) {
    if (s.excluded) {
      console.log(`  ${RED}EXCLUDED${RESET}  ${DIM}${s.title}  (neg: "${s.excludeTrigger}")${RESET}`);
    } else if (s.score > 0) {
      const marker = scores[0] === s ? `${GREEN}${BOLD}WINNER  ${RESET}` : `${YELLOW}scored  ${RESET}`;
      console.log(`  ${marker}  score=${s.score}  "${s.title}"  via: "${s.keyword}"`);
    } else {
      console.log(`  ${DIM}no-match  ${s.title}${RESET}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  banner('Summary');
  console.log(`  ${GREEN}✅${RESET} ${totalPatched}/${PATCHES.length} containers patched`);
  console.log(`\n  ${YELLOW}⚠️${RESET}  Redis KC cache is NOT invalidated here.`);
  console.log(`      The cache expires automatically in ≤15 min (TTL=900s).`);
  console.log(`      To force immediate refresh: restart the server or call`);
  console.log(`      POST /api/admin/agent2/company/:id/knowledge/:kcId — any save`);
  console.log(`      triggers invalidateCache() automatically.\n`);

  await client.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
