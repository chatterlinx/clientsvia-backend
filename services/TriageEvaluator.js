/**
 * TriageEvaluator Service
 * 
 * PURPOSE: LLM-powered evaluation of triage card configurations
 * - Uses REAL call data (last 30 days transcripts)
 * - Per-card keyword analysis with synonym suggestions
 * - Trade-specific top 50 questions generation
 * - Conflict detection between cards
 * - Prioritized recommendations
 * 
 * PHILOSOPHY: Real data > LLM imagination
 * 
 * @module services/TriageEvaluator
 */

const logger = require('../utils/logger');
const OpenAI = require('openai');
const TriageCard = require('../models/TriageCard');
const TriageCardMetrics = require('../models/TriageCardMetrics');
const CallSummary = require('../models/CallSummary');
const V2Company = require('../models/v2Company');

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ═══════════════════════════════════════════════════════════════════════════
// TRADE-SPECIFIC EMERGENCY OVERRIDES (Never LLM-suggested)
// ═══════════════════════════════════════════════════════════════════════════
const TRADE_EMERGENCIES = {
  'HVAC': {
    immediate: ['smell gas', 'gas odor', 'gas leak', 'carbon monoxide', 'co detector', 'sparks from unit', 'burning smell from ac', 'electrical fire', 'smoke from unit'],
    urgent: ['no heat in winter', 'no cool in heat wave', 'refrigerant leak', 'ice on unit'],
    action: 'ESCALATE_TO_HUMAN'
  },
  'Plumbing': {
    immediate: ['raw sewage', 'sewage backup', 'burst pipe', 'flooding', 'gas leak water heater', 'water gushing', 'main line break'],
    urgent: ['no water', 'sewer smell', 'overflowing toilet', 'water heater leaking'],
    action: 'ESCALATE_TO_HUMAN'
  },
  'Electrical': {
    immediate: ['sparks', 'burning smell', 'exposed wires', 'smoke from outlet', 'electrical fire', 'shock hazard', 'arcing'],
    urgent: ['no power entire house', 'breaker keeps tripping', 'flickering lights', 'hot outlet'],
    action: 'ESCALATE_TO_HUMAN'
  },
  'Locksmith': {
    immediate: ['locked out with child inside', 'locked out with pet inside', 'break-in', 'car running locked', 'emergency lockout'],
    urgent: ['locked out', 'broken lock', 'key stuck'],
    action: 'ESCALATE_TO_HUMAN'
  },
  'Garage Door': {
    immediate: ['door fell', 'spring broke with door up', 'cable snapped', 'door won\'t close security'],
    urgent: ['door stuck open', 'remote not working', 'sensor issues'],
    action: 'ESCALATE_TO_HUMAN'
  },
  'Appliance Repair': {
    immediate: ['burning smell from appliance', 'gas smell from stove', 'sparks from appliance', 'smoke from appliance'],
    urgent: ['refrigerator not cooling food spoiling', 'oven not working holiday'],
    action: 'ESCALATE_TO_HUMAN'
  },
  'Pest Control': {
    immediate: ['bee swarm', 'wasp nest near entrance', 'snake inside', 'wildlife trapped inside'],
    urgent: ['bed bugs', 'rodent infestation', 'termite swarm'],
    action: 'ESCALATE_TO_HUMAN'
  },
  'Roofing': {
    immediate: ['active leak raining now', 'tree fell on roof', 'hole in roof'],
    urgent: ['missing shingles storm coming', 'ceiling water damage'],
    action: 'ESCALATE_TO_HUMAN'
  },
  // Generic fallback
  'DEFAULT': {
    immediate: ['emergency', 'urgent', 'life threatening', 'fire', 'explosion', 'injury'],
    urgent: ['asap', 'right away', 'can\'t wait'],
    action: 'ESCALATE_TO_HUMAN'
  }
};

class TriageEvaluator {
  
