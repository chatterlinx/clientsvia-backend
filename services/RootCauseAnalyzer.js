// ============================================================================
// 🧠 AI ROOT CAUSE ANALYZER
// ============================================================================
// Intelligent pattern matching for automatic error diagnosis
// 
// FEATURES:
// ✅ Pattern recognition across error logs
// ✅ Automatic root cause identification
// ✅ Symptom-to-cause mapping
// ✅ Historical pattern learning
// ✅ Confidence scoring
// ============================================================================

const NotificationLog = require('../models/NotificationLog');
const logger = require('../utils/logger.js');

class RootCauseAnalyzer {
    constructor() {
        this.patterns = this.buildPatternLibrary();
    }

    // ========================================================================
    // PATTERN LIBRARY - Known error patterns and their root causes
    // ========================================================================
    buildPatternLibrary() {
        return {
            // PATTERN: Multiple cascade failures from single root cause
            TWILIO_CASCADE: {
                symptoms: ['SMS_DELIVERY_FAILURE', 'TWILIO_GREETING_FAILURE', 'NOTIFICATION_SYSTEM_FAILURE'],
                rootCause: 'TWILIO_API_FAILURE',
                confidence: 0.95,
                diagnosis: 'Multiple Twilio-dependent services failing simultaneously indicates Twilio API is down',
                fixPriority: 'P0 - Fix Twilio credentials first, all cascades will resolve'
            },

            // PATTERN: AI failures with voice/TTS issues
            AI_VOICE_CASCADE: {
                symptoms: ['ELEVENLABS_TTS_FAILURE', 'TWILIO_GREETING_FAILURE', 'AI_AGENT_PROCESSING_FAILURE'],
                rootCause: 'ELEVENLABS_API_FAILURE',
                confidence: 0.90,
                diagnosis: 'AI voice pipeline broken - ElevenLabs API unavailable or misconfigured',
                fixPriority: 'P0 - Fix ElevenLabs API key, voice greetings will restore'
            },

            // PATTERN: Database connection causes widespread failures
            DATABASE_CASCADE: {
                symptoms: ['AI_AGENT_INIT_FAILURE', 'COMPANY_DATABASE_EMPTY', 'CONFIG_LOAD_FAILURE'],
                rootCause: 'DB_CONNECTION_ERROR',
                confidence: 0.98,
                diagnosis: 'Database connection lost - all data-dependent operations failing',
                fixPriority: 'P0 - CRITICAL - Platform-wide outage, fix MongoDB connection immediately'
            },

            // PATTERN: Redis cache failures causing secondary issues
            CACHE_CASCADE: {
                symptoms: ['SESSION_TIMEOUT', 'IDEMPOTENCY_FAILURE', 'RATE_LIMIT_BYPASS'],
                rootCause: 'REDIS_CONNECTION_ERROR',
                confidence: 0.92,
                diagnosis: 'Redis cache unavailable - session management and caching degraded',
                fixPriority: 'P1 - Fix Redis connection, performance will improve'
            },

            // PATTERN: Configuration missing causing multiple failures
            CONFIG_CASCADE: {
                symptoms: ['TWILIO_API_FAILURE', 'ELEVENLABS_TTS_FAILURE', 'EMAIL_DELIVERY_FAILURE'],
                rootCause: 'ENV_VARS_MISSING',
                confidence: 0.85,
                diagnosis: 'Multiple API services failing - likely environment variables missing after deployment',
                fixPriority: 'P0 - Check Render environment variables, verify all API keys are set'
            },

            // PATTERN: Company-specific configuration issues
            COMPANY_CONFIG_CASCADE: {
                symptoms: ['AI_AGENT_INIT_FAILURE', 'KNOWLEDGE_ROUTER_FAILURE', 'TEMPLATE_RENDER_ERROR'],
                rootCause: 'COMPANY_CONFIG_INCOMPLETE',
                confidence: 0.88,
                diagnosis: 'Company AI configuration incomplete - knowledge base or templates not set up',
                fixPriority: 'P2 - Company-specific issue, guide customer through AI Agent setup'
            },

            // PATTERN: Network/connectivity issues
            NETWORK_CASCADE: {
                symptoms: ['TWILIO_API_FAILURE', 'ELEVENLABS_API_FAILURE', 'DB_CONNECTION_ERROR'],
                rootCause: 'NETWORK_OUTAGE',
                confidence: 0.75,
                diagnosis: 'Multiple external services unreachable - potential network or DNS issue',
                fixPriority: 'P0 - Check Render service status, verify network connectivity'
            },

            // PATTERN: Performance degradation leading to timeouts
            PERFORMANCE_CASCADE: {
                symptoms: ['DB_QUERY_SLOW', 'API_TIMEOUT', 'REQUEST_TIMEOUT'],
                rootCause: 'RESOURCE_EXHAUSTION',
                confidence: 0.80,
                diagnosis: 'System performance degraded - CPU, memory, or connection pool exhausted',
                fixPriority: 'P1 - Check Render metrics, consider scaling resources'
            }
        };
    }

