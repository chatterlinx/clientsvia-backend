# 🔍 DISCOVERY REPORT: Twilio Call Flow Break Point
**Date:** November 8, 2025  
**Issue:** Greeting plays correctly, then drops to default Twilio voice after customer speaks  
**Status:** ROOT CAUSE IDENTIFIED - NO CODING YET

---

## 🎯 SYMPTOM

**What User Experiences:**
1. ✅ Customer calls Royal Plumbing test number
2. ✅ AI greeting plays perfectly: "Penguin Air, how can I help you?" (ElevenLabs voice)
3. 🗣️ Customer speaks: "Hi, I need to set up..."
4. ❌ **AI responds in default Twilio female voice** (not ElevenLabs)
5. ❌ Call "falls off" / gets lost

**Expected Behavior:**
- AI should respond in same ElevenLabs voice
- Should load company templates, scenarios, variables from AICore
- Should route through 3-tier intelligence system

---

## 🗂️ FILE STRUCTURE TRUTH

### ✅ CONFIRMED: Legacy Monolithic Structure Still Active

```
routes/
├── v2twilio.js (2,901 lines) ← CURRENTLY RUNNING
└── twilio/ (directory)       ← DOES NOT EXIST (clean rebuild was reverted)
```

**Mounted at:** `app.use('/api/twilio', routes.v2TwilioRoutes);` (index.js:363)

### 📍 KEY ENDPOINTS

| Line | Endpoint | Purpose | Status |
|------|----------|---------|--------|
| 534 | `POST /voice` | Initial call entry | ✅ Works |
| 1467 | `POST /voice/:companyID` | Company-specific entry | ✅ Works |
| 1619 | `POST /v2-agent-respond/:companyID` | **SECOND LEG** | ❌ **BREAKS HERE** |
| 1867 | `POST /test-respond/:templateId` | Test Pilot | ✅ Works |

---

## 🔥 ROOT CAUSE ANALYSIS

### FIRST LEG: Initial Greeting (WORKS ✅)

**File:** `routes/v2twilio.js`  
**Lines:** 534-950  
**Flow:**

```javascript
// Line 556: Load company by phone number
const company = await getCompanyByPhoneNumber(calledNumber);

// Line 602-626: Detect call source (template-test | company-test | production)
callSource = 'company-test';  // Royal Plumbing test mode
isTest = true;

// Line 870-876: Initialize V2 AI Agent Runtime
const { initializeCall } = require('../services/v2AIAgentRuntime');
const initResult = await initializeCall(companyID, callSid, from, to, callSource, isTest);

// Line 881-892: Set up Gather with ABSOLUTE URL ✅
const gather = twiml.gather({
  input: 'speech',
  action: `https://${req.get('host')}/api/twilio/v2-agent-respond/${company._id}`,  // ✅ FULL URL
  // ... speech settings
});

// Line 902-916: Generate ElevenLabs greeting ✅
if (elevenLabsVoice && initResult.greeting) {
  const buffer = await synthesizeSpeech({
    text: initResult.greeting,
    voiceId: elevenLabsVoice,
    // ... voice settings from company.aiAgentLogic.voiceSettings
  });
  
  // Store in Redis and play
  twiml.play(audioUrl);
}
```

**Result:** Greeting plays perfectly in ElevenLabs voice! 🎉

---

### SECOND LEG: AI Response (BREAKS ❌)

**File:** `routes/v2twilio.js`  
**Lines:** 1619-1787  
**Flow:**

```javascript
// Line 1650-1656: Call V2 AI Agent Runtime
const { processUserInput } = require('../services/v2AIAgentRuntime');
const result = await processUserInput(companyID, callSid, speechResult, callState);

// Line 1688: Reload company from DB
const company = await Company.findById(companyID);

// Line 1696: Extract voice ID
const elevenLabsVoice = company?.aiAgentLogic?.voiceSettings?.voiceId;

