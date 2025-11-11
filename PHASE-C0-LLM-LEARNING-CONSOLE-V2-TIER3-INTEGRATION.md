# PHASE C.0 – LLM Learning Console v2 ← Tier-3 Integration

**Status:** SPECIFICATION READY FOR IMPLEMENTATION  
**Date:** 2025-11-11  
**Tier-3 Version:** Phase A.5 (produces `{ success, matched, scenario, confidence, rationale, performance }`)

---

## 🎯 GOAL

When Tier-3 has to rescue a call (because Tier1/Tier2 failed), automatically capture that event and feed it into LLM Learning Console v2 as high-quality coaching suggestions.

**What changes:**
- ✅ Tier-3 calls create `LLMLearningTask` events
- ✅ Background worker converts tasks → `AIGatewaySuggestion` docs
- ✅ Console v2 UI shows suggestions from real live calls
- ✅ Apply/Reject flows let admins refine templates

**What does NOT change:**
- Runtime routing behavior
- Scenario LLM Assistant
- Admin form builder
- ResponseEngine or Twilio behavior

---

## 📋 IMPLEMENTATION CHECKLIST

### STEP 1: Create LLMLearningTask Model
- [ ] File: `models/LLMLearningTask.js`
- [ ] Fields per spec below
- [ ] Indexes for performance
- [ ] Exports singleton model

### STEP 2: Capture Tier-3 Events in IntelligentRouter
- [ ] File: `services/IntelligentRouter.js`
- [ ] When `tierUsed === 3` and `tier3Result.matched === true`
- [ ] Create `LLMLearningTask` with complete context
- [ ] Wrap in try/catch (non-blocking)

### STEP 3: Create Background Worker
- [ ] File: `services/LLMLearningWorker.js`
- [ ] Or: `jobs/llmLearningWorker.js`
- [ ] Processes PENDING → PROCESSING → DONE
- [ ] Calls OpenAI to generate suggestions
- [ ] Creates `AIGatewaySuggestion` docs
- [ ] Handles errors gracefully

### STEP 4: Integrate Worker into Server Startup
- [ ] File: `index.js` or `server.js`
- [ ] Start worker on app init
- [ ] Or: Register as cron job (e.g., every 30 seconds)

### STEP 5: Wire Suggestions into Console v2
- [ ] File: `routes/admin/llmLearningV2.js`
- [ ] Update `/v2/suggestions` endpoint
- [ ] Map `AIGatewaySuggestion` fields → UI columns
- [ ] Filter by template, company, source, status

### STEP 6: Implement Apply/Reject Handlers
- [ ] File: `routes/admin/llmLearningV2.js`
- [ ] POST `/suggestions/:id/apply`
- [ ] POST `/suggestions/:id/reject`
- [ ] Modify scenarios based on issueCode

### STEP 7: Testing
- [ ] Force a Tier-3 call
- [ ] Verify LLMLearningTask is created
- [ ] Run worker manually or wait for cron
- [ ] Verify `AIGatewaySuggestion` appears in console v2
- [ ] Test Apply flow

---

## 📐 DETAILED SPECIFICATIONS

### 1. LLMLearningTask Model

**File:** `models/LLMLearningTask.js`

```javascript
const Schema = {
  _id: ObjectId,
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED',
  createdAt: Date,
  updatedAt: Date,

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CORE IDENTIFIERS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  templateId: ObjectId (ref: GlobalInstantResponseTemplate),
  companyId: ObjectId (ref: v2Company) [optional],
  callId: String (Twilio CallSid or internal),
  callSource: 'voice' | 'sms' | 'chat',

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TIER ROUTING DATA
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  tierPath: String,               // e.g., "T1 -> T2 -> T3"
  tier1Score: Number | null,
  tier1Threshold: Number | null,
  tier2Score: Number | null,
  tier2Threshold: Number | null,

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TIER-3 DATA (from Tier3LLMFallback)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  tier3Confidence: Number,        // 0–1
  tier3Rationale: String,         // "Matched on 'hours' trigger..."
  tier3LatencyMs: Number,         // response time
  tier3Tokens: Number,            // OpenAI tokens used
  tier3Cost: Number,              // $ spent

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CALL CONTEXT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  primaryUtterance: String,       // main caller input
  chosenScenarioId: ObjectId | null,   // what Tier-3 picked

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // WORKER OUTPUT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  suggestionsCreatedCount: Number,      // how many Suggestions were generated
  suggestionsCreatedIds: [ObjectId],    // links to AIGatewaySuggestion docs
  workerError: String,                  // if status=FAILED, error message
  processedAt: Date,
}
```

