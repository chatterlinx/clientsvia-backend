# 🔧 How to Add a New LLM Model

## Quick Reference Guide

When OpenAI releases a new model, follow these steps:

---

## 📝 **EXAMPLE: Adding GPT-4.5**

### **Step 1: Update UI Dropdown**

**File:** `public/admin-global-instant-responses.html`  
**Line:** ~2270

```html
<select id="company-llm-model">
    <option value="gpt-4.5">🚀🚀 GPT-4.5 (Next-Gen - ~$0.15/call)</option>
    <option value="gpt-4o">🚀 GPT-4o (Best Quality - ~$0.10/call)</option>
    <option value="gpt-4o-mini" selected>⚖️ GPT-4o-mini (Balanced - ~$0.04/call)</option>
    <option value="gpt-3.5-turbo">⚡ GPT-3.5-turbo (Fast & Cheap - ~$0.01/call)</option>
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


