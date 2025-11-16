# CONTROL PLANE - READY TO BUILD
**Date:** November 16, 2025  
**Status:** ✅ COMPLETE SPEC - START IMPLEMENTATION  
**Commits:** 6 commits ahead of origin/main

---

## 🎯 **WHAT'S READY**

### **✅ Complete Specification**
- `CONTROL-PLANE-COMPLETE-SPEC.md` (27 pages)
- Every tab defined with exact requirements
- All API endpoints specified
- All data models documented
- Integration points mapped

### **✅ Navigation Shell**
- `public/control-plane-v2.html` (working prototype)
- 3-level navigation (Main → AiCore → Cheat Sheet)
- All 12 AiCore tabs
- All 11 Cheat Sheet sub-tabs
- All 8 CompanyOps tabs
- Tab switching logic complete

### **✅ Backend Foundation (Phases 1-4)**
- FrontlineContext (Redis)
- CallTrace (MongoDB)
- CompanyOps models (Contact, Location, Appointment, UsageRecord, CompanyBillingState)
- BookingHandler
- UsageService
- Active Instructions API
- CompanyConfigLoader
- LLM-0 Orchestrator
- 3-Tier Integration (IntelligentRouter)

### **✅ Documentation**
- Phase 1-4 complete summaries
- Production hardening report
- Architecture correction documentation
- LLM systems naming clarification
- World-class code audit (A+ grade)

---

## 📑 **OFFICIAL TAB MAP (LOCKED)**

### **🧠 AiCore Control Center – 12 TABS**

| # | Tab Name | Status | Notes |
|---|----------|--------|-------|
| 1 | Variables | ⚠️ Exists (needs integration) | Existing manager |
| 2 | AiCore Templates | ⚠️ Exists (needs integration) | Existing manager |
| 3 | AiCore Live Scenarios | ⚠️ Exists (needs integration) | Existing manager |
| 4 | Cheat Sheet | ⚠️ Partial (6/11 sub-tabs) | 5 new sub-tabs needed |
| 5 | Call Flow | ❌ To build | New tab |
| 6 | AiCore Knowledgebase | ⚠️ Exists (needs integration) | Existing manager |
| 7 | Simulator | ❌ To build | New tab |
| 8 | Knowledge Ingestion | ❌ To build | New tab |
| 9 | Versioning / Releases | ❌ To build | New tab |
| 10 | Observability (AI Metrics) | ❌ To build | New tab |
| 11 | **LLM-0 Cortex-Intel** | ❌ To build | NEW (not LLM Learning Console) |
| 12 | Active Instructions X-Ray | ✅ API ready | UI needed |

### **🧾 Cheat Sheet – 11 SUB-TABS**

| # | Sub-Tab Name | Status | Notes |
|---|--------------|--------|-------|
| 1 | Triage | ⚠️ Exists (needs integration) | Existing |
| 2 | Frontline-Intel | ⚠️ Exists (needs integration) | Existing |
| 3 | Transfer Calls | ⚠️ Exists (needs integration) | Existing |
| 4 | Edge Cases | ⚠️ Exists (needs integration) | Existing |
| 5 | Behavior | ⚠️ Exists (needs integration) | Existing |
| 6 | Guardrails | ⚠️ Exists (needs integration) | Existing |
| 7 | **Booking Rules** | ❌ To build | NEW |
| 8 | **Company Contacts** | ❌ To build | NEW |
| 9 | **Links** | ❌ To build | NEW |
| 10 | **Calculator** | ❌ To build | NEW |
| 11 | **Active Instructions Preview** | ❌ To build | NEW |

### **🏢 CompanyOps Console – 8 TABS**

| # | Tab Name | Status | Backend | Frontend |
|---|----------|--------|---------|----------|
| 1 | **Contacts** | ❌ To build | Model exists | Build UI |
| 2 | **Locations** | ❌ To build | Model exists (Phase 1) | Build UI |
| 3 | **Appointments** | ❌ To build | Model exists (Phase 1) | Build UI |
| 4 | **Call Logs / History** | ❌ To build | Model exists (Phase 1) | Build UI |
| 5 | **Usage / Billing** | ❌ To build | Model exists (Phase 1) | Build UI |
| 6 | **Customer DB** | ❌ To build | Aggregation needed | Build UI |
| 7 | **Notifications** | ❌ To build | Schema needed | Build UI |
| 8 | **Settings** | ❌ To build | Partial schema | Build UI |

---

## ⚠️ **CRITICAL NAMING DISTINCTION**

### **TWO SEPARATE LLM SYSTEMS:**

