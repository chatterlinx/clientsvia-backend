// Twilio Webhook Router - V3
// GLOBAL MULTI-TENANT PLATFORM
// CRITICAL: All changes affect ALL companies - no company-specific hardcoding
// POST-IT REMINDER: Use company.aiSettings for per-company configuration
// NEVER hardcode company IDs or special treatment for any single company
// ALWAYS design for global platform scalability
// TEST: "Would this work for company #1000 tomorrow?" If NO, fix it!
const express = require('express');
const logger = require('../utils/logger.js');
logger.debug('🚀 [V2TWILIO] ========== LOADING v2twilio.js FILE ==========');

// ============================================================================
// 📊 CALL FLOW TRACER - Real-time call journey tracking
// ============================================================================
const { getTracer, removeTracer, STAGES } = require('../services/CallFlowTracer');

const twilio = require('twilio');
const Company = require('../models/v2Company');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const AdminSettings = require('../models/AdminSettings');
const HybridScenarioSelector = require('../services/HybridScenarioSelector');
const IntelligentRouter = require('../services/IntelligentRouter');  // 🧠 3-Tier Self-Improvement System
const MatchDiagnostics = require('../services/MatchDiagnostics');
const AdminNotificationService = require('../services/AdminNotificationService');  // 🚨 Critical error reporting
// 🚀 V2 SYSTEM: Using V2 AI Agent Runtime instead of legacy agent.js
const { initializeCall, processUserInput } = require('../services/v2AIAgentRuntime');
// V2 DELETED: Legacy aiAgentRuntime - replaced with v2AIAgentRuntime
// const aiAgentRuntime = require('../services/aiAgentRuntime');
// V2: AI responses come from AIBrain3tierllm (3-Tier Intelligence System)

// ============================================================================
// 🧠 LLM-0 ORCHESTRATION LAYER (BRAIN 1)
// ============================================================================
// LLM-0 is the master orchestrator that sits BEFORE the 3-Tier system.
// It decides: ask question, run scenario, book appointment, transfer, etc.
// The 3-Tier system (Brain 2) only runs when LLM-0 says "RUN_SCENARIO".
// Feature flag: AdminSettings.globalProductionIntelligence.llm0Enabled
// ============================================================================
// SAFE IMPORT: Wrap in try/catch to prevent startup crash if dependencies fail
let decideNextStep, LLM0TurnHandler;
try {
    const LLM0Service = require('../services/orchestration/LLM0OrchestratorService');
    decideNextStep = LLM0Service.decideNextStep;
    LLM0TurnHandler = require('../services/LLM0TurnHandler');
    logger.info('[V2TWILIO] ✅ LLM-0 Orchestration loaded successfully');
} catch (err) {
    logger.warn('[V2TWILIO] ⚠️ LLM-0 Orchestration failed to load - using fallback', { error: err.message });
    // Provide fallback that skips LLM-0
    decideNextStep = async () => null;
    LLM0TurnHandler = null;
}
// V2 DELETED: CompanyKnowledgeQnA model removed (AI Brain only)

// ============================================================================
// 📞 CALL CENTER MODULE V2 - Customer Recognition
// ============================================================================
// Identifies returning customers at call start for personalized experience.
// Race-proof: 100 concurrent calls from same number = 1 customer
// See: PROPOSAL-CALL-CENTER-MODULE-V2.md
// ============================================================================
let CallSummaryService;
try {
    CallSummaryService = require('../services/CallSummaryService');
    logger.info('[V2TWILIO] ✅ Call Center Module loaded successfully');
} catch (err) {
    logger.warn('[V2TWILIO] ⚠️ Call Center Module not available', { error: err.message });
    CallSummaryService = null;
}

const fs = require('fs');
const path = require('path');
const { synthesizeSpeech } = require('../services/v2elevenLabsService');
const { getSharedRedisClient, isRedisConfigured } = require('../services/redisClientFactory');
const { normalizePhoneNumber, extractDigits, numbersMatch, } = require('../utils/phone');

// Helper: Get Redis client safely (returns null if unavailable)
async function getRedis() {
  if (!isRedisConfigured()) return null;
  try {
    return await getSharedRedisClient();
  } catch {
    return null;
  }
}
const { stripMarkdown, cleanTextForTTS } = require('../utils/textUtils');
// Legacy personality system removed - using modern AI Agent Logic responseCategories

// ============================================================================
// 📼 BLACK BOX RECORDER - Enterprise Call Flight Recorder
// ============================================================================
// Records every decision point for debugging. No more Render log archaeology.
// See: black-box.html for visualization and analysis.
// ============================================================================
let BlackBoxLogger;
try {
    BlackBoxLogger = require('../services/BlackBoxLogger');
    logger.info('[V2TWILIO] ✅ Black Box Recorder loaded successfully');
} catch (err) {
    logger.warn('[V2TWILIO] ⚠️ Black Box Recorder not available', { error: err.message });
    BlackBoxLogger = null;
}

// ════════════════════════════════════════════════════════════════════════════════
// 🔒 HTTPS URL HELPER
// ════════════════════════════════════════════════════════════════════════════════
// Render (and most reverse proxies) terminate SSL, so req.protocol returns 'http'.
// This helper forces HTTPS in production to ensure Twilio can fetch our audio files.
// Without this, <Play> URLs will fail and Gather will never complete.
// ════════════════════════════════════════════════════════════════════════════════
function getSecureBaseUrl(req) {
  const host = req.get('host');
  // Force HTTPS in production (behind Render proxy)
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
  return `${protocol}://${host}`;
}

// ============================================================================
// 🧠 3-TIER SELF-IMPROVEMENT SYSTEM CONFIGURATION
// ============================================================================
// The 3-tier intelligence system (Tier 1 → 2 → 3) is now controlled by:
// - GLOBAL MODE: AdminSettings.globalProductionIntelligence.enabled
// ☠️ REMOVED: aiAgentSettings (legacy nuked 2025-11-20)
// 
// This is checked DYNAMICALLY at request time, not via environment variable.
// UI and backend now use the SAME source of truth (database).
// ============================================================================

logger.info('🧠 [3-TIER SYSTEM] Configuration loaded from database (per-request check)');

const router = express.Router();
logger.info('🚀 [V2TWILIO] ========== EXPRESS ROUTER CREATED ==========');

// ════════════════════════════════════════════════════════════════════════════════
// 🔍 GLOBAL TWILIO REQUEST LOGGER
// ════════════════════════════════════════════════════════════════════════════════
// This middleware runs on EVERY request to /api/twilio/* BEFORE any handler.
// If a Twilio request hits our server, we log it here - even if the handler
// fails, throws, or never logs anything.
//
// If you see "📥 TWILIO INBOUND" but never see handler logs → middleware killed it.
// If you don't even see "📥 TWILIO INBOUND" → Twilio never called that URL.
// ════════════════════════════════════════════════════════════════════════════════
router.use((req, res, next) => {
    const now = new Date().toISOString();
    const isTwilioRequest = req.headers['user-agent']?.includes('Twilio') || 
                            req.headers['x-twilio-signature'];
    
    // Only log Twilio requests loudly
    if (isTwilioRequest) {
        console.log('════════════════════════════════════════════════════════════════════════════════');
        console.log(`📥 TWILIO INBOUND @ ${now}`);
        console.log(`   Path:   ${req.method} ${req.path}`);
        console.log(`   Full:   ${req.originalUrl}`);
        console.log(`   CallSid: ${req.body?.CallSid || 'N/A'}`);
        console.log(`   From:   ${req.body?.From || 'N/A'}`);
        console.log(`   Speech: "${(req.body?.SpeechResult || '').substring(0, 50)}${(req.body?.SpeechResult?.length > 50) ? '...' : ''}"`);
        console.log('════════════════════════════════════════════════════════════════════════════════');
    }
    
    next();
});

// ============================================
// 🧪 TEST RESULTS STORAGE (In-Memory)
// ============================================
// Store last 50 test results per template (circular buffer)
const testResultsStore = new Map(); // templateId -> array of results

function saveTestResult(templateId, testData) {
  if (!testResultsStore.has(templateId)) {
    testResultsStore.set(templateId, []);
  }
  
  const results = testResultsStore.get(templateId);
  results.unshift(testData); // Add to front
  
  // Keep only last 50
  if (results.length > 50) {
    results.pop();
  }
  
  logger.info(`🧪 [TEST STORE] Saved test result for template ${templateId}. Total: ${results.length}`);
}

function getTestResults(templateId, limit = 20) {
  const results = testResultsStore.get(templateId) || [];
  return results.slice(0, limit);
}

// ============================================
// 🎯 PHASE A – STEP 3B: FOLLOW-UP PLUMBING
// ============================================
/**
 * Build voice response text with follow-up question appended (if configured)
 * 
 * Applies only to voice channel.
 * Modes:
 *   - NONE: no modification
 *   - ASK_FOLLOWUP_QUESTION: append followUpQuestionText
 *   - ASK_IF_BOOK: append followUpQuestionText
 *   - TRANSFER: return unchanged (handled separately)
 * 
 * @param {String} mainText - The primary AI response text
 * @param {Object} followUpMetadata - { mode, questionText, transferTarget }
 * @returns {String} - Final text to speak (may include follow-up question)
 */
function buildFollowUpAwareText(mainText, followUpMetadata) {
  if (!followUpMetadata) {
    return mainText;
  }

  const mode = followUpMetadata.mode || 'NONE';
  const questionText = (followUpMetadata.questionText || '').trim();

  // If no mode or NONE → no change
  if (!mode || mode === 'NONE') {
    return mainText;
  }

  // For ASK_FOLLOWUP_QUESTION or ASK_IF_BOOK:
  // - Append the question text if present
  // - If missing questionText, use a safe generic fallback
  if (mode === 'ASK_FOLLOWUP_QUESTION' || mode === 'ASK_IF_BOOK') {
    const effectiveQuestion =
      questionText.length > 0
        ? questionText
        : 'Is there anything else I can help you with?';

    // Combine with a space. Keep it simple and natural.
    if (!mainText || !mainText.trim()) {
      return effectiveQuestion;
    }
    return `${mainText.trim()} ${effectiveQuestion}`;
  }

  // For TRANSFER we do NOT modify text here – transfer is handled separately
  return mainText;
}

// ============================================
// 🤖 AI ANALYSIS ENGINE
// ============================================

function analyzeTestResult(result, allScenarios) {
  const analysis = {
    missingKeywords: [],
    suggestions: [],
    issues: [],
    insights: []
  };
  
  // 1. ANALYZE MISSING KEYWORDS (caller said, but not in triggers)
  if (!result.matched && result.phrase) {
    const callerWords = result.phrase.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2) // Ignore short words
      .filter(w => !['the', 'a', 'an', 'and', 'or', 'but', 'can', 'could', 'would', 'should'].includes(w));
    
    // Find closest scenario
    const closestScenario = result.topCandidates && result.topCandidates.length > 0 
      ? result.topCandidates[0] 
      : null;
    
    if (closestScenario && closestScenario.scenarioId) {
      // Find actual scenario object
      const scenario = allScenarios.find(s => s.scenarioId === closestScenario.scenarioId || s._id?.toString() === closestScenario.scenarioId);
      
      if (scenario) {
        const triggerWords = (scenario.triggers || []).map(t => t.toLowerCase());
        const missingWords = callerWords.filter(w => !triggerWords.some(t => t.includes(w) || w.includes(t)));
        
        if (missingWords.length > 0) {
          analysis.missingKeywords = missingWords;
          analysis.suggestions.push({
            type: 'add_keyword',
            priority: 'high',
            scenarioId: scenario.scenarioId || scenario._id,
            scenarioName: scenario.name,
            keywords: missingWords,
            message: `Add "${missingWords.join('", "')}" to triggers`,
            expectedBoost: '+8-12%'
          });
        }
      }
    }
  }
  
  // 2. ANALYZE THRESHOLD ISSUES
  if (!result.matched && result.confidence >= 0.40 && result.confidence < result.threshold) {
    const gap = ((result.threshold - result.confidence) * 100).toFixed(0);
    analysis.suggestions.push({
      type: 'lower_threshold',
      priority: 'medium',
      message: `Confidence ${(result.confidence * 100).toFixed(0)}% is ${gap}% below threshold`,
      currentThreshold: result.threshold,
      suggestedThreshold: Math.max(0.35, result.confidence - 0.03),
      reason: 'Close but not quite - lower threshold or add triggers'
    });
  }
  
  // 3. ANALYZE SPEED ISSUES
  if (result.timing && result.timing.total > 100) {
    analysis.issues.push({
      type: 'slow_response',
      priority: 'medium',
      message: `Response time ${result.timing.total}ms exceeds 100ms target`,
      bottleneck: result.timing.scoring > 50 ? 'Scoring' : 'Unknown',
      suggestion: 'Consider reducing trigger count or optimizing'
    });
  }
  
  // 4. POSITIVE INSIGHTS
  if (result.matched && result.confidence > 0.70) {
    analysis.insights.push({
      type: 'strong_match',
      message: `Strong match! Confidence ${(result.confidence * 100).toFixed(0)}% indicates good trigger coverage`
    });
  }
  
  if (result.timing && result.timing.total < 50) {
    analysis.insights.push({
      type: 'excellent_speed',
      message: `⚡ Excellent speed! ${result.timing.total}ms is under 50ms target`
    });
  }
  
  return analysis;
}

// ============================================
// 🔬 FAILURE REASON ANALYZER
// ============================================

function determineFailureReason(result, allScenarios) {
  const reasons = [];
  
  // 1. Check if confidence was close
  if (result.confidence >= 0.35 && result.confidence < 0.45) {
    reasons.push({
      type: 'near_miss',
      severity: 'medium',
      message: `Close call! Only ${((0.45 - result.confidence) * 100).toFixed(0)}% below threshold`,
      fix: 'Add 1-2 more keywords or lower threshold slightly'
    });
  }
  
  // 2. Check if confidence was very low
  if (result.confidence < 0.20) {
    reasons.push({
      type: 'poor_match',
      severity: 'high',
      message: 'Very low confidence - phrase may be too vague or scenario missing',
      fix: 'Phrase needs more specific keywords or new scenario needed'
    });
  }
  
  // 3. Check if no scenarios at all
  if (allScenarios.length === 0) {
    reasons.push({
      type: 'no_scenarios',
      severity: 'CRITICAL',
      message: 'No scenarios configured in template!',
      fix: 'Add scenarios to this template'
    });
  }
  
  // 4. Check if too many scenarios (performance issue)
  if (allScenarios.length > 50) {
    reasons.push({
      type: 'too_many_scenarios',
      severity: 'low',
      message: `${allScenarios.length} scenarios may slow matching`,
      fix: 'Consider splitting into multiple templates'
    });
  }
  
  // 5. Check trace data for blocked scenarios
  if (result.trace?.scenariosBlocked > 0) {
    reasons.push({
      type: 'negative_trigger_block',
      severity: 'medium',
      message: `${result.trace.scenariosBlocked} scenarios blocked by negative triggers`,
      fix: 'Check if negative triggers are too aggressive'
    });
  }
  
  // 6. Default fuzzy matching explanation
  if (result.confidence > 0 && result.confidence < 0.45) {
    reasons.push({
      type: 'fuzzy_match_partial',
      severity: 'INFO',
      message: 'Fuzzy matching found partial keyword overlap but not enough',
      fix: 'Caller words exist in triggers but need more overlap'
    });
  }
  
  return reasons;
}

// 🚨 GLOBAL CHECKPOINT: Log ALL requests to ANY Twilio endpoint
router.use((req, res, next) => {
  logger.info('🔍 TWILIO ENDPOINT HIT:', {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    fullUrl: req.originalUrl,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'],
    contentType: req.headers['content-type'],
    bodyKeys: Object.keys(req.body || {}),
    hasCallSid: Boolean(req.body && req.body.CallSid)
  });
  next();
});

// Helper function to check if transfer is enabled
// ☠️ REMOVED: aiAgentSettings.callTransferConfig (legacy nuked 2025-11-20)
function isTransferEnabled(company) {
  // Transfer now requires explicit Twilio fallback configuration
  return company?.twilioConfig?.fallbackNumber ? true : false;
}

// Helper function to get the configured transfer number
// ☠️ REMOVED: aiAgentSettings.callTransferConfig (legacy nuked 2025-11-20)
function getTransferNumber(company) {
  // Use Twilio config fallback number only
  if (company?.twilioConfig?.fallbackNumber) {
    logger.info('[AI AGENT] Using Twilio fallback number:', company.twilioConfig.fallbackNumber);
    return company.twilioConfig.fallbackNumber;
  }
  
  // No fallback number - transfer disabled
  logger.info('[AI AGENT] No transfer number configured - transfer disabled');
  return null;
}

// Helper function to get the configured transfer message
// ☠️ REMOVED: aiAgentSettings.callTransferConfig (legacy nuked 2025-11-20)
function getTransferMessage(company) {
  // Professional transfer - never sounds like AI is giving up
  return company.connectionMessages?.voice?.transferMessage || 
         "One moment while I transfer you to our team.";
}

// Helper function to handle transfer logic with enabled check
// 🔥 NO generic fallback messages - neutral transfer only
function handleTransfer(twiml, company, fallbackMessage = "I'm connecting you to our team.", companyID = null, overrideTransferTarget = null) {
  // 🎯 PHASE A – STEP 3B: Allow scenario-specific transfer target to override company config
  const transferNumber = overrideTransferTarget || (isTransferEnabled(company) ? getTransferNumber(company) : null);
  
  if (transferNumber) {
    const transferMessage = getTransferMessage(company);
    logger.info('[AI AGENT] Transfer enabled, transferring to:', transferNumber);
    twiml.say(transferMessage);
    twiml.dial(transferNumber);
  } else if (isTransferEnabled(company)) {
    logger.info('[AI AGENT] Transfer enabled but no number configured, connecting to team');
    // 🔥 Neutral transfer message - no generic empathy
    const configResponse = `I'm connecting you to our team.`;
    twiml.say(configResponse);
    twiml.hangup();
  } else {
    logger.info('[AI AGENT] Transfer disabled, providing fallback message and continuing conversation');
    
    // Only say fallback message if one was provided (not null)
    if (fallbackMessage) {
      twiml.say(fallbackMessage);
    }
    
    // Continue conversation instead of hanging up [[memory:8276820]]
    const gather = twiml.gather({
      input: 'speech',
      speechTimeout: '3', // Matches production defaults for consistent experience
      speechModel: 'phone_call',
      action: `/api/twilio/v2-agent-respond/${companyID || 'unknown'}`,
      method: 'POST'
    });
    
    gather.say('');
    
    // V2 DELETED: Legacy responseCategories.core - using V2 Agent Personality system
    const finalFallback = `Thank you for calling. We'll make sure someone gets back to you as soon as possible.`;
    twiml.say(finalFallback);
    twiml.hangup();
  }
}

// Helper function to escape text for TwiML Say verb
function escapeTwiML(text) {
  if (!text) {return '';}
  
  // For TTS, we want clean text without HTML entities
  // Only do minimal escaping for XML structure
  return text.replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;');
}

