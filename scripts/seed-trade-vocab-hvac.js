/**
 * seed-trade-vocab-hvac.js — Seed HVAC trade vocabulary into GlobalShare
 *
 * Run on Render Shell:
 *   node scripts/seed-trade-vocab-hvac.js
 *
 * WHY:
 *   CueExtractor GATE 2.4 can extract 7 cue fields from caller utterances
 *   (permissionCue, actionCore, urgencyCore, etc.) but cannot ROUTE without
 *   trade terms linking utterances to containers. Trade vocabularies are the
 *   destination map — without them, tradeMatches is always [] and GATE 2.4
 *   enriches discoveryNotes but never direct-routes.
 *
 * WHAT:
 *   Adds tradeVocabularies entry { tradeKey: "HVAC", label: "HVAC", terms[] }
 *   to AdminSettings.globalHub.phraseIntelligence.tradeVocabularies.
 *
 *   Terms are universal HVAC industry words that callers say — not company-
 *   specific. Any company with tradeVocabularyKey: "HVAC" on their containers
 *   will automatically benefit.
 *
 * SAFE: Merges with existing vocabularies. Will not duplicate if HVAC already
 *       exists. Safe to run multiple times.
 */
const { MongoClient } = require('mongodb');

const HVAC_TERMS = [
  // ── Cooling ─────────────────────────────────────────────────────────────
  'cooling',
  'ac',
  'air conditioning',
  'air conditioner',
  'not cooling',
  'no cooling',
  'no cold air',
  'won\'t cool',
  'system not cooling',
  'warm air',
  'hot air',
  'blowing warm',
  'blowing hot',

  // ── Heating ─────────────────────────────────────────────────────────────
  'heating',
  'heater',
  'furnace',
  'heat pump',
  'no heat',
  'not heating',
  'won\'t heat',

  // ── System / Equipment ──────────────────────────────────────────────────
  'thermostat',
  'compressor',
  'condenser',
  'evaporator',
  'blower',
  'fan motor',
  'motor',
  'capacitor',
  'refrigerant',
  'freon',
  'coil',
  'evaporator coil',
  'condenser coil',
  'air handler',
  'ductwork',
  'ducts',
  'vents',
  'filter',
  'air filter',

  // ── Maintenance / Service ───────────────────────────────────────────────
  'tune up',
  'tune-up',
  'maintenance',
  'ac maintenance',
  'maintenance plan',
  'maintenance membership',
  'membership',
  'annual maintenance',
  'preventive maintenance',
  'service call',
  'service visit',
  'inspection',
  'checkup',
  'check up',
  'seasonal maintenance',

  // ── Repair / Diagnosis ──────────────────────────────────────────────────
  'repair',
  'fix',
  'broken',
  'not working',
  'stopped working',
  'diagnostic',
  'diagnosis',
  'diagnose',
  'troubleshoot',
  'service call fee',
  'diagnostic fee',
  'trip charge',

  // ── Installation / Replacement ──────────────────────────────────────────
  'new system',
  'new unit',
  'new ac',
  'replacement',
  'install',
  'installation',
  'upgrade',
  'replace',

  // ── Water / Drain ───────────────────────────────────────────────────────
  'water leak',
  'leaking water',
  'drain line',
  'drain',
  'condensate',
  'water in garage',
  'water damage',
  'overflow',
  'clogged drain',

  // ── Duct Cleaning ──────────────────────────────────────────────────────
  'duct cleaning',
  'air duct cleaning',
  'clean ducts',
  'dryer vent',
  'dryer vent cleaning',
  'vent cleaning',

  // ── Pricing / Cost ─────────────────────────────────────────────────────
  'cost',
  'price',
  'estimate',
  'quote',
  'how much',
  'fee',
  'charge',

  // ── Scheduling / Booking ───────────────────────────────────────────────
  'schedule',
  'appointment',
  'book',
  'come out',
  'send someone',
  'technician',
  'tech',
  'available',
  'next available',
  'today',
  'tomorrow',
  'this week',

  // ── Common Symptoms ────────────────────────────────────────────────────
  'running but not cooling',
  'short cycling',
  'making noise',
  'loud noise',
  'strange noise',
  'frozen',
  'ice',
  'freezing up',
  'tripping breaker',
  'won\'t turn on',
  'won\'t start',
  'keeps shutting off',
];

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('clientsvia');
    const col = db.collection('adminsettings');

    // Load current settings
    const settings = await col.findOne({});
    if (!settings) {
      console.error('No AdminSettings document found');
      process.exit(1);
    }

    const pi = settings.globalHub?.phraseIntelligence || {};
    const vocabs = Array.isArray(pi.tradeVocabularies) ? pi.tradeVocabularies : [];

    // Check if HVAC already exists
    const existing = vocabs.find(v => v.tradeKey === 'HVAC');
    if (existing) {
      // Merge: add new terms that don't exist yet
      const existingSet = new Set(existing.terms.map(t => t.toLowerCase()));
      let added = 0;
      for (const term of HVAC_TERMS) {
        if (!existingSet.has(term.toLowerCase())) {
          existing.terms.push(term);
          added++;
        }
      }
      console.log(`HVAC vocabulary already exists (${existingSet.size} terms). Added ${added} new terms. Total: ${existing.terms.length}`);
    } else {
      // Create new vocabulary entry
      vocabs.push({
        tradeKey: 'HVAC',
        label:    'HVAC',
        terms:    HVAC_TERMS,
      });
      console.log(`Created HVAC vocabulary with ${HVAC_TERMS.length} terms.`);
    }

    // Write back
    await col.updateOne(
      { _id: settings._id },
      { $set: { 'globalHub.phraseIntelligence.tradeVocabularies': vocabs } }
    );

    console.log('GlobalShare tradeVocabularies updated successfully.');
    console.log(`Total vocabularies: ${vocabs.length}`);

    // ── Link all Penguin Air containers to HVAC vocabulary ────────────────
    // Every HVAC company's containers should link to "HVAC" so CueExtractor
    // can route via trade terms. This sets tradeVocabularyKey on containers
    // that don't have one yet.
    const kcCol = db.collection('companyknowledgecontainers');
    const penguin = '68e3f77a9d623b8058c700c4';
    const linkResult = await kcCol.updateMany(
      {
        companyId: penguin,
        isActive: true,
        $or: [
          { tradeVocabularyKey: null },
          { tradeVocabularyKey: '' },
          { tradeVocabularyKey: { $exists: false } },
        ],
      },
      { $set: { tradeVocabularyKey: 'HVAC' } }
    );
    console.log(`Linked ${linkResult.modifiedCount} Penguin Air containers to HVAC vocabulary.`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
})();
