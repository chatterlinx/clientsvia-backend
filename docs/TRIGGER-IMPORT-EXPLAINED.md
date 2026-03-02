# Trigger Import System - Complete Explanation

## Table of Contents
1. [The Confusion: What You Thought Was Happening](#the-confusion)
2. [The Reality: How Import Actually Works](#the-reality)
3. [The Two Import Paths](#the-two-import-paths)
4. [How Groups Are Actually Created](#how-groups-are-actually-created)
5. [Diagnosing Your Current State](#diagnosing-your-current-state)
6. [Best Practices](#best-practices)

---

## The Confusion: What You Thought Was Happening

You suspected that when you imported JSON files with names like:
- `HVAC-activemaster-v1.json`
- `hvac-master-v1.json`
- `hvac-v1.json`

...that the import process was reading the filename and creating trigger groups with those names.

**This is NOT what happens.**

---

## The Reality: How Import Actually Works

### Bulk Import (UI Feature)

When you use the "Import Triggers" button in the UI:

1. **Location**: `public/agent-console/triggers.js` (lines 2638-2746)
2. **User Action**: Paste JSON array into modal
3. **Validation**: Each trigger validated for required fields (`ruleId`, `label`, `answerText`)
4. **API Call**: For each trigger, calls `POST /:companyId/local-triggers`
5. **Result**: Creates **LOCAL triggers** (company-specific)

**Key Facts:**
- ✅ Filename is **NEVER read or used**
- ✅ JSON structure contains **NO group fields**
- ✅ All triggers become **LOCAL** (not global)
- ✅ No groups are created or referenced

### Code Evidence

```javascript
// File: public/agent-console/triggers.js (lines 2719-2724)
for (let i = 0; i < valid.length; i++) {
  try {
    await apiFetch(`${CONFIG.API_BASE_COMPANY}/${state.companyId}/local-triggers`, {
      method: 'POST',
      body: valid[i]
    });
```

This calls the endpoint: `POST /api/company/:companyId/local-triggers`

Which is defined in: `routes/admin/companyTriggers.js` (line 620)

That endpoint creates a `CompanyLocalTrigger` document (line 830) with:
- `companyId`: The current company
- `ruleId`: From the JSON
- `label`: From the JSON
- **NO groupId field**

---

## The Two Import Paths

Your system has TWO completely different ways to create triggers:

| Feature | Bulk Import (UI) | Seed Script |
|---------|------------------|-------------|
| **File** | `public/agent-console/triggers.js` | `scripts/seedTriggerGroupV1.js` |
| **User Interface** | Web UI modal | Command line |
| **Creates** | LOCAL triggers | GLOBAL triggers |
| **Group Behavior** | No groups involved | Creates/updates ONE group (hardcoded) |
| **Access** | Any authenticated user | Server admin only |
| **Endpoint** | `POST /:companyId/local-triggers` | Direct MongoDB operations |
| **Collection** | `companyLocalTriggers` | `globalTriggers` + `globalTriggerGroups` |
| **Scope** | Single company only | All companies (shared library) |

### Example: Same JSON, Different Outcomes

If you import `triggers-master-v1.json`:

**Via UI Bulk Import:**
```javascript
Result: 42 CompanyLocalTrigger documents created
        companyId: "68e3f77a9d623b8058c700c4"
        scope: LOCAL
        groupId: null
```

**Via Seed Script:**
```javascript
Result: 1 GlobalTriggerGroup created: { groupId: 'hvac-master-v1' }
        42 GlobalTrigger documents created
        state: 'published'
        groupId: 'hvac-master-v1'
```

---

## How Groups Are Actually Created

### Method 1: Seed Script (Recommended)

```bash
node scripts/seedTriggerGroupV1.js
```

This script:
1. Hardcodes the group ID: `hvac-master-v1` (line 37)
2. Creates a `GlobalTriggerGroup` document
3. Creates 42 `GlobalTrigger` documents linked to that group
4. Sets `publishedVersion: 1` (makes it live)

**To create a different group**, you would need to:
- Edit line 37: `const GROUP_ID = 'dental-office-v1';`
- Edit line 38: `const GROUP_NAME = 'Dental Office V1';`
- Run the script again

### Method 2: Migration Script

```bash
node scripts/migrate-triggers-to-global-system.js --execute --create-hvac-group
```

This creates a group called `hvac` (not `hvac-master-v1`) and migrates legacy triggers.

### Method 3: Admin UI (Platform Admins Only)

Platform admins can create groups through the web UI:
- Endpoint: `POST /api/admin/trigger-groups`
- File: `routes/admin/globalTriggers.js`

### Method 4: Manual Database Operations

Direct MongoDB commands (as shown in `MANUAL_CLEANUP_COMMANDS.md`)

---

## How Multiple Groups Were Likely Created

Based on the codebase evidence, here's the probable sequence:

### Phase 1: Legacy System
- Triggers stored in: `company.aiAgentSettings.agent2.discovery.playbook.rules[]`
- No groups, no global triggers

### Phase 2: Migration (Confusion Period)
Someone ran migration/seed scripts multiple times, possibly:

1. **Migration script** → Created group: `hvac`
2. **Testing/experimentation** → Created groups: `hvac-v1`, `hvac-test`, etc.
3. **Seed script V1** → Created group: `hvac-master-v1`
4. **Multiple seed runs** → May have created duplicates or variants

### Phase 3: Cleanup
Manual cleanup commands were run (as documented in `MANUAL_CLEANUP_COMMANDS.md`):
- Deleted all groups except `hvac-master-v1`
- Deleted all global triggers not in `hvac-master-v1`
- Set company settings to use `hvac-master-v1`

### Current State (Should Be)
- **One group**: `hvac-master-v1`
- **42 global triggers** in that group
- **Companies assigned** to `hvac-master-v1`

---

## Diagnosing Your Current State

### Step 1: Run the Diagnostic Script

```bash
node scripts/check-trigger-groups.js
```

This will show you:
- All GlobalTriggerGroups that exist
- How many triggers are in each group
- Which companies are assigned to which groups
- Any mismatches or issues

### Step 2: Check for Duplicates

```bash
# In MongoDB shell or Compass
db.globalTriggerGroups.find({}, { groupId: 1, name: 1, triggerCount: 1, companyCount: 1 })
```

Expected result: **ONE group** (`hvac-master-v1`)

If you see multiple groups:
```json
[
  { "groupId": "hvac-master-v1", "triggerCount": 42, "companyCount": 1 },
  { "groupId": "hvac-v1", "triggerCount": 42, "companyCount": 0 },
  { "groupId": "hvac", "triggerCount": 10, "companyCount": 0 }
]
```

Then you have leftover groups from testing/migration.

### Step 3: Check Company Assignment

```bash
db.companyTriggerSettings.find(
  { companyId: "68e3f77a9d623b8058c700c4" },
  { activeGroupId: 1, strictMode: 1 }
)
```

Expected:
```json
{
  "activeGroupId": "hvac-master-v1",
  "strictMode": true
}
```

---

## Best Practices

### For Creating Triggers

**Option 1: Use Global Triggers (Recommended for Standard Library)**
1. Create one master JSON file: `triggers-master-v1.json`
2. Run seed script: `node scripts/seedTriggerGroupV1.js`
3. Assign group to companies via UI or API
4. All companies share the same trigger library
5. Companies can override individual triggers if needed

**Option 2: Use Local Triggers (For Company-Specific Customizations)**
1. Use UI "Import Triggers" button
2. Paste JSON array
3. Creates LOCAL triggers for that company only
4. Does NOT affect other companies

### For Managing Groups

**DO:**
- ✅ Keep ONE canonical group per industry (e.g., `hvac-master-v1`)
- ✅ Version your groups (`v1`, `v2`) when making major changes
- ✅ Use the seed script to create/update groups
- ✅ Document group purpose and contents

**DON'T:**
- ❌ Create multiple groups with similar names (`hvac`, `hvac-v1`, `hvac-master`)
- ❌ Use bulk import UI to create global triggers (it can't do that)
- ❌ Manually edit `globalTriggers` collection without updating `globalTriggerGroups`

### For Troubleshooting

If you have multiple groups and want to consolidate:

1. **Identify the canonical group**:
   ```bash
   node scripts/check-trigger-groups.js
   ```

2. **Choose which to keep** (probably `hvac-master-v1`)

3. **Delete unused groups**:
   ```javascript
   // In MongoDB shell
   db.globalTriggerGroups.deleteMany({ 
     groupId: { $ne: 'hvac-master-v1' } 
   });
   
   db.globalTriggers.deleteMany({ 
     groupId: { $ne: 'hvac-master-v1' } 
   });
   ```

4. **Verify company assignments**:
   ```javascript
   db.companyTriggerSettings.updateMany(
     { companyId: "68e3f77a9d623b8058c700c4" },
     { $set: { activeGroupId: 'hvac-master-v1' } }
   );
   ```

5. **Clear cache**:
   ```javascript
   // Via UI or API
   POST /api/company/:companyId/triggers/clear-cache
   ```

---

## Summary

**The filename does NOT create groups.**

- ✅ Bulk Import (UI) creates LOCAL triggers (company-specific)
- ✅ Seed Script creates GLOBAL triggers + ONE group (hardcoded in script)
- ✅ Groups are created explicitly via scripts or admin UI
- ✅ Multiple imports of the same file do NOT create multiple groups
- ✅ Your multiple groups likely came from running different migration/seed scripts during setup

**To verify your current state**: Run `node scripts/check-trigger-groups.js`

**To clean up**: Delete all groups except the one you want to keep, reassign companies, clear cache.
