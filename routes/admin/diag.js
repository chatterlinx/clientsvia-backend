const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { authenticateJWT, requireRole } = require('../../middleware/auth');

// 🔒 SECURITY: Require admin authentication
router.use(authenticateJWT);
router.use(requireRole('admin'));

// ============================================================================
// 🔴 REDIS CONNECTION TEST ENDPOINT
// ============================================================================
router.get('/test-redis', async (req, res) => {
  console.log('🧪 [REDIS TEST] Admin requested Redis connection test');
  
  const redis = require('redis');
  const result = {
    timestamp: new Date().toISOString(),
    redisUrlConfigured: !!process.env.REDIS_URL,
    redisUrlFormat: process.env.REDIS_URL ? process.env.REDIS_URL.replace(/:[^:@]+@/, ':****@') : 'NOT SET',
    steps: []
  };
  
  // STEP 1: Check environment variable
  result.steps.push({
    step: 1,
    name: 'Check REDIS_URL',
    status: process.env.REDIS_URL ? 'PASS' : 'FAIL',
    message: process.env.REDIS_URL ? 'REDIS_URL is configured' : 'REDIS_URL is not set'
  });
  
  if (!process.env.REDIS_URL) {
    result.overallStatus = 'FAIL';
    result.error = 'REDIS_URL environment variable is not set';
    return res.json(result);
  }
  
  // STEP 2: Create client
  let client;
  try {
    client = redis.createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 10000,
        reconnectStrategy: () => false
      }
    });
    
    result.steps.push({
      step: 2,
      name: 'Create Redis client',
      status: 'PASS',
      message: 'Redis client created successfully'
    });
  } catch (error) {
    result.steps.push({
      step: 2,
      name: 'Create Redis client',
      status: 'FAIL',
      message: `Failed to create client: ${error.message}`
    });
    result.overallStatus = 'FAIL';
    result.error = error.message;
    return res.json(result);
  }
  
  // STEP 3: Connect
  try {
    const connectStart = Date.now();
    await client.connect();
    const connectTime = Date.now() - connectStart;
    
    result.steps.push({
      step: 3,
      name: 'Connect to Redis',
      status: 'PASS',
      message: `Connected successfully in ${connectTime}ms`,
      timeMs: connectTime
    });
  } catch (error) {
    result.steps.push({
      step: 3,
      name: 'Connect to Redis',
      status: 'FAIL',
      message: `Connection failed: ${error.message}`,
      errorCode: error.code,
      errorStack: error.stack
    });
    result.overallStatus = 'FAIL';
    result.error = error.message;
    result.troubleshooting = [
      'Check if Redis service is running',
      'Verify REDIS_URL format: redis://default:password@host:port',
      'Check if IP is whitelisted (Redis Cloud requires this)',
      'Verify Redis port is open (default: 6379)',
      'Check Redis Cloud/Upstash dashboard for connection issues'
    ];
    
    try {
      await client.quit();
    } catch (e) {}
    
    return res.json(result);
  }
  
  // STEP 4: Test PING
  try {
    const pingStart = Date.now();
    const pong = await client.ping();
    const pingTime = Date.now() - pingStart;
    
    result.steps.push({
      step: 4,
      name: 'Test PING',
      status: 'PASS',
      message: `PING successful: ${pong}`,
      timeMs: pingTime
    });
  } catch (error) {
    result.steps.push({
      step: 4,
      name: 'Test PING',
      status: 'FAIL',
      message: `PING failed: ${error.message}`
    });
  }
  
  // STEP 5: Test SET/GET
  try {
    const testKey = `health-check:${Date.now()}`;
    const testValue = 'OK';
    
    const setStart = Date.now();
    await client.set(testKey, testValue, { EX: 60 });
    const setTime = Date.now() - setStart;
    
    const getStart = Date.now();
    const retrievedValue = await client.get(testKey);
    const getTime = Date.now() - getStart;
    
    result.steps.push({
      step: 5,
      name: 'Test SET/GET',
      status: retrievedValue === testValue ? 'PASS' : 'FAIL',
      message: `SET/GET operations successful`,
      setTimeMs: setTime,
      getTimeMs: getTime
    });
  } catch (error) {
    result.steps.push({
      step: 5,
      name: 'Test SET/GET',
      status: 'FAIL',
      message: `Operations failed: ${error.message}`
    });
  }
  
  // STEP 6: Get Redis info
  try {
    const info = await client.info('server');
    const versionMatch = info.match(/redis_version:([^\r\n]+)/);
    const version = versionMatch ? versionMatch[1] : 'unknown';
    
    const memory = await client.info('memory');
    const memoryUsedMatch = memory.match(/used_memory_human:([^\r\n]+)/);
    const memoryMaxMatch = memory.match(/maxmemory_human:([^\r\n]+)/);
    
    result.redisInfo = {
      version,
      memoryUsed: memoryUsedMatch ? memoryUsedMatch[1] : 'unknown',
      memoryMax: memoryMaxMatch ? memoryMaxMatch[1] : 'unknown'
    };
    
    result.steps.push({
      step: 6,
      name: 'Get Redis info',
      status: 'PASS',
      message: `Redis v${version}`
    });
  } catch (error) {
    result.steps.push({
      step: 6,
      name: 'Get Redis info',
      status: 'FAIL',
      message: `Failed to get info: ${error.message}`
    });
  }
  
  // Clean up
  try {
    await client.quit();
    result.steps.push({
      step: 7,
      name: 'Close connection',
      status: 'PASS',
      message: 'Connection closed gracefully'
    });
  } catch (error) {
    result.steps.push({
      step: 7,
      name: 'Close connection',
      status: 'FAIL',
      message: `Failed to close: ${error.message}`
    });
  }
  
  // Determine overall status
  const failedSteps = result.steps.filter(s => s.status === 'FAIL');
  result.overallStatus = failedSteps.length === 0 ? 'SUCCESS' : 'PARTIAL';
  result.summary = {
    totalSteps: result.steps.length,
    passed: result.steps.filter(s => s.status === 'PASS').length,
    failed: failedSteps.length
  };
  
  console.log(`✅ [REDIS TEST] Complete: ${result.overallStatus}`);
  res.json(result);
});

// Diagnostics: expose current environment and DB/Redis fingerprints (redacted)
router.get('/whoami', (req, res) => {
    const c = mongoose.connection;
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || '';
    const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || '';

    res.json({
        nodeEnv: process.env.NODE_ENV || 'development',
        appVersion: process.env.APP_VERSION || 'dev',
        mongo: {
            host: c?.host,
            db: c?.name,
            readyState: c?.readyState, // 1 = connected
            uriHash: mongoUri
                .replace(/\/\/([^@]+)@/, '//***@')
                .replace(/([?&]authSource)=[^&]+/g, '$1=***')
        },
        redis: {
            urlHash: redisUrl.replace(/\/\/([^@]+)@/, '//***@')
        },
        time: new Date().toISOString()
    });
});

module.exports = router;


