/**
 * v5 — CallerRecognition pre-warm chain audit.
 *
 * CONTEXT: v4 confirmed callerProfile.knownNames has "Mark" as source:"confirmed"
 * (seenCount 2) and "getting ridiculous" as source:"confirmed" (junk).
 *
 * CallerRecognitionService.preWarm() (services/engine/CallerRecognitionService.js
 * L135-140) ONLY reads customer.discoveryNotes[i].confirmed — it does NOT read
 * callerProfile.knownNames. So if knownNames has "Mark" but no discoveryNotes
 * entry has confirmed.firstName="Mark", pre-warm returns null on every call and
 * the agent greets Mark as a stranger every time.
 *
 * CustomerProfileService.stamp() (services/engine/CustomerProfileService.js
 * L127, L174) writes to knownNames with HARDCODED source:"confirmed" even when
 * the name came from temp{} (not actually confirmed). That's how junk strings
 * like "getting ridiculous" get promoted to confirmed status.
 *
 * This script answers:
 *   (a) Does customer.discoveryNotes[].confirmed.firstName === "Mark" exist?
 *       → decides whether AUDIT #1 is a pre-warm chain break OR a knownNames-only bug.
 *   (b) How many discoveryNotes entries have empty confirmed{} vs populated?
 *   (c) What's in temp.firstName for the most recent few calls?
 *   (d) Full callHistory[] last 5 entries — are confirmedFields populated?
 *   (e) Last 3 LostLead entries for this customer — discoverySnapshot shape?
 *
 * Usage: node scripts/render-audit-bad-call-v5.js
 */

const { MongoClient, ObjectId } = require('mongodb');

