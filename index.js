require('dotenv').config(); // This MUST be the first line

console.log('--- EXECUTING LATEST INDEX.JS - V7 ---');
// admin-dashboard/index.js (Main Express Server)

// Import necessary modules
const express = require('express');
const path = require('path');

// Initialize shared clients (Redis, Pinecone)
require('./clients');

// Import database connection logic
const { connectDB } = require('./db');
const AgentPromptService = require('./services/agentPromptsService');

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

// Import new AI Agent routes
const eventHooksRoutes = require('./routes/eventHooks'); // Event Hooks Management
const transferRouterRoutes = require('./routes/transferRouter'); // Transfer Router Management

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

// Initialize Express app
const app = express();

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
app.use('/api/company', companyAgentSettingsRoutes); // ENTERPRISE: Company-specific AI Agent Settings Management
app.use('/api/company', companyPersonalityRoutes); // MODULE 1: Agent Personality Settings

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

// Health check endpoint
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

module.exports = { app, startServer };
