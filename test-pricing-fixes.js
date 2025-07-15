/**
 * Test Pricing Q&A Fixes - Simplified Test
 */

const { MongoClient } = require('mongodb');

async function testPricingFixes() {
  console.log('🧪 Testing Pricing Q&A Fixes...\n');
  
  const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://marcsanchez:WyKPOk7eXmTBOGr3@cluster0.nxzqd.mongodb.net/clientsvia-backend?retryWrites=true&w=majority';
  
  let client;
  try {
    client = new MongoClient(mongoUri, { 
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    });
    
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db('clientsvia-backend');
    const knowledgeEntries = db.collection('knowledgeentries');
    
    // Check for the new pricing entries
    console.log('📋 Checking pricing-related Q&A entries:\n');
    
    const pricingKeywords = ['service call cost', 'ac service', 'repair cost', 'pricing'];
    for (const keyword of pricingKeywords) {
      const entries = await knowledgeEntries.find({
        keywords: { $in: [keyword] }
      }).toArray();
      
      console.log(`🔍 Entries containing "${keyword}":`);
      entries.forEach((entry, index) => {
        console.log(`   ${index + 1}. "${entry.question}"`);
        console.log(`      Keywords: ${entry.keywords.slice(0, 3).join(', ')}...`);
        console.log(`      Answer: ${entry.answer.substring(0, 80)}...`);
        console.log();
      });
    }
    
    // Test scenarios
    console.log('\n🎯 Testing different pricing scenarios:\n');
    
    const testQuestions = [
      'How much is your service call?',
      'How much is your AC serviced?',
      'What do you charge for repairs?',
      'How much does it cost to fix my AC?'
    ];
    
    for (const question of testQuestions) {
      console.log(`❓ Question: "${question}"`);
      
      // Simple keyword matching simulation
      const words = question.toLowerCase().split(' ');
      const matches = [];
      
      const allEntries = await knowledgeEntries.find({}).toArray();
      
      for (const entry of allEntries) {
        let score = 0;
        for (const keyword of entry.keywords) {
          if (words.some(word => keyword.includes(word) || word.includes(keyword))) {
            score++;
          }
        }
        if (score > 0) {
          matches.push({ entry, score });
        }
      }
      
      matches.sort((a, b) => b.score - a.score);
      
      if (matches.length > 0) {
        const best = matches[0];
        console.log(`   ✅ Best match: "${best.entry.question}" (score: ${best.score})`);
        console.log(`   📝 Answer: ${best.entry.answer.substring(0, 100)}...`);
      } else {
        console.log('   ❌ No matches found');
      }
      console.log();
    }
    
    console.log('🎉 Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

// Run the test
testPricingFixes().catch(console.error);
