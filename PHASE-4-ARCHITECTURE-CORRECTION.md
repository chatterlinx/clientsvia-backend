# PHASE 4 ARCHITECTURE CORRECTION

**Date:** November 16, 2025  
**Status:** PHASE 3 COMPLETE - Phase 4 Reverted and Redesigned

---

## 🚨 **WHAT HAPPENED**

Phase 4 was initially implemented as a **duplicate 3-Tier knowledge engine**, which was incorrect because:
- ❌ A 3-Tier system **already exists** and is operational (Global AI Brain UI)
- ❌ Built new `knowledgeEngine.js`, `semanticSearchService.js` that duplicated existing logic
- ❌ Ignored existing scenario-based architecture
- ❌ Cost: Wasted 1,100+ lines of code

**Phase 4 was reverted** via `git reset --hard 4399b75a`

---

## ✅ **CURRENT STATE (Phase 1-3 INTACT)**

### **Phase 1: Call Engine Spine** ✅
- FrontlineContext (Redis)
- CallTrace (MongoDB)
- Contact, Location, Appointment models
- UsageRecord, CompanyBillingState
- BookingHandler
- Active Instructions API

### **Phase 2: Active Instructions X-Ray** ✅
- CompanyConfigLoader
- Normalizes config from multiple sources
- `/api/active-instructions` endpoint

### **Phase 3: Frontline-Intel + LLM-0 Orchestrator** ✅
- Frontline-Intel: Cheap intent classifier (rules-based)
- LLM-0 Orchestrator: Master decision maker
- Production hardening:
  - Micro-utterance filtering
  - LLM guardrails
  - Booking idempotency
  - Feature flags
  - Logging levels
  - JSON parse fallback

---

## 🎯 **THE CORRECT ARCHITECTURE (What Phase 4 Should Be)**

### **Current Flow (Phase 3):**
```
Call → Frontline-Intel → LLM-0 → Booking/Response
       (intent, signals)  (decision)
```

### **Target Flow (Phase 4: Triage Router):**
```
Call
  ↓
Spam/Edge Case Filter
  ↓
FRONTLINE-INTEL (cheap classifier)
  ├─ Detects intent: "troubleshooting"
  ├─ Extracts keywords: ["buzzing", "AC", "noise"]
  └─ Identifies urgency: "normal"
  ↓
TRIAGE ROUTER (distribution hub) ← **MISSING**
  ├─ Takes keywords from Frontline-Intel
  ├─ Matches to scenario categories
  │   - "AC buzzing" → "HVAC Troubleshooting" category
  │   - "What are your hours?" → "Business Hours" category
  │   - "How much for repair?" → "Pricing Questions" category
  └─ Routes to appropriate tier in EXISTING 3-Tier system
  ↓
EXISTING 3-TIER SYSTEM (Global AI Brain)
  ├─ Tier 1: Rule-based scenarios (80%) - FREE
  ├─ Tier 2: Semantic matching (14%) - FREE
  └─ Tier 3: LLM fallback (6%) - $0.0005/call
  ↓
Response → LLM-0 → TTS → Caller
```

---

## 📋 **WHAT NEEDS TO BE BUILT (Real Phase 4)**

### **1. Triage Router Service**

**File:** `src/services/triageRouter.js`

**Purpose:** Connect Frontline-Intel output to existing 3-Tier system

**Input:**
```javascript
{
  intent: "troubleshooting",
  signals: {
    maybeEmergency: false,
    maybeTroubleshooting: true,
    maybeBooking: false
  },
  keywords: ["buzzing", "AC", "noise"],
  context: { /* FrontlineContext */ }
}
```

**Output:**
```javascript
{
  matchedScenario: {
    category: "HVAC Troubleshooting",
    scenarioId: "scenario_123",
    confidence: 0.92,
    tier: 1
  },
  response: {
    text: "A buzzing noise in your AC...",
    nextAction: "ask_clarifying_question"
  }
}
```

