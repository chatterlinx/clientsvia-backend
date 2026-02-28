# Intent Audit Trail - Understanding vs Action Tracking
**Created:** 2026-02-28  
**Version:** V126 (proposed)  
**Goal:** Track what agent understood vs what agent did

---

## 🎯 **THE CONCEPT**

### **Three-Layer Truth:**

```
1️⃣ UNDERSTANDING (What agent heard/extracted)
   - Caller intent detected
   - Entities extracted
   - Urgency level assessed
   - Service type identified

2️⃣ DECISION (What agent planned to do)
   - Which path to take
   - Which trigger to use
   - Which question to ask
   - Why this choice was made

3️⃣ ACTION (What agent actually did)
   - Response sent
   - Audio played
   - Next step triggered
   - State updated
```

### **Audit = Compare all three layers**

**Example of MISMATCH:**

```
UNDERSTANDING:
✅ Intent: "book appointment"
✅ Service: "AC repair"
✅ Urgency: "today"
✅ Name: "Mark"

DECISION:
❌ Plan: Use fallback (no trigger matched)
❌ Reason: Trigger "Schedule AC Appointment" was disabled
❌ Path: FALLBACK_NO_BOOKING_TRIGGER

ACTION:
❌ Response: "Sorry, you cut out. How can I help?"
❌ Audio: Generic fallback TTS
❌ State: Still in DISCOVERY (should be BOOKING)

🚨 MISMATCH DETECTED:
Agent understood booking intent but didn't start booking flow!
Root cause: Booking trigger disabled or missing.
```

---

## 📊 **EVENT STRUCTURE: INTENT_AUDIT_TRAIL**

Add this event to every turn:

```javascript
{
  type: 'INTENT_AUDIT_TRAIL',
  turn: 1,
  timestamp: '2026-02-28T11:51:11.000Z',
  data: {
    // 1️⃣ UNDERSTANDING LAYER
    understanding: {
      rawInput: "Hey John, this is Mark. Um I need to book an appointment today",
      cleanedInput: "John this is Mark need to book appointment today",
      
      detectedIntent: {
        primary: "BOOKING",           // What caller wants to do
        confidence: 0.95,
        keywords: ["book", "appointment", "today"],
        type: "explicit"              // explicit vs inferred
      },
      
      extractedEntities: {
        firstName: "Mark",
        recipientName: "John",
        serviceType: null,            // Not mentioned yet
        urgency: "today",
        timeframe: "today"
      },
      
      businessContext: {
        isEmergency: false,
        isUrgent: true,               // "today" = urgent
        isServiceDown: false,
        needsImmediate: false
      }
    },
    
    // 2️⃣ DECISION LAYER
    decision: {
      plannedPath: "TRIGGER_BOOKING",  // What we SHOULD do
      actualPath: "FALLBACK_GENERIC",  // What we ACTUALLY did
      
      pathReasoning: {
        triggerEvaluated: true,
        triggerMatched: false,        // ❌ Should have matched!
        triggerBlockedReason: "Booking trigger disabled in config",
        
        greetingEvaluated: true,
        greetingMatched: false,
        
        llmEvaluated: false,
        llmBlocked: true,
        llmBlockReason: "Max LLM turns reached",
        
        fallbackUsed: true,
        fallbackReason: "No trigger matched, LLM blocked"
      },
      
      expectedNextState: "BOOKING",   // Where we SHOULD go
      actualNextState: "DISCOVERY"    // Where we ACTUALLY went
    },
    
    // 3️⃣ ACTION LAYER
    action: {
      responseSent: "Sorry — you cut out. How can I help?",
      responseSource: "FALLBACK_HARDCODED",
      audioUrl: null,
      ttsProvider: "elevenlabs",
      
      stateChanges: {
        sessionMode: "DISCOVERY",     // Should be BOOKING
        slotsUpdated: ["firstName"],  // Mark extracted but not used
        nextStepSet: null
      },
      
      nextTurnExpectation: "Open-ended question" // Should be "Collect service type"
    },
    
    // 🚨 MISMATCH DETECTION
    mismatches: [
      {
        severity: "CRITICAL",
        type: "INTENT_NOT_HONORED",
        description: "Caller clearly wants to book appointment, but booking flow not triggered",
        understanding: "BOOKING intent detected (confidence 0.95)",
        decision: "No booking trigger matched (trigger disabled)",
        action: "Generic fallback used instead of booking",
        impact: "Customer has to repeat request, poor UX",
        suggestedFix: "Enable booking trigger or create one for 'book appointment' keywords"
      },
      {
        severity: "MEDIUM",
        type: "ENTITY_EXTRACTED_NOT_USED",
        description: "Name 'Mark' extracted but not acknowledged in response",
        understanding: "firstName: 'Mark' extracted by ScrabEngine",
        decision: "Fallback path doesn't use personalized greeting",
        action: "Generic response without name",
        impact: "Missed personalization opportunity",
        suggestedFix: "Use {name} variable in fallback responses"
      }
    ],
    
    // ✅ MATCHES (Things that worked correctly)
    matches: [
      {
        type: "ENTITY_EXTRACTION_SUCCESS",
        description: "Name extracted correctly from 'this is Mark'",
        details: "ScrabEngine Stage 4 found firstName: 'Mark'"
      },
      {
        type: "URGENCY_DETECTED",
        description: "Urgency 'today' correctly identified",
        details: "Keyword 'today' flagged as urgent timeframe"
      }
    ]
  }
}
```

