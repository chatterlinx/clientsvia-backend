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

// ============================================================================
// 🛡️ CRITICAL: GLOBAL ERROR HANDLERS (Prevent silent crashes)
// ============================================================================
// 
// 🚨 LESSON LEARNED (Oct 2025 - 6+ hour debugging session):
// WITHOUT these handlers, the server crashes SILENTLY with no error output.
// Render shows "No open ports detected" but NEVER shows the real error.
// 
// SYMPTOMS OF MISSING ERROR HANDLERS:
// - Server starts, then immediately dies
// - Render logs show "No open ports detected, continuing to scan..."
// - NO error messages, NO stack traces, NO clues
// - Appears like Redis/MongoDB issue, but could be ANYTHING
// 
// ROOT CAUSES WE HIT:
// 1. Missing npm package (memorystore) - crashed with no output
// 2. Redis null reference in session store - crashed with no output  
// 3. Uninitialized modules causing TypeError - crashed with no output
// 
// SOLUTION:
// These handlers MUST be at the TOP of index.js (after dotenv/logger only)
// They catch and LOG errors before the server dies, showing the REAL problem
// 
// ⚠️ DO NOT REMOVE OR MOVE THESE HANDLERS - they save hours of debugging
// ============================================================================

process.on('uncaughtException', (error) => {
    console.error('💥 [FATAL] UNCAUGHT EXCEPTION - SERVER WILL CRASH:', error);
    console.error('💥 [FATAL] Stack trace:', error.stack);
    logger.error('💥 [FATAL] Uncaught exception', {
        error: error.message,
        stack: error.stack,
        name: error.name
    });
    
    // Give logger time to flush before exiting
    setTimeout(() => {
        process.exit(1);
    }, 1000);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 [CRITICAL] UNHANDLED PROMISE REJECTION:', reason);
    console.error('💥 [CRITICAL] Promise:', promise);
    logger.error('💥 [CRITICAL] Unhandled promise rejection', {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        promise: String(promise)
    });
    
    // Don't exit on unhandled rejections, just log them
    // They might be non-critical async operations
});

process.on('SIGTERM', () => {
    console.log('⚠️ [SHUTDOWN] SIGTERM received - graceful shutdown initiated');
    logger.info('⚠️ [SHUTDOWN] SIGTERM received');
    // Perform graceful shutdown
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('⚠️ [SHUTDOWN] SIGINT received - graceful shutdown initiated');
    logger.info('⚠️ [SHUTDOWN] SIGINT received');
    process.exit(0);
});

