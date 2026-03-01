# How LLM Knows Which Company It's Working For

## Current State: ❌ It Doesn't!

**Problem:** The LLM currently uses **global settings** for all companies, which means:
- A dentist office and HVAC company get the same LLM behavior
- Medical safety rules don't apply specifically to medical companies
- Call center optimizations don't apply specifically to service companies

---

## How It SHOULD Work: Company Context Flow

### 1️⃣ **Admin Opens Scenario Builder**

```
Admin navigates to:
  /triggers.html?companyId=68e3f77a9d623b8058c700c4
  
Browser knows:
  - Current companyId: 68e3f77a9d623b8058c700c4
  - Company name: "Bob's HVAC"
  - Company type: Service/HVAC
```

### 2️⃣ **Admin Clicks "Generate Scenario with AI"**

**Frontend should send:**
```javascript
POST /api/admin/scenario-assistant/draft
Headers: {
  Authorization: "Bearer <jwt-token>"
}
Body: {
  description: "Handle calls about AC maintenance",
  companyId: "68e3f77a9d623b8058c700c4",  // ⬅️ THIS IS MISSING!
  channel: "voice",
  templateVariables: ["{companyname}", "{phone}"]
}
```

### 3️⃣ **Backend Loads Company-Specific LLM Settings**

```javascript
// routes/admin/llmScenarioAssistant.js

router.post('/draft', async (req, res) => {
  const { description, companyId } = req.body;
  
  // CURRENT (WRONG):
  const llmSettings = await getSettings('global');
  // ❌ Uses same settings for all companies
  
  // CORRECT:
  const scope = companyId ? `company:${companyId}` : 'global';
  const llmSettings = await getSettings(scope);
  // ✅ Uses company-specific settings
  
  // Settings now include:
  // - Active profile (compliance-safe for dentist, call-center for HVAC)
  // - Domain modes (medical mode ON for dentist, OFF for HVAC)
  // - Custom prompts ("You're helping an HVAC company...")
  // - Guardrails (specific to business type)
});
```

### 4️⃣ **System Prompt Built from Company Settings**

```javascript
const systemPrompt = buildScenarioArchitectSystemPromptFromSettings(llmSettings);

// For Bob's HVAC (company:68e3f77a9d623b8058c700c4):
// ──────────────────────────────────────────────────────────
// You are the AI Scenario Architect for ClientVia.ai.
// 
// PROFILE: CALL CENTER OPTIMIZED
// - Balanced creativity with strong structure
// - Generate richer trigger phrases for phone calls
// - Keep tone friendly, courteous, and concise
//
// CONTEXT: HVAC Service Company
// - Focus on seasonal needs (AC summer, heating winter)
// - Common questions: pricing, service calls, maintenance
// - Tone: Professional but friendly, not overly formal
//
// GUARDRAILS:
// - Cannot book appointments (route to booking flow)
// - Cannot quote exact prices (use ranges, route to sales)
// - Can discuss seasonal promotions and service packages
// ──────────────────────────────────────────────────────────

// For Dr. Smith Dental (company:abc123):
// ──────────────────────────────────────────────────────────
// You are the AI Scenario Architect for ClientVia.ai.
//
// PROFILE: COMPLIANCE-SAFE
// - Conservative, low creativity
// - Prioritize safety and policy alignment
//
// DOMAIN SAFETY: MEDICAL OFFICE
// - DO NOT provide medical advice, diagnosis, or treatment
// - DO NOT interpret symptoms or lab results
// - DO NOT suggest medications or dosages
// - Logistics only: scheduling, directions, insurance
//
// GUARDRAILS:
// - Cannot book appointments (route to booking flow)
// - Cannot discuss treatment plans
// - Must escalate emergencies immediately
// ──────────────────────────────────────────────────────────
```

### 5️⃣ **LLM Generates Company-Appropriate Scenario**

```javascript
// OpenAI receives the company-specific system prompt:
const completion = await openaiClient.chat.completions.create({
  model: llmSettings.defaults.modelOverride || profileConfig.model,
  temperature: profileConfig.temperature,
  messages: [
    { 
      role: 'system', 
      content: systemPrompt  // ⬅️ Company-specific instructions!
    },
    { 
      role: 'user', 
      content: "Handle calls about AC maintenance"
    }
  ]
});

// Bob's HVAC gets:
// ──────────────────────────────────────────────────────────
// Scenario: AC Maintenance Inquiry
// Triggers: 
//   - "AC maintenance"
//   - "tune up my air conditioner"
//   - "when should I service my AC"
//   - "AC not cooling well"
// Replies:
//   - "Great question! We recommend AC maintenance twice a year..."
//   - "Our team can inspect your system and ensure it's running efficiently..."
// Follow-up: Route to booking for service appointment
// ──────────────────────────────────────────────────────────

// Dr. Smith Dental gets:
// ──────────────────────────────────────────────────────────
// Scenario: Dental Cleaning Inquiry
// Triggers:
//   - "cleaning appointment"
//   - "teeth cleaning"
//   - "hygienist appointment"
// Replies:
//   - "We'd be happy to schedule your cleaning appointment..."
//   - "Our hygienists are available Monday through Friday..."
// Follow-up: Route to scheduling (no medical advice)
// ──────────────────────────────────────────────────────────
```

