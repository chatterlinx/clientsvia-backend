# 🔧 RESPONSE ENGINE - IMPLEMENTATION SPECIFICATION
**Date:** November 10, 2025  
**Status:** Ready for Implementation  
**Approval:** Locked with User Confirmation  

---

## 📋 EXACT ANSWERS TO IMPLEMENTATION QUESTIONS

### **Q1: Current Quick/Full Reply Decision Locations**

Two places where reply selection happens:

1. **IntelligentRouter** - After tier selects scenario
   - Logic like `Math.random() < 0.3` for quick reply selection
   - Name-based checks (`includes('hours')`, `includes('pricing')`, etc.)
   - This is where intelligent reply selection was recently added

2. **AIBrain3tierllm** - Final response wrapping
   - Helper/finalizer that produces final response string
   - May also do last-minute quick/full selection

**Search for these patterns to find exact locations:**
- `quickReplies` 
- `fullReplies`
- `Math.random()` for reply decisions
- `scenarioName.includes('hours'/'pricing'/'location')`

**Phase 1 Action:** Patch existing logic in VOICE path  
**Phase 2 Action:** Move all logic to Response Engine

---

### **Q2: Phase 1 Voice Hotfix - Where to Apply**

**Do NOT create wrapper yet.** Patch existing logic directly:

1. Find the function that decides quick vs full reply for VOICE
2. Replace the decision logic with Phase 1 rule:

```javascript
if (channel === 'voice' && scenario.fullReplies && scenario.fullReplies.length > 0) {
    // ALWAYS include fullReply for voice when it exists
    // Never send only quickReply
    // Use full only, or optional quick + full
} else {
    // Use only quickReply if no fullReply exists
}
```

**Scope:** VOICE channel only in Phase 1  
**Keep:** SMS/chat behavior unchanged  
**Safety:** This is a small contained change, easy to revert via git

---

### **Q3: Scenario Model Location**

Scenario schema is in the structure returned by `ScenarioPoolService.getScenarioPoolForCompany()`:

```javascript
const ScenarioSchema = new Schema({
  scenarioId: String,
  name: String,
  triggers: [String],
  quickReplies: [String],
  fullReplies: [String],
  category: String,
  // ... existing fields ...
  
  // ADD THESE NEW FIELDS:
  scenarioType: {
    type: String,
    enum: ['INFO_FAQ', 'ACTION_FLOW', 'SYSTEM_ACK', 'SMALL_TALK'],
    default: null  // Will be inferred if null
  },
  
  replyStrategy: {
    type: String,
    enum: ['AUTO', 'FULL_ONLY', 'QUICK_ONLY', 'QUICK_THEN_FULL', 'LLM_WRAP', 'LLM_CONTEXT'],
    default: 'AUTO'
  }
});
```

**Location:** Likely in `GlobalInstantResponseTemplate.js` or similar model  
**Ensure:** ScenarioPoolService returns these fields as part of Scenario objects

---

### **Q4: Admin UI for Scenario Editor**

Add two dropdowns wherever admins edit scenarios (triggers, replies, category, etc.):

**Location:** Scenario editor form/modal in Admin Dashboard

**Dropdown 1: Scenario Type**
- Label: "Scenario Type"
- Options: INFO_FAQ, ACTION_FLOW, SYSTEM_ACK, SMALL_TALK
- Maps to: `scenario.scenarioType`
- Default: INFO_FAQ for new scenarios

**Dropdown 2: Reply Strategy**
- Label: "Reply Strategy"  
- Options: AUTO, FULL_ONLY, QUICK_ONLY, QUICK_THEN_FULL, LLM_WRAP, LLM_CONTEXT
- Maps to: `scenario.replyStrategy`
- Default: AUTO

**Ensure:**
- Form POST/PUT sends these fields to backend
- Values persist in MongoDB
- Dropdowns display stored values on edit

---

### **Q5: Response Engine Integration Point**

**Location:** Inside `AIBrain3tierllm.query()`

**Flow:**
1. Cache check
2. 3-tier router chooses scenario → returns `{ scenario, confidence, tierUsed, trace }`
3. **NEW: Call Response Engine**

