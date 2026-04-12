/**
 * Seed HVAC symptom/caller phrases as tradeTerms + callerPhrases
 * on existing Penguin Air KC sections.
 *
 * MERGES with existing data — never overwrites.
 * tradeTerms: adds to section.tradeTerms[] (no duplicates)
 * callerPhrases: adds to section.callerPhrases[] (no duplicate text)
 *
 * Run via Render Shell: node scripts/seed-hvac-symptom-phrases.js
 *
 * After running:
 *   1. Go to services.html → each container
 *   2. Run "Re-score All" (bulk ops) to generate embeddings
 *   3. Run "Fix All" to lock scores
 *   4. Run "Generate Missing Audio" if using fixed responses
 */
const { MongoClient, ObjectId } = require('mongodb');

const COMPANY_ID = '68e3f77a9d623b8058c700c4';

// ═══════════════════════════════════════════════════════════════════════════
// PHRASE MAPPINGS: kcId → sectionIndex → { tradeTerms, callerPhrases }
// ═══════════════════════════════════════════════════════════════════════════

const MAPPINGS = [

  // ── 700c4-01: AC & Cooling Repair ─────────────────────────────────────
  {
    kcId: '700c4-01',
    sections: {
      0: { // Our AC Repair Service
        tradeTerms: [
          'not cooling', 'no cool', 'blowing warm air', 'hot air', 'warm air',
          'not getting cold', 'not cold enough', 'ac quit', 'ac stopped',
          'running but not cooling', 'outside unit not running',
          'outside fan not spinning', 'frozen unit', 'iced up', 'unit froze up',
          'coil froze', 'breaker tripped', 'keeps tripping',
        ],
        callerPhrases: [
          'my ac is not cooling',
          'the air conditioner is blowing warm air',
          'my ac stopped working',
          'the outside unit is not running',
          'my unit is frozen',
          'the ac is iced up',
          'my air conditioner quit',
          'the ac is running but not cooling the house',
          'the breaker keeps tripping on my ac',
          'my outside fan is not spinning',
          'the ac is blowing hot air',
          'my cooling system is not working',
          'the air is warm coming out of the vents',
          'my ac froze up overnight',
          'why is my ac not keeping up',
        ],
      },
      1: { // Diagnostic Service Call
        tradeTerms: [
          'diagnostic', 'service call', 'service call fee', 'trip charge',
          'dispatch fee', 'checkup',
        ],
        callerPhrases: [
          'how much is your service call',
          'what is the diagnostic fee',
          'do you charge a trip fee',
          'how much to come out and look at it',
          'what does it cost for someone to come out',
          'is there a dispatch fee',
          'do you have a diagnostic charge',
          'how much for a service call',
          'what is your trip charge',
          'is the service call fee waived with repair',
        ],
      },
      2: { // Common AC Repairs
        tradeTerms: [
          'capacitor', 'contactor', 'hard start kit', 'compressor',
          'condenser coil', 'evaporator coil', 'fan motor', 'blower motor',
          'control board', 'relay', 'transformer', 'txv', 'refrigerant',
          'freon', 'disconnect box',
        ],
        callerPhrases: [
          'my capacitor went out',
          'I think the compressor is bad',
          'the fan motor is not working',
          'my ac needs freon',
          'the blower motor stopped',
          'I need a new contactor',
          'the control board went bad',
          'how much does a capacitor cost',
          'my ac is low on refrigerant',
          'the condenser coil is dirty',
        ],
      },
    },
  },

  // ── 700c4-02: Heating & Furnace Repair ────────────────────────────────
  {
    kcId: '700c4-02',
    sections: {
      0: { // Our Heating Repair Service
        tradeTerms: [
          'no heat', 'not heating', 'blowing cold air', 'heater not working',
          'heat not coming on', 'furnace not working', 'short cycling',
          'burning smell', 'smells like gas', 'emergency heat', 'aux heat',
          'backup heat',
        ],
        callerPhrases: [
          'my heater is not working',
          'the furnace is blowing cold air',
          'I have no heat',
          'my heat is not coming on',
          'the heater keeps turning on and off',
          'I smell something burning from the heater',
          'my furnace is short cycling',
          'the heat stopped working',
          'there is no warm air coming from the vents',
          'my heating system will not turn on',
          'the furnace smells like gas',
          'my heater is blowing cold air instead of hot',
          'the emergency heat is running',
          'why is my aux heat on',
          'the heat runs for a minute then shuts off',
        ],
      },
      2: { // Common Heating Repairs
        tradeTerms: [
          'pilot light', 'igniter', 'flame sensor', 'inducer motor',
          'gas valve', 'heat exchanger', 'limit switch', 'thermocouple',
          'draft inducer', 'pressure switch',
        ],
        callerPhrases: [
          'the pilot light went out',
          'my igniter is not working',
          'the flame sensor needs cleaning',
          'how much is a new igniter',
          'the inducer motor is loud',
          'I think the gas valve is bad',
          'how much does a flame sensor cost',
        ],
      },
    },
  },

  // ── 700c4-03: Annual HVAC Tune-Up ────────────────────────────────────
  {
    kcId: '700c4-03',
    sections: {
      0: { // What Is a Tune-Up
        tradeTerms: [
          'tune up', 'maintenance', 'cleaning', 'seasonal service',
          'preventive maintenance', 'pm', 'maintenance check',
          'annual service', 'spring tune up', 'fall tune up',
        ],
        callerPhrases: [
          'I need a tune up',
          'how much is a maintenance',
          'do you do seasonal tune ups',
          'I want to schedule a cleaning',
          'when should I get my ac serviced',
          'how much is preventive maintenance',
          'I need my annual ac tune up',
          'can I schedule a spring tune up',
          'how much for a fall maintenance',
          'what does a tune up include',
          'do you offer preventive maintenance',
          'I need my system cleaned and checked',
          'how much is an hvac tune up',
          'my ac needs its annual service',
          'I want to get my heating system tuned up',
        ],
      },
    },
  },

  // ── 700c4-04: Comfort Club Maintenance Plan ──────────────────────────
  {
    kcId: '700c4-04',
    sections: {
      0: { // What Is the Comfort Club
        tradeTerms: [
          'maintenance plan', 'service agreement', 'membership',
          'maintenance contract', 'service plan', 'comfort club',
          'annual plan',
        ],
        callerPhrases: [
          'do you have a maintenance plan',
          'what is your service agreement',
          'how much is the maintenance membership',
          'tell me about your comfort club',
          'do you have a yearly plan',
          'what does the maintenance plan include',
          'how do I sign up for the maintenance plan',
          'is there a discount with a service agreement',
          'what are the benefits of the comfort club',
          'do you offer a service contract',
        ],
      },
    },
  },

  // ── 700c4-05: New AC System Installation ─────────────────────────────
  {
    kcId: '700c4-05',
    sections: {
      0: { // New AC Systems We Install
        tradeTerms: [
          'new unit', 'new ac', 'new air conditioner', 'replace system',
          'system replacement', 'new air handler', 'system changeout',
          'upgrade system', 'install system', 'new cooling system',
        ],
        callerPhrases: [
          'I need a new ac',
          'how much is a new air conditioner',
          'my system needs to be replaced',
          'I want a quote for a new unit',
          'how much does a new ac system cost',
          'I need to replace my air conditioner',
          'what does a system changeout cost',
          'I want to upgrade my ac system',
          'how much for a new air handler',
          'can I get an estimate for a new system',
          'my ac is old and needs to be replaced',
          'I want a new energy efficient system',
          'how much to install a new ac',
          'what brands do you install',
          'I need a replacement estimate',
        ],
      },
      1: { // System Options & Efficiency
        tradeTerms: [
          'mini split', 'ductless', 'split unit', 'package unit',
          'rooftop unit', 'heat pump', 'seer', 'energy efficient',
        ],
        callerPhrases: [
          'do you install mini splits',
          'how much is a ductless system',
          'what is a heat pump',
          'do you install package units',
          'what seer rating should I get',
          'I want the most energy efficient option',
        ],
      },
    },
  },

  // ── 700c4-06: New Heating System Installation ────────────────────────
  {
    kcId: '700c4-06',
    sections: {
      0: { // Heating Systems We Install
        tradeTerms: [
          'new furnace', 'new heater', 'new heating system',
          'furnace replacement', 'replace furnace', 'new heat pump',
        ],
        callerPhrases: [
          'I need a new furnace',
          'how much is a new heating system',
          'my furnace needs to be replaced',
          'how much for a new heater',
          'I want a quote for a new furnace',
          'what does a new heating system cost',
          'can I get an estimate to replace my furnace',
          'I want to upgrade my heating system',
          'how much to install a new furnace',
          'my heater is old and needs replacing',
        ],
      },
    },
  },

  // ── 700c4-07: Emergency HVAC Service ─────────────────────────────────
  {
    kcId: '700c4-07',
    sections: {
      0: { // Emergency Response
        tradeTerms: [
          'emergency', 'after hours', 'weekend service', 'night service',
          'no ac emergency', 'no heat emergency', 'gas leak',
          'carbon monoxide', 'co detector',
        ],
        callerPhrases: [
          'I have an emergency',
          'my ac went out and it is an emergency',
          'I need someone right now',
          'do you have after hours service',
          'can someone come out tonight',
          'I have no heat and it is freezing',
          'this is an emergency my ac is out',
          'I smell gas',
          'my carbon monoxide detector is going off',
          'do you do weekend service calls',
          'I need emergency service',
          'can you come out after hours',
          'my system broke down at night',
          'how fast can someone come out',
          'is there a technician available now',
        ],
      },
    },
  },

  // ── 700c4-08: Indoor Air Quality Solutions ───────────────────────────
  {
    kcId: '700c4-08',
    sections: {
      0: { // IAQ Products We Install
        tradeTerms: [
          'air quality', 'indoor air quality', 'iaq', 'air purifier',
          'air filter', 'filtration', 'allergens', 'dust',
          'smells musty', 'smells like mildew', 'mold',
        ],
        callerPhrases: [
          'I have air quality issues',
          'my house is dusty all the time',
          'what can you do for allergies',
          'the air smells musty',
          'I think I have mold in my ducts',
          'do you sell air purifiers',
          'what kind of air filters do you recommend',
          'my house smells like mildew',
          'I need better air filtration',
          'do you install air quality products',
        ],
      },
      1: { // UV Light & Purification Systems
        tradeTerms: [
          'uv light', 'purification', 'air scrubber', 'ionizer',
          'germicidal', 'whole home purifier',
        ],
        callerPhrases: [
          'do you install uv lights',
          'how much is a uv light system',
          'what is an air scrubber',
          'do you have whole home purification',
        ],
      },
      2: { // Humidity Control
        tradeTerms: [
          'humidity', 'dehumidifier', 'humidifier', 'too humid',
          'too dry', 'moisture',
        ],
        callerPhrases: [
          'my house is too humid',
          'do you install dehumidifiers',
          'the air is too dry',
          'I need a whole house humidifier',
          'how do I control the humidity',
        ],
      },
    },
  },

  // ── 700c4-09: Duct Cleaning & Sealing ────────────────────────────────
  {
    kcId: '700c4-09',
    sections: {
      0: { // Our Duct Cleaning Service
        tradeTerms: [
          'duct cleaning', 'duct work', 'air duct', 'vent cleaning',
          'dryer vent', 'return vent', 'supply vent',
        ],
        callerPhrases: [
          'I need my ducts cleaned',
          'how much is duct cleaning',
          'when should I get my ducts cleaned',
          'do you clean air ducts',
          'how much for duct cleaning',
          'my ducts have not been cleaned in years',
          'do you clean dryer vents',
          'I want my vents cleaned',
        ],
      },
      1: { // Signs You Need Duct Cleaning
        tradeTerms: [
          'weak airflow', 'low airflow', 'no airflow', 'barely blowing',
          'one room hot', 'one room cold', 'uneven cooling', 'uneven heating',
          'air balance', 'vent not blowing', 'register not blowing',
          'duct leak', 'air flow problem',
        ],
        callerPhrases: [
          'one room in my house is hot',
          'I have weak airflow in one room',
          'some rooms are cold and some are hot',
          'the vents are barely blowing',
          'I have uneven cooling in my house',
          'one bedroom is always warmer than the rest',
          'there is low airflow from my vents',
          'I think I have a duct leak',
          'the air is not reaching the back bedrooms',
          'my registers are not blowing enough air',
        ],
      },
    },
  },

  // ── 700c4-10: Financing & Payment Options ────────────────────────────
  {
    kcId: '700c4-10',
    sections: {
      0: { // Financing Available
        tradeTerms: [
          'financing', 'payment plan', 'monthly payments',
          'credit check', 'no interest', 'special financing',
        ],
        callerPhrases: [
          'do you offer financing',
          'can I make monthly payments',
          'do you have a payment plan',
          'is there no interest financing',
          'what financing options do you have',
          'can I finance a new system',
          'do you do credit checks for financing',
          'how does your financing work',
        ],
      },
      1: { // Payment Methods We Accept
        tradeTerms: [
          'warranty', 'labor warranty', 'parts warranty',
          'guarantee', 'free estimate',
        ],
        callerPhrases: [
          'what warranty do you offer',
          'how long is the labor warranty',
          'is the estimate free',
          'do you offer free estimates',
          'what does the warranty cover',
          'how long is the parts warranty',
        ],
      },
    },
  },

  // ── 700c4-12: Service Area & Business Hours ──────────────────────────
  {
    kcId: '700c4-12',
    sections: {
      0: { // Business Hours
        tradeTerms: [
          'hours', 'open', 'closed', 'business hours',
          'what time', 'when do you open',
        ],
        callerPhrases: [
          'what are your business hours',
          'what time do you open',
          'are you open on weekends',
          'what time do you close',
          'are you open today',
          'do you work on saturdays',
        ],
      },
      1: { // Our Service Area
        tradeTerms: [
          'service area', 'do you service', 'coverage area',
        ],
        callerPhrases: [
          'do you service my area',
          'what areas do you cover',
          'do you come to my city',
          'what is your service area',
          'are you available in my neighborhood',
        ],
      },
    },
  },

  // ── Noise & Symptom phrases → AC Repair (section 0) ──────────────────
  // These are general symptoms that route to the main repair container
  {
    kcId: '700c4-01',
    sections: {
      0: { // Our AC Repair Service (additional symptom tradeTerms)
        tradeTerms: [
          'buzzing', 'humming', 'clicking', 'rattling', 'squealing',
          'grinding', 'whistling', 'banging', 'vibration',
          'loud noise', 'making noise', 'strange noise',
          'dripping water', 'leaking water', 'water in ceiling',
          'water in attic', 'drain line', 'clogged drain',
          'float switch', 'drain pan',
        ],
        callerPhrases: [
          'my ac is making a loud noise',
          'there is a buzzing sound from the outside unit',
          'the inside unit is dripping water',
          'I have water leaking from the ceiling',
          'the ac is making a clicking noise',
          'there is water in my attic from the ac',
          'my drain line is clogged',
          'the ac is rattling',
          'there is a grinding noise from the furnace',
        ],
      },
    },
  },

];

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('clientsvia');
  const col = db.collection('companyknowledgecontainers');

  let totalTradeTerms = 0;
  let totalCallerPhrases = 0;
  let containersUpdated = 0;

  for (const mapping of MAPPINGS) {
    // Find container by kcId + companyId
    const container = await col.findOne({
      companyId: COMPANY_ID,
      kcId: mapping.kcId,
    });

    if (!container) {
      console.warn(`⚠ Container ${mapping.kcId} not found — skipping`);
      continue;
    }

    const sections = container.sections || [];
    let updated = false;

    for (const [sIdxStr, data] of Object.entries(mapping.sections)) {
      const sIdx = parseInt(sIdxStr, 10);
      if (sIdx >= sections.length) {
        console.warn(`⚠ ${mapping.kcId} section ${sIdx} out of range (${sections.length} sections) — skipping`);
        continue;
      }

      const section = sections[sIdx];
      const label = section.label || `Section ${sIdx}`;

      // ── Merge tradeTerms ──────────────────────────────────────────
      if (data.tradeTerms?.length) {
        if (!section.tradeTerms) section.tradeTerms = [];
        const existing = new Set(section.tradeTerms.map(t => t.toLowerCase()));
        let added = 0;
        for (const term of data.tradeTerms) {
          const norm = term.toLowerCase().trim();
          if (norm && !existing.has(norm)) {
            section.tradeTerms.push(norm);
            existing.add(norm);
            added++;
          }
        }
        if (added > 0) {
          totalTradeTerms += added;
          updated = true;
          console.log(`  ✓ ${mapping.kcId} [${label}] +${added} tradeTerms (total: ${section.tradeTerms.length})`);
        }
      }

      // ── Merge callerPhrases ───────────────────────────────────────
      if (data.callerPhrases?.length) {
        if (!section.callerPhrases) section.callerPhrases = [];
        const existingTexts = new Set(section.callerPhrases.map(p => (p.text || '').toLowerCase()));
        let added = 0;
        for (const phrase of data.callerPhrases) {
          const norm = phrase.toLowerCase().trim();
          if (norm && !existingTexts.has(norm)) {
            section.callerPhrases.push({
              text: norm,
              anchorWords: [],  // populated on Re-score
              addedAt: new Date(),
            });
            existingTexts.add(norm);
            added++;
          }
        }
        if (added > 0) {
          totalCallerPhrases += added;
          updated = true;
          console.log(`  ✓ ${mapping.kcId} [${label}] +${added} callerPhrases (total: ${section.callerPhrases.length})`);
        }
      }
    }

    // Save using dot-notation for safety (never replace full sections array)
    if (updated) {
      const setOps = {};
      for (const [sIdxStr] of Object.entries(mapping.sections)) {
        const sIdx = parseInt(sIdxStr, 10);
        if (sIdx < sections.length) {
          setOps[`sections.${sIdx}.tradeTerms`] = sections[sIdx].tradeTerms;
          setOps[`sections.${sIdx}.callerPhrases`] = sections[sIdx].callerPhrases;
        }
      }
      await col.updateOne(
        { _id: container._id },
        { $set: setOps }
      );
      containersUpdated++;
      console.log(`  ✅ ${mapping.kcId} (${container.title}) saved`);
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`Done. ${containersUpdated} containers updated.`);
  console.log(`  +${totalTradeTerms} tradeTerms added`);
  console.log(`  +${totalCallerPhrases} callerPhrases added`);
  console.log('═══════════════════════════════════════');
  console.log('\nNEXT STEPS:');
  console.log('  1. Open services.html → each updated container');
  console.log('  2. Click "Re-score All" to generate embeddings');
  console.log('  3. Click "Fix All" to lock scores');
  console.log('  4. Click "Generate Missing Audio" if using fixed responses');

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
