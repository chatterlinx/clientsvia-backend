# Trigger System Debugging - Final Checklist

## What We Know (100% Proven)

✅ **Penguin Air has 42 local triggers in the database**
```javascript
db.companyLocalTriggers.countDocuments({ 
  companyId: "68e3f77a9d623b8058c700c4",
  enabled: true,
  isDeleted: { $ne: true }
}) 
// Returns: 42
```

✅ **Sample trigger is correctly formatted**
```javascript
{
  companyId: '68e3f77a9d623b8058c700c4',
  ruleId: 'emergency.gas_smell',
  label: 'Gas smell or leak',
  enabled: true,
  isDeleted: false,
  keywords: [ 'gas leak', 'gas smell' ]
}
```

✅ **Code paths are correct**
- UI: Uses `CompanyLocalTrigger.findByCompanyId()` 
- Runtime: Uses `CompanyLocalTrigger.findActiveByCompanyId()`
- Both query collection: `companyLocalTriggers`

## Diagnostic Logs Added

All logs now include:
- `callSid` - Correlation ID for the call
- `companyId` - The company being serviced
- `toPhone` - Twilio DID that received the call
- `mongoHost` / `mongoDbName` - Database connection proof
- Actual counts and samples

###  Log Sequence to Check

When you make a test call, look for these 4 logs in order:

#### 1. MATCH_ENTRY
```javascript
[TriggerCardMatcher] 🔍 MATCH_ENTRY {
  callSid: "CA...",
  companyId: "68e3f77a9d623b8058c700c4",  ← MUST match Penguin
  toPhone: "+1...",
  inputText: "gas leak emergency..."
}
```

**If companyId ≠ Penguin** → Twilio number mapping is wrong

#### 2. CACHE_HIT or CACHE_MISS
```javascript
[TriggerService] 🔍 CACHE_HIT {
  companyId: "68e3f77a9d623b8058c700c4",
  cacheKey: "...",
  cachedTriggerCount: 5  ← If wrong, cache is stale
}
```

**If CACHE_HIT and count is wrong** → Cache needs clearing

#### 3. MERGE_START (only if cache miss)
```javascript
[TriggerService] 🔍 MERGE_START {
  callSid: "CA...",
  companyId: "68e3f77a9d623b8058c700c4",
  toPhone: "+1...",
  activeGroupId: "hvac" or null,
  mongoHost: "cluster0-shard-00-00.abc.mongodb.net",
  mongoDbName: "clientsvia",
  collectionName: "companyLocalTriggers"
}
```

**Check:**
- Is mongoHost the same as your shell connection?
- Is activeGroupId present? (null is OK, local will still load)

#### 4. LOCAL_LOADED
```javascript
[TriggerService] 🔍 LOCAL_LOADED {
  callSid: "CA...",
  companyId: "68e3f77a9d623b8058c700c4",
  toPhone: "+1...",
  localCount: 42,  ← MUST be 42 for Penguin!
  globalCount: 0,
  firstLocalRuleId: "emergency.gas_smell",
  queryMethod: "CompanyLocalTrigger.findActiveByCompanyId",
  queryFilters: { 
    companyId: "68e3f77a9d623b8058c700c4", 
    enabled: true, 
    isDeleted: { $ne: true } 
  }
}
```

**If localCount = 0** → 🚨 ASSERTION_FAILED will fire with diagnostics

#### 5. TRIGGERS_RECEIVED
```javascript
[TriggerCardMatcher] 🔍 TRIGGERS_RECEIVED {
  callSid: "CA...",
  companyId: "68e3f77a9d623b8058c700c4",
  toPhone: "+1...",
  triggerCount: 42,  ← Final count after all processing
  firstTriggerRuleId: "emergency.gas_smell"
}
```

**If triggerCount ≠ 42** → Something happened between LOCAL_LOADED and here

## Critical Assertion

If Penguin gets 0 local triggers, you'll see:

```javascript
[TriggerService] 🚨 ASSERTION_FAILED {
  callSid: "CA...",
  companyId: "68e3f77a9d623b8058c700c4",
  expected: 42,
  actual: 0,
  message: "Penguin Air should have 42 local triggers but query returned 0",
  mongoHost: "...",
  mongoDbName: "...",
  possibleCauses: [
    "1. Wrong companyId passed to this function",
    "2. Wrong MongoDB connection (different DB than UI)",
    "3. Field name mismatch (enabled vs isEnabled)",
    "4. Collection name mismatch"
  ]
}
```

This tells you EXACTLY which of the 4 problems it is.

## What Each Failure Means

