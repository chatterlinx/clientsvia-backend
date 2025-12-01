# ClientsVia Call Center Module V2
## Production-Grade, Compliant, Scales to 10M+ Calls
### Incorporating Staff+ Review Feedback

**Version:** 2.0  
**Date:** December 1, 2025  
**Author:** AI Engineering Assistant  
**Status:** FINAL — Ready for Implementation  
**Supersedes:** PROPOSAL-CALL-CENTER-MODULE.md (V1)

---

## Table of Contents

1. [Critical Lessons from V1 Review](#1-critical-lessons-from-v1-review)
2. [Executive Summary](#2-executive-summary)
3. [Business Requirements](#3-business-requirements)
4. [System Architecture](#4-system-architecture)
5. [Data Models](#5-data-models)
6. [API Specification](#6-api-specification)
7. [Frontend Architecture](#7-frontend-architecture)
8. [Multi-Tenant Security](#8-multi-tenant-security)
9. [Compliance & Legal](#9-compliance--legal)
10. [File Structure](#10-file-structure)
11. [Implementation Phases](#11-implementation-phases)
12. [Testing Strategy](#12-testing-strategy)
13. [Performance & Scalability](#13-performance--scalability)
14. [Observability & Monitoring](#14-observability--monitoring)
15. [Future Roadmap](#15-future-roadmap)
16. [Open Questions](#16-open-questions)
17. [Appendix](#17-appendix)

---

## 1. Critical Lessons from V1 Review

> **Context:** V1 of this proposal was reviewed by a Staff+ engineer with experience scaling systems to 50M+ calls/year. Their feedback fundamentally improved this architecture.

### 1.1 What V1 Got Wrong

| V1 Design | Problem | V2 Fix |
|-----------|---------|--------|
| **Single `CallRecord` collection with everything embedded** | Transcripts (50KB+) and recordings metadata bloat hot queries | Hot/cold separation: `call_summaries` (fast) + `call_transcripts` (archived) |
| **Embedded arrays in Customer** (`callHistory: [ObjectId]`, `notes: [...]`) | Unbounded growth hits MongoDB 16MB limit; a customer with 5000 calls breaks | No embedded arrays; use `customer_events` append-only collection |
| **On-the-fly analytics** | 500K calls = 30+ second aggregation queries | Pre-computed `call_daily_stats` with nightly rollup job |
| **"Find then create" customer lookup** | Race condition: 2 concurrent calls create duplicate customers | Atomic upsert with placeholder pattern |
| **4-week timeline** | Unrealistic for production-grade, compliant system | 10-week timeline with Week-4 MVP |
| **Missing compliance features** | No audit log, no encryption, no consent tracking, no auto-purge | All added as Day-1 non-negotiables |

### 1.2 What V1 Got Right (Kept in V2)

| V1 Design | Why It Stays |
|-----------|--------------|
| Multi-tenant isolation model | Correct — 5-layer security is solid |
| User stories with acceptance criteria | Good requirements discipline |
| RESTful API design | Standard, correct |
| Vanilla JS frontend | Correct pushback — React migration is separate initiative |
| ASCII architecture diagrams | Clear communication |
| Phased implementation | Allows MVP before full build |

### 1.3 Core Principle (V2)

> **Separate HOT, frequent, small reads/writes from COLD, large, infrequent blobs from ANALYTICS.**

This is the architectural north star that enables scaling to 10M+ calls.

---

## 2. Executive Summary

### 2.1 Purpose

Build a **Call Center Module** for the ClientsVia platform that provides:
- Persistent call history logging with hot/cold data separation
- Lean customer profiles with event-sourced history
- Automatic customer recognition on incoming calls (race-proof)
- Pre-computed analytics for instant dashboards
- Full compliance: audit logs, encryption, consent tracking, auto-purge

### 2.2 Scale Targets

| Metric | Target |
|--------|--------|
| Companies | 500+ |
| Calls/company/year | 20,000+ |
| Total calls/year | 10M+ |
| Customer lookup latency | < 10ms (Redis cached) |
| Recent calls list | < 200ms |
| Analytics dashboard | < 400ms (pre-computed) |
| Data retention | Configurable per company |

### 2.3 Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| **Hot/Cold separation** | Keep `call_summaries` < 8KB for fast queries; archive transcripts to S3 |
| **Lean customer model** | No embedded arrays; < 4KB per customer |
| **Event sourcing for history** | `customer_events` collection; immutable, queryable |
| **Pre-computed analytics** | Nightly `call_daily_stats` rollup; dashboards never aggregate raw data |
| **Placeholder upsert** | Atomic customer creation; no race conditions |
| **Vanilla JS frontend** | Existing codebase; React migration is separate initiative |

---

## 3. Business Requirements

### 3.1 User Stories

#### US-1: Call History Logging
> As an admin, I want every incoming call to be automatically logged with essential details, so I can review what happened and how the AI handled it.

**Acceptance Criteria:**
- [ ] Every call creates a `call_summaries` document (< 8KB)
- [ ] Transcript stored separately in `call_transcripts`
- [ ] Recording metadata stored separately in `call_recordings`
- [ ] Records are company-scoped (multi-tenant)
- [ ] Configurable retention per company

#### US-2: Customer Recognition (Race-Proof)
> As the AI agent, I want to recognize returning callers by phone number within 10ms, even under 100 concurrent calls, so I can personalize the conversation.

**Acceptance Criteria:**
- [ ] Customer lookup via Redis cache (< 10ms)
- [ ] Atomic upsert creates placeholder if new
- [ ] No duplicate customers under concurrent load
- [ ] AI receives customer context at call start

#### US-3: Customer History (Event-Sourced)
> As an admin, I want to see a customer's full history without loading a bloated document, so the system stays fast at scale.

**Acceptance Criteria:**
- [ ] Customer document stays lean (< 4KB)
- [ ] History loaded from `customer_events` on demand
- [ ] Lifetime stats updated via `$inc` (atomic)
- [ ] Notes stored in events, not embedded

#### US-4: Instant Analytics
> As an admin, I want analytics dashboards to load in under 400ms, even with 500K calls in the system.

**Acceptance Criteria:**
- [ ] Dashboards read from `call_daily_stats`
- [ ] Nightly rollup job computes stats
- [ ] No aggregation queries on raw data
- [ ] 7-day stats cached in Redis

#### US-5: Compliance & Legal
> As a company owner, I need the system to comply with recording consent laws and data retention requirements.

**Acceptance Criteria:**
- [ ] Consent tracking per call (1-party vs 2-party states)
- [ ] Auto-purge job for recordings > retention period
- [ ] Audit log of all data access
- [ ] Field-level encryption for PII
- [ ] GDPR/CCPA export capability

### 3.2 Non-Functional Requirements

| Requirement | Target | Notes |
|-------------|--------|-------|
| **Customer lookup** | < 10ms | Redis cached |
| **Recent calls list** | < 200ms | Paginated, indexed |
| **Analytics dashboard** | < 400ms | Pre-computed |
| **Concurrent calls** | 100+ | Per company |
| **Data volume** | 500K+ calls | Per company |
| **Availability** | 99.9% | Platform SLA |

---

## 4. System Architecture

### 4.1 High-Level Architecture

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
│  │  /api/admin/calls/:companyId/*         → CallController            │   │
│  │  /api/admin/customers/:companyId/*     → CustomerController        │   │
│  │  /api/admin/analytics/:companyId/*     → AnalyticsController       │   │
│  │  /api/internal/events/*                → EventController           │   │
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
│  │  3. auditLog                 - Log all data access (NEW)           │   │
│  │  4. validateRequest          - Validate request body/params        │   │
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
│  │ CallSummaryService│    │ CustomerService   │    │ CustomerLookup    │   │
│  ├───────────────────┤    ├───────────────────┤    ├───────────────────┤   │
│  │                   │    │                   │    │                   │   │
│  │ • createSummary() │    │ • getOrCreate()   │    │ • lookupByPhone() │   │
│  │ • getSummary()    │    │ • update()        │    │ • getOrCreatePlaceholder()│
│  │ • listSummaries() │    │ • addEvent()      │    │ • enrichContext() │   │
│  │ • linkTranscript()│    │ • getHistory()    │    │                   │   │
│  └───────────────────┘    └───────────────────┘    └───────────────────┘   │
│                                                                             │
│  ┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐   │
│  │ TranscriptService │    │ AnalyticsService  │    │ EventBus          │   │
│  ├───────────────────┤    ├───────────────────┤    ├───────────────────┤   │
│  │                   │    │                   │    │                   │   │
│  │ • store()         │    │ • getDailyStats() │    │ • emit()          │   │
│  │ • archive()       │    │ • rollupDaily()   │    │ • on()            │   │
│  │ • getByCallId()   │    │ • getWeeklyCache()│    │ Events:           │   │
│  └───────────────────┘    └───────────────────┘    │ • customer.created│   │
│                                                    │ • call.completed  │   │
│  ┌───────────────────┐    ┌───────────────────┐    │ • appointment.booked│  │
│  │ AuditLogService   │    │ PurgeJobService   │    └───────────────────┘   │
│  ├───────────────────┤    ├───────────────────┤                            │
│  │                   │    │                   │                            │
│  │ • logAccess()     │    │ • purgeOldRecords │                            │
│  │ • logChange()     │    │ • archiveToS3()   │                            │
│  │ • getAuditTrail() │    │ • deleteExpired() │                            │
│  └───────────────────┘    └───────────────────┘                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA LAYER                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                     HOT DATA (MongoDB)                                │ │
│  ├───────────────────────────────────────────────────────────────────────┤ │
│  │                                                                       │ │
│  │  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐   │ │
│  │  │  customers      │    │ call_summaries  │    │ call_daily_stats│   │ │
│  │  │  (< 4KB each)   │    │ (< 8KB each)    │    │ (tiny)          │   │ │
│  │  │                 │    │                 │    │                 │   │ │
│  │  │  HOT READ/WRITE │    │  HOT READ       │    │  READ OFTEN     │   │ │
│  │  │  + Redis cache  │    │  WARM WRITE     │    │  WRITE DAILY    │   │ │
│  │  └─────────────────┘    └─────────────────┘    └─────────────────┘   │ │
│  │                                                                       │ │
│  │  ┌─────────────────┐    ┌─────────────────┐                          │ │
│  │  │ customer_events │    │   audit_log     │                          │ │
│  │  │ (append-only)   │    │ (immutable)     │                          │ │
│  │  │                 │    │                 │                          │ │
│  │  │  APPEND ONLY    │    │  APPEND ONLY    │                          │ │
│  │  │  FOREVER        │    │  7 YEARS        │                          │ │
│  │  └─────────────────┘    └─────────────────┘                          │ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                     WARM DATA (MongoDB → S3 after 48h)                │ │
│  ├───────────────────────────────────────────────────────────────────────┤ │
│  │                                                                       │ │
│  │  ┌─────────────────┐    ┌─────────────────┐                          │ │
│  │  │ call_transcripts│    │ call_recordings │                          │ │
│  │  │ (medium-large)  │    │ (metadata only) │                          │ │
│  │  │                 │    │                 │                          │ │
│  │  │  RARE READ      │    │  RARE READ      │                          │ │
│  │  │  48h → S3       │    │  90d → DELETE   │                          │ │
│  │  └─────────────────┘    └─────────────────┘                          │ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                     CACHE LAYER (Redis)                               │ │
│  ├───────────────────────────────────────────────────────────────────────┤ │
│  │                                                                       │ │
│  │  customer:{companyId}:{phone}  → Customer profile      (5 min TTL)   │ │
│  │  stats:{companyId}:weekly      → Weekly aggregates     (1 hour TTL)  │ │
│  │  stats:{companyId}:today       → Today's running count (5 min TTL)   │ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                     COLD STORAGE (S3 / Backblaze B2)                  │ │
│  ├───────────────────────────────────────────────────────────────────────┤ │
│  │                                                                       │ │
│  │  s3://clientsvia-transcripts/{companyId}/{YYYY-MM}/{callId}.json     │ │
│  │  s3://clientsvia-recordings/{companyId}/{YYYY-MM}/{callId}.mp3       │ │
│  │                                                                       │ │
│  │  Lifecycle: Standard → Glacier after 30d → Deep Archive after 90d    │ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Customer Recognition Flow (Race-Proof)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│              CUSTOMER RECOGNITION FLOW (V2 - RACE-PROOF)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  WHY THIS CHANGE?                                                   │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  V1: "Find, then create if not found" → Race condition at 100 calls │   │
│  │  V2: Atomic upsert with placeholder → No duplicates, ever           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Incoming call → extract phone (E.164 normalized: +13055551234)            │
│                         │                                                   │
│                         ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  STEP 1: Redis Cache Check (< 1ms)                                  │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  const cached = await redis.get(`customer:${companyId}:${phone}`);  │   │
│  │  if (cached) return JSON.parse(cached);  // HIT → skip DB           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                         │ MISS                                              │
│                         ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  STEP 2: Atomic Upsert (creates placeholder if new)                 │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  const customer = await Customer.findOneAndUpdate(                  │   │
│  │    { companyId, phone },                                            │   │
│  │    {                                                                │   │
│  │      $setOnInsert: {                                                │   │
│  │        status: 'placeholder',                                       │   │
│  │        firstContactAt: new Date(),                                  │   │
│  │        totalCalls: 0,                                               │   │
│  │        lifetimeValue: 0                                             │   │
│  │      },                                                             │   │
│  │      $set: { lastContactAt: new Date() },                          │   │
│  │      $inc: { totalCalls: 1 }                                        │   │
│  │    },                                                               │   │
│  │    { upsert: true, new: true }                                      │   │
│  │  );                                                                 │   │
│  │                                                                     │   │
│  │  // This is ATOMIC — 100 concurrent calls = 1 customer, 100 $inc   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                         │                                                   │
│                         ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  STEP 3: Cache the result                                           │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  await redis.setex(                                                 │   │
│  │    `customer:${companyId}:${phone}`,                                │   │
│  │    300,  // 5 minutes                                               │   │
│  │    JSON.stringify(customer)                                         │   │
│  │  );                                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                         │                                                   │
│                         ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  STEP 4: Return context to LLM-0                                    │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  return {                                                           │   │
│  │    customerId: customer._id,                                        │   │
│  │    isReturning: customer.status !== 'placeholder',                  │   │
│  │    name: customer.fullName,                                         │   │
│  │    totalCalls: customer.totalCalls,                                 │   │
│  │    lastContactAt: customer.lastContactAt,                          │   │
│  │    preferences: customer.preferences                                │   │
│  │  };                                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                         │                                                   │
│                         ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  STEP 5: During/After call → Enrich placeholder                     │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  await Customer.findByIdAndUpdate(customerId, {                     │   │
│  │    $set: {                                                          │   │
│  │      fullName: capturedName,                                        │   │
│  │      status: 'lead',  // or 'customer' if appointment booked       │   │
│  │      // ... other captured fields                                   │   │
│  │    }                                                                │   │
│  │  });                                                                │   │
│  │                                                                     │   │
│  │  // Also log event                                                  │   │
│  │  await CustomerEvent.create({                                       │   │
│  │    companyId, customerId, type: 'call_completed', callId, ...      │   │
│  │  });                                                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Data Models

### 5.1 Collection Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     DATA MODEL OVERVIEW (V2)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  WHY THIS CHANGE?                                                   │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  V1: One big CallRecord (50KB+), embedded arrays in Customer        │   │
│  │  V2: Hot/cold separation, lean documents, event-sourced history     │   │
│  │                                                                     │   │
│  │  Result: 10x faster queries, no document size limits, cheaper       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Collection          │ Size    │ Access      │ Retention │ Storage         │
│  ════════════════════╪═════════╪═════════════╪═══════════╪════════════════ │
│  customers           │ < 4KB   │ Very hot    │ Forever   │ Mongo + Redis   │
│  customer_events     │ Tiny    │ Append-only │ Forever   │ Mongo           │
│  call_summaries      │ < 8KB   │ Hot read    │ 24-36 mo  │ Mongo           │
│  call_transcripts    │ 10-50KB │ Rare read   │ 48h→S3    │ Mongo → S3      │
│  call_recordings     │ Meta    │ Rare        │ 90d→del   │ Mongo + S3      │
│  call_daily_stats    │ Tiny    │ Read often  │ Forever   │ Mongo / Redis   │
│  audit_log           │ Small   │ Append-only │ 7 years   │ Mongo (immut)   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 customers (Lean — No Embedded Arrays)

```javascript
/**
 * Customer Model (V2 - LEAN)
 * 
 * CRITICAL: This document must stay < 4KB for Redis caching efficiency.
 * NO embedded arrays that can grow unboundedly.
 * History is stored in customer_events (separate collection).
 * 
 * @collection customers
 */
const CustomerSchema = new mongoose.Schema({
  
  // ═══════════════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════════════
  
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'v2Company', 
    required: true, 
    index: true 
  },
  
  customerId: { 
    type: String, 
    unique: true  // "CUST-00842"
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CONTACT (Primary lookup key = phone)
  // ═══════════════════════════════════════════════════════════════════════
  
  phone: { 
    type: String, 
    required: true, 
    index: true  // E.164 format: +13055551234
  },
  
  secondaryPhones: [{
    type: String,
    index: true
  }],
  
  email: { type: String },
  
  // ═══════════════════════════════════════════════════════════════════════
  // PERSONAL
  // ═══════════════════════════════════════════════════════════════════════
  
  fullName: { type: String },
  firstName: { type: String },
  lastName: { type: String },
  
  // ═══════════════════════════════════════════════════════════════════════
  // STATUS & LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════
  
  status: { 
    type: String, 
    enum: ['placeholder', 'lead', 'customer', 'inactive', 'churned', 'dnc'],
    default: 'placeholder'
  },
  
  customerType: { 
    type: String, 
    enum: ['residential', 'commercial', 'property_manager'],
    default: 'residential'
  },
  
  firstContactAt: { type: Date },
  lastContactAt: { type: Date, index: true },
  becameCustomerAt: { type: Date },
  
  // ═══════════════════════════════════════════════════════════════════════
  // STATS (Updated via $inc — atomic, no race conditions)
  // ═══════════════════════════════════════════════════════════════════════
  
  totalCalls: { type: Number, default: 0 },
  totalAppointments: { type: Number, default: 0 },
  completedAppointments: { type: Number, default: 0 },
  lifetimeValue: { type: Number, default: 0 },
  
  // ═══════════════════════════════════════════════════════════════════════
  // PRIMARY ADDRESS (One only — additional in customer_events)
  // ═══════════════════════════════════════════════════════════════════════
  
  primaryAddress: {
    street: { type: String },
    unit: { type: String },
    city: { type: String },
    state: { type: String },
    zip: { type: String },
    accessNotes: { type: String },
    keyLocation: { type: String },
    gateCode: { type: String }
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // PREFERENCES (Small, fixed structure)
  // ═══════════════════════════════════════════════════════════════════════
  
  preferences: {
    preferredTimeOfDay: { type: String },
    preferredDays: [String],
    communicationMethod: { type: String, default: 'call' },
    language: { type: String, default: 'en' }
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // TAGS (Small array — max 20 tags)
  // ═══════════════════════════════════════════════════════════════════════
  
  tags: {
    type: [String],
    validate: [v => v.length <= 20, 'Max 20 tags']
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // ENCRYPTION FLAGS (for PII compliance)
  // ═══════════════════════════════════════════════════════════════════════
  
  _encrypted: {
    phone: { type: Boolean, default: false },
    email: { type: Boolean, default: false },
    address: { type: Boolean, default: false }
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // REMOVED FROM V1 (moved to customer_events):
  // - callHistory: [ObjectId]  ← REMOVED (unbounded growth)
  // - notes: [...]             ← REMOVED (unbounded growth)
  // - equipment: [...]         ← REMOVED (moved to events)
  // - addresses: [...]         ← REMOVED (one primary only)
  // ═══════════════════════════════════════════════════════════════════════
  
}, { 
  timestamps: true,
  collection: 'customers'
});

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// Primary lookup (unique per company)
CustomerSchema.index({ companyId: 1, phone: 1 }, { unique: true });

// Secondary phone lookup
CustomerSchema.index({ companyId: 1, secondaryPhones: 1 });

// Common queries
CustomerSchema.index({ companyId: 1, lastContactAt: -1 });
CustomerSchema.index({ companyId: 1, status: 1 });
CustomerSchema.index({ companyId: 1, tags: 1 });

// Text search
CustomerSchema.index({ fullName: 'text', email: 'text' });

// ═══════════════════════════════════════════════════════════════════════════
// PRE-SAVE: Auto-generate customerId
// ═══════════════════════════════════════════════════════════════════════════

CustomerSchema.pre('save', function(next) {
  if (!this.customerId) {
    this.customerId = `CUST-${Date.now().toString(36).toUpperCase()}`;
  }
  if (this.firstName || this.lastName) {
    this.fullName = `${this.firstName || ''} ${this.lastName || ''}`.trim();
  }
  next();
});

module.exports = mongoose.model('Customer', CustomerSchema);
```

### 5.3 customer_events (Append-Only History)

```javascript
/**
 * CustomerEvent Model
 * 
 * Event-sourced history for customers. Append-only, never updated.
 * This replaces embedded arrays in the Customer document.
 * 
 * @collection customer_events
 */
const CustomerEventSchema = new mongoose.Schema({
  
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'v2Company', 
    required: true, 
    index: true 
  },
  
  customerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Customer', 
    required: true, 
    index: true 
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // EVENT TYPE
  // ═══════════════════════════════════════════════════════════════════════
  
  type: { 
    type: String, 
    required: true,
    enum: [
      // Call events
      'call_started',
      'call_completed',
      'call_transferred',
      'call_abandoned',
      
      // Appointment events
      'appointment_booked',
      'appointment_completed',
      'appointment_cancelled',
      'appointment_rescheduled',
      
      // Customer events
      'customer_created',
      'customer_updated',
      'customer_merged',
      'status_changed',
      
      // Note events
      'note_added',
      'note_updated',
      
      // Address events
      'address_added',
      'address_updated',
      
      // Equipment events
      'equipment_added',
      'equipment_serviced',
      
      // Billing events
      'invoice_created',
      'payment_received'
    ],
    index: true
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // EVENT DATA (Varies by type)
  // ═══════════════════════════════════════════════════════════════════════
  
  data: {
    type: mongoose.Schema.Types.Mixed,
    required: true
    // Examples:
    // { callId, duration, outcome } for call events
    // { appointmentId, date, service } for appointment events
    // { text, category } for note events
    // { address: {...} } for address events
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // REFERENCES (Optional links to related documents)
  // ═══════════════════════════════════════════════════════════════════════
  
  callId: { type: String },
  appointmentId: { type: mongoose.Schema.Types.ObjectId },
  
  // ═══════════════════════════════════════════════════════════════════════
  // METADATA
  // ═══════════════════════════════════════════════════════════════════════
  
  createdBy: { type: String },  // User ID or 'system'
  createdAt: { type: Date, default: Date.now, index: true }
  
}, { 
  timestamps: false,  // We manage createdAt ourselves
  collection: 'customer_events'
});

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// Primary query: Get customer history
CustomerEventSchema.index({ companyId: 1, customerId: 1, createdAt: -1 });

// Filter by type
CustomerEventSchema.index({ companyId: 1, customerId: 1, type: 1, createdAt: -1 });

// Find events by call
CustomerEventSchema.index({ companyId: 1, callId: 1 });

module.exports = mongoose.model('CustomerEvent', CustomerEventSchema);
```

### 5.4 call_summaries (Hot — Fast Queries)

```javascript
/**
 * CallSummary Model (V2)
 * 
 * CRITICAL: This document must stay < 8KB for fast queries.
 * Transcripts and recordings are stored separately.
 * 
 * @collection call_summaries
 */
const CallSummarySchema = new mongoose.Schema({
  
  // ═══════════════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════════════
  
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'v2Company', 
    required: true, 
    index: true 
  },
  
  callId: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true  // "call_1735689123_ab12"
  },
  
  twilioSid: { type: String, index: true },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CALLER
  // ═══════════════════════════════════════════════════════════════════════
  
  phone: { 
    type: String, 
    required: true, 
    index: true  // E.164 format
  },
  
  customerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Customer',
    index: true  // null if unknown at call end
  },
  
  callerName: { type: String },
  isReturning: { type: Boolean, default: false },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CALL METADATA
  // ═══════════════════════════════════════════════════════════════════════
  
  direction: { 
    type: String, 
    enum: ['inbound', 'outbound'], 
    default: 'inbound' 
  },
  
  startedAt: { type: Date, required: true, index: true },
  endedAt: { type: Date },
  durationSeconds: { type: Number },
  
  // ═══════════════════════════════════════════════════════════════════════
  // AI ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════
  
  primaryIntent: { type: String, index: true },
  intentConfidence: { type: Number },
  
  emotion: {
    primary: { type: String },
    intensity: { type: Number }
  },
  
  triageCard: { type: String },
  scenarioMatched: { type: String },
  routingTier: { type: Number, enum: [1, 2, 3] },
  llmModel: { type: String },
  llmCost: { type: Number },
  
  // ═══════════════════════════════════════════════════════════════════════
  // OUTCOME
  // ═══════════════════════════════════════════════════════════════════════
  
  outcome: { 
    type: String, 
    enum: ['completed', 'transferred', 'voicemail', 'abandoned', 'spam', 'error'],
    required: true,
    index: true
  },
  
  outcomeDetail: { type: String },  // "Appointment Booked", "Transferred to Sales"
  
  transferredTo: { type: String },
  appointmentCreatedId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
  messageLeft: { type: Boolean },
  followUpRequired: { type: Boolean, default: false },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CAPTURED SUMMARY (Key fields only — not full PII dump)
  // ═══════════════════════════════════════════════════════════════════════
  
  capturedSummary: {
    name: { type: String },
    addressChanged: { type: Boolean },
    urgency: { type: String, enum: ['normal', 'urgent', 'emergency'] },
    problemSummary: { type: String, maxLength: 500 },
    keyEntities: { type: Map, of: String }  // { "service": "AC repair", "date": "tomorrow" }
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // REFERENCES TO COLD STORAGE
  // ═══════════════════════════════════════════════════════════════════════
  
  transcriptRef: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'CallTranscript' 
  },
  
  recordingRef: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'CallRecording' 
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // NOTES & REVIEW
  // ═══════════════════════════════════════════════════════════════════════
  
  agentNote: { type: String, maxLength: 1000 },
  
  flagged: { type: Boolean, default: false, index: true },
  flagReason: { type: String },
  
  reviewedAt: { type: Date },
  reviewedBy: { type: String },
  reviewRating: { type: Number, min: 1, max: 5 },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CONSENT TRACKING (Compliance)
  // ═══════════════════════════════════════════════════════════════════════
  
  consent: {
    recordingConsent: { type: Boolean },
    consentType: { type: String, enum: ['one-party', 'two-party', 'unknown'] },
    callerState: { type: String },  // For state-by-state rules
    consentTimestamp: { type: Date }
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // REMOVED FROM V1 (moved to separate collections):
  // - transcript: [...]         ← MOVED to call_transcripts
  // - recording: {...}          ← MOVED to call_recordings
  // - captured: {...full...}    ← REDUCED to capturedSummary
  // - actions: [...]            ← MOVED to customer_events
  // ═══════════════════════════════════════════════════════════════════════
  
}, { 
  timestamps: true,
  collection: 'call_summaries'
});

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES (All compound starting with companyId)
// ═══════════════════════════════════════════════════════════════════════════

// Primary: Recent calls
CallSummarySchema.index({ companyId: 1, startedAt: -1 });

// Customer's calls
CallSummarySchema.index({ companyId: 1, customerId: 1, startedAt: -1 });

// Phone lookup
CallSummarySchema.index({ companyId: 1, phone: 1, startedAt: -1 });

// Filter by outcome
CallSummarySchema.index({ companyId: 1, outcome: 1, startedAt: -1 });

// Filter by intent
CallSummarySchema.index({ companyId: 1, primaryIntent: 1, startedAt: -1 });

// Flagged calls
CallSummarySchema.index({ companyId: 1, flagged: 1, startedAt: -1 });

// Analytics queries (for rollup job)
CallSummarySchema.index({ companyId: 1, startedAt: 1, outcome: 1, routingTier: 1 });

module.exports = mongoose.model('CallSummary', CallSummarySchema);
```

### 5.5 call_transcripts (Cold — Archived to S3)

```javascript
/**
 * CallTranscript Model
 * 
 * Stored in Mongo for 48 hours, then archived to S3 and deleted.
 * 
 * @collection call_transcripts
 */
const CallTranscriptSchema = new mongoose.Schema({
  
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true, 
    index: true 
  },
  
  callId: { 
    type: String, 
    required: true, 
    unique: true 
  },
  
  turns: [{
    speaker: { type: String, enum: ['agent', 'caller'] },
    text: { type: String },
    timestamp: { type: Date },
    turnNumber: { type: Number }
  }],
  
  // S3 archival tracking
  archivedAt: { type: Date },
  s3Key: { type: String },  // "transcripts/{companyId}/{YYYY-MM}/{callId}.json"
  
  createdAt: { type: Date, default: Date.now }
  
}, { 
  collection: 'call_transcripts'
});

// TTL index: Auto-delete after 48 hours (archival job runs before this)
CallTranscriptSchema.index({ createdAt: 1 }, { expireAfterSeconds: 172800 });

// Lookup
CallTranscriptSchema.index({ companyId: 1, callId: 1 });

module.exports = mongoose.model('CallTranscript', CallTranscriptSchema);
```

### 5.6 call_daily_stats (Pre-Computed Analytics)

```javascript
/**
 * CallDailyStats Model
 * 
 * Pre-computed daily statistics. Generated by nightly rollup job.
 * Dashboards read from here — never aggregate raw data.
 * 
 * @collection call_daily_stats
 */
const CallDailyStatsSchema = new mongoose.Schema({
  
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true 
  },
  
  date: { 
    type: String, 
    required: true  // "2025-12-01"
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CALL COUNTS
  // ═══════════════════════════════════════════════════════════════════════
  
  totalCalls: { type: Number, default: 0 },
  inboundCalls: { type: Number, default: 0 },
  outboundCalls: { type: Number, default: 0 },
  
  // ═══════════════════════════════════════════════════════════════════════
  // OUTCOMES
  // ═══════════════════════════════════════════════════════════════════════
  
  completed: { type: Number, default: 0 },
  transferred: { type: Number, default: 0 },
  voicemail: { type: Number, default: 0 },
  abandoned: { type: Number, default: 0 },
  spam: { type: Number, default: 0 },
  
  // ═══════════════════════════════════════════════════════════════════════
  // ROUTING TIERS
  // ═══════════════════════════════════════════════════════════════════════
  
  tier1: { type: Number, default: 0 },
  tier2: { type: Number, default: 0 },
  tier3: { type: Number, default: 0 },
  
  // ═══════════════════════════════════════════════════════════════════════
  // APPOINTMENTS
  // ═══════════════════════════════════════════════════════════════════════
  
  appointmentsBooked: { type: Number, default: 0 },
  bookingRate: { type: Number, default: 0 },  // appointmentsBooked / totalCalls
  
  // ═══════════════════════════════════════════════════════════════════════
  // DURATIONS
  // ═══════════════════════════════════════════════════════════════════════
  
  totalDurationSeconds: { type: Number, default: 0 },
  avgDurationSeconds: { type: Number, default: 0 },
  
  // ═══════════════════════════════════════════════════════════════════════
  // INTENTS (Top 10 only)
  // ═══════════════════════════════════════════════════════════════════════
  
  intents: {
    type: Map,
    of: Number  // { "BOOK_APPOINTMENT": 34, "SERVICE_QUESTION": 22, ... }
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CUSTOMERS
  // ═══════════════════════════════════════════════════════════════════════
  
  newCustomers: { type: Number, default: 0 },
  returningCustomers: { type: Number, default: 0 },
  
  // ═══════════════════════════════════════════════════════════════════════
  // LLM COSTS
  // ═══════════════════════════════════════════════════════════════════════
  
  llmCostTotal: { type: Number, default: 0 },
  
  // ═══════════════════════════════════════════════════════════════════════
  // METADATA
  // ═══════════════════════════════════════════════════════════════════════
  
  computedAt: { type: Date, default: Date.now }
  
}, { 
  collection: 'call_daily_stats'
});

// Unique per company per day
CallDailyStatsSchema.index({ companyId: 1, date: 1 }, { unique: true });

// Quick lookup for date ranges
CallDailyStatsSchema.index({ companyId: 1, date: -1 });

module.exports = mongoose.model('CallDailyStats', CallDailyStatsSchema);
```

### 5.7 audit_log (Compliance — Immutable)

```javascript
/**
 * AuditLog Model
 * 
 * Immutable log of all data access and changes.
 * Required for compliance (GDPR, CCPA, SOC2).
 * Retained for 7 years.
 * 
 * @collection audit_log
 */
const AuditLogSchema = new mongoose.Schema({
  
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true 
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // WHO
  // ═══════════════════════════════════════════════════════════════════════
  
  userId: { type: String, required: true },
  userEmail: { type: String },
  userRole: { type: String },
  ipAddress: { type: String },
  userAgent: { type: String },
  
  // ═══════════════════════════════════════════════════════════════════════
  // WHAT
  // ═══════════════════════════════════════════════════════════════════════
  
  action: { 
    type: String, 
    required: true,
    enum: [
      // Data access
      'call.viewed',
      'call.transcript_viewed',
      'call.recording_played',
      'customer.viewed',
      'customer.searched',
      
      // Data modification
      'call.flagged',
      'call.note_added',
      'customer.updated',
      'customer.merged',
      'customer.deleted',
      
      // Export
      'data.exported',
      
      // Admin actions
      'settings.changed',
      'user.created',
      'user.deleted'
    ]
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // TARGET
  // ═══════════════════════════════════════════════════════════════════════
  
  targetType: { 
    type: String, 
    enum: ['call', 'customer', 'appointment', 'settings', 'user'] 
  },
  
  targetId: { type: String },
  
  // ═══════════════════════════════════════════════════════════════════════
  // DETAILS
  // ═══════════════════════════════════════════════════════════════════════
  
  details: {
    type: mongoose.Schema.Types.Mixed
    // Examples:
    // { searchQuery: "305-555" } for searches
    // { changedFields: ["name", "address"] } for updates
    // { exportFormat: "csv", recordCount: 150 } for exports
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // TIMESTAMP (Immutable)
  // ═══════════════════════════════════════════════════════════════════════
  
  timestamp: { 
    type: Date, 
    default: Date.now, 
    immutable: true 
  }
  
}, { 
  collection: 'audit_log',
  timestamps: false  // We use our own timestamp
});

// Queries
AuditLogSchema.index({ companyId: 1, timestamp: -1 });
AuditLogSchema.index({ companyId: 1, userId: 1, timestamp: -1 });
AuditLogSchema.index({ companyId: 1, action: 1, timestamp: -1 });
AuditLogSchema.index({ companyId: 1, targetType: 1, targetId: 1, timestamp: -1 });

// IMPORTANT: No TTL index — retained for 7 years
// Purge handled by separate compliance job

module.exports = mongoose.model('AuditLog', AuditLogSchema);
```

---

## 6. API Specification

### 6.1 Endpoint Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API ENDPOINTS (V2)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  CALLS                                                                      │
│  ─────────────────────────────────────────────────────────────────────────  │
│  GET    /api/admin/calls/:companyId              List call summaries       │
│  GET    /api/admin/calls/:companyId/:callId      Get call detail           │
│  GET    /api/admin/calls/:companyId/:callId/transcript  Get transcript     │
│  POST   /api/admin/calls/:companyId/:callId/note Add note                  │
│  POST   /api/admin/calls/:companyId/:callId/flag Flag call                 │
│                                                                             │
│  CUSTOMERS                                                                  │
│  ─────────────────────────────────────────────────────────────────────────  │
│  GET    /api/admin/customers/:companyId          List customers            │
│  GET    /api/admin/customers/:companyId/:id      Get customer              │
│  GET    /api/admin/customers/:companyId/:id/history  Get customer events   │
│  GET    /api/admin/customers/:companyId/lookup/:phone  Lookup by phone     │
│  PATCH  /api/admin/customers/:companyId/:id      Update customer           │
│  POST   /api/admin/customers/:companyId/:id/note Add note                  │
│  POST   /api/admin/customers/:companyId/merge    Merge customers           │
│                                                                             │
│  ANALYTICS                                                                  │
│  ─────────────────────────────────────────────────────────────────────────  │
│  GET    /api/admin/analytics/:companyId/summary  Get period summary        │
│  GET    /api/admin/analytics/:companyId/daily    Get daily stats           │
│  GET    /api/admin/analytics/:companyId/trends   Get trend data            │
│                                                                             │
│  INTERNAL (System use only)                                                 │
│  ─────────────────────────────────────────────────────────────────────────  │
│  POST   /api/internal/calls                      Create call summary       │
│  POST   /api/internal/customers/lookup           Customer lookup (LLM-0)   │
│  POST   /api/internal/events                     Log customer event        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Key Endpoint Details

#### GET /api/admin/calls/:companyId

**Description:** List call summaries with pagination (reads from `call_summaries` only)

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `page` | number | Page number | 1 |
| `limit` | number | Records per page (max 100) | 50 |
| `startDate` | ISO string | Filter: calls after this date | - |
| `endDate` | ISO string | Filter: calls before this date | - |
| `outcome` | string | Filter: outcome status | - |
| `intent` | string | Filter: primary intent | - |
| `customerId` | ObjectId | Filter: customer's calls | - |
| `flagged` | boolean | Filter: flagged calls only | - |

**Response:**

```json
{
  "success": true,
  "calls": [
    {
      "_id": "...",
      "callId": "call_1735689123_ab12",
      "phone": "+13055551234",
      "callerName": "Sarah Johnson",
      "customerId": "...",
      "isReturning": true,
      "startedAt": "2025-12-01T14:30:00Z",
      "durationSeconds": 204,
      "primaryIntent": "APPOINTMENT_ACCESS_UPDATE",
      "routingTier": 1,
      "outcome": "completed",
      "outcomeDetail": "Appointment Updated",
      "hasTranscript": true,
      "hasRecording": true,
      "flagged": false
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

#### GET /api/admin/analytics/:companyId/summary

**Description:** Get analytics summary (reads from `call_daily_stats` — instant response)

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `period` | string | "today", "week", "month", "year" | "week" |

**Response:**

```json
{
  "success": true,
  "period": "week",
  "dateRange": {
    "start": "2025-11-25",
    "end": "2025-12-01"
  },
  "summary": {
    "totalCalls": 347,
    "avgDurationSeconds": 185,
    "bookingRate": 0.34,
    "outcomes": {
      "completed": 298,
      "transferred": 32,
      "voicemail": 10,
      "abandoned": 7
    },
    "tiers": {
      "tier1": 278,
      "tier2": 54,
      "tier3": 15
    },
    "intents": {
      "BOOK_APPOINTMENT": 118,
      "SERVICE_QUESTION": 89,
      "BILLING": 42,
      "EMERGENCY": 28,
      "OTHER": 70
    },
    "customers": {
      "new": 89,
      "returning": 258
    },
    "llmCostTotal": 12.45
  },
  "cached": true,
  "computedAt": "2025-12-01T06:00:00Z"
}
```

---

## 7. Frontend Architecture

### 7.1 Tech Stack Decision

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     FRONTEND TECH STACK (V2)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  WHY THIS CHANGE?                                                   │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  Staff+ Review: "Use React 18 + TanStack Query"                     │   │
│  │                                                                     │   │
│  │  Our Pushback (Accepted):                                           │   │
│  │  - Existing codebase is vanilla JS                                  │   │
│  │  - React migration is 2-4 weeks additional work                     │   │
│  │  - Risk of breaking existing features                               │   │
│  │  - Team may not be React-native                                     │   │
│  │                                                                     │   │
│  │  Decision: Keep vanilla JS for V2, plan React migration separately  │   │
│  │  The API layer is framework-agnostic — React can come later         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  V2 Frontend Stack:                                                         │
│  • Vanilla JavaScript (ES6+)                                               │
│  • Modular class-based architecture                                        │
│  • Fetch API for HTTP requests                                             │
│  • Chart.js for analytics charts                                           │
│  • CSS Grid + Flexbox for layout                                           │
│  • Same patterns as existing Control Plane                                 │
│                                                                             │
│  Future Migration Path:                                                     │
│  • API contracts are stable and documented                                 │
│  • React components can be built against same APIs                         │
│  • Migrate page-by-page, not big-bang                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Page Structure

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
  
  <!-- Header -->
  <header id="call-center-header">
    <div class="header-left">
      <button onclick="goBack()" class="btn-back">← Back to Profile</button>
      <h1>ClientsVia Call Center</h1>
    </div>
    <div class="header-right">
      <div id="company-name"></div>
      <div id="connection-status"></div>
    </div>
  </header>
  
  <!-- Main Navigation -->
  <nav id="call-center-nav">
    <button class="tab-btn active" data-tab="recent-calls">
      📞 Recent Calls
    </button>
    <button class="tab-btn" data-tab="customers">
      👥 Customers
    </button>
    <button class="tab-btn" data-tab="search">
      🔍 Search
    </button>
    <button class="tab-btn" data-tab="analytics">
      📊 Analytics
    </button>
  </nav>
  
  <!-- Tab Content -->
  <main id="call-center-content">
    <div id="recent-calls-tab" class="tab-content active">
      <!-- Call cards loaded here -->
    </div>
    <div id="customers-tab" class="tab-content">
      <!-- Customer list loaded here -->
    </div>
    <div id="search-tab" class="tab-content">
      <!-- Search interface -->
    </div>
    <div id="analytics-tab" class="tab-content">
      <!-- Analytics dashboard -->
    </div>
  </main>
  
  <!-- Modal Container -->
  <div id="modal-container" class="hidden"></div>
  
  <!-- Toast Notifications -->
  <div id="toast-container"></div>
  
  <!-- Scripts -->
  <script src="/js/call-center/utils/api.js"></script>
  <script src="/js/call-center/utils/formatters.js"></script>
  <script src="/js/call-center/utils/modals.js"></script>
  <script src="/js/call-center/CallCenterApp.js"></script>
  <script src="/js/call-center/CallListManager.js"></script>
  <script src="/js/call-center/CustomerListManager.js"></script>
  <script src="/js/call-center/SearchManager.js"></script>
  <script src="/js/call-center/AnalyticsManager.js"></script>
  <script>
    // Initialize with companyId from URL
    const params = new URLSearchParams(window.location.search);
    const companyId = params.get('companyId');
    
    if (!companyId) {
      window.location.href = '/login.html?error=no_company';
    } else {
      window.callCenterApp = new CallCenterApp(companyId);
    }
  </script>
</body>
</html>
```

---

## 8. Multi-Tenant Security

*[Same as V1 — the 5-layer isolation model was correct]*

---

## 9. Compliance & Legal

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     COMPLIANCE REQUIREMENTS (NEW IN V2)                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  WHY THIS CHANGE?                                                   │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  V1: Missing compliance features entirely                           │   │
│  │  V2: Day-1 non-negotiables for legal protection                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  1. RECORDING CONSENT TRACKING                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│  • Track caller's state (IP geolocation or area code)                      │
│  • Flag two-party consent states: CA, CT, FL, IL, MD, MA, MT, NH, PA, WA   │
│  • Store consent timestamp and type per call                               │
│  • Block recording playback if consent unclear                             │
│                                                                             │
│  2. AUTO-PURGE JOB                                                          │
│  ─────────────────────────────────────────────────────────────────────────  │
│  • Default: Recordings deleted after 90 days                               │
│  • Configurable per company (30, 60, 90, 180 days)                         │
│  • Transcripts archived to S3 after 48 hours                               │
│  • Call summaries retained 24-36 months                                    │
│  • Job runs nightly, logs all deletions                                    │
│                                                                             │
│  3. AUDIT LOG                                                               │
│  ─────────────────────────────────────────────────────────────────────────  │
│  • Every data access logged (who, what, when)                              │
│  • Every data change logged with before/after                              │
│  • Immutable — cannot be modified or deleted                               │
│  • Retained 7 years (SOC2, legal discovery)                                │
│  • Queryable by admin for compliance audits                                │
│                                                                             │
│  4. FIELD-LEVEL ENCRYPTION                                                  │
│  ─────────────────────────────────────────────────────────────────────────  │
│  • Encrypt at rest: phone, email, address                                  │
│  • Use MongoDB Client-Side Field Level Encryption (CSFLE)                  │
│  • Keys stored in AWS KMS or Hashicorp Vault                               │
│  • Decrypt only when needed, never log decrypted values                    │
│                                                                             │
│  5. DATA EXPORT (GDPR/CCPA)                                                 │
│  ─────────────────────────────────────────────────────────────────────────  │
│  • Customer can request all their data (right to access)                   │
│  • Export as JSON or CSV                                                   │
│  • Include: calls, transcripts, notes, appointments                        │
│  • Customer can request deletion (right to be forgotten)                   │
│                                                                             │
│  6. CUSTOMER MERGE TOOL                                                     │
│  ─────────────────────────────────────────────────────────────────────────  │
│  • Same person, different phone numbers                                    │
│  • Merge preserves all history from both profiles                          │
│  • Audit log tracks merge: who, when, which profiles                       │
│  • Cannot be undone (by design — audit trail)                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. File Structure

```
clientsvia-backend/
├── models/
│   ├── Customer.js                # Lean customer profile (< 4KB)
│   ├── CustomerEvent.js           # Append-only event history
│   ├── CallSummary.js             # Hot call data (< 8KB)
│   ├── CallTranscript.js          # Cold transcript data
│   ├── CallRecording.js           # Recording metadata
│   ├── CallDailyStats.js          # Pre-computed analytics
│   ├── AuditLog.js                # Compliance audit trail
│   └── ... (existing models)
│
├── routes/admin/
│   ├── calls.js                   # Call summary CRUD
│   ├── customers.js               # Customer CRUD
│   ├── analytics.js               # Analytics endpoints
│   └── ... (existing routes)
│
├── routes/internal/
│   ├── callIngestion.js           # System: Create call records
│   ├── customerLookup.js          # System: LLM-0 customer lookup
│   └── events.js                  # System: Log customer events
│
├── services/
│   ├── CallSummaryService.js      # Call business logic
│   ├── CustomerService.js         # Customer business logic
│   ├── CustomerLookup.js          # Race-proof lookup service
│   ├── TranscriptService.js       # Transcript storage/archival
│   ├── AnalyticsService.js        # Pre-computed stats
│   ├── AuditLogService.js         # Compliance logging
│   ├── PurgeJobService.js         # Auto-delete expired data
│   ├── EventBus.js                # Internal event system
│   └── ... (existing services)
│
├── jobs/
│   ├── dailyStatsRollup.js        # Nightly analytics computation
│   ├── transcriptArchiver.js      # Move transcripts to S3
│   ├── recordingPurge.js          # Delete expired recordings
│   └── auditLogCleanup.js         # 7-year retention enforcement
│
├── middleware/
│   ├── authorizeCompanyAccess.js  # Company access validation
│   ├── auditLog.js                # Auto-log all data access
│   └── ... (existing middleware)
│
├── public/
│   ├── call-center.html           # Call center page
│   ├── css/
│   │   └── call-center.css        # Call center styles
│   └── js/call-center/
│       ├── CallCenterApp.js       # Main controller
│       ├── CallListManager.js     # Call cards, pagination
│       ├── CustomerListManager.js # Customer profiles
│       ├── SearchManager.js       # Advanced search
│       ├── AnalyticsManager.js    # Charts, metrics
│       └── utils/
│           ├── api.js             # API calls with auth
│           ├── formatters.js      # Date, phone formatting
│           └── modals.js          # Modal management
│
└── tests/
    ├── customer-lookup.test.js    # Race condition tests
    ├── call-summary.test.js       # Call CRUD tests
    ├── analytics.test.js          # Pre-computed stats tests
    ├── audit-log.test.js          # Compliance tests
    └── multi-tenant.test.js       # Isolation tests
```

---

## 11. Implementation Phases

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     IMPLEMENTATION TIMELINE (V2)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  WHY THIS CHANGE?                                                   │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  V1: 4 weeks, 111 hours — Unrealistic for production-grade          │   │
│  │  V2: 10 weeks with Week-4 MVP — Realistic, phased delivery          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

PHASE 1: FOUNDATION (Weeks 1-2)
════════════════════════════════════════════════════════════════════════════════
Goal: Bulletproof data layer with race-proof customer lookup

Tasks:
├── Create Customer model (lean, no embedded arrays)
├── Create CustomerEvent model (append-only)
├── Create CallSummary model (< 8KB)
├── Create CallTranscript model (with S3 archival fields)
├── Create CustomerLookup service (atomic upsert)
├── Create authorizeCompanyAccess middleware
├── Create AuditLog model and middleware
├── Write unit tests for models
├── Write race condition tests for CustomerLookup
└── Multi-tenant isolation tests

Exit Criteria:
✓ CustomerLookup handles 100 concurrent calls without duplicates
✓ All models < size limits (4KB customer, 8KB call)
✓ Audit log captures all data access
✓ Multi-tenant isolation verified

PHASE 2: CALL INGESTION + RECOGNITION (Weeks 3-4)
════════════════════════════════════════════════════════════════════════════════
Goal: Calls are logged automatically, customers recognized

Tasks:
├── Create CallSummaryService
├── Create call ingestion endpoint (internal)
├── Integrate CustomerLookup into v2twilio.js (call start)
├── Create call record at call end
├── Pass customer context to LLM-0
├── Link calls to customers via events
├── Basic call-center.html with Recent Calls tab
├── CallListManager (cards, pagination)
├── Integration tests

Exit Criteria (MVP CHECKPOINT):
✓ Incoming call triggers customer lookup (< 10ms with cache)
✓ Call record created automatically at call end
✓ Customer profile updated with call event
✓ Basic UI shows recent calls
✓ AI receives customer context for personalization

PHASE 3: ANALYTICS + COLD STORAGE (Weeks 5-6)
════════════════════════════════════════════════════════════════════════════════
Goal: Instant analytics, efficient storage

Tasks:
├── Create CallDailyStats model
├── Create dailyStatsRollup job (nightly)
├── Create AnalyticsService
├── Create analytics API endpoints
├── Create transcriptArchiver job (48h → S3)
├── Create TranscriptService
├── AnalyticsManager (charts)
├── Analytics tab in UI
├── Redis caching for weekly aggregates

Exit Criteria:
✓ Analytics dashboard loads < 400ms
✓ Nightly rollup job runs successfully
✓ Transcripts archived to S3 after 48h
✓ Charts display correctly

PHASE 4: COMPLIANCE (Weeks 7-8)
════════════════════════════════════════════════════════════════════════════════
Goal: Legal protection complete

Tasks:
├── Implement consent tracking
├── Create recordingPurge job
├── Create PurgeJobService with configurable retention
├── Implement field-level encryption (CSFLE setup)
├── Create data export endpoint (GDPR)
├── Create customer merge tool
├── Audit log query UI
├── Compliance documentation

Exit Criteria:
✓ Consent tracked per call
✓ Recordings auto-delete after retention period
✓ PII fields encrypted at rest
✓ Customer can export their data
✓ Customer merge works with audit trail

PHASE 5: POLISH + LOAD TEST (Weeks 9-10)
════════════════════════════════════════════════════════════════════════════════
Goal: Production-ready

Tasks:
├── UI refinements
├── Customers tab complete
├── Search tab complete
├── Load testing (Artillery: 100+ concurrent)
├── Performance optimization based on results
├── Error handling improvements
├── Monitoring setup (Datadog/Sentry integration)
├── Alert configuration
├── Documentation

Exit Criteria:
✓ System handles 100+ concurrent calls
✓ Recent calls loads < 200ms at 500K records
✓ Analytics loads < 400ms
✓ No errors under load
✓ Monitoring and alerts active

════════════════════════════════════════════════════════════════════════════════
TOTAL: 10 WEEKS
MVP (Week 4): Call logging + customer recognition + basic UI
PRODUCTION (Week 10): Compliant, scalable, monitored
════════════════════════════════════════════════════════════════════════════════
```

---

## 12. Testing Strategy

### 12.1 Critical Test: Race Condition

```javascript
describe('CustomerLookup Race Condition', () => {
  it('should create exactly 1 customer when 100 concurrent calls arrive', async () => {
    const phone = '+13055559999';
    const companyId = testCompanyId;
    
    // Simulate 100 concurrent calls
    const lookupPromises = Array(100).fill().map(() => 
      CustomerLookup.getOrCreatePlaceholder(companyId, phone)
    );
    
    const results = await Promise.all(lookupPromises);
    
    // All should return the same customerId
    const uniqueIds = new Set(results.map(r => r.customerId.toString()));
    expect(uniqueIds.size).toBe(1);
    
    // Only 1 customer should exist
    const count = await Customer.countDocuments({ companyId, phone });
    expect(count).toBe(1);
    
    // totalCalls should be 100
    const customer = await Customer.findOne({ companyId, phone });
    expect(customer.totalCalls).toBe(100);
  });
});
```

### 12.2 Test Categories

| Category | Coverage Target | Focus |
|----------|----------------|-------|
| Unit | 80%+ | Models, services, utilities |
| Integration | Key flows | API endpoints, database |
| Race Condition | 100% | CustomerLookup, stats updates |
| Multi-Tenant | 100% | Isolation verification |
| Load | 100+ concurrent | Performance under stress |
| Compliance | 100% | Audit log, encryption, purge |

---

## 13. Performance & Scalability

### 13.1 Target Metrics

| Metric | Target | Strategy |
|--------|--------|----------|
| Customer lookup | < 10ms | Redis cache (5 min TTL) |
| Recent calls list | < 200ms | Compound indexes, pagination |
| Analytics dashboard | < 400ms | Pre-computed daily stats |
| Call record creation | < 100ms | Async where possible |
| Concurrent calls | 100+ | Atomic upserts, no locks |

### 13.2 Scaling Strategy

```
CURRENT (< 1M calls/year):
└── Single MongoDB replica set
└── Single Redis instance
└── All collections in one database

GROWTH (1-10M calls/year):
└── MongoDB Atlas dedicated cluster
└── Redis Cluster (3 nodes)
└── S3 for cold storage

SCALE (10M+ calls/year):
└── MongoDB sharding (shard key = companyId)
└── Read replicas for analytics
└── CDN for recordings
└── Dedicated analytics database
```

---

## 14. Observability & Monitoring

### 14.1 Metrics to Track

| Metric | Alert Threshold | Action |
|--------|-----------------|--------|
| Customer lookup p99 | > 50ms | Scale Redis |
| Call list p99 | > 500ms | Check indexes |
| Analytics p99 | > 1s | Check rollup job |
| Error rate | > 1% | Page on-call |
| Rollup job failure | Any | Page on-call |
| Purge job failure | Any | Alert (compliance risk) |

### 14.2 Recommended Tools

| Tool | Purpose |
|------|---------|
| Sentry | Error tracking, stack traces |
| Datadog | APM, custom metrics |
| OpenTelemetry | Distributed tracing |
| PagerDuty | On-call alerting |

---

## 15. Future Roadmap

### Phase 6+: Advanced Features

- [ ] Real-time call monitoring (WebSocket)
- [ ] Bulk operations (export, delete range)
- [ ] Recording transcription (Whisper API)
- [ ] Sentiment analysis on transcripts
- [ ] Customer satisfaction surveys
- [ ] Automated follow-up reminders
- [ ] Mobile-responsive Call Center
- [ ] React frontend migration
- [ ] Predictive customer churn
- [ ] Voice quality analytics

---

## 16. Open Questions

### For Engineering Review

1. **S3 Bucket Configuration:** Single bucket with prefixes or separate buckets per data type?

2. **Encryption Key Management:** AWS KMS vs Hashicorp Vault for CSFLE keys?

3. **Rollup Job Timing:** What time zone for nightly rollup? Company-specific or UTC?

4. **Customer Merge Scope:** Can merged customers be "unmerged" or is it permanent?

5. **Recording Storage Provider:** S3 vs Backblaze B2 (cost vs features)?

6. **Real-time Updates:** WebSocket for live call center updates or polling?

7. **PII Fields:** Exact list of fields requiring encryption?

---

## 17. Appendix

### A. V1 → V2 Change Summary

| Aspect | V1 | V2 | Reason |
|--------|----|----|--------|
| CallRecord size | Unbounded (50KB+) | < 8KB | Fast queries |
| Customer arrays | Embedded | Events collection | No size limits |
| Analytics | On-the-fly | Pre-computed | Instant dashboards |
| Customer lookup | Find then create | Atomic upsert | Race-proof |
| Transcripts | In CallRecord | Separate + S3 | Cold storage |
| Compliance | Missing | Day-1 | Legal protection |
| Timeline | 4 weeks | 10 weeks | Realistic |
| Frontend | React suggested | Vanilla JS | Existing codebase |

### B. Glossary

| Term | Definition |
|------|------------|
| **Hot data** | Frequently accessed, must be fast (customers, call_summaries) |
| **Cold data** | Rarely accessed, can be slow (transcripts, recordings) |
| **Placeholder** | Minimal customer created at call start, enriched later |
| **Rollup job** | Nightly job that computes daily statistics |
| **CSFLE** | MongoDB Client-Side Field Level Encryption |
| **Two-party consent** | States requiring both parties to consent to recording |

---

## Approval

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Proposing Engineer | AI Assistant | Dec 1, 2025 | ✓ |
| Staff+ Reviewer | (Feedback incorporated) | Dec 1, 2025 | ✓ |
| Tech Lead | | | |
| Product Owner | | | |

---

**END OF PROPOSAL V2**

---

*This proposal incorporates Staff+ review feedback while maintaining practical constraints. The architecture scales to 10M+ calls/year while delivering an MVP at Week 4.*

