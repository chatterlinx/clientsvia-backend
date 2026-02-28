# Call Console Truth Enhancement - When, Why, Where
**Created:** 2026-02-28  
**Version:** V125+  
**Goal:** Show complete truth of every call decision

---

## 🎯 **THE PROBLEM**

Current Call Console shows:
- ✅ What was said (transcript)
- ✅ Who said it (caller/agent)
- ❌ **WHY agent said it** (missing!)
- ❌ **WHICH trigger/path was taken** (missing!)
- ❌ **WHERE in config it came from** (missing!)
- ❌ **WHEN each decision was made** (missing!)

**Example from last night's call:**

```
Caller: "Hey John, this is Mark. Um I need to um book an appointment today if I can"
Agent: "Ok. Sorry — you cut out for a second. How can I help you?"
```

**Questions we CAN'T answer:**
- ❓ Why did agent say "you cut out" instead of booking?
- ❓ Did ScrabEngine process the text?
- ❓ Did it extract the name "Mark"?
- ❓ Did it recognize "book an appointment" intent?
- ❓ Which trigger was evaluated?
- ❓ Why didn't booking trigger fire?
- ❓ Was this a fallback response? From where?

---

## ✅ **THE SOLUTION: Enhanced Timeline View**

### **New Visualization - Per-Turn Pipeline:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ Turn 1                                                   11:51:11 PM │
├─────────────────────────────────────────────────────────────────────┤
│ 🎤 CALLER INPUT (RAW)                                               │
│ "Hey John, this is Mark. Um I need to um book an appointment today" │
│                                                                      │
│ 🔍 SCRABENGINE PIPELINE                               Completed 23ms│
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │ Step 1: Filler Removal                                          ││
│ │ Removed: "Hey", "Um" (2 fillers)                                ││
│ │ Result: "John this is Mark need to book an appointment today"   ││
│ │                                                                  ││
│ │ Step 2: Vocabulary Expansion                                    ││
│ │ No expansions needed                                            ││
│ │                                                                  ││
│ │ Step 3: Synonym Mapping                                         ││
│ │ No synonyms applied                                             ││
│ │                                                                  ││
│ │ Step 4: Entity Extraction                                       ││
│ │ ✅ firstName: "Mark"                                            ││
│ │ ✅ intent: "book appointment"                                   ││
│ │ ✅ urgency: "today"                                             ││
│ │                                                                  ││
│ │ OUTPUT:                                                          ││
│ │ Cleaned: "John this is Mark need to book appointment today"     ││
│ │ Entities: { firstName: "Mark", intent: "booking", urgency: ... }││
│ └──────────────────────────────────────────────────────────────────┘│
│                                                                      │
│ 🎭 GREETING INTERCEPTOR CHECK                                       │
│ Input (cleaned): "John this is Mark need to book appointment today" │
│ Result: NO MATCH - has business intent words ("book", "appointment")│
│ Action: Continue to trigger matching                                │
│                                                                      │
│ 🎯 TRIGGER EVALUATION                                  17 cards eval│
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │ Evaluated: 17 trigger cards                                     ││
│ │                                                                  ││
│ │ ✅ MATCHED: "Schedule Appointment"                              ││
│ │    Match type: keyword                                          ││
│ │    Matched on: "book", "appointment"                            ││
│ │    Priority: 100                                                ││
│ │    Source: Global Trigger #booking-001                          ││
│ │    UI Path: Global Triggers → Schedule Appointment              ││
│ │                                                                  ││
│ │ Candidates (not selected):                                      ││
│ │ • "Service Question" (priority 80, keyword: "need")             ││
│ │ • "General Help" (priority 60, keyword: "help")                 ││
│ └──────────────────────────────────────────────────────────────────┘│
│                                                                      │
│ 💬 AGENT RESPONSE                                         Source: UI│
│ "Got it, Mark. I can help you schedule that appointment today."     │
│                                                                      │
│ 📍 SOURCE DETAILS:                                                  │
│ • Config Path: agent2.discovery.playbook.rules[id=booking-001]     │
│ • UI Tab: Triggers → Schedule Appointment                           │
│ • Response Mode: Pre-configured (not LLM)                           │
│ • Audio: Pre-recorded MP3 (fast path)                               │
│ • Variable substituted: {name} → ", Mark"                           │
│                                                                      │
│ ⏱️ TIMING:                                                          │
│ • ScrabEngine: 23ms                                                 │
│ • Greeting check: 2ms                                               │
│ • Trigger matching: 18ms                                            │
│ • Total decision time: 43ms                                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📊 **WHAT TO SHOW FOR EACH TURN**

