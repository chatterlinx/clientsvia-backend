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

// Import API routes
console.log('[INIT] Loading API routes...');

console.log('[INIT] Loading companyRoutes...');
const companyRoutes = require('./routes/company');
console.log('[INIT] ✅ companyRoutes loaded');

console.log('[INIT] Loading tradeCategoryRoutes...');
const tradeCategoryRoutes = require('./routes/tradeCategories');
console.log('[INIT] ✅ tradeCategoryRoutes loaded');

console.log('[INIT] Loading alertRoutes...');
const alertRoutes = require('./routes/alerts');
console.log('[INIT] ✅ alertRoutes loaded');

console.log('[INIT] Loading integrationsRoutes...');
const integrationsRoutes = require('./routes/integrations');
console.log('[INIT] ✅ integrationsRoutes loaded');

console.log('[INIT] Loading ttsRoutes...');
const ttsRoutes = require('./routes/tts');
console.log('[INIT] ✅ ttsRoutes loaded');

console.log('[INIT] Loading companyQnaRoutes...');
const companyQnaRoutes = require('./routes/companyQna');
console.log('[INIT] ✅ companyQnaRoutes loaded');

console.log('[INIT] Loading suggestionRoutes...');
const suggestionRoutes = require('./routes/suggestions');
console.log('[INIT] ✅ suggestionRoutes loaded');

console.log('[INIT] Loading twilioRoutes...');
const twilioRoutes = require('./routes/twilio');
console.log('[INIT] ✅ twilioRoutes loaded');

console.log('[INIT] Loading aiRoutes...');
const aiRoutes = require('./routes/ai');
console.log('[INIT] ✅ aiRoutes loaded');

console.log('[INIT] Loading elevenLabsRoutes...');
const elevenLabsRoutes = require('./routes/elevenLabs');
console.log('[INIT] ✅ elevenLabsRoutes loaded');

console.log('[INIT] Loading uploadRoutes...');
const uploadRoutes = require('./routes/upload');
console.log('[INIT] ✅ uploadRoutes loaded');

console.log('[INIT] Loading learningRoutes...');
const learningRoutes = require('./routes/learning');
console.log('[INIT] ✅ learningRoutes loaded');

console.log('[INIT] Loading agentSettingsRoutes...');
const agentSettingsRoutes = require('./routes/agentSettings'); // ENTERPRISE: AI Agent Settings
console.log('[INIT] ✅ agentSettingsRoutes loaded');

console.log('[INIT] Loading companyAgentSettingsRoutes...');
const companyAgentSettingsRoutes = require('./routes/company/agentSettings'); // ENTERPRISE: Company-specific AI Agent Settings
console.log('[INIT] ✅ companyAgentSettingsRoutes loaded');

console.log('[INIT] Loading companyPersonalityRoutes...');
const companyPersonalityRoutes = require('./routes/company/personality'); // MODULE 1: Agent Personality Settings
console.log('[INIT] ✅ companyPersonalityRoutes loaded');

console.log('[INIT] Loading companyKnowledgeRoutes...');
const companyKnowledgeRoutes = require('./routes/company/knowledge'); // MODULE 2: Knowledge Q&A Source Controls
console.log('[INIT] ✅ companyKnowledgeRoutes loaded');

console.log('[INIT] Loading agentTestingRoutes...');
const agentTestingRoutes = require('./routes/company/agentTesting'); // MODULE 3: AI Agent Testing Console
console.log('[INIT] ✅ agentTestingRoutes loaded');

// Import new AI Agent routes
console.log('[INIT] Loading eventHooksRoutes...');
const eventHooksRoutes = require('./routes/eventHooks'); // Event Hooks Management
console.log('[INIT] ✅ eventHooksRoutes loaded');

console.log('[INIT] Loading transferRouterRoutes...');
const transferRouterRoutes = require('./routes/transferRouter'); // Transfer Router Management
console.log('[INIT] ✅ transferRouterRoutes loaded');

// 🚀 ENHANCED AI AGENT LOGIC - Module Components
console.log('[INIT] Loading pendingQnARoutes...');
const pendingQnARoutes = require('./routes/company/pendingQnA'); // MODULE 4: Self-Learning Knowledge Base Approval
console.log('[INIT] ✅ pendingQnARoutes loaded');