**Implementation:**
```javascript
async function routeToTier({ intent, keywords, context, companyId }) {
  // 1. Load company scenarios from GlobalInstantResponseTemplate
  const scenarios = await loadCompanyScenarios({ companyId });
  
  // 2. Match keywords to scenario triggers/synonyms
  const matches = matchKeywordsToScenarios({ keywords, scenarios });
  
  // 3. If high confidence match (>0.8) → Tier 1 (FREE)
  if (matches[0]?.confidence > 0.8) {
    return {
      tier: 1,
      scenario: matches[0],
      response: await executeScenario(matches[0])
    };
  }
  
  // 4. If medium confidence (0.5-0.8) → Tier 2 (semantic search)
  if (matches[0]?.confidence > 0.5) {
    return await semanticSearchTier2({ 
      query: context.transcript.slice(-1)[0].text,
      candidates: matches,
      companyId 
    });
  }
  
  // 5. If no match or low confidence → Tier 3 (LLM fallback)
  return await llmFallbackTier3({
    query: context.transcript.slice(-1)[0].text,
    intent,
    context,
    companyId
  });
}
```

---

### **2. Integration with orchestrationEngine.js**

**Location:** `src/services/orchestrationEngine.js` (after Frontline-Intel, before LLM-0)

**Current Code:**
```javascript
// STEP 5: Run Frontline-Intel
const intel = classifyFrontlineIntent({ text: cleanedText, config, context: ctx });

// STEP 6: Build LLM-0 prompt and get decision
const decision = await callLLM0({ intel, ctx, config, cleanedText });
```

**New Code (with Triage Router):**
```javascript
// STEP 5: Run Frontline-Intel
const intel = classifyFrontlineIntent({ text: cleanedText, config, context: ctx });

// STEP 5.5: Route to existing 3-Tier system via Triage
const triageResult = await triageRouter.routeToTier({
  intent: intel.intent,
  keywords: extractKeywords(cleanedText),
  context: ctx,
  companyId
});

// If Triage found a match (Tier 1/2), use it
if (triageResult.tier === 1 || triageResult.tier === 2) {
  return {
    nextPrompt: triageResult.response.text,
    decision: {
      action: triageResult.response.nextAction || 'answer_with_knowledge',
      tier: triageResult.tier,
      scenarioId: triageResult.scenario.id,
      confidence: triageResult.scenario.confidence
    }
  };
}

// Otherwise, proceed to LLM-0 for complex orchestration
const decision = await callLLM0({ intel, ctx, config, cleanedText, triageResult });
```

---

### **3. Scenario Loader (connect to existing system)**

**File:** `src/services/scenarioLoader.js`

**Purpose:** Load scenarios from GlobalInstantResponseTemplate

```javascript
async function loadCompanyScenarios({ companyId }) {
  const company = await V2Company.findById(companyId).lean();
  
  // Load cloned template
  const templateIds = company.configuration?.clonedFrom || [];
  const templates = await GlobalInstantResponseTemplate.find({
    _id: { $in: templateIds }
  }).lean();
  
  // Extract scenarios from templates
  const scenarios = [];
  for (const template of templates) {
    for (const scenario of template.scenarios || []) {
      scenarios.push({
        id: scenario._id,
        category: scenario.category,
        name: scenario.name,
        triggers: scenario.triggers || [],
        synonyms: scenario.synonyms || [],
        responseText: scenario.responseText,
        tone: scenario.tone,
        enabled: scenario.enabled !== false
      });
    }
  }
  
  return scenarios;
}
```

---

### **4. Keyword Extractor**

**File:** `src/services/keywordExtractor.js`

**Purpose:** Extract meaningful keywords from caller text

```javascript
function extractKeywords(text, config) {
  // 1. Remove filler words (use config.fillerWords.active)
  let cleaned = text.toLowerCase();
  for (const filler of config.fillerWords.active) {
    cleaned = cleaned.replace(new RegExp(`\\b${filler}\\b`, 'gi'), '');
  }
  
  // 2. Tokenize
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  
  // 3. Remove common stop words
  const stopWords = ['the', 'is', 'at', 'which', 'on', 'a', 'an'];
  const keywords = tokens.filter(t => !stopWords.includes(t));
  
  // 4. Return unique keywords
  return [...new Set(keywords)];
}
```

