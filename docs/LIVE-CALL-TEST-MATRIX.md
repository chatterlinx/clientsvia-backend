# 🧪 LIVE CALL TEST MATRIX – GO/NO-GO GATE

**Date**: November 27, 2025  
**Purpose**: Prove end-to-end call flow with REAL Twilio calls before declaring production-ready  
**Status**: Ready to Execute

---

## 📋 OVERVIEW

This is your **GO/NO-GO gate**. No more "I think it's wired." We want screenshots of logs for real scenarios.

**Test Company**: Penguin (or your primary test company)  
**Test Phone**: Use a real phone, not simulation  
**Log Source**: Production logs or log viewer

---

## ✅ TEST 1: NORMAL AC REPAIR CALL

### Scenario
Caller wants legitimate service.

### Test Phrase
```
"Hi, I need AC repair in my house."
```

### Expected Behavior
- Passes spam filter
- Plays company greeting
- Agent processes input normally
- Continues call with `<Gather>`

### Expected Logs (IN ORDER):

#### 1. `[SPAM-FIREWALL] decision`
```json
{
  "route": "/voice",
  "companyId": "67...",
  "fromNumber": "+1234567890",
  "toNumber": "+1987654321",
  "decision": "ALLOW",
  "reason": null,
  "spamScore": 0.1,
  "spamFlags": [],
  "callSid": "CA...",
  "timestamp": "2025-11-27T..."
}
```

#### 2. `[GREETING] initialized`
```json
{
  "companyId": "67...",
  "callSid": "CA...",
  "greetingType": "company_custom",
  "ttsProvider": "elevenlabs",
  "voiceId": "...",
  "hasCustomGreeting": true,
  "timestamp": "2025-11-27T..."
}
```

#### 3. `[GATHER] first-turn configured`
```json
{
  "companyId": "67...",
  "callSid": "CA...",
  "action": "/api/twilio/v2-agent-respond/67...",
  "partialResultCallback": "/api/twilio/v2-agent-partial/67...",
  "input": "speech",
  "speechTimeout": "auto",
  "timestamp": "2025-11-27T..."
}
```

#### 4. `[AGENT-INPUT]`
```json
{
  "companyId": "67...",
  "callSid": "CA...",
  "fromNumber": "+1234567890",
  "toNumber": "+1987654321",
  "speechResult": "Hi, I need AC repair in my house.",
  "confidence": "0.95",
  "timestamp": "2025-11-27T..."
}
```

#### 5. `[FRONTLINE]`
```json
{
  "companyId": "67...",
  "callSid": "CA...",
  "triageResult": "DIRECT_TO_3TIER",
  "reason": "normal_service_inquiry",
  "timestamp": "2025-11-27T..."
}
```

#### 6. `[3TIER]`
```json
{
  "companyId": "67...",
  "callSid": "CA...",
  "tierUsed": "TIER_1",
  "scenarioId": "...",
  "scenarioName": "AC Repair Request",
  "scenarioCategory": "service",
  "confidence": 0.95,
  "timestamp": "2025-11-27T..."
}
```

#### 7. `[CHEATSHEET]`
```json
{
  "companyId": "67...",
  "callSid": "CA...",
  "appliedBlocks": [],
  "finalAction": "respond",
  "shortCircuit": false,
  "timestamp": "2025-11-27T..."
}
```

#### 8. `[AGENT-OUTPUT]`
```json
{
  "companyId": "67...",
  "callSid": "CA...",
  "finalAction": "respond",
  "shortResponsePreview": "I'd be happy to help you with AC repair! Let me...",
  "willTransfer": false,
  "willHangup": false,
  "timestamp": "2025-11-27T..."
}
```

### ✅ Pass Criteria
- All 8 logs appear in order
- `decision: "ALLOW"` in spam filter
- `appliedBlocks: []` in CheatSheet (no edge cases fired)
- `finalAction: "respond"` in output
- Caller hears agent response and call continues

---

## ✅ TEST 2: ABUSIVE / LEGAL THREAT CALL

### Scenario
Caller uses profanity and threatens legal action.

### Test Phrase
```
"You people are idiots, I'm going to sue you and report you."
```

### Expected Behavior
- Passes spam filter (low spam score, but abusive language)
- Plays greeting
- Agent detects edge case (abuse OR legal threat)
- Polite warning OR hangup depending on rule config

### Expected Logs (IN ORDER):

#### 1. `[SPAM-FIREWALL] decision`
```json
{
  "decision": "ALLOW",
  "reason": null,
  "spamScore": 0.2,
  "spamFlags": []
}
```

#### 2. `[GREETING] initialized`
```json
{
  "greetingType": "company_custom",
  "ttsProvider": "elevenlabs"
}
```

