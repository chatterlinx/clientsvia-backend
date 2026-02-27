# Name Extraction & Personalization Flow

## 📞 **Your Example Call:**

**Customer says:** "Hi my name is Marc and you have serviced my unit before I was wondering if I could get a technician here today please."

---

## 🔍 **Complete Journey: How "Marc" Gets Captured and Used**

### **STEP 1: Raw STT Result**
```
Input: "Hi my name is Marc and you have serviced my unit before I was wondering if I could get a technician here today please."
```

---

### **STEP 2: ScrabEngine Processing**

**Stage 1 - Fillers:**
```
Remove: "Hi" (greeting)
Output: "my name is Marc and you have serviced my unit before I was wondering if I could get a technician here today please."
```

**Stage 2 - Vocabulary:**
```
No mishears detected
Output: (unchanged)
```

**Stage 3 - Token Expansion:**
```
Expand: "technician" → ["technician", "tech", "service", "repair"]
Output: Enhanced tokens for trigger matching
```

---

### **STEP 3: Agent2DiscoveryRunner - Name Extraction**

**Code:** `services/engine/agent2/Agent2DiscoveryEngine.js` Line 314-330

**Function:** `extractCallerName(text)`

```javascript
const patterns = [
  /my name is (\w+)/i,        ← MATCHES!
  /this is (\w+)/i,
  /i'm (\w+)/i,
  /call me (\w+)/i
];

Input: "my name is Marc and..."
Pattern: /my name is (\w+)/i
Match: "Marc"
```

**Result:** `callerName = "Marc"` (Title-cased)

**Stored in:** `session.callerName`

**Code Location:**
```javascript
// Line 345-348
const detectedName = extractCallerName(text);
if (detectedName && !sessionUpdates.callerName) {
  sessionUpdates.callerName = detectedName;
}
```

---

### **STEP 4: Trigger Card Matching**

**Input to Triggers:**
- Text: "you have serviced my unit before I was wondering if I could get a technician here today please"
- Keywords checked: ["service", "technician", "today", "schedule"]

**Matched Trigger:** "Service Call Scheduling" (example)

**Response Template (from trigger card):**
```
"Great! I'd be happy to help you schedule a service call{name_greeting}. 
Let me get some details from you."
```

---

### **STEP 5: Personalization - Add Name to Response**

**Variable Substitution:**

The trigger response contains placeholder: `{name_greeting}`

**Substitution Logic:**
```javascript
if (session.callerName) {
  {name_greeting} → ", Marc"
} else {
  {name_greeting} → ""
}
```

**Final Response:**
```
"Great! I'd be happy to help you schedule a service call, Marc. 
Let me get some details from you."
```

**Code:** Variable substitution happens in response rendering

---

### **STEP 6: Handoff to Booking**

**Booking Payload Structure:**

```javascript
{
  firstName: "Marc",           ← From session.callerName
  issue: "service call",       ← From call reason
  urgency: "today",            ← Detected from "today"
  slots: {
    name: "Marc",              ← Pre-filled!
    phone: "+12395652202",     ← From caller ID
    time: "today",             ← Extracted
    address: null              ← To be collected
  }
}
```

**When Booking Asks:** "And what's your last name, Marc?"
- First name already known
- Only asks for missing info (last name, address)

---

## 🎯 **The Complete Flow:**

```
Customer: "Hi my name is Marc and I need service today"
    ↓
ScrabEngine: "my name is Marc and I need service today"
    ↓
Agent2 extractCallerName(): "Marc"
    ↓
Store in session.callerName
    ↓
Trigger Match: "Service Call"
    ↓
Response: "Great! I'd help you schedule service, Marc."
    ↓
Booking Handoff:
{
  firstName: "Marc",
  issue: "service call",
  urgency: "today"
}
    ↓
Booking asks: "What's your last name, Marc?"
```

---

## 🔧 **Where Name Extraction Happens**

### **Discovery Phase (Agent 2.0)**

**File:** `services/engine/agent2/Agent2DiscoveryEngine.js`  
**Function:** `extractCallerName(text)` (Line 314-330)  
**When:** Every turn in discovery mode  
**Patterns:**
- "my name is [Name]"
- "this is [Name]"
- "I'm [Name]"
- "call me [Name]"

**Storage:** `session.callerName`

### **Booking Phase (BookingLogicEngine)**

**File:** `utils/nameExtraction.js`  
**Function:** `extractName(text, options)`  
**When:** Asking for name slot  
**More Permissive:** Accepts single-word responses when expecting name