1. **LLM Learning Console** (3-Tier) – EXISTING
   - Routes: `/api/admin/llm-learning/v2/*`
   - UI: `admin-llm-learning-console-v2.html`
   - Purpose: Learn from Tier 3 calls → upgrade Tier 1
   - Status: ✅ Fully built and working

2. **LLM-0 Cortex-Intel** (Orchestrator Analytics) – NEW
   - Tab: Control Plane → AiCore #11
   - Data attr: `llm-cortex-intel`
   - Purpose: Analyze LLM-0 decisions → optimize orchestrator
   - Status: ❌ To build

**Reference:** `docs/LLM-SYSTEMS-NAMING-CLARIFICATION.md`

---

## 📊 **IMPLEMENTATION ESTIMATE**

### **Phase 1: Backend APIs** (2-3 hours)
Build all missing CRUD routes:

**CompanyOps:**
- [ ] `GET/POST/PUT/DELETE /api/company/:id/contacts`
- [ ] `GET/POST/PUT/DELETE /api/company/:id/locations`
- [ ] `GET/POST/PUT/DELETE /api/company/:id/appointments`
- [ ] `PATCH /api/company/:id/appointments/:appointmentId/status`
- [ ] `GET /api/company/:id/call-traces`
- [ ] `GET /api/company/:id/call-traces/:callId`
- [ ] `GET /api/company/:id/usage`
- [ ] `GET /api/company/:id/billing-state`
- [ ] `GET /api/company/:id/usage/export` (CSV)
- [ ] `GET /api/company/:id/customers` (aggregated)
- [ ] `GET /api/company/:id/customers/:contactId/profile`
- [ ] `GET/PATCH /api/company/:id/notification-settings`
- [ ] `GET/PATCH /api/company/:id/settings/*`

**Cheat Sheet:**
- [ ] `GET/PATCH /api/company/:id/booking-rules`
- [ ] `GET/PATCH /api/company/:id/role-contacts`
- [ ] `GET/POST/PUT/DELETE /api/company/:id/links`
- [ ] `GET /api/company/:id/calculator-stats`

**LLM-0 Cortex-Intel:**
- [ ] `GET /api/company/:id/llm0-cortex/overview`
- [ ] `GET /api/company/:id/llm0-cortex/decision-patterns`
- [ ] `GET /api/company/:id/llm0-cortex/guardrail-events`
- [ ] `GET /api/company/:id/llm0-cortex/booking-funnel`
- [ ] `GET /api/company/:id/llm0-cortex/optimization-suggestions`

---

### **Phase 2: CompanyOps Console** (10-12 hours)

#### **Tab 1: Contacts** (2 hours)
- [ ] Table view with all columns
- [ ] Create contact modal
- [ ] Edit contact modal
- [ ] Delete confirmation
- [ ] Link to "View Locations"
- [ ] Link to "View Calls"
- [ ] Tags management
- [ ] Search/filter

#### **Tab 2: Locations** (2 hours)
- [ ] Table view with address + contact
- [ ] Create location modal
- [ ] Edit location modal (with access profile)
- [ ] Delete confirmation
- [ ] Access profile form:
  - Gate code
  - Door code
  - Alarm info
  - Pets info
  - Parking notes
  - Access notes
  - Confirm on every visit toggle
- [ ] Link to contact
- [ ] "View Appointments" link

#### **Tab 3: Appointments** (2 hours)
- [ ] Calendar view (day/week/month)
- [ ] Table view
- [ ] Create appointment modal
- [ ] Edit appointment modal
- [ ] Status change dropdown
- [ ] Time window selector
- [ ] Link to Contact
- [ ] Link to Location
- [ ] "Open CallTrace" button (if callId exists)
- [ ] Filters: status, date range, trade, serviceType

#### **Tab 4: Call Logs / History** (2 hours)
- [ ] Table view with all columns
- [ ] Filters:
  - Date range picker
  - Intent dropdown
  - Outcome dropdown
  - Tier3 used toggle
- [ ] Detail view modal:
  - Full transcript
  - FrontlineContext JSON viewer
  - tierTrace visualization
  - Extracted context display
- [ ] Export CSV

#### **Tab 5: Usage / Billing** (1 hour)
- [ ] Summary cards:
  - Billing cycle dates
  - Minutes used
  - AI cost
  - Number of calls
  - Avg cost per call
  - Overage minutes
- [ ] Tier distribution pie chart
- [ ] Export CSV button
- [ ] Link to Calculator tab

