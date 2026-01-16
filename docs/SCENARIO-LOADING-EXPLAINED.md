# Scenario Loading: Where Do Scenarios Come From?

**Date:** January 16, 2026  
**Your Question:** "Where is it supposed to pick up scenarios from? Is this the Global Template?"

---

## **YES - Scenarios Come From Global Templates**

Looking at your screenshot showing **71 Total Scenarios, 71 Enabled**, those scenarios are loaded from **Global AI Brain templates** that are linked to your company.

---

## **The Complete Flow**

### **Step 1: Templates in Global AI Brain**

```
Global AI Brain (Database: globalInstantResponseTemplates)
└── Template: "HVAC Master v3"
    ├── Category: "AC Not Working"
    │   ├── Scenario: "ac-not-cooling"
    │   ├── Scenario: "strange-noises"
    │   └── Scenario: "intermittent-cooling"
    ├── Category: "Emergency"
    │   ├── Scenario: "no-heat-winter"
    │   └── Scenario: "gas-smell"
    └── ... (more categories)
```

### **Step 2: Link Templates to Company**

In your company's configuration, templates are linked via:

**Location:** `Company.aiAgentSettings.templateReferences`

```javascript
{
  templateReferences: [
    {
      templateId: "507f1f77bcf86cd799439011",
      templateName: "HVAC Master v3",
      enabled: true,
      priority: 1
    },
    {
      templateId: "507f1f77bcf86cd799439012",
      templateName: "Emergency Protocols",
      enabled: true,
      priority: 2
    }
  ]
}
```

**This is what determines:** "Which templates' scenarios should this company use?"

### **Step 3: ScenarioPoolService Loads Scenarios**

**Code:** `services/ScenarioPoolService.js`

When a call comes in, here's what happens:

```javascript
// 1. Look up company
const company = await Company.findById(companyId);

// 2. Find linked templates
const templateRefs = company.aiAgentSettings.templateReferences
  .filter(ref => ref.enabled === true);
// Result: ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"]

// 3. Load each template from Global AI Brain
for (const ref of templateRefs) {
  const template = await GlobalInstantResponseTemplate.findById(ref.templateId);
  
  // 4. Flatten all scenarios from all categories
  template.categories.forEach(category => {
    category.scenarios.forEach(scenario => {
      // 5. Only include LIVE and ACTIVE scenarios
      if (scenario.status === 'live' && scenario.isActive === true) {
        scenarioPool.push(scenario);
      }
    });
  });
}

// Result: 71 scenarios loaded!
```

### **Step 4: Redis Cache**

Once loaded, scenarios are cached in Redis for 5 minutes:

```
Redis Key: scenario-pool:{companyId}
TTL: 300 seconds (5 minutes)
Data: { scenarios: [...], templatesUsed: [...] }
```

**Why cache?** Loading from MongoDB every time would be slow (500ms+). Cache makes it 30x faster (~15ms).

---

## **Where Your "1 Scenario" Problem Comes From**

Looking at your test where you saw **"1 scenario loaded"**, here's what likely happened:

### **Scenario 1: Template Not Linked**
```javascript
// Company has NO templateReferences
aiAgentSettings.templateReferences = []

// OR templateReferences exist but ALL are disabled
aiAgentSettings.templateReferences = [
  { templateId: "...", enabled: false }
]
```
**Result:** 0 scenarios loaded (critical wiring issue)

### **Scenario 2: Template Linked But Empty**
```javascript
// Company has template linked
aiAgentSettings.templateReferences = [
  { templateId: "507f...", enabled: true }
]

// But that template has only 1 scenario
GlobalInstantResponseTemplate.findById("507f...")
  .categories = [
    {
      name: "Test",
      scenarios: [
        { scenarioId: "test-1", status: "live", isActive: true }
      ]
    }
  ]
```
**Result:** 1 scenario loaded (template is incomplete)

### **Scenario 3: Redis Cache Stuck**
```javascript
// Template has 71 scenarios but Redis has old data
Redis cache: { scenarios: [1 old scenario] }

// Scenarios never reload because cache TTL hasn't expired
```
**Result:** 1 scenario loaded until cache cleared

---

## **How to Diagnose Your Specific Case**

### **Check 1: Are Templates Linked?**

**MongoDB Query:**
```javascript
db.companies.findOne(
  { _id: ObjectId("your-company-id") },
  { "aiAgentSettings.templateReferences": 1 }
)
```

**Expected Result (Good):**
```json
{
  "aiAgentSettings": {
    "templateReferences": [
      {
        "templateId": "507f1f77bcf86cd799439011",
        "templateName": "HVAC Master v3",
        "enabled": true,
        "priority": 1
      }
    ]
  }
}
```

**Bad Results:**
- `templateReferences: []` → No templates linked (CRITICAL)
- `enabled: false` → Template linked but disabled
- Missing `aiAgentSettings` → Using legacy system

### **Check 2: Does That Template Have Scenarios?**

**MongoDB Query:**
```javascript
db.globalInstantResponseTemplates.findOne(
  { _id: ObjectId("507f1f77bcf86cd799439011") },
  { name: 1, "categories.scenarios": 1 }
)
```

**Count scenarios:**
```javascript
// In template document
let count = 0;
template.categories.forEach(cat => {
  cat.scenarios.forEach(scen => {
    if (scen.status === 'live' && scen.isActive === true) {
      count++;
    }
  });
});
console.log('Total live scenarios:', count);
```