    // ========================================================================
    // ANALYZE - Detect patterns and identify root cause
    // ========================================================================
    async analyzeErrors(timeWindowMinutes = 15) {
        try {
            logger.info(`🧠 [ROOT CAUSE] Starting analysis for last ${timeWindowMinutes} minutes`);

            // Get recent errors
            const cutoffTime = new Date(Date.now() - timeWindowMinutes * 60 * 1000);
            const recentErrors = await NotificationLog.find({
                createdAt: { $gte: cutoffTime },
                severity: { $in: ['CRITICAL', 'WARNING'] }
            }).sort({ createdAt: -1 }).limit(100);

            if (recentErrors.length === 0) {
                return {
                    hasPattern: false,
                    message: 'No recent errors to analyze'
                };
            }

            // Extract error codes
            const errorCodes = recentErrors.map(err => err.code);
            const errorCodeCounts = this.countOccurrences(errorCodes);

            logger.debug(`🧠 [ROOT CAUSE] Found ${recentErrors.length} errors:`, errorCodeCounts);

            // Check each pattern
            for (const [patternName, pattern] of Object.entries(this.patterns)) {
                const matchResult = this.matchPattern(errorCodes, pattern);

                if (matchResult.isMatch) {
                    logger.info(`✅ [ROOT CAUSE] Pattern detected: ${patternName} (confidence: ${matchResult.confidence})`);

                    return {
                        hasPattern: true,
                        patternName,
                        rootCause: pattern.rootCause,
                        diagnosis: pattern.diagnosis,
                        confidence: matchResult.confidence,
                        matchedSymptoms: matchResult.matchedSymptoms,
                        affectedErrors: recentErrors.filter(err => 
                            pattern.symptoms.includes(err.code)
                        ).length,
                        fixPriority: pattern.fixPriority,
                        recommendation: this.getRecommendation(pattern.rootCause),
                        timeWindow: timeWindowMinutes
                    };
                }
            }

            // No pattern matched
            return {
                hasPattern: false,
                message: 'No known error patterns detected',
                errorCounts: errorCodeCounts,
                totalErrors: recentErrors.length
            };

        } catch (error) {
            logger.error('❌ [ROOT CAUSE] Analysis failed:', error);
            throw error;
        }
    }

    // ========================================================================
    // MATCH PATTERN - Check if error codes match a known pattern
    // ========================================================================
    matchPattern(errorCodes, pattern) {
        const uniqueErrors = [...new Set(errorCodes)];
        const matchedSymptoms = pattern.symptoms.filter(symptom => 
            uniqueErrors.includes(symptom)
        );

        const matchPercentage = matchedSymptoms.length / pattern.symptoms.length;

        // Require at least 60% of symptoms to match
        const isMatch = matchPercentage >= 0.6;

        // Adjust confidence based on match percentage
        const adjustedConfidence = isMatch 
            ? pattern.confidence * matchPercentage 
            : 0;

        return {
            isMatch,
            confidence: Math.round(adjustedConfidence * 100) / 100,
            matchedSymptoms,
            matchPercentage: Math.round(matchPercentage * 100)
        };
    }

