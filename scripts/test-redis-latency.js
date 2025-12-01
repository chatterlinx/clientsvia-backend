#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REDIS LATENCY DIAGNOSTIC TOOL
 * ═══════════════════════════════════════════════════════════════════════════
 * Run this to diagnose Redis connection latency issues.
 * 
 * Usage: node scripts/test-redis-latency.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

const redis = require('redis');

async function testRedisLatency() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🔍 REDIS LATENCY DIAGNOSTIC TOOL');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Check environment
    const redisUrl = process.env.REDIS_URL;
    
    if (!redisUrl) {
        console.log('❌ REDIS_URL not set in environment!');
        console.log('   Run with: REDIS_URL="your-url" node scripts/test-redis-latency.js');
        process.exit(1);
    }

    // Sanitize URL for display
    const sanitizedUrl = redisUrl.replace(/:([^@]+)@/, ':***@');
    console.log('📍 Connection Details:');
    console.log(`   URL: ${sanitizedUrl}`);
    console.log(`   Protocol: ${redisUrl.startsWith('rediss://') ? 'TLS (rediss://)' : 'Plain (redis://)'}`);
    
    // Parse host for region detection
    const hostMatch = redisUrl.match(/@([^:]+):/);
    if (hostMatch) {
        const host = hostMatch[1];
        console.log(`   Host: ${host}`);
        
        // Detect region from hostname
        if (host.includes('us-east-1')) console.log('   Region: US East 1 (N. Virginia)');
        else if (host.includes('us-east-2')) console.log('   Region: US East 2 (Ohio)');
        else if (host.includes('us-west-1')) console.log('   Region: US West 1 (N. California)');
        else if (host.includes('us-west-2')) console.log('   Region: US West 2 (Oregon)');
        else if (host.includes('eu-west-1')) console.log('   Region: EU West 1 (Ireland)');
        else console.log('   Region: Unknown (check Redis Cloud dashboard)');
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('🚀 Starting Connection Test...');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const isTLS = redisUrl.startsWith('rediss://');
    
    // Create client with same config as production
    const client = redis.createClient({
        url: redisUrl,
        socket: {
            keepAlive: 5000,
            noDelay: true,
            connectTimeout: 10000,
            ...(isTLS && {
                tls: true,
                rejectUnauthorized: false
            }),
            reconnectStrategy: false // Don't reconnect for this test
        }
    });

    client.on('error', (err) => {
        console.log('❌ Redis Client Error:', err.message);
    });

    try {
        // Test 1: Connection time
        console.log('📊 Test 1: Initial Connection (includes TLS handshake if applicable)');
        const connectStart = Date.now();
        await client.connect();
        const connectTime = Date.now() - connectStart;
        console.log(`   ✅ Connected in ${connectTime}ms`);
        
        if (connectTime > 500) {
            console.log('   ⚠️  WARNING: Connection time > 500ms - possible network issue');
        }

        // Test 2: Multiple pings to measure steady-state latency
        console.log('\n📊 Test 2: Ping Latency (10 pings)');
        const pingTimes = [];
        
        for (let i = 1; i <= 10; i++) {
            const pingStart = Date.now();
            await client.ping();
            const pingTime = Date.now() - pingStart;
            pingTimes.push(pingTime);
            console.log(`   Ping ${i}: ${pingTime}ms`);
        }

        const avgPing = Math.round(pingTimes.reduce((a, b) => a + b, 0) / pingTimes.length);
        const minPing = Math.min(...pingTimes);
        const maxPing = Math.max(...pingTimes);

        console.log(`\n   📈 Results:`);
        console.log(`      Min: ${minPing}ms`);
        console.log(`      Max: ${maxPing}ms`);
        console.log(`      Avg: ${avgPing}ms`);

        // Test 3: SET/GET roundtrip
        console.log('\n📊 Test 3: SET/GET Roundtrip');
        const testKey = `latency-test-${Date.now()}`;
        const testValue = 'test-value-12345';

        const setStart = Date.now();
        await client.set(testKey, testValue);
        const setTime = Date.now() - setStart;
        console.log(`   SET: ${setTime}ms`);

        const getStart = Date.now();
        const getValue = await client.get(testKey);
        const getTime = Date.now() - getStart;
        console.log(`   GET: ${getTime}ms`);

        const delStart = Date.now();
        await client.del(testKey);
        const delTime = Date.now() - delStart;
        console.log(`   DEL: ${delTime}ms`);

        console.log(`   Total roundtrip: ${setTime + getTime + delTime}ms`);
        console.log(`   Data integrity: ${getValue === testValue ? '✅ PASS' : '❌ FAIL'}`);

        // Test 4: Server info
        console.log('\n📊 Test 4: Server Info');
        const info = await client.info('server');
        const memInfo = await client.info('memory');
        
        const version = info.match(/redis_version:([^\r\n]+)/)?.[1] || 'Unknown';
        const uptime = info.match(/uptime_in_seconds:([^\r\n]+)/)?.[1] || 'Unknown';
        const memory = memInfo.match(/used_memory_human:([^\r\n]+)/)?.[1] || 'Unknown';

        console.log(`   Redis Version: ${version}`);
        console.log(`   Uptime: ${Math.round(parseInt(uptime) / 3600)} hours`);
        console.log(`   Memory Used: ${memory}`);

        // Final diagnosis
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('🎯 DIAGNOSIS');
        console.log('═══════════════════════════════════════════════════════════════\n');

        if (minPing < 30) {
            console.log('✅ EXCELLENT: Latency is optimal (<30ms)');
            console.log('   Your Redis is properly configured and in the same region.');
        } else if (minPing < 50) {
            console.log('✅ GOOD: Latency is acceptable (<50ms)');
            console.log('   Minor optimization possible but not critical.');
        } else if (minPing < 100) {
            console.log('⚠️  WARNING: Latency is elevated (50-100ms)');
            console.log('   Possible causes:');
            console.log('   - Redis and app might be in different availability zones');
            console.log('   - Network congestion');
            console.log('   - Consider upgrading Redis plan');
        } else if (minPing < 200) {
            console.log('🔴 DEGRADED: Latency is high (100-200ms)');
            console.log('   Likely causes:');
            console.log('   - Redis and app are in DIFFERENT REGIONS');
            console.log('   - Check: Render region vs Redis Cloud region');
            console.log('   - Solution: Move one to match the other');
        } else {
            console.log('🚨 CRITICAL: Latency is unacceptable (>200ms)');
            console.log('   This WILL affect user experience!');
            console.log('   Immediate action required:');
            console.log('   1. Verify Redis is in same region as Render app');
            console.log('   2. Check for network/firewall issues');
            console.log('   3. Contact Redis Cloud support');
        }

        // TLS overhead check
        if (isTLS && pingTimes[0] > pingTimes[9] * 1.5) {
            console.log('\n💡 NOTE: First ping was slower than later pings.');
            console.log('   This is normal TLS handshake overhead (one-time per connection).');
        }

        await client.quit();
        console.log('\n✅ Test complete. Connection closed.');

    } catch (error) {
        console.log('\n❌ TEST FAILED');
        console.log(`   Error: ${error.message}`);
        
        if (error.message.includes('ENOTFOUND')) {
            console.log('\n   🔧 Fix: Redis host not found. Check REDIS_URL is correct.');
        } else if (error.message.includes('ECONNREFUSED')) {
            console.log('\n   🔧 Fix: Connection refused. Redis might be down or firewall blocking.');
        } else if (error.message.includes('AUTH')) {
            console.log('\n   🔧 Fix: Authentication failed. Check password in REDIS_URL.');
        } else if (error.message.includes('CERT')) {
            console.log('\n   🔧 Fix: TLS certificate issue. Try redis:// instead of rediss://');
        }
        
        process.exit(1);
    }
}

testRedisLatency();

