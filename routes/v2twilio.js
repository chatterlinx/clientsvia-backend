// Twilio Webhook Router - V3
// GLOBAL MULTI-TENANT PLATFORM
// CRITICAL: All changes affect ALL companies - no company-specific hardcoding
// POST-IT REMINDER: Use company.aiSettings for per-company configuration
// NEVER hardcode company IDs or special treatment for any single company
// ALWAYS design for global platform scalability
// TEST: "Would this work for company #1000 tomorrow?" If NO, fix it!
console.log('🚀 [V2TWILIO] ========== LOADING v2twilio.js FILE ==========');
const express = require('express');
const twilio = require('twilio');
const Company = require('../models/v2Company');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const HybridScenarioSelector = require('../services/HybridScenarioSelector');
const MatchDiagnostics = require('../services/MatchDiagnostics');
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

const router = express.Router();
console.log('🚀 [V2TWILIO] ========== EXPRESS ROUTER CREATED ==========');

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
  
  console.log(`🧪 [TEST STORE] Saved test result for template ${templateId}. Total: ${results.length}`);
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
      severity: 'critical',
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
      severity: 'info',
      message: 'Fuzzy matching found partial keyword overlap but not enough',
      fix: 'Caller words exist in triggers but need more overlap'
    });
  }
  
  return reasons;
}

// 🚨 GLOBAL CHECKPOINT: Log ALL requests to ANY Twilio endpoint
router.use((req, res, next) => {
  console.log('🔍 TWILIO ENDPOINT HIT:', {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    fullUrl: req.originalUrl,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'],
    contentType: req.headers['content-type'],
    bodyKeys: Object.keys(req.body || {}),
    hasCallSid: !!(req.body && req.body.CallSid)
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
    console.log('[AI AGENT] Using configured dial-out number:', company.aiAgentLogic.callTransferConfig.dialOutNumber);
    return company.aiAgentLogic.callTransferConfig.dialOutNumber;
  }
  
  // Fall back to Twilio config fallback number
  if (company?.twilioConfig?.fallbackNumber) {
    console.log('[AI AGENT] Using Twilio fallback number:', company.twilioConfig.fallbackNumber);
    return company.twilioConfig.fallbackNumber;
  }
  
  // No fallback number - transfer should be explicitly configured
  console.log('[AI AGENT] No transfer number configured - transfer disabled');
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
      console.log('[AI AGENT] Transfer enabled, transferring to:', transferNumber);
      twiml.say(transferMessage);
      twiml.dial(transferNumber);
    } else {
      console.log('[AI AGENT] Transfer enabled but no number configured, providing fallback message');
      // V2 DELETED: Legacy responseCategories.core - using V2 Agent Personality system
      const configResponse = `I understand you need assistance. Let me connect you with our support team who can help you right away.`;
      twiml.say(configResponse);
      twiml.hangup();
    }
  } else {
    console.log('[AI AGENT] Transfer disabled, providing fallback message and continuing conversation');
    twiml.say(fallbackMessage);
    
    // Continue conversation instead of hanging up [[memory:8276820]]
    const gather = twiml.gather({
      input: 'speech',
      speechTimeout: 'auto',
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
  if (!text) return '';
  
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
    console.log(`[NOTIFICATION CENTER CHECK] Checking if ${phoneNumber} is notification center test...`);
    const AdminSettings = require('../models/AdminSettings');
    const adminSettings = await AdminSettings.findOne({});
    
    if (adminSettings?.notificationCenter?.twilioTest?.enabled && 
        adminSettings.notificationCenter.twilioTest.phoneNumber === phoneNumber) {
      console.log(`🔔 [NOTIFICATION CENTER] Test number found: ${phoneNumber}`);
      // Return a special "company" object that signals this is notification center test
      return {
        isNotificationCenterTest: true,
        settings: adminSettings,
        _id: 'notification-center',
        name: 'Notification Center Test'
      };
    }
    
    // 🧠 CHECK 1: Is this a Global AI Brain test number?
    console.log(`[GLOBAL BRAIN CHECK] Checking if ${phoneNumber} is a test template...`);
    const testTemplate = await GlobalInstantResponseTemplate.findOne({
      'twilioTest.phoneNumber': phoneNumber,
      'twilioTest.enabled': true
    });
    
    if (testTemplate) {
      console.log(`🧠 [GLOBAL BRAIN] Test template found: ${testTemplate.name}`);
      // Return a special "company" object that signals this is a test template
      return {
        isGlobalTestTemplate: true,
        template: testTemplate,
        _id: testTemplate._id,
        name: testTemplate.name
      };
    }
    
    // 🏢 CHECK 2: Regular company lookup
    const cacheStartTime = Date.now();
    const cachedCompany = await redisClient.get(cacheKey);
    if (cachedCompany) {
      console.log(`[CACHE HIT] [FAST] Company found in cache for ${phoneNumber} in ${Date.now() - cacheStartTime}ms`);
      company = JSON.parse(cachedCompany);
    } else {
      console.log(`[CACHE MISS] [SEARCH] Company not cached for ${phoneNumber}, querying database...`);
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
        console.log(`[DB FALLBACK] Trying broader search for ${phoneNumber}...`);
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
        console.log(`[DB SUCCESS] [OK] Company found in database in ${dbEndTime - dbStartTime}ms`);
        await redisClient.setEx(cacheKey, 3600, JSON.stringify(company)); // Cache for 1 hour
        console.log(`[CACHE SAVE] 💾 Company cached for phone: ${phoneNumber}`);
      } else {
        const dbEndTime = Date.now();
        console.log(`[DB MISS] [ERROR] No company found in database for ${phoneNumber} (${dbEndTime - dbStartTime}ms)`);
      }
    }
  } catch (err) {
    console.error(`[CACHE/DB ERROR] [ERROR] Error fetching company by phone ${phoneNumber}:`, err.message);
    console.error(`[Redis/DB] Error fetching company by phone ${phoneNumber}:`, err.message, err.stack);
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
      console.log('🚀 Modern AI Agent Logic system active for company:', company._id.toString());
    }
  }
  return company;
}

