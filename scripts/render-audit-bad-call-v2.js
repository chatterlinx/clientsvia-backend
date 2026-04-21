/**
 * Follow-up diagnostic after render-audit-bad-call.js returned:
 *   - Customer exists but firstName/lastName undefined, callHistory opaque
 *   - agent2.speechDetection + voiceSettings.speechDetection = null
 *   - "New System" + "No Cooling" containers NOT FOUND
 *
 * This script:
 *   1. Shows the FULL customer doc shape (all top-level keys + callHistory[0] keys)
 *   2. Lists every knowledgeContainer title so we can see what's actually there
 *   3. Dumps the first 2000 chars of agent2 + voiceSettings top-level keys
 *
 * Usage: node scripts/render-audit-bad-call-v2.js
 */

const { MongoClient, ObjectId } = require('mongodb');

(async () => {
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const db = c.db('clientsvia');
  const companyId = new ObjectId('68e3f77a9d623b8058c700c4');

  // ── 1. Full customer shape ─────────────────────────────────────────────
  const cust = await db.collection('customers').findOne({ companyId, phone: '+12398889905' });
  console.log('── Customer top-level keys ──');
  if (!cust) {
    console.log('   NULL');
  } else {
    console.log('   keys:', Object.keys(cust).join(', '));
    console.log('   name fields:', JSON.stringify({
      firstName: cust.firstName,
      lastName: cust.lastName,
      name: cust.name,
      fullName: cust.fullName,
      customerName: cust.customerName,
      profile: cust.profile && Object.keys(cust.profile),
    }));
    console.log('   callHistory count:', (cust.callHistory || []).length);
    if ((cust.callHistory || []).length) {
      console.log('   callHistory[0] keys:', Object.keys(cust.callHistory[0]).join(', '));
      console.log('   callHistory[last]:', JSON.stringify(cust.callHistory[cust.callHistory.length - 1], null, 2).slice(0, 1500));
    }
  }

  // ── 2. Company — agent2 + voiceSettings top-level keys ────────────────
  const company = await db.collection('companiesCollection').findOne(
    { _id: companyId },
    { projection: { agent2: 1, voiceSettings: 1, knowledgeBaseSettings: 1 } }
  );

  console.log('\n── Company agent2 keys ──');
  console.log('   ', company && company.agent2 ? Object.keys(company.agent2).join(', ') : 'NULL');
  if (company && company.agent2 && company.agent2.speechDetection !== undefined) {
    console.log('   agent2.speechDetection:', JSON.stringify(company.agent2.speechDetection));
  }

  console.log('\n── Company voiceSettings keys ──');
  console.log('   ', company && company.voiceSettings ? Object.keys(company.voiceSettings).join(', ') : 'NULL');
  if (company && company.voiceSettings && company.voiceSettings.speechDetection !== undefined) {
    console.log('   voiceSettings.speechDetection:', JSON.stringify(company.voiceSettings.speechDetection));
  }

  // ── 3. All knowledgeContainer titles ──────────────────────────────────
  console.log('\n── knowledgeBaseSettings top-level keys ──');
  const kbs = company && company.knowledgeBaseSettings;
  console.log('   ', kbs ? Object.keys(kbs).join(', ') : 'NULL');

  const containers = (kbs && kbs.knowledgeContainers) || [];
  console.log('\n── All knowledgeContainer titles (' + containers.length + ' total) ──');
  containers.forEach((k, i) => {
    console.log(
      '   [' + i + '] kcId=' + (k.kcId || '(none)') +
        ' | title="' + (k.title || '(untitled)') + '"' +
        ' | sections=' + (k.sections || []).length +
        ' | callerPhrases=' + (k.callerPhrases || []).length +
        ' | noAnchor=' + (k.noAnchor === true)
    );
  });

  await c.close();
})().catch((e) => {
  console.error('ERROR:', e.message, e.stack);
  process.exit(1);
});
