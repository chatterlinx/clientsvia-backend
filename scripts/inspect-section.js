#!/usr/bin/env node
/**
 * inspect-section.js — dump everything about one section so we can craft
 * realistic positives/negatives for the coregate audit.
 *
 * READ-ONLY.
 *
 * Usage:
 *   node scripts/inspect-section.js \
 *     --containerId 69dced33dcf185fd68783b37 \
 *     --sectionIdx  10
 */

'use strict';

try { require('dotenv').config(); } catch (_e) { /* */ }

const mongoose = require('mongoose');

function arg(name, fallback) {
  const ix = process.argv.indexOf(`--${name}`);
  return ix !== -1 ? process.argv[ix + 1] : fallback;
}

const containerId = arg('containerId');
const sectionIdx  = parseInt(arg('sectionIdx', '0'), 10);

if (!containerId) {
  console.error('Usage: node scripts/inspect-section.js --containerId <id> --sectionIdx <n>');
  process.exit(1);
}
if (!process.env.MONGODB_URI) { console.error('❌ MONGODB_URI not set'); process.exit(1); }

const CompanyKnowledgeContainer = require('../models/CompanyKnowledgeContainer');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'clientsvia' });

  const c = await CompanyKnowledgeContainer.findById(containerId)
    .select('+sections.phraseCoreEmbedding +sections.contentEmbedding')
    .lean();
  if (!c) { console.error('container not found'); process.exit(1); }

  const s = c.sections?.[sectionIdx];
  if (!s) { console.error(`section ${sectionIdx} not found`); process.exit(1); }

  const hr = (n = 100) => console.log('─'.repeat(n));

  console.log('═'.repeat(100));
  console.log(`CONTAINER: "${c.title}"`);
  console.log(`SECTION  : [${sectionIdx}] "${s.label}"`);
  console.log('═'.repeat(100));
  console.log('');

  console.log('CONTENT (full):');
  console.log(JSON.stringify(s.content || ''));
  console.log('');
  hr();
  console.log('CONTENT-CORE (reduced):');
  console.log(JSON.stringify(s.contentCore || ''));
  console.log('');
  hr();
  console.log('PHRASE-CORE (kitchen-sink centroid text):');
  console.log(JSON.stringify(s.phraseCore || ''));
  console.log('');
  hr();
  console.log(`callerPhrases (${s.callerPhrases?.length || 0}):`);
  (s.callerPhrases || []).forEach((p, i) => {
    console.log(`  [${i}] text:        ${JSON.stringify(p.text || '')}`);
    if (Array.isArray(p.anchorWords) && p.anchorWords.length) {
      console.log(`      anchorWords: [${p.anchorWords.join(', ')}]`);
    }
    if (Array.isArray(p.topicWords) && p.topicWords.length) {
      console.log(`      topicWords:  [${p.topicWords.join(', ')}]`);
    }
  });
  console.log('');
  hr();
  console.log(`embeddings: phraseCoreEmbedding=${s.phraseCoreEmbedding?.length || 0}d  contentEmbedding=${s.contentEmbedding?.length || 0}d`);
  console.log(`scoredAt:   ${s.phraseCoreScoredAt || '(never)'}`);
  console.log('');

  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('FATAL:', err.stack || err.message);
  Promise.allSettled([mongoose.disconnect()]).finally(() => process.exit(1));
});
