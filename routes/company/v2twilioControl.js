/**
 * ============================================================================
 * TWILIO CONTROL CENTER API - AI AGENT SETTINGS TAB
 * ============================================================================
 * 
 * PURPOSE: Backend API for Twilio Control Center in AI Agent Settings
 * ISOLATION: 100% separate from legacy AI Agent Logic (will be deleted)
 * 
 * ENDPOINTS:
 * - GET    /api/company/:companyId/twilio-control/status
 * - GET    /api/company/:companyId/twilio-control/config
 * - PATCH  /api/company/:companyId/twilio-control/routing
 * - POST   /api/company/:companyId/twilio-control/test-call
 * - GET    /api/company/:companyId/twilio-control/activity
 * - GET    /api/company/:companyId/twilio-control/health
 * 
 * DATA SOURCE:
 * - Phone Number, Account SID, Auth Token → Profile Configuration tab
 * - ElevenLabs → AI Voice Settings tab
 * - This module only displays and controls Twilio-related data
 * 
 * ARCHITECTURE:
 * - Clean build (no legacy code reuse)
 * - Modular and isolated
 * - Well-labeled for future maintenance
 * - Ready for multi-provider expansion
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const Company = require('../../models/v2Company');
const v2AIAgentCallLog = require('../../models/v2AIAgentCallLog');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const { redisClient } = require('../../db');
const twilio = require('twilio');
const logger = require('../../utils/logger');

// Apply authentication AND multi-tenant access control to all routes
router.use(authenticateJWT);
router.use(requireCompanyAccess);

/**
 * ============================================================================
 * GET /api/company/:companyId/twilio-control/status
 * Get Twilio connection status
 * ============================================================================
 */