---

## 💬 **How Responses Use the Name**

### **Option 1: Variable Substitution**

Trigger response template:
```
"I'd be happy to help{name_greeting}!"
```

Becomes:
- With name: "I'd be happy to help, Marc!"
- Without name: "I'd be happy to help!"

### **Option 2: Conditional Personalization**

```javascript
if (session.callerName) {
  response = `Hi ${session.callerName}! ${baseResponse}`;
} else {
  response = baseResponse;
}
```

---

## 🚀 **Booking Handoff with Pre-filled Name**

When Discovery hands off to Booking:

```javascript
const bookingPayload = {
  handoffSource: 'discovery',
  callerContext: {
    firstName: session.callerName,        ← "Marc"
    issueCategory: 'service_call',
    urgency: 'today',
    hasReturnCustomer: false
  },
  preFilledSlots: {
    name: session.callerName              ← "Marc" pre-filled!
  }
};
```

**Booking receives this and:**
1. ✅ Skips asking for first name (already has "Marc")
2. ✅ Asks: "And what's your last name, Marc?" (personalized)
3. ✅ Uses first name throughout conversation
4. ✅ Submits booking with full name

---

## 📊 **Name Validation with GlobalShare**

**When name is extracted, system validates against GlobalShare:**

```javascript
// Check if "Marc" is a valid first name
const isValid = await GlobalHubService.isFirstName("Marc");

if (isValid) {
  // High confidence - it's a real name
  session.callerName = "Marc";
  session.nameConfidence = 0.95;
} else {
  // Low confidence - might be mishear
  session.nameConfidence = 0.6;
  // May ask for confirmation
}
```

**GlobalShare provides:**
- ✅ 9,530 first names (instant validation)
- ✅ 161,427 last names (booking validation)
- ✅ <1ms lookup via Redis
- ✅ Fuzzy matching for misspellings

---

## 🎬 **Real Example with Your Call:**

```
Turn 1:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Customer: "Hi my name is Marc and you have serviced my unit 
           before I was wondering if I could get a technician 
           here today please."

ScrabEngine:
  Stage 1: Remove "Hi"
  Stage 2: No changes
  Stage 3: Expand "technician" → [tech, service, repair]
  Delivery: "my name is Marc and..."

Name Extraction:
  Pattern: /my name is (\w+)/i
  Extracted: "Marc"
  Validation: GlobalShare.isFirstName("Marc") → TRUE ✅
  Stored: session.callerName = "Marc"

Trigger Match:
  Matched: "Service Call Today" trigger
  
Response (with personalization):
  "Hi Marc! I see you've been a customer before. I'd be happy 
   to help you schedule a technician for today. Let me get 
   a few details from you."

Booking Handoff:
  {
    firstName: "Marc",
    issue: "service call",
    urgency: "today",
    isReturnCustomer: true
  }

Turn 2 (Booking):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Agent: "What's your last name, Marc?"

Customer: "Smith"

Name Extraction:
  Context: Expecting last name
  Extracted: "Smith"
  Validation: GlobalShare.isLastName("Smith") → TRUE ✅
  Stored: session.lastName = "Smith"

Agent: "Perfect, Marc Smith! And what's the best phone number 
       to reach you at?"
```

---

## 🔑 **Key Components:**

| Component | Purpose | File |
|-----------|---------|------|
| **Name Extraction** | Detect "my name is [Name]" | `Agent2DiscoveryEngine.js` |
| **Name Validation** | Check if real name | `GlobalHubService.js` |
| **Name Storage** | Store in session | `session.callerName` |
| **Personalization** | Use in responses | Trigger response templates |
| **Booking Handoff** | Pass to booking | `bookingPayload.firstName` |
| **GlobalShare** | 170K+ names for validation | Redis + MongoDB |

---

## ✅ **Summary:**

**How we get the name:**
1. Pattern matching: `/my name is (\w+)/i`
2. Validate with GlobalShare (9,530 first names)
3. Store in `session.callerName`

**How we respond:**
1. Check if `session.callerName` exists
2. Use: "Hi Marc!" or just "Hi!"
3. Variable substitution: `{name_greeting}` → ", Marc"

**How booking gets it:**
1. Handoff payload includes `firstName: "Marc"`
2. Booking pre-fills name slot
3. Only asks for last name
4. Uses "Marc" throughout: "Perfect, Marc!"

---

**Generated:** 2026-02-26  
**Example:** Marc's service call with name extraction