  /**
   * Run full evaluation for a company
   */
  static async runFullEvaluation({ companyId, businessDescription, adminUserId }) {
    const startTime = Date.now();
    
    logger.info('[TRIAGE EVALUATOR] Starting full evaluation', { 
      companyId: String(companyId) 
    });
    
    try {
      // ═══════════════════════════════════════════════════════════════════
      // STEP 1: Gather all data
      // ═══════════════════════════════════════════════════════════════════
      const [company, cards, realCallData, cardMetrics] = await Promise.all([
        V2Company.findById(companyId).lean(),
        TriageCard.find({ companyId }).lean(),
        this.extractRealCallData(companyId),
        TriageCardMetrics.getCardHealthSummary(companyId, 30)
      ]);
      
      if (!company) {
        throw new Error('Company not found');
      }
      
      const trade = company.trade || 'General Service';
      const tradeEmergencies = TRADE_EMERGENCIES[trade] || TRADE_EMERGENCIES['DEFAULT'];
      
      // ═══════════════════════════════════════════════════════════════════
      // STEP 2: Detect conflicts between cards
      // ═══════════════════════════════════════════════════════════════════
      const conflicts = this.detectCardConflicts(cards);
      
      // ═══════════════════════════════════════════════════════════════════
      // STEP 3: Check emergency coverage
      // ═══════════════════════════════════════════════════════════════════
      const emergencyCoverage = this.checkEmergencyCoverage(cards, tradeEmergencies);
      
      // ═══════════════════════════════════════════════════════════════════
      // STEP 4: Run LLM analysis with real data
      // ═══════════════════════════════════════════════════════════════════
      const llmAnalysis = await this.runLLMAnalysis({
        company,
        trade,
        cards,
        realCallData,
        cardMetrics,
        businessDescription,
        tradeEmergencies
      });
      
      // ═══════════════════════════════════════════════════════════════════
      // STEP 5: Calculate overall grade
      // ═══════════════════════════════════════════════════════════════════
      const grade = this.calculateOverallGrade({
        cards,
        cardMetrics,
        conflicts,
        emergencyCoverage,
        llmAnalysis
      });
      
      // ═══════════════════════════════════════════════════════════════════
      // STEP 6: Compile results
      // ═══════════════════════════════════════════════════════════════════
      const result = {
        evaluationId: `eval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        companyId: String(companyId),
        trade,
        evaluatedAt: new Date(),
        evaluatedBy: adminUserId,
        duration: Date.now() - startTime,
        
        // Overall summary
        grade: grade.letter,
        gradeScore: grade.score,
        readinessScore: grade.readiness,
        
        // Card counts
        summary: {
          totalCards: cards.length,
          activeCards: cards.filter(c => c.isActive).length,
          disabledCards: cards.filter(c => !c.isActive).length,
          totalKeywords: cards.reduce((sum, c) => sum + (c.mustHaveKeywords?.length || 0), 0),
          avgKeywordsPerCard: cards.length > 0 
            ? Math.round(cards.reduce((sum, c) => sum + (c.mustHaveKeywords?.length || 0), 0) / cards.length * 10) / 10
            : 0
        },
        
        // Real data insights
        realCallInsights: {
          callsAnalyzed: realCallData.totalCalls,
          unmatchedPhrases: realCallData.unmatchedPhrases.slice(0, 20),
          mostFrequentTopics: realCallData.topTopics,
          gapsFromRealCalls: realCallData.gaps
        },
        
        // Per-card analysis
        cardAnalysis: llmAnalysis.cardAnalysis,
        
        // Top 50 questions with coverage
        top50Questions: llmAnalysis.top50Questions,
        
        // Conflicts
        conflicts: conflicts,
        
        // Emergency coverage
        emergencyCoverage: emergencyCoverage,
        
        // Prioritized recommendations
        recommendations: this.prioritizeRecommendations({
          conflicts,
          emergencyCoverage,
          llmAnalysis,
          cards,
          cardMetrics
        }),
        
        // Suggested new cards
        suggestedCards: llmAnalysis.suggestedCards
      };
      
      logger.info('[TRIAGE EVALUATOR] Evaluation complete', {
        companyId: String(companyId),
        grade: grade.letter,
        duration: result.duration,
        cardsAnalyzed: cards.length
      });
      
      return result;
      
    } catch (error) {
      logger.error('[TRIAGE EVALUATOR] Evaluation failed', {
        companyId: String(companyId),
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
  
  /**
   * Extract real call data for analysis
   */
  static async extractRealCallData(companyId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Get call summaries with AI context
    const calls = await CallSummary.find({
      companyId,
      callStartTime: { $gte: startDate }
    })
    .select('aiContext triageResult outcome')
    .limit(1000)
    .lean();
    
    // Extract caller phrases (first 3 turns typically)
    const allPhrases = [];
    const matchedPhrases = [];
    const unmatchedPhrases = [];
    const wrongRoutePhrases = [];
    
    for (const call of calls) {
      const phrase = call.aiContext?.firstCallerPhrase || call.aiContext?.callerIntent;
      if (!phrase) continue;
      
      const normalized = phrase.toLowerCase().trim();
      allPhrases.push(normalized);
      
      if (call.triageResult?.matched) {
        matchedPhrases.push({
          phrase: normalized,
          matchedCard: call.triageResult?.triageLabel,
          outcome: call.outcome
        });
      } else {
        unmatchedPhrases.push(normalized);
      }
      
      // Check for wrong routing (admin flagged)
      if (call.triageResult?.wasWrongRoute) {
        wrongRoutePhrases.push({
          phrase: normalized,
          matchedCard: call.triageResult?.triageLabel,
          shouldHaveMatched: call.triageResult?.correctCard
        });
      }
    }
    
    // Group unmatched by frequency
    const unmatchedFrequency = {};
    for (const phrase of unmatchedPhrases) {
      // Simple grouping by first 30 chars
      const key = phrase.substring(0, 30);
      unmatchedFrequency[key] = (unmatchedFrequency[key] || 0) + 1;
    }
    
    const topUnmatched = Object.entries(unmatchedFrequency)
      .map(([phrase, count]) => ({ phrase, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
    
    // Identify top topics from matched calls
    const topicCounts = {};
    for (const mp of matchedPhrases) {
      const card = mp.matchedCard || 'unknown';
      topicCounts[card] = (topicCounts[card] || 0) + 1;
    }
    
    const topTopics = Object.entries(topicCounts)
      .map(([topic, count]) => ({ topic, count, percentage: Math.round(count / calls.length * 100) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    // Identify gaps (high-frequency unmatched phrases)
    const gaps = topUnmatched
      .filter(u => u.count >= 3) // At least 3 occurrences
      .map(u => ({
        phrase: u.phrase,
        frequency: u.count,
        impact: u.count >= 10 ? 'HIGH' : u.count >= 5 ? 'MEDIUM' : 'LOW'
      }));
    
    return {
      totalCalls: calls.length,
      matchedCount: matchedPhrases.length,
      unmatchedCount: unmatchedPhrases.length,
      matchRate: calls.length > 0 ? Math.round(matchedPhrases.length / calls.length * 100) : 0,
      allPhrases: allPhrases.slice(0, 500), // Limit for LLM prompt
      unmatchedPhrases: topUnmatched,
      matchedPhrases: matchedPhrases.slice(0, 100),
      wrongRoutePhrases,
      topTopics,
      gaps
    };
  }
  
  /**
   * Detect conflicts between cards (overlapping keywords)
   */
  static detectCardConflicts(cards) {
    const conflicts = [];
    
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const cardA = cards[i];
        const cardB = cards[j];
        
        const keywordsA = new Set(cardA.mustHaveKeywords?.map(k => k.toLowerCase()) || []);
        const keywordsB = new Set(cardB.mustHaveKeywords?.map(k => k.toLowerCase()) || []);
        
        // Find overlapping keywords
        const overlap = [...keywordsA].filter(k => keywordsB.has(k));
        
        if (overlap.length > 0) {
          // Calculate overlap severity
          const overlapPercentA = overlap.length / keywordsA.size;
          const overlapPercentB = overlap.length / keywordsB.size;
          const severity = overlapPercentA > 0.5 || overlapPercentB > 0.5 ? 'HIGH' : 
                          overlap.length >= 2 ? 'MEDIUM' : 'LOW';
          
          conflicts.push({
            cardA: {
              id: cardA._id,
              label: cardA.triageLabel,
              displayName: cardA.displayName,
              priority: cardA.priority
            },
            cardB: {
              id: cardB._id,
              label: cardB.triageLabel,
              displayName: cardB.displayName,
              priority: cardB.priority
            },
            overlappingKeywords: overlap,
            severity,
            winner: cardA.priority < cardB.priority ? cardA.triageLabel : cardB.triageLabel,
            recommendation: severity === 'HIGH' 
              ? 'Consider merging these cards or adding exclude keywords'
              : 'Review priority order to ensure correct routing'
          });
        }
      }
    }
    
    return conflicts.sort((a, b) => {
      const severityOrder = { 'HIGH': 0, 'MEDIUM': 1, 'LOW': 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }
  
  /**
   * Check if emergency scenarios are properly covered
   */
  static checkEmergencyCoverage(cards, tradeEmergencies) {
    const coverage = {
      covered: [],
      missing: [],
      wrongAction: []
    };
    
    const allEmergencies = [
      ...tradeEmergencies.immediate.map(e => ({ phrase: e, level: 'IMMEDIATE' })),
      ...tradeEmergencies.urgent.map(e => ({ phrase: e, level: 'URGENT' }))
    ];
    
    for (const emergency of allEmergencies) {
      let foundCard = null;
      
      for (const card of cards) {
        const keywords = card.mustHaveKeywords?.map(k => k.toLowerCase()) || [];
        if (keywords.some(k => emergency.phrase.includes(k) || k.includes(emergency.phrase))) {
          foundCard = card;
          break;
        }
      }
      
      if (!foundCard) {
        coverage.missing.push({
          phrase: emergency.phrase,
          level: emergency.level,
          recommendation: `Create card for "${emergency.phrase}" with action ESCALATE_TO_HUMAN`
        });
      } else if (foundCard.action !== 'ESCALATE_TO_HUMAN' && foundCard.action !== 'TRANSFER_TO_HUMAN') {
        coverage.wrongAction.push({
          phrase: emergency.phrase,
          level: emergency.level,
          cardLabel: foundCard.triageLabel,
          currentAction: foundCard.action,
          recommendation: `Change action to ESCALATE_TO_HUMAN for safety`
        });
      } else {
        coverage.covered.push({
          phrase: emergency.phrase,
          level: emergency.level,
          cardLabel: foundCard.triageLabel,
          action: foundCard.action
        });
      }
    }
    
    return {
      ...coverage,
      coveragePercentage: Math.round(
        coverage.covered.length / allEmergencies.length * 100
      ),
      grade: coverage.missing.length === 0 && coverage.wrongAction.length === 0 ? 'A' :
             coverage.missing.filter(m => m.level === 'IMMEDIATE').length === 0 ? 'B' :
             'F'
    };
  }
  
  /**
   * Run LLM analysis with real call data
   */
  static async runLLMAnalysis({ company, trade, cards, realCallData, cardMetrics, businessDescription, tradeEmergencies }) {
    const systemPrompt = `You are an expert call center optimization consultant analyzing triage routing rules for a ${trade} company.

Your job is to:
1. Analyze each existing card's keyword coverage and suggest improvements
2. Generate the top 50 most common questions callers ask ${trade} companies
3. Check which questions are covered vs. missing
4. Suggest new cards for gaps
5. Rate keyword quality with confidence scores

CRITICAL RULES:
- Base suggestions on REAL call data provided, not assumptions
- ${trade} emergencies (${tradeEmergencies.immediate.join(', ')}) MUST route to ESCALATE_TO_HUMAN
- Be specific with synonym suggestions - generic words cause false positives
- Consider exclude keywords to prevent false matches

Return ONLY valid JSON in this exact format:
{
  "cardAnalysis": [
    {
      "cardId": "...",
      "triageLabel": "...",
      "currentGrade": "A/B/C/D/F",
      "keywordQuality": "Good/Needs Improvement/Poor",
      "suggestedKeywordsToAdd": ["phrase1", "phrase2"],
      "suggestedKeywordsToRemove": [],
      "suggestedExcludeKeywords": ["phrase that shouldn't match"],
      "actionReview": "CORRECT" or "Change to X because Y",
      "confidence": 0.0-1.0,
      "reasoning": "brief explanation"
    }
  ],
  "top50Questions": [
    {
      "rank": 1,
      "question": "My AC is not cooling",
      "frequency": "Very Common",
      "matchStatus": "COVERED" or "NOT_COVERED" or "PARTIAL",
      "matchedCard": "card label if covered",
      "suggestedCard": "if not covered, suggest card name"
    }
  ],
  "suggestedCards": [
    {
      "triageLabel": "PRICING_QUESTION",
      "displayName": "Pricing & Estimates",
      "intent": "pricing",
      "mustHaveKeywords": ["how much", "cost", "price", "estimate"],
      "excludeKeywords": ["free estimate"],
      "action": "DIRECT_TO_3TIER",
      "priority": 50,
      "reasoning": "X% of unmatched calls asked about pricing",
      "confidence": 0.9
    }
  ],
  "overallInsights": {
    "strengths": ["list of what's good"],
    "criticalGaps": ["list of critical missing pieces"],
    "quickWins": ["easy improvements with high impact"]
  }
}`;

    const userPrompt = `COMPANY: ${company.companyName || company.businessName}
TRADE: ${trade}
BUSINESS DESCRIPTION: ${businessDescription || 'No description provided'}

═══════════════════════════════════════════════════════════════════════════
CURRENT TRIAGE CARDS (${cards.length} total, ${cards.filter(c => c.isActive).length} active):
═══════════════════════════════════════════════════════════════════════════
${cards.map(c => `
• ${c.triageLabel} (${c.isActive ? 'ACTIVE' : 'DISABLED'})
  Keywords: ${c.mustHaveKeywords?.join(', ') || 'none'}
  Exclude: ${c.excludeKeywords?.join(', ') || 'none'}
  Action: ${c.action}
  Priority: ${c.priority}
`).join('')}

═══════════════════════════════════════════════════════════════════════════
REAL CALL DATA (Last 30 days - ${realCallData.totalCalls} calls analyzed):
═══════════════════════════════════════════════════════════════════════════

Match Rate: ${realCallData.matchRate}%
Matched: ${realCallData.matchedCount} | Unmatched: ${realCallData.unmatchedCount}

TOP UNMATCHED PHRASES (These are REAL gaps - callers said these but no card matched):
${realCallData.unmatchedPhrases.slice(0, 20).map(u => `• "${u.phrase}" (${u.count} times)`).join('\n')}

MOST COMMON TOPICS (What cards fire most):
${realCallData.topTopics.map(t => `• ${t.topic}: ${t.count} calls (${t.percentage}%)`).join('\n')}

SAMPLE MATCHED PHRASES:
${realCallData.matchedPhrases.slice(0, 20).map(m => `• "${m.phrase}" → ${m.matchedCard}`).join('\n')}

═══════════════════════════════════════════════════════════════════════════
CARD PERFORMANCE METRICS (Last 7 days):
═══════════════════════════════════════════════════════════════════════════
${cardMetrics.slice(0, 15).map(m => `
• ${m.triageLabel}: ${m.totalFires} fires, ${m.avgConversion * 100}% conversion, Grade: ${m.healthGrade}
  False Positives: ${m.totalFalsePositives} | Wrong Routes: ${m.totalWrongRoute}
`).join('')}

═══════════════════════════════════════════════════════════════════════════
TRADE-SPECIFIC EMERGENCIES (Must be ESCALATE_TO_HUMAN):
═══════════════════════════════════════════════════════════════════════════
IMMEDIATE: ${tradeEmergencies.immediate.join(', ')}
URGENT: ${tradeEmergencies.urgent.join(', ')}

Now analyze and return JSON with cardAnalysis, top50Questions, suggestedCards, and overallInsights.`;

    try {
      const completion = await openai.chat.completions.create({
        model: process.env.LLM_MODEL || 'gpt-4o',
        temperature: 0.3,
        max_tokens: 8000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      });
      
      const content = completion.choices[0]?.message?.content;
      const parsed = JSON.parse(content);
      
      logger.info('[TRIAGE EVALUATOR] LLM analysis complete', {
        cardAnalysisCount: parsed.cardAnalysis?.length,
        top50Count: parsed.top50Questions?.length,
        suggestedCardsCount: parsed.suggestedCards?.length
      });
      
      return parsed;
      
    } catch (error) {
      logger.error('[TRIAGE EVALUATOR] LLM analysis failed', {
        error: error.message
      });
      
      // Return empty structure on failure
      return {
        cardAnalysis: [],
        top50Questions: [],
        suggestedCards: [],
        overallInsights: {
          strengths: [],
          criticalGaps: ['LLM analysis failed - manual review required'],
          quickWins: []
        }
      };
    }
  }
  
  /**
   * Calculate overall grade
   */
  static calculateOverallGrade({ cards, cardMetrics, conflicts, emergencyCoverage, llmAnalysis }) {
    let score = 100;
    
    // Deductions
    
    // Cards disabled (-2 per disabled card)
    const disabledCards = cards.filter(c => !c.isActive).length;
    score -= disabledCards * 2;
    
    // Missing emergency coverage (-20 for immediate, -10 for urgent)
    score -= emergencyCoverage.missing.filter(m => m.level === 'IMMEDIATE').length * 20;
    score -= emergencyCoverage.missing.filter(m => m.level === 'URGENT').length * 10;
    
    // Wrong emergency actions (-15 per wrong action)
    score -= emergencyCoverage.wrongAction.length * 15;
    
    // High severity conflicts (-10 per conflict)
    score -= conflicts.filter(c => c.severity === 'HIGH').length * 10;
    score -= conflicts.filter(c => c.severity === 'MEDIUM').length * 5;
    
    // Low keyword variety (-5 for cards with < 3 keywords)
    const lowKeywordCards = cards.filter(c => (c.mustHaveKeywords?.length || 0) < 3);
    score -= lowKeywordCards.length * 5;
    
    // Top 50 coverage bonus/penalty
    const covered = llmAnalysis.top50Questions?.filter(q => q.matchStatus === 'COVERED').length || 0;
    const total = llmAnalysis.top50Questions?.length || 50;
    const coveragePercent = covered / total;
    if (coveragePercent < 0.5) score -= 20;
    else if (coveragePercent < 0.7) score -= 10;
    else if (coveragePercent > 0.85) score += 10;
    
    // Clamp score
    score = Math.max(0, Math.min(100, score));
    
    // Letter grade
    const letter = score >= 90 ? 'A' :
                   score >= 80 ? 'B' :
                   score >= 70 ? 'C' :
                   score >= 60 ? 'D' : 'F';
    
    // Add +/- modifiers
    const letterWithModifier = score >= 97 ? 'A+' :
                               score >= 93 ? 'A' :
                               score >= 90 ? 'A-' :
                               score >= 87 ? 'B+' :
                               score >= 83 ? 'B' :
                               score >= 80 ? 'B-' :
                               score >= 77 ? 'C+' :
                               score >= 73 ? 'C' :
                               score >= 70 ? 'C-' :
                               score >= 67 ? 'D+' :
                               score >= 63 ? 'D' :
                               score >= 60 ? 'D-' : 'F';
    
    // Readiness score (how ready for production)
    const readiness = Math.round(
      (emergencyCoverage.coveragePercentage * 0.3) +
      (coveragePercent * 100 * 0.4) +
      ((cards.filter(c => c.isActive).length / Math.max(cards.length, 1)) * 100 * 0.3)
    );
    
    return {
      score,
      letter: letterWithModifier,
      readiness
    };
  }
  
  /**
   * Prioritize recommendations
   */
  static prioritizeRecommendations({ conflicts, emergencyCoverage, llmAnalysis, cards, cardMetrics }) {
    const recommendations = {
      high: [],
      medium: [],
      low: []
    };
    
    // HIGH PRIORITY
    
    // Missing immediate emergencies
    for (const missing of emergencyCoverage.missing.filter(m => m.level === 'IMMEDIATE')) {
      recommendations.high.push({
        type: 'MISSING_EMERGENCY',
        title: `Add "${missing.phrase}" emergency card`,
        description: `Life-safety scenario not covered. Create card with ESCALATE_TO_HUMAN action.`,
        action: 'CREATE_CARD',
        data: {
          triageLabel: missing.phrase.toUpperCase().replace(/\s+/g, '_'),
          displayName: missing.phrase,
          mustHaveKeywords: [missing.phrase],
          action: 'ESCALATE_TO_HUMAN',
          priority: 1
        }
      });
    }
    
    // Wrong emergency actions
    for (const wrong of emergencyCoverage.wrongAction) {
      recommendations.high.push({
        type: 'WRONG_EMERGENCY_ACTION',
        title: `Fix "${wrong.cardLabel}" action`,
        description: `Emergency scenario has ${wrong.currentAction} instead of ESCALATE_TO_HUMAN`,
        action: 'UPDATE_CARD',
        data: {
          triageLabel: wrong.cardLabel,
          action: 'ESCALATE_TO_HUMAN'
        }
      });
    }
    
    // Disabled cards that are important
    const disabledActive = cards.filter(c => !c.isActive);
    if (disabledActive.length > 0) {
      recommendations.high.push({
        type: 'DISABLED_CARDS',
        title: `Enable ${disabledActive.length} disabled cards`,
        description: `Cards are configured but not active: ${disabledActive.map(c => c.triageLabel).join(', ')}`,
        action: 'ENABLE_ALL',
        data: {
          cardIds: disabledActive.map(c => c._id)
        }
      });
    }
    
    // High severity conflicts
    for (const conflict of conflicts.filter(c => c.severity === 'HIGH')) {
      recommendations.high.push({
        type: 'KEYWORD_CONFLICT',
        title: `Resolve conflict: ${conflict.cardA.label} vs ${conflict.cardB.label}`,
        description: `Overlapping keywords: ${conflict.overlappingKeywords.join(', ')}. ${conflict.recommendation}`,
        action: 'RESOLVE_CONFLICT',
        data: conflict
      });
    }
    
    // MEDIUM PRIORITY
    
    // Suggested new cards from LLM
    for (const suggested of (llmAnalysis.suggestedCards || []).filter(s => s.confidence >= 0.7)) {
      recommendations.medium.push({
        type: 'SUGGESTED_CARD',
        title: `Create "${suggested.displayName}" card`,
        description: suggested.reasoning,
        action: 'CREATE_CARD',
        data: suggested
      });
    }
    
    // Cards needing keyword improvements
    for (const analysis of (llmAnalysis.cardAnalysis || []).filter(a => a.currentGrade === 'C' || a.currentGrade === 'D')) {
      recommendations.medium.push({
        type: 'IMPROVE_KEYWORDS',
        title: `Improve "${analysis.triageLabel}" keywords`,
        description: `Add: ${analysis.suggestedKeywordsToAdd?.join(', ') || 'none'}`,
        action: 'UPDATE_KEYWORDS',
        data: {
          cardId: analysis.cardId,
          addKeywords: analysis.suggestedKeywordsToAdd,
          removeKeywords: analysis.suggestedKeywordsToRemove
        }
      });
    }
    
    // Missing urgent emergencies
    for (const missing of emergencyCoverage.missing.filter(m => m.level === 'URGENT')) {
      recommendations.medium.push({
        type: 'MISSING_URGENT',
        title: `Add "${missing.phrase}" urgent card`,
        description: missing.recommendation,
        action: 'CREATE_CARD',
        data: {
          triageLabel: missing.phrase.toUpperCase().replace(/\s+/g, '_'),
          displayName: missing.phrase,
          mustHaveKeywords: [missing.phrase],
          action: 'ESCALATE_TO_HUMAN',
          priority: 10
        }
      });
    }
    
    // LOW PRIORITY (Nice to have)
    
    // Medium severity conflicts
    for (const conflict of conflicts.filter(c => c.severity === 'MEDIUM')) {
      recommendations.low.push({
        type: 'MINOR_CONFLICT',
        title: `Minor overlap: ${conflict.cardA.label} / ${conflict.cardB.label}`,
        description: conflict.recommendation,
        action: 'REVIEW',
        data: conflict
      });
    }
    
    // Low confidence suggestions
    for (const suggested of (llmAnalysis.suggestedCards || []).filter(s => s.confidence < 0.7)) {
      recommendations.low.push({
        type: 'OPTIONAL_CARD',
        title: `Consider "${suggested.displayName}" card`,
        description: suggested.reasoning,
        action: 'CREATE_CARD',
        data: suggested
      });
    }
    
    return recommendations;
  }
  
  /**
   * Apply a single recommendation
   */
  static async applyRecommendation({ companyId, recommendation, appliedBy }) {
    const TriageCard = require('../models/TriageCard');
    const TriageVersion = require('../models/TriageVersion');
    
    logger.info('[TRIAGE EVALUATOR] Applying recommendation', {
      companyId: String(companyId),
      type: recommendation.type,
      action: recommendation.action
    });
    
    let changes = [];
    
    switch (recommendation.action) {
      case 'CREATE_CARD': {
        const newCard = new TriageCard({
          companyId,
          ...recommendation.data,
          isActive: true
        });
        await newCard.save();
        changes.push({
          changeType: 'CREATED',
          cardName: newCard.triageLabel,
          after: newCard.toObject()
        });
        break;
      }
      
      case 'UPDATE_CARD': {
        const card = await TriageCard.findOne({ 
          companyId, 
          triageLabel: recommendation.data.triageLabel 
        });
        if (card) {
          const before = card.toObject();
          Object.assign(card, recommendation.data);
          await card.save();
          changes.push({
            changeType: 'MODIFIED',
            cardName: card.triageLabel,
            before,
            after: card.toObject()
          });
        }
        break;
      }
      
      case 'UPDATE_KEYWORDS': {
        const card = await TriageCard.findById(recommendation.data.cardId);
        if (card) {
          const before = { keywords: [...(card.mustHaveKeywords || [])] };
          
          // Add new keywords
          if (recommendation.data.addKeywords) {
            card.mustHaveKeywords = [
              ...(card.mustHaveKeywords || []),
              ...recommendation.data.addKeywords
            ];
          }
          
          // Remove keywords
          if (recommendation.data.removeKeywords) {
            card.mustHaveKeywords = card.mustHaveKeywords.filter(
              k => !recommendation.data.removeKeywords.includes(k)
            );
          }
          
          await card.save();
          changes.push({
            changeType: 'KEYWORDS_ADDED',
            cardName: card.triageLabel,
            before,
            after: { keywords: card.mustHaveKeywords }
          });
        }
        break;
      }
      
      case 'ENABLE_ALL': {
        for (const cardId of recommendation.data.cardIds) {
          const card = await TriageCard.findById(cardId);
          if (card && !card.isActive) {
            card.isActive = true;
            await card.save();
            changes.push({
              changeType: 'ENABLED',
              cardName: card.triageLabel
            });
          }
        }
        break;
      }
    }
    
    // Create version snapshot
    if (changes.length > 0) {
      await TriageVersion.createVersion({
        companyId,
        versionName: `applied-${recommendation.type.toLowerCase()}`,
        changeType: 'EVALUATION_FIX',
        changeSummary: recommendation.title,
        changesDetail: changes,
        appliedBy,
        llmSuggestion: {
          wasLlmGenerated: true,
          suggestionsApplied: [{
            type: recommendation.action,
            cardName: recommendation.title,
            suggestion: JSON.stringify(recommendation.data)
          }]
        },
        TriageCard
      });
    }
    
    return { success: true, changes };
  }
}

module.exports = TriageEvaluator;

