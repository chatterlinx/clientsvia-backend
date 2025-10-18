# 🧹 Admin Cleanup Center - Implementation Plan

## 📋 **OVERVIEW**

A world-class, enterprise-grade admin tool to manage company lifecycle, identify junk, and safely purge data with military-grade safeguards.

**Core Principle:** "Dumb-proof but pro-grade" - impossible to make mistakes, but powerful enough for production ops.

---

## 🎯 **GOALS**

1. **Find junk companies** - Test accounts, never-live companies, stale data
2. **Safe deletion** - Soft delete with grace period, hard delete with 5-lock system
3. **Data hygiene** - Keep database clean without risking production data
4. **Full auditability** - Every action logged with who/when/what/why
5. **Multi-tenant safety** - Impossible to delete live/active companies by accident

---

## 🏗️ **ARCHITECTURE PHASES**

### **Phase 1: Schema & Safety Rails** ✅ (STARTED)
- [x] Add soft-delete fields to v2Company schema
- [ ] Add query middleware to auto-exclude deleted companies
- [ ] Create AuditLog model for cleanup operations
- [ ] Add indexes for performance (isDeleted, autoPurgeAt, lastActivity)

### **Phase 2: Health Metrics System**
Build a scoring system to identify junk companies:

```javascript
CompanyHealth {
  score: 0-100,          // Overall health score
  isLive: boolean,       // Has phone number + scenarios + calls
  callCount: number,     // Total calls made
  scenarioCount: number, // Active scenarios
  lastActivity: Date,    // Last call/edit
  dataSize: {
    mongoDocs: number,   // Total documents
    redisCached: number, // Redis keys
    storageFiles: number // Uploaded files
  },
  readinessScore: 0-100, // From Variables tab
  flags: [               // Risk indicators
    'NO_PHONE',
    'NO_SCENARIOS', 
    'STALE_60D',
    'TEST_ACCOUNT',
    'DUPLICATE'
  ]
}
```

### **Phase 3: Backend API**

#### **Endpoints:**

```
GET    /api/admin/cleanup/companies
       - List all companies with health metrics
       - Filters: live, deleted, stale, test, duplicates
       - Search: name, domain, ID
       - Pagination: 50 per page

POST   /api/admin/cleanup/preview
       - Calculate purge impact
       - Returns: preview token (15min expiry)
       - Impact: mongo docs, redis keys, storage, external assets

PATCH  /api/admin/cleanup/soft-delete
       - Mark companies as deleted
       - Sets: isDeleted=true, deletedAt, autoPurgeAt (+30 days)
       - Blocks: LIVE companies (must be inactive first)

POST   /api/admin/cleanup/restore
       - Restore soft-deleted companies
       - Clears: isDeleted, deletedAt, autoPurgeAt

DELETE /api/admin/cleanup/purge
       - Execute hard delete (irreversible)
       - Requires: previewToken + idempotencyKey + 2FA + name confirmation
       - 5 Safety Locks (see below)
```

#### **5 Safety Locks for Hard Delete:**
1. **Not LIVE** - Company must be soft-deleted ≥ 24 hours
2. **Preview Token** - Must generate preview first (15min expiry)
3. **Name Confirmation** - Type exact company name
4. **2FA Re-auth** - Time-boxed token
5. **Idempotency Key** - Prevents double-submit

### **Phase 4: Frontend UI**

#### **Page Structure:**

**Navigation Integration:**
```
┌─────────────────────────────────────────────────────────────┐
│ Admin Dashboard                                    [Logout] │
├─────────────────────────────────────────────────────────────┤
│ [Directory] [+ Add Company] [🧹 Cleanup] [Trade Categories] │
│                                       [AI Monitoring] [More] │
└─────────────────────────────────────────────────────────────┘
```

