// Run on Render Shell: node scripts/check-cues.js
const { MongoClient } = require('mongodb');

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('clientsvia');
  const doc = await db.collection('adminsettings').findOne({});
  const cues = doc?.globalHub?.phraseIntelligence?.cuePhrases || [];
  console.log('Total cue patterns:', cues.length);

  const groups = {};
  for (const c of cues) {
    const t = c.token || 'UNKNOWN';
    if (!(t in groups)) groups[t] = [];
    groups[t].push(c.pattern);
  }

  for (const token of Object.keys(groups).sort()) {
    const pats = groups[token];
    console.log('\n' + token + ' (' + pats.length + '):');
    console.log('  ' + pats.sort().join(', '));
  }

  // Specific checks for common maintenance phrases
  console.log('\n\n=== DIAGNOSTIC: Testing specific phrases ===');
  const testPhrases = [
    'i need maintenance on my air conditioner',
    'do you do ac maintenance',
    'can you come out for maintenance',
  ];

  for (const phrase of testPhrases) {
    console.log('\nPhrase: "' + phrase + '"');
    const lower = phrase.toLowerCase();
    const hits = [];
    for (const c of cues) {
      if (lower.includes(c.pattern.toLowerCase().trim())) {
        hits.push(c.token + ': "' + c.pattern + '"');
      }
    }
    console.log('  Hits: ' + (hits.length ? hits.join(', ') : 'NONE'));
  }

  await client.close();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