```javascript
// After 3-tier router returns scenario
const responseEngineResult = await ResponseEngine.buildResponse({
  scenario,
  channel: context.channel || 'voice',
  context
});

const finalText = responseEngineResult.text;

// Return with extended metadata
return {
  confidence,
  response: finalText,
  metadata: {
    tierUsed,
    scenarioId,
    scenarioName,
    cost,
    responseTime,
    cached,
    // NEW FIELDS:
    scenarioTypeResolved: responseEngineResult.scenarioTypeResolved,
    replyStrategyResolved: responseEngineResult.replyStrategyResolved,
    responseStrategyUsed: responseEngineResult.strategyUsed
  }
};
```

**v2AIAgentRuntime:** Does NOT need to know about quick/full. Takes final `response` text and sends to Twilio.

---

### **Q6: Metadata Logging Pattern**

Extend existing metadata object (same place you log `tierUsed`, `scenarioId`, etc.):

```javascript
metadata: {
  // EXISTING FIELDS
  tierUsed: 1,
  scenarioId: 'scn-12345',
  scenarioName: 'Hours of Operation',
  confidence: 0.82,
  cost: 0,
  responseTime: 47,
  cached: false,
  
  // NEW FIELDS
  scenarioTypeResolved: 'INFO_FAQ',      // What type did we infer/use?
  replyStrategyResolved: 'AUTO',         // Which strategy was configured?
  responseStrategyUsed: 'FULL_ONLY'      // What did Response Engine actually do?
}
```

**Use:** Same logging/transport as existing metadata  
**No:** New logging mechanism needed  
**Feed to:** Admin trace UI (already expects this metadata format)

---

### **Q7: Test Scenarios - Penguin Air**

**Company:** `companyId = 686a680241806a4991f7367f` (Penguin Air)

**Test Scenario 1: Hours of Operation (INFO_FAQ)**
```
scenarioType: INFO_FAQ
replyStrategy: AUTO
quickReplies: ["We're here to help!"]
fullReplies: ["We're open Monday through Friday from 8 AM to 6 PM, 
              and Saturday from 9 AM to 3 PM. We're closed Sundays."]

Test: "What are your hours?"
Expected (VOICE): Response includes full hours text
                  NEVER just "We're here to help!"
```

**Test Scenario 2: Appointment Booking (ACTION_FLOW)**
```
scenarioType: ACTION_FLOW
replyStrategy: AUTO
quickReplies: ["Sure, I can help you schedule that."]
fullReplies: ["Let me grab a few details. What day and time works best for you?"]

Test: "I'd like to book an appointment."
Expected (VOICE): "Sure, I can help you schedule that. Let me grab a few details..."
```

**Test Scenario 3: System Ack (SYSTEM_ACK)**
```
scenarioType: SYSTEM_ACK
replyStrategy: QUICK_ONLY
quickReplies: ["Got it, one moment while I check that."]
fullReplies: []

Test: From flow step
Expected (VOICE): Only the quick reply
```

**Test Scenario 4: SMS Sanity Check**
```
Test: "What are your hours?" via SMS
Expected: Voice uses new rules, SMS still works correctly
          Phase 1 did NOT break SMS behavior
```

**Verification Checklist per Call:**
- [ ] `tierUsed` is expected (Tier 1 for hours)
- [ ] `scenarioTypeResolved` shows correct type
- [ ] `replyStrategyResolved` matches config
- [ ] `responseStrategyUsed` matches decision
- [ ] Final text contains expected information

---

## 🎯 IMPLEMENTATION SEQUENCE (LOCKED)

### **Phase 1: Voice Hotfix (Immediate)**

**File:** Find existing reply selection logic (IntelligentRouter or AIBrain3tierllm)

**Change:**
- For VOICE channel: If `fullReplies.length > 0`, always include fullReply
- Never send only quickReply when fullReplies exist
- SMS/chat unchanged

**Testing:**
- Test "What are your hours?" on Penguin Air
- Confirm full answer, not just "We're here to help!"
- Revert with git if issues

---

### **Phase 2: Schema + UI**

**Schema Update:**
- Add `scenarioType` to scenario schema (GlobalInstantResponseTemplate)
- Add `replyStrategy` to scenario schema
- Both optional with smart defaults