**Cleanup Center Page:**
```
┌──────────────────────────────────────────────────────────────────────┐
│ 🧹 Cleanup Center                                                    │
├──────────────────────────────────────────────────────────────────────┤
│ [All Companies (20)] [🗑️ Trash (5)] [📊 Reports]                    │
├──────────────────────────────────────────────────────────────────────┤
│ 🔍 Universal Search - Find anything in any field                     │
│ ┌────────────────────────────────────────────────────────────┐       │
│ │ Search companies, emails, phones, IDs, scenarios...     🔎│       │
│ └────────────────────────────────────────────────────────────┘       │
│                                                                       │
│ Search in: [✓ Name] [✓ Email] [✓ Phone] [✓ ID] [✓ Scenarios]       │
│            [✓ Variables] [✓ Owner] [✓ Domain] [✓ Notes] [More...]   │
│                                                                       │
│ Smart Chips: Never Live • 0 Calls • Stale >60d • Test • Duplicates  │
│ Advanced Filters: [Date Range ▾] [Data Size ▾] [Trade ▾] [Status ▾] │
├──────────────────────────────────────────────────────────────────────┤
│ Companies Table (sortable, selectable) - 20 results                  │
│ ☑ [ ] Royal Plumbing  🟡 Stale  18/100  0 calls  68eeaf92...        │
│      📧 owner@royal.com  📞 +1-239-232-2030  💾 2.8MB                │
│      Matched: "plumbing" in companyName, scenarios (3)               │
│                                                                       │
│ ☑ [ ] ABC Plumbing    🟢 LIVE   92/100  1.2k calls  6882b82d...     │
│      📧 ops@abc.com  📞 +1-555-123-4567  💾 1.1GB                    │
│      Matched: "plumbing" in companyName, tradeCategories             │
├──────────────────────────────────────────────────────────────────────┤
│ Bulk Actions: [Soft Delete] [Preview Purge...] [Export CSV]         │
└──────────────────────────────────────────────────────────────────────┘
```

#### **Key Components:**
1. **CompaniesTable.js** - Main table with health badges
2. **PurgePreviewModal.js** - Impact summary + confirmations
3. **CompanyCleanupDrawer.js** - Per-company resource cleanup
4. **TrashTab.js** - Soft-deleted companies with restore
5. **ProgressDrawer.js** - Live progress for purge jobs

### **Phase 5: Purge Job System**

Hard delete is a **background job** (not synchronous):

```javascript
PurgeJob {
  id: 'job-123',
  companyIds: ['abc', 'xyz'],
  status: 'running',
  progress: {
    current: 450,
    total: 1000,
    percent: 45
  },
  steps: [
    { name: 'Release Twilio', status: 'completed' },
    { name: 'Delete Calls', status: 'running', progress: 450/1000 },
    { name: 'Delete Redis', status: 'pending' },
    { name: 'Delete Storage', status: 'pending' },
    { name: 'Delete Company', status: 'pending' }
  ],
  receipt: {
    mongoDeleted: 45000,
    redisDeleted: 38,
    storageDeleted: 412,
    externalReleased: ['twilio', 'webhooks']
  }
}
```

### **Phase 6: Auto-Purge Cron**

Daily job at 02:00 UTC:
- Find companies where `autoPurgeAt <= now`
- Execute purge with admin audit
- Send receipt email to ops

### **Phase 7: Audit Logging**

Every action creates an AuditLog entry:

```javascript
{
  type: 'company_soft_delete',
  companyId: '...',
  companyName: 'Royal Plumbing',
  userId: '...',
  userName: 'marc@...',
  ip: '192.168.1.1',
  userAgent: 'Chrome...',
  timestamp: Date,
  data: {
    reason: 'test account',
    notes: 'Created for testing only'
  }
}
```

---

## 🛡️ **SAFETY FEATURES**

### **Visual Safety:**
- 🟢 GREEN = Safe (soft delete, restore)
- 🟡 YELLOW = Attention (stale, has data)
- 🔴 RED = Danger (irreversible purge)

### **Blocking Banners:**
- "⚠️ 2 LIVE companies selected - cannot purge"
- "⚠️ Company has external assets (Twilio) - will be released"
- "⚠️ Large dataset (1.2 GB) - purge will take ~5 min"

### **Confirmation UI:**
```
Type company name to confirm:
[ Royal Plumbing               ] ✓ Exact match

Type PURGE to confirm:
[ PURGE                        ] ✓ Confirmed

2FA Code (sent to your email):
[ 123456                       ] ✓ Valid
```

---

## 🔍 **UNIVERSAL SEARCH - Find Anything Anywhere**

The search system is a **BEAST** - it can find data across ALL fields in the entire company document:

### **Search Capabilities:**

#### **1. Company Identity**
```javascript
Search: "Royal" or "68eeaf92" or "+1-239-232-2030"
Searches:
  - companyName / businessName
  - _id (Mongo ID)
  - domain / website
  - primaryPhone / phoneNumbers[]
  - email / ownerEmail
  - address (full address object)
```

#### **2. Deep Data Search**
```javascript
Search: "plumbing emergency"
Searches:
  - aiAgentLogic.scenarios[].triggers[]
  - aiAgentLogic.variables[].value
  - aiAgentLogic.placeholders[].value
  - agentSetup.companySpecialties
  - tradeCategories[]
  - connectionMessages.voice.text
  - connectionMessages.sms.text
```