**Indexes:**
```javascript
{ status: 1, createdAt: -1 }        // For worker to find PENDING
{ templateId: 1, status: 1 }        // For filtering by template
{ companyId: 1, status: 1 }         // For filtering by company
```

---

### 2. Tier-3 Event Capture

**File:** `services/IntelligentRouter.js`

**Location:** Right after Tier-3 returns, if `tierUsed === 3` and scenario matched:

```javascript
// Pseudo-code:
if (tier3Result.success && tier3Result.matched) {
  // ... existing minConfidence check + scenario selection ...

  // ✅ NEW: Capture event for LLM Learning Console
  if (result.tierUsed === 3) {
    try {
      const LLMLearningTask = require('./models/LLMLearningTask');
      
      await LLMLearningTask.create({
        status: 'PENDING',
        templateId: template._id,
        companyId: company?._id || null,
        callId: callSid,        // from context
        callSource: channel,    // 'voice', 'sms', 'chat'
        
        tierPath: `T1 (${tier1Score?.toFixed(2)}) -> T2 (${tier2Score?.toFixed(2)}) -> T3`,
        tier1Score: tier1Score || null,
        tier1Threshold: tier1Threshold || null,
        tier2Score: tier2Score || null,
        tier2Threshold: tier2Threshold || null,
        
        tier3Confidence: tier3Result.confidence,
        tier3Rationale: tier3Result.rationale,
        tier3LatencyMs: tier3Result.performance?.responseTime,
        tier3Tokens: tier3Result.performance?.tokens,
        tier3Cost: tier3Result.performance?.cost,
        
        primaryUtterance: callerInput || '',
        chosenScenarioId: tier3Result.scenario?._id || tier3Result.scenario?.scenarioId || null,
      });
      
      logger.info('[LLM LEARNING] Task created for Tier-3 event', {
        callId,
        templateId: template._id,
        tier3Confidence: tier3Result.confidence,
      });
    } catch (err) {
      logger.error('[LLM LEARNING] Failed to create task', {
        error: err.message,
        callId,
      });
      // ✅ DO NOT IMPACT CALL: continue as normal
    }
  }
}
```

---

### 3. Background Worker

**File:** `services/LLMLearningWorker.js`

**High-level flow:**

