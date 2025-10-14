/**
 * ============================================================================
 * AI AGENT SETTINGS - SYSTEM DIAGNOSTICS
 * ============================================================================
 * 
 * Comprehensive diagnostic endpoint for AI Agent Settings tab
 * Provides deep visibility into:
 * - Greeting system status and fallback chain
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
const router = express.Router();
const Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const { redisClient } = require('../../db');

// Apply authentication to all routes
router.use(authenticateJWT);

/**
 * ============================================================================
 * GET /api/company/:companyId/ai-agent-settings/diagnostics
 * Get comprehensive system diagnostics
 * ============================================================================
 */
router.get('/:companyId/ai-agent-settings/diagnostics', async (req, res) => {
    console.log(`[AI DIAGNOSTICS] GET /diagnostics for company: ${req.params.companyId}`);

    try {
        const company = await Company.findById(req.params.companyId)
            .select('companyName businessName aiAgentLogic twilioConfig createdAt updatedAt');

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const timestamp = new Date().toISOString();
        const aiLogic = company.aiAgentLogic || {};
        
        // ========================================================================
        // 1. GREETING SYSTEM STATUS
        // ========================================================================
        const greetingDiagnostics = analyzeGreetingSystem(aiLogic);

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
        const conflictsDiagnostics = detectConfigurationConflicts(aiLogic);

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

        console.log(`[AI DIAGNOSTICS] ✅ Generated diagnostic report for ${company.companyName}`);

        res.json(diagnostics);

    } catch (error) {
        console.error('[AI DIAGNOSTICS] Error generating diagnostics:', error);
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
function analyzeGreetingSystem(aiLogic) {
    const connectionMessages = aiLogic.connectionMessages?.voice?.text;
    const legacyGreeting = aiLogic.initialGreeting;
    const personalityPhrases = aiLogic.agentPersonality?.conversationPatterns?.openingPhrases;

    let activeSource = null;
    let activeText = null;
    let lastUpdated = null;

    // Priority order (matches v2AIAgentRuntime.js)
    if (connectionMessages && connectionMessages.trim()) {
        activeSource = 'connectionMessages.voice.text';
        activeText = connectionMessages;
        lastUpdated = aiLogic.connectionMessages?.lastUpdated;
    } else if (legacyGreeting && legacyGreeting.trim()) {
        activeSource = 'initialGreeting (LEGACY)';
        activeText = legacyGreeting;
        lastUpdated = null; // Legacy doesn't track updates
    } else if (personalityPhrases && personalityPhrases.length > 0) {
        activeSource = 'agentPersonality.openingPhrases';
        activeText = personalityPhrases[0];
        lastUpdated = null;
    } else {
        activeSource = 'DEFAULT_FALLBACK';
        activeText = 'System default greeting';
        lastUpdated = null;
    }

    // Build fallback chain status
    const fallbackChain = [
        {
            priority: 1,
            source: 'connectionMessages.voice.text',
            status: connectionMessages ? 'SET' : 'NOT_SET',
            active: activeSource === 'connectionMessages.voice.text',
            preview: connectionMessages ? connectionMessages.substring(0, 50) + '...' : null
        },
        {
            priority: 2,
            source: 'initialGreeting (LEGACY)',
            status: legacyGreeting ? 'SET' : 'NOT_SET',
            active: activeSource === 'initialGreeting (LEGACY)',
            warning: legacyGreeting ? 'Legacy field - should migrate to Connection Messages' : null,
            preview: legacyGreeting ? legacyGreeting.substring(0, 50) + '...' : null
        },
        {
            priority: 3,
            source: 'agentPersonality.openingPhrases',
            status: (personalityPhrases && personalityPhrases.length > 0) ? 'SET' : 'NOT_SET',
            active: activeSource === 'agentPersonality.openingPhrases',
            preview: (personalityPhrases && personalityPhrases.length > 0) ? personalityPhrases[0].substring(0, 50) + '...' : null
        }
    ];

    return {
        activeSource,
        activeText,
        lastUpdated,
        fallbackChain,
        status: activeSource === 'connectionMessages.voice.text' ? 'OPTIMAL' : 'USING_FALLBACK'
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

    // Check aiAgentLogic
    checks.push({
        path: 'aiAgentLogic',
        exists: !!company.aiAgentLogic,
        status: company.aiAgentLogic ? 'OK' : 'MISSING'
    });

    // Check connectionMessages
    checks.push({
        path: 'aiAgentLogic.connectionMessages',
        exists: !!company.aiAgentLogic?.connectionMessages,
        status: company.aiAgentLogic?.connectionMessages ? 'OK' : 'MISSING'
    });

    // Check voice settings
    checks.push({
        path: 'aiAgentLogic.connectionMessages.voice',
        exists: !!company.aiAgentLogic?.connectionMessages?.voice,
        status: company.aiAgentLogic?.connectionMessages?.voice ? 'OK' : 'MISSING'
    });

    // Check voice text
    checks.push({
        path: 'aiAgentLogic.connectionMessages.voice.text',
        exists: !!company.aiAgentLogic?.connectionMessages?.voice?.text,
        status: company.aiAgentLogic?.connectionMessages?.voice?.text ? 'OK' : 'NOT_SET',
        critical: true
    });

    // Check voiceSettings
    checks.push({
        path: 'aiAgentLogic.voiceSettings',
        exists: !!company.aiAgentLogic?.voiceSettings,
        status: company.aiAgentLogic?.voiceSettings ? 'OK' : 'MISSING'
    });

    // Check voiceId
    checks.push({
        path: 'aiAgentLogic.voiceSettings.voiceId',
        exists: !!company.aiAgentLogic?.voiceSettings?.voiceId,
        status: company.aiAgentLogic?.voiceSettings?.voiceId ? 'OK' : 'NOT_SET',
        value: company.aiAgentLogic?.voiceSettings?.voiceId || null
    });

    // Check twilioConfig
    checks.push({
        path: 'twilioConfig',
        exists: !!company.twilioConfig,
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
function detectConfigurationConflicts(aiLogic) {
    const issues = [];
    const recommendations = [];

    // Check for legacy greeting still set
    if (aiLogic.initialGreeting && aiLogic.connectionMessages?.voice?.text) {
        issues.push({
            type: 'LEGACY_DATA',
            severity: 'LOW',
            message: 'Legacy initialGreeting field is set but will be ignored',
            field: 'initialGreeting',
            value: aiLogic.initialGreeting.substring(0, 50) + '...'
        });
        recommendations.push({
            action: 'Clear legacy initialGreeting field',
            reason: 'No longer used, causes confusion',
            priority: 'LOW'
        });
    }

    // Check for voice mode mismatch
    const voiceMode = aiLogic.connectionMessages?.voice?.mode;
    const hasText = !!aiLogic.connectionMessages?.voice?.text;
    const hasPrerecorded = !!aiLogic.connectionMessages?.voice?.prerecorded?.activeFileUrl;

    if (voiceMode === 'realtime' && !hasText) {
        issues.push({
            type: 'CONFIGURATION_ERROR',
            severity: 'HIGH',
            message: 'Voice mode is "realtime" but no text is set',
            field: 'connectionMessages.voice.text'
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
            field: 'connectionMessages.voice.prerecorded.activeFileUrl'
        });
        recommendations.push({
            action: 'Upload audio file or switch to realtime mode',
            reason: 'Prerecorded mode requires audio file',
            priority: 'HIGH'
        });
    }

    // Check voice settings
    if (!aiLogic.voiceSettings?.voiceId) {
        issues.push({
            type: 'MISSING_CONFIGURATION',
            severity: 'MEDIUM',
            message: 'No ElevenLabs voice selected',
            field: 'voiceSettings.voiceId'
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
        const isCached = !!cachedData;
        
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
            tip: 'Changes may take up to 2 minutes to reflect in calls due to caching'
        };

    } catch (error) {
        return {
            status: 'ERROR',
            error: error.message,
            tip: 'Redis connection error - please check Redis status'
        };
    }
}

module.exports = router;