console.log('[INIT] ✅ Global error handlers installed');

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
// V2 DELETED: Legacy BackupMonitoringService - v2 bloat eliminated
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
        routes.v2CompanyRoutes = await loadRouteWithTimeout('./routes/v2company', 'v2CompanyRoutes');
        routes.v2VoiceRoutes = await loadRouteWithTimeout('./routes/company/v2profile-voice', 'v2VoiceRoutes');
        // V2 DELETED: Legacy alerts route - depends on deleted Alert model
        // routes.alertRoutes = await loadRouteWithTimeout('./routes/alerts', 'alertRoutes');
        // V2 DELETED: Legacy integrations route - Google Calendar integration eliminated
        routes.v2TtsRoutes = await loadRouteWithTimeout('./routes/v2tts', 'v2TtsRoutes');
        routes.v2TwilioRoutes = await loadRouteWithTimeout('./routes/v2twilio', 'v2TwilioRoutes');
        // V2 DELETED: Legacy external AI routes - violates 100% in-house AI system
        routes.v2ElevenLabsRoutes = await loadRouteWithTimeout('./routes/v2elevenLabs', 'v2ElevenLabsRoutes');
        // 🗑️ DELETED: All AI Agent Logic routes (tab removed)
        // 🤖 COMPANY CONFIGURATION ROUTES - AI Agent Settings (Variables, Filler Words, Scenarios) - 100% ISOLATED
        routes.v2CompanyConfigurationRoutes = await loadRouteWithTimeout('./routes/company/v2companyConfiguration', 'v2CompanyConfigurationRoutes');
        routes.triageCardsRoutes = await loadRouteWithTimeout('./routes/company/triageCards', 'triageCardsRoutes'); // 🎯 Triage Cards Management (atomic source of truth)
        routes.blackboxRoutes = await loadRouteWithTimeout('./routes/company/blackbox', 'blackboxRoutes'); // 📼 Black Box Recorder (Enterprise Call Flight Recorder)
        routes.dynamicFlowsRoutes = await loadRouteWithTimeout('./routes/company/dynamicFlows', 'dynamicFlowsRoutes'); // 🧠 Dynamic Flow Engine (Trigger → Event → State → Action)
        routes.systemSnapshotRoutes = await loadRouteWithTimeout('./routes/company/systemSnapshot', 'systemSnapshotRoutes'); // 📸 System Snapshot (Flow Tree JSON - Single Source of Truth)
        routes.companyOpsRouter = await loadRouteWithTimeout('./routes/company/companyOpsRouter', 'companyOpsRouter'); // 🏢 CompanyOps Console (Contacts, Locations, Appointments, Call Traces, Usage, Customer DB, Notifications, Settings, + Cheat Sheet Config)
        // 🗑️ DELETED: v2InstantResponses - replaced by v2InstantResponseCategories system
        // V2 DELETED: Legacy v2 testing routes - using V2 AI Agent Logic system
        // routes.priorityFlowTestingRoutes = await loadRouteWithTimeout('./routes/company/priorityFlowTesting', 'priorityFlowTestingRoutes');
        // routes.agentTestingRoutes = await loadRouteWithTimeout('./routes/company/agentTesting', 'agentTestingRoutes');
        // V2 DELETED: Legacy eventHooks routes - v2 event system eliminated
        // V2 DELETED: Legacy transferRouter routes - v2 transfer system eliminated
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
        routes.v2NotesRoutes = await loadRouteWithTimeout('./routes/v2notes', 'v2NotesRoutes');
        // V2: Legacy agentProcessor route deleted - using modern AI Agent Logic processing system
        routes.adminRoutes = await loadRouteWithTimeout('./routes/v2admin', 'adminRoutes');
        routes.globalInstantResponsesRoutes = await loadRouteWithTimeout('./routes/admin/globalInstantResponses', 'globalInstantResponsesRoutes');
        routes.globalAIBehaviorsRoutes = await loadRouteWithTimeout('./routes/admin/globalAIBehaviors', 'globalAIBehaviorsRoutes');
        routes.llmScenarioAssistantRoutes = await loadRouteWithTimeout('./routes/admin/llmScenarioAssistant', 'llmScenarioAssistantRoutes');
        routes.llmSettingsRoutes = await loadRouteWithTimeout('./routes/admin/llmSettings', 'llmSettingsRoutes');
        routes.cheatSheetRoutes = await loadRouteWithTimeout('./routes/admin/cheatSheet', 'cheatSheetRoutes'); // 🧠 Cheat Sheet Management (Phase 1)
        routes.cheatSheetVersioningRoutes = await loadRouteWithTimeout('./routes/cheatsheet', 'cheatSheetVersioningRoutes'); // 📚 CheatSheet Version System (Draft/Live/History)
        // activeInstructionsRoutes REMOVED Dec 2025 - broken X-RAY, caused confusion
        routes.globalConfigRoutes = await loadRouteWithTimeout('./routes/global-config', 'globalConfigRoutes'); // 🌍 Global Config Sharing (Local/Global)
        routes.cheatSheetCategoryRoutes = await loadRouteWithTimeout('./routes/cheatsheet/category', 'cheatSheetCategoryRoutes'); // 🔒 CheatSheet Category Locking
        routes.triageBuilderRoutes = await loadRouteWithTimeout('./routes/admin/triageBuilder', 'triageBuilderRoutes'); // 🤖 LLM Triage Builder (admin content generator)
        routes.triageEvaluatorRoutes = await loadRouteWithTimeout('./routes/admin/triageEvaluator', 'triageEvaluatorRoutes'); // 🎯 Triage Command Center (A+ Evaluation)
        routes.triagePresetsRoutes = await loadRouteWithTimeout('./routes/admin/triagePresets', 'triagePresetsRoutes'); // 🎯 Dynamic Triage Presets per Trade
        // callFlowRoutes REMOVED Dec 2025 - replaced by Mission Control (callFlowEngine)
        // V1 LLM Console removed - 2025-11-08
        routes.llmLearningV2Routes = await loadRouteWithTimeout('./routes/admin/llmLearningV2', 'llmLearningV2Routes');
        routes.llmLearningV2UIRoutes = await loadRouteWithTimeout('./routes/admin/llmLearningConsoleV2UI', 'llmLearningV2UIRoutes');
        routes.globalActionHooksRoutes = await loadRouteWithTimeout('./routes/admin/globalActionHooks', 'globalActionHooksRoutes');
        routes.globalActionHookDirectoriesRoutes = await loadRouteWithTimeout('./routes/admin/globalActionHookDirectories', 'globalActionHookDirectoriesRoutes');
        routes.dataCenterRoutes = await loadRouteWithTimeout('./routes/admin/dataCenter', 'dataCenterRoutes');
        routes.globalIndustryTypesRoutes = await loadRouteWithTimeout('./routes/admin/globalIndustryTypes', 'globalIndustryTypesRoutes');
        routes.v2GlobalAdminRoutes = await loadRouteWithTimeout('./routes/v2global/v2global-admin', 'v2GlobalAdminRoutes');
        // REMOVED: Legacy v2global-directory and v2global-addcompany routes - replaced with new versions
        routes.v2GlobalTradeCategoriesRoutes = await loadRouteWithTimeout('./routes/v2global/v2global-tradecategories', 'v2GlobalTradeCategoriesRoutes');
        routes.v2AuthRoutes = await loadRouteWithTimeout('./routes/v2auth', 'v2AuthRoutes');
        // V2 DELETED: Legacy backup routes - v2 backup system eliminated
        // REMOVED: Legacy CRM Management routes - will build V2 version in future
        
        // 🗑️ DELETED: AI Agent Logic routes (tab removed)
        // 🗑️ DELETED: Instant Response Categories routes (tab removed)
        
        // V2 Twilio Control Center & Connection Messages (AI Agent Settings tab)
        routes.v2TwilioControlRoutes = await loadRouteWithTimeout('./routes/company/v2twilioControl', 'v2TwilioControlRoutes');
        routes.v2ConnectionMessagesRoutes = await loadRouteWithTimeout('./routes/company/v2connectionMessages', 'v2ConnectionMessagesRoutes');
        routes.v2TTSRoutes = await loadRouteWithTimeout('./routes/company/v2tts', 'v2TTSRoutes');
        routes.v2AIAgentDiagnosticsRoutes = await loadRouteWithTimeout('./routes/company/v2aiAgentDiagnostics', 'v2AIAgentDiagnosticsRoutes');
        // v2AIKnowledgebaseRoutes REMOVED Dec 2025 - always showed zeros, Black Box is better
        routes.v2AILiveScenariosRoutes = await loadRouteWithTimeout('./routes/company/v2aiLiveScenarios', 'v2AILiveScenariosRoutes');
        routes.v2AICoreScenarios = await loadRouteWithTimeout('./routes/company/v2aiCoreScenarios', 'v2AICoreScenarios');
        // v2AIAnalyticsRoutes REMOVED Dec 2025 - broken observability, Black Box is better
        routes.v2FillerFilterRoutes = await loadRouteWithTimeout('./routes/company/v2FillerFilter', 'v2FillerFilterRoutes');
        routes.callArchivesRoutes = await loadRouteWithTimeout('./routes/admin/callArchives', 'callArchivesRoutes');
        routes.callFilteringRoutes = await loadRouteWithTimeout('./routes/admin/callFiltering', 'callFilteringRoutes');
        routes.learningLoopRoutes = await loadRouteWithTimeout('./routes/admin/learningLoop', 'learningLoopRoutes'); // 🎓 Learning Loop (Black Box → Edge Cases/Blacklist quick-add)
        routes.llm0ControlsRoutes = await loadRouteWithTimeout('./routes/admin/llm0Controls', 'llm0ControlsRoutes'); // 🧠 LLM-0 Controls (Brain behavior settings)
        routes.callFlowEngineRoutes = await loadRouteWithTimeout('./routes/admin/callFlowEngine', 'callFlowEngineRoutes'); // 🎯 Call Flow Engine (Universal flow routing)
        // serviceTypeClarificationRoutes REMOVED Dec 2025 - redundant with Triage
        routes.frontDeskBehaviorRoutes = await loadRouteWithTimeout('./routes/admin/frontDeskBehavior', 'frontDeskBehaviorRoutes'); // 💬 Front Desk Behavior (LLM-0 conversation style)
        routes.dynamicFlowAdminRoutes = await loadRouteWithTimeout('./routes/admin/dynamicFlowAdmin', 'dynamicFlowAdminRoutes'); // 🧠 Dynamic Flow Admin (Seed templates, manage global flows)
        routes.quickAnswersRoutes = await loadRouteWithTimeout('./routes/admin/quickAnswers', 'quickAnswersRoutes'); // ❓ Quick Answers (common questions - NO LEGACY)
        routes.sttProfileRoutes = await loadRouteWithTimeout('./routes/admin/sttProfile', 'sttProfileRoutes'); // 🎤 STT Profile (Speech-to-Text intelligence per template)
        routes.adminNotificationsRoutes = await loadRouteWithTimeout('./routes/admin/adminNotifications', 'adminNotificationsRoutes');
        routes.setupNotificationCenterRoutes = await loadRouteWithTimeout('./routes/admin/setup-notification-center', 'setupNotificationCenterRoutes');
        routes.adminGlobalAIBrainTestRoutes = await loadRouteWithTimeout('./routes/admin/adminGlobalAIBrainTest', 'adminGlobalAIBrainTestRoutes');
        routes.companyTestModeRoutes = await loadRouteWithTimeout('./routes/admin/companyTestMode', 'companyTestModeRoutes'); // ADMIN: Company Test Mode (test real production configurations)
        routes.v2IntelligenceConfigRoutes = await loadRouteWithTimeout('./routes/admin/v2intelligenceConfig', 'v2IntelligenceConfigRoutes'); // ADMIN: Intelligence Presets (Test Pilot vs Production 3-Tier configs)
        routes.adminIntelligenceRoutes = await loadRouteWithTimeout('./routes/admin/adminIntelligence', 'adminIntelligenceRoutes');
        routes.globalIntelligenceRoutes = await loadRouteWithTimeout('./routes/admin/globalIntelligence', 'globalIntelligenceRoutes'); // ADMIN: Global Production Intelligence (platform-wide 3-tier defaults, inheritance system)
        routes.enterpriseSuggestionsRoutes = await loadRouteWithTimeout('./routes/admin/enterpriseSuggestions', 'enterpriseSuggestionsRoutes'); // ADMIN: Enterprise Test Pilot (deep analysis, suggestions, trends, conflicts, cost)
        routes.healthRoutes = await loadRouteWithTimeout('./routes/health', 'healthRoutes');
        // llm0TraceRoutes REMOVED Dec 2025 - LLM-0 Cortex-Intel nuked, Black Box is better
        routes.frontlineScriptBuilderRoutes = await loadRouteWithTimeout('./routes/admin/frontlineScriptBuilder', 'frontlineScriptBuilderRoutes'); // Frontline Script Builder: LLM-powered script generation
        routes.chatRoutes = await loadRouteWithTimeout('./routes/api/chat', 'chatRoutes'); // 🌐 Website Chat API (unified AI brain for website visitors)
        
        // REMOVED: Legacy V2 AI Intelligence routes - archived to prevent external LLM dependencies
        
        // DELETED: Legacy V2 Trade Categories - replaced by V2 Global Trade Categories system
        
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
// --- Boot-time allow-list to prevent env drift ---
(function assertMongoUriSafe() {
    try {
        const uri = process.env.MONGODB_URI || process.env.MONGO_URI || '';
        const env = process.env.NODE_ENV || 'development';
        const enforce = String(process.env.ENFORCE_MONGO_ALLOWLIST || 'false').toLowerCase() === 'true';
        if (!enforce) {
            console.warn('[BOOT] Mongo allow-list enforcement disabled (set ENFORCE_MONGO_ALLOWLIST=true to enable)');
            return; // do not enforce in environments where not explicitly enabled
        }
        const ALLOW = {
            production: [/^mongodb(\+srv)?:\/\/(prod-|cluster-prod)/i],
            staging: [/^mongodb(\+srv)?:\/\/(staging-|cluster-stg)/i],
            development: [/^mongodb(\+srv)?:\/\/(dev-|localhost|127\.0\.0\.1)/i]
        };
        if ((ALLOW[env] || []).length) {
            const ok = (ALLOW[env] || []).some(rx => rx.test(uri));
            if (!ok) {
                console.error(`[BOOT BLOCKED] Unexpected MONGO_URI for env=${env}`);
                console.error('Provided URI (redacted):', uri.replace(/\/\/([^@]+)@/, '//***@'));
                process.exit(1);
            }
        }
    } catch (e) {
        console.warn('[BOOT] Allow-list check skipped:', e.message);
    }
})();
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

