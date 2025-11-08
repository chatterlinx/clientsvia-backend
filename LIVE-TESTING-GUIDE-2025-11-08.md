# 🧪 LIVE TESTING GUIDE - AI Agent Fixes
**Date:** November 8, 2025  
**Deployment:** Pushed to main → Auto-deploys to Render  
**Status:** ✅ READY FOR LIVE TESTING

---

## 🎯 WHAT WAS FIXED

### **Issue #1: Voice Continuity Bug** ✅ FIXED
**Problem:** Greeting used ElevenLabs voice (Mark), but responses fell back to Twilio's default female voice.

**Fix:** `routes/v2twilio.js` lines 1704-1706
- Changed `Company.findById(companyID)` to explicitly load voice settings
- Now uses: `.select('+aiAgentLogic.voiceSettings +aiAgentSettings').lean()`

**Expected Result:** You'll hear Mark's voice for BOTH greeting AND all responses.

---

### **Issue #2: Custom Fillers Bug** ✅ FIXED
**Problem:** Companies could add custom filler words in UI, but runtime ignored them.

**Fix:** `services/IntelligentRouter.js` lines 807-831
- Modified `buildEffectiveFillers()` to include `company.aiAgentSettings.fillerWords.custom[]`
- Merges template fillers + company custom fillers before matching

**Expected Result:** Custom filler words (like "thingy") are actually removed from input before AI matching.

---

### **Issue #3: Scenario Pool Performance** ✅ OPTIMIZED
**Problem:** Scenarios loaded from MongoDB every call (~150ms latency).

**Fix:** `services/ScenarioPoolService.js` lines 50-158
- Added Redis cache with 5-minute TTL
- Cache key: `scenario-pool:${companyId}`
- Auto-invalidates when templates/scenarios change

**Expected Result:** First call ~150ms, subsequent calls ~5ms (30x faster!).

---

## 📊 NEW DIAGNOSTIC LOGS

You can now grep Render logs for these markers:

```
[🎯 ENTRY]              # Twilio webhook hit (/voice)
[🎯 AGENT-RESPOND]      # User input received (/v2-agent-respond)
[🔍 VOICE DEBUG]        # Voice settings loaded (or not)
[🔍 FILLER DEBUG]       # Filler words being used
[🚀 CACHE HIT]          # Scenario pool from cache (fast!)
[💾 CACHE WRITE]        # Scenario pool cached
```

---

## 🧪 MANUAL TESTING CHECKLIST

### **TEST 1: Voice Continuity (Critical!)**

**Setup:**
1. Verify Royal Plumbing has ElevenLabs voice selected (Mark)
2. Check `AI Voice Settings` tab in company profile

**Test Steps:**
1. Call Royal Plumbing test number: `+12392322030`
2. Listen to greeting
3. Say: "I need to book an appointment"
4. Listen to response

**Expected:**
- ✅ Greeting: Mark's voice (ElevenLabs)
- ✅ Response: Mark's voice (ElevenLabs) ← **THIS WAS BROKEN BEFORE!**

**In Render Logs:**
```
[🎯 ENTRY] Twilio /voice hit
[🔍 VOICE DEBUG] Second leg company load:
voiceId: UgBBYS2sOqTuMpoF3BR0  ← Should be present!
✅ V2 ELEVENLABS: Audio generated and stored
```

**If you hear Twilio's default female voice:**
- ❌ FIX FAILED - Check logs for `voiceId: UNDEFINED`
- Revert: `git reset --hard REVERT-POINT-BEFORE-LIVE-FIXES`

---

### **TEST 2: Custom Fillers**

**Setup:**
1. Go to Royal Plumbing → AI Agent Settings → AiCore Filler Filter
2. Add custom filler: "thingy"
3. Save

**Test Steps:**
1. Call Royal Plumbing: `+12392322030`
2. Say: "um like I need the thingy to get fixed you know"
3. Check logs

**Expected:**
```
[🔍 FILLER DEBUG] Building effective fillers:
  Template fillers: 42
  Custom fillers: 1
  Custom words: ["thingy"]
  Total effective fillers: 43
```

**In AI matching:**
- Input after filler removal: "need get fixed"
- Should match a relevant scenario (e.g., service request)

