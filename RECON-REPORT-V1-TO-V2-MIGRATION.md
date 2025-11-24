# 🔍 RECONNAISSANCE REPORT: V1 → V2 CHEATSHEET MIGRATION

**Generated:** November 24, 2025  
**Mission:** Kill V1, Make V2 the Only Brain  
**Status:** RECON COMPLETE - READY FOR EXECUTION

---

## 📊 EXECUTIVE SUMMARY

### **Current State:**
- ✅ **V2 Runtime Service EXISTS** and is production-ready (`CheatSheetRuntimeService.js`)
- ✅ **V2 Version Model EXISTS** and is well-designed (`CheatSheetVersion.js`)
- ⚠️ **V1 Legacy Field STILL EXISTS** in Company model (`aiAgentSettings.cheatSheet`)
- ⚠️ **MIXED USAGE** - Some runtime code reads V2, some still reads V1

### **Risk Assessment:**
🔴 **HIGH RISK** - Mixed V1/V2 reads could cause:
- Config inconsistency between booking and runtime
- Cache poisoning if different services read different sources
- Data loss if V1 is deleted before full migration

### **Migration Complexity:**
🟡 **MEDIUM** - Clean service boundaries, well-documented code, but requires careful sequencing

---

## 🗂️ DATABASE SCHEMA ANALYSIS

### **V1 Legacy Location (TO BE KILLED):**

**Path:** `company.aiAgentSettings.cheatSheet`

**Model:** `models/v2Company.js` (line 570-835)

**Structure:**
```javascript
aiAgentSettings: {
  cheatSheet: {
    version: Number,
    status: 'draft' | 'active',
    updatedBy: String,
    updatedAt: Date,
    lastCompiledAt: Date,
    checksum: String,
    compileLock: String,
    
    // Config sections
    behaviorRules: [],
    frontlineIntel: [],
    transferRules: [],
    guardrails: [],
    allowedActions: [],
    bookingRules: [],         // V2 field
    companyContacts: [],      // V2 field
    links: [],                // V2 field
    calculators: []           // V2 field
  }
}
```

**Backup Field Path (FOR ROLLBACK):**
```javascript
aiAgentSettings.cheatSheet_backup
```

---

### **V2 Target Location (THE FUTURE):**

**Collection:** `cheatsheetversions`

**Model:** `models/cheatsheet/CheatSheetVersion.js`

**Structure:**
```javascript
{
  _id: ObjectId,
  companyId: ObjectId (ref: 'Company'),
  versionId: String (unique),
  status: 'live' | 'draft' | 'archived',
  name: String,
  notes: String,
  checksum: String,
  createdBy: String,
  activatedAt: Date,
  archivedAt: Date,
  createdAt: Date,
  updatedAt: Date,
  
  config: {
    schemaVersion: 1,
    triage: {},
    frontlineIntel: {},
    transferRules: {},
    edgeCases: {},
    behavior: {},
    guardrails: {},
    bookingRules: [],
    companyContacts: [],
    links: [],
    calculators: []
  }
}
```

**Live Version Pointer:**
```javascript
company.aiAgentSettings.cheatSheetMeta.liveVersionId: String
```

---

## 🔍 CODEBASE SCAN RESULTS

### **FILES CONTAINING V1 REFERENCES:**

Total files found: **20**

---

### **CATEGORY 1: RUNTIME (HIGH PRIORITY - MUST MIGRATE)**

These are called during live production calls. **CRITICAL PATH**.

#### ✅ **ALREADY V2-ONLY (SAFE):**

1. **`services/cheatsheet/CheatSheetRuntimeService.js`**
   - **Status:** ✅ **ALREADY V2-ONLY**
   - **Reads from:** `CheatSheetVersion` collection (V2)
   - **Method:** `getRuntimeConfig(companyId)`
   - **Cache:** Redis-backed, 1-hour TTL
   - **Performance:** <10ms cache hit, <50ms cache miss
   - **Safety:** Throws `NoLiveConfigError` if no V2 config exists
   - **Action Required:** NONE - This is perfect

---

#### 🔴 **STILL READS V1 (MUST FIX):**

2. **`services/v2AIAgentRuntime.js`** (Line 77-78)
   - **Status:** 🔴 **READS V1**
   - **Code:**
     ```javascript
     if (company.aiAgentSettings?.cheatSheet) {
         const cheatSheet = company.aiAgentSettings.cheatSheet;
     ```
   - **Context:** Policy compiler for agent runtime
   - **Impact:** HIGH - This is the main agent brain
   - **Fix Required:** Replace with `CheatSheetRuntimeService.getRuntimeConfig()`
   - **Estimated Time:** 15 minutes

