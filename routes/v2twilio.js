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
// V2 DELETED: Legacy findCachedAnswer - using V2 PriorityDrivenKnowledgeRouter
const CompanyKnowledgeQnA = require('../models/knowledge/CompanyQnA');
const fs = require('fs');
const path = require('path');
const { synthesizeSpeech } = require('../services/v2elevenLabsService');
const { redisClient } = require('../clients');
const { normalizePhoneNumber, extractDigits, numbersMatch, } = require('../utils/phone');
const { stripMarkdown, cleanTextForTTS } = require('../utils/textUtils');
// Legacy personality system removed - using modern AI Agent Logic responseCategories

// ============================================================================
// 🧠 3-TIER SELF-IMPROVEMENT SYSTEM CONFIGURATION
// ============================================================================
// Feature flag to enable/disable the 3-tier intelligence system (Tier 1 → 2 → 3)
// When enabled: Calls route through IntelligentRouter for self-improvement cycle
// When disabled: Falls back to traditional HybridScenarioSelector (Tier 1 only)
// Default: FALSE for safe rollout, set ENABLE_3_TIER_INTELLIGENCE=true to activate
// ============================================================================
const ENABLE_3_TIER_INTELLIGENCE = process.env.ENABLE_3_TIER_INTELLIGENCE === 'true';

if (ENABLE_3_TIER_INTELLIGENCE) {
  logger.info('🧠 [3-TIER SYSTEM] ENABLED - Self-improvement cycle active');
  logger.info('🧠 [3-TIER SYSTEM] Calls will route: Tier 1 (rule) → Tier 2 (semantic) → Tier 3 (LLM)');
} else {
  logger.info('🧠 [3-TIER SYSTEM] DISABLED - Using traditional Tier 1 only');
}

const router = express.Router();
logger.info('🚀 [V2TWILIO] ========== EXPRESS ROUTER CREATED ==========');

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
function isTransferEnabled(company) {
  return company?.aiAgentLogic?.callTransferConfig?.dialOutEnabled === true;
}

// Helper function to get the configured transfer number
function getTransferNumber(company) {
  // First try the AI Agent Logic configured dial-out number
  if (company?.aiAgentLogic?.callTransferConfig?.dialOutEnabled && 
      company?.aiAgentLogic?.callTransferConfig?.dialOutNumber) {
    logger.info('[AI AGENT] Using configured dial-out number:', company.aiAgentLogic.callTransferConfig.dialOutNumber);
    return company.aiAgentLogic.callTransferConfig.dialOutNumber;
  }
  
  // Fall back to Twilio config fallback number
  if (company?.twilioConfig?.fallbackNumber) {
    logger.info('[AI AGENT] Using Twilio fallback number:', company.twilioConfig.fallbackNumber);
    return company.twilioConfig.fallbackNumber;
  }
  
  // No fallback number - transfer should be explicitly configured
  logger.info('[AI AGENT] No transfer number configured - transfer disabled');
  return null;
}

// Helper function to get the configured transfer message
function getTransferMessage(company) {
  if (company?.aiAgentLogic?.callTransferConfig?.transferMessage) {
    return company.aiAgentLogic.callTransferConfig.transferMessage;
  }
  return "Let me connect you with someone who can better assist you.";
}