#### 3. `[GATHER] first-turn configured`
```json
{
  "action": "/api/twilio/v2-agent-respond/67...",
  "input": "speech"
}
```

#### 4. `[AGENT-INPUT]`
```json
{
  "speechResult": "You people are idiots, I'm going to sue you and report you.",
  "confidence": "0.92"
}
```

#### 5. `[FRONTLINE]`
```json
{
  "triageResult": "DIRECT_TO_3TIER",
  "reason": "normal_flow"
}
```

#### 6. `[3TIER]`
```json
{
  "tierUsed": "TIER_1",
  "scenarioCategory": "complaint"
}
```

#### 7. `[CHEAT SHEET ENGINE] Edge case triggered`
```json
{
  "companyId": "67...",
  "callId": "CA...",
  "edgeCase": {
    "id": "ec-abuse-detection-baseline" OR "ec-legal-threat-baseline",
    "name": "Abuse & Profanity Detection" OR "Legal Threat Detection",
    "priority": 2 OR 3,
    "actionType": "polite_hangup" OR "force_transfer",
    "matchedPattern": "idiot|sue",
    "spamScore": 0.2,
    "spamBridgeActive": false
  },
  "sideEffects": {
    "autoBlacklist": false,
    "tags": ["abuse", "profanity"] OR ["legal", "threat"],
    "logSeverity": "critical"
  },
  "shortCircuit": true
}
```

#### 8. `[CHEATSHEET]`
```json
{
  "appliedBlocks": [
    {
      "type": "EDGE_CASE",
      "id": "ec-abuse-detection-baseline" OR "ec-legal-threat-baseline",
      "actionType": "polite_hangup" OR "force_transfer"
    }
  ],
  "finalAction": "hangup" OR "transfer",
  "shortCircuit": true
}
```

#### 9. `[AGENT-OUTPUT]`
```json
{
  "finalAction": "hangup" OR "transfer",
  "shortResponsePreview": "Thank you for calling..." OR "Let me connect you with our manager...",
  "willTransfer": true OR false,
  "willHangup": true OR false
}
```

### ✅ Pass Criteria
- Edge case rule ID appears in logs
- `actionType` matches rule config (polite_hangup or force_transfer)
- `matchedPattern` shows which keyword triggered
- `appliedBlocks` includes edge case details
- `finalAction` is "hangup" or "transfer" (not "respond")
- Caller hears appropriate message (hangup or transfer)

---

## ✅ TEST 3: HIGH SPAM SCORE – SPAM BRIDGE RULE

### Scenario
Caller has high spam score (simulated or real robocall pattern).

**NOTE**: If you don't have a real high-spam call, you can:
- Temporarily lower `minSpamScore` to 0.3 for testing
- OR use a known spam number from testing
- OR simulate by manually setting spamScore in code for ONE test call

### Test Phrase
```
Any phrase (spam score is what matters, not keywords)
```

### Expected Behavior
- Spam filter assigns high score (>=0.85)
- Call still passes filter (ALLOW)
- Agent processes greeting
- Edge case fires PURELY on spam score (no keyword match needed)
- Polite hangup

### Expected Logs (IN ORDER):

#### 1. `[SPAM-FIREWALL] decision`
```json
{
  "decision": "ALLOW",
  "reason": "high_frequency",
  "spamScore": 0.87,
  "spamFlags": ["high_frequency", "suspected_spam"],
  "callSid": "CA...",
  "timestamp": "2025-11-27T..."
}
```
**KEY**: `spamScore >= 0.85` and `decision: "ALLOW"` (passed filter but flagged)

#### 2. `[GREETING] initialized`
```json
{
  "greetingType": "company_custom"
}
```

#### 3. `[GATHER] first-turn configured`
```json
{
  "action": "/api/twilio/v2-agent-respond/67..."
}
```

#### 4. `[AGENT-INPUT]`
```json
{
  "speechResult": "Hello",
  "confidence": "0.85"
}
```

#### 5. `[FRONTLINE]`
```json
{
  "triageResult": "DIRECT_TO_3TIER"
}
```

#### 6. `[3TIER]`
```json
{
  "tierUsed": "TIER_1",
  "scenarioCategory": "greeting"
}
```

#### 7. `[CHEAT SHEET ENGINE] Edge case triggered`
```json
{
  "companyId": "67...",
  "callId": "CA...",
  "edgeCase": {
    "id": "ec-high-risk-spam-auto-hangup",
    "name": "High-Risk Caller – Auto Hangup",
    "priority": 1,
    "actionType": "polite_hangup",
    "matchedPattern": "NONE",
    "spamScore": 0.87,
    "spamBridgeActive": true
  },
  "sideEffects": {
    "autoBlacklist": true,
    "tags": ["spam", "high_risk", "auto_terminated"],
    "logSeverity": "critical"
  },
  "shortCircuit": true
}
```
**KEY**: `spamScore: 0.87`, `spamBridgeActive: true`, `matchedPattern: "NONE"` (no keywords needed)

