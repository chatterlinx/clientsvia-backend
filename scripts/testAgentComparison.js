// scripts/testAgentComparison.js
// Compare current agent vs HighLevel competitive mode

const { answerQuestion } = require('../services/agent');
const { answerQuestionCompetitive } = require('../services/agentCompetitive');
const { getDB } = require('../db');

// Test scenarios that HighLevel likely handles well
const testScenarios = [
  {
    name: "Basic Scheduling Request",
    question: "I need to schedule an appointment for AC repair",
    expectedKeywords: ["schedule", "appointment", "repair"]
  },
  {
    name: "Emergency Situation",
    question: "Emergency! My heater is broken and it's freezing",
    expectedKeywords: ["emergency", "urgent", "immediately"]
  },
  {
    name: "Pricing Question",
    question: "How much does AC repair cost?",
    expectedKeywords: ["cost", "price", "estimate"]
  },
  {
    name: "Business Hours",
    question: "What are your hours?",
    expectedKeywords: ["hours", "open", "monday", "friday"]
  },
  {
    name: "Simple Yes Response",
    question: "yes",
    expectedKeywords: ["perfect", "help", "what"]
  },
  {
    name: "Service Information",
    question: "Do you fix air conditioners?",
    expectedKeywords: ["yes", "fix", "repair", "ac"]
  },
  {
    name: "Complex Technical Question",
    question: "My thermostat shows error code E3 and the compressor is making weird noises",
    expectedKeywords: ["error", "thermostat", "compressor", "schedule"]
  }
];

