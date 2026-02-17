# 🎯 WIRING AUDIT EXECUTIVE SUMMARY
**Date:** February 16, 2026  
**Status:** ⚠️ CRITICAL GAPS IDENTIFIED  
**Resolution Path:** Clear, Actionable, Documented

---

## 📊 WHAT WE FOUND

### ✅ What Works (Database Wiring)
- All 12 Front Desk tabs **save correctly** to database
- Config paths are correct: `company.aiAgentSettings.frontDeskBehavior.*`
- API endpoints work: GET/PATCH `/api/admin/front-desk-behavior/:companyId`
- UI renders saved values correctly
- Discovery Flow tab shows slot registry, steps, flows

**Verdict:** Database layer is **SOLID** ⭐⭐⭐⭐⭐

### ❌ What's Broken (Runtime Wiring)
- Runtime **ignores** 9 config flags (see table below)
- No S4A Triage/Scenario layer exists
- No `SECTION_S4A_TRIAGE_CHECK` events emitted
- No `SECTION_S4B_DISCOVERY_OWNER_SELECTED` events emitted
- `matchSource` is **always** `"DISCOVERY_FLOW_RUNNER"` (should be 60-70% `"TRIAGE_SCENARIO"`)

**Verdict:** Runtime layer has **CRITICAL GAPS** 🚨

---

## 🗂️ CONFIG FLAGS: SAVE vs USE STATUS

| Config Flag | Saves to DB? | Runtime Checks It? | Impact |
|-------------|--------------|-------------------|--------|
| `discoveryConsent.bookingRequiresExplicitConsent` | ✅ YES | ✅ YES | ConsentGate.js uses it |
| `discoveryConsent.forceLLMDiscovery` | ✅ YES | ❌ **NO** | Flag exists, never checked |
| `discoveryConsent.disableScenarioAutoResponses` | ✅ YES | ❌ **NO** | **KILLS TRIAGE**, runtime ignores it |
| `discoveryConsent.autoReplyAllowedScenarioTypes` | ✅ YES | ❌ **NO** | List exists, never read |
| `triage.enabled` | ✅ YES | ❌ **NO** | Toggle saves, runtime doesn't check |
| `triage.minConfidence` | ✅ YES | ❌ **NO** | Threshold saves, never used |
| `detectionTriggers.wantsBooking` | ✅ YES | ✅ YES | ConsentGate.js uses it |
| `detectionTriggers.directIntentPatterns` | ✅ YES | ✅ YES | ConsentGate.js uses it |
| `detectionTriggers.describingProblem` | ✅ YES | ❌ **NO** | List exists, never checked |
| `detectionTriggers.trustConcern` | ✅ YES | ❌ **NO** | List exists, never checked |
| `detectionTriggers.callerFeelsIgnored` | ✅ YES | ❌ **NO** | List exists, never checked |
| `detectionTriggers.refusedSlot` | ✅ YES | ❌ **NO** | List exists, never checked |

**Summary:** **9 out of 12 critical flags are ignored by runtime.**

---

## 🔍 THE SMOKING GUN

**Grep test:**
```bash
grep -r "disableScenarioAutoResponses" services/engine/FrontDeskCoreRuntime.js
```

**Result:** `No matches found`

**What this proves:**
- Runtime has **ZERO code** checking the "disable scenario auto responses" flag
- Even if you set the flag correctly, runtime won't see it
- Database says "scenarios disabled," runtime says "what scenarios?"

---

## 🎯 MRS. JOHNSON SCENARIO - DESIRED vs ACTUAL

### What Should Happen (Desired)

**Caller:** "This is Mrs. Johnson, 123 Market St Fort Myers — AC is down."

**Runtime Flow:**
1. ✅ S3: Slot Extraction → Extract name, address, call_reason
2. ✅ **S4A: Triage Check** → Match "AC not cooling" scenario (score: 0.89)
3. ✅ **Owner: TRIAGE** → Use scenario reply
4. ✅ Response: "Got it, Mrs. Johnson — AC down at 123 Market St. Quick question: is it not turning on, or running but not cooling?"

**Raw Events:**
```json
[
  { "type": "SECTION_S3_SLOT_EXTRACTION", "data": {...} },
  { "type": "SECTION_S4A_TRIAGE_CHECK", "data": { "selected": true, "score": 0.89 } },
  { "type": "SECTION_S4B_DISCOVERY_OWNER_SELECTED", "data": { "owner": "TRIAGE" } }
]
```

