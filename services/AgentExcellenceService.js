/**
 * AgentExcellenceService
 * 
 * PURPOSE: Calculate agent performance scores and generate improvement suggestions
 * - Pulls real call data from Call Center
 * - Calculates transparent, deterministic scores
 * - Generates LLM-powered improvement suggestions (async, cached)
 * - Tracks revenue impact
 * 
 * NEVER auto-applies changes. All suggestions require human approval.
 * 
 * @module services/AgentExcellenceService
 */

const logger = require('../utils/logger');
const OpenAI = require('openai');
const AgentExcellenceScore = require('../models/AgentExcellenceScore');
const CallSummary = require('../models/CallSummary');
const Customer = require('../models/Customer');
const TriageCard = require('../models/TriageCard');
const TriageCardMetrics = require('../models/TriageCardMetrics');
const V2Company = require('../models/v2Company');

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // How many days of data to analyze
  analysisPeriodDays: 7,
  
  // Cache LLM analysis for this long (hours)
  llmCacheHours: 24,
  
  // Industry benchmarks for comparison
  benchmarks: {
    bookingRate: 0.65,        // 65% booking rate is "good"
    hangupRate: 0.10,         // <10% hangup is "good"
    transferRate: 0.15,       // <15% transfer is "good"
    avgHandleTime: 180,       // 3 minutes is optimal
    recognitionRate: 0.90,    // 90% recognition is "good"
    questionAnswerRate: 0.95  // 95% answer rate is "good"
  },
  
  // Default revenue assumptions if not configured
  defaultAvgJobValue: 250  // $250 per service call
};

class AgentExcellenceService {
  