router.post('/voice', async (req, res) => {
  const callStartTime = Date.now();
  
  // 🚨 CRITICAL CHECKPOINT: Log EVERYTHING at webhook entry
  console.log('='.repeat(80));
  console.log(`🚨 WEBHOOK HIT: /api/twilio/voice at ${new Date().toISOString()}`);
  console.log(`🚨 FULL REQUEST BODY:`, JSON.stringify(req.body, null, 2));
  console.log(`🚨 HEADERS:`, JSON.stringify(req.headers, null, 2));
  console.log(`🚨 URL:`, req.url);
  console.log(`🚨 METHOD:`, req.method);
  console.log(`🚨 IP:`, req.ip || req.connection.remoteAddress);
  console.log('='.repeat(80));
  
  console.log(`[CALL START] [CALL] New call initiated at: ${new Date().toISOString()}`);
  console.log(`[CALL DEBUG] From: ${req.body.From} → To: ${req.body.To} | CallSid: ${req.body.CallSid}`);
  
  try {
    console.log('[POST /api/twilio/voice] Incoming call:', req.body);
    const calledNumber = normalizePhoneNumber(req.body.To);
    const callerNumber = normalizePhoneNumber(req.body.From);
    console.log(`[PHONE LOOKUP] [SEARCH] Searching for company with phone: ${calledNumber}`);
    
    let company = await getCompanyByPhoneNumber(calledNumber);

    const twiml = new twilio.twiml.VoiceResponse();

    if (!company) {
      console.log(`[ERROR] [ERROR] No company found for phone number: ${calledNumber}`);
      
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
      console.log(`🚫 [SPAM BLOCKED] Call from ${callerNumber} blocked. Reason: ${filterResult.reason}`);
      
      // Play rejection message and hangup
      twiml.say('This call has been blocked. Goodbye.');
      twiml.hangup();
      
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    console.log(`✅ [SPAM FILTER] Call from ${callerNumber} passed all security checks`);

    // 🔔 NOTIFICATION CENTER TEST MODE (Same pattern as Global AI Brain)
    if (company.isNotificationCenterTest) {
      console.log(`🔔 [NOTIFICATION CENTER] Test mode activated`);
      
      const greeting = company.settings.notificationCenter.twilioTest.greeting;
      
      console.log(`🎙️ [NOTIFICATION CENTER] Playing greeting: "${greeting.substring(0, 80)}..."`);
      
      twiml.say({
        voice: 'alice',
        language: 'en-US'
      }, greeting);
      
      twiml.hangup();
      
      // Update stats (same as Global Brain)
      company.settings.notificationCenter.twilioTest.testCallCount++;
      company.settings.notificationCenter.twilioTest.lastTestedAt = new Date();
      await company.settings.save();
      
      console.log(`✅ [NOTIFICATION CENTER] Test call complete. Total calls: ${company.settings.notificationCenter.twilioTest.testCallCount}`);
      
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    // 🧠 GLOBAL AI BRAIN TEST MODE
    if (company.isGlobalTestTemplate) {
      console.log(`🧠 [GLOBAL BRAIN] Test mode activated for template: ${company.template.name}`);
      
      // Initialize selector with template scenarios
      const selector = new HybridScenarioSelector(company.template.categories);
      
      // Greet the tester with custom greeting (replace {template_name} placeholder)
      const rawGreeting = company.template.twilioTest?.greeting || 
        'Welcome to the ClientsVia Global AI Brain Testing Center. You are currently testing the {template_name} template. Please ask questions or make statements to test the AI scenarios now.';
      const greeting = rawGreeting.replace('{template_name}', company.template.name);
      
      console.log(`🎙️ [GLOBAL BRAIN] Using greeting: "${greeting.substring(0, 80)}..."`);
      
      const gather = twiml.gather({
        input: 'speech',
        action: `/api/twilio/test-respond/${company.template._id}`,
        method: 'POST',
        timeout: 5,
        speechTimeout: 'auto'
      });
      gather.say(greeting);
      
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    console.log(`[COMPANY FOUND] [OK] Company: ${company.companyName} (ID: ${company._id})`);
    
    // 🚨 CHECK ACCOUNT STATUS - Handle suspended/forwarded accounts
    if (company.accountStatus && company.accountStatus.status) {
      const accountStatus = company.accountStatus.status;
      console.log(`[ACCOUNT STATUS] Company status: ${accountStatus}`);
      
      if (accountStatus === 'suspended') {
        console.log(`[ACCOUNT SUSPENDED] Company ${company.companyName} account is suspended`);
        console.log(`[ACCOUNT SUSPENDED DEBUG] Raw suspendedMessage from DB:`, company.accountStatus.suspendedMessage);
        
        // Get custom suspended message from database (NO DEFAULT MESSAGE if empty)
        let suspendedMessage = company.accountStatus.suspendedMessage;
        
        if (suspendedMessage && suspendedMessage.trim()) {
          // Replace {Company Name} placeholder (case-insensitive, with or without space)
          console.log(`[ACCOUNT SUSPENDED] Using custom message with placeholder replacement`);
          const companyName = company.companyName || company.businessName || 'the company';
          // Match: {company name}, {companyname}, {Company Name}, {CompanyName}, etc.
          suspendedMessage = suspendedMessage.replace(/\{company\s*name\}/gi, companyName);
          console.log(`[ACCOUNT SUSPENDED] Final message: "${suspendedMessage}"`);
          twiml.say(escapeTwiML(suspendedMessage));
        } else {
          // No custom message - use default professional message
          console.log(`[ACCOUNT SUSPENDED] No custom message set - using default`);
          const defaultMessage = "We're sorry, but service for this number is temporarily unavailable. Please contact support for assistance.";
          twiml.say(escapeTwiML(defaultMessage));
        }
        
        twiml.hangup();
        res.type('text/xml');
        res.send(twiml.toString());
        return;
      }
      
      if (accountStatus === 'call_forward' && company.accountStatus.callForwardNumber) {
        console.log(`[CALL FORWARD] Forwarding call to ${company.accountStatus.callForwardNumber}`);
        console.log(`[CALL FORWARD DEBUG] Raw callForwardMessage from DB:`, company.accountStatus.callForwardMessage);
        const forwardNumber = company.accountStatus.callForwardNumber;
        
        // Get custom forward message from text box (NO DEFAULT MESSAGE)
        let forwardMessage = company.accountStatus.callForwardMessage;
        
        if (forwardMessage && forwardMessage.trim()) {
          // Replace {Company Name} placeholder (case-insensitive, with or without space)
          console.log(`[CALL FORWARD] Using custom message from text box with placeholder replacement`);
          const companyName = company.companyName || company.businessName || 'the company';
          // Match: {company name}, {companyname}, {Company Name}, {CompanyName}, etc.
          forwardMessage = forwardMessage.replace(/\{company\s*name\}/gi, companyName);
          console.log(`[CALL FORWARD] Final message: "${forwardMessage}"`);
          twiml.say(escapeTwiML(forwardMessage));
        } else {
          // No message in text box - forward silently (no greeting)
          console.log(`[CALL FORWARD] No custom message set - forwarding silently (no greeting)`);
        }
        
        twiml.dial(forwardNumber);
        res.type('text/xml');
        res.send(twiml.toString());
        return;
      }
    }
    
    console.log(`[AI AGENT LOGIC] Using new AI Agent Logic system for company: ${company._id}`);
    
    // 🚀 USE NEW V2 AI AGENT SYSTEM
    try {
      // Import V2 AI Agent Runtime - BRAND NEW SYSTEM
      const { initializeCall } = require('../services/v2AIAgentRuntime');
      
      // Initialize call with V2 Agent Personality system
      const initResult = await initializeCall(
        company._id.toString(),
        req.body.CallSid,
        req.body.From,
        req.body.To
      );
      
      console.log(`🔍 [CALL-1] Call initialized successfully`);
      console.log(`🔍 [CALL-2] Greeting from initializeCall:`, initResult.greeting);
      console.log(`🔍 [CALL-3] Voice settings from initializeCall:`, JSON.stringify(initResult.voiceSettings, null, 2));
      
      // DOUBLE-CHECK: Reload company to verify voiceSettings are in DB
      console.log(`🔍 [CALL-4] Double-checking voice settings from database...`);
      const freshCompany = await Company.findById(company._id);
      console.log(`🔍 [CALL-5] Fresh company.aiAgentLogic exists:`, !!freshCompany.aiAgentLogic);
      console.log(`🔍 [CALL-6] Fresh company.aiAgentLogic.voiceSettings:`, JSON.stringify(freshCompany.aiAgentLogic?.voiceSettings, null, 2));
      
      console.log(`[V2 AGENT] Call initialized, greeting: "${initResult.greeting}"`);
      console.log(`[V2 VOICE] Voice settings:`, JSON.stringify(initResult.voiceSettings, null, 2));
      
      // Set up speech gathering with V2 Agent response handler
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/v2-agent-respond/${company._id}`,
        method: 'POST',
        bargeIn: company.aiAgentLogic?.voiceSettings?.bargeIn ?? false,
        timeout: 5,
        speechTimeout: 'auto',
        enhanced: true,
        speechModel: 'phone_call',
        partialResultCallback: `https://${req.get('host')}/api/twilio/v2-agent-partial/${company._id}`
      });

      // Use V2 Voice Settings for TTS
      const elevenLabsVoice = initResult.voiceSettings?.voiceId;
      console.log(`🔍 [CALL-7] Extracted voice ID from initResult: ${elevenLabsVoice || 'NOT SET'}`);
      console.log(`🔍 [CALL-8] Has greeting: ${!!initResult.greeting}`);
      console.log(`🔍 [CALL-9] Will use ElevenLabs: ${!!(elevenLabsVoice && initResult.greeting)}`);
      console.log(`[V2 VOICE CHECK] ElevenLabs Voice ID: ${elevenLabsVoice || 'NOT SET'}`);
      console.log(`[V2 VOICE CHECK] Has greeting: ${!!initResult.greeting}`);
      
      if (elevenLabsVoice && initResult.greeting) {
        try {
          console.log(`[TTS START] ✅ Using ElevenLabs voice ${elevenLabsVoice} for initial greeting`);
          console.log(`[TTS START] [TTS] Starting AI Agent Logic greeting TTS synthesis...`);
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
          console.log(`[TTS COMPLETE] [OK] AI Agent Logic greeting TTS completed in ${ttsTime}ms`);
          
          const fileName = `ai_greet_${Date.now()}.mp3`;
          const audioDir = path.join(__dirname, '../public/audio');
          if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
          const filePath = path.join(audioDir, fileName);
          fs.writeFileSync(filePath, buffer);
          gather.play(`${req.protocol}://${req.get('host')}/audio/${fileName}`);
        } catch (err) {
          console.error('❌ AI Agent Logic TTS failed, using Say:', err);
          console.error('❌ Error details:', err.message);
          gather.say(escapeTwiML(initResult.greeting));
        }
      } else {
        // Fallback to Say if no voice or greeting
        console.log(`⚠️ Fallback to Twilio Say - Voice: ${elevenLabsVoice ? 'SET' : 'MISSING'}, Greeting: ${initResult.greeting ? 'SET' : 'MISSING'}`);
        const fallbackGreeting = initResult.greeting || "Configuration error - no greeting configured";
        gather.say(escapeTwiML(fallbackGreeting));
      }
      
    } catch (v2Error) {
      console.error(`[V2 AGENT ERROR] Failed to initialize V2 Agent: ${v2Error.message}`);
      console.log(`[FALLBACK] Using simple fallback for call`);
      
      // Fallback to simple greeting if V2 Agent fails
      const fallbackGreeting = `Configuration error - V2 Agent not configured for ${company.businessName || company.companyName}`;
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/handle-speech`,
        method: 'POST',
        bargeIn: false,
        timeout: 5,
        speechTimeout: 'auto',
        enhanced: true,
        speechModel: 'phone_call'
      });
      gather.say(escapeTwiML(fallbackGreeting));
    }

    res.type('text/xml');
    const twimlString = twiml.toString();
    console.log(`[Twilio Voice] Sending AI Agent Logic TwiML: ${twimlString}`);
    res.send(twimlString);
    
  } catch (error) {
    console.error(`[ERROR] [CRITICAL] Voice endpoint error: ${error.message}`);
    console.error(`[ERROR] Stack trace:`, error.stack);
    
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
  
  console.log(`[SPEECH START] [SPEECH] Speech processing started at: ${new Date().toISOString()}`);
  
  try {
    console.log(`[TWILIO TIMING] Speech webhook received at: ${new Date().toISOString()}`);
    console.log(`[TWILIO TIMING] Twilio sent SpeechResult: "${req.body.SpeechResult}" with confidence: ${req.body.Confidence}`);
    console.log('[POST /api/twilio/handle-speech] Incoming speech:', req.body);
    const speechText = req.body.SpeechResult || '';
    const twiml = new twilio.twiml.VoiceResponse();
    const callSid = req.body.CallSid;
    const repeatKey = `twilio-repeats:${callSid}`;

    if (!speechText) {
      console.log(`[SPEECH ERROR] [ERROR] Empty speech result received from Twilio`);
      // Legacy personality system removed - using configuration error message
      const msg = 'Configuration error: Company must configure AI Agent Logic responses';
      const fallbackText = `<Say>${escapeTwiML(msg)}</Say>`;
      twiml.hangup();
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
      return;
    }

    console.log(`[SPEECH RECEIVED] [TARGET] Processing speech: "${speechText}" (${speechText.length} chars)`);

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
      console.log(`[SPEECH QUALITY] ⚠️ Potentially unclear speech detected: "${speechText}"`);
    }
    
    if (isLikelyRambling) {
      console.log(`[SPEECH QUALITY] 📢 Rambling detected: ${speechText.length} chars, ${speechText.split(' ').length} words`);
    }

    const calledNumber = normalizePhoneNumber(req.body.To);
    console.log(`[COMPANY LOOKUP] [SEARCH] Looking up company for phone: ${calledNumber}`);
    let company = await getCompanyByPhoneNumber(calledNumber);
    if (!company) {
      console.log(`[COMPANY ERROR] [ERROR] No company found for phone: ${calledNumber} during speech processing`);
      // Legacy personality system removed - using configuration error message
      const msg = 'Configuration error: Company must configure AI Agent Logic responses';
      const fallbackText = `<Say>${escapeTwiML(msg)}</Say>`;
      twiml.hangup();
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${fallbackText}</Response>`);
      return;
    }

    console.log(`[COMPANY CONFIRMED] [OK] Processing speech for: ${company.companyName}`);

    confidence = parseFloat(req.body.Confidence || '0');
    threshold = company.aiSettings?.twilioSpeechConfidenceThreshold ?? 0.4;
    
    console.log(`[CONFIDENCE CHECK] Speech: "${speechText}" | Confidence: ${confidence} | Threshold: ${threshold} | ${confidence >= threshold ? 'PASS [OK]' : 'FAIL [ERROR]'}`);
    
    if (confidence < threshold) {
      console.log(`[CONFIDENCE REJECT] Low confidence (${confidence} < ${threshold}) - asking user to repeat`);
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
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/handle-speech`,
        method: 'POST',
        bargeIn: company.aiSettings?.bargeIn ?? false,
        timeout: 5, // Globally optimized for fast response
        speechTimeout: 'auto',
        enhanced: true,
        speechModel: 'phone_call',
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
      
      console.log(`[RETRY MESSAGE] Using message: "${retryMsg}" for speech: "${speechText}" (confidence: ${confidence})`);
      
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
          console.error('ElevenLabs TTS failed, falling back to <Say>:', err);
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
    console.log(`[Q&A] Loaded ${qnaEntries.length} Company Q&A entries for company ${companyId}`);
    console.log(`[Q&A DEBUG] Loaded Company Q&A entries for company ${companyId}:`, qnaEntries.map(e => ({
      question: e.question,
      keywords: e.keywords,
      answer: e.answer
    })));
    console.log(`[Q&A DEBUG] Incoming Speech: "${speechText}"`);
    
    const fuzzyThreshold = company.aiSettings?.fuzzyMatchThreshold ?? 0.3;
    console.log(`[Q&A MATCHING] [SEARCH] Searching ${qnaEntries.length} Q&A entries with fuzzy threshold: ${fuzzyThreshold}`);
    
    // V2 SYSTEM: Use Priority-Driven Knowledge Router instead of legacy findCachedAnswer
    console.log(`[V2 MIGRATION] Legacy Q&A matching disabled - use V2 AI Agent Runtime`);
    const cachedAnswer = null; // Force V2 system usage
    
    if (cachedAnswer) {
      console.log(`[Q&A MATCH FOUND] [OK] Found Q&A response for ${callSid}: ${cachedAnswer.substring(0, 100)}...`);
      
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
        console.log(`[Q&A REPETITION] ⚠️ Same Q&A response was recently given, providing clarification instead`);
        // Generate a clarification response instead of repeating
        const clarificationResponses = [
          "I've already shared that information with you. Is there something specific you'd like to know more about?",
          "As I mentioned, " + cachedAnswer.substring(0, 100) + "... Is there another way I can help you?",
          "I provided those details already. Do you have any other questions I can help with?",
          "We covered that just now. What else would you like to know about our services?"
        ];
        const clarification = clarificationResponses[Math.floor(Math.random() * clarificationResponses.length)];
        
        const gather = twiml.gather({
          input: 'speech',
          action: `https://${req.get('host')}/api/twilio/handle-speech`,
          method: 'POST',
          bargeIn: company.aiSettings?.bargeIn ?? false,
          timeout: 5,
          speechTimeout: 'auto',
          enhanced: true,
          speechModel: 'phone_call',
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
      
      console.log(`[Q&A RESPONSE] [OK] Using Q&A response (no repetition detected)`);
      
      const gather = twiml.gather({
        input: 'speech',
        action: `https://${req.get('host')}/api/twilio/handle-speech`,
        method: 'POST',
        bargeIn: company.aiSettings?.bargeIn ?? false,
        timeout: 5, // Globally optimized for fast response
        speechTimeout: 'auto',
        enhanced: true,
        speechModel: 'phone_call',
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
          console.error('ElevenLabs TTS failed, falling back to <Say>:', err);
          gather.say(escapeTwiML(cachedAnswer));
        }
      } else {
        gather.say(escapeTwiML(cachedAnswer));
      }

      // Add to conversation history
      conversationHistory.push({ role: 'user', text: speechText });
      conversationHistory.push({ role: 'assistant', text: cachedAnswer });
      await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));
      console.log(`[Q&A HISTORY] 💾 Saved Q&A exchange to conversation history`);

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
    console.log(`[AI AGENT LOGIC] 🤖 Starting AI response generation...`);
    const aiStartTime = Date.now();
    
    let answerObj;
    try {
      // V2 DELETED: Legacy aiAgentRuntime.processUserInput - using simple fallback
      // This endpoint should be replaced with V2 system
      console.log(`[LEGACY WARNING] Using legacy handle-speech endpoint - should migrate to V2`);
      
      answerObj = {
        text: "I understand your question. Let me connect you with someone who can help you better.",
        escalate: true
      };
      
      const aiEndTime = Date.now();
      console.log(`[AI AGENT LOGIC] [OK] AI response generated in ${aiEndTime - aiStartTime}ms`);
      console.log(`[AI] answerQuestion result for ${callSid}:`, answerObj);

      // Add AI response to history
      conversationHistory.push({ role: 'assistant', text: answerObj.text });
      await redisClient.setEx(historyKey, 60, JSON.stringify(conversationHistory));
      console.log(`[AI HISTORY] 💾 Saved conversation history (${conversationHistory.length} messages)`);

    } catch (err) {
      console.error(`[AI ERROR] [ERROR] AI processing failed: ${err.message}`);
      console.error(`[AI Processing Error for CallSid: ${callSid}]`, err.message, err.stack);
      const personality = company.aiSettings?.personality || 'friendly';
      // V2 DELETED: Legacy responseCategories.core - using V2 Agent Personality system
      const fallback = `I'm experiencing a technical issue. Let me connect you to our support team who can help you right away.`;
      answerObj = { text: fallback, escalate: false };
    }

    // Generate TTS and respond immediately
    const gather = twiml.gather({
      input: 'speech',
      action: `https://${req.get('host')}/api/twilio/handle-speech`,
      method: 'POST',
      bargeIn: company.aiSettings?.bargeIn ?? false,
      timeout: 5, // Globally optimized for fast response
      speechTimeout: 'auto',
      enhanced: true,
      speechModel: 'phone_call',
      partialResultCallback: `https://${req.get('host')}/api/twilio/partial-speech`
    });

    const strippedAnswer = cleanTextForTTS(stripMarkdown(answerObj.text));
    const elevenLabsVoice = company.aiAgentLogic?.voiceSettings?.voiceId;
    // TTS without artificial timeouts - let it complete naturally
    if (elevenLabsVoice) {
      try {
        console.log(`[TTS START] [TTS] Starting ElevenLabs synthesis for: "${strippedAnswer.substring(0, 50)}..."`);
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
        console.log(`[TTS COMPLETE] [OK] ElevenLabs synthesis completed in ${ttsTime}ms`);

        // Store audio in Redis for fast serving
        const audioKey = `audio:ai:${callSid}`;
        await redisClient.setEx(audioKey, 300, buffer.toString('base64'));
        
        const audioUrl = `https://${req.get('host')}/api/twilio/audio/ai/${callSid}`;
        gather.play(audioUrl);

      } catch (err) {
        console.error('ElevenLabs synthesis failed, falling back to native TTS:', err.message);
        // Use Twilio's enhanced TTS with voice settings to maintain consistency
        const voice = company.aiSettings?.twilioVoice || 'alice';
        gather.say({ voice: voice }, escapeTwiML(strippedAnswer));
      }
    } else {
      // Use consistent voice even when ElevenLabs is not configured
      const voice = company.aiSettings?.twilioVoice || 'alice';
      gather.say({ voice: voice }, escapeTwiML(strippedAnswer));
    }

    res.type('text/xml');
    const responseXML = twiml.toString();
    const requestEndTime = Date.now();
    console.log(`[TWILIO TIMING] Sending response at: ${new Date().toISOString()}`);
    console.log(`[TWILIO TIMING] Total processing time: ${requestEndTime - requestStartTime}ms`);
    console.log(`[TWILIO TIMING] Response XML length: ${responseXML.length} characters`);
    console.log(`[CONFIDENCE SUMMARY] Successfully processed speech with confidence ${confidence} (threshold: ${threshold})`);
    console.log(`[SPEECH COMPLETE] [OK] Speech processing completed in ${requestEndTime - requestStartTime}ms`);
    res.send(responseXML);
  } catch (err) {
    console.error(`[SPEECH ERROR] [ERROR] Speech processing failed: ${err.message}`);
    console.error('[POST /api/twilio/handle-speech] Error:', err.message, err.stack);
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
  console.log(`[PARTIAL SPEECH] Received at: ${new Date().toISOString()}`);
  console.log(`[PARTIAL SPEECH] Partial result: "${req.body.SpeechResult}" (Stability: ${req.body.Stability})`);
  
  // Just acknowledge - we'll process the final result
  res.status(200).send('OK');
});

