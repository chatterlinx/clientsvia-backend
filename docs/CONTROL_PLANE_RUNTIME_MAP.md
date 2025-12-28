# Control Plane → DB → Runtime Map (V48 baseline)

This document is the **platform wiring map**: for every Control Plane tab, it shows **what UI code runs**, **what API endpoints it calls**, **what data is persisted (DB paths / collections)**, and **where runtime reads/enforces it**.

**Rule**: If it’s not visible in **Runtime Truth** (`GET /api/company/:companyId/runtime-truth`), treat it as **not guaranteed** at runtime.

---

## Top-level navigation (Control Plane V2)

Control Plane V2 tab switching is implemented directly in `public/control-plane-v2.html` via:
- `initializeTab(tabId)` → calls one of the `initX()` functions.

### Top-level tabs and their init functions

| UI Tab | Init function | Primary UI manager(s) |
|---|---|---|
| Front Desk | `initFrontDesk()` | `public/js/ai-agent-settings/FrontDeskBehaviorManager.js` |
| Flow Tree | `initFlowTree()` | inline in `control-plane-v2.html` (plus snapshot loader) |
| Dynamic Flow | `initDynamicFlow()` | **reuses** `FrontDeskBehaviorManager` to render only flows tab |
| Data & Config | `initDataConfig()` | `AiCoreTemplatesManager`, `AiCoreLiveScenariosManager`, plus inline handlers |
| Call Protection | `initCallProtection()` | `CheatSheetManager` (edge cases) |
| Transfer Calls | `initTransferCalls()` | `CheatSheetManager` (transfer rules) |
| Company Contacts | `initCompanyContacts()` | `CheatSheetManager` |
| Links | `initLinks()` | `CheatSheetManager` |
| Version History | `initVersionHistory()` | `CheatSheetManager` |
| Legacy (Full Inventory) | `initLegacy()` | inline (calls inventory endpoint) |

---

## Runtime entrypoints (what actually runs calls)

### Live call brain (voice/web/sms)
- `services/ConversationEngine.processTurn()` is the unified processing loop.
- Templates are pulled from **company-scoped** activation: `company.aiAgentSettings.templateReferences`.
  - This affects **caller text normalization** (synonyms) and **filler stripping** before downstream routing.

### Scenario selection + deterministic overrides (enterprise behavior)
- Scenario selection is mediated by:
  - `services/ScenarioEngine` (adapter)
  - `services/IntelligentRouter` (3-tier matching)
- Company-specific enable/disable + deterministic fallbacks are applied by:
  - `services/OverrideResolver`
    - Reads: `CompanyScenarioOverride`, `CompanyCategoryOverride`, `CompanyResponseDefaults`
    - Applies placeholder substitution via `CompanyPlaceholders`
    - Resolution order is deterministic (no LLM required)

### Dynamic flows (trigger → event → state → action)
- Each turn can run:
  - `services/DynamicFlowEngine.processTurn()`
- Data source:
  - `DynamicFlow` collection (company-scoped)

### Call Protection + Transfer Calls (Cheat Sheet system)
- Control Plane V2 currently uses the Cheat Sheet UI for:
  - Call Protection (edge cases)
  - Transfer Calls (transfer rules)
  - Company Contacts / Links / Version History
- Runtime execution of those rules is implemented by services under `services/cheatsheet/*` and `services/CheatSheetEngine` (compiled policy application).

---

## Truth endpoints (visibility layer)

### Runtime Truth (single JSON)
- **Endpoint**: `GET /api/company/:companyId/runtime-truth`
- **Route**: `routes/company/runtimeTruth.js`
- **Reads from**
  - `v2Company` (company core + `aiAgentSettings.*`)
  - `CompanyResponseDefaults` (company default replies)
  - `CompanyPlaceholders` (company placeholders)
  - `GlobalInstantResponseTemplate` (templates/scenarios, based on `templateReferences`)
  - `DynamicFlow` (company flows)
- **Purpose**
  - Shows what is active/configured and provides health warnings (e.g. unknown scenario types).

