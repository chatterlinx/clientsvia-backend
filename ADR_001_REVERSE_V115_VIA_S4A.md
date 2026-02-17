# ADR-001: Reverse V115-TRIAGE-NUKE via Hybrid S4A Layer

**Status:** Proposed → Approved (pending gate validation)  
**Date:** February 16, 2026  
**Decision Makers:** Chief Architect, Product Lead  
**Impact:** HIGH - Changes speaker-ownership contract and runtime execution flow

---

## Context

### Current State (V115-TRIAGE-NUKE)

**Production Runtime:** `FrontDeskCoreRuntime.processTurn()` (services/engine/FrontDeskCoreRuntime.js)

**Architecture Philosophy:** Pure deterministic discovery
- Triage: "Signals only" (intent classification, NO auto-response)
- Scenarios: Not imported (zero scenario matching in discovery)
- Discovery: Step-by-step slot collection via DiscoveryFlowRunner
- Speaker Ownership: 5 authorized modules (GreetingInterceptor, DiscoveryFlowRunner, ConsentGate, BookingFlowRunner, OpenerEngine)

**Execution Flow:**
```
S3: Slot Extraction → S4: DiscoveryFlowRunner (always) → S5: Consent → S6: Booking
```

**What V115 Achieved:**
- ✅ Fast (<300ms per turn)
- ✅ Predictable (deterministic outcomes)
- ✅ Simple (single execution path)
- ✅ Free (no LLM dependency)
- ✅ Fully UI-configurable (Control Plane)

**What V115 Sacrificed:**
- ❌ Caller reassurance ("Got it — AC down. Is it not turning on or not cooling?")
- ❌ Context awareness (ignores volunteered information)
- ❌ Triage help before interrogation
- ❌ Booking conversion: 40% (below target)
- ❌ Caller satisfaction: 30% (feels interrogated)

### Problem Statement

**User Research Finding:**
- Callers say: "This is Mrs. Johnson, 123 Market St, Fort Myers — AC is down"
- System says: "I have 12155 Metro Parkway. Is that correct?" (wrong address, not listening)

**Business Impact:**
- 40% booking conversion (target: 65%)
- 30% caller satisfaction (target: 80%+)
- High support ticket volume ("system doesn't listen")

**Technical Cause:**
- Runtime executes S3 (extraction) → S4 (DiscoveryFlowRunner) with NO reassurance layer
- Config UI has toggles (`disableScenarioAutoResponses`, `autoReplyAllowedScenarioTypes`) that control non-existent features (dead config)
- matchSource distribution: 100% DISCOVERY_FLOW_RUNNER, 0% TRIAGE_SCENARIO

---

## Decision

### **Reverse V115-TRIAGE-NUKE by implementing Hybrid S4A Layer**

**Add reassurance pipeline between slot extraction and discovery:**

```
S3: Slot Extraction
  ↓
S4A-1: Triage Signals (intent, call_reason, urgency) ← NEW
  ↓
S4A-2: Scenario Matching (response if match) ← NEW
  ↓
S4B: Owner Decision (TRIAGE_SCENARIO or DISCOVERY_FLOW) ← NEW
  ↓
S4: DiscoveryFlowRunner (fallback if no match)
  ↓
S5: Consent Gate
  ↓
S6: Booking Flow
```

**S4A Pipeline Design:**

**Step 1: Triage (Extract Intent + Call Reason)**
```javascript
triageResult = await TriageEngineRouter.runTriage(userInput, {...});
// Returns: { intentGuess, callReasonDetail, urgency, signals }
// Stores: call_reason_detail slot immediately (don't wait for confirmation)
```

**Step 2: Scenario Matching (Find Response Using Triage Context)**
```javascript
scenarioResult = await ScenarioEngine.selectResponse({
    ...params,
    session: {
        signals: {
            triageIntent: triageResult.intentGuess,
            callReason: triageResult.callReasonDetail,
            urgency: triageResult.signals.urgency
        }
    },
    options: {
        allowTier3: false,  // Only Tier 1/2 (stay fast <100ms)
        maxCandidates: 3
    }
});
```

