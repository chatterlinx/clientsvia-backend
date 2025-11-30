# ELITE FRONTLINE V23 — TUNING PLAYBOOK

**Purpose:** Step-by-step guide to tune routing accuracy from 85% → 99%  
**Audience:** Developers, AI Engineers, System Admins  
**Timeline:** 1–2 weeks for full tuning cycle  
**Difficulty:** Intermediate

---

## 📖 TABLE OF CONTENTS

1. [Understanding Prompt Tuning](#understanding-prompt-tuning)
2. [Week 1 Workflow](#week-1-workflow)
3. [Analyzing Failures](#analyzing-failures)
4. [Common Misroute Patterns](#common-misroute-patterns)
5. [Tuning Triage Cards](#tuning-triage-cards)
6. [Testing Improvements](#testing-improvements)
7. [Advanced Techniques](#advanced-techniques)

---

## 🧠 UNDERSTANDING PROMPT TUNING

### **What Is Prompt Tuning?**

Prompt tuning is the process of **iteratively improving** the Micro-LLM's routing instructions based on **real-world failures**.

**NOT AI training.** We're not retraining models. We're **refining the instructions** (triage rules, keywords, negative keywords) that the Micro-LLM uses to make routing decisions.

### **Why Can't We Get 99% on Day 1?**

Because **real callers are unpredictable:**

- "My thingy is doing the weird noise again" (what thingy?)
- "It's sweating more than me lol" (leak, but uses humor)
- "Can someone come today? Or tomorrow? Actually maybe Wednesday?" (changing mind mid-sentence)

**You can't predict these on Day 1.** You have to **see them happen**, then **add rules** to handle them.

### **The Tuning Cycle**

```
Deploy v1.0 → Monitor 100 calls → Identify failures → Update triage rules → Deploy v1.1 → Repeat
```

**Expected Timeline:**

- **v1.0:** 85–90% accuracy (Day 1)
- **v1.1:** 92–95% accuracy (Week 1)
- **v1.2:** 97–99% accuracy (Week 2)

---

## 📅 WEEK 1 WORKFLOW

### **Day 1: Deploy v1.0**

1. **Enable V23 for 1 test company:**

```javascript
await Company.findByIdAndUpdate(companyId, {
  'aiAgentSettings.orchestrationMode': 'FRONTLINE_ELITE_V23'
});
```

2. **Run 10 test calls** (cover common scenarios):
   - Normal booking request
   - Emergency situation
   - Returning caller
   - Frustrated caller
   - Ambiguous request

3. **Verify logs** for all 7 layers.

### **Days 2–3: Collect Data**

1. **Run 100 production calls** or simulate with test script.

2. **Monitor dashboard** (if built) or query directly:

```javascript
const RoutingDecisionLog = require('./models/routing/RoutingDecisionLog');

// Get all decisions for the company
const decisions = await RoutingDecisionLog.find({ companyId })
  .sort({ timestamp: -1 })
  .limit(100);

console.log(`Total decisions: ${decisions.length}`);
console.log(`Average confidence: ${
  decisions.reduce((sum, d) => sum + d.routingDecision.confidence, 0) / decisions.length
}`);
```

### **Day 4: Analyze Failures**

1. **Listen to recordings** (if available) or read transcripts.

2. **Mark incorrect routes:**

```javascript
// Example: Caller said "AC sweating" but routed to MAINTENANCE instead of LEAK
await RoutingDecisionLog.findByIdAndUpdate(decisionId, {
  wasCorrect: false,
  actualTarget: 'HVAC_LEAK',
  tuningFlag: true,
  tuningNotes: 'Caller used "sweating" which is slang for leak'
});
```

3. **Generate failure report:**

```javascript
const failures = await RoutingDecisionLog.getFailures(companyId, {
  limit: 50,
  promptVersion: 'v1.0'
});

console.log(`Failures: ${failures.length}`);
```

### **Days 5–6: Tune Triage Cards**

See [Tuning Triage Cards](#tuning-triage-cards) section below.

### **Day 7: Deploy v1.1 & Validate**

1. **Invalidate cache:**

```javascript
const CompactPromptCompiler = require('./services/elite-frontline/CompactPromptCompiler');
await CompactPromptCompiler.invalidateCache(companyId);
```

2. **Run 100 more test calls.**

3. **Check new accuracy:**

```javascript
const stats = await RoutingDecisionLog.getAccuracyStats(companyId, 'v1.1');
console.log(`v1.1 Accuracy: ${(stats.accuracy * 100).toFixed(1)}%`);
```

**Expected:** 92–95%

---

## 🔍 ANALYZING FAILURES

### **Step 1: Identify Top Misroute Patterns**

```javascript
const patterns = await RoutingDecisionLog.getMisroutePatterns(companyId);

console.table(patterns);
```

**Example Output:**

| Routed To | Should Be | Count | Example Phrases |
|-----------|-----------|-------|-----------------|
| `MAINTENANCE` | `LEAK` | 12 | "sweating", "dripping", "wet" |
| `EMERGENCY` | `REPAIR` | 8 | "hot as hell", "damn hot" |
| `BOOKING` | `REPAIR` | 5 | "can you come today" |

### **Step 2: Categorize Failure Types**

#### **Type 1: Missing Keyword**

**Example:** Caller says "AC sweating" but "sweating" is not in LEAK keywords.

**Fix:** Add "sweating" to LEAK triage card.

#### **Type 2: Wrong Keyword Priority**

**Example:** Caller says "check my AC" → routes to MAINTENANCE, but they actually need REPAIR.

**Fix:** Add "check" to REPAIR keywords, or add "maintenance" to REPAIR negative keywords.

#### **Type 3: Ambiguous Intent**

**Example:** Caller says "can you come tomorrow?" without stating the problem.

**Fix:** Improve Frontline prompt to ask clarifying question before routing.

#### **Type 4: Emotion Misinterpretation**

**Example:** Caller jokes "it's sweating like crazy lol" → system treats as EMERGENCY due to "crazy".

**Fix:** Update emotion detection to downgrade priority when HUMOROUS emotion detected.

### **Step 3: Group by Root Cause**

- **Synonym Gap:** 40% (missing keywords like "sweating", "dripping")
- **Negative Keyword Missing:** 30% (false positives like "maintenance" in "check")
- **Emotion Misread:** 20% (humor misinterpreted as panic)
- **Ambiguous Input:** 10% (caller didn't state problem)

---

## 🛠️ COMMON MISROUTE PATTERNS

### **Pattern 1: Leak-Related Slang**

**Problem:** Callers use informal words for leaks.

**Phrases:**
- "sweating", "dripping", "wet", "water everywhere", "puddle", "moisture"

**Fix:**

```javascript
await TriageCard.findOneAndUpdate(
  { companyId, linkedScenarioKey: 'HVAC_LEAK' },
  { $addToSet: {
    triggerKeywords: {
      $each: ['sweating', 'dripping', 'wet', 'puddle', 'moisture']
    }
  }}
);
```

### **Pattern 2: Profanity ≠ Emergency**

**Problem:** System over-interprets profanity as emergency.

**Phrases:**
- "damn hot", "hell freezing", "shit broke"

**Fix:**

Update emotion detection calibration or add negative keywords:

```javascript
await TriageCard.findOneAndUpdate(
  { companyId, linkedScenarioKey: 'EMERGENCY' },
  { $addToSet: {
    negativeKeywords: {
      $each: ['damn', 'hell'] // These alone don't mean emergency
    }
  }}
);
```

### **Pattern 3: Vague Scheduling Requests**

**Problem:** Caller asks "can you come today?" without stating problem.

**Phrases:**
- "can you come", "how soon", "today", "tomorrow"

**Fix:**

Add scenario for "SCHEDULING_INQUIRY" that asks clarifying question before routing.

---

## 🎨 TUNING TRIAGE CARDS

### **Add Positive Keywords**

```javascript
await TriageCard.findOneAndUpdate(
  { companyId, linkedScenarioKey: 'HVAC_LEAK' },
  { $addToSet: { triggerKeywords: 'sweating' } }
);
```

### **Add Negative Keywords (Avoid False Positives)**

```javascript
await TriageCard.findOneAndUpdate(
  { companyId, linkedScenarioKey: 'HVAC_LEAK' },
  { $addToSet: { negativeKeywords: 'maintenance' } }
);
```

**Why?** If caller says "maintenance checkup", don't route to LEAK even if they mention "water" (e.g., "water heater maintenance").

### **Update Priority**

If a scenario is consistently under-prioritized:

```javascript
await TriageCard.findOneAndUpdate(
  { companyId, linkedScenarioKey: 'HVAC_LEAK' },
  { $set: { priority: 10 } } // Higher = more important
);
```

### **Add Synonyms (Batch Update)**

```javascript
const synonyms = ['sweating', 'dripping', 'leaking', 'wet', 'puddle'];

await TriageCard.findOneAndUpdate(
  { companyId, linkedScenarioKey: 'HVAC_LEAK' },
  { $addToSet: { triggerKeywords: { $each: synonyms } } }
);
```

### **Invalidate Cache (Critical!)**

After ANY triage card change:

```javascript
await CompactPromptCompiler.invalidateCache(companyId);
```

**Why?** Prompt is cached in Redis for 1 hour. If you don't invalidate, changes won't apply until cache expires.

---

## 🧪 TESTING IMPROVEMENTS

### **Before/After Comparison**

```javascript
// Test phrase
const testPhrase = "My AC is sweating again";

// Before (v1.0)
const beforeResult = await testRouting(testPhrase, 'v1.0');
console.log('v1.0:', beforeResult.target); // MAINTENANCE (wrong)

// After tuning
await addKeyword('HVAC_LEAK', 'sweating');
await CompactPromptCompiler.invalidateCache(companyId);

// After (v1.1)
const afterResult = await testRouting(testPhrase, 'v1.1');
console.log('v1.1:', afterResult.target); // HVAC_LEAK (correct!)
```

### **Bulk Testing**

Create a test suite:

```javascript
const testCases = [
  { input: "AC sweating", expected: "HVAC_LEAK" },
  { input: "It's hot as hell", expected: "HVAC_REPAIR" },
  { input: "Can you come today?", expected: "SCHEDULING_INQUIRY" },
  { input: "This is the third time", expected: "ESCALATE_TO_HUMAN" }
];

for (const test of testCases) {
  const result = await EliteFrontlineIntelV23.process({
    companyId,
    callId: 'test',
    userInput: test.input,
    callState: {},
    company: {}
  });
  
  const passed = result.action === test.expected;
  console.log(`${passed ? '✅' : '❌'} "${test.input}" → ${result.action} (expected: ${test.expected})`);
}
```

---

## 🚀 ADVANCED TECHNIQUES

### **1. A/B Testing Prompt Versions**

Deploy v1.1 to 10% of traffic, keep v1.0 on 90%:

```javascript
await PromptVersion.findOneAndUpdate(
  { companyId, version: 'v1.0' },
  { trafficAllocation: 90 }
);

await PromptVersion.findOneAndUpdate(
  { companyId, version: 'v1.1' },
  { trafficAllocation: 10, status: 'TESTING' }
);
```

### **2. Confidence Calibration**

If Micro-LLM is consistently overconfident:

```javascript
// In MicroLLMRouter.js, apply calibration
const calibratedConfidence = rawConfidence * 0.9; // Reduce by 10%
```

### **3. Emotion-Based Priority Boost**

If frustrated callers are being under-prioritized:

```javascript
// In HumanLayerAssembler.js
if (emotion.primary === 'FRUSTRATED' && emotion.intensity > 0.7) {
  routing.priority = 'HIGH'; // Auto-upgrade
}
```

### **4. Caller History Influence**

Give returning callers with negative history higher priority:

```javascript
const callCount = context.memory?.callerHistory?.[0]?.totalCount || 0;
if (callCount >= 3 && emotion.primary === 'FRUSTRATED') {
  routing.priority = 'EMERGENCY';
}
```

---

## 📊 SUCCESS METRICS

### **After Week 1 Tuning:**

- Accuracy: **92–95%**
- Avg Confidence: **0.85+**
- Misroute rate: **5–8%**

### **After Week 2 Tuning:**

- Accuracy: **97–99%**
- Avg Confidence: **0.90+**
- Misroute rate: **1–3%**

---

## 🎯 FINAL CHECKLIST

- [ ] 100+ calls analyzed
- [ ] Top 10 misroute patterns identified
- [ ] Triage cards updated with new keywords
- [ ] Negative keywords added to prevent false positives
- [ ] Cache invalidated after changes
- [ ] v1.1 deployed and validated
- [ ] Accuracy improved by 5%+
- [ ] Ready for v1.2 tuning cycle

---

**Questions?** Contact marc@clientsvia.com


