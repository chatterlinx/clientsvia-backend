# Transcript Roadmap - Visual Sequence Path Tracking
**Created:** 2026-02-28  
**Goal:** Show numbered sequence path for each turn so you can see where agent jumped

---

## 🎯 **THE CONCEPT: Numbered Roadmap**

Show the **exact sequence path** the agent took, numbered 1-2-3-4, so you can instantly see:
- ✅ Where it followed the correct path
- ❌ Where it jumped/skipped steps
- ⚠️ Where it took an unexpected detour

---

## 🎨 **VISUAL DESIGN**

### **Example: Working Correctly**

```
Turn 1: "I need emergency AC service"

ROADMAP:
┌────────────────────────────────────────────────────────────────┐
│ 1 → SpeechResult Received                                  ✅ │
│     "I need emergency AC service"                             │
│                                                                │
│ 2 → ScrabEngine Processed                                  ✅ │
│     Cleaned: "need emergency air conditioning service"        │
│     Entities: { urgency: "emergency", service: "ac" }         │
│                                                                │
│ 3 → Greeting Check (on cleaned text)                       ✅ │
│     Result: NO MATCH (has business intent)                    │
│     Action: Continue to triggers                              │
│                                                                │
│ 4 → Trigger Evaluation                                     ✅ │
│     ✅ MATCHED: "Emergency AC Service" (Global #emerg-ac-001) │
│     Priority: 100 | Keywords: emergency, ac, service          │
│                                                                │
│ 5 → Response Generated                                     ✅ │
│     Source: Trigger Card                                      │
│     Text: "We'll send someone immediately for your emergency" │
│     Audio: Pre-recorded MP3 (200ms - FAST!)                   │
└────────────────────────────────────────────────────────────────┘

PATH TAKEN: 1 → 2 → 3 → 4 → 5  ✅ CORRECT SEQUENCE
```

---

### **Example: Broken (Jumped Steps)**

```
Turn 1: "Hi I need emergency service"

ROADMAP:
┌────────────────────────────────────────────────────────────────┐
│ 1 → SpeechResult Received                                  ✅ │
│     "Hi I need emergency service"                             │
│                                                                │
│ 2 → ScrabEngine Processed                                  ⚠️ │
│     ⚠️ OLD CODE (Before V125): ScrabEngine SKIPPED!           │
│     Should have removed "Hi" but didn't run                   │
│                                                                │
│ 3 → Greeting Check (on RAW text)                           ❌ │
│     Input: "Hi I need emergency service" (not cleaned!)       │
│     Result: ✅ MATCHED "Hi" (greeting rule)                   │
│     Action: ❌ EARLY EXIT - JUMPED TO STEP 5                  │
│                                                                │
│ ❌ STEP 4 SKIPPED: Trigger Evaluation                         │
│     Never evaluated because greeting exited early             │
│     Emergency trigger NEVER CHECKED ❌                         │
│                                                                │
│ 5 → Response Generated                                     ❌ │
│     Source: Greeting Fallback                                 │
│     Text: "Hello! How can I help you?"                        │
│     Audio: Greeting audio                                     │
│                                                                │
│     🚨 WRONG! Should have been emergency response!            │
└────────────────────────────────────────────────────────────────┘

PATH TAKEN: 1 → 2 ⚠️ → 3 → 🚫 JUMP → 5  ❌ SKIPPED STEP 4!

🚨 SEQUENCE VIOLATION DETECTED:
• Step 2: ScrabEngine didn't run (old code bug)
• Step 3: Greeting checked RAW text instead of cleaned
• Step 4: SKIPPED - Triggers never evaluated
• Step 5: Wrong response (greeting instead of emergency)

ROOT CAUSE: V124 code (before V125 fix)
FIX: V125 deployed - ScrabEngine now runs at step 2
```

---

### **Example: After V125 Fix**

