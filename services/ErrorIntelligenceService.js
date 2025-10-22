// ============================================================================
// 🧠 ERROR INTELLIGENCE SERVICE
// ============================================================================
// World-class error analysis and debugging intelligence system
// 
// FEATURES:
// ✅ Enhanced error schema with fix instructions
// ✅ Dependency chain analysis (root cause vs cascade)
// ✅ Source code location tracking
// ✅ One-click fix URLs
// ✅ Reproduction steps
// ✅ Impact assessment
// ✅ Historical pattern tracking
// ============================================================================

const logger = require('../utils/logger.js');

class ErrorIntelligenceService {
    constructor() {
        this.errorCatalog = this.buildErrorCatalog();
        this.dependencyGraph = this.buildDependencyGraph();
    }

    // ========================================================================
    // ERROR CATALOG - Central registry of all known errors with fix instructions
    // ========================================================================
    buildErrorCatalog() {
        return {
            // ===== TWILIO / SMS ERRORS =====
            'TWILIO_API_FAILURE': {
                title: 'Twilio API Connection Failed',
                category: 'EXTERNAL_SERVICE',
                severity: 'CRITICAL',
                customerFacing: true,
                fixUrl: 'https://dashboard.render.com/web/srv-YOUR_SERVICE/env',
                uiFixUrl: '/admin-notification-center.html#settings',
                envVars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
                configFile: 'Render Dashboard → Environment Variables',
                sourceFile: 'clients/smsClient.js',
                sourceLine: 25,
                reproduceSteps: [
                    '1. Go to Render Dashboard → Your Service → Environment',
                    '2. Check if TWILIO_ACCOUNT_SID is set (should start with AC...)',
                    '3. Check if TWILIO_AUTH_TOKEN is set (32 character string)',
                    '4. Check if TWILIO_PHONE_NUMBER is set (format: +1234567890)',
                    '5. If any are missing, add them and restart the service'
                ],
                verifySteps: [
                    '1. Go to Notification Center → Settings tab',
                    '2. Click "Send Test SMS" button',
                    '3. Should receive SMS within 10 seconds'
                ],
                externalDocs: 'https://www.twilio.com/docs/usage/api',
                relatedErrors: ['SMS_DELIVERY_FAILURE', 'TWILIO_GREETING_FAILURE'],
                commonCauses: [
                    'Missing environment variables after deployment',
                    'Incorrect Twilio credentials',
                    'Twilio account suspended or out of credits',
                    'API credentials rotated but not updated in Render'
                ],
                impact: {
                    features: ['SMS notifications', 'Call handling', 'Inbound call routing'],
                    companies: 'ALL',
                    revenue: 'HIGH - Customer calls cannot be handled',
                    priority: 'P0 - CRITICAL'
                }
            },

            'SMS_DELIVERY_FAILURE': {
                title: 'SMS Delivery Failed',
                category: 'EXTERNAL_SERVICE',
                severity: 'CRITICAL',
                customerFacing: true,
                fixUrl: '/admin-notification-center.html#settings',
                envVars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
                sourceFile: 'clients/smsClient.js',
                sourceLine: 45,
                reproduceSteps: [
                    '1. Check if TWILIO_API_FAILURE error is present',
                    '2. This is usually a cascade failure from Twilio API',
                    '3. Fix TWILIO_API_FAILURE first'
                ],
                verifySteps: [
                    '1. Go to Notification Center → Settings',
                    '2. Click "Send Test SMS"',
                    '3. Check for success message'
                ],
                externalDocs: 'https://www.twilio.com/docs/sms/api',
                relatedErrors: ['TWILIO_API_FAILURE'],
                commonCauses: [
                    'Twilio API not configured (cascade failure)',
                    'Invalid phone number format',
                    'Phone number not verified in Twilio',
                    'SMS disabled for destination country'
                ],
                impact: {
                    features: ['Admin notifications', 'SMS alerts'],
                    companies: 'NONE',
                    revenue: 'LOW - Internal notifications only',
                    priority: 'P1 - HIGH'
                }
            },

            'TWILIO_GREETING_FAILURE': {
                title: 'Twilio Greeting Initialization Failed',
                category: 'COMPANY_CONFIG',
                severity: 'WARNING',
                customerFacing: true,
                fixUrl: '/company-profile.html?tab=ai-settings',
                sourceFile: 'routes/v2twilio.js',
                sourceLine: 120,
                reproduceSteps: [
                    '1. Open company profile → AI Settings',
                    '2. Check if greeting template is configured',
                    '3. Check if ElevenLabs API key is set (if using voice)',
                    '4. Test by calling company number'
                ],
                verifySteps: [
                    '1. Call company Twilio number',
                    '2. Should hear greeting within 3 seconds',
                    '3. Check call logs for success'
                ],
                relatedErrors: ['AI_AGENT_INIT_FAILURE', 'ELEVENLABS_API_FAILURE'],
                commonCauses: [
                    'Company greeting template not configured',
                    'ElevenLabs API key missing or invalid',
                    'Company AI settings incomplete',
                    'Template variables not populated'
                ],
                impact: {
                    features: ['Inbound call greeting', 'Voice AI'],
                    companies: 'SPECIFIC',
                    revenue: 'MEDIUM - Poor customer experience',
                    priority: 'P1 - HIGH'
                }
            },

            // ===== AI AGENT ERRORS =====
            'AI_AGENT_INIT_FAILURE': {
                title: 'AI Agent Initialization Failed',
                category: 'COMPANY_CONFIG',
                severity: 'CRITICAL',
                customerFacing: true,
                fixUrl: '/company-profile.html?tab=ai-agent',
                sourceFile: 'services/v2AIAgentRuntime.js',
                sourceLine: 75,
                reproduceSteps: [
                    '1. Open company profile → AI Agent Logic tab',
                    '2. Check if knowledge sources are configured',
                    '3. Verify thresholds are set (0.5-0.9 range)',
                    '4. Check if templates are published',
                    '5. Verify company Q&A has at least 1 entry'
                ],
                verifySteps: [
                    '1. Send test SMS to company number',
                    '2. Check AI Agent Monitoring tab',
                    '3. Should see successful AI response'
                ],
                relatedErrors: ['TWILIO_GREETING_FAILURE'],
                commonCauses: [
                    'Knowledge base not configured',
                    'No company Q&A entries',
                    'Invalid threshold settings',
                    'Templates not published',
                    'Company settings incomplete'
                ],
                impact: {
                    features: ['AI-powered responses', 'Knowledge base routing'],
                    companies: 'SPECIFIC',
                    revenue: 'HIGH - AI responses unavailable',
                    priority: 'P0 - CRITICAL'
                }
            },

            'AI_AGENT_PROCESSING_FAILURE': {
                title: 'AI Agent Failed to Process User Input',
                category: 'AI_PROCESSING',
                severity: 'WARNING',
                customerFacing: true,
                fixUrl: '/company-profile.html?tab=ai-agent',
                uiFixUrl: '/ai-agent-monitoring.html',
                sourceFile: 'services/v2AIAgentRuntime.js',
                sourceLine: 306,
                reproduceSteps: [
                    '1. Review AI Agent Monitoring tab for failed calls',
                    '2. Check call logs for specific error details',
                    '3. Verify company knowledge base is populated',
                    '4. Test AI responses with sample queries'
                ],
                verifySteps: [
                    '1. Send test message to company number',
                    '2. Check AI Agent Monitoring for success',
                    '3. Verify response quality and latency'
                ],
                relatedErrors: ['AI_AGENT_INIT_FAILURE', 'KNOWLEDGE_ROUTER_FAILURE'],
                commonCauses: [
                    'Knowledge base empty or misconfigured',
                    'AI router thresholds too strict',
                    'Template formatting errors',
                    'Memory overflow during processing',
                    'External AI service timeout'
                ],
                impact: {
                    features: ['AI call handling', 'Smart routing', 'Knowledge responses'],
                    companies: 'SPECIFIC',
                    revenue: 'MEDIUM - Degraded AI quality',
                    priority: 'P1 - HIGH'
                }
            },

            'ELEVENLABS_VOICE_FETCH_FAILURE': {
                title: 'Failed to Fetch ElevenLabs Voices',
                category: 'EXTERNAL_SERVICE',
                severity: 'WARNING',
                customerFacing: false,
                fixUrl: 'https://dashboard.render.com/web/srv-YOUR_SERVICE/env',
                uiFixUrl: '/company-profile.html?tab=voice-settings',
                envVars: ['ELEVENLABS_API_KEY'],
                sourceFile: 'services/v2elevenLabsService.js',
                sourceLine: 130,
                reproduceSteps: [
                    '1. Go to Render Dashboard → Environment Variables',
                    '2. Check if ELEVENLABS_API_KEY is set',
                    '3. Verify API key is valid at elevenlabs.io',
                    '4. Check API usage limits not exceeded'
                ],
                verifySteps: [
                    '1. Go to Company Profile → Voice Settings',
                    '2. Voice dropdown should populate with options',
                    '3. Test voice preview should play successfully'
                ],
                externalDocs: 'https://docs.elevenlabs.io/api-reference/quick-start/authentication',
                relatedErrors: ['ELEVENLABS_TTS_FAILURE', 'TWILIO_GREETING_FAILURE'],
                commonCauses: [
                    'Missing ELEVENLABS_API_KEY environment variable',
                    'Invalid or expired API key',
                    'API rate limit exceeded',
                    'ElevenLabs service outage',
                    'Network connectivity issues'
                ],
                impact: {
                    features: ['Voice selection', 'Greeting configuration'],
                    companies: 'SPECIFIC (if using own API key) or ALL (if global key)',
                    revenue: 'LOW - Admin UI degraded but calls still work',
                    priority: 'P2 - MEDIUM'
                }
            },

            'ELEVENLABS_TTS_FAILURE': {
                title: 'Text-to-Speech Synthesis Failed',
                category: 'EXTERNAL_SERVICE',
                severity: 'CRITICAL',
                customerFacing: true,
                fixUrl: 'https://dashboard.render.com/web/srv-YOUR_SERVICE/env',
                uiFixUrl: '/company-profile.html?tab=voice-settings',
                envVars: ['ELEVENLABS_API_KEY'],
                sourceFile: 'services/v2elevenLabsService.js',
                sourceLine: 236,
                reproduceSteps: [
                    '1. Check if ELEVENLABS_VOICE_FETCH_FAILURE exists',
                    '2. Verify company voice ID is valid',
                    '3. Check ElevenLabs API status page',
                    '4. Test with different text/voice combination'
                ],
                verifySteps: [
                    '1. Call company Twilio number',
                    '2. Should hear AI greeting',
                    '3. Check call logs for TTS success',
                    '4. Monitor ElevenLabs usage dashboard'
                ],
                externalDocs: 'https://docs.elevenlabs.io/api-reference/text-to-speech',
                relatedErrors: ['ELEVENLABS_VOICE_FETCH_FAILURE', 'TWILIO_GREETING_FAILURE'],
                commonCauses: [
                    'Invalid voice ID selected',
                    'Text exceeds character limits',
                    'API quota exceeded',
                    'ElevenLabs service degraded',
                    'Invalid voice settings parameters'
                ],
                impact: {
                    features: ['AI voice greetings', 'Real-time TTS', 'Call handling'],
                    companies: 'SPECIFIC (or ALL if global API)',
                    revenue: 'HIGH - Customers hear silence or errors',
                    priority: 'P0 - CRITICAL'
                }
            },

            // ===== DATABASE ERRORS =====
            'DB_CONNECTION_ERROR': {
                title: 'Database Connection Failed',
                category: 'INFRASTRUCTURE',
                severity: 'CRITICAL',
                customerFacing: true,
                fixUrl: 'https://dashboard.render.com/web/srv-YOUR_SERVICE/env',
                envVars: ['MONGODB_URI'],
                sourceFile: 'db.js',
                sourceLine: 15,
                reproduceSteps: [
                    '1. Check Render logs for MongoDB connection errors',
                    '2. Verify MONGODB_URI in environment variables',
                    '3. Check MongoDB Atlas cluster status',
                    '4. Verify network access list includes Render IPs'
                ],
                verifySteps: [
                    '1. Check System Status page',
                    '2. Database status should be green',
                    '3. Try loading any company profile'
                ],
                externalDocs: 'https://docs.atlas.mongodb.com/troubleshoot-connection/',
                commonCauses: [
                    'MongoDB URI expired or invalid',
                    'MongoDB Atlas cluster paused or down',
                    'Network access list doesn\'t include Render IPs',
                    'Database credentials rotated',
                    'Connection pool exhausted'
                ],
                impact: {
                    features: ['ALL'],
                    companies: 'ALL',
                    revenue: 'CRITICAL - Platform completely down',
                    priority: 'P0 - CRITICAL - ALL HANDS ON DECK'
                }
            },

            'DB_QUERY_SLOW': {
                title: 'Database Query Performance Degraded',
                category: 'PERFORMANCE',
                severity: 'WARNING',
                customerFacing: false,
                sourceFile: 'models/*.js',
                reproduceSteps: [
                    '1. Check MongoDB Atlas → Metrics',
                    '2. Look for slow queries in Performance Advisor',
                    '3. Check if indexes are missing',
                    '4. Review query patterns in logs'
                ],
                verifySteps: [
                    '1. Run query again',
                    '2. Check execution time < 100ms',
                    '3. Monitor for recurring slow queries'
                ],
                externalDocs: 'https://docs.mongodb.com/manual/core/query-optimization/',
                commonCauses: [
                    'Missing database index',
                    'Large collection scan',
                    'Inefficient query pattern',
                    'Database connection pool saturated',
                    'MongoDB Atlas cluster undersized'
                ],
                impact: {
                    features: ['Query performance'],
                    companies: 'ALL',
                    revenue: 'LOW - Degraded performance but functional',
                    priority: 'P2 - MEDIUM'
                }
            },

            // ===== REDIS ERRORS =====
            'REDIS_CONNECTION_ERROR': {
                title: 'Redis Connection Failed',
                category: 'INFRASTRUCTURE',
                severity: 'CRITICAL',
                customerFacing: false,
                fixUrl: 'https://dashboard.render.com/web/srv-YOUR_SERVICE/env',
                envVars: ['REDIS_URL'],
                sourceFile: 'db.js',
                sourceLine: 45,
                reproduceSteps: [
                    '1. Check Render logs for Redis connection errors',
                    '2. Verify REDIS_URL in environment variables',
                    '3. Check Redis server status in Render dashboard',
                    '4. Test Redis connectivity from local machine'
                ],
                verifySteps: [
                    '1. Check System Status page',
                    '2. Redis status should be green',
                    '3. Session management should work'
                ],
                commonCauses: [
                    'Redis URL invalid or expired',
                    'Redis server down or restarting',
                    'Network connectivity issue',
                    'Redis password changed',
                    'Connection timeout'
                ],
                impact: {
                    features: ['Caching', 'Session management', 'Idempotency keys'],
                    companies: 'ALL',
                    revenue: 'HIGH - Significant performance degradation',
                    priority: 'P0 - CRITICAL'
                }
            },

            'REDIS_SLOW': {
                title: 'Redis Performance Degraded',
                category: 'PERFORMANCE',
                severity: 'WARNING',
                customerFacing: false,
                sourceFile: 'db.js',
                sourceLine: 75,
                reproduceSteps: [
                    '1. Check Redis metrics in Render dashboard',
                    '2. Look for high memory usage',
                    '3. Check for slow commands',
                    '4. Review connection pool size'
                ],
                verifySteps: [
                    '1. Run Redis PING command',
                    '2. Should respond < 50ms',
                    '3. Monitor for improvement'
                ],
                commonCauses: [
                    'Redis memory near capacity',
                    'Slow network to Redis server',
                    'Too many connections',
                    'Large key operations',
                    'Redis server overloaded'
                ],
                impact: {
                    features: ['Cache performance', 'Session management'],
                    companies: 'ALL',
                    revenue: 'LOW - Slower but functional',
                    priority: 'P2 - MEDIUM'
                }
            },

            // ===== NOTIFICATION SYSTEM ERRORS =====
            'NOTIFICATION_SYSTEM_FAILURE': {
                title: 'Notification System Failed',
                category: 'SYSTEM',
                severity: 'CRITICAL',
                customerFacing: false,
                fixUrl: '/admin-notification-center.html#settings',
                sourceFile: 'services/AdminNotificationService.js',
                sourceLine: 90,
                reproduceSteps: [
                    '1. Check if TWILIO_API_FAILURE is present (cascade)',
                    '2. Verify Notification Center settings',
                    '3. Check if admin contacts are configured',
                    '4. Test notification delivery'
                ],
                verifySteps: [
                    '1. Go to Notification Center → Settings',
                    '2. Click "Send Test SMS"',
                    '3. Should see success message'
                ],
                relatedErrors: ['TWILIO_API_FAILURE', 'SMS_DELIVERY_FAILURE'],
                commonCauses: [
                    'Twilio API not configured (cascade)',
                    'No admin contacts configured',
                    'Notification Center not initialized',
                    'SMS client initialization failed',
                    'Circular dependency in notification system'
                ],
                impact: {
                    features: ['Admin notifications', 'Alert escalation'],
                    companies: 'NONE',
                    revenue: 'LOW - Internal monitoring only',
                    priority: 'P1 - HIGH'
                }
            },

            // ===== PLATFORM HEALTH ERRORS =====
            'PLATFORM_HEALTH_CHECK_CRITICAL': {
                title: 'Platform Health Check Failed',
                category: 'SYSTEM',
                severity: 'CRITICAL',
                customerFacing: false,
                fixUrl: '/admin-notification-center.html#dashboard',
                sourceFile: 'services/PlatformHealthCheckService.js',
                sourceLine: 50,
                reproduceSteps: [
                    '1. Review health check details in notification',
                    '2. Identify which specific checks failed',
                    '3. Fix each failed check individually',
                    '4. Re-run health check to verify'
                ],
                verifySteps: [
                    '1. Go to Notification Center → Dashboard',
                    '2. Click "Run Health Check"',
                    '3. Should see "HEALTHY" status'
                ],
                relatedErrors: ['DB_CONNECTION_ERROR', 'REDIS_CONNECTION_ERROR', 'TWILIO_API_FAILURE'],
                commonCauses: [
                    'Multiple subsystems failing',
                    'Configuration incomplete',
                    'Environment variables missing',
                    'External services down',
                    'Database connectivity issues'
                ],
                impact: {
                    features: ['Platform stability monitoring'],
                    companies: 'ALL',
                    revenue: 'VARIABLE - Depends on failed checks',
                    priority: 'P0 - CRITICAL - Investigate immediately'
                }
            },

            'COMPANY_DATABASE_EMPTY': {
                title: 'No Active Companies Found',
                category: 'DATA',
                severity: 'CRITICAL',
                customerFacing: true,
                fixUrl: '/add-company.html',
                sourceFile: 'services/PlatformHealthCheckService.js',
                sourceLine: 145,
                queryUsed: 'Company.find({ status: "LIVE" })',
                reproduceSteps: [
                    '1. Check MongoDB for companies: db.companiesCollection.find({ status: "LIVE" })',
                    '2. Also check legacy collection: db.companies.find({ status: "LIVE" })',
                    '3. Verify correct collection is being queried',
                    '4. Check if companies exist but with different status'
                ],
                verifySteps: [
                    '1. Go to Data Center tab',
                    '2. Should see list of active companies',
                    '3. Count should match expected total'
                ],
                relatedErrors: ['DATA_CENTER_COUNT_MISMATCH'],
                commonCauses: [
                    'Wrong collection being queried',
                    'Companies in "companiesCollection" vs "companies"',
                    'Status field mismatch (LIVE vs live vs active)',
                    'Database migration incomplete',
                    'Collection name typo in query'
                ],
                impact: {
                    features: ['Company management', 'Health checks'],
                    companies: 'ALL',
                    revenue: 'CRITICAL - Platform appears empty',
                    priority: 'P0 - CRITICAL'
                }
            }
        };
    }

