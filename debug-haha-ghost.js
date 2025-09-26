/**
 * 🔍 HAHA GHOST HUNTER - Find the source of the haha greeting
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('./models/Company');

async function huntHahaGhost() {
    try {
        console.log('🔍 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
        
        console.log('🎯 Loading Atlas Air company data...');
        const company = await Company.findById('68813026dd95f599c74e49c7');
        
        if (!company) {
            console.log('❌ Company not found!');
            return;
        }
        
        console.log('=== ATLAS AIR COMPANY DATA ===');
        console.log('Company Name:', company.businessName || company.companyName);
        console.log('');
        
        console.log('=== SEARCHING FOR HAHA SOURCES ===');
        
        // Check all possible greeting sources
        const greetingSources = [
            { path: 'aiAgentLogic.responseCategories.core.greeting-response', value: company.aiAgentLogic?.responseCategories?.core?.['greeting-response'] },
            { path: 'aiAgentLogic.responseCategories.greeting.template', value: company.aiAgentLogic?.responseCategories?.greeting?.template },
            { path: 'agentSetup.agentGreeting', value: company.agentSetup?.agentGreeting },
            { path: 'agentGreeting (legacy)', value: company.agentGreeting },
            { path: 'agentPersonality', value: company.agentPersonality },
            { path: 'aiSettings.greeting', value: company.aiSettings?.greeting },
            { path: 'aiAgentLogic.agentPersonality.greeting', value: company.aiAgentLogic?.agentPersonality?.greeting }
        ];
        
        greetingSources.forEach(source => {
            if (source.value) {
                console.log(`\n🔍 FOUND: ${source.path}`);
                console.log(`   Value: "${source.value}"`);
                if (typeof source.value === 'string' && source.value.toLowerCase().includes('haha')) {
                    console.log('🚨 *** HAHA GHOST FOUND HERE! ***');
                }
            }
        });
        
        console.log('\n=== FULL AI AGENT LOGIC DUMP ===');
        console.log(JSON.stringify(company.aiAgentLogic, null, 2));
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

huntHahaGhost();
