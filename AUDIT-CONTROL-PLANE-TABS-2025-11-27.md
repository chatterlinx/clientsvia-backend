# 🔍 CONTROL PLANE TAB AUDIT – 2025-11-27

**Objective**: Trace every Control Plane tab from UI → Backend → Runtime Agent  
**Scope**: All 12+ tabs in AiCore Control Center  
**Method**: Verify wiring, data flow, and runtime usage (no theory, just proof)

---

## 📋 EXECUTIVE SUMMARY

**Status**: IN PROGRESS  
**Tabs Audited**: 0/16  
**Critical Issues Found**: TBD  
**Orphan Tabs**: TBD  
**Single Source of Truth Confirmed**: TBD

---

## 🎯 TABS IN SCOPE

### CheatSheet Sub-Tabs (AI Behavior Config):
1. ✅ Triage
2. ⏳ Frontline-Intel
3. ⏳ Transfer Calls
4. ⏳ Edge Cases
5. ⏳ Behavior
6. ⏳ Guardrails
7. ⏳ Booking Rules
8. ⏳ Company Contacts

### CheatSheet Sub-Tabs (Reference Data):
9. ⏳ Links
10. ⏳ Calculator

### CheatSheet Sub-Tabs (Admin Tools):
11. ⏳ Version History
12. ⏳ Active Instructions Preview

### AiCore Top-Level Tabs:
13. ⏳ Variables
14. ⏳ AiCore Templates
15. ⏳ AiCore Live Scenarios
16. ⏳ Call Flow
17. ⏳ AiCore Knowledgebase
18. ⏳ Observability (AI Metrics)
19. ⏳ LLM-0 Cortex-Intel

---

## 📊 TAB AUDIT RESULTS

---

### 1. TRIAGE

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 122 (`data-cheat-target="triage"`)
- **Content Renderer**: `public/js/ai-agent-settings/CheatSheetManager.js`
  - Handled by V1 tab system (lines 292-328)
  - Content container ID: `cheatsheet-subtab-triage`
  - Renders via `ensureBaseLayout()` → `getDefaultLayoutMarkup()` (line 340+)

**Backend / DB:**
- **API Routes**:
  - GET `/api/company/:companyId/triage-cards` (load rules)
  - POST `/api/company/:companyId/triage-cards` (create rule)
  - PUT `/api/company/:companyId/triage-cards/:ruleId` (update rule)
  - DELETE `/api/company/:companyId/triage-cards/:ruleId` (delete rule)
- **Backend Route File**: `routes/company/triageCards.js`
- **Collection**: `TriageCard` model
- **Schema Path**: `models/TriageCard.js`
  - Fields: `companyId`, `name`, `description`, `keywords`, `conditions`, `action`, `serviceType`, `categorySlug`, `priority`, `enabled`, `isActive`
- **CompanyId Scoping**: ✅ YES (all queries filter by `companyId`)

**Runtime Usage:**
- **Service**: `services/TriageCardService.js`
  - `compileRules(companyId)` - Compiles active rules into executable format
  - `matchInput(userInput, compiledRules)` - Matches user input against triage rules
- **Service**: `services/FrontlineIntel.js`
  - `run(userInput, company, callerPhone)` - Calls TriageCardService
  - Line 123-170: Loads compiled triage rules from Redis or compiles fresh
  - Line 172-191: Matches input against rules
  - Line 193-215: Returns triage decision
- **Call Flow Integration**: `services/CallFlowExecutor.js`
  - **Step**: Frontline-Intel (lines 166-258)
  - **Location**: `executeFrontlineIntel()`
  - Calls `FrontlineIntel.run()` which uses triage rules
  - Triage decision affects routing:
    - `ESCALATE_TO_HUMAN` → immediate transfer
    - `TAKE_MESSAGE` → message flow
    - `END_CALL_POLITE` → hangup
    - `DIRECT_TO_3TIER` → continue to scenario matching
- **Structured Log**: `[FRONTLINE]` log (line 182-193) tracks triage action

