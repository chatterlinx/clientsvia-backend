# 🚀 DEPLOYMENT GUIDE - V116 S4A TRIAGE+SCENARIO PIPELINE

**Version:** V116  
**Feature:** S4A Triage+Scenario Pipeline  
**Status:** READY FOR DEPLOYMENT  
**Date:** February 16, 2026

---

## 📋 PRE-DEPLOYMENT CHECKLIST

### **Code Status:**
- [x] All files pushed to `main` branch (commit: 4e638a81)
- [x] Syntax validated (all files compile)
- [x] Tests created (unit + integration)
- [x] Governance docs complete (ADR, Runtime Spec, Risk Register)
- [x] Observability plan ready

### **Configuration Ready:**
- [ ] Config fix applied (disableScenarioAutoResponses: false)
- [ ] Feature flag set (_experimentalS4A: true for test company)
- [ ] Scenario pool validated (has TROUBLESHOOT scenarios)

### **Monitoring Ready:**
- [ ] Dashboard queries saved
- [ ] Alert rules configured
- [ ] On-call playbook distributed

---

## 🎯 DEPLOYMENT STEPS

### **STEP 1: Deploy Code to Staging** (5 min)

```bash
# Already done - code is on main branch
# If using deployment pipeline:
# - Trigger staging deployment
# - Wait for services to restart
# - Verify health checks pass
```

**Validation:**
```bash
# Check server is running
curl https://your-staging-server/health

# Check version (should show recent timestamp)
curl https://your-staging-server/api/version
```

---

### **STEP 2: Apply Config Fix** (2 min)

**Via Control Plane UI:**

1. Navigate to: https://your-server/control-plane-v2.html
2. Select test company
3. Go to tab: **Front Desk** → **Discovery & Consent**
4. Find section: "Kill Switches (LLM Discovery Controls)"
5. **Turn OFF** these toggles:
   - [ ] "Scenarios as Context Only" (disableScenarioAutoResponses)
   - [ ] "Force LLM Discovery" (forceLLMDiscovery)
6. Verify: "Auto-Reply Allowed Types" shows "FAQ, TROUBLESHOOT, EMERGENCY"
7. Click **Save**
8. Wait for save confirmation

**Verify in Database:**
```javascript
db.companies.findOne(
  { _id: ObjectId("YOUR_TEST_COMPANY_ID") },
  { "aiAgentSettings.frontDeskBehavior.discoveryConsent": 1 }
)

// Should return:
{
  "aiAgentSettings": {
    "frontDeskBehavior": {
      "discoveryConsent": {
        "disableScenarioAutoResponses": false,  // ✅ OFF
        "forceLLMDiscovery": false,             // ✅ OFF
        "autoReplyAllowedScenarioTypes": ["FAQ", "TROUBLESHOOT", "EMERGENCY"]
      }
    }
  }
}
```

---

### **STEP 3: Enable Feature Flag** (1 min)

**For Single Test Company:**
```javascript
db.companies.updateOne(
  { _id: ObjectId("YOUR_TEST_COMPANY_ID") },
  { $set: { "aiAgentSettings.frontDeskBehavior._experimentalS4A": true } }
)
```

**For All Companies (Use with caution):**
```javascript
db.companies.updateMany(
  {},
  { $set: { "aiAgentSettings.frontDeskBehavior._experimentalS4A": true } }
)
```

**Recommendation:** Start with single company, validate, then expand.

---

### **STEP 4: Make Test Calls** (10 min)

**Test Scenario 1: Problem Description**
```
Input: "My AC is not cooling"

Expected Flow:
1. S3: Extract nothing (no name/address volunteered)
2. S3.5: Detect "describing problem" trigger
3. S4A-1: Triage classifies as service_request
4. S4A-2: Scenario matches (if TROUBLESHOOT scenario exists)
5. S4B: Owner = TRIAGE_SCENARIO_PIPELINE (if matched) or DISCOVERY_FLOW

Check:
- Does response sound like reassurance? ("Got it - AC not cooling...")
- Or discovery question? ("What's your name?")
```

**Test Scenario 2: Mrs. Johnson (Full Info)**
```
Input: "This is Mrs. Johnson, 123 Market St, Fort Myers — AC is down"

Expected Flow:
1. S3: Extract lastName, address, call_reason
2. S3: Store as PENDING
3. S3.5: Detect "describing problem"
4. S4A-1: Triage extracts call reason
5. S4A-2: Scenario matches
6. Response: Uses pending slots ("Got it, Mrs. Johnson at 123 Market St...")

Check:
- Are pending slots mentioned in response?
- Is call_reason acknowledged?
```

