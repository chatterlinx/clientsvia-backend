const mongoose = require('mongoose');
const { Company } = require('./models/Company');

async function fixCompanyLLM() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('Connected to MongoDB');
    
    // Fix the specific company from the logs
    const companyId = '686a680241806a4991f7367f';
    
    const company = await Company.findById(companyId);
    if (!company) {
      console.log(`Company ${companyId} not found`);
      return;
    }
    
    console.log(`Company: ${company.companyName}`);
    console.log(`Current LLM Fallback: ${company.aiSettings?.llmFallbackEnabled}`);
    console.log(`Current TTS Provider: ${company.aiSettings?.ttsProvider}`);
    
    // Update the company settings
    const updateResult = await Company.findByIdAndUpdate(
      companyId,
      {
        $set: {
          'aiSettings.llmFallbackEnabled': true,
          'aiSettings.ttsProvider': 'elevenlabs'
        }
      },
      { new: true }
    );
    
    if (updateResult) {
      console.log('✅ Company updated successfully');
      console.log(`New LLM Fallback: ${updateResult.aiSettings?.llmFallbackEnabled}`);
      console.log(`New TTS Provider: ${updateResult.aiSettings?.ttsProvider}`);
    } else {
      console.log('❌ Failed to update company');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the fix
fixCompanyLLM();