**Active Instructions:**
- ✅ Part of compiled CheatSheet policy
- Used by: `CheatSheetRuntimeService.js` (loads from Redis cache)
- Key: `triage:compiled:${companyId}`

**Issues:**
- [ ] None found (wiring verified)

**Status**: ✅ **FULLY WIRED AND OPERATIONAL**

---

### 2. FRONTLINE-INTEL

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 123 (`data-cheat-target="frontline-intel"`)
- **Content Renderer**: `CheatSheetManager.js` (V1 tab system)
- **Content Container**: `cheatsheet-subtab-frontline-intel`

**Backend / DB:**
- **API Routes**: TBD (checking...)
- **Collection**: TBD
- **Schema**: TBD

**Runtime Usage:**
- **Service**: `services/FrontlineIntel.js`
- **Call Flow**: Called in `CallFlowExecutor.executeFrontlineIntel()`
- **Purpose**: TBD (extraction logic, intent detection, cleanup)

**Active Instructions:**
- TBD

**Issues:**
- [ ] TBD

**Status**: 🔄 **AUDITING...**

---

### 3. TRANSFER CALLS

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 124 (`data-cheat-target="transfer-calls"`)
- **Content Renderer**: `CheatSheetManager.js` (V1 tab system)
- **Content Container**: `cheatsheet-subtab-transfer-calls`

**Backend / DB:**
- **API Routes**: TBD
- **Collection**: TBD
- **Schema**: TBD

**Runtime Usage:**
- **Service**: TBD
- **Call Flow**: Used in transfer decision logic
- **Location**: TBD

**Active Instructions:**
- TBD

**Issues:**
- [ ] TBD

**Status**: 🔄 **AUDITING...**

---

### 4. EDGE CASES

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 125 (`data-cheat-target="edge-cases"`)
- **Content Renderer**: `CheatSheetManager.js` (V1 tab system)
- **Content Container**: `cheatsheet-subtab-edge-cases`

**Backend / DB:**
- **API Routes**: TBD
- **Collection**: TBD
- **Schema**: TBD

**Runtime Usage:**
- **Service**: `services/CheatSheetEngine.js`
- **Call Flow**: `CallFlowExecutor.executeScenarioMatching()` → CheatSheetEngine.apply()
- **Precedence**: HIGHEST (overrides all other rules)
- **Location**: Line 295-307 in CheatSheetEngine (edge cases processed first)

**Active Instructions:**
- TBD

**Issues:**
- [ ] TBD

**Status**: 🔄 **AUDITING...**

---

### 5. BEHAVIOR

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 126 (`data-cheat-target="behavior"`)
- **Content Renderer**: `CheatSheetManager.js` (V1 tab system)
- **Content Container**: `cheatsheet-subtab-behavior`

**Backend / DB:**
- **API Routes**: TBD
- **Collection**: TBD
- **Schema**: TBD

**Runtime Usage:**
- **Service**: `services/CheatSheetEngine.js`
- **Call Flow**: Applied after transfer rules, before guardrails
- **Location**: TBD

**Active Instructions:**
- TBD

**Issues:**
- [ ] TBD

**Status**: 🔄 **AUDITING...**

---

### 6. GUARDRAILS

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 127 (`data-cheat-target="guardrails"`)
- **Content Renderer**: `CheatSheetManager.js` (V1 tab system)
- **Content Container**: `cheatsheet-subtab-guardrails`

**Backend / DB:**
- **API Routes**: TBD
- **Collection**: TBD
- **Schema**: TBD

**Runtime Usage:**
- **Service**: `services/CheatSheetEngine.js`
- **Call Flow**: Applied LAST (lowest precedence)
- **Purpose**: Block dangerous topics, force safe responses
- **Location**: TBD

**Active Instructions:**
- TBD

**Issues:**
- [ ] TBD

**Status**: 🔄 **AUDITING...**

---

### 7. BOOKING RULES

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 128 (`data-cheat-target="booking"`)
- **Content Renderer**: `CheatSheetManager.renderBookingRules()` (lines 131-170)
- **Content Container**: `cheatsheet-v2-dynamic-content` (V2 dynamic rendering)
- **Status**: ✅ Fully implemented (removed from COMING_SOON_TABS, line 14)