// Line 1703-1741: CRITICAL DECISION POINT ⚠️
if (elevenLabsVoice && responseText) {
  // 🎤 Use ElevenLabs voice
  const audioBuffer = await synthesizeSpeech({ ... });
  twiml.play(audioUrl);
  logger.info('✅ V2 ELEVENLABS: Audio generated');  // ← Should see this in logs!
  
} else {
  // 🔊 FALLBACK TO TWILIO VOICE ← USER IS HITTING THIS PATH!
  logger.info('🎤 V2 FALLBACK: Using Twilio voice (no ElevenLabs configured)');
  twiml.say({
    voice: 'alice'  // ← DEFAULT FEMALE VOICE (what user hears!)
  }, escapeTwiML(responseText));
}

// Line 1746-1755: Set up next gather with RELATIVE URL ⚠️
const gather = twiml.gather({
  input: 'speech',
  action: `/api/twilio/v2-agent-respond/${companyID}`,  // ❌ RELATIVE (should be absolute)
  // ...
});
```

**Result:** Falls back to Twilio voice instead of ElevenLabs! ❌

---

## 🐛 IDENTIFIED ISSUES

### ISSUE #1: Voice Settings Not Loading (PRIMARY)

**Evidence:**
- First leg: ElevenLabs works ✅
- Second leg: Falls back to Twilio voice ❌
- Same company, same database

**Hypothesis:**
One of these is failing at line 1696:
- `company` is undefined
- `company.aiAgentLogic` is undefined
- `company.aiAgentLogic.voiceSettings` is undefined
- `company.aiAgentLogic.voiceSettings.voiceId` is undefined

**Why This Matters:**
```javascript
// Line 1703:
if (elevenLabsVoice && responseText) {
  // If this is FALSE, we get Twilio voice!
}
```

**Root Cause Theories:**

#### Theory A: Company Not Fully Populated
```javascript
// Line 1688: Simple find by ID
const company = await Company.findById(companyID);

// vs First leg (line 556): Custom lookup function
const company = await getCompanyByPhoneNumber(calledNumber);
```

**Possible Issue:** `findById()` might not populate nested fields or templates?

#### Theory B: Database Field Mismatch
- First leg might be using cached data from initial load
- Second leg reloads fresh from DB but schema mismatch?
- Could be missing `.select()` or `.populate()` call

#### Theory C: Test Mode Context Lost
```javascript
// First leg (line 600-626): Detects test mode
callSource = 'company-test';
isTest = true;

// Second leg: Is this context lost?
// processUserInput() receives callState but is callSource preserved?
```

---

### ISSUE #2: Relative URL in Second Gather (SECONDARY)

**File:** `routes/v2twilio.js`  
**Line:** 1753

```javascript
// ❌ WRONG (relative URL):
action: `/api/twilio/v2-agent-respond/${companyID}`,

// ✅ CORRECT (absolute URL):
action: `https://${req.get('host')}/api/twilio/v2-agent-respond/${companyID}`,
```

**Impact:**
- Might cause routing issues in subsequent turns
- Twilio might not know where to send callback
- Could be why user says it "gets lost"

---

### ISSUE #3: AICore Configuration Not Loading

**User Said:**
> "it's supposed to gather and go to mongoose + redis get aicore information to the dual 3 tier system we know"

**What Should Happen:**
1. Customer speaks
2. v2AIAgentRuntime.processUserInput() called
3. Loads AICore config from Mongoose + Redis:
   - Templates (which templates are active for this company)
   - Scenarios (which scenarios are enabled)
   - Variables (placeholder values)
   - Fillers (noise words to remove)
4. Routes through IntelligentRouter (3-tier cascade)
5. Returns response

**What Might Be Happening:**
- AICore config not loading correctly
- Templates/scenarios not found
- 3-tier intelligence not engaging
- Falls back to legacy response system

**Evidence Needed:**
- Check logs for: `[INTELLIGENT ROUTER]` messages
- Check logs for: `[TIER 1]`, `[TIER 2]`, `[TIER 3]` indicators
- Check if `ScenarioPoolService.getScenarioPoolForCompany()` is called
- Check if `company.aiAgentSettings.templateReferences` has active templates

---

## 📊 DATA FLOW COMPARISON

### ✅ FIRST LEG (Greeting - WORKS)

```
Customer calls → /api/twilio/voice
  ↓