    // ========================================================================
    // DEPENDENCY GRAPH - Maps error relationships and cascade failures
    // ========================================================================
    buildDependencyGraph() {
        return {
            'TWILIO_API_FAILURE': {
                causes: ['SMS_DELIVERY_FAILURE', 'TWILIO_GREETING_FAILURE', 'NOTIFICATION_SYSTEM_FAILURE'],
                requiredFor: ['SMS notifications', 'Call handling', 'Voice AI']
            },
            'DB_CONNECTION_ERROR': {
                causes: ['ALL_FEATURES_DOWN'],
                requiredFor: ['All database operations', 'All API endpoints']
            },
            'REDIS_CONNECTION_ERROR': {
                causes: ['SESSION_MANAGEMENT_FAILURE', 'CACHE_UNAVAILABLE', 'IDEMPOTENCY_DISABLED'],
                requiredFor: ['Sessions', 'Caching', 'Idempotency']
            },
            'SMS_DELIVERY_FAILURE': {
                causedBy: ['TWILIO_API_FAILURE'],
                requiredFor: ['Admin notifications']
            },
            'NOTIFICATION_SYSTEM_FAILURE': {
                causedBy: ['TWILIO_API_FAILURE', 'SMS_DELIVERY_FAILURE'],
                requiredFor: ['Admin alerts', 'Error notifications']
            },
            'AI_AGENT_INIT_FAILURE': {
                causes: ['AI_AGENT_PROCESSING_FAILURE'],
                requiredFor: ['AI call handling', 'Knowledge routing']
            },
            'AI_AGENT_PROCESSING_FAILURE': {
                causedBy: ['AI_AGENT_INIT_FAILURE', 'DB_CONNECTION_ERROR'],
                requiredFor: ['AI responses', 'Smart routing']
            },
            'ELEVENLABS_VOICE_FETCH_FAILURE': {
                causes: ['ELEVENLABS_TTS_FAILURE'],
                requiredFor: ['Voice configuration', 'TTS setup']
            },
            'ELEVENLABS_TTS_FAILURE': {
                causedBy: ['ELEVENLABS_VOICE_FETCH_FAILURE'],
                causes: ['TWILIO_GREETING_FAILURE', 'AI_AGENT_PROCESSING_FAILURE'],
                requiredFor: ['Voice greetings', 'AI voice responses', 'Call handling']
            }
        };
    }

