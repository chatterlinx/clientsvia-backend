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
const passport = require('./config/passport');

const { secureHeaders } = require('./middleware/helmet');
const { apiLimiter } = require('./middleware/rateLimit');

const uploadRoutes = require("./routes/upload");
const authRoutes = require('./routes/auth');
const companyRoutes = require('./routes/company');
const settingsRoutes = require('./routes/settings');

// V2 DELETED: Legacy AI agent routes - using V2 AI Agent Logic system
// const aiAgentWorkflowRoutes = require('./routes/aiAgentWorkflows');
// const aiAgentAnalyticsRoutes = require('./routes/aiAgentAnalytics');
// const knowledgeAutoPopulationRoutes = require('./routes/knowledgeAutoPopulation');
// const enhancedAIAgentRoutes = require('./routes/enhancedAIAgent');
// const aiAgentHandlerRoutes = require('./routes/aiAgentHandler');
const monitoringRoutes = require('./routes/monitoring');
// Local LLM routes removed - cloud-only LLM approach
const llmRoutes = require('./routes/llm');
const bookingRoutes = require('./routes/booking');
const transferRoutes = require('./routes/transfer');
const notesRoutes = require('./routes/notes'); // GOLD STANDARD: V2 Notes API

// V2 DELETED: Legacy enterprise routes - using V2 AI Agent Logic system
// const knowledgeLifecycleRoutes = require('./routes/knowledgeLifecycle');
// const enterpriseAnalyticsRoutes = require('./routes/enterpriseAnalytics');

// DELETED: Legacy Enterprise Trade Categories - replaced by V2 Global Trade Categories system

// V2 DELETED: Legacy agentSettings routes - using V2 AI Agent Logic system

// Event Hooks and Notification System Routes with error handling
let eventHooksRoutes, notificationRoutes;
try {
  eventHooksRoutes = require('./routes/eventHooks');
  console.log('✅ Event Hooks routes loaded successfully');
} catch (error) {
  console.error('❌ Failed to load Event Hooks routes:', error.message);
  process.exit(1);
}

try {
  notificationRoutes = require('./routes/notifications');
  console.log('✅ Notification routes loaded successfully');
} catch (error) {
  console.error('❌ Failed to load Notification routes:', error.message);
  process.exit(1);
}

// Q&A Learning System Routes with error handling
let qnaLearningRoutes;
try {
  qnaLearningRoutes = require('./routes/qna-learning');
  console.log('✅ Q&A Learning routes loaded successfully');
} catch (error) {
  console.error('❌ Failed to load Q&A Learning routes:', error.message);
  process.exit(1);
}

const app = express();

// Parse cookies before any middleware that relies on them
app.use(cookieParser());          // For JWT in cookies
app.use(secureHeaders);           // Helmet/CSP
app.use(cors({ origin: false })); // Restrict origins
app.use(apiLimiter);              // Rate limiting
app.use(express.json());          // Body parsing

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));
console.log('✅ Static files served from /public directory');

// TEMPORARILY DISABLE REDIS FOR DEBUGGING
console.log('⚠️ Redis disabled for debugging - using memory store only');
console.log('🔍 PRE-SESSION CHECKPOINT: About to configure session...');

console.log('🔍 CHECKPOINT 1: Starting session configuration...');
console.log('SESSION_SECRET exists:', !!process.env.SESSION_SECRET);
console.log('NODE_ENV:', process.env.NODE_ENV);

// 🚨 CRITICAL PRODUCTION FIX: Redis session store for production scaling
console.log('🔍 CHECKPOINT 2: Creating Redis session store for production...');

// Initialize Redis client for sessions
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => {
  console.error('❌ CRITICAL: Redis session store error:', err);
});

redisClient.on('connect', () => {
  console.log('✅ PRODUCTION: Redis session store connected successfully');
});

// Connect to Redis
redisClient.connect().catch(err => {
  console.error('❌ CRITICAL: Failed to connect Redis session store:', err);
});

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
console.log('✅ PRODUCTION: Redis session store configured - memory leaks eliminated!');

// Initialize Passport
console.log('🔍 CHECKPOINT 4: Initializing Passport...');
app.use(passport.initialize());
console.log('🔍 CHECKPOINT 5: Passport initialized');
app.use(passport.session());
console.log('🔍 CHECKPOINT 6: Passport session middleware applied');

console.log('🔍 CHECKPOINT 7: Connecting to MongoDB...');

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

app.use('/api/auth', authRoutes);

// 🚀 V2 KNOWLEDGE MANAGEMENT ROUTES - Enterprise Multi-Tenant Platform
// CRITICAL: Must be mounted BEFORE main company routes to avoid route conflicts
try {
    const v2KnowledgeManagementRoutes = require('./routes/company/v2knowledgeManagement');
    app.use('/api/company', v2KnowledgeManagementRoutes);
    console.log('✅ V2 Knowledge Management routes registered at /api/company - Trade Q&A system active');
} catch (error) {
    console.error('❌ Failed to load V2 Knowledge Management routes:', error);
}

app.use('/api/company', companyRoutes);
app.use('/api/company', settingsRoutes);