getCompanyByPhoneNumber(+12392322030)
  ↓
Company loaded with ALL fields ✅
  ├─ _id: 68e3f77a9d623b8058c700c4
  ├─ companyName: "Royal Plumbing"
  ├─ isTestMode: true
  ├─ aiAgentLogic.voiceSettings.voiceId: "UgBBYS2sOqTuMpoF3BR0" ✅
  └─ aiAgentSettings.templateReferences: [...]
  ↓
v2AIAgentRuntime.initializeCall()
  ↓
Loads connectionMessages.voice.text → "Penguin Air..."
  ↓
ElevenLabs synthesizeSpeech() with voiceId ✅
  ↓
Audio plays correctly! 🎉
```

### ❌ SECOND LEG (Response - BREAKS)

```
Customer speaks → /api/twilio/v2-agent-respond/:companyID
  ↓
v2AIAgentRuntime.processUserInput()
  ↓
Company.findById(companyID)  ← POTENTIAL ISSUE HERE!
  ↓
Company loaded... but is it COMPLETE? 🤔
  ├─ _id: 68e3f77a9d623b8058c700c4 ✅
  ├─ companyName: "Royal Plumbing" ✅
  ├─ aiAgentLogic.voiceSettings.voiceId: ??? ❓
  └─ aiAgentSettings.templateReferences: ??? ❓
  ↓
Line 1696: elevenLabsVoice = company?.aiAgentLogic?.voiceSettings?.voiceId
  ↓
Result: undefined ❌
  ↓
Line 1703: if (elevenLabsVoice && responseText) → FALSE ❌
  ↓
Line 1736: Fallback to twiml.say({ voice: 'alice' })
  ↓
User hears default Twilio female voice 😞
```

---

## 🔬 DIAGNOSTIC LOGGING ANALYSIS

From user's render logs:
```
18:20:45 [V2 GREETING] 🎭 Generating greeting for Royal Plumbing
18:20:47 [TTS COMPLETE] [OK] AI Agent Logic greeting TTS completed in 1082ms
18:20:47 [Twilio Voice] Sending AI Agent Logic TwiML
```
✅ **First leg worked!**

```
18:20:58 [V2 RESPONSE] 🧠 Generating V2 response for: "Hi. I need to set u..."
```
✅ **Second leg was CALLED** (so routing is OK)

**MISSING LOGS:**
- ❌ No `🎤 V2 ELEVENLABS: Using voice XXX for response` (line 1705)
- ❌ No `✅ V2 ELEVENLABS: Audio generated` (line 1726)
- ❌ Should see `🎤 V2 FALLBACK: Using Twilio voice` (line 1737) but not in provided logs

**Conclusion:** Either logs were truncated OR the ElevenLabs code path is not being reached.

---

## 🎯 VERIFICATION NEEDED

### Priority 1: Check Voice Settings in Second Leg

**Add enhanced logging at line 1688-1702:**

```javascript
const company = await Company.findById(companyID);

