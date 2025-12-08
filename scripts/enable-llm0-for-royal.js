/**
 * QUICK FIX: Enable LLM-0 for Royal Air company
 * 
 * The database has llm0Enabled explicitly set to FALSE.
 * This script sets it to TRUE so the intelligent system runs.
 */

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://marcclinton90:NasaShuttle2500@clientsvia.hhivq.mongodb.net/clientsvia?retryWrites=true&w=majority&appName=ClientsVia';
const COMPANY_ID = '68e3f77a9d623b8058c700c4'; // Royal Air

async function enableLLM0() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected');

        // Update company to enable LLM-0
        const result = await mongoose.connection.db.collection('v2companies').updateOne(
            { _id: new mongoose.Types.ObjectId(COMPANY_ID) },
            { 
                $set: { 
                    'agentSettings.llm0Enabled': true 
                }
            }
        );

        console.log('📊 Update result:', result);

        if (result.modifiedCount > 0) {
            console.log('✅ LLM-0 ENABLED for Royal Air!');
        } else {
            console.log('⚠️ No changes made - checking if already enabled...');
            
            const company = await mongoose.connection.db.collection('v2companies').findOne(
                { _id: new mongoose.Types.ObjectId(COMPANY_ID) }
            );
            console.log('Current llm0Enabled:', company?.agentSettings?.llm0Enabled);
        }

        // Also clear Redis cache to force reload
        const Redis = require('ioredis');
        const redisUrl = process.env.REDIS_URL;
        if (redisUrl) {
            const redis = new Redis(redisUrl);
            await redis.del(`company:${COMPANY_ID}`);
            await redis.del(`company:${COMPANY_ID}:agentSettings`);
            await redis.del(`company:${COMPANY_ID}:config`);
            console.log('🗑️ Redis cache cleared');
            await redis.quit();
        }

        console.log('\n🎯 NEXT: Make a test call - LLM-0 should now be active!');
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

enableLLM0();