// SESSION CONFIGURATION FOR JWT
console.log('🔍 SESSION CHECKPOINT 1: Starting session configuration in index.js...');
const session = require('express-session');
// V2 DELETED: Passport - using JWT-only authentication system
// const passport = require('./config/passport');

console.log('🔍 SESSION CHECKPOINT 2: Setting up session middleware with default store...');

// ════════════════════════════════════════════════════════════════════════════
// 🚨 CRITICAL FIX: Use default session store (safe, no Redis dependency)
// ════════════════════════════════════════════════════════════════════════════
// 
// 🚨 LESSON LEARNED (Oct 2025 - Redis Cold Start Crisis):
// DO NOT use connect-redis or any external session store during initial setup!
// 
// WHY THIS MATTERS:
// - Redis connects asynchronously and takes 1-10 seconds to be ready
// - express-session middleware runs SYNCHRONOUSLY during app.use()
// - If you pass a RedisStore with null/unready client, it crashes IMMEDIATELY
// - Error: "Cannot use 'in' operator to search for 'scanIterator' in null"
// 
// WHAT WE TRIED (ALL FAILED):
// ❌ connect-redis with deferred client (still crashed on cold start)
// ❌ memorystore package (not installed, caused crash)
// ❌ Waiting for Redis before session setup (blocked server startup)
// 
// SOLUTION THAT WORKS:
// ✅ Use express-session's BUILT-IN default MemoryStore (no external deps)
// ✅ Don't specify 'store' option - it uses MemoryStore automatically
// ✅ Server starts instantly, no Redis dependency during initialization
// ✅ Perfect for single-instance deployments (most production use cases)
// 
// WHEN TO CHANGE:
// - Only if you need multi-instance session sharing (horizontal scaling)
// - Implement Redis session store AFTER server is fully booted
// - Use dynamic store swapping or conditional middleware loading
// 
// ⚠️ DO NOT "FIX" THIS TO USE REDIS - it will break cold starts!
// ════════════════════════════════════════════════════════════════════════════

