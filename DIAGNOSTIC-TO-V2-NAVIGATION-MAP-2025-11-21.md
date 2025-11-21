# 🗺️ DIAGNOSTIC TO CONTROL PLANE V2 - NAVIGATION MAPPING
**Date:** November 21, 2025  
**Purpose:** Connect diagnostic "Fix Now" buttons to correct Control Plane V2 tabs  
**Status:** 🔧 READY TO IMPLEMENT

---

## 📊 CURRENT STATE

### **Diagnostic Dashboard (Your Screenshot):**
```
System Live & Operational (60%)

Components:
✅ Variables    - Green checkmark
❌ Templates    - Red X (NO_TEMPLATE)
❌ Scenarios    - Red X (scenarios_none)
✅ Twilio       - Green checkmark  
✅ Voice        - Green checkmark

Action Required: Fix "No templates activated"
```

---

## 🎯 THE MAPPING PROBLEM

### **OLD Navigation (Before V2):**
```javascript
{
  "fix": {
    "action": "navigate",
    "target": "aicore-templates",  // ← OLD TARGET
    "description": "Clone a template"
  }
}
```

### **NEW Navigation (Control Plane V2):**
```javascript
// V2 Structure:
Main Tab: "AiCore Control Center" (data-main-target="aicore")
  └─ Sub-Tab: "AiCore Templates" (data-aicore-target="templates")
  └─ Sub-Tab: "Variables" (data-aicore-target="variables")
  └─ Sub-Tab: "AiCore Live Scenarios" (data-aicore-target="live-scenarios")
  └─ Sub-Tab: "Cheat Sheet" (data-aicore-target="cheat-sheet")
     └─ Tertiary-Tab: "Triage" (data-cheat-target="triage")
     └─ Tertiary-Tab: "Frontline-Intel" (data-cheat-target="frontline-intel")
     └─ ... etc
```

---

## 🔗 COMPLETE DIAGNOSTIC → V2 MAPPING

### **1. Templates Diagnostic**

**Diagnostic Target (OLD):**
```json
{
  "component": "templates",
  "checks": [
    {
      "id": "tmpl_no_clone",
      "fix": {
        "target": "aicore-templates"  // ← OLD
      }
    }
  ]
}
```

**V2 Navigation:**
```javascript
// NEW: Control Plane V2
mainTab: "aicore"
subTab: "templates"
element: data-aicore-target="templates"
```

**Implementation:**
```javascript
function navigateTo_Templates() {
  // 1. Switch to main AiCore tab
  activateMainTab('aicore');
  
  // 2. Switch to Templates sub-tab
  activateAiCoreSubTab('templates');
}
```

---

### **2. Variables Diagnostic**

**Diagnostic Target (OLD):**
```json
{
  "component": "variables",
  "checks": [
    {
      "id": "var_blank_companyName",
      "field": "companyName",
      "fix": {
        "target": "variables",
        "field": "companyName"  // ← Specific field
      }
    }
  ]
}
```

**V2 Navigation:**
```javascript
// NEW: Control Plane V2
mainTab: "aicore"
subTab: "variables"
element: data-aicore-target="variables"
field: "companyName" (scroll to this input)
```

**Implementation:**
```javascript
function navigateTo_Variables(fieldId) {
  // 1. Switch to main AiCore tab
  activateMainTab('aicore');
  
  // 2. Switch to Variables sub-tab
  activateAiCoreSubTab('variables');
  
  // 3. Wait for Variables Manager to load
  setTimeout(() => {
    // 4. Scroll to specific field
    const field = document.querySelector(`[data-var-key="${fieldId}"]`);
    if (field) {
      field.scrollIntoView({ behavior: 'smooth', block: 'center' });
      field.focus();
      // Highlight briefly
      field.style.boxShadow = '0 0 0 4px rgba(59, 130, 246, 0.5)';
      setTimeout(() => {
        field.style.boxShadow = '';
      }, 2000);
    }
  }, 500);
}
```