**Backend / DB:**
- **API Routes**: TBD
- **Collection**: TBD
- **Schema**: TBD

**Runtime Usage:**
- **Service**: `services/BookingHandler.js` (if exists)
- **Call Flow**: TBD
- **Location**: TBD

**Active Instructions:**
- TBD

**Issues:**
- [ ] TBD

**Status**: 🔄 **AUDITING...**

---

### 8. COMPANY CONTACTS

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 129 (`data-cheat-target="company-contacts"`)
- **Content Renderer**: `CheatSheetManager.renderCompanyContacts()` (lines 172-202)
- **Content Container**: `cheatsheet-v2-dynamic-content` (V2 dynamic rendering)
- **Status**: ✅ Fully implemented (removed from COMING_SOON_TABS)

**Backend / DB:**
- **API Routes**: TBD
- **Collection**: TBD (likely subdoc under Company model)
- **Schema**: TBD

**Runtime Usage:**
- **Purpose**: Transfer numbers, SMS alert recipients, escalation contacts
- **Used By**: Transfer logic, notification system
- **Location**: TBD

**Active Instructions:**
- TBD

**Issues:**
- [ ] TBD

**Status**: 🔄 **AUDITING...**

---

### 9. LINKS

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 135 (`data-cheat-target="links"`)
- **Content Renderer**: `CheatSheetManager.renderLinks()` (lines 204-234)
- **Content Container**: `cheatsheet-v2-dynamic-content` (V2 dynamic rendering)
- **Status**: ✅ Fully implemented (removed from COMING_SOON_TABS)

**Backend / DB:**
- **API Routes**: TBD
- **Collection**: TBD
- **Schema**: TBD

**Runtime Usage:**
- **Purpose**: Reference URLs for manuals, FAQ, forms, warranty
- **Used By**: TBD (possibly knowledge lookups or unused)
- **Location**: TBD

**Active Instructions:**
- TBD

**Issues:**
- [ ] Possibly UI-only (needs verification)

**Status**: 🔄 **AUDITING...**

---

### 10. CALCULATOR

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 136 (`data-cheat-target="calculator"`)
- **Content Renderer**: `CheatSheetManager.renderCalculator()` (lines 236-266)
- **Content Container**: `cheatsheet-v2-dynamic-content` (V2 dynamic rendering)
- **Status**: ✅ Fully implemented (removed from COMING_SOON_TABS)

**Backend / DB:**
- **API Routes**: N/A (pure UI helper tool)
- **Collection**: N/A
- **Schema**: N/A

**Runtime Usage:**
- **Purpose**: Pricing/estimation helper for admins
- **Used By**: ❌ NOT used by agent runtime (UI-only tool)

**Active Instructions:**
- ❌ NOT part of active instructions (UI-only)

**Issues:**
- [ ] None (intended as UI-only tool)

**Status**: ✅ **UI-ONLY TOOL (NOT USED BY AGENT)**

---

### 11. VERSION HISTORY

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 142 (`data-cheat-target="version-history"`)
- **Content Renderer**: `CheatSheetManager.renderVersionHistory()` (lines 268-290)
- **Content Container**: `cheatsheet-v2-dynamic-content` (V2 dynamic rendering)
- **Status**: ✅ Fully implemented

**Backend / DB:**
- **API Routes**: TBD
- **Collection**: `CheatSheetVersion` (likely)
- **Schema**: TBD

**Runtime Usage:**
- **Purpose**: Manage CheatSheet config versions (create, edit, activate, rollback)
- **Used By**: Version selection dropdown
- **Active Version**: Only ONE version marked as `isActive: true` or `status: 'live'`
- **Runtime**: Agent loads ONLY the active version

**Active Instructions:**
- ✅ Critical for determining which config version is live

**Issues:**
- [ ] TBD (need to verify single active version enforcement)

**Status**: 🔄 **AUDITING...**

---

