// Test script to verify ElevenLabs voice system integration
const mongoose = require('mongoose');
const Company = require('./models/Company');

async function testVoiceSystem() {
    try {
        await mongoose.connect('mongodb://localhost:27017/ai-agent-database', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        
        console.log('🔗 Connected to MongoDB');
        
        // Find the first company
        const company = await Company.findOne();
        if (!company) {
            console.log('❌ No companies found');
            return;
        }
        
        console.log(`🏢 Testing with company: ${company.companyName} (${company._id})`);
        
        // Test the voice settings structure
        console.log('🎙️ Current ElevenLabs config:', {
            hasElevenLabsSettings: !!company.aiSettings?.elevenLabs,
            voiceId: company.aiSettings?.elevenLabs?.voiceId || 'none',
            hasApiKey: !!company.aiSettings?.elevenLabs?.apiKey,
            useOwnApiKey: company.aiSettings?.elevenLabs?.useOwnApiKey || false,
            legacyVoiceId: company.elevenLabsVoiceId || 'none'
        });
        
        // Test updating voice settings
        if (!company.aiSettings) company.aiSettings = {};
        if (!company.aiSettings.elevenLabs) company.aiSettings.elevenLabs = {};
        
        // Set a test voice ID to verify save functionality
        company.aiSettings.elevenLabs.voiceId = 'rachel';
        company.aiSettings.elevenLabs.useOwnApiKey = false;
        
        await company.save();
        console.log('✅ Successfully updated voice settings');
        
        // Verify the update
        const updatedCompany = await Company.findById(company._id);
        console.log('🔍 Verification:', {
            voiceId: updatedCompany.aiSettings?.elevenLabs?.voiceId,
            useOwnApiKey: updatedCompany.aiSettings?.elevenLabs?.useOwnApiKey
        });
        
        console.log('🎉 Voice system test completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

testVoiceSystem();
