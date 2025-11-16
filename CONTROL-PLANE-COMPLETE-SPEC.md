# CONTROL PLANE - COMPLETE SPECIFICATION
**Date:** November 16, 2025  
**Status:** FINAL - NO MORE CHANGES  
**Purpose:** Complete blueprint for all 11 missing tabs

---

## 📑 **OFFICIAL TAB MAP**

### **🧠 AiCore Control Center – 12 TOP-LEVEL TABS**
1. Variables
2. AiCore Templates
3. AiCore Live Scenarios
4. Cheat Sheet (with 11 sub-tabs)
5. Call Flow
6. AiCore Knowledgebase
7. Simulator
8. Knowledge Ingestion
9. Versioning / Releases
10. Observability (AI Metrics)
11. **LLM-0 Cortex-Intel** ⚠️ (NOT "LLM Learning Console" - that's for 3-Tier)
12. Active Instructions X-Ray

### **🧾 Cheat Sheet – 11 SUB-TABS**
1. Triage
2. Frontline-Intel
3. Transfer Calls
4. Edge Cases
5. Behavior
6. Guardrails
7. Booking Rules
8. Company Contacts
9. Links
10. Calculator
11. Active Instructions Preview

### **🏢 CompanyOps Console – 8 TABS**
1. Contacts
2. Locations
3. Appointments
4. Call Logs / History
5. Usage / Billing
6. Customer DB
7. Notifications
8. Settings

---

## 🎯 **CORE PRINCIPLES**

### **CRITICAL: Everything UI-Editable**
- ✅ LLM-0 settings → UI only
- ✅ NO hidden code or text files
- ✅ Admin/developer tweaks everything from UI
- ✅ Platform for AI agent performance optimization
- ✅ **Settings galore** - control everything

**Philosophy:** This is a platform for admins/developers to work on AI agent performance and customer experience. We need settings everywhere so they can "go to town when needed" without recoding.

---

## 📋 **11 TABS TO BUILD**

### **COMPANYOPS CONSOLE: 8 Tabs**
1. Contacts (CRUD v2Contact)
2. Locations (CRUD Location + Access Profiles)
3. Appointments (CRUD Appointment)
4. Call Logs / History (View CallTrace)
5. Usage / Billing (View UsageRecord, CompanyBillingState)
6. Customer DB (Global customer view)
7. Notifications (Configure who gets notified)
8. Settings (AI core, operating hours, telephony, risk/safety)

### **CHEAT SHEET: 5 Missing Sub-Tabs**
9. Booking Rules (Define readyToBook requirements)
10. Company Contacts (Role mapping)
11. Links (URL management)
12. Calculator (Usage & cost breakdown)
13. Active Instructions Preview (Read-only brain X-ray)

---

# COMPANYOPS CONSOLE – 8 TABS

## 1) CONTACTS

**Purpose:** CRUD over `v2Contact` per `companyId`

**Data Model:** `v2Contact` (existing)

**Core Fields (Table View):**
- name
- primaryPhone
- secondaryPhone
- email
- role (Owner / Tenant / Manager / Other)
- tags[] (VIP, DoNotCall, etc.)
- locationsCount (derived)
- lastCallAt (derived from CallTrace)

**Actions:**
- Create / edit / delete contact
- Link to Locations tab filtered by this contact
- "View calls" → opens Call Logs tab filtered by contactId

**Backend APIs:**
```
GET    /api/company/:id/contacts
POST   /api/company/:id/contacts
PUT    /api/company/:id/contacts/:contactId
DELETE /api/company/:id/contacts/:contactId
```

---

## 2) LOCATIONS

**Purpose:** Manage `Location` records with Access Profiles

**Data Model:** `Location` (Phase 1 - already built)

**Key Fields:**
- label (e.g. "Home", "Warehouse")
- fullAddress (street, unit, city, state, ZIP)
- primaryContactId (FK → v2Contact)
- **accessProfile:**
  - gateCode
  - doorCode
  - alarmCode
  - petsInfo
  - parkingNotes
  - accessNotes
  - confirmOnEveryVisit (bool)

**Actions:**
- CRUD locations
- Link to primary contact
- "View appointments here" → Appointments tab filtered by locationId

**Backend APIs:**
```
GET    /api/company/:id/locations
POST   /api/company/:id/locations
PUT    /api/company/:id/locations/:locationId
DELETE /api/company/:id/locations/:locationId
```

---

## 3) APPOINTMENTS

**Purpose:** View and manage `Appointment` records

**Data Model:** `Appointment` (Phase 1 - already built)

**Columns:**
- date, timeWindow (8–10, 10–12, etc.)
- status (Pending, Confirmed, Completed, Cancelled, No-Show)
- trade / serviceType
- contactName
- locationLabel
- source (Phone / SMS / Web / Manual)
- callId (if booked by AI)

**Actions:**
- Change status
- Edit schedule window
- Click to open Contact or Location
- Button "Open CallTrace" if callId present (opens Call Logs filtered)

**Backend APIs:**
```
GET    /api/company/:id/appointments
POST   /api/company/:id/appointments
PUT    /api/company/:id/appointments/:appointmentId
DELETE /api/company/:id/appointments/:appointmentId
PATCH  /api/company/:id/appointments/:appointmentId/status
```

---

## 4) CALL LOGS / HISTORY

**Purpose:** Inspect `CallTrace` snapshots

**Data Model:** `CallTrace` (Phase 1 - already built)

**Columns:**
- startedAt, durationSeconds
- direction (Inbound/Outbound)
- phoneNumber
- contactName (if resolved)
- intentSummary (booking / info / troubleshooting / billing / spam / wrong number)
- tierUsage (T1/T2/T3 counts or percentages)
- finalOutcome (Booked / Transferred / Message / Hung Up / Abandoned)

**Filters:**
- date range
- intent
- outcome
- tierUsage (e.g. "used Tier3")

**Detail View:**
Clicking row opens detailed CallTrace view:
- Full transcript
- FrontlineContext dump
- tierTrace
- Extracted context

**Backend APIs:**
```
GET /api/company/:id/call-traces
GET /api/company/:id/call-traces/:callId
```

---

## 5) USAGE / BILLING

**Purpose:** High-level usage and cost per company

**Data Models:** `UsageRecord`, `CompanyBillingState` (Phase 1 - already built)

**Show:**
- current billing cycle dates
- minutesUsedThisCycle
- aiCostThisCycle
- numberOfCalls
- avgCostPerCall
- **tierDistribution:** % Tier1 / Tier2 / Tier3
- overageMinutes, if any

**Actions:**
- Export CSV for current cycle
- Link "Open Calculator tab (AiCore → Cheat Sheet → Calculator)" for deeper per-tier view

**Backend APIs:**
```
GET /api/company/:id/usage
GET /api/company/:id/billing-state
GET /api/company/:id/usage/export (CSV)
```

---

## 6) CUSTOMER DB (Global Customer View)

**Purpose:** One combined view over Contacts + Locations + Appointments for ops people

**Data Sources:** `v2Contact`, `Location`, `Appointment`, `CallTrace` (aggregated)

### UI:

**Global search bar:** name / phone / email / address

**Results table** where each row = **customer entity:**

Fields:
- customerName (from v2Contact)
- primaryPhone
- email
- totalLocations
- totalAppointments
- lastAppointmentAt
- lastCallAt
- tags[]

**Click row → Customer Profile drawer/page:**

**Left column:**
- Core contact info
- Tags

**Middle:**
- Locations list with quick badges (city, "Has access profile")

**Right:**
- Recent appointments (5 latest)
- Recent calls (5 latest)

**Everything read-only here; editing kicks you out to Contacts / Locations / Appointments tabs.**

**Backend APIs:**
```
GET /api/company/:id/customers (aggregated search)
GET /api/company/:id/customers/:contactId/profile
```

---

## 7) NOTIFICATIONS

**Purpose:** Configure **who gets notified of what** for this company

**Data Model:** `v2Company.notificationSettings`

### UI:

**Top section – Global switches:**
- NotifyOnNewAppointment (bool)
- NotifyOnSameDayBooking (bool)
- NotifyOnAfterHoursCall (bool)
- NotifyOnEmergencyIntent (bool)
- NotifyOnMissedCall (bool)

**Middle – Recipient matrix**

Each row = an "event type":
- New Appointment Created
- Appointment Rescheduled
- Emergency Call Detected
- After-Hours Message Taken
- Payment Link Sent
- Customer Left Voicemail

**Columns:**
- Notify via SMS: multiselect of Contacts (pulled from `v2Contact` for this company)
- Notify via Email: multiselect of Contacts
- Internal Webhook URL: optional string

**Backend representation under `v2Company.notificationSettings`:**

```json
{
  "events": {
    "newAppointment": {
      "enabled": true,
      "smsContacts": ["<contactId1>", "<contactId2>"],
      "emailContacts": ["<contactId3>"],
      "webhookUrl": "https://zapier.com/hooks/..."
    },
    "afterHoursCall": {
      "enabled": true,
      "smsContacts": ["<contactIdOwner>"],
      "emailContacts": [],
      "webhookUrl": null
    }
  }
}
```

**This tab is the config your AI and BookingHandler read when sending SMS / email / webhooks.**

**Backend APIs:**
```
GET    /api/company/:id/notification-settings
PATCH  /api/company/:id/notification-settings
```

---

## 8) SETTINGS

**Purpose:** All high-level toggles and tech settings for the company

**Data Model:** `v2Company` → `aiAgentLogic`, `operatingHours`, `twilioConfig`

### Sections:

### **A. AI Agent Core**

- aiAgentLogic.enabled (toggle)
- aiAgentLogic.orchestratorEnabled (toggle)
- aiAgentLogic.debugOrchestrator (toggle)
- aiAgentLogic.voiceProvider (select: Google, ElevenLabs, etc.)
- aiAgentLogic.language (select: EN, ES, Bilingual)

### **B. Operating Hours**

- Weekday schedule (per-day: openTime, closeTime)
- Closed days (checkboxes)
- **After-hours behavior (enum):**
  - Take message
  - Transfer to on-call number
  - Play after-hours message and hang up

### **C. Telephony**

- Twilio incomingNumber(s)
- Twilio SID / Subaccount (masked)
- "Test Call" button (hits Twilio test function)

### **D. Risk & Safety**

- allowSameDayBooking (bool)
- allowWeekendBooking (bool)
- allowEmergencyLabel (bool) – whether AI can ever say "emergency service"

**This tab is the human-friendly wrapper around existing company config.**

**Backend APIs:**
```
GET    /api/company/:id/settings
PATCH  /api/company/:id/settings/ai-agent
PATCH  /api/company/:id/settings/operating-hours
PATCH  /api/company/:id/settings/telephony
PATCH  /api/company/:id/settings/risk-safety
```

---

# CHEAT SHEET SUB-TABS

**Already exist:** Triage, Frontline-Intel, Transfer Calls, Edge Cases, Behavior, Guardrails

**Missing:** 5 tabs specified below

---

## 9) BOOKING RULES (Cheat Sheet)

**Purpose:** Define what "readyToBook" means and how BookingHandler should behave per trade/serviceType

**Data location:** `v2Company.aiAgentLogic.bookingRules`

**Structure:** per `trade` and `serviceType`

### UI:

**Dropdowns at top:**
- Trade: HVAC / Plumbing / Electrical / etc.
- Service Type: Repair / Maintenance / Install / Emergency, etc.

**Once selected, show a config form:**

### **A. Required Fields for readyToBook:**

**Checkbox list:**
- Customer name
- Primary phone
- Email
- Location (full address)
- Problem description
- Preferred date
- Time window (e.g. 8–10, 10–12, etc.)
- Access notes
- Photo(s) received (future)

**Backend storage:**
```json
"bookingRules": {
  "HVAC": {
    "repair": {
      "requiredFields": ["name", "primaryPhone", "location", "problemDescription", "timeWindow"],
      ...
    }
  }
}
```

### **B. Time Windows & Constraints**

**Fields:**
- allowedDays: checkboxes (Mon–Sun)
- sameDayCutoffTime (e.g. 15:00)
- defaultTimeWindows: list, e.g.:
  - 8–10
  - 10–12
  - 12–2
  - 2–4
- minLeadHours (int)
- maxDaysOut (int, e.g. 30 days)

**Storage:**
```json
"timeRules": {
  "allowedDays": ["Mon","Tue","Wed","Thu","Fri"],
  "allowWeekends": false,
  "sameDayCutoffHour": 15,
  "minLeadHours": 2,
  "maxDaysOut": 30,
  "timeWindows": ["8-10", "10-12", "12-2", "2-4"]
}
```

### **C. Booking Behavior**

**Toggles:**
- autoConfirmIfSlotAvailable (bool)
- requireHumanApprovalForEmergency (bool)
- allowOverbooking (bool, default false)
- noteTemplateForTech (textarea) – boilerplate appended to `notesForTech`

### **D. LLM Hints (for LLM-0)**

**Plain text fields:**
- "How to explain schedule to customer" (short copy that goes into instructions)
- "What to say when no slot is available" (fallback script copy)

**All of this becomes part of Active Instructions so LLM-0 knows how aggressive it can be on booking and what info it must gather.**

**Backend APIs:**
```
GET    /api/company/:id/booking-rules
PATCH  /api/company/:id/booking-rules
```

---

## 10) COMPANY CONTACTS (Cheat Sheet)

**Purpose:** Quick mapping of **roles** to specific contacts for use in behavior rules, escalation, and notifications

**Data model:** `v2Company.roleContacts`, mapping **roleKey → contactId**

**Example:**
```json
"roleContacts": {
  "owner": "<contactId1>",
  "officeManager": "<contactId2>",
  "onCallTech": "<contactId3>",
  "billingContact": "<contactId4>",
  "escalationContact": "<contactId5>"
}
```

### UI:

**Top:** small description to explain this is a **role map**, not contact creation.

**Table:**

| Role            | Description                          | Linked Contact (select from v2Contact) |
| --------------- | ------------------------------------ | -------------------------------------- |
| Owner           | Business owner / main decision maker | [dropdown]                             |
| Office Manager  | Day-to-day operations                | [dropdown]                             |
| On-Call Tech    | After-hours emergency tech           | [dropdown]                             |
| Billing Contact | Billing / invoices contact           | [dropdown]                             |
| Escalation      | Who to transfer angry customers to   | [dropdown]                             |

**Allow "Add custom role":**
- roleKey (machine name)
- label
- contact selector

**These role mappings are used by:**
- Behavior rules (e.g., escalation → Escalation contact)
- Notifications (if event uses "onCallTech" role)
- After-hours transfer routing

**Backend APIs:**
```
GET    /api/company/:id/role-contacts
PATCH  /api/company/:id/role-contacts
```

---

## 11) LINKS (Cheat Sheet)

**Purpose:** Single place to store **all URLs** the AI needs to reference or send to customers

**Data model:** `v2Company.links[]`

**Each link:**
```json
{
  "key": "paymentPortal",
  "label": "Online Payment Portal",
  "url": "https://pay.penguinair.com/...",
  "description": "Used when customer wants to pay invoice online",
  "visibleToAgent": true
}
```

### UI:

**Table listing:**
- Label
- **Type (select):**
  - Website
  - Payment Portal
  - Customer Portal
  - Booking Widget
  - Financing Application
  - Terms/Privacy
  - Documentation
  - Other
- URL
- Short description
- "Allow AI to send this link via SMS/email" (bool)

**Buttons:**
- Add link
- Edit
- Delete

**Types should be implemented as a controlled enum but stored as string for flexibility.**

**LLM-0 uses these via Active Instructions:**
- "If caller asks how to pay, send `paymentPortal` link" (behavior rule can reference key)
- "If caller wants to book themselves, send `selfBooking` link"

**Backend APIs:**
```
GET    /api/company/:id/links
POST   /api/company/:id/links
PUT    /api/company/:id/links/:linkId
DELETE /api/company/:id/links/:linkId
```

---

## 12) CALCULATOR (Cheat Sheet)

**Purpose:** Per-company usage and cost breakdown for AI tuning

**Data sources:** `UsageRecord`, `CompanyBillingState`

**Shows for current company:**
- last 7/30 days usage
- Tier1/Tier2/Tier3 turn counts
- estimated cost vs plan
- cost per call

**Same numbers as CompanyOps → Usage, but framed for AI tuning:**
- "Tier3 > 10% → highlight in orange, suggest reviewing LLM Learning Console"

**Backend APIs:**
```
GET /api/company/:id/calculator-stats
```

---

## 13) ACTIVE INSTRUCTIONS PREVIEW (Cheat Sheet)

**Purpose:** Simple **read-only viewer** on top of `/api/active-instructions`

**Backend API:** `/api/active-instructions` (Phase 2 - already built)

**Dropdowns:**
- companyId
- (optional) callId

**Show:**
- Global blocks
- Trade blocks
- Company blocks
- Intent-specific blocks
- Booking rules snippet
- Guardrails excerpt

**Each block has "Open in editor" link to correct AiCore tab.**

---

## 14) LLM-0 CORTEX-INTEL (AiCore Tab)

⚠️ **CRITICAL: NOT to be confused with "LLM Learning Console" (3-Tier system)**

**Purpose:** LLM-0 Orchestrator intelligence and performance insights

**What it shows:**
- LLM-0 decision patterns per company
- Conversation quality metrics
- Guardrail trigger frequency
- Common intent flows
- Optimization recommendations
- Cost per LLM-0 call
- Average response latency
- Booking conversion rates

**Data Sources:**
- `CallTrace` (LLM-0 decisions logged in context)
- `UsageRecord` (LLM turns and costs)
- `orchestrationEngine.js` logs

**Key Metrics:**
1. **Decision Distribution:**
   - ask_question: 45%
   - answer_with_knowledge: 30%
   - collect_booking_info: 15%
   - escalate_to_human: 8%
   - no_match: 2%

2. **Guardrail Triggers:**
   - Price language detected: 12 times
   - Unverified capability claim: 3 times
   - Medical/legal topic: 0 times

3. **Booking Performance:**
   - Calls reaching readyToBook: 78%
   - Average turns to booking: 4.2
   - Booking abandonment rate: 12%

4. **Knowledge Search Usage:**
   - Calls triggering 3-Tier search: 42%
   - Average confidence score: 0.82
   - Tier distribution in knowledge searches

5. **Optimization Suggestions:**
   - "32% of 'ask_question' actions repeat similar questions → Add FAQ to KB"
   - "18% of escalations happen after guardrail trigger → Review guardrail rules"
   - "Booking abandonment spike at 'time window' step → Simplify time selection"

**UI Components:**
- Time range selector (24h, 7d, 30d)
- Company selector
- Decision flow sankey diagram
- Guardrail events timeline
- Booking funnel chart
- Top optimization cards

**Backend APIs:**
```
GET /api/company/:id/llm0-cortex/overview
GET /api/company/:id/llm0-cortex/decision-patterns
GET /api/company/:id/llm0-cortex/guardrail-events
GET /api/company/:id/llm0-cortex/booking-funnel
GET /api/company/:id/llm0-cortex/optimization-suggestions
```

**This tab is for ADMIN/DEVELOPER to optimize LLM-0 performance, NOT for learning from Tier-3 calls (that's the other LLM Learning Console).**

---

## 🔗 **DATA STORAGE LOCATIONS**

### **New Config Fields in v2Company:**

```javascript
{
  // Existing fields...
  
  // NEW: Booking Rules
  "aiAgentLogic": {
    "bookingRules": {
      "HVAC": {
        "repair": { requiredFields, timeRules, behavior, llmHints },
        "maintenance": { ... }
      },
      "Plumbing": { ... }
    }
  },
  
  // NEW: Notification Settings
  "notificationSettings": {
    "events": {
      "newAppointment": { enabled, smsContacts, emailContacts, webhookUrl },
      "afterHoursCall": { ... }
    }
  },
  
  // NEW: Role Contacts
  "roleContacts": {
    "owner": "contactId",
    "officeManager": "contactId",
    "onCallTech": "contactId",
    "billingContact": "contactId",
    "escalationContact": "contactId"
  },
  
  // NEW: Links
  "links": [
    { key, label, url, type, description, visibleToAgent }
  ]
}
```

---

## 🎯 **INTEGRATION POINTS**

### **All writes must be scoped by companyId**

### **Everything feeds into:**
1. **BookingHandler** (reads bookingRules)
2. **Notification system** (reads notificationSettings)
3. **Active Instructions loader** (aggregates all config)
4. **LLM-0 Orchestrator** (reads from Active Instructions)

---

## 📊 **IMPLEMENTATION PRIORITY**

### **Phase 1: Backend APIs** (2-3 hours)
All CRUD routes for:
- Contacts
- Locations
- Appointments
- Call Traces (read-only)
- Usage / Billing (read-only)
- Settings (PATCH)
- Booking Rules (GET/PATCH)
- Role Contacts (GET/PATCH)
- Links (CRUD)

### **Phase 2: CompanyOps Console** (10-12 hours)
Build all 8 tabs with full UI:
1. Contacts (2h)
2. Locations (2h)
3. Appointments (2h)
4. Call Logs (2h)
5. Usage / Billing (1h)
6. Customer DB (2h)
7. Notifications (1.5h)
8. Settings (1.5h)

### **Phase 3: Cheat Sheet Sub-Tabs** (4-5 hours)
Build 5 missing tabs:
1. Booking Rules (1.5h)
2. Company Contacts (30min)
3. Links (30min)
4. Calculator (1h)
5. Active Instructions Preview (1.5h)

### **Phase 4: Integration & Testing** (2 hours)
- Wire all tabs into control-plane-v2.html
- Test data flow
- Verify Active Instructions integration
- Test LLM-0 reads config correctly

---

**TOTAL ESTIMATED TIME: 18-22 hours**

**NO MORE QUESTIONS. THIS IS THE FINAL SPEC. READY TO BUILD.**