### **Section 1: Raw Input**
- Original SpeechResult from Deepgram
- Confidence score
- STT provider

### **Section 2: ScrabEngine Processing** ← NEW in V125
- **Step 1 Result:** Fillers removed (show what was removed)
- **Step 2 Result:** Vocabulary expanded (show transformations)
- **Step 3 Result:** Synonyms mapped (show mappings applied)
- **Step 4 Result:** Entities extracted (show firstName, phone, urgency, etc.)
- **Performance:** Processing time
- **Output:** Cleaned text that feeds into next stages

### **Section 3: Greeting Detection** ← UPDATED in V125
- **Input:** Cleaned text (from ScrabEngine)
- **Result:** Matched/Not Matched
- **Rule:** Which greeting rule (if matched)
- **Action:** Exit early (old) / Continue (V125)

### **Section 4: Trigger Evaluation**
- **Input:** Cleaned text (from ScrabEngine)
- **Cards Evaluated:** Count
- **Matched:** Which card (or "No match")
- **Match Reason:** Keywords, phrases, priority
- **Blocked:** Which cards were disqualified (negative keywords)
- **Source:** Global vs Company trigger

### **Section 5: Path Decision**
- **Path Taken:** TRIGGER | GREETING | SCENARIO | LLM | FALLBACK
- **Why:** Explanation of decision logic
- **Priority Order:** What was checked in what order

### **Section 6: Response Generation**
- **Source:** Trigger card / Greeting rule / LLM / Hardcoded fallback
- **UI Path:** Exact location in config
- **Variables:** What was substituted ({name}, {company}, etc.)
- **Audio:** Pre-recorded vs TTS vs Twilio Say
- **Performance:** Generation time

### **Section 7: Timing Breakdown**
- ScrabEngine: Xms
- Greeting check: Xms
- Trigger matching: Xms
- LLM call: Xms (if used)
- TTS generation: Xms (if used)
- Total: Xms

---

## 🔍 **EVENT TYPES TO VISUALIZE**

### **V125 New Events:**
- `SCRABENGINE_PROCESSED` - Text processing pipeline
- `SCRABENGINE_STAGE1_FILLERS` - Filler removal details
- `SCRABENGINE_STAGE2_VOCABULARY` - Vocabulary expansion
- `SCRABENGINE_STAGE3_SYNONYMS` - Synonym mapping
- `SCRABENGINE_STAGE4_EXTRACTION` - Entity extraction
- `CALLER_NAME_EXTRACTED` - Name extraction success
- `A2_GREETING_EVALUATED` - Greeting detection (on cleaned text)
- `A2_GREETING_DETECTED_CONTINUE` - Greeting found but continuing
- `A2_TRIGGER_EVAL` - Trigger card evaluation
- `A2_PATH_SELECTED` - Final path decision
- `SPEECH_SOURCE_SELECTED` - UI path traceability

### **Existing Events:**
- `INPUT_TEXT_FINALIZED` - Raw input captured
- `A2_RESPONSE_READY` - Final response preview
- `A2_LLM_FALLBACK_DECISION` - LLM path decision

---

## 🎨 **UI DESIGN**

### **Collapsible Timeline Sections:**

Each turn should be collapsible with these sections:

```
▼ Turn 1 - 11:51:11 PM
  ├─ 🎤 Input (RAW)
  ├─ 🔍 ScrabEngine (4 steps) ← Click to expand
  ├─ 🎭 Greeting Check
  ├─ 🎯 Trigger Evaluation ← Click to expand
  ├─ 🧠 Path Decision
  ├─ 💬 Response (with source trace)
  └─ ⏱️ Performance Metrics
```

### **Color Coding:**
- 🟢 Green: Successful match (trigger fired, entity extracted)
- 🟡 Yellow: Partial match (greeting detected but continued)
- 🔵 Blue: Processing step (ScrabEngine stages)
- 🟠 Orange: Fallback used (LLM, generic response)
- 🔴 Red: Error or unexpected behavior

---

## 📝 **IMPLEMENTATION CHECKLIST**

