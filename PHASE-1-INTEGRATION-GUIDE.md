# PHASE 1 - CALL ENGINE SPINE INTEGRATION GUIDE

**Date:** November 16, 2025  
**Status:** ✅ IMPLEMENTED - Ready for Integration  
**Phase:** 1 - Foundation Layer

---

## 🎯 WHAT WAS BUILT

Phase 1 implements the **Call Engine Spine** - the foundational infrastructure for call state management, booking, and usage tracking.

### Components Implemented

1. **Core Types** (`src/core/frontlineTypes.js`)
   - JSDoc type definitions for FrontlineContext
   - Shared across all call engine services

2. **FrontlineContext Service** (`src/services/frontlineContextService.js`)
   - Redis-based live call state management
   - Sub-50ms read/write performance
   - 1-hour TTL (auto-cleanup)

3. **CallTrace Model** (`models/CallTrace.js`)
   - MongoDB persistent call snapshot
   - Stores transcript, tier resolutions, extracted data
   - Indexed for analytics queries

4. **CompanyOps Models**
   - `models/Location.js` - Service addresses with access profiles
   - `models/Appointment.js` - Booking management
   - `models/UsageRecord.js` - Per-call usage tracking
   - `models/CompanyBillingState.js` - Billing cycle aggregation

5. **UsageService** (`src/services/usageService.js`)
   - Finalizes call traces (Redis → MongoDB)
   - Records usage for billing
   - Updates company billing state

6. **BookingHandler** (`src/services/bookingHandler.js`)
   - Resolves/creates contacts and locations
   - Creates appointments from call context
   - Priority and urgency scoring

7. **ActiveInstructions API** (`src/services/activeInstructionsService.js` + `src/routes/activeInstructionsRouter.js`)
   - GET `/api/active-instructions?companyId=...&callId=...`
   - Shows active configuration for company/call
   - Useful for debugging and UI display

8. **Twilio Integration Helpers** (`src/services/twilioCallEngineIntegration.js`)
   - Ready-to-use functions for existing Twilio route
   - `initCallContext()` - Call start
   - `updateTranscript()` - Speech turns
   - `recordTierResolution()` - Intelligence tier tracking
   - `finalizeCall()` - Call end

---

## 🔌 INTEGRATION STEPS

### Step 1: Wire Active Instructions API

In `index.js` or `server.js`:

```javascript
const activeInstructionsRouter = require('./src/routes/activeInstructionsRouter');

// Mount router (add auth middleware as needed)
app.use('/api/active-instructions', activeInstructionsRouter);
```

### Step 2: Wire Twilio Webhook Hooks

In `routes/v2twilio.js`, add these imports at the top:

```javascript
const {
  initCallContext,
  updateTranscript,
  recordTierResolution,
  finalizeCall
} = require('../src/services/twilioCallEngineIntegration');
```

#### Hook 1: Call Start (Incoming)

In the `/incoming` or similar route where calls begin:

```javascript
// After resolving companyId from phone number
const startedAt = Date.now();

// Initialize context
const ctx = await initCallContext({
  callId: req.body.CallSid,
  companyId: company._id.toString(),
  trade: company.trade || '',
  configVersion: 1
});

// Store startedAt for later (in memory map or Redis)
callTimings.set(req.body.CallSid, { startedAt });
```

#### Hook 2: Speech Turns

Wherever you process speech-to-text events:

```javascript
// Caller speech
await updateTranscript(callId, 'caller', callerText);

// Agent speech
await updateTranscript(callId, 'agent', agentResponseText);
```

#### Hook 3: Tier Resolutions

After scenario matching or LLM response:

```javascript
// Tier 1 (Rule-based)
if (scenarioMatch) {
  await recordTierResolution(callId, {
    tier: 1,
    confidence: scenarioMatch.confidence,
    sourceId: scenarioMatch.scenarioId,
    answerText: scenarioMatch.response,
    reasoning: 'Rule-based scenario match'
  });
}

// Tier 3 (LLM)
if (llmResponse) {
  await recordTierResolution(callId, {
    tier: 3,
    confidence: 0.95,
    sourceId: llmModel,
    answerText: llmResponse.text,
    reasoning: 'LLM fallback'
  });
}
```

#### Hook 4: Call End (Status Callback)

