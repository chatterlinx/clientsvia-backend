# PRODUCTION AI - INTEGRATION MAP v1.0

**Date:** October 29, 2025  
**Purpose:** Visual map of EVERY data flow, API connection, and system integration  
**Approval Required:** Marc (ClientsVia.ai)  

---

## 🎯 SYSTEM OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────┐
│                     PRODUCTION AI SYSTEM                            │
│                                                                     │
│  [Admin UI] → [Backend APIs] → [Services] → [Database] → [Cache]  │
│       ↓              ↓             ↓            ↓           ↓       │
│  [Templates] [Test Pilot] [Notification Center] [Redis] [MongoDB]  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📊 DATA FLOW #1: VIEWING PRODUCTION AI TAB

```
1. USER ACTION: Clicks "Production AI" sub-tab in Overview
   ↓
2. FRONTEND: switchOverviewSubTab('production-ai')
   ↓
3. FRONTEND: productionAIManager.initialize()
   ↓
4. PARALLEL API CALLS:
   ├─→ GET /api/admin/production-ai/health/openai
   │   ├─ Backend: DependencyHealthMonitor.checkOpenAI()
   │   ├─ Checks: OpenAI API connectivity
   │   ├─ Returns: { status: 'healthy' | 'not_configured' | 'error', responseTime: 123, ... }
   │   └─ Updates: LLM health card in UI
   │
   ├─→ GET /api/admin/production-ai/health/full
   │   ├─ Backend: DependencyHealthMonitor.checkAll()
   │   ├─ Checks: MongoDB, Redis, OpenAI, 3-Tier System
   │   ├─ Returns: { llm: {...}, db: {...}, redis: {...}, tierSystem: {...} }
   │   └─ Updates: All 4 health cards in UI
   │
   └─→ GET /api/admin/production-ai/suggestions/stats
       ├─ Backend: Query SuggestionKnowledgeBase.countDocuments()
       ├─ Returns: { pending: 12, applied: 45, ignored: 3 }
       └─ Updates: Stats bar in UI
   ↓
5. FRONTEND: Renders suggestions queue
   ↓
6. API CALL: GET /api/admin/production-ai/suggestions/:templateId?page=1&limit=10
   ├─ Backend: Query SuggestionKnowledgeBase
   │   ├─ Filter: templateId (if provided), status: 'pending'
   │   ├─ Sort: priority DESC, createdAt DESC
   │   ├─ Limit: 10
   │   ├─ Populate: callLogId, companyId, templateId
   │   └─ Returns: Array of suggestion objects
   ↓
7. FRONTEND: Renders 10 suggestion cards
   ↓
8. AUTO-REFRESH: Starts 30s interval for health status
```

---

## 📊 DATA FLOW #2: PRODUCTION CALL LOGGING

```
1. TRIGGER: Production call completed in routes/v2twilio.js
   ↓
2. BACKEND: After AI agent responds to caller
   ├─ Collect data:
   │  ├─ Full transcript (caller + agent)
   │  ├─ Tier 1 result (confidence, matched, reason)
   │  ├─ Tier 2 result (confidence, matched, reason)
   │  ├─ Tier 3 result (confidence, matched, reason, cost, model)
   │  ├─ Final response sent to caller
   │  ├─ Response time (milliseconds)
   │  ├─ Total cost (dollars)
   │  └─ Metadata (companyId, templateId, categoryId, scenarioId, callerPhone)
   ↓
3. API CALL: POST /api/admin/production-ai/call-logs
   ├─ Request body: All collected data
   ├─ Backend: Create new ProductionAICallLog document
   ├─ Save to MongoDB
   └─ Returns: { success: true, callLogId: '...' }
   ↓
4. CONDITIONAL: If tierUsed === 3 (LLM fallback)
   ├─ Set: analyzed = false (marks for background processing)
   └─ Queue: For LLM suggestion analysis
   ↓
5. NOTIFICATION: If critical issues detected
   └─ Send: PRODUCTION_AI_CALL_LOGGED notification
```

---

## 📊 DATA FLOW #3: LLM SUGGESTION GENERATION (Background)

