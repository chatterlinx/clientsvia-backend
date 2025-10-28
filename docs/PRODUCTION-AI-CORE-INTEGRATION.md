# 🔗 PRODUCTION AI → AI CORE DATA FLOW DOCUMENTATION

**Version:** 1.0  
**Last Updated:** October 28, 2025  
**Purpose:** Mission-critical documentation for Production AI Gatekeeper integration  
**Audience:** Developers maintaining AI Core routing logic

---

## 🎯 EXECUTIVE SUMMARY

This document provides a **complete, line-by-line explanation** of how production customer calls flow through the ClientsVia.ai AI routing system, specifically focusing on how the **Production AI Gatekeeper** controls 3-tier intelligence routing, budget management, and fallback responses.

**CRITICAL:** This system handles **100+ companies** simultaneously. Every component is designed for:
- ✅ **Zero downtime** under high load
- ✅ **Sub-50ms latency** (Mongoose + Redis caching)
- ✅ **Graceful degradation** (multiple fallback layers)
- ✅ **Real-time monitoring** (Notification Center integration)

---

## 📊 COMPLETE DATA FLOW (Production Call)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PRODUCTION CALL FLOW: Customer → Twilio → AI Core → Response          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  📞 STEP 1: CALL ENTRY POINT                                            │
│  ════════════════════════════════════════════════════════════════════   │
│  Customer dials company phone number                                    │
│           ↓                                                             │
│  Twilio receives call → Webhook trigger                                 │
│           ↓                                                             │
│  POST /api/twilio/v2-agent-respond/:companyID                           │
│  📂 File: routes/v2twilio.js                                            │
│  📍 Line: ~120-130 (router.post('/v2-agent-respond/:companyID'))       │
│           ↓                                                             │
│  ════════════════════════════════════════════════════════════════════   │
│  📦 STEP 2: LOAD COMPANY DATA (Mongoose + Redis - CRITICAL!)           │
│  ════════════════════════════════════════════════════════════════════   │
│  📂 File: routes/v2twilio.js                                            │
│  📍 Line: ~150-180 (Company data loading)                               │
│           ↓                                                             │
│  CODE:                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ // CHECKPOINT 1: Load company with Production AI settings       │   │
│  │ const company = await Company.findById(req.params.companyID)    │   │
│  │   .select([                                                     │   │
│  │     'name',                                                     │   │
│  │     'phone',                                                    │   │
│  │     'industryType',                                             │   │
│  │     'configuration',              // Legacy template ref        │   │
│  │     'aiAgentSettings',            // Template references        │   │
│  │     'aiAgentLogic'                // ← PRODUCTION AI SETTINGS!  │   │
│  │   ])                                                            │   │
│  │   .lean()                         // Plain JS object (faster)   │   │
│  │   .cache({                        // Redis caching              │   │
│  │     key: `company:${req.params.companyID}:production-ai`,       │   │
│  │     ttl: 300                      // 5 minutes                  │   │
│  │   });                                                           │   │
│  │                                                                 │   │
│  │ // CHECKPOINT 2: Validate company exists                       │   │
│  │ if (!company) {                                                 │   │
│  │   await ProductionAIHealthMonitor.trackRoutingError(           │   │
│  │     req.params.companyID,                                       │   │
│  │     new Error('Company not found'),                             │   │
│  │     { stage: 'COMPANY_LOAD', phoneNumber: req.body.From }       │   │
│  │   );                                                            │   │
│  │   return respondWithError(res, 'Company not found');            │   │
│  │ }                                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│           ↓                                                             │
│  📊 LOADED DATA STRUCTURE:                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ {                                                               │   │
│  │   _id: ObjectId("507f1f77bcf86cd799439011"),                    │   │
│  │   name: "ABC HVAC Company",                                     │   │
│  │   phone: "+15551234567",                                        │   │
│  │   industryType: "HVAC",                                         │   │
│  │                                                                 │   │
│  │   // ─────────────────────────────────────────────────────     │   │
│  │   // PRODUCTION AI SETTINGS (aiAgentLogic)                     │   │
│  │   // ─────────────────────────────────────────────────────     │   │
│  │   aiAgentLogic: {                                               │   │
│  │                                                                 │   │
│  │     // 🔐 TEMPLATE GATEKEEPER CONFIG (3-Tier Routing)          │   │
│  │     templateGatekeeper: {                                       │   │
│  │       enabled: true,              // Enable 3-tier routing      │   │
│  │       tier1Threshold: 0.70,       // Rule-based confidence      │   │
│  │       tier2Threshold: 0.60,       // Semantic confidence        │   │
│  │       enableLLMFallback: true,    // Allow Tier 3 (LLM)         │   │
│  │       monthlyBudget: 200,         // $200/month limit           │   │
│  │       currentSpend: 145.50,       // Real-time tracking         │   │
│  │       lastResetDate: ISODate("2025-10-01T00:00:00Z")            │   │
│  │     },                                                          │   │
│  │                                                                 │   │
│  │     // 🆘 FALLBACK RESPONSE CONFIG (When AI fails)             │   │
│  │     fallbackResponses: {                                        │   │
│  │       toneProfile: 'friendly',    // Response personality       │   │
│  │       clarificationNeeded: [      // Low confidence responses   │   │
│  │         "I'm sorry, I didn't quite understand...",              │   │
│  │         "Could you rephrase that for me?"                       │   │
│  │       ],                                                        │   │
│  │       noMatchFound: [             // No scenario matched        │   │
│  │         "Let me connect you with someone who can help...",      │   │
│  │         "I'll transfer you to a specialist..."                  │   │
│  │       ],                                                        │   │
│  │       technicalIssue: [...],      // System errors              │   │
│  │       outOfScope: [...],          // Wrong service              │   │
│  │       escalationOptions: {                                      │   │
│  │         offerTransfer: true,                                    │   │
│  │         offerMessage: true,                                     │   │
│  │         offerCallback: true                                     │   │
│  │       },                                                        │   │
│  │       lastUsedIndex: {            // Rotation tracking          │   │
│  │         clarification: 0,                                       │   │
│  │         noMatch: 1,                                             │   │
│  │         technical: 0,                                           │   │
│  │         outOfScope: 0                                           │   │
│  │       }                                                         │   │
│  │     },                                                          │   │
│  │                                                                 │   │
│  │     // 🧠 LEARNING SETTINGS (AI Pattern Detection)             │   │
│  │     learningSettings: {                                         │   │
│  │       autoLearn: true,            // Enable pattern detection   │   │
│  │       sharePatterns: false,       // Don't share with other cos │   │
│  │       minConfidenceForSuggestion: 0.80                          │   │
│  │     },                                                          │   │
│  │                                                                 │   │
│  │     // Legacy fields (for backward compatibility)               │   │
│  │     thresholds: { /* old structure */ }                         │   │
│  │   },                                                            │   │
│  │                                                                 │   │
│  │   // Template references (which templates this company uses)    │   │
│  │   aiAgentSettings: {                                            │   │
│  │     templateReferences: [                                       │   │
│  │       ObjectId("65f123..."),     // HVAC Template ID            │   │
│  │       ObjectId("65f456...")      // Emergency Template ID       │   │
│  │     ]                                                           │   │
│  │   }                                                             │   │
│  │ }                                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│           ↓                                                             │
│  ════════════════════════════════════════════════════════════════════   │
│  🎯 STEP 3: ROUTE THROUGH PRIORITY SYSTEM                               │
│  ════════════════════════════════════════════════════════════════════   │
│  📂 File: services/v2priorityDrivenKnowledgeRouter.js                   │
│  📍 Method: route(query, company)                                       │
│           ↓                                                             │
│  Priority 1: Company Q&A                                                │
│  ├─ Query company-specific Q&A database                                 │
│  ├─ Confidence threshold: 0.80 (from company.aiAgentLogic.thresholds)  │
│  ├─ Result: 0.45 confidence ❌ (below threshold)                        │
│  └─ SKIP to Priority 2                                                  │
│           ↓                                                             │
│  Priority 2: Trade Q&A                                                  │
│  ├─ Query industry-specific knowledge                                   │
│  ├─ Confidence threshold: 0.75                                          │
│  ├─ Result: 0.62 confidence ❌ (below threshold)                        │
│  └─ SKIP to Priority 3 (TEMPLATES + GATEKEEPER)                         │
│           ↓                                                             │
│  ════════════════════════════════════════════════════════════════════   │
│  🚪 STEP 4: ENTER TEMPLATE GATEKEEPER (CRITICAL!)                       │
│  ════════════════════════════════════════════════════════════════════   │
│  📂 File: services/TemplateGatekeeper.js (NEW!)                         │
│  📍 Method: processQuery(query, company, templates)                     │
│           ↓                                                             │
│  CODE:                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ // ═══════════════════════════════════════════════════════════  │   │
│  │ // CHECKPOINT 3: Extract Gatekeeper Configuration              │   │
│  │ // ═══════════════════════════════════════════════════════════  │   │
│  │                                                                 │   │
│  │ const gatekeeperConfig = company.aiAgentLogic.templateGatekeeper│   │
│  │                                                                 │   │
│  │ // Quick exit if gatekeeper disabled (use basic matching)       │   │
│  │ if (!gatekeeperConfig?.enabled) {                               │   │
│  │   logger.info('Gatekeeper disabled for company', {              │   │
│  │     companyId: company._id                                      │   │
│  │   });                                                           │   │
│  │   return await this.basicTemplateMatch(query, templates);       │   │
│  │ }                                                               │   │
│  │                                                                 │   │
│  │ // ═══════════════════════════════════════════════════════════  │   │
│  │ // CHECKPOINT 4: Load Templates (with Redis caching)           │   │
│  │ // ═══════════════════════════════════════════════════════════  │   │
│  │                                                                 │   │
│  │ const loadedTemplates = await GlobalInstantResponseTemplate     │   │
│  │   .find({                                                       │   │
│  │     _id: { $in: company.aiAgentSettings.templateReferences }    │   │
│  │   })                                                            │   │
│  │   .select('name categories fillerWords synonymMap')             │   │
│  │   .lean()                                                       │   │
│  │   .cache({                                                      │   │
│  │     key: `templates:${company._id}`,                            │   │
│  │     ttl: 600                     // 10 minutes                  │   │
│  │   });                                                           │   │
│  │                                                                 │   │
│  │ // ═══════════════════════════════════════════════════════════  │   │
│  │ // TIER 1: RULE-BASED MATCHING (FREE - Pattern Matching)       │   │
│  │ // ═══════════════════════════════════════════════════════════  │   │
│  │                                                                 │   │
│  │ const tier1Result = await this.tier1RuleBasedMatch(             │   │
│  │   query,                                                        │   │
│  │   loadedTemplates                                               │   │
│  │ );                                                              │   │
│  │                                                                 │   │
│  │ if (tier1Result.confidence >= gatekeeperConfig.tier1Threshold) {│   │
│  │   logger.info('Tier 1 match', {                                 │   │
│  │     confidence: tier1Result.confidence,                         │   │
│  │     threshold: gatekeeperConfig.tier1Threshold,                 │   │
│  │     cost: 0                                                     │   │
│  │   });                                                           │   │
│  │   return tier1Result;            // ✅ RETURN (no LLM cost)     │   │
│  │ }                                                               │   │
│  │                                                                 │   │
│  │ // ═══════════════════════════════════════════════════════════  │   │
│  │ // TIER 2: SEMANTIC SIMILARITY (FREE - Vector Matching)        │   │
│  │ // ═══════════════════════════════════════════════════════════  │   │
│  │                                                                 │   │
│  │ const tier2Result = await this.tier2SemanticMatch(              │   │
│  │   query,                                                        │   │
│  │   loadedTemplates                                               │   │
│  │ );                                                              │   │
│  │                                                                 │   │
│  │ if (tier2Result.confidence >= gatekeeperConfig.tier2Threshold) {│   │
│  │   logger.info('Tier 2 match', {                                 │   │
│  │     confidence: tier2Result.confidence,                         │   │
│  │     threshold: gatekeeperConfig.tier2Threshold,                 │   │
│  │     cost: 0                                                     │   │
│  │   });                                                           │   │
│  │   return tier2Result;            // ✅ RETURN (no LLM cost)     │   │
│  │ }                                                               │   │
│  │                                                                 │   │
│  │ // ═══════════════════════════════════════════════════════════  │   │
│  │ // TIER 3: LLM FALLBACK (PAID - OpenAI GPT-4)                  │   │
│  │ // ═══════════════════════════════════════════════════════════  │   │
│  │                                                                 │   │
│  │ // CHECKPOINT 5: Check if LLM is enabled                        │   │
│  │ if (!gatekeeperConfig.enableLLMFallback) {                      │   │
│  │   logger.warn('LLM disabled by config', {                       │   │
│  │     companyId: company._id                                      │   │
│  │   });                                                           │   │
│  │   return null;  // Will trigger fallback response              │   │
│  │ }                                                               │   │
│  │                                                                 │   │
│  │ // CHECKPOINT 6: Check budget (CRITICAL!)                       │   │
│  │ const budgetRemaining = gatekeeperConfig.monthlyBudget -        │   │
│  │                         gatekeeperConfig.currentSpend;          │   │
│  │                                                                 │   │
│  │ if (budgetRemaining <= 0) {                                     │   │
│  │   logger.error('Budget exceeded - LLM blocked', {               │   │
│  │     companyId: company._id,                                     │   │
│  │     budget: gatekeeperConfig.monthlyBudget,                     │   │
│  │     spent: gatekeeperConfig.currentSpend                        │   │
│  │   });                                                           │   │
│  │                                                                 │   │
│  │   // Send critical notification                                 │   │
│  │   await ProductionAIHealthMonitor.trackBudgetExceeded(          │   │
│  │     company._id,                                                │   │
│  │     gatekeeperConfig                                            │   │
│  │   );                                                            │   │
│  │                                                                 │   │
│  │   return null;  // Will trigger fallback response              │   │
│  │ }                                                               │   │
│  │                                                                 │   │
│  │ // CHECKPOINT 7: Call OpenAI (with error handling)             │   │
│  │ try {                                                           │   │
│  │   const tier3Result = await this.tier3LLMFallback(              │   │
│  │     query,                                                      │   │
│  │     loadedTemplates,                                            │   │
│  │     company                                                     │   │
│  │   );                                                            │   │
│  │                                                                 │   │
│  │   // CHECKPOINT 8: Update budget (atomic operation)            │   │
│  │   await Company.findByIdAndUpdate(                              │   │
│  │     company._id,                                                │   │
│  │     {                                                           │   │
│  │       $inc: {                                                   │   │
│  │         'aiAgentLogic.templateGatekeeper.currentSpend':         │   │
│  │           tier3Result.cost                                      │   │
│  │       }                                                         │   │
│  │     }                                                           │   │
│  │   );                                                            │   │
│  │                                                                 │   │
│  │   // Clear Redis cache (budget changed)                         │   │
│  │   await redisClient.del(`company:${company._id}:production-ai`);│   │
│  │                                                                 │   │
│  │   logger.info('Tier 3 LLM match', {                             │   │
│  │     confidence: tier3Result.confidence,                         │   │
│  │     cost: tier3Result.cost,                                     │   │
│  │     newSpend: gatekeeperConfig.currentSpend + tier3Result.cost  │   │
│  │   });                                                           │   │
│  │                                                                 │   │
│  │   return tier3Result;            // ✅ RETURN (LLM response)    │   │
│  │                                                                 │   │
│  │ } catch (error) {                                               │   │
│  │   // CHECKPOINT 9: Track LLM error                             │   │
│  │   await ProductionAIHealthMonitor.trackRoutingError(            │   │
│  │     company._id,                                                │   │
│  │     error,                                                      │   │
│  │     { stage: 'TIER_3_LLM', query }                              │   │
│  │   );                                                            │   │
│  │   return null;  // Will trigger fallback response              │   │
│  │ }                                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│           ↓                                                             │
│  ════════════════════════════════════════════════════════════════════   │
│  🆘 STEP 5: INTELLIGENT FALLBACK (If all tiers fail)                    │
│  ════════════════════════════════════════════════════════════════════   │
│  📂 File: services/IntelligentFallbackService.js (NEW!)                 │
│  📍 Method: selectResponse(company, context)                            │
│           ↓                                                             │
│  CODE:                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ // CHECKPOINT 10: Extract fallback config                       │   │
│  │ const fallbackConfig = company.aiAgentLogic.fallbackResponses;  │   │
│  │                                                                 │   │
│  │ // Determine fallback type (clarification vs no match vs error) │   │
│  │ const fallbackType = this.determineFallbackType(context);       │   │
│  │                                                                 │   │
│  │ // Get variations for this type                                 │   │
│  │ const variations = fallbackConfig[fallbackType];                │   │
│  │                                                                 │   │
│  │ // Rotate through variations (avoid repetition)                 │   │
│  │ const lastIndex = fallbackConfig.lastUsedIndex[fallbackType];   │   │
│  │ const nextIndex = (lastIndex + 1) % variations.length;          │   │
│  │                                                                 │   │
│  │ // Update rotation index (atomic)                               │   │
│  │ await Company.findByIdAndUpdate(company._id, {                  │   │
│  │   [`aiAgentLogic.fallbackResponses.lastUsedIndex.${fallbackType}`]│
│  │     : nextIndex                                                 │   │
│  │ });                                                             │   │
│  │                                                                 │   │
│  │ // Get response                                                 │   │
│  │ let response = variations[nextIndex];                           │   │
│  │                                                                 │   │
│  │ // CHECKPOINT 11: Send fallback notification (CRITICAL!)       │   │
│  │ await ProductionAIHealthMonitor.trackFallbackUsage(             │   │
│  │   company._id,                                                  │   │
│  │   fallbackType,                                                 │   │
│  │   context                                                       │   │
│  │ );                                                              │   │
│  │                                                                 │   │
│  │ return {                                                        │   │
│  │   response,                                                     │   │
│  │   fallbackType,                                                 │   │
│  │   requiresEscalation: this.shouldOfferEscalation(...)           │   │
│  │ };                                                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│           ↓                                                             │
│  🔔 Return response to customer via Twilio                              │
│  📊 Log call to v2AIAgentCallLog (for analytics)                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔑 KEY DATA FIELDS: WHERE AI CORE QUERIES THEM

