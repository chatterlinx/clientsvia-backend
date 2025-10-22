require('dotenv').config();
const { redisClient } = require('../clients');

async function checkRedis() {
    const key = 'company:68e3f77a9d623b8058c700c4';
    console.log(`🔍 Checking Redis for: ${key}`);
    
    const data = await redisClient.get(key);
    
    if (data) {
        console.log('✅ FOUND IN REDIS!');
        const company = JSON.parse(data);
        console.log('Company name:', company.companyName);
        console.log('Has callFiltering:', Boolean(company.callFiltering));
        if (company.callFiltering) {
            console.log('callFiltering.settings:', JSON.stringify(company.callFiltering.settings, null, 2));
        }
    } else {
        console.log('❌ NOT FOUND IN REDIS');
    }
    
    process.exit(0);
}

checkRedis();