  /**
   * Calculate full excellence score for a company
   * This is the main entry point for dashboard display
   */
  static async calculateScore(companyId) {
    const startTime = Date.now();
    
    logger.info('[EXCELLENCE] Calculating score', { companyId: String(companyId) });
    
    try {
      // Check for cached score (within 1 hour)
      const cachedScore = await this.getCachedScore(companyId);
      if (cachedScore) {
        logger.info('[EXCELLENCE] Returning cached score', { 
          companyId: String(companyId),
          score: cachedScore.overallScore 
        });
        return cachedScore;
      }
      
      // Get company config
      const company = await V2Company.findById(companyId).lean();
      if (!company) {
        throw new Error('Company not found');
      }
      
      // Calculate all category scores
      const [
        bookingFlow,
        triageAccuracy,
        knowledgeCompleteness,
        customerMemory,
        callOutcomes,
        frontlineIntelligence,
        rawMetrics
      ] = await Promise.all([
        this.calculateBookingFlowScore(companyId),
        this.calculateTriageAccuracyScore(companyId),
        this.calculateKnowledgeScore(companyId, company),
        this.calculateCustomerMemoryScore(companyId),
        this.calculateCallOutcomesScore(companyId, company),
        this.calculateFrontlineScore(companyId, company),
        this.getRawMetrics(companyId)
      ]);
      
      // Build categories object
      const categories = {
        bookingFlow,
        triageAccuracy,
        knowledgeCompleteness,
        customerMemory,
        callOutcomes,
        frontlineIntelligence
      };
      
      // Calculate overall score using transparent formula
      const overallScore = AgentExcellenceScore.calculateOverallScore(categories);
      
      // Get previous score for trending
      const previousScoreDoc = await AgentExcellenceScore.getLatestScore(companyId);
      const previousScore = previousScoreDoc?.overallScore || overallScore;
      const delta = overallScore - previousScore;
      const trend = delta > 1 ? 'UP' : delta < -1 ? 'DOWN' : 'STABLE';
      
      // Calculate revenue metrics
      const revenue = this.calculateRevenueMetrics(rawMetrics, company);
      
      // Create score document
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const scoreDoc = await AgentExcellenceScore.findOneAndUpdate(
        { companyId, date: today },
        {
          companyId,
          date: today,
          overallScore,
          previousScore,
          trend,
          trendDelta: delta,
          categories,
          revenue,
          rawMetrics
        },
        { upsert: true, new: true }
      );
      
      logger.info('[EXCELLENCE] Score calculated', {
        companyId: String(companyId),
        overallScore,
        trend,
        duration: Date.now() - startTime
      });
      
      return scoreDoc;
      
    } catch (error) {
      logger.error('[EXCELLENCE] Score calculation failed', {
        companyId: String(companyId),
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
  
  /**
   * Get cached score if still valid
   */
  static async getCachedScore(companyId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    return AgentExcellenceScore.findOne({
      companyId,
      date: today,
      updatedAt: { $gte: oneHourAgo }
    });
  }
  
  /**
   * Calculate Booking Flow score (20% weight)
   */
  static async calculateBookingFlowScore(companyId) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - CONFIG.analysisPeriodDays);
    
    const calls = await CallSummary.find({
      companyId,
      callStartTime: { $gte: startDate }
    }).lean();
    
    const totalCalls = calls.length;
    const bookings = calls.filter(c => c.outcome === 'booked' || c.outcome === 'appointment_scheduled');
    const bookingRate = totalCalls > 0 ? bookings.length / totalCalls : 0;
    
    // Calculate avg time to book (from calls that resulted in booking)
    const bookingCalls = calls.filter(c => c.outcome === 'booked' && c.duration);
    const avgTimeToBook = bookingCalls.length > 0
      ? bookingCalls.reduce((sum, c) => sum + (c.duration || 0), 0) / bookingCalls.length
      : 0;
    
    // Access info capture rate
    const callsWithAccess = calls.filter(c => 
      c.aiContext?.accessInfo || c.aiContext?.gateCode || c.aiContext?.lockboxCode
    );
    const accessInfoCaptureRate = bookings.length > 0 
      ? callsWithAccess.length / bookings.length 
      : 0;
    
    // Score calculation
    // - Booking rate: 60% of score
    // - Time efficiency: 20% of score
    // - Access capture: 20% of score
    
    const bookingScore = Math.min(100, (bookingRate / CONFIG.benchmarks.bookingRate) * 100);
    const timeScore = avgTimeToBook <= 180 ? 100 : Math.max(0, 100 - ((avgTimeToBook - 180) / 3));
    const accessScore = accessInfoCaptureRate * 100;
    
    const score = Math.round(bookingScore * 0.6 + timeScore * 0.2 + accessScore * 0.2);
    const { status } = AgentExcellenceScore.getStatusFromScore(score);
    
    return {
      score,
      weight: AgentExcellenceScore.SCORE_WEIGHTS.bookingFlow,
      status,
      details: `${Math.round(bookingRate * 100)}% booking rate, ${Math.round(avgTimeToBook)}s avg time`,
      metrics: {
        bookingRate: Math.round(bookingRate * 100) / 100,
        avgTimeToBook: Math.round(avgTimeToBook),
        accessInfoCaptureRate: Math.round(accessInfoCaptureRate * 100) / 100,
        rescheduleSuccessRate: 0.95 // TODO: Calculate from actual data
      }
    };
  }
  
  /**
   * Calculate Triage Accuracy score (20% weight)
   */
  static async calculateTriageAccuracyScore(companyId) {
    const metrics = await TriageCardMetrics.getCardHealthSummary(companyId, CONFIG.analysisPeriodDays);
    
    // Get unmatched phrases
    const unmatchedPhrases = await TriageCardMetrics.getUnmatchedPhrases(companyId, CONFIG.analysisPeriodDays, 50);
    
    // Calculate aggregate metrics
    const totalFires = metrics.reduce((sum, m) => sum + (m.totalFires || 0), 0);
    const totalFalsePositives = metrics.reduce((sum, m) => sum + (m.totalFalsePositives || 0), 0);
    const avgPrecision = metrics.length > 0
      ? metrics.reduce((sum, m) => sum + (m.avgPrecision || 0.9), 0) / metrics.length
      : 0.9;
    
    // Match rate (from call summaries)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - CONFIG.analysisPeriodDays);
    
    const calls = await CallSummary.countDocuments({
      companyId,
      callStartTime: { $gte: startDate }
    });
    
    const matchedCalls = await CallSummary.countDocuments({
      companyId,
      callStartTime: { $gte: startDate },
      'triageResult.matched': true
    });
    
    const matchRate = calls > 0 ? matchedCalls / calls : 0;
    const falsePositiveRate = totalFires > 0 ? totalFalsePositives / totalFires : 0;
    
    // Score calculation
    const matchScore = matchRate * 100;
    const precisionScore = avgPrecision * 100;
    const gapPenalty = Math.min(20, unmatchedPhrases.length); // -1 per unmatched phrase, max -20
    
    const score = Math.max(0, Math.round((matchScore * 0.5 + precisionScore * 0.5) - gapPenalty));
    const { status } = AgentExcellenceScore.getStatusFromScore(score);
    
    return {
      score,
      weight: AgentExcellenceScore.SCORE_WEIGHTS.triageAccuracy,
      status,
      details: `${Math.round(matchRate * 100)}% match rate, ${unmatchedPhrases.length} unmatched phrases`,
      metrics: {
        matchRate: Math.round(matchRate * 100) / 100,
        falsePositiveRate: Math.round(falsePositiveRate * 100) / 100,
        emergencyEscalationRate: 1.0, // TODO: Track separately
        unmatchedPhraseCount: unmatchedPhrases.length
      }
    };
  }
  
  /**
   * Calculate Knowledge Completeness score (20% weight)
   */
  static async calculateKnowledgeScore(companyId, company) {
    // Get Brain-2 scenarios count
    const scenarioCount = company.aiCoreCategories?.reduce((sum, cat) => 
      sum + (cat.scenarios?.length || 0), 0) || 0;
    
    // Get triage cards count
    const cardCount = await TriageCard.countDocuments({ companyId, isActive: true });
    
    // Estimate coverage (scenarios should roughly match services offered)
    const estimatedServices = 10; // Typical HVAC/plumbing company
    const scenarioCoverage = Math.min(1, scenarioCount / estimatedServices);
    
    // Check for common knowledge gaps
    const hasHours = !!(company.businessHours || company.schedule);
    const hasServiceAreas = !!(company.serviceAreas?.length || company.serviceArea);
    const hasPricing = scenarioCount > 0; // Assume if scenarios exist, some have pricing
    
    const completenessFactors = [
      hasHours ? 1 : 0,
      hasServiceAreas ? 1 : 0,
      hasPricing ? 1 : 0,
      cardCount >= 10 ? 1 : cardCount / 10,
      scenarioCoverage
    ];
    
    const score = Math.round(
      (completenessFactors.reduce((sum, f) => sum + f, 0) / completenessFactors.length) * 100
    );
    const { status } = AgentExcellenceScore.getStatusFromScore(score);
    
    return {
      score,
      weight: AgentExcellenceScore.SCORE_WEIGHTS.knowledgeCompleteness,
      status,
      details: `${scenarioCount} scenarios, ${cardCount} cards active`,
      metrics: {
        questionAnswerRate: score / 100,
        unansweredQuestionCount: 0, // TODO: Track from calls
        scenarioCoverage: Math.round(scenarioCoverage * 100) / 100,
        pricingCoverage: hasPricing ? 0.8 : 0.2
      }
    };
  }
  
  /**
   * Calculate Customer Memory score (15% weight)
   */
  static async calculateCustomerMemoryScore(companyId) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - CONFIG.analysisPeriodDays);
    
    // Get calls with customer context
    const calls = await CallSummary.find({
      companyId,
      callStartTime: { $gte: startDate }
    }).select('customerContext aiContext').lean();
    
    const totalCalls = calls.length;
    const recognizedCalls = calls.filter(c => 
      c.customerContext?.isReturning || c.customerContext?.customerId
    );
    const personalizedCalls = calls.filter(c =>
      c.aiContext?.usedCustomerName || c.customerContext?.wasGreetedByName
    );
    
    const recognitionRate = totalCalls > 0 ? recognizedCalls.length / totalCalls : 0;
    const personalizationRate = recognizedCalls.length > 0 
      ? personalizedCalls.length / recognizedCalls.length 
      : 0;
    
    // Get customer stats
    const customerCount = await Customer.countDocuments({ companyId });
    const householdCount = await Customer.countDocuments({ 
      companyId, 
      'householdMembers.0': { $exists: true } 
    });
    
    // Score calculation
    const score = Math.round(
      recognitionRate * 50 + 
      personalizationRate * 30 + 
      (customerCount > 0 ? 20 : 0)
    );
    const { status } = AgentExcellenceScore.getStatusFromScore(score);
    
    return {
      score,
      weight: AgentExcellenceScore.SCORE_WEIGHTS.customerMemory,
      status,
      details: `${Math.round(recognitionRate * 100)}% recognized, ${customerCount} customers`,
      metrics: {
        recognitionRate: Math.round(recognitionRate * 100) / 100,
        personalizedGreetingRate: Math.round(personalizationRate * 100) / 100,
        householdLinkRate: customerCount > 0 ? householdCount / customerCount : 0,
        multiPropertyHandlingRate: 0.9 // TODO: Track from calls
      }
    };
  }
  
