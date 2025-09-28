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
// V2 DELETED: Legacy AgentPromptService - depends on deleted AgentPrompt model
// const AgentPromptService = require('./services/agentPromptsService');
// V2 DELETED: Legacy BackupMonitoringService - enterprise bloat eliminated
// const BackupMonitoringService = require('./services/backupMonitoringService');
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
        routes.v2VoiceRoutes = await loadRouteWithTimeout('./routes/company/v2profile-voice', 'v2VoiceRoutes');
        // V2 DELETED: Legacy alerts route - depends on deleted Alert model
        // routes.alertRoutes = await loadRouteWithTimeout('./routes/alerts', 'alertRoutes');
        // V2 DELETED: Legacy integrations route - Google Calendar integration eliminated
        routes.ttsRoutes = await loadRouteWithTimeout('./routes/tts', 'ttsRoutes');
        routes.twilioRoutes = await loadRouteWithTimeout('./routes/twilio', 'twilioRoutes');
        routes.aiRoutes = await loadRouteWithTimeout('./routes/ai', 'aiRoutes');
        routes.elevenLabsRoutes = await loadRouteWithTimeout('./routes/elevenLabs', 'elevenLabsRoutes');
        routes.uploadRoutes = await loadRouteWithTimeout('./routes/upload', 'uploadRoutes');
        // V2 DELETED: Legacy agentSettings route - using V2 AI Agent Logic system
        // routes.companyAgentSettingsRoutes = await loadRouteWithTimeout('./routes/company/agentSettings', 'companyAgentSettingsRoutes');
        // Legacy personality routes removed - using modern AI Agent Logic system
        // 🚀 V2 PURE SYSTEM: Only V2 Knowledge Management - ALL LEGACY ELIMINATED
        routes.v2KnowledgeManagementRoutes = await loadRouteWithTimeout('./routes/company/v2knowledgeManagement', 'v2KnowledgeManagementRoutes');
        routes.knowledgeSourcePrioritiesRoutes = await loadRouteWithTimeout('./routes/company/knowledgeSourcePriorities', 'knowledgeSourcePrioritiesRoutes');
        // V2 DELETED: Legacy enterprise testing routes - using V2 AI Agent Logic system
        // routes.priorityFlowTestingRoutes = await loadRouteWithTimeout('./routes/company/priorityFlowTesting', 'priorityFlowTestingRoutes');
        // routes.agentTestingRoutes = await loadRouteWithTimeout('./routes/company/agentTesting', 'agentTestingRoutes');
        routes.eventHooksRoutes = await loadRouteWithTimeout('./routes/eventHooks', 'eventHooksRoutes');
        routes.transferRouterRoutes = await loadRouteWithTimeout('./routes/transferRouter', 'transferRouterRoutes');
        // V2 DELETED: Legacy enhancedAgentSettings - used external LLM models, violates 100% in-house AI system
        // V2 DELETED: Legacy aiAgentWorkflows and aiAgentAnalytics routes - using V2 AI Agent Logic system
        // REMOVED: knowledgeAutoPopulationRoutes - Replaced by comprehensive Company Q&A Management system
        // V2: Legacy AI agent routes deleted - using modern v2profile-aiagentlogic system
        // V2: Legacy agentPerformance route deleted - using modern AI Agent Logic analytics
        // V2: Legacy intentRouting route deleted - using modern AI Agent Logic intent classification
        // V2: Legacy bookingScripts route deleted - using modern AI Agent Logic booking flow
        // V2: Legacy bookingHandler route deleted - using modern AI Agent Logic booking system
        // REMOVED: Legacy AI Intelligence routes - replaced by AI Agent Logic system
        // V2: Legacy monitoring route deleted - using modern AI Agent Logic monitoring system
        routes.notesRoutes = await loadRouteWithTimeout('./routes/notes', 'notesRoutes');
        // V2: Legacy agentProcessor route deleted - using modern AI Agent Logic processing system
        routes.adminRoutes = await loadRouteWithTimeout('./routes/admin', 'adminRoutes');
        routes.v2GlobalAdminRoutes = await loadRouteWithTimeout('./routes/v2global/v2global-admin', 'v2GlobalAdminRoutes');
        routes.v2GlobalDirectoryRoutes = await loadRouteWithTimeout('./routes/v2global/v2global-directory', 'v2GlobalDirectoryRoutes');
        routes.v2GlobalAddCompanyRoutes = await loadRouteWithTimeout('./routes/v2global/v2global-addcompany', 'v2GlobalAddCompanyRoutes');
        routes.v2GlobalTradeCategoriesRoutes = await loadRouteWithTimeout('./routes/v2global/v2global-tradecategories', 'v2GlobalTradeCategoriesRoutes');
        routes.authRoutes = await loadRouteWithTimeout('./routes/auth', 'authRoutes');
        routes.backupRoutes = await loadRouteWithTimeout('./routes/backup', 'backupRoutes');
        // REMOVED: Legacy CRM Management routes - will build V2 version in future
        
        // Load AI Agent Logic routes for enterprise features
        routes.v2AIAgentLogicRoutes = await loadRouteWithTimeout('./routes/company/v2profile-aiagentlogic', 'v2AIAgentLogicRoutes');
        
        // REMOVED: Legacy Enterprise AI Intelligence routes - archived to prevent external LLM dependencies
        
        // DELETED: Legacy Enterprise Trade Categories - replaced by V2 Global Trade Categories system
        
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

