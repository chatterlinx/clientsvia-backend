# 🚀 DEPLOYMENT GUIDE - V116 S4A TRIAGE+SCENARIO PIPELINE

**Version:** V116  
**Feature:** S4A Triage+Scenario Pipeline  
**Status:** DRAFT RUNBOOK (Deployment gated by evidence)  
**Date:** February 16, 2026

---

## 📋 PRE-DEPLOYMENT CHECKLIST

### **Change Governance (Non-Negotiable)**
- [ ] **Owner assigned:** One accountable release owner for V116 S4A rollout
- [ ] **Approval recorded:** ADR status set to “Approved” (or equivalent) by required stakeholders
- [ ] **Runtime spec published:** Single-page truth for routing order + speaker-ownership contract
- [ ] **Risk register reviewed:** Top risks acknowledged with mitigations and rollback triggers
- [ ] **Incident readiness:** On-call owner confirmed, rollback drill completed in staging

### **Code & CI Evidence (No “trust me”)**
Replace “already done” with verifiable artifacts.
- [ ] **Git evidence:** PR link (or commit hash) reviewed and approved
- [ ] **CI evidence:** Green build/test results attached (unit + integration)
- [ ] **Deploy evidence:** Staging deployment record (timestamp + version identifier)
- [ ] **Runtime evidence:** Health checks pass in staging after deploy

### **Configuration Ready:**
- [ ] Config preconditions applied for test company (see Step 2)
- [ ] Feature flag enabled for a single canary company only (see Step 3)
- [ ] Scenario pool validated for the company/trade (types allowed by config actually exist)

### **Monitoring Ready:**
- [ ] Dashboard queries saved (owner distribution, error rate, latency)
- [ ] Alert rules configured (error rate, latency regression, conversion regression)
- [ ] On-call playbook distributed (what to check first, how to disable safely)

---

## 🎯 DEPLOYMENT STEPS

### **STEP 1: Deploy Code to Staging** (5 min)

```bash
# Trigger staging deployment using your standard pipeline.
# Requirements:
# - Capture the deployed version identifier (commit SHA / image tag).
# - Verify health checks and smoke endpoints.
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

**Note (critical):** This config change is a **precondition**, not proof. If runtime wiring is incomplete, behavior will not change.

---

### **STEP 3: Enable Feature Flag** (1 min)

**For Single Test Company:**
```javascript
db.companies.updateOne(
  { _id: ObjectId("YOUR_TEST_COMPANY_ID") },
  { $set: { "aiAgentSettings.frontDeskBehavior._experimentalS4A": true } }
)
```

**Enterprise rule:** Never enable for all companies in one step. Roll out by explicit cohort selection with measured gates (see Progressive Rollout Plan).

---

### **STEP 4: Make Test Calls** (10 min)

**Goal:** Validate routing + proof events + safety behavior. Do not rely on “the response sounded right.”

**Test Scenario 1: Problem Description**
```
Input: "My AC is not cooling"

Expected Flow:
1. S3: Extract nothing (no name/address volunteered)
2. S3.5: Detect "describing problem" trigger
3. S4A: Triage/scenario layer is evaluated (attempted OR explicitly skipped with reason)
4. S4B: Owner selected (triage/scenario OR discovery fallback)

Check:
- Does response sound like reassurance? ("Got it - AC not cooling...")
- Or discovery question? ("What's your name?")
```

**Test Scenario 2: Mrs. Johnson (Full Info)**
```
Input: "This is Mrs. Johnson, 123 Market St, Fort Myers — AC is down"

Expected Flow:
1. S3: Extract lastName, address, call_reason
2. (Optional, if implemented): Store extracted values as pending vs confirmed
3. S4A: Evaluated (attempted OR skipped with reason)
4. If scenario match: response acknowledges problem before interrogating for slots
5. If no match: fall back to discovery cleanly

Check:
- If pending/volunteered slots are used, are they used safely (no premature “confirmation loops”)?
- Is call_reason acknowledged?
```

**Test Scenario 3: No Match Fallback**
```
Input: "Um, hi, calling about stuff"

Expected Flow:
1. S3: Extract nothing
2. S4A evaluated and produces “no match” reasons (not silent failure)
3. S4B selects discovery fallback
4. Response: discovery question ("What can I help you with?")

