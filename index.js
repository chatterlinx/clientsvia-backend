require('dotenv').config(); // This MUST be the first line

console.log('[INIT] 🚀 Starting module loading sequence...');

// Initialize Sentry for error monitoring (must be early)
console.log('[INIT] Loading Sentry...');
const { initializeSentry, getSentryRequestHandler, getSentryErrorHandler } = require('./utils/sentry');
initializeSentry();
console.log('[INIT] ✅ Sentry initialized');

// Initialize logger early
console.log('[INIT] Loading logger...');
const logger = require('./utils/logger');
logger.info('--- STARTING CLIENTSVIA BACKEND SERVER - PRODUCTION BUILD ---');
console.log('[INIT] ✅ Logger initialized');

// admin-dashboard/index.js (Main Express Server)

// Import necessary modules
console.log('[INIT] Loading Express...');
const express = require('express');
const path = require('path');
console.log('[INIT] ✅ Express loaded');

// Initialize shared clients (Redis, Pinecone)
console.log('[INIT] Loading clients (Redis, Pinecone)...');
require('./clients');
console.log('[INIT] ✅ Clients loaded');

// Import database connection logic
console.log('[INIT] Loading database modules...');
const { connectDB } = require('./db');
const AgentPromptService = require('./services/agentPromptsService');
const BackupMonitoringService = require('./services/backupMonitoringService');
console.log('[INIT] ✅ Database modules loaded');

console.log('[INIT] Loading API routes...');