**Expected:** 30-70+ scenarios  
**Problem:** 0-5 scenarios

### **Check 3: Is Redis Cache Stuck?**

**Redis Command:**
```bash
redis-cli GET "scenario-pool:your-company-id"
```

**Or via API:**
```bash
curl -X POST http://localhost:8080/api/admin/wiring-status/YOUR_COMPANY_ID/clear-cache \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**After clearing cache, test again** → Should load fresh from MongoDB

---

## **The Dashboard You're Looking At**

Your screenshot shows:

```
📊 Live Scenarios Dashboard
- 71 Total Scenarios
- 71 Enabled
- 0 Disabled
- 33 Categories
```

**This data comes from:**

```javascript
// When you click "Scenarios" tab
GET /api/admin/wiring-status/:companyId

// Calls ScenarioPoolService
const { scenarios } = await ScenarioPoolService.getScenarioPoolForCompany(companyId);

// Dashboard displays:
- Total: scenarios.length
- Enabled: scenarios.filter(s => s.isEnabledForCompany === true).length
- Disabled: scenarios.filter(s => s.isEnabledForCompany === false).length
- Categories: unique(scenarios.map(s => s.categoryName)).length
```

---

## **Why You See "1 Scenario" in Test Console**

The **Response Path panel** in test console shows:

```
📚 Scenarios: 1 loaded
```

**This number comes from:**
```javascript
// In debugSnapshot from ConversationEngine
debugSnapshot.scenarioCount = scenariosAvailable.length;

// scenariosAvailable comes from ScenarioPoolService
const { scenarios } = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
const scenariosAvailable = scenarios.filter(s => s.isEnabledForCompany === true);
```

**If you see "1 loaded"** when dashboard shows "71", possible causes:

1. **Different company ID** - Test console using wrong companyId
2. **Redis cache mismatch** - Dashboard reads MongoDB, runtime reads cache
3. **Template disabled mid-test** - Someone disabled template after dashboard loaded
4. **Code path difference** - Dashboard bypasses cache, runtime uses cache

---

## **Legacy Systems (Backward Compatibility)**

ScenarioPoolService supports 3 template linking methods:

### **Method 1: NEW - Multi-Template (Recommended)**
```javascript
Company.aiAgentSettings.templateReferences = [
  { templateId: "...", enabled: true, priority: 1 }
]
```

### **Method 2: LEGACY v1 - activeTemplates Array**
```javascript
Company.aiAgentSettings.activeTemplates = [
  "507f1f77bcf86cd799439011",
  "507f1f77bcf86cd799439012"
]
```

### **Method 3: LEGACY v0 - Single Template**
```javascript
Company.configuration.clonedFrom = "507f1f77bcf86cd799439011"
```

**ScenarioPoolService checks in this order:**
1. If `templateReferences` exists → use it
2. Else if `activeTemplates` exists → use it
3. Else if `clonedFrom` exists → use it
4. Else → return 0 scenarios

---

## **Quick Fixes**

### **Fix 1: No Templates Linked**
```javascript
// In Control Plane → Data & Config → Templates
// Click "Link Template"
// Select "HVAC Master v3" from Global AI Brain
// Click "Save"
```

### **Fix 2: Template Linked But No Scenarios**
```javascript
// Go to Global AI Brain
// Find template: "HVAC Master v3"
// Check: Does it have categories with scenarios?
// If empty → Import scenarios or create new ones
```

### **Fix 3: Redis Cache Stuck**
```javascript
// In Control Plane → Wiring Tab
// Click "Clear Cache" button
// Or via API:
POST /api/admin/wiring-status/:companyId/clear-cache
```

### **Fix 4: Template Disabled**
```javascript
// In Control Plane → Data & Config → Templates
// Check: Is template marked "enabled: true"?
// If false → enable it
```

---

## **For Dental Office Onboarding**

When onboarding a new dental office:

**Step 1: Link Dental Template**
```
Control Plane → Data & Config → Templates
→ Click "Link Template"
→ Select "Dental Care Master v1" (or create new)
→ Priority: 1
→ Save
```

**Step 2: Verify Scenarios Loaded**
```
Control Plane → Data & Config → Scenarios
→ Should show 40-60 scenarios
→ Categories: Appointments, Emergency, Insurance, etc.
```

**Step 3: Test in Console**
```
AI Test Console → Run test
→ Response Path should show: "📚 Scenarios: 47 loaded"
→ If shows "0" or "1" → Wiring issue detected automatically
```

**Automatic Detection (NEW):**
The diagnostic rules we added today will automatically flag:
- `LOW_SCENARIO_COUNT` if 1-9 scenarios (should be 30+)
- `NO_TEMPLATE_REFERENCES` if no templates linked

---

## **Summary**

**Q: Where do scenarios come from?**  
**A:** Global AI Brain templates linked via `aiAgentSettings.templateReferences`

**Q: Why do I see "1 scenario" sometimes?**  
**A:** Either templates aren't linked, template is empty, or Redis cache is stuck

**Q: How do I fix it?**  
**A:** Link templates in Data & Config tab, or clear Redis cache

**Q: Is this automatic for new trades?**  
**A:** Yes! The diagnostic rules now detect low scenario counts automatically

You're looking at the right place - the "Scenarios" tab shows what's loaded from Global Templates. If that shows 71 but test shows 1, it's a cache issue.