### Raw DB Echo (debugging save vs snapshot bugs)
- **Endpoint**: `GET /api/company/:companyId/raw`
- **Route**: `routes/company/rawCompanyData.js`
- **Purpose**: direct DB echo to compare “saved state” vs “runtime snapshot”.

### Full Inventory (prove nothing is lost)
- **Endpoint**: `GET /api/company/:companyId/full-inventory`
- **Route**: `routes/company/fullInventory.js`

---

## Tab-by-tab mapping (UI → API → DB → Runtime)

## Front Desk

### UI
- Manager: `public/js/ai-agent-settings/FrontDeskBehaviorManager.js`

### API calls (observed)
- `GET /api/admin/front-desk-behavior/:companyId` (load)
- `PATCH /api/admin/front-desk-behavior/:companyId` (save)
- `POST /api/admin/front-desk-behavior/:companyId/reset` (reset)
- `POST /api/admin/front-desk-behavior/:companyId/test-emotion` (test)
- Uses template helpers:
  - `GET /api/company/:companyId` (company metadata)
  - `GET /api/company/:companyId/dynamic-flows?includeTemplates=true` (flows list/templates)

### Backend routes
- `routes/admin/frontDeskBehavior.js`

### Persistence targets (company-scoped)
- `v2Company.aiAgentSettings.frontDeskBehavior.*` (most front desk settings)

### Runtime readers/enforcement
- `services/ConversationEngine.js` reads multiple `frontDeskBehavior.*` fields for:
  - greeting interception
  - consent gating
  - caller vocabulary translation
  - loop prevention / escalation triggers (as implemented)

---

## Dynamic Flow (tab)

### UI
- Rendered from `FrontDeskBehaviorManager.renderDynamicFlowsTab()` inside Control Plane V2.

### API
- `GET /api/company/:companyId/dynamic-flows`
- `POST /api/company/:companyId/dynamic-flows`
- `PUT /api/company/:companyId/dynamic-flows/:flowId`
- `DELETE /api/company/:companyId/dynamic-flows/:flowId`
- `POST /api/company/:companyId/dynamic-flows/:flowId/toggle`
- `POST /api/company/:companyId/dynamic-flows/from-template`

### Backend route
- `routes/company/dynamicFlows.js`

### Persistence
- `DynamicFlow` collection (company scoped by `companyId`)

### Runtime readers/enforcement
- Dynamic Flow engine reads `DynamicFlow` per company to compute triggers/actions each turn.

---

## Flow Tree (visualization)

### UI
- Inline: loads flows and renders nodes; also refreshes snapshot.

### API
- `GET /api/company/:companyId/dynamic-flows` (to draw the tree)
- `GET /api/company/:companyId/system-snapshot` (used by Flow Tree view)

### Backend routes
- `routes/company/dynamicFlows.js`
- `routes/company/systemSnapshot.js`

---

## Data & Config

### Subtab: Placeholders
- **UI**: inline in `control-plane-v2.html` (`loadPlaceholders()`)
- **API**
  - `GET /api/company/:companyId/placeholders`
  - `PUT /api/company/:companyId/placeholders`
  - `POST /api/company/:companyId/placeholders/:key`
  - `DELETE /api/company/:companyId/placeholders/:key`
- **Backend**: `routes/company/companyOverrides.js`
- **Persistence**: `CompanyPlaceholders` collection
- **Runtime**: `Runtime Truth` and response rendering substitute placeholders.

### Subtab: Default Replies
- **API**
  - `GET /api/company/:companyId/overrides/defaults`
  - `PUT /api/company/:companyId/overrides/defaults`
- **Backend**: `routes/company/companyOverrides.js`
- **Persistence**: `CompanyResponseDefaults` collection
- **Runtime**: used by config unifier/snapshot + fallback behavior.

### Subtab: Templates
- **UI manager**: `AiCoreTemplatesManager`
- **API**
  - `GET /api/company/:companyId/configuration/templates`
  - `POST /api/company/:companyId/configuration/templates`
  - `DELETE /api/company/:companyId/configuration/templates/:templateId`
  - `GET /api/admin/global-instant-responses/published` (available templates list)
