# Spam Filter System - Complete Architecture

**Last Updated**: October 20, 2025  
**Status**: Production-Ready  
**Schema Version**: 2.0 (New Schema)

---

## 📊 Visual Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         🛡️ SPAM FILTER SYSTEM                              │
│                         3-Layer Architecture                                │
└────────────────────────────────────────────────────────────────────────────┘

    ┌─────────────────────────────────────────────────────────────────┐
    │  LAYER 1: FRONTEND (Browser)                                    │
    │  📁 public/js/ai-agent-settings/SpamFilterManager.js            │
    └─────────────────────────────────────────────────────────────────┘
                                    │
                                    │  HTTP GET/PUT
                                    │  JSON: { checkGlobalSpamDB, 
                                    │          enableFrequencyCheck,
                                    │          enableRobocallDetection }
                                    ↓
    ┌─────────────────────────────────────────────────────────────────┐
    │  LAYER 2: BACKEND API (Express.js)                              │
    │  📁 routes/admin/callFiltering.js                               │
    │                                                                  │
    │  GET  /api/admin/call-filtering/:companyId/settings             │
    │       → Fetches settings from MongoDB                           │
    │       → Migrates OLD schema → NEW schema (if needed)            │
    │       → Returns NEW schema ONLY to frontend                     │
    │                                                                  │
    │  PUT  /api/admin/call-filtering/:companyId/settings             │
    │       → Receives NEW schema from frontend                       │
    │       → REPLACES entire settings object (purges old keys)       │
    │       → Saves to MongoDB                                        │
    │       → Clears Redis cache                                      │
    └─────────────────────────────────────────────────────────────────┘
                                    │
                                    │  Mongoose ODM
                                    │  
                                    ↓
    ┌─────────────────────────────────────────────────────────────────┐
    │  LAYER 3: DATA LAYER                                            │
    │                                                                  │
    │  ┌──────────────────────────────────────────────────────────┐  │
    │  │  📁 models/v2Company.js - Mongoose Schema                 │  │
    │  │                                                            │  │
    │  │  callFiltering: {                                         │  │
    │  │      enabled: Boolean,                                    │  │
    │  │      blacklist: [{ phoneNumber, reason, ... }],           │  │
    │  │      whitelist: [{ phoneNumber, reason, ... }],           │  │
    │  │      settings: {                                          │  │
    │  │          // ✅ NEW SCHEMA (Active)                        │  │
    │  │          checkGlobalSpamDB: Boolean,                      │  │
    │  │          enableFrequencyCheck: Boolean,                   │  │
    │  │          enableRobocallDetection: Boolean,                │  │
    │  │                                                            │  │
    │  │          // 🔧 OLD SCHEMA (Deprecated)                    │  │
    │  │          blockKnownSpam: Boolean,  // → checkGlobalSpamDB │  │
    │  │          blockHighFrequency: Boolean,  // → enableFrequencyCheck │  │
    │  │          blockRobocalls: Boolean  // → enableRobocallDetection  │  │
    │  │      }                                                     │  │
    │  │  }                                                         │  │
    │  └──────────────────────────────────────────────────────────┘  │
    │                                                                  │
    │  ┌──────────────────────────────────────────────────────────┐  │
    │  │  💾 MongoDB Atlas (via Mongoose ODM)                     │  │
    │  │  Collection: companiesCollection                          │  │
    │  │  Document: { _id, companyName, callFiltering, ... }       │  │
    │  │  Purpose: Persistent storage with schema validation       │  │
    │  └──────────────────────────────────────────────────────────┘  │
    │                                                                  │
    │  ┌──────────────────────────────────────────────────────────┐  │
    │  │  ⚡ Redis Cache (In-Memory)                              │  │
    │  │  Key: company:{companyId}                                 │  │
    │  │  TTL: 3600s (1 hour)                                      │  │
    │  │  Purpose: Sub-50ms performance for reads                  │  │
    │  │  Note: Cleared after every save operation                 │  │
    │  └──────────────────────────────────────────────────────────┘  │
    │                                                                  │
    │  🎯 DUAL-LAYER ARCHITECTURE: Mongoose + Redis                   │
    │     - Mongoose: Schema enforcement, persistence, validation     │
    │     - Redis: Speed layer for frequently accessed data           │
    │     - Target: Sub-50ms response times for all reads             │
    └─────────────────────────────────────────────────────────────────┘
