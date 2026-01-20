/**
 * ============================================================================
 * AI AGENT SETTINGS - SYSTEM DIAGNOSTICS
 * ============================================================================
 * 
 * Comprehensive diagnostic endpoint for AI Agent Settings tab
 * Provides deep visibility into:
 * - Greeting system status and configuration
 * - Last call details and what actually happened
 * - Data path verification (ensure data is where it should be)
 * - Configuration conflicts and recommendations
 * - Performance metrics
 * - Redis cache status
 * 
 * Purpose: Allow admin to copy diagnostics and paste to AI for instant debugging
 * ============================================================================
 */

const express = require('express');
const logger = require('../../utils/logger.js');

const router = express.Router();
const Company = require('../../models/v2Company');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const { redisClient } = require('../../db');

// Apply authentication AND multi-tenant access control to all routes
router.use(authenticateJWT);
router.use(requireCompanyAccess);

/**
 * ============================================================================
 * GET /api/company/:companyId/ai-agent-settings/diagnostics
 * Get comprehensive system diagnostics
 * ============================================================================
 */
router.get('/:companyId/ai-agent-settings/diagnostics', async (req, res) => {
    logger.info(`[AI DIAGNOSTICS] GET /diagnostics for company: ${req.params.companyId}`);

    try {
        const company = await Company.findById(req.params.companyId)
            .select('companyName businessName aiAgentSettings twilioConfig createdAt updatedAt');

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const timestamp = new Date().toISOString();
        
        // ========================================================================
        // 1. GREETING SYSTEM STATUS
        // ========================================================================
        const greetingDiagnostics = analyzeGreetingSystem(company);

        // ========================================================================
        // 2. LAST CALL DIAGNOSTICS (Future: query call logs)
        // ========================================================================
        const lastCallDiagnostics = await analyzeLastCall(req.params.companyId);

        // ========================================================================
        // 3. DATA PATH VERIFICATION
        // ========================================================================
        const dataPathDiagnostics = verifyDataPaths(company);

        // ========================================================================
        // 4. CONFIGURATION CONFLICTS
        // ========================================================================
        const conflictsDiagnostics = detectConfigurationConflicts(company);

        // ========================================================================
        // 5. PERFORMANCE METRICS (Future: track actual metrics)
        // ========================================================================
        const performanceDiagnostics = analyzePerformance(company);

        // ========================================================================
        // 6. REDIS CACHE STATUS
        // ========================================================================
        const cacheDiagnostics = await analyzeCacheStatus(req.params.companyId);

        // ========================================================================
        // COMPILE FULL DIAGNOSTIC REPORT
        // ========================================================================
        const diagnostics = {
            meta: {
                timestamp,
                companyId: req.params.companyId,
                companyName: company.businessName || company.companyName,
                reportVersion: '1.0.0'
            },
            greeting: greetingDiagnostics,
            lastCall: lastCallDiagnostics,
            dataPaths: dataPathDiagnostics,
            conflicts: conflictsDiagnostics,
            performance: performanceDiagnostics,
            cache: cacheDiagnostics
        };

        logger.debug(`[AI DIAGNOSTICS] ✅ Generated diagnostic report for ${company.companyName}`);

        res.json(diagnostics);

    } catch (error) {
        logger.error('[AI DIAGNOSTICS] Error generating diagnostics:', error);
        res.status(500).json({ 
            error: 'Failed to generate diagnostics',
            message: error.message 
        });
    }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Analyze greeting system and determine active source
 */
function analyzeGreetingSystem(company) {
    // ✅ FIX: Use ROOT LEVEL connectionMessages (AI Agent Settings > Messages & Greetings)
    // NOT aiAgentSettings.connectionMessages (deleted legacy tab)
    const connectionMessages = company.connectionMessages;
    const voiceConfig = connectionMessages?.voice;
    const greetingText = voiceConfig?.text || voiceConfig?.realtime?.text;
    const mode = voiceConfig?.mode;

    let activeSource = null;
    let activeText = null;
    let activeMode = null;
    const lastUpdated = connectionMessages?.lastUpdated;

    // Check greeting configuration
    if (mode === 'prerecorded' && voiceConfig?.prerecorded?.activeFileUrl) {
        activeSource = 'connectionMessages.voice.prerecorded';
        activeText = `Pre-recorded audio: ${voiceConfig.prerecorded.activeFileName || 'Unknown file'}`;
        activeMode = 'prerecorded';
    } else if (mode === 'realtime' && greetingText && greetingText.trim()) {
        activeSource = 'connectionMessages.voice.text';
        activeText = greetingText;
        activeMode = 'realtime';
    } else if (mode === 'disabled') {
        activeSource = 'connectionMessages.voice.disabled';
        activeText = 'Greeting disabled - going straight to AI';
        activeMode = 'disabled';
    } else {
        activeSource = 'NOT_CONFIGURED';
        activeText = 'No greeting configured - using system default';
        activeMode = 'unconfigured';
    }

    // Build status chain (NEW SYSTEM ONLY - NO LEGACY!)
    const statusChain = [
        {
            priority: 1,
            source: 'connectionMessages.voice (AI Agent Settings)',
            status: voiceConfig ? 'CONFIGURED' : 'NOT_CONFIGURED',
            mode: mode || 'NOT_SET',
            active: activeSource.includes('connectionMessages'),
            preview: activeText ? `${activeText.substring(0, 60)  }...` : null
        }
    ];

    return {
        activeSource,
        activeText,
        activeMode,
        lastUpdated,
        statusChain,
        status: voiceConfig ? 'CONFIGURED' : 'NOT_CONFIGURED'
    };
}

/**
 * Analyze last call (placeholder - needs call log integration)
 */
async function analyzeLastCall(companyId) {
    // TODO: Query v2AIAgentCallLog for most recent call
    return {
        available: false,
        message: 'Call logging integration pending',
        placeholder: 'Last call data will appear here once call logging is implemented'
    };
}

/**
 * Verify all critical data paths exist
 */
function verifyDataPaths(company) {
    const checks = [];

    // ✅ CHECK NEW SYSTEM: connectionMessages at ROOT LEVEL (AI Agent Settings)
    checks.push({
        path: 'connectionMessages',
        exists: Boolean(company.connectionMessages),
        status: company.connectionMessages ? 'OK' : 'MISSING',
        critical: true,
        hint: 'Configure in AI Agent Settings > Messages & Greetings tab'
    });

    // Check voice config
    checks.push({
        path: 'connectionMessages.voice',
        exists: Boolean(company.connectionMessages?.voice),
        status: company.connectionMessages?.voice ? 'OK' : 'MISSING',
        critical: true
    });

    // Check voice mode
    checks.push({
        path: 'connectionMessages.voice.mode',
        exists: Boolean(company.connectionMessages?.voice?.mode),
        status: company.connectionMessages?.voice?.mode ? 'OK' : 'NOT_SET',
        value: company.connectionMessages?.voice?.mode || null,
        critical: true
    });

    // Check voice text (for realtime TTS)
    checks.push({
        path: 'connectionMessages.voice.text',
        exists: Boolean(company.connectionMessages?.voice?.text),
        status: company.connectionMessages?.voice?.text ? 'OK' : 'NOT_SET',
        value: company.connectionMessages?.voice?.text ? `"${company.connectionMessages.voice.text.substring(0, 40)}..."` : null
    });

    // Check prerecorded audio
    checks.push({
        path: 'connectionMessages.voice.prerecorded.activeFileUrl',
        exists: Boolean(company.connectionMessages?.voice?.prerecorded?.activeFileUrl),
        status: company.connectionMessages?.voice?.prerecorded?.activeFileUrl ? 'OK' : 'NOT_SET',
        value: company.connectionMessages?.voice?.prerecorded?.activeFileName || null
    });

    // Check aiAgentSettings (legacy, but still used for voiceSettings)
    checks.push({
        path: 'aiAgentSettings',
        exists: Boolean(company.aiAgentSettings),
        status: company.aiAgentSettings ? 'OK' : 'MISSING'
    });

    // Check voiceSettings
    checks.push({
        path: 'aiAgentSettings.voiceSettings',
        exists: Boolean(company.aiAgentSettings?.voiceSettings),
        status: company.aiAgentSettings?.voiceSettings ? 'OK' : 'MISSING'
    });

    // Check voiceId
    checks.push({
        path: 'aiAgentSettings.voiceSettings.voiceId',
        exists: Boolean(company.aiAgentSettings?.voiceSettings?.voiceId),
        status: company.aiAgentSettings?.voiceSettings?.voiceId ? 'OK' : 'NOT_SET',
        value: company.aiAgentSettings?.voiceSettings?.voiceId || null
    });

    // Check twilioConfig
    checks.push({
        path: 'twilioConfig',
        exists: Boolean(company.twilioConfig),
        status: company.twilioConfig ? 'OK' : 'MISSING'
    });

    const allOk = checks.every(check => check.status === 'OK' || !check.critical);

    return {
        status: allOk ? 'HEALTHY' : 'ISSUES_DETECTED',
        checks,
        summary: {
            total: checks.length,
            ok: checks.filter(c => c.status === 'OK').length,
            missing: checks.filter(c => c.status === 'MISSING').length,
            notSet: checks.filter(c => c.status === 'NOT_SET').length
        }
    };
}

/**
 * Detect configuration conflicts and provide recommendations
 */
function detectConfigurationConflicts(company) {
    const issues = [];
    const recommendations = [];

    // ✅ FIX: Check ROOT LEVEL connectionMessages (AI Agent Settings)
    const connectionMessages = company.connectionMessages;
    const voiceMode = connectionMessages?.voice?.mode;
    const hasText = Boolean(connectionMessages?.voice?.text);
    const hasPrerecorded = Boolean(connectionMessages?.voice?.prerecorded?.activeFileUrl);

    // Check if connectionMessages is not configured at all
    if (!connectionMessages || !connectionMessages.voice) {
        issues.push({
            type: 'CONFIGURATION_MISSING',
            severity: 'CRITICAL',
            message: 'No connection messages configured',
            field: 'connectionMessages',
            hint: 'Configure in AI Agent Settings > Messages & Greetings tab'
        });
        recommendations.push({
            action: 'Configure greeting in AI Agent Settings',
            reason: 'Twilio calls require a greeting configuration',
            priority: 'CRITICAL'
        });
    }

    // Check for voice mode mismatch
    if (voiceMode === 'realtime' && !hasText) {
        issues.push({
            type: 'CONFIGURATION_ERROR',
            severity: 'HIGH',
            message: 'Voice mode is "realtime" but no text is set',
            field: 'connectionMessages.voice.text',
            hint: 'Add greeting text in Messages & Greetings tab'
        });
        recommendations.push({
            action: 'Set voice text or switch to prerecorded mode',
            reason: 'Realtime mode requires text to synthesize',
            priority: 'HIGH'
        });
    }

    if (voiceMode === 'prerecorded' && !hasPrerecorded) {
        issues.push({
            type: 'CONFIGURATION_ERROR',
            severity: 'HIGH',
            message: 'Voice mode is "prerecorded" but no audio file uploaded',
            field: 'connectionMessages.voice.prerecorded.activeFileUrl',
            hint: 'Upload audio file in Messages & Greetings tab'
        });
        recommendations.push({
            action: 'Upload audio file or switch to realtime mode',
            reason: 'Prerecorded mode requires audio file',
            priority: 'HIGH'
        });
    }

    // Check voice settings (ElevenLabs)
    if (!company.aiAgentSettings?.voiceSettings?.voiceId) {
        issues.push({
            type: 'MISSING_CONFIGURATION',
            severity: 'MEDIUM',
            message: 'No ElevenLabs voice selected',
            field: 'aiAgentSettings.voiceSettings.voiceId',
            hint: 'Configure in AI Voice Settings tab'
        });
        recommendations.push({
            action: 'Select a voice in AI Voice Settings tab',
            reason: 'Required for text-to-speech synthesis',
            priority: 'MEDIUM'
        });
    }

    return {
        status: issues.length === 0 ? 'NO_CONFLICTS' : 'CONFLICTS_DETECTED',
        issueCount: issues.length,
        issues,
        recommendations
    };
}

/**
 * Analyze performance metrics (placeholder)
 */
function analyzePerformance(company) {
    // TODO: Track actual performance metrics
    return {
        available: false,
        message: 'Performance tracking not yet implemented',
        placeholder: {
            greetingGeneration: 'N/A',
            voiceSynthesis: 'N/A',
            totalCallInit: 'N/A',
            target: '< 5s'
        }
    };
}

/**
 * Analyze Redis cache status
 */
async function analyzeCacheStatus(companyId) {
    try {
        const cacheKey = `company:${companyId}`;
        
        // Check if company data is cached
        const cachedData = await redisClient.get(cacheKey);
        const isCached = Boolean(cachedData);
        
        // Get TTL (time to live)
        let ttl = null;
        if (isCached) {
            ttl = await redisClient.ttl(cacheKey);
        }

        return {
            status: isCached ? 'CACHED' : 'NOT_CACHED',
            cacheKey,
            isCached,
            ttl: ttl > 0 ? ttl : null,
            expiresIn: ttl > 0 ? `${Math.floor(ttl / 60)} minutes` : null,
            tip: 'Changes may take up to 2 minutes to reflect in calls due to caching',
            healthy: true
        };

    } catch (error) {
        logger.warn('[CACHE DIAGNOSTIC] Redis error (non-critical):', error.message);
        
        // Redis error is non-critical - calls can still work
        return {
            status: 'UNAVAILABLE',
            error: error.message,
            tip: 'Redis temporarily unavailable - This is usually a transient error. Calls should still work.',
            healthy: false,
            note: 'Cache diagnostics unavailable but system is operational'
        };
    }
}

module.exports = router;

