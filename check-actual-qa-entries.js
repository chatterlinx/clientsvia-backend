// Script to check actual Q&A entries in the production database
const { MongoClient } = require('mongodb');

async function checkActualQAEntries() {
  console.log('🔍 CHECKING ACTUAL Q&A ENTRIES IN DATABASE\n');
  
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/clientsvia';
  const client = new MongoClient(mongoUri);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db();
    
    // Check companies collection for categoryQAs
    const companies = await db.collection('companiesCollection').find({}).toArray();
    
    console.log(`\n📊 Found ${companies.length} companies`);
    
    for (const company of companies.slice(0, 3)) { // Just check first 3 companies
      console.log(`\n🏢 Company: ${company.companyName || company._id}`);
      console.log(`   ID: ${company._id}`);
      
      if (company.agentSetup?.categoryQAs) {
        console.log(`   📝 Category Q&As (${company.agentSetup.categoryQAs.length} chars):`);
        console.log(`   "${company.agentSetup.categoryQAs.substring(0, 200)}..."`);
        
        // Parse the Q&As using the same logic as the agent
        const { parseCategoryQAs } = require('./services/agent');
        const parsedQAs = parseCategoryQAs(company.agentSetup.categoryQAs);
        
        console.log(`   📋 Parsed Q&As: ${parsedQAs.length} entries`);
        parsedQAs.forEach((qa, index) => {
          if (qa.question.toLowerCase().includes('thermostat') || 
              qa.question.toLowerCase().includes('blank') ||
              (qa.keywords && qa.keywords.some(k => k.includes('thermostat') || k.includes('blank')))) {
            console.log(`   ${index + 1}. THERMOSTAT Q&A:`);
            console.log(`      Q: "${qa.question}"`);
            console.log(`      Keywords: [${qa.keywords?.join(', ') || 'none'}]`);
            console.log(`      A: "${qa.answer.substring(0, 100)}..."`);
          }
        });
      } else {
        console.log('   ❌ No categoryQAs found');
      }
      
      // Check aiSettings for fuzzyThreshold
      if (company.aiSettings) {
        console.log(`   🎛️  Fuzzy Threshold: ${company.aiSettings.fuzzyMatchThreshold || 'default (0.3)'}`);
      }
    }
    
    // Also check KnowledgeEntry collection
    const knowledgeEntries = await db.collection('knowledgeentries').find({
      $or: [
        { question: { $regex: /thermostat|blank/i } },
        { keywords: { $regex: /thermostat|blank/i } }
      ]
    }).toArray();
    
    console.log(`\n📚 Knowledge Entries with thermostat/blank: ${knowledgeEntries.length}`);
    knowledgeEntries.forEach((entry, index) => {
      console.log(`${index + 1}. Q: "${entry.question}"`);
      console.log(`   A: "${entry.answer.substring(0, 100)}..."`);
      console.log(`   Keywords: [${entry.keywords?.join(', ') || 'none'}]`);
      console.log(`   Company: ${entry.companyId}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error checking database:', error);
  } finally {
    await client.close();
  }
}

// Also test the actual Q&A matching logic currently in production
async function testProductionMatching() {
  console.log('\n🎯 TESTING PRODUCTION Q&A MATCHING LOGIC\n');
  
  const { findCachedAnswer } = require('./utils/aiAgent');
  
  // Test with empty entries to see what happens
  const result1 = findCachedAnswer([], 'my thermostat is blank', 0.3);
  console.log('Empty entries result:', result1);
  
  // Test with single word threshold
  const result2 = findCachedAnswer([], 'my thermostat is blank', 0.5);
  console.log('Higher threshold result:', result2);
}

checkActualQAEntries()
  .then(() => testProductionMatching())
  .then(() => {
    console.log('\n✅ Database check complete');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Script error:', error);
    process.exit(1);
  });