// Add a timeout wrapper for route loading
function loadRouteWithTimeout(routePath, name, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Route loading timeout: ${name} took longer than ${timeoutMs}ms`));
        }, timeoutMs);
        
        try {
            console.log(`[INIT] Loading ${name}...`);
            const route = require(routePath);
            clearTimeout(timeout);
            console.log(`[INIT] ✅ ${name} loaded`);
            resolve(route);
        } catch (error) {
            clearTimeout(timeout);
            console.error(`[INIT] ❌ ${name} failed to load:`, error.message);
            reject(error);
        }
    });
}

async function loadAllRoutes() {
    const routes = {};
    
    try {
        routes.companyRoutes = await loadRouteWithTimeout('./routes/company', 'companyRoutes');
        routes.alertRoutes = await loadRouteWithTimeout('./routes/alerts', 'alertRoutes');
        routes.integrationsRoutes = await loadRouteWithTimeout('./routes/integrations', 'integrationsRoutes');
        routes.ttsRoutes = await loadRouteWithTimeout('./routes/tts', 'ttsRoutes');
        routes.companyQnaRoutes = await loadRouteWithTimeout('./routes/companyQna', 'companyQnaRoutes');
        routes.suggestionRoutes = await loadRouteWithTimeout('./routes/suggestions', 'suggestionRoutes');
        routes.twilioRoutes = await loadRouteWithTimeout('./routes/twilio', 'twilioRoutes');
        routes.aiRoutes = await loadRouteWithTimeout('./routes/ai', 'aiRoutes');
        routes.elevenLabsRoutes = await loadRouteWithTimeout('./routes/elevenLabs', 'elevenLabsRoutes');
        routes.uploadRoutes = await loadRouteWithTimeout('./routes/upload', 'uploadRoutes');
        routes.learningRoutes = await loadRouteWithTimeout('./routes/learning', 'learningRoutes');
        routes.agentSettingsRoutes = await loadRouteWithTimeout('./routes/agentSettings', 'agentSettingsRoutes');
        routes.companyAgentSettingsRoutes = await loadRouteWithTimeout('./routes/company/agentSettings', 'companyAgentSettingsRoutes');
        routes.companyPersonalityRoutes = await loadRouteWithTimeout('./routes/company/personality', 'companyPersonalityRoutes');
        routes.companyKnowledgeRoutes = await loadRouteWithTimeout('./routes/company/knowledge', 'companyKnowledgeRoutes');
        routes.agentTestingRoutes = await loadRouteWithTimeout('./routes/company/agentTesting', 'agentTestingRoutes');
        routes.eventHooksRoutes = await loadRouteWithTimeout('./routes/eventHooks', 'eventHooksRoutes');
        routes.transferRouterRoutes = await loadRouteWithTimeout('./routes/transferRouter', 'transferRouterRoutes');
        routes.pendingQnARoutes = await loadRouteWithTimeout('./routes/company/pendingQnA', 'pendingQnARoutes');
        routes.enhancedAgentSettingsRoutes = await loadRouteWithTimeout('./routes/company/enhancedAgentSettings', 'enhancedAgentSettingsRoutes');
        routes.aiAgentWorkflowRoutes = await loadRouteWithTimeout('./routes/aiAgentWorkflows', 'aiAgentWorkflowRoutes');
        routes.aiAgentAnalyticsRoutes = await loadRouteWithTimeout('./routes/aiAgentAnalytics', 'aiAgentAnalyticsRoutes');
        routes.knowledgeAutoPopulationRoutes = await loadRouteWithTimeout('./routes/knowledgeAutoPopulation', 'knowledgeAutoPopulationRoutes');
        routes.enhancedAIAgentRoutes = await loadRouteWithTimeout('./routes/enhancedAIAgent', 'enhancedAIAgentRoutes');
        routes.agentPerformanceRoutes = await loadRouteWithTimeout('./routes/agentPerformance', 'agentPerformanceRoutes');
        routes.intentRoutingRoutes = await loadRouteWithTimeout('./routes/intentRouting', 'intentRoutingRoutes');
        routes.bookingScriptsRoutes = await loadRouteWithTimeout('./routes/bookingScripts', 'bookingScriptsRoutes');
        routes.bookingHandlerRoutes = await loadRouteWithTimeout('./routes/bookingHandler', 'bookingHandlerRoutes');
        routes.aiIntelligenceRoutes = await loadRouteWithTimeout('./routes/aiIntelligence', 'aiIntelligenceRoutes');
        routes.monitoringRoutes = await loadRouteWithTimeout('./routes/monitoring', 'monitoringRoutes');
        routes.notesRoutes = await loadRouteWithTimeout('./routes/notes', 'notesRoutes');
        routes.agentProcessorRoutes = await loadRouteWithTimeout('./routes/agentProcessor', 'agentProcessorRoutes');
        routes.adminRoutes = await loadRouteWithTimeout('./routes/admin', 'adminRoutes');
        routes.authRoutes = await loadRouteWithTimeout('./routes/auth', 'authRoutes');
        routes.backupRoutes = await loadRouteWithTimeout('./routes/backup', 'backupRoutes');
        routes.crmManagementRoutes = await loadRouteWithTimeout('./routes/crmManagement', 'crmManagementRoutes');
        
        // Load AI Agent Logic routes for enterprise features
        routes.aiAgentLogicRoutes = await loadRouteWithTimeout('./routes/aiAgentLogic', 'aiAgentLogicRoutes');
        
        // Load Enterprise AI Intelligence routes
        routes.enterpriseAIIntelligenceRoutes = await loadRouteWithTimeout('./routes/enterpriseAIIntelligence', 'enterpriseAIIntelligenceRoutes');
        
        // Load Enterprise Trade Categories routes
        routes.enterpriseTradeCategories = await loadRouteWithTimeout('./routes/enterpriseTradeCategories', 'enterpriseTradeCategories');
        
        // Load Company Knowledge Base routes
        routes.companyKBRoutes = await loadRouteWithTimeout('./routes/companyKB', 'companyKBRoutes');
        
        console.log('[INIT] ✅ All routes loaded successfully');
        return routes;
    } catch (error) {
        console.error('[INIT] ❌ Route loading failed:', error.message);
        throw error;
    }
}

// Load routes asynchronously with timeout protection
const routesPromise = loadAllRoutes();

// Initialize Express app
console.log('[INIT] Initializing Express app...');
const app = express();
console.log('[INIT] ✅ Express app initialized');

// --- Sentry Middleware (must be first) ---
console.log('[INIT] Setting up Sentry middleware...');
app.use(getSentryRequestHandler());
console.log('[INIT] ✅ Sentry middleware configured');

// --- Middleware ---
console.log('[INIT] Setting up Express middleware...');
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// SESSION CONFIGURATION FOR OAUTH
console.log('🔍 SESSION CHECKPOINT 1: Starting session configuration in index.js...');
const session = require('express-session');
const passport = require('./config/passport');

console.log('🔍 SESSION CHECKPOINT 2: Creating session middleware...');
app.use(session({
  store: new session.MemoryStore(),
  secret: process.env.SESSION_SECRET || 'fallback-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // true on HTTPS (like Render)
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));
console.log('🔍 SESSION CHECKPOINT 3: Session middleware applied successfully');

// Initialize Passport
console.log('🔍 SESSION CHECKPOINT 4: Initializing Passport...');
app.use(passport.initialize());
console.log('🔍 SESSION CHECKPOINT 5: Passport initialized');
app.use(passport.session());
console.log('🔍 SESSION CHECKPOINT 6: Passport session middleware applied');

// Add compression for better performance
const compression = require('compression');
app.use(compression());

// Optimized static file serving with aggressive caching for audio files
app.use('/audio', express.static(path.join(__dirname, 'public/audio'), {
  maxAge: '1d', // Cache audio files for 1 day
  etag: true,
  lastModified: true,
  immutable: true // Audio files are immutable
}));

app.use(express.static(path.join(__dirname, 'public')));

// Routes will be registered after they are loaded asynchronously
function registerRoutes(routes) {
    console.log('[INIT] Registering all API routes...');
    
    // --- API Routes ---
    app.use('/api', routes.companyRoutes);
    app.use('/api/alerts', routes.alertRoutes);
    app.use('/api/integrations', routes.integrationsRoutes);
    app.use('/api/tts', routes.ttsRoutes);
    app.use('/api/suggestions', routes.suggestionRoutes);
    app.use('/api/company/:companyId/qna', routes.companyQnaRoutes);
    app.use('/api/ai', routes.aiRoutes);
    app.use('/api/elevenlabs', routes.elevenLabsRoutes);
    app.use('/api/upload', routes.uploadRoutes);
    app.use('/api/learning', routes.learningRoutes);
    app.use('/api/agent', routes.agentSettingsRoutes); // ENTERPRISE: AI Agent Settings Management
    app.use('/api/auth', routes.authRoutes); // AUTH: User authentication and JWT token management
    app.use('/api/admin', routes.adminRoutes); // ADMIN: Authentication-protected endpoints (companies, alerts, suggestions)
    app.use('/api/backup', routes.backupRoutes); // BACKUP: Automated backup monitoring and management
    app.use('/api/company', routes.companyAgentSettingsRoutes); // ENTERPRISE: Company-specific AI Agent Settings Management
    app.use('/api/company', routes.companyPersonalityRoutes); // MODULE 1: Agent Personality Settings
    app.use('/api/company', routes.companyKnowledgeRoutes); // MODULE 2: Knowledge Q&A Source Controls
    app.use('/api/company', routes.agentTestingRoutes); // MODULE 3: AI Agent Testing Console
    app.use('/api/company', routes.pendingQnARoutes); // MODULE 4: Self-Learning Knowledge Base Approval
    app.use('/api/company', routes.enhancedAgentSettingsRoutes); // Enhanced LLM Selector & Agent Settings

    // Register AI Agent routes
    app.use('/api/event-hooks', routes.eventHooksRoutes); // Event Hooks Management API
    app.use('/api/transfer-router', routes.transferRouterRoutes); // Transfer Router Management API

    app.use('/api/ai-agent-workflows', routes.aiAgentWorkflowRoutes);
    app.use('/api/ai-agent-analytics', routes.aiAgentAnalyticsRoutes);
    app.use('/api/knowledge-auto-population', routes.knowledgeAutoPopulationRoutes);
    app.use('/api/enhanced-ai-agent', routes.enhancedAIAgentRoutes);
    app.use('/api/agent', routes.agentPerformanceRoutes);
    app.use('/api/agent', routes.intentRoutingRoutes); // Intent Routing & Flow Control routes
    app.use('/api/booking-scripts', routes.bookingScriptsRoutes); // Booking Scripts Configuration
    app.use('/api/monitoring', routes.monitoringRoutes); // Agent Monitoring System
    app.use('/api/notes', routes.notesRoutes); // GOLD STANDARD: Enterprise Notes Management
    app.use('/api/booking-handler', routes.bookingHandlerRoutes); // Booking Handler API for testing and integration
    app.use('/api/ai-intelligence', routes.aiIntelligenceRoutes); // AI Intelligence Engine routes
    app.use('/api/enterprise-ai', routes.enterpriseAIIntelligenceRoutes); // ENTERPRISE: AI Intelligence Control Center
    app.use('/api/enterprise-trade-categories', routes.enterpriseTradeCategories); // ENTERPRISE: Trade Categories Management

    // Company Knowledge Base Management
    app.use('/api/company-kb', routes.companyKBRoutes); // ENTERPRISE: Company-specific Knowledge Base

    // Mount agent processor routes
    app.use('/api/agent', routes.agentProcessorRoutes); // NEW: Central agent processing API

    /*
    --- TWILIO SMOKE TEST ROUTE (COMMENTED OUT) ---
    app.post('/api/twilio/voice', (req, res) => {
        console.log('--- SMOKE TEST ROUTE HIT SUCCESSFULLY ---');
        const twilio = require('twilio');
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say('Hello from the test route. The webhook address is correct.');
        twiml.hangup();
        res.type('text/xml');
        res.send(twiml.toString());
    });
    --- END SMOKE TEST ---
    */

    // This line will now correctly handle all /api/twilio requests
    app.use('/api/twilio', routes.twilioRoutes);
    
    // CRM Management System for Enterprise Contact Management
    app.use('/api/crm', routes.crmManagementRoutes);
    
    // AI Agent Logic routes for enterprise features (Analytics, A/B Testing, etc.)
    app.use('/api/ai-agent-logic', routes.aiAgentLogicRoutes);
    app.use('/api', routes.aiAgentLogicRoutes); // Also mount for direct API access
    
    console.log('[INIT] ✅ All API routes registered successfully');
}
console.log('[INIT] ✅ All API routes registered');

// --- Enhanced Health Check Endpoint ---
console.log('[INIT] Setting up health check endpoint...');
app.get('/health', async (req, res) => {
    const healthCheck = {
        timestamp: new Date().toISOString(),
        status: 'ok',
        environment: process.env.NODE_ENV || 'development',
        version: '1.0.0',
        services: {}
    };

    try {
        // Check MongoDB connection
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState === 1) {
            healthCheck.services.mongodb = { status: 'connected', readyState: mongoose.connection.readyState };
        } else {
            healthCheck.services.mongodb = { status: 'disconnected', readyState: mongoose.connection.readyState };
            healthCheck.status = 'degraded';
        }

        // Check Redis connection (if used)
        try {
            const { redisClient } = require('./clients');
            if (redisClient && redisClient.isReady) {
                healthCheck.services.redis = { status: 'connected' };
            } else {
                healthCheck.services.redis = { status: 'disconnected' };
                healthCheck.status = 'degraded';
            }
        } catch (redisError) {
            healthCheck.services.redis = { status: 'not_configured' };
        }

        // Check critical environment variables
        const requiredEnvVars = ['MONGODB_URI'];
        const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
        
        if (missingEnvVars.length > 0) {
            healthCheck.services.environment = { 
                status: 'error', 
                missing_variables: missingEnvVars 
            };
            healthCheck.status = 'error';
        } else {
            healthCheck.services.environment = { status: 'ok' };
        }

        // Check external API configuration
        healthCheck.services.external_apis = {
            elevenlabs: process.env.ELEVENLABS_API_KEY ? 'configured' : 'not_configured',
            twilio: (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) ? 'configured' : 'not_configured'
        };

        // System metrics
        const memUsage = process.memoryUsage();
        healthCheck.system = {
            memory: {
                rss: `${Math.round(memUsage.rss / 1024 / 1024)} MB`,
                heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
                heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`
            },
            uptime: `${Math.round(process.uptime())} seconds`,
            pid: process.pid
        };

        // Set appropriate HTTP status code
        const statusCode = healthCheck.status === 'ok' ? 200 : 
                          healthCheck.status === 'degraded' ? 503 : 500;

        res.status(statusCode).json(healthCheck);

    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({
            timestamp: new Date().toISOString(),
            status: 'error',
            error: error.message,
            environment: process.env.NODE_ENV || 'development'
        });
    }
});

