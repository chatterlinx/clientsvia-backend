'use strict';
// Quick lookup — list all KC containers for Penguin Air so we can find the right _id
const { MongoClient, ObjectId } = require('mongodb');

const COMPANY_ID = '68e3f77a9d623b8058c700c4';

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const col = client.db('clientsvia').collection('companyKnowledgeContainers');

  const containers = await col
    .find({ companyId: COMPANY_ID })
    .project({ _id: 1, kcId: 1, title: 1, category: 1, daSubTypes: 1 })
    .toArray();

  console.log(`Found ${containers.length} containers for companyId ${COMPANY_ID}:\n`);
  containers.forEach(c => {
    console.log(`  _id:      ${c._id}`);
    console.log(`  kcId:     ${c.kcId || '(none)'}`);
    console.log(`  title:    ${c.title}`);
    console.log(`  category: ${c.category || '(none)'}`);
    console.log(`  daSubTypes: ${JSON.stringify(c.daSubTypes || [])}`);
    console.log('');
  });

  await client.close();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
