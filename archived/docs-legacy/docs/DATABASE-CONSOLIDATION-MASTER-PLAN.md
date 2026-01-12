# 🗄️ DATABASE CONSOLIDATION MASTER PLAN
**Objective**: Eliminate ALL legacy collections and use ONLY modern `v2` collections

---

## 🚨 CURRENT PROBLEM

The system has **DUAL COLLECTION SUPPORT** with fallback logic:

### **Company Collections:**
- ✅ **PRIMARY**: `companiesCollection` (modern)
- ❌ **LEGACY**: `companies` (old, causes confusion)
- 🔀 **MERGE LOGIC**: Data Center queries BOTH and merges results

### **Related Collections:**
- ✅ **PRIMARY**: `v2aiagentcalllogs`, `v2contacts`, `v2notificationlogs`
- ❌ **LEGACY**: `aiagentcalllogs`, `contacts`, `notificationlogs`
- 🔀 **FALLBACK**: System tries modern first, falls back to legacy

---

## 📊 CURRENT DATABASE STATE (Production)

Based on investigation:

```
✅ companiesCollection: 1 document (Royal Plumbing - 68eeaf924e989145e9d46c12)
❓ companies (legacy): ??? (likely has Total Air + old Royal Plumbing)
✅ v2aiagentcalllogs: 0 documents
❌ aiagentcalllogs: ??? 
✅ v2contacts: 0 documents
❌ contacts: ??? 
✅ v2notificationlogs: 0 documents
❌ notificationlogs: ???
```

**The Data Center shows 2 companies with different IDs, meaning they're split across collections!**

---

## 🎯 CONSOLIDATION STRATEGY

### **PHASE 1: DISCOVERY** (15 minutes)
**Goal**: Know EXACTLY what data exists in legacy collections

**Actions**:
1. Connect to **PRODUCTION** MongoDB (not local test DB)
2. Count documents in ALL legacy collections
3. Export sample data from each legacy collection
4. Identify which companies are in `companies` vs `companiesCollection`
5. Check for duplicate companies (same name, different IDs)

**Script**: `scripts/production-legacy-discovery.js`

---

### **PHASE 2: DATA MIGRATION** (30 minutes)
**Goal**: Copy ALL legacy data to modern collections (safe, non-destructive)

**Actions**:
1. **Migrate `companies` → `companiesCollection`**
   - Check for duplicates (by name/email)
   - If duplicate: Keep newer, archive older
   - If unique: Copy to `companiesCollection`
   - Preserve all fields: callFiltering, twilioConfig, etc.

2. **Migrate call logs**
   - Copy `aiagentcalllogs` → `v2aiagentcalllogs`
   - Update `companyId` references if IDs changed

3. **Migrate contacts**
   - Copy `contacts` → `v2contacts`
   - Update `companyId` references

4. **Migrate notifications**
   - Copy `notificationlogs` → `v2notificationlogs`
   - Update `companyId` references

**Script**: `scripts/production-legacy-migration.js`

---

### **PHASE 3: VERIFICATION** (15 minutes)
**Goal**: Confirm ALL data is safely in modern collections

**Actions**:
1. Count documents: modern collections should have >= legacy counts
2. Spot-check critical data:
   - Company names match
   - Call logs have correct companyId references
   - Spam filter settings preserved
3. Test Data Center: Should show same companies as before
4. Test Company Profile: Settings should load correctly

**Script**: `scripts/verify-migration.js`

---

### **PHASE 4: REMOVE LEGACY FALLBACK CODE** (20 minutes)
**Goal**: Stop querying legacy collections entirely

**Files to Update**:

#### **1. `routes/admin/dataCenter.js`**
```javascript
// BEFORE (lines 71-73):
const legacyCollection = collectionsMap.companies === 'companiesCollection' && names.has('companies')
    ? db.collection('companies')
    : null;

// AFTER:
const legacyCollection = null; // ← FORCE NULL, no legacy fallback!
```

#### **2. `routes/admin/dataCenter.js` - buildCollectionsMap**
```javascript
// BEFORE (lines 30-37):
return {
    companies: names.has('companiesCollection') ? 'companiesCollection' : 'companies',
    calls: names.has('v2aiagentcalllogs') ? 'v2aiagentcalllogs' : (names.has('aiagentcalllogs') ? 'aiagentcalllogs' : null),
    ...
};

// AFTER:
return {
    companies: 'companiesCollection',  // ← ALWAYS use modern!
    calls: 'v2aiagentcalllogs',        // ← No fallback!
    contacts: 'v2contacts',
    notifications: 'v2notificationlogs',
    transcripts: 'conversationlogs',
    customers: 'customers'
};
```

