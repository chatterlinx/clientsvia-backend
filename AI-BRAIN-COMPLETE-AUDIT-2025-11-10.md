# 🧠 AI BRAIN - COMPLETE ARCHITECTURAL AUDIT
**Date:** November 10, 2025  
**Status:** Active Production System  
**Purpose:** Complete understanding of AI Brain architecture for enhancement discussions

---

## 📊 EXECUTIVE SUMMARY

**Current State:**
- ✅ Single source of truth: `AIBrain3tierllm.js`
- ✅ 3-Tier Intelligence cascade (Rule → Semantic → LLM)
- ✅ Redis caching for sub-50ms performance
- ✅ Scenario-based responses (no hardcoded text)
- ✅ Comprehensive performance tracking

**What AI Brain Handles:**
- 🎯 ALL user queries to Twilio voice system
- 🎯 ALL responses generated via 3-tier matching
- 🎯 Learning system (Tier 3 teaches Tier 1)
- 🎯 Cost optimization (99% free Tier 1/2, 1% expensive Tier 3)

---

## 🏗️ ARCHITECTURE - COMPLETE COMPONENT MAP

### **LAYER 1: Entry Point**
```
AIBrain3tierllm.query()
├─ Single public method for all queries
├─ Accepts: companyId, userInput, context
└─ Returns: { confidence, response, metadata }
```

**Location:** `services/AIBrain3tierllm.js` (line 46)  
**Purpose:** Router entry point, cache management, metrics tracking  
**Key Features:**
- Redis cache check (sub-50ms hits)
- Performance tracking per call
- Tier usage statistics
- Response validation before returning

---

### **LAYER 2: Scenario Pool Loading**
```
ScenarioPoolService.getScenarioPoolForCompany()
├─ Loads ALL scenarios for a company
├─ Multi-template support (can combine templates)
├─ Per-scenario enable/disable controls
├─ Redis caching (300s TTL)
└─ Returns: { scenarios[], templatesUsed[] }
```

**Location:** `services/ScenarioPoolService.js`  
**Purpose:** Build the "universe" of possible responses for a company  
**Key Data:**
```javascript
Scenario = {
  scenarioId: "unique-id",
  name: "Hours of Operation",
  triggers: ["what are your hours", "when open", "operating times"],
  quickReplies: ["We're here to help!"],      // SHORT acknowledgments
  fullReplies: ["We're open Mon-Fri 9-6"],    // DETAILED responses
  category: "Business Hours",
  isEnabledForCompany: true
}
```

**Critical Feature:** Multi-template support
- Company can use multiple templates simultaneously
- Scenarios merge into single pool
- Template priority order honored

---

### **LAYER 3: 3-Tier Intelligence Cascade**

#### **Tier 1: Rule-Based Matching**
```
HybridScenarioSelector.match()
├─ BM25 Keyword Scoring (40% weight)
├─ Semantic Similarity (30% weight - placeholder)
├─ Regex Pattern Matching (20% weight)
├─ Context Weighting (10% weight)
└─ Returns: { matched, scenario, confidence, trace }
```

**Location:** `services/HybridScenarioSelector.js`  
**Purpose:** Fast, free, rule-based matching  
**Cost:** $0  
**Speed:** ~50ms  
**What It Knows:**
- Exact keywords from scenario triggers
- Synonyms (custom per template)
- Filler words (um, uh, like) to remove
- Urgency keywords for priority

**Example Match Flow:**
```
User Input: "Hey, um, what are your hours?"
↓
Remove fillers: "hey what are your hours"
↓
Apply synonyms: hours → operating times, schedule
↓
BM25 score against all scenarios
↓
Best match: "Hours of Operation" (score: 0.82)
↓
Check threshold (0.80): MATCH! ✅
```

---

#### **Tier 2: Semantic Matching**
```
IntelligentRouter.tryTier2()
├─ BM25 statistical analysis (currently implemented)
├─ Context-aware scoring
├─ Fuzzy matching on edge cases
└─ Returns: { matched, scenario, confidence, trace }
```

**Location:** `services/IntelligentRouter.js` (line ~235)  
**Purpose:** Handle Tier 1 rejections with semantic logic  
**Cost:** $0  
**Speed:** ~100ms  
**Trigger:** When Tier 1 confidence < threshold

