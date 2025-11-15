# 🧠 ANALYTICS ⟷ BRAIN/CHEAT SHEET INTEGRATION

**Purpose:** Document how call analytics integrate with the Brain/Cheat Sheet architecture  
**Date:** November 15, 2025  
**Status:** Integration Ready  

---

## 🎯 INTEGRATION POINTS

### **Call Analytics Reads From:**
- `v2AIAgentCallLog` - Primary data source for all analytics
- Fields used:
  - `matchedScenario` - Which scenario was triggered
  - `matchDetails.category` - Category classification
  - `matchDetails.confidence` - Confidence score
  - `usedFallback` - Whether fallback was used
  - `responseTime` - Speed metrics
  - `caller.question` - Original question (for knowledge gaps)

### **Brain/Cheat Sheet Writes To:**
- `v2AIAgentCallLog` - Every call generates a log entry
- Populated by: `v2AIAgentRuntime.js`, `CallFlowExecutor.js`, `TriageCardService.js`

---

## 📊 CURRENT ANALYTICS METRICS

### **1. Match Rate**
```javascript
Formula: (Calls with confidence ≥0.7 AND NOT fallback) / Total Calls × 100

Brain Alignment:
- Measures how well Brain scenarios match incoming questions
- High match rate (90%+) = Brain is well-trained
- Low match rate (<60%) = Need more scenarios in Cheat Sheet
```

### **2. Confidence Score**
```javascript
Formula: Average of all matchDetails.confidence × 100

Brain Alignment:
- Reflects Brain's certainty in its matches
- Comes from HybridScenarioSelector matching logic
- High confidence (85%+) = Trigger words & synonyms are well-defined
```

### **3. Top Scenarios**
```javascript
Query: Group by matchedScenario, count occurrences

Brain Alignment:
- Shows which Cheat Sheet scenarios are most used
- Helps identify which scenarios to optimize
- Maps directly to template scenarios in GlobalInstantResponseTemplate
```

### **4. Knowledge Gaps**
```javascript
Query: Calls with confidence <0.7, grouped by question

Brain Alignment:
- Shows questions Brain couldn't match confidently
- Actionable: Add these as new scenarios to Cheat Sheet
- Direct feedback loop for improving Brain performance
```

---

## 🔄 DATA FLOW

```
┌─────────────────────────────────────────────────────────────┐
│                    CALL HAPPENS                             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                 v2AIAgentRuntime.js                         │
│  (orchestrates call flow)                                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│           HybridScenarioSelector.select()                   │
│  (Brain matches question to scenario)                       │
│  Returns: scenario, confidence, category                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│               v2AIAgentCallLog.create()                     │
│  Saves:                                                     │
│   - matchedScenario: "Book Appointment"                    │
│   - matchDetails.confidence: 0.89                          │
│   - matchDetails.category: "Booking"                       │
│   - usedFallback: false                                    │
│   - responseTime: 23ms                                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│           Analytics API (v2aiAnalytics.js)                  │
│  Aggregates call logs for insights                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│        AI Agent Settings → Analytics Tab                    │
│  User sees: Match rate, confidence, top scenarios, gaps    │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎨 BRAIN CATEGORIES IN ANALYTICS

### **Category Mapping**

The Brain uses **triage categories** which map to analytics categories:

| Brain Category | Analytics Display | Purpose |
|---------------|-------------------|----------|
| `booking` | Booking | Appointment scheduling |
| `pricing` | Pricing | Quote/estimate requests |
| `availability` | Availability | Service availability questions |
| `service_info` | Service Info | General service questions |
| `emergency` | Emergency | Urgent service requests |
| `unknown` | Unknown | Brain couldn't categorize |

**Future Enhancement:** Add category-specific analytics:
```javascript
GET /api/company/:id/analytics/by-category

