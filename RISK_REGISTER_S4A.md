# RISK REGISTER - S4A TRIAGE+SCENARIO PIPELINE

**Project:** V116 S4A Implementation  
**Date:** February 16, 2026  
**Owner:** Chief Architect

---

## TOP 10 RISKS (Prioritized by Impact × Probability)

### **RISK 1: Wrong Scenario Match Harms Trust**
**Impact:** HIGH | **Probability:** MEDIUM | **Risk Score:** 8/10

**Description:** Scenario gives wrong reassurance response, caller loses trust in system.

**Example:** Caller says "heater broken" → Scenario says "AC troubleshooting..." (wrong system)

**Mitigation:**
- ✅ Confidence threshold: 0.62 minimum (62% certainty required)
- ✅ Type filter: Only FAQ/TROUBLESHOOT/EMERGENCY allowed
- ✅ Enterprise enforcement: ScenarioEngine auto-filters poor quality scenarios
- ✅ Tier 3 disabled: No LLM hallucination risk
- ✅ Fallback: DiscoveryFlowRunner if uncertain

**Residual Risk:** LOW | **Owner:** Chief Architect

---

### **RISK 2: Booking Flow Derailment**
**Impact:** CRITICAL | **Probability:** LOW | **Risk Score:** 7/10

**Description:** S4A traps caller in reassurance loops, never reaches booking.

**Example:** Triage question → caller answers → another triage question → loop

**Mitigation:**
- ✅ S4A only runs in DISCOVERY lane (not BOOKING)
- ✅ Consent gate unchanged (explicit consent still required)
- ✅ Invariant: "Never block booking" enforced
- ✅ matchSource tracking: Monitor booking funnel metrics

**Residual Risk:** VERY LOW | **Owner:** Product Lead

---

### **RISK 3: Performance Degradation**
**Impact:** HIGH | **Probability:** MEDIUM | **Risk Score:** 7/10

**Description:** S4A adds latency, violates SLO, degrades caller experience.

**Example:** S4A takes 300ms → total turn time 800ms → caller perceives delay

**Mitigation:**
- ✅ Tier 3 disabled for S4A (only Tier 1/2, <100ms)
- ✅ Circuit breaker at 500ms (falls through if slow)
- ✅ Performance monitoring per section
- ✅ Hard stop: p95 >800ms triggers rollback
- ✅ SLO enforcement: Alert if violated

**Residual Risk:** LOW | **Owner:** Engineering Manager

---

### **RISK 4: Config Drift Creates Dead Toggles**
**Impact:** MEDIUM | **Probability:** MEDIUM | **Risk Score:** 5/10

**Description:** Some config flags get wired, others don't, creating partial dead config.

**Example:** `disableScenarioAutoResponses` works, but `autoReplyAllowedScenarioTypes` doesn't

**Mitigation:**
- ✅ ALL frontDeskBehavior.discovery consent flags wired in S4A
- ✅ ALL detectionTriggers wired in S3.5
- ✅ Config validation tool created
- ✅ UI shows wiring status badges

**Residual Risk:** VERY LOW | **Owner:** Chief Architect

---

### **RISK 5: ConversationEngine Resurrection**
**Impact:** HIGH | **Probability:** LOW | **Risk Score:** 5/10

**Description:** Deprecated ConversationEngine gets used accidentally, creating dual execution paths.

**Example:** Code path accidentally calls ConversationEngine.processTurn() instead of FrontDeskCoreRuntime

**Mitigation:**
- ✅ Mark ConversationEngine as DEPRECATED in code
- ✅ Add runtime warning if called
- ✅ Remove from v2twilio.js imports
- ✅ Schedule removal date (Q2 2026)
- ✅ Code review checks for incorrect imports

**Residual Risk:** VERY LOW | **Owner:** Engineering Manager

---

### **RISK 6: Event Logging Failures**
**Impact:** MEDIUM | **Probability:** LOW | **Risk Score:** 3/10

**Description:** S4A/S4B events fail to persist, lose observability.