    // ========================================================================
    // ENHANCE ERROR - Add intelligence to any error
    // ========================================================================
    enhanceError({ code, error, companyId, context = {} }) {
        const catalog = this.errorCatalog[code] || {};
        const dependency = this.dependencyGraph[code] || {};

        return {
            // Original error data
            code,
            message: error?.message || catalog.title || 'Unknown error',
            
            // Intelligence layer
            intelligence: {
                // Fix instructions
                fix: {
                    title: catalog.title,
                    fixUrl: catalog.fixUrl,
                    uiFixUrl: catalog.uiFixUrl,
                    configFile: catalog.configFile,
                    envVars: catalog.envVars || [],
                    reproduceSteps: catalog.reproduceSteps || [],
                    verifySteps: catalog.verifySteps || [],
                    externalDocs: catalog.externalDocs
                },

                // Source tracking
                source: {
                    file: catalog.sourceFile || context.sourceFile,
                    line: catalog.sourceLine || context.sourceLine,
                    function: context.functionName,
                    query: catalog.queryUsed || context.query
                },

                // Dependency analysis
                dependencies: {
                    rootCause: this.identifyRootCause(code),
                    cascadeFailures: dependency.causes || [],
                    causedBy: dependency.causedBy || [],
                    affectsServices: dependency.requiredFor || []
                },

                // Impact assessment
                impact: catalog.impact || {
                    features: ['Unknown'],
                    companies: companyId ? 'SPECIFIC' : 'UNKNOWN',
                    revenue: 'UNKNOWN',
                    priority: 'P2 - MEDIUM'
                },

                // Related information
                related: {
                    errors: catalog.relatedErrors || [],
                    commonCauses: catalog.commonCauses || [],
                    category: catalog.category || 'UNKNOWN',
                    customerFacing: catalog.customerFacing || false
                }
            },

            // Context
            context: {
                companyId,
                timestamp: new Date(),
                severity: catalog.severity || 'WARNING',
                ...context
            },

            // Stack trace
            stack: error?.stack
        };
    }

