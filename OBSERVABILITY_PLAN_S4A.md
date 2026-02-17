# OBSERVABILITY PLAN - S4A TRIAGE+SCENARIO PIPELINE

**Project:** V116 S4A Implementation  
**Purpose:** Complete visibility into S4A behavior, performance, and business impact  
**Owner:** Chief Architect + DevOps

---

## 🎯 OBSERVABILITY REQUIREMENTS

### **Must Be Able to Answer These Questions:**

1. Is S4A running? (attempted rate)
2. Is S4A matching? (match rate)
3. Is S4A fast? (latency p50/p95/p99)
4. Is S4A accurate? (conversion by matchSource)
5. Is S4A failing? (error rate, types)
6. Which scenarios match most? (top 10)
7. Why did S4A skip? (skip reasons distribution)
8. Are pending slots working? (storage/confirmation rates)
9. Is booking conversion improving? (before/after cohorts)
10. Should we roll back? (hard stop violations)

---

## 📊 EVENT INSTRUMENTATION

### **S4A Events (Always Emitted):**

```javascript
// Event 1: Triage Attempt
SECTION_S4A_1_TRIAGE_SIGNALS: {
    attempted: boolean,
    triageEnabled: boolean,
    intentGuess: string | null,
    confidence: number,
    callReasonDetail: string | null,
    urgency: string,
    matchedCardId: string | null,
    durationMs: number,
    skipReason: string | null  // If not attempted
}

// Event 2: Scenario Match
SECTION_S4A_2_SCENARIO_MATCH: {
    attempted: boolean,
    disableScenarioAutoResponses: boolean,
    autoReplyAllowedScenarioTypes: string[],
    scenarioId: string | null,
    scenarioType: string | null,
    tier: string | null,
    confidence: number,
    minConfidence: number,
    matched: boolean,
    typeAllowed: boolean,
    hasResponse: boolean,
    durationMs: number,
    skipReason: string | null
}

// Event 3: Owner Decision (Proof)
SECTION_S4B_DISCOVERY_OWNER_SELECTED: {
    owner: 'TRIAGE_SCENARIO_PIPELINE' | 'DISCOVERY_FLOW',
    scenarioId: string | null,
    triageIntent: string | null,
    urgency: string | null,
    reason: string,
    totalS4ADuration: number
}

// Event 4: Pending Slots
SECTION_S3_PENDING_SLOTS_STORED: {
    slotsExtracted: string[],
    confirmedStatus: 'PENDING',
    extractionSources: { slotId: 'utterance' | 'triage' | 'caller_id' }
}

// Event 5: Performance Warning
S4A_PERFORMANCE_WARNING: {
    section: 'S4A_1_TRIAGE' | 'S4A_2_SCENARIO' | 'S4A_TOTAL',
    durationMs: number,
    threshold: number,
    action: 'FALLBACK_TO_DISCOVERY'
}

// Event 6: Error Fallback
S4A_ERROR_FALLBACK: {
    section: 'S4A_1_TRIAGE' | 'S4A_2_SCENARIO',
    error: string,
    action: 'FALLBACK_TO_DISCOVERY'
}
```

---

## 📈 DASHBOARDS

### **Dashboard 1: S4A Health (Real-Time)**

**Metrics:**
- **S4A Attempt Rate:** % of discovery turns where S4A attempted
- **S4A Match Rate:** % of S4A attempts that matched
- **S4A Speak Rate:** % of turns where S4A generated response
- **Fallback Rate:** % of turns where DiscoveryFlowRunner was fallback

