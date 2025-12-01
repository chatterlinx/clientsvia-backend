# ClientsVia Call Center Module
## Technical Proposal for Engineering Review

**Version:** 1.0  
**Date:** December 1, 2025  
**Author:** AI Engineering Assistant  
**Status:** DRAFT - Pending Review  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Business Requirements](#2-business-requirements)
3. [System Architecture](#3-system-architecture)
4. [Data Models](#4-data-models)
5. [API Specification](#5-api-specification)
6. [Frontend Architecture](#6-frontend-architecture)
7. [Multi-Tenant Security](#7-multi-tenant-security)
8. [File Structure](#8-file-structure)
9. [Implementation Phases](#9-implementation-phases)
10. [Testing Strategy](#10-testing-strategy)
11. [Performance Considerations](#11-performance-considerations)
12. [Future Roadmap](#12-future-roadmap)
13. [Open Questions](#13-open-questions)
14. [Appendix](#14-appendix)

---

## 1. Executive Summary

### 1.1 Purpose

Build a **Call Center Module** for the ClientsVia platform that provides:
- Persistent call history logging (every call as a detailed record)
- Customer profile management (identified by phone number)
- Automatic customer recognition on incoming calls
- Historical data for AI context enrichment
- Agent/admin interface for reviewing call records and customer history

### 1.2 Key Benefits

| Benefit | Description |
|---------|-------------|
| **Customer Memory** | AI recognizes returning callers and personalizes interactions |
| **Operational Visibility** | Admins can review all calls, outcomes, and captured data |
| **Data Continuity** | Customer history persists across months/years |
| **AI Context** | LLM-0 uses customer history for smarter responses |
| **Accountability** | Full audit trail of every interaction |

### 1.3 Scope

**In Scope:**
- Call Record model and CRUD operations
- Customer Profile model and CRUD operations
- Automatic customer lookup by phone number
- Call Center HTML page with tabs (Recent Calls, Customers, Search, Analytics)
- Integration with existing LLM-0 orchestration
- Multi-tenant isolation (company-scoped)

**Out of Scope (Future Phases):**
- Real-time call monitoring dashboard
- Predictive analytics / ML models
- Outbound call tracking
- Integration with external CRMs
- Mobile app

---

## 2. Business Requirements

### 2.1 User Stories

#### US-1: Call History Logging
> As an admin, I want every incoming call to be automatically logged with full details, so I can review what happened and how the AI handled it.

**Acceptance Criteria:**
- [ ] Every call creates a CallRecord document
- [ ] Record includes: caller phone, duration, AI analysis, captured entities, outcome, transcript
- [ ] Records are company-scoped (multi-tenant)
- [ ] Records persist indefinitely

#### US-2: Customer Recognition
> As the AI agent, I want to recognize returning callers by phone number, so I can personalize the conversation with their name and history.

**Acceptance Criteria:**
- [ ] Customer lookup by phone returns profile if exists
- [ ] Profile includes: name, address, preferences, equipment, notes
- [ ] New callers automatically create a Customer profile after call
- [ ] AI receives customer context at call start

#### US-3: Customer History
> As an admin, I want to see a customer's full history (all calls, appointments, notes), so I can provide better service.

**Acceptance Criteria:**
- [ ] Customer profile shows all linked CallRecords
- [ ] Customer profile shows all linked Appointments
- [ ] Lifetime stats are calculated (total calls, lifetime value, etc.)
- [ ] Notes can be added manually by agents

#### US-4: Call Review Interface
> As an admin, I want to browse and search call records, so I can audit AI performance and find specific calls.

**Acceptance Criteria:**
- [ ] List view with pagination/infinite scroll
- [ ] Filter by date range, outcome, intent
- [ ] Search by phone number, customer name
- [ ] Click to view full call details
- [ ] Play recording (if available)
- [ ] View transcript

#### US-5: Analytics Dashboard
> As an admin, I want to see call volume trends and key metrics, so I can understand business performance.

**Acceptance Criteria:**
- [ ] Daily/weekly/monthly call counts
- [ ] Booking conversion rate
- [ ] Intent distribution chart
- [ ] Tier usage breakdown (Tier 1/2/3)

### 2.2 Non-Functional Requirements

| Requirement | Target | Notes |
|-------------|--------|-------|
| **Response Time** | < 200ms | For list queries (paginated) |
| **Data Retention** | Indefinite | Calls stored forever unless manually deleted |
| **Concurrent Users** | 50+ | Per company |
| **Data Volume** | 100K+ calls | Per company, over time |
| **Availability** | 99.9% | Same as platform SLA |

---

## 3. System Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │  Control Plane  │    │  Call Center    │    │  Notification   │         │
│  │  (Config)       │    │  (Records)      │    │  Center         │         │
│  │                 │    │                 │    │                 │         │
│  │ control-plane-  │    │ call-center.    │    │ admin-notif-    │         │
│  │ v2.html         │    │ html            │    │ center.html     │         │
│  └────────┬────────┘    └────────┬────────┘    └─────────────────┘         │
│           │                      │                                          │
│           │    ?companyId=XXX    │                                          │
│           └──────────┬───────────┘                                          │
│                      │                                                      │
└──────────────────────┼──────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API LAYER                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Express.js Router                                │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                     │   │
│  │  /api/admin/call-history/:companyId/*    → CallHistoryController   │   │
│  │  /api/admin/customers/:companyId/*       → CustomerController      │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Middleware Stack                                 │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                     │   │
│  │  1. authenticateJWT          - Verify JWT token                    │   │
│  │  2. authorizeCompanyAccess   - Verify user has company access      │   │
│  │  3. validateRequest          - Validate request body/params        │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SERVICE LAYER                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐   │
│  │ CallRecordService │    │ CustomerService   │    │ CustomerLookup    │   │
│  ├───────────────────┤    ├───────────────────┤    ├───────────────────┤   │
│  │                   │    │                   │    │                   │   │
│  │ • createCall()    │    │ • createCustomer()│    │ • lookupByPhone() │   │
│  │ • getCall()       │    │ • getCustomer()   │    │ • getOrCreate()   │   │
│  │ • listCalls()     │    │ • updateCustomer()│    │ • enrichContext() │   │
│  │ • updateCall()    │    │ • listCustomers() │    │                   │   │
│  │ • addTranscript() │    │ • addNote()       │    │                   │   │
│  │ • linkToCustomer()│    │ • linkCall()      │    │                   │   │
│  │                   │    │ • getStats()      │    │                   │   │
│  └───────────────────┘    └───────────────────┘    └───────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA LAYER                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                         MongoDB (Mongoose)                            │ │
│  ├───────────────────────────────────────────────────────────────────────┤ │
│  │                                                                       │ │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐               │ │
│  │  │ CallRecord  │───▶│  Customer   │◀───│ Appointment │               │ │
│  │  │             │    │             │    │ (existing)  │               │ │
│  │  │ companyId   │    │ companyId   │    │             │               │ │
│  │  │ callId      │    │ phone       │    │             │               │ │
│  │  │ customerId  │    │ callHistory │    │             │               │ │
│  │  └─────────────┘    └─────────────┘    └─────────────┘               │ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                         Redis (Cache)                                 │ │
│  ├───────────────────────────────────────────────────────────────────────┤ │
│  │                                                                       │ │
│  │  customer:{companyId}:{phone} → Customer profile (5 min TTL)         │ │
│  │  callstats:{companyId}:today  → Today's call count (1 hour TTL)      │ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Integration with LLM-0

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    INCOMING CALL FLOW                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Twilio webhook → v2twilio.js                                           │
│                         │                                                   │
│                         ▼                                                   │
│  2. Extract caller phone number                                            │
│                         │                                                   │
│                         ▼                                                   │
│  3. CustomerLookup.lookupByPhone(companyId, phone)                         │
│     ┌──────────────────────────────────────────────────────────────────┐   │
│     │ Returns:                                                         │   │
│     │ {                                                                │   │
│     │   found: true,                                                   │   │
│     │   customer: { name, phone, preferences, lastContact, ... },     │   │
│     │   history: { totalCalls: 8, lastService: "AC Maintenance" }     │   │
│     │ }                                                                │   │
│     └──────────────────────────────────────────────────────────────────┘   │
│                         │                                                   │
│                         ▼                                                   │
│  4. Inject into LLM-0 context                                              │
│     ┌──────────────────────────────────────────────────────────────────┐   │
│     │ FrontlineIntelEngine.runTurn({                                   │   │
│     │   companyId,                                                     │   │
│     │   callId,                                                        │   │
│     │   text: userUtterance,                                          │   │
│     │   customerContext: { ... }  ← NEW: Customer history             │   │
│     │ })                                                               │   │
│     └──────────────────────────────────────────────────────────────────┘   │
│                         │                                                   │
│                         ▼                                                   │
│  5. AI greeting is personalized                                            │
│     "Hi Sarah! Welcome back to ABC HVAC..."                                │
│                         │                                                   │
│                         ▼                                                   │
│  6. Call ends → CallRecordService.createCall(callData)                     │
│                         │                                                   │
│                         ▼                                                   │
│  7. Link to customer → CustomerService.linkCall(customerId, callId)        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Data Models

### 4.1 CallRecord Schema

```javascript
/**
 * CallRecord Model
 * 
 * Stores every incoming call as a detailed, searchable record.
 * One record per call. Linked to Customer (if identified).
 * 
 * @collection callrecords
 */
const CallRecordSchema = new mongoose.Schema({
  
  // ═══════════════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════════════
  
  /**
   * Company this call belongs to (REQUIRED for multi-tenant isolation)
   */
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'v2Company', 
    required: true, 
    index: true 
  },
  
  /**
   * Unique call identifier (internal)
   * Format: "call_{timestamp}_{random}"
   */
  callId: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  
  /**
   * Twilio's Call SID (for recording lookup, debugging)
   */
  twilioCallSid: { 
    type: String, 
    index: true 
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CALLER INFORMATION
  // ═══════════════════════════════════════════════════════════════════════
  
  caller: {
    /**
     * Caller phone number (E.164 format: +13055551234)
     */
    phone: { 
      type: String, 
      required: true, 
      index: true 
    },
    
    /**
     * Caller name (if captured or from Customer profile)
     */
    name: { type: String },
    
    /**
     * Link to Customer profile (if identified)
     */
    customerId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Customer' 
    },
    
    /**
     * Was this a returning customer?
     */
    isReturning: { 
      type: Boolean, 
      default: false 
    },
    
    /**
     * How many previous calls from this number?
     */
    previousCallCount: { 
      type: Number, 
      default: 0 
    }
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CALL METADATA
  // ═══════════════════════════════════════════════════════════════════════
  
  /**
   * Call direction
   */
  direction: { 
    type: String, 
    enum: ['inbound', 'outbound'], 
    default: 'inbound' 
  },
  
  /**
   * When the call started
   */
  startedAt: { 
    type: Date, 
    required: true, 
    index: true 
  },
  
  /**
   * When the call ended
   */
  endedAt: { type: Date },
  
  /**
   * Call duration in seconds
   */
  durationSeconds: { type: Number },
  
  // ═══════════════════════════════════════════════════════════════════════
  // AI ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════
  
  analysis: {
    /**
     * Primary intent detected by LLM-0
     * Examples: "BOOK_APPOINTMENT", "EMERGENCY", "BILLING_QUESTION"
     */
    primaryIntent: { type: String },
    
    /**
     * Confidence score for intent (0.0 - 1.0)
     */
    intentConfidence: { type: Number },
    
    /**
     * Emotion detection results
     */
    emotion: {
      primary: { type: String },     // "NEUTRAL", "FRUSTRATED", "URGENT"
      intensity: { type: Number }     // 0.0 - 1.0
    },
    
    /**
     * Which Triage Card was matched
     */
    triageCard: { type: String },
    
    /**
     * Which AiCore scenario was used
     */
    scenarioMatched: { type: String },
    
    /**
     * Which tier handled the call (1, 2, or 3)
     */
    routingTier: { type: Number },
    
    /**
     * LLM model used (if Tier 3)
     */
    llmModel: { type: String },
    
    /**
     * Estimated LLM cost for this call
     */
    llmCost: { type: Number }
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CAPTURED ENTITIES (Structured Data Extracted from Call)
  // ═══════════════════════════════════════════════════════════════════════
  
  captured: {
    // --- Personal Info ---
    name: { type: String },
    phone: { type: String },
    email: { type: String },
    
    // --- Address ---
    address: {
      street: { type: String },
      city: { type: String },
      state: { type: String },
      zip: { type: String },
      full: { type: String }
    },
    
    // --- Problem/Request ---
    problemDescription: { type: String },
    urgency: { 
      type: String, 
      enum: ['normal', 'urgent', 'emergency'] 
    },
    
    // --- Appointment Related ---
    appointment: {
      /**
       * If modifying existing appointment, reference it
       */
      existingId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Appointment' 
      },
      requestedDate: { type: Date },
      requestedTimeWindow: { type: String },
      bookedDate: { type: Date },
      bookedTimeWindow: { type: String }
    },
    
    // --- Access Instructions ---
    accessInstructions: {
      customerPresent: { type: Boolean, default: true },
      keyLocation: { type: String },
      gateCode: { type: String },
      lockboxCode: { type: String },
      alternateContact: {
        name: { type: String },
        phone: { type: String },
        relationship: { type: String }
      },
      petInfo: { type: String },
      specialNotes: { type: String }
    },
    
    // --- Flexible: Any other captured fields ---
    custom: { 
      type: Map, 
      of: mongoose.Schema.Types.Mixed 
    }
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // OUTCOME
  // ═══════════════════════════════════════════════════════════════════════
  
  outcome: {
    /**
     * How did the call end?
     */
    status: {
      type: String,
      enum: ['completed', 'transferred', 'voicemail', 'abandoned', 'spam', 'error'],
      required: true
    },
    
    /**
     * Human-readable result
     * Examples: "Appointment Booked", "Message Taken", "Transferred to Sales"
     */
    result: { type: String },
    
    /**
     * If transferred, to what number?
     */
    transferredTo: { type: String },
    
    /**
     * If appointment was created, reference it
     */
    appointmentCreated: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Appointment' 
    },
    
    /**
     * Was a message left for callback?
     */
    messageLeft: { type: Boolean },
    
    /**
     * Does this require follow-up action?
     */
    followUpRequired: { 
      type: Boolean, 
      default: false 
    },
    
    /**
     * Follow-up details
     */
    followUpNotes: { type: String }
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // ACTIONS TAKEN
  // ═══════════════════════════════════════════════════════════════════════
  
  /**
   * List of actions performed during/after the call
   */
  actions: [{
    /**
     * Action type
     */
    type: { 
      type: String,
      enum: [
        'sms_sent',
        'email_sent', 
        'appointment_created',
        'appointment_updated',
        'appointment_cancelled',
        'transfer_initiated',
        'voicemail_left',
        'customer_created',
        'customer_updated',
        'note_added',
        'technician_notified'
      ]
    },
    
    /**
     * Target of the action (phone number, email, etc.)
     */
    target: { type: String },
    
    /**
     * Action result
     */
    status: { 
      type: String, 
      enum: ['success', 'failed', 'pending'] 
    },
    
    /**
     * When the action was performed
     */
    timestamp: { 
      type: Date, 
      default: Date.now 
    },
    
    /**
     * Additional details
     */
    details: { 
      type: Map, 
      of: String 
    }
  }],
  
  // ═══════════════════════════════════════════════════════════════════════
  // TRANSCRIPT
  // ═══════════════════════════════════════════════════════════════════════
  
  /**
   * Full conversation transcript
   */
  transcript: [{
    speaker: { 
      type: String, 
      enum: ['agent', 'caller'] 
    },
    text: { type: String },
    timestamp: { type: Date },
    turnNumber: { type: Number }
  }],
  
  // ═══════════════════════════════════════════════════════════════════════
  // RECORDING
  // ═══════════════════════════════════════════════════════════════════════
  
  recording: {
    /**
     * URL to recording file (Twilio or S3)
     */
    url: { type: String },
    
    /**
     * Recording duration in seconds
     */
    duration: { type: Number },
    
    /**
     * When recording will be auto-deleted
     */
    storedUntil: { type: Date }
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // MANUAL NOTES
  // ═══════════════════════════════════════════════════════════════════════
  
  /**
   * Notes added by human agents
   */
  agentNotes: {
    text: { type: String },
    addedBy: { type: String },
    addedAt: { type: Date }
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // QUALITY / REVIEW
  // ═══════════════════════════════════════════════════════════════════════
  
  review: {
    reviewed: { type: Boolean, default: false },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    rating: { type: Number, min: 1, max: 5 },
    feedback: { type: String },
    flagged: { type: Boolean, default: false },
    flagReason: { type: String }
  }
  
}, { 
  timestamps: true,
  collection: 'callrecords'
});

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// Primary queries
CallRecordSchema.index({ companyId: 1, startedAt: -1 });           // List calls by date
CallRecordSchema.index({ companyId: 1, 'caller.phone': 1 });       // Find calls by phone
CallRecordSchema.index({ companyId: 1, 'caller.customerId': 1 });  // Find calls by customer
CallRecordSchema.index({ companyId: 1, 'outcome.status': 1 });     // Filter by outcome
CallRecordSchema.index({ companyId: 1, 'analysis.primaryIntent': 1 }); // Filter by intent
CallRecordSchema.index({ companyId: 1, 'review.flagged': 1 });     // Find flagged calls

// Text search
CallRecordSchema.index({ 
  'caller.name': 'text', 
  'captured.problemDescription': 'text',
  'agentNotes.text': 'text'
});
```

### 4.2 Customer Schema

```javascript
/**
 * Customer Model
 * 
 * Persistent customer profile identified by phone number.
 * Accumulates history over time across all calls and appointments.
 * 
 * @collection customers
 */
const CustomerSchema = new mongoose.Schema({
  
  // ═══════════════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════════════
  
  /**
   * Company this customer belongs to (REQUIRED for multi-tenant isolation)
   */
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'v2Company', 
    required: true, 
    index: true 
  },
  
  /**
   * Human-readable customer ID
   * Format: "CUST-{5-digit-number}"
   */
  customerId: { 
    type: String, 
    unique: true 
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CONTACT INFORMATION
  // ═══════════════════════════════════════════════════════════════════════
  
  /**
   * Primary phone number (used for caller ID lookup)
   * Format: E.164 (+13055551234)
   */
  phone: { 
    type: String, 
    required: true, 
    index: true 
  },
  
  /**
   * Additional phone numbers
   */
  phoneSecondary: { type: String },
  phoneMobile: { type: String },
  phoneWork: { type: String },
  
  /**
   * Email address
   */
  email: { type: String },
  
  // ═══════════════════════════════════════════════════════════════════════
  // PERSONAL INFORMATION
  // ═══════════════════════════════════════════════════════════════════════
  
  firstName: { type: String },
  lastName: { type: String },
  fullName: { type: String },
  
  /**
   * Customer type
   */
  customerType: { 
    type: String, 
    enum: ['residential', 'commercial', 'property_manager'], 
    default: 'residential' 
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // ADDRESSES (Can have multiple service locations)
  // ═══════════════════════════════════════════════════════════════════════
  
  addresses: [{
    type: { 
      type: String, 
      enum: ['home', 'work', 'rental', 'other'], 
      default: 'home' 
    },
    label: { type: String },          // "Main House", "Beach Condo"
    street: { type: String },
    unit: { type: String },
    city: { type: String },
    state: { type: String },
    zip: { type: String },
    isPrimary: { type: Boolean, default: false },
    
    // Access details for this location
    accessNotes: { type: String },     // "Gate code 1234"
    keyLocation: { type: String },     // "Under mat"
    lockboxCode: { type: String },
    petInfo: { type: String },         // "Friendly dog named Max"
    
    // Alternate contact for this location
    alternateContact: {
      name: { type: String },
      phone: { type: String },
      relationship: { type: String }   // "Neighbor", "Property Manager"
    }
  }],
  
  // ═══════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════
  
  /**
   * Customer status
   */
  status: { 
    type: String, 
    enum: ['lead', 'active', 'inactive', 'churned', 'do_not_contact'], 
    default: 'lead' 
  },
  
  /**
   * When first contacted
   */
  firstContactDate: { type: Date },
  
  /**
   * When became a paying customer (first completed service)
   */
  becameCustomerDate: { type: Date },
  
  /**
   * Most recent contact
   */
  lastContactDate: { 
    type: Date, 
    index: true 
  },
  
  /**
   * Source of this customer
   */
  source: { 
    type: String,
    enum: ['phone_call', 'website', 'referral', 'google', 'yelp', 'other']
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // STATISTICS (Auto-calculated)
  // ═══════════════════════════════════════════════════════════════════════
  
  stats: {
    totalCalls: { type: Number, default: 0 },
    totalAppointments: { type: Number, default: 0 },
    completedAppointments: { type: Number, default: 0 },
    cancelledAppointments: { type: Number, default: 0 },
    noShows: { type: Number, default: 0 },
    lifetimeValue: { type: Number, default: 0 },      // Total $ spent
    avgCallDuration: { type: Number, default: 0 },    // Seconds
    avgResponseRating: { type: Number, default: 0 }   // 1-5
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // EQUIPMENT ON FILE
  // ═══════════════════════════════════════════════════════════════════════
  
  equipment: [{
    type: { type: String },           // "AC", "Furnace", "Water Heater"
    brand: { type: String },
    model: { type: String },
    serialNumber: { type: String },
    installedDate: { type: Date },
    warrantyExpires: { type: Date },
    lastServiceDate: { type: Date },
    notes: { type: String },
    addressIndex: { type: Number }    // Which address this equipment is at
  }],
  
  // ═══════════════════════════════════════════════════════════════════════
  // PREFERENCES (Learned over time)
  // ═══════════════════════════════════════════════════════════════════════
  
  preferences: {
    preferredTimeOfDay: { 
      type: String, 
      enum: ['early_morning', 'morning', 'afternoon', 'evening', 'any'] 
    },
    preferredDays: [{ 
      type: String,
      enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    }],
    communicationMethod: { 
      type: String, 
      enum: ['call', 'text', 'email'], 
      default: 'call' 
    },
    language: { type: String, default: 'en' },
    paymentMethod: { type: String },
    specialInstructions: { type: String }
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // MANUAL NOTES
  // ═══════════════════════════════════════════════════════════════════════
  
  notes: [{
    text: { type: String },
    addedBy: { type: String },
    addedAt: { type: Date, default: Date.now },
    category: { 
      type: String,
      enum: ['general', 'service', 'billing', 'complaint', 'preference']
    }
  }],
  
  // ═══════════════════════════════════════════════════════════════════════
  // TAGS (For segmentation and filtering)
  // ═══════════════════════════════════════════════════════════════════════
  
  tags: [{ type: String }],   // ["VIP", "Maintenance Plan", "Referral"]
  
  // ═══════════════════════════════════════════════════════════════════════
  // RELATED RECORDS (Auto-linked)
  // ═══════════════════════════════════════════════════════════════════════
  
  callHistory: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'CallRecord' 
  }],
  
  appointments: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Appointment' 
  }]
  
}, { 
  timestamps: true,
  collection: 'customers'
});

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// Unique phone per company (primary lookup key)
CustomerSchema.index({ companyId: 1, phone: 1 }, { unique: true });

// Common queries
CustomerSchema.index({ companyId: 1, email: 1 });
CustomerSchema.index({ companyId: 1, lastName: 1 });
CustomerSchema.index({ companyId: 1, lastContactDate: -1 });
CustomerSchema.index({ companyId: 1, status: 1 });
CustomerSchema.index({ companyId: 1, tags: 1 });

// Text search
CustomerSchema.index({ 
  firstName: 'text', 
  lastName: 'text', 
  fullName: 'text',
  email: 'text',
  'addresses.street': 'text'
});

// ═══════════════════════════════════════════════════════════════════════════
// PRE-SAVE HOOKS
// ═══════════════════════════════════════════════════════════════════════════

CustomerSchema.pre('save', function(next) {
  // Auto-generate customerId if not set
  if (!this.customerId) {
    const randomNum = Math.floor(10000 + Math.random() * 90000);
    this.customerId = `CUST-${randomNum}`;
  }
  
  // Auto-set fullName
  if (this.firstName || this.lastName) {
    this.fullName = `${this.firstName || ''} ${this.lastName || ''}`.trim();
  }
  
  next();
});
```

---

## 5. API Specification

### 5.1 Call History Endpoints

#### GET /api/admin/call-history/:companyId

**Description:** List call records with pagination and filtering

**Authentication:** JWT required, company access validated

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `page` | number | Page number | 1 |
| `limit` | number | Records per page | 50 |
| `startDate` | ISO string | Filter: calls after this date | - |
| `endDate` | ISO string | Filter: calls before this date | - |
| `status` | string | Filter: outcome status | - |
| `intent` | string | Filter: primary intent | - |
| `phone` | string | Filter: caller phone | - |
| `customerId` | string | Filter: customer ID | - |

**Response:**

```json
{
  "success": true,
  "calls": [
    {
      "_id": "...",
      "callId": "call_1701456789_abc123",
      "caller": {
        "phone": "+13055551234",
        "name": "Sarah Johnson",
        "customerId": "...",
        "isReturning": true
      },
      "startedAt": "2025-12-01T14:30:00Z",
      "durationSeconds": 204,
      "analysis": {
        "primaryIntent": "APPOINTMENT_ACCESS_UPDATE",
        "intentConfidence": 0.94,
        "routingTier": 1
      },
      "outcome": {
        "status": "completed",
        "result": "Appointment Updated"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1247,
    "pages": 25
  }
}
```

---

#### GET /api/admin/call-history/:companyId/:callId

**Description:** Get single call record with full details

**Response:**

```json
{
  "success": true,
  "call": {
    "_id": "...",
    "callId": "call_1701456789_abc123",
    "twilioCallSid": "CA...",
    "caller": { ... },
    "startedAt": "2025-12-01T14:30:00Z",
    "endedAt": "2025-12-01T14:33:24Z",
    "durationSeconds": 204,
    "analysis": { ... },
    "captured": {
      "name": "Sarah Johnson",
      "accessInstructions": {
        "keyLocation": "Under the front door mat",
        "alternateContact": {
          "name": "Nataly",
          "phone": "+12223334444",
          "relationship": "Neighbor"
        }
      }
    },
    "outcome": { ... },
    "actions": [ ... ],
    "transcript": [ ... ],
    "recording": {
      "url": "https://...",
      "duration": 204
    }
  }
}
```

---

#### POST /api/admin/call-history/:companyId

**Description:** Create a new call record (typically called by system at call end)

**Request Body:**

```json
{
  "callId": "call_1701456789_abc123",
  "twilioCallSid": "CA...",
  "caller": {
    "phone": "+13055551234",
    "name": "Sarah Johnson"
  },
  "startedAt": "2025-12-01T14:30:00Z",
  "endedAt": "2025-12-01T14:33:24Z",
  "analysis": { ... },
  "captured": { ... },
  "outcome": { ... },
  "transcript": [ ... ]
}
```

---

#### PATCH /api/admin/call-history/:companyId/:callId

**Description:** Update call record (add notes, mark reviewed, etc.)

---

#### POST /api/admin/call-history/:companyId/:callId/note

**Description:** Add agent note to call record

---

### 5.2 Customer Endpoints

#### GET /api/admin/customers/:companyId

**Description:** List customers with pagination and filtering

---

#### GET /api/admin/customers/:companyId/:customerId

**Description:** Get single customer profile with full history

---

#### GET /api/admin/customers/:companyId/lookup/:phone

**Description:** Lookup customer by phone number (used for caller ID)

**Response:**

```json
{
  "success": true,
  "found": true,
  "customer": {
    "customerId": "CUST-00842",
    "fullName": "Sarah Johnson",
    "phone": "+13055551234",
    "addresses": [ ... ],
    "preferences": { ... },
    "stats": {
      "totalCalls": 8,
      "lifetimeValue": 1240
    },
    "lastContactDate": "2025-12-01T14:30:00Z"
  },
  "recentHistory": {
    "lastService": "AC Maintenance",
    "lastServiceDate": "2025-12-01",
    "upcomingAppointment": null
  }
}
```

---

#### POST /api/admin/customers/:companyId

**Description:** Create new customer profile

---

#### PATCH /api/admin/customers/:companyId/:customerId

**Description:** Update customer profile

---

#### POST /api/admin/customers/:companyId/:customerId/note

**Description:** Add note to customer profile

---

### 5.3 Analytics Endpoints

#### GET /api/admin/call-history/:companyId/analytics/summary

**Description:** Get call analytics summary

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `period` | string | "today", "week", "month", "year" | "week" |

**Response:**

```json
{
  "success": true,
  "period": "week",
  "summary": {
    "totalCalls": 147,
    "avgDuration": 185,
    "bookingRate": 0.34,
    "intentBreakdown": {
      "BOOK_APPOINTMENT": 67,
      "SERVICE_QUESTION": 42,
      "BILLING": 18,
      "OTHER": 20
    },
    "tierUsage": {
      "tier1": 112,
      "tier2": 28,
      "tier3": 7
    },
    "outcomeBreakdown": {
      "completed": 130,
      "transferred": 10,
      "abandoned": 7
    }
  }
}
```

---

## 6. Frontend Architecture

### 6.1 Page Structure

**File:** `public/call-center.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Call Center - ClientsVia</title>
  <link rel="stylesheet" href="/css/call-center.css">
</head>
<body>
  
  <!-- Header with company context -->
  <header id="call-center-header">
    <button onclick="goToProfile()">← Back to Profile</button>
    <h1>ClientsVia Call Center</h1>
    <div id="company-context">
      <!-- Company name loaded dynamically -->
    </div>
  </header>
  
  <!-- Main navigation tabs -->
  <nav id="call-center-nav">
    <button class="tab-btn active" data-tab="recent-calls">📞 Recent Calls</button>
    <button class="tab-btn" data-tab="customers">👥 Customers</button>
    <button class="tab-btn" data-tab="search">🔍 Search</button>
    <button class="tab-btn" data-tab="analytics">📊 Analytics</button>
  </nav>
  
  <!-- Tab content containers -->
  <main id="call-center-content">
    <div id="recent-calls-tab" class="tab-content active"></div>
    <div id="customers-tab" class="tab-content"></div>
    <div id="search-tab" class="tab-content"></div>
    <div id="analytics-tab" class="tab-content"></div>
  </main>
  
  <!-- Modal container -->
  <div id="modal-container"></div>
  
  <!-- Scripts -->
  <script src="/js/call-center/CallCenterApp.js"></script>
  <script src="/js/call-center/CallHistoryManager.js"></script>
  <script src="/js/call-center/CustomerManager.js"></script>
  <script src="/js/call-center/CallSearchManager.js"></script>
  <script src="/js/call-center/CallAnalyticsManager.js"></script>
  <script>
    // Initialize app with companyId from URL
    const companyId = new URLSearchParams(window.location.search).get('companyId');
    if (!companyId) {
      window.location.href = '/login.html';
    } else {
      window.callCenterApp = new CallCenterApp(companyId);
    }
  </script>
</body>
</html>
```

### 6.2 JavaScript Modules

```
public/js/call-center/
├── CallCenterApp.js          # Main controller, tab switching, auth
├── CallHistoryManager.js     # Call cards, infinite scroll, filters
├── CustomerManager.js        # Customer profiles, history display
├── CallSearchManager.js      # Advanced search functionality
├── CallAnalyticsManager.js   # Charts, metrics display
└── utils/
    ├── api.js                # API calls with auth headers
    ├── formatters.js         # Date, phone, duration formatting
    └── modals.js             # Modal management
```

### 6.3 Component Specifications

#### CallHistoryManager

**Responsibilities:**
- Render call cards with summary information
- Infinite scroll / pagination
- Date grouping (Today, Yesterday, This Week, etc.)
- Quick filters (status, intent)
- Click to open call detail modal

**Call Card Layout:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 📞 (305) 555-1234                                            2:34 PM       │
│ Sarah Johnson                                       ⏱️ 3m 24s | Tier 1 ✅   │
│ ───────────────────────────────────────────────────────────────────────── │
│ 🎯 Intent: Appointment Access Update                                        │
│ 📋 Key under mat, call neighbor Nataly                                     │
│ ✅ Outcome: Appointment Updated                                             │
│                                                                             │
│ [▶️ Play]  [📄 Transcript]  [👤 Customer]  [✏️ Notes]                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### CustomerManager

**Responsibilities:**
- Customer profile display with full history
- Equipment list
- Address management
- Notes section
- Stats dashboard

---

## 7. Multi-Tenant Security

### 7.1 Isolation Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MULTI-TENANT ISOLATION MODEL                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  LAYER 1: URL PARAMETER                                                     │
│  ─────────────────────────────────────────────────────────────────────────  │
│  /call-center.html?companyId=XXX                                            │
│                                                                             │
│  • No companyId → Redirect to login                                        │
│  • Frontend extracts and uses for all requests                             │
│                                                                             │
│  LAYER 2: JWT VALIDATION                                                    │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Authorization: Bearer <token>                                              │
│                                                                             │
│  • authenticateJWT middleware validates token                              │
│  • Token contains user's allowed companyIds                                │
│                                                                             │
│  LAYER 3: COMPANY ACCESS AUTHORIZATION                                      │
│  ─────────────────────────────────────────────────────────────────────────  │
│  authorizeCompanyAccess middleware                                          │
│                                                                             │
│  • Checks: user.companyIds.includes(req.params.companyId)                  │
│  • Rejects if user doesn't have access                                     │
│  • Logs unauthorized attempts                                              │
│                                                                             │
│  LAYER 4: DATABASE QUERY SCOPING                                            │
│  ─────────────────────────────────────────────────────────────────────────  │
│  CallRecord.find({ companyId: req.params.companyId, ... })                 │
│                                                                             │
│  • EVERY query includes companyId filter                                   │
│  • Compound indexes start with companyId                                   │
│  • Cannot access data from other companies                                 │
│                                                                             │
│  LAYER 5: RESPONSE SANITIZATION                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│  • Never return companyId in list responses (implied)                      │
│  • Never leak cross-company references                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Authorization Middleware

```javascript
// middleware/authorizeCompanyAccess.js

const logger = require('../utils/logger');

/**
 * Middleware to verify user has access to the requested company
 * 
 * Must be used AFTER authenticateJWT
 */
const authorizeCompanyAccess = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const user = req.user;
    
    // Validate companyId format
    if (!companyId || !companyId.match(/^[0-9a-fA-F]{24}$/)) {
      logger.warn('[AUTH] Invalid companyId format', { companyId });
      return res.status(400).json({ 
        success: false,
        error: 'Invalid company ID format' 
      });
    }
    
    // Check user has access to this company
    const userCompanies = user.companyIds || [];
    const hasAccess = userCompanies.some(id => id.toString() === companyId);
    
    if (!hasAccess) {
      logger.warn('[AUTH] Unauthorized company access attempt', {
        userId: user._id,
        userEmail: user.email,
        attemptedCompanyId: companyId,
        userCompanies: userCompanies.map(id => id.toString())
      });
      
      return res.status(403).json({ 
        success: false,
        error: 'Access denied',
        message: 'You do not have access to this company'
      });
    }
    
    // Attach companyId to request for convenience
    req.companyId = companyId;
    
    next();
    
  } catch (error) {
    logger.error('[AUTH] Company access check failed', { error: error.message });
    res.status(500).json({ 
      success: false,
      error: 'Authorization check failed' 
    });
  }
};

module.exports = authorizeCompanyAccess;
```

---

## 8. File Structure

### 8.1 Complete File Tree

```
clientsvia-backend/
├── models/
│   ├── CallRecord.js              # NEW: Call record schema
│   ├── Customer.js                # NEW: Customer profile schema
│   └── ... (existing models)
│
├── routes/admin/
│   ├── callHistory.js             # NEW: Call history CRUD
│   ├── customers.js               # NEW: Customer CRUD
│   └── ... (existing routes)
│
├── services/
│   ├── CallRecordService.js       # NEW: Call record business logic
│   ├── CustomerService.js         # NEW: Customer business logic
│   ├── CustomerLookup.js          # NEW: Phone-based customer lookup
│   └── ... (existing services)
│
├── middleware/
│   ├── authorizeCompanyAccess.js  # NEW: Company access validation
│   └── ... (existing middleware)
│
├── public/
│   ├── call-center.html           # NEW: Call center page
│   ├── css/
│   │   └── call-center.css        # NEW: Call center styles
│   └── js/
│       └── call-center/           # NEW: Call center JavaScript
│           ├── CallCenterApp.js
│           ├── CallHistoryManager.js
│           ├── CustomerManager.js
│           ├── CallSearchManager.js
│           ├── CallAnalyticsManager.js
│           └── utils/
│               ├── api.js
│               ├── formatters.js
│               └── modals.js
│
└── tests/
    ├── call-record.test.js        # NEW: Call record tests
    ├── customer.test.js           # NEW: Customer tests
    └── call-center-api.test.js    # NEW: API integration tests
```

### 8.2 Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Models | PascalCase, singular | `CallRecord.js`, `Customer.js` |
| Routes | camelCase, plural resource | `callHistory.js`, `customers.js` |
| Services | PascalCase + "Service" | `CallRecordService.js` |
| Frontend JS | PascalCase + "Manager" | `CallHistoryManager.js` |
| CSS | kebab-case | `call-center.css` |

---

## 9. Implementation Phases

### Phase 1: Foundation (Week 1)

**Goal:** Core models and basic CRUD

| Task | Est. Hours | Priority |
|------|------------|----------|
| Create `CallRecord` model with full schema | 4 | P0 |
| Create `Customer` model with full schema | 4 | P0 |
| Create `callHistory.js` routes (CRUD) | 6 | P0 |
| Create `customers.js` routes (CRUD) | 6 | P0 |
| Create `authorizeCompanyAccess` middleware | 2 | P0 |
| Write model unit tests | 4 | P0 |
| **Phase 1 Total** | **26 hours** | |

**Exit Criteria:**
- [ ] Can create/read/update call records via API
- [ ] Can create/read/update customers via API
- [ ] Multi-tenant isolation verified in tests
- [ ] All CRUD operations logged

### Phase 2: Frontend (Week 2)

**Goal:** Functional call center UI

| Task | Est. Hours | Priority |
|------|------------|----------|
| Create `call-center.html` structure | 3 | P0 |
| Create `CallCenterApp.js` main controller | 4 | P0 |
| Create `CallHistoryManager.js` with cards | 8 | P0 |
| Create `CustomerManager.js` profiles | 6 | P0 |
| Create `call-center.css` styles | 4 | P1 |
| Tab navigation and routing | 2 | P0 |
| Call detail modal | 4 | P0 |
| Customer profile modal | 4 | P0 |
| **Phase 2 Total** | **35 hours** | |

**Exit Criteria:**
- [ ] Can browse call history with pagination
- [ ] Can view call details in modal
- [ ] Can view customer profiles
- [ ] Responsive on desktop/tablet

### Phase 3: Integration (Week 3)

**Goal:** Wire into existing call flow

| Task | Est. Hours | Priority |
|------|------------|----------|
| Create `CustomerLookup.js` service | 4 | P0 |
| Integrate lookup into `v2twilio.js` call start | 4 | P0 |
| Create call record at call end | 4 | P0 |
| Auto-link call to customer | 2 | P0 |
| Pass customer context to LLM-0 | 4 | P0 |
| Integration tests | 6 | P0 |
| **Phase 3 Total** | **24 hours** | |

**Exit Criteria:**
- [ ] Customer recognized on incoming call
- [ ] Call record created automatically at call end
- [ ] Customer profile updated with new call
- [ ] AI receives customer context

### Phase 4: Search & Analytics (Week 4)

**Goal:** Advanced features

| Task | Est. Hours | Priority |
|------|------------|----------|
| Create `CallSearchManager.js` | 6 | P1 |
| Advanced filter UI | 4 | P1 |
| Create analytics API endpoints | 4 | P1 |
| Create `CallAnalyticsManager.js` | 6 | P1 |
| Basic charts (call volume, intents) | 6 | P2 |
| **Phase 4 Total** | **26 hours** | |

**Exit Criteria:**
- [ ] Can search by phone, name, date range
- [ ] Analytics summary visible
- [ ] Basic charts rendering

### Total Estimated Effort

| Phase | Hours | Timeline |
|-------|-------|----------|
| Phase 1: Foundation | 26 | Week 1 |
| Phase 2: Frontend | 35 | Week 2 |
| Phase 3: Integration | 24 | Week 3 |
| Phase 4: Search & Analytics | 26 | Week 4 |
| **Total** | **111 hours** | **4 weeks** |

---

## 10. Testing Strategy

### 10.1 Test Categories

| Category | Coverage Target | Tools |
|----------|----------------|-------|
| Unit Tests | 80%+ | Jest |
| Integration Tests | Key flows | Jest + Supertest |
| E2E Tests | Critical paths | Manual / Playwright |
| Load Tests | 100+ concurrent | Artillery |

### 10.2 Critical Test Cases

#### Multi-Tenant Isolation (P0)

```javascript
describe('Multi-Tenant Isolation', () => {
  it('should not return calls from other companies', async () => {
    // Create call for Company A
    const callA = await CallRecord.create({ 
      companyId: companyAId, 
      callId: 'call_a', 
      ... 
    });
    
    // Request calls for Company B
    const response = await request(app)
      .get(`/api/admin/call-history/${companyBId}`)
      .set('Authorization', `Bearer ${tokenForCompanyB}`);
    
    // Should NOT contain Company A's call
    expect(response.body.calls).not.toContainEqual(
      expect.objectContaining({ callId: 'call_a' })
    );
  });
  
  it('should reject access to unauthorized company', async () => {
    const response = await request(app)
      .get(`/api/admin/call-history/${companyAId}`)
      .set('Authorization', `Bearer ${tokenForCompanyB}`);
    
    expect(response.status).toBe(403);
  });
});
```

#### Customer Lookup (P0)

```javascript
describe('Customer Lookup', () => {
  it('should find existing customer by phone', async () => {
    const customer = await Customer.create({
      companyId,
      phone: '+13055551234',
      fullName: 'Sarah Johnson'
    });
    
    const result = await CustomerLookup.lookupByPhone(companyId, '+13055551234');
    
    expect(result.found).toBe(true);
    expect(result.customer.fullName).toBe('Sarah Johnson');
  });
  
  it('should not find customer from different company', async () => {
    await Customer.create({
      companyId: otherCompanyId,
      phone: '+13055551234',
      fullName: 'Other Customer'
    });
    
    const result = await CustomerLookup.lookupByPhone(companyId, '+13055551234');
    
    expect(result.found).toBe(false);
  });
});
```

---

## 11. Performance Considerations

### 11.1 Database Optimization

| Strategy | Implementation |
|----------|----------------|
| **Compound Indexes** | All indexes start with `companyId` |
| **Pagination** | Default 50 records, max 100 |
| **Projection** | List queries return summary fields only |
| **Lean Queries** | Use `.lean()` for read-only operations |

### 11.2 Caching Strategy

```javascript
// Redis cache for customer lookup (hot path)
const CACHE_TTL = 300; // 5 minutes

async function lookupByPhone(companyId, phone) {
  const cacheKey = `customer:${companyId}:${phone}`;
  
  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  
  // Query database
  const customer = await Customer.findOne({ companyId, phone }).lean();
  
  // Cache result (even if null, to prevent repeated lookups)
  await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(customer || { found: false }));
  
  return customer;
}
```

### 11.3 Scalability Targets

| Metric | Target | Notes |
|--------|--------|-------|
| List query response | < 200ms | With pagination |
| Customer lookup | < 50ms | With Redis cache |
| Call record creation | < 100ms | Async where possible |
| Concurrent users | 50+ per company | |
| Data volume | 100K+ calls per company | |

---

## 12. Future Roadmap

### Phase 5: Advanced Features (Future)

- [ ] Real-time call monitoring (WebSocket)
- [ ] Bulk operations (export, delete range)
- [ ] Recording transcription integration
- [ ] Sentiment analysis on transcripts
- [ ] Customer satisfaction surveys
- [ ] Automated follow-up reminders

### Phase 6: Mobile (Future)

- [ ] Mobile-responsive call center
- [ ] Push notifications for new calls
- [ ] Quick customer lookup mobile view

### Phase 7: Intelligence (Future)

- [ ] Predictive customer churn analysis
- [ ] Recommended actions based on history
- [ ] Auto-tagging with ML
- [ ] Voice-to-text quality improvements

---

## 13. Open Questions

### For Engineering Review

1. **Recording Storage:** Where should call recordings be stored long-term? Twilio vs S3?

2. **Data Retention Policy:** How long should call records be kept? Forever vs rolling window?

3. **PII Handling:** Do we need to encrypt certain fields (phone, address) at rest?

4. **Customer Merge:** What happens if same person calls from different numbers? Manual merge?

5. **Performance Baseline:** What's the expected call volume per company? Affects indexing strategy.

6. **Existing Appointment Model:** How should we link to the existing Appointment model? ObjectId reference or embed?

7. **Analytics Aggregation:** Pre-compute stats daily or calculate on-demand?

---

## 14. Appendix

### A. Related Documentation

- `LLM-0.md` - LLM-0 Orchestration Architecture
- `ARCHITECTURE-DEFENSE-LLM0-ORCHESTRATION.md` - LLM-0 Defense Architecture
- `NOTIFICATION_CONTRACT.md` - Notification System Contract

### B. External Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| mongoose | ^7.x | MongoDB ODM |
| redis | ^4.x | Caching |
| chart.js | ^4.x | Analytics charts |

### C. Glossary

| Term | Definition |
|------|------------|
| **Call Record** | A document representing a single phone call interaction |
| **Customer** | A persistent profile identified by phone number |
| **Tier 1/2/3** | The three levels of the AI routing engine |
| **LLM-0** | The orchestration layer (Brain-1) that routes calls |
| **Triage Card** | A routing rule in the Control Plane |

---

## Approval

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Proposing Engineer | AI Assistant | Dec 1, 2025 | ✓ |
| Reviewing Engineer | | | |
| Tech Lead | | | |
| Product Owner | | | |

---

**END OF PROPOSAL**

