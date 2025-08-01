/**
 * Live Test - Test AI Agent Logic save functionality
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/Company');

async function testSave() {
  try {
    console.log('🧪 Live AI Agent Logic Save Test');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find or create a test company
    let testCompany = await Company.findOne({ companyName: 'AI Agent Test Company' });
    
    if (!testCompany) {
      console.log('Creating new test company...');
      testCompany = new Company({
        companyName: 'AI Agent Test Company',
        businessName: 'Test Business',
        email: 'test@example.com'
      });
      await testCompany.save();
      console.log('✅ Test company created:', testCompany._id);
    } else {
      console.log('✅ Using existing test company:', testCompany._id);
    }

    // Test AI Agent Logic save
    console.log('Testing AI Agent Logic configuration save...');
    
    const aiConfig = {
      enabled: true,
      answerPriorityFlow: [
        {
          id: "company_knowledge",
          name: "Company Knowledge Base",
          description: "Test knowledge",
          active: true,
          primary: true,
          priority: 1
        }
      ],
      agentPersonality: {
        voiceTone: 'friendly',
        speechPace: 'moderate'
      },
      behaviorControls: {
        allowBargeIn: true,
        acknowledgeEmotion: false,
        useEmails: true
      },
      responseCategories: {
        core: {
          greeting: "Hello! Thanks for calling {{companyName}}!",
          farewell: "Thank you for calling!"
        }
      },
      lastUpdated: new Date(),
      version: 1
    };

    testCompany.aiAgentLogic = aiConfig;
    await testCompany.save();
    
    console.log('✅ AI Agent Logic configuration saved successfully');
    
    // Verify the save by reading back
    const verifyCompany = await Company.findById(testCompany._id);
    
    if (verifyCompany.aiAgentLogic && verifyCompany.aiAgentLogic.agentPersonality) {
      console.log('✅ Verification successful - data persisted correctly');
      console.log('   Voice Tone:', verifyCompany.aiAgentLogic.agentPersonality.voiceTone);
      console.log('   Speech Pace:', verifyCompany.aiAgentLogic.agentPersonality.speechPace);
      console.log('   Allow Barge-In:', verifyCompany.aiAgentLogic.behaviorControls.allowBargeIn);
      console.log('   Priority Flow Items:', verifyCompany.aiAgentLogic.answerPriorityFlow.length);
    } else {
      console.log('❌ Verification failed - data not found');
    }

    console.log('\n🎯 Test Company ID for UI testing:', testCompany._id);
    console.log('🌐 Use this URL to test the UI:');
    console.log(`   http://localhost:10000/ai-agent-logic.html?id=${testCompany._id}`);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('📞 Database connection closed');
  }
}

testSave();