**Queries:**
```javascript
// S4A Attempt Rate
db.rawEvents.aggregate([
  { $match: { type: "SECTION_S4A_1_TRIAGE_SIGNALS", timestamp: { $gte: NOW-1h } } },
  { $group: {
      _id: "$data.attempted",
      count: { $sum: 1 }
  }}
])

// S4A Match Rate
db.rawEvents.aggregate([
  { $match: { type: "SECTION_S4A_2_SCENARIO_MATCH", timestamp: { $gte: NOW-1h } } },
  { $group: {
      _id: "$data.matched",
      count: { $sum: 1 }
  }}
])

// matchSource Distribution
db.rawEvents.aggregate([
  { $match: { type: "SECTION_S4B_DISCOVERY_OWNER_SELECTED", timestamp: { $gte: NOW-1h } } },
  { $group: {
      _id: "$data.owner",
      count: { $sum: 1 }
  }}
])
```

**Visualization:** Pie chart (TRIAGE_SCENARIO vs DISCOVERY_FLOW)

---

### **Dashboard 2: Performance Monitoring**

**Metrics:**
- **S4A-1 Latency:** p50/p95/p99 for triage
- **S4A-2 Latency:** p50/p95/p99 for scenario matching
- **Total S4A Latency:** p50/p95/p99 combined
- **Circuit Breaker Triggers:** Count of performance warnings

**Queries:**
```javascript
// S4A-1 Latency Percentiles
db.rawEvents.aggregate([
  { $match: { type: "SECTION_S4A_1_TRIAGE_SIGNALS", timestamp: { $gte: NOW-1h } } },
  { $group: {
      _id: null,
      p50: { $percentile: { input: "$data.durationMs", p: [0.5], method: "approximate" } },
      p95: { $percentile: { input: "$data.durationMs", p: [0.95], method: "approximate" } },
      p99: { $percentile: { input: "$data.durationMs", p: [0.99], method: "approximate" } },
      avg: { $avg: "$data.durationMs" },
      max: { $max: "$data.durationMs" }
  }}
])

// Circuit Breaker Triggers
db.rawEvents.countDocuments({
  type: "S4A_PERFORMANCE_WARNING",
  timestamp: { $gte: NOW-24h }
})
```

**Visualization:** Line chart (latency over time) + threshold markers

**SLO Targets:**
- p50 < 90ms (green)
- p95 < 150ms (green)  
- p99 < 300ms (yellow)
- Circuit breakers < 1% of calls (green)

---

### **Dashboard 3: Scenario Quality**

**Metrics:**
- **Top 10 Matched Scenarios:** By frequency
- **Average Confidence:** Per scenario type
- **Type Distribution:** FAQ vs TROUBLESHOOT vs EMERGENCY
- **Rejection Reasons:** Type not allowed, score too low, no response

**Queries:**
```javascript
// Top 10 Matched Scenarios
db.rawEvents.aggregate([
  { $match: { 
      type: "SECTION_S4A_2_SCENARIO_MATCH",
      "data.matched": true,
      timestamp: { $gte: NOW-7d }
  }},
  { $group: {
      _id: "$data.scenarioId",
      count: { $sum: 1 },
      avgConfidence: { $avg: "$data.confidence" },
      scenarioType: { $first: "$data.scenarioType" }
  }},
  { $sort: { count: -1 } },
  { $limit: 10 }
])

// Rejection Reasons
db.rawEvents.aggregate([
  { $match: { 
      type: "SECTION_S4A_2_SCENARIO_MATCH",
      "data.matched": false,
      timestamp: { $gte: NOW-7d }
  }},
  { $group: {
      _id: "$data.skipReason",
      count: { $sum: 1 }
  }},
  { $sort: { count: -1 } }
])
```

---

### **Dashboard 4: Business Impact**

**Metrics:**
- **Booking Conversion by matchSource**
- **Average Turns to Booking**
- **Call Abandonment Rate**
- **Support Ticket Volume**