3. **`src/services/bookingHandler.js`** (Line 473-474)
   - **Status:** 🔴 **READS V1**
   - **Code:**
     ```javascript
     if (company && company.aiAgentSettings && company.aiAgentSettings.cheatSheet) {
       cheatSheet = company.aiAgentSettings.cheatSheet;
     ```
   - **Context:** Booking rules engine
   - **Impact:** HIGH - Affects appointment scheduling
   - **Fix Required:** Replace with `CheatSheetRuntimeService.getRuntimeConfig()`
   - **Estimated Time:** 15 minutes

4. **`services/PolicyCompiler.js`**
   - **Status:** 🟡 **LIKELY READS V1** (needs verification)
   - **Context:** Compiles behavior rules into optimized policy
   - **Impact:** MEDIUM - Used by agent runtime
   - **Fix Required:** Verify usage, replace if needed
   - **Estimated Time:** 20 minutes

---

### **CATEGORY 2: ADMIN UI & ROUTES (MEDIUM PRIORITY)**

These are used by admin dashboard and UI. Not called during live calls.

5. **`public/js/ai-agent-settings/CheatSheetManager.js`**
   - **Status:** 🟢 **MIXED (V1 + V2)**
   - **Context:** Frontend UI manager
   - **V2 Usage:** Loads from `CheatSheetVersion` via versioning adapter
   - **V1 Usage:** May have legacy fallback code
   - **Impact:** LOW - UI only
   - **Fix Required:** Remove any V1 fallback, ensure 100% V2
   - **Estimated Time:** 30 minutes

6. **`routes/v2company.js`**
   - **Status:** 🟡 **LIKELY READS/WRITES V1** (needs verification)
   - **Context:** Company profile CRUD API
   - **Impact:** MEDIUM - Admin profile editing
   - **Fix Required:** Disable V1 cheatSheet saves, redirect to V2 UI
   - **Estimated Time:** 20 minutes

7. **`routes/admin/cheatSheet.js`**
   - **Status:** 🟡 **LEGACY ADMIN ROUTE** (needs verification)
   - **Context:** Old admin cheat sheet API
   - **Impact:** MEDIUM - May be used by legacy UI
   - **Fix Required:** Deprecate or redirect to V2 routes
   - **Estimated Time:** 15 minutes

---

### **CATEGORY 3: SUPPORT SERVICES (LOW PRIORITY)**

These are used by background jobs, scans, and diagnostics.

8. **`services/TriageCardService.js`**
   - **Status:** 🟡 **LIKELY READS V1** (needs verification)
   - **Context:** Triage card management
   - **Impact:** LOW - Admin feature
   - **Fix Required:** Verify if needs migration
   - **Estimated Time:** 15 minutes

9. **`services/EnterpriseVariableScanService.js`**
   - **Status:** 🟡 **SCANS V1 FIELDS** (needs verification)
   - **Context:** Variable placeholder scanning
   - **Impact:** LOW - Diagnostic feature
   - **Fix Required:** Update to scan V2 config
   - **Estimated Time:** 10 minutes

---

### **CATEGORY 4: DOCUMENTATION & TESTS (INFORMATIONAL)**

These don't execute in production. Safe to ignore for now.

10-20. **Documentation & Test Files:**
   - `CHEATSHEET-VERSION-HISTORY-PROPOSAL.md`
   - `CHEATSHEET-FRONTEND-INTEGRATION-PLAN.md`
   - `BOOKING-RULES-SAVE-BUG-FIX-2025-11-20.md`
   - `BOOKING-RULES-IMPLEMENTATION.md`
   - `THE-BRAIN-BUILD-AUDIT-REPORT.md`
   - `ONE-BRAIN-IMPLEMENTATION-COMPLETE.md`
   - `TRIAGE-ENGINE-ONE-BRAIN-ARCHITECTURE.md`
   - `AI-AGENT-CALL-FLOW-SEQUENCE.md`
   - `tests/policy-compiler.test.js`
   - `scripts/migrations/2024-11-20-migrate-cheatsheet-to-versions.js` (OLD SCRIPT - DO NOT USE)

**Action Required:** Update after migration complete

---

## 📋 MIGRATION SCRIPT REQUIREMENTS

### **Script Name:**
`scripts/migrateV1CheatSheetToV2.js`

### **Purpose:**
For every company with V1 cheatSheet, create a V2 live version.

### **Algorithm:**
```
FOR EACH company IN companies:
  
  IF company.aiAgentSettings.cheatSheet DOES NOT EXIST:
    SKIP (log: "No V1 config")
  
  IF CheatSheetVersion.findOne({companyId, status: 'live'}) EXISTS:
    SKIP (log: "Already has V2 live")
  
  ELSE:
    1. BACKUP: Copy aiAgentSettings.cheatSheet → aiAgentSettings.cheatSheet_backup
    2. BUILD V2 config from V1 fields
    3. CREATE CheatSheetVersion:
         companyId: company._id
         versionId: `live-${Date.now()}-${randomId}`
         status: 'live'
         name: 'Migrated Legacy Config'
         config: { V1 → V2 mapping }
         createdBy: 'system:migration'
         activatedAt: now
    4. UPDATE company.aiAgentSettings.cheatSheetMeta.liveVersionId
    5. LOG: "MIGRATED: companyId=..."
```