### **1. Template Gatekeeper Settings**
```javascript
// Field Path:
company.aiAgentLogic.templateGatekeeper

// Used By:
services/TemplateGatekeeper.js

// Purpose:
Controls 3-tier routing thresholds, budget limits, LLM enable/disable

// Accessed In:
routes/v2twilio.js → v2priorityDrivenKnowledgeRouter.js → TemplateGatekeeper.js
```

### **2. Fallback Response Configuration**
```javascript
// Field Path:
company.aiAgentLogic.fallbackResponses

// Used By:
services/IntelligentFallbackService.js

// Purpose:
Defines response variations, tone, escalation options

// Accessed In:
TemplateGatekeeper.js (when all tiers fail) → IntelligentFallbackService.js
```

### **3. Learning Settings**
```javascript
// Field Path:
company.aiAgentLogic.learningSettings

// Used By:
services/PatternLearningService.js

// Purpose:
Controls auto-learning, pattern sharing, suggestion generation

// Accessed In:
v2AIAgentCallLog post-save hook → PatternLearningService.js
```

### **4. Template References**
```javascript
// Field Path:
company.aiAgentSettings.templateReferences

// Used By:
services/TemplateGatekeeper.js
services/v2priorityDrivenKnowledgeRouter.js

// Purpose:
Lists which templates this company uses (array of ObjectIds)

// Accessed In:
routes/v2twilio.js → Priority routing → TemplateGatekeeper.js
```