**Step 3: Use Response or Fall Through**
```javascript
if (scenarioResult.matched && scenarioResult.confidence >= minConfidence 
    && autoReplyAllowedTypes.includes(scenarioResult.scenario.type)) {
    // Use scenario response (reassure caller)
    return { response: scenario.quickReply, matchSource: 'TRIAGE_SCENARIO_PIPELINE' };
} else {
    // Fall through to DiscoveryFlowRunner (deterministic fallback)
    return DiscoveryFlowRunner.run({...});
}
```

---

## Rationale

### Why Reverse V115?

**1. User Experience is Non-Negotiable**
- Caller experience > code simplicity
- "Feels heard" > "technically elegant"
- 65% booking conversion > 40%

**2. Config UI is Orphaned**
- Front Desk tabs have 9 config flags that do nothing (dead config)
- Users configure `disableScenarioAutoResponses` but it has zero runtime effect
- This erodes platform trust ("why have settings if they don't work?")

**3. ScenarioEngine is Production-Ready**
- Enterprise enforcement built-in (filters poor quality scenarios)
- 3-tier intelligence with performance targets
- Fast lookup optimization (O(1) keyword index)
- Already proven in ConversationEngine path (9,000+ lines of production usage)

**4. Business Impact Justifies Complexity**
- +25% booking conversion = +$900K/year revenue (1,000 calls/month, $300 avg booking)
- +55% caller satisfaction = lower support costs
- Competitive differentiation ("system actually listens")

**5. Hybrid Preserves Safety**
- Deterministic DiscoveryFlowRunner remains as fallback
- Feature flag allows instant rollback
- Circuit breakers prevent runaway latency
- Graceful error handling (no call failures)

---

## Invariants (Must Never Change)

### **Safety Boundaries:**
1. **Never block booking** - S4A must not trap callers in reassurance loops
2. **Never hallucinate actions** - No "dispatching now" unless actually dispatching
3. **Never make commitments** - No pricing guarantees, no medical/legal advice
4. **Never leak PII** - Tenant isolation maintained (ScenarioEngine enforces)
5. **Always have fallback** - DiscoveryFlowRunner is guaranteed safe path

### **Performance Boundaries:**
1. **p95 latency < 500ms** per turn (S4A adds max 100ms for Tier 1/2)
2. **p99 latency < 1000ms** per turn (circuit breaker at 500ms)
3. **Error rate < 0.1%** (graceful fallback on ScenarioEngine errors)

### **Functional Boundaries:**
1. **Single arbiter** - Only ONE module decides final text per turn (no conflicts)
2. **Deterministic booking** - Booking flow unchanged (still V110 deterministic)
3. **Event proof required** - Every decision logged (S4A-1, S4A-2, S4B events mandatory)

---

## Speaker Ownership Contract (Updated)

### Before (V115):
```
Authorized Speakers (5):
1. GreetingInterceptor - Instant greetings
2. DiscoveryFlowRunner - Discovery questions
3. ConsentGate - Consent questions
4. BookingFlowRunner - Booking questions
5. OpenerEngine - Micro-acknowledgments
```

### After (V116):
```
Authorized Speakers (6):
1. GreetingInterceptor - Instant greetings
2. S4A (Triage+Scenario Pipeline) - Reassurance responses ← NEW
3. DiscoveryFlowRunner - Discovery questions (fallback)
4. ConsentGate - Consent questions
5. BookingFlowRunner - Booking questions
6. OpenerEngine - Micro-acknowledgments
```

**Arbitration Rule:**
- S4A runs BEFORE DiscoveryFlowRunner
- IF S4A produces response → DiscoveryFlowRunner skipped
- IF S4A produces no response → DiscoveryFlowRunner runs (safe fallback)
- Only ONE speaks per turn (no conflicts possible)

---

## Alternatives Considered

### Alternative 1: Keep V115 Pure Deterministic
**Rejected.** Caller UX too poor, booking conversion too low, config UI orphaned.

### Alternative 2: Switch to ConversationEngine (LLM-LED)
**Rejected.** Higher cost ($0.002-0.04 per call), slower (800-1200ms), less UI-configurable, abandons V110 investment.

### Alternative 3: Scenarios Only (No Triage)
**Rejected.** Incomplete. Scenarios need triage context (intent, urgency) to match correctly. `call_reason_detail` slot requires triage extraction.

