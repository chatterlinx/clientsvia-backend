#!/usr/bin/env node
/**
 * REDIS PERFORMANCE TEST
 * Tests actual Redis performance under load to simulate 1000 clients
 */

require('dotenv').config();
const redis = require('redis');

async function runPerformanceTest() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║  🔥 REDIS PERFORMANCE TEST - 1000 CLIENT SIMULATION         ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        console.error('❌ REDIS_URL not found in environment');
        process.exit(1);
    }

    console.log('📍 Redis URL:', redisUrl.replace(/:[^@]+@/, ':****@'));

    let client;
    try {
        // Create Redis client
        client = redis.createClient({ url: redisUrl });
        await client.connect();
        console.log('✅ Connected to Redis\n');

        // ================================================================
        // TEST 1: Single Operation Baseline
        // ================================================================
        console.log('────────────────────────────────────────────────────────────');
        console.log('TEST 1: Single Operation Baseline');
        console.log('────────────────────────────────────────────────────────────');
        
        const t1 = Date.now();
        await client.set('test:baseline', 'value');
        await client.get('test:baseline');
        const singleOpTime = Date.now() - t1;
        
        console.log(`Single SET+GET: ${singleOpTime}ms`);
        console.log(`Expected: <20ms (same region), <150ms (cross-region)\n`);

        // ================================================================
        // TEST 2: Sequential Operations (Simulates 50 concurrent requests)
        // ================================================================
        console.log('────────────────────────────────────────────────────────────');
        console.log('TEST 2: 50 Sequential Operations (Current Load)');
        console.log('────────────────────────────────────────────────────────────');
        
        const t2 = Date.now();
        for (let i = 0; i < 50; i++) {
            await client.set(`test:seq:${i}`, `value${i}`);
            await client.get(`test:seq:${i}`);
        }
        const seqTime = Date.now() - t2;
        const seqAvg = seqTime / 50;
        
        console.log(`Total time: ${seqTime}ms`);
        console.log(`Average per operation: ${seqAvg.toFixed(2)}ms`);
        console.log(`Throughput: ${(50 / (seqTime / 1000)).toFixed(2)} ops/sec`);
        
        if (seqAvg > 150) {
            console.log('🔴 CRITICAL: Too slow for production!');
        } else if (seqAvg > 50) {
            console.log('🟡 WARNING: Borderline, will struggle at scale');
        } else {
            console.log('✅ HEALTHY: Good for production');
        }
        console.log();

        // ================================================================
        // TEST 3: Parallel Operations (Simulates 1000 clients)
        // ================================================================
        console.log('────────────────────────────────────────────────────────────');
        console.log('TEST 3: 1000 Parallel Operations (1000 Client Load)');
        console.log('────────────────────────────────────────────────────────────');
        
        const t3 = Date.now();
        const promises = [];
        for (let i = 0; i < 1000; i++) {
            promises.push(
                client.set(`test:parallel:${i}`, `value${i}`)
                    .then(() => client.get(`test:parallel:${i}`))
            );
        }
        await Promise.all(promises);
        const parallelTime = Date.now() - t3;
        const parallelAvg = parallelTime / 1000;
        
        console.log(`Total time: ${parallelTime}ms`);
        console.log(`Average per operation: ${parallelAvg.toFixed(2)}ms`);
        console.log(`Throughput: ${(1000 / (parallelTime / 1000)).toFixed(2)} ops/sec`);
        
        if (parallelTime > 30000) {
            console.log('🔴 CRITICAL: Will timeout at 1000 clients!');
        } else if (parallelTime > 10000) {
            console.log('🟡 WARNING: Users will experience delays');
        } else {
            console.log('✅ HEALTHY: Can handle 1000 clients');
        }
        console.log();

        // ================================================================
        // TEST 4: Burst Load (Simulates traffic spike)
        // ================================================================
        console.log('────────────────────────────────────────────────────────────');
        console.log('TEST 4: Burst Load (100 ops in 1 second)');
        console.log('────────────────────────────────────────────────────────────');
        
        const burstPromises = [];
        const t4 = Date.now();
        for (let i = 0; i < 100; i++) {
            burstPromises.push(
                client.set(`test:burst:${i}`, JSON.stringify({ timestamp: Date.now(), data: 'x'.repeat(1000) }))
            );
        }
        await Promise.all(burstPromises);
        const burstTime = Date.now() - t4;
        
        console.log(`Burst time: ${burstTime}ms`);
        console.log(`Ops/sec: ${(100 / (burstTime / 1000)).toFixed(2)}`);
        
        if (burstTime > 5000) {
            console.log('🔴 CRITICAL: Cannot handle traffic spikes!');
        } else if (burstTime > 2000) {
            console.log('🟡 WARNING: Will struggle during peak hours');
        } else {
            console.log('✅ HEALTHY: Can handle bursts');
        }
        console.log();

        // ================================================================
        // CLEANUP
        // ================================================================
        console.log('🧹 Cleaning up test keys...');
        const keys = await client.keys('test:*');
        if (keys.length > 0) {
            await client.del(keys);
        }
        console.log(`✅ Deleted ${keys.length} test keys\n`);

        // ================================================================
        // FINAL VERDICT
        // ================================================================
        console.log('\n╔══════════════════════════════════════════════════════════════╗');
        console.log('║  📊 FINAL VERDICT - 1000 CLIENT CAPACITY                    ║');
        console.log('╚══════════════════════════════════════════════════════════════╝\n');
        
        const score = calculateScore(singleOpTime, seqAvg, parallelTime, burstTime);
        
        console.log('Metrics:');
        console.log(`  Single op latency: ${singleOpTime}ms`);
        console.log(`  Sequential avg: ${seqAvg.toFixed(2)}ms`);
        console.log(`  Parallel total: ${parallelTime}ms`);
        console.log(`  Burst capacity: ${burstTime}ms\n`);
        
        console.log('Capacity Estimate:');
        if (score < 30) {
            console.log('🔴 FAILING: Cannot support 1000 clients');
            console.log('   Max capacity: ~50-100 clients');
            console.log('   Action: FIX REDIS IMMEDIATELY');
        } else if (score < 60) {
            console.log('🟡 MARGINAL: Will struggle at 1000 clients');
            console.log('   Max capacity: ~300-500 clients');
            console.log('   Action: Optimize before scaling');
        } else if (score < 80) {
            console.log('✅ GOOD: Can support 1000 clients');
            console.log('   Max capacity: ~1000-2000 clients');
            console.log('   Action: Monitor as you grow');
        } else {
            console.log('🚀 EXCELLENT: Enterprise-grade performance');
            console.log('   Max capacity: 5000+ clients');
            console.log('   Action: You\'re ready to scale');
        }
        
        console.log(`\nOverall Score: ${score}/100\n`);

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    } finally {
        if (client) {
            await client.quit();
            console.log('👋 Disconnected from Redis\n');
        }
    }
}

function calculateScore(single, seqAvg, parallel, burst) {
    let score = 100;
    
    // Penalize high single op latency
    if (single > 200) score -= 40;
    else if (single > 100) score -= 25;
    else if (single > 50) score -= 10;
    
    // Penalize sequential average
    if (seqAvg > 150) score -= 30;
    else if (seqAvg > 100) score -= 20;
    else if (seqAvg > 50) score -= 10;
    
    // Penalize parallel performance
    if (parallel > 30000) score -= 20;
    else if (parallel > 10000) score -= 10;
    
    // Penalize burst handling
    if (burst > 5000) score -= 10;
    else if (burst > 2000) score -= 5;
    
    return Math.max(0, score);
}

// Run test
runPerformanceTest().catch(console.error);