**Test Scenario 3: No Match Fallback**
```
Input: "Um, hi, calling about stuff"

Expected Flow:
1. S3: Extract nothing
2. S4A-1: Triage (low confidence)
3. S4A-2: No scenario match (score too low)
4. S4B: Owner = DISCOVERY_FLOW (fallback)
5. Response: Discovery question ("What can I help you with?")

Check:
- Does it fall back to discovery gracefully?
- No errors?
```

---

### **STEP 5: Verify Events in Database** (5 min)

**Query 1: Check S4A Events Exist**
```javascript
db.rawEvents.find({
  type: { $regex: "S4A" },
  timestamp: { $gte: new Date(Date.now() - 3600000) }  // Last hour
}).sort({ timestamp: -1 }).limit(20)
```

**Expected Result:** Should see S4A-1, S4A-2, S4B events for each test call

---

**Query 2: Check Owner Distribution**
```javascript
db.rawEvents.aggregate([
  { $match: { 
      type: "SECTION_S4B_DISCOVERY_OWNER_SELECTED",
      timestamp: { $gte: new Date(Date.now() - 3600000) }
  }},
  { $group: {
      _id: "$data.owner",
      count: { $sum: 1 }
  }}
])
```

**Expected Result:**
```json
[
  { "_id": "TRIAGE_SCENARIO_PIPELINE", "count": X },  // If scenarios match
  { "_id": "DISCOVERY_FLOW", "count": Y }             // Fallback
]
```

**If only DISCOVERY_FLOW appears:**
- Check: Are scenarios in database?
- Check: Is ScenarioEngine working?
- Check: Are confidence scores too low?

---

**Query 3: Check Pending Slots**
```javascript
db.rawEvents.find({
  type: "SECTION_S3_PENDING_SLOTS_STORED",
  timestamp: { $gte: new Date(Date.now() - 3600000) }
}).limit(5)
```

**Expected Result:** Should see pending slot events when callers volunteer info

---

**Query 4: Check Detection Triggers**
```javascript
db.rawEvents.find({
  type: { $regex: "SECTION_S3_5" },
  timestamp: { $gte: new Date(Date.now() - 3600000) }
}).limit(10)
```

**Expected Result:** Should see trigger detection events (describing_problem, trust_concern, etc.)

---

### **STEP 6: Validate Performance** (5 min)

**Query: S4A Latency**
```javascript
db.rawEvents.aggregate([
  { $match: { 
      type: { $in: ["SECTION_S4A_1_TRIAGE_SIGNALS", "SECTION_S4A_2_SCENARIO_MATCH"] },
      timestamp: { $gte: new Date(Date.now() - 3600000) }
  }},
  { $group: {
      _id: "$type",
      avgDuration: { $avg: "$data.durationMs" },
      maxDuration: { $max: "$data.durationMs" },
      count: { $sum: 1 }
  }}
])
```

**Expected Result:**
```json
[
  { "_id": "SECTION_S4A_1_TRIAGE_SIGNALS", "avgDuration": 30, "maxDuration": 80, "count": 10 },
  { "_id": "SECTION_S4A_2_SCENARIO_MATCH", "avgDuration": 70, "maxDuration": 150, "count": 10 }
]
```

**Thresholds:**
- ✅ avgDuration < 100ms (good)
- ⚠️ avgDuration 100-200ms (acceptable)
- ❌ avgDuration > 200ms (investigate)

---

## 🚦 GO / NO-GO DECISION GATES

### **After Staging Validation:**

**GO Criteria (ALL must be true):**
- ✅ S4A events appearing in rawEvents (100% of discovery turns)
- ✅ No errors in logs (S4A_TRIAGE_ERROR, S4A_SCENARIO_ERROR = 0)
- ✅ Performance within SLO (avg <100ms, max <300ms)
- ✅ Calls completing successfully (no crashes)
- ✅ At least 1 TRIAGE_SCENARIO_PIPELINE matchSource (proves matching works)

**NO-GO Criteria (ANY triggers stop):**
- ❌ S4A events missing (not running)
- ❌ Error rate > 1%
- ❌ Performance > 500ms average
- ❌ Calls failing/crashing
- ❌ 100% DISCOVERY_FLOW with good scenarios (matching broken)

---

## 📊 PROGRESSIVE ROLLOUT PLAN

### **Stage 1: Canary (1 Test Company)** - 24 hours