(async () => {
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const db = c.db('clientsvia');
  const companyId = new ObjectId('68e3f77a9d623b8058c700c4');
  const companyIdStr = '68e3f77a9d623b8058c700c4';
  const phone = '+12398889905';

  // ── 1. Full customer load ───────────────────────────────────────────────
  const cust = await db.collection('customers').findOne({ companyId, phone });
  if (!cust) {
    console.log('NO CUSTOMER FOUND for', phone);
    await c.close();
    return;
  }

  console.log('── Customer basics ──');
  console.log('  _id:', cust._id.toString());
  console.log('  phone:', cust.phone);
  console.log('  totalCalls:', cust.totalCalls);
  console.log('  customerType:', cust.customerType);
  console.log('  discoveryNotes array length:', (cust.discoveryNotes || []).length);
  console.log('  callHistory array length:', (cust.callHistory || []).length);

  // ── 2. discoveryNotes[] analysis — the CORE audit ──────────────────────
  const notes = cust.discoveryNotes || [];
  const withConfirmed   = notes.filter(n => n.confirmed && Object.keys(n.confirmed).length > 0);
  const withTempFirstName = notes.filter(n => n.temp && n.temp.firstName);
  const withConfirmedFirstName = notes.filter(n => n.confirmed && n.confirmed.firstName);

  console.log('\n── discoveryNotes[] analysis ──');
  console.log('  total entries:              ', notes.length);
  console.log('  entries w/ confirmed non-empty:', withConfirmed.length);
  console.log('  entries w/ temp.firstName:     ', withTempFirstName.length);
  console.log('  entries w/ confirmed.firstName:', withConfirmedFirstName.length);

  if (withConfirmedFirstName.length) {
    console.log('\n  ── CONFIRMED FIRST-NAME ENTRIES (what pre-warm WOULD pick) ──');
    withConfirmedFirstName.slice(0, 10).forEach((n, i) => {
      console.log('    [' + i + '] callSid=' + n.callSid + ' | capturedAt=' + n.capturedAt + ' | confirmed.firstName="' + n.confirmed.firstName + '" | confirmed.lastName="' + (n.confirmed.lastName || '') + '"');
    });
  } else {
    console.log('\n  ⚠ ZERO entries have confirmed.firstName populated.');
    console.log('    → CallerRecognitionService.preWarm() returns temp.firstName = null on every call.');
    console.log('    → knownNames corpus is populated via CustomerProfileService false-promotion of temp{}.');
  }

  console.log('\n  ── LAST 5 entries raw shape ──');
  notes.slice(-5).forEach((n, i) => {
    const idx = notes.length - 5 + i;
    console.log('    [' + idx + '] callSid=' + (n.callSid || 'n/a'));
    console.log('         capturedAt:', n.capturedAt);
    console.log('         callReason:', n.callReason);
    console.log('         objective: ', n.objective);
    console.log('         temp.firstName:     ', n.temp && n.temp.firstName);
    console.log('         temp.lastName:      ', n.temp && n.temp.lastName);
    console.log('         confirmed keys:     ', n.confirmed ? Object.keys(n.confirmed).join(',') : 'null');
    console.log('         confirmed.firstName:', n.confirmed && n.confirmed.firstName);
  });

  // ── 3. callHistory[] last 5 — confirmedFields shape ────────────────────
  const hist = cust.callHistory || [];
  console.log('\n── callHistory[] last 5 entries ──');
  hist.slice(-5).forEach((h, i) => {
    const idx = hist.length - 5 + i;
    console.log('    [' + idx + '] callSid=' + h.callSid);
    console.log('         callDate:  ', h.callDate);
    console.log('         callReason:', h.callReason);
    console.log('         callOutcome:', h.callOutcome);
    console.log('         objective: ', h.objective);
    console.log('         confirmedFields keys:', h.confirmedFields ? Object.keys(h.confirmedFields).join(',') : 'null');
    if (h.confirmedFields && h.confirmedFields.firstName) {
      console.log('         confirmedFields.firstName:', h.confirmedFields.firstName);
    }
  });

  // ── 4. callerProfile — verify "Mark" + "getting ridiculous" are there ──
  console.log('\n── callerProfile.knownNames (from v4, re-dump for certainty) ──');
  const cp = cust.callerProfile || {};
  (cp.knownNames || []).forEach((n, i) => {
    console.log('    [' + i + '] name="' + n.name + '" | seenCount=' + n.seenCount + ' | source=' + n.source + ' | lastSeenAt=' + n.lastSeenAt);
  });

  // ── 5. LostLead entries (discoverySnapshot is the third pre-warm source) ──
  const leads = await db.collection('lostleads')
    .find({ companyId, customerId: cust._id })
    .sort({ callEndedAt: -1 })
    .limit(3)
    .toArray();
  console.log('\n── LostLead last 3 entries ──');
  if (!leads.length) {
    console.log('    none');
  } else {
    leads.forEach((l, i) => {
      console.log('    [' + i + '] callSid=' + l.callSid + ' | status=' + l.status + ' | callEndedAt=' + l.callEndedAt);
      console.log('         discoverySnapshot keys:', l.discoverySnapshot ? Object.keys(l.discoverySnapshot).join(',') : 'null');
      if (l.discoverySnapshot && l.discoverySnapshot.temp) {
        console.log('         snapshot.temp.firstName:', l.discoverySnapshot.temp.firstName);
      }
      if (l.discoverySnapshot && l.discoverySnapshot.confirmed) {
        console.log('         snapshot.confirmed keys:', Object.keys(l.discoverySnapshot.confirmed).join(','));
      }
    });
  }

  // ── 6. Look at the BAD CALL specifically ───────────────────────────────
  const badCallSid = 'CA04f553d9fabebc32b7edf487d04d720a';
  const badCallNote = notes.find(n => n.callSid === badCallSid);
  console.log('\n── Bad call (CA04f553d9fabebc32b7edf487d04d720a) discoveryNotes entry ──');
  if (!badCallNote) {
    console.log('   NOT FOUND in customer.discoveryNotes[]');
  } else {
    console.log('   capturedAt:', badCallNote.capturedAt);
    console.log('   callReason:', badCallNote.callReason);
    console.log('   objective:', badCallNote.objective);
    console.log('   _preWarmed:', badCallNote._preWarmed);
    console.log('   _preWarmedAt:', badCallNote._preWarmedAt);
    console.log('   temp.firstName:', badCallNote.temp && badCallNote.temp.firstName);
    console.log('   temp.lastName:', badCallNote.temp && badCallNote.temp.lastName);
    console.log('   confirmed keys:', badCallNote.confirmed ? Object.keys(badCallNote.confirmed).join(',') : 'null');
    console.log('   callerProfile on DN:', badCallNote.callerProfile ? JSON.stringify(badCallNote.callerProfile).slice(0, 300) : 'null');
  }

  await c.close();
})().catch((e) => {
  console.error('ERROR:', e.message, e.stack);
  process.exit(1);
});
