# V125 Testing Plan - ScrabEngine-First Architecture
**Created:** 2026-02-27  
**Version:** V125  
**Critical Fix:** ScrabEngine now runs BEFORE greeting interceptor

---

## 🎯 **What Changed in V125**

### **Code Refactor:**
- ✅ ScrabEngine moved from line 605 → line 535 (before greeting interceptor)
- ✅ Greeting interceptor now checks CLEANED text (not raw)
- ✅ Greeting detection NO LONGER exits early
- ✅ New fallback priority: Triggers > Greeting > LLM

### **Files Modified:**
- `services/engine/agent2/Agent2DiscoveryRunner.js`

---

## 🧪 **TEST SCENARIOS**

### **Test 1: Greeting + Emergency Intent**
**Input:** "Hi I have an emergency"

**Expected Behavior (V125):**
1. ScrabEngine removes "Hi" → "have an emergency"
2. Greeting Interceptor sees "have an emergency" → NO match (has intent)
3. Trigger matcher evaluates → EMERGENCY TRIGGER FIRES ✅
4. Response: Emergency protocol (not greeting)

**Events Expected:**
- `SCRABENGINE_PROCESSED` - shows "Hi" removed
- `A2_GREETING_EVALUATED` - greeting checked but not matched
- `A2_TRIGGER_EVAL` - shows emergency trigger matched
- `A2_PATH_SELECTED` - path: TRIGGER_CARD
- `SPEECH_SOURCE_SELECTED` - shows trigger response selected

---

### **Test 2: Pure Greeting (No Intent)**
**Input:** "Hi" or "Hello"

**Expected Behavior (V125):**
1. ScrabEngine removes "Hi" → "" (empty or minimal)
2. Greeting Interceptor sees cleaned text → checks if SHORT + no intent
3. No trigger matches (empty/minimal text)
4. Greeting fallback fires → "Hello! How can I help you?"

**Events Expected:**
- `SCRABENGINE_PROCESSED` - shows "Hi" removed
- `A2_GREETING_EVALUATED` - greeting detected
- `A2_TRIGGER_EVAL` - no match
- `A2_PATH_SELECTED` - path: GREETING_ONLY
- `SPEECH_SOURCE_SELECTED` - shows greeting response

---

### **Test 3: Thermostat Blank (Like Call Report)**
**Input:** "Hi John, I having issues with my thermostat. Um, it seems to be blank."

**OLD Behavior (Before V125):**
- Greeting saw "Hi" → EXIT EARLY
- Never reached triggers
- Responded with: "Sorry — you cut out" ❌

**Expected Behavior (V125):**
1. ScrabEngine:
   - Remove "Hi", "Um"
   - Result: "John having issues with thermostat seems to be blank"
2. Extract entities: firstName="John"
3. Greeting check on cleaned text → NO match (has intent)
4. Trigger matcher → THERMOSTAT BLANK trigger should fire ✅
5. Response: "I can help with your thermostat issue..." (contextual)

**Events Expected:**
- `SCRABENGINE_PROCESSED`
- `CALLER_NAME_EXTRACTED` - firstName: "John"
- `A2_GREETING_EVALUATED` - not matched
- `A2_TRIGGER_EVAL` - thermostat trigger matched
- `A2_PATH_SELECTED` - path: TRIGGER_CARD

---

### **Test 4: Vocabulary Expansion**
**Input:** "Hi my acee is broken"

**Expected Behavior (V125):**
1. ScrabEngine:
   - Step 1: Remove "Hi" → "my acee is broken"
   - Step 2: Expand "acee" → "ac" → "air conditioning"
   - Step 3: Map "broken" → "not working"
   - Result: "my air conditioning not working"
2. Trigger matcher → AC NOT WORKING trigger fires ✅

**Events Expected:**
- `SCRABENGINE_PROCESSED` - shows vocabulary expansion
- `A2_TRIGGER_EVAL` - AC service trigger matched

---

## 🔍 **ISSUE: Call Report Missing Events**

### **Problem:**
Call report JSON shows:
```json
"events": []
```

### **Investigation Needed:**

1. **Check CallLogger.logEvent()** - Are events being written?
2. **Check CallTranscriptV2 schema** - Does it have events field?
3. **Check agentConsole route** - Does it return events from v2.trace?

### **Files to Check:**
- `services/CallLogger.js` - Event logging
- `models/CallTranscriptV2.js` - Schema
- `routes/agentConsole/agentConsole.js:1648` - Events retrieval

### **Current Code (Line 1648):**
```javascript
events: callSummary.events || [],
```

**Issue:** Events come from CallSummary, but V125 events are logged to CallLogger.
Need to verify events are being persisted to CallSummary or returned from CallTranscriptV2.

---

## 📊 **CALL CONSOLE UPDATE NEEDED**

### **What to Show:**

1. **ScrabEngine Processing Stage**
   - Show 4-step pipeline visualization
   - Show before/after text transformation
   - Show extracted entities

2. **Greeting Detection Result**
   - Show if greeting was detected
   - Show cleaned vs raw text comparison
   - Show why it did/didn't match

3. **Trigger Evaluation**
   - Show matched trigger (if any)
   - Show why it matched
   - Show cleaned text used for matching

### **Event Types to Display:**
- `SCRABENGINE_PROCESSED` ← NEW in V125
- `A2_GREETING_EVALUATED` ← Updated in V125
- `A2_TRIGGER_EVAL` ← Updated in V125
- `A2_PATH_SELECTED` ← Updated in V125

---

## ✅ **NEXT ACTIONS**

1. **Make a test call** with the V125 code deployed
2. **Check if events populate** in CallTranscriptV2.trace
3. **If events still empty:**
   - Verify CallLogger.logEvent() is being called
   - Verify events are persisted to database
   - Update agentConsole route to return events from v2.trace
4. **Update Call Console UI** to display new ScrabEngine events
5. **Verify triggers now match** on cleaned text

---

## 🚀 **DEPLOYMENT STATUS**

- ✅ V125 code committed: `6c0652c7`
- ✅ V125 code pushed to origin/main
- ⏳ Needs deployment to production/staging
- ⏳ Needs test call to verify
- ⏳ Needs Call Console UI update for new events

---

## 📝 **SUCCESS CRITERIA**

✅ **Fix is successful when:**
1. "Hi I need emergency" → triggers EMERGENCY (not greeting)
2. "Hello my name is John" → extracts name John
3. "Hi my acee is broken" → matches AC SERVICE trigger
4. Events array populates with ScrabEngine + greeting + trigger events
5. Call Console displays complete pipeline visualization

---

## 🔴 **KNOWN ISSUES FROM CALL REPORT**

### **Call:** `CAa9e02a5ce5e49eb64cdc8a53737dd54f`
**Problem:** Agent didn't understand "thermostat blank" request

**Turn 1:**
- Caller: "Hi John, I having issues with my thermostat. Um, it seems to be blank."
- Agent: "Ok. Sorry — you cut out for a second. How can I help you?"

**Root Cause:** This was BEFORE V125 fix
- Greeting saw "Hi" → exited early
- Never processed "thermostat blank"
- Fell back to generic "cut out" response

**Expected After V125:**
- ScrabEngine removes "Hi", "Um"
- Extract name: "John"
- Match trigger: "thermostat blank" or "thermostat not working"
- Contextual response about thermostat troubleshooting
