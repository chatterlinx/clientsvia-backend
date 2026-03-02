# Trigger Import - Quick Reference

## TL;DR

**The filename does NOT create groups. Period.**

When you use "Import Triggers" in the UI, it:
- Creates LOCAL triggers (company-specific)
- Does NOT create or reference groups
- Filename is completely ignored

## Quick Diagnostic

```bash
# Check what groups actually exist
node scripts/check-trigger-groups.js
```

## The Two Ways to Import

### 1. UI Bulk Import → Creates LOCAL Triggers

**Location**: Agent Console → Triggers → Import/Export → Import Triggers

**What happens**:
```
JSON File → UI Modal → POST /api/company/:companyId/local-triggers
                    → CompanyLocalTrigger documents created
                    → ONE company only
                    → NO groups involved
```

**Use case**: Company-specific customizations

### 2. Seed Script → Creates GLOBAL Triggers + Group

**Location**: `scripts/seedTriggerGroupV1.js`

**What happens**:
```
JSON File → Seed Script → GlobalTriggerGroup created (hardcoded: 'hvac-master-v1')
                       → GlobalTrigger documents created
                       → Shared across ALL companies
```

**Use case**: Standard industry library

## How Multiple Groups Get Created

Groups are created by:
1. ✅ Running seed scripts with different GROUP_ID values
2. ✅ Running migration scripts
3. ✅ Platform admin creating via UI
4. ✅ Manual database operations
5. ❌ **NOT by bulk import filename** ← This is the key point

## If You Have Multiple Groups

```javascript
// MongoDB shell - List all groups
db.globalTriggerGroups.find({}, { groupId: 1, name: 1, triggerCount: 1 })

// Expected: ONE group
// If you see multiple, they were created by scripts/admin, not by import
```

## Clean Up Multiple Groups

```bash
# 1. Check current state
node scripts/check-trigger-groups.js

# 2. Decide which group to keep (probably 'hvac-master-v1')

# 3. Delete others (MongoDB shell)
db.globalTriggerGroups.deleteMany({ groupId: { $ne: 'hvac-master-v1' } });
db.globalTriggers.deleteMany({ groupId: { $ne: 'hvac-master-v1' } });

# 4. Verify company assignments
db.companyTriggerSettings.find({}, { companyId: 1, activeGroupId: 1 })

# 5. Fix if needed
db.companyTriggerSettings.updateMany(
  { companyId: "YOUR_COMPANY_ID" },
  { $set: { activeGroupId: 'hvac-master-v1' } }
);
```

## Common Misconceptions

| Myth | Reality |
|------|---------|
| "Importing `hvac-master-v1.json` creates a group called hvac-master-v1" | ❌ Filename is ignored. Creates LOCAL triggers with no group |
| "If I import the same file 3 times, I get 3 groups" | ❌ You get duplicate LOCAL triggers (or errors if ruleId conflicts) |
| "The import reads the filename to determine the group" | ❌ Import code never touches the filename |
| "Multiple imports created my multiple groups" | ❌ Groups were created by seed/migration scripts |

## File Structure Reference

```
docs/triggers-master-v1.json  ← JSON data file (42 triggers)
├─ Used by UI import        → Creates LOCAL triggers (no group)
└─ Used by seed script      → Creates GLOBAL triggers + group 'hvac-master-v1'
```

## Key Takeaway

**The import filename mystery is solved**: The filename does nothing. Groups were created by running different scripts or admin operations during your system setup/migration.

Run `node scripts/check-trigger-groups.js` to see what you actually have.