**Queries:**
```javascript
// Booking Conversion by matchSource
db.rawEvents.aggregate([
  { $match: { 
      type: "SECTION_S4B_DISCOVERY_OWNER_SELECTED",
      timestamp: { $gte: NOW-7d }
  }},
  { $lookup: {
      from: "bookingRequests",
      localField: "callId",
      foreignField: "callId",
      as: "booking"
  }},
  { $group: {
      _id: "$data.owner",
      totalCalls: { $sum: 1 },
      bookings: { $sum: { $cond: [{ $gt: [{ $size: "$booking" }, 0] }, 1, 0] } }
  }},
  { $project: {
      owner: "$_id",
      totalCalls: 1,
      bookings: 1,
      conversionRate: { $divide: ["$bookings", "$totalCalls"] }
  }}
])

// Average Turns to Booking
db.rawEvents.aggregate([
  { $match: { 
      type: "SECTION_S6_BOOKING_FLOW",
      timestamp: { $gte: NOW-7d }
  }},
  { $group: {
      _id: "$callId",
      turnsToBooking: { $min: "$turn" }
  }},
  { $group: {
      _id: null,
      avgTurns: { $avg: "$turnsToBooking" }
  }}
])
```

---

## 🚨 ALERTS (Auto-Trigger Actions)

### **Alert 1: Conversion Drop (CRITICAL)**

**Trigger Condition:**
```javascript
bookingConversionRate < baseline * 0.95  // >5% drop
```