// Helper function to get company data, with caching
// NOW ALSO CHECKS: 
//   1. Notification Center Test (for system verification)
//   2. Global AI Brain Test Templates (for admin testing)
async function getCompanyByPhoneNumber(phoneNumber) {
  const cacheKey = `company-phone:${phoneNumber}`;
  let company = null;

  try {
    // 🔔 CHECK 0: Is this Notification Center test number?
    logger.debug(`[NOTIFICATION CENTER CHECK] Checking if ${phoneNumber} is notification center test...`);
    const AdminSettings = require('../models/AdminSettings');
    const adminSettings = await AdminSettings.findOne({});
    
    if (adminSettings?.notificationCenter?.twilioTest?.enabled && 
        adminSettings.notificationCenter.twilioTest.phoneNumber === phoneNumber) {
      logger.info(`🔔 [NOTIFICATION CENTER] Test number found: ${phoneNumber}`);
      // Return a special "company" object that signals this is notification center test
      return {
        isNotificationCenterTest: true,
        settings: adminSettings,
        _id: 'notification-center',
        name: 'Notification Center Test'
      };
    }
    
    // ============================================================================
    // 🎯 UNIFIED TEST PILOT MODE SWITCHING (Template vs Company Testing)
    // ============================================================================
    // ONE phone number, TWO modes based on UI toggle:
    // - mode='template' → Test global templates in isolation (template-test)
    // - mode='company' → Test real company configurations (company-test)
    // ============================================================================
    
    logger.info(`[TEST PILOT CHECK] Checking if ${phoneNumber} is the Test Pilot number...`);
    
    const testPilotConfig = adminSettings?.globalAIBrainTest;
    
    if (testPilotConfig?.enabled && testPilotConfig.phoneNumber === phoneNumber) {
      const mode = testPilotConfig.mode || 'template'; // Default to template mode
      
      logger.info(`🎯 [TEST PILOT] Test number matched! Mode: ${mode.toUpperCase()}`);
      
      // ========================================
      // MODE 1: TEMPLATE TESTING
      // ========================================
      if (mode === 'template') {
        logger.info(`🧠 [TEST PILOT - TEMPLATE MODE] Loading global template...`);
        
        // Load the template that's currently being tested
        const testTemplate = await GlobalInstantResponseTemplate.findById(
          testPilotConfig.activeTemplateId
        );
        
        if (testTemplate) {
          logger.info(`✅ [TEST PILOT - TEMPLATE MODE] Test routing to: ${testTemplate.name}`);
          // Return a special "company" object that signals this is a test template
          return {
            isGlobalTestTemplate: true,
            template: testTemplate,
            _id: testTemplate._id,
            name: testTemplate.name,
            globalTestConfig: testPilotConfig, // Include config for greeting, etc.
            callSource: 'template-test' // Explicit call source
          };
        } else {
          logger.warn(`⚠️ [TEST PILOT - TEMPLATE MODE] activeTemplateId points to non-existent template: ${testPilotConfig.activeTemplateId}`);
        }
      }
      
      // ========================================
      // MODE 2: COMPANY TESTING
      // ========================================
      else if (mode === 'company') {
        logger.info(`🏢 [TEST PILOT - COMPANY MODE] Loading REAL company from MongoDB...`);
        
        // Load the REAL company that's being tested
        const testCompany = await Company.findById(testPilotConfig.testCompanyId);
        
        if (testCompany) {
          logger.info(`✅ [TEST PILOT - COMPANY MODE] Test routing to REAL company: ${testCompany.companyName || testCompany.businessName}`);
          logger.info(`🎯 [TEST PILOT - COMPANY MODE] Using PRODUCTION code path - this tests the EXACT customer experience!`);
          
          // Mark this as test mode for optional debugging/logging
          testCompany.isTestMode = true;
          testCompany.testGreeting = testPilotConfig.greeting || 'Currently testing {company_name}.';
          testCompany.callSource = 'company-test'; // Explicit call source
          
          // Return the REAL company (not a fake one!)
          // This will use the EXACT same code path as production customer calls!
          return testCompany;
        } else {
          logger.warn(`⚠️ [TEST PILOT - COMPANY MODE] testCompanyId points to non-existent company: ${testPilotConfig.testCompanyId}`);
        }
      }
    }
    
    // 🏢 CHECK 3: Regular company lookup (production customer calls)
    const cacheStartTime = Date.now();
    const redisClient = await getRedis();
    const cachedCompany = redisClient ? await redisClient.get(cacheKey) : null;
    if (cachedCompany) {
      logger.debug(`[CACHE HIT] [FAST] Company found in cache for ${phoneNumber} in ${Date.now() - cacheStartTime}ms`);
      company = JSON.parse(cachedCompany);
    } else {
      logger.debug(`[CACHE MISS] [SEARCH] Company not cached for ${phoneNumber}, querying database...`);
      const dbStartTime = Date.now();
      
      const digits = extractDigits(phoneNumber);
      const digitsNoCountry = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
      const searchNumbers = [phoneNumber, digits, digitsNoCountry].filter(Boolean);

      // Search in both twilioConfig.phoneNumber and twilioConfig.phoneNumbers array
      company = await Company.findOne({
        $or: [
          { 'twilioConfig.phoneNumber': { $in: searchNumbers } },
          { 'twilioConfig.phoneNumbers.phoneNumber': { $in: searchNumbers } }
        ]
      }).exec();
      
      if (!company) {
        logger.info(`[DB FALLBACK] Trying broader search for ${phoneNumber}...`);
        const all = await Company.find({
          $or: [
            { 'twilioConfig.phoneNumber': { $ne: null } },
            { 'twilioConfig.phoneNumbers': { $exists: true, $ne: [] } }
          ]
        }).exec();
        
        company = all.find((c) => {
          // Check single phoneNumber field
          if (c.twilioConfig?.phoneNumber && numbersMatch(c.twilioConfig.phoneNumber, phoneNumber)) {
            return true;
          }
          // Check phoneNumbers array
          if (c.twilioConfig?.phoneNumbers && Array.isArray(c.twilioConfig.phoneNumbers)) {
            return c.twilioConfig.phoneNumbers.some(p => numbersMatch(p.phoneNumber, phoneNumber));
          }
          return false;
        });
      }

      if (company) {
        const dbEndTime = Date.now();
        logger.debug(`[DB SUCCESS] [OK] Company found in database in ${dbEndTime - dbStartTime}ms`);
        if (redisClient) {
          await redisClient.setEx(cacheKey, 3600, JSON.stringify(company)); // Cache for 1 hour
          logger.debug(`[CACHE SAVE] 💾 Company cached for phone: ${phoneNumber}`);
        }
      } else {
        const dbEndTime = Date.now();
        logger.debug(`[DB MISS] [ERROR] No company found in database for ${phoneNumber} (${dbEndTime - dbStartTime}ms)`);
      }
    }
  } catch (err) {
    logger.error(`[CACHE/DB ERROR] [ERROR] Error fetching company by phone ${phoneNumber}:`, err.message);
    logger.error(`[Redis/DB] Error fetching company by phone ${phoneNumber}:`, err.message, err.stack);
    // Fallback to direct DB fetch if Redis fails
    const digits = extractDigits(phoneNumber);
    const digitsNoCountry = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    const searchNumbers = [phoneNumber, digits, digitsNoCountry].filter(Boolean);
    
    company = await Company.findOne({
      $or: [
        { 'twilioConfig.phoneNumber': { $in: searchNumbers } },
        { 'twilioConfig.phoneNumbers.phoneNumber': { $in: searchNumbers } }
      ]
    }).exec();
    
    if (!company) {
      const all = await Company.find({
        $or: [
          { 'twilioConfig.phoneNumber': { $ne: null } },
          { 'twilioConfig.phoneNumbers': { $exists: true, $ne: [] } }
        ]
      }).exec();
      
      company = all.find((c) => {
        // Check single phoneNumber field
        if (c.twilioConfig?.phoneNumber && numbersMatch(c.twilioConfig.phoneNumber, phoneNumber)) {
          return true;
        }
        // Check phoneNumbers array
        if (c.twilioConfig?.phoneNumbers && Array.isArray(c.twilioConfig.phoneNumbers)) {
          return c.twilioConfig.phoneNumbers.some(p => numbersMatch(p.phoneNumber, phoneNumber));
        }
        return false;
      });
    }
  }
  if (company) {
    // 🚀 V2 SYSTEM: Company Q&As loaded automatically by V2 AI Agent Runtime
    if (company._id) {
      // Legacy personality system removed - using modern AI Agent Logic responseCategories
      logger.info('🚀 Modern AI Agent Logic system active for company:', company._id.toString());
    }
  }
  return company;
}

