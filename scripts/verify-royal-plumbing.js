require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function verifyRoyalPlumbing() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');
        
        const company = await Company.findById('68eeaf924e989145e9d46c12').lean();
        
        if (!company) {
            console.log('❌ Royal Plumbing not found!');
            process.exit(1);
        }
        
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('🏆 ROYAL PLUMBING - VERIFICATION REPORT');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        console.log('✅ Company Name:', company.companyName);
        console.log('✅ Company ID:', company._id);
        console.log('✅ Status:', company.accountStatus?.status || 'NOT SET');
        console.log('');
        
        console.log('📞 TWILIO CONFIG:');
        const phone = company.twilioConfig?.phoneNumbers?.[0]?.phoneNumber;
        console.log('   Phone:', phone || '❌ NOT SET');
        console.log('');
        
        console.log('🎤 GREETING SYSTEM:');
        const greetingText = company.aiAgentLogic?.connectionMessages?.voice?.text;
        const greetingMode = company.aiAgentLogic?.connectionMessages?.voice?.mode;
        console.log('   Text:', greetingText || '❌ NOT SET');
        console.log('   Mode:', greetingMode || '❌ NOT SET');
        console.log('');
        
        console.log('🔊 VOICE SETTINGS:');
        const voiceId = company.aiAgentLogic?.voiceSettings?.voiceId;
        const apiSource = company.aiAgentLogic?.voiceSettings?.apiSource;
        console.log('   Voice ID:', voiceId || '❌ NOT SET');
        console.log('   API Source:', apiSource || '❌ NOT SET');
        console.log('');
        
        console.log('📝 PLACEHOLDERS:');
        if (company.aiAgentLogic?.placeholders?.length > 0) {
            company.aiAgentLogic.placeholders.forEach(p => {
                console.log(`   {${p.name}} → ${p.value}`);
            });
        } else {
            console.log('   ❌ NO PLACEHOLDERS');
        }
        console.log('');
        
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('🎯 TEST INSTRUCTIONS:');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`1. Call ${phone}`);
        console.log('2. Expected greeting: "' + greetingText + '"');
        console.log('3. Check Render logs for greeting confirmation');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Check for critical issues
        const issues = [];
        if (!phone) issues.push('❌ No phone number configured');
        if (!greetingText) issues.push('❌ No greeting text configured');
        if (!voiceId) issues.push('❌ No voice ID configured');
        
        if (issues.length > 0) {
            console.log('⚠️  CRITICAL ISSUES:');
            issues.forEach(issue => console.log(issue));
            console.log('');
        } else {
            console.log('✅ ALL SYSTEMS GO! Ready for testing!\n');
        }
        
        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

verifyRoyalPlumbing();