### 12. ACTIVE INSTRUCTIONS PREVIEW

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 143 (`data-cheat-target="cheat-active-instructions"`)
- **Content Renderer**: COMING SOON (line 18-21 in CHEATSHEET_COMING_SOON_TABS)
- **Status**: ❌ **NOT IMPLEMENTED** (placeholder only)

**Backend / DB:**
- **API Routes**: N/A (not built yet)
- **Collection**: N/A

**Runtime Usage:**
- **Purpose**: Show EXACT config the live agent is using
- **Expected Behavior**: 
  - Should call same API as agent runtime
  - Display active version's compiled policy
  - Show all rules (triage, edge cases, behavior, guardrails, booking)
- **Current State**: ❌ NOT FUNCTIONAL (Coming Soon placeholder)

**Active Instructions:**
- **Critical Issue**: ❌ Preview doesn't exist yet
- **Risk**: NO WAY to verify what the live agent is actually running

**Issues:**
- [x] **NOT IMPLEMENTED** (placeholder tab)
- [ ] High priority: Need to verify active config matches runtime source

**Status**: ❌ **COMING SOON (NOT FUNCTIONAL)**

---

### 13. VARIABLES

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 105 (`data-aicore-target="variables"`)
- **Content Renderer**: `public/js/ai-agent-settings/VariablesManager.js`
- **Status**: ✅ Loads immediately (only manager loaded at page load)

**Backend / DB:**
- **API Routes**: TBD
- **Collection**: TBD
- **Schema**: TBD

**Runtime Usage:**
- **Purpose**: Enterprise variable system ({{COMPANY_NAME}}, {{TECH_NAME}}, etc.)
- **Used By**: Response templates, scenario replies
- **Location**: TBD

**Active Instructions:**
- TBD

**Issues:**
- [ ] TBD

**Status**: 🔄 **AUDITING...**

---

### 14. AICORE TEMPLATES

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 106 (`data-aicore-target="templates"`)
- **Content Renderer**: `AiCoreTemplatesManager.js` (lazy-loaded)
- **Init Function**: `initTemplatesManager()` (lines 587-595)

**Backend / DB:**
- **API Routes**: TBD
- **Collection**: TBD
- **Schema**: TBD

**Runtime Usage:**
- **Purpose**: TBD (possibly legacy or overlaps with Live Scenarios)
- **Used By**: TBD
- **Location**: TBD

**Active Instructions:**
- TBD

**Issues:**
- [ ] **Possible duplication with Live Scenarios** (needs verification)

**Status**: 🔄 **AUDITING...**

---

### 15. AICORE LIVE SCENARIOS

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 107 (`data-aicore-target="live-scenarios"`)
- **Content Renderer**: `AiCoreLiveScenariosManager.js` (lazy-loaded)
- **Init Function**: `initLiveScenariosManager()` (lines 597-605)

**Backend / DB:**
- **API Routes**: TBD
- **Collection**: TBD (likely `Scenario` or `InstantResponse`)
- **Schema**: TBD

**Runtime Usage:**
- **Service**: `services/IntelligentRouter.js` (3-Tier Intelligence)
- **Call Flow**: `CallFlowExecutor.executeScenarioMatching()`
- **Location**: Line 261-343 in CallFlowExecutor
- **Purpose**: Scenario matching (Tier 1: Rule, Tier 2: Semantic, Tier 3: LLM)

**Active Instructions:**
- ✅ Core part of agent intelligence

**Issues:**
- [ ] **Possible duplication with AiCore Templates** (needs verification)

**Status**: 🔄 **AUDITING...**

---

### 16. CALL FLOW

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 109 (`data-aicore-target="call-flow"`)
- **Content Renderer**: `CallFlowManager.js` (lazy-loaded)
- **Init Function**: `initCallFlowManager()` (lines 619-627)

**Backend / DB:**
- **API Routes**: TBD
- **Collection**: Company.aiAgentSettings.callFlowConfig (likely)
- **Schema**: TBD

**Runtime Usage:**
- **Service**: `services/CallFlowExecutor.js`
- **Purpose**: Define step order and enabled flags for call flow
- **Location**: Line 36-102 in CallFlowExecutor (dynamic step execution)
- **Example Steps**: frontline-intel, scenario-matching, guardrails, behavior-polish

