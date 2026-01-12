# 🎯 TWILIO TEST ROUTING AUDIT - MISMATCH DIAGNOSIS

**Date:** 2025-10-26  
**Issue:** Test phrases loading from wrong template  
**Status:** 🔴 CRITICAL - UI shows Universal, Twilio routes to HVAC

---

## 📊 CURRENT STATE ANALYSIS

### What's Happening:
```
UI Template:      Universal AI Brain (68ebb75e7ec3caaed781d057)
                  ↓
Test Phrases:     ✅ Shows Universal phrases (73 phrases from 12 categories)
                  ↓
User Calls In:    +12395614603
                  ↓
Twilio Routes:    ❌ Routes to HVAC Template (68fb535130d19aec696d8123)
                  ↓
Caller Says:      "my thermostat isn't working"
                  ↓
Result:           "Question not found or disabled" (HVAC has no match in Universal)
```

---

## 🔍 ROOT CAUSE ANALYSIS

### The Architecture Issue:

**TWO SEPARATE "ACTIVE TEMPLATE" REFERENCES:**

1. **UI's `activeTemplate`** (JavaScript variable)
   - File: `public/admin-global-instant-responses.html`
   - Set by: `fetchActiveTemplate()` on page load
   - Updated by: `switchDashboardTemplate()` when dropdown changes
   - Used by: `loadTestPhrases()` to display test phrases
   - Scope: **Frontend only**

2. **Backend's `globalAIBrainTest.activeTemplateId`** (MongoDB document)
   - File: `models/AdminSettings.js`
   - Set by: `saveTwilioTestConfig()` or `switchDashboardTemplate()`
   - Used by: `routes/v2twilio.js` → `getCompanyByPhoneNumber()` to route calls
   - Scope: **Backend only (production call routing)**

### The Disconnect:

```javascript
// FILE: public/admin-global-instant-responses.html

// PROBLEM LINE (Line 3995-3997):
async function loadTestPhrases() {
    console.log('📋 [TEST PHRASES] Loading phrases from active template...');
    console.log('📋 [TEST PHRASES] activeTemplateId:', activeTemplateId);
    console.log('📋 [TEST PHRASES] activeTemplate:', activeTemplate);
    
    if (!activeTemplateId || !activeTemplate) {  // ❌ Uses UI's activeTemplate
        // ...
    }
    
    // Line 4015: Loops through activeTemplate.categories
    activeTemplate.categories.forEach(category => {  // ❌ WRONG SOURCE!
        // ...
    });
}
```

**What SHOULD happen:**
Test phrases should load from `AdminSettings.globalAIBrainTest.activeTemplateId`

**What ACTUALLY happens:**
Test phrases load from UI's `activeTemplate` (whatever you selected in dropdown)

---

## 🛠️ THE FIX

### Option 1: Fetch Global Config First (RECOMMENDED)

**Change `loadTestPhrases()` to:**
1. Fetch `AdminSettings.globalAIBrainTest` from backend
2. Get the `activeTemplateId` from there
3. Load that template's scenarios
4. Display those test phrases

**Benefits:**
- ✅ WYSIWYG (What You See Is What You Get)
- ✅ Test phrases always match Twilio routing
- ✅ No more mismatches

**Drawbacks:**
- Requires extra API call

### Option 2: Sync on Template Switch

**Ensure `switchDashboardTemplate()` ALWAYS:**
1. Updates UI's `activeTemplate`
2. Updates backend's `globalAIBrainTest.activeTemplateId`
3. Waits for backend confirmation
4. THEN reloads test phrases

**Benefits:**
- ✅ Keeps UI and backend in sync
- ✅ Minimal code changes

**Drawbacks:**
- Still vulnerable to race conditions

### Option 3: Single Source of Truth

**Refactor to:**
1. Remove `activeTemplate` variable entirely
2. All operations fetch from backend
3. Backend is the ONLY source of truth

**Benefits:**
- ✅ Impossible to desync
- ✅ Clean architecture

**Drawbacks:**
- Major refactor required