Check:
- Does it fall back to discovery gracefully?
- No errors?
```

---

### **STEP 5: Verify Events in Database** (5 min)

**Minimum required proof events (per turn):**
- `SECTION_S4A_TRIAGE_CHECK` (attempted true/false + reason)
- `SECTION_S4B_DISCOVERY_OWNER_SELECTED` (owner + reason)

**Query 1: Check S4A proof exists**
```javascript
db.rawEvents.find({
  type: "SECTION_S4A_TRIAGE_CHECK",
  timestamp: { $gte: new Date(Date.now() - 3600000) }  // Last hour
}).sort({ timestamp: -1 }).limit(20)
```

**Expected Result:** Should see documents for the test calls. Each should include:
- `data.attempted` (true/false)
- `data.reason` (why attempted, why skipped, or why no match)

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

**Interpretation:**
```json
[
  { "_id": "<TRIAGE_OWNER_VALUE>", "count": X },
  { "_id": "<DISCOVERY_OWNER_VALUE>", "count": Y }
]
```

**If only discovery appears:**
- Check: Are scenarios in database?
- Check: Is ScenarioEngine working?
- Check: Are confidence scores too low?
- Check: Is S4A being skipped by config/feature flag (inspect `SECTION_S4A_TRIAGE_CHECK.data.reason`)?

---

**Query 3: Check Pending Slots (only if pending-slot feature is implemented)**
```javascript
db.rawEvents.find({
  type: "SECTION_S3_PENDING_SLOTS_STORED",
  timestamp: { $gte: new Date(Date.now() - 3600000) }
}).limit(5)
```

**Expected Result:** Pending slot events appear only when caller volunteered extractable info.

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

**Query: Latency (only if durationMs is emitted by runtime)**
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

**Thresholds:**
- ✅ Within defined SLO budgets (must be specified in the runtime spec)
- ❌ If budgets are not specified: **NO-GO** (you cannot manage what you don’t define)

---

## 🚦 GO / NO-GO DECISION GATES

### **After Staging Validation:**

**GO Criteria (ALL must be true):**
- ✅ `SECTION_S4A_TRIAGE_CHECK` exists for staged test calls; each has explicit attempted/skip reasons
- ✅ `SECTION_S4B_DISCOVERY_OWNER_SELECTED` exists for staged test calls; owner values align with runtime spec
- ✅ Zero critical errors attributable to S4A (define “critical” in runbook; do not use vague “no errors”)
- ✅ Performance SLOs met (p95/p99 where applicable, not only averages)
- ✅ Calls complete successfully (no crash loops, no stuck lanes)
- ✅ At least one verified triage/scenario owner selection in staging (proves matching path can win)

**NO-GO Criteria (ANY triggers stop):**
- ❌ S4A events missing (not running)
- ❌ Error rate above threshold (must be defined; default 1% is a placeholder until agreed)
- ❌ Latency regression above budget (budgets must be defined)
- ❌ Calls failing/crashing
- ❌ 100% discovery owner selection despite validated scenario pool + eligible config

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

**Enable (cohort must be explicitly defined):**
```javascript
// DO NOT pick an arbitrary “first N” cohort.
// Use an explicit cohort selection method (e.g., allowlisted company IDs).
// Example (illustrative):
const cohortIds = [
  ObjectId("..."),
  ObjectId("...")
];
db.companies.updateMany(
  { _id: { $in: cohortIds } },
  { $set: { "aiAgentSettings.frontDeskBehavior._experimentalS4A": true } }
);
```

**Monitor:** Same metrics, larger sample

**GO/NO-GO:**
- ✅ GO if: Metrics stable, no degradation
- ❌ NO-GO if: Conversion drops above agreed threshold, errors spike, or latency regresses beyond budget

---

### **Stage 3: 50% of Companies** - 48 hours

Same process, 50% of companies, monitor for 48 hours

---

### **Stage 4: 100% of Companies** - 72 hours

Full rollout, monitor for 72 hours, measure final success metrics

---

## 🔴 ROLLBACK PROCEDURES

### **Emergency Rollback (Immediate)**

**If:** Critical incident, policy violation, severe regression, or per gates above

**Action:**
```javascript
// Disable for all companies immediately
db.companies.updateMany(
  {},
  { $set: { "aiAgentSettings.frontDeskBehavior._experimentalS4A": false } }
)

// Alternative safety lever (config-level):
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

**Primary KPI: Booking Conversion (define this precisely before you measure)**
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

**Success Criteria (targets; must be agreed and baselined):**
- Conversion uplift measured against a pre-deploy baseline window with consistent cohorting
- No unacceptable regression in guardrails (hangups, turns-to-booking, latency, error rate)
- Owner distribution aligns with expected operating point (do not enforce a single fixed percentage without evidence; tune via data)

---

## 🎊 DEPLOYMENT COMPLETE CHECKLIST

- [ ] Code deployed to production
- [ ] Config preconditions applied for enabled cohort
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
