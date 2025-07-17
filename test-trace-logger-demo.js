// test-trace-logger-demo.js
// Demo script showing the AI Response Trace Logger functionality

const { checkCompanyCategoryQAs, parseCategoryQAs } = require('./utils/checkCustomKB');
const ResponseTraceLogger = require('./utils/responseTraceLogger');

// Mock company data based on Penguin Air
const mockCompanyData = {
  _id: "686a680241806a4991f7367f",
  companyName: "Penguin Air",
  agentSetup: {
    categories: ["HVAC Residential"],
    categoryQAs: `Q: thermostat problems
thermostat blank, thermostat not working, thermostat display, thermostat screen, thermostat dead, thermostat frozen
A: I can help you with thermostat issues. Is the display completely blank, or are you seeing any numbers or lights? This could be a simple power issue that I can help you troubleshoot, or we might need to schedule a technician visit.

Q: ac repair  
ac repair, air conditioner repair, ac not cooling, ac stopped working, ac unit broken, air conditioner broken
A: I understand you're having air conditioning issues. Let me help you troubleshoot this. Is the unit running but not cooling, or is it not turning on at all? I can walk you through some quick checks or schedule a technician.

Q: water leak from ac
water leaking from ac, ac unit leaking water, water dripping from unit, ac drain clogged, condensation leak
A: Water leaks from AC units are common and usually fixable. The most likely cause is a clogged condensate drain. I can guide you through checking this, or if you prefer, we can send a technician today.`
  }
};

async function demonstrateTraceLogging() {
  console.log('🎯 AI RESPONSE TRACE LOGGER DEMONSTRATION');
  console.log('='.repeat(60));
  console.log('This shows how the AI selects its response step-by-step\n');

  // Test different scenarios
  const testCases = [
    {
      query: "my thermostat is blank",
      description: "Perfect match scenario"
    },
    {
      query: "air conditioner stopped working", 
      description: "Keyword match scenario"
    },
    {
      query: "what are your business hours",
      description: "No match scenario"
    }
  ];

  for (const testCase of testCases) {
    console.log(`📝 Testing: "${testCase.query}"`);
    console.log(`💡 Scenario: ${testCase.description}`);
    console.log('-'.repeat(50));

    // Create a new trace logger for this test
    const traceLogger = new ResponseTraceLogger();
    
    // Extract keywords (simulating what checkCustomKB does)
    const keywords = testCase.query
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !['the', 'is', 'my', 'are', 'your'].includes(word));
    
    // Start the trace
    traceLogger.startTrace(testCase.query, keywords);
    
    // Test the company Q&As
    const result = await checkCompanyCategoryQAs(testCase.query, mockCompanyData);
    
    // Get the trace log
    const trace = traceLogger.getTraceLog();
    
    // Display results
    if (result) {
      console.log(`✅ RESPONSE SELECTED: "${result.substring(0, 80)}..."`);
    } else {
      console.log(`❌ NO MATCH: Would fall back to AI or other handlers`);
    }
    
    console.log(`\n📊 TRACE SUMMARY:`);
    console.log(`   • Keywords extracted: [${keywords.join(', ')}]`);
    console.log(`   • Sources checked: ${trace.steps.length}`);
    console.log(`   • Total time: ${trace.totalTime}ms`);
    console.log(`   • Selected source: ${trace.selectedSource}`);
    
    console.log(`\n🔍 STEP-BY-STEP BREAKDOWN:`);
    trace.steps.forEach((step, index) => {
      const icon = step.matchResult.matched ? '✅' : '❌';
      const confidence = Math.round(step.matchResult.confidence * 100);
      console.log(`   ${icon} Step ${index + 1}: ${step.source}`);
      console.log(`      └─ Confidence: ${confidence}% | Keywords: [${step.matchResult.matchedKeywords.join(', ')}]`);
    });
    
    console.log('\n' + '='.repeat(60) + '\n');
  }

  console.log('🎉 TRACE LOGGER FEATURES DEMONSTRATED:');
  console.log('✅ Transparent source checking');
  console.log('✅ Keyword extraction and matching');
  console.log('✅ Confidence scoring');  
  console.log('✅ Step-by-step decision process');
  console.log('✅ Performance timing');
  console.log('✅ Detailed match reasoning');
  console.log('\n🚀 Ready for Admin UI integration!');
}

// Run the demonstration
demonstrateTraceLogging().catch(console.error);
