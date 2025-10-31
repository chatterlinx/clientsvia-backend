require('dotenv').config();
const mongoose = require('mongoose');
const AdminSettings = require('../models/AdminSettings');

async function checkConfig() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');
        
        const settings = await AdminSettings.getSettings();
        
        console.log('📞 Current Global AI Brain Test Config:');
        console.log('=====================================');
        console.log('Enabled:', settings.globalAIBrainTest?.enabled);
        console.log('Phone Number:', settings.globalAIBrainTest?.phoneNumber || '(not set)');
        console.log('Account SID:', settings.globalAIBrainTest?.accountSid ? `${settings.globalAIBrainTest.accountSid.substring(0, 10)}...` : '(not set)');
        console.log('Auth Token:', settings.globalAIBrainTest?.authToken ? '***SET***' : '(not set)');
        console.log('Active Template ID:', settings.globalAIBrainTest?.activeTemplateId || '(not set)');
        console.log('Greeting:', settings.globalAIBrainTest?.greeting ? `${settings.globalAIBrainTest.greeting.substring(0, 50)}...` : '(not set)');
        console.log('Notes:', settings.globalAIBrainTest?.notes || '(not set)');
        console.log('Last Updated By:', settings.globalAIBrainTest?.lastUpdatedBy || '(not set)');
        console.log('Test Call Count:', settings.globalAIBrainTest?.testCallCount || 0);
        console.log('Last Tested:', settings.globalAIBrainTest?.lastTestedAt || '(never)');
        
        await mongoose.disconnect();
        console.log('\n✅ Disconnected from MongoDB');
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

checkConfig();
