/**
 * Quick Test - Verify AI Agent Logic is ready for production
 */

const mongoose = require('mongoose');
const Company = require('../models/Company');

async function quickTest() {
  try {
    console.log('🚀 Quick AI Agent Logic Test');
    
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/clientsvia';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Test 1: Schema validation
    const testCompany = new Company({
      companyName: 'Test Company',
      aiAgentLogic: {
        answerPriorityFlow: [
          {
            id: "company-knowledge",
            name: "Company Knowledge Base",
            description: "Test knowledge source",
            active: true,
            primary: true,
            priority: 1,
            icon: "building",
            category: "knowledge",
            confidenceThreshold: 0.8,
            intelligenceLevel: "high",
            performance: {
              successRate: 0.95,
              avgConfidence: 0.88,
              usageCount: 0
            }
          }
        ]
      },
      agentIntelligenceSettings: {
        primaryLLM: 'gemini-pro',
        fallbackLLM: 'openai-gpt4'
      }
    });

    // Validate without saving
    await testCompany.validate();
    console.log('✅ Schema validation passed');

    // Test 2: Check existing companies
    const companyCount = await Company.countDocuments();
    console.log(`📊 Found ${companyCount} companies in database`);

    // Test 3: Check if any company has AI Agent Logic configured
    const aiConfiguredCount = await Company.countDocuments({
      'aiAgentLogic.enabled': true
    });
    console.log(`🤖 ${aiConfiguredCount} companies have AI Agent Logic enabled`);

    await mongoose.disconnect();
    console.log('✅ Quick test completed successfully!');
    
    return {
      schemaValid: true,
      totalCompanies: companyCount,
      aiConfigured: aiConfiguredCount,
      ready: true
    };

  } catch (error) {
    console.error('❌ Quick test failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  quickTest();
}

module.exports = { quickTest };
