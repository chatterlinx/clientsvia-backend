# LLM Learning Console V2 - Integration Guide

## 🎯 **Overview**

This guide walks you through integrating the V2 LLM Learning Console into production.

**Current Status:**
- ✅ Model enhanced with 9 new fields
- ✅ API endpoints built and mounted
- ✅ Standalone UI created
- ✅ UI route created and mounted
- ⏳ Need to wire into 3-Tier system
- ⏳ Need to add to admin navigation

---

## 📋 **PHASE 1: Backend Sanity Check**

### **Test the API Endpoints**

Before proceeding, verify the backend is working:

#### **1. Test /suggestions endpoint**

```bash
# Replace with your actual backend URL
curl -X GET "http://localhost:3000/api/admin/llm-learning/v2/suggestions?page=1&pageSize=10" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "items": [],
  "page": 1,
  "pageSize": 10,
  "total": 0
}
```

Empty `items` array is NORMAL if no suggestions exist yet.

#### **2. Test /tasks endpoint**

```bash
curl -X GET "http://localhost:3000/api/admin/llm-learning/v2/tasks" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "items": []
}
```

#### **3. Test the UI route**

Open in browser:
```
http://localhost:3000/admin/llm-learning-v2
```

You should see:
- Filters bar at top
- "Suggestions | Task Queue" tabs
- Empty table with message: "No suggestions found for the current filters."

**If you see the UI, Phase 1 is COMPLETE!** ✅

---

## 🔗 **PHASE 2: Add to Admin Navigation**

The UI is accessible at `/admin/llm-learning-v2` but needs a navigation link.

### **Option A: Add to Existing Admin Sidebar** (Recommended)

Find your admin navigation template (likely in `public/` or `views/`):

```html
<!-- Example: In your admin sidebar -->
<nav class="admin-sidebar">
  <ul>
    <li><a href="/admin/dashboard">Dashboard</a></li>
    <li><a href="/admin/companies">Companies</a></li>
    <li><a href="/admin/global-ai-brain">Global AI Brain</a></li>
    
    <!-- ADD THIS -->
    <li>
      <a href="/admin/llm-learning-v2" class="nav-link">
        <i class="fas fa-brain"></i>
        LLM Learning Console (New)
      </a>
    </li>
    <!-- END ADD -->
    
    <li><a href="/admin/settings">Settings</a></li>
  </ul>
</nav>
```

### **Option B: Replace Old LLM Learning Link**

If you have an old LLM Learning link, update it:

```html
<!-- OLD -->
<li><a href="/admin/llm-learning">LLM Learning</a></li>

<!-- NEW -->
<li><a href="/admin/llm-learning-v2">LLM Learning Console</a></li>
```

---

## 🔌 **PHASE 3: Wire 3-Tier System to Create Suggestions**

The console shows data from `ProductionLLMSuggestion` collection.

Currently, this collection is EMPTY because the 3-Tier system isn't creating records yet.

### **Where to Add the Code**

Find your **3-Tier Intelligence Router** (likely in `services/` or wherever Tier 3 LLM calls happen).

### **What to Add**

When Tier 3 (LLM) is invoked, create a suggestion record:

```javascript
const ProductionLLMSuggestion = require('../models/ProductionLLMSuggestion');

// Inside your Tier 3 handler (after LLM responds)
async function logTier3Suggestion({
  templateId,
  templateName,
  companyId,
  companyName,
  callSource, // 'template-test' | 'company-test' | 'production'
  callId,
  callDate,
  
  // Scenario info
  scenarioId,
  scenarioName,
  categoryName,
  
  // Tier routing
  tier1Score,
  tier1Threshold,
  tier1LatencyMs,
  tier2Score,
  tier2Threshold,
  tier2LatencyMs,
  tier3LatencyMs,
  
  // Dead air tracking
  maxDeadAirMs,
  avgDeadAirMs,
  
  // Call context
  customerPhrase,
  agentResponseSnippet,
  
  // LLM meta
  llmModel,
  tokens,
  costUsd,
  
  // Why Tier 3 fired
  rootCauseReason, // LLM-generated explanation
  suggestionType,  // 'ADD_KEYWORDS', 'NEW_SCENARIO', etc.
  
  // Impact estimation
  priority,        // 'critical', 'high', 'medium', 'low'
  severity,        // 'critical', 'high', 'medium', 'low'
  changeImpactScore, // 0-5
  similarCallCount   // Default: 1
}) {
  try {
    const suggestion = new ProductionLLMSuggestion({
      templateId,
      templateName,
      companyId,
      companyName,
      callSource,
      callId,
      callDate: callDate || new Date(),
      
      scenarioId,
      scenarioName,
      categoryName,
      
      tier1Score,
      tier1Threshold,
      tier1LatencyMs,
      tier2Score,
      tier2Threshold,
      tier2LatencyMs,
      tier3LatencyMs,
      overallLatencyMs: tier1LatencyMs + tier2LatencyMs + tier3LatencyMs,
      
      maxDeadAirMs,
      avgDeadAirMs,
      
      customerPhrase,
      agentResponseSnippet,
      
      llmModel,
      tokens,
      costUsd,
      
      suggestionType: suggestionType || 'OTHER',
      suggestionSummary: `${suggestionType || 'Tier 3 needed'}: ${rootCauseReason?.slice(0, 100)}`,
      rootCauseReason,
      
      priority: priority || 'medium',
      severity: severity || 'medium',
      changeImpactScore: changeImpactScore || 0,
      similarCallCount: similarCallCount || 1,
      
      status: 'pending'
    });
    
    await suggestion.save();
    
    console.log(`[LLM LEARNING] Suggestion created: ${suggestion._id}`);
    return suggestion;
    
  } catch (error) {
    console.error('[LLM LEARNING] Failed to create suggestion:', error);
    // Don't throw - this is logging, shouldn't break the call
  }
}

module.exports = { logTier3Suggestion };
```