```
1. TRIGGER: Cron job runs every 5 minutes
   ↓
2. BACKEND: LLMSuggestionAnalyzer service
   ├─ Query: ProductionAICallLog.find({ tierUsed: 3, analyzed: false }).limit(10)
   └─ Returns: Array of call logs to analyze
   ↓
3. FOR EACH CALL LOG:
   ↓
   3.1. EXTRACT DATA:
        ├─ Full transcript
        ├─ Tier 1/2/3 results
        ├─ LLM reasoning
        └─ Context (company, template, category, scenario)
   ↓
   3.2. API CALL: OpenAI GPT-4
        ├─ Prompt: "Analyze this call and suggest improvements..."
        ├─ Request: { model: 'gpt-4-turbo', messages: [...], response_format: { type: 'json' } }
        └─ Response: JSON with improvements
   ↓
   3.3. PARSE LLM RESPONSE:
        ├─ Extract: fillerWords[], synonymMappings[], keywordsToAdd{}, negativeKeywords{}, missingScenario{}
        ├─ Extract: reasoning (full explanation)
        └─ Extract: impact { similarCallsThisMonth, estimatedMonthlySavings, performanceGain }
   ↓
   3.4. CREATE SUGGESTION:
        ├─ Model: SuggestionKnowledgeBase.create({...})
        ├─ Fields:
        │  ├─ companyId, templateId, categoryId, scenarioId
        │  ├─ callLogId (reference)
        │  ├─ type: 'filler-words' | 'synonym' | 'keywords' | 'negative-keywords' | 'missing-scenario'
        │  ├─ priority: 'high' | 'medium' | 'low' (based on impact)
        │  ├─ confidence: 0.XX
        │  ├─ improvements: { ... } (parsed LLM response)
        │  ├─ llmReasoning: "..." (full text)
        │  ├─ llmModel: "gpt-4-turbo"
        │  ├─ llmCost: 0.XX
        │  ├─ impact: { ... }
        │  ├─ status: 'pending'
        │  └─ timestamps
        └─ Save to MongoDB
   ↓
   3.5. UPDATE CALL LOG:
        ├─ ProductionAICallLog.updateOne({ _id: callLogId }, { analyzed: true, suggestionsGenerated: true })
        └─ Prevents re-analysis
   ↓
   3.6. NOTIFICATION: If high-priority suggestion
        ├─ Code: PRODUCTION_AI_SUGGESTION_HIGH_PRIORITY
        ├─ Severity: WARNING
        ├─ Message: "New high-priority suggestion: [brief description]"
        ├─ Details: { callLogId, suggestionId, templateId, estimatedSavings }
        ├─ Action: Link to suggestion modal
        └─ Send: Via AdminNotificationService
   ↓
4. ERROR HANDLING:
   ├─ If OpenAI fails: Retry 3x with exponential backoff
   ├─ If 3rd failure: Log to Notification Center (PRODUCTION_AI_ANALYSIS_FAILED)
   └─ Continue to next call log
```

---

## 📊 DATA FLOW #4: VIEWING SUGGESTION DETAILS

```
1. USER ACTION: Clicks "View Full Details" on suggestion card
   ↓
2. FRONTEND: openSuggestionModal(suggestionId)
   ↓
3. API CALL: GET /api/admin/production-ai/suggestions/:suggestionId/details
   ├─ Backend: SuggestionKnowledgeBase.findById(suggestionId)
   │   ├─ Populate: callLogId (full ProductionAICallLog)
   │   ├─ Populate: companyId (Company name)
   │   ├─ Populate: templateId (Template name)
   │   ├─ Populate: categoryId (Category name)
   │   ├─ Populate: scenarioId (Scenario name)
   │   └─ Populate: relatedSuggestions (top 3)
   ├─ Calculate: ROI metrics (current vs projected tier usage, savings)
   └─ Returns: Full suggestion object
   ↓
4. FRONTEND: SuggestionAnalysisModal.render()
   ├─ Render: Call details panel
   ├─ Render: Quick actions buttons
   ├─ Render: Full transcript
   ├─ Render: Routing flow visualization
   ├─ Render: LLM reasoning & analysis
   ├─ Render: Suggested improvements (up to 5 cards)
   ├─ Render: Impact analysis & ROI
   └─ Render: Related suggestions
   ↓
5. MODAL DISPLAYED: Full screen overlay
```

---

## 📊 DATA FLOW #5: APPLYING A SUGGESTION