---

## 🎨 **CALL CONSOLE VISUALIZATION**

### **New Section: Intent Audit**

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🔍 INTENT AUDIT - Turn 1                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ 1️⃣ WHAT AGENT UNDERSTOOD                                            │
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │ Intent: BOOKING (95% confidence)                                ││
│ │ Service: Not specified yet                                      ││
│ │ Urgency: TODAY (urgent)                                         ││
│ │ Entities: firstName="Mark", recipientName="John"                ││
│ └──────────────────────────────────────────────────────────────────┘│
│                                                                      │
│ 2️⃣ WHAT AGENT PLANNED TO DO                                         │
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │ Expected Path: TRIGGER_BOOKING → Start booking flow            ││
│ │ Trigger Evaluation: 23 cards checked                            ││
│ │ Booking Trigger: ❌ NOT MATCHED                                 ││
│ │ Reason: Trigger disabled in config                              ││
│ │ Fallback: Generic response (no LLM available)                   ││
│ └──────────────────────────────────────────────────────────────────┘│
│                                                                      │
│ 3️⃣ WHAT AGENT ACTUALLY DID                                          │
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │ Actual Path: FALLBACK_GENERIC                                   ││
│ │ Response: "Sorry — you cut out. How can I help?"                ││
│ │ State: Stayed in DISCOVERY (should have gone to BOOKING)        ││
│ │ Next Turn: Open-ended (should be collecting service details)    ││
│ └──────────────────────────────────────────────────────────────────┘│
│                                                                      │
│ 🚨 MISMATCHES DETECTED (2)                                           │
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │ ❌ CRITICAL: Intent Not Honored                                 ││
│ │    Understanding: Booking intent (95% confidence)               ││
│ │    Decision: No booking trigger matched                         ││
│ │    Action: Generic fallback instead of booking                  ││
│ │    Fix: Enable booking trigger for "book appointment"           ││
│ │                                                                  ││
│ │ ⚠️ MEDIUM: Entity Extracted Not Used                            ││
│ │    Understanding: Name "Mark" extracted                         ││
│ │    Decision: Fallback doesn't use {name} variable               ││
│ │    Action: Generic response without personalization             ││
│ │    Fix: Add {name} to fallback responses                        ││
│ └──────────────────────────────────────────────────────────────────┘│
│                                                                      │
│ ✅ WHAT WORKED (2)                                                   │
│ • Name extraction: "Mark" correctly identified                      │
│ • Urgency detection: "today" flagged as urgent                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔧 **IMPLEMENTATION**

### **Step 1: Add Intent Extraction to ScrabEngine**

**File:** `services/ScrabEngine.js`

Add intent classification to Stage 4:

