# Why Agent Is Deviating - Diagnostic Checklist
**Created:** 2026-02-28  
**Problem:** Agent giving generic responses instead of matching triggers

---

## 🔴 **THE SYMPTOMS**

**From Call Transcripts:**
- Caller: "Hi I need to book an appointment"
- Agent: "Sorry — you cut out. How can I help?"

**From Call Transcripts:**
- Caller: "I have issues with my thermostat. It seems to be blank"
- Agent: "Sorry — you cut out. How can I help?"

**Pattern:** Agent always uses "you cut out" fallback, never matches triggers

---

## 🔍 **DIAGNOSTIC CHECKLIST**

### **✅ STEP 1: Is V125 Code Deployed?**

**Check:** When was production last deployed?

**V125 was committed:** 2026-02-28 ~4am
**Your test calls were:** 2026-02-28 ~12am (6 hours ago from screenshot)

**VERDICT:** ⚠️ **Calls were BEFORE V125 fix!**

**Test:** Make a NEW call NOW (after V125 deployed)
- If it works → V125 fixed it ✅
- If still broken → something else is wrong ❌

---

### **✅ STEP 2: Does Company Have Triggers Configured?**

**Check:** Company ID `68e3f77a9d623b8058c700c4` (Penguin Air)

**Query Database:**
```javascript
// Check if company has triggers
const CompanyTriggerSettings = require('./models/CompanyTriggerSettings');
const settings = await CompanyTriggerSettings.findOne({ 
  companyId: '68e3f77a9d623b8058c700c4' 
});

console.log('Active Group:', settings?.activeGroupId);
console.log('Has Triggers:', !!settings);

// Check global triggers
const GlobalTrigger = require('./models/GlobalTrigger');
const globalTriggers = await GlobalTrigger.find({}).countDocuments();
console.log('Global Triggers Count:', globalTriggers);

// Check company local triggers  
const CompanyLocalTrigger = require('./models/CompanyLocalTrigger');
const localTriggers = await CompanyLocalTrigger.find({
  companyId: '68e3f77a9d623b8058c700c4'
}).countDocuments();
console.log('Company Local Triggers:', localTriggers);

// Check legacy playbook.rules
const V2Company = require('./models/v2Company');
const company = await V2Company.findById('68e3f77a9d623b8058c700c4')
  .select('aiAgentSettings.agent2.discovery.playbook.rules');
const rulesCount = company?.aiAgentSettings?.agent2?.discovery?.playbook?.rules?.length || 0;
console.log('Legacy Playbook Rules:', rulesCount);
```

**POSSIBLE ISSUE:** Company has NO triggers configured
- No global group assigned
- No local triggers
- Empty playbook.rules
- Result: Nothing to match against!

---

### **✅ STEP 3: Is ScrabEngine Actually Running?**

**Check Events:** Look for `SCRABENGINE_PROCESSED` event in call log

**If Missing:**
- ScrabEngine might be throwing error (silently caught)
- Text might be undefined/null
- Performance issue causing timeout

**How to Test:**
```javascript
// Add debug logging in Agent2DiscoveryRunner.js:605
console.log('[DEBUG] About to call ScrabEngine with input:', input);
const scrabResult = await ScrabEngine.process({...});
console.log('[DEBUG] ScrabEngine result:', scrabResult);
```

---

### **✅ STEP 4: Is Greeting Interceptor Still Exiting Early?**

**Check:** Maybe V125 code didn't deploy correctly?

**Look for this in logs:**
```
[Greeting] Greeting detected but continuing to trigger matching
```

**If you see:**
```
GREETING_INTERCEPTED (and call ends)
```
→ Old code still running! V125 not deployed.

---

### **✅ STEP 5: Why "You Cut Out" Response?**

**This specific phrase** is suspicious. Let me search for it:

**Where does "you cut out" come from?**
- Generic fallback in Agent2DiscoveryRunner?
- Hardcoded somewhere?
- LLM generating it?

