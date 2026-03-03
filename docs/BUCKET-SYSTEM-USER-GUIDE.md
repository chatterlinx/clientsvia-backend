# Trigger Bucket System - User Guide

## What Are Trigger Buckets?

Trigger buckets organize your triggers by intent type for **40-60% faster responses**.

### The Problem

Without buckets, the agent evaluates **all 43 triggers** on every call turn:
- ❌ Evaluates billing triggers even on AC repair calls
- ❌ Evaluates heating triggers even on billing questions
- ❌ Takes 400-500ms to check all triggers
- ❌ Results in awkward silences and slow responses

### The Solution

With buckets, the agent only evaluates **relevant triggers** (~15 per call):
- ✅ ScrabEngine detects call intent ("cooling issue")
- ✅ Agent loads only cooling-related triggers
- ✅ Evaluation time drops to ~200ms
- ✅ 300ms faster response = less awkward silence

---

## How to Use Buckets

### Step 1: Open Bucket Manager

1. Go to **Admin Console → Triggers**
2. Click **"🗂️ Manage Buckets"** button (top right)

### Step 2: Create Your First Bucket

1. Click **"+ Create New Bucket"**
2. Fill in:
   - **Name**: e.g., "Cooling Issues"
   - **Icon**: Pick an emoji (🧊, 🔥, 💰, etc.)
   - **Classification Keywords**: Words that identify this type of call
     - Example: `cooling`, `not cooling`, `warm air`, `ac not cold`
   - **Priority**: Lower = higher (keep default: 50)
   - **Threshold**: 70% (default - means 70% confidence required)

3. Click **"Save Bucket"**

### Step 3: Assign Triggers to Buckets

**Method 1: Quick Assign (from trigger list)**
1. Look for **red ✗** in bucket column
2. Click the ✗
3. Select bucket from dropdown
4. Click Save

**Method 2: Edit Trigger Form**
1. Click **Edit** on any trigger
2. Find **"Trigger Bucket"** dropdown
3. Select appropriate bucket
4. Click Save

**Method 3: Bulk Assign**
1. Select multiple triggers (checkboxes)
2. Click **"Bulk Assign to Bucket"**
3. Choose bucket
4. Click Assign

### Step 4: Review Health Bar

Top of page shows bucket coverage:
```
📊 35/43 bucketed (81%) 🟢 | 5 unbucketed (12%) 🔴 | 3 emergency (7%) 🟡
```

**Goal**: 80%+ bucketed (green)

---

## Understanding Status Icons

### In Trigger List (Bucket Column):

| Icon | Color | Meaning | Action |
|------|-------|---------|--------|
| ✓ | 🟢 Green | Assigned to valid bucket | Click to change bucket |
| ✗ | 🔴 Red | Not bucketed | Click to assign bucket |
| 🚨 | 🟡 Yellow | Emergency (always active) | Bypasses bucket filtering |

---

## Best Practices

### 1. **Create Buckets for Your Top Intent Types**

For HVAC companies:
- 🧊 Cooling Issues (15-20 triggers)
- 🔥 Heating Issues (10-15 triggers)
- 📅 Scheduling (8-12 triggers)
- 💰 Billing (5-8 triggers)
- 🚨 Emergency (3-5 triggers)

### 2. **Choose Good Classification Keywords**

**Good keywords** (specific, unique):
- Cooling bucket: `cooling`, `not cooling`, `warm air`, `ac not cold`
- Billing bucket: `bill`, `invoice`, `charge`, `payment`

**Bad keywords** (too broad):
- `ac` - Could be cooling OR heating OR general
- `service` - Every call type mentions service
- `need` - Too generic

### 3. **Emergency Triggers Should Always Evaluate**

Safety-critical triggers should have **🚨 Always Evaluate** checked:
- Gas leaks
- Carbon monoxide
- No heat in winter
- Flooding

These bypass bucket filtering and are checked on **every call**.

### 4. **Monitor Bucket Health**

