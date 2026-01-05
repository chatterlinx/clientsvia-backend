# SCENARIO-OPS — NO TENANT CONTAMINATION

## ⚠️ READ THIS BEFORE TOUCHING SCENARIOS

This document defines the **ONLY** allowed ways to create, edit, or manage scenarios on this multi-tenant platform.

---

## Golden Rule

> **Scenarios are GLOBAL shared assets.**

- Scenarios live **ONLY** inside `GlobalInstantResponseTemplate` (embedded under `categories[].scenarios[]`)
- Companies **NEVER** store scenario content
- Companies only store template links via `aiAgentSettings.templateReferences[]`

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  GlobalInstantResponseTemplate (MongoDB Collection)              │
│  ├── _id: ObjectId (templateId)                                 │
│  ├── templateType: "hvac" | "dental" | "legal" | "universal"    │
│  └── categories[]                                               │
│       └── scenarios[] (EMBEDDED - scope: GLOBAL)                │
│            ├── scenarioId: "scenario-{timestamp}-{random}"      │
│            ├── scope: "GLOBAL"           ← ALWAYS               │
│            └── ownerCompanyId: null      ← ALWAYS               │
└─────────────────────────────────────────────────────────────────┘
                           │
                           │ (linked via templateId ONLY)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Company Document                                                │
│  ├── _id: ObjectId (companyId)                                  │
│  ├── tradeKey: "hvac" | "dental" | etc.                         │
│  └── aiAgentSettings.templateReferences: [                       │
│       { templateId: "xxx", isPrimary: true }                    │
│      ]                                                          │
│                                                                 │
│  ⛔ NO scenarios stored here!                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Allowed Write Paths

### ✅ ONLY These Are Allowed:

1. **Global Template Patch API**
   - Endpoint: `POST /api/admin/global-templates/:templateId/scenarios/patch`
   - Must use real `scenarioId` from export
   - Server enforces `scope=GLOBAL` and `ownerCompanyId=null`

2. **Admin Global Instant Responses UI**
   - Route: `/api/admin/global-instant-responses/:templateId/scenarios`
   - Only for template library management

3. **Patch Import (Control Plane)**
   - Uses export JSON as source of truth
   - Validates all IDs exist before applying

---

## Forbidden Write Paths

### ⛔ NEVER Do These:

1. **Writing scenarios into Company documents**
   ```javascript
   // ⛔ FORBIDDEN - CONTAMINATION!
   Company.updateOne({ _id: companyId }, { 
     $push: { 'scenarios': newScenario } 
   });
   ```

2. **Loading templates without company reference**
   ```javascript
   // ⛔ FORBIDDEN - CROSS-TENANT RISK!
   GlobalInstantResponseTemplate.findOne({ 
     isActive: true, 
     isPublished: true 
   });
   ```

3. **Guessing scenario IDs**
   ```javascript
   // ⛔ FORBIDDEN - IDs must come from export!
   const scenarioId = 'scenario-made-up-id';
   ```

4. **Setting ownerCompanyId on global scenarios**
   ```javascript
   // ⛔ FORBIDDEN - CONTAMINATION!
   scenario.ownerCompanyId = companyId;
   ```

---

## Required Workflow for Scenario Changes

### Step 1: Export Template JSON (Source of Truth)
```bash
# From Control Plane UI:
Data & Config → Templates → Export Config → Download .json
```

### Step 2: Generate ID Registry
```bash
node tools/template/export-registry.js ./export.json
```

### Step 3: Build Patch JSON Using Real IDs
```json
{
  "dryRun": true,
  "ops": [
    {
      "op": "update",
      "scenarioId": "scenario-1761397969597-lhg4k3qhb",
      "set": {
        "triggers": ["ac blowing warm", "no cool air"],
        "quickReplies": ["..."]
      }
    }
  ]
}
```

### Step 4: Dry Run First
```bash
POST /api/admin/global-templates/:templateId/scenarios/patch
{ "dryRun": true, "ops": [...] }
```

### Step 5: Apply After Verification
```bash
POST /api/admin/global-templates/:templateId/scenarios/patch
{ "dryRun": false, "ops": [...] }
```

### Step 6: Verify in Scenario Browser
- Check RAW view shows `scope: "GLOBAL"`
- Check `ownerCompanyId: null`
- Verify counts match expectations

---

## Verification Checklist

Before any deploy, verify:

- [ ] Scenario Browser → RAW shows `scope: "GLOBAL"` for all scenarios
- [ ] No scenario has `ownerCompanyId` set
- [ ] Template counts are consistent (categories, scenarios, triggers)
- [ ] Company docs contain ONLY `templateReferences`, no embedded scenarios
- [ ] Runtime loads templates ONLY from `company.aiAgentSettings.templateReferences`

---

## Server-Side Enforcement (Non-Negotiable)

The following rules are enforced in code, not just policy:

```javascript
// GlobalTemplatePatchService.js enforces:

// 1. Always force GLOBAL scope
scenario.scope = 'GLOBAL';

// 2. Always null ownerCompanyId
scenario.ownerCompanyId = null;

// 3. Reject any payload with ownerCompanyId
if (payload.ownerCompanyId) {
  throw new Error('CONTAMINATION_BLOCKED: ownerCompanyId not allowed');
}

// 4. scenarioId must exist (update) or be server-generated (create)
if (op === 'create') {
  scenario.scenarioId = `scenario-${Date.now()}-${randomId()}`;
}
```

