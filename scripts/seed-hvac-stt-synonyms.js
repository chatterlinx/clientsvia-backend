/**
 * Seed HVAC STT corrections + trade synonyms into GlobalShare synonymGroups.
 * MERGES with existing groups — never overwrites.
 * Run via Render Shell: node scripts/seed-hvac-stt-synonyms.js
 *
 * These are admin-editable in the Phrase Finder Workstation synonym editor.
 * Nothing is hardcoded at runtime — all data lives in MongoDB (AdminSettings).
 */
const { MongoClient } = require('mongodb');

const HVAC_SYNONYM_GROUPS = [
  // ── STT corrections: words Twilio commonly mis-transcribes ──────────
  { token: 'freon',       synonyms: ['free on', 'free in', 'free own', 'freen'] },
  { token: 'hvac',        synonyms: ['h vac', 'age vac', 'h back', 'h-vac'] },
  { token: 'ductwork',    synonyms: ['duck work', 'duct work', 'duck works'] },
  { token: 'condenser',   synonyms: ['con denser', 'can denser', 'condensor'] },
  { token: 'compressor',  synonyms: ['compress her', 'compress or', 'compresser'] },
  { token: 'thermostat',  synonyms: ['thermal stat', 'thermo stat', 'therma stat'] },
  { token: 'furnace',     synonyms: ['for ness', 'furniss', 'for nace', 'fern ace'] },
  { token: 'capacitor',   synonyms: ['cap assist or', 'capaciter', 'cap acitor'] },
  { token: 'refrigerant', synonyms: ['refridgerant', 'refrigerent', 're frigid ant'] },
  { token: 'coil',        synonyms: ['coils', 'coyal'] },

  // ── STT: brand names Twilio gets wrong ──────────────────────────────
  { token: 'lennox',      synonyms: ['lennocks', 'len ox', 'lenox', 'len nox'] },
  { token: 'trane',       synonyms: ['train', 'tray', 'trayne'] },
  { token: 'carrier',     synonyms: ['carry her', 'carry er'] },
  { token: 'rheem',       synonyms: ['ream', 'reem', 're em'] },
  { token: 'goodman',     synonyms: ['good men', 'good man'] },

  // ── Trade synonyms: same concept, different words ───────────────────
  { token: 'diagnostic',  synonyms: ['service call', 'service call fee', 'checkup', 'inspection', 'evaluation'] },
  { token: 'maintenance', synonyms: ['tune up', 'tune-up', 'annual service', 'preventive care', 'seasonal service', 'yearly service'] },
  { token: 'estimate',    synonyms: ['quote', 'bid', 'proposal'] },
  { token: 'air conditioner', synonyms: ['ac', 'a c', 'air conditioning', 'cooling system', 'cooling unit'] },
  { token: 'heater',      synonyms: ['heating system', 'heating unit', 'heat pump'] },
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('clientsvia');
  const col = db.collection('adminsettings');

  // Load existing
  const doc = await col.findOne({});
  const existing = doc?.globalHub?.phraseIntelligence?.synonymGroups || [];
  console.log(`Existing synonym groups: ${existing.length}`);

  // Merge: for each new group, either add synonyms to existing or create new
  const merged = [...existing];
  let added = 0, extended = 0;

  for (const newGroup of HVAC_SYNONYM_GROUPS) {
    const match = merged.find(g => g.token === newGroup.token);
    if (match) {
      // Add any synonyms that don't exist yet
      let before = match.synonyms.length;
      for (const syn of newGroup.synonyms) {
        if (!match.synonyms.includes(syn)) {
          match.synonyms.push(syn);
        }
      }
      if (match.synonyms.length > before) extended++;
    } else {
      merged.push({ token: newGroup.token, synonyms: [...newGroup.synonyms] });
      added++;
    }
  }

  // Save
  await col.updateOne(
    {},
    { $set: {
      'globalHub.phraseIntelligence.synonymGroups': merged,
      'globalHub.phraseIntelligenceUpdatedAt': new Date(),
      'globalHub.phraseIntelligenceUpdatedBy': 'seed-hvac-stt',
    }},
    { upsert: true }
  );

  console.log(`Done. Added ${added} new groups, extended ${extended} existing. Total: ${merged.length} groups.`);
  console.log('Groups:', merged.map(g => `${g.token} (${g.synonyms.length} synonyms)`).join(', '));

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