### **Backend (Already Done ✅):**
- [x] V125: Move ScrabEngine before greeting
- [x] V125: Greeting uses cleaned text
- [x] V125: Remove early exit from greeting
- [x] Events source: Use CallTranscriptV2.trace
- [x] Testing documentation created

### **Frontend (TODO):**
- [ ] Update `buildScrabByTurnMap()` to extract ScrabEngine events
- [ ] Add ScrabEngine section renderer
- [ ] Add Greeting evaluation section renderer
- [ ] Add Trigger evaluation section renderer with card details
- [ ] Add Path decision timeline
- [ ] Add source traceability view (UI path breadcrumb)
- [ ] Add performance timing chart per turn
- [ ] Make sections collapsible/expandable
- [ ] Add color coding for different event types
- [ ] Add "Export Detailed Report" with full event log

---

## 🚀 **PRIORITY ORDER**

### **Phase 1: Critical Truth (Immediate)**
1. Show ScrabEngine processing (before/after text)
2. Show which trigger matched (or why none matched)
3. Show source UI path for every response
4. Show extracted entities (name, phone, intent)

### **Phase 2: Decision Trail (Next)**
5. Show greeting evaluation result
6. Show trigger card candidates (top 5)
7. Show why cards were blocked (negative keywords)
8. Show path priority logic

### **Phase 3: Performance (Future)**
9. Add timing breakdown charts
10. Add latency warnings (>3s for LLM, etc.)
11. Add cost tracking (per LLM call)

---

## 📊 **EXAMPLE: Full Truth Display**

**Caller:** "Hi I have a blank thermostat"

**Current (Bad):**
```
Turn 1
  Caller: "Hi I have a blank thermostat"
  Agent: "Ok. Sorry — you cut out. How can I help you?"
```

**Enhanced (Truth):**
```
Turn 1 - 11:51:11 PM

🎤 RAW INPUT
"Hi I have a blank thermostat"
Confidence: 0.95 | Provider: Deepgram

🔍 SCRABENGINE (23ms)
Input:  "Hi I have a blank thermostat"
Step 1: Removed "Hi" → "have a blank thermostat"
Step 2: No vocabulary expansion needed
Step 3: Mapped "blank" → "not working", "broken"
Step 4: Extracted: { serviceType: "thermostat", issue: "blank" }
Output: "have blank not working thermostat"

🎭 GREETING CHECK (2ms)
Input:  "have blank not working thermostat" (cleaned)
Result: NO MATCH - has business intent ("thermostat", "blank")
Action: Continue to triggers ✅

🎯 TRIGGER EVALUATION (18ms)
Cards Evaluated: 23
✅ MATCHED: "Thermostat Not Working" (Priority 95)
   Keywords: "thermostat", "blank", "not working"
   Source: Company Triggers → HVAC → Thermostat Issues
   UI Path: aiAgentSettings.agent2.discovery.playbook.rules[id=therm-blank-001]

💬 AGENT RESPONSE (Fast Path - 200ms)
"I can help with your thermostat. Let me connect you with our technician right away."
Source: ✅ UI-Owned (Trigger Card)
Audio: Pre-recorded MP3 (no TTS needed)
Variables: None

📍 FULL TRACE:
1. Deepgram STT → Raw text
2. ScrabEngine → Cleaned text + entities
3. Greeting check → No match
4. Trigger match → "Thermostat Not Working"
5. Response: Trigger card #therm-blank-001
6. Audio: Cached MP3 from ElevenLabs
```

---

## 🔧 **FILES TO MODIFY**

### **1. Frontend - Call Console UI**
**File:** `public/agent-console/callconsole.js`

**Functions to Add/Update:**
- `renderScrabEngineSection(turnEvents)` - Show 4-step pipeline
- `renderGreetingCheckSection(turnEvents)` - Show greeting evaluation
- `renderTriggerEvalSection(turnEvents)` - Show card matching details
- `renderPathDecisionSection(turnEvents)` - Show why this path was taken
- `renderSourceTrace(provenance)` - Show UI path breadcrumb
- `renderPerformanceMetrics(turnEvents)` - Show timing breakdown

**CSS Additions:**
- `.scrab-pipeline` - ScrabEngine visualization
- `.trigger-candidates` - Card evaluation table
- `.path-decision` - Decision tree visual
- `.source-breadcrumb` - UI path trail

### **2. Backend - Event Enrichment**
**File:** `services/CallLogger.js`