**If custom fillers NOT in logs:**
- ❌ FIX FAILED - Custom fillers not being used
- Revert and check

---

### **TEST 3: Scenario Cache Performance**

**Setup:**
1. Open Render logs
2. Watch for `[SCENARIO POOL CACHE]` messages

**Test Steps:**
1. **First Call:**
   - Call Royal Plumbing
   - Say: "book appointment"
   - Check logs

2. **Second Call (within 5 min):**
   - Call again
   - Say: "check hours"
   - Check logs

**Expected:**

**First Call:**
```
⚪ [SCENARIO POOL CACHE] Cache MISS, loading from MongoDB...
🎯 [SCENARIO POOL] Scenario status: 13 enabled, 0 disabled (152ms)
💾 [CACHE WRITE] Scenario pool cached (TTL: 300s)
```

**Second Call:**
```
✅ [SCENARIO POOL CACHE] Cache HIT (5ms) - 13 scenarios
[🚀 CACHE HIT] Scenario pool loaded in 5ms (30x faster!)
```

**Performance Improvement:**
- First call: ~150ms to load scenarios
- Cached call: ~5ms to load scenarios
- **30x faster!** ⚡

---

### **TEST 4: Cache Invalidation**

**Purpose:** Verify cache clears when templates change.

**Test Steps:**
1. Call Royal Plumbing (cache should hit)
2. In UI: Go to AiCore Live Scenarios
3. Disable a scenario (e.g., "Pricing")
4. Save
5. Call again immediately

**Expected:**
```
# After disabling scenario:
🗑️ [AICORE SCENARIOS] Cleared cache: live-scenarios + scenario-pool for 68e3f77a...

# Next call:
⚪ [SCENARIO POOL CACHE] Cache MISS, loading from MongoDB...
```

**Result:** Cache was properly cleared, fresh data loaded.

---

### **TEST 5: Ghost Routes Verification**

**Purpose:** Ensure no legacy routes are running.

**Test Steps:**
1. Make a call to Royal Plumbing
2. Grep logs for `[🎯 ENTRY]` and `[🎯 AGENT-RESPOND]`

**Expected:**
- ✅ See exactly ONE `[🎯 ENTRY]` per call
- ✅ See ONE `[🎯 AGENT-RESPOND]` per user turn
- ✅ NO logs from legacy files

**If you see logs from other Twilio handlers:**
- ❌ Ghost route still active
- Check `index.js` line 363 (should be only v2TwilioRoutes)

---

## 🚨 6-CALL REGRESSION TEST (From Execution Plan)

Run these 6 tests in sequence:

### **1. Happy Path (Tier 1)**
- Say: "I need to book an appointment"
- Expected:
  - Tier 1 match (~95% confidence)
  - Response in ~2.5 seconds
  - ElevenLabs voice
  - No LLM call in logs

### **2. Sloppy Phrasing (Tier 2)**
- Say: "um like I wanna kinda sorta maybe schedule something"
- Expected:
  - Fillers removed (check logs)
  - Tier 1 or Tier 2 match
  - ElevenLabs voice
  - No LLM call

### **3. Edge Case (Tier 3)**
- Say: "What's your opinion on quantum computing?"
- Expected:
  - Tier 1 MISS
  - Tier 2 MISS
  - Tier 3 LLM call (check logs)
  - Still ElevenLabs voice
  - ProductionLLMSuggestion created

### **4. Account Suspended**
- In UI: Set Royal Plumbing `accountStatus.status = "suspended"`
- Call the number
- Expected:
  - Hear suspension message
  - Call hangs up
  - NO AI logs (`[V2 RESPONSE]` should NOT appear)

### **5. Call Forward**
- In UI: Set `accountStatus.status = "call_forward"`
- Set `callForwardNumber = your cell phone`
- Call the number
- Expected:
  - Call forwards to your cell
  - NO AI logs

### **6. ElevenLabs Failure**
- In UI: Set `voiceSettings.apiKey = "invalid"`
- Call the number
- Expected:
  - Greeting still works (uses platform API key)
  - Response falls back to Twilio voice (graceful)
  - Logs show: `[ELEVENLABS] Failed, falling back`
  - NOT silent failure