console.log('[INIT] Loading enhancedAgentSettingsRoutes...');
const enhancedAgentSettingsRoutes = require('./routes/company/enhancedAgentSettings'); // Enhanced LLM Selector & Agent Settings
console.log('[INIT] ✅ enhancedAgentSettingsRoutes loaded');

console.log('[INIT] Loading aiAgentWorkflowRoutes...');
const aiAgentWorkflowRoutes = require('./routes/aiAgentWorkflows');
console.log('[INIT] ✅ aiAgentWorkflowRoutes loaded');

console.log('[INIT] Loading aiAgentAnalyticsRoutes...');
const aiAgentAnalyticsRoutes = require('./routes/aiAgentAnalytics');
console.log('[INIT] ✅ aiAgentAnalyticsRoutes loaded');

console.log('[INIT] Loading knowledgeAutoPopulationRoutes...');
const knowledgeAutoPopulationRoutes = require('./routes/knowledgeAutoPopulation');
console.log('[INIT] ✅ knowledgeAutoPopulationRoutes loaded');

console.log('[INIT] Loading enhancedAIAgentRoutes...');
const enhancedAIAgentRoutes = require('./routes/enhancedAIAgent');
console.log('[INIT] ✅ enhancedAIAgentRoutes loaded');

console.log('[INIT] Loading aiAgentHandlerRoutes...');
const aiAgentHandlerRoutes = require('./routes/aiAgentHandler');
console.log('[INIT] ✅ aiAgentHandlerRoutes loaded');

console.log('[INIT] Loading agentPerformanceRoutes...');
const agentPerformanceRoutes = require('./routes/agentPerformance');
console.log('[INIT] ✅ agentPerformanceRoutes loaded');

console.log('[INIT] Loading intentRoutingRoutes...');
const intentRoutingRoutes = require('./routes/intentRouting'); // Intent Routing & Flow Control
console.log('[INIT] ✅ intentRoutingRoutes loaded');

console.log('[INIT] Loading bookingScriptsRoutes...');
const bookingScriptsRoutes = require('./routes/bookingScripts'); // Booking Scripts Configuration
console.log('[INIT] ✅ bookingScriptsRoutes loaded');

console.log('[INIT] Loading bookingHandlerRoutes...');
const bookingHandlerRoutes = require('./routes/bookingHandler'); // Booking Handler API
console.log('[INIT] ✅ bookingHandlerRoutes loaded');

console.log('[INIT] Loading aiIntelligenceRoutes...');
const aiIntelligenceRoutes = require('./routes/aiIntelligence'); // AI Intelligence Engine
console.log('[INIT] ✅ aiIntelligenceRoutes loaded');

console.log('[INIT] Loading monitoringRoutes...');
const monitoringRoutes = require('./routes/monitoring'); // Agent Monitoring System
console.log('[INIT] ✅ monitoringRoutes loaded');

console.log('[INIT] Loading notesRoutes...');
const notesRoutes = require('./routes/notes'); // GOLD STANDARD: Enterprise Notes Management
console.log('[INIT] ✅ notesRoutes loaded');

console.log('[INIT] Loading agentProcessorRoutes...');
const agentProcessorRoutes = require('./routes/agentProcessor'); // NEW: Central agent processing
console.log('[INIT] ✅ agentProcessorRoutes loaded');

console.log('[INIT] Loading adminRoutes...');
const adminRoutes = require('./routes/admin'); // ADMIN: Authentication-protected admin endpoints
console.log('[INIT] ✅ adminRoutes loaded');

console.log('[INIT] Loading authRoutes...');
const authRoutes = require('./routes/auth'); // AUTH: User authentication and JWT management
console.log('[INIT] ✅ authRoutes loaded');

console.log('[INIT] Loading backupRoutes...');
const backupRoutes = require('./routes/backup'); // BACKUP: Automated backup monitoring and management
console.log('[INIT] ✅ backupRoutes loaded');

console.log('[INIT] ✅ All routes loaded successfully');

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

