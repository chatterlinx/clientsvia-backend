# Scripts Directory - Usage Policy

⚠️ **MANDATORY READING FOR ALL ENGINEERS**

---

## 🚨 CRITICAL RULES

### **Rule #1: NEVER Hardcode Company IDs**

```javascript
// ❌ WRONG - Will break when testing different environments
const companyId = '68e3f77a9d623b8058c700c4';

// ❌ WRONG - Might not exist in all environments
const companyId = '68eeaf924e989145e9d46c12';

// ✅ RIGHT - Query dynamically
const company = await Company.findOne({ companyName: 'Royal Plumbing' });
if (!company) {
    console.error('Company not found in this environment');
    process.exit(1);
}
const companyId = company._id.toString();
```

**Why?**
- Local database ≠ Production database
- Company IDs are different across environments
- Hardcoded IDs cause confusion and bugs

---

### **Rule #2: NEVER Create Companies via Scripts**

```javascript
// ❌ FORBIDDEN
const newCompany = new Company({ companyName: 'Test Company' });
await newCompany.save();

// ❌ FORBIDDEN  
await db.collection('companiesCollection').insertOne({ ... });

// ✅ ONLY APPROVED METHOD
// Use Admin UI: https://clientsvia-backend.onrender.com/add-company.html
```

**Why?**
- Bypasses validation logic
- Creates duplicate companies
- Not auditable
- No user accountability

**Exception:** `test-company-lifecycle.js` creates temporary test companies (auto-cleaned).

---

### **Rule #3: Always Check Environment**

```javascript
// ✅ GOOD - Shows which DB you're connecting to
console.log('Connected to:', process.env.MONGODB_URI.substring(0, 50));

// ✅ GOOD - Verify data exists before operating
const count = await Company.countDocuments();
console.log(`Found ${count} companies in this environment`);
```

---

## 📂 Script Categories

### **✅ SAFE - Read-Only Scripts**
These scripts READ data only (no modifications):
- `check-*.js` - Inspection scripts
- `list-*.js` - Listing scripts
- `diagnose-*.js` - Diagnostic scripts
- `verify-*.js` - Verification scripts

**Example:** `check-all-companies.js`

---

### **⚠️ CAUTION - Modification Scripts**
These scripts MODIFY data (use with care):
- `fix-*.js` - Bug fix scripts
- `update-*.js` - Update scripts
- `migrate-*.js` - Migration scripts

**Requirements:**
1. Must log what will be changed BEFORE changing
2. Must ask for confirmation (unless --yes flag)
3. Must log what was changed AFTER changing
4. Must be idempotent (safe to run multiple times)

**Example:** `fix-company-statuses.js`

---

### **🚨 DANGEROUS - Destructive Scripts**
These scripts DELETE data (extreme caution):
- `nuke-*.js` - Deletion scripts
- `purge-*.js` - Cleanup scripts
- `delete-*.js` - Removal scripts

**Requirements:**
1. **MUST** require explicit confirmation
2. **MUST** log exactly what will be deleted
3. **MUST** create backup before deletion
4. **SHOULD** have --dry-run mode
5. **MUST** be tested in local environment first

**Example:** `nuke-legacy-companies.js`

---

## 📋 Script Naming Conventions

| Prefix | Purpose | Example |
|--------|---------|---------|
| `check-` | Inspect data | `check-spam-settings.js` |
| `list-` | List entities | `list-companies.js` |
| `diagnose-` | Debug issues | `diagnose-all-companies.js` |
| `verify-` | Validate state | `verify-spam-filter-schema.js` |
| `fix-` | Repair bugs | `fix-company-statuses.js` |
| `update-` | Modify data | `update-royal-greeting.js` ❌ DELETED |
| `migrate-` | Schema migration | `migrate-settings.js` |
| `nuke-` | Destructive deletion | `nuke-legacy-companies.js` |
| `create-` | Create entities | `create-royal-plumbing.js` ❌ DELETED |
| `seed-` | Populate test data | `seed-v2-trade-categories.js` |
| `test-` | Testing scripts | `test-company-lifecycle.js` |

---

## 🔒 Code Review Checklist

**Before approving a PR with new scripts, verify:**

- [ ] No hardcoded company IDs
- [ ] No company creation logic (except test scripts)
- [ ] Script has clear purpose comment at top
- [ ] Destructive operations require confirmation
- [ ] Environment is logged on connect
- [ ] Errors are handled gracefully
- [ ] Script follows naming convention

---

## 📖 Examples

### **✅ GOOD Script Structure**

```javascript
#!/usr/bin/env node
/**
 * Check Spam Filter Settings
 * 
 * Purpose: Inspect spam filter configuration for a company
 * Safety: READ-ONLY (no modifications)
 * Usage: node scripts/check-spam-settings.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function checkSpamSettings() {
    try {
        // Show environment
        console.log('📡 Connecting to:', process.env.MONGODB_URI.substring(0, 50) + '...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected\n');
        
        // Query dynamically (NOT hardcoded ID)
        const company = await Company.findOne({ companyName: 'Royal Plumbing' });
        if (!company) {
            console.log('❌ Company not found in this environment');
            process.exit(1);
        }
        
        console.log(`✅ Found: ${company.companyName} (${company._id})`);
        console.log('Spam Filter Settings:', company.callFiltering?.settings);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
    }
}

checkSpamSettings();
```

### **❌ BAD Script (Don't Do This)**

```javascript
// ❌ No documentation
// ❌ Hardcoded company ID
// ❌ Creates companies
// ❌ No environment logging

const Company = require('../models/v2Company');

async function run() {
    const company = new Company({  // ❌ Creating company via script
        companyName: 'Royal Plumbing',
        _id: '68e3f77a9d623b8058c700c4'  // ❌ Hardcoded ID
    });
    await company.save();
}
```

---

## 🎓 Best Practices

1. **Always Show Environment**
   ```javascript
   console.log('Environment:', mongoose.connection.db.databaseName);
   ```

2. **Count First, Operate Second**
   ```javascript
   const count = await Company.countDocuments({ status: 'deleted' });
   console.log(`Found ${count} deleted companies`);
   console.log('Proceed? (Ctrl+C to cancel)');
   ```

3. **Use Descriptive Variable Names**
   ```javascript
   // ✅ Good
   const royalPlumbingCompany = await Company.findOne({ ... });
   
   // ❌ Bad
   const c = await Company.findOne({ ... });
   ```

4. **Log Everything**
   ```javascript
   console.log('🔍 Searching for company...');
   console.log('✅ Found:', company.companyName);
   console.log('📝 Updating settings...');
   console.log('✅ Settings saved');
   ```

---

## 📞 Questions?

- Read: `docs/COMPANY-CREATION-POLICY.md`
- Read: `docs/PRODUCTION-DATABASE-INFO.md`
- Read: `docs/SPAM-FILTER-ARCHITECTURE.md`

---

**Remember: When in doubt, DON'T hardcode it!** 🚀