#### 8. `[CHEATSHEET]`
```json
{
  "appliedBlocks": [
    {
      "type": "EDGE_CASE",
      "id": "ec-high-risk-spam-auto-hangup",
      "actionType": "polite_hangup"
    }
  ],
  "finalAction": "hangup",
  "shortCircuit": true
}
```

#### 9. `[AGENT-OUTPUT]`
```json
{
  "finalAction": "hangup",
  "shortResponsePreview": "Sorry, we're unable to take this call right now.",
  "willTransfer": false,
  "willHangup": true
}
```

### ✅ Pass Criteria
- `spamScore >= 0.85` in [SPAM-FIREWALL] log
- `spamBridgeActive: true` in [CHEAT SHEET ENGINE] log
- Edge case `ec-high-risk-spam-auto-hangup` fires
- `matchedPattern: "NONE"` (proves it's pure spam bridge, not keywords)
- `finalAction: "hangup"`
- Caller hears hangup message and call terminates
- Caller's number added to blacklist (`autoBlacklist: true`)

---

## 📸 LOG COLLECTION CHECKLIST

For each test, collect:

- [ ] Time of call (HH:MM:SS)
- [ ] Phone number used (masked if needed: +123XXX7890)
- [ ] CallSid (CA...)
- [ ] Screenshot or copy of ALL 7-9 logs
- [ ] TwiML sent to Twilio (if available)
- [ ] What caller heard (describe)
- [ ] Final call outcome (continued / transferred / hung up)

---

## 🚨 FAILURE SCENARIOS (What to Fix)

### If Test 1 Fails:
- **No [SPAM-FIREWALL] log**: Spam filter not integrated properly
- **No [GREETING] log**: Greeting initialization broken
- **No [3TIER] log**: IntelligentRouter not firing
- **[CHEATSHEET] missing**: CheatSheetEngine not called
- **[AGENT-OUTPUT] missing**: TwiML generation broken

### If Test 2 Fails:
- **Edge case doesn't fire**: Check PolicyCompiler compiled patterns correctly
- **Wrong edge case fires**: Check priority order
- **No hangup/transfer**: Check TwiML mapping for `action: 'HANGUP'` or `action: 'TRANSFER'`
- **appliedBlocks empty**: Edge case matched but not logged

### If Test 3 Fails:
- **spamScore not in logs**: spamContext not attached to callState
- **Edge case doesn't fire**: `minSpamScore` check not enforced in detectEdgeCase()
- **`spamBridgeActive: false`**: Schema fields not saved correctly
- **Fires on keywords instead of spam score**: Rule has keywords when it shouldn't

---

## 🎯 GO/NO-GO DECISION

### ✅ GO FOR PRODUCTION IF:
- All 3 tests pass
- All expected logs appear
- Final outcomes match expectations
- TwiML is correct
- No errors in logs

### ❌ NO-GO (FIX FIRST) IF:
- Any test missing logs
- Edge cases don't fire when they should
- Wrong action types execute
- Call loops or breaks
- Spam bridge doesn't work

---

## 📋 TEST EXECUTION TEMPLATE

Use this template for each test:

```
TEST: [Normal AC Repair / Abuse Threat / High Spam]
DATE: 2025-11-27
TIME: HH:MM:SS
COMPANY: Penguin (67...)
PHONE: +123XXX7890
CALLSID: CA...

WHAT I SAID:
"..."

WHAT AGENT SAID:
"..."

FINAL OUTCOME:
[Continued / Transferred / Hung Up]

LOGS COLLECTED:
✅ [SPAM-FIREWALL]
✅ [GREETING]
✅ [GATHER]
✅ [AGENT-INPUT]
✅ [FRONTLINE]
✅ [3TIER]
✅ [CHEATSHEET]
✅ [AGENT-OUTPUT]

PASS/FAIL: [PASS / FAIL]

NOTES:
...
```

---

## 🚀 NEXT STEPS AFTER TESTING

### If All Tests Pass:
1. Document results (save logs + screenshots)
2. Mark system as "production-ready"
3. Proceed to intensity modes (Phase 2)
4. Start real customer traffic

### If Any Test Fails:
1. Fix the specific issue
2. Re-run ALL 3 tests (don't skip)
3. Repeat until all pass

---

**Status**: Ready to Execute  
**Owner**: Marc  
**Tester**: Marc (real phone calls required)  
**GO/NO-GO Gate**: Must pass all 3 tests before production traffic  

---

_Created: November 27, 2025_  
_Last Updated: November 27, 2025_  
_Version: 1.0_