**Possible Sources:**
1. Generic no-match fallback
2. Quality gate failure (ScrabEngine rejected bad input)
3. LLM fallback generating it
4. Emergency fallback for errors

---

### **✅ STEP 6: Check Call Events (If Available)**

**From call report JSON:**
```json
"events": []
```

**THIS IS THE SMOKING GUN!**

Events array is EMPTY = **NO VISIBILITY INTO WHAT HAPPENED**

**Why Empty?**
1. CallLogger not writing events?
2. Events not persisting to CallTranscriptV2?
3. Route not returning events?
4. Old call before event logging was added?

---

## 🎯 **MY HYPOTHESIS - Ranked by Probability**

### **1. 🔴 HIGH PROBABILITY: Calls Were Before V125 (90%)**

**Evidence:**
- Screenshot shows "6h ago" (midnight)
- V125 committed at 4am
- Calls were BEFORE fix
- This explains everything:
  - Greeting saw "Hi" → exited early
  - ScrabEngine never ran
  - Triggers never evaluated
  - Fell back to generic response

**Test:** Make NEW call now, check if it works

---

### **2. 🟡 MEDIUM PROBABILITY: No Triggers Configured (60%)**

**Evidence:**
- Even if code worked, no triggers = no match
- Falls back to generic response
- "You cut out" might be the default fallback

**Test:** Query database for triggers for this company

---

### **3. 🟡 MEDIUM PROBABILITY: V125 Not Deployed (50%)**

**Evidence:**
- Code committed to git
- But production might not have pulled/redeployed
- Render auto-deploys on push (should work)
- But could have deployment failure

**Test:** Check Render deployment logs

---

### **4. 🟠 LOW PROBABILITY: ScrabEngine Failing (20%)**

**Evidence:**
- Events empty (no SCRABENGINE_PROCESSED)
- Could be silently failing
- Caught error, fell back to generic

**Test:** Check error logs for ScrabEngine exceptions

---

## 🔧 **IMMEDIATE ACTIONS TO TAKE**

### **Action 1: Verify V125 Deployment (1 minute)**

```bash
# SSH to production or check Render dashboard
# Look for: "V125: ScrabEngine-First Architecture" in logs
# Or check git commit hash on server

# If using Render, check:
# - Latest deployment shows commit 6c0652c7
# - Deployment status: Live
# - No build errors
```

### **Action 2: Make Fresh Test Call (2 minutes)**

Make a NEW call RIGHT NOW with these exact phrases:
1. "Hi I need emergency service"
2. "Hello I want to book an appointment"
3. "My thermostat is blank"

**Check:**
- Does it match triggers now?
- Do events populate?
- Is response contextual?

### **Action 3: Check Trigger Configuration (2 minutes)**

```javascript
// In browser console or backend
const companyId = '68e3f77a9d623b8058c700c4';

// Check triggers exist
fetch(`/api/admin/agent2/company/${companyId}/triggers`)
  .then(r => r.json())
  .then(d => console.log('Company triggers:', d));

// Or check in Agent Console → Triggers tab
```

### **Action 4: Check Events in Next Call (1 minute)**

After making test call:
- Open Call Console
- Click on the new call
- Check if `events: []` is still empty
- If still empty → events not being logged/persisted
- If populated → V125 is working!

---

## 💡 **MOST LIKELY ROOT CAUSE**

Based on everything, I believe:

**90% Chance:** The calls you showed were from BEFORE V125 was deployed
- Timestamp: 6 hours ago (midnight)
- V125 deployed: 4am (this morning)
- Old code had the greeting early-exit bug
- Result: Generic fallback responses

**10% Chance:** Something else (triggers disabled, deployment failed, etc.)

---

## 🚀 **NEXT STEP**

**Make a fresh test call RIGHT NOW** (after V125 deployment) and see if:
1. Triggers match ✅
2. Events populate ✅
3. Responses are contextual ✅

If it works → Problem solved by V125!
If it doesn't → We have a different issue to debug.

**Can you make a test call and share the result?**
