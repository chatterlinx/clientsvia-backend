#!/usr/bin/env node
require('dotenv').config();
const { redisClient } = require('../clients');

async function clearDataCenterCache() {
    try {
        console.log('🔌 Connecting to Redis...');
        
        // Wait for Redis to be ready
        if (!redisClient.isReady) {
            await new Promise((resolve) => {
                redisClient.on('ready', resolve);
            });
        }
        
        console.log('✅ Connected to Redis\n');
        
        // Clear all datacenter-related keys
        const patterns = [
            'datacenter:*',
            'company:*',
            'ai-agent:*'
        ];
        
        let totalCleared = 0;
        
        for (const pattern of patterns) {
            console.log(`🔍 Scanning for pattern: ${pattern}`);
            let cursor = '0';
            let keysForPattern = [];
            
            try {
                do {
                    const reply = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
                    cursor = reply[0];
                    const keys = reply[1] || [];
                    keysForPattern = keysForPattern.concat(keys);
                } while (cursor !== '0');
                
                if (keysForPattern.length > 0) {
                    console.log(`   Found ${keysForPattern.length} keys`);
                    await Promise.all(keysForPattern.map(key => redisClient.del(key)));
                    totalCleared += keysForPattern.length;
                    console.log(`   ✅ Deleted ${keysForPattern.length} keys\n`);
                } else {
                    console.log(`   No keys found\n`);
                }
            } catch (err) {
                console.warn(`   ⚠️  Error scanning ${pattern}:`, err.message);
            }
        }
        
        console.log(`\n🎉 Total keys cleared: ${totalCleared}`);
        console.log('✅ Data Center cache cleared successfully!');
        console.log('\n💡 Now hard refresh your browser (Cmd+Shift+R on Mac, Ctrl+Shift+F5 on Windows)');
        
        await redisClient.quit();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

clearDataCenterCache();