In the `/status-callback` route:

```javascript
router.post('/status-callback', async (req, res) => {
  const callId = req.body.CallSid;
  const callStatus = req.body.CallStatus;
  
  if (callStatus === 'completed') {
    const timing = callTimings.get(callId);
    
    if (timing) {
      await finalizeCall({
        callId,
        startedAt: timing.startedAt,
        endedAt: Date.now(),
        durationSeconds: parseInt(req.body.CallDuration || 0),
        usageData: {
          llmTurns: 0, // TODO: Track actual LLM usage
          tier1Count: 0, // TODO: Count from context
          tier2Count: 0,
          tier3Count: 0,
          primaryIntent: 'other', // TODO: Extract from context
          estimatedAiCost: 0
        }
      });
      
      callTimings.delete(callId);
    }
  }
  
  res.sendStatus(200);
});
```

---

## 📊 DATABASE COLLECTIONS

Phase 1 creates these new collections:

- `calltraces` - Call snapshots
- `locations` - Service addresses
- `appointments` - Bookings
- `usagerecords` - Per-call usage
- `companybillingstates` - Billing aggregation

**Note:** `contacts` already exists as `v2contacts` - no changes needed.

---

## 🧪 TESTING CHECKLIST

### 1. Context Lifecycle
- [ ] Call starts → Context created in Redis
- [ ] Transcript updates during call
- [ ] Context persists in Redis during call
- [ ] Call ends → CallTrace created in MongoDB
- [ ] Context deleted from Redis after finalization

### 2. Booking Flow
- [ ] Extract caller info from speech
- [ ] Resolve/create contact
- [ ] Resolve/create location
- [ ] Create appointment
- [ ] appointmentId saved to context

### 3. Usage Tracking
- [ ] UsageRecord created at call end
- [ ] CompanyBillingState updated
- [ ] Minutes calculated correctly
- [ ] Tier usage tracked
- [ ] Costs estimated

### 4. Active Instructions API
- [ ] GET `/api/active-instructions?companyId=123` returns config
- [ ] With callId includes call context
- [ ] Shows matched triage cards
- [ ] Shows tier trace

---

## 🚀 NEXT PHASES (Not in Phase 1)

Phase 1 is **plumbing only**. Future phases will add:

- **Phase 2:** Frontline-Intel integration (LLM-0 orchestration)
- **Phase 3:** Real 3-Tier intelligence routing
- **Phase 4:** Simulator UI with prompts visualization
- **Phase 5:** Calendar integration, SMS confirmations
- **Phase 6:** Advanced booking rules (tech availability, service windows)

---

## 🐛 DEBUGGING

### Check Redis Context
```javascript
const redis = require('./src/config/redisClient');
const ctx = await redis.get('frontline:ctx:CALL_SID_HERE');
console.log(JSON.parse(ctx));
```

### Check MongoDB CallTrace
```javascript
const CallTrace = require('./models/CallTrace');
const trace = await CallTrace.findOne({ callId: 'CALL_SID_HERE' });
console.log(trace);
```

### Check Company Billing
```javascript
const CompanyBillingState = require('./models/CompanyBillingState');
const state = await CompanyBillingState.findOne({ companyId: 'COMPANY_ID' });
console.log(state.usagePercent, state.minutesUsed, state.minutesIncluded);
```

---

## 📝 NOTES

1. **Redis TTL:** Contexts auto-expire after 1 hour (exceptional case for very long calls)
2. **Non-Fatal Errors:** All context operations are logged but don't throw - calls continue even if context fails
3. **Existing Models:** Uses existing `v2Contact.js` - no changes to contact schema
4. **Placeholder Logic:** Usage cost estimation uses placeholder rates - adjust in production
5. **No Business Logic:** BookingHandler is skeleton only - no calendar/availability checks yet

---

## ✅ VALIDATION

After integration, verify:

1. **Redis Keys:** `KEYS frontline:ctx:*` should show active calls
2. **MongoDB Collections:** Check that new collections exist
3. **Call Flow:** Complete test call and verify:
   - Context created/updated/finalized
   - CallTrace document exists
   - UsageRecord created
   - CompanyBillingState updated

---

**Phase 1 Complete!** 🎉

Ready for Phase 2: Frontline-Intel + LLM-0 orchestration