**Active Instructions:**
- ✅ Controls which steps are enabled and their execution order

**Issues:**
- [ ] TBD (verify UI matches runtime execution order)

**Status**: 🔄 **AUDITING...**

---

### 17. AICORE KNOWLEDGEBASE

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 110 (`data-aicore-target="knowledgebase"`)
- **Content Renderer**: `AiCoreKnowledgebaseManager.js` (lazy-loaded)
- **Init Function**: `initKnowledgebaseManager()` (lines 629-637)

**Backend / DB:**
- **API Routes**: TBD
- **Collection**: TBD
- **Schema**: TBD

**Runtime Usage:**
- **Purpose**: TBD (possibly deprecated or overlaps with scenarios)
- **Used By**: TBD
- **Location**: TBD

**Active Instructions:**
- TBD

**Issues:**
- [ ] **Possible orphan** (may not be used by current system)

**Status**: 🔄 **AUDITING...**

---

### 18. OBSERVABILITY (AI METRICS)

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 111 (`data-aicore-target="observability"`)
- **Content Renderer**: `AnalyticsManager.js` (lazy-loaded)
- **Init Function**: `initAnalyticsManager()` (lines 639-647)

**Backend / DB:**
- **API Routes**: TBD (likely analytics/metrics endpoints)
- **Collection**: TBD (possibly CallTrace, Metrics, or logs)
- **Schema**: TBD

**Runtime Usage:**
- **Purpose**: ❌ NOT used by agent (read-only dashboard)
- **Used By**: Admin monitoring only
- **Location**: N/A (observability, not runtime logic)

**Active Instructions:**
- ❌ NOT part of active instructions (monitoring tool)

**Issues:**
- [ ] None (intended as monitoring dashboard)

**Status**: ✅ **MONITORING TOOL (NOT USED BY AGENT)**

---

### 19. LLM-0 CORTEX-INTEL

**Frontend:**
- **File**: `public/control-plane-v2.html`
- **Tab Button**: Line 112 (`data-aicore-target="llm-cortex-intel"`)
- **Content Renderer**: `LlmCortexIntelManager.js` (lazy-loaded)
- **Init Function**: `initLlmCortexIntel()` (lines 649-659)

**Backend / DB:**
- **API Routes**: TBD
- **Collection**: TBD
- **Schema**: TBD

**Runtime Usage:**
- **Purpose**: TBD (Tier 3 LLM fallback config?)
- **Used By**: TBD
- **Location**: TBD

**Active Instructions:**
- TBD

**Issues:**
- [ ] TBD (verify if this affects Tier 3 routing)

**Status**: 🔄 **AUDITING...**

---

## 🚨 CRITICAL FINDINGS

### ❌ NOT IMPLEMENTED:
1. **Active Instructions Preview** - COMING SOON placeholder (no way to verify live config)

### ⚠️ NEEDS VERIFICATION:
1. **AiCore Templates vs. Live Scenarios** - Possible duplication
2. **AiCore Knowledgebase** - May be orphaned/deprecated
3. **Links tab** - May be UI-only (not used by agent)

### ✅ UI-ONLY TOOLS (NOT USED BY AGENT):
1. **Calculator** - Admin helper tool
2. **Observability** - Monitoring dashboard

---

## 📂 ORPHAN / LEGACY / UI-ONLY TABS

**Status**: TBD (completing audits)

---

## 🎯 SINGLE SOURCE OF TRUTH

**Status**: TBD (investigating...)

### Questions to Answer:
1. Where does the agent load its "active config"?
2. How is the active CheatSheet version determined?
3. Do all tabs save to the same version/collection?
4. Does Active Instructions Preview (when built) use the same source?

---

## 🔄 AUDIT STATUS

**Progress**: 3/19 tabs completed  
**Next**: Continue systematic audit of remaining tabs  
**Blockers**: None  
**ETA**: TBD

---

_Auditor: AI Coder (World-Class)_  
_Date: November 27, 2025_  
_Status: IN PROGRESS_