```
Turn 1: "Hi I need emergency service"

ROADMAP:
┌────────────────────────────────────────────────────────────────┐
│ 1 → SpeechResult Received                                  ✅ │
│     "Hi I need emergency service"                             │
│                                                                │
│ 2 → ScrabEngine Processed                                  ✅ │
│     ✅ V125 FIX: ScrabEngine ran FIRST!                       │
│     Step 1: Removed "Hi" → "need emergency service"           │
│     Step 4: Detected urgency="emergency"                      │
│     Output: "need emergency service" (cleaned)                │
│                                                                │
│ 3 → Greeting Check (on cleaned text)                       ✅ │
│     Input: "need emergency service" (cleaned by ScrabEngine)  │
│     Result: NO MATCH (has business intent: "emergency")       │
│     Action: Continue to triggers ✅                            │
│                                                                │
│ 4 → Trigger Evaluation                                     ✅ │
│     ✅ MATCHED: "Emergency Service" (Priority 100)            │
│     Keywords: emergency, service                              │
│     Source: Company Triggers → Emergency                      │
│                                                                │
│ 5 → Response Generated                                     ✅ │
│     Source: Trigger Card #emerg-001                           │
│     Text: "We'll send someone immediately!"                   │
│     Audio: Pre-recorded MP3                                   │
└────────────────────────────────────────────────────────────────┘

PATH TAKEN: 1 → 2 → 3 → 4 → 5  ✅ PERFECT SEQUENCE

✅ SEQUENCE FOLLOWED CORRECTLY:
• Step 2: ScrabEngine cleaned text ✅
• Step 3: Greeting checked cleaned text ✅
• Step 4: Triggers evaluated ✅
• Step 5: Emergency trigger fired ✅

RESULT: Correct emergency response!
```

---

## 🔢 **NUMBERED SEQUENCE LEGEND**

### **Standard Discovery Path:**

```
1 → SpeechResult Received (Deepgram STT)
2 → ScrabEngine Processed (4-step pipeline)
3 → Greeting Check (on cleaned text)
4 → Trigger Evaluation (match against cards)
5 → Response Generated (from matched source)
6 → State Updated (slots, mode, etc.)
7 → TwiML Sent (audio played to caller)
```

### **Booking Path (Variation):**

```
1 → SpeechResult Received
2 → ScrabEngine Processed
3 → Greeting Check
4 → Trigger Evaluation
    ✅ MATCHED: "Book Appointment" → sessionMode=BOOKING
5 → Handoff to BookingLogicEngine
6 → Booking Step Processed (collect name/phone/time)
7 → Response Generated (booking question)
8 → TwiML Sent
```

### **LLM Fallback Path (Variation):**

```
1 → SpeechResult Received
2 → ScrabEngine Processed
3 → Greeting Check (no match)
4 → Trigger Evaluation (no match)
5 → LLM Fallback Called (GPT-4)
6 → LLM Response Generated (2-3s)
7 → TTS Audio Generated (ElevenLabs)
8 → TwiML Sent
```

---

## 🎨 **UI IMPLEMENTATION**

### **Roadmap Component:**

```html
<div class="turn-roadmap">
  <h5>🗺️ Sequence Path</h5>
  
  <!-- Step 1: SpeechResult -->
  <div class="roadmap-step completed">
    <div class="step-number">1</div>
    <div class="step-content">
      <div class="step-title">SpeechResult Received</div>
      <div class="step-detail">"Hi I need emergency service"</div>
      <div class="step-status">✅ Completed • 11:51:11.123 PM</div>
    </div>
  </div>
  
  <!-- Arrow -->
  <div class="roadmap-arrow">→</div>
  
  <!-- Step 2: ScrabEngine -->
  <div class="roadmap-step completed">
    <div class="step-number">2</div>
    <div class="step-content">
      <div class="step-title">ScrabEngine Processed</div>
      <div class="step-detail">Cleaned: "need emergency service"</div>
      <div class="step-status">✅ Completed • 23ms</div>
    </div>
  </div>
  
  <div class="roadmap-arrow">→</div>
  
  <!-- Step 3: Greeting -->
  <div class="roadmap-step completed">
    <div class="step-number">3</div>
    <div class="step-content">
      <div class="step-title">Greeting Check</div>
      <div class="step-detail">NO MATCH (has business intent)</div>
      <div class="step-status">✅ Completed • 2ms</div>
    </div>
  </div>
  
  <div class="roadmap-arrow">→</div>
  
  <!-- Step 4: Triggers -->
  <div class="roadmap-step completed">
    <div class="step-number">4</div>
    <div class="step-content">
      <div class="step-title">Trigger Evaluation</div>
      <div class="step-detail">✅ MATCHED: "Emergency Service"</div>
      <div class="step-status">✅ Completed • 18ms</div>
    </div>
  </div>
  
  <div class="roadmap-arrow">→</div>
  
  <!-- Step 5: Response -->
  <div class="roadmap-step completed">
    <div class="step-number">5</div>
    <div class="step-content">
      <div class="step-title">Response Generated</div>
      <div class="step-detail">Source: Trigger Card #emerg-001</div>
      <div class="step-status">✅ Completed • 200ms total</div>
    </div>
  </div>
</div>

<!-- Path Summary -->
<div class="path-summary success">
  <strong>PATH:</strong> 1 → 2 → 3 → 4 → 5 ✅ CORRECT SEQUENCE
</div>
```