- **Backend**
  - `routes/company/v2companyConfiguration.js` (company template references)
  - `routes/admin/globalInstantResponses.js` (published templates list)
- **Persistence**
  - `v2Company.aiAgentSettings.templateReferences[]`
- **Runtime**
  - Template selection affects `ConversationEngine` normalization and scenario availability.

### Subtab: Scenarios
- **UI manager**: `AiCoreLiveScenariosManager`
- **API**
  - `GET /api/company/:companyId/live-scenarios` (merged scenarios from active templates)
  - `POST /api/company/:companyId/overrides/scenarios/:scenarioId/enable`
  - `POST /api/company/:companyId/overrides/scenarios/:scenarioId/disable`
  - clone-to-company:
    - `POST /api/company/:companyId/scenarios/:templateId/:categoryId/:scenarioId/clone`
    - `POST /api/company/:companyId/categories/:templateId/:categoryId/clone`
- **Backend**
  - `routes/company/v2aiLiveScenarios.js` (live scenario view)
  - `routes/company/companyOverrides.js` (enable/disable overrides)
  - `routes/company/scopeOverrides.js` (clone global → company)
- **Persistence**
  - Enable/disable: `CompanyScenarioOverride` / `CompanyCategoryOverride`
  - Clone-to-company: writes COMPANY-scoped scenario/category into template documents (via scopeGuard helpers)

### Subtab: Execution Map
- **API**: `GET /api/company/:companyId/execution-map`
- **Backend**: `routes/company/executionMap.js`
- **Runtime**: visualization layer only (reads platform snapshot).

### Subtab: QA Dashboard
- **API** (trade knowledge / quality tooling)
  - `GET /api/trade-knowledge/templates/:templateId/quality-report`
  - golden autofill (preview/apply)
  - scenario lock endpoints
- **Backend**: under routes that serve “trade knowledge” and golden tooling (see `routes/admin/goldenAutofill.js`, `routes/v2companyConfiguration.js`, etc.)

---

## Runtime Patch (controlled writes)

### UI
- Inline in `control-plane-v2.html` (Patch Import)

### API
- `GET /api/company/:companyId/runtime-patch/schema`
- `POST /api/company/:companyId/runtime-patch?dryRun=1`
- `POST /api/company/:companyId/runtime-patch`

### Backend
- `routes/company/runtimePatch.js`

### Persistence targets (allowlisted)
Allowlist maps patch paths → storage targets across:
- `v2Company` (e.g., greeting text)
- `CompanyResponseDefaults`
- `CompanyPlaceholders`
- `DynamicFlow`
- scenario/company overrides

---

## Platform Snapshot (read-only, signed)

### API
- `GET /api/company/:companyId/platform-snapshot?scope=full|control|scenarios|runtime`
- `GET /api/company/:companyId/platform-snapshot/badge`

### Backend
- `routes/company/platformSnapshot.js`

---

## Seed Golden (onboarding accelerators)

### API
- `POST /api/company/:companyId/seed-golden`
- `POST /api/company/:companyId/seed-golden/copy-templates`

### Backend
- `routes/company/seedGolden.js`

### Persistence targets
Seeds multiple company-scoped collections/fields:
- `CompanyPlaceholders`
- `CompanyResponseDefaults`
- `v2Company.aiAgentSettings.frontDeskBehavior`
- booking config (legacy V48 booking path)
- call protection / transfers (via cheat sheet versioning)
- global dynamic flow templates (not company flows)

---

## Known gaps (what to fix next)

1) **Single booking contract**: V48 uses legacy booking config paths. If reintroducing Slot Library/Groups, it must be behind a feature flag, migrated safely, and visible in Runtime Truth.
2) **No hidden defaults**: any “default” used at runtime must be either:
   - stored in company-scoped DB, or
   - stored as a global preset/template and explicitly applied, never silently injected.
3) **One source of truth for routing**: scenarios + dynamic flows must be reconciled via Runtime Truth (the “Ferrari in 6th gear” target).


