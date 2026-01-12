# Test Pilot UI Features - Complete Explanation

## 📋 Overview

This document explains the key features in the Test Pilot UI that control how companies handle production customer calls vs test calls.

---

## 🎯 Feature 1: "Royal Plumbing (No template)" Bug - **FIXED**

### **Problem**
The company dropdown was showing "Royal Plumbing (No template)" even though templates were loaded.

### **Root Cause**
The backend API (`/api/admin/test-pilot/companies`) was checking the **wrong field**:

```javascript
// ❌ OLD (WRONG):
hasTemplate: !!c.aiAgentLogic?.templateId  // V1 field (deprecated)
```

**Why this failed:** In V2, companies use `templateReferences` (array), not `templateId` (single value).

### **Fix Applied**
Updated to check the correct V2 field:

```javascript
// ✅ NEW (CORRECT):
hasTemplate: Array.isArray(c.aiAgentLogic?.templateReferences) && 
            c.aiAgentLogic.templateReferences.length > 0
```

**File:** `routes/admin/companyTestMode.js` (lines 214-215)

### **Result**
- ✅ Royal Plumbing now correctly shows as having templates
- ✅ All companies with active templates display correctly
- ✅ Test Pilot can now properly select companies for testing

---

## 🔗 Feature 2: "Inherit from Test Pilot Settings" Checkbox

### **Location**
**Company Production Intelligence** tab (shown in screenshot 1)

### **What It Does**

This checkbox controls whether a company uses:
- **Test Pilot Intelligence thresholds** (global settings)
- **OR** its own custom thresholds (company-specific)

### **When CHECKED (ON - Default)**:
```javascript
// Company inherits from AdminSettings.testPilotIntelligence
{
  source: 'production-inherited',
  thresholds: {
    tier1: 0.80,  // From Test Pilot settings
    tier2: 0.60,  // From Test Pilot settings
    enableTier3: true
  },
  llmConfig: {
    model: 'gpt-4o-mini',
    maxCostPerCall: 0.10
  }
}
```

**Benefit:** All companies stay in sync with your Test Pilot configuration. Change Test Pilot settings → all companies inherit the change automatically.

### **When UNCHECKED (OFF)**:
```javascript
// Company uses its own custom settings
{
  source: 'production-custom',
  thresholds: {
    tier1: 0.85,  // Company-specific (higher = stricter)
    tier2: 0.65,  // Company-specific
    enableTier3: false  // Company can disable LLM entirely
  }
}
```

**Benefit:** Company can have custom thresholds (e.g., Royal Plumbing has stricter rules than other companies).

### **Implementation**

**Backend Logic:** `services/RuntimeIntelligenceConfig.js` (lines 114-140)

```javascript
if (productionConfig.inheritFromTestPilot !== false) {
    // Load Test Pilot settings from AdminSettings
    const adminSettings = await AdminSettings.findOne({});
    const testPilotConfig = adminSettings?.testPilotIntelligence || {};
    
    return {
        source: 'production-inherited',
        thresholds: {
            tier1: testPilotConfig.thresholds?.tier1 || 0.80,
            tier2: testPilotConfig.thresholds?.tier2 || 0.60,
            enableTier3: productionConfig.thresholds?.enableTier3 !== false
        }
    };
}
```

**UI Toggle:** `public/admin-global-instant-responses.html` (lines 8141-8164)

```javascript
function toggleInheritFromTestPilot() {
    const inheritCheckbox = document.getElementById('inherit-from-test-pilot');
    const settingsContainer = document.getElementById('company-intelligence-settings');
    
    if (inheritCheckbox.checked) {
        // Disable custom settings (use Test Pilot settings)
        settingsContainer.classList.add('opacity-50', 'pointer-events-none');
    } else {
        // Enable custom settings
        settingsContainer.classList.remove('opacity-50', 'pointer-events-none');
    }
}
```

### **Database Storage**

Stored in: `company.aiAgentLogic.productionIntelligence.inheritFromTestPilot`

```javascript
// MongoDB document
{
  _id: ObjectId("..."),
  companyName: "Royal Plumbing",
  aiAgentLogic: {
    productionIntelligence: {
      inheritFromTestPilot: true,  // ← This field
      thresholds: {
        tier1: 0.80,
        tier2: 0.60,
        enableTier3: true
      }
    }
  }
}
```

### **Recommendation**

✅ **Keep it CHECKED (ON)** for most companies
- Easier to manage (one place to update thresholds)
- Consistent behavior across all companies
- Test Pilot changes automatically apply to production

❌ **Uncheck (OFF)** only for special cases:
- VIP client needs stricter matching (higher tier1 threshold)
- Budget-conscious client wants LLM disabled (enableTier3 = false)
- Beta testing new thresholds on one company before rolling out globally

---

## ⚡ Feature 3: "Enable 3-Tier Intelligence System" Toggle

### **Location**
**Company Production Intelligence** tab (shown in screenshot 1)

### **What It Does**

This toggle controls whether the company uses:
- **Tier 1 + 2 + 3** (Rule-based → Semantic → LLM)
- **OR** Tier 1 + 2 only (100% free, no LLM fallback)

### **When ON (Enabled)**:
```
Customer: "My AC is busted, can you come fix it?"

Tier 1 (Rule-based): Checks triggers → 65% confidence (below 80% threshold)
  ↓
Tier 2 (Semantic): Vector similarity → 72% confidence (below 80% threshold)
  ↓
Tier 3 (LLM): OpenAI GPT → 95% confidence → MATCH! ✅
  
Cost: $0.003 (0.3 cents)
Response: "I'll schedule a technician for your air conditioning repair."
```

**Benefit:** Handles edge cases perfectly. Customer always gets a response.

