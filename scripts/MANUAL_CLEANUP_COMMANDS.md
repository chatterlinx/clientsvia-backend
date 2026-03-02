# ☢️ MANUAL NUCLEAR CLEANUP COMMANDS
**Execute these MongoDB commands directly if scripts fail due to env vars**

---

## 🎯 PRE-FLIGHT: Connect to MongoDB

```bash
# Get your MongoDB URI from Render.com dashboard
# Navigate to: clientsvia-backend → Environment → MONGODB_URI

# Connect via mongosh
mongosh "YOUR_MONGODB_URI_HERE"
```

---

## STEP 1: BACKUP (Run these queries and save output)

### Backup 1: Legacy playbook.rules
```javascript
// Find all companies with legacy triggers
db.companies.find(
  { 'aiAgentSettings.agent2.discovery.playbook.rules': { $exists: true, $ne: [] } },
  { 
    _id: 1, 
    businessName: 1, 
    'aiAgentSettings.agent2.discovery.playbook.rules': 1 
  }
).forEach(c => {
  printjson({
    companyId: c._id,
    name: c.businessName,
    legacyCount: c.aiAgentSettings.agent2.discovery.playbook.rules.length,
    legacyTriggers: c.aiAgentSettings.agent2.discovery.playbook.rules
  });
});
```

**Save output to:** `backups/legacy-playbook-backup-TIMESTAMP.json`

---

### Backup 2: CompanyLocalTrigger collection
```javascript
// Export all local triggers
db.companyLocalTriggers.find({}).forEach(printjson);
```

**Save output to:** `backups/company-local-triggers-backup-TIMESTAMP.json`

---

### Backup 3: Current trigger settings
```javascript
// Get Penguin Air settings
db.companyTriggerSettings.findOne({ companyId: '68e3f77a9d623b8058c700c4' });
```

**Save output to:** `backups/penguin-settings-backup-TIMESTAMP.json`

---

## STEP 2: NUCLEAR DELETION

### Delete 1: Clear ALL legacy playbook.rules
```javascript
// Clear playbook.rules from ALL companies
db.companies.updateMany(
  { 'aiAgentSettings.agent2.discovery.playbook.rules': { $exists: true } },
  { $set: { 'aiAgentSettings.agent2.discovery.playbook.rules': [] } }
);

// Verify
db.companies.countDocuments({ 
  'aiAgentSettings.agent2.discovery.playbook.rules': { $exists: true, $ne: [] } 
});
// Should return: 0
```

---

### Delete 2: Remove ALL CompanyLocalTrigger records
```javascript
// Delete all local triggers
db.companyLocalTriggers.deleteMany({});

// Verify
db.companyLocalTriggers.countDocuments({});
// Should return: 0
```

---

### Delete 3: Remove orphaned GlobalTriggers (if any)
```javascript
// Delete GlobalTriggers NOT in hvac-master-v1
db.globalTriggers.deleteMany({
  $or: [
    { groupId: { $ne: 'hvac-master-v1' } },
    { groupId: { $exists: false } },
    { groupId: null }
  ]
});

// Verify
db.globalTriggers.countDocuments({
  $or: [
    { groupId: { $ne: 'hvac-master-v1' } },
    { groupId: null }
  ]
});
// Should return: 0
```

---

## STEP 3: SEED OFFICIAL LIBRARY

### Option A: Run seed script (recommended)
```bash
# From terminal (if you can set MONGODB_URI)
MONGODB_URI="mongodb+srv://..." node scripts/seedTriggerGroupV1.js
```

### Option B: Manual MongoDB insertion

**Too complex for manual entry — 42 triggers with full schemas**

**Recommendation:** Use the seed script instead by exporting the env var:

```bash
export MONGODB_URI="your_mongodb_uri_from_render"
node scripts/seedTriggerGroupV1.js
```

---

## STEP 4: ASSIGN TO COMPANIES

```javascript
// Create/update CompanyTriggerSettings for Penguin Air
db.companyTriggerSettings.updateOne(
  { companyId: '68e3f77a9d623b8058c700c4' },
  {
    $set: {
      activeGroupId: 'hvac-master-v1',
      activeGroupVersionAtSelection: 1,
      groupSelectedAt: new Date(),
      groupSelectedBy: 'manual-cleanup',
      strictMode: true,
      strictModeSetAt: new Date(),
      strictModeSetBy: 'manual-cleanup',
      updatedAt: new Date()
    }
  },
  { upsert: true }
);

// Verify
db.companyTriggerSettings.findOne({ 
  companyId: '68e3f77a9d623b8058c700c4' 
});
// Should show: activeGroupId: 'hvac-master-v1', strictMode: true
```

---

## STEP 5: VERIFY CLEAN STATE

```javascript
// 1. No legacy playbook.rules
db.companies.countDocuments({ 
  'aiAgentSettings.agent2.discovery.playbook.rules': { $ne: [] } 
});
// Expected: 0

// 2. No CompanyLocalTriggers
db.companyLocalTriggers.countDocuments({});
// Expected: 0

// 3. Official library exists
db.globalTriggerGroups.findOne({ groupId: 'hvac-master-v1' });
// Expected: { publishedVersion: 1, triggerCount: 42 }

// 4. Official triggers exist
db.globalTriggers.countDocuments({ 
  groupId: 'hvac-master-v1', 
  state: 'published' 
});
// Expected: 42

// 5. Penguin Air has assignment
db.companyTriggerSettings.findOne({ companyId: '68e3f77a9d623b8058c700c4' });
// Expected: { activeGroupId: 'hvac-master-v1', strictMode: true }
```

---

## 🔧 EASIEST APPROACH: Export Env Var + Run Script

Instead of manual MongoDB commands, just export the env var:

```bash
# Get MONGODB_URI from Render.com dashboard
# Export it in your terminal session
export MONGODB_URI="mongodb+srv://..."

# Then run the nuclear cleanup script
cd /Users/marc/MyProjects/clientsvia-backend
node scripts/nuclearCleanupTriggers.js
```

**This will do everything automatically with backups.**

---

## 🎬 AFTER CLEANUP

Make a test call and check Call Console:

```
Expected in TRIGGER_POOL_SOURCE:
{
  "total": 42,
  "scopes": { "GLOBAL": 42 },
  "ruleIdsByScope": {
    "GLOBAL": ["emergency.gas_smell", "hvac.cooling.not_cooling", ...],
    "UNKNOWN": []
  },
  "activeGroupId": "hvac-master-v1",
  "isGroupPublished": true
}
```

---

**Choose your method and execute!**