```javascript
// Stage 4: Entity Extraction + Intent Classification
const entities = {
  firstName: extractedFirstName,
  lastName: extractedLastName,
  phone: extractedPhone,
  email: extractedEmail,
  
  // NEW: Intent classification
  detectedIntent: classifyIntent(normalizedText),
  businessContext: assessBusinessContext(normalizedText)
};

function classifyIntent(text) {
  const intentPatterns = {
    BOOKING: ['book', 'schedule', 'appointment', 'set up', 'reserve'],
    EMERGENCY: ['emergency', 'urgent', 'asap', 'right now', 'immediately'],
    SERVICE_DOWN: ['not working', 'broken', 'stopped', 'dead', 'wont'],
    QUESTION: ['how', 'what', 'when', 'why', 'can you', 'do you'],
    CANCEL: ['cancel', 'reschedule', 'change', 'move'],
    CALLBACK: ['call back', 'call me', 'reach me']
  };
  
  // Check for patterns, return highest confidence match
  // ...
}
```

### **Step 2: Track Decision Logic**

**File:** `services/engine/agent2/Agent2DiscoveryRunner.js`

Add decision audit event:

```javascript
// After trigger evaluation, before response
emit('INTENT_DECISION_AUDIT', {
  understanding: {
    detectedIntent: scrabResult.entities?.detectedIntent,
    extractedEntities: scrabResult.entities,
    urgency: assessUrgency(scrabResult.entities),
    confidence: scrabResult.entities?.detectedIntent?.confidence
  },
  
  decision: {
    plannedPath: determineExpectedPath(scrabResult.entities.detectedIntent),
    actualPath: triggerResult.matched ? 'TRIGGER' : 'FALLBACK',
    reasoning: {
      triggerMatched: triggerResult.matched,
      triggerCard: triggerResult.matched ? triggerResult.card.label : null,
      greetingMatched: greetingDetected,
      llmBlocked: llmBlockReason,
      fallbackUsed: !triggerResult.matched
    }
  },
  
  action: {
    responseSent: finalResponse,
    responseSource: matchSource,
    stateChanges: {
      sessionMode: nextState.sessionMode,
      slotsUpdated: Object.keys(updatedSlots)
    }
  },
  
  mismatches: detectMismatches(understanding, decision, action)
});
```

### **Step 3: Mismatch Detection**

Add automatic mismatch detection:

```javascript
function detectMismatches(understanding, decision, action) {
  const mismatches = [];
  
  // CRITICAL: Booking intent but not in booking mode
  if (understanding.detectedIntent?.primary === 'BOOKING' && 
      action.stateChanges.sessionMode !== 'BOOKING') {
    mismatches.push({
      severity: 'CRITICAL',
      type: 'INTENT_NOT_HONORED',
      description: 'Booking intent detected but booking flow not triggered',
      suggestedFix: 'Check if booking trigger is enabled and has correct keywords'
    });
  }
  
  // MEDIUM: Entity extracted but not used in response
  if (understanding.extractedEntities?.firstName && 
      !action.responseSent.includes(understanding.extractedEntities.firstName)) {
    mismatches.push({
      severity: 'MEDIUM',
      type: 'ENTITY_UNUSED',
      description: `Name "${understanding.extractedEntities.firstName}" extracted but not used`,
      suggestedFix: 'Use {name} variable in response templates'
    });
  }
  
  // CRITICAL: Emergency detected but no escalation
  if (understanding.businessContext?.isEmergency && 
      !action.stateChanges.escalated) {
    mismatches.push({
      severity: 'CRITICAL',
      type: 'EMERGENCY_NOT_ESCALATED',
      description: 'Emergency keywords detected but no emergency protocol triggered',
      suggestedFix: 'Check emergency trigger configuration'
    });
  }
  
  return mismatches;
}
```

---

## 🎨 **CALL CONSOLE UI - Intent Audit View**

### **New Toggle in Turn Display:**

```
Turn 1
  🎤 Caller Input
  🔍 ScrabEngine Pipeline
  🎭 Greeting Check
  🎯 Trigger Evaluation
  💬 Agent Response
  
  🔎 INTENT AUDIT ← NEW (click to expand)
     ├─ What agent understood
     ├─ What agent planned
     ├─ What agent did
     └─ Mismatches (if any)
```

### **Expanded View:**