---

### **3. Scenarios Diagnostic**

**Diagnostic Target (OLD):**
```json
{
  "component": "scenarios",
  "checks": [
    {
      "id": "scenarios_none",
      "fix": {
        "target": "aicore-templates"  // ← Fix by cloning template
      }
    },
    {
      "id": "scenarios_low",
      "fix": {
        "target": "aicore-live-scenarios"  // ← Or enable more scenarios
      }
    }
  ]
}
```

**V2 Navigation (Two Possible Paths):**

**Path A: Clone Template (if 0 scenarios)**
```javascript
mainTab: "aicore"
subTab: "templates"
element: data-aicore-target="templates"
```

**Path B: Enable Scenarios (if < 10 scenarios)**
```javascript
mainTab: "aicore"
subTab: "live-scenarios"
element: data-aicore-target="live-scenarios"
```

**Implementation:**
```javascript
function navigateTo_Scenarios(checkId) {
  activateMainTab('aicore');
  
  if (checkId === 'scenarios_none') {
    // No scenarios at all → Need to clone template first
    activateAiCoreSubTab('templates');
  } else if (checkId === 'scenarios_low') {
    // Some scenarios → Enable more
    activateAiCoreSubTab('live-scenarios');
  }
}
```

---

### **4. Twilio Diagnostic**

**Diagnostic Target (OLD):**
```json
{
  "component": "twilio",
  "checks": [
    {
      "id": "twilio_no_sid",
      "fix": {
        "action": "manual",  // ← No navigation (external)
        "description": "Add Twilio Account SID from Twilio Console"
      }
    }
  ]
}
```

**V2 Navigation:**
```javascript
// This is in CompanyOps, not AiCore!
mainTab: "companyops"
subTab: "voicecore" (or wherever Twilio config lives)
```

**Implementation:**
```javascript
function navigateTo_Twilio() {
  // Twilio config is in CompanyOps → VoiceCore tab
  activateMainTab('companyops');
  // Then find VoiceCore sub-tab
  // (Need to verify exact location in CompanyOps)
}
```

---

### **5. Voice Diagnostic**

**Diagnostic Target (OLD):**
```json
{
  "component": "voice",
  "checks": [
    {
      "id": "voice_no_id",
      "fix": {
        "target": "voice-settings"  // ← OLD
      }
    }
  ]
}
```

**V2 Navigation:**
```javascript
// Voice is also in CompanyOps → VoiceCore
mainTab: "companyops"
subTab: "voicecore"
element: data-companyops-target="voicecore"
```

**Implementation:**
```javascript
function navigateTo_Voice() {
  activateMainTab('companyops');
  activateCompanyOpsSubTab('voicecore');
}
```

---

### **6. CheatSheet Diagnostic** (NEW - TO BE ADDED)

**Diagnostic Target:**
```json
{
  "component": "cheatsheet",
  "checks": [
    {
      "id": "cheatsheet_transfer",
      "fix": {
        "target": "cheat-sheet",
        "subTab": "transfer-calls"  // ← Tertiary level!
      }
    }
  ]
}
```

**V2 Navigation (3 Levels!):**
```javascript
mainTab: "aicore"
subTab: "cheat-sheet"
tertiaryTab: "transfer-calls"
```

**Implementation:**
```javascript
function navigateTo_CheatSheet(tertiaryTab) {
  // 1. Main tab
  activateMainTab('aicore');
  
  // 2. Sub-tab
  activateAiCoreSubTab('cheat-sheet');
  
  // 3. Wait for Cheat Sheet Manager to show tertiary nav
  setTimeout(() => {
    // 4. Tertiary tab
    activateCheatSheetSubTab(tertiaryTab);
  }, 300);
}
```

---

## 🔧 IMPLEMENTATION PLAN

### **Step 1: Create Universal Navigation Helper**

**File:** `public/js/control-plane-v2-navigator.js`