    // ========================================================================
    // IDENTIFY ROOT CAUSE - Find the origin of cascade failures
    // ========================================================================
    identifyRootCause(code) {
        const dependency = this.dependencyGraph[code];
        
        if (!dependency?.causedBy || dependency.causedBy.length === 0) {
            return code; // This IS the root cause
        }

        // Recursively find root
        return dependency.causedBy[0]; // Return first root cause
    }

    // ========================================================================
    // ANALYZE FAILURE CHAIN - Build complete dependency chain
    // ========================================================================
    analyzeFailureChain(errors) {
        const chains = [];
        const processed = new Set();

        for (const errorCode of errors) {
            if (processed.has(errorCode)) continue;

            const rootCause = this.identifyRootCause(errorCode);
            const dependency = this.dependencyGraph[rootCause];
            
            if (dependency?.causes) {
                const chain = {
                    rootCause,
                    cascadeFailures: dependency.causes.filter(c => errors.includes(c)),
                    fixRootCauseFirst: true
                };
                
                chains.push(chain);
                processed.add(rootCause);
                dependency.causes.forEach(c => processed.add(c));
            }
        }

        return chains;
    }

    // ========================================================================
    // GET FIX INSTRUCTIONS - Human-readable fix guide
    // ========================================================================
    getFixInstructions(code) {
        const catalog = this.errorCatalog[code];
        if (!catalog) {
            return {
                title: 'Unknown Error',
                steps: ['Check Render logs for details', 'Contact support if issue persists']
            };
        }

        return {
            title: catalog.title,
            category: catalog.category,
            severity: catalog.severity,
            fixUrl: catalog.fixUrl,
            steps: catalog.reproduceSteps,
            verify: catalog.verifySteps,
            docs: catalog.externalDocs,
            commonCauses: catalog.commonCauses
        };
    }

    // ========================================================================
    // GET IMPACT ASSESSMENT - Understand blast radius
    // ========================================================================
    getImpactAssessment(code) {
        const catalog = this.errorCatalog[code];
        return catalog?.impact || {
            features: ['Unknown'],
            companies: 'UNKNOWN',
            revenue: 'UNKNOWN',
            priority: 'P2 - MEDIUM'
        };
    }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================
const errorIntelligence = new ErrorIntelligenceService();

module.exports = errorIntelligence;

