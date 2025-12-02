# 📞 Call Center Module V2 - Production Completion Plan

> **Status:** Feature Complete → Wiring to Production
> **Created:** December 2, 2025
> **Target:** Full production integration

---

## 🎯 Executive Summary

The Call Center Module V2 is **built and deployed**. What remains is **wiring it to the live call flow** so it starts capturing real data and providing value.

### Current State
- ✅ All models created (Customer, CustomerEvent, CallSummary, Vendor, etc.)
- ✅ All services created (CustomerLookup, CallSummaryService, AnalyticsService)
- ✅ All API routes created (25+ endpoints)
- ✅ Full UI built (call-center.html with all tabs)
- ✅ Multi-tenant security enforced
- ⏳ **Not yet wired to live call flow**

### Goal
When a real call comes in:
1. System recognizes returning customers by phone
2. AI agent knows customer context (name, history, properties)
3. Call gets logged to CallSummary
4. Customer profile gets enriched
5. Everything shows up in Call Center UI

---

## 📋 Production Completion Phases

### PHASE 1: Core Wiring (Critical Path)
**Goal:** Live calls create data in the new system

| Task | File | Description | Priority |
|------|------|-------------|----------|
| 1.1 | `utils/addressNormalizer.js` | Create address key generator for dedup | HIGH |
| 1.2 | `utils/phoneTypeDetector.js` | Detect mobile/landline via Twilio Lookup | HIGH |
| 1.3 | `routes/v2twilio.js` | Wire CustomerLookup at call start | CRITICAL |
| 1.4 | `routes/v2twilio.js` | Create CallSummary at call start | CRITICAL |
| 1.5 | `routes/v2twilio.js` | Update CallSummary at call end | CRITICAL |
| 1.6 | `services/CustomerLookup.js` | Add comprehensive lookup with address | HIGH |

### PHASE 2: AI Integration
**Goal:** AI agent uses customer context during calls

| Task | File | Description | Priority |
|------|------|-------------|----------|
| 2.1 | `src/services/brain1/FrontlineIntelEngine.js` | Pass customer context to Brain-1 | HIGH |
| 2.2 | `services/FrontlineScriptBuilder.js` | Verify customer variables work | MEDIUM |
| 2.3 | `handlers/gatherHandler.js` | Capture customer info during call | HIGH |
| 2.4 | `services/CustomerLookup.js` | Enrich customer from call data | HIGH |

### PHASE 3: Call Logging & History
**Goal:** Complete call records with transcripts and summaries

| Task | File | Description | Priority |
|------|------|-------------|----------|
| 3.1 | `routes/v2twilio.js` | Calculate call duration at end | HIGH |
| 3.2 | `services/CallSummaryService.js` | Generate AI summary of call | MEDIUM |
| 3.3 | `models/CallTranscript.js` | Store full transcript | MEDIUM |
| 3.4 | `routes/twilioCallStatus.js` | Handle Twilio status callbacks | HIGH |

### PHASE 4: Cold Storage & Compliance
**Goal:** Transcripts archived, compliance ready

| Task | File | Description | Priority |
|------|------|-------------|----------|
| 4.1 | `config/s3.js` | Configure S3 for transcript archival | MEDIUM |
| 4.2 | `jobs/transcriptArchiver.js` | Wire to actual S3 | MEDIUM |
| 4.3 | `jobs/dataPurge.js` | Test auto-cleanup | LOW |
| 4.4 | `services/ComplianceService.js` | Test data export | LOW |

### PHASE 5: Testing & Validation
**Goal:** Verified working end-to-end

| Task | Description | Priority |
|------|-------------|----------|
| 5.1 | Make test call → verify customer recognized | CRITICAL |
| 5.2 | Make test call → verify CallSummary created | CRITICAL |
| 5.3 | View call in Call Center UI | CRITICAL |
| 5.4 | Add household member → verify dedup works | HIGH |
| 5.5 | Log vendor call → verify pending actions | HIGH |
| 5.6 | Run daily rollup → verify analytics | MEDIUM |

---

## 🔧 Detailed Implementation

### 1.1 Address Normalizer (`utils/addressNormalizer.js`)

```
Purpose: Generate consistent address keys for deduplication
Input: { street, city, state, zip }
Output: "123 MAIN ST|MIAMI|FL|33101"

Logic:
- Uppercase everything
- Remove apt/unit/suite from street
- Normalize street suffixes (ST, AVE, BLVD)
- Remove punctuation
- Pipe-delimit: street|city|state|zip
```