```javascript
/**
 * ============================================================================
 * CONTROL PLANE V2 NAVIGATOR
 * ============================================================================
 * Purpose: Navigate between tabs from diagnostic "Fix Now" buttons
 * Usage: navigateToV2('templates') or navigateToV2('cheat-sheet', 'triage')
 */

class ControlPlaneV2Navigator {
  
  /**
   * Navigate to a specific location in Control Plane V2
   * @param {string} target - The diagnostic target (e.g., "templates", "variables")
   * @param {string} subTarget - Optional tertiary target (e.g., "triage" for CheatSheet)
   * @param {string} fieldId - Optional field ID to highlight
   */
  static navigateTo(target, subTarget = null, fieldId = null) {
    console.log(`🧭 [NAVIGATOR] Navigating to: ${target}`, { subTarget, fieldId });
    
    // Map diagnostic targets to V2 structure
    const navigationMap = {
      // AiCore tabs
      'templates': { main: 'aicore', sub: 'templates' },
      'aicore-templates': { main: 'aicore', sub: 'templates' },
      'variables': { main: 'aicore', sub: 'variables' },
      'live-scenarios': { main: 'aicore', sub: 'live-scenarios' },
      'aicore-live-scenarios': { main: 'aicore', sub: 'live-scenarios' },
      'cheat-sheet': { main: 'aicore', sub: 'cheat-sheet', tertiary: subTarget },
      'call-flow': { main: 'aicore', sub: 'call-flow' },
      'knowledgebase': { main: 'aicore', sub: 'knowledgebase' },
      
      // CompanyOps tabs
      'voice-settings': { main: 'companyops', sub: 'voicecore' },
      'voicecore': { main: 'companyops', sub: 'voicecore' },
      'twilio': { main: 'companyops', sub: 'voicecore' },
      
      // Aliases for backwards compatibility
      'aicore-variables': { main: 'aicore', sub: 'variables' },
    };
    
    const nav = navigationMap[target];
    
    if (!nav) {
      console.warn(`🧭 [NAVIGATOR] Unknown target: ${target}`);
      return;
    }
    
    // Execute navigation
    this._executeNavigation(nav, fieldId);
  }
  
  /**
   * Execute the actual navigation
   */
  static _executeNavigation(nav, fieldId) {
    // Step 1: Activate main tab
    this._activateMainTab(nav.main);
    
    // Step 2: Wait for sub-tabs to render
    setTimeout(() => {
      // Step 3: Activate sub-tab
      this._activateSubTab(nav.main, nav.sub);
      
      // Step 4: If tertiary tab (CheatSheet), activate it
      if (nav.tertiary) {
        setTimeout(() => {
          this._activateTertiaryTab(nav.tertiary);
        }, 300);
      }
      
      // Step 5: If field specified, scroll to it
      if (fieldId) {
        setTimeout(() => {
          this._scrollToField(fieldId);
        }, 500);
      }
    }, 100);
  }
  
  /**
   * Activate main tab
   */
  static _activateMainTab(mainTab) {
    console.log(`🧭 [NAVIGATOR] Activating main tab: ${mainTab}`);
    
    // Remove active from all main tabs
    document.querySelectorAll('.js-main-tab').forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Add active to target main tab
    const mainBtn = document.querySelector(`[data-main-target="${mainTab}"]`);
    if (mainBtn) {
      mainBtn.classList.add('active');
    }
    
    // Hide all main panels
    document.querySelectorAll('[data-main-panel]').forEach(panel => {
      panel.classList.remove('active');
    });
    
    // Show target main panel
    const mainPanel = document.querySelector(`[data-main-panel="${mainTab}"]`);
    if (mainPanel) {
      mainPanel.classList.add('active');
    }
    
    // Show/hide secondary nav
    const secondaryNav = document.getElementById(`${mainTab}-subnav`);
    if (secondaryNav) {
      secondaryNav.style.display = 'flex';
    }
    
    // Hide other secondary navs
    document.querySelectorAll('.subnav').forEach(nav => {
      if (nav.id !== `${mainTab}-subnav`) {
        nav.style.display = 'none';
      }
    });
  }
  
  /**
   * Activate sub-tab (AiCore or CompanyOps)
   */
  static _activateSubTab(mainTab, subTab) {
    console.log(`🧭 [NAVIGATOR] Activating sub-tab: ${subTab}`);
    
    const tabClass = mainTab === 'aicore' ? 'js-aicore-tab' : 
                     mainTab === 'companyops' ? 'js-companyops-tab' : null;
    
    if (!tabClass) return;
    
    // Remove active from all sub-tabs
    document.querySelectorAll(`.${tabClass}`).forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Add active to target sub-tab
    const subBtn = document.querySelector(`[data-${mainTab}-target="${subTab}"]`);
    if (subBtn) {
      subBtn.classList.add('active');
      subBtn.click(); // Trigger click to load content
    }
  }
  
  /**
   * Activate tertiary tab (CheatSheet sub-tabs)
   */
  static _activateTertiaryTab(tertiaryTab) {
    console.log(`🧭 [NAVIGATOR] Activating tertiary tab: ${tertiaryTab}`);
    
    // Show CheatSheet tertiary nav
    const cheatNav = document.getElementById('cheat-subnav');
    if (cheatNav) {
      cheatNav.style.display = 'flex';
    }
    
    // Remove active from all CheatSheet tabs
    document.querySelectorAll('.js-cheat-tab').forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Add active to target tertiary tab
    const tertiaryBtn = document.querySelector(`[data-cheat-target="${tertiaryTab}"]`);
    if (tertiaryBtn) {
      tertiaryBtn.classList.add('active');
      tertiaryBtn.click(); // Trigger click to load content
    }
  }
  
  /**
   * Scroll to and highlight a specific field
   */
  static _scrollToField(fieldId) {
    console.log(`🧭 [NAVIGATOR] Scrolling to field: ${fieldId}`);
    
    // Try multiple selectors
    const selectors = [
      `[data-var-key="${fieldId}"]`,
      `#${fieldId}`,
      `[name="${fieldId}"]`,
      `input[placeholder*="${fieldId}"]`
    ];
    
    let field = null;
    for (const selector of selectors) {
      field = document.querySelector(selector);
      if (field) break;
    }
    
    if (field) {
      // Scroll into view
      field.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Focus if input
      if (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA') {
        field.focus();
      }
      
      // Highlight temporarily
      field.style.boxShadow = '0 0 0 4px rgba(59, 130, 246, 0.5)';
      field.style.transition = 'box-shadow 0.3s';
      
      setTimeout(() => {
        field.style.boxShadow = '';
      }, 2000);
    } else {
      console.warn(`🧭 [NAVIGATOR] Field not found: ${fieldId}`);
    }
  }
}