### Alternative 4: Triage Only (No Scenarios)
**Rejected.** Triage contract is "signals only" (no responses). Can't reassure caller with signals alone.

---

## Implementation Strategy

### Feature Flag (Mandatory)
```javascript
_experimentalS4A: true  // Per-company toggle, default: false
```

### Global Kill Switch (Emergency)
```javascript
adminSettings.globalKillSwitches.s4aTriageScenarioPipeline: false
```

### Circuit Breakers
- Performance: >500ms → fallback to DiscoveryFlowRunner
- Error: ScenarioEngine exception → graceful fallback
- Quality: confidence < minConfidence → fallback

### Rollout Plan
- Canary: 1% companies (24h validation)
- Ramp: 10% → 25% → 50% → 100% (hard stop thresholds)
- Rollback: Feature flag toggle (instant), no code deployment

---

## Success Metrics (Hard Thresholds)

### Primary KPI: Booking Conversion
**Definition:** (Calls resulting in booking request) / (Total calls with service request intent)

**Baseline:** 40% (measured over 1,000 calls in January 2026)

**Target:** 65% (+25% relative lift)

**Measurement:**
- Cohort: All discovery-lane calls with service_request intent
- Window: 2 weeks post-100% rollout
- Attribution: matchSource tag (TRIAGE_SCENARIO vs DISCOVERY_FLOW)

**Hard Thresholds:**
- At 10%: No drop > 5% → STOP if violated
- At 50%: Lift > 10% → CONTINUE
- At 100%: Lift > 20% → SUCCESS

### Secondary KPIs:

**Latency (p95):**
- Baseline: 320ms
- Target: <500ms (S4A adds max 100ms)
- Hard stop: >800ms

**Error Rate:**
- Baseline: 0.05%
- Target: <0.1%
- Hard stop: >1%

**matchSource Distribution:**
- Baseline: 100% DISCOVERY_FLOW_RUNNER
- Target: 60-70% TRIAGE_SCENARIO, 30-40% DISCOVERY_FLOW
- Hard stop: <20% TRIAGE_SCENARIO (not working)

---

## Risks & Mitigations

### Risk 1: Wrong Scenario Match (HIGH)
**Risk:** Scenario gives wrong reassurance, caller loses trust.

**Mitigation:**
- Confidence threshold: 0.62 (62% minimum)
- Type filter: Only FAQ/TROUBLESHOOT/EMERGENCY allowed
- Enterprise enforcement: Poor quality scenarios auto-filtered
- Tier 3 disabled: No LLM hallucination risk
- Fallback: DiscoveryFlowRunner if uncertain

### Risk 2: Performance Degradation (MEDIUM)
**Risk:** S4A adds latency, violates SLO.

**Mitigation:**
- Tier 3 disabled for S4A (only Tier 1/2, <100ms)
- Circuit breaker at 500ms (falls through if slow)
- Performance monitoring per section
- Hard stop at p95 >800ms

### Risk 3: Booking Flow Disruption (HIGH)
**Risk:** S4A derails caller from booking funnel.

**Mitigation:**
- S4A only runs in DISCOVERY lane (not BOOKING)
- Consent gate unchanged (booking still requires explicit consent)
- BookingFlowRunner unchanged (deterministic as before)
- Invariant: "Never block booking"

### Risk 4: Deprecated Engine Resurrection (MEDIUM)
**Risk:** ConversationEngine gets used accidentally, creating dual paths.

**Mitigation:**
- Mark ConversationEngine as DEPRECATED in code
- Add runtime warning if called
- Remove from imports where unused
- Schedule removal date (Q2 2026)

### Risk 5: Config Drift (MEDIUM)
**Risk:** Dead config remains, users don't know what works.

**Mitigation:**
- Wire ALL frontDeskBehavior flags to runtime
- Remove truly unused config fields
- Update UI to show wiring status
- Create config validation tool

---

## Deprecation Plan

### ConversationEngine (9,108 lines)
**Status:** Code exists, not used in production

**Plan:**
- **Feb 2026:** Mark as DEPRECATED in comments
- **Mar 2026:** Remove from v2twilio.js imports
- **Apr 2026:** Add runtime warning if called
- **May 2026:** Remove from codebase entirely

**Dependencies to trace:**
- Check if any routes call it
- Check if any tests use it
- Check if any admin tools depend on it

