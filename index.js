require('dotenv').config(); // This MUST be the first line

// Initialize Sentry for error monitoring (must be early)
const { initializeSentry, getSentryRequestHandler, getSentryErrorHandler } = require('./utils/sentry');
initializeSentry();

// Initialize logger early
const logger = require('./utils/logger');
logger.info('--- STARTING CLIENTSVIA BACKEND SERVER - PRODUCTION BUILD ---');
// admin-dashboard/index.js (Main Express Server)

// Import necessary modules
const express = require('express');
const path = require('path');

// Initialize shared clients (Redis, Pinecone)
require('./clients');

// Import database connection logic
const { connectDB } = require('./db');
const AgentPromptService = require('./services/agentPromptsService');
const BackupMonitoringService = require('./services/backupMonitoringService');

// Import API routes
const companyRoutes = require('./routes/company');
const tradeCategoryRoutes = require('./routes/tradeCategories');
const alertRoutes = require('./routes/alerts');
const integrationsRoutes = require('./routes/integrations');
const ttsRoutes = require('./routes/tts');
const companyQnaRoutes = require('./routes/companyQna');
const suggestionRoutes = require('./routes/suggestions');
const twilioRoutes = require('./routes/twilio');
const aiRoutes = require('./routes/ai');
const elevenLabsRoutes = require('./routes/elevenLabs');
const uploadRoutes = require('./routes/upload');
const learningRoutes = require('./routes/learning');
const agentSettingsRoutes = require('./routes/agentSettings'); // ENTERPRISE: AI Agent Settings
const companyAgentSettingsRoutes = require('./routes/company/agentSettings'); // ENTERPRISE: Company-specific AI Agent Settings
const companyPersonalityRoutes = require('./routes/company/personality'); // MODULE 1: Agent Personality Settings
const companyKnowledgeRoutes = require('./routes/company/knowledge'); // MODULE 2: Knowledge Q&A Source Controls
const agentTestingRoutes = require('./routes/company/agentTesting'); // MODULE 3: AI Agent Testing Console

// Import new AI Agent routes
const eventHooksRoutes = require('./routes/eventHooks'); // Event Hooks Management
const transferRouterRoutes = require('./routes/transferRouter'); // Transfer Router Management

// 🚀 ENHANCED AI AGENT LOGIC - Module Components
const pendingQnARoutes = require('./routes/company/pendingQnA'); // MODULE 4: Self-Learning Knowledge Base Approval
const enhancedAgentSettingsRoutes = require('./routes/company/enhancedAgentSettings'); // Enhanced LLM Selector & Agent Settings

const aiAgentWorkflowRoutes = require('./routes/aiAgentWorkflows');
const aiAgentAnalyticsRoutes = require('./routes/aiAgentAnalytics');
const knowledgeAutoPopulationRoutes = require('./routes/knowledgeAutoPopulation');
const enhancedAIAgentRoutes = require('./routes/enhancedAIAgent');
const aiAgentHandlerRoutes = require('./routes/aiAgentHandler');
const agentPerformanceRoutes = require('./routes/agentPerformance');
const intentRoutingRoutes = require('./routes/intentRouting'); // Intent Routing & Flow Control
const bookingScriptsRoutes = require('./routes/bookingScripts'); // Booking Scripts Configuration
const bookingHandlerRoutes = require('./routes/bookingHandler'); // Booking Handler API
const aiIntelligenceRoutes = require('./routes/aiIntelligence'); // AI Intelligence Engine
const monitoringRoutes = require('./routes/monitoring'); // Agent Monitoring System
const notesRoutes = require('./routes/notes'); // GOLD STANDARD: Enterprise Notes Management
const agentProcessorRoutes = require('./routes/agentProcessor'); // NEW: Central agent processing
const adminRoutes = require('./routes/admin'); // ADMIN: Authentication-protected admin endpoints
const authRoutes = require('./routes/auth'); // AUTH: User authentication and JWT management
const backupRoutes = require('./routes/backup'); // BACKUP: Automated backup monitoring and management

// Initialize Express app
const app = express();

// --- Sentry Middleware (must be first) ---
app.use(getSentryRequestHandler());

// --- Middleware ---
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

// --- Enhanced Health Check Endpoint ---
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

// --- Database Connection and Server Start ---
async function startServer() {
    try {
        await connectDB();
        await AgentPromptService.loadAll();
        
        // Initialize backup monitoring service for production readiness
        const backupMonitoring = new BackupMonitoringService();
        backupMonitoring.start();
        logger.info('🔄 Backup monitoring service initialized');
        
        const PORT = process.env.PORT || 4000;
        return app.listen(PORT, () => {
            console.log(`Admin dashboard listening at http://localhost:${PORT}`);
            console.log(`Node environment: ${process.env.NODE_ENV || 'development'}`);
        });
    } catch (err) {
        console.error('[Server Startup] Failed to connect to DB, server not started.', err);
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
