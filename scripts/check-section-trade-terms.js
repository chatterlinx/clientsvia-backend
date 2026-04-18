// Check per-section tradeTerms on Penguin Air KC containers
// Run on Render Shell: node scripts/check-section-trade-terms.js
const { MongoClient } = require('mongodb');
(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('clientsvia');
  const containers = await db.collection('companyknowledgecontainers').find({
    companyId: '68e3f77a9d623b8058c700c4',
    isActive: true,
  }, { projection: { title: 1, kcId: 1, tradeVocabularyKey: 1, 'sections.label': 1, 'sections.tradeTerms': 1, 'sections.isActive': 1 } }).toArray();

  console.log('Containers:', containers.length);
  for (const c of containers) {
    console.log('\n' + (c.title || 'Untitled') + ' (' + (c.kcId || 'no-id') + ') — tradeVocabKey: ' + (c.tradeVocabularyKey || 'NONE'));
    const sections = c.sections || [];
    let hasTerms = 0;
    let totalTerms = 0;
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (s.isActive === false) continue;
      const terms = s.tradeTerms || [];
      if (terms.length > 0) {
        hasTerms++;
        totalTerms += terms.length;
        console.log('  [' + i + '] ' + (s.label || '(no label)') + ': ' + terms.join(', '));
      }
    }
    if (hasTerms === 0) console.log('  NO sections have tradeTerms');
    else console.log('  ' + hasTerms + ' sections with tradeTerms (' + totalTerms + ' total)');
  }
  await client.close();
})().catch(e => console.error(e.message));
