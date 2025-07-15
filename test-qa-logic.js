/**
 * Direct Q&A Matching Test for Pricing Questions
 */

const { findCachedAnswer } = require('./utils/aiAgent');

function simulateQAMatching() {
  console.log('🧪 Testing Q&A Matching Logic for Pricing Questions...\n');
  
  // Simulate the Q&A entries that were added by the fix-pricing-qa.js script
  const mockQAEntries = [
    {
      question: 'service call cost',
      keywords: [
        'service call cost',
        'diagnostic fee',
        'visit fee',
        'trip charge',
        'how much service call',
        'cost to come out',
        'technician visit cost'
      ],
      answer: 'Our service call is just $49, which covers the technician visit and diagnostic to identify the issue. If we proceed with any repairs, this fee is often applied toward the work. Would you like to schedule a diagnostic visit?',
      category: 'Pricing'
    },
    {
      question: 'ac service price',
      keywords: [
        'ac serviced',
        'how much ac service',
        'ac tune-up cost',
        'full service cost',
        'maintenance package price',
        'how much to service ac',
        'ac maintenance cost',
        'annual service cost',
        'hvac service price'
      ],
      answer: 'A full AC service or tune-up starts at $89 and includes coil cleaning, refrigerant check, filter inspection, electrical connections check, and performance testing. The initial $49 service call fee is included in this price. Most tune-ups take 1-2 hours. Would you like to schedule your AC service?',
      category: 'Pricing'
    },
    {
      question: 'repair pricing',
      keywords: [
        'repair cost',
        'how much repair',
        'fix cost',
        'replacement price',
        'part cost',
        'labor cost',
        'repair estimate'
      ],
      answer: 'Repair costs vary based on the specific issue and parts needed. Common repairs range from $150-$800, with most falling between $250-$450. Our $49 service call includes diagnosis, and if you approve the repair, this fee goes toward the total cost. We provide upfront pricing before any work begins.',
      category: 'Pricing'
    }
  ];

  // Test questions that should match different pricing categories
  const testQuestions = [
    {
      question: 'How much is your service call?',
      expectedMatch: 'service call cost',
      expectedKeywords: ['$49', 'service call', 'diagnostic']
    },
    {
      question: 'How much is your AC serviced?',
      expectedMatch: 'ac service price',
      expectedKeywords: ['$89', 'tune-up', 'full service']
    },
    {
      question: 'What do you charge for repairs?',
      expectedMatch: 'repair pricing',
      expectedKeywords: ['$150-$800', 'repair cost', 'range']
    },
    {
      question: 'How much does it cost to come out?',
      expectedMatch: 'service call cost',
      expectedKeywords: ['$49', 'technician visit']
    },
    {
      question: 'What does AC maintenance cost?',
      expectedMatch: 'ac service price',
      expectedKeywords: ['$89', 'maintenance']
    }
  ];

  console.log('📋 Testing Q&A Matching with Mock Entries:');
  mockQAEntries.forEach((entry, index) => {
    console.log(`   ${index + 1}. "${entry.question}" - Keywords: ${entry.keywords.slice(0, 3).join(', ')}...`);
  });
  console.log();

  // Test each question
  for (const [index, test] of testQuestions.entries()) {
    console.log(`🎯 Test ${index + 1}: "${test.question}"`);
    
    try {
      // Simulate the matching logic
      const matchedAnswer = findCachedAnswer(mockQAEntries, test.question, 0.25);
      
      if (matchedAnswer) {
        console.log(`   ✅ Match found!`);
        console.log(`   📝 Answer: ${matchedAnswer.substring(0, 100)}...`);
        
        // Check for expected keywords
        const answerLower = matchedAnswer.toLowerCase();
        const foundKeywords = test.expectedKeywords.filter(keyword => 
          answerLower.includes(keyword.toLowerCase())
        );
        
        if (foundKeywords.length > 0) {
          console.log(`   ✅ Contains expected keywords: ${foundKeywords.join(', ')}`);
        } else {
          console.log(`   ⚠️  Missing expected keywords: ${test.expectedKeywords.join(', ')}`);
        }
        
        // Check if it matched the expected Q&A entry
        const matchedEntry = mockQAEntries.find(entry => entry.answer === matchedAnswer);
        if (matchedEntry && matchedEntry.question === test.expectedMatch) {
          console.log(`   ✅ Matched correct entry: "${test.expectedMatch}"`);
        } else if (matchedEntry) {
          console.log(`   ⚠️  Matched different entry: "${matchedEntry.question}" (expected: "${test.expectedMatch}")`);
        }
        
      } else {
        console.log(`   ❌ No match found`);
        console.log(`   📝 Expected match: "${test.expectedMatch}"`);
      }
      
    } catch (error) {
      console.log(`   ❌ Error during matching: ${error.message}`);
    }
    
    console.log();
  }

  console.log('🎉 Q&A Matching Test Complete!');
  console.log('\n📊 Summary:');
  console.log('- Service call questions should match $49 pricing');
  console.log('- AC service questions should match $89+ pricing'); 
  console.log('- Repair questions should provide cost ranges');
  console.log('- Each type has distinct keywords and answers');
}

// Run the test
simulateQAMatching();