---

## 📋 CALL ROUTING FLOW (Current)

### Incoming Call Path:

```
1. Caller dials: +12395614603
   ↓
2. Twilio webhook: POST /api/twilio/voice
   ↓
3. getCompanyByPhoneNumber(phoneNumber)
   ↓
4. Checks AdminSettings.globalAIBrainTest:
   - enabled: true ✅
   - phoneNumber: +12395614603 ✅
   - activeTemplateId: "68fb535130d19aec696d8123" (HVAC Template)
   ↓
5. Loads GlobalInstantResponseTemplate.findById(activeTemplateId)
   ↓
6. Returns template as "company" object:
   {
     isGlobalTestTemplate: true,
     template: { ...HVAC Template data... },
     _id: "68fb535130d19aec696d8123",
     name: "HVAC Trade Knowledge Template (V1.1)"
   }
   ↓
7. Says greeting, routes to /test-respond/68fb535130d19aec696d8123
   ↓
8. HybridScenarioSelector matches against HVAC scenarios
   ↓
9. Caller says "thermostat" → MATCH in HVAC ✅
   BUT user was looking at Universal phrases in UI ❌
```

### Code References:

**File:** `routes/v2twilio.js`

**Lines 347-374:** Global AI Brain test number check
```javascript
const globalTestConfig = adminSettings?.globalAIBrainTest;

if (globalTestConfig?.enabled && globalTestConfig.phoneNumber === phoneNumber) {
  logger.info(`🧠 [GLOBAL BRAIN] Global test number matched! Loading active template...`);
  
  // Load the template that's currently being tested
  const testTemplate = await GlobalInstantResponseTemplate.findById(
    globalTestConfig.activeTemplateId  // ← SOURCE OF TRUTH
  );
  
  if (testTemplate) {
    return {
      isGlobalTestTemplate: true,
      template: testTemplate,
      _id: testTemplate._id,
      name: testTemplate.name,
      globalTestConfig: globalTestConfig
    };
  }
}
```

**Lines 564-590:** Test mode greeting
```javascript
if (company.isGlobalTestTemplate) {
  const selector = new HybridScenarioSelector(company.template.categories);
  
  const rawGreeting = company.globalTestConfig?.greeting || 
    'Welcome to the ClientsVia Global AI Brain Testing Center...';
  const greeting = rawGreeting.replace('{template_name}', company.template.name);
  
  const gather = twiml.gather({
    action: `/api/twilio/test-respond/${company.template._id}`,  // ← Routes here
    // ...
  });
  gather.say(greeting);
}
```

**Lines 1598-1698:** Test response handler
```javascript
router.post('/test-respond/:templateId', async (req, res) => {
  const { templateId } = req.params;  // ← Gets HVAC ID
  const speechText = req.body.SpeechResult || '';
  
  const template = await GlobalInstantResponseTemplate.findById(templateId);  // ← Loads HVAC
  
  const selector = new HybridScenarioSelector(
    template.categories,  // ← HVAC categories
    fillerWords,
    urgencyKeywords
  );
  
  const result = await selector.selectScenario(speechText);  // ← Matches against HVAC
  
  if (result.scenario) {
    const reply = replies[Math.floor(Math.random() * replies.length)];
    twiml.say(reply);  // ← Responds with HVAC reply
  }
});
```

---

## 🎯 RECOMMENDED FIX (IMPLEMENTATION PLAN)

### Phase 1: Add Sync Indicator (UI)

**Goal:** Show user which template Twilio will ACTUALLY use

**Changes:**
- Add banner at top of test phrases: "🧠 Active Test Template: {name}"
- Fetch from `/api/admin/settings/global-ai-brain-test`
- Display `activeTemplateName` prominently
- If mismatch with UI dropdown, show warning

### Phase 2: Fix loadTestPhrases()

**Goal:** Load test phrases from backend's active template

**Changes to `public/admin-global-instant-responses.html`:**

