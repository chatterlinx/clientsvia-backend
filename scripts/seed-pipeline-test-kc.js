// Run on Render Shell: node scripts/seed-pipeline-test-kc.js
// Creates an "HVAC Pipeline Validation Test" KC for Penguin Air.
// 5 sections — each exercises a different pipeline gate.
// Upsert-safe: re-run replaces the container cleanly.

const { MongoClient, ObjectId } = require('mongodb');

const COMPANY_ID = '68e3f77a9d623b8058c700c4'; // Penguin Air (dev/test)

const now = new Date();

// ─── Helper: build callerPhrase with anchorWords ────────────────────────────
function phrase(text, anchors = []) {
  return { text, addedAt: now, anchorWords: anchors };
}

// ─── SECTIONS ───────────────────────────────────────────────────────────────

const SECTIONS = [
  // ── Section 0: Fixed Response + UAP Layer 1 ──────────────────────────────
  // Tests: GATE 2.5 (phrase match) + Fixed Response path (no Groq)
  {
    _id: new ObjectId(),
    label: 'AC Tune-Up Pricing',
    content: 'Our standard AC tune-up is $129 per system. Two or more systems same visit, $109 each. Spring special is $79 with coupon code SPRING2026.',
    order: 0,
    isActive: true,
    useFixedResponse: true,
    bookingAction: 'offer_to_book',
    callerPhrases: [
      phrase('how much is a tune-up', ['tune']),
      phrase('what does a tune-up cost', ['tune', 'cost']),
      phrase('price for AC maintenance', ['price', 'maintenance']),
      phrase('how much do you charge for a tune-up', ['charge', 'tune']),
    ],
    tradeTerms: ['tune-up', 'ac maintenance', 'preventive maintenance', 'seasonal service'],
    negativeKeywords: ['duct', 'emergency', 'leak'],
  },

  // ── Section 1: Groq Synthesis + UAP Layer 1 ─────────────────────────────
  // Tests: GATE 2.5 (phrase match) + Groq answering from rich content
  {
    _id: new ObjectId(),
    label: 'Duct Cleaning Service',
    content: 'Our professional duct cleaning service removes dust, allergens, mold, and debris from your entire HVAC ductwork system. The process takes 3-4 hours for a standard home and includes all supply and return ducts, the main trunk line, and register covers. We use a powerful HEPA-filtered vacuum system with rotating brushes. Recommended every 3-5 years or after renovation. Pricing starts at $349 for homes up to 2000 square feet, with an additional $50 per 500 square feet above that.',
    order: 1,
    isActive: true,
    useFixedResponse: false,
    bookingAction: 'offer_to_book',
    callerPhrases: [
      phrase('do you clean air ducts', ['ducts', 'clean']),
      phrase('how much is duct cleaning', ['duct', 'cleaning']),
      phrase('I need my ductwork cleaned', ['ductwork', 'cleaned']),
    ],
    tradeTerms: ['duct cleaning', 'air ducts', 'ductwork', 'dryer vent'],
    negativeKeywords: ['tune-up', 'emergency'],
  },

  // ── Section 2: Groq + Pre-Qualify Question ──────────────────────────────
  // Tests: GATE 2.5 + GATE 3.5 (pre-qualify intercept)
  {
    _id: new ObjectId(),
    label: 'Refrigerant Leak Repair',
    content: 'Refrigerant leaks are diagnosed with electronic leak detection and dye testing. Minor leaks at fittings can often be repaired same day for $250-$450 including refrigerant recharge. Major coil leaks may require evaporator or condenser replacement, ranging from $800-$2500 depending on system type. We service all refrigerant types including R-410A and R-22 systems. If your system uses R-22 which is being phased out, we can discuss retrofit options to R-410A.',
    order: 2,
    isActive: true,
    useFixedResponse: false,
    bookingAction: 'offer_to_book',
    callerPhrases: [
      phrase('I think I have a refrigerant leak', ['refrigerant', 'leak']),
      phrase('my AC is low on freon', ['freon']),
      phrase('the AC is not blowing cold anymore', ['cold']),
    ],
    tradeTerms: ['refrigerant', 'freon', 'coolant', 'leak', 'recharge', 'r-410a'],
    negativeKeywords: ['duct', 'thermostat'],
    preQualifyQuestion: {
      enabled: true,
      text: 'Is your system still cooling somewhat, or has it stopped blowing cold air completely?',
      fieldKey: 'leakSeverity',
      options: [
        {
          label: 'Partial Cooling',
          value: 'partial',
          keywords: ['somewhat', 'a little', 'still cooling', 'warm', 'not as cold', 'kind of'],
          responseContext: 'Caller reports partial cooling — likely a slow refrigerant leak.',
        },
        {
          label: 'No Cooling At All',
          value: 'none',
          keywords: ['nothing', 'no', 'stopped', 'completely', 'not at all', 'warm air', 'hot air'],
          responseContext: 'Caller reports zero cooling — could be major leak or compressor issue. May need emergency dispatch.',
        },
      ],
    },
  },

  // ── Section 3: NO CallerPhrases — forces Semantic + Keyword fallback ────
  // Tests: GATE 2.8 (Semantic Match) + GATE 3 (Keyword scoring)
  // UAP Layer 1 will MISS (no phrases indexed). Must fall through.
  {
    _id: new ObjectId(),
    label: 'Thermostat Issues',
    content: 'We troubleshoot and replace all thermostat brands including Honeywell, Nest, Ecobee, and Emerson. Common issues include blank display, temperature reading errors, short cycling, and wifi connectivity problems. Basic thermostat replacement with a standard programmable model is $150-$250 installed. Smart thermostat installation with wifi setup is $250-$400. If your thermostat display is blank, check the batteries first and verify the breaker is on before calling for service.',
    order: 3,
    isActive: true,
    useFixedResponse: false,
    bookingAction: 'offer_to_book',
    callerPhrases: [],  // DELIBERATELY EMPTY — tests semantic/keyword fallback
    tradeTerms: ['thermostat', 'temperature control', 'smart thermostat', 'nest', 'ecobee', 'honeywell'],
    negativeKeywords: ['duct', 'tune-up'],
  },

  // ── Section 4: Groq + Upsell Chain ─────────────────────────────────────
  // Tests: GATE 2.5 + GATE 4.5 (upsell after Groq BOOKING_READY)
  {
    _id: new ObjectId(),
    label: 'Emergency AC Service',
    content: 'We provide 24/7 emergency AC repair service with same-day dispatch available. A diagnostic fee of $89 applies and is waived if you proceed with the repair. Emergency after-hours service between 6 PM and 8 AM has a $49 after-hours surcharge. Our technicians carry common replacement parts on their trucks including capacitors, contactors, fan motors, and refrigerant so most repairs are completed in a single visit.',
    order: 4,
    isActive: true,
    useFixedResponse: false,
    bookingAction: 'offer_to_book',
    callerPhrases: [
      phrase('my AC stopped working', ['stopped', 'working']),
      phrase('I have no air conditioning', ['no', 'air conditioning']),
      phrase('AC emergency need someone today', ['emergency', 'today']),
    ],
    tradeTerms: ['emergency', 'ac repair', 'broken ac', 'no cooling', 'same day'],
    negativeKeywords: ['tune-up', 'duct', 'thermostat'],
    upsellChain: [
      {
        _id: new ObjectId(),
        offerScript: 'While our technician is there, would you also like them to do a full system tune-up? It is normally $129 but we can add it on for just $79 since we are already there.',
        yesScript: 'Great, I will add the tune-up to the visit.',
        noScript: 'No problem at all. We will focus on getting the repair taken care of.',
        itemKey: 'emergency_addon_tuneup',
        price: 79,
      },
    ],
  },
];