// 🔍 ENHANCED DIAGNOSTICS (add these):
console.log('='.repeat(80));
console.log('🔍 [V2 AGENT RESPOND] DIAGNOSTIC CHECKPOINT');
console.log('Company loaded:', Boolean(company));
console.log('Company ID:', company?._id?.toString());
console.log('Company name:', company?.companyName);
console.log('aiAgentLogic exists:', Boolean(company?.aiAgentLogic));
console.log('voiceSettings exists:', Boolean(company?.aiAgentLogic?.voiceSettings));
console.log('Full voiceSettings:', JSON.stringify(company?.aiAgentLogic?.voiceSettings, null, 2));
console.log('Extracted voiceId:', company?.aiAgentLogic?.voiceSettings?.voiceId || 'UNDEFINED');
console.log('Response text:', result.response || result.text || 'NO TEXT');
console.log('='.repeat(80));
```

**Expected Output (if working):**
```
🔍 [V2 AGENT RESPOND] DIAGNOSTIC CHECKPOINT
Company loaded: true
Company ID: 68e3f77a9d623b8058c700c4
Company name: Royal Plumbing
aiAgentLogic exists: true
voiceSettings exists: true
Full voiceSettings: {
  "voiceId": "UgBBYS2sOqTuMpoF3BR0",
  "stability": 0.5,
  "similarityBoost": 0.75,
  ...
}
Extracted voiceId: UgBBYS2sOqTuMpoF3BR0 ✅
```

**If Broken (what we expect to see):**
```
Extracted voiceId: UNDEFINED ❌
```

---

### Priority 2: Check AICore Template Loading

**Check if processUserInput() loads templates:**

File: `services/v2AIAgentRuntime.js`  
Function: `processUserInput()`

**Add logging:**
```javascript
console.log('🔍 [AICORE CHECK] Loading company templates...');
console.log('aiAgentSettings:', company.aiAgentSettings);
console.log('templateReferences:', company.aiAgentSettings?.templateReferences);
console.log('Active templates:', company.aiAgentSettings?.templateReferences?.filter(t => t.enabled));
```

**Expected:**
```
Active templates: [
  {
    templateId: '68ebb75e7ec3caeed781d057',
    enabled: true,
    priority: 1
  }
]
```

---

### Priority 3: Check 3-Tier Intelligence Engagement

**Look for these logs:**
- `[INTELLIGENT ROUTER]` - Router initialized
- `[TIER 1]` - Rule-based matching
- `[TIER 2]` - Semantic search
- `[TIER 3]` - LLM fallback

**If missing:** 3-tier system is not being invoked!

---

## 🛠️ PROPOSED FIX STRATEGY (NOT IMPLEMENTED YET)

### Fix #1: Use Same Company Load Method

**BEFORE (line 1688):**
```javascript
const company = await Company.findById(companyID);
```

**AFTER:**
```javascript
const company = await Company.findById(companyID)
  .populate('aiAgentSettings.templateReferences.templateId')  // Populate templates
  .select('+aiAgentLogic.voiceSettings');  // Ensure voiceSettings included
```

OR reuse the same function from first leg:
```javascript
const company = await getCompanyByPhoneNumber(req.body.To);
// This function already loads everything correctly!
```

---

### Fix #2: Use Absolute URLs Everywhere

**BEFORE (line 1753):**
```javascript
action: `/api/twilio/v2-agent-respond/${companyID}`,
```

**AFTER:**
```javascript
action: `https://${req.get('host')}/api/twilio/v2-agent-respond/${companyID}`,
```

---

### Fix #3: Add Fallback Chain

**BEFORE (line 1703):**
```javascript
if (elevenLabsVoice && responseText) {
  // Use ElevenLabs
} else {
  // Fallback to Twilio
}
```

**AFTER:**
```javascript
// Try to load voice settings with multiple fallbacks
const elevenLabsVoice = 
  company?.aiAgentLogic?.voiceSettings?.voiceId ||  // Primary source
  company?.aiVoiceSettings?.voiceId ||               // Legacy location
  null;

if (!elevenLabsVoice) {
  logger.error('❌ [VOICE MISSING] No ElevenLabs voice ID found!');
  logger.error('Company ID:', companyID);
  logger.error('aiAgentLogic:', company?.aiAgentLogic ? 'EXISTS' : 'MISSING');
  logger.error('voiceSettings:', company?.aiAgentLogic?.voiceSettings ? 'EXISTS' : 'MISSING');
}