#### **3. Grep for ALL legacy references**
```bash
grep -r "aiagentcalllogs\|contacts\|notificationlogs" routes/ services/ utils/
```
Remove ALL fallback logic to legacy collections.

---

### **PHASE 5: RENAME LEGACY COLLECTIONS** (5 minutes)
**Goal**: Make legacy collections unusable (but preserve as backup)

**Actions**:
1. Rename in MongoDB:
   ```javascript
   db.companies.renameCollection('companies_ARCHIVED_2025_01')
   db.aiagentcalllogs.renameCollection('aiagentcalllogs_ARCHIVED_2025_01')
   db.contacts.renameCollection('contacts_ARCHIVED_2025_01')
   db.notificationlogs.renameCollection('notificationlogs_ARCHIVED_2025_01')
   ```

2. **Result**: Code can't accidentally query them anymore!

**Script**: `scripts/archive-legacy-collections.js`

---

### **PHASE 6: TESTING** (30 minutes)
**Goal**: Verify everything works with ONLY modern collections

**Test Cases**:
1. ✅ Data Center loads all companies
2. ✅ Company Profile loads settings (spam filter, twilio, etc)
3. ✅ Spam Filter saves/loads correctly
4. ✅ Call logs display
5. ✅ Contacts display
6. ✅ No errors in console mentioning legacy collections

---

### **PHASE 7: PERMANENT DELETION** (After 30 days)
**Goal**: Delete archived legacy collections forever

**Actions** (ONLY after 30 days of stable operation):
```javascript
db.companies_ARCHIVED_2025_01.drop()
db.aiagentcalllogs_ARCHIVED_2025_01.drop()
db.contacts_ARCHIVED_2025_01.drop()
db.notificationlogs_ARCHIVED_2025_01.drop()
```

---

## 🛡️ SAFETY MEASURES

1. **NEVER DELETE FIRST**: Always migrate THEN archive THEN delete
2. **FULL BACKUP**: Before starting, export entire MongoDB database
3. **TEST ON STAGING**: If you have a staging environment, do this there first
4. **MONITOR LOGS**: Watch for errors mentioning "not found" or "collection"
5. **ROLLBACK PLAN**: Keep archived collections for 30 days minimum

---

## 🚀 RECOMMENDED EXECUTION ORDER

### **NOW (Immediate)**
1. Run **Phase 1: Discovery** - understand what data exists
2. Review findings together
3. Decide on migration strategy for duplicates

### **NEXT SESSION (When ready)**
1. Full database backup
2. Run **Phase 2: Migration**
3. Run **Phase 3: Verification**
4. If verified ✅ → continue

### **SAME SESSION (If Phase 3 passes)**
1. Run **Phase 4: Remove Fallback Code**
2. Deploy to production
3. Run **Phase 6: Testing**

### **SAME SESSION (If Phase 6 passes)**
1. Run **Phase 5: Archive Legacy**
2. Monitor for 30 days

### **30 DAYS LATER**
1. If no issues → **Phase 7: Permanent Deletion**

---

## 📝 NOTES

### **Global AI Brain Collections**
These are intentionally separate and should NOT be consolidated:
- `globalinstantresponsetemplates` ← Global templates (shared across companies)
- `tradeCategories` / `enterpriseTradeCategories` ← Global trade data
- These are NOT legacy, they're architectural!

### **Why This Matters**
- **Single Source of Truth**: No more "which collection has the real data?"
- **Performance**: No more dual queries + merging
- **Debugging**: Clear error messages, no fallback confusion
- **Spam Filter Issue**: Will NEVER happen again!

---

## ✅ SUCCESS CRITERIA

After consolidation:
1. ✅ Only ONE company collection exists: `companiesCollection`
2. ✅ Only ONE call log collection: `v2aiagentcalllogs`
3. ✅ Only ONE contacts collection: `v2contacts`
4. ✅ Zero references to legacy collections in code
5. ✅ Data Center shows correct company count
6. ✅ Spam Filter saves/loads correctly on ALL companies
7. ✅ All tests pass

---

## 🤝 READY TO START?

**Say the word and I'll build the Phase 1 discovery script!** 🚀