// V2 DELETED: Legacy AI agent route mounts - using V2 AI Agent Logic system
// app.use('/api/ai-agent-workflows', aiAgentWorkflowRoutes);
// app.use('/api/ai-agent-analytics', aiAgentAnalyticsRoutes);
// app.use('/api/knowledge-auto-population', knowledgeAutoPopulationRoutes);
// app.use('/api/enhanced-ai-agent', enhancedAIAgentRoutes);
// app.use('/api/ai-agent', aiAgentHandlerRoutes);
app.use('/api/monitoring', monitoringRoutes);
// Local LLM routes removed - cloud-only LLM approach
app.use('/api/llm', llmRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/transfer', transferRoutes);
app.use('/api/notes', notesRoutes); // GOLD STANDARD: V2 Notes Management
// V2 DELETED: Legacy /api/agent route mount - using V2 AI Agent Logic system
app.use('/api/event-hooks', eventHooksRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/qna-learning', qnaLearningRoutes);

// V2 DELETED: Legacy Enterprise AI Intelligence routes - using V2 AI Agent Logic system
// let enterpriseAIIntelligenceRoutes;
// try {
//   enterpriseAIIntelligenceRoutes = require('./routes/enterpriseAIIntelligence');
//   app.use('/api/enterprise-ai', enterpriseAIIntelligenceRoutes);
// } catch (error) {
//   console.error('Failed to load Enterprise AI Intelligence routes:', error.message);
//   process.exit(1);
// }

// V2 DELETED: Legacy Enterprise Knowledge Lifecycle Management - using V2 AI Agent Logic system
// app.use('/api/knowledge-lifecycle', knowledgeLifecycleRoutes);

// 🚀 V2 PURE SYSTEM: Legacy knowledge routes ELIMINATED - using V2 Knowledge Management only
// V2 Knowledge Management handles ALL knowledge operations through /api/company endpoints
console.log('✅ V2 PURE SYSTEM: Legacy knowledge routes eliminated - V2 Knowledge Management active');

// V2 DELETED: Legacy Enterprise Analytics and Reporting - using V2 AI Agent Logic system
// app.use('/api/enterprise-analytics', enterpriseAnalyticsRoutes);

// DELETED: Legacy Enterprise Trade Categories route - replaced by V2 Global Trade Categories system

// Company Q&A Seeding (Production Testing)
const seedCompanyQnARoutes = require('./routes/seed-company-qna-production');
app.use('/api', seedCompanyQnARoutes);
console.log('✅ Company Q&A seeding routes registered at /api/seed-company-qna and /api/test-company-qna');

// Contact Lookup for Real-time Caller Identification
const contactLookupRoutes = require('./routes/contactLookup');
app.use('/api/contact-lookup', contactLookupRoutes);
console.log('✅ Contact Lookup routes registered at /api/contact-lookup');

// CRM Management System for Enterprise Contact Management
console.log('🔍 About to load CRM Management routes...');
try {
    const crmManagementRoutes = require('./routes/crmManagement');
    app.use('/api/crm', crmManagementRoutes);
    console.log('✅ CRM Management routes registered at /api/crm');
} catch (error) {
    console.error('❌ Failed to load CRM Management routes:', error);
}

app.use("/api/uploads", uploadRoutes);

// RESTORED - Full AI Agent Logic routes (issue was in Twilio routes, not here)
const aiAgentLogicRoutes = require('./routes/company/v2profile-aiagentlogic');

app.use('/api/ai-agent-logic', aiAgentLogicRoutes); // ClientsVia Intelligence Platform
app.use('/api', aiAgentLogicRoutes); // Also mount for direct API access (includes /api/tradeqa)

// Admin routes for system management
try {
    const adminRoutes = require('./routes/admin');
    app.use('/api/admin', adminRoutes);
    console.log('✅ Admin management routes loaded');
} catch (error) {
    console.error('❌ Failed to load admin routes:', error);
}

// Add simplified AI Agent Logic routes as fallback (no auth required for basic functionality)
try {
    const aiAgentLogicSimpleRoutes = require('./routes/aiAgentLogicSimple');
    app.use('/api/simple', aiAgentLogicSimpleRoutes); // Simple routes without complex auth
    console.log('✅ AI Agent Logic Simple routes loaded as fallback');
} catch (error) {
    console.log('ℹ️ AI Agent Logic Simple routes not found (optional)');
}

// 🚀 V2 GLOBAL SYSTEM ROUTES - Enterprise Multi-Tenant Platform
try {
    const v2GlobalTradeCategories = require('./routes/v2global/v2global-tradecategories');
    app.use('/api/v2global/trade-categories', v2GlobalTradeCategories);
    console.log('✅ V2 Global Trade Categories routes registered at /api/v2global/trade-categories');
} catch (error) {
    console.error('❌ Failed to load V2 Global Trade Categories routes:', error);
}

try {
    const v2GlobalDirectory = require('./routes/v2global/v2global-directory');
    app.use('/api/v2global/directory', v2GlobalDirectory);
    console.log('✅ V2 Global Directory routes registered at /api/v2global/directory');
} catch (error) {
    console.error('❌ Failed to load V2 Global Directory routes:', error);
}

try {
    const v2GlobalAddCompany = require('./routes/v2global/v2global-addcompany');
    app.use('/api/v2global/add-company', v2GlobalAddCompany);
    console.log('✅ V2 Global Add Company routes registered at /api/v2global/add-company');
} catch (error) {
    console.error('❌ Failed to load V2 Global Add Company routes:', error);
}

// 🚀 V2 PURE SYSTEM: All legacy development routes ELIMINATED
// Legacy services deleted: calendarService, actionService, serviceIssueHandler, selfCheckLogger, agentMessageProcessor
// Using V2 AI Agent Runtime only - no legacy contamination

app.get('/healthz', (req, res) => res.json({ ok: true }));

module.exports = app;