```html
<div class="intent-audit-section">
  <h5>🔎 Intent Audit Trail</h5>
  
  <!-- Understanding Layer -->
  <div class="audit-layer understanding">
    <h6>1️⃣ What Agent Understood</h6>
    <div class="audit-grid">
      <div class="audit-item">
        <span class="label">Primary Intent:</span>
        <span class="value success">BOOKING (95% confidence)</span>
      </div>
      <div class="audit-item">
        <span class="label">Service Type:</span>
        <span class="value">Not specified</span>
      </div>
      <div class="audit-item">
        <span class="label">Urgency:</span>
        <span class="value warning">TODAY (urgent)</span>
      </div>
      <div class="audit-item">
        <span class="label">Caller Name:</span>
        <span class="value success">Mark</span>
      </div>
    </div>
  </div>
  
  <!-- Decision Layer -->
  <div class="audit-layer decision">
    <h6>2️⃣ What Agent Planned to Do</h6>
    <div class="audit-grid">
      <div class="audit-item">
        <span class="label">Expected Path:</span>
        <span class="value">TRIGGER_BOOKING → Start booking flow</span>
      </div>
      <div class="audit-item">
        <span class="label">Trigger Match:</span>
        <span class="value error">❌ NO MATCH</span>
      </div>
      <div class="audit-item">
        <span class="label">Blocked Reason:</span>
        <span class="value">Booking trigger disabled</span>
      </div>
      <div class="audit-item">
        <span class="label">Fallback Used:</span>
        <span class="value warning">Generic fallback (no LLM)</span>
      </div>
    </div>
  </div>
  
  <!-- Action Layer -->
  <div class="audit-layer action">
    <h6>3️⃣ What Agent Actually Did</h6>
    <div class="audit-grid">
      <div class="audit-item">
        <span class="label">Actual Path:</span>
        <span class="value error">FALLBACK_GENERIC</span>
      </div>
      <div class="audit-item">
        <span class="label">Response:</span>
        <span class="value">"Sorry — you cut out..."</span>
      </div>
      <div class="audit-item">
        <span class="label">State Change:</span>
        <span class="value error">Stayed in DISCOVERY (should be BOOKING)</span>
      </div>
      <div class="audit-item">
        <span class="label">Name Used:</span>
        <span class="value error">❌ NO (extracted but not used)</span>
      </div>
    </div>
  </div>
  
  <!-- Mismatches -->
  <div class="audit-mismatches">
    <h6>🚨 Mismatches Detected (2)</h6>
    
    <div class="mismatch-item critical">
      <div class="mismatch-header">
        <span class="severity">CRITICAL</span>
        <span class="type">Intent Not Honored</span>
      </div>
      <p class="mismatch-description">
        Agent understood booking intent (95% confidence) but didn't start booking flow.
      </p>
      <div class="mismatch-details">
        <div><strong>Understanding:</strong> Booking intent detected</div>
        <div><strong>Decision:</strong> No booking trigger matched (disabled)</div>
        <div><strong>Action:</strong> Generic fallback used</div>
        <div class="fix-suggestion">
          <strong>💡 Fix:</strong> Enable booking trigger with keywords: "book", "schedule", "appointment"
        </div>
      </div>
    </div>
    
    <div class="mismatch-item medium">
      <div class="mismatch-header">
        <span class="severity">MEDIUM</span>
        <span class="type">Entity Extracted Not Used</span>
      </div>
      <p class="mismatch-description">
        Name "Mark" extracted but not acknowledged in response.
      </p>
      <div class="fix-suggestion">
        <strong>💡 Fix:</strong> Add {name} variable to fallback response templates
      </div>
    </div>
  </div>
  
  <!-- What Worked -->
  <div class="audit-matches">
    <h6>✅ What Worked (2)</h6>
    <ul>
      <li>Name extraction: "Mark" correctly identified</li>
      <li>Urgency detection: "today" flagged as urgent</li>
    </ul>
  </div>
</div>
```

---

## 🔢 **INTENT CODES - Classification System**

### **Primary Intent Types:**

| Code | Name | Keywords | Expected Path |
|------|------|----------|---------------|
| `BOOKING` | Schedule Appointment | book, schedule, appointment | → BOOKING mode |
| `EMERGENCY` | Emergency Service | emergency, urgent, asap | → EMERGENCY escalation |
| `SERVICE_DOWN` | Equipment Failure | not working, broken, down | → URGENT trigger |
| `QUESTION` | Information Request | how, what, when, why | → FAQ trigger or LLM |
| `CANCEL` | Cancel/Reschedule | cancel, reschedule, change | → BOOKING modify |
| `CALLBACK` | Request Callback | call back, call me back | → CALLBACK trigger |
| `COMPLAINT` | Issue/Complaint | problem, issue, unhappy | → ESCALATION |
| `GREETING_ONLY` | Pure Greeting | hi, hello (alone) | → GREETING response |
| `HOLD_REQUEST` | Caller Needs Time | hold on, one moment | → PATIENCE mode |
| `UNKNOWN` | Unclear Intent | — | → LLM assist or clarify |