```javascript
async function loadTestPhrases() {
    console.log('📋 [TEST PHRASES] Loading phrases from GLOBAL active template...');
    
    try {
        // NEW: Fetch global test config to get the REAL active template
        const token = getAuthToken();
        const response = await fetch('/api/admin/settings/global-ai-brain-test', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load global test config');
        }
        
        const globalConfig = await response.json();
        const activeTemplateId = globalConfig.data.activeTemplateId;
        
        console.log('📋 [TEST PHRASES] Global config activeTemplateId:', activeTemplateId);
        
        // NEW: Load the ACTUAL active template
        const templateResponse = await fetch(`/api/admin/global-instant-responses/${activeTemplateId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!templateResponse.ok) {
            throw new Error('Failed to load active template');
        }
        
        const templateData = await templateResponse.json();
        const realActiveTemplate = templateData.data;
        
        console.log('📋 [TEST PHRASES] Loaded REAL active template:', realActiveTemplate.name);
        
        // Now use realActiveTemplate instead of UI's activeTemplate
        let totalPhrases = 0;
        realActiveTemplate.categories.forEach(category => {
            // ... rest of logic
        });
        
        // Update banner
        document.getElementById('active-test-template-name').textContent = realActiveTemplate.name;
        
    } catch (error) {
        console.error('❌ [TEST PHRASES] Error:', error);
        showNotification('Failed to load test phrases', 'error');
    }
}
```

### Phase 3: Update switchDashboardTemplate()

**Goal:** Ensure sync is atomic

**Changes:**

```javascript
async function switchDashboardTemplate(templateId) {
    try {
        // 1. Update backend FIRST
        const updateResponse = await fetch('/api/admin/settings/global-ai-brain-test', {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                activeTemplateId: templateId
            })
        });
        
        if (!updateResponse.ok) {
            throw new Error('Failed to update active template in backend');
        }
        
        // 2. Load template for UI
        const template = await fetchTemplateById(templateId);
        
        // 3. Update UI
        activeTemplate = template;
        activeTemplateId = template._id;
        
        // 4. Reload test phrases (now they'll match!)
        await loadTestPhrases();
        
        // 5. Render categories
        renderCategories();
        
        showNotification('✅ Template switched successfully', 'success');
        
    } catch (error) {
        console.error('❌ [SWITCH TEMPLATE] Error:', error);
        showNotification('Failed to switch template', 'error');
    }
}
```

---

## 🐛 ADDITIONAL BUG: Redis Type Error

### Error:
```
TypeError: "arguments[2]" must be of type "string | Buffer", got number instead.
```

### Location:
Appears to be in Redis `setEx()` calls

### Root Cause:
Something is passing a number as the VALUE parameter instead of a string

### Fix:
Audit all `redisClient.setEx()` calls and ensure value is JSON.stringify()'d

**Common culprit:**
```javascript
// ❌ WRONG:
await redisClient.setEx(key, 30, myObject);  // If myObject is number

// ✅ CORRECT:
await redisClient.setEx(key, 30, JSON.stringify(myObject));
```

---

## ✅ TESTING CHECKLIST

After implementing fixes:

- [ ] Switch to Universal template in UI
- [ ] Verify test phrases show Universal triggers
- [ ] Call test number
- [ ] Verify greeting says "Universal AI Brain"
- [ ] Say a Universal phrase
- [ ] Verify it matches and responds
- [ ] Switch to HVAC template in UI
- [ ] Verify test phrases show HVAC triggers (Thermostats, etc.)
- [ ] Call test number again
- [ ] Verify greeting says "HVAC Trade Knowledge Template"
- [ ] Say "my thermostat isn't working"
- [ ] Verify it matches HVAC scenario
- [ ] Check logs for no Redis type errors

---

## 📚 RELATED FILES

- `public/admin-global-instant-responses.html` - UI & Test Phrases
- `routes/v2twilio.js` - Call routing logic
- `models/AdminSettings.js` - Global test config schema
- `routes/admin/adminGlobalAIBrainTest.js` - API endpoints
- `services/HybridScenarioSelector.js` - Scenario matching engine

---

**End of Audit**

