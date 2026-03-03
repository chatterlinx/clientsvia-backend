# Trigger Loading Diagnostics

## Problem Summary

Based on the call report for `CAcb8cb3c0864c003a3c4b4fabb0309dc0`:

- **Symptom:** Caller says "I smell gas in my home" but agent responds with "Sorry — you cut out"
- **Root Cause:** `TRIGGER_POOL_EMPTY` - Zero triggers loaded at runtime
- **ScrabEngine Status:** ✅ Working perfectly - expanded tokens to include `emergency`, `gas smell`, `safety`, `evacuate`
- **Trigger Matching Status:** ❌ No triggers available to match against

## The Gap

**UI Shows:** 42 Local triggers, 42 Published, 42 Active
**Runtime Has:** 0 triggers loaded

This indicates a disconnect between configuration (UI) and runtime loading (database queries).

## How Trigger Loading Works

### Entry Point Chain

1. **Call Turn** → `CallRuntime.processTurn()`
2. → `Agent2DiscoveryRunner.run()`
3. → `TriggerCardMatcher.getCompiledTriggers(companyId)`
4. → `TriggerService.loadTriggersWithLegacyFallback(companyId)`
5. → `TriggerService.loadTriggersForCompany(companyId)`
6. → `TriggerService.mergeTriggers(companyId, settings, groupInfo)`

### Database Queries

**Global Triggers:**
```javascript
GlobalTrigger.find({
  groupId: settings.activeGroupId.toLowerCase(),
  state: 'published',        // ONLY published triggers
  enabled: true,
  isDeleted: { $ne: true }
})
```

**Local Triggers:**
```javascript
CompanyLocalTrigger.find({
  companyId: companyId,
  enabled: true,
  isDeleted: { $ne: true }
})
```

### Cache Layer

- **TTL:** 60 seconds
- **Key Format:** `triggers:${companyId}:${activeGroupId}:v${groupVersion}`
- **Invalidation:** Manual via "Refresh Cache" button or auto after 60s

## Common Failure Modes

1. **No Global Group Assigned**
   - `CompanyTriggerSettings.activeGroupId` is null/missing
   - Result: Only local triggers load (if any exist)

2. **Group Not Published**
   - `GlobalTriggerGroup.publishedVersion === 0`
   - Result: Global triggers skipped even if group is assigned

3. **Triggers in Draft State**
   - Triggers exist but `state !== 'published'`
   - Result: Filtered out by query

4. **Triggers Disabled**
   - Triggers exist but `enabled === false`
   - Result: Filtered out by query

5. **Stale Cache**
   - Cache shows old data, but database has been updated
   - Result: Old triggers served for up to 60 seconds

6. **Wrong CompanyId**
   - Mismatch between call routing and database companyId
   - Result: Wrong or no triggers loaded

## Diagnostic Tools Created

### 1. API Endpoint

**URL:** `GET /api/agent-console/:companyId/triggers/diagnostics`

Returns comprehensive JSON with:
- Company lookup status
- CompanyTriggerSettings analysis
- Global group status (published version, etc.)
- Actual database query results (same queries as runtime)
- Local trigger counts (active vs disabled vs deleted)
- Problem identification and fixes

**Example:**
```bash
curl https://cv-backend-va.onrender.com/api/agent-console/68e3f77a9d623b8058c700c4/triggers/diagnostics \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 2. Web UI

**URL:** `https://cv-backend-va.onrender.com/trigger-diagnostics.html`

Beautiful visual interface that:
- Shows each loading step with success/fail status
- Displays trigger counts and samples
- Highlights problems with specific fixes
- Color-coded for easy scanning (green=ok, red=error, yellow=skipped)

### 3. Command-Line Script

**File:** `scripts/debug-trigger-loading.js`

**Usage:**
```bash
MONGODB_URI="your-mongo-uri" node scripts/debug-trigger-loading.js 68e3f77a9d623b8058c700c4
```

Provides detailed terminal output with all diagnostic steps.

## How to Debug Your Issue

### Step 1: Open the Web Diagnostic Tool

1. Navigate to: `https://cv-backend-va.onrender.com/trigger-diagnostics.html`
2. Enter Company ID: `68e3f77a9d623b8058c700c4`
3. Click "Run Diagnostics"

### Step 2: Review Results

Look for:
- ❌ Red badges = Problems
- ⚠️ Yellow badges = Warnings
- ✅ Green badges = Working

### Step 3: Follow Fixes

The tool will tell you exactly what's wrong:
- "No global trigger group assigned" → Assign a group
- "Group is NOT published" → Publish the group
- "Local triggers disabled" → Re-enable them

### Step 4: Clear Cache

After making fixes:
1. Click "Refresh Cache" in Agent Console
2. OR wait 60 seconds for auto-refresh
3. Make a test call to verify

## Logs to Monitor

When a call comes in, these logs appear in sequence:

```
[TriggerService] 🔍 CACHE_MISS - Will query database
[TriggerService] 🔍 LOCAL_LOADED - Shows what was loaded from DB
[TriggerService] 🔍 LOAD_COMPLETE - Final counts
[TriggerService] 🚨 TRIGGER_POOL_EMPTY - ERROR if 0 triggers
```

In production logs (Render), search for:
- `TRIGGER_POOL_EMPTY`
- `LOCAL_LOADED`
- Company ID: `68e3f77a9d623b8058c700c4`

## Next Steps

1. **Run diagnostics** via web UI (easiest) or API
2. **Identify the specific failure mode** from the report
3. **Apply the fix** suggested in the diagnostics
4. **Clear cache** and test with a new call
5. **Verify in logs** that triggers are now loading

## Files Modified

### New Files
- `/scripts/debug-trigger-loading.js` - CLI diagnostic script
- `/public/trigger-diagnostics.html` - Web UI for diagnostics
- `/TRIGGER_LOADING_DEBUG.md` - This documentation

### Modified Files
- `/routes/agentConsole/agentConsole.js` - Added `GET /:companyId/triggers/diagnostics` endpoint

## Architecture Notes

The trigger loading system has extensive defensive logging:
- Every step is traced
- Failures are categorized (no group, not published, disabled, etc.)
- Diagnostic events are emitted to the call console
- Performance metrics are tracked (cache hits, query times)

The issue is almost certainly one of:
1. Configuration mismatch (UI vs runtime)
2. Data inconsistency (wrong collection, wrong field)
3. Query filter mismatch (enabled flag, isDeleted flag)
4. Group publishing state

The diagnostic tools will pinpoint which one.