console.log('🔍 SESSION CHECKPOINT 2: Creating Redis session store for production...');

// 🚨 CRITICAL PRODUCTION FIX: Use Redis instead of MemoryStore
const RedisStore = require('connect-redis').default;
const { redisClient } = require('./clients');

app.use(session({
  store: new RedisStore({ client: redisClient }),
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
console.log('✅ PRODUCTION: Redis session store configured - no more memory leaks!');
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
    app.use('/api', routes.v2VoiceRoutes); // V2 Voice Settings API
    // V2: All legacy debug and seed routes deleted - no longer needed in V2 system
    // V2 DELETED: Legacy alerts route mounting - depends on deleted Alert model
    // app.use('/api/alerts', routes.alertRoutes);
    // V2 DELETED: Legacy integrations route mount - Google Calendar integration eliminated
    app.use('/api/tts', routes.ttsRoutes);
    app.use('/api/ai', routes.aiRoutes);
    app.use('/api/elevenlabs', routes.elevenLabsRoutes);
    app.use('/api/upload', routes.uploadRoutes);
    // V2: Legacy /api/agent route removed - using /api/company/:companyId/agent-settings V2 route
    app.use('/api/auth', routes.authRoutes); // AUTH: User authentication and JWT token management
    app.use('/api/admin', routes.adminRoutes);
    app.use('/api/v2global/admin', routes.v2GlobalAdminRoutes); // V2 Global Admin Dashboard
    app.use('/api/v2global/directory', routes.v2GlobalDirectoryRoutes); // V2 Global Company Directory
    app.use('/api/v2global/addcompany', routes.v2GlobalAddCompanyRoutes); // V2 Global Add Company
    app.use('/api/v2global/trade-categories', routes.v2GlobalTradeCategoriesRoutes); // V2 Global Trade Categories
    app.use('/api/backup', routes.backupRoutes); // BACKUP: Automated backup monitoring and management
    // V2 DELETED: Legacy company agent settings route - using V2 AI Agent Logic system
    // app.use('/api/company', routes.companyAgentSettingsRoutes); // ENTERPRISE: Company-specific AI Agent Settings Management
    
    // 🚀 V2 PURE SYSTEM: Only V2 Knowledge Management - ALL LEGACY ELIMINATED
    app.use('/api/company', routes.v2KnowledgeManagementRoutes); // V2 ENTERPRISE: Pure V2 Knowledge Management System (Company Q&A, Trade Q&A, Templates)
    app.use('/api/company', routes.knowledgeSourcePrioritiesRoutes); // ENTERPRISE: Knowledge Source Priorities Management
    // V2 DELETED: Legacy enterprise testing routes - using V2 AI Agent Logic system
    // app.use('/api/company', routes.priorityFlowTestingRoutes); // ENTERPRISE: Real-time Priority Flow Testing & Validation
    // app.use('/api/company', routes.agentTestingRoutes); // MODULE 3: AI Agent Testing Console
    // V2 DELETED: Legacy enhancedAgentSettings route mount - used external LLMs, violates in-house AI system

    // Register AI Agent routes
    app.use('/api/event-hooks', routes.eventHooksRoutes); // Event Hooks Management API
    app.use('/api/transfer-router', routes.transferRouterRoutes); // Transfer Router Management API

    // V2 DELETED: Legacy AI agent workflow and analytics route mounts - using V2 AI Agent Logic system
    // REMOVED: knowledge-auto-population routes - Replaced by comprehensive Company Q&A Management system
    // V2: Legacy AI agent route mounting removed - using modern v2profile-aiagentlogic system
    // V2: Legacy agentPerformance route deleted - using modern AI Agent Logic analytics
    // V2: Legacy intentRouting route deleted - using modern AI Agent Logic intent classification
    // V2: Legacy bookingScripts route deleted - using modern AI Agent Logic booking flow
    // V2: Legacy monitoring route deleted - using modern AI Agent Logic monitoring system
    app.use('/api/notes', routes.notesRoutes); // GOLD STANDARD: Enterprise Notes Management
    // V2: Legacy bookingHandler route deleted - using modern AI Agent Logic booking system
    // REMOVED: Legacy AI Intelligence routes - replaced by AI Agent Logic system
    // REMOVED: Legacy Enterprise AI Intelligence routes - archived to prevent external LLM dependencies
    // DELETED: Legacy enterprise trade categories route - replaced by V2 Global Trade Categories

    // Mount agent processor routes
    // V2: Legacy agentProcessor route deleted - using modern AI Agent Logic processing system

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

    // 🚨 GLOBAL REQUEST LOGGER for Twilio debugging
app.use('/api/twilio', (req, res, next) => {
    console.log('🌐 GLOBAL TWILIO REQUEST INTERCEPTED:', {
        timestamp: new Date().toISOString(),
        method: req.method,
        originalUrl: req.originalUrl,
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.headers['user-agent'],
        twilioSignature: req.headers['x-twilio-signature'],
        hasBody: !!req.body,
        bodySize: JSON.stringify(req.body || {}).length
    });
    next();
});

// 🚨 EMERGENCY: Log ALL incoming requests to catch hidden transfers
app.use((req, res, next) => {
    // Only log non-static requests to avoid spam
    if (!req.url.startsWith('/css/') && !req.url.startsWith('/js/') && !req.url.startsWith('/favicon')) {
        console.log('🚨 EMERGENCY REQUEST LOG:', {
            timestamp: new Date().toISOString(),
            method: req.method,
            url: req.url,
            originalUrl: req.originalUrl,
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.headers['user-agent'],
            referer: req.headers['referer'],
            isTwilio: req.headers['user-agent']?.includes('TwilioProxy') || req.headers['x-twilio-signature'],
            hasCallSid: !!(req.body && req.body.CallSid)
        });
    }
    next();
});
    
    // This line will now correctly handle all /api/twilio requests
    app.use('/api/twilio', routes.twilioRoutes);
    
    // REMOVED: Legacy CRM Management routes - will build V2 version in future
    
    // AI Agent Logic routes for enterprise features (Analytics, A/B Testing, etc.)
    app.use('/api/ai-agent-logic', routes.v2AIAgentLogicRoutes);
    app.use('/api', routes.v2AIAgentLogicRoutes); // V2 AI Agent Logic - Also mount for direct API access
    
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
        console.log(`[Server] ✅ Step 2 COMPLETE: Database connected in ${Date.now() - dbStart}ms`);
        
        // V2 DELETED: Legacy agent prompts loading - V2 uses aiAgentLogic system
        console.log('[Server] Step 3/6: Skipping legacy agent prompts (V2 uses aiAgentLogic)...');
        console.log(`[Server] ✅ Step 3 COMPLETE: Legacy agent prompts skipped - V2 system active`);
        
        console.log('[Server] Step 4/6: V2 DELETED - Legacy backup monitoring eliminated...');
        const backupStart = Date.now();
        // V2 DELETED: Legacy BackupMonitoringService - enterprise bloat eliminated
        // const backupMonitoring = new BackupMonitoringService();
        // backupMonitoring.start();
        logger.info('🔄 V2 SYSTEM: Backup monitoring service eliminated - using simple V2 architecture');
        console.log(`[Server] ✅ Step 4 COMPLETE: Legacy backup monitoring eliminated in ${Date.now() - backupStart}ms`);
        
        console.log('[Server] Step 5/6: Preparing to bind to port...');
        const PORT = process.env.PORT || 3000;
        console.log(`[Server] Target port: ${PORT}, bind address: 0.0.0.0`);
        
        console.log('[Server] Step 6/6: Starting HTTP server...');
        const serverStart = Date.now();
        
        return app.listen(PORT, '0.0.0.0', () => {
            console.log(`[Server] ✅ Step 6 COMPLETE: HTTP server bound in ${Date.now() - serverStart}ms`);
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
