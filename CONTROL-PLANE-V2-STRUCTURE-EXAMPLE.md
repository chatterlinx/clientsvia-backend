# CONTROL PLANE V2 - ENTERPRISE FILE STRUCTURE EXAMPLE

## 🎯 Purpose
This document shows the WORLD-CLASS organization standard for control-plane-v2.html.
Every section is clearly labeled, easy to find, and follows enterprise patterns.

---

## 📋 FILE HEADER TEMPLATE

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>ClientsVia Control Plane V2</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  
  <!--
  ═══════════════════════════════════════════════════════════════════════
  CONTROL PLANE V2 - AICORE CONTROL CENTER
  ═══════════════════════════════════════════════════════════════════════
  
  PURPOSE:
    Unified control interface for managing all AI Agent settings, templates,
    scenarios, and configurations for a single company.
  
  ARCHITECTURE:
    - Single-page application with tab-based navigation
    - Lazy-loads manager classes only when tabs are accessed
    - Reuses global instances to prevent duplicate state
    - All managers follow same lifecycle: init → load → render
  
  KEY SECTIONS:
    1. CSS & STYLES (inline, production-ready)
    2. HTML STRUCTURE (nav, panels, modals)
    3. JAVASCRIPT MANAGERS (init functions)
    4. EVENT HANDLERS (tab switching, actions)
    5. PAGE INITIALIZATION (DOMContentLoaded)
  
  DEPENDENCIES:
    - /js/ai-agent-settings/VariablesManager.js
    - /js/ai-agent-settings/AiCoreTemplatesManager.js
    - /js/ai-agent-settings/AiCoreLiveScenariosManager.js
    - /js/ai-agent-settings/CheatSheetManager.js
    - /js/ai-agent-settings/CallFlowManager.js
    - /js/ai-agent-settings/AiCoreKnowledgebaseManager.js
  
  INTEGRATION:
    Entry point: company-profile.html → "Open AiCore Control Center" button
    Exit point: Back button → returns to company-profile.html#ai-agent-settings
  
  MAINTAINED BY: AI Coder (Enterprise Standards)
  LAST UPDATED: 2025-11-17
  ═══════════════════════════════════════════════════════════════════════
  -->
  
  <!-- External Dependencies -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <script src="https://cdn.tailwindcss.com"></script>
  
  <style>
    /* ═══════════════════════════════════════════════════════════════════
       SECTION 1: BASE STYLES
       ═══════════════════════════════════════════════════════════════════ */
    body { 
      margin: 0; 
      font-family: system-ui, -apple-system, sans-serif; 
      background: #f3f4f6; 
      color: #111827; 
    }
    
    /* ═══════════════════════════════════════════════════════════════════
       SECTION 2: NAVIGATION STYLES (3-Level Hierarchy)
       ═══════════════════════════════════════════════════════════════════ */
    
    /* LEVEL 1: Main Tabs (Bold & Prominent) */
    .top-nav { 
      display: flex; 
      align-items: center; 
      padding: 10px 18px; 
      background: #111827; 
      color: #e5e7eb; 
    }
    .tab-btn { 
      padding: 10px 20px; 
      border-radius: 999px; 
      background: transparent; 
      color: #9ca3af; 
      font-weight: 500; 
      transition: all 0.2s; 
    }
    .tab-btn.active { 
      background: #f97316; 
      color: #111827; 
      font-weight: 700; 
    }
    
    /* LEVEL 2: AiCore Sub-nav (Medium & Clear) */
    .subnav { 
      display: flex; 
      gap: 6px; 
      padding: 8px 18px; 
      border-bottom: 2px solid #e5e7eb; 
      background: #ffffff; 
    }
    .subnav button { 
      padding: 8px 14px; 
      border-radius: 6px; 
      background: transparent; 
      color: #6b7280; 
    }
    .subnav button.active { 
      background: #eef2ff; 
      color: #4f46e5; 
      font-weight: 600; 
    }
    
    /* LEVEL 3: Cheat Sheet Sub-tabs (Minimal & Subtle) */
    .cheatsheet-subtab-btn { 
      padding: 10px 14px; 
      font-size: 13px; 
      border-bottom: 2px solid transparent; 
      color: #6b7280; 
    }
    .cheatsheet-subtab-btn.active { 
      color: #111827; 
      font-weight: 600; 
      border-bottom-color: #6366f1; 
    }
    
    /* ═══════════════════════════════════════════════════════════════════
       SECTION 3: PANEL & CONTENT STYLES
       ═══════════════════════════════════════════════════════════════════ */
    .page { padding: 18px; }
    .panel { display: none; }
    .panel.active { display: block; }
    .card { 
      background: #ffffff; 
      border-radius: 12px; 
      padding: 16px 18px; 
      box-shadow: 0 1px 2px rgba(15,23,42,0.06); 
      margin-bottom: 16px; 
    }
    
    /* ═══════════════════════════════════════════════════════════════════
       SECTION 4: UTILITY CLASSES
       ═══════════════════════════════════════════════════════════════════ */
    .hidden { display: none !important; }
    .muted { font-size: 13px; color: #6b7280; }
    .badge { 
      display: inline-flex; 
      padding: 2px 8px; 
      border-radius: 999px; 
      font-size: 11px; 
      background: #eff6ff; 
      color: #1d4ed8; 
    }
  </style>
</head>
<body>
  
  <!-- ═══════════════════════════════════════════════════════════════════
       SECTION 1: TOP NAVIGATION (Main Tabs)
       ═══════════════════════════════════════════════════════════════════ -->
  <header class="top-nav">
    <button id="back-to-profile-btn" class="btn-back" onclick="goBackToProfile()">
      <i class="fas fa-arrow-left"></i>
      <span>Back to Profile</span>
    </button>
    <div class="top-nav-title">ClientsVia Control Plane</div>
    <nav class="top-nav-tabs">
      <button class="tab-btn active js-main-tab" data-main-target="aicore">AiCore Control Center</button>
      <button class="tab-btn js-main-tab" data-main-target="companyops">CompanyOps Console</button>
      <button class="tab-btn js-main-tab" data-main-target="billing">Billing & Usage</button>
      <button class="tab-btn js-main-tab" data-main-target="intelligence">Intelligence / Observability</button>
    </nav>
  </header>

  <!-- ═══════════════════════════════════════════════════════════════════
       SECTION 2: SECONDARY NAVIGATION (AiCore Sub-tabs)
       ═══════════════════════════════════════════════════════════════════ -->
  <nav id="aicore-subnav" class="subnav">
    <button class="active js-aicore-tab" data-aicore-target="variables">Variables</button>
    <button class="js-aicore-tab" data-aicore-target="templates">AiCore Templates</button>
    <button class="js-aicore-tab" data-aicore-target="live-scenarios">AiCore Live Scenarios</button>
    <button class="js-aicore-tab" data-aicore-target="cheat-sheet">Cheat Sheet</button>
    <button class="js-aicore-tab" data-aicore-target="call-flow">Call Flow</button>
    <button class="js-aicore-tab" data-aicore-target="knowledgebase">AiCore Knowledgebase</button>
  </nav>

  <!-- ═══════════════════════════════════════════════════════════════════
       SECTION 3: TERTIARY NAVIGATION (Cheat Sheet Sub-tabs)
       Only visible when Cheat Sheet tab is active
       ═══════════════════════════════════════════════════════════════════ -->
  <nav id="cheat-subnav" class="subnav" style="display:none;">
    <button class="active js-cheat-tab cheatsheet-subtab-btn" data-cheat-target="triage">Triage</button>
    <button class="js-cheat-tab cheatsheet-subtab-btn" data-cheat-target="frontline-intel">Frontline-Intel</button>
    <button class="js-cheat-tab cheatsheet-subtab-btn" data-cheat-target="transfer-calls">Transfer Calls</button>
    <button class="js-cheat-tab cheatsheet-subtab-btn" data-cheat-target="edge-cases">Edge Cases</button>
    <button class="js-cheat-tab cheatsheet-subtab-btn" data-cheat-target="behavior">Behavior</button>
    <button class="js-cheat-tab cheatsheet-subtab-btn" data-cheat-target="guardrails">Guardrails</button>
    <button class="js-cheat-tab cheatsheet-subtab-btn" data-cheat-target="booking">Booking Rules</button>
  </nav>

  <!-- ═══════════════════════════════════════════════════════════════════
       SECTION 4: MAIN CONTENT AREA
       ═══════════════════════════════════════════════════════════════════ -->
  <main class="page">
    
    <!-- AICORE CONTROL CENTER PANELS -->
    <div id="panel-aicore" class="panel active" data-main-panel="aicore">
      
      <!-- Variables Container (loaded by VariablesManager.js) -->
      <div id="variables-container" class="panel" data-aicore-panel="variables" style="display:block;">
        <!-- VariablesManager renders here -->
      </div>
      
      <!-- Templates Container (loaded by AiCoreTemplatesManager.js) -->
      <div id="templates-container" class="panel" data-aicore-panel="templates">
        <!-- AiCoreTemplatesManager renders here -->
      </div>
      
      <!-- Live Scenarios Container (loaded by AiCoreLiveScenariosManager.js) -->
      <div id="live-scenarios-container" class="panel" data-aicore-panel="live-scenarios">
        <!-- AiCoreLiveScenariosManager renders here -->
      </div>
      
      <!-- Cheat Sheet Container (loaded by CheatSheetManager.js) -->
      <div id="cheatsheet-container" class="panel" data-aicore-panel="cheat-sheet">
        <!-- CheatSheetManager renders here -->
      </div>
      
      <!-- Call Flow Container (loaded by CallFlowManager.js) -->
      <div id="call-flow-container" class="panel" data-aicore-panel="call-flow">
        <!-- CallFlowManager renders here -->
      </div>
      
      <!-- Knowledgebase Container (loaded by AiCoreKnowledgebaseManager.js) -->
      <div id="knowledgebase-container" class="panel" data-aicore-panel="knowledgebase">
        <!-- AiCoreKnowledgebaseManager renders here -->
      </div>
      
    </div>
    
    <!-- COMPANYOPS CONSOLE PANELS -->
    <div id="panel-companyops" class="panel" data-main-panel="companyops">
      <!-- CompanyOps content here -->
    </div>
    
    <!-- BILLING & USAGE PANELS -->
    <div id="panel-billing" class="panel" data-main-panel="billing">
      <!-- Billing content here -->
    </div>
    
    <!-- INTELLIGENCE / OBSERVABILITY PANELS -->
    <div id="panel-intelligence" class="panel" data-main-panel="intelligence">
      <!-- Intelligence content here -->
    </div>
    
  </main>

  <!-- ═══════════════════════════════════════════════════════════════════
       SECTION 5: MANAGER CLASS DEPENDENCIES
       Load in specific order to prevent race conditions
       ═══════════════════════════════════════════════════════════════════ -->
  <script src="/js/ai-agent-settings/VariablesManager.js?v=8.0.0"></script>
  <script src="/js/ai-agent-settings/AiCoreTemplatesManager.js"></script>
  <script src="/js/ai-agent-settings/AiCoreLiveScenariosManager.js?v=1.2"></script>
  <script src="/js/ai-agent-settings/CheatSheetManager.js?v=1.0"></script>
  <script src="/js/ai-agent-settings/CallFlowManager.js?v=1.0"></script>
  <script src="/js/ai-agent-settings/AiCoreKnowledgebaseManager.js?v=1.1"></script>

  <script>
    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 6: GLOBAL STATE & CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════
    
    let currentCompanyId = new URLSearchParams(window.location.search).get('companyId') || null;
    const API_BASE = '';
    let authToken = localStorage.getItem('adminToken');
    
    // Global manager instances (initialized lazily on tab access)
    window.variablesManager = null;
    window.aiCoreTemplatesManager = null;
    window.aiCoreLiveScenariosManager = null;
    window.cheatSheetManager = null;  // Auto-created by CheatSheetManager.js
    window.callFlowManager = null;
    window.aiCoreKnowledgebaseManager = null;
    
    // Mock parent interface for manager compatibility
    const mockParent = {
      companyId: currentCompanyId,
      showSuccess: (msg) => { console.log('✅', msg); alert('✅ ' + msg); },
      showError: (msg) => { console.error('❌', msg); alert('❌ ' + msg); },
      showInfo: (msg) => { console.log('ℹ️', msg); alert('ℹ️ ' + msg); }
    };
    
    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 7: NAVIGATION HANDLERS
    // ═══════════════════════════════════════════════════════════════════════
    
    function goBackToProfile() {
      if (currentCompanyId) {
        window.location.href = `/company-profile.html?id=${currentCompanyId}#ai-agent-settings`;
      } else {
        alert('No company ID found.');
        window.location.href = '/admin-directory.html';
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 8: MANAGER INITIALIZATION FUNCTIONS
    // Each manager is lazy-loaded when its tab is first accessed
    // ═══════════════════════════════════════════════════════════════════════
    
    function initVariablesManager() {
      if (!currentCompanyId) {
        alert('No companyId provided in URL.');
        return;
      }
      if (!window.variablesManager) {
        console.log('🎯 [CONTROL PLANE] Initializing VariablesManager');
        window.variablesManager = new window.VariablesManager(mockParent);
        window.variablesManager.load();
      }
    }
    
    function initTemplatesManager() {
      if (!currentCompanyId) return;
      if (!window.aiCoreTemplatesManager) {
        console.log('🎯 [CONTROL PLANE] Initializing AiCoreTemplatesManager');
        window.aiCoreTemplatesManager = new window.AiCoreTemplatesManager(mockParent);
        window.aiCoreTemplatesManager.load();
      }
    }
    
    function initLiveScenariosManager() {
      if (!currentCompanyId) return;
      if (!window.aiCoreLiveScenariosManager) {
        console.log('🎯 [CONTROL PLANE] Initializing AiCoreLiveScenariosManager');
        window.aiCoreLiveScenariosManager = new window.AiCoreLiveScenariosManager(mockParent);
        window.aiCoreLiveScenariosManager.load();
      }
    }
    
    function initCheatSheetManager() {
      if (!currentCompanyId) return;
      // Use existing global instance created by CheatSheetManager.js
      if (window.cheatSheetManager) {
        if (window.cheatSheetManager.companyId !== currentCompanyId) {
          console.log('🎯 [CONTROL PLANE] Loading CheatSheetManager for company:', currentCompanyId);
          window.cheatSheetManager.load(currentCompanyId);
        } else {
          console.log('🎯 [CONTROL PLANE] CheatSheetManager already loaded');
        }
      } else {
        console.error('🎯 [CONTROL PLANE] CheatSheetManager global instance not found!');
      }
    }
    
    function initCallFlowManager() {
      if (!currentCompanyId) return;
      // Use existing global instance created by CallFlowManager.js
      if (window.callFlowManager) {
        if (window.callFlowManager.companyId !== currentCompanyId) {
          console.log('🎯 [CONTROL PLANE] Loading CallFlowManager for company:', currentCompanyId);
          window.callFlowManager.load(currentCompanyId);
        } else {
          console.log('🎯 [CONTROL PLANE] CallFlowManager already loaded');
        }
      }
    }
    
    function initKnowledgebaseManager() {
      if (!currentCompanyId) return;
      if (!window.aiCoreKnowledgebaseManager) {
        console.log('🎯 [CONTROL PLANE] Initializing AiCoreKnowledgebaseManager');
        window.aiCoreKnowledgebaseManager = new window.AiCoreKnowledgebaseManager(mockParent);
        window.aiCoreKnowledgebaseManager.load();
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 9: TAB SWITCHING LOGIC
    // ═══════════════════════════════════════════════════════════════════════
    
    // LEVEL 1: Main Tab Switching (AiCore, CompanyOps, Billing, Intelligence)
    const mainTabButtons = document.querySelectorAll('.js-main-tab');
    const mainPanels = document.querySelectorAll('[data-main-panel]');
    
    mainTabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-main-target');
        
        // Update active button
        mainTabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Show target panel
        mainPanels.forEach(panel => {
          panel.classList.toggle('active', panel.getAttribute('data-main-panel') === target);
        });
        
        // Show/hide AiCore subnav
        document.getElementById('aicore-subnav').style.display = target === 'aicore' ? 'flex' : 'none';
        document.getElementById('cheat-subnav').style.display = 'none';
      });
    });
    
    // LEVEL 2: AiCore Sub-tab Switching (Variables, Templates, etc.)
    const aicoreTabButtons = document.querySelectorAll('.js-aicore-tab');
    const aicorePanels = document.querySelectorAll('[data-aicore-panel]');
    let loadedManagers = {}; // Track which managers have been initialized
    
    aicoreTabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-aicore-target');
        
        // Update active button
        aicoreTabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Show target panel
        aicorePanels.forEach(panel => {
          const panelTarget = panel.getAttribute('data-aicore-panel');
          if (panelTarget === target) {
            panel.style.display = 'block';
          } else {
            panel.style.display = 'none';
          }
        });
        
        // Show/hide Cheat Sheet subnav
        document.getElementById('cheat-subnav').style.display = target === 'cheat-sheet' ? 'flex' : 'none';
        
        // Lazy-load managers on first access
        if (target === 'variables' && !loadedManagers.variables) {
          initVariablesManager();
          loadedManagers.variables = true;
        } else if (target === 'templates' && !loadedManagers.templates) {
          initTemplatesManager();
          loadedManagers.templates = true;
        } else if (target === 'live-scenarios' && !loadedManagers.liveScenarios) {
          initLiveScenariosManager();
          loadedManagers.liveScenarios = true;
        } else if (target === 'cheat-sheet' && !loadedManagers.cheatSheet) {
          initCheatSheetManager();
          loadedManagers.cheatSheet = true;
        } else if (target === 'call-flow' && !loadedManagers.callFlow) {
          initCallFlowManager();
          loadedManagers.callFlow = true;
        } else if (target === 'knowledgebase' && !loadedManagers.knowledgebase) {
          initKnowledgebaseManager();
          loadedManagers.knowledgebase = true;
        }
      });
    });
    
    // LEVEL 3: Cheat Sheet Sub-tab Switching (Triage, Transfer, etc.)
    const cheatTabButtons = document.querySelectorAll('.js-cheat-tab');
    const cheatTabsHandledByManager = new Set([
      'triage','frontline-intel','transfer-calls','edge-cases','behavior','guardrails',
      'booking','company-contacts','links','calculator','cheat-active-instructions'
    ]);
    
    cheatTabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-cheat-target');
        
        // Update active button
        cheatTabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Delegate to CheatSheetManager
        initCheatSheetManager();
        if (window.cheatSheetManager && typeof window.cheatSheetManager.switchSubTab === 'function') {
          window.cheatSheetManager.switchSubTab(target);
        }
      });
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 10: PAGE INITIALIZATION
    // Auto-initialize default tab when page loads
    // ═══════════════════════════════════════════════════════════════════════
    
    document.addEventListener('DOMContentLoaded', () => {
      console.log('🎯 [CONTROL PLANE] Page loaded for company:', currentCompanyId);
      
      // Auto-initialize Variables tab (default view)
      if (currentCompanyId) {
        console.log('🎯 [CONTROL PLANE] Variables tab is active on page load - auto-initializing');
        initVariablesManager();
        loadedManagers.variables = true;
      }
    });
    
  </script>
</body>
</html>
```

---

## ✅ KEY FEATURES OF THIS STRUCTURE

### 1. **Clear File Header**
- Purpose statement
- Architecture overview
- Dependencies list
- Integration points
- Maintained by info

### 2. **Numbered Sections**
Every section has:
- Clear header with `═══` borders
- Purpose description
- Easy to find with Ctrl+F

### 3. **Logical Flow**
```
1. Styles
2. HTML (Navigation)
3. HTML (Content)
4. HTML (Modals)
5. Script Dependencies
6. Global State
7. Navigation Handlers
8. Manager Initialization
9. Tab Switching Logic
10. Page Initialization
```

### 4. **Self-Documenting**
- Comments explain WHY, not just WHAT
- Data attributes clearly named
- Functions grouped by purpose
- No mystery code

### 5. **Easy Debugging**
- Console logs with emoji markers
- Clear state tracking
- Lazy-loading prevents race conditions
- Each manager can be tested independently

---

## 🎯 NEXT STEPS

Marc, should I:
1. **Apply this structure to the actual control-plane-v2.html** (refactor current file)?
2. **Keep as reference** and apply to new features as we build?
3. **Both** - refactor now + use as template going forward?