// Diagnostic endpoint to measure exact Twilio speech timing
router.post('/speech-timing-test', async (req, res) => {
  const receiveTime = Date.now();
  console.log(`[DIAGNOSTIC] Speech timing test received at: ${new Date().toISOString()}`);
  console.log(`[DIAGNOSTIC] Twilio body:`, req.body);
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Immediate response with timing info
  twiml.say(`Speech received at ${new Date().toLocaleTimeString()}. Processing took ${Date.now() - receiveTime} milliseconds.`);
  
  const respondTime = Date.now();
  console.log(`[DIAGNOSTIC] Responding at: ${new Date().toISOString()}`);
  console.log(`[DIAGNOSTIC] Total processing: ${respondTime - receiveTime}ms`);
  
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
    console.error('[AUDIO ENDPOINT] Error:', err);
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
  console.log('='.repeat(80));
  console.log(`🚨 COMPANY WEBHOOK HIT: /api/twilio/voice/${companyID} at ${new Date().toISOString()}`);
  console.log(`🚨 FULL REQUEST BODY:`, JSON.stringify(req.body, null, 2));
  console.log(`🚨 HEADERS:`, JSON.stringify(req.headers, null, 2));
  console.log(`🚨 URL:`, req.url);
  console.log(`🚨 METHOD:`, req.method);
  console.log(`🚨 IP:`, req.ip || req.connection.remoteAddress);
  console.log('='.repeat(80));
  
  console.log(`[AI AGENT VOICE] [CALL] New call for company ${companyID} at: ${new Date().toISOString()}`);
  console.log(`[AI AGENT DEBUG] From: ${req.body.From} → CallSid: ${req.body.CallSid}`);
  
  try {
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Load company by ID
    const company = await Company.findById(companyID);
    if (!company) {
      console.log(`[ERROR] Company not found: ${companyID}`);
      // Use configurable response instead of hardcoded message [[memory:8276820]]
      const companyNotFoundResponse = `Configuration error: Company ${companyID} not found. Each company must be properly configured in the platform.`;
      twiml.say(companyNotFoundResponse);
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    console.log(`[AI AGENT COMPANY] ${company.businessName || company.companyName} (ID: ${companyID})`);
    
    // Check if AI Agent Logic is enabled
    if (company.aiAgentLogic?.enabled) {
      console.log(`[AI AGENT LOGIC] Enabled for company ${companyID}`);
      
      // Use new AI Agent Logic greeting - NO hardcoded fallbacks allowed
      const greeting = company.aiAgentLogic.responseCategories?.greeting?.template || 
        `Configuration error for ${company.businessName || company.companyName} - greeting not configured in Agent Personality tab`;
      
      // Apply placeholder replacement
      const finalGreeting = greeting.replace('{companyName}', company.businessName || company.companyName);
      
      console.log('🎯 CHECKPOINT 6: Adding AI greeting to TwiML');
      console.log(`🗣️ Greeting text: "${finalGreeting}"`);
      
      twiml.say({
        voice: company.aiAgentLogic.agentPersonality?.voice?.tone === 'robotic' ? 'Polly.Joanna' : 'alice'
      }, escapeTwiML(finalGreeting));
      
      console.log('🎯 CHECKPOINT 7: Setting up speech gathering');
      // Set up gather for AI Agent Logic flow
      const gather = twiml.gather({
        input: 'speech',
        speechTimeout: 'auto',
        speechModel: 'phone_call',
        action: `/api/twilio/v2-agent-respond/${companyID}`,
        method: 'POST',
        partialResultCallback: `/api/twilio/ai-agent-partial/${companyID}`,
        partialResultCallbackMethod: 'POST'
      });
      
      console.log('🎯 CHECKPOINT 8: Adding empty gather.say()');
      gather.say('');
      
      console.log('🎯 CHECKPOINT 9: Adding fallback message');
      // V2 DELETED: Legacy responseCategories.core - using V2 Agent Personality system
      const noInputFallback = `I didn't hear anything. How can I help you today?`;
      twiml.say(noInputFallback);
      twiml.hangup();
      
    } else {
      // AI Agent Logic not enabled - provide simple greeting and hang up
      console.log(`🎯 CHECKPOINT 6: AI Agent Logic not enabled for company ${companyID}, providing basic greeting`);
      
      // V2 DELETED: Legacy responseCategories.core - using V2 Agent Personality system
      const aiNotEnabledResponse = `Thank you for calling. Please hold while I connect you to someone who can assist you.`;
      twiml.say(aiNotEnabledResponse);
      twiml.hangup();
    }
    
    const twimlString = twiml.toString();
    console.log('📤 CHECKPOINT 10: Sending final TwiML response');
    console.log('📋 COMPLETE TwiML CONTENT:');
    console.log(twimlString);
    console.log('🚨 CRITICAL: If a "woman takes over" after this TwiML, it\'s NOT our code!');
    
    res.type('text/xml');
    res.send(twimlString);
    
  } catch (error) {
    console.error(`[ERROR] AI Agent Voice error for company ${companyID}:`, error);
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
  
  console.log('🎯 CHECKPOINT 11: AI Agent Response Handler Called');
  console.log(`📞 Call Details: SID=${callSid}, From=${fromNumber}`);
  console.log(`🗣️ User Speech: "${speechResult}"`);
  console.log('📋 Full request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { companyID } = req.params;
    
    console.log('🎯 CHECKPOINT 12: Processing AI Agent Response');
    console.log(`🏢 Company ID: ${companyID}`);
    
    // V2 DELETED: Legacy aiAgentRuntime - replaced with v2AIAgentRuntime
    // const { processCallTurn } = require('../services/aiAgentRuntime');
    
    console.log('🎯 CHECKPOINT 13: Initializing call state');
    // Get or initialize call state
    let callState = req.session?.callState || {
      callId: callSid,
      from: fromNumber,
      consecutiveSilences: 0,
      failedAttempts: 0,
      startTime: new Date()
    };
    
    console.log('🎯 CHECKPOINT 14: Calling V2 AI Agent Runtime processUserInput');
    // Process the call turn through V2 AI Agent Runtime
    const { processUserInput } = require('../services/v2AIAgentRuntime');
    const result = await processUserInput(
      companyID,
      callSid,
      speechResult,
      callState
    );
    
    console.log('🎯 CHECKPOINT 15: AI Agent Runtime response received');
    console.log('🤖 AI Response:', JSON.stringify(result, null, 2));
    
    // Update call state
    req.session = req.session || {};
    req.session.callState = result.callState;
    
    console.log('🎯 CHECKPOINT 16: Creating TwiML response');
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Handle different response types
    if (result.shouldHangup) {
      console.log('🎯 CHECKPOINT 17: AI decided to hang up');
      console.log(`🗣️ Final message: "${result.text}"`);
      twiml.say(escapeTwiML(result.text));
      twiml.hangup();
    } else if (result.shouldTransfer) {
      console.log('🎯 CHECKPOINT 18: AI decided to transfer call');
      console.log(`🗣️ Transfer message: "${result.text}"`);
      twiml.say(escapeTwiML(result.text));
      
      // Get company transfer number and check if transfer is enabled
      const company = await Company.findById(companyID);
      console.log('🎯 CHECKPOINT 19: Calling handleTransfer function');
      handleTransfer(twiml, company, "I apologize, but I cannot transfer you at this time. Please try calling back later or visiting our website for assistance.", companyID);
    } else {
      console.log('🎯 CHECKPOINT 20: AI continuing conversation');
      console.log(`🗣️ AI Response: "${result.response}"`);
      
      // 🎤 V2 ELEVENLABS INTEGRATION: Use ElevenLabs if configured
      const company = await Company.findById(companyID);
      
      // 🔍 DIAGNOSTIC: Log voice settings check
      console.log('🔍 V2 VOICE CHECK: Company loaded:', !!company);
      console.log('🔍 V2 VOICE CHECK: aiAgentLogic exists:', !!company?.aiAgentLogic);
      console.log('🔍 V2 VOICE CHECK: voiceSettings exists:', !!company?.aiAgentLogic?.voiceSettings);
      console.log('🔍 V2 VOICE CHECK: Full voiceSettings:', JSON.stringify(company?.aiAgentLogic?.voiceSettings, null, 2));
      
      const elevenLabsVoice = company?.aiAgentLogic?.voiceSettings?.voiceId;
      console.log('🔍 V2 VOICE CHECK: Extracted voiceId:', elevenLabsVoice || 'NOT FOUND');
      
      const responseText = result.response || result.text || "I understand. How can I help you?";
      console.log('🔍 V2 VOICE CHECK: Response text:', responseText);
      console.log('🔍 V2 VOICE CHECK: Will use ElevenLabs:', !!(elevenLabsVoice && responseText));
      
      if (elevenLabsVoice && responseText) {
        try {
          console.log(`🎤 V2 ELEVENLABS: Using voice ${elevenLabsVoice} for response`);
          
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
          
          console.log(`✅ V2 ELEVENLABS: Audio generated and stored at ${audioUrl}`);
          
        } catch (elevenLabsError) {
          console.error('❌ V2 ELEVENLABS: Failed, falling back to Twilio voice:', elevenLabsError.message);
          // Fallback to Twilio voice
          twiml.say({
            voice: result.controlFlags?.tone === 'robotic' ? 'Polly.Joanna' : 'alice'
          }, escapeTwiML(responseText));
        }
      } else {
        // Use Twilio voice as fallback
        console.log('🎤 V2 FALLBACK: Using Twilio voice (no ElevenLabs configured)');
        twiml.say({
          voice: result.controlFlags?.tone === 'robotic' ? 'Polly.Joanna' : 'alice'
        }, escapeTwiML(responseText));
      }
      
      console.log('🎯 CHECKPOINT 21: Setting up next speech gathering');
      // Set up next gather
      const gather = twiml.gather({
        input: 'speech',
        speechTimeout: 'auto',
        speechModel: 'phone_call',
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
    console.log('📤 CHECKPOINT 22: Sending TwiML response to Twilio');
    console.log('📋 TwiML Content:', twimlString);
    
    res.type('text/xml');
    res.send(twimlString);
    
    console.log('✅ CHECKPOINT 23: Response sent successfully');
    
  } catch (error) {
    console.error('❌ CHECKPOINT ERROR: AI Agent Respond error:', error);
    console.error('❌ Error stack:', error.stack);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Try to get the company and check if transfer is enabled
    try {
      const { companyID } = req.params;
      const company = await Company.findById(companyID);
      
      console.log('🎯 CHECKPOINT ERROR RECOVERY: Attempting graceful error handling');
      
      // V2 DELETED: Legacy responseCategories.core - using V2 Agent Personality system
      const errorResponse = `I'm experiencing a technical issue. Let me connect you to our support team right away.`;
      
      twiml.say(errorResponse);
      handleTransfer(twiml, company, "Our team will be happy to assist you.", companyID);
    } catch (companyError) {
      console.error('❌ CHECKPOINT DOUBLE ERROR: Could not load company for transfer:', companyError);
      // Use configurable response instead of hardcoded message [[memory:8276820]]
      const doubleErrorResponse = `Configuration error: Company ${req.params.companyID} must configure error responses in AI Agent Logic. Each company must have their own protocol.`;
      twiml.say(doubleErrorResponse);
      twiml.hangup();
    }
    
    console.log('📤 CHECKPOINT ERROR RESPONSE: Sending error TwiML');
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// AI Agent Logic partial results handler (for real-time processing)
router.post('/ai-agent-partial/:companyID', async (req, res) => {
  try {
    const { companyID } = req.params;
    const { PartialSpeechResult, CallSid } = req.body;
    
    console.log(`[AI AGENT PARTIAL] Company: ${companyID}, CallSid: ${CallSid}, Partial: "${PartialSpeechResult}"`);
    
    // For now, just acknowledge - could be used for real-time intent detection
    res.json({ success: true });
    
  } catch (error) {
    console.error('[ERROR] AI Agent Partial error:', error);
    res.json({ success: false });
  }
});

// 🚨 WEBHOOK CONNECTIVITY TEST ENDPOINT
router.all('/webhook-test', (req, res) => {
  const timestamp = new Date().toISOString();
  
  console.log('🧪 WEBHOOK TEST HIT:', {
    timestamp,
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: req.body,
    query: req.query,
    ip: req.ip || req.connection.remoteAddress
  });
  
  // Return both JSON and TwiML for testing
  if (req.headers['accept'] && req.headers['accept'].includes('application/json')) {
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
console.log('🔍 [ROUTE REGISTRATION] Registering /test-respond/:templateId route...');
router.post('/test-respond/:templateId', async (req, res) => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧠 [CHECKPOINT 1] ===== ROUTE HIT ===== test-respond endpoint triggered`);
  console.log(`🧠 [CHECKPOINT 1] Template ID: ${req.params.templateId}`);
  console.log(`🧠 [CHECKPOINT 1] Request Method: ${req.method}`);
  console.log(`🧠 [CHECKPOINT 1] Request Path: ${req.path}`);
  console.log(`${'='.repeat(80)}\n`);
  
  try {
    console.log(`🧠 [CHECKPOINT 2] Extracting parameters...`);
    const { templateId } = req.params;
    const speechText = req.body.SpeechResult || '';
    console.log(`🧠 [CHECKPOINT 2] ✅ Template ID: ${templateId}`);
    console.log(`🧠 [CHECKPOINT 2] ✅ Speech Input: "${speechText}"`);
    
    console.log(`🧠 [CHECKPOINT 3] Loading template from database...`);
    const template = await GlobalInstantResponseTemplate.findById(templateId);
    console.log(`🧠 [CHECKPOINT 3] ✅ Template loaded: ${template ? template.name : 'NOT FOUND'}`);
    
    if (!template || !template.twilioTest?.enabled) {
      console.log(`🧠 [CHECKPOINT 3] ❌ Template not found or testing disabled`);
      console.log(`🧠 [CHECKPOINT 3] Template exists: ${!!template}`);
      console.log(`🧠 [CHECKPOINT 3] Testing enabled: ${template?.twilioTest?.enabled}`);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Test template not found or testing is disabled.');
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }
    
    console.log(`🧠 [CHECKPOINT 4] Initializing HybridScenarioSelector...`);
    console.log(`🧠 [CHECKPOINT 4] Categories count: ${template.categories?.length || 0}`);
    
    // Initialize selector with template's filler words and urgency keywords
    const fillerWords = template.fillerWords || [];
    const urgencyKeywords = template.urgencyKeywords || [];
    console.log(`🧠 [CHECKPOINT 4] Filler words count: ${fillerWords.length}, Urgency keywords: ${urgencyKeywords.length}`);
    const selector = new HybridScenarioSelector(fillerWords, urgencyKeywords);
    console.log(`🧠 [CHECKPOINT 4] ✅ Selector initialized with ${fillerWords.length} filler words and ${urgencyKeywords.length} urgency keywords`);
    
    console.log(`🧠 [CHECKPOINT 5] Running scenario matching...`);
    console.log(`🧠 [CHECKPOINT 5] Extracting scenarios from ${template.categories.length} categories...`);
    
    // Extract all scenarios from categories
    const allScenarios = [];
    template.categories.forEach(category => {
      if (category.scenarios && Array.isArray(category.scenarios)) {
        allScenarios.push(...category.scenarios);
      }
    });
    
    console.log(`🧠 [CHECKPOINT 5] Total scenarios to match: ${allScenarios.length}`);
    const result = await selector.selectScenario(speechText, allScenarios);
    console.log(`🧠 [CHECKPOINT 5] ✅ Matching complete`);
    console.log(`🧠 [CHECKPOINT 5] Match found: ${!!result.match}`);
    console.log(`🧠 [CHECKPOINT 5] Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    
    console.log(`🧠 [CHECKPOINT 6] Building TwiML response...`);
    const twiml = new twilio.twiml.VoiceResponse();
    console.log(`🧠 [CHECKPOINT 6] ✅ TwiML response object created`);
    
    if (result.scenario) {  // FIXED: was result.match, should be result.scenario
      console.log(`🧠 [CHECKPOINT 7] ✅ MATCH FOUND!`);
      console.log(`🧠 [CHECKPOINT 7] Scenario: ${result.scenario.name}`);
      console.log(`🧠 [CHECKPOINT 7] Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      
      console.log(`🧠 [CHECKPOINT 8] Selecting random reply...`);
      // Pick a random reply
      const replies = result.scenario.fullReplies && result.scenario.fullReplies.length > 0 
        ? result.scenario.fullReplies 
        : result.scenario.quickReplies || [];
      
      console.log(`🧠 [CHECKPOINT 8] Available replies: ${replies.length}`);
      const reply = replies[Math.floor(Math.random() * replies.length)] || 'I understand.';
      console.log(`🧠 [CHECKPOINT 8] ✅ Selected reply: "${reply.substring(0, 50)}..."`);
      
      console.log(`🧠 [CHECKPOINT 9] Adding reply to TwiML...`);
      // Say the matched reply + debug info
      twiml.say(reply);
      twiml.pause({ length: 1 });
      twiml.say(`You triggered the scenario: ${result.scenario.name}. Confidence: ${(result.confidence * 100).toFixed(0)} percent. Score: ${(result.score * 100).toFixed(0)} percent.`);
      console.log(`🧠 [CHECKPOINT 9] ✅ TwiML reply added`);
      
      console.log(`🧠 [CHECKPOINT 10] Creating gather for continuation...`);
      // Continue conversation
      const gather = twiml.gather({
        input: 'speech',
        action: `/api/twilio/test-respond/${templateId}`,
        method: 'POST',
        timeout: 5,
        speechTimeout: 'auto'
      });
      gather.say('Say something else to test another scenario, or hang up to end the test.');
      console.log(`🧠 [CHECKPOINT 10] ✅ Gather created`);
      
    } else {
      console.log(`🧠 [CHECKPOINT 7] ❌ NO MATCH`);
      console.log(`🧠 [CHECKPOINT 7] Confidence too low: ${(result.confidence * 100).toFixed(1)}%`);
      twiml.say(`No scenario matched your input. Confidence was ${(result.confidence * 100).toFixed(0)} percent, which is below the threshold.`);
      twiml.pause({ length: 1 });
      
      console.log(`🧠 [CHECKPOINT 8] Creating gather for retry...`);
      // Continue conversation
      const gather = twiml.gather({
        input: 'speech',
        action: `/api/twilio/test-respond/${templateId}`,
        method: 'POST',
        timeout: 5,
        speechTimeout: 'auto'
      });
      gather.say('Try saying something else.');
      console.log(`🧠 [CHECKPOINT 8] ✅ Gather created`);
    }
    
    console.log(`🧠 [CHECKPOINT 11] Updating test stats in database...`);
    // Update test stats
    await GlobalInstantResponseTemplate.findByIdAndUpdate(templateId, {
      $inc: { 'twilioTest.testCallCount': 1 },
      $set: { 'twilioTest.lastTestedAt': new Date() }
    });
    console.log(`🧠 [CHECKPOINT 11] ✅ Stats updated`);
    
    // ============================================
    // 🧪 SAVE TEST RESULT TO MEMORY
    // ============================================
    const testResult = {
      timestamp: new Date().toISOString(),
      phrase: speechText,
      matched: !!result.scenario,  // FIXED: was result.match, should be result.scenario
      confidence: result.confidence || 0,
      threshold: result.trace?.threshold || 0.45,
      scenario: result.scenario ? {
        id: result.scenario.scenarioId || result.scenario._id,
        name: result.scenario.name,
        category: result.scenario.category
      } : null,
      topCandidates: result.trace?.topCandidates || [],
      timing: result.trace?.timingMs || {},
      callSid: req.body.CallSid
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
      console.log(`🤖 [AI ANALYSIS] Found ${aiAnalysis.suggestions.length} suggestions, ${aiAnalysis.issues.length} issues`);
    }
    
    // ============================================
    // 🛡️ DECISION-CONTRACT SAFETY RAIL
    // ============================================
    // CRITICAL: If confidence ≥ threshold but NO scenario, this is an ENGINE BUG
    const threshold = testResult.threshold || 0.45;
    const confidence = testResult.confidence || 0;
    const hasScenario = !!result.scenario;
    
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
          hasScenario: hasScenario,
          hasTrace: !!result.trace,
          topCandidates: result.trace?.topCandidates || []
        }
      };
      
      console.error(`\n${'🚨'.repeat(40)}`);
      console.error(`🚨 DECISION-CONTRACT VIOLATION DETECTED!`);
      console.error(`🚨 Confidence: ${(confidence * 100).toFixed(1)}% (threshold: ${(threshold * 100).toFixed(1)}%)`);
      console.error(`🚨 Scenario returned: ${hasScenario}`);
      console.error(`🚨 This should NEVER happen - engine logic bug!`);
      console.error(JSON.stringify(violation, null, 2));
      console.error(`${'🚨'.repeat(40)}\n`);
      
      // Add to test result for debugging
      testResult.contractViolation = violation;
      
      // Override reason code to E01: EngineBug
      if (testResult.diagnostics && testResult.diagnostics.reasonCodes) {
        testResult.diagnostics.primaryReasonCode = 'E01';
        testResult.diagnostics.reasonCodes.unshift({
          code: 'E01',
          name: 'EngineBug',
          type: 'error',
          severity: 'critical',
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
    console.log(`🧪 [CHECKPOINT 11.5] Test result saved to memory with AI analysis + diagnostics`);
    
    console.log(`🧠 [CHECKPOINT 12] Sending TwiML response to Twilio...`);
    res.type('text/xml').status(200).send(twiml.toString());
    console.log(`🧠 [CHECKPOINT 12] ✅ Response sent successfully`);
    console.log(`${'='.repeat(80)}\n`);
    
  } catch (error) {
    console.error(`\n${'!'.repeat(80)}`);
    console.error(`🚨 [ERROR CHECKPOINT] EXCEPTION CAUGHT IN test-respond`);
    console.error(`🚨 [ERROR CHECKPOINT] Error Message: ${error.message}`);
    console.error(`🚨 [ERROR CHECKPOINT] Error Stack:`);
    console.error(error.stack);
    console.error(`${'!'.repeat(80)}\n`);
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
  
  console.log(`🧪 [TEST RESULTS] Fetching last ${limit} results for template ${templateId}`);
  
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
  const { templateId } = req.params;
  const limit = parseInt(req.query.limit) || 100; // Analyze more for quality metrics
  
  console.log(`📊 [QUALITY REPORT] Generating report for template ${templateId} (last ${limit} tests)`);
  
  const results = getTestResults(templateId, limit);
  const qualityReport = MatchDiagnostics.generateQualityReport(results);
  
  res.json({
    success: true,
    templateId,
    report: qualityReport
  });
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
        
        console.log(`📞 [VOICE WEBHOOK] Incoming call from ${from} to ${to}`);
        
        // Get custom greeting from AdminSettings
        const AdminSettings = require('../models/AdminSettings');
        const settings = await AdminSettings.getSettings();
        const greeting = settings.notificationCenter?.testCallGreeting || 
            'This is a ClientsVia system check. Your Twilio integration is working correctly.';
        
        console.log(`🗣️ [VOICE WEBHOOK] Playing greeting (${greeting.length} chars)`);
        
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
        
        console.log('✅ [VOICE WEBHOOK] TwiML response sent');
        
    } catch (error) {
        console.error('❌ [VOICE WEBHOOK] Error processing call:', error);
        
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
        
        console.log(`📱 [SMS WEBHOOK] Received SMS from ${from}: "${message}"`);
        
        // ====================================================================
        // CHECK FOR ACKNOWLEDGMENT: "ACK ALT-20251020-001"
        // ====================================================================
        const ackMatch = message.match(/ACK\s+(ALT-\d{8}-\d{3})/i);
        
        if (ackMatch) {
            const alertId = ackMatch[1].toUpperCase();
            
            console.log(`✅ [SMS WEBHOOK] Acknowledgment detected for alert: ${alertId}`);
            
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
                
                console.log(`✅ [SMS WEBHOOK] Alert ${alertId} acknowledged by ${adminName}`);
                
                // Send TwiML response (empty - confirmation will be sent separately)
                res.type('text/xml');
                res.send('<Response></Response>');
                return;
                
            } catch (error) {
                console.error(`❌ [SMS WEBHOOK] Failed to acknowledge alert ${alertId}:`, error);
                
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
            
            console.log(`🔕 [SMS WEBHOOK] Snooze detected for alert: ${alertId} (${minutes} minutes)`);
            
            try {
                const AlertEscalationService = require('../services/AlertEscalationService');
                await AlertEscalationService.snoozeAlert(alertId, minutes, 'Snoozed via SMS');
                
                console.log(`✅ [SMS WEBHOOK] Alert ${alertId} snoozed for ${minutes} minutes`);
                
                res.type('text/xml');
                res.send('<Response></Response>');
                return;
                
            } catch (error) {
                console.error(`❌ [SMS WEBHOOK] Failed to snooze alert ${alertId}:`, error);
                
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
            
            console.log(`🔄 [SMS WEBHOOK] Reopen detected for alert: ${alertId}`);
            
            try {
                const AlertEscalationService = require('../services/AlertEscalationService');
                await AlertEscalationService.resumeEscalation(alertId);
                
                console.log(`✅ [SMS WEBHOOK] Alert ${alertId} reopened`);
                
                const twiml = new twilio.twiml.MessagingResponse();
                twiml.message(`✅ Alert ${alertId} has been reopened and escalation resumed.`);
                res.type('text/xml');
                res.send(twiml.toString());
                return;
                
            } catch (error) {
                console.error(`❌ [SMS WEBHOOK] Failed to reopen alert ${alertId}:`, error);
                
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
            console.log(`✅ [SMS WEBHOOK] Test command received from ${from}`);
            console.log('📧 [SMS WEBHOOK] STARTING email notification process...');
            
            // 📧 Send email notification to admins (Gmail - clientsvia@gmail.com)
            // ARCHITECTURE: Admin notifications use Gmail, customer emails use SendGrid (future)
            try {
                console.log('📧 [SMS WEBHOOK] Step 1: Requiring emailClient...');
                const emailClient = require('../clients/emailClient');
                console.log('📧 [SMS WEBHOOK] Step 2: emailClient loaded successfully');
                
                console.log('📧 [SMS WEBHOOK] Step 3: Creating timestamp...');
                const timestamp = new Date().toLocaleString('en-US', { 
                    timeZone: 'America/New_York',
                    dateStyle: 'short',
                    timeStyle: 'long'
                });
                console.log(`📧 [SMS WEBHOOK] Step 4: Timestamp created: ${timestamp}`);
                
                console.log('📧 [SMS WEBHOOK] Step 5: Calling emailClient.sendAdminAlert()...');
                const result = await emailClient.sendAdminAlert(
                    '✅ SMS Test Received',
                    `SMS Test Command Received!\n\nFrom: ${from}\nMessage: "${message}"\nTime: ${timestamp} ET\n\n✅ Webhook is working correctly!\n📱 SMS system is LIVE!`,
                    `<h2>✅ SMS Test Command Received!</h2><p><strong>From:</strong> ${from}</p><p><strong>Message:</strong> "${message}"</p><p><strong>Time:</strong> ${timestamp} ET</p><hr><p>✅ Webhook is working correctly!</p><p>📱 SMS system is LIVE!</p>`
                );
                console.log('📧 [SMS WEBHOOK] Step 6: sendAdminAlert() returned:', JSON.stringify(result));
                
                if (result.success) {
                    console.log(`📧 [SMS WEBHOOK] ✅ SUCCESS! Admin alert sent to ${result.recipients} recipient(s)`);
                } else {
                    console.error(`❌ [SMS WEBHOOK] FAILED! Error: ${result.error}`);
                }
                
            } catch (emailError) {
                console.error('⚠️ [SMS WEBHOOK] EXCEPTION caught:', emailError.message);
                console.error('⚠️ [SMS WEBHOOK] Error stack:', emailError.stack);
            }
            
            console.log('📧 [SMS WEBHOOK] Email notification process COMPLETE');
            
            const twiml = new twilio.twiml.MessagingResponse();
            twiml.message(`✅ ClientsVia SMS System is LIVE!\n\n🚀 2-way SMS confirmed working.\n📱 Webhook connected.\n⏰ ${new Date().toLocaleString()}`);
            
            res.type('text/xml');
            res.send(twiml.toString());
            return;
        }
        
        // ====================================================================
        // NOT A RECOGNIZED COMMAND - Send help message
        // ====================================================================
        console.log(`ℹ️ [SMS WEBHOOK] Unrecognized command from ${from}`);
        
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
        console.error('❌ [SMS WEBHOOK] Error processing SMS:', error);
        
        // Always return valid TwiML even on error
        res.type('text/xml');
        res.send('<Response></Response>');
    }
});

// 🚨 CATCH-ALL ENDPOINT - Must be LAST to log any unmatched Twilio requests
router.all('*', (req, res) => {
  console.log('❌ UNMATCHED TWILIO REQUEST:', {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    fullUrl: req.originalUrl,
    path: req.path,
    params: req.params,
    hasCallSid: !!(req.body?.CallSid)
  });
  
  // CRITICAL: Always return TwiML for Twilio requests, NEVER JSON!
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say('This endpoint is not configured. Please check your Twilio webhook settings.');
  twiml.hangup();
  res.type('text/xml').status(200).send(twiml.toString());
});

console.log('🚀 [V2TWILIO] ========== EXPORTING ROUTER (FILE LOADED SUCCESSFULLY) ==========');
module.exports = router;