**matchSource:** `"TRIAGE_SCENARIO"`

### What Actually Happens (Current)

**Caller:** "This is Mrs. Johnson, 123 Market St Fort Myers — AC is down."

**Runtime Flow:**
1. ✅ S3: Slot Extraction → Extract name, address, call_reason
2. ❌ **S4A: SKIPPED** → Code doesn't exist
3. ❌ **S4: Discovery Flow** → Ask for address confirmation
4. ❌ Response: "I have 12155 Metro Parkway. Is that correct?"

**Raw Events:**
```json
[
  { "type": "SECTION_S3_SLOT_EXTRACTION", "data": {...} },
  { "type": "SECTION_S4_DISCOVERY_ENGINE", "data": {...} }
]
```

**matchSource:** `"DISCOVERY_FLOW_RUNNER"` (always)

**No triage event. No proof of why triage was skipped. Caller feels interrogated.**

---

## 🚨 THE CORE PROBLEM

**You have a Ferrari in the garage (config), but the engine only uses 1st gear (runtime).**

### Config Layer (✅ Works)
```
User clicks "Save" in Front Desk UI
  ↓
PATCH /api/admin/front-desk-behavior/:companyId
  ↓
MongoDB: companies.aiAgentSettings.frontDeskBehavior
  ↓
Data persisted correctly ✅
```

### Runtime Layer (❌ Broken)
```
Call arrives
  ↓
FrontDeskCoreRuntime.processTurn()
  ├─ S1: Runtime Ownership
  ├─ S2: Input Text
  ├─ S3: Slot Extraction
  ├─ ❌ S4A: MISSING (should check triage here)
  ├─ S4: DiscoveryFlowRunner (always runs)
  └─ S5: Consent Gate
  
RESULT: Config ignored, behavior doesn't match intent
```

---

## 📋 RESOLUTION PLAN

### Phase 1: Immediate Config Fix (2 minutes)
**File:** `IMMEDIATE_CONFIG_FIX.md`

**Action:**
1. Open Front Desk → Discovery & Consent tab
2. Turn **OFF**: "Force LLM Discovery"
3. Turn **OFF**: "Scenarios as Context Only"
4. Verify: `autoReplyAllowedScenarioTypes` has values
5. Save config

