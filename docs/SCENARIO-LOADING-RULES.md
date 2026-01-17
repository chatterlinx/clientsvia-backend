# Scenario Loading Rules

## Architecture Decision: Binary Control Only

**Effective:** Jan 17, 2026  
**Decision:** Scenarios use `isActive` as the single source of truth for loading.

---

## The Rule

```javascript
// ONLY check isActive
if (scenario.isActive !== true) {
    return; // Don't load this scenario
}

// ✅ Scenario loads
```

**That's it. No other filters.**

---

## What This Means

### ✅ **Load Scenarios When:**
- `isActive: true`

### ❌ **Don't Load Scenarios When:**
- `isActive: false`
- `isActive: undefined`
- `isActive: null`

---

## What About `status` Field?

The `status` field (`'draft'`, `'live'`, `'archived'`) **does NOT affect loading**.

It can exist in the schema for:
- Admin UI organization
- Editorial workflow labels
- Audit trail

But it is **ignored** by ScenarioPoolService.

---

## Philosophy

> "I don't believe in draft. Either load a scenario or delete it."  
> — User requirement

**Binary choice is clearer:**
- Want scenario used? → `isActive: true`
- Want scenario not used? → `isActive: false` (or delete it)

No "maybe", no "in progress", no confusion.

---

## Migration Impact

### Before This Change:
```javascript
if (scenario.status !== 'live' || scenario.isActive !== true) {
    return; // Don't load
}
```

**Problem:** 70 of 71 scenarios had `status: 'draft'`, so only 1 loaded despite all being `isActive: true`.

### After This Change:
```javascript
if (scenario.isActive !== true) {
    return; // Don't load
}
```

**Result:** All 71 `isActive: true` scenarios load correctly.

---

## How To Control Scenario Loading

### Enable a Scenario:
```javascript
scenario.isActive = true;
```

### Disable a Scenario:
```javascript
scenario.isActive = false;
```

### Delete a Scenario:
Just delete it from the database.

---

## For Admins

When creating scenarios in the Global AI Brain:
- ✅ Set `isActive: true` if ready to use
- ❌ Set `isActive: false` if not ready yet
- 🗑️ Delete it if you don't want it

**Don't worry about `status` field** - it's just a label.

---

## Code Location

**File:** `services/ScenarioPoolService.js`

**Line:** ~414-418

```javascript
scenarios.forEach(scenario => {
    // FILTER: Only active scenarios
    // isActive is the single source of truth: true = load it, false = don't
    if (scenario.isActive !== true) {
        return;
    }
    
    // ... rest of scenario loading logic
});
```

---

## Related Issues

- Fixed: "Only 1 scenario loading despite 71 existing" (Jan 17, 2026)
- Root cause: 70 scenarios had `status: 'draft'`, old filter rejected them
- Solution: Removed `status` check, simplified to `isActive` only

---

## Future Considerations

If you ever need more granular control (e.g., "beta scenarios", "A/B testing"), use:
- Company-specific overrides (`CompanyScenarioOverride`)
- Category filters
- Template linking/unlinking

**Do NOT reintroduce `status` as a loading filter.**

Binary `isActive` is the production standard.
