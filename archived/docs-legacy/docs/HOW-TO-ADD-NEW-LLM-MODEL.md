# 🔧 How to Add a New LLM Model - SAFE ROLLOUT GUIDE

## 🛡️ Production-Safe Deployment Strategy

This guide uses a **3-phase rollout** to protect your 500+ companies from untested models.

---

## 🎯 3-Phase Rollout Process

### **Phase 1: Admin Testing** (1-2 days)
- Add model to beta section (hidden from regular users)
- Test with 1-2 pilot companies
- Monitor for errors

### **Phase 2: Limited Rollout** (1 week)
- Enable for select companies
- Monitor performance & costs
- Gather feedback

### **Phase 3: Production** (After validation)
- Move to stable models section
- Available for all companies

---

## Quick Reference Guide

When OpenAI releases a new model, follow these steps:

---

## 📝 **PHASE 1: Add Model for Testing (SAFE)**

### **Step 1: Add to Beta Models Section**

**File:** `public/admin-global-instant-responses.html`  
**Line:** ~2279 (inside beta-models-group)

```html
<!-- 🧪 TESTING MODELS (Use with Caution) -->
<optgroup label="🧪 Testing/Beta Models (Admin Testing Only)" id="beta-models-group" style="display: none;">
    <!-- Add new models here for testing before production rollout -->
    <option value="gpt-4.5-preview">🧪 GPT-4.5 Preview (BETA - Test Only)</option>
</optgroup>
```

**✅ SAFE:** Model is hidden by default, only visible if admin checks "Show testing/beta models"

---

### **Step 2: Add to Beta Model Detection**

**File:** `public/admin-global-instant-responses.html`  
**Line:** ~8050 (in `isBetaModel()` function)

```javascript
function isBetaModel(modelName) {
    const betaModels = [
        'gpt-4.5-preview',  // ← Add here
        'gpt-5-preview',
        'o1-preview',
        'o1-mini'
    ];
    
    return betaModels.includes(modelName) || 
           modelName.includes('preview') || 
           modelName.includes('beta');
}
```

**✅ SAFE:** This triggers warning banner when beta model is selected

---

### **Step 3: Test with Pilot Company**

1. Go to Company Testing
2. Select Royal Plumbing (or test company)
3. Check "🧪 Show testing/beta models"
4. Select "GPT-4.5 Preview"
5. See warning: "⚠️ Beta Model Selected"
6. Save and test thoroughly

**✅ SAFE:** Only affects companies you explicitly configure

---

## 📝 **PHASE 2: Limited Rollout (After Testing)**

After 1-2 days of successful testing:

### **Step 4: Update Database Enums (Allow Backend to Accept Model)**

**Files to Update:**
- `models/v2Company.js` (Line ~641)
- `models/AdminSettings.js` (Line ~649)
- `models/GlobalInstantResponseTemplate.js` (Line ~788)
- `models/ProductionLLMSuggestion.js` (Line ~207)

```javascript
enum: ['gpt-4.5-preview', 'gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo']
```

**✅ SAFE:** Backend now accepts the model, but UI still shows it as beta

---

## 📝 **PHASE 3: Production Release (After Validation)**

After 1 week of successful limited rollout:

### **Step 5: Move to Stable Models Section**

**File:** `public/admin-global-instant-responses.html`  
**Line:** ~2272

```html
<!-- ✅ STABLE MODELS (Production-Ready) -->
<optgroup label="✅ Stable Models (Production-Ready)">
    <option value="gpt-4.5">🚀🚀 GPT-4.5 (Next-Gen - ~$0.15/call)</option>
    <option value="gpt-4o">🚀 GPT-4o (Best Quality - ~$0.10/call)</option>
    <option value="gpt-4o-mini" selected>⚖️ GPT-4o-mini (Balanced - ~$0.04/call)</option>
    <option value="gpt-3.5-turbo">⚡ GPT-3.5-turbo (Fast & Cheap - ~$0.01/call)</option>
</optgroup>
</select>
```

---

### **Step 2: Update Database Enum**

**Files to Update:**
- `models/v2Company.js` (Line ~641)
- `models/AdminSettings.js` (Line ~649)
- `models/GlobalInstantResponseTemplate.js` (Line ~788)
- `models/ProductionLLMSuggestion.js` (Line ~207)

```javascript
enum: ['gpt-4.5', 'gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo']
```

---

### **Step 3: Test & Deploy**

```bash
# Test locally
1. Start dev server
2. Open Company Production Intelligence
3. Select "GPT-4.5" from dropdown
4. Save settings
5. Verify it saves to database

# Deploy
git add -A
git commit -m "🆕 ADD: Support for GPT-4.5 model"
git push origin main
```

---

## 🎯 **Files Checklist**

| File | Location | What to Update |
|------|----------|----------------|
| **UI** | `public/admin-global-instant-responses.html:2270` | Add `<option>` for new model |
| **UI Modal** | `public/js/ai-agent-settings/IntelligenceSettingsModal.js:401` | Add `<option>` for new model |
| **Company Schema** | `models/v2Company.js:641` | Add to `enum` array |
| **Admin Schema** | `models/AdminSettings.js:649` | Add to `enum` array |
| **Template Schema** | `models/GlobalInstantResponseTemplate.js:788` | Add to `enum` array |
| **Logging Schema** | `models/ProductionLLMSuggestion.js:207` | Add to `enum` array |
| **Documentation** | `docs/clientvia_Architecture.md` | Update model list |

---

## ⚠️ **CRITICAL: Don't Remove Old Models**

**NEVER remove old models until:**
1. OpenAI deprecates them officially
2. You verify no companies are using them
3. You migrate all companies to newer models

**Check usage first:**
```javascript
// MongoDB query
db.companies.find({ 
  "aiAgentLogic.productionIntelligence.llmConfig.model": "gpt-4o" 
}).count()
```

---

## 📚 **Resources**

- **OpenAI Models:** https://platform.openai.com/docs/models
- **OpenAI Pricing:** https://openai.com/pricing
- **Changelog:** https://platform.openai.com/docs/changelog