```

---

## 🎯 Mongoose + Redis Dual-Layer Architecture

**Why Both?**

```
┌─────────────────────────────────────────────────────────────────┐
│  MONGOOSE (Persistent Layer)                                    │
│  ✅ Schema validation & enforcement                             │
│  ✅ Data integrity & relationships                              │
│  ✅ Query optimization & indexing                               │
│  ✅ Middleware hooks (pre-save, post-save)                      │
│  ⚠️  Slower: ~100-200ms per query                               │
└─────────────────────────────────────────────────────────────────┘
                                +
┌─────────────────────────────────────────────────────────────────┐
│  REDIS (Speed Layer)                                             │
│  ⚡ In-memory key-value store                                   │
│  ⚡ Lightning fast: <5ms reads                                  │
│  ⚡ Caches frequently accessed companies                        │
│  ⚠️  Must invalidate on save (cleared after updates)            │
└─────────────────────────────────────────────────────────────────┘
                                ‖
                    🎯 TARGET: SUB-50MS READS
```

### **How It Works Together**

**READ Flow (Cache Hit):**
```
User Request → Redis Check → ✅ Found → Return (5ms) ⚡
```

**READ Flow (Cache Miss):**
```
User Request → Redis Check → ❌ Not Found
             → Mongoose Query → MongoDB (100ms)
             → Store in Redis (TTL: 1 hour)
             → Return to user
```

**WRITE Flow (Settings Save):**
```
User Saves Settings → Mongoose Validation
                   → MongoDB Update (100ms)
                   → ✅ Success
                   → Clear Redis Cache (key: company:{id})
                   → Next read will fetch fresh data
```

### **Why Clear Redis After Save?**

**Problem without cache invalidation:**
```
1. User saves settings → MongoDB updated ✅
2. Redis still has OLD data ❌
3. Next read returns OLD data from Redis ❌
4. User sees stale settings 😞
```

**Solution with cache invalidation:**
```
1. User saves settings → MongoDB updated ✅
2. Redis cache cleared ✅
3. Next read misses cache → Fetches from MongoDB ✅
4. Fresh data stored in Redis ✅
5. Subsequent reads are fast again ⚡
```

### **Code Implementation**

**Backend clears cache after save:**
```javascript
// routes/admin/callFiltering.js (line 651-657)
await company.save();  // Save to MongoDB via Mongoose

// Clear Redis cache
const { redisClient } = require('../../clients');
await redisClient.del(`company:${companyId}`);
console.log(`✅ Redis cache cleared for company: ${companyId}`);
```

**Cache key format:**
```
company:{companyId}
Example: company:68e3f77a9d623b8058c700c4
```

---

## 🔄 Data Flow Diagram

### **LOAD Settings (GET)**

```
1. USER clicks "Spam Filter" tab
         ↓
2. Frontend: GET /api/admin/call-filtering/{companyId}/settings
         ↓
3. Backend: Find company in MongoDB
         ↓
4. Backend: Check schema version
         ├─→ NEW SCHEMA? → Return as-is
         └─→ OLD SCHEMA? → Migrate: blockKnownSpam → checkGlobalSpamDB
         ↓
5. Frontend: Receives { checkGlobalSpamDB, enableFrequencyCheck, enableRobocallDetection }
         ↓
6. Frontend: Renders 3 checkboxes with current values
```

### **SAVE Settings (PUT)**

```
1. USER toggles checkbox → Clicks "Save Settings"
         ↓
2. Frontend: Reads checkbox states
         ↓
