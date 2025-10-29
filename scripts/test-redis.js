#!/usr/bin/env node

// ============================================================================
// 🔴 REDIS CONNECTION TEST SCRIPT
// ============================================================================
// PURPOSE: Diagnose Redis connection issues
// USAGE: node scripts/test-redis.js
// ============================================================================

require('dotenv').config();
const redis = require('redis');

async function testRedisConnection() {
    console.log('🔍 [REDIS TEST] Starting diagnostic test...\n');
    
    // ────────────────────────────────────────────────────────────────────────
    // STEP 1: Check environment variable
    // ────────────────────────────────────────────────────────────────────────
    console.log('📋 [STEP 1] Checking REDIS_URL environment variable...');
    
    if (!process.env.REDIS_URL) {
        console.error('❌ [ERROR] REDIS_URL is not set in environment variables!');
        console.log('\n💡 [FIX] Set REDIS_URL in Render dashboard:');
        console.log('   Format: redis://default:password@host:port');
        process.exit(1);
    }
    
    // Mask password for security
    const maskedUrl = process.env.REDIS_URL.replace(/:[^:@]+@/, ':****@');
    console.log(`✅ [REDIS_URL] ${maskedUrl}\n`);
    
    // ────────────────────────────────────────────────────────────────────────
    // STEP 2: Create Redis client
    // ────────────────────────────────────────────────────────────────────────
    console.log('📋 [STEP 2] Creating Redis client...');
    
    let client;
    try {
        client = redis.createClient({
            url: process.env.REDIS_URL,
            socket: {
                reconnectStrategy: (retries) => {
                    if (retries > 3) {
                        console.error('❌ [ERROR] Max reconnection attempts reached');
                        return new Error('Max retries reached');
                    }
                    return Math.min(retries * 100, 3000);
                }
            }
        });
        console.log('✅ [CLIENT] Redis client created\n');
    } catch (error) {
        console.error('❌ [ERROR] Failed to create Redis client:', error.message);
        process.exit(1);
    }
    
    // ────────────────────────────────────────────────────────────────────────
    // STEP 3: Set up event listeners
    // ────────────────────────────────────────────────────────────────────────
    console.log('📋 [STEP 3] Setting up event listeners...');
    
    client.on('error', (err) => {
        console.error('❌ [ERROR EVENT]', err.message);
    });
    
    client.on('connect', () => {
        console.log('🔌 [CONNECT] Redis connection established');
    });
    
    client.on('ready', () => {
        console.log('✅ [READY] Redis client is ready');
    });
    
    client.on('reconnecting', () => {
        console.log('🔄 [RECONNECTING] Attempting to reconnect to Redis...');
    });
    
    client.on('end', () => {
        console.log('🔌 [END] Redis connection closed');
    });
    
    console.log('✅ [LISTENERS] Event listeners configured\n');
    
    // ────────────────────────────────────────────────────────────────────────
    // STEP 4: Connect to Redis
    // ────────────────────────────────────────────────────────────────────────
    console.log('📋 [STEP 4] Connecting to Redis...');
    
    try {
        await client.connect();
        console.log('✅ [CONNECTED] Successfully connected to Redis\n');
    } catch (error) {
        console.error('❌ [ERROR] Failed to connect to Redis:', error.message);
        console.log('\n💡 [TROUBLESHOOTING]');
        console.log('   1. Check if Redis instance is running in Redis Cloud dashboard');
        console.log('   2. Verify REDIS_URL format: redis://default:password@host:port');
        console.log('   3. Check if IP is whitelisted (if required)');
        console.log('   4. Verify Redis port is open (default: 6379 or custom)');
        process.exit(1);
    }
    
    // ────────────────────────────────────────────────────────────────────────
    // STEP 5: Test basic operations
    // ────────────────────────────────────────────────────────────────────────
    console.log('📋 [STEP 5] Testing basic Redis operations...\n');
    
    try {
        // Test PING
        console.log('   Testing PING...');
        const pongStart = Date.now();
        const pong = await client.ping();
        const pongTime = Date.now() - pongStart;
        console.log(`   ✅ PING response: ${pong} (${pongTime}ms)`);
        
        // Test SET
        console.log('   Testing SET...');
        const setStart = Date.now();
        await client.set('test:health-check', 'OK', { EX: 60 });
        const setTime = Date.now() - setStart;
        console.log(`   ✅ SET successful (${setTime}ms)`);
        
        // Test GET
        console.log('   Testing GET...');
        const getStart = Date.now();
        const value = await client.get('test:health-check');
        const getTime = Date.now() - getStart;
        console.log(`   ✅ GET successful: ${value} (${getTime}ms)`);
        
        // Test INFO
        console.log('   Testing INFO...');
        const infoStart = Date.now();
        const info = await client.info('server');
        const infoTime = Date.now() - infoStart;
        const versionMatch = info.match(/redis_version:([^\r\n]+)/);
        const version = versionMatch ? versionMatch[1] : 'unknown';
        console.log(`   ✅ Redis version: ${version} (${infoTime}ms)`);
        
        // Get memory stats
        const memory = await client.info('memory');
        const memoryUsedMatch = memory.match(/used_memory_human:([^\r\n]+)/);
        const memoryMaxMatch = memory.match(/maxmemory_human:([^\r\n]+)/);
        
        if (memoryUsedMatch) {
            console.log(`   📊 Memory used: ${memoryUsedMatch[1]}`);
        }
        if (memoryMaxMatch) {
            console.log(`   📊 Memory max: ${memoryMaxMatch[1]}`);
        }
        
        console.log('\n✅ [SUCCESS] All Redis operations completed successfully!');
        
    } catch (error) {
        console.error('\n❌ [ERROR] Redis operation failed:', error.message);
        console.log('\n💡 [TROUBLESHOOTING]');
        console.log('   Connection is established but operations are failing.');
        console.log('   This could indicate:');
        console.log('   1. Insufficient permissions');
        console.log('   2. Redis server is in protected mode');
        console.log('   3. Authentication issues');
        await client.quit();
        process.exit(1);
    }
    
    // ────────────────────────────────────────────────────────────────────────
    // STEP 6: Clean up
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n📋 [STEP 6] Closing connection...');
    await client.quit();
    console.log('✅ [CLOSED] Connection closed gracefully');
    
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('🎉 [COMPLETE] Redis connection test passed!');
    console.log('════════════════════════════════════════════════════════════\n');
    
    process.exit(0);
}

// Run the test
testRedisConnection().catch((error) => {
    console.error('\n💥 [FATAL ERROR]', error);
    process.exit(1);
});