#### **Tab 6: Customer DB** (2 hours)
- [ ] Global search bar (name, phone, email, address)
- [ ] Results table
- [ ] Customer profile drawer:
  - Left: Contact info + tags
  - Middle: Locations list with badges
  - Right: Recent appointments (5)
  - Right: Recent calls (5)
- [ ] Links to edit in respective tabs

#### **Tab 7: Notifications** (1.5 hours)
- [ ] Global switches section
- [ ] Event matrix table:
  - Event name
  - Enabled toggle
  - SMS contacts multiselect
  - Email contacts multiselect
  - Webhook URL input
- [ ] Save button
- [ ] Test notification button

#### **Tab 8: Settings** (1.5 hours)
- [ ] AI Agent Core section:
  - Enabled toggle
  - Orchestrator enabled toggle
  - Debug orchestrator toggle
  - Voice provider select
  - Language select
- [ ] Operating Hours section:
  - Per-day time pickers
  - Closed days checkboxes
  - After-hours behavior radio
- [ ] Telephony section:
  - Incoming numbers display
  - Twilio SID (masked)
  - Test Call button
- [ ] Risk & Safety section:
  - Same-day booking toggle
  - Weekend booking toggle
  - Emergency label toggle
- [ ] Save button per section

---

### **Phase 3: Cheat Sheet Sub-Tabs** (4-5 hours)

#### **Tab 7: Booking Rules** (1.5 hours)
- [ ] Trade dropdown
- [ ] Service Type dropdown
- [ ] Required Fields section (checkboxes)
- [ ] Time Windows & Constraints section:
  - Allowed days checkboxes
  - Same-day cutoff time picker
  - Default time windows list (editable)
  - Min lead hours input
  - Max days out input
- [ ] Booking Behavior section:
  - Auto-confirm toggle
  - Require human approval toggle
  - Allow overbooking toggle
  - Notes template textarea
- [ ] LLM Hints section:
  - Schedule explanation textarea
  - No slots available textarea
- [ ] Save button

#### **Tab 8: Company Contacts** (30 minutes)
- [ ] Description text
- [ ] Role mapping table:
  - Role name
  - Description
  - Contact selector (dropdown from v2Contact)
- [ ] Add custom role button
- [ ] Save button

#### **Tab 9: Links** (30 minutes)
- [ ] Links table:
  - Label
  - Type dropdown
  - URL
  - Description
  - Visible to agent toggle
  - Actions (Edit, Delete)
- [ ] Add link button
- [ ] Edit link modal
- [ ] Save button

#### **Tab 10: Calculator** (1 hour)
- [ ] Time range selector (7d, 30d)
- [ ] Summary cards:
  - Total usage
  - Tier1/Tier2/Tier3 counts
  - Estimated cost vs plan
  - Cost per call
- [ ] Tier distribution bar chart
- [ ] Warning cards if Tier3 > 10%
- [ ] Link to LLM-0 Cortex-Intel

#### **Tab 11: Active Instructions Preview** (1.5 hours)
- [ ] Company selector dropdown
- [ ] Call ID input (optional)
- [ ] Load button
- [ ] Display sections:
  - Company info
  - Readiness
  - Config version
  - Intelligence settings
  - Variables (collapsible)
  - Filler words (collapsible)
  - Synonyms (collapsible)
  - Scenarios by category (collapsible)
  - Knowledgebase summary
  - Call context (if callId provided)
- [ ] "Open in editor" links for each block
- [ ] JSON export button

---

### **Phase 4: Integration & Testing** (2 hours)
- [ ] Wire existing managers into control-plane-v2.html
- [ ] Test data flow from UI → API → DB
- [ ] Verify Active Instructions reflects changes
- [ ] Test LLM-0 reads new config correctly
- [ ] Test booking flow with new booking rules
- [ ] Test notification system with new settings
- [ ] Cross-browser testing
- [ ] Mobile responsive testing

---

## 📦 **NEW DATA STRUCTURES IN v2Company**