---

## ⚡ PERFORMANCE OPTIMIZATION: Redis Caching Strategy

### **Cache Keys Used:**

1. **Company Data Cache**
   ```javascript
   Key: `company:${companyId}:production-ai`
   TTL: 300 seconds (5 minutes)
   Invalidated: When company settings change, budget updates
   ```

2. **Template Data Cache**
   ```javascript
   Key: `templates:${companyId}`
   TTL: 600 seconds (10 minutes)
   Invalidated: When templates are edited in Global AI Brain
   ```

3. **LLM Health Status Cache**
   ```javascript
   Key: `production-ai:llm-health`
   TTL: 480 seconds (8 minutes - slightly less than health check interval)
   Invalidated: When health check runs
   ```

### **Cache Invalidation Triggers:**

| Event | Cache Key to Invalidate | Trigger Location |
|-------|-------------------------|------------------|
| Company settings updated | `company:${companyId}:production-ai` | `routes/v2company.js` (PATCH endpoint) |
| Budget spent (LLM call) | `company:${companyId}:production-ai` | `services/TemplateGatekeeper.js` (Tier 3) |
| Template edited | `templates:${companyId}` | `routes/admin/globalInstantResponses.js` |
| Monthly budget reset | `company:*:production-ai` (pattern) | `scripts/monthly-budget-reset.js` (cron) |

