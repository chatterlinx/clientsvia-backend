/**
 * Render-only audit — Customer record + KC container state for Penguin Air.
 *
 * Used to diagnose call CA04f553d9fabebc32b7edf487d04d720a (Apr 21 2026):
 *   - Audit #3: was this phone a returning customer?
 *   - Audit #4: New System / Replacement callerPhrases + negativeKeywords
 *              (why did Turn 1 "AC unit not holding right" match this KC?)
 *   - Audit #5: No Cooling sections inventory (repeat-caller-after-repair gap)
 *   - Bonus:   actual speechTimeout stored in DB
 *
 * Usage (Render shell):
 *   node scripts/render-audit-bad-call.js
 */

const { MongoClient, ObjectId } = require('mongodb');

(async () => {
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const db = c.db('clientsvia');
  const companyId = new ObjectId('68e3f77a9d623b8058c700c4');

  // ── Audit #3: Customer lookup ───────────────────────────────────────────
  const cust = await db.collection('customers').findOne(
    { companyId, phone: '+12398889905' },
    {
      projection: {
        firstName: 1,
        lastName: 1,
        phone: 1,
        callHistory: { $slice: -3 },
        tags: 1,
        createdAt: 1,
      },
    }
  );
  console.log('── AUDIT #3 — Customer record for +12398889905 ──');
  if (!cust) {
    console.log('   NO RECORD. isReturning:false is correct — first-time call.');
  } else {
    console.log('   firstName:', cust.firstName, '| lastName:', cust.lastName);
    console.log('   created:', cust.createdAt, '| recent calls:', (cust.callHistory || []).length);
    if ((cust.callHistory || []).length) {
      cust.callHistory.forEach((h, i) => {
        console.log('     call[' + i + ']:', h.startedAt || h.date || '?', '|', h.outcome || h.summary || '');
      });
    }
  }

  // ── Company projection (KC + speechDetection) ───────────────────────────
  const company = await db.collection('companiesCollection').findOne(
    { _id: companyId },
    {
      projection: {
        'knowledgeBaseSettings.knowledgeContainers': 1,
        'agent2.speechDetection': 1,
        'voiceSettings.speechDetection': 1,
      },
    }
  );

  // ── Bonus: Stored speechTimeout (validates Fix #1 from commit 5938c3e07) ─
  console.log('\n── Stored speechTimeout in DB ──');
  console.log(
    '   agent2.speechDetection:',
    JSON.stringify((company && company.agent2 && company.agent2.speechDetection) || null)
  );
  console.log(
    '   voiceSettings.speechDetection:',
    JSON.stringify(
      (company && company.voiceSettings && company.voiceSettings.speechDetection) || null
    )
  );

  // ── Audit #4 + #5: KC container details ─────────────────────────────────
  const containers =
    (company &&
      company.knowledgeBaseSettings &&
      company.knowledgeBaseSettings.knowledgeContainers) ||
    [];

  const targets = [
    { key: 'new system', tag: 'AUDIT #4 — New System / Replacement' },
    { key: 'no cooling', tag: 'AUDIT #5 — No Cooling' },
  ];

  for (const t of targets) {
    const kc = containers.find((k) => (k.title || '').toLowerCase().includes(t.key));
    console.log('\n── ' + t.tag + ' ──');
    if (!kc) {
      console.log('   NOT FOUND');
      continue;
    }
    console.log(
      '   kcId:',
      kc.kcId,
      '| title:',
      kc.title,
      '| noAnchor:',
      kc.noAnchor === true
    );
    console.log(
      '   contentKeywords (' + (kc.contentKeywords || []).length + '):',
      (kc.contentKeywords || []).slice(0, 30).join(', ')
    );
    console.log(
      '   negativeKeywords (' + (kc.negativeKeywords || []).length + '):',
      (kc.negativeKeywords || []).slice(0, 30).join(', ')
    );
    console.log('   callerPhrases (' + (kc.callerPhrases || []).length + '):');
    (kc.callerPhrases || []).slice(0, 20).forEach((p) => {
      console.log('     -', typeof p === 'string' ? p : p.phrase || JSON.stringify(p));
    });
    console.log('   sections (' + (kc.sections || []).length + '):');
    (kc.sections || []).forEach((s, i) => {
      console.log(
        '     ' + i + ':',
        s.title || s.sectionLabel || '(untitled)',
        '| anchorWords:',
        (s.anchorWords || []).slice(0, 6).join(',')
      );
    });
  }

  await c.close();
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
