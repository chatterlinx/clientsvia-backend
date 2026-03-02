# Diagnostic Logging Guide - Local Triggers Not Loading Issue

## What We Know (Proven Facts)

✅ **Database has 42 local triggers for Penguin Air**
- CompanyId: `68e3f77a9d623b8058c700c4`
- Collection: `companyLocalTriggers`
- All 42 have `enabled: true` and `isDeleted: false`
- Sample verified: Gas smell trigger exists with correct keywords

✅ **Code paths verified**
- UI uses: `CompanyLocalTrigger.findByCompanyId()` (all triggers)
- Runtime uses: `CompanyLocalTrigger.findActiveByCompanyId()` (enabled only)
- Both query the same collection

❌ **Runtime claims it can't see the triggers**

## The 4 Remaining Possibilities

### 1. Wrong CompanyId at Runtime
The call is executing under a different companyId than expected.

**Diagnostic logs to check:**
```
[TriggerCardMatcher] 🔍 MATCH ENTRY
  companyId: ?????
```

**If NOT `68e3f77a9d623b8058c700c4`** → This is the bug.

**Causes:**
- Twilio phone number mapping wrong
- Default companyId being used
- Cached mapping stale
- Wrong env var

### 2. Wrong Database Connection
Runtime is connected to a different MongoDB instance than the UI/shell.

**Diagnostic logs to check:**
```
[TriggerService] 🔍 MERGE START
  mongoDbName: ?????
```

**Causes:**
- Different env vars in different services
- Staging vs production mix-up
- Old connection string cached

### 3. Query Returns Empty Despite Correct Context
The query runs with correct companyId but returns 0 results.

**Diagnostic logs to check:**
```
[TriggerService] 🔍 LOCAL TRIGGERS LOADED
  companyId: 68e3f77a9d623b8058c700c4
  localCount: 0  ← SHOULD BE 42!
```

**If localCount is 0** → CRITICAL ASSERTION will fire.

**Causes:**
- Collection name mismatch
- Field name mismatch (enabled vs isEnabled)
- Index issue
- Replication lag

### 4. Cache Serving Stale Data
Correct query runs, returns 42, but cache overrides with old snapshot.

**Diagnostic logs to check:**
```
[TriggerService] Triggers loaded
  fromCache: true
  triggerCount: 5  ← Stale!
```

**Causes:**
- Cache key includes wrong activeGroupId
- Cache never invalidated after import
- Multi-server cache not synced

## What to Do Right Now

### Step 1: Trigger a Test Call
Make a test call to Penguin Air's number and say "gas leak emergency"

### Step 2: Check Render Logs
Look for these exact log lines (in order):

```
1. [TriggerCardMatcher] 🔍 MATCH ENTRY
   → Check: Is companyId = 68e3f77a9d623b8058c700c4?

2. [TriggerService] 🔍 MERGE START
   → Check: Is mongoDbName correct?

3. [TriggerService] 🔍 LOCAL TRIGGERS LOADED
   → Check: Is localCount = 42?

4. [TriggerCardMatcher] 🔍 TRIGGERS RECEIVED
   → Check: Is triggerCount = 42?
```

### Step 3: Identify the Failure Point

**If MATCH ENTRY shows wrong companyId:**
- Bug is in Twilio number → companyId mapping
- Check: How does the call lookup which company owns the number?

**If MERGE START shows wrong database:**
- Bug is in environment variables or connection pooling
- Check: Are there multiple Render services with different env vars?

**If LOCAL TRIGGERS LOADED shows localCount = 0:**
- 🚨 CRITICAL ASSERTION will fire
- This means query failed despite correct context
- Check: Is the Mongoose model definition correct?

**If TRIGGERS RECEIVED shows wrong count:**
- Bug is in cache layer
- Solution: Clear cache and retry

## Quick Fixes by Scenario

### If CompanyId is Wrong
```javascript
// Find where companyId is resolved from toPhone
// Add logging there to see what it returns
logger.info('[CallRouter] Resolved company', {
  toPhone: req.body.To,
  companyId: resolved,
  source: 'twilioNumberMapping'
});
```

### If Database is Wrong
```javascript
// Check env vars on Render dashboard
echo $MONGODB_URI

// Compare to what shell used
// They should be identical
```

### If Query Returns Empty
```javascript
// Run this in Render shell to prove DB is same:
db.companyLocalTriggers.findOne({ companyId: "68e3f77a9d623b8058c700c4" })

// If this returns null but your earlier query returned data,
// you're in a different database
```

### If Cache is Stale
```javascript
// Force cache clear
await TriggerService.invalidateCacheForCompany('68e3f77a9d623b8058c700c4');

// Or clear all
await TriggerService.invalidateAllCache();
```

## Expected vs Actual

### What SHOULD Happen (Happy Path)
```
[TriggerCardMatcher] 🔍 MATCH ENTRY
  companyId: 68e3f77a9d623b8058c700c4 ✅

[TriggerService] 🔍 MERGE START
  companyId: 68e3f77a9d623b8058c700c4 ✅
  activeGroupId: hvac ✅
  mongoDbName: clientsvia ✅

[TriggerService] 🔍 LOCAL TRIGGERS LOADED
  companyId: 68e3f77a9d623b8058c700c4 ✅
  localCount: 42 ✅
  globalCount: 0 ✅
  firstLocalRuleId: emergency.gas_smell ✅

[TriggerCardMatcher] 🔍 TRIGGERS RECEIVED
  companyId: 68e3f77a9d623b8058c700c4 ✅
  triggerCount: 42 ✅
  firstTriggerRuleId: emergency.gas_smell ✅
```

### What We're Probably Seeing (Broken)
```
[TriggerCardMatcher] 🔍 MATCH ENTRY
  companyId: ????????????????????? ❌
  (Different from expected)

OR

[TriggerService] 🔍 LOCAL TRIGGERS LOADED
  companyId: 68e3f77a9d623b8058c700c4 ✅
  localCount: 0 ❌
  (Should be 42!)
```

## Next Steps After Logs

Once you see the logs, paste them here and I'll tell you exactly:
1. Which of the 4 scenarios it is
2. Which file to fix
3. Which line to change
4. What the fix should be

No more guessing. The logs will prove it.