### **Idempotency:**
- If run twice, should detect existing V2 live and skip
- No duplicate lives created

### **Rollback Plan:**
- Backup field: `aiAgentSettings.cheatSheet_backup`
- Contains exact V1 data before migration
- Can be manually restored if needed
- Auto-expire after 30 days (optional)

---

## 🎯 EXECUTION SEQUENCE

### **PHASE B: MIGRATION SCRIPT**
**Time Estimate:** 1 hour (build + test)

1. Build migration script
2. Add dry-run mode (log only, no writes)
3. Test on 1 sample company
4. Run full migration
5. Verify all companies have V2 live

---

### **PHASE C: RUNTIME CUTOVER**
**Time Estimate:** 1.5 hours

**Priority Order (CRITICAL FIRST):**

1. 🔴 **`services/v2AIAgentRuntime.js`** (15 min)
   - Replace V1 read with `CheatSheetRuntimeService.getRuntimeConfig()`
   - Test with sample call
   
2. 🔴 **`src/services/bookingHandler.js`** (15 min)
   - Replace V1 read with `CheatSheetRuntimeService.getRuntimeConfig()`
   - Test booking flow
   
3. 🟡 **`services/PolicyCompiler.js`** (20 min)
   - Verify and replace V1 usage
   - Test policy compilation

4. 🟡 **`routes/v2company.js`** (20 min)
   - Disable V1 cheatSheet saves
   - Return error if attempted

5. 🟡 **`routes/admin/cheatSheet.js`** (15 min)
   - Deprecate or redirect to V2 routes

6. 🟢 **`services/TriageCardService.js`** (15 min)
   - Update to use V2

7. 🟢 **`services/EnterpriseVariableScanService.js`** (10 min)
   - Update to scan V2 config

---

### **PHASE D: UI DISABLE/REDIRECT**
**Time Estimate:** 30 minutes

1. Find old V1 cheat sheet UI in `company-profile.html` (or similar)
2. Replace with banner: "AI Brain Settings Have Moved"
3. Add CTA button → Link to Control Plane V2
4. Remove all V1 save handlers

---

### **PHASE E: CLEANUP**
**Time Estimate:** 15 minutes

1. Run cleanup script:
   ```javascript
   db.companies.updateMany(
     { 'aiAgentSettings.cheatSheet': { $exists: true } },
     { $unset: { 'aiAgentSettings.cheatSheet': "" } }
   );
   ```
2. Log how many docs modified
3. Verify V1 field no longer exists

---

## ⚠️ RISK MATRIX

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Config loss during migration | LOW | 🔴 CRITICAL | Backup field, dry-run first |
| Runtime fails if no V2 | MEDIUM | 🔴 CRITICAL | Migration script MUST run first |
| Mixed V1/V2 reads during cutover | HIGH | 🟡 MEDIUM | Phase B before Phase C |
| Cache poisoning | LOW | 🟡 MEDIUM | Invalidate cache after migration |
| Admin UI breaks | LOW | 🟢 LOW | V2 UI already exists |

---

## ✅ ACCEPTANCE CRITERIA

### **Data Migration:**
- [ ] Every company with V1 has a V2 live version
- [ ] Backup field created for all migrated companies
- [ ] `liveVersionId` set in `cheatSheetMeta`
- [ ] No companies left without live config

### **Runtime:**
- [ ] ALL runtime code reads from V2 only
- [ ] NO code reads from `aiAgentSettings.cheatSheet`
- [ ] Test calls work correctly
- [ ] Booking flows work correctly
- [ ] After-hours works correctly

### **UI:**
- [ ] No V1 cheat sheet editor visible
- [ ] Redirect banner shows in old locations
- [ ] Control Plane V2 is the only editing interface

### **Cleanup:**
- [ ] V1 field removed from all companies
- [ ] Backup field exists and accessible
- [ ] No runtime errors after cleanup

---

## 🚀 NEXT STEPS

**Chief Engineer approval required before proceeding to:**

1. **PHASE B:** Build migration script
2. **PHASE C:** Runtime cutover
3. **PHASE D:** UI disable
4. **PHASE E:** Cleanup

**Total Estimated Time:** ~4 hours (excluding Phase E, which is post-verification)

---

**END OF RECON REPORT**

**Status:** ✅ READY FOR APPROVAL  
**Awaiting:** GO PHASE B command