---

## Audit Trail

Every patch operation is logged:

```javascript
{
  action: 'GLOBAL_TEMPLATE_PATCH',
  templateId: '...',
  opsCount: 5,
  scenarioIds: ['...'],
  actor: 'admin@company.com',
  dryRun: false,
  timestamp: ISODate('...')
}
```

---

## Emergency Revert

If contamination is suspected:

1. Check audit logs for recent patches
2. Export current template state
3. Compare with known-good backup
4. Use git history to identify changes
5. Reset to known-good commit if needed

---

---

# 🔒 Scenario Enforcement Protocol (SEP-1)

> **Version:** 1.0  
> **Status:** MANDATORY  
> **Last Updated:** January 2026  

This protocol was established after achieving **71/71 scenarios meeting enforcement minimums** through an 8-phase batch process. It is now the permanent, non-negotiable standard for all scenario work.

---

## ✅ REQUIRED MINIMUMS (Hard Gate)

A scenario is **INVALID** unless it meets **ALL** of the following:

| Field | Minimum | Enforced |
|-------|---------|----------|
| `triggers` | ≥ 8 | ✅ |
| `negativeUserPhrases` | ≥ 3 | ✅ |
| `quickReplies` | ≥ 7 | ✅ |
| `fullReplies` | ≥ 7 | ✅ |
| `scope` | `"GLOBAL"` | ✅ |
| `ownerCompanyId` | `null` | ✅ |

**No exceptions. No partial saves.**

---

## 🧪 REQUIRED EXECUTION FLOW (Non-Negotiable)

### Step 1 — Baseline Snapshot
```bash
node scripts/identify-worst-scenarios.js 2>/dev/null
```
Record the current state before any changes.

### Step 2 — Build Patch Script
Patch scripts MUST:
- Target scenarios by **real scenarioId** (from export)
- Be template-scoped (single templateId)
- Support `--dry-run` flag
- Print before → after counts
- Merge + dedupe arrays (never overwrite)

Naming convention:
```bash
scripts/phaseX-patch-N.js
```

### Step 3 — DRY RUN (MANDATORY)
```bash
node scripts/phaseX-patch-N.js --dry-run
```

✅ Expected output:
- `WILL_UPDATE` for intended scenarios
- Correct before → after deltas
- `Total operations: N` (matches your intention)
- **NO database writes**

❌ If anything unexpected appears → **STOP. DO NOT APPLY.**

### Step 4 — APPLY
```bash
node scripts/phaseX-patch-N.js --apply
```

### Step 5 — VERIFICATION DRY RUN
```bash
node scripts/phaseX-patch-N.js --dry-run
```

✅ Required output: `Total operations: 0`

If not 0 → something failed. Investigate before proceeding.

### Step 6 — GLOBAL VERIFICATION
```bash
node scripts/identify-worst-scenarios.js 2>/dev/null
```

✅ REQUIRED FINAL STATE:
```
Total scenarios: N
✅ Meeting minimums: N
❌ Below minimums: 0
```

---

## 🚫 STRICTLY FORBIDDEN

- ❌ Adding scenarios under `companyId`
- ❌ Editing scenarios via browser console
- ❌ Guessing scenario IDs
- ❌ Applying without dry-run first
- ❌ Saving templates with failing enforcement
- ❌ Running one mega-script for all scenarios (batch in ≤10)
- ❌ Manual UI edits while batch scripts are running

---

## 📊 Enforcement Verification Script

Use this script to verify template health at any time:

```bash
node scripts/identify-worst-scenarios.js 2>/dev/null
```

### Interpreting Results

| Output | Status | Action |
|--------|--------|--------|
| `Below minimums: 0` | 🟢 Enterprise-Safe | Good to deploy |
| `Below minimums: 1-10` | 🟡 At Risk | Run patch phase |
| `Below minimums: 10+` | 🔴 Invalid | Do NOT deploy |

---

## 🎯 Phase Scripts Reference

The following scripts were used to achieve 71/71 compliance:

| Phase | Script | Scenarios | Focus |
|-------|--------|-----------|-------|
| 1 | `phase1-patch-5-worst.js` | 5 | Initial worst offenders |
| 2 | `phase2-patch-10-worst.js` | 10 | Emergency + water/gas |
| 3 | `phase3-patch-10.js` | 10 | Frozen coils, smells, noises |
| 4 | `phase4-patch-10.js` | 10 | Commercial, pricing, emergency |
| 5 | `phase5-patch-10.js` | 10 | FAQ/admin scenarios |
| 6 | `phase6-patch-10.js` | 10 | Booking + thermostat |
| 7 | `phase7-patch-10.js` | 10 | Core HVAC (negatives only) |
| 8 | `phase8-patch-6.js` | 6 | Final heating scenarios |

All scripts follow the same pattern and can be used as templates for future batches.

---

## 🔄 Ongoing Maintenance

When adding NEW scenarios or templates:

1. Create a new phase script following the pattern
2. Follow SEP-1 execution flow exactly
3. Verify `Below minimums: 0` after every change
4. Commit scripts to repo (audit trail)

---

## Contact

Questions about scenario architecture? Check:
- This document first
- `routes/admin/globalTemplatesPatch.js` for endpoint implementation
- `services/GlobalTemplatePatchService.js` for business logic
- `middleware/scopeGuard.js` for scope enforcement
- Phase scripts in `/scripts/phase*.js` for batch patterns

