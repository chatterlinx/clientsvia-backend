### Runtime Architecture (Single Source of Truth)

This document is the **authoritative** runtime wiring diagram for ClientsVia backend, as implemented in this repo.

If a behavior is not:
- **configured** in the Control Plane (DB),
- **visible** in `/api/company/:companyId/runtime-truth`,
- and **observable** in call trace logs / diagnostics,

then it is **not** considered wired.

---

### Principles (non-negotiable)

- **No hidden AI behavior**: anything that affects what the agent says/does must be **UI-controlled**, stored per-company in the database. Code defaults are safety nets only and must be labeled `DEFAULT - OVERRIDE IN UI`.
- **`/runtime-truth` is the judge**: it must reflect what runtime will actually use.
- **Determinism where it matters**: booking completion, transfers, and after-hours success must be enforced by deterministic gates (not “LLM vibes”).
- **Multi-tenant safety**: templates/scenarios are global, companies only reference/enable them; cross-tenant leakage is forbidden.

---

### Current runtime stack (voice calls)

#### Entry point: Twilio voice turn handler

- **HTTP**: `POST /api/twilio/v2-agent-respond/:companyID`
- **File**: `routes/v2twilio.js`

High-level decision tree:

```text
Twilio → /v2-agent-respond/:companyID
  ↓
CallSummaryService.startCall() (caller identity created/loaded)
  ↓
IF after-hours mode enabled
  → AfterHoursCallTurnHandler (deterministic) → TwiML
ELSE
  IF vendor-first + vendor flow enabled
    → VendorCallTurnHandler (deterministic) → TwiML
  ELSE
    → ConversationEngine.processTurn() (hybrid discovery/booking) → TwiML
```

---

### Deterministic subsystems

#### After-hours message capture (deterministic)

- **File**: `services/AfterHoursCallTurnHandler.js`
- **Gate**: `company.agentSettings.afterHoursMode === true` (checked in `routes/v2twilio.js`)

Contract source (company-scoped):
- `company.aiAgentSettings.frontDeskBehavior.afterHoursMessageContract`
  - `mode`: `inherit_booking_minimum` | `custom`
  - `requiredFieldKeys[]`: ordered built-in keys (`name`, `phone`, `address`, `problemSummary`, `preferredTime`)
  - `extraSlotIds[]`: additional booking slot IDs (collected into `afterHoursFlow.slots`)

KPI enforcement rule:
- **Success is counted only if**:
  - required contract fields exist **and**
  - caller explicitly confirms (the confirmation step completed)

#### Vendor-first classification + vendor message flow (deterministic)

- **Caller classification**: `services/CallSummaryService.js` (vendor lookup before customer creation when enabled)
- **Flow**: `services/VendorCallTurnHandler.js` (when enabled)
- **Config**: `company.aiAgentSettings.frontDeskBehavior.vendorHandling`

Goal:
- prevent vendor/supplier calls from polluting customer records
- provide bounded, deterministic “take-a-message” / transfer behavior

---

### ConversationEngine (normal hours)

- **File**: `services/ConversationEngine.js`

This is the primary “brain loop” for real calls during normal hours:
- Discovery (under V22 policy) is LLM-led
- Booking completion and contract gating are deterministic

#### Discovery: scenarios as knowledge tools

- **Retriever**: `services/LLMDiscoveryEngine.js`
- **Pool loader (canonical)**: `services/ScenarioPoolService.js`
- **Selector**: `services/HybridScenarioSelector.js`

Flow:
1. `ScenarioPoolService.getScenarioPoolForCompany(companyId)`
   - loads enabled global templates from `company.aiAgentSettings.templateReferences`
   - flattens scenarios from each template’s categories
   - applies per-company enable/disable from `aiAgentSettings.scenarioControls`
2. `HybridScenarioSelector.selectScenario(utterance, enabledScenarios, context)`
   - returns `scenario`, `confidence`, and a rich `trace` (topCandidates, selectionReason, etc.)
3. `LLMDiscoveryEngine.retrieveRelevantScenarios(...)`
   - converts the chosen scenario(s) into compact “knowledge tool” summaries for the LLM

Important:
- In V22 discovery mode, scenarios typically **do not auto-speak**; they provide grounded knowledge to the LLM (subject to consent/kill switches).

---

### Configuration sources (Control Plane)

#### Company-scoped runtime settings

Primary location for Front Desk behavior:
- `company.aiAgentSettings.frontDeskBehavior.*`

Examples:
- `conversationStyle`, `styleAcknowledgments`
- `discoveryConsent` (kill switches)
- `bookingSlots` (legacy booking slot system)
- `bookingContractV2Enabled`, `slotLibrary`, `slotGroups` (contract V2 overlay)
- `vendorHandling`, `unitOfWork`
- `afterHoursMessageContract`

#### Global scenarios (templates)

Scenario content lives in:
- `GlobalInstantResponseTemplate` (global library)

Company activates templates via:
- `company.aiAgentSettings.templateReferences[]` (enabled template IDs)

---

### Truth + proof layers (required for production QA)

#### Runtime Truth (single JSON)

- **Endpoint**: `GET /api/company/:companyId/runtime-truth`
- **File**: `routes/company/runtimeTruth.js`

Purpose:
- court-evidence snapshot of what runtime will do
- shows sources, counts, health warnings, and compiled previews

#### Scenario proof endpoints (admin)

- **Company ↔ template linkage + pool counts**:
  - `GET /api/admin/scenario-diagnostics/link-check/:companyId`
- **Scenario selection trace for an utterance**:
  - `POST /api/admin/scenario-diagnostics/trace`
  - Body: `{ "companyId": "...", "utterance": "..." }`

These endpoints are designed to prevent the two common traps:
- “templates exist but runtime loads a different provider”
- “pool totals exist but company isn’t linked / selection never happens”

---

### KPI system (operator-grade)

- **Write path**: `routes/v2twilio.js` + runtime subsystems update `CallSummary.kpi.*`
- **Read path**: `GET /api/company/:companyId/kpi/summary`
  - **File**: `routes/company/kpiSummary.js`

Enterprise rule:
- KPI calculations must be derived from persisted fields, not UI guesses.

---

### Deploy QA checklist (minimum)

Before calling anything “ready”:

- **Runtime truth loads** for the target company:
  - `/api/company/:companyId/runtime-truth` returns 200
- **Scenario linkage proof** passes:
  - `link-check` shows enabled templates with non-zero scenario counts
  - effective pool totals > 0 and enabled > 0
- **Scenario selection proof** passes:
  - `trace` returns a selected scenario for representative utterances
  - trace includes topCandidates + selectionReason
- **After-hours KPI proof** (when after-hours is enabled):
  - after-hours completion counts only after confirmation + contract satisfied
- **KPI endpoint works**:
  - `/api/company/:companyId/kpi/summary` denominators are non-null after test calls