Response:
{
  "booking": {
    "count": 234,
    "avgConfidence": 0.91,
    "fallbackRate": 0.02
  },
  "pricing": {
    "count": 189,
    "avgConfidence": 0.78,
    "fallbackRate": 0.15
  }
}
```

---

## 📈 CHEAT SHEET ⟷ ANALYTICS LOOP

### **Improvement Workflow**

1. **View Analytics** → Identify knowledge gap
   - Example: "Do you offer weekend service?" appears 23 times with 45% confidence

2. **Update Cheat Sheet** → Add new scenario
   - Navigate to AI Agent Settings → AiCore Templates
   - Add new scenario: "Weekend Service Availability"
   - Add triggers: "weekend", "saturday", "sunday", "weekend service"

3. **Deploy** → Brain now recognizes the question

4. **Monitor Analytics** → Confidence improves
   - Next week: Same question now matches at 92% confidence
   - Knowledge gap disappears from analytics

5. **Iterate** → Continuous improvement cycle

---

## 🚀 FUTURE ENHANCEMENTS

### **Phase 2: Brain-Specific Analytics**

Add these endpoints to `routes/company/v2aiAnalytics.js`:

#### **1. Category Performance**
```javascript
GET /api/company/:id/analytics/categories

Returns per-category metrics:
- Call volume per category
- Avg confidence per category
- Fallback rate per category
- Top scenarios within each category
```

#### **2. Scenario Health**
```javascript
GET /api/company/:id/analytics/scenarios/:scenarioId

Returns detailed metrics for ONE scenario:
- Usage count over time
- Confidence distribution (histogram)
- Common variations (questions that triggered it)
- Trigger word effectiveness
```

#### **3. Brain Diagnostics**
```javascript
GET /api/company/:id/analytics/brain-health

Returns Brain-specific health score:
- Coverage: % of questions matched with >70% confidence
- Consistency: Variance in confidence scores
- Fallback rate: % using fallback response
- Category balance: Are all categories well-represented?
```

### **Phase 3: UI Integration**

Add Brain-specific views to Analytics tab:

**Intelligence Dashboard Enhancement:**
```javascript
// Current: Top 10 scenarios
// Add: Category breakdown chart

[Booking: 45%] [Pricing: 25%] [Availability: 20%] [Other: 10%]
```

**Performance Tab Enhancement:**
```javascript
// Add Brain-specific metrics:
- Trigger Word Hit Rate
- Synonym Effectiveness
- Filler Word Impact
```

---

## 🔗 INTEGRATION CHECKLIST

### **Current State ✅**
- [x] v2AIAgentCallLog captures Brain output
- [x] Analytics reads from v2AIAgentCallLog
- [x] matchedScenario maps to Cheat Sheet scenarios
- [x] matchDetails.confidence reflects Brain confidence
- [x] Knowledge gaps show Brain blind spots
- [x] Zero dependencies on deleted AI Gateway

### **Ready for Enhancement 🎯**
- [ ] Add category-specific analytics endpoint
- [ ] Add scenario health endpoint
- [ ] Add Brain diagnostics endpoint
- [ ] Add category breakdown to UI
- [ ] Add trigger word effectiveness metrics
- [ ] Link knowledge gaps directly to Cheat Sheet editor

---

## 📝 DEVELOPER NOTES

### **Where to Add Brain-Aligned Metrics**

**Backend (routes/company/v2aiAnalytics.js):**
```javascript
// Add after existing endpoints:

router.get('/company/:companyId/analytics/categories', async (req, res) => {
    // Aggregate by matchDetails.category
    const categories = await v2AIAgentCallLog.aggregate([
        { $match: { companyId, createdAt: { $gte: startDate } } },
        { $group: {
            _id: '$matchDetails.category',
            count: { $sum: 1 },
            avgConfidence: { $avg: '$matchDetails.confidence' },
            fallbackCount: { $sum: { $cond: ['$usedFallback', 1, 0] } }
        }},
        { $sort: { count: -1 } }
    ]);
    
    res.json({ success: true, categories });
});
```

**Frontend (public/js/ai-agent-settings/AnalyticsManager.js):**
```javascript
// Add method to AnalyticsManager class:

async loadCategoryBreakdown() {
    const res = await fetch(`/api/company/${this.companyId}/analytics/categories`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return await res.json();
}
```

---

## 🎉 SUMMARY

✅ **Analytics are Brain-aligned** - Data flows from Brain to Analytics seamlessly  
✅ **Zero gaps** - Every Brain decision is tracked  
✅ **Actionable insights** - Knowledge gaps → Cheat Sheet improvements  
✅ **Ready to extend** - Clear path for Phase 2 enhancements  

**The analytics system is perfectly positioned to provide Brain/Cheat Sheet intelligence! 🚀**

---

**Doc By:** AI Assistant  
**Date:** November 15, 2025  
**Next:** Phase 5 - Clean up legacy docs