Watch the health bar:
- **80%+ bucketed** = ✅ Good
- **50-79% bucketed** = ⚠️ Assign more triggers
- **<50% bucketed** = ❌ Bucket system not effective

---

## Expected Performance Improvement

### Before Buckets:
```
Call comes in: "My AC isn't cooling"
  ↓
Evaluate all 43 triggers
  ↓
Takes ~500ms
  ↓
Slow response
```

### After Buckets:
```
Call comes in: "My AC isn't cooling"
  ↓
ScrabEngine: "cooling" detected → Cooling bucket (95% confidence)
  ↓
Evaluate only 12 cooling triggers + 3 emergency
  ↓
Takes ~200ms
  ↓
300ms faster = less awkward silence!
```

---

## Safety & Fallbacks

### What if Classification is Wrong?

**Zero-Match Retry:**
- If filtered pool has no match
- System automatically retries with **full pool**
- Prevents missed triggers due to misclassification

**Example:**
```
Caller: "I got charged twice AND my AC is broken"
  ↓
ScrabEngine: Detects "billing" bucket (70% confidence)
  ↓
Loads billing triggers only
  ↓
No match (caller's main issue is AC, not billing)
  ↓
🔄 RETRY with full pool
  ↓
Matches AC cooling trigger ✅
```

### What if Bucket Loading Fails?

**Graceful Degradation:**
- If buckets fail to load → use full pool
- If no buckets configured → use full pool
- System never breaks, just doesn't optimize

---

## Quick Start Script

For new HVAC companies:

```bash
# Preview default buckets (dry run)
node scripts/setup-default-buckets.js <companyId>

# Create default buckets
node scripts/setup-default-buckets.js <companyId> --apply
```

This creates:
- 🧊 Cooling Issues
- 🔥 Heating Issues
- 📅 Scheduling
- 💰 Billing
- 🚨 Emergency

And auto-assigns your existing triggers!

---

## Testing

Test bucket classification:

```bash
node scripts/test-bucket-system.js <companyId>
```

Shows:
- ✅ Buckets loaded correctly
- ✅ Triggers assigned properly
- ✅ Classification working
- ✅ Pool filtering reducing overhead

---

## Troubleshooting

### "Red ✗ icons everywhere"

**Problem**: Triggers not assigned to buckets

**Fix**: 
1. Click **Manage Buckets**
2. Create buckets for your intent types
3. Click red ✗ icons to assign triggers

### "Health bar shows <50%"

**Problem**: Low bucket coverage

**Fix**:
1. Review unbucketed triggers
2. Assign to appropriate buckets
3. Target 80%+ coverage

### "Bucket classification not working"

**Problem**: Keywords too generic or missing

**Fix**:
1. Edit bucket
2. Add more specific classification keywords
3. Test with common call examples

---

## FAQ

**Q: Can triggers be in multiple buckets?**
A: No, one bucket per trigger. But you can mark it "Always Evaluate" to bypass filtering.

**Q: What happens to unbucketed triggers?**
A: They're evaluated on every call (same as before buckets existed).

**Q: Should I bucket everything?**
A: No - emergency/safety triggers should be "Always Evaluate" (🚨) instead of bucketed.

**Q: How often are buckets cached?**
A: 60 seconds. Changes take effect immediately for new calls after cache refresh.

**Q: Does this break existing triggers?**
A: No - if you don't create buckets, system works exactly as before (no filtering).

---

## Advanced

### Tuning Confidence Threshold

- **70% (default)**: Balanced - only filter when confident
- **50%**: Aggressive - filter more often, faster responses
- **90%**: Conservative - only filter when very confident

### Bucket Priority

If multiple buckets match, highest priority (lowest number) wins.

Example:
- Emergency bucket: Priority 1
- Cooling bucket: Priority 10
- General bucket: Priority 50

---

**Questions?** Check `BUCKET-SYSTEM-IMPLEMENTATION.md` for technical details.
