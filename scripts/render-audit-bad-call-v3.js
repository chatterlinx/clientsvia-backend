/**
 * v3 — Find where KC containers + agent settings ACTUALLY live.
 *
 * v2 showed companiesCollection doc for this company has:
 *   - agent2 key = null
 *   - voiceSettings key = null
 *   - knowledgeBaseSettings.knowledgeContainers = [] (0 containers)
 *
 * But the call report CA04f553d9fabebc32b7edf487d04d720a shows kcId "700c4-39"
 * matching on Turn 1. So the containers MUST be stored somewhere. And UI saves
 * for agent2.html must be landing somewhere.
 *
 * This script:
 *   1. Lists every collection in the 'clientsvia' database
 *   2. For each collection, checks whether it has a doc for this companyId
 *   3. Looks for kcId "700c4-39" in the database regardless of collection
 *   4. Dumps customer.callerProfile shape (that's where the name likely lives)
 *
 * Usage: node scripts/render-audit-bad-call-v3.js
 */

const { MongoClient, ObjectId } = require('mongodb');

(async () => {
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const db = c.db('clientsvia');
  const companyId = new ObjectId('68e3f77a9d623b8058c700c4');
  const companyIdStr = '68e3f77a9d623b8058c700c4';

  // ── 1. All collections ──────────────────────────────────────────────
  const colls = await db.listCollections().toArray();
  console.log('── All collections in clientsvia DB (' + colls.length + ') ──');
  colls.forEach((c) => console.log('   -', c.name));

  // ── 2. For each collection — does it reference this company? ────────
  console.log('\n── Docs matching this companyId per collection ──');
  for (const coll of colls) {
    const name = coll.name;
    try {
      // Try both ObjectId and string form
      const countObj = await db.collection(name).countDocuments({ companyId });
      const countStr = await db.collection(name).countDocuments({ companyId: companyIdStr });
      if (countObj + countStr > 0) {
        console.log('   ' + name + ': ObjectId=' + countObj + ', string=' + countStr);
      }
    } catch (_e) {}
  }

  // ── 3. Find kcId "700c4-39" anywhere ────────────────────────────────
  console.log('\n── Where is kcId "700c4-39" ──');
  for (const coll of colls) {
    const name = coll.name;
    if (name.startsWith('system.')) continue;
    try {
      // Look for the kcId as a top-level field or nested
      const hit = await db.collection(name).findOne({ kcId: '700c4-39' });
      if (hit) {
        console.log('   FOUND in "' + name + '": _id=' + hit._id + ' title="' + (hit.title || '') + '"');
        console.log('     top-level keys:', Object.keys(hit).slice(0, 30).join(', '));
      }
      const hit2 = await db
        .collection(name)
        .findOne({ 'knowledgeContainers.kcId': '700c4-39' });
      if (hit2) {
        console.log('   FOUND nested in "' + name + '": _id=' + hit2._id);
      }
    } catch (_e) {}
  }

  // ── 4. Dump customer callerProfile shape ────────────────────────────
  console.log('\n── Customer callerProfile shape ──');
  const cust = await db.collection('customers').findOne(
    { companyId, phone: '+12398889905' },
    { projection: { callerProfile: 1, customerType: 1, totalCalls: 1, tags: 1 } }
  );
  console.log('   customerType:', cust && cust.customerType);
  console.log('   totalCalls:', cust && cust.totalCalls);
  console.log('   tags:', cust && cust.tags);
  console.log(
    '   callerProfile:',
    JSON.stringify(cust && cust.callerProfile, null, 2).slice(0, 2000)
  );

  // ── 5. Try the v2companies legacy collection just in case ───────────
  console.log('\n── Legacy v2companies check ──');
  try {
    const legacy = await db.collection('v2companies').findOne({ _id: companyId });
    if (legacy) {
      console.log('   FOUND in v2companies — keys:', Object.keys(legacy).join(', '));
      console.log('   agent2:', legacy.agent2 ? Object.keys(legacy.agent2).join(',') : 'null');
      console.log(
        '   knowledgeContainers count:',
        ((legacy.knowledgeBaseSettings && legacy.knowledgeBaseSettings.knowledgeContainers) || [])
          .length
      );
    } else {
      console.log('   not found in v2companies');
    }
  } catch (_e) {
    console.log('   v2companies collection does not exist');
  }

  await c.close();
})().catch((e) => {
  console.error('ERROR:', e.message, e.stack);
  process.exit(1);
});