---

## 📊 **EXPECTED PERFORMANCE (After Phase 4)**

### **Cost Optimization:**
```
Current (Phase 3):
- Every turn → LLM-0 ($0.0005)
- 5-turn call → $0.0025

After Triage Router (Phase 4):
- Turn 1: "My AC is buzzing" → Triage → Tier 1 (FREE)
- Turn 2: "ok" (micro-utterance) → Filtered (FREE)
- Turn 3: "Can you come today?" → LLM-0 ($0.0005)
- Turn 4: Booking info → LLM-0 ($0.0005)
- Turn 5: Confirmation → LLM-0 ($0.0005)

5-turn call → $0.0015 (40% cost reduction)
```

### **Performance:**
- Tier 1 hits: < 50ms (rule-based)
- Tier 2 hits: < 200ms (semantic)
- Tier 3 hits: 500-1000ms (LLM fallback)
- LLM-0 orchestration: 300-600ms

### **Hit Distribution (Target):**
- 80% Tier 1 (FREE) - Questions with clear scenario matches
- 14% Tier 2 (FREE) - Questions with semantic matches
- 6% Tier 3 (Paid) - Complex/ambiguous questions
- LLM-0 used only for orchestration (booking, clarification, escalation)

---

## 🎯 **IMPLEMENTATION CHECKLIST (Real Phase 4)**

- [ ] 1. Understand existing 3-Tier system
  - [ ] Read `models/GlobalInstantResponseTemplate.js`
  - [ ] Find where scenarios are stored
  - [ ] Find existing tier selection logic
  - [ ] Understand scenario matching algorithm

- [ ] 2. Build Triage Router
  - [ ] `scenarioLoader.js` - Load scenarios from templates
  - [ ] `keywordExtractor.js` - Extract keywords from text
  - [ ] `triageRouter.js` - Main routing logic
  - [ ] Unit tests for each component

- [ ] 3. Integrate with orchestrationEngine.js
  - [ ] Add STEP 5.5 (Triage Router)
  - [ ] Pass Frontline-Intel output to Triage
  - [ ] Use Tier 1/2 responses when available
  - [ ] Fall back to LLM-0 for complex cases

- [ ] 4. Testing
  - [ ] Test Tier 1 hits (exact scenario matches)
  - [ ] Test Tier 2 hits (semantic matches)
  - [ ] Test Tier 3 fallback (no matches)
  - [ ] Test cost reduction vs. Phase 3
  - [ ] Test performance (latency)

- [ ] 5. Documentation
  - [ ] Update architecture diagrams
  - [ ] Document triage routing logic
  - [ ] Add testing guide
  - [ ] Update cost analysis

---

## 📝 **NEXT STEPS**

1. **User provides:**
   - `models/GlobalInstantResponseTemplate.js`
   - Existing 3-Tier implementation files
   - Sample scenario data structure

2. **Build Triage Router:**
   - Load scenarios from templates
   - Match keywords to scenarios
   - Route to appropriate tier

3. **Integrate with orchestrationEngine.js:**
   - Add STEP 5.5 between Frontline-Intel and LLM-0
   - Use Triage results when available
   - Fall back to LLM-0 for orchestration

4. **Test and optimize:**
   - Verify cost reduction
   - Verify performance
   - Verify accuracy

---

## 🔍 **FILES NEEDED TO START**

Please provide these files to implement the correct Phase 4:

```bash
# 1. Template model
cat models/GlobalInstantResponseTemplate.js

# 2. Existing 3-Tier code (if separate)
cat services/HybridScenarioSelector.js
# or wherever tier selection happens

# 3. Scenario structure
# Show a sample scenario from the Global AI Brain UI

# 4. v2Company schema
cat models/v2Company.js | grep -A 50 "aiAgentSettings\|configuration"
```

Once provided, I'll build the **Triage Router** that correctly connects Frontline-Intel → Existing 3-Tier → LLM-0.

---

**Status:** Ready to build Phase 4 correctly  
**Blocked by:** Need to see existing 3-Tier implementation  
**Estimated:** 4-6 hours once files are provided

