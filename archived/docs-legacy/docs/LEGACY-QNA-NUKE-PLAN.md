# 🔥 LEGACY QNA COMPLETE NUCLEAR ELIMINATION PLAN

**Created:** November 9, 2025  
**Status:** READY TO EXECUTE  
**Risk Level:** MEDIUM (legacy code, but has tentacles)

---

## 🎯 WHAT WE'RE NUKING

### **System Context:**

**OLD SYSTEM (LEGACY - TO BE REMOVED):**
```
Priority 1: Company Q&A (0.8 threshold) ❌ LEGACY
Priority 2: Trade Q&A (0.75 threshold) ❌ LEGACY  
Priority 3: Templates (0.7 threshold) ❌ LEGACY
Priority 4: In-House Fallback ✅ STILL USED
```

**NEW SYSTEM (CURRENT PRODUCTION):**
```
Priority 1: instantResponses (AI Brain / Scenario Pool) ✅ ACTIVE
Priority 2: inHouseFallback (Generic responses) ✅ ACTIVE
```

### **The Legacy System Was Replaced By:**
- **AI Brain** (Scenario Pool + Templates)
- **3-Tier Intelligence** (Rule-based → Semantic → LLM)
- All knowledge now in `globalInstantResponseTemplates` collection

---

## 📂 FILES TO DELETE (3 FILES)

### **1. models/LocalCompanyQnA.js**
- **Status:** 100% DEAD CODE
- **Used By:** NOTHING (no require statements found)
- **Safe to Delete:** YES ✅
- **Collection:** `localcompanyqnas`

### **2. models/knowledge/CompanyQnA.js**
- **Status:** IMPORTED BUT NOT USED IN PRODUCTION
- **Used By:** 
  - ✅ services/knowledge/CompanyKnowledgeService.js (service exists but NOT called)
  - ✅ routes/v2twilio.js (imported but not used)
  - ✅ routes/admin/aiAgentMonitoring.js (legacy admin view)
  - ✅ services/accountDeletionService.js (cleanup only)
  - ✅ scripts/regenerate-keywords.js (legacy script)
  - ✅ tests/multi-tenant-isolation.test.js (test file)
- **Safe to Delete:** YES ✅ (after removing references)
- **Collection:** `companyqnas`

### **3. models/CompanyQnACategory.js**
- **Status:** USED IN LEGACY ROUTER CODE
- **Used By:**
  - ✅ services/v2priorityDrivenKnowledgeRouter.js:673 (queryCompanyQnA function - LEGACY)
  - ✅ routes/v2company.js:543 (company Q&A management - LEGACY)
- **Safe to Delete:** YES ✅ (after removing router code)
- **Collection:** `companyqnacategories`

---

## 🔧 CODE TO REMOVE

### **services/v2priorityDrivenKnowledgeRouter.js**

**REMOVE Lines 257-262:** (switch cases)
```javascript
case 'companyQnA':
    result = await this.queryCompanyQnA(companyId, query, context);
    break;
case 'tradeQnA':
    result = await this.queryTradeQnA(companyId, query, context);
    break;
```

**REMOVE Lines 648-769:** (queryCompanyQnA function)
```javascript
async queryCompanyQnA(companyId, query, context) {
    // ~120 lines of legacy code
}
```

**REMOVE Lines 770-890:** (queryTradeQnA function - if exists)
```javascript
async queryTradeQnA(companyId, query, context) {
    // ~120 lines of legacy code
}
```

**REMOVE import at top:**
```javascript
const CompanyQnACategory = require('../models/CompanyQnACategory');
```

---

### **routes/v2twilio.js**

**REMOVE Line 25:** (unused import)
```javascript
const CompanyKnowledgeQnA = require('../models/knowledge/CompanyQnA');
```

---

### **routes/v2company.js**

**REMOVE Line 543:** (unused import)
```javascript
const CompanyQnACategory = require('../models/CompanyQnACategory');
```

---

### **services/knowledge/CompanyKnowledgeService.js**

**ENTIRE FILE TO DELETE** (232 lines)
- This service is NOT called by production V2 system
- Only exists for legacy Company Q&A system

---

### **routes/admin/aiAgentMonitoring.js**

**REMOVE Line 27:**
```javascript
const CompanyKnowledgeQnA = require('../../models/knowledge/CompanyQnA');
```

**FIND & REMOVE:** Any code that queries CompanyKnowledgeQnA

---

### **services/accountDeletionService.js**

