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

const aiAgentWorkflowRoutes = require('./routes/aiAgentWorkflows');
const aiAgentAnalyticsRoutes = require('./routes/aiAgentAnalytics');
const knowledgeAutoPopulationRoutes = require('./routes/knowledgeAutoPopulation');
const enhancedAIAgentRoutes = require('./routes/enhancedAIAgent');
const aiAgentHandlerRoutes = require('./routes/aiAgentHandler');
const monitoringRoutes = require('./routes/monitoring');
// Local LLM routes removed - cloud-only LLM approach
const llmRoutes = require('./routes/llm');
const bookingRoutes = require('./routes/booking');
const transferRoutes = require('./routes/transfer');
const notesRoutes = require('./routes/notes'); // GOLD STANDARD: Enterprise Notes API

// ENTERPRISE: New routes for enterprise functionality
const knowledgeLifecycleRoutes = require('./routes/knowledgeLifecycle');
const enterpriseAnalyticsRoutes = require('./routes/enterpriseAnalytics');

// DELETED: Legacy Enterprise Trade Categories - replaced by V2 Global Trade Categories system

// ENTERPRISE: AI Agent Settings API with error handling
let agentSettingsRoutes;
try {
  agentSettingsRoutes = require('./routes/agentSettings');
} catch (error) {
  console.error('Failed to load Agent Settings routes:', error.message);
  process.exit(1);
}

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
app.use('/api/company', companyRoutes);
app.use('/api/company', settingsRoutes);

app.use('/api/ai-agent-workflows', aiAgentWorkflowRoutes);
app.use('/api/ai-agent-analytics', aiAgentAnalyticsRoutes);
app.use('/api/knowledge-auto-population', knowledgeAutoPopulationRoutes);
app.use('/api/enhanced-ai-agent', enhancedAIAgentRoutes);
app.use('/api/ai-agent', aiAgentHandlerRoutes);
app.use('/api/monitoring', monitoringRoutes);
// Local LLM routes removed - cloud-only LLM approach
app.use('/api/llm', llmRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/transfer', transferRoutes);
app.use('/api/notes', notesRoutes); // GOLD STANDARD: Enterprise Notes Management
app.use('/api/agent', agentSettingsRoutes); // ENTERPRISE: AI Agent Settings Management
app.use('/api/event-hooks', eventHooksRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/qna-learning', qnaLearningRoutes);

// Enterprise AI Intelligence routes with error handling
let enterpriseAIIntelligenceRoutes;
try {
  enterpriseAIIntelligenceRoutes = require('./routes/enterpriseAIIntelligence');
  app.use('/api/enterprise-ai', enterpriseAIIntelligenceRoutes);
} catch (error) {
  console.error('Failed to load Enterprise AI Intelligence routes:', error.message);
  process.exit(1);
}

// Enterprise Knowledge Lifecycle Management
app.use('/api/knowledge-lifecycle', knowledgeLifecycleRoutes);

// ✅ PRODUCTION FIX: Company Knowledge Base API for AI Agent Integration
// CRITICAL: This powers the Priority #1 knowledge source for AI routing
const companyKnowledgeRoutes = require('./routes/knowledge/companyKnowledge');
app.use('/api/knowledge', companyKnowledgeRoutes);
console.log('✅ Company Knowledge Base routes registered at /api/knowledge - AI Agent Priority #1 source active');

// Enterprise Analytics and Reporting
app.use('/api/enterprise-analytics', enterpriseAnalyticsRoutes);

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

// Development routes
if (process.env.NODE_ENV !== 'production') {
    // Serve selfCheckLogger service
    app.get('/services/selfCheckLogger.js', (req, res) => {
        res.sendFile(path.join(__dirname, 'services', 'selfCheckLogger.js'));
    });
    
    // Serve advanced AI engine
    app.get('/services/advancedAIEngine.js', (req, res) => {
        res.sendFile(path.join(__dirname, 'services', 'advancedAIEngine.js'));
    });
    
    // Serve booking flow engine
    app.get('/services/bookingFlowEngine.js', (req, res) => {
        res.sendFile(path.join(__dirname, 'services', 'bookingFlowEngine.js'));
    });
    
    console.log('🧪 Development test routes enabled');
}

app.get('/healthz', (req, res) => res.json({ ok: true }));

module.exports = app;
