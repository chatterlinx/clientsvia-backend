/**
 * audit-knowledge-cards.js
 *
 * One-time diagnostic: report any companies that have legacy `knowledgeCards[]`
 * populated on `aiAgentSettings.llmAgent.knowledgeCards`. As of April 17, 2026
 * this field is DEPRECATED — KC containers (services.html) are the single
 * source of truth. The runtime no longer reads knowledgeCards.
 *
 * This script does NOT delete data. It is READ-ONLY. Run on Render Shell
 * before the Agent Studio rebuild to confirm no client data is at risk.
 *
 * Usage on Render Shell:
 *   node scripts/audit-knowledge-cards.js
 *
 * Output:
 *   For each company with populated knowledgeCards[]:
 *   - companyId
 *   - company name
 *   - card count
 *   - card titles (truncated)
 *   - card types breakdown (trigger/company/website/custom)
 *
 * Multi-tenant safe: iterates ALL companies, no companyId hardcoded.
 */

const { MongoClient } = require('mongodb');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('ERROR: MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('clientsvia');
    const companiesCollection = db.collection('companiesCollection');

    console.log('='.repeat(70));
    console.log('Knowledge Cards Audit — April 17, 2026');
    console.log('='.repeat(70));
    console.log('');

    const total = await companiesCollection.countDocuments();
    console.log(`Total companies in database: ${total}`);
    console.log('');

    // Query: companies with at least one knowledgeCards entry
    const cursor = companiesCollection.find(
      { 'aiAgentSettings.llmAgent.knowledgeCards.0': { $exists: true } },
      {
        projection: {
          _id: 1,
          companyName: 1,
          'aiAgentSettings.llmAgent.knowledgeCards': 1,
        },
      }
    );

    let found = 0;
    const byType = { trigger: 0, company: 0, website: 0, custom: 0, other: 0 };

    for await (const doc of cursor) {
      found += 1;
      const cards = doc.aiAgentSettings?.llmAgent?.knowledgeCards || [];
      console.log('-'.repeat(70));
      console.log(`Company: ${doc.companyName || '(no name)'}`);
      console.log(`_id:     ${doc._id}`);
      console.log(`Cards:   ${cards.length}`);
      for (const c of cards.slice(0, 10)) {
        const t = (c.type || 'unknown').toLowerCase();
        byType[t in byType ? t : 'other'] = (byType[t in byType ? t : 'other'] || 0) + 1;
        const title = (c.title || '(no title)').slice(0, 60);
        const enabled = c.enabled === false ? ' [DISABLED]' : '';
        console.log(`  - [${t}] ${title}${enabled}`);
      }
      if (cards.length > 10) console.log(`  ... and ${cards.length - 10} more`);
      console.log('');
    }

    console.log('='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(`Companies with populated knowledgeCards: ${found}`);
    console.log(`Card types across all companies:`);
    console.log(`  trigger:  ${byType.trigger}`);
    console.log(`  company:  ${byType.company}`);
    console.log(`  website:  ${byType.website}`);
    console.log(`  custom:   ${byType.custom}`);
    console.log(`  other:    ${byType.other}`);
    console.log('');
    if (found === 0) {
      console.log('✅ No legacy knowledgeCards data — safe to proceed with Agent Studio rebuild.');
    } else {
      console.log('⚠️  Legacy knowledgeCards exist. Review above before removing the field.');
      console.log('   As of the Apr 17, 2026 deploy, this data is IGNORED by runtime.');
      console.log('   If any content here is still valuable, migrate it into a KC container.');
    }
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