app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
  // Note: Using default MemoryStore (not suitable for multi-instance production)
}));
console.log('✅ SESSION: Session middleware configured with default store');
console.log('🔍 SESSION CHECKPOINT 3: Session middleware applied successfully');

// V2 DELETED: Passport initialization - using JWT-only authentication system
// console.log('🔍 SESSION CHECKPOINT 4: Initializing Passport...');
// app.use(passport.initialize());
// console.log('🔍 SESSION CHECKPOINT 5: Passport initialized');
// app.use(passport.session());
// console.log('🔍 SESSION CHECKPOINT 6: Passport session middleware applied');

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

// Dedicated Twilio request logger (must run before auth-guarded routers)
const twilioRequestLogger = (req, res, next) => {
    console.log('🌐 GLOBAL TWILIO REQUEST INTERCEPTED:', {
        timestamp: new Date().toISOString(),
        method: req.method,
        originalUrl: req.originalUrl,
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.headers['user-agent'],
        twilioSignature: req.headers['x-twilio-signature'],
        hasBody: Boolean(req.body),
        bodySize: JSON.stringify(req.body || {}).length
    });
    next();
};

// Routes will be registered after they are loaded asynchronously
function registerRoutes(routes) {
    console.log('[INIT] Registering all API routes...');
    
    // Twilio webhooks must bypass JWT-protected tenant routes, so register them first
    app.use('/api/twilio', twilioRequestLogger);
    app.use('/api/twilio', routes.v2TwilioRoutes);

    // EMERGENCY ROUTE - DELETE AFTER USE
    app.use('/api', require('./routes/emergency-enable'));
    
    // PUBLIC HEALTH/VERSION ROUTES - Must be before auth-protected routes
    app.use('/api', routes.healthRoutes); // SYSTEM: Health check + version endpoint (PUBLIC, no auth)

    // --- API Routes ---
    app.use('/api', routes.v2CompanyRoutes);
    app.use('/api/company', routes.v2VoiceRoutes); // V2 Voice Settings API (must be /api/company for /:companyId/v2-voice-settings)
    // V2: All legacy debug and seed routes deleted - no longer needed in V2 system
    // V2 DELETED: Legacy alerts route mounting - depends on deleted Alert model
    // app.use('/api/alerts', routes.alertRoutes);
    // V2 DELETED: Legacy integrations route mount - Google Calendar integration eliminated
    app.use('/api/tts', routes.v2TtsRoutes);
    // V2 DELETED: Legacy external AI routes - violates 100% in-house AI system
    app.use('/api/elevenlabs', routes.v2ElevenLabsRoutes);
    // V2 DELETED: Legacy upload routes - file upload functionality eliminated
    // V2: Legacy /api/agent route removed - using /api/company/:companyId/agent-settings V2 route
    app.use('/api/auth', routes.v2AuthRoutes); // V2: User authentication and JWT token management
    app.use('/api/admin', routes.adminRoutes);
    app.use('/api/admin/global-instant-responses', routes.globalInstantResponsesRoutes); // Global AI Brain Management
    app.use('/api/admin/global-behaviors', routes.globalAIBehaviorsRoutes); // Global AI Behavior Templates
    app.use('/api/admin/scenario-assistant', routes.llmScenarioAssistantRoutes); // 🤖 LLM Scenario Assistant (admin drafting tool)
    app.use('/api/admin/llm-settings', routes.llmSettingsRoutes); // 🎛️ LLM Enterprise Settings (profiles, compliance, advanced tuning)
    app.use('/api/admin/cheat-sheet', routes.cheatSheetRoutes); // 🧠 Cheat Sheet Management (Phase 1)
    app.use('/api/cheatsheet', routes.cheatSheetVersioningRoutes); // 📚 CheatSheet Version System (Draft/Live/History/Runtime)
    // activeInstructionsRoutes REMOVED Dec 2025 - nuked
    app.use('/api/global-config', routes.globalConfigRoutes); // 🌍 Global Config Sharing (Local/Global)
    app.use('/api/cheatsheet/category', routes.cheatSheetCategoryRoutes); // 🔒 CheatSheet Category Locking
    app.use('/api/admin/triage-builder', routes.triageBuilderRoutes); // 🤖 LLM Triage Builder (admin content generator)
    app.use('/api/admin/triage-evaluator', routes.triageEvaluatorRoutes); // 🎯 Triage Command Center (A+ Evaluation)
    app.use('/api/admin/triage-presets', routes.triagePresetsRoutes); // 🎯 Dynamic Triage Presets per Trade
    // callFlowRoutes REMOVED Dec 2025 - use Mission Control (call-flow-engine) instead
    // V1 LLM Console API removed - 2025-11-08 (use V2 instead)
    app.use('/api/admin/llm-learning/v2', routes.llmLearningV2Routes); // LLM Learning Console V2 API (Enhanced with latency tracking)
    app.use('/admin', routes.llmLearningV2UIRoutes); // LLM Learning Console V2 UI (Standalone page at /admin/llm-learning-v2)
    app.use('/api/admin/global-action-hooks', routes.globalActionHooksRoutes); // Global Action Hooks
    app.use('/api/admin/global-action-hook-directories', routes.globalActionHookDirectoriesRoutes); // Global Action Hook Directories
    app.use('/api/admin/global-industry-types', routes.globalIndustryTypesRoutes); // Global Industry Types
    app.use('/api/admin/data-center', routes.dataCenterRoutes); // Data Center - Admin Operations
    app.use('/api/admin/diag', require('./routes/admin/diag')); // Diagnostics - DB/Redis fingerprint
    app.use('/api/admin/emergency', require('./routes/admin/emergency-repair')); // 🚨 Emergency database repair endpoints
    app.use('/api/admin/ai-costs', require('./routes/admin/aiCosts')); // 📊 AI Cost Tracking & Budget Monitoring
    app.use('/api/admin/agent-status', require('./routes/admin/agentStatus')); // 🔴 Live Agent Status & System Health (Enterprise Visibility)
    app.use('/api/admin/agent-excellence', require('./routes/admin/agentExcellence')); // 🧠 AI Agent Excellence Center (Scores, Suggestions, Learning)
    app.use('/api/debug', require('./routes/api/debug')); // 🔍 Debug API - Session inspection for troubleshooting
    app.use('/api/openai-health', require('./routes/api/openai-health')); // 🏥 OpenAI Health - ACTUALLY tests if OpenAI API works
    app.use('/api/admin/call-center', require('./routes/admin/callCenter')); // 📞 Call Center Module V2 (Call History, Customers, Analytics)
    app.use('/api/v2global/admin', routes.v2GlobalAdminRoutes); // V2 Global Admin Dashboard
    // REMOVED: Legacy v2global/directory and v2global/addcompany routes - replaced with new versions
    app.use('/api/v2global/trade-categories', routes.v2GlobalTradeCategoriesRoutes); // V2 Global Trade Categories
    // V2 DELETED: Legacy backup routes - v2 backup system eliminated
    // 🗑️ DELETED: All AI Agent Logic route registrations (tab removed)
    app.use('/api/company', routes.v2CompanyConfigurationRoutes); // V2: AI Agent Settings (Variables, Filler Words, Scenarios) - 100% ISOLATED
    app.use('/api/company/:companyId/triage-cards', routes.triageCardsRoutes); // V2: Triage Cards Management (atomic source of truth)
    app.use('/api/company/:companyId/blackbox', routes.blackboxRoutes); // 📼 Black Box Recorder (Enterprise Call Flight Recorder)
    app.use('/api/company/:companyId/dynamic-flows', routes.dynamicFlowsRoutes); // 🧠 Dynamic Flow Engine (Trigger → Event → State → Action)
    app.use('/api/company/:companyId/system-snapshot', routes.systemSnapshotRoutes); // 📸 System Snapshot (Flow Tree JSON - Single Source of Truth)
    app.use('/api/company/:companyId', routes.companyOpsRouter); // V2: CompanyOps Console + Cheat Sheet Config (Contacts, Locations, Appointments, Call Traces, Usage, Customer DB, Notifications, Settings, Booking Rules, Role Contacts, Links, Calculator)
    app.use('/api/company', routes.v2TwilioControlRoutes); // V2: Twilio Control Center (AI Agent Settings - Dashboard tab)
    app.use('/api/company', routes.v2ConnectionMessagesRoutes); // V2: Connection Messages (AI Agent Settings - Messages & Greetings tab)
    app.use('/api/company', routes.v2TTSRoutes); // V2: Text-to-Speech for voice testing and preview (AI Voice Settings tab)
    app.use('/api/company', routes.v2AIAgentDiagnosticsRoutes); // V2: System Diagnostics (AI Agent Settings - copy/paste for debugging)
    // v2AIKnowledgebaseRoutes REMOVED Dec 2025 - nuked
    app.use('/api', routes.v2AILiveScenariosRoutes); // V2: AiCore Live Scenarios (real-time scenario browser from all templates)
    app.use('/api', routes.v2AICoreScenarios); // V2: AiCore Scenario Controls (per-company enable/disable toggles)
    // v2AIAnalyticsRoutes REMOVED Dec 2025 - broken, Black Box is better
    app.use('/api', routes.v2FillerFilterRoutes); // V2: AiCore Filler Filter (inherited + custom filler words management)
    app.use('/api', routes.callArchivesRoutes); // ADMIN: Call Archives (search transcripts, export call history)
    app.use('/api', routes.callFilteringRoutes); // ADMIN: Call Filtering (spam detection, blacklist/whitelist management)
    app.use('/api/admin/learning-loop', routes.learningLoopRoutes); // 🎓 Learning Loop (Black Box → Edge Cases/Blacklist/Synonyms quick-add)
    app.use('/api/admin/llm0-controls', routes.llm0ControlsRoutes); // 🧠 LLM-0 Controls (Brain-1 behavior settings per company)
    app.use('/api/admin/call-flow-engine', routes.callFlowEngineRoutes); // 🎯 Call Flow Engine (Universal flow routing)
    // serviceTypeClarificationRoutes REMOVED Dec 2025 - nuked
    app.use('/api/admin/front-desk-behavior', routes.frontDeskBehaviorRoutes); // 💬 Front Desk Behavior (LLM-0 conversation style - ALL UI controlled)
    app.use('/api/admin/dynamic-flows', routes.dynamicFlowAdminRoutes); // 🧠 Dynamic Flow Admin (Seed templates, manage global flows)
    app.use('/api/admin/quick-answers', routes.quickAnswersRoutes); // ❓ Quick Answers (common questions - NO LEGACY connection)
    app.use('/api/admin/stt-profile', routes.sttProfileRoutes); // 🎤 STT Profile (Speech-to-Text intelligence per template)
    app.use('/api/admin/notifications', routes.adminNotificationsRoutes); // ADMIN: Notification Center (platform alerts, SMS delivery, health checks)
    app.use('/api', routes.setupNotificationCenterRoutes); // ADMIN: One-time setup endpoint for Notification Center company
    app.use('/api/admin/settings/global-ai-brain-test', routes.adminGlobalAIBrainTestRoutes); // ADMIN: Global AI Brain Test Config (single Twilio test console for all templates)
    app.use('/api/admin', routes.companyTestModeRoutes); // ADMIN: Company Test Mode API (test real company configurations)
    app.use('/api/admin/intelligence', routes.v2IntelligenceConfigRoutes); // ADMIN: Intelligence Presets API (Test Pilot vs Production 3-Tier configs, cost estimation, recommendations)
    app.use('/api/admin/intelligence', routes.adminIntelligenceRoutes); // ADMIN: 3-Tier Intelligence System (LLM, pattern learning, cost tracking, global patterns)
    app.use('/api/admin', routes.globalIntelligenceRoutes); // ADMIN: Global Production Intelligence API (platform-wide 3-tier defaults, inheritance system)
    app.use('/api/admin/suggestions', routes.enterpriseSuggestionsRoutes); // ADMIN: Enterprise Test Pilot (deep analysis, suggestions, trends, conflicts, cost projections)
    // healthRoutes moved to top of routes (before auth-protected routes) for public access
    // llm0TraceRoutes REMOVED Dec 2025 - nuked
    app.use('/api/admin/frontline-script', routes.frontlineScriptBuilderRoutes); // Frontline Script Builder: LLM-powered script generation
    app.use('/api/chat', routes.chatRoutes); // 🌐 Website Chat API (unified AI brain for website visitors, also used by AI Test Console)
    // app.use('/api/company', routes.agentTestingRoutes); // MODULE 3: AI Agent Testing Console
    // V2 DELETED: Legacy enhancedAgentSettings route mount - used external LLMs, violates in-house AI system

    // V2 DELETED: Legacy AI Agent routes - v2 event and transfer systems eliminated
    // V2 DELETED: Legacy event-hooks routes - v2 event system eliminated
    // V2 DELETED: Legacy transfer-router routes - v2 transfer system eliminated

    // V2 DELETED: Legacy AI agent workflow and analytics route mounts - using V2 AI Agent Logic system
    // REMOVED: knowledge-auto-population routes - Replaced by comprehensive Company Q&A Management system
    // V2: Legacy AI agent route mounting removed - using modern v2profile-aiagentlogic system
    // V2: Legacy agentPerformance route deleted - using modern AI Agent Logic analytics
    // V2: Legacy intentRouting route deleted - using modern AI Agent Logic intent classification
    // V2: Legacy bookingScripts route deleted - using modern AI Agent Logic booking flow
    // V2: Legacy monitoring route deleted - using modern AI Agent Logic monitoring system
    app.use('/api/notes', routes.v2NotesRoutes); // V2: Notes Management
    // V2: Legacy bookingHandler route deleted - using modern AI Agent Logic booking system
    // REMOVED: Legacy AI Intelligence routes - replaced by AI Agent Logic system
    // REMOVED: Legacy V2 AI Intelligence routes - archived to prevent external LLM dependencies
    // DELETED: Legacy v2 trade categories route - replaced by V2 Global Trade Categories

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
            referer: req.headers.referer,
            isTwilio: req.headers['user-agent']?.includes('TwilioProxy') || req.headers['x-twilio-signature'],
            hasCallSid: Boolean(req.body && req.body.CallSid)
        });
    }
    next();
});
    
    // REMOVED: Legacy CRM Management routes - will build V2 version in future
    
    // 🗑️ DELETED: AI Agent Logic routes (tab removed)
    
    console.log('[INIT] ✅ All API routes registered successfully');
    
    // ========================================================================
    // ENHANCED 404 HANDLER (MUST BE LAST)
    // ========================================================================
    // This catches all unmatched routes AFTER all route registrations
    // ========================================================================
    
    app.use((req, res, next) => {
        if (!res.headersSent) {
            // Increment 404 counter for monitoring
            if (typeof notFoundCount !== 'undefined') {
                notFoundCount++;
            }
            
            // Log detailed 404 information
            console.error('❌ [404 NOT FOUND]', {
                timestamp: new Date().toISOString(),
                method: req.method,
                path: req.path,
                url: req.originalUrl,
                ip: req.ip,
                userAgent: req.get('user-agent'),
                referer: req.get('referer'),
                query: req.query
            });
            
            // Return structured JSON for API paths
            if (req.path.startsWith('/api')) {
                return res.status(404).json({
                    success: false,
                    error: 'Endpoint not found',
                    path: req.path,
                    method: req.method,
                    suggestion: 'Check API documentation or contact support',
                    timestamp: new Date().toISOString()
                });
            }
            
            // HTML 404 for pages
            res.status(404).send('<h1>404 - Page Not Found</h1><p>The page you are looking for does not exist.</p>');
        } else {
            next();
        }
    });

    // ========================================================================
    // ERROR NOTIFICATION HANDLER (MUST BE ABSOLUTE LAST MIDDLEWARE)
    // ========================================================================
    // Catches ALL unhandled errors from routes and sends alerts to
    // Notification Center. Critical for 100+ company scaling.
    // ========================================================================
    const errorNotificationHandler = require('./middleware/errorNotificationHandler');
    app.use(errorNotificationHandler);
    console.log('[INIT] ✅ Error notification handler registered');
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
        
        // 🔒 PRODUCTION SECURITY: Validate environment variables before starting
        console.log('[Server] Step 0/7: Validating environment configuration...');
        const { validateEnvironment, getEnvironmentSummary } = require('./utils/validateEnvironment');
        try {
            const validationResult = validateEnvironment();
            console.log(`[Server] ✅ Step 0 COMPLETE: Environment validated (${validationResult.warnings.length} warnings)`);
            
            // Log environment summary for debugging
            const envSummary = getEnvironmentSummary();
            console.log('[Server] Environment Summary:', JSON.stringify(envSummary, null, 2));
        } catch (validationError) {
            console.error('[Server] ❌ FATAL: Environment validation failed!');
            console.error('[Server] Error:', validationError.message);
            console.error('[Server] Please check your .env file and ensure all required variables are set.');
            console.error('[Server] See env.example for configuration details.');
            throw validationError;
        }
        
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
        
        // ────────────────────────────────────────────────────────────────────────
        // STEP 3.5: CRITICAL - INITIALIZE REDIS BEFORE ANY HEALTH CHECKS
        // ────────────────────────────────────────────────────────────────────────
        console.log('════════════════════════════════════════════════════════════════════');
        console.log('[Server] Step 3.5/7: Initializing Redis client...');
        console.log('════════════════════════════════════════════════════════════════════');
        const redisStart = Date.now();
        try {
            // Use warmupRedis for visible testing at startup
            const { warmupRedis, isRedisConfigured } = require('./services/redisClientFactory');
            
            if (!isRedisConfigured()) {
                console.log('[Server] ⚠️ REDIS_URL not set - skipping Redis');
            } else {
                // Add 10-second timeout to prevent blocking server startup
                const warmupResult = await Promise.race([
                    warmupRedis(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Redis warmup timeout after 10s')), 10000)
                    )
                ]);
                
                if (warmupResult) {
                    console.log(`[Server] ✅ Step 3.5 COMPLETE: Redis initialized in ${Date.now() - redisStart}ms`);
                } else {
                    console.warn('[Server] ⚠️ Step 3.5: Redis warmup returned false');
                }
            }
        } catch (redisError) {
            console.error('[Server] ❌ Redis initialization failed:', redisError.message);
            console.warn('[Server] ⚠️ Server will continue without Redis caching (degraded mode)');
            // Non-blocking: continue server startup even if Redis fails
        }
        console.log('════════════════════════════════════════════════════════════════════');
        
        // 🔧 FIX: Ensure v2TradeCategory indexes are correct for multi-tenancy
        console.log('[Server] Step 2.5/7: Checking v2TradeCategory indexes...');
        try {
            const v2TradeCategory = require('./models/v2TradeCategory');
            const indexes = await v2TradeCategory.collection.getIndexes();
            
            // Check for problematic 'name_1' index (unique on name only)
            if (indexes.name_1) {
                console.log('[Server] ⚠️  Found old name_1 index - dropping it for multi-tenancy...');
                await v2TradeCategory.collection.dropIndex('name_1');
                console.log('[Server] ✅ Dropped old name_1 index');
            }
            
            // Ensure compound index exists
            if (!indexes.v2_company_name_unique) {
                console.log('[Server] 🔧 Creating v2_company_name_unique compound index...');
                await v2TradeCategory.collection.createIndex(
                    { companyId: 1, name: 1 }, 
                    { unique: true, name: 'v2_company_name_unique' }
                );
                console.log('[Server] ✅ Created v2_company_name_unique index');
            }
            
            console.log('[Server] ✅ v2TradeCategory indexes verified for multi-tenancy');
        } catch (indexError) {
            console.error('[Server] ⚠️  Index check/fix warning:', indexError.message);
            // Don't crash server - indexes might already be correct
        }
        
        // Fix broken unique index on GlobalInstantResponseTemplate.categories.scenarios.scenarioId
        // This index prevents adding new categories - must be dropped
        try {
            const GlobalInstantResponseTemplate = require('./models/GlobalInstantResponseTemplate');
            const dropped = await GlobalInstantResponseTemplate.dropBrokenScenarioIdIndex();
            if (dropped) {
                console.log('[Server] ✅ Fixed GlobalInstantResponseTemplate: broken scenarioId index dropped');
            }
        } catch (indexFixError) {
            console.warn('[Server] ⚠️ Could not check GlobalInstantResponseTemplate indexes:', indexFixError.message);
        }
        
        // V2 DELETED: Legacy agent prompts loading - V2 uses aiAgentSettings system
        console.log('[Server] Step 3/6: Skipping legacy agent prompts (V2 uses aiAgentSettings)...');
        console.log(`[Server] ✅ Step 3 COMPLETE: Legacy agent prompts skipped - V2 system active`);
        
        console.log('[Server] Step 4/6: V2 DELETED - Legacy backup monitoring eliminated...');
        const backupStart = Date.now();
        // V2 DELETED: Legacy BackupMonitoringService - v2 bloat eliminated
        // const backupMonitoring = new BackupMonitoringService();
        // backupMonitoring.start();
        logger.info('🔄 V2 SYSTEM: Backup monitoring service eliminated - using simple V2 architecture');
        console.log(`[Server] ✅ Step 4 COMPLETE: Legacy backup monitoring eliminated in ${Date.now() - backupStart}ms`);
        
        console.log('[Server] Step 5/6: Preparing to bind to port...');
        const PORT = process.env.PORT || 3000;
        console.log(`[Server] Target port: ${PORT}, bind address: 0.0.0.0`);
        
        console.log('[Server] Step 6/6: Starting HTTP server...');
        const serverStart = Date.now();
        
        // Initialize Data Center Auto-Purge Cron
        console.log('[Server] Initializing Data Center auto-purge cron...');
        const { initializeAutoPurgeCron } = require('./services/autoPurgeCron');
        initializeAutoPurgeCron();
        
        // Initialize Critical Data Health Check (PROACTIVE MONITORING)
        console.log('[Server] Initializing Critical Data Health Check...');
        const CriticalDataHealthCheck = require('./services/CriticalDataHealthCheck');
        
        // Run immediately on startup
        setTimeout(async () => {
            try {
                console.log('🏥 [HEALTH CHECK] Running initial health check...');
                await CriticalDataHealthCheck.runAllChecks();
                console.log('🏥 [HEALTH CHECK] Initial check complete');
            } catch (error) {
                console.error('🏥 [HEALTH CHECK] Initial check failed:', error.message);
            }
        }, 5000); // Wait 5 seconds for server to stabilize
        
        // Run every 30 minutes
        const healthCheckInterval = setInterval(async () => {
            try {
                console.log('🏥 [HEALTH CHECK] Running scheduled health check...');
                await CriticalDataHealthCheck.runAllChecks();
            } catch (error) {
                console.error('🏥 [HEALTH CHECK] Scheduled check failed:', error.message);
            }
        }, 30 * 60 * 1000); // 30 minutes
        
        console.log('[Server] ✅ Critical Data Health Check initialized (runs every 30 min)');
        
        console.log('[Server] Step 6/6: Binding to port FIRST (AI Gateway health checks deferred)...');
        
        return app.listen(PORT, '0.0.0.0', () => {
            console.log(`[Server] ✅ Step 6 COMPLETE: HTTP server bound in ${Date.now() - serverStart}ms`);
            console.log(`🎉 SERVER FULLY OPERATIONAL!`);
            console.log(`🌐 Admin dashboard listening at http://0.0.0.0:${PORT}`);
            console.log(`📊 Node environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🎯 Server ready to accept connections on port ${PORT}`);
            console.log(`⏱️  Total startup time: ${Date.now() - routeStart}ms`);
            
            // ────────────────────────────────────────────────────────────────────────
            // POST-STARTUP: AI GATEWAY INITIALIZATION (Health Monitor & LLM Analyzer)
            // Initialize AFTER port binding to prevent blocking Render health checks
            // ────────────────────────────────────────────────────────────────────────
            setTimeout(async () => {
                // V22 NUKED: AI Gateway Health Monitor removed (legacy system)
                // All AI operations now use V22 Memory/Optimization brains (Brain-4, Brain-5)
                
                try {
                    console.log('[Post-Startup] 📊 Starting MongoDB Performance Monitor...');
                    const MongoDBPerformanceMonitor = require('./services/MongoDBPerformanceMonitor');
                    
                    // Run initial check (non-blocking)
                    MongoDBPerformanceMonitor.checkPerformanceAndAlert()
                        .then(() => console.log('[MongoDB Monitor] ✅ Initial check completed'))
                        .catch(err => console.warn('[MongoDB Monitor] ⚠️ Initial check failed (non-critical):', err.message));
                    
                    // Run every 6 hours (4x per day)
                    setInterval(async () => {
                        try {
                            await MongoDBPerformanceMonitor.checkPerformanceAndAlert();
                        } catch (error) {
                            console.warn('[MongoDB Monitor] ⚠️ Periodic check failed (non-critical):', error.message);
                        }
                    }, 6 * 60 * 60 * 1000); // 6 hours in milliseconds
                    
                    console.log('[Post-Startup] ✅ MongoDB Performance Monitor scheduled (runs every 6 hours)');
                } catch (error) {
                    console.error('[Post-Startup] ❌ Failed to start MongoDB Performance Monitor:', error.message);
                    // Non-blocking: server continues even if monitor fails
                }
                
                // V22 NUKED: AI Gateway LLM Analyzer removed (legacy system)
                // LLM learning now handled by PostCallLearningService (V22)
                
                // 📋 PHASE C.0: Start LLM Learning Worker for Tier-3 event processing
                try {
                    console.log('[Post-Startup] 📋 Starting LLM Learning Worker (Tier-3 event processor)...');
                    const LLMLearningWorker = require('./services/LLMLearningWorker');
                    LLMLearningWorker.start(30000); // Run every 30 seconds
                    console.log('[Post-Startup] ✅ LLM Learning Worker started (processes Tier-3 events every 30s)');
                } catch (error) {
                    console.error('[Post-Startup] ❌ Failed to start LLM Learning Worker:', error.message);
                    // Non-blocking: server continues even if worker fails to start
                }
            }, 10000); // Wait 10 seconds after server starts to begin health checks
            
            // 🤖 AUTO-OPTIMIZATION SCHEDULER - DISABLED (Missing dependency: smartThresholdOptimizer)
            // TODO: Re-enable when smartThresholdOptimizer is implemented
            // try {
            //     const autoOptimizationScheduler = require('./services/v2autoOptimizationScheduler');
            //     autoOptimizationScheduler.start();
            //     console.log(`[INIT] 🤖 Auto-optimization scheduler started - checking every hour`);
            // } catch (error) {
            //     console.error(`[INIT] ❌ Failed to start auto-optimization scheduler:`, error.message);
            // }
            console.log(`[INIT] ℹ️  Auto-optimization scheduler disabled (optional feature)`);
        });
    } catch (err) {
        console.error('[Server Startup] ❌ CRITICAL ERROR - Server startup failed!');
        console.error('[Server Startup] Error details:', err.message);
        console.error('[Server Startup] Stack trace:', err.stack);
        console.error('[Server Startup] Environment variables check:');
        console.error('  - PORT:', process.env.PORT);
        console.error('  - NODE_ENV:', process.env.NODE_ENV);
        console.error('  - MONGODB_URI present:', Boolean(process.env.MONGODB_URI));
        throw err;
    }
}