### **For Broken Calls (Skipped Steps):**

```html
<div class="turn-roadmap">
  <!-- Steps 1-3 same as above -->
  
  <!-- Step 4: SKIPPED -->
  <div class="roadmap-step skipped">
    <div class="step-number">🚫</div>
    <div class="step-content">
      <div class="step-title">Trigger Evaluation</div>
      <div class="step-detail">❌ SKIPPED - Greeting exited early</div>
      <div class="step-status">❌ Never executed</div>
    </div>
  </div>
  
  <!-- Jump indicator -->
  <div class="roadmap-jump">
    ⚡ JUMPED TO STEP 5
  </div>
  
  <!-- Step 5 -->
  <div class="roadmap-step completed wrong">
    <div class="step-number">5</div>
    <div class="step-content">
      <div class="step-title">Response Generated</div>
      <div class="step-detail">Source: Greeting Fallback (WRONG!)</div>
      <div class="step-status">⚠️ Wrong path taken</div>
    </div>
  </div>
</div>

<!-- Path Summary with Warning -->
<div class="path-summary error">
  <strong>PATH:</strong> 1 → 2 → 3 → 🚫 SKIP 4 → 5 ❌ SEQUENCE VIOLATED
  <div class="path-issue">
    🚨 Step 4 skipped: Triggers never evaluated due to greeting early exit
  </div>
</div>
```

---

## 📝 **CSS Styles**

```css
.turn-roadmap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
  margin: 12px 0;
}

.roadmap-step {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.roadmap-step.completed .step-number {
  background: #10b981;
  color: white;
}

.roadmap-step.skipped .step-number {
  background: #ef4444;
  color: white;
}

.roadmap-step.completed.wrong .step-number {
  background: #f59e0b;
  color: white;
}

.step-number {
  min-width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}

.step-content {
  flex: 1;
}

.step-title {
  font-weight: 600;
  font-size: 14px;
  color: #1e293b;
  margin-bottom: 4px;
}

.step-detail {
  font-size: 13px;
  color: #64748b;
  margin-bottom: 4px;
}

.step-status {
  font-size: 12px;
  color: #94a3b8;
}

.roadmap-arrow {
  text-align: center;
  color: #cbd5e1;
  font-size: 18px;
  font-weight: 700;
  margin: -4px 0;
}

.roadmap-jump {
  text-align: center;
  color: #ef4444;
  font-size: 13px;
  font-weight: 700;
  padding: 8px;
  background: #fee2e2;
  border-radius: 6px;
  border: 2px dashed #ef4444;
}

.path-summary {
  padding: 12px;
  border-radius: 6px;
  margin-top: 8px;
  font-size: 13px;
}

.path-summary.success {
  background: #d1fae5;
  border: 1px solid #10b981;
  color: #065f46;
}

.path-summary.error {
  background: #fee2e2;
  border: 1px solid #ef4444;
  color: #991b1b;
}

.path-issue {
  margin-top: 6px;
  font-size: 12px;
  padding-top: 6px;
  border-top: 1px solid rgba(0,0,0,0.1);
}
```

---

## 🔍 **REAL EXAMPLE: Last Night's Call**

### **Turn 1: "Hey John, this is Mark. Um I need to book an appointment today"**