    // ========================================================================
    // GET RECOMMENDATION - Action items for specific root causes
    // ========================================================================
    getRecommendation(rootCause) {
        const recommendations = {
            'TWILIO_API_FAILURE': [
                '1. Check Render environment: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER',
                '2. Verify Twilio account status at twilio.com/console',
                '3. Run "Send Test SMS" in Notification Center → Settings',
                '4. All cascade failures will resolve once Twilio is fixed'
            ],
            'ELEVENLABS_API_FAILURE': [
                '1. Check Render environment: ELEVENLABS_API_KEY',
                '2. Verify API key at elevenlabs.io',
                '3. Test voice synthesis in Company Profile → Voice Settings',
                '4. Voice greetings will restore once API is fixed'
            ],
            'DB_CONNECTION_ERROR': [
                '1. CRITICAL: Check MongoDB Atlas cluster status immediately',
                '2. Verify MONGODB_URI in Render environment',
                '3. Check MongoDB Atlas network access includes Render IPs',
                '4. Review connection pool settings in db.js',
                '5. This is a platform-wide outage affecting all companies'
            ],
            'REDIS_CONNECTION_ERROR': [
                '1. Check Render Redis addon status',
                '2. Verify REDIS_URL in environment variables',
                '3. Review Redis connection logs',
                '4. Performance and sessions will improve once Redis is restored'
            ],
            'ENV_VARS_MISSING': [
                '1. Go to Render Dashboard → Environment tab',
                '2. Verify all API keys are set: TWILIO_*, ELEVENLABS_API_KEY, MONGODB_URI',
                '3. Check for recent deployments that may have reset env vars',
                '4. Restart service after adding missing variables'
            ],
            'COMPANY_CONFIG_INCOMPLETE': [
                '1. Open Company Profile → AI Agent Logic',
                '2. Verify knowledge sources are configured',
                '3. Check that templates are published',
                '4. Add at least 1 Company Q&A entry',
                '5. Test AI responses after configuration'
            ],
            'NETWORK_OUTAGE': [
                '1. Check Render service status page',
                '2. Verify DNS resolution for external APIs',
                '3. Test connectivity to Twilio, ElevenLabs, MongoDB Atlas',
                '4. Review Render logs for network errors',
                '5. Contact Render support if widespread outage'
            ],
            'RESOURCE_EXHAUSTION': [
                '1. Check Render Metrics → CPU, Memory, Network',
                '2. Review database query performance',
                '3. Consider upgrading Render plan for more resources',
                '4. Optimize slow database queries',
                '5. Review connection pool sizes'
            ]
        };

        return recommendations[rootCause] || ['No specific recommendations available'];
    }

    // ========================================================================
    // COUNT OCCURRENCES - Helper to count error codes
    // ========================================================================
    countOccurrences(array) {
        return array.reduce((acc, item) => {
            acc[item] = (acc[item] || 0) + 1;
            return acc;
        }, {});
    }

    // ========================================================================
    // ANALYZE SINGLE ERROR - Predict root cause for a single error
    // ========================================================================
    async analyzeSingleError(errorCode) {
        try {
            // Check if this error is a symptom in any pattern
            for (const [patternName, pattern] of Object.entries(this.patterns)) {
                if (pattern.symptoms.includes(errorCode)) {
                    return {
                        isPotentialSymptom: true,
                        patternName,
                        likelyRootCause: pattern.rootCause,
                        diagnosis: pattern.diagnosis,
                        confidence: pattern.confidence,
                        recommendation: 'Check for other symptoms: ' + pattern.symptoms.join(', ')
                    };
                }
            }

            return {
                isPotentialSymptom: false,
                message: 'Error not recognized as part of known cascade pattern'
            };

        } catch (error) {
            logger.error('❌ [ROOT CAUSE] Single error analysis failed:', error);
            throw error;
        }
    }
}

module.exports = new RootCauseAnalyzer();

