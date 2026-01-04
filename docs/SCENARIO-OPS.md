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

## Contact

Questions about scenario architecture? Check:
- This document first
- `routes/admin/globalTemplatesPatch.js` for endpoint implementation
- `services/GlobalTemplatePatchService.js` for business logic
- `middleware/scopeGuard.js` for scope enforcement

