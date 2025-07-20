# Agent Intent Classification and Response Flow Design

## Current State Analysis

### Intent Classification Status
- **Basic Implementation:** Keyword-based matching with fuzzy search
- **Advanced Features Available:** Enhanced intent classification system exists but not fully integrated
- **Missing Components:** Robust intent categorization, confidence-based routing, learning mechanisms

### Response Flow Complexity
The agent currently uses a **10-tier waterfall approach** which is comprehensive but could benefit from intelligent intent classification to improve efficiency and accuracy.

## Proposed Intent Classification System

### 1. Intent Categories (Industry-Agnostic)

```javascript
const CORE_INTENT_CATEGORIES = {
  // Service-related intents
  EMERGENCY: {
    keywords: ['emergency', 'urgent', 'broken', 'not working', 'no heat', 'no cooling'],
    priority: 'critical',
    escalation_threshold: 0.3,
    response_time_target: '< 30 seconds'
  },
  
  SCHEDULING: {
    keywords: ['schedule', 'appointment', 'book', 'when can you come', 'availability'],
    priority: 'high',
    escalation_threshold: 0.6,
    response_time_target: '< 45 seconds'
  },
  
  PRICING: {
    keywords: ['cost', 'price', 'how much', 'estimate', 'quote', 'fee'],
    priority: 'medium',
    escalation_threshold: 0.7,
    response_time_target: '< 60 seconds'
  },
  
  TECHNICAL_SUPPORT: {
    keywords: ['how to', 'troubleshoot', 'fix', 'repair', 'maintenance'],
    priority: 'medium',
    escalation_threshold: 0.8,
    response_time_target: '< 90 seconds'
  },
  
  INFORMATION_REQUEST: {
    keywords: ['hours', 'location', 'services', 'about', 'tell me'],
    priority: 'low',
    escalation_threshold: 0.9,
    response_time_target: '< 60 seconds'
  },
  
  COMPLAINT: {
    keywords: ['problem', 'issue', 'dissatisfied', 'complaint', 'unhappy'],
    priority: 'high',
    escalation_threshold: 0.4,
    response_time_target: '< 30 seconds'
  },
  
  GREETING: {
    keywords: ['hello', 'hi', 'good morning', 'good afternoon'],
    priority: 'low',
    escalation_threshold: 0.9,
    response_time_target: '< 15 seconds'
  },
  
  NONE: {
    keywords: ['unrelated', 'weather', 'politics', 'general'],
    priority: 'low',
    escalation_threshold: 0.3,
    response_time_target: '< 30 seconds'
  }
};
```

### 2. Company-Specific Intent Extensions

```javascript
// Example for HVAC companies
const HVAC_SPECIFIC_INTENTS = {
  AC_NOT_COOLING: {
    parent: 'EMERGENCY',
    keywords: ['ac not cooling', 'warm air', 'not cold', 'thermostat'],
    entities: ['thermostat_brand', 'temperature_reading', 'system_age']
  },
  
  HEATING_ISSUE: {
    parent: 'EMERGENCY', 
    keywords: ['no heat', 'furnace', 'cold house', 'heater broken'],
    entities: ['heating_type', 'last_service', 'temperature']
  },
  
  MAINTENANCE_TUNE_UP: {
    parent: 'SCHEDULING',
    keywords: ['tune up', 'maintenance', 'service', 'yearly service'],
    entities: ['last_service_date', 'system_type', 'warranty_status']
  },
  
  FILTER_CHANGE: {
    parent: 'TECHNICAL_SUPPORT',
    keywords: ['filter', 'change filter', 'dirty filter', 'air quality'],
    entities: ['filter_size', 'filter_type', 'replacement_frequency']
  }
};
```

## Enhanced Intent Classification Function