```
1. USER ACTION: Clicks "Apply" button on improvement card
   ↓
2. FRONTEND: applyImprovement(suggestionId, improvementType)
   ├─ Show: Toast "Applying improvement..."
   ├─ Disable: Button (prevent double-click)
   └─ Prepare: Request payload
   ↓
3. API CALL: POST /api/admin/production-ai/suggestions/:suggestionId/apply
   ├─ Request body:
   │  ├─ type: 'filler-words' | 'synonym' | 'keywords' | 'negative-keywords' | 'create-scenario'
   │  └─ data: { ... } (improvement-specific data)
   ├─ Headers:
   │  ├─ Authorization: Bearer <token>
   │  └─ X-Idempotency-Key: <uuid> (prevents duplicates)
   ↓
4. BACKEND: routes/admin/productionAI.js
   ├─ Middleware:
   │  ├─ authenticateJWT (verify admin)
   │  ├─ adminOnly (ensure admin role)
   │  ├─ captureAuditInfo (log who applied)
   │  ├─ requireIdempotency (prevent double-apply)
   │  └─ configWriteRateLimit (prevent spam)
   ↓
5. VALIDATION:
   ├─ Check: Suggestion exists
   ├─ Check: Suggestion status is 'pending'
   ├─ Check: Improvement type is valid
   └─ Check: Data payload is complete
   ↓
6. APPLY IMPROVEMENT (based on type):

   ┌─ IF TYPE = 'filler-words' ─────────────────────────────┐
   │  1. Get template: GlobalInstantResponseTemplate.findById(templateId)
   │  2. Get existing fillers: template.fillerWords || []
   │  3. Merge new fillers: [...existing, ...new].filter(unique)
   │  4. Update: template.fillerWords = merged
   │  5. Save: template.save()
   │  6. Clear cache: redisClient.del(`template:${templateId}`)
   └────────────────────────────────────────────────────────┘

   ┌─ IF TYPE = 'synonym' ───────────────────────────────────┐
   │  1. Get category: v2TradeCategory.findById(categoryId)
   │  2. Get existing synonyms: category.synonymMappings || {}
   │  3. Add new synonym: synonyms[technical] = [...colloquial]
   │  4. Update: category.synonymMappings = updated
   │  5. Save: category.save()
   │  6. Clear cache: redisClient.del(`category:${categoryId}`)
   └────────────────────────────────────────────────────────┘

   ┌─ IF TYPE = 'keywords' ──────────────────────────────────┐
   │  1. Get scenario: v2Template.findById(scenarioId)
   │  2. Get existing keywords: scenario.keywords || []
   │  3. Merge new keywords: [...existing, ...new].filter(unique)
   │  4. Update: scenario.keywords = merged
   │  5. Save: scenario.save()
   │  6. Clear cache: redisClient.del(`scenario:${scenarioId}`)
   └────────────────────────────────────────────────────────┘

   ┌─ IF TYPE = 'negative-keywords' ─────────────────────────┐
   │  1. Get scenario: v2Template.findById(scenarioId)
   │  2. Get existing: scenario.negativeKeywords || []
   │  3. Merge: [...existing, ...new].filter(unique)
   │  4. Update: scenario.negativeKeywords = merged
   │  5. Save: scenario.save()
   │  6. Clear cache: redisClient.del(`scenario:${scenarioId}`)
   └────────────────────────────────────────────────────────┘

   ┌─ IF TYPE = 'create-scenario' ───────────────────────────┐
   │  1. Create new scenario: v2Template.create({
   │       name: suggestedName,
   │       category: suggestedCategory,
   │       keywords: suggestedKeywords,
   │       negativeKeywords: suggestedNegativeKeywords,
   │       response: suggestedResponse,
   │       actionHook: suggestedActionHook,
   │       behavior: suggestedBehavior,
   │       priority: 5 (default),
   │       isActive: true
   │     })
   │  2. Save: scenario.save()
   │  3. Clear cache: redisClient.del(`template:${templateId}`)
   └────────────────────────────────────────────────────────┘

   ↓
7. UPDATE SUGGESTION STATUS:
   ├─ SuggestionKnowledgeBase.updateOne({ _id: suggestionId }, {
   │    status: 'applied',
   │    appliedAt: new Date(),
   │    appliedBy: req.user._id
   │  })
   └─ Save
   ↓
8. NOTIFICATION:
   ├─ Code: PRODUCTION_AI_SUGGESTION_APPLIED
   ├─ Severity: INFO
   ├─ Message: "Suggestion applied: [type] for template [name]"
   ├─ Details: { suggestionId, templateId, appliedBy, changes }
   └─ Send: Via AdminNotificationService
   ↓
9. RESPONSE TO FRONTEND:
   ├─ Status: 200
   └─ Body: { success: true, updated: {...} }
   ↓
10. FRONTEND:
    ├─ Show: Toast "✓ Improvement applied successfully"
    ├─ Update: Button text to "✓ Applied" (disabled)
    ├─ Update: Stats bar (Pending -1, Applied +1)
    └─ Update: Related UI elements
```