**When It Activates:**
```
Tier 1 Score: 0.72
Tier 1 Threshold: 0.80
Result: ESCALATE TO TIER 2
```

**What Tier 2 Does:**
- Analyzes statistical term importance (inverse document frequency)
- Considers query length and complexity
- Weights context clues
- Applies fuzzy matching for typos/variations

---

#### **Tier 3: LLM Fallback**
```
Tier3LLMFallback.analyze()
├─ OpenAI GPT-4o-mini API call
├─ Natural language understanding
├─ Pattern extraction for learning
├─ Scenario recommendation
└─ Returns: { matched, scenario, confidence, patterns, cost }
```

**Location:** `services/Tier3LLMFallback.js`  
**Purpose:** Handle ambiguous/novel queries, teach Tier 1  
**Cost:** ~$0.0015 per call (GPT-4o-mini)  
**Speed:** ~1500ms  
**Trigger:** When Tier 1 + Tier 2 both fail

**Model Used:** `gpt-4o-mini` (Oct 2024)  
**Pricing:** $0.15 per 1M prompt tokens, $0.60 per 1M completion tokens

**What Tier 3 Does:**
```javascript
1. Takes: user input + available scenarios
2. LLM analyzes: "Which scenario fits best?"
3. Extracts: Patterns (new synonyms, triggers)
4. Returns: Best scenario + confidence + patterns
5. Learning: Sends patterns to PatternLearningService
```

**Self-Improvement Loop:**
```
Week 1: Tier 3 handles 70% of calls ($100/week cost)
         ↓ extracts patterns
Week 4: Tier 1 now handles those patterns → FREE
         ↓ Tier 3 cost drops 20%
Week 12: Tier 1 handles 85%, Tier 3 handles 2%
         ↓ cost drops to $10/week
```

---

### **LAYER 4: Response Selection (New - Your Issue!)**

**What We Fixed Today:**
```javascript
// BEFORE: Random 30% quick reply selection
const useQuickReply = Math.random() < 0.3;

// AFTER: Intelligent selection based on scenario type
if (scenarioName.includes('hours') || 
    scenarioName.includes('pricing') ||
    scenarioName.includes('location')) {
    
    useQuickReply = false;  // ALWAYS use detailed replies
} else if (scenarioName.includes('appointment')) {
    
    useQuickReply = Math.random() < 0.3;  // 30% random
}
```

**Locations:**
- `services/IntelligentRouter.js` (lines 367-385)
- `services/AIBrain3tierllm.js` (lines 389-408)

---

### **LAYER 5: Response Processing & Return**
```
replacePlaceholders()
├─ Replace {{business_hours}} → actual hours
├─ Replace {{company_name}} → actual company name
└─ Clean response text

Return to Twilio:
{
  confidence: 0.82,
  response: "We're open Monday to Friday, 9 AM to 6 PM",
  metadata: {
    source: 'ai-brain',
    scenarioId: 'scn-12345',
    scenarioName: 'Hours of Operation',
    tierUsed: 1,
    cost: 0,
    responseTime: 47ms,
    cached: false
  }
}
```

---

## 📊 DATA FLOW - COMPLETE REQUEST LIFECYCLE

### **Step 1: User Calls Twilio**
```
User: (voice) → Twilio → Twilio Server
```

### **Step 2: Twilio Webhook to Backend**
```
POST /api/twilio/v2-agent-respond/:companyID
{
  From: "+12398889905",
  SpeechResult: "What are your hours?",
  CallSid: "CA531082b7a963be7d77e91e2f535782fc"
}
```

### **Step 3: V2AIAgentRuntime receives call**
```
v2AIAgentRuntime.generateV2Response()
├─ Extract company config
├─ Prepare context object
└─ Call AIBrain3tierllm.query()
```

**Location:** `services/v2AIAgentRuntime.js` (line 332)

### **Step 4: AIBrain3tierllm processes**
```
AIBrain3tierllm.query()
├─ Cache check: "What are your hours?" in Redis?
│  └─ HIT: Return cached response (47ms)
│  └─ MISS: Continue to queryAIBrain()
│
├─ queryAIBrain()
│  ├─ Load company settings
│  ├─ Load scenario pool (ScenarioPoolService)
│  ├─ Call IntelligentRouter.route() with 3-tier cascade
│  └─ Return best match
│
├─ Cache result (300s TTL)
└─ Return to v2AIAgentRuntime
```