---

## 🚨 ERROR HANDLING: Graceful Degradation

### **Error Flow:**

```
Customer Query
    ↓
Tier 1 (Rule-Based) → ERROR? → Log + Continue to Tier 2
    ↓
Tier 2 (Semantic) → ERROR? → Log + Continue to Tier 3
    ↓
Tier 3 (LLM) → ERROR? → Log + Fallback
    ↓
Fallback Service → ERROR? → Emergency Response
    ↓
Emergency Response: "I'm experiencing technical difficulties. 
                     Let me transfer you to a live agent immediately."
```

### **Notification Triggers (Sent to Notification Center):**

| Error Type | Severity | Alert Code | Sent By |
|------------|----------|------------|---------|
| Company not found | CRITICAL | `PRODUCTION_AI_COMPANY_NOT_FOUND` | routes/v2twilio.js |
| Budget exceeded | CRITICAL | `PRODUCTION_AI_BUDGET_EXCEEDED` | TemplateGatekeeper.js |
| LLM connection down | CRITICAL | `PRODUCTION_AI_LLM_DOWN` | ProductionAIHealthMonitor.js |
| LLM response slow (>3s) | WARNING | `PRODUCTION_AI_LLM_SLOW` | ProductionAIHealthMonitor.js |
| Fallback used | WARNING | `PRODUCTION_AI_FALLBACK_USED` | IntelligentFallbackService.js |
| High fallback rate (>15%) | WARNING | `PRODUCTION_AI_FALLBACK_RATE_HIGH` | ProductionAIHealthMonitor.js |
| Routing error | CRITICAL | `PRODUCTION_AI_ROUTING_ERROR` | TemplateGatekeeper.js |
| Database error | CRITICAL | `PRODUCTION_AI_DATABASE_ERROR` | ProductionAIHealthMonitor.js |