// Simple health check endpoint (legacy compatibility)
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.get('/:pageName.html', (req, res, next) => {
    const pageName = req.params.pageName;
    const filePath = path.join(__dirname, 'public', `${pageName}.html`);
    res.sendFile(filePath, (err) => {
        if (err) {
            if (!res.headersSent) {
                // Optional: res.status(404).send('Page not found');
            }
        }
    });
});

console.log('[INIT] 🎉 MODULE LOADING COMPLETE - All modules loaded successfully!');
console.log('[INIT] Ready to start server when called from server.js');

// --- Database Connection and Server Start ---
async function startServer() {
    try {
        console.log('[Server] 🚀 STARTING SERVER INITIALIZATION SEQUENCE...');
        console.log('[Server] Environment:', process.env.NODE_ENV || 'development');
        console.log('[Server] Port target:', process.env.PORT || 3000);
        
        console.log('[Server] Step 1/7: Loading routes with timeout protection...');
        const routeStart = Date.now();
        const routes = await routesPromise; // Wait for routes to load
        console.log(`[Server] ✅ Step 1 COMPLETE: All routes loaded in ${Date.now() - routeStart}ms`);
        
        console.log('[Server] Step 2/7: Registering routes with Express app...');
        const registerStart = Date.now();
        registerRoutes(routes);
        console.log(`[Server] ✅ Step 2 COMPLETE: All routes registered in ${Date.now() - registerStart}ms`);
        
        console.log('[Server] Step 3/7: Starting database connection...');
        const dbStart = Date.now();
        await connectDB();
        console.log(`[Server] ✅ Step 3 COMPLETE: Database connected in ${Date.now() - dbStart}ms`);
        
        console.log('[Server] Step 4/8: Validating ResponseTrace schema...');
        const validationStart = Date.now();
        const { validateResponseTraceSchema } = require('./utils/bootValidation');
        const schemaValid = await validateResponseTraceSchema();
        if (!schemaValid && process.env.RUNTIME_STRICT_CONFIG === '1') {
            throw new Error('Boot validation failed: ResponseTrace schema invalid');
        }
        console.log(`[Server] ✅ Step 4 COMPLETE: Schema validation passed in ${Date.now() - validationStart}ms`);
        
        console.log('[Server] Step 5/8: Loading agent prompts...');
        const promptStart = Date.now();
        
        // Add timeout to prevent hanging
        const promptTimeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('AgentPromptService.loadAll() timed out after 30 seconds')), 30000)
        );
        
        await Promise.race([AgentPromptService.loadAll(), promptTimeout]);
        console.log(`[Server] ✅ Step 5 COMPLETE: Agent prompts loaded in ${Date.now() - promptStart}ms`);
        
        console.log('[Server] Step 6/8: Initializing backup monitoring...');
        const backupStart = Date.now();
        const backupMonitoring = new BackupMonitoringService();
        backupMonitoring.start();
        logger.info('🔄 Backup monitoring service initialized');
        console.log(`[Server] ✅ Step 6 COMPLETE: Backup monitoring initialized in ${Date.now() - backupStart}ms`);
        
        console.log('[Server] Step 7/8: Preparing to bind to port...');
        const PORT = process.env.PORT || 3000;
        console.log(`[Server] Target port: ${PORT}, bind address: 0.0.0.0`);
        
        console.log('[Server] Step 8/8: Starting HTTP server...');
        const serverStart = Date.now();
        
        return app.listen(PORT, '0.0.0.0', () => {
            console.log(`[Server] ✅ Step 8 COMPLETE: HTTP server bound in ${Date.now() - serverStart}ms`);
            console.log(`🎉 SERVER FULLY OPERATIONAL!`);
            console.log(`🌐 Admin dashboard listening at http://0.0.0.0:${PORT}`);
            console.log(`📊 Node environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🎯 Server ready to accept connections on port ${PORT}`);
            console.log(`⏱️  Total startup time: ${Date.now() - routeStart}ms`);
        });
    } catch (err) {
        console.error('[Server Startup] ❌ CRITICAL ERROR - Server startup failed!');
        console.error('[Server Startup] Error details:', err.message);
        console.error('[Server Startup] Stack trace:', err.stack);
        console.error('[Server Startup] Environment variables check:');
        console.error('  - PORT:', process.env.PORT);
        console.error('  - NODE_ENV:', process.env.NODE_ENV);
        console.error('  - MONGODB_URI present:', !!process.env.MONGODB_URI);
        throw err;
    }
}

if (require.main === module) {
    // If this file is executed directly, start the server
    startServer();
}

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.stack);
    if (!res.headersSent) {
        res.status(500).json({ message: 'Something broke on the server!' });
    }
});

// --- Sentry Error Handler (must be last) ---
app.use(getSentryErrorHandler());

module.exports = { app, startServer };
// Force deployment update - Mon Jul 28 14:16:09 EDT 2025