### **Step 5: IntelligentRouter 3-Tier Cascade**
```
IntelligentRouter.route()

TIER 1: HybridScenarioSelector.match()
├─ Input: "What are your hours?"
├─ BM25 score: 0.82 against "Hours of Operation"
├─ Threshold: 0.80
└─ Result: ✅ MATCH (confidenceL 0.82)
   ↓ STOP HERE - Tier 1 succeeded!

IF TIER 1 FAILED (confidence < 0.80):
  TIER 2: Try semantic matching
  ├─ Statistical analysis
  ├─ Fuzzy matching
  └─ Result: matched OR not matched
     ↓ STOP - Tier 2 tried

  IF TIER 2 FAILED:
    TIER 3: LLM fallback
    ├─ OpenAI GPT-4o-mini API call
    ├─ "Which scenario best matches this?"
    ├─ Cost: $0.0015
    ├─ Time: ~1500ms
    └─ Result: matched OR not matched (rare)
```

### **Step 6: Response Selection**
```
Matched Scenario: "Hours of Operation"
├─ quickReplies: ["We're here to help!"]
├─ fullReplies: ["We're open Mon-Fri 9 AM to 6 PM", ...]
│
NEW LOGIC (Fixed Today):
├─ Detect: Scenario type is INFORMATION
├─ Decision: Use FULL replies ALWAYS
└─ Selected: "We're open Mon-Fri 9 AM to 6 PM"
```

### **Step 7: Response Back to User**
```
replacePlaceholders()
├─ "We're open Mon-Fri 9 AM to 6 PM"
└─ Return to Twilio
   ↓
Twilio converts to speech (ElevenLabs)
   ↓
User hears: natural voice response
```

---

## 🔍 WHAT GETS STORED & CACHED

### **Redis Cache**
```
Key: "ai-response:{companyId}:{queryHash}"
Value: {
  confidence: 0.82,
  response: "We're open...",
  metadata: {...}
}
TTL: 300 seconds (5 minutes)
```

**Why Cache?**
- Same question asked by different callers → reuse answer
- 30x faster responses (47ms vs 1500ms)
- Reduce OpenAI API calls

---

### **MongoDB Storage**
```
Models:
├─ Company (aiAgentLogic settings)
├─ GlobalInstantResponseTemplate (scenarios)
├─ LLMCallLog (Tier 3 usage tracking)
└─ TestPilotAnalysis (Test Pilot results)
```

---

## 📈 PERFORMANCE METRICS

**What AI Brain Tracks:**
```javascript
performanceMetrics: {
  totalQueries: 1247,
  tier1Hits: 1050,        // 84%
  tier2Hits: 162,         // 13%
  tier3Hits: 35,          // 3%
  avgResponseTime: 267ms,
  cacheHits: 534,         // 43% cache hit rate
  lastOptimized: "2025-11-10T17:52:00Z"
}
```

**Per-Call Breakdown:**
```
{
  perfCheckpoints: {
    cacheCheck: 1ms,
    aiBrainQuery: 125ms,
    cacheWrite: 2ms
  },
  totalTime: 128ms
}
```

---

## 🎯 CURRENT LIMITATIONS & OBSERVATIONS

### **What Works Well:**
✅ Fast rule-based matching (Tier 1)  
✅ Semantic fallback (Tier 2)  
✅ LLM as ultimate safety net (Tier 3)  
✅ Learning loop (Tier 3 → Tier 1)  
✅ Redis caching  
✅ Multi-template support  
✅ Comprehensive logging  

### **What Could Be Enhanced:**
❓ Tier 1 only uses: keywords, synonyms, fillers, patterns  
❓ No intent detection (just pattern matching)  
❓ No sentiment analysis (happy vs frustrated user)  
❓ No conversation history (each query isolated)  
❓ No multi-intent support ("Book AND tell me pricing")  
❓ No dynamic threshold adjustment per category  
❓ No response quality validation before returning  
❓ Quick/Full reply selection was too random (FIXED TODAY)  

---

## 🔧 CONFIGURATION - WHERE SETTINGS LIVE

### **Company-Level Settings:**
```
Company.aiAgentLogic.useGlobalIntelligence
├─ true: Use global admin settings
└─ false: Use custom company settings

Company.aiAgentLogic.tier1Threshold = 0.80
Company.aiAgentLogic.tier2Threshold = 0.60
```