**Enable:**
```javascript
db.companies.updateOne(
  { _id: ObjectId("YOUR_TEST_COMPANY_ID") },
  { $set: { "aiAgentSettings.frontDeskBehavior._experimentalS4A": true } }
)
```

**Monitor:**
- Make 20-30 calls over 24 hours
- Check event rates
- Check performance
- Check for errors
- Check matchSource distribution

**GO/NO-GO:**
- ✅ GO if: No errors, performance good, matchSource showing TRIAGE
- ❌ NO-GO if: Errors >1%, performance bad, or no TRIAGE matches

---

### **Stage 2: 10% of Companies** - 24 hours

**Enable:**
```javascript
// Get list of 10% of companies
const companies = db.companies.find().limit(Math.floor(db.companies.countDocuments() * 0.1)).toArray();

// Enable for each
companies.forEach(c => {
  db.companies.updateOne(
    { _id: c._id },
    { $set: { "aiAgentSettings.frontDeskBehavior._experimentalS4A": true } }
  );
});
```

**Monitor:** Same metrics, larger sample

**GO/NO-GO:**
- ✅ GO if: Metrics stable, no degradation
- ❌ NO-GO if: Conversion drops >5%, errors spike

---

### **Stage 3: 50% of Companies** - 48 hours

Same process, 50% of companies, monitor for 48 hours

---

### **Stage 4: 100% of Companies** - 72 hours

Full rollout, monitor for 72 hours, measure final success metrics

---

## 🔴 ROLLBACK PROCEDURES

### **Emergency Rollback (Immediate)**

**If:** Errors >5%, conversion drops >10%, or critical incident

**Action:**
```javascript
// Disable for all companies immediately
db.companies.updateMany(
  {},
  { $set: { "aiAgentSettings.frontDeskBehavior._experimentalS4A": false } }
)

// Or: Set master toggle
db.companies.updateMany(
  {},
  { $set: { "aiAgentSettings.frontDeskBehavior.discoveryConsent.disableScenarioAutoResponses": true } }
)
```

**Impact:** Reverts to V115 behavior (pure deterministic) immediately

**No code deployment needed for rollback.**

---

### **Partial Rollback (Selective)**

**If:** Issues with specific company or segment

**Action:**
```javascript
// Disable for specific company
db.companies.updateOne(
  { _id: ObjectId("PROBLEM_COMPANY_ID") },
  { $set: { "aiAgentSettings.frontDeskBehavior._experimentalS4A": false } }
)
```

---

## 📊 SUCCESS MEASUREMENT

### **2 Weeks Post-Deployment:**

**Primary KPI: Booking Conversion**
```javascript
// Get conversion by matchSource
db.rawEvents.aggregate([
  { $match: { 
      type: "SECTION_S4B_DISCOVERY_OWNER_SELECTED",
      timestamp: { 
          $gte: new Date("2026-02-20"),  // 2 weeks post-deploy
          $lte: new Date("2026-03-05") 
      }
  }},
  { $lookup: {
      from: "bookingRequests",
      localField: "callId",
      foreignField: "callId",
      as: "booking"
  }},
  { $group: {
      _id: "$data.owner",
      totalCalls: { $sum: 1 },
      bookings: { $sum: { $cond: [{ $gt: [{ $size: "$booking" }, 0] }, 1, 0] } },
      conversionRate: { $avg: { $cond: [{ $gt: [{ $size: "$booking" }, 0] }, 1, 0] } }
  }}
])
```

**Success Criteria:**
- Overall conversion: >60% (was 40%)
- TRIAGE_SCENARIO conversion: >70%
- matchSource distribution: 60-70% TRIAGE, 30-40% DISCOVERY

---

## 🎊 DEPLOYMENT COMPLETE CHECKLIST

- [ ] Code deployed to production
- [ ] Config applied (disableScenarioAutoResponses: false)
- [ ] Feature flag enabled (progressive rollout)
- [ ] Test calls validated
- [ ] Events verified in rawEvents
- [ ] Performance within SLO
- [ ] No errors in logs
- [ ] matchSource distribution healthy
- [ ] Booking conversion measured
- [ ] Success documented

---

**When all checked:** ✅ DEPLOYMENT SUCCESSFUL

**Document final metrics in:** `S4A_DEPLOYMENT_RESULTS.md`

---

**END OF DEPLOYMENT GUIDE**

*Follow this guide for safe, validated deployment.*  
*Progressive rollout with hard stop gates.*  
*Rollback plan ready if needed.*