**Actions:**
1. Auto-freeze rollout (don't expand to next stage)
2. Page on-call engineer
3. Create incident ticket
4. Collect diagnostic data (last 1000 calls)

**Investigation Checklist:**
- Check S4A match rate (is it matching?)
- Check scenario confidence scores (too low?)
- Check error rate (failures causing issues?)
- Review recent scenario edits (quality degraded?)

---

### **Alert 2: Latency Spike (HIGH)**

**Trigger Condition:**
```javascript
p95_latency > 800ms  // Hard stop threshold
```

**Actions:**
1. Page on-call engineer
2. Check circuit breaker logs (which section is slow?)
3. If S4A causing spike → consider kill switch

**Investigation Checklist:**
- Check S4A-1 latency (triage slow?)
- Check S4A-2 latency (scenario matching slow?)
- Check Tier 3 usage (should be 0% for S4A)
- Check ScenarioEngine logs (errors? retries?)

---

### **Alert 3: Error Rate Spike (HIGH)**

**Trigger Condition:**
```javascript
s4a_error_rate > 1%  // >10 errors per 1000 calls
```

**Actions:**
1. Auto-activate global kill switch (if >5% errors)
2. Page on-call engineer
3. Collect error logs (stack traces, contexts)

**Investigation Checklist:**
- Check S4A_TRIAGE_ERROR events (TriageEngineRouter failing?)
- Check S4A_SCENARIO_ERROR events (ScenarioEngine failing?)
- Check ScenarioEngine availability (service up?)
- Check database connectivity (template loading failing?)

---

### **Alert 4: matchSource Anomaly (MEDIUM)**

**Trigger Condition:**
```javascript
triage_scenario_rate < 20%  // Not working
OR
triage_scenario_rate > 95%  // Too aggressive
```

**Actions:**
1. Notify on-call engineer
2. Investigate config (thresholds too high/low?)
3. Investigate scenario pool (too few/too many matches?)

---

## 📊 MONITORING QUERIES (Pre-Built)

### **Query 1: Is S4A Working?**
```javascript
// Run this to verify S4A is active
db.rawEvents.aggregate([
  { $match: { 
      type: "SECTION_S4B_DISCOVERY_OWNER_SELECTED",
      timestamp: { $gte: new Date(Date.now() - 3600000) }  // Last hour
  }},
  { $group: {
      _id: "$data.owner",
      count: { $sum: 1 },
      percentage: { $avg: 1 }
  }}
])

// Expected: TRIAGE_SCENARIO_PIPELINE appears with >40% share
```

---

### **Query 2: What's the Performance Profile?**
```javascript
// S4A latency breakdown
db.rawEvents.aggregate([
  { $match: { 
      type: { $in: ["SECTION_S4A_1_TRIAGE_SIGNALS", "SECTION_S4A_2_SCENARIO_MATCH"] },
      timestamp: { $gte: new Date(Date.now() - 3600000) }
  }},
  { $group: {
      _id: "$type",
      avgLatency: { $avg: "$data.durationMs" },
      p95Latency: { $percentile: { input: "$data.durationMs", p: [0.95], method: "approximate" } },
      count: { $sum: 1 }
  }}
])

// Expected: S4A-1 <50ms, S4A-2 <100ms
```

---

### **Query 3: What Scenarios Are Matching?**
```javascript
// Top scenarios by usage
db.rawEvents.aggregate([
  { $match: { 
      type: "SECTION_S4A_2_SCENARIO_MATCH",
      "data.matched": true,
      timestamp: { $gte: new Date(Date.now() - 604800000) }  // Last week
  }},
  { $group: {
      _id: {
          scenarioId: "$data.scenarioId",
          scenarioType: "$data.scenarioType"
      },
      count: { $sum: 1 },
      avgConfidence: { $avg: "$data.confidence" }
  }},
  { $sort: { count: -1 } },
  { $limit: 10 }
])
```

---

### **Query 4: Why is S4A Skipping?**
```javascript
// Skip reason distribution
db.rawEvents.aggregate([
  { $match: { 
      type: "SECTION_S4A_2_SCENARIO_MATCH",
      "data.matched": false,
      timestamp: { $gte: new Date(Date.now() - 86400000) }  // Last 24h
  }},
  { $group: {
      _id: "$data.skipReason",
      count: { $sum: 1 }
  }},
  { $sort: { count: -1 } }
])

// Expected reasons: SCORE_TOO_LOW, TYPE_NOT_ALLOWED, NO_RESPONSE, CONFIG_DISABLED
```

---

### **Query 5: Conversion by matchSource**
```javascript
// Booking conversion comparison
db.rawEvents.aggregate([
  { $match: { 
      type: "SECTION_S4B_DISCOVERY_OWNER_SELECTED",
      timestamp: { $gte: new Date(Date.now() - 1209600000) }  // Last 2 weeks
  }},
  { $lookup: {
      from: "bookingRequests",
      localField: "callId",
      foreignField: "callId",
      as: "booking"
  }},
  { $group: {
      _id: "$data.owner",
      totalCalls: { $sum: 1 },
      conversions: { $sum: { $cond: [{ $gt: [{ $size: "$booking" }, 0] }, 1, 0] } }
  }},
  { $project: {
      owner: "$_id",
      totalCalls: 1,
      conversions: 1,
      conversionRate: { $multiply: [{ $divide: ["$conversions", "$totalCalls"] }, 100] }
  }}
])
```

---

## 🔔 ALERT CONFIGURATION

### **Alert Definitions (Prometheus/Grafana Style):**

```yaml
alerts:
  - name: S4A_Conversion_Drop
    expr: |
      (
        sum(rate(booking_requests_total{matchSource="TRIAGE_SCENARIO_PIPELINE"}[1h])) 
        / 
        sum(rate(calls_total{lane="DISCOVERY"}[1h]))
      ) < 0.40
    for: 30m
    severity: critical
    annotations:
      summary: "S4A booking conversion below 40%"
      action: "Auto-freeze rollout, investigate matchSource=DISCOVERY_FLOW conversion"

  - name: S4A_Latency_P95_High
    expr: |
      histogram_quantile(0.95, 
        sum(rate(s4a_duration_ms_bucket[5m])) by (le)
      ) > 500
    for: 15m
    severity: warning
    annotations:
      summary: "S4A p95 latency above 500ms"
      action: "Check circuit breaker logs, consider Tier adjustment"

  - name: S4A_Error_Rate_High
    expr: |
      sum(rate(s4a_errors_total[5m])) 
      / 
      sum(rate(s4a_attempts_total[5m])) 
      > 0.01
    for: 10m
    severity: critical
    annotations:
      summary: "S4A error rate above 1%"
      action: "Check logs, consider kill switch if >5%"

  - name: S4A_Not_Matching
    expr: |
      sum(rate(s4a_matched_total[1h])) 
      / 
      sum(rate(s4a_attempts_total[1h])) 
      < 0.20
    for: 2h
    severity: warning
    annotations:
      summary: "S4A match rate below 20%"
      action: "Investigate scenario pool quality, check confidence thresholds"
```

---

## 📊 GRAFANA DASHBOARD PANELS

### **Panel 1: S4A Match Rate (Gauge)**
- Query: `sum(rate(s4a_matched_total[5m])) / sum(rate(s4a_attempts_total[5m]))`
- Target: 60-70%
- Thresholds: <20% red, 20-40% yellow, 40-80% green, >80% yellow

### **Panel 2: matchSource Distribution (Pie Chart)**
- Query: `sum by (owner) (rate(section_s4b_owner_selected[1h]))`
- Labels: TRIAGE_SCENARIO_PIPELINE, DISCOVERY_FLOW
- Target: 60-70% TRIAGE, 30-40% DISCOVERY

### **Panel 3: S4A Latency (Graph)**
- Query: `histogram_quantile(0.95, sum(rate(s4a_duration_ms_bucket[5m])) by (le, section))`
- Lines: S4A-1 (triage), S4A-2 (scenario), Total
- Thresholds: 500ms (yellow), 800ms (red)

### **Panel 4: Booking Conversion (Graph)**
- Query: `sum by (matchSource) (rate(booking_requests_total[1h])) / sum by (matchSource) (rate(calls_total[1h]))`
- Lines: TRIAGE_SCENARIO (green), DISCOVERY_FLOW (blue), Overall (black)
- Target: Overall >60%

### **Panel 5: Error Rate (Graph)**
- Query: `sum(rate(s4a_errors_total[5m])) / sum(rate(s4a_attempts_total[5m]))`
- Threshold: 1% (red line)
- Target: <0.1%

---

## 🔍 DEBUGGING TOOLS

### **Tool 1: S4A Call Trace (Per Call)**

**Query:**
```javascript
// Get complete S4A trace for specific call
db.rawEvents.find({
  callId: "CAxxxx",
  type: { $regex: "S4A|S4B" }
}).sort({ turn: 1 })
```

**Returns:**
- S4A-1 triage result
- S4A-2 scenario match result
- S4B owner decision
- Complete audit trail for one call

---

### **Tool 2: S4A Performance Trace (Slow Calls)**

**Query:**
```javascript
// Find slow S4A calls
db.rawEvents.aggregate([
  { $match: { 
      type: "SECTION_S4B_DISCOVERY_OWNER_SELECTED",
      "data.totalS4ADuration": { $gt: 300 },
      timestamp: { $gte: NOW-1h }
  }},
  { $sort: { "data.totalS4ADuration": -1 } },
  { $limit: 10 }
])
```

**Returns:** Top 10 slowest S4A executions for investigation

---

### **Tool 3: S4A Scenario Miss Analysis**

**Query:**
```javascript
// Calls where triage matched but scenario didn't
db.rawEvents.aggregate([
  { $match: { 
      type: "SECTION_S4A_1_TRIAGE_SIGNALS",
      "data.confidence": { $gte: 0.62 },
      timestamp: { $gte: NOW-24h }
  }},
  { $lookup: {
      from: "rawEvents",
      let: { callId: "$callId", turn: "$turn" },
      pipeline: [
        { $match: {
            $expr: {
              $and: [
                { $eq: ["$callId", "$$callId"] },
                { $eq: ["$turn", "$$turn"] },
                { $eq: ["$type", "SECTION_S4A_2_SCENARIO_MATCH"] }
              ]
            }
        }}
      ],
      as: "scenarioMatch"
  }},
  { $match: { "scenarioMatch.data.matched": false } },
  { $project: {
      callId: 1,
      triageIntent: "$data.intentGuess",
      triageConfidence: "$data.confidence",
      scenarioSkipReason: { $arrayElemAt: ["$scenarioMatch.data.skipReason", 0] }
  }}
])
```

**Returns:** Triage matches that didn't convert to scenario matches (gap analysis)

---

## 📞 ON-CALL PLAYBOOK

### **Scenario 1: Conversion Drop Alert**

**Symptoms:** Alert fires, conversion <40%

**Investigation Steps:**
1. Check matchSource distribution (is S4A matching at all?)
2. If TRIAGE_SCENARIO=0% → S4A not working, check feature flags
3. If TRIAGE_SCENARIO=70% but conversion low → Wrong scenarios matching
4. Review top 10 matched scenarios (quality issues?)
5. Check skip reasons (why are good scenarios rejected?)

**Resolution:**
- If S4A not working → Check config, restart services
- If wrong scenarios → Adjust minConfidence threshold
- If quality issues → Disable specific scenarios, improve quality
- Last resort → Activate global kill switch

---

### **Scenario 2: Latency Spike Alert**

**Symptoms:** p95 latency >800ms

**Investigation Steps:**
1. Check which section is slow (S4A-1 vs S4A-2 vs other)
2. If S4A-1 slow → TriageEngineRouter issue, check logs
3. If S4A-2 slow → ScenarioEngine issue, check Tier usage
4. Check circuit breaker trigger count (is fallback working?)

**Resolution:**
- If TriageEngineRouter slow → Investigate, may need optimization
- If ScenarioEngine slow → Check if Tier 3 enabled (should be disabled)
- If persistent → Activate kill switch, investigate offline

---

### **Scenario 3: Error Rate Spike Alert**

**Symptoms:** Errors >1% of S4A attempts

**Investigation Steps:**
1. Collect error logs (S4A_TRIAGE_ERROR + S4A_SCENARIO_ERROR)
2. Identify error type (database? network? code bug?)
3. Check if graceful fallback working (calls still completing?)

**Resolution:**
- If graceful fallback working → Investigate, fix, keep running
- If calls failing → Activate kill switch immediately
- If database issue → Fix database, re-enable

---

## 🧪 VALIDATION CHECKLIST (Pre-Rollout)

### **Staging Environment:**
- [ ] All S4A events appearing in rawEvents
- [ ] S4A-1 event has triageIntent, callReasonDetail
- [ ] S4A-2 event has scenarioId, confidence, tier
- [ ] S4B event has owner decision + reason
- [ ] matchSource shows some TRIAGE_SCENARIO
- [ ] Latency within SLO (p95 <500ms)
- [ ] No errors in 50 test calls
- [ ] Pending slots stored and confirmed correctly
- [ ] call_reason_detail populated by triage
- [ ] DiscoveryFlowRunner fallback works

### **Canary (1%):**
- [ ] Monitor for 24 hours
- [ ] Error rate <0.1%
- [ ] Conversion stable or improving
- [ ] Latency p95 <500ms
- [ ] No customer complaints

---

## 📈 SUCCESS DASHBOARD (Post-Rollout)

**Metrics to Track:**

| Metric | Baseline (V115) | Target (V116) | Actual | Status |
|--------|----------------|---------------|--------|--------|
| Booking Conversion | 40% | 65% | ___% | ___ |
| matchSource: TRIAGE | 0% | 60-70% | ___% | ___ |
| Latency p95 | 320ms | <500ms | ___ms | ___ |
| Error Rate | 0.05% | <0.1% | ___% | ___ |
| Caller Satisfaction | 30% | 80%+ | ___% | ___ |

---

**END OF OBSERVABILITY PLAN**

*Complete visibility into S4A.*  
*No blind spots.*  
*Ready for production monitoring.*
