/**
 * ClientsVia Backend Application
 * 
 * 🤖 AI ROUTING REFERENCE:
 * For troubleshooting AI agent routing issues, see: /AI_ROUTING_REFERENCE.js
 * Company Q&A system routes: /routes/aiAgentLogic.js (Priority #1 source)
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const redis = require('redis');
// V2 DELETED: Passport - using JWT-only authentication system
// const passport = require('./config/passport');

const logger = require('./utils/logger');
const { secureHeaders, additionalSecurityHeaders, addRateLimitHeaders } = require('./middleware/helmet');
const { apiLimiter } = require('./middleware/rateLimit');

// V2 DELETED: Legacy AI agent routes - using V2 AI Agent Logic system
// const aiAgentWorkflowRoutes = require('./routes/aiAgentWorkflows');
// const aiAgentAnalyticsRoutes = require('./routes/aiAgentAnalytics');
// const knowledgeAutoPopulationRoutes = require('./routes/knowledgeAutoPopulation');
// const enhancedAIAgentRoutes = require('./routes/enhancedAIAgent');
// const aiAgentHandlerRoutes = require('./routes/aiAgentHandler');

// V2 DELETED: Legacy v2 routes - using V2 AI Agent Logic system
// const knowledgeLifecycleRoutes = require('./routes/knowledgeLifecycle');
// const v2AnalyticsRoutes = require('./routes/v2Analytics');

// DELETED: Legacy V2 Trade Categories - replaced by V2 Global Trade Categories system

// V2 DELETED: Legacy agentSettings routes - using V2 AI Agent Logic system

const app = express();

// Parse cookies before any middleware that relies on them
app.use(cookieParser());                // For JWT in cookies
app.use(secureHeaders);                 // Helmet/CSP
app.use(additionalSecurityHeaders);     // Additional production security headers
app.use(addRateLimitHeaders);           // Rate limit headers
app.use(cors({ origin: false }));       // Restrict origins
app.use(apiLimiter);                    // Rate limiting
app.use(express.json());                // Body parsing

// Serve static files from public directory with no-cache for HTML files
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            // Force HTML files to never cache
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));
logger.info('✅ Static files served from /public directory (HTML files: no-cache)');

// TEMPORARILY DISABLE REDIS FOR DEBUGGING
logger.warn('⚠️ Redis disabled for debugging - using memory store only');
logger.info('🔍 PRE-SESSION CHECKPOINT: About to configure session...');

logger.info('🔍 CHECKPOINT 1: Starting session configuration...');
logger.info(`SESSION_SECRET exists: ${Boolean(process.env.SESSION_SECRET)}`);
logger.info(`NODE_ENV: ${process.env.NODE_ENV}`);

// 🚨 CRITICAL PRODUCTION FIX: Redis session store for production scaling
logger.info('🔍 CHECKPOINT 2: Creating Redis session store for production...');

// Initialize Redis client for sessions (rename to avoid shadowing)
const sessionRedisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

sessionRedisClient.on('error', (err) => {
  logger.error('❌ CRITICAL: Redis session store error', { error: err.message });
});

sessionRedisClient.on('connect', () => {
  logger.info('✅ PRODUCTION: Redis session store connected successfully');
});

// Connect to Redis
sessionRedisClient.connect().catch(err => {
  logger.error('❌ CRITICAL: Failed to connect Redis session store', { error: err.message });
});

app.use(session({
  store: new RedisStore({ client: sessionRedisClient }),
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
logger.info('✅ PRODUCTION: Redis session store configured - memory leaks eliminated!');

// V2 DELETED: Passport initialization - using JWT-only authentication system
// console.log('🔍 CHECKPOINT 4: Initializing Passport...');
// app.use(passport.initialize());
// console.log('🔍 CHECKPOINT 5: Passport initialized');
// app.use(passport.session());
// console.log('🔍 CHECKPOINT 6: Passport session middleware applied');

logger.info('🔍 CHECKPOINT 7: Connecting to MongoDB...');

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// app.use('/api/auth', authRoutes); // MISSING FILE

// 🗑️ DELETED: V2 Knowledge Management routes (AI Agent Logic tab removed)
// 🗑️ DELETED: V2 Placeholders routes (AI Agent Logic tab removed)

// 🗑️ DELETED: V2 Twilio Control Center routes (moved to index.js for consistency)
// 🗑️ DELETED: V2 Connection Messages routes (moved to index.js for consistency)

// 🗑️ DELETED: V2 Instant Responses routes - replaced by InstantResponseCategories system in Knowledge Management

// V2 DELETED: Local Company Q&A routes - using main Company Q&A system instead
// Main Company Q&A system (via v2knowledgeManagement.js) is working perfectly

// 🗑️ DELETED: Quick Variables - Replaced by Placeholders in AI Agent Logic tab

// app.use('/api/company', companyRoutes); // MISSING FILE
// app.use('/api/company', settingsRoutes); // MISSING FILE

// V2 DELETED: Legacy AI agent route mounts - using V2 AI Agent Logic system
// app.use('/api/ai-agent-workflows', aiAgentWorkflowRoutes);
// app.use('/api/ai-agent-analytics', aiAgentAnalyticsRoutes);
// app.use('/api/knowledge-auto-population', knowledgeAutoPopulationRoutes);
// app.use('/api/enhanced-ai-agent', enhancedAIAgentRoutes);
// app.use('/api/ai-agent', aiAgentHandlerRoutes);
// app.use('/api/monitoring', monitoringRoutes); // MISSING FILE
// Local LLM routes removed - cloud-only LLM approach
// app.use('/api/llm', llmRoutes); // MISSING FILE
// app.use('/api/booking', bookingRoutes); // MISSING FILE
// app.use('/api/transfer', transferRoutes); // MISSING FILE
// app.use('/api/notes', notesRoutes); // MISSING FILE - using v2notes.js instead
// V2 DELETED: Legacy /api/agent route mount - using V2 AI Agent Logic system
// app.use('/api/event-hooks', eventHooksRoutes); // MISSING FILE
// app.use('/api/notifications', notificationRoutes); // MISSING FILE
// app.use('/api/qna-learning', qnaLearningRoutes); // MISSING FILE

// V2 DELETED: Legacy V2 AI Intelligence routes - using V2 AI Agent Logic system
// let v2AIIntelligenceRoutes;
// try {
//   v2AIIntelligenceRoutes = require('./routes/v2AIIntelligence');
//   app.use('/api/v2-ai', v2AIIntelligenceRoutes);
// } catch (error) {
//   console.error('Failed to load V2 AI Intelligence routes:', error.message);
//   process.exit(1);
// }

// V2 DELETED: Legacy V2 Knowledge Lifecycle Management - using V2 AI Agent Logic system
// app.use('/api/knowledge-lifecycle', knowledgeLifecycleRoutes);

// 🚀 V2 PURE SYSTEM: Legacy knowledge routes ELIMINATED - using V2 Knowledge Management only
// V2 Knowledge Management handles ALL knowledge operations through /api/company endpoints
logger.info('✅ V2 PURE SYSTEM: Legacy knowledge routes eliminated - V2 Knowledge Management active');

// V2 DELETED: Legacy V2 Analytics and Reporting - using V2 AI Agent Logic system
// app.use('/api/v2-analytics', v2AnalyticsRoutes);

// DELETED: Legacy V2 Trade Categories route - replaced by V2 Global Trade Categories system

// Company Q&A Seeding (Production Testing)
// V2 DELETED: Legacy seed-company-qna-production routes - using V2 Knowledge Management system
// app.use('/api', seedCompanyQnARoutes);
// console.log('✅ Company Q&A seeding routes registered at /api/seed-company-qna and /api/test-company-qna');

// 🗑️ DELETED: AI Agent Logic routes (tab removed)

// Admin routes for system management
// try {
//     const adminRoutes = require('./routes/admin'); // MISSING FILE
//     app.use('/api/admin', adminRoutes);
//     logger.info('✅ Admin management routes loaded');
// } catch (error) {
//     logger.error('❌ Failed to load admin routes', { error: error.message });
// }

// 🌐 GLOBAL INSTANT RESPONSE TEMPLATES - World-Class AI Agent Brain
try {
    const globalInstantResponsesRoutes = require('./routes/admin/globalInstantResponses');
    app.use('/api/admin/global-instant-responses', globalInstantResponsesRoutes);
    logger.info('✅ Global Instant Response Templates routes registered - AI Agent brain management active');
} catch (error) {
    logger.error('❌ Failed to load Global Instant Response routes:', error);
}

// Global AI Brain - Twilio Test Routes
logger.info('🔍 [APP.JS] Attempting to load Global AI Brain Test routes...');
try {
    const globalAIBrainTestRoutes = require('./routes/admin/globalAIBrainTest');
    logger.info('🔍 [APP.JS] Route file loaded successfully');
    app.use('/api/admin/global-ai-brain-test', globalAIBrainTestRoutes);
    logger.info('✅ [APP.JS] Global AI Brain Test routes registered at /api/admin/global-ai-brain-test');
} catch (error) {
    logger.error('❌ [APP.JS] Failed to load Global AI Brain Test routes', { 
        error: error.message, 
        stack: error.stack,
        name: error.name 
    });
}

// Admin Notification Settings Routes
try {
    const adminNotificationRoutes = require('./routes/admin/adminNotifications');
    app.use('/api/admin', adminNotificationRoutes);
    logger.info('✅ Admin Notification Settings routes registered - Alert Center notifications active');
} catch (error) {
    logger.error('❌ Failed to load Admin Notification routes:', error);
}

// 🚀 AI GATEWAY - Routes will be added here after new system is built
// (Placeholder for AI Gateway routes)

// Add simplified AI Agent Logic routes as fallback (no auth required for basic functionality)
// try {
//     const aiAgentLogicSimpleRoutes = require('./routes/aiAgentLogicSimple'); // MISSING FILE
//     app.use('/api/simple', aiAgentLogicSimpleRoutes); // Simple routes without complex auth
//     logger.info('✅ AI Agent Logic Simple routes loaded as fallback');
// } catch {
//     logger.info('ℹ️ AI Agent Logic Simple routes not found (optional)');
// }

// 🚀 V2 GLOBAL SYSTEM ROUTES - V2 Multi-Tenant Platform
try {
    const v2GlobalTradeCategories = require('./routes/v2global/v2global-tradecategories');
    app.use('/api/v2global/trade-categories', v2GlobalTradeCategories);
    logger.info('✅ V2 Global Trade Categories routes registered at /api/v2global/trade-categories');
} catch (error) {
    logger.error('❌ Failed to load V2 Global Trade Categories routes', { error: error.message });
}

// REMOVED: Legacy v2global-directory and v2global-addcompany routes - replaced with new streamlined versions

// 🚀 V2 PURE SYSTEM: All legacy development routes ELIMINATED
// Legacy services deleted: calendarService, actionService, serviceIssueHandler, selfCheckLogger, agentMessageProcessor
// Using V2 AI Agent Runtime only - no legacy contamination

app.get('/healthz', (req, res) => res.json({ ok: true }));

module.exports = app;
