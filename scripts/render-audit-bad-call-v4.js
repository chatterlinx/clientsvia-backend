/**
 * v4 — Dump full KC containers + locate where agent2.html saves land.
 *
 * v3 proved: KC containers live in `companyKnowledgeContainers` collection
 * with companyId as a STRING, not embedded in companiesCollection.
 * Fields: kcId, title, sampleQuestions, negativeKeywords, sections, etc.
 * (NOT callerPhrases/contentKeywords as earlier scripts assumed.)
 *
 * This script:
 *   1. Dumps full "New System / Replacement" container (kcId 700c4-39)
 *   2. Finds and dumps "No Cooling" container
 *   3. Dumps call_intelligence_settings for this company (likely has speechDetection)
 *   4. Reads companiesCollection with WIDE projection (agent2, aiAgentSettings, etc.)
 *   5. Dumps customer.callerProfile shape (was truncated in v3)
 *
 * Usage: node scripts/render-audit-bad-call-v4.js
 */

const { MongoClient, ObjectId } = require('mongodb');

(async () => {
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const db = c.db('clientsvia');
  const companyId = new ObjectId('68e3f77a9d623b8058c700c4');
  const companyIdStr = '68e3f77a9d623b8058c700c4';

  function dumpContainer(kc, label) {
    console.log('\n── ' + label + ' ──');
    if (!kc) { console.log('  NOT FOUND'); return; }
    console.log('  kcId:', kc.kcId, '| title:', kc.title, '| category:', kc.category);
    console.log('  isActive:', kc.isActive, '| priority:', kc.priority, '| bookingAction:', kc.bookingAction);
    console.log('  useFixedResponse:', kc.useFixedResponse, '| wordLimit:', kc.wordLimit);
    console.log('  negativeKeywords (' + (kc.negativeKeywords || []).length + '):', (kc.negativeKeywords || []).join(', '));
    console.log('  sampleQuestions (' + (kc.sampleQuestions || []).length + '):');
    (kc.sampleQuestions || []).forEach((q) => {
      console.log('    -', typeof q === 'string' ? q : (q.question || q.phrase || JSON.stringify(q)));
    });
    console.log('  sections (' + (kc.sections || []).length + '):');
    (kc.sections || []).forEach((s, i) => {
      const anchors = s.anchorWords || s.anchors || [];
      const phrases = s.callerPhrases || s.sampleQuestions || [];
      const kws = s.contentKeywords || s.keywords || [];
      console.log(
        '    [' + i + '] title="' + (s.title || s.sectionLabel || '(untitled)') + '"' +
        ' | anchors(' + anchors.length + '):', anchors.slice(0, 8).join(',')
      );
      if (phrases.length) {
        console.log('        phrases (' + phrases.length + '):');
        phrases.slice(0, 8).forEach((p) => console.log('          -', typeof p === 'string' ? p : (p.phrase || JSON.stringify(p)).slice(0, 100)));
      }
      if (kws.length) {
        console.log('        keywords (' + kws.length + '):', kws.slice(0, 15).join(', '));
      }
      if (s.content) console.log('        content (len=' + s.content.length + '):', s.content.slice(0, 120) + '...');
    });
    if (kc.sampleResponse) console.log('  sampleResponse:', kc.sampleResponse.slice(0, 200) + '...');
  }

  // ── 1. "New System / Replacement" (kcId 700c4-39) ──────────────────
  const kcNewSys = await db.collection('companyKnowledgeContainers').findOne({ kcId: '700c4-39' });
  dumpContainer(kcNewSys, 'AUDIT #4 — New System / Replacement (kcId 700c4-39)');

  // ── 2. "No Cooling" ─────────────────────────────────────────────────
  const kcNoCool = await db.collection('companyKnowledgeContainers').findOne({
    companyId: companyIdStr,
    title: /no cooling/i,
  });
  dumpContainer(kcNoCool, 'AUDIT #5 — No Cooling');

  // List all 14 container titles for context
  const allKc = await db.collection('companyKnowledgeContainers')
    .find({ companyId: companyIdStr }, { projection: { kcId: 1, title: 1, isActive: 1, priority: 1, category: 1 } })
    .toArray();
  console.log('\n── All ' + allKc.length + ' containers for this company ──');
  allKc
    .sort((a, b) => (a.priority || 999) - (b.priority || 999))
    .forEach((k) => console.log('  - kcId=' + k.kcId + ' | title="' + k.title + '" | cat=' + (k.category || '') + ' | active=' + (k.isActive !== false) + ' | pri=' + (k.priority || '')));

  // ── 3. call_intelligence_settings ──────────────────────────────────
  console.log('\n── call_intelligence_settings ──');
  const cis = await db.collection('call_intelligence_settings').findOne({ companyId: companyIdStr });
  if (!cis) {
    console.log('  NOT FOUND');
  } else {
    console.log('  top-level keys:', Object.keys(cis).join(', '));
    if (cis.speechDetection) console.log('  speechDetection:', JSON.stringify(cis.speechDetection));
    if (cis.agent2) console.log('  agent2 keys:', Object.keys(cis.agent2).join(','));
  }

  // ── 4. companiesCollection — WIDE projection ───────────────────────
  console.log('\n── companiesCollection — all top-level keys ──');
  const company = await db.collection('companiesCollection').findOne({ _id: companyId });
  if (!company) {
    console.log('  NOT FOUND');
  } else {
    console.log('  top-level keys:', Object.keys(company).join(', '));
    // Check every plausible speechDetection location
    const paths = [
      'agent2', 'agent2.speechDetection',
      'voiceSettings', 'voiceSettings.speechDetection',
      'aiAgentSettings', 'aiAgentSettings.speechDetection',
      'speechDetection',
      'knowledgeBaseSettings.speechDetection',
      'callIntelligenceSettings',
    ];
    function pluck(obj, p) {
      return p.split('.').reduce((a, k) => (a == null ? a : a[k]), obj);
    }
    console.log('\n  ── speechDetection location probe ──');
    paths.forEach((p) => {
      const v = pluck(company, p);
      if (v !== undefined && v !== null) {
        console.log('    ' + p + ' =', typeof v === 'object' ? JSON.stringify(v).slice(0, 150) : v);
      }
    });
  }

  // ── 5. Customer callerProfile ──────────────────────────────────────
  console.log('\n── Customer callerProfile (for +12398889905) ──');
  const cust = await db.collection('customers').findOne(
    { companyId, phone: '+12398889905' },
    { projection: { callerProfile: 1, customerType: 1, totalCalls: 1 } }
  );
  console.log('  customerType:', cust && cust.customerType, '| totalCalls:', cust && cust.totalCalls);
  console.log('  callerProfile:', JSON.stringify(cust && cust.callerProfile, null, 2).slice(0, 1500));

  await c.close();
})().catch((e) => {
  console.error('ERROR:', e.message, e.stack);
  process.exit(1);
});
