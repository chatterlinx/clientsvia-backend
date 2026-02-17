# 🚀 TEST V116 S4A NOW - QUICK START GUIDE

**Status:** ALL CODE DEPLOYED ✅  
**Ready:** YES - Just need config fix  
**Time:** 5 minutes to see it working

---

## ⚡ **3 STEPS TO SEE S4A WORKING**

### **STEP 1: Apply Config Fix** (2 minutes)

**Option A: Via Control Plane UI (Recommended)**

1. Open your Control Plane: `https://your-domain/control-plane-v2.html`
2. Select your company
3. Click tab: **Front Desk** (left sidebar)
4. Click internal tab: **Discovery & Consent** (top tabs)
5. Scroll to section: **"Kill Switches (LLM Discovery Controls)"**
6. **TURN OFF** these two checkboxes:
   ```
   ☐ Force LLM Discovery (No Scripted Responses)
   ☐ Scenarios as Context Only (No Verbatim)
   ```
7. Verify section below shows:
   ```
   Auto-Reply Allowed Scenario Types: FAQ, TROUBLESHOOT, EMERGENCY
   ```
8. Click **SAVE** button (top right)
9. Wait for success message

**Option B: Via Database (If you have MongoDB access)**

```javascript
db.companies.updateOne(
  { _id: ObjectId("YOUR_COMPANY_ID") },  // Replace with your company ID
  { $set: {
      "aiAgentSettings.frontDeskBehavior.discoveryConsent.disableScenarioAutoResponses": false,
      "aiAgentSettings.frontDeskBehavior.discoveryConsent.forceLLMDiscovery": false,
      "aiAgentSettings.frontDeskBehavior._experimentalS4A": true
  }}
)
```

---

### **STEP 2: Make Test Call** (2 minutes)

**Call your test number and say ONE of these:**

**Test A: Problem Description**
```
"My AC is not cooling"
```

**Test B: Full Info (Mrs. Johnson Scenario)**
```
"This is Mrs. Johnson, 123 Market St, Fort Myers — my AC is down"
```

**Test C: Simple**
```
"AC is broken"
```

**LISTEN CAREFULLY to the response:**

**If S4A is working, you'll hear:**
- ✅ Acknowledgment of the problem ("Got it - AC not cooling...")
- ✅ A triage question ("Is it not turning on, or running but not cooling?")
- ✅ Use of your name/address if you provided it

**If S4A is NOT working (fallback), you'll hear:**
- ⏭️ Discovery question ("What's your name?")
- ⏭️ No acknowledgment of problem

**BOTH are OK for first test** - we just want to see what happens!

---

### **STEP 3: Validate What Happened** (1 minute)

**Run the validation script:**
```bash
cd /Users/marc/MyProjects/clientsvia-backend
node scripts/validate-s4a-deployment.js
```

**Expected Output (if working):**
```
📊 CHECK 1: S4A Event Counts (last hour)
─────────────────────────────────────────────
✅ SECTION_S4B_DISCOVERY_OWNER_SELECTED: 3
✅ SECTION_S4A_2_SCENARIO_MATCH: 3
✅ SECTION_S4A_1_TRIAGE_SIGNALS: 3
✅ SECTION_S3_5_DESCRIBING_PROBLEM_DETECTED: 2

📊 CHECK 2: matchSource Distribution (last hour)
─────────────────────────────────────────────
TRIAGE_SCENARIO_PIPELINE:
  2 calls (66.7%) █████████████████████████████████
DISCOVERY_FLOW:
  1 calls (33.3%) ████████████████

✅ HEALTHY TRIAGE RATE (>=40%)

✅ S4A DEPLOYMENT VALIDATED
   All checks passed. S4A is working correctly.
```

**OR (if scenarios not matching yet):**
```
📊 CHECK 2: matchSource Distribution
─────────────────────────────────────────────
DISCOVERY_FLOW:
  3 calls (100%) ████████████████████████████

⚠️  WARNING: 0% TRIAGE_SCENARIO_PIPELINE
   → Scenarios may not be matching
   → Check: Are scenarios in database?
```

**This tells us if S4A is matching or falling back!**

---

## 🔍 **WHAT WE'RE LOOKING FOR**

### **Success Indicators:**
✅ S4A events appear in validation script  
✅ matchSource shows TRIAGE_SCENARIO_PIPELINE (even if just 1%)  
✅ No errors in console  
✅ Call completes successfully  
✅ Pending slot events appear (if you gave name/address)

### **Expected Scenarios:**

**Scenario 1: S4A Matches** (BEST CASE)
- You hear: Acknowledgment + triage question
- Events: S4A-1, S4A-2, S4B all appear
- matchSource: TRIAGE_SCENARIO_PIPELINE
- **This means:** S4A is WORKING! 🎉

**Scenario 2: S4A Falls Back** (ACCEPTABLE)
- You hear: Discovery question ("What's your name?")
- Events: S4A-1, S4A-2, S4B all appear
- matchSource: DISCOVERY_FLOW
- S4B reason: "NO_SCENARIO_MATCH" or "SCORE_TOO_LOW"
- **This means:** S4A is running but no scenario matched (might need scenarios in database)

**Scenario 3: S4A Disabled** (Need to fix config)
- You hear: Discovery question
- Events: S4A events missing or attempted=false
- S4B reason: "FEATURE_FLAG_DISABLED" or "CONFIG_DISABLED"
- **This means:** Config fix didn't apply, need to retry Step 1

---

## 📋 **QUICK TROUBLESHOOTING**

### **If validation script shows "NO S4A EVENTS":**

**Check 1: Is config applied?**
```bash
# Via Control Plane: Check Discovery & Consent tab
# Toggles should be OFF (unchecked)
```

**Check 2: Did server restart?**
```bash
# If running locally:
npm restart

# If on server:
# Restart your Node.js process
```

**Check 3: Are you calling the right number?**
```bash
# Make sure you're calling a number associated with the company
# where you applied the config fix
```

---

### **If validation shows "0% TRIAGE_SCENARIO":**

**This is OK for first test!** It means:
- ✅ S4A is running (events appear)
- ✅ Triage is extracting (S4A-1 works)
- ⏭️ Scenarios not matching (might not exist in database)

**To check scenarios:**
```javascript
db.globalInstantResponseTemplates.countDocuments({
  tradeKey: "hvac",  // Your trade
  type: { $in: ["TROUBLESHOOT", "FAQ", "EMERGENCY"] },
  active: true
})
```

**If count = 0:** No scenarios exist yet (S4A will always fallback to Discovery)  
**If count > 0:** Scenarios exist, check confidence thresholds

---

## 🎯 **READY WHEN YOU ARE**

**Just say:**
- "I applied the config" → I'll help you make a test call
- "I made a test call" → I'll help you check the results
- "I need help with config" → I'll guide you step-by-step

**Let's see your S4A pipeline in action!** 🚀

**I'm here to help you test every step of the way.**