### Dead Config Fields
**Status:** Saves to database, runtime ignores

**Plan:**
- **Feb 2026:** S4A implementation wires all discovery/consent flags
- **Mar 2026:** Audit for remaining dead config
- **Apr 2026:** Remove or wire remaining dead config
- **May 2026:** No dead config allowed (all config is functional)

---

## Observability Requirements

### Events (Mandatory)

**S4A-1: Triage Signals**
```json
{
  "type": "SECTION_S4A_1_TRIAGE_SIGNALS",
  "data": {
    "attempted": true,
    "triageEnabled": true,
    "intentGuess": "service_request",
    "confidence": 0.85,
    "callReasonDetail": "AC not cooling; 92 degrees",
    "urgency": "urgent",
    "matchedCardId": "card_123",
    "durationMs": 28
  }
}
```

**S4A-2: Scenario Match**
```json
{
  "type": "SECTION_S4A_2_SCENARIO_MATCH",
  "data": {
    "attempted": true,
    "disableScenarioAutoResponses": false,
    "autoReplyAllowedTypes": ["FAQ","TROUBLESHOOT","EMERGENCY"],
    "scenarioId": "ac_not_cooling_v2",
    "scenarioType": "TROUBLESHOOT",
    "tier": "TIER_1",
    "confidence": 0.89,
    "minConfidence": 0.62,
    "matched": true,
    "typeAllowed": true,
    "durationMs": 45
  }
}
```

**S4B: Owner Decision**
```json
{
  "type": "SECTION_S4B_DISCOVERY_OWNER_SELECTED",
  "data": {
    "owner": "TRIAGE_SCENARIO_PIPELINE",
    "scenarioId": "ac_not_cooling_v2",
    "triageIntent": "service_request",
    "urgency": "urgent",
    "reason": "TRIAGE_AND_SCENARIO_MATCHED"
  }
}
```

### Dashboards (Required)

**Dashboard 1: S4A Performance**
- matchSource distribution (pie chart: TRIAGE_SCENARIO vs DISCOVERY_FLOW)
- S4A match rate (% of turns where S4A speaks)
- Average latency per section (S4A-1, S4A-2, total)
- Error rate (S4A failures)

**Dashboard 2: Business Impact**
- Booking conversion (before/after cohorts)
- Caller satisfaction (if tracked)
- Turn count to booking (lower is better)
- Support ticket volume

**Dashboard 3: Scenario Quality**
- Top 10 matched scenarios (by frequency)
- Average confidence scores
- Type distribution (FAQ vs TROUBLESHOOT vs EMERGENCY)
- Rejection reasons (type not allowed, score too low, etc.)

### Alerts (Critical)

**Alert 1: Conversion Drop**
- Trigger: Booking conversion drops >5% (relative)
- Action: Auto-freeze rollout, notify on-call, investigate

**Alert 2: Latency Spike**
- Trigger: p95 latency >500ms or p99 >1000ms
- Action: Notify on-call, check circuit breaker logs

**Alert 3: Error Rate Spike**
- Trigger: S4A error rate >1%
- Action: Auto-disable via kill switch, notify on-call

**Alert 4: matchSource Anomaly**
- Trigger: TRIAGE_SCENARIO <5% (not working) or >95% (too aggressive)
- Action: Notify on-call, investigate config

---

## Rollout Plan (Progressive with Gates)

### Stage 0: Governance (Gates)
- [x] ADR written
- [ ] Runtime spec written
- [ ] Risk register written
- [ ] Observability plan written
- [ ] Success metrics defined
- **GO/NO-GO:** All governance docs approved

### Stage 1: Implementation
- [ ] S4A layer code written (world-class quality)
- [ ] Pending slot buffer implemented
- [ ] Detection triggers wired
- [ ] Unit tests passing (10 test cases)
- [ ] Code review completed
- **GO/NO-GO:** All tests pass, code review approved

### Stage 2: Staging Validation
- [ ] Deploy to staging
- [ ] Enable for 1 test company
- [ ] 50 test calls executed
- [ ] All events verified in rawEvents
- [ ] Performance within SLO
- [ ] No errors in logs
- **GO/NO-GO:** All validation criteria met