3. Frontend: PUT /api/admin/call-filtering/{companyId}/settings
         Body: { settings: { checkGlobalSpamDB: true, ... } }
         ↓
4. Backend: REPLACES entire settings object
         company.callFiltering.settings = {
             checkGlobalSpamDB: settings.checkGlobalSpamDB === true,
             enableFrequencyCheck: settings.enableFrequencyCheck === true,
             enableRobocallDetection: settings.enableRobocallDetection === true
         };
         ↓
5. Backend: Saves to MongoDB
         ↓
6. Backend: Clears Redis cache (key: company:{companyId})
         ↓
7. Frontend: Shows success toast notification ✅
```

---

## 📋 Schema Migration Timeline

### **Phase 1: Pre-October 2025 (OLD SCHEMA)**
```javascript
settings: {
    blockKnownSpam: true,
    blockHighFrequency: true,
    blockRobocalls: true
}
```

### **Phase 2: October 2025 (MIGRATION PHASE)**
Both schemas coexist in database:
```javascript
settings: {
    // NEW SCHEMA
    checkGlobalSpamDB: true,
    enableFrequencyCheck: true,
    enableRobocallDetection: true,
    
    // OLD SCHEMA (still in some companies)
    blockKnownSpam: true,        // Will be purged on next save
    blockHighFrequency: true,
    blockRobocalls: true
}
```

Backend migration layer handles both automatically.

### **Phase 3: Q2 2026 (TARGET: NEW SCHEMA ONLY)**
Old keys removed from schema:
```javascript
settings: {
    checkGlobalSpamDB: true,
    enableFrequencyCheck: true,
    enableRobocallDetection: true
}
```

Migration logic can be deleted at this point.

---

## 🔍 Key Technical Decisions

### **1. Why REPLACE Instead of MERGE?**

**Problem with MERGE:**
```javascript
// ❌ BAD: Keeps old keys forever
company.callFiltering.settings = {
    ...company.callFiltering.settings,  // OLD keys preserved
    ...newSettings                      // NEW keys added
};
// Result: Old + New keys coexist = confusion
```

**Solution with REPLACE:**
```javascript
// ✅ GOOD: Purges old keys on save
company.callFiltering.settings = {
    checkGlobalSpamDB: settings.checkGlobalSpamDB === true,
    enableFrequencyCheck: settings.enableFrequencyCheck === true,
    enableRobocallDetection: settings.enableRobocallDetection === true
};
// Result: ONLY new keys saved
```

### **2. Why Explicit Boolean Cast `=== true`?**

**Problem without cast:**
```javascript
settings: {
    checkGlobalSpamDB: undefined,  // Unchecked checkbox → undefined
    enableFrequencyCheck: true,
    enableRobocallDetection: undefined
}
```
Mongoose saves `undefined`, causing issues on reload.

**Solution with cast:**
```javascript
settings: {
    checkGlobalSpamDB: false,  // undefined → false
    enableFrequencyCheck: true,
    enableRobocallDetection: false
}
```
Always explicit `true` or `false`, never `undefined`.

### **3. Why Clear Redis Cache After Save?**

Redis caches company documents for sub-50ms performance. After settings save:
1. MongoDB has NEW data
2. Redis has OLD data (stale)
3. Next read would return OLD data from cache

Solution: Clear Redis key after save → Next read fetches fresh data from MongoDB.

---

## 🧪 Verification & Testing

### **Automated Verification**
```bash
node scripts/verify-spam-filter-schema.js
```

**Checks:**
- ✅ Mongoose model has all new keys
- ✅ Backend GET returns new keys
- ✅ Backend PUT saves new keys
- ✅ Frontend sends/receives new keys

### **Manual Testing**
1. Navigate to: `/company-profile.html?id={companyId}`
2. Go to "Spam Filter" tab
3. Toggle any checkbox
4. Click "Save Settings"
5. **Refresh page** (F5)
6. **Verify**: Checkbox state persists ✅

---

## 📂 File Map

| File | Purpose | Lines of Interest |
|------|---------|-------------------|
| `models/v2Company.js` | Mongoose schema | 1707-1777 |
| `routes/admin/callFiltering.js` | GET endpoint (migration) | 452-559 |
| `routes/admin/callFiltering.js` | PUT endpoint (save) | 561-678 |
| `public/js/ai-agent-settings/SpamFilterManager.js` | Frontend UI | 1-722 |
| `scripts/verify-spam-filter-schema.js` | Verification tool | All |
| `docs/SPAM-FILTER-FIX-COMPLETE-REPORT.md` | Bug fix documentation | All |
| `docs/COMPANY-CREATION-POLICY.md` | Company ID policy | All |

---

## ⚠️ Common Pitfalls

### **Pitfall 1: Hardcoding Company IDs**
```javascript
// ❌ WRONG
const companyId = '68eeaf924e989145e9d46c12';