---

## Required Changes

### ✅ Backend Changes (1 line fix!)

```javascript
// routes/admin/llmScenarioAssistant.js

router.post('/draft', async (req, res) => {
  const {
    description,
    conversationLog = [],
    channel = 'voice',
    templateVariables = [],
    tradeKey = null,
    companyId = null  // ⬅️ ADD THIS
  } = req.body || {};

  // Load company-specific LLM settings
  let llmSettings;
  try {
    // BEFORE:
    // llmSettings = await getSettings('global');
    
    // AFTER:
    const scope = companyId ? `company:${companyId}` : 'global';
    llmSettings = await getSettings(scope);
    
    logger.debug('[LLM SCENARIO ASSISTANT] Loaded LLM settings', {
      scope,
      companyId,
      activeProfile: llmSettings.defaults?.activeProfile,
    });
  } catch (err) {
    // Fallback to defaults if company settings don't exist
    llmSettings = DEFAULT_LLM_ENTERPRISE_SETTINGS;
  }
  
  // Rest of the code stays the same...
});
```

### ✅ Frontend Changes (Where is the frontend?)

Need to find where Scenario Assistant is called from and add `companyId`:

```javascript
// Somewhere in triggers UI or scenario builder:

async function generateScenario(description) {
  // Get companyId from URL or context
  const urlParams = new URLSearchParams(window.location.search);
  const companyId = urlParams.get('companyId');
  
  const response = await fetch('/api/admin/scenario-assistant/draft', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      description,
      companyId,  // ⬅️ ADD THIS
      channel: 'voice',
      templateVariables: getAvailableTemplateVariables()
    })
  });
  
  const data = await response.json();
  return data.draft;
}
```

---

## Alternative: Use JWT Token Company

If admin JWT already contains companyId, could use that instead:

```javascript
// In authenticateJWT middleware, req.user is populated:
req.user = {
  _id: user._id,
  email: user.email,
  role: user.role,
  companyId: user.companyId  // ⬅️ User's company (if not admin)
}

// In llmScenarioAssistant.js:
router.post('/draft', async (req, res) => {
  // Get companyId from body (preferred) or fallback to user's company
  const companyId = req.body.companyId || req.user?.companyId?.toString();
  
  const scope = companyId ? `company:${companyId}` : 'global';
  const llmSettings = await getSettings(scope);
  // ...
});
```

**Problem with JWT approach:**
- Admins are platform-level (no companyId in JWT)
- Admin could be configuring scenarios for ANY company
- Must explicitly pass which company they're working on

---

## Summary

### Current Flow (BROKEN):
```
Admin → Scenario Assistant → getSettings('global') → Same LLM for everyone
```

### Correct Flow (FIXED):
```
Admin (working on Bob's HVAC)
  ↓
  POST /api/admin/scenario-assistant/draft { companyId: "68e3..." }
  ↓
  getSettings('company:68e3f77a9d623b8058c700c4')
  ↓
  Load Bob's HVAC LLM Settings:
    - Profile: Call Center Optimized
    - Domain: No medical restrictions
    - Tone: Friendly, service-focused
  ↓
  Build system prompt with HVAC context
  ↓
  LLM generates HVAC-appropriate scenarios
```

---

## Next Steps

1. **Find the frontend code** that calls `/api/admin/scenario-assistant/draft`
2. **Add `companyId` to the request body**
3. **Update backend** to use `getSettings(scope)` instead of `getSettings('global')`
4. **Test with two companies:**
   - Create scenario for dentist (should use Medical Mode)
   - Create scenario for HVAC (should use Call Center Mode)
   - Verify different tones and safety rules

---

## Expected Outcome

✅ **Dentist scenarios** will be conservative, medical-safe, no diagnosis  
✅ **HVAC scenarios** will be friendly, service-focused, seasonal-aware  
✅ **Legal scenarios** will be strict, compliance-heavy, no legal advice  
✅ **Each company gets appropriate LLM behavior**

No more one-size-fits-all! 🎯