**Example:** BlackBoxLogger error → no proof of owner selection

**Mitigation:**
- ✅ Events are fire-and-forget (won't block calls)
- ✅ Critical events awaited (S1, S3, OWNER_RESULT)
- ✅ Event buffer flushed asynchronously
- ✅ Alert if S4A event count < 90% of expected

**Residual Risk:** VERY LOW | **Owner:** DevOps

---

### **RISK 7: Scenario Quality Degrades Over Time**
**Impact:** HIGH | **Probability:** LOW | **Risk Score:** 5/10

**Description:** Scenarios start good, degrade as template/company edits accumulate.

**Example:** Admin edits scenario, removes key trigger, confidence drops, more fallbacks

**Mitigation:**
- ✅ Enterprise enforcement always on (ongoing quality filtering)
- ✅ Monitor scenario match rate (alert if drops >20%)
- ✅ Quality dashboard (average confidence, rejection rate)
- ✅ Monthly scenario hygiene review

**Residual Risk:** LOW | **Owner:** Product Lead

---

### **RISK 8: Feature Flag Forgotten On**
**Impact:** MEDIUM | **Probability:** MEDIUM | **Risk Score:** 4/10

**Description:** `_experimentalS4A` left as experimental flag permanently, never becomes default.

**Example:** New companies don't get S4A because flag defaults to false

**Mitigation:**
- ✅ 30-day review: Promote to default if successful
- ✅ After promotion, `_experimentalS4A` removed from code
- ✅ S4A becomes always-on (controlled by disableScenarioAutoResponses)

**Residual Risk:** LOW | **Owner:** Product Lead

---

### **RISK 9: Pending Slot State Migration Failures**
**Impact:** CRITICAL | **Probability:** LOW | **Risk Score:** 6/10

**Description:** Active calls fail during pending slot buffer implementation.

**Example:** Call in progress has no pendingSlots object → runtime crash

**Mitigation:**
- ✅ Backward compatibility: plainSlots still populated
- ✅ Null checks: `state.pendingSlots = state.pendingSlots || {}`
- ✅ Dual-read logic: Check both old and new paths
- ✅ Gradual migration: New calls use pending, old calls continue
- ✅ Testing: Validate with in-progress call state

**Residual Risk:** VERY LOW | **Owner:** Chief Architect

---

### **RISK 10: Detection Trigger False Positives**
**Impact:** LOW | **Probability:** MEDIUM | **Risk Score:** 3/10

**Description:** Detection triggers match incorrectly, activate wrong behaviors.

**Example:** Caller says "cool" → matches "not cooling" trigger (false positive)

**Mitigation:**
- ✅ Platform defaults use full phrases, not single words
- ✅ Word boundary matching (avoid substring matches)
- ✅ Confidence gating (don't act on low-confidence extractions)
- ✅ Monitor false positive rate
- ✅ Company can override/disable triggers

**Residual Risk:** VERY LOW | **Owner:** Chief Architect

---

## RESIDUAL RISK SUMMARY

| Risk Level | Count | Acceptable? |
|------------|-------|-------------|
| CRITICAL | 0 | ✅ YES |
| HIGH | 0 | ✅ YES (all mitigated to LOW) |
| MEDIUM | 0 | ✅ YES (all mitigated to LOW/VERY LOW) |
| LOW | 4 | ✅ YES |
| VERY LOW | 6 | ✅ YES |

**Overall Risk Profile:** ACCEPTABLE for production deployment with feature flag

---

## RISK MONITORING

### **Weekly Risk Review:**
- Review error rates
- Review performance metrics
- Review scenario quality
- Review matchSource distribution
- Update risk scores

### **Monthly Deep Dive:**
- Full scenario pool audit
- Detection trigger effectiveness
- Booking conversion trends
- Customer satisfaction surveys

---

**END OF RISK REGISTER**

*All risks identified and mitigated.*  
*Residual risk acceptable.*  
*Proceed with implementation.*