```
ROADMAP (OLD CODE - Before V125):
┌────────────────────────────────────────────────────────────────┐
│ 1 → SpeechResult Received                                  ✅ │
│     "Hey John, this is Mark. Um I need to book an appointment" │
│                                                                │
│ 2 → Load State                                              ✅ │
│     Turn count: 1                                              │
│                                                                │
│ 3 → CallRuntime.processTurn()                               ✅ │
│     Mode: DISCOVERY                                            │
│                                                                │
│ 4 → Agent2DiscoveryRunner.run()                             ✅ │
│     Started discovery processing                               │
│                                                                │
│ 5 → Greeting Check (on RAW text)                            ❌ │
│     Input: "Hey John, this is Mark..." (RAW, not cleaned!)    │
│     Result: ✅ MATCHED "Hey" (greeting detected)              │
│     Action: ❌ EARLY EXIT - RETURNED IMMEDIATELY               │
│                                                                │
│ ❌ STEP 6 SKIPPED: ScrabEngine                                 │
│     Never ran because greeting exited early                    │
│     Name "Mark" NEVER EXTRACTED ❌                             │
│     Intent "book appointment" NEVER DETECTED ❌                │
│                                                                │
│ ❌ STEP 7 SKIPPED: Trigger Evaluation                          │
│     Never ran because greeting exited early                    │
│     Booking trigger NEVER CHECKED ❌                           │
│                                                                │
│ 8 → Response Generated (WRONG PATH!)                        ❌ │
│     Source: Generic Fallback (not greeting, not trigger!)     │
│     Text: "Sorry — you cut out. How can I help?"              │
│     Audio: ElevenLabs TTS                                      │
└────────────────────────────────────────────────────────────────┘

PATH TAKEN: 1 → 2 → 3 → 4 → 5 → 🚫 SKIP 6 → 🚫 SKIP 7 → 8

🚨 CRITICAL SEQUENCE VIOLATIONS (2):
1. Step 6 SKIPPED: ScrabEngine never processed text
   - Intent "booking" never detected
   - Name "Mark" never extracted
   - Urgency "today" never flagged

2. Step 7 SKIPPED: Triggers never evaluated
   - Booking trigger never had a chance to match
   - Customer forced to repeat request
   
ROOT CAUSE: V124 bug - greeting ran before ScrabEngine
FIXED IN: V125 (deployed today)
```

---

## 📊 **ROADMAP AFTER V125 FIX**

```
ROADMAP (V125 - Fixed):
┌────────────────────────────────────────────────────────────────┐
│ 1 → SpeechResult Received                                  ✅ │
│     "Hey John, this is Mark. Um I need to book an appointment" │
│                                                                │
│ 2 → ScrabEngine Processed (RUNS FIRST NOW!)                ✅ │
│     ✅ V125: ScrabEngine moved to run before greeting!        │
│     Step 1: Removed "Hey", "Um"                               │
│     Step 4: Extracted firstName="Mark", intent="booking"      │
│     Output: "John this is Mark need book appointment today"   │
│                                                                │
│ 3 → Greeting Check (on CLEANED text)                        ✅ │
│     Input: "John this is Mark need book..." (cleaned!)        │
│     Result: NO MATCH (has business intent words)              │
│     Action: Continue to triggers ✅                            │
│                                                                │
│ 4 → Trigger Evaluation (NOW RUNS!)                          ✅ │
│     ✅ MATCHED: "Schedule Appointment" (Priority 100)         │
│     Keywords: book, appointment                               │
│     Action: Set sessionMode = BOOKING                         │
│                                                                │
│ 5 → Handoff to BookingLogicEngine                           ✅ │
│     Entities passed: firstName="Mark", urgency="today"        │
│                                                                │
│ 6 → Response Generated                                      ✅ │
│     Source: Booking Flow (first question)                     │
│     Text: "Sure Mark, I can help. What service do you need?"  │
│     Audio: Pre-recorded MP3                                   │
└────────────────────────────────────────────────────────────────┘

PATH TAKEN: 1 → 2 → 3 → 4 → 5 → 6  ✅ PERFECT!

✅ ALL STEPS EXECUTED:
• ScrabEngine: Cleaned text + extracted entities ✅
• Greeting: Checked but didn't match (correct!) ✅
• Triggers: Booking matched ✅
• Booking: Flow started with pre-extracted name ✅

RESULT: Perfect booking experience!
```