// ✅ RIGHT
const company = await Company.findOne({ companyName: 'Royal Plumbing' });
const companyId = company._id.toString();
```

### **Pitfall 2: Using Old Schema Keys**
```javascript
// ❌ WRONG (deprecated)
if (settings.blockKnownSpam) { ... }

// ✅ RIGHT (new schema)
if (settings.checkGlobalSpamDB) { ... }
```

### **Pitfall 3: Merging Settings**
```javascript
// ❌ WRONG (keeps old keys)
company.callFiltering.settings = { ...oldSettings, ...newSettings };

// ✅ RIGHT (replaces completely)
company.callFiltering.settings = { checkGlobalSpamDB: ... };
```

---

## 🚀 Future Enhancements

### **Adding a New Setting**

**Step-by-step:**

1. **Update Mongoose Schema** (`models/v2Company.js`)
   ```javascript
   settings: {
       checkGlobalSpamDB: { type: Boolean, default: false },
       enableFrequencyCheck: { type: Boolean, default: false },
       enableRobocallDetection: { type: Boolean, default: false },
       blockInternationalCalls: { type: Boolean, default: false }, // NEW
   }
   ```

2. **Update Backend GET Migration** (`routes/admin/callFiltering.js:507-517`)
   ```javascript
   const migratedSettings = hasNewSchema ? {
       checkGlobalSpamDB: oldSettings.checkGlobalSpamDB,
       enableFrequencyCheck: oldSettings.enableFrequencyCheck,
       enableRobocallDetection: oldSettings.enableRobocallDetection,
       blockInternationalCalls: oldSettings.blockInternationalCalls  // NEW
   } : { ... };
   ```

3. **Update Backend PUT Save** (`routes/admin/callFiltering.js:638-644`)
   ```javascript
   company.callFiltering.settings = {
       checkGlobalSpamDB: settings.checkGlobalSpamDB === true,
       enableFrequencyCheck: settings.enableFrequencyCheck === true,
       enableRobocallDetection: settings.enableRobocallDetection === true,
       blockInternationalCalls: settings.blockInternationalCalls === true  // NEW
   };
   ```

4. **Update Frontend Rendering** (`public/js/ai-agent-settings/SpamFilterManager.js`)
   - Add checkbox in `render()` method
   - Add to `saveSettings()` method

5. **Verify**
   ```bash
   node scripts/verify-spam-filter-schema.js
   ```

---

## 📞 Support & Troubleshooting

**Settings not persisting?**
1. Check Render logs for migration messages
2. Verify company ID is correct (use Data Center)
3. Run: `node scripts/verify-spam-filter-schema.js`

**Getting undefined values?**
1. Check backend uses `=== true` cast
2. Check frontend sends explicit boolean values
3. Check Mongoose schema has the key defined

**Old schema keys still appearing?**
1. Re-save settings (triggers purge)
2. Check migration logic in GET endpoint
3. Verify REPLACE logic in PUT endpoint

---

**Documentation**: Complete ✅  
**Status**: Production-Ready  
**Last Reviewed**: October 20, 2025