async function runComparison() {
  console.log('\n🤖 AGENT COMPARISON TEST - Current vs HighLevel Competitive Mode\n');
  
  try {
    // Find a test company
    const db = getDB();
    const company = await db.collection('companiesCollection').findOne();
    
    if (!company) {
      console.log('❌ No test company found. Please create a company first.');
      return;
    }
    
    const companyId = company._id.toString();
    console.log(`Testing with company: ${company.companyName}\n`);
    
    const results = {
      current: { totalTime: 0, successes: 0, escalations: 0 },
      competitive: { totalTime: 0, successes: 0, escalations: 0 }
    };
    
    for (const scenario of testScenarios) {
      console.log(`\n📋 ${scenario.name}`);
      console.log(`Question: "${scenario.question}"`);
      console.log('─'.repeat(60));
      
      // Test current agent
      const currentStart = Date.now();
      const currentResponse = await answerQuestion(
        companyId, 
        scenario.question, 
        'concise', 
        [], 
        '', 
        'friendly'
      );
      const currentTime = Date.now() - currentStart;
      
      // Test competitive agent
      const competitiveStart = Date.now();
      const competitiveResponse = await answerQuestionCompetitive(
        companyId, 
        scenario.question, 
        'friendly'
      );
      const competitiveTime = Date.now() - competitiveStart;
      
      // Analyze results
      console.log(`\n🔵 CURRENT AGENT (${currentTime}ms):`);
      console.log(`Response: ${currentResponse.text}`);
      console.log(`Escalate: ${currentResponse.escalate ? 'YES' : 'NO'}`);
      
      console.log(`\n🟢 COMPETITIVE AGENT (${competitiveTime}ms):`);
      console.log(`Response: ${competitiveResponse.text}`);
      console.log(`Escalate: ${competitiveResponse.escalate ? 'YES' : 'NO'}`);
      
      // Score responses
      const currentScore = scoreResponse(currentResponse, scenario);
      const competitiveScore = scoreResponse(competitiveResponse, scenario);
      
      console.log(`\n📊 SCORES:`);
      console.log(`Current: ${currentScore.total}/10 (Speed: ${currentScore.speed}, Relevance: ${currentScore.relevance}, Directness: ${currentScore.directness})`);
      console.log(`Competitive: ${competitiveScore.total}/10 (Speed: ${competitiveScore.speed}, Relevance: ${competitiveScore.relevance}, Directness: ${competitiveScore.directness})`);
      
      // Update totals
      results.current.totalTime += currentTime;
      results.current.successes += currentScore.total >= 7 ? 1 : 0;
      results.current.escalations += currentResponse.escalate ? 1 : 0;
      
      results.competitive.totalTime += competitiveTime;
      results.competitive.successes += competitiveScore.total >= 7 ? 1 : 0;
      results.competitive.escalations += competitiveResponse.escalate ? 1 : 0;
      
      console.log('\n' + '='.repeat(80));
    }
    
    // Final summary
    console.log(`\n\n🏆 FINAL RESULTS SUMMARY`);
    console.log('='.repeat(60));
    
    console.log(`\n📈 PERFORMANCE METRICS:`);
    console.log(`Current Agent:`);
    console.log(`  - Average Response Time: ${Math.round(results.current.totalTime / testScenarios.length)}ms`);
    console.log(`  - Success Rate: ${Math.round((results.current.successes / testScenarios.length) * 100)}%`);
    console.log(`  - Escalation Rate: ${Math.round((results.current.escalations / testScenarios.length) * 100)}%`);
    
    console.log(`\nCompetitive Agent:`);
    console.log(`  - Average Response Time: ${Math.round(results.competitive.totalTime / testScenarios.length)}ms`);
    console.log(`  - Success Rate: ${Math.round((results.competitive.successes / testScenarios.length) * 100)}%`);
    console.log(`  - Escalation Rate: ${Math.round((results.competitive.escalations / testScenarios.length) * 100)}%`);
    
    // Recommendations
    console.log(`\n🎯 RECOMMENDATIONS:`);
    const speedImprovement = ((results.current.totalTime - results.competitive.totalTime) / results.current.totalTime) * 100;
    
    if (results.competitive.successes >= results.current.successes && speedImprovement > 0) {
      console.log(`✅ COMPETITIVE MODE RECOMMENDED`);
      console.log(`   - ${Math.round(speedImprovement)}% faster responses`);
      console.log(`   - Equal or better success rate`);
      console.log(`   - Simpler, more reliable architecture`);
    } else if (results.current.successes > results.competitive.successes) {
      console.log(`🤔 HYBRID APPROACH RECOMMENDED`);
      console.log(`   - Keep current agent's intelligence for complex scenarios`);
      console.log(`   - Use competitive mode for common scenarios`);
      console.log(`   - Implement smart routing between modes`);
    } else {
      console.log(`🔧 OPTIMIZATION NEEDED`);
      console.log(`   - Both agents need improvement`);
      console.log(`   - Focus on response quality and consistency`);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

function scoreResponse(response, scenario) {
  const text = response.text.toLowerCase();
  const scores = { speed: 0, relevance: 0, directness: 0 };
  
  // Speed score (based on response time if available)
  if (response.responseTime) {
    if (response.responseTime < 1000) scores.speed = 4;
    else if (response.responseTime < 2000) scores.speed = 3;
    else if (response.responseTime < 3000) scores.speed = 2;
    else scores.speed = 1;
  } else {
    scores.speed = 3; // Default
  }
  
  // Relevance score (contains expected keywords)
  const keywordMatches = scenario.expectedKeywords.filter(keyword => 
    text.includes(keyword.toLowerCase())
  ).length;
  scores.relevance = Math.min(4, keywordMatches + 1);
  
  // Directness score (concise and actionable)
  if (text.length < 100 && (text.includes('?') || text.includes('schedule') || text.includes('connect'))) {
    scores.directness = 2;
  } else if (text.length < 150) {
    scores.directness = 1;
  } else {
    scores.directness = 0;
  }
  
  scores.total = scores.speed + scores.relevance + scores.directness;
  return scores;
}

// Run the test if this file is executed directly
if (require.main === module) {
  runComparison().then(() => {
    console.log('\n✅ Comparison test completed');
    process.exit(0);
  }).catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}

module.exports = { runComparison };