  /**
   * Calculate Call Outcomes score (15% weight)
   */
  static async calculateCallOutcomesScore(companyId, company) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - CONFIG.analysisPeriodDays);
    
    const calls = await CallSummary.find({
      companyId,
      callStartTime: { $gte: startDate }
    }).lean();
    
    const totalCalls = calls.length;
    
    // Calculate outcomes
    const outcomes = {
      booked: calls.filter(c => c.outcome === 'booked' || c.outcome === 'appointment_scheduled').length,
      transferred: calls.filter(c => c.outcome === 'transferred' || c.wasTransferred).length,
      hangup: calls.filter(c => c.outcome === 'hangup' || c.outcome === 'caller_hangup').length,
      completed: calls.filter(c => c.outcome === 'completed' || c.outcome === 'info_provided').length
    };
    
    const successRate = totalCalls > 0 
      ? (outcomes.booked + outcomes.completed) / totalCalls 
      : 0;
    const hangupRate = totalCalls > 0 ? outcomes.hangup / totalCalls : 0;
    const transferRate = totalCalls > 0 ? outcomes.transferred / totalCalls : 0;
    
    // Average handle time
    const callsWithDuration = calls.filter(c => c.duration);
    const avgHandleTime = callsWithDuration.length > 0
      ? callsWithDuration.reduce((sum, c) => sum + c.duration, 0) / callsWithDuration.length
      : 180;
    
    // Revenue per call
    const avgJobValue = company.avgJobValue || CONFIG.defaultAvgJobValue;
    const revenuePerCall = totalCalls > 0 
      ? (outcomes.booked * avgJobValue) / totalCalls 
      : 0;
    
    // Score calculation
    const successScore = successRate * 100;
    const hangupPenalty = Math.min(30, hangupRate * 300); // Heavy penalty for hangups
    const transferPenalty = Math.min(20, transferRate * 133); // Moderate penalty for transfers
    const timeBonus = avgHandleTime <= 180 ? 10 : 0;
    
    const score = Math.max(0, Math.round(successScore - hangupPenalty - transferPenalty + timeBonus));
    const { status } = AgentExcellenceScore.getStatusFromScore(score);
    
    return {
      score,
      weight: AgentExcellenceScore.SCORE_WEIGHTS.callOutcomes,
      status,
      details: `${Math.round(successRate * 100)}% success, ${Math.round(hangupRate * 100)}% hangup`,
      metrics: {
        successRate: Math.round(successRate * 100) / 100,
        hangupRate: Math.round(hangupRate * 100) / 100,
        transferRate: Math.round(transferRate * 100) / 100,
        avgHandleTime: Math.round(avgHandleTime),
        revenuePerCall: Math.round(revenuePerCall * 100) / 100
      }
    };
  }
  
  /**
   * Calculate Frontline Intelligence score (10% weight)
   */
  static async calculateFrontlineScore(companyId, company) {
    // Check Frontline script completeness
    const script = company.cheatSheets?.[0]?.frontlineIntel || '';
    
    // Check for key sections
    const hasMission = script.includes('MISSION') || script.includes('YOUR ROLE');
    const hasBehaviorRules = script.includes('BEHAVIOR') || script.includes('RULES');
    const hasCustomerRecognition = script.includes('CUSTOMER RECOGNITION') || script.includes('customerName');
    const hasBookingProtocol = script.includes('BOOKING') || script.includes('APPOINTMENT');
    const hasTransferRules = script.includes('TRANSFER') || script.includes('ESCALATE');
    const hasVendorProtocol = script.includes('VENDOR') || script.includes('SUPPLIER');
    const hasCommercialProtocol = script.includes('COMMERCIAL') || script.includes('BUSINESS');
    
    const sections = [
      hasMission,
      hasBehaviorRules,
      hasCustomerRecognition,
      hasBookingProtocol,
      hasTransferRules,
      hasVendorProtocol,
      hasCommercialProtocol
    ];
    
    const protocolCompleteness = sections.filter(Boolean).length / sections.length;
    
    // Check variable usage
    const variablePattern = /\{[a-zA-Z]+\}/g;
    const variablesUsed = (script.match(variablePattern) || []).length;
    const variableScore = Math.min(1, variablesUsed / 10);
    
    // Overall score
    const score = Math.round((protocolCompleteness * 70 + variableScore * 30));
    const { status } = AgentExcellenceScore.getStatusFromScore(score);
    
    return {
      score,
      weight: AgentExcellenceScore.SCORE_WEIGHTS.frontlineIntelligence,
      status,
      details: `${Math.round(protocolCompleteness * 100)}% complete, ${variablesUsed} variables`,
      metrics: {
        greetingQuality: hasMission ? 0.9 : 0.5,
        toneConsistency: 0.85, // TODO: LLM-assess
        protocolCompleteness: Math.round(protocolCompleteness * 100) / 100,
        variableUsage: Math.round(variableScore * 100) / 100
      }
    };
  }
  
  /**
   * Calculate revenue metrics
   */
  static calculateRevenueMetrics(rawMetrics, company) {
    const avgJobValue = company.avgJobValue || CONFIG.defaultAvgJobValue;
    const totalBookings = rawMetrics.totalBookings || 0;
    const totalCalls = rawMetrics.totalCalls || 1;
    
    const estimatedRevenue = totalBookings * avgJobValue;
    const revenuePerCall = estimatedRevenue / totalCalls;
    
    return {
      totalCalls,
      totalBookings,
      estimatedRevenue: Math.round(estimatedRevenue),
      revenuePerCall: Math.round(revenuePerCall * 100) / 100,
      revenuePerCallTrend: 'STABLE', // TODO: Compare to previous period
      revenuePerCallDelta: 0,
      avgJobValue
    };
  }
  
  /**
   * Get raw metrics for the analysis period
   */
  static async getRawMetrics(companyId) {
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - CONFIG.analysisPeriodDays);
    const periodEnd = new Date();
    
    const calls = await CallSummary.find({
      companyId,
      callStartTime: { $gte: periodStart }
    }).lean();
    
    const unmatchedPhrases = await TriageCardMetrics.getUnmatchedPhrases(companyId, CONFIG.analysisPeriodDays, 20);
    
    return {
      periodStart,
      periodEnd,
      totalCalls: calls.length,
      totalBookings: calls.filter(c => c.outcome === 'booked' || c.outcome === 'appointment_scheduled').length,
      totalTransfers: calls.filter(c => c.outcome === 'transferred' || c.wasTransferred).length,
      totalHangups: calls.filter(c => c.outcome === 'hangup' || c.outcome === 'caller_hangup').length,
      avgCallDuration: calls.length > 0
        ? calls.reduce((sum, c) => sum + (c.duration || 0), 0) / calls.length
        : 0,
      newCustomers: calls.filter(c => !c.customerContext?.isReturning).length,
      returningCustomers: calls.filter(c => c.customerContext?.isReturning).length,
      unmatchedPhrases: unmatchedPhrases.slice(0, 10).map(p => ({
        phrase: p.phrase,
        count: p.count
      })),
      unansweredQuestions: [] // TODO: Extract from transcripts
    };
  }
  
  /**
   * Generate LLM improvement suggestions (async, cached)
   * This should be run by a nightly job, not on-demand
   */
  static async generateImprovementSuggestions(companyId) {
    const startTime = Date.now();
    
    logger.info('[EXCELLENCE] Generating LLM suggestions', { companyId: String(companyId) });
    
    try {
      // Get current score and company data
      const [score, company] = await Promise.all([
        this.calculateScore(companyId),
        V2Company.findById(companyId).lean()
      ]);
      
      if (!score || !company) {
        throw new Error('Score or company not found');
      }
      
      // Build LLM prompt
      const prompt = this.buildImprovementPrompt(score, company);
      
      // Call OpenAI
      const completion = await openai.chat.completions.create({
        model: process.env.LLM_MODEL || 'gpt-4o',
        temperature: 0.3,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user }
        ]
      });
      
      const analysis = JSON.parse(completion.choices[0]?.message?.content || '{}');
      
      // Update score document with LLM analysis
      score.llmAnalysis = {
        generatedAt: new Date(),
        cacheExpiresAt: new Date(Date.now() + CONFIG.llmCacheHours * 60 * 60 * 1000),
        topImprovements: analysis.topImprovements || [],
        weeklySummary: analysis.weeklySummary || {},
        learnings: analysis.learnings || []
      };
      
      await score.save();
      
      logger.info('[EXCELLENCE] LLM suggestions generated', {
        companyId: String(companyId),
        suggestionsCount: analysis.topImprovements?.length || 0,
        duration: Date.now() - startTime
      });
      
      return score.llmAnalysis;
      
    } catch (error) {
      logger.error('[EXCELLENCE] LLM generation failed', {
        companyId: String(companyId),
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Build the LLM prompt for improvement suggestions
   */
  static buildImprovementPrompt(score, company) {
    const system = `You are an AI call center optimization expert analyzing performance data for "${company.companyName || company.businessName}", a ${company.trade || 'service'} company.

Your job is to identify the TOP 5 most impactful improvements, ranked by potential revenue impact.

RULES:
1. Be specific - give exact phrases, keywords, or script changes
2. Prioritize revenue-impacting improvements first
3. Never suggest changes that could compromise safety (emergencies must always escalate)
4. Base suggestions on the actual metrics provided, not assumptions
5. Include predicted impact for each suggestion

Return ONLY valid JSON in this exact format:
{
  "topImprovements": [
    {
      "rank": 1,
      "priority": "HIGH",
      "category": "triageAccuracy",
      "title": "Add pricing triage card",
      "description": "47 callers asked about pricing but no card matched. Create a PRICING card.",
      "predictedImpact": "+5% booking rate, +$1,200/month estimated",
      "actionType": "CREATE_CARD",
      "actionData": {
        "triageLabel": "PRICING_QUESTION",
        "mustHaveKeywords": ["how much", "cost", "price", "estimate", "quote"],
        "action": "DIRECT_TO_3TIER"
      }
    }
  ],
  "weeklySummary": {
    "headline": "Agent performing well, 3 quick wins available",
    "highlights": ["63% booking rate (above industry avg)", "12 new customers recognized on callback"],
    "concerns": ["18% hangup rate needs attention", "Pricing questions going unanswered"],
    "recommendations": ["Add pricing card", "Update script for returning customers"]
  },
  "learnings": [
    {
      "type": "SYNONYM",
      "description": "Callers say 'AC blowing warm' meaning same as 'AC not cooling'",
      "example": "12 calls used this phrase"
    }
  ]
}`;

    const user = `COMPANY: ${company.companyName || company.businessName}
TRADE: ${company.trade || 'General Service'}

═══════════════════════════════════════════════════════════════════════════
CURRENT SCORES (Last ${CONFIG.analysisPeriodDays} days)
═══════════════════════════════════════════════════════════════════════════

OVERALL SCORE: ${score.overallScore}/100 (${score.trend})

CATEGORY BREAKDOWN:
• Booking Flow: ${score.categories.bookingFlow.score}/100 - ${score.categories.bookingFlow.details}
• Triage Accuracy: ${score.categories.triageAccuracy.score}/100 - ${score.categories.triageAccuracy.details}
• Knowledge: ${score.categories.knowledgeCompleteness.score}/100 - ${score.categories.knowledgeCompleteness.details}
• Customer Memory: ${score.categories.customerMemory.score}/100 - ${score.categories.customerMemory.details}
• Call Outcomes: ${score.categories.callOutcomes.score}/100 - ${score.categories.callOutcomes.details}
• Frontline Intel: ${score.categories.frontlineIntelligence.score}/100 - ${score.categories.frontlineIntelligence.details}

═══════════════════════════════════════════════════════════════════════════
RAW METRICS
═══════════════════════════════════════════════════════════════════════════

• Total Calls: ${score.rawMetrics.totalCalls}
• Bookings: ${score.rawMetrics.totalBookings} (${Math.round(score.rawMetrics.totalBookings / Math.max(1, score.rawMetrics.totalCalls) * 100)}%)
• Transfers: ${score.rawMetrics.totalTransfers}
• Hangups: ${score.rawMetrics.totalHangups} (${Math.round(score.rawMetrics.totalHangups / Math.max(1, score.rawMetrics.totalCalls) * 100)}%)
• New Customers: ${score.rawMetrics.newCustomers}
• Returning Customers: ${score.rawMetrics.returningCustomers}

═══════════════════════════════════════════════════════════════════════════
REVENUE IMPACT
═══════════════════════════════════════════════════════════════════════════

• Revenue per Call: $${score.revenue.revenuePerCall}
• Estimated Revenue: $${score.revenue.estimatedRevenue}
• Avg Job Value: $${score.revenue.avgJobValue}

═══════════════════════════════════════════════════════════════════════════
UNMATCHED PHRASES (Gaps to fill)
═══════════════════════════════════════════════════════════════════════════

${score.rawMetrics.unmatchedPhrases?.map(p => `• "${p.phrase}" (${p.count} times)`).join('\n') || 'None detected'}

═══════════════════════════════════════════════════════════════════════════

Analyze this data and return the TOP 5 improvements ranked by revenue impact.`;

    return { system, user };
  }
  
  /**
   * Apply a suggestion (with version control)
   * NEVER auto-applies - requires human approval
   */
  static async applySuggestion(companyId, suggestionIndex, appliedBy) {
    const score = await AgentExcellenceScore.getLatestScore(companyId);
    if (!score?.llmAnalysis?.topImprovements?.[suggestionIndex]) {
      throw new Error('Suggestion not found');
    }
    
    const suggestion = score.llmAnalysis.topImprovements[suggestionIndex];
    
    // Mark as applied (actual implementation depends on actionType)
    suggestion.status = 'APPLIED';
    await score.save();
    
    logger.info('[EXCELLENCE] Suggestion applied', {
      companyId: String(companyId),
      suggestionTitle: suggestion.title,
      appliedBy
    });
    
    return suggestion;
  }
}

module.exports = AgentExcellenceService;