#### **3. Metadata & Config**
```javascript
Search: "marc@" or "2025-10-14"
Searches:
  - createdBy / updatedBy / deletedBy
  - createdAt / updatedAt / deletedAt
  - twilioConfig.phoneNumbers[].number
  - twilioConfig.phoneNumbers[].friendlyName
  - accountStatus.reason / notes
```

#### **4. AI Agent Data**
```javascript
Search: "appointment" or "booking"
Searches:
  - aiAgentLogic.instantResponses[].category
  - aiAgentLogic.instantResponses[].quickReplies[]
  - aiAgentLogic.instantResponses[].fullReplies[]
  - agentSetup.protocols.* (all protocol fields)
```

### **Search Modes:**

#### **A. Quick Search (Default)**
- Single input box
- Searches ALL fields simultaneously
- Returns ranked results by relevance
- Shows where matches were found

#### **B. Field-Specific Search**
- Toggle checkboxes to limit scope
- Faster queries for targeted searches
- Example: "Search only in Scenarios"

#### **C. Advanced Query Builder**
```
Field: [companyName ▾]  Operator: [contains ▾]  Value: [Plumbing]
  AND
Field: [callCount ▾]     Operator: [equals ▾]    Value: [0]
  AND
Field: [createdAt ▾]     Operator: [before ▾]    Value: [2025-01-01]

[Add Rule] [Add Group]                    [Search]
```

### **Search Features:**

1. **Real-time suggestions** as you type (debounced 300ms)
2. **Search history** - recent searches saved
3. **Saved filters** - bookmark complex queries
4. **Regex support** - `/test|demo|sample/i`
5. **Fuzzy matching** - handles typos
6. **Wildcard support** - `*plumbing*`
7. **Boolean operators** - `"royal" AND "plumbing"`
8. **Field highlighting** - shows exact match location
9. **Export results** - CSV of search results

### **Example Search Queries:**

```
Query: "Royal"
Results: Companies with "Royal" in name, owner, or domain

Query: "68eeaf92"
Results: Company with matching Mongo ID

Query: "+1-239-232-2030"
Results: Company with this phone number (Twilio or primary)

Query: "marc@"
Results: All companies owned by marc@... (any domain)

Query: "plumbing emergency"
Results: Companies with "plumbing" AND "emergency" in any field
  - Ranked by relevance
  - Shows: "Found in tradeCategories, scenarios[5].triggers"

Query: "appointment OR booking"
Results: Companies with either word in scenarios/replies

Query: "/test|demo/i"
Results: Companies matching regex (case-insensitive)

Query: "stale>60"
Results: Companies with no activity in 60+ days

Query: "size>500mb"
Results: Companies with data size > 500MB

Query: "calls=0 AND phone!=null"
Results: Companies with phone but no calls (never live)
```

### **Search Performance:**

```javascript
// MongoDB indexes for fast search
indexes: [
  { companyName: 'text', businessName: 'text' },  // Full-text search
  { email: 1, ownerEmail: 1 },                    // Email lookup
  { 'twilioConfig.phoneNumbers.number': 1 },     // Phone lookup
  { isDeleted: 1, createdAt: -1 },                // Status + date
  { 'aiAgentLogic.tradeCategories': 1 }           // Trade category
]

// Search response time targets:
- Simple name search: < 50ms
- Full-text search: < 200ms
- Deep nested search: < 500ms
- Complex query builder: < 1000ms
```

## 📊 **FILTERS & SMART CHIPS**

### **Pre-built Filters (Smart Chips):**
- **Never Live** - `callCount === 0 && !twilioNumber`
- **0 Calls** - `callCount === 0`
- **Stale >60d** - `lastActivity < 60 days ago`
- **Readiness <30** - `readinessScore < 30`
- **Test Accounts** - `name matches /test|demo|sample/i`
- **Duplicates** - Same normalized name/domain
- **Has Notes** - `deleteNotes || accountStatus.notes`
- **External Assets** - `twilioConfig.phoneNumbers.length > 0`
- **Large Data** - `dataSize > 500MB`

### **Advanced Filters:**
- Owner email (autocomplete from DB)
- Created date range (calendar picker)
- Data size (slider: 0 - 10GB)
- Trade category (multi-select)
- Account status (active, call_forward, suspended)
- Voice settings (configured, not configured)
- Readiness score (slider: 0 - 100)
- Last activity (relative: 7d, 30d, 60d, 90d)