**REMOVE Line 42:**
```javascript
const CompanyKnowledgeQnA = require('../models/knowledge/CompanyQnA');
```

**FIND & REMOVE:** Code that deletes company Q&As (cleanup function)

---

### **scripts/regenerate-keywords.js**

**ENTIRE SCRIPT TO DELETE**
- Legacy script for regenerating Q&A keywords
- Not needed with new AI Brain system

---

### **tests/multi-tenant-isolation.test.js**

**REMOVE Line 24:**
```javascript
const CompanyKnowledgeQnA = require('../models/knowledge/CompanyQnA');
```

**FIND & REMOVE:** Test cases for Company Q&A isolation

---

## 🗑️ DATABASE CLEANUP (OPTIONAL)

**MongoDB Collections to Drop:**
```bash
# CAUTION: This will permanently delete data!
db.localcompanyqnas.drop()
db.companyqnas.drop()
db.companyqnacategories.drop()
```

**⚠️ RECOMMENDATION:** Keep collections for 30 days in case of rollback

---

## 🧪 TESTING PLAN

### **Before Deletion:**
1. Confirm no production companies have `companyQnA` or `tradeQnA` in their priority config
2. Check admin dashboard doesn't have "Company Q&A" tab anymore
3. Verify new AI Brain (Scenario Pool) is working perfectly

### **After Deletion:**
1. Test full call flow: Dial → Greeting → Question → Response
2. Verify AI Brain matching works (instantResponses)
3. Check no errors in Render logs
4. Test fallback system (inHouseFallback)
5. Run npm test (if test files still pass)

---

## 🚨 ROLLBACK PLAN

**If Something Breaks:**

1. **Revert Git Commit:**
   ```bash
   git revert HEAD
   git push origin main
   ```

2. **Render Auto-Deploy:**
   - Wait 3-5 minutes for deployment
   - Test calls again

3. **Manual Restore:**
   - Files backed up in Git history
   - MongoDB collections have 30-day grace period

---

## 📊 EXECUTION ORDER

### **Phase 1: Remove Dead Code (SAFE)**
1. Delete `models/LocalCompanyQnA.js` (not used anywhere) ✅
2. Remove imports from routes/v2twilio.js, routes/v2company.js ✅
3. Commit: "Remove unused LocalCompanyQnA model"

### **Phase 2: Remove Legacy Router Code**
1. Remove switch cases from v2priorityDrivenKnowledgeRouter.js ✅
2. Remove queryCompanyQnA and queryTradeQnA functions ✅
3. Remove CompanyQnACategory import ✅
4. Commit: "Remove legacy Company/Trade QnA routing from priority system"

### **Phase 3: Remove Legacy Models**
1. Delete `models/knowledge/CompanyQnA.js` ✅
2. Delete `models/CompanyQnACategory.js` ✅
3. Update all files that import these ✅
4. Commit: "Delete legacy Company QnA models"

### **Phase 4: Clean Up Services & Scripts**
1. Delete `services/knowledge/CompanyKnowledgeService.js` ✅
2. Delete `scripts/regenerate-keywords.js` ✅
3. Update account deletion service ✅
4. Update admin monitoring ✅
5. Commit: "Remove legacy QnA services and scripts"

### **Phase 5: Update Tests**
1. Remove Company QnA tests ✅
2. Update test fixtures ✅
3. Commit: "Remove legacy QnA tests"

### **Phase 6: Deploy & Verify**
1. Push all commits to GitHub ✅
2. Manual deploy on Render ✅
3. Test full call flow ✅
4. Monitor logs for 24 hours ✅

---

## ✅ SUCCESS CRITERIA

- [ ] All 3 model files deleted
- [ ] All imports removed (no errors)
- [ ] Router has no companyQnA/tradeQnA cases
- [ ] Tests pass (or legacy tests removed)
- [ ] Production calls work perfectly
- [ ] AI Brain (Scenario Pool) is sole knowledge source
- [ ] No errors in Render logs for 24 hours

---

## 🎯 WHY WE'RE DOING THIS

**Problem:** Legacy Q&A system confuses developers and creates maintenance burden

**Solution:** Single source of truth - AI Brain (Scenario Pool + Templates)

**Benefits:**
- ✅ Cleaner codebase (remove ~1000+ lines)
- ✅ Faster onboarding (one system to learn)
- ✅ Better performance (fewer code paths)
- ✅ Easier maintenance (no duplicate systems)
- ✅ Clear architecture (no confusion)

---

**🚀 READY TO EXECUTE WHEN USER CONFIRMS!**