if (elevenLabsVoice && responseText) {
  // Use ElevenLabs
} else {
  // Fallback to Twilio
  logger.warn('⚠️ [FALLBACK] Using Twilio voice due to missing ElevenLabs config');
}
```

---

## 📁 TRUTH FILES (Verified to Exist)

### ✅ Active Files (Currently Running)

```
routes/v2twilio.js (2,901 lines)
  ├─ Line 534: POST /voice (initial call)
  ├─ Line 1619: POST /v2-agent-respond/:companyID (second leg)
  └─ Line 1867: POST /test-respond/:templateId (test pilot)

services/v2AIAgentRuntime.js
  ├─ initializeCall() - First leg initialization
  └─ processUserInput() - Second leg processing

services/v2elevenLabsService.js
  └─ synthesizeSpeech() - ElevenLabs TTS generation

models/v2Company.js
  └─ Schema defines aiAgentLogic.voiceSettings

index.js
  └─ Line 363: Mounts Twilio routes at /api/twilio
```

### ❌ Files That Don't Exist (Clean Rebuild Was Reverted)

```
routes/twilio/index.js (documented but NOT in codebase)
routes/twilio/webhook-entry.js (documented but NOT in codebase)
routes/twilio/greeting-generator.js (documented but NOT in codebase)
routes/twilio/agent-respond.js (documented but NOT in codebase)
routes/twilio/voice-synthesis.js (documented but NOT in codebase)
```

**Conclusion:** You're running on the LEGACY v2twilio.js monolithic file.

---

## 🎯 NEXT STEPS (In Order)

### Phase 1: DIAGNOSIS (Current Phase)

1. ✅ Map current file structure
2. ✅ Identify exact break point (line 1703)
3. ✅ Understand data flow
4. ⏳ **ADD ENHANCED LOGGING** (see "Verification Needed" section)
5. ⏳ Make test call and capture FULL logs
6. ⏳ Analyze logs to confirm root cause

### Phase 2: SURGICAL FIX (After Diagnosis Confirms)

**Option A: Minimal Fix (if voice settings are the only issue)**
- Fix line 1688: Use better company load method
- Fix line 1753: Use absolute URL
- Add error logging
- Test again

**Option B: Complete Rebuild (if AICore isn't loading)**
- Implement clean modular structure (routes/twilio/)
- Separate concerns (webhook → greeting → agent → voice)
- Based on MASTER-SYSTEM-CONNECTION-MAP.md
- World-class documentation
- Zero legacy dependencies

### Phase 3: VERIFICATION

1. Deploy to Render
2. Make test call to Royal Plumbing test number
3. Verify:
   - ✅ Greeting plays in ElevenLabs voice
   - ✅ AI response plays in SAME ElevenLabs voice
   - ✅ Templates load correctly
   - ✅ 3-tier intelligence engages
   - ✅ Variables/fillers work
4. Check production with real customer

---

## 📚 RELATED DOCUMENTATION

- `MASTER-SYSTEM-CONNECTION-MAP.md` (2,632 lines) - System architecture (partially outdated)
- Render logs (provided by user) - Shows first leg working, second leg breaking

---

## 🔥 KEY INSIGHT

**The Problem Is NOT Routing:**
- The `/v2-agent-respond` endpoint IS being hit ✅
- The `processUserInput()` IS being called ✅

**The Problem IS Data Loading:**
- First leg: Company loaded with full voice settings ✅
- Second leg: Company loaded BUT voice settings missing ❌

**Why This Happens:**
- Different loading methods used
- Possible schema/populate mismatch
- Possible caching issue (Redis vs fresh DB load)
- Possible test mode context loss

**The Fix:**
- Use consistent company loading across both legs
- Add proper `.populate()` and `.select()` clauses
- Add comprehensive error logging
- Fix relative URL to absolute URL

---

**END OF DISCOVERY REPORT**

**Status:** ✅ Root cause theories identified  
**Next Action:** Add enhanced logging and make test call  
**Goal:** Confirm which theory is correct before coding fix

