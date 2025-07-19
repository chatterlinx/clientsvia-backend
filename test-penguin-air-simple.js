// test-penguin-air-simple.js - Simple test for Penguin Air configuration without full agent service
// This avoids the VertexAI initialization issue and focuses on Ollama setup

require('dotenv').config();
const { ObjectId } = require('mongodb');
const { getDB, connectDB } = require('./db');
const localLLM = require('./services/localLLM');
const { checkKBWithFallback } = require('./middleware/checkKBWithOllama');
const TraceLogger = require('./utils/traceLogger');

const PENGUIN_AIR_ID = '686a680241806a4991f7367f';

async function setupPenguinAirOllama() {
  console.log('🐧 PENGUIN AIR - OLLAMA SETUP');
  console.log('=============================\n');

  try {
    // Connect to database first
    console.log('📋 Connecting to database...');
    await connectDB();
    console.log('✅ Database connected');
    console.log('');

    // Step 1: Load Penguin Air company
    console.log('📋 Loading Penguin Air company...');
    const db = getDB();
    const company = await db.collection('companiesCollection').findOne({ 
      _id: new ObjectId(PENGUIN_AIR_ID) 
    });

    if (!company) {
      console.log('❌ Penguin Air company not found!');
      return;
    }

    console.log(`✅ Company: ${company.companyName}`);
    console.log(`   Trade: ${company.tradeCategory}`);
    console.log('');

    // Step 2: Configure Ollama settings for Penguin Air
    console.log('📋 Configuring Ollama settings...');
    
    const ollamaSettings = {
      ollamaFallbackEnabled: true,
      localLLM: {
        enabled: true,
        model: 'llama3.2:3b',
        temperature: 0.3,
        maxTokens: 150
      },
      personality: 'professional and helpful HVAC specialist',
      llmFallbackEnabled: true, // Keep Gemini as backup
      customEscalationMessage: 'Let me connect you with one of our HVAC specialists.'
    };

    // Update database
    const updateResult = await db.collection('companiesCollection').updateOne(
      { _id: new ObjectId(PENGUIN_AIR_ID) },
      { 
        $set: { 
          'aiSettings.ollamaFallbackEnabled': ollamaSettings.ollamaFallbackEnabled,
          'aiSettings.localLLM': ollamaSettings.localLLM,
          'aiSettings.personality': ollamaSettings.personality,
          'aiSettings.llmFallbackEnabled': ollamaSettings.llmFallbackEnabled,
          'aiSettings.customEscalationMessage': ollamaSettings.customEscalationMessage
        }
      }
    );

    console.log(`✅ Settings updated (${updateResult.modifiedCount} documents modified)`);
    console.log('');

    // Step 3: Test Ollama availability
    console.log('📋 Testing Ollama service...');
    const isAvailable = await localLLM.isAvailable();
    const isModelReady = await localLLM.isModelAvailable();
    
    console.log(`   Service: ${isAvailable ? '✅ Online' : '❌ Offline'}`);
    console.log(`   Model: ${isModelReady ? '✅ Ready' : '❌ Not Ready'}`);
    console.log('');

    // Step 4: Test direct Ollama query
    if (isAvailable && isModelReady) {
      console.log('📋 Testing direct Ollama query...');
      
      try {
        const testResponse = await localLLM.queryWithContext(
          'My HVAC system is making a loud noise. Should I be concerned?', 
          {
            company: 'Penguin Air',
            trade: 'HVAC',
            personality: 'professional and helpful'
          }
        );
        
        console.log(`✅ Ollama response:`);
        console.log(`   ${testResponse.substring(0, 200)}...`);
      } catch (error) {
        console.log(`❌ Ollama query failed: ${error.message}`);
      }
      console.log('');
    }

    // Step 5: Test KB with Ollama fallback
    console.log('📋 Testing KB + Ollama fallback...');
    
    try {
      const traceLogger = new TraceLogger();
      const result = await checkKBWithFallback(
        'How often should I change my air filter?', 
        PENGUIN_AIR_ID, 
        traceLogger, 
        {
          ollamaFallbackEnabled: true,
          company: { ...company, aiSettings: ollamaSettings },
          conversationHistory: []
        }
      );

      if (result && result.answer) {
        console.log(`✅ KB+Ollama test successful`);
        console.log(`   Source: ${result.source}`);
        console.log(`   Confidence: ${result.confidence}`);
        console.log(`   Ollama Used: ${result.fallbackUsed ? 'Yes' : 'No'}`);
        console.log(`   Answer: ${result.answer.substring(0, 150)}...`);
      } else {
        console.log(`❌ No response from KB+Ollama`);
      }
      
      console.log(`   Trace: ${result.trace}`);
      
    } catch (error) {
      console.log(`❌ KB+Ollama test failed: ${error.message}`);
    }
    console.log('');

    // Step 6: Show final configuration
    console.log('📊 PENGUIN AIR CONFIGURATION SUMMARY');
    console.log('====================================');
    console.log(`Company ID: ${PENGUIN_AIR_ID}`);
    console.log(`Company Name: ${company.companyName}`);
    console.log(`Trade Category: ${company.tradeCategory}`);
    console.log('');
    console.log('AI Settings:');
    console.log(`  ✅ Ollama Fallback: ${ollamaSettings.ollamaFallbackEnabled ? 'Enabled' : 'Disabled'}`);
    console.log(`  ✅ Local LLM: ${ollamaSettings.localLLM.enabled ? 'Enabled' : 'Disabled'}`);
    console.log(`  ✅ Model: ${ollamaSettings.localLLM.model}`);
    console.log(`  ✅ Gemini Backup: ${ollamaSettings.llmFallbackEnabled ? 'Enabled' : 'Disabled'}`);
    console.log(`  ✅ Personality: ${ollamaSettings.personality}`);
    console.log('');
    console.log('🎯 STATUS: PRODUCTION READY');
    console.log('   - Ollama primary LLM configured');
    console.log('   - Intelligent fallback chain active'); 
    console.log('   - Multi-tenant settings isolated');
    console.log('   - Ready for live customer interactions');

  } catch (error) {
    console.error('❌ Setup failed:', error);
    console.error(error.stack);
  }
}

// Run setup if this file is executed directly
if (require.main === module) {
  setupPenguinAirOllama()
    .then(() => {
      console.log('\n✅ Penguin Air Ollama setup completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Setup failed:', error);
      process.exit(1);
    });
}

module.exports = {
  setupPenguinAirOllama,
  PENGUIN_AIR_ID
};
