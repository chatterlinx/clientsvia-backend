/**
 * AI Agent Initial Handler Script
 * Main entry point for all AI agent calls - routes to intelligent engine
 */

const express = require('express');
const router = express.Router();
const RealTimeAgentMiddleware = require('../services/realTimeAgentMiddleware');
const Company = require('../models/Company');
const { authenticateJWT } = require('../middleware/auth');

// Initialize the intelligent agent middleware
const agentMiddleware = new RealTimeAgentMiddleware();

/**
 * Main entry point for incoming calls
 * This is the initial script that handles all AI agent interactions
 */
router.post('/incoming-call', async (req, res) => {
    try {
        console.log('[AI AGENT] Incoming call received:', req.body);
        
        const { 
            From: callerId, 
            To: companyPhone, 
            SpeechResult: query,
            CallSid,
            CallStatus 
        } = req.body;

        // Step 1: Identify the company by phone number
        const company = await getCompanyByPhoneNumber(companyPhone);
        if (!company) {
            console.error('[AI AGENT] Company not found for phone:', companyPhone);
            return res.status(404).send(generateTwiMLError('Company not found'));
        }

        // Step 2: Check if AI agent is enabled for this company
        if (!company.aiSettings?.enabled) {
            console.log('[AI AGENT] AI agent disabled for company:', company.name);
            return res.send(generateTwiMLFallback('AI agent is currently unavailable'));
        }

        // Step 3: Route to intelligent agent system
        const callData = {
            callerId: callerId || 'unknown',
            companyId: company._id.toString(),
            query: query || '',
            metadata: {
                callSid: CallSid,
                callStatus: CallStatus,
                companyPhone,
                timestamp: new Date()
            }
        };

        // Step 4: Process with enhanced AI agent
        const agentResponse = await agentMiddleware.handleIncomingCall(callData);

        // Step 5: Generate TwiML response
        if (agentResponse.shouldEscalate) {
            return res.send(generateTwiMLEscalation(agentResponse));
        } else {
            return res.send(generateTwiMLResponse(agentResponse.response));
        }

    } catch (error) {
        console.error('[AI AGENT] Handler error:', error);
        return res.status(500).send(generateTwiMLError('Internal server error'));
    }
});

/**
 * Handle speech input during ongoing conversation
 */
router.post('/speech-input', async (req, res) => {
    try {
        const { 
            SpeechResult: query, 
            CallSid,
            From: callerId 
        } = req.body;

        if (!query || query.trim() === '') {
            return res.send(generateTwiMLPrompt('I didn\'t catch that. Could you please repeat?'));
        }

        // Get ongoing call session
        const callSession = agentMiddleware.getActiveCall(CallSid);
        if (!callSession) {
            console.error('[AI AGENT] No active session found for CallSid:', CallSid);
            return res.send(generateTwiMLError('Session not found'));
        }

        // Process query with intelligent agent
        const callData = {
            callerId,
            companyId: callSession.companyId,
            query,
            metadata: {
                callSid: CallSid,
                sessionId: callSession.id,
                timestamp: new Date()
            }
        };

        const agentResponse = await agentMiddleware.handleIncomingCall(callData);

        // Return appropriate TwiML response
        if (agentResponse.shouldEscalate) {
            return res.send(generateTwiMLEscalation(agentResponse));
        } else {
            return res.send(generateTwiMLResponse(agentResponse.response));
        }

    } catch (error) {
        console.error('[AI AGENT] Speech input error:', error);
        return res.status(500).send(generateTwiMLError('Processing error'));
    }
});

/**
 * Handle call status updates
 */
router.post('/call-status', async (req, res) => {
    try {
        const { CallSid, CallStatus } = req.body;
        
        console.log(`[AI AGENT] Call status update: ${CallSid} -> ${CallStatus}`);

        // Clean up call session if call ended
        if (CallStatus === 'completed' || CallStatus === 'busy' || CallStatus === 'no-answer') {
            agentMiddleware.cleanupCall(CallSid);
        }

        res.status(200).send('OK');

    } catch (error) {
        console.error('[AI AGENT] Call status error:', error);
        res.status(500).send('Error');
    }
});