// --- API Routes ---
app.use('/api', companyRoutes);
app.use('/api/trade-categories', tradeCategoryRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/suggestions', suggestionRoutes);
app.use('/api/company/:companyId/qna', companyQnaRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/elevenlabs', elevenLabsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/learning', learningRoutes);
app.use('/api/agent', agentSettingsRoutes); // ENTERPRISE: AI Agent Settings Management
app.use('/api/auth', authRoutes); // AUTH: User authentication and JWT token management
app.use('/api/admin', adminRoutes); // ADMIN: Authentication-protected endpoints (companies, alerts, suggestions)
app.use('/api/backup', backupRoutes); // BACKUP: Automated backup monitoring and management
app.use('/api/company', companyAgentSettingsRoutes); // ENTERPRISE: Company-specific AI Agent Settings Management
app.use('/api/company', companyPersonalityRoutes); // MODULE 1: Agent Personality Settings
app.use('/api/company', companyKnowledgeRoutes); // MODULE 2: Knowledge Q&A Source Controls
app.use('/api/company', agentTestingRoutes); // MODULE 3: AI Agent Testing Console
app.use('/api/company', pendingQnARoutes); // MODULE 4: Self-Learning Knowledge Base Approval
app.use('/api/company', enhancedAgentSettingsRoutes); // Enhanced LLM Selector & Agent Settings

// Register AI Agent routes
app.use('/api/event-hooks', eventHooksRoutes); // Event Hooks Management API
app.use('/api/transfer-router', transferRouterRoutes); // Transfer Router Management API

app.use('/api/ai-agent-workflows', aiAgentWorkflowRoutes);
app.use('/api/ai-agent-analytics', aiAgentAnalyticsRoutes);
app.use('/api/knowledge-auto-population', knowledgeAutoPopulationRoutes);
app.use('/api/enhanced-ai-agent', enhancedAIAgentRoutes);
app.use('/api/ai-agent', aiAgentHandlerRoutes);
app.use('/api/agent', agentPerformanceRoutes);
app.use('/api/agent', intentRoutingRoutes); // Intent Routing & Flow Control routes
app.use('/api/booking-scripts', bookingScriptsRoutes); // Booking Scripts Configuration
app.use('/api/monitoring', monitoringRoutes); // Agent Monitoring System
app.use('/api/notes', notesRoutes); // GOLD STANDARD: Enterprise Notes Management
app.use('/api/booking-handler', bookingHandlerRoutes); // Booking Handler API for testing and integration
app.use('/api/ai-intelligence', aiIntelligenceRoutes); // AI Intelligence Engine routes

// Mount agent processor routes
app.use('/api/agent', agentProcessorRoutes); // NEW: Central agent processing API

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
app.use('/api/twilio', twilioRoutes);
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
        
        console.log('[Server] Step 1/5: Starting database connection...');
        const dbStart = Date.now();
        await connectDB();
        console.log(`[Server] ✅ Step 1 COMPLETE: Database connected in ${Date.now() - dbStart}ms`);
        
        console.log('[Server] Step 2/5: Loading agent prompts...');
        const promptStart = Date.now();
        
        // Add timeout to prevent hanging
        const promptTimeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('AgentPromptService.loadAll() timed out after 30 seconds')), 30000)
        );
        
        await Promise.race([AgentPromptService.loadAll(), promptTimeout]);
        console.log(`[Server] ✅ Step 2 COMPLETE: Agent prompts loaded in ${Date.now() - promptStart}ms`);
        
        console.log('[Server] Step 3/5: Initializing backup monitoring...');
        const backupStart = Date.now();
        const backupMonitoring = new BackupMonitoringService();
        backupMonitoring.start();
        logger.info('🔄 Backup monitoring service initialized');
        console.log(`[Server] ✅ Step 3 COMPLETE: Backup monitoring initialized in ${Date.now() - backupStart}ms`);
        
        console.log('[Server] Step 4/5: Preparing to bind to port...');
        const PORT = process.env.PORT || 3000;
        console.log(`[Server] Target port: ${PORT}, bind address: 0.0.0.0`);
        
        console.log('[Server] Step 5/5: Starting HTTP server...');
        const serverStart = Date.now();
        
        return app.listen(PORT, '0.0.0.0', () => {
            console.log(`[Server] ✅ Step 5 COMPLETE: HTTP server bound in ${Date.now() - serverStart}ms`);
            console.log(`🎉 SERVER FULLY OPERATIONAL!`);
            console.log(`🌐 Admin dashboard listening at http://0.0.0.0:${PORT}`);
            console.log(`📊 Node environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🎯 Server ready to accept connections on port ${PORT}`);
            console.log(`⏱️  Total startup time: ${Date.now() - dbStart}ms`);
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
