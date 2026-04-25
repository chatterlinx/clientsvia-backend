#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * list-section-candidates.js — find sections to validate Logic-2 thresholds
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * After Config E (0.85 / 0.70 / 0.55) PERFECT-passed the audit on the
 * "Do I have to pay again" section, we need to confirm the dom threshold
 * (0.55) generalises before shipping it as a platform default.
 *
 * The risk is sections with WEAKER domain saturation — short content text,
 * fewer domain-specific tokens. A positive paraphrase against such a
 * section may score lower on contentEmbedding cosine than 0.55 → false
 * negative. We need to find at least one such section and re-audit.
 *
 * This tool lists sections grouped by container, sorted by content length
 * ascending (shortest first = hardest test case). Filters out sections
 * without phraseCoreEmbedding/contentEmbedding (Re-score not run).
 *
 * USAGE:
 *   node scripts/list-section-candidates.js --companyId 68e3f77a9d623b8058c700c4
 *
 * READ-ONLY against Mongo. No writes.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

try { require('dotenv').config(); } catch (_e) { /* optional */ }

const mongoose = require('mongoose');

function arg(name, fallback) {
  const ix = process.argv.indexOf(`--${name}`);
  return ix !== -1 ? process.argv[ix + 1] : fallback;
}

const companyId = arg('companyId');
const limit     = parseInt(arg('limit', '20'), 10);
const skipContainerId = arg('skip', null); // skip a container we already audited

if (!companyId) {
  console.error('Usage: node scripts/list-section-candidates.js --companyId <id> [--limit 20] [--skip <containerId>]');
  process.exit(1);
}
if (!process.env.MONGODB_URI) { console.error('❌ MONGODB_URI not set'); process.exit(1); }

const CompanyKnowledgeContainer = require('../models/CompanyKnowledgeContainer');

const wordCount = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'clientsvia' });

  const containers = await CompanyKnowledgeContainer.find({ companyId })
    .select('+sections.phraseCoreEmbedding +sections.contentEmbedding')
    .lean();

  console.log('═'.repeat(110));
  console.log(`SECTION CANDIDATES — companyId ${companyId}`);
  console.log(`(sorted by content word count ASC — shortest content = hardest test case for dom threshold)`);
  console.log('═'.repeat(110));
  console.log('');

  // Flatten to one row per section, keep only sections with both embeddings.
  const rows = [];
  for (const c of containers) {
    if (skipContainerId && String(c._id) === String(skipContainerId)) continue;
    if (!Array.isArray(c.sections)) continue;
    c.sections.forEach((s, idx) => {
      const hasPhrase  = Array.isArray(s.phraseCoreEmbedding) && s.phraseCoreEmbedding.length > 0;
      const hasContent = Array.isArray(s.contentEmbedding)    && s.contentEmbedding.length > 0;
      if (!hasPhrase || !hasContent) return; // can't audit without both
      rows.push({
        containerId:    String(c._id),
        containerTitle: c.title || '(untitled)',
        noAnchor:       !!c.noAnchor,
        sectionIdx:     idx,
        label:          s.label || '(unlabelled)',
        contentWords:   wordCount(s.content),
        phraseWords:    wordCount(s.phraseCore),
        callerCount:    Array.isArray(s.callerPhrases) ? s.callerPhrases.length : 0,
        anchorSample:   Array.from(new Set(
          (s.callerPhrases || [])
            .flatMap(p => Array.isArray(p.anchorWords) ? p.anchorWords : [])
            .filter(Boolean)
        )).slice(0, 5),
      });
    });
  }

  rows.sort((a, b) => a.contentWords - b.contentWords);
  const top = rows.slice(0, limit);

  if (top.length === 0) {
    console.log('No candidate sections found (none with both phraseCoreEmbedding + contentEmbedding).');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`Found ${rows.length} sections with both embeddings populated. Showing shortest ${top.length}:\n`);
  console.log(`  contentW  phraseW  phrases  noAnch  containerId               sectionIdx  label`);
  console.log('  ' + '─'.repeat(106));
  for (const r of top) {
    console.log(
      `  ${String(r.contentWords).padStart(8)}  ` +
      `${String(r.phraseWords).padStart(7)}  ` +
      `${String(r.callerCount).padStart(7)}  ` +
      `${(r.noAnchor ? 'YES' : 'no').padStart(6)}  ` +
      `${r.containerId}  ` +
      `${String(r.sectionIdx).padStart(10)}  ` +
      `"${r.label.slice(0, 50)}"`
    );
    console.log(
      `  ${' '.repeat(46)}` +
      `container: "${r.containerTitle.slice(0, 50)}"`
    );
    if (r.anchorSample.length) {
      console.log(
        `  ${' '.repeat(46)}` +
        `anchorWords sample: [${r.anchorSample.join(', ')}]`
      );
    }
    console.log('');
  }

  console.log('');
  console.log('Pick a row with SHORT contentW (≤ ~30 words) and noAnch=no. Then re-run');
  console.log('the audit:');
  console.log('');
  console.log('  node scripts/audit-coregate-section.js \\');
  console.log('    --companyId   ' + companyId + ' \\');
  console.log('    --containerId <containerId> \\');
  console.log('    --sectionIdx  <sectionIdx> \\');
  console.log('    --input       "<a paraphrase that should match this section>" \\');
  console.log('    --anchors     "<anchor1>,<anchor2>" \\');
  console.log('    --positives   "p1|p2|p3|p4" \\');
  console.log('    --negatives   "off-topic|off-topic|off-topic|<anchor-FP>|<anchor-FP>"');
  console.log('');

  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('FATAL:', err.stack || err.message);
  Promise.allSettled([mongoose.disconnect()]).finally(() => process.exit(1));
});