router.post('/voice', async (req, res) => {
  const callStartTime = Date.now();
  
  // 🎯 PHASE 1 DIAGNOSTIC: Entry point marker
  console.log('═'.repeat(80));
  console.log('[🎯 ENTRY] Twilio /voice hit');
  console.log('CallSid:', req.body.CallSid);
  console.log('From:', req.body.From);
  console.log('To:', req.body.To);
  console.log('═'.repeat(80));
  
  // 🚨 CRITICAL CHECKPOINT: Log EVERYTHING at webhook entry
  logger.info('='.repeat(80));
  logger.info(`🚨 WEBHOOK HIT: /api/twilio/voice at ${new Date().toISOString()}`);
  logger.info(`🚨 FULL REQUEST BODY:`, JSON.stringify(req.body, null, 2));
  logger.info(`🚨 HEADERS:`, JSON.stringify(req.headers, null, 2));
  logger.info(`🚨 URL:`, req.url);
  logger.debug(`🚨 METHOD:`, req.method);
  logger.debug(`🚨 IP:`, req.ip || req.connection.remoteAddress);
  logger.debug('='.repeat(80));
  
  logger.debug(`[CALL START] [CALL] New call initiated at: ${new Date().toISOString()}`);
  logger.debug(`[CALL DEBUG] From: ${req.body.From} → To: ${req.body.To} | CallSid: ${req.body.CallSid}`);
  
  try {
    logger.debug('[POST /api/twilio/voice] Incoming call:', req.body);
    const calledNumber = normalizePhoneNumber(req.body.To);
    const callerNumber = normalizePhoneNumber(req.body.From);
    logger.info(`[PHONE LOOKUP] [SEARCH] Searching for company with phone: ${calledNumber}`);
    
    const company = await getCompanyByPhoneNumber(calledNumber);

    const twiml = new twilio.twiml.VoiceResponse();

    if (!company) {
      logger.info(`[ERROR] [ERROR] No company found for phone number: ${calledNumber}`);
      
      // Configuration error for unconfigured numbers
      const msg = 'Configuration error: Company must configure AI Agent Logic responses';
      twiml.say(escapeTwiML(msg));
      twiml.hangup();
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    // 🚫 SPAM FILTER - Check if call should be blocked
    const SmartCallFilter = require('../services/SmartCallFilter');
    const filterResult = await SmartCallFilter.checkCall({
      callerPhone: callerNumber,
      companyId: company._id.toString(),
      companyPhone: calledNumber,
      twilioCallSid: req.body.CallSid
    });

    // 📊 STRUCTURED SPAM LOG - For traceability
    logger.info('[SPAM-FIREWALL] decision', {
      route: '/voice',
      companyId: company._id.toString(),
      fromNumber: callerNumber,
      toNumber: calledNumber,
      decision: filterResult.shouldBlock ? 'BLOCK' : 'ALLOW',
      reason: filterResult.reason || null,
      spamScore: filterResult.spamScore || 0,
      spamFlags: filterResult.flags || [],
      callSid: req.body.CallSid,
      timestamp: new Date().toISOString()
    });

    if (filterResult.shouldBlock) {
      logger.security(`🚫 [SPAM BLOCKED] Call from ${callerNumber} blocked. Reason: ${filterResult.reason}`);
      
      // Play rejection message and hangup
      twiml.say('This call has been blocked. Goodbye.');
      twiml.hangup();
      
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    logger.security(`✅ [SPAM FILTER] Call from ${callerNumber} passed all security checks`);
    
    // ────────────────────────────────────────────────────────────────
    // 🛡️ SPAM CONTEXT: Attach spam data to session for edge case bridge
    // ────────────────────────────────────────────────────────────────
    // This allows Edge Cases to react to spam score even if call passed filter.
    // Edge cases can enforce "minSpamScore" thresholds for polite hangup.
    const spamContext = {
      spamScore: filterResult.spamScore || 0,
      spamReason: filterResult.reason || null,
      spamFlags: filterResult.flags || []
    };
    
    // Store in session for /v2-agent-respond to access
    req.session = req.session || {};
    req.session.spamContext = spamContext;

    // ============================================================================
    // 🎯 CALL SOURCE DETECTION (Phase 2: 3-Mode System)
    // ============================================================================
    // Determine call source: template-test | company-test | production
    // This context is passed to the AI runtime for proper 3-tier routing and LLM Learning
    let callSource = 'production';
    let isTest = false;
    
    if (company.isGlobalTestTemplate) {
      // Global AI Brain template testing (isolated template, no company)
      callSource = 'template-test';
      isTest = true;
    } else if (company.isTestMode) {
      // Company Test Mode (real company setup, test phone number)
      callSource = 'company-test';
      isTest = true;
    } else {
      // Real customer calling production number
      callSource = 'production';
      isTest = false;
    }
    
    // 🔍 Clear log marker for manual verification
    console.log('[CALL SOURCE]', {
      inboundNumber: calledNumber,
      callSource,
      companyId: company._id?.toString() || 'template-test',
      isGlobalTest: company.isGlobalTestTemplate || false,
      isCompanyTest: company.isTestMode || false
    });
    
    logger.info(`🎯 [CALL SOURCE] Detected: ${callSource.toUpperCase()} | Test Mode: ${isTest}`);
    
    // 🏢 COMPANY TEST MODE - Play test greeting
    if (company.isTestMode && company.testGreeting) {
      logger.info(`🏢 [COMPANY TEST MODE] Playing test greeting for company: ${company.companyName || company.businessName}`);
      
      // Replace {company_name} placeholder with actual company name
      const companyName = company.companyName || company.businessName || 'Unknown Company';
      const greeting = company.testGreeting.replace(/{company_name}/g, companyName);
      
      logger.info(`🎙️ [COMPANY TEST MODE] Greeting: "${greeting}"`);
      
      // Play test greeting
      twiml.say({
        voice: 'alice',
        language: 'en-US'
      }, greeting);
      
      // Brief pause after greeting
      twiml.pause({ length: 1 });
      
      logger.info(`✅ [COMPANY TEST MODE] Test greeting complete, continuing to AI agent...`);
      // Don't return here - let it continue to the AI agent below!
    }

    // 🔔 NOTIFICATION CENTER TEST MODE (Same pattern as Global AI Brain)
    if (company.isNotificationCenterTest) {
      logger.security(`🔔 [NOTIFICATION CENTER] Test mode activated`);
      
      const greeting = company.settings.notificationCenter.twilioTest.greeting;
      
      logger.info(`🎙️ [NOTIFICATION CENTER] Playing greeting: "${greeting.substring(0, 80)}..."`);
      
      twiml.say({
        voice: 'alice',
        language: 'en-US'
      }, greeting);
      
      twiml.hangup();
      
      // Update stats (same as Global Brain)
      company.settings.notificationCenter.twilioTest.testCallCount++;
      company.settings.notificationCenter.twilioTest.lastTestedAt = new Date();
      await company.settings.save();
      
      logger.info(`✅ [NOTIFICATION CENTER] Test call complete. Total calls: ${company.settings.notificationCenter.twilioTest.testCallCount}`);
      
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    // 🧠 GLOBAL AI BRAIN TEST MODE
    if (company.isGlobalTestTemplate) {
      logger.debug(`🧠 [GLOBAL BRAIN] Test mode activated for template: ${company.template.name}`);
      
      // Build effective fillers (template + all categories)
      const templateFillers = company.template.fillerWords || [];
      const allFillers = [...templateFillers];
      company.template.categories.forEach(category => {
        if (category.additionalFillerWords && Array.isArray(category.additionalFillerWords)) {
          allFillers.push(...category.additionalFillerWords);
        }
      });
      const effectiveFillers = [...new Set(allFillers)];
      
      // Build effective synonym map (template + all categories)
      const effectiveSynonymMap = new Map();
      if (company.template.synonymMap) {
        for (const [term, aliases] of Object.entries(company.template.synonymMap)) {
          if (Array.isArray(aliases)) {
            effectiveSynonymMap.set(term, [...aliases]);
          }
        }
      }
      company.template.categories.forEach(category => {
        if (category.synonymMap) {
          for (const [term, aliases] of Object.entries(category.synonymMap || {})) {
            if (Array.isArray(aliases)) {
              if (effectiveSynonymMap.has(term)) {
                const existing = effectiveSynonymMap.get(term);
                effectiveSynonymMap.set(term, [...new Set([...existing, ...aliases])]);
              } else {
                effectiveSynonymMap.set(term, [...aliases]);
              }
            }
          }
        }
      });
      
      const urgencyKeywords = company.template.urgencyKeywords || [];
      logger.debug(`🧠 [GLOBAL BRAIN] Selector config - Fillers: ${effectiveFillers.length}, Urgency keywords: ${urgencyKeywords.length}, Synonym terms: ${effectiveSynonymMap.size}`);
      
      // Initialize selector with merged fillers, urgency keywords, and synonym map
      const selector = new HybridScenarioSelector(effectiveFillers, urgencyKeywords, effectiveSynonymMap);
      
      // NEW: Greet the tester with custom greeting from GLOBAL config
      const rawGreeting = company.globalTestConfig?.greeting || 
        'Welcome to the ClientsVia Global AI Brain Testing Center. You are currently testing the {template_name} template. Please ask questions or make statements to test the AI scenarios now.';
      const greeting = rawGreeting.replace('{template_name}', company.template.name);
      
      logger.info(`🎙️ [GLOBAL BRAIN] Using greeting: "${greeting.substring(0, 80)}..."`);
      
      // 🎯 CRITICAL: Test Pilot must use SAME speech detection settings as real customer calls
      // This ensures testing accuracy - what you test is what customers experience
      // Using production defaults: 3s speechTimeout, 5s initialTimeout
      const gather = twiml.gather({
        input: 'speech',
        action: `/api/twilio/test-respond/${company.template._id}`,
        method: 'POST',
        timeout: 5, // Initial timeout (how long to wait for ANY speech)
        speechTimeout: '3', // Speech timeout (how long after they STOP talking) - MATCHES PRODUCTION!
        enhanced: true, // Enhanced speech recognition
        speechModel: 'phone_call', // Optimized for phone calls
        hints: 'um, uh, like, you know, so, well, I mean, and then, so anyway, basically, actually' // Help recognize common filler words
      });
      gather.say(greeting);
      
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }
    
    logger.info(`[COMPANY FOUND] [OK] Company: ${company.companyName} (ID: ${company._id})`);
    
    // 🚦 CHECK IF AI AGENT IS LIVE (Go Live Gate)
    const isLive = company.configuration?.readiness?.isLive;
    logger.info(`[GO LIVE CHECK] AI Agent status: ${isLive ? '🟢 LIVE' : '🔴 NOT LIVE YET'}`);
    
    if (!isLive) {
        logger.warn(`[NOT LIVE] Company ${company.companyName} has not activated AI Agent yet (isLive = false)`);
        
        // Get custom pre-activation message or use default
        let preActivationMessage = company.configuration?.readiness?.preActivationMessage;
        
        if (!preActivationMessage || !preActivationMessage.trim()) {
            // Fallback to default
            preActivationMessage = "Thank you for calling {companyName}. Our AI receptionist is currently being configured and will be available shortly. For immediate assistance, please call our main office line. Thank you for your patience.";
        }
        
        // Replace {companyName} placeholder
        const companyName = company.companyName || company.businessName || 'our office';
        preActivationMessage = preActivationMessage.replace(/\{companyName\}/gi, companyName);
        
        logger.info(`[NOT LIVE] Playing pre-activation message: "${preActivationMessage.substring(0, 100)}..."`);
        
        twiml.say({
            voice: 'alice',
            language: 'en-US'
        }, escapeTwiML(preActivationMessage));
        
        twiml.hangup();
        
        res.type('text/xml');
        res.send(twiml.toString());
        return;
    }
    
    logger.info(`[GO LIVE CHECK] ✅ AI Agent is LIVE - proceeding to handle call`);
    
    // 🚨 CHECK ACCOUNT STATUS - Handle suspended/forwarded accounts
    if (company.accountStatus && company.accountStatus.status) {
      const accountStatus = company.accountStatus.status;
      logger.debug(`[ACCOUNT STATUS] Company status: ${accountStatus}`);
      
      if (accountStatus === 'suspended') {
        logger.debug(`[ACCOUNT SUSPENDED] Company ${company.companyName} account is suspended`);
        logger.debug(`[ACCOUNT SUSPENDED DEBUG] Raw suspendedMessage from DB:`, company.accountStatus.suspendedMessage);
        
        // Get custom suspended message from database (NO DEFAULT MESSAGE if empty)
        let suspendedMessage = company.accountStatus.suspendedMessage;
        
        if (suspendedMessage && suspendedMessage.trim()) {
          // Replace {Company Name} placeholder (case-insensitive, with or without space)
          logger.info(`[ACCOUNT SUSPENDED] Using custom message with placeholder replacement`);
          const companyName = company.companyName || company.businessName || 'the company';
          // Match: {company name}, {companyname}, {Company Name}, {CompanyName}, etc.
          suspendedMessage = suspendedMessage.replace(/\{company\s*name\}/gi, companyName);
          logger.info(`[ACCOUNT SUSPENDED] Final message: "${suspendedMessage}"`);
          twiml.say(escapeTwiML(suspendedMessage));
        } else {
          // No custom message - use neutral transfer message
          logger.info(`[ACCOUNT SUSPENDED] No custom message set - using neutral transfer`);
          const defaultMessage = "This service is unavailable. Please contact support.";
          twiml.say(escapeTwiML(defaultMessage));
        }
        
        twiml.hangup();
        res.type('text/xml');
        res.send(twiml.toString());
        return;
      }
      
      if (accountStatus === 'call_forward' && company.accountStatus.callForwardNumber) {
        logger.debug(`[CALL FORWARD] Forwarding call to ${company.accountStatus.callForwardNumber}`);
        logger.debug(`[CALL FORWARD DEBUG] Raw callForwardMessage from DB:`, company.accountStatus.callForwardMessage);
        const forwardNumber = company.accountStatus.callForwardNumber;
        
        // Get custom forward message from text box (NO DEFAULT MESSAGE)
        let forwardMessage = company.accountStatus.callForwardMessage;
        
        if (forwardMessage && forwardMessage.trim()) {
          // Replace {Company Name} placeholder (case-insensitive, with or without space)
          logger.info(`[CALL FORWARD] Using custom message from text box with placeholder replacement`);
          const companyName = company.companyName || company.businessName || 'the company';
          // Match: {company name}, {companyname}, {Company Name}, {CompanyName}, etc.
          forwardMessage = forwardMessage.replace(/\{company\s*name\}/gi, companyName);
          logger.info(`[CALL FORWARD] Final message: "${forwardMessage}"`);
          twiml.say(escapeTwiML(forwardMessage));
        } else {
          // No message in text box - forward silently (no greeting)
          logger.info(`[CALL FORWARD] No custom message set - forwarding silently (no greeting)`);
        }
        
        twiml.dial(forwardNumber);
        res.type('text/xml');
        res.send(twiml.toString());
        return;
      }
    }
    
    logger.info(`[AI AGENT LOGIC] Using new AI Agent Logic system for company: ${company._id}`);
    
    // ════════════════════════════════════════════════════════════════════════════
    // 📞 CALL CENTER MODULE V2: Customer Recognition
    // ════════════════════════════════════════════════════════════════════════════
    // Identify returning customers for personalized experience
    // This is race-proof - 100 concurrent calls = 1 customer
    // ════════════════════════════════════════════════════════════════════════════
    let callContext = null;
    if (CallSummaryService) {
      try {
        callContext = await CallSummaryService.startCall({
          companyId: company._id.toString(),
          phone: req.body.From,
          twilioSid: req.body.CallSid,
          direction: 'inbound'
        });
        
        logger.info('[CALL CENTER] Customer recognized', {
          callId: callContext.callId,
          companyId: company._id.toString(),
          isReturning: callContext.isReturning,
          customerId: callContext.customerId,
          customerName: callContext.customerContext?.name || null,
          lookupTime: callContext.customerLookupTime
        });
        
        // Store in session for v2-agent-respond to access (survives between requests)
        req.session = req.session || {};
        req.session.callCenterContext = callContext;
        
      } catch (callCenterErr) {
        // Non-blocking: Log but continue with call
        logger.warn('[CALL CENTER] Customer recognition failed (non-blocking)', {
          error: callCenterErr.message,
          companyId: company._id.toString(),
          phone: req.body.From
        });
      }
    }
    // ════════════════════════════════════════════════════════════════════════════
    
    // ════════════════════════════════════════════════════════════════════════════
    // 📼 BLACK BOX: Initialize call recording
    // ════════════════════════════════════════════════════════════════════════════
    if (BlackBoxLogger) {
      try {
        await BlackBoxLogger.initCall({
          callId: req.body.CallSid,
          companyId: company._id,
          from: req.body.From,
          to: req.body.To,
          customerId: callContext?.customerId || null,
          customerContext: callContext?.customerContext ? {
            isReturning: callContext.isReturning || false,
            totalCalls: callContext.customerContext.totalCalls || 1,
            customerName: callContext.customerContext.name || null
          } : null
        });
      } catch (bbErr) {
        // Non-blocking: Don't let black box failures kill the call
        logger.warn('[BLACK BOX] Init failed (non-blocking)', { error: bbErr.message });
      }
    }
    // ════════════════════════════════════════════════════════════════════════════
    
    // 🚀 USE NEW V2 AI AGENT SYSTEM
    try {
      // Import V2 AI Agent Runtime - BRAND NEW SYSTEM
      const { initializeCall } = require('../services/v2AIAgentRuntime');
      
      // Initialize call with V2 Agent Personality system
      // 🎯 Phase 1: Pass callSource context for Test Pilot integration
      const initResult = await initializeCall(
        company._id.toString(),
        req.body.CallSid,
        req.body.From,
        req.body.To,
        callSource,  // 'company-test' | 'production'
        isTest       // boolean flag
      );
      
      logger.debug(`🔍 [CALL-1] Call initialized successfully`);
      logger.debug(`🔍 [CALL-2] Greeting from initializeCall:`, initResult.greeting);
      logger.debug(`🔍 [CALL-3] Voice settings from initializeCall:`, JSON.stringify(initResult.voiceSettings, null, 2));
      
      // ════════════════════════════════════════════════════════════════════════════
      // 👋 CALL CENTER V2: Personalize Initial Greeting
      // ════════════════════════════════════════════════════════════════════════════
      // If we recognized a returning customer, personalize the greeting
      let personalizedGreeting = initResult.greeting;
      if (callContext?.isReturning && callContext?.customerContext?.customerFirstName) {
        const { personalizeGreeting } = require('../utils/responseVariableSubstitution');
        personalizedGreeting = personalizeGreeting(initResult.greeting, callContext.customerContext, company);
        
        // If greeting doesn't already include their name, add a personal touch
        const firstName = callContext.customerContext.customerFirstName;
        if (!personalizedGreeting.toLowerCase().includes(firstName.toLowerCase())) {
          // Inject personalization at the start
          const companyName = company.companyName || company.businessName || 'us';
          personalizedGreeting = `Hi ${firstName}! Welcome back to ${companyName}. ${personalizedGreeting}`;
        }
        
        logger.info('[GREETING] Personalized for returning customer', {
          customerName: firstName,
          isReturning: true,
          totalCalls: callContext.customerContext.totalCalls
        });
      }
      initResult.greeting = personalizedGreeting;
      // ════════════════════════════════════════════════════════════════════════════
      
      // 📊 STRUCTURED LOG: Greeting initialized
      logger.info('[GREETING] initialized', {
        companyId: company._id.toString(),
        callSid: req.body.CallSid,
        route: '/voice',
        greetingMode: initResult.greetingConfig?.mode,
        textPreview: initResult.greeting?.slice(0, 80),
        voiceId: initResult.voiceSettings?.voiceId || null,
        timestamp: new Date().toISOString()
      });
      
      // DOUBLE-CHECK: Reload company to verify voiceSettings are in DB
      logger.debug(`🔍 [CALL-4] Double-checking voice settings from database...`);
      const freshCompany = await Company.findById(company._id);
      logger.debug(`🔍 [CALL-5] Fresh company.aiAgentSettings exists:`, Boolean(freshCompany.aiAgentSettings));
      logger.debug(`🔍 [CALL-6] Fresh company.aiAgentSettings.voiceSettings:`, JSON.stringify(freshCompany.aiAgentSettings?.voiceSettings, null, 2));
      
      logger.debug(`[V2 AGENT] Call initialized, greeting: "${initResult.greeting}"`);
      logger.debug(`[V2 VOICE] Voice settings:`, JSON.stringify(initResult.voiceSettings, null, 2));
      
      // Set up speech gathering with V2 Agent response handler
      // 📞 SPEECH DETECTION: Now configurable per company in Voice Settings
      const speechDetection = company.aiAgentSettings?.voiceSettings?.speechDetection || {};
      
      // 🐰 RABBIT HOLE CHECKPOINT #1: WHERE WILL GATHER SEND USER INPUT?
      const actionUrl = `https://${req.get('host')}/api/twilio/v2-agent-respond/${company._id}`;
      console.log('═'.repeat(80));
      console.log('[🐰 GATHER CHECKPOINT #1] Setting up <Gather> - WHERE will user speech go?');
      console.log('Action URL:', actionUrl);
      console.log('CompanyID:', company._id.toString());
      console.log('Host:', req.get('host'));
      console.log('Full Path:', `/api/twilio/v2-agent-respond/${company._id}`);
      console.log('═'.repeat(80));
      
      // Build business-relevant hints from company trade/services
      const tradeHints = company.trade ? [company.trade.toLowerCase()] : [];
      const serviceHints = (company.aiAgentSettings?.serviceTypes || [])
        .map(s => s.name?.toLowerCase())
        .filter(Boolean)
        .slice(0, 10); // Limit to 10 most important
      const defaultHints = ['appointment', 'schedule', 'emergency', 'question', 'help'];
      const hints = [...new Set([...tradeHints, ...serviceHints, ...defaultHints])].join(', ');
      
      const gather = twiml.gather({
        input: 'speech',
        action: actionUrl,
        method: 'POST',
        bargeIn: speechDetection.bargeIn ?? false,
        timeout: speechDetection.initialTimeout ?? 5,
        speechTimeout: (speechDetection.speechTimeout ?? 3).toString(),
        enhanced: speechDetection.enhancedRecognition ?? true,
        speechModel: speechDetection.speechModel ?? 'phone_call',
        hints: hints,
        partialResultCallback: `https://${req.get('host')}/api/twilio/v2-agent-partial/${company._id}`,
        partialResultCallbackMethod: 'POST'
      });

      // Use V2 Voice Settings for TTS
      const elevenLabsVoice = initResult.voiceSettings?.voiceId;
      logger.debug(`🔍 [CALL-7] Extracted voice ID from initResult: ${elevenLabsVoice || 'NOT SET'}`);
      logger.debug(`🔍 [CALL-8] Has greeting: ${Boolean(initResult.greeting)}`);
      logger.debug(`🔍 [CALL-9] Will use ElevenLabs: ${Boolean(elevenLabsVoice && initResult.greeting)}`);
      logger.debug(`[V2 VOICE CHECK] ElevenLabs Voice ID: ${elevenLabsVoice || 'NOT SET'}`);
      logger.debug(`[V2 VOICE CHECK] Has greeting: ${Boolean(initResult.greeting)}`);
      
      if (elevenLabsVoice && initResult.greeting) {
        try {
          logger.debug(`[TTS START] ✅ Using ElevenLabs voice ${elevenLabsVoice} for initial greeting`);
          logger.debug(`[TTS START] [TTS] Starting AI Agent Logic greeting TTS synthesis...`);
          const ttsStartTime = Date.now();
          
          const buffer = await synthesizeSpeech({
            text: initResult.greeting,
            voiceId: elevenLabsVoice,
            stability: company.aiAgentSettings?.voiceSettings?.stability,
            similarity_boost: company.aiAgentSettings?.voiceSettings?.similarityBoost,
            style: company.aiAgentSettings?.voiceSettings?.styleExaggeration,
            model_id: company.aiAgentSettings?.voiceSettings?.aiModel,
            company
          });
          
          const ttsTime = Date.now() - ttsStartTime;
          logger.info(`[TTS COMPLETE] [OK] AI Agent Logic greeting TTS completed in ${ttsTime}ms`);
          
          const fileName = `ai_greet_${Date.now()}.mp3`;
          const audioDir = path.join(__dirname, '../public/audio');
          if (!fs.existsSync(audioDir)) {fs.mkdirSync(audioDir, { recursive: true });}
          const filePath = path.join(audioDir, fileName);
          fs.writeFileSync(filePath, buffer);
          gather.play(`${getSecureBaseUrl(req)}/audio/${fileName}`);
          
          // 📼 BLACK BOX: Log greeting sent
          if (BlackBoxLogger) {
            BlackBoxLogger.QuickLog.greetingSent(
              req.body.CallSid,
              company._id,
              initResult.greeting,
              ttsTime
            ).catch(() => {}); // Fire and forget
          }
        } catch (err) {
          logger.error('❌ AI Agent Logic TTS failed, using Say:', err);
          logger.error('❌ Error details:', err.message);
          gather.say(escapeTwiML(initResult.greeting));
        }
      } else {
        // Fallback to Say if no voice or greeting
        logger.debug(`⚠️ Fallback to Twilio Say - Voice: ${elevenLabsVoice ? 'SET' : 'MISSING'}, Greeting: ${initResult.greeting ? 'SET' : 'MISSING'}`);
        const fallbackGreeting = initResult.greeting || "Configuration error - no greeting configured";
        gather.say(escapeTwiML(fallbackGreeting));
      }
      
      // ✅ FIX: Add fallback if no speech detected (gather timeout)
      logger.debug(`[GATHER FALLBACK] Setting up timeout fallback...`);
      twiml.say("I didn't hear anything. Please try calling back later.");
      twiml.hangup();
      
    } catch (v2Error) {
      logger.error(`[V2 AGENT ERROR] Failed to initialize V2 Agent: ${v2Error.message}`);
      logger.debug(`[FALLBACK] Using simple fallback for call`);
      
      // Fallback to simple greeting if V2 Agent fails
      const fallbackGreeting = `Configuration error - V2 Agent not configured for ${company.businessName || company.companyName}`;
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/handle-speech`,
        method: 'POST',
        bargeIn: false,
        timeout: 5,
        speechTimeout: '3', // Matches production defaults for consistent experience
        enhanced: true,
        speechModel: 'phone_call'
      });
      gather.say(escapeTwiML(fallbackGreeting));
      
      // ✅ FIX: Add fallback if no speech detected (gather timeout)
      twiml.say("I didn't hear anything. Please try calling back later.");
      twiml.hangup();
    }

    res.type('text/xml');
    const twimlString = twiml.toString();
    
    // 🐰 RABBIT HOLE CHECKPOINT #2: WHAT TWIML ARE WE SENDING TO TWILIO?
    console.log('═'.repeat(80));
    console.log('[🐰 GATHER CHECKPOINT #2] Sending TwiML to Twilio - CHECK THE ACTION URL!');
    console.log('TwiML Length:', twimlString.length);
    console.log('TwiML Content:', twimlString);
    console.log('═'.repeat(80));
    
    // 📊 STRUCTURED LOG: Gather configured (note: initResult may not be in scope for fallback path)
    logger.info('[GATHER] first-turn configured', {
      companyId: company._id.toString(),
      callSid: req.body.CallSid,
      route: '/voice',
      actionUrl: `https://${req.get('host')}/api/twilio/v2-agent-respond/${company._id}`,
      partialUrl: `https://${req.get('host')}/api/twilio/v2-agent-partial/${company._id}`,
      twimlLength: twimlString.length,
      timestamp: new Date().toISOString()
    });
    
    logger.info(`[Twilio Voice] Sending AI Agent Logic TwiML: ${twimlString}`);
    res.send(twimlString);
    
  } catch (error) {
    logger.error(`[ERROR] [CRITICAL] Voice endpoint error: ${error.message}`);
    logger.error(`[ERROR] Stack trace:`, error.stack);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    // 🔥 Minimal error message - no generic fallback text
    twiml.say('Service is temporarily unavailable. Please try again later.');
    twiml.hangup();
    
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

router.post('/handle-speech', async (req, res) => {
  const requestStartTime = Date.now();
  let confidence = 0;
  let threshold = 0.5;
  
  logger.debug(`[SPEECH START] [SPEECH] Speech processing started at: ${new Date().toISOString()}`);
  
  try {
    // Get Redis client once at start (may be null if Redis unavailable)
    const redisClient = await getRedis();
    
    logger.debug(`[TWILIO TIMING] Speech webhook received at: ${new Date().toISOString()}`);
    logger.debug(`[TWILIO TIMING] Twilio sent SpeechResult: "${req.body.SpeechResult}" with confidence: ${req.body.Confidence}`);
    logger.debug('[POST /api/twilio/handle-speech] Incoming speech:', req.body);
    const speechText = req.body.SpeechResult || '';
    const twiml = new twilio.twiml.VoiceResponse();
    const callSid = req.body.CallSid;
    const repeatKey = `twilio-repeats:${callSid}`;

    if (!speechText) {
      logger.info(`[SPEECH ERROR] [ERROR] Empty speech result received from Twilio`);
      // Legacy personality system removed - using configuration error message
      const msg = 'Configuration error: Company must configure AI Agent Logic responses';
      const fallbackText = `<Say>${escapeTwiML(msg)}</Say>`;
      twiml.hangup();
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
      return;
    }

    logger.debug(`[SPEECH RECEIVED] [TARGET] Processing speech: "${speechText}" (${speechText.length} chars)`);

    // Check for potentially unclear/incomplete speech OR rambling
    const isLikelyUnclear = (
      speechText.length < 3 || 
      /^[a-z]{1,2}\.?$/i.test(speechText.trim()) || // Single/double letters
      speechText.toLowerCase().includes('have on') || // Common misrecognition
      speechText.toLowerCase().includes('hello') && speechText.length < 10 // Just "hello"
    );
    
    const isLikelyRambling = (
      speechText.length > 300 || // Very long speech (300+ chars)
      speechText.split(' ').length > 50 || // 50+ words
      (speechText.match(/\b(and|then|so|but|also|actually|basically)\b/gi) || []).length > 5 // Too many filler words
    );
    
    if (isLikelyUnclear) {
      logger.info(`[SPEECH QUALITY] ⚠️ Potentially unclear speech detected: "${speechText}"`);
    }
    
    if (isLikelyRambling) {
      logger.info(`[SPEECH QUALITY] 📢 Rambling detected: ${speechText.length} chars, ${speechText.split(' ').length} words`);
    }

    const calledNumber = normalizePhoneNumber(req.body.To);
    logger.debug(`[COMPANY LOOKUP] [SEARCH] Looking up company for phone: ${calledNumber}`);
    const company = await getCompanyByPhoneNumber(calledNumber);
    if (!company) {
      logger.debug(`[COMPANY ERROR] [ERROR] No company found for phone: ${calledNumber} during speech processing`);
      // Legacy personality system removed - using configuration error message
      const msg = 'Configuration error: Company must configure AI Agent Logic responses';
      const fallbackText = `<Say>${escapeTwiML(msg)}</Say>`;
      twiml.hangup();
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
      return;
    }

    logger.debug(`[COMPANY CONFIRMED] [OK] Processing speech for: ${company.companyName}`);

    confidence = parseFloat(req.body.Confidence || '0');
    threshold = company.aiSettings?.twilioSpeechConfidenceThreshold ?? 0.4;
    
    logger.debug(`[CONFIDENCE CHECK] Speech: "${speechText}" | Confidence: ${confidence} | Threshold: ${threshold} | ${confidence >= threshold ? 'PASS [OK]' : 'FAIL [ERROR]'}`);
    
    if (confidence < threshold) {
      logger.info(`[CONFIDENCE REJECT] Low confidence (${confidence} < ${threshold}) - asking user to repeat`);
      const repeats = redisClient ? await redisClient.incr(repeatKey) : 1;
      if (repeats === 1 && redisClient) {
        await redisClient.expire(repeatKey, 600);
      }
      if (repeats > (company.aiSettings?.maxRepeats ?? 3)) {
        const personality = company.aiSettings?.personality || 'friendly';
        // V2: Professional max repeats message - configurable per company
        const msg = company.connectionMessages?.voice?.maxRepeatsMessage ||
                   "I want to make sure you get the help you need. Please hold while I transfer you to our team.";
        const fallbackText = `<Say>${escapeTwiML(msg)}</Say>`;
        twiml.hangup();
        if (redisClient) await redisClient.del(repeatKey);
        res.type('text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
        return;
      }
      // Use configurable speech detection settings (fallback to defaults if not set)
      const speechDetection = company.aiAgentSettings?.voiceSettings?.speechDetection || {};
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/handle-speech`,
        method: 'POST',
        bargeIn: speechDetection.bargeIn ?? (company.aiSettings?.bargeIn ?? false),
        timeout: speechDetection.initialTimeout ?? 5,
        speechTimeout: (speechDetection.speechTimeout ?? 3).toString(), // Configurable: 1-10s (default: 3s)
        enhanced: speechDetection.enhancedRecognition ?? true,
        speechModel: speechDetection.speechModel ?? 'phone_call',
        partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
      });

      const personality = company.aiSettings?.personality || 'friendly';
      
      // Create a more helpful retry message based on the type of issue
      let retryMsg;
      if (isLikelyUnclear) {
        retryMsg = "I didn't quite catch that. Could you please speak a little louder and clearer? What can I help you with today?";
      } else if (confidence < threshold * 0.6) {
        retryMsg = "I'm having trouble hearing you clearly. Could you please repeat that for me?";
      } else {
        // V2 DELETED: Legacy responseCategories.core - using V2 Agent Personality system
        retryMsg = "I want to make sure I understand what you need help with. Could you tell me a bit more about what's going on?";
      }
      
      logger.info(`[RETRY MESSAGE] Using message: "${retryMsg}" for speech: "${speechText}" (confidence: ${confidence})`);
      
      const elevenLabsVoice = company.aiAgentSettings?.voiceSettings?.voiceId;

      if (elevenLabsVoice) {
        try {
          const buffer = await synthesizeSpeech({
            text: retryMsg,
            voiceId: elevenLabsVoice,
            stability: company.aiAgentSettings?.voiceSettings?.stability,
            similarity_boost: company.aiAgentSettings?.voiceSettings?.similarityBoost,
            style: company.aiAgentSettings?.voiceSettings?.styleExaggeration,
            model_id: company.aiAgentSettings?.voiceSettings?.aiModel,
            company
          });
          
          // Store audio in Redis for fast serving
          const audioKey = `audio:retry:${callSid}`;
          if (redisClient) await redisClient.setEx(audioKey, 300, buffer.toString('base64'));
          
          const audioUrl = `https://${req.get('host')}/api/twilio/audio/retry/${callSid}`;
          gather.play(audioUrl);
        } catch (err) {
          logger.error('ElevenLabs TTS failed, falling back to <Say>:', err);
          gather.say(escapeTwiML(retryMsg));
        }
      } else {
        gather.say(escapeTwiML(retryMsg));
      }

      res.type('text/xml');
      return res.send(twiml.toString());
    }
    if (redisClient) await redisClient.del(repeatKey);

    // Process QA matching using new Company Q&A system
    const companyId = company._id.toString();
    const qnaEntries = await CompanyQnA.find({ companyId, isActive: true });
    logger.debug(`[Q&A] Loaded ${qnaEntries.length} Company Q&A entries for company ${companyId}`);
    logger.debug(`[Q&A DEBUG] Loaded Company Q&A entries for company ${companyId}:`, qnaEntries.map(e => ({
      question: e.question,
      keywords: e.keywords,
      answer: e.answer
    })));
    logger.debug(`[Q&A DEBUG] Incoming Speech: "${speechText}"`);
    
    const fuzzyThreshold = company.aiSettings?.fuzzyMatchThreshold ?? 0.3;
    logger.debug(`[Q&A MATCHING] [SEARCH] Searching ${qnaEntries.length} Q&A entries with fuzzy threshold: ${fuzzyThreshold}`);
    
    // V2 SYSTEM: Use Priority-Driven Knowledge Router instead of legacy findCachedAnswer
    logger.debug(`[V2 MIGRATION] Legacy Q&A matching disabled - use V2 AI Agent Runtime`);
    const cachedAnswer = null; // Force V2 system usage
    
    if (cachedAnswer) {
      logger.debug(`[Q&A MATCH FOUND] [OK] Found Q&A response for ${callSid}: ${cachedAnswer.substring(0, 100)}...`);
      
      // Check conversation history for repetition detection
      let conversationHistory = [];
      const historyKey = `conversation-history:${callSid}`;
      const storedHistory = redisClient ? await redisClient.get(historyKey) : null;
      if (storedHistory) {
        conversationHistory = JSON.parse(storedHistory);
      }
      
      // Check if this exact Q&A response was recently given (last 3 messages)
      const recentAssistantMessages = conversationHistory
        .filter(msg => msg.role === 'assistant')
        .slice(-3); // Last 3 assistant messages
      
      const isRepeatingQA = recentAssistantMessages.some(msg => 
        msg.text && msg.text.includes(cachedAnswer.substring(0, 50))
      );
      
      if (isRepeatingQA) {
        logger.debug(`[Q&A REPETITION] ⚠️ Same Q&A response was recently given, providing clarification instead`);
        // Generate a clarification response instead of repeating
        const clarificationResponses = [
          "I've already shared that information with you. Is there something specific you'd like to know more about?",
          `As I mentioned, ${  cachedAnswer.substring(0, 100)  }... Is there another way I can help you?`,
          "I provided those details already. Do you have any other questions I can help with?",
          "We covered that just now. What else would you like to know about our services?"
        ];
        const clarification = clarificationResponses[Math.floor(Math.random() * clarificationResponses.length)];
        
        // Use configurable speech detection settings (fallback to defaults if not set)
        const speechDetection = company.aiAgentSettings?.voiceSettings?.speechDetection || {};
        const gather = twiml.gather({
          input: 'speech',
          action: `https://${req.get('host')}/api/twilio/handle-speech`,
          method: 'POST',
          bargeIn: speechDetection.bargeIn ?? (company.aiSettings?.bargeIn ?? false),
          timeout: speechDetection.initialTimeout ?? 5,
          speechTimeout: (speechDetection.speechTimeout ?? 3).toString(), // Configurable: 1-10s (default: 3s)
          enhanced: speechDetection.enhancedRecognition ?? true,
          speechModel: speechDetection.speechModel ?? 'phone_call',
          partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
        });
        
        gather.say(escapeTwiML(clarification));
        
        // Add to conversation history
        conversationHistory.push({ role: 'user', text: speechText });
        conversationHistory.push({ role: 'assistant', text: clarification });
        if (redisClient) await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));
        
        res.type('text/xml');
        return res.send(twiml.toString());
      }
      
      logger.info(`[Q&A RESPONSE] [OK] Using Q&A response (no repetition detected)`);
      
      // Use configurable speech detection settings (fallback to defaults if not set)
      const speechDetection = company.aiAgentSettings?.voiceSettings?.speechDetection || {};
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/handle-speech`,
        method: 'POST',
        bargeIn: speechDetection.bargeIn ?? (company.aiSettings?.bargeIn ?? false),
        timeout: speechDetection.initialTimeout ?? 5,
        speechTimeout: (speechDetection.speechTimeout ?? 3).toString(), // Configurable: 1-10s (default: 3s)
        enhanced: speechDetection.enhancedRecognition ?? true,
        speechModel: speechDetection.speechModel ?? 'phone_call',
        partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
      });

      const elevenLabsVoice = company.aiAgentSettings?.voiceSettings?.voiceId;
      
      if (elevenLabsVoice) {
        try {
          const buffer = await synthesizeSpeech({
            text: cachedAnswer,
            voiceId: elevenLabsVoice,
            stability: company.aiAgentSettings?.voiceSettings?.stability,
            similarity_boost: company.aiAgentSettings?.voiceSettings?.similarityBoost,
            style: company.aiAgentSettings?.voiceSettings?.styleExaggeration,
            model_id: company.aiAgentSettings?.voiceSettings?.aiModel,
            company
          });
          
          const audioKey = `audio:qa:${callSid}`;
          if (redisClient) await redisClient.setEx(audioKey, 300, buffer.toString('base64'));
          
          const audioUrl = `https://${req.get('host')}/api/twilio/audio/qa/${callSid}`;
          gather.play(audioUrl);
        } catch (err) {
          logger.error('ElevenLabs TTS failed, falling back to <Say>:', err);
          gather.say(escapeTwiML(cachedAnswer));
        }
      } else {
        gather.say(escapeTwiML(cachedAnswer));
      }

      // Add to conversation history
      conversationHistory.push({ role: 'user', text: speechText });
      conversationHistory.push({ role: 'assistant', text: cachedAnswer });
      if (redisClient) await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));
      logger.debug(`[Q&A HISTORY] 💾 Saved Q&A exchange to conversation history`);

      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // Continue with AI processing
    const mainAgentScript = company.agentSetup?.mainAgentScript || '';
    const personality = company.aiSettings?.personality || 'friendly';
    const responseLength = company.aiSettings?.responseLength || 'concise';
    const companySpecialties = company.agentSetup?.companySpecialties || '';
    const categoryQAs = company.agentSetup?.categoryQAs || '';

    // Retrieve conversation history
    let conversationHistory = [];
    const historyKey = `conversation-history:${callSid}`;
    const storedHistory = redisClient ? await redisClient.get(historyKey) : null;
    if (storedHistory) {
      conversationHistory = JSON.parse(storedHistory);
    }

    // Add current user speech to history with context flags
    let speechContext = speechText;
    if (isLikelyUnclear || confidence < 0.7) {
      speechContext = `[Speech unclear/low confidence: "${speechText}"]`;
    } else if (isLikelyRambling) {
      speechContext = `[Long explanation: "${speechText.substring(0, 200)}..."]`;
    }
    
    conversationHistory.push({ role: 'user', text: speechContext });

    // No need to store context in Redis anymore - processing synchronously

    // Process AI response using new AI Agent Logic system
    logger.debug(`[AI AGENT LOGIC] 🤖 Starting AI response generation...`);
    const aiStartTime = Date.now();
    
    let answerObj;
    try {
      // V2 DELETED: Legacy aiAgentRuntime.processUserInput - using simple fallback
      // This endpoint should be replaced with V2 system
      logger.debug(`[LEGACY WARNING] Using legacy handle-speech endpoint - should migrate to V2`);
      
      answerObj = {
        text: company.connectionMessages?.voice?.fallbackMessage || 
              "I'm connecting you to our team.",  // 🔥 Neutral transfer message, no generic empathy
        escalate: true
      };
      
      const aiEndTime = Date.now();
      logger.info(`[AI AGENT LOGIC] [OK] AI response generated in ${aiEndTime - aiStartTime}ms`);
      logger.info(`[AI] answerQuestion result for ${callSid}:`, answerObj);

      // Add AI response to history
      conversationHistory.push({ role: 'assistant', text: answerObj.text });
      if (redisClient) await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));
      logger.debug(`[AI HISTORY] 💾 Saved conversation history (${conversationHistory.length} messages)`);

    } catch (err) {
      logger.error(`[AI ERROR] [ERROR] AI processing failed: ${err.message}`);
      logger.error(`[AI Processing Error for CallSid: ${callSid}]`, err.message, err.stack);
      // 🔥 NO FALLBACK TEXT - Transfer to human on AI error
      const fallback = company.connectionMessages?.voice?.fallbackMessage || "I'm connecting you to our team.";
      answerObj = { text: fallback, escalate: true };
    }

    // Generate TTS and respond immediately - using configurable speech detection settings
    const speechDetection = company.aiAgentSettings?.voiceSettings?.speechDetection || {};
    const gather = twiml.gather({
      input: 'speech',
      action: `https://${req.get('host')}/api/twilio/handle-speech`,
      method: 'POST',
      bargeIn: speechDetection.bargeIn ?? false,
      timeout: speechDetection.initialTimeout ?? 5,
      speechTimeout: (speechDetection.speechTimeout ?? 3).toString(), // Configurable: 1-10 seconds (default: 3s)
      enhanced: speechDetection.enhancedRecognition ?? true,
      speechModel: speechDetection.speechModel ?? 'phone_call',
      partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
    });

    const strippedAnswer = cleanTextForTTS(stripMarkdown(answerObj.text));
    const elevenLabsVoice = company.aiAgentSettings?.voiceSettings?.voiceId;
    // TTS without artificial timeouts - let it complete naturally
    if (elevenLabsVoice) {
      try {
        logger.debug(`[TTS START] [TTS] Starting ElevenLabs synthesis for: "${strippedAnswer.substring(0, 50)}..."`);
        const ttsStartTime = Date.now();
        
        // Direct TTS call without timeout interference
        const buffer = await synthesizeSpeech({
          text: strippedAnswer,
          voiceId: elevenLabsVoice,
          stability: company.aiSettings.elevenLabs?.stability,
          similarity_boost: company.aiSettings.elevenLabs?.similarityBoost,
          style: company.aiSettings.elevenLabs?.style,
          model_id: company.aiSettings.elevenLabs?.modelId,
          company
        });
        
        const ttsTime = Date.now() - ttsStartTime;
        logger.info(`[TTS COMPLETE] [OK] ElevenLabs synthesis completed in ${ttsTime}ms`);

        // Store audio in Redis for fast serving
        const audioKey = `audio:ai:${callSid}`;
        if (redisClient) await redisClient.setEx(audioKey, 300, buffer.toString('base64'));
        
        const audioUrl = `https://${req.get('host')}/api/twilio/audio/ai/${callSid}`;
        gather.play(audioUrl);
        
        // 📼 BLACK BOX: Log TTS generation
        if (BlackBoxLogger) {
          BlackBoxLogger.logEvent({
            callId: callSid,
            companyId,
            type: 'TTS_GENERATED',
            data: {
              engine: 'ElevenLabs',
              ms: ttsTime,
              textLength: strippedAnswer.length,
              audioUrl
            }
          }).catch(() => {});
        }

      } catch (err) {
        logger.error('ElevenLabs synthesis failed, falling back to native TTS:', err.message);
        // Use Twilio's enhanced TTS with voice settings to maintain consistency
        const voice = company.aiSettings?.twilioVoice || 'alice';
        gather.say({ voice }, escapeTwiML(strippedAnswer));
      }
    } else {
      // Use consistent voice even when ElevenLabs is not configured
      const voice = company.aiSettings?.twilioVoice || 'alice';
      gather.say({ voice }, escapeTwiML(strippedAnswer));
    }

    res.type('text/xml');
    const responseXML = twiml.toString();
    const requestEndTime = Date.now();
    logger.debug(`[TWILIO TIMING] Sending response at: ${new Date().toISOString()}`);
    logger.debug(`[TWILIO TIMING] Total processing time: ${requestEndTime - requestStartTime}ms`);
    logger.debug(`[TWILIO TIMING] Response XML length: ${responseXML.length} characters`);
    logger.debug(`[CONFIDENCE SUMMARY] Successfully processed speech with confidence ${confidence} (threshold: ${threshold})`);
    logger.debug(`[SPEECH COMPLETE] [OK] Speech processing completed in ${requestEndTime - requestStartTime}ms`);
    res.send(responseXML);
  } catch (err) {
    logger.error(`[SPEECH ERROR] [ERROR] Speech processing failed: ${err.message}`);
    logger.error('[POST /api/twilio/handle-speech] Error:', err.message, err.stack);
    const twiml = new twilio.twiml.VoiceResponse();
    // Legacy personality system removed - using configuration error message
    const msg = 'Configuration error: Company must configure AI Agent Logic responses';
    const fallbackText = `<Say>${escapeTwiML(msg)}</Say>`;
    twiml.hangup();
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
  }
});

