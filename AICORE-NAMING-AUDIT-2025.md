# 🔍 AiCore Naming & Terminology Audit (October 2025)

## 📋 **CURRENT STATE ANALYSIS**

### **Main Tab**
- **Current Name**: "AI Agent Settings"
- **Icon**: `<i class="fas fa-robot"></i>`
- **Status**: ✅ GOOD - Clear and accurate

---

## 🎯 **SUB-TABS INVENTORY**

### **1. Variables**
- **Current Name**: "Variables"
- **Icon**: `<i class="fas fa-sliders-h"></i>`
- **Data Attribute**: `data-subtab="variables"`
- **Manager**: `VariablesManager.js`
- **Purpose**: Manage company-specific dynamic variables (company name, phone, etc.)
- **Status**: ✅ GOOD - Accurate name

---

### **2. AiCore Filler Filter**
- **Current Name**: "AiCore Filler Filter"
- **Icon**: `<i class="fas fa-filter"></i>`
- **Data Attribute**: `data-subtab="aicore-filler-filter"`
- **Manager**: `AiCoreFillerFilterManager.js`
- **Purpose**: Manage filler words (um, uh, like) stripped from user input
- **Status**: ⚠️ **NEEDS REVIEW** - "Filler Filter" is confusing
- **Recommendation**: Consider "Filler Words" or "Word Filter"

---

### **3. AiCore Templates**
- **Current Name**: "AiCore Templates"
- **Icon**: `<i class="fas fa-brain"></i>`
- **Data Attribute**: `data-subtab="aicore-templates"`
- **Manager**: `AiCoreTemplatesManager.js`
- **Purpose**: Activate/manage Global AI Brain templates (behavior templates)
- **Status**: ✅ GOOD - Clear and accurate
- **Note**: This is the NEW system (replaced old "Template Hub")

---

### **4. AiCore Live Scenarios**
- **Current Name**: "AiCore Live Scenarios"
- **Icon**: `<i class="fas fa-layer-group"></i>`
- **Data Attribute**: `data-subtab="aicore-live-scenarios"`
- **Manager**: `AiCoreLiveScenariosManager.js`
- **Purpose**: View all active scenarios from activated templates (read-only)
- **Status**: ✅ GOOD - "Live" indicates real-time data

---

### **5. AiCore Knowledgebase**
- **Current Name**: "AiCore Knowledgebase"
- **Icon**: `<i class="fas fa-book-medical"></i>`
- **Data Attribute**: `data-subtab="aicore-knowledgebase"`
- **Manager**: `AiCoreKnowledgebaseManager.js`
- **Purpose**: Monitor failed/low-confidence AI responses (action items)
- **Status**: ⚠️ **NEEDS REVIEW** - "Knowledgebase" implies a database of knowledge, but it's actually a "Gap Detector" or "Performance Monitor"
- **Recommendation**: Consider "Knowledge Gaps" or "Learning Monitor"

---

### **6. Analytics**
- **Current Name**: "Analytics"
- **Icon**: `<i class="fas fa-chart-line"></i>`
- **Data Attribute**: `data-subtab="analytics"`
- **Manager**: `AnalyticsManager.js`
- **Purpose**: View AI performance metrics and business intelligence
- **Status**: ✅ GOOD - Universal term, clear purpose

---

## 🏆 **MISSION CONTROL DASHBOARD**

### **Component Names in Stats Grid**
- **Templates**: Shows ✓/✗ if templates activated
- **Variables**: Shows ✓/✗ if required variables filled
- **Twilio**: Shows ✓/✗ if Twilio configured
- **Voice**: Shows ✓/✗ if voice settings configured

**Status**: ✅ GOOD - All accurate

---

## 🚨 **ACTION CENTER (BLOCKERS)**

### **Blocker Codes**
- `NO_TEMPLATE` → "No Global AI Brain template cloned"
  - **Issue**: Says "cloned" but we now use "activated"
  - **Fix**: Change to "No Global AI Brain template activated"
  
- `MISSING_VARIABLES` → "Required variables not configured"
  - **Status**: ✅ GOOD
  
- `NO_TWILIO` → "Twilio credentials missing"
  - **Status**: ✅ GOOD
  
- `NO_VOICE` → "Voice settings not configured"
  - **Status**: ✅ GOOD

---

## 📝 **TERMINOLOGY CONSISTENCY CHECK**

### **"Template" vs "Behavior Template"**
- ✅ **Consistent**: Using "template" throughout
- ✅ **Stored in**: `GlobalAIBehaviorTemplate` model (backend)
- ✅ **Displayed as**: "Templates" (frontend)

### **"Clone" vs "Activate"**
- ❌ **INCONSISTENT**: 
  - Old code says "cloned"
  - New UI says "Activate"
  - Backend still uses `clonedFrom` field
- **Recommendation**: Standardize on "Activate" (templates are referenced, not copied)

### **"Scenarios" vs "Instant Responses"**
- ⚠️ **MIXED**: 
  - Backend model: `GlobalInstantResponseTemplate`
  - Frontend: "Scenarios"
  - Old code: "Instant Responses"
- **Recommendation**: Decide on ONE term and use it everywhere

### **"AiCore" vs "AI Core" vs "AICore"**
- ⚠️ **INCONSISTENT**:
  - Tab names: "AiCore Templates" (no space)
  - Code comments: "AI Core" (with space)
  - Some classes: "AICore" (all caps)
- **Recommendation**: Standardize on "AiCore" (one word, camel case)

---

## 🔧 **RECOMMENDED FIXES**

### **HIGH PRIORITY**

1. **Change blocker message**: 
   - From: "No Global AI Brain template cloned"
   - To: "No Global AI Brain template activated"

2. **Rename "AiCore Filler Filter"**:
   - To: "Filler Words" (simpler, clearer)

3. **Rename "AiCore Knowledgebase"**:
   - To: "Knowledge Gaps" or "Learning Monitor"

### **MEDIUM PRIORITY**

4. **Standardize "AiCore" spelling** across all code and comments

5. **Update backend field names**:
   - `clonedFrom` → `activeTemplates` (array)
   - `clonedAt` → `activatedAt`

### **LOW PRIORITY**

6. **Add tooltips** to sub-tab buttons explaining what each does

7. **Consistent iconography** review (some icons may not match purpose)

---

## ✅ **FINAL RECOMMENDATION**

### **Proposed New Tab Names:**
1. ✅ **Variables** (keep as-is)
2. 🔄 **Filler Words** (remove "AiCore", simplify "Filter")
3. ✅ **AiCore Templates** (keep as-is)
4. ✅ **Live Scenarios** (remove "AiCore" for brevity)
5. 🔄 **Knowledge Gaps** (clearer than "Knowledgebase")
6. ✅ **Analytics** (keep as-is)

---

## 📊 **IMPACT ANALYSIS**

- **Files to Update**: 3 (HTML, JS, Backend Service)
- **Breaking Changes**: None (data-attributes can stay the same)
- **User Impact**: Minimal (just label changes)
- **Time Estimate**: 30 minutes

---

**Generated**: October 19, 2025  
**Status**: Ready for Review & Implementation