---

## 📊 DATA FLOW #6: IGNORING A SUGGESTION

```
1. USER ACTION: Clicks "Ignore" button
   ↓
2. FRONTEND: ignoreSuggestion(suggestionId)
   ↓
3. API CALL: POST /api/admin/production-ai/suggestions/:suggestionId/ignore
   ├─ Backend: SuggestionKnowledgeBase.updateOne({ _id: suggestionId }, {
   │    status: 'ignored',
   │    ignoredAt: new Date(),
   │    ignoredBy: req.user._id
   │  })
   └─ Returns: { success: true }
   ↓
4. FRONTEND:
   ├─ Show: Toast "Suggestion ignored"
   ├─ Remove: Suggestion card from queue
   └─ Update: Stats bar (Pending -1, Ignored +1)
```

---

## 📊 DATA FLOW #7: TEST PILOT INTEGRATION

```
1. USER ACTION: Enters test query in Test Pilot
   ↓
2. FRONTEND: POST /api/twilio/test-respond/:templateId
   ├─ Request body: { query: "..." }
   ↓
3. BACKEND: routes/v2twilio.js (test-respond endpoint)
   ├─ Run: 3-tier intelligence routing
   │  ├─ Tier 1: Rule-based matching
   │  ├─ Tier 2: Semantic similarity
   │  └─ Tier 3: LLM fallback (if needed)
   ├─ Collect: Full results (tier used, confidence, response, cost)
   ↓
4. LOG TO PRODUCTION AI:
   ├─ API CALL: POST /api/admin/production-ai/call-logs
   │  ├─ Same as production calls
   │  ├─ Additional field: isTest = true
   │  └─ Marks for analysis (if Tier 3 used)
   ↓
5. RESPONSE TO FRONTEND:
   ├─ Show: Test results panel
   ├─ Show: Tier used ("Matched via Tier 1 (Rule-Based)")
   ├─ Show: Confidence, response time, cost
   └─ Show: "Generate Suggestion" button (if Tier 3 used)
   ↓
6. OPTIONAL: User clicks "Generate Suggestion"
   ├─ Frontend: generateSuggestionFromTest(callLogId)
   ├─ API CALL: POST /api/admin/production-ai/analyze-now/:callLogId
   │  ├─ Backend: LLMSuggestionAnalyzer.analyzeCall() immediately
   │  └─ Returns: { suggestionId }
   ├─ Show: Toast "Suggestion created"
   └─ Show: Link "View Suggestion" (opens modal)
```

---

## 📊 DATA FLOW #8: TEMPLATE TAB INTEGRATION

```
1. USER LOCATION: Templates tab in Overview
   ↓
2. EACH TEMPLATE CARD:
   ├─ Render: Template name, category count, scenario count
   └─ Render: "⚙️ Production AI" button (last column)
   ↓
3. USER ACTION: Clicks "Production AI" button
   ↓
4. FRONTEND: navigateToProductionAI(templateId)
   ├─ Switch to: Overview tab
   ├─ Switch to: Production AI sub-tab
   ├─ Set: Template selector to this templateId
   ├─ Load: Suggestions for this template
   └─ Scroll to: Suggestions queue section
```

---

## 📊 DATA FLOW #9: NOTIFICATION CENTER INTEGRATION

