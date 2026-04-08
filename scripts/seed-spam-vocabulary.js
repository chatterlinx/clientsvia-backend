// Run on Render Shell: node scripts/seed-spam-vocabulary.js
// Adds a "Spam & Solicitation" trade vocabulary to GlobalShare.
// Merge-safe: skips terms that already exist.

const { MongoClient } = require('mongodb');

const SPAM_TRADE = {
  tradeKey: 'SPAM',
  label: 'Spam & Solicitation',
  terms: [
    // Google / SEO / Marketing
    'google listing',
    'google business',
    'google business listing',
    'google my business',
    'business listing',
    'search results',
    'first page of google',
    'seo services',
    'website traffic',
    'marketing services',
    'online presence',
    'digital marketing',
    'social media marketing',
    'web design services',
    'your website',
    'search engine',
    'google maps',
    'online reviews',

    // Warranty / Insurance scams
    'extended warranty',
    'warranty expiring',
    'vehicle warranty',
    'car warranty',
    'auto warranty',
    'home warranty',
    'lower your rate',
    'insurance quote',
    'save on insurance',
    'insurance policy',
    'health insurance',
    'medicare',
    'medicaid',
    'open enrollment',

    // Solar / Energy
    'solar panel',
    'solar energy',
    'energy savings',
    'lower your electric bill',
    'utility company',
    'energy audit',

    // Home improvement spam
    'roof inspection',
    'free estimate',
    'home improvement',
    'siding replacement',
    'window replacement',
    'gutter cleaning',
    'pest control services',

    // Financial / Debt
    'credit card rate',
    'lower your interest',
    'debt consolidation',
    'student loan',
    'loan forgiveness',
    'business loan',
    'merchant services',
    'credit card processing',
    'payment processing',

    // Generic telemarketer
    'do you have a moment',
    'business owner available',
    'decision maker',
    'person in charge',
    'who handles your',
    'calling on behalf of',
    'special promotion',
    'limited time offer',
    'exclusive offer',
    'qualify for',
    'been selected',
    'calling to let you know',
    'verify your information',
    'update your records',
    'quick survey',
    'customer satisfaction survey',
    'courtesy call',

    // Robocall / IVR
    'press one',
    'press 1',
    'press two',
    'press 2',
    'this is an important message',
    'do not hang up',
    'stay on the line',
    'your account has been',
    'urgent matter',
    'final notice',
    'last attempt to reach you',
    'legal action',

    // Political / Charity
    'political survey',
    'charitable donation',
    'nonprofit organization',
    'fundraising',
  ]
};

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('clientsvia');

  // Load current AdminSettings
  const doc = await db.collection('adminsettings').findOne({});
  const pi = doc?.globalHub?.phraseIntelligence || {};
  const existing = Array.isArray(pi.tradeVocabularies) ? pi.tradeVocabularies : [];

  // Check if SPAM trade already exists
  const spamIdx = existing.findIndex(tv => tv.tradeKey === 'SPAM');

  let added = 0;
  if (spamIdx >= 0) {
    // Merge: add new terms that don't exist yet
    const currentTerms = new Set(existing[spamIdx].terms.map(t => t.toLowerCase().trim()));
    for (const term of SPAM_TRADE.terms) {
      const clean = term.toLowerCase().trim();
      if (!currentTerms.has(clean)) {
        existing[spamIdx].terms.push(clean);
        currentTerms.add(clean);
        added++;
      }
    }
    existing[spamIdx].label = SPAM_TRADE.label; // update label if changed
    console.log('SPAM trade already exists — merged. New terms added:', added);
    console.log('Total terms now:', existing[spamIdx].terms.length);
  } else {
    // Brand new — add the whole trade
    const clean = SPAM_TRADE.terms.map(t => t.toLowerCase().trim());
    existing.push({ tradeKey: SPAM_TRADE.tradeKey, label: SPAM_TRADE.label, terms: clean });
    added = clean.length;
    console.log('Created SPAM trade vocabulary with', added, 'terms');
  }

  // Save back
  await db.collection('adminsettings').updateOne(
    { _id: doc._id },
    { $set: { 'globalHub.phraseIntelligence.tradeVocabularies': existing } }
  );

  console.log('\n✅ Spam vocabulary saved to GlobalShare.');
  console.log('Go to GlobalShare → Phrase Intelligence → Trade Vocabularies to see it.');

  // Print all terms
  const final = existing.find(tv => tv.tradeKey === 'SPAM');
  console.log('\nAll SPAM terms (' + final.terms.length + '):');
  console.log(final.terms.sort().join(', '));

  await client.close();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