// Partial speech results for faster response (experimental)
router.post('/partial-speech', async (req, res) => {
  logger.debug(`[PARTIAL SPEECH] Received at: ${new Date().toISOString()}`);
  logger.debug(`[PARTIAL SPEECH] Partial result: "${req.body.SpeechResult}" (Stability: ${req.body.Stability})`);
  
  // Just acknowledge - we'll process the final result
  res.status(200).send('OK');
});

// Diagnostic endpoint to measure exact Twilio speech timing
router.post('/speech-timing-test', async (req, res) => {
  const receiveTime = Date.now();
  logger.info(`[DIAGNOSTIC] Speech timing test received at: ${new Date().toISOString()}`);
  logger.info(`[DIAGNOSTIC] Twilio body:`, req.body);
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Immediate response with timing info
  twiml.say(`Speech received at ${new Date().toLocaleTimeString()}. Processing took ${Date.now() - receiveTime} milliseconds.`);
  
  const respondTime = Date.now();
  logger.debug(`[DIAGNOSTIC] Responding at: ${new Date().toISOString()}`);
  logger.debug(`[DIAGNOSTIC] Total processing: ${respondTime - receiveTime}ms`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Polling endpoint removed - now processing synchronously

// Direct audio serving endpoint for faster delivery
router.get('/audio/:type/:callSid', async (req, res) => {
  try {
    const { type, callSid } = req.params;
    const audioKey = `audio:${type}:${callSid}`;
    
    const redisClient = await getRedis();
    const audioBase64 = redisClient ? await redisClient.get(audioKey) : null;
    if (!audioBase64) {
      return res.status(404).send('Audio not found');
    }
    
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    
    // Set optimal headers for Twilio
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=300',
      'X-Robots-Tag': 'noindex'
    });
    
    res.send(audioBuffer);
  } catch (err) {
    logger.error('[AUDIO ENDPOINT] Error:', err);
    res.status(500).send('Audio service error');
  }
});

// 🎛️ AGENT PERFORMANCE CONTROLS - LIVE TUNING DASHBOARD
// These values come from company.aiSettings - adjust via UI, not code
// For optimization: use company profile → AI Voice Settings → Agent Performance Controls
// NO HARDCODING - all tuning happens through the live dashboard

// Add company-specific voice endpoint for Blueprint compliance
router.post('/voice/:companyID', async (req, res) => {
  const callStartTime = Date.now();
  const { companyID } = req.params;
  
  // 🚨 HIGH-VISIBILITY LOG: This route should be deprecated - watch for traffic
  logger.warn('⚠️ [TWILIO] DEPRECATED ROUTE USED: /voice/:companyID', {
    companyId: companyID,
    fromNumber: req.body.From,
    toNumber: req.body.To,
    callSid: req.body.CallSid,
    timestamp: new Date().toISOString(),
    message: 'This route is deprecated. If you see this log, investigate why traffic is still using this endpoint.'
  });
  
  // 🚨 CRITICAL CHECKPOINT: Log EVERYTHING at company-specific webhook entry
  logger.info('='.repeat(80));
  logger.info(`🚨 COMPANY WEBHOOK HIT: /api/twilio/voice/${companyID} at ${new Date().toISOString()}`);
  logger.info(`🚨 FULL REQUEST BODY:`, JSON.stringify(req.body, null, 2));
  logger.info(`🚨 HEADERS:`, JSON.stringify(req.headers, null, 2));
  logger.info(`🚨 URL:`, req.url);
  logger.info(`🚨 METHOD:`, req.method);
  logger.debug(`🚨 IP:`, req.ip || req.connection.remoteAddress);
  logger.debug('='.repeat(80));
  
  logger.debug(`[AI AGENT VOICE] [CALL] New call for company ${companyID} at: ${new Date().toISOString()}`);
  logger.debug(`[AI AGENT DEBUG] From: ${req.body.From} → CallSid: ${req.body.CallSid}`);
  
  try {
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Normalize phone numbers
    const callerNumber = normalizePhoneNumber(req.body.From);
    const calledNumber = normalizePhoneNumber(req.body.To);
    
    // Load company by ID
    const company = await Company.findById(companyID);
    if (!company) {
      logger.error(`[ERROR] Company not found: ${companyID}`);
      
      // 🚨 CRITICAL ALERT: Send to Notification Center
      await AdminNotificationService.sendAlert({
        code: 'TWILIO_COMPANY_NOT_FOUND',
        severity: 'CRITICAL',
        companyId: companyID,
        companyName: `Company ${companyID}`,
        message: `🔴 CRITICAL: Twilio call failed - Company ${companyID} not found in database`,
        details: {
          endpoint: `/api/twilio/voice/${companyID}`,
          callSid: req.body.CallSid,
          from: req.body.From,
          to: req.body.To,
          error: `Company ${companyID} does not exist in database`,
          impact: 'Caller hears error message and call disconnects. All calls to this company fail.',
          action: 'Check if company was deleted, verify Twilio webhook URL, ensure company exists in database.',
          timestamp: new Date().toISOString()
        }
      }).catch(notifErr => logger.error('Failed to send company not found alert:', notifErr));
      
      // Use configurable response instead of hardcoded message [[memory:8276820]]
      const companyNotFoundResponse = `Configuration error: Company ${companyID} not found. Each company must be properly configured in the platform.`;
      twiml.say(companyNotFoundResponse);
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    logger.info(`[AI AGENT COMPANY] ${company.businessName || company.companyName} (ID: ${companyID})`);
    
    // 🚫 SPAM FILTER - SECURED 2025-11-27
    // This deprecated route was bypassing spam filter - now secured with same logic as /voice
    const SmartCallFilter = require('../services/SmartCallFilter');
    const filterResult = await SmartCallFilter.checkCall({
      callerPhone: callerNumber,
      companyId: company._id.toString(),
      companyPhone: calledNumber,
      twilioCallSid: req.body.CallSid
    });
    
    // 📊 STRUCTURED SPAM LOG - For traceability
    logger.info('[SPAM-FIREWALL] decision', {
      route: '/voice/:companyID',
      companyId: company._id.toString(),
      fromNumber: callerNumber,
      toNumber: calledNumber,
      decision: filterResult.shouldBlock ? 'BLOCK' : 'ALLOW',
      reason: filterResult.reason || null,
      spamScore: filterResult.spamScore || 0,
      spamFlags: filterResult.flags || [],
      callSid: req.body.CallSid,
      timestamp: new Date().toISOString()
    });

    if (filterResult.shouldBlock) {
      logger.security(`🚫 [SPAM BLOCKED] Call from ${callerNumber} blocked on deprecated route. Reason: ${filterResult.reason}`);
      
      // Play rejection message and hangup
      twiml.say('This call has been blocked. Goodbye.');
      twiml.hangup();
      
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    logger.security(`✅ [SPAM FILTER] Call from ${callerNumber} passed all security checks on deprecated route`);
    
    // ────────────────────────────────────────────────────────────────
    // 🛡️ SPAM CONTEXT: Attach spam data to session for edge case bridge
    // ────────────────────────────────────────────────────────────────
    const spamContext = {
      spamScore: filterResult.spamScore || 0,
      spamReason: filterResult.reason || null,
      spamFlags: filterResult.flags || []
    };
    
    req.session = req.session || {};
    req.session.spamContext = spamContext;
    
    // ☠️ REMOVED: aiAgentSettings.enabled block (legacy nuked 2025-11-20)
    // This endpoint is now deprecated - V2 Agent handles all calls via /v2-agent-init/
    // NOTE: This route returns empty TwiML - if still in use, needs full implementation
    
    const twimlString = twiml.toString();
    logger.info('📤 CHECKPOINT 10: Sending final TwiML response');
    logger.info('📋 COMPLETE TwiML CONTENT:');
    logger.info(twimlString);
    logger.info('🚨 CRITICAL: If a "woman takes over" after this TwiML, it\'s NOT our code!');
    
    res.type('text/xml');
    res.send(twimlString);
    
  } catch (error) {
    logger.error(`[ERROR] AI Agent Voice error for company ${companyID}:`, error);
    
    // 🚨 CRITICAL ALERT: Send to Notification Center
    await AdminNotificationService.sendAlert({
      code: 'TWILIO_WEBHOOK_ERROR',
      severity: 'CRITICAL',
      companyId: companyID,
      companyName: `Company ${companyID}`,
      message: `🔴 CRITICAL: Twilio webhook /voice/${companyID} crashed`,
      details: {
        endpoint: `/api/twilio/voice/${companyID}`,
        callSid: req.body?.CallSid,
        from: req.body?.From,
        to: req.body?.To,
        error: error.message,
        stack: error.stack,
        impact: 'Caller hears error message and call disconnects. All incoming calls to this company fail until resolved.',
        action: 'Check error logs, verify company configuration, ensure AI Agent Logic is properly configured, check database connectivity.',
        timestamp: new Date().toISOString()
      },
      stackTrace: error.stack
    }).catch(notifErr => logger.error('Failed to send webhook error alert:', notifErr));
    
    const twiml = new twilio.twiml.VoiceResponse();
    // Use configurable response instead of hardcoded message [[memory:8276820]]
    const voiceErrorResponse = `Configuration error: Company ${companyID} must configure voice error responses in AI Agent Logic. Each company must have their own protocol.`;
    twiml.say(voiceErrorResponse);
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// V2 AI Agent response handler - NEW SYSTEM
router.post('/v2-agent-respond/:companyID', async (req, res) => {
  // ════════════════════════════════════════════════════════════════════════════════
  // 🚨🚨🚨 CRITICAL ENTRY POINT - v2-agent-respond HIT 🚨🚨🚨
  // ════════════════════════════════════════════════════════════════════════════════
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('🚨🚨🚨 [v2-agent-respond] ENDPOINT HIT! Twilio Gather COMPLETED! 🚨🚨🚨');
  console.log('Timestamp:', new Date().toISOString());
  console.log('CallSid:', req.body.CallSid);
  console.log('SpeechResult:', req.body.SpeechResult);
  console.log('Confidence:', req.body.Confidence);
  console.log('From:', req.body.From);
  console.log('════════════════════════════════════════════════════════════════════════════════');
  
  const callSid = req.body.CallSid || 'UNKNOWN';
  const fromNumber = req.body.From || 'UNKNOWN';
  const speechResult = req.body.SpeechResult || '';
  const { companyID } = req.params;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 📊 CALL FLOW TRACER - Track this turn
  // ═══════════════════════════════════════════════════════════════════════════
  const tracer = getTracer(callSid, companyID, fromNumber);
  tracer.newTurn(speechResult);
  tracer.step('SPEECH_RECEIVED', `Twilio delivered speech: "${speechResult?.substring(0, 40)}..."`, {
    confidence: req.body.Confidence,
    speechLength: speechResult?.length
  });
  
  try {
    const { companyID } = req.params;
    
    // 📊 STRUCTURED LOG 1: Agent Input
    logger.info('[AGENT-INPUT]', {
      companyId: companyID,
      callSid,
      fromNumber,
      toNumber: req.body.To || null,
      speechResult,
      confidence: req.body.Confidence || null,
      timestamp: new Date().toISOString()
    });
    
    // 📼 BLACK BOX: Log caller speech
    const turnCount = (req.session?.callState?.turnCount || 0) + 1;
    if (BlackBoxLogger) {
      BlackBoxLogger.QuickLog.gatherFinal(
        callSid,
        companyID,
        turnCount,
        speechResult,
        parseFloat(req.body.Confidence) || 0
      ).catch(() => {});
      
      // Also add to transcript
      BlackBoxLogger.addTranscript({
        callId: callSid,
        companyId: companyID,
        speaker: 'caller',
        turn: turnCount,
        text: speechResult,
        confidence: parseFloat(req.body.Confidence) || 0
      }).catch(() => {});
    }
    
    logger.debug('🎯 CHECKPOINT 12: Processing AI Agent Response');
    logger.debug(`🏢 Company ID: ${companyID}`);
    
    // V2 DELETED: Legacy aiAgentRuntime - replaced with v2AIAgentRuntime
    // const { processCallTurn } = require('../services/aiAgentRuntime');
    
    // 🎯 PERFORMANCE TRACKING: Start timing
    const perfStart = Date.now();
    const perfCheckpoints = { requestReceived: 0 };
    
    logger.security('🎯 CHECKPOINT 13: Initializing call state');
    
    // ════════════════════════════════════════════════════════════════════════════
    // 🔒 CRITICAL: Load call state from Redis (NOT express-session)
    // ════════════════════════════════════════════════════════════════════════════
    // Express-session with MemoryStore + sameSite:lax FAILS for Twilio webhooks!
    // Twilio makes cross-origin POST requests, and cookies may not persist.
    // Redis-based state keyed by CallSid is 100% reliable.
    // ════════════════════════════════════════════════════════════════════════════
    let callState;
    let stateLoadSource = 'FRESH';  // Track where state came from
    let redisLoadError = null;
    
    try {
      const { getSharedRedisClient } = require('../services/redisClientFactory');
      const redisClient = await getSharedRedisClient();
      
      if (redisClient) {
        const stateKey = `callState:${callSid}`;
        const savedState = await redisClient.get(stateKey);
        
        if (savedState) {
          callState = JSON.parse(savedState);
          stateLoadSource = 'REDIS';
          logger.info('[CALL STATE] 🔒 Loaded from Redis', {
            callSid,
            bookingModeLocked: !!callState.bookingModeLocked,
            bookingState: callState.bookingState,
            turnCount: callState.turnCount
          });
        } else {
          stateLoadSource = 'REDIS_EMPTY';
        }
      } else {
        stateLoadSource = 'REDIS_NULL_CLIENT';
      }
    } catch (redisErr) {
      stateLoadSource = 'REDIS_ERROR';
      redisLoadError = redisErr.message;
      logger.warn('[CALL STATE] Redis load failed, using session fallback', { 
        callSid, 
        error: redisErr.message 
      });
    }
    
    // Fallback to session or create fresh state
    if (!callState) {
      if (req.session?.callState) {
        callState = req.session.callState;
        stateLoadSource = stateLoadSource === 'FRESH' ? 'SESSION' : stateLoadSource + '_SESSION_FALLBACK';
      } else {
        callState = {
          callId: callSid,
          from: fromNumber,
          consecutiveSilences: 0,
          failedAttempts: 0,
          startTime: new Date(),
          turnCount: 0
        };
      }
    }
    
    // Increment turn count
    callState.turnCount = (callState.turnCount || 0) + 1;
    
    // 📼 BLACK BOX: Log state load for diagnostics (visible in JSON!)
    if (BlackBoxLogger) {
      BlackBoxLogger.logEvent({
        callId: callSid,
        companyId: companyID,
        type: 'STATE_LOADED',
        turn: callState.turnCount,
        data: {
          source: stateLoadSource,
          error: redisLoadError,
          bookingModeLocked: !!callState.bookingModeLocked,
          bookingState: callState.bookingState || null,
          currentBookingStep: callState.currentBookingStep || null,
          turnCount: callState.turnCount
        }
      }).catch(() => {});
    }
    
    // ────────────────────────────────────────────────────────────────
    // 🛡️ SPAM CONTEXT: Pass spam data into agent brain
    // ────────────────────────────────────────────────────────────────
    // This allows CheatSheetEngine to enforce minSpamScore thresholds
    // in edge case matching (spam → edge case bridge).
    if (req.session?.spamContext) {
      callState.spamContext = req.session.spamContext;
      logger.debug('[SPAM BRIDGE] Spam context attached to callState', {
        spamScore: callState.spamContext.spamScore,
        spamReason: callState.spamContext.spamReason
      });
    }
    
    // ────────────────────────────────────────────────────────────────
    // 👤 CALL CENTER V2: Pass customer context to AI Brain
    // ────────────────────────────────────────────────────────────────
    // This enables personalized responses: "Hi John, welcome back!"
    // And smart data collection: Skip address if we already have it.
    if (req.session?.callCenterContext?.customerContext) {
      callState.customerContext = req.session.callCenterContext.customerContext;
      callState.customerId = req.session.callCenterContext.customerId;
      callState.isReturning = req.session.callCenterContext.isReturning;
      callState.callSummaryId = req.session.callCenterContext.callId;
      
      logger.info('[CALL CENTER] Customer context attached to callState', {
        callSid,
        isReturning: callState.isReturning,
        customerName: callState.customerContext?.customerName || null,
        customerId: callState.customerId
      });
    }
    
    perfCheckpoints.callStateInit = Date.now() - perfStart;
    
    // ========================================================================
    // 🧠 LLM-0 ORCHESTRATION LAYER (NEW - BRAIN 1)
    // ========================================================================
    // Check if LLM-0 is enabled for this company/globally
    // LLM-0 decides the ACTION, then routes to 3-Tier (Brain 2) if needed
    // ========================================================================
    
    const aiProcessStart = Date.now();
    let result;
    
    try {
      // Load company and check LLM-0 feature flag
      const company = await Company.findById(companyID).lean();
      const adminSettings = await AdminSettings.findOne({}).lean();
      
      // 🧠 LOAD LLM-0 CONTROLS (Dec 2025) - Configurable brain behavior
      const LLM0ControlsLoader = require('../services/LLM0ControlsLoader');
      const llm0Controls = await LLM0ControlsLoader.load(companyID, company);
      callState.llm0Controls = llm0Controls;
      
      logger.debug('[LLM-0] Controls loaded for call', {
        callId: callSid,
        companyId: companyID,
        silenceThreshold: llm0Controls.silenceHandling.thresholdSeconds,
        spamPhraseCount: llm0Controls.spamFilter.telemarketerPhrases.length,
        neverAutoHangup: llm0Controls.customerPatience.neverAutoHangup
      });
      
      const llm0Enabled = adminSettings?.globalProductionIntelligence?.llm0Enabled === true ||
                         company?.agentSettings?.llm0Enabled === true;
      
      if (llm0Enabled && company) {
        tracer.step('BRAIN1_START', 'LLM-0 Orchestration (Brain-1) analyzing...');
        
        // STEP 1: LLM-0 decides what to do
        const llm0Decision = await decideNextStep({
          companyId: companyID,
          callId: callSid,
          userInput: speechResult,
          callState,
          turnHistory: callState.turnHistory || []
        });
        
        tracer.decision(llm0Decision?.action || 'UNKNOWN', {
          intent: llm0Decision?.intentTag,
          confidence: llm0Decision?.confidence,
          flags: llm0Decision?.flags
        });
        
        // STEP 2: Route through Triage and execute
        result = await LLM0TurnHandler.handle({
          decision: llm0Decision,
          company,
          callState,
          userInput: speechResult
        });
        
        logger.info('[LLM-0] Turn complete', {
          companyId: companyID,
          callSid,
          finalAction: result.action,
          shouldTransfer: result.shouldTransfer,
          shouldHangup: result.shouldHangup
        });
        
      } else {
        // Legacy path: Use V2 AI Agent Runtime directly
        tracer.step('BRAIN2_START', 'Using legacy V2 AI Agent Runtime (Brain-2 direct)');
        result = await processUserInput(
          companyID,
          callSid,
          speechResult,
          callState
        );
        tracer.step('BRAIN2_RESULT', `Got response: "${result?.text?.substring(0, 40) || result?.response?.substring(0, 40)}..."`);
      }
      
    } catch (llm0Error) {
      // If LLM-0 fails, fall back to legacy system
      tracer.error('LLM-0 failed, using legacy fallback', llm0Error);
      
      result = await processUserInput(
        companyID,
        callSid,
        speechResult,
        callState
      );
      tracer.step('BRAIN2_RESULT', 'Fallback response ready');
    }
    
    perfCheckpoints.aiProcessing = Date.now() - aiProcessStart;
    
    logger.security('🎯 CHECKPOINT 15: AI Agent Runtime response received');
    logger.security('🤖 AI Response:', JSON.stringify(result, null, 2));
    
    // ════════════════════════════════════════════════════════════════════════════
    // 🔒 CRITICAL: Save call state to Redis (NOT just express-session)
    // ════════════════════════════════════════════════════════════════════════════
    // This ensures bookingModeLocked persists between Twilio webhook calls!
    // ════════════════════════════════════════════════════════════════════════════
    const updatedCallState = result.callState || callState;
    updatedCallState.turnCount = callState.turnCount; // Preserve turn count
    
    // Also save to session for backwards compatibility
    req.session = req.session || {};
    req.session.callState = updatedCallState;
    
    // 🔒 Save to Redis (primary persistence)
    let stateSaveResult = 'PENDING';
    let redisSaveError = null;
    
    try {
      const { getSharedRedisClient } = require('../services/redisClientFactory');
      const redisClient = await getSharedRedisClient();
      
      if (redisClient) {
        const stateKey = `callState:${callSid}`;
        // Expire after 1 hour (calls shouldn't last longer)
        await redisClient.setEx(stateKey, 3600, JSON.stringify(updatedCallState));
        stateSaveResult = 'REDIS_OK';
        
        logger.info('[CALL STATE] 🔒 Saved to Redis', {
          callSid,
          bookingModeLocked: !!updatedCallState.bookingModeLocked,
          bookingState: updatedCallState.bookingState,
          turnCount: updatedCallState.turnCount
        });
      } else {
        stateSaveResult = 'REDIS_NULL_CLIENT';
      }
    } catch (redisErr) {
      stateSaveResult = 'REDIS_ERROR';
      redisSaveError = redisErr.message;
      logger.error('[CALL STATE] Redis save failed!', { 
        callSid, 
        error: redisErr.message,
        bookingModeLocked: !!updatedCallState.bookingModeLocked
      });
    }
    
    // 📼 BLACK BOX: Log state save for diagnostics (visible in JSON!)
    if (BlackBoxLogger) {
      BlackBoxLogger.logEvent({
        callId: callSid,
        companyId: companyID,
        type: 'STATE_SAVED',
        turn: updatedCallState.turnCount,
        data: {
          result: stateSaveResult,
          error: redisSaveError,
          bookingModeLocked: !!updatedCallState.bookingModeLocked,
          bookingState: updatedCallState.bookingState || null,
          currentBookingStep: updatedCallState.currentBookingStep || null,
          bookingCollected: updatedCallState.bookingCollected || null
        }
      }).catch(() => {});
    }
    
    logger.security('🎯 CHECKPOINT 16: Creating TwiML response');
    const twiml = new twilio.twiml.VoiceResponse();
    
    // 🔧 FIX: Map action-based responses to legacy boolean flags for compatibility
    if (result.action === 'transfer') {
      result.shouldTransfer = true;
      result.text = result.response || "I'm connecting you to our team.";
    } else if (result.action === 'hangup') {
      result.shouldHangup = true;
      result.text = result.response || "Thank you for calling.";
    }
    
    // 📊 STRUCTURED LOG 5: Agent Output (before TwiML generation)
    logger.info('[AGENT-OUTPUT]', {
      companyId: companyID,
      callSid,
      finalAction: result.action || 'continue',
      shortResponsePreview: (result.text || '').slice(0, 160),
      willTransfer: Boolean(result.shouldTransfer),
      willHangup: Boolean(result.shouldHangup),
      timestamp: new Date().toISOString()
    });
    
    // 📼 BLACK BOX: Log agent response
    if (BlackBoxLogger) {
      const responseText = result.response || result.text || '';
      
      BlackBoxLogger.QuickLog.responseBuilt(
        callSid,
        companyID,
        turnCount,
        responseText,
        result.matchSource || result.tier || 'unknown'
      ).catch(() => {});
      
      // Add to transcript
      BlackBoxLogger.addTranscript({
        callId: callSid,
        companyId: companyID,
        speaker: 'agent',
        turn: turnCount,
        text: responseText,
        source: result.matchSource || result.tier || 'unknown'
      }).catch(() => {});
      
      // Log key events based on result
      if (result.triageCardMatched) {
        BlackBoxLogger.QuickLog.triageDecision(
          callSid, companyID, turnCount,
          result.action || 'MESSAGE_ONLY',
          result.triageCardId,
          result.triageCardMatched
        ).catch(() => {});
      }
      
      if (result.shouldTransfer) {
        BlackBoxLogger.QuickLog.transferInitiated(
          callSid, companyID, turnCount,
          result.transferTarget || 'unknown',
          result.transferReason || 'user request'
        ).catch(() => {});
      }
      
      if (result.loopDetected) {
        BlackBoxLogger.QuickLog.loopDetected(
          callSid, companyID, turnCount
        ).catch(() => {});
      }
      
      if (result.bailout) {
        BlackBoxLogger.QuickLog.bailoutTriggered(
          callSid, companyID, turnCount,
          result.bailoutType || 'unknown',
          result.bailoutReason || 'no usable response'
        ).catch(() => {});
      }
    }
    
    // Handle different response types
    if (result.shouldHangup) {
      logger.info('🎯 CHECKPOINT 17: AI decided to hang up');
      logger.info(`🗣️ Final message: "${result.text}"`);
      twiml.say(escapeTwiML(result.text));
      twiml.hangup();
      
      // 📼 BLACK BOX: Finalize call on hangup
      if (BlackBoxLogger) {
        BlackBoxLogger.finalizeCall({
          callId: callSid,
          companyId: companyID,
          callOutcome: 'COMPLETED'
        }).catch(() => {});
      }
    } else if (result.shouldTransfer) {
      logger.info('🎯 CHECKPOINT 18: AI decided to transfer call');
      logger.info(`🗣️ Transfer message: "${result.text}"`);
      
      // Get company transfer number and check if transfer is enabled
      // 🔧 PHASE 2 FIX: Use consistent company loading
      const company = await Company.findById(companyID)
        .select('+aiAgentSettings')
        .lean();
      
      // 🎤 FIX: Use ElevenLabs for transfer message, not Twilio <Say>
      const elevenLabsVoice = company?.aiAgentSettings?.voiceSettings?.voiceId;
      const transferMessage = result.text || "I'm connecting you to our team.";
      
      if (elevenLabsVoice && transferMessage) {
        try {
          logger.info(`🎤 V2 ELEVENLABS: Generating transfer message with voice ${elevenLabsVoice}`);
          const buffer = await synthesizeSpeech({
            text: transferMessage,
            voiceId: elevenLabsVoice,
            stability: company?.aiAgentSettings?.voiceSettings?.stability,
            similarity_boost: company?.aiAgentSettings?.voiceSettings?.similarityBoost,
            style: company?.aiAgentSettings?.voiceSettings?.styleExaggeration,
            model_id: company?.aiAgentSettings?.voiceSettings?.aiModel,
            company
          });
          // Save audio file and play it
          const fileName = `transfer_${Date.now()}.mp3`;
          const audioDir = path.join(__dirname, '../public/audio');
          if (!fs.existsSync(audioDir)) { fs.mkdirSync(audioDir, { recursive: true }); }
          const filePath = path.join(audioDir, fileName);
          fs.writeFileSync(filePath, buffer);
          const audioUrl = `${getSecureBaseUrl(req)}/audio/${fileName}`;
          twiml.play(audioUrl);
          logger.info(`🎤 V2 ELEVENLABS: Transfer message audio generated: ${audioUrl}`);
        } catch (err) {
          logger.error('❌ ElevenLabs transfer TTS failed, using Say fallback:', err);
          twiml.say(escapeTwiML(transferMessage));
        }
      } else {
        // Fallback to Twilio Say if no voice configured
        twiml.say(escapeTwiML(transferMessage));
      }
      
      logger.info('🎯 CHECKPOINT 19: Calling handleTransfer function');
      // Pass null for fallbackMessage since we already spoke the transfer message above
      handleTransfer(twiml, company, null, companyID);
      
      // 📼 BLACK BOX: Finalize call on transfer
      if (BlackBoxLogger) {
        BlackBoxLogger.finalizeCall({
          callId: callSid,
          companyId: companyID,
          callOutcome: 'TRANSFERRED'
        }).catch(() => {});
      }
    } else {
      logger.info('🎯 CHECKPOINT 20: AI continuing conversation');
      logger.info(`🗣️ AI Response: "${result.response}"`);
      
      // 🎤 V2 ELEVENLABS INTEGRATION: Use ElevenLabs if configured
      // 🔧 PHASE 2 FIX: Explicitly load voice settings (was incomplete before)
      const company = await Company.findById(companyID)
        .select('+aiAgentSettings')
        .lean();
      
      // 🎯 PHASE 2 DIAGNOSTIC: Enhanced voice settings debug
      console.log('═'.repeat(80));
      console.log('[🔍 VOICE DEBUG] Second leg company load:');
      console.log('Company exists:', Boolean(company));
      console.log('Company ID:', company?._id?.toString());
      console.log('aiAgentSettings exists:', Boolean(company?.aiAgentSettings));
      console.log('voiceSettings exists:', Boolean(company?.aiAgentSettings?.voiceSettings));
      console.log('voiceId:', company?.aiAgentSettings?.voiceSettings?.voiceId || 'UNDEFINED');
      console.log('Full voiceSettings:', JSON.stringify(company?.aiAgentSettings?.voiceSettings, null, 2));
      console.log('═'.repeat(80));
      
      // 🔍 DIAGNOSTIC: Log voice settings check
      logger.info('🔍 V2 VOICE CHECK: Company loaded:', Boolean(company));
      logger.info('🔍 V2 VOICE CHECK: aiAgentSettings exists:', Boolean(company?.aiAgentSettings));
      logger.info('🔍 V2 VOICE CHECK: voiceSettings exists:', Boolean(company?.aiAgentSettings?.voiceSettings));
      logger.info('🔍 V2 VOICE CHECK: Full voiceSettings:', JSON.stringify(company?.aiAgentSettings?.voiceSettings, null, 2));
      
      const elevenLabsVoice = company?.aiAgentSettings?.voiceSettings?.voiceId;
      logger.info('🔍 V2 VOICE CHECK: Extracted voiceId:', elevenLabsVoice || 'NOT FOUND');
      
      // 🎯 PHASE A – STEP 3B: Check for follow-up mode (TRANSFER handling)
      const followUp = result.metadata?.followUp || { mode: 'NONE' };
      const followUpMode = followUp.mode || 'NONE';
      
      // 🎯 PHASE A – STEP 3B: Handle TRANSFER mode separately
      if (followUpMode === 'TRANSFER') {
        const transferTarget = (followUp.transferTarget || '').trim();
        
        if (!transferTarget) {
          logger.warn('[TWILIO] followUp mode TRANSFER configured but transferTarget is missing', {
            companyId: companyID,
            callSid: callSid,
            scenarioId: result.metadata?.scenarioId,
            scenarioName: result.metadata?.scenarioName
          });
          // Fallback: continue as normal, just speak mainText
          logger.info('🎯 CHECKPOINT 20A: TRANSFER mode but no target, continuing as NONE');
        } else {
          // Handle transfer using existing logic
          logger.info('🎯 CHECKPOINT 20A: TRANSFER mode with target, initiating transfer', {
            transferTarget,
            mainText: (result.response || result.text || '').substring(0, 50)
          });
          
          const mainText = result.response || result.text;
          if (mainText && mainText.trim()) {
            twiml.say(escapeTwiML(mainText));
          }
          
          // Use existing transfer/handoff logic
          handleTransfer(twiml, company, null, companyID, transferTarget);
          
          logger.info('📤 CHECKPOINT 22A: Sending TRANSFER TwiML response to Twilio');
          const twimlString = twiml.toString();
          logger.info('📋 TwiML Content (TRANSFER):', twimlString);
          return res.type('text/xml').send(twimlString);
        }
      }
      
      // 🎯 PHASE A – STEP 3B: Build response text with follow-up question (if ASK_FOLLOWUP_QUESTION or ASK_IF_BOOK)
      let responseText = result.response || result.text || "I'm connecting you to our team.";
      responseText = buildFollowUpAwareText(responseText, followUp);
      
      if (followUpMode === 'ASK_FOLLOWUP_QUESTION' || followUpMode === 'ASK_IF_BOOK') {
        logger.info(`[TWILIO] Follow-up mode applied: ${followUpMode}`, {
          mainText: result.response?.substring(0, 50),
          finalText: responseText.substring(0, 100)
        });
      }
      
      logger.info('🔍 V2 VOICE CHECK: Response text:', responseText);
      logger.info('🔍 V2 VOICE CHECK: Will use ElevenLabs:', Boolean(elevenLabsVoice && responseText));
      
      if (elevenLabsVoice && responseText) {
        try {
          logger.info(`🎤 V2 ELEVENLABS: Using voice ${elevenLabsVoice} for response`);
          
          // Generate ElevenLabs audio
          const ttsStart = Date.now();
          const { synthesizeSpeech } = require('../services/v2elevenLabsService');
          const audioBuffer = await synthesizeSpeech({
            text: responseText,
            voiceId: elevenLabsVoice,
            stability: company.aiAgentSettings?.voiceSettings?.stability,
            similarity_boost: company.aiAgentSettings?.voiceSettings?.similarityBoost,
            style: company.aiAgentSettings?.voiceSettings?.styleExaggeration,
            use_speaker_boost: company.aiAgentSettings?.voiceSettings?.speakerBoost,
            model_id: company.aiAgentSettings?.voiceSettings?.aiModel,
            company  // ✅ CRITICAL FIX: Pass company object for API key lookup
          });
          perfCheckpoints.ttsGeneration = Date.now() - ttsStart;
          
          const timestamp = Date.now();
          let audioUrl;
          let storageMethod = 'unknown';
          
          // 🔥 CRITICAL FIX: Fallback to disk if Redis unavailable
          const storageStart = Date.now();
          const audioRedis = await getRedis();
          if (audioRedis) {
            // Store audio in Redis for serving (preferred method)
            const audioKey = `audio:v2:${callSid}_${timestamp}`;
            await audioRedis.setEx(audioKey, 300, audioBuffer.toString('base64'));
            audioUrl = `https://${req.get('host')}/api/twilio/audio/v2/${callSid}_${timestamp}`;
            storageMethod = 'Redis';
            logger.info(`✅ V2 ELEVENLABS: Audio stored in Redis at ${audioUrl}`);
          } else {
            // Fallback: Save to disk if Redis is unavailable
            const fileName = `ai_response_${timestamp}.mp3`;
            const audioDir = path.join(__dirname, '../public/audio');
            if (!fs.existsSync(audioDir)) {
              fs.mkdirSync(audioDir, { recursive: true });
            }
            const filePath = path.join(audioDir, fileName);
            fs.writeFileSync(filePath, audioBuffer);
            audioUrl = `${getSecureBaseUrl(req)}/audio/${fileName}`;
            storageMethod = 'Disk (Redis unavailable)';
            logger.warn(`⚠️ V2 ELEVENLABS: Redis unavailable, saved to disk at ${audioUrl}`);
          }
          perfCheckpoints.audioStorage = Date.now() - storageStart;
          perfCheckpoints.storageMethod = storageMethod;
          
          twiml.play(audioUrl);
          
        } catch (elevenLabsError) {
          logger.error('❌ V2 ELEVENLABS: Failed, falling back to Twilio voice:', {
            error: elevenLabsError.message,
            stack: elevenLabsError.stack,
            voiceId: elevenLabsVoice,
            responseTextLength: responseText?.length,
            hasCompany: !!company
          });
          // Fallback to Twilio voice
          twiml.say({
            voice: result.controlFlags?.tone === 'robotic' ? 'Polly.Joanna' : 'alice'
          }, escapeTwiML(responseText));
        }
      } else {
        // Use Twilio voice as fallback
        logger.info('🎤 V2 FALLBACK: Using Twilio voice (no ElevenLabs configured)');
        twiml.say({
          voice: result.controlFlags?.tone === 'robotic' ? 'Polly.Joanna' : 'alice'
        }, escapeTwiML(responseText));
      }
      
      logger.info('🎯 CHECKPOINT 21: Setting up next speech gathering');
      // Set up next gather - using configurable speech detection settings
      const speechDetection = company.aiAgentSettings?.voiceSettings?.speechDetection || {};
      const gather = twiml.gather({
        input: 'speech',
        speechTimeout: (speechDetection.speechTimeout ?? 3).toString(), // Configurable: 1-10 seconds (default: 3s)
        speechModel: speechDetection.speechModel ?? 'phone_call',
        bargeIn: speechDetection.bargeIn ?? false,
        timeout: speechDetection.initialTimeout ?? 5,
        enhanced: speechDetection.enhancedRecognition ?? true,
        action: `/api/twilio/v2-agent-respond/${companyID}`,
        method: 'POST'
      });
      
      gather.say('');
      
      // Fallback - use configurable response [[memory:8276820]]
      // Note: company already loaded above for ElevenLabs integration
      // V2: Use company-specific timeout message or intelligent default
      const timeoutMessage = company.connectionMessages?.voice?.timeoutMessage || 
                            company.connectionMessages?.voice?.text ||
                            "Thank you for calling. Please call back if you need further assistance.";
      twiml.say(timeoutMessage);
      twiml.hangup();
    }
    
    const twimlString = twiml.toString();
    logger.info('📤 CHECKPOINT 22: Sending TwiML response to Twilio');
    logger.info('📋 TwiML Content:', twimlString);
    
    // 🎯 COMPREHENSIVE PERFORMANCE SUMMARY
    const totalTime = Date.now() - perfStart;
    perfCheckpoints.total = totalTime;
    
    // Calculate percentages
    const aiPercent = ((perfCheckpoints.aiProcessing / totalTime) * 100).toFixed(1);
    const ttsPercent = perfCheckpoints.ttsGeneration ? ((perfCheckpoints.ttsGeneration / totalTime) * 100).toFixed(1) : 0;
    const storagePercent = perfCheckpoints.audioStorage ? ((perfCheckpoints.audioStorage / totalTime) * 100).toFixed(1) : 0;
    
    console.log('\n' + '═'.repeat(80));
    console.log('🎯 TWILIO CALL PERFORMANCE BREAKDOWN');
    console.log('═'.repeat(80));
    console.log(`📞 User Said: "${speechResult.substring(0, 60)}${speechResult.length > 60 ? '...' : ''}"`);
    console.log(`🤖 AI Response: "${(result.response || result.text || '').substring(0, 60)}..."`);
    console.log(`⏱️  TOTAL TIME: ${totalTime}ms`);
    console.log('');
    console.log('📊 TIME BREAKDOWN:');
    console.log(`   ├─ Call State Init: ${perfCheckpoints.callStateInit}ms`);
    console.log(`   ├─ AI Processing: ${perfCheckpoints.aiProcessing}ms (${aiPercent}%)`);
    if (perfCheckpoints.ttsGeneration) {
      console.log(`   ├─ ElevenLabs TTS: ${perfCheckpoints.ttsGeneration}ms (${ttsPercent}%) ⚠️ BOTTLENECK`);
      console.log(`   ├─ Audio Storage: ${perfCheckpoints.audioStorage}ms (${storagePercent}%) [${perfCheckpoints.storageMethod}]`);
      if (perfCheckpoints.storageMethod.includes('Disk')) {
        console.log(`   │  └─ ⚠️ WARNING: Redis unavailable, using disk fallback`);
      }
    } else {
      console.log(`   ├─ Voice: Twilio (no ElevenLabs)`);
    }
    console.log(`   └─ TwiML Generation: <1ms`);
    console.log('');
    console.log('💡 PERFORMANCE INSIGHTS:');
    if (perfCheckpoints.ttsGeneration && perfCheckpoints.ttsGeneration > 1500) {
      console.log('   • ElevenLabs TTS (~1.8s) is the main bottleneck - THIS IS NORMAL');
      console.log('   • High-quality voice synthesis requires this time');
    }
    if (perfCheckpoints.aiProcessing < 700) {
      console.log('   • ✅ AI Brain is performing excellently (<700ms)');
    }
    if (perfCheckpoints.storageMethod && perfCheckpoints.storageMethod.includes('Disk')) {
      console.log('   • ⚠️ Redis is down - investigate connection issue');
      console.log('   • Disk fallback working, but Redis would be faster');
    }
    console.log('═'.repeat(80) + '\n');
    
    tracer.step('TWIML_SEND', `Sending TwiML (${twimlString.length} bytes)`, {
      hasGather: twimlString.includes('<Gather'),
      hasHangup: twimlString.includes('<Hangup'),
      hasDial: twimlString.includes('<Dial')
    });
    
    res.type('text/xml');
    res.send(twimlString);
    
    logger.info('✅ CHECKPOINT 23: Response sent successfully', { perfCheckpoints });
    
  } catch (error) {
    const tracer = getTracer(req.body.CallSid, req.params.companyID);
    tracer.error('AI Agent Respond failed', error);
    
    logger.error('❌ CHECKPOINT ERROR: AI Agent Respond error:', error);
    logger.error('❌ Error stack:', error.stack);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Try to get the company and check if transfer is enabled
    try {
      const { companyID } = req.params;
      const company = await Company.findById(companyID);
      
      logger.info('🎯 CHECKPOINT ERROR RECOVERY: Attempting graceful error handling');
      
      // 🔥 Minimal error message - no generic empathy or explanation
      const errorResponse = `I'm connecting you to our team.`;
      
      twiml.say(errorResponse);
      handleTransfer(twiml, company, "Our team will be happy to assist you.", companyID);
    } catch (companyError) {
      logger.error('❌ CHECKPOINT DOUBLE ERROR: Could not load company for transfer:', companyError);
      // Use configurable response instead of hardcoded message [[memory:8276820]]
      const doubleErrorResponse = `Configuration error: Company ${req.params.companyID} must configure error responses in AI Agent Logic. Each company must have their own protocol.`;
      twiml.say(doubleErrorResponse);
      twiml.hangup();
    }
    
    logger.info('📤 CHECKPOINT ERROR RESPONSE: Sending error TwiML');
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// AI Agent Logic partial results handler (for real-time processing)
router.post('/ai-agent-partial/:companyID', async (req, res) => {
  try {
    const { companyID } = req.params;
    const { PartialSpeechResult, CallSid } = req.body;
    
    logger.info(`[AI AGENT PARTIAL] Company: ${companyID}, CallSid: ${CallSid}, Partial: "${PartialSpeechResult}"`);
    
    // For now, just acknowledge - could be used for real-time intent detection
    res.json({ success: true });
    
  } catch (error) {
    logger.error('[ERROR] AI Agent Partial error:', error);
    res.json({ success: false });
  }
});

// 🎯 V2 AGENT PARTIAL SPEECH CALLBACK (for real-time speech streaming)
// This is called by Twilio during speech recognition for partial results
// We return EMPTY response - NO greeting, NO Say, NO Gather
router.post('/v2-agent-partial/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { UnstableSpeechResult, StableSpeechResult, CallSid, Stability, SequenceNumber } = req.body;
    
    // 🔍 SPEECH TRACKING: Log what caller is saying in real-time
    const hasContent = Boolean(StableSpeechResult || UnstableSpeechResult);
    console.log(`📢 [PARTIAL #${SequenceNumber || '?'}] CallSid: ${CallSid?.slice(-8)}, Stable: "${StableSpeechResult || '-'}", Unstable: "${UnstableSpeechResult || '-'}", Stability: ${Stability || '?'}`);
    
    // Log cumulative speech for debugging
    if (StableSpeechResult) {
      logger.info('[V2 PARTIAL] 🎤 STABLE speech fragment detected', {
        companyId,
        callSid: CallSid?.slice(-8),
        stableSpeech: StableSpeechResult,
        stability: Stability,
        sequence: SequenceNumber
      });
      
      // 📼 BLACK BOX: Log partial speech (useful for STT debugging)
      if (BlackBoxLogger) {
        BlackBoxLogger.logEvent({
          callId: CallSid,
          companyId,
          type: 'GATHER_PARTIAL',
          data: {
            text: StableSpeechResult,
            unstableText: UnstableSpeechResult || null,
            confidence: parseFloat(Stability) || 0,
            sequence: parseInt(SequenceNumber) || 0
          }
        }).catch(() => {}); // Fire and forget
      }
    }
    
    // Return EMPTY TwiML - do NOT interrupt the call, do NOT greet
    // This is just for logging/monitoring real-time speech
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    
  } catch (error) {
    logger.error('[ERROR] V2 Agent Partial error:', error);
    // Still return empty response, never interrupt
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

// 🚨 WEBHOOK CONNECTIVITY TEST ENDPOINT
router.all('/webhook-test', (req, res) => {
  const timestamp = new Date().toISOString();
  
  logger.info('🧪 WEBHOOK TEST HIT:', {
    timestamp,
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: req.body,
    query: req.query,
    ip: req.ip || req.connection.remoteAddress
  });
  
  // Return both JSON and TwiML for testing
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    res.json({
      success: true,
      message: 'Webhook connectivity test successful',
      timestamp,
      receivedData: {
        method: req.method,
        headers: req.headers,
        body: req.body,
        query: req.query
      }
    });
  } else {
    // Return TwiML for voice webhook testing
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Webhook test successful! Your Twilio configuration is working correctly.');
    twiml.hangup();
    
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// ============================================
// 🧠 GLOBAL AI BRAIN TEST RESPONSE HANDLER
// ============================================
logger.info('🔍 [ROUTE REGISTRATION] Registering /test-respond/:templateId route...');
router.post('/test-respond/:templateId', async (req, res) => {
  logger.info(`\n${'='.repeat(80)}`);
  logger.info(`🧠 [CHECKPOINT 1] ===== ROUTE HIT ===== test-respond endpoint triggered`);
  logger.info(`🧠 [CHECKPOINT 1] Template ID: ${req.params.templateId}`);
  logger.info(`🧠 [CHECKPOINT 1] Request Method: ${req.method}`);
  logger.info(`🧠 [CHECKPOINT 1] Request Path: ${req.path}`);
  logger.info(`${'='.repeat(80)}\n`);
  
  try {
    logger.info(`🧠 [CHECKPOINT 2] Extracting parameters...`);
    const { templateId } = req.params;
    const speechText = req.body.SpeechResult || '';
    let allScenarios = []; // Declare at function scope for later use
    logger.debug(`🧠 [CHECKPOINT 2] ✅ Template ID: ${templateId}`);
    logger.debug(`🧠 [CHECKPOINT 2] ✅ Speech Input: "${speechText}"`);
    
    logger.debug(`🧠 [CHECKPOINT 3] Loading template from database...`);
    const template = await GlobalInstantResponseTemplate.findById(templateId);
    logger.debug(`🧠 [CHECKPOINT 3] ✅ Template loaded: ${template ? template.name : 'NOT FOUND'}`);
    
    // 🎯 FIX: Check GLOBAL config instead of deprecated per-template config
    logger.debug(`🧠 [CHECKPOINT 3.5] Checking global AI Brain test config...`);
    const adminSettings = await AdminSettings.getSettings();
    const globalTestEnabled = adminSettings?.globalAIBrainTest?.enabled || false;
    logger.info(`🧠 [CHECKPOINT 3] Template exists: ${Boolean(template)}`);
    logger.info(`🧠 [CHECKPOINT 3] Global testing enabled: ${globalTestEnabled}`);
    
    if (!template) {
      logger.debug(`🧠 [CHECKPOINT 3] ❌ Template not found`);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Test template not found.');
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }
    
    if (!globalTestEnabled) {
      logger.debug(`🧠 [CHECKPOINT 3] ❌ Global testing is disabled`);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Testing is currently disabled. Please enable it in the admin settings.');
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }
    
    logger.debug(`🧠 [CHECKPOINT 4] Initializing HybridScenarioSelector...`);
    logger.debug(`🧠 [CHECKPOINT 4] Categories count: ${template.categories?.length || 0}`);
    
    // ============================================
    // BUILD EFFECTIVE FILLERS (Template + All Categories)
    // ============================================
    const templateFillers = template.fillerWords || [];
    const allFillers = [...templateFillers];
    
    // Add all category-specific fillers
    template.categories.forEach(category => {
        if (category.additionalFillerWords && Array.isArray(category.additionalFillerWords)) {
            allFillers.push(...category.additionalFillerWords);
        }
    });
    
    // Deduplicate
    const effectiveFillers = [...new Set(allFillers)];
    
    // ============================================
    // BUILD EFFECTIVE SYNONYM MAP (Template + All Categories)
    // ============================================
    const effectiveSynonymMap = new Map();
    
    // Start with template-level synonyms
    if (template.synonymMap) {
        if (template.synonymMap instanceof Map) {
            for (const [term, aliases] of template.synonymMap.entries()) {
                effectiveSynonymMap.set(term, [...aliases]);
            }
        } else if (typeof template.synonymMap === 'object') {
            for (const [term, aliases] of Object.entries(template.synonymMap)) {
                if (Array.isArray(aliases)) {
                    effectiveSynonymMap.set(term, [...aliases]);
                }
            }
        }
    }
    
    // Merge category-level synonyms
    template.categories.forEach(category => {
        if (category.synonymMap) {
            const catMap = category.synonymMap instanceof Map 
                ? category.synonymMap 
                : new Map(Object.entries(category.synonymMap || {}));
            
            for (const [term, aliases] of catMap.entries()) {
                if (effectiveSynonymMap.has(term)) {
                    // Merge aliases
                    const existing = effectiveSynonymMap.get(term);
                    effectiveSynonymMap.set(term, [...new Set([...existing, ...aliases])]);
                } else {
                    effectiveSynonymMap.set(term, [...aliases]);
                }
            }
        }
    });
    
    const urgencyKeywords = template.urgencyKeywords || [];
    logger.debug(`🧠 [CHECKPOINT 4] Effective fillers: ${effectiveFillers.length} (template: ${templateFillers.length}), Urgency keywords: ${urgencyKeywords.length}, Synonym terms: ${effectiveSynonymMap.size}`);
    
    // ============================================================================
    // 🧠 3-TIER INTELLIGENCE ROUTING
    // ============================================================================
    // Route through IntelligentRouter (Tier 1 → 2 → 3) if enabled
    // Otherwise, use traditional HybridScenarioSelector (Tier 1 only)
    // ============================================================================
    
    let result;
    let tierUsed = 1;  // Track which tier was used
    let routingDetails = {};  // Store routing metadata
    
    // Extract all scenarios from template (needed for diagnostics)
    allScenarios = [];
    template.categories.forEach(category => {
      if (category.scenarios && Array.isArray(category.scenarios)) {
        allScenarios.push(...category.scenarios);
      }
    });
    
    // ============================================
    // 🧪 CRITICAL: TEST MODE - ALWAYS TEST YOUR RULES DIRECTLY!
    // ============================================
    // For testing, we MUST test the HybridScenarioSelector (your rules) directly.
    // 3-tier intelligence is for PRODUCTION calls, not for TESTING your scenarios.
    // 
    // Why? If 3-tier is enabled during testing:
    // - Tier 1 fails → escalates to Tier 3 (LLM)
    // - LLM matches the scenario instead of your rules
    // - You never know if YOUR scenarios/fillers/synonyms are working!
    // - You're just testing if OpenAI works (we already know it does!)
    //
    // Instead, we should:
    // 1. Test HybridScenarioSelector directly (your rules)
    // 2. Get confidence score (70%, 85%, etc.)
    // 3. If it fails, LLM ANALYZES WHY and suggests improvements
    // 4. You improve your template, test again until 100% without LLM
    //
    // This is how the system worked before 3-tier was added.
    // ============================================
    
    // ============================================
    // 🧠 V2: Check if 3-Tier is enabled for template testing
    // ============================================
    // Reuse adminSettings already loaded at line 1889
    const globalIntelligence = adminSettings?.globalProductionIntelligence || {};
    const USE_3_TIER_FOR_TESTING = globalIntelligence.enabled === true && globalIntelligence.testingEnabled === true;
    
    if (USE_3_TIER_FOR_TESTING) {
      // ✅ Admin enabled 3-tier for template testing
      logger.info('🧠 [3-TIER ROUTING] Starting intelligent cascade (Tier 1 → 2 → 3) for template testing');
      
      // Route through 3-tier system
      const routingResult = await IntelligentRouter.route({
        callerInput: speechText,
        template,
        company: null,  // Test mode (no company context)
        callId: `test-${templateId}-${Date.now()}`,
        context: {
          testMode: true,
          templateId,
          timestamp: new Date()
        }
      });
      
      if (routingResult.success && routingResult.matched) {
        // ✅ Match found via 3-tier system
        tierUsed = routingResult.tierUsed;
        result = {
          scenario: routingResult.scenario,
          confidence: routingResult.confidence,
          match: routingResult.scenario,
          score: routingResult.confidence
        };
        
        routingDetails = {
          tierUsed,
          tier1Confidence: routingResult.tier1Result?.confidence || 0,
          tier2Confidence: routingResult.tier2Result?.confidence || 0,
          tier3Confidence: routingResult.tier3Result?.confidence || 0,
          cost: routingResult.cost?.total || 0,
          responseTime: routingResult.performance?.totalTime || 0,
          patternsLearned: routingResult.patternsLearned?.length || 0
        };
        
        logger.info(`🧠 [3-TIER ROUTING] ✅ MATCH FOUND via Tier ${tierUsed}`);
        logger.info(`🧠 [3-TIER ROUTING] Scenario: ${result.scenario?.name}`);
        logger.info(`🧠 [3-TIER ROUTING] Confidence: ${(result.confidence * 100).toFixed(1)}%`);
        logger.info(`🧠 [3-TIER ROUTING] Cost: $${routingDetails.cost.toFixed(4)}`);
        logger.info(`🧠 [3-TIER ROUTING] Response Time: ${routingDetails.responseTime}ms`);
        
        if (tierUsed === 3 && routingDetails.patternsLearned > 0) {
          logger.info(`🧠 [3-TIER LEARNING] 🎓 Learned ${routingDetails.patternsLearned} pattern(s) - Next call will be FREE!`);
        }
        
      } else {
        // ❌ No match even after all 3 tiers
        logger.warn(`🧠 [3-TIER ROUTING] ⚠️ NO MATCH after all 3 tiers`);
        logger.warn(`🧠 [3-TIER ROUTING] Tier 1: ${(routingResult.tier1Result?.confidence * 100 || 0).toFixed(1)}%`);
        logger.warn(`🧠 [3-TIER ROUTING] Tier 2: ${(routingResult.tier2Result?.confidence * 100 || 0).toFixed(1)}%`);
        logger.warn(`🧠 [3-TIER ROUTING] Tier 3: ${(routingResult.tier3Result?.confidence * 100 || 0).toFixed(1)}%`);
        
        result = {
          scenario: null,
          confidence: routingResult.confidence || 0,
          match: null,
          score: 0
        };
        
        tierUsed = routingResult.tierUsed || 3;
        routingDetails = {
          tierUsed,
          allTiersFailed: true,
          cost: routingResult.cost?.total || 0
        };
      }
      
    } else {
      // Traditional Tier 1 only (HybridScenarioSelector)
      logger.debug(`🧠 [CHECKPOINT 4] Initializing HybridScenarioSelector (Tier 1 only)...`);
      
      // Initialize selector with merged fillers, urgency keywords, and synonym map
      const selector = new HybridScenarioSelector(effectiveFillers, urgencyKeywords, effectiveSynonymMap);
      logger.debug(`🧠 [CHECKPOINT 4] ✅ Selector initialized with ${effectiveFillers.length} filler words, ${urgencyKeywords.length} urgency keywords, and ${effectiveSynonymMap.size} synonym mappings`);
      
      logger.debug(`🧠 [CHECKPOINT 5] Running scenario matching...`);
      logger.info(`🧠 [CHECKPOINT 5] Total scenarios to match: ${allScenarios.length}`);
      result = await selector.selectScenario(speechText, allScenarios);
      logger.info(`🧠 [CHECKPOINT 5] ✅ Matching complete`);
      logger.info(`🧠 [CHECKPOINT 5] Match found: ${Boolean(result.match)}`);
      logger.info(`🧠 [CHECKPOINT 5] Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    }
    
    logger.info(`🧠 [CHECKPOINT 6] Building TwiML response...`);
    const twiml = new twilio.twiml.VoiceResponse();
    logger.info(`🧠 [CHECKPOINT 6] ✅ TwiML response object created`);
    
    if (result.scenario) {  // FIXED: was result.match, should be result.scenario
      logger.info(`🧠 [CHECKPOINT 7] ✅ MATCH FOUND!`);
      logger.info(`🧠 [CHECKPOINT 7] Scenario: ${result.scenario.name}`);
      logger.info(`🧠 [CHECKPOINT 7] Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      
      logger.info(`🧠 [CHECKPOINT 8] Selecting random reply...`);
      // Pick a random reply
      const replies = result.scenario.fullReplies && result.scenario.fullReplies.length > 0 
        ? result.scenario.fullReplies 
        : result.scenario.quickReplies || [];
      
      logger.info(`🧠 [CHECKPOINT 8] Available replies: ${replies.length}`);
      const reply = replies[Math.floor(Math.random() * replies.length)] || null;  // 🔥 NO FALLBACK
      logger.debug(`🧠 [CHECKPOINT 8] ✅ Selected reply: "${reply.substring(0, 50)}..."`);
      
      logger.debug(`🧠 [CHECKPOINT 9] Adding reply to TwiML...`);
      // Say the matched reply + debug info
      twiml.say(reply);
      twiml.pause({ length: 1 });
      
      // Build debug message with tier information if 3-tier is enabled
      let debugMessage = `You triggered the scenario: ${result.scenario.name}. Confidence: ${(result.confidence * 100).toFixed(0)} percent.`;
      
      if (USE_3_TIER_FOR_TESTING && routingDetails.tierUsed) {
        const tierNames = { 1: 'Tier 1: Rule-based', 2: 'Tier 2: Semantic', 3: 'Tier 3: LLM' };
        debugMessage += ` Matched via ${tierNames[routingDetails.tierUsed]}.`;
        
        if (routingDetails.tierUsed === 3) {
          debugMessage += ` Cost: ${(routingDetails.cost * 100).toFixed(1)} cents.`;
          if (routingDetails.patternsLearned > 0) {
            debugMessage += ` Learned ${routingDetails.patternsLearned} new pattern${routingDetails.patternsLearned > 1 ? 's' : ''}.`;
          }
        } else if (routingDetails.tierUsed === 1) {
          debugMessage += ` Cost: Free. Response time: ${routingDetails.responseTime} milliseconds.`;
        }
      } else {
        debugMessage += ` Score: ${(result.score * 100).toFixed(0)} percent.`;
      }
      
      twiml.say(debugMessage);
      logger.debug(`🧠 [CHECKPOINT 9] ✅ TwiML reply added`);
      
      logger.info(`🧠 [CHECKPOINT 10] Creating gather for continuation...`);
      // Continue conversation
      const gather = twiml.gather({
        input: 'speech',
        action: `/api/twilio/test-respond/${templateId}`,
        method: 'POST',
        timeout: 5,
        speechTimeout: '3', // Matches production defaults - what you test is what customers get!
        enhanced: true,
        speechModel: 'phone_call',
        hints: 'um, uh, like, you know, so, well, I mean, and then, so anyway, basically, actually' // Help recognize common filler words
      });
      gather.say('Say something else to test another scenario, or hang up to end the test.');
      logger.info(`🧠 [CHECKPOINT 10] ✅ Gather created`);
      
    } else {
      logger.info(`🧠 [CHECKPOINT 7] ❌ NO MATCH`);
      logger.info(`🧠 [CHECKPOINT 7] Confidence too low: ${(result.confidence * 100).toFixed(1)}%`);
      twiml.say(`No scenario matched your input. Confidence was ${(result.confidence * 100).toFixed(0)} percent, which is below the threshold.`);
      twiml.pause({ length: 1 });
      
      logger.info(`🧠 [CHECKPOINT 8] Creating gather for retry...`);
      // Continue conversation
      const gather = twiml.gather({
        input: 'speech',
        action: `/api/twilio/test-respond/${templateId}`,
        method: 'POST',
        timeout: 5,
        speechTimeout: '3', // Matches production defaults - what you test is what customers get!
        enhanced: true,
        speechModel: 'phone_call',
        hints: 'um, uh, like, you know, so, well, I mean, and then, so anyway, basically, actually' // Help recognize common filler words
      });
      gather.say('Try saying something else.');
      logger.info(`🧠 [CHECKPOINT 8] ✅ Gather created`);
    }
    
    logger.info(`🧠 [CHECKPOINT 11] Updating test stats in database...`);
    // Update test stats
    await GlobalInstantResponseTemplate.findByIdAndUpdate(templateId, {
      $inc: { 'twilioTest.testCallCount': 1 },
      $set: { 'twilioTest.lastTestedAt': new Date() }
    });
    logger.info(`🧠 [CHECKPOINT 11] ✅ Stats updated`);
    
    // ============================================
    // 🧪 SAVE TEST RESULT TO MEMORY
    // ============================================
    const testResult = {
      timestamp: new Date().toISOString(),
      phrase: speechText,
      matched: Boolean(result.scenario),  // FIXED: was result.match, should be result.scenario
      confidence: result.confidence || 0,
      threshold: result.trace?.threshold || 0.45,
      scenario: result.scenario ? {
        id: result.scenario.scenarioId || result.scenario._id,
        name: result.scenario.name,
        category: result.scenario.category
      } : null,
      topCandidates: result.trace?.topCandidates || [],
      timing: result.trace?.timingMs || {},
      callSid: req.body.CallSid,
      
      // ============================================
      // 🧠 3-TIER ROUTING METADATA (if enabled)
      // ============================================
      ...(USE_3_TIER_FOR_TESTING && routingDetails.tierUsed && {
        intelligenceRouting: {
          enabled: true,
          tierUsed: routingDetails.tierUsed,
          tierName: { 1: 'Rule-based', 2: 'Semantic', 3: 'LLM' }[routingDetails.tierUsed],
          tier1Confidence: routingDetails.tier1Confidence || 0,
          tier2Confidence: routingDetails.tier2Confidence || 0,
          tier3Confidence: routingDetails.tier3Confidence || 0,
          cost: routingDetails.cost || 0,
          responseTime: routingDetails.responseTime || 0,
          patternsLearned: routingDetails.patternsLearned || 0,
          allTiersFailed: routingDetails.allTiersFailed || false
        }
      })
    };
    
    // 🤖 Run AI analysis with detailed diagnostics
    const aiAnalysis = analyzeTestResult(testResult, allScenarios);
    testResult.analysis = aiAnalysis;
    
    // 🔬 WORLD-CLASS DIAGNOSTICS: Generate comprehensive debug card
    const debugCard = MatchDiagnostics.generateDebugCard(
      result,
      allScenarios,
      speechText,
      {
        channel: 'voice',
        language: 'en',
        asrConfidence: null // Twilio doesn't provide this
      }
    );
    
    testResult.diagnostics = debugCard;
    
    if (aiAnalysis.suggestions.length > 0 || aiAnalysis.issues.length > 0) {
      logger.debug(`🤖 [AI ANALYSIS] Found ${aiAnalysis.suggestions.length} suggestions, ${aiAnalysis.issues.length} issues`);
    }
    
    // ============================================
    // 🎯 ENTERPRISE TEST PILOT: DEEP LLM ANALYSIS
    // ============================================
    // If the template has Enterprise Test Pilot enabled (intelligenceMode set),
    // use the EnterpriseAISuggestionEngine for comprehensive analysis.
    // This provides:
    // - LLM qualitative analysis (missing fillers, triggers, context confusion)
    // - Statistical pattern frequency (how often patterns appear in failed tests)
    // - Impact scoring (priority ranking based on frequency × confidence gain × cost)
    // - Conflict detection (trigger collisions, routing ambiguity)
    // - Cost projection (ROI analysis for applying suggestions)
    // - Before/after simulation (predicted impact)
    // ============================================
    
    const shouldRunEnterpriseAnalysis = template.intelligenceMode && 
                                        template.testPilotSettings &&
                                        (!testResult.matched || testResult.confidence < testResult.threshold);
    
    if (shouldRunEnterpriseAnalysis) {
      logger.info(`🎯 [ENTERPRISE TEST PILOT] Running deep analysis with ${template.intelligenceMode} mode...`);
      
      try {
        const EnterpriseAISuggestionEngine = require('../services/EnterpriseAISuggestionEngine');
        const enterpriseEngine = new EnterpriseAISuggestionEngine();
        
        // ============================================
        // 🛡️ CONSTRUCT TIER RESULTS FOR ANALYSIS
        // ============================================
        // Build tierResults object from available data (either 3-tier routing or test mode)
        let tierResults;
        
        if (USE_3_TIER_FOR_TESTING && routingDetails.tierUsed) {
          // 3-tier mode: Use routing details
          tierResults = {
            finalTier: `tier${routingDetails.tierUsed}`,
            finalConfidence: result.confidence,
            tier1: {
              confidence: routingDetails.tier1Confidence || 0,
              matchedFillers: result.trace?.matchedFillers || [],
              matchedTriggers: result.trace?.matchedTriggers || [],
              matchedKeywords: result.trace?.matchedKeywords || []
            },
            tier2: {
              confidence: routingDetails.tier2Confidence || 0
            },
            tier3: {
              confidence: routingDetails.tier3Confidence || 0,
              scenario: result.scenario || null
            }
          };
        } else {
          // Test mode: Construct from result object (HybridScenarioSelector output)
          tierResults = {
            finalTier: 'tier1',
            finalConfidence: result.confidence,
            tier1: {
              confidence: result.confidence,
              matchedFillers: result.trace?.matchedFillers || [],
              matchedTriggers: result.trace?.matchedTriggers || [],
              matchedKeywords: result.trace?.matchedKeywords || []
            },
            tier2: {
              confidence: 0
            },
            tier3: {
              confidence: 0,
              scenario: null
            }
          };
        }
        
        logger.info(`🧠 [ENTERPRISE TEST PILOT] Built tierResults:`, {
          finalTier: tierResults.finalTier,
          finalConfidence: tierResults.finalConfidence,
          mode: USE_3_TIER_FOR_TESTING ? '3-tier' : 'test'
        });
        
        // Run comprehensive analysis with tierResults
        const enterpriseAnalysis = await enterpriseEngine.analyzeTestCall(
          speechText,
          templateId,
          tierResults
        );
        
        // Store enterprise analysis
        testResult.enterpriseAnalysis = {
          mode: template.intelligenceMode,
          analyzed: true,
          analysisId: enterpriseAnalysis.analysis?._id?.toString(),
          suggestions: enterpriseAnalysis.suggestions || [],
          conflicts: enterpriseAnalysis.conflicts || [],
          trends: enterpriseAnalysis.trends || null,
          costImpact: enterpriseAnalysis.costProjection || null,
          coloredTranscript: enterpriseAnalysis.coloredTranscript || null,
          timestamp: new Date().toISOString()
        };
        
        logger.info(`✅ [ENTERPRISE TEST PILOT] Analysis complete: ${enterpriseAnalysis.suggestions.length} suggestions, ${enterpriseAnalysis.conflicts.length} conflicts`);
        
        // Backward compatibility: also populate legacy llmDiagnostic
        testResult.llmDiagnostic = {
          analyzed: true,
          reason: !testResult.matched ? 'No match found' : `Confidence ${(testResult.confidence * 100).toFixed(0)}% below threshold ${(testResult.threshold * 100).toFixed(0)}%`,
          suggestions: enterpriseAnalysis.suggestions.slice(0, 5).map(s => s.description || s.reason), // Top 5 for backward compat
          enterpriseMode: true,
          analysisId: enterpriseAnalysis.analysis?._id?.toString(),
          timestamp: new Date().toISOString()
        };
        
      } catch (enterpriseError) {
        logger.error(`❌ [ENTERPRISE TEST PILOT] Analysis failed:`, {
          error: enterpriseError.message,
          stack: enterpriseError.stack
        });
        
        // Fallback to basic analysis
        testResult.enterpriseAnalysis = {
          mode: template.intelligenceMode,
          analyzed: false,
          error: enterpriseError.message,
          fallbackToBasic: true
        };
        
        testResult.llmDiagnostic = {
          analyzed: true,
          reason: !testResult.matched ? 'No match found' : `Confidence ${(testResult.confidence * 100).toFixed(0)}% below threshold ${(testResult.threshold * 100).toFixed(0)}%`,
          suggestions: aiAnalysis.suggestions || [],
          enterpriseMode: false,
          enterpriseError: enterpriseError.message,
          timestamp: new Date().toISOString()
        };
        
        logger.info(`🤖 [FALLBACK] Using basic AI analysis - ${aiAnalysis.suggestions.length} suggestions`);
      }
      
    } else if (!testResult.matched || testResult.confidence < testResult.threshold) {
      // ============================================
      // 🤖 BASIC LLM DIAGNOSTIC (Legacy Mode)
      // ============================================
      logger.info(`🤖 [LLM DIAGNOSTIC] Test failed - running basic analysis...`);
      testResult.llmDiagnostic = {
        analyzed: true,
        reason: !testResult.matched ? 'No match found' : `Confidence ${(testResult.confidence * 100).toFixed(0)}% below threshold ${(testResult.threshold * 100).toFixed(0)}%`,
        suggestions: aiAnalysis.suggestions || [],
        enterpriseMode: false,
        timestamp: new Date().toISOString()
      };
      
      logger.info(`🤖 [LLM DIAGNOSTIC] Generated ${aiAnalysis.suggestions.length} improvement suggestions`);
      
    } else {
      // ============================================
      // ✅ TEST PASSED - NO ANALYSIS NEEDED
      // ============================================
      testResult.llmDiagnostic = {
        analyzed: false,
        reason: 'Test passed - no LLM analysis needed',
        message: '✅ Your template rules are working perfectly! No improvements needed.'
      };
      logger.info(`✅ [TEST SUCCESS] Template rules working perfectly - confidence ${(testResult.confidence * 100).toFixed(0)}%`);
    }
    
    // ============================================
    // 🛡️ DECISION-CONTRACT SAFETY RAIL
    // ============================================
    // CRITICAL: If confidence ≥ threshold but NO scenario, this is an ENGINE BUG
    const threshold = testResult.threshold || 0.45;
    const confidence = testResult.confidence || 0;
    const hasScenario = Boolean(result.scenario);
    
    if (confidence >= threshold && !hasScenario) {
      // 🚨 RED ALERT: Decision contract violation
      const violation = {
        type: 'DECISION_CONTRACT_VIOLATION',
        severity: 'CRITICAL',
        message: `Confidence ${(confidence * 100).toFixed(0)}% ≥ threshold ${(threshold * 100).toFixed(0)}% but NO scenario returned`,
        confidence,
        threshold,
        gap: confidence - threshold,
        possibleCauses: [
          'Precondition failed after confidence check',
          'Scenario filtering bug (channel/language mismatch)',
          'Cooldown triggered after scoring',
          'Cache corruption or stale data',
          'Race condition in selector logic'
        ],
        debugInfo: {
          resultKeys: Object.keys(result),
          hasScenario,
          hasTrace: Boolean(result.trace),
          topCandidates: result.trace?.topCandidates || []
        }
      };
      
      logger.error(`\n${'🚨'.repeat(40)}`);
      logger.error(`🚨 DECISION-CONTRACT VIOLATION DETECTED!`);
      logger.error(`🚨 Confidence: ${(confidence * 100).toFixed(1)}% (threshold: ${(threshold * 100).toFixed(1)}%)`);
      logger.error(`🚨 Scenario returned: ${hasScenario}`);
      logger.error(`🚨 This should NEVER happen - engine logic bug!`);
      logger.error(JSON.stringify(violation, null, 2));
      logger.error(`${'🚨'.repeat(40)}\n`);
      
      // Add to test result for debugging
      testResult.contractViolation = violation;
      
      // Override reason code to E01: EngineBug
      if (testResult.diagnostics && testResult.diagnostics.reasonCodes) {
        testResult.diagnostics.primaryReasonCode = 'E01';
        testResult.diagnostics.reasonCodes.unshift({
          code: 'E01',
          name: 'EngineBug',
          type: 'error',
          severity: 'CRITICAL',
          message: 'DECISION CONTRACT VIOLATION: Confidence above threshold but no scenario returned',
          impact: 'Engine logic error - requires immediate investigation',
          rootCause: violation.possibleCauses.join(', '),
          fix: 'Review selector logic and add defensive checks',
          primaryMetric: 'confidenceGap',
          primaryMetricValue: ((confidence - threshold) * 100).toFixed(1)
        });
      }
    }
    
    saveTestResult(templateId, testResult);
    logger.info(`🧪 [CHECKPOINT 11.5] Test result saved to memory with AI analysis + diagnostics`);
    
    logger.info(`🧠 [CHECKPOINT 12] Sending TwiML response to Twilio...`);
    res.type('text/xml').status(200).send(twiml.toString());
    logger.info(`🧠 [CHECKPOINT 12] ✅ Response sent successfully`);
    logger.info(`${'='.repeat(80)}\n`);
    
  } catch (error) {
    logger.error(`\n${'!'.repeat(80)}`);
    logger.error(`🚨 [ERROR CHECKPOINT] EXCEPTION CAUGHT IN test-respond`);
    logger.error(`🚨 [ERROR CHECKPOINT] Error Message: ${error.message}`);
    logger.error(`🚨 [ERROR CHECKPOINT] Error Stack:`);
    logger.error(error.stack);
    logger.error(`${'!'.repeat(80)}\n`);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('An error occurred during testing. Please check the server logs.');
    twiml.hangup();
    res.type('text/xml').status(200).send(twiml.toString());
  }
});

// ============================================
// 🧪 GET TEST RESULTS FOR TEMPLATE
// ============================================
router.get('/test-results/:templateId', (req, res) => {
  const { templateId } = req.params;
  const limit = parseInt(req.query.limit) || 20;
  
  logger.debug(`🧪 [TEST RESULTS] Fetching last ${limit} results for template ${templateId}`);
  
  const results = getTestResults(templateId, limit);
  
  res.json({
    success: true,
    templateId,
    count: results.length,
    results
  });
});

// 📊 GET endpoint for aggregate quality report
router.get('/quality-report/:templateId', (req, res) => {
  try {
    const { templateId } = req.params;
    const limit = parseInt(req.query.limit) || 100; // Analyze more for quality metrics
    
    logger.info(`📊 [QUALITY REPORT] Generating report for template ${templateId} (last ${limit} tests)`);
    
    const results = getTestResults(templateId, limit);
    logger.info(`📊 [QUALITY REPORT] Retrieved ${results.length} test results`);
    
    const qualityReport = MatchDiagnostics.generateQualityReport(results);
    logger.info(`📊 [QUALITY REPORT] Generated quality report successfully`);
    
    res.json({
      success: true,
      templateId,
      report: qualityReport,
      count: results.length
    });
  } catch (error) {
    logger.error(`❌ [QUALITY REPORT] Error generating report:`, {
      error: error.message,
      stack: error.stack,
      templateId: req.params.templateId
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to generate quality report',
      message: error.message
    });
  }
});

// ============================================================================
// 📞 VOICE WEBHOOK - SYSTEM TEST CALL
// ============================================================================
// Purpose: Handle incoming calls to verify Twilio voice integration
// Plays customizable greeting from AdminSettings.notificationCenter.testCallGreeting
// NOTE: This route is mounted at /api/twilio, so /voice-test becomes /api/twilio/voice-test
// ============================================================================

router.post('/voice-test', async (req, res) => {
    try {
        const from = req.body.From;
        const to = req.body.To;
        
        logger.info(`📞 [VOICE WEBHOOK] Incoming call from ${from} to ${to}`);
        
        // Get custom greeting from AdminSettings
        const AdminSettings = require('../models/AdminSettings');
        const settings = await AdminSettings.getSettings();
        const greeting = settings.notificationCenter?.testCallGreeting || 
            'This is a ClientsVia system check. Your Twilio integration is working correctly.';
        
        logger.info(`🗣️ [VOICE WEBHOOK] Playing greeting (${greeting.length} chars)`);
        
        // Create TwiML response
        const VoiceResponse = twilio.twiml.VoiceResponse;
        const twiml = new VoiceResponse();
        
        twiml.say({
            voice: 'alice',
            language: 'en-US'
        }, greeting);
        
        // Hang up after message
        twiml.hangup();
        
        res.type('text/xml');
        res.send(twiml.toString());
        
        logger.debug('✅ [VOICE WEBHOOK] TwiML response sent');
        
    } catch (error) {
        logger.error('❌ [VOICE WEBHOOK] Error processing call:', error);
        
        // Always return valid TwiML even on error
        const VoiceResponse = twilio.twiml.VoiceResponse;
        const twiml = new VoiceResponse();
        twiml.say('System error. Please try again later.');
        twiml.hangup();
        
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// ============================================================================
// 📱 SMS WEBHOOK - ADMIN ALERT ACKNOWLEDGMENTS
// ============================================================================
// Purpose: Handle admin responses to notification alerts via SMS
// Supports: "ACK ALT-20251020-001", "SNOOZE ALT-###", "REOPEN ALT-###"
//
// Related Files:
// - services/AdminNotificationService.js
// - services/AlertEscalationService.js
// - models/NotificationLog.js
// ============================================================================

router.post('/sms', async (req, res) => {
    try {
        const from = req.body.From;        // Admin phone number
        const message = req.body.Body;     // SMS text content
        
        logger.info(`📱 [SMS WEBHOOK] Received SMS from ${from}: "${message}"`);
        
        // ====================================================================
        // CHECK FOR ACKNOWLEDGMENT: "ACK ALT-20251020-001"
        // ====================================================================
        const ackMatch = message.match(/ACK\s+(ALT-\d{8}-\d{3})/i);
        
        if (ackMatch) {
            const alertId = ackMatch[1].toUpperCase();
            
            logger.info(`✅ [SMS WEBHOOK] Acknowledgment detected for alert: ${alertId}`);
            
            try {
                // Find admin name from Notification Center
                const v2Company = require('../models/v2Company');
                const notificationCenter = await v2Company.findOne({
                    'metadata.isNotificationCenter': true
                });
                
                const admin = notificationCenter?.contacts.find(c => 
                    c.type === 'admin-alert' && c.phoneNumber === from
                );
                const adminName = admin?.name || from;
                
                // Acknowledge the alert
                const AdminNotificationService = require('../services/AdminNotificationService');
                await AdminNotificationService.acknowledgeAlert(alertId, adminName, 'SMS', message);
                
                logger.info(`✅ [SMS WEBHOOK] Alert ${alertId} acknowledged by ${adminName}`);
                
                // Send TwiML response (empty - confirmation will be sent separately)
                res.type('text/xml');
                res.send('<Response></Response>');
                return;
                
            } catch (error) {
                logger.error(`❌ [SMS WEBHOOK] Failed to acknowledge alert ${alertId}:`, error);
                
                // Send error response
                const twiml = new twilio.twiml.MessagingResponse();
                twiml.message(`Error: Failed to acknowledge alert ${alertId}. Please try again or use the web interface.`);
                res.type('text/xml');
                res.send(twiml.toString());
                return;
            }
        }
        
        // ====================================================================
        // CHECK FOR SNOOZE: "SNOOZE ALT-20251020-001 30"
        // ====================================================================
        const snoozeMatch = message.match(/SNOOZE\s+(ALT-\d{8}-\d{3})(?:\s+(\d+))?/i);
        
        if (snoozeMatch) {
            const alertId = snoozeMatch[1].toUpperCase();
            const minutes = parseInt(snoozeMatch[2]) || 60; // Default 1 hour
            
            logger.info(`🔕 [SMS WEBHOOK] Snooze detected for alert: ${alertId} (${minutes} minutes)`);
            
            try {
                const AlertEscalationService = require('../services/AlertEscalationService');
                await AlertEscalationService.snoozeAlert(alertId, minutes, 'Snoozed via SMS');
                
                logger.info(`✅ [SMS WEBHOOK] Alert ${alertId} snoozed for ${minutes} minutes`);
                
                res.type('text/xml');
                res.send('<Response></Response>');
                return;
                
            } catch (error) {
                logger.error(`❌ [SMS WEBHOOK] Failed to snooze alert ${alertId}:`, error);
                
                const twiml = new twilio.twiml.MessagingResponse();
                twiml.message(`Error: Failed to snooze alert ${alertId}. Please try again.`);
                res.type('text/xml');
                res.send(twiml.toString());
                return;
            }
        }
        
        // ====================================================================
        // CHECK FOR REOPEN: "REOPEN ALT-20251020-001"
        // ====================================================================
        const reopenMatch = message.match(/REOPEN\s+(ALT-\d{8}-\d{3})/i);
        
        if (reopenMatch) {
            const alertId = reopenMatch[1].toUpperCase();
            
            logger.info(`🔄 [SMS WEBHOOK] Reopen detected for alert: ${alertId}`);
            
            try {
                const AlertEscalationService = require('../services/AlertEscalationService');
                await AlertEscalationService.resumeEscalation(alertId);
                
                logger.info(`✅ [SMS WEBHOOK] Alert ${alertId} reopened`);
                
                const twiml = new twilio.twiml.MessagingResponse();
                twiml.message(`✅ Alert ${alertId} has been reopened and escalation resumed.`);
                res.type('text/xml');
                res.send(twiml.toString());
                return;
                
            } catch (error) {
                logger.error(`❌ [SMS WEBHOOK] Failed to reopen alert ${alertId}:`, error);
                
                const twiml = new twilio.twiml.MessagingResponse();
                twiml.message(`Error: Failed to reopen alert ${alertId}. Please try again.`);
                res.type('text/xml');
                res.send(twiml.toString());
                return;
            }
        }
        
        // ====================================================================
        // CHECK FOR TEST COMMAND: "TEST" or "PING"
        // ====================================================================
        if (message.match(/^(TEST|PING|HELLO|HI)$/i)) {
            logger.debug(`✅ [SMS WEBHOOK] Test command received from ${from}`);
            logger.debug('📧 [SMS WEBHOOK] STARTING email notification process...');
            
            // 📧 Send email notification to admins (Gmail - clientsvia@gmail.com)
            // ARCHITECTURE: Admin notifications use Gmail, customer emails use SendGrid (future)
            try {
                logger.debug('📧 [SMS WEBHOOK] Step 1: Requiring emailClient...');
                const emailClient = require('../clients/emailClient');
                logger.debug('📧 [SMS WEBHOOK] Step 2: emailClient loaded successfully');
                
                logger.debug('📧 [SMS WEBHOOK] Step 3: Creating timestamp...');
                const timestamp = new Date().toLocaleString('en-US', { 
                    timeZone: 'America/New_York',
                    dateStyle: 'short',
                    timeStyle: 'long'
                });
                logger.debug(`📧 [SMS WEBHOOK] Step 4: Timestamp created: ${timestamp}`);
                
                logger.debug('📧 [SMS WEBHOOK] Step 5: Calling emailClient.sendAdminAlert()...');
                const result = await emailClient.sendAdminAlert(
                    '✅ SMS Test Received',
                    `SMS Test Command Received!\n\nFrom: ${from}\nMessage: "${message}"\nTime: ${timestamp} ET\n\n✅ Webhook is working correctly!\n📱 SMS system is LIVE!`,
                    `<h2>✅ SMS Test Command Received!</h2><p><strong>From:</strong> ${from}</p><p><strong>Message:</strong> "${message}"</p><p><strong>Time:</strong> ${timestamp} ET</p><hr><p>✅ Webhook is working correctly!</p><p>📱 SMS system is LIVE!</p>`
                );
                logger.debug('📧 [SMS WEBHOOK] Step 6: sendAdminAlert() returned:', JSON.stringify(result));
                
                if (result.success) {
                    logger.debug(`📧 [SMS WEBHOOK] ✅ SUCCESS! Admin alert sent to ${result.recipients} recipient(s)`);
                } else {
                    logger.error(`❌ [SMS WEBHOOK] FAILED! Error: ${result.error}`);
                }
                
            } catch (emailError) {
                logger.error('⚠️ [SMS WEBHOOK] EXCEPTION caught:', emailError.message);
                logger.error('⚠️ [SMS WEBHOOK] Error stack:', emailError.stack);
            }
            
            logger.debug('📧 [SMS WEBHOOK] Email notification process COMPLETE');
            
            const twiml = new twilio.twiml.MessagingResponse();
            twiml.message(`✅ ClientsVia SMS System is LIVE!\n\n🚀 2-way SMS confirmed working.\n📱 Webhook connected.\n⏰ ${new Date().toLocaleString()}`);
            
            res.type('text/xml');
            res.send(twiml.toString());
            return;
        }
        
        // ====================================================================
        // NOT A RECOGNIZED COMMAND - Send help message
        // ====================================================================
        logger.info(`ℹ️ [SMS WEBHOOK] Unrecognized command from ${from}`);
        
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(`
ClientsVia Alert Commands:
• TEST - Verify SMS system
• ACK ALT-###-### - Acknowledge alert
• SNOOZE ALT-###-### 30 - Snooze for 30 min
• REOPEN ALT-###-### - Reopen alert

Example: ACK ALT-20251020-001
        `.trim());
        
        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        logger.error('❌ [SMS WEBHOOK] Error processing SMS:', error);
        
        // Always return valid TwiML even on error
        res.type('text/xml');
        res.send('<Response></Response>');
    }
});

// 🚨 CATCH-ALL ENDPOINT - Must be LAST to log any unmatched Twilio requests
router.all('*', (req, res) => {
  logger.info('❌ UNMATCHED TWILIO REQUEST:', {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    fullUrl: req.originalUrl,
    path: req.path,
    params: req.params,
    hasCallSid: Boolean(req.body?.CallSid)
  });
  
  // CRITICAL: Always return TwiML for Twilio requests, NEVER JSON!
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say('This endpoint is not configured. Please check your Twilio webhook settings.');
  twiml.hangup();
  res.type('text/xml').status(200).send(twiml.toString());
});

// ============================================================================
// 📞 CALL STATUS CALLBACK - CALL CENTER V2 INTEGRATION
// ============================================================================
// Purpose: Handle Twilio status callbacks when calls end
// This is the ONLY reliable way to know a call has completed
// Configure this URL as the StatusCallback in your Twilio webhook settings
// ============================================================================

router.post('/status-callback', async (req, res) => {
  const {
    CallSid,
    CallStatus,
    CallDuration,
    From,
    To,
    Direction,
    AnsweredBy,
    Timestamp
  } = req.body;
  
  logger.info('[CALL STATUS] Status callback received', {
    callSid: CallSid,
    status: CallStatus,
    duration: CallDuration,
    from: From,
    to: To
  });
  
  try {
    // Only process completed calls
    if (['completed', 'busy', 'no-answer', 'canceled', 'failed'].includes(CallStatus)) {
      
      // ────────────────────────────────────────────────────────────────
      // CALL CENTER V2: End the call and update CallSummary
      // ────────────────────────────────────────────────────────────────
      if (CallSummaryService) {
        try {
          // Find the call by Twilio SID
          const CallSummary = require('../models/CallSummary');
          const callSummary = await CallSummary.findOne({ twilioSid: CallSid });
          
          if (callSummary) {
            // Map Twilio status to our outcome
            const outcomeMap = {
              'completed': 'completed',
              'busy': 'abandoned',
              'no-answer': 'abandoned',
              'canceled': 'abandoned',
              'failed': 'error'
            };
            
            // Update the call summary
            await CallSummaryService.endCall(callSummary.callId, {
              outcome: outcomeMap[CallStatus] || 'completed',
              durationSeconds: parseInt(CallDuration) || 0,
              answeredBy: AnsweredBy,
              endedAt: new Date(Timestamp) || new Date()
            });
            
            logger.info('[CALL STATUS] CallSummary updated', {
              callId: callSummary.callId,
              outcome: outcomeMap[CallStatus],
              duration: CallDuration
            });
          } else {
            logger.debug('[CALL STATUS] No CallSummary found for this call (may be test/spam)', {
              twilioSid: CallSid
            });
          }
        } catch (callCenterErr) {
          // Non-blocking: Log but don't fail the webhook
          logger.warn('[CALL STATUS] Failed to update CallSummary', {
            error: callCenterErr.message,
            twilioSid: CallSid
          });
        }
      }
      // ────────────────────────────────────────────────────────────────
    }
    
    // Always return 200 to Twilio
    res.status(200).send('OK');
    
  } catch (error) {
    logger.error('[CALL STATUS] Status callback error', {
      error: error.message,
      callSid: CallSid
    });
    // Still return 200 to prevent Twilio retries
    res.status(200).send('OK');
  }
});

// Status callback for calls made TO customers (outbound)
router.post('/status-callback/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const { CallSid, CallStatus, CallDuration, From, To } = req.body;
  
  logger.info('[CALL STATUS] Company-specific status callback', {
    companyId,
    callSid: CallSid,
    status: CallStatus,
    duration: CallDuration
  });
  
  // Handle same as generic callback
  try {
    if (CallSummaryService && ['completed', 'busy', 'no-answer', 'canceled', 'failed'].includes(CallStatus)) {
      const CallSummary = require('../models/CallSummary');
      const callSummary = await CallSummary.findOne({ twilioSid: CallSid, companyId });
      
      if (callSummary) {
        const outcomeMap = {
          'completed': 'completed',
          'busy': 'abandoned',
          'no-answer': 'abandoned', 
          'canceled': 'abandoned',
          'failed': 'error'
        };
        
        await CallSummaryService.endCall(callSummary.callId, {
          outcome: outcomeMap[CallStatus] || 'completed',
          durationSeconds: parseInt(CallDuration) || 0,
          endedAt: new Date()
        });
        
        logger.info('[CALL STATUS] Company CallSummary updated', {
          companyId,
          callId: callSummary.callId,
          outcome: outcomeMap[CallStatus]
        });
      }
    }
    
    res.status(200).send('OK');
    
  } catch (error) {
    logger.error('[CALL STATUS] Company callback error', {
      companyId,
      error: error.message
    });
    res.status(200).send('OK');
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// 🧪 MINIMAL TEST-GATHER ROUTE - Proves Twilio → Server → Action works
// ════════════════════════════════════════════════════════════════════════════════
// Use this to isolate whether the problem is:
//   A) Twilio can't reach your server at all, OR
//   B) Something specific to your v2 agent TwiML/flow
//
// To test: Point a Twilio phone number to /api/twilio/test-gather-twiml
// Or use TwiML Bin with the XML below.
// ════════════════════════════════════════════════════════════════════════════════

// Step 1: Returns minimal TwiML that triggers Gather → action
router.post('/test-gather-twiml', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const actionUrl = `https://${req.get('host')}/api/twilio/test-gather`;
  
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('🧪 [TEST-GATHER-TWIML] Sending minimal TwiML');
  console.log('Action URL:', actionUrl);
  console.log('════════════════════════════════════════════════════════════════════════════════');
  
  const gather = twiml.gather({
    input: 'speech',
    action: actionUrl,
    method: 'POST',
    timeout: 5,
    speechTimeout: 'auto'
  });
  gather.say('Say anything after this message, then wait.');
  
  twiml.say("We didn't get anything. Goodbye.");
  
  res.type('text/xml').send(twiml.toString());
});

// Step 2: Receives speech result - if this logs, Twilio → action path works
router.post('/test-gather', (req, res) => {
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('🔥 /test-gather HIT! Twilio successfully called action URL!');
  console.log('CallSid:', req.body.CallSid);
  console.log('SpeechResult:', req.body.SpeechResult);
  console.log('From:', req.body.From);
  console.log('To:', req.body.To);
  console.log('════════════════════════════════════════════════════════════════════════════════');
  
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say(`We heard: ${req.body.SpeechResult || 'nothing'}. Goodbye.`);
  res.type('text/xml').send(twiml.toString());
});

logger.info('🚀 [V2TWILIO] ========== EXPORTING ROUTER (FILE LOADED SUCCESSFULLY) ==========');
module.exports = router;