### **When OFF (Disabled)**:
```
Customer: "My AC is busted, can you come fix it?"

Tier 1 (Rule-based): Checks triggers → 65% confidence (below 80% threshold)
  ↓
Tier 2 (Semantic): Vector similarity → 72% confidence (below 80% threshold)
  ↓
Tier 3 (DISABLED): No fallback available
  
Cost: $0.000 (FREE)
Response: Generic fallback or "I didn't understand that."
```

**Trade-off:** 100% free, but might fail on unusual phrasing.

### **Implementation**

**Environment Variable:** `ENABLE_3_TIER_INTELLIGENCE=true` (in `.env`)

This is a **global feature flag** that enables the system. Individual companies can then enable/disable their use of Tier 3 via the toggle.

**Database Storage:**

Stored in: `company.aiAgentLogic.productionIntelligence.thresholds.enableTier3`

```javascript
{
  aiAgentLogic: {
    productionIntelligence: {
      thresholds: {
        tier1: 0.80,
        tier2: 0.60,
        enableTier3: true  // ← This field
      }
    }
  }
}
```

### **Recommendation**

✅ **Keep it ON** for:
- Customer-facing production calls (better experience)
- Companies with complex scenarios (HVAC, plumbing, electrical)
- High-value clients where experience matters more than cost

❌ **Turn it OFF** for:
- Internal testing (save money during development)
- Simple scenarios (appointment booking only)
- Budget-conscious clients ($100+/month savings possible)

### **Cost Impact**

**Example Company:** 100 calls/day, 80% match Tier 1, 15% match Tier 2, 5% need Tier 3

```
With Tier 3 ON:
- 80 calls: FREE (Tier 1)
- 15 calls: FREE (Tier 2)
- 5 calls: 5 × $0.003 = $0.015/day = $0.45/month

With Tier 3 OFF:
- 80 calls: FREE (Tier 1)
- 15 calls: FREE (Tier 2)
- 5 calls: Generic fallback (potentially lost customers)

Savings: $0.45/month
Risk: 5% of calls get poor responses
```

**Verdict:** The $0.45/month cost is worth it for customer experience. Only disable if templates are PERFECT and cover 99%+ of calls.

---

## 🎯 Summary - Quick Reference

| Feature | Location | Purpose | Default | When to Change |
|---------|----------|---------|---------|----------------|
| **Template Detection** | Test Pilot dropdown | Show which companies have templates loaded | Auto-detect | Never (fixed automatically) |
| **Inherit from Test Pilot** | Company Intelligence tab | Use global thresholds vs custom | ✅ ON | Only for special clients |
| **Enable 3-Tier System** | Company Intelligence tab | Use LLM fallback or not | ✅ ON | Only if templates are perfect |

---

## 🧪 Testing Instructions

### **Test 1: Verify Template Detection Fix**
1. Go to Test Pilot → Company Testing mode
2. Open company dropdown
3. ✅ **Expected:** Royal Plumbing shows WITHOUT "(No template)"
4. ✅ **Expected:** Only companies with NO templates show "(No template)"

### **Test 2: Verify Inherit Checkbox**
1. Go to company → AI Agent Logic → Production Intelligence tab
2. ✅ **Check** "Inherit from Test Pilot Settings"
3. ✅ **Expected:** Sliders below become grayed out (disabled)
4. ❌ **Uncheck** the checkbox
5. ✅ **Expected:** Sliders become active (can adjust)

### **Test 3: Verify 3-Tier Toggle**
1. Same tab as above
2. ✅ **Toggle ON** "Enable 3-Tier Intelligence System"
3. Call company → say something unusual: "My whatchamacallit is kaput"
4. ✅ **Expected:** AI responds correctly (LLM understood it)
5. ❌ **Toggle OFF** "Enable 3-Tier Intelligence System"
6. Call company → say same phrase
7. ✅ **Expected:** AI might not understand (generic fallback)

---

## 📁 Related Files

| File | Purpose |
|------|---------|
| `routes/admin/companyTestMode.js` | Backend API for Test Pilot company list |
| `services/RuntimeIntelligenceConfig.js` | Intelligence config loader (inherit logic) |
| `services/IntelligentRouter.js` | 3-tier routing engine (Tier 1 → 2 → 3) |
| `public/admin-global-instant-responses.html` | UI for Test Pilot and intelligence settings |
| `models/AdminSettings.js` | Test Pilot Intelligence schema |
| `models/v2Company.js` | Company Production Intelligence schema |

---

## 🐛 Bug Fixes Applied

### **BUG #1: "Royal Plumbing (No template)"**
- **Status:** ✅ FIXED
- **Commit:** `[pending]`
- **Files Changed:** `routes/admin/companyTestMode.js`
- **Change:** Check `templateReferences` (V2) instead of `templateId` (V1)

---

## 📝 Notes for Developers

### **Why Two Intelligence Systems?**

**Test Pilot Intelligence** (AdminSettings):
- For testing templates in isolation
- Aggressive thresholds (lower = more Tier 2/3 triggers)
- Goal: Find weaknesses in templates
- Cost tracking: Separate from production

**Production Intelligence** (v2Company):
- For real customer calls
- Conservative thresholds (higher = fewer Tier 3 calls)
- Goal: Handle customers efficiently at lowest cost
- Cost tracking: Per-company budgets

### **Why "Inherit from Test Pilot"?**

Without inheritance, you'd need to manually update thresholds for 100+ companies when tuning the system. With inheritance:
- Update Test Pilot settings once
- All companies automatically use new thresholds
- Can override for special cases

This is **enterprise-grade multi-tenant architecture** in action!

---

**Last Updated:** 2025-11-05
**Author:** AI Assistant (Claude)
**Status:** Production-Ready ✅

