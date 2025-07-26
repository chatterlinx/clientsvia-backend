// Comprehensive ElevenLabs Integration Test
const mongoose = require('mongoose');
const Company = require('./models/Company');
const { getAvailableVoices } = require('./services/elevenLabsService');

async function testElevenLabsIntegration() {
    console.log('🧪 Starting ElevenLabs Integration Test...\n');
    
    try {
        // Connect to database
        await mongoose.connect('mongodb://localhost:27017/clientsvia', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ Connected to MongoDB');
        
        // 1. Test company creation/retrieval
        let testCompany = await Company.findOne({ companyName: 'Test Company' });
        
        if (!testCompany) {
            testCompany = new Company({
                companyName: 'Test Company',
                email: 'test@example.com',
                phone: '555-0123',
                industry: 'Technology',
                aiSettings: {
                    elevenLabs: {
                        useOwnApiKey: false,
                        voiceId: null,
                        stability: 0.5,
                        similarityBoost: 0.7
                    }
                }
            });
            await testCompany.save();
            console.log('✅ Created test company:', testCompany._id);
        } else {
            console.log('✅ Found existing test company:', testCompany._id);
        }
        
        // 2. Test ElevenLabs service with global API key
        console.log('\n📡 Testing ElevenLabs API connection...');
        try {
            const voices = await getAvailableVoices();
            console.log(`✅ Successfully fetched ${voices.length} voices`);
            
            if (voices.length > 0) {
                console.log('🎙️ Sample voices:', voices.slice(0, 3).map(v => ({
                    name: v.name,
                    voice_id: v.voice_id,
                    category: v.category
                })));
                
                // Update company with first voice
                const firstVoice = voices[0];
                testCompany.aiSettings.elevenLabs.voiceId = firstVoice.voice_id;
                await testCompany.save();
                console.log(`✅ Updated company voice to: ${firstVoice.name} (${firstVoice.voice_id})`);
            }
        } catch (error) {
            console.log('❌ ElevenLabs API test failed:', error.message);
            console.log('   This is expected if no API key is configured');
        }
        
        // 3. Test voice data structure
        console.log('\n🔍 Testing voice data structure...');
        const updatedCompany = await Company.findById(testCompany._id);
        
        console.log('Current ElevenLabs settings:', {
            hasElevenLabsSettings: !!updatedCompany.aiSettings?.elevenLabs,
            voiceId: updatedCompany.aiSettings?.elevenLabs?.voiceId || 'none',
            useOwnApiKey: updatedCompany.aiSettings?.elevenLabs?.useOwnApiKey || false,
            stability: updatedCompany.aiSettings?.elevenLabs?.stability || 0.5,
            similarityBoost: updatedCompany.aiSettings?.elevenLabs?.similarityBoost || 0.7
        });
        
        // 4. Test voice ID validation
        console.log('\n✅ Testing voice ID validation...');
        
        // Test with valid voice ID
        updatedCompany.aiSettings.elevenLabs.voiceId = 'rachel';
        await updatedCompany.save();
        
        const validTest = await Company.findById(testCompany._id);
        if (validTest.aiSettings.elevenLabs.voiceId === 'rachel') {
            console.log('✅ Valid voice ID save test: PASSED');
        } else {
            console.log('❌ Valid voice ID save test: FAILED');
        }
        
        // Test with undefined/null (should not save as "undefined")
        updatedCompany.aiSettings.elevenLabs.voiceId = null;
        await updatedCompany.save();
        
        const nullTest = await Company.findById(testCompany._id);
        if (nullTest.aiSettings.elevenLabs.voiceId === null) {
            console.log('✅ Null voice ID save test: PASSED');
        } else {
            console.log('❌ Null voice ID save test: FAILED');
        }
        
        console.log('\n🎉 ElevenLabs Integration Test Complete!');
        console.log(`📊 Test Company ID for frontend testing: ${testCompany._id}`);
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Run the test
testElevenLabsIntegration();