```javascript
class LLMLearningWorker {
  constructor() {
    this.processing = false;
    this.batchSize = 20;
  }

  start(intervalMs = 30000) {
    setInterval(() => this.processPendingTasks(), intervalMs);
    logger.info('[LLM LEARNING WORKER] Started');
  }

  async processPendingTasks() {
    if (this.processing) return;
    this.processing = true;

    try {
      // 1. Find PENDING tasks
      const tasks = await LLMLearningTask.find({ status: 'PENDING' })
        .sort({ createdAt: 1 })
        .limit(this.batchSize);

      if (tasks.length === 0) {
        this.processing = false;
        return;
      }

      // 2. Process each task
      for (const task of tasks) {
        await this.processTask(task);
      }
    } catch (err) {
      logger.error('[LLM LEARNING WORKER] Batch error', err);
    } finally {
      this.processing = false;
    }
  }

  async processTask(task) {
    try {
      task.status = 'PROCESSING';
      await task.save();

      // 1. Gather context
      const template = await GlobalInstantResponseTemplate.findById(task.templateId);
      const scenarios = template?.scenarios || [];
      const callTrace = await CallTrace.findOne({ callId: task.callId }); // if it exists

      // 2. Build LLM prompt
      const prompt = this.buildSuggestionPrompt({
        template,
        task,
        scenarios,
        callTrace,
      });

      // 3. Call OpenAI
      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: `You are an AI QA coach for ClientsVia's 3-tier router...`,
          },
          { role: 'user', content: prompt },
        ],
      });

      const parsed = JSON.parse(completion.choices[0].message.content);

      // 4. Create AIGatewaySuggestion docs for each suggestion
      const suggestionIds = [];
      for (const suggestion of parsed.suggestions || []) {
        const doc = await AIGatewaySuggestion.create({
          type: this.mapIssueCodeToType(suggestion.issueCode),
          templateId: task.templateId,
          companyId: task.companyId,
          callLogId: task._id,  // link back to task
          
          priority: suggestion.severity || 'medium',
          confidence: 0.7,  // confidence in the suggestion itself
          status: 'pending',
          
          llmReasoning: suggestion.details,
          llmModel: 'gpt-4o-mini',
          llmCost: (completion.usage.total_tokens / 1_000_000) * 0.015,  // rough estimate
          
          // Type-specific fields
          [this.getFieldNameForIssueCode(suggestion.issueCode)]: suggestion.suggestedKeywords || [],
          scenarioId: suggestion.targetScenarioId || null,
          
          impact: {
            affectedCalls: 1,  // start with 1, aggregate later
            similarCallsThisMonth: 1,
          },
        });
        
        suggestionIds.push(doc._id);
      }

      // 5. Mark task as DONE
      task.status = 'DONE';
      task.suggestionsCreatedCount = suggestionIds.length;
      task.suggestionsCreatedIds = suggestionIds;
      task.processedAt = new Date();
      await task.save();

      logger.info('[LLM LEARNING WORKER] Task processed', {
        taskId: task._id,
        suggestionsCount: suggestionIds.length,
      });
    } catch (err) {
      task.status = 'FAILED';
      task.workerError = err.message;
      await task.save();
      logger.error('[LLM LEARNING WORKER] Task failed', { taskId: task._id, error: err.message });
    }
  }

  buildSuggestionPrompt(context) {
    // Build a human-readable prompt that includes:
    // - Template info
    // - Tier path + scores
    // - Tier-3 rationale
    // - Caller utterance
    // - Scenario list (id, name, triggers, negatives)
    return `...`;  // Full prompt in implementation
  }

  mapIssueCodeToType(issueCode) {
    const mapping = {
      'ADD_KEYWORDS': 'keywords',
      'ADD_SYNONYMS': 'synonym',
      'TIGHTEN_NEGATIVE_TRIGGERS': 'negative-keywords',
      'SPLIT_SCENARIO': 'missing-scenario',
      'ADD_NEW_SCENARIO': 'missing-scenario',
    };
    return mapping[issueCode] || 'keywords';
  }

  getFieldNameForIssueCode(issueCode) {
    if (issueCode === 'ADD_KEYWORDS') return 'suggestedKeywords';
    if (issueCode === 'TIGHTEN_NEGATIVE_TRIGGERS') return 'suggestedNegativeKeywords';
    if (issueCode === 'ADD_SYNONYMS') return 'synonymMapping';
    return 'suggestedKeywords';
  }
}

module.exports = new LLMLearningWorker();
```

---

### 4. Wire Worker into Server

**File:** `index.js` or `server.js`

```javascript
const LLMLearningWorker = require('./services/LLMLearningWorker');

