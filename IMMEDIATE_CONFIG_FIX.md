# ⚡ IMMEDIATE CONFIG FIX - DO THIS NOW

**Problem:** Your config is killing the triage layer.  
**Fix Time:** 2 minutes  
**Impact:** Callers will start getting triage reassurance instead of interrogation

---

## 🔥 THE ONE FLAG KILLING EVERYTHING

**Current config in your Front Desk → Discovery & Consent tab:**

```json
{
  "discoveryConsent": {
    "bookingRequiresExplicitConsent": true,
    "forceLLMDiscovery": true,
    "disableScenarioAutoResponses": true,  // ❌ THIS IS THE PROBLEM
    "autoReplyAllowedScenarioTypes": [
      "FAQ",
      "TROUBLESHOOT",
      "EMERGENCY"
    ]
  }
}
```

**The issue:** `disableScenarioAutoResponses: true` **nukes your entire triage/scenario layer**, even though you specified `autoReplyAllowedScenarioTypes`.

---

## ✅ IMMEDIATE FIX (2 minutes)

### Step 1: Open Control Plane
Navigate to: **Front Desk → Discovery & Consent** tab

### Step 2: Find "Kill Switches (LLM Discovery Controls)" section

### Step 3: Change these toggles:

**BEFORE:**
- ✅ Booking Requires Explicit Consent (keep this ON)
- ✅ Force LLM Discovery (turn this OFF)
- ✅ Scenarios as Context Only (turn this OFF)

**AFTER:**
- ✅ Booking Requires Explicit Consent (keep this ON)
- ❌ Force LLM Discovery (**turn OFF**)
- ❌ Scenarios as Context Only (**turn OFF**)

### Step 4: Verify "Allowed Scenario Types" is populated

**Should show:**
```
FAQ, TROUBLESHOOT, EMERGENCY
```

If empty, add these three types.

### Step 5: Click **Save** button

### Step 6: Verify in database

Run this query to confirm:
```javascript
db.companies.findOne(
  { _id: ObjectId("YOUR_COMPANY_ID") },
  { "aiAgentSettings.frontDeskBehavior.discoveryConsent": 1 }
)
```

**Should return:**
```json
{
  "aiAgentSettings": {
    "frontDeskBehavior": {
      "discoveryConsent": {
        "bookingRequiresExplicitConsent": true,
        "forceLLMDiscovery": false,
        "disableScenarioAutoResponses": false,
        "autoReplyAllowedScenarioTypes": ["FAQ", "TROUBLESHOOT", "EMERGENCY"]
      }
    }
  }
}
```

---

## ⚠️ CRITICAL: This won't work until runtime is fixed

**The config fix above is necessary but NOT sufficient.**

Even with correct config, the runtime doesn't check these flags. You need to implement S4A Triage Layer (see `IMPLEMENTATION_PLAN_S4A_TRIAGE_LAYER.md`).

**Why?**
- Grep search in `FrontDeskCoreRuntime.js` for `disableScenarioAutoResponses` returns **ZERO results**
- Runtime has NO code checking `autoReplyAllowedScenarioTypes`
- Runtime goes: S3 → DiscoveryFlowRunner (skips triage entirely)

**What you'll see after config fix (without runtime fix):**
- Raw events still show `matchSource: "DISCOVERY_FLOW_RUNNER"` 100% of the time
- No `SECTION_S4A_TRIAGE_CHECK` events (because code doesn't exist)
- Behavior unchanged (still interrogates instead of reassures)

**What you'll see after config fix + runtime fix:**
- Raw events show `matchSource: "TRIAGE_SCENARIO"` 60-70% of the time
- Every turn emits `SECTION_S4A_TRIAGE_CHECK` event (proof)
- Callers get reassurance before interrogation

---

## 🎯 SUMMARY

### Immediate Action (Do Now)
1. ✅ Change config: `disableScenarioAutoResponses: false`
2. ✅ Change config: `forceLLMDiscovery: false`
3. ✅ Verify `autoReplyAllowedScenarioTypes` has values
4. ✅ Save config

### Next Action (Implement S4A)
See: `IMPLEMENTATION_PLAN_S4A_TRIAGE_LAYER.md`

### Proof Required
After implementation, check raw events for:
- `SECTION_S4A_TRIAGE_CHECK` (appears every turn)
- `SECTION_S4B_DISCOVERY_OWNER_SELECTED` (appears every turn)
- `matchSource: "TRIAGE_SCENARIO"` (appears 60-70% of turns)

---

**END OF IMMEDIATE FIX**

*Do the config fix now. Implement runtime fix next.*