**Impact:** Config now **allows** triage (but runtime still won't use it)

### Phase 2: Runtime Implementation (4-6 hours)
**File:** `IMPLEMENTATION_PLAN_S4A_TRIAGE_LAYER.md`

**Files to modify:**
1. ✅ Create: `services/engine/TriageScenarioMatcher.js` (NEW)
2. ✅ Modify: `services/engine/FrontDeskCoreRuntime.js` (add S4A layer)
3. ✅ Modify: `services/engine/StateStore.js` (add pendingSlots)
4. ✅ Modify: `services/engine/booking/SlotExtractor.js` (store as pending)
5. ✅ Modify: `services/engine/DiscoveryFlowRunner.js` (skip pending confirmations)

**Impact:** Runtime will **actually check** config and use triage layer

### Phase 3: Validation (1 hour)
**Test:** Mrs. Johnson scenario

**Success criteria:**
- ✅ `matchSource: "TRIAGE_SCENARIO"` appears 60-70% of turns
- ✅ `SECTION_S4A_TRIAGE_CHECK` event in every turn
- ✅ `SECTION_S4B_DISCOVERY_OWNER_SELECTED` event in every turn
- ✅ Callers get reassurance before interrogation

---

## 📊 SUCCESS METRICS

### Before Fix (Current)
| Metric | Value | Status |
|--------|-------|--------|
| `matchSource: "TRIAGE_SCENARIO"` | **0%** | ❌ Never happens |
| `matchSource: "DISCOVERY_FLOW_RUNNER"` | **100%** | ❌ Always happens |
| S4A events emitted | **0** | ❌ Code doesn't exist |
| Caller feels heard | **Low** | ❌ Interrogated, not helped |

### After Fix (Target)
| Metric | Value | Status |
|--------|-------|--------|
| `matchSource: "TRIAGE_SCENARIO"` | **60-70%** | ✅ Dominant path |
| `matchSource: "DISCOVERY_FLOW_RUNNER"` | **30-40%** | ✅ Fallback only |
| S4A events emitted | **100%** | ✅ Every turn has proof |
| Caller feels heard | **High** | ✅ Reassured first, details later |

---

## 🔧 TECHNICAL ROOT CAUSE

### Why the original audit missed this:

**Audit scope:** "Is config wired to Discovery Flow?"

**Audit findings:**
- ✅ Config saves to database (TRUE)
- ✅ DiscoveryFlowRunner.run() is called (TRUE)
- ✅ Events log to rawEvents collection (TRUE)

**What the audit SHOULD have checked:**
- ❌ Does runtime **read** all config flags? (FALSE - 9 ignored)
- ❌ Is S4A triage layer implemented? (FALSE - doesn't exist)
- ❌ Do raw events prove decision-making? (FALSE - no S4A/S4B events)

**Lesson:** "Wired" has two meanings:
1. **Database wired** = Config saves correctly ✅
2. **Runtime wired** = Runtime reads and uses config ❌

The original audit validated #1 but missed #2.

---

## 🎯 RECOMMENDED ACTIONS

### Immediate (Do Now)
1. ✅ Read: `IMMEDIATE_CONFIG_FIX.md`
2. ✅ Change config: `disableScenarioAutoResponses: false`
3. ✅ Save config

### Short-term (This Week)
1. ✅ Read: `IMPLEMENTATION_PLAN_S4A_TRIAGE_LAYER.md`
2. ✅ Implement S4A Triage Layer (4-6 hours)
3. ✅ Test with Mrs. Johnson scenario
4. ✅ Deploy to staging

### Medium-term (This Month)
1. ✅ Wire remaining detection triggers (trustConcern, callerFeelsIgnored, etc.)
2. ✅ Add UI "Wiring Status" badges (show which flags are actually used)
3. ✅ Create runtime config audit tool (shows ignored flags)

---

## 📚 DOCUMENTATION SUITE

We've created 4 documents for you:

| Document | Purpose | Read When |
|----------|---------|-----------|
| `FRONT_DESK_AUDIT_REPORT.md` | Original audit (database layer) | ✅ Read first (context) |
| `FRONT_DESK_WIRING_GAP_ANALYSIS.md` | Gap analysis (runtime layer) | ✅ Read second (diagnosis) |
| `IMMEDIATE_CONFIG_FIX.md` | 2-minute config fix | ✅ Do now (quick win) |
| `IMPLEMENTATION_PLAN_S4A_TRIAGE_LAYER.md` | Full implementation spec | ✅ Implement next (real fix) |

**Reading order:**
1. This document (executive summary)
2. `IMMEDIATE_CONFIG_FIX.md` (do the config fix)
3. `FRONT_DESK_WIRING_GAP_ANALYSIS.md` (understand the problem)
4. `IMPLEMENTATION_PLAN_S4A_TRIAGE_LAYER.md` (implement the solution)

---

## ✅ FINAL VERDICT

**Original Question:** "Is Discovery Flow wired to Front Desk?"

**Answer:** **YES** (database) and **NO** (runtime).

**Clarified Answer:**
- ✅ Front Desk config **saves** to database correctly
- ✅ DiscoveryFlowRunner **exists** and **runs**
- ❌ Runtime **skips triage layer** (S4A doesn't exist)
- ❌ Runtime **ignores 9 config flags** (see table above)
- ❌ No **proof events** for owner selection decision

**What you need:**
1. ✅ Config fix (2 minutes) - enables triage in config
2. ✅ S4A implementation (4-6 hours) - makes runtime check config
3. ✅ Raw event proof (0 minutes) - added by S4A implementation

**Then you'll have:**
- Callers feel **heard** (triage reassurance first)
- Callers feel **helped** (scenarios answer questions)
- Booking feels **natural** (details confirmed later, not interrogated)
- Raw events **prove** decision-making (no guessing)

---

**🚀 YOU'RE NOT CRAZY. THE CONFIG EXISTS. THE RUNTIME IGNORES IT. NOW FIX IT.**

---

**END OF EXECUTIVE SUMMARY**

*Generated: February 16, 2026*  
*Next Step: Read `IMMEDIATE_CONFIG_FIX.md` and flip those two flags.*