### 1.2 Phone Type Detector (`utils/phoneTypeDetector.js`)

```
Purpose: Determine if phone is mobile/landline/voip
Uses: Twilio Lookup API
Returns: { phoneType: 'mobile', canSms: true, carrier: 'Verizon' }

Fallback: If Twilio Lookup fails, return 'unknown'
Caching: Cache results in Redis for 30 days
```

### 1.3 Wire CustomerLookup to v2twilio.js

```javascript
// At call start (after phone number received):
const { customer, isNew, matchType } = await CustomerLookup.comprehensiveLookup(
  companyId,
  callerPhone,
  null // address comes later
);

// Store in call state:
callState.customerId = customer?._id;
callState.customerContext = customer?.getAIContext();
callState.isReturningCustomer = !isNew && customer?.status !== 'placeholder';
```

### 1.4 Create CallSummary at Call Start

```javascript
// At call start:
const callSummary = await CallSummaryService.startCall({
  companyId,
  phone: callerPhone,
  customerId: customer?._id,
  isReturning: !isNew,
  callerName: customer?.fullName
});

callState.callSummaryId = callSummary._id;
callState.callId = callSummary.callId;
```

### 1.5 Update CallSummary at Call End

```javascript
// At call end:
await CallSummaryService.endCall(callState.callId, {
  endedAt: new Date(),
  durationSeconds: (Date.now() - callState.startTime) / 1000,
  turnCount: callState.turnCount,
  primaryIntent: callState.detectedIntent,
  outcome: callState.outcome, // completed, transferred, voicemail, etc.
  routingTier: callState.tierUsed,
  appointmentCreatedId: callState.appointmentId
});
```

### 2.1 Pass Customer Context to Brain-1

```javascript
// In FrontlineIntelEngine.runTurn():
const customerContext = callState.customerContext || {};

// Add to prompt context:
const contextForAI = {
  isReturning: customerContext.isReturning,
  customerName: customerContext.customerName,
  totalCalls: customerContext.totalCalls,
  hasAddress: customerContext.hasAddress,
  city: customerContext.city,
  phoneType: customerContext.phoneType,
  canSms: customerContext.canSms,
  // ... all customer context
};
```

---

## 📊 Success Metrics

| Metric | Target | How to Verify |
|--------|--------|---------------|
| Customer recognition | 100% of returning callers | Check Call Center UI |
| CallSummary creation | 100% of calls | Check database |
| AI uses context | Greets by name | Listen to test calls |
| Household dedup | No duplicates | Query for same address |
| Vendor pending actions | Show in UI | Log vendor call, check UI |

---

## 🕐 Estimated Timeline

| Phase | Effort | Duration |
|-------|--------|----------|
| Phase 1: Core Wiring | 3-4 hours | Day 1 |
| Phase 2: AI Integration | 2-3 hours | Day 1-2 |
| Phase 3: Call Logging | 2 hours | Day 2 |
| Phase 4: Cold Storage | 1 hour | Day 2 |
| Phase 5: Testing | 2 hours | Day 2-3 |

**Total:** ~10-12 hours of work across 2-3 days

---

## 🚨 Critical Path

The absolute minimum for "production-ready":

1. ✅ `addressNormalizer.js` - For dedup
2. ✅ Wire `CustomerLookup` to `v2twilio.js`
3. ✅ Create `CallSummary` at call start/end
4. ✅ Pass customer context to AI
5. ✅ Test with real call

Everything else is enhancement.

---

## 📁 Files to Create/Modify

### New Files:
- `utils/addressNormalizer.js`
- `utils/phoneTypeDetector.js`

### Modify:
- `routes/v2twilio.js` (main changes)
- `services/CustomerLookup.js` (add methods)
- `src/services/brain1/FrontlineIntelEngine.js` (add context)
- `handlers/gatherHandler.js` (capture info)
- `routes/twilioCallStatus.js` (status callbacks)
- `config/s3.js` (S3 setup)

---

## ✅ Definition of Done

The Call Center Module V2 is **production-ready** when:

1. [ ] Real calls automatically recognize returning customers
2. [ ] AI agent greets returning customers by name
3. [ ] All calls appear in Call Center UI within seconds
4. [ ] Customer profiles show call history
5. [ ] Vendor calls can be logged with pending actions
6. [ ] Analytics show real data
7. [ ] No duplicate customers for same phone/address

