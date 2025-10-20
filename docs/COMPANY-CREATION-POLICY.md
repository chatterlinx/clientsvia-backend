# Company Creation Policy

## 🚨 CRITICAL: Only ONE Way to Create Companies

### ✅ APPROVED METHOD (Production)

**Companies MUST be created ONLY through the Admin UI:**

1. Navigate to: `https://clientsvia-backend.onrender.com/add-company.html`
2. Fill out the form
3. Submit

**Backend Endpoint:**
- `POST /api/companies` (in `routes/v2company.js`)
- This is the ONLY legitimate company creation endpoint

---

## ❌ FORBIDDEN METHODS

### 1. NEVER Create Companies via Scripts

**DO NOT** create scripts like:
- ❌ `create-royal-plumbing.js`
- ❌ `initialize-company.js`
- ❌ `seed-companies.js`

**WHY?**
- Creates duplicate companies with different IDs
- Bypasses validation logic
- Creates confusion across environments (local vs production)
- Not auditable
- No user accountability

---

### 2. NEVER Hardcode Company IDs

**BAD:**
```javascript
const companyId = '68eeaf924e989145e9d46c12'; // ❌ WRONG!
```

**GOOD:**
```javascript
// Query dynamically
const company = await Company.findOne({ companyName: 'Royal Plumbing' });
if (!company) {
    throw new Error('Company not found');
}
const companyId = company._id.toString();
```

---

### 3. NEVER Use Direct MongoDB Inserts

**FORBIDDEN:**
```javascript
// ❌ NEVER DO THIS
db.companiesCollection.insertOne({ companyName: 'Test Company' });
```

**REASON:**
- Bypasses Mongoose schema validation
- Skips middleware hooks
- No Redis cache invalidation
- Creates orphaned/invalid data

---

## 🎯 Testing Companies

### For Development/Testing:

Use the **test lifecycle script** (creates temporary test companies):
```bash
node scripts/test-company-lifecycle.js
```

This script:
- ✅ Creates "Lifecycle Test Company" (clearly named as test data)
- ✅ Tests full CRUD operations
- ✅ Cleans up after itself
- ✅ Doesn't interfere with real companies

---

## 📋 Finding Company IDs

### Production Companies

**ALWAYS use the Data Center to find company IDs:**
- URL: `https://clientsvia-backend.onrender.com/admin-data-center.html`
- Shows real production companies with their correct IDs
- This is the authoritative source

### In Scripts

Query dynamically:
```javascript
const company = await Company.findOne({ companyName: 'Royal Plumbing' });
if (!company) {
    console.error('Company not found in this environment');
    process.exit(1);
}
console.log('Found company:', company._id.toString());
```

---

## 🔒 Enforcement

### Code Review Checklist

❌ **REJECT** any PR that:
- Creates companies via scripts (except test-company-lifecycle.js)
- Hardcodes company IDs
- Uses direct MongoDB inserts for companies

✅ **APPROVE** PRs that:
- Use the Admin UI for company creation
- Query companies dynamically
- Use the proper API endpoints

---

## 🧹 Cleanup Policy

If you discover:
- Old company creation scripts → **DELETE** them immediately
- Duplicate companies in production → **Contact admin to merge/delete**
- Hardcoded company IDs in scripts → **Refactor to dynamic queries**

---

## ⚠️ Why This Policy Exists

**Historical Problem:**
- A script (`create-royal-plumbing.js`) was run multiple times
- It created "Royal Plumbing" in both LOCAL and PRODUCTION databases
- This created TWO companies with DIFFERENT IDs:
  - Local: `68eeaf924e989145e9d46c12`
  - Production: `68e3f77a9d623b8058c700c4`
- Engineers got confused which ID was "real"
- Settings saved to the wrong company
- Hours wasted debugging

**NEVER AGAIN.** 🚨

---

## Summary

✅ **DO**: Use Admin UI (`/add-company.html`)  
✅ **DO**: Query companies dynamically  
✅ **DO**: Use Data Center to find IDs  

❌ **DON'T**: Create companies via scripts  
❌ **DON'T**: Hardcode company IDs  
❌ **DON'T**: Use direct MongoDB inserts  

---

**When in doubt, ask:**  
*"Would this create confusion if we had 100 companies?"*

If yes → Don't do it. ✋