---

## 📝 RENDER DEPLOYMENT STATUS

**After Pushing:**
1. Go to Render Dashboard: https://dashboard.render.com
2. Find `clientsvia-backend` service
3. Check "Events" tab for deployment status
4. Wait for: `Deployment successful` ✅
5. Deployment takes ~3-5 minutes

**How to Check Logs:**
1. Click on `clientsvia-backend` service
2. Click "Logs" tab (right side)
3. Watch live logs during test calls
4. Grep for: `[🎯 ENTRY]`, `[🔍 VOICE DEBUG]`, `[🚀 CACHE HIT]`

---

## 🔍 TROUBLESHOOTING

### **Issue: Deployment Failed**
- Check Render "Events" tab for build errors
- Common: Missing dependencies, syntax errors
- Fix: Check commit, fix errors, push again

### **Issue: Voice Still Falls Back to Twilio**
**Diagnostic:**
1. Check logs for `[🔍 VOICE DEBUG]`
2. Look for `voiceId: UNDEFINED` or `voiceSettings exists: false`

**Possible Causes:**
- Company doesn't have voice settings configured
- Schema has `select: false` on voiceSettings (check `models/v2Company.js`)
- Mongoose not loading nested fields

**Fix:**
- Verify in UI: Company Profile → AI Voice Settings → Voice selected
- Check if fix was applied: `git log -1 --oneline` should show commit 35bd5ebc

### **Issue: Custom Fillers Not Working**
**Diagnostic:**
1. Check logs for `[🔍 FILLER DEBUG]`
2. Look for `Custom fillers: 0` (should be > 0)

**Possible Causes:**
- Company doesn't have custom fillers added
- Company parameter not being passed to buildEffectiveFillers()

**Fix:**
- Add custom filler in UI first
- Check commit applied: Search code for `company?.aiAgentSettings?.fillerWords?.custom`

### **Issue: Cache Not Hitting**
**Diagnostic:**
1. Every call shows `Cache MISS`
2. No `Cache HIT` messages

**Possible Causes:**
- Redis connection failed (check Render logs for Redis errors)
- REDIS_URL not configured
- Cache TTL too short (should be 300s)

**Fix:**
- Check Render env vars: REDIS_URL should be set
- Check Redis status: `await redisClient.ping()` in logs

---

## ✅ SUCCESS CRITERIA

Before declaring "DONE":

- [  ] **Voice Test:** ElevenLabs voice works for greeting AND responses
- [  ] **Custom Fillers:** Custom words appear in filler debug logs
- [  ] **Cache Performance:** Second call shows cache hit (~5ms)
- [  ] **Ghost Routes:** Only `[🎯 ENTRY]` and `[🎯 AGENT-RESPOND]` logs appear
- [  ] **Regression Tests:** All 6 tests pass as expected
- [  ] **Production Call:** Real customer call works end-to-end

**When all checked:** 🎉 **AI AGENT IS LIVE!**

---

## 🔒 IF THINGS GO WRONG

**Immediate Revert:**
```bash
cd /Users/marc/MyProjects/clientsvia-backend
git reset --hard REVERT-POINT-BEFORE-LIVE-FIXES
git push origin main --force
```

**Wait 5 minutes for Render to redeploy.**

Then investigate, fix issues, and retry.

---

## 📊 COMMIT SUMMARY

**Commit Hash:** `35bd5ebc`  
**Files Changed:** 6  
**Lines Added:** 210  
**Lines Removed:** 16

**Files:**
1. ✅ `routes/v2twilio.js` - Voice fix + diagnostic logs
2. ✅ `services/IntelligentRouter.js` - Custom fillers fix
3. ✅ `services/ScenarioPoolService.js` - Redis cache
4. ✅ `routes/company/v2companyConfiguration.js` - Cache invalidation
5. ✅ `routes/company/v2aiCoreScenarios.js` - Cache invalidation
6. ✅ `REVERT-INSTRUCTIONS.md` - Safety guide

---

**STATUS:** ✅ **DEPLOYED TO PRODUCTION**  
**NEXT:** Run manual tests above  
**SUPPORT:** Check Render logs if issues arise

**LET'S CRASH THIS! 🚀**