### **Template-Level Settings:**
```
GlobalInstantResponseTemplate.learningSettings
├─ tier1Threshold (can override per template)
├─ tier2Threshold
├─ fillerWords[] (custom per template)
├─ urgencyKeywords[] (custom per template)
└─ synonymMap {} (custom per template)
```

### **Global Admin Settings:**
```
AdminSettings.intelligenceConfig
├─ tier1Threshold: 0.80
├─ tier2Threshold: 0.60
├─ enableTier3: true
├─ enableLearning: true
└─ enableCaching: true
```

---

## 🚀 CURRENT FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────┐
│                  Caller Question                             │
│              "What are your hours?"                          │
└────────────────────┬────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────────┐
│           AIBrain3tierllm.query()                            │
│  (Entry point, cache management, metrics)                   │
├─────────────────────────────────────────────────────────────┤
│  1. Check Redis cache                                        │
│     ├─ HIT: Return (47ms) ✅                                │
│     └─ MISS: Continue                                        │
└────────────────────┬────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────────┐
│        ScenarioPoolService.getScenarioPoolForCompany()      │
│  (Load all scenarios, check Redis cache)                    │
├─────────────────────────────────────────────────────────────┤
│  Returns: [                                                  │
│    { Hours of Operation },                                   │
│    { Request Appointment },                                  │
│    { Pricing },                                              │
│    ...                                                       │
│  ]                                                            │
└────────────────────┬────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────────┐
│        IntelligentRouter.route()                             │
│     (3-Tier Cascade Orchestrator)                            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ TIER 1: HybridScenarioSelector.match()               │  │
│  │  BM25 + Semantic + Regex + Context                    │  │
│  │  Score: 0.82 vs Threshold: 0.80                       │  │
│  │  Result: ✅ MATCH! Return scenario                    │  │
│  └────────────┬────────────────────────────────────────┘  │
│               │                                             │
│               └─→ STOP (Tier 1 succeeded)                  │
│                                                             │
│  (If Tier 1 failed, would try Tier 2, then Tier 3)        │
│                                                             │
└────────────────────┬────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────────┐
│       Response Selection (NEW INTELLIGENT LOGIC)             │
│                                                              │
│  Scenario: "Hours of Operation"                             │
│  ├─ Detect: INFORMATION type                               │
│  ├─ Decision: Use FULL replies (not quick)                 │
│  └─ Select: "We're open Mon-Fri 9 AM to 6 PM"            │
└────────────────────┬────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────────┐
│          replacePlaceholders()                               │
│  (Handle {{business_hours}}, etc.)                           │
└────────────────────┬────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────────┐
│    Return to Twilio → ElevenLabs → User hears response     │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 SUMMARY TABLE - ALL COMPONENTS

| Component | Location | Purpose | Cost | Speed |
|-----------|----------|---------|------|-------|
| AIBrain3tierllm | services/ | Entry point, cache, metrics | $0 | varies |
| ScenarioPoolService | services/ | Load all scenarios | $0 | 50-200ms |
| HybridScenarioSelector | services/ | Tier 1 rule-based | $0 | ~50ms |
| IntelligentRouter | services/ | 3-tier orchestrator | $0-0.50 | varies |
| Tier3LLMFallback | services/ | LLM fallback | $0.0015 | ~1500ms |
| v2AIAgentRuntime | services/ | Call handler | $0 | varies |
| v2InstantResponseMatcher | services/ | Quick matches | $0 | ~5ms |
| PatternLearningService | services/ | Extract patterns | $0 | varies |

---

## ❓ QUESTIONS FOR ENHANCEMENT DISCUSSION

**For Deeper Intelligence:**

1. **Intent Detection** - Should Tier 1 detect intent types (information vs action)?
2. **Sentiment Analysis** - Should we detect user frustration and route differently?
3. **Conversation History** - Should responses consider previous turns?
4. **Multi-Intent** - How to handle: "Book appointment AND tell me pricing"?
5. **Dynamic Thresholds** - Should thresholds vary by scenario category?
6. **Response Quality** - Should we validate responses before returning?
7. **Fallback Handling** - Current: "If Tier 3 fails, transfer to human" - OK?
8. **Learning Speed** - Tier 3 patterns take 300s cache TTL - faster feedback loop?

---

**This is your current state. Ready for discussion when you are.** 🧠