---

## 🎯 SCALABILITY: Handling 100+ Companies Simultaneously

### **Design Principles:**

1. **Stateless Services**
   - All services are stateless (no in-memory state)
   - Can scale horizontally across multiple Node.js instances
   - Load balancer distributes calls evenly

2. **Database Connection Pooling**
   - Mongoose connection pool: 20 connections
   - Each call acquires connection → executes → releases
   - No blocking, no deadlocks

3. **Redis Caching**
   - Reduces database queries by 80%
   - Sub-5ms cache reads (vs. 50ms database reads)
   - Shared cache across all Node.js instances

4. **Asynchronous Processing**
   - All I/O operations use async/await
   - Non-blocking event loop
   - Concurrent call handling

5. **Circuit Breaker (OpenAI)**
   - If OpenAI is down, skip Tier 3 immediately
   - No wasted timeout waits
   - Graceful degradation to fallback

6. **Budget Tracking (Atomic Updates)**
   - Use MongoDB `$inc` operator (atomic)
   - No race conditions
   - Prevents budget overruns

---

## 🔒 DATA INTEGRITY: Critical Safeguards

### **1. Budget Overspend Prevention**
```javascript
// BEFORE calling OpenAI:
const currentBudget = await Company.findById(companyId)
  .select('aiAgentLogic.templateGatekeeper.currentSpend')
  .lean();

if (currentBudget.currentSpend + estimatedCost > monthlyBudget) {
  // BLOCK LLM call
  return null;
}

// AFTER successful LLM call (atomic update):
await Company.findByIdAndUpdate(companyId, {
  $inc: { 'aiAgentLogic.templateGatekeeper.currentSpend': actualCost }
});
```