---

## 🛠️ **IMPLEMENTATION**

### **Step 1: Track Sequence in Events**

Add step numbers to events:

```javascript
// In Agent2DiscoveryRunner.js

emit('SEQUENCE_STEP', {
  stepNumber: 1,
  stepName: 'SPEECHRESULT_RECEIVED',
  status: 'completed',
  input: speechResult,
  timestamp: new Date()
});

emit('SEQUENCE_STEP', {
  stepNumber: 2,
  stepName: 'SCRABENGINE_PROCESSED',
  status: 'completed',
  duration: 23,
  output: normalizedText,
  timestamp: new Date()
});

emit('SEQUENCE_STEP', {
  stepNumber: 3,
  stepName: 'GREETING_CHECK',
  status: 'completed',
  matched: false,
  action: 'continue',
  timestamp: new Date()
});

// If greeting had early exit (old code):
emit('SEQUENCE_STEP', {
  stepNumber: 4,
  stepName: 'TRIGGER_EVALUATION',
  status: 'skipped',
  reason: 'greeting_early_exit',
  timestamp: new Date()
});

emit('SEQUENCE_VIOLATION', {
  skippedSteps: [4, 6, 7],
  reason: 'greeting_early_exit',
  impact: 'Triggers never evaluated, intent not honored'
});
```

### **Step 2: Render Roadmap in Call Console**

```javascript
function renderTurnRoadmap(turnEvents) {
  const steps = extractSequenceSteps(turnEvents);
  const violations = detectSequenceViolations(steps);
  
  return `
    <div class="turn-roadmap">
      <h5>🗺️ Sequence Path</h5>
      ${steps.map(renderStep).join('')}
      ${renderPathSummary(steps, violations)}
    </div>
  `;
}

function renderStep(step, index, allSteps) {
  const statusClass = step.status === 'skipped' ? 'skipped' : 
                      step.status === 'completed' && step.wrong ? 'wrong' : 
                      'completed';
  
  return `
    <div class="roadmap-step ${statusClass}">
      <div class="step-number">${step.status === 'skipped' ? '🚫' : step.number}</div>
      <div class="step-content">
        <div class="step-title">${step.name}</div>
        <div class="step-detail">${step.detail}</div>
        <div class="step-status">${step.statusText}</div>
      </div>
    </div>
    ${index < allSteps.length - 1 ? renderArrow(step, allSteps[index + 1]) : ''}
  `;
}
```

---

## 🎯 **VALUE PROPOSITION**

### **Before Roadmap:**
```
Turn 1
  Caller: "Hi I need emergency"
  Agent: "Hello! How can I help?"
```
❓ Why didn't emergency trigger fire?
❓ What steps ran?
❓ What was skipped?
→ **No way to tell!**

### **After Roadmap:**
```
Turn 1 ROADMAP:
1 ✅ → 2 ✅ → 3 ✅ → 🚫 SKIP 4 → 5 ❌

Step 4 SKIPPED: Triggers never evaluated
Reason: Greeting exited early (V124 bug)
Fix: V125 deployed
```
✅ **Instantly see the problem!**

---

## 📋 **QUICK IMPLEMENTATION CHECKLIST**

**Backend (Add sequence tracking):**
- [ ] Add `SEQUENCE_STEP` events to Agent2DiscoveryRunner
- [ ] Number each major step (1-7)
- [ ] Track skipped steps
- [ ] Emit `SEQUENCE_VIOLATION` when steps skipped
- [ ] Include step timing

**Frontend (Render roadmap):**
- [ ] Extract sequence steps from events
- [ ] Render numbered path visualization
- [ ] Show arrows between steps
- [ ] Highlight skipped steps in red
- [ ] Show jump indicators
- [ ] Display path summary (correct vs violated)

**Time Estimate:** 3-4 hours for full implementation

---

## 🚀 **WANT ME TO IMPLEMENT THIS NOW?**

I can add:
1. Sequence step tracking to Agent2DiscoveryRunner
2. Roadmap visualization to Call Console
3. Automatic violation detection

This will give you the **numbered path** you wanted to see where the agent jumped!

**Shall I proceed?**
