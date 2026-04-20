#!/usr/bin/env node
'use strict';

/**
 * READ-ONLY inspection script for the "Maintenance Member Benefits"
 * container, "Member Asking About Repair Coverage" section.
 *
 * GOAL: Diagnose why Logic 2 cosine = 0.527 on caller core "pay service call"
 *
 * Pulls:
 *   - All callerPhrases in the section
 *   - Stored phraseCore text (the run-summary used for the embedding)
 *   - Whether phraseCoreEmbedding is populated
 *   - Last re-score timestamp
 *
 * Usage in Render Shell:
 *   node scripts/inspect-member-asking-repair-coverage.js
 *
 * NO WRITES. Pure diagnostic.
 */

const { MongoClient, ObjectId } = require('mongodb');

const COMPANY_ID = '68e3f77a9d623b8058c700c4';      // Penguin Air (dev/example)
const CONTAINER_TITLE_NEEDLE = 'Maintenance Member Benefits';
const SECTION_LABEL_NEEDLE   = 'Member Asking About Repair Coverage';

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing'); process.exit(1);
  }
  const client = await MongoClient.connect(uri);
  const db = client.db('clientsvia');

  // CompanyKnowledgeContainer is one doc per (companyId, kcId)
  // We need the one matching our title.
  const containers = await db.collection('companyknowledgecontainers')
    .find({ companyId: new ObjectId(COMPANY_ID) })
    .project({
      title: 1,
      kcId: 1,
      noAnchor: 1,
      isActive: 1,
      'sections.label': 1,
      'sections.contentCore': 1,
      'sections.phraseCore': 1,
      'sections.phraseCoreScoredAt': 1,
      'sections.callerPhrases.text': 1,
      'sections.callerPhrases.score': 1,
      // phraseCoreEmbedding is select:false in the model — must explicitly request
      'sections.phraseCoreEmbedding': 1,
    })
    .toArray();

  console.log(`\nFound ${containers.length} containers for company ${COMPANY_ID}\n`);

  const target = containers.find(c =>
    (c.title || '').toLowerCase().includes(CONTAINER_TITLE_NEEDLE.toLowerCase())
  );

  if (!target) {
    console.error(`No container matching "${CONTAINER_TITLE_NEEDLE}"`);
    console.log('Available container titles:');
    containers.forEach(c => console.log('  -', c.title));
    await client.close(); process.exit(1);
  }

  console.log(`═══ CONTAINER: "${target.title}" ═══`);
  console.log(`  kcId:     ${target.kcId}`);
  console.log(`  noAnchor: ${target.noAnchor}`);
  console.log(`  isActive: ${target.isActive}`);
  console.log(`  sections: ${target.sections?.length || 0}`);

  const section = (target.sections || []).find(s =>
    (s.label || '').toLowerCase().includes(SECTION_LABEL_NEEDLE.toLowerCase())
  );

  if (!section) {
    console.error(`\nNo section matching "${SECTION_LABEL_NEEDLE}"`);
    console.log('Available section labels:');
    (target.sections || []).forEach(s => console.log('  -', s.label));
    await client.close(); process.exit(1);
  }

  console.log(`\n═══ SECTION: "${section.label}" ═══`);
  console.log(`  Last phraseCore re-score: ${section.phraseCoreScoredAt || '(never)'}`);
  console.log(`  phraseCoreEmbedding: ${section.phraseCoreEmbedding ? `populated (${section.phraseCoreEmbedding.length} dims)` : 'MISSING'}`);
  console.log(`\n  contentCore:`);
  console.log(`    "${section.contentCore || '(empty)'}"`);
  console.log(`\n  phraseCore (this is what the embedding was built from):`);
  console.log(`    "${section.phraseCore || '(empty)'}"`);

  console.log(`\n  callerPhrases (${section.callerPhrases?.length || 0}):`);
  (section.callerPhrases || []).forEach((p, i) => {
    const status = p.score?.status || '-';
    const t1 = p.score?.t1 ?? '-';
    const t3 = p.score?.t3Score ?? '-';
    console.log(`    [${String(i).padStart(2,'0')}] (${status}) t1=${t1} t3=${t3}  "${p.text}"`);
  });

  // Sanity check — is the exact phrase from the screenshot present?
  const screenshotPhrase = 'do i have to pay for the service call';
  const found = (section.callerPhrases || []).find(p =>
    (p.text || '').toLowerCase().trim() === screenshotPhrase
  );
  console.log(`\n  Screenshot phrase "${screenshotPhrase}": ${found ? '✓ PRESENT (with t1=' + (found.score?.t1 ?? '?') + ')' : '✗ NOT IN SECTION'}`);

  // The variant the caller actually said
  const variant = 'do i have to pay for a service call';
  const foundVariant = (section.callerPhrases || []).find(p =>
    (p.text || '').toLowerCase().trim() === variant
  );
  console.log(`  Variant "${variant}":              ${foundVariant ? '✓ PRESENT' : '✗ MISSING (this is the caller-said form)'}`);

  await client.close();
})();
