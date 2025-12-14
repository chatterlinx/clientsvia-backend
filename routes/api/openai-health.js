/**
 * ============================================================================
 * OPENAI HEALTH CHECK - Actually Tests the OpenAI API
 * ============================================================================
 * 
 * GET /api/openai-health
 * 
 * This endpoint ACTUALLY calls OpenAI to verify:
 * - API key is valid
 * - Account has credits
 * - Network connection works
 * - Response time is acceptable
 * 
 * Use this to diagnose AI issues vs code issues.
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const logger = require('../../utils/logger');

/**
 * GET /api/openai-health
 * Actually calls OpenAI and reports the result
 */
router.get('/', async (req, res) => {
    const startTime = Date.now();
    
    const result = {
        timestamp: new Date().toISOString(),
        checks: {},
        overall: 'unknown'
    };
    
    try {
        // Check 1: API Key exists
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            result.checks.apiKey = {
                status: 'FAIL',
                message: 'OPENAI_API_KEY environment variable not set'
            };
            result.overall = 'FAIL';
            return res.status(500).json(result);
        }
        
        result.checks.apiKey = {
            status: 'PASS',
            message: `API key exists (${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)})`
        };
        
        // Check 2: Actually call OpenAI
        const openai = new OpenAI({ apiKey });
        
        const callStart = Date.now();
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'user', content: 'Say "OK" and nothing else.' }
            ],
            max_tokens: 5,
            temperature: 0
        });
        const callLatency = Date.now() - callStart;
        
        // Check response
        const content = response.choices?.[0]?.message?.content || '';
        const tokensUsed = response.usage?.total_tokens || 0;
        
        result.checks.apiCall = {
            status: 'PASS',
            message: 'OpenAI API responded successfully',
            latencyMs: callLatency,
            tokensUsed,
            response: content.substring(0, 50),
            model: response.model
        };
        
        // Check 3: Latency acceptable
        if (callLatency < 2000) {
            result.checks.latency = {
                status: 'PASS',
                message: `Response time acceptable: ${callLatency}ms`
            };
        } else {
            result.checks.latency = {
                status: 'WARN',
                message: `Response time slow: ${callLatency}ms (expected <2000ms)`
            };
        }
        
        result.overall = 'PASS';
        result.totalLatencyMs = Date.now() - startTime;
        result.summary = `✅ OpenAI is working! Model: ${response.model}, Latency: ${callLatency}ms`;
        
        logger.info('[OPENAI HEALTH] ✅ Health check passed', {
            latencyMs: callLatency,
            tokensUsed
        });
        
        return res.json(result);
        
    } catch (error) {
        result.checks.apiCall = {
            status: 'FAIL',
            message: error.message,
            errorType: error.constructor.name
        };
        
        // Parse specific error types
        if (error.code === 'invalid_api_key' || error.status === 401) {
            result.checks.diagnosis = {
                status: 'FAIL',
                message: '🔑 API KEY INVALID - Check your OpenAI API key',
                fix: 'Go to platform.openai.com/api-keys and generate a new key'
            };
        } else if (error.code === 'insufficient_quota' || error.message?.includes('quota')) {
            result.checks.diagnosis = {
                status: 'FAIL',
                message: '💳 BILLING ISSUE - No credits remaining',
                fix: 'Go to platform.openai.com/account/billing and add credits'
            };
        } else if (error.code === 'rate_limit_exceeded' || error.status === 429) {
            result.checks.diagnosis = {
                status: 'FAIL',
                message: '⏱️ RATE LIMITED - Too many requests',
                fix: 'Wait a few seconds and try again'
            };
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            result.checks.diagnosis = {
                status: 'FAIL',
                message: '🌐 NETWORK ERROR - Cannot reach OpenAI',
                fix: 'Check Render network settings or OpenAI status page'
            };
        } else {
            result.checks.diagnosis = {
                status: 'FAIL',
                message: `❓ UNKNOWN ERROR: ${error.message}`,
                fix: 'Check Render logs for more details'
            };
        }
        
        result.overall = 'FAIL';
        result.totalLatencyMs = Date.now() - startTime;
        result.summary = `❌ OpenAI is NOT working: ${error.message}`;
        
        logger.error('[OPENAI HEALTH] ❌ Health check failed', {
            error: error.message,
            code: error.code,
            status: error.status
        });
        
        return res.status(500).json(result);
    }
});

/**
 * GET /api/openai-health/quick
 * Fast check - just returns pass/fail without details
 */
router.get('/quick', async (req, res) => {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return res.json({ ok: false, error: 'No API key' });
        }
        
        const openai = new OpenAI({ apiKey });
        const start = Date.now();
        
        await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 1
        });
        
        return res.json({ 
            ok: true, 
            latencyMs: Date.now() - start 
        });
        
    } catch (error) {
        return res.json({ 
            ok: false, 
            error: error.message,
            code: error.code 
        });
    }
});

module.exports = router;