```
1. TRIGGER: Any of these events:
   ├─ High-priority suggestion created
   ├─ Suggestion applied successfully
   ├─ LLM analysis failed after 3 retries
   ├─ OpenAI connection lost
   └─ Budget threshold exceeded
   ↓
2. BACKEND: AdminNotificationService.sendNotification()
   ├─ Create: NotificationLog document
   │  ├─ code: 'PRODUCTION_AI_...'
   │  ├─ severity: 'INFO' | 'WARNING' | 'CRITICAL'
   │  ├─ message: "..."
   │  ├─ details: { ... }
   │  ├─ actionLink: '/admin-global-instant-responses.html#production-ai'
   │  └─ timestamps
   ├─ Check: NotificationRegistry for email/SMS rules
   └─ Send: Email/SMS if configured
   ↓
3. NOTIFICATION CENTER UI:
   ├─ Shows: Alert in list
   ├─ Badge: Alert type icon
   ├─ Link: Clicks → navigates to Production AI tab
   └─ Action: "View Suggestion" (opens modal)
```

---

## 🗄️ DATABASE SCHEMA CONNECTIONS

```
┌──────────────────────────────────────────────────────────────────┐
│ GlobalInstantResponseTemplate (Templates)                       │
│ ├─ _id (ObjectId)                                               │
│ ├─ name (String)                                                │
│ ├─ fillerWords (Array) ← UPDATED BY SUGGESTIONS                 │
│ ├─ learningSettings (Object)                                    │
│ └─ ... other fields                                             │
└──────────────────────────────────────────────────────────────────┘
         ↑                          ↑
         │                          │
         │ Referenced by            │ Referenced by
         │                          │
┌────────┴──────────────┐  ┌────────┴──────────────────────────────┐
│ v2TradeCategory       │  │ v2Template (Scenarios)                │
│ ├─ _id                │  │ ├─ _id                                │
│ ├─ name               │  │ ├─ name                               │
│ ├─ templateId ────────┘  │ ├─ categoryId ──→ v2TradeCategory    │
│ ├─ synonymMappings    │  │ ├─ keywords ← UPDATED BY SUGGESTIONS │
│ │  (Object) ←───────────┼─┤ ├─ negativeKeywords ← UPDATED       │
│ └─ ...                │  │ └─ ...                                │
└───────────────────────┘  └───────────────────────────────────────┘
         ↑                          ↑
         │                          │
         │ Referenced by            │ Referenced by
         │                          │
┌────────┴────────────────────────┬─┴───────────────────────────────┐
│ SuggestionKnowledgeBase         │                                 │
│ ├─ _id (ObjectId)               │                                 │
│ ├─ templateId ──────────────────┼─→ GlobalInstantResponseTemplate│
│ ├─ categoryId ──────────────────┼─→ v2TradeCategory              │
│ ├─ scenarioId ──────────────────┼─→ v2Template                   │
│ ├─ callLogId ───────────────────┼─→ ProductionAICallLog          │
│ ├─ type (String)                │                                 │
│ ├─ priority (String)            │                                 │
│ ├─ confidence (Number)          │                                 │
│ ├─ improvements (Object)        │                                 │
│ ├─ llmReasoning (String)        │                                 │
│ ├─ impact (Object)              │                                 │
│ ├─ status (String) ← 'pending', 'applied', 'ignored'             │
│ ├─ appliedAt (Date)             │                                 │
│ ├─ appliedBy (ObjectId) ────────┼─→ v2User                       │
│ └─ relatedSuggestions (Array)   │                                 │
└─────────────────────────────────┴─────────────────────────────────┘
         ↑
         │ Referenced by
         │
┌────────┴────────────────────────┐
│ ProductionAICallLog             │
│ ├─ _id (ObjectId)               │
│ ├─ companyId ─────────────────→ v2Company                        │
│ ├─ templateId ─────────────────→ GlobalInstantResponseTemplate   │
│ ├─ callId (String)              │
│ ├─ transcript (String)          │
│ ├─ tierUsed (Number)            │
│ ├─ tier1Result (Object)         │
│ ├─ tier2Result (Object)         │
│ ├─ tier3Result (Object)         │
│ ├─ responseTime (Number)        │
│ ├─ cost (Number)                │
│ ├─ analyzed (Boolean)           │
│ ├─ suggestionsGenerated (Bool) │
│ └─ timestamp (Date, TTL: 90d)   │
└─────────────────────────────────┘
```

