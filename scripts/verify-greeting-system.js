require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function verifyGreetingSystem() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');
        
        // Test with Royal Plumbing
        const company = await Company.findById('68eeaf924e989145e9d46c12').lean();
        
        if (!company) {
            console.log('❌ Royal Plumbing not found!');
            process.exit(1);
        }
        
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('🔍 GREETING SYSTEM VERIFICATION');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        console.log('Company:', company.companyName);
        console.log('Company ID:', company._id);
        console.log('');
        
        // Check for legacy field
        console.log('🔍 LEGACY CHECK:');
        if (company.aiAgentLogic?.initialGreeting !== undefined) {
            console.log('   ⚠️  LEGACY FIELD STILL EXISTS');
            console.log('   Value:', company.aiAgentLogic.initialGreeting);
            console.log('   Status: ❌ NEEDS MIGRATION');
        } else {
            console.log('   ✅ Legacy initialGreeting field REMOVED from document');
        }
        console.log('');
        
        // Check new system
        console.log('🎤 NEW GREETING SYSTEM (Messages & Greetings tab):');
        const connectionMessages = company.aiAgentLogic?.connectionMessages;
        
        if (!connectionMessages) {
            console.log('   ❌ connectionMessages: NOT SET');
        } else if (!connectionMessages.voice) {
            console.log('   ❌ connectionMessages.voice: NOT SET');
        } else {
            console.log('   ✅ connectionMessages.voice: EXISTS');
            console.log('   Text:', connectionMessages.voice.text || '❌ NOT SET');
            console.log('   Mode:', connectionMessages.voice.mode || '❌ NOT SET');
        }
        console.log('');
        
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('📋 NEXT STEPS:');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('1. Wait for Render deployment (check logs)');
        console.log('2. Go to company profile → AI Agent Settings tab');
        console.log('3. Click "Messages & Greetings" tab');
        console.log('4. Select "Generate from Text (Real-time TTS)"');
        console.log('5. Enter greeting: "Thank you for calling Royal Plumbing. How may I assist you today?"');
        console.log('6. Click "Save Connection Messages"');
        console.log('7. Call +12392322030 to test');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

verifyGreetingSystem();

