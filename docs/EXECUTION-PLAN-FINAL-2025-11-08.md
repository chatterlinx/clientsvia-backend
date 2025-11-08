# 🎯 EXECUTION PLAN: LOCK THE SPINE & FIX THE BUGS
**Date:** November 8, 2025  
**Chief Engineer Decision:** LOCKED  
**Status:** Ready for execution  
**No Bullshit:** This is the war plan

---

## 🔥 STRATEGIC DECISIONS (LOCKED)

### DECISION #1: v2twilio.js IS THE CANONICAL SPINE

**What this means:**
- ✅ `routes/v2twilio.js` (2,901 lines) is production
- ❌ New modular `routes/twilio/*` is DEFERRED (was reverted, stays reverted)
- ✅ We surgically fix v2twilio.js, not rebuild it

**Rationale:**
- It's running in production NOW
- Revert already happened (new build didn't work)
- Fastest path to stability = fix what's live
- Can refactor AFTER it's stable

**Consequence:**
- All fixes go into `routes/v2twilio.js`
- All other Twilio routes = legacy or ghost (kill them)
- Blueprint maps to THIS file's flow

---

### DECISION #2: PRIORITY ORDER FOR 5 ISSUES

Based on your feedback, here's the LOCKED priority:

**MUST FIX (Blockers):**
1. ✅ **Issue #1: Voice continuity bug** - Highest impact
   - Second leg loses voice settings
   - Falls back to Twilio default female voice
   - User-facing, breaks experience

2. ✅ **Issue #2: Custom fillers not used** - UI lies to user
   - Companies add custom fillers in UI
   - Runtime ignores them
   - Integrity issue

**SHOULD FIX (Performance):**
3. ⚠️ **Issue #3: Scenario pool cache** - 80ms saved per call
   - Not a blocker, but measurable improvement
   - Easy win after blockers fixed

4. ⚠️ **Issue #4: Company loaded 6-8 times** - Latency/cost
   - Clean-up task
   - Requires architectural change (pass context)
   - Defer until after blockers

**OPTIONAL (Environment-specific):**
5. 🔵 **Issue #5: Relative vs absolute URL** - Only if infra needs it
   - Twilio works with relative URLs fine
   - Only change if logs show routing failures
   - Lowest priority

---

### DECISION #3: GHOST KILLING IS STEP 0

**Before ANY fixes:**
- ✅ Inventory all Twilio mounts in `server.js`/`index.js`
- ✅ Confirm exactly ONE route at `/api/twilio`
- ✅ Disable/unmount all others
- ✅ Verify Twilio Console points to correct webhook

**Why this first:**
- Ghost routes invalidate ALL debugging
- Can't fix what you can't trace
- Fixes won't work if wrong code runs

---

## 📋 EXECUTION CHECKLIST

### PHASE 0: KILL THE GHOSTS (DO THIS FIRST!)

#### 0.1. Inventory Twilio Mounts

- [ ] Open `index.js` (main app file)
- [ ] Search for: `app.use('/api/twilio'`
- [ ] List every mount found:
  ```
  Line: ___ → require('./routes/v2twilio')
  Line: ___ → require('./routes/twilio/index')  (if exists)
  Line: ___ → require('./routes/...')  (any others)
  ```

**ACCEPTANCE:**
- [ ] Exactly ONE `app.use('/api/twilio', routes.v2TwilioRoutes);`
- [ ] All others commented out or deleted

**File to check:** `/Users/marc/MyProjects/clientsvia-backend/index.js`

---

#### 0.2. Inventory Twilio Voice Endpoints

- [ ] Search codebase for: `router.post('/voice'`
- [ ] List every handler:
  ```
  File: routes/v2twilio.js, Line: 534
  File: routes/twilio/webhook-entry.js, Line: ___ (if exists)
  File: ___ (any others)
  ```

**ACCEPTANCE:**
- [ ] Exactly ONE `/voice` handler in v2twilio.js
- [ ] All others are unmounted or don't exist

---

#### 0.3. Twilio Console Verification

For EACH production/test number:

- [ ] Log into Twilio Console
- [ ] Go to Phone Numbers → Active Numbers
- [ ] For `+12392322030` (Royal Plumbing test):
  - [ ] "A CALL COMES IN" = Webhook
  - [ ] URL = `https://clientsvia-backend.onrender.com/api/twilio/voice`
  - [ ] Method = POST
  - [ ] No Studio Flow attached
  - [ ] No TwiML Bin attached

**ACCEPTANCE:**
- [ ] Every number points to YOUR canonical webhook
- [ ] No legacy URLs in Twilio Console

---

### PHASE 1: PROVE THE SPINE (BASELINE)

#### 1.1. Add/Verify Critical Logs

**File:** `routes/v2twilio.js`

**Line ~534 (POST /voice handler):**
```javascript
router.post('/voice', async (req, res) => {
  console.log('═'.repeat(80));
  console.log('[🎯 ENTRY] Twilio /voice hit');
  console.log('CallSid:', req.body.CallSid);
  console.log('From:', req.body.From);
  console.log('To:', req.body.To);
  console.log('═'.repeat(80));
  
  // ... existing code
});
```

**Line ~1619 (POST /v2-agent-respond handler):**
```javascript
router.post('/v2-agent-respond/:companyID', async (req, res) => {
  console.log('═'.repeat(80));
  console.log('[🎯 AGENT-RESPOND] User input received');
  console.log('CompanyID:', req.params.companyID);
  console.log('User text:', req.body.SpeechResult);
  console.log('═'.repeat(80));
  
  // ... existing code
});
```

**ACCEPTANCE:**
- [ ] Logs are clear and unique
- [ ] Can grep Render logs for `[🎯 ENTRY]` and `[🎯 AGENT-RESPOND]`

---

#### 1.2. Live Call Test (Baseline)

- [ ] Call Royal Plumbing test number: `+12392322030`
- [ ] Let it ring through greeting
- [ ] Say something: "I need an appointment"
- [ ] Check Render logs:

**Expected logs (in order):**
```
[🎯 ENTRY] Twilio /voice hit
[PHONE LOOKUP] Searching for company with phone: +12392322030
[COMPANY FOUND] Royal Plumbing (ID: 68e3f77a...)
[ACCOUNT STATUS] Active - proceeding to AI agent
[V2 GREETING] Generating greeting for Royal Plumbing
[TTS COMPLETE] AI Agent Logic greeting TTS completed
[🎯 AGENT-RESPOND] User input received
[V2 RESPONSE] Generating V2 response for: "I need an appointment"
[INTELLIGENT ROUTER] Starting 3-tier cascade
[TIER 1] Result: matched=true, confidence=0.96
[V2 ELEVENLABS] Using voice UgBBYS2sOqTuMpoF3BR0
```

**ACCEPTANCE:**
- [ ] See `[🎯 ENTRY]` exactly once
- [ ] See `[🎯 AGENT-RESPOND]` for each user turn
- [ ] NO logs from legacy files (check for old patterns)

**If you see logs from other files → STOP, go back to Phase 0**

---

### PHASE 2: FIX ISSUE #1 (VOICE CONTINUITY BUG)

**The Problem:**
- Greeting uses ElevenLabs ✅
- Response falls back to Twilio voice ❌
- Root cause: `Company.findById()` incomplete in second leg

---

#### 2.1. Verify Current Behavior

**File:** `routes/v2twilio.js`, Line ~1688

Current code:
```javascript
const company = await Company.findById(companyID);
const elevenLabsVoice = company?.aiAgentLogic?.voiceSettings?.voiceId;
```

Add diagnostic log BEFORE the voice check:
```javascript
const company = await Company.findById(companyID);

console.log('═'.repeat(80));
console.log('[🔍 VOICE DEBUG] Second leg company load:');
console.log('Company exists:', Boolean(company));
console.log('aiAgentLogic exists:', Boolean(company?.aiAgentLogic));
console.log('voiceSettings exists:', Boolean(company?.aiAgentLogic?.voiceSettings));
console.log('voiceId:', company?.aiAgentLogic?.voiceSettings?.voiceId || 'UNDEFINED');
console.log('Full voiceSettings:', JSON.stringify(company?.aiAgentLogic?.voiceSettings, null, 2));
console.log('═'.repeat(80));

const elevenLabsVoice = company?.aiAgentLogic?.voiceSettings?.voiceId;
```

**Test:**
- [ ] Make a call
- [ ] Check logs for `[🔍 VOICE DEBUG]`
- [ ] Document what's missing:
  - [ ] voiceId = UNDEFINED → Confirm bug
  - [ ] voiceSettings = null → Schema issue
  - [ ] aiAgentLogic = null → Load issue

---

#### 2.2. Fix: Use Consistent Company Loading

**Option A: Copy first leg's loading method**

Find the `getCompanyByPhoneNumber()` function (line ~50-100):
```javascript
async function getCompanyByPhoneNumber(phoneNumber) {
  const company = await Company.findOne({
    $or: [
      { 'twilioConfig.phoneNumber': phoneNumber },
      { 'twilioConfig.phoneNumbers.phoneNumber': phoneNumber }
    ]
  })
  .populate('aiAgentSettings.templateReferences.templateId')
  .lean();
  
  return company;
}
```

**Change line ~1688 from:**
```javascript
const company = await Company.findById(companyID);
```

**To:**
```javascript
const company = await Company.findById(companyID)
  .select('+aiAgentLogic.voiceSettings +aiAgentSettings')
  .populate('aiAgentSettings.templateReferences.templateId')
  .lean();
```

**OR Option B (simpler): Cache company in session**

First leg (line ~870):
```javascript
// After loading company
req.session = req.session || {};
req.session.company = company;  // Store full company object
```

Second leg (line ~1688):
```javascript
// Try session first
const company = req.session?.company || await Company.findById(companyID)
  .select('+aiAgentLogic.voiceSettings')
  .lean();
```

**RECOMMENDATION: Use Option A (explicit select)**
- More explicit
- Doesn't rely on session middleware
- Easier to debug

---

#### 2.3. Test Fix

- [ ] Deploy changes
- [ ] Call Royal Plumbing test number
- [ ] Greeting should play in ElevenLabs voice (Mark) ✅
- [ ] Say: "I need an appointment"
- [ ] Response should ALSO play in ElevenLabs voice (Mark) ✅

**Check logs:**
```
[🔍 VOICE DEBUG] Second leg company load:
voiceId: UgBBYS2sOqTuMpoF3BR0  ← Should now be present!
[V2 ELEVENLABS] Using voice UgBBYS2sOqTuMpoF3BR0
✅ V2 ELEVENLABS: Audio generated and stored
```

**ACCEPTANCE:**
- [ ] Hear Mark voice for both greeting AND response
- [ ] NO fallback to Twilio default voice
- [ ] Logs show voiceId present in second leg

**If still broken:** Check `models/v2Company.js` schema - voiceSettings might be marked as select: false

---

### PHASE 3: FIX ISSUE #2 (CUSTOM FILLERS NOT USED)

**The Problem:**
- Companies add custom fillers in UI
- `IntelligentRouter.buildEffectiveFillers()` only loads template fillers
- Custom fillers ignored at runtime

---

#### 3.1. Verify Current Behavior

**File:** `services/IntelligentRouter.js`, Line ~806

Current code:
```javascript
buildEffectiveFillers(template) {
  const templateFillers = template.fillerWords || [];
  const allFillers = [...templateFillers];
  
  template.categories.forEach(category => {
    if (category.additionalFillerWords && Array.isArray(category.additionalFillerWords)) {
      allFillers.push(...category.additionalFillerWords);
    }
  });
  
  return [...new Set(allFillers)];
}
```

Add diagnostic log:
```javascript
buildEffectiveFillers(template, company) {  // ← Add company parameter
  const templateFillers = template.fillerWords || [];
  const customFillers = company?.aiAgentSettings?.fillerWords?.custom || [];
  
  console.log('[🔍 FILLER DEBUG]');
  console.log('Template fillers:', templateFillers.length);
  console.log('Custom fillers:', customFillers.length);
  console.log('Custom words:', customFillers);
  
  const allFillers = [...templateFillers, ...customFillers];
  
  template.categories.forEach(category => {
    if (category.additionalFillerWords && Array.isArray(category.additionalFillerWords)) {
      allFillers.push(...category.additionalFillerWords);
    }
  });
  
  const deduplicated = [...new Set(allFillers)];
  console.log('Total effective fillers:', deduplicated.length);
  
  return deduplicated;
}
```

**Test:**
- [ ] Add custom filler in UI: "thingy"
- [ ] Make a call saying: "um like I need the thingy to get fixed"
- [ ] Check logs for `[🔍 FILLER DEBUG]`
- [ ] Verify custom fillers NOT in effective list (confirms bug)

---

#### 3.2. Fix: Include Custom Fillers

**File:** `services/IntelligentRouter.js`

**Line ~530 (where buildEffectiveFillers is called):**

Change from:
```javascript
const effectiveFillers = this.buildEffectiveFillers(template);
```

To:
```javascript
const effectiveFillers = this.buildEffectiveFillers(template, company);
```

**Line ~806 (buildEffectiveFillers function):**

Already fixed in diagnostic step above. Final version:
```javascript
buildEffectiveFillers(template, company) {
  const templateFillers = template.fillerWords || [];
  const customFillers = company?.aiAgentSettings?.fillerWords?.custom || [];
  const allFillers = [...templateFillers, ...customFillers];
  
  template.categories.forEach(category => {
    if (category.additionalFillerWords && Array.isArray(category.additionalFillerWords)) {
      allFillers.push(...category.additionalFillerWords);
    }
  });
  
  return [...new Set(allFillers)];  // Deduplicate
}
```

---

#### 3.3. Test Fix

- [ ] Add custom filler "thingy" in UI (if not already)
- [ ] Deploy changes
- [ ] Call and say: "um like I need the thingy to get fixed"
- [ ] Check logs:
  ```
  [🔍 FILLER DEBUG]
  Template fillers: 42
  Custom fillers: 1
  Custom words: ["thingy"]
  Total effective fillers: 43
  ```

**ACCEPTANCE:**
- [ ] Custom fillers appear in effective filler count
- [ ] "thingy" is removed from input before matching
- [ ] UI no longer lies about custom fillers

---

### PHASE 4: OPTIMIZE ISSUE #3 (SCENARIO POOL CACHE)

**The Problem:**
- ScenarioPoolService loads from MongoDB every call (~80ms)
- Should use Redis cache (5 min TTL)

**Priority:** Performance optimization (do after blockers)

---

#### 4.1. Add Redis Cache

**File:** `services/ScenarioPoolService.js`, Line ~41

**Change from:**
```javascript
static async getScenarioPoolForCompany(companyId, _options = {}) {
  const startTime = Date.now();
  
  logger.info(`📚 [SCENARIO POOL] Building scenario pool for company: ${companyId}`);
  
  try {
    // Load company...
```

**To:**
```javascript
static async getScenarioPoolForCompany(companyId, _options = {}) {
  const startTime = Date.now();
  const cacheKey = `scenario-pool:${companyId}`;
  const CACHE_TTL = 300; // 5 minutes
  
  logger.info(`📚 [SCENARIO POOL] Building scenario pool for company: ${companyId}`);
  
  try {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 1: CHECK REDIS CACHE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const { redisClient } = require('../db');
    
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        logger.info(`✅ [SCENARIO POOL CACHE] Cache HIT (${Date.now() - startTime}ms)`);
        return parsed;
      }
    } catch (cacheError) {
      logger.warn(`⚠️ [SCENARIO POOL CACHE] Redis error (non-critical):`, cacheError.message);
      // Continue to MongoDB fallback
    }
    
    logger.info(`⚪ [SCENARIO POOL CACHE] Cache MISS, loading from MongoDB...`);
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 2: LOAD FROM MONGODB (existing code)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ... existing company loading code ...
```

**At the end of the function (before return):**
```javascript
    const result = {
      scenarios: scenarioPool,
      templatesUsed
    };
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 3: CACHE RESULT IN REDIS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    try {
      await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(result));
      logger.info(`💾 [SCENARIO POOL CACHE] Cached for ${CACHE_TTL}s`);
    } catch (cacheError) {
      logger.warn(`⚠️ [SCENARIO POOL CACHE] Failed to cache:`, cacheError.message);
    }
    
    return result;
```

---

#### 4.2. Cache Invalidation (Already Exists!)

**Verify these files already clear the cache:**

**File:** `routes/company/v2companyConfiguration.js`
- Line ~1986: Clear cache when template added
- Line ~2089: Clear cache when template removed

**File:** `routes/company/v2aiCoreScenarios.js`
- Line ~149: Clear cache when scenario disabled

**Add to cache clearing:**
```javascript
await redisClient.del(`scenario-pool:${companyId}`);  // Add this line
await redisClient.del(`live-scenarios:${companyId}`); // Existing
```

---

#### 4.3. Test Cache

- [ ] First call: Check logs show `Cache MISS`
- [ ] Second call (within 5 min): Check logs show `Cache HIT`
- [ ] Add template in UI
- [ ] Next call: Check logs show `Cache MISS` (cache was cleared)

**ACCEPTANCE:**
- [ ] First call: ~150ms for scenario loading
- [ ] Cached call: ~5ms for scenario loading (30x faster!)
- [ ] Cache clears when templates/scenarios change

---

### PHASE 5: VERIFY WITH 6-CALL REGRESSION TEST

Run these 6 tests in order:

#### Test 1: Happy Path (Tier 1)
- [ ] Call Royal Plumbing test number
- [ ] Say: "I need to book an appointment"
- [ ] Expected:
  - [ ] Tier 1 match (confidence ~95%)
  - [ ] Response in ~2.5 seconds
  - [ ] ElevenLabs Mark voice throughout
  - [ ] No LLM call in logs

#### Test 2: Sloppy Phrasing (Tier 2)
- [ ] Say: "um like I wanna kinda sorta maybe schedule something"
- [ ] Expected:
  - [ ] Fillers removed (check logs)
  - [ ] Tier 1 or Tier 2 match
  - [ ] ElevenLabs voice throughout
  - [ ] No LLM call

#### Test 3: Edge Case (Tier 3)
- [ ] Say: "What's your opinion on quantum computing?"
- [ ] Expected:
  - [ ] Tier 1 MISS
  - [ ] Tier 2 MISS
  - [ ] Tier 3 LLM call (check logs)
  - [ ] Still ElevenLabs voice
  - [ ] ProductionLLMSuggestion created

#### Test 4: Account Suspended
- [ ] In UI: Set Royal Plumbing accountStatus.status = "suspended"
- [ ] Call the number
- [ ] Expected:
  - [ ] Hear suspension message
  - [ ] Call hangs up
  - [ ] NO AI logs (`[V2 RESPONSE]` should NOT appear)

#### Test 5: Call Forward
- [ ] In UI: Set accountStatus.status = "call_forward"
- [ ] Set callForwardNumber = your cell phone
- [ ] Call the number
- [ ] Expected:
  - [ ] Call forwards to your cell
  - [ ] NO AI logs

#### Test 6: ElevenLabs Failure
- [ ] In UI: Set voiceSettings.apiKey = "invalid"
- [ ] Call the number
- [ ] Expected:
  - [ ] Greeting still works (uses platform API key)
  - [ ] Response falls back to Twilio voice (graceful)
  - [ ] Logs show: `[ELEVENLABS] Failed, falling back`
  - [ ] NOT silent failure

---

## 📊 FINAL ACCEPTANCE CRITERIA

Before calling this DONE:

### Functional Requirements:
- [ ] ✅ Every call enters through ONE route
- [ ] ✅ Account status gate works (suspend/forward/active)
- [ ] ✅ Greeting uses connectionMessages correctly
- [ ] ✅ ElevenLabs voice works for greeting AND responses
- [ ] ✅ 3-tier intelligence engages (logs prove it)
- [ ] ✅ Templates + scenarios load correctly
- [ ] ✅ Custom fillers actually work at runtime
- [ ] ✅ Variables replace correctly

### Performance Requirements:
- [ ] ⚠️ Scenario pool cached (5 min TTL)
- [ ] ⚠️ First call: ~2.5s (Tier 1)
- [ ] ⚠️ Cached call: ~2.3s (cache hit)

### Monitoring Requirements:
- [ ] 📊 Clear logs for every phase
- [ ] 📊 Can grep for `[🎯 ENTRY]`, `[🎯 AGENT-RESPOND]`
- [ ] 📊 Can trace from CallSid through entire flow
- [ ] 📊 No ghost route logs appear

---

## 🚨 ISSUES DEFERRED (FOR LATER)

### Issue #4: Company Loaded 6-8 Times
**Why deferred:**
- Requires architectural change (pass context through)
- Works correctly, just inefficient
- Fix after stability proven

**Future approach:**
- Load company once at entry
- Store in `context` object
- Pass through all services
- Reduce to 1-2 MongoDB queries per call

### Issue #5: Relative vs Absolute URLs
**Why deferred:**
- Twilio works fine with relative URLs
- Only change if production shows routing failures
- Environment-specific, not universal

---

## 📁 FILES TO MODIFY (SUMMARY)

### MUST EDIT:
1. ✅ `routes/v2twilio.js`
   - Add diagnostic logs (Phase 1)
   - Fix company loading in second leg (Phase 2, line ~1688)

2. ✅ `services/IntelligentRouter.js`
   - Add company parameter to buildEffectiveFillers (Phase 3, line ~806)
   - Call with company parameter (line ~530)

3. ✅ `services/ScenarioPoolService.js`
   - Add Redis caching (Phase 4, line ~41)

4. ✅ `routes/company/v2companyConfiguration.js`
   - Add scenario-pool cache clearing (line ~1986, ~2089)

5. ✅ `routes/company/v2aiCoreScenarios.js`
   - Add scenario-pool cache clearing (line ~149)

### VERIFY ONLY (NO CHANGES):
- `index.js` - Confirm only one Twilio mount
- `models/v2Company.js` - Verify voiceSettings schema
- Twilio Console - Verify webhook URLs

---

## 🎯 EXECUTION ORDER (DO NOT SKIP STEPS)

```
PHASE 0: Kill Ghosts (30 min)
  ├─ Inventory mounts
  ├─ Disable legacy routes
  └─ Verify Twilio Console

PHASE 1: Prove Spine (30 min)
  ├─ Add logs
  ├─ Test baseline call
  └─ Confirm no ghost routes fire

PHASE 2: Fix Voice Bug (1 hour)
  ├─ Add diagnostic logs
  ├─ Verify bug exists
  ├─ Fix company loading
  ├─ Test voice continuity
  └─ Remove diagnostic logs

PHASE 3: Fix Custom Fillers (30 min)
  ├─ Add diagnostic logs
  ├─ Verify bug exists
  ├─ Add company parameter
  ├─ Include custom fillers
  └─ Test with custom filler

PHASE 4: Add Scenario Cache (30 min)
  ├─ Add Redis read
  ├─ Add Redis write
  ├─ Add cache clearing
  └─ Test cache hit/miss

PHASE 5: Regression Test (1 hour)
  ├─ Test 1: Happy path
  ├─ Test 2: Sloppy input
  ├─ Test 3: LLM fallback
  ├─ Test 4: Suspended
  ├─ Test 5: Forward
  └─ Test 6: ElevenLabs failure

TOTAL TIME: ~4 hours (assuming no surprises)
```

---

## ✅ SIGN-OFF CHECKLIST

Before declaring COMPLETE:

- [ ] All Phase 0 boxes checked (ghost routes killed)
- [ ] All Phase 1 boxes checked (spine proven)
- [ ] All Phase 2 boxes checked (voice fixed)
- [ ] All Phase 3 boxes checked (fillers fixed)
- [ ] All Phase 4 boxes checked (cache added)
- [ ] All 6 regression tests pass
- [ ] Final acceptance criteria met
- [ ] Production deploy completed
- [ ] Monitored for 24 hours with no issues

**When all checked:** Platform is PRODUCTION-READY ✅

---

**END OF EXECUTION PLAN**

**Status:** LOCKED - Ready for execution  
**Chief Engineer:** Approved  
**No Bullshit:** Every step is testable and verifiable