---

## 🔌 API ENDPOINT SUMMARY

| Endpoint | Method | Purpose | Returns |
|----------|--------|---------|---------|
| `/api/admin/production-ai/health/openai` | GET | Check LLM connection | `{ status, responseTime, ... }` |
| `/api/admin/production-ai/health/full` | GET | Check all dependencies | `{ llm, db, redis, tierSystem }` |
| `/api/admin/production-ai/suggestions/stats` | GET | Get suggestion counts | `{ pending, applied, ignored }` |
| `/api/admin/production-ai/suggestions/:templateId` | GET | List suggestions for template | `[{...}, {...}, ...]` |
| `/api/admin/production-ai/suggestions/:id/details` | GET | Get full suggestion details | `{ ... full object ... }` |
| `/api/admin/production-ai/suggestions/:id/apply` | POST | Apply a suggestion | `{ success, updated }` |
| `/api/admin/production-ai/suggestions/:id/ignore` | POST | Ignore a suggestion | `{ success }` |
| `/api/admin/production-ai/call-logs` | POST | Store production call log | `{ success, callLogId }` |
| `/api/admin/production-ai/analyze-now/:callLogId` | POST | Trigger immediate analysis | `{ suggestionId }` |

---

## 🔐 REDIS CACHE STRATEGY

```
Cache Keys:
├─ template:{templateId}              ← Cleared when filler words added
├─ category:{categoryId}              ← Cleared when synonyms added
├─ scenario:{scenarioId}              ← Cleared when keywords/negatives added
├─ production-ai:suggestions:{templateId}  ← 60s TTL
└─ production-ai:health                    ← 30s TTL

Cache Invalidation Triggers:
├─ Suggestion applied → Clear relevant template/category/scenario cache
├─ Template edited manually → Clear template:{id}
└─ Category edited manually → Clear category:{id}
```

---

## 🔔 NOTIFICATION CENTER ALERT CODES

| Alert Code | Severity | Trigger | Action |
|------------|----------|---------|--------|
| `PRODUCTION_AI_SUGGESTION_HIGH_PRIORITY` | WARNING | High-priority suggestion created | View suggestion modal |
| `PRODUCTION_AI_SUGGESTION_APPLIED` | INFO | Admin applies suggestion | View change log |
| `PRODUCTION_AI_ANALYSIS_FAILED` | CRITICAL | LLM analysis fails 3x | Manual review call log |
| `PRODUCTION_AI_OPENAI_DOWN` | CRITICAL | OpenAI API unreachable | Check API status |
| `PRODUCTION_AI_BUDGET_THRESHOLD` | WARNING | 80% of monthly budget used | Review usage |
| `PRODUCTION_AI_CALL_LOGGED` | INFO | Production call stored | (No action needed) |

---

## 🧪 TESTING DATA FLOWS

**Test Flow #1: Create Suggestion from Test Pilot**
```
Test Pilot → Test Query → Tier 3 LLM → Call Log → "Generate Suggestion" → 
Analyze Call → Create Suggestion → View in Production AI → Apply → 
Verify Template Updated → Verify Cache Cleared → Verify Notification Sent
```

**Test Flow #2: Apply Filler Words**
```
Production AI → Suggestion Card → "View Details" → Modal → 
"Apply Filler Words" → API Call → Database Update → Cache Clear → 
Toast Shown → Button Disabled → Stats Updated → Notification Sent
```

**Test Flow #3: Template Tab Integration**
```
Templates Tab → Template Card → "Production AI" Button → 
Navigate to Production AI → Template Selector Pre-filled → 
Suggestions Loaded for Template → Verify Correct Suggestions Shown
```

---

## ✅ INTEGRATION CHECKLIST

- [ ] All API endpoints return correct data structure
- [ ] All database references (ObjectIds) are valid
- [ ] All Redis cache keys are cleared when data changes
- [ ] All notifications are sent to Notification Center
- [ ] All frontend API calls include auth token
- [ ] All backend endpoints have proper middleware (auth, audit, rate limit)
- [ ] All error cases send alerts to Notification Center
- [ ] Test Pilot logs to ProductionAICallLogs
- [ ] Templates tab links to Production AI
- [ ] Notification Center links to Production AI

---

**END OF INTEGRATION MAP**