// ─── MAIN ───────────────────────────────────────────────────────────────────

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('clientsvia');
  const col = db.collection('companyKnowledgeContainers');

  // Generate kcId — increment company kcSeq
  const companyCol = db.collection('companiesCollection');
  const companyUpdate = await companyCol.findOneAndUpdate(
    { _id: new ObjectId(COMPANY_ID) },
    { $inc: { 'aiAgentSettings.kcSeq': 1 } },
    { returnDocument: 'after' }
  );
  const seq = companyUpdate?.aiAgentSettings?.kcSeq || 1;
  const kcId = COMPANY_ID.slice(-5) + '-' + String(seq).padStart(2, '0');

  const doc = {
    companyId: COMPANY_ID,
    kcId,
    title: 'HVAC Pipeline Validation Test',
    category: 'Test',
    sections: SECTIONS,
    sampleQuestions: [
      'how much is a tune-up',
      'do you clean air ducts',
      'I think I have a refrigerant leak',
      'my thermostat is not working',
      'my AC stopped working need someone today',
    ],
    wordLimit: 50,
    wordLimitEnabled: true,
    useFixedResponse: false,
    sampleResponse: 'TONE: Friendly and reassuring. KEY FACTS: Always mention specific pricing. OFFER: Suggest scheduling. AVOID: Never guess at diagnosis without a technician visit.',
    bookingAction: 'offer_to_book',
    closingPrompt: 'Would you like me to get that scheduled for you?',
    isActive: true,
    priority: 10,
    tradeVocabularyKey: 'HVAC',
    createdAt: now,
    updatedAt: now,
  };

  // Upsert: replace if exists, insert if not
  const result = await col.updateOne(
    { companyId: COMPANY_ID, title: 'HVAC Pipeline Validation Test' },
    { $set: doc },
    { upsert: true }
  );

  const action = result.upsertedCount ? 'Created' : 'Updated';
  console.log(`✅ ${action} HVAC Pipeline Test KC for Penguin Air`);
  console.log('   kcId:     ', kcId);
  console.log('   sections: ', SECTIONS.length);
  console.log('   trade:     HVAC');
  console.log('   priority:  10');

  console.log('\nSections:');
  for (const s of SECTIONS) {
    const mode = s.useFixedResponse ? 'Fixed' : 'Groq';
    const phrases = s.callerPhrases.length;
    const extras = [];
    if (s.preQualifyQuestion?.enabled) extras.push('PreQualify');
    if (s.upsellChain?.length) extras.push('Upsell');
    if (!phrases) extras.push('NO PHRASES (semantic/keyword only)');
    console.log(`  ${s.order}. ${s.label} — ${mode}, ${phrases} phrases${extras.length ? ' [' + extras.join(', ') + ']' : ''}`);
  }

  console.log('\n🧪 Test utterances:');
  console.log('   "how much is a tune-up"             → Section 0 (Fixed, UAP L1)');
  console.log('   "do you clean air ducts"             → Section 1 (Groq, UAP L1)');
  console.log('   "I think I have a refrigerant leak"  → Section 2 (Groq, PreQualify)');
  console.log('   "my thermostat is not working"        → Section 3 (Groq, Semantic/KW fallback)');
  console.log('   "my AC stopped working"               → Section 4 (Groq, Upsell chain)');

  await client.close();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