### **Business Context Flags:**

| Flag | Detection | Action Required |
|------|-----------|-----------------|
| `isEmergency` | "emergency", "urgent", "asap" | Escalate immediately |
| `isServiceDown` | "not working", "broken" | Priority response |
| `needsImmediate` | "now", "immediately", "tonight" | Same-day protocol |
| `hasComplaint` | "unhappy", "issue", "problem" | Empathy + escalation |
| `isPriceQuestion` | "cost", "price", "how much" | Pricing trigger |
| `isScheduleQuestion` | "available", "when", "schedule" | Availability check |

---

## 📊 **DASHBOARD: Intent Match Rate**

Add a new metric to company dashboard:

```
┌────────────────────────────────────────────┐
│ Intent Match Rate (Last 7 Days)            │
├────────────────────────────────────────────┤
│ Total Calls: 150                           │
│ Intents Detected: 127 (85%)                │
│ Intents Honored: 98 (77%)                  │
│ ❌ Intent Mismatches: 29 (23%) ← RED FLAG  │
│                                            │
│ Top Mismatches:                            │
│ 1. Booking intent → Fallback (18 calls)   │
│ 2. Emergency → Generic response (6 calls)  │
│ 3. Question → Wrong trigger (5 calls)      │
│                                            │
│ 💡 Suggested Fixes:                        │
│ • Enable booking trigger                   │
│ • Add emergency keywords to trigger        │
│ • Review FAQ trigger configuration         │
└────────────────────────────────────────────┘
```

---

## 🎯 **VALUE: Why This Matters**

### **Before Intent Audit:**
**Developer debugging:**
- "Why didn't booking work?"
- Reads code for 2 hours
- Checks config files
- Searches logs
- Still can't tell if intent was even detected

**Result:** 2-4 hours per bug, blind debugging

### **After Intent Audit:**
**Developer clicks on call:**
- See: "Booking intent detected (95%)"
- See: "Booking trigger disabled"
- See: "Fallback used instead"
- See: "Fix: Enable trigger with keywords X, Y, Z"

**Result:** 2 minutes to identify root cause + fix

---

## 📝 **IMPLEMENTATION PLAN**

### **Phase 1: Basic Intent Tracking (Quick Win - 2 hours)**
1. Add intent classification to ScrabEngine Stage 4
2. Emit `INTENT_DETECTED` event with classification
3. Show detected intent in Call Console (simple badge)
4. Show if intent was honored (yes/no)

### **Phase 2: Decision Audit (Medium - 4 hours)**
5. Track expected path vs actual path
6. Emit `DECISION_AUDIT` event
7. Show decision reasoning in Call Console
8. Highlight mismatches in red

### **Phase 3: Mismatch Detection (Full - 8 hours)**
9. Automated mismatch detection
10. Severity classification (CRITICAL/MEDIUM/LOW)
11. Suggested fixes
12. Dashboard aggregation (intent match rate)

---

## ✅ **SUCCESS CRITERIA**

**Intent Audit is complete when:**

1. ✅ Every turn shows detected intent
2. ✅ Every turn shows if intent was honored
3. ✅ Mismatches are automatically detected
4. ✅ Root causes are explained
5. ✅ Fixes are suggested
6. ✅ Dashboard shows intent match rate

**Developer can answer in < 30 seconds:**
- "What did the caller want?" → Detected intent
- "Did agent do it?" → Intent honored yes/no
- "If not, why?" → Mismatch reason + fix

---

## 🚀 **QUICK START**

Want to implement the **minimal viable version** right now?

I can add:
1. Intent detection to ScrabEngine (classify BOOKING/EMERGENCY/QUESTION/etc.)
2. Simple badge in Call Console showing detected intent
3. Red/green indicator if intent was honored
4. Basic mismatch detection

This would give you immediate value and we can enhance later.

**Shall I proceed with Phase 1?**