// After server starts listening:
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  
  // ✅ Start LLM Learning Worker
  LLMLearningWorker.start(30000);  // Check every 30 seconds
});
```

---

### 5. Update Console v2 Routes

**File:** `routes/admin/llmLearningV2.js`

**Update `/v2/suggestions` endpoint:**

```javascript
router.get('/v2/suggestions', async (req, res) => {
  try {
    const { templateId, companyId, status, callSource } = req.query;
    
    // Build query from Tier-3 data
    const query = {};
    if (templateId) query.templateId = templateId;
    if (companyId) query.companyId = companyId;
    if (status) query.status = status;
    if (callSource) query.callSource = callSource;
    
    // Fetch AIGatewaySuggestion docs
    const suggestions = await AIGatewaySuggestion.find(query)
      .sort({ createdAt: -1 })
      .limit(100);
    
    // Map to UI columns
    const rows = suggestions.map(s => ({
      id: s._id,
      template: s.templateId?.name || 'Unknown',
      company: s.companyId?.companyName || 'N/A',
      callSource: s.callSource,
      tierPath: s.tierPath,
      issue: this.mapTypeToIssueLabel(s.type),
      why: this.buildWhyText(s),
      latency: s.latencyMs,
      severity: s.priority,
      status: s.status,
      canApply: ['pending', 'saved'].includes(s.status),
      canReject: s.status === 'pending',
    }));
    
    res.json({ success: true, data: rows });
  } catch (err) {
    logger.error('[LLM LEARNING V2] Error fetching suggestions', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
```

---

### 6. Apply/Reject Handlers

**File:** `routes/admin/llmLearningV2.js`

```javascript
router.patch('/v2/suggestions/:id/apply', async (req, res) => {
  try {
    const suggestion = await AIGatewaySuggestion.findById(req.params.id);
    if (!suggestion) return res.status(404).json({ success: false });

    // Depending on type, modify the scenario or template
    if (suggestion.type === 'keywords' && suggestion.scenarioId) {
      const scenario = await GlobalInstantResponseTemplate.findOne({
        'scenarios._id': suggestion.scenarioId,
      });
      // Merge keywords into scenario.triggers
      // ... implementation ...
    }
    
    // Mark as applied
    await suggestion.markApplied(req.user._id);
    
    res.json({ success: true, message: 'Suggestion applied' });
  } catch (err) {
    logger.error('[LLM LEARNING V2] Apply failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/v2/suggestions/:id/reject', async (req, res) => {
  try {
    const suggestion = await AIGatewaySuggestion.findById(req.params.id);
    if (!suggestion) return res.status(404).json({ success: false });

    await suggestion.markIgnored(req.user._id);
    
    res.json({ success: true, message: 'Suggestion rejected' });
  } catch (err) {
    logger.error('[LLM LEARNING V2] Reject failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
```

---

## ✅ TESTING CHECKLIST

- [ ] Force a Tier-3 call (weird phrasing not in template)
- [ ] Verify `LLMLearningTask` created with full data
- [ ] Run worker (manually or wait for cron)
- [ ] Verify `AIGatewaySuggestion` doc created
- [ ] Load console v2 → see suggestion in list
- [ ] Click "View suggestions" → see structured data
- [ ] Click "Apply" on ADD_KEYWORDS suggestion
- [ ] Open that scenario → verify triggers updated
- [ ] Verify suggestion.status = 'applied'
- [ ] Confirm NO changes to live call behavior

---

## 📊 ARCHITECTURE DIAGRAM

```
┌─────────────────────────────────────────────────────────┐
│ Live Call Flow                                          │
├─────────────────────────────────────────────────────────┤
│ T1 (rule-based) → T2 (semantic) → T3 (LLM)             │
│                                        ↓                 │
│                                  Tier3Result            │
│                                  { success, matched,    │
│                                    confidence,          │
│                                    rationale, ... }     │
│                                        ↓                 │
│                              [IntelligentRouter]        │
│                              Creates LLMLearningTask    │
│                                        ↓                 │
└─────────────────────────────────────────────────────────┘
                                         ↓
┌─────────────────────────────────────────────────────────┐
│ Async Background Job (every 30s)                        │
├─────────────────────────────────────────────────────────┤
│ [LLMLearningWorker]                                    │
│ - Find PENDING tasks                                    │
│ - Gather template + scenario context                    │
│ - Call OpenAI with structured prompt                    │
│ - Parse suggestions                                     │
│ - Create AIGatewaySuggestion docs                       │
│ - Mark task DONE                                        │
│                                        ↓                 │
└─────────────────────────────────────────────────────────┘
                                         ↓
┌─────────────────────────────────────────────────────────┐
│ Admin UI: LLM Learning Console v2                       │
├─────────────────────────────────────────────────────────┤
│ Suggestions Tab:                                        │
│ - Shows real Tier-3 coaching suggestions               │
│ - Filter by template, company, source                  │
│ - Apply / Reject buttons (manual approval)             │
│ - Scenario updates on Apply                            │
│                                        ↓                 │
└─────────────────────────────────────────────────────────┘
                                         ↓
                             Next Tier-3 calls use
                          improved scenarios (+confidence)
```

---

## 📝 NOTES FOR IMPLEMENTER

1. **Non-blocking captures:** Wrap `LLMLearningTask.create()` in try/catch in IntelligentRouter. If task creation fails, call continues normally.

2. **Worker batching:** Process 20 tasks at a time, run every 30s. Prevents overwhelming OpenAI.

3. **Cost tracking:** Estimate LLM cost per suggestion. Later, build ROI dashboard.

4. **Error resilience:** If worker encounters errors, mark task FAILED but don't crash. Keep processing.

5. **Existing models:** Reuse `AIGatewaySuggestion` (already has all needed fields). Don't recreate.

6. **No schema migrations:** Make all new fields optional/nullable for backwards compatibility.

---

## 🚀 ROLLOUT

1. ✅ Create LLMLearningTask model
2. ✅ Deploy to staging
3. ✅ Add Tier-3 capture to IntelligentRouter
4. ✅ Test: Force Tier-3 call, verify task created
5. ✅ Create + deploy LLMLearningWorker
6. ✅ Test: Run worker, verify suggestions created
7. ✅ Wire console v2 routes
8. ✅ Test: Verify console v2 shows suggestions
9. ✅ Implement Apply/Reject handlers
10. ✅ Full E2E test
11. ✅ Deploy to production
12. ✅ Monitor: Check worker logs + suggestion quality

---

**READY FOR IMPLEMENTATION**


