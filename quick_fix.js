require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('./models/Company');

async function quickFix() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected!');
    
    // Update ALL companies to have LLM fallback enabled
    const result = await Company.updateMany(
      {},
      {
        $set: {
          'aiSettings.llmFallbackEnabled': true,
          'aiSettings.ttsProvider': 'elevenlabs'
        }
      }
    );
    
    console.log('✅ Updated', result.modifiedCount, 'companies');
    console.log('✅ All companies now have LLM fallback enabled');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

quickFix();