---

## 🧪 **TESTING PLAN**

### **Test Cases:**
1. ✅ Soft delete test company → verify isDeleted=true
2. ✅ Restore soft-deleted → verify isDeleted=false
3. ✅ Try to soft-delete LIVE company → expect error
4. ✅ Generate preview → verify impact counts
5. ✅ Try purge without preview → expect error
6. ✅ Try purge without name confirm → expect error
7. ✅ Try purge without 2FA → expect error
8. ✅ Execute valid purge → verify all data removed
9. ✅ Verify audit logs created
10. ✅ Test auto-purge cron

### **Use Royal Plumbing for testing:**
- Already has legacy data issues (perfect test case)
- Can safely delete/restore multiple times
- No production impact

---

## 📦 **DELIVERABLES**

### **Backend:**
- [ ] `models/AuditLog.js` - New model
- [ ] `routes/admin/cleanup.js` - All cleanup endpoints
- [ ] `services/CompanyHealthService.js` - Health scoring
- [ ] `services/PurgeService.js` - Execute purge jobs
- [ ] `jobs/auto-purge-cron.js` - Daily cleanup
- [ ] Query middleware in `models/v2Company.js`

### **Frontend:**
- [ ] `public/admin-cleanup.html` - Main page
- [ ] `public/js/admin-cleanup/CompaniesTable.js`
- [ ] `public/js/admin-cleanup/PurgePreviewModal.js`
- [ ] `public/js/admin-cleanup/CompanyCleanupDrawer.js`
- [ ] `public/js/admin-cleanup/TrashTab.js`
- [ ] `public/css/admin-cleanup.css`

### **Scripts:**
- [ ] `scripts/test-cleanup-flow.js` - Integration test
- [ ] `scripts/manual-purge.js` - Emergency cleanup tool

---

## 🚀 **ROLLOUT PLAN**

### **Phase 1: Schema + Middleware** (Week 1)
- Add soft-delete fields ✅ (DONE)
- Add query middleware
- Test on dev DB

### **Phase 2: Backend API** (Week 2)
- Build all endpoints
- Add health metrics
- Test with Postman

### **Phase 3: Frontend UI** (Week 3)
- Build main page
- Build modals
- Test full flow

### **Phase 4: Jobs + Cron** (Week 4)
- Build purge jobs
- Add auto-purge cron
- Test automation

### **Phase 5: Production Deploy** (Week 5)
- Deploy to Render
- Test with Royal Plumbing
- Clean up test companies
- Monitor audit logs

---

## ❓ **OPEN QUESTIONS FOR USER**

1. **Grace Period:** 30 days for auto-purge? (Configurable?)
2. **2FA:** Use email codes or TOTP authenticator?
3. **Notifications:** Email ops team on purge completion?
4. **Batch Size:** How many companies can be purged at once? (Suggest: 10 max)
5. **Data Retention:** Keep audit logs forever or expire after N days?
6. **Duplicate Detection:** Auto-merge or manual selection?
7. **A la carte cleanup:** Do we need per-resource cleanup (calls, memories, etc)?
8. **CSV Export:** Export company list before purge?
9. **Receipts:** Send email receipt after purge?
10. **Rate Limiting:** Throttle purge jobs to avoid DB overload?

---

## 💰 **ESTIMATED EFFORT**

- **Schema + Middleware:** 4 hours
- **Backend API:** 16 hours
- **Frontend UI:** 20 hours
- **Jobs + Cron:** 8 hours
- **Testing:** 8 hours
- **Documentation:** 4 hours

**Total:** ~60 hours (~1.5 weeks full-time)

---

## 🎯 **SUCCESS CRITERIA**

✅ Can safely identify junk companies
✅ Can soft-delete companies with 1 click
✅ Can restore soft-deleted companies
✅ Cannot hard-delete live companies
✅ Purge requires 5 confirmations
✅ All actions are audited
✅ Auto-purge works reliably
✅ UI is intuitive and mistake-proof
✅ Test company cleanup successful
✅ Database cleaned without data loss

---

## 📝 **NEXT STEPS**

**USER TO CONFIRM:**
1. Approve overall architecture
2. Answer open questions
3. Prioritize phases (do we need all features now?)
4. Decide: Build incrementally or full build?

**IF APPROVED:**
1. Complete Phase 1 (schema + middleware)
2. Build health metrics service
3. Build list API endpoint
4. Build basic UI to test flow
5. Iterate based on feedback