// Export globally
window.ControlPlaneV2Navigator = ControlPlaneV2Navigator;

// Convenience function
window.navigateToV2 = (target, subTarget, fieldId) => {
  ControlPlaneV2Navigator.navigateTo(target, subTarget, fieldId);
};

console.log('✅ [NAVIGATOR] Control Plane V2 Navigator loaded');
```

---

### **Step 2: Update DiagnosticService.js Fix Targets**

**File:** `services/DiagnosticService.js`

**Current:**
```javascript
fix: {
  action: 'navigate',
  target: 'aicore-templates',  // ← OLD
  description: 'Clone a template'
}
```

**Updated:**
```javascript
fix: {
  action: 'navigate',
  target: 'templates',  // ← NEW (simplified, navigator handles it)
  description: 'Clone a template from Global AI Brain'
}
```

**Changes Needed:**
```javascript
// Line 110
fix: {
  action: 'navigate',
  target: 'templates',  // ← Changed from 'aicore-templates'
  description: 'Go to AiCore Templates tab and clone a template'
}

// Line 331
fix: {
  action: 'navigate',
  target: 'variables',  // ← Keep as is
  description: 'Run Force Scan to detect variables'
}

// Line 406
fix: {
  action: 'navigate',
  target: 'variables',
  field: varName,  // ← Add field parameter
  description: `Fill in actual value for {${varName}}`
}

