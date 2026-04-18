const { MongoClient } = require('mongodb');
(async () => {
  const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017');
  await client.connect();
  const db = client.db('clientsvia');
  const settings = await db.collection('adminsettings').findOne({});
  const vocabs = settings?.globalHub?.phraseIntelligence?.tradeVocabularies || [];
  const hvac = vocabs.find(v => v.tradeKey === 'HVAC');
  if (!hvac) { console.log('No HVAC vocab found'); await client.close(); return; }

  console.log('Total HVAC terms:', hvac.terms.length);
  const singleWord = hvac.terms.filter(t => !t.includes(' '));
  console.log('Single-word terms:', singleWord.length);
  console.log('Single-word list:', singleWord.join(', '));

  // Check key caller words
  console.log('\n--- Key word check ---');
  const checkWords = ['service', 'system', 'motor', 'pay', 'cooling', 'heating', 'repair', 'fix', 'broken', 'pulling', 'water', 'leak', 'schedule', 'diagnostic', 'fee', 'maintenance'];
  for (const w of checkWords) {
    const exact = hvac.terms.some(t => t.toLowerCase() === w);
    const substr = hvac.terms.filter(t => t.toLowerCase().includes(w));
    console.log(`${w}: exact=${exact}, appears_in=${substr.length} terms`);
  }

  // Simulate match against Turn 4 utterance
  console.log('\n--- Turn 4 simulation ---');
  const utterance = 'i want to ask you um how much is my service phone going to be uh do i have to pay for this call today';
  const matches = [];
  for (const term of hvac.terms) {
    const norm = term.toLowerCase().trim();
    if (utterance.includes(norm)) {
      matches.push(norm);
    }
  }
  console.log('Matches:', matches.length > 0 ? matches.join(', ') : 'NONE');

  // Simulate match against Turn 1
  console.log('\n--- Turn 1 simulation ---');
  const u1 = 'hi this is mark i just want to tell you um the system is not pulling again um we ve had tony here about a month ago he replaced the motor and everything was working fine but now at the end';
  const m1 = [];
  for (const term of hvac.terms) {
    const norm = term.toLowerCase().trim();
    if (u1.includes(norm)) {
      m1.push(norm);
    }
  }
  console.log('Matches:', m1.length > 0 ? m1.join(', ') : 'NONE');

  await client.close();
})().catch(e => console.error(e.message));