```javascript
class EnhancedIntentClassifier {
  constructor(companyConfig) {
    this.companyConfig = companyConfig;
    this.coreIntents = CORE_INTENT_CATEGORIES;
    this.companyIntents = this.loadCompanyIntents();
    this.confidenceThresholds = {
      high: 0.85,
      medium: 0.70,
      low: 0.50
    };
  }

  async classifyIntent(userInput, conversationContext = {}) {
    const startTime = Date.now();
    
    // Step 1: Preprocess input
    const processedInput = this.preprocessInput(userInput);
    
    // Step 2: Check for company-specific intents first (higher priority)
    const companyIntent = await this.matchCompanyIntent(processedInput, conversationContext);
    if (companyIntent.confidence >= this.confidenceThresholds.medium) {
      return this.buildIntentResult(companyIntent, startTime);
    }
    
    // Step 3: Check core intents
    const coreIntent = await this.matchCoreIntent(processedInput, conversationContext);
    if (coreIntent.confidence >= this.confidenceThresholds.low) {
      return this.buildIntentResult(coreIntent, startTime);
    }
    
    // Step 4: Semantic similarity check (if enabled)
    if (this.companyConfig.semanticMatchingEnabled) {
      const semanticIntent = await this.semanticIntentMatch(processedInput);
      if (semanticIntent.confidence >= this.confidenceThresholds.low) {
        return this.buildIntentResult(semanticIntent, startTime);
      }
    }
    
    // Step 5: Default to NONE intent
    return this.buildIntentResult({
      intent: 'NONE',
      confidence: 0.1,
      reason: 'no_match_found',
      suggestedAction: 'escalate'
    }, startTime);
  }

  preprocessInput(input) {
    return {
      original: input,
      normalized: input.toLowerCase().trim(),
      tokens: this.tokenize(input),
      entities: this.extractEntities(input),
      sentiment: this.analyzeSentiment(input)
    };
  }

  async matchCompanyIntent(processedInput, context) {
    // Match against company-specific Q&As and protocols
    const matches = [];
    
    // Check Knowledge Base entries
    const kbMatches = await this.matchKnowledgeBase(processedInput);
    matches.push(...kbMatches);
    
    // Check company protocols
    const protocolMatches = this.matchProtocols(processedInput);
    matches.push(...protocolMatches);
    
    // Check category Q&As
    const categoryMatches = this.matchCategoryQAs(processedInput);
    matches.push(...categoryMatches);
    
    return this.selectBestMatch(matches);
  }

  buildIntentResult(intentData, startTime) {
    return {
      intent: intentData.intent,
      confidence: intentData.confidence,
      entities: intentData.entities || {},
      priority: intentData.priority || 'medium',
      escalationThreshold: intentData.escalation_threshold || 0.7,
      responseTimeTarget: intentData.response_time_target || '< 60 seconds',
      processingTime: Date.now() - startTime,
      suggestedActions: intentData.suggestedActions || [],
      debugInfo: {
        matchMethod: intentData.reason,
        matchedKeywords: intentData.matchedKeywords || [],
        semanticScore: intentData.semanticScore || null
      }
    };
  }
}
```

## Response Flow Optimization

### Current Flow (10-Tier Waterfall)
1. Specific Scenario Protocols (0.95 confidence)
2. Personality Responses (0.85 confidence)  
3. Knowledge Base Entries (0.9 confidence)
4. Quick Q&A Reference (0.75 confidence)
5. Company Category Q&As (0.8 confidence)
6. Smart Conversational Brain (0.7 confidence)
7. Primary Script Controller (variable confidence)
8. Intelligent Response Generation (0.6 confidence)
9. LLM Fallback (variable confidence)
10. Final Escalation (0 confidence)

### Proposed Intent-Driven Flow