// Helper function to handle transfer logic with enabled check
function handleTransfer(twiml, company, fallbackMessage = "I apologize, but I cannot assist further at this time. Please try calling back later.", companyID = null) {
  if (isTransferEnabled(company)) {
    const transferNumber = getTransferNumber(company);
    
    // Only transfer if we have a valid number configured
    if (transferNumber) {
      const transferMessage = getTransferMessage(company);
      logger.info('[AI AGENT] Transfer enabled, transferring to:', transferNumber);
      twiml.say(transferMessage);
      twiml.dial(transferNumber);
    } else {
      logger.info('[AI AGENT] Transfer enabled but no number configured, providing fallback message');
      // V2 DELETED: Legacy responseCategories.core - using V2 Agent Personality system
      const configResponse = `I understand you need assistance. Let me connect you with our support team who can help you right away.`;
      twiml.say(configResponse);
      twiml.hangup();
    }
  } else {
    logger.info('[AI AGENT] Transfer disabled, providing fallback message and continuing conversation');
    twiml.say(fallbackMessage);
    
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
    
    // 🏢 CHECK 1: Is this a Company Test Mode number? (PRIORITY - tests real production setup)
    logger.info(`[COMPANY TEST MODE CHECK] Checking if ${phoneNumber} is company test number...`);
    
    const companyTestConfig = adminSettings?.companyTestMode;
    
    if (companyTestConfig?.enabled && companyTestConfig.phoneNumber === phoneNumber) {
      logger.info(`🏢 [COMPANY TEST MODE] Test number matched! Loading REAL company from MongoDB...`);
      
      // Load the REAL company that's being tested
      const testCompany = await Company.findById(companyTestConfig.activeCompanyId);
      
      if (testCompany) {
        logger.info(`✅ [COMPANY TEST MODE] Test routing to REAL company: ${testCompany.companyName || testCompany.businessName}`);
        logger.info(`🎯 [COMPANY TEST MODE] Using PRODUCTION code path - this tests the EXACT customer experience!`);
        logger.info(`📊 [COMPANY TEST MODE] Test options:`, JSON.stringify(companyTestConfig.testOptions, null, 2));
        
        // Mark this as test mode for optional debugging/logging
        testCompany.isTestMode = true;
        testCompany.testOptions = companyTestConfig.testOptions || {};
        testCompany.testGreeting = companyTestConfig.greeting || 'Currently testing {company_name}.';
        
        // Return the REAL company (not a fake one!)
        // This will use the EXACT same code path as production customer calls!
        return testCompany;
      } else {
        logger.warn(`⚠️ [COMPANY TEST MODE] activeCompanyId points to non-existent company: ${companyTestConfig.activeCompanyId}`);
      }
    }
    
    // 🧠 CHECK 2: Is this a Global AI Brain test number? (Template testing in isolation)
    logger.info(`[GLOBAL BRAIN CHECK] Checking if ${phoneNumber} is the global test number...`);
    
    const globalTestConfig = adminSettings?.globalAIBrainTest;
    
    if (globalTestConfig?.enabled && globalTestConfig.phoneNumber === phoneNumber) {
      logger.info(`🧠 [GLOBAL BRAIN] Global test number matched! Loading active template...`);
      
      // Load the template that's currently being tested
      const testTemplate = await GlobalInstantResponseTemplate.findById(
        globalTestConfig.activeTemplateId
      );
      
      if (testTemplate) {
        logger.info(`✅ [GLOBAL BRAIN] Test routing to: ${testTemplate.name}`);
        // Return a special "company" object that signals this is a test template
        return {
          isGlobalTestTemplate: true,
          template: testTemplate,
          _id: testTemplate._id,
          name: testTemplate.name,
          globalTestConfig: globalTestConfig // Include config for greeting, etc.
        };
      } else {
        logger.warn(`⚠️ [GLOBAL BRAIN] activeTemplateId points to non-existent template: ${globalTestConfig.activeTemplateId}`);
      }
    }
    
    // 🏢 CHECK 3: Regular company lookup (production customer calls)
    const cacheStartTime = Date.now();
    const cachedCompany = await redisClient.get(cacheKey);
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
        await redisClient.setEx(cacheKey, 3600, JSON.stringify(company)); // Cache for 1 hour
        logger.debug(`[CACHE SAVE] 💾 Company cached for phone: ${phoneNumber}`);
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
          // No custom message - use default professional message
          logger.info(`[ACCOUNT SUSPENDED] No custom message set - using default`);
          const defaultMessage = "We're sorry, but service for this number is temporarily unavailable. Please contact support for assistance.";
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
      
      // DOUBLE-CHECK: Reload company to verify voiceSettings are in DB
      logger.debug(`🔍 [CALL-4] Double-checking voice settings from database...`);
      const freshCompany = await Company.findById(company._id);
      logger.debug(`🔍 [CALL-5] Fresh company.aiAgentLogic exists:`, Boolean(freshCompany.aiAgentLogic));
      logger.debug(`🔍 [CALL-6] Fresh company.aiAgentLogic.voiceSettings:`, JSON.stringify(freshCompany.aiAgentLogic?.voiceSettings, null, 2));
      
      logger.debug(`[V2 AGENT] Call initialized, greeting: "${initResult.greeting}"`);
      logger.debug(`[V2 VOICE] Voice settings:`, JSON.stringify(initResult.voiceSettings, null, 2));
      
      // Set up speech gathering with V2 Agent response handler
      // 📞 SPEECH DETECTION: Now configurable per company in Voice Settings
      const speechDetection = company.aiAgentLogic?.voiceSettings?.speechDetection || {};
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/v2-agent-respond/${company._id}`,
        method: 'POST',
        bargeIn: speechDetection.bargeIn ?? false,
        timeout: speechDetection.initialTimeout ?? 5,
        speechTimeout: (speechDetection.speechTimeout ?? 3).toString(), // Configurable: 1-10 seconds (default: 3s)
        enhanced: speechDetection.enhancedRecognition ?? true,
        speechModel: speechDetection.speechModel ?? 'phone_call',
        hints: 'um, uh, like, you know, so, well, I mean, and then, so anyway, basically, actually', // Help recognize common filler words and pauses
        partialResultCallback: `https://${req.get('host')}/api/twilio/v2-agent-partial/${company._id}`
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
            stability: company.aiAgentLogic?.voiceSettings?.stability,
            similarity_boost: company.aiAgentLogic?.voiceSettings?.similarityBoost,
            style: company.aiAgentLogic?.voiceSettings?.styleExaggeration,
            model_id: company.aiAgentLogic?.voiceSettings?.aiModel,
            company
          });
          
          const ttsTime = Date.now() - ttsStartTime;
          logger.info(`[TTS COMPLETE] [OK] AI Agent Logic greeting TTS completed in ${ttsTime}ms`);
          
          const fileName = `ai_greet_${Date.now()}.mp3`;
          const audioDir = path.join(__dirname, '../public/audio');
          if (!fs.existsSync(audioDir)) {fs.mkdirSync(audioDir, { recursive: true });}
          const filePath = path.join(audioDir, fileName);
          fs.writeFileSync(filePath, buffer);
          gather.play(`${req.protocol}://${req.get('host')}/audio/${fileName}`);
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
    logger.info(`[Twilio Voice] Sending AI Agent Logic TwiML: ${twimlString}`);
    res.send(twimlString);
    
  } catch (error) {
    logger.error(`[ERROR] [CRITICAL] Voice endpoint error: ${error.message}`);
    logger.error(`[ERROR] Stack trace:`, error.stack);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Professional fallback message (no legacy "technician" wording)
    twiml.say('We apologize, but we are experiencing a technical issue. Please try your call again in a few moments, or contact us through our website. Thank you.');
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
      const repeats = await redisClient.incr(repeatKey);
      if (repeats === 1) {
        await redisClient.expire(repeatKey, 600);
      }
      if (repeats > (company.aiSettings?.maxRepeats ?? 3)) {
        const personality = company.aiSettings?.personality || 'friendly';
        // V2 DELETED: Legacy responseCategories.core - using V2 Agent Personality system
        const msg = `I understand you need help. Let me connect you with someone who can assist you better.`;
        const fallbackText = `<Say>${escapeTwiML(msg)}</Say>`;
        twiml.hangup();
        await redisClient.del(repeatKey);
        res.type('text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
        return;
      }
      // Use configurable speech detection settings (fallback to defaults if not set)
      const speechDetection = company.aiAgentLogic?.voiceSettings?.speechDetection || {};
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
      
      const elevenLabsVoice = company.aiAgentLogic?.voiceSettings?.voiceId;

      if (elevenLabsVoice) {
        try {
          const buffer = await synthesizeSpeech({
            text: retryMsg,
            voiceId: elevenLabsVoice,
            stability: company.aiAgentLogic?.voiceSettings?.stability,
            similarity_boost: company.aiAgentLogic?.voiceSettings?.similarityBoost,
            style: company.aiAgentLogic?.voiceSettings?.styleExaggeration,
            model_id: company.aiAgentLogic?.voiceSettings?.aiModel,
            company
          });
          
          // Store audio in Redis for fast serving
          const audioKey = `audio:retry:${callSid}`;
          await redisClient.setEx(audioKey, 300, buffer.toString('base64'));
          
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
    await redisClient.del(repeatKey);

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
      const storedHistory = await redisClient.get(historyKey);
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
        const speechDetection = company.aiAgentLogic?.voiceSettings?.speechDetection || {};
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
        await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));
        
        res.type('text/xml');
        return res.send(twiml.toString());
      }
      
      logger.info(`[Q&A RESPONSE] [OK] Using Q&A response (no repetition detected)`);
      
      // Use configurable speech detection settings (fallback to defaults if not set)
      const speechDetection = company.aiAgentLogic?.voiceSettings?.speechDetection || {};
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

      const elevenLabsVoice = company.aiAgentLogic?.voiceSettings?.voiceId;
      
      if (elevenLabsVoice) {
        try {
          const buffer = await synthesizeSpeech({
            text: cachedAnswer,
            voiceId: elevenLabsVoice,
            stability: company.aiAgentLogic?.voiceSettings?.stability,
            similarity_boost: company.aiAgentLogic?.voiceSettings?.similarityBoost,
            style: company.aiAgentLogic?.voiceSettings?.styleExaggeration,
            model_id: company.aiAgentLogic?.voiceSettings?.aiModel,
            company
          });
          
          const audioKey = `audio:qa:${callSid}`;
          await redisClient.setEx(audioKey, 300, buffer.toString('base64'));
          
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
      await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));
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
    const storedHistory = await redisClient.get(historyKey);
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
        text: "I understand your question. Let me connect you with someone who can help you better.",
        escalate: true
      };
      
      const aiEndTime = Date.now();
      logger.info(`[AI AGENT LOGIC] [OK] AI response generated in ${aiEndTime - aiStartTime}ms`);
      logger.info(`[AI] answerQuestion result for ${callSid}:`, answerObj);

      // Add AI response to history
      conversationHistory.push({ role: 'assistant', text: answerObj.text });
      await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));
      logger.debug(`[AI HISTORY] 💾 Saved conversation history (${conversationHistory.length} messages)`);

    } catch (err) {
      logger.error(`[AI ERROR] [ERROR] AI processing failed: ${err.message}`);
      logger.error(`[AI Processing Error for CallSid: ${callSid}]`, err.message, err.stack);
      const personality = company.aiSettings?.personality || 'friendly';
      // V2 DELETED: Legacy responseCategories.core - using V2 Agent Personality system
      const fallback = `I'm experiencing a technical issue. Let me connect you to our support team who can help you right away.`;
      answerObj = { text: fallback, escalate: false };
    }

    // Generate TTS and respond immediately - using configurable speech detection settings
    const speechDetection = company.aiAgentLogic?.voiceSettings?.speechDetection || {};
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
    const elevenLabsVoice = company.aiAgentLogic?.voiceSettings?.voiceId;
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
        await redisClient.setEx(audioKey, 300, buffer.toString('base64'));
        
        const audioUrl = `https://${req.get('host')}/api/twilio/audio/ai/${callSid}`;
        gather.play(audioUrl);

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
    
    const audioBase64 = await redisClient.get(audioKey);
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
    
    // Check if AI Agent Logic is enabled
    if (company.aiAgentLogic?.enabled) {
      logger.info(`[AI AGENT LOGIC] Enabled for company ${companyID}`);
      
      // Use new AI Agent Logic greeting - NO hardcoded fallbacks allowed
      const greeting = company.aiAgentLogic.responseCategories?.greeting?.template || 
        `Configuration error for ${company.businessName || company.companyName} - greeting not configured in Agent Personality tab`;
      
      // Apply placeholder replacement
      const finalGreeting = greeting.replace('{companyName}', company.businessName || company.companyName);
      
      logger.info('🎯 CHECKPOINT 6: Adding AI greeting to TwiML');
      logger.info(`🗣️ Greeting text: "${finalGreeting}"`);
      
      twiml.say({
        voice: company.aiAgentLogic.agentPersonality?.voice?.tone === 'robotic' ? 'Polly.Joanna' : 'alice'
      }, escapeTwiML(finalGreeting));
      
      logger.info('🎯 CHECKPOINT 7: Setting up speech gathering');
      // Set up gather for AI Agent Logic flow - using configurable speech detection settings
      const speechDetection = company.aiAgentLogic?.voiceSettings?.speechDetection || {};
      const gather = twiml.gather({
        input: 'speech',
        speechTimeout: (speechDetection.speechTimeout ?? 3).toString(), // Configurable: 1-10 seconds (default: 3s)
        speechModel: speechDetection.speechModel ?? 'phone_call',
        bargeIn: speechDetection.bargeIn ?? false,
        timeout: speechDetection.initialTimeout ?? 5,
        enhanced: speechDetection.enhancedRecognition ?? true,
        hints: 'um, uh, like, you know, so, well, I mean, and then, so anyway, basically, actually', // Help recognize common filler words and pauses
        action: `/api/twilio/v2-agent-respond/${companyID}`,
        method: 'POST',
        partialResultCallback: `/api/twilio/ai-agent-partial/${companyID}`,
        partialResultCallbackMethod: 'POST'
      });
      
      logger.info('🎯 CHECKPOINT 8: Adding empty gather.say()');
      gather.say('');
      
      logger.info('🎯 CHECKPOINT 9: Adding fallback message');
      // V2 DELETED: Legacy responseCategories.core - using V2 Agent Personality system
      const noInputFallback = `I didn't hear anything. How can I help you today?`;
      twiml.say(noInputFallback);
      twiml.hangup();
      
    } else {
      // AI Agent Logic not enabled - provide simple greeting and hang up
      logger.info(`🎯 CHECKPOINT 6: AI Agent Logic not enabled for company ${companyID}, providing basic greeting`);
      
      // V2 DELETED: Legacy responseCategories.core - using V2 Agent Personality system
      const aiNotEnabledResponse = `Thank you for calling. Please hold while I connect you to someone who can assist you.`;
      twiml.say(aiNotEnabledResponse);
      twiml.hangup();
    }
    
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
  const callSid = req.body.CallSid || 'UNKNOWN';
  const fromNumber = req.body.From || 'UNKNOWN';
  const speechResult = req.body.SpeechResult || '';
  
  logger.info('🎯 CHECKPOINT 11: AI Agent Response Handler Called');
  logger.info(`📞 Call Details: SID=${callSid}, From=${fromNumber}`);
  logger.info(`🗣️ User Speech: "${speechResult}"`);
  logger.info('📋 Full request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { companyID } = req.params;
    
    logger.debug('🎯 CHECKPOINT 12: Processing AI Agent Response');
    logger.debug(`🏢 Company ID: ${companyID}`);
    
    // V2 DELETED: Legacy aiAgentRuntime - replaced with v2AIAgentRuntime
    // const { processCallTurn } = require('../services/aiAgentRuntime');
    
    logger.security('🎯 CHECKPOINT 13: Initializing call state');
    // Get or initialize call state
    const callState = req.session?.callState || {
      callId: callSid,
      from: fromNumber,
      consecutiveSilences: 0,
      failedAttempts: 0,
      startTime: new Date()
    };
    
    logger.debug('🎯 CHECKPOINT 14: Calling V2 AI Agent Runtime processUserInput');
    // Process the call turn through V2 AI Agent Runtime
    const { processUserInput } = require('../services/v2AIAgentRuntime');
    const result = await processUserInput(
      companyID,
      callSid,
      speechResult,
      callState
    );
    
    logger.security('🎯 CHECKPOINT 15: AI Agent Runtime response received');
    logger.security('🤖 AI Response:', JSON.stringify(result, null, 2));
    
    // Update call state
    req.session = req.session || {};
    req.session.callState = result.callState;
    
    logger.security('🎯 CHECKPOINT 16: Creating TwiML response');
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Handle different response types
    if (result.shouldHangup) {
      logger.info('🎯 CHECKPOINT 17: AI decided to hang up');
      logger.info(`🗣️ Final message: "${result.text}"`);
      twiml.say(escapeTwiML(result.text));
      twiml.hangup();
    } else if (result.shouldTransfer) {
      logger.info('🎯 CHECKPOINT 18: AI decided to transfer call');
      logger.info(`🗣️ Transfer message: "${result.text}"`);
      twiml.say(escapeTwiML(result.text));
      
      // Get company transfer number and check if transfer is enabled
      const company = await Company.findById(companyID);
      logger.info('🎯 CHECKPOINT 19: Calling handleTransfer function');
      handleTransfer(twiml, company, "I apologize, but I cannot transfer you at this time. Please try calling back later or visiting our website for assistance.", companyID);
    } else {
      logger.info('🎯 CHECKPOINT 20: AI continuing conversation');
      logger.info(`🗣️ AI Response: "${result.response}"`);
      
      // 🎤 V2 ELEVENLABS INTEGRATION: Use ElevenLabs if configured
      const company = await Company.findById(companyID);
      
      // 🔍 DIAGNOSTIC: Log voice settings check
      logger.info('🔍 V2 VOICE CHECK: Company loaded:', Boolean(company));
      logger.info('🔍 V2 VOICE CHECK: aiAgentLogic exists:', Boolean(company?.aiAgentLogic));
      logger.info('🔍 V2 VOICE CHECK: voiceSettings exists:', Boolean(company?.aiAgentLogic?.voiceSettings));
      logger.info('🔍 V2 VOICE CHECK: Full voiceSettings:', JSON.stringify(company?.aiAgentLogic?.voiceSettings, null, 2));
      
      const elevenLabsVoice = company?.aiAgentLogic?.voiceSettings?.voiceId;
      logger.info('🔍 V2 VOICE CHECK: Extracted voiceId:', elevenLabsVoice || 'NOT FOUND');
      
      const responseText = result.response || result.text || "I understand. How can I help you?";
      logger.info('🔍 V2 VOICE CHECK: Response text:', responseText);
      logger.info('🔍 V2 VOICE CHECK: Will use ElevenLabs:', Boolean(elevenLabsVoice && responseText));
      
      if (elevenLabsVoice && responseText) {
        try {
          logger.info(`🎤 V2 ELEVENLABS: Using voice ${elevenLabsVoice} for response`);
          
          // Generate ElevenLabs audio
          const { synthesizeSpeech } = require('../services/v2elevenLabsService');
          const audioBuffer = await synthesizeSpeech({
            text: responseText,
            voiceId: elevenLabsVoice,
            stability: company.aiAgentLogic?.voiceSettings?.stability || 0.5,
            similarity_boost: company.aiAgentLogic?.voiceSettings?.similarityBoost || 0.75,
            style: company.aiAgentLogic?.voiceSettings?.style || 0.0,
            model_id: company.aiAgentLogic?.voiceSettings?.modelId || 'eleven_monolingual_v1'
          });
          
          // Store audio in Redis for serving
          const timestamp = Date.now();
          const audioKey = `audio:v2:${callSid}_${timestamp}`;
          await redisClient.setEx(audioKey, 300, audioBuffer.toString('base64'));
          
          const audioUrl = `https://${req.get('host')}/api/twilio/audio/v2/${callSid}_${timestamp}`;
          twiml.play(audioUrl);
          
          logger.info(`✅ V2 ELEVENLABS: Audio generated and stored at ${audioUrl}`);
          
        } catch (elevenLabsError) {
          logger.error('❌ V2 ELEVENLABS: Failed, falling back to Twilio voice:', elevenLabsError.message);
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
      const speechDetection = company.aiAgentLogic?.voiceSettings?.speechDetection || {};
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
      // V2 DELETED: Legacy responseCategories.core - using V2 Agent Personality system
      const fallbackResponse = `I understand you have a question. Let me connect you with someone who can help you better.`;
      twiml.say(fallbackResponse);
      twiml.hangup();
    }
    
    const twimlString = twiml.toString();
    logger.info('📤 CHECKPOINT 22: Sending TwiML response to Twilio');
    logger.info('📋 TwiML Content:', twimlString);
    
    res.type('text/xml');
    res.send(twimlString);
    
    logger.info('✅ CHECKPOINT 23: Response sent successfully');
    
  } catch (error) {
    logger.error('❌ CHECKPOINT ERROR: AI Agent Respond error:', error);
    logger.error('❌ Error stack:', error.stack);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Try to get the company and check if transfer is enabled
    try {
      const { companyID } = req.params;
      const company = await Company.findById(companyID);
      
      logger.info('🎯 CHECKPOINT ERROR RECOVERY: Attempting graceful error handling');
      
      // V2 DELETED: Legacy responseCategories.core - using V2 Agent Personality system
      const errorResponse = `I'm experiencing a technical issue. Let me connect you to our support team right away.`;
      
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
    
    const USE_3_TIER_FOR_TESTING = false;  // 🎯 CRITICAL: Keep FALSE to test YOUR rules
    
    if (ENABLE_3_TIER_INTELLIGENCE && USE_3_TIER_FOR_TESTING) {
      // 🚨 WARNING: This path is for PRODUCTION calls only!
      // For testing templates, we need to test YOUR rules directly.
      logger.info('🧠 [3-TIER ROUTING] Starting intelligent cascade (Tier 1 → 2 → 3)');
      
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
      const reply = replies[Math.floor(Math.random() * replies.length)] || 'I understand.';
      logger.debug(`🧠 [CHECKPOINT 8] ✅ Selected reply: "${reply.substring(0, 50)}..."`);
      
      logger.debug(`🧠 [CHECKPOINT 9] Adding reply to TwiML...`);
      // Say the matched reply + debug info
      twiml.say(reply);
      twiml.pause({ length: 1 });
      
      // Build debug message with tier information if 3-tier is enabled
      let debugMessage = `You triggered the scenario: ${result.scenario.name}. Confidence: ${(result.confidence * 100).toFixed(0)} percent.`;
      
      if (ENABLE_3_TIER_INTELLIGENCE && routingDetails.tierUsed) {
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
      ...(ENABLE_3_TIER_INTELLIGENCE && routingDetails.tierUsed && {
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
        
        if (ENABLE_3_TIER_INTELLIGENCE && routingDetails.tierUsed) {
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
          mode: ENABLE_3_TIER_INTELLIGENCE ? '3-tier' : 'test'
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

logger.info('🚀 [V2TWILIO] ========== EXPORTING ROUTER (FILE LOADED SUCCESSFULLY) ==========');
module.exports = router;