if (require.main === module) {
    // If this file is executed directly, start the server
    startServer();
}

// ============================================================================
// PRODUCTION 404 MONITORING (Global Counter)
// ============================================================================
// Track 404 rate and send alerts if threshold exceeded
// This must be declared before registerRoutes() is called
// ============================================================================

let notFoundCount = 0;
let lastResetTime = Date.now();

// Reset counter every minute and check threshold
setInterval(() => {
    const currentTime = Date.now();
    const elapsedMinutes = (currentTime - lastResetTime) / 60000;
    
    if (notFoundCount > 10) {
        console.warn(`⚠️ [404 MONITORING] High 404 rate: ${notFoundCount} in last ${elapsedMinutes.toFixed(1)} minute(s)`);
        
        // Send alert via AdminNotificationService
        try {
            const AdminNotificationService = require('./services/AdminNotificationService');
            AdminNotificationService.sendAlert({
                code: 'HIGH_404_RATE',
                severity: 'WARNING',
                message: `High 404 error rate detected: ${notFoundCount} requests in ${elapsedMinutes.toFixed(1)} minute(s)`,
                details: 'Check for broken links, missing routes, or incorrect API calls. Review recent deployments.'
            }).catch(err => console.error('Failed to send 404 alert:', err));
        } catch (error) {
            console.error('❌ Failed to send 404 rate alert:', error.message);
        }
    }
    
    notFoundCount = 0;
    lastResetTime = currentTime;
}, 60000); // Check every minute

// ============================================================================
// GENERAL ERROR HANDLER
// ============================================================================

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