### **2. Fallback Rotation (Prevent Same Response)**
```javascript
// Atomic increment with modulo wrap-around:
await Company.findByIdAndUpdate(companyId, {
  $inc: { 'aiAgentLogic.fallbackResponses.lastUsedIndex.noMatch': 1 }
});

// Application layer handles modulo:
const index = lastUsedIndex % variations.length;
```

### **3. Cache Invalidation (Prevent Stale Data)**
```javascript
// ALWAYS invalidate cache after write:
await Company.findByIdAndUpdate(companyId, { /* update */ });
await redisClient.del(`company:${companyId}:production-ai`);
```

---

## 📝 MAINTENANCE CHECKLIST

### **Weekly:**
- [ ] Review fallback usage rate (should be <10%)
- [ ] Check LLM health status (should be GREEN)
- [ ] Monitor budget consumption trends

### **Monthly:**
- [ ] Reset company budgets (automated via cron)
- [ ] Review notification alerts for patterns
- [ ] Audit cache hit rates (should be >80%)

### **Quarterly:**
- [ ] Review and update fallback response variations
- [ ] Analyze Tier 1/2/3 usage distribution
- [ ] Optimize confidence thresholds based on data

---

## 🆘 TROUBLESHOOTING GUIDE

### **Problem: High Fallback Rate (>15%)**
**Diagnosis:**
1. Check notification center for `PRODUCTION_AI_FALLBACK_RATE_HIGH` alerts
2. Review v2AIAgentCallLog for recent fallback queries
3. Identify common patterns in unmatched queries