```javascript
{
  // EXISTING FIELDS...
  
  // NEW: Booking Rules
  aiAgentLogic: {
    // existing fields...
    bookingRules: {
      "HVAC": {
        "repair": {
          requiredFields: ["name", "primaryPhone", "location", "problemDescription", "timeWindow"],
          timeRules: {
            allowedDays: ["Mon","Tue","Wed","Thu","Fri"],
            allowWeekends: false,
            sameDayCutoffHour: 15,
            minLeadHours: 2,
            maxDaysOut: 30,
            timeWindows: ["8-10", "10-12", "12-2", "2-4"]
          },
          behavior: {
            autoConfirmIfSlotAvailable: false,
            requireHumanApprovalForEmergency: true,
            allowOverbooking: false,
            noteTemplateForTech: "Standard HVAC repair call"
          },
          llmHints: {
            scheduleExplanationText: "We have slots available between 8-4 on weekdays",
            noSlotsAvailableText: "Our schedule is full, but we can add you to our waitlist"
          }
        }
      }
    }
  },
  
  // NEW: Notification Settings
  notificationSettings: {
    events: {
      newAppointment: {
        enabled: true,
        smsContacts: ["<contactId1>", "<contactId2>"],
        emailContacts: ["<contactId3>"],
        webhookUrl: "https://zapier.com/hooks/..."
      },
      afterHoursCall: {
        enabled: true,
        smsContacts: ["<contactIdOwner>"],
        emailContacts: [],
        webhookUrl: null
      }
      // ... more events
    }
  },
  
  // NEW: Role Contacts
  roleContacts: {
    owner: "<contactId>",
    officeManager: "<contactId>",
    onCallTech: "<contactId>",
    billingContact: "<contactId>",
    escalationContact: "<contactId>"
  },
  
  // NEW: Links
  links: [
    {
      key: "paymentPortal",
      label: "Online Payment Portal",
      url: "https://pay.example.com/...",
      type: "Payment Portal",
      description: "Used when customer wants to pay invoice online",
      visibleToAgent: true
    }
  ]
}
```

---

## 🎯 **INTEGRATION POINTS**

### **Everything feeds into:**

1. **BookingHandler** (`src/services/bookingHandler.js`)
   - Reads: `v2Company.aiAgentLogic.bookingRules`
   - Uses for: readyToBook validation, time window constraints

2. **Notification System** (to be built)
   - Reads: `v2Company.notificationSettings`
   - Uses for: SMS/email/webhook triggers

3. **Active Instructions** (`src/services/activeInstructionsService.js`)
   - Aggregates: All config from v2Company
   - Returns: Full brain X-ray for LLM-0

4. **LLM-0 Orchestrator** (`src/services/orchestrationEngine.js`)
   - Reads: Active Instructions API
   - Uses for: Decision-making, prompts, behavior

5. **3-Tier Knowledge Engine** (`services/IntelligentRouter.js`)
   - Reads: Company config, scenarios, KB
   - Returns: Factual answers for LLM-0

---

## 📋 **COMMIT HISTORY (Ready to Push)**

```
85562d3a feat: Final Control Plane HTML shell with complete 3-level navigation
4b8c4de9 docs: Add official naming standard for LLM systems
d15ad999 fix: Rename duplicate 'LLM Learning Console' to 'LLM-0 Cortex-Intel'
ab481a18 docs: Add official tab map to Control Plane spec
aebe3e2e docs: Complete Control Plane specification - ALL 11 tabs defined
774cb45e docs: Comprehensive world-class code audit - A+ (96/100)
```

**Total:** 6 commits ahead of origin/main

**To push:** `git push origin main`

---

## ✅ **ACCEPTANCE CRITERIA**

### **All 8 CompanyOps tabs must:**
- [ ] Be fully functional with CRUD operations
- [ ] Scope all operations by companyId
- [ ] Include search/filter capabilities
- [ ] Have proper error handling
- [ ] Show loading states
- [ ] Be mobile-responsive

### **All 5 new Cheat Sheet tabs must:**
- [ ] Save to v2Company correctly
- [ ] Be reflected in Active Instructions API
- [ ] Be used by LLM-0 and BookingHandler
- [ ] Have validation and error handling
- [ ] Show save confirmation

### **LLM-0 Cortex-Intel must:**
- [ ] Show decision patterns from CallTrace
- [ ] Display guardrail events
- [ ] Show booking funnel metrics
- [ ] Provide optimization suggestions
- [ ] Be clearly distinct from LLM Learning Console

### **Integration must:**
- [ ] Work end-to-end (UI → API → DB → LLM-0)
- [ ] Not break existing functionality
- [ ] Pass all integration tests
- [ ] Be production-ready

---

## 🚀 **READY TO START?**

### **Recommended Build Order:**

1. ✅ **Backend APIs first** (validates data flow)
2. ✅ **CompanyOps Console** (highest value, most complex)
3. ✅ **Cheat Sheet tabs** (extends existing section)
4. ✅ **Integration & Testing** (ensures everything works)

### **Can start immediately with:**
- Backend API routes (all specs are clear)
- CompanyOps Contacts tab (model exists, spec is detailed)
- Cheat Sheet Booking Rules tab (critical for booking flow)

---

**STATUS: EVERYTHING IS SPECIFIED. NO MORE QUESTIONS. START BUILDING.** 🎯