### **Example Integration**

```javascript
// In your 3-Tier router
if (tier3Needed) {
  const startTier3 = Date.now();
  
  const llmResponse = await callLLM({
    model: 'gpt-4o-mini',
    prompt: buildPrompt(customerPhrase)
  });
  
  const tier3LatencyMs = Date.now() - startTier3;
  
  // LOG THE SUGGESTION
  await logTier3Suggestion({
    templateId: template._id,
    templateName: template.name,
    companyId: company?._id,
    companyName: company?.companyName,
    callSource: isTestMode ? 'template-test' : 'production',
    callId: callSid,
    callDate: new Date(),
    
    scenarioId: matchedScenario?.id,
    scenarioName: matchedScenario?.name,
    categoryName: matchedScenario?.category,
    
    tier1Score,
    tier1Threshold,
    tier1LatencyMs,
    tier2Score,
    tier2Threshold,
    tier2LatencyMs,
    tier3LatencyMs,
    
    maxDeadAirMs: calculateDeadAir(callData),
    avgDeadAirMs: calculateAvgDeadAir(callData),
    
    customerPhrase,
    agentResponseSnippet: llmResponse.text.slice(0, 200),
    
    llmModel: 'gpt-4o-mini',
    tokens: llmResponse.usage.total_tokens,
    costUsd: llmResponse.cost,
    
    rootCauseReason: llmResponse.analysis?.reason || 'Tier 1 and 2 failed to match',
    suggestionType: determineSuggestionType(llmResponse),
    
    priority: tier1Score < 0.5 ? 'high' : 'medium',
    severity: tier3LatencyMs > 1000 ? 'high' : 'medium',
    changeImpactScore: estimateImpact(tier1Score, tier2Score),
    similarCallCount: 1
  });
}
```

---

## 🧪 **PHASE 4: Test with Real Data**

### **Method 1: Manual Test via Test Pilot**

1. Go to **Test Pilot → Template Testing**
2. Select a template
3. Ask something intentionally unusual: *"I need a plumber for my flying saucer"*
4. This should trigger Tier 3 (LLM)
5. Check MongoDB:
   ```bash
   db.productionllmsuggestions.find().sort({createdAt:-1}).limit(1).pretty()
   ```
6. Open **LLM Learning Console V2** UI
7. You should see the suggestion appear!

### **Method 2: Seed Sample Data**

Create a script to seed test data:

```javascript
// scripts/seed-llm-suggestions.js
const mongoose = require('mongoose');
const ProductionLLMSuggestion = require('../models/ProductionLLMSuggestion');

async function seedSuggestions() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const sampleSuggestions = [
    {
      templateId: 'YOUR_TEMPLATE_ID',
      templateName: 'Universal AI Brain',
      companyId: 'YOUR_COMPANY_ID',
      companyName: 'Royal Plumbing',
      callSource: 'template-test',
      
      callDate: new Date(),
      
      scenarioName: 'Request Appointment',
      categoryName: 'Booking',
      
      tier1Score: 0.42,
      tier1Threshold: 0.80,
      tier1LatencyMs: 2,
      tier2Score: 0.68,
      tier2Threshold: 0.60,
      tier2LatencyMs: 8,
      tier3LatencyMs: 640,
      overallLatencyMs: 650,
      
      maxDeadAirMs: 3000,
      avgDeadAirMs: 1800,
      
      customerPhrase: 'Hi. I need an appointment please.',
      agentResponseSnippet: 'Absolutely, I can help you with that...',
      
      llmModel: 'gpt-4o-mini',
      tokens: 523,
      costUsd: 0.003,
      
      suggestionType: 'ADD_KEYWORDS',
      suggestionSummary: 'Add keyword: "appointment please"',
      rootCauseReason: 'Tier 1 rules did not handle polite appointment requests...',
      
      priority: 'high',
      severity: 'medium',
      changeImpactScore: 3.8,
      similarCallCount: 14,
      
      status: 'pending'
    }
  ];
  
  await ProductionLLMSuggestion.insertMany(sampleSuggestions);
  console.log('✅ Sample suggestions seeded!');
  process.exit(0);
}

seedSuggestions().catch(console.error);
```