```javascript
class IntentDrivenResponseGenerator {
  async generateResponse(intentResult, callContext) {
    const { intent, confidence, priority } = intentResult;
    
    // Route based on intent classification
    switch(intent) {
      case 'EMERGENCY':
        return await this.handleEmergencyIntent(intentResult, callContext);
        
      case 'SCHEDULING':
        return await this.handleSchedulingIntent(intentResult, callContext);
        
      case 'PRICING':
        return await this.handlePricingIntent(intentResult, callContext);
        
      case 'TECHNICAL_SUPPORT':
        return await this.handleTechnicalIntent(intentResult, callContext);
        
      case 'COMPLAINT':
        return await this.handleComplaintIntent(intentResult, callContext);
        
      default:
        return await this.handleGenericIntent(intentResult, callContext);
    }
  }

  async handleEmergencyIntent(intentResult, callContext) {
    // Emergency intents get highest priority treatment
    
    // 1. Check for immediate escalation keywords
    if (this.hasUrgentKeywords(intentResult)) {
      return this.immediateEscalation(intentResult);
    }
    
    // 2. Quick protocol check for emergency procedures
    const emergencyProtocol = await this.getEmergencyProtocol(intentResult);
    if (emergencyProtocol) {
      return this.formatEmergencyResponse(emergencyProtocol);
    }
    
    // 3. Escalate if no emergency protocol found
    return this.escalateToHuman('emergency_protocol_needed');
  }

  async handleSchedulingIntent(intentResult, callContext) {
    // 1. Check for scheduling-specific Q&As
    const schedulingQA = await this.getSchedulingQA(intentResult);
    if (schedulingQA && schedulingQA.confidence >= 0.7) {
      return this.formatSchedulingResponse(schedulingQA);
    }
    
    // 2. Check for availability protocols
    const availabilityInfo = await this.getAvailabilityProtocol(intentResult);
    if (availabilityInfo) {
      return this.formatAvailabilityResponse(availabilityInfo);
    }
    
    // 3. Default scheduling response
    return this.defaultSchedulingResponse();
  }

  async handlePricingIntent(intentResult, callContext) {
    // Enhanced pricing classification (from enhanced-intent-classification.js)
    
    // 1. Service call pricing
    if (this.matchesPricingCategory(intentResult, 'service_call')) {
      return this.getServiceCallPricing();
    }
    
    // 2. Maintenance pricing
    if (this.matchesPricingCategory(intentResult, 'maintenance')) {
      return this.getMaintenancePricing();
    }
    
    // 3. Repair pricing
    if (this.matchesPricingCategory(intentResult, 'repair')) {
      return this.getRepairPricing();
    }
    
    // 4. General pricing inquiry
    return this.getGeneralPricingInfo();
  }
}
```

## Implementation Plan

### Phase 1: Intent Classification Integration (Week 1)
1. **Integrate Enhanced Intent Classifier**
   - Move `enhanced-intent-classification.js` functionality into main agent
   - Create `IntentClassifier` service class
   - Add intent classification as first step in `RealTimeAgentMiddleware`

2. **Update Response Routing**
   - Modify `handleIncomingCall()` to use intent classification
   - Create intent-specific handler methods
   - Maintain backward compatibility with existing flow

### Phase 2: Response Optimization (Week 2)
1. **Intent-Driven Response Generation**
   - Create specialized handlers for each intent category
   - Optimize response selection based on intent confidence
   - Implement intent-specific escalation logic

2. **Enhanced Confidence Scoring**
   - Dynamic confidence thresholds per intent type
   - Context-aware confidence adjustment
   - Multi-factor confidence calculation

### Phase 3: Learning and Improvement (Week 3)
1. **Intent Learning System**
   - Track intent classification accuracy
   - Learn from human corrections
   - Auto-improve classification over time

2. **Performance Analytics**
   - Intent-specific response metrics
   - Classification accuracy tracking
   - Response effectiveness measurement

## Code Structure for Implementation

```
services/
├── intentClassification/
│   ├── IntentClassifier.js           # Main classification engine
│   ├── CoreIntents.js               # Core intent definitions
│   ├── CompanyIntentExtensions.js   # Company-specific intents
│   └── SemanticMatcher.js           # Semantic similarity matching
│
├── responseGeneration/
│   ├── IntentDrivenResponder.js     # Intent-based response routing
│   ├── EmergencyHandler.js          # Emergency intent handling
│   ├── SchedulingHandler.js         # Scheduling intent handling
│   ├── PricingHandler.js            # Pricing intent handling
│   └── TechnicalHandler.js          # Technical support handling
│
└── agentIntelligence/
    ├── ContextManager.js            # Conversation context tracking
    ├── ConfidenceCalculator.js      # Multi-factor confidence scoring
    └── LearningEngine.js            # Intent classification improvement
```

## Success Metrics

### Response Quality Metrics
- **Intent Classification Accuracy:** > 85%
- **Response Relevance Score:** > 80%
- **First-Call Resolution Rate:** > 70%
- **Average Response Time:** < 60 seconds

### Escalation Metrics
- **Unnecessary Escalation Rate:** < 15%
- **Emergency Response Time:** < 30 seconds
- **Customer Satisfaction:** > 4.0/5.0

### System Performance
- **Intent Classification Time:** < 2 seconds
- **Total Response Generation:** < 5 seconds
- **System Uptime:** > 99.5%

---

This enhanced intent classification system will provide:
1. **Faster Response Times** - Direct routing to appropriate handlers
2. **Higher Accuracy** - Intent-specific optimization
3. **Better Escalation Logic** - Context-aware escalation decisions
4. **Improved Learning** - Self-improving classification over time
5. **Enhanced Monitoring** - Detailed intent-level analytics