### Stage 3: Canary (1% Production)
- [ ] Enable for 1% of companies (10-20 companies)
- [ ] Monitor for 24 hours
- [ ] Error rate < 0.1% ✅
- [ ] Latency p95 < 500ms ✅
- [ ] Booking conversion stable or improving ✅
- **GO/NO-GO:** All hard stops green

### Stage 4: Progressive Ramp
- [ ] 10% companies (24h monitor)
- [ ] 25% companies (24h monitor)
- [ ] 50% companies (48h monitor)
- [ ] 100% companies (72h monitor)

**Hard Stop at Each Gate:**
- Error rate > 1% → STOP
- Conversion drop > 5% → STOP
- Latency p95 > 800ms → STOP

### Stage 5: Validation & Measurement
- [ ] Final matchSource distribution (target: 60-70% TRIAGE)
- [ ] Booking conversion measurement (target: +20-25% lift)
- [ ] Caller satisfaction (if measurable)
- [ ] Success metrics documented

---

## Consequences

### Positive
- ✅ Caller experience improves (reassurance before interrogation)
- ✅ Booking conversion increases (projected +25%)
- ✅ Config UI becomes functional (dead config eliminated)
- ✅ Platform trust restored ("settings actually work")
- ✅ Competitive differentiation ("system listens")

### Negative
- ❌ Code complexity increases (hybrid vs pure deterministic)
- ❌ Latency increases (+50-100ms for Tier 1/2 matching)
- ❌ Two-system problem deferred (ConversationEngine still exists)
- ❌ Architectural reversal (contradicts V115 philosophy)
- ❌ Maintenance burden (more code paths to test)

### Accepted Trade-offs
- **Complexity vs UX:** Accept complexity for better UX
- **Latency vs Conversion:** Accept +100ms for +25% conversion
- **Purity vs Pragmatism:** Accept hybrid for business results

---

## Implementation Checklist

### Governance (Phase 1)
- [x] ADR written (this document)
- [ ] Runtime Spec written
- [ ] Risk Register written
- [ ] Observability Plan written
- [ ] Success Metrics defined

### Code (Phase 2)
- [ ] PlatformDefaultTriggers.js created
- [ ] FrontDeskCoreRuntime.js modified (S4A layer)
- [ ] StateStore.js modified (pending slots)
- [ ] SlotExtractor.js modified (pending storage)
- [ ] DiscoveryFlowRunner.js modified (skip pending)
- [ ] BookingFlowRunner.js modified (confirm pending)
- [ ] Speaker ownership contract updated

### Testing (Phase 3)
- [ ] Unit tests (10 test cases)
- [ ] Integration tests (6 scenarios)
- [ ] Staging validation (50 calls)
- [ ] Performance tests (SLO validation)

### Rollout (Phase 4)
- [ ] Canary (1%)
- [ ] Progressive ramp (10% → 100%)
- [ ] Hard stop gates validated

### Cleanup (Phase 5)
- [ ] ConversationEngine deprecated
- [ ] Dead config eliminated
- [ ] Docs cleaned
- [ ] Success metrics documented

---

## Stakeholder Approval

**Required Approvals:**
- [ ] Chief Architect (Technical)
- [ ] Product Lead (Business)
- [ ] Engineering Manager (Resource allocation)
- [ ] QA Lead (Testing strategy)

**Approval Date:** _____________

**Objections/Concerns:** _____________

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1 | 2026-02-16 | Chief Architect | Initial draft |
| 1.0 | ___________ | Chief Architect | Approved after governance gates |

---

## Related Documents

- `S4A_MASTER_IMPLEMENTATION_TRACKER.md` - Progress tracker
- `RUNTIME_SPEC_V116_WITH_S4A.md` - Technical specification
- `RISK_REGISTER_S4A.md` - Risk assessment
- `OBSERVABILITY_PLAN_S4A.md` - Monitoring strategy
- `SUCCESS_METRICS_S4A.md` - Measurement plan

---

**Status:** PROPOSED (pending governance gate completion)  
**Next:** Complete remaining governance documents (Runtime Spec, Risk Register, etc.)  
**After:** Proceed to implementation with full approval

---

**END OF ADR-001**

*This is a formal architectural decision.*  
*All consequences must be understood before approval.*  
*No shortcuts allowed.*