Run:
```bash
node scripts/seed-llm-suggestions.js
```

---

## 🧹 **PHASE 5: Clean Up Old Code (When Ready)**

Once V2 is working and you're happy:

### **1. Remove old LLM Learning routes**

Find and delete (or comment out):
```javascript
// In index.js or wherever old routes are
// app.use('/api/admin/llm-learning', oldLLMLearningRoutes);  // DELETE THIS
```

### **2. Remove old UI files**

Delete old LLM Learning frontend files:
```bash
# Example (adjust to your structure)
rm public/admin-llm-learning-old.html
rm public/js/llm-learning-old.js
```

### **3. Update navigation**

Change nav label from "LLM Learning Console (New)" to just "LLM Learning Console"

### **4. Update V2 route to be primary**

Optional: Move V2 to the main route:
```javascript
// Before
app.use('/admin/llm-learning-v2', ...)

// After cleanup
app.use('/admin/llm-learning', ...)
```

---

## 📊 **PHASE 6: Verify Everything Works**

### **Checklist:**

- [ ] Can access `/admin/llm-learning-v2` in browser
- [ ] Filters load without errors
- [ ] Tabs switch correctly (Suggestions ↔ Task Queue)
- [ ] At least 1 suggestion appears in the table
- [ ] Click "View" opens side drawer
- [ ] Click "Apply" marks suggestion as applied
- [ ] Click "Reject" marks suggestion as rejected
- [ ] "Snooze" button prompts for days and saves
- [ ] Pagination works (if >25 suggestions)
- [ ] Task Queue groups suggestions correctly

---

## 🚀 **Production Deployment**

Once everything is verified locally:

1. **Commit all changes:**
   ```bash
   git add -A
   git commit -m "🎯 Integrate LLM Learning Console V2 into admin navigation"
   git push origin main
   ```

2. **Deploy to Render** (or your platform)
   - Render auto-deploys on push to `main`
   - Check deployment logs for errors

3. **Verify in production:**
   - Open `https://yourapp.com/admin/llm-learning-v2`
   - Confirm data loads
   - Test actions

---

## 🛠️ **Troubleshooting**

### **Problem: 404 when accessing `/admin/llm-learning-v2`**

**Solution:** Route not mounted correctly.

Check `index.js`:
```javascript
app.use('/admin', routes.llmLearningV2UIRoutes);
```

### **Problem: 401 Unauthorized**

**Solution:** Not logged in as admin.

1. Log in to admin portal
2. Verify JWT token exists in cookies
3. Confirm role = 'admin'

### **Problem: Empty suggestions table**

**Solution:** No data in database yet.

1. Check MongoDB: `db.productionllmsuggestions.count()`
2. If 0, run seed script or trigger Tier 3 via Test Pilot
3. Verify 3-Tier system is calling `logTier3Suggestion()`

### **Problem: API returns 500 error**

**Solution:** Check backend logs.

```bash
# In Render dashboard or local terminal
tail -f logs/combined.log
```

Look for error stack traces and fix accordingly.

---

## 📞 **Next Steps for Enterprise-Grade**

Once this is working, we can add:

1. **Real-time updates** (WebSocket or polling)
2. **Bulk actions** (Apply/reject multiple at once)
3. **Analytics dashboard** (Cost trends, ROI charts)
4. **Auto-suggest fixes** (ML-powered recommendations)
5. **Template/company dropdowns** (Pre-populated from backend)
6. **Advanced filtering** (Date ranges, keyword search)
7. **Export to CSV** (Download suggestions for analysis)

---

## ✅ **Summary**

**What we built:**
- Enhanced database schema with 9 new fields
- V2 API with smart filtering + task grouping
- Complete standalone UI with modern UX
- Route handler for serving the UI
- Mounted everything in the main app

**What's left:**
- Add link to admin navigation
- Wire 3-Tier system to create suggestions
- Test with real data
- Clean up old code when ready

**You're 80% there!** The hard part (architecture + code) is done. Now it's just wiring and testing! 🎉

---

**Questions? Issues? Let's debug together!** 💪