**UI Addition:**
- Add Scenario Type dropdown (INFO_FAQ, ACTION_FLOW, SYSTEM_ACK, SMALL_TALK)
- Add Reply Strategy dropdown (AUTO, FULL_ONLY, QUICK_ONLY, QUICK_THEN_FULL, LLM_WRAP, LLM_CONTEXT)
- Both in scenario editor form
- Ensure persistence to MongoDB

**Verification:**
- Create new scenario with type/strategy set
- Edit existing scenario, confirm fields show
- Check MongoDB that fields save correctly

---

### **Phase 3: Response Engine Service**

**File:** Create `services/ResponseEngine.js`

**Export:**
```javascript
async buildResponse({ scenario, channel, context })
```

**Returns:**
```javascript
{
  text: "final response string",
  strategyUsed: "FULL_ONLY" | "QUICK_ONLY" | "QUICK_THEN_FULL" | etc,
  scenarioTypeResolved: "INFO_FAQ" | "ACTION_FLOW" | "SYSTEM_ACK" | "SMALL_TALK",
  replyStrategyResolved: "AUTO" | "FULL_ONLY" | etc
}
```

**Implementation:**

Step 1: Resolve `scenarioType`
- If set on scenario → use it
- Else if `fullReplies.length > 0` → `INFO_FAQ`
- Else → `SYSTEM_ACK`

Step 2: Resolve `replyStrategy`
- If set on scenario → use it
- Else → `AUTO`

Step 3: Apply rules based on channel + type

**Voice Rules (First Pass):**
- INFO_FAQ: FULL_ONLY (or optional quick + full)
- ACTION_FLOW: QUICK_THEN_FULL
- SYSTEM_ACK: QUICK_ONLY
- SMALL_TALK: QUICK_ONLY

**Non-Voice:** Simplified (fullReply if available, else quickReply)

**Stubs for Later:**
- LLM_WRAP: Behave like FULL_ONLY, mark `strategyUsed = 'FULL_ONLY'`
- LLM_CONTEXT: Behave like FULL_ONLY, mark `strategyUsed = 'FULL_ONLY'`

---

### **Phase 4: Wire Response Engine into AIBrain**

**File:** `AIBrain3tierllm.js` in `query()` method

**Location:** After 3-tier router returns scenario

**Change:**
```javascript
// OLD: Just return scenario text directly
// NEW: Call Response Engine first
const responseEngineResult = await ResponseEngine.buildResponse({
  scenario,
  channel: context.channel || 'voice',
  context
});

// Use Response Engine result
const finalText = responseEngineResult.text;

// Extend metadata with strategy fields
metadata.scenarioTypeResolved = responseEngineResult.scenarioTypeResolved;
metadata.replyStrategyResolved = responseEngineResult.replyStrategyResolved;
metadata.responseStrategyUsed = responseEngineResult.strategyUsed;

// Return final response
return {
  confidence,
  response: finalText,
  metadata
};
```

---

### **Phase 5: Testing + Logging Verification**

**Real Calls on Penguin Air:**
- "What are your hours?" → Verify full hours in response
- "Book an appointment" → Verify quick + full guidance
- "System ack" from flow → Verify quick only
- SMS test → Verify SMS not broken

**Log Verification:**
- Each call shows correct `tierUsed`
- Each call shows correct `scenarioTypeResolved`
- Each call shows correct `replyStrategyResolved`
- Each call shows correct `responseStrategyUsed`
- No more "We're here to help!" for INFO_FAQ without full reply

---

## ✅ IMPLEMENTATION GUARANTEE

- ✅ No half-fast work - every line intentional
- ✅ World-class labeling - clear function/variable names
- ✅ Enterprise logging - every decision traceable
- ✅ Backwards compatible - existing behavior safe
- ✅ Reversible - Phase 1 reverts with git
- ✅ Well-tested - real call verification
- ✅ Fully documented - commit messages explain why

---

## 🚀 READY TO IMPLEMENT

**Status:** Specification locked, all questions answered, implementation plan clear.

**Next Action:** Begin Phase 1 voice hotfix implementation.


