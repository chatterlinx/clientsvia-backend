// Run on Render Shell: node scripts/seed-spam-kc.js
// Creates a "Spam & Solicitation" KC for Penguin Air with Fixed responses.
// Links to the SPAM trade vocabulary in GlobalShare.
// Safe to re-run: skips if a container with the same title already exists.

const { MongoClient, ObjectId } = require('mongodb');

const COMPANY_ID = '68e3f77a9d623b8058c700c4'; // Penguin Air (dev/test)

const DISMISSAL = "We're not interested. Please remove us from your call list. Goodbye.";
const WRONG_NUMBER = "I think you have the wrong number. This is a business line. Goodbye.";

const SECTIONS = [
  {
    label: 'Google & SEO Spam',
    content: DISMISSAL,
    order: 0,
    isActive: true,
    useFixedResponse: true,
    bookingAction: 'none',
    callerPhrases: [
      { text: 'I am calling about your Google business listing' },
      { text: 'We can get you on the first page of Google' },
      { text: 'I noticed your business listing has some issues' },
      { text: 'We offer SEO services to improve your search results' },
      { text: 'Are you the person who handles your website' },
      { text: 'I can help improve your online presence' },
      { text: 'Your Google Maps listing needs to be updated' },
      { text: 'We specialize in digital marketing for local businesses' },
    ],
    tradeTerms: [],
    negativeKeywords: [],
  },
  {
    label: 'Warranty & Insurance Scam',
    content: DISMISSAL,
    order: 1,
    isActive: true,
    useFixedResponse: true,
    bookingAction: 'none',
    callerPhrases: [
      { text: 'We are calling about your vehicle extended warranty' },
      { text: 'Your car warranty is about to expire' },
      { text: 'We can save you money on your insurance' },
      { text: 'I am calling about your insurance policy' },
      { text: 'We have a special offer on home warranty coverage' },
      { text: 'This is regarding your auto warranty' },
    ],
    tradeTerms: [],
    negativeKeywords: [],
  },
  {
    label: 'Solar & Energy Spam',
    content: DISMISSAL,
    order: 2,
    isActive: true,
    useFixedResponse: true,
    bookingAction: 'none',
    callerPhrases: [
      { text: 'We can lower your electric bill with solar panels' },
      { text: 'Have you considered solar energy for your business' },
      { text: 'I am calling from the utility company about your energy usage' },
      { text: 'We offer free energy audits for businesses in your area' },
    ],
    tradeTerms: [],
    negativeKeywords: [],
  },
  {
    label: 'Financial & Debt Spam',
    content: DISMISSAL,
    order: 3,
    isActive: true,
    useFixedResponse: true,
    bookingAction: 'none',
    callerPhrases: [
      { text: 'We can lower your credit card interest rate' },
      { text: 'Are you interested in a business loan' },
      { text: 'We offer merchant services and payment processing' },
      { text: 'I am calling about your student loan forgiveness options' },
      { text: 'We can help with debt consolidation' },
    ],
    tradeTerms: [],
    negativeKeywords: [],
  },
  {
    label: 'Generic Telemarketer',
    content: DISMISSAL,
    order: 4,
    isActive: true,
    useFixedResponse: true,
    bookingAction: 'none',
    callerPhrases: [
      { text: 'Do you have a moment to discuss a special promotion' },
      { text: 'I am calling on behalf of a company that can help your business' },
      { text: 'Can I speak to the business owner or decision maker' },
      { text: 'Who handles your marketing and advertising' },
      { text: 'We have a limited time offer for businesses like yours' },
      { text: 'You have been selected for an exclusive offer' },
      { text: 'This is a courtesy call to verify your information' },
      { text: 'We would like to conduct a quick customer satisfaction survey' },
    ],
    tradeTerms: [],
    negativeKeywords: [],
  },
  {
    label: 'Robocall & IVR',
    content: "This is a business line. We do not accept automated calls. Goodbye.",
    order: 5,
    isActive: true,
    useFixedResponse: true,
    bookingAction: 'none',
    callerPhrases: [
      { text: 'Press one to speak with an agent' },
      { text: 'This is an important message regarding your account' },
      { text: 'Do not hang up this is not a sales call' },
      { text: 'Stay on the line for an important message' },
      { text: 'This is your final notice' },
      { text: 'We have been trying to reach you about an urgent matter' },
    ],
    tradeTerms: [],
    negativeKeywords: [],
  },
  {
    label: 'Wrong Number',
    content: WRONG_NUMBER,
    order: 6,
    isActive: true,
    useFixedResponse: true,
    bookingAction: 'none',
    callerPhrases: [
      { text: 'Is this the number for a restaurant' },
      { text: 'I am trying to reach a doctor office' },
      { text: 'Is this a residential number' },
      { text: 'Sorry I think I have the wrong number' },
    ],
    tradeTerms: [],
    negativeKeywords: [],
  },
];

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('clientsvia');
  const col = db.collection('companyKnowledgeContainers');

  // Check if Spam KC already exists for this company
  const existing = await col.findOne({ companyId: COMPANY_ID, title: 'Spam & Solicitation' });
  if (existing) {
    console.log('⚠️  Spam KC already exists for Penguin Air (id:', existing._id.toString(), ')');
    console.log('   Sections:', existing.sections?.length || 0);
    console.log('   Trade link:', existing.tradeVocabularyKey || 'none');
    console.log('   Skipping. Delete manually first if you want to re-seed.');
    await client.close();
    process.exit(0);
  }

  // Generate kcId — increment company kcSeq
  const companyCol = db.collection('companiesCollection');
  const companyUpdate = await companyCol.findOneAndUpdate(
    { _id: new ObjectId(COMPANY_ID) },
    { $inc: { 'aiAgentSettings.kcSeq': 1 } },
    { returnDocument: 'after' }
  );
  const seq = companyUpdate?.aiAgentSettings?.kcSeq || 1;
  const kcId = COMPANY_ID.slice(-5) + '-' + String(seq).padStart(2, '0');

  // Add addedAt to each callerPhrase
  const now = new Date();
  const sections = SECTIONS.map(s => ({
    ...s,
    _id: new ObjectId(),
    callerPhrases: s.callerPhrases.map(p => ({
      ...p,
      addedAt: now,
      anchorWords: [],
    })),
  }));

  const doc = {
    companyId: COMPANY_ID,
    kcId,
    title: 'Spam & Solicitation',
    category: 'Spam',
    sections,
    sampleQuestions: [],
    wordLimit: null,
    wordLimitEnabled: false,
    useFixedResponse: true,
    sampleResponse: null,
    bookingAction: 'none',
    closingPrompt: '',
    isActive: true,
    priority: 999,               // lowest priority — real KCs always win in ties
    tradeVocabularyKey: 'SPAM',  // links to GlobalShare Spam trade vocabulary
    createdAt: now,
    updatedAt: now,
  };

  const result = await col.insertOne(doc);

  console.log('✅ Spam KC created for Penguin Air');
  console.log('   _id:      ', result.insertedId.toString());
  console.log('   kcId:     ', kcId);
  console.log('   title:     Spam & Solicitation');
  console.log('   trade:     SPAM');
  console.log('   sections: ', sections.length);
  console.log('   priority:  999 (lowest — real KCs always win)');
  console.log('   mode:      Fixed Response (no Groq)');
  console.log('   booking:   none');

  console.log('\nSections:');
  for (const s of sections) {
    console.log(`  ${s.order}. ${s.label} (${s.callerPhrases.length} phrases) — Fixed: "${s.content.substring(0, 50)}..."`);
  }

  console.log('\n⚡ Next steps:');
  console.log('   1. Run: node scripts/seed-spam-vocabulary.js  (if not already run)');
  console.log('   2. Open services.html → verify Spam KC appears');
  console.log('   3. Open services-item.html for this KC → verify trade link = SPAM');
  console.log('   4. BridgeService will index the callerPhrases on next cache refresh');

  await client.close();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
