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
const aiRoutes = require('./routes/ai'); // New AI routes
const testRoutes = require('./routes/test'); // New test routes
const elevenLabsRoutes = require('./routes/elevenLabs'); // New ElevenLabs routes
const uploadRoutes = require('./routes/upload');
const workflowRoutes = require('./routes/workflows'); // New workflow routes
const testWorkflowRoutes = require('./routes/test-workflows'); // Test workflow routes
const learningRoutes = require('./routes/learning'); // Learning management routes

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
app.use('/api/ai', aiRoutes); // Registering the new /api/ai route
app.use('/api/test', testRoutes); // Registering the new /api/test route
app.use('/api/elevenlabs', elevenLabsRoutes); // Registering the new /api/elevenlabs route
app.use('/api/upload', uploadRoutes);
app.use('/api/workflows', workflowRoutes); // Registering the new /api/workflows route
app.use('/api/test-workflows', testWorkflowRoutes); // Test workflow routes
app.use('/api/learning', learningRoutes); // Learning management routes
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