**Fix:**
1. Use AI Suggestions in Global AI Brain to add missing scenarios
2. Lower Tier 1/2 thresholds temporarily
3. Increase LLM budget to allow more Tier 3 learning

---

### **Problem: LLM Connection Down**
**Diagnosis:**
1. Check notification center for `PRODUCTION_AI_LLM_DOWN` alert
2. Test connection manually via Production AI tab → "Test Connection" button
3. Review OpenAI API status page

**Fix:**
1. Verify `OPENAI_API_KEY` in environment variables
2. Check if budget/rate limits exceeded on OpenAI account
3. If OpenAI is down globally, wait for recovery (fallback responses active)

---

### **Problem: Budget Exceeded Mid-Month**
**Diagnosis:**
1. Check notification center for `PRODUCTION_AI_BUDGET_EXCEEDED` alert
2. Review company settings to see current spend vs. budget
3. Analyze which queries triggered Tier 3 (may indicate missing scenarios)

**Fix:**
1. Increase monthly budget in Production AI tab
2. Add scenarios to reduce Tier 3 usage
3. Temporarily disable LLM fallback (use Tier 1/2 + fallback responses only)

---

## 📞 SUPPORT CONTACTS

**For Code Issues:**
- Review this documentation first
- Check logs in `/logs/` directory
- Contact: Development Team

**For OpenAI API Issues:**
- OpenAI Status: https://status.openai.com
- API Dashboard: https://platform.openai.com

**For MongoDB/Redis Issues:**
- MongoDB Atlas Dashboard
- Redis Cloud Dashboard

---

**End of Documentation**