router.get('/:companyId/twilio-control/status', async (req, res) => {
    logger.info(`[TWILIO CONTROL] GET /status for company: ${req.params.companyId}`);

    try {
        const company = await Company.findById(req.params.companyId)
            .select('twilioConfig companyName aiAgentLogic.voiceSettings');

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const twilioConfig = company.twilioConfig || {};
        const voiceSettings = company.aiAgentSettings?.voiceSettings || {};

        // DIAGNOSTIC: Log what we're seeing
        logger.security(`[TWILIO CONTROL] 🔍 DIAGNOSTIC for ${company.companyName}:`);
        logger.security(`   - twilioConfig exists:`, Boolean(twilioConfig));
        logger.security(`   - accountSid exists:`, Boolean(twilioConfig.accountSid));
        logger.security(`   - authToken exists:`, Boolean(twilioConfig.authToken));
        logger.security(`   - phoneNumber (legacy):`, twilioConfig.phoneNumber || 'NOT SET');
        logger.security(`   - phoneNumbers (modern):`, twilioConfig.phoneNumbers?.length || 0, 'numbers');
        logger.security(`   - voiceSettings.voiceId:`, voiceSettings.voiceId || 'NOT SET');

        // Check if Twilio is configured (support both legacy and modern phone number structure)
        const hasAccountSid = Boolean(twilioConfig.accountSid && twilioConfig.accountSid.trim());
        const hasAuthToken = Boolean(twilioConfig.authToken && twilioConfig.authToken.trim());
        const hasPhoneNumber = Boolean(twilioConfig.phoneNumber || 
            (twilioConfig.phoneNumbers && twilioConfig.phoneNumbers.length > 0));

        const isConfigured = hasAccountSid && hasAuthToken && hasPhoneNumber;

        // Build diagnostic details
        const diagnostics = {
            accountSid: hasAccountSid ? '✅ Configured' : '❌ Missing',
            authToken: hasAuthToken ? '✅ Configured' : '❌ Missing',
            phoneNumber: hasPhoneNumber ? '✅ Configured' : '❌ Missing',
            voice: voiceSettings.voiceId ? '✅ Configured' : '❌ Not configured'
        };

        let isConnected = false;
        let lastChecked = null;
        let errorMessage = null;
        let connectionDetails = null;
        let usingGlobalAccount = false;

        // Check if using global ClientsVia Twilio account
        if (!hasAccountSid && !hasAuthToken) {
            // Company is using global Twilio account (from Render env vars)
            usingGlobalAccount = true;
            isConnected = true; // Assume global account is working if calls are being received
            connectionDetails = {
                accountType: 'Global ClientsVia Account',
                accountStatus: 'Active',
                accountFriendlyName: 'ClientsVia Master Account'
            };
            logger.security(`[TWILIO CONTROL] ✅ Using global ClientsVia Twilio account for company: ${req.params.companyId}`);
        } else if (isConfigured) {
            try {
                // Test company-specific Twilio connection
                const client = twilio(twilioConfig.accountSid, twilioConfig.authToken);
                
                // Verify account (quick API call)
                const account = await client.api.accounts(twilioConfig.accountSid).fetch();
                
                isConnected = true;
                lastChecked = new Date();
                connectionDetails = {
                    accountStatus: account.status,
                    accountFriendlyName: account.friendlyName,
                    accountType: account.type
                };

                logger.info(`[TWILIO CONTROL] ✅ Connection verified for company: ${req.params.companyId}`);

            } catch (twilioError) {
                logger.error(`[TWILIO CONTROL] ❌ Connection failed:`, twilioError.message);
                errorMessage = twilioError.message;
                
                // Add helpful diagnostic info
                if (twilioError.code === 20003) {
                    errorMessage = 'Authentication failed - Invalid Account SID or Auth Token';
                } else if (twilioError.code === 20404) {
                    errorMessage = 'Account not found - Please verify Account SID';
                } else if (twilioError.message.includes('ENOTFOUND')) {
                    errorMessage = 'Network error - Cannot reach Twilio API';
                }
            }
        } else {
            // Partially configured - missing some fields
            const missing = [];
            if (!hasAccountSid) {missing.push('Account SID');}
            if (!hasAuthToken) {missing.push('Auth Token');}
            errorMessage = `Incomplete configuration - missing: ${missing.join(', ')}. Using global ClientsVia account.`;
            usingGlobalAccount = true;
            isConnected = true;
        }

        // Get phone number (support both structures)
        const phoneNumber = twilioConfig.phoneNumber || 
                          twilioConfig.phoneNumbers?.find(p => p.isPrimary)?.phoneNumber ||
                          twilioConfig.phoneNumbers?.[0]?.phoneNumber ||
                          null;

        res.json({
            configured: isConfigured,
            connected: isConnected,
            usingGlobalAccount,
            lastChecked,
            errorMessage,
            diagnostics,
            connectionDetails,
            accountSid: twilioConfig.accountSid ? 
                `${twilioConfig.accountSid.substring(0, 8)}••••${twilioConfig.accountSid.slice(-4)}` : 
                'Using Global Account',
            phoneNumber,
            phoneNumbersCount: twilioConfig.phoneNumbers?.length || 0
        });

    } catch (error) {
        logger.error('[TWILIO CONTROL] Error getting status:', error);
        res.status(500).json({ 
            error: 'Failed to get Twilio status',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/twilio-control/config
 * Get full Twilio configuration
 * ============================================================================
 */
router.get('/:companyId/twilio-control/config', async (req, res) => {
    logger.info(`[TWILIO CONTROL] GET /config for company: ${req.params.companyId}`);

    try {
        const company = await Company.findById(req.params.companyId)
            .select('twilioConfig companyName aiAgentLogic.voiceSettings');

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const twilioConfig = company.twilioConfig || {};
        const voiceSettings = company.aiAgentSettings?.voiceSettings || {};

        // Build safe config (never expose full auth token)
        const safeConfig = {
            // Phone Numbers
            phoneNumber: twilioConfig.phoneNumber || null,
            phoneNumbers: twilioConfig.phoneNumbers || [],

            // Account (masked)
            accountSid: twilioConfig.accountSid || null,
            authToken: twilioConfig.authToken ? '••••••••••••••••' : null,
            authTokenMasked: twilioConfig.authToken ? 
                `${twilioConfig.authToken.substring(0, 4)}••••${twilioConfig.authToken.slice(-4)}` : 
                null,

            // Call Routing
            callRouting: {
                mode: twilioConfig.callRoutingMode || 'ai-agent',
                forwardNumber: twilioConfig.forwardNumber || null,
                recordingEnabled: twilioConfig.recordingEnabled !== false,
                whisperMessage: twilioConfig.whisperMessage || null
            },

            // Voice Settings (from AI Voice Settings tab)
            voice: {
                provider: voiceSettings.provider || 'elevenlabs',
                voiceId: voiceSettings.voiceId || null,
                voiceName: voiceSettings.voiceName || null
            },

            // Metadata
            lastUpdated: twilioConfig.lastUpdated || null
        };

        res.json(safeConfig);

    } catch (error) {
        logger.error('[TWILIO CONTROL] Error getting config:', error);
        res.status(500).json({ error: 'Failed to get Twilio configuration' });
    }
});

/**
 * ============================================================================
 * PATCH /api/company/:companyId/twilio-control/routing
 * Update call routing settings
 * ============================================================================
 */
router.patch('/:companyId/twilio-control/routing', async (req, res) => {
    logger.info(`[TWILIO CONTROL] PATCH /routing for company: ${req.params.companyId}`);

    try {
        const { mode, forwardNumber, recordingEnabled, whisperMessage } = req.body;

        // Validate mode
        const validModes = ['ai-agent', 'voicemail', 'forward'];
        if (mode && !validModes.includes(mode)) {
            return res.status(400).json({ 
                error: 'Invalid mode', 
                validModes 
            });
        }

        // Validate forward number if mode is 'forward'
        if (mode === 'forward' && !forwardNumber) {
            return res.status(400).json({ 
                error: 'Forward number required when mode is "forward"' 
            });
        }

        const company = await Company.findById(req.params.companyId);

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Initialize twilioConfig if it doesn't exist
        if (!company.twilioConfig) {
            company.twilioConfig = {};
        }

        // Update call routing settings
        if (mode) {company.twilioConfig.callRoutingMode = mode;}
        if (forwardNumber !== undefined) {company.twilioConfig.forwardNumber = forwardNumber;}
        if (recordingEnabled !== undefined) {company.twilioConfig.recordingEnabled = recordingEnabled;}
        if (whisperMessage !== undefined) {company.twilioConfig.whisperMessage = whisperMessage;}
        
        company.twilioConfig.lastUpdated = new Date();

        await company.save();

        // Clear cache
        try {
            await redisClient.del(`company:${req.params.companyId}`);
            logger.debug(`[TWILIO CONTROL] Cache cleared for company: ${req.params.companyId}`);
        } catch (cacheError) {
            logger.warn('[TWILIO CONTROL] Cache clear failed:', cacheError.message);
        }

        logger.debug(`[TWILIO CONTROL] ✅ Routing updated for company: ${req.params.companyId}`);

        res.json({
            success: true,
            message: 'Call routing updated successfully',
            routing: {
                mode: company.twilioConfig.callRoutingMode,
                forwardNumber: company.twilioConfig.forwardNumber,
                recordingEnabled: company.twilioConfig.recordingEnabled,
                whisperMessage: company.twilioConfig.whisperMessage
            }
        });

    } catch (error) {
        logger.error('[TWILIO CONTROL] Error updating routing:', error);
        res.status(500).json({ error: 'Failed to update call routing' });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/twilio-control/test-call
 * Test Twilio connection by making a verification call
 * ============================================================================
 */
router.post('/:companyId/twilio-control/test-call', async (req, res) => {
    logger.info(`[TWILIO CONTROL] POST /test-call for company: ${req.params.companyId}`);

    try {
        const { testPhoneNumber } = req.body;

        if (!testPhoneNumber) {
            return res.status(400).json({ 
                error: 'Test phone number required' 
            });
        }

        const company = await Company.findById(req.params.companyId)
            .select('twilioConfig companyName');

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const twilioConfig = company.twilioConfig || {};

        // Verify Twilio is configured
        if (!twilioConfig.accountSid || !twilioConfig.authToken || !twilioConfig.phoneNumber) {
            return res.status(400).json({ 
                error: 'Twilio not configured',
                message: 'Please configure Twilio credentials in Profile Configuration first'
            });
        }

        // Make test call
        try {
            const client = twilio(twilioConfig.accountSid, twilioConfig.authToken);

            const call = await client.calls.create({
                from: twilioConfig.phoneNumber,
                to: testPhoneNumber,
                twiml: `
                    <Response>
                        <Say voice="Polly.Matthew">
                            This is a test call from ${company.companyName}. 
                            Your Twilio integration is working correctly. 
                            This call will now end. Thank you.
                        </Say>
                        <Hangup/>
                    </Response>
                `
            });

            logger.debug(`[TWILIO CONTROL] ✅ Test call initiated: ${call.sid}`);

            res.json({
                success: true,
                message: 'Test call initiated successfully',
                callSid: call.sid,
                from: twilioConfig.phoneNumber,
                to: testPhoneNumber,
                status: call.status
            });

        } catch (twilioError) {
            logger.error('[TWILIO CONTROL] ❌ Test call failed:', twilioError.message);
            
            res.status(400).json({
                error: 'Test call failed',
                message: twilioError.message,
                code: twilioError.code
            });
        }

    } catch (error) {
        logger.error('[TWILIO CONTROL] Error making test call:', error);
        res.status(500).json({ error: 'Failed to initiate test call' });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/twilio-control/activity
 * Get recent call activity (last 10 calls)
 * ============================================================================
 */
router.get('/:companyId/twilio-control/activity', async (req, res) => {
    logger.info(`[TWILIO CONTROL] GET /activity for company: ${req.params.companyId}`);

    try {
        const limit = parseInt(req.query.limit) || 10;

        // Get recent call logs from database
        const callLogs = await v2AIAgentCallLog.find({ 
            companyId: req.params.companyId 
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select('callSid from to direction status duration createdAt endedAt');

        // Format activity timeline
        const activity = callLogs.map(log => ({
            callSid: log.callSid,
            direction: log.direction || 'inbound',
            from: log.from,
            to: log.to,
            status: log.status,
            duration: log.duration || null,
            timestamp: log.createdAt,
            timeAgo: getTimeAgo(log.createdAt)
        }));

        // Calculate stats
        const stats = {
            totalCalls: callLogs.length,
            answered: callLogs.filter(c => c.status === 'completed').length,
            missed: callLogs.filter(c => c.status === 'no-answer' || c.status === 'busy').length,
            averageDuration: callLogs.length > 0 ? 
                Math.round(callLogs.reduce((sum, c) => sum + (c.duration || 0), 0) / callLogs.length) : 
                0
        };

        res.json({
            activity,
            stats,
            limit,
            hasMore: callLogs.length === limit
        });

    } catch (error) {
        logger.error('[TWILIO CONTROL] Error getting activity:', error);
        res.status(500).json({ error: 'Failed to get call activity' });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/twilio-control/health
 * Calculate Twilio integration health score (0-100)
 * ============================================================================
 */
router.get('/:companyId/twilio-control/health', async (req, res) => {
    logger.info(`[TWILIO CONTROL] GET /health for company: ${req.params.companyId}`);

    try {
        const company = await Company.findById(req.params.companyId)
            .select('twilioConfig aiAgentLogic.voiceSettings');

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const twilioConfig = company.twilioConfig || {};
        const voiceSettings = company.aiAgentSettings?.voiceSettings || {};

        let healthScore = 0;
        const checks = [];

        // Check 1: Account SID configured (20 points)
        if (twilioConfig.accountSid) {
            healthScore += 20;
            checks.push({ name: 'Account SID', status: 'pass', points: 20 });
        } else {
            checks.push({ name: 'Account SID', status: 'fail', points: 0 });
        }

        // Check 2: Auth Token configured (20 points)
        if (twilioConfig.authToken) {
            healthScore += 20;
            checks.push({ name: 'Auth Token', status: 'pass', points: 20 });
        } else {
            checks.push({ name: 'Auth Token', status: 'fail', points: 0 });
        }

        // Check 3: Phone Number configured (20 points)
        if (twilioConfig.phoneNumber) {
            healthScore += 20;
            checks.push({ name: 'Phone Number', status: 'pass', points: 20 });
        } else {
            checks.push({ name: 'Phone Number', status: 'fail', points: 0 });
        }

        // Check 4: Voice Settings configured (20 points)
        if (voiceSettings.voiceId) {
            healthScore += 20;
            checks.push({ name: 'Voice Settings', status: 'pass', points: 20 });
        } else {
            checks.push({ name: 'Voice Settings', status: 'fail', points: 0 });
        }

        // Check 5: Call Routing configured (20 points)
        if (twilioConfig.callRoutingMode) {
            healthScore += 20;
            checks.push({ name: 'Call Routing', status: 'pass', points: 20 });
        } else {
            checks.push({ name: 'Call Routing', status: 'fail', points: 0 });
        }

        // Determine overall status
        let status = 'error';
        if (healthScore >= 80) {status = 'operational';}
        else if (healthScore >= 60) {status = 'degraded';}

        res.json({
            healthScore,
            status,
            checks,
            recommendations: getRecommendations(checks)
        });

    } catch (error) {
        logger.error('[TWILIO CONTROL] Error calculating health:', error);
        res.status(500).json({ error: 'Failed to calculate health score' });
    }
});

/**
 * ============================================================================
 * HELPER FUNCTIONS
 * ============================================================================
 */

/**
 * Get human-readable time ago
 */
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    
    if (seconds < 60) {return `${seconds}s ago`;}
    if (seconds < 3600) {return `${Math.floor(seconds / 60)}m ago`;}
    if (seconds < 86400) {return `${Math.floor(seconds / 3600)}h ago`;}
    return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Get recommendations based on failed checks
 */
function getRecommendations(checks) {
    const recommendations = [];

    checks.forEach(check => {
        if (check.status === 'fail') {
            switch (check.name) {
                case 'Account SID':
                    recommendations.push('Configure Twilio Account SID in Profile Configuration');
                    break;
                case 'Auth Token':
                    recommendations.push('Configure Twilio Auth Token in Profile Configuration');
                    break;
                case 'Phone Number':
                    recommendations.push('Configure Twilio Phone Number in Profile Configuration');
                    break;
                case 'Voice Settings':
                    recommendations.push('Configure Voice Settings in AI Voice Settings tab');
                    break;
                case 'Call Routing':
                    recommendations.push('Configure Call Routing in Twilio Control Center');
                    break;
            }
        }
    });

    return recommendations;
}

module.exports = router;