**Ensure these events are logged:**
- All ScrabEngine stage events
- Greeting evaluation with cleaned text
- Trigger evaluation with candidate list
- Path decision with priority explanation

---

## 📋 **CALL CONSOLE SECTIONS (Enhanced)**

### **Current Sections:**
1. Call Metadata (phone, duration, etc.)
2. Problems Section (violations, fallbacks)
3. Turn-by-Turn Transcript
4. Events Log (collapsible)

### **New Sections (V125+):**
1. Call Metadata ← Keep as-is
2. Problems Section ← Keep as-is
3. **📊 Decision Pipeline Summary** ← NEW
   - Shows: How many triggers matched across all turns
   - Shows: How many LLM fallbacks used
   - Shows: ScrabEngine stats (fillers removed, entities extracted)
4. **🔍 Turn-by-Turn Truth Timeline** ← ENHANCED
   - Raw Input
   - ScrabEngine Pipeline (expandable)
   - Greeting Check
   - Trigger Evaluation (expandable)
   - Path Decision
   - Response (with full source trace)
   - Performance Metrics
5. Events Log ← Keep but enhance formatting

---

## 🎯 **SUCCESS CRITERIA**

**Call Console is "truth-complete" when we can answer:**

✅ **WHEN:**
- When did ScrabEngine process this turn? (timestamp + duration)
- When was greeting evaluated? (timestamp)
- When did trigger match? (timestamp)
- When was response generated? (timestamp)
- Total turn latency? (breakdown by stage)

✅ **WHY:**
- Why was "Hi" removed? (ScrabEngine Stage 1: Filler removal)
- Why did greeting check pass/fail? (has intent words / too long / etc.)
- Why did this trigger match? (keywords X, Y, Z present)
- Why didn't other triggers match? (negative keywords / lower priority)
- Why was LLM used? (no trigger match + enabled + under max turns)
- Why was fallback used? (LLM blocked + no trigger + no greeting)

✅ **WHERE:**
- Where in config is this trigger? (UI path: Triggers → HVAC → Emergency)
- Where was this response text? (field: answerText in card #xyz)
- Where was this audio generated? (ElevenLabs voice ID, cached MP3)
- Where in code was this decision made? (Agent2DiscoveryRunner.js:1788)

---

## 🔴 **CURRENT GAPS (From Last Night's Call)**

**Missing Truth:**
1. ❌ No ScrabEngine section (can't see "Hey" was removed)
2. ❌ No greeting evaluation (can't see if it tried to match)
3. ❌ No trigger candidate list (can't see what was evaluated)
4. ❌ No path decision explanation (can't see why fallback was used)
5. ❌ No timing breakdown (can't see if something was slow)

**Result:** Can't debug why "book appointment" didn't trigger booking flow.

---

## 🛠️ **NEXT ACTIONS**

### **Immediate (Today):**
1. ✅ Deploy V125 to production
2. Make test call with V125 code
3. Verify events populate in CallTranscriptV2.trace
4. Check if triggers now match correctly

### **Short Term (This Week):**
5. Enhance Call Console UI to show ScrabEngine pipeline
6. Add trigger evaluation details
7. Add source traceability (UI path breadcrumbs)
8. Add timing breakdown per turn

### **Medium Term (Next Week):**
9. Add collapsible sections for complex events
10. Add export with full event log
11. Add visual decision tree
12. Add performance monitoring alerts

---

## 💡 **QUICK WINS**

### **Minimal Enhancement (30 min):**
Just show the events array in a formatted way:
- Group events by turn
- Show event type + timestamp
- Show key payload fields (matchedCard, detectedGreeting, etc.)
- Collapsible JSON view for full details

### **Medium Enhancement (2 hours):**
Add dedicated sections:
- ScrabEngine: Show before/after text
- Greeting: Show match result + reason
- Triggers: Show matched card + candidates
- Source: Show UI path

### **Full Enhancement (1 day):**
Complete pipeline visualization:
- Visual flow diagram per turn
- Color-coded decision paths
- Interactive expandable sections
- Timing charts
- Export detailed report

---

## 🎉 **VALUE PROPOSITION**

**Before Enhancement:**
- "Why did agent say that?" → Can't tell
- "Did triggers work?" → Can't tell
- "Was ScrabEngine called?" → Can't tell
- Hours spent debugging blind

**After Enhancement:**
- Every decision explained
- Every source traced to UI
- Every timing measured
- Debug in minutes, not hours
- Enterprise-grade observability