/**
 * Test endpoint for AI agent capabilities
 */
router.post('/test', authenticateJWT, async (req, res) => {
    try {
        const { query, companyId } = req.body;
        
        if (!query || !companyId) {
            return res.status(400).json({
                success: false,
                message: 'Query and companyId are required'
            });
        }

        // Test the intelligent agent
        const callData = {
            callerId: 'test-caller',
            companyId,
            query,
            metadata: {
                isTest: true,
                timestamp: new Date()
            }
        };

        const agentResponse = await agentMiddleware.handleIncomingCall(callData);

        res.json({
            success: true,
            response: agentResponse.response,
            confidence: agentResponse.confidence,
            responseTime: agentResponse.responseTime,
            shouldEscalate: agentResponse.shouldEscalate,
            escalationData: agentResponse.escalationData
        });

    } catch (error) {
        console.error('[AI AGENT] Test error:', error);
        res.status(500).json({
            success: false,
            message: 'Test failed',
            error: error.message
        });
    }
});

/**
 * Test Custom KB with AI Response Trace Log
 * Used by the Test Intelligence Engine in the admin UI
 */
router.post('/test-custom-kb-trace', async (req, res) => {
    try {
        const { companyId, query } = req.body;
        
        if (!companyId || !query) {
            return res.status(400).json({
                success: false,
                error: 'Missing companyId or query'
            });
        }
        
        console.log(`[Test Custom KB] Testing query: "${query}" for company: ${companyId}`);
        
        // Import the checkCustomKB function with trace logging
        const { checkCustomKB } = require('../utils/checkCustomKB');
        const ResponseTraceLogger = require('../utils/responseTraceLogger');
        
        // Create a new trace logger and start tracing
        const traceLogger = new ResponseTraceLogger();
        
        // Extract keywords for trace logging
        const { extractKeywords } = require('../utils/checkCustomKB');
        const keywords = extractKeywords(query);
        traceLogger.startTrace(query, keywords);
        
        // Test the Custom KB with trace logging
        const result = await checkCustomKB(query, companyId, null, traceLogger);
        
        // Extract the result and trace
        const response = result?.result || null;
        const trace = result?.trace || traceLogger.getTraceLog();
        
        console.log(`[Test Custom KB] Result: ${response ? 'Found match' : 'No match'}`);
        console.log(`[Test Custom KB] Trace steps: ${trace.steps?.length || 0}`);
        
        res.json({
            success: true,
            result: response,
            trace: trace,
            metadata: {
                timestamp: new Date().toISOString(),
                companyId: companyId,
                query: query,
                sourcesTested: trace.steps?.length || 0,
                matchFound: !!response
            }
        });
        
    } catch (error) {
        console.error('[Test Custom KB] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

/**
 * Test AI Intelligence Engine
 * Legacy endpoint for backwards compatibility
 */
router.post('/test-intelligence', authenticateJWT, async (req, res) => {
    try {
        const { companyId, scenario, query } = req.body;
        
        if (!companyId || !query) {
            return res.status(400).json({
                success: false,
                error: 'Missing companyId or query'
            });
        }
        
        console.log(`[Test Intelligence] Testing scenario: ${scenario}, query: "${query}"`);
        
        // Import the AI Intelligence Engine
        const AIIntelligenceEngine = require('../services/aiIntelligenceEngine');
        const aiIntelligenceEngine = new AIIntelligenceEngine();
        
        // Test the AI Intelligence with features based on scenario
        const featuresEnabled = {
            semanticKnowledge: true,
            contextualMemory: scenario !== 'simple',
            dynamicReasoning: scenario === 'complex',
            smartEscalation: scenario === 'emotional' || scenario === 'urgent'
        };
        
        const result = await aiIntelligenceEngine.testAIIntelligence(companyId, query, featuresEnabled);
        
        // Format response for legacy compatibility
        const response = {
            intelligenceScore: Math.round(result.overallScore * 100),
            confidence: Math.round((result.features.semanticKnowledge?.confidence || 0.8) * 100),
            responseTime: Math.round(result.performance.responseTime * 1000),
            method: result.features.semanticKnowledge?.result ? 'Semantic Knowledge' : 'LLM Fallback',
            response: result.features.semanticKnowledge?.result?.answer || 'Generated intelligent response based on available context',
            processingChain: [
                '✅ Query analysis completed',
                result.features.semanticKnowledge?.enabled ? '✅ Semantic knowledge search' : '❌ Semantic knowledge disabled',
                result.features.contextualMemory?.enabled ? '✅ Contextual memory lookup' : '❌ Contextual memory disabled',
                result.features.dynamicReasoning?.enabled ? '✅ Dynamic reasoning applied' : '❌ Dynamic reasoning disabled',
                result.features.smartEscalation?.enabled ? '✅ Smart escalation check' : '❌ Smart escalation disabled',
                '✅ Response generation completed'
            ].filter(Boolean)
        };
        
        res.json({
            success: true,
            data: response
        });
        
    } catch (error) {
        console.error('[Test Intelligence] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

/**
 * Test behavior detection endpoint
 */
router.post('/test-behavior', async (req, res) => {
    try {
        console.log('[AI AGENT] Testing behavior detection:', req.body);
        
        const { query, companyId, behaviorConfig } = req.body;
        
        if (!query || !companyId) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }
        
        // Get company data
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Import behavior engine
        const { evaluateBehavior } = require('../utils/behaviorRules');
        
        // Create mock agent setup with behavior config
        const agentSetup = {
            ...company.agentSetup,
            behaviors: behaviorConfig
        };
        
        // Create mock session
        const session = {
            queryHistory: [],
            silenceCount: 0,
            frustrationCount: 0
        };
        
        // Test behavior detection
        const behaviorResult = await evaluateBehavior({
            query: query,
            agentSetup: agentSetup,
            session: session,
            context: {}
        });
        
        res.json({
            success: true,
            behaviorDetected: behaviorResult,
            query: query,
            timestamp: new Date()
        });
        
    } catch (error) {
        console.error('[AI AGENT] Behavior test failed:', error);
        res.status(500).json({ error: 'Behavior test failed' });
    }
});

// Helper functions for TwiML generation
function generateTwiMLResponse(message) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">${escapeTwiML(message)}</Say>
    <Gather input="speech" timeout="10" speechTimeout="3" action="/api/ai-agent/speech-input" method="POST">
        <Say voice="alice">How else can I help you today?</Say>
    </Gather>
    <Redirect>/api/ai-agent/speech-input</Redirect>
</Response>`;
}

function generateTwiMLEscalation(agentResponse) {
    const escalationMessage = agentResponse.response || 'Let me transfer you to a specialist.';
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">${escapeTwiML(escalationMessage)}</Say>
    <Dial timeout="30">
        <Number>${process.env.ESCALATION_PHONE || '+1234567890'}</Number>
    </Dial>
</Response>`;
}

function generateTwiMLPrompt(message) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" timeout="10" speechTimeout="3" action="/api/ai-agent/speech-input" method="POST">
        <Say voice="alice">${escapeTwiML(message)}</Say>
    </Gather>
    <Redirect>/api/ai-agent/speech-input</Redirect>
</Response>`;
}

function generateTwiMLError(message) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">${escapeTwiML(message)} Please try calling back later.</Say>
    <Hangup/>
</Response>`;
}

function generateTwiMLFallback(message) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">${escapeTwiML(message)}</Say>
    <Dial timeout="30">
        <Number>${process.env.FALLBACK_PHONE || '+1234567890'}</Number>
    </Dial>
</Response>`;
}

function escapeTwiML(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;');
}

// Helper function to get company by phone number (reuse from existing twilio.js)
async function getCompanyByPhoneNumber(phoneNumber) {
    try {
        const company = await Company.findOne({
            $or: [
                { phoneNumber: phoneNumber },
                { 'twilioNumbers': phoneNumber }
            ]
        });
        return company;
    } catch (error) {
        console.error('Error finding company by phone:', error);
        return null;
    }
}

module.exports = router;
