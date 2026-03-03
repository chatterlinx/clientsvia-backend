# Trigger Default Fallback Issue - SOLVED

## Problem Identified

Your agent is **defaulting to fallback** because triggers have the wrong `state` field value.

### Root Cause

```javascript
// CompanyLocalTrigger.js - Line 388
companyLocalTriggerSchema.statics.findActiveByCompanyId = function(companyId) {
  return this.find({
    companyId,
    enabled: true,
    isDeleted: { $ne: true },
    state: 'published'  // ← THIS IS FILTERING OUT YOUR TRIGGERS
  })
```

**Your triggers are likely:**
- `state: null` (field doesn't exist)
- `state: 'draft'`
- `state: undefined`

**But runtime requires:**
- `state: 'published'`

This means:
- ✅ Triggers exist in database
- ✅ Triggers are enabled
- ✅ Triggers have keywords
- ❌ But runtime query filters them out because `state != 'published'`
- ❌ Result: **Trigger Pool EMPTY** → All calls fall to LLM fallback

## Evidence from Screenshots

Your screenshot shows:
1. **"Trigger Pool — EMPTY"** ⚠️
2. **"TriggerCardMatcher — No Match"** (evaluated 0 cards)
3. **"Response — FALLBACK_NO_REASON"**
4. Message: "No trigger cards loaded"

This is the **exact symptom** of the `state: 'published'` filter blocking all triggers.

## The Fix

### Option 1: Run Diagnostic Script (Recommended)

```bash
# Check what's wrong
node scripts/diagnose-trigger-issue.js <companyId>

# Example
node scripts/diagnose-trigger-issue.js 68e3f77a9d623b8058c700c4
```

This will:
- ✅ Show you EXACTLY what's wrong
- ✅ Show trigger counts by state
- ✅ Identify which triggers are enabled but not published
- ✅ Give you the exact fix command

### Option 2: Run Fix Script

```bash
# Fix all enabled triggers for a company
node scripts/fix-trigger-state.js <companyId> --fix

# Example
node scripts/fix-trigger-state.js 68e3f77a9d623b8058c700c4 --fix
```

This will:
- ✅ Find all triggers with `enabled: true` and `state != 'published'`
- ✅ Update them to `state: 'published'`
- ✅ Invalidate cache
- ✅ Make triggers immediately visible at runtime

### Option 3: Manual Database Fix

If you want to fix it manually in MongoDB:

```javascript
// Update all enabled triggers to published state
db.companyLocalTriggers.updateMany(
  {
    companyId: "68e3f77a9d623b8058c700c4",  // Your company ID
    enabled: true,
    state: { $ne: 'published' }
  },
  {
    $set: { state: 'published' }
  }
)
```

### Option 4: Fix in Admin Console

If your admin console has a "Publish" button per trigger:
1. Go to Admin Console → Triggers
2. Click "Publish" on each enabled trigger
3. Refresh cache

## Why This Happened

The code has **strict mode** enabled:

```javascript
// Line 384-387 in CompanyLocalTrigger.js
// RUNTIME: Load ONLY enabled, non-deleted, PUBLISHED triggers
// NO backward compatibility - state MUST be "published" explicitly
// Pre-save hook ensures all new writes have state:published
// For old data with state:null, use cleanup endpoint to normalize
```

This was likely added to:
- Prevent draft triggers from being used in production
- Enforce explicit publishing workflow
- Improve safety (dev vs prod)

But **existing triggers** created before this change have `state: null` or `state: 'draft'`.

## Verification Steps

After fixing:

1. **Check logs** in next call:
   ```
   [TriggerService] 🔍 LOCAL_LOADED {
     localCount: 42,  ← Should be > 0 now
     firstLocalRuleId: "emergency.gas_smell",
     ...
   }
   ```

2. **Check Call Console events**:
   - ✅ `TRIGGER_POOL_SOURCE` - should show `LOCAL: 42` (not 0)
   - ✅ `TRIGGER_MATCHING_ANALYSIS` - should show triggers available
   - ✅ Trigger match events instead of fallback

3. **Test trigger matching**:
   - Call and say: "My air conditioning isn't cooling"
   - Should match a trigger, not fall to LLM

## Long-term Solution

To prevent this in the future, ensure:

1. **All new triggers** are created with `state: 'published'` (pre-save hook should handle this)
2. **Existing triggers** are migrated once
3. **Admin UI** shows state clearly and has "Publish" button
4. **Documentation** explains the publish workflow

## Related Code

The three critical functions:

1. **Runtime query** (strict - requires published):
   ```javascript
   CompanyLocalTrigger.findActiveByCompanyId(companyId)
   // Filters: enabled=true, isDeleted!=true, state='published'
   ```

2. **Admin query** (permissive - shows all):
   ```javascript
   CompanyLocalTrigger.findByCompanyId(companyId)
   // Filters: isDeleted!=true only
   ```

3. **Trigger loading**:
   ```javascript
   TriggerService.loadTriggersForCompany(companyId)
   // Calls findActiveByCompanyId → applies state filter
   ```

## Scripts Created

I've created two diagnostic scripts for you:

### 1. `scripts/diagnose-trigger-issue.js`
Comprehensive diagnostic that checks:
- Database connection
- Trigger settings
- Global trigger group
- Local trigger state breakdown
- Runtime visibility
- Structure validation
- Matching simulation

**Usage:**
```bash
node scripts/diagnose-trigger-issue.js <companyId>
```

### 2. `scripts/fix-trigger-state.js`
Automated fix that:
- Finds all enabled triggers with wrong state
- Updates them to `state: 'published'`
- Invalidates cache
- Shows before/after counts

**Usage:**
```bash
# Check only (dry run)
node scripts/fix-trigger-state.js <companyId>

# Apply fix
node scripts/fix-trigger-state.js <companyId> --fix
```

## Next Steps

1. **Run diagnostic** to confirm this is the issue:
   ```bash
   node scripts/diagnose-trigger-issue.js <companyId>
   ```

2. **Apply fix**:
   ```bash
   node scripts/fix-trigger-state.js <companyId> --fix
   ```

3. **Test call** and verify triggers now match

4. **Check Call Console** for trigger events

---

## Summary

**Problem:** Agent defaults to fallback, can't see trigger keywords

**Root Cause:** Runtime query filters triggers by `state: 'published'`, but your triggers have `state: null` or `state: 'draft'`

**Fix:** Update trigger state to 'published'

**Impact:** Immediate - triggers will be visible as soon as state is updated and cache is cleared

**Prevention:** Use the scripts to audit and fix any company with this issue
