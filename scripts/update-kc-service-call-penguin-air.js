'use strict';

/**
 * update-kc-service-call-penguin-air.js
 *
 * Updates the "Service Call" KC container for Penguin Air (companyId: 68e3f77a9d623b8058c700c4).
 *
 * Changes:
 *   1. Add caller-language keywords so the container scores correctly when
 *      callers say "my ac is broken", "need someone to come out", etc.
 *   2. Fix section order:2 — remove re-ask ("the reason for your call, your name,
 *      and your address"). discoveryNotes already has the caller's stated reason.
 *      BookingLogicEngine collects name/address — the KC section shouldn't ask for them.
 *   3. Add new section: "Follow-Up Visit / Technician Already Came Out"
 *      daSubTypeKey: hvac_followup_visit — supports Turn1Engine prior-visit detection.
 *   4. Fix daSubTypes array — add all 8 section sub-type keys (was missing 7 of 8).
 *   5. Fix sampleResponse — use {reg_diagnostic_fee} instead of hardcoded "$99".
 *
 * Run in Render Shell:
 *   node scripts/update-kc-service-call-penguin-air.js
 */

const { MongoClient, ObjectId } = require('mongodb');

const COMPANY_ID   = '68e3f77a9d623b8058c700c4';   // Penguin Air
const CONTAINER_ID = '69ca7c7ae8bb1e062b2dbc54';   // "Service Call"

async function run() {
  const uri    = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI env var not set');

  const client = new MongoClient(uri);
  await client.connect();
  console.log('✅  Connected to MongoDB');

  const db   = client.db('clientsvia');
  const col  = db.collection('companyknowledgecontainers');

  // ── 1. Load the current container ──────────────────────────────────────────
  const current = await col.findOne({ _id: new ObjectId(CONTAINER_ID) });
  if (!current) throw new Error(`Container ${CONTAINER_ID} not found`);
  console.log(`📦  Found container: "${current.title}" (${current.sections?.length || 0} sections)`);

  // ── 2. Build updated keywords ────────────────────────────────────────────────
  // Merge: keep existing keywords + add caller-perspective phrases that score
  // well when a caller describes their AC problem or asks about cost/scheduling.
  const callerLanguageKeywords = [
    // Problem descriptions (what callers actually say)
    'ac not cooling',
    'ac not blowing cold air',
    'ac stopped working',
    'air conditioner not working',
    'my ac is broken',
    'no cold air',
    'house not cooling down',
    'ac wont turn on',
    'ac not turning on',
    'ac making noise',
    'something wrong with my ac',
    'my ac is not working',

    // "Need someone / come out" phrasing
    'need someone to come out',
    'need a technician to come out',
    'send a technician',
    'send a tech out',
    'come look at my ac',
    'need help with my ac',
    'want to get my ac fixed',

    // Pricing / cost phrasing
    'what does a service call cost',
    'how much does it cost to come out',
    'how much is it to come out',
    'how much to come look at my ac',
    'ac repair cost',
    'how much for a service call',

    // Scheduling phrasing
    'want to schedule a repair',
    'need ac repair',
    'schedule a technician',

    // Prior-visit / follow-up phrasing
    'came out already',
    'your tech was here',
    'came out last week',
    'still not working after repair',
    'follow up service call',
    'technician already came out',
  ];

  const existingKeywords = current.keywords || [];
  const mergedKeywords   = [...new Set([
    ...existingKeywords,
    ...callerLanguageKeywords.map(k => k.toLowerCase().trim()),
  ])];

  console.log(`🔑  Keywords: ${existingKeywords.length} existing → ${mergedKeywords.length} merged`);

  // ── 3. Build updated sections ────────────────────────────────────────────────
  // Preserve all existing sections, fix order:2, add prior-visit section at end.
  const updatedSections = (current.sections || []).map(s => {
    const section = { ...s };

    // Fix section order:2 — remove re-ask lines.
    // Old: "…I just need a few details, like the reason for your call, your name,
    //       and your address, and then we can look at a time that works for you.
    //       Would you like to get started?"
    // New: clean offer to schedule — no re-ask, no asking for info KC shouldn't collect.
    if (s.order === 2 && s.daSubTypeKey === 'hvac_emergency_service_scheduling') {
      section.content =
        "Of course, I'd be happy to schedule a service call for you. Would you like to get started?";
      console.log(`✏️   Fixed section order:2 — removed re-ask content`);
    }

    return section;
  });

  // Add new prior-visit / follow-up section
  const followUpSection = {
    label:            'Follow-Up Visit / Technician Already Came Out',
    content:          "If you've already had a technician out and the issue is still not resolved, " +
                      "I want to make sure we get this taken care of for you. We can schedule a follow-up " +
                      "visit to have a technician take another look and get the problem fully resolved.",
    order:            updatedSections.length,   // append at end
    daSubTypeKey:     'hvac_followup_visit',
    useFixedResponse: false,
    preQualifyQuestion: null,
    upsellChain:      [],
  };
  updatedSections.push(followUpSection);
  console.log(`➕  Added section: "${followUpSection.label}" (order:${followUpSection.order})`);

  // ── 4. Build complete daSubTypes array ──────────────────────────────────────
  // Was: ["hvac_emergency_service_details"] — missing 7 of 8 sub-types.
  const daSubTypes = [
    'hvac_repair_pricing',
    'hvac_diagnostic_fee',
    'hvac_emergency_service_scheduling',
    'hvac_emergency_service_details',
    'hvac_diagnostic_fee_pricing',
    'hvac_emergency_service_booking',
    'hvac_service_call_duration',
    'hvac_followup_visit',       // new
  ];

  // ── 5. Fix sampleResponse ───────────────────────────────────────────────────
  const sampleResponse =
    "Our diagnostic fee is {reg_diagnostic_fee}, and I'd be happy to schedule a service call for you right away. Would you like to get started?";

  // ── 6. Apply the update ─────────────────────────────────────────────────────
  const result = await col.updateOne(
    { _id: new ObjectId(CONTAINER_ID) },
    {
      $set: {
        keywords:       mergedKeywords,
        sections:       updatedSections,
        daSubTypes:     daSubTypes,
        sampleResponse: sampleResponse,
        updatedAt:      new Date(),
      },
    }
  );

  if (result.matchedCount === 0) throw new Error('Update matched 0 documents — check container ID');
  if (result.modifiedCount === 0) {
    console.log('⚠️   Document matched but not modified (already up to date?)');
  } else {
    console.log(`✅  Container updated (matchedCount:${result.matchedCount}, modifiedCount:${result.modifiedCount})`);
  }

  // ── 7. Verify ───────────────────────────────────────────────────────────────
  const updated = await col.findOne({ _id: new ObjectId(CONTAINER_ID) });
  console.log('\n📋  Post-update summary:');
  console.log(`   title:          ${updated.title}`);
  console.log(`   keywords count: ${updated.keywords?.length || 0}`);
  console.log(`   sections count: ${updated.sections?.length || 0}`);
  console.log(`   daSubTypes:     ${JSON.stringify(updated.daSubTypes)}`);
  console.log(`   sampleResponse: ${updated.sampleResponse}`);
  console.log('\n   Sections:');
  (updated.sections || []).forEach(s =>
    console.log(`     [${s.order}] ${s.label} (${s.daSubTypeKey || 'no-subtype'})`));

  await client.close();
  console.log('\n✅  Done. Run BridgeService.invalidate() or redeploy to flush KC cache.');
}

run().catch(err => {
  console.error('❌  Script failed:', err.message);
  process.exit(1);
});
