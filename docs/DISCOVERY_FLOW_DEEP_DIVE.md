# DISCOVERY FLOW - Complete Deep Dive

**Status:** Line-by-line breakdown of ALL Discovery Flow components

---

## 1. SLOT REGISTRY (Lines 26-164)

**Purpose:** Single source of truth for ALL slots (Discovery + Booking)

### Registered Slots:

#### **Slot 1: `name` (First Name)**
- **ID:** `'name'` ← CRITICAL: This is what minimalExtract must populate
- **Type:** `'name_first'`
- **Required:** `true`
- **Discovery Fill Allowed:** `true`
- **Booking Confirm Required:** `true`
- **Extraction Config:**
  - Sources: `['utterance']`
  - Uses First Name List: `true`
  - Confidence Min: `0.72`
- **V118 Name Extraction Policy:**
  - `singleTokenOnly: true` - Only accept ONE word
  - `candidateStrategy: 'rightmost_token'` - Take rightmost viable word
  - **Strip Phrases:** "that's", "thats", "its", "it's", "my", "first", "name", "is", "yeah", "yes", "yep", "sure", "ok", "okay", "um", "uh", "well", "so", "actually", "i'm", "call me", "the"
  - `stripLeadingPunctuation: true`
  - `stripTrailingPunctuation: true`
  - `minLength: 2`
  - `maxLength: 25`
  - `mustBeAlpha: true`
  - `rejectIfStopWord: true`

#### **Slot 2: `lastName`**
- **ID:** `'lastName'` ← CRITICAL: minimalExtract uses this
- **Type:** `'name_last'`
- **Required:** `false`
- **Discovery Fill Allowed:** `true`
- **Same extraction policy as name**

#### **Slot 3: `phone`**
- **ID:** `'phone'` ← Already correct in minimalExtract
- **Type:** `'phone'`
- **Required:** `true`
- **Extraction Sources:** `['caller_id', 'utterance']`
- **Confidence Min:** `0.65`

#### **Slot 4: `address`**
- **ID:** `'address'` ← CRITICAL: Was `address.full` in minimalExtract (FIXED)
- **Type:** `'address'`
- **Required:** `true`
- **Confidence Min:** `0.70`
- **Address Policy:**
  - Default State: `'FL'`
  - Require City if Missing: `true`
  - Require Unit if Multi-Unit: `true`
  - Geo Verify Enabled: `true`
  - Unit Detection Keywords: `['apt', 'apartment', 'unit', 'suite', '#', 'condo', 'bldg']`

#### **Slot 5: `time`**
- **ID:** `'time'`
- **Type:** `'time'`
- **Required:** `true`
- **Discovery Fill Allowed:** `false` ← Only asked during booking
- **Options:** `['morning', 'afternoon']`

#### **Slot 6: `call_reason_detail`**
- **ID:** `'call_reason_detail'`
- **Type:** `'text'`
- **Required:** `false`
- **Discovery Fill Allowed:** `true`
- **Booking Confirm Required:** `false`
- **Write Policy:** `'write_once_append'`
- **Extraction Sources:** `['triage', 'discovery_truth']`
- **Populated By:** TriageEngineRouter + DiscoveryTruthWriter (NOT manual extraction)

---

## 2. DISCOVERY FLOW STEPS (Lines 172-243)

**Version:** `v1`  
**Enabled:** `true`  
**Step Count:** 4

### **Step d0: Call Reason (Order 0)**
- **Step ID:** `'d0'`
- **Slot ID:** `'call_reason_detail'`
- **Order:** `0` (first)
- **Ask Template:** `"Got it — {value}."`
- **Reprompt:** `"What can I help you with today?"`
- **Reprompt Variants:**
  - "What can I help you with today?"
  - "What seems to be the issue?"
  - "What problem are you having today?"
- **Confirm Mode:** `'never'` ← NEVER confirm call reason
- **Notes:** Filled automatically by TriageEngineRouter, not manually extracted

### **Step d1: Name (Order 1)**
- **Step ID:** `'d1'`
- **Slot ID:** `'name'` ← MUST match extraction output
- **Order:** `1`
- **Ask Template:** `"Got it — I have your first name as {value}. Is that right?"`
- **Reprompt:** `"Did I get your first name right?"`
- **Reprompt Variants:**
  - "Did I get your first name right?"
  - "Was that your first name?"
  - "Is that correct?"