// Line 714
fix: {
  action: 'navigate',
  target: 'voicecore',  // ← Changed from 'voice-settings'
  description: 'Select a voice from ElevenLabs library'
}

// Line 953
fix: {
  action: 'navigate',
  target: 'templates',  // ← Changed from 'aicore-templates'
  description: 'Clone a template to inherit scenarios'
}

// Line 970
fix: {
  action: 'navigate',
  target: 'live-scenarios',  // ← Changed from 'aicore-live-scenarios'
  description: 'Review and enable more scenarios'
}
```

---

### **Step 3: Update Frontend "Fix Now" Button**

**File:** `public/js/ai-agent-settings/DiagnosticModal.js`

**Add click handler:**
```javascript
// When rendering diagnostic modal, add click handlers to "Fix Now" buttons
function renderDiagnosticModal(diagnostic) {
  // ... existing rendering code ...
  
  // Add click handlers after rendering
  const fixButtons = modal.querySelectorAll('.fix-now-btn');
  fixButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      const subTarget = btn.dataset.subTarget;
      const fieldId = btn.dataset.field;
      
      // Close modal
      modal.close();
      
      // Navigate
      window.navigateToV2(target, subTarget, fieldId);
    });
  });
}
```

**Update button HTML:**
```html
<button 
  class="fix-now-btn"
  data-target="${check.fix.target}"
  data-sub-target="${check.fix.subTarget || ''}"
  data-field="${check.fix.field || ''}"
>
  Fix Now →
</button>
```

---

### **Step 4: Include Navigator in Control Plane V2**

**File:** `public/control-plane-v2.html`

**Add script before closing `</body>`:**
```html
<!-- Control Plane V2 Navigator (for diagnostic navigation) -->
<script src="/js/control-plane-v2-navigator.js?v=1.0"></script>
```

---

## ✅ TESTING CHECKLIST

### **Test 1: Templates Diagnostic → Navigation**
- [ ] Click diagnostic icon for Templates (shows red X)
- [ ] Click "Fix Now" button
- [ ] Should navigate to: AiCore → Templates
- [ ] Should show template cloning interface

### **Test 2: Variables Diagnostic → Navigation**
- [ ] Click diagnostic icon for Variables
- [ ] Click "Fix Now" on specific variable (e.g., companyName)
- [ ] Should navigate to: AiCore → Variables
- [ ] Should scroll to and highlight the specific field

### **Test 3: Scenarios Diagnostic → Navigation**
- [ ] Click diagnostic icon for Scenarios (0 scenarios)
- [ ] Click "Fix Now" button
- [ ] Should navigate to: AiCore → Templates (to clone)

### **Test 4: CheatSheet Diagnostic → Navigation** (After implementing)
- [ ] Click diagnostic icon for CheatSheet
- [ ] Click "Fix Now" for "Transfer Rules missing"
- [ ] Should navigate to: AiCore → CheatSheet → Transfer Calls
- [ ] Should show transfer rules configuration

---

## 📊 SUMMARY

### **Before (Broken):**
```
Diagnostic: "No templates"
Fix Now: targets "aicore-templates" (doesn't exist in V2)
Result: Button does nothing or navigates to wrong place
```

### **After (Fixed):**
```
Diagnostic: "No templates"
Fix Now: targets "templates"
Navigator: Detects target → AiCore main → templates sub → loads UI
Result: Perfect navigation to correct location
```

---

**Status:** 📋 MAPPING COMPLETE - READY TO IMPLEMENT  
**Estimated Time:** 2 hours  
**Priority:** HIGH (Diagnostic system is broken without this)

