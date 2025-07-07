const mongoose = require('mongoose');
const Company = require('./models/Company');
require('dotenv').config();

async function fixCompanyIssues() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('MONGODB_URI not found in environment variables');
      process.exit(1);
    }
    
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    // Fix the specific company from the logs
    const companyId = '686a680241806a4991f7367f';
    
    const result = await Company.findByIdAndUpdate(
      companyId,
      {
        $set: {
          'aiSettings.llmFallbackEnabled': true,
          'aiSettings.bargeIn': false,
          'aiSettings.ttsProvider': 'elevenlabs',
          'aiSettings.elevenLabs.voiceId': 'UgBBYS2sOqTuMpoF3BR0',
          'aiSettings.elevenLabs.apiKey': process.env.ELEVENLABS_API_KEY,
          'aiSettings.responseDelayMs': 200,
          'aiSettings.silenceTimeout': 5,
          'aiSettings.humanLikeFillers': false
        }
      },
      { new: true }
    );

    if (result) {
      console.log(`✅ Fixed company ${companyId}`);
      console.log('Updated settings:', {
        llmFallbackEnabled: result.aiSettings.llmFallbackEnabled,
        bargeIn: result.aiSettings.bargeIn,
        ttsProvider: result.aiSettings.ttsProvider,
        elevenLabsVoiceId: result.aiSettings.elevenLabs?.voiceId
      });
    } else {
      console.log(`❌ Company ${companyId} not found`);
    }

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixCompanyIssues();
