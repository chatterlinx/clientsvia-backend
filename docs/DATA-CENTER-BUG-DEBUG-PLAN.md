# Data Center Display Bug - Debug Plan
**Created:** October 17, 2025  
**Status:** Active Investigation

## 🐛 The Bug
Data Center UI shows **2 total companies** but database has **21 companies**

## ✅ What We Know
- **Database Reality:** 21 companies (20 in `companiesCollection` + 1 in `companies`)
- **All are LIVE:** 0 deleted companies
- **Backend Logic:** Correct - merges both collections in `/api/admin/data-center/summary`
- **Frontend Code:** Correct - calls right endpoint and displays `s.total`

## 🔍 Diagnostic Scripts Created
1. **`scripts/diagnose-data-center-counts.js`** - Shows actual DB counts per collection
2. **`scripts/test-summary-endpoint.js`** - Tests backend logic locally (returns correct 21)
3. **`scripts/list-companies.js`** - Lists all non-deleted companies

## 🎯 Root Cause Possibilities
1. **Production Backend Cache** - Render backend returning old data
2. **Frontend Cache** - Browser caching old API response
3. **Production Environment Issue** - Collection mapping different in prod vs local

## 🛠️ Tomorrow's Debug Steps

### Step 1: Check Production API Response
```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  https://clientsvia-backend.onrender.com/api/admin/data-center/summary
```
**Expected:** `{ "total": 21, "live": 21, "deleted": 0, "neverLive": <number> }`  
**If Wrong:** Backend caching issue - check Redis or server restart needed

### Step 2: Check Render Backend Logs
Look for:
```
[SUMMARY] Using companies collection: companiesCollection
[SUMMARY] deletedMatch = ...
[SUMMARY] liveMatch = ...
```
Compare counts in logs vs. what's returned to frontend.

### Step 3: Check Frontend Network Tab
1. Open browser DevTools → Network tab
2. Reload Data Center page
3. Find `/api/admin/data-center/summary` request
4. Check Response body - does it show 21 or 2?

### Step 4: Hard Refresh Browser
- **Mac:** `Cmd + Shift + R`
- **Windows:** `Ctrl + Shift + F5`

### Step 5: If Still Broken - Check Collection Mapping
Run this in production (via script or Render shell):
```javascript
const db = mongoose.connection.db;
const collections = await db.listCollections().toArray();
const names = new Set(collections.map(c => c.name));
console.log('Has companiesCollection?', names.has('companiesCollection'));
console.log('Has companies?', names.has('companies'));
```

## 📝 Backend Code Reference
**File:** `routes/admin/dataCenter.js`  
**Function:** `buildCollectionsMap(names)` - Line 29  
**Endpoint:** `router.get('/summary', ...)` - Line 1051

**Logic:**
```javascript
const primary = db.collection(collectionsMap.companies); // 'companiesCollection'
const legacy = db.collection('companies'); // IF exists
// Merge: total = totalP + totalL
```

## 🧪 Local Test Results
```
✅ Local MongoDB: 21 companies
✅ Local Endpoint Logic: Returns 21
✅ Backend merge logic: Correct
```

## 🚨 Quick Fix (If Needed)
If production backend is correct but UI still shows 2:
1. Check `public/admin-data-center.html` line 796
2. Verify `s.total` is being set correctly
3. Check if there's a display formatter limiting to 2

## 📞 Contact Points
- **Frontend:** `public/admin-data-center.html` (line 788-803)
- **Backend:** `routes/admin/dataCenter.js` (line 1051-1163)
- **Database:** `companiesCollection` + `companies` collections

---

## 💡 Next Session Checklist
- [ ] Hard refresh browser
- [ ] Check production API response via curl
- [ ] Check Render logs for summary endpoint
- [ ] Verify Network tab shows correct response
- [ ] If all correct, restart Render service