### Scenario A: Wrong CompanyId
```
MATCH_ENTRY: companyId = "DIFFERENT_ID"  ← Not Penguin!
```

**Root Cause:** Twilio phone number → company mapping is broken

**Where to Fix:** 
- Find where incoming calls resolve companyId from `req.body.To`
- Check `twilioNumbers` collection or env var mapping
- Verify Penguin's phone number is correctly mapped

### Scenario B: Wrong Database
```
MERGE_START: mongoHost = "different-cluster.mongodb.net"
```

**Root Cause:** Runtime is connected to different MongoDB than UI/shell

**Where to Fix:**
- Check Render environment variables
- Verify `MONGODB_URI` is same across all services
- Check if there are multiple Render services with different configs

### Scenario C: Query Returns Empty
```
MATCH_ENTRY: companyId = "68e3f77a9d623b8058c700c4" ✅
MERGE_START: mongoHost matches ✅
LOCAL_LOADED: localCount = 0 ❌
```

**Root Cause:** Query is broken despite correct context

**Possible Causes:**
1. Collection name wrong (unlikely - we verified it)
2. Field name mismatch in query filter
3. Mongoose model definition problem
4. Index corruption

**Where to Fix:**
- Check `CompanyLocalTrigger.findActiveByCompanyId()` implementation
- Verify field names match what's in the database
- Try querying with native MongoDB driver to bypass Mongoose

### Scenario D: Cache Stale
```
CACHE_HIT: cachedTriggerCount = 5
(But database has 42)
```

**Root Cause:** Cache was populated before import, never invalidated

**Where to Fix:**
```javascript
// Clear cache for Penguin
TriggerService.invalidateCacheForCompany('68e3f77a9d623b8058c700c4');

// Or clear all
TriggerService.invalidateAllCache();
```

## Immediate Next Steps

1. **Push to Render** (git push)

2. **Make test call** to Penguin's number, say "gas leak emergency"

3. **Search Render logs** by callSid for these 5 log lines

4. **Paste the logs** showing:
   - MATCH_ENTRY
   - CACHE_HIT/MISS
   - MERGE_START (if cache miss)
   - LOCAL_LOADED
   - TRIGGERS_RECEIVED

5. **I'll tell you the exact fix** based on which log shows the problem

## Nuclear Options (If All Else Fails)

### Option 1: Bypass Cache for One Call
Add `?bypassCache=true` to force fresh DB query

### Option 2: Direct DB Query Test
In Render shell, run the exact same query runtime uses:
```javascript
db.companyLocalTriggers.find({
  companyId: "68e3f77a9d623b8058c700c4",
  enabled: true,
  isDeleted: { $ne: true }
}).count()
```

If this returns 0 but your earlier query returned 42, you're in a DIFFERENT DATABASE.

### Option 3: Add Bypass Mode
Temporarily hardcode the triggers for Penguin to prove the matching logic works:
```javascript
if (companyId === '68e3f77a9d623b8058c700c4') {
  logger.warn('HARDCODED BYPASS for Penguin debugging');
  return [/* paste one trigger here */];
}
```

If matching works with hardcoded trigger, problem is definitely in the loading, not matching.

## Expected Happy Path

```
[TriggerCardMatcher] 🔍 MATCH_ENTRY
  callSid: CA123
  companyId: 68e3f77a9d623b8058c700c4 ✅
  toPhone: +15551234567

[TriggerService] 🔍 CACHE_MISS
  companyId: 68e3f77a9d623b8058c700c4
  willQueryDatabase: true

[TriggerService] 🔍 MERGE_START
  callSid: CA123
  companyId: 68e3f77a9d623b8058c700c4 ✅
  activeGroupId: hvac ✅
  mongoHost: cluster0.abc.mongodb.net ✅
  mongoDbName: clientsvia ✅

[TriggerService] 🔍 LOCAL_LOADED
  callSid: CA123
  companyId: 68e3f77a9d623b8058c700c4 ✅
  localCount: 42 ✅✅✅
  globalCount: 0
  firstLocalRuleId: emergency.gas_smell

[TriggerCardMatcher] 🔍 TRIGGERS_RECEIVED
  callSid: CA123
  companyId: 68e3f77a9d623b8058c700c4 ✅
  triggerCount: 42 ✅✅✅
  firstTriggerRuleId: emergency.gas_smell
```

## We're Done Guessing

The logs will prove one of 4 things:
1. Wrong companyId → Fix Twilio mapping
2. Wrong database → Fix env vars
3. Query broken → Fix model/query
4. Cache stale → Clear cache

**Paste the logs and we'll know in 10 seconds.**