- **Confirm Mode:** `'smart_if_captured'`
- **Behavior:**
  - If `name` is empty → ask reprompt
  - If `name` is filled → ask confirm template with {value} = name

### **Step d2: Phone (Order 2)**
- **Step ID:** `'d2'`
- **Slot ID:** `'phone'`
- **Order:** `2`
- **Ask Template:** `"And is the number you're calling from a good one to reach you if we get disconnected?"`
- **Ask Variants:**
  - "And is the number you're calling from a good one to reach you if we get disconnected?"
  - "Can we use this number you're calling from for callbacks and updates?"
  - "Is this a good number to reach you at?"
- **Reprompt:** `"What's the best number to reach you?"`
- **Reprompt Variants:**
  - "What's the best number to reach you?"
  - "What number should we use for callbacks?"
  - "What's a good number for text updates?"
- **Confirm Mode:** `'confirm_if_from_caller_id'`
- **Notes:** Human-like (doesn't read back full number)

### **Step d3: Address (Order 3)**
- **Step ID:** `'d3'`
- **Slot ID:** `'address'`
- **Order:** `3`
- **Ask Template:** `"I have your address as {value}. Is that the service location?"`
- **Reprompt:** `"What's the service address?"`
- **Reprompt Variants:**
  - "What's the service address?"
  - "Where will we be going?"
  - "What address?"
- **Confirm Mode:** `'smart_if_captured'`

---

## 3. FLOW POLICIES (Lines 372-396)

### **Name Parsing Policy:**
- `useFirstNameList: true`
- `confirmIfFirstNameDetected: true`
- **If caller says "no that's my last name":**
  - Move value to `'name.last'`
  - Then ask for `'name.first'`
- `acceptLastNameOnly: true`

### **Booking Policy:**
- **When Booking Starts:** `'confirm_discovery_values_then_ask_missing'`
- **Never Restart If Already Captured:** `true` ← CRITICAL anti-loop

### **Address Policy:**
- Default State: `'FL'`
- Require City If Missing: `true`
- Require Unit If Multi-Unit: `true`
- Geo Verify Enabled: `true`
- Unit Detection Keywords: `['apt', 'apartment', 'unit', 'suite', '#', 'condo', 'bldg', 'lot']`

---

## 4. DETECTION TRIGGERS (Lines 803-853)

### **Wants Booking Phrases (Lines 806-830):**
Direct booking words: 'schedule', 'book', 'appointment', 'dispatch'
Service requests: 'technician', 'service call', 'service visit'
Send/get someone: 'send someone', 'send somebody', 'get someone', 'get somebody', 'send a tech', 'get a tech', 'need someone', 'need somebody'
Help variations: 'help me out', 'help me out here', 'need help', 'i need help', 'need somebody to help', 'need someone to help'
Full phrases: 'i need somebody to help me out', 'i need someone to help me out', 'can you send someone', 'can you send somebody', 'can someone come out', 'can a tech come out'
Come out: 'come out', 'come over', 'come by'
Urgency: 'asap', 'right away', 'as soon as possible', 'today', 'emergency', 'urgent'
Action requests: 'fix it', 'repair it', 'look at it', 'check it out'

### **Trust Concern (Lines 832-836):**
'can you do', 'can you handle', 'can you fix', 'are you able', 'know what you\'re doing', 'qualified', 'sure you can', 'is this going to work', 'you guys any good'

### **Caller Feels Ignored (Lines 838-841):**
'you\'re not listening', 'didn\'t listen', 'you didn\'t hear', 'you\'re ignoring', 'you don\'t get it', 'that\'s not what I said', 'you missed'

### **Refused Slot (Lines 843-846):**
'i don\'t want to', 'not going to give', 'don\'t want to share', 'not comfortable', 'rather not'

### **Describing Problem (Lines 848-852):**
'water leak', 'thermostat', 'not cooling', 'not cool', 'won\'t turn', 'won\'t start', 'making noise', 'making sound', 'smell', 'broken', 'not working', 'problem is', 'issue is'

---

## 5. DISCOVERY & CONSENT CONFIG (Lines 858-876)

- **Booking Requires Explicit Consent:** `false` ← Consent is optional
- **Consent Phrases:** 'schedule', 'book', 'appointment', 'come out', 'send someone', "let's do it", "let's schedule", 'yes please', 'sounds good'
- **Persist Consent:** `true`
- **Lock Mode After Consent:** `true`
- **Extract Issues During Discovery:** `true`
- **Pass Issues To Booking:** `true`

### **Kill Switches (should be OFF):**
- `forceLLMDiscovery: false` ✅
- `disableScenarioAutoResponses: false` ✅

### **Booking Intent Phrases:**
'schedule', 'appointment', 'book', 'service', 'come out', 'someone to come', 'technician', 'repair', 'maintenance', 'installation'

---

## 6. LOOP PREVENTION (Lines 550-560)

- **Enabled:** `true`
- **Max Same Question:** `2`
- **Rephrase Intro:** `"Let me try this differently — "`
- **Escalation Threshold:** `3`
- **Escalation Script:** `"No problem. If you'd rather, I can transfer you to a service advisor to help get you booked."`
- **Nudge Prompts:**
  - Name: "I just need your name to get started."
  - Phone: "I just need a good number to reach you at."
  - Address: "I just need the service address."

---

## 7. OFF-RAILS RECOVERY (Lines 584-621)

**Enabled:** `true`

### **Bridge Back:**
- **Enabled:** `true`
- **Transition Phrase:** `"Now,"`
- **Max Recovery Attempts:** `3`

### **Resume Booking Protocol:**
- **Enabled:** `true`
- **Include Values:** `false`
- **Template:** `"Okay — back to booking. I have {collectedSummary}. {nextQuestion}"`
- **Collected Item Template:** `"{label}"`
- **With Value:** `"{label}: {value}"`
- **Separator:** `", "`
- **Final Separator:** `" and "`

### **Booking Clarification (Meta Questions):**
- **Enabled:** `true`
- **Triggers:** "is that what you want", "is that what you need", "what do you want", "what do you need", "what do you mean", "can you explain", "sorry what do you mean"
- **Template:** `"No problem — {nextQuestion}"`

---

## 8. BOOKING INTERRUPTION BEHAVIOR (Lines 626-638)

- **Enabled:** `true`
- **One Slot Per Turn:** `true`
- **Force Return To Question As Last Line:** `true`
- **Allow Empathy Language:** `false`
- **Max Sentences:** `2`
- **Short Clarification Patterns:** 'mark?', 'yes?', 'hello?', 'what?'

---

## 9. NAME SPELLING VARIANTS (Lines 714-734)

**Enabled:** `true` (ACTIVE by default)

- **Source:** `'auto_scan'` - Auto-detect from commonFirstNames
- **Check Mode:** `'1_char_only'` - Only ask if 1 char difference
- **Max Asks Per Call:** `1` - Don't annoy caller

### **Variant Groups (Pre-built):**
- Mark / Marc
- Brian / Bryan / Bryon
- Eric / Erik
- Steven / Stephen
- Sara / Sarah
- John / Jon
- Kristina / Christina
- Catherine / Katherine / Kathryn
- Philip / Phillip
- Jeffrey / Geoffrey
- Allan / Alan / Allen
- Anne / Ann

---

## 10. ACCESS FLOW (Lines 739-756)

**Enabled:** `false` (disabled by default)

**When Enabled (for HVAC/Plumbing/Electrical/Pest/Carpet):**
- Property Type Question: "Is that a house, condo, apartment, or commercial property?"
- Unit Question: "Got it. What's the unit number?"
- Commercial Unit: "Got it. Is that a suite or floor number?"
- Access Instructions: "Do we need a gate code, elevator access, or should we just knock?"
- Gated Question: "Thanks. One quick thing so the technician can get in — is that inside a gated community, or is it open access?"
- Gate Code Question: "Great, what gate code should the technician use?"
- Gate Guard Notify: "No problem. Since there's a gate guard, please let them know {companyName} will be coming..."

---

## 11. SCHEDULING CONFIG (Lines 649-670)

**Provider:** `'request_only'` (Phase 1 - no calendar integration yet)

### **Time Windows:**
- 8-10am
- 10am-12pm
- 12-2pm
- 2-4pm

### **Prompts:**
- Morning/Afternoon: "Do you prefer morning or afternoon?"
- Time Window: "What time works best for you? We have openings in the {windows}."

### **Rules:**
- Min Lead Time: `2 hours`
- Allow Same Day Booking: `true`

---

## 12. ESCALATION CONFIG (Lines 687-692)

**Enabled:** `true`

**Triggers:** 'talk to someone', 'speak to a person', 'real person', 'human', 'transfer me', 'manager', 'supervisor'

**Messages:**
- Transfer: "Absolutely, one moment while I transfer you to our team."
- No Agent Available: "I apologize, but no one is available right now. Can I take a message and have someone call you back?"

---

## CRITICAL MISMATCHES FOUND

### ❌ **MISMATCH 1: Slot ID for Name**
**Config expects:** `slotId: 'name'` (line 197)  
**minimalExtract was outputting:** `extracted['name.first']` (WRONG)  
**Status:** ✅ FIXED in commit `79a25236` / `f23dd4bc`

### ❌ **MISMATCH 2: Slot ID for Last Name**
**Config expects:** `slotId: 'lastName'` (line 273 in booking flow)  
**minimalExtract was outputting:** `extracted['name.last']` (WRONG)  
**Status:** ✅ FIXED in commit `79a25236` / `f23dd4bc`

### ❌ **MISMATCH 3: Slot ID for Address**
**Config expects:** `slotId: 'address'` (line 231, 320)  
**minimalExtract was outputting:** `extracted['address.full']` (WRONG)  
**Status:** ✅ FIXED in commit `79a25236` / `f23dd4bc`

### ⚠️ **PROBLEM 4: minimalExtract vs Full SlotExtractor**
**Current:** `minimalExtract()` is a 20-line regex in FrontDeskCoreRuntime  
**Should Use:** Full SlotExtractor with 2000+ lines of battle-tested patterns  
**Status:** ⏳ PENDING (next section to fix)

---

## SECTION LOCKING STRATEGY

### **S1: INPUT TEXT TRUTH** ✅ Deployed (`fc94ea5f`)
- Logs: `inputTextSource`, `inputTextLength`, `inputTextPreview`
- Status: TESTING NEEDED

### **S2: SLOT EXTRACTION** ❌ BROKEN
- Current: Uses minimalExtract (20 lines, simple regex)
- Problem: Pattern exists but slot ID mismatch (FIXED)
- Next: Wire full SlotExtractor (2000+ lines, battle-tested)
- Status: READY TO IMPLEMENT

### **S3: DISCOVERY STEP ENGINE** ⏳ UNKNOWN
- Logs: Which step is active, why it's asking/confirming
- Status: NEEDS TRACING

### **S4: TEMPLATE RENDERING** ✅ FIXED
- Problem: `{value}` not rendering for `slotId: 'name'`
- Fix: Added 'name' to template var mapping
- Status: LOCKED @ `db2308ec`

### **S5: CONSENT GATE** ⏳ UNKNOWN
- Needs: Trace when consent is evaluated, granted, pending
- Status: NEEDS TRACING

### **S6: BOOKING FLOW** ⏳ UNKNOWN
- Status: NOT REACHED YET (stuck in discovery)

### **S7: VOICE PROVIDER** ✅ FIXED
- Problem: Was using `<Say>` instead of ElevenLabs
- Fix: Generate TTS for every turn
- Status: LOCKED @ `182f6042`

---

## NEXT IMMEDIATE ACTION: Wire Full SlotExtractor (S2 Fix)

**Current SHA:** `fc94ea5f` (section tracing infrastructure)  
**Next SHA:** Wire full SlotExtractor to replace minimalExtract

**Test criteria:**
- Say "My name is Mark"
- Raw events show `S3(name:Mark)` in sectionTrail
- Discovery responds: "I have your first name as Mark. Is that right?"

**Once GREEN:** Lock S2, move to S